import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { mergeEntityHistory } = require('../server/lib/audit-history.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');

const REQUIRED_PHOTOS = {
  front: ['front.jpg'],
  rear: ['rear.jpg'],
  left: ['left.jpg'],
  right: ['right.jpg'],
  serial_plate: ['plate.jpg'],
  hour_meter: ['hours.jpg'],
  lower_controls: ['lower.jpg'],
  upper_controls: ['upper.jpg'],
  platform: ['platform.jpg'],
  engine_bay: ['engine.jpg'],
  undercarriage: ['wheels.jpg'],
};

const REQUIRED_CHECKLIST = {
  serialNumberConfirmed: true,
  modelConfirmed: true,
  configurationChecked: true,
  documentsReceived: true,
  keysRemoteChargerSpareReceived: 'yes',
  visualDamageFound: false,
  starts: true,
  serviceRequired: false,
  mechanicComment: 'Проверено',
};

function createState() {
  return {
    equipment: [
      {
        id: 'EQ-1',
        manufacturer: 'JLG',
        model: '1932R',
        serialNumber: 'SN-1',
        inventoryNumber: '',
        isForSale: true,
        saleCondition: 'new',
        salePdiStatus: 'not_started',
        saleReceiptStatus: 'planned_arrival',
        plannedArrivalDate: '2026-05-20',
        history: [],
      },
    ],
    service: [],
  };
}

function createCrudApp(state = createState(), user = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' }) {
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });
  const router = registerCrudRoutes({
    collections: ['equipment'],
    idPrefixes: { equipment: 'EQ', service: 'S' },
    readData,
    writeData,
    deleteSessionsForUserIds: () => {},
    requireAuth: (req, _res, next) => {
      req.user = user;
      next();
    },
    requireRead: () => (_req, _res, next) => next(),
    requireWrite: () => (_req, _res, next) => next(),
    sanitizeUser: value => value,
    publicUserView: value => value,
    canReadFullUsers: () => true,
    hashPassword: value => value,
    normalizeServiceWorkRecord: value => value,
    normalizeSparePartRecord: value => value,
    validateRentalPayload: () => ({ ok: true }),
    mergeEntityHistory,
    requireNonEmptyString: () => {},
    generateId: prefix => `${prefix}-${readData(prefix === 'S' ? 'service' : 'equipment').length + 1}`,
    nowIso: () => '2026-05-09T10:00:00.000Z',
    applyServiceTicketCreationEffects: () => {},
    accessControl,
    auditLog: () => {},
    serviceAuditLog: () => {},
    normalizeRecordClientLink: (_collection, item) => item,
    normalizeClientLinks: () => ({ changed: false }),
  });
  app.use('/api', router);
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

async function request(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

test('sales manager creates new sale equipment with planned arrival without turning saleCondition into receipt status', async () => {
  const state = { equipment: [], service: [] };
  const user = { userId: 'U-sales', userName: 'Менеджер', userRole: 'Менеджер по продажам' };
  await withServer(createCrudApp(state, user), async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/equipment', {
      manufacturer: 'Genie',
      model: 'GS-1932',
      serialNumber: 'SN-new',
      isForSale: true,
      saleCondition: 'new',
      saleReceiptStatus: 'planned_arrival',
      plannedArrivalDate: '2026-06-01',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.saleCondition, 'new');
    assert.equal(response.body.saleReceiptStatus, 'planned_arrival');
  });
});

test('PATCH saleReceiptStatus preserves saleCondition and records receipt history', async () => {
  const state = createState();
  await withServer(createCrudApp(state), async baseUrl => {
    const response = await request(baseUrl, 'PATCH', '/api/equipment/EQ-1', {
      saleReceiptStatus: 'arrived_waiting_acceptance',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.saleCondition, 'new');
    assert.equal(response.body.saleReceiptStatus, 'arrived_waiting_acceptance');
    assert.equal(response.body.actualArrivalDate, '2026-05-09');
    assert.equal(response.body.receiptHistory.at(-1).oldStatus, 'planned_arrival');
    assert.equal(response.body.receiptHistory.at(-1).newStatus, 'arrived_waiting_acceptance');
    assert.match(response.body.history.at(-1).text, /статус поступления/);
  });
});

test('mechanic can start acceptance but cannot change sale financial fields', async () => {
  const state = createState();
  state.equipment[0].saleReceiptStatus = 'arrived_waiting_acceptance';
  state.equipment[0].actualArrivalDate = '2026-05-09';
  const mechanic = { userId: 'U-mech', userName: 'Иван Механик', userRole: 'Младший стационарный механик' };
  await withServer(createCrudApp(state, mechanic), async baseUrl => {
    const response = await request(baseUrl, 'PATCH', '/api/equipment/EQ-1', {
      saleReceiptStatus: 'acceptance_in_progress',
      salePrice1: 100,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.saleReceiptStatus, 'acceptance_in_progress');
    assert.equal(response.body.salePrice1, undefined);
  });
});

test('sales manager cannot complete acceptance', async () => {
  const state = createState();
  state.equipment[0].saleReceiptStatus = 'acceptance_in_progress';
  state.equipment[0].actualArrivalDate = '2026-05-09';
  state.equipment[0].acceptanceChecklist = REQUIRED_CHECKLIST;
  state.equipment[0].acceptancePhotos = REQUIRED_PHOTOS;
  const sales = { userId: 'U-sales', userName: 'Менеджер', userRole: 'Менеджер по продажам' };
  await withServer(createCrudApp(state, sales), async baseUrl => {
    const response = await request(baseUrl, 'PATCH', '/api/equipment/EQ-1', {
      saleReceiptStatus: 'accepted',
    });

    assert.equal(response.status, 403);
    assert.match(response.body.error, /Завершить приёмку/);
  });
});

test('acceptance cannot be completed without required photos', async () => {
  const state = createState();
  state.equipment[0].saleReceiptStatus = 'acceptance_in_progress';
  state.equipment[0].actualArrivalDate = '2026-05-09';
  const mechanic = { userId: 'U-mech', userName: 'Иван Механик', userRole: 'Младший стационарный механик' };
  await withServer(createCrudApp(state, mechanic), async baseUrl => {
    const response = await request(baseUrl, 'PATCH', '/api/equipment/EQ-1', {
      saleReceiptStatus: 'accepted',
      acceptanceChecklist: REQUIRED_CHECKLIST,
      acceptancePhotos: { front: ['front.jpg'] },
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /обязательных фото/);
  });
});

test('successful acceptance fills accepted metadata', async () => {
  const state = createState();
  state.equipment[0].saleReceiptStatus = 'acceptance_in_progress';
  state.equipment[0].actualArrivalDate = '2026-05-09';
  const mechanic = { userId: 'U-mech', userName: 'Иван Механик', userRole: 'Младший стационарный механик' };
  await withServer(createCrudApp(state, mechanic), async baseUrl => {
    const response = await request(baseUrl, 'PATCH', '/api/equipment/EQ-1', {
      saleReceiptStatus: 'accepted',
      acceptanceChecklist: REQUIRED_CHECKLIST,
      acceptancePhotos: REQUIRED_PHOTOS,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.saleReceiptStatus, 'accepted');
    assert.equal(response.body.acceptedByUserId, 'U-mech');
    assert.equal(response.body.acceptedByName, 'Иван Механик');
    assert.equal(response.body.acceptedAt, '2026-05-09T10:00:00.000Z');
  });
});

test('acceptance with defects becomes rejected and opens service PDI ticket', async () => {
  const state = createState();
  state.equipment[0].saleReceiptStatus = 'acceptance_in_progress';
  state.equipment[0].actualArrivalDate = '2026-05-09';
  const mechanic = { userId: 'U-mech', userName: 'Иван Механик', userRole: 'Младший стационарный механик' };
  await withServer(createCrudApp(state, mechanic), async baseUrl => {
    const response = await request(baseUrl, 'PATCH', '/api/equipment/EQ-1', {
      saleReceiptStatus: 'acceptance_rejected',
      acceptanceChecklist: { ...REQUIRED_CHECKLIST, visualDamageFound: true, serviceRequired: true },
      acceptancePhotos: { ...REQUIRED_PHOTOS, defects: ['scratch.jpg'] },
      acceptanceDefects: ['Царапина на платформе'],
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.saleReceiptStatus, 'acceptance_rejected');
    assert.equal(state.service.length, 1);
    assert.equal(state.service[0].source, 'sales_receipt');
    assert.equal(state.service[0].equipmentId, 'EQ-1');
  });
});

test('carrier and investor cannot mutate receipt workflow', () => {
  const state = createState();
  const access = createAccessControl({ readData: name => state[name] || [] });

  assert.equal(access.canMutateEntity('equipment', state.equipment[0], { userRole: 'Перевозчик' }), false);
  assert.equal(access.canMutateEntity('equipment', state.equipment[0], { userRole: 'Инвестор' }), false);
});
