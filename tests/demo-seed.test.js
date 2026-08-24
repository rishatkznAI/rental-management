import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { calculateCurrentFleetUtilization } from '../src/app/lib/fleetUtilization.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  DEMO_COMPANY_ID,
  DEMO_PREFIX,
  DEMO_USER_EMAILS,
  assertDemoSeedAllowed,
  buildDemoData,
} = require('../server/scripts/seed-demo-data.js');

function runSeed(dbPath, extraEnv = {}) {
  return execFileSync('node', ['server/scripts/seed-demo-data.js'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      ...process.env,
      DB_PATH: dbPath,
      NODE_ENV: 'test',
      DEMO_ENV: 'true',
      ALLOW_DEMO_SEED: 'true',
      DEMO_DEFAULT_PASSWORD: 'unit-test-demo-password',
      ...extraEnv,
    },
  });
}

function readCollection(dbPath, name) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
    return row ? JSON.parse(row.json) : [];
  } finally {
    db.close();
  }
}

function writeCollection(dbPath, name, value) {
  const db = new Database(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS app_data (
        name TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      )
    `);
    db.prepare(`
      INSERT INTO app_data (name, json)
      VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET json = excluded.json
    `).run(name, JSON.stringify(value));
  } finally {
    db.close();
  }
}

function withDemoDb(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'rental-demo-seed-'));
  const dbPath = join(dir, 'demo.sqlite');
  try {
    return fn(dbPath);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('demo seed refuses production and staging environments', () => {
  assert.throws(
    () => assertDemoSeedAllowed({ env: { DEMO_ENV: 'true', NODE_ENV: 'production' }, dbPath: '/data/demo.sqlite' }),
    /production-like/,
  );
  assert.throws(
    () => assertDemoSeedAllowed({ env: { DEMO_ENV: 'true', APP_ENV: 'staging', NODE_ENV: 'test' }, dbPath: '/data/demo.sqlite' }),
    /staging-like/,
  );
});

test('demo seed requires explicit demo seed permission', () => {
  assert.throws(
    () => assertDemoSeedAllowed({ env: { NODE_ENV: 'test' }, dbPath: '/tmp/demo.sqlite' }),
    /DEMO_ENV=true or ALLOW_DEMO_SEED=true/,
  );
  assert.equal(
    assertDemoSeedAllowed({ env: { NODE_ENV: 'test', ALLOW_DEMO_SEED: 'true', APP_ENV: 'demo' }, dbPath: '/tmp/demo.sqlite' }),
    true,
  );
});

test('demo seed refuses non-demo database paths', () => {
  assert.throws(
    () => assertDemoSeedAllowed({ env: { DEMO_ENV: 'true', NODE_ENV: 'test' }, dbPath: '/data/app.sqlite' }),
    /clearly named demo database/,
  );
});

test('demo seed creates only DEMO-prefixed records and demo users', () => withDemoDb((dbPath) => {
  const output = runSeed(dbPath);
  assert.match(output, /Seeded demo records/);
  assert.doesNotMatch(output, /unit-test-demo-password|h2:scrypt|TOKEN|SECRET|sk-/i);

  const users = readCollection(dbPath, 'users');
  const counterparties = readCollection(dbPath, 'counterparties');
  const roleAssignments = readCollection(dbPath, 'counterparty_role_assignments');
  const supplierProfiles = readCollection(dbPath, 'supplier_profiles');
  const contractorProfiles = readCollection(dbPath, 'contractor_profiles');
  const clients = readCollection(dbPath, 'clients');
  const clientObjects = readCollection(dbPath, 'client_objects');
  const clientContracts = readCollection(dbPath, 'client_contracts');
  const equipment = readCollection(dbPath, 'equipment');
  const rentals = readCollection(dbPath, 'rentals');
  const service = readCollection(dbPath, 'service');
  const deliveries = readCollection(dbPath, 'deliveries');
  const deliveryCarriers = readCollection(dbPath, 'delivery_carriers');

  assert.deepEqual(users.map(user => user.email).sort(), [...DEMO_USER_EMAILS].sort());
  assert.ok(users.every(user => String(user.id).startsWith(DEMO_PREFIX)));
  assert.ok(users.every(user => String(user.password || '').startsWith('h2:scrypt:')));
  assert.equal(equipment.length, 20);
  assert.equal(clients.length, 5);
  assert.equal(counterparties.length, clients.length + 1);
  assert.equal(roleAssignments.length, counterparties.length);
  assert.ok(roleAssignments.every(assignment => (
    ['customer', 'contractor'].includes(assignment.roleCode)
    && assignment.status === 'active'
    && counterparties.some(counterparty => counterparty.id === assignment.counterpartyId)
  )));
  assert.deepEqual(supplierProfiles, []);
  assert.equal(contractorProfiles.length, 1);
  assert.equal(contractorProfiles[0].counterpartyId, 'DEMO-CP-CONTRACTOR-001');
  for (const collection of [
    counterparties,
    roleAssignments,
    contractorProfiles,
    clients,
    clientObjects,
    clientContracts,
  ]) {
    assert.ok(collection.every(item => (
      item.companyId === DEMO_COMPANY_ID && item.tenantId === DEMO_COMPANY_ID
    )));
  }
  assert.ok(clients.every(client => counterparties.some(counterparty => (
    counterparty.id === client.counterpartyId
    && counterparty.roles.includes('customer')
  ))));
  assert.equal(clientObjects.length, clients.length);
  assert.ok(clientObjects.every(object => (
    object.counterpartyId
    && clients.some(client => client.id === object.clientId && client.counterpartyId === object.counterpartyId)
  )));
  assert.equal(clientContracts.length, clients.length);
  assert.ok(rentals.every(item => clientObjects.some(object => object.id === item.objectId && object.clientId === item.clientId)));
  assert.ok(rentals.every(item => clientContracts.some(contract => contract.id === item.contractId && contract.clientId === item.clientId)));
  assert.ok(rentals.every(item => item.contractNumber === clientContracts.find(contract => contract.id === item.contractId)?.number));
  assert.ok(rentals.some(item => item.status === 'active'));
  assert.ok(rentals.some(item => item.status === 'closed'));
  assert.ok(rentals.some(item => item.status === 'created'));
  assert.ok(service.some(item => item.status === 'waiting_parts'));
  assert.equal(service.length, 66);
  assert.ok(service.every(item => ![
    'counterpartyId', 'clientId', 'rentalId', 'objectId', 'contractId',
    'client', 'clientName', 'company', 'companyName', 'clientInn', 'customerPhone',
    'objectName', 'objectAddress', 'contractNumber',
  ].some(field => String(item?.[field] || '').trim())));
  assert.ok(deliveries.some(item => item.status === 'new'));
  assert.ok(deliveries.some(item => item.status === 'in_transit'));
  assert.ok(deliveries.some(item => item.status === 'completed'));
  assert.ok(deliveries.every(item => item.counterpartyId && item.carrierCounterpartyId));
  assert.equal(deliveryCarriers[0].counterpartyId, 'DEMO-CP-CONTRACTOR-001');

  const authorityDb = new Database(dbPath, { readonly: true });
  try {
    assert.equal(
      authorityDb.prepare('SELECT status FROM canonical_companies WHERE id = ?').get(DEMO_COMPANY_ID).status,
      'active',
    );
    assert.equal(
      authorityDb.prepare(`
        SELECT COUNT(*) AS count
        FROM company_memberships
        WHERE companyId = ? AND status = 'active'
      `).get(DEMO_COMPANY_ID).count,
      4,
    );
  } finally {
    authorityDb.close();
  }

  for (const collection of [users, counterparties, clients, equipment, rentals, service, deliveries]) {
    assert.ok(collection.every(item => String(item.id || '').startsWith(DEMO_PREFIX)));
    assert.ok(collection.every(item => item.fixtureTag === DEMO_PREFIX));
  }
}));

test('demo seed produces presentation-grade dashboard KPI source data', () => {
  const data = buildDemoData({
    now: new Date('2026-06-03T09:00:00.000Z'),
    env: { DEMO_DEFAULT_PASSWORD: 'unit-test-demo-password' },
  });

  const utilization = calculateCurrentFleetUtilization(
    data.equipment,
    data.gantt_rentals.filter(rental => rental.status === 'active'),
  );
  const openServiceTickets = data.service.filter(ticket => ticket.status !== 'closed');
  const diagnosticTicketIds = new Set(
    openServiceTickets
      .filter(ticket => [
        ticket.reason,
        ticket.description,
        ticket.type,
        ticket.scenario,
        ticket.serviceKind,
      ].filter(Boolean).join(' ').toLowerCase().includes('диагност'))
      .map(ticket => ticket.id),
  );
  const unassignedDiagnostics = openServiceTickets.filter(ticket =>
    diagnosticTicketIds.has(ticket.id)
    && !ticket.assignedMechanicId
    && !ticket.assignedMechanicName
    && !ticket.assignedTo
  );

  assert.equal(utilization.activeEquipment, 20);
  assert.equal(utilization.rentedEquipment, 13);
  assert.equal(utilization.utilization, 65);
  assert.equal(openServiceTickets.length, 63);
  assert.equal(openServiceTickets.filter(ticket => ticket.status === 'in_progress' && !diagnosticTicketIds.has(ticket.id)).length, 28);
  assert.equal(openServiceTickets.filter(ticket => ticket.status === 'waiting_parts').length, 14);
  assert.equal(unassignedDiagnostics.length, 11);
  assert.equal(openServiceTickets.filter(ticket => ticket.status === 'ready').length, 10);
});

test('demo rental dates stay relative to the supplied current date', () => {
  const now = new Date('2031-02-14T09:00:00.000Z');
  const data = buildDemoData({ now, env: { DEMO_DEFAULT_PASSWORD: 'unit-test-demo-password' } });
  const activeRental = data.rentals.find(item => item.id === 'DEMO-RENTAL-001');
  const futureRental = data.rentals.find(item => item.id === 'DEMO-RENTAL-004');

  assert.equal(activeRental.startDate, '2031-02-08');
  assert.equal(activeRental.plannedReturnDate, '2031-02-22');
  assert.equal(futureRental.startDate, '2031-02-18');
  assert.ok(data.client_contracts.every(contract => contract.number.includes('2031')));
});

test('demo seed is idempotent and does not touch non-demo records', () => withDemoDb((dbPath) => {
  writeCollection(dbPath, 'clients', [
    { id: 'CLIENT-PROTECTED', company: 'Protected Existing Client' },
    { id: 'DEMO-CLIENT-OLD', company: 'Old Demo Client', fixtureTag: DEMO_PREFIX },
  ]);
  writeCollection(dbPath, 'equipment', [
    { id: 'EQ-PROTECTED', inventoryNumber: 'PROTECTED-001' },
    { id: 'DEMO-EQ-OLD', inventoryNumber: 'DEMO-EQ-OLD', fixtureTag: DEMO_PREFIX },
  ]);

  runSeed(dbPath);
  runSeed(dbPath);

  const clients = readCollection(dbPath, 'clients');
  const counterparties = readCollection(dbPath, 'counterparties');
  const equipment = readCollection(dbPath, 'equipment');
  assert.equal(clients.filter(item => String(item.id).startsWith(DEMO_PREFIX)).length, 5);
  assert.equal(counterparties.filter(item => String(item.id).startsWith(DEMO_PREFIX)).length, 6);
  assert.ok(clients
    .filter(client => String(client.id).startsWith(DEMO_PREFIX))
    .every(client => counterparties.some(counterparty => counterparty.id === client.counterpartyId)));
  assert.equal(equipment.filter(item => String(item.id).startsWith(DEMO_PREFIX)).length, 20);
  assert.equal(clients.some(item => item.id === 'CLIENT-PROTECTED'), true);
  assert.equal(equipment.some(item => item.id === 'EQ-PROTECTED'), true);
  assert.equal(clients.some(item => item.id === 'DEMO-CLIENT-OLD'), false);
  assert.equal(equipment.some(item => item.id === 'DEMO-EQ-OLD'), false);
}));

test('demo data has no real-looking credentials, external emails, tokens, bot, or GSM data', () => {
  const data = buildDemoData({ env: { DEMO_DEFAULT_PASSWORD: 'unit-test-demo-password' } });
  const visible = JSON.stringify({
    clients: data.clients,
    equipment: data.equipment,
    rentals: data.rentals,
    documents: data.documents,
    payments: data.payments,
    service: data.service,
    deliveries: data.deliveries,
    debt_collection_plans: data.debt_collection_plans,
  });

  assert.doesNotMatch(visible, /sk-[A-Za-z0-9]|Bearer\s+|password|secret|token|webhook|BOT_TOKEN|MAX_WEBHOOK_SECRET/i);
  assert.doesNotMatch(visible, /@[a-z0-9.-]+\.(ru|com|net|org)\b/i);
  assert.ok(data.clients.every(client => String(client.inn || '').startsWith('DEMO-INN-')));
  assert.doesNotMatch(visible, /imei|gsm|gprs/i);
});
