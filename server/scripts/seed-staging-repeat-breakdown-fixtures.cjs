#!/usr/bin/env node

const { DB_PATH, getData, setData } = require('../db');
const { assertStagingFixtureSeedAllowed } = require('./seed-staging-readiness-fixtures.cjs');

const EQUIPMENT_PREFIX = 'STG-REPEAT-';
const SERVICE_PREFIX = 'STG-SERVICE-REPEAT-';

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function daysAgo(now, days) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function hasRepeatFixtureId(record) {
  const id = String(record?.id || '');
  return id.startsWith(EQUIPMENT_PREFIX) || id.startsWith(SERVICE_PREFIX);
}

function hasRepeatFixtureServiceLink(record) {
  const repairId = String(record?.repairId || record?.serviceTicketId || '');
  return hasRepeatFixtureId(record) || repairId.startsWith(SERVICE_PREFIX);
}

function replaceRepeatFixtures(collectionName, fixtures, predicate = hasRepeatFixtureId) {
  const current = asArray(getData(collectionName));
  const kept = current.filter(item => !predicate(item));
  const next = [...kept, ...fixtures];
  setData(collectionName, next);
  return {
    collection: collectionName,
    removed: current.length - kept.length,
    upserted: fixtures.length,
    total: next.length,
  };
}

function buildRepeatBreakdownFixtures(now = new Date()) {
  const iso = now.toISOString();
  const equipmentBase = (suffix, model, status) => ({
    id: `${EQUIPMENT_PREFIX}EQ-${suffix}`,
    inventoryNumber: `${EQUIPMENT_PREFIX}INV-${suffix}`,
    serialNumber: `${EQUIPMENT_PREFIX}SN-${suffix}`,
    manufacturer: 'Skytech Staging',
    model,
    status,
    notes: `STAGING TEST FIXTURE: repeat breakdown ${suffix.toLowerCase()} scenario. No real customer data.`,
    fixtureTag: EQUIPMENT_PREFIX,
    updatedAt: iso,
  });
  const ticketBase = (suffix, equipmentSuffix, status, createdDaysAgo, extra = {}) => ({
    id: `${SERVICE_PREFIX}${suffix}`,
    number: `${SERVICE_PREFIX}${suffix}`,
    equipmentId: `${EQUIPMENT_PREFIX}EQ-${equipmentSuffix}`,
    equipment: `Skytech Staging ${equipmentSuffix} Lift`,
    inventoryNumber: `${EQUIPMENT_PREFIX}INV-${equipmentSuffix}`,
    status,
    serviceKind: 'repair',
    assignedMechanicId: `${SERVICE_PREFIX}MECHANIC-QA`,
    assignedMechanicName: 'STAGING TEST MECHANIC',
    title: `STAGING TEST FIXTURE: repeat breakdown ${suffix}`,
    description: 'STAGING TEST FIXTURE. No real client, phone, email, bot, or GSM data.',
    createdAt: daysAgo(now, createdDaysAgo),
    updatedAt: iso,
    fixtureTag: SERVICE_PREFIX,
    ...extra,
  });

  const highTickets = [
    ticketBase('HIGH-1', 'HIGH', 'closed', 10, {
      reason: 'STG-SERVICE-REPEAT hydraulic leak',
      closedAt: daysAgo(now, 9),
      completedAt: daysAgo(now, 9),
      resultData: { completedAt: daysAgo(now, 9) },
    }),
    ticketBase('HIGH-2', 'HIGH', 'closed', 7, {
      reason: 'STG-SERVICE-REPEAT hydraulic leak',
      closedAt: daysAgo(now, 6),
      completedAt: daysAgo(now, 6),
      resultData: { completedAt: daysAgo(now, 6) },
    }),
    ticketBase('HIGH-3', 'HIGH', 'in_progress', 4, {
      priority: 'critical',
      reason: 'STG-SERVICE-REPEAT hydraulic leak',
    }),
  ];
  const mediumTickets = [
    ticketBase('MEDIUM-1', 'MEDIUM', 'closed', 19, {
      reason: 'STG-SERVICE-REPEAT lift drift',
      closedAt: daysAgo(now, 18),
      completedAt: daysAgo(now, 18),
    }),
    ticketBase('MEDIUM-2', 'MEDIUM', 'new', 7, {
      reason: 'STG-SERVICE-REPEAT platform drift check',
    }),
  ];
  const controlTickets = [
    ticketBase('CONTROL-1', 'CONTROL', 'closed', 5, {
      reason: 'STG-SERVICE-REPEAT one-off control',
      closedAt: daysAgo(now, 4),
      completedAt: daysAgo(now, 4),
    }),
  ];

  const highWorkItems = highTickets.map((ticket, index) => ({
    id: `${SERVICE_PREFIX}WORK-HIGH-${index + 1}`,
    repairId: ticket.id,
    serviceTicketId: ticket.id,
    workId: `${SERVICE_PREFIX}WORK-HYDRAULIC`,
    nameSnapshot: 'STG-SERVICE-REPEAT hydraulic inspection',
    categorySnapshot: 'STG-SERVICE-REPEAT hydraulic system',
    quantity: 1,
    fixtureTag: SERVICE_PREFIX,
    updatedAt: iso,
  }));
  const highPartItems = highTickets.map((ticket, index) => ({
    id: `${SERVICE_PREFIX}PART-HIGH-${index + 1}`,
    repairId: ticket.id,
    serviceTicketId: ticket.id,
    partId: `${SERVICE_PREFIX}PART-SEAL`,
    nameSnapshot: 'STG-SERVICE-REPEAT seal kit',
    articleSnapshot: `${SERVICE_PREFIX}SEAL-KIT`,
    quantity: 1,
    priceSnapshot: 0,
    fixtureTag: SERVICE_PREFIX,
    updatedAt: iso,
  }));

  return {
    equipment: [
      equipmentBase('HIGH', 'STG-REPEAT High Repeat Lift', 'in_service'),
      equipmentBase('MEDIUM', 'STG-REPEAT Medium Repeat Lift', 'available'),
      equipmentBase('CONTROL', 'STG-REPEAT Control Lift', 'available'),
    ],
    service: [...highTickets, ...mediumTickets, ...controlTickets],
    repairWorkItems: highWorkItems,
    repairPartItems: highPartItems,
  };
}

function seedStagingRepeatBreakdownFixtures({ env = process.env, now = new Date() } = {}) {
  assertStagingFixtureSeedAllowed(env);
  const fixtures = buildRepeatBreakdownFixtures(now);
  const results = [
    replaceRepeatFixtures('equipment', fixtures.equipment),
    replaceRepeatFixtures('service', fixtures.service),
    replaceRepeatFixtures('repair_work_items', fixtures.repairWorkItems, hasRepeatFixtureServiceLink),
    replaceRepeatFixtures('repair_part_items', fixtures.repairPartItems, hasRepeatFixtureServiceLink),
  ];
  return {
    ok: true,
    dbPath: DB_PATH,
    prefixes: {
      equipment: EQUIPMENT_PREFIX,
      service: SERVICE_PREFIX,
    },
    results,
    botEnabled: String(env.BOT_DISABLED || '').trim().toLowerCase() === 'false',
    gsmEnabled: String(env.GSM_ENABLED || '').trim().toLowerCase() === 'true' && String(env.GSM_DISABLED || '').trim().toLowerCase() !== 'true',
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(seedStagingRepeatBreakdownFixtures(), null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 2;
  }
}

module.exports = {
  EQUIPMENT_PREFIX,
  SERVICE_PREFIX,
  buildRepeatBreakdownFixtures,
  seedStagingRepeatBreakdownFixtures,
};
