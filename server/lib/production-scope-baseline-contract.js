'use strict';

const crypto = require('node:crypto');

const BASELINE_RAW_AUTHORITY_MANIFEST_VERSION = 1;
const BASELINE_CONTRACT_VERSION = 1;
const BASELINE_COLLECTION_RULE_COUNT = 7;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const BASELINE_DIGEST_DOMAINS = Object.freeze({
  canonicalScope: 'rentcore.production-scope.canonical-scope.v1',
  candidateKeySet: 'rentcore.production-scope.baseline-candidate-key-set.v1',
  candidateAuthority: 'rentcore.production-scope.baseline-candidate-authority.v1',
  fixtureKeySet: 'rentcore.production-scope.baseline-fixture-key-set.v1',
});

const RAW_AUTHORITY_KEYS = Object.freeze([
  'canonicalScope',
  'manifestVersion',
  'productionExecutionAuthorized',
  'records',
  'source',
]);
const RAW_RECORD_KEYS = Object.freeze([
  'classification',
  'collection',
  'newCompanyId',
  'newTenantId',
  'oldCompanyId',
  'oldTenantId',
  'recordId',
  'scopeEvidence',
  'scopeSource',
]);
const CANONICAL_SCOPE_KEYS = Object.freeze(['companyId', 'tenantId']);
const SOURCE_KEYS = Object.freeze([
  'deployedSha',
  'deploymentId',
  'snapshotCapturedAt',
  'sourceSnapshotHash',
]);
const COLLECTION_RULE_KEYS = Object.freeze([
  'classification',
  'collection',
  'scopeSource',
]);
const FIXTURE_RECORD_KEYS = Object.freeze(['collection', 'recordId']);
const OBSERVED_RECORD_KEYS = Object.freeze([
  'collection',
  'oldCompanyId',
  'oldTenantId',
  'recordId',
]);
const CONTRACT_KEYS = Object.freeze([
  'candidateAuthoritySha256',
  'candidateCount',
  'candidateKeySetSha256',
  'canonicalScopeSha256',
  'collectionRules',
  'contractVersion',
  'fixtureKeySetSha256',
  'fixtureRecordCount',
  'productionExecutionAuthorized',
]);

class ProductionScopeBaselineContractError extends Error {
  constructor(code, message, details = undefined) {
    super(message);
    this.name = 'ProductionScopeBaselineContractError';
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProductionScopeBaselineContractError(code, message, details);
}

function compareUtf8(left, right) {
  return Buffer.compare(Buffer.from(left, 'utf8'), Buffer.from(right, 'utf8'));
}

function isPlainObject(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function stableJson(value, active = new Set()) {
  if (value === null) return 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      fail('BASELINE_CANONICALIZATION_INVALID', 'Stable JSON does not accept non-finite numbers.');
    }
    return JSON.stringify(value);
  }
  if (!value || typeof value !== 'object') {
    fail('BASELINE_CANONICALIZATION_INVALID', 'Stable JSON accepts JSON values only.');
  }
  if (active.has(value)) {
    fail('BASELINE_CANONICALIZATION_INVALID', 'Stable JSON does not accept cyclic values.');
  }
  active.add(value);
  try {
    if (Array.isArray(value)) {
      const items = [];
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.prototype.hasOwnProperty.call(value, index)) {
          fail('BASELINE_CANONICALIZATION_INVALID', 'Stable JSON does not accept sparse arrays.');
        }
        items.push(stableJson(value[index], active));
      }
      return `[${items.join(',')}]`;
    }
    if (!isPlainObject(value)) {
      fail('BASELINE_CANONICALIZATION_INVALID', 'Stable JSON accepts plain objects only.');
    }
    const ownKeys = Reflect.ownKeys(value);
    if (ownKeys.some(key => (
      typeof key !== 'string'
      || !Object.prototype.propertyIsEnumerable.call(value, key)
    ))) {
      fail('BASELINE_CANONICALIZATION_INVALID', 'Stable JSON accepts enumerable string keys only.');
    }
    const keys = ownKeys.sort(compareUtf8);
    return `{${keys.map(key => (
      `${JSON.stringify(key)}:${stableJson(value[key], active)}`
    )).join(',')}}`;
  } finally {
    active.delete(value);
  }
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function stableJsonSha256(value) {
  return sha256(stableJson(value));
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function assertExactKeys(value, expected, code, label) {
  if (!isPlainObject(value)) fail(code, `${label} must be a plain object.`);
  const actual = Object.keys(value).sort(compareUtf8);
  const wanted = [...expected].sort(compareUtf8);
  if (stableJson(actual) !== stableJson(wanted)) {
    fail(code, `${label} has missing or unreviewed fields.`, { actual, expected: wanted });
  }
}

function exactText(value, code, label) {
  if (
    typeof value !== 'string'
    || value.length === 0
    || value !== value.trim()
    || value.includes('\0')
  ) {
    fail(code, `${label} must be an exact non-empty string.`);
  }
  return value;
}

function nullableExactText(value, code, label) {
  if (value === null) return null;
  return exactText(value, code, label);
}

function exactSha256(value, code, label) {
  if (typeof value !== 'string' || !SHA256_PATTERN.test(value)) {
    fail(code, `${label} must be an exact lowercase SHA-256.`);
  }
  return value;
}

function recordKey(row) {
  return stableJson([row.collection, row.recordId]);
}

function compareRecords(left, right) {
  return compareUtf8(left.collection, right.collection)
    || compareUtf8(left.recordId, right.recordId);
}

function assertUniqueRecordKeys(records, code, label) {
  const keys = new Set();
  for (const row of records) {
    const key = recordKey(row);
    if (keys.has(key)) fail(code, `${label} contains a duplicate collection/recordId pair.`);
    keys.add(key);
  }
}

function normalizeCanonicalScope(value, code = 'BASELINE_CANONICAL_SCOPE_INVALID') {
  assertExactKeys(value, CANONICAL_SCOPE_KEYS, code, 'Canonical scope');
  const companyId = exactText(value.companyId, code, 'Canonical companyId');
  const tenantId = exactText(value.tenantId, code, 'Canonical tenantId');
  if (companyId !== tenantId) {
    fail(code, 'Canonical companyId and tenantId must be identical.');
  }
  return { companyId, tenantId };
}

function normalizeSource(value) {
  const code = 'BASELINE_RAW_AUTHORITY_SCHEMA_INVALID';
  assertExactKeys(value, SOURCE_KEYS, code, 'Raw authority source');
  const deployedSha = exactText(value.deployedSha, code, 'Source deployedSha');
  const deploymentId = exactText(value.deploymentId, code, 'Source deploymentId');
  const snapshotCapturedAt = exactText(
    value.snapshotCapturedAt,
    code,
    'Source snapshotCapturedAt',
  );
  const sourceSnapshotHash = exactSha256(
    value.sourceSnapshotHash,
    code,
    'Source sourceSnapshotHash',
  );
  if (!SHA40_PATTERN.test(deployedSha)) {
    fail(code, 'Source deployedSha must be an exact lowercase commit SHA.');
  }
  if (!UUID_PATTERN.test(deploymentId)) {
    fail(code, 'Source deploymentId must be an exact UUID.');
  }
  if (
    !Number.isFinite(Date.parse(snapshotCapturedAt))
    || new Date(snapshotCapturedAt).toISOString() !== snapshotCapturedAt
  ) {
    fail(code, 'Source snapshotCapturedAt must be an exact UTC timestamp.');
  }
  return { deployedSha, deploymentId, snapshotCapturedAt, sourceSnapshotHash };
}

function normalizeRawRecord(value, index, canonicalScope) {
  const code = 'BASELINE_RAW_AUTHORITY_RECORD_INVALID';
  assertExactKeys(value, RAW_RECORD_KEYS, code, `Raw authority record at index ${index}`);
  const record = {
    collection: exactText(value.collection, code, `Record ${index} collection`),
    recordId: exactText(value.recordId, code, `Record ${index} recordId`),
    oldCompanyId: nullableExactText(
      value.oldCompanyId,
      code,
      `Record ${index} oldCompanyId`,
    ),
    oldTenantId: nullableExactText(
      value.oldTenantId,
      code,
      `Record ${index} oldTenantId`,
    ),
    newCompanyId: exactText(value.newCompanyId, code, `Record ${index} newCompanyId`),
    newTenantId: exactText(value.newTenantId, code, `Record ${index} newTenantId`),
    classification: exactText(
      value.classification,
      code,
      `Record ${index} classification`,
    ),
    scopeSource: exactText(value.scopeSource, code, `Record ${index} scopeSource`),
    scopeEvidence: exactText(value.scopeEvidence, code, `Record ${index} scopeEvidence`),
  };
  if (
    record.newCompanyId !== canonicalScope.companyId
    || record.newTenantId !== canonicalScope.tenantId
  ) {
    fail(code, `Record ${index} target scope differs from the canonical scope.`);
  }
  return record;
}

function validateRawBaselineAuthority(value) {
  const code = 'BASELINE_RAW_AUTHORITY_SCHEMA_INVALID';
  assertExactKeys(value, RAW_AUTHORITY_KEYS, code, 'Raw baseline authority');
  if (value.manifestVersion !== BASELINE_RAW_AUTHORITY_MANIFEST_VERSION) {
    fail(code, 'Raw baseline authority manifestVersion is unsupported.');
  }
  if (value.productionExecutionAuthorized !== false) {
    fail(code, 'Raw baseline authority must remain non-authorizing.');
  }
  if (!Array.isArray(value.records) || value.records.length === 0) {
    fail(code, 'Raw baseline authority requires a non-empty records array.');
  }
  const canonicalScope = normalizeCanonicalScope(value.canonicalScope);
  const source = normalizeSource(value.source);
  const records = value.records.map((row, index) => (
    normalizeRawRecord(row, index, canonicalScope)
  ));
  assertUniqueRecordKeys(
    records,
    'BASELINE_RAW_AUTHORITY_RECORD_DUPLICATE',
    'Raw baseline authority',
  );
  records.sort(compareRecords);
  return deepFreeze({
    manifestVersion: BASELINE_RAW_AUTHORITY_MANIFEST_VERSION,
    productionExecutionAuthorized: false,
    canonicalScope,
    source,
    records,
  });
}

function normalizeCollectionRules(value) {
  const code = 'BASELINE_CONTRACT_RULES_INVALID';
  if (!Array.isArray(value) || value.length !== BASELINE_COLLECTION_RULE_COUNT) {
    fail(code, `Baseline contract requires exactly ${BASELINE_COLLECTION_RULE_COUNT} collection rules.`);
  }
  const rules = value.map((row, index) => {
    assertExactKeys(row, COLLECTION_RULE_KEYS, code, `Collection rule at index ${index}`);
    return {
      collection: exactText(row.collection, code, `Rule ${index} collection`),
      classification: exactText(row.classification, code, `Rule ${index} classification`),
      scopeSource: exactText(row.scopeSource, code, `Rule ${index} scopeSource`),
    };
  });
  const collections = new Set();
  for (const rule of rules) {
    if (collections.has(rule.collection)) {
      fail(code, 'Baseline collection rules contain a duplicate collection.');
    }
    collections.add(rule.collection);
  }
  return rules.sort((left, right) => compareUtf8(left.collection, right.collection));
}

function validateBaselineContract(value) {
  const code = 'BASELINE_CONTRACT_INVALID';
  assertExactKeys(value, CONTRACT_KEYS, code, 'Baseline digest contract');
  if (value.contractVersion !== BASELINE_CONTRACT_VERSION) {
    fail(code, 'Baseline contractVersion is unsupported.');
  }
  if (value.productionExecutionAuthorized !== false) {
    fail(code, 'Baseline contract must remain non-authorizing.');
  }
  if (!Number.isSafeInteger(value.candidateCount) || value.candidateCount <= 0) {
    fail(code, 'Baseline candidateCount must be a positive safe integer.');
  }
  if (!Number.isSafeInteger(value.fixtureRecordCount) || value.fixtureRecordCount <= 0) {
    fail(code, 'Baseline fixtureRecordCount must be a positive safe integer.');
  }
  return deepFreeze({
    contractVersion: BASELINE_CONTRACT_VERSION,
    productionExecutionAuthorized: false,
    candidateCount: value.candidateCount,
    candidateKeySetSha256: exactSha256(
      value.candidateKeySetSha256,
      code,
      'Contract candidateKeySetSha256',
    ),
    candidateAuthoritySha256: exactSha256(
      value.candidateAuthoritySha256,
      code,
      'Contract candidateAuthoritySha256',
    ),
    canonicalScopeSha256: exactSha256(
      value.canonicalScopeSha256,
      code,
      'Contract canonicalScopeSha256',
    ),
    fixtureRecordCount: value.fixtureRecordCount,
    fixtureKeySetSha256: exactSha256(
      value.fixtureKeySetSha256,
      code,
      'Contract fixtureKeySetSha256',
    ),
    collectionRules: normalizeCollectionRules(value.collectionRules),
  });
}

function normalizeKeyRecords(records, expectedKeys, code, label) {
  if (!Array.isArray(records)) fail(code, `${label} must be an array.`);
  const normalized = records.map((row, index) => {
    if (expectedKeys) assertExactKeys(row, expectedKeys, code, `${label} row ${index}`);
    return {
      collection: exactText(row?.collection, code, `${label} row ${index} collection`),
      recordId: exactText(row?.recordId, code, `${label} row ${index} recordId`),
    };
  });
  assertUniqueRecordKeys(normalized, code, label);
  return normalized.sort(compareRecords);
}

function normalizeSemanticRecords(records) {
  const code = 'BASELINE_CANDIDATE_AUTHORITY_INVALID';
  if (!Array.isArray(records) || records.length === 0) {
    fail(code, 'Candidate authority requires a non-empty records array.');
  }
  const normalized = records.map((row, index) => ({
    collection: exactText(row?.collection, code, `Candidate ${index} collection`),
    recordId: exactText(row?.recordId, code, `Candidate ${index} recordId`),
    oldCompanyId: nullableExactText(
      row?.oldCompanyId,
      code,
      `Candidate ${index} oldCompanyId`,
    ),
    oldTenantId: nullableExactText(
      row?.oldTenantId,
      code,
      `Candidate ${index} oldTenantId`,
    ),
    classification: exactText(
      row?.classification,
      code,
      `Candidate ${index} classification`,
    ),
    scopeSource: exactText(row?.scopeSource, code, `Candidate ${index} scopeSource`),
  }));
  assertUniqueRecordKeys(normalized, code, 'Candidate authority');
  return normalized.sort(compareRecords);
}

function canonicalScopeProjection(canonicalScope) {
  const normalized = normalizeCanonicalScope(canonicalScope);
  return deepFreeze({
    domain: BASELINE_DIGEST_DOMAINS.canonicalScope,
    companyId: normalized.companyId,
    tenantId: normalized.tenantId,
  });
}

function keySetProjection(domain, countField, records, expectedKeys, label) {
  const normalized = normalizeKeyRecords(
    records,
    expectedKeys,
    'BASELINE_KEY_SET_INVALID',
    label,
  );
  return deepFreeze({
    domain,
    [countField]: normalized.length,
    records: normalized.map(row => [row.collection, row.recordId]),
  });
}

function candidateKeySetProjection(records) {
  return keySetProjection(
    BASELINE_DIGEST_DOMAINS.candidateKeySet,
    'candidateCount',
    records,
    null,
    'Candidate key set',
  );
}

function fixtureKeySetProjection(records) {
  return keySetProjection(
    BASELINE_DIGEST_DOMAINS.fixtureKeySet,
    'fixtureRecordCount',
    records,
    FIXTURE_RECORD_KEYS,
    'Fixture key set',
  );
}

function candidateAuthorityProjection(canonicalScope, records) {
  const scope = canonicalScopeProjection(canonicalScope);
  const normalized = normalizeSemanticRecords(records);
  const keySet = candidateKeySetProjection(normalized);
  return deepFreeze({
    domain: BASELINE_DIGEST_DOMAINS.candidateAuthority,
    candidateCount: normalized.length,
    candidateKeySetSha256: stableJsonSha256(keySet),
    canonicalScopeSha256: stableJsonSha256(scope),
    records: normalized,
  });
}

function calculateNormalizedSemanticDigests(authority) {
  const scope = canonicalScopeProjection(authority.canonicalScope);
  const keySet = candidateKeySetProjection(authority.records);
  const candidateAuthority = candidateAuthorityProjection(
    authority.canonicalScope,
    authority.records,
  );
  return deepFreeze({
    candidateCount: authority.records.length,
    candidateKeySetSha256: stableJsonSha256(keySet),
    candidateAuthoritySha256: stableJsonSha256(candidateAuthority),
    canonicalScopeSha256: stableJsonSha256(scope),
  });
}

function calculateBaselineSemanticDigests(rawAuthority) {
  return calculateNormalizedSemanticDigests(validateRawBaselineAuthority(rawAuthority));
}

function validateFixtureSet(fixtureRecords, contract) {
  const projection = fixtureKeySetProjection(fixtureRecords);
  const observed = {
    fixtureRecordCount: projection.fixtureRecordCount,
    fixtureKeySetSha256: stableJsonSha256(projection),
  };
  const mismatches = Object.keys(observed).filter(field => observed[field] !== contract[field]);
  if (mismatches.length > 0) {
    fail(
      'BASELINE_FIXTURE_SET_MISMATCH',
      'Observed fixture set differs from the reviewed whole-set commitment.',
      { mismatches },
    );
  }
  return projection.records.map(([collection, recordId]) => ({ collection, recordId }));
}

function assertRulesCoverAuthority(records, rules) {
  const ruleByCollection = new Map(rules.map(rule => [rule.collection, rule]));
  const usedRules = new Set();
  for (const row of records) {
    const rule = ruleByCollection.get(row.collection);
    if (
      !rule
      || row.classification !== rule.classification
      || row.scopeSource !== rule.scopeSource
    ) {
      fail(
        'BASELINE_COLLECTION_RULE_MISMATCH',
        'Candidate authority differs from its exact collection rule.',
      );
    }
    usedRules.add(row.collection);
  }
  if (usedRules.size !== rules.length) {
    fail('BASELINE_COLLECTION_RULE_MISMATCH', 'A baseline collection rule has no candidate.');
  }
}

function buildBaselineContract({ rawAuthority, collectionRules, fixtureRecords }) {
  const authority = validateRawBaselineAuthority(rawAuthority);
  const rules = normalizeCollectionRules(collectionRules);
  assertRulesCoverAuthority(authority.records, rules);
  const candidate = calculateNormalizedSemanticDigests(authority);
  const fixture = fixtureKeySetProjection(fixtureRecords);
  return validateBaselineContract({
    contractVersion: BASELINE_CONTRACT_VERSION,
    productionExecutionAuthorized: false,
    ...candidate,
    fixtureRecordCount: fixture.fixtureRecordCount,
    fixtureKeySetSha256: stableJsonSha256(fixture),
    collectionRules: rules,
  });
}

function compareBaselineAuthorityToContract({ rawAuthority, contract, fixtureRecords }) {
  const authority = validateRawBaselineAuthority(rawAuthority);
  const normalizedContract = validateBaselineContract(contract);
  assertRulesCoverAuthority(authority.records, normalizedContract.collectionRules);
  validateFixtureSet(fixtureRecords, normalizedContract);
  const observed = calculateNormalizedSemanticDigests(authority);
  const mismatches = Object.keys(observed).filter(field => (
    observed[field] !== normalizedContract[field]
  ));
  if (mismatches.length > 0) {
    fail(
      'BASELINE_CONTRACT_MISMATCH',
      'Raw baseline authority differs from the reviewed semantic contract.',
      { mismatches },
    );
  }
  return authority;
}

function normalizeObservedRecords(value) {
  const code = 'BASELINE_OBSERVED_RECORDS_INVALID';
  if (!Array.isArray(value) || value.length === 0) {
    fail(code, 'Observed records must be a non-empty array.');
  }
  const records = value.map((row, index) => {
    assertExactKeys(row, OBSERVED_RECORD_KEYS, code, `Observed record at index ${index}`);
    return {
      collection: exactText(row.collection, code, `Observed ${index} collection`),
      recordId: exactText(row.recordId, code, `Observed ${index} recordId`),
      oldCompanyId: nullableExactText(
        row.oldCompanyId,
        code,
        `Observed ${index} oldCompanyId`,
      ),
      oldTenantId: nullableExactText(
        row.oldTenantId,
        code,
        `Observed ${index} oldTenantId`,
      ),
    };
  });
  assertUniqueRecordKeys(records, code, 'Observed records');
  return records.sort(compareRecords);
}

function deriveAndVerifyBaselineCandidates({
  contract,
  canonicalScope,
  observedRecords,
  fixtureRecords,
}) {
  const normalizedContract = validateBaselineContract(contract);
  const scope = normalizeCanonicalScope(canonicalScope);
  if (stableJsonSha256(canonicalScopeProjection(scope)) !== normalizedContract.canonicalScopeSha256) {
    fail('BASELINE_CANONICAL_SCOPE_MISMATCH', 'Canonical scope differs from its commitment.');
  }
  const observed = normalizeObservedRecords(observedRecords);
  const observedByKey = new Map(observed.map(row => [recordKey(row), row]));
  const fixtures = validateFixtureSet(fixtureRecords, normalizedContract);
  const fixtureKeys = new Set(fixtures.map(recordKey));
  for (const key of fixtureKeys) {
    if (!observedByKey.has(key)) {
      fail('BASELINE_FIXTURE_RECORD_MISSING', 'A committed fixture is absent from observed records.');
    }
  }
  const ruleByCollection = new Map(normalizedContract.collectionRules.map(rule => [
    rule.collection,
    rule,
  ]));
  const candidates = observed.filter(row => (
    ruleByCollection.has(row.collection) && !fixtureKeys.has(recordKey(row))
  )).map(row => {
    const rule = ruleByCollection.get(row.collection);
    return {
      collection: row.collection,
      recordId: row.recordId,
      oldCompanyId: row.oldCompanyId,
      oldTenantId: row.oldTenantId,
      newCompanyId: scope.companyId,
      newTenantId: scope.tenantId,
      classification: rule.classification,
      scopeSource: rule.scopeSource,
    };
  }).sort(compareRecords);
  const observedDigests = calculateNormalizedSemanticDigests({
    canonicalScope: scope,
    records: candidates,
  });
  const mismatches = Object.keys(observedDigests).filter(field => (
    observedDigests[field] !== normalizedContract[field]
  ));
  if (mismatches.length > 0) {
    fail(
      'BASELINE_CANDIDATE_SET_MISMATCH',
      'Derived candidates differ from the reviewed exact-set commitment.',
      { mismatches },
    );
  }
  return deepFreeze(candidates);
}

module.exports = {
  BASELINE_COLLECTION_RULE_COUNT,
  BASELINE_CONTRACT_VERSION,
  BASELINE_DIGEST_DOMAINS,
  BASELINE_RAW_AUTHORITY_MANIFEST_VERSION,
  ProductionScopeBaselineContractError,
  buildBaselineContract,
  calculateBaselineSemanticDigests,
  candidateAuthorityProjection,
  candidateKeySetProjection,
  canonicalScopeProjection,
  compareBaselineAuthorityToContract,
  deriveAndVerifyBaselineCandidates,
  fixtureKeySetProjection,
  stableJson,
  stableJsonSha256,
  validateBaselineContract,
  validateRawBaselineAuthority,
};
