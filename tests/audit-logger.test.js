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

  const entry = auditLog({
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
  assert.equal(entry.description.includes('role'), true);
  assert.equal(state.audit_logs.length, 1);
  assert.equal(state.audit_logs[0].before.password, undefined);
  assert.equal(state.audit_logs[0].before.note, undefined);
  assert.equal(state.audit_logs[0].after.token, undefined);
  assert.equal(state.audit_logs[0].after.tokenVersion, undefined);
  assert.equal(state.audit_logs[0].metadata.webhookSecret, undefined);
  assert.doesNotMatch(JSON.stringify(state.audit_logs), /old|secret-token|webhookSecret/);
});

test('redactAuditValue keeps only safe top-level fields', () => {
  const result = redactAuditValue({
    id: 'D-1',
    number: 'DOC-1',
    fileUrl: 'https://example.test/file.pdf',
    password: 'secret',
    customUnsafeField: 'drop-me',
  });

  assert.deepEqual(result, {
    id: 'D-1',
    number: 'DOC-1',
  });
});
