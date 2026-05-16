#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const rootDir = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(rootDir, 'server', 'package.json'));
const Database = serverRequire('better-sqlite3');

const IMPORTANT_COLLECTIONS = new Set([
  'gantt_rentals',
  'documents',
  'rentals',
  'payments',
  'payment_allocations',
  'service',
  'repair_work_items',
  'repair_part_items',
  'gsm_packets',
]);

function parseArgs(argv) {
  const args = { db: process.env.DB_PATH || 'server/data/app.sqlite', json: false, top: 20 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') args.db = argv[++index] || args.db;
    else if (arg === '--json') args.json = true;
    else if (arg === '--top') args.top = Number(argv[++index]) || args.top;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/audit-app-data-collections.cjs --db server/data/app.sqlite',
    '',
    'Read-only audit of SQLite app_data collections. No data changes are made.',
  ].join('\n');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function duplicateIds(records) {
  const counts = new Map();
  for (const record of asArray(records)) {
    const id = text(record?.id);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id, count]) => ({ id, count }));
}

function fieldPresence(records, fields) {
  const total = asArray(records).length;
  return Object.fromEntries(fields.map(field => [
    field,
    {
      present: asArray(records).filter(record => text(record?.[field])).length,
      missing: total - asArray(records).filter(record => text(record?.[field])).length,
    },
  ]));
}

function topFields(records) {
  const counts = new Map();
  for (const record of asArray(records)) {
    if (!record || typeof record !== 'object' || Array.isArray(record)) continue;
    for (const key of Object.keys(record)) counts.set(key, (counts.get(key) || 0) + 1);
  }
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1])
    .slice(0, 24)
    .map(([field, count]) => ({ field, count }));
}

function indexCandidates(records) {
  const wanted = [
    'id',
    'clientId',
    'rentalId',
    'sourceRentalId',
    'originalRentalId',
    'equipmentId',
    'managerId',
    'ownerId',
    'objectId',
    'contractId',
    'type',
    'documentType',
    'status',
    'createdAt',
    'updatedAt',
    'startDate',
    'endDate',
    'plannedReturnDate',
    'date',
    'documentDate',
  ];
  const rows = asArray(records);
  return wanted
    .map(field => ({
      field,
      present: rows.filter(record => text(record?.[field])).length,
      distinct: new Set(rows.map(record => text(record?.[field])).filter(Boolean)).size,
    }))
    .filter(item => item.present > 0)
    .sort((left, right) => right.present - left.present);
}

function auditRow(row) {
  const sizeBytes = Buffer.byteLength(String(row.json || ''), 'utf8');
  try {
    const parsed = JSON.parse(row.json);
    const records = Array.isArray(parsed) ? parsed : [];
    const duplicates = duplicateIds(records);
    return {
      name: row.name,
      ok: true,
      type: Array.isArray(parsed) ? 'array' : (parsed && typeof parsed === 'object' ? 'object' : typeof parsed),
      count: Array.isArray(parsed) ? parsed.length : (parsed && typeof parsed === 'object' ? Object.keys(parsed).length : 0),
      sizeBytes,
      sizeKb: Math.round(sizeBytes / 102.4) / 10,
      important: IMPORTANT_COLLECTIONS.has(row.name),
      id: {
        present: records.filter(record => text(record?.id)).length,
        missing: records.filter(record => !text(record?.id)).length,
        duplicates,
      },
      timestamps: fieldPresence(records, ['createdAt', 'updatedAt']),
      indexCandidates: indexCandidates(records),
      topFields: topFields(records),
      recordsWithoutKeyFields: {
        clientId: records.filter(record => !text(record?.clientId)).length,
        rentalId: records.filter(record => !text(record?.rentalId) && !text(record?.sourceRentalId) && !text(record?.originalRentalId)).length,
        equipmentId: records.filter(record => !text(record?.equipmentId)).length,
      },
    };
  } catch (error) {
    return {
      name: row.name,
      ok: false,
      type: 'invalid-json',
      count: 0,
      sizeBytes,
      sizeKb: Math.round(sizeBytes / 102.4) / 10,
      important: IMPORTANT_COLLECTIONS.has(row.name),
      error: error.message,
    };
  }
}

function printHuman(report) {
  console.log('app_data collections audit');
  console.log(`DB: ${report.dbPath}`);
  console.log('Mode: read-only, no data changes');
  console.log('');
  console.log(`Collections: ${report.summary.collections}`);
  console.log(`Total JSON size: ${report.summary.totalSizeKb} KB`);
  console.log(`Broken JSON collections: ${report.summary.brokenJson}`);
  console.log('');
  console.log('Top heavy collections:');
  for (const item of report.topHeavyCollections) {
    console.log(`  ${item.name}: ${item.count} records, ${item.sizeKb} KB${item.ok ? '' : ' (BROKEN JSON)'}`);
  }
  console.log('');
  console.log('Important collections:');
  for (const item of report.collections.filter(row => row.important)) {
    const duplicates = item.id?.duplicates?.length || 0;
    console.log(`  ${item.name}: ok=${item.ok ? 'yes' : 'no'}, count=${item.count}, size=${item.sizeKb} KB, missingId=${item.id?.missing ?? '-'}, duplicateIds=${duplicates}`);
    if (!item.ok) console.log(`    error: ${item.error}`);
    const candidates = (item.indexCandidates || []).slice(0, 10).map(field => `${field.field}:${field.present}/${field.distinct}`).join(', ');
    if (candidates) console.log(`    index candidates: ${candidates}`);
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
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const rows = db.prepare('SELECT name, json, updated_at FROM app_data ORDER BY name').all();
    const collections = rows.map(auditRow);
    const totalSizeBytes = collections.reduce((sum, row) => sum + row.sizeBytes, 0);
    const report = {
      dbPath,
      generatedAt: new Date().toISOString(),
      summary: {
        collections: collections.length,
        totalSizeBytes,
        totalSizeKb: Math.round(totalSizeBytes / 102.4) / 10,
        brokenJson: collections.filter(row => !row.ok).length,
      },
      topHeavyCollections: [...collections].sort((left, right) => right.sizeBytes - left.sizeBytes).slice(0, args.top),
      collections,
    };
    if (args.json) console.log(JSON.stringify(report, null, 2));
    else printHuman(report);
    process.exitCode = report.summary.brokenJson > 0 ? 1 : 0;
  } finally {
    db.close();
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 2;
}
