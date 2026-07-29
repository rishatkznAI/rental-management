import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import test from 'node:test';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const authorizationBaseline = 'da3bd21935abfbd42c95ef8be9eac1eecb56e95c';
const allowedFiles = new Set([
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
const implementationFiles = [
  'server/lib/canonical-actual-posting-schema.js',
  'server/lib/canonical-actual-posting-domain.js',
  'server/lib/canonical-actual-posting-authority-repository.js',
  'server/lib/canonical-actual-eligibility-event-repository.js',
  'server/lib/canonical-actual-eligibility-event-service.js',
];

function read(relative) {
  return fs.readFileSync(path.join(root, relative), 'utf8');
}

function gitLines(args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim().split('\n').filter(Boolean);
}

test('changed-file set remains inside the exact Gate B allow-list', () => {
  const changed = new Set(gitLines(['diff', '--name-only', authorizationBaseline]));
  for (const file of gitLines(['ls-files', '--others', '--exclude-standard'])) changed.add(file);
  const outside = [...changed].filter(file => !allowedFiles.has(file));
  assert.deepEqual(outside, []);
});

test('PR9a production modules contain no route, worker, scheduler, environment activation, network, or live-adapter wiring', () => {
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

test('PR9a contains no Algorithm B module or canonical business DML', () => {
  const combined = implementationFiles.map(read).join('\n');
  assert.doesNotMatch(combined, /algorithm[ _-]?b/i);
  assert.doesNotMatch(combined, /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+canonical_receivables\b/i);
  assert.doesNotMatch(combined, /\bUPDATE\s+canonical_receivables\b/i);
  assert.doesNotMatch(combined, /\bDELETE\s+FROM\s+canonical_receivables\b/i);
  assert.doesNotMatch(combined, /\bINSERT\s+(?:OR\s+\w+\s+)?INTO\s+canonical_receivable_posting_operations\b/i);
  assert.equal(fs.existsSync(path.join(root, 'server/lib/canonical-actual-posting-repository.js')), false);
  assert.equal(fs.existsSync(path.join(root, 'server/lib/canonical-actual-posting-service.js')), false);
});

test('denial package brand and constructors are not exported to callers', async () => {
  const domain = await import('../server/lib/canonical-actual-posting-domain.js');
  const exported = domain.default || domain;
  assert.equal(exported.freezeDenialPackageForRepository, undefined);
  assert.equal(exported.assertFrozenDenialPackage, undefined);
});

test('runtime application graph does not import PR9a repositories or service', () => {
  const runtimeFiles = [
    'server/server.js',
    ...fs.readdirSync(path.join(root, 'server/routes')).map(name => `server/routes/${name}`),
  ].filter(file => fs.statSync(path.join(root, file)).isFile());
  const runtime = runtimeFiles.map(read).join('\n');
  assert.doesNotMatch(runtime, /canonical-actual-(?:eligibility-event|posting-authority)-repository/);
  assert.doesNotMatch(runtime, /canonical-actual-eligibility-event-service/);
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
