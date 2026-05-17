const UNLINKED_EQUIPMENT_LABEL = 'Техника не привязана';

function cleanText(value) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  const text = String(value).trim();
  if (!text || text === 'undefined' || text === 'null' || text === '[object Object]') return '';
  return text;
}

function prefixedInventory(value) {
  const text = cleanText(value);
  if (!text) return '';
  return /^inv\b/i.test(text) ? text : `INV ${text}`;
}

function prefixedSerial(value) {
  const text = cleanText(value);
  if (!text) return '';
  return /^sn\b/i.test(text) ? text : `SN ${text}`;
}

export function buildGsmEquipmentLabel(equipment, fallbackEquipmentId = '') {
  const item = equipment && typeof equipment === 'object' ? equipment : {};
  const manufacturer = cleanText(item.manufacturer);
  const model = [manufacturer, cleanText(item.model)].filter(Boolean).join(' ');
  const name = cleanText(item.name || item.equipmentName || item.label);
  const inventoryNumber = cleanText(item.inventoryNumber);
  const serialNumber = cleanText(item.serialNumber);
  const equipmentId = cleanText(item.id || item.equipmentId || fallbackEquipmentId);

  let label = '';
  if (model && inventoryNumber) label = `${model} · ${prefixedInventory(inventoryNumber)}`;
  else if (name && inventoryNumber) label = `${name} · ${prefixedInventory(inventoryNumber)}`;
  else if (inventoryNumber) label = prefixedInventory(inventoryNumber);
  else if (serialNumber) label = prefixedSerial(serialNumber);
  else if (equipmentId) label = equipmentId;

  const serialLabel = prefixedSerial(serialNumber);
  if (label && serialLabel && label !== serialLabel) return `${label} · ${serialLabel}`;
  return label || UNLINKED_EQUIPMENT_LABEL;
}

export function buildGsmEquipmentLookup(snapshots = [], devices = []) {
  const byEquipmentId = new Map();
  const byTrackerId = new Map();

  function rememberTracker(value, equipmentId) {
    const key = cleanText(value);
    const id = cleanText(equipmentId);
    if (key && id && !byTrackerId.has(key)) byTrackerId.set(key, id);
  }

  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const equipment = snapshot?.equipment;
    const equipmentId = cleanText(equipment?.id);
    if (!equipmentId) continue;
    byEquipmentId.set(equipmentId, equipment);
    rememberTracker(equipment?.gsmImei, equipmentId);
    rememberTracker(equipment?.gsmDeviceId, equipmentId);
    rememberTracker(equipment?.gsmTrackerId, equipmentId);
  }

  for (const device of Array.isArray(devices) ? devices : []) {
    const equipmentId = cleanText(device?.equipmentId);
    if (equipmentId && !byEquipmentId.has(equipmentId)) byEquipmentId.set(equipmentId, device);
    rememberTracker(device?.imei, equipmentId);
    rememberTracker(device?.deviceId, equipmentId);
    rememberTracker(device?.trackerId, equipmentId);
    rememberTracker(device?.id, equipmentId);
  }

  return { byEquipmentId, byTrackerId };
}

export function resolveGsmPacketEquipment(packet = {}, lookup = {}) {
  const packetEquipmentId = cleanText(packet.equipmentId);
  const trackerKey = cleanText(packet.imei) || cleanText(packet.deviceId) || cleanText(packet.trackerId);
  const equipmentId = packetEquipmentId || lookup.byTrackerId?.get(trackerKey) || '';
  const equipment = equipmentId ? lookup.byEquipmentId?.get(equipmentId) : null;
  const packetLabel = cleanText(packet.equipmentLabel);
  const linked = Boolean(equipmentId);
  const label = linked
    ? buildGsmEquipmentLabel(equipment || {
      equipmentName: packetLabel,
      equipmentId,
      manufacturer: packet.equipmentManufacturer,
      model: packet.equipmentModel,
      inventoryNumber: packet.equipmentInventoryNumber,
      serialNumber: packet.equipmentSerialNumber,
    }, equipmentId)
    : UNLINKED_EQUIPMENT_LABEL;

  return {
    linked,
    equipmentId: equipmentId || '',
    label,
    badge: linked ? 'Привязано' : trackerKey ? 'Неизвестный трекер' : 'Без привязки',
    trackerId: trackerKey,
  };
}

export function toGsmCoordinateNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function getGsmCoordinateStatus(latValue, lngValue) {
  const lat = toGsmCoordinateNumber(latValue);
  const lng = toGsmCoordinateNumber(lngValue);
  if (lat === null || lng === null) {
    return {
      status: 'missing',
      label: 'Координаты отсутствуют',
      warning: '',
      lat,
      lng,
      valid: false,
    };
  }
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    return {
      status: 'invalid',
      label: 'Координаты некорректны',
      warning: 'Координаты вне допустимого диапазона',
      lat,
      lng,
      valid: false,
    };
  }
  if ((lat === 0 && lng === 0) || (Math.abs(lat) < 1 && Math.abs(lng) < 1)) {
    return {
      status: 'suspicious',
      label: 'Координаты подозрительные',
      warning: 'Координаты выглядят тестовыми или некорректными',
      lat,
      lng,
      valid: true,
    };
  }
  return {
    status: 'real',
    label: 'Координаты реальные',
    warning: '',
    lat,
    lng,
    valid: true,
  };
}

export { UNLINKED_EQUIPMENT_LABEL };
