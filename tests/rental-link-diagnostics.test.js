import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { buildRentalLinkDiagnostics } = require('../server/lib/rental-link-diagnostics.js');
const { registerSystemRoutes } = require('../server/routes/system.js');

function baseEquipment() {
  return [
    { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', model: 'Genie S-65', status: 'available', owner: 'Skytech', category: 'own' },
    { id: 'EQ-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2', model: 'JLG 450AJ', status: 'available', owner: 'Skytech', category: 'own' },
  ];
}

function cleanRental(overrides = {}) {
  return {
    id: 'R-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    equipmentId: 'EQ-1',
    equipmentInv: 'INV-1',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-10',
    status: 'active',
    ...overrides,
  };
}

function cleanGantt(overrides = {}) {
  return {
    id: 'GR-1',
    rentalId: 'R-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    equipmentId: 'EQ-1',
    inventoryNumber: 'INV-1',
    startDate: '2026-05-01',
    endDate: '2026-05-10',
    status: 'active',
    ...overrides,
  };
}

test('rental link diagnostics ignores clean linked data', () => {
  const diagnostics = buildRentalLinkDiagnostics({
    equipment: baseEquipment(),
    rentals: [cleanRental()],
    ganttRentals: [cleanGantt()],
  });

  assert.equal(diagnostics.summary.rentalsWithoutEquipment, 0);
  assert.equal(diagnostics.summary.rentalsLegacyOnlyEquipment, 0);
  assert.equal(diagnostics.summary.ganttWithoutRentalId, 0);
  assert.equal(diagnostics.summary.ganttEquipmentMismatch, 0);
  assert.equal(diagnostics.summary.duplicateInventoryNumbers, 0);
  assert.equal(diagnostics.summary.unsafeRecords, 0);
});

test('rental link diagnostics reports rentals without equipment', () => {
  const diagnostics = buildRentalLinkDiagnostics({
    equipment: baseEquipment(),
    rentals: [cleanRental({ id: 'R-empty', equipmentId: '', equipmentInv: '', inventoryNumber: '', serialNumber: '', equipment: [] })],
    ganttRentals: [],
  });

  assert.equal(diagnostics.summary.rentalsWithoutEquipment, 1);
  assert.equal(diagnostics.rentalsWithoutEquipment[0].rentalId, 'R-empty');
  assert.equal(diagnostics.rentalsWithoutEquipment[0].reason, 'equipment_unresolved');
});

test('rental link diagnostics reports rentals using only legacy equipment field', () => {
  const diagnostics = buildRentalLinkDiagnostics({
    equipment: baseEquipment(),
    rentals: [cleanRental({ id: 'R-legacy', equipmentId: '', equipmentInv: '', inventoryNumber: '', serialNumber: '', equipment: ['INV-1'] })],
    ganttRentals: [],
  });

  assert.equal(diagnostics.summary.rentalsLegacyOnlyEquipment, 1);
  assert.equal(diagnostics.rentalsLegacyOnlyEquipment[0].legacyOnly, true);
  assert.equal(diagnostics.rentalsLegacyOnlyEquipment[0].equipment.id, 'EQ-1');
});

test('rental link diagnostics reports gantt entries without rentalId and multiple unsafe candidates', () => {
  const rentals = [
    cleanRental({ id: 'R-1' }),
    cleanRental({ id: 'R-2' }),
  ];
  const diagnostics = buildRentalLinkDiagnostics({
    equipment: baseEquipment(),
    rentals,
    ganttRentals: [cleanGantt({ id: 'GR-missing', rentalId: '' })],
  });

  assert.equal(diagnostics.summary.ganttWithoutRentalId, 1);
  assert.equal(diagnostics.ganttWithoutRentalId[0].reason, 'multipleCandidates');
  assert.equal(diagnostics.ganttWithoutRentalId[0].candidateCount, 2);
  assert.equal(diagnostics.summary.unsafeRecords, 1);
});

test('rental link diagnostics reports gantt entries with broken rentalId', () => {
  const diagnostics = buildRentalLinkDiagnostics({
    equipment: baseEquipment(),
    rentals: [cleanRental()],
    ganttRentals: [cleanGantt({ id: 'GR-broken', rentalId: 'R-missing' })],
  });

  assert.equal(diagnostics.summary.ganttWithoutRentalId, 1);
  assert.equal(diagnostics.ganttWithoutRentalId[0].reason, 'brokenRentalId');
  assert.equal(diagnostics.ganttWithoutRentalId[0].rentalId, 'R-missing');
});

test('rental link diagnostics reports equipment mismatch between gantt and linked rental', () => {
  const diagnostics = buildRentalLinkDiagnostics({
    equipment: baseEquipment(),
    rentals: [cleanRental()],
    ganttRentals: [cleanGantt({ id: 'GR-mismatch', equipmentId: 'EQ-2', inventoryNumber: 'INV-2' })],
  });

  assert.equal(diagnostics.summary.ganttEquipmentMismatch, 1);
  assert.equal(diagnostics.ganttEquipmentMismatch[0].ganttId, 'GR-mismatch');
  assert.equal(diagnostics.ganttEquipmentMismatch[0].rentalId, 'R-1');
  assert.equal(diagnostics.ganttEquipmentMismatch[0].ganttEquipment.id, 'EQ-2');
  assert.equal(diagnostics.ganttEquipmentMismatch[0].rentalEquipment.id, 'EQ-1');
});

test('rental link diagnostics reports duplicate inventory numbers with normalized values', () => {
  const diagnostics = buildRentalLinkDiagnostics({
    equipment: [
      ...baseEquipment(),
      { id: 'EQ-3', equipmentInv: ' INV-2 ', serialNumber: 'SN-3', model: 'Duplicate', status: 'available' },
    ],
    rentals: [],
    ganttRentals: [],
  });

  assert.equal(diagnostics.summary.duplicateInventoryNumbers, 1);
  assert.equal(diagnostics.duplicateInventoryNumbers[0].inventoryNumber, 'INV-2');
  assert.deepEqual(diagnostics.duplicateInventoryNumbers[0].equipmentIds, ['EQ-2', 'EQ-3']);
});

test('rental link diagnostics marks rental identifier conflicts as unsafe', () => {
  const diagnostics = buildRentalLinkDiagnostics({
    equipment: baseEquipment(),
    rentals: [cleanRental({ id: 'R-conflict', equipmentId: 'EQ-1', inventoryNumber: 'INV-2' })],
    ganttRentals: [],
  });

  assert.equal(diagnostics.summary.rentalsWithoutEquipment, 1);
  assert.equal(diagnostics.rentalsWithoutEquipment[0].reason, 'equipment_ambiguous');
  assert.equal(diagnostics.summary.unsafeRecords, 2);
  assert.ok(diagnostics.unsafeRecords.some(item => item.reason === 'equipment_identifier_conflict'));
});

function createSystemApp({ state, requireAuth, requireAdmin } = {}) {
  const app = express();
  app.use(express.json());
  registerSystemRoutes(app, {
    readData: collection => state?.[collection] || [],
    writeData: () => {},
    getSnapshot: () => ({}),
    saveSnapshot: () => {},
    botToken: 'token',
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
    jsonCollections: ['equipment', 'rentals', 'gantt_rentals'],
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

async function getJson(baseUrl, path, token = '') {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const body = await response.json();
  return { status: response.status, body };
}

test('rental link diagnostics endpoint requires authorization and admin role', async () => {
  const users = {
    'admin-token': { userId: 'U-admin', userRole: 'Администратор' },
    'manager-token': { userId: 'U-manager', userRole: 'Менеджер по аренде' },
  };
  const app = createSystemApp({
    state: { equipment: baseEquipment(), rentals: [cleanRental()], gantt_rentals: [cleanGantt()] },
    requireAuth: (req, res, next) => {
      const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
      const user = users[token];
      if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
      req.user = user;
      return next();
    },
    requireAdmin: (req, res, next) => {
      if (req.user?.userRole !== 'Администратор') return res.status(403).json({ ok: false, error: 'Forbidden: admin only' });
      return next();
    },
  });

  await withServer(app, async baseUrl => {
    assert.equal((await getJson(baseUrl, '/api/admin/rental-link-diagnostics')).status, 401);
    assert.equal((await getJson(baseUrl, '/api/admin/rental-link-diagnostics', 'manager-token')).status, 403);
    const admin = await getJson(baseUrl, '/api/admin/rental-link-diagnostics', 'admin-token');
    assert.equal(admin.status, 200);
    assert.equal(admin.body.summary.rentalsTotal, 1);
    assert.deepEqual(Object.keys(admin.body).sort(), [
      'duplicateInventoryNumbers',
      'ganttEquipmentMismatch',
      'ganttWithoutRentalId',
      'rentalsLegacyOnlyEquipment',
      'rentalsWithoutEquipment',
      'summary',
      'unsafeRecords',
    ].sort());
  });
});
