const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { getData, setData, DB_PATH } = require('../server/db');

const IMPORT_FILE = path.resolve(__dirname, '../imports/spare_parts_lifts_catalog.json');

function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix = 'PT') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function normalizePart(record) {
  const timestamp = nowIso();
  const article = record.article ?? record.sku;
  return {
    id: record.id || generateId('PT'),
    name: String(record.name || '').trim(),
    article: article ? String(article).trim() : undefined,
    sku: article ? String(article).trim() : undefined,
    unit: String(record.unit || 'шт').trim() || 'шт',
    defaultPrice: Math.max(0, Number(record.defaultPrice) || 0),
    category: record.category ? String(record.category).trim() : undefined,
    manufacturer: record.manufacturer ? String(record.manufacturer).trim() : undefined,
    isActive: record.isActive !== false,
    createdAt: record.createdAt || timestamp,
    updatedAt: record.updatedAt || timestamp,
  };
}

function partKey(record) {
  return [
    String(record.name || '').trim().toLowerCase(),
    String(record.article || record.sku || '').trim().toLowerCase(),
  ].join('::');
}

function mergeUnique(existing, incoming) {
  const normalizedExisting = existing.map(normalizePart);
  const usedKeys = new Set(normalizedExisting.map(partKey));
  const additions = [];

  for (const item of incoming) {
    const normalized = normalizePart(item);
    const key = partKey(normalized);
    if (!normalized.name || usedKeys.has(key)) continue;
    usedKeys.add(key);
    additions.push(normalized);
  }

  return {
    merged: [...normalizedExisting, ...additions],
    added: additions.length,
  };
}

function main() {
  if (!fs.existsSync(IMPORT_FILE)) {
    throw new Error(`Файл импорта не найден: ${IMPORT_FILE}`);
  }

  const raw = fs.readFileSync(IMPORT_FILE, 'utf8');
  const incoming = JSON.parse(raw);
  if (!Array.isArray(incoming)) {
    throw new Error('Файл импорта должен содержать массив объектов.');
  }

  const existingSpareParts = Array.isArray(getData('spare_parts')) ? getData('spare_parts') : [];
  const existingCatalog = Array.isArray(getData('spare_parts_catalog')) ? getData('spare_parts_catalog') : [];

  const sparePartsResult = mergeUnique(existingSpareParts, incoming);
  const catalogResult = mergeUnique(existingCatalog, incoming);

  setData('spare_parts', sparePartsResult.merged);
  setData('spare_parts_catalog', catalogResult.merged);

  const categories = [...new Set(sparePartsResult.merged.map(item => item.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );

  console.log(JSON.stringify({
    ok: true,
    dbPath: DB_PATH,
    importFile: IMPORT_FILE,
    importedFromFile: incoming.length,
    spareParts: {
      before: existingSpareParts.length,
      added: sparePartsResult.added,
      after: sparePartsResult.merged.length,
    },
    sparePartsCatalog: {
      before: existingCatalog.length,
      added: catalogResult.added,
      after: catalogResult.merged.length,
    },
    categories,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error.message || error);
  process.exit(1);
}
