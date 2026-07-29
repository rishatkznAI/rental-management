import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const {
  ERROR_CODES,
  OPERATION_DOMAIN,
  acceptedDryRunsEnvelope,
  assertRfc3339Milliseconds,
  assertSafeInteger,
  assertUuidV4,
  canonicalJson,
  compareAuthorityDenialCandidate,
  compareOperationalOrder,
  compareSafeIntegerAscending,
  compareSafeIntegerDescending,
  compareUtf16Ascending,
  circuitTransitionResult,
  hashEnvelope,
  materializeInert,
  parseCanonicalJson,
  parseJson,
  renderUtcMilliseconds,
  selectRateQualifyingAttempts,
  sha256Canonical,
} = require('../server/lib/canonical-actual-posting-domain.js');

test('restricted canonical JSON is deterministic, UTF-16 ordered, and byte-exact', () => {
  const left = { z: [3, true, null], a: 'line\nvalue', '\u{1f600}': 1, '\ufffd': 2 };
  const right = { '\ufffd': 2, '\u{1f600}': 1, a: 'line\nvalue', z: [3, true, null] };
  const expected = '{"a":"line\\nvalue","z":[3,true,null],"😀":1,"�":2}';
  assert.equal(canonicalJson(left), expected);
  assert.equal(canonicalJson(right), expected);
  assert.deepEqual(parseCanonicalJson(expected), materializeInert(left));
  assert.equal(
    sha256Canonical(left),
    crypto.createHash('sha256').update(Buffer.from(expected, 'utf8')).digest('hex'),
  );
});

test('JSON parser rejects non-canonical bytes, duplicates, fractions, exponents, unsafe numbers, BOM, and invalid UTF-8', () => {
  for (const input of [
    '{ "a":1}', '{"b":1,"a":2}', '{"a":1,"a":1}', '1.0', '1e0',
    '9007199254740992', '-0', '\ufeff{}',
  ]) {
    assert.throws(() => parseCanonicalJson(input), error => [
      ERROR_CODES.JSON_INVALID, ERROR_CODES.JSON_NOT_CANONICAL, ERROR_CODES.SAFE_INTEGER_REQUIRED,
    ].includes(error.code), input);
  }
  assert.throws(() => parseJson(Buffer.from([0xc3, 0x28])), error => error.code === ERROR_CODES.JSON_INVALID);
});

test('deep inert boundary rejects proxies, accessors, cycles, sparse arrays, prototypes, symbols, and limits', () => {
  assert.throws(() => materializeInert(new Proxy({}, {})), error => error.code === ERROR_CODES.INPUT_NOT_INERT);
  const accessor = {};
  Object.defineProperty(accessor, 'value', { enumerable: true, get: () => 1 });
  assert.throws(() => materializeInert(accessor), error => error.code === ERROR_CODES.INPUT_NOT_INERT);
  const cycle = {};
  cycle.cycle = cycle;
  assert.throws(() => materializeInert(cycle), error => error.code === ERROR_CODES.INPUT_NOT_INERT);
  assert.throws(() => materializeInert(new Array(2)), error => error.code === ERROR_CODES.INPUT_NOT_INERT);
  assert.throws(() => materializeInert(new Date()), error => error.code === ERROR_CODES.INPUT_NOT_INERT);
  assert.throws(() => materializeInert({ [Symbol('x')]: 1 }), error => error.code === ERROR_CODES.INPUT_NOT_INERT);
  assert.throws(() => materializeInert({ value: 'x'.repeat(262_145) }), error => error.code === ERROR_CODES.INPUT_LIMIT_EXCEEDED);
});

test('safe integer, UUIDv4, timestamp, and versioned envelope contracts fail closed', () => {
  assert.equal(assertSafeInteger(Number.MAX_SAFE_INTEGER), Number.MAX_SAFE_INTEGER);
  for (const value of [1.5, Number.MAX_SAFE_INTEGER + 1, '1', NaN]) {
    assert.throws(() => assertSafeInteger(value), error => error.code === ERROR_CODES.SAFE_INTEGER_REQUIRED);
  }
  const uuid = '01234567-89ab-4cde-8fab-0123456789ab';
  assert.equal(assertUuidV4(uuid), uuid);
  for (const value of [uuid.toUpperCase(), '01234567-89ab-5cde-8fab-0123456789ab', '', null]) {
    assert.throws(() => assertUuidV4(value), error => error.code === ERROR_CODES.INVALID_UUID);
  }
  assert.equal(renderUtcMilliseconds(0), '1970-01-01T00:00:00.000Z');
  assert.equal(assertRfc3339Milliseconds('2026-07-27T12:00:00.000Z'), '2026-07-27T12:00:00.000Z');
  assert.throws(() => assertRfc3339Milliseconds('2026-07-27T12:00:00Z'), error => error.code === ERROR_CODES.INVALID_TIMESTAMP);
  assert.deepEqual(acceptedDryRunsEnvelope([{ dryRunId: 'run-1', resultHash: 'a'.repeat(64) }]), {
    acceptedDryRuns: [{ dryRunId: 'run-1', resultHash: 'a'.repeat(64) }],
    domain: 'rentcore.canonical_actual_posting.accepted_dry_runs',
    version: 1,
  });
  assert.throws(
    () => acceptedDryRunsEnvelope([{ dryRunId: 'run-1', resultHash: 'a'.repeat(64), version: 2 }]),
    error => error.code === ERROR_CODES.ENVELOPE_INVALID,
  );
});

test('all normative comparators use explicit stable ordering without coercion', () => {
  assert.deepEqual(['10', '2', 'a'].sort(compareUtf16Ascending), ['10', '2', 'a']);
  assert.deepEqual([10, 2, 1].sort(compareSafeIntegerAscending), [1, 2, 10]);
  assert.deepEqual([10, 2, 1].sort(compareSafeIntegerDescending), [10, 2, 1]);
  assert.throws(() => compareSafeIntegerAscending('2', 2), error => error.code === ERROR_CODES.AUTHORITY_CANDIDATE_COMPARATOR_FAILED);
  const candidates = [
    { precedenceRank: 1, authorityVersion: 2, authorityRecordId: 'z' },
    { precedenceRank: 1, authorityVersion: 10, authorityRecordId: 'b' },
    { precedenceRank: 1, authorityVersion: 10, authorityRecordId: 'a' },
    { precedenceRank: 0, authorityVersion: 1, authorityRecordId: 'q' },
  ];
  assert.deepEqual(candidates.sort(compareAuthorityDenialCandidate).map(item => item.authorityRecordId), ['q', 'a', 'b', 'z']);
});

test('operational ordering uses only evidenceAttemptedAt then scopeSequence and filters before sorting', () => {
  const base = {
    companyId: 'company-a', branchId: 'branch-a', operationDomain: OPERATION_DOMAIN,
    evidenceAttemptedAt: '2026-07-27T12:00:00.000Z',
  };
  assert.equal(compareOperationalOrder({ ...base, scopeSequence: 1 }, { ...base, scopeSequence: 2 }), -1);
  assert.equal(compareOperationalOrder(
    { ...base, evidenceAttemptedAt: '2026-07-27T11:59:59.999Z', scopeSequence: 99 },
    { ...base, scopeSequence: 1 },
  ), -1);
  const rows = [
    { ...base, scopeSequence: 3, rateApplied: 1, denialAttemptId: 'c' },
    { ...base, scopeSequence: 1, rateApplied: 1, denialAttemptId: 'a' },
    { ...base, scopeSequence: 2, rateApplied: 0, denialAttemptId: 'b' },
    { ...base, companyId: 'other', scopeSequence: 0, rateApplied: 1, denialAttemptId: 'x' },
  ];
  const selected = selectRateQualifyingAttempts(rows, { ...base, scopeSequence: 4 });
  assert.deepEqual(selected.rows.map(row => row.denialAttemptId), ['a', 'c']);
});

test('rate selection is invariant under direct, reverse, random, and equal-time input order', () => {
  const candidate = {
    companyId: 'company-a', branchId: 'branch-a', operationDomain: OPERATION_DOMAIN,
    evidenceAttemptedAt: '2026-07-27T12:00:30.000Z', scopeSequence: 31,
  };
  const rows = Array.from({ length: 30 }, (_, index) => ({
    companyId: 'company-a',
    branchId: 'branch-a',
    operationDomain: OPERATION_DOMAIN,
    evidenceAttemptedAt: index % 2 === 0 ? '2026-07-27T12:00:00.000Z' : '2026-07-27T12:00:15.000Z',
    scopeSequence: index + 1,
    rateApplied: 1,
    denialAttemptId: `attempt-${String(index + 1).padStart(2, '0')}`,
  }));
  const permutations = [
    rows,
    [...rows].reverse(),
    [...rows].sort((left, right) => ((left.scopeSequence * 17) % 31) - ((right.scopeSequence * 17) % 31)),
    rows.map(row => ({ ...row, evidenceAttemptedAt: '2026-07-27T12:00:30.000Z' })),
  ];
  const results = permutations.map(input => selectRateQualifyingAttempts(input, candidate));
  assert.ok(results.every(result => result.rows.length === 30));
  assert.equal(
    canonicalJson(results[0].qualifyingDenialAttemptIds),
    canonicalJson(results[1].qualifyingDenialAttemptIds),
  );
  assert.equal(
    canonicalJson(results[0].qualifyingDenialAttemptIds),
    canonicalJson(results[2].qualifyingDenialAttemptIds),
  );
  assert.deepEqual(results[3].rows.map(row => row.scopeSequence), Array.from({ length: 30 }, (_, index) => index + 1));
});

test('fifth-in-five circuit reconstruction is order-independent and leaves the first four byte-exact', () => {
  const baseTime = '2026-07-27T12:00:00.000Z';
  const rows = Array.from({ length: 5 }, (_, index) => ({
    transitionId: `transition-${index + 1}`,
    companyId: 'company-a',
    branchId: 'branch-a',
    operationDomain: OPERATION_DOMAIN,
    scopeSequence: index + 1,
    circuitApplied: 1,
    conflictType: index % 2 === 0 ? 'AUTHORIZATION_DRIFT' : 'ACTIVATION_DRIFT',
    denialAttemptId: `attempt-${index + 1}`,
    evidenceAttemptedAt: baseTime,
  }));
  const transition = index => ({
    ...rows[index],
    circuitRule: 'fifth_in_five',
    circuitTransitionKey: String(index + 1).padStart(64, 'a'),
  });
  const conflict = index => ({
    denialAttemptId: rows[index].denialAttemptId,
    evidenceAttemptedAt: rows[index].evidenceAttemptedAt,
  });
  const beforeFifth = rows.slice(0, 4).map((_, index) => circuitTransitionResult({
    transition: transition(index), conflict: conflict(index), committedRows: rows.slice(0, 4),
  }));
  assert.ok(beforeFifth.every(result => result.circuitState === 'closed'));
  const inputOrders = [rows, [...rows].reverse(), [rows[2], rows[0], rows[4], rows[1], rows[3]]];
  const fifth = inputOrders.map(committedRows => circuitTransitionResult({
    transition: transition(4), conflict: conflict(4), committedRows,
  }));
  assert.ok(fifth.every(result => result.circuitState === 'open'));
  assert.ok(fifth.every(result => canonicalJson(result) === canonicalJson(fifth[0])));
  const afterFifth = rows.slice(0, 4).map((_, index) => circuitTransitionResult({
    transition: transition(index), conflict: conflict(index), committedRows: rows,
  }));
  assert.deepEqual(afterFifth.map(canonicalJson), beforeFifth.map(canonicalJson));
});

test('hash envelopes retain explicit domain separation and stable error literals', () => {
  const first = hashEnvelope({ a: 1 }, ['a'], 'domain.one');
  const second = hashEnvelope({ a: 1 }, ['a'], 'domain.two');
  assert.notEqual(sha256Canonical(first), sha256Canonical(second));
  assert.equal(ERROR_CODES.DENIAL_ATTEMPT_ID_GENERATION_FAILED, 'CANONICAL_DENIAL_ATTEMPT_ID_GENERATION_FAILED');
  assert.equal(ERROR_CODES.DENIAL_ATTEMPT_ID_COLLISION, 'CANONICAL_DENIAL_ATTEMPT_ID_COLLISION');
  assert.equal(ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED, 'CANONICAL_CONFLICT_REPLAY_INTEGRITY_FAILED');
  assert.equal(ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED, 'CANONICAL_CONFLICT_TRANSITION_RECOVERY_REQUIRED');
});
