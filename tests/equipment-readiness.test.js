import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const {
  buildManagementActionQueue,
  buildFleetReadinessReport,
  calculateEquipmentReadiness,
} = require('../server/lib/equipment-readiness.js');
const { registerEquipmentReadinessRoutes } = require('../server/routes/equipment-readiness.js');

function baseEquipment(extra = {}) {
  return {
    id: 'EQ-1',
    inventoryNumber: 'INV-1',
    serialNumber: 'SN-1',
    manufacturer: 'LGMG',
    model: 'AS1413',
    status: 'available',
    ...extra,
  };
}

test('ready equipment without blockers returns ready', () => {
  const result = calculateEquipmentReadiness(baseEquipment(), {
    equipment: [baseEquipment()],
    rentals: [],
    ganttRentals: [],
    serviceTickets: [],
    deliveries: [],
    documents: [],
    gsmPackets: [],
    shippingPhotos: [],
  });

  assert.equal(result.readinessStatus, 'ready');
  assert.equal(result.readinessLabel, 'Готова к аренде');
  assert.equal(result.estimatedLoss, 0);
  assert.equal(result.lossSeverity, 'none');
  assert.deepEqual(result.blockers, []);
});

test('equipment with open service ticket returns in_service', () => {
  const equipment = baseEquipment({ status: 'in_service' });
  const result = calculateEquipmentReadiness(equipment, {
    equipment: [equipment],
    now: new Date('2026-05-20T12:00:00Z'),
    rentals: [{ id: 'R-old', equipmentId: 'EQ-1', status: 'closed', startDate: '2026-04-01', endDate: '2026-04-05', actualReturnDate: '2026-04-05', rate: '5000 ₽/день' }],
    serviceTickets: [{ id: 'S-1', equipmentId: 'EQ-1', status: 'in_progress', createdAt: '2026-05-18T09:00:00Z' }],
  });

  assert.equal(result.readinessStatus, 'in_service');
  assert.match(result.blockers.join('\n'), /S-1/);
  assert.equal(result.links.serviceTicket, '/service/S-1');
  assert.equal(result.estimatedDailyRate, 5000);
  assert.equal(result.estimatedDailyRateSource, 'latest_rental');
  assert.equal(result.blockedSince, '2026-05-18');
  assert.equal(result.blockedDays, 3);
  assert.equal(result.estimatedLoss, 15000);
  assert.equal(result.responsibleArea, 'service');
});

test('rented equipment returns rented', () => {
  const equipment = baseEquipment();
  const result = calculateEquipmentReadiness(equipment, {
    equipment: [equipment],
    rentals: [{ id: 'R-1', equipmentId: 'EQ-1', status: 'active', rate: '7000 ₽/день', startDate: '2026-05-20', endDate: '2026-05-25' }],
  });

  assert.equal(result.readinessStatus, 'rented');
  assert.equal(result.links.rental, '/rentals/R-1');
  assert.equal(result.estimatedLoss, 0);
  assert.equal(result.lossSeverity, 'none');
});

test('delivery blocked equipment returns delivery_blocked', () => {
  const equipment = baseEquipment();
  const result = calculateEquipmentReadiness(equipment, {
    equipment: [equipment],
    now: new Date('2026-05-20T12:00:00Z'),
    rentals: [{ id: 'R-old', equipmentId: 'EQ-1', status: 'closed', startDate: '2026-04-01', endDate: '2026-04-04', actualReturnDate: '2026-04-04', dailyRate: 8000 }],
    deliveries: [{ id: 'D-1', equipmentId: 'EQ-1', status: 'in_transit', scheduledDate: '2026-05-19' }],
  });

  assert.equal(result.readinessStatus, 'delivery_blocked');
  assert.equal(result.links.delivery, '/deliveries?deliveryId=D-1');
  assert.equal(result.estimatedDailyRate, 8000);
  assert.equal(result.blockedSince, '2026-05-19');
  assert.equal(result.blockedDays, 2);
  assert.equal(result.estimatedLoss, 16000);
  assert.equal(result.responsibleArea, 'logistics');
});

test('blocked equipment without reliable rate returns unavailable source and null loss', () => {
  const equipment = baseEquipment({ status: 'in_service' });
  const result = calculateEquipmentReadiness(equipment, {
    equipment: [equipment],
    now: new Date('2026-05-20T12:00:00Z'),
    serviceTickets: [{ id: 'S-1', equipmentId: 'EQ-1', status: 'new', createdAt: '2026-05-18' }],
  });

  assert.equal(result.readinessStatus, 'in_service');
  assert.equal(result.estimatedDailyRate, null);
  assert.equal(result.estimatedDailyRateSource, 'unavailable');
  assert.equal(result.estimatedLoss, null);
  assert.equal(result.financialRecommendation.includes('Нет ставки'), true);
});

test('conflicting readiness rules choose the higher-risk status', () => {
  const equipment = baseEquipment({ gsmImei: '866123456789012' });
  const result = calculateEquipmentReadiness(equipment, {
    equipment: [equipment],
    serviceTickets: [{ id: 'S-1', equipmentId: 'EQ-1', status: 'in_progress' }],
    deliveries: [{ id: 'D-1', equipmentId: 'EQ-1', status: 'sent' }],
    gsmPackets: [],
  });

  assert.equal(result.readinessStatus, 'delivery_blocked');
  assert.match(result.blockers.join('\n'), /S-1/);
  assert.match(result.blockers.join('\n'), /D-1/);
  assert.match(result.blockers.join('\n'), /GSM/);
});

test('fleet readiness summary counts practical statuses', () => {
  const equipment = [
    baseEquipment({ id: 'EQ-ready', inventoryNumber: 'INV-ready' }),
    baseEquipment({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service' }),
    baseEquipment({ id: 'EQ-rented', inventoryNumber: 'INV-rented' }),
  ];
  const report = buildFleetReadinessReport({
    equipment,
    serviceTickets: [{ id: 'S-1', equipmentId: 'EQ-service', status: 'new' }],
    rentals: [{ id: 'R-1', equipmentId: 'EQ-rented', status: 'active' }],
  });

  assert.equal(report.summary.total, 3);
  assert.equal(report.summary.ready, 1);
  assert.equal(report.summary.inService, 1);
  assert.equal(report.summary.rented, 1);
});

test('fleet readiness summary includes financial loss totals', () => {
  const equipment = [
    baseEquipment({ id: 'EQ-ready', inventoryNumber: 'INV-ready' }),
    baseEquipment({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service' }),
    baseEquipment({ id: 'EQ-delivery', inventoryNumber: 'INV-delivery' }),
    baseEquipment({ id: 'EQ-missing-rate', inventoryNumber: 'INV-missing-rate', model: 'No Rate Model', status: 'in_service' }),
  ];
  const report = buildFleetReadinessReport({
    now: new Date('2026-05-20T12:00:00Z'),
    equipment,
    rentals: [
      { id: 'R-service', equipmentId: 'EQ-service', status: 'closed', startDate: '2026-04-01', endDate: '2026-04-03', actualReturnDate: '2026-04-03', dailyRate: 5000 },
      { id: 'R-delivery', equipmentId: 'EQ-delivery', status: 'closed', startDate: '2026-04-01', endDate: '2026-04-03', actualReturnDate: '2026-04-03', dailyRate: 8000 },
    ],
    serviceTickets: [
      { id: 'S-service', equipmentId: 'EQ-service', status: 'new', createdAt: '2026-05-18' },
      { id: 'S-missing-rate', equipmentId: 'EQ-missing-rate', status: 'new', createdAt: '2026-05-18' },
    ],
    deliveries: [{ id: 'D-delivery', equipmentId: 'EQ-delivery', status: 'sent', scheduledDate: '2026-05-19' }],
  });

  assert.equal(report.summary.loss.totalEstimatedDailyLoss, 13000);
  assert.equal(report.summary.loss.totalEstimatedLoss, 31000);
  assert.equal(report.summary.loss.blockedItemsWithRate, 2);
  assert.equal(report.summary.loss.blockedItemsWithoutRate, 1);
  assert.equal(report.summary.loss.topLossStatus, 'delivery_blocked');
  assert.equal(report.summary.loss.topResponsibleArea, 'logistics');
});

test('management action queue excludes ready and rented equipment', () => {
  const equipment = [
    baseEquipment({ id: 'EQ-ready', inventoryNumber: 'INV-ready' }),
    baseEquipment({ id: 'EQ-rented', inventoryNumber: 'INV-rented' }),
    baseEquipment({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service', dailyRate: 5000 }),
  ];
  const queue = buildManagementActionQueue({
    now: new Date('2026-05-20T12:00:00Z'),
    equipment,
    rentals: [{ id: 'R-1', equipmentId: 'EQ-rented', status: 'active', startDate: '2026-05-20', dailyRate: 7000 }],
    serviceTickets: [{ id: 'S-1', equipmentId: 'EQ-service', status: 'new', createdAt: '2026-05-20' }],
  });

  assert.deepEqual(queue.items.map(item => item.equipmentId), ['EQ-service']);
  assert.equal(JSON.stringify(queue).includes('EQ-ready'), false);
  assert.equal(JSON.stringify(queue).includes('EQ-rented'), false);
});

test('management action queue maps readiness blockers to responsible areas', () => {
  const equipment = [
    baseEquipment({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service', dailyRate: 5000 }),
    baseEquipment({ id: 'EQ-delivery', inventoryNumber: 'INV-delivery', dailyRate: 6000 }),
    baseEquipment({ id: 'EQ-doc', inventoryNumber: 'INV-doc', dailyRate: 7000 }),
  ];
  const queue = buildManagementActionQueue({
    now: new Date('2026-05-20T12:00:00Z'),
    equipment,
    serviceTickets: [{ id: 'S-1', equipmentId: 'EQ-service', status: 'new', createdAt: '2026-05-19' }],
    deliveries: [{ id: 'D-1', equipmentId: 'EQ-delivery', status: 'sent', scheduledDate: '2026-05-19' }],
    documents: [{ id: 'DOC-1', equipmentId: 'EQ-doc', status: 'missing', createdAt: '2026-05-19' }],
  });

  const byEquipment = Object.fromEntries(queue.items.map(item => [item.equipmentId, item]));
  assert.equal(byEquipment['EQ-service'].responsibleArea, 'service');
  assert.equal(byEquipment['EQ-service'].links.serviceTicket, '/service/S-1');
  assert.equal(byEquipment['EQ-delivery'].responsibleArea, 'logistics');
  assert.equal(byEquipment['EQ-delivery'].links.delivery, '/deliveries?deliveryId=D-1');
  assert.equal(byEquipment['EQ-doc'].responsibleArea, 'office');
  assert.equal(byEquipment['EQ-doc'].links.document, '/documents?documentId=DOC-1');
});

test('management action queue priority sorting uses loss, blocked days, and daily loss', () => {
  const equipment = [
    baseEquipment({ id: 'EQ-low', inventoryNumber: 'INV-low', status: 'legacy_hold', dailyRate: 1000 }),
    baseEquipment({ id: 'EQ-critical', inventoryNumber: 'INV-critical', status: 'in_service', dailyRate: 30000 }),
    baseEquipment({ id: 'EQ-high', inventoryNumber: 'INV-high', status: 'in_service', dailyRate: 5000 }),
  ];
  const queue = buildManagementActionQueue({
    now: new Date('2026-05-20T12:00:00Z'),
    equipment,
    serviceTickets: [
      { id: 'S-critical', equipmentId: 'EQ-critical', status: 'new', createdAt: '2026-05-18' },
      { id: 'S-high', equipmentId: 'EQ-high', status: 'new', createdAt: '2026-05-20' },
    ],
  });

  assert.equal(queue.items[0].equipmentId, 'EQ-critical');
  assert.equal(queue.items[0].priority, 'critical');
  assert.equal(queue.items[1].equipmentId, 'EQ-high');
  assert.equal(queue.items[1].priority, 'high');
});

test('management action queue summary totals are correct', () => {
  const equipment = [
    baseEquipment({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service', dailyRate: 5000 }),
    baseEquipment({ id: 'EQ-delivery', inventoryNumber: 'INV-delivery', dailyRate: 8000 }),
    baseEquipment({ id: 'EQ-doc', inventoryNumber: 'INV-doc' }),
  ];
  const queue = buildManagementActionQueue({
    now: new Date('2026-05-20T12:00:00Z'),
    equipment,
    serviceTickets: [{ id: 'S-1', equipmentId: 'EQ-service', status: 'new', createdAt: '2026-05-19' }],
    deliveries: [{ id: 'D-1', equipmentId: 'EQ-delivery', status: 'sent', scheduledDate: '2026-05-19' }],
    documents: [{ id: 'DOC-1', equipmentId: 'EQ-doc', status: 'missing', createdAt: '2026-05-19' }],
  });

  assert.equal(queue.summary.total, 3);
  assert.equal(queue.summary.high, 2);
  assert.equal(queue.summary.medium, 1);
  assert.equal(queue.summary.totalEstimatedLoss, 26000);
  assert.equal(queue.summary.totalDailyLoss, 13000);
  assert.equal(queue.summary.byResponsibleArea.service, 1);
  assert.equal(queue.summary.byResponsibleArea.logistics, 1);
  assert.equal(queue.summary.byResponsibleArea.office, 1);
});

function createApp(stateOverride = {}) {
  const state = {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' },
      { id: 'U-mechanic', name: 'Механик', role: 'Механик', status: 'Активен' },
      { id: 'U-investor', name: 'Инвестор', role: 'Инвестор', status: 'Активен', ownerId: 'OWN-1' },
    ],
    equipment: [baseEquipment({ password: 'hidden', token: 'hidden-token' })],
    rentals: [],
    gantt_rentals: [],
    service: [],
    deliveries: [],
    documents: [],
    gsm_packets: [],
    shipping_photos: [],
    management_action_states: [],
    ...stateOverride,
  };
  const app = express();
  app.use(express.json());
  const readData = collection => state[collection] || [];
  const writeData = (collection, value) => {
    state[collection] = value;
  };
  const accessControl = createAccessControl({ readData });
  const sessions = new Map([
    ['admin-token', 'U-admin'],
    ['mechanic-token', 'U-mechanic'],
    ['investor-token', 'U-investor'],
  ]);
  const readable = new Set(['equipment', 'rentals', 'gantt_rentals', 'service', 'deliveries', 'documents', 'gsm_packets', 'shipping_photos']);

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = state.users.find(item => item.id === sessions.get(token));
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = { userId: user.id, userName: user.name, userRole: user.role, role: user.role, ownerId: user.ownerId || null };
    next();
  }

  function requireRead(collection) {
    return (req, res, next) => {
      if (!readable.has(collection)) return res.status(403).json({ ok: false, error: 'Forbidden' });
      next();
    };
  }

  function canReadCollection(_req, collection) {
    return readable.has(collection);
  }

  app.use('/api', registerEquipmentReadinessRoutes({
    readData,
    writeData,
    requireAuth,
    requireRead,
    canReadCollection,
    accessControl,
    auditLog: () => {},
  }));
  return { app, state };
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

async function getJson(baseUrl, path, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function patchJson(baseUrl, path, body, token) {
  const response = await fetch(`${baseUrl}${path}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('GET /api/equipment/readiness requires auth', async () => {
  await withServer(createApp().app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/equipment/readiness');
    assert.equal(response.status, 401);
  });
});

test('GET /api/equipment/readiness returns summary and does not expose secrets', async () => {
  await withServer(createApp().app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/equipment/readiness', 'admin-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.summary.total, 1);
    assert.equal(response.body.items[0].equipmentId, 'EQ-1');
    const payload = JSON.stringify(response.body);
    assert.equal(payload.includes('hidden-token'), false);
    assert.equal(payload.includes('password'), false);
    assert.equal(payload.includes('token'), false);
  });
});

test('GET /api/management/action-queue requires auth', async () => {
  await withServer(createApp().app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/management/action-queue');
    assert.equal(response.status, 401);
  });
});

test('GET /api/management/action-queue returns prioritized items and does not expose secrets', async () => {
  await withServer(createApp({
    equipment: [
      baseEquipment({ id: 'EQ-ready', inventoryNumber: 'INV-ready', password: 'hidden-password' }),
      baseEquipment({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service', dailyRate: 30000, token: 'hidden-token' }),
      baseEquipment({ id: 'EQ-delivery', inventoryNumber: 'INV-delivery', dailyRate: 8000 }),
    ],
    service: [{ id: 'S-critical', equipmentId: 'EQ-service', status: 'new', createdAt: '2026-05-18' }],
    deliveries: [{ id: 'D-high', equipmentId: 'EQ-delivery', status: 'sent', scheduledDate: '2026-05-20' }],
  }).app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/management/action-queue', 'admin-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.summary.total, 2);
    assert.equal(response.body.items[0].equipmentId, 'EQ-service');
    assert.equal(response.body.items[0].priority, 'critical');
    assert.equal(response.body.items[1].responsibleArea, 'logistics');
    const payload = JSON.stringify(response.body);
    assert.equal(payload.includes('EQ-ready'), false);
    assert.equal(payload.includes('hidden-token'), false);
    assert.equal(payload.includes('hidden-password'), false);
    assert.equal(payload.includes('password'), false);
    assert.equal(payload.includes('token'), false);
  });
});

test('GET /api/management/action-queue includes execution state and overdue flag', async () => {
  const actionId = 'equipment_readiness:EQ-service:in_service';
  await withServer(createApp({
    equipment: [baseEquipment({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service', dailyRate: 30000, ownerId: 'OWN-1' })],
    service: [{ id: 'S-critical', equipmentId: 'EQ-service', status: 'new', createdAt: '2026-05-18' }],
    management_action_states: [{
      id: 'STATE-1',
      actionId,
      sourceType: 'equipment_readiness',
      sourceKey: 'EQ-service',
      equipmentId: 'EQ-service',
      status: 'in_progress',
      assignedToUserId: 'U-mechanic',
      assignedToName: 'Механик',
      dueDate: '2020-01-01',
      comment: 'Взято в работу',
      updatedByUserId: 'U-admin',
      updatedAt: '2026-05-20T12:00:00.000Z',
      createdAt: '2026-05-20T12:00:00.000Z',
    }],
  }).app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/management/action-queue', 'admin-token');
    assert.equal(response.status, 200);
    const item = response.body.items[0];
    assert.equal(item.actionId, actionId);
    assert.equal(item.executionStatus, 'in_progress');
    assert.equal(item.assignedToUserId, 'U-mechanic');
    assert.equal(item.assignedToName, 'Механик');
    assert.equal(item.dueDate, '2020-01-01');
    assert.equal(item.executionComment, 'Взято в работу');
    assert.equal(item.executionOverdue, true);
    const payload = JSON.stringify(response.body);
    assert.equal(payload.includes('updatedByUserId'), false);
    assert.equal(payload.includes('password'), false);
    assert.equal(payload.includes('token'), false);
  });
});

test('PATCH /api/management/action-queue/:actionId/state updates action state', async () => {
  const created = createApp({
    equipment: [baseEquipment({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service', dailyRate: 30000 })],
    service: [{ id: 'S-critical', equipmentId: 'EQ-service', status: 'new', createdAt: '2026-05-18' }],
  });
  const actionId = 'equipment_readiness:EQ-service:in_service';
  await withServer(created.app, async (baseUrl) => {
    const response = await patchJson(baseUrl, `/api/management/action-queue/${encodeURIComponent(actionId)}/state`, {
      status: 'postponed',
      assignedToUserId: 'U-mechanic',
      dueDate: '2026-05-30',
      comment: 'Ждем запчасть',
    }, 'admin-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.state.executionStatus, 'postponed');
    assert.equal(response.body.state.assignedToName, 'Механик');
  });
  assert.equal(created.state.management_action_states.length, 1);
  assert.equal(created.state.management_action_states[0].status, 'postponed');
  assert.equal(created.state.management_action_states[0].comment, 'Ждем запчасть');
});

test('PATCH /api/management/action-queue/:actionId/state validates status and auth', async () => {
  const actionId = 'equipment_readiness:EQ-service:in_service';
  await withServer(createApp({
    equipment: [baseEquipment({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service', dailyRate: 30000, ownerId: 'OWN-1' })],
    service: [{ id: 'S-critical', equipmentId: 'EQ-service', status: 'new', createdAt: '2026-05-18' }],
  }).app, async (baseUrl) => {
    const unauthenticated = await patchJson(baseUrl, `/api/management/action-queue/${encodeURIComponent(actionId)}/state`, {
      status: 'resolved',
    });
    assert.equal(unauthenticated.status, 401);

    const invalid = await patchJson(baseUrl, `/api/management/action-queue/${encodeURIComponent(actionId)}/state`, {
      status: 'done',
    }, 'admin-token');
    assert.equal(invalid.status, 400);

    const badDate = await patchJson(baseUrl, `/api/management/action-queue/${encodeURIComponent(actionId)}/state`, {
      status: 'resolved',
      dueDate: '2026-02-31',
    }, 'admin-token');
    assert.equal(badDate.status, 400);
  });
});

test('PATCH /api/management/action-queue/:actionId/state denies roles outside action scope', async () => {
  const actionId = 'equipment_readiness:EQ-service:in_service';
  await withServer(createApp({
    equipment: [baseEquipment({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service', dailyRate: 30000, ownerId: 'OWN-1' })],
    service: [{ id: 'S-critical', equipmentId: 'EQ-service', status: 'new', createdAt: '2026-05-18' }],
  }).app, async (baseUrl) => {
    const response = await patchJson(baseUrl, `/api/management/action-queue/${encodeURIComponent(actionId)}/state`, {
      status: 'resolved',
    }, 'investor-token');
    assert.equal(response.status, 403);
  });
});

test('management action state persists across generated queue recalculation', async () => {
  const created = createApp({
    equipment: [baseEquipment({ id: 'EQ-service', inventoryNumber: 'INV-service', status: 'in_service', dailyRate: 30000 })],
    service: [{ id: 'S-critical', equipmentId: 'EQ-service', status: 'new', createdAt: '2026-05-18' }],
  });
  const actionId = 'equipment_readiness:EQ-service:in_service';
  await withServer(created.app, async (baseUrl) => {
    const patch = await patchJson(baseUrl, `/api/management/action-queue/${encodeURIComponent(actionId)}/state`, {
      status: 'in_progress',
      dueDate: '2026-05-30',
      comment: 'Назначено',
    }, 'admin-token');
    assert.equal(patch.status, 200);

    created.state.rentals.push({ id: 'R-history', equipmentId: 'EQ-service', status: 'closed', dailyRate: 5000, startDate: '2026-04-01', endDate: '2026-04-02' });

    const get = await getJson(baseUrl, '/api/management/action-queue', 'admin-token');
    assert.equal(get.status, 200);
    const item = get.body.items.find(row => row.actionId === actionId);
    assert.equal(item.executionStatus, 'in_progress');
    assert.equal(item.executionComment, 'Назначено');
  });
});

test('GET /api/equipment/readiness calculates blockers even when related collections are not directly readable', async () => {
  const state = {
    users: [{ id: 'U-mechanic', name: 'Механик', role: 'Механик', status: 'Активен' }],
    equipment: [baseEquipment()],
    rentals: [{ id: 'R-1', equipmentId: 'EQ-1', status: 'active' }],
    gantt_rentals: [],
    service: [],
    deliveries: [],
    documents: [],
    gsm_packets: [],
    shipping_photos: [],
  };
  const app = express();
  app.use(express.json());
  const readData = collection => state[collection] || [];
  const accessControl = createAccessControl({ readData });

  function requireAuth(req, _res, next) {
    req.user = { userId: 'U-mechanic', userName: 'Механик', userRole: 'Механик', role: 'Механик' };
    next();
  }
  function requireRead(collection) {
    return (_req, res, next) => collection === 'equipment' ? next() : res.status(403).json({ ok: false, error: 'Forbidden' });
  }
  function canReadCollection(_req, collection) {
    return collection === 'equipment';
  }
  app.use('/api', registerEquipmentReadinessRoutes({
    readData,
    requireAuth,
    requireRead,
    canReadCollection,
    accessControl,
  }));

  await withServer(app, async (baseUrl) => {
    const response = await getJson(baseUrl, '/api/equipment/readiness', 'mechanic-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.items[0].readinessStatus, 'rented');
    assert.equal(JSON.stringify(response.body).includes('R-1'), true);
  });
});
