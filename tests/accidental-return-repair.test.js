import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildAccidentalReturnRepairPlan,
  applyAccidentalReturnRepairPlan,
} = require('../server/lib/accidental-return-repair.js');

const NOW = '2026-05-13T10:36:26.000Z';

function baseCollections(overrides = {}) {
  const state = {
    rentals: [
      {
        id: 'R-target',
        status: 'closed',
        startDate: '2026-05-01',
        plannedReturnDate: '2026-05-30',
        actualReturnDate: '2026-05-13',
        clientId: 'C-1',
        client: 'ООО Клиент',
        equipment: ['INV-1'],
        manager: 'Менеджер',
        history: [{ date: NOW, text: 'Возврат оформлен: техника принята с повреждениями', author: 'Админ', type: 'system' }],
      },
    ],
    gantt_rentals: [
      {
        id: 'GR-target',
        rentalId: 'R-target',
        status: 'returned',
        startDate: '2026-05-01',
        endDate: '2026-05-13',
        clientId: 'C-1',
        client: 'ООО Клиент',
        equipmentId: 'EQ-1',
        equipmentInv: 'INV-1',
      },
    ],
    service: [
      {
        id: 'S-target',
        status: 'new',
        source: 'system',
        reason: 'Приёмка с аренды',
        description: 'Техника возвращена с повреждениями: smoke',
        rentalId: 'R-target',
        equipmentId: 'EQ-1',
        createdAt: NOW,
        workLog: [{
          date: NOW,
          text: 'Заявка автоматически создана после возврата техники из аренды R-target (2026-05-13)',
          author: 'Админ',
          type: 'status_change',
        }],
        parts: [],
        photos: [],
        resultData: { summary: '', partsUsed: [], worksPerformed: [] },
      },
    ],
    equipment: [{ id: 'EQ-1', status: 'in_service', inventoryNumber: 'INV-1' }],
    payments: [{ id: 'P-1', rentalId: 'R-target', amount: 100 }],
    documents: [{ id: 'D-1', rentalId: 'R-target' }],
    deliveries: [{ id: 'DEL-1', rentalId: 'R-target' }],
    bot_notifications: [],
    audit_logs: [
      {
        id: 'AUD-return',
        action: 'rentals.return',
        entityType: 'rentals',
        entityId: 'R-target',
        createdAt: NOW,
        before: {
          status: 'active',
          startDate: '2026-05-01',
          plannedReturnDate: '2026-05-30',
          actualReturnDate: undefined,
          ganttStatus: 'active',
          ganttEndDate: '2026-05-30',
        },
        after: {
          returnDate: '2026-05-13',
          hasDamage: true,
          equipmentId: 'EQ-1',
          equipmentStatus: 'in_service',
          serviceTicketId: 'S-target',
        },
      },
    ],
    audit_log: [],
    repair_work_items: [],
    repair_part_items: [],
    service_field_trips: [],
    service_audit_log: [],
  };
  return { ...state, ...overrides };
}

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

test('dry-run builds a plan without mutating collections', () => {
  const collections = baseCollections();
  const before = clone(collections);

  const plan = buildAccidentalReturnRepairPlan(collections, { rentalId: 'R-target', now: NOW });

  assert.equal(plan.ok, true);
  assert.deepEqual(clone(collections), before);
  assert.equal(plan.current.rental.status, 'closed');
  assert.equal(plan.proposed.rental.status, 'active');
  assert.equal(plan.proposed.ganttRental.status, 'active');
  assert.equal(plan.proposed.serviceTicket.status, 'cancelled');
  assert.equal(plan.proposed.equipment.status, 'rented');
});

test('apply requires a verified backup', () => {
  const collections = baseCollections();
  const plan = buildAccidentalReturnRepairPlan(collections, { rentalId: 'R-target', now: NOW });

  assert.throws(
    () => applyAccidentalReturnRepairPlan(collections, plan, { backupVerified: false, now: NOW }),
    /backup is required/i,
  );
});

test('accidental return can be restored when service ticket is empty and created by return', () => {
  const collections = baseCollections();
  const plan = buildAccidentalReturnRepairPlan(collections, { rentalId: 'R-target', now: NOW });
  const result = applyAccidentalReturnRepairPlan(collections, plan, { backupVerified: true, now: NOW });

  const rental = result.collections.rentals.find(item => item.id === 'R-target');
  const gantt = result.collections.gantt_rentals.find(item => item.id === 'GR-target');
  const ticket = result.collections.service.find(item => item.id === 'S-target');
  const equipment = result.collections.equipment.find(item => item.id === 'EQ-1');

  assert.equal(rental.status, 'active');
  assert.equal(rental.actualReturnDate, undefined);
  assert.equal(gantt.status, 'active');
  assert.equal(gantt.rentalId, 'R-target');
  assert.equal(gantt.endDate, '2026-05-30');
  assert.equal(ticket.status, 'cancelled');
  assert.equal(ticket.archived, true);
  assert.match(ticket.archiveReason, /smoke-возвратом/);
  assert.equal(equipment.status, 'rented');
  assert.equal(equipment.currentClient, 'ООО Клиент');
  assert.equal(equipment.returnDate, '2026-05-30');
  assert.equal(result.collections.audit_logs.at(-1).action, 'accidental_return.restore');
});

test('service ticket is not physically deleted', () => {
  const collections = baseCollections();
  const plan = buildAccidentalReturnRepairPlan(collections, { rentalId: 'R-target', now: NOW });
  const result = applyAccidentalReturnRepairPlan(collections, plan, { backupVerified: true, now: NOW });

  assert.equal(result.collections.service.length, collections.service.length);
  assert.ok(result.collections.service.find(item => item.id === 'S-target'));
});

test('service ticket with works, photos, or parts is not cancelled automatically', () => {
  const collections = baseCollections({
    service: [{
      ...baseCollections().service[0],
      photos: ['https://example.test/photo.jpg'],
    }],
  });

  const plan = buildAccidentalReturnRepairPlan(collections, { rentalId: 'R-target', now: NOW });

  assert.equal(plan.ok, false);
  assert.match(plan.blockers.join('\n'), /service\.photos/);
  assert.throws(
    () => applyAccidentalReturnRepairPlan(collections, plan, { backupVerified: true, now: NOW }),
    /Repair is blocked/i,
  );
});

test('gantt_rentals remains linked to rentals after restore', () => {
  const collections = baseCollections();
  const plan = buildAccidentalReturnRepairPlan(collections, { rentalId: 'R-target', now: NOW });
  const result = applyAccidentalReturnRepairPlan(collections, plan, { backupVerified: true, now: NOW });

  const rentalIds = new Set(result.collections.rentals.map(item => item.id));
  const gantt = result.collections.gantt_rentals.find(item => item.id === 'GR-target');
  assert.equal(rentalIds.has(gantt.rentalId), true);
});

test('restore does not create orphan planner rows', () => {
  const collections = baseCollections();
  const plan = buildAccidentalReturnRepairPlan(collections, { rentalId: 'R-target', now: NOW });
  const result = applyAccidentalReturnRepairPlan(collections, plan, { backupVerified: true, now: NOW });

  assert.equal(result.collections.gantt_rentals.length, collections.gantt_rentals.length);
  const rentalIds = new Set(result.collections.rentals.map(item => item.id));
  const orphans = result.collections.gantt_rentals.filter(item => item.rentalId && !rentalIds.has(item.rentalId));
  assert.deepEqual(orphans, []);
});
