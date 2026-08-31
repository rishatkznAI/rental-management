export const GSM_ONLINE_WINDOW_MS = 15 * 60 * 1000;

function validTime(value) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function meaningfulText(value) {
  return String(value ?? '').trim();
}

function meaningfulStatus(value) {
  const status = meaningfulText(value).toLowerCase();
  return Boolean(status && status !== 'unknown');
}

export function isGsmTimestampWithinWindow(
  value,
  { nowMs = Date.now(), windowMs = Number.POSITIVE_INFINITY } = {},
) {
  const timestamp = validTime(value);
  if (timestamp === null) return false;
  const ageMs = nowMs - timestamp;
  return ageMs >= 0 && ageMs <= windowMs;
}

export function hasUsableGsmCoordinates(latValue, lngValue) {
  if (latValue === null || latValue === undefined || latValue === '') return false;
  if (lngValue === null || lngValue === undefined || lngValue === '') return false;
  const lat = Number(latValue);
  const lng = Number(lngValue);
  return Number.isFinite(lat)
    && Number.isFinite(lng)
    && Math.abs(lat) <= 90
    && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0);
}

export function hasUsableGsmPacketCoordinates(packet = {}) {
  return packet.parseStatus === 'parsed'
    && hasUsableGsmCoordinates(packet.lat, packet.lng);
}

function packetServerTime(packet = {}) {
  return validTime(packet?.receivedAt || packet?.createdAt);
}

function selectLatestPacket(packets, predicate, nowMs) {
  return (Array.isArray(packets) ? packets : [])
    .filter((packet) => {
      const timestamp = packetServerTime(packet);
      return packet?.direction !== 'outbound'
        && timestamp !== null
        && timestamp <= nowMs
        && predicate(packet);
    })
    .sort((left, right) => packetServerTime(right) - packetServerTime(left))[0] || null;
}

export function selectLatestNonFutureGsmPacket(packets = [], { nowMs = Date.now() } = {}) {
  return selectLatestPacket(packets, () => true, nowMs);
}

export function selectLatestParsedGsmPacket(packets = [], { nowMs = Date.now() } = {}) {
  return selectLatestPacket(packets, packet => packet?.parseStatus === 'parsed', nowMs);
}

export function selectLatestGsmLocationPacket(packets = [], { nowMs = Date.now() } = {}) {
  return selectLatestPacket(packets, hasUsableGsmPacketCoordinates, nowMs);
}

export function hasMeaningfulEquipmentGsmData(equipment = {}) {
  const stableConfiguration = [
    equipment.gsmDeviceRecordId,
    equipment.gsmImei,
    equipment.gsmDeviceId,
    equipment.gsmTrackerId,
    equipment.gsmSimNumber,
    equipment.gsmProtocol,
  ].some(value => Boolean(meaningfulText(value)));
  const timestamps = [equipment.gsmLastSeenAt, equipment.gsmLastSignalAt]
    .some(value => validTime(value) !== null);
  const numericTelemetry = [
    equipment.gsmLastLat,
    equipment.gsmLastLng,
    equipment.gsmLatitude,
    equipment.gsmLongitude,
    equipment.gsmLastSpeed,
    equipment.gsmSpeedKph,
    equipment.gsmLastVoltage,
    equipment.gsmBatteryVoltage,
    equipment.gsmLastMotoHours,
    equipment.gsmHourmeter,
  ].some(value => value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value)));
  const otherTelemetry = equipment.gsmIgnitionOn === true
    || equipment.gsmIgnitionOn === false
    || Boolean(meaningfulText(equipment.gsmAddress))
    || (Array.isArray(equipment.gsmMovementHistory) && equipment.gsmMovementHistory.length > 0);

  return stableConfiguration
    || meaningfulStatus(equipment.gsmStatus)
    || meaningfulStatus(equipment.gsmSignalStatus)
    || timestamps
    || numericTelemetry
    || otherTelemetry;
}

export function hasVerifiedGsmDeviceForEquipment(device = null, equipmentId = '') {
  const deviceRecordId = meaningfulText(device?.id);
  const linkedEquipmentId = meaningfulText(device?.equipmentId);
  const expectedEquipmentId = meaningfulText(equipmentId);
  const revision = Number(device?.bindingRevision);
  return Boolean(
    deviceRecordId
    && expectedEquipmentId
    && linkedEquipmentId === expectedEquipmentId
    && Number.isInteger(revision)
    && revision > 0
  );
}

export function deriveEquipmentGsmSignalState(
  equipment = {},
  lastSeenAt = null,
  { nowMs = Date.now(), onlineWindowMs = GSM_ONLINE_WINDOW_MS } = {},
) {
  const telemetryTimes = [equipment.gsmLastSeenAt, equipment.gsmLastSignalAt]
    .map(validTime)
    .filter(value => value !== null);
  if (telemetryTimes.length > 0) {
    const latestTelemetryAt = Math.max(...telemetryTimes);
    const ageMs = nowMs - latestTelemetryAt;
    return ageMs >= 0 && ageMs <= onlineWindowMs ? 'online' : 'offline';
  }

  if (equipment.gsmStatus === 'offline') return 'offline';
  if (equipment.gsmSignalStatus === 'offline') return 'offline';
  if (equipment.gsmSignalStatus === 'location_only') return 'location_only';
  return validTime(lastSeenAt) !== null ? 'location_only' : 'offline';
}

export function getEquipmentGsmSaleValue(equipment = {}, options = {}) {
  if (!hasMeaningfulEquipmentGsmData(equipment)) return 'Не указано';
  if (equipment.gsmBindingVerified !== true) return 'Непроверенные данные';
  const signalState = deriveEquipmentGsmSignalState(
    equipment,
    equipment.gsmLastSeenAt || equipment.gsmLastSignalAt || null,
    options,
  );
  const statusLabel = signalState === 'online'
    ? 'Онлайн'
    : signalState === 'location_only'
    ? 'Только координаты'
    : signalState === 'offline'
    ? 'Офлайн'
    : 'Неизвестно';
  const identifier = equipment.gsmImei || equipment.gsmDeviceId || equipment.gsmTrackerId;
  return [identifier ? `IMEI/ID ${identifier}` : '', statusLabel].filter(Boolean).join(' · ');
}

export function deriveGsmPacketSignalState(
  packet = {},
  { nowMs = Date.now(), onlineWindowMs = GSM_ONLINE_WINDOW_MS } = {},
) {
  return isGsmTimestampWithinWindow(packet.receivedAt || packet.createdAt, {
    nowMs,
    windowMs: onlineWindowMs,
  }) ? 'online' : 'offline';
}
