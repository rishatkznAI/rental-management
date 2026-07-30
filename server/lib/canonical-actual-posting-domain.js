const crypto = require('crypto');
const { types, TextDecoder } = require('util');
const {
  CANONICAL_POSTING_CONFLICT_TYPES,
  REQUIRED_COLUMNS,
  ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE,
} = require('./canonical-actual-posting-schema');

const MAX_SAFE_INTEGER = 9_007_199_254_740_991;
const MAX_EPOCH_MILLISECONDS = 253_402_300_799_999;
const MAX_CANONICAL_BYTES = 262_144;
const MAX_DEPTH = 24;
const MAX_NODES = 10_000;
const OPERATION_DOMAIN = 'canonical_receivable.initial_post.v1';
const TRANSITION_KIND = 'required_conflict_accounting_circuit_v1';

const RUNTIME_AUTHORITY_KINDS = Object.freeze([
  'source_adapter',
  'eligibility_producer',
  'canonical_posting_adapter',
]);
const RUNTIME_AUTHORITY_CONTRACT_KEYS = Object.freeze([
  'artifactDigest',
  'configurationHash',
  'policyHash',
  'sourceCommitSha',
]);
const RUNTIME_CONTRACTS = new WeakSet();

const ERROR_CODES = Object.freeze({
  INPUT_NOT_INERT: 'CANONICAL_INPUT_NOT_INERT',
  INPUT_LIMIT_EXCEEDED: 'CANONICAL_INPUT_LIMIT_EXCEEDED',
  JSON_INVALID: 'CANONICAL_JSON_INVALID',
  JSON_NOT_CANONICAL: 'CANONICAL_JSON_NOT_CANONICAL',
  SAFE_INTEGER_REQUIRED: 'CANONICAL_SAFE_INTEGER_REQUIRED',
  INVALID_IDENTIFIER: 'CANONICAL_INVALID_IDENTIFIER',
  INVALID_HASH: 'CANONICAL_INVALID_HASH',
  INVALID_TIMESTAMP: 'CANONICAL_INVALID_TIMESTAMP',
  INVALID_UUID: 'CANONICAL_INVALID_UUID',
  ENVELOPE_INVALID: 'CANONICAL_ENVELOPE_INVALID',
  AUTHORITY_CANDIDATE_COMPARATOR_FAILED: 'CANONICAL_AUTHORITY_CANDIDATE_COMPARATOR_FAILED',
  AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED: 'AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED',
  CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED: 'CANONICAL_CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED',
  CONFLICT_REPLAY_INTEGRITY_FAILED: 'CANONICAL_CONFLICT_REPLAY_INTEGRITY_FAILED',
  CONFLICT_TRANSITION_INTEGRITY_FAILED: 'CANONICAL_CONFLICT_TRANSITION_INTEGRITY_FAILED',
  DENIAL_ATTEMPT_ID_GENERATION_FAILED: 'CANONICAL_DENIAL_ATTEMPT_ID_GENERATION_FAILED',
  DENIAL_ATTEMPT_ID_COLLISION: 'CANONICAL_DENIAL_ATTEMPT_ID_COLLISION',
  CONFLICT_TRANSITION_RECOVERY_REQUIRED: 'CANONICAL_CONFLICT_TRANSITION_RECOVERY_REQUIRED',
  CONFLICT_EVIDENCE_PERSISTENCE_FAILED: 'CANONICAL_CONFLICT_EVIDENCE_PERSISTENCE_FAILED',
  POSTING_CONCURRENT_CONFLICT: 'CANONICAL_POSTING_CONCURRENT_CONFLICT',
  PR9B_DISABLED: 'CANONICAL_PR9B_DISABLED',
  POSTING_ASSERTION_MISMATCH: 'CANONICAL_POSTING_ASSERTION_MISMATCH',
  POSTING_EVENT_NOT_FOUND: 'CANONICAL_POSTING_EVENT_NOT_FOUND',
  POSTING_INTEGRITY_BLOCKED: 'CANONICAL_POSTING_INTEGRITY_BLOCKED',
  POSTING_ID_GENERATION_FAILED: 'CANONICAL_POSTING_ID_GENERATION_FAILED',
  POSTING_PERSISTENCE_FAILED: 'CANONICAL_POSTING_PERSISTENCE_FAILED',
  POSTING_DATABASE_FAILED: 'CANONICAL_POSTING_DATABASE_FAILED',
  C_SEAM_INPUT_REJECTED: 'C_SEAM_INPUT_REJECTED',
});

class CanonicalActualPostingError extends Error {
  constructor(code, message = code, field = null, options = undefined) {
    super(message, options);
    this.name = 'CanonicalActualPostingError';
    this.code = code;
    this.field = field;
  }
}

function fail(code, message = code, field = null) {
  throw new CanonicalActualPostingError(code, message, field);
}

function hasValidUnicodeScalars(value) {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(index + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return false;
      index += 1;
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return false;
    }
  }
  return true;
}

function assertUnicodeScalarString(value, field = 'value') {
  if (typeof value !== 'string' || !hasValidUnicodeScalars(value)) {
    fail(ERROR_CODES.INPUT_NOT_INERT, `Invalid Unicode scalar string: ${field}`, field);
  }
  return value;
}

function compareUtf16Ascending(left, right) {
  assertUnicodeScalarString(left, 'left');
  assertUnicodeScalarString(right, 'right');
  if (left < right) return -1;
  if (left > right) return 1;
  if (left === right) return 0;
  fail(ERROR_CODES.AUTHORITY_CANDIDATE_COMPARATOR_FAILED);
}

function compareSafeIntegerAscending(left, right) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    fail(ERROR_CODES.AUTHORITY_CANDIDATE_COMPARATOR_FAILED);
  }
  if (left < right) return -1;
  if (left > right) return 1;
  if (left === right) return 0;
  fail(ERROR_CODES.AUTHORITY_CANDIDATE_COMPARATOR_FAILED);
}

function compareSafeIntegerDescending(left, right) {
  if (!Number.isSafeInteger(left) || !Number.isSafeInteger(right)) {
    fail(ERROR_CODES.AUTHORITY_CANDIDATE_COMPARATOR_FAILED);
  }
  if (left > right) return -1;
  if (left < right) return 1;
  if (left === right) return 0;
  fail(ERROR_CODES.AUTHORITY_CANDIDATE_COMPARATOR_FAILED);
}

function compareAuthorityDenialCandidate(left, right) {
  let result = compareSafeIntegerAscending(left.precedenceRank, right.precedenceRank);
  if (result !== 0) return result;
  result = compareSafeIntegerDescending(left.authorityVersion, right.authorityVersion);
  if (result !== 0) return result;
  return compareUtf16Ascending(left.authorityRecordId, right.authorityRecordId);
}

function assertSafeInteger(value, field = 'value', { minimum = -MAX_SAFE_INTEGER, maximum = MAX_SAFE_INTEGER } = {}) {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    fail(ERROR_CODES.SAFE_INTEGER_REQUIRED, `Safe integer required: ${field}`, field);
  }
  return value;
}

function assertIdentifier(value, field = 'identifier') {
  assertUnicodeScalarString(value, field);
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes < 1 || bytes > 160) fail(ERROR_CODES.INVALID_IDENTIFIER, `Invalid identifier: ${field}`, field);
  return value;
}

function assertHash(value, field = 'hash') {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) {
    fail(ERROR_CODES.INVALID_HASH, `Invalid SHA-256 hash: ${field}`, field);
  }
  return value;
}

function assertRfc3339Milliseconds(value, field = 'timestamp') {
  if (
    typeof value !== 'string'
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)
  ) fail(ERROR_CODES.INVALID_TIMESTAMP, `Invalid RFC3339 millisecond timestamp: ${field}`, field);
  const parsed = Date.parse(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > MAX_EPOCH_MILLISECONDS) {
    fail(ERROR_CODES.INVALID_TIMESTAMP, `Invalid RFC3339 millisecond timestamp: ${field}`, field);
  }
  if (new Date(parsed).toISOString() !== value) {
    fail(ERROR_CODES.INVALID_TIMESTAMP, `Non-canonical RFC3339 timestamp: ${field}`, field);
  }
  return value;
}

function renderUtcMilliseconds(value, field = 'epochMilliseconds') {
  assertSafeInteger(value, field, { minimum: 0, maximum: MAX_EPOCH_MILLISECONDS });
  try {
    const rendered = new Date(value).toISOString();
    assertRfc3339Milliseconds(rendered, field);
    return rendered;
  } catch {
    fail(ERROR_CODES.INVALID_TIMESTAMP, `Invalid epoch milliseconds: ${field}`, field);
  }
}

function parseUtcMilliseconds(value, field = 'timestamp') {
  assertRfc3339Milliseconds(value, field);
  return Date.parse(value);
}

function assertUuidV4(value, field = 'uuid') {
  if (
    typeof value !== 'string'
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
  ) fail(ERROR_CODES.INVALID_UUID, `Invalid lowercase RFC 9562 UUIDv4: ${field}`, field);
  return value;
}

function createCanonicalActualPostingRuntimeContract(input = { authorities: null, enabled: false, version: 1 }) {
  const inert = materializeInert(input, 'runtimeContract');
  assertExactObjectKeys(inert, ['authorities', 'enabled', 'version'], 'runtimeContract');
  if (inert.version !== 1 || typeof inert.enabled !== 'boolean') {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Invalid runtime contract version or state.', 'runtimeContract');
  }
  if (!inert.enabled) {
    if (inert.authorities !== null) {
      fail(ERROR_CODES.ENVELOPE_INVALID, 'Disabled runtime contract must not carry authority identities.');
    }
  } else {
    assertExactObjectKeys(inert.authorities, RUNTIME_AUTHORITY_KINDS, 'runtimeContract.authorities');
    for (const kind of RUNTIME_AUTHORITY_KINDS) {
      const authority = inert.authorities[kind];
      assertExactObjectKeys(
        authority,
        RUNTIME_AUTHORITY_CONTRACT_KEYS,
        `runtimeContract.authorities.${kind}`,
      );
      assertIdentifier(authority.artifactDigest, `${kind}.artifactDigest`);
      assertIdentifier(authority.sourceCommitSha, `${kind}.sourceCommitSha`);
      assertHash(authority.configurationHash, `${kind}.configurationHash`);
      assertHash(authority.policyHash, `${kind}.policyHash`);
    }
  }
  const contract = Object.freeze(inert);
  RUNTIME_CONTRACTS.add(contract);
  return contract;
}

const DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT =
  createCanonicalActualPostingRuntimeContract({ authorities: null, enabled: false, version: 1 });

function assertCanonicalActualPostingRuntimeContract(contract) {
  if (!contract || !RUNTIME_CONTRACTS.has(contract)) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'A repository-owned runtime contract is required.', 'runtimeContract');
  }
  return contract;
}

function deriveRepositoryIdentity(domain, input) {
  assertIdentifier(domain, 'identityDomain');
  const inert = materializeInert(input, 'identityInput');
  return sha256Canonical({
    ...inert,
    domain,
    version: 1,
  });
}

function materializeInertValue(value, field, depth, ancestors, state) {
  if (depth > MAX_DEPTH) fail(ERROR_CODES.INPUT_LIMIT_EXCEEDED, 'Maximum depth exceeded.', field);
  state.nodes += 1;
  if (state.nodes > MAX_NODES) fail(ERROR_CODES.INPUT_LIMIT_EXCEEDED, 'Maximum node count exceeded.', field);

  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    assertUnicodeScalarString(value, field);
    return value;
  }
  if (typeof value === 'number') {
    assertSafeInteger(value, field);
    if (Object.is(value, -0)) fail(ERROR_CODES.INPUT_NOT_INERT, 'Negative zero is forbidden.', field);
    return value;
  }
  if (typeof value !== 'object' || types.isProxy(value) || ancestors.has(value)) {
    fail(ERROR_CODES.INPUT_NOT_INERT, 'Only deeply inert JSON is accepted.', field);
  }
  if (Object.getOwnPropertySymbols(value).length > 0) {
    fail(ERROR_CODES.INPUT_NOT_INERT, 'Symbols are forbidden.', field);
  }
  const array = Array.isArray(value);
  const prototype = Object.getPrototypeOf(value);
  if ((array && prototype !== Array.prototype) || (!array && prototype !== Object.prototype)) {
    fail(ERROR_CODES.INPUT_NOT_INERT, 'Custom prototypes are forbidden.', field);
  }
  if (
    Object.prototype.hasOwnProperty.call(value, 'toJSON')
    || Object.prototype.hasOwnProperty.call(prototype, 'toJSON')
  ) fail(ERROR_CODES.INPUT_NOT_INERT, 'toJSON is forbidden.', field);

  const descriptors = Object.getOwnPropertyDescriptors(value);
  ancestors.add(value);
  try {
    if (array) {
      const length = descriptors.length?.value;
      const names = Object.keys(descriptors).filter(key => key !== 'length');
      if (!Number.isSafeInteger(length) || length < 0 || names.length !== length) {
        fail(ERROR_CODES.INPUT_NOT_INERT, 'Sparse arrays are forbidden.', field);
      }
      const result = [];
      for (let index = 0; index < length; index += 1) {
        const descriptor = descriptors[String(index)];
        if (!descriptor?.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
          fail(ERROR_CODES.INPUT_NOT_INERT, 'Array accessors are forbidden.', `${field}[${index}]`);
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
    for (const key of Object.keys(descriptors)) {
      assertUnicodeScalarString(key, `${field}.key`);
      const descriptor = descriptors[key];
      if (!descriptor.enumerable || !Object.prototype.hasOwnProperty.call(descriptor, 'value')) {
        fail(ERROR_CODES.INPUT_NOT_INERT, 'Object accessors are forbidden.', `${field}.${key}`);
      }
      Object.defineProperty(result, key, {
        configurable: false,
        enumerable: true,
        writable: false,
        value: materializeInertValue(descriptor.value, `${field}.${key}`, depth + 1, ancestors, state),
      });
    }
    return Object.freeze(result);
  } finally {
    ancestors.delete(value);
  }
}

function materializeInert(value, field = 'value') {
  const result = materializeInertValue(value, field, 0, new Set(), { nodes: 0 });
  const bytes = Buffer.byteLength(canonicalJsonUnchecked(result), 'utf8');
  if (bytes > MAX_CANONICAL_BYTES) {
    fail(ERROR_CODES.INPUT_LIMIT_EXCEEDED, 'Maximum canonical byte size exceeded.', field);
  }
  return result;
}

function canonicalJsonUnchecked(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJsonUnchecked).join(',')}]`;
  const keys = Object.keys(value).sort(compareUtf16Ascending);
  return `{${keys.map(key => `${JSON.stringify(key)}:${canonicalJsonUnchecked(value[key])}`).join(',')}}`;
}

function canonicalJson(value) {
  return canonicalJsonUnchecked(materializeInert(value));
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function sha256Canonical(value) {
  return sha256Bytes(Buffer.from(canonicalJson(value), 'utf8'));
}

function decodeJsonInput(input) {
  if (typeof input === 'string') {
    if (input.charCodeAt(0) === 0xfeff || !hasValidUnicodeScalars(input)) {
      fail(ERROR_CODES.JSON_INVALID, 'Invalid Unicode or BOM in JSON input.');
    }
    return input;
  }
  if (Buffer.isBuffer(input) || input instanceof Uint8Array) {
    const bytes = Buffer.from(input);
    if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
      fail(ERROR_CODES.JSON_INVALID, 'A UTF-8 BOM is forbidden.');
    }
    try {
      const decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      if (!hasValidUnicodeScalars(decoded)) fail(ERROR_CODES.JSON_INVALID);
      return decoded;
    } catch (error) {
      if (error instanceof CanonicalActualPostingError) throw error;
      fail(ERROR_CODES.JSON_INVALID, 'JSON input is not shortest-form valid UTF-8.');
    }
  }
  fail(ERROR_CODES.JSON_INVALID, 'JSON input must be a string or UTF-8 bytes.');
}

class RestrictedJsonParser {
  constructor(text) {
    this.text = text;
    this.index = 0;
    this.nodes = 0;
  }

  fail() {
    fail(ERROR_CODES.JSON_INVALID, `Invalid JSON at byte-independent offset ${this.index}.`);
  }

  whitespace() {
    while (
      this.text[this.index] === ' '
      || this.text[this.index] === '\t'
      || this.text[this.index] === '\n'
      || this.text[this.index] === '\r'
    ) this.index += 1;
  }

  parse() {
    this.whitespace();
    const result = this.value(0);
    this.whitespace();
    if (this.index !== this.text.length) this.fail();
    return result;
  }

  countNode(depth) {
    this.nodes += 1;
    if (depth > MAX_DEPTH || this.nodes > MAX_NODES) {
      fail(ERROR_CODES.INPUT_LIMIT_EXCEEDED, 'Parsed JSON exceeds limits.');
    }
  }

  value(depth) {
    this.countNode(depth);
    const character = this.text[this.index];
    if (character === '{') return this.object(depth + 1);
    if (character === '[') return this.array(depth + 1);
    if (character === '"') return this.string();
    if (character === 't' && this.text.slice(this.index, this.index + 4) === 'true') {
      this.index += 4;
      return true;
    }
    if (character === 'f' && this.text.slice(this.index, this.index + 5) === 'false') {
      this.index += 5;
      return false;
    }
    if (character === 'n' && this.text.slice(this.index, this.index + 4) === 'null') {
      this.index += 4;
      return null;
    }
    if (character === '-' || (character >= '0' && character <= '9')) return this.number();
    this.fail();
  }

  string() {
    const start = this.index;
    this.index += 1;
    let escaped = false;
    while (this.index < this.text.length) {
      const code = this.text.charCodeAt(this.index);
      const character = this.text[this.index];
      if (!escaped && character === '"') {
        this.index += 1;
        let parsed;
        try {
          parsed = JSON.parse(this.text.slice(start, this.index));
        } catch {
          this.fail();
        }
        if (!hasValidUnicodeScalars(parsed)) this.fail();
        return parsed;
      }
      if (!escaped && code < 0x20) this.fail();
      if (!escaped && character === '\\') {
        escaped = true;
        this.index += 1;
        continue;
      }
      if (escaped) {
        if (character === 'u') {
          const hex = this.text.slice(this.index + 1, this.index + 5);
          if (!/^[0-9a-fA-F]{4}$/.test(hex)) this.fail();
          this.index += 5;
        } else if ('"\\/bfnrt'.includes(character)) {
          this.index += 1;
        } else {
          this.fail();
        }
        escaped = false;
        continue;
      }
      this.index += 1;
    }
    this.fail();
  }

  number() {
    const rest = this.text.slice(this.index);
    const match = /^-?(?:0|[1-9][0-9]*)/.exec(rest);
    if (!match) this.fail();
    const token = match[0];
    const next = rest[token.length];
    if (next === '.' || next === 'e' || next === 'E' || (next >= '0' && next <= '9')) this.fail();
    if (token === '-0') this.fail();
    const value = Number(token);
    if (!Number.isSafeInteger(value)) this.fail();
    this.index += token.length;
    return value;
  }

  array(depth) {
    const result = [];
    this.index += 1;
    this.whitespace();
    if (this.text[this.index] === ']') {
      this.index += 1;
      return result;
    }
    while (true) {
      result.push(this.value(depth));
      this.whitespace();
      if (this.text[this.index] === ']') {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ',') this.fail();
      this.index += 1;
      this.whitespace();
    }
  }

  object(depth) {
    const result = {};
    const keys = new Set();
    this.index += 1;
    this.whitespace();
    if (this.text[this.index] === '}') {
      this.index += 1;
      return result;
    }
    while (true) {
      if (this.text[this.index] !== '"') this.fail();
      const key = this.string();
      if (keys.has(key)) this.fail();
      keys.add(key);
      this.whitespace();
      if (this.text[this.index] !== ':') this.fail();
      this.index += 1;
      this.whitespace();
      result[key] = this.value(depth);
      this.whitespace();
      if (this.text[this.index] === '}') {
        this.index += 1;
        return result;
      }
      if (this.text[this.index] !== ',') this.fail();
      this.index += 1;
      this.whitespace();
    }
  }
}

function parseJson(input) {
  const text = decodeJsonInput(input);
  if (Buffer.byteLength(text, 'utf8') > MAX_CANONICAL_BYTES) {
    fail(ERROR_CODES.INPUT_LIMIT_EXCEEDED, 'JSON input exceeds byte limit.');
  }
  return new RestrictedJsonParser(text).parse();
}

function parseCanonicalJson(input, field = 'json') {
  const text = decodeJsonInput(input);
  const value = parseJson(text);
  if (canonicalJson(value) !== text) {
    fail(ERROR_CODES.JSON_NOT_CANONICAL, `JSON is not canonical: ${field}`, field);
  }
  return value;
}

const GOVERNED_AUTHORITY_HASH_FIELDS = Object.freeze([
  'actorId', 'allowedOperation', 'approvalHash', 'approvalRef', 'artifactDigest',
  'authorityId', 'authorityVersion', 'branchId', 'companyId', 'configurationHash',
  'credentialFingerprint', 'credentialIssuerRef', 'credentialType', 'effectiveFrom',
  'environment', 'expiresAt', 'authorityKind', 'ownerRef', 'policyHash',
  'previousRecordId', 'revocationReasonCode', 'schemaVersion', 'sourceCommitSha',
  'sourceOwnershipManifestHash', 'sourceRowClassesJson', 'sourceSystemIdsJson', 'status',
]);

const WRITE_AUTHORIZATION_HASH_FIELDS = Object.freeze([
  'acceptedCompanyTimezoneSnapshot', 'acceptedDryRunsHash', 'acceptedDryRunsJson',
  'acceptedPr8EvidenceHash', 'acceptedPr8EvidenceJson', 'activationBoundaryId',
  'activationCohortRef', 'amountBasisPolicyHash', 'amountBasisPolicyRef',
  'approvalSetJson', 'authorizationId', 'authorizationVersion', 'backupEvidenceRef',
  'boundaryHash', 'branchId', 'cohortHash', 'companyId', 'denialEvidencePermission',
  'denialEvidenceTable', 'denialTransitionPermission', 'denialTransitionTable',
  'dueDatePolicySetHash', 'dueDatePolicySetJson', 'effectiveFrom', 'eventSchemaVersion',
  'evidencePackHash', 'expiresAt', 'forbiddenOperationsJson',
  'acceptedFreshnessWindowsHash', 'operationType', 'operationalControlRef',
  'policyManifestHashesJson', 'postingAdapterAuthorityBranchId',
  'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityKind',
  'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityRecordId',
  'postingAdapterAuthorityVersion', 'previousRecordId', 'primaryEffectTablesJson',
  'producerAuthorityBranchId', 'producerAuthorityCompanyId', 'producerAuthorityKind',
  'producerAuthorityRecordHash', 'producerAuthorityRecordId', 'producerAuthorityVersion',
  'retentionControlRef', 'revocationReasonCode', 'schemaVersion',
  'sourceAdapterAuthorityRecordHash', 'sourceAdapterAuthorityRecordId',
  'sourceAdapterAuthorityVersion', 'sourceOwnershipManifestHash', 'sourceSystemIdsJson',
  'status',
]);

const ACTIVATION_HASH_FIELDS = Object.freeze([
  'acceptedDryRunsHash', 'acceptedPr8EvidenceHash', 'activationBoundaryId',
  'activationId', 'activationVersion', 'allowedDocumentClassesJson',
  'allowedRentalClassesJson', 'approvalHash', 'approvalRef', 'boundaryEndUtc',
  'boundaryHash', 'branchId', 'cohortHash', 'companyId', 'companyTimezoneSnapshot',
  'currency', 'dueDatePolicySetHash', 'dueDatePolicySetJson', 'effectiveFrom',
  'explicitExclusionsJson', 'expiresAt', 'acceptedFreshnessWindowsHash',
  'forwardOnlyStartDate', 'forwardOnlyStartUtc', 'policyManifestHashesJson',
  'postingAdapterAuthorityBranchId', 'postingAdapterAuthorityCompanyId',
  'postingAdapterAuthorityKind', 'postingAdapterAuthorityRecordHash',
  'postingAdapterAuthorityRecordId', 'postingAdapterAuthorityVersion',
  'previousRecordId', 'revocationReasonCode', 'schemaVersion', 'sourceSystemIdsJson',
  'status', 'writeAuthorizationRecordId',
]);

const ELIGIBLE_EVENT_HASH_FIELDS = Object.freeze(
  REQUIRED_COLUMNS[ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE]
    .filter(field => field !== 'id' && field !== 'eventHash'),
);

function exactEnvelope(source, fields, domain) {
  const inert = materializeInert(source, domain);
  const result = { domain };
  for (const field of fields) {
    if (!Object.prototype.hasOwnProperty.call(inert, field)) {
      fail(ERROR_CODES.ENVELOPE_INVALID, `Missing envelope field: ${field}`, field);
    }
    result[field] = inert[field];
  }
  result.version = 1;
  return materializeInert(result, domain);
}

function assertExactObjectKeys(value, keys, field = 'envelope') {
  const actual = Object.keys(value).sort(compareUtf16Ascending);
  const expected = [...keys].sort(compareUtf16Ascending);
  if (actual.length !== expected.length) fail(ERROR_CODES.ENVELOPE_INVALID, `Unexpected keys: ${field}`, field);
  for (let index = 0; index < expected.length; index += 1) {
    if (actual[index] !== expected[index]) fail(ERROR_CODES.ENVELOPE_INVALID, `Unexpected keys: ${field}`, field);
  }
  return value;
}

function hashEnvelope(source, fields, domain) {
  const envelope = exactEnvelope(source, fields, domain);
  return { envelope, canonicalJson: canonicalJson(envelope), hash: sha256Canonical(envelope) };
}

function governedAuthorityRecordEnvelope(record) {
  return exactEnvelope(
    record,
    GOVERNED_AUTHORITY_HASH_FIELDS,
    'rentcore.governed_adapter_authority.record',
  );
}

function computeGovernedAuthorityRecordHash(record) {
  return sha256Canonical(governedAuthorityRecordEnvelope(record));
}

function writeAuthorizationEnvelope(record) {
  return exactEnvelope(
    record,
    WRITE_AUTHORIZATION_HASH_FIELDS,
    'rentcore.canonical_actual_posting.write_authorization',
  );
}

function computeWriteAuthorizationRecordHash(record) {
  return sha256Canonical(writeAuthorizationEnvelope(record));
}

function activationEnvelope(record) {
  return exactEnvelope(record, ACTIVATION_HASH_FIELDS, 'rentcore.canonical_actual_posting.activation');
}

function computeActivationRecordHash(record) {
  return sha256Canonical(activationEnvelope(record));
}

function eligibleEventEnvelope(record) {
  return exactEnvelope(record, ELIGIBLE_EVENT_HASH_FIELDS, 'rentcore.canonical_actual_posting.eligible_event');
}

function computeEligibleEventHash(record) {
  return sha256Canonical(eligibleEventEnvelope(record));
}

function computeAuthorityId({ actorId, authorityKind, branchId, companyId }) {
  assertIdentifier(actorId, 'actorId');
  assertIdentifier(authorityKind, 'authorityKind');
  assertIdentifier(branchId, 'branchId');
  assertIdentifier(companyId, 'companyId');
  return `authority-chain:${sha256Canonical({
    actorId,
    authorityKind,
    branchId,
    companyId,
    domain: 'rentcore.governed_adapter_authority.chain',
    version: 1,
  })}`;
}

function normalizeSortedUniqueStrings(values, field, { allowEmpty = false } = {}) {
  if (!Array.isArray(values) || (!allowEmpty && values.length === 0)) {
    fail(ERROR_CODES.ENVELOPE_INVALID, `Expected non-empty array: ${field}`, field);
  }
  const result = values.map((value, index) => {
    assertIdentifier(value, `${field}[${index}]`);
    return value;
  }).sort(compareUtf16Ascending);
  for (let index = 1; index < result.length; index += 1) {
    if (result[index - 1] === result[index]) fail(ERROR_CODES.ENVELOPE_INVALID, `Duplicate value: ${field}`, field);
  }
  return Object.freeze(result);
}

function acceptedDryRunsEnvelope(acceptedDryRuns) {
  if (!Array.isArray(acceptedDryRuns) || acceptedDryRuns.length === 0) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'acceptedDryRuns must be non-empty.', 'acceptedDryRuns');
  }
  const normalized = acceptedDryRuns.map((entry, index) => {
    const inert = materializeInert(entry, `acceptedDryRuns[${index}]`);
    assertExactObjectKeys(inert, ['dryRunId', 'resultHash'], `acceptedDryRuns[${index}]`);
    assertIdentifier(inert.dryRunId, `acceptedDryRuns[${index}].dryRunId`);
    assertHash(inert.resultHash, `acceptedDryRuns[${index}].resultHash`);
    return { dryRunId: inert.dryRunId, resultHash: inert.resultHash };
  }).sort((left, right) => compareUtf16Ascending(left.dryRunId, right.dryRunId));
  for (let index = 1; index < normalized.length; index += 1) {
    if (normalized[index - 1].dryRunId === normalized[index].dryRunId) {
      fail(ERROR_CODES.ENVELOPE_INVALID, 'Duplicate dryRunId.', 'acceptedDryRuns');
    }
  }
  return materializeInert({
    acceptedDryRuns: normalized,
    domain: 'rentcore.canonical_actual_posting.accepted_dry_runs',
    version: 1,
  });
}

function computeAcceptedDryRunsHash(acceptedDryRuns) {
  return sha256Canonical(acceptedDryRunsEnvelope(acceptedDryRuns));
}

const ACCEPTED_PR8_RUN_FIELDS = Object.freeze([
  'companyTimezoneSnapshot', 'dryRunId', 'finalizedAt', 'freshnessDurationMs',
  'freshnessPolicyHash', 'freshnessPolicyId', 'freshnessPolicyVersion',
  'freshnessWindowFingerprint', 'policyManifestHash', 'reconciliationSetHash',
  'resultHash', 'sourceInputManifestHash', 'sourceOwnershipManifestHash', 'validFrom',
  'validUntilExclusive',
]);
const ACCEPTED_PR8_CHECK_IDENTITY_SEAL_FIELD = 'checkIdentitySetHash';

function acceptedPr8EvidenceEnvelope({
  acceptedDryRunsHash,
  acceptedFreshnessWindowsHash,
  acceptedRuns,
  evidencePackHash,
}) {
  assertHash(acceptedDryRunsHash, 'acceptedDryRunsHash');
  assertHash(acceptedFreshnessWindowsHash, 'acceptedFreshnessWindowsHash');
  assertHash(evidencePackHash, 'evidencePackHash');
  if (!Array.isArray(acceptedRuns) || acceptedRuns.length === 0) fail(ERROR_CODES.ENVELOPE_INVALID);
  const runs = acceptedRuns.map((run, index) => {
    const inert = materializeInert(run, `acceptedRuns[${index}]`);
    const fields = Object.prototype.hasOwnProperty.call(
      inert,
      ACCEPTED_PR8_CHECK_IDENTITY_SEAL_FIELD,
    )
      ? [...ACCEPTED_PR8_RUN_FIELDS, ACCEPTED_PR8_CHECK_IDENTITY_SEAL_FIELD]
      : ACCEPTED_PR8_RUN_FIELDS;
    assertExactObjectKeys(inert, fields, `acceptedRuns[${index}]`);
    assertIdentifier(inert.dryRunId, 'dryRunId');
    for (const field of [
      'freshnessPolicyHash', 'freshnessWindowFingerprint', 'policyManifestHash',
      'reconciliationSetHash', 'resultHash', 'sourceInputManifestHash',
      'sourceOwnershipManifestHash',
    ]) assertHash(inert[field], field);
    if (Object.prototype.hasOwnProperty.call(inert, ACCEPTED_PR8_CHECK_IDENTITY_SEAL_FIELD)) {
      assertHash(inert[ACCEPTED_PR8_CHECK_IDENTITY_SEAL_FIELD], ACCEPTED_PR8_CHECK_IDENTITY_SEAL_FIELD);
    }
    assertSafeInteger(inert.freshnessDurationMs, 'freshnessDurationMs', { minimum: 1 });
    assertSafeInteger(inert.freshnessPolicyVersion, 'freshnessPolicyVersion', { minimum: 1 });
    assertRfc3339Milliseconds(inert.finalizedAt, 'finalizedAt');
    assertRfc3339Milliseconds(inert.validFrom, 'validFrom');
    assertRfc3339Milliseconds(inert.validUntilExclusive, 'validUntilExclusive');
    return inert;
  }).sort((left, right) => compareUtf16Ascending(left.dryRunId, right.dryRunId));
  for (let index = 1; index < runs.length; index += 1) {
    if (runs[index - 1].dryRunId === runs[index].dryRunId) fail(ERROR_CODES.ENVELOPE_INVALID);
  }
  return materializeInert({
    acceptedDryRunsHash,
    acceptedFreshnessWindowsHash,
    acceptedRuns: runs,
    domain: 'rentcore.canonical_actual_posting.accepted_pr8_evidence',
    evidencePackHash,
    version: 1,
  });
}

function computeAcceptedPr8EvidenceHash(input) {
  return sha256Canonical(acceptedPr8EvidenceEnvelope(input));
}

function unknownDueDateMappingEnvelope() {
  return Object.freeze({
    agingTreatment: 'excluded_from_aging',
    contractualDueDate: null,
    domain: 'rentcore.canonical_actual_posting.unknown_due_date_mapping',
    mappingId: 'rentcore.unknown_due_date_posting_treatment.v1',
    mappingVersion: 1,
    postingTreatment: 'post_without_aging_v1',
    sourceDecisionLiteral: 'allow_unknown_without_aging',
    sourceGateKind: 'unknown_due_date_treatment',
    version: 1,
  });
}

function computeUnknownDueDateMappingHash() {
  return sha256Canonical(unknownDueDateMappingEnvelope());
}

function dueDatePolicySetEnvelope(policySet) {
  const inert = materializeInert(policySet, 'dueDatePolicySet');
  assertExactObjectKeys(inert, ['contractualDueDate', 'unknownDueDateTreatment'], 'dueDatePolicySet');
  assertExactObjectKeys(
    inert.contractualDueDate,
    ['expectedSourceRef', 'gateKind', 'policyHash', 'policyId', 'policyVersion'],
    'contractualDueDate',
  );
  assertExactObjectKeys(
    inert.unknownDueDateTreatment,
    ['decisionLiteral', 'gateKind', 'mappingHash', 'mappingId', 'mappingVersion', 'policyHash', 'policyId', 'policyVersion'],
    'unknownDueDateTreatment',
  );
  if (inert.contractualDueDate.gateKind !== 'contractual_due_date') fail(ERROR_CODES.ENVELOPE_INVALID);
  if (inert.unknownDueDateTreatment.gateKind !== 'unknown_due_date_treatment') fail(ERROR_CODES.ENVELOPE_INVALID);
  if (inert.unknownDueDateTreatment.decisionLiteral !== 'allow_unknown_without_aging') fail(ERROR_CODES.ENVELOPE_INVALID);
  if (inert.unknownDueDateTreatment.mappingId !== 'rentcore.unknown_due_date_posting_treatment.v1') fail(ERROR_CODES.ENVELOPE_INVALID);
  if (inert.unknownDueDateTreatment.mappingVersion !== 1) fail(ERROR_CODES.ENVELOPE_INVALID);
  if (inert.unknownDueDateTreatment.mappingHash !== computeUnknownDueDateMappingHash()) fail(ERROR_CODES.ENVELOPE_INVALID);
  for (const member of [inert.contractualDueDate, inert.unknownDueDateTreatment]) {
    assertIdentifier(member.policyId, 'policyId');
    assertSafeInteger(member.policyVersion, 'policyVersion', { minimum: 1 });
    assertHash(member.policyHash, 'policyHash');
  }
  return materializeInert({
    contractualDueDate: inert.contractualDueDate,
    domain: 'rentcore.canonical_actual_posting.due_date_policy_set',
    unknownDueDateTreatment: inert.unknownDueDateTreatment,
    version: 1,
  });
}

function computeDueDatePolicySetHash(policySet) {
  return sha256Canonical(dueDatePolicySetEnvelope(policySet));
}

function computeArtifactIdentityHash({ artifactDigest, sourceCommitSha }) {
  assertIdentifier(artifactDigest, 'artifactDigest');
  assertIdentifier(sourceCommitSha, 'sourceCommitSha');
  return sha256Canonical({
    artifactDigest,
    domain: 'rentcore.governed_adapter_authority.artifact_identity',
    sourceCommitSha,
    version: 1,
  });
}

function computeCoverageLineageRootId({
  branchId,
  companyId,
  rootCoverageSetId,
  rootCoverageSliceId,
  rootSourceDocumentLineageId,
}) {
  return `coverage-lineage:${sha256Canonical({
    branchId,
    companyId,
    domain: 'rentcore.canonical_actual_posting.coverage_lineage_root',
    rootCoverageSetId,
    rootCoverageSliceId,
    rootSourceDocumentLineageId,
    version: 1,
  })}`;
}

function computeEconomicLineageKey({
  branchId,
  companyId,
  contractId,
  coverageEndExclusive,
  coverageStart,
  currency,
  economicRowClass = 'conducted_upd_validated_coverage_slice_v1',
  rentalId,
  rentalLineId,
  rootCoverageLineageId,
  rootSourceDocumentLineageId,
  schemaVersion = 1,
  sourceSystem = 'rentcore.billing_source_authority.v1',
}) {
  return sha256Canonical({
    branchId,
    companyId,
    contractId: contractId ?? null,
    coverageEndExclusive,
    coverageStart,
    currency,
    domain: 'rentcore.canonical_actual_posting.economic_lineage_key',
    economicRowClass,
    rentalId,
    rentalLineId,
    rootCoverageLineageId,
    rootSourceDocumentLineageId,
    schemaVersion,
    sourceSystem,
    version: 1,
  });
}

function computeEconomicLineageCandidateFingerprint({
  branchId,
  companyId,
  contractId,
  coverageEndExclusive,
  coverageStart,
  currency,
  economicRowClass = 'conducted_upd_validated_coverage_slice_v1',
  rentalId,
  rentalLineId,
  sourceSystem = 'rentcore.billing_source_authority.v1',
}) {
  return sha256Canonical({
    branchId,
    companyId,
    contractId: contractId ?? null,
    coverageEndExclusive,
    coverageStart,
    currency,
    domain: 'rentcore.canonical_actual_posting.economic_lineage_candidate',
    economicRowClass,
    rentalId,
    rentalLineId,
    sourceSystem,
    version: 1,
  });
}

function computeEconomicSourceRevisionKey({
  branchId,
  companyId,
  conductedUpdVersionId,
  coverageSetId,
  coverageSliceId,
  currentPr6RevisionHash,
  economicLineageKey,
  formedUpdVersionId,
  updLineVersionId,
}) {
  return sha256Canonical({
    branchId,
    companyId,
    conductedUpdVersionId,
    coverageSetId,
    coverageSliceId,
    currentPr6RevisionHash,
    domain: 'rentcore.canonical_actual_posting.economic_source_revision',
    economicLineageKey,
    formedUpdVersionId,
    updLineVersionId,
    version: 1,
  });
}

const SOURCE_LINEAGE_FIELDS = Object.freeze([
  'acceptedDryRunsHash', 'activationBoundaryId', 'branchId', 'candidateId',
  'candidateResultHash', 'closedPeriodVersionId', 'companyId', 'completeInputSetHash',
  'conductedUpdVersionId', 'coverageSetId', 'coverageSliceId', 'dryRunId',
  'formedUpdVersionId', 'periodId', 'pr6LineageRows', 'snapshotId',
  'sourceAdapterAuthority', 'sourceOwnershipManifestHash', 'sourceSystem', 'updId',
  'updLineId', 'updLineVersionId',
]);

function sourceLineageEnvelope(projection) {
  return exactEnvelope(
    projection,
    SOURCE_LINEAGE_FIELDS,
    'rentcore.canonical_actual_posting.source_lineage',
  );
}

function computeSourceLineageHash(projection) {
  return sha256Canonical(sourceLineageEnvelope(projection));
}

function canonicalPostingCohortEnvelope(input) {
  return materializeInert({
    allowedDocumentClasses: normalizeSortedUniqueStrings(input.allowedDocumentClasses, 'allowedDocumentClasses'),
    allowedRentalClasses: normalizeSortedUniqueStrings(input.allowedRentalClasses, 'allowedRentalClasses'),
    branchIds: normalizeSortedUniqueStrings(input.branchIds, 'branchIds'),
    cohortVersion: 1,
    companyId: input.companyId,
    currency: input.currency,
    domain: 'rentcore.canonical_actual_posting.cohort',
    explicitExclusions: normalizeSortedUniqueStrings(input.explicitExclusions, 'explicitExclusions', { allowEmpty: true }),
    forwardOnlyStartDate: input.forwardOnlyStartDate,
    policyManifestHashes: normalizeSortedUniqueStrings(input.policyManifestHashes, 'policyManifestHashes'),
    sourceSystems: normalizeSortedUniqueStrings(input.sourceSystems, 'sourceSystems'),
    version: 1,
  });
}

function computeCanonicalPostingCohortHash(input) {
  return sha256Canonical(canonicalPostingCohortEnvelope(input));
}

function canonicalPostingBoundaryEnvelope(input) {
  if (input.boundaryEndUtc !== null) fail(ERROR_CODES.ENVELOPE_INVALID, 'boundaryEndUtc must be null.');
  return materializeInert({
    boundaryEndUtc: null,
    boundaryVersion: 1,
    branchIds: normalizeSortedUniqueStrings(input.branchIds, 'branchIds'),
    companyId: input.companyId,
    companyTimezoneSnapshot: input.companyTimezoneSnapshot,
    currency: input.currency,
    domain: 'rentcore.canonical_actual_posting.boundary',
    exclusionRules: normalizeSortedUniqueStrings(input.exclusionRules, 'exclusionRules', { allowEmpty: true }),
    forwardOnlyStartDate: input.forwardOnlyStartDate,
    forwardOnlyStartUtc: input.forwardOnlyStartUtc,
    sourceClass: 'conducted_upd_validated_coverage_slice_v1',
    sourceSystems: normalizeSortedUniqueStrings(input.sourceSystems, 'sourceSystems'),
    version: 1,
  });
}

function computeCanonicalPostingBoundaryHash(input) {
  return sha256Canonical(canonicalPostingBoundaryEnvelope(input));
}

function assertCanonicalJsonColumn(value, expectedType, field) {
  const parsed = parseCanonicalJson(value, field);
  if (expectedType === 'array' && !Array.isArray(parsed)) fail(ERROR_CODES.ENVELOPE_INVALID, field, field);
  if (expectedType === 'object' && (parsed === null || Array.isArray(parsed) || typeof parsed !== 'object')) {
    fail(ERROR_CODES.ENVELOPE_INVALID, field, field);
  }
  return parsed;
}

function assertGovernedAuthorityRecord(record, frozenHash = null) {
  const inert = materializeInert(record, 'authorityRecord');
  for (const field of [
    'recordId', 'authorityId', 'authorityKind', 'actorId', 'companyId', 'branchId',
    'artifactDigest', 'sourceCommitSha', 'ownerRef', 'approvalRef',
  ]) assertIdentifier(inert[field], field);
  assertSafeInteger(inert.authorityVersion, 'authorityVersion', { minimum: 1 });
  if (!['source_adapter', 'eligibility_producer', 'canonical_posting_adapter'].includes(inert.authorityKind)) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Invalid authorityKind.', 'authorityKind');
  }
  if (!['authorized', 'revoked', 'expired', 'superseded'].includes(inert.status)) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Invalid authority status.', 'status');
  }
  if (inert.environment !== 'production' || inert.credentialType !== 'none_same_process_repository_owned') {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Invalid authority environment/credential mode.');
  }
  if (inert.credentialFingerprint !== null || inert.credentialIssuerRef !== null) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Credential material is forbidden.');
  }
  const expectedOperation = {
    source_adapter: 'source_lineage.read.v1',
    eligibility_producer: 'actual_receivable_eligible.append.v1',
    canonical_posting_adapter: 'canonical_receivable.initial_post.v1',
  }[inert.authorityKind];
  if (inert.allowedOperation !== expectedOperation) fail(ERROR_CODES.ENVELOPE_INVALID, 'Invalid operation.');
  assertCanonicalJsonColumn(inert.sourceSystemIdsJson, 'array', 'sourceSystemIdsJson');
  assertCanonicalJsonColumn(inert.sourceRowClassesJson, 'array', 'sourceRowClassesJson');
  for (const field of [
    'configurationHash', 'policyHash', 'sourceOwnershipManifestHash', 'approvalHash', 'recordHash',
  ]) assertHash(inert[field], field);
  assertRfc3339Milliseconds(inert.effectiveFrom, 'effectiveFrom');
  assertRfc3339Milliseconds(inert.expiresAt, 'expiresAt');
  assertRfc3339Milliseconds(inert.createdAt, 'createdAt');
  const effective = parseUtcMilliseconds(inert.effectiveFrom);
  const expires = parseUtcMilliseconds(inert.expiresAt);
  if (!(effective < expires) || expires - effective > 86_400_000) fail(ERROR_CODES.ENVELOPE_INVALID, 'Invalid authority interval.');
  const expectedAuthorityId = computeAuthorityId(inert);
  if (inert.authorityId !== expectedAuthorityId) fail(ERROR_CODES.ENVELOPE_INVALID, 'Authority ID mismatch.');
  if ((inert.authorityVersion === 1) !== (inert.previousRecordId === null)) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Authority predecessor mismatch.');
  }
  if ((inert.status === 'authorized') !== (inert.revocationReasonCode === null)) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Authority lifecycle reason mismatch.');
  }
  const recomputed = computeGovernedAuthorityRecordHash(inert);
  if (recomputed !== inert.recordHash || (frozenHash !== null && recomputed !== frozenHash)) {
    fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  }
  return inert;
}

function authorityRecordComparator(left, right) {
  const version = compareSafeIntegerAscending(left.authorityVersion, right.authorityVersion);
  if (version !== 0) return version;
  return compareUtf16Ascending(left.recordId, right.recordId);
}

function buildFrozenAuthorityMember(record, predecessor) {
  return materializeInert({
    actorId: record.actorId,
    artifactIdentityHash: computeArtifactIdentityHash(record),
    authorityId: record.authorityId,
    authorityKind: record.authorityKind,
    authorityRecordHash: record.recordHash,
    authorityRecordId: record.recordId,
    authorityVersion: record.authorityVersion,
    branchId: record.branchId,
    companyId: record.companyId,
    configurationHash: record.configurationHash,
    effectiveFrom: record.effectiveFrom,
    effectiveUntil: record.expiresAt,
    lifecycleStatus: record.status,
    ownershipManifestHash: record.sourceOwnershipManifestHash,
    policyHash: record.policyHash,
    predecessorRecordHash: predecessor?.recordHash ?? null,
    predecessorRecordId: predecessor?.recordId ?? null,
    predecessorVersion: predecessor?.authorityVersion ?? null,
  });
}

function normalizeAuthorityCandidates(candidates, members) {
  if (!Array.isArray(candidates)) fail(ERROR_CODES.ENVELOPE_INVALID, 'candidates');
  const memberById = new Map(members.map(member => [member.authorityRecordId, member]));
  const normalized = candidates.map((candidate, index) => {
    const inert = materializeInert(candidate, `candidates[${index}]`);
    assertExactObjectKeys(
      inert,
      ['authorityRecordHash', 'authorityRecordId', 'authorityVersion', 'precedenceRank', 'stateCode'],
      `candidates[${index}]`,
    );
    assertIdentifier(inert.authorityRecordId, 'authorityRecordId');
    assertHash(inert.authorityRecordHash, 'authorityRecordHash');
    assertSafeInteger(inert.authorityVersion, 'authorityVersion', { minimum: 1 });
    assertSafeInteger(inert.precedenceRank, 'precedenceRank', { minimum: 0 });
    assertIdentifier(inert.stateCode, 'stateCode');
    const member = memberById.get(inert.authorityRecordId);
    if (
      !member
      || member.authorityVersion !== inert.authorityVersion
      || member.authorityRecordHash !== inert.authorityRecordHash
    ) fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
    return {
      authorityRecordHash: inert.authorityRecordHash,
      authorityRecordId: inert.authorityRecordId,
      authorityVersion: inert.authorityVersion,
      precedenceRank: inert.precedenceRank,
      stateCode: inert.stateCode,
    };
  }).sort(compareAuthorityDenialCandidate);
  for (let index = 1; index < normalized.length; index += 1) {
    const previous = normalized[index - 1];
    const current = normalized[index];
    if (
      previous.precedenceRank === current.precedenceRank
      && previous.authorityVersion === current.authorityVersion
      && previous.authorityRecordId === current.authorityRecordId
    ) fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  }
  return normalized;
}

function createFrozenAuthorityChainSnapshot({
  authorityRows,
  candidates = [],
  denialAttemptId,
  deniedAttemptedAt,
  precedenceState,
}) {
  assertUuidV4(denialAttemptId, 'denialAttemptId');
  assertRfc3339Milliseconds(deniedAttemptedAt, 'deniedAttemptedAt');
  if (!Array.isArray(authorityRows) || authorityRows.length === 0) {
    fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  }
  const rows = authorityRows.map(row => assertGovernedAuthorityRecord(row)).sort(authorityRecordComparator);
  const first = rows[0];
  const members = [];
  for (let index = 0; index < rows.length; index += 1) {
    const row = rows[index];
    const predecessor = rows[index - 1] || null;
    if (
      row.companyId !== first.companyId
      || row.branchId !== first.branchId
      || row.authorityKind !== first.authorityKind
      || row.authorityId !== first.authorityId
      || row.authorityVersion !== index + 1
      || (predecessor === null && row.previousRecordId !== null)
      || (predecessor !== null && row.previousRecordId !== predecessor.recordId)
    ) fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
    members.push(buildFrozenAuthorityMember(row, predecessor));
  }
  const normalizedCandidates = normalizeAuthorityCandidates(candidates, members);
  if (!['selected', 'suppressed_by_higher_kind', 'unaffected_active_latest'].includes(precedenceState)) {
    fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  }
  if (
    (precedenceState === 'selected' && normalizedCandidates.length === 0)
    || (precedenceState === 'suppressed_by_higher_kind' && normalizedCandidates.length === 0)
    || (precedenceState === 'unaffected_active_latest' && normalizedCandidates.length !== 0)
  ) fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  const head = rows[rows.length - 1];
  if (precedenceState === 'unaffected_active_latest') {
    const attempted = parseUtcMilliseconds(deniedAttemptedAt);
    if (
      head.status !== 'authorized'
      || attempted < parseUtcMilliseconds(head.effectiveFrom)
      || attempted >= parseUtcMilliseconds(head.expiresAt)
    ) fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  }
  const completeMembersHash = sha256Canonical({
    authorityId: first.authorityId,
    authorityKind: first.authorityKind,
    branchId: first.branchId,
    companyId: first.companyId,
    domain: 'rentcore.canonical_actual_posting.frozen_authority_chain_members',
    members,
    version: 1,
  });
  const candidateSetHash = sha256Canonical({
    authorityId: first.authorityId,
    authorityKind: first.authorityKind,
    branchId: first.branchId,
    candidates: normalizedCandidates,
    companyId: first.companyId,
    deniedAttemptedAt,
    denialAttemptId,
    domain: 'rentcore.canonical_actual_posting.frozen_authority_candidates',
    version: 1,
  });
  const visibilityQueryContractHash = sha256Canonical({
    authorityId: first.authorityId,
    authorityKind: first.authorityKind,
    branchId: first.branchId,
    companyId: first.companyId,
    domain: 'rentcore.canonical_actual_posting.authority_visibility_query',
    order: ['authorityVersion', 'authorityRecordId'],
    version: 1,
  });
  const boundary = materializeInert({
    authorityId: first.authorityId,
    authorityKind: first.authorityKind,
    branchId: first.branchId,
    companyId: first.companyId,
    deniedAttemptedAt,
    denialAttemptId,
    frozenHeadAuthorityRecordHash: head.recordHash,
    frozenHeadAuthorityRecordId: head.recordId,
    frozenHeadAuthorityVersion: head.authorityVersion,
    maximumObservedAuthorityVersion: head.authorityVersion,
    rootAuthorityRecordHash: first.recordHash,
    rootAuthorityRecordId: first.recordId,
    rootAuthorityVersion: first.authorityVersion,
    visibilityQueryContractHash,
  });
  const snapshotBoundaryHash = sha256Canonical({
    boundary,
    candidateSetHash,
    completeMembersHash,
    denialAttemptId,
    domain: 'rentcore.canonical_actual_posting.frozen_authority_chain_boundary',
    version: 1,
  });
  const snapshot = materializeInert({
    boundary,
    candidateSetHash,
    candidates: normalizedCandidates,
    completeMembersHash,
    domain: 'rentcore.canonical_actual_posting.frozen_authority_chain_snapshot',
    memberCount: members.length,
    members,
    precedenceState,
    selectedDenialCandidate: precedenceState === 'selected' ? normalizedCandidates[0] : null,
    snapshotBoundaryHash,
    version: 1,
  });
  return Object.freeze({
    snapshot,
    canonicalJson: canonicalJson(snapshot),
    hash: sha256Canonical(snapshot),
  });
}

function verifyFrozenAuthorityChainSnapshot({ snapshot, snapshotHash, persistedRows, expectedAuthorityKind }) {
  const inertSnapshot = typeof snapshot === 'string'
    ? parseCanonicalJson(snapshot, 'authorityChainSnapshot')
    : materializeInert(snapshot, 'authorityChainSnapshot');
  assertExactObjectKeys(inertSnapshot, [
    'boundary', 'candidateSetHash', 'candidates', 'completeMembersHash', 'domain',
    'memberCount', 'members', 'precedenceState', 'selectedDenialCandidate',
    'snapshotBoundaryHash', 'version',
  ], 'authorityChainSnapshot');
  if (
    inertSnapshot.domain !== 'rentcore.canonical_actual_posting.frozen_authority_chain_snapshot'
    || inertSnapshot.version !== 1
    || inertSnapshot.boundary.authorityKind !== expectedAuthorityKind
  ) fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  assertHash(snapshotHash, 'snapshotHash');
  if (sha256Canonical(inertSnapshot) !== snapshotHash) {
    fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  }
  const maximum = inertSnapshot.boundary.maximumObservedAuthorityVersion;
  assertSafeInteger(maximum, 'maximumObservedAuthorityVersion', { minimum: 1 });
  const allRows = persistedRows.map(row => assertGovernedAuthorityRecord(row)).sort(authorityRecordComparator);
  const sameChain = allRows.filter(row => (
    row.companyId === inertSnapshot.boundary.companyId
    && row.branchId === inertSnapshot.boundary.branchId
    && row.authorityKind === inertSnapshot.boundary.authorityKind
    && row.authorityId === inertSnapshot.boundary.authorityId
  ));
  for (let index = 0; index < sameChain.length; index += 1) {
    const row = sameChain[index];
    const predecessor = sameChain[index - 1] || null;
    if (row.authorityVersion !== index + 1 || row.previousRecordId !== (predecessor?.recordId ?? null)) {
      fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
    }
  }
  const frozenRows = sameChain.filter(row => row.authorityVersion <= maximum);
  if (frozenRows.length !== maximum) fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  const rebuilt = createFrozenAuthorityChainSnapshot({
    authorityRows: frozenRows,
    candidates: inertSnapshot.candidates,
    denialAttemptId: inertSnapshot.boundary.denialAttemptId,
    deniedAttemptedAt: inertSnapshot.boundary.deniedAttemptedAt,
    precedenceState: inertSnapshot.precedenceState,
  });
  if (rebuilt.hash !== snapshotHash || rebuilt.canonicalJson !== canonicalJson(inertSnapshot)) {
    fail(ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED);
  }
  return inertSnapshot;
}

const CONFLICT_HASH_FIELDS = Object.freeze([
  'acceptedDryRunsHash', 'acceptedPr8EvidenceHash', 'activationRecordHash',
  'activationRecordId', 'branchId', 'companyId', 'conflictObservationHash',
  'conflictType', 'detectorVersion', 'deniedAuthorityKind',
  'deniedAuthorityRecordHash', 'deniedAuthorityRecordId', 'deniedAuthorityVersion',
  'denialAttemptId', 'deniedAttemptedAt', 'economicLineageCandidateFingerprint',
  'economicLineageKey', 'economicSourceRevisionKey', 'eventHash', 'eventId',
  'existingOperationId', 'existingReceivableId', 'expectedFingerprint',
  'observedFingerprint', 'postingAdapterAuthorityBranchId',
  'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityKind',
  'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityRecordId',
  'postingAdapterAuthorityVersion', 'postingAuthorityChainSnapshotHash',
  'producerAuthorityBranchId', 'producerAuthorityCompanyId', 'producerAuthorityKind',
  'producerAuthorityRecordHash', 'producerAuthorityRecordId', 'producerAuthorityVersion',
  'producerAuthorityChainSnapshotHash', 'schemaVersion', 'sourceAdapterAuthorityRecordHash',
  'sourceAdapterAuthorityRecordId', 'sourceAdapterAuthorityVersion', 'sourceLineageHash',
  'sourceAuthorityChainSnapshotHash', 'sourceOwnershipManifestHash',
  'writeAuthorizationRecordHash', 'writeAuthorizationRecordId',
]);

function conflictSideFingerprint(conflictType, projection, side) {
  if (!CANONICAL_POSTING_CONFLICT_TYPES.includes(conflictType)) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Unknown conflict type.', 'conflictType');
  }
  if (side !== 'expected' && side !== 'observed') fail(ERROR_CODES.ENVELOPE_INVALID);
  return sha256Canonical({
    conflictType,
    domain: `rentcore.canonical_actual_posting.conflict_${side}`,
    projection: materializeInert(projection, `${side}Projection`),
    version: 1,
  });
}

function conflictObservationEnvelope({
  conflictType,
  denialAttemptId,
  deniedAttemptedAt,
  expectedProjection,
  observedProjection,
}) {
  if (!CANONICAL_POSTING_CONFLICT_TYPES.includes(conflictType)) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Unknown conflict type.', 'conflictType');
  }
  assertUuidV4(denialAttemptId, 'denialAttemptId');
  assertRfc3339Milliseconds(deniedAttemptedAt, 'deniedAttemptedAt');
  const expected = materializeInert(expectedProjection, 'expectedProjection');
  const observed = materializeInert(observedProjection, 'observedProjection');
  if (
    expected.denialAttemptId !== denialAttemptId
    || observed.denialAttemptId !== denialAttemptId
    || expected.deniedAttemptedAt !== deniedAttemptedAt
    || observed.deniedAttemptedAt !== deniedAttemptedAt
  ) fail(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
  return materializeInert({
    denialAttemptId,
    deniedAttemptedAt,
    domain: 'rentcore.canonical_actual_posting.conflict_observation',
    version: 1,
    conflictType,
    expectedProjection: expected,
    observedProjection: observed,
  });
}

function buildConflictContracts(input) {
  const observation = conflictObservationEnvelope(input);
  const expectedFingerprint = conflictSideFingerprint(input.conflictType, input.expectedProjection, 'expected');
  const observedFingerprint = conflictSideFingerprint(input.conflictType, input.observedProjection, 'observed');
  if (expectedFingerprint === observedFingerprint) fail(ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED);
  const conflictObservationJson = canonicalJson(observation);
  return Object.freeze({
    observation,
    conflictObservationJson,
    conflictObservationHash: sha256Canonical(observation),
    expectedFingerprint,
    observedFingerprint,
  });
}

function conflictHashEnvelope(projection) {
  return exactEnvelope(projection, CONFLICT_HASH_FIELDS, 'rentcore.canonical_actual_posting.conflict');
}

function computeConflictHash(projection) {
  return sha256Canonical(conflictHashEnvelope(projection));
}

function computeTransitionId({ conflictHash, denialAttemptId }) {
  assertHash(conflictHash, 'conflictHash');
  assertUuidV4(denialAttemptId, 'denialAttemptId');
  return sha256Canonical({
    conflictHash,
    denialAttemptId,
    domain: 'rentcore.canonical_actual_posting.conflict_transition_identity',
    transitionKind: TRANSITION_KIND,
    version: 1,
  });
}

function computeAccountingKey({ accountingKind, conflictHash, denialAttemptId }) {
  if (!['attempt', 'rate', 'circuit'].includes(accountingKind)) fail(ERROR_CODES.ENVELOPE_INVALID);
  return sha256Canonical({
    accountingKind,
    conflictHash,
    denialAttemptId,
    domain: 'rentcore.canonical_actual_posting.conflict_accounting_key',
    version: 1,
  });
}

function conflictTransitionIntentEnvelope(input) {
  return materializeInert({
    branchId: input.branchId,
    circuitRule: input.circuitRule,
    companyId: input.companyId,
    conflictHash: input.conflictHash,
    conflictId: input.conflictId,
    conflictType: input.conflictType,
    denialAttemptId: input.denialAttemptId,
    domain: 'rentcore.canonical_actual_posting.conflict_transition_intent',
    operationDomain: input.operationDomain,
    scopeSequence: input.scopeSequence,
    transitionId: input.transitionId,
    transitionKind: input.transitionKind,
    version: 1,
  });
}

function computeConflictTransitionIntentHash(input) {
  return sha256Canonical(conflictTransitionIntentEnvelope(input));
}

function attemptAccountingResult({ attemptAccountingKey, denialAttemptId, transitionId }) {
  assertHash(attemptAccountingKey, 'attemptAccountingKey');
  return materializeInert({
    accountingKey: attemptAccountingKey,
    accountingKind: 'attempt',
    counted: true,
    denialAttemptId,
    domain: 'rentcore.canonical_actual_posting.attempt_accounting_result',
    transitionId,
    version: 1,
  });
}

function compareOperationalOrder(left, right) {
  const leftTime = parseUtcMilliseconds(left.evidenceAttemptedAt, 'left.evidenceAttemptedAt');
  const rightTime = parseUtcMilliseconds(right.evidenceAttemptedAt, 'right.evidenceAttemptedAt');
  if (leftTime < rightTime) return -1;
  if (leftTime > rightTime) return 1;
  if (leftTime === rightTime) {
    if (left.scopeSequence < right.scopeSequence) return -1;
    if (left.scopeSequence > right.scopeSequence) return 1;
    if (left.scopeSequence === right.scopeSequence) return 0;
  }
  fail(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
}

function isOperationallyAtOrBefore(left, right) {
  return compareOperationalOrder(left, right) <= 0;
}

function selectRateQualifyingAttempts(rows, candidate) {
  const candidateMs = parseUtcMilliseconds(candidate.evidenceAttemptedAt, 'candidate.evidenceAttemptedAt');
  assertSafeInteger(candidate.scopeSequence, 'candidate.scopeSequence', { minimum: 1 });
  const lower = candidateMs < 60_000 ? 0 : candidateMs - 60_000;
  const qualifying = rows.filter(row => {
    if (
      row.companyId !== candidate.companyId
      || row.branchId !== candidate.branchId
      || row.operationDomain !== candidate.operationDomain
      || row.rateApplied !== 1
    ) return false;
    const rowMs = parseUtcMilliseconds(row.evidenceAttemptedAt, 'row.evidenceAttemptedAt');
    if (!(lower < rowMs && rowMs <= candidateMs)) return false;
    return isOperationallyAtOrBefore(row, candidate);
  }).sort(compareOperationalOrder);
  return Object.freeze({
    rows: qualifying,
    qualifyingDenialAttemptIds: Object.freeze(qualifying.map(row => row.denialAttemptId)),
    windowEndInclusive: renderUtcMilliseconds(candidateMs),
    windowStartExclusive: renderUtcMilliseconds(lower),
  });
}

function rateAccountingResult({ transition, conflict, committedRows }) {
  const prior = selectRateQualifyingAttempts(
    committedRows.filter(row => row.transitionId !== transition.transitionId),
    {
    ...transition,
    evidenceAttemptedAt: conflict.evidenceAttemptedAt,
    },
  );
  const qualifyingDenialAttemptIds = [...prior.qualifyingDenialAttemptIds, conflict.denialAttemptId];
  return materializeInert({
    accountingKey: transition.rateAccountingKey,
    accountingKind: 'rate',
    branchId: transition.branchId,
    companyId: transition.companyId,
    counted: true,
    denialAttemptId: transition.denialAttemptId,
    domain: 'rentcore.canonical_actual_posting.rate_accounting_result',
    evidenceAttemptedAt: conflict.evidenceAttemptedAt,
    operationDomain: transition.operationDomain,
    qualifyingDenialAttemptIds,
    scopeSequence: transition.scopeSequence,
    transitionId: transition.transitionId,
    version: 1,
    windowEndInclusive: prior.windowEndInclusive,
    windowStartExclusive: prior.windowStartExclusive,
  });
}

function circuitTransitionResult({ transition, conflict, committedRows }) {
  let qualifyingDenialAttemptIds;
  let windowEndInclusive;
  let windowStartExclusive;
  if (transition.circuitRule === 'immediate') {
    qualifyingDenialAttemptIds = [conflict.denialAttemptId];
    windowEndInclusive = null;
    windowStartExclusive = null;
  } else if (transition.circuitRule === 'fifth_in_five') {
    const end = parseUtcMilliseconds(conflict.evidenceAttemptedAt, 'evidenceAttemptedAt');
    const start = end < 300_000 ? 0 : end - 300_000;
    const current = { ...transition, evidenceAttemptedAt: conflict.evidenceAttemptedAt };
    const filtered = committedRows.filter(row => {
      if (row.transitionId === transition.transitionId) return false;
      if (
        row.companyId !== transition.companyId
        || row.branchId !== transition.branchId
        || row.operationDomain !== transition.operationDomain
        || row.circuitApplied !== 1
        || !['AUTHORIZATION_DRIFT', 'ACTIVATION_DRIFT'].includes(row.conflictType)
      ) return false;
      const rowMs = parseUtcMilliseconds(row.evidenceAttemptedAt, 'row.evidenceAttemptedAt');
      if (!(start < rowMs && rowMs <= end)) return false;
      return isOperationallyAtOrBefore(row, current);
    }).sort(compareOperationalOrder);
    qualifyingDenialAttemptIds = [...filtered.map(row => row.denialAttemptId), conflict.denialAttemptId];
    windowEndInclusive = renderUtcMilliseconds(end);
    windowStartExclusive = renderUtcMilliseconds(start);
  } else {
    fail(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
  }
  return materializeInert({
    accountingKey: transition.circuitTransitionKey,
    accountingKind: 'circuit',
    branchId: transition.branchId,
    circuitRule: transition.circuitRule,
    circuitState: qualifyingDenialAttemptIds.length >= (transition.circuitRule === 'immediate' ? 1 : 5)
      ? 'open'
      : 'closed',
    companyId: transition.companyId,
    denialAttemptId: transition.denialAttemptId,
    domain: 'rentcore.canonical_actual_posting.circuit_transition_result',
    operationDomain: transition.operationDomain,
    qualifyingDenialAttemptIds,
    scopeSequence: transition.scopeSequence,
    transitionId: transition.transitionId,
    version: 1,
    windowEndInclusive,
    windowStartExclusive,
  });
}

function createPendingConflictTransition({
  branchId,
  circuitRule,
  companyId,
  conflictHash,
  conflictId,
  conflictType,
  createdAt,
  denialAttemptId,
  scopeSequence,
}) {
  assertSafeInteger(scopeSequence, 'scopeSequence', { minimum: 1 });
  assertRfc3339Milliseconds(createdAt, 'createdAt');
  const transitionId = computeTransitionId({ conflictHash, denialAttemptId });
  const transition = {
    transitionId,
    conflictId,
    companyId,
    branchId,
    operationDomain: OPERATION_DOMAIN,
    scopeSequence,
    transitionKind: TRANSITION_KIND,
    denialAttemptId,
    conflictHash,
    conflictType,
    circuitRule,
    attemptAccountingKey: computeAccountingKey({ accountingKind: 'attempt', conflictHash, denialAttemptId }),
    rateAccountingKey: computeAccountingKey({ accountingKind: 'rate', conflictHash, denialAttemptId }),
    circuitTransitionKey: computeAccountingKey({ accountingKind: 'circuit', conflictHash, denialAttemptId }),
    state: 'PENDING',
    attemptApplied: 0,
    attemptResultJson: null,
    attemptResultHash: null,
    rateApplied: 0,
    rateResultJson: null,
    rateResultHash: null,
    circuitApplied: 0,
    circuitResultJson: null,
    circuitResultHash: null,
    intentHash: null,
    schemaVersion: 1,
    createdAt,
  };
  transition.intentHash = computeConflictTransitionIntentHash(transition);
  return materializeInert(transition, 'transition');
}

function parseAndVerifyResult(json, hash, expected, field) {
  const parsed = parseCanonicalJson(json, field);
  assertHash(hash, `${field}Hash`);
  if (sha256Canonical(parsed) !== hash || canonicalJson(parsed) !== canonicalJson(expected)) {
    fail(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
  }
  return parsed;
}

function verifyConflictTransition({ transition, conflict, committedRows = [] }) {
  const row = materializeInert(transition, 'transition');
  const conflictRow = materializeInert(conflict, 'conflict');
  if (
    row.conflictId !== conflictRow.id
    || row.companyId !== conflictRow.companyId
    || row.branchId !== conflictRow.branchId
    || row.denialAttemptId !== conflictRow.denialAttemptId
    || row.conflictHash !== conflictRow.conflictHash
    || row.conflictType !== conflictRow.conflictType
    || row.createdAt !== conflictRow.evidenceAttemptedAt
    || row.operationDomain !== OPERATION_DOMAIN
    || row.transitionKind !== TRANSITION_KIND
    || row.transitionId !== conflictRow.transitionId
    || row.transitionId !== computeTransitionId(row)
    || row.attemptAccountingKey !== computeAccountingKey({ accountingKind: 'attempt', ...row })
    || row.rateAccountingKey !== computeAccountingKey({ accountingKind: 'rate', ...row })
    || row.circuitTransitionKey !== computeAccountingKey({ accountingKind: 'circuit', ...row })
    || row.intentHash !== computeConflictTransitionIntentHash(row)
    || row.schemaVersion !== 1
  ) fail(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
  assertSafeInteger(row.scopeSequence, 'scopeSequence', { minimum: 1 });
  const expectedCircuitRule = ['AUTHORIZATION_DRIFT', 'ACTIVATION_DRIFT'].includes(row.conflictType)
    ? 'fifth_in_five'
    : 'immediate';
  if (row.circuitRule !== expectedCircuitRule) fail(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);

  if (row.attemptApplied === 1) {
    parseAndVerifyResult(
      row.attemptResultJson,
      row.attemptResultHash,
      attemptAccountingResult(row),
      'attemptResultJson',
    );
  } else if (row.attemptResultJson !== null || row.attemptResultHash !== null) {
    fail(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
  }
  if (row.rateApplied === 1) {
    parseAndVerifyResult(
      row.rateResultJson,
      row.rateResultHash,
      rateAccountingResult({ transition: row, conflict: conflictRow, committedRows }),
      'rateResultJson',
    );
  } else if (row.rateResultJson !== null || row.rateResultHash !== null) {
    fail(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
  }
  if (row.circuitApplied === 1) {
    parseAndVerifyResult(
      row.circuitResultJson,
      row.circuitResultHash,
      circuitTransitionResult({ transition: row, conflict: conflictRow, committedRows }),
      'circuitResultJson',
    );
  } else if (row.circuitResultJson !== null || row.circuitResultHash !== null) {
    fail(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
  }

  const validState = (
    (row.state === 'PENDING' && row.rateApplied === 0 && row.circuitApplied === 0 && [0, 1].includes(row.attemptApplied))
    || (row.state === 'ACCOUNTED' && row.attemptApplied === 1 && row.rateApplied === 1 && row.circuitApplied === 0)
    || (row.state === 'CIRCUIT_APPLIED' && row.attemptApplied === 1 && row.rateApplied === 1 && row.circuitApplied === 1)
    || (row.state === 'COMPLETE' && row.attemptApplied === 1 && row.rateApplied === 1 && row.circuitApplied === 1)
  );
  if (!validState) fail(ERROR_CODES.CONFLICT_TRANSITION_INTEGRITY_FAILED);
  return row;
}

function validateEligibleEventRecord(record) {
  const row = materializeInert(record, 'eligibleEvent');
  for (const field of REQUIRED_COLUMNS[ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE]) {
    if (!Object.prototype.hasOwnProperty.call(row, field)) {
      fail(ERROR_CODES.ENVELOPE_INVALID, `Missing event field: ${field}`, field);
    }
  }
  if (row.eventSchemaVersion !== 'ActualReceivableEligibleV1' || row.eventVersion !== 1 || row.schemaVersion !== 1) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Event version mismatch.');
  }
  if (row.currency !== 'RUB' || row.amountBasis !== 'gross') fail(ERROR_CODES.ENVELOPE_INVALID);
  for (const field of ['netAmountMinor', 'vatAmountMinor', 'grossAmountMinor', 'originalAmountMinor']) {
    assertSafeInteger(row[field], field, { minimum: 0 });
  }
  if (
    row.netAmountMinor + row.vatAmountMinor !== row.grossAmountMinor
    || row.originalAmountMinor !== row.grossAmountMinor
    || row.grossAmountMinor <= 0
  ) fail(ERROR_CODES.ENVELOPE_INVALID, 'Event money equation mismatch.');
  assertRfc3339Milliseconds(row.occurredAt, 'occurredAt');
  assertRfc3339Milliseconds(row.createdAt, 'createdAt');
  if (row.occurredAt !== row.createdAt) fail(ERROR_CODES.ENVELOPE_INVALID);
  if (computeEligibleEventHash(row) !== row.eventHash) fail(ERROR_CODES.ENVELOPE_INVALID, 'eventHash mismatch.');
  return row;
}

const CANONICAL_POSTING_COMMAND_KEYS = Object.freeze([
  'companyId',
  'branchId',
  'eventId',
  'operationType',
  'assertedEventHash',
  'assertedWriteAuthorizationRecordId',
  'requestedActivationRecordId',
  'requestedSourceAdapterAuthorityRecordId',
  'requestedPostingAdapterAuthorityRecordId',
  'requestedPostingAdapterAuthorityVersion',
  'requestedPostingAdapterAuthorityRecordHash',
  'assertedDueDatePolicySetHash',
  'assertedSelectedDueDateGateKind',
  'assertedSelectedDueDatePolicyId',
  'assertedSelectedDueDatePolicyVersion',
  'assertedSelectedDueDatePolicyHash',
  'assertedDueDateTreatment',
  'assertedUnknownDueDateTreatmentMappingId',
  'assertedUnknownDueDateTreatmentMappingVersion',
  'assertedUnknownDueDateTreatmentMappingHash',
]);

const CANONICAL_RECEIVABLE_FINGERPRINT_FIELDS = Object.freeze([
  'branchId', 'cancellationReason', 'cancelledAt', 'clientId', 'closedAt',
  'companyId', 'companyTimezone', 'contractId', 'contractualDueDate', 'createdAt',
  'currency', 'description', 'dueDateProvenance', 'externalId', 'id',
  'idempotencyKey', 'issuedAt', 'normalizedSourceLineId', 'originalAmountMinor',
  'postedAt', 'rentalId', 'sourceDocumentId', 'sourceDocumentType', 'sourceLineId',
  'sourceSystem', 'updatedAt', 'workflowStatus', 'writtenOffAt',
]);

const CANONICAL_POSTING_AUDIT_PAYLOAD_FIELDS = Object.freeze([
  'acceptedDryRunsHash', 'acceptedPr8EvidenceHash', 'activationRecordId',
  'actorAuthorityRecordId', 'actorIdentityId', 'canonicalReceivableFingerprint',
  'dueDatePolicySetHash', 'dueDateTreatment', 'economicLineageKey',
  'economicSourceRevisionKey', 'eventHash', 'eventId', 'operationId',
  'postingAdapterAuthorityBranchId', 'postingAdapterAuthorityCompanyId',
  'postingAdapterAuthorityKind', 'postingAdapterAuthorityRecordHash',
  'postingAdapterAuthorityRecordId', 'postingAdapterAuthorityVersion',
  'selectedDueDateGateKind', 'selectedDueDatePolicyHash', 'selectedDueDatePolicyId',
  'selectedDueDatePolicyVersion', 'sourceAdapterAuthorityRecordHash',
  'sourceAdapterAuthorityRecordId', 'sourceAdapterAuthorityVersion',
  'sourceLineageHash', 'sourceOwnershipManifestHash',
  'unknownDueDateTreatmentMappingHash', 'unknownDueDateTreatmentMappingId',
  'unknownDueDateTreatmentMappingVersion', 'writeAuthorizationRecordId',
]);

const CANONICAL_POSTING_RESULT_FIELDS = Object.freeze([
  'acceptedDryRunsHash', 'acceptedPr8EvidenceHash', 'activationId',
  'activationRecordHash', 'activationRecordId', 'attemptedAt',
  'auditEventFingerprint', 'auditPayloadFingerprint', 'branchId',
  'canonicalReceivableFingerprint', 'canonicalReceivableId', 'commandFingerprint',
  'canonicalWriteAuthorizationId', 'companyId', 'correlationId',
  'currentPr6RevisionHash', 'dueDatePolicySetHash', 'dueDateTreatment',
  'economicLineageKey', 'economicSourceRevisionKey', 'eventHash', 'eventId',
  'financialAuditEventId', 'freshnessWindowFingerprint', 'idempotencyKey',
  'operationId', 'operationType', 'postingAdapterAuthorityBranchId',
  'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityKind',
  'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityRecordId',
  'postingAdapterAuthorityVersion', 'schemaVersion', 'producerAuthorityBranchId',
  'producerAuthorityCompanyId', 'producerAuthorityKind',
  'producerAuthorityRecordHash', 'producerAuthorityRecordId',
  'producerAuthorityVersion', 'selectedDueDateGateKind',
  'selectedDueDatePolicyHash', 'selectedDueDatePolicyId',
  'selectedDueDatePolicyVersion', 'sourceAdapterAuthorityRecordHash',
  'sourceAdapterAuthorityRecordId', 'sourceAdapterAuthorityVersion',
  'sourceLineageHash', 'sourceOwnershipManifestHash',
  'unknownDueDateTreatmentMappingHash', 'unknownDueDateTreatmentMappingId',
  'unknownDueDateTreatmentMappingVersion', 'writeAuthorizationRecordHash',
  'writeAuthorizationRecordId',
]);

function normalizeCanonicalPostingCommand(input) {
  let decoded;
  try {
    decoded = typeof input === 'string' || Buffer.isBuffer(input) || input instanceof Uint8Array
      ? parseJson(input)
      : materializeInert(input, 'postingCommand');
  } catch (error) {
    if (error instanceof CanonicalActualPostingError) throw error;
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Invalid posting command.', 'postingCommand');
  }
  assertExactObjectKeys(decoded, CANONICAL_POSTING_COMMAND_KEYS, 'postingCommand');
  for (const field of [
    'companyId', 'branchId', 'eventId', 'assertedWriteAuthorizationRecordId',
    'requestedActivationRecordId', 'requestedSourceAdapterAuthorityRecordId',
    'requestedPostingAdapterAuthorityRecordId', 'assertedSelectedDueDatePolicyId',
  ]) assertIdentifier(decoded[field], field);
  for (const field of [
    'assertedEventHash', 'requestedPostingAdapterAuthorityRecordHash',
    'assertedDueDatePolicySetHash', 'assertedSelectedDueDatePolicyHash',
  ]) assertHash(decoded[field], field);
  for (const field of [
    'requestedPostingAdapterAuthorityVersion', 'assertedSelectedDueDatePolicyVersion',
  ]) assertSafeInteger(decoded[field], field, { minimum: 1 });
  if (decoded.operationType !== OPERATION_DOMAIN) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Unsupported posting operation.', 'operationType');
  }
  if (!['contractual_due_date', 'unknown_due_date_treatment'].includes(decoded.assertedSelectedDueDateGateKind)) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Invalid selected due-date gate.', 'assertedSelectedDueDateGateKind');
  }
  const unknown = decoded.assertedSelectedDueDateGateKind === 'unknown_due_date_treatment';
  if (unknown) {
    assertIdentifier(decoded.assertedUnknownDueDateTreatmentMappingId, 'assertedUnknownDueDateTreatmentMappingId');
    assertSafeInteger(
      decoded.assertedUnknownDueDateTreatmentMappingVersion,
      'assertedUnknownDueDateTreatmentMappingVersion',
      { minimum: 1 },
    );
    assertHash(decoded.assertedUnknownDueDateTreatmentMappingHash, 'assertedUnknownDueDateTreatmentMappingHash');
    if (
      decoded.assertedDueDateTreatment !== 'post_without_aging_v1'
      || decoded.assertedUnknownDueDateTreatmentMappingId !== 'rentcore.unknown_due_date_posting_treatment.v1'
      || decoded.assertedUnknownDueDateTreatmentMappingVersion !== 1
    ) fail(ERROR_CODES.ENVELOPE_INVALID, 'Invalid unknown due-date mapping.', 'assertedDueDateTreatment');
  } else if (
    decoded.assertedDueDateTreatment !== 'proven_contractual_date_v1'
    || decoded.assertedUnknownDueDateTreatmentMappingId !== null
    || decoded.assertedUnknownDueDateTreatmentMappingVersion !== null
    || decoded.assertedUnknownDueDateTreatmentMappingHash !== null
  ) {
    fail(ERROR_CODES.ENVELOPE_INVALID, 'Unexpected unknown due-date mapping.', 'assertedDueDateTreatment');
  }
  return materializeInert(decoded, 'postingCommand');
}

function canonicalPostingCommandEnvelope(input) {
  return exactEnvelope(
    normalizeCanonicalPostingCommand(input),
    CANONICAL_POSTING_COMMAND_KEYS,
    'rentcore.canonical_actual_posting.command',
  );
}

function computeCanonicalPostingCommandFingerprint(input) {
  return sha256Canonical(canonicalPostingCommandEnvelope(input));
}

function canonicalPostingIdempotencyKeyEnvelope(input) {
  return exactEnvelope(input, [
    'activationId', 'canonicalWriteAuthorizationId', 'economicLineageKey',
    'economicSourceRevisionKey', 'eventHash', 'operationType',
  ], 'rentcore.canonical_actual_posting.idempotency_key');
}

function computeCanonicalPostingIdempotencyKey(input) {
  return sha256Canonical(canonicalPostingIdempotencyKeyEnvelope(input));
}

function canonicalReceivableFingerprintEnvelope(row) {
  return exactEnvelope(
    row,
    CANONICAL_RECEIVABLE_FINGERPRINT_FIELDS,
    'rentcore.canonical_receivable.persisted_row',
  );
}

function computeCanonicalReceivableFingerprint(row) {
  return sha256Canonical(canonicalReceivableFingerprintEnvelope(row));
}

function canonicalPostingAuditPayloadEnvelope(payload) {
  return exactEnvelope(
    payload,
    CANONICAL_POSTING_AUDIT_PAYLOAD_FIELDS,
    'rentcore.canonical_actual_posting.audit_payload',
  );
}

function computeCanonicalPostingAuditPayloadFingerprint(payload) {
  return sha256Canonical(canonicalPostingAuditPayloadEnvelope(payload));
}

function canonicalPostingAuditEventEnvelope({ audit, auditPayloadFingerprint }) {
  return exactEnvelope({
    ...audit,
    auditPayloadFingerprint,
  }, [
    'actorId', 'actorType', 'aggregateId', 'aggregateType', 'auditPayloadFingerprint',
    'branchId', 'companyId', 'correlationId', 'createdAt', 'eventType', 'id',
    'occurredAt', 'previousValueJson', 'reason', 'sourceSystem',
  ], 'rentcore.canonical_actual_posting.financial_audit_event');
}

function computeCanonicalPostingAuditEventFingerprint(input) {
  return sha256Canonical(canonicalPostingAuditEventEnvelope(input));
}

function canonicalPostingResultEnvelope(result) {
  return exactEnvelope(
    result,
    CANONICAL_POSTING_RESULT_FIELDS,
    'rentcore.canonical_actual_posting.result',
  );
}

function computeCanonicalPostingResultHash(result) {
  return sha256Canonical(canonicalPostingResultEnvelope(result));
}

function canonicalPrimaryAuditPayloadProjection({ event, operation, canonicalReceivableFingerprint }) {
  return {
    acceptedDryRunsHash: operation.acceptedDryRunsHash,
    acceptedPr8EvidenceHash: operation.acceptedPr8EvidenceHash,
    activationRecordId: operation.activationRecordId,
    actorAuthorityRecordId: operation.postingAdapterAuthorityRecordId,
    actorIdentityId: 'integration:rentcore-canonical-receivable-posting',
    canonicalReceivableFingerprint,
    dueDatePolicySetHash: operation.dueDatePolicySetHash,
    dueDateTreatment: operation.dueDateTreatment,
    economicLineageKey: operation.economicLineageKey,
    economicSourceRevisionKey: operation.economicSourceRevisionKey,
    eventHash: operation.eventHash,
    eventId: operation.eventId,
    operationId: operation.id,
    postingAdapterAuthorityBranchId: operation.postingAdapterAuthorityBranchId,
    postingAdapterAuthorityCompanyId: operation.postingAdapterAuthorityCompanyId,
    postingAdapterAuthorityKind: operation.postingAdapterAuthorityKind,
    postingAdapterAuthorityRecordHash: operation.postingAdapterAuthorityRecordHash,
    postingAdapterAuthorityRecordId: operation.postingAdapterAuthorityRecordId,
    postingAdapterAuthorityVersion: operation.postingAdapterAuthorityVersion,
    selectedDueDateGateKind: operation.selectedDueDateGateKind,
    selectedDueDatePolicyHash: operation.selectedDueDatePolicyHash,
    selectedDueDatePolicyId: operation.selectedDueDatePolicyId,
    selectedDueDatePolicyVersion: operation.selectedDueDatePolicyVersion,
    sourceAdapterAuthorityRecordHash: operation.sourceAdapterAuthorityRecordHash,
    sourceAdapterAuthorityRecordId: operation.sourceAdapterAuthorityRecordId,
    sourceAdapterAuthorityVersion: operation.sourceAdapterAuthorityVersion,
    sourceLineageHash: operation.sourceLineageHash,
    sourceOwnershipManifestHash: operation.sourceOwnershipManifestHash,
    unknownDueDateTreatmentMappingHash: operation.unknownDueDateTreatmentMappingHash,
    unknownDueDateTreatmentMappingId: operation.unknownDueDateTreatmentMappingId,
    unknownDueDateTreatmentMappingVersion: operation.unknownDueDateTreatmentMappingVersion,
    writeAuthorizationRecordId: operation.writeAuthorizationRecordId,
  };
}

function canonicalPrimaryResultProjection({
  activation,
  auditEventFingerprint,
  auditPayloadFingerprint,
  authorization,
  canonicalReceivableFingerprint,
  commandFingerprint,
  event,
  freshnessWindowFingerprint,
  idempotencyKey,
  operation,
}) {
  return {
    acceptedDryRunsHash: event.acceptedDryRunsHash,
    acceptedPr8EvidenceHash: event.acceptedPr8EvidenceHash,
    activationId: activation.activationId,
    activationRecordHash: activation.recordHash,
    activationRecordId: activation.recordId,
    attemptedAt: operation.createdAt,
    auditEventFingerprint,
    auditPayloadFingerprint,
    branchId: event.branchId,
    canonicalReceivableFingerprint,
    canonicalReceivableId: operation.canonicalReceivableId,
    canonicalWriteAuthorizationId: authorization.authorizationId,
    commandFingerprint,
    companyId: event.companyId,
    correlationId: event.correlationId,
    currentPr6RevisionHash: event.currentPr6RevisionHash,
    dueDatePolicySetHash: event.dueDatePolicySetHash,
    dueDateTreatment: event.dueDateTreatment,
    economicLineageKey: event.economicLineageKey,
    economicSourceRevisionKey: event.economicSourceRevisionKey,
    eventHash: event.eventHash,
    eventId: event.id,
    financialAuditEventId: operation.financialAuditEventId,
    freshnessWindowFingerprint,
    idempotencyKey,
    operationId: operation.id,
    operationType: operation.operationType,
    postingAdapterAuthorityBranchId: operation.postingAdapterAuthorityBranchId,
    postingAdapterAuthorityCompanyId: operation.postingAdapterAuthorityCompanyId,
    postingAdapterAuthorityKind: operation.postingAdapterAuthorityKind,
    postingAdapterAuthorityRecordHash: operation.postingAdapterAuthorityRecordHash,
    postingAdapterAuthorityRecordId: operation.postingAdapterAuthorityRecordId,
    postingAdapterAuthorityVersion: operation.postingAdapterAuthorityVersion,
    producerAuthorityBranchId: event.producerAuthorityBranchId,
    producerAuthorityCompanyId: event.producerAuthorityCompanyId,
    producerAuthorityKind: event.producerAuthorityKind,
    producerAuthorityRecordHash: event.producerAuthorityRecordHash,
    producerAuthorityRecordId: event.producerAuthorityRecordId,
    producerAuthorityVersion: event.producerAuthorityVersion,
    schemaVersion: operation.schemaVersion,
    selectedDueDateGateKind: event.selectedDueDateGateKind,
    selectedDueDatePolicyHash: event.selectedDueDatePolicyHash,
    selectedDueDatePolicyId: event.selectedDueDatePolicyId,
    selectedDueDatePolicyVersion: event.selectedDueDatePolicyVersion,
    sourceAdapterAuthorityRecordHash: event.sourceAdapterAuthorityRecordHash,
    sourceAdapterAuthorityRecordId: event.sourceAdapterAuthorityRecordId,
    sourceAdapterAuthorityVersion: event.sourceAdapterAuthorityVersion,
    sourceLineageHash: event.sourceLineageHash,
    sourceOwnershipManifestHash: event.sourceOwnershipManifestHash,
    unknownDueDateTreatmentMappingHash: event.unknownDueDateTreatmentMappingHash,
    unknownDueDateTreatmentMappingId: event.unknownDueDateTreatmentMappingId,
    unknownDueDateTreatmentMappingVersion: event.unknownDueDateTreatmentMappingVersion,
    writeAuthorizationRecordHash: authorization.recordHash,
    writeAuthorizationRecordId: authorization.recordId,
  };
}

function primaryIntegrityFailure() {
  fail(ERROR_CODES.POSTING_INTEGRITY_BLOCKED);
}

function verifyCanonicalPrimaryTriplet({
  activation,
  audit,
  authorization,
  commandFingerprint,
  conductedCreatedAt,
  event,
  freshnessWindowFingerprint,
  operation,
  receivable,
}) {
  if (!activation || !audit || !authorization || !event || !operation || !receivable) {
    primaryIntegrityFailure();
  }
  try {
    assertUuidV4(receivable.id, 'canonicalReceivableId');
    assertUuidV4(operation.id, 'operationId');
    assertUuidV4(audit.id, 'financialAuditEventId');
  } catch {
    primaryIntegrityFailure();
  }
  const idempotencyKey = computeCanonicalPostingIdempotencyKey({
    activationId: activation.activationId,
    canonicalWriteAuthorizationId: authorization.authorizationId,
    economicLineageKey: event.economicLineageKey,
    economicSourceRevisionKey: event.economicSourceRevisionKey,
    eventHash: event.eventHash,
    operationType: OPERATION_DOMAIN,
  });
  const expectedReceivable = {
    id: receivable.id,
    companyId: event.companyId,
    branchId: event.branchId,
    clientId: event.clientId,
    contractId: event.contractId,
    rentalId: event.rentalId,
    sourceDocumentType: 'rental_service_upd',
    sourceDocumentId: event.rootSourceDocumentLineageId,
    sourceLineId: event.economicLineageKey,
    normalizedSourceLineId: event.economicLineageKey,
    sourceSystem: 'rentcore.billing_source_authority.v1',
    externalId: event.economicLineageKey,
    idempotencyKey,
    currency: 'RUB',
    originalAmountMinor: event.grossAmountMinor,
    issuedAt: conductedCreatedAt,
    postedAt: operation.createdAt,
    contractualDueDate: event.contractualDueDate,
    dueDateProvenance: event.dueDateProvenance,
    companyTimezone: event.companyTimezoneSnapshot,
    workflowStatus: 'posted',
    cancellationReason: null,
    description: 'Governed UPD coverage slice',
    createdAt: operation.createdAt,
    updatedAt: operation.createdAt,
    cancelledAt: null,
    closedAt: null,
    writtenOffAt: null,
    version: 1,
  };
  if (canonicalJson(receivable) !== canonicalJson(expectedReceivable)) primaryIntegrityFailure();
  const canonicalReceivableFingerprint = computeCanonicalReceivableFingerprint(expectedReceivable);
  const operationBase = {
    id: operation.id,
    companyId: event.companyId,
    branchId: event.branchId,
    operationType: OPERATION_DOMAIN,
    idempotencyKey,
    eventId: event.id,
    eventHash: event.eventHash,
    economicLineageKey: event.economicLineageKey,
    economicSourceRevisionKey: event.economicSourceRevisionKey,
    currentPr6RevisionHash: event.currentPr6RevisionHash,
    sourceAdapterAuthorityRecordId: event.sourceAdapterAuthorityRecordId,
    sourceAdapterAuthorityVersion: event.sourceAdapterAuthorityVersion,
    sourceAdapterAuthorityRecordHash: event.sourceAdapterAuthorityRecordHash,
    sourceOwnershipManifestHash: event.sourceOwnershipManifestHash,
    postingAdapterAuthorityRecordId: activation.postingAdapterAuthorityRecordId,
    postingAdapterAuthorityVersion: activation.postingAdapterAuthorityVersion,
    postingAdapterAuthorityRecordHash: activation.postingAdapterAuthorityRecordHash,
    postingAdapterAuthorityCompanyId: activation.postingAdapterAuthorityCompanyId,
    postingAdapterAuthorityBranchId: activation.postingAdapterAuthorityBranchId,
    postingAdapterAuthorityKind: activation.postingAdapterAuthorityKind,
    writeAuthorizationRecordId: authorization.recordId,
    activationRecordId: activation.recordId,
    acceptedDryRunsHash: event.acceptedDryRunsHash,
    acceptedPr8EvidenceHash: event.acceptedPr8EvidenceHash,
    dueDatePolicySetHash: event.dueDatePolicySetHash,
    selectedDueDateGateKind: event.selectedDueDateGateKind,
    selectedDueDatePolicyId: event.selectedDueDatePolicyId,
    selectedDueDatePolicyVersion: event.selectedDueDatePolicyVersion,
    selectedDueDatePolicyHash: event.selectedDueDatePolicyHash,
    dueDateTreatment: event.dueDateTreatment,
    unknownDueDateTreatmentMappingId: event.unknownDueDateTreatmentMappingId,
    unknownDueDateTreatmentMappingVersion: event.unknownDueDateTreatmentMappingVersion,
    unknownDueDateTreatmentMappingHash: event.unknownDueDateTreatmentMappingHash,
    canonicalReceivableId: receivable.id,
    canonicalReceivableFingerprint,
    sourceLineageHash: event.sourceLineageHash,
    commandFingerprint,
    auditPayloadFingerprint: null,
    auditEventFingerprint: null,
    resultHash: null,
    financialAuditEventId: audit.id,
    correlationId: event.correlationId,
    schemaVersion: 1,
    createdAt: operation.createdAt,
  };
  const payloadProjection = canonicalPrimaryAuditPayloadProjection({
    canonicalReceivableFingerprint,
    event,
    operation: operationBase,
  });
  const auditPayloadFingerprint = computeCanonicalPostingAuditPayloadFingerprint(payloadProjection);
  const payload = { ...payloadProjection, auditPayloadFingerprint };
  let persistedPayload;
  try {
    persistedPayload = parseCanonicalJson(audit.newValueJson, 'financialAuditEvent.newValueJson');
  } catch {
    primaryIntegrityFailure();
  }
  if (canonicalJson(persistedPayload) !== canonicalJson(payload)) primaryIntegrityFailure();
  const expectedAudit = {
    id: audit.id,
    companyId: event.companyId,
    branchId: event.branchId,
    aggregateType: 'canonical_receivable',
    aggregateId: receivable.id,
    eventType: 'canonical_receivable.initial_posted.v1',
    actorId: 'integration:rentcore-canonical-receivable-posting',
    actorType: 'integration',
    occurredAt: operation.createdAt,
    reason: 'canonical_actual_posting_initial_post_v1',
    previousValueJson: null,
    newValueJson: canonicalJson(payload),
    correlationId: event.correlationId,
    sourceSystem: 'rentcore.billing_source_authority.v1',
    createdAt: operation.createdAt,
  };
  if (canonicalJson(audit) !== canonicalJson(expectedAudit)) primaryIntegrityFailure();
  const auditEventFingerprint = computeCanonicalPostingAuditEventFingerprint({
    audit: expectedAudit,
    auditPayloadFingerprint,
  });
  const operationWithSeals = {
    ...operationBase,
    auditPayloadFingerprint,
    auditEventFingerprint,
  };
  const resultHash = computeCanonicalPostingResultHash(canonicalPrimaryResultProjection({
    activation,
    auditEventFingerprint,
    auditPayloadFingerprint,
    authorization,
    canonicalReceivableFingerprint,
    commandFingerprint,
    event,
    freshnessWindowFingerprint,
    idempotencyKey,
    operation: operationWithSeals,
  }));
  const expectedOperation = { ...operationWithSeals, resultHash };
  if (canonicalJson(operation) !== canonicalJson(expectedOperation)) primaryIntegrityFailure();
  return Object.freeze({
    auditEventFingerprint,
    auditPayloadFingerprint,
    canonicalReceivableFingerprint,
    idempotencyKey,
    resultHash,
  });
}

function computeCanonicalEvidenceReadDigest(evidence) {
  return sha256Canonical({
    domain: 'rentcore.canonical_actual_posting.evidence_read_set',
    evidence: materializeInert(evidence, 'canonicalEvidenceReadSet'),
    version: 1,
  });
}

function mapSqliteError(error) {
  const code = String(error?.code || '');
  const message = String(error?.message || '');
  if (code === 'SQLITE_BUSY' || code === 'SQLITE_LOCKED' || message.includes('database is locked')) {
    return new CanonicalActualPostingError(ERROR_CODES.POSTING_CONCURRENT_CONFLICT);
  }
  return error;
}

module.exports = {
  ACTIVATION_HASH_FIELDS,
  CANONICAL_POSTING_AUDIT_PAYLOAD_FIELDS,
  CANONICAL_POSTING_COMMAND_KEYS,
  CANONICAL_POSTING_RESULT_FIELDS,
  CANONICAL_RECEIVABLE_FINGERPRINT_FIELDS,
  CONFLICT_HASH_FIELDS,
  ELIGIBLE_EVENT_HASH_FIELDS,
  ERROR_CODES,
  GOVERNED_AUTHORITY_HASH_FIELDS,
  MAX_CANONICAL_BYTES,
  MAX_DEPTH,
  MAX_EPOCH_MILLISECONDS,
  MAX_NODES,
  OPERATION_DOMAIN,
  TRANSITION_KIND,
  WRITE_AUTHORIZATION_HASH_FIELDS,
  CanonicalActualPostingError,
  DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT,
  acceptedPr8EvidenceEnvelope,
  acceptedDryRunsEnvelope,
  activationEnvelope,
  assertCanonicalActualPostingRuntimeContract,
  assertExactObjectKeys,
  assertGovernedAuthorityRecord,
  assertHash,
  assertIdentifier,
  assertRfc3339Milliseconds,
  assertSafeInteger,
  assertUnicodeScalarString,
  assertUuidV4,
  attemptAccountingResult,
  buildConflictContracts,
  canonicalJson,
  canonicalPostingAuditEventEnvelope,
  canonicalPostingAuditPayloadEnvelope,
  canonicalPostingBoundaryEnvelope,
  canonicalPostingCommandEnvelope,
  canonicalPostingCohortEnvelope,
  canonicalPostingIdempotencyKeyEnvelope,
  canonicalPrimaryAuditPayloadProjection,
  canonicalPrimaryResultProjection,
  canonicalPostingResultEnvelope,
  canonicalReceivableFingerprintEnvelope,
  circuitTransitionResult,
  compareAuthorityDenialCandidate,
  compareOperationalOrder,
  compareSafeIntegerAscending,
  compareSafeIntegerDescending,
  compareUtf16Ascending,
  computeAcceptedDryRunsHash,
  computeAcceptedPr8EvidenceHash,
  computeAccountingKey,
  computeActivationRecordHash,
  computeArtifactIdentityHash,
  computeAuthorityId,
  computeCanonicalPostingBoundaryHash,
  computeCanonicalPostingAuditEventFingerprint,
  computeCanonicalPostingAuditPayloadFingerprint,
  computeCanonicalPostingCommandFingerprint,
  computeCanonicalPostingCohortHash,
  computeCanonicalPostingIdempotencyKey,
  computeCanonicalPostingResultHash,
  computeCanonicalReceivableFingerprint,
  computeCanonicalEvidenceReadDigest,
  computeConflictHash,
  computeConflictTransitionIntentHash,
  computeCoverageLineageRootId,
  computeDueDatePolicySetHash,
  computeEconomicLineageCandidateFingerprint,
  computeEconomicLineageKey,
  computeEconomicSourceRevisionKey,
  computeEligibleEventHash,
  computeGovernedAuthorityRecordHash,
  computeSourceLineageHash,
  computeTransitionId,
  computeUnknownDueDateMappingHash,
  computeWriteAuthorizationRecordHash,
  conflictHashEnvelope,
  conflictObservationEnvelope,
  conflictSideFingerprint,
  conflictTransitionIntentEnvelope,
  createFrozenAuthorityChainSnapshot,
  createCanonicalActualPostingRuntimeContract,
  createPendingConflictTransition,
  deriveRepositoryIdentity,
  dueDatePolicySetEnvelope,
  eligibleEventEnvelope,
  fail,
  governedAuthorityRecordEnvelope,
  hashEnvelope,
  mapSqliteError,
  materializeInert,
  normalizeSortedUniqueStrings,
  normalizeCanonicalPostingCommand,
  parseCanonicalJson,
  parseJson,
  parseUtcMilliseconds,
  rateAccountingResult,
  renderUtcMilliseconds,
  selectRateQualifyingAttempts,
  sha256Bytes,
  sha256Canonical,
  sourceLineageEnvelope,
  unknownDueDateMappingEnvelope,
  validateEligibleEventRecord,
  verifyCanonicalPrimaryTriplet,
  verifyConflictTransition,
  verifyFrozenAuthorityChainSnapshot,
  writeAuthorizationEnvelope,
};
