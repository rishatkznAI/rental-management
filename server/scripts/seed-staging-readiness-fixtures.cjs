#!/usr/bin/env node

const { DB_PATH, getData, setData } = require('../db');

const PREFIX = 'STG-READINESS-';

function envText(env = process.env) {
  return [
    env.APP_ENVIRONMENT,
    env.APP_ENV,
    env.RAILWAY_ENVIRONMENT_NAME,
    env.RAILWAY_ENVIRONMENT,
    env.RAILWAY_PROJECT_NAME,
    env.RAILWAY_SERVICE_NAME,
    env.NODE_ENV,
  ].filter(Boolean).join(' ').toLowerCase();
}

function isProductionLike(env = process.env) {
  const text = envText(env);
  return /\bprod(uction)?\b/.test(text) && !/\bstag(e|ing)?\b/.test(text);
}

function isStagingLike(env = process.env) {
  return /\bstag(e|ing)?\b/.test(envText(env));
}

function assertStagingFixtureSeedAllowed(env = process.env) {
  if (String(env.ALLOW_STAGING_FIXTURE_SEED || '').trim() !== 'true') {
    throw new Error('Refused: set ALLOW_STAGING_FIXTURE_SEED=true to seed staging fixtures.');
  }
  if (!isStagingLike(env)) throw new Error('Refused: environment is not clearly staging.');
  if (isProductionLike(env)) throw new Error('Refused: environment looks production-like.');
  if (String(env.APP_DISABLED || '').trim().toLowerCase() === 'true' && isProductionLike(env)) {
    throw new Error('Refused: APP_DISABLED=true with production-like environment.');
  }
  if (env.RAILWAY_PROJECT_NAME && env.RAILWAY_PROJECT_NAME !== 'cooperative-vitality') {
    throw new Error('Refused: Railway project is not cooperative-vitality.');
  }
  if (env.RAILWAY_SERVICE_NAME && env.RAILWAY_SERVICE_NAME !== 'rental-management') {
    throw new Error('Refused: Railway service is not rental-management.');
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasFixtureId(record) {
  return String(record?.id || '').startsWith(PREFIX);
}

function hasFixtureDocument(record) {
  return hasFixtureId(record) || String(record?.documentNumber || record?.number || '').startsWith(PREFIX);
}

function replaceFixtures(collectionName, fixtures, predicate = hasFixtureId) {
  const current = asArray(getData(collectionName));
  const kept = current.filter(item => !predicate(item));
  const next = [...kept, ...fixtures];
  setData(collectionName, next);
  return { collection: collectionName, removed: current.length - kept.length, upserted: fixtures.length, total: next.length };
}

function buildFixtures(now = new Date()) {
  const iso = now.toISOString();
  const staleIso = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const futureIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const closedIso = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const historicalStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const historicalEnd = new Date(now.getTime() - 24 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const blockedStart = new Date(now.getTime() - 4 * 24 * 60 * 60 * 1000).toISOString();
  const base = (suffix, model, status, extra = {}) => ({
    id: `${PREFIX}EQ-${suffix}`,
    inventoryNumber: `${PREFIX}INV-${suffix}`,
    serialNumber: `${PREFIX}SN-${suffix}`,
    manufacturer: 'Skytech Test',
    model,
    status,
    notes: `STAGING TEST FIXTURE: fleet readiness ${suffix.toLowerCase()} state.`,
    fixtureTag: PREFIX,
    updatedAt: iso,
    ...extra,
  });

  return {
    equipment: [
      base('READY', 'Ready Lift 10', 'available'),
      base('RENTED', 'Rental Lift 12', 'rented'),
      base('SERVICE', 'Service Lift 14', 'in_service', { plannedMonthlyRevenue: 210000 }),
      base('DELIVERY', 'Delivery Lift 16', 'available', { plannedMonthlyRevenue: 240000 }),
      base('GSM', 'GSM Lift 18', 'available', { gsmImei: `${PREFIX}IMEI-0001`, gsmLastSeenAt: staleIso }),
      base('CHECK', 'Return Check Lift 20', 'available'),
      base('DOC', 'Document Lift 22', 'available', { plannedMonthlyRevenue: 150000 }),
      base('UNKNOWN', 'Legacy Lift 24', 'legacy_hold'),
    ],
    rentals: [
      {
        id: `${PREFIX}RENTAL-ACTIVE`,
        rentalId: `${PREFIX}RENTAL-ACTIVE`,
        equipmentId: `${PREFIX}EQ-RENTED`,
        equipmentInv: `${PREFIX}INV-RENTED`,
        status: 'active',
        clientId: `${PREFIX}CLIENT-TEST`,
        client: 'STAGING TEST CLIENT',
        clientName: 'STAGING TEST CLIENT',
        startDate: iso.slice(0, 10),
        endDate: futureIso,
        rate: '9000 ₽/день',
        amount: 72000,
        price: 72000,
        notes: 'STAGING TEST FIXTURE: active rental for readiness.',
        fixtureTag: PREFIX,
        updatedAt: iso,
      },
      {
        id: `${PREFIX}RENTAL-SERVICE-HISTORY`,
        rentalId: `${PREFIX}RENTAL-SERVICE-HISTORY`,
        equipmentId: `${PREFIX}EQ-SERVICE`,
        equipmentInv: `${PREFIX}INV-SERVICE`,
        status: 'closed',
        clientId: `${PREFIX}CLIENT-TEST`,
        client: 'STAGING TEST CLIENT',
        clientName: 'STAGING TEST CLIENT',
        startDate: historicalStart,
        endDate: historicalEnd,
        actualReturnDate: historicalEnd,
        rate: '7000 ₽/день',
        amount: 49000,
        price: 49000,
        notes: 'STAGING TEST FIXTURE: historical rate for downtime loss.',
        fixtureTag: PREFIX,
        updatedAt: iso,
      },
      {
        id: `${PREFIX}RENTAL-DELIVERY-HISTORY`,
        rentalId: `${PREFIX}RENTAL-DELIVERY-HISTORY`,
        equipmentId: `${PREFIX}EQ-DELIVERY`,
        equipmentInv: `${PREFIX}INV-DELIVERY`,
        status: 'closed',
        clientId: `${PREFIX}CLIENT-TEST`,
        client: 'STAGING TEST CLIENT',
        clientName: 'STAGING TEST CLIENT',
        startDate: historicalStart,
        endDate: historicalEnd,
        actualReturnDate: historicalEnd,
        dailyRate: 8000,
        amount: 56000,
        price: 56000,
        notes: 'STAGING TEST FIXTURE: historical rate for downtime loss.',
        fixtureTag: PREFIX,
        updatedAt: iso,
      },
      {
        id: `${PREFIX}RENTAL-DOC-HISTORY`,
        rentalId: `${PREFIX}RENTAL-DOC-HISTORY`,
        equipmentId: `${PREFIX}EQ-DOC`,
        equipmentInv: `${PREFIX}INV-DOC`,
        status: 'closed',
        clientId: `${PREFIX}CLIENT-TEST`,
        client: 'STAGING TEST CLIENT',
        clientName: 'STAGING TEST CLIENT',
        startDate: historicalStart,
        endDate: historicalEnd,
        actualReturnDate: historicalEnd,
        monthlyRate: 150000,
        amount: 35000,
        price: 35000,
        notes: 'STAGING TEST FIXTURE: historical rate for downtime loss.',
        fixtureTag: PREFIX,
        updatedAt: iso,
      },
      {
        id: `${PREFIX}RENTAL-CLOSED`,
        rentalId: `${PREFIX}RENTAL-CLOSED`,
        equipmentId: `${PREFIX}EQ-CHECK`,
        equipmentInv: `${PREFIX}INV-CHECK`,
        status: 'closed',
        clientId: `${PREFIX}CLIENT-TEST`,
        client: 'STAGING TEST CLIENT',
        clientName: 'STAGING TEST CLIENT',
        startDate: new Date(now.getTime() - 12 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10),
        endDate: closedIso,
        actualReturnDate: closedIso,
        amount: 0,
        notes: 'STAGING TEST FIXTURE: closed rental without receiving photos.',
        fixtureTag: PREFIX,
        updatedAt: iso,
      },
    ],
    service: [{
      id: `${PREFIX}SERVICE-OPEN`,
      equipmentId: `${PREFIX}EQ-SERVICE`,
      equipmentInv: `${PREFIX}INV-SERVICE`,
      status: 'in_progress',
      title: 'STAGING TEST FIXTURE: readiness service ticket',
      description: 'STAGING TEST FIXTURE. No real customer data.',
      createdAt: blockedStart,
      updatedAt: iso,
      fixtureTag: PREFIX,
    }],
    deliveries: [{
      id: `${PREFIX}DELIVERY-ACTIVE`,
      equipmentId: `${PREFIX}EQ-DELIVERY`,
      equipmentInv: `${PREFIX}INV-DELIVERY`,
      rentalId: `${PREFIX}RENTAL-DELIVERY-LINK`,
      status: 'in_transit',
      type: 'delivery',
      cargo: 'STAGING TEST FIXTURE equipment delivery',
      address: 'STAGING TEST ADDRESS',
      scheduledDate: blockedStart.slice(0, 10),
      createdAt: blockedStart,
      updatedAt: iso,
      fixtureTag: PREFIX,
    }],
    documents: [{
      id: `${PREFIX}DOC-BLOCKED`,
      documentNumber: `${PREFIX}DOC-BLOCKED`,
      equipmentId: `${PREFIX}EQ-DOC`,
      inventoryNumber: `${PREFIX}INV-DOC`,
      status: 'missing',
      type: 'readiness_test_document',
      title: 'STAGING TEST FIXTURE: missing equipment document',
      createdAt: blockedStart,
      updatedAt: iso,
      fixtureTag: PREFIX,
    }],
    gsmPackets: [{
      id: `${PREFIX}GSM-STALE`,
      equipmentId: `${PREFIX}EQ-GSM`,
      imei: `${PREFIX}IMEI-0001`,
      deviceTime: staleIso,
      receivedAt: staleIso,
      parseStatus: 'ok',
      rawPreview: 'STAGING TEST FIXTURE',
      fixtureTag: PREFIX,
    }],
  };
}

function seedStagingReadinessFixtures({ env = process.env, now = new Date() } = {}) {
  assertStagingFixtureSeedAllowed(env);
  const fixtures = buildFixtures(now);
  const results = [
    replaceFixtures('equipment', fixtures.equipment),
    replaceFixtures('rentals', fixtures.rentals),
    replaceFixtures('service', fixtures.service),
    replaceFixtures('deliveries', fixtures.deliveries),
    replaceFixtures('documents', fixtures.documents, hasFixtureDocument),
    replaceFixtures('gsm_packets', fixtures.gsmPackets),
  ];
  return {
    ok: true,
    dbPath: DB_PATH,
    prefix: PREFIX,
    results,
    botEnabled: String(env.BOT_DISABLED || '').trim().toLowerCase() === 'false',
    gsmEnabled: String(env.GSM_ENABLED || '').trim().toLowerCase() === 'true' && String(env.GSM_DISABLED || '').trim().toLowerCase() !== 'true',
  };
}

if (require.main === module) {
  try {
    console.log(JSON.stringify(seedStagingReadinessFixtures(), null, 2));
  } catch (error) {
    console.error(error.message || error);
    process.exitCode = 2;
  }
}

module.exports = { PREFIX, assertStagingFixtureSeedAllowed, buildFixtures, seedStagingReadinessFixtures };
