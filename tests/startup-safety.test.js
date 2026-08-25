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
const { backfillPaymentAllocations } = serverRequire('./lib/finance-core');

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
    ensureClientCounterpartyFoundation: () => recordCall('ensureClientCounterpartyFoundation'),
    ensureClientObjectCounterpartyLinks: () => recordCall('ensureClientObjectCounterpartyLinks'),
    auditCounterpartyRoleProfiles: () => {
      recordCall('auditCounterpartyRoleProfiles');
      return { errors: [], warnings: [], roleRemovalConstraints: [], summary: { errors: 0, warnings: 0, blockedRoleRemovals: 0 } };
    },
    auditCounterpartyRelations: () => {
      recordCall('auditCounterpartyRelations');
      return { healthy: [], repairable: [], broken: [], summary: { healthy: 0, repairable: 0, broken: 0 } };
    },
    auditServiceCounterpartyRelations: () => {
      recordCall('auditServiceCounterpartyRelations');
      return {
        entries: [{ classification: 'internal_unlinked_valid', recordId: 'S-1' }],
        summary: {
          broken: 0,
          classifications: { already_canonical: 0, internal_unlinked_valid: 1, deterministic_repair: 0 },
        },
      };
    },
    auditWarrantyClaimCounterpartyRelations: () => {
      recordCall('auditWarrantyClaimCounterpartyRelations');
      return {
        entries: [{ classification: 'deterministic_repair', recordId: 'W-1', repairability: 'deterministic_stable_id_chain' }],
        summary: {
          broken: 0,
          classifications: {
            already_canonical: 0,
            internal_unlinked_valid: 0,
            canonical_terminal_history: 0,
            deterministic_repair: 1,
          },
        },
      };
    },
    auditWarrantyClaimFactoryCounterpartyRelations: () => {
      recordCall('auditWarrantyClaimFactoryCounterpartyRelations');
      return {
        strictRolloutReady: true,
        strictRolloutBlockers: [],
        summary: {
          broken: 0,
          activeExternalUnresolved: 0,
          classifications: {
            canonical: 0,
            valid_pre_external_draft: 1,
            canonical_terminal_history: 0,
            unresolved_terminal_historical_snapshot: 0,
          },
        },
      };
    },
    writeDataBatch: entries => {
      for (const entry of entries || []) writeData(entry.name, entry.value);
    },
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
    backfillPaymentAllocations: input => {
      recordCall('backfillPaymentAllocations');
      events.backfillInput = input;
      return {
        created: 1,
        allocations: [{ id: 'PA-startup', paymentId: 'P-1', rentalId: 'R-1' }],
        summary: {
          created: 1,
          alreadyAllocated: 0,
          notEligible: 0,
          unresolvedPayment: 0,
          unresolvedRental: 0,
          ambiguous: 0,
          crossCounterparty: 0,
          missingEndpoint: 0,
          otherBlockers: 0,
        },
      };
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

async function startAndClose({ state, envValue, logger, configureDeps }) {
  const previous = process.env[STARTUP_BUSINESS_MAINTENANCE_ENV];
  if (envValue === undefined) delete process.env[STARTUP_BUSINESS_MAINTENANCE_ENV];
  else process.env[STARTUP_BUSINESS_MAINTENANCE_ENV] = envValue;

  const events = { calls: [], writes: [] };
  const app = express();
  const deps = createStartupDeps(state, events);
  configureDeps?.(deps, events);
  const server = await startServer({
    app,
    port: 0,
    deps,
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
    warranty_claims: [{ id: 'W-1', serviceTicketId: 'S-1' }],
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
  assert.equal(events.calls.includes('ensureClientCounterpartyFoundation'), false);
  assert.equal(events.calls.includes('ensureClientObjectCounterpartyLinks'), false);
  assert.equal(events.calls.includes('auditCounterpartyRoleProfiles'), true);
  assert.equal(events.calls.includes('auditCounterpartyRelations'), true);
  assert.equal(events.calls.includes('auditServiceCounterpartyRelations'), true);
  assert.equal(events.calls.includes('auditWarrantyClaimCounterpartyRelations'), true);
  assert.equal(events.calls.includes('auditWarrantyClaimFactoryCounterpartyRelations'), true);
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
  assert.deepEqual(state.service, original.service);
  assert.deepEqual(state.warranty_claims, original.warranty_claims);
  assert.equal(warnings.some(message => message.includes(`${STARTUP_BUSINESS_MAINTENANCE_ENV}=apply`)), true);
});

test('production scope write freeze skips every startup mutation hook', async () => {
  const state = {
    rentals: [],
    gantt_rentals: [],
    payments: [],
    payment_allocations: [],
    documents: [],
    crm_deals: [],
    service: [],
    warranty_claims: [],
    app_settings: [],
    knowledge_base_progress: [],
  };
  const events = await startAndClose({
    state,
    envValue: 'apply',
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    configureDeps(deps) {
      deps.productionScopeWriteFreezeEnabled = true;
    },
  });
  for (const forbidden of [
    'migrateJsonFilesToDb',
    'cleanupExpiredSessions',
    'seedDefaultUsers',
    'ensureLegacyDefaultUsers',
    'migrateReferenceCollections',
    'migrateLegacyRepairFacts',
    'backfillPaymentAllocations',
    'applyAdminResetFromEnv',
    'registerWebhook',
    'startWebhookWatchdog',
    'startBotPolling',
    'startGprsGateway',
    'startWialonIpsGateway',
  ]) {
    assert.equal(events.calls.includes(forbidden), false, forbidden);
  }
  assert.deepEqual(events.writes, []);
});

test('startup refuses to listen when active external Warranty factory relations are unresolved', async () => {
  const state = { warranty_claims: [{ id: 'W-blocked', status: 'factory_review' }] };
  const events = { calls: [], writes: [] };
  const deps = createStartupDeps(state, events);
  deps.auditWarrantyClaimFactoryCounterpartyRelations = () => ({
    strictRolloutReady: false,
    strictRolloutBlockers: [{
      recordId: 'W-blocked',
      classification: 'blocked_manual_mapping',
      code: 'WARRANTY_FACTORY_RELATION_REQUIRED',
    }],
    summary: { broken: 1, activeExternalUnresolved: 1, classifications: {} },
  });
  const errors = [];
  await assert.rejects(
    startServer({
      app: express(),
      port: 0,
      deps,
      logger: { log: () => {}, warn: () => {}, error: message => errors.push(String(message)) },
    }),
    error => error.code === 'WARRANTY_FACTORY_STRICT_ROLLOUT_BLOCKED',
  );
  assert.equal(events.calls.includes('migrateJsonFilesToDb'), true);
  assert.equal(events.calls.includes('cleanupExpiredSessions'), false);
  assert.equal(errors.some(message => message.includes('W-blocked')), true);
});

test('STARTUP_BUSINESS_MAINTENANCE=apply does not run Counterparty identity auto-repair', async () => {
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
  assert.equal(events.calls.includes('ensureClientCounterpartyFoundation'), false);
  assert.equal(events.calls.includes('ensureClientObjectCounterpartyLinks'), false);
  assert.equal(events.calls.includes('auditCounterpartyRoleProfiles'), true);
  assert.equal(events.calls.includes('auditCounterpartyRelations'), true);
  assert.equal(events.calls.includes('cleanupExpiredSessions'), true);
  assert.equal(events.calls.includes('migrateReferenceCollections'), true);
  assert.equal(events.calls.includes('migrateLegacyRepairFacts'), true);
  assert.equal(events.calls.includes('backfillPaymentAllocations'), true);
  assert.equal(events.calls.includes('normalizeClientLinks'), false);
  assert.equal(events.calls.includes('backfillGanttRentalLinks'), false);
  assert.equal(events.writes.some(event => event.name === 'rentals'), false);
  assert.equal(events.writes.some(event => event.name === 'gantt_rentals'), false);
  assert.deepEqual(state.crm_deals, []);
  assert.equal(state.app_settings[0].value.status, 'deleted');
});

test('STARTUP_BUSINESS_MAINTENANCE=apply passes canonical authority and persists only safe allocation candidates', async () => {
  const state = {
    rentals: [
      { id: 'R-A', counterpartyId: 'CP-A' },
      { id: 'R-B', counterpartyId: 'CP-B' },
    ],
    gantt_rentals: [],
    payments: [
      { id: 'P-SAFE', rentalId: 'R-A', counterpartyId: 'CP-A', amount: 100, paidAmount: 100, status: 'paid' },
      { id: 'P-CROSS', rentalId: 'R-B', counterpartyId: 'CP-A', amount: 100, paidAmount: 100, status: 'paid' },
    ],
    payment_allocations: [],
    documents: [],
    clients: [],
    counterparties: [
      { id: 'CP-A', roles: ['customer'], status: 'active' },
      { id: 'CP-B', roles: ['customer'], status: 'active' },
    ],
    counterparty_role_assignments: [],
    crm_deals: [],
    service: [],
    warranty_claims: [],
    app_settings: [],
    knowledge_base_progress: [],
  };
  const warnings = [];

  const events = await startAndClose({
    state,
    envValue: 'apply',
    logger: {
      log: () => {},
      warn: message => warnings.push(String(message)),
    },
    configureDeps(deps, startupEvents) {
      deps.backfillPaymentAllocations = input => {
        startupEvents.calls.push('backfillPaymentAllocations');
        startupEvents.backfillInput = input;
        return backfillPaymentAllocations(input);
      };
    },
  });

  assert.deepEqual(state.payment_allocations.map(item => [item.paymentId, item.rentalId]), [
    ['P-SAFE', 'R-A'],
  ]);
  assert.equal(events.writes.filter(event => event.name === 'payment_allocations').length, 1);
  assert.equal(events.backfillInput.rentals, state.rentals);
  assert.equal(events.backfillInput.ganttRentals, state.gantt_rentals);
  assert.equal(events.backfillInput.clients, state.clients);
  assert.equal(events.backfillInput.counterparties, state.counterparties);
  assert.equal(events.backfillInput.counterpartyRoleAssignments, state.counterparty_role_assignments);
  assert.equal(warnings.some(message => (
    message.includes('payment_allocations backfill summary: created=1')
    && message.includes('crossCounterparty=1')
  )), true);
});
