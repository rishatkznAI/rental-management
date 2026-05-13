import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  buildAdminGanttRentalRepairDiagnostics,
  buildBrokenGanttRentalsRepairPlan,
  buildDryRunOperations,
  applyRepairPlan,
} = require('../server/lib/gantt-rental-repair-diagnostics.js');

function baseEquipment() {
  return [
    { id: 'EQ-1', inventoryNumber: 'INV-1', serialNumber: 'SN-1', model: 'Genie S-65' },
    { id: 'EQ-2', inventoryNumber: 'INV-2', serialNumber: 'SN-2', model: 'JLG 450AJ' },
  ];
}

function rental(overrides = {}) {
  return {
    id: 'R-1',
    clientId: 'C-1',
    client: 'ООО Клиент',
    equipmentId: 'EQ-1',
    inventoryNumber: 'INV-1',
    startDate: '2026-05-01',
    endDate: '2026-05-10',
    status: 'active',
    ...overrides,
  };
}

function gantt(overrides = {}) {
  return {
    id: 'GR-1',
    rentalId: '',
    sourceRentalId: '',
    originalRentalId: '',
    clientId: 'C-1',
    client: 'ООО Клиент',
    equipmentId: 'EQ-1',
    inventoryNumber: 'INV-1',
    startDate: '2026-05-01',
    endDate: '2026-05-10',
    status: 'active',
    ...overrides,
  };
}

function plan(collections) {
  return buildBrokenGanttRentalsRepairPlan({
    equipment: baseEquipment(),
    rentals: [],
    gantt_rentals: [],
    documents: [],
    payments: [],
    deliveries: [],
    service: [],
    ...collections,
  });
}

test('stale gantt row without candidates or related records goes to group A', () => {
  const result = plan({
    rentals: [],
    gantt_rentals: [gantt({ id: 'GR-stale', equipmentId: 'EQ-2', inventoryNumber: 'INV-2' })],
  });

  assert.equal(result.summary.brokenRows, 1);
  assert.equal(result.groups.A.length, 1);
  assert.equal(result.groups.A[0].ganttId, 'GR-stale');
  assert.equal(result.groups.A[0].recommendation, 'delete_or_archive_after_backup');
});

test('gantt row with one exact rental candidate goes to group B', () => {
  const result = plan({
    rentals: [rental({ id: 'R-exact' })],
    gantt_rentals: [gantt({ id: 'GR-exact' })],
  });

  assert.equal(result.groups.B.length, 1);
  assert.equal(result.groups.B[0].ganttId, 'GR-exact');
  assert.equal(result.groups.B[0].targetRentalId, 'R-exact');
});

test('gantt row with multiple candidates goes to group C', () => {
  const result = plan({
    rentals: [rental({ id: 'R-1' }), rental({ id: 'R-2' })],
    gantt_rentals: [gantt({ id: 'GR-many' })],
  });

  assert.equal(result.groups.C.length, 1);
  assert.equal(result.groups.C[0].reason, 'MULTIPLE_CANDIDATES');
});

test('gantt row with documents or payments is not auto-deleted', () => {
  const result = plan({
    rentals: [],
    gantt_rentals: [gantt({ id: 'GR-related', equipmentId: 'EQ-2', inventoryNumber: 'INV-2' })],
    documents: [{ id: 'D-1', rentalId: 'GR-related' }],
    payments: [{ id: 'P-1', rentalId: 'GR-related', amount: 1000 }],
  });

  assert.equal(result.groups.A.length, 0);
  assert.equal(result.groups.C.length, 1);
  assert.equal(result.groups.C[0].hasDocuments, true);
  assert.equal(result.groups.C[0].hasPayments, true);
});

test('service or downtime planner row is left untouched as group D', () => {
  const result = plan({
    rentals: [],
    gantt_rentals: [
      gantt({
        id: 'service:S-1__INV-1',
        rentalId: 'service:S-1',
        sourceType: 'service',
        operationType: 'service',
        client: 'SERVICE · ТО',
      }),
    ],
  });

  assert.equal(result.groups.D.length, 1);
  assert.equal(result.groups.D[0].recommendation, 'leave');
});

test('dry-run returns operations and does not mutate collections', () => {
  const collections = {
    equipment: baseEquipment(),
    rentals: [rental({ id: 'R-exact' })],
    gantt_rentals: [gantt({ id: 'GR-exact' })],
  };
  const before = JSON.stringify(collections);
  const result = plan(collections);
  const dryRun = buildDryRunOperations(result);
  const applyResult = applyRepairPlan(collections, result, { apply: false });

  assert.equal(dryRun.dryRun, true);
  assert.equal(dryRun.summary.linkCount, 1);
  assert.equal(JSON.stringify(collections), before);
  assert.equal(applyResult.applied, false);
  assert.equal(JSON.stringify(collections), before);
});

test('--apply requires verified backup and explicit confirmation', () => {
  const collections = {
    equipment: baseEquipment(),
    rentals: [rental({ id: 'R-exact' })],
    gantt_rentals: [gantt({ id: 'GR-exact' })],
  };
  const result = plan(collections);

  assert.throws(
    () => applyRepairPlan(collections, result, { apply: true }),
    /--apply requires --backup-verified/,
  );

  const applied = applyRepairPlan(collections, result, {
    apply: true,
    backupVerified: true,
    confirm: true,
  });
  assert.equal(applied.applied, true);
  assert.equal(applied.collections.gantt_rentals[0].rentalId, 'R-exact');
});

test('admin diagnostics report finds target gantt row and strips sensitive fields', () => {
  const result = buildAdminGanttRentalRepairDiagnostics({
    equipment: baseEquipment(),
    rentals: [],
    gantt_rentals: [
      gantt({
        id: 'GR-1776257615497',
        equipmentId: 'EQ-2',
        inventoryNumber: 'INV-2',
        amount: 50000,
        price: 1000,
        manager: 'Hidden Manager',
        phone: '+79990000000',
        passportNumber: '1234',
      }),
    ],
    documents: [{ id: 'D-1', rentalId: 'other', privateUrl: 'https://example.test/private.pdf' }],
    payments: [{ id: 'P-1', rentalId: 'other', amount: 1000 }],
    deliveries: [],
    service: [],
  });

  assert.equal(result.ok, true);
  assert.equal(result.productionDataChanged, false);
  assert.equal(result.counts.rentals, 0);
  assert.equal(result.counts.ganttRentals, 1);
  assert.equal(result.counts.brokenRows, 1);
  assert.equal(result.target.found, true);
  assert.equal(result.target.broken, true);
  assert.equal(result.target.row.reason, 'NO_LINKED_RENTAL');
  assert.equal(result.target.row.candidatesCount, 0);
  assert.deepEqual(result.target.row.candidateIds, []);
  assert.equal(result.groups.A[0].ganttId, 'GR-1776257615497');

  const serialized = JSON.stringify(result);
  assert.doesNotMatch(serialized, /50000|1000|Hidden Manager|\+7999|passport|private\.pdf|amount|price|manager|phone/i);
});

test('CLI dry-run works and apply stays blocked without backup confirmation', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gantt-repair-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const reportPath = path.join(dir, 'report.json');
  const db = new Database(dbPath);
  try {
    db.prepare('CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL)').run();
    const insert = db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)');
    const collections = {
      equipment: baseEquipment(),
      rentals: [],
      gantt_rentals: [gantt({ id: 'GR-cli', equipmentId: 'EQ-2', inventoryNumber: 'INV-2' })],
      documents: [],
      payments: [],
      deliveries: [],
      service: [],
    };
    for (const [name, value] of Object.entries(collections)) {
      insert.run(name, JSON.stringify(value));
    }
  } finally {
    db.close();
  }

  const output = execFileSync(process.execPath, [
    'scripts/diagnostics/repair-gantt-rentals-dry-run.mjs',
    '--db',
    dbPath,
    '--report',
    reportPath,
    '--json',
  ], { cwd: path.resolve(new URL('..', import.meta.url).pathname), encoding: 'utf8' });
  const payload = JSON.parse(output);
  assert.equal(payload.dryRun, true);
  assert.equal(payload.productionDataChanged, false);
  assert.equal(payload.plan.summary.brokenRows, 1);
  assert.equal(fs.existsSync(reportPath), true);

  assert.throws(
    () => execFileSync(process.execPath, [
      'scripts/diagnostics/repair-gantt-rentals-dry-run.mjs',
      '--db',
      dbPath,
      '--apply',
      '--json',
    ], { cwd: path.resolve(new URL('..', import.meta.url).pathname), encoding: 'utf8', stdio: 'pipe' }),
    /--apply requires --backup-verified/,
  );
});
