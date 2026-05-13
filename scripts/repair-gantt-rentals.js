#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  buildBrokenGanttRentalsRepairPlan,
  buildDryRunOperations,
  applyRepairPlan,
} = require('../server/lib/gantt-rental-repair-diagnostics.js');

const COLLECTIONS = ['equipment', 'rentals', 'gantt_rentals', 'documents', 'payments', 'deliveries', 'service', 'audit_logs'];

function parseArgs(argv) {
  const args = {
    db: path.resolve(process.cwd(), 'server/data/app.sqlite'),
    dryRun: false,
    apply: false,
    json: false,
  };
  for (const arg of argv) {
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--json') args.json = true;
    else if (arg.startsWith('--db=')) args.db = path.resolve(arg.slice('--db='.length));
  }
  if (!args.apply) args.dryRun = true;
  return args;
}

function readCollections(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare(`SELECT name, json FROM app_data WHERE name IN (${COLLECTIONS.map(() => '?').join(',')})`).all(...COLLECTIONS);
    const collections = Object.fromEntries(COLLECTIONS.map(name => [name, []]));
    for (const row of rows) {
      try {
        collections[row.name] = row.json ? JSON.parse(row.json) : [];
      } catch {
        collections[row.name] = [];
      }
    }
    return collections;
  } finally {
    db.close();
  }
}

function writeCollection(db, name, value) {
  db.prepare(`
    INSERT INTO app_data (name, json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET json = excluded.json, updated_at = CURRENT_TIMESTAMP
  `).run(name, JSON.stringify(value));
}

function createBackup(dbPath) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backupPath = `${dbPath}.backup-${stamp}`;
  fs.copyFileSync(dbPath, backupPath);
  return backupPath;
}

function softArchiveCandidates(ganttRentals, plan, auditLogs) {
  const archiveIds = new Set(plan.groups.A.map(row => row.ganttId));
  const archivedAt = new Date().toISOString();
  const next = ganttRentals.map(row => {
    if (!archiveIds.has(String(row?.id || ''))) return row;
    auditLogs.push({
      id: `AUDIT-GANTT-ARCHIVE-${row.id}-${Date.now()}`,
      date: archivedAt,
      action: 'gantt_rentals.soft_archive_orphan',
      entityType: 'gantt_rentals',
      entityId: row.id,
      description: 'Soft archived orphan planner row after backup; no rental, payment, document, delivery or service records changed.',
    });
    return {
      ...row,
      archived: true,
      archivedAt,
      archiveReason: 'orphan_gantt_without_rental',
    };
  });
  return next;
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
  if (!fs.existsSync(args.db)) {
    console.error(`DB not found: ${args.db}`);
    process.exit(2);
  }
  if (args.apply && args.dryRun) {
    console.error('Choose either --dry-run or --apply.');
    process.exit(2);
  }

  const collections = readCollections(args.db);
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

  if (args.apply) {
    const backupPath = createBackup(args.db);
    const result = applyRepairPlan(collections, plan, {
      apply: true,
      backupVerified: true,
      confirm: true,
    });
    const auditLogs = Array.isArray(collections.audit_logs) ? [...collections.audit_logs] : [];
    const nextGanttRentals = softArchiveCandidates(result.collections.gantt_rentals, plan, auditLogs);
    const db = new Database(args.db, { fileMustExist: true });
    try {
      db.transaction(() => {
        writeCollection(db, 'gantt_rentals', nextGanttRentals);
        writeCollection(db, 'audit_logs', auditLogs);
      })();
    } finally {
      db.close();
    }
    payload.productionDataChanged = true;
    payload.backupPath = backupPath;
  }

  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else printSummary(payload);
}

main();
