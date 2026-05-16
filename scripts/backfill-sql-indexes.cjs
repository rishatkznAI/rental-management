#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const rootDir = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(rootDir, 'server', 'package.json'));
const Database = serverRequire('better-sqlite3');
const { backfillSqlShadowIndexes } = require('../server/lib/sql-shadow-indexes.js');

function parseArgs(argv) {
  const args = { db: process.env.DB_PATH || 'server/data/app.sqlite', json: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') args.db = argv[++index] || args.db;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/backfill-sql-indexes.cjs --db server/data/app.sqlite',
    '',
    'Idempotently backfills SQL shadow tables for documents and gantt_rentals.',
    'Source of truth remains app_data. app_data is not deleted or rewritten.',
  ].join('\n');
}

function printHuman(result, dbPath) {
  console.log('SQL shadow index backfill');
  console.log(`DB: ${dbPath}`);
  console.log('Mode: non-destructive, app_data remains source of truth');
  console.log('');
  for (const name of ['documents', 'gantt_rentals']) {
    const stats = result[name];
    console.log(`${name}: source=${stats.source}, inserted=${stats.inserted}, updated=${stats.updated}, skipped=${stats.skipped}, errors=${stats.errors.length}`);
  }
  if (result.sourceErrors.length > 0) {
    console.log('');
    console.log('Source errors:');
    result.sourceErrors.forEach(item => console.log(`  ${item.collection}: ${item.error}`));
  }
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
    const result = backfillSqlShadowIndexes(db, { logger: console });
    const payload = { dbPath, generatedAt: new Date().toISOString(), ...result };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else printHuman(payload, dbPath);
    process.exitCode = result.sourceErrors.length > 0 ? 1 : 0;
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
