import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { buildServiceRepeatBreakdowns, buildServiceRepairQualityView, isFinishedTicket, serviceFinishedAt } = require('../server/lib/service-repeat-breakdowns.js');

function baseCollections() {
  return {
    equipment: [
      { id: 'EQ-1', manufacturer: 'Genie', model: 'Z-45', inventoryNumber: 'STG-REPEAT-001', status: 'in_service' },
      { id: 'EQ-2', manufacturer: 'JLG', model: '450AJ', inventoryNumber: 'STG-REPEAT-002', status: 'available' },
    ],
    mechanics: [{ id: 'M-1', name: 'Петров' }],
    tickets: [
      {
        id: 'S-prev-7',
        equipmentId: 'EQ-1',
        equipment: 'Genie Z-45',
        inventoryNumber: 'STG-REPEAT-001',
        status: 'closed',
        serviceKind: 'repair',
        reason: 'Течь гидравлики',
        assignedMechanicId: 'M-1',
        createdAt: '2026-05-01T08:00:00.000Z',
        closedAt: '2026-05-02T08:00:00.000Z',
      },
      {
        id: 'S-repeat-7',
        equipmentId: 'EQ-1',
        equipment: 'Genie Z-45',
        inventoryNumber: 'STG-REPEAT-001',
        status: 'in_progress',
        priority: 'high',
        serviceKind: 'repair',
        reason: 'Течь гидравлики',
        createdAt: '2026-05-05T08:00:00.000Z',
      },
      {
        id: 'S-other-equipment',
        equipmentId: 'EQ-2',
        status: 'in_progress',
        serviceKind: 'repair',
        reason: 'Течь гидравлики',
        createdAt: '2026-05-05T08:00:00.000Z',
      },
    ],
    workItems: [
      { id: 'RW-1', repairId: 'S-prev-7', workId: 'SW-hydraulic', nameSnapshot: 'Ремонт гидравлики', categorySnapshot: 'Гидравлика' },
      { id: 'RW-2', repairId: 'S-repeat-7', workId: 'SW-hydraulic', nameSnapshot: 'Ремонт гидравлики', categorySnapshot: 'Гидравлика' },
    ],
    partItems: [
      { id: 'RP-1', repairId: 'S-prev-7', partId: 'SP-seal', nameSnapshot: 'Манжета' },
      { id: 'RP-2', repairId: 'S-repeat-7', partId: 'SP-seal', nameSnapshot: 'Манжета' },
    ],
  };
}

test('repeat within 7 days is detected with high confidence and critical severity', () => {
  const result = buildServiceRepeatBreakdowns(baseCollections());
  const item = result.items.find(row => row.previousTicketId === 'S-prev-7' && row.repeatTicketId === 'S-repeat-7');

  assert.ok(item);
  assert.equal(item.daysBetween, 3);
  assert.equal(item.repeatWindow, 7);
  assert.equal(item.repeatSeverity, 'critical');
  assert.equal(item.confidence, 'high');
  assert.match(item.reason, /Похожая работа\/узел/);
  assert.equal(result.summary.repeatWithin7, 1);
});

test('repeat within 14 and 30 days is detected', () => {
  const collections = baseCollections();
  collections.tickets.push({
    id: 'S-prev-14',
    equipmentId: 'EQ-2',
    equipment: 'JLG 450AJ',
    status: 'closed',
    serviceKind: 'repair',
    reason: 'Шум редуктора',
    createdAt: '2026-05-01T08:00:00.000Z',
    closedAt: '2026-05-02T08:00:00.000Z',
  }, {
    id: 'S-repeat-14',
    equipmentId: 'EQ-2',
    equipment: 'JLG 450AJ',
    status: 'new',
    serviceKind: 'repair',
    reason: 'Проверить редуктор',
    createdAt: '2026-05-14T08:00:00.000Z',
  }, {
    id: 'S-repeat-30',
    equipmentId: 'EQ-2',
    equipment: 'JLG 450AJ',
    status: 'new',
    serviceKind: 'repair',
    reason: 'Проверить редуктор',
    createdAt: '2026-05-28T08:00:00.000Z',
  });

  const result = buildServiceRepeatBreakdowns(collections);

  assert.ok(result.items.some(item => item.previousTicketId === 'S-prev-14' && item.repeatTicketId === 'S-repeat-14' && item.repeatWindow === 14));
  assert.ok(result.items.some(item => item.previousTicketId === 'S-prev-14' && item.repeatTicketId === 'S-repeat-30' && item.repeatWindow === 30));
  assert.ok(result.summary.repeatWithin14 >= 1);
  assert.ok(result.summary.repeatWithin30 >= 3);
});

test('no repeat is created when equipment differs or previous ticket is not finished', () => {
  const collections = {
    equipment: [{ id: 'EQ-1' }, { id: 'EQ-2' }],
    tickets: [
      { id: 'S-open', equipmentId: 'EQ-1', status: 'in_progress', createdAt: '2026-05-01T08:00:00.000Z' },
      { id: 'S-new', equipmentId: 'EQ-1', status: 'new', createdAt: '2026-05-03T08:00:00.000Z' },
      { id: 'S-other', equipmentId: 'EQ-2', status: 'new', createdAt: '2026-05-03T08:00:00.000Z' },
    ],
  };

  const result = buildServiceRepeatBreakdowns(collections);

  assert.equal(result.items.length, 0);
});

test('ready ticket with finish date is treated as completed repair', () => {
  assert.equal(isFinishedTicket({ status: 'ready', closedAt: '2026-05-02T08:00:00.000Z' }), true);
  assert.equal(isFinishedTicket({ status: 'ready' }), false);
  assert.equal(serviceFinishedAt({ status: 'closed', completedAt: '2026-05-02T08:00:00.000Z' }), '2026-05-02T08:00:00.000Z');
});

test('confidence is low when only weak default scenario data matches', () => {
  const result = buildServiceRepeatBreakdowns({
    equipment: [{ id: 'EQ-1', model: 'Weak data model' }],
    tickets: [
      { id: 'S-prev', equipmentId: 'EQ-1', status: 'closed', reason: 'Неисправность', createdAt: '2026-05-01T08:00:00.000Z', closedAt: '2026-05-02T08:00:00.000Z' },
      { id: 'S-repeat', equipmentId: 'EQ-1', status: 'new', reason: 'Другая проблема', createdAt: '2026-05-06T08:00:00.000Z' },
    ],
  });

  assert.equal(result.items[0].confidence, 'low');
  assert.equal(result.items[0].repeatSeverity, 'medium');
});

test('groups are calculated by equipment model mechanic and scenario', () => {
  const result = buildServiceRepeatBreakdowns(baseCollections());

  assert.equal(result.groups.byEquipment[0].id, 'EQ-1');
  assert.equal(result.groups.byModel[0].label, 'Genie Z-45');
  assert.equal(result.groups.byMechanic[0].label, 'Петров');
  assert.equal(result.groups.byScenario[0].label, 'Ремонт');
  assert.equal(result.summary.topEquipmentCount, result.groups.byEquipment.length);
  assert.equal(result.summary.topModelCount, result.groups.byModel.length);
  assert.equal(result.summary.topMechanicCount, result.groups.byMechanic.length);
});

test('labels do not expose undefined null or object placeholders', () => {
  const result = buildServiceRepeatBreakdowns({
    equipment: [{ id: 'EQ-1', model: { bad: true } }],
    tickets: [
      { id: 'S-prev', equipmentId: 'EQ-1', equipment: { bad: true }, status: 'closed', createdAt: '2026-05-01T08:00:00.000Z', closedAt: '2026-05-02T08:00:00.000Z' },
      { id: 'S-repeat', equipmentId: 'EQ-1', equipment: undefined, status: 'new', createdAt: '2026-05-03T08:00:00.000Z' },
    ],
  });
  const serialized = JSON.stringify(result);

  assert.equal(serialized.includes('[object Object]'), false);
  assert.equal(serialized.includes('undefined'), false);
  assert.equal(serialized.includes('null'), false);
});

test('quality view returns safe summary equipment mechanics scenarios works and parts', () => {
  const result = buildServiceRepairQualityView(baseCollections());
  const serialized = JSON.stringify(result);

  assert.equal(result.ok, true);
  assert.equal(result.summary.totalRepeatCases, 1);
  assert.equal(result.summary.critical, 1);
  assert.equal(result.summary.affectedEquipment, 1);
  assert.equal(result.summary.affectedMechanics, 1);
  assert.equal(result.summary.topScenario, 'Ремонт');
  assert.equal(result.equipment[0].equipmentId, 'EQ-1');
  assert.equal(result.equipment[0].qualityRisk, 'critical');
  assert.match(result.equipment[0].recommendedAction, /разбор|диагност/i);
  assert.equal(result.mechanics[0].mechanicId, 'M-1');
  assert.equal(result.mechanics[0].repeatRelatedTickets, 1);
  assert.match(result.mechanics[0].note, /не персональная оценка вины/);
  assert.equal(result.scenarios[0].scenario, 'Ремонт');
  assert.equal(result.works[0].workName, 'Ремонт гидравлики');
  assert.equal(result.parts[0].partName, 'Манжета');
  assert.equal(/password|token|secret|hash|email|Bearer\s+/i.test(serialized), false);
  assert.equal(/undefined|null|\[object Object\]/.test(serialized), false);
});

test('quality view calculates high medium and clean control safely', () => {
  const collections = {
    equipment: [
      { id: 'EQ-high', model: 'High risk' },
      { id: 'EQ-medium', model: 'Medium risk' },
      { id: 'EQ-clean', model: 'Clean control' },
    ],
    mechanics: [{ id: 'M-1', name: 'Иванов' }],
    tickets: [
      { id: 'H-1', equipmentId: 'EQ-high', status: 'closed', reason: 'Шум редуктора', assignedMechanicId: 'M-1', createdAt: '2026-05-01T08:00:00.000Z', closedAt: '2026-05-02T08:00:00.000Z' },
      { id: 'H-2', equipmentId: 'EQ-high', status: 'new', reason: 'Шум редуктора', assignedMechanicId: 'M-1', createdAt: '2026-05-20T08:00:00.000Z' },
      { id: 'M-1', equipmentId: 'EQ-medium', status: 'closed', reason: 'Неисправность', createdAt: '2026-05-01T08:00:00.000Z', closedAt: '2026-05-02T08:00:00.000Z' },
      { id: 'M-2', equipmentId: 'EQ-medium', status: 'new', reason: 'Другая проблема', createdAt: '2026-05-18T08:00:00.000Z' },
      { id: 'C-1', equipmentId: 'EQ-clean', status: 'closed', reason: 'Контроль', createdAt: '2026-05-01T08:00:00.000Z', closedAt: '2026-05-02T08:00:00.000Z' },
    ],
  };
  const result = buildServiceRepairQualityView(collections);

  assert.equal(result.equipment.find(item => item.equipmentId === 'EQ-high')?.qualityRisk, 'high');
  assert.equal(result.equipment.find(item => item.equipmentId === 'EQ-medium')?.qualityRisk, 'medium');
  assert.equal(result.equipment.some(item => item.equipmentId === 'EQ-clean'), false);
});
