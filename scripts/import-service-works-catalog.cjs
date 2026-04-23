const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { getData, setData, DB_PATH } = require('../server/db');

const IMPORT_FILE = path.resolve(__dirname, '../imports/service_works_lifts_catalog.json');

function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix = 'SW') {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function normalizeWork(record) {
  const timestamp = nowIso();
  return {
    id: record.id || generateId('SW'),
    name: String(record.name || '').trim(),
    category: record.category ? String(record.category).trim() : undefined,
    description: record.description ? String(record.description).trim() : undefined,
    normHours: Math.max(0, Number(record.normHours) || 0),
    ratePerHour: Math.max(0, Number(record.ratePerHour) || 0),
    isActive: record.isActive !== false,
    sortOrder: Number.isFinite(Number(record.sortOrder)) ? Number(record.sortOrder) : 0,
    createdAt: record.createdAt || timestamp,
    updatedAt: record.updatedAt || timestamp,
  };
}

function workKey(record) {
  return [
    String(record.name || '').trim().toLowerCase(),
    String(record.category || '').trim().toLowerCase(),
  ].join('::');
}

function mergeUnique(existing, incoming) {
  const normalizedExisting = existing.map(normalizeWork);
  const usedKeys = new Set(normalizedExisting.map(workKey));
  let nextSortOrder = normalizedExisting.reduce((max, item) => Math.max(max, Number(item.sortOrder) || 0), -1) + 1;
  const additions = [];

  for (const item of incoming) {
    const normalized = normalizeWork(item);
    const key = workKey(normalized);
    if (!normalized.name || usedKeys.has(key)) continue;
    usedKeys.add(key);
    normalized.sortOrder = Number.isFinite(Number(item.sortOrder)) ? Number(item.sortOrder) : nextSortOrder++;
    additions.push(normalized);
  }

  const merged = [...normalizedExisting, ...additions].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'),
  );

  return {
    merged,
    added: additions.length,
  };
}

function main() {
  if (!fs.existsSync(IMPORT_FILE)) {
    throw new Error(`Файл импорта не найден: ${IMPORT_FILE}`);
  }

  const incoming = JSON.parse(fs.readFileSync(IMPORT_FILE, 'utf8'));
  if (!Array.isArray(incoming)) {
    throw new Error('Файл импорта должен содержать массив объектов.');
  }

  const existingWorks = Array.isArray(getData('service_works')) ? getData('service_works') : [];
  const existingCatalog = Array.isArray(getData('service_work_catalog')) ? getData('service_work_catalog') : [];
  const replaceMode = process.argv.includes('--replace');

  const worksResult = replaceMode
    ? {
        merged: incoming.map((item, index) => normalizeWork({ ...item, sortOrder: index })),
        added: incoming.length,
      }
    : mergeUnique(existingWorks, incoming);

  const catalogResult = replaceMode
    ? {
        merged: incoming.map((item, index) => normalizeWork({ ...item, sortOrder: index })),
        added: incoming.length,
      }
    : mergeUnique(existingCatalog, incoming);

  setData('service_works', worksResult.merged);
  setData('service_work_catalog', catalogResult.merged);

  const categories = [...new Set(worksResult.merged.map(item => item.category).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b, 'ru'),
  );

  console.log(JSON.stringify({
    ok: true,
    dbPath: DB_PATH,
    importFile: IMPORT_FILE,
    importedFromFile: incoming.length,
    replaceMode,
    serviceWorks: {
      before: existingWorks.length,
      added: replaceMode ? Math.max(0, incoming.length - existingWorks.length) : worksResult.added,
      after: worksResult.merged.length,
    },
    serviceWorkCatalog: {
      before: existingCatalog.length,
      added: replaceMode ? Math.max(0, incoming.length - existingCatalog.length) : catalogResult.added,
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
