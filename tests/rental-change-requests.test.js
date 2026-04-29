import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const {
  analyzeGanttRentalLinks,
  backfillGanttRentalLinks,
  classifyRentalFieldChange,
  resolveRentalForChangeRequest,
  splitRentalPatch,
} = require('../server/lib/rental-change-requests.js');
const { createAccessControl } = require('../server/lib/access-control.js');
const { registerRentalRoutes } = require('../server/routes/rentals.js');
const { registerRentalChangeRequestRoutes } = require('../server/routes/rental-change-requests.js');
const { validateRentalPayload } = require('../server/lib/rental-validation.js');

const rental = {
  id: 'R-1',
  client: 'ЭМ-СТРОЙ',
  contact: 'Иван',
  startDate: '2026-04-10',
  plannedReturnDate: '2026-04-20',
  equipment: ['083'],
  rate: '5000 ₽/день',
  price: 100000,
  discount: 0,
  deliveryAddress: 'Казань',
  manager: 'Руслан',
  status: 'active',
  comments: '',
};

test('classifyRentalFieldChange applies conflict-free extension immediately', () => {
  const result = classifyRentalFieldChange({
    previousRental: rental,
    field: 'plannedReturnDate',
    newValue: '2026-04-25',
    today: '2026-04-12',
  });

  assert.equal(result.mode, 'immediate');
  assert.equal(result.type, 'Продление аренды');
});

test('classifyRentalFieldChange sends shortening to approval', () => {
  const result = classifyRentalFieldChange({
    previousRental: rental,
    field: 'plannedReturnDate',
    newValue: '2026-04-18',
    today: '2026-04-12',
  });

  assert.equal(result.mode, 'approval');
  assert.equal(result.type, 'Сокращение аренды');
});

test('classifyRentalFieldChange sends active rental clientId changes to approval', () => {
  const result = classifyRentalFieldChange({
    previousRental: { ...rental, clientId: 'C-1' },
    field: 'clientId',
    newValue: 'C-2',
    today: '2026-04-12',
  });

  assert.equal(result.mode, 'approval');
  assert.equal(result.type, 'Изменение клиента в активной аренде');
});

test('splitRentalPatch separates immediate comments from protected price change', () => {
  const result = splitRentalPatch({
    previousRental: rental,
    patch: {
      comments: 'Клиент просит продлить',
      price: 120000,
    },
    payments: [],
    today: '2026-04-12',
  });

  assert.deepEqual(result.immediatePatch, { comments: 'Клиент просит продлить' });
  assert.equal(result.approvalChanges.length, 1);
  assert.equal(result.approvalChanges[0].field, 'price');
});

test('splitRentalPatch sends closing with debt to approval', () => {
  const result = splitRentalPatch({
    previousRental: rental,
    patch: { status: 'closed' },
    payments: [{ id: 'P-1', rentalId: 'R-1', amount: 100000, paidAmount: 20000, status: 'partial' }],
    today: '2026-04-12',
  });

  assert.deepEqual(result.immediatePatch, {});
  assert.equal(result.approvalChanges.length, 1);
  assert.equal(result.approvalChanges[0].type, 'Закрытие аренды с долгом');
});

test('resolveRentalForChangeRequest accepts numeric and string rental ids', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 101,
    rentals: [{ ...rental, id: '101' }],
    ganttRentals: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.rental.id, '101');
});

test('resolveRentalForChangeRequest finds classic rental through gantt_rentals link', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-101',
    rentals: [{ ...rental, id: 'R-101' }],
    ganttRentals: [{
      id: 'GR-101',
      rentalId: 'R-101',
      client: rental.client,
      startDate: rental.startDate,
      endDate: rental.plannedReturnDate,
      equipmentInv: '083',
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.rental.id, 'R-101');
  assert.equal(result.linkedGanttRentalId, 'GR-101');
});

test('resolveRentalForChangeRequest finds classic rental by linkedGanttRentalId when route id is a GR id', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-102',
    linkedGanttRentalId: 'GR-102',
    rentals: [{ ...rental, id: 'R-102' }],
    ganttRentals: [{
      id: 'GR-102',
      rentalId: 'R-102',
      client: rental.client,
      startDate: rental.startDate,
      endDate: rental.plannedReturnDate,
      equipmentInv: '083',
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.rentalId, 'R-102');
  assert.equal(result.linkedGanttRentalId, 'GR-102');
});

test('resolveRentalForChangeRequest returns useful errors for missing and unknown ids', () => {
  const missing = resolveRentalForChangeRequest({ rentalId: 'undefined', rentals: [], ganttRentals: [] });
  assert.equal(missing.ok, false);
  assert.equal(missing.status, 400);
  assert.match(missing.error, /rentalId/);

  const unknown = resolveRentalForChangeRequest({ rentalId: 'R-404', rentals: [], ganttRentals: [] });
  assert.equal(unknown.ok, false);
  assert.equal(unknown.status, 404);
  assert.match(unknown.error, /R-404/);
  assert.deepEqual(unknown.details.searchedCollections.slice(0, 2), ['rentals.id', 'gantt_rentals.id']);
  assert.equal(unknown.details.foundGanttById, 0);
  assert.equal(unknown.details.fallbackCandidateCount, 0);
});

test('resolveRentalForChangeRequest reports when a GR id is not present in gantt_rentals', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-missing',
    linkedGanttRentalId: 'GR-missing',
    rentals: [{ ...rental, id: 'R-1' }],
    ganttRentals: [],
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 404);
  assert.match(result.error, /gantt_rentals\.id/);
  assert.equal(result.details.foundRentalById, 0);
  assert.equal(result.details.foundGanttById, 0);
  assert.deepEqual(result.details.searchedIds, ['GR-missing']);
});

test('resolveRentalForChangeRequest can recover a virtual GR id from a safe Gantt snapshot', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-virtual',
    linkedGanttRentalId: 'GR-virtual',
    fallbackGanttRental: {
      id: 'GR-virtual',
      client: rental.client,
      startDate: rental.startDate,
      endDate: rental.plannedReturnDate,
      equipmentInv: '083',
    },
    rentals: [{ ...rental, id: 'R-1' }],
    ganttRentals: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.rentalId, 'R-1');
  assert.equal(result.linkedGanttRentalId, 'GR-virtual');
});

test('resolveRentalForChangeRequest recovers stale GR by equipmentId and inventory aliases', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-1776254974522',
    linkedGanttRentalId: 'GR-1776254974522',
    fallbackGanttRental: {
      id: 'GR-1776254974522',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      equipmentId: 'EQ-032',
      equipmentInv: '03291436',
    },
    rentals: [{
      id: 'R-032',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-10',
      plannedReturnDate: '2026-04-20',
      equipment: ['03291436'],
    }],
    ganttRentals: [],
    equipment: [{
      id: 'EQ-032',
      inventoryNumber: '03291436',
      serialNumber: 'SN-032',
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.rentalId, 'R-032');
  assert.equal(result.sourceRentalId, 'GR-1776254974522');
});

test('resolveRentalForChangeRequest recovers stale GR when client snapshot differs but equipment and dates are unique', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-1776254974522',
    linkedGanttRentalId: 'GR-1776254974522',
    fallbackGanttRental: {
      id: 'GR-1776254974522',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      equipmentInv: '03291436',
    },
    rentals: [{
      id: 'R-032',
      client: 'ООО Стройтрест-Алабуга',
      startDate: '2026-04-10',
      plannedReturnDate: '2026-04-20',
      equipment: ['03291436'],
    }],
    ganttRentals: [],
    equipment: [{
      id: 'EQ-032',
      inventoryNumber: '03291436',
      serialNumber: 'SN-032',
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.rentalId, 'R-032');
});

test('resolveRentalForChangeRequest recovers moved start date when client snapshot differs and period overlaps', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-1776254974522',
    linkedGanttRentalId: 'GR-1776254974522',
    fallbackGanttRental: {
      id: 'GR-1776254974522',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-07',
      endDate: '2026-04-20',
      equipmentInv: '03291436',
    },
    rentals: [{
      id: 'R-032',
      client: 'ООО Стройтрест-Алабуга',
      startDate: '2026-04-10',
      plannedReturnDate: '2026-04-20',
      equipment: ['03291436'],
    }],
    ganttRentals: [],
    equipment: [{
      id: 'EQ-032',
      inventoryNumber: '03291436',
      serialNumber: 'SN-032',
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.rentalId, 'R-032');
});

test('resolveRentalForChangeRequest recovers stale GR by unique client and equipment when dates no longer overlap', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-1776254974522',
    linkedGanttRentalId: 'GR-1776254974522',
    fallbackGanttRental: {
      id: 'GR-1776254974522',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-07',
      endDate: '2026-04-09',
      equipmentInv: '03291436',
    },
    rentals: [{
      id: 'R-032',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-10',
      plannedReturnDate: '2026-04-20',
      equipment: ['03291436'],
    }],
    ganttRentals: [],
    equipment: [{
      id: 'EQ-032',
      inventoryNumber: '03291436',
      serialNumber: 'SN-032',
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.rentalId, 'R-032');
});

test('resolveRentalForChangeRequest returns 409 for ambiguous fallback matches', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-ambiguous',
    rentals: [
      { ...rental, id: 'R-ambiguous-1' },
      { ...rental, id: 'R-ambiguous-2' },
    ],
    ganttRentals: [{
      id: 'GR-ambiguous',
      client: rental.client,
      startDate: rental.startDate,
      endDate: rental.plannedReturnDate,
      equipmentInv: '083',
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
});

test('resolveRentalForChangeRequest returns 409 when equipment alias fallback is ambiguous', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-ambiguous-equipment',
    linkedGanttRentalId: 'GR-ambiguous-equipment',
    fallbackGanttRental: {
      id: 'GR-ambiguous-equipment',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      equipmentId: 'EQ-032',
      equipmentInv: '03291436',
    },
    rentals: [
      {
        id: 'R-032-A',
        client: 'Стройтрест Алабуга',
        startDate: '2026-04-10',
        plannedReturnDate: '2026-04-20',
        equipment: ['03291436'],
      },
      {
        id: 'R-032-B',
        client: 'Стройтрест Алабуга',
        startDate: '2026-04-10',
        plannedReturnDate: '2026-04-20',
        equipmentId: 'EQ-032',
      },
    ],
    ganttRentals: [],
    equipment: [{
      id: 'EQ-032',
      inventoryNumber: '03291436',
      serialNumber: 'SN-032',
    }],
  });

  assert.equal(result.ok, false);
  assert.equal(result.status, 409);
  assert.deepEqual(result.details.fallbackCandidateIds, ['R-032-A', 'R-032-B']);
});

test('backfillGanttRentalLinks links only unambiguous legacy gantt records', () => {
  const state = {
    rentals: [
      { ...rental, id: 'R-linked' },
      { ...rental, id: 'R-ambiguous-1', client: 'Дубль' },
      { ...rental, id: 'R-ambiguous-2', client: 'Дубль' },
    ],
    gantt_rentals: [
      {
        id: 'GR-linked',
        client: rental.client,
        startDate: rental.startDate,
        endDate: rental.plannedReturnDate,
        equipmentInv: '083',
      },
      {
        id: 'GR-ambiguous',
        client: 'Дубль',
        startDate: rental.startDate,
        endDate: rental.plannedReturnDate,
        equipmentInv: '083',
      },
    ],
  };
  const warnings = [];
  const result = backfillGanttRentalLinks({
    readData: name => state[name] || [],
    writeData: (name, value) => {
      state[name] = value;
    },
    logger: { log: () => {}, warn: message => warnings.push(message) },
  });

  assert.equal(result.missingLink, 2);
  assert.equal(result.linked, 1);
  assert.equal(result.ambiguous.length, 1);
  assert.equal(state.gantt_rentals[0].rentalId, 'R-linked');
  assert.equal(state.gantt_rentals[1].rentalId, undefined);
  assert.ok(warnings.some(message => message.includes('Неоднозначная связь')));
});

test('analyzeGanttRentalLinks reports missing rentalId, broken links and target GR id', () => {
  const diagnostics = analyzeGanttRentalLinks({
    rentals: [{ ...rental, id: 'R-linked' }],
    ganttRentals: [
      {
        id: 'GR-linked',
        rentalId: 'R-linked',
        client: rental.client,
        startDate: rental.startDate,
        endDate: rental.plannedReturnDate,
        equipmentInv: '083',
      },
      {
        id: 'GR-no-rental-id',
        sourceRentalId: 'R-linked',
        client: rental.client,
        startDate: rental.startDate,
        endDate: rental.plannedReturnDate,
        equipmentInv: '083',
      },
      {
        id: 'GR-broken',
        rentalId: 'R-missing',
        client: rental.client,
        startDate: rental.startDate,
        endDate: rental.plannedReturnDate,
        equipmentInv: '083',
      },
      {
        id: 'GR-empty',
        client: rental.client,
        startDate: rental.startDate,
        endDate: rental.plannedReturnDate,
        equipmentInv: '083',
      },
    ],
    targetId: 'GR-broken',
  });

  assert.equal(diagnostics.missingRentalIdCount, 2);
  assert.equal(diagnostics.missingAnyLinkCount, 1);
  assert.equal(diagnostics.brokenRentalIdCount, 1);
  assert.equal(diagnostics.brokenAnyLinkCount, 1);
  assert.equal(diagnostics.target.foundInGanttRentals, true);
  assert.equal(diagnostics.target.foundInRentals, false);
  assert.equal(diagnostics.target.ganttRentals[0].id, 'GR-broken');
  assert.equal(diagnostics.target.linkedRentalId, '');
  assert.deepEqual(diagnostics.target.linkedIds, ['R-missing']);
  assert.equal(diagnostics.target.exactGanttRecord.id, 'GR-broken');
  assert.deepEqual(diagnostics.target.linkedRentals, []);
  assert.equal(diagnostics.target.fallbackCandidates[0].id, 'R-linked');
});

function createApprovalApp() {
  const state = {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор' },
      { id: 'U-manager', name: 'Руслан', role: 'Менеджер по аренде' },
    ],
    equipment: [
      { id: 'EQ-1', inventoryNumber: '083', category: 'own', activeInFleet: true },
      { id: 'EQ-032', inventoryNumber: '03291436', serialNumber: 'SN-032', category: 'own', activeInFleet: true },
    ],
    rentals: [
      {
        id: 'R-1',
        client: 'ЭМ-СТРОЙ',
        contact: 'Иван',
        startDate: '2026-04-10',
        plannedReturnDate: '2026-04-20',
        equipment: ['083'],
        manager: 'Руслан',
        managerId: 'U-manager',
        status: 'active',
        price: 100000,
        discount: 0,
        history: [],
      },
      {
        id: 'R-2',
        client: 'Будущая аренда',
        startDate: '2026-04-23',
        plannedReturnDate: '2026-04-25',
        equipment: ['083'],
        manager: 'Руслан',
        managerId: 'U-manager',
        status: 'created',
      },
      {
        id: 'R-032',
        client: 'Стройтрест Алабуга',
        startDate: '2026-04-10',
        plannedReturnDate: '2026-04-20',
        equipment: ['03291436'],
        manager: 'Руслан',
        managerId: 'U-manager',
        status: 'active',
        price: 90000,
        discount: 0,
        history: [],
      },
    ],
    gantt_rentals: [
      {
        id: 'GR-1',
        client: 'ЭМ-СТРОЙ',
        startDate: '2026-04-10',
        endDate: '2026-04-20',
        equipmentId: 'EQ-1',
        equipmentInv: '083',
        manager: 'Руслан',
        managerId: 'U-manager',
        status: 'active',
        amount: 100000,
        comments: [],
      },
      {
        id: 'GR-2',
        client: 'Будущая аренда',
        startDate: '2026-04-23',
        endDate: '2026-04-25',
        equipmentId: 'EQ-1',
        equipmentInv: '083',
        manager: 'Руслан',
        managerId: 'U-manager',
        status: 'created',
        amount: 100000,
        comments: [],
      },
    ],
    payments: [],
    rental_change_requests: [],
  };
  const app = express();
  app.use(express.json());
  const readData = (name) => state[name] || [];
  const writeData = (name, value) => {
    state[name] = value;
  };
  const accessControl = createAccessControl({ readData });
  let requestCounter = 0;

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = token === 'admin-token'
      ? state.users[0]
      : token === 'manager-token'
        ? state.users[1]
        : null;
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
    };
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
    generateId: prefix => `${prefix}-${++requestCounter}`,
    idPrefixes: { rentals: 'R', gantt_rentals: 'GR', rental_change_requests: 'RCR' },
    accessControl,
    auditLog: () => {},
  }));
  apiRouter.use(registerRentalChangeRequestRoutes({
    readData,
    writeData,
    requireAuth,
    validateRentalPayload,
    generateId: prefix => `${prefix}-${++requestCounter}`,
    idPrefixes: { rental_change_requests: 'RCR' },
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

async function request(baseUrl, method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

test('approved rental date change applies even when it originally required conflict approval', async () => {
  const { app, state } = createApprovalApp();

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/R-1', 'manager-token', {
      plannedReturnDate: '2026-04-24',
      __linkedGanttRentalId: 'GR-1',
      __changeReason: 'Клиент просит продлить аренду',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.changeRequestSummary.pendingCount, 1);
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, '2026-04-20');
    assert.equal(state.rental_change_requests.length, 1);

    const changeRequest = state.rental_change_requests[0];
    assert.equal(changeRequest.field, 'plannedReturnDate');
    assert.equal(changeRequest.newValue, '2026-04-24');

    const approved = await request(baseUrl, 'POST', `/api/rental_change_requests/${changeRequest.id}/approve`, 'admin-token', {});

    assert.equal(approved.status, 200);
    assert.equal(approved.body.status, 'approved');
    assert.equal(state.rentals.find(item => item.id === 'R-1').plannedReturnDate, '2026-04-24');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').endDate, '2026-04-24');
  });
});

test('editing existing rental through gantt id creates approval without losing rental card', async () => {
  const { app, state } = createApprovalApp();

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-1', 'manager-token', {
      price: 120000,
      __linkedGanttRentalId: 'GR-1',
      __changeReason: 'Изменение цены из планировщика',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.id, 'R-1');
    assert.equal(update.body.changeRequestSummary.pendingCount, 1);
    assert.equal(state.rentals.find(item => item.id === 'R-1').price, 100000);
    assert.equal(state.rental_change_requests.length, 1);
    assert.equal(state.rental_change_requests[0].entityType, 'rental');
    assert.equal(state.rental_change_requests[0].rentalId, 'R-1');
    assert.equal(state.rental_change_requests[0].sourceRentalId, 'GR-1');
    assert.equal(state.rental_change_requests[0].linkedGanttRentalId, 'GR-1');
    assert.equal(state.rental_change_requests[0].status, 'pending');
    assert.equal(state.rental_change_requests[0].requestedBy, 'U-manager');
    assert.deepEqual(state.rental_change_requests[0].oldValues, { price: 100000 });
    assert.deepEqual(state.rental_change_requests[0].newValues, { price: 120000 });
    assert.equal(state.rental_change_requests[0].changes[0].field, 'price');
    assert.match(
      state.rentals.find(item => item.id === 'R-1').history.at(-1).text,
      /отправлено на согласование/i,
    );

    const approved = await request(baseUrl, 'POST', `/api/rental_change_requests/${state.rental_change_requests[0].id}/approve`, 'admin-token', {});
    assert.equal(approved.status, 200);
    assert.equal(state.rentals.find(item => item.id === 'R-1').price, 120000);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').amount, 120000);
    assert.match(
      state.rentals.find(item => item.id === 'R-1').history.at(-1).text,
      /Согласовано и применено/,
    );
  });
});

test('PATCH /api/rentals/:id resolves GR route id through gantt_rentals.rentalId', async () => {
  const { app, state } = createApprovalApp();
  state.gantt_rentals[0].rentalId = 'R-1';

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-1', 'manager-token', {
      price: 125000,
      ganttRentalId: 'GR-1',
      entityType: 'rental',
      actionType: 'gantt_rental_update',
      oldValues: { price: 100000 },
      newValues: { price: 125000 },
      changes: [{ field: 'price', oldValue: 100000, newValue: 125000 }],
      __changeReason: 'Изменение цены из Gantt',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.id, 'R-1');
    assert.equal(state.rental_change_requests.length, 1);
    assert.equal(state.rental_change_requests[0].rentalId, 'R-1');
    assert.equal(state.rental_change_requests[0].linkedGanttRentalId, 'GR-1');
    assert.equal(state.rentals.find(item => item.id === 'R-1').entityType, undefined);
    assert.equal(state.rentals.find(item => item.id === 'R-1').actionType, undefined);
  });
});

test('PATCH /api/rentals/:id resolves stale GR route id through request Gantt snapshot', async () => {
  const { app, state } = createApprovalApp();

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-stale-browser', 'manager-token', {
      price: 127000,
      ganttRentalId: 'GR-stale-browser',
      __ganttSnapshot: {
        id: 'GR-stale-browser',
        client: 'ЭМ-СТРОЙ',
        startDate: '2026-04-10',
        endDate: '2026-04-20',
        equipmentInv: '083',
      },
      entityType: 'rental',
      actionType: 'gantt_rental_update',
      oldValues: { price: 100000 },
      newValues: { price: 127000 },
      changes: [{ field: 'price', oldValue: 100000, newValue: 127000 }],
      __changeReason: 'Изменение цены из stale Gantt',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.id, 'R-1');
    assert.equal(state.rental_change_requests.length, 1);
    assert.equal(state.rental_change_requests[0].rentalId, 'R-1');
    assert.equal(state.rental_change_requests[0].sourceRentalId, 'GR-stale-browser');
    assert.equal(state.rental_change_requests[0].linkedGanttRentalId, 'GR-stale-browser');
    assert.equal(state.rentals.find(item => item.id === 'R-1').price, 100000);
  });
});

test('PATCH /api/rentals/:id resolves real stale GR for equipment 03291436 through snapshot aliases', async () => {
  const { app, state } = createApprovalApp();
  state.rentals.find(item => item.id === 'R-032').client = 'ООО Стройтрест-Алабуга';

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-1776254974522', 'manager-token', {
      price: 95000,
      ganttRentalId: 'GR-1776254974522',
      __ganttSnapshot: {
        id: 'GR-1776254974522',
        client: 'Стройтрест Алабуга',
        startDate: '2026-04-10',
        endDate: '2026-04-20',
        equipmentId: 'EQ-032',
        equipmentInv: '03291436',
      },
      entityType: 'rental',
      actionType: 'gantt_rental_update',
      oldValues: { price: 90000 },
      newValues: { price: 95000 },
      changes: [{ field: 'price', oldValue: 90000, newValue: 95000 }],
      __changeReason: 'Изменение цены из проблемной карточки',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.id, 'R-032');
    assert.equal(state.rental_change_requests.length, 1);
    assert.equal(state.rental_change_requests[0].rentalId, 'R-032');
    assert.equal(state.rental_change_requests[0].sourceRentalId, 'GR-1776254974522');
    assert.equal(state.rental_change_requests[0].linkedGanttRentalId, 'GR-1776254974522');
    assert.equal(state.rentals.find(item => item.id === 'R-032').price, 90000);
  });
});

test('PATCH /api/rentals/:id creates approval when moving stale 03291436 rental start to 07.04', async () => {
  const { app, state } = createApprovalApp();
  state.rentals.find(item => item.id === 'R-032').client = 'ООО Стройтрест-Алабуга';

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-1776254974522', 'manager-token', {
      startDate: '2026-04-07',
      ganttRentalId: 'GR-1776254974522',
      __ganttSnapshot: {
        id: 'GR-1776254974522',
        client: 'Стройтрест Алабуга',
        startDate: '2026-04-07',
        endDate: '2026-04-20',
        equipmentId: 'EQ-032',
        equipmentInv: '03291436',
      },
      entityType: 'rental',
      actionType: 'gantt_rental_update',
      oldValues: { startDate: '2026-04-10' },
      newValues: { startDate: '2026-04-07' },
      changes: [{ field: 'startDate', oldValue: '2026-04-10', newValue: '2026-04-07' }],
      __changeReason: 'Перенос начала аренды 03291436 на 07.04',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.id, 'R-032');
    assert.equal(state.rental_change_requests.length, 1);
    assert.equal(state.rental_change_requests[0].rentalId, 'R-032');
    assert.equal(state.rental_change_requests[0].field, 'startDate');
    assert.equal(state.rental_change_requests[0].newValue, '2026-04-07');
    assert.equal(state.rentals.find(item => item.id === 'R-032').startDate, '2026-04-10');
  });
});

test('PATCH /api/rentals/:id resolves stale 03291436 by client and equipment when moved dates do not overlap', async () => {
  const { app, state } = createApprovalApp();

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-1776254974522', 'manager-token', {
      startDate: '2026-04-07',
      plannedReturnDate: '2026-04-09',
      ganttRentalId: 'GR-1776254974522',
      __ganttSnapshot: {
        id: 'GR-1776254974522',
        client: 'Стройтрест Алабуга',
        startDate: '2026-04-07',
        endDate: '2026-04-09',
        equipmentId: 'EQ-032',
        equipmentInv: '03291436',
      },
      entityType: 'rental',
      actionType: 'gantt_rental_update',
      oldValues: { startDate: '2026-04-10', plannedReturnDate: '2026-04-20' },
      newValues: { startDate: '2026-04-07', plannedReturnDate: '2026-04-09' },
      changes: [
        { field: 'startDate', oldValue: '2026-04-10', newValue: '2026-04-07' },
        { field: 'plannedReturnDate', oldValue: '2026-04-20', newValue: '2026-04-09' },
      ],
      __changeReason: 'Перенос аренды 03291436 на 07.04',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.id, 'R-032');
    assert.equal(state.rental_change_requests.length, 2);
    assert.deepEqual(
      state.rental_change_requests.map(item => item.field).sort(),
      ['plannedReturnDate', 'startDate'],
    );
    assert.equal(state.rentals.find(item => item.id === 'R-032').startDate, '2026-04-10');
    assert.equal(state.rentals.find(item => item.id === 'R-032').plannedReturnDate, '2026-04-20');
  });
});

test('rentals PATCH returns clear 400 and 404 for bad approval ids', async () => {
  const { app } = createApprovalApp();

  await withServer(app, async (baseUrl) => {
    const missing = await request(baseUrl, 'PATCH', '/api/rentals/undefined', 'manager-token', {
      price: 120000,
    });
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /rentalId/);

    const unknown = await request(baseUrl, 'PATCH', '/api/rentals/R-404', 'manager-token', {
      price: 120000,
    });
    assert.equal(unknown.status, 404);
    assert.match(unknown.body.error, /R-404/);
    assert.deepEqual(unknown.body.details.searchedCollections.slice(0, 2), ['rentals.id', 'gantt_rentals.id']);
    assert.equal(unknown.body.details.foundGanttById, 0);
    assert.equal(unknown.body.details.receivedId, 'R-404');
    assert.equal(unknown.body.details.receivedRentalId, '');
    assert.match(unknown.body.details.recommendation, /rental-link-diagnostics/);

    const unknownGantt = await request(baseUrl, 'PATCH', '/api/rentals/GR-live-missing', 'manager-token', {
      price: 120000,
    });
    assert.equal(unknownGantt.status, 404);
    assert.equal(unknownGantt.body.details.receivedId, 'GR-live-missing');
    assert.match(unknownGantt.body.details.possibleReason, /GR-id/);
  });
});

test('conflict-free extension applies immediately and does not create approval', async () => {
  const { app, state } = createApprovalApp();

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/R-2', 'manager-token', {
      plannedReturnDate: '2026-04-30',
      __linkedGanttRentalId: 'GR-2',
      __changeReason: 'Клиент продлил аренду',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.plannedReturnDate, '2026-04-30');
    assert.equal(update.body.changeRequestSummary.pendingCount, 0);
    assert.equal(state.rental_change_requests.length, 0);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-2').endDate, '2026-04-30');
  });
});

test('downtime change creates approval and does not mutate rental before approval', async () => {
  const { app, state } = createApprovalApp();

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/R-1', 'manager-token', {
      downtimeDays: 2,
      downtimeReason: 'Простой на объекте',
      __linkedGanttRentalId: 'GR-1',
      __changeReason: 'Простой техники',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.changeRequestSummary.pendingCount, 2);
    assert.equal(state.rentals.find(item => item.id === 'R-1').downtimeDays, undefined);
    assert.equal(state.rentals.find(item => item.id === 'R-1').downtimeReason, undefined);
    assert.deepEqual(
      state.rental_change_requests.map(item => item.field).sort(),
      ['downtimeDays', 'downtimeReason'],
    );
  });
});

test('comments and attachment additions apply immediately without approval', async () => {
  const { app, state } = createApprovalApp();

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/R-1', 'manager-token', {
      comments: 'Добавлен комментарий',
      documents: ['UPD-1'],
      photos: ['PHOTO-1'],
      __linkedGanttRentalId: 'GR-1',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.changeRequestSummary.pendingCount, 0);
    assert.equal(state.rental_change_requests.length, 0);
    const updatedRental = state.rentals.find(item => item.id === 'R-1');
    assert.equal(updatedRental.comments, 'Добавлен комментарий');
    assert.deepEqual(updatedRental.documents, ['UPD-1']);
    assert.deepEqual(updatedRental.photos, ['PHOTO-1']);
    assert.match(updatedRental.history.at(-1).text, /Изменение применено сразу/);
  });
});

test('rejected approval keeps rental unchanged and writes history entry', async () => {
  const { app, state } = createApprovalApp();

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/R-1', 'manager-token', {
      price: 130000,
      __linkedGanttRentalId: 'GR-1',
      __changeReason: 'Изменение цены',
    });
    assert.equal(update.status, 200);
    const requestId = state.rental_change_requests[0].id;

    const rejected = await request(baseUrl, 'POST', `/api/rental_change_requests/${requestId}/reject`, 'admin-token', {
      reason: 'Цена не согласована',
    });

    assert.equal(rejected.status, 200);
    assert.equal(rejected.body.status, 'rejected');
    assert.equal(state.rentals.find(item => item.id === 'R-1').price, 100000);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').amount, 100000);
    assert.match(
      state.rentals.find(item => item.id === 'R-1').history.at(-1).text,
      /Отклонено изменение/,
    );
  });
});
