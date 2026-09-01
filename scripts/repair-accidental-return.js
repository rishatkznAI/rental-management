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
  buildAccidentalReturnRepairPlan,
} = require('../server/lib/accidental-return-repair.js');
const {
  assertAuditedMaintenanceApplyUnavailable,
  parseAppDataValue,
  resolveExplicitDatabasePath,
} = require('../server/lib/maintenance-script-safety.js');

const COLLECTIONS = [
  'rentals',
  'gantt_rentals',
  'service',
  'payments',
  'documents',
  'deliveries',
  'bot_notifications',
  'audit_logs',
  'audit_log',
  'equipment',
  'repair_work_items',
  'repair_part_items',
  'service_field_trips',
  'service_audit_log',
];

function parseArgs(argv) {
  const args = {
    db: '',
    rentalId: '',
    serviceId: '',
    dryRun: false,
    apply: false,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--json') args.json = true;
    else if (arg === '--rental-id') args.rentalId = argv[++index] || '';
    else if (arg.startsWith('--rental-id=')) args.rentalId = arg.slice('--rental-id='.length);
    else if (arg === '--service-id') args.serviceId = argv[++index] || '';
    else if (arg.startsWith('--service-id=')) args.serviceId = arg.slice('--service-id='.length);
    else if (arg === '--db') args.db = path.resolve(argv[++index] || '');
    else if (arg.startsWith('--db=')) args.db = path.resolve(arg.slice('--db='.length));
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

function printJson(payload) {
  console.log(JSON.stringify(payload, null, 2));
}

function ids(list) {
  return (list || []).map(item => item?.id || item?.entityId || item?.serviceId).filter(Boolean).join(', ') || 'нет';
}

function printPlan(plan, payload) {
  console.log(`Rental: ${plan.rentalId}`);
  console.log(`Mode: ${payload.dryRun ? 'dry-run' : 'apply'}`);
  if (payload.backupPath) console.log(`Backup: ${payload.backupPath}`);
  console.log('');

  console.log('Текущее состояние:');
  console.log(JSON.stringify(plan.current, null, 2));
  console.log('');

  console.log('Предполагаемое состояние после восстановления:');
  console.log(JSON.stringify(plan.proposed, null, 2));
  console.log('');

  console.log('Evidence:');
  console.log(JSON.stringify(plan.evidence, null, 2));
  console.log('');

  console.log('Будут изменены:');
  for (const change of plan.changes) {
    console.log(`- ${change.collection}: ${change.id || change.action}`);
  }
  console.log('');

  console.log('Не будут изменены:');
  for (const item of plan.unchanged) {
    console.log(`- ${item.collection}: ${item.count ?? item.reason ?? ''}`);
  }
  console.log(`- payments: ${ids(plan.related.payments)}`);
  console.log(`- documents: ${ids(plan.related.documents)}`);
  console.log(`- deliveries: ${ids(plan.related.deliveries)}`);
  console.log(`- notifications: ${ids(plan.related.notifications)}`);
  console.log('');

  console.log('Риски:');
  const risks = [...(plan.risks || []), ...(plan.blockers || []).map(item => `BLOCKER: ${item}`)];
  if (risks.length === 0) console.log('- явных рисков не найдено');
  else risks.forEach(risk => console.log(`- ${risk}`));
  console.log('');

  console.log(payload.productionDataChanged ? 'APPLY COMPLETE — данные изменены.' : 'DRY RUN ONLY — данные не изменены.');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.rentalId) {
    console.error('Usage: node scripts/repair-accidental-return.js --rental-id <id> [--dry-run|--apply] [--db path]');
    process.exit(2);
  }
  const dbPath = resolveExplicitDatabasePath(args.db);
  assertAuditedMaintenanceApplyUnavailable(args.apply, 'accidental-return repair');

  const collections = readCollections(dbPath);
  const plan = buildAccidentalReturnRepairPlan(collections, {
    rentalId: args.rentalId,
    serviceId: args.serviceId,
  });
  const payload = {
    dryRun: !args.apply,
    productionDataChanged: false,
    ok: plan.ok,
    blockers: plan.blockers,
    risks: plan.risks,
    backupPath: null,
    plan,
  };

  if (args.json) printJson(payload);
  else printPlan(plan, payload);
}

main();
