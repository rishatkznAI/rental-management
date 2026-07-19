import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import {
  createForecastTestContext,
  deterministicForecastPolicy,
  forecastCommand,
} from './forecast-receivables-planning-fixtures.js';

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const {
  FORECAST_RECEIVABLES_PLANNING_TABLES,
} = require('../server/lib/forecast-receivables-planning-schema.js');
const {
  createForecastReceivablesPlanningRepository,
} = require('../server/lib/forecast-receivables-planning-repository.js');
const {
  createForecastReceivablesPlanningService,
} = require('../server/lib/forecast-receivables-planning-service.js');

const RFC3339_MILLISECONDS = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const UUID_SUFFIX = /^[a-z-]+-[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function forecastCounts(db) {
  return Object.fromEntries(FORECAST_RECEIVABLES_PLANNING_TABLES.map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

function assertNoForecastRows(db) {
  assert.deepEqual(
    forecastCounts(db),
    Object.fromEntries(FORECAST_RECEIVABLES_PLANNING_TABLES.map(table => [table, 0])),
  );
}

function protectedState(db) {
  return {
    branch: db.prepare(`
      SELECT status, version FROM canonical_branches
      WHERE companyId = 'company-a' AND id = 'branch-a-1'
    `).get(),
    membership: db.prepare(`
      SELECT status, version FROM company_memberships WHERE id = 'membership-billing'
    `).get(),
    capabilityAssignments: db.prepare(`
      SELECT COUNT(*) AS count FROM membership_capability_assignments
      WHERE membershipId = 'membership-billing' AND capabilityKey = 'forecast.calculate'
    `).get().count,
    source: db.prepare(`
      SELECT provenanceHash FROM billing_source_rental_lines ORDER BY id LIMIT 1
    `).get(),
    usersJson: db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json,
  };
}

function createMutationAttempt(context, name, calls) {
  return () => {
    calls[name] += 1;
    context.db.prepare(`
      INSERT INTO membership_capability_assignments (
        id, membershipId, companyId, catalogVersion, capabilityKey, effect,
        status, version, grantedAt, grantedBy, reason
      ) VALUES (?, 'membership-billing', 'company-a', 1, 'forecast.calculate',
        'deny', 'active', 1, ?, 'U-billing', ?)
    `).run(`malicious-${name}-deny`, '2026-07-18T00:00:00.000Z', `malicious-${name}`);
    context.db.prepare(`
      UPDATE canonical_branches
      SET status = 'inactive', version = version + 1
      WHERE companyId = 'company-a' AND id = 'branch-a-1'
    `).run();
    context.db.prepare(`
      UPDATE company_memberships SET version = version + 1
      WHERE id = 'membership-billing'
    `).run();
    context.db.prepare(`
      UPDATE billing_source_rental_lines SET provenanceHash = ?
    `).run('0'.repeat(64));
    return name === 'nowIso'
      ? '2026-07-18T00:00:00.000Z'
      : `malicious-${name}-id`;
  };
}

test('public repository ignores legacy callbacks and owns live users, time, and opaque IDs', () => {
  const context = createForecastTestContext();
  try {
    const calls = { nowIso: 0, generateId: 0, readUsers: 0 };
    const before = protectedState(context.db);
    const repository = createForecastReceivablesPlanningRepository(context.db, {
      nowIso: createMutationAttempt(context, 'nowIso', calls),
      generateId: createMutationAttempt(context, 'generateId', calls),
      readUsers() {
        calls.readUsers += 1;
        return [];
      },
    });
    const service = createForecastReceivablesPlanningService({
      repository,
      policyRegistry: deterministicForecastPolicy(),
    });
    const result = service.calculateForecastRun(
      service.createCommandContext(context.platformScope),
      forecastCommand(context),
    );

    assert.deepEqual(calls, { nowIso: 0, generateId: 0, readUsers: 0 });
    assert.deepEqual(protectedState(context.db), before);
    assert.match(result.forecastRunId, UUID_SUFFIX);
    assert.match(result.calculatedAt, RFC3339_MILLISECONDS);
    assert.match(result.inputSetHash, /^[0-9a-f]{64}$/);
    assert.match(result.resultHash, /^[0-9a-f]{64}$/);

    const operation = context.db.prepare('SELECT * FROM forecast_receivable_operations').get();
    const audit = context.db.prepare('SELECT * FROM forecast_receivable_audit_events').get();
    assert.match(operation.id, UUID_SUFFIX);
    assert.match(audit.id, UUID_SUFFIX);
    assert.equal(operation.resultRunId, result.forecastRunId);
    assert.equal(operation.inputSetHash, result.inputSetHash);
    assert.equal(operation.resultHash, result.resultHash);
    assert.equal(audit.aggregateId, result.forecastRunId);
    assert.equal(audit.operationId, operation.id);
    assert.equal(audit.inputSetHash, result.inputSetHash);
    assert.equal(audit.resultHash, result.resultHash);
    assert.equal(operation.createdAt, result.calculatedAt);
    assert.equal(audit.createdAt, result.calculatedAt);
  } finally {
    context.close();
  }
});

test('service ignores removed readUsers and repositoryOptions plumbing', () => {
  const context = createForecastTestContext();
  try {
    const calls = { readUsers: 0, nowIso: 0, generateId: 0 };
    const service = createForecastReceivablesPlanningService({
      db: context.db,
      policyRegistry: deterministicForecastPolicy(),
      readUsers() {
        calls.readUsers += 1;
        return [];
      },
      repositoryOptions: {
        nowIso() {
          calls.nowIso += 1;
          return '2026-07-18T00:00:00.000Z';
        },
        generateId() {
          calls.generateId += 1;
          return 'caller-controlled-id';
        },
      },
    });
    const result = service.calculateForecastRun(
      service.createCommandContext(context.platformScope),
      forecastCommand(context),
    );
    assert.equal(result.status, 'calculated');
    assert.deepEqual(calls, { readUsers: 0, nowIso: 0, generateId: 0 });
    assert.match(result.forecastRunId, UUID_SUFFIX);
    assert.match(result.calculatedAt, RFC3339_MILLISECONDS);
  } finally {
    context.close();
  }
});

test('repository fresh authorization rereads changed app_data users on its own connection', () => {
  const context = createForecastTestContext();
  try {
    const users = JSON.parse(
      context.db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json,
    );
    users.find(user => user.id === context.forecastCommandContext.principalId).status = 'Отключен';
    context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'users'").run(JSON.stringify(users));

    assert.throws(
      () => context.forecastService.calculateForecastRun(
        context.forecastCommandContext,
        forecastCommand(context),
      ),
      error => error.code === 'PLATFORM_PRINCIPAL_DENIED',
    );
    assertNoForecastRows(context.db);
  } finally {
    context.close();
  }
});

test('repository-owned app_data users reader fails closed on malformed JSON', () => {
  const context = createForecastTestContext();
  try {
    context.db.prepare("UPDATE app_data SET json = '{' WHERE name = 'users'").run();
    assert.throws(
      () => context.forecastService.calculateForecastRun(
        context.forecastCommandContext,
        forecastCommand(context),
      ),
      error => error.code === 'PLATFORM_PRINCIPAL_DENIED',
    );
    assertNoForecastRows(context.db);
  } finally {
    context.close();
  }
});

test('production forecast mutation boundary exposes no caller callback or hook API', () => {
  const repositorySource = fs.readFileSync(
    path.join(root, 'server/lib/forecast-receivables-planning-repository.js'),
    'utf8',
  );
  const serviceSource = fs.readFileSync(
    path.join(root, 'server/lib/forecast-receivables-planning-service.js'),
    'utf8',
  );
  const productionSource = `${repositorySource}\n${serviceSource}`;

  for (const forbidden of [
    'options.nowIso',
    'options.generateId',
    'options.readUsers',
    'repositoryOptions',
  ]) assert.equal(productionSource.includes(forbidden), false, forbidden);
  assert.doesNotMatch(repositorySource, /createForecastReceivablesPlanningRepository\(db\s*,/);
  assert.doesNotMatch(serviceSource, /\breadUsers\b|\brepositoryOptions\b/);
  assert.doesNotMatch(repositorySource, /\b(?:clock|idFactory|transactionHook|beforeCommit|afterCommit)\b/);
  assert.match(repositorySource, /SELECT json FROM app_data WHERE name = 'users'/);
  assert.match(repositorySource, /const createdAt = new Date\(\)\.toISOString\(\);/);
  assert.match(repositorySource, /crypto\.randomUUID\(\)/);
  assert.match(serviceSource, /createForecastReceivablesPlanningRepository\(db\)/);

  const transactionBody = repositorySource.slice(repositorySource.indexOf('return db.transaction(() => {'));
  assert.doesNotMatch(transactionBody, /\boptions\b|\brepositoryOptions\b|\bidFactory\b|\bclock\s*\(/);
});
