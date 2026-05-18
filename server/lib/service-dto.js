const SERVICE_STATUSES = new Set(['new', 'in_progress', 'waiting_parts', 'needs_revision', 'ready', 'closed']);
const SERVICE_PRIORITIES = new Set(['critical', 'high', 'medium', 'low']);
const SERVICE_KINDS = new Set(['repair', 'to', 'chto', 'pto']);

const STATUS_ALIASES = new Map([
  ['open', 'new'],
  ['pending', 'new'],
  ['created', 'new'],
  ['progress', 'in_progress'],
  ['inprogress', 'in_progress'],
  ['in_progress', 'in_progress'],
  ['waiting', 'waiting_parts'],
  ['waitingparts', 'waiting_parts'],
  ['waiting_parts', 'waiting_parts'],
  ['needsrevision', 'needs_revision'],
  ['needs_revision', 'needs_revision'],
  ['revision', 'needs_revision'],
  ['rework', 'needs_revision'],
  ['done', 'closed'],
  ['complete', 'closed'],
  ['completed', 'closed'],
  ['finished', 'closed'],
]);

const PRIORITY_ALIASES = new Map([
  ['urgent', 'critical'],
  ['critical', 'critical'],
  ['high', 'high'],
  ['normal', 'medium'],
  ['medium', 'medium'],
  ['low', 'low'],
]);

function stringValue(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function dateValue(value) {
  const text = stringValue(value);
  if (!text) return '';
  return Number.isFinite(Date.parse(text)) ? text : '';
}

function serviceCreatedAtValue(item) {
  return dateValue(
    item?.createdAt
      || item?.created_at
      || item?.createdDate
      || item?.created
      || item?.date
      || item?.requestedAt
      || item?.openedAt
      || item?.updatedAt
      || item?.updated_at
      || item?.modifiedAt,
  );
}

function serviceUpdatedAtValue(item) {
  return dateValue(item?.updatedAt || item?.updated_at || item?.modifiedAt) || serviceCreatedAtValue(item);
}

function enumKey(value) {
  return stringValue(value)
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s-]+/g, '_');
}

function normalizeStatus(value) {
  const key = enumKey(value);
  const direct = SERVICE_STATUSES.has(key) ? key : null;
  return direct || STATUS_ALIASES.get(key) || 'new';
}

function normalizePriority(value) {
  const key = enumKey(value);
  const direct = SERVICE_PRIORITIES.has(key) ? key : null;
  return direct || PRIORITY_ALIASES.get(key) || 'medium';
}

function normalizeServiceKind(item) {
  const explicit = enumKey(item?.serviceKind || item?.scenario || item?.type);
  if (SERVICE_KINDS.has(explicit)) return explicit;

  const reason = enumKey(item?.reason);
  if (reason === 'то') return 'to';
  if (reason === 'что') return 'chto';
  if (reason === 'пто') return 'pto';
  return 'repair';
}

function arrayValue(value) {
  return Array.isArray(value) ? value : [];
}

function objectValue(value, fallback) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : fallback;
}

function normalizeServiceTicketRecord(item, index = 0) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const {
    debt: _debt,
    receivables: _receivables,
    payments: _payments,
    paymentTerms: _paymentTerms,
    contractAmount: _contractAmount,
    contractSum: _contractSum,
    clientDebt: _clientDebt,
    ...safeItem
  } = item;

  const id = stringValue(item.id) || `legacy-service-${index + 1}`;
  const serviceKind = normalizeServiceKind(item);
  const scenario = stringValue(item.scenario || item.type || serviceKind);
  const type = stringValue(item.type || item.scenario || serviceKind);
  const createdAt = serviceCreatedAtValue(item);
  const updatedAt = serviceUpdatedAtValue(item) || createdAt;
  const inventoryNumber = stringValue(item.inventoryNumber || item.inventory || item.equipmentInv);
  const equipmentId = stringValue(item.equipmentId || item.equipment_id);
  const equipment = stringValue(item.equipment || item.equipmentName || item.equipmentTitle)
    || (inventoryNumber ? `INV: ${inventoryNumber}` : equipmentId);
  const reason = stringValue(item.reason || item.title || item.summary) || 'Без причины';
  const description = stringValue(item.description || item.comment || item.details);
  const assignedMechanicId = stringValue(item.assignedMechanicId || item.mechanicId || item.assignedUserId);
  const mechanicId = stringValue(item.mechanicId || item.assignedMechanicId || item.assignedUserId);

  return {
    ...safeItem,
    id,
    equipmentId,
    equipment,
    serviceKind,
    scenario,
    type,
    inventoryNumber,
    serialNumber: stringValue(item.serialNumber || item.serial),
    reason,
    description,
    priority: normalizePriority(item.priority),
    sla: stringValue(item.sla),
    status: normalizeStatus(item.status),
    assignedMechanicId,
    mechanicId,
    assignedMechanicName: stringValue(item.assignedMechanicName || item.mechanicName),
    assignedTo: stringValue(item.assignedTo || item.responsibleName),
    clientId: stringValue(item.clientId || item.client_id),
    client: stringValue(item.client || item.clientName),
    clientName: stringValue(item.clientName || item.client),
    rentalId: stringValue(item.rentalId || item.rental_id),
    objectId: stringValue(item.objectId || item.clientObjectId || item.siteId),
    contractId: stringValue(item.contractId || item.clientContractId),
    objectName: stringValue(item.objectName),
    objectAddress: stringValue(item.objectAddress),
    objectContactName: stringValue(item.objectContactName),
    objectContactPhone: stringValue(item.objectContactPhone),
    contractNumber: stringValue(item.contractNumber),
    createdAt,
    updatedAt,
    workLog: arrayValue(item.workLog),
    parts: arrayValue(item.parts),
    resultData: objectValue(item.resultData, { summary: '', partsUsed: [], worksPerformed: [] }),
  };
}

function normalizeServiceTicketList(list) {
  return (Array.isArray(list) ? list : [])
    .map((item, index) => normalizeServiceTicketRecord(item, index))
    .filter(Boolean);
}

function normalizeServiceTicketForWrite(item, options = {}) {
  if (!item || typeof item !== 'object' || Array.isArray(item)) return null;
  const now = typeof options.nowIso === 'function' ? options.nowIso() : new Date().toISOString();
  const previous = options.previous && typeof options.previous === 'object' ? options.previous : null;
  const isCreate = options.isCreate !== false && !previous;
  const actor = options.actor || {};
  const actorId = stringValue(actor.userId || actor.id);
  const actorName = stringValue(actor.userName || actor.name);
  const createdAt = previous
    ? serviceCreatedAtValue(previous) || serviceCreatedAtValue(item) || now
    : serviceCreatedAtValue(item) || now;
  const createdBy = previous
    ? (previous.createdBy || item.createdBy || actorName || undefined)
    : (item.createdBy || actorName || undefined);
  const createdByName = previous
    ? (previous.createdByName || previous.createdByUserName || item.createdByName || item.createdByUserName || actorName || undefined)
    : (item.createdByName || item.createdByUserName || actorName || undefined);
  const createdByUserId = previous
    ? (previous.createdByUserId || item.createdByUserId || actorId || undefined)
    : (item.createdByUserId || actorId || undefined);

  return {
    ...item,
    createdAt,
    updatedAt: now,
    ...(createdBy ? { createdBy } : {}),
    ...(createdByName ? { createdByName, createdByUserName: item.createdByUserName || createdByName } : {}),
    ...(createdByUserId ? { createdByUserId } : {}),
    ...(isCreate && !item.source ? { source: 'manual' } : {}),
  };
}

function backfillServiceTicketCreatedAt(list, options = {}) {
  const source = Array.isArray(list) ? list : [];
  const now = typeof options.nowIso === 'function' ? options.nowIso() : new Date().toISOString();
  const stats = {
    total: source.length,
    missingCreatedAt: 0,
    fromCreatedDate: 0,
    fromDate: 0,
    fromRequestedAt: 0,
    fromUpdatedAt: 0,
    fromNow: 0,
    changed: 0,
  };
  const items = source.map(item => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
    if (dateValue(item.createdAt)) return item;
    stats.missingCreatedAt += 1;
    const fallbackCandidates = [
      ['createdDate', item.createdDate],
      ['date', item.date],
      ['requestedAt', item.requestedAt],
      ['updatedAt', item.updatedAt || item.updated_at || item.modifiedAt],
    ];
    const found = fallbackCandidates.find(([, value]) => dateValue(value));
    const createdAt = found ? dateValue(found[1]) : now;
    if (found?.[0] === 'createdDate') stats.fromCreatedDate += 1;
    else if (found?.[0] === 'date') stats.fromDate += 1;
    else if (found?.[0] === 'requestedAt') stats.fromRequestedAt += 1;
    else if (found?.[0] === 'updatedAt') stats.fromUpdatedAt += 1;
    else stats.fromNow += 1;
    stats.changed += 1;
    return {
      ...item,
      createdAt,
      updatedAt: dateValue(item.updatedAt || item.updated_at || item.modifiedAt) || createdAt,
      ...(found ? {} : { createdAtRestoredApproximate: true, createdAtRestoredAt: now }),
    };
  });
  return { items, stats };
}

module.exports = {
  backfillServiceTicketCreatedAt,
  normalizeServiceTicketForWrite,
  normalizeServiceTicketList,
  normalizeServiceTicketRecord,
  serviceCreatedAtValue,
};
