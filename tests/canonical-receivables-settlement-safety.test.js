import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function javascriptFiles(relativeDirectory) {
  const directory = path.join(root, relativeDirectory);
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(relativePath);
    return entry.isFile() && /\.(?:cjs|js|mjs|ts|tsx)$/.test(entry.name) ? [relativePath] : [];
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

function reachableCommonJsModules(entryFiles) {
  const pending = [...entryFiles];
  const reachable = new Set();
  while (pending.length > 0) {
    const current = pending.pop();
    if (!current || reachable.has(current)) continue;
    reachable.add(current);
    const source = fs.readFileSync(current, 'utf8');
    for (const match of source.matchAll(/\brequire\(\s*['"]([^'"]+)['"]\s*\)/g)) {
      const resolved = resolveLocalCommonJsModule(current, match[1]);
      if (resolved) pending.push(resolved);
    }
  }
  return reachable;
}

test('PR2 repository/domain have no production route, worker, script, frontend, or Company Health import', () => {
  const productionFiles = [
    'server/server.js',
    ...javascriptFiles('server/routes'),
    ...javascriptFiles('server/scripts'),
    ...javascriptFiles('server/lib').filter(file => /startup|company-health|finance-core|receivables-core/.test(file)),
    ...javascriptFiles('src'),
  ];
  const source = productionFiles.map(file => read(file)).join('\n');
  assert.doesNotMatch(source, /canonical-receivables-settlement-repository/);
  assert.doesNotMatch(source, /canonical-receivables-settlement-domain/);
  assert.doesNotMatch(source, /canonical_payment_allocations|canonical_receivable_adjustments|canonical_payments/);
});

test('only the PR2 schema initializer is reachable from backend startup', () => {
  const entryFiles = [
    path.join(root, 'server/server.js'),
    ...javascriptFiles('server/scripts').map(file => path.join(root, file)),
  ];
  const reachable = reachableCommonJsModules(entryFiles);
  const schema = path.join(root, 'server/lib/canonical-receivables-settlement-schema.js');
  const domain = path.join(root, 'server/lib/canonical-receivables-settlement-domain.js');
  const repository = path.join(root, 'server/lib/canonical-receivables-settlement-repository.js');
  assert.equal(reachable.has(schema), true);
  assert.equal(reachable.has(domain), false);
  assert.equal(reachable.has(repository), false);
});

test('PR2 schema and repository do not read or write legacy payment/rental collections', () => {
  const schema = read('server/lib/canonical-receivables-settlement-schema.js');
  const repository = read('server/lib/canonical-receivables-settlement-repository.js');
  assert.doesNotMatch(schema, /app_data|gantt_rentals|legacy_backfill|dual.?write/i);
  assert.doesNotMatch(repository, /app_data|gantt_rentals|legacy_backfill|dual.?write/i);
  assert.doesNotMatch(schema, /INSERT\s+INTO\s+canonical_(?:payments|payment_allocations|receivable_adjustments|approval_requests)/i);
});

test('normal application database initialization creates empty PR2 tables without legacy data mutation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-pr2-startup-safety-'));
  const dbPath = path.join(dir, 'app.sqlite');
  try {
    const initial = new Database(dbPath);
    initial.exec(`
      CREATE TABLE app_data (
        name TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO app_data (name, json) VALUES
        ('payments', '[{"id":"legacy-payment","amount":100}]'),
        ('payment_allocations', '[{"id":"legacy-allocation","paymentId":"legacy-payment"}]');
    `);
    const before = initial.prepare('SELECT * FROM app_data ORDER BY name').all();
    initial.close();

    const result = spawnSync(process.execPath, ['-e', "require('./server/db.js').ensureDb()"], {
      cwd: root,
      env: { ...process.env, DB_PATH: dbPath },
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);

    const verified = new Database(dbPath, { readonly: true });
    try {
      for (const table of [
        'canonical_payments',
        'canonical_payment_allocations',
        'canonical_receivable_adjustments',
        'canonical_approval_requests',
      ]) {
        assert.equal(verified.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
      }
      assert.deepEqual(verified.prepare('SELECT * FROM app_data ORDER BY name').all(), before);
      assert.equal(verified.prepare(`
        SELECT COUNT(*) AS count FROM sql_shadow_schema_migrations
        WHERE name = 'canonical_receivables_pr2_settlement' AND version = 1
      `).get().count, 1);
      assert.deepEqual(verified.pragma('foreign_key_check'), []);
    } finally {
      verified.close();
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('no production API or background operation names expose PR2 settlement writes', () => {
  const routes = javascriptFiles('server/routes').map(file => read(file)).join('\n');
  const startup = read('server/lib/startup.js');
  assert.doesNotMatch(routes, /createCanonicalPayment|requestAllocation|approveAllocation|requestAdjustment|requestRefund|requestWriteOff/);
  assert.doesNotMatch(startup, /canonical_receivables_pr2_settlement|canonical_payment_allocations|canonical_receivable_adjustments/);
});
