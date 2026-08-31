#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { createRequire } = require('module');

const rootDir = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(rootDir, 'server', 'package.json'));
const Database = serverRequire('better-sqlite3');
const {
  assertAuditedMaintenanceApplyUnavailable,
  createStrictReadOnlyStorage,
  resolveExplicitDatabasePath,
} = require('../server/lib/maintenance-script-safety.js');

const DEFAULT_IMPORT_FILE = path.resolve(rootDir, 'imports/service_works_lifts_catalog.json');

function parseArgs(argv) {
  const result = { db: '', input: DEFAULT_IMPORT_FILE, replace: false, apply: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--db') result.db = argv[++index] || '';
    else if (argument === '--input') result.input = argv[++index] || '';
    else if (argument === '--replace') result.replace = true;
    else if (argument === '--apply') result.apply = true;
    else if (argument === '--dry-run') result.apply = false;
    else if (argument === '--help' || argument === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function stableImportId(key) {
  return `SW-IMPORT-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}

function workKey(record) {
  return `${String(record?.name || '').trim().toLowerCase()}::${String(record?.category || '').trim().toLowerCase()}`;
}

function normalizeWork(record, sortOrder = 0) {
  const name = String(record?.name || '').trim();
  const category = String(record?.category || '').trim();
  const key = `${name.toLowerCase()}::${category.toLowerCase()}`;
  return {
    id: String(record?.id || '').trim() || stableImportId(key),
    name,
    ...(category ? { category } : {}),
    ...(record?.description ? { description: String(record.description).trim() } : {}),
    normHours: Math.max(0, Number(record?.normHours) || 0),
    ratePerHour: Math.max(0, Number(record?.ratePerHour) || 0),
    isActive: record?.isActive !== false,
    sortOrder: Number.isFinite(Number(record?.sortOrder)) ? Number(record.sortOrder) : sortOrder,
  };
}

function mergeUnique(existing, incoming) {
  const normalizedExisting = existing.map((item, index) => normalizeWork(item, index));
  const usedKeys = new Set(normalizedExisting.map(workKey));
  const usedIds = new Set(normalizedExisting.map(item => item.id));
  let nextSortOrder = normalizedExisting.reduce((max, item) => Math.max(max, Number(item.sortOrder) || 0), -1) + 1;
  const additions = [];
  for (const item of incoming) {
    const normalized = normalizeWork(item, nextSortOrder);
    const key = workKey(normalized);
    if (!normalized.name || usedKeys.has(key)) continue;
    if (usedIds.has(normalized.id)) throw new Error(`Duplicate service-work id across existing/import data: ${normalized.id}`);
    usedKeys.add(key);
    usedIds.add(normalized.id);
    nextSortOrder += 1;
    additions.push(normalized);
  }
  return {
    merged: [...normalizedExisting, ...additions].sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru')),
    added: additions.length,
  };
}

function replacement(incoming) {
  const seenKeys = new Set();
  const seenIds = new Set();
  return incoming.flatMap((item, index) => {
    const normalized = normalizeWork(item, index);
    const key = workKey(normalized);
    if (!normalized.name || seenKeys.has(key)) return [];
    if (seenIds.has(normalized.id)) throw new Error(`Duplicate imported service-work id: ${normalized.id}`);
    seenKeys.add(key);
    seenIds.add(normalized.id);
    return [normalized];
  });
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node scripts/import-service-works-catalog.cjs --dry-run --db /explicit/path/app.sqlite [--input file.json] [--replace]');
    return null;
  }
  const dbPath = resolveExplicitDatabasePath(args.db, { cwd: rootDir });
  assertAuditedMaintenanceApplyUnavailable(args.apply, 'service-works catalogue import');
  const inputPath = path.resolve(rootDir, args.input);
  if (!fs.existsSync(inputPath)) throw new Error(`Import file not found: ${inputPath}`);
  const incoming = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(incoming)) throw new Error('Import file must contain an array.');

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const storage = createStrictReadOnlyStorage(db, { allowCollections: ['service_works', 'service_work_catalog'] });
    const existingWorks = storage.readData('service_works');
    const existingCatalog = storage.readData('service_work_catalog');
    const works = args.replace ? { merged: replacement(incoming), added: incoming.length } : mergeUnique(existingWorks, incoming);
    const catalog = args.replace ? { merged: replacement(incoming), added: incoming.length } : mergeUnique(existingCatalog, incoming);
    const result = {
      ok: true,
      mode: 'dry-run',
      productionDataChanged: false,
      dbPath,
      importFile: inputPath,
      replaceMode: args.replace,
      importedFromFile: incoming.length,
      serviceWorks: { before: existingWorks.length, wouldAdd: works.added, after: works.merged.length },
      serviceWorkCatalog: { before: existingCatalog.length, wouldAdd: catalog.added, after: catalog.merged.length },
      categories: [...new Set(works.merged.map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
    };
    console.log(JSON.stringify(result, null, 2));
    return result;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`${error.code || 'SERVICE_WORKS_IMPORT_FAILED'}: ${error.message || error}`);
    process.exitCode = 2;
  }
}

module.exports = { main, mergeUnique, normalizeWork, parseArgs, replacement, stableImportId };
