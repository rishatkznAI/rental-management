import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const pr9aAuthorizationBaseline = 'da3bd21935abfbd42c95ef8be9eac1eecb56e95c';
const pr9aAuthorizedHead = 'a8987eb8c33a7b8974a21a8d25ad018b05317148';
const pr9aAllowedFiles = new Set([
  'server/db.js',
  'server/lib/canonical-actual-posting-schema.js',
  'server/lib/canonical-actual-posting-domain.js',
  'server/lib/canonical-actual-posting-authority-repository.js',
  'server/lib/canonical-actual-eligibility-event-repository.js',
  'server/lib/canonical-actual-eligibility-event-service.js',
  'tests/canonical-actual-posting-fixtures.js',
  'tests/canonical-actual-posting-schema.test.js',
  'tests/canonical-actual-posting-domain.test.js',
  'tests/canonical-actual-posting-authority.test.js',
  'tests/canonical-actual-eligibility-event.test.js',
  'tests/canonical-actual-posting-structural.test.js',
  'tests/canonical-actual-posting-safety.test.js',
  'tests/helpers/canonical-actual-eligibility-concurrency-worker.mjs',
  'docs/canonical-actual-posting-pr9a-audit.md',
  'docs/canonical-receivables-contract.md',
  'docs/canonical-receivables-decisions.md',
]);
const pr9bDesignBase = pr9aAuthorizedHead;
const pr9bDesignHead = 'fe26d1a6f40e93112da3c54bd843d854f40f37fe';
const pr9bDesignTree = 'c5452561e9268dfc12581f55c492f9a2616e733f';
const pr9bDesignRemediationAllowedFiles = new Set([
  'docs/canonical-actual-posting-pr9b-design.md',
  'docs/pr9b-implementation-authorization-gate.md',
  'tests/canonical-actual-posting-structural.test.js',
]);
const pr9bImplementationAllowedFiles = new Set([
  'server/lib/canonical-actual-posting-domain.js',
  'server/lib/canonical-actual-posting-repository.js',
  'server/lib/canonical-actual-posting-service.js',
  'server/lib/canonical-actual-eligibility-event-repository.js',
  'tests/canonical-actual-posting-fixtures.js',
  'tests/canonical-actual-posting-repository.test.js',
  'tests/canonical-actual-posting-concurrency.test.js',
  'tests/canonical-actual-posting-remediation.test.js',
  'tests/canonical-actual-posting-safety.test.js',
  'tests/canonical-actual-posting-structural.test.js',
  'tests/helpers/canonical-actual-posting-concurrency-worker.mjs',
]);
const implementationFiles = [
  'server/lib/canonical-actual-posting-schema.js',
  'server/lib/canonical-actual-posting-domain.js',
  'server/lib/canonical-actual-posting-authority-repository.js',
  'server/lib/canonical-actual-eligibility-event-repository.js',
  'server/lib/canonical-actual-eligibility-event-service.js',
  'server/lib/canonical-actual-posting-repository.js',
  'server/lib/canonical-actual-posting-service.js',
];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function gitLines(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

test('historical PR9a changed-file set remains inside the exact Gate B allow-list', () => {
  const changed = new Set(gitLines([
    'diff',
    '--name-only',
    pr9aAuthorizationBaseline,
    pr9aAuthorizedHead,
  ]));
  const outside = [...changed].filter(file => !pr9aAllowedFiles.has(file));
  assert.deepEqual(outside, []);
  assert.equal(pr9aAllowedFiles.has('docs/canonical-actual-posting-pr9b-design.md'), false);
  assert.equal(pr9aAllowedFiles.has('docs/pr9b-implementation-authorization-gate.md'), false);
});

test('authorized PR9b design identity and remediation remain exact', () => {
  const changed = new Set(gitLines(['diff', '--name-only', pr9bDesignBase, pr9bDesignHead]));
  assert.equal(gitLines(['rev-parse', `${pr9bDesignHead}^{tree}`])[0], pr9bDesignTree);
  const outside = [...changed].filter(file => !pr9bDesignRemediationAllowedFiles.has(file));
  assert.deepEqual(outside, []);
  assert.deepEqual([...changed].sort(), [...pr9bDesignRemediationAllowedFiles].sort());
});

test('current PR9b implementation remains inside the exact authorized 11-file scope', () => {
  const changed = new Set(gitLines(['diff', '--name-only', pr9bDesignHead]));
  for (const file of gitLines(['ls-files', '--others', '--exclude-standard'])) changed.add(file);
  const outside = [...changed].filter(file => !pr9bImplementationAllowedFiles.has(file));
  assert.deepEqual(outside, []);
  assert.deepEqual([...changed].sort(), [...pr9bImplementationAllowedFiles].sort());
  assert.deepEqual(
    [...changed].filter(file => file.startsWith('server/routes/') || file.startsWith('src/')),
    [],
  );
});

test('PR9 production modules contain no route, worker, scheduler, environment activation, network, or live-adapter wiring', () => {
  const combined = implementationFiles.map(read).join('\n');
  for (const forbidden of [
    /require\(['"]express['"]\)/,
    /\bRouter\s*\(/,
    /\bapp\.(?:get|post|put|patch|delete)\s*\(/,
    /\bsetInterval\s*\(/,
    /\bcron\b/i,
    /\bworker_threads\b/,
    /\bprocess\.env\b/,
    /\bfetch\s*\(/,
    /\baxios\b/,
    /\bhttps?\.request\b/,
    /\brailway\b/i,
  ]) assert.doesNotMatch(combined, forbidden);
});

test('Algorithm B owns only the primary triplet and delegates only through the bounded C seam', () => {
  const posting = read('server/lib/canonical-actual-posting-repository.js');
  const eligibility = read('server/lib/canonical-actual-eligibility-event-repository.js');
  assert.match(posting, /insertExact\(db, CANONICAL_RECEIVABLES_TABLE, receivable\)/);
  assert.match(posting, /insertExact\(\s*db,\s*CANONICAL_RECEIVABLE_POSTING_OPERATIONS_TABLE,/);
  assert.match(posting, /insertExact\(db, FINANCIAL_AUDIT_EVENTS_TABLE, audit\)/);
  assert.doesNotMatch(posting, /persistDenialEvidence\s*\(/);
  assert.match(posting, /eligibilityRepository\.orchestratePostingDenial\(\{/);
  assert.doesNotMatch(posting, /insertExact\(\s*db,\s*CANONICAL_RECEIVABLE_POSTING_CONFLICTS_TABLE,/);
  assert.doesNotMatch(posting, /UPDATE\s+canonical_receivable_posting_conflict_transitions/i);
  assert.match(eligibility, /function persistDenialPairInTransaction\(/);
  assert.match(eligibility, /function orchestratePostingDenial\(commandInput\)/);
  assert.doesNotMatch(eligibility, /module\.exports\s*=\s*\{[^}]*persistDenialPairInTransaction/s);
  assert.match(posting, /rollbackQuietly\(db\);[\s\S]*eligibilityRepository\.orchestratePostingDenial/);
});

test('PR9B remediation preserves storage, authoritative verification, and C7 lock ordering', () => {
  const posting = read('server/lib/canonical-actual-posting-repository.js');
  const eligibility = read('server/lib/canonical-actual-eligibility-event-repository.js');
  assert.match(posting, /BEGIN IMMEDIATE[\s\S]*assertPostingStoragePreflight\(command, 'algorithm_b_initial'\)[\s\S]*const clock = readClock\(\)/);
  assert.match(posting, /beforeFinalStoragePreflight[\s\S]*assertPostingStoragePreflight\(command, 'algorithm_b_final_pre_dml'\)[\s\S]*createPrimaryTriplet/);
  assert.match(posting, /verifyPostingAdmission\(command, event, clock\)/);
  assert.match(posting, /verifyCanonicalPrimaryTriplet\(\{/);
  assert.match(eligibility, /verifyCanonicalPrimaryTriplet\(\{/);
  assert.match(eligibility, /mode: 'BLOCKED_SCOPE',[\s\S]*pair,[\s\S]*scope:/);
  assert.match(eligibility, /const pair = disposition\.pair;[\s\S]*rollbackQuietly\(db\);[\s\S]*postingPairEvidence\(pair\)/);
  assert.doesNotMatch(
    eligibility,
    /disposition\.mode === 'BLOCKED_SCOPE'[\s\S]{0,500}rollbackQuietly\(db\);[\s\S]{0,500}incompleteTransitions\(/,
  );
});

test('P2-03 anti-join is called in Phase 1 and immediately before precommit proof', () => {
  const posting = read('server/lib/canonical-actual-posting-repository.js');
  const calls = posting.match(/assertNoPrimaryOrphans\(command, event\);/g) || [];
  assert.equal(calls.length >= 3, true);
  assert.match(posting, /const event = loadEvent\(command\);\s*assertNoPrimaryOrphans\(command, event\);\s*const durable = resolveExistingResult/);
  assert.match(posting, /verifyPrimaryTriplet\([\s\S]*assertNoPrimaryOrphans\(command, event\);[\s\S]*foreign_key_check/);
  assert.match(posting, /orphanCanonical/);
  assert.match(posting, /orphanOperation/);
  assert.match(posting, /orphanAudit/);
});

test('P2-01 instrumentation records in-flight reads without post-hoc fixture SQL', () => {
  const posting = read('server/lib/canonical-actual-posting-repository.js');
  const eligibility = read('server/lib/canonical-actual-eligibility-event-repository.js');
  const fixtures = read('tests/canonical-actual-posting-fixtures.js');
  assert.match(posting, /evidenceRecorder/);
  assert.match(eligibility, /phase: 'pr8_authoritative_read'/);
  assert.match(eligibility, /phase: 'posting_authoritative_admission'/);
  assert.match(eligibility, /phase: 'conflict_graph'/);
  const evidenceHelper = fixtures.slice(
    fixtures.indexOf('export function postingEvidenceReadSet'),
    fixtures.indexOf('export function normalizedPostingCommandEvidence'),
  );
  assert.doesNotMatch(evidenceHelper, /SELECT|prepare\s*\(/);
  assert.match(evidenceHelper, /trace\.snapshot\(\)/);
  const postingRecorder = posting.slice(
    posting.indexOf('  function recordEvidence'),
    posting.indexOf('  function invokeHook'),
  );
  assert.doesNotMatch(postingRecorder, /\b(?:INSERT|UPDATE|DELETE)\b|db\.prepare|db\.exec/);
});

test('P2-04 clock and UUID dependencies are constructor-owned and absent from caller commands', () => {
  const posting = read('server/lib/canonical-actual-posting-repository.js');
  const domain = read('server/lib/canonical-actual-posting-domain.js');
  assert.match(posting, /dependencies = undefined/);
  assert.match(posting, /dependencies\?\.clock \|\| Date\.now\.bind\(Date\)/);
  assert.match(posting, /dependencies\?\.uuid \|\| \(\(\) => randomUUID/);
  assert.match(posting, /generateAndAssertUnusedPrimaryIds\(\)/);
  assert.match(posting, /new Set\(Object\.values\(generatedIds\)\)\.size !== 3/);
  assert.doesNotMatch(domain, /CANONICAL_POSTING_COMMAND_KEYS[\s\S]{0,600}\bclock\b/);
  assert.doesNotMatch(domain, /CANONICAL_POSTING_COMMAND_KEYS[\s\S]{0,600}\buuid\b/i);
});

test('denial package brand and constructors are not exported to callers', async () => {
  const eligibilitySource = read('server/lib/canonical-actual-eligibility-event-repository.js');
  const domain = await import('../server/lib/canonical-actual-posting-domain.js');
  const eligibility = await import('../server/lib/canonical-actual-eligibility-event-repository.js');
  const exported = domain.default || domain;
  assert.equal(exported.freezeDenialPackageForRepository, undefined);
  assert.equal(exported.assertFrozenDenialPackage, undefined);
  assert.equal(eligibility.__testBuildPostingDenialPackage, undefined);
  assert.doesNotMatch(eligibilitySource, /testOnlyBuildPostingDenialPackage|__testBuildPostingDenialPackage/);
  assert.doesNotMatch(eligibilitySource, /publicRepository\.[A-Za-z0-9_]*Build[A-Za-z0-9_]*/);
});

test('PR9B PR8 check identity is sealed into accepted evidence and locked reconstruction', () => {
  const domain = read('server/lib/canonical-actual-posting-domain.js');
  const eligibility = read('server/lib/canonical-actual-eligibility-event-repository.js');
  assert.match(domain, /ACCEPTED_PR8_CHECK_IDENTITY_SEAL_FIELD = 'checkIdentitySetHash'/);
  assert.match(eligibility, /function pr8CheckIdentityCanonical\(/);
  assert.match(eligibility, /childId: row\.id/);
  assert.match(eligibility, /parentRunId: row\.runId/);
  assert.match(eligibility, /parentCandidateId: row\.candidateId/);
  assert.match(eligibility, /checkHash: row\.checkHash/);
  assert.match(eligibility, /sourceEvidenceRefs/);
  assert.match(eligibility, /acceptedResultHash: run\.resultHash/);
  assert.match(eligibility, /acceptedRun\?\.checkIdentitySetHash === reconstructedCheckIdentitySetHash/);
  assert.match(eligibility, /requirePostingCheckIdentitySeal: true/);
});

test('PR9B replay qualifier is computed before COMMIT and concurrency proof is event-driven', () => {
  const posting = read('server/lib/canonical-actual-posting-repository.js');
  const concurrency = read('tests/canonical-actual-posting-concurrency.test.js');
  const worker = read('tests/helpers/canonical-actual-posting-concurrency-worker.mjs');
  assert.match(posting, /const result = event \? qualifyHistoricalResult[\s\S]{0,200}db\.exec\('COMMIT'\);[\s\S]{0,80}return result/);
  assert.doesNotMatch(posting, /db\.exec\('COMMIT'\);\s*return qualifyHistoricalResult/);
  assert.doesNotMatch(concurrency, /Promise\.race|assertStillBlocked|setTimeout\(.*100/);
  assert.doesNotMatch(worker, /type:\s*['"]attempting['"]/);
  for (const event of [
    'repository_entrypoint_invoked',
    'begin_immediate_attempted',
    'lock_acquired',
    'protected_stage_reached',
    'release_completed',
  ]) assert.match(worker, new RegExp(event));
});

test('runtime application graph does not import PR9a or PR9b repositories or services', () => {
  const runtimeFiles = [
    'server/server.js',
    ...fs.readdirSync(path.join(root, 'server/routes')).map(name => `server/routes/${name}`),
  ].filter(file => fs.statSync(path.join(root, file)).isFile());
  const runtime = runtimeFiles.map(read).join('\n');
  assert.doesNotMatch(runtime, /canonical-actual-(?:eligibility-event|posting-authority|posting)-repository/);
  assert.doesNotMatch(runtime, /canonical-actual-(?:eligibility-event|posting)-service/);
  const dbSource = read('server/db.js');
  assert.match(dbSource, /ensureCanonicalActualPostingSchema\(db\)/);
  assert.doesNotMatch(dbSource, /createCanonicalActualEligibilityEvent/);
});

test('serialization and ordering implementation avoids locale and subtraction comparators', () => {
  const domain = read('server/lib/canonical-actual-posting-domain.js');
  assert.doesNotMatch(domain, /localeCompare\s*\(/);
  assert.doesNotMatch(domain, /\.sort\s*\(\s*\([^)]*\)\s*=>\s*[^\n;]*-[^\n;]*\)/);
  assert.match(domain, /if \(left < right\) return -1;/);
  assert.match(domain, /if \(left > right\) return 1;/);
  assert.match(domain, /if \(left === right\) return 0;/);
  assert.match(domain, /createHash\(['"]sha256['"]\)/);
});

test('implementation has no placeholders or embedded secret material', () => {
  const combined = implementationFiles.map(read).join('\n');
  assert.doesNotMatch(combined, /\b(?:TODO|FIXME|HACK|XXX)\b/);
  assert.doesNotMatch(combined, /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/);
  assert.doesNotMatch(combined, /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}/);
  assert.doesNotMatch(combined, /\bgh[pousr]_[A-Za-z0-9]{20,}/);
});
