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
  ensureGanttRentalLink,
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

test('splitRentalPatch ignores cancelled payments when detecting closing with debt', () => {
  const result = splitRentalPatch({
    previousRental: rental,
    patch: { status: 'closed' },
    payments: [{ id: 'P-cancelled', rentalId: 'R-1', amount: 100000, paidAmount: 100000, status: 'cancelled' }],
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

test('resolveRentalForChangeRequest recovers stale GR by the only open equipment rental', () => {
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
    rentals: [
      {
        id: 'R-closed-032',
        client: 'Архивный клиент',
        startDate: '2026-03-01',
        plannedReturnDate: '2026-03-10',
        equipment: ['03291436'],
        status: 'closed',
      },
      {
        id: 'R-032',
        client: 'Другой snapshot клиента',
        startDate: '2026-04-10',
        plannedReturnDate: '2026-04-20',
        equipment: ['03291436'],
        status: 'active',
      },
    ],
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

test('resolveRentalForChangeRequest extracts equipment inventory from stale text labels', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-1776254974522',
    linkedGanttRentalId: 'GR-1776254974522',
    fallbackGanttRental: {
      id: 'GR-1776254974522',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-07',
      endDate: '2026-04-09',
      equipmentInv: '',
      equipmentName: 'Подъемник JLG 1932R INV 03291436',
    },
    rentals: [{
      id: 'R-032',
      client: 'Другой snapshot клиента',
      startDate: '2026-04-10',
      plannedReturnDate: '2026-04-20',
      equipment: ['JLG 1932R / 03291436'],
      status: 'active',
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

test('resolveRentalForChangeRequest merges request snapshot into existing broken GR record', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-1776254974522',
    linkedGanttRentalId: 'GR-1776254974522',
    fallbackGanttRental: {
      id: 'GR-1776254974522',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-07',
      endDate: '2026-04-09',
      equipmentId: 'EQ-032',
      equipmentInv: '03291436',
    },
    rentals: [{
      id: 'R-032',
      client: 'Другой snapshot клиента',
      startDate: '2026-04-10',
      plannedReturnDate: '2026-04-20',
      equipment: ['03291436'],
      status: 'active',
    }],
    ganttRentals: [{
      id: 'GR-1776254974522',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-07',
      endDate: '2026-04-09',
      equipmentInv: '',
    }],
    equipment: [{
      id: 'EQ-032',
      inventoryNumber: '03291436',
      serialNumber: 'SN-032',
    }],
  });

  assert.equal(result.ok, true);
  assert.equal(result.rentalId, 'R-032');
  assert.equal(result.linkedGanttRentalId, 'GR-1776254974522');
});

test('resolveRentalForChangeRequest falls back to unique open client rental with previous dates', () => {
  const result = resolveRentalForChangeRequest({
    rentalId: 'GR-1776254974522',
    linkedGanttRentalId: 'GR-1776254974522',
    fallbackGanttRental: {
      id: 'GR-1776254974522',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-07',
      endDate: '2026-04-09',
      previousStartDate: '2026-04-10',
      previousEndDate: '2026-04-20',
    },
    rentals: [{
      id: 'R-032',
      client: 'ООО Стройтрест-Алабуга',
      startDate: '2026-04-10',
      plannedReturnDate: '2026-04-20',
      equipment: ['03291436'],
      status: 'active',
    }],
    ganttRentals: [{
      id: 'GR-1776254974522',
      client: 'Стройтрест Алабуга',
      startDate: '2026-04-07',
      endDate: '2026-04-09',
      equipmentInv: '',
    }],
    equipment: [],
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
        rentalId: 'R-1',
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
        rentalId: 'R-2',
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
    assert.equal(state.rentals.find(item => item.id === 'R-1').history.length, 1);
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

test('PATCH /api/rentals/:id resolves stale 03291436 by the only open equipment rental', async () => {
  const { app, state } = createApprovalApp();
  const currentRental = state.rentals.find(item => item.id === 'R-032');
  currentRental.client = 'Другой snapshot клиента';
  currentRental.startDate = '2026-04-10';
  currentRental.plannedReturnDate = '2026-04-20';
  state.rentals.push({
    ...currentRental,
    id: 'R-closed-032',
    client: 'Архивный клиент',
    startDate: '2026-03-01',
    plannedReturnDate: '2026-03-10',
    status: 'closed',
  });

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
    assert.equal(state.rentals.find(item => item.id === 'R-032').startDate, '2026-04-10');
  });
});

test('PATCH /api/rentals/:id resolves stale 03291436 when inventory is only in text labels', async () => {
  const { app, state } = createApprovalApp();
  const currentRental = state.rentals.find(item => item.id === 'R-032');
  currentRental.client = 'Другой snapshot клиента';
  currentRental.startDate = '2026-04-10';
  currentRental.plannedReturnDate = '2026-04-20';
  currentRental.equipment = ['JLG 1932R / 03291436'];

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
        equipmentInv: '',
        equipmentName: 'Подъемник JLG 1932R INV 03291436',
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
    assert.equal(state.rentals.find(item => item.id === 'R-032').startDate, '2026-04-10');
  });
});

test('PATCH /api/rentals/:id merges snapshot with existing broken GR record', async () => {
  const { app, state } = createApprovalApp();
  const currentRental = state.rentals.find(item => item.id === 'R-032');
  currentRental.client = 'Другой snapshot клиента';
  currentRental.startDate = '2026-04-10';
  currentRental.plannedReturnDate = '2026-04-20';
  state.gantt_rentals.push({
    id: 'GR-1776254974522',
    client: 'Стройтрест Алабуга',
    startDate: '2026-04-07',
    endDate: '2026-04-09',
    equipmentInv: '',
    status: 'active',
    comments: [],
  });

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
    assert.equal(state.rental_change_requests[0].linkedGanttRentalId, 'GR-1776254974522');
    assert.equal(state.rentals.find(item => item.id === 'R-032').startDate, '2026-04-10');
  });
});

test('PATCH /api/rentals/:id resolves broken GR by client and old dates when equipment is missing', async () => {
  const { app, state } = createApprovalApp();
  const currentRental = state.rentals.find(item => item.id === 'R-032');
  currentRental.client = 'ООО Стройтрест-Алабуга';
  currentRental.startDate = '2026-04-10';
  currentRental.plannedReturnDate = '2026-04-20';
  state.gantt_rentals.push({
    id: 'GR-1776254974522',
    client: 'Стройтрест Алабуга',
    startDate: '2026-04-07',
    endDate: '2026-04-09',
    equipmentInv: '',
    status: 'active',
    comments: [],
  });

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
        equipmentInv: '',
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
    assert.equal(state.rentals.find(item => item.id === 'R-032').startDate, '2026-04-10');
  });
});

test('PATCH /api/rentals/:id restores orphan gantt rental before creating approval', async () => {
  const { app, state } = createApprovalApp();
  state.rentals = state.rentals.filter(item => item.id !== 'R-032');
  state.gantt_rentals.push({
    id: 'GR-1776254974522',
    client: 'Стройтрест Алабуга',
    startDate: '2026-04-10',
    endDate: '2026-04-20',
    equipmentId: 'EQ-032',
    equipmentInv: '03291436',
    manager: 'Руслан',
    managerId: 'U-manager',
    status: 'active',
    amount: 90000,
    comments: [],
  });

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-1776254974522', 'manager-token', {
      startDate: '2026-04-07',
      plannedReturnDate: '2026-04-09',
      ganttRentalId: 'GR-1776254974522',
      __ganttSnapshot: {
        id: 'GR-1776254974522',
        client: 'Стройтрест Алабуга',
        startDate: '2026-04-10',
        endDate: '2026-04-20',
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
    assert.match(update.body.id, /^R-/);
    assert.notEqual(update.body.id, 'GR-1776254974522');
    const restoredRental = state.rentals.find(item => item.id === update.body.id);
    assert.equal(restoredRental.client, 'Стройтрест Алабуга');
    assert.equal(restoredRental.startDate, '2026-04-10');
    assert.equal(restoredRental.plannedReturnDate, '2026-04-20');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1776254974522').rentalId, update.body.id);
    assert.equal(state.rental_change_requests.length, 2);
    assert.equal(state.rental_change_requests[0].rentalId, update.body.id);
    assert.equal(state.rental_change_requests[0].linkedGanttRentalId, 'GR-1776254974522');
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
  const rental = state.rentals.find(item => item.id === 'R-2');
  const ganttRental = state.gantt_rentals.find(item => item.id === 'GR-2');
  rental.startDate = '2026-05-23';
  rental.plannedReturnDate = '2026-05-25';
  ganttRental.startDate = '2026-05-23';
  ganttRental.endDate = '2026-05-25';

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/R-2', 'manager-token', {
      plannedReturnDate: '2026-05-30',
      __linkedGanttRentalId: 'GR-2',
      __changeReason: 'Клиент продлил аренду',
    });

    assert.equal(update.status, 200);
    assert.equal(update.body.plannedReturnDate, '2026-05-30');
    assert.equal(update.body.changeRequestSummary.pendingCount, 0);
    assert.equal(state.rental_change_requests.length, 0);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-2').endDate, '2026-05-30');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-2').equipmentId, 'EQ-1');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-2').equipmentInv, '083');
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

test('rejected approval keeps rental unchanged and does not mutate rental history', async () => {
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
    assert.equal(state.rentals.find(item => item.id === 'R-1').history.length, 1);
  });
});

test('date approval keeps canonical rentalId and approve mutates only that rental', async () => {
  const { app, state } = createApprovalApp();
  state.rentals = [
    {
      id: 'R-A',
      clientId: 'C-A',
      client: 'Client A',
      startDate: '2026-04-10',
      plannedReturnDate: '2026-04-20',
      equipment: ['INV-A'],
      manager: 'Manager',
      managerId: 'U-manager',
      status: 'active',
      price: 1000,
      discount: 0,
      history: [],
    },
    {
      id: 'R-B',
      clientId: 'C-B',
      client: 'Client B',
      startDate: '2026-04-10',
      plannedReturnDate: '2026-04-20',
      equipment: ['INV-B'],
      manager: 'Manager',
      managerId: 'U-manager',
      status: 'active',
      price: 2000,
      discount: 0,
      history: [],
    },
  ];
  state.equipment = [
    { id: 'EQ-A', inventoryNumber: 'INV-A', manufacturer: 'Maker', model: 'A', serialNumber: 'SN-A', category: 'own', activeInFleet: true },
    { id: 'EQ-B', inventoryNumber: 'INV-B', manufacturer: 'Maker', model: 'B', serialNumber: 'SN-B', category: 'own', activeInFleet: true },
  ];
  state.gantt_rentals = [
    { id: 'GR-A', rentalId: 'R-A', client: 'Client A', startDate: '2026-04-10', endDate: '2026-04-20', equipmentInv: 'INV-A', status: 'active', amount: 1000, comments: [] },
    { id: 'GR-B', rentalId: 'R-B', client: 'Client B', startDate: '2026-04-10', endDate: '2026-04-20', equipmentInv: 'INV-B', status: 'active', amount: 2000, comments: [] },
  ];

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/R-A', 'manager-token', {
      startDate: '2026-04-07',
      __linkedGanttRentalId: 'GR-A',
      __changeReason: 'Backdated start change for A',
    });

    assert.equal(update.status, 200);
    assert.equal(state.rental_change_requests.length, 1);
    const changeRequest = state.rental_change_requests[0];
    assert.equal(changeRequest.rentalId, 'R-A');
    assert.equal(changeRequest.entityId, 'R-A');
    assert.equal(changeRequest.type, 'backdated_rental_date_change');
    assert.equal(changeRequest.clientName, 'Client A');
    assert.equal(changeRequest.equipmentInventoryNumber, 'INV-A');
    assert.notEqual(changeRequest.clientName, 'Client B');
    assert.notEqual(changeRequest.equipmentInventoryNumber, 'INV-B');

    const listed = await request(baseUrl, 'GET', '/api/rental_change_requests', 'admin-token');
    assert.equal(listed.status, 200);
    assert.equal(listed.body[0].rentalId, 'R-A');
    assert.equal(listed.body[0].clientName, 'Client A');

    const approved = await request(baseUrl, 'POST', `/api/rental_change_requests/${changeRequest.id}/approve`, 'admin-token', {});
    assert.equal(approved.status, 200);
    assert.equal(state.rentals.find(item => item.id === 'R-A').startDate, '2026-04-07');
    assert.equal(state.rentals.find(item => item.id === 'R-B').startDate, '2026-04-10');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-A').startDate, '2026-04-07');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-B').startDate, '2026-04-10');
  });
});

test('approve rejects missing and unknown rentalId without mutating rentals', async () => {
  const { app, state } = createApprovalApp();
  state.gantt_rentals[0].rentalId = 'R-1';
  state.rental_change_requests.push(
    {
      id: 'RCR-missing-id',
      entityType: 'rental',
      entityId: 'R-1',
      status: 'pending',
      field: 'startDate',
      fieldLabel: 'Start',
      oldValue: '2026-04-10',
      newValue: '2026-04-07',
    },
    {
      id: 'RCR-unknown-id',
      entityType: 'rental',
      entityId: 'R-missing',
      rentalId: 'R-missing',
      status: 'pending',
      field: 'startDate',
      fieldLabel: 'Start',
      oldValue: '2026-04-10',
      newValue: '2026-04-07',
    },
  );

  await withServer(app, async (baseUrl) => {
    const missing = await request(baseUrl, 'POST', '/api/rental_change_requests/RCR-missing-id/approve', 'admin-token', {});
    assert.equal(missing.status, 400);
    assert.equal(state.rentals.find(item => item.id === 'R-1').startDate, '2026-04-10');

    const unknown = await request(baseUrl, 'POST', '/api/rental_change_requests/RCR-unknown-id/approve', 'admin-token', {});
    assert.equal(unknown.status, 404);
    assert.equal(state.rentals.find(item => item.id === 'R-1').startDate, '2026-04-10');
  });
});

test('approve detects stale old values and does not overwrite newer rental dates', async () => {
  const { app, state } = createApprovalApp();
  state.gantt_rentals[0].rentalId = 'R-1';

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/R-1', 'manager-token', {
      startDate: '2026-04-07',
      __linkedGanttRentalId: 'GR-1',
      __changeReason: 'Backdated start change',
    });
    assert.equal(update.status, 200);
    const changeRequest = state.rental_change_requests[0];
    state.rentals.find(item => item.id === 'R-1').startDate = '2026-04-09';

    const approved = await request(baseUrl, 'POST', `/api/rental_change_requests/${changeRequest.id}/approve`, 'admin-token', {});
    assert.equal(approved.status, 409);
    assert.equal(state.rentals.find(item => item.id === 'R-1').startDate, '2026-04-09');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').startDate, '2026-04-10');
  });
});

test('gantt create restores rentalId from one exact classic rental match', async () => {
  const { app, state } = createApprovalApp();
  const classicRental = state.rentals.find(item => item.id === 'R-1');

  await withServer(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/gantt_rentals', 'admin-token', {
      client: classicRental.client,
      equipmentInv: '083',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      manager: classicRental.manager,
      managerId: classicRental.managerId,
      status: 'active',
      paymentStatus: 'unpaid',
      amount: 100000,
      comments: [],
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.rentalId, 'R-1');
    assert.equal(created.body.sourceRentalId, 'R-1');
    assert.equal(state.gantt_rentals.at(-1).rentalId, 'R-1');
  });
});

test('rentals patch repairs old gantt entry without rentalId when exactly one rental matches', async () => {
  const { app, state } = createApprovalApp();
  const gantt = state.gantt_rentals.find(item => item.id === 'GR-1');
  delete gantt.rentalId;
  delete gantt.sourceRentalId;
  delete gantt.originalRentalId;

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-1', 'manager-token', {
      price: 123000,
      ganttRentalId: 'GR-1',
      __ganttSnapshot: gantt,
      oldValues: { price: 100000 },
      newValues: { price: 123000 },
      changes: [{ field: 'price', oldValue: 100000, newValue: 123000 }],
      __changeReason: 'legacy gantt repair',
    });

    assert.equal(update.status, 200);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').rentalId, 'R-1');
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').sourceRentalId, 'R-1');
    assert.equal(state.rental_change_requests[0].rentalId, 'R-1');
  });
});

test('rentals patch refuses ambiguous legacy gantt matches', async () => {
  const { app, state } = createApprovalApp();
  const gantt = state.gantt_rentals.find(item => item.id === 'GR-1');
  delete gantt.rentalId;
  delete gantt.sourceRentalId;
  delete gantt.originalRentalId;
  state.rentals.push({ ...state.rentals.find(item => item.id === 'R-1'), id: 'R-duplicate', history: [] });

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-1', 'manager-token', {
      price: 123000,
      ganttRentalId: 'GR-1',
      __ganttSnapshot: gantt,
      oldValues: { price: 100000 },
      newValues: { price: 123000 },
      changes: [{ field: 'price', oldValue: 100000, newValue: 123000 }],
      __changeReason: 'ambiguous legacy gantt repair',
    });

    assert.equal(update.status, 409);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').rentalId, undefined);
  });
});

test('rentals patch returns clear error when legacy gantt has no rental match', async () => {
  const { app, state } = createApprovalApp();
  state.rentals = state.rentals.filter(item => item.id !== 'R-1');
  const gantt = state.gantt_rentals.find(item => item.id === 'GR-1');
  delete gantt.rentalId;
  delete gantt.sourceRentalId;
  delete gantt.originalRentalId;
  gantt.equipmentInv = 'NO-SUCH-INV';

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-1', 'manager-token', {
      price: 123000,
      ganttRentalId: 'GR-1',
      __ganttSnapshot: gantt,
      oldValues: { price: 100000 },
      newValues: { price: 123000 },
      changes: [{ field: 'price', oldValue: 100000, newValue: 123000 }],
      __changeReason: 'missing legacy gantt repair',
    });
    assert.equal(update.status, 404);
  });
});

test('gantt create canonicalizes wrong equipment from the matched rental', async () => {
  const { app, state } = createApprovalApp();
  const classicRental = state.rentals.find(item => item.id === 'R-1');

  await withServer(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/gantt_rentals', 'admin-token', {
      client: classicRental.client,
      equipmentId: 'EQ-032',
      equipmentInv: '03291436',
      startDate: classicRental.startDate,
      endDate: classicRental.plannedReturnDate,
      manager: classicRental.manager,
      managerId: classicRental.managerId,
      status: 'active',
      paymentStatus: 'unpaid',
      amount: 100000,
      comments: [],
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.rentalId, 'R-1');
    assert.equal(created.body.equipmentId, 'EQ-1');
    assert.equal(created.body.equipmentInv, '083');
    assert.equal(state.gantt_rentals.at(-1).equipmentId, 'EQ-1');
  });
});

test('ensureGanttRentalLink clears stale equipmentId when rental only has inventory reference', () => {
  const linked = ensureGanttRentalLink(
    {
      id: 'GR-stale-equipment',
      rentalId: 'R-1',
      equipmentId: 'EQ-032',
      equipmentInv: '03291436',
      inventoryNumber: '03291436',
      equipment: ['03291436'],
    },
    {
      id: 'R-1',
      client: 'ЭМ-СТРОЙ',
      clientId: 'C-1',
      startDate: '2026-04-10',
      plannedReturnDate: '2026-04-20',
      equipment: ['083'],
    },
    [],
  );

  assert.equal(linked.equipmentId, '');
  assert.equal(linked.equipmentInv, '083');
  assert.equal(linked.inventoryNumber, '083');
  assert.deepEqual(linked.equipment, ['083']);
});

test('rentals patch repairs wrong legacy gantt equipment from matched rental', async () => {
  const { app, state } = createApprovalApp();
  const gantt = state.gantt_rentals.find(item => item.id === 'GR-1');
  delete gantt.rentalId;
  delete gantt.sourceRentalId;
  delete gantt.originalRentalId;
  gantt.equipmentId = 'EQ-032';
  gantt.equipmentInv = '03291436';

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-1', 'manager-token', {
      price: 123000,
      ganttRentalId: 'GR-1',
      __ganttSnapshot: gantt,
      oldValues: { price: 100000 },
      newValues: { price: 123000 },
      changes: [{ field: 'price', oldValue: 100000, newValue: 123000 }],
      __changeReason: 'legacy gantt equipment repair',
    });

    assert.equal(update.status, 200);
    const repaired = state.gantt_rentals.find(item => item.id === 'GR-1');
    assert.equal(repaired.rentalId, 'R-1');
    assert.equal(repaired.equipmentId, 'EQ-1');
    assert.equal(repaired.equipmentInv, '083');

    const listed = await request(baseUrl, 'GET', '/api/gantt_rentals', 'manager-token');
    const dto = listed.body.find(item => item.id === 'GR-1');
    assert.equal(dto.equipmentId, 'EQ-1');
    assert.equal(dto.equipmentInv, '083');
  });
});

test('rentals patch refuses ambiguous client/date repair when legacy equipment is unusable', async () => {
  const { app, state } = createApprovalApp();
  const gantt = state.gantt_rentals.find(item => item.id === 'GR-1');
  delete gantt.rentalId;
  delete gantt.sourceRentalId;
  delete gantt.originalRentalId;
  gantt.equipmentId = 'EQ-missing';
  gantt.equipmentInv = 'NO-SUCH-INV';
  state.rentals.push({
    ...state.rentals.find(item => item.id === 'R-1'),
    id: 'R-same-client-date-other-equipment',
    equipment: ['03291436'],
    equipmentId: 'EQ-032',
    history: [],
  });

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/GR-1', 'manager-token', {
      price: 123000,
      ganttRentalId: 'GR-1',
      __ganttSnapshot: gantt,
      oldValues: { price: 100000 },
      newValues: { price: 123000 },
      changes: [{ field: 'price', oldValue: 100000, newValue: 123000 }],
      __changeReason: 'ambiguous legacy gantt equipment repair',
    });

    assert.equal(update.status, 409);
    assert.equal(state.gantt_rentals.find(item => item.id === 'GR-1').rentalId, undefined);
  });
});
