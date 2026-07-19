const crypto = require('crypto');
const { types } = require('util');
const { FORBIDDEN_BRANCH_IDS } = require('./platform-identity-repository');

const ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION = 1;
const ACTUAL_SOURCE_DRY_RUN_EVALUATOR_VERSION = 'actual-source-eligibility-evaluator-v1';
const ACTUAL_SOURCE_DRY_RUN_MAX_DEPTH = 32;
const ACTUAL_SOURCE_DRY_RUN_MAX_NODES = 20_000;
const ACTUAL_SOURCE_DRY_RUN_MAX_BYTES = 1024 * 1024;
const ACTUAL_SOURCE_DRY_RUN_CURRENCY = 'RUB';

const ACTUAL_SOURCE_CONTEXTS = new WeakSet();
const ACTUAL_SOURCE_COMMAND_PLANS = new WeakSet();
const ACTUAL_SOURCE_EXECUTION_PLANS = new WeakSet();

const GATE_KEYS = Object.freeze([
  'accounting_source_sufficiency',
  'canonical_amount_basis',
  'conducted_evidence',
  'client_signature_requirement',
  'contractual_due_date',
  'unknown_due_date_treatment',
  'vat_selection',
  'vat_basis',
  'rounding_mode_and_order',
  'rounding_residual_allocation',
  'operational_event_authority',
  'correction_cancellation_reopen_effect',
  'activation_boundary',
  'activation_cohort',
  'source_adapter_authority',
]);
const GATE_KEY_SET = new Set(GATE_KEYS);
const GATE_STATUSES = new Set(['approved_by_reference', 'unresolved', 'rejected']);
const CHECK_OUTCOMES = new Set(['passed', 'blocked', 'not_applicable']);
const CANDIDATE_STATUSES = new Set(['eligible_candidate', 'blocked']);
const RUN_STATUSES = new Set(['completed', 'completed_with_blockers', 'completed_no_candidates']);

const BLOCKING_CODES = Object.freeze([
  'ACCOUNTING_SOURCE_SUFFICIENCY_UNRESOLVED',
  'CANONICAL_AMOUNT_BASIS_UNRESOLVED',
  'CONDUCTED_EVIDENCE_POLICY_UNRESOLVED',
  'CONDUCTED_EVIDENCE_MISSING',
  'SIGNATURE_REQUIREMENT_UNRESOLVED',
  'REQUIRED_SIGNATURE_EVIDENCE_MISSING',
  'DUE_DATE_POLICY_UNRESOLVED',
  'UNKNOWN_DUE_DATE_POLICY_UNRESOLVED',
  'VAT_POLICY_UNRESOLVED',
  'VAT_POLICY_MISMATCH',
  'ROUNDING_POLICY_UNRESOLVED',
  'ROUNDING_POLICY_MISMATCH',
  'RESIDUAL_ALLOCATION_POLICY_UNRESOLVED',
  'OPERATIONAL_EVENT_AUTHORITY_UNRESOLVED',
  'ACTIVATION_BOUNDARY_UNRESOLVED',
  'ACTIVATION_COHORT_UNRESOLVED',
  'SOURCE_ADAPTER_AUTHORITY_UNRESOLVED',
  'PARTIAL_GOVERNED_PERIOD',
  'HISTORICAL_IMPORT_FORBIDDEN',
  'PERIOD_NOT_CURRENTLY_CLOSED',
  'PERIOD_REOPENED',
  'SNAPSHOT_INTEGRITY_BLOCKED',
  'SOURCE_EVIDENCE_INCOMPLETE',
  'SOURCE_EVIDENCE_REJECTED',
  'UPD_NOT_CURRENTLY_CONDUCTED',
  'UPD_CORRECTED_OR_CANCELLED',
  'CORRECTION_TREATMENT_UNRESOLVED',
  'COVERAGE_MISSING',
  'COVERAGE_NOT_ACTIVE_VALIDATED',
  'COVERAGE_SCOPE_MISMATCH',
  'DUPLICATE_ECONOMIC_COVERAGE',
  'NET_DELTA_NON_ZERO',
  'VAT_DELTA_NON_ZERO',
  'GROSS_DELTA_NON_ZERO',
  'SOURCE_VERSION_DRIFT',
  'SOURCE_HASH_DRIFT',
  'POLICY_MANIFEST_DRIFT',
  'UNSUPPORTED_CURRENCY',
  'NON_POSITIVE_CANDIDATE_AMOUNT',
  'MONEY_OVERFLOW',
]);

const SECRET_KEY_FRAGMENTS = Object.freeze([
  'password', 'passwd', 'secret', 'token', 'credential', 'authorization', 'cookie',
  'session', 'apikey', 'privatekey', 'webhook',
]);

class ActualSourceEligibilityDryRunError extends Error {
  constructor(code, message, field, status = 409) {
    super(message);
    this.name = 'ActualSourceEligibilityDryRunError';
    this.code = code;
    this.field = field;
    this.status = status;
  }
}

function fail(code, message, field, status) {
  throw new ActualSourceEligibilityDryRunError(code, message, field, status);
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
    'ACTUAL_SOURCE_INPUT_NOT_INERT',
    'Actual-source dry-run inputs must be deeply inert plain JSON data.',
    field,
    400,
  );
}

function assertNotSecretKey(key, field) {
  const normalized = String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
  if (SECRET_KEY_FRAGMENTS.some(fragment => normalized.includes(fragment))) {
    fail('ACTUAL_SOURCE_SECRET_FIELD_REJECTED', 'Secret-bearing fields are forbidden.', field, 400);
  }
}

function addInertBytes(state, value, field) {
  state.bytes += Buffer.byteLength(value, 'utf8');
  if (state.bytes > ACTUAL_SOURCE_DRY_RUN_MAX_BYTES) {
    fail(
      'ACTUAL_SOURCE_INPUT_MAX_BYTES',
      'Actual-source dry-run input exceeds the inert JSON byte budget.',
      field,
      400,
    );
  }
}

function materializeInertValue(value, field, depth, ancestors, state) {
  if (depth > ACTUAL_SOURCE_DRY_RUN_MAX_DEPTH) inertFailure(field);
  state.nodes += 1;
  if (state.nodes > ACTUAL_SOURCE_DRY_RUN_MAX_NODES) inertFailure(field);

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
    fail('ACTUAL_SOURCE_OBJECT_REQUIRED', `${field} must be an object.`, field, 400);
  }
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown) {
    fail('ACTUAL_SOURCE_UNKNOWN_FIELD', `${field}.${unknown} is not supported.`, `${field}.${unknown}`, 400);
  }
  return value;
}

function requiredText(value, field, max = 512) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('ACTUAL_SOURCE_REQUIRED', `${field} is required.`, field, 400);
  }
  const normalized = value.trim();
  if (normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    fail('ACTUAL_SOURCE_INVALID_TEXT', `${field} is invalid.`, field, 400);
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
    fail('ACTUAL_SOURCE_INVALID_VERSION', `${field} must be a positive safe integer.`, field, 400);
  }
  return value;
}

function hash64(value, field) {
  const normalized = requiredText(value, field, 64);
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    fail('ACTUAL_SOURCE_INVALID_HASH', `${field} must be lowercase SHA-256 hex.`, field, 400);
  }
  return normalized;
}

function civilDate(value, field) {
  const normalized = requiredText(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fail('ACTUAL_SOURCE_INVALID_DATE', `${field} must be YYYY-MM-DD.`, field, 400);
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) fail('ACTUAL_SOURCE_INVALID_DATE', `${field} is not a civil calendar date.`, field, 400);
  return normalized;
}

function assertIanaTimezone(value, field = 'companyTimezone') {
  const timezone = requiredText(value, field, 120);
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
  } catch {
    fail('ACTUAL_SOURCE_INVALID_TIMEZONE', `${field} must be an IANA timezone.`, field, 400);
  }
  return timezone;
}

function moneyMinor(value, field, { positive = false } = {}) {
  if (!Number.isSafeInteger(value) || value < 0 || (positive && value === 0)) {
    fail('ACTUAL_SOURCE_INVALID_MONEY', `${field} must be safe integer minor units.`, field, 400);
  }
  return value;
}

function safeAdd(values, field = 'money') {
  let total = 0;
  for (const value of values) {
    moneyMinor(value, field);
    total += value;
    if (!Number.isSafeInteger(total)) {
      fail('MONEY_OVERFLOW', `${field} exceeds the safe integer range.`, field, 409);
    }
  }
  return total;
}

function sortedUniqueCodes(value, field, { required = false } = {}) {
  if (!Array.isArray(value)) {
    fail('ACTUAL_SOURCE_REASON_CODES_REQUIRED', `${field} must be an array.`, field, 400);
  }
  const normalized = value.map((item, index) => requiredText(item, `${field}[${index}]`, 120));
  if (new Set(normalized).size !== normalized.length) {
    fail('ACTUAL_SOURCE_DUPLICATE_REASON_CODE', `${field} contains duplicates.`, field, 400);
  }
  if (required && normalized.length === 0) {
    fail('ACTUAL_SOURCE_REASON_CODES_REQUIRED', `${field} cannot be empty.`, field, 400);
  }
  return Object.freeze([...normalized].sort());
}

function normalizeGateScope(value, field) {
  if (value === undefined || value === null) return null;
  assertExactKeys(value, new Set(['companyId', 'branchId', 'contractId']), field);
  return Object.freeze({
    companyId: optionalId(value.companyId, `${field}.companyId`),
    branchId: optionalId(value.branchId, `${field}.branchId`),
    contractId: optionalId(value.contractId, `${field}.contractId`),
  });
}

function unresolvedGate(key) {
  return Object.freeze({
    key,
    status: 'unresolved',
    decisionRef: null,
    decisionVersion: null,
    decisionHash: null,
    schemaVersion: 1,
    scope: null,
    decisionValue: null,
    expectedSourceRef: null,
  });
}

function normalizeGate(value, index) {
  const field = `policyManifest.gates[${index}]`;
  assertExactKeys(value, new Set([
    'key', 'status', 'decisionRef', 'decisionVersion', 'decisionHash', 'schemaVersion',
    'scope', 'decisionValue', 'expectedSourceRef',
  ]), field);
  const key = requiredId(value.key, `${field}.key`);
  if (!GATE_KEY_SET.has(key)) {
    fail('ACTUAL_SOURCE_UNKNOWN_GATE', `${field}.key is not supported.`, `${field}.key`, 400);
  }
  const status = requiredId(value.status, `${field}.status`);
  if (!GATE_STATUSES.has(status)) {
    fail('ACTUAL_SOURCE_GATE_STATUS_INVALID', `${field}.status is invalid.`, `${field}.status`, 400);
  }
  const schemaVersion = value.schemaVersion === undefined
    ? 1
    : requiredVersion(value.schemaVersion, `${field}.schemaVersion`);
  if (schemaVersion !== 1) {
    fail('ACTUAL_SOURCE_GATE_SCHEMA_INVALID', `${field}.schemaVersion is unsupported.`, `${field}.schemaVersion`, 400);
  }
  const decisionRef = optionalId(value.decisionRef, `${field}.decisionRef`);
  const decisionVersion = value.decisionVersion == null
    ? null
    : requiredVersion(value.decisionVersion, `${field}.decisionVersion`);
  const decisionHash = value.decisionHash == null
    ? null
    : hash64(value.decisionHash, `${field}.decisionHash`);
  const scope = normalizeGateScope(value.scope, `${field}.scope`);
  const decisionValue = optionalId(value.decisionValue, `${field}.decisionValue`);
  const expectedSourceRef = optionalId(value.expectedSourceRef, `${field}.expectedSourceRef`);
  if (
    status === 'approved_by_reference'
    && (!decisionRef || !decisionVersion || !decisionHash)
  ) {
    return unresolvedGate(key);
  }
  if (
    status !== 'approved_by_reference'
    && (decisionRef || decisionVersion || decisionHash || decisionValue || expectedSourceRef)
  ) {
    fail(
      'ACTUAL_SOURCE_UNRESOLVED_GATE_CONTENT_REJECTED',
      'Unresolved or rejected gates cannot carry approval content.',
      field,
      400,
    );
  }
  return Object.freeze({
    key,
    status,
    decisionRef,
    decisionVersion,
    decisionHash,
    schemaVersion,
    scope,
    decisionValue,
    expectedSourceRef,
  });
}

function normalizePolicyManifest(value) {
  if (value === undefined || value === null) {
    const gates = Object.freeze(GATE_KEYS.map(unresolvedGate));
    return Object.freeze({
      manifestId: 'production-policy-registry-unavailable',
      manifestVersion: 1,
      schemaVersion: 1,
      gates,
    });
  }
  assertExactKeys(value, new Set(['manifestId', 'manifestVersion', 'schemaVersion', 'gates']), 'policyManifest');
  if (!Array.isArray(value.gates)) {
    fail('ACTUAL_SOURCE_GATE_ARRAY_REQUIRED', 'policyManifest.gates must be an array.', 'policyManifest.gates', 400);
  }
  const supplied = value.gates.map(normalizeGate);
  const identities = supplied.map(gate => gate.key);
  if (new Set(identities).size !== identities.length) {
    fail('ACTUAL_SOURCE_DUPLICATE_GATE', 'policyManifest.gates contains duplicate identities.', 'policyManifest.gates', 400);
  }
  const byKey = new Map(supplied.map(gate => [gate.key, gate]));
  const gates = Object.freeze(GATE_KEYS.map(key => byKey.get(key) || unresolvedGate(key)));
  const schemaVersion = requiredVersion(value.schemaVersion, 'policyManifest.schemaVersion');
  if (schemaVersion !== 1) {
    fail('ACTUAL_SOURCE_POLICY_SCHEMA_INVALID', 'policyManifest.schemaVersion is unsupported.', 'policyManifest.schemaVersion', 400);
  }
  return Object.freeze({
    manifestId: requiredId(value.manifestId, 'policyManifest.manifestId'),
    manifestVersion: requiredVersion(value.manifestVersion, 'policyManifest.manifestVersion'),
    schemaVersion,
    gates,
  });
}

function materializeActualSourceDryRunCommand(input) {
  const inert = materializeInert(input, 'command');
  assertExactKeys(inert, new Set([
    'branchId', 'asOfDate', 'idempotencyKey', 'correlationId', 'policyManifest',
    'expectedInputSetHash', 'expectedPolicyManifestHash', 'reasonCode', 'reasonText',
  ]), 'command');
  const branchId = requiredId(inert.branchId, 'branchId');
  if (FORBIDDEN_BRANCH_IDS.has(branchId.toLowerCase())) {
    fail('ACTUAL_SOURCE_BRANCH_SCOPE_REJECTED', 'A concrete branch is required.', 'branchId', 404);
  }
  const policyManifest = normalizePolicyManifest(inert.policyManifest);
  const plan = Object.freeze({
    branchId,
    asOfDate: civilDate(inert.asOfDate, 'asOfDate'),
    idempotencyKey: requiredId(inert.idempotencyKey, 'idempotencyKey'),
    correlationId: requiredId(inert.correlationId, 'correlationId'),
    policyManifest,
    policyManifestHash: fingerprint(policyManifest),
    expectedInputSetHash: inert.expectedInputSetHash == null
      ? null
      : hash64(inert.expectedInputSetHash, 'expectedInputSetHash'),
    expectedPolicyManifestHash: inert.expectedPolicyManifestHash == null
      ? null
      : hash64(inert.expectedPolicyManifestHash, 'expectedPolicyManifestHash'),
    reasonCode: requiredText(inert.reasonCode, 'reasonCode', 120),
    reasonText: requiredText(inert.reasonText, 'reasonText', 1000),
    evaluatorVersion: ACTUAL_SOURCE_DRY_RUN_EVALUATOR_VERSION,
    schemaVersion: ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION,
  });
  if (
    plan.expectedPolicyManifestHash
    && plan.expectedPolicyManifestHash !== plan.policyManifestHash
  ) {
    fail(
      'POLICY_MANIFEST_DRIFT',
      'Expected policy manifest hash does not match repository-owned normalization.',
      'expectedPolicyManifestHash',
      409,
    );
  }
  ACTUAL_SOURCE_COMMAND_PLANS.add(plan);
  return plan;
}

function createActualSourceDryRunContext(platformScope) {
  const inert = materializeInert(platformScope, 'platformScope');
  if (
    inert?.authenticated !== true
    || inert.principalType !== 'user'
    || !Array.isArray(inert.capabilities)
    || !Array.isArray(inert.allowedBranchIds)
  ) fail('ACTUAL_SOURCE_SCOPE_REJECTED', 'A trusted PR5 real-user scope is required.', 'platformScope', 403);
  const capabilities = Object.freeze([...new Set(
    inert.capabilities.map((item, index) => requiredId(item, `platformScope.capabilities[${index}]`)),
  )].sort());
  if (!capabilities.includes('receivables.read')) {
    fail('ACTUAL_SOURCE_SCOPE_REJECTED', 'receivables.read is required.', 'platformScope.capabilities', 403);
  }
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
    capabilityCatalogVersion: requiredVersion(
      inert.capabilityCatalogVersion,
      'platformScope.capabilityCatalogVersion',
    ),
    capabilities,
    companyWideBranchAuthority: inert.companyWideBranchAuthority === true,
    allowedBranchIds: Object.freeze([...new Set(
      inert.allowedBranchIds.map((item, index) => requiredId(item, `platformScope.allowedBranchIds[${index}]`)),
    )].sort()),
  });
  ACTUAL_SOURCE_CONTEXTS.add(context);
  return context;
}

function assertActualSourceDryRunContext(context) {
  if (!context || !ACTUAL_SOURCE_CONTEXTS.has(context)) {
    fail('ACTUAL_SOURCE_CONTEXT_REJECTED', 'A branded PR8 command context is required.', 'context', 403);
  }
  return context;
}

function assertActualSourceCommandPlan(plan) {
  if (!plan || !ACTUAL_SOURCE_COMMAND_PLANS.has(plan)) {
    fail('ACTUAL_SOURCE_COMMAND_PLAN_REJECTED', 'A branded PR8 command plan is required.', 'plan', 403);
  }
  return plan;
}

function createActualSourceExecutionPlan(commandPlan, universe, evaluation) {
  assertActualSourceCommandPlan(commandPlan);
  if (!universe || typeof universe !== 'object' || !Array.isArray(universe.inputs)) {
    fail('ACTUAL_SOURCE_UNIVERSE_REJECTED', 'A repository-owned source universe is required.', 'universe', 500);
  }
  if (!evaluation || typeof evaluation !== 'object' || !Array.isArray(evaluation.candidates)) {
    fail('ACTUAL_SOURCE_EVALUATION_REJECTED', 'A deterministic source evaluation is required.', 'evaluation', 500);
  }
  const plan = Object.freeze({
    ...commandPlan,
    sourceInputManifest: universe.manifest,
    sourceInputManifestHash: universe.inputSetHash,
    sourceInputs: Object.freeze(universe.inputs),
    candidates: Object.freeze(evaluation.candidates),
    checks: Object.freeze(evaluation.checks),
    reconciliations: Object.freeze(evaluation.reconciliations),
    diagnostics: Object.freeze(evaluation.diagnostics),
    result: Object.freeze(evaluation.result),
  });
  ACTUAL_SOURCE_COMMAND_PLANS.add(plan);
  ACTUAL_SOURCE_EXECUTION_PLANS.add(plan);
  return plan;
}

function assertActualSourceExecutionPlan(plan) {
  if (!plan || !ACTUAL_SOURCE_EXECUTION_PLANS.has(plan)) {
    fail('ACTUAL_SOURCE_EXECUTION_PLAN_REJECTED', 'A branded immutable PR8 execution plan is required.', 'plan', 403);
  }
  return plan;
}

function assertCandidateStatus(value, field = 'status') {
  if (!CANDIDATE_STATUSES.has(value)) fail('ACTUAL_SOURCE_CANDIDATE_STATUS_INVALID', `${field} is invalid.`, field, 500);
  return value;
}

function assertCheckOutcome(value, field = 'outcome') {
  if (!CHECK_OUTCOMES.has(value)) fail('ACTUAL_SOURCE_CHECK_OUTCOME_INVALID', `${field} is invalid.`, field, 500);
  return value;
}

function assertRunStatus(value, field = 'status') {
  if (!RUN_STATUSES.has(value)) fail('ACTUAL_SOURCE_RUN_STATUS_INVALID', `${field} is invalid.`, field, 500);
  return value;
}

module.exports = {
  ACTUAL_SOURCE_DRY_RUN_CURRENCY,
  ACTUAL_SOURCE_DRY_RUN_EVALUATOR_VERSION,
  ACTUAL_SOURCE_DRY_RUN_MAX_BYTES,
  ACTUAL_SOURCE_DRY_RUN_MAX_DEPTH,
  ACTUAL_SOURCE_DRY_RUN_MAX_NODES,
  ACTUAL_SOURCE_DRY_RUN_SCHEMA_VERSION,
  ActualSourceEligibilityDryRunError,
  BLOCKING_CODES,
  CANDIDATE_STATUSES,
  CHECK_OUTCOMES,
  GATE_KEYS,
  GATE_STATUSES,
  RUN_STATUSES,
  assertActualSourceCommandPlan,
  assertActualSourceDryRunContext,
  assertActualSourceExecutionPlan,
  assertCandidateStatus,
  assertCheckOutcome,
  assertRunStatus,
  civilDate,
  createActualSourceDryRunContext,
  createActualSourceExecutionPlan,
  fail,
  fingerprint,
  hash64,
  materializeActualSourceDryRunCommand,
  materializeInert,
  moneyMinor,
  normalizePolicyManifest,
  requiredId,
  requiredVersion,
  safeAdd,
  sha256,
  sortedUniqueCodes,
  stableJson,
};
