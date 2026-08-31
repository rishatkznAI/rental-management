import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAuditLogger, redactAuditValue } = require('../server/lib/security-audit.js');

test('createAuditLogger writes audit_logs and strips sensitive fields', () => {
  const state = {
    audit_logs: [],
    audit_log: [{ id: 'AUD-legacy', action: 'legacy', entityType: 'legacy' }],
  };
  const auditLog = createAuditLogger({
    readData: name => state[name] || [],
    writeData: (name, value) => {
      state[name] = value;
    },
    generateId: prefix => `${prefix}-1`,
    nowIso: () => '2026-05-02T10:00:00.000Z',
  });

  const entry = auditLog.system({
    user: { userId: 'U-1', userName: 'Админ', userRole: 'Администратор' },
    headers: { authorization: 'Bearer secret-token', 'user-agent': 'test' },
  }, {
    action: 'users.update',
    entityType: 'users',
    entityId: 'U-2',
    before: { id: 'U-2', role: 'Менеджер по аренде', password: 'old', note: 'drop-me' },
    after: { id: 'U-2', role: 'Администратор', tokenVersion: 2, token: 'secret' },
    metadata: { reason: 'role change', webhookSecret: 'secret' },
  });

  assert.equal(entry.id, 'AUD-1');
  assert.equal(entry.auditKind, 'GLOBAL_SYSTEM');
  assert.equal(entry.description.includes('role'), true);
  assert.equal(state.audit_logs.length, 1);
  assert.equal(state.audit_logs[0].before.password, undefined);
  assert.equal(state.audit_logs[0].before.note, undefined);
  assert.equal(state.audit_logs[0].after.token, undefined);
  assert.equal(state.audit_logs[0].after.tokenVersion, undefined);
  assert.equal(state.audit_logs[0].metadata.webhookSecret, undefined);
  assert.doesNotMatch(JSON.stringify(state.audit_logs), /old|secret-token|webhookSecret/);
});

test('audit scope accepts only trusted actorScope and never mutable user fields', () => {
  const state = { audit_logs: [] };
  const contexts = [];
  const auditLog = createAuditLogger({
    readData: () => state.audit_logs,
    writeData: (_name, value) => { state.audit_logs = value; },
    withTenantScope: (scope, operation) => {
      contexts.push({ kind: 'tenant', scope });
      return operation();
    },
    withSystemScope: operation => {
      contexts.push({ kind: 'system' });
      return operation();
    },
  });

  assert.throws(
    () => auditLog({
      user: { userId: 'U-forged', companyId: 'COMPANY-B', tenantId: 'COMPANY-B' },
    }, { action: 'login.fail', entityType: 'auth' }),
    error => error?.code === 'AUDIT_SCOPE_REQUIRED',
  );

  const forged = auditLog.system({
    user: { userId: 'U-forged', companyId: 'COMPANY-B', tenantId: 'COMPANY-B' },
  }, { action: 'login.fail', entityType: 'auth' });
  assert.equal(forged.auditKind, 'GLOBAL_SYSTEM');
  assert.equal(forged.companyId, undefined);
  assert.deepEqual(contexts.at(-1), { kind: 'system' });

  const tenant = auditLog({
    actorScope: { companyId: 'COMPANY-A', tenantId: 'COMPANY-A' },
    user: { userId: 'U-A', companyId: 'COMPANY-B', tenantId: 'COMPANY-B' },
  }, { action: 'clients.update', entityType: 'clients', entityId: 'C-A' });
  assert.equal(tenant.auditKind, 'TENANT');
  assert.equal(tenant.companyId, 'COMPANY-A');
  assert.deepEqual(contexts.at(-1), {
    kind: 'tenant',
    scope: { companyId: 'COMPANY-A', tenantId: 'COMPANY-A' },
  });

  assert.throws(
    () => auditLog.system({
      actorScope: { companyId: 'COMPANY-A', tenantId: 'COMPANY-A' },
      user: { userId: 'U-A' },
    }, { action: 'system.test', entityType: 'system' }),
    error => error?.code === 'AUDIT_SCOPE_CONFLICT',
  );
});

test('audit persistence errors propagate instead of being silently ignored', () => {
  const auditLog = createAuditLogger({
    readData: () => [],
    writeData: () => {
      const error = new Error('disk full');
      error.code = 'SQLITE_FULL';
      throw error;
    },
  });
  assert.throws(
    () => auditLog.system({}, { action: 'login.fail', entityType: 'auth' }),
    error => error?.code === 'SQLITE_FULL',
  );
});

test('malformed stored audit history is never replaced by a new event', () => {
  const stored = { corrupt: true };
  let writes = 0;
  const auditLog = createAuditLogger({
    readData: () => stored,
    writeData: () => { writes += 1; },
  });

  assert.throws(
    () => auditLog.system({}, { action: 'login.fail', entityType: 'auth' }),
    error => error?.code === 'AUDIT_HISTORY_SHAPE_INVALID',
  );
  assert.equal(writes, 0);
  assert.deepEqual(stored, { corrupt: true });
});

test('global-system audit append never evicts tenant, global, or legacy history', () => {
  const tenantRows = [
    { id: 'TENANT-A', companyId: 'COMPANY-A', tenantId: 'COMPANY-A', auditKind: 'TENANT' },
    { id: 'TENANT-LEGACY', companyId: 'COMPANY-B', tenantId: 'COMPANY-B' },
  ];
  const globalRows = Array.from({ length: 10000 }, (_value, index) => ({
    id: `GLOBAL-${index}`,
    auditKind: 'GLOBAL_SYSTEM',
  }));
  const unscopedLegacy = { id: 'UNSCOPED-LEGACY' };
  const state = { audit_logs: [...tenantRows, unscopedLegacy, ...globalRows] };
  const auditLog = createAuditLogger({
    readData: () => state.audit_logs,
    writeData: (_name, value) => { state.audit_logs = value; },
    generateId: () => 'GLOBAL-NEW',
  });

  auditLog.system({}, { action: 'login.fail', entityType: 'auth' });

  assert.equal(state.audit_logs.some(entry => entry.id === 'TENANT-A'), true);
  assert.equal(state.audit_logs.some(entry => entry.id === 'TENANT-LEGACY'), true);
  assert.equal(state.audit_logs.some(entry => entry.id === 'GLOBAL-0'), true);
  assert.equal(state.audit_logs.some(entry => entry.id === 'UNSCOPED-LEGACY'), true);
  assert.equal(state.audit_logs.some(entry => entry.id === 'GLOBAL-NEW'), true);
  assert.equal(state.audit_logs.filter(globalSystemAudit => (
    globalSystemAudit.auditKind === 'GLOBAL_SYSTEM'
  )).length, 10001);
});

test('redactAuditValue keeps only safe top-level fields', () => {
  const result = redactAuditValue({
    id: 'D-1',
    number: 'DOC-1',
    fileUrl: 'https://example.test/file.pdf',
    attemptedFields: ['saleStatus'],
    violations: ['saleStatus'],
    userEmail: 'admin@example.test',
    password: 'secret',
    customUnsafeField: 'drop-me',
  });

  assert.deepEqual(result, {
    id: 'D-1',
    number: 'DOC-1',
    attemptedFields: ['saleStatus'],
    violations: ['saleStatus'],
    userEmail: 'admin@example.test',
  });
});
