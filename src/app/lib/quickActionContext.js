function safeText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return '';
}

export function normalizeContextName(value) {
  return safeText(value).toLowerCase().replace(/\s+/g, ' ');
}

function readParam(source, key) {
  if (!source) return '';
  if (typeof source.get === 'function') return safeText(source.get(key));
  return safeText(source[key]);
}

export function buildQuickActionContext(source) {
  return {
    action: readParam(source, 'action'),
    clientId: readParam(source, 'clientId'),
    clientName: readParam(source, 'clientName') || readParam(source, 'client'),
    rentalId: readParam(source, 'rentalId'),
    equipmentId: readParam(source, 'equipmentId'),
    equipmentInv: readParam(source, 'equipmentInv'),
  };
}

export function hasClientContext(context) {
  return Boolean(safeText(context?.clientId) || safeText(context?.clientName));
}

export function matchesClientContext(record, context) {
  if (!hasClientContext(context)) return true;

  const wantedId = safeText(context?.clientId);
  const wantedName = normalizeContextName(context?.clientName);
  const recordId = safeText(record?.clientId);
  const recordName = normalizeContextName(record?.clientName);

  if (wantedId && recordId) return recordId === wantedId;
  if (wantedName && recordName) return recordName === wantedName;
  return false;
}

export function contextFilterLabel(context, fallback = 'выбранному клиенту') {
  return safeText(context?.clientName) || safeText(context?.clientId) || fallback;
}
