import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';
import net from 'node:net';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const {
  STARTUP_BUSINESS_MAINTENANCE_ENV,
  STARTUP_GLOBAL_REFERENCE_COLLECTIONS,
  isStartupBusinessMaintenanceEnabled,
  seedSpareParts,
  startServer,
} = serverRequire('./lib/startup');
const { backfillPaymentAllocations } = serverRequire('./lib/finance-core');
const { createGprsGateway } = serverRequire('./lib/gprs-gateway');

function createStartupDeps(state, events) {
  const readData = name => state[name];
  const writeData = (name, value) => {
    const scope = events.activePlatformScope;
    if (!scope || !scope.writableCollections.includes(name)) {
      const error = new Error(`unscoped startup write: ${name}`);
      error.code = 'TEST_STARTUP_WRITE_OUTSIDE_PLATFORM_SCOPE';
      throw error;
    }
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
    migrateReferenceCollections: () => recordCall('migrateReferenceCollections'),
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
    stopGprsGateway: () => recordCall('stopGprsGateway'),
    stopWialonIpsGateway: () => recordCall('stopWialonIpsGateway'),
    dbPath: path.join(os.tmpdir(), 'startup-safety.sqlite'),
    botToken: 'test-token',
    runWithPlatformSystemScope: (scope, operation) => {
      events.platformScopes ||= [];
      events.platformScopes.push(structuredClone(scope));
      const previous = events.activePlatformScope;
      events.activePlatformScope = scope;
      try {
        return operation();
      } finally {
        events.activePlatformScope = previous;
      }
    },
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

  const events = { calls: [], writes: [], platformScopes: [], activePlatformScope: null };
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

test('startup business maintenance cannot be enabled by environment', () => {
  assert.deepEqual(STARTUP_GLOBAL_REFERENCE_COLLECTIONS, []);
  assert.equal(isStartupBusinessMaintenanceEnabled({}), false);
  assert.equal(isStartupBusinessMaintenanceEnabled({ [STARTUP_BUSINESS_MAINTENANCE_ENV]: 'true' }), false);
  assert.equal(isStartupBusinessMaintenanceEnabled({ [STARTUP_BUSINESS_MAINTENANCE_ENV]: 'apply' }), false);
});

test('spare-parts seed never replaces a pre-existing custom catalogue', t => {
  const seedsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-spare-parts-seed-'));
  t.after(() => fs.rmSync(seedsDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(seedsDir, 'spare_parts.json'), JSON.stringify([
    { id: 'GEN-1', article: 'GEN-1', name: 'Generic seed part' },
    { id: 'GEN-2', article: 'GEN-2', name: 'Second seed part' },
  ]));
  const custom = [{ id: 'CUSTOM-1', article: 'LOCAL-1', name: 'Custom production part' }];
  const state = { spare_parts: structuredClone(custom), spare_parts_catalog: [] };
  const writes = [];

  seedSpareParts({
    readData: name => state[name],
    writeDataBatch: entries => writes.push(...entries.map(entry => entry.name)),
    normalizeSparePartRecord: value => value,
    seedsDir,
    logger: { log: () => {}, warn: () => {} },
  });

  assert.deepEqual(state.spare_parts, custom);
  assert.deepEqual(state.spare_parts_catalog, []);
  assert.deepEqual(writes, []);
});

test('explicit tenant provisioning commits both spare-parts catalogues through one batch', t => {
  const seedsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-spare-parts-batch-'));
  t.after(() => fs.rmSync(seedsDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(seedsDir, 'spare_parts.json'), JSON.stringify([
    { id: 'GEN-1', article: 'GEN-1', name: 'Generic seed part' },
  ]));
  const state = { spare_parts: [], spare_parts_catalog: [] };
  const batches = [];

  seedSpareParts({
    readData: name => state[name],
    writeDataBatch: entries => {
      batches.push(structuredClone(entries));
      const staged = structuredClone(state);
      for (const entry of entries) staged[entry.name] = structuredClone(entry.value);
      Object.assign(state, staged);
    },
    normalizeSparePartRecord: value => ({ ...value, normalized: true }),
    seedsDir,
    logger: { log: () => {}, warn: () => {} },
  });

  assert.equal(batches.length, 1);
  assert.deepEqual(batches[0].map(entry => entry.name), ['spare_parts', 'spare_parts_catalog']);
  assert.deepEqual(state.spare_parts, [{ id: 'GEN-1', article: 'GEN-1', name: 'Generic seed part', normalized: true }]);
  assert.deepEqual(state.spare_parts_catalog, state.spare_parts);
});

test('explicit tenant provisioning failure leaves both spare-parts catalogues empty', t => {
  const seedsDir = fs.mkdtempSync(path.join(os.tmpdir(), 'startup-spare-parts-failure-'));
  t.after(() => fs.rmSync(seedsDir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(seedsDir, 'spare_parts.json'), JSON.stringify([
    { id: 'GEN-1', article: 'GEN-1', name: 'Generic seed part' },
  ]));
  const state = { spare_parts: [], spare_parts_catalog: [] };

  assert.throws(() => seedSpareParts({
    readData: name => state[name],
    writeDataBatch: () => { throw new Error('injected spare-parts seed batch failure'); },
    normalizeSparePartRecord: value => value,
    seedsDir,
    logger: { log: () => {}, warn: () => {} },
  }), /injected spare-parts seed batch failure/);
  assert.deepEqual(state, { spare_parts: [], spare_parts_catalog: [] });
});

test('server start permits only explicit system identity writes and never seeds tenant catalogues', async () => {
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
  assert.equal(events.calls.includes('migrateJsonFilesToDb'), false);
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
  assert.equal(events.calls.includes('migrateReferenceCollections'), false);
  assert.equal(events.calls.includes('migrateLegacyRepairFacts'), false);
  assert.equal(events.calls.includes('backfillPaymentAllocations'), false);
  assert.equal(events.calls.includes('normalizeClientLinks'), false);
  assert.equal(events.calls.includes('backfillGanttRentalLinks'), false);
  assert.equal(events.calls.includes('applyAdminResetFromEnv'), true);
  assert.equal(events.writes.some(event => event.name === 'repair_work_items'), false);
  assert.equal(events.writes.some(event => event.name === 'rentals'), false);
  assert.equal(events.writes.some(event => event.name === 'gantt_rentals'), false);
  assert.equal(events.writes.some(event => event.name === 'payment_allocations'), false);
  assert.equal(events.writes.some(event => event.name === 'crm_deals'), false);
  assert.deepEqual(state.service, original.service);
  assert.deepEqual(state.warranty_claims, original.warranty_claims);
  assert.equal(warnings.some(message => message.includes(`${STARTUP_BUSINESS_MAINTENANCE_ENV}=apply`)), true);
  assert.equal(events.platformScopes.some(scope => (
    scope.reason === 'startup-system-identity-bootstrap'
    && scope.writableCollections.join(',') === 'users'
  )), true);
  assert.equal(events.platformScopes.some(scope => scope.reason === 'startup-global-reference-bootstrap'), false);
  assert.equal(events.writes.some(event => [
    'knowledge_base_modules',
    'service_works',
    'spare_parts',
    'service_route_norms',
    'service_work_catalog',
    'spare_parts_catalog',
  ].includes(event.name)), false);
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

test('production validation read-only mode skips every startup mutation and transport hook', async () => {
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
      deps.productionScopeWriteFreezeEnabled = false;
      deps.productionValidationReadOnlyEnabled = true;
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
  assert.equal(events.calls.includes('migrateJsonFilesToDb'), false);
  assert.equal(events.calls.includes('cleanupExpiredSessions'), false);
  assert.equal(errors.some(message => message.includes('W-blocked')), true);
});

test('late startup failure closes the HTTP listener and rejects the startup promise', async () => {
  const state = {
    users: [],
    service_works: [{ id: 'SW-existing' }],
    knowledge_base_modules: [{ id: 'KB-existing' }],
    spare_parts: [{ id: 'SP-existing' }],
    spare_parts_catalog: [{ id: 'SP-existing' }],
    service_route_norms: [{ id: 'SR-existing' }],
    service: [],
  };
  const events = { calls: [], writes: [], platformScopes: [], activePlatformScope: null };
  const deps = createStartupDeps(state, events);
  const failure = Object.assign(new Error('injected webhook registration failure'), {
    code: 'INJECTED_WEBHOOK_FAILURE',
  });
  deps.registerWebhook = async () => { throw failure; };
  const app = express();
  const listen = app.listen.bind(app);
  let observedServer = null;
  app.listen = (...args) => {
    observedServer = listen(...args);
    return observedServer;
  };

  await assert.rejects(
    startServer({
      app,
      port: 0,
      deps,
      logger: { log: () => {}, warn: () => {}, error: () => {} },
    }),
    error => error === failure,
  );

  assert.ok(observedServer);
  assert.equal(observedServer.listening, false);
  assert.equal(events.calls.includes('startWebhookWatchdog'), false);
  assert.equal(events.calls.includes('startBotPolling'), false);
  assert.equal(events.calls.includes('startGprsGateway'), false);
  assert.equal(events.calls.includes('startWialonIpsGateway'), false);
  assert.equal(events.calls.includes('stopGprsGateway'), false);
  assert.equal(events.calls.includes('stopWialonIpsGateway'), false);
});

test('Wialon startup failure leaves HTTP and the healthy GPRS transport available', async () => {
  const state = {
    users: [],
    service_works: [{ id: 'SW-existing' }],
    knowledge_base_modules: [{ id: 'KB-existing' }],
    spare_parts: [{ id: 'SP-existing' }],
    spare_parts_catalog: [{ id: 'SP-existing' }],
    service_route_norms: [{ id: 'SR-existing' }],
    service: [],
  };
  const events = { calls: [], writes: [], platformScopes: [], activePlatformScope: null };
  const deps = createStartupDeps(state, events);
  const failure = Object.assign(new Error('injected Wialon startup failure'), {
    code: 'INJECTED_WIALON_STARTUP_FAILURE',
  });
  deps.startWialonIpsGateway = () => {
    events.calls.push('startWialonIpsGateway');
    throw failure;
  };
  const app = express();
  const listen = app.listen.bind(app);
  let observedServer = null;
  app.listen = (...args) => {
    observedServer = listen(...args);
    return observedServer;
  };

  const errors = [];
  const server = await startServer({
    app,
    port: 0,
    deps,
    logger: { log: () => {}, warn: () => {}, error: (...args) => errors.push(args) },
  });

  try {
    assert.equal(server, observedServer);
    assert.equal(observedServer.listening, true);
    assert.deepEqual(
      events.calls.filter(name => /^(start|stop)(GprsGateway|WialonIpsGateway)$/.test(name)),
      ['startGprsGateway', 'startWialonIpsGateway'],
    );
    assert.equal(errors.some(([message, details]) => (
      String(message).includes('Wialon IPS gateway unavailable')
      && details?.code === failure.code
    )), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('GPRS startup failure leaves HTTP and the healthy Wialon transport available', async () => {
  const state = {
    users: [],
    service_works: [{ id: 'SW-existing' }],
    knowledge_base_modules: [{ id: 'KB-existing' }],
    spare_parts: [{ id: 'SP-existing' }],
    spare_parts_catalog: [{ id: 'SP-existing' }],
    service_route_norms: [{ id: 'SR-existing' }],
    service: [],
  };
  const events = { calls: [], writes: [], platformScopes: [], activePlatformScope: null };
  const deps = createStartupDeps(state, events);
  const failure = Object.assign(new Error('injected GPRS startup failure'), {
    code: 'INJECTED_GPRS_STARTUP_FAILURE',
  });
  deps.startGprsGateway = () => {
    events.calls.push('startGprsGateway');
    throw failure;
  };
  const errors = [];
  const server = await startServer({
    app: express(),
    port: 0,
    deps,
    logger: { log: () => {}, warn: () => {}, error: (...args) => errors.push(args) },
  });

  try {
    assert.equal(server.listening, true);
    assert.deepEqual(
      events.calls.filter(name => /^(start|stop)(GprsGateway|WialonIpsGateway)$/.test(name)),
      ['startGprsGateway', 'startWialonIpsGateway'],
    );
    assert.equal(errors.some(([message, details]) => (
      String(message).includes('GPRS gateway unavailable')
      && details?.code === failure.code
    )), true);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('real occupied GPRS port degrades that transport while HTTP stays available', async (t) => {
  const occupied = net.createServer();
  await new Promise((resolve, reject) => {
    occupied.once('error', reject);
    occupied.listen(0, '127.0.0.1', resolve);
  });
  t.after(async () => {
    if (!occupied.listening) return;
    await new Promise(resolve => occupied.close(resolve));
  });
  const occupiedPort = occupied.address().port;
  const gateway = createGprsGateway({
    readData: () => [],
    writeData: () => {},
    writeDataBatch: () => {},
    resolveTrustedDeviceScope: () => {
      throw new Error('No packet should be processed during startup regression.');
    },
    withActorScope: (_scope, operation) => operation(),
    getCurrentScope: () => ({ companyId: 'COMPANY-A', tenantId: 'COMPANY-A' }),
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    host: '127.0.0.1',
    port: occupiedPort,
    enabled: true,
  });
  const state = {
    users: [],
    service_works: [{ id: 'SW-existing' }],
    knowledge_base_modules: [{ id: 'KB-existing' }],
    spare_parts: [{ id: 'SP-existing' }],
    spare_parts_catalog: [{ id: 'SP-existing' }],
    service_route_norms: [{ id: 'SR-existing' }],
    service: [],
  };
  const events = { calls: [], writes: [], platformScopes: [], activePlatformScope: null };
  const deps = createStartupDeps(state, events);
  deps.startGprsGateway = () => {
    events.calls.push('startGprsGateway');
    return gateway.start();
  };
  deps.stopGprsGateway = () => {
    events.calls.push('stopGprsGateway');
    return gateway.stop();
  };
  const app = express();
  const listen = app.listen.bind(app);
  let observedServer = null;
  app.listen = (...args) => {
    observedServer = listen(...args);
    return observedServer;
  };

  const server = await startServer({
    app,
    port: 0,
    deps,
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  try {
    assert.equal(server, observedServer);
    assert.equal(observedServer.listening, true);
    assert.match(gateway.getStatus().startError, /EADDRINUSE|address already in use/i);
    assert.deepEqual(
      events.calls.filter(name => /^(start|stop)(GprsGateway|WialonIpsGateway)$/.test(name)),
      ['startGprsGateway', 'startWialonIpsGateway'],
    );
  } finally {
    await new Promise(resolve => server.close(resolve));
    await gateway.stop();
  }
});

test('STARTUP_BUSINESS_MAINTENANCE=apply cannot enable unscoped business mutation', async () => {
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

  assert.equal(events.calls.includes('migrateJsonFilesToDb'), false);
  assert.equal(events.calls.includes('ensureClientCounterpartyFoundation'), false);
  assert.equal(events.calls.includes('ensureClientObjectCounterpartyLinks'), false);
  assert.equal(events.calls.includes('auditCounterpartyRoleProfiles'), true);
  assert.equal(events.calls.includes('auditCounterpartyRelations'), true);
  assert.equal(events.calls.includes('cleanupExpiredSessions'), true);
  assert.equal(events.calls.includes('migrateReferenceCollections'), false);
  assert.equal(events.calls.includes('migrateLegacyRepairFacts'), false);
  assert.equal(events.calls.includes('backfillPaymentAllocations'), false);
  assert.equal(events.calls.includes('normalizeClientLinks'), false);
  assert.equal(events.calls.includes('backfillGanttRentalLinks'), false);
  assert.equal(events.writes.some(event => event.name === 'rentals'), false);
  assert.equal(events.writes.some(event => event.name === 'gantt_rentals'), false);
  assert.deepEqual(state.crm_deals, [{ id: 'CRM-1' }]);
  assert.equal(state.app_settings[0].value.status, 'archived');
});

test('STARTUP_BUSINESS_MAINTENANCE=apply never runs payment allocation backfill', async () => {
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

  assert.deepEqual(state.payment_allocations, []);
  assert.equal(events.calls.includes('backfillPaymentAllocations'), false);
  assert.equal(events.writes.filter(event => event.name === 'payment_allocations').length, 0);
  assert.equal(events.backfillInput, undefined);
  assert.equal(warnings.some(message => message.includes('scoped maintenance runner')), true);
});
