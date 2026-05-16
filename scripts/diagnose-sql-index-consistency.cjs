#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const rootDir = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(rootDir, 'server', 'package.json'));
const Database = serverRequire('better-sqlite3');
const { diagnoseSqlShadowConsistency } = require('../server/lib/sql-shadow-indexes.js');

function parseArgs(argv) {
  const args = { db: process.env.DB_PATH || 'server/data/app.sqlite', json: false, strict: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') args.db = argv[++index] || args.db;
    else if (arg === '--json') args.json = true;
    else if (arg === '--strict') args.strict = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/diagnose-sql-index-consistency.cjs --db server/data/app.sqlite',
    '',
    'Read-only consistency diagnostics for SQL shadow tables.',
    'By default exits non-zero only for critical source/index mismatches.',
    'Use --json for machine-readable output.',
  ].join('\n');
}

function preview(list, limit = 10) {
  if (!Array.isArray(list) || list.length === 0) return '-';
  return list.slice(0, limit).map(item => typeof item === 'string' ? item : JSON.stringify(item)).join(', ');
}

function printHuman(report, dbPath) {
  console.log('SQL shadow index consistency diagnostics');
  console.log(`DB: ${dbPath}`);
  console.log('Mode: read-only diagnostics, app_data remains source of truth');
  console.log('');
  for (const name of ['documents', 'gantt_rentals']) {
    const item = report[name];
    console.log(`${name}: app_data=${item.appDataCount}, sql=${item.sqlCount}`);
    console.log(`  missingInSql: ${item.missingInSql.length} ${preview(item.missingInSql)}`);
    console.log(`  extraInSql: ${item.extraInSql.length} ${preview(item.extraInSql)}`);
    console.log(`  duplicateIds: ${item.duplicateIds.length} ${preview(item.duplicateIds)}`);
    console.log(`  invalidDates: ${item.invalidDates.length} ${preview(item.invalidDates)}`);
  }
  console.log('');
  console.log(`documents invalid chains: ${report.documents.invalidDocumentChains.length} ${preview(report.documents.invalidDocumentChains)}`);
  console.log(`documents mismatched updatedAt: ${report.documents.mismatchedUpdatedAt.length} ${preview(report.documents.mismatchedUpdatedAt)}`);
  console.log(`gantt invalid rental links: ${report.gantt_rentals.invalidRentalLinks.length} ${preview(report.gantt_rentals.invalidRentalLinks)}`);
  console.log(`gantt invalid equipment links: ${report.gantt_rentals.invalidEquipmentLinks.length} ${preview(report.gantt_rentals.invalidEquipmentLinks)}`);
  console.log('');
  console.log(`Critical mismatch: ${report.criticalMismatch ? 'yes' : 'no'}`);
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}

const dbPath = path.resolve(rootDir, args.db);
try {
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    const report = diagnoseSqlShadowConsistency(db);
    const payload = { dbPath, generatedAt: new Date().toISOString(), ...report };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else printHuman(payload, dbPath);
    process.exitCode = report.criticalMismatch ? 1 : 0;
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
