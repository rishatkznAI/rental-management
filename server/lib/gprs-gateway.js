const crypto = require('crypto');
const net = require('net');
const { bufferToReadableText, parsePacket: fallbackParsePacket } = require('./gsm/parsers');
const {
  applyEquipmentGsmConfigurationProjection,
  assertTrustedGsmConnectionBinding,
  assertTrustedGsmDeviceBindingCurrent,
  captureTrustedGsmDeviceBinding,
  ensureGsmDeviceBindingLifecycle,
  gsmCurrentDeviceBindingIssue,
  gsmDeviceBindingAtRevision,
  gsmDeviceBindingLifecycleIssue,
  gsmDeviceBindingRevision,
  gsmDeviceIdentityValues,
  gsmDeviceReservedIdentityValues,
  isActiveGsmDeviceRecord,
  resolveTrustedStoredGsmBinding,
} = require('./gsm/trusted-device-scope');
const {
  redactGsmSecretText,
  sanitizeGsmPacketForPersistence,
  sanitizeGsmRecordForRead,
  sanitizeTrustedGsmRecordForRead,
} = require('./gsm/secret-redaction');
const {
  GSM_INGRESS_MODE_HTTP_TOKEN,
  GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
  assertGsmDeviceIngressMode,
  assertGsmIngressCredential,
  assertGsmIngressSessionCredentialCurrent,
  fingerprintGsmIngressCredentialHash,
  gsmDeviceIngressMode,
} = require('./gsm/device-credential');
const {
  boundedPositiveInteger,
  createTcpIngressAdmissionController,
} = require('./gsm/tcp-ingress-admission');

const DEFAULT_GPRS_PORT = Number(process.env.GPRS_PORT || 5023);
const DEFAULT_GPRS_HOST = process.env.GPRS_HOST || '0.0.0.0';
const DEFAULT_GPRS_ENABLED = !['0', 'false', 'off', 'disabled'].includes(String(process.env.GPRS_ENABLED ?? process.env.GSM_ENABLED ?? '1').toLowerCase());
const DEFAULT_MAX_PACKET_BYTES = boundedPositiveInteger(
  process.env.GPRS_MAX_PACKET_BYTES,
  16 * 1024,
  { max: 1024 * 1024 },
);
const DEFAULT_MAX_PACKETS_PER_MINUTE = boundedPositiveInteger(
  process.env.GPRS_MAX_PACKETS_PER_MINUTE,
  120,
  { max: 100_000 },
);
const DEFAULT_CONNECTION_TIMEOUT_MS = boundedPositiveInteger(
  process.env.GPRS_CONNECTION_TIMEOUT_MS,
  120_000,
  { min: 100, max: 60 * 60_000 },
);
const DEFAULT_DEDUPE_WINDOW_MS = boundedPositiveInteger(
  process.env.GSM_DEDUPE_WINDOW_MS,
  5 * 60 * 1000,
  { max: 24 * 60 * 60_000 },
);
const MAX_PACKET_LOG = 1500;
const MAX_COMMAND_LOG = 600;
function resolveGsmMaxCommandBytes(value = process.env.GSM_MAX_COMMAND_BYTES) {
  return boundedPositiveInteger(value, 16 * 1024, { max: 16 * 1024 });
}

const MAX_COMMAND_TEXT_CHARS = 4096;
const MAX_HISTORY_POINTS = 240;
const ONLINE_WINDOW_MS = 15 * 60 * 1000;

function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function toText(value) {
  return String(value || '').trim();
}

// Transport parsers may include framing whitespace, but provisioned device
// identifiers remain otherwise byte-for-byte significant.
function normalizeIdentifier(value) {
  return toText(value);
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return false;
  return Number.isFinite(Number(value));
}

function hasUsableGsmCoordinates(latValue, lngValue) {
  if (!isFiniteNumber(latValue) || !isFiniteNumber(lngValue)) return false;
  const lat = Number(latValue);
  const lng = Number(lngValue);
  return Math.abs(lat) <= 90
    && Math.abs(lng) <= 180
    && !(lat === 0 && lng === 0);
}

function hasUsableGsmPacketLocation(packet = {}) {
  return Boolean(packet)
    && packet.parseStatus === 'parsed'
    && hasUsableGsmCoordinates(packet.lat, packet.lng);
}

function hasNonFutureGsmServerTime(packet = {}, nowMs = Date.now()) {
  const timestamp = Date.parse(packet?.receivedAt || packet?.createdAt || '');
  return Number.isFinite(timestamp) && nowMs - timestamp >= 0;
}

function normalizeRemoteAddress(value) {
  return String(value || '').replace(/^::ffff:/, '') || null;
}

const GPRS_INGRESS_SECRET_KEYS = new Set([
  'ingresssecret',
  'devicesecret',
  'secret',
  'password',
  'passwd',
  'token',
]);

function extractGprsIngressSecret(buffer, parsed = {}) {
  const visit = (value, depth = 0) => {
    if (!value || typeof value !== 'object' || depth > 3) return '';
    for (const [key, item] of Object.entries(value)) {
      const normalized = String(key || '').replace(/[^a-z0-9]/gi, '').toLowerCase();
      if (GPRS_INGRESS_SECRET_KEYS.has(normalized) && ['string', 'number'].includes(typeof item)) {
        return String(item);
      }
    }
    for (const item of Object.values(value)) {
      const nested = visit(item, depth + 1);
      if (nested) return nested;
    }
    return '';
  };
  const structured = visit(parsed?.parsed);
  if (structured) return structured;
  const rawText = bufferToReadableText(buffer) || '';
  const match = rawText.match(
    /(?:^|[\s,{;?&])(?:ingressSecret|deviceSecret|secret|password|passwd|token)\s*[:=]\s*["']?([^"'\s,;}&#]+)/i,
  );
  return match ? match[1] : '';
}

function normalizeParseResult(result = {}) {
  const status = ['pending', 'parsed', 'failed'].includes(result.parseStatus)
    ? result.parseStatus
    : 'pending';

  return {
    protocol: result.protocol || null,
    parseStatus: status,
    parseError: result.parseError || null,
    deviceId: normalizeIdentifier(result.deviceId) || null,
    imei: normalizeIdentifier(result.imei) || null,
    deviceTime: result.deviceTime || null,
    lat: toNumberOrNull(result.lat),
    lng: toNumberOrNull(result.lng),
    speed: toNumberOrNull(result.speed),
    course: toNumberOrNull(result.course),
    satellites: toNumberOrNull(result.satellites),
    gsmSignal: toNumberOrNull(result.gsmSignal),
    voltage: toNumberOrNull(result.voltage),
    motoHours: toNumberOrNull(result.motoHours),
    alarmType: toText(result.alarmType) || null,
    parsed: result.parsed && typeof result.parsed === 'object' ? result.parsed : null,
    ack: Buffer.isBuffer(result.ack) ? result.ack : null,
  };
}

function validateParsedTelemetry(parsed = {}) {
  const errors = [];
  const hasLat = parsed.lat !== null && parsed.lat !== undefined;
  const hasLng = parsed.lng !== null && parsed.lng !== undefined;
  if (hasLat !== hasLng) errors.push('coordinates_incomplete');
  if (hasLat && Math.abs(Number(parsed.lat)) > 90) errors.push('latitude_out_of_range');
  if (hasLng && Math.abs(Number(parsed.lng)) > 180) errors.push('longitude_out_of_range');
  return errors;
}

function commandStatusSummary(commands) {
  return commands.reduce((summary, command) => {
    const status = command.status || 'queued';
    summary.total += 1;
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, { total: 0, queued: 0, sent: 0, acknowledged: 0, failed: 0 });
}

function commandInputError(code, message, status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  error.statusCode = status;
  return error;
}

function assertGsmCommandInput(command, payload, maxCommandBytes = resolveGsmMaxCommandBytes()) {
  const safeCommand = toText(command);
  if (!safeCommand) throw commandInputError('GSM_COMMAND_REQUIRED', 'Команда не заполнена');
  if (safeCommand.length > MAX_COMMAND_TEXT_CHARS || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(safeCommand)) {
    throw commandInputError('GSM_COMMAND_INVALID', 'Команда содержит недопустимые символы или слишком длинная');
  }
  let serialized;
  try {
    serialized = JSON.stringify({ command: safeCommand, payload });
  } catch {
    throw commandInputError('GSM_COMMAND_PAYLOAD_INVALID', 'Payload команды должен быть JSON-совместимым');
  }
  if (Buffer.byteLength(serialized || '') > maxCommandBytes) {
    throw commandInputError(
      'GSM_COMMAND_PAYLOAD_TOO_LARGE',
      `Payload команды превышает ${maxCommandBytes} байт`,
      413,
    );
  }
  return safeCommand;
}

function assertGsmCommandTransportPayload(payload, encoding, maxCommandBytes = resolveGsmMaxCommandBytes()) {
  const raw = String(payload ?? '').trim();
  if (!raw) throw commandInputError('GSM_COMMAND_REQUIRED', 'Команда не заполнена');
  if (encoding === 'hex' && (!/^[0-9a-f]+$/i.test(raw) || raw.length % 2 !== 0)) {
    throw commandInputError(
      'GSM_COMMAND_HEX_INVALID',
      'HEX payload должен содержать непустое чётное количество шестнадцатеричных символов',
    );
  }
  const byteLength = encoding === 'hex'
    ? raw.length / 2
    : Buffer.byteLength(raw);
  if (byteLength > maxCommandBytes) {
    throw commandInputError(
      'GSM_COMMAND_PAYLOAD_TOO_LARGE',
      `Payload команды превышает ${maxCommandBytes} байт`,
      413,
    );
  }
  return raw;
}

function getPacketTime(packet) {
  return packet?.receivedAt || packet?.createdAt || null;
}

function isPacketRecent(packet, sinceMs, nowMs = Date.now()) {
  const time = Date.parse(getPacketTime(packet) || '');
  return Number.isFinite(time) && time >= sinceMs && time <= nowMs;
}

function protocolBreakdown(packets) {
  const map = new Map();
  for (const packet of packets) {
    const protocol = toText(packet.protocol) || 'raw';
    const current = map.get(protocol) || { protocol, count: 0, lastPacketAt: null };
    current.count += 1;
    const packetAt = getPacketTime(packet);
    if (!current.lastPacketAt || Date.parse(packetAt || '') > Date.parse(current.lastPacketAt || '')) {
      current.lastPacketAt = packetAt;
    }
    map.set(protocol, current);
  }
  return [...map.values()]
    .sort((left, right) => right.count - left.count || String(right.lastPacketAt || '').localeCompare(String(left.lastPacketAt || '')))
    .slice(0, 8);
}

function equipmentLabel(equipment) {
  if (!equipment) return null;
  const clean = value => String(value || '').trim();
  return [
    [clean(equipment.manufacturer), clean(equipment.model)].filter(Boolean).join(' '),
    clean(equipment.inventoryNumber) ? `INV ${clean(equipment.inventoryNumber)}` : '',
    clean(equipment.serialNumber) ? `SN ${clean(equipment.serialNumber)}` : '',
  ].filter(Boolean).join(' · ') || equipment.id || null;
}

function equipmentGsmFields(equipment) {
  if (!equipment) return {};
  const clean = value => {
    const text = String(value || '').trim();
    return text || null;
  };
  return {
    equipmentLabel: equipmentLabel(equipment),
    equipmentModel: clean(equipment.model),
    equipmentManufacturer: clean(equipment.manufacturer),
    equipmentInventoryNumber: clean(equipment.inventoryNumber),
    equipmentSerialNumber: clean(equipment.serialNumber),
  };
}

function compactHex(value, maxChars = 600) {
  const text = String(value || '');
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

function getPacketSummary(packet) {
  const parts = [];
  if (packet.imei || packet.deviceId) parts.push(`Устройство ${packet.imei || packet.deviceId}`);
  if (isFiniteNumber(packet.lat) && isFiniteNumber(packet.lng)) {
    parts.push(`Координаты ${Number(packet.lat).toFixed(5)}, ${Number(packet.lng).toFixed(5)}`);
  }
  if (isFiniteNumber(packet.speed)) parts.push(`Скорость ${Number(packet.speed)} км/ч`);
  if (packet.parseStatus === 'failed') parts.push('Ошибка разбора');
  return parts.join(' · ') || 'Сырой пакет принят';
}

function packetFingerprint(packet = {}) {
  const binding = [
    toText(packet.gsmDeviceRecordId) || 'no-device-record',
    Number.isInteger(Number(packet.gsmBindingRevision)) ? Number(packet.gsmBindingRevision) : 'no-binding-revision',
    toText(packet.equipmentId) || 'no-equipment',
  ].join('|');
  const identity = toText(packet.imei) || toText(packet.deviceId) || 'unknown';
  const deviceTime = toText(packet.deviceTime) || 'no-device-time';
  const lat = toNumberOrNull(packet.lat);
  const lng = toNumberOrNull(packet.lng);
  if (deviceTime !== 'no-device-time' && lat !== null && lng !== null) {
    return crypto
      .createHash('sha256')
      .update(`${binding}|${identity}|${deviceTime}|${lat.toFixed(6)}|${lng.toFixed(6)}`)
      .digest('hex');
  }
  const rawHex = toText(packet.rawHex || packet.payloadHex);
  return crypto
    .createHash('sha256')
    .update(`${binding}|${identity}|${deviceTime}|${rawHex}`)
    .digest('hex');
}

function createGprsGateway({
  readData,
  writeData,
  writeDataBatch,
  resolveTrustedDeviceScope,
  withActorScope,
  getCurrentScope,
  logger = console,
  host = DEFAULT_GPRS_HOST,
  port = DEFAULT_GPRS_PORT,
  enabled = DEFAULT_GPRS_ENABLED,
  parsePacket = fallbackParsePacket,
  maxPacketBytes = DEFAULT_MAX_PACKET_BYTES,
  maxPacketsPerMinute = DEFAULT_MAX_PACKETS_PER_MINUTE,
  connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS,
  dedupeWindowMs = DEFAULT_DEDUPE_WINDOW_MS,
  tcpAdmissionController = null,
  maxConnections,
  maxConnectionsPerIp,
  maxAuthAttemptsPerMinute,
  maxAuthAttemptsPerIpPerMinute,
  preAuthTimeoutMs,
} = {}) {
  if (typeof readData !== 'function' || typeof writeData !== 'function' || typeof writeDataBatch !== 'function') {
    throw new Error('GPRS gateway requires readData, writeData, and transactional writeDataBatch functions');
  }
  if (typeof resolveTrustedDeviceScope !== 'function' || typeof withActorScope !== 'function') {
    throw new Error('GPRS gateway requires trusted device scope resolution and scoped execution');
  }
  if (typeof getCurrentScope !== 'function') {
    throw new Error('GPRS gateway requires current tenant scope resolution');
  }

  const packetByteLimit = boundedPositiveInteger(
    maxPacketBytes,
    DEFAULT_MAX_PACKET_BYTES,
    { max: 1024 * 1024 },
  );
  const connectionPacketRateLimit = boundedPositiveInteger(
    maxPacketsPerMinute,
    DEFAULT_MAX_PACKETS_PER_MINUTE,
    { max: 100_000 },
  );
  const connectionIdleTimeoutMs = boundedPositiveInteger(
    connectionTimeoutMs,
    DEFAULT_CONNECTION_TIMEOUT_MS,
    { min: 100, max: 60 * 60_000 },
  );
  const packetDedupeWindowMs = boundedPositiveInteger(
    dedupeWindowMs,
    DEFAULT_DEDUPE_WINDOW_MS,
    { max: 24 * 60 * 60_000 },
  );
  const commandByteLimit = resolveGsmMaxCommandBytes();

  const connections = new Map();
  const admissionController = tcpAdmissionController || createTcpIngressAdmissionController({
    maxConnections,
    maxConnectionsPerIp,
    maxAuthAttemptsPerMinute,
    maxAuthAttemptsPerIpPerMinute,
    preAuthTimeoutMs,
  });
  const deviceToConnectionId = new Map();
  const stoppingServers = new WeakSet();
  let tcpServer = null;
  let startPromise = null;
  let cancelPendingStart = null;
  let cleanupTimer = null;
  let gatewayStartedAt = null;
  let startError = '';
  const packetsReceivedByScope = new Map();

  function scopeKey(scope) {
    const companyId = toText(scope?.companyId);
    const tenantId = toText(scope?.tenantId);
    return companyId && tenantId ? `${companyId}\u0000${tenantId}` : '';
  }

  function currentScope() {
    const scope = getCurrentScope();
    return scopeKey(scope) ? scope : null;
  }

  function scopeMatches(record, scope) {
    return Boolean(scope)
      && toText(record?.companyId) === toText(scope.companyId)
      && toText(record?.tenantId) === toText(scope.tenantId);
  }

  function visibleConnections() {
    const scope = currentScope();
    if (!scope) return [];
    return [...connections.values()].filter((connection) => {
      if (!scopeMatches(connection, scope)) return false;
      try {
        assertTrustedGsmDeviceBindingCurrent({
          readData: readScopedRecords,
          binding: {
            deviceRecordId: connection.gsmDeviceRecordId,
            equipmentId: connection.equipmentId,
            companyId: connection.companyId,
            tenantId: connection.tenantId,
            bindingRevision: connection.gsmBindingRevision,
          },
        });
        return true;
      } catch {
        return false;
      }
    });
  }

  function readScopedRecords(name) {
    const scope = currentScope();
    if (!scope) return [];
    return asArray(readData(name)).filter(record => scopeMatches(record, scope));
  }

  function trimCollection(name, maxItems) {
    const list = readScopedRecords(name);
    return list.slice(0, maxItems);
  }

  function preparePacketPersistence(packet) {
    const list = readScopedRecords('gsm_packets');
    const fingerprint = packetFingerprint(packet);
    const receivedMs = Date.parse(packet.receivedAt || packet.createdAt || '') || Date.now();
    const duplicate = list.find((item) => {
      const itemTime = Date.parse(item.receivedAt || item.createdAt || '');
      if (!Number.isFinite(itemTime) || Math.abs(receivedMs - itemTime) > packetDedupeWindowMs) return false;
      return (item.fingerprint || packetFingerprint(item)) === fingerprint;
    });
    if (duplicate) {
      if (packet.direction === 'inbound') {
        const key = scopeKey(packet);
        packetsReceivedByScope.set(key, (packetsReceivedByScope.get(key) || 0) + 1);
      }
      return {
        storedPacket: { ...duplicate, duplicate: true, duplicateOf: duplicate.id },
        nextPackets: null,
      };
    }
    packet.fingerprint = fingerprint;
    list.unshift(packet);
    return { storedPacket: packet, nextPackets: list.slice(0, MAX_PACKET_LOG) };
  }

  function recordPersistedInboundPacket(packet) {
    if (packet.direction !== 'inbound') return;
    const key = scopeKey(packet);
    packetsReceivedByScope.set(key, (packetsReceivedByScope.get(key) || 0) + 1);
  }

  function persistCommand(command) {
    const list = readScopedRecords('gsm_commands');
    const index = list.findIndex(item => item.id === command.id);
    if (index >= 0) {
      list[index] = command;
    } else {
      list.unshift(command);
    }
    writeData('gsm_commands', list.slice(0, MAX_COMMAND_LOG));
  }

  function trustedStoredGsmBinding(record = {}, { currentOnly = false } = {}) {
    return resolveTrustedStoredGsmBinding(record, {
      devices: readScopedRecords('gsm_devices'),
      equipment: readScopedRecords('equipment'),
      currentOnly,
    });
  }

  function packetMatchesEquipmentFilter(packet = {}, equipmentId = '') {
    if (!equipmentId) return true;
    const trusted = trustedStoredGsmBinding(packet);
    return Boolean(trusted && toText(trusted.binding.equipmentId) === toText(equipmentId));
  }

  function bindingIdentityValues(binding = {}) {
    return [...new Set([
      toText(binding.deviceId),
      toText(binding.imei),
      toText(binding.trackerId),
      ...asArray(binding.identities).map(toText),
    ].filter(Boolean))];
  }

  function updateGsmDeviceFromPacket(device, parsed, rawText, receivedAt, equipment) {
    const deviceRecordId = toText(device?.id);
    if (!deviceRecordId) throw new Error('Provisioned GSM device record ID is required');
    const devices = readScopedRecords('gsm_devices');
    const index = devices.findIndex(item => toText(item?.id) === deviceRecordId);
    if (index < 0) throw new Error('Provisioned GSM device is not visible in trusted tenant scope');
    const current = ensureGsmDeviceBindingLifecycle(devices[index], {
      at: receivedAt,
      reason: 'telemetry_binding_materialized',
    });
    const next = {
      ...current,
      equipmentId: equipment.id,
      companyId: equipment.companyId,
      tenantId: equipment.tenantId,
      equipmentLabel: equipmentLabel(equipment) || current.equipmentLabel || null,
      protocol: current.protocol || parsed.protocol || 'GPRS',
      status: 'online',
      lastPacketAt: receivedAt,
      lastOnlineAt: receivedAt,
      lastLatitude: toNumberOrNull(parsed.lat) ?? current.lastLatitude ?? null,
      lastLongitude: toNumberOrNull(parsed.lng) ?? current.lastLongitude ?? null,
      lastSpeed: toNumberOrNull(parsed.speed) ?? current.lastSpeed ?? null,
      lastCourse: toNumberOrNull(parsed.course) ?? current.lastCourse ?? null,
      lastSatellites: toNumberOrNull(parsed.satellites) ?? current.lastSatellites ?? null,
      lastVoltage: toNumberOrNull(parsed.voltage) ?? current.lastVoltage ?? null,
      lastRawPacket: rawText || current.lastRawPacket || null,
      equipmentMatchWarning: null,
      unlinked: false,
      updatedAt: receivedAt,
    };
    devices[index] = next;
    return devices;
  }

  function updateEquipmentFromPacket(equipmentId, parsed, receivedAt, device) {
    if (!equipmentId) return null;
    const equipmentList = readScopedRecords('equipment');
    const index = equipmentList.findIndex(item => item.id === equipmentId);
    if (index === -1) throw new Error('Linked equipment is not visible in trusted tenant scope');

    const current = equipmentList[index];
    const next = applyEquipmentGsmConfigurationProjection({
      ...current,
      gsmLastSeenAt: receivedAt,
      gsmLastSignalAt: receivedAt,
      gsmStatus: 'online',
      gsmSignalStatus: 'online',
    }, device);

    if (isFiniteNumber(parsed.lat) && isFiniteNumber(parsed.lng)) {
      next.gsmLastLat = Number(parsed.lat);
      next.gsmLastLng = Number(parsed.lng);
      next.gsmLatitude = Number(parsed.lat);
      next.gsmLongitude = Number(parsed.lng);
    }
    if (isFiniteNumber(parsed.speed)) {
      next.gsmLastSpeed = Number(parsed.speed);
      next.gsmSpeedKph = Number(parsed.speed);
    }
    if (isFiniteNumber(parsed.voltage)) {
      next.gsmLastVoltage = Number(parsed.voltage);
      next.gsmBatteryVoltage = Number(parsed.voltage);
    }
    if (isFiniteNumber(parsed.motoHours)) {
      next.gsmLastMotoHours = Number(parsed.motoHours);
      next.gsmHourmeter = Number(parsed.motoHours);
    }

    if (isFiniteNumber(parsed.lat) && isFiniteNumber(parsed.lng)) {
      const history = asArray(current.gsmMovementHistory).slice();
      const at = parsed.deviceTime || receivedAt;
      const dedupeKey = `${Number(parsed.lat).toFixed(5)}:${Number(parsed.lng).toFixed(5)}:${at.slice(0, 16)}`;
      const exists = history.some((item) => {
        if (!item) return false;
        return `${Number(item.lat).toFixed(5)}:${Number(item.lng).toFixed(5)}:${String(item.at || '').slice(0, 16)}` === dedupeKey;
      });
      if (!exists) {
        history.push({
          at,
          lat: Number(parsed.lat),
          lng: Number(parsed.lng),
          source: 'gps',
          address: next.gsmAddress || next.location || 'GPRS точка',
          speedKph: isFiniteNumber(parsed.speed) ? Number(parsed.speed) : undefined,
        });
      }
      next.gsmMovementHistory = history
        .sort((left, right) => Date.parse(left.at || '') - Date.parse(right.at || ''))
        .slice(-MAX_HISTORY_POINTS);
    }

    equipmentList[index] = next;
    return equipmentList;
  }

  function bindConnection(connection, parsed, resolution) {
    if (!connection) return;
    const { device, equipment, scope } = resolution;
    connection.deviceId = parsed.deviceId || connection.deviceId || null;
    connection.imei = parsed.imei || connection.imei || null;
    connection.gsmDeviceRecordId = device.id;
    connection.equipmentId = equipment.id;
    connection.equipmentLabel = equipmentLabel(equipment);
    connection.companyId = scope.companyId;
    connection.tenantId = scope.tenantId;
    connection.gsmBindingRevision = gsmDeviceBindingRevision(device);

    const deviceKey = parsed.deviceId || parsed.imei;
    if (deviceKey) deviceToConnectionId.set(deviceKey, connection.id);
  }

  function buildPacket({ connection, buffer, parsed, receivedAt, device, equipment, parseError = null, tooLarge = false }) {
    const sourceIp = connection?.sourceIp || connection?.remoteAddress || null;
    const rawHex = tooLarge
      ? buffer.subarray(0, packetByteLimit).toString('hex').toUpperCase()
      : buffer.toString('hex').toUpperCase();
    const rawText = tooLarge ? null : bufferToReadableText(buffer);
    const equipmentId = equipment?.id || connection?.equipmentId || null;
    const packet = {
      id: generateId('GPKT'),
      sourceIp,
      remotePort: connection?.remotePort || null,
      receivedAt,
      rawHex,
      rawText,
      protocol: parsed.protocol || null,
      parseStatus: parseError ? 'failed' : parsed.parseStatus,
      parseError,
      deviceId: parsed.deviceId || null,
      imei: parsed.imei || null,
      gsmDeviceRecordId: device?.id || null,
      gsmBindingRevision: device ? gsmDeviceBindingRevision(device) : null,
      equipmentId,
      deviceTime: parsed.deviceTime || null,
      lat: parsed.lat,
      lng: parsed.lng,
      speed: parsed.speed,
      course: parsed.course,
      satellites: parsed.satellites,
      gsmSignal: parsed.gsmSignal,
      voltage: parsed.voltage,
      motoHours: parsed.motoHours,
      alarmType: parsed.alarmType,
      parsed: parsed.parsed,
    };

    return sanitizeGsmPacketForPersistence({
      ...packet,
      direction: 'inbound',
      trackerId: packet.deviceId,
      equipmentLabel: equipmentLabel(equipment) || connection?.equipmentLabel || null,
      connectionId: connection?.id || null,
      remoteAddress: sourceIp,
      payload: rawText,
      payloadHex: rawHex,
      encoding: rawText ? 'text' : 'hex',
      summary: getPacketSummary(packet),
      parsedPayload: packet.parsed,
      ...equipmentGsmFields(equipment),
      companyId: equipment?.companyId || null,
      tenantId: equipment?.tenantId || null,
      createdAt: receivedAt,
      createdBy: 'Трекер',
    });
  }

  function processRawPacket(buffer, context = {}) {
    const sourceIp = normalizeRemoteAddress(context.sourceIp || context.remoteAddress || context.connection?.sourceIp || context.connection?.remoteAddress);
    const connection = context.connection || {
      id: context.connectionId || null,
      sourceIp,
      remoteAddress: sourceIp,
      remotePort: context.remotePort || null,
      equipmentId: null,
      equipmentLabel: null,
    };
    const receivedAt = nowIso();

    let parsed;
    let parseError = null;
    let tooLarge = false;

    if (!Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(buffer || '');
    }

    if (buffer.byteLength > packetByteLimit) {
      tooLarge = true;
      parseError = `packet_too_large: ${buffer.byteLength} bytes > ${packetByteLimit}`;
      parsed = normalizeParseResult({
        parseStatus: 'failed',
        parseError,
        parsed: { byteLength: buffer.byteLength, maxPacketBytes: packetByteLimit, truncated: true },
      });
    } else if (context.forceError) {
      parseError = String(context.forceError);
      parsed = normalizeParseResult({
        parseStatus: 'failed',
        parseError,
        parsed: { byteLength: buffer.byteLength },
      });
    } else {
      try {
        parsed = normalizeParseResult(parsePacket(buffer, {
          sourceIp,
          remotePort: connection.remotePort || null,
          receivedAt,
        }));
        parseError = parsed.parseError;
      } catch (error) {
        parseError = error instanceof Error ? error.message : 'Parser failed';
        parsed = normalizeParseResult({ parseStatus: 'failed', parseError });
      }
    }
    const validationErrors = validateParsedTelemetry(parsed);
    if (validationErrors.length > 0) {
      parseError = validationErrors.join(',');
      parsed = {
        ...parsed,
        parseStatus: 'failed',
        parseError,
      };
    }
    parsed.imei = parsed.imei || connection?.imei || null;
    parsed.deviceId = parsed.deviceId || connection?.deviceId || null;
    const resolution = resolveTrustedDeviceScope({ imei: parsed.imei, deviceId: parsed.deviceId });
    const authorizedBinding = captureTrustedGsmDeviceBinding(resolution);
    assertTrustedGsmConnectionBinding({ connection, resolution });
    const publicTcpIngress = Boolean(connection?.socket);
    const suppliedIngressSecret = publicTcpIngress && !connection.gsmAuthenticatedAt
      ? extractGprsIngressSecret(buffer, parsed)
      : '';

    return withActorScope(resolution.scope, () => {
      const liveResolution = assertTrustedGsmDeviceBindingCurrent({
        readData: readScopedRecords,
        binding: authorizedBinding,
      });
      const { device, equipment } = liveResolution;
      const attemptedIngressMode = context.ingressMode
        || (publicTcpIngress ? GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL : null);
      if (attemptedIngressMode) {
        assertGsmDeviceIngressMode(device, attemptedIngressMode);
      }
      if (publicTcpIngress) {
        if (connection.gsmAuthenticatedAt) {
          assertGsmIngressSessionCredentialCurrent({
            authenticatedAt: connection.gsmAuthenticatedAt,
            authenticatedCredentialFingerprint: connection.gsmIngressCredentialFingerprint,
            storedHash: device.ingressSecretHash,
            deviceRecordId: device.id,
          });
        } else {
          assertGsmIngressCredential({
            suppliedSecret: suppliedIngressSecret,
            storedHash: device.ingressSecretHash,
            deviceRecordId: device.id,
          });
        }
      }
      const packet = buildPacket({ connection, buffer, parsed, receivedAt, device, equipment, parseError, tooLarge });
      packet.equipmentMatchStrategy = 'gsm_devices.equipmentId';
      const { storedPacket, nextPackets } = preparePacketPersistence(packet);
      if (!storedPacket.duplicate) {
        const entries = [{ name: 'gsm_packets', value: nextPackets }];
        if (parsed.parseStatus === 'parsed') {
          const nextDevices = updateGsmDeviceFromPacket(
            device,
            parsed,
            packet.rawText || redactGsmSecretText(bufferToReadableText(buffer)),
            receivedAt,
            equipment,
          );
          const nextDevice = nextDevices.find(item => toText(item?.id) === toText(device.id));
          entries.push(
            { name: 'equipment', value: updateEquipmentFromPacket(equipment.id, parsed, receivedAt, nextDevice) },
            { name: 'gsm_devices', value: nextDevices },
          );
        }
        writeDataBatch(entries);
        recordPersistedInboundPacket(packet);
      }

      // Publish runtime connection state only after the scoped transaction has
      // committed (or the packet was safely identified as a duplicate).
      if (connection) {
        connection.lastSeenAt = receivedAt;
        connection.packetsReceived = (connection.packetsReceived || 0) + 1;
        connection.bytesReceived = (connection.bytesReceived || 0) + buffer.byteLength;
        if (publicTcpIngress && !connection.gsmAuthenticatedAt) {
          connection.gsmAuthenticatedAt = receivedAt;
          connection.gsmIngressCredentialFingerprint = fingerprintGsmIngressCredentialHash(device.ingressSecretHash);
        }
      }
      bindConnection(connection, parsed, liveResolution);

      if (parsed.ack && connection?.socket && !connection.socket.destroyed) {
        connection.socket.write(parsed.ack, (error) => {
          if (error) logger.warn('[GPRS] ACK write error:', error.message);
        });
      }

      return storedPacket;
    });
  }

  function findConnectionByIdentity(identity = {}) {
    const deviceKey = toText(identity.deviceId) || toText(identity.imei);
    if (!deviceKey) return null;
    const connectionId = deviceToConnectionId.get(deviceKey);
    const connection = connectionId ? connections.get(connectionId) || null : null;
    return connection && scopeMatches(connection, currentScope()) ? connection : null;
  }

  function cleanupStaleConnections() {
    const now = Date.now();
    for (const connection of connections.values()) {
      if (connection.closedAt) continue;
      const lastSeenAt = Date.parse(connection.lastSeenAt || connection.connectedAt || '');
      if (Number.isFinite(lastSeenAt) && now - lastSeenAt <= ONLINE_WINDOW_MS) continue;
      try {
        connection.socket.destroy();
      } catch (error) {
        logger.warn('[GPRS] Failed to close stale connection:', error?.message || error);
      }
    }
  }

  function start() {
    if (!enabled) {
      gatewayStartedAt = null;
      startError = '';
      logger.log(`[GPRS] Gateway disabled by GPRS_ENABLED=0, TCP ${host}:${port} is not listening`);
      return Promise.resolve(null);
    }
    if (startPromise) return startPromise;
    if (tcpServer?.listening) return Promise.resolve(tcpServer);
    tcpServer = null;

    const server = net.createServer((socket) => {
      const sourceIp = normalizeRemoteAddress(socket.remoteAddress);
      const admission = admissionController.admitConnection(sourceIp);
      if (!admission.ok) {
        logger.warn('[GPRS] TCP connection rejected by ingress admission', {
          sourceIp,
          code: admission.code,
        });
        socket.destroy();
        return;
      }
      const connection = {
        id: generateId('GCONN'),
        socket,
        sourceIp,
        remoteAddress: sourceIp,
        remotePort: socket.remotePort || null,
        connectedAt: nowIso(),
        disconnectedAt: null,
        closedAt: null,
        lastSeenAt: nowIso(),
        packetsReceived: 0,
        bytesReceived: 0,
        windowStartedAt: Date.now(),
        packetsInWindow: 0,
        bytesInWindow: 0,
        deviceId: null,
        imei: null,
        equipmentId: null,
        equipmentLabel: null,
        gsmDeviceRecordId: null,
        companyId: null,
        tenantId: null,
      };

      connections.set(connection.id, connection);
      const preAuthTimer = setTimeout(() => {
        if (connection.gsmAuthenticatedAt || socket.destroyed) return;
        logger.warn('[GPRS] TCP pre-authentication deadline exceeded', {
          sourceIp: connection.sourceIp,
          code: 'GSM_TCP_PREAUTH_TIMEOUT',
        });
        socket.destroy();
      }, admissionController.limits.preAuthTimeoutMs);
      preAuthTimer.unref?.();
      logger.log('[GPRS] Device connected', {
        sourceIp: connection.sourceIp,
        remotePort: connection.remotePort,
        connectedAt: connection.connectedAt,
      });

      socket.setTimeout(connectionIdleTimeoutMs, () => {
        logger.warn('[GPRS] Connection timeout', { sourceIp: connection.sourceIp, remotePort: connection.remotePort });
        socket.destroy();
      });

      socket.on('data', (buffer) => {
        const now = Date.now();
        if (now - connection.windowStartedAt >= 60_000) {
          connection.windowStartedAt = now;
          connection.packetsInWindow = 0;
          connection.bytesInWindow = 0;
        }
        connection.packetsInWindow += 1;
        connection.bytesInWindow += buffer.byteLength;

        if (connection.packetsInWindow > connectionPacketRateLimit) {
          logger.warn('[GPRS] Per-connection packet rate limit exceeded', {
            sourceIp: connection.sourceIp,
            code: 'GSM_TCP_CONNECTION_PACKET_RATE_LIMIT',
          });
          socket.destroy();
          return;
        }

        if (!connection.gsmAuthenticatedAt) {
          const authAdmission = admissionController.consumeAuthAttempt(connection.sourceIp);
          if (!authAdmission.ok) {
            logger.warn('[GPRS] TCP authentication rejected by ingress admission', {
              sourceIp: connection.sourceIp,
              code: authAdmission.code,
            });
            socket.destroy();
            return;
          }
        }

        const telemetryAdmission = admissionController.consumeTelemetry(connection.sourceIp, {
          byteLength: buffer.byteLength,
        });
        if (!telemetryAdmission.ok) {
          logger.warn('[GPRS] TCP telemetry rejected by shared ingress admission', {
            sourceIp: connection.sourceIp,
            code: telemetryAdmission.code,
          });
          socket.destroy();
          return;
        }

        try {
          processRawPacket(buffer, { connection });
          if (connection.gsmAuthenticatedAt) clearTimeout(preAuthTimer);
        } catch (error) {
          logger.warn('[GPRS] Incoming packet rejected:', {
            code: error.code || 'GSM_PACKET_REJECTED',
            message: error.message,
          });
            if (error.code?.startsWith('GSM_DEVICE_') || error.code?.startsWith('GSM_CONNECTION_')) {
              socket.destroy();
            }
        }
      });

      socket.on('error', (error) => {
        logger.warn('[GPRS] Socket error:', error.message);
      });

      socket.on('close', () => {
        clearTimeout(preAuthTimer);
        admission.release();
        connection.closedAt = nowIso();
        connection.disconnectedAt = connection.closedAt;
        logger.log('[GPRS] Device disconnected', {
          sourceIp: connection.sourceIp,
          remotePort: connection.remotePort,
          disconnectedAt: connection.disconnectedAt,
        });
        connections.delete(connection.id);
        for (const [deviceKey, connectionId] of deviceToConnectionId.entries()) {
          if (connectionId === connection.id) deviceToConnectionId.delete(deviceKey);
        }
      });
    });

    tcpServer = server;
    let startSettled = false;
    let resolveStart;
    let rejectStart;
    const pendingStart = new Promise((resolve, reject) => {
      resolveStart = resolve;
      rejectStart = reject;
    });
    startPromise = pendingStart;

    const failStart = (error) => {
      if (startSettled) return;
      startSettled = true;
      if (tcpServer === server) tcpServer = null;
      if (startPromise === pendingStart) startPromise = null;
      if (cancelPendingStart === failStart) cancelPendingStart = null;
      gatewayStartedAt = null;
      startError = error?.message || String(error);
      rejectStart(error);
    };
    cancelPendingStart = failStart;

    server.on('error', (error) => {
      if (stoppingServers.has(server)) {
        logger.warn('[GPRS] Gateway server error during shutdown:', error.message);
        return;
      }
      startError = error.message;
      gatewayStartedAt = null;
      logger.error(`[GPRS] Gateway server error on ${host}:${port}:`, error.message);
      if (!startSettled) {
        failStart(error);
      } else if (tcpServer === server && !server.listening) {
        tcpServer = null;
        startPromise = null;
      }
    });

    server.once('listening', () => {
      if (startSettled || tcpServer !== server) return;
      startSettled = true;
      if (startPromise === pendingStart) startPromise = null;
      if (cancelPendingStart === failStart) cancelPendingStart = null;
      gatewayStartedAt = nowIso();
      startError = '';
      const address = server.address();
      const listenPort = typeof address === 'object' && address ? address.port : port;
      logger.log(`[GPRS] Gateway listening on ${host}:${listenPort}`);
      cleanupTimer = setInterval(cleanupStaleConnections, 60_000);
      cleanupTimer.unref?.();
      resolveStart(server);
    });

    try {
      server.listen(port, host);
    } catch (error) {
      logger.error(`[GPRS] Gateway server error on ${host}:${port}:`, error.message);
      failStart(error);
    }
    return pendingStart;
  }

  async function stop() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
    for (const connection of connections.values()) {
      try {
        connection.socket.destroy();
      } catch (error) {
        logger.warn('[GPRS] Failed to close connection during shutdown:', error?.message || error);
      }
    }
    connections.clear();
    deviceToConnectionId.clear();
    const server = tcpServer;
    tcpServer = null;
    gatewayStartedAt = null;
    if (!server) return;
    stoppingServers.add(server);
    if (cancelPendingStart) {
      const cancellation = new Error('GPRS gateway startup was cancelled during shutdown.');
      cancellation.code = 'GPRS_GATEWAY_START_CANCELLED';
      cancelPendingStart(cancellation);
      startError = '';
    } else {
      startPromise = null;
    }
    await new Promise((resolve, reject) => {
      try {
        server.close((error) => {
          if (error && error.code !== 'ERR_SERVER_NOT_RUNNING') reject(error);
          else resolve();
        });
      } catch (error) {
        if (error?.code === 'ERR_SERVER_NOT_RUNNING') resolve();
        else reject(error);
      }
    });
  }

  function currentTcpPort() {
    const address = tcpServer?.address?.();
    if (typeof address === 'object' && address?.port) return address.port;
    return Number(port) || DEFAULT_GPRS_PORT;
  }

  function getStatus() {
    const packets = trimCollection('gsm_packets', MAX_PACKET_LOG);
    const commands = trimCollection('gsm_commands', MAX_COMMAND_LOG)
      .filter(item => trustedStoredGsmBinding(item, { currentOnly: true }));
    const scope = currentScope();
    const onlineConnections = visibleConnections().filter(item => !item.closedAt);
    const observedAtMs = Date.now();
    const todayStart = new Date(observedAtMs);
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const nonFuturePackets = packets.filter(packet => hasNonFutureGsmServerTime(packet, observedAtMs));
    const currentTrustedInboundPackets = nonFuturePackets.filter(packet => (
      packet.direction !== 'outbound'
      && trustedStoredGsmBinding(packet, { currentOnly: true })
    ));
    const lastPacketAt = currentTrustedInboundPackets
      .map(getPacketTime)
      .filter(Boolean)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
    const uptimeSeconds = gatewayStartedAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(gatewayStartedAt)) / 1000))
      : 0;

    return sanitizeGsmRecordForRead({
      gatewayEnabled: Boolean(enabled && gatewayStartedAt && !startError),
      tcpPort: currentTcpPort(),
      uptimeSeconds,
      connectionsActive: onlineConnections.length,
      packetsReceivedTotal: Math.max(
        packetsReceivedByScope.get(scopeKey(scope)) || 0,
        packets.filter(item => item.direction !== 'outbound').length,
      ),
      lastPacketAt,
      enabled: Boolean(enabled && gatewayStartedAt && !startError),
      disabled: !enabled,
      host,
      port: currentTcpPort(),
      startedAt: gatewayStartedAt,
      startError,
      ingressProtection: admissionController.getStatus(),
      transportLimits: {
        maxPacketBytes: packetByteLimit,
        maxPacketsPerConnectionPerMinute: connectionPacketRateLimit,
        connectionIdleTimeoutMs,
      },
      onlineConnections: onlineConnections.length,
      onlineDevices: new Set(onlineConnections.map(item => item.deviceId || item.imei).filter(Boolean)).size,
      packetsStored: packets.length,
      packetsToday: currentTrustedInboundPackets.filter(item => {
        const time = Date.parse(getPacketTime(item) || '');
        return Number.isFinite(time) && time >= todayStartMs;
      }).length,
      queuedCommands: commands.filter(item => item.status === 'queued').length,
      sentToday: commands.filter((item) => {
        const sentAt = Date.parse(item.sentAt || '');
        return Number.isFinite(sentAt) && sentAt >= todayStartMs && sentAt <= observedAtMs;
      }).length,
      failedCommands: commands.filter(item => item.status === 'failed').length,
    });
  }

  function listConnections() {
    return visibleConnections()
      .map(connection => sanitizeTrustedGsmRecordForRead({
        id: connection.id,
        deviceId: connection.deviceId || null,
        trackerId: connection.deviceId || null,
        imei: connection.imei || null,
        gsmDeviceRecordId: connection.gsmDeviceRecordId || null,
        gsmBindingRevision: Number(connection.gsmBindingRevision) || null,
        equipmentId: connection.equipmentId || null,
        equipmentLabel: connection.equipmentLabel || null,
        sourceIp: connection.sourceIp,
        remoteAddress: connection.remoteAddress,
        remotePort: connection.remotePort,
        connectedAt: connection.connectedAt,
        disconnectedAt: connection.disconnectedAt,
        lastSeenAt: connection.lastSeenAt,
        packetsReceived: connection.packetsReceived,
        bytesReceived: connection.bytesReceived,
        isOnline: !connection.closedAt,
      }))
      .sort((left, right) => Date.parse(right.lastSeenAt || '') - Date.parse(left.lastSeenAt || ''));
  }

  function matchesPacketFilters(packet, filters = {}) {
    const bindingFiltered = Boolean(filters.equipmentId || filters.imei || filters.deviceId);
    const trusted = bindingFiltered ? trustedStoredGsmBinding(packet) : null;
    if (bindingFiltered && !trusted) return false;
    if (filters.equipmentId && toText(trusted.binding.equipmentId) !== filters.equipmentId) return false;
    if (filters.imei && toText(trusted.binding.imei) !== filters.imei) return false;
    if (filters.deviceId && !bindingIdentityValues(trusted.binding).includes(filters.deviceId)) return false;
    if (filters.parseStatus && packet.parseStatus !== filters.parseStatus) return false;
    const time = Date.parse(getPacketTime(packet) || '');
    if (filters.from && Number.isFinite(time) && time < Date.parse(filters.from)) return false;
    if (filters.to && Number.isFinite(time) && time > Date.parse(filters.to)) return false;
    return true;
  }

  function listPackets(filters = {}) {
    const safeLimit = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
    const safeOffset = Math.max(Number(filters.offset) || 0, 0);
    return readScopedRecords('gsm_packets')
      .filter(item => matchesPacketFilters(item, {
        equipmentId: toText(filters.equipmentId),
        imei: toText(filters.imei),
        deviceId: toText(filters.deviceId),
        parseStatus: toText(filters.parseStatus),
        from: toText(filters.from),
        to: toText(filters.to),
      }))
      .sort((left, right) => Date.parse(getPacketTime(right) || '') - Date.parse(getPacketTime(left) || ''))
      .slice(safeOffset, safeOffset + safeLimit)
      .map(item => (
        trustedStoredGsmBinding(item)
          ? sanitizeTrustedGsmRecordForRead(item)
          : sanitizeGsmRecordForRead(item)
      ));
  }

  function listCommands({ limit = 50, offset = 0, equipmentId = '', deviceId = '' } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    const safeOffset = Math.max(Number(offset) || 0, 0);
    return readScopedRecords('gsm_commands')
      .filter((item) => {
        const trusted = trustedStoredGsmBinding(item);
        if (!trusted) return false;
        if (equipmentId && toText(trusted.binding.equipmentId) !== toText(equipmentId)) return false;
        if (deviceId && !bindingIdentityValues(trusted.binding).includes(toText(deviceId))) return false;
        return true;
      })
      .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''))
      .slice(safeOffset, safeOffset + safeLimit)
      .map((item) => {
        const bindingCurrent = Boolean(trustedStoredGsmBinding(item, { currentOnly: true }));
        return sanitizeTrustedGsmRecordForRead({
          ...item,
          bindingCurrent,
          effectiveStatus: item.status === 'queued' && !bindingCurrent ? 'superseded' : item.status,
        });
      });
  }

  function deriveEquipmentGsmStatus(equipment) {
    const explicit = equipment.gsmStatus;
    const lastSeenAt = equipment.gsmLastSeenAt || equipment.gsmLastSignalAt;
    const lastSeenMs = Date.parse(lastSeenAt || '');
    if (Number.isFinite(lastSeenMs)) {
      const ageMs = Date.now() - lastSeenMs;
      return ageMs >= 0 && ageMs <= ONLINE_WINDOW_MS ? 'online' : 'offline';
    }
    if (explicit === 'offline' || explicit === 'unknown') return explicit;
    return 'unknown';
  }

  function listDevices() {
    const onlineBindings = new Set(visibleConnections().map(item => (
      `${toText(item.gsmDeviceRecordId)}:${Number(item.gsmBindingRevision) || 0}`
    )));
    const equipment = readScopedRecords('equipment');
    const scopedDevices = readScopedRecords('gsm_devices');
    const provisionedDevices = [];
    for (const device of scopedDevices.filter(isActiveGsmDeviceRecord)) {
      if (gsmCurrentDeviceBindingIssue(device, { devices: scopedDevices, equipment })) continue;
      const linkedEquipmentId = toText(device.equipmentId);
      const item = equipment.find(eq => eq.id === linkedEquipmentId) || null;
      if (!linkedEquipmentId || !item) continue;
      const bindingRevision = gsmDeviceBindingRevision(device);
      const statusAt = device.lastOnlineAt || device.lastPacketAt || null;
      const statusAtMs = Date.parse(statusAt || '');
      const statusAgeMs = Number.isFinite(statusAtMs) ? Date.now() - statusAtMs : null;
      const status = onlineBindings.has(`${toText(device.id)}:${bindingRevision}`)
        || (statusAgeMs !== null && statusAgeMs >= 0 && statusAgeMs <= ONLINE_WINDOW_MS)
        ? 'online'
        : (Number.isFinite(statusAtMs) ? 'offline' : 'unknown');
      provisionedDevices.push(sanitizeTrustedGsmRecordForRead({
        id: device.id,
        equipmentId: linkedEquipmentId,
        equipmentName: equipmentLabel(item) || device.equipmentLabel || null,
        manufacturer: item.manufacturer || null,
        model: item.model || null,
        serialNumber: item.serialNumber || null,
        inventoryNumber: item.inventoryNumber || null,
        imei: device.imei || null,
        deviceId: device.deviceId || device.trackerId || device.imei || null,
        trackerId: device.trackerId || null,
        bindingRevision,
        ingressMode: gsmDeviceIngressMode(device),
        ingressCredentialConfigured: Boolean(device.ingressSecretHash),
        deviceType: device.deviceType || null,
        simNumber: device.sim1 || null,
        sim1: device.sim1 || null,
        oldServer: device.oldServer || null,
        targetServer: device.targetServer || null,
        protocol: device.protocol || null,
        status,
        lastSeenAt: statusAt,
        lastPacketAt: device.lastPacketAt || null,
        lastOnlineAt: device.lastOnlineAt || null,
        lastLat: toNumberOrNull(device.lastLatitude),
        lastLng: toNumberOrNull(device.lastLongitude),
        lastLatitude: toNumberOrNull(device.lastLatitude),
        lastLongitude: toNumberOrNull(device.lastLongitude),
        lastSpeed: toNumberOrNull(device.lastSpeed),
        lastCourse: toNumberOrNull(device.lastCourse),
        lastSatellites: toNumberOrNull(device.lastSatellites),
        lastVoltage: toNumberOrNull(device.lastVoltage),
        lastIgnition: typeof device.lastIgnition === 'boolean' ? device.lastIgnition : null,
        lastRawPacket: device.lastRawPacket || null,
        createdAt: device.createdAt || null,
        updatedAt: device.updatedAt || null,
      }));
    }

    return provisionedDevices
      .sort((left, right) => String(right.lastSeenAt || '').localeCompare(String(left.lastSeenAt || '')));
  }

  function listRoute({ equipmentId = '', from = '', to = '' } = {}) {
    const id = toText(equipmentId);
    if (!id) return [];
    return listPackets({ equipmentId: id, from, to, limit: 500 })
      .filter(packet => packet.direction !== 'outbound' && hasUsableGsmPacketLocation(packet) && hasNonFutureGsmServerTime(packet))
      .map(packet => ({
        receivedAt: packet.receivedAt || packet.createdAt,
        deviceTime: packet.deviceTime || null,
        lat: Number(packet.lat),
        lng: Number(packet.lng),
        speed: toNumberOrNull(packet.speed),
        course: toNumberOrNull(packet.course),
      }))
      .sort((left, right) => Date.parse(left.receivedAt || '') - Date.parse(right.receivedAt || ''));
  }

  function getAnalytics({ equipmentId = '', deviceId = '' } = {}) {
    const packets = trimCollection('gsm_packets', MAX_PACKET_LOG);
    const commands = trimCollection('gsm_commands', MAX_COMMAND_LOG)
      .filter(item => trustedStoredGsmBinding(item, { currentOnly: true }));
    const equipment = readScopedRecords('equipment');
    const observedAtMs = Date.now();
    const since24hMs = observedAtMs - 24 * 60 * 60 * 1000;
    const provisionedDevices = listDevices();
    const provisionedEquipmentIds = new Set(provisionedDevices.map(item => item.equipmentId).filter(Boolean));
    const configuredEquipment = equipment.filter(item => provisionedEquipmentIds.has(item.id));
    const onlineEquipmentIds = new Set(visibleConnections().map(item => item.equipmentId).filter(Boolean));
    const recentPackets = packets.filter(packet => isPacketRecent(packet, since24hMs, observedAtMs));
    const filteredPackets = listPackets({ equipmentId, deviceId, limit: 500 });
    const filteredCommands = listCommands({ equipmentId, deviceId, limit: 500 })
      .filter(item => item.bindingCurrent === true);
    const selectedRecentPackets = filteredPackets.filter(packet => isPacketRecent(packet, since24hMs, observedAtMs));
    const currentPackets = packets.filter(packet => (
      packet.direction !== 'outbound'
      && trustedStoredGsmBinding(packet, { currentOnly: true })
      && hasNonFutureGsmServerTime(packet, observedAtMs)
    ));
    const latestCurrentPacketByEquipmentId = new Map();
    for (const packet of currentPackets
      .sort((left, right) => Date.parse(getPacketTime(right) || '') - Date.parse(getPacketTime(left) || ''))) {
      if (!latestCurrentPacketByEquipmentId.has(packet.equipmentId)) {
        latestCurrentPacketByEquipmentId.set(packet.equipmentId, packet);
      }
    }
    const staleTrackers = configuredEquipment.filter((item) => {
      const signalAt = Date.parse(getPacketTime(latestCurrentPacketByEquipmentId.get(item.id)) || '');
      return !Number.isFinite(signalAt) || signalAt < since24hMs || signalAt > observedAtMs;
    });
    const lastPacket = filteredPackets.find(packet => hasNonFutureGsmServerTime(packet, observedAtMs)) || null;
    const lastCommand = filteredCommands[0] || null;

    const response = {
      trackedEquipment: equipment.length,
      configuredTrackers: configuredEquipment.length,
      onlineTrackedEquipment: configuredEquipment.filter((item) => {
        if (onlineEquipmentIds.has(item.id)) return true;
        const signalAt = Date.parse(getPacketTime(latestCurrentPacketByEquipmentId.get(item.id)) || '');
        return Number.isFinite(signalAt)
          && signalAt <= observedAtMs
          && observedAtMs - signalAt <= ONLINE_WINDOW_MS;
      }).length,
      staleTrackers: staleTrackers.length,
      unknownPackets24h: recentPackets.filter(packet => (
        packet.direction !== 'outbound' && !trustedStoredGsmBinding(packet)
      )).length,
      packets24h: recentPackets.length,
      inbound24h: recentPackets.filter(packet => packet.direction !== 'outbound').length,
      outbound24h: recentPackets.filter(packet => packet.direction === 'outbound').length,
      commandStatus: commandStatusSummary(commands),
      protocols: protocolBreakdown(recentPackets),
      selected: {
        equipmentId: equipmentId || null,
        deviceId: deviceId || null,
        packets24h: selectedRecentPackets.length,
        inbound24h: selectedRecentPackets.filter(packet => packet.direction !== 'outbound').length,
        outbound24h: selectedRecentPackets.filter(packet => packet.direction === 'outbound').length,
        lastPacketAt: lastPacket ? getPacketTime(lastPacket) : null,
        lastProtocol: lastPacket?.protocol || null,
        lastSummary: lastPacket?.summary || null,
        commandStatus: commandStatusSummary(filteredCommands),
        lastCommandAt: lastCommand?.createdAt || null,
        lastCommandStatus: lastCommand?.status || null,
      },
    };
    const selectedIdentityTrusted = Boolean((equipmentId || deviceId) && provisionedDevices.some(item => (
      (!equipmentId || toText(item.equipmentId) === toText(equipmentId))
      && (!deviceId || [item.deviceId, item.trackerId, item.imei].map(toText).includes(toText(deviceId)))
    )));
    response.selected = selectedIdentityTrusted
      ? sanitizeTrustedGsmRecordForRead(response.selected)
      : sanitizeGsmRecordForRead(response.selected);
    const sanitized = sanitizeGsmRecordForRead(response);
    sanitized.selected = response.selected;
    return sanitized;
  }

  function getDiagnostics() {
    const packets = trimCollection('gsm_packets', MAX_PACKET_LOG);
    const rawCommands = trimCollection('gsm_commands', MAX_COMMAND_LOG);
    const trustedCommands = rawCommands.filter(item => trustedStoredGsmBinding(item));
    const quarantinedCommands = rawCommands.filter(item => !trustedStoredGsmBinding(item));
    const devices = listDevices();
    const onlineDevices = devices.filter(item => item.status === 'online');
    const offlineDevices = devices.filter(item => item.status !== 'online');
    const inboundPackets = packets.filter(item => item.direction !== 'outbound');
    const unknownPackets = inboundPackets.filter(item => !trustedStoredGsmBinding(item));
    const packetsWithoutCoordinates = inboundPackets.filter(item => !isFiniteNumber(item.lat) || !isFiniteNumber(item.lng));
    const parseErrorPackets = inboundPackets.filter(item => item.parseStatus === 'failed' || item.parseError);
    const unknownDeviceIds = [...new Set(unknownPackets
      .map(item => toText(item.imei) || toText(item.deviceId) || toText(item.trackerId))
      .filter(Boolean))]
      .slice(0, 50);

    function sanitizeDiagnosticText(value, maxChars = 600) {
      const text = redactGsmSecretText(value);
      return text ? text.slice(0, maxChars) : null;
    }

    function sanitizePacket(item) {
      const hex = toText(item.rawHex || item.payloadHex);
      const sanitizer = trustedStoredGsmBinding(item)
        ? sanitizeTrustedGsmRecordForRead
        : sanitizeGsmRecordForRead;
      return sanitizer({
        id: item.id,
        receivedAt: item.receivedAt || item.createdAt || null,
        imei: item.imei || null,
        deviceId: item.deviceId || null,
        equipmentId: item.equipmentId || null,
        parseStatus: item.parseStatus || null,
        parseError: sanitizeDiagnosticText(item.parseError || null, 600),
        rawText: sanitizeDiagnosticText(item.rawText || item.payload || null, 600),
        rawHex: hex ? `[${Math.floor(hex.length / 2)} bytes]` : null,
      });
    }

    function sanitizeDevice(item) {
      return sanitizeTrustedGsmRecordForRead({
        ...item,
        lastRawPacket: sanitizeDiagnosticText(item.lastRawPacket || null, 600),
      });
    }

    const response = {
      totals: {
        packets: inboundPackets.length,
        commands: trustedCommands.length,
        quarantinedCommands: quarantinedCommands.length,
        devices: devices.length,
        onlineDevices: onlineDevices.length,
        offlineDevices: offlineDevices.length,
        unknownDevices: unknownDeviceIds.length,
        packetsWithoutCoordinates: packetsWithoutCoordinates.length,
        packetsWithoutLinkedEquipment: unknownPackets.length,
        parseErrors: parseErrorPackets.length,
      },
      lastPacket: inboundPackets[0] ? sanitizePacket(inboundPackets[0]) : null,
      onlineDevices: onlineDevices.slice(0, 50).map(sanitizeDevice),
      offlineDevices: offlineDevices.slice(0, 50).map(sanitizeDevice),
      unknownDeviceIds,
      packetsWithoutCoordinates: packetsWithoutCoordinates.slice(0, 50).map(sanitizePacket),
      packetsWithoutLinkedEquipment: unknownPackets.slice(0, 50).map(sanitizePacket),
      parseErrors: parseErrorPackets.slice(0, 50).map(sanitizePacket),
      latestRawPackets: inboundPackets.slice(0, 50).map(sanitizePacket),
    };
    const sanitized = sanitizeGsmRecordForRead(response);
    for (const key of [
      'lastPacket',
      'onlineDevices',
      'offlineDevices',
      'packetsWithoutCoordinates',
      'packetsWithoutLinkedEquipment',
      'parseErrors',
      'latestRawPackets',
    ]) sanitized[key] = response[key];
    return sanitized;
  }

  function createCommand({
    equipmentId = '',
    deviceId = '',
    command = '',
    payload = {},
    createdBy = 'Оператор',
    encoding = 'text',
    appendNewline = false,
  } = {}) {
    const safeEquipmentId = toText(equipmentId);
    const safePayload = payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {};
    const safeCommand = assertGsmCommandInput(command, safePayload, commandByteLimit);
    if (!safeEquipmentId) throw new Error('Укажите технику для команды');
    const scopedEquipment = readScopedRecords('equipment');
    const scopedDevices = readScopedRecords('gsm_devices');
    const equipment = scopedEquipment.find(item => item.id === safeEquipmentId) || null;
    if (!equipment) throw new Error('Техника не найдена');
    const provisionedDevices = scopedDevices
      .filter(device => isActiveGsmDeviceRecord(device) && toText(device.equipmentId) === safeEquipmentId);
    if (provisionedDevices.length === 0) {
      const error = new Error('Для техники не настроено активное GSM-устройство');
      error.code = 'GSM_COMMAND_DEVICE_NOT_PROVISIONED';
      error.status = 409;
      throw error;
    }
    if (provisionedDevices.length > 1) {
      const error = new Error('Для техники найдено несколько активных GSM-устройств');
      error.code = 'GSM_EQUIPMENT_DEVICE_AMBIGUOUS';
      error.status = 409;
      throw error;
    }
    const device = provisionedDevices[0];
    const gsmDeviceRecordId = toText(device.id);
    if (!gsmDeviceRecordId) {
      const error = new Error('Активная GSM-привязка не имеет стабильного record ID');
      error.code = 'GSM_DEVICE_RECORD_INVALID';
      error.status = 409;
      throw error;
    }
    const currentBindingIssue = gsmCurrentDeviceBindingIssue(device, {
      devices: scopedDevices,
      equipment: scopedEquipment,
    });
    if (currentBindingIssue) {
      const error = new Error('Активная GSM-привязка не прошла проверку lifecycle и проекции');
      error.code = 'GSM_DEVICE_PARENT_INVALID';
      error.status = 409;
      error.details = { currentBindingIssue };
      throw error;
    }
    const requestedDeviceId = toText(deviceId);
    if (requestedDeviceId && !gsmDeviceIdentityValues(device).includes(requestedDeviceId)) {
      const error = new Error('Указанное GSM-устройство не привязано к выбранной технике');
      error.code = 'GSM_COMMAND_DEVICE_MISMATCH';
      error.status = 409;
      throw error;
    }

    const item = {
      id: generateId('GCMD'),
      equipmentId: safeEquipmentId,
      gsmDeviceRecordId,
      gsmBindingRevision: gsmDeviceBindingRevision(device),
      companyId: equipment.companyId || null,
      tenantId: equipment.tenantId || null,
      equipmentLabel: equipmentLabel(equipment),
      imei: device.imei || null,
      deviceId: device.deviceId || device.trackerId || device.imei || null,
      command: safeCommand,
      payload: safePayload,
      status: 'queued',
      createdAt: nowIso(),
      sentAt: null,
      ackAt: null,
      error: null,
      createdBy,
      encoding,
      appendNewline: Boolean(appendNewline),
      connectionId: null,
      remoteAddress: null,
      remotePort: null,
    };
    persistCommand(item);
    return item;
  }

  async function sendCommand({ equipmentId = '', deviceId = '', payload = '', encoding = 'text', appendNewline = true, createdBy = 'Оператор' }) {
    if (!['text', 'hex'].includes(encoding)) {
      throw commandInputError('GSM_COMMAND_ENCODING_INVALID', 'encoding должен быть text или hex');
    }
    const transportPayload = assertGsmCommandTransportPayload(payload, encoding, commandByteLimit);
    const command = createCommand({
      equipmentId,
      deviceId,
      command: transportPayload,
      payload: {
        raw: transportPayload,
        deviceId: toText(deviceId) || undefined,
        encoding: encoding === 'hex' ? 'hex' : 'text',
        appendNewline: Boolean(appendNewline),
      },
      createdBy,
      encoding,
      appendNewline,
    });

    const connection = visibleConnections().find(item => (
      toText(item.gsmDeviceRecordId) === toText(command.gsmDeviceRecordId)
    )) || null;
    if (!connection || !connection.socket || connection.socket.destroyed) return command;

    // First stage keeps commands queued by default; concrete protocol senders can opt in later.
    return command;
  }

  return {
    start,
    stop,
    getStatus,
    listConnections,
    listPackets,
    listCommands,
    listDevices,
    listRoute,
    getAnalytics,
    getDiagnostics,
    processRawPacket,
    createCommand,
    sendCommand,
  };
}

module.exports = {
  createGprsGateway,
  hasNonFutureGsmServerTime,
  hasUsableGsmCoordinates,
  hasUsableGsmPacketLocation,
  resolveGsmMaxCommandBytes,
};
