const crypto = require('crypto');
const net = require('net');
const { parseWialonIpsPacket } = require('./wialon-ips-parser');
const {
  redactGsmSecretText,
  sanitizeGsmPacketForPersistence,
  sanitizeGsmRecordForRead,
} = require('./secret-redaction');
const {
  GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
  assertGsmDeviceIngressMode,
  assertGsmIngressCredential,
  assertGsmIngressSessionCredentialCurrent,
  fingerprintGsmIngressCredentialHash,
} = require('./device-credential');
const {
  applyEquipmentGsmConfigurationProjection,
  assertTrustedGsmConnectionBinding,
  assertTrustedGsmDeviceBindingCurrent,
  captureTrustedGsmDeviceBinding,
  ensureGsmDeviceBindingLifecycle,
  gsmDeviceBindingRevision,
  resolveTrustedStoredGsmBinding,
} = require('./trusted-device-scope');
const {
  boundedPositiveInteger,
  createTcpIngressAdmissionController,
} = require('./tcp-ingress-admission');

const DEFAULT_HOST = '0.0.0.0';
const DEFAULT_PORT = Number(process.env.GSM_TCP_PORT || 5050);
const DEFAULT_ENABLED = String(process.env.ENABLE_GSM_TCP_GATEWAY || '').toLowerCase() === 'true';
const MAX_PACKET_LOG = 1500;
const ONLINE_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_MAX_LINE_BYTES = boundedPositiveInteger(
  process.env.GSM_TCP_MAX_LINE_BYTES,
  16 * 1024,
  { max: 1024 * 1024 },
);
const DEFAULT_MAX_PACKETS_PER_MINUTE = boundedPositiveInteger(
  process.env.GSM_TCP_MAX_PACKETS_PER_MINUTE,
  120,
  { max: 100_000 },
);
const DEFAULT_CONNECTION_TIMEOUT_MS = boundedPositiveInteger(
  process.env.GSM_TCP_CONNECTION_TIMEOUT_MS,
  120_000,
  { min: 100, max: 60 * 60_000 },
);

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

function extractWialonLoginSecret(rawPacket) {
  const match = String(rawPacket || '').match(/^\s*#L#[^;\r\n]*;([^\r\n]*)/i);
  return match ? match[1] : '';
}

function createWialonIpsGateway({
  readData,
  writeDataBatch,
  resolveTrustedDeviceScope,
  withActorScope,
  getCurrentScope,
  logger = console,
  host = DEFAULT_HOST,
  port = DEFAULT_PORT,
  enabled = DEFAULT_ENABLED,
  parsePacket = parseWialonIpsPacket,
  maxLineBytes = DEFAULT_MAX_LINE_BYTES,
  maxPacketsPerMinute = DEFAULT_MAX_PACKETS_PER_MINUTE,
  connectionTimeoutMs = DEFAULT_CONNECTION_TIMEOUT_MS,
  tcpAdmissionController = null,
  maxConnections,
  maxConnectionsPerIp,
  maxAuthAttemptsPerMinute,
  maxAuthAttemptsPerIpPerMinute,
  preAuthTimeoutMs,
} = {}) {
  if (typeof readData !== 'function' || typeof writeDataBatch !== 'function') {
    throw new Error('WIALON IPS gateway requires readData and transactional writeDataBatch functions');
  }
  if (typeof resolveTrustedDeviceScope !== 'function' || typeof withActorScope !== 'function') {
    throw new Error('WIALON IPS gateway requires trusted device scope resolution and scoped execution');
  }
  if (typeof getCurrentScope !== 'function') {
    throw new Error('WIALON IPS gateway requires current tenant scope resolution');
  }

  const lineByteLimit = boundedPositiveInteger(
    maxLineBytes,
    DEFAULT_MAX_LINE_BYTES,
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

  let tcpServer = null;
  let startPromise = null;
  let cancelPendingStart = null;
  let startedAt = null;
  let startError = '';
  const packetsReceivedByScope = new Map();
  const connections = new Map();
  const stoppingServers = new WeakSet();
  const admissionController = tcpAdmissionController || createTcpIngressAdmissionController({
    maxConnections,
    maxConnectionsPerIp,
    maxAuthAttemptsPerMinute,
    maxAuthAttemptsPerIpPerMinute,
    preAuthTimeoutMs,
  });

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

  function readScopedRecords(name) {
    const scope = currentScope();
    if (!scope) return [];
    return asArray(readData(name)).filter(record => scopeMatches(record, scope));
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

  function preparePacketPersistence(packet) {
    const packets = readScopedRecords('gsm_packets');
    packets.unshift(packet);
    return packets.slice(0, MAX_PACKET_LOG);
  }

  function recordPersistedPacket(packet) {
    const key = scopeKey(packet);
    packetsReceivedByScope.set(key, (packetsReceivedByScope.get(key) || 0) + 1);
    logger.log('[WIALON IPS] packet saved', {
      packetId: packet.id,
      imei: packet.imei,
      equipmentId: packet.equipmentId,
      parseStatus: packet.parseStatus,
    });
  }

  function updateDeviceAndEquipment(resolution, parsed, rawPacket, receivedAt) {
    const { device, equipment, scope } = resolution;
    const speed = toNumberOrNull(parsed.speed);
    const voltage = toNumberOrNull(parsed.BoardVoltage ?? parsed.voltage);
    const devices = readScopedRecords('gsm_devices');
    const index = devices.findIndex(item => toText(item.id) === toText(device.id));
    if (index < 0) throw new Error('Provisioned GSM device is not visible in trusted tenant scope');
    const current = ensureGsmDeviceBindingLifecycle(devices[index], {
      at: receivedAt,
      reason: 'telemetry_binding_materialized',
    });
    const next = {
      ...current,
      equipmentId: equipment.id,
      companyId: scope.companyId,
      tenantId: scope.tenantId,
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
    devices[index] = next;
    const equipmentList = readScopedRecords('equipment');
    const equipmentIndex = equipmentList.findIndex(item => item.id === equipment.id);
    if (equipmentIndex < 0) {
      throw new Error('Linked equipment is not visible in trusted tenant scope');
    }
    equipmentList[equipmentIndex] = applyEquipmentGsmConfigurationProjection({
      ...equipmentList[equipmentIndex],
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
      ...(speed !== null ? { gsmLastSpeed: speed, gsmSpeedKph: speed } : {}),
      ...(voltage !== null ? { gsmLastVoltage: voltage, gsmBatteryVoltage: voltage } : {}),
      ...(typeof parsed.ignition === 'boolean' ? { gsmIgnitionOn: parsed.ignition } : {}),
    }, next);
    return {
      device: next,
      equipment: equipmentList[equipmentIndex],
      nextDevices: devices,
      nextEquipment: equipmentList,
    };
  }

  function buildPacket({ rawPacket, parsed, receivedAt, sourceIp, remotePort, connectionId, device, equipment }) {
    const rawBuffer = Buffer.from(rawPacket);
    return sanitizeGsmPacketForPersistence({
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
      gsmDeviceRecordId: device?.id || null,
      gsmBindingRevision: device ? gsmDeviceBindingRevision(device) : null,
      equipmentId: equipment?.id || null,
      companyId: equipment?.companyId || null,
      tenantId: equipment?.tenantId || null,
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
    });
  }

  function processLine(rawLine, context = {}) {
    const rawPacket = String(rawLine || '').replace(/\r?\n$/, '');
    const persistedRawPacket = redactGsmSecretText(rawPacket);
    const receivedAt = nowIso();
    const sourceIp = normalizeRemoteAddress(context.sourceIp || context.remoteAddress || context.connection?.sourceIp);
    const remotePort = context.remotePort || context.connection?.remotePort || null;
    logger.log('[WIALON IPS] packet received', { sourceIp, remotePort, bytes: Buffer.byteLength(rawPacket) });
    const parsed = parsePacket(rawPacket);
    if (!parsed.imei && context.connection?.imei) {
      parsed.imei = context.connection.imei;
      parsed.deviceId = parsed.deviceId || context.connection.imei;
    }
    if (parsed.packetType !== 'login' && !context.connection?.gsmAuthenticatedAt) {
      const error = new Error('WIALON IPS connection must authenticate with a login packet first.');
      error.code = 'GSM_DEVICE_AUTHENTICATION_REQUIRED';
      error.status = 403;
      error.statusCode = 403;
      throw error;
    }
    const resolution = resolveTrustedDeviceScope({ imei: parsed.imei, deviceId: parsed.deviceId });
    const suppliedLoginSecret = parsed.packetType === 'login'
      ? extractWialonLoginSecret(rawPacket)
      : '';
    const authorizedBinding = captureTrustedGsmDeviceBinding(resolution);
    assertTrustedGsmConnectionBinding({ connection: context.connection, resolution });

    return withActorScope(resolution.scope, () => {
      const liveResolution = assertTrustedGsmDeviceBindingCurrent({
        readData: readScopedRecords,
        binding: authorizedBinding,
      });
      assertGsmDeviceIngressMode(liveResolution.device, GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL);
      if (parsed.packetType === 'login') {
        assertGsmIngressCredential({
          suppliedSecret: suppliedLoginSecret,
          storedHash: liveResolution.device.ingressSecretHash,
          deviceRecordId: liveResolution.device.id,
        });
      } else {
        assertGsmIngressSessionCredentialCurrent({
          authenticatedAt: context.connection?.gsmAuthenticatedAt,
          authenticatedCredentialFingerprint: context.connection?.gsmIngressCredentialFingerprint,
          storedHash: liveResolution.device.ingressSecretHash,
          deviceRecordId: liveResolution.device.id,
        });
      }
      if (parsed.imei) logger.log('[WIALON IPS] imei detected', { imei: parsed.imei, packetType: parsed.packetType });
      const {
        device,
        equipment,
        nextDevices,
        nextEquipment,
      } = updateDeviceAndEquipment(liveResolution, parsed, persistedRawPacket, receivedAt);
      const packet = buildPacket({
        rawPacket: persistedRawPacket,
        parsed,
        receivedAt,
        sourceIp,
        remotePort,
        connectionId: context.connection?.id || context.connectionId || null,
        device,
        equipment,
      });
      writeDataBatch([
        { name: 'gsm_devices', value: nextDevices },
        { name: 'equipment', value: nextEquipment },
        { name: 'gsm_packets', value: preparePacketPersistence(packet) },
      ]);
      recordPersistedPacket(packet);
      if (context.connection) {
        context.connection.imei = parsed.imei;
        context.connection.deviceId = parsed.deviceId || parsed.imei;
        context.connection.gsmDeviceRecordId = liveResolution.device.id;
        context.connection.equipmentId = liveResolution.equipment.id;
        context.connection.companyId = liveResolution.scope.companyId;
        context.connection.tenantId = liveResolution.scope.tenantId;
        context.connection.gsmBindingRevision = gsmDeviceBindingRevision(liveResolution.device);
        context.connection.lastSeenAt = receivedAt;
        if (parsed.packetType === 'login') {
          context.connection.gsmAuthenticatedAt = receivedAt;
          context.connection.gsmIngressCredentialFingerprint = fingerprintGsmIngressCredentialHash(
            liveResolution.device.ingressSecretHash,
          );
        }
        context.connection.packetsReceived = (context.connection.packetsReceived || 0) + 1;
        context.connection.bytesReceived = (context.connection.bytesReceived || 0) + Buffer.byteLength(rawPacket);
      }
      return { packet, ack: parsed.ack || Buffer.from('#NAK#\r\n'), parsed };
    });
  }

  function start() {
    if (!enabled) {
      logger.log(`[WIALON IPS] Gateway disabled by ENABLE_GSM_TCP_GATEWAY, TCP ${host}:${port} is not listening`);
      return Promise.resolve(null);
    }
    if (startPromise) return startPromise;
    if (tcpServer?.listening) return Promise.resolve(tcpServer);
    tcpServer = null;

    const server = net.createServer((socket) => {
      const sourceIp = normalizeRemoteAddress(socket.remoteAddress);
      const admission = admissionController.admitConnection(sourceIp);
      if (!admission.ok) {
        logger.warn('[WIALON IPS] TCP connection rejected by ingress admission', {
          sourceIp,
          code: admission.code,
        });
        socket.destroy();
        return;
      }
      const connection = {
        id: generateId('WGCONN'),
        socket,
        sourceIp,
        remotePort: socket.remotePort || null,
        connectedAt: nowIso(),
        lastSeenAt: nowIso(),
        packetsReceived: 0,
        bytesReceived: 0,
        buffer: '',
        windowStartedAt: Date.now(),
        packetsInWindow: 0,
        imei: null,
        deviceId: null,
        gsmDeviceRecordId: null,
        equipmentId: null,
        companyId: null,
        tenantId: null,
      };
      connections.set(connection.id, connection);
      const preAuthTimer = setTimeout(() => {
        if (connection.gsmAuthenticatedAt || socket.destroyed) return;
        logger.warn('[WIALON IPS] TCP pre-authentication deadline exceeded', {
          sourceIp: connection.sourceIp,
          code: 'GSM_TCP_PREAUTH_TIMEOUT',
        });
        socket.destroy();
      }, admissionController.limits.preAuthTimeoutMs);
      preAuthTimer.unref?.();
      logger.log('[WIALON IPS] connection accepted', {
        connectionId: connection.id,
        sourceIp: connection.sourceIp,
        remotePort: connection.remotePort,
      });

      socket.setTimeout(connectionIdleTimeoutMs, () => {
        logger.warn('[WIALON IPS] Connection timeout', { sourceIp: connection.sourceIp });
        socket.destroy();
      });

      socket.on('data', (chunk) => {
        connection.buffer += chunk.toString('utf8');
        let boundary = connection.buffer.indexOf('\r\n');
        while (boundary >= 0) {
          const line = connection.buffer.slice(0, boundary);
          connection.buffer = connection.buffer.slice(boundary + 2);
          const lineBytes = Buffer.byteLength(line);
          if (lineBytes > lineByteLimit) {
            logger.warn('[WIALON IPS] Line rejected by byte bound', {
              sourceIp: connection.sourceIp,
              code: 'GSM_TCP_LINE_TOO_LARGE',
            });
            socket.destroy();
            return;
          }
          const now = Date.now();
          if (now - connection.windowStartedAt >= 60_000) {
            connection.windowStartedAt = now;
            connection.packetsInWindow = 0;
          }
          connection.packetsInWindow += 1;
          if (connection.packetsInWindow > connectionPacketRateLimit) {
            logger.warn('[WIALON IPS] Packet rate limit exceeded', {
              sourceIp: connection.sourceIp,
              code: 'GSM_TCP_PACKET_RATE_LIMIT',
            });
            socket.destroy();
            return;
          }
          if (!connection.gsmAuthenticatedAt) {
            const authAdmission = admissionController.consumeAuthAttempt(connection.sourceIp);
            if (!authAdmission.ok) {
              logger.warn('[WIALON IPS] TCP authentication rejected by ingress admission', {
                sourceIp: connection.sourceIp,
                code: authAdmission.code,
              });
              socket.destroy();
              return;
            }
          }
          const telemetryAdmission = admissionController.consumeTelemetry(connection.sourceIp, {
            byteLength: lineBytes,
          });
          if (!telemetryAdmission.ok) {
            logger.warn('[WIALON IPS] TCP telemetry rejected by shared ingress admission', {
              sourceIp: connection.sourceIp,
              code: telemetryAdmission.code,
            });
            socket.destroy();
            return;
          }
          try {
            const { ack } = processLine(line, { connection });
            if (connection.gsmAuthenticatedAt) clearTimeout(preAuthTimer);
            if (ack && !socket.destroyed) {
              socket.write(ack);
              logger.log('[WIALON IPS] ack sent', {
                connectionId: connection.id,
                imei: connection.imei || null,
                ack: ack.toString().replace(/\r\n$/, '\\r\\n'),
              });
            }
          } catch (error) {
            logger.warn('[WIALON IPS] Packet rejected:', {
              code: error.code || 'GSM_PACKET_REJECTED',
              message: error.message,
            });
            if (!socket.destroyed) socket.write(Buffer.from('#NAK#\r\n'));
            if (error.code?.startsWith('GSM_DEVICE_') || error.code?.startsWith('GSM_CONNECTION_')) {
              socket.destroy();
              return;
            }
          }
          boundary = connection.buffer.indexOf('\r\n');
        }
        if (Buffer.byteLength(connection.buffer) > lineByteLimit) {
          logger.warn('[WIALON IPS] Unterminated line rejected by byte bound', {
            sourceIp: connection.sourceIp,
            code: 'GSM_TCP_LINE_TOO_LARGE',
          });
          socket.destroy();
        }
      });

      socket.on('error', error => logger.warn('[WIALON IPS] Socket error:', error.message));
      socket.on('close', () => {
        clearTimeout(preAuthTimer);
        admission.release();
        connections.delete(connection.id);
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
      startedAt = null;
      startError = error?.message || String(error);
      rejectStart(error);
    };
    cancelPendingStart = failStart;

    server.on('error', (error) => {
      if (stoppingServers.has(server)) {
        logger.warn('[WIALON IPS] Gateway server error during shutdown:', error.message);
        return;
      }
      startError = error.message;
      startedAt = null;
      logger.error(`[WIALON IPS] Gateway server error on ${host}:${port}:`, error.message);
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
      startedAt = nowIso();
      startError = '';
      const address = server.address();
      const listenPort = typeof address === 'object' && address ? address.port : port;
      logger.log(`[WIALON IPS] Gateway listening on ${host}:${listenPort}`);
      resolveStart(server);
    });

    try {
      server.listen(port, host);
    } catch (error) {
      logger.error(`[WIALON IPS] Gateway server error on ${host}:${port}:`, error.message);
      failStart(error);
    }
    return pendingStart;
  }

  async function stop() {
    for (const connection of connections.values()) {
      try {
        connection.socket.destroy();
      } catch (error) {
        logger.warn('[WIALON IPS] Failed to close connection during shutdown:', error?.message || error);
      }
    }
    connections.clear();
    const server = tcpServer;
    tcpServer = null;
    startedAt = null;
    if (!server) return;
    stoppingServers.add(server);
    if (cancelPendingStart) {
      const cancellation = new Error('WIALON IPS gateway startup was cancelled during shutdown.');
      cancellation.code = 'WIALON_IPS_GATEWAY_START_CANCELLED';
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
    return Number(port) || DEFAULT_PORT;
  }

  function getStatus() {
    const scope = currentScope();
    const scopedConnections = visibleConnections();
    const observedAtMs = Date.now();
    const todayStart = new Date(observedAtMs);
    todayStart.setHours(0, 0, 0, 0);
    const todayStartMs = todayStart.getTime();
    const protocolPackets = readScopedRecords('gsm_packets')
      .filter(item => item.protocol === 'wialon-ips');
    const nonFuturePackets = protocolPackets.filter((item) => {
      const timestamp = Date.parse(item.receivedAt || item.createdAt || '');
      return Number.isFinite(timestamp) && timestamp <= observedAtMs;
    });
    const scopedDevices = readScopedRecords('gsm_devices');
    const scopedEquipment = readScopedRecords('equipment');
    const currentTrustedInboundPackets = nonFuturePackets.filter(item => (
      item.direction !== 'outbound'
      && resolveTrustedStoredGsmBinding(item, {
        devices: scopedDevices,
        equipment: scopedEquipment,
        currentOnly: true,
      })
    ));
    const onlineConnections = scopedConnections.filter(item => {
      const lastSeen = Date.parse(item.lastSeenAt || item.connectedAt || '');
      const ageMs = Number.isFinite(lastSeen) ? observedAtMs - lastSeen : null;
      return ageMs !== null && ageMs >= 0 && ageMs <= ONLINE_WINDOW_MS;
    });
    const lastPacketAt = currentTrustedInboundPackets
      .map(item => item.receivedAt || item.createdAt)
      .sort((left, right) => Date.parse(right) - Date.parse(left))[0] || null;
    const uptimeSeconds = startedAt
      ? Math.max(0, Math.floor((observedAtMs - Date.parse(startedAt)) / 1000))
      : 0;
    return {
      enabled: Boolean(enabled && startedAt && !startError),
      gatewayEnabled: Boolean(enabled && startedAt && !startError),
      disabled: !enabled,
      host,
      port: currentTcpPort(),
      tcpPort: currentTcpPort(),
      startedAt,
      startError,
      ingressProtection: admissionController.getStatus(),
      transportLimits: {
        maxLineBytes: lineByteLimit,
        maxPacketsPerConnectionPerMinute: connectionPacketRateLimit,
        connectionIdleTimeoutMs,
      },
      protocol: 'WIALON IPS TCP',
      uptimeSeconds,
      onlineConnections: onlineConnections.length,
      connectionsActive: scopedConnections.length,
      onlineDevices: new Set(onlineConnections
        .map(item => item.gsmDeviceRecordId || item.deviceId || item.imei)
        .filter(Boolean)).size,
      packetsReceivedTotal: Math.max(
        packetsReceivedByScope.get(scopeKey(scope)) || 0,
        protocolPackets.filter(item => item.direction !== 'outbound').length,
      ),
      packetsStored: protocolPackets.length,
      packetsToday: currentTrustedInboundPackets.filter((item) => {
        const timestamp = Date.parse(item.receivedAt || item.createdAt || '');
        return timestamp >= todayStartMs;
      }).length,
      queuedCommands: 0,
      sentToday: 0,
      failedCommands: 0,
      lastPacketAt,
    };
  }

  function listConnections() {
    const observedAtMs = Date.now();
    return visibleConnections().map((connection) => {
      const timestamp = Date.parse(connection.lastSeenAt || connection.connectedAt || '');
      const ageMs = Number.isFinite(timestamp) ? observedAtMs - timestamp : null;
      return {
        id: connection.id,
        deviceId: connection.deviceId || null,
        trackerId: connection.deviceId || null,
        imei: connection.imei || null,
        gsmDeviceRecordId: connection.gsmDeviceRecordId || null,
        gsmBindingRevision: Number(connection.gsmBindingRevision) || null,
        equipmentId: connection.equipmentId || null,
        sourceIp: connection.sourceIp || null,
        remoteAddress: connection.sourceIp || null,
        remotePort: connection.remotePort || null,
        connectedAt: connection.connectedAt,
        lastSeenAt: connection.lastSeenAt,
        packetsReceived: Number(connection.packetsReceived) || 0,
        bytesReceived: Number(connection.bytesReceived) || 0,
        isOnline: ageMs !== null && ageMs >= 0 && ageMs <= ONLINE_WINDOW_MS,
      };
    });
  }

  return {
    start,
    stop,
    getStatus,
    listConnections,
    processLine,
  };
}

module.exports = {
  createWialonIpsGateway,
};
