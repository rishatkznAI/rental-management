import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  createCanonicalReadContext,
  trustedScope,
} from './canonical-receivables-read-fixtures.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  isCanonicalReceivablesReadApiEnabled,
} = require('../server/lib/feature-flags.js');
const {
  createCanonicalReceivablesReadRepository,
} = require('../server/lib/canonical-receivables-read-repository.js');
const {
  createCanonicalReceivablesReadService,
} = require('../server/lib/canonical-receivables-read-service.js');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

test('canonical read feature flag defaults disabled and production scope resolver stays fail-closed', () => {
  assert.equal(isCanonicalReceivablesReadApiEnabled({}), false);
  assert.equal(isCanonicalReceivablesReadApiEnabled({ CANONICAL_RECEIVABLES_READ_API_ENABLED: 'false' }), false);
  assert.equal(isCanonicalReceivablesReadApiEnabled({ CANONICAL_RECEIVABLES_READ_API_ENABLED: 'true' }), true);
  const server = read('server/server.js');
  const adapter = read('server/lib/canonical-receivables-scope-adapter.js');
  assert.match(adapter, /function resolveCanonicalReceivablesTrustedScope\(\) \{\s*return null;\s*\}/);
  assert.match(server, /require\('\.\/lib\/canonical-receivables-scope-adapter'\)/);
  assert.doesNotMatch(server, /require\('\.\/lib\/platform-authorization'\)/);
  assert.match(server, /enabled: CANONICAL_RECEIVABLES_READ_API_ENABLED/);
  assert.match(server, /CANONICAL_RECEIVABLES_READ_API_ENABLED \? ensureDb\(\) : null/);
});

test('HTTP read path imports no legacy receivables semantics or settlement mutation repository', () => {
  const files = [
    'server/routes/canonical-receivables-read.js',
    'server/lib/canonical-receivables-read-repository.js',
    'server/lib/canonical-receivables-read-model.js',
    'server/lib/canonical-receivables-read-service.js',
    'server/lib/canonical-receivables-aging.js',
  ];
  const source = files.map(read).join('\n');
  assert.doesNotMatch(source, /receivables-core|finance-core|app_data|gantt_rentals|receivable_payment_plans/);
  assert.doesNotMatch(source, /canonical-receivables-settlement-repository/);
  assert.doesNotMatch(source, /createCanonicalPayment|requestAllocation|approveAllocation|requestAdjustment|requestRefund|requestWriteOff/);
  assert.doesNotMatch(source, /\.(?:post|put|patch|delete)\(\s*['"]\/receivables/);
});

test('read repository exposes only a snapshot entrypoint and routes register summary/aging before detail', () => {
  const context = createCanonicalReadContext();
  try {
    assert.deepEqual(Object.keys(createCanonicalReceivablesReadRepository(context.db)), ['readSnapshot']);
  } finally {
    context.close();
  }
  const route = read('server/routes/canonical-receivables-read.js');
  const summaryIndex = route.indexOf("router.get('/receivables/summary'");
  const agingIndex = route.indexOf("router.get('/receivables/aging'");
  const detailIndex = route.indexOf("router.get('/receivables/:id'");
  assert.ok(summaryIndex > 0 && agingIndex > summaryIndex && detailIndex > agingIndex);
});

test('legacy rental/payment debt cannot populate an empty canonical read result', () => {
  const context = createCanonicalReadContext({ seedScopes: false });
  try {
    context.db.exec(`
      CREATE TABLE app_data (
        name TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      INSERT INTO app_data (name, json) VALUES
        ('gantt_rentals', '[{"id":"legacy-rental","amount":999999,"endDate":"2020-01-01"}]'),
        ('payments', '[{"id":"legacy-payment","amount":1,"dueDate":"2020-01-01"}]');
    `);
    const counts = [
      'canonical_companies',
      'canonical_branches',
      'canonical_receivables',
      'financial_audit_events',
      'canonical_payments',
      'canonical_payment_allocations',
      'canonical_receivable_adjustments',
      'canonical_approval_requests',
    ].map(table => context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count);
    assert.deepEqual(counts, Array(8).fill(0));

    const service = createCanonicalReceivablesReadService({
      repository: createCanonicalReceivablesReadRepository(context.db),
      cursorSecret: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
      now: () => new Date('2026-07-15T12:00:00.000Z'),
    });
    const scope = trustedScope({
      companyId: 'unmapped-test-company',
      receivablesTimezone: 'Europe/Moscow',
      companyWideBranchAccess: true,
    });
    const list = service.list({}, scope);
    const summary = service.summary({}, scope);
    const aging = service.aging({}, scope);
    assert.deepEqual(list.items, []);
    assert.equal(list.hasMore, false);
    assert.equal(summary.receivableCount, 0);
    assert.equal(summary.totalOutstandingMinor, 0);
    assert.equal(summary.unappliedPaymentMinor, 0);
    assert.equal(aging.totalOutstandingMinor, 0);
    assert.equal(aging.reconciled, true);
  } finally {
    context.close();
  }
});

test('Finance, Company Health, frontend, worker, and settlement write paths remain unswitched', () => {
  const unchangedReadPaths = [
    'server/routes/finance.js',
    'server/lib/receivables-core.js',
    'server/lib/finance-core.js',
    'server/lib/startup.js',
    'src/app/lib/companyHealthDebtAging.js',
    'src/app/lib/dashboardCompanyHealth.js',
    'src/app/pages/Dashboard.tsx',
  ].map(read).join('\n');
  assert.doesNotMatch(unchangedReadPaths, /canonical-receivables-read|\/api\/receivables(?:\b|\/)/);
  const settlementRepository = read('server/lib/canonical-receivables-settlement-repository.js');
  assert.doesNotMatch(settlementRepository, /canonical-receivables-read/);
});
