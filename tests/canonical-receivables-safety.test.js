import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function javascriptFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(relativePath);
    return entry.isFile() && /\.(?:cjs|js|mjs)$/.test(entry.name) ? [relativePath] : [];
  });
}

function resolveLocalCommonJsModule(fromFile, specifier) {
  if (!specifier.startsWith('.')) return null;
  const base = path.resolve(path.dirname(fromFile), specifier);
  for (const candidate of [base, `${base}.js`, `${base}.cjs`, path.join(base, 'index.js')]) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return null;
}

function staticCommonJsDependencies(file) {
  const source = fs.readFileSync(file, 'utf8');
  const dependencies = [];
  const requirePattern = /\brequire\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (const match of source.matchAll(requirePattern)) {
    const resolved = resolveLocalCommonJsModule(file, match[1]);
    if (resolved) dependencies.push(resolved);
  }
  return dependencies;
}

function reachableCommonJsModules(entryFiles) {
  const pending = [...entryFiles];
  const reachable = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    pending.push(...staticCommonJsDependencies(current));
  }
  return reachable;
}

test('production runtime routes do not import the canonical repository/domain or expose a receivable write route', () => {
  const runtimeFiles = ['server/server.js', ...javascriptFiles('server/routes')];
  const runtimeSource = runtimeFiles.map(file => read(file)).join('\n');
  assert.doesNotMatch(runtimeSource, /canonical-receivables-repository/);
  assert.doesNotMatch(runtimeSource, /canonical-receivable-domain/);
  assert.doesNotMatch(
    runtimeSource,
    /\.(?:post|put|patch|delete)\(\s*['"]\/receivables(?:\/|['"])/,
  );
});

test('PR1 schema registration has no receivable posting, legacy backfill, or dual-write statement', () => {
  const schemaSource = read('server/lib/canonical-receivables-schema.js');
  const repositorySource = read('server/lib/canonical-receivables-repository.js');
  const dbSource = read('server/db.js');
  assert.doesNotMatch(schemaSource, /INSERT\s+INTO\s+canonical_receivables/i);
  assert.doesNotMatch(schemaSource, /app_data|gantt_rentals|payments/i);
  assert.doesNotMatch(repositorySource, /INSERT\s+INTO\s+canonical_receivables/i);
  assert.doesNotMatch(repositorySource, /createReceivable|postReceivable/);
  assert.match(dbSource, /ensureCanonicalReceivablesSchema\(db\)/);
  assert.doesNotMatch(dbSource, /backfillCanonicalReceivables|dualWriteReceivable/);
});

test('Company Health, Dashboard, Finance, and Risks production reads do not reference the canonical table or repository', () => {
  const readPathFiles = [
    'src/app/lib/companyHealthDebtAging.js',
    'src/app/lib/dashboardCompanyHealth.js',
    'src/app/pages/Dashboard.tsx',
    'server/lib/finance-core.js',
    'server/routes/finance.js',
  ];
  const readPathSource = readPathFiles.map(file => read(file)).join('\n');
  assert.doesNotMatch(readPathSource, /canonical_receivables/);
  assert.doesNotMatch(readPathSource, /canonical-receivables-repository/);
});

test('canonical repository/domain remain unreachable from production backend modules', () => {
  const serverFiles = javascriptFiles('server').filter(file => ![
    'server/lib/canonical-receivable-domain.js',
    'server/lib/canonical-receivables-repository.js',
  ].includes(file));
  const importSource = serverFiles.map(file => read(file)).join('\n');
  assert.doesNotMatch(importSource, /canonical-receivables-repository/);
  assert.doesNotMatch(importSource, /canonical-receivable-domain/);
});

test('production entrypoint and executable-script import graph cannot reach canonical domain or repository', () => {
  const entryFiles = [
    path.join(root, 'server/server.js'),
    ...javascriptFiles('server/scripts').map(file => path.join(root, file)),
  ];
  const reachable = reachableCommonJsModules(entryFiles);
  const schema = path.join(root, 'server/lib/canonical-receivables-schema.js');
  const domain = path.join(root, 'server/lib/canonical-receivable-domain.js');
  const repository = path.join(root, 'server/lib/canonical-receivables-repository.js');

  assert.ok(reachable.has(schema), 'import graph should reach the schema initializer through server/db.js');
  assert.equal(reachable.has(domain), false);
  assert.equal(reachable.has(repository), false);
});
