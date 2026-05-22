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

  const criticalTickets = [
    ticketBase('CRITICAL-1', 'CRITICAL', 'closed', 10, {
      reason: 'STG-SERVICE-REPEAT hydraulic leak',
      closedAt: daysAgo(now, 9),
      completedAt: daysAgo(now, 9),
      resultData: { completedAt: daysAgo(now, 9) },
    }),
    ticketBase('CRITICAL-2', 'CRITICAL', 'closed', 7, {
      reason: 'STG-SERVICE-REPEAT hydraulic leak',
      closedAt: daysAgo(now, 6),
      completedAt: daysAgo(now, 6),
      resultData: { completedAt: daysAgo(now, 6) },
    }),
    ticketBase('CRITICAL-3', 'CRITICAL', 'in_progress', 4, {
      priority: 'critical',
      reason: 'STG-SERVICE-REPEAT hydraulic leak',
    }),
  ];
  const highTickets = [
    ticketBase('HIGH-1', 'HIGH', 'closed', 25, {
      reason: 'STG-SERVICE-REPEAT steering drift',
      closedAt: daysAgo(now, 24),
      completedAt: daysAgo(now, 24),
    }),
    ticketBase('HIGH-2', 'HIGH', 'new', 8, {
      reason: 'STG-SERVICE-REPEAT steering drift',
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

  const qualityWorkTickets = [...criticalTickets, ...highTickets];
  const qualityWorkItems = qualityWorkTickets.map((ticket, index) => ({
    id: `${SERVICE_PREFIX}WORK-QUALITY-${index + 1}`,
    repairId: ticket.id,
    serviceTicketId: ticket.id,
    workId: ticket.id.includes('CRITICAL')
      ? `${SERVICE_PREFIX}WORK-HYDRAULIC`
      : ticket.id.includes('HIGH')
        ? `${SERVICE_PREFIX}WORK-STEERING`
        : `${SERVICE_PREFIX}WORK-DIAGNOSTICS`,
    nameSnapshot: ticket.id.includes('CRITICAL')
      ? 'STG-SERVICE-REPEAT hydraulic inspection'
      : ticket.id.includes('HIGH')
        ? 'STG-SERVICE-REPEAT steering adjustment'
        : 'STG-SERVICE-REPEAT diagnostic check',
    categorySnapshot: 'STG-SERVICE-REPEAT quality control',
    quantity: 1,
    fixtureTag: SERVICE_PREFIX,
    updatedAt: iso,
  }));
  const qualityPartItems = [...criticalTickets, ...highTickets].map((ticket, index) => ({
    id: `${SERVICE_PREFIX}PART-QUALITY-${index + 1}`,
    repairId: ticket.id,
    serviceTicketId: ticket.id,
    partId: ticket.id.includes('CRITICAL') ? `${SERVICE_PREFIX}PART-SEAL` : `${SERVICE_PREFIX}PART-BUSHING`,
    nameSnapshot: ticket.id.includes('CRITICAL') ? 'STG-SERVICE-REPEAT seal kit' : 'STG-SERVICE-REPEAT bushing kit',
    articleSnapshot: ticket.id.includes('CRITICAL') ? `${SERVICE_PREFIX}SEAL-KIT` : `${SERVICE_PREFIX}BUSHING-KIT`,
    quantity: 1,
    priceSnapshot: 0,
    fixtureTag: SERVICE_PREFIX,
    updatedAt: iso,
  }));

  return {
    equipment: [
      equipmentBase('CRITICAL', 'STG-REPEAT Critical Quality Lift', 'in_service'),
      equipmentBase('HIGH', 'STG-REPEAT High Repeat Lift', 'in_service'),
      equipmentBase('MEDIUM', 'STG-REPEAT Medium Repeat Lift', 'available'),
      equipmentBase('CONTROL', 'STG-REPEAT Control Lift', 'available'),
    ],
    service: [...criticalTickets, ...highTickets, ...mediumTickets, ...controlTickets],
    repairWorkItems: qualityWorkItems,
    repairPartItems: qualityPartItems,
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
