const crypto = require('crypto');
const net = require('net');
const { bufferToReadableText, parsePacket: fallbackParsePacket } = require('./gsm/parsers');

const DEFAULT_GPRS_PORT = Number(process.env.GPRS_PORT || 5023);
const DEFAULT_GPRS_HOST = process.env.GPRS_HOST || '0.0.0.0';
const DEFAULT_MAX_PACKET_BYTES = Number(process.env.GPRS_MAX_PACKET_BYTES || 16 * 1024);
const DEFAULT_MAX_PACKETS_PER_MINUTE = Number(process.env.GPRS_MAX_PACKETS_PER_MINUTE || 120);
const DEFAULT_CONNECTION_TIMEOUT_MS = Number(process.env.GPRS_CONNECTION_TIMEOUT_MS || 120_000);
const MAX_PACKET_LOG = 1500;
const MAX_COMMAND_LOG = 600;
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

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function isFiniteNumber(value) {
  return Number.isFinite(Number(value));
}

function normalizeRemoteAddress(value) {
  return String(value || '').replace(/^::ffff:/, '') || null;
}

function normalizeParseResult(result = {}) {
  const status = ['pending', 'parsed', 'failed'].includes(result.parseStatus)
    ? result.parseStatus
    : 'pending';

  return {
    protocol: result.protocol || null,
    parseStatus: status,
    parseError: result.parseError || null,
    deviceId: toText(result.deviceId) || null,
    imei: toText(result.imei) || null,
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

function commandStatusSummary(commands) {
  return commands.reduce((summary, command) => {
    const status = command.status || 'queued';
    summary.total += 1;
    summary[status] = (summary[status] || 0) + 1;
    return summary;
  }, { total: 0, queued: 0, sent: 0, acknowledged: 0, failed: 0 });
}

function getPacketTime(packet) {
  return packet?.receivedAt || packet?.createdAt || null;
}

function isPacketRecent(packet, sinceMs) {
  const time = Date.parse(getPacketTime(packet) || '');
  return Number.isFinite(time) && time >= sinceMs;
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
  return [
    equipment.manufacturer,
    equipment.model,
    equipment.inventoryNumber ? `INV ${equipment.inventoryNumber}` : '',
  ].filter(Boolean).join(' · ') || equipment.id || null;
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

function createGprsGateway({
  readData,
  writeData,
  logger = console,
  host = DEFAULT_GPRS_HOST,
  port = DEFAULT_GPRS_PORT,
  parsePacket = fallbackParsePacket,
  maxPacketBytes = DEFAULT_MAX_PACKET_BYTES,
  maxPacketsPerMinute = DEFAULT_MAX_PACKETS_PER_MINUTE,
  connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS,
} = {}) {
  if (typeof readData !== 'function' || typeof writeData !== 'function') {
    throw new Error('GPRS gateway requires readData and writeData functions');
  }

  const connections = new Map();
  const deviceToConnectionId = new Map();
  let tcpServer = null;
  let cleanupTimer = null;
  let gatewayStartedAt = null;
  let startError = '';
  let packetsReceivedTotal = 0;

  function ensureStorage() {
    if (!Array.isArray(readData('gsm_packets'))) writeData('gsm_packets', []);
    if (!Array.isArray(readData('gsm_commands'))) writeData('gsm_commands', []);
  }

  function trimCollection(name, maxItems) {
    const list = asArray(readData(name));
    if (list.length <= maxItems) return list;
    const nextList = list.slice(0, maxItems);
    writeData(name, nextList);
    return nextList;
  }

  function persistPacket(packet) {
    ensureStorage();
    const list = asArray(readData('gsm_packets'));
    list.unshift(packet);
    writeData('gsm_packets', list.slice(0, MAX_PACKET_LOG));
    if (packet.direction === 'inbound') packetsReceivedTotal += 1;
  }

  function persistCommand(command) {
    ensureStorage();
    const list = asArray(readData('gsm_commands'));
    const index = list.findIndex(item => item.id === command.id);
    if (index >= 0) {
      list[index] = command;
    } else {
      list.unshift(command);
    }
    writeData('gsm_commands', list.slice(0, MAX_COMMAND_LOG));
  }

  function resolveEquipmentByIdentity(identity = {}) {
    const imei = toText(identity.imei);
    const deviceId = toText(identity.deviceId);
    if (!imei && !deviceId) return null;

    return asArray(readData('equipment')).find((item) => {
      const itemImei = toText(item.gsmImei);
      const itemDeviceId = toText(item.gsmDeviceId);
      const legacyTrackerId = toText(item.gsmTrackerId);
      return Boolean(
        (imei && itemImei && imei === itemImei)
        || (deviceId && itemDeviceId && deviceId === itemDeviceId)
        || (deviceId && legacyTrackerId && deviceId === legacyTrackerId),
      );
    }) || null;
  }

  function updateEquipmentFromPacket(equipmentId, parsed, receivedAt) {
    if (!equipmentId) return;
    const equipmentList = asArray(readData('equipment'));
    const index = equipmentList.findIndex(item => item.id === equipmentId);
    if (index === -1) return;

    const current = equipmentList[index];
    const next = {
      ...current,
      gsmLastSeenAt: receivedAt,
      gsmLastSignalAt: receivedAt,
      gsmStatus: 'online',
      gsmSignalStatus: 'online',
    };

    if (parsed.imei && !toText(next.gsmImei)) next.gsmImei = parsed.imei;
    if (parsed.deviceId && !toText(next.gsmDeviceId)) next.gsmDeviceId = parsed.deviceId;
    if (parsed.protocol) next.gsmProtocol = parsed.protocol;

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
    writeData('equipment', equipmentList);
  }

  function bindConnection(connection, parsed, equipment) {
    if (!connection) return;
    connection.deviceId = parsed.deviceId || connection.deviceId || null;
    connection.imei = parsed.imei || connection.imei || null;
    if (equipment) {
      connection.equipmentId = equipment.id;
      connection.equipmentLabel = equipmentLabel(equipment);
    }

    const deviceKey = parsed.deviceId || parsed.imei;
    if (deviceKey) deviceToConnectionId.set(deviceKey, connection.id);
  }

  function buildPacket({ connection, buffer, parsed, receivedAt, equipment, parseError = null, tooLarge = false }) {
    const sourceIp = connection?.sourceIp || connection?.remoteAddress || null;
    const rawHex = tooLarge
      ? buffer.subarray(0, Math.max(0, maxPacketBytes)).toString('hex').toUpperCase()
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

    return {
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
      createdAt: receivedAt,
      createdBy: 'Трекер',
    };
  }

  function processRawPacket(buffer, context = {}) {
    ensureStorage();
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

    if (connection) {
      connection.lastSeenAt = receivedAt;
      connection.packetsReceived = (connection.packetsReceived || 0) + 1;
      connection.bytesReceived = (connection.bytesReceived || 0) + buffer.byteLength;
    }

    let parsed;
    let parseError = null;
    let tooLarge = false;

    if (!Buffer.isBuffer(buffer)) {
      buffer = Buffer.from(buffer || '');
    }

    if (buffer.byteLength > maxPacketBytes) {
      tooLarge = true;
      parseError = `packet_too_large: ${buffer.byteLength} bytes > ${maxPacketBytes}`;
      parsed = normalizeParseResult({
        parseStatus: 'failed',
        parseError,
        parsed: { byteLength: buffer.byteLength, maxPacketBytes, truncated: true },
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

    const equipment = resolveEquipmentByIdentity(parsed);
    bindConnection(connection, parsed, equipment);
    updateEquipmentFromPacket(equipment?.id || null, parsed, receivedAt);

    const packet = buildPacket({ connection, buffer, parsed, receivedAt, equipment, parseError, tooLarge });
    persistPacket(packet);

    if (parsed.ack && connection?.socket && !connection.socket.destroyed) {
      connection.socket.write(parsed.ack, (error) => {
        if (error) logger.warn('[GPRS] ACK write error:', error.message);
      });
    }

    return packet;
  }

  function findConnectionByIdentity(identity = {}) {
    const deviceKey = toText(identity.deviceId) || toText(identity.imei);
    if (!deviceKey) return null;
    const connectionId = deviceToConnectionId.get(deviceKey);
    return connectionId ? connections.get(connectionId) || null : null;
  }

  function cleanupStaleConnections() {
    const now = Date.now();
    for (const connection of connections.values()) {
      if (connection.closedAt) continue;
      const lastSeenAt = Date.parse(connection.lastSeenAt || connection.connectedAt || '');
      if (Number.isFinite(lastSeenAt) && now - lastSeenAt <= ONLINE_WINDOW_MS) continue;
      try {
        connection.socket.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
  }

  function start() {
    ensureStorage();
    if (tcpServer) return tcpServer;

    tcpServer = net.createServer((socket) => {
      const sourceIp = normalizeRemoteAddress(socket.remoteAddress);
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
      };

      connections.set(connection.id, connection);
      logger.log('[GPRS] Device connected', {
        sourceIp: connection.sourceIp,
        remotePort: connection.remotePort,
        connectedAt: connection.connectedAt,
      });

      socket.setTimeout(connectionTimeoutMs, () => {
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

        if (connection.packetsInWindow > maxPacketsPerMinute) {
          processRawPacket(buffer, { connection, forceError: 'rate_limit_exceeded' });
          socket.destroy();
          return;
        }

        try {
          processRawPacket(buffer, { connection });
        } catch (error) {
          logger.error('[GPRS] Incoming packet error:', error.message);
          try {
            processRawPacket(buffer, { connection, forceError: error.message });
          } catch {
            // The gateway must never crash the backend because of a tracker packet.
          }
        }
      });

      socket.on('error', (error) => {
        logger.warn('[GPRS] Socket error:', error.message);
      });

      socket.on('close', () => {
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

    tcpServer.on('error', (error) => {
      startError = error.message;
      logger.error('[GPRS] Gateway server error:', error.message);
    });

    tcpServer.listen(port, host, () => {
      gatewayStartedAt = nowIso();
      startError = '';
      const address = tcpServer.address();
      const listenPort = typeof address === 'object' && address ? address.port : port;
      logger.log(`[GPRS] Gateway listening on ${host}:${listenPort}`);
    });

    cleanupTimer = setInterval(cleanupStaleConnections, 60_000);
    cleanupTimer.unref?.();
    return tcpServer;
  }

  function stop() {
    if (cleanupTimer) {
      clearInterval(cleanupTimer);
      cleanupTimer = null;
    }
    for (const connection of connections.values()) {
      try {
        connection.socket.destroy();
      } catch {
        // ignore cleanup errors
      }
    }
    connections.clear();
    deviceToConnectionId.clear();
    if (!tcpServer) return Promise.resolve();
    const server = tcpServer;
    tcpServer = null;
    return new Promise((resolve) => {
      server.close(() => resolve());
    });
  }

  function currentTcpPort() {
    const address = tcpServer?.address?.();
    if (typeof address === 'object' && address?.port) return address.port;
    return Number(port) || DEFAULT_GPRS_PORT;
  }

  function getStatus() {
    ensureStorage();
    const packets = trimCollection('gsm_packets', MAX_PACKET_LOG);
    const commands = trimCollection('gsm_commands', MAX_COMMAND_LOG);
    const onlineConnections = [...connections.values()].filter(item => !item.closedAt);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const lastPacketAt = packets[0] ? getPacketTime(packets[0]) : null;
    const uptimeSeconds = gatewayStartedAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(gatewayStartedAt)) / 1000))
      : 0;

    return {
      gatewayEnabled: !startError,
      tcpPort: currentTcpPort(),
      uptimeSeconds,
      connectionsActive: onlineConnections.length,
      packetsReceivedTotal: Math.max(packetsReceivedTotal, packets.filter(item => item.direction !== 'outbound').length),
      lastPacketAt,
      enabled: !startError,
      host,
      port: currentTcpPort(),
      startedAt: gatewayStartedAt,
      startError,
      onlineConnections: onlineConnections.length,
      onlineDevices: new Set(onlineConnections.map(item => item.deviceId || item.imei).filter(Boolean)).size,
      packetsStored: packets.length,
      packetsToday: packets.filter(item => {
        const time = Date.parse(getPacketTime(item) || '');
        return Number.isFinite(time) && time >= todayStartMs;
      }).length,
      queuedCommands: commands.filter(item => item.status === 'queued').length,
      sentToday: commands.filter(item => item.sentAt && Date.parse(item.sentAt) >= todayStartMs).length,
      failedCommands: commands.filter(item => item.status === 'failed').length,
    };
  }

  function listConnections() {
    return [...connections.values()]
      .map(connection => ({
        id: connection.id,
        deviceId: connection.deviceId || null,
        trackerId: connection.deviceId || null,
        imei: connection.imei || null,
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
    if (filters.equipmentId && packet.equipmentId !== filters.equipmentId) return false;
    if (filters.imei && packet.imei !== filters.imei) return false;
    if (filters.deviceId && ![packet.deviceId, packet.trackerId, packet.imei].filter(Boolean).includes(filters.deviceId)) return false;
    if (filters.parseStatus && packet.parseStatus !== filters.parseStatus) return false;
    const time = Date.parse(getPacketTime(packet) || '');
    if (filters.from && Number.isFinite(time) && time < Date.parse(filters.from)) return false;
    if (filters.to && Number.isFinite(time) && time > Date.parse(filters.to)) return false;
    return true;
  }

  function listPackets(filters = {}) {
    ensureStorage();
    const safeLimit = Math.min(Math.max(Number(filters.limit) || 50, 1), 500);
    const safeOffset = Math.max(Number(filters.offset) || 0, 0);
    return asArray(readData('gsm_packets'))
      .filter(item => matchesPacketFilters(item, {
        equipmentId: toText(filters.equipmentId),
        imei: toText(filters.imei),
        deviceId: toText(filters.deviceId),
        parseStatus: toText(filters.parseStatus),
        from: toText(filters.from),
        to: toText(filters.to),
      }))
      .sort((left, right) => Date.parse(getPacketTime(right) || '') - Date.parse(getPacketTime(left) || ''))
      .slice(safeOffset, safeOffset + safeLimit);
  }

  function listCommands({ limit = 50, equipmentId = '', deviceId = '' } = {}) {
    ensureStorage();
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 500);
    return asArray(readData('gsm_commands'))
      .filter((item) => {
        if (equipmentId && item.equipmentId !== equipmentId) return false;
        if (deviceId && ![item.deviceId, item.imei].filter(Boolean).includes(deviceId)) return false;
        return true;
      })
      .sort((left, right) => Date.parse(right.createdAt || '') - Date.parse(left.createdAt || ''))
      .slice(0, safeLimit);
  }

  function deriveEquipmentGsmStatus(equipment) {
    const explicit = equipment.gsmStatus;
    if (explicit === 'online' || explicit === 'offline' || explicit === 'unknown') return explicit;
    const lastSeenAt = equipment.gsmLastSeenAt || equipment.gsmLastSignalAt;
    if (!lastSeenAt) return 'unknown';
    return Date.now() - Date.parse(lastSeenAt) <= ONLINE_WINDOW_MS ? 'online' : 'offline';
  }

  function listDevices() {
    const onlineEquipmentIds = new Set([...connections.values()].map(item => item.equipmentId).filter(Boolean));
    return asArray(readData('equipment'))
      .filter(item => toText(item.gsmImei) || toText(item.gsmDeviceId) || toText(item.gsmTrackerId))
      .map(item => {
        const status = onlineEquipmentIds.has(item.id) ? 'online' : deriveEquipmentGsmStatus(item);
        return {
          equipmentId: item.id,
          id: item.id,
          equipmentName: equipmentLabel(item),
          manufacturer: item.manufacturer || null,
          model: item.model || null,
          serialNumber: item.serialNumber || null,
          inventoryNumber: item.inventoryNumber || null,
          imei: item.gsmImei || null,
          deviceId: item.gsmDeviceId || item.gsmTrackerId || null,
          simNumber: item.gsmSimNumber || null,
          protocol: item.gsmProtocol || null,
          status,
          lastSeenAt: item.gsmLastSeenAt || item.gsmLastSignalAt || null,
          lastLat: toNumberOrNull(item.gsmLastLat ?? item.gsmLatitude),
          lastLng: toNumberOrNull(item.gsmLastLng ?? item.gsmLongitude),
          lastSpeed: toNumberOrNull(item.gsmLastSpeed ?? item.gsmSpeedKph),
          lastVoltage: toNumberOrNull(item.gsmLastVoltage ?? item.gsmBatteryVoltage),
          lastMotoHours: toNumberOrNull(item.gsmLastMotoHours ?? item.gsmHourmeter),
        };
      })
      .sort((left, right) => String(right.lastSeenAt || '').localeCompare(String(left.lastSeenAt || '')));
  }

  function listRoute({ equipmentId = '', from = '', to = '' } = {}) {
    const id = toText(equipmentId);
    if (!id) return [];
    return listPackets({ equipmentId: id, from, to, limit: 500 })
      .filter(packet => isFiniteNumber(packet.lat) && isFiniteNumber(packet.lng))
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
    ensureStorage();
    const packets = trimCollection('gsm_packets', MAX_PACKET_LOG);
    const commands = trimCollection('gsm_commands', MAX_COMMAND_LOG);
    const equipment = asArray(readData('equipment'));
    const since24hMs = Date.now() - 24 * 60 * 60 * 1000;
    const configuredEquipment = equipment.filter(item => toText(item.gsmImei) || toText(item.gsmDeviceId) || toText(item.gsmTrackerId));
    const onlineEquipmentIds = new Set([...connections.values()].map(item => item.equipmentId).filter(Boolean));
    const recentPackets = packets.filter(packet => isPacketRecent(packet, since24hMs));
    const filteredPackets = listPackets({ equipmentId, deviceId, limit: 500 });
    const filteredCommands = listCommands({ equipmentId, deviceId, limit: 500 });
    const selectedRecentPackets = filteredPackets.filter(packet => isPacketRecent(packet, since24hMs));
    const staleTrackers = configuredEquipment.filter((item) => {
      const signalAt = Date.parse(item.gsmLastSeenAt || item.gsmLastSignalAt || '');
      return !Number.isFinite(signalAt) || signalAt < since24hMs;
    });
    const lastPacket = filteredPackets[0] || null;
    const lastCommand = filteredCommands[0] || null;

    return {
      trackedEquipment: equipment.length,
      configuredTrackers: configuredEquipment.length,
      onlineTrackedEquipment: configuredEquipment.filter(item => onlineEquipmentIds.has(item.id) || deriveEquipmentGsmStatus(item) === 'online').length,
      staleTrackers: staleTrackers.length,
      unknownPackets24h: recentPackets.filter(packet => packet.direction !== 'outbound' && !packet.equipmentId).length,
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
  }

  function createCommand({ equipmentId = '', command = '', payload = {}, createdBy = 'Оператор' } = {}) {
    ensureStorage();
    const safeEquipmentId = toText(equipmentId);
    const safeCommand = toText(command);
    if (!safeEquipmentId) throw new Error('Укажите технику для команды');
    if (!safeCommand) throw new Error('Команда не заполнена');
    const equipment = asArray(readData('equipment')).find(item => item.id === safeEquipmentId) || null;
    if (!equipment) throw new Error('Техника не найдена');

    const item = {
      id: generateId('GCMD'),
      equipmentId: safeEquipmentId,
      equipmentLabel: equipmentLabel(equipment),
      imei: equipment.gsmImei || null,
      deviceId: equipment.gsmDeviceId || equipment.gsmTrackerId || null,
      command: safeCommand,
      payload: payload && typeof payload === 'object' && !Array.isArray(payload) ? payload : {},
      status: 'queued',
      createdAt: nowIso(),
      sentAt: null,
      ackAt: null,
      error: null,
      createdBy,
      encoding: 'text',
      appendNewline: false,
      connectionId: null,
      remoteAddress: null,
      remotePort: null,
    };
    persistCommand(item);
    return item;
  }

  async function sendCommand({ equipmentId = '', deviceId = '', payload = '', encoding = 'text', appendNewline = true, createdBy = 'Оператор' }) {
    const command = createCommand({
      equipmentId,
      command: String(payload || '').trim(),
      payload: {
        raw: String(payload || '').trim(),
        deviceId: toText(deviceId) || undefined,
        encoding: encoding === 'hex' ? 'hex' : 'text',
        appendNewline: Boolean(appendNewline),
      },
      createdBy,
    });

    const connection = findConnectionByIdentity({ deviceId: command.deviceId || deviceId, imei: command.imei });
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
    processRawPacket,
    createCommand,
    sendCommand,
  };
}

module.exports = {
  createGprsGateway,
};
