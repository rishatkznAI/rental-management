#!/usr/bin/env node

const {
  appDataValueFingerprint,
  DB_PATH,
  ensureDb,
  setDataBatchCompareAndSwap,
} = require('../db');
const {
  assertDisposableFixtureDatabase,
  parseAppDataValue,
  requiredText,
} = require('../lib/maintenance-script-safety');
const {
  applyEquipmentGsmConfigurationProjection,
} = require('../lib/gsm/trusted-device-scope');
const {
  GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
  hashGsmIngressSecret,
} = require('../lib/gsm/device-credential');

const PREFIX = 'STG-READINESS-';
const ACTION_PREFIX = 'STG-ACTION-';
const STAGING_FIXTURE_GSM_CREDENTIAL_HASH = hashGsmIngressSecret(
  'staging-fixture-gsm-credential',
  { salt: Buffer.from('73746167696e672d67736d2d66697831', 'hex') },
);

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
  assertDisposableFixtureDatabase({ dbPath: env.DB_PATH, env, kind: 'staging' });
  const companyId = requiredText(env.STAGING_COMPANY_ID, 'STAGING_COMPANY_ID');
  const tenantId = requiredText(env.STAGING_TENANT_ID, 'STAGING_TENANT_ID');
  if (companyId !== tenantId) {
    throw new Error('Refused: STAGING_COMPANY_ID and STAGING_TENANT_ID must identify the same canonical tenant.');
  }
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function hasFixtureId(record) {
  const id = String(record?.id || '');
  return id.startsWith(PREFIX) || id.startsWith(ACTION_PREFIX);
}

function hasFixtureDocument(record) {
  return hasFixtureId(record) || String(record?.documentNumber || record?.number || '').startsWith(PREFIX);
}

function planFixtureReplacement(collectionName, fixtures, predicate = hasFixtureId) {
  const row = ensureDb().prepare('SELECT json FROM app_data WHERE name = ?').get(collectionName);
  const stored = parseAppDataValue(row, collectionName, { expected: 'array', missing: [] });
  const current = asArray(stored);
  const kept = current.filter(item => !predicate(item));
  const next = [...kept, ...fixtures];
  return {
    entry: {
      name: collectionName,
      value: next,
      expectedFingerprint: appDataValueFingerprint(row ? stored : null),
    },
    result: { collection: collectionName, removed: current.length - kept.length, upserted: fixtures.length, total: next.length },
  };
}

function buildFixtures(now = new Date()) {
  const iso = now.toISOString();
  const staleIso = new Date(now.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString();
  const futureIso = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const todayIso = iso.slice(0, 10);
  const closedIso = new Date(now.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const overdueIso = new Date(now.getTime() - 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
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
      base('GSM', 'GSM Lift 18', 'available', {
        gsmDeviceRecordId: `${PREFIX}GSM-DEVICE-0001`,
        gsmImei: `${PREFIX}IMEI-0001`,
        gsmLastSeenAt: staleIso,
      }),
      base('CHECK', 'Return Check Lift 20', 'available'),
      base('DOC', 'Document Lift 22', 'available', { plannedMonthlyRevenue: 150000 }),
      base('ACTION-LOSS', 'Action Loss Lift 26', 'in_service', { plannedMonthlyRevenue: 900000 }),
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
      {
        id: `${PREFIX}RENTAL-ACTION-LOSS-HISTORY`,
        rentalId: `${PREFIX}RENTAL-ACTION-LOSS-HISTORY`,
        equipmentId: `${PREFIX}EQ-ACTION-LOSS`,
        equipmentInv: `${PREFIX}INV-ACTION-LOSS`,
        status: 'closed',
        clientId: `${PREFIX}CLIENT-TEST`,
        client: 'STAGING TEST CLIENT',
        clientName: 'STAGING TEST CLIENT',
        startDate: historicalStart,
        endDate: historicalEnd,
        actualReturnDate: historicalEnd,
        dailyRate: 30000,
        amount: 210000,
        price: 210000,
        notes: 'STAGING TEST FIXTURE: high loss action queue case.',
        fixtureTag: PREFIX,
        updatedAt: iso,
      },
    ],
    service: [
      {
        id: `${PREFIX}SERVICE-OPEN`,
        equipmentId: `${PREFIX}EQ-SERVICE`,
        equipmentInv: `${PREFIX}INV-SERVICE`,
        status: 'in_progress',
        title: 'STAGING TEST FIXTURE: readiness service ticket',
        description: 'STAGING TEST FIXTURE. No real customer data.',
        createdAt: blockedStart,
        updatedAt: iso,
        fixtureTag: PREFIX,
      },
      {
        id: `${PREFIX}SERVICE-ACTION-LOSS`,
        equipmentId: `${PREFIX}EQ-ACTION-LOSS`,
        equipmentInv: `${PREFIX}INV-ACTION-LOSS`,
        status: 'new',
        title: 'STAGING TEST FIXTURE: high loss action queue ticket',
        description: 'STAGING TEST FIXTURE. No real customer data.',
        createdAt: blockedStart,
        updatedAt: iso,
        fixtureTag: PREFIX,
      },
    ],
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
    gsmDevices: [{
      id: `${PREFIX}GSM-DEVICE-0001`,
      equipmentId: `${PREFIX}EQ-GSM`,
      imei: `${PREFIX}IMEI-0001`,
      deviceId: `${PREFIX}DEVICE-0001`,
      deviceType: 'STAGING-TEST',
      protocol: 'GPRS TCP',
      ingressMode: GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
      ingressSecretHash: STAGING_FIXTURE_GSM_CREDENTIAL_HASH,
      ingressCredentialConfigured: true,
      ingressCredentialRevision: 1,
      status: 'offline',
      lastPacketAt: staleIso,
      lastOnlineAt: staleIso,
      createdAt: staleIso,
      updatedAt: staleIso,
      fixtureTag: PREFIX,
    }],
    gsmPackets: [{
      id: `${PREFIX}GSM-STALE`,
      equipmentId: `${PREFIX}EQ-GSM`,
      gsmDeviceRecordId: `${PREFIX}GSM-DEVICE-0001`,
      gsmBindingRevision: 1,
      imei: `${PREFIX}IMEI-0001`,
      deviceTime: staleIso,
      receivedAt: staleIso,
      direction: 'inbound',
      parseStatus: 'parsed',
      rawPreview: 'STAGING TEST FIXTURE',
      fixtureTag: PREFIX,
    }],
    managementActionStates: [
      {
        id: `${ACTION_PREFIX}STATE-SERVICE-UNASSIGNED`,
        actionId: `equipment_readiness:${PREFIX}EQ-SERVICE:in_service`,
        sourceType: 'equipment_readiness',
        sourceKey: `${PREFIX}EQ-SERVICE`,
        equipmentId: `${PREFIX}EQ-SERVICE`,
        status: 'open',
        assignedToUserId: '',
        assignedToName: '',
        dueDate: futureIso,
        comment: 'STAGING TEST FIXTURE: open critical action. No real customer data.',
        updatedByUserId: 'staging-fixture',
        updatedAt: iso,
        createdAt: iso,
        fixtureTag: PREFIX,
      },
      {
        id: `${ACTION_PREFIX}STATE-DELIVERY-STALE-IN-PROGRESS`,
        actionId: `equipment_readiness:${PREFIX}EQ-DELIVERY:delivery_blocked`,
        sourceType: 'equipment_readiness',
        sourceKey: `${PREFIX}EQ-DELIVERY`,
        equipmentId: `${PREFIX}EQ-DELIVERY`,
        status: 'in_progress',
        assignedToUserId: `${PREFIX}USER-MANAGER`,
        assignedToName: 'STAGING TEST MANAGER',
        dueDate: futureIso,
        comment: 'STAGING TEST FIXTURE: carrier follow-up in progress.',
        updatedByUserId: 'staging-fixture',
        updatedAt: staleIso,
        createdAt: staleIso,
        fixtureTag: PREFIX,
      },
      {
        id: `${ACTION_PREFIX}STATE-GSM-DUE-TODAY`,
        actionId: `equipment_readiness:${PREFIX}EQ-GSM:gsm_attention`,
        sourceType: 'equipment_readiness',
        sourceKey: `${PREFIX}EQ-GSM`,
        equipmentId: `${PREFIX}EQ-GSM`,
        status: 'postponed',
        assignedToUserId: '',
        assignedToName: 'STAGING TEST TECH',
        dueDate: todayIso,
        comment: 'STAGING TEST FIXTURE: check after planned network window.',
        updatedByUserId: 'staging-fixture',
        updatedAt: iso,
        createdAt: iso,
        fixtureTag: PREFIX,
      },
      {
        id: `${ACTION_PREFIX}STATE-DOC-OVERDUE`,
        actionId: `equipment_readiness:${PREFIX}EQ-DOC:document_blocked`,
        sourceType: 'equipment_readiness',
        sourceKey: `${PREFIX}EQ-DOC`,
        equipmentId: `${PREFIX}EQ-DOC`,
        status: 'open',
        assignedToUserId: '',
        assignedToName: '',
        dueDate: overdueIso,
        comment: 'STAGING TEST FIXTURE: overdue document action.',
        updatedByUserId: 'staging-fixture',
        updatedAt: iso,
        createdAt: iso,
        fixtureTag: PREFIX,
      },
      {
        id: `${ACTION_PREFIX}STATE-CHECK-RESOLVED`,
        actionId: `equipment_readiness:${PREFIX}EQ-CHECK:needs_check`,
        sourceType: 'equipment_readiness',
        sourceKey: `${PREFIX}EQ-CHECK`,
        equipmentId: `${PREFIX}EQ-CHECK`,
        status: 'resolved',
        assignedToUserId: '',
        assignedToName: 'STAGING TEST MANAGER',
        dueDate: closedIso,
        comment: 'STAGING TEST FIXTURE: resolved manually for UI verification.',
        updatedByUserId: 'staging-fixture',
        updatedAt: iso,
        createdAt: iso,
        fixtureTag: PREFIX,
      },
      {
        id: `${ACTION_PREFIX}STATE-HIGH-LOSS-UNASSIGNED`,
        actionId: `equipment_readiness:${PREFIX}EQ-ACTION-LOSS:in_service`,
        sourceType: 'equipment_readiness',
        sourceKey: `${PREFIX}EQ-ACTION-LOSS`,
        equipmentId: `${PREFIX}EQ-ACTION-LOSS`,
        status: 'open',
        assignedToUserId: '',
        assignedToName: '',
        dueDate: futureIso,
        comment: 'STAGING TEST FIXTURE: high loss action without assignee.',
        updatedByUserId: 'staging-fixture',
        updatedAt: iso,
        createdAt: iso,
        fixtureTag: PREFIX,
      },
    ],
  };
}

function canonicalizeStagingGsmFixtures(fixtures, scope) {
  const scoped = list => list.map(item => ({ ...item, ...scope }));
  const scopedGsmDevices = scoped(fixtures.gsmDevices).map(device => ({
    ...device,
    bindingRevision: 1,
    bindingHistory: [{
      revision: 1,
      equipmentId: device.equipmentId,
      companyId: scope.companyId,
      tenantId: scope.tenantId,
      imei: device.imei || null,
      deviceId: device.deviceId || null,
      linkedAt: device.lastOnlineAt || device.lastPacketAt || null,
      unlinkedAt: null,
      reason: 'staging_fixture_provisioned',
    }],
  }));
  const gsmDeviceByEquipmentId = new Map(
    scopedGsmDevices.map(device => [device.equipmentId, device]),
  );
  const scopedEquipment = scoped(fixtures.equipment).map((record) => {
    const device = gsmDeviceByEquipmentId.get(record.id);
    return device ? applyEquipmentGsmConfigurationProjection(record, device) : record;
  });
  return { equipment: scopedEquipment, gsmDevices: scopedGsmDevices };
}

function seedStagingReadinessFixtures({ env = process.env, now = new Date() } = {}) {
  assertStagingFixtureSeedAllowed(env);
  const fixtures = buildFixtures(now);
  const scope = { companyId: String(env.STAGING_COMPANY_ID).trim(), tenantId: String(env.STAGING_TENANT_ID).trim() };
  const scoped = list => list.map(item => ({ ...item, ...scope }));
  const canonicalGsm = canonicalizeStagingGsmFixtures(fixtures, scope);
  const plans = [
    planFixtureReplacement('equipment', canonicalGsm.equipment),
    planFixtureReplacement('rentals', scoped(fixtures.rentals)),
    planFixtureReplacement('service', scoped(fixtures.service)),
    planFixtureReplacement('deliveries', scoped(fixtures.deliveries)),
    planFixtureReplacement('documents', scoped(fixtures.documents), hasFixtureDocument),
    planFixtureReplacement('gsm_devices', canonicalGsm.gsmDevices),
    planFixtureReplacement('gsm_packets', scoped(fixtures.gsmPackets)),
    planFixtureReplacement('management_action_states', scoped(fixtures.managementActionStates)),
  ];
  setDataBatchCompareAndSwap(plans.map(plan => plan.entry));
  const results = plans.map(plan => plan.result);
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

module.exports = {
  PREFIX,
  assertStagingFixtureSeedAllowed,
  buildFixtures,
  canonicalizeStagingGsmFixtures,
  planFixtureReplacement,
  seedStagingReadinessFixtures,
};
