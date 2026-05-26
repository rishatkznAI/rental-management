import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { buildDataIntegrityDiagnostics } = require('../server/lib/data-integrity-diagnostics.js');
const { registerSystemRoutes } = require('../server/routes/system.js');

function baseState() {
  return {
    equipment: [
      { id: 'EQ-rented', inventoryNumber: 'R-1', model: 'Rented lift', status: 'rented' },
      { id: 'EQ-active', inventoryNumber: 'A-1', model: 'Available but rented', status: 'available' },
    ],
    rentals: [
      { id: 'R-active', equipmentId: 'EQ-active', startDate: '2026-05-01', plannedReturnDate: '2026-05-30', status: 'active', amount: 1000 },
    ],
    gantt_rentals: [
      { id: 'GR-1', rentalId: 'R-active', equipmentId: 'EQ-active', startDate: '2026-05-01', endDate: '2026-05-30', status: 'active', amount: 1000 },
      { id: 'GR-2', rentalId: 'R-active', equipmentId: 'EQ-active', startDate: '2026-05-02', endDate: '2026-05-29', status: 'active', amount: 1000 },
    ],
    clients: [{ id: 'C-1', name: 'Client' }],
    service: [],
    deliveries: [
      { id: 'DL-stale', rentalId: 'R-active', equipmentId: 'EQ-active', carrierId: 'CAR-1', date: '2026-05-01', status: 'sent' },
    ],
    delivery_carriers: [{ id: 'CAR-1', name: 'Carrier', status: 'active' }],
    payments: [{ id: 'P-1', amount: 1000, paidAmount: 1000, status: 'paid' }],
    payment_allocations: [{ id: 'PA-broken', paymentId: 'P-1', rentalId: 'R-missing', amount: 100 }],
    documents: [],
    users: [
      { id: 'U-admin', email: 'admin@example.com', role: 'Администратор', passwordHash: 'hash-secret-value', token: 'token-secret-value' },
      { id: 'U-manager', email: 'manager@example.com', role: 'Менеджер по аренде', passwordHash: 'manager-secret-value' },
    ],
    owners: [],
    mechanics: [],
    bot_users: [],
    bot_sessions: [],
    bot_activity: [],
    repair_work_items: [],
    repair_part_items: [],
    service_work_names: [],
    service_work_catalog: [],
    spare_part_names: [],
    spare_parts: [],
    app_settings: [{ id: 'settings', webhookSecret: 'raw-secret-value' }],
  };
}

function createApp({ state = baseState(), requireAuth, requireAdmin } = {}) {
  const app = express();
  app.use(express.json());
  registerSystemRoutes(app, {
    readData: collection => state[collection] || [],
    writeData: () => {
      throw new Error('diagnostics endpoint must not write');
    },
    getSnapshot: () => ({}),
    saveSnapshot: () => {},
    botToken: 'test-bot-token',
    getBotUsers: () => ({}),
    sendMessage: async () => ({ ok: true }),
    countActiveSessions: () => 0,
    webhookUrl: '',
    requireAuth,
    requireAdmin,
    fetchImpl: fetch,
    auditLog: () => {},
    getBuildInfo: () => ({ version: 'test' }),
    getRoleAccessSummary: () => ({ readableCollections: [], writableCollections: [] }),
    jsonCollections: Object.keys(state),
    dbPath: ':memory:',
    assertPublicHttpUrlImpl: async value => new URL(value),
  });
  return app;
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

async function getJson(baseUrl, token = '') {
  const response = await fetch(`${baseUrl}/api/admin/data-integrity-diagnostics`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json();
  return { status: response.status, body, text: JSON.stringify(body) };
}

test('data integrity diagnostics endpoint requires auth', async () => {
  const app = createApp({
    requireAuth: (_req, res) => res.status(401).json({ ok: false, error: 'Unauthorized' }),
    requireAdmin: (_req, _res, next) => next(),
  });

  await withServer(app, async baseUrl => {
    const response = await getJson(baseUrl);
    assert.equal(response.status, 401);
  });
});

test('data integrity diagnostics endpoint requires admin', async () => {
  const app = createApp({
    requireAuth: (req, _res, next) => {
      req.user = { id: 'U-manager', role: 'Менеджер по аренде' };
      next();
    },
    requireAdmin: (_req, res) => res.status(403).json({ ok: false, error: 'Forbidden' }),
  });

  await withServer(app, async baseUrl => {
    const response = await getJson(baseUrl, 'manager-token');
    assert.equal(response.status, 403);
  });
});

test('admin gets safe data integrity summary', async () => {
  const app = createApp({
    requireAuth: (req, _res, next) => {
      req.user = { id: 'U-admin', role: 'Администратор' };
      next();
    },
    requireAdmin: (_req, _res, next) => next(),
  });

  await withServer(app, async baseUrl => {
    const response = await getJson(baseUrl, 'admin-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'ok');
    assert.equal(response.body.counts.equipment, 2);
    assert.equal(response.body.counts.rentals, 1);
    assert.deepEqual(Object.keys(response.body.summary).sort(), ['blocker', 'high', 'low', 'medium']);
    assert.deepEqual(Object.keys(response.body.domains).sort(), [
      'delivery',
      'documents',
      'equipment',
      'finance',
      'references',
      'rentalsGantt',
      'service',
      'usersBot',
    ]);
  });
});

test('diagnostics detects equipment rented without active rental', () => {
  const diagnostics = buildDataIntegrityDiagnostics(baseState(), { today: '2026-05-26' });
  const issue = diagnostics.domains.equipment.issues.find(item => item.code === 'equipment_rented_without_active_rental');
  assert.equal(issue.count, 1);
  assert.equal(issue.examples[0].id, 'EQ-rented');
});

test('diagnostics detects available equipment with active rental', () => {
  const diagnostics = buildDataIntegrityDiagnostics(baseState(), { today: '2026-05-26' });
  const issue = diagnostics.domains.equipment.issues.find(item => item.code === 'equipment_available_with_active_rental');
  assert.equal(issue.count, 1);
  assert.equal(issue.severity, 'BLOCKER');
  assert.equal(issue.examples[0].id, 'EQ-active');
});

test('diagnostics detects duplicate gantt rows', () => {
  const diagnostics = buildDataIntegrityDiagnostics(baseState(), { today: '2026-05-26' });
  const issue = diagnostics.domains.rentalsGantt.issues.find(item => item.code === 'duplicate_gantt_rows_per_rental');
  assert.equal(issue.count, 2);
  assert.equal(issue.examples[0].relatedId, 'R-active');
});

test('diagnostics detects broken payment allocation', () => {
  const diagnostics = buildDataIntegrityDiagnostics(baseState(), { today: '2026-05-26' });
  const issue = diagnostics.domains.finance.issues.find(item => item.code === 'allocation_missing_related_entity');
  assert.equal(issue.count, 1);
  assert.equal(issue.examples[0].id, 'PA-broken');
});

test('diagnostics detects stale delivery', () => {
  const diagnostics = buildDataIntegrityDiagnostics(baseState(), { today: '2026-05-26' });
  const issue = diagnostics.domains.delivery.issues.find(item => item.code === 'stale_active_delivery');
  assert.equal(issue.count, 1);
  assert.equal(issue.examples[0].id, 'DL-stale');
});

test('diagnostics response does not include passwordHash token or secret fields', async () => {
  const app = createApp({
    requireAuth: (req, _res, next) => {
      req.user = { id: 'U-admin', role: 'Администратор' };
      next();
    },
    requireAdmin: (_req, _res, next) => next(),
  });

  await withServer(app, async baseUrl => {
    const response = await getJson(baseUrl, 'admin-token');
    assert.equal(response.status, 200);
    assert.doesNotMatch(response.text, /passwordHash/i);
    assert.doesNotMatch(response.text, /token-secret-value/i);
    assert.doesNotMatch(response.text, /raw-secret-value/i);
    assert.doesNotMatch(response.text, /webhookSecret/i);
  });
});

test('diagnostics examples are limited to 20 per issue', () => {
  const state = baseState();
  state.equipment = Array.from({ length: 25 }, (_, index) => ({
    id: `EQ-rented-${index}`,
    inventoryNumber: `INV-${index}`,
    status: 'rented',
  }));
  state.rentals = [];
  state.gantt_rentals = [];

  const diagnostics = buildDataIntegrityDiagnostics(state, { today: '2026-05-26' });
  const issue = diagnostics.domains.equipment.issues.find(item => item.code === 'equipment_rented_without_active_rental');
  assert.equal(issue.count, 25);
  assert.equal(issue.examples.length, 20);
});

test('diagnostics does not mutate data', () => {
  const state = baseState();
  const before = JSON.stringify(state);
  buildDataIntegrityDiagnostics(state, { today: '2026-05-26' });
  assert.equal(JSON.stringify(state), before);
});
