import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { registerRentalRoutes } = require('../server/routes/rentals.js');
const { validateRentalPayload } = require('../server/lib/rental-validation.js');

function createReturnState() {
  return {
    users: [{ id: 'U-admin', name: 'Админ', role: 'Администратор' }],
    equipment: [
      {
        id: 'EQ-1',
        inventoryNumber: 'INV-1',
        serialNumber: 'SN-1',
        manufacturer: 'Sky',
        model: 'Lift',
        type: 'scissor',
        status: 'rented',
        activeInFleet: true,
        category: 'own',
      },
      {
        id: 'EQ-2',
        inventoryNumber: 'INV-2',
        serialNumber: 'SN-2',
        manufacturer: 'Sky',
        model: 'Boom',
        type: 'articulated',
        status: 'rented',
        activeInFleet: true,
        category: 'own',
      },
      {
        id: 'EQ-3',
        inventoryNumber: 'INV-3',
        serialNumber: 'SN-3',
        manufacturer: 'Sky',
        model: 'Legacy',
        type: 'scissor',
        status: 'rented',
        activeInFleet: true,
        category: 'own',
      },
      {
        id: 'EQ-4',
        inventoryNumber: 'INV-4',
        serialNumber: 'SN-4',
        manufacturer: 'Sky',
        model: 'Repair',
        type: 'scissor',
        status: 'in_service',
        activeInFleet: true,
        category: 'own',
      },
    ],
    rentals: [
      {
        id: 'R-1',
        clientId: 'C-1',
        client: 'ООО Чистый возврат',
        contact: 'Иван',
        startDate: '2026-04-20',
        plannedReturnDate: '2026-04-25',
        equipment: ['INV-1'],
        price: 10000,
        discount: 0,
        rate: '1000',
        deliveryAddress: 'Казань',
        manager: 'Админ',
        status: 'active',
      },
      {
        id: 'R-2',
        clientId: 'C-2',
        client: 'ООО Повреждение',
        contact: 'Пётр',
        startDate: '2026-04-20',
        plannedReturnDate: '2026-04-25',
        equipment: ['INV-2'],
        price: 10000,
        discount: 0,
        rate: '1000',
        deliveryAddress: 'Казань',
        manager: 'Админ',
        status: 'active',
      },
      {
        id: 'R-old',
        clientId: 'C-3',
        client: 'ООО Старая аренда',
        contact: 'Мария',
        startDate: '2026-03-01',
        plannedReturnDate: '2026-03-10',
        equipment: ['INV-3'],
        price: 5000,
        discount: 0,
        rate: '1000',
        deliveryAddress: 'Казань',
        manager: 'Админ',
        status: 'active',
      },
      {
        id: 'R-repair',
        clientId: 'C-4',
        client: 'ООО Ремонт',
        contact: 'Олег',
        startDate: '2026-04-20',
        plannedReturnDate: '2026-04-25',
        equipment: ['INV-4'],
        price: 7000,
        discount: 0,
        rate: '1000',
        deliveryAddress: 'Казань',
        manager: 'Админ',
        status: 'active',
      },
    ],
    gantt_rentals: [
      {
        id: 'GR-1',
        rentalId: 'R-1',
        clientId: 'C-1',
        client: 'ООО Чистый возврат',
        equipmentId: 'EQ-1',
        equipmentInv: 'INV-1',
        startDate: '2026-04-20',
        endDate: '2026-04-25',
        manager: 'Админ',
        status: 'active',
        paymentStatus: 'paid',
        amount: 10000,
        comments: [],
      },
      {
        id: 'GR-2',
        rentalId: 'R-2',
        clientId: 'C-2',
        client: 'ООО Повреждение',
        equipmentId: 'EQ-2',
        equipmentInv: 'INV-2',
        startDate: '2026-04-20',
        endDate: '2026-04-25',
        manager: 'Админ',
        status: 'active',
        paymentStatus: 'paid',
        amount: 10000,
        comments: [],
      },
      {
        id: 'GR-repair',
        rentalId: 'R-repair',
        clientId: 'C-4',
        client: 'ООО Ремонт',
        equipmentId: 'EQ-4',
        equipmentInv: 'INV-4',
        startDate: '2026-04-20',
        endDate: '2026-04-25',
        manager: 'Админ',
        status: 'active',
        paymentStatus: 'paid',
        amount: 7000,
        comments: [],
      },
    ],
    service: [
      { id: 'S-open', equipmentId: 'EQ-4', inventoryNumber: 'INV-4', status: 'in_progress', reason: 'Активный ремонт' },
    ],
    documents: [{ id: 'D-1', rentalId: 'R-1', rental: 'R-1', number: 'DOC-1' }],
    payments: [{ id: 'P-1', rentalId: 'R-1', amount: 10000, status: 'paid' }],
  };
}

function createReturnApp(state = createReturnState()) {
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });
  let idCounter = 0;

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (token !== 'admin-token') return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' };
    return next();
  }

  function requireRead() {
    return (_req, _res, next) => next();
  }

  const apiRouter = express.Router();
  apiRouter.use(registerRentalRoutes({
    readData,
    writeData,
    requireAuth,
    requireRead,
    validateRentalPayload,
    mergeRentalHistory: (_previous, next) => next,
    normalizeGanttRentalList: list => list,
    normalizeGanttRentalStatus: item => item,
    generateId: prefix => `${prefix}-${++idCounter}`,
    idPrefixes: { rentals: 'R', gantt_rentals: 'GR', rental_change_requests: 'RCR', service: 'S' },
    accessControl,
    auditLog: () => {},
  }));
  app.use('/api', apiRouter);
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

async function request(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: 'Bearer admin-token',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('return without damage closes rental, returns gantt entry and makes equipment available', async () => {
  const { app, state } = createReturnApp();

  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals/GR-1/return', {
      returnDate: '2026-04-25',
      result: 'available',
    });

    assert.equal(response.status, 200);
    assert.equal(state.rentals.find(item => item.id === 'R-1').status, 'closed');
    assert.equal(state.rentals.find(item => item.id === 'R-1').actualReturnDate, '2026-04-25');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').status, 'returned');
    assert.equal(state.equipment.find(item => item.id === 'EQ-1').status, 'available');
    assert.equal(state.documents[0].rentalId, 'R-1');
    assert.equal(state.payments[0].rentalId, 'R-1');
  });
});

test('return with damage creates service ticket and keeps equipment in service', async () => {
  const { app, state } = createReturnApp();

  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals/GR-2/return', {
      returnDate: '2026-04-25',
      result: 'service',
      hasDamage: true,
      damageDescription: 'Погнута корзина',
    });

    assert.equal(response.status, 200);
    assert.equal(state.rentals.find(item => item.id === 'R-2').status, 'closed');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-2').status, 'returned');
    assert.equal(state.equipment.find(item => item.id === 'EQ-2').status, 'in_service');
    const ticket = state.service.find(item => item.equipmentId === 'EQ-2');
    assert.ok(ticket);
    assert.equal(ticket.status, 'new');
    assert.match(ticket.description, /Погнута корзина/);
    assert.equal(ticket.rentalId, 'R-2');
  });
});

test('return of legacy rental without gantt link is supported', async () => {
  const { app, state } = createReturnApp();

  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals/R-old/return', {
      returnDate: '2026-03-10',
      result: 'available',
    });

    assert.equal(response.status, 200);
    assert.equal(state.rentals.find(item => item.id === 'R-old').status, 'closed');
    assert.equal(state.rentals.find(item => item.id === 'R-old').actualReturnDate, '2026-03-10');
    assert.equal(state.equipment.find(item => item.id === 'EQ-3').status, 'available');
  });
});

test('repeated return is rejected without mutating linked data', async () => {
  const { app, state } = createReturnApp();

  await withServer(app, async baseUrl => {
    assert.equal((await request(baseUrl, 'POST', '/api/rentals/GR-1/return', {
      returnDate: '2026-04-25',
      result: 'available',
    })).status, 200);

    const second = await request(baseUrl, 'POST', '/api/rentals/GR-1/return', {
      returnDate: '2026-04-26',
      result: 'service',
    });

    assert.equal(second.status, 409);
    assert.match(second.body.error, /уже оформлен/i);
    assert.equal(state.rentals.find(item => item.id === 'R-1').actualReturnDate, '2026-04-25');
    assert.equal(state.service.some(item => item.equipmentId === 'EQ-1'), false);
  });
});

test('return without damage does not free equipment with active service repair', async () => {
  const { app, state } = createReturnApp();

  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/rentals/GR-repair/return', {
      returnDate: '2026-04-25',
      result: 'available',
    });

    assert.equal(response.status, 409);
    assert.match(response.body.error, /активная сервисная заявка/i);
    assert.equal(state.rentals.find(item => item.id === 'R-repair').status, 'active');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-repair').status, 'active');
    assert.equal(state.equipment.find(item => item.id === 'EQ-4').status, 'in_service');
  });
});
