const crypto = require('crypto');
const net = require('net');
const { parseWialonIpsPacket } = require('./wialon-ips-parser');

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = Number(process.env.GSM_TCP_PORT || 5050);
const DEFAULT_ENABLED = String(process.env.ENABLE_GSM_TCP_GATEWAY || '').toLowerCase() === 'true';
const MAX_PACKET_LOG = 1500;
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

function normalizeRemoteAddress(value) {
  return String(value || '').replace(/^::ffff:/, '') || null;
}

function equipmentLabel(equipment) {
  if (!equipment) return null;
  return [
    equipment.manufacturer,
    equipment.model,
    equipment.inventoryNumber ? `INV ${equipment.inventoryNumber}` : '',
  ].filter(Boolean).join(' · ') || equipment.id || null;
}

function isValidLocation(lat, lng) {
  return Number.isFinite(Number(lat))
    && Number.isFinite(Number(lng))
    && Number(lat) !== 0
    && Number(lng) !== 0
    && Math.abs(Number(lat)) <= 90
    && Math.abs(Number(lng)) <= 180;
}

function createWialonIpsGateway({
  readData,
  writeData,
  logger = console,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  enabled = DEFAULT_ENABLED,
  parsePacket = parseWialonIpsPacket,
} = {}) {
  if (typeof readData !== 'function' || typeof writeData !== 'function') {
    throw new Error('WIALON IPS gateway requires readData and writeData functions');
  }

  let tcpServer = null;
  let startedAt = null;
  let startError = '';
  let packetsReceivedTotal = 0;
  const connections = new Map();

  function ensureStorage() {
    if (!Array.isArray(readData('gsm_devices'))) writeData('gsm_devices', []);
    if (!Array.isArray(readData('gsm_packets'))) writeData('gsm_packets', []);
  }

  function findDeviceByImei(imei) {
    const safeImei = toText(imei);
    if (!safeImei) return null;
    return asArray(readData('gsm_devices')).find(item => toText(item.imei) === safeImei) || null;
  }

  function findEquipmentForDevice(device, parsed) {
    const equipment = asArray(readData('equipment'));
    const imei = toText(parsed.imei || device?.imei);
    return equipment.find(item => (
      (device?.equipmentId && item.id === device.equipmentId)
      || (imei && toText(item.gsmImei) === imei)
      || (imei && toText(item.gsmDeviceId) === imei)
      || (imei && toText(item.gsmTrackerId) === imei)
    )) || null;
  }

  function persistPacket(packet) {
    ensureStorage();
    const packets = asArray(readData('gsm_packets'));
    packets.unshift(packet);
    writeData('gsm_packets', packets.slice(0, MAX_PACKET_LOG));
    packetsReceivedTotal += 1;
    logger.log('[WIALON IPS] packet saved', {
      packetId: packet.id,
      imei: packet.imei,
      equipmentId: packet.equipmentId,
      parseStatus: packet.parseStatus,
    });
  }

  function updateDeviceAndEquipment(parsed, rawPacket, receivedAt) {
    if (!parsed.imei) return { device: null, equipment: null };
    ensureStorage();
    const devices = asArray(readData('gsm_devices'));
    const index = devices.findIndex(item => toText(item.imei) === toText(parsed.imei));
    const current = index >= 0 ? devices[index] : {
      id: `GSM-${parsed.imei}`,
      imei: parsed.imei,
      deviceType: 'UMKA',
      protocol: 'WIALON IPS TCP',
      status: 'unknown',
      createdAt: receivedAt,
    };
    const next = {
      ...current,
      imei: parsed.imei,
      protocol: current.protocol || 'WIALON IPS TCP',
      status: 'online',
      lastPacketAt: receivedAt,
      lastOnlineAt: receivedAt,
      lastLatitude: toNumberOrNull(parsed.lat) ?? current.lastLatitude ?? null,
      lastLongitude: toNumberOrNull(parsed.lng) ?? current.lastLongitude ?? null,
      lastSpeed: toNumberOrNull(parsed.speed) ?? current.lastSpeed ?? null,
      lastCourse: toNumberOrNull(parsed.course) ?? current.lastCourse ?? null,
      lastSatellites: toNumberOrNull(parsed.satellites) ?? current.lastSatellites ?? null,
      lastVoltage: toNumberOrNull(parsed.BoardVoltage ?? parsed.voltage) ?? current.lastVoltage ?? null,
      lastIgnition: typeof parsed.ignition === 'boolean' ? parsed.ignition : current.lastIgnition ?? null,
      lastRawPacket: rawPacket,
      updatedAt: receivedAt,
    };
    if (index >= 0) devices[index] = next;
    else devices.unshift(next);
    writeData('gsm_devices', devices);

    const equipment = findEquipmentForDevice(next, parsed);
    if (equipment) {
      const equipmentList = asArray(readData('equipment'));
      const equipmentIndex = equipmentList.findIndex(item => item.id === equipment.id);
      if (equipmentIndex >= 0) {
        equipmentList[equipmentIndex] = {
          ...equipmentList[equipmentIndex],
          gsmImei: equipmentList[equipmentIndex].gsmImei || parsed.imei,
          gsmDeviceId: equipmentList[equipmentIndex].gsmDeviceId || parsed.imei,
          gsmProtocol: equipmentList[equipmentIndex].gsmProtocol || 'WIALON IPS TCP',
          gsmLastSeenAt: receivedAt,
          gsmLastSignalAt: receivedAt,
          gsmStatus: 'online',
          gsmSignalStatus: 'online',
          ...(isValidLocation(parsed.lat, parsed.lng) ? {
            gsmLastLat: Number(parsed.lat),
            gsmLastLng: Number(parsed.lng),
            gsmLatitude: Number(parsed.lat),
            gsmLongitude: Number(parsed.lng),
          } : {}),
          ...(Number.isFinite(Number(parsed.speed)) ? { gsmLastSpeed: Number(parsed.speed), gsmSpeedKph: Number(parsed.speed) } : {}),
          ...(Number.isFinite(Number(parsed.BoardVoltage ?? parsed.voltage)) ? { gsmLastVoltage: Number(parsed.BoardVoltage ?? parsed.voltage), gsmBatteryVoltage: Number(parsed.BoardVoltage ?? parsed.voltage) } : {}),
          ...(typeof parsed.ignition === 'boolean' ? { gsmIgnitionOn: parsed.ignition } : {}),
        };
        writeData('equipment', equipmentList);
      }
    }

    return { device: next, equipment };
  }

  function buildPacket({ rawPacket, parsed, receivedAt, sourceIp, remotePort, connectionId, equipment }) {
    const rawBuffer = Buffer.from(rawPacket);
    return {
      id: generateId('GPKT'),
      direction: 'inbound',
      sourceIp,
      remoteAddress: sourceIp,
      remotePort,
      receivedAt,
      createdAt: receivedAt,
      createdBy: 'UMKA',
      rawHex: rawBuffer.toString('hex').toUpperCase(),
      rawText: rawPacket,
      payload: rawPacket,
      payloadHex: rawBuffer.toString('hex').toUpperCase(),
      encoding: 'text',
      protocol: 'wialon-ips',
      parseStatus: parsed.parseStatus,
      parseError: parsed.parseError,
      packetType: parsed.packetType,
      imei: parsed.imei,
      deviceId: parsed.deviceId || parsed.imei,
      trackerId: parsed.deviceId || parsed.imei,
      equipmentId: equipment?.id || null,
      equipmentLabel: equipmentLabel(equipment),
      connectionId,
      deviceTime: parsed.recordTime || parsed.deviceTime || null,
      recordTime: parsed.recordTime || null,
      lat: parsed.lat,
      lng: parsed.lng,
      latitude: parsed.lat,
      longitude: parsed.lng,
      speed: parsed.speed,
      course: parsed.course,
      satellites: parsed.satellites,
      altitude: parsed.altitude,
      hdop: parsed.hdop,
      voltage: parsed.BoardVoltage ?? parsed.voltage,
      BoardVoltage: parsed.BoardVoltage ?? parsed.voltage,
      ignition: parsed.ignition,
      iobits0: parsed.iobits0,
      iobits1: parsed.iobits1,
      param1: parsed.param1,
      param9: parsed.param9,
      param12: parsed.param12,
      hasValidLocation: Boolean(parsed.hasValidLocation),
      parsed: parsed.parsed,
      parsedPayload: parsed.parsed,
      summary: parsed.hasValidLocation
        ? `WIALON IPS ${parsed.imei || ''} ${Number(parsed.lat).toFixed(5)}, ${Number(parsed.lng).toFixed(5)}`.trim()
        : `WIALON IPS ${parsed.packetType || 'packet'} без валидной GPS точки`,
    };
  }

  function processLine(rawLine, context = {}) {
    ensureStorage();
    const rawPacket = String(rawLine || '').replace(/\r?\n$/, '');
    const receivedAt = nowIso();
    const sourceIp = normalizeRemoteAddress(context.sourceIp || context.remoteAddress || context.connection?.sourceIp);
    const remotePort = context.remotePort || context.connection?.remotePort || null;
    logger.log('[WIALON IPS] packet received', { sourceIp, remotePort, bytes: Buffer.byteLength(rawPacket) });
    const parsed = parsePacket(rawPacket);
    if (!parsed.imei && context.connection?.imei) {
      parsed.imei = context.connection.imei;
      parsed.deviceId = parsed.deviceId || context.connection.imei;
    }
    if (parsed.imei && context.connection) context.connection.imei = parsed.imei;
    if (parsed.imei) logger.log('[WIALON IPS] imei detected', { imei: parsed.imei, packetType: parsed.packetType });
    const { equipment } = updateDeviceAndEquipment(parsed, rawPacket, receivedAt);
    const packet = buildPacket({
      rawPacket,
      parsed,
      receivedAt,
      sourceIp,
      remotePort,
      connectionId: context.connection?.id || context.connectionId || null,
      equipment,
    });
    persistPacket(packet);
    return { packet, ack: parsed.ack || Buffer.from('#NAK#\r\n'), parsed };
  }

  function start() {
    ensureStorage();
    if (tcpServer) return tcpServer;
    if (!enabled) {
      logger.log(`[WIALON IPS] Gateway disabled by ENABLE_GSM_TCP_GATEWAY, TCP ${host}:${port} is not listening`);
      return null;
    }

    tcpServer = net.createServer((socket) => {
      const connection = {
        id: generateId('WGCONN'),
        socket,
        sourceIp: normalizeRemoteAddress(socket.remoteAddress),
        remotePort: socket.remotePort || null,
        connectedAt: nowIso(),
        lastSeenAt: nowIso(),
        buffer: '',
      };
      connections.set(connection.id, connection);
      logger.log('[WIALON IPS] connection accepted', {
        connectionId: connection.id,
        sourceIp: connection.sourceIp,
        remotePort: connection.remotePort,
      });

      socket.on('data', (chunk) => {
        connection.buffer += chunk.toString('utf8');
        let boundary = connection.buffer.indexOf('\r\n');
        while (boundary >= 0) {
          const line = connection.buffer.slice(0, boundary);
          connection.buffer = connection.buffer.slice(boundary + 2);
          connection.lastSeenAt = nowIso();
          try {
            const { ack } = processLine(line, { connection });
            if (ack && !socket.destroyed) {
              socket.write(ack);
              logger.log('[WIALON IPS] ack sent', {
                connectionId: connection.id,
                imei: connection.imei || null,
                ack: ack.toString().replace(/\r\n$/, '\\r\\n'),
              });
            }
          } catch (error) {
            logger.error('[WIALON IPS] Packet processing error:', error.message);
          }
          boundary = connection.buffer.indexOf('\r\n');
        }
      });

      socket.on('error', error => logger.warn('[WIALON IPS] Socket error:', error.message));
      socket.on('close', () => connections.delete(connection.id));
    });

    tcpServer.on('error', (error) => {
      startError = error.message;
      startedAt = null;
      logger.error(`[WIALON IPS] Gateway server error on ${host}:${port}:`, error.message);
    });

    tcpServer.listen(port, host, () => {
      startedAt = nowIso();
      startError = '';
      const address = tcpServer.address();
      const listenPort = typeof address === 'object' && address ? address.port : port;
      logger.log(`[WIALON IPS] Gateway listening on ${host}:${listenPort}`);
    });
    return tcpServer;
  }

  function stop() {
    for (const connection of connections.values()) {
      try {
        connection.socket.destroy();
      } catch {
        // ignore close errors
      }
    }
    connections.clear();
    if (!tcpServer) return Promise.resolve();
    const server = tcpServer;
    tcpServer = null;
    if (!server.listening) return Promise.resolve();
    return new Promise(resolve => server.close(resolve));
  }

  function currentTcpPort() {
    const address = tcpServer?.address?.();
    if (typeof address === 'object' && address?.port) return address.port;
    return Number(port) || DEFAULT_PORT;
  }

  function getStatus() {
    return {
      enabled: Boolean(enabled && startedAt && !startError),
      gatewayEnabled: Boolean(enabled && startedAt && !startError),
      disabled: !enabled,
      host,
      port: currentTcpPort(),
      tcpPort: currentTcpPort(),
      startedAt,
      startError,
      protocol: 'WIALON IPS TCP',
      onlineConnections: [...connections.values()].filter(item => {
        const lastSeen = Date.parse(item.lastSeenAt || item.connectedAt || '');
        return Number.isFinite(lastSeen) && Date.now() - lastSeen <= ONLINE_WINDOW_MS;
      }).length,
      packetsReceivedTotal,
      lastPacketAt: asArray(readData('gsm_packets')).find(item => item.protocol === 'wialon-ips')?.receivedAt || null,
    };
  }

  return {
    start,
    stop,
    getStatus,
    processLine,
  };
}

module.exports = {
  createWialonIpsGateway,
};
