import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  createForecastTestContext,
  forecastCommand,
} from './forecast-receivables-planning-fixtures.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  FORECAST_RECEIVABLES_PLANNING_TABLES,
} = require('../server/lib/forecast-receivables-planning-schema.js');
const {
  isForecastReceivablesReadApiEnabled,
} = require('../server/lib/feature-flags.js');
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

function forecastCounts(db) {
  return Object.fromEntries(FORECAST_RECEIVABLES_PLANNING_TABLES.map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

test('forecast read feature flag defaults disabled and production resolver is unconditional null', () => {
  assert.equal(isForecastReceivablesReadApiEnabled({}), false);
  assert.equal(isForecastReceivablesReadApiEnabled({ FORECAST_RECEIVABLES_READ_API_ENABLED: 'false' }), false);
  assert.equal(isForecastReceivablesReadApiEnabled({ FORECAST_RECEIVABLES_READ_API_ENABLED: 'true' }), true);
  assert.equal(resolveForecastReceivablesTrustedScope(), null);
  const adapter = read('server/lib/forecast-receivables-scope-adapter.js');
  assert.match(adapter, /function resolveForecastReceivablesTrustedScope\(\) \{\s*return null;\s*\}/);
  assert.doesNotMatch(adapter, /platform-authorization|platform-identity-repository/);
});

test('production dependency graph reaches schema/read/null adapter but not calculation mutation or policy', () => {
  const graph = directRequireGraph('server/server.js');
  for (const reachable of [
    'server/lib/forecast-receivables-planning-schema.js',
    'server/routes/forecast-receivables-read.js',
    'server/lib/forecast-receivables-planning-read-repository.js',
    'server/lib/forecast-receivables-planning-read-service.js',
    'server/lib/forecast-receivables-scope-adapter.js',
  ]) assert.equal(graph.has(reachable), true, reachable);
  for (const unreachable of [
    'server/lib/forecast-receivables-planning-repository.js',
    'server/lib/forecast-receivables-planning-service.js',
    'server/lib/forecast-receivables-planning-policy.js',
    'server/lib/forecast-receivables-planning-domain.js',
  ]) assert.equal(graph.has(unreachable), false, unreachable);
  const dbSource = read('server/db.js');
  assert.match(dbSource, /ensureForecastReceivablesPlanningSchema\(db\)/);
  assert.doesNotMatch(dbSource, /forecast-receivables-planning-(?:repository|service|policy)/);
});

test('PR7 has no canonical/source/legacy write, fallback, settlement, or runtime trigger dependency', () => {
  const files = [
    'server/lib/forecast-receivables-planning-schema.js',
    'server/lib/forecast-receivables-planning-domain.js',
    'server/lib/forecast-receivables-planning-policy.js',
    'server/lib/forecast-receivables-planning-repository.js',
    'server/lib/forecast-receivables-planning-service.js',
    'server/lib/forecast-receivables-planning-read-repository.js',
    'server/lib/forecast-receivables-planning-read-service.js',
    'server/lib/forecast-receivables-scope-adapter.js',
    'server/routes/forecast-receivables-read.js',
  ];
  const source = files.map(read).join('\n');
  const repository = read('server/lib/forecast-receivables-planning-repository.js');
  const sourceWithoutOwnedUserDirectory = source.replace(
    "SELECT json FROM app_data WHERE name = 'users'",
    '',
  );
  assert.doesNotMatch(source, /(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+(?:canonical_receivables|canonical_payments|canonical_payment_allocations|canonical_receivable_adjustments|canonical_approval_requests|financial_audit_events)/i);
  assert.doesNotMatch(source, /(?:INSERT\s+(?:OR\s+\w+\s+)?INTO|UPDATE|DELETE\s+FROM)\s+billing_source_/i);
  assert.equal(repository.match(/SELECT json FROM app_data WHERE name = 'users'/g)?.length, 1);
  assert.doesNotMatch(sourceWithoutOwnedUserDirectory, /app_data|gantt_rentals|equipment_downtimes|rentalBillingSnapshot|billingSnapshot/);
  assert.doesNotMatch(source, /finance-core|receivables-core|canonical-receivables-settlement-repository/);
  assert.doesNotMatch(source, /buildRentalDebtRows|getRentalDebtOverdueDays|calculateRentalBilling|getRentalBillingAmount/);
  assert.doesNotMatch(source, /Math\.round|parseFloat|setInterval|setTimeout|scheduler|watcher|queue consumer/i);
  assert.doesNotMatch(source, /backfill|dual.?write|historical import|production input adapter/i);
});

test('forecast HTTP namespace is GET-only and static routes precede dynamic detail', () => {
  const route = read('server/routes/forecast-receivables-read.js');
  assert.doesNotMatch(route, /router\.(?:post|put|patch|delete)\(\s*['"]\/forecast-receivables/);
  const summary = route.indexOf("router.get('/forecast-receivables/summary'");
  const items = route.indexOf("router.get('/forecast-receivables/items'");
  const diagnostics = route.indexOf("router.get('/forecast-receivables/diagnostics'");
  const runs = route.indexOf("router.get('/forecast-receivables/runs'");
  const detail = route.indexOf("router.get('/forecast-receivables/runs/:id'");
  assert.ok(summary > 0 && items > summary && diagnostics > items && runs > diagnostics && detail > runs);
});

test('read path imports only PR7 forecast tables and never mutation repository', () => {
  const source = [
    'server/routes/forecast-receivables-read.js',
    'server/lib/forecast-receivables-planning-read-repository.js',
    'server/lib/forecast-receivables-planning-read-service.js',
  ].map(read).join('\n');
  assert.doesNotMatch(source, /forecast-receivables-planning-repository['"]/);
  assert.doesNotMatch(source, /forecast-receivables-planning-service['"]/);
  assert.doesNotMatch(source, /billing_source_|canonical_receivables|canonical_payments|app_data/);
  assert.doesNotMatch(source, /actualOutstandingMinor|closedUnbilledCandidateMinor|totalExpectedClientLoadMinor/);
});

test('forecast models contain no actual, aging, overdue, collection, settlement, or due-date lifecycle fields', () => {
  const source = [
    'server/lib/forecast-receivables-planning-schema.js',
    'server/lib/forecast-receivables-planning-domain.js',
    'server/lib/forecast-receivables-planning-repository.js',
    'server/lib/forecast-receivables-planning-read-repository.js',
  ].map(read).join('\n');
  for (const forbidden of [
    'canonicalReceivableId', 'convertedToActual', 'actualized', 'agingBucket',
    'collectionStatus', 'settlementStatus', 'contractualDueDate',
    'canonicalWorkflowStatus', 'totalExpectedClientLoadMinor',
  ]) assert.equal(source.includes(forbidden), false, forbidden);
});

test('Finance, Dashboard, Company Health/Risks, frontend, startup workers, and package manifests remain unchanged', () => {
  const changed = execFileSync('git', [
    'diff', '--name-only', 'origin/main', '--',
    'src',
    'server/routes/finance.js',
    'server/lib/finance-core.js',
    'server/lib/startup.js',
    'package.json',
    'package-lock.json',
    'server/package.json',
  ], { cwd: root, encoding: 'utf8' }).trim();
  assert.equal(changed, '');
});

test('pre-transaction getter rejection executes no getter and creates no forecast rows', () => {
  const context = createForecastTestContext();
  const before = forecastCounts(context.db);
  let getterCalls = 0;
  const command = forecastCommand(context);
  Object.defineProperty(command.inputs[0], 'unexpected', {
    enumerable: true,
    get() {
      getterCalls += 1;
      return 'not allowed';
    },
  });
  assert.throws(
    () => context.forecastService.calculateForecastRun(context.forecastCommandContext, command),
    error => error.code === 'FORECAST_COMMAND_NOT_INERT',
  );
  assert.equal(getterCalls, 0);
  assert.deepEqual(forecastCounts(context.db), before);
  assert.equal(context.db.inTransaction, false);
  context.close();
});

test('SQLite-native faults at every ordinary calculation stage leave no partial PR7 history', async t => {
  for (const table of [
    'forecast_receivable_runs',
    'forecast_receivable_input_snapshots',
    'forecast_receivable_input_events',
    'forecast_receivable_items',
    'forecast_receivable_operations',
    'forecast_receivable_audit_events',
  ]) {
    await t.test(table, () => {
      const context = createForecastTestContext();
      const before = forecastCounts(context.db);
      context.db.exec(`
        CREATE TEMP TRIGGER fail_forecast_${table}
        BEFORE INSERT ON ${table}
        BEGIN
          SELECT RAISE(ABORT, 'forced ${table} failure');
        END;
      `);
      assert.throws(
        () => context.forecastService.calculateForecastRun(
          context.forecastCommandContext,
          forecastCommand(context),
        ),
        new RegExp(`forced ${table} failure`),
      );
      assert.deepEqual(forecastCounts(context.db), before);
      assert.equal(context.db.inTransaction, false);
      assert.deepEqual(context.db.pragma('foreign_key_check'), []);
      context.close();
    });
  }
});
