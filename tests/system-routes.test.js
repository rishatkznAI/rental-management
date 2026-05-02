import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { registerSystemRoutes } = require('../server/routes/system.js');

function createSystemApp(overrides = {}) {
  const app = express();
  const messages = [];
  app.use(express.json());
  registerSystemRoutes(app, {
    readData: overrides.readData || (() => []),
    writeData: overrides.writeData || (() => {}),
    getSnapshot: () => ({}),
    saveSnapshot: () => {},
    botToken: 'token-present',
    getBotUsers: () => ({}),
    sendMessage: async (target, text) => {
      messages.push({ target, text });
      return { ok: true };
    },
    countActiveSessions: () => 0,
    dbPath: ':memory:',
    webhookUrl: '',
    requireAuth: (req, _res, next) => {
      req.user = overrides.user || {
        userId: 'U-admin',
        userName: 'Админ',
        userRole: 'Администратор',
        rawRole: 'admin',
        normalizedRole: 'Администратор',
        email: 'admin@example.test',
      };
      next();
    },
    requireAdmin: overrides.requireAdmin || ((_req, _res, next) => next()),
    auditLog: () => {},
    getBuildInfo: () => ({ version: 'test' }),
    getRoleAccessSummary: () => ({
      readableCollections: ['equipment', 'rentals'],
      writableCollections: ['equipment'],
    }),
  });
  return { app, messages };
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function postJson(baseUrl, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('/api/bot-test requires explicit chatId or env chat id', async () => {
  const previousEnabled = process.env.ENABLE_BOT_TEST;
  const previousChatId = process.env.BOT_TEST_CHAT_ID;
  process.env.ENABLE_BOT_TEST = '1';
  delete process.env.BOT_TEST_CHAT_ID;
  const { app, messages } = createSystemApp();

  try {
    await withServer(app, async (baseUrl) => {
      const response = await getJson(baseUrl, '/api/bot-test');
      assert.equal(response.status, 400);
      assert.match(response.body.error, /chatId is required/);
      assert.equal(messages.length, 0);
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_BOT_TEST;
    else process.env.ENABLE_BOT_TEST = previousEnabled;
    if (previousChatId === undefined) delete process.env.BOT_TEST_CHAT_ID;
    else process.env.BOT_TEST_CHAT_ID = previousChatId;
  }
});

test('/api/bot-test sends only to provided chatId', async () => {
  const previousEnabled = process.env.ENABLE_BOT_TEST;
  const previousChatId = process.env.BOT_TEST_CHAT_ID;
  process.env.ENABLE_BOT_TEST = '1';
  delete process.env.BOT_TEST_CHAT_ID;
  const { app, messages } = createSystemApp();

  try {
    await withServer(app, async (baseUrl) => {
      const response = await getJson(baseUrl, '/api/bot-test?chatId=777&text=ping');
      assert.equal(response.status, 200);
      assert.equal(response.body.chatId, 777);
      assert.deepEqual(messages[0], { target: { chat_id: 777 }, text: 'ping' });
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_BOT_TEST;
    else process.env.ENABLE_BOT_TEST = previousEnabled;
    if (previousChatId === undefined) delete process.env.BOT_TEST_CHAT_ID;
    else process.env.BOT_TEST_CHAT_ID = previousChatId;
  }
});

test('/api/admin/production-diagnostics returns safe admin diagnostics', async () => {
  const collections = {
    equipment: [{ id: 'E-1' }],
    rentals: [{ id: 'R-1' }, { id: 'R-2' }],
    service: [],
    deliveries: [{ id: 'D-1' }],
    documents: [],
    payments: [{ id: 'P-1' }],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/production-diagnostics');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.backend.build.version, 'test');
    assert.equal(response.body.user.email, 'admin@example.test');
    assert.equal(response.body.user.rawRole, 'admin');
    assert.deepEqual(response.body.access.readableCollections, ['equipment', 'rentals']);
    assert.equal(response.body.endpoints.equipment.count, 1);
    assert.equal(response.body.endpoints.rentals.count, 2);

    const serialized = JSON.stringify(response.body);
    assert.doesNotMatch(serialized, /password|token-present|secret/i);
  });
});

test('/api/admin/production-diagnostics is admin-only', async () => {
  const { app } = createSystemApp({
    requireAdmin: (_req, res) => res.status(403).json({ ok: false, error: 'Forbidden' }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/production-diagnostics');
    assert.equal(response.status, 403);
  });
});

test('/api/admin/audit-logs returns filtered safe entries for admins only', async () => {
  const collections = {
    audit_logs: [
      {
        id: 'AUD-1',
        createdAt: '2026-05-02T10:00:00.000Z',
        userId: 'U-1',
        userName: 'Админ',
        role: 'Администратор',
        action: 'payments.update',
        entityType: 'payments',
        entityId: 'P-1',
        description: 'Изменение платежа',
        before: { id: 'P-1', amount: 100, password: 'hidden', internalComment: 'hidden-note', fileUrl: 'https://example.test/private.pdf' },
        after: { id: 'P-1', amount: 200, token: 'hidden' },
        metadata: { secret: 'hidden', reason: 'test', debugPayload: 'hidden-debug' },
        userAgent: 'hidden-agent',
      },
      {
        id: 'AUD-2',
        createdAt: '2026-05-01T10:00:00.000Z',
        userId: 'U-2',
        userName: 'Менеджер',
        role: 'Менеджер по аренде',
        action: 'documents.create',
        entityType: 'documents',
        entityId: 'D-1',
      },
    ],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/audit-logs?action=payments.update&section=payments&dateFrom=2026-05-02');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.logs.length, 1);
    assert.equal(response.body.logs[0].id, 'AUD-1');
    assert.equal(response.body.logs[0].before.amount, 100);
    assert.equal(response.body.logs[0].before.password, undefined);
    assert.equal(response.body.logs[0].before.internalComment, undefined);
    assert.equal(response.body.logs[0].before.fileUrl, undefined);
    assert.equal(response.body.logs[0].after.token, undefined);
    assert.equal(response.body.logs[0].metadata.debugPayload, undefined);
    assert.equal(response.body.logs[0].userAgent, undefined);
    assert.ok(response.body.filters.actions.includes('payments.update'));
    assert.ok(response.body.filters.sections.includes('payments'));
    assert.doesNotMatch(JSON.stringify(response.body), /hidden|token|secret|password|private\.pdf/i);
  });
});

test('/api/admin/audit-logs is admin-only', async () => {
  const { app } = createSystemApp({
    requireAdmin: (_req, res) => res.status(403).json({ ok: false, error: 'Forbidden' }),
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/audit-logs');
    assert.equal(response.status, 403);
  });
});

test('/api/admin/system-data/export returns safe JSON without passwords or secrets', async () => {
  const collections = {
    equipment: [{ id: 'EQ-1', serialNumber: 'SN-1' }],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'secret', tokenVersion: 7, name: 'Админ' }],
    app_settings: [
      { id: 'S-public', key: 'theme', value: 'dark' },
      { id: 'S-secret', key: 'bot_secret', value: 'do-not-export' },
    ],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
  });

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/admin/system-data/export');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.format, 'rental-management-system-data');
    assert.equal(response.body.collections.equipment.length, 1);
    assert.equal(response.body.collections.users[0].password, undefined);
    assert.equal(response.body.collections.users[0].tokenVersion, undefined);
    assert.equal(response.body.collections.app_settings.length, 1);
    assert.equal(response.body.collections.app_settings[0].key, 'theme');
    assert.doesNotMatch(JSON.stringify(response.body), /secret|do-not-export/i);
  });
});

test('/api/admin/system-data/import dry-run reports counts unknown collections duplicates and conflicts', async () => {
  const collections = {
    equipment: [{ id: 'EQ-1', serialNumber: 'OLD' }],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'existing-password' }],
  };
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
  });

  await withServer(app, async (baseUrl) => {
    const response = await postJson(baseUrl, '/api/admin/system-data/import/dry-run', {
      collections: {
        equipment: [
          { id: 'EQ-1', serialNumber: 'NEW' },
          { id: 'EQ-1', serialNumber: 'DUP' },
        ],
        unknown: [{ id: 'X-1' }],
        users: [{ id: 'U-1', email: 'admin@example.test', password: 'incoming-password' }],
      },
    });

    assert.equal(response.status, 400);
    assert.equal(response.body.ok, false);
    assert.equal(response.body.collections.equipment.incoming, 2);
    assert.deepEqual(response.body.unknownCollections, ['unknown']);
    assert.deepEqual(response.body.duplicateIds.equipment, ['EQ-1']);
    assert.deepEqual(response.body.conflicts.equipment, ['EQ-1', 'EQ-1']);
    assert.equal(response.body.strippedSensitiveFields, 1);
    assert.doesNotMatch(JSON.stringify(response.body), /incoming-password|existing-password/);
  });
});

test('/api/admin/system-data/import requires confirmation and preserves existing user secrets', async () => {
  const collections = {
    equipment: [{ id: 'EQ-1', serialNumber: 'OLD' }],
    users: [{ id: 'U-1', email: 'admin@example.test', password: 'existing-password', tokenVersion: 3 }],
  };
  const writes = [];
  const { app } = createSystemApp({
    readData: name => collections[name] || [],
    writeData: (name, value) => {
      writes.push({ name, value });
      collections[name] = value;
    },
  });

  await withServer(app, async (baseUrl) => {
    const rejected = await postJson(baseUrl, '/api/admin/system-data/import', {
      collections: { equipment: [{ id: 'EQ-2', serialNumber: 'NEW' }] },
    });
    assert.equal(rejected.status, 400);
    assert.equal(writes.length, 0);

    const imported = await postJson(baseUrl, '/api/admin/system-data/import', {
      confirm: true,
      collections: {
        equipment: [{ id: 'EQ-2', serialNumber: 'NEW' }],
        users: [{ id: 'U-1', email: 'restored@example.test', password: 'incoming-password', tokenVersion: 99 }],
      },
    });
    assert.equal(imported.status, 200);
    assert.deepEqual(imported.body.imported, { equipment: 1, users: 1 });
    assert.equal(collections.equipment[0].id, 'EQ-2');
    assert.equal(collections.users[0].email, 'restored@example.test');
    assert.equal(collections.users[0].password, 'existing-password');
    assert.equal(collections.users[0].tokenVersion, 3);
    assert.doesNotMatch(JSON.stringify(imported.body), /incoming-password|existing-password/);
  });
});
