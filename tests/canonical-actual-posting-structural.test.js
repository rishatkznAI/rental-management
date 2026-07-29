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

test('denial package brand and constructors are not exported to callers', async () => {
  const domain = await import('../server/lib/canonical-actual-posting-domain.js');
  const exported = domain.default || domain;
  assert.equal(exported.freezeDenialPackageForRepository, undefined);
  assert.equal(exported.assertFrozenDenialPackage, undefined);
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
