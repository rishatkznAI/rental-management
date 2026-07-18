import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  closePlan,
  hash,
} from './billing-source-authority-fixtures.js';

const require = createRequire(import.meta.url);
const {
  BillingSourceAuthorityError,
  OPERATION_CAPABILITIES,
  canonicalizeEvidenceSet,
  civilDate,
  computeEvidenceSetHash,
  fingerprint,
  materializeBillingSourceCommandPlan,
  moneyMinor,
  safeAdd,
  stableJson,
} = require('../server/lib/billing-source-authority-domain.js');

function code(error, expected) {
  return error instanceof BillingSourceAuthorityError && error.code === expected;
}

test('civil dates are real calendar dates and intervals remain half-open', () => {
  assert.equal(civilDate('2028-02-29', 'date'), '2028-02-29');
  assert.throws(() => civilDate('2027-02-29', 'date'), error => code(error, 'BILLING_SOURCE_INVALID_DATE'));
  assert.throws(() => civilDate('2026-2-01', 'date'), error => code(error, 'BILLING_SOURCE_INVALID_DATE'));
  const adjacent = closePlan({ periodStartDate: '2026-08-01', periodEndDateExclusive: '2026-09-01' });
  assert.equal(materializeBillingSourceCommandPlan(adjacent).period.periodEndDateExclusive, '2026-09-01');
  const empty = closePlan({ periodStartDate: '2026-08-01', periodEndDateExclusive: '2026-08-01' });
  assert.throws(() => materializeBillingSourceCommandPlan(empty), error => code(error, 'BILLING_SOURCE_INVALID_INTERVAL'));
});

test('command surface reuses only the exact existing PR5 capabilities', () => {
  assert.deepEqual(OPERATION_CAPABILITIES, {
    close_billing_period: 'billing.period.close',
    reopen_billing_period: 'billing.period.reopen',
    form_upd: 'upd.form',
    record_upd_coverage: 'upd.form',
    conduct_upd: 'upd.conduct',
    correct_upd: 'upd.correct',
  });
});

test('immutable source money accepts safe integer minor units only and detects overflow', () => {
  assert.equal(moneyMinor(12345, 'amount'), 12345);
  for (const value of [1.5, '100', Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1]) {
    assert.throws(() => moneyMinor(value, 'amount'), error => code(error, 'BILLING_SOURCE_INVALID_MONEY'));
  }
  assert.equal(safeAdd([10, -3, 2], 'sum'), 9);
  assert.throws(
    () => safeAdd([Number.MAX_SAFE_INTEGER, 1], 'sum'),
    error => code(error, 'BILLING_SOURCE_MONEY_OVERFLOW'),
  );
});

test('sorted-key serialization and fingerprints are deterministic across object key order', () => {
  const left = { z: 1, nested: { b: 2, a: 1 }, list: [{ y: 2, x: 1 }] };
  const right = { list: [{ x: 1, y: 2 }], nested: { a: 1, b: 2 }, z: 1 };
  assert.equal(stableJson(left), stableJson(right));
  assert.equal(fingerprint(left), fingerprint(right));
  assert.match(fingerprint(left), /^[a-f0-9]{64}$/);
});

test('calculation-input hash is deterministic and includes algorithm version', () => {
  const first = closePlan({
    calculationInputs: { quantity: 31, policy: { b: 2, a: 1 } },
    calculationAlgorithmVersion: 1,
  });
  const reordered = closePlan({
    calculationInputs: { policy: { a: 1, b: 2 }, quantity: 31 },
    calculationAlgorithmVersion: 1,
  });
  const changedAlgorithm = closePlan({
    calculationInputs: { policy: { a: 1, b: 2 }, quantity: 31 },
    calculationAlgorithmVersion: 2,
  });
  const firstPlan = materializeBillingSourceCommandPlan(first);
  const reorderedPlan = materializeBillingSourceCommandPlan(reordered);
  const changedPlan = materializeBillingSourceCommandPlan(changedAlgorithm);
  assert.equal(firstPlan.snapshot.calculationInputsHash, reorderedPlan.snapshot.calculationInputsHash);
  assert.notEqual(firstPlan.snapshot.calculationInputsHash, changedPlan.snapshot.calculationInputsHash);
});

test('evidence-set integrity is order-independent and covers every authoritative field', () => {
  const first = closePlan().evidence[0];
  const second = {
    ...first,
    evidenceType: 'contract',
    sourceId: 'contract-source-1',
    sourceEventId: 'contract-evidence-event-1',
    authorityPolicyRef: 'contract-authority-policy-test-v1',
    evidenceHash: hash('contract-evidence-1'),
  };
  const baseline = computeEvidenceSetHash([first, second]);
  assert.equal(baseline, computeEvidenceSetHash([second, first]));
  for (const [field, changed] of [
    ['evidenceType', { evidenceType: 'effective_terms' }],
    ['sourceEventVersion', { sourceEventVersion: 2 }],
    ['covered interval', { coveredEndDateExclusive: '2026-08-31' }],
    ['authorityStatus', { authorityStatus: 'rejected', authorityPolicyRef: null }],
    ['authorityPolicyRef', { authorityPolicyRef: 'rental-authority-policy-test-v2' }],
    ['evidenceHash', { evidenceHash: hash('changed-evidence-content') }],
  ]) {
    assert.notEqual(
      baseline,
      computeEvidenceSetHash([{ ...first, ...changed }, second]),
      field,
    );
  }
});

test('duplicate evidence identities fail closed as exact duplicates or conflicting facts', () => {
  const evidence = closePlan().evidence[0];
  assert.throws(
    () => canonicalizeEvidenceSet([evidence, { ...evidence }]),
    error => code(error, 'BILLING_SOURCE_DUPLICATE_EVIDENCE'),
  );
  assert.throws(
    () => canonicalizeEvidenceSet([evidence, { ...evidence, evidenceHash: hash('conflicting-content') }]),
    error => code(error, 'BILLING_SOURCE_CONFLICTING_EVIDENCE'),
  );
});

test('caller evidence hash is assertion-only and materialized evidence is isolated from caller mutation', () => {
  const arbitrary = closePlan();
  arbitrary.snapshot.evidenceSetHash = hash('caller-authoritative-hash');
  assert.throws(
    () => materializeBillingSourceCommandPlan(arbitrary),
    error => code(error, 'BILLING_SOURCE_UNKNOWN_FIELD'),
  );

  const input = closePlan();
  const expectedHash = computeEvidenceSetHash(input.evidence);
  input.snapshot.expectedEvidenceSetHash = expectedHash;
  const plan = materializeBillingSourceCommandPlan(input);
  input.evidence[0].evidenceHash = hash('mutated-after-materialization');
  assert.equal(plan.snapshot.expectedEvidenceSetHash, expectedHash);
  assert.equal(computeEvidenceSetHash(plan.evidence), expectedHash);
});

test('matched snapshots require exact discount-before-VAT and net/VAT/gross arithmetic', () => {
  assert.doesNotThrow(() => materializeBillingSourceCommandPlan(closePlan({
    preDiscountNetMinor: 100_000,
    discountMinor: 10_000,
    netMinor: 90_000,
    vatMinor: 18_000,
    grossMinor: 108_000,
    discountKind: 'fixed_minor',
    discountValue: 10_000,
  })));
  assert.throws(
    () => materializeBillingSourceCommandPlan(closePlan({ discountMinor: 1, netMinor: 100_000 })),
    error => code(error, 'BILLING_SOURCE_NET_MISMATCH'),
  );
  assert.throws(
    () => materializeBillingSourceCommandPlan(closePlan({ grossMinor: 120_001 })),
    error => code(error, 'BILLING_SOURCE_GROSS_MISMATCH'),
  );
});

test('blocked source is explicit while matched source cannot retain blocker reasons', () => {
  assert.doesNotThrow(() => materializeBillingSourceCommandPlan(closePlan({
    sourceIntegrityStatus: 'blocked',
    blockerReasonCodes: ['VAT_POLICY_UNRESOLVED'],
    policyResolutionStatus: 'unresolved',
    unresolvedReasonCodes: ['VAT_POLICY_UNRESOLVED'],
    evidenceAuthorityStatus: 'unresolved',
  })));
  assert.throws(
    () => materializeBillingSourceCommandPlan(closePlan({
      sourceIntegrityStatus: 'blocked',
      blockerReasonCodes: [],
    })),
    error => code(error, 'BILLING_SOURCE_BLOCKER_REQUIRED'),
  );
  assert.throws(
    () => materializeBillingSourceCommandPlan(closePlan({
      sourceIntegrityStatus: 'matched',
      blockerReasonCodes: ['UNEXPECTED'],
    })),
    error => code(error, 'BILLING_SOURCE_MATCHED_HAS_BLOCKERS'),
  );
  assert.throws(
    () => materializeBillingSourceCommandPlan(closePlan({
      sourceIntegrityStatus: 'blocked',
      blockerReasonCodes: ['VAT_POLICY_UNRESOLVED'],
      policyResolutionStatus: ' unresolved ',
      unresolvedReasonCodes: [],
      evidenceAuthorityStatus: 'unresolved',
    })),
    error => code(error, 'BILLING_SOURCE_REASON_CODES_REQUIRED'),
  );
});

test('stable rental and UPD line identities reject positions, labels, descriptions, and names', () => {
  for (const identityKind of [
    'array_index',
    'document_position',
    'client_name',
    'equipment_name',
    'inventory_label',
    'description',
    'line_label',
  ]) {
    assert.throws(
      () => materializeBillingSourceCommandPlan(closePlan({ sourceLineIdentityKind: identityKind })),
      error => code(error, 'BILLING_SOURCE_UNSTABLE_IDENTITY'),
      identityKind,
    );
  }
  assert.doesNotThrow(() => materializeBillingSourceCommandPlan(closePlan({
    sourceLineIdentityKind: 'generated_forward_line_id',
  })));
});

test('explicit RUB is mandatory and currency has no default or FX conversion', () => {
  assert.throws(
    () => materializeBillingSourceCommandPlan(closePlan({ currency: 'USD' })),
    error => code(error, 'BILLING_SOURCE_CURRENCY_UNSUPPORTED'),
  );
  const missing = closePlan();
  delete missing.snapshot.currency;
  assert.throws(
    () => materializeBillingSourceCommandPlan(missing),
    error => code(error, 'BILLING_SOURCE_REQUIRED'),
  );
});

test('unknown command fields and secret-bearing fields fail before repository work', () => {
  const unknown = closePlan();
  unknown.actorPrincipalId = 'forged-user';
  assert.throws(
    () => materializeBillingSourceCommandPlan(unknown),
    error => code(error, 'BILLING_SOURCE_UNKNOWN_FIELD'),
  );
  const secret = closePlan({ auditMetadata: { apiToken: 'must-not-enter-audit' } });
  assert.throws(
    () => materializeBillingSourceCommandPlan(secret),
    error => code(error, 'BILLING_SOURCE_SECRET_FIELD_REJECTED'),
  );
});

test('inert boundary rejects getters, setters, toJSON, custom prototypes, cycles, holes, and exotic values', async t => {
  const scenarios = [];
  let getterCalls = 0;
  const getter = closePlan();
  Object.defineProperty(getter, 'unexpected', {
    enumerable: true,
    get() { getterCalls += 1; return 'no'; },
  });
  scenarios.push(['getter', getter]);
  const nestedGetter = closePlan();
  Object.defineProperty(nestedGetter.snapshot, 'unexpected', {
    enumerable: true,
    get() { getterCalls += 1; return 'no'; },
  });
  scenarios.push(['nested getter', nestedGetter]);
  let setterCalls = 0;
  const setter = closePlan();
  Object.defineProperty(setter, 'unexpected', {
    enumerable: true,
    set() { setterCalls += 1; },
  });
  scenarios.push(['setter', setter]);
  const ownToJson = closePlan();
  ownToJson.toJSON = () => ({ ok: false });
  scenarios.push(['own toJSON', ownToJson]);
  const inheritedToJson = Object.create({ toJSON() { return {}; } });
  Object.assign(inheritedToJson, closePlan());
  scenarios.push(['inherited toJSON', inheritedToJson]);
  class CustomCommand {}
  const custom = Object.assign(new CustomCommand(), closePlan());
  scenarios.push(['custom class', custom]);
  const cycle = closePlan();
  cycle.auditMetadata = {};
  cycle.auditMetadata.self = cycle.auditMetadata;
  scenarios.push(['cycle', cycle]);
  const sparse = closePlan();
  sparse.evidence = new Array(1);
  scenarios.push(['sparse array', sparse]);
  const customArray = closePlan();
  customArray.evidence.extra = true;
  scenarios.push(['array custom property', customArray]);
  const symbolKey = closePlan();
  symbolKey[Symbol('hidden')] = true;
  scenarios.push(['symbol key', symbolKey]);
  const hidden = closePlan();
  Object.defineProperty(hidden, 'hidden', { value: true, enumerable: false });
  scenarios.push(['non-enumerable', hidden]);
  for (const [name, exotic] of [
    ['Date', new Date()],
    ['Buffer', Buffer.from('x')],
    ['Map', new Map()],
    ['Set', new Set()],
    ['WeakMap', new WeakMap()],
    ['WeakSet', new WeakSet()],
    ['RegExp', /x/],
    ['Error', new Error('x')],
    ['Promise', Promise.resolve()],
    ['typed array', new Uint8Array([1])],
    ['ArrayBuffer', new ArrayBuffer(1)],
    ['function', () => {}],
    ['symbol', Symbol('x')],
    ['bigint', 1n],
    ['undefined', undefined],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
  ]) {
    const candidate = closePlan();
    candidate.auditMetadata = { exotic };
    scenarios.push([name, candidate]);
  }
  for (const [name, input] of scenarios) {
    await t.test(name, () => {
      assert.throws(
        () => materializeBillingSourceCommandPlan(input),
        error => code(error, 'BILLING_SOURCE_COMMAND_NOT_INERT'),
      );
    });
  }
  assert.equal(getterCalls, 0);
  assert.equal(setterCalls, 0);
});

test('top-level and nested proxies are rejected without invoking traps', () => {
  let traps = 0;
  const proxy = new Proxy(closePlan(), {
    ownKeys() { traps += 1; throw new Error('trap invoked'); },
    get() { traps += 1; throw new Error('trap invoked'); },
  });
  assert.throws(
    () => materializeBillingSourceCommandPlan(proxy),
    error => code(error, 'BILLING_SOURCE_COMMAND_NOT_INERT'),
  );
  const nested = closePlan();
  nested.auditMetadata = {
    value: new Proxy([], {
      ownKeys() { traps += 1; throw new Error('trap invoked'); },
      get() { traps += 1; throw new Error('trap invoked'); },
    }),
  };
  assert.throws(
    () => materializeBillingSourceCommandPlan(nested),
    error => code(error, 'BILLING_SOURCE_COMMAND_NOT_INERT'),
  );
  const proxyPrototype = new Proxy({}, {
    has() { traps += 1; throw new Error('trap invoked'); },
  });
  const inheritedProxy = Object.assign(Object.create(proxyPrototype), closePlan());
  assert.throws(
    () => materializeBillingSourceCommandPlan(inheritedProxy),
    error => code(error, 'BILLING_SOURCE_COMMAND_NOT_INERT'),
  );
  assert.equal(traps, 0);
});

test('source hashes are lowercase SHA-256 and different command content changes the fingerprint', () => {
  const first = materializeBillingSourceCommandPlan(closePlan());
  const second = materializeBillingSourceCommandPlan(closePlan({ sourceHash: hash('other-close') }));
  assert.match(first.sourceHash, /^[a-f0-9]{64}$/);
  assert.notEqual(fingerprint(first), fingerprint(second));
  const invalid = closePlan({ sourceHash: 'ABC' });
  assert.throws(
    () => materializeBillingSourceCommandPlan(invalid),
    error => code(error, 'BILLING_SOURCE_INVALID_HASH'),
  );
});
