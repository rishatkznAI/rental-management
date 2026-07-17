const crypto = require('crypto');
const { types } = require('util');
const {
  FORBIDDEN_BRANCH_IDS,
} = require('./platform-identity-repository');

const BILLING_SOURCE_SCHEMA_VERSION = 1;
const COMMAND_PLAN_MAX_DEPTH = 32;
const COMMAND_PLAN_MAX_NODES = 10_000;
const COMMAND_PLAN_MAX_BYTES = 512 * 1024;
const AUDIT_METADATA_MAX_BYTES = 32 * 1024;
const BILLING_SOURCE_COMMAND_CONTEXTS = new WeakSet();
const BILLING_SOURCE_COMMAND_PLANS = new WeakSet();

const OPERATION_CAPABILITIES = Object.freeze({
  close_billing_period: 'billing.period.close',
  reopen_billing_period: 'billing.period.reopen',
  form_upd: 'upd.form',
  record_upd_coverage: 'upd.form',
  conduct_upd: 'upd.conduct',
  correct_upd: 'upd.correct',
});

const STABLE_IDENTITY_KINDS = new Set([
  'source_system_line_id',
  'source_event_line_id',
  'generated_forward_line_id',
]);
const FORBIDDEN_IDENTITY_KINDS = new Set([
  'array_index',
  'document_position',
  'display_name',
  'equipment_name',
  'inventory_label',
  'description',
  'manager_name',
  'client_name',
  'line_label',
]);
const SOURCE_INTEGRITY_STATUSES = new Set(['matched', 'blocked']);
const EVIDENCE_TYPES = new Set([
  'rental',
  'effective_terms',
  'return',
  'downtime',
  'extension',
  'contract',
  'calculation_policy',
  'vat_policy',
  'rounding_policy',
  'other_explicit',
]);
const EVIDENCE_AUTHORITY_STATUSES = new Set(['approved_by_reference', 'unresolved', 'rejected']);
const DUE_DATE_PROVENANCE = new Set([
  'invoice_due_date',
  'contractual_payment_due_date',
  'installment_due_date',
  'unknown',
]);
const SECRET_KEY_FRAGMENTS = Object.freeze([
  'password', 'passwd', 'secret', 'token', 'credential', 'authorization', 'cookie',
  'session', 'apikey', 'privatekey',
]);

class BillingSourceAuthorityError extends Error {
  constructor(code, message, field, status = 409) {
    super(message);
    this.name = 'BillingSourceAuthorityError';
    this.code = code;
    this.field = field;
    this.status = status;
  }
}

function fail(code, message, field, status) {
  throw new BillingSourceAuthorityError(code, message, field, status);
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

function normalizedSecurityKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function assertNotSecretKey(key, field) {
  const normalized = normalizedSecurityKey(key);
  if (SECRET_KEY_FRAGMENTS.some(fragment => normalized.includes(fragment))) {
    fail('BILLING_SOURCE_SECRET_FIELD_REJECTED', 'Secret-bearing fields are forbidden.', field, 400);
  }
}

function inertFailure(field = 'command') {
  fail(
    'BILLING_SOURCE_COMMAND_NOT_INERT',
    'Billing source commands must be deeply inert plain JSON data.',
    field,
    400,
  );
}

function addBytes(state, bytes, field) {
  state.bytes += bytes;
  if (state.bytes > COMMAND_PLAN_MAX_BYTES) inertFailure(field);
}

function materializeInertValue(value, field, depth, ancestors, state) {
  if (depth > COMMAND_PLAN_MAX_DEPTH) inertFailure(field);
  state.nodes += 1;
  if (state.nodes > COMMAND_PLAN_MAX_NODES) inertFailure(field);

  if (value === null) {
    addBytes(state, 4, field);
    return null;
  }
  if (typeof value === 'string') {
    addBytes(state, Buffer.byteLength(value, 'utf8') + 2, field);
    return value;
  }
  if (typeof value === 'boolean') {
    addBytes(state, value ? 4 : 5, field);
    return value;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value) || !Number.isSafeInteger(value)) inertFailure(field);
    addBytes(state, String(value).length, field);
    return value;
  }
  if (typeof value !== 'object') inertFailure(field);
  if (types.isProxy(value)) inertFailure(field);
  if (ancestors.has(value)) inertFailure(field);
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
      const lengthDescriptor = descriptors.length;
      if (
        !lengthDescriptor
        || lengthDescriptor.enumerable
        || !Object.prototype.hasOwnProperty.call(lengthDescriptor, 'value')
        || !Number.isSafeInteger(lengthDescriptor.value)
        || lengthDescriptor.value < 0
      ) inertFailure(field);
      const length = lengthDescriptor.value;
      const propertyNames = Object.keys(descriptors).filter(key => key !== 'length');
      if (propertyNames.length !== length) inertFailure(field);
      const result = [];
      addBytes(state, 2, field);
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (
          !descriptor
          || !descriptor.enumerable
          || !Object.prototype.hasOwnProperty.call(descriptor, 'value')
        ) inertFailure(`${field}[${index}]`);
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
    addBytes(state, 2, field);
    for (const key of Object.keys(descriptors).sort()) {
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        inertFailure(`${field}.${key}`);
      }
      assertNotSecretKey(key, `${field}.${key}`);
      addBytes(state, Buffer.byteLength(key, 'utf8') + 3, `${field}.${key}`);
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
    fail('BILLING_SOURCE_OBJECT_REQUIRED', `${field} must be an object.`, field, 400);
  }
  const unknown = Object.keys(value).find(key => !allowed.has(key));
  if (unknown) {
    fail('BILLING_SOURCE_UNKNOWN_FIELD', `${field}.${unknown} is not supported.`, `${field}.${unknown}`, 400);
  }
  return value;
}

function requiredText(value, field, max = 512) {
  if (typeof value !== 'string' || !value.trim()) {
    fail('BILLING_SOURCE_REQUIRED', `${field} is required.`, field, 400);
  }
  const normalized = value.trim();
  if (normalized.length > max || /[\u0000-\u001f\u007f]/.test(normalized)) {
    fail('BILLING_SOURCE_INVALID_TEXT', `${field} is invalid.`, field, 400);
  }
  return normalized;
}

function optionalText(value, field, max = 512) {
  if (value === undefined || value === null || value === '') return null;
  return requiredText(value, field, max);
}

function requiredId(value, field) {
  return requiredText(value, field, 160);
}

function optionalId(value, field) {
  return value == null || value === '' ? null : requiredId(value, field);
}

function requiredVersion(value, field, { allowZero = false } = {}) {
  const minimum = allowZero ? 0 : 1;
  if (!Number.isSafeInteger(value) || value < minimum) {
    fail('BILLING_SOURCE_INVALID_VERSION', `${field} must be a safe integer >= ${minimum}.`, field, 400);
  }
  return value;
}

function moneyMinor(value, field, { allowNegative = false } = {}) {
  if (!Number.isSafeInteger(value) || (!allowNegative && value < 0)) {
    fail('BILLING_SOURCE_INVALID_MONEY', `${field} must be safe integer minor units.`, field, 400);
  }
  return value;
}

function safeAdd(values, field = 'money') {
  let total = 0;
  for (const value of values) {
    moneyMinor(value, field, { allowNegative: true });
    total += value;
    if (!Number.isSafeInteger(total)) {
      fail('BILLING_SOURCE_MONEY_OVERFLOW', `${field} exceeds safe integer range.`, field, 400);
    }
  }
  return total;
}

function currency(value, field = 'currency') {
  const normalized = requiredText(value, field, 3);
  if (normalized !== 'RUB') {
    fail('BILLING_SOURCE_CURRENCY_UNSUPPORTED', 'PR6 source authority accepts explicit RUB only.', field, 400);
  }
  return normalized;
}

function enumValue(value, allowed, field) {
  const normalized = requiredText(value, field, 80);
  if (!allowed.has(normalized)) {
    fail('BILLING_SOURCE_INVALID_ENUM', `${field} is invalid.`, field, 400);
  }
  return normalized;
}

function civilDate(value, field) {
  const normalized = requiredText(value, field, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
    fail('BILLING_SOURCE_INVALID_DATE', `${field} must be YYYY-MM-DD.`, field, 400);
  }
  const [year, month, day] = normalized.split('-').map(Number);
  const timestamp = Date.UTC(year, month - 1, day);
  const date = new Date(timestamp);
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) fail('BILLING_SOURCE_INVALID_DATE', `${field} is not a calendar date.`, field, 400);
  return normalized;
}

function interval(start, end, startField, endField) {
  const normalizedStart = civilDate(start, startField);
  const normalizedEnd = civilDate(end, endField);
  if (normalizedStart >= normalizedEnd) {
    fail('BILLING_SOURCE_INVALID_INTERVAL', 'Coverage uses a non-empty half-open interval.', startField, 400);
  }
  return [normalizedStart, normalizedEnd];
}

function hash64(value, field) {
  const normalized = requiredText(value, field, 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(normalized)) {
    fail('BILLING_SOURCE_INVALID_HASH', `${field} must be lowercase SHA-256 hex.`, field, 400);
  }
  return normalized;
}

function reasonCodes(value, field, { required = false } = {}) {
  if (!Array.isArray(value)) fail('BILLING_SOURCE_REASON_CODES_REQUIRED', `${field} must be an array.`, field, 400);
  const normalized = value.map((item, index) => requiredText(item, `${field}[${index}]`, 120));
  if (new Set(normalized).size !== normalized.length) {
    fail('BILLING_SOURCE_DUPLICATE_REASON_CODE', `${field} contains duplicates.`, field, 400);
  }
  if (required && normalized.length === 0) {
    fail('BILLING_SOURCE_REASON_CODES_REQUIRED', `${field} cannot be empty.`, field, 400);
  }
  return Object.freeze([...normalized].sort());
}

function integrity(value, field, blockers) {
  const status = enumValue(value, SOURCE_INTEGRITY_STATUSES, field);
  if (status === 'blocked' && blockers.length === 0) {
    fail('BILLING_SOURCE_BLOCKER_REQUIRED', 'Blocked source requires blocker reasons.', field, 400);
  }
  if (status === 'matched' && blockers.length !== 0) {
    fail('BILLING_SOURCE_MATCHED_HAS_BLOCKERS', 'Matched source cannot retain blocker reasons.', field, 400);
  }
  return status;
}

function normalizeAuditMetadata(value) {
  if (value === undefined || value === null) return null;
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail('BILLING_SOURCE_AUDIT_METADATA_INVALID', 'auditMetadata must be a plain object.', 'auditMetadata', 400);
  }
  const serialized = stableJson(value);
  if (Buffer.byteLength(serialized, 'utf8') > AUDIT_METADATA_MAX_BYTES) {
    fail('BILLING_SOURCE_AUDIT_METADATA_INVALID', 'auditMetadata is too large.', 'auditMetadata', 400);
  }
  return value;
}

function assertStableIdentityKind(value, field) {
  const kind = requiredText(value, field, 80);
  if (FORBIDDEN_IDENTITY_KINDS.has(kind) || !STABLE_IDENTITY_KINDS.has(kind)) {
    fail('BILLING_SOURCE_UNSTABLE_IDENTITY', `${field} must use an approved stable identity kind.`, field, 400);
  }
  return kind;
}

function normalizeRentalLine(value) {
  const field = 'rentalLine';
  assertExactKeys(value, new Set([
    'id', 'rentalId', 'clientId', 'contractId', 'equipmentId', 'activationBoundaryId',
    'sourceSystem', 'sourceRentalRef', 'sourceLineIdentityKind', 'sourceLineRef',
    'sourceEventId', 'sourceEventVersion', 'provenanceHash',
  ]), field);
  return Object.freeze({
    id: optionalId(value.id, `${field}.id`),
    rentalId: requiredId(value.rentalId, `${field}.rentalId`),
    clientId: requiredId(value.clientId, `${field}.clientId`),
    contractId: optionalId(value.contractId, `${field}.contractId`),
    equipmentId: optionalId(value.equipmentId, `${field}.equipmentId`),
    activationBoundaryId: requiredId(value.activationBoundaryId, `${field}.activationBoundaryId`),
    sourceSystem: requiredText(value.sourceSystem, `${field}.sourceSystem`, 120),
    sourceRentalRef: requiredId(value.sourceRentalRef, `${field}.sourceRentalRef`),
    sourceLineIdentityKind: assertStableIdentityKind(value.sourceLineIdentityKind, `${field}.sourceLineIdentityKind`),
    sourceLineRef: requiredId(value.sourceLineRef, `${field}.sourceLineRef`),
    sourceEventId: requiredId(value.sourceEventId, `${field}.sourceEventId`),
    sourceEventVersion: requiredVersion(value.sourceEventVersion, `${field}.sourceEventVersion`),
    provenanceHash: hash64(value.provenanceHash, `${field}.provenanceHash`),
  });
}

function normalizeEffectiveTerms(value) {
  const field = 'effectiveTerms';
  assertExactKeys(value, new Set([
    'id', 'expectedLatestVersion', 'effectiveFromDate', 'effectiveToDateExclusive',
    'rateAmountMinor', 'rateUnitCode', 'rateQuantityScale', 'contractualBillingCycleCode',
    'contractualBillingCycleVersion', 'minimumTermQuantity', 'minimumTermUnitCode',
    'discountKind', 'discountValue', 'currency', 'calculationPolicyRef', 'vatPolicyRef',
    'roundingPolicyRef', 'policyDecisionRef', 'policyResolutionStatus',
    'unresolvedReasonCodes', 'sourceSystem', 'sourceRef', 'sourceVersion', 'sourceHash',
  ]), field);
  if (value.id) {
    const unsupported = Object.keys(value).find(key => key !== 'id');
    if (unsupported) {
      fail('BILLING_SOURCE_EXISTING_TERMS_FIELDS', 'Existing terms are selected only by immutable ID.', `${field}.${unsupported}`, 400);
    }
    return Object.freeze({ id: requiredId(value.id, `${field}.id`) });
  }
  const [effectiveFromDate, effectiveToDateExclusive] = interval(
    value.effectiveFromDate,
    value.effectiveToDateExclusive,
    `${field}.effectiveFromDate`,
    `${field}.effectiveToDateExclusive`,
  );
  const discountKind = enumValue(value.discountKind, new Set(['none', 'fixed_minor', 'basis_points']), `${field}.discountKind`);
  const discountValue = moneyMinor(value.discountValue, `${field}.discountValue`);
  if (discountKind === 'none' && discountValue !== 0) {
    fail('BILLING_SOURCE_DISCOUNT_INVALID', 'none discount requires zero value.', `${field}.discountValue`, 400);
  }
  const policyResolutionStatus = enumValue(
    value.policyResolutionStatus,
    new Set(['resolved', 'unresolved']),
    `${field}.policyResolutionStatus`,
  );
  const unresolvedReasonCodes = reasonCodes(
    value.unresolvedReasonCodes,
    `${field}.unresolvedReasonCodes`,
    { required: policyResolutionStatus === 'unresolved' },
  );
  if (policyResolutionStatus === 'resolved' && unresolvedReasonCodes.length > 0) {
    fail('BILLING_SOURCE_POLICY_STATE_INVALID', 'Resolved terms cannot retain unresolved reasons.', `${field}.unresolvedReasonCodes`, 400);
  }
  return Object.freeze({
    id: null,
    expectedLatestVersion: requiredVersion(value.expectedLatestVersion, `${field}.expectedLatestVersion`, { allowZero: true }),
    effectiveFromDate,
    effectiveToDateExclusive,
    rateAmountMinor: moneyMinor(value.rateAmountMinor, `${field}.rateAmountMinor`),
    rateUnitCode: requiredText(value.rateUnitCode, `${field}.rateUnitCode`, 80),
    rateQuantityScale: requiredVersion(value.rateQuantityScale, `${field}.rateQuantityScale`, { allowZero: true }),
    contractualBillingCycleCode: requiredText(value.contractualBillingCycleCode, `${field}.contractualBillingCycleCode`, 80),
    contractualBillingCycleVersion: requiredVersion(value.contractualBillingCycleVersion, `${field}.contractualBillingCycleVersion`),
    minimumTermQuantity: requiredVersion(value.minimumTermQuantity, `${field}.minimumTermQuantity`, { allowZero: true }),
    minimumTermUnitCode: requiredText(value.minimumTermUnitCode, `${field}.minimumTermUnitCode`, 80),
    discountKind,
    discountValue,
    currency: currency(value.currency, `${field}.currency`),
    calculationPolicyRef: requiredId(value.calculationPolicyRef, `${field}.calculationPolicyRef`),
    vatPolicyRef: requiredId(value.vatPolicyRef, `${field}.vatPolicyRef`),
    roundingPolicyRef: requiredId(value.roundingPolicyRef, `${field}.roundingPolicyRef`),
    policyDecisionRef: optionalId(value.policyDecisionRef, `${field}.policyDecisionRef`),
    policyResolutionStatus,
    unresolvedReasonCodes,
    sourceSystem: requiredText(value.sourceSystem, `${field}.sourceSystem`, 120),
    sourceRef: requiredId(value.sourceRef, `${field}.sourceRef`),
    sourceVersion: requiredVersion(value.sourceVersion, `${field}.sourceVersion`),
    sourceHash: hash64(value.sourceHash, `${field}.sourceHash`),
  });
}

function normalizePeriod(value) {
  const field = 'period';
  assertExactKeys(value, new Set([
    'id', 'contractualBillingCycleCode', 'contractualBillingCycleVersion',
    'cycleBoundaryEvidenceRef', 'periodStartDate', 'periodEndDateExclusive',
  ]), field);
  const [periodStartDate, periodEndDateExclusive] = interval(
    value.periodStartDate,
    value.periodEndDateExclusive,
    `${field}.periodStartDate`,
    `${field}.periodEndDateExclusive`,
  );
  return Object.freeze({
    id: optionalId(value.id, `${field}.id`),
    contractualBillingCycleCode: requiredText(value.contractualBillingCycleCode, `${field}.contractualBillingCycleCode`, 80),
    contractualBillingCycleVersion: requiredVersion(value.contractualBillingCycleVersion, `${field}.contractualBillingCycleVersion`),
    cycleBoundaryEvidenceRef: requiredId(value.cycleBoundaryEvidenceRef, `${field}.cycleBoundaryEvidenceRef`),
    periodStartDate,
    periodEndDateExclusive,
  });
}

function normalizeSnapshot(value) {
  const field = 'snapshot';
  assertExactKeys(value, new Set([
    'currency', 'preDiscountNetMinor', 'discountMinor', 'netMinor', 'vatMinor', 'grossMinor',
    'calculationAlgorithmVersion', 'calculationPolicyRef', 'vatPolicyRef',
    'roundingPolicyRef', 'policyDecisionRef', 'sourceIntegrityStatus', 'blockerReasonCodes',
    'calculationInputs', 'evidenceSetHash', 'sourceHash',
  ]), field);
  const blockers = reasonCodes(value.blockerReasonCodes, `${field}.blockerReasonCodes`);
  const status = integrity(value.sourceIntegrityStatus, `${field}.sourceIntegrityStatus`, blockers);
  const preDiscountNetMinor = moneyMinor(value.preDiscountNetMinor, `${field}.preDiscountNetMinor`);
  const discountMinor = moneyMinor(value.discountMinor, `${field}.discountMinor`);
  const netMinor = moneyMinor(value.netMinor, `${field}.netMinor`);
  const vatMinor = moneyMinor(value.vatMinor, `${field}.vatMinor`);
  const grossMinor = moneyMinor(value.grossMinor, `${field}.grossMinor`);
  if (status === 'matched') {
    if (discountMinor > preDiscountNetMinor || safeAdd([preDiscountNetMinor, -discountMinor], field) !== netMinor) {
      fail('BILLING_SOURCE_NET_MISMATCH', 'Discount must be applied before VAT with exact integer arithmetic.', field, 400);
    }
    if (safeAdd([netMinor, vatMinor], field) !== grossMinor) {
      fail('BILLING_SOURCE_GROSS_MISMATCH', 'Net plus VAT must equal gross.', field, 400);
    }
  }
  if (!value.calculationInputs || typeof value.calculationInputs !== 'object' || Array.isArray(value.calculationInputs)) {
    fail('BILLING_SOURCE_CALCULATION_INPUTS_REQUIRED', 'Explicit calculation inputs are required.', `${field}.calculationInputs`, 400);
  }
  return Object.freeze({
    currency: currency(value.currency, `${field}.currency`),
    preDiscountNetMinor,
    discountMinor,
    netMinor,
    vatMinor,
    grossMinor,
    calculationAlgorithmVersion: requiredVersion(value.calculationAlgorithmVersion, `${field}.calculationAlgorithmVersion`),
    calculationPolicyRef: requiredId(value.calculationPolicyRef, `${field}.calculationPolicyRef`),
    vatPolicyRef: requiredId(value.vatPolicyRef, `${field}.vatPolicyRef`),
    roundingPolicyRef: requiredId(value.roundingPolicyRef, `${field}.roundingPolicyRef`),
    policyDecisionRef: optionalId(value.policyDecisionRef, `${field}.policyDecisionRef`),
    sourceIntegrityStatus: status,
    blockerReasonCodes: blockers,
    calculationInputs: value.calculationInputs,
    calculationInputsHash: fingerprint({
      schemaVersion: BILLING_SOURCE_SCHEMA_VERSION,
      calculationAlgorithmVersion: value.calculationAlgorithmVersion,
      calculationInputs: value.calculationInputs,
    }),
    evidenceSetHash: hash64(value.evidenceSetHash, `${field}.evidenceSetHash`),
    sourceHash: hash64(value.sourceHash, `${field}.sourceHash`),
  });
}

function normalizeEvidence(value, index) {
  const field = `evidence[${index}]`;
  assertExactKeys(value, new Set([
    'evidenceType', 'sourceSystem', 'sourceId', 'sourceVersion', 'sourceEventId',
    'sourceEventVersion', 'coveredStartDate', 'coveredEndDateExclusive', 'authorityStatus',
    'authorityPolicyRef', 'evidenceHash',
  ]), field);
  const [coveredStartDate, coveredEndDateExclusive] = interval(
    value.coveredStartDate,
    value.coveredEndDateExclusive,
    `${field}.coveredStartDate`,
    `${field}.coveredEndDateExclusive`,
  );
  const authorityStatus = enumValue(value.authorityStatus, EVIDENCE_AUTHORITY_STATUSES, `${field}.authorityStatus`);
  const authorityPolicyRef = optionalId(value.authorityPolicyRef, `${field}.authorityPolicyRef`);
  if (authorityStatus === 'approved_by_reference' && !authorityPolicyRef) {
    fail('BILLING_SOURCE_EVIDENCE_POLICY_REQUIRED', 'Approved evidence requires a policy reference.', `${field}.authorityPolicyRef`, 400);
  }
  return Object.freeze({
    evidenceType: enumValue(value.evidenceType, EVIDENCE_TYPES, `${field}.evidenceType`),
    sourceSystem: requiredText(value.sourceSystem, `${field}.sourceSystem`, 120),
    sourceId: requiredId(value.sourceId, `${field}.sourceId`),
    sourceVersion: requiredVersion(value.sourceVersion, `${field}.sourceVersion`),
    sourceEventId: requiredId(value.sourceEventId, `${field}.sourceEventId`),
    sourceEventVersion: requiredVersion(value.sourceEventVersion, `${field}.sourceEventVersion`),
    coveredStartDate,
    coveredEndDateExclusive,
    authorityStatus,
    authorityPolicyRef,
    evidenceHash: hash64(value.evidenceHash, `${field}.evidenceHash`),
  });
}

function normalizeUpd(value) {
  const field = 'upd';
  assertExactKeys(value, new Set([
    'id', 'clientId', 'contractId', 'sourceSystem', 'sourceDocumentRef', 'legacyDocumentId',
    'documentNumber', 'documentDate', 'currency', 'sourceEventId', 'sourceEventVersion',
    'sourceHash', 'sourceIntegrityStatus', 'blockerReasonCodes',
  ]), field);
  const blockers = reasonCodes(value.blockerReasonCodes, `${field}.blockerReasonCodes`, {
    required: value.sourceIntegrityStatus === 'blocked',
  });
  return Object.freeze({
    id: optionalId(value.id, `${field}.id`),
    clientId: requiredId(value.clientId, `${field}.clientId`),
    contractId: optionalId(value.contractId, `${field}.contractId`),
    sourceSystem: requiredText(value.sourceSystem, `${field}.sourceSystem`, 120),
    sourceDocumentRef: requiredId(value.sourceDocumentRef, `${field}.sourceDocumentRef`),
    legacyDocumentId: optionalId(value.legacyDocumentId, `${field}.legacyDocumentId`),
    documentNumber: optionalText(value.documentNumber, `${field}.documentNumber`, 160),
    documentDate: civilDate(value.documentDate, `${field}.documentDate`),
    currency: currency(value.currency, `${field}.currency`),
    sourceEventId: requiredId(value.sourceEventId, `${field}.sourceEventId`),
    sourceEventVersion: requiredVersion(value.sourceEventVersion, `${field}.sourceEventVersion`),
    sourceHash: hash64(value.sourceHash, `${field}.sourceHash`),
    sourceIntegrityStatus: integrity(value.sourceIntegrityStatus, `${field}.sourceIntegrityStatus`, blockers),
    blockerReasonCodes: blockers,
  });
}

function normalizeUpdLine(value, index) {
  const field = `lines[${index}]`;
  assertExactKeys(value, new Set([
    'id', 'sourceLineRef', 'sourceLineIdentityKind', 'displayPosition', 'description',
    'quantityValueInteger', 'quantityScale', 'unitCode', 'currency', 'netMinor', 'vatMinor',
    'grossMinor', 'vatPolicyRef', 'roundingPolicyRef', 'policyDecisionRef',
    'sourceIntegrityStatus', 'blockerReasonCodes', 'sourceSystem', 'sourceRef',
    'sourceVersion', 'sourceHash',
  ]), field);
  const blockers = reasonCodes(value.blockerReasonCodes, `${field}.blockerReasonCodes`, {
    required: value.sourceIntegrityStatus === 'blocked',
  });
  const status = integrity(value.sourceIntegrityStatus, `${field}.sourceIntegrityStatus`, blockers);
  const netMinor = moneyMinor(value.netMinor, `${field}.netMinor`);
  const vatMinor = moneyMinor(value.vatMinor, `${field}.vatMinor`);
  const grossMinor = moneyMinor(value.grossMinor, `${field}.grossMinor`);
  if (status === 'matched' && safeAdd([netMinor, vatMinor], field) !== grossMinor) {
    fail('BILLING_SOURCE_UPD_LINE_MISMATCH', 'UPD line net plus VAT must equal gross.', field, 400);
  }
  return Object.freeze({
    id: optionalId(value.id, `${field}.id`),
    sourceLineRef: requiredId(value.sourceLineRef, `${field}.sourceLineRef`),
    sourceLineIdentityKind: assertStableIdentityKind(value.sourceLineIdentityKind, `${field}.sourceLineIdentityKind`),
    displayPosition: value.displayPosition == null ? null : requiredVersion(value.displayPosition, `${field}.displayPosition`),
    description: optionalText(value.description, `${field}.description`, 1000),
    quantityValueInteger: requiredVersion(value.quantityValueInteger, `${field}.quantityValueInteger`, { allowZero: true }),
    quantityScale: requiredVersion(value.quantityScale, `${field}.quantityScale`, { allowZero: true }),
    unitCode: requiredText(value.unitCode, `${field}.unitCode`, 80),
    currency: currency(value.currency, `${field}.currency`),
    netMinor,
    vatMinor,
    grossMinor,
    vatPolicyRef: requiredId(value.vatPolicyRef, `${field}.vatPolicyRef`),
    roundingPolicyRef: requiredId(value.roundingPolicyRef, `${field}.roundingPolicyRef`),
    policyDecisionRef: optionalId(value.policyDecisionRef, `${field}.policyDecisionRef`),
    sourceIntegrityStatus: status,
    blockerReasonCodes: blockers,
    sourceSystem: requiredText(value.sourceSystem, `${field}.sourceSystem`, 120),
    sourceRef: requiredId(value.sourceRef, `${field}.sourceRef`),
    sourceVersion: requiredVersion(value.sourceVersion, `${field}.sourceVersion`),
    sourceHash: hash64(value.sourceHash, `${field}.sourceHash`),
  });
}

function normalizeCoverageSlice(value, index) {
  const field = `coverage.slices[${index}]`;
  assertExactKeys(value, new Set([
    'updLineId', 'sourceLineRef', 'updLineVersionId', 'periodId', 'closedPeriodVersionId',
    'snapshotId', 'sliceStartDate', 'sliceEndDateExclusive', 'allocatedNetMinor',
    'allocatedVatMinor', 'allocatedGrossMinor', 'contractualDueDate', 'dueDateProvenance',
    'dueDateEvidenceRef',
  ]), field);
  if (!value.updLineId && !value.sourceLineRef) {
    fail('BILLING_SOURCE_UPD_LINE_ID_REQUIRED', 'Coverage requires a stable UPD line ID or source reference.', field, 400);
  }
  const [sliceStartDate, sliceEndDateExclusive] = interval(
    value.sliceStartDate,
    value.sliceEndDateExclusive,
    `${field}.sliceStartDate`,
    `${field}.sliceEndDateExclusive`,
  );
  const allocatedNetMinor = moneyMinor(value.allocatedNetMinor, `${field}.allocatedNetMinor`);
  const allocatedVatMinor = moneyMinor(value.allocatedVatMinor, `${field}.allocatedVatMinor`);
  const allocatedGrossMinor = moneyMinor(value.allocatedGrossMinor, `${field}.allocatedGrossMinor`);
  if (safeAdd([allocatedNetMinor, allocatedVatMinor], field) !== allocatedGrossMinor) {
    fail('BILLING_SOURCE_SLICE_MISMATCH', 'Coverage slice net plus VAT must equal gross.', field, 400);
  }
  const dueDateProvenance = enumValue(value.dueDateProvenance, DUE_DATE_PROVENANCE, `${field}.dueDateProvenance`);
  const contractualDueDate = value.contractualDueDate == null
    ? null
    : civilDate(value.contractualDueDate, `${field}.contractualDueDate`);
  const dueDateEvidenceRef = optionalId(value.dueDateEvidenceRef, `${field}.dueDateEvidenceRef`);
  if (dueDateProvenance === 'unknown' && (contractualDueDate || dueDateEvidenceRef)) {
    fail('BILLING_SOURCE_DUE_DATE_UNKNOWN', 'Unknown due date cannot carry invented evidence.', field, 400);
  }
  if (dueDateProvenance !== 'unknown' && (!contractualDueDate || !dueDateEvidenceRef)) {
    fail('BILLING_SOURCE_DUE_DATE_EVIDENCE_REQUIRED', 'Known due date requires exact evidence.', field, 400);
  }
  return Object.freeze({
    updLineId: optionalId(value.updLineId, `${field}.updLineId`),
    sourceLineRef: optionalId(value.sourceLineRef, `${field}.sourceLineRef`),
    updLineVersionId: optionalId(value.updLineVersionId, `${field}.updLineVersionId`),
    periodId: requiredId(value.periodId, `${field}.periodId`),
    closedPeriodVersionId: requiredId(value.closedPeriodVersionId, `${field}.closedPeriodVersionId`),
    snapshotId: requiredId(value.snapshotId, `${field}.snapshotId`),
    sliceStartDate,
    sliceEndDateExclusive,
    allocatedNetMinor,
    allocatedVatMinor,
    allocatedGrossMinor,
    contractualDueDate,
    dueDateProvenance,
    dueDateEvidenceRef,
  });
}

function normalizeCoverage(value) {
  const field = 'coverage';
  if (value == null) return null;
  assertExactKeys(value, new Set([
    'expectedCoverageVersion', 'supersedesCoverageSetId', 'mappingAlgorithmVersion', 'status',
    'netDeltaMinor', 'vatDeltaMinor', 'grossDeltaMinor', 'blockerReasonCodes', 'slices',
  ]), field);
  const status = enumValue(value.status, new Set(['validated', 'blocked']), `${field}.status`);
  const blockers = reasonCodes(value.blockerReasonCodes, `${field}.blockerReasonCodes`, { required: status === 'blocked' });
  if (status === 'validated' && blockers.length > 0) {
    fail('BILLING_SOURCE_VALIDATED_HAS_BLOCKERS', 'Validated coverage cannot retain blockers.', `${field}.blockerReasonCodes`, 400);
  }
  const deltas = {
    netDeltaMinor: moneyMinor(value.netDeltaMinor, `${field}.netDeltaMinor`, { allowNegative: true }),
    vatDeltaMinor: moneyMinor(value.vatDeltaMinor, `${field}.vatDeltaMinor`, { allowNegative: true }),
    grossDeltaMinor: moneyMinor(value.grossDeltaMinor, `${field}.grossDeltaMinor`, { allowNegative: true }),
  };
  if (status === 'validated' && Object.values(deltas).some(delta => delta !== 0)) {
    fail('BILLING_SOURCE_COVERAGE_DELTA', 'Validated coverage requires zero unexplained deltas.', field, 400);
  }
  if (status === 'blocked' && value.supersedesCoverageSetId) {
    fail('BILLING_SOURCE_BLOCKED_SUPERSESSION', 'Blocked coverage cannot deactivate a valid mapping.', `${field}.supersedesCoverageSetId`, 400);
  }
  if (!Array.isArray(value.slices) || value.slices.length === 0) {
    fail('BILLING_SOURCE_COVERAGE_SLICES_REQUIRED', 'Coverage requires explicit slices.', `${field}.slices`, 400);
  }
  return Object.freeze({
    expectedCoverageVersion: requiredVersion(value.expectedCoverageVersion, `${field}.expectedCoverageVersion`, { allowZero: true }),
    supersedesCoverageSetId: optionalId(value.supersedesCoverageSetId, `${field}.supersedesCoverageSetId`),
    mappingAlgorithmVersion: requiredVersion(value.mappingAlgorithmVersion, `${field}.mappingAlgorithmVersion`),
    status,
    ...deltas,
    blockerReasonCodes: blockers,
    slices: Object.freeze(value.slices.map(normalizeCoverageSlice)),
  });
}

function normalizeClosePlan(value) {
  assertExactKeys(value, new Set([
    'operationType', 'idempotencyKey', 'expectedPeriodVersion', 'rentalLine',
    'effectiveTerms', 'period', 'snapshot', 'evidence', 'sourceEventId',
    'sourceEventVersion', 'sourceHash', 'auditMetadata',
  ]), 'command');
  if (!Array.isArray(value.evidence) || value.evidence.length === 0) {
    fail('BILLING_SOURCE_EVIDENCE_REQUIRED', 'A close requires explicit evidence.', 'evidence', 400);
  }
  const rentalLine = normalizeRentalLine(value.rentalLine);
  const effectiveTerms = normalizeEffectiveTerms(value.effectiveTerms);
  const period = normalizePeriod(value.period);
  const snapshot = normalizeSnapshot(value.snapshot);
  const evidence = Object.freeze(value.evidence.map(normalizeEvidence));
  if (snapshot.sourceIntegrityStatus === 'matched' && evidence.some(item => item.authorityStatus !== 'approved_by_reference')) {
    fail('BILLING_SOURCE_EVIDENCE_UNRESOLVED', 'Matched snapshots require approved evidence references.', 'evidence', 400);
  }
  return {
    operationType: 'close_billing_period',
    idempotencyKey: requiredId(value.idempotencyKey, 'idempotencyKey'),
    expectedPeriodVersion: requiredVersion(value.expectedPeriodVersion, 'expectedPeriodVersion', { allowZero: true }),
    rentalLine,
    effectiveTerms,
    period,
    snapshot,
    evidence,
    sourceEventId: requiredId(value.sourceEventId, 'sourceEventId'),
    sourceEventVersion: requiredVersion(value.sourceEventVersion, 'sourceEventVersion'),
    sourceHash: hash64(value.sourceHash, 'sourceHash'),
    auditMetadata: normalizeAuditMetadata(value.auditMetadata),
  };
}

function normalizeReopenPlan(value) {
  assertExactKeys(value, new Set([
    'operationType', 'idempotencyKey', 'periodId', 'expectedPeriodVersion', 'reasonCode',
    'reasonText', 'sourceEventId', 'sourceEventVersion', 'sourceHash', 'auditMetadata',
  ]), 'command');
  return {
    operationType: 'reopen_billing_period',
    idempotencyKey: requiredId(value.idempotencyKey, 'idempotencyKey'),
    periodId: requiredId(value.periodId, 'periodId'),
    expectedPeriodVersion: requiredVersion(value.expectedPeriodVersion, 'expectedPeriodVersion'),
    reasonCode: requiredText(value.reasonCode, 'reasonCode', 120),
    reasonText: requiredText(value.reasonText, 'reasonText', 1000),
    sourceEventId: requiredId(value.sourceEventId, 'sourceEventId'),
    sourceEventVersion: requiredVersion(value.sourceEventVersion, 'sourceEventVersion'),
    sourceHash: hash64(value.sourceHash, 'sourceHash'),
    auditMetadata: normalizeAuditMetadata(value.auditMetadata),
  };
}

function normalizeFormPlan(value) {
  assertExactKeys(value, new Set([
    'operationType', 'idempotencyKey', 'expectedUpdVersion', 'upd', 'lines', 'coverage',
    'auditMetadata',
  ]), 'command');
  if (!Array.isArray(value.lines) || value.lines.length === 0) {
    fail('BILLING_SOURCE_UPD_LINES_REQUIRED', 'Forming a UPD requires stable lines.', 'lines', 400);
  }
  const lines = Object.freeze(value.lines.map(normalizeUpdLine));
  const identities = lines.map(line => line.sourceLineRef);
  if (new Set(identities).size !== identities.length) {
    fail('BILLING_SOURCE_DUPLICATE_UPD_LINE', 'UPD line identities must be unique.', 'lines', 400);
  }
  return {
    operationType: 'form_upd',
    idempotencyKey: requiredId(value.idempotencyKey, 'idempotencyKey'),
    expectedUpdVersion: requiredVersion(value.expectedUpdVersion, 'expectedUpdVersion', { allowZero: true }),
    upd: normalizeUpd(value.upd),
    lines,
    coverage: normalizeCoverage(value.coverage),
    auditMetadata: normalizeAuditMetadata(value.auditMetadata),
  };
}

function normalizeRecordCoveragePlan(value) {
  assertExactKeys(value, new Set([
    'operationType', 'idempotencyKey', 'updId', 'formedUpdVersionId', 'expectedUpdVersion',
    'coverage', 'auditMetadata',
  ]), 'command');
  return {
    operationType: 'record_upd_coverage',
    idempotencyKey: requiredId(value.idempotencyKey, 'idempotencyKey'),
    updId: requiredId(value.updId, 'updId'),
    formedUpdVersionId: requiredId(value.formedUpdVersionId, 'formedUpdVersionId'),
    expectedUpdVersion: requiredVersion(value.expectedUpdVersion, 'expectedUpdVersion'),
    coverage: normalizeCoverage(value.coverage),
    auditMetadata: normalizeAuditMetadata(value.auditMetadata),
  };
}

function normalizeConductPlan(value) {
  assertExactKeys(value, new Set([
    'operationType', 'idempotencyKey', 'updId', 'formedUpdVersionId', 'expectedUpdVersion',
    'sourceEventId', 'sourceEventVersion', 'sourceHash', 'conductedEvidenceRef',
    'conductedEvidenceVersion', 'conductedEvidenceHash', 'conductedPolicyDecisionRef',
    'clientSignatureEvidenceRef', 'signatureRequirementPolicyRef', 'sourceIntegrityStatus',
    'blockerReasonCodes', 'auditMetadata',
  ]), 'command');
  const blockers = reasonCodes(value.blockerReasonCodes, 'blockerReasonCodes', {
    required: value.sourceIntegrityStatus === 'blocked',
  });
  return {
    operationType: 'conduct_upd',
    idempotencyKey: requiredId(value.idempotencyKey, 'idempotencyKey'),
    updId: requiredId(value.updId, 'updId'),
    formedUpdVersionId: requiredId(value.formedUpdVersionId, 'formedUpdVersionId'),
    expectedUpdVersion: requiredVersion(value.expectedUpdVersion, 'expectedUpdVersion'),
    sourceEventId: requiredId(value.sourceEventId, 'sourceEventId'),
    sourceEventVersion: requiredVersion(value.sourceEventVersion, 'sourceEventVersion'),
    sourceHash: hash64(value.sourceHash, 'sourceHash'),
    conductedEvidenceRef: requiredId(value.conductedEvidenceRef, 'conductedEvidenceRef'),
    conductedEvidenceVersion: requiredVersion(value.conductedEvidenceVersion, 'conductedEvidenceVersion'),
    conductedEvidenceHash: hash64(value.conductedEvidenceHash, 'conductedEvidenceHash'),
    conductedPolicyDecisionRef: optionalId(value.conductedPolicyDecisionRef, 'conductedPolicyDecisionRef'),
    clientSignatureEvidenceRef: optionalId(value.clientSignatureEvidenceRef, 'clientSignatureEvidenceRef'),
    signatureRequirementPolicyRef: optionalId(value.signatureRequirementPolicyRef, 'signatureRequirementPolicyRef'),
    sourceIntegrityStatus: integrity(value.sourceIntegrityStatus, 'sourceIntegrityStatus', blockers),
    blockerReasonCodes: blockers,
    auditMetadata: normalizeAuditMetadata(value.auditMetadata),
  };
}

function normalizeCorrectPlan(value) {
  assertExactKeys(value, new Set([
    'operationType', 'idempotencyKey', 'updId', 'expectedUpdVersion', 'action', 'reasonCode',
    'reasonText', 'sourceEventId', 'sourceEventVersion', 'sourceHash', 'lines', 'coverage',
    'auditMetadata',
  ]), 'command');
  const action = enumValue(value.action, new Set(['cancel', 'replace']), 'action');
  let lines = null;
  let coverage = null;
  if (action === 'replace') {
    if (!Array.isArray(value.lines) || value.lines.length === 0) {
      fail('BILLING_SOURCE_UPD_LINES_REQUIRED', 'UPD replacement requires line versions.', 'lines', 400);
    }
    lines = Object.freeze(value.lines.map(normalizeUpdLine));
    const identities = lines.map(line => line.sourceLineRef);
    if (new Set(identities).size !== identities.length) {
      fail('BILLING_SOURCE_DUPLICATE_UPD_LINE', 'UPD line identities must be unique.', 'lines', 400);
    }
    coverage = normalizeCoverage(value.coverage);
  } else if (value.lines !== undefined || value.coverage !== undefined) {
    fail('BILLING_SOURCE_CANCEL_CONTENT_FORBIDDEN', 'Cancellation cannot replace line or coverage content.', 'lines', 400);
  }
  return {
    operationType: 'correct_upd',
    idempotencyKey: requiredId(value.idempotencyKey, 'idempotencyKey'),
    updId: requiredId(value.updId, 'updId'),
    expectedUpdVersion: requiredVersion(value.expectedUpdVersion, 'expectedUpdVersion'),
    action,
    reasonCode: requiredText(value.reasonCode, 'reasonCode', 120),
    reasonText: requiredText(value.reasonText, 'reasonText', 1000),
    sourceEventId: requiredId(value.sourceEventId, 'sourceEventId'),
    sourceEventVersion: requiredVersion(value.sourceEventVersion, 'sourceEventVersion'),
    sourceHash: hash64(value.sourceHash, 'sourceHash'),
    lines,
    coverage,
    auditMetadata: normalizeAuditMetadata(value.auditMetadata),
  };
}

const NORMALIZERS = Object.freeze({
  close_billing_period: normalizeClosePlan,
  reopen_billing_period: normalizeReopenPlan,
  form_upd: normalizeFormPlan,
  record_upd_coverage: normalizeRecordCoveragePlan,
  conduct_upd: normalizeConductPlan,
  correct_upd: normalizeCorrectPlan,
});

function materializeBillingSourceCommandPlan(input, expectedOperationType) {
  const inert = materializeInert(input, 'command');
  if (!inert || typeof inert !== 'object' || Array.isArray(inert)) inertFailure('command');
  const operationType = requiredText(inert.operationType, 'operationType', 80);
  if (!NORMALIZERS[operationType] || (expectedOperationType && operationType !== expectedOperationType)) {
    fail('BILLING_SOURCE_OPERATION_TYPE_INVALID', 'Operation type is unavailable.', 'operationType', 400);
  }
  const normalized = NORMALIZERS[operationType](inert);
  const plan = Object.freeze({
    ...normalized,
    schemaVersion: BILLING_SOURCE_SCHEMA_VERSION,
  });
  BILLING_SOURCE_COMMAND_PLANS.add(plan);
  return plan;
}

function assertBillingSourceCommandPlan(plan, expectedOperationType) {
  if (
    !plan
    || !BILLING_SOURCE_COMMAND_PLANS.has(plan)
    || plan.operationType !== expectedOperationType
  ) {
    fail('BILLING_SOURCE_PLAN_CONTEXT_REJECTED', 'A branded inert command plan is required.', 'command', 403);
  }
  return plan;
}

function createBillingSourceCommandContext(platformScope, options = {}) {
  const inertScope = materializeInert(platformScope, 'platformScope');
  const inertOptions = materializeInert(options, 'contextOptions');
  assertExactKeys(inertOptions, new Set(['branchId', 'correlationId']), 'contextOptions');
  if (
    inertScope?.authenticated !== true
    || inertScope.principalType !== 'user'
    || !Array.isArray(inertScope.capabilities)
    || !Array.isArray(inertScope.allowedBranchIds)
  ) fail('BILLING_SOURCE_SCOPE_REJECTED', 'A trusted PR5 user scope is required.', 'platformScope', 403);
  const branchId = requiredId(inertOptions.branchId, 'contextOptions.branchId');
  if (FORBIDDEN_BRANCH_IDS.has(branchId.toLowerCase()) || !inertScope.allowedBranchIds.includes(branchId)) {
    fail('BILLING_SOURCE_SCOPE_REJECTED', 'A concrete authorized branch is required.', 'contextOptions.branchId', 404);
  }
  const context = Object.freeze({
    authenticated: true,
    principalType: 'user',
    principalId: requiredId(inertScope.principalId, 'platformScope.principalId'),
    companyId: requiredId(inertScope.companyId, 'platformScope.companyId'),
    companyTimezone: requiredText(inertScope.companyTimezone, 'platformScope.companyTimezone', 120),
    membershipId: requiredId(inertScope.membershipId, 'platformScope.membershipId'),
    membershipVersion: requiredVersion(inertScope.membershipVersion, 'platformScope.membershipVersion'),
    roleTemplateKey: requiredId(inertScope.roleTemplateKey, 'platformScope.roleTemplateKey'),
    roleTemplateVersion: requiredVersion(inertScope.roleTemplateVersion, 'platformScope.roleTemplateVersion'),
    capabilityCatalogVersion: requiredVersion(inertScope.capabilityCatalogVersion, 'platformScope.capabilityCatalogVersion'),
    capabilities: Object.freeze([...new Set(inertScope.capabilities.map((item, index) => requiredId(item, `platformScope.capabilities[${index}]`)))].sort()),
    companyWideBranchAuthority: inertScope.companyWideBranchAuthority === true,
    allowedBranchIds: Object.freeze([...new Set(inertScope.allowedBranchIds.map((item, index) => requiredId(item, `platformScope.allowedBranchIds[${index}]`)))].sort()),
    branchId,
    correlationId: requiredId(inertOptions.correlationId, 'contextOptions.correlationId'),
  });
  BILLING_SOURCE_COMMAND_CONTEXTS.add(context);
  return context;
}

function assertBillingSourceCommandContext(context) {
  if (!context || !BILLING_SOURCE_COMMAND_CONTEXTS.has(context)) {
    fail('BILLING_SOURCE_COMMAND_CONTEXT_REJECTED', 'A branded PR6 command context is required.', 'context', 403);
  }
  return context;
}

module.exports = {
  AUDIT_METADATA_MAX_BYTES,
  BILLING_SOURCE_SCHEMA_VERSION,
  BillingSourceAuthorityError,
  COMMAND_PLAN_MAX_BYTES,
  COMMAND_PLAN_MAX_DEPTH,
  COMMAND_PLAN_MAX_NODES,
  DUE_DATE_PROVENANCE,
  EVIDENCE_AUTHORITY_STATUSES,
  EVIDENCE_TYPES,
  OPERATION_CAPABILITIES,
  SOURCE_INTEGRITY_STATUSES,
  STABLE_IDENTITY_KINDS,
  assertBillingSourceCommandContext,
  assertBillingSourceCommandPlan,
  civilDate,
  createBillingSourceCommandContext,
  fingerprint,
  hash64,
  materializeBillingSourceCommandPlan,
  moneyMinor,
  requiredId,
  safeAdd,
  sha256,
  stableJson,
};
