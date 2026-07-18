const crypto = require('crypto');
const { types } = require('util');
const { FORBIDDEN_BRANCH_IDS } = require('./platform-identity-repository');

const FORECAST_RECEIVABLES_SCHEMA_VERSION = 1;
const FORECAST_INPUT_CONTRACT_VERSION = 'forecast-input-v1';
const FORECAST_HORIZON_DAYS = 30;
const FORECAST_CURRENCY = 'RUB';
const FORECAST_COMMAND_MAX_DEPTH = 32;
const FORECAST_COMMAND_MAX_NODES = 10_000;
const FORECAST_COMMAND_MAX_BYTES = 512 * 1024;

const FORECAST_COMMAND_CONTEXTS = new WeakSet();
const FORECAST_COMMAND_PLANS = new WeakSet();
const FORECAST_PREPARED_PLANS = new WeakSet();

const COMPONENT_KINDS = new Set(['open_period_forecast', 'planned_future']);
const PRIMARY_RENTAL_STATUSES = new Set(['active', 'return_planned']);
const CONFIDENCE_LEVELS = new Set(['high', 'medium', 'low', 'insufficient']);
const AUTHORITY_STATUSES = new Set(['approved_by_reference', 'unresolved', 'rejected']);
const EVENT_KINDS = new Set([
  'rental_status',
  'effective_terms',
  'extension',
  'return',
  'downtime',
  'calculation_policy',
  'vat_policy',
  'rounding_policy',
  'confidence_policy',
  'completeness_manifest',
]);
const REQUIRED_MANIFEST_EVENT_KINDS = Object.freeze([
  'downtime',
  'effective_terms',
  'extension',
  'rental_status',
  'return',
]);
const SECRET_KEY_FRAGMENTS = Object.freeze([
  'password', 'passwd', 'secret', 'token', 'credential', 'authorization', 'cookie',
  'session', 'apikey', 'privatekey',
]);

class ForecastReceivablesPlanningError extends Error {
  constructor(code, message, field, status = 409) {
    super(message);
    this.name = 'ForecastReceivablesPlanningError';
    this.code = code;
    this.field = field;
    this.status = status;
  }
}

function fail(code, message, field, status) {
  throw new ForecastReceivablesPlanningError(code, message, field, status);
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex');
}

function fingerprint(value) {
  return sha256(stableJson(value));
}

function inertFailure(field = 'command') {
  fail(
    'FORECAST_COMMAND_NOT_INERT',
    'Forecast commands must be deeply inert plain JSON data.',
    field,
    400,
  );
}

function assertNotSecretKey(key, field) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SECRET_KEY_FRAGMENTS.some(fragment => normalized.includes(fragment))) {
    fail('FORECAST_SECRET_FIELD_REJECTED', 'Secret-bearing fields are forbidden.', field, 400);
  }
}

function addInertBytes(state, value, field) {
  state.bytes += Buffer.byteLength(value, 'utf8');
  if (state.bytes > FORECAST_COMMAND_MAX_BYTES) {
    fail(
      'FORECAST_COMMAND_MAX_BYTES',
      'Forecast command exceeds the inert JSON byte budget.',
      field,
      400,
    );
  }
}

function materializeInertValue(value, field, depth, ancestors, state) {
  if (depth > FORECAST_COMMAND_MAX_DEPTH) inertFailure(field);
  state.nodes += 1;
  if (state.nodes > FORECAST_COMMAND_MAX_NODES) inertFailure(field);

  if (value === null) {
    addInertBytes(state, 'null', field);
    return null;
  }
  if (typeof value === 'string') {
    addInertBytes(state, JSON.stringify(value), field);
    return value;
  }
  if (typeof value === 'boolean') {
    addInertBytes(state, value ? 'true' : 'false', field);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) inertFailure(field);
    addInertBytes(state, String(value), field);
    return value;
  }
  if (typeof value !== 'object' || types.isProxy(value) || ancestors.has(value)) inertFailure(field);
  if (Object.getOwnPropertySymbols(value).length > 0) inertFailure(field);

  const isArray = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if ((isArray && prototype !== Array.prototype) || (!isArray && prototype !== Object.prototype)) {
    inertFailure(field);
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'toJSON')
    || Object.prototype.hasOwnProperty.call(prototype, 'toJSON')
  ) inertFailure(field);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  ancestors.add(value);
  try {
    if (isArray) {
      const length = descriptors.length?.value;
      const propertyNames = Object.keys(descriptors).filter(key => key !== 'length');
      if (!Number.isSafeInteger(length) || length < 0 || propertyNames.length !== length) inertFailure(field);
      addInertBytes(state, '[]'.padEnd(length > 0 ? length + 1 : 2, ','), field);
      const result = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          inertFailure(`${field}[${index}]`);
        }
        result.push(materializeInertValue(
          descriptor.value,
          `${field}[${index}]`,
          depth + 1,
          ancestors,
          state,
        ));
      }
      return Object.freeze(result);
    }

    const result = {};
    const keys = Object.keys(descriptors).sort();
    addInertBytes(state, '{}'.padEnd(keys.length > 0 ? keys.length + 1 : 2, ','), field);
    for (const key of keys) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        inertFailure(`${field}.${key}`);
      }
      assertNotSecretKey(key, `${field}.${key}`);
      addInertBytes(state, `${JSON.stringify(key)}:`, `${field}.${key}`);
      Object.defineProperty(result, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: materializeInertValue(
          descriptor.value,
          `${field}.${key}`,
          depth + 1,
          ancestors,
          state,
        ),
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function materializeInert(value, field = 'command') {
  return materializeInertValue(value, field, 0, new Set(), { bytes: 0, nodes: 0 });
}

function assertExactKeys(value, allowed, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('FORECAST_OBJECT_REQUIRED', `${field} must be an object.`, field, 400);
  }
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown) fail('FORECAST_UNKNOWN_FIELD', `${field}.${unknown} is not supported.`, `${field}.${unknown}`, 400);
  return value;
}

function requiredText(value, field, max = 512) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('FORECAST_REQUIRED', `${field} is required.`, field, 400);
  }
  const normalized = value.trim();
  if (normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    fail('FORECAST_INVALID_TEXT', `${field} is invalid.`, field, 400);
  }
  return normalized;
}

function optionalText(value, field, max = 512) {
  return value === undefined || value === null || value === '' ? null : requiredText(value, field, max);
}

function requiredId(value, field) {
  return requiredText(value, field, 160);
}

function optionalId(value, field) {
  return value === undefined || value === null || value === '' ? null : requiredId(value, field);
}

function requiredVersion(value, field) {
  if (!Number.isSafeInteger(value) || value < 1) {
    fail('FORECAST_INVALID_VERSION', `${field} must be a positive safe integer.`, field, 400);
  }
  return value;
}

function hash64(value, field) {
  const normalized = requiredText(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    fail('FORECAST_INVALID_HASH', `${field} must be lowercase SHA-256 hex.`, field, 400);
  }
  return normalized;
}

function civilDate(value, field) {
  const normalized = requiredText(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fail('FORECAST_INVALID_DATE', `${field} must be YYYY-MM-DD.`, field, 400);
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) fail('FORECAST_INVALID_DATE', `${field} is not a civil calendar date.`, field, 400);
  return normalized;
}

function addCivilDays(value, days) {
  const normalized = civilDate(value, 'asOfDate');
  if (!Number.isSafeInteger(days)) fail('FORECAST_INVALID_HORIZON', 'Horizon days are invalid.', 'days', 400);
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function assertIanaTimezone(value, field = 'companyTimezone') {
  const timezone = requiredText(value, field, 120);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
  } catch {
    fail('FORECAST_INVALID_TIMEZONE', `${field} must be an IANA timezone.`, field, 400);
  }
  return timezone;
}

function interval(start, end, startField, endField) {
  const normalizedStart = civilDate(start, startField);
  const normalizedEnd = civilDate(end, endField);
  if (normalizedStart >= normalizedEnd) {
    fail('FORECAST_INVALID_INTERVAL', 'Forecast coverage uses a non-empty half-open interval.', startField, 400);
  }
  return [normalizedStart, normalizedEnd];
}

function moneyMinor(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail('FORECAST_INVALID_MONEY', `${field} must be non-negative safe integer minor units.`, field, 400);
  }
  return value;
}

function safeAdd(values, field = 'money') {
  let total = 0;
  for (const value of values) {
    moneyMinor(value, field);
    total += value;
    if (!Number.isSafeInteger(total)) {
      fail('FORECAST_MONEY_OVERFLOW', `${field} exceeds the safe integer range.`, field, 400);
    }
  }
  return total;
}

function reasonCodes(value, field, { required = false } = {}) {
  if (!Array.isArray(value)) fail('FORECAST_REASON_CODES_REQUIRED', `${field} must be an array.`, field, 400);
  const normalized = value.map((item, index) => requiredText(item, `${field}[${index}]`, 120));
  if (new Set(normalized).size !== normalized.length) {
    fail('FORECAST_DUPLICATE_REASON_CODE', `${field} contains duplicates.`, field, 400);
  }
  if (required && normalized.length === 0) {
    fail('FORECAST_REASON_CODES_REQUIRED', `${field} cannot be empty.`, field, 400);
  }
  return Object.freeze([...normalized].sort());
}

function sortedIds(value, field) {
  if (!Array.isArray(value)) fail('FORECAST_ARRAY_REQUIRED', `${field} must be an array.`, field, 400);
  const normalized = value.map((item, index) => requiredId(item, `${field}[${index}]`));
  if (new Set(normalized).size !== normalized.length) {
    fail('FORECAST_DUPLICATE_ID', `${field} contains duplicates.`, field, 400);
  }
  const sorted = [...normalized].sort();
  if (stableJson(sorted) !== stableJson(normalized)) {
    fail('FORECAST_SORTED_IDS_REQUIRED', `${field} must be sorted.`, field, 400);
  }
  return Object.freeze(sorted);
}

function authorityStatus(value, field) {
  const normalized = requiredText(value, field, 80);
  if (!AUTHORITY_STATUSES.has(normalized)) {
    fail('FORECAST_AUTHORITY_STATUS_INVALID', `${field} is invalid.`, field, 400);
  }
  return normalized;
}

function normalizeInputSetManifest(value) {
  if (value === undefined || value === null) return null;
  assertExactKeys(value, new Set([
    'sourceSystem', 'sourceSnapshotVersion', 'coveredBranchId', 'coveredStartDate',
    'coveredEndDateExclusive', 'rentalStatusesCovered', 'authorityStatus', 'policyRef',
    'sourceHash',
  ]), 'inputSetManifest');
  const [coveredStartDate, coveredEndDateExclusive] = interval(
    value.coveredStartDate,
    value.coveredEndDateExclusive,
    'inputSetManifest.coveredStartDate',
    'inputSetManifest.coveredEndDateExclusive',
  );
  return Object.freeze({
    sourceSystem: requiredId(value.sourceSystem, 'inputSetManifest.sourceSystem'),
    sourceSnapshotVersion: requiredVersion(value.sourceSnapshotVersion, 'inputSetManifest.sourceSnapshotVersion'),
    coveredBranchId: requiredId(value.coveredBranchId, 'inputSetManifest.coveredBranchId'),
    coveredStartDate,
    coveredEndDateExclusive,
    rentalStatusesCovered: reasonCodes(value.rentalStatusesCovered, 'inputSetManifest.rentalStatusesCovered', { required: true }),
    authorityStatus: authorityStatus(value.authorityStatus, 'inputSetManifest.authorityStatus'),
    policyRef: optionalId(value.policyRef, 'inputSetManifest.policyRef'),
    sourceHash: hash64(value.sourceHash, 'inputSetManifest.sourceHash'),
  });
}

function normalizeCompletenessManifest(value, field) {
  if (value === undefined || value === null) return null;
  assertExactKeys(value, new Set([
    'sourceSystem', 'sourceSnapshotVersion', 'sourceEventWatermarkVersion', 'eventKindsCovered',
    'coveredStartDate', 'coveredEndDateExclusive', 'sourceHash', 'authorityStatus', 'policyRef',
  ]), field);
  const [coveredStartDate, coveredEndDateExclusive] = interval(
    value.coveredStartDate,
    value.coveredEndDateExclusive,
    `${field}.coveredStartDate`,
    `${field}.coveredEndDateExclusive`,
  );
  const eventKindsCovered = reasonCodes(value.eventKindsCovered, `${field}.eventKindsCovered`, { required: true });
  if (eventKindsCovered.some(kind => !EVENT_KINDS.has(kind))) {
    fail('FORECAST_EVENT_KIND_INVALID', `${field}.eventKindsCovered contains an unsupported kind.`, `${field}.eventKindsCovered`, 400);
  }
  return Object.freeze({
    sourceSystem: requiredId(value.sourceSystem, `${field}.sourceSystem`),
    sourceSnapshotVersion: requiredVersion(value.sourceSnapshotVersion, `${field}.sourceSnapshotVersion`),
    sourceEventWatermarkVersion: requiredVersion(value.sourceEventWatermarkVersion, `${field}.sourceEventWatermarkVersion`),
    eventKindsCovered,
    coveredStartDate,
    coveredEndDateExclusive,
    sourceHash: hash64(value.sourceHash, `${field}.sourceHash`),
    authorityStatus: authorityStatus(value.authorityStatus, `${field}.authorityStatus`),
    policyRef: optionalId(value.policyRef, `${field}.policyRef`),
  });
}

function normalizeEvent(value, index) {
  const field = `inputs.events[${index}]`;
  assertExactKeys(value, new Set([
    'eventKind', 'sourceSystem', 'sourceId', 'sourceVersion', 'sourceEventId',
    'sourceEventVersion', 'effectiveStartDate', 'effectiveEndDateExclusive',
    'authorityStatus', 'authorityPolicyRef', 'evidenceHash',
  ]), field);
  const eventKind = requiredText(value.eventKind, `${field}.eventKind`, 80);
  if (!EVENT_KINDS.has(eventKind)) fail('FORECAST_EVENT_KIND_INVALID', `${field}.eventKind is invalid.`, `${field}.eventKind`, 400);
  const [effectiveStartDate, effectiveEndDateExclusive] = interval(
    value.effectiveStartDate,
    value.effectiveEndDateExclusive,
    `${field}.effectiveStartDate`,
    `${field}.effectiveEndDateExclusive`,
  );
  const status = authorityStatus(value.authorityStatus, `${field}.authorityStatus`);
  const authorityPolicyRef = optionalId(value.authorityPolicyRef, `${field}.authorityPolicyRef`);
  if (status === 'approved_by_reference' && !authorityPolicyRef) {
    fail('FORECAST_AUTHORITY_POLICY_REQUIRED', 'Approved events require an authority policy reference.', `${field}.authorityPolicyRef`, 400);
  }
  return Object.freeze({
    eventKind,
    sourceSystem: requiredId(value.sourceSystem, `${field}.sourceSystem`),
    sourceId: requiredId(value.sourceId, `${field}.sourceId`),
    sourceVersion: requiredVersion(value.sourceVersion, `${field}.sourceVersion`),
    sourceEventId: requiredId(value.sourceEventId, `${field}.sourceEventId`),
    sourceEventVersion: requiredVersion(value.sourceEventVersion, `${field}.sourceEventVersion`),
    effectiveStartDate,
    effectiveEndDateExclusive,
    authorityStatus: status,
    authorityPolicyRef,
    evidenceHash: hash64(value.evidenceHash, `${field}.evidenceHash`),
  });
}

function normalizePlanningInput(value, index) {
  const field = `inputs[${index}]`;
  assertExactKeys(value, new Set([
    'rentalLineId', 'activationBoundaryId', 'activationBoundarySourceHash',
    'effectiveTermsVersionId', 'effectiveTermsSourceVersion', 'effectiveTermsSourceHash',
    'clientId', 'contractId', 'rentalId', 'equipmentId', 'rentalStatus', 'componentKind',
    'serviceStartDate', 'serviceEndDateExclusive', 'candidateStartDate',
    'candidateEndDateExclusive', 'sourceSystem', 'sourceIdentity', 'sourceEventId',
    'sourceEventVersion', 'sourceHash', 'completenessManifest', 'events',
  ]), field);
  const [serviceStartDate, serviceEndDateExclusive] = interval(
    value.serviceStartDate,
    value.serviceEndDateExclusive,
    `${field}.serviceStartDate`,
    `${field}.serviceEndDateExclusive`,
  );
  const [candidateStartDate, candidateEndDateExclusive] = interval(
    value.candidateStartDate,
    value.candidateEndDateExclusive,
    `${field}.candidateStartDate`,
    `${field}.candidateEndDateExclusive`,
  );
  if (
    candidateStartDate < serviceStartDate
    || candidateEndDateExclusive > serviceEndDateExclusive
  ) {
    fail(
      'FORECAST_CANDIDATE_OUTSIDE_SERVICE_INTERVAL',
      `${field} candidate interval must be contained by its service interval.`,
      `${field}.candidateStartDate`,
      400,
    );
  }
  const componentKind = requiredText(value.componentKind, `${field}.componentKind`, 80);
  if (!COMPONENT_KINDS.has(componentKind)) {
    fail('FORECAST_COMPONENT_KIND_INVALID', `${field}.componentKind is invalid.`, `${field}.componentKind`, 400);
  }
  if (!Array.isArray(value.events)) fail('FORECAST_ARRAY_REQUIRED', `${field}.events must be an array.`, `${field}.events`, 400);
  const events = Object.freeze(value.events.map((event, eventIndex) => normalizeEvent(event, eventIndex)));
  const eventIdentities = events.map(event => stableJson([
    event.eventKind, event.sourceSystem, event.sourceId, event.sourceVersion,
    event.sourceEventId, event.sourceEventVersion, event.effectiveStartDate,
    event.effectiveEndDateExclusive,
  ]));
  if (new Set(eventIdentities).size !== eventIdentities.length) {
    fail('FORECAST_DUPLICATE_EVENT', `${field}.events contains duplicate source identities.`, `${field}.events`, 400);
  }
  return Object.freeze({
    rentalLineId: requiredId(value.rentalLineId, `${field}.rentalLineId`),
    activationBoundaryId: requiredId(value.activationBoundaryId, `${field}.activationBoundaryId`),
    activationBoundarySourceHash: hash64(value.activationBoundarySourceHash, `${field}.activationBoundarySourceHash`),
    effectiveTermsVersionId: requiredId(value.effectiveTermsVersionId, `${field}.effectiveTermsVersionId`),
    effectiveTermsSourceVersion: requiredVersion(value.effectiveTermsSourceVersion, `${field}.effectiveTermsSourceVersion`),
    effectiveTermsSourceHash: hash64(value.effectiveTermsSourceHash, `${field}.effectiveTermsSourceHash`),
    clientId: requiredId(value.clientId, `${field}.clientId`),
    contractId: optionalId(value.contractId, `${field}.contractId`),
    rentalId: requiredId(value.rentalId, `${field}.rentalId`),
    equipmentId: optionalId(value.equipmentId, `${field}.equipmentId`),
    rentalStatus: requiredText(value.rentalStatus, `${field}.rentalStatus`, 80),
    componentKind,
    serviceStartDate,
    serviceEndDateExclusive,
    candidateStartDate,
    candidateEndDateExclusive,
    sourceSystem: requiredId(value.sourceSystem, `${field}.sourceSystem`),
    sourceIdentity: requiredId(value.sourceIdentity, `${field}.sourceIdentity`),
    sourceEventId: requiredId(value.sourceEventId, `${field}.sourceEventId`),
    sourceEventVersion: requiredVersion(value.sourceEventVersion, `${field}.sourceEventVersion`),
    sourceHash: hash64(value.sourceHash, `${field}.sourceHash`),
    completenessManifest: normalizeCompletenessManifest(value.completenessManifest, `${field}.completenessManifest`),
    events,
  });
}

function materializeForecastCalculationCommand(input) {
  const inert = materializeInert(input, 'command');
  assertExactKeys(inert, new Set([
    'branchId', 'asOfDate', 'idempotencyKey', 'correlationId', 'expectedActiveRunIds',
    'inputSetManifest', 'inputs', 'expectedInputSetHash', 'reasonCode', 'reasonText',
  ]), 'command');
  const branchId = requiredId(inert.branchId, 'branchId');
  if (FORBIDDEN_BRANCH_IDS.has(branchId.toLowerCase())) {
    fail('FORECAST_BRANCH_SCOPE_REJECTED', 'A concrete branch is required.', 'branchId', 404);
  }
  if (!Array.isArray(inert.inputs)) fail('FORECAST_ARRAY_REQUIRED', 'inputs must be an array.', 'inputs', 400);
  const inputs = Object.freeze(inert.inputs.map(normalizePlanningInput));
  const inputIdentities = inputs.map(item => stableJson([
    item.rentalLineId, item.componentKind, item.candidateStartDate, item.candidateEndDateExclusive,
  ]));
  if (new Set(inputIdentities).size !== inputIdentities.length) {
    fail('FORECAST_DUPLICATE_INPUT', 'inputs contains duplicate coverage candidates.', 'inputs', 400);
  }
  const plan = Object.freeze({
    branchId,
    asOfDate: civilDate(inert.asOfDate, 'asOfDate'),
    idempotencyKey: requiredId(inert.idempotencyKey, 'idempotencyKey'),
    correlationId: requiredId(inert.correlationId, 'correlationId'),
    expectedActiveRunIds: sortedIds(inert.expectedActiveRunIds, 'expectedActiveRunIds'),
    inputSetManifest: normalizeInputSetManifest(inert.inputSetManifest),
    inputs,
    expectedInputSetHash: inert.expectedInputSetHash == null
      ? null
      : hash64(inert.expectedInputSetHash, 'expectedInputSetHash'),
    reasonCode: requiredText(inert.reasonCode, 'reasonCode', 120),
    reasonText: requiredText(inert.reasonText, 'reasonText', 1000),
    schemaVersion: FORECAST_RECEIVABLES_SCHEMA_VERSION,
  });
  FORECAST_COMMAND_PLANS.add(plan);
  return plan;
}

function normalizeDiagnostic(value, index) {
  const field = `diagnostics[${index}]`;
  assertExactKeys(value, new Set([
    'inputIndex', 'rentalLineId', 'componentKind', 'affectedStartDate', 'affectedEndDateExclusive',
    'severity', 'reasonCode', 'sourceIdentity', 'sourceHash', 'policyRef',
  ]), field);
  const severity = requiredText(value.severity, `${field}.severity`, 32);
  if (!['info', 'warning', 'blocking'].includes(severity)) {
    fail('FORECAST_DIAGNOSTIC_SEVERITY_INVALID', `${field}.severity is invalid.`, `${field}.severity`, 400);
  }
  let affectedStartDate = null;
  let affectedEndDateExclusive = null;
  if (value.affectedStartDate != null || value.affectedEndDateExclusive != null) {
    [affectedStartDate, affectedEndDateExclusive] = interval(
      value.affectedStartDate,
      value.affectedEndDateExclusive,
      `${field}.affectedStartDate`,
      `${field}.affectedEndDateExclusive`,
    );
  }
  return Object.freeze({
    inputIndex: value.inputIndex == null
      ? null
      : (() => {
          if (!Number.isSafeInteger(value.inputIndex) || value.inputIndex < 0) {
            fail('FORECAST_INPUT_INDEX_INVALID', `${field}.inputIndex is invalid.`, `${field}.inputIndex`, 400);
          }
          return value.inputIndex;
        })(),
    rentalLineId: optionalId(value.rentalLineId, `${field}.rentalLineId`),
    componentKind: optionalText(value.componentKind, `${field}.componentKind`, 80),
    affectedStartDate,
    affectedEndDateExclusive,
    severity,
    reasonCode: requiredText(value.reasonCode, `${field}.reasonCode`, 120),
    sourceIdentity: optionalId(value.sourceIdentity, `${field}.sourceIdentity`),
    sourceHash: value.sourceHash == null ? null : hash64(value.sourceHash, `${field}.sourceHash`),
    policyRef: optionalId(value.policyRef, `${field}.policyRef`),
  });
}

function normalizeCalculatedSlice(value, index) {
  const field = `calculatedSlices[${index}]`;
  assertExactKeys(value, new Set([
    'inputIndex', 'coverageStartDate', 'coverageEndDateExclusive', 'calculationVersion',
    'calculationPolicyRef', 'vatPolicyRef', 'roundingPolicyRef', 'policyDecisionRef',
    'confidencePolicyVersion', 'coveragePolicyVersion', 'netAmountMinor', 'vatAmountMinor',
    'grossAmountMinor', 'confidence', 'reasonCodes', 'normalizedCalculationEvidence',
  ]), field);
  if (!Number.isSafeInteger(value.inputIndex) || value.inputIndex < 0) {
    fail('FORECAST_INPUT_INDEX_INVALID', `${field}.inputIndex is invalid.`, `${field}.inputIndex`, 400);
  }
  const [coverageStartDate, coverageEndDateExclusive] = interval(
    value.coverageStartDate,
    value.coverageEndDateExclusive,
    `${field}.coverageStartDate`,
    `${field}.coverageEndDateExclusive`,
  );
  const netAmountMinor = moneyMinor(value.netAmountMinor, `${field}.netAmountMinor`);
  const vatAmountMinor = moneyMinor(value.vatAmountMinor, `${field}.vatAmountMinor`);
  const grossAmountMinor = moneyMinor(value.grossAmountMinor, `${field}.grossAmountMinor`);
  if (safeAdd([netAmountMinor, vatAmountMinor], `${field}.grossAmountMinor`) !== grossAmountMinor) {
    fail('FORECAST_RECONCILIATION_FAILED', 'net + VAT must equal gross.', `${field}.grossAmountMinor`, 400);
  }
  const confidence = requiredText(value.confidence, `${field}.confidence`, 32);
  if (!CONFIDENCE_LEVELS.has(confidence) || confidence === 'insufficient') {
    fail('FORECAST_CALCULATED_CONFIDENCE_INVALID', 'Monetary items require high, medium, or low confidence.', `${field}.confidence`, 400);
  }
  const evidence = materializeInert(value.normalizedCalculationEvidence, `${field}.normalizedCalculationEvidence`);
  if (!evidence || typeof evidence !== 'object' || Array.isArray(evidence)) {
    fail('FORECAST_POLICY_EVIDENCE_INVALID', 'Normalized calculation evidence must be an object.', `${field}.normalizedCalculationEvidence`, 400);
  }
  return Object.freeze({
    inputIndex: value.inputIndex,
    coverageStartDate,
    coverageEndDateExclusive,
    calculationVersion: requiredId(value.calculationVersion, `${field}.calculationVersion`),
    calculationPolicyRef: requiredId(value.calculationPolicyRef, `${field}.calculationPolicyRef`),
    vatPolicyRef: requiredId(value.vatPolicyRef, `${field}.vatPolicyRef`),
    roundingPolicyRef: requiredId(value.roundingPolicyRef, `${field}.roundingPolicyRef`),
    policyDecisionRef: requiredId(value.policyDecisionRef, `${field}.policyDecisionRef`),
    confidencePolicyVersion: requiredId(value.confidencePolicyVersion, `${field}.confidencePolicyVersion`),
    coveragePolicyVersion: requiredId(value.coveragePolicyVersion, `${field}.coveragePolicyVersion`),
    netAmountMinor,
    vatAmountMinor,
    grossAmountMinor,
    confidence,
    reasonCodes: reasonCodes(value.reasonCodes, `${field}.reasonCodes`, { required: true }),
    normalizedCalculationEvidence: evidence,
  });
}

function createPreparedForecastPlan(commandPlan, evaluation) {
  if (!FORECAST_COMMAND_PLANS.has(commandPlan)) {
    fail('FORECAST_COMMAND_PLAN_REJECTED', 'A branded forecast command plan is required.', 'command', 403);
  }
  const inert = materializeInert(evaluation, 'evaluation');
  assertExactKeys(inert, new Set([
    'planningSeriesKey', 'horizonStartDate', 'horizonEndDateExclusive', 'calculationVersion',
    'confidencePolicyVersion', 'coveragePolicyVersion', 'calculatedSlices', 'diagnostics',
  ]), 'evaluation');
  const [horizonStartDate, horizonEndDateExclusive] = interval(
    inert.horizonStartDate,
    inert.horizonEndDateExclusive,
    'evaluation.horizonStartDate',
    'evaluation.horizonEndDateExclusive',
  );
  if (
    horizonStartDate !== commandPlan.asOfDate
    || horizonEndDateExclusive !== addCivilDays(commandPlan.asOfDate, FORECAST_HORIZON_DAYS)
  ) fail('FORECAST_HORIZON_INVALID', 'Forecast horizon must be the fixed 30-day civil interval.', 'evaluation.horizonEndDateExclusive', 400);
  const calculatedSlices = Object.freeze(inert.calculatedSlices.map(normalizeCalculatedSlice));
  const diagnostics = Object.freeze(inert.diagnostics.map(normalizeDiagnostic));
  if (calculatedSlices.some(slice => slice.inputIndex >= commandPlan.inputs.length)) {
    fail('FORECAST_INPUT_INDEX_INVALID', 'Calculated slice references an unavailable input.', 'calculatedSlices', 400);
  }
  for (const diagnostic of diagnostics) {
    if (diagnostic.inputIndex == null) {
      if (
        diagnostic.rentalLineId != null
        || diagnostic.componentKind != null
        || diagnostic.affectedStartDate != null
        || diagnostic.affectedEndDateExclusive != null
        || diagnostic.sourceIdentity != null
        || diagnostic.sourceHash != null
      ) fail('FORECAST_INPUT_INDEX_INVALID', 'Global diagnostics cannot carry input lineage.', 'diagnostics', 400);
      continue;
    }
    const input = commandPlan.inputs[diagnostic.inputIndex];
    if (
      !input
      || diagnostic.rentalLineId !== input.rentalLineId
      || diagnostic.componentKind !== input.componentKind
      || diagnostic.affectedStartDate == null
      || diagnostic.affectedStartDate < input.candidateStartDate
      || diagnostic.affectedEndDateExclusive > input.candidateEndDateExclusive
      || diagnostic.sourceIdentity !== input.sourceIdentity
      || diagnostic.sourceHash !== input.sourceHash
    ) fail('FORECAST_INPUT_INDEX_INVALID', 'Diagnostic input lineage is invalid.', 'diagnostics', 400);
  }
  const prepared = Object.freeze({
    ...commandPlan,
    planningSeriesKey: hash64(inert.planningSeriesKey, 'evaluation.planningSeriesKey'),
    horizonStartDate,
    horizonEndDateExclusive,
    calculationVersion: requiredId(inert.calculationVersion, 'evaluation.calculationVersion'),
    confidencePolicyVersion: requiredId(inert.confidencePolicyVersion, 'evaluation.confidencePolicyVersion'),
    coveragePolicyVersion: requiredId(inert.coveragePolicyVersion, 'evaluation.coveragePolicyVersion'),
    calculatedSlices,
    diagnostics,
  });
  FORECAST_PREPARED_PLANS.add(prepared);
  return prepared;
}

function createForecastReceivablesCommandContext(platformScope) {
  const inert = materializeInert(platformScope, 'platformScope');
  if (
    inert?.authenticated !== true
    || inert.principalType !== 'user'
    || !Array.isArray(inert.capabilities)
    || !Array.isArray(inert.allowedBranchIds)
  ) fail('FORECAST_SCOPE_REJECTED', 'A trusted PR5 real-user scope is required.', 'platformScope', 403);
  const context = Object.freeze({
    authenticated: true,
    principalType: 'user',
    principalId: requiredId(inert.principalId, 'platformScope.principalId'),
    companyId: requiredId(inert.companyId, 'platformScope.companyId'),
    companyTimezone: assertIanaTimezone(inert.companyTimezone, 'platformScope.companyTimezone'),
    membershipId: requiredId(inert.membershipId, 'platformScope.membershipId'),
    membershipVersion: requiredVersion(inert.membershipVersion, 'platformScope.membershipVersion'),
    roleTemplateKey: requiredId(inert.roleTemplateKey, 'platformScope.roleTemplateKey'),
    roleTemplateVersion: requiredVersion(inert.roleTemplateVersion, 'platformScope.roleTemplateVersion'),
    capabilityCatalogVersion: requiredVersion(inert.capabilityCatalogVersion, 'platformScope.capabilityCatalogVersion'),
    capabilities: Object.freeze([...new Set(inert.capabilities.map((item, index) => requiredId(item, `platformScope.capabilities[${index}]`)))].sort()),
    companyWideBranchAuthority: inert.companyWideBranchAuthority === true,
    allowedBranchIds: Object.freeze([...new Set(inert.allowedBranchIds.map((item, index) => requiredId(item, `platformScope.allowedBranchIds[${index}]`)))].sort()),
  });
  FORECAST_COMMAND_CONTEXTS.add(context);
  return context;
}

function assertForecastCommandContext(context) {
  if (!context || !FORECAST_COMMAND_CONTEXTS.has(context)) {
    fail('FORECAST_COMMAND_CONTEXT_REJECTED', 'A branded PR7 command context is required.', 'context', 403);
  }
  return context;
}

function assertPreparedForecastPlan(plan) {
  if (!plan || !FORECAST_PREPARED_PLANS.has(plan)) {
    fail('FORECAST_PREPARED_PLAN_REJECTED', 'A branded prepared forecast plan is required.', 'plan', 403);
  }
  return plan;
}

function buildForecastHorizon(asOfDate, companyTimezone) {
  assertIanaTimezone(companyTimezone);
  const horizonStartDate = civilDate(asOfDate, 'asOfDate');
  return Object.freeze({
    horizonStartDate,
    horizonEndDateExclusive: addCivilDays(horizonStartDate, FORECAST_HORIZON_DAYS),
    horizonDays: FORECAST_HORIZON_DAYS,
    companyTimezone,
  });
}

function computePlanningSeriesKey(companyId, branchId) {
  return fingerprint({
    companyId: requiredId(companyId, 'companyId'),
    branchId: requiredId(branchId, 'branchId'),
    seriesKind: 'forecast_receivables_open_period',
    seriesVersion: 1,
  });
}

function computeForecastCoverageKey(value) {
  const normalized = materializeInert(value, 'coverageKeyInput');
  assertExactKeys(normalized, new Set([
    'companyId', 'branchId', 'contractId', 'rentalId', 'rentalLineId', 'componentKind',
    'coverageStartDate', 'coverageEndDateExclusive', 'effectiveTermsVersionId',
    'calculationVersion', 'coveragePolicyVersion',
  ]), 'coverageKeyInput');
  return fingerprint(normalized);
}

module.exports = {
  AUTHORITY_STATUSES,
  COMPONENT_KINDS,
  CONFIDENCE_LEVELS,
  EVENT_KINDS,
  FORECAST_COMMAND_MAX_BYTES,
  FORECAST_COMMAND_MAX_DEPTH,
  FORECAST_COMMAND_MAX_NODES,
  FORECAST_CURRENCY,
  FORECAST_HORIZON_DAYS,
  FORECAST_INPUT_CONTRACT_VERSION,
  FORECAST_RECEIVABLES_SCHEMA_VERSION,
  ForecastReceivablesPlanningError,
  PRIMARY_RENTAL_STATUSES,
  REQUIRED_MANIFEST_EVENT_KINDS,
  addCivilDays,
  assertForecastCommandContext,
  assertIanaTimezone,
  assertPreparedForecastPlan,
  buildForecastHorizon,
  civilDate,
  computeForecastCoverageKey,
  computePlanningSeriesKey,
  createForecastReceivablesCommandContext,
  createPreparedForecastPlan,
  fail,
  fingerprint,
  hash64,
  materializeForecastCalculationCommand,
  materializeInert,
  moneyMinor,
  reasonCodes,
  requiredId,
  safeAdd,
  sha256,
  stableJson,
};
