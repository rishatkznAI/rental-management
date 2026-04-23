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

function replaceUnique(incoming) {
  const usedKeys = new Set();
  const normalizedList = [];

  for (const item of incoming) {
    const normalized = normalizePart(item);
    const key = partKey(normalized);
    if (!normalized.name || usedKeys.has(key)) continue;
    usedKeys.add(key);
    normalizedList.push(normalized);
  }

  return normalizedList;
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

  const spareParts = replaceUnique(incoming);
  const catalog = replaceUnique(incoming);

  setData('spare_parts', spareParts);
  setData('spare_parts_catalog', catalog);

  const categories = [...new Set(spareParts.map(item => item.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );

  console.log(JSON.stringify({
    ok: true,
    dbPath: DB_PATH,
    importFile: IMPORT_FILE,
    importedFromFile: incoming.length,
    spareParts: {
      before: existingSpareParts.length,
      replaced: spareParts.length,
      after: spareParts.length,
    },
    sparePartsCatalog: {
      before: existingCatalog.length,
      replaced: catalog.length,
      after: catalog.length,
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
