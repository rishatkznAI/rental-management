const SERVICE_STATUSES = new Set(['new', 'in_progress', 'waiting_parts', 'ready', 'closed']);
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

  const id = stringValue(item.id) || `legacy-service-${index + 1}`;
  const serviceKind = normalizeServiceKind(item);
  const scenario = stringValue(item.scenario || item.type || serviceKind);
  const type = stringValue(item.type || item.scenario || serviceKind);
  const createdAt = dateValue(item.createdAt || item.created_at || item.date || item.openedAt);
  const updatedAt = dateValue(item.updatedAt || item.updated_at || item.modifiedAt) || createdAt;
  const inventoryNumber = stringValue(item.inventoryNumber || item.inventory || item.equipmentInv);
  const equipmentId = stringValue(item.equipmentId || item.equipment_id);
  const equipment = stringValue(item.equipment || item.equipmentName || item.equipmentTitle)
    || (inventoryNumber ? `INV: ${inventoryNumber}` : equipmentId);
  const reason = stringValue(item.reason || item.title || item.summary) || 'Без причины';
  const description = stringValue(item.description || item.comment || item.details);
  const assignedMechanicId = stringValue(item.assignedMechanicId || item.mechanicId || item.assignedUserId);
  const mechanicId = stringValue(item.mechanicId || item.assignedMechanicId || item.assignedUserId);

  return {
    ...item,
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
    rentalId: stringValue(item.rentalId || item.rental_id),
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

module.exports = {
  normalizeServiceTicketList,
  normalizeServiceTicketRecord,
};
