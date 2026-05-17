#!/usr/bin/env node
import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('../server/node_modules/better-sqlite3');

const dbPath = process.argv[2] || process.env.DB_PATH || 'server/data/app.sqlite';

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function parseCollection(db, name, fallback = []) {
  const row = db.prepare('select json from app_data where name = ?').get(name);
  if (!row) return fallback;
  const parsed = JSON.parse(row.json);
  return Array.isArray(parsed) ? parsed : fallback;
}

function countBy(list, field) {
  const counts = new Map();
  for (const item of list) {
    const raw = item?.[field];
    const key = raw && typeof raw === 'object' ? '[object]' : text(raw) || '[empty]';
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Object.fromEntries([...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'ru')));
}

function saleStatusKind(equipment = {}) {
  const rawStatus = lower(equipment.saleStatus || equipment.salesStatus || equipment.status || equipment.category);
  if (equipment.category === 'sold' || rawStatus === 'sold' || rawStatus === 'продана' || rawStatus === 'продано') return 'sold';
  if (rawStatus === 'reserved' || rawStatus === 'резерв') return 'reserved';
  if (rawStatus === 'in_deal' || rawStatus === 'deal' || rawStatus === 'в сделке') return 'in_deal';
  if (equipment.isForSale === true || equipment.forSale === true || equipment.saleMode === true) return 'on_sale';
  if (rawStatus === 'removed' || rawStatus === 'withdrawn' || rawStatus === 'снята с продажи' || rawStatus === 'снято с продажи') return 'removed';
  if (['sale', 'sales', 'for_sale', 'for-sale', 'on_sale', 'on-sale', 'на продаже', 'на продажу', 'продажа', 'продается', 'продаётся'].includes(rawStatus)) return 'on_sale';
  return 'unknown';
}

function explicitSaleStatusKind(equipment = {}) {
  if (!text(equipment.saleStatus) && !text(equipment.salesStatus)) return 'unknown';
  return saleStatusKind({
    saleStatus: equipment.saleStatus,
    salesStatus: equipment.salesStatus,
    category: equipment.category,
  });
}

function hasExplicitSaleMode(equipment = {}) {
  const normalized = lower(equipment.saleMode);
  return equipment.saleMode === true || ['sale', 'sales', 'for_sale', 'on_sale', 'на продаже', 'на продажу'].includes(normalized);
}

function hasActiveSaleRegistrySignal(equipment = {}) {
  const explicitKind = explicitSaleStatusKind(equipment);
  return equipment.saleMode === true
    || equipment.forSale === true
    || equipment.isForSale === true
    || ['on_sale', 'reserved', 'in_deal'].includes(explicitKind);
}

function isSoldEquipment(equipment = {}) {
  return equipment.category === 'sold' || explicitSaleStatusKind(equipment) === 'sold' || lower(equipment.status) === 'sold';
}

function isForSaleEquipment(equipment = {}) {
  const explicitKind = explicitSaleStatusKind(equipment);
  return !isSoldEquipment(equipment) && explicitKind !== 'removed' && hasActiveSaleRegistrySignal(equipment);
}

function isWrittenOffEquipment(equipment = {}) {
  if (isSoldEquipment(equipment) || isForSaleEquipment(equipment)) return false;
  const status = lower(equipment.status);
  return ['inactive', 'written_off', 'written-off', 'списан', 'списана', 'списанная'].includes(status)
    || equipment.isWrittenOff === true
    || equipment.disposed === true
    || ['written_off', 'written-off'].includes(lower(equipment.writeOffStatus));
}

function isHiddenRegistryRecord(equipment = {}) {
  return equipment.hidden === true
    || equipment.isHidden === true
    || equipment.archived === true
    || equipment.isArchived === true
    || equipment.deleted === true
    || equipment.isDeleted === true
    || lower(equipment.status) === 'archived';
}

function bucket(equipment = {}) {
  if (isSoldEquipment(equipment)) return 'sold';
  if (isForSaleEquipment(equipment)) return 'for_sale';
  if (isWrittenOffEquipment(equipment)) return 'written_off';
  const status = lower(equipment.status);
  if (status === 'rented') return 'rented';
  if (status === 'reserved') return 'reserved';
  if (status === 'in_service') return 'service';
  return 'available';
}

function hiddenReasons(equipment = {}) {
  const reasons = [];
  if (equipment.hidden === true || equipment.isHidden === true) reasons.push('hidden flag');
  if (equipment.archived === true || equipment.isArchived === true || lower(equipment.status) === 'archived') reasons.push('archived');
  if (equipment.deleted === true || equipment.isDeleted === true) reasons.push('deleted');
  return reasons;
}

function duplicateValues(list, field) {
  return Object.entries(countBy(list, field))
    .filter(([value, count]) => value !== '[empty]' && count > 1)
    .map(([value, count]) => ({ value, count }));
}

function sample(items, limit = 10) {
  return items.slice(0, limit).map(item => ({
    id: item.id || '',
    inventoryNumber: item.inventoryNumber || item.equipmentInv || item.inv || '',
    model: [item.manufacturer, item.model].filter(Boolean).join(' ') || item.name || '',
    status: item.status ?? null,
    category: item.category ?? null,
    owner: item.owner ?? null,
    ownerId: item.ownerId ?? item.owner_id ?? null,
    bucket: bucket(item),
    hiddenReasons: hiddenReasons(item),
  }));
}

const db = new Database(path.resolve(dbPath), { readonly: true, fileMustExist: true });
try {
  const equipment = parseCollection(db, 'equipment', []);
  const visibleAll = equipment.filter(item => !isHiddenRegistryRecord(item));
  const hidden = equipment.filter(isHiddenRegistryRecord);
  const missingIds = equipment.filter(item => !text(item.id));
  const duplicateIds = duplicateValues(equipment, 'id');
  const buckets = countBy(equipment.map(item => ({ bucket: bucket(item) })), 'bucket');
  const hiddenByReason = countBy(hidden.flatMap(item => hiddenReasons(item).map(reason => ({ reason }))), 'reason');
  const suspicious = equipment.filter(item => (
    !text(item.id)
    || hiddenReasons(item).length > 0
    || (isForSaleEquipment(item) && isWrittenOffEquipment(item))
    || (item.category && typeof item.category === 'object')
    || (item.status && typeof item.status === 'object')
    || (item.owner && typeof item.owner === 'object')
  ));

  const report = {
    dbPath: path.resolve(dbPath),
    readOnly: true,
    totalEquipment: equipment.length,
    visibleInAllTab: visibleAll.length,
    hiddenCount: hidden.length,
    hiddenByReason,
    counts: {
      byBucket: buckets,
      byStatus: countBy(equipment, 'status'),
      byCategory: countBy(equipment, 'category'),
      byOwner: countBy(equipment, 'owner'),
      byOwnerId: countBy(equipment, 'ownerId'),
      bySaleMode: countBy(equipment, 'saleMode'),
      byForSale: countBy(equipment, 'forSale'),
      byIsForSale: countBy(equipment, 'isForSale'),
      byWrittenOff: countBy(equipment, 'written_off'),
      bySold: countBy(equipment, 'sold'),
    },
    ids: {
      withId: equipment.length - missingIds.length,
      missingIds: missingIds.length,
      duplicateIds,
    },
    paginationRisk: {
      defaultUiPageSize: 20,
      firstPageCountIfServerPaginated: Math.min(20, visibleAll.length),
      wouldHideBeyondFirstPage: Math.max(0, visibleAll.length - 20),
    },
    suspiciousRecords: sample(suspicious, 15),
    hiddenSamples: sample(hidden, 15),
  };

  console.log(JSON.stringify(report, null, 2));
} finally {
  db.close();
}
