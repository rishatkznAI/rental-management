import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { registerSystemRoutes } = require('../server/routes/system.js');

function createState() {
  return {
    equipment: [{ id: 'EQ-1', manufacturer: 'Genie', model: 'Z-45', inventoryNumber: 'INV-1' }],
    rentals: [{ id: 'R-1', equipmentId: 'EQ-1', clientId: 'C-1' }, { id: 'R-bad', equipmentId: 'EQ-missing' }],
    gantt_rentals: [],
    clients: [{ id: 'C-1', name: 'ООО Тест' }],
    payments: [{ id: 'P-1', rentalId: 'R-missing', note: 'undefined' }],
    documents: [{ id: 'D-1', rentalId: 'R-1' }],
    deliveries: [],
    warranty_claims: [{ id: 'WC-1', serviceTicketId: 'S-missing' }],
    repair_work_items: [
      { id: 'RW-1', repairId: 'S-prev', workId: 'SW-1', nameSnapshot: 'Диагностика гидравлики' },
      { id: 'RW-2', repairId: 'S-repeat', workId: 'SW-1', nameSnapshot: 'Диагностика гидравлики' },
    ],
    repair_part_items: [],
    mechanics: [{ id: 'M-1', name: 'Петров' }],
    service: [
      {
        id: 'S-prev',
        equipmentId: 'EQ-1',
        status: 'closed',
        reason: 'Течь гидравлики',
        assignedMechanicId: 'M-1',
        createdAt: '2026-05-01T08:00:00.000Z',
        closedAt: '2026-05-02T08:00:00.000Z',
      },
      {
        id: 'S-repeat',
        equipmentId: 'EQ-1',
        status: 'in_progress',
        priority: 'high',
        reason: 'Течь гидравлики',
        createdAt: '2026-05-05T08:00:00.000Z',
      },
    ],
    app_settings: [{ id: 'AS-1', key: 'safe_setting', value: true }],
    users: [],
  };
}

function createApp({ role = 'Администратор', authenticated = true, writeData = () => {} } = {}) {
  const app = express();
  const state = createState();
  app.use(express.json());
  registerSystemRoutes(app, {
    readData: name => state[name] || [],
    writeData,
    getSnapshot: () => ({}),
    saveSnapshot: () => {},
    botToken: 'configured-but-not-returned',
    getBotUsers: () => ({}),
    sendMessage: async () => ({ ok: true }),
    countActiveSessions: () => 0,
    webhookUrl: '',
    requireAuth: (req, res, next) => {
      if (!authenticated) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      req.user = { userId: 'U-1', userName: 'Admin', userRole: role, email: 'admin@example.test' };
      return next();
    },
    requireAdmin: (req, res, next) => (
      req.user?.userRole === 'Администратор'
        ? next()
        : res.status(403).json({ ok: false, error: 'Forbidden' })
    ),
    getBuildInfo: () => ({
      commit: '74b614626f0c06b157ad166944f506d432c7257e',
      buildTime: '2026-05-22T00:00:00.000Z',
      releaseType: 'frontend-only',
      release: { type: 'frontend-only' },
    }),
    getAppDisabledConfig: () => ({ disabled: false }),
    dbPath: ':memory:',
  });
  return app;
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  try {
    await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function getJson(baseUrl) {
  const response = await fetch(`${baseUrl}/api/admin/system-control-center`, {
    headers: { Authorization: 'Bearer test-token', 'x-frontend-commit': 'frontend-commit' },
  });
  let body = {};
  try {
    body = await response.json();
  } catch {
    body = {};
  }
  return { status: response.status, body };
}

function stringValues(value, result = []) {
  if (typeof value === 'string') result.push(value);
  if (Array.isArray(value)) value.forEach(item => stringValues(item, result));
  if (value && typeof value === 'object') Object.values(value).forEach(item => stringValues(item, result));
  return result;
}

test('admin can access /api/admin/system-control-center', async () => {
  await withServer(createApp(), async baseUrl => {
    const response = await getJson(baseUrl);
    assert.equal(response.status, 200);
    assert.match(response.body.status, /^(ok|warning|risk)$/);
  });
});

test('non-admin gets 403 for /api/admin/system-control-center', async () => {
  await withServer(createApp({ role: 'Менеджер по аренде' }), async baseUrl => {
    const response = await getJson(baseUrl);
    assert.equal(response.status, 403);
  });
});

test('unauthenticated gets 401 for /api/admin/system-control-center', async () => {
  await withServer(createApp({ authenticated: false }), async baseUrl => {
    const response = await getJson(baseUrl);
    assert.equal(response.status, 401);
  });
});

test('system control center response contains expected safe sections', async () => {
  await withServer(createApp({ writeData: () => { throw new Error('must stay read-only'); } }), async baseUrl => {
    const response = await getJson(baseUrl);
    assert.equal(response.status, 200);
    for (const key of ['version', 'runtime', 'storage', 'health', 'dataRisks', 'serviceQuality', 'recommendations']) {
      assert.ok(response.body[key], `${key} section must exist`);
    }
    assert.equal(response.body.storage.dbSafeLabel, 'sqlite');
    assert.equal(typeof response.body.dataRisks.brokenEquipmentLinks, 'number');
    assert.equal(typeof response.body.serviceQuality.totalRepeats, 'number');
    assert.ok(Array.isArray(response.body.recommendations));
  });
});

test('/health and /api/version expose safe release metadata', async () => {
  await withServer(createApp(), async baseUrl => {
    const health = await fetch(`${baseUrl}/health`);
    const healthBody = await health.json();
    assert.equal(health.status, 200);
    assert.equal(healthBody.build.releaseType, 'frontend-only');
    assert.deepEqual(healthBody.build.release, { type: 'frontend-only' });

    const version = await fetch(`${baseUrl}/api/version`);
    const versionBody = await version.json();
    assert.equal(version.status, 200);
    assert.equal(versionBody.build.releaseType, 'frontend-only');
    assert.deepEqual(versionBody.build.release, { type: 'frontend-only' });
  });
});

test('system control center response does not contain secret-like data', async () => {
  const previousSecret = process.env.SYSTEM_CONTROL_TEST_SECRET;
  process.env.SYSTEM_CONTROL_TEST_SECRET = 'do-not-leak-system-control-secret';
  try {
    await withServer(createApp(), async baseUrl => {
      const response = await getJson(baseUrl);
      const serialized = JSON.stringify(response.body);
      assert.doesNotMatch(serialized, /do-not-leak-system-control-secret/i);
      assert.doesNotMatch(serialized, /password|token|secret|cookie|private key|authorization|process\.env|DATABASE_URL/i);
    });
  } finally {
    if (previousSecret === undefined) delete process.env.SYSTEM_CONTROL_TEST_SECRET;
    else process.env.SYSTEM_CONTROL_TEST_SECRET = previousSecret;
  }
});

test('system control center response strings avoid unsafe placeholders', async () => {
  await withServer(createApp(), async baseUrl => {
    const response = await getJson(baseUrl);
    for (const value of stringValues(response.body)) {
      assert.doesNotMatch(value, /^(undefined|null|\[object Object\])$/);
    }
  });
});
