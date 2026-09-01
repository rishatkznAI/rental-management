import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const Database = serverRequire('better-sqlite3');
const { createAccessControl } = require('../server/lib/access-control.js');
const { createBusinessNumberingService } = require('../server/lib/business-numbering.js');
const { createNumberSequenceAllocator } = require('../server/lib/number-sequences.js');
const { registerDocumentRoutes } = require('../server/routes/documents.js');
const { backfillSqlShadowIndexes } = require('../server/lib/sql-shadow-indexes.js');

function createApp(options = {}) {
  let idCounter = 0;
  let nextBatchFailure = null;
  let appDataUpsert = null;
  const batchWrites = [];
  const state = {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' },
      { id: 'U-office', name: 'Офис', role: 'Офис-менеджер', status: 'Активен' },
      { id: 'U-manager', name: 'Руслан', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-other', name: 'Анна', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-mechanic', name: 'Петров', role: 'Механик', status: 'Активен' },
      { id: 'U-investor', name: 'Инвестор', role: 'Инвестор', status: 'Активен', ownerId: 'OWN-1' },
    ],
    counterparties: [{
      id: 'CP-1',
      type: 'legal_entity',
      legalName: 'ООО Клиент',
      shortName: 'ООО Клиент',
      inn: '7701000000',
      status: 'active',
      archivedAt: null,
      roles: ['customer'],
    }],
    counterparty_role_assignments: [{
      id: 'CPRA-1',
      counterpartyId: 'CP-1',
      roleCode: 'customer',
      status: 'active',
      validTo: null,
    }],
    client_objects: [],
    client_contracts: [],
    vehicle_trips: [],
    clients: [{
      id: 'C-1',
      counterpartyId: 'CP-1',
      company: 'ООО Клиент',
      inn: '7701000000',
      kpp: '770101001',
      ogrn: '1027700000000',
      legalAddress: 'Москва, ул. Тестовая, 1',
      postalAddress: '101000, Москва, а/я 5',
      bankName: 'АО Тест Банк',
      bankBik: '044525000',
      bankAccount: '40702810000000000001',
      corrAccount: '30101810000000000000',
    }],
    rentals: [{ id: 'R-1', counterpartyId: 'CP-1', clientId: 'C-1', client: 'ООО Клиент', manager: 'Руслан', managerId: 'U-manager', startDate: '2026-05-10', plannedReturnDate: '2026-05-12', equipment: ['A-1'], rate: '10000/день', price: 30000 }],
    gantt_rentals: [],
    equipment: [
      { id: 'EQ-1', inventoryNumber: 'A-1', manufacturer: 'Genie', model: 'GS-1932', serialNumber: 'SN-1', ownerId: 'OWN-1' },
      { id: 'EQ-2', inventoryNumber: 'B-2', manufacturer: 'JLG', model: '1930ES', serialNumber: 'SN-2', ownerId: 'OWN-2' },
    ],
    documents: [],
    app_settings: [],
  };
  const users = {
    admin: { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' },
    office: { userId: 'U-office', userName: 'Офис', userRole: 'Офис-менеджер' },
    manager: { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' },
    other: { userId: 'U-other', userName: 'Анна', userRole: 'Менеджер по аренде' },
    mechanic: { userId: 'U-mechanic', userName: 'Петров', userRole: 'Механик' },
    investor: { userId: 'U-investor', userName: 'Инвестор', userRole: 'Инвестор', ownerId: 'OWN-1' },
  };
  const app = express();
  const router = express.Router();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => {
    state[name] = value;
  };
  const writeDataBatch = entries => {
    const staged = structuredClone(entries);
    batchWrites.push(staged);
    if (nextBatchFailure) {
      const error = nextBatchFailure;
      nextBatchFailure = null;
      throw error;
    }
    if (appDataUpsert) {
      staged.forEach(entry => appDataUpsert.run(entry.name, JSON.stringify(entry.value)));
    }
    staged.forEach(entry => {
      state[entry.name] = entry.value;
    });
  };
  const accessControl = createAccessControl({ readData });
  const numberingDb = options.businessNumbering ? new Database(':memory:') : null;
  const businessNumbering = numberingDb ? createBusinessNumberingService({
    allocator: createNumberSequenceAllocator({
      db: numberingDb,
      nowIso: () => '2026-05-09T10:00:00.000Z',
    }),
    readData,
    nowIso: () => '2026-05-09T10:00:00.000Z',
  }) : null;
  if (numberingDb) {
    numberingDb.exec(`
      CREATE TABLE app_data (
        name TEXT PRIMARY KEY,
        json TEXT NOT NULL
      )
    `);
    appDataUpsert = numberingDb.prepare(`
      INSERT INTO app_data (name, json)
      VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET json = excluded.json
    `);
  }
  const executeAppDataWriteTransaction = numberingDb
    ? numberingDb.transaction(operation => operation())
    : null;
  const requireAuth = (req, res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = users[token];
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = user;
    next();
  };
  const requireRead = collection => (req, res, next) => {
    if (collection === 'documents' && ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
  const requireWrite = collection => (req, res, next) => {
    if (collection === 'documents' && ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };

  registerDocumentRoutes(router, {
    readData,
    writeData,
    writeDataBatch,
    requireAuth,
    requireRead,
    requireWrite,
    accessControl,
    generateId: prefix => `${prefix}-${++idCounter}`,
    idPrefixes: { documents: 'D' },
    nowIso: () => '2026-05-09T10:00:00.000Z',
    auditLog: null,
    normalizeRecordClientLink: item => item,
    getDb: options.getDb,
    businessNumbering,
    runInAppDataWriteTransaction: operation => executeAppDataWriteTransaction
      ? executeAppDataWriteTransaction.immediate(operation)
      : operation(),
  });
  app.use('/api', router);
  return {
    app,
    state,
    numberingDb,
    batchWrites,
    failNextBatch() {
      const error = new Error('Injected document batch failure');
      error.code = 'INJECTED_DOCUMENT_BATCH_FAILURE';
      error.status = 503;
      nextBatchFailure = error;
    },
  };
}

function makeSqlDb(seed) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'document-route-sql-'));
  const db = new Database(path.join(dir, 'app.sqlite'));
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const upsert = db.prepare(`
    INSERT INTO app_data (name, json)
    VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = CURRENT_TIMESTAMP
  `);
  for (const [name, value] of Object.entries(seed)) upsert.run(name, JSON.stringify(value));
  backfillSqlShadowIndexes(db);
  return { db, dir };
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

async function request(baseUrl, method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { response, json };
}

test('archived ClientContract is blocked for new documents while historical document snapshots remain editable', async () => {
  const { app, state } = createApp();
  state.client_contracts = [{
    id: 'CC-archived',
    counterpartyId: 'CP-1',
    clientId: 'C-1',
    number: 'CTR-ARCHIVED',
    status: 'archived',
  }];
  state.documents = [{
    id: 'D-history',
    counterpartyId: 'CP-1',
    clientId: 'C-1',
    contractId: 'CC-archived',
    type: 'act',
    number: 'ACT-HISTORY',
    status: 'signed',
    snapshot: { clientContract: { id: 'CC-archived', number: 'CTR-ARCHIVED' } },
  }];

  await withServer(app, async baseUrl => {
    const rejected = await request(baseUrl, 'POST', '/api/documents', 'office', {
      counterpartyId: 'CP-1',
      clientId: 'C-1',
      contractId: 'CC-archived',
      type: 'act',
      status: 'draft',
    });
    assert.equal(rejected.response.status, 409);
    assert.equal(rejected.json.code, 'CLIENT_CONTRACT_ARCHIVED');
    assert.equal(state.documents.length, 1);

    const historicalPatch = await request(baseUrl, 'PATCH', '/api/documents/D-history', 'office', {
      notes: 'Историческая пометка',
    });
    assert.equal(historicalPatch.response.status, 200);
    assert.equal(historicalPatch.json.contractId, 'CC-archived');
    assert.equal(historicalPatch.json.snapshot.clientContract.number, 'CTR-ARCHIVED');
  });
});

test('documents gantt references are bounded, scoped and compact', async () => {
  const { app, state } = createApp();
  state.gantt_rentals = Array.from({ length: 130 }, (_, index) => ({
    id: `GR-${index + 1}`,
    rentalId: `R-${index + 1}`,
    clientId: index % 2 === 0 ? 'C-1' : 'C-2',
    client: index % 2 === 0 ? 'ООО Клиент' : 'ООО Другой',
    equipmentId: index % 2 === 0 ? 'EQ-1' : 'EQ-2',
    equipmentInv: index % 2 === 0 ? 'A-1' : 'B-2',
    manager: index % 2 === 0 ? 'Руслан' : 'Анна',
    managerId: index % 2 === 0 ? 'U-manager' : 'U-other',
    startDate: '2026-05-10',
    endDate: '2026-05-12',
    status: index % 3 === 0 ? 'active' : 'created',
    amount: 30000,
    paymentStatus: 'unpaid',
    debt: 30000,
    comments: [{ text: 'internal' }],
  }));

  await withServer(app, async (baseUrl) => {
    const office = await request(baseUrl, 'GET', '/api/documents/gantt-references?limit=500', 'office');
    assert.equal(office.response.status, 200);
    assert.equal(office.json.items.length, 100);
    assert.equal(office.json.limit, 100);
    assert.equal(office.json.items[0].paymentStatus, undefined);
    assert.equal(office.json.items[0].debt, undefined);
    assert.equal(office.json.items[0].comments, undefined);

    const manager = await request(baseUrl, 'GET', '/api/documents/gantt-references?limit=100', 'manager');
    assert.equal(manager.response.status, 200);
    assert.ok(manager.json.items.length > 0);
    assert.deepEqual(new Set(manager.json.items.map(item => item.managerId)), new Set(['U-manager']));

    const mechanic = await request(baseUrl, 'GET', '/api/documents/gantt-references', 'mechanic');
    assert.equal(mechanic.response.status, 403);

    const investor = await request(baseUrl, 'GET', '/api/documents/gantt-references', 'investor');
    assert.equal(investor.response.status, 403);
  });
});

test('documents gantt references support search and stable-id filters', async () => {
  const { app, state } = createApp();
  state.gantt_rentals = [
    { id: 'GR-own', rentalId: 'R-own', clientId: 'C-1', client: 'ООО Альфа', equipmentId: 'EQ-1', equipmentInv: 'A-1', objectId: 'CO-1', contractId: 'CON-1', manager: 'Руслан', managerId: 'U-manager', ownerId: 'OWN-1', startDate: '2026-05-10', endDate: '2026-05-12', status: 'active', amount: 30000 },
    { id: 'GR-other', rentalId: 'R-other', sourceRentalId: 'R-source-other', originalRentalId: 'R-original-other', clientId: 'C-2', client: 'ООО Бета', equipmentId: 'EQ-2', equipmentInv: 'B-2', objectId: 'CO-2', contractId: 'CON-2', manager: 'Анна', managerId: 'U-other', ownerId: 'OWN-2', startDate: '2026-06-10', endDate: '2026-06-12', status: 'closed', amount: 50000 },
    { id: 'GR-old', rentalId: 'R-old', clientId: 'C-1', client: 'ООО Старый', equipmentId: 'EQ-1', equipmentInv: 'A-1', objectId: 'CO-1', contractId: 'CON-1', manager: 'Руслан', managerId: 'U-manager', ownerId: 'OWN-1', startDate: '2024-01-10', endDate: '2024-01-12', status: 'closed', amount: 20000 },
  ];

  await withServer(app, async (baseUrl) => {
    const search = await request(baseUrl, 'GET', '/api/documents/gantt-references?search=Альфа', 'office');
    assert.equal(search.response.status, 200);
    assert.deepEqual(search.json.items.map(item => item.id), ['GR-own']);

    const client = await request(baseUrl, 'GET', '/api/documents/gantt-references?clientId=C-1&limit=10', 'office');
    assert.equal(client.response.status, 200);
    assert.deepEqual(new Set(client.json.items.map(item => item.id)), new Set(['GR-own', 'GR-old']));

    const rental = await request(baseUrl, 'GET', '/api/documents/gantt-references?rentalId=R-other', 'office');
    assert.equal(rental.response.status, 200);
    assert.deepEqual(rental.json.items.map(item => item.id), ['GR-other']);

    const equipment = await request(baseUrl, 'GET', '/api/documents/gantt-references?equipmentId=EQ-1&contractId=CON-1&limit=10', 'office');
    assert.equal(equipment.response.status, 200);
    assert.deepEqual(new Set(equipment.json.items.map(item => item.id)), new Set(['GR-own', 'GR-old']));

    const object = await request(baseUrl, 'GET', '/api/documents/gantt-references?objectId=CO-2', 'office');
    assert.equal(object.response.status, 200);
    assert.deepEqual(object.json.items.map(item => item.id), ['GR-other']);

    const manager = await request(baseUrl, 'GET', '/api/documents/gantt-references?managerId=U-other', 'office');
    assert.equal(manager.response.status, 200);
    assert.deepEqual(manager.json.items.map(item => item.id), ['GR-other']);

    const owner = await request(baseUrl, 'GET', '/api/documents/gantt-references?ownerId=OWN-2', 'office');
    assert.equal(owner.response.status, 200);
    assert.deepEqual(owner.json.items.map(item => item.id), ['GR-other']);

    const status = await request(baseUrl, 'GET', '/api/documents/gantt-references?status=active', 'office');
    assert.equal(status.response.status, 200);
    assert.deepEqual(status.json.items.map(item => item.id), ['GR-own']);

    const sourceRental = await request(baseUrl, 'GET', '/api/documents/gantt-references?rentalId=R-source-other', 'office');
    assert.equal(sourceRental.response.status, 200);
    assert.deepEqual(sourceRental.json.items.map(item => item.id), ['GR-other']);

    const originalRental = await request(baseUrl, 'GET', '/api/documents/gantt-references?rentalId=R-original-other', 'office');
    assert.equal(originalRental.response.status, 200);
    assert.deepEqual(originalRental.json.items.map(item => item.id), ['GR-other']);

    const ganttId = await request(baseUrl, 'GET', '/api/documents/gantt-references?rentalId=GR-other', 'office');
    assert.equal(ganttId.response.status, 200);
    assert.deepEqual(ganttId.json.items.map(item => item.id), ['GR-other']);
  });
});

test('documents gantt references apply date bounds when no narrowing filter is provided', async () => {
  const { app, state } = createApp();
  state.gantt_rentals = [
    { id: 'GR-recent', rentalId: 'R-recent', clientId: 'C-1', client: 'ООО Клиент', equipmentId: 'EQ-1', equipmentInv: 'A-1', manager: 'Руслан', managerId: 'U-manager', startDate: '2026-05-10', endDate: '2026-05-12', status: 'active' },
    { id: 'GR-future', rentalId: 'R-future', clientId: 'C-1', client: 'ООО Клиент', equipmentId: 'EQ-1', equipmentInv: 'A-1', manager: 'Руслан', managerId: 'U-manager', startDate: '2027-01-10', endDate: '2027-01-12', status: 'active' },
    { id: 'GR-old', rentalId: 'R-old', clientId: 'C-1', client: 'ООО Клиент', equipmentId: 'EQ-1', equipmentInv: 'A-1', manager: 'Руслан', managerId: 'U-manager', startDate: '2024-01-10', endDate: '2024-01-12', status: 'closed' },
  ];

  await withServer(app, async (baseUrl) => {
    const defaultWindow = await request(baseUrl, 'GET', '/api/documents/gantt-references?limit=100', 'office');
    assert.equal(defaultWindow.response.status, 200);
    assert.deepEqual(defaultWindow.json.items.map(item => item.id), ['GR-recent']);

    const explicitWindow = await request(baseUrl, 'GET', '/api/documents/gantt-references?dateFrom=2024-01-01&dateTo=2024-01-31', 'office');
    assert.equal(explicitWindow.response.status, 200);
    assert.deepEqual(explicitWindow.json.items.map(item => item.id), ['GR-old']);
  });
});

test('documents references can use SQL shadow index behind disabled-by-default feature flag', async () => {
  const previousDocumentsFlag = process.env.USE_SQL_DOCUMENTS_INDEX;
  const previousGanttFlag = process.env.USE_SQL_GANTT_INDEX;
  const sql = makeSqlDb({
    documents: [
      { id: 'D-sql', type: 'act', number: 'SQL-1', clientId: 'C-1', rentalId: 'R-1', equipmentId: 'EQ-1', createdAt: '2026-05-09', client: 'ООО SQL' },
    ],
    gantt_rentals: [
      { id: 'GR-sql', rentalId: 'R-1', clientId: 'C-1', client: 'ООО SQL', equipmentId: 'EQ-1', equipmentInv: 'A-1', managerId: 'U-manager', manager: 'Руслан', startDate: '2026-05-09', endDate: '2026-05-11', status: 'active' },
    ],
  });
  try {
    const { app, state } = createApp({ getDb: () => sql.db });
    state.documents = [
      { id: 'D-json', type: 'act', number: 'JSON-1', clientId: 'C-1', rentalId: 'R-1', equipmentId: 'EQ-1', createdAt: '2026-05-09', client: 'ООО JSON' },
    ];
    state.gantt_rentals = [
      { id: 'GR-json', rentalId: 'R-json', clientId: 'C-1', client: 'ООО JSON', equipmentId: 'EQ-1', equipmentInv: 'A-1', managerId: 'U-manager', manager: 'Руслан', startDate: '2026-05-09', endDate: '2026-05-11', status: 'active' },
    ];
    await withServer(app, async (baseUrl) => {
      process.env.USE_SQL_DOCUMENTS_INDEX = 'false';
      process.env.USE_SQL_GANTT_INDEX = 'false';
      const jsonDocs = await request(baseUrl, 'GET', '/api/documents/references?type=act', 'office');
      assert.equal(jsonDocs.response.status, 200);
      assert.deepEqual(jsonDocs.json.items.map(item => item.id), ['D-json']);
      const jsonGantt = await request(baseUrl, 'GET', '/api/documents/gantt-references?rentalId=R-json', 'office');
      assert.equal(jsonGantt.response.status, 200);
      assert.deepEqual(jsonGantt.json.items.map(item => item.id), ['GR-json']);

      process.env.USE_SQL_DOCUMENTS_INDEX = 'true';
      process.env.USE_SQL_GANTT_INDEX = 'true';
      const sqlDocs = await request(baseUrl, 'GET', '/api/documents/references?search=SQL', 'office');
      assert.equal(sqlDocs.response.status, 200);
      assert.deepEqual(sqlDocs.json.items.map(item => item.id), ['D-sql']);
      const sqlGantt = await request(baseUrl, 'GET', '/api/documents/gantt-references?rentalId=R-1', 'manager');
      assert.equal(sqlGantt.response.status, 200);
      assert.deepEqual(sqlGantt.json.items.map(item => item.id), ['GR-sql']);
    });
  } finally {
    if (previousDocumentsFlag === undefined) delete process.env.USE_SQL_DOCUMENTS_INDEX;
    else process.env.USE_SQL_DOCUMENTS_INDEX = previousDocumentsFlag;
    if (previousGanttFlag === undefined) delete process.env.USE_SQL_GANTT_INDEX;
    else process.env.USE_SQL_GANTT_INDEX = previousGanttFlag;
    sql.db.close();
    fs.rmSync(sql.dir, { recursive: true, force: true });
  }
});

test('documents references SQL path matches JSON filters and compact response shape', async () => {
  const previousDocumentsFlag = process.env.USE_SQL_DOCUMENTS_INDEX;
  const documents = [
    { id: 'D-date', type: 'act', number: 'ACT-1', clientId: 'C-1', client: 'ООО Альфа', rentalId: 'R-1', equipmentId: 'EQ-1', contractId: 'CON-1', status: 'signed', date: '2026-05-01', createdAt: '2026-05-14T19:07:53.327Z', managerId: 'U-manager', password: 'hidden', token: 'hidden', secret: 'hidden' },
    { id: 'D-documentDate', type: 'act', number: 'ACT-2', clientId: 'C-1', client: 'ООО Альфа', rentalId: 'R-1', equipmentId: 'EQ-1', contractId: 'CON-1', status: 'draft', documentDate: '2026-05-01', createdAt: '2026-05-14T19:07:53.327Z', managerId: 'U-manager' },
    { id: 'D-createdAt', type: 'invoice', number: 'INV-1', clientId: 'C-2', client: 'ООО Бета', rentalId: 'R-2', equipmentId: 'EQ-2', contractId: 'CON-2', status: 'draft', createdAt: '2026-05-01T12:00:00.000Z', managerId: 'U-other' },
    { id: 'D-updatedAt', type: 'invoice', number: 'INV-2', clientId: 'C-2', client: 'ООО Бета', rentalId: 'R-2', equipmentId: 'EQ-2', contractId: 'CON-2', status: 'signed', updatedAt: '2026-05-01T12:00:00.000Z', managerId: 'U-other' },
    { id: 'D-outside', type: 'act', number: 'ACT-3', clientId: 'C-1', client: 'ООО Альфа', rentalId: 'R-1', equipmentId: 'EQ-1', contractId: 'CON-1', status: 'signed', date: '2026-05-02', createdAt: '2026-05-01T12:00:00.000Z', managerId: 'U-manager' },
  ];
  const sql = makeSqlDb({ documents, gantt_rentals: [] });
  try {
    const { app, state } = createApp({ getDb: () => sql.db });
    state.documents = documents;

    await withServer(app, async (baseUrl) => {
      async function fetchIds(path, flag) {
        process.env.USE_SQL_DOCUMENTS_INDEX = flag ? 'true' : 'false';
        const result = await request(baseUrl, 'GET', path, 'office');
        assert.equal(result.response.status, 200, `${flag ? 'sql' : 'json'} ${path}`);
        return {
          ids: result.json.items.map(item => item.id),
          total: result.json.pagination.total,
          pageSize: result.json.pagination.pageSize,
          items: result.json.items,
        };
      }

      const cases = [
        '/api/documents/references?pageSize=100',
        '/api/documents/references?search=%D0%90%D0%BB%D1%8C%D1%84%D0%B0&pageSize=100',
        '/api/documents/references?clientId=C-1&pageSize=100',
        '/api/documents/references?rentalId=R-2&pageSize=100',
        '/api/documents/references?equipmentId=EQ-1&pageSize=100',
        '/api/documents/references?contractId=CON-2&pageSize=100',
        '/api/documents/references?type=act&status=signed&pageSize=100',
        '/api/documents/references?dateFrom=2026-05-01&dateTo=2026-05-01&pageSize=100',
        '/api/documents/references?pageSize=500',
      ];
      for (const path of cases) {
        const json = await fetchIds(path, false);
        const sqlResult = await fetchIds(path, true);
        assert.deepEqual(sqlResult.ids, json.ids, path);
        assert.equal(sqlResult.total, json.total, path);
        assert.equal(sqlResult.pageSize, json.pageSize, path);
      }

      const dateRange = await fetchIds('/api/documents/references?dateFrom=2026-05-01&dateTo=2026-05-01&pageSize=100', true);
      assert.deepEqual(new Set(dateRange.ids), new Set(['D-date', 'D-documentDate', 'D-createdAt', 'D-updatedAt']));
      assert.equal(dateRange.ids.includes('D-outside'), false);
      for (const item of dateRange.items) {
        assert.equal(item.password, undefined);
        assert.equal(item.token, undefined);
        assert.equal(item.secret, undefined);
      }

      process.env.USE_SQL_DOCUMENTS_INDEX = 'true';
      assert.equal((await request(baseUrl, 'GET', '/api/documents/references', 'admin')).response.status, 200);
      assert.equal((await request(baseUrl, 'GET', '/api/documents/references', 'office')).response.status, 200);
      const manager = await request(baseUrl, 'GET', '/api/documents/references?pageSize=100', 'manager');
      assert.equal(manager.response.status, 200);
      assert.deepEqual(new Set(manager.json.items.map(item => item.id)), new Set(['D-outside', 'D-date', 'D-documentDate']));
      assert.equal((await request(baseUrl, 'GET', '/api/documents/references', 'mechanic')).response.status, 403);
      assert.equal((await request(baseUrl, 'GET', '/api/documents/references', 'investor')).response.status, 403);
    });
  } finally {
    if (previousDocumentsFlag === undefined) delete process.env.USE_SQL_DOCUMENTS_INDEX;
    else process.env.USE_SQL_DOCUMENTS_INDEX = previousDocumentsFlag;
    sql.db.close();
    fs.rmSync(sql.dir, { recursive: true, force: true });
  }
});

test('documents API creates documents with automatic numbers and separate sequences', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    const act = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-1',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(act.response.status, 201);
    assert.equal(act.json.number, 'ACT-2026-0001');
    assert.equal(state.documents[0].history.some(entry => entry.action === 'number_assigned'), true);

    const invoice = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'invoice',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(invoice.response.status, 201);
    assert.equal(invoice.json.number, 'INVOICE-2026-0001');
  });
});

test('SQL-backed document routes enforce sequences, immutability, and master ownership', async () => {
  const { app, state, numberingDb } = createApp({ businessNumbering: true });
  state.client_contracts = [{
    id: 'CC-1',
    counterpartyId: 'CP-1',
    clientId: 'C-1',
    number: 'CTR-26-000001',
    status: 'active',
  }];
  state.vehicle_trips = [{
    id: 'VT-1',
    vehicleId: 'CAR-1',
    mechanicId: 'M-1',
    number: 'PL-26-000001',
    sheetNumber: 'PL-26-000001',
    date: '2026-05-09',
  }];
  state.mechanics = [{ id: 'M-1', name: 'Петров' }];
  state.service_vehicles = [{ id: 'CAR-1', make: 'УАЗ', model: 'Профи', plateNumber: 'А001АА' }];

  await withServer(app, async baseUrl => {
    const contract = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      contractId: 'CC-1',
      counterpartyId: 'CP-1',
      clientId: 'C-1',
      signerName: 'Иванов Иван',
      signerPosition: 'директор',
      signerBasis: 'Устав',
      date: '2026-05-09',
    });
    assert.equal(contract.response.status, 201, JSON.stringify(contract.json));
    assert.equal(contract.json.number, 'CTR-26-000001');

    const tripTicket = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'trip_ticket',
      vehicleTripId: 'VT-1',
      mechanicId: 'M-1',
      serviceCarId: 'CAR-1',
      date: '2026-05-09',
    });
    assert.equal(tripTicket.response.status, 201, JSON.stringify(tripTicket.json));
    assert.equal(tripTicket.json.number, 'PL-26-000001');

    const transfer = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'transfer_act_to_client',
      counterpartyId: 'CP-1',
      clientId: 'C-1',
      equipmentId: 'EQ-1',
      transferDate: '2026-05-09',
      date: '2026-05-09',
    });
    const returned = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'return_act_from_client',
      counterpartyId: 'CP-1',
      clientId: 'C-1',
      equipmentId: 'EQ-1',
      returnDate: '2026-05-10',
      date: '2026-05-10',
    });
    assert.equal(transfer.response.status, 201, JSON.stringify(transfer.json));
    assert.equal(returned.response.status, 201, JSON.stringify(returned.json));
    assert.equal(transfer.json.number, 'AP-26-000001');
    assert.equal(returned.json.number, 'AR-26-000001');

    const invoice2025 = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'invoice',
      counterpartyId: 'CP-1',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2025-12-31',
      status: 'draft',
    });
    assert.equal(invoice2025.response.status, 201, JSON.stringify(invoice2025.json));
    assert.equal(invoice2025.json.number, 'INV-25-000001');

    const forgedCreate = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'invoice',
      number: 'INV-26-999999',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(forgedCreate.response.status, 400);
    assert.equal(forgedCreate.json.code, 'BUSINESS_NUMBER_SERVER_OWNED');

    const forgedPatch = await request(baseUrl, 'PATCH', `/api/documents/${invoice2025.json.id}`, 'office', {
      number: 'INV-25-999999',
    });
    assert.equal(forgedPatch.response.status, 400);
    assert.equal(forgedPatch.json.code, 'BUSINESS_NUMBER_SERVER_OWNED');
  });

  assert.equal(numberingDb.prepare("SELECT COUNT(*) AS count FROM business_numbers WHERE entity_type = 'CLIENT_CONTRACT'").get().count, 0);
  assert.equal(numberingDb.prepare("SELECT COUNT(*) AS count FROM business_numbers WHERE entity_type = 'VEHICLE_TRIP'").get().count, 0);
  numberingDb.close();
});

test('SQL-backed document create rolls numbering and app_data back on downstream batch failure', async () => {
  const context = createApp({ businessNumbering: true });
  const payload = {
    type: 'invoice',
    counterpartyId: 'CP-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2026-05-09',
    status: 'draft',
  };

  await withServer(context.app, async baseUrl => {
    context.failNextBatch();
    const failed = await request(baseUrl, 'POST', '/api/documents', 'office', payload);
    assert.equal(failed.response.status, 503, JSON.stringify(failed.json));
    assert.equal(failed.json.code, 'INJECTED_DOCUMENT_BATCH_FAILURE');
    assert.equal(context.state.documents.length, 0);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM number_sequences').get().count, 0);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM business_numbers').get().count, 0);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM app_data').get().count, 0);

    const created = await request(baseUrl, 'POST', '/api/documents', 'office', payload);
    assert.equal(created.response.status, 201, JSON.stringify(created.json));
    assert.equal(created.json.number, 'INV-26-000001');
    assert.equal(context.state.documents[0].number, created.json.number);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM number_sequences').get().count, 1);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM business_numbers').get().count, 1);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM app_data').get().count, 2);
  });
});

test('SQL-backed document generate rolls numbering and app_data back on downstream batch failure', async () => {
  const context = createApp({ businessNumbering: true });
  const payload = {
    type: 'invoice',
    counterpartyId: 'CP-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2026-05-09',
    status: 'draft',
  };

  await withServer(context.app, async baseUrl => {
    context.failNextBatch();
    const failed = await request(baseUrl, 'POST', '/api/documents/generate', 'office', payload);
    assert.equal(failed.response.status, 503, JSON.stringify(failed.json));
    assert.equal(failed.json.code, 'INJECTED_DOCUMENT_BATCH_FAILURE');
    assert.equal(context.state.documents.length, 0);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM number_sequences').get().count, 0);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM business_numbers').get().count, 0);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM app_data').get().count, 0);

    const generated = await request(baseUrl, 'POST', '/api/documents/generate', 'office', payload);
    assert.equal(generated.response.status, 201, JSON.stringify(generated.json));
    assert.equal(generated.json.number, 'INV-26-000001');
    assert.equal(context.state.documents[0].number, generated.json.number);
  });
});

test('SQL-backed document duplicate preserves its source allocation when downstream persistence fails', async () => {
  const context = createApp({ businessNumbering: true });

  await withServer(context.app, async baseUrl => {
    const source = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'invoice',
      counterpartyId: 'CP-1',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(source.response.status, 201, JSON.stringify(source.json));
    assert.equal(source.json.number, 'INV-26-000001');
    const beforeState = documentNumberingState(context.state);
    const beforeSqlDocumentJson = context.numberingDb
      .prepare("SELECT json FROM app_data WHERE name = 'documents'")
      .get().json;

    context.failNextBatch();
    const failed = await request(
      baseUrl,
      'POST',
      `/api/documents/${source.json.id}/duplicate`,
      'office',
    );
    assert.equal(failed.response.status, 503, JSON.stringify(failed.json));
    assert.equal(failed.json.code, 'INJECTED_DOCUMENT_BATCH_FAILURE');
    assert.deepEqual(documentNumberingState(context.state), beforeState);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM number_sequences').get().count, 1);
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM business_numbers').get().count, 1);
    assert.equal(
      context.numberingDb.prepare("SELECT json FROM app_data WHERE name = 'documents'").get().json,
      beforeSqlDocumentJson,
    );

    const duplicate = await request(
      baseUrl,
      'POST',
      `/api/documents/${source.json.id}/duplicate`,
      'office',
    );
    assert.equal(duplicate.response.status, 201, JSON.stringify(duplicate.json));
    assert.equal(duplicate.json.number, 'INV-26-000002');
    assert.equal(context.numberingDb.prepare('SELECT COUNT(*) AS count FROM business_numbers').get().count, 2);
  });
});

test('customer Documents accept CP-only identity and reject mismatch, inactive role, and name-only identity', async () => {
  const { app, state } = createApp();
  state.counterparties.push({
    id: 'CP-2',
    type: 'legal_entity',
    legalName: 'ООО Клиент',
    shortName: 'ООО Клиент',
    status: 'active',
    archivedAt: null,
    roles: ['customer'],
  }, {
    id: 'CP-INACTIVE',
    type: 'legal_entity',
    legalName: 'ООО Неактивный',
    status: 'active',
    archivedAt: null,
    roles: ['customer'],
  });
  state.counterparty_role_assignments.push(
    { id: 'CPRA-2', counterpartyId: 'CP-2', roleCode: 'customer', status: 'active', validTo: null },
    { id: 'CPRA-INACTIVE', counterpartyId: 'CP-INACTIVE', roleCode: 'customer', status: 'inactive', validTo: '2026-01-01' },
  );

  await withServer(app, async baseUrl => {
    const cpOnly = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      counterpartyId: 'CP-2',
      signerName: 'Иванов Иван',
      signerPosition: 'директор',
      signerBasis: 'Устав',
      date: '2026-05-09',
    });
    assert.equal(cpOnly.response.status, 201, JSON.stringify(cpOnly.json));
    assert.equal(cpOnly.json.counterpartyId, 'CP-2');
    assert.equal(cpOnly.json.clientId, undefined);
    assert.equal(cpOnly.json.snapshot.client.legalName, 'ООО Клиент');

    const duplicate = await request(baseUrl, 'POST', `/api/documents/${cpOnly.json.id}/duplicate`, 'office');
    assert.equal(duplicate.response.status, 201);
    assert.equal(duplicate.json.counterpartyId, 'CP-2');
    assert.equal(duplicate.json.clientId, undefined);

    const matching = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract', counterpartyId: 'CP-1', clientId: 'C-1', client: 'Snapshot', date: '2026-05-09', status: 'draft',
    });
    assert.equal(matching.response.status, 201);

    const mismatch = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract', counterpartyId: 'CP-2', clientId: 'C-1', client: 'ООО Клиент', date: '2026-05-09', status: 'draft',
    });
    assert.equal(mismatch.response.status, 409);
    assert.equal(mismatch.json.code, 'COUNTERPARTY_RELATION_MISMATCH');

    const inactive = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract', counterpartyId: 'CP-INACTIVE', client: 'ООО Неактивный', date: '2026-05-09', status: 'draft',
    });
    assert.equal(inactive.response.status, 409);
    assert.equal(inactive.json.code, 'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED');

    const nameOnly = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract', client: 'ООО Клиент', date: '2026-05-09', status: 'draft',
    });
    assert.equal(nameOnly.response.status, 400);
    assert.equal(nameOnly.json.code, 'COUNTERPARTY_RELATION_ID_REQUIRED');
  });
});

test('Rental Counterparty controls Document relation and conflicting object/contract chains reject', async () => {
  const { app, state } = createApp();
  state.counterparties.push({
    id: 'CP-2', legalName: 'ООО Другой', status: 'active', archivedAt: null, roles: ['customer'],
  });
  state.counterparty_role_assignments.push({
    id: 'CPRA-2', counterpartyId: 'CP-2', roleCode: 'customer', status: 'active', validTo: null,
  });
  state.clients.push({ id: 'C-2', counterpartyId: 'CP-2', company: 'ООО Другой' });
  state.client_objects.push({ id: 'O-2', counterpartyId: 'CP-2', clientId: 'C-2', name: 'Чужой', address: 'Москва', status: 'active' });
  state.client_contracts.push({ id: 'CC-2', counterpartyId: 'CP-2', clientId: 'C-2', number: '2', status: 'active' });

  await withServer(app, async baseUrl => {
    const derived = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract', rentalId: 'R-1', client: 'Snapshot', date: '2026-05-09', status: 'draft',
    });
    assert.equal(derived.response.status, 201, JSON.stringify(derived.json));
    assert.equal(derived.json.counterpartyId, 'CP-1');
    assert.equal(derived.json.clientId, 'C-1');

    for (const link of [{ objectId: 'O-2' }, { contractId: 'CC-2' }]) {
      const rejected = await request(baseUrl, 'POST', '/api/documents', 'office', {
        type: 'contract', rentalId: 'R-1', date: '2026-05-09', status: 'draft', ...link,
      });
      assert.equal(rejected.response.status, 409);
      assert.equal(rejected.json.code, 'COUNTERPARTY_RELATION_MISMATCH');
    }
  });
});

test('closing rental documents snapshot downtime-adjusted billing amount', async () => {
  const { app, state } = createApp();
  state.rentals = [{
    id: 'R-metal',
    counterpartyId: 'CP-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    price: 310000,
  }];
  state.gantt_rentals = [{
    id: 'GR-metal',
    rentalId: 'R-metal',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
    downtimePeriods: [
      { id: 'DT-1', rentalId: 'R-metal', startDate: '2026-05-01', endDate: '2026-05-07', reason: 'ожидание клиента', affectsBilling: true, status: 'active' },
      { id: 'DT-2', rentalId: 'R-metal', startDate: '2026-05-13', endDate: '2026-05-17', reason: 'эвакуатор не мог забрать технику', affectsBilling: true, status: 'active' },
    ],
  }];

  await withServer(app, async (baseUrl) => {
    const act = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-metal',
      amount: 310000,
      date: '2026-05-31',
      status: 'draft',
    });

    assert.equal(act.response.status, 201);
    assert.equal(act.json.amount, 190000);
    assert.equal(act.json.rentalBillingSnapshot.grossRentalAmount, 310000);
    assert.equal(act.json.rentalBillingSnapshot.downtimeAdjustmentAmount, 120000);
    assert.equal(act.json.rentalBillingSnapshot.finalRentalAmount, 190000);
    assert.equal(act.json.rentalBillingSnapshot.billingDowntimeDays, 12);

    const upd = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'upd',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-metal',
      date: '2026-05-31',
      status: 'draft',
    });

    assert.equal(upd.response.status, 201);
    assert.equal(upd.json.amount, 190000);
    assert.equal(upd.json.billingSnapshot.billableDays, 19);
  });
});

test('document snapshots stay fixed and new documents use current downtime billing', async () => {
  const { app, state } = createApp();
  state.rentals = [{
    id: 'R-snapshot',
    counterpartyId: 'CP-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    price: 310000,
  }];
  state.gantt_rentals = [{
    id: 'GR-snapshot',
    rentalId: 'R-snapshot',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
    downtimePeriods: [
      { id: 'DT-1', rentalId: 'R-snapshot', startDate: '2026-05-01', endDate: '2026-05-07', reason: 'ожидание клиента', affectsBilling: true, status: 'active' },
    ],
  }];

  await withServer(app, async (baseUrl) => {
    const first = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-snapshot',
      date: '2026-05-31',
      status: 'draft',
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.json.amount, 240000);

    state.gantt_rentals[0].downtimePeriods.push(
      { id: 'DT-2', rentalId: 'R-snapshot', startDate: '2026-05-13', endDate: '2026-05-17', reason: 'эвакуатор', affectsBilling: true, status: 'active' },
    );

    const oldDoc = await request(baseUrl, 'GET', `/api/documents/${first.json.id}`, 'office');
    assert.equal(oldDoc.response.status, 200);
    assert.equal(oldDoc.json.amount, 240000);
    assert.equal(oldDoc.json.rentalBillingSnapshot.finalRentalAmount, 240000);

    const second = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-snapshot',
      date: '2026-05-31',
      status: 'draft',
    });
    assert.equal(second.response.status, 201);
    assert.equal(second.json.amount, 190000);
    assert.equal(second.json.rentalBillingSnapshot.finalRentalAmount, 190000);
  });
});

test('contract and custom invoice amounts are not overwritten by downtime billing', async () => {
  const { app, state } = createApp();
  state.rentals = [{
    id: 'R-contract',
    counterpartyId: 'CP-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    price: 310000,
  }];
  state.gantt_rentals = [{
    id: 'GR-contract',
    rentalId: 'R-contract',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
    downtimePeriods: [
      { id: 'DT-1', rentalId: 'R-contract', startDate: '2026-05-01', endDate: '2026-05-07', reason: 'ожидание клиента', affectsBilling: true, status: 'active' },
    ],
  }];

  await withServer(app, async (baseUrl) => {
    const contract = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-contract',
      amount: 310000,
      date: '2026-05-01',
      status: 'draft',
    });
    assert.equal(contract.response.status, 201);
    assert.equal(contract.json.amount, 310000);
    assert.equal(contract.json.rentalBillingSnapshot.finalRentalAmount, 240000);

    const invoice = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'invoice',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-contract',
      amount: 50000,
      date: '2026-05-10',
      status: 'draft',
    });
    assert.equal(invoice.response.status, 201);
    assert.equal(invoice.json.amount, 50000);
    assert.equal(invoice.json.rentalBillingSnapshot.finalRentalAmount, 240000);
  });
});

test('documents API rejects duplicate manual numbers and PATCH duplicates', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const first = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      number: 'CONTRACT-2026-0007',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(first.response.status, 201);

    const duplicate = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      number: 'CONTRACT-2026-0007',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-10',
      status: 'draft',
    });
    assert.equal(duplicate.response.status, 409);

    const second = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      number: 'CONTRACT-2026-0008',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-10',
      status: 'draft',
    });
    assert.equal(second.response.status, 201);

    const patchDuplicate = await request(baseUrl, 'PATCH', `/api/documents/${second.json.id}`, 'office', {
      number: 'CONTRACT-2026-0007',
    });
    assert.equal(patchDuplicate.response.status, 409);
  });
});

test('documents API assigns number to legacy document and reports registry summary', async () => {
  const { app, state } = createApp();
  state.documents = [{
    id: 'D-legacy',
    type: 'upd',
    number: '',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2026-05-08',
    status: 'sent',
  }];
  await withServer(app, async (baseUrl) => {
    const before = await request(baseUrl, 'GET', '/api/documents/registry/summary', 'office');
    assert.equal(before.response.status, 200);
    assert.equal(before.json.withoutNumber, 1);

    const assigned = await request(baseUrl, 'POST', '/api/documents/D-legacy/assign-number', 'office');
    assert.equal(assigned.response.status, 200);
    assert.equal(assigned.json.number, 'UPD-2026-0001');
    assert.equal(assigned.json.history.some(entry => entry.action === 'number_changed'), true);

    const after = await request(baseUrl, 'GET', '/api/documents/registry/summary', 'office');
    assert.equal(after.json.withoutNumber, 0);
  });
});

test('documents print endpoint renders legacy manual records without stored html', async () => {
  const { app, state } = createApp();
  state.documents = [{
    id: 'D-legacy-print',
    type: 'contract',
    number: 'LEGACY-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    rentalId: 'R-1',
    date: '2026-05-09',
    status: 'draft',
  }];

  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/api/documents/D-legacy-print/print`, {
      headers: { authorization: 'Bearer office' },
    });
    const html = await response.text();
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') || '', /text\/html/);
    assert.match(html, /LEGACY-1/);
    assert.match(html, /ООО Клиент/);
  });
});

test('documents API records status history and blocks forbidden roles', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const denied = await request(baseUrl, 'GET', '/api/documents', 'mechanic');
    assert.equal(denied.response.status, 403);

    const managerManual = await request(baseUrl, 'POST', '/api/documents', 'manager', {
      type: 'act',
      number: 'ACT-2026-0099',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-1',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(managerManual.response.status, 403);

    const auto = await request(baseUrl, 'POST', '/api/documents', 'manager', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-1',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(auto.response.status, 201);

    const sent = await request(baseUrl, 'PATCH', `/api/documents/${auto.json.id}`, 'manager', { status: 'sent' });
    assert.equal(sent.response.status, 200);
    assert.equal(sent.json.sentAt, '2026-05-09T10:00:00.000Z');
    assert.equal(sent.json.history.some(entry => entry.field === 'status'), true);
  });
});

test('documents generate API creates every workspace document type with snapshots and print html', async () => {
  const { app, state } = createApp();
  state.service = [{
    id: 'S-1',
    clientId: 'C-1',
    rentalId: 'R-1',
    equipmentId: 'EQ-1',
    reason: 'Проверка после возврата',
    assignedMechanicId: 'M-1',
    assignedMechanicName: 'Петров',
  }];
  state.deliveries = [{ id: 'DEL-1', rentalId: 'R-1', clientId: 'C-1', equipmentId: 'EQ-1', status: 'planned', routeTo: 'Объект клиента' }];
  state.mechanics = [{ id: 'M-1', name: 'Петров' }];
  state.service_vehicles = [{ id: 'CAR-1', make: 'УАЗ', model: 'Профи', plateNumber: 'А001АА' }];

  const cases = [
    ['rental_contract', { clientId: 'C-1', signerName: 'Иванов Иван', signerPosition: 'директор', signerBasis: 'Устав' }, 'DA-2026-0001'],
    ['rental_specification', { clientId: 'C-1', contractNumber: 'DA-2026-0001', rentalId: 'R-1', equipmentId: 'EQ-1', dailyRate: '10000/день' }, 'SP-2026-0001'],
    ['transfer_act_to_client', { clientId: 'C-1', rentalId: 'R-1', deliveryId: 'DEL-1', equipmentId: 'EQ-1', transferDate: '2026-05-10' }, 'AP-2026-0001'],
    ['return_act_from_client', { clientId: 'C-1', rentalId: 'R-1', deliveryId: 'DEL-1', equipmentId: 'EQ-1', serviceTicketId: 'S-1', returnDate: '2026-05-12' }, 'AR-2026-0001'],
    ['work_order', { serviceTicketId: 'S-1', equipmentId: 'EQ-1', mechanicId: 'M-1', clientId: 'C-1', rentalId: 'R-1' }, 'ZN-2026-0001'],
    ['trip_ticket', { mechanicId: 'M-1', serviceCarId: 'CAR-1', serviceTicketId: 'S-1' }, 'PL-2026-0001'],
  ];

  await withServer(app, async (baseUrl) => {
    for (const [type, payload, expectedNumber] of cases) {
      const generated = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
        type,
        date: '2026-05-09',
        ...payload,
      });
      assert.equal(generated.response.status, 201, `${type}: ${JSON.stringify(generated.json)}`);
      assert.equal(generated.json.type, type);
      assert.equal(generated.json.number, expectedNumber);
      assert.equal(generated.json.date, '2026-05-09');
      assert.equal(generated.json.documentDate, '2026-05-09');
      assert.equal(generated.json.status, 'draft');
      assert.ok(generated.json.snapshot.generatedAt);
      assert.match(generated.json.printHtml, /<!doctype html>/i);
      assert.ok(Array.isArray(generated.json.payload.lines));
      if (type === 'rental_contract') {
        assert.equal(generated.json.rentalId, undefined);
        assert.equal(generated.json.payload.signer.name, 'Иванов Иван');
        assert.equal(generated.json.payload.requisites.inn, '7701000000');
        assert.equal(generated.json.payload.bank.bankName, 'АО Тест Банк');
        assert.match(generated.json.printHtml, /№ DA-2026-0001 от 2026-05-09/);
        assert.match(generated.json.printHtml, /рамочным договором аренды/);
        assert.match(generated.json.printHtml, /спецификация является приложением/);
        assert.match(generated.json.printHtml, /Юридическое название/);
        assert.match(generated.json.printHtml, /ИНН/);
        assert.match(generated.json.printHtml, /7701000000/);
        assert.match(generated.json.printHtml, /КПП/);
        assert.match(generated.json.printHtml, /770101001/);
        assert.match(generated.json.printHtml, /ОГРН/);
        assert.match(generated.json.printHtml, /1027700000000/);
        assert.match(generated.json.printHtml, /Юридический адрес/);
        assert.match(generated.json.printHtml, /Москва, ул\. Тестовая, 1/);
        assert.match(generated.json.printHtml, /Почтовый адрес/);
        assert.match(generated.json.printHtml, /101000, Москва, а\/я 5/);
        assert.match(generated.json.printHtml, /ФИО подписанта/);
        assert.match(generated.json.printHtml, /Должность подписанта/);
        assert.match(generated.json.printHtml, /Основание подписания/);
        assert.match(generated.json.printHtml, /Банковские реквизиты/);
        assert.match(generated.json.printHtml, /АО Тест Банк/);
        assert.match(generated.json.printHtml, /044525000/);
        assert.match(generated.json.printHtml, /40702810000000000001/);
        assert.match(generated.json.printHtml, /Подписи сторон/);
        assert.match(generated.json.printHtml, /Арендодатель/);
        assert.match(generated.json.printHtml, /Арендатор/);
        assert.doesNotMatch(generated.json.printHtml, /A-1/);
        assert.doesNotMatch(generated.json.printHtml, /R-1/);
        assert.doesNotMatch(generated.json.printHtml, /Сервисная заявка/);
        assert.doesNotMatch(generated.json.printHtml, /Механик/);
        assert.doesNotMatch(generated.json.printHtml, /Служебный автомобиль|служебная машина/i);
        assert.doesNotMatch(generated.json.printHtml, /Пробег|Запчасти|Выполненные работы/);
      }
    }
  });
});

test('rental contract print uses stored snapshot, preserves date, and tolerates partial client requisites', async () => {
  const { app, state } = createApp();
  state.clients.push({
    id: 'C-partial',
    counterpartyId: 'CP-partial',
    company: 'ИП Частичный',
    inn: '771122334455',
    legalAddress: 'Москва, пер. Короткий, 2',
  });
  state.counterparties.push({
    id: 'CP-partial',
    type: 'individual_entrepreneur',
    legalName: 'ИП Частичный',
    shortName: 'ИП Частичный',
    inn: '771122334455',
    legalAddress: 'Москва, пер. Короткий, 2',
    status: 'active',
    archivedAt: null,
    roles: ['customer'],
  });
  state.counterparty_role_assignments.push({
    id: 'CPRA-partial',
    counterpartyId: 'CP-partial',
    roleCode: 'customer',
    status: 'active',
    validTo: null,
  });

  await withServer(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      clientId: 'C-1',
      signerName: 'Иванов Иван Иванович',
      signerPosition: 'Генеральный директор',
      signerBasis: 'Устав',
      date: '2026-05-09',
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.json.date, '2026-05-09');
    assert.equal(created.json.documentDate, '2026-05-09');
    assert.equal(created.json.snapshot.client.inn, '7701000000');

    state.clients[0] = {
      ...state.clients[0],
      company: 'ООО Клиент После Изменения',
      inn: '9999999999',
      legalAddress: 'Новый адрес',
      bankName: 'Новый Банк',
    };

    const print = await fetch(`${baseUrl}/api/documents/${created.json.id}/print`, {
      headers: { authorization: 'Bearer office' },
    });
    const html = await print.text();
    assert.equal(print.status, 200);
    assert.match(html, /№ DA-2026-0001 от 2026-05-09/);
    assert.match(html, /7701000000/);
    assert.match(html, /Москва, ул\. Тестовая, 1/);
    assert.match(html, /АО Тест Банк/);
    assert.doesNotMatch(html, /9999999999/);
    assert.doesNotMatch(html, /Новый адрес/);
    assert.doesNotMatch(html, /Новый Банк/);

    const partial = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      clientId: 'C-partial',
      signerName: 'Петров Пётр Петрович',
      signerPosition: 'Индивидуальный предприниматель',
      signerBasis: 'ОГРНИП',
      date: '2026-05-09',
    });
    assert.equal(partial.response.status, 201);
    assert.match(partial.json.printHtml, /ИП Частичный/);
    assert.match(partial.json.printHtml, /771122334455/);
    assert.match(partial.json.printHtml, /Москва, пер\. Короткий, 2/);
    assert.doesNotMatch(partial.json.printHtml, /<th>КПП<\/th>/);
    assert.doesNotMatch(partial.json.printHtml, /<th>ОГРН<\/th>/);
    assert.doesNotMatch(partial.json.printHtml, /Банковские реквизиты/);
  });
});

test('rental document chain links specification and acts through immutable snapshots', async () => {
  const { app, state } = createApp();

  await withServer(app, async (baseUrl) => {
    const contract = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      clientId: 'C-1',
      signerName: 'Иванов Иван Иванович',
      signerPosition: 'Генеральный директор',
      signerBasis: 'Устав',
      date: '2026-05-09',
    });
    assert.equal(contract.response.status, 201);
    assert.equal(contract.json.rentalId, undefined);

    const specification = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_specification',
      parentDocumentId: contract.json.id,
      clientId: 'C-1',
      rentalId: 'R-1',
      equipmentId: 'EQ-1',
      dailyRate: '10000/день',
      amount: 30000,
      date: '2026-05-09',
      notes: 'Тестовая спецификация',
    });
    assert.equal(specification.response.status, 201, JSON.stringify(specification.json));
    assert.equal(specification.json.parentDocumentId, contract.json.id);
    assert.equal(specification.json.snapshot.parentDocument.number, contract.json.number);
    assert.equal(specification.json.snapshot.equipment.model, 'GS-1932');
    assert.match(specification.json.printHtml, new RegExp(`Договор № ${contract.json.number}`));
    assert.match(specification.json.printHtml, /Genie GS-1932/);
    assert.match(specification.json.printHtml, /A-1/);
    assert.match(specification.json.printHtml, /SN-1/);
    assert.match(specification.json.printHtml, /10000\/день/);
    assert.doesNotMatch(specification.json.printHtml, /Сервисная заявка|Механик|Служебный автомобиль|Пробег|Запчасти|Выполненные работы/);

    state.clients[0].company = 'ООО Новое имя';
    state.equipment[0].model = 'Changed';
    const storedSpec = await request(baseUrl, 'GET', `/api/documents/${specification.json.id}`, 'office');
    assert.equal(storedSpec.response.status, 200);
    assert.equal(storedSpec.json.snapshot.client.company, 'ООО Клиент');
    assert.equal(storedSpec.json.snapshot.equipment.model, 'GS-1932');

    const transfer = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'transfer_act_to_client',
      parentDocumentId: contract.json.id,
      specificationId: specification.json.id,
      clientId: 'C-1',
      rentalId: 'R-1',
      equipmentId: 'EQ-1',
      transferDate: '2026-05-10',
      equipmentCondition: 'Исправна',
      completeness: 'АКБ, зарядное устройство',
    });
    assert.equal(transfer.response.status, 201, JSON.stringify(transfer.json));
    assert.equal(transfer.json.specificationId, specification.json.id);
    assert.match(transfer.json.printHtml, /Дата передачи/);
    assert.match(transfer.json.printHtml, /Спецификация №/);
    assert.match(transfer.json.printHtml, /Исправна/);

    const returned = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'return_act_from_client',
      parentDocumentId: contract.json.id,
      specificationId: specification.json.id,
      clientId: 'C-1',
      rentalId: 'R-1',
      equipmentId: 'EQ-1',
      returnDate: '2026-05-12',
      returnCondition: 'Рабочее',
      damages: 'Нет',
      missingItems: 'Нет',
      serviceRequired: 'Нет',
    });
    assert.equal(returned.response.status, 201, JSON.stringify(returned.json));
    assert.equal(returned.json.specificationId, specification.json.id);
    assert.match(returned.json.printHtml, /Дата возврата/);
    assert.match(returned.json.printHtml, /Состояние при возврате/);
    assert.match(returned.json.printHtml, /Повреждения/);
    assert.doesNotMatch(returned.json.printHtml, /<th>Сервисная заявка<\/th>\s*<td>—<\/td>/);
    assert.doesNotMatch(returned.json.printHtml, /Сервисная заявка<\/th>/);

    const returnedWithService = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'return_act_from_client',
      parentDocumentId: contract.json.id,
      specificationId: specification.json.id,
      clientId: 'C-1',
      rentalId: 'R-1',
      equipmentId: 'EQ-1',
      returnDate: '2026-05-12',
      returnCondition: 'Требует ремонта',
      damages: 'Повреждение ограждения',
      missingItems: 'Нет',
      serviceRequired: 'Да',
      serviceTicketId: 'S-1',
    });
    assert.equal(returnedWithService.response.status, 201, JSON.stringify(returnedWithService.json));
    assert.match(returnedWithService.json.printHtml, /<th>Сервисная заявка<\/th>\s*<td>S-1<\/td>/);
  });
});

test('documents generate API rejects missing required data and supports status endpoints, duplicate, print and delete', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const missingClient = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      signerName: 'Иванов Иван',
      signerPosition: 'директор',
      signerBasis: 'Устав',
      date: '2026-05-09',
    });
    assert.equal(missingClient.response.status, 400);
    assert.equal(missingClient.json.code, 'COUNTERPARTY_RELATION_ID_REQUIRED');

    const missing = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      clientId: 'C-1',
      signerName: 'Иванов Иван',
      signerPosition: 'директор',
      date: '2026-05-09',
    });
    assert.equal(missing.response.status, 400);
    assert.equal(missing.json.code, 'DOCUMENT_REQUIRED_FIELDS');

    const missingSigner = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      clientId: 'C-1',
      signerPosition: 'директор',
      signerBasis: 'Устав',
      date: '2026-05-09',
    });
    assert.equal(missingSigner.response.status, 400);
    assert.equal(missingSigner.json.code, 'DOCUMENT_REQUIRED_FIELDS');

    const missingSpecBasis = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_specification',
      clientId: 'C-1',
      equipmentId: 'EQ-1',
      dailyRate: '10000/день',
      date: '2026-05-09',
    });
    assert.equal(missingSpecBasis.response.status, 400);
    assert.equal(missingSpecBasis.json.code, 'DOCUMENT_REQUIRED_FIELDS');

    const missingTransferEquipment = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'transfer_act_to_client',
      clientId: 'C-1',
      transferDate: '2026-05-10',
      date: '2026-05-09',
    });
    assert.equal(missingTransferEquipment.response.status, 400);
    assert.equal(missingTransferEquipment.json.code, 'DOCUMENT_REQUIRED_FIELDS');

    const missingReturnDate = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'return_act_from_client',
      clientId: 'C-1',
      equipmentId: 'EQ-1',
      date: '2026-05-09',
    });
    assert.equal(missingReturnDate.response.status, 400);
    assert.equal(missingReturnDate.json.code, 'DOCUMENT_REQUIRED_FIELDS');

    const created = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      clientId: 'C-1',
      signerName: 'Иванов Иван',
      signerPosition: 'директор',
      signerBasis: 'Устав',
      date: '2026-05-09',
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.json.clientId, 'C-1');
    assert.equal(created.json.date, '2026-05-09');
    assert.equal(created.json.documentDate, '2026-05-09');

    const sent = await request(baseUrl, 'POST', `/api/documents/${created.json.id}/mark-sent`, 'office', { status: 'pending_signature' });
    assert.equal(sent.response.status, 200);
    assert.equal(sent.json.status, 'pending_signature');
    assert.equal(sent.json.sentAt, '2026-05-09T10:00:00.000Z');

    const signed = await request(baseUrl, 'POST', `/api/documents/${created.json.id}/mark-signed`, 'office');
    assert.equal(signed.response.status, 200);
    assert.equal(signed.json.status, 'signed');
    assert.equal(signed.json.signedAt, '2026-05-09T10:00:00.000Z');

    const duplicate = await request(baseUrl, 'POST', `/api/documents/${created.json.id}/duplicate`, 'office');
    assert.equal(duplicate.response.status, 201);
    assert.equal(duplicate.json.status, 'draft');
    assert.notEqual(duplicate.json.number, created.json.number);

    const print = await fetch(`${baseUrl}/api/documents/${created.json.id}/print`, {
      headers: { authorization: 'Bearer office' },
    });
    assert.equal(print.status, 200);
    assert.match(await print.text(), /Договор аренды/);

    const deleted = await request(baseUrl, 'DELETE', `/api/documents/${duplicate.json.id}`, 'admin');
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.json.ok, true);
  });
});

function documentNumberingState(state) {
  return structuredClone({
    documents: state.documents,
    app_settings: state.app_settings,
  });
}

function assertUniqueStoredDocumentNumbers(state) {
  const numbers = state.documents
    .map(document => String(document.number || document.documentNumber || '').trim())
    .filter(Boolean);
  assert.equal(new Set(numbers).size, numbers.length);
}

function assertNumberingBatch(entries) {
  assert.deepEqual(entries.map(entry => entry.name), ['documents', 'app_settings']);
}

test('document create rolls back document and numbering settings together when the batch fails', async () => {
  const context = createApp();
  const payload = {
    type: 'contract',
    clientId: 'C-1',
    date: '2026-05-09',
    status: 'draft',
  };

  await withServer(context.app, async baseUrl => {
    const before = documentNumberingState(context.state);
    context.failNextBatch();
    const failed = await request(baseUrl, 'POST', '/api/documents', 'office', payload);
    assert.equal(failed.response.status, 503);
    assert.equal(failed.json.code, 'INJECTED_DOCUMENT_BATCH_FAILURE');
    assert.deepEqual(documentNumberingState(context.state), before);
    assertNumberingBatch(context.batchWrites.at(-1));

    const first = await request(baseUrl, 'POST', '/api/documents', 'office', payload);
    const second = await request(baseUrl, 'POST', '/api/documents', 'office', payload);
    assert.equal(first.response.status, 201, JSON.stringify(first.json));
    assert.equal(second.response.status, 201, JSON.stringify(second.json));
    assert.equal(first.json.number, 'CONTRACT-2026-0001');
    assert.equal(second.json.number, 'CONTRACT-2026-0002');
    assertUniqueStoredDocumentNumbers(context.state);
  });
});

test('document generate rolls back document and numbering settings together when the batch fails', async () => {
  const context = createApp();
  const payload = {
    type: 'commercial_offer',
    clientId: 'C-1',
    date: '2026-05-09',
    status: 'draft',
  };

  await withServer(context.app, async baseUrl => {
    const before = documentNumberingState(context.state);
    context.failNextBatch();
    const failed = await request(baseUrl, 'POST', '/api/documents/generate', 'office', payload);
    assert.equal(failed.response.status, 503);
    assert.equal(failed.json.code, 'INJECTED_DOCUMENT_BATCH_FAILURE');
    assert.deepEqual(documentNumberingState(context.state), before);
    assertNumberingBatch(context.batchWrites.at(-1));

    const first = await request(baseUrl, 'POST', '/api/documents/generate', 'office', payload);
    const second = await request(baseUrl, 'POST', '/api/documents/generate', 'office', payload);
    assert.equal(first.response.status, 201, JSON.stringify(first.json));
    assert.equal(second.response.status, 201, JSON.stringify(second.json));
    assert.equal(first.json.number, 'KP-2026-0001');
    assert.equal(second.json.number, 'KP-2026-0002');
    assertUniqueStoredDocumentNumbers(context.state);
  });
});

test('document duplicate rolls back document and numbering settings together when the batch fails', async () => {
  const context = createApp();

  await withServer(context.app, async baseUrl => {
    const source = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      date: '2026-05-09',
      status: 'sent',
    });
    assert.equal(source.response.status, 201, JSON.stringify(source.json));

    const before = documentNumberingState(context.state);
    context.failNextBatch();
    const failed = await request(baseUrl, 'POST', `/api/documents/${source.json.id}/duplicate`, 'office');
    assert.equal(failed.response.status, 503);
    assert.equal(failed.json.code, 'INJECTED_DOCUMENT_BATCH_FAILURE');
    assert.deepEqual(documentNumberingState(context.state), before);
    assertNumberingBatch(context.batchWrites.at(-1));

    const first = await request(baseUrl, 'POST', `/api/documents/${source.json.id}/duplicate`, 'office');
    const second = await request(baseUrl, 'POST', `/api/documents/${source.json.id}/duplicate`, 'office');
    assert.equal(first.response.status, 201, JSON.stringify(first.json));
    assert.equal(second.response.status, 201, JSON.stringify(second.json));
    assert.equal(first.json.number, 'ACT-2026-0002');
    assert.equal(second.json.number, 'ACT-2026-0003');
    assertUniqueStoredDocumentNumbers(context.state);
  });
});

test('assign-number rolls back document and numbering settings together when the batch fails', async () => {
  const context = createApp();
  context.state.documents = [{
    id: 'D-numbered',
    type: 'upd',
    documentType: 'upd',
    number: 'UPD-2026-0001',
    documentNumber: 'UPD-2026-0001',
    counterpartyId: 'CP-1',
    clientId: 'C-1',
    date: '2026-05-08',
    documentDate: '2026-05-08',
    status: 'sent',
  }, {
    id: 'D-legacy-1',
    type: 'upd',
    documentType: 'upd',
    number: '',
    documentNumber: '',
    counterpartyId: 'CP-1',
    clientId: 'C-1',
    date: '2026-05-09',
    documentDate: '2026-05-09',
    status: 'sent',
  }];

  await withServer(context.app, async baseUrl => {
    const before = documentNumberingState(context.state);
    context.failNextBatch();
    const failed = await request(baseUrl, 'POST', '/api/documents/D-legacy-1/assign-number', 'office');
    assert.equal(failed.response.status, 503);
    assert.equal(failed.json.code, 'INJECTED_DOCUMENT_BATCH_FAILURE');
    assert.deepEqual(documentNumberingState(context.state), before);
    assertNumberingBatch(context.batchWrites.at(-1));

    const first = await request(baseUrl, 'POST', '/api/documents/D-legacy-1/assign-number', 'office');
    assert.equal(first.response.status, 200, JSON.stringify(first.json));
    assert.equal(first.json.number, 'UPD-2026-0002');

    context.state.documents.push({
      id: 'D-legacy-2',
      type: 'upd',
      documentType: 'upd',
      number: '',
      documentNumber: '',
      counterpartyId: 'CP-1',
      clientId: 'C-1',
      date: '2026-05-09',
      documentDate: '2026-05-09',
      status: 'sent',
    });
    const second = await request(baseUrl, 'POST', '/api/documents/D-legacy-2/assign-number', 'office');
    assert.equal(second.response.status, 200, JSON.stringify(second.json));
    assert.equal(second.json.number, 'UPD-2026-0003');
    assertUniqueStoredDocumentNumbers(context.state);
  });
});
