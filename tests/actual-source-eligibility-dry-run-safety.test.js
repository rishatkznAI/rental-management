import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  createActualSourceDryRunContext,
  dryRunCommand,
  seedPositiveSource,
} from './actual-source-eligibility-dry-run-fixtures.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES,
} = require('../server/lib/actual-source-eligibility-dry-run-schema.js');
const {
  isCanonicalReceivablesReadApiEnabled,
  isForecastReceivablesReadApiEnabled,
} = require('../server/lib/feature-flags.js');
const {
  resolveCanonicalReceivablesTrustedScope,
} = require('../server/lib/canonical-receivables-scope-adapter.js');
const {
  resolveForecastReceivablesTrustedScope,
} = require('../server/lib/forecast-receivables-scope-adapter.js');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function directRequireGraph(entry) {
  const visited = new Set();
  function visit(relativePath) {
    const normalized = relativePath.replace(/\\/g, '/');
    if (visited.has(normalized) || !fs.existsSync(path.join(root, normalized))) return;
    visited.add(normalized);
    const source = read(normalized);
    const directory = path.posix.dirname(normalized);
    for (const match of source.matchAll(/require\(['"](\.\.?\/[^'"]+)['"]\)/g)) {
      let resolved = path.posix.normalize(path.posix.join(directory, match[1]));
      if (!path.posix.extname(resolved)) resolved += '.js';
      visit(resolved);
    }
  }
  visit(entry);
  return visited;
}

function pr8Counts(db) {
  return Object.fromEntries(ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES.map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

test('production startup reaches only PR8 schema initialization and no execution/read/policy module', () => {
  const graph = directRequireGraph('server/server.js');
  assert.equal(graph.has('server/lib/actual-source-eligibility-dry-run-schema.js'), true);
  for (const unreachable of [
    'server/lib/actual-source-eligibility-dry-run-domain.js',
    'server/lib/actual-source-eligibility-dry-run-policy.js',
    'server/lib/actual-source-eligibility-dry-run-service.js',
    'server/lib/actual-source-eligibility-dry-run-repository.js',
    'server/lib/actual-source-eligibility-dry-run-read-repository.js',
  ]) assert.equal(graph.has(unreachable), false, unreachable);
  const dbSource = read('server/db.js');
  assert.match(dbSource, /ensureForecastReceivablesPlanningSchema\(db\);\s*ensureActualSourceEligibilityDryRunSchema\(db\);/);
  assert.doesNotMatch(dbSource, /actual-source-eligibility-dry-run-(?:service|repository|policy|domain|read-repository)/);
});

test('PR8 adds no HTTP route, feature toggle, resolver, worker, scheduler, queue, timer, CLI, or source adapter', () => {
  const changed = execFileSync('git', ['diff', '--name-only', 'origin/main'], { cwd: root, encoding: 'utf8' })
    .trim().split('\n').filter(Boolean);
  const productionChanged = changed.filter(file => file.startsWith('server/') || file.startsWith('src/'));
  assert.equal(changed.some(file => file.startsWith('server/routes/')), false);
  assert.equal(changed.includes('server/server.js'), false);
  assert.equal(changed.includes('server/.env.example'), false);
  assert.equal(changed.includes('server/lib/feature-flags.js'), false);
  assert.equal(changed.some(file => file.startsWith('src/')), false);
  assert.equal(productionChanged.some(file => /worker|scheduler|queue|cli|adapter/i.test(file)), false);
  const source = productionChanged.filter(file => file.endsWith('.js') && fs.existsSync(path.join(root, file)))
    .map(read).join('\n');
  assert.doesNotMatch(source, /setInterval|setTimeout|node:worker_threads|commander|yargs/);
});

test('PR8 never writes canonical, PR6 source, PR7 forecast, settlement, or legacy app_data authority', () => {
  const files = [
    'server/lib/actual-source-eligibility-dry-run-schema.js',
    'server/lib/actual-source-eligibility-dry-run-domain.js',
    'server/lib/actual-source-eligibility-dry-run-policy.js',
    'server/lib/actual-source-eligibility-dry-run-service.js',
    'server/lib/actual-source-eligibility-dry-run-repository.js',
    'server/lib/actual-source-eligibility-dry-run-read-repository.js',
  ];
  const source = files.map(read).join('\n');
  const repository = read('server/lib/actual-source-eligibility-dry-run-repository.js');
  const readRepository = read('server/lib/actual-source-eligibility-dry-run-read-repository.js');
  const withoutOwnedUsersReader = source.replaceAll("SELECT json FROM app_data WHERE name = 'users'", '');
  assert.equal(repository.match(/SELECT json FROM app_data WHERE name = 'users'/g)?.length, 1);
  assert.equal(readRepository.match(/SELECT json FROM app_data WHERE name = 'users'/g)?.length, 1);
  assert.doesNotMatch(withoutOwnedUsersReader, /app_data|gantt_rentals|rentalBillingSnapshot|expectedPaymentDate|manager forecast/i);
  assert.doesNotMatch(source, /(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(?:canonical_|financial_audit_events|billing_source_|forecast_receivable_)/i);
  assert.doesNotMatch(source, /canonical-receivables-repository|canonical-receivables-settlement-repository|forecast-receivables-planning-repository/);
  assert.doesNotMatch(source, /ActualReceivableEligibleV1|posting queue|canonical posting|dual.?write|backfill/i);
  assert.doesNotMatch(source, /Math\.round|parseFloat|tolerance/i);
});

test('canonical and forecast production resolvers and default-disabled flags remain unchanged', () => {
  assert.equal(resolveCanonicalReceivablesTrustedScope(), null);
  assert.equal(resolveForecastReceivablesTrustedScope(), null);
  assert.equal(isCanonicalReceivablesReadApiEnabled({}), false);
  assert.equal(isForecastReceivablesReadApiEnabled({}), false);
  assert.match(read('server/lib/canonical-receivables-scope-adapter.js'), /return null/);
  assert.match(read('server/lib/forecast-receivables-scope-adapter.js'), /return null/);
});

test('Finance, Dashboard, Company Health/Risks, frontend and package manifests remain unchanged', () => {
  const changed = execFileSync('git', [
    'diff', '--name-only', 'origin/main', '--',
    'src',
    'server/routes/finance.js',
    'server/lib/finance-core.js',
    'server/server.js',
    'package.json',
    'package-lock.json',
    'server/package.json',
    'server/package-lock.json',
  ], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(changed, '');
});

test('pre-transaction accessor rejection executes no getter and creates no PR8 rows', () => {
  const context = createActualSourceDryRunContext();
  try {
    seedPositiveSource(context);
    const before = pr8Counts(context.db);
    let getterCalls = 0;
    const command = dryRunCommand();
    Object.defineProperty(command, 'unexpected', {
      enumerable: true,
      get() {
        getterCalls += 1;
        return 'unsafe';
      },
    });
    assert.throws(
      () => context.dryRunService.evaluateActualSourceDryRun(context.dryRunContext, command),
      error => error.code === 'ACTUAL_SOURCE_INPUT_NOT_INERT',
    );
    assert.equal(getterCalls, 0);
    assert.deepEqual(pr8Counts(context.db), before);
    assert.equal(context.db.inTransaction, false);
  } finally {
    context.close();
  }
});

test('SQLite faults at every PR8 insert stage roll back all dry-run evidence', async t => {
  for (const table of ACTUAL_SOURCE_ELIGIBILITY_DRY_RUN_TABLES) {
    await t.test(table, () => {
      const context = createActualSourceDryRunContext();
      try {
        seedPositiveSource(context);
        const before = pr8Counts(context.db);
        context.db.exec(`
          CREATE TEMP TRIGGER fail_pr8_${table}
          BEFORE INSERT ON ${table}
          BEGIN
            SELECT RAISE(ABORT, 'forced ${table} failure');
          END;
        `);
        assert.throws(
          () => context.dryRunService.evaluateActualSourceDryRun(
            context.dryRunContext,
            dryRunCommand({ policyManifest: null, idempotencyKey: `fault-${table}` }),
          ),
          new RegExp(`forced ${table} failure`),
        );
        assert.deepEqual(pr8Counts(context.db), before);
        assert.equal(context.db.inTransaction, false);
        assert.deepEqual(context.db.pragma('foreign_key_check'), []);
      } finally {
        context.close();
      }
    });
  }
});
