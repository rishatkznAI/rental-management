export const SPARE_PARTS_CSV_COLUMNS = [
  'ID',
  'Наименование',
  'Артикул',
  'Категория',
  'Единица измерения',
  'Цена',
  'Поставщик',
  'Комментарий',
];

const HEADER_ALIASES = {
  id: ['id', 'идентификатор', 'logical id', 'logicalid'],
  name: ['наименование', 'название', 'запчасть', 'name'],
  article: ['артикул', 'sku', 'код', 'номер'],
  category: ['категория', 'category'],
  unit: ['единица измерения', 'ед. изм.', 'ед изм', 'единица', 'unit'],
  defaultPrice: ['цена', 'базовая цена', 'стоимость', 'price', 'defaultprice'],
  manufacturer: ['поставщик', 'производитель', 'manufacturer', 'supplier'],
  comment: ['комментарий', 'примечание', 'comment', 'notes'],
};

const FORBIDDEN_IMPORT_HEADERS = new Map([
  ['companyid', 'companyId'],
  ['company id', 'companyId'],
  ['tenantid', 'tenantId'],
  ['tenant id', 'tenantId'],
  ['platformdefaultid', 'platformDefaultId'],
  ['platform default id', 'platformDefaultId'],
  ['catalogorigin', 'catalogOrigin'],
  ['catalog origin', 'catalogOrigin'],
  ['physicalid', 'physicalId'],
  ['physical id', 'physicalId'],
  ['_physicalid', '_physicalId'],
  ['_id', '_id'],
]);

function normalizeText(value) {
  return String(value ?? '').replace(/\s+/g, ' ').trim();
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase().replace(/[ё]/g, 'е');
}

function parsePrice(value) {
  const text = normalizeText(value).replace(/\s+/g, '').replace(',', '.');
  if (!text) return { ok: true, value: undefined };
  const numeric = Number(text);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return { ok: false, value: undefined };
  }
  return { ok: true, value: numeric };
}

function detectDelimiter(firstLine) {
  const semicolons = (firstLine.match(/;/g) || []).length;
  const commas = (firstLine.match(/,/g) || []).length;
  return semicolons >= commas ? ';' : ',';
}

export function parseCsv(text) {
  const input = String(text ?? '').replace(/^\uFEFF/, '');
  const delimiter = detectDelimiter(input.split(/\r?\n/, 1)[0] || '');
  const rows = [];
  let row = [];
  let cell = '';
  let inQuotes = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        index += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (!inQuotes && char === delimiter) {
      row.push(cell);
      cell = '';
      continue;
    }
    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') index += 1;
      row.push(cell);
      if (row.some(value => normalizeText(value))) rows.push(row);
      row = [];
      cell = '';
      continue;
    }
    cell += char;
  }

  row.push(cell);
  if (row.some(value => normalizeText(value))) rows.push(row);
  return rows;
}

function resolveHeaderMap(headers) {
  const normalizedHeaders = headers.map(normalizeKey);
  const map = {};
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const index = normalizedHeaders.findIndex(header => aliases.includes(header));
    if (index >= 0) map[field] = index;
  }
  return map;
}

function findForbiddenImportHeaders(headers) {
  return [...new Set(headers
    .map(normalizeKey)
    .map(header => FORBIDDEN_IMPORT_HEADERS.get(header))
    .filter(Boolean))];
}

function readCell(row, index) {
  return index === undefined ? '' : normalizeText(row[index]);
}

function makeImportId(existingIds, sequence) {
  let candidate = `PT-import-${Date.now()}-${sequence}`;
  while (existingIds.has(candidate)) {
    sequence += 1;
    candidate = `PT-import-${Date.now()}-${sequence}`;
  }
  existingIds.add(candidate);
  return candidate;
}

export function buildSparePartsImportPlan(existingParts, csvText, options = {}) {
  const rows = parseCsv(csvText);
  const stats = { added: 0, updated: 0, skipped: 0, errors: 0 };
  const errors = [];

  if (rows.length === 0) {
    return { parts: [...existingParts], stats: { ...stats, errors: 1 }, errors: ['Файл пустой'] };
  }

  const headerMap = resolveHeaderMap(rows[0]);
  const forbiddenHeaders = findForbiddenImportHeaders(rows[0]);
  if (forbiddenHeaders.length > 0) {
    return {
      parts: existingParts.map(item => ({ ...item })),
      stats: { ...stats, errors: 1 },
      errors: [`Запрещены служебные колонки: ${forbiddenHeaders.join(', ')}`],
    };
  }
  if (headerMap.name === undefined) {
    return {
      parts: [...existingParts],
      stats: { ...stats, errors: 1 },
      errors: ['Не найдена колонка «Наименование»'],
    };
  }

  const now = options.now || new Date().toISOString();
  const parts = existingParts.map(item => ({ ...item }));
  const existingIds = new Set();
  const indexById = new Map();
  const invalidExistingIds = [];

  parts.forEach((item, index) => {
    const id = typeof item?.id === 'string' ? item.id.trim() : '';
    if (!id || id !== item.id || indexById.has(id)) {
      invalidExistingIds.push(id || `#${index + 1}`);
      return;
    }
    existingIds.add(id);
    indexById.set(id, index);
  });
  if (invalidExistingIds.length > 0) {
    return {
      parts,
      stats: { ...stats, errors: 1 },
      errors: ['Текущий каталог содержит пустые или дублирующиеся ID; импорт запрещён'],
    };
  }

  const seenExplicitIds = new Set();

  rows.slice(1).forEach((row, rowIndex) => {
    const displayRow = rowIndex + 2;
    const explicitId = readCell(row, headerMap.id);
    const name = readCell(row, headerMap.name);
    if (!name) {
      stats.skipped += 1;
      return;
    }

    const price = parsePrice(readCell(row, headerMap.defaultPrice));
    if (!price.ok) {
      stats.errors += 1;
      errors.push(`Строка ${displayRow}: цена должна быть числом 0 или больше`);
      return;
    }

    const article = readCell(row, headerMap.article);
    const unit = readCell(row, headerMap.unit) || 'шт';
    const category = readCell(row, headerMap.category);
    const manufacturer = readCell(row, headerMap.manufacturer);
    const comment = readCell(row, headerMap.comment);

    let existingIndex;
    if (explicitId) {
      if (seenExplicitIds.has(explicitId)) {
        stats.errors += 1;
        errors.push(`Строка ${displayRow}: ID ${explicitId} повторяется в файле`);
        return;
      }
      seenExplicitIds.add(explicitId);
      existingIndex = indexById.get(explicitId);
      if (existingIndex === undefined) {
        stats.errors += 1;
        errors.push(`Строка ${displayRow}: неизвестный или недоступный ID ${explicitId}`);
        return;
      }
    }

    const patch = {
      name,
      article: article || undefined,
      sku: article || undefined,
      unit,
      category: category || undefined,
      manufacturer: manufacturer || undefined,
      isActive: true,
      updatedAt: now,
    };
    if (price.value !== undefined) patch.defaultPrice = price.value;
    if (comment) patch.comment = comment;

    if (existingIndex !== undefined) {
      parts[existingIndex] = {
        ...parts[existingIndex],
        ...patch,
        id: parts[existingIndex].id,
        createdAt: parts[existingIndex].createdAt,
      };
      stats.updated += 1;
      return;
    }

    const nextPart = {
      id: makeImportId(existingIds, rowIndex + 1),
      ...patch,
      defaultPrice: price.value ?? 0,
      createdAt: now,
    };
    parts.push(nextPart);
    indexById.set(nextPart.id, parts.length - 1);
    stats.added += 1;
  });

  return {
    parts: errors.length > 0 ? existingParts.map(item => ({ ...item })) : parts,
    stats,
    errors,
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",;\r\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

export function sparePartsToCsv(parts) {
  const rows = [
    SPARE_PARTS_CSV_COLUMNS,
    ...parts.map(part => [
      part.id || '',
      part.name || '',
      part.article || part.sku || '',
      part.category || '',
      part.unit || 'шт',
      part.defaultPrice ?? '',
      part.manufacturer || part.supplier || '',
      part.comment || part.notes || '',
    ]),
  ];
  return `\uFEFF${rows.map(row => row.map(csvEscape).join(';')).join('\r\n')}`;
}
