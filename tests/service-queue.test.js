import test from 'node:test';
import assert from 'node:assert/strict';

import { buildServiceQueue } from '../src/app/lib/serviceQueue.js';

test('service queue scores critical blockers and exposes safe metrics', () => {
  const queue = buildServiceQueue({
    today: '2026-05-02',
    canViewFinance: true,
    equipment: [
      { id: 'E-1', manufacturer: 'JLG', model: '1932R', inventoryNumber: 'INV-1', serialNumber: 'SN-1', status: 'in_service', priority: 'high', type: 'Ножничный' },
    ],
    rentals: [
      { id: 'R-1', equipmentId: 'E-1', clientId: 'C-1', client: 'ООО Клиент', startDate: '2026-05-01', endDate: '2026-05-10', status: 'active', amount: 90000 },
    ],
    serviceTickets: [
      { id: 'S-1', equipmentId: 'E-1', reason: 'Гидравлика', description: 'Не поднимается', priority: 'critical', status: 'in_progress', createdAt: '2026-04-20' },
      { id: 'S-old', equipmentId: 'E-1', reason: 'Гидравлика', priority: 'low', status: 'closed', createdAt: '2026-04-01' },
    ],
  });

  assert.equal(queue.metrics.totalOpen, 1);
  assert.equal(queue.metrics.critical, 1);
  assert.equal(queue.metrics.unassigned, 1);
  assert.equal(queue.metrics.olderThan7Days, 1);
  assert.equal(queue.rows[0].group, 'critical');
  assert.ok(queue.rows[0].score >= 120);
  assert.deepEqual(queue.rows[0].redFlags.includes('Техника в аренде при открытой заявке'), true);
  assert.equal(queue.rows[0].revenueRisk.amount, 10000);
});

test('service queue does not match duplicate inventory numbers by default', () => {
  const queue = buildServiceQueue({
    today: '2026-05-02',
    equipment: [
      { id: 'E-1', model: 'A', inventoryNumber: '0', serialNumber: 'SN-1', status: 'available' },
      { id: 'E-2', model: 'B', inventoryNumber: '0', serialNumber: 'SN-2', status: 'in_service' },
    ],
    serviceTickets: [
      { id: 'S-1', inventoryNumber: '0', reason: 'Неясно', priority: 'high', status: 'new', createdAt: '2026-05-01' },
    ],
  });

  assert.equal(queue.rows[0].equipmentId, '');
  assert.equal(queue.rows[0].equipmentStatus, 'unknown');
});

test('service queue can match serial number safely when inventory is duplicated', () => {
  const queue = buildServiceQueue({
    today: '2026-05-02',
    equipment: [
      { id: 'E-1', model: 'A', inventoryNumber: '0', serialNumber: 'SN-1', status: 'available' },
      { id: 'E-2', model: 'B', inventoryNumber: '0', serialNumber: 'SN-2', status: 'in_service' },
    ],
    serviceTickets: [
      { id: 'S-1', serialNumber: 'SN-2', inventoryNumber: '0', reason: 'Электрика', priority: 'medium', status: 'waiting_parts', createdAt: '2026-05-01', assignedMechanicName: 'Петров' },
    ],
  });

  assert.equal(queue.rows[0].equipmentId, 'E-2');
  assert.equal(queue.rows[0].equipmentStatus, 'in_service');
  assert.equal(queue.metrics.waitingParts, 1);
});

test('service queue handles legacy missing data and hides finance fields', () => {
  const queue = buildServiceQueue({
    today: '2026-05-02',
    canViewFinance: false,
    serviceTickets: [
      { id: 'S-legacy', reason: null, priority: null, status: null, createdAt: 'bad-date' },
    ],
  });

  assert.equal(queue.rows.length, 1);
  assert.equal(queue.rows[0].reason, 'Причина не указана');
  assert.equal(queue.rows[0].ageDays, 0);
  assert.equal(queue.rows[0].revenueRisk, null);
  const serialized = JSON.stringify(queue);
  assert.equal(serialized.includes('NaN'), false);
  assert.equal(serialized.includes('undefined'), false);
  assert.equal(serialized.includes('[object Object]'), false);
});
