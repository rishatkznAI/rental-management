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

const DEFAULT_IMPORT_FILE = path.resolve(rootDir, 'imports/spare_parts_lifts_catalog.json');

function parseArgs(argv) {
  const result = { db: '', input: DEFAULT_IMPORT_FILE, apply: false, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--db') result.db = argv[++index] || '';
    else if (argument === '--input') result.input = argv[++index] || '';
    else if (argument === '--apply') result.apply = true;
    else if (argument === '--dry-run') result.apply = false;
    else if (argument === '--help' || argument === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function stableImportId(prefix, key) {
  return `${prefix}-IMPORT-${crypto.createHash('sha256').update(key).digest('hex').slice(0, 20)}`;
}

function normalizePart(record) {
  const article = String(record?.article ?? record?.sku ?? '').trim();
  const name = String(record?.name || '').trim();
  const key = `${name.toLowerCase()}::${article.toLowerCase()}`;
  return {
    id: String(record?.id || '').trim() || stableImportId('PT', key),
    name,
    ...(article ? { article, sku: article } : {}),
    unit: String(record?.unit || 'шт').trim() || 'шт',
    defaultPrice: Math.max(0, Number(record?.defaultPrice) || 0),
    ...(record?.category ? { category: String(record.category).trim() } : {}),
    ...(record?.manufacturer ? { manufacturer: String(record.manufacturer).trim() } : {}),
    isActive: record?.isActive !== false,
  };
}

function partKey(record) {
  return `${String(record?.name || '').trim().toLowerCase()}::${String(record?.article || record?.sku || '').trim().toLowerCase()}`;
}

function replaceUnique(incoming) {
  const usedKeys = new Set();
  const usedIds = new Set();
  const normalizedList = [];
  for (const item of incoming) {
    const normalized = normalizePart(item);
    const key = partKey(normalized);
    if (!normalized.name || usedKeys.has(key)) continue;
    if (usedIds.has(normalized.id)) throw new Error(`Duplicate imported spare-part id: ${normalized.id}`);
    usedKeys.add(key);
    usedIds.add(normalized.id);
    normalizedList.push(normalized);
  }
  return normalizedList;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/import-spare-parts-catalog.cjs --dry-run --db /explicit/path/app.sqlite [--input file.json]',
    '',
    'Dry-run is read-only. Raw --apply is disabled; use an audited tenant-scoped maintenance runner.',
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log(usage());
    return null;
  }
  const dbPath = resolveExplicitDatabasePath(args.db, { cwd: rootDir });
  assertAuditedMaintenanceApplyUnavailable(args.apply, 'spare-parts catalogue import');
  const inputPath = path.resolve(rootDir, args.input);
  if (!fs.existsSync(inputPath)) throw new Error(`Import file not found: ${inputPath}`);
  const incoming = JSON.parse(fs.readFileSync(inputPath, 'utf8'));
  if (!Array.isArray(incoming)) throw new Error('Import file must contain an array.');

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const storage = createStrictReadOnlyStorage(db, {
      allowCollections: ['spare_parts', 'spare_parts_catalog'],
    });
    const existingSpareParts = storage.readData('spare_parts');
    const existingCatalog = storage.readData('spare_parts_catalog');
    const preview = replaceUnique(incoming);
    const result = {
      ok: true,
      mode: 'dry-run',
      productionDataChanged: false,
      dbPath,
      importFile: inputPath,
      importedFromFile: incoming.length,
      spareParts: { before: existingSpareParts.length, wouldReplaceWith: preview.length },
      sparePartsCatalog: { before: existingCatalog.length, wouldReplaceWith: preview.length },
      categories: [...new Set(preview.map(item => item.category).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru')),
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
    console.error(`${error.code || 'SPARE_PARTS_IMPORT_FAILED'}: ${error.message || error}`);
    process.exitCode = 2;
  }
}

module.exports = { main, normalizePart, parseArgs, replaceUnique, stableImportId };
