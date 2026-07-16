import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  createCanonicalReadContext,
  withServer,
} from './canonical-receivables-read-fixtures.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  registerCanonicalReceivablesReadRoutes,
} = require('../server/routes/canonical-receivables-read.js');
const {
  resolveCanonicalReceivablesTrustedScope,
} = require('../server/lib/canonical-receivables-scope-adapter.js');
const {
  createCanonicalReceivablesScopeAdapter,
} = require('../server/lib/canonical-receivables-scope-test-adapter.js');
const {
  CAPABILITY_CATALOG_V1,
  FINANCIAL_TABLES,
} = require('../server/lib/platform-identity-schema.js');

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function routeApp({ enabled, resolver, service }) {
  const app = express();
  const router = express.Router();
  registerCanonicalReceivablesReadRoutes(router, {
    enabled,
    requireAuth(req, _res, next) {
      req.user = { userId: 'U-test' };
      next();
    },
    resolveTrustedScope: resolver,
    service,
    cursorSecret: 'abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789',
    logger: { error() {} },
  });
  app.use('/api', router);
  app.use((_req, res) => res.status(404).json({ error: 'not-found' }));
  return app;
}

test('production canonical resolver remains unconditional null and feature enablement alone cannot read data', async () => {
  assert.equal(resolveCanonicalReceivablesTrustedScope(), null);
  assert.equal(resolveCanonicalReceivablesTrustedScope({
    req: {
      user: { userId: 'U-forged' },
      headers: { 'x-system-actor': 'true' },
      query: { companyId: 'company-forged' },
    },
  }), null);
  let serviceCalls = 0;
  const service = {
    list() { serviceCalls += 1; return { items: [] }; },
    detail() { serviceCalls += 1; return null; },
    summary() { serviceCalls += 1; return {}; },
    aging() { serviceCalls += 1; return {}; },
  };
  await withServer(routeApp({
    enabled: false,
    resolver: resolveCanonicalReceivablesTrustedScope,
    service,
  }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/receivables`);
    assert.equal(response.status, 404);
  });
  await withServer(routeApp({
    enabled: true,
    resolver: resolveCanonicalReceivablesTrustedScope,
    service,
  }), async baseUrl => {
    const response = await fetch(`${baseUrl}/api/receivables`, {
      headers: { authorization: 'Bearer test' },
    });
    const body = await response.json();
    assert.equal(response.status, 403);
    assert.equal(body.error.code, 'RECEIVABLES_SCOPE_DENIED');
  });
  assert.equal(serviceCalls, 0);
});

test('only isolated injected adapter can map a platform scope and it retains concrete branch IDs', async () => {
  const adapter = createCanonicalReceivablesScopeAdapter({
    resolvePlatformScope: async () => Object.freeze({
      authenticated: true,
      principalType: 'user',
      principalId: 'U-test',
      companyId: 'company-test',
      companyTimezone: 'Europe/Moscow',
      membershipId: 'membership-test',
      membershipVersion: 1,
      roleTemplateKey: 'reader',
      roleTemplateVersion: 1,
      capabilityCatalogVersion: 1,
      capabilities: Object.freeze(['receivables.read']),
      companyWideBranchAuthority: true,
      allowedBranchIds: Object.freeze(['branch-1', 'branch-2']),
      resolvedAt: '2026-07-16T00:00:00.000Z',
    }),
  });
  const mapped = await adapter({ req: {}, principal: { userId: 'U-test' } });
  assert.equal(mapped.companyWideBranchAccess, true);
  assert.deepEqual(mapped.allowedBranchIds, ['branch-1', 'branch-2']);
  assert.equal(mapped.allowedBranchIds.includes('*'), false);
});

test('physical-root and DML ownership remain single-authority with no synchronization path', () => {
  const schema = read('server/lib/platform-identity-schema.js');
  const repository = read('server/lib/platform-identity-repository.js');
  const canonicalRepositories = [
    'server/lib/canonical-receivables-repository.js',
    'server/lib/canonical-receivables-settlement-repository.js',
    'server/lib/canonical-receivables-read-repository.js',
  ].map(read).join('\n');
  assert.doesNotMatch(schema, /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?companies\b/i);
  assert.doesNotMatch(schema, /CREATE TABLE\s+(?:IF NOT EXISTS\s+)?branches\b/i);
  assert.match(schema, /ALTER TABLE \$\{CANONICAL_COMPANIES_TABLE\}/);
  assert.match(schema, /ALTER TABLE \$\{CANONICAL_BRANCHES_TABLE\}/);
  assert.doesNotMatch(canonicalRepositories, /(?:INSERT INTO|UPDATE|DELETE FROM)\s+canonical_(?:companies|branches)/i);
  assert.match(repository, /INSERT INTO \$\{CANONICAL_COMPANIES_TABLE\}/);
  assert.match(repository, /INSERT INTO \$\{CANONICAL_BRANCHES_TABLE\}/);
  assert.doesNotMatch(`${schema}\n${repository}`, /dual.?write|synchroni[sz].*(?:company|branch)/i);
});

test('platform authorization source contains no legacy role or editable-label authority', () => {
  const authorization = read('server/lib/platform-authorization.js');
  const repository = read('server/lib/platform-identity-repository.js');
  const source = `${authorization}\n${repository}`;
  for (const forbidden of [
    'Администратор',
    'Офис-менеджер',
    'Менеджер по аренде',
    'Менеджер по продажам',
    'Руководитель',
    'Инвестор',
    'managerName',
    'ownerName',
    'clientName',
    'email matching',
    'equipment relation',
    'request permissions',
  ]) {
    assert.equal(source.includes(forbidden), false, forbidden);
  }
  assert.doesNotMatch(source, /access-control|role-groups|req\.user\.permissions/);
});

test('catalog is exact v1 and excludes posting and settlement capabilities', () => {
  assert.deepEqual(CAPABILITY_CATALOG_V1.map(item => item.key), [
    'billing.period.close',
    'billing.period.reopen',
    'branches.manage',
    'companies.manage',
    'forecast.calculate',
    'forecast.read',
    'members.manage',
    'receivables.read',
    'upd.conduct',
    'upd.correct',
    'upd.form',
  ]);
  assert.equal(CAPABILITY_CATALOG_V1.some(item => /post|settle|allocation|payment|refund|write.?off/i.test(item.key)), false);
});

test('server startup wires schema only and production registration imports no working platform resolver', () => {
  const dbSource = read('server/db.js');
  const serverSource = read('server/server.js');
  const productionAdapterSource = read('server/lib/canonical-receivables-scope-adapter.js');
  const bootstrapSource = read('server/lib/platform-identity-bootstrap.js');
  assert.match(dbSource, /ensurePlatformIdentitySchema\(db\)/);
  assert.doesNotMatch(dbSource, /platform-identity-bootstrap|applyPlatformIdentityBootstrap/);
  assert.match(serverSource, /canonical-receivables-scope-adapter/);
  assert.doesNotMatch(serverSource, /platform-authorization/);
  assert.doesNotMatch(serverSource, /createPlatformIdentityRepository/);
  assert.doesNotMatch(productionAdapterSource, /platform-authorization|createCanonicalReceivablesScopeAdapter/);
  assert.doesNotMatch(bootstrapSource, /module\.exports.*startup|startServer/);
});

test('fresh and repeated ensureDb create only schema/catalog authority and no financial or membership rows', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'platform-identity-startup-'));
  const dbPath = path.join(directory, 'startup.sqlite');
  const script = `
    const { ensureDb } = require('./server/db');
    const db = ensureDb();
    const tables = ${JSON.stringify([
    'canonical_companies',
    'canonical_branches',
    'company_memberships',
    'membership_branch_access',
    'role_templates',
    'role_template_capabilities',
    'membership_capability_assignments',
    'authorization_audit_events',
    'identity_bootstrap_runs',
    ...FINANCIAL_TABLES,
  ])};
    const counts = Object.fromEntries(tables.map(table => [
      table,
      db.prepare('SELECT COUNT(*) AS count FROM ' + table).get().count,
    ]));
    const migration = db.prepare(
      "SELECT applied_at FROM sql_shadow_schema_migrations WHERE name = 'platform_identity_pr5'"
    ).get();
    console.log(JSON.stringify({
      counts,
      catalogEntries: db.prepare('SELECT COUNT(*) AS count FROM capability_catalog_entries').get().count,
      appData: db.prepare('SELECT COUNT(*) AS count FROM app_data').get().count,
      foreignKeys: db.pragma('foreign_keys', { simple: true }),
      foreignKeyCheck: db.pragma('foreign_key_check').length,
      migration,
    }));
  `;
  try {
    const run = () => JSON.parse(execFileSync(process.execPath, ['-e', script], {
      cwd: root,
      env: { ...process.env, DB_PATH: dbPath },
      encoding: 'utf8',
    }).trim());
    const first = run();
    const second = run();
    Object.values(first.counts).forEach(count => assert.equal(count, 0));
    assert.deepEqual(second.counts, first.counts);
    assert.equal(first.catalogEntries, 11);
    assert.equal(second.catalogEntries, 11);
    assert.equal(first.appData, 0);
    assert.equal(second.appData, 0);
    assert.equal(first.foreignKeys, 1);
    assert.equal(first.foreignKeyCheck, 0);
    assert.deepEqual(second.migration, first.migration);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('PR3 repository always emits a concrete branch predicate, including company-wide scopes', () => {
  const source = read('server/lib/canonical-receivables-read-repository.js');
  assert.doesNotMatch(source, /branchIds:\s*null/);
  assert.doesNotMatch(source, /else if \(!normalized\.companyWideBranchAccess\)/);
  assert.match(source, /branchId IN \(\$\{placeholders\.join\(', '\)\}\)/);
});

test('Finance, Company Health, legacy routes, and frontend remain disconnected from PR5 modules', () => {
  const unchangedPaths = [
    'server/routes/crud.js',
    'server/routes/finance.js',
    'server/routes/rentals.js',
    'server/routes/documents.js',
    'server/routes/deliveries.js',
    'server/routes/service.js',
    'server/routes/reports.js',
    'server/routes/planner.js',
    'server/routes/tasks-center.js',
    'server/routes/equipment-readiness.js',
    'server/routes/staff.js',
    'server/routes/bot.js',
    'src/app/contexts/AuthContext.tsx',
    'src/app/lib/permissions.ts',
    'src/app/pages/Dashboard.tsx',
  ].map(read).join('\n');
  assert.doesNotMatch(unchangedPaths, /platform-identity|platform-authorization|company_memberships|membership_branch_access/);
});

test('canonical read service requires concrete branches even for company-wide injected scopes', () => {
  const context = createCanonicalReadContext();
  try {
    const repository = require('../server/lib/canonical-receivables-read-repository.js')
      .createCanonicalReceivablesReadRepository(context.db);
    assert.throws(() => repository.readSnapshot(reader => reader.listReceivables({
      companyId: 'company-a',
      companyWideBranchAccess: true,
      branchIds: [],
    })), /trusted branch scope is required/i);
    assert.throws(() => repository.readSnapshot(reader => reader.listReceivables({
      companyId: 'company-a',
      companyWideBranchAccess: true,
      branchIds: ['branch-a1'],
    }, {
      branchId: 'branch-a2',
    })), /outside the trusted scope/i);
  } finally {
    context.close();
  }
});
