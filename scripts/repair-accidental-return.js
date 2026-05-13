#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  buildAccidentalReturnRepairPlan,
  applyAccidentalReturnRepairPlan,
} = require('../server/lib/accidental-return-repair.js');

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
    db: path.resolve(process.cwd(), 'server/data/app.sqlite'),
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
  if (args.apply && args.dryRun) {
    console.error('Choose either --dry-run or --apply.');
    process.exit(2);
  }
  if (!fs.existsSync(args.db)) {
    console.error(`DB not found: ${args.db}`);
    process.exit(2);
  }

  const collections = readCollections(args.db);
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

  if (args.apply) {
    if (!plan.ok) {
      if (args.json) printJson(payload);
      else printPlan(plan, payload);
      process.exit(3);
    }
    const backupPath = createBackup(args.db);
    const result = applyAccidentalReturnRepairPlan(collections, plan, {
      backupVerified: fs.existsSync(backupPath),
    });
    const db = new Database(args.db, { fileMustExist: true });
    try {
      db.transaction(() => {
        writeCollection(db, 'rentals', result.collections.rentals);
        writeCollection(db, 'gantt_rentals', result.collections.gantt_rentals);
        writeCollection(db, 'service', result.collections.service);
        writeCollection(db, 'equipment', result.collections.equipment);
        writeCollection(db, 'audit_logs', result.collections.audit_logs);
      })();
    } finally {
      db.close();
    }
    payload.productionDataChanged = true;
    payload.backupPath = backupPath;
  }

  if (args.json) printJson(payload);
  else printPlan(plan, payload);
}

main();
