import { createRequire } from 'node:module';
import path from 'node:path';

const require = createRequire(import.meta.url);
const Database = require('../server/node_modules/better-sqlite3');

const dbPath = path.resolve(process.env.DB_PATH || 'server/data/app.sqlite');
const db = new Database(dbPath, { readonly: true, fileMustExist: true });

function readCollection(name) {
  const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
  if (!row) return [];
  try {
    const parsed = JSON.parse(row.json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function sourceId(gantt) {
  return text(gantt?.rentalId || gantt?.sourceRentalId || gantt?.originalRentalId);
}

function shapeKey(gantt) {
  return [
    text(gantt?.equipmentId || gantt?.equipmentInv || gantt?.inventoryNumber),
    text(gantt?.startDate).slice(0, 10),
    text(gantt?.endDate || gantt?.plannedReturnDate).slice(0, 10),
    text(gantt?.clientId || gantt?.client || gantt?.clientName).toLowerCase(),
  ].join('|');
}

function isSmokeLike(record) {
  const haystack = [
    record?.id,
    record?.rentalId,
    record?.sourceRentalId,
    record?.originalRentalId,
    record?.client,
    record?.clientName,
    record?.manager,
    record?.comment,
    record?.notes,
  ].map(text).join(' ').toLowerCase();
  return /\b(e2e|smoke|ui-smoke|test-|seed-177|177844)\b/.test(haystack);
}

function groupBy(list, keyFn) {
  const map = new Map();
  for (const item of list) {
    const key = keyFn(item);
    if (!key) continue;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(item);
  }
  return map;
}

const rentals = readCollection('rentals');
const ganttRentals = readCollection('gantt_rentals');
const rentalsById = new Set(rentals.map(item => text(item?.id)).filter(Boolean));
const withSource = ganttRentals.filter(item => sourceId(item));
const withValidSource = withSource.filter(item => rentalsById.has(sourceId(item)));
const brokenSource = withSource.filter(item => !rentalsById.has(sourceId(item)));
const noRentalIdButLegacyLink = ganttRentals.filter(item => !text(item?.rentalId) && (text(item?.sourceRentalId) || text(item?.originalRentalId)));
const noAnyLink = ganttRentals.filter(item => !sourceId(item));
const duplicatesByCanonical = [...groupBy(withValidSource, sourceId).entries()].filter(([, items]) => items.length > 1);
const duplicatesByShape = [...groupBy(ganttRentals, shapeKey).entries()]
  .filter(([key, items]) => key.split('|').some(Boolean) && items.length > 1);
const smokeLike = ganttRentals.filter(isSmokeLike);

const rows = [
  ['rentals', rentals.length, rentals[0]?.id || '', 'Классические записи договоров аренды.', 'Не менять.'],
  ['gantt_rentals', ganttRentals.length, ganttRentals[0]?.id || '', 'Плановые/таймлайн-записи, на которых строился UI.', 'Не менять при открытии страницы.'],
  ['valid linked gantt_rentals', withValidSource.length, withValidSource[0]?.id || '', 'Плановые записи с rentalId/source/original, который есть в rentals.', 'Показывать через дедупликацию по canonical rental id.'],
  ['broken linked gantt_rentals', brokenSource.length, brokenSource[0]?.id || '', 'Есть ссылка на rentals, но такой rental нет.', 'Показывать только как диагностику/legacy warning, не как полноценную активную аренду.'],
  ['source/original without rentalId', noRentalIdButLegacyLink.length, noRentalIdButLegacyLink[0]?.id || '', 'Нет rentalId, но есть sourceRentalId/originalRentalId.', 'Использовать canonical id без backfill.'],
  ['no rental link', noAnyLink.length, noAnyLink[0]?.id || '', 'Нет rentalId/sourceRentalId/originalRentalId.', 'Не считать полноценной арендой; только диагностика или ручной dry-run backfill.'],
  ['duplicate canonical rental id groups', duplicatesByCanonical.length, duplicatesByCanonical[0]?.[1]?.[0]?.id || '', 'Несколько gantt_rentals ссылаются на одну rentals.', 'В UI выбрать лучшую строку, остальные не размножать.'],
  ['duplicate equipment/date/client groups', duplicatesByShape.length, duplicatesByShape[0]?.[1]?.[0]?.id || '', 'Похожие плановые строки по технике, датам и клиенту.', 'Проверить вручную перед любыми data-fix действиями.'],
  ['smoke/e2e-like gantt_rentals', smokeLike.length, smokeLike[0]?.id || '', 'Локальные тестовые записи загрязняют аудит данных.', 'Не удалять в этом этапе; нужен отдельный cleanup dry-run.'],
];

console.log(`DB: ${dbPath}`);
console.table(rows.map(([type, count, exampleId, meaning, safeAction]) => ({
  'Тип проблемы': type,
  'Количество': count,
  'Пример id': exampleId,
  'Что это значит': meaning,
  'Безопасное действие': safeAction,
})));

console.log(JSON.stringify({
  rentals: rentals.length,
  gantt_rentals: ganttRentals.length,
  gantt_with_valid_rental_link: withValidSource.length,
  gantt_with_missing_rental_link: brokenSource.length,
  gantt_without_rentalId_but_source_or_original: noRentalIdButLegacyLink.length,
  gantt_without_any_rental_link: noAnyLink.length,
  duplicate_canonical_rental_id_groups: duplicatesByCanonical.length,
  duplicate_equipment_date_client_groups: duplicatesByShape.length,
  smoke_e2e_like_gantt_rentals: smokeLike.length,
}, null, 2));
