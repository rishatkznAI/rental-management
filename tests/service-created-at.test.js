import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const Database = serverRequire('better-sqlite3');

const { createAccessControl } = require('../server/lib/access-control.js');
const { createServiceCore } = require('../server/lib/service-core.js');
const { backfillServiceTicketCreatedAt, normalizeServiceTicketForWrite } = require('../server/lib/service-dto.js');
const { startServer } = require('../server/lib/startup.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');

const repoRoot = fileURLToPath(new URL('..', import.meta.url));

function createState() {
  return {
    service: [],
    equipment: [{ id: 'EQ-1', inventoryNumber: '083', manufacturer: 'Mantall', model: 'HZ160' }],
    mechanics: [],
    users: [],
    clients: [],
    client_objects: [],
    client_contracts: [],
    rentals: [],
    gantt_rentals: [],
    payments: [],
    documents: [],
    service_audit_log: [],
  };
}

function createApp(state = createState()) {
  const app = express();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });
  const nowValues = [
    '2026-05-18T10:00:00.000Z',
    '2026-05-18T10:05:00.000Z',
    '2026-05-18T10:10:00.000Z',
  ];
  let nowIndex = 0;
  const nowIso = () => nowValues[Math.min(nowIndex++, nowValues.length - 1)];
  const serviceCore = createServiceCore({
    readData,
    writeData,
    nowIso: () => '2026-05-18T10:00:00.000Z',
    equipmentMatchesServiceTicket: (ticket, equipment) => ticket.equipmentId === equipment.id,
  });

  app.use((req, _res, next) => {
    req.user = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' };
    next();
  });
  app.use('/api', registerCrudRoutes({
    collections: ['service'],
    idPrefixes: { service: 'S' },
    readData,
    writeData,
    deleteSessionsForUserIds: () => {},
    requireAuth: (_req, _res, next) => next(),
    requireRead: () => (_req, _res, next) => next(),
    requireWrite: () => (_req, _res, next) => next(),
    sanitizeUser: user => user,
    publicUserView: user => user,
    canReadFullUsers: () => true,
    hashPassword: value => value,
    normalizeServiceWorkRecord: record => record,
    normalizeSparePartRecord: record => record,
    validateRentalPayload: () => ({ ok: true }),
    mergeEntityHistory: (_collection, _previous, next) => next,
    requireNonEmptyString: () => {},
    generateId: prefix => `${prefix}-${readData('service').length + 1}`,
    nowIso,
    applyServiceTicketCreationEffects: serviceCore.applyServiceTicketCreationEffects,
    accessControl,
    auditLog: () => {},
    serviceAuditLog: () => {},
    normalizeRecordClientLink: item => item,
    normalizeClientLinks: () => {},
  }));
  return { app, state };
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const baseTicket = {
  equipmentId: 'EQ-1',
  equipment: 'Mantall HZ160',
  reason: 'Ремонт',
  description: 'Диагностика',
  priority: 'medium',
  status: 'new',
};

function createStartupDeps(state, writeEvents = []) {
  const readData = name => state[name];
  const writeData = (name, value) => {
    writeEvents.push({ name, value });
    state[name] = value;
  };

  return {
    migrateJsonFilesToDb: () => {},
    cleanupExpiredSessions: () => {},
    seedDefaultUsers: () => {},
    ensureLegacyDefaultUsers: () => {},
    migrateReferenceCollections: () => {},
    migrateLegacyRepairFacts: () => {},
    backfillPaymentAllocations: () => ({ created: 0 }),
    backfillServiceTicketCreatedAt,
    applyAdminResetFromEnv: () => {},
    registerWebhook: async () => {},
    startWebhookWatchdog: () => {},
    startBotPolling: () => {},
    startGprsGateway: () => {},
    startWialonIpsGateway: () => {},
    dbPath: path.join(os.tmpdir(), 'startup-created-at-test.sqlite'),
    botToken: 'test-token',
    readData,
    writeData,
    normalizeClientLinks: () => {},
    backfillGanttRentalLinks: () => {},
    logGanttRentalLinkDiagnostics: () => {},
    normalizeServiceWorkRecord: item => item,
    normalizeSparePartRecord: item => item,
    createDatabaseBackup: () => {
      throw new Error('startup must not create service createdAt backfill backup');
    },
    seedsDir: path.join(os.tmpdir(), 'missing-service-created-at-seeds'),
  };
}

async function startAndCloseForStartupTest({ envValue, state, logger, writeEvents }) {
  const previous = process.env.SERVICE_CREATED_AT_BACKFILL;
  if (envValue === undefined) delete process.env.SERVICE_CREATED_AT_BACKFILL;
  else process.env.SERVICE_CREATED_AT_BACKFILL = envValue;

  const app = express();
  const server = await startServer({
    app,
    port: 0,
    deps: createStartupDeps(state, writeEvents),
    logger,
  });

  try {
    await new Promise(resolve => setTimeout(resolve, 50));
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (previous === undefined) delete process.env.SERVICE_CREATED_AT_BACKFILL;
    else process.env.SERVICE_CREATED_AT_BACKFILL = previous;
  }
}

function createTempServiceDb(service) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'service-created-at-db-'));
  const dbPath = path.join(tempDir, 'app.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);
  db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)').run('service', JSON.stringify(service));
  db.close();
  return { tempDir, dbPath };
}

function readServiceFromDb(dbPath) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get('service');
    return row ? JSON.parse(row.json) : null;
  } finally {
    db.close();
  }
}

function runBackfillScript(args, dbPath) {
  return spawnSync(process.execPath, [
    path.join(repoRoot, 'server/scripts/backfill-service-created-at.js'),
    ...args,
    '--db',
    dbPath,
  ], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
}

test('backend creates service ticket createdAt when payload omits it', async () => {
  const { app, state } = createApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/service', baseTicket);

    assert.equal(response.status, 201);
    assert.equal(response.body.createdAt, '2026-05-18T10:00:00.000Z');
    assert.equal(response.body.updatedAt, '2026-05-18T10:00:00.000Z');
    assert.equal(response.body.createdBy, 'Админ');
    assert.equal(response.body.createdByName, 'Админ');
    assert.equal(state.service[0].createdAt, '2026-05-18T10:00:00.000Z');
  });
});

test('startup with SERVICE_CREATED_AT_BACKFILL=apply logs warning and does not write service records', async () => {
  const service = [{ id: 'S-legacy', date: '2026-05-01' }];
  const state = {
    service: structuredClone(service),
    payments: [],
    payment_allocations: [],
    rentals: [],
    gantt_rentals: [],
    documents: [],
    app_settings: [],
    knowledge_base_progress: [],
  };
  const writes = [];
  const warnings = [];

  await startAndCloseForStartupTest({
    envValue: 'apply',
    state,
    writeEvents: writes,
    logger: {
      log: () => {},
      warn: message => warnings.push(String(message)),
    },
  });

  assert.deepEqual(state.service, service);
  assert.equal(writes.filter(event => event.name === 'service').length, 0);
  assert.equal(warnings.some(message => message.includes('createdAt backfill dry-run')), true);
  assert.equal(warnings.some(message => message.includes('startup apply disabled')), true);
});

test('startup createdAt dry-run does not mutate service records', async () => {
  const service = [{ id: 'S-legacy', requestedAt: '2026-05-02T08:00:00.000Z' }];
  const state = {
    service: structuredClone(service),
    payments: [],
    payment_allocations: [],
    rentals: [],
    gantt_rentals: [],
    documents: [],
    app_settings: [],
    knowledge_base_progress: [],
  };
  const writes = [];
  const warnings = [];

  await startAndCloseForStartupTest({
    envValue: undefined,
    state,
    writeEvents: writes,
    logger: {
      log: () => {},
      warn: message => warnings.push(String(message)),
    },
  });

  assert.deepEqual(state.service, service);
  assert.equal(writes.filter(event => event.name === 'service').length, 0);
  assert.equal(warnings.some(message => message.includes('createdAt backfill dry-run')), true);
  assert.equal(warnings.some(message => message.includes('startup apply disabled')), false);
});

test('manual service createdAt backfill script dry-run does not write', () => {
  const original = [{ id: 'S-legacy', createdDate: '2026-05-01T08:00:00.000Z' }];
  const { tempDir, dbPath } = createTempServiceDb(original);

  try {
    const result = runBackfillScript(['--dry-run'], dbPath);

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /Mode: dry-run/);
    assert.match(result.stdout, /Dry-run only: no database writes were performed/);
    assert.deepEqual(readServiceFromDb(dbPath), original);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('manual service createdAt backfill script apply updates only missing createdAt and is idempotent', () => {
  const original = [
    { id: 'S-created', createdAt: '2026-04-01T08:00:00.000Z', updatedAt: '2026-04-01T08:00:00.000Z' },
    { id: 'S-created-date', createdDate: '2026-05-01T08:00:00.000Z' },
    { id: 'S-updated', updatedAt: '2026-05-02T08:00:00.000Z' },
  ];
  const { tempDir, dbPath } = createTempServiceDb(original);

  try {
    const first = runBackfillScript(['--apply'], dbPath);
    const afterFirst = readServiceFromDb(dbPath);
    const second = runBackfillScript(['--apply'], dbPath);
    const afterSecond = readServiceFromDb(dbPath);

    assert.equal(first.status, 0, first.stderr);
    assert.match(first.stdout, /Mode: apply/);
    assert.match(first.stdout, /Backup created:/);
    assert.match(first.stdout, /Applied: changed=2/);
    assert.equal(afterFirst[0].createdAt, original[0].createdAt);
    assert.equal(afterFirst[1].createdAt, '2026-05-01T08:00:00.000Z');
    assert.equal(afterFirst[2].createdAt, '2026-05-02T08:00:00.000Z');

    assert.equal(second.status, 0, second.stderr);
    assert.match(second.stdout, /Apply requested: nothing to update/);
    assert.deepEqual(afterSecond, afterFirst);
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('backend creates service ticket createdAt when payload sends empty or null dates', async () => {
  for (const createdAt of ['', null]) {
    const { app } = createApp();
    await withServer(app, async baseUrl => {
      const response = await request(baseUrl, 'POST', '/api/service', { ...baseTicket, createdAt });

      assert.equal(response.status, 201);
      assert.equal(response.body.createdAt, '2026-05-18T10:00:00.000Z');
      assert.equal(response.body.updatedAt, '2026-05-18T10:00:00.000Z');
    });
  }
});

test('backend update preserves existing service createdAt and refreshes updatedAt', async () => {
  const { app, state } = createApp({
    ...createState(),
    service: [{
      id: 'S-1',
      ...baseTicket,
      createdAt: '2026-05-01T09:00:00.000Z',
      updatedAt: '2026-05-01T09:00:00.000Z',
    }],
  });

  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'PATCH', '/api/service/S-1', {
      reason: 'Обновлено',
      createdAt: '2030-01-01T00:00:00.000Z',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.createdAt, '2026-05-01T09:00:00.000Z');
    assert.equal(response.body.updatedAt, '2026-05-18T10:00:00.000Z');
    assert.equal(state.service[0].createdAt, '2026-05-01T09:00:00.000Z');
    assert.equal(state.service[0].updatedAt, '2026-05-18T10:00:00.000Z');
  });
});

test('service normalizer and backfill recover legacy service dates idempotently', () => {
  const legacy = [
    { id: 'S-created-date', createdDate: '2026-05-01T08:00:00.000Z' },
    { id: 'S-date', date: '2026-05-02' },
    { id: 'S-requested', requestedAt: '2026-05-03T08:00:00.000Z' },
    { id: 'S-updated', updatedAt: '2026-05-04T08:00:00.000Z' },
    { id: 'S-empty' },
  ];

  const first = backfillServiceTicketCreatedAt(legacy, { nowIso: () => '2026-05-18T12:00:00.000Z' });
  const second = backfillServiceTicketCreatedAt(first.items, { nowIso: () => '2027-01-01T00:00:00.000Z' });

  assert.equal(first.stats.changed, 5);
  assert.deepEqual(
    first.items.map(item => item.createdAt),
    ['2026-05-01T08:00:00.000Z', '2026-05-02', '2026-05-03T08:00:00.000Z', '2026-05-04T08:00:00.000Z', '2026-05-18T12:00:00.000Z'],
  );
  assert.equal(first.items[4].createdAtRestoredApproximate, true);
  assert.equal(second.stats.changed, 0);

  const normalized = normalizeServiceTicketForWrite({ id: 'S-new' }, {
    nowIso: () => '2026-05-18T12:30:00.000Z',
    actor: { userId: 'U-1', userName: 'Оператор' },
  });
  assert.equal(normalized.createdAt, '2026-05-18T12:30:00.000Z');
  assert.equal(normalized.createdByName, 'Оператор');
});
