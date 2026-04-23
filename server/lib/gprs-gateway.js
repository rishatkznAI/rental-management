const crypto = require('crypto');
const net = require('net');

const GPRS_PORT = Number(process.env.GPRS_PORT || 5055);
const GPRS_HOST = process.env.GPRS_HOST || '0.0.0.0';
const MAX_PACKET_LOG = 1500;
const MAX_COMMAND_LOG = 600;
const MAX_HISTORY_POINTS = 240;
const TRACKER_SESSION_TTL_MS = 1000 * 60 * 15;

function nowIso() {
  return new Date().toISOString();
}

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

function sanitizePrintableText(value) {
  if (!value) return '';
  const normalized = value
    .replace(/\r/g, '')
    .replace(/\0/g, '')
    .replace(/[^\x09\x0A\x20-\x7E\u0400-\u04FF]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return normalized.slice(0, 1200);
}

function parseNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(String(value).replace(',', '.'));
  return Number.isFinite(numeric) ? numeric : null;
}

function parseBoolean(value) {
  if (typeof value === 'boolean') return value;
  const normalized = String(value || '').trim().toLowerCase();
  if (!normalized) return null;
  if (['1', 'true', 'on', 'yes', 'y', 'acc', 'ignition_on'].includes(normalized)) return true;
  if (['0', 'false', 'off', 'no', 'n', 'ignition_off'].includes(normalized)) return false;
  return null;
}

function normalizeIsoTimestamp(value) {
  if (!value) return nowIso();
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return nowIso();
  return date.toISOString();
}

function safeJsonParse(text) {
  if (!text || !(text.startsWith('{') || text.startsWith('['))) return null;
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : null;
  } catch {
    return null;
  }
}

function safeKeyValueParse(text) {
  if (!text || !/[=:]/.test(text)) return null;
  const entries = {};
  const parts = text.split(/[;,&\n]+/g).map(item => item.trim()).filter(Boolean);
  let matched = 0;
  for (const part of parts) {
    const separatorIndex = part.includes('=') ? part.indexOf('=') : part.indexOf(':');
    if (separatorIndex <= 0) continue;
    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();
    if (!key) continue;
    entries[key] = value;
    matched += 1;
  }
  return matched > 0 ? entries : null;
}

function extractIdentity(text, payload) {
  const candidates = [
    payload?.deviceId,
    payload?.trackerId,
    payload?.tracker,
    payload?.imei,
    payload?.IMEI,
    payload?.id,
  ].map(value => String(value || '').trim()).filter(Boolean);

  const imeiMatch = text.match(/(?:imei|IMEI)\s*[:=]\s*(\d{10,20})/);
  if (imeiMatch?.[1]) candidates.unshift(imeiMatch[1]);

  const gt06Match = text.match(/^##,imei:(\d{10,20}),/i);
  if (gt06Match?.[1]) candidates.unshift(gt06Match[1]);

  const plainDigits = text.match(/^\d{14,20}$/);
  if (plainDigits?.[0]) candidates.unshift(plainDigits[0]);

  const imei = candidates.find(value => /^\d{10,20}$/.test(value)) || '';
  const trackerId = candidates.find(value => value !== imei) || '';
  const deviceId = trackerId || imei || '';

  return {
    deviceId: deviceId || null,
    trackerId: trackerId || null,
    imei: imei || null,
  };
}

function normalizePayload(buffer) {
  const rawHex = buffer.toString('hex').toUpperCase();
  const utf8Text = sanitizePrintableText(buffer.toString('utf8'));
  const payload = safeJsonParse(utf8Text) || safeKeyValueParse(utf8Text) || null;
  const identity = extractIdentity(utf8Text, payload);
  const lat = parseNumber(payload?.lat ?? payload?.latitude);
  const lng = parseNumber(payload?.lng ?? payload?.lon ?? payload?.longitude);
  const speedKph = parseNumber(payload?.speed ?? payload?.speedKph ?? payload?.spd);
  const batteryVoltage = parseNumber(payload?.battery ?? payload?.batteryVoltage ?? payload?.voltage ?? payload?.vbat);
  const hourmeter = parseNumber(payload?.hourmeter ?? payload?.hours ?? payload?.engineHours ?? payload?.motoHours);
  const ignitionOn = parseBoolean(payload?.ignition ?? payload?.ignitionOn ?? payload?.acc ?? payload?.engine);
  const address = String(payload?.address || payload?.location || '').trim() || null;
  const trackerTimestamp = normalizeIsoTimestamp(payload?.timestamp ?? payload?.time ?? payload?.datetime ?? payload?.at);

  const protocol = payload
    ? (String(payload.protocol || payload.type || '').trim() || 'generic-text')
    : (utf8Text ? 'raw-text' : 'binary');

  const summaryParts = [];
  if (identity.deviceId) summaryParts.push(`Устройство ${identity.deviceId}`);
  if (Number.isFinite(lat) && Number.isFinite(lng)) summaryParts.push(`Координаты ${lat?.toFixed(5)}, ${lng?.toFixed(5)}`);
  if (speedKph !== null) summaryParts.push(`Скорость ${speedKph} км/ч`);
  if (ignitionOn !== null) summaryParts.push(`Зажигание ${ignitionOn ? 'вкл' : 'выкл'}`);

  return {
    rawHex,
    rawText: utf8Text,
    protocol,
    deviceId: identity.deviceId,
    trackerId: identity.trackerId,
    imei: identity.imei,
    lat,
    lng,
    speedKph,
    batteryVoltage,
    hourmeter,
    ignitionOn,
    address,
    trackerTimestamp,
    payload,
    summary: summaryParts.join(' · ') || 'Сырой пакет принят',
  };
}

function createGprsGateway({ readData, writeData, logger = console }) {
  const connections = new Map();
  const deviceToConnectionId = new Map();
  let tcpServer = null;
  let gatewayStartedAt = null;
  let startError = '';

  function ensureStorage() {
    if (!Array.isArray(readData('gsm_packets'))) writeData('gsm_packets', []);
    if (!Array.isArray(readData('gsm_commands'))) writeData('gsm_commands', []);
  }

  function trimCollection(name, maxItems) {
    const list = readData(name) || [];
    if (!Array.isArray(list) || list.length <= maxItems) return list;
    const nextList = list.slice(0, maxItems);
    writeData(name, nextList);
    return nextList;
  }

  function resolveEquipmentByIdentity(identity) {
    const equipment = readData('equipment') || [];
    return equipment.find((item) => {
      const trackerId = String(item.gsmTrackerId || '').trim();
      const imei = String(item.gsmImei || '').trim();
      return Boolean(
        (identity.deviceId && trackerId && trackerId === identity.deviceId)
        || (identity.trackerId && trackerId && trackerId === identity.trackerId)
        || (identity.imei && imei && imei === identity.imei),
      );
    }) || null;
  }

  function persistPacket(packet) {
    const list = readData('gsm_packets') || [];
    list.unshift(packet);
    writeData('gsm_packets', list.slice(0, MAX_PACKET_LOG));
  }

  function persistCommand(command) {
    const list = readData('gsm_commands') || [];
    const index = list.findIndex(item => item.id === command.id);
    if (index >= 0) {
      list[index] = command;
    } else {
      list.unshift(command);
    }
    writeData('gsm_commands', list.slice(0, MAX_COMMAND_LOG));
  }

  function appendTelemetryToEquipment(equipmentId, payload, identity) {
    if (!equipmentId) return;
    const equipmentList = readData('equipment') || [];
    const index = equipmentList.findIndex(item => item.id === equipmentId);
    if (index === -1) return;

    const current = equipmentList[index];
    const next = { ...current };
    const pointTimestamp = payload.trackerTimestamp || nowIso();
    let changed = false;

    if (identity.trackerId && String(next.gsmTrackerId || '').trim() !== identity.trackerId) {
      next.gsmTrackerId = identity.trackerId;
      changed = true;
    }
    if (identity.imei && String(next.gsmImei || '').trim() !== identity.imei) {
      next.gsmImei = identity.imei;
      changed = true;
    }

    next.gsmLastSignalAt = pointTimestamp;
    next.gsmSignalStatus = 'online';
    changed = true;

    if (Number.isFinite(payload.lat) && Number.isFinite(payload.lng)) {
      next.gsmLatitude = payload.lat;
      next.gsmLongitude = payload.lng;
      changed = true;
    }
    if (payload.address) {
      next.gsmAddress = payload.address;
      changed = true;
    }
    if (payload.speedKph !== null) {
      next.gsmSpeedKph = payload.speedKph;
      changed = true;
    }
    if (payload.batteryVoltage !== null) {
      next.gsmBatteryVoltage = payload.batteryVoltage;
      changed = true;
    }
    if (payload.hourmeter !== null) {
      next.gsmHourmeter = payload.hourmeter;
      changed = true;
    }
    if (payload.ignitionOn !== null) {
      next.gsmIgnitionOn = payload.ignitionOn;
      changed = true;
    }

    if (Number.isFinite(payload.lat) && Number.isFinite(payload.lng)) {
      const history = Array.isArray(current.gsmMovementHistory) ? current.gsmMovementHistory.slice(0) : [];
      const dedupeKey = `${payload.lat.toFixed(5)}:${payload.lng.toFixed(5)}:${pointTimestamp.slice(0, 16)}`;
      const exists = history.some((item) => {
        if (!item) return false;
        const lat = Number(item.lat);
        const lng = Number(item.lng);
        return Number.isFinite(lat) && Number.isFinite(lng)
          && `${lat.toFixed(5)}:${lng.toFixed(5)}:${String(item.at || '').slice(0, 16)}` === dedupeKey;
      });

      if (!exists) {
        history.push({
          at: pointTimestamp,
          lat: payload.lat,
          lng: payload.lng,
          source: 'gps',
          address: payload.address || next.gsmAddress || next.location || 'GPRS точка',
          speedKph: payload.speedKph ?? undefined,
        });
      }

      next.gsmMovementHistory = history
        .sort((left, right) => new Date(left.at).getTime() - new Date(right.at).getTime())
        .slice(-MAX_HISTORY_POINTS);
      changed = true;
    }

    if (!changed) return;
    equipmentList[index] = next;
    writeData('equipment', equipmentList);
  }

  function normalizeRemoteAddress(value) {
    return String(value || '').replace(/^::ffff:/, '');
  }

  function getConnectionSummary(connection) {
    return {
      id: connection.id,
      deviceId: connection.deviceId || null,
      trackerId: connection.trackerId || null,
      imei: connection.imei || null,
      equipmentId: connection.equipmentId || null,
      equipmentLabel: connection.equipmentLabel || null,
      remoteAddress: connection.remoteAddress,
      remotePort: connection.remotePort,
      connectedAt: connection.connectedAt,
      lastSeenAt: connection.lastSeenAt,
      packetsReceived: connection.packetsReceived,
      bytesReceived: connection.bytesReceived,
      isOnline: !connection.closedAt,
    };
  }

  function findConnectionByIdentity(identity) {
    const deviceKey = identity.deviceId || identity.trackerId || identity.imei;
    if (!deviceKey) return null;
    const connectionId = deviceToConnectionId.get(deviceKey);
    if (!connectionId) return null;
    return connections.get(connectionId) || null;
  }

  function encodeCommandPayload(payload, encoding, appendNewline) {
    if (encoding === 'hex') {
      const normalized = String(payload || '').replace(/\s+/g, '');
      if (!normalized || normalized.length % 2 !== 0 || /[^0-9a-f]/i.test(normalized)) {
        throw new Error('HEX-пакет должен содержать чётное количество шестнадцатеричных символов');
      }
      return Buffer.from(normalized, 'hex');
    }

    const suffix = appendNewline ? '\r\n' : '';
    return Buffer.from(`${String(payload || '')}${suffix}`, 'utf8');
  }

  function writeCommandToSocket(command, connection) {
    const bytes = encodeCommandPayload(command.payload, command.encoding, command.appendNewline);

    return new Promise((resolve, reject) => {
      connection.socket.write(bytes, (error) => {
        if (error) {
          reject(error);
          return;
        }

        const sentAt = nowIso();
        const updatedCommand = {
          ...command,
          status: 'sent',
          sentAt,
          connectionId: connection.id,
          deviceId: connection.deviceId || command.deviceId || null,
          equipmentId: connection.equipmentId || command.equipmentId || null,
          remoteAddress: connection.remoteAddress,
          remotePort: connection.remotePort,
        };
        persistCommand(updatedCommand);
        persistPacket({
          id: generateId('GPKT'),
          direction: 'outbound',
          deviceId: updatedCommand.deviceId,
          trackerId: connection.trackerId || null,
          imei: connection.imei || null,
          equipmentId: updatedCommand.equipmentId,
          equipmentLabel: connection.equipmentLabel || null,
          connectionId: connection.id,
          remoteAddress: connection.remoteAddress,
          remotePort: connection.remotePort,
          payload: command.payload,
          payloadHex: bytes.toString('hex').toUpperCase(),
          encoding: command.encoding,
          protocol: 'outbound-command',
          summary: `Команда отправлена ${updatedCommand.deviceId || 'на устройство'}`,
          createdAt: sentAt,
          createdBy: command.createdBy || 'Система',
        });
        resolve(updatedCommand);
      });
    });
  }

  async function flushQueuedCommands(identity) {
    const deviceKey = identity.deviceId || identity.trackerId || identity.imei;
    if (!deviceKey) return;

    const list = readData('gsm_commands') || [];
    const queued = list.filter(item =>
      item.status === 'queued'
      && [item.deviceId, item.trackerId, item.imei].filter(Boolean).includes(deviceKey),
    );

    if (queued.length === 0) return;

    const connection = findConnectionByIdentity(identity);
    if (!connection) return;

    for (const command of queued) {
      try {
        await writeCommandToSocket(command, connection);
      } catch (error) {
        persistCommand({
          ...command,
          status: 'failed',
          error: error.message,
          failedAt: nowIso(),
        });
      }
    }
  }

  function bindConnectionToIdentity(connection, payloadIdentity) {
    const deviceKey = payloadIdentity.deviceId || payloadIdentity.trackerId || payloadIdentity.imei;
    if (!deviceKey) return;

    connection.deviceId = payloadIdentity.deviceId || connection.deviceId || null;
    connection.trackerId = payloadIdentity.trackerId || connection.trackerId || null;
    connection.imei = payloadIdentity.imei || connection.imei || null;

    const equipment = resolveEquipmentByIdentity(payloadIdentity);
    if (equipment) {
      connection.equipmentId = equipment.id;
      connection.equipmentLabel = [
        equipment.manufacturer,
        equipment.model,
        equipment.inventoryNumber ? `INV ${equipment.inventoryNumber}` : '',
      ].filter(Boolean).join(' · ');
    }

    deviceToConnectionId.set(deviceKey, connection.id);
    void flushQueuedCommands(payloadIdentity);
  }

  function handleIncomingPacket(connection, buffer) {
    const parsed = normalizePayload(buffer);
    connection.lastSeenAt = parsed.trackerTimestamp || nowIso();
    connection.packetsReceived += 1;
    connection.bytesReceived += buffer.byteLength;

    bindConnectionToIdentity(connection, parsed);
    appendTelemetryToEquipment(connection.equipmentId, parsed, parsed);

    persistPacket({
      id: generateId('GPKT'),
      direction: 'inbound',
      deviceId: connection.deviceId || parsed.deviceId,
      trackerId: connection.trackerId || parsed.trackerId,
      imei: connection.imei || parsed.imei,
      equipmentId: connection.equipmentId || null,
      equipmentLabel: connection.equipmentLabel || null,
      connectionId: connection.id,
      remoteAddress: connection.remoteAddress,
      remotePort: connection.remotePort,
      payload: parsed.rawText || null,
      payloadHex: parsed.rawHex,
      encoding: parsed.rawText ? 'text' : 'hex',
      protocol: parsed.protocol,
      summary: parsed.summary,
      parsedPayload: parsed.payload,
      createdAt: connection.lastSeenAt,
      createdBy: 'Трекер',
    });
  }

  function cleanupStaleConnections() {
    const now = Date.now();
    for (const connection of connections.values()) {
      if (connection.closedAt) continue;
      if (now - new Date(connection.lastSeenAt || connection.connectedAt).getTime() <= TRACKER_SESSION_TTL_MS) continue;
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
      const connection = {
        id: generateId('GCONN'),
        socket,
        deviceId: null,
        trackerId: null,
        imei: null,
        equipmentId: null,
        equipmentLabel: null,
        remoteAddress: normalizeRemoteAddress(socket.remoteAddress),
        remotePort: socket.remotePort || null,
        connectedAt: nowIso(),
        lastSeenAt: nowIso(),
        packetsReceived: 0,
        bytesReceived: 0,
        closedAt: null,
      };

      connections.set(connection.id, connection);

      socket.on('data', (buffer) => {
        try {
          handleIncomingPacket(connection, buffer);
        } catch (error) {
          logger.error('[GPRS] Incoming packet error:', error.message);
        }
      });

      socket.on('error', (error) => {
        logger.warn('[GPRS] Socket error:', error.message);
      });

      socket.on('close', () => {
        connection.closedAt = nowIso();
        connections.delete(connection.id);
        for (const [deviceKey, connectionId] of deviceToConnectionId.entries()) {
          if (connectionId === connection.id) {
            deviceToConnectionId.delete(deviceKey);
          }
        }
      });
    });

    tcpServer.on('error', (error) => {
      startError = error.message;
      logger.error('[GPRS] Gateway server error:', error.message);
    });

    tcpServer.listen(GPRS_PORT, GPRS_HOST, () => {
      gatewayStartedAt = nowIso();
      startError = '';
      logger.log(`[GPRS] Gateway listening on ${GPRS_HOST}:${GPRS_PORT}`);
    });

    setInterval(cleanupStaleConnections, 60_000).unref();

    return tcpServer;
  }

  function getStatus() {
    ensureStorage();
    trimCollection('gsm_packets', MAX_PACKET_LOG);
    trimCollection('gsm_commands', MAX_COMMAND_LOG);

    const packets = readData('gsm_packets') || [];
    const commands = readData('gsm_commands') || [];
    const onlineConnections = [...connections.values()].filter(item => !item.closedAt);
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();

    return {
      enabled: true,
      host: GPRS_HOST,
      port: GPRS_PORT,
      startedAt: gatewayStartedAt,
      startError,
      onlineConnections: onlineConnections.length,
      onlineDevices: new Set(onlineConnections.map(item => item.deviceId || item.imei || item.trackerId).filter(Boolean)).size,
      packetsStored: packets.length,
      packetsToday: packets.filter(item => new Date(item.createdAt).getTime() >= todayStartMs).length,
      queuedCommands: commands.filter(item => item.status === 'queued').length,
      sentToday: commands.filter(item => item.sentAt && new Date(item.sentAt).getTime() >= todayStartMs).length,
      failedCommands: commands.filter(item => item.status === 'failed').length,
      lastPacketAt: packets[0]?.createdAt || null,
    };
  }

  function listConnections() {
    return [...connections.values()]
      .map(getConnectionSummary)
      .sort((left, right) => new Date(right.lastSeenAt).getTime() - new Date(left.lastSeenAt).getTime());
  }

  function listPackets({ limit = 50, equipmentId = '', deviceId = '' } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 300);
    return (readData('gsm_packets') || [])
      .filter((item) => {
        if (equipmentId && item.equipmentId !== equipmentId) return false;
        if (deviceId && ![item.deviceId, item.trackerId, item.imei].includes(deviceId)) return false;
        return true;
      })
      .slice(0, safeLimit);
  }

  function listCommands({ limit = 50, equipmentId = '', deviceId = '' } = {}) {
    const safeLimit = Math.min(Math.max(Number(limit) || 50, 1), 300);
    return (readData('gsm_commands') || [])
      .filter((item) => {
        if (equipmentId && item.equipmentId !== equipmentId) return false;
        if (deviceId && ![item.deviceId, item.trackerId, item.imei].includes(deviceId)) return false;
        return true;
      })
      .slice(0, safeLimit);
  }

  async function sendCommand({ equipmentId = '', deviceId = '', payload = '', encoding = 'text', appendNewline = true, createdBy = 'Оператор' }) {
    const equipment = equipmentId
      ? (readData('equipment') || []).find(item => item.id === equipmentId) || null
      : null;

    const resolvedIdentity = {
      deviceId: String(deviceId || equipment?.gsmTrackerId || '').trim() || null,
      trackerId: String(equipment?.gsmTrackerId || '').trim() || null,
      imei: String(equipment?.gsmImei || '').trim() || null,
    };

    if (!payload || !String(payload).trim()) {
      throw new Error('Пакет команды не заполнен');
    }

    if (!resolvedIdentity.deviceId && !resolvedIdentity.imei) {
      throw new Error('Не удалось определить устройство: укажите deviceId или привяжите трекер в карточке техники');
    }

    const command = {
      id: generateId('GCMD'),
      equipmentId: equipment?.id || equipmentId || null,
      equipmentLabel: equipment
        ? [equipment.manufacturer, equipment.model, equipment.inventoryNumber ? `INV ${equipment.inventoryNumber}` : ''].filter(Boolean).join(' · ')
        : null,
      deviceId: resolvedIdentity.deviceId,
      trackerId: resolvedIdentity.trackerId,
      imei: resolvedIdentity.imei,
      payload: String(payload).trim(),
      encoding: encoding === 'hex' ? 'hex' : 'text',
      appendNewline: Boolean(appendNewline),
      status: 'queued',
      createdAt: nowIso(),
      createdBy,
      sentAt: null,
      failedAt: null,
      error: null,
      connectionId: null,
      remoteAddress: null,
      remotePort: null,
    };

    persistCommand(command);

    const activeConnection = findConnectionByIdentity(resolvedIdentity);
    if (!activeConnection) return command;

    try {
      return await writeCommandToSocket(command, activeConnection);
    } catch (error) {
      const failed = {
        ...command,
        status: 'failed',
        failedAt: nowIso(),
        error: error.message,
      };
      persistCommand(failed);
      return failed;
    }
  }

  return {
    start,
    getStatus,
    listConnections,
    listPackets,
    listCommands,
    sendCommand,
  };
}

module.exports = {
  createGprsGateway,
};
