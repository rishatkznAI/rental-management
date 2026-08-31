#!/usr/bin/env node

import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  prepareSqliteReadonlyStatement,
} = require('../server/lib/sqlite-readonly-statement.js');
const {
  buildBrokenGanttRentalsRepairPlan,
  buildDryRunOperations,
} = require('../server/lib/gantt-rental-repair-diagnostics.js');
const {
  assertAuditedMaintenanceApplyUnavailable,
  parseAppDataValue,
  resolveExplicitDatabasePath,
} = require('../server/lib/maintenance-script-safety.js');

const COLLECTIONS = ['equipment', 'rentals', 'gantt_rentals', 'documents', 'payments', 'deliveries', 'service', 'audit_logs'];

function parseArgs(argv) {
  const args = {
    db: '',
    dryRun: false,
    apply: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--db') args.db = argv[++index] || '';
    else if (arg.startsWith('--db=')) args.db = arg.slice('--db='.length);
    else throw new Error(`Unknown argument: ${arg}`);
  }
  if (!args.apply) args.dryRun = true;
  return args;
}

function readCollections(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = prepareSqliteReadonlyStatement(db, `SELECT name, json FROM app_data WHERE name IN (${COLLECTIONS.map(() => '?').join(',')})`).all(...COLLECTIONS);
    const collections = Object.fromEntries(COLLECTIONS.map(name => [name, []]));
    for (const row of rows) {
      collections[row.name] = parseAppDataValue(row, row.name, { expected: 'array', missing: [] });
    }
    return collections;
  } finally {
    db.close();
  }
}

function printSummary(payload) {
  console.log(`ok: ${payload.summary.ok}`);
  console.log(`orphan: ${payload.summary.orphan}`);
  console.log(`duplicate_review: ${payload.summary.duplicate_review}`);
  console.log(`archive_candidates: ${payload.summary.archive_candidates}`);
  console.log(`blocked: ${payload.summary.blocked}`);
  console.log(`data changed: ${payload.productionDataChanged ? 'yes' : 'no'}`);
  if (payload.backupPath) console.log(`backup: ${payload.backupPath}`);
  console.log(payload.productionDataChanged ? 'Apply completed without deleting data.' : 'Dry-run only: data not changed.');
  for (const action of payload.plannedActions) {
    console.log(`- ${action.type}: ${action.id}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const dbPath = resolveExplicitDatabasePath(args.db);
  assertAuditedMaintenanceApplyUnavailable(args.apply, 'gantt-rentals repair');

  const collections = readCollections(dbPath);
  const plan = buildBrokenGanttRentalsRepairPlan(collections);
  const dryRun = buildDryRunOperations(plan);
  const summary = {
    ok: (collections.gantt_rentals || []).length - plan.summary.brokenRows,
    orphan: plan.groups.C.length,
    duplicate_review: plan.groups.C.filter(row => row.reason === 'MULTIPLE_CANDIDATES').length,
    archive_candidates: plan.groups.A.length,
    blocked: plan.groups.C.filter(row => row.hasDocuments || row.hasPayments || row.hasDeliveries || row.hasServiceTickets).length,
  };
  const plannedActions = dryRun.operations.map(operation => ({ type: operation.type, id: operation.id, reason: operation.reason }));
  const payload = {
    dryRun: !args.apply,
    productionDataChanged: false,
    summary,
    plannedActions,
  };

  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else printSummary(payload);
}

main();
