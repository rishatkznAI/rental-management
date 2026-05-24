import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const {
  STARTUP_BUSINESS_MAINTENANCE_ENV,
  isStartupBusinessMaintenanceEnabled,
  startServer,
} = serverRequire('./lib/startup');

function createStartupDeps(state, events) {
  const readData = name => state[name];
  const writeData = (name, value) => {
    events.writes.push({ name, value });
    state[name] = value;
  };
  const recordCall = name => {
    events.calls.push(name);
  };

  return {
    migrateJsonFilesToDb: () => recordCall('migrateJsonFilesToDb'),
    cleanupExpiredSessions: () => recordCall('cleanupExpiredSessions'),
    seedDefaultUsers: () => recordCall('seedDefaultUsers'),
    ensureLegacyDefaultUsers: () => recordCall('ensureLegacyDefaultUsers'),
    migrateReferenceCollections: () => {
      recordCall('migrateReferenceCollections');
      writeData('repair_work_items', [{ id: 'RW-startup' }]);
    },
    migrateLegacyRepairFacts: () => {
      recordCall('migrateLegacyRepairFacts');
      writeData('repair_part_items', [{ id: 'RP-startup' }]);
    },
    backfillPaymentAllocations: () => {
      recordCall('backfillPaymentAllocations');
      return { created: 1, allocations: [{ id: 'PA-startup', paymentId: 'P-1', rentalId: 'R-1' }] };
    },
    backfillServiceTicketCreatedAt: () => ({ stats: { missingCreatedAt: 0 } }),
    normalizeClientLinks: () => {
      recordCall('normalizeClientLinks');
      writeData('rentals', [{ ...state.rentals[0], clientId: 'C-startup' }]);
    },
    backfillGanttRentalLinks: () => {
      recordCall('backfillGanttRentalLinks');
      writeData('gantt_rentals', [{ ...state.gantt_rentals[0], rentalId: 'R-1' }]);
    },
    logGanttRentalLinkDiagnostics: () => recordCall('logGanttRentalLinkDiagnostics'),
    applyAdminResetFromEnv: () => recordCall('applyAdminResetFromEnv'),
    registerWebhook: async () => recordCall('registerWebhook'),
    startWebhookWatchdog: () => recordCall('startWebhookWatchdog'),
    startBotPolling: () => recordCall('startBotPolling'),
    startGprsGateway: () => recordCall('startGprsGateway'),
    startWialonIpsGateway: () => recordCall('startWialonIpsGateway'),
    dbPath: path.join(os.tmpdir(), 'startup-safety.sqlite'),
    botToken: 'test-token',
    readData,
    writeData,
    normalizeServiceWorkRecord: item => item,
    normalizeSparePartRecord: item => item,
    seedsDir: path.join(os.tmpdir(), 'missing-startup-safety-seeds'),
  };
}

async function startAndClose({ state, envValue, logger }) {
  const previous = process.env[STARTUP_BUSINESS_MAINTENANCE_ENV];
  if (envValue === undefined) delete process.env[STARTUP_BUSINESS_MAINTENANCE_ENV];
  else process.env[STARTUP_BUSINESS_MAINTENANCE_ENV] = envValue;

  const events = { calls: [], writes: [] };
  const app = express();
  const server = await startServer({
    app,
    port: 0,
    deps: createStartupDeps(state, events),
    logger,
  });

  try {
    await new Promise(resolve => setTimeout(resolve, 50));
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env[STARTUP_BUSINESS_MAINTENANCE_ENV];
    else process.env[STARTUP_BUSINESS_MAINTENANCE_ENV] = previous;
  }

  return events;
}

test('startup business maintenance is opt-in', () => {
  assert.equal(isStartupBusinessMaintenanceEnabled({}), false);
  assert.equal(isStartupBusinessMaintenanceEnabled({ [STARTUP_BUSINESS_MAINTENANCE_ENV]: 'true' }), false);
  assert.equal(isStartupBusinessMaintenanceEnabled({ [STARTUP_BUSINESS_MAINTENANCE_ENV]: 'apply' }), true);
});

test('server start disables only business maintenance by default', async () => {
  const original = {
    rentals: [{ id: 'R-1', client: 'Legacy Client' }],
    gantt_rentals: [{ id: 'GR-1' }],
    payments: [{ id: 'P-1', rentalId: 'R-1', amount: 100, status: 'paid' }],
    payment_allocations: [],
    documents: [{ id: 'D-1', client: 'Legacy Client' }],
    crm_deals: [{ id: 'CRM-1' }],
    service: [{ id: 'S-1' }],
    app_settings: [{ key: 'crm_archive_state', value: { status: 'archived', archivedAt: '2020-01-01T00:00:00.000Z' } }],
    knowledge_base_progress: [],
  };
  const state = structuredClone(original);
  const warnings = [];

  const events = await startAndClose({
    state,
    envValue: undefined,
    logger: {
      log: () => {},
      warn: message => warnings.push(String(message)),
    },
  });

  assert.deepEqual(state.rentals, original.rentals);
  assert.deepEqual(state.gantt_rentals, original.gantt_rentals);
  assert.deepEqual(state.payment_allocations, original.payment_allocations);
  assert.deepEqual(state.documents, original.documents);
  assert.deepEqual(state.crm_deals, original.crm_deals);
  assert.equal(events.calls.includes('migrateJsonFilesToDb'), true);
  assert.equal(events.calls.includes('cleanupExpiredSessions'), true);
  assert.equal(events.calls.includes('seedDefaultUsers'), true);
  assert.equal(events.calls.includes('ensureLegacyDefaultUsers'), true);
  assert.equal(events.calls.includes('migrateReferenceCollections'), true);
  assert.equal(events.calls.includes('migrateLegacyRepairFacts'), false);
  assert.equal(events.calls.includes('backfillPaymentAllocations'), false);
  assert.equal(events.calls.includes('normalizeClientLinks'), false);
  assert.equal(events.calls.includes('backfillGanttRentalLinks'), false);
  assert.equal(events.calls.includes('applyAdminResetFromEnv'), true);
  assert.equal(events.writes.some(event => event.name === 'repair_work_items'), true);
  assert.equal(events.writes.some(event => event.name === 'rentals'), false);
  assert.equal(events.writes.some(event => event.name === 'gantt_rentals'), false);
  assert.equal(events.writes.some(event => event.name === 'payment_allocations'), false);
  assert.equal(events.writes.some(event => event.name === 'crm_deals'), false);
  assert.equal(warnings.some(message => message.includes(`${STARTUP_BUSINESS_MAINTENANCE_ENV}=apply`)), true);
});

test('STARTUP_BUSINESS_MAINTENANCE=apply runs business maintenance after startup essentials', async () => {
  const state = {
    rentals: [{ id: 'R-1', client: 'Legacy Client' }],
    gantt_rentals: [{ id: 'GR-1' }],
    payments: [{ id: 'P-1', rentalId: 'R-1', amount: 100, status: 'paid' }],
    payment_allocations: [],
    documents: [{ id: 'D-1', client: 'Legacy Client' }],
    crm_deals: [{ id: 'CRM-1' }],
    service: [{ id: 'S-1' }],
    app_settings: [{ key: 'crm_archive_state', value: { status: 'archived', archivedAt: '2020-01-01T00:00:00.000Z' } }],
  };

  const events = await startAndClose({
    state,
    envValue: 'apply',
    logger: {
      log: () => {},
      warn: () => {},
    },
  });

  assert.equal(events.calls.includes('migrateJsonFilesToDb'), true);
  assert.equal(events.calls.includes('cleanupExpiredSessions'), true);
  assert.equal(events.calls.includes('migrateReferenceCollections'), true);
  assert.equal(events.calls.includes('migrateLegacyRepairFacts'), true);
  assert.equal(events.calls.includes('backfillPaymentAllocations'), true);
  assert.equal(events.calls.includes('normalizeClientLinks'), true);
  assert.equal(events.calls.includes('backfillGanttRentalLinks'), true);
  assert.deepEqual(state.crm_deals, []);
  assert.equal(state.app_settings[0].value.status, 'deleted');
});
