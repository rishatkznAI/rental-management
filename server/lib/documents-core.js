const DOCUMENT_TYPE_CONFIG = {
  contract: { label: 'Договор', prefix: 'CONTRACT' },
  commercial_offer: { label: 'Коммерческое предложение', prefix: 'KP' },
  act: { label: 'Акт', prefix: 'ACT' },
  upd: { label: 'УПД', prefix: 'UPD' },
  invoice: { label: 'Счёт', prefix: 'INVOICE' },
  service_act: { label: 'Сервисный акт', prefix: 'SERVICE' },
  work_order: { label: 'Заказ-наряд', prefix: 'WO' },
  debt_notification: { label: 'Уведомление о задолженности', prefix: 'DEBTNOTICE' },
  pretrial_claim: { label: 'Досудебная претензия', prefix: 'CLAIM' },
  court_document: { label: 'Судебный документ', prefix: 'COURT' },
  court_decision: { label: 'Решение суда', prefix: 'DECISION' },
  enforcement_writ: { label: 'Исполнительный лист', prefix: 'WRIT' },
  other: { label: 'Прочее', prefix: 'DOC' },
};

const DOCUMENT_STATUSES = new Set(['draft', 'sent', 'signed']);
const NUMBERING_SETTINGS_KEY = 'document_numbering_settings';

function documentError(message, status = 400, code = 'DOCUMENT_ERROR') {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  return error;
}

function text(value) {
  return String(value ?? '').trim();
}

function normalizeDocumentType(value) {
  const key = text(value).toLowerCase();
  if (key === 'quote' || key === 'kp' || key === 'кп' || key === 'commercial_offer') return 'commercial_offer';
  if (key === 'service' || key === 'service_act') return 'service_act';
  if (key === 'upd' || key === 'упд') return 'upd';
  if (DOCUMENT_TYPE_CONFIG[key]) return key;
  return 'other';
}

function normalizeDocumentStatus(value) {
  const status = text(value).toLowerCase();
  return DOCUMENT_STATUSES.has(status) ? status : 'draft';
}

function normalizeDocumentDate(value, fallbackIso = new Date().toISOString()) {
  const raw = text(value);
  const candidate = raw || fallbackIso;
  const parsed = new Date(`${candidate.slice(0, 10)}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) throw documentError('Укажите корректную дату документа');
  return parsed.toISOString().slice(0, 10);
}

function getDocumentYear(doc, fallbackIso = new Date().toISOString()) {
  return Number(normalizeDocumentDate(doc?.documentDate || doc?.date || doc?.createdAt, fallbackIso).slice(0, 4));
}

function documentNumber(doc) {
  return text(doc?.documentNumber || doc?.number);
}

function sequenceFromNumber(number, prefix, year) {
  const pattern = new RegExp(`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}-${year}-(\\d+)$`, 'i');
  const match = text(number).match(pattern);
  return match ? Number(match[1]) : null;
}

function defaultSetting(documentType, year) {
  const config = DOCUMENT_TYPE_CONFIG[documentType] || DOCUMENT_TYPE_CONFIG.other;
  return {
    documentType,
    prefix: config.prefix,
    year,
    nextNumber: 1,
    padding: 4,
    resetPeriod: 'yearly',
    isActive: true,
  };
}

function normalizeSetting(row) {
  const documentType = normalizeDocumentType(row?.documentType);
  const year = Number(row?.year) || new Date().getFullYear();
  const base = defaultSetting(documentType, year);
  return {
    ...base,
    prefix: text(row?.prefix) || base.prefix,
    nextNumber: Math.max(1, Number(row?.nextNumber) || 1),
    padding: Math.max(1, Math.min(8, Number(row?.padding) || base.padding)),
    resetPeriod: row?.resetPeriod === 'never' ? 'never' : 'yearly',
    isActive: row?.isActive !== false,
  };
}

function readNumberingSettings(appSettings = []) {
  const row = appSettings.find(item => item?.key === NUMBERING_SETTINGS_KEY);
  const value = row?.value;
  const list = Array.isArray(value) ? value : (Array.isArray(value?.settings) ? value.settings : []);
  return list.map(normalizeSetting);
}

function writeNumberingSettings(appSettings = [], settings, nowIso = () => new Date().toISOString()) {
  const idx = appSettings.findIndex(item => item?.key === NUMBERING_SETTINGS_KEY);
  const nextRow = {
    id: idx === -1 ? NUMBERING_SETTINGS_KEY : appSettings[idx].id || NUMBERING_SETTINGS_KEY,
    key: NUMBERING_SETTINGS_KEY,
    value: settings.map(normalizeSetting),
    updatedAt: nowIso(),
  };
  if (idx === -1) return [...appSettings, nextRow];
  const next = [...appSettings];
  next[idx] = { ...appSettings[idx], ...nextRow };
  return next;
}

function getSettingFor(settings, documentType, year) {
  const normalizedType = normalizeDocumentType(documentType);
  const normalizedYear = Number(year) || new Date().getFullYear();
  return settings.find(item =>
    item.documentType === normalizedType &&
    (item.resetPeriod === 'never' || Number(item.year) === normalizedYear)
  ) || defaultSetting(normalizedType, normalizedYear);
}

function upsertSetting(settings, setting) {
  const normalized = normalizeSetting(setting);
  const idx = settings.findIndex(item => item.documentType === normalized.documentType && Number(item.year) === Number(normalized.year));
  if (idx === -1) return [...settings, normalized];
  const next = [...settings];
  next[idx] = normalized;
  return next;
}

function buildDocumentNumber(setting, sequence) {
  return `${setting.prefix}-${setting.year}-${String(sequence).padStart(setting.padding, '0')}`;
}

function duplicateKey(doc, fallbackIso) {
  const number = documentNumber(doc);
  if (!number) return '';
  return `${normalizeDocumentType(doc?.documentType || doc?.type)}:${getDocumentYear(doc, fallbackIso)}:${number.toLowerCase()}`;
}

function assertDocumentNumberUnique(documents, candidate, { excludeId = '', fallbackIso = new Date().toISOString() } = {}) {
  const key = duplicateKey(candidate, fallbackIso);
  if (!key) return;
  const conflict = documents.find(doc => text(doc?.id) !== text(excludeId) && duplicateKey(doc, fallbackIso) === key);
  if (conflict) {
    throw documentError('Документ с таким номером, типом и годом уже существует', 409, 'DOCUMENT_NUMBER_DUPLICATE');
  }
}

function nextDocumentNumber(documents, settings, documentType, year) {
  const setting = getSettingFor(settings, documentType, year);
  if (!setting.isActive) throw documentError('Нумерация для этого типа документа отключена', 409, 'DOCUMENT_NUMBERING_INACTIVE');
  const maxExisting = documents.reduce((max, doc) => {
    if (normalizeDocumentType(doc?.documentType || doc?.type) !== setting.documentType) return max;
    if (getDocumentYear(doc) !== Number(setting.year)) return max;
    const sequence = sequenceFromNumber(documentNumber(doc), setting.prefix, setting.year);
    return sequence && sequence > max ? sequence : max;
  }, 0);
  const sequence = Math.max(Number(setting.nextNumber) || 1, maxExisting + 1);
  return {
    number: buildDocumentNumber(setting, sequence),
    setting: { ...setting, nextNumber: sequence + 1 },
    sequence,
  };
}

function appendDocumentHistory(doc, event) {
  const history = Array.isArray(doc?.history) ? doc.history : [];
  return {
    ...doc,
    history: [
      ...history,
      {
        id: event.id || `doc-history-${Date.now()}-${history.length + 1}`,
        action: event.action,
        field: event.field || '',
        oldValue: event.oldValue ?? null,
        newValue: event.newValue ?? null,
        comment: event.comment || '',
        createdBy: event.createdBy || 'Система',
        createdByUserId: event.createdByUserId || '',
        createdAt: event.createdAt || new Date().toISOString(),
      },
    ],
  };
}

function prepareDocumentCreate(input, {
  documents = [],
  settings = [],
  nowIso = () => new Date().toISOString(),
  generateId = prefix => `${prefix}-${Date.now()}`,
  idPrefix = 'D',
  user = {},
} = {}) {
  const now = nowIso();
  const type = normalizeDocumentType(input.documentType || input.type);
  const status = normalizeDocumentStatus(input.status);
  const date = normalizeDocumentDate(input.documentDate || input.date, now);
  const year = getDocumentYear({ documentDate: date }, now);
  let nextSettings = settings;
  let number = text(input.documentNumber || input.number);
  let numberingEvent = null;
  if (!number) {
    const generated = nextDocumentNumber(documents, settings, type, year);
    number = generated.number;
    nextSettings = upsertSetting(settings, generated.setting);
    numberingEvent = { action: 'number_assigned', field: 'number', oldValue: '', newValue: number };
  }

  const doc = {
    ...input,
    id: input.id || generateId(idPrefix),
    type,
    documentType: type,
    number,
    documentNumber: number,
    date,
    documentDate: date,
    status,
    createdAt: input.createdAt || now,
    createdBy: input.createdBy || user.userName || 'Система',
    createdByUserId: input.createdByUserId || user.userId || '',
    updatedAt: now,
    updatedBy: user.userName || 'Система',
    updatedByUserId: user.userId || '',
  };
  assertDocumentNumberUnique(documents, doc, { fallbackIso: now });
  let withHistory = appendDocumentHistory(doc, {
    action: 'created',
    createdBy: doc.createdBy,
    createdByUserId: doc.createdByUserId,
    createdAt: now,
  });
  if (numberingEvent) {
    withHistory = appendDocumentHistory(withHistory, {
      ...numberingEvent,
      createdBy: doc.createdBy,
      createdByUserId: doc.createdByUserId,
      createdAt: now,
    });
  }
  return { document: withHistory, settings: nextSettings };
}

function prepareDocumentPatch(previous, patch, {
  documents = [],
  nowIso = () => new Date().toISOString(),
  user = {},
  canManualNumber = false,
} = {}) {
  const now = nowIso();
  const next = {
    ...previous,
    ...patch,
    type: normalizeDocumentType(patch.documentType || patch.type || previous.documentType || previous.type),
    status: normalizeDocumentStatus(patch.status ?? previous.status),
    updatedAt: now,
    updatedBy: user.userName || 'Система',
    updatedByUserId: user.userId || '',
  };
  next.documentType = next.type;
  next.date = normalizeDocumentDate(patch.documentDate || patch.date || previous.documentDate || previous.date, now);
  next.documentDate = next.date;
  if (next.status === 'sent' && text(previous.status) !== 'sent' && !next.sentAt) {
    next.sentAt = now;
    next.sentBy = user.userName || 'Система';
  }
  if (next.status === 'signed' && text(previous.status) !== 'signed' && !next.signedAt) {
    next.signedAt = now;
    next.signedBy = user.userName || 'Система';
  }

  const previousNumber = documentNumber(previous);
  const requestedNumber = patch.documentNumber !== undefined || patch.number !== undefined
    ? text(patch.documentNumber ?? patch.number)
    : previousNumber;
  if (requestedNumber !== previousNumber && !canManualNumber) {
    throw documentError('Изменять номер документа может только администратор или офис-менеджер', 403, 'DOCUMENT_NUMBER_FORBIDDEN');
  }
  next.number = requestedNumber;
  next.documentNumber = requestedNumber;
  assertDocumentNumberUnique(documents, next, { excludeId: previous.id, fallbackIso: now });

  const changes = [];
  if (normalizeDocumentType(previous.type) !== next.type) changes.push(['type', previous.type, next.type]);
  if (previousNumber !== requestedNumber) changes.push(['number', previousNumber, requestedNumber]);
  if (text(previous.status) !== text(next.status)) changes.push(['status', previous.status, next.status]);
  if (text(previous.clientId) !== text(next.clientId) || text(previous.client) !== text(next.client)) changes.push(['client', previous.client || previous.clientId, next.client || next.clientId]);
  if (text(previous.rentalId || previous.rental) !== text(next.rentalId || next.rental)) changes.push(['rental', previous.rentalId || previous.rental, next.rentalId || next.rental]);
  if (text(previous.equipmentId || previous.equipmentInv || previous.equipment) !== text(next.equipmentId || next.equipmentInv || next.equipment)) changes.push(['equipment', previous.equipmentId || previous.equipmentInv || previous.equipment, next.equipmentId || next.equipmentInv || next.equipment]);
  if (text(previous.serviceTicketId || previous.serviceTicket) !== text(next.serviceTicketId || next.serviceTicket)) changes.push(['serviceTicket', previous.serviceTicketId || previous.serviceTicket, next.serviceTicketId || next.serviceTicket]);
  if (text(previous.date || previous.documentDate) !== text(next.date || next.documentDate)) changes.push(['date', previous.date || previous.documentDate, next.date || next.documentDate]);
  if (text(previous.fileUrl || previous.fileName || previous.signedScanFileName) !== text(next.fileUrl || next.fileName || next.signedScanFileName)) changes.push(['file', previous.fileUrl || previous.fileName || previous.signedScanFileName, next.fileUrl || next.fileName || next.signedScanFileName]);

  return changes.reduce((doc, [field, oldValue, newValue]) => appendDocumentHistory(doc, {
    action: field === 'number' ? 'number_changed' : 'updated',
    field,
    oldValue,
    newValue,
    createdBy: user.userName || 'Система',
    createdByUserId: user.userId || '',
    createdAt: now,
  }), next);
}

function buildDocumentRegistrySummary(documents = [], todayIso = new Date().toISOString()) {
  const currentMonth = todayIso.slice(0, 7);
  const counts = new Map();
  documents.forEach(doc => {
    const key = duplicateKey(doc, todayIso);
    if (!key) return;
    counts.set(key, (counts.get(key) || 0) + 1);
  });
  const duplicateKeys = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  const duplicateDocuments = documents.filter(doc => duplicateKeys.has(duplicateKey(doc, todayIso)));
  return {
    total: documents.length,
    withoutNumber: documents.filter(doc => !documentNumber(doc)).length,
    duplicateNumbers: duplicateDocuments.length,
    unsigned: documents.filter(doc => normalizeDocumentStatus(doc.status) !== 'signed').length,
    signed: documents.filter(doc => normalizeDocumentStatus(doc.status) === 'signed').length,
    currentMonth: documents.filter(doc => text(doc.documentDate || doc.date || doc.createdAt).slice(0, 7) === currentMonth).length,
    duplicates: duplicateDocuments.map(doc => ({ id: doc.id, number: documentNumber(doc), type: normalizeDocumentType(doc.type), year: getDocumentYear(doc, todayIso) })),
    invalidNumbers: documents.filter(doc => documentNumber(doc) && !/^[A-ZА-Я0-9_-]+-\d{4}-\d+$/i.test(documentNumber(doc)))
      .map(doc => ({ id: doc.id, number: documentNumber(doc), type: normalizeDocumentType(doc.type), year: getDocumentYear(doc, todayIso) })),
  };
}

module.exports = {
  DOCUMENT_TYPE_CONFIG,
  DOCUMENT_STATUSES,
  NUMBERING_SETTINGS_KEY,
  normalizeDocumentType,
  normalizeDocumentStatus,
  normalizeDocumentDate,
  getDocumentYear,
  documentNumber,
  readNumberingSettings,
  writeNumberingSettings,
  upsertSetting,
  nextDocumentNumber,
  prepareDocumentCreate,
  prepareDocumentPatch,
  appendDocumentHistory,
  assertDocumentNumberUnique,
  buildDocumentRegistrySummary,
};
