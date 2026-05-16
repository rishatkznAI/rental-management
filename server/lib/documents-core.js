const {
  DOCUMENT_TYPE_CONFIG,
  DOCUMENT_TYPE_REGISTRY,
  getDocumentTypeMeta,
  normalizeDocumentType,
} = require('./document-registry');

const DOCUMENT_STATUSES = new Set(['draft', 'sent', 'pending_signature', 'signed', 'expired', 'cancelled']);
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

function normalizeDocumentStatus(value) {
  const status = text(value).toLowerCase();
  return DOCUMENT_STATUSES.has(status) ? status : 'draft';
}

function normalizeDocumentDate(value, fallbackIso = new Date().toISOString()) {
  const raw = text(value);
  const candidate = raw || fallbackIso;
  const datePart = candidate.slice(0, 10);
  const parsed = new Date(`${datePart}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) throw documentError('Укажите корректную дату документа');
  return datePart;
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
  if (!doc.responsibleName) doc.responsibleName = doc.manager || user.userName || 'Система';
  if (!doc.responsibleId) doc.responsibleId = user.userId || '';
  if (doc.generatedContent && !doc.printHtml) doc.printHtml = doc.generatedContent;
  if (doc.printHtml && !doc.contentHtml) doc.contentHtml = doc.printHtml;
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
  if (next.status === 'pending_signature' && text(previous.status) !== 'pending_signature' && !next.sentAt) {
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
    draft: documents.filter(doc => normalizeDocumentStatus(doc.status) === 'draft').length,
    sent: documents.filter(doc => normalizeDocumentStatus(doc.status) === 'sent').length,
    pendingSignature: documents.filter(doc => normalizeDocumentStatus(doc.status) === 'pending_signature').length,
    withoutNumber: documents.filter(doc => !documentNumber(doc)).length,
    duplicateNumbers: duplicateDocuments.length,
    unsigned: documents.filter(doc => normalizeDocumentStatus(doc.status) !== 'signed').length,
    signed: documents.filter(doc => normalizeDocumentStatus(doc.status) === 'signed').length,
    expired: documents.filter(doc => isDocumentExpired(doc, todayIso)).length,
    currentMonth: documents.filter(doc => text(doc.documentDate || doc.date || doc.createdAt).slice(0, 7) === currentMonth).length,
    duplicates: duplicateDocuments.map(doc => ({ id: doc.id, number: documentNumber(doc), type: normalizeDocumentType(doc.type), year: getDocumentYear(doc, todayIso) })),
    invalidNumbers: documents.filter(doc => documentNumber(doc) && !/^[A-ZА-Я0-9_-]+-\d{4}-\d+$/i.test(documentNumber(doc)))
      .map(doc => ({ id: doc.id, number: documentNumber(doc), type: normalizeDocumentType(doc.type), year: getDocumentYear(doc, todayIso) })),
  };
}

function fieldLabel(field) {
  const labels = {
    clientId: 'клиент',
    rentalId: 'аренда',
    equipmentId: 'техника',
    serviceTicketId: 'сервисная заявка',
    deliveryId: 'доставка',
    mechanicId: 'механик',
    serviceCarId: 'служебный автомобиль',
    parentDocumentId: 'родительский документ',
  };
  return labels[field] || field;
}

function isDocumentExpired(doc, todayIso = new Date().toISOString()) {
  const status = normalizeDocumentStatus(doc?.status);
  if (status === 'signed' || status === 'cancelled') return false;
  const dueDate = text(doc?.dueDate);
  return Boolean(dueDate && dueDate.slice(0, 10) < todayIso.slice(0, 10));
}

function validateDocumentRequiredFields(input) {
  const type = normalizeDocumentType(input?.documentType || input?.type);
  const meta = getDocumentTypeMeta(type);
  const missing = (meta.requiredFields || []).filter(field => !text(input?.[field]));
  return {
    ok: missing.length === 0,
    type,
    missing,
    messages: missing.map(field => `Укажите ${fieldLabel(field)}`),
  };
}

function resolveById(list, id) {
  const wanted = text(id);
  if (!wanted) return null;
  return (Array.isArray(list) ? list : []).find(item => text(item?.id) === wanted) || null;
}

function equipmentLabel(item) {
  return [item?.inventoryNumber, item?.manufacturer, item?.model].map(text).filter(Boolean).join(' · ');
}

function htmlEscape(value) {
  return text(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function buildSnapshot(input, collections = {}, nowIso = () => new Date().toISOString()) {
  const client = resolveById(collections.clients, input.clientId);
  const rental = resolveById(collections.rentals, input.rentalId) || resolveById(collections.gantt_rentals, input.rentalId);
  const equipment = resolveById(collections.equipment, input.equipmentId);
  const serviceTicket = resolveById(collections.service, input.serviceTicketId);
  const delivery = resolveById(collections.deliveries, input.deliveryId);
  const mechanic = resolveById(collections.mechanics, input.mechanicId);
  const serviceCar = resolveById(collections.service_vehicles, input.serviceCarId);
  const parentDocument = resolveById(collections.documents, input.parentDocumentId);

  return {
    generatedAt: nowIso(),
    client: client ? {
      id: client.id,
      company: client.company || client.name || input.client,
      inn: client.inn,
      address: client.address,
      phone: client.phone,
      email: client.email,
    } : (input.client ? { id: input.clientId, company: input.client } : null),
    rental: rental ? {
      id: rental.id,
      clientId: rental.clientId,
      client: rental.client,
      startDate: rental.startDate,
      endDate: rental.endDate || rental.plannedReturnDate,
      actualReturnDate: rental.actualReturnDate,
      amount: rental.amount ?? rental.price,
      manager: rental.manager,
      objectId: rental.objectId,
      contractId: rental.contractId,
    } : null,
    equipment: equipment ? {
      id: equipment.id,
      inventoryNumber: equipment.inventoryNumber,
      manufacturer: equipment.manufacturer,
      model: equipment.model,
      serialNumber: equipment.serialNumber,
      type: equipment.type,
    } : null,
    serviceTicket: serviceTicket ? {
      id: serviceTicket.id,
      reason: serviceTicket.reason || serviceTicket.description,
      status: serviceTicket.status,
      mechanicId: serviceTicket.mechanicId || serviceTicket.assignedMechanicId,
      mechanicName: serviceTicket.mechanicName || serviceTicket.assignedMechanicName || serviceTicket.assignedTo,
      works: serviceTicket.works || serviceTicket.workLog,
      parts: serviceTicket.parts,
      result: serviceTicket.result || serviceTicket.summary,
    } : null,
    delivery: delivery ? {
      id: delivery.id,
      status: delivery.status,
      date: delivery.date || delivery.plannedDate,
      address: delivery.address || delivery.routeTo,
      route: delivery.route || [delivery.routeFrom, delivery.routeTo].filter(Boolean).join(' → '),
    } : null,
    mechanic: mechanic ? { id: mechanic.id, name: mechanic.name, phone: mechanic.phone } : null,
    serviceCar: serviceCar ? { id: serviceCar.id, label: [serviceCar.make, serviceCar.model, serviceCar.plateNumber].filter(Boolean).join(' '), mileage: serviceCar.currentMileage } : null,
    parentDocument: parentDocument ? { id: parentDocument.id, number: documentNumber(parentDocument), type: parentDocument.type } : null,
  };
}

function linesForDocument(type, snapshot, input) {
  const client = snapshot.client?.company || input.client || '—';
  const equipment = equipmentLabel(snapshot.equipment) || input.equipmentInv || input.equipment || '—';
  const rental = snapshot.rental;
  const service = snapshot.serviceTicket;
  const delivery = snapshot.delivery;
  const mechanic = snapshot.mechanic?.name || input.mechanicName || input.responsibleName || '—';
  const route = input.route || snapshot.serviceCar?.route || delivery?.route || [input.routeFrom, input.routeTo].filter(Boolean).join(' → ') || '—';
  const amount = input.amount ?? rental?.amount;
  const date = input.documentDate || input.date || new Date().toISOString().slice(0, 10);
  const common = {
    rental_contract: [
      ['Клиент', client],
      ['Техника', equipment],
      ['Срок аренды', [rental?.startDate, rental?.endDate].filter(Boolean).join(' — ') || '—'],
      ['Ставка / сумма', amount ? String(amount) : '—'],
      ['Объект', input.objectId || rental?.objectId || '—'],
      ['Условия возврата', input.returnTerms || 'Возврат в согласованном состоянии и комплектации.'],
      ['Ответственность сторон', input.liabilityTerms || 'Стороны несут ответственность по условиям договора.'],
      ['Реквизиты', snapshot.client?.inn ? `ИНН ${snapshot.client.inn}` : '—'],
      ['Подписи сторон', 'Skytech / Клиент'],
    ],
    rental_specification: [
      ['Договор', snapshot.parentDocument?.number || input.parentDocumentId || input.contractId || '—'],
      ['Техника', equipment],
      ['Модель', [snapshot.equipment?.manufacturer, snapshot.equipment?.model].filter(Boolean).join(' ') || '—'],
      ['INV/SN', [snapshot.equipment?.inventoryNumber, snapshot.equipment?.serialNumber].filter(Boolean).join(' / ') || '—'],
      ['Период', [rental?.startDate, rental?.endDate].filter(Boolean).join(' — ') || '—'],
      ['Ставка', input.rate || '—'],
      ['Количество дней', input.days || '—'],
      ['Сумма', amount ? String(amount) : '—'],
      ['Примечания', input.notes || input.comment || '—'],
    ],
    transfer_act_to_client: [
      ['Дата передачи', input.transferDate || date],
      ['Клиент', client],
      ['Техника', equipment],
      ['Состояние при передаче', input.condition || 'Исправна, рабочее состояние.'],
      ['Комплектность', input.completeness || 'Согласно карточке техники и договору.'],
      ['Фото/замечания', input.notes || input.comment || '—'],
      ['Представитель компании', input.responsibleName || 'Skytech'],
      ['Представитель клиента', input.clientRepresentative || '—'],
      ['Подписи', 'Стороны'],
    ],
    return_act_from_client: [
      ['Дата возврата', input.returnDate || date],
      ['Клиент', client],
      ['Техника', equipment],
      ['Состояние при возврате', input.condition || 'Требует проверки после возврата.'],
      ['Повреждения', input.damageNotes || 'Не указаны'],
      ['Недостача', input.missingItems || 'Не указана'],
      ['Необходимость сервиса', input.serviceRequired || (input.serviceTicketId ? 'Да' : 'Нет')],
      ['Сервисная заявка', service?.id || input.serviceTicketId || '—'],
      ['Подписи', 'Стороны'],
    ],
    work_order: [
      ['Сервисная заявка', service?.id || input.serviceTicketId || '—'],
      ['Техника', equipment],
      ['Механик', mechanic],
      ['Причина обращения', service?.reason || input.reason || '—'],
      ['Выполненные работы', input.works || service?.works || '—'],
      ['Запчасти', input.parts || service?.parts || '—'],
      ['Трудозатраты', input.laborHours || '—'],
      ['Итог ремонта', input.result || service?.result || '—'],
      ['Сумма', amount ? String(amount) : '—'],
      ['Подпись ответственного', input.responsibleName || '—'],
    ],
    trip_ticket: [
      ['Дата', date],
      ['Служебный автомобиль', snapshot.serviceCar?.label || input.serviceCarId || '—'],
      ['Водитель/механик', mechanic],
      ['Маршрут', route],
      ['Цель поездки', input.purpose || service?.reason || delivery?.id || '—'],
      ['Связанная заявка/доставка', service?.id || delivery?.id || '—'],
      ['Начальный пробег', input.startMileage || input.odometerStart || '—'],
      ['Конечный пробег', input.endMileage || input.odometerEnd || '—'],
      ['Топливо', input.fuel || [input.fuelStart, input.fuelAdded, input.fuelEnd].filter(Boolean).join(' / ') || '—'],
      ['Комментарии', input.notes || input.comment || '—'],
    ],
  };
  return common[type] || [['Документ', getDocumentTypeMeta(type).label], ['Клиент', client], ['Техника', equipment]];
}

function buildDocumentPrintHtml(doc, snapshot, lines) {
  const meta = getDocumentTypeMeta(doc.type);
  const rows = lines.map(([label, value]) => `<tr><th>${htmlEscape(label)}</th><td>${htmlEscape(value)}</td></tr>`).join('');
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <title>${htmlEscape(meta.label)} ${htmlEscape(documentNumber(doc))}</title>
  <style>
    body { font-family: Arial, sans-serif; margin: 32px; color: #111827; }
    h1 { font-size: 24px; margin: 0 0 8px; }
    .meta { color: #6b7280; margin-bottom: 24px; }
    table { width: 100%; border-collapse: collapse; }
    th, td { border: 1px solid #d1d5db; padding: 10px 12px; text-align: left; vertical-align: top; }
    th { width: 30%; background: #f9fafb; }
    .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 32px; margin-top: 48px; }
    .line { border-top: 1px solid #111827; padding-top: 8px; }
    @media print { body { margin: 16mm; } }
  </style>
</head>
<body>
  <h1>${htmlEscape(meta.label)}</h1>
  <div class="meta">№ ${htmlEscape(documentNumber(doc))} от ${htmlEscape(doc.date)} · статус: ${htmlEscape(doc.status)}</div>
  <table>${rows}</table>
  <div class="signatures">
    <div class="line">Skytech</div>
    <div class="line">${htmlEscape(snapshot.client?.company || doc.client || 'Клиент')}</div>
  </div>
</body>
</html>`;
}

function prepareGeneratedDocument(input, collections = {}, options = {}) {
  const nowIso = options.nowIso || (() => new Date().toISOString());
  const validation = validateDocumentRequiredFields(input);
  if (!validation.ok) {
    throw documentError(`Не хватает данных: ${validation.messages.join(', ')}`, 400, 'DOCUMENT_REQUIRED_FIELDS');
  }
  const type = validation.type;
  const snapshot = input.snapshot || buildSnapshot({ ...input, type }, collections, nowIso);
  const payload = {
    ...(input.payload && typeof input.payload === 'object' ? input.payload : {}),
    lines: linesForDocument(type, snapshot, input),
  };
  const generatedContent = input.generatedContent || input.printHtml || buildDocumentPrintHtml({ ...input, type }, snapshot, payload.lines);
  return {
    ...input,
    type,
    documentType: type,
    status: input.status || getDocumentTypeMeta(type).defaultStatus || 'draft',
    client: input.client || snapshot.client?.company || snapshot.rental?.client || '',
    equipmentInv: input.equipmentInv || snapshot.equipment?.inventoryNumber || '',
    equipment: input.equipment || equipmentLabel(snapshot.equipment),
    amount: input.amount ?? snapshot.rental?.amount,
    manager: input.manager || snapshot.rental?.manager || input.responsibleName,
    responsibleName: input.responsibleName || input.manager || snapshot.rental?.manager,
    snapshot,
    payload,
    generatedContent,
    printHtml: generatedContent,
    contentHtml: input.contentHtml || generatedContent,
  };
}

module.exports = {
  DOCUMENT_TYPE_CONFIG,
  DOCUMENT_TYPE_REGISTRY,
  DOCUMENT_STATUSES,
  NUMBERING_SETTINGS_KEY,
  getDocumentTypeMeta,
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
  isDocumentExpired,
  validateDocumentRequiredFields,
  buildSnapshot,
  prepareGeneratedDocument,
};
