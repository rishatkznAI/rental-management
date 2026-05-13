#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');

const {
  buildBrokenGanttRentalsRepairPlan,
  buildDryRunOperations,
  applyRepairPlan,
} = require('../../server/lib/gantt-rental-repair-diagnostics.js');

const COLLECTIONS = [
  'equipment',
  'rentals',
  'gantt_rentals',
  'documents',
  'payments',
  'deliveries',
  'service',
];

function parseArgs(argv) {
  const args = {
    db: '',
    report: path.resolve(process.cwd(), 'diagnostics/broken-gantt-rentals-report.json'),
    apply: false,
    backupVerified: false,
    confirm: '',
    json: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') args.db = argv[++index] || '';
    else if (arg === '--report') args.report = argv[++index] || '';
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--backup-verified') args.backupVerified = true;
    else if (arg === '--confirm') args.confirm = argv[++index] || '';
    else if (arg.startsWith('--confirm=')) args.confirm = arg.slice('--confirm='.length);
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }

  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/diagnostics/repair-gantt-rentals-dry-run.mjs --db /path/to/app.sqlite',
    '',
    'Dry-run is the default and does not modify data.',
    'Apply is blocked unless all safety flags are present:',
    '  --apply --backup-verified --confirm=APPLY_GANTT_REPAIR',
    '',
    'Backup checklist before any future apply:',
    '  1. Copy the production SQLite/Railway volume.',
    '  2. Export rentals, gantt_rentals, documents, payments, deliveries, service.',
    '  3. Store a timestamp with the backup.',
    '  4. Verify the backup can be opened and queried.',
    '  5. Only then run apply with the explicit confirmation flags.',
  ].join('\n');
}

function readCollections(dbPath) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const placeholders = COLLECTIONS.map(() => '?').join(',');
    const rows = db
      .prepare(`SELECT name, json FROM app_data WHERE name IN (${placeholders})`)
      .all(...COLLECTIONS);
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

function writeGanttRentals(dbPath, ganttRentals) {
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    const tx = db.transaction(() => {
      db.prepare(`
        UPDATE app_data
        SET json = ?, updated_at = CURRENT_TIMESTAMP
        WHERE name = 'gantt_rentals'
      `).run(JSON.stringify(ganttRentals));
    });
    tx();
  } finally {
    db.close();
  }
}

function ensureReportDirectory(reportPath) {
  if (!reportPath) return;
  fs.mkdirSync(path.dirname(path.resolve(reportPath)), { recursive: true });
}

function formatGroup(name, rows) {
  return `${name}: ${rows.length}${rows.length ? ` (${rows.map(row => row.ganttId).join(', ')})` : ''}`;
}

function printHumanReport(payload) {
  const { plan, dryRun } = payload;
  console.log(`DB: ${payload.db}`);
  console.log(`Report: ${payload.report}`);
  console.log(`Production data changed: ${payload.productionDataChanged ? 'yes' : 'no'}`);
  console.log('');
  console.log('Summary:');
  console.log(`  rentals: ${plan.summary.rentalsTotal}`);
  console.log(`  gantt_rentals: ${plan.summary.ganttRentalsTotal}`);
  console.log(`  broken/stale rows: ${plan.summary.brokenRows}`);
  console.log(`  ${formatGroup('Group A delete/archive', plan.groups.A)}`);
  console.log(`  ${formatGroup('Group B relink', plan.groups.B)}`);
  console.log(`  ${formatGroup('Group C manual review', plan.groups.C)}`);
  console.log(`  ${formatGroup('Group D leave untouched', plan.groups.D)}`);
  console.log('');
  console.log('Dry-run operations:');
  console.log(`  delete/archive: ${dryRun.summary.deleteCount}`);
  console.log(`  relink: ${dryRun.summary.linkCount}`);
  console.log(`  manual review: ${dryRun.summary.manualReviewCount}`);
  console.log(`  leave untouched: ${dryRun.summary.leaveUntouchedCount}`);
  for (const operation of dryRun.operations) {
    console.log(`  - ${operation.type}: ${operation.id} (${operation.reason})`);
    console.log(`    before: ${JSON.stringify(operation.before)}`);
    console.log(`    after: ${JSON.stringify(operation.after)}`);
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log(usage());
    return;
  }
  if (!args.db) {
    console.error('Refusing to read a database without an explicit --db path.');
    console.error(usage());
    process.exit(2);
  }

  const dbPath = path.resolve(args.db);
  if (!fs.existsSync(dbPath)) {
    console.error(`DB not found: ${dbPath}`);
    process.exit(2);
  }

  const collections = readCollections(dbPath);
  const plan = buildBrokenGanttRentalsRepairPlan(collections);
  const dryRun = buildDryRunOperations(plan);
  const payload = {
    generatedAt: new Date().toISOString(),
    db: dbPath,
    report: args.report ? path.resolve(args.report) : '',
    dryRun: !args.apply,
    productionDataChanged: false,
    plan,
    dryRunOperations: dryRun,
    backupInstructions: [
      'Copy production SQLite/Railway volume before apply.',
      'Export rentals, gantt_rentals, documents, payments, deliveries, service.',
      'Store a timestamp with the backup.',
      'Verify the backup can be opened and queried.',
      'Run --apply only with --backup-verified --confirm=APPLY_GANTT_REPAIR.',
    ],
  };

  if (args.apply) {
    const result = applyRepairPlan(collections, plan, {
      apply: true,
      backupVerified: args.backupVerified,
      confirm: args.confirm === 'APPLY_GANTT_REPAIR',
    });
    writeGanttRentals(dbPath, result.collections.gantt_rentals);
    payload.productionDataChanged = true;
    payload.applyResult = { applied: true, operations: result.operations };
  }

  if (args.report) {
    ensureReportDirectory(args.report);
    fs.writeFileSync(args.report, `${JSON.stringify(payload, null, 2)}\n`);
  }

  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
  } else {
    printHumanReport({ ...payload, dryRun });
  }
}

main();
