import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const { assertDemoResetAllowed, getDemoPublicInfo } = require('../server/lib/demo-mode.js');

function runSeed(dbPath, extraEnv = {}) {
  return execFileSync('node', ['server/scripts/seed-demo-data.js', '--reset'], {
    cwd: new URL('..', import.meta.url),
    encoding: 'utf8',
    env: {
      ...process.env,
      DB_PATH: dbPath,
      DEMO_MODE: 'true',
      NODE_ENV: 'test',
      ...extraEnv,
    },
  });
}

function readCollection(dbPath, name) {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
    return row ? JSON.parse(row.json) : null;
  } finally {
    db.close();
  }
}

function writeCollection(dbPath, name, value) {
  const db = new Database(dbPath);
  try {
    db.prepare(`
      INSERT INTO app_data (name, json)
      VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET json = excluded.json
    `).run(name, JSON.stringify(value));
  } finally {
    db.close();
  }
}

test('demo reset guards refuse non-demo environments and production-looking DB paths', () => {
  assert.throws(
    () => assertDemoResetAllowed({ env: { DEMO_MODE: '', NODE_ENV: 'test' }, dbPath: '/tmp/demo.sqlite' }),
    /DEMO_MODE=true/,
  );
  assert.throws(
    () => assertDemoResetAllowed({ env: { DEMO_MODE: 'true', NODE_ENV: 'production' }, dbPath: '/tmp/demo.sqlite' }),
    /DEMO_ALLOW_RESET=true/,
  );
  assert.throws(
    () => assertDemoResetAllowed({ env: { DEMO_MODE: 'true', NODE_ENV: 'test' }, dbPath: '/data/app.sqlite' }),
    /clearly named demo database/,
  );
  assert.equal(
    assertDemoResetAllowed({ env: { DEMO_MODE: 'true', NODE_ENV: 'production', DEMO_ALLOW_RESET: 'true' }, dbPath: '/data/demo.sqlite' }),
    true,
  );
});

test('seed script creates demo entities and demo users in an isolated DB', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rental-demo-'));
  const dbPath = join(dir, 'demo.sqlite');
  try {
    const output = runSeed(dbPath);
    assert.match(output, /Seeded demo database/);

    const users = readCollection(dbPath, 'users');
    const clients = readCollection(dbPath, 'clients');
    const equipment = readCollection(dbPath, 'equipment');
    const rentals = readCollection(dbPath, 'rentals');
    const documents = readCollection(dbPath, 'documents');
    const payments = readCollection(dbPath, 'payments');
    const service = readCollection(dbPath, 'service');
    const deliveries = readCollection(dbPath, 'deliveries');
    const plans = readCollection(dbPath, 'debt_collection_plans');

    assert.deepEqual(users.map(user => user.id), ['demo-admin', 'demo-office', 'demo-rental-manager', 'demo-service']);
    assert.ok(users.every(user => user.status === 'Активен' && String(user.password || '').startsWith('h2:scrypt:')));
    assert.ok(clients.every(client => typeof client.creditLimit === 'number' && Number.isFinite(client.creditLimit)));
    assert.ok(clients.length >= 2);
    assert.ok(equipment.length >= 3);
    assert.ok(rentals.length >= 2);
    assert.ok(documents.length >= 2);
    assert.ok(payments.length >= 2);
    assert.ok(service.length >= 1);
    assert.ok(deliveries.length >= 1);
    assert.ok(plans.length >= 1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demo seed creates planner-visible equipment and linked gantt rentals', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rental-demo-'));
  const dbPath = join(dir, 'demo.sqlite');
  try {
    runSeed(dbPath);
    const equipment = readCollection(dbPath, 'equipment');
    const ganttRentals = readCollection(dbPath, 'gantt_rentals');

    const plannerEquipment = equipment.filter(item =>
      item.activeInFleet === true &&
      (item.category === 'own' || item.category === 'partner') &&
      ['available', 'rented', 'reserved', 'in_service', 'inactive'].includes(item.status) &&
      ['own', 'investor', 'sublease'].includes(item.owner) &&
      ['scissor', 'articulated', 'telescopic', 'mast'].includes(item.type) &&
      ['diesel', 'electric'].includes(item.drive)
    );
    assert.equal(plannerEquipment.length, equipment.length);

    const equipmentIds = new Set(equipment.map(item => item.id));
    assert.ok(ganttRentals.some(item => item.status === 'active'));
    assert.ok(ganttRentals.some(item => item.status === 'created'));
    assert.ok(ganttRentals.every(item => item.equipmentId && equipmentIds.has(item.equipmentId)));
    assert.ok(ganttRentals.every(item => item.rentalId && item.startDate && item.endDate && typeof item.amount === 'number'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demo reset removes created demo records and restores seed data', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rental-demo-'));
  const dbPath = join(dir, 'demo.sqlite');
  try {
    runSeed(dbPath);
    const clients = readCollection(dbPath, 'clients');
    writeCollection(dbPath, 'clients', [
      ...clients,
      { id: 'smoke-client', company: 'Demo Smoke Client', creditLimit: 1 },
    ]);

    runSeed(dbPath);
    const resetClients = readCollection(dbPath, 'clients');
    assert.equal(resetClients.some(client => client.id === 'smoke-client'), false);
    assert.equal(resetClients.some(client => client.id === 'demo-client-alpha'), true);
    assert.equal(resetClients.length, clients.length);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demo seed does not contain bad placeholder values in user-visible data', () => {
  const { buildDemoData } = require('../server/scripts/seed-demo-data.js');
  const data = buildDemoData();
  const visibleData = {
    clients: data.clients,
    equipment: data.equipment,
    rentals: data.rentals,
    gantt_rentals: data.gantt_rentals,
    documents: data.documents,
    payments: data.payments,
    service: data.service,
    deliveries: data.deliveries,
    debt_collection_plans: data.debt_collection_plans,
  };
  assert.doesNotMatch(JSON.stringify(visibleData), /NaN|undefined|null|\[object Object\]|не число/);
});

test('seed script refuses production DB path', () => {
  const dir = mkdtempSync(join(tmpdir(), 'rental-prod-'));
  const dbPath = join(dir, 'app.sqlite');
  try {
    assert.throws(
      () => runSeed(dbPath),
      /clearly named demo database/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('demo public flag and frontend indicator are wired without exposing secrets', () => {
  assert.deepEqual(
    getDemoPublicInfo({ DEMO_MODE: 'true', NODE_ENV: 'test' }),
    {
      enabled: true,
      resetAllowed: true,
      label: 'Демо-режим',
      message: 'Данные ненастоящие и могут быть сброшены.',
    },
  );

  const appSource = readFileSync(new URL('../src/app/App.tsx', import.meta.url), 'utf8');
  const badgeSource = readFileSync(new URL('../src/app/components/ui/DemoModeBadge.tsx', import.meta.url), 'utf8');
  const routesSource = readFileSync(new URL('../server/routes/system.js', import.meta.url), 'utf8');

  assert.match(appSource, /<DemoModeBadge \/>/);
  assert.match(badgeSource, /VITE_DEMO_MODE/);
  assert.match(badgeSource, /DEMO MODE/);
  assert.match(badgeSource, /Демо-режим · данные будут сброшены/);
  assert.match(routesSource, /\/api\/demo\/reset/);
  assert.doesNotMatch(badgeSource, /password|token|secret/i);
});
