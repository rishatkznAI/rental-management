import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  buildMechanicWorkloadReport,
  calculateWorkAmount,
} = require('../server/lib/mechanic-workload');

const mechanics = [
  { id: 'M-1', name: 'Иван Механик', status: 'active' },
  { id: 'M-2', name: 'Пётр Механик', status: 'active' },
];

const equipment = [
  { id: 'E-1', manufacturer: 'Skyjack', model: 'SJIII', inventoryNumber: 'INV-1', serialNumber: 'SN-1', type: 'ножничный' },
];

const tickets = [
  { id: 'S-1', status: 'closed', equipmentId: 'E-1', assignedMechanicId: 'M-1', createdAt: '2026-02-01T09:00:00Z' },
  { id: 'S-2', status: 'in_progress', equipmentId: 'E-1', assignedMechanicId: 'M-2', createdAt: '2026-03-01T09:00:00Z' },
  { id: 'S-3', status: 'closed', equipmentId: 'E-1', assignedMechanicId: 'M-1', createdAt: '2026-02-02T09:00:00Z' },
];

test('calculateWorkAmount supports hourly, fixed and no_pay formulas', () => {
  assert.equal(calculateWorkAmount({ payType: 'hourly_norm', normHours: 2, rate: 1500, quantity: 3 }), 9000);
  assert.equal(calculateWorkAmount({ payType: 'fixed', fixedAmount: 5000, quantity: 2 }), 10000);
  assert.equal(calculateWorkAmount({ payType: 'no_pay', normHours: 10, rate: 10000, quantity: 2 }), 0);
});

test('completed works are accrued and cancelled/rejected works are skipped', () => {
  const report = buildMechanicWorkloadReport({
    tickets,
    equipment,
    mechanics,
    workItems: [
      { id: 'W-1', serviceTicketId: 'S-1', mechanicId: 'M-1', equipmentId: 'E-1', status: 'completed', normHours: 2, rate: 1000, quantity: 2, completedAt: '2026-02-10T10:00:00Z' },
      { id: 'W-2', serviceTicketId: 'S-1', mechanicId: 'M-1', equipmentId: 'E-1', status: 'cancelled', normHours: 8, rate: 1000, quantity: 1, completedAt: '2026-02-10T10:00:00Z' },
      { id: 'W-3', serviceTicketId: 'S-1', mechanicId: 'M-1', equipmentId: 'E-1', status: 'rejected', normHours: 8, rate: 1000, quantity: 1, completedAt: '2026-02-10T10:00:00Z' },
    ],
  }, { dateFrom: '2026-02-01', dateTo: '2026-02-28' });

  assert.equal(report.kpi.completedWorks, 1);
  assert.equal(report.mechanics[0].totalNormHours, 4);
  assert.equal(report.mechanics[0].totalAmount, 4000);
});

test('fixed and no_pay works are reflected without requiring hourly rate', () => {
  const report = buildMechanicWorkloadReport({
    tickets,
    equipment,
    mechanics,
    workItems: [
      { id: 'W-1', serviceTicketId: 'S-1', mechanicId: 'M-1', equipmentId: 'E-1', status: 'completed', payType: 'fixed', fixedAmount: 2500, quantity: 2, completedAt: '2026-02-10T10:00:00Z' },
      { id: 'W-2', serviceTicketId: 'S-1', mechanicId: 'M-1', equipmentId: 'E-1', status: 'completed', payType: 'no_pay', normHours: 3, rate: 1000, quantity: 1, completedAt: '2026-02-11T10:00:00Z' },
    ],
  }, { dateFrom: '2026-02-01', dateTo: '2026-02-28' });

  assert.equal(report.kpi.completedWorks, 2);
  assert.equal(report.mechanics[0].totalAmount, 5000);
  assert.equal(report.warnings.some(item => item.workId === 'W-2' && item.type === 'zero_amount'), false);
});

test('missing mechanic and missing norm hours are surfaced as warnings', () => {
  const report = buildMechanicWorkloadReport({
    tickets: [{ id: 'S-4', status: 'in_progress', equipmentId: 'E-1', createdAt: '2026-02-01T09:00:00Z' }],
    equipment,
    mechanics,
    workItems: [
      { id: 'W-1', serviceTicketId: 'S-4', equipmentId: 'E-1', status: 'completed', normHours: 0, rate: 1000, quantity: 1, completedAt: '2026-02-10T10:00:00Z' },
    ],
  }, { dateFrom: '2026-02-01', dateTo: '2026-02-28' });

  assert.ok(report.warnings.some(item => item.type === 'missing_mechanic'));
  assert.ok(report.warnings.some(item => item.type === 'missing_norm_hours'));
});

test('report is filtered by selected month period', () => {
  const report = buildMechanicWorkloadReport({
    tickets,
    equipment,
    mechanics,
    workItems: [
      { id: 'W-1', serviceTicketId: 'S-1', mechanicId: 'M-1', equipmentId: 'E-1', status: 'completed', normHours: 1, rate: 1000, quantity: 1, completedAt: '2026-02-15T10:00:00Z' },
      { id: 'W-2', serviceTicketId: 'S-2', mechanicId: 'M-2', equipmentId: 'E-1', status: 'completed', normHours: 5, rate: 1000, quantity: 1, completedAt: '2026-03-15T10:00:00Z' },
    ],
  }, { dateFrom: '2026-02-01', dateTo: '2026-02-28' });

  assert.equal(report.kpi.completedWorks, 1);
  assert.equal(report.mechanics[0].mechanicId, 'M-1');
  assert.ok(report.warnings.some(item => item.workId === 'W-2' && item.type === 'outside_period'));
});

test('legacy work items without catalog id do not break the report', () => {
  const report = buildMechanicWorkloadReport({
    tickets,
    equipment,
    mechanics,
    workItems: [
      { id: 'W-legacy', repairId: 'S-1', mechanicId: 'M-1', equipmentId: 'E-1', quantity: 1, normHoursSnapshot: 1.5, ratePerHourSnapshot: 1200, nameSnapshot: 'Legacy work', createdAt: '2026-02-15T10:00:00Z' },
    ],
  }, { dateFrom: '2026-02-01', dateTo: '2026-02-28' });

  assert.equal(report.kpi.completedWorks, 1);
  assert.equal(report.details[0].source, 'legacy');
  assert.equal(report.mechanics[0].totalAmount, 1800);
});

test('closed ticket with unfinished work creates accounting warning', () => {
  const report = buildMechanicWorkloadReport({
    tickets,
    equipment,
    mechanics,
    workItems: [
      { id: 'W-1', serviceTicketId: 'S-3', mechanicId: 'M-1', equipmentId: 'E-1', status: 'in_progress', normHours: 1, rate: 1000, quantity: 1, completedAt: '2026-02-15T10:00:00Z' },
    ],
  }, { dateFrom: '2026-02-01', dateTo: '2026-02-28' });

  assert.ok(report.warnings.some(item => item.type === 'closed_ticket_unfinished_work' && item.serviceTicketId === 'S-3'));
});
