const {
  buildPaginationMeta,
  itemMatchesSearch,
  normalizePaginationParams,
  wantsPaginatedResponse,
} = require('../lib/pagination');
const {
  advanceGsmDeviceBindingLifecycle,
  applyEquipmentGsmConfigurationProjection,
  closeGsmDeviceBindingLifecycle,
  EQUIPMENT_GSM_PROJECTION_FIELDS,
  ensureGsmDeviceBindingLifecycle,
  gsmDeviceBindingLifecycleIssue,
  gsmDeviceIdentityValues,
  isActiveGsmDeviceRecord,
} = require('../lib/gsm/trusted-device-scope');
const {
  sanitizeTrustedGsmRecordForRead,
} = require('../lib/gsm/secret-redaction');
const {
  GSM_INGRESS_MODE_HTTP_TOKEN,
  GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL,
  assertValidGsmIngressSecret,
  gsmDeviceIngressMode,
  hashGsmIngressSecret,
  requiresGsmTcpIngressCredential,
  resolveGsmIngressMode,
} = require('../lib/gsm/device-credential');
const { MECHANIC_ROLES, SERVICE_FOREMAN_ROLE } = require('../lib/role-groups');
const {
  aggregateGsmGatewayConnections,
  aggregateGsmGatewayStatus,
} = require('../lib/gsm/gateway-runtime-view');
const {
  hasNonFutureGsmServerTime,
  hasUsableGsmPacketLocation,
} = require('../lib/gprs-gateway');
const { boundedPositiveInteger } = require('../lib/gsm/tcp-ingress-admission');

const GSM_ONLINE_WINDOW_MS = 15 * 60 * 1000;

function registerGsmRoutes(router, deps) {
  const {
    requireAuth,
    requireWrite,
    canReadCollection = () => false,
    accessControl = null,
    gprsGateway,
    wialonIpsGateway = null,
    readData,
    writeDataBatch,
    generateId = prefix => `${prefix}-${Date.now()}`,
    nowIso = () => new Date().toISOString(),
    gsmIngestToken = process.env.GSM_INGEST_TOKEN || process.env.GSM_GATEWAY_SECRET || '',
    gsmMaxPacketAgeSeconds = process.env.GSM_MAX_PACKET_AGE_SECONDS || process.env.GSM_MAX_PACKET_AGE || 7 * 24 * 60 * 60,
    gsmMaxHttpPayloadBytes = process.env.GSM_HTTP_MAX_PAYLOAD_BYTES || process.env.GPRS_MAX_PACKET_BYTES || 16 * 1024,
    getGsmDisabledConfig = () => ({ disabled: false }),
    assertGsmDeviceIdentityAvailable = () => {
      const error = new Error('Trusted GSM device provisioning guard is not configured');
      error.code = 'GSM_DEVICE_PROVISIONING_GUARD_REQUIRED';
      error.status = 503;
      throw error;
    },
  } = deps;
  const maxPacketAgeSeconds = boundedPositiveInteger(
    gsmMaxPacketAgeSeconds,
    7 * 24 * 60 * 60,
    { max: 10 * 365 * 24 * 60 * 60 },
  );
  const maxHttpPayloadBytes = boundedPositiveInteger(
    gsmMaxHttpPayloadBytes,
    16 * 1024,
    { max: 1024 * 1024 },
  );

  function getRuntimeStatus() {
    const runtimeStatuses = [
      { key: 'gprs', status: gprsGateway.getStatus() },
      ...(typeof wialonIpsGateway?.getStatus === 'function'
        ? [{ key: 'wialon-ips', status: wialonIpsGateway.getStatus() }]
        : []),
    ];
    const runtimeConnections = [
      { key: 'gprs', connections: gprsGateway.listConnections() },
      ...(typeof wialonIpsGateway?.listConnections === 'function'
        ? [{ key: 'wialon-ips', connections: wialonIpsGateway.listConnections() }]
        : []),
    ];
    return aggregateGsmGatewayStatus(runtimeStatuses, Date.now(), runtimeConnections);
  }

  function getRuntimeConnections() {
    return aggregateGsmGatewayConnections([
      { key: 'gprs', connections: gprsGateway.listConnections() },
      ...(typeof wialonIpsGateway?.listConnections === 'function'
        ? [{ key: 'wialon-ips', connections: wialonIpsGateway.listConnections() }]
        : []),
    ]);
  }

  const GSM_VIEW_ROLES = new Set([
    'Администратор',
    'Офис-менеджер',
    'Менеджер по аренде',
    'Менеджер по продажам',
    SERVICE_FOREMAN_ROLE,
    ...MECHANIC_ROLES,
  ]);

  function requireGsmView(req, res, next) {
    if (GSM_VIEW_ROLES.has(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'GSM доступ запрещён' });
  }

  function packetFilters(req) {
    const parseStatus = String(req.query.parseStatus || '').trim();
    return {
      limit: Number(req.query.limit) || 50,
      offset: Number(req.query.offset) || 0,
      equipmentId: String(req.query.equipmentId || '').trim(),
      imei: String(req.query.imei || '').trim(),
      deviceId: String(req.query.deviceId || '').trim(),
      parseStatus,
      from: String(req.query.from || '').trim(),
      to: String(req.query.to || '').trim(),
    };
  }

  function validatePacketFilters(filters, res) {
    if (filters.parseStatus && !['pending', 'parsed', 'failed'].includes(filters.parseStatus)) {
      res.status(400).json({ ok: false, error: 'Некорректный parseStatus' });
      return false;
    }
    return true;
  }

  function asArray(value) {
    return Array.isArray(value) ? value : [];
  }

  function toText(value) {
    return String(value || '').trim();
  }

  function toNumberOrNull(value) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  function toSafeLimit(value, fallback = 50, max = 200) {
    return Math.min(Math.max(Number(value) || fallback, 1), max);
  }

  function boundedProvisioningText(value, {
    field,
    maxLength,
    pattern = null,
  }) {
    const text = toText(value);
    if (!text) return '';
    if (
      text.length > maxLength
      || /[\u0000-\u001f\u007f]/.test(text)
      || (pattern && !pattern.test(text))
    ) {
      const error = new Error(`Некорректное поле ${field}`);
      error.code = 'GSM_DEVICE_FIELD_INVALID';
      error.status = 400;
      error.details = { field, maxLength };
      throw error;
    }
    return text;
  }

  function gsmProvisioningFields(payload = {}) {
    return {
      imei: boundedProvisioningText(payload.imei, {
        field: 'imei', maxLength: 64, pattern: /^[a-z0-9._:-]+$/i,
      }),
      deviceId: boundedProvisioningText(payload.deviceId, {
        field: 'deviceId', maxLength: 128, pattern: /^[a-z0-9._:@/-]+$/i,
      }),
      deviceType: boundedProvisioningText(payload.deviceType, { field: 'deviceType', maxLength: 100 }),
      protocol: boundedProvisioningText(payload.protocol, { field: 'protocol', maxLength: 100 }),
      sim1: boundedProvisioningText(payload.sim1, {
        field: 'sim1', maxLength: 40, pattern: /^[0-9+() .-]+$/,
      }),
      oldServer: boundedProvisioningText(payload.oldServer, { field: 'oldServer', maxLength: 255 }),
      targetServer: boundedProvisioningText(payload.targetServer, { field: 'targetServer', maxLength: 255 }),
    };
  }

  function safeEqual(left, right) {
    const crypto = require('crypto');
    const safeLeft = toText(left);
    const safeRight = toText(right);
    if (!safeLeft || !safeRight) return false;
    const leftDigest = crypto.createHash('sha256').update(safeLeft).digest();
    const rightDigest = crypto.createHash('sha256').update(safeRight).digest();
    return crypto.timingSafeEqual(leftDigest, rightDigest);
  }

  function getIngestToken(req) {
    const authorization = toText(req.headers.authorization).replace(/^Bearer\s+/i, '');
    return toText(req.headers['x-gsm-ingest-token']) || authorization;
  }

  function requireGsmIngestToken(req, res, next) {
    const gsmDisabled = typeof getGsmDisabledConfig === 'function' ? getGsmDisabledConfig() : { disabled: false };
    if (gsmDisabled.disabled) {
      return res.status(503).json({
        ok: false,
        code: 'GSM_DISABLED',
        error: gsmDisabled.message || 'GSM/GPRS ingest временно отключён.',
        message: gsmDisabled.message || 'GSM/GPRS ingest временно отключён.',
      });
    }
    if (!toText(gsmIngestToken)) {
      return res.status(503).json({ ok: false, error: 'GSM ingest is not configured' });
    }
    if (!safeEqual(getIngestToken(req), gsmIngestToken)) {
      return res.status(401).json({ ok: false, error: 'GSM ingest token required' });
    }
    return next();
  }

  function parseDateMs(value) {
    const ms = Date.parse(String(value || ''));
    return Number.isFinite(ms) ? ms : null;
  }

  function getHttpIngestFields(body = {}) {
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('JSON payload object required');
    }
    return {
      imei: toText(body.imei || body.IMEI) || undefined,
      deviceId: toText(body.deviceId || body.device_id || body.trackerId || body.tracker) || undefined,
      timestamp: toText(body.timestamp || body.deviceTime || body.time || body.at) || undefined,
      lat: body.lat ?? body.latitude,
      lng: body.lng ?? body.lon ?? body.longitude,
      speed: body.speed ?? body.speedKph,
      course: body.course ?? body.heading,
      satellites: body.satellites ?? body.sats,
      gsmSignal: body.gsmSignal ?? body.signal ?? body.rssi,
      voltage: body.voltage ?? body.batteryVoltage ?? body.battery,
      ignition: body.ignition,
      rawPayload: body.rawPayload,
    };
  }

  function normalizeHttpIngestPayload(body = {}) {
    const normalized = getHttpIngestFields(body);
    if (!normalized.imei && !normalized.deviceId) throw new Error('deviceId or imei required');
    if (!normalized.timestamp) throw new Error('timestamp required');
    if (normalized.lat === undefined || normalized.lat === null || normalized.lat === '') throw new Error('latitude required');
    if (normalized.lng === undefined || normalized.lng === null || normalized.lng === '') throw new Error('longitude required');
    return JSON.stringify(normalized);
  }

  function validateHttpIngestBody(body = {}, req = null) {
    const requestBytes = Number(req?.rawBodyBytes || req?.headers?.['content-length'] || 0);
    if (requestBytes > maxHttpPayloadBytes) {
      const error = new Error(`payload_too_large: ${requestBytes} bytes > ${maxHttpPayloadBytes}`);
      error.statusCode = 413;
      throw error;
    }

    const payloadText = normalizeHttpIngestPayload(body);
    const byteLength = Buffer.byteLength(payloadText);
    if (byteLength > maxHttpPayloadBytes) {
      const error = new Error(`payload_too_large: ${byteLength} bytes > ${maxHttpPayloadBytes}`);
      error.statusCode = 413;
      throw error;
    }

    const fields = getHttpIngestFields(body);
    const lat = Number(fields.lat);
    const lng = Number(fields.lng);
    if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
      const error = new Error('Invalid latitude');
      error.statusCode = 400;
      throw error;
    }
    if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
      const error = new Error('Invalid longitude');
      error.statusCode = 400;
      throw error;
    }

    const packetMs = parseDateMs(fields.timestamp);
    if (packetMs === null) {
      const error = new Error('Invalid timestamp');
      error.statusCode = 400;
      throw error;
    }
    if (Math.abs(Date.now() - packetMs) > maxPacketAgeSeconds * 1000) {
      const error = new Error('Packet timestamp is outside allowed age window');
      error.statusCode = 400;
      throw error;
    }

    return payloadText;
  }

  function routeWindow(req, res) {
    const from = toText(req.query.dateFrom || req.query.from);
    const to = toText(req.query.dateTo || req.query.to);
    const fromMs = parseDateMs(from);
    const toMs = parseDateMs(to);
    if (!from || !to || fromMs === null || toMs === null) {
      res.status(400).json({ ok: false, error: 'Для маршрута укажите dateFrom и dateTo' });
      return null;
    }
    if (toMs < fromMs) {
      res.status(400).json({ ok: false, error: 'dateTo должен быть позже dateFrom' });
      return null;
    }
    const maxWindowMs = 7 * 24 * 60 * 60 * 1000;
    if (toMs - fromMs > maxWindowMs) {
      res.status(400).json({ ok: false, error: 'Период маршрута не должен превышать 7 дней' });
      return null;
    }
    return { from, to };
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

  function sanitizeEquipmentForGsm(equipment = {}, {
    device = null,
    contactPacket = null,
    telemetryPacket = null,
    locationPacket = null,
  } = {}) {
    const verifiedBinding = Boolean(device?.id && toText(device.equipmentId) === toText(equipment.id));
    const lastSeenAt = verifiedBinding
      ? (contactPacket?.receivedAt || contactPacket?.createdAt || null)
      : null;
    const lastSeenMs = parseDateMs(lastSeenAt);
    const ageMs = lastSeenMs === null ? null : Date.now() - lastSeenMs;
    const online = ageMs !== null && ageMs >= 0 && ageMs <= GSM_ONLINE_WINDOW_MS;
    const lat = verifiedBinding && hasUsableGsmPacketLocation(locationPacket) ? Number(locationPacket.lat) : null;
    const lng = verifiedBinding && hasUsableGsmPacketLocation(locationPacket) ? Number(locationPacket.lng) : null;
    const voltage = verifiedBinding ? toNumberOrNull(telemetryPacket?.voltage ?? telemetryPacket?.BoardVoltage) : null;
    const speed = verifiedBinding ? toNumberOrNull(telemetryPacket?.speed) : null;
    const motoHours = verifiedBinding ? toNumberOrNull(telemetryPacket?.motoHours) : null;
    const ignition = verifiedBinding && typeof telemetryPacket?.ignition === 'boolean'
      ? telemetryPacket.ignition
      : null;
    return {
      id: equipment.id,
      manufacturer: equipment.manufacturer || '',
      model: equipment.model || '',
      serialNumber: equipment.serialNumber || '',
      inventoryNumber: equipment.inventoryNumber || '',
      status: equipment.status || 'inactive',
      location: equipment.location || '',
      currentClient: equipment.currentClient || '',
      returnDate: equipment.returnDate || '',
      gsmBindingVerified: verifiedBinding,
      gsmTelemetryVerified: verifiedBinding && Boolean(contactPacket),
      gsmImei: verifiedBinding ? (device.imei || null) : null,
      gsmDeviceRecordId: verifiedBinding ? device.id : null,
      gsmDeviceId: verifiedBinding ? (device.deviceId || device.trackerId || device.imei || null) : null,
      gsmTrackerId: verifiedBinding ? (device.trackerId || null) : null,
      gsmSimNumber: verifiedBinding ? (device.sim1 || device.simNumber || null) : null,
      gsmProtocol: verifiedBinding ? (device.protocol || null) : null,
      gsmIngressMode: verifiedBinding ? gsmDeviceIngressMode(device) : null,
      gsmIngressCredentialConfigured: verifiedBinding ? device.ingressCredentialConfigured === true : false,
      gsmStatus: verifiedBinding && contactPacket ? (online ? 'online' : 'offline') : 'unknown',
      gsmSignalStatus: verifiedBinding && contactPacket ? (online ? 'online' : 'offline') : 'unknown',
      gsmLastSeenAt: lastSeenAt,
      gsmLastSignalAt: lastSeenAt,
      gsmLastLat: lat,
      gsmLastLng: lng,
      gsmLatitude: lat,
      gsmLongitude: lng,
      gsmLastSpeed: speed,
      gsmSpeedKph: speed,
      gsmLastVoltage: voltage,
      gsmBatteryVoltage: voltage,
      gsmLastMotoHours: motoHours,
      gsmHourmeter: motoHours,
      gsmIgnitionOn: ignition,
      gsmAddress: verifiedBinding ? (locationPacket?.address || null) : null,
    };
  }

  function sanitizeGsmDeviceForRead(device = {}) {
    const ingressMode = gsmDeviceIngressMode(device);
    const next = {
      ...device,
      ingressMode,
      ingressCredentialConfigured: ingressMode === GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL
        && Boolean(device.ingressSecretHash || device.ingressCredentialConfigured),
    };
    delete next.ingressSecretHash;
    return sanitizeTrustedGsmRecordForRead(next);
  }

  function isActiveRental(row = {}) {
    const status = toText(row.status || row.ganttStatus).toLowerCase();
    return !['closed', 'returned', 'cancelled', 'canceled', 'completed', 'archived'].includes(status);
  }

  function rentalMatchesEquipment(row = {}, equipment = {}) {
    const equipmentId = toText(equipment.id);
    return Boolean(equipmentId && toText(row.equipmentId) === equipmentId);
  }

  function clientDisplayName(client = {}) {
    return client.company || client.name || client.client || client.contact || '';
  }

  function buildGsmBinding(equipment, rentals, ganttRentals, clientsById) {
    const row = [...ganttRentals, ...rentals].find(item => isActiveRental(item) && rentalMatchesEquipment(item, equipment));
    if (!row) return null;
    const clientId = toText(row.clientId);
    const client = clientId ? clientsById.get(clientId) : null;
    const clientName = client ? clientDisplayName(client) : (row.client || row.clientName || equipment.currentClient || '');
    return {
      rentalId: row.rentalId || row.id || '',
      clientName,
      manager: row.manager || '',
      startDate: row.startDate || '',
      endDate: row.endDate || '',
      deliveryAddress: row.deliveryAddress || row.objectAddress || row.location || '',
      objectAddress: row.objectAddress || row.deliveryAddress || row.location || '',
      ganttStatus: row.ganttStatus || row.status || '',
      rentalStatus: row.status || '',
    };
  }

  function resolveGsmPoint(equipment, packet, binding) {
    if (hasUsableGsmPacketLocation(packet)) {
      return {
        lat: Number(packet.lat),
        lng: Number(packet.lng),
        source: 'gps',
        address: packet?.address || equipment.location || binding?.objectAddress || 'GSM точка',
      };
    }
    return null;
  }

  function deriveSignalState(_equipment, packet) {
    const at = parseDateMs(packet?.receivedAt || packet?.createdAt);
    const ageMs = at === null ? null : Date.now() - at;
    if (ageMs !== null && ageMs >= 0 && ageMs <= GSM_ONLINE_WINDOW_MS) return 'online';
    return 'offline';
  }

  function buildDashboardSnapshot(equipment, {
    device,
    contactPacket,
    telemetryPacket,
    locationPacket,
  }, binding, routePackets) {
    const point = resolveGsmPoint(equipment, locationPacket, binding);
    const signalState = deriveSignalState(equipment, contactPacket);
    const lastSeenAt = contactPacket?.receivedAt || contactPacket?.createdAt || null;
    const routePoints = asArray(routePackets)
      .filter(item => item.direction !== 'outbound' && hasUsableGsmPacketLocation(item) && hasNonFutureGsmServerTime(item))
      .map(item => ({
        lat: Number(item.lat),
        lng: Number(item.lng),
        source: 'gps',
        address: item.address || equipment.location || 'GSM точка',
        at: item.receivedAt || item.createdAt,
        label: item.summary || 'GSM пакет',
      }));
    const movementEntries = routePoints.slice(0, 10).map((item, index) => ({
      id: `${equipment.id}:telemetry:${index}:${item.at}`,
      equipmentId: equipment.id,
      occurredAt: item.at,
      kind: 'telemetry',
      title: 'GSM точка',
      description: item.label,
      location: item.address,
      point: {
        lat: item.lat,
        lng: item.lng,
        source: item.source,
        address: item.address,
      },
    }));
    const notifications = signalState === 'offline' && device
      ? [{
        id: `${equipment.id}:signal-loss`,
        type: 'signal_loss',
        occurredAt: lastSeenAt || new Date().toISOString(),
        title: 'Нет свежего сигнала',
        description: 'По трекеру нет свежих GSM/GPRS данных.',
        severity: 'danger',
      }]
      : [];

    return {
      equipment: sanitizeEquipmentForGsm(equipment, { device, contactPacket, telemetryPacket, locationPacket }),
      point,
      hasRealTracker: Boolean(device),
      signalState,
      lastSeenAt,
      binding,
      telemetry: {
        engineHours: toNumberOrNull(telemetryPacket?.motoHours),
        ignitionOn: typeof telemetryPacket?.ignition === 'boolean' ? telemetryPacket.ignition : null,
        batteryVoltage: toNumberOrNull(telemetryPacket?.voltage ?? telemetryPacket?.BoardVoltage),
        speedKph: toNumberOrNull(telemetryPacket?.speed),
      },
      zones: [],
      notifications,
      movementEntries,
      routePoints,
    };
  }

  function buildGsmDashboard(req) {
    const limit = toSafeLimit(req.query.limit, 100, 200);
    const recentLimit = toSafeLimit(req.query.recentLimit, 50, 100);
    const readableRows = (collection) => {
      if (!canReadCollection(req, collection)) return [];
      const rows = asArray(readData?.(collection));
      return typeof accessControl?.filterCollectionByScope === 'function'
        ? accessControl.filterCollectionByScope(collection, rows, req.user)
        : rows;
    };
    const equipment = readableRows('equipment');
    const rentals = readableRows('rentals');
    const ganttRentals = readableRows('gantt_rentals');
    const clientsById = new Map(
      readableRows('clients')
        .map(item => [toText(item.id), item]),
    );
    const readableEquipmentIds = new Set(equipment.map(item => toText(item.id)).filter(Boolean));
    const devices = gprsGateway.listDevices()
      .filter(item => readableEquipmentIds.has(toText(item.equipmentId)))
      .slice(0, limit);
    const currentDeviceByEquipmentId = new Map(
      devices.filter(item => item.equipmentId).map(item => [item.equipmentId, item]),
    );
    const rawRecentPackets = gprsGateway.listPackets({ limit: 500 });
    const trustedRecentPackets = rawRecentPackets
      .filter((packet) => {
        const device = currentDeviceByEquipmentId.get(packet.equipmentId);
        return packet.direction !== 'outbound'
          && device
          && toText(packet.gsmDeviceRecordId) === toText(device.id)
          && Number(packet.gsmBindingRevision) === Number(device.bindingRevision)
          && hasNonFutureGsmServerTime(packet);
      });
    const packetsByEquipmentId = new Map();
    for (const packet of trustedRecentPackets) {
      const device = currentDeviceByEquipmentId.get(packet.equipmentId);
      if (
        device
        && toText(packet.gsmDeviceRecordId) === toText(device.id)
        && Number(packet.gsmBindingRevision) === Number(device.bindingRevision)
        && hasNonFutureGsmServerTime(packet)
      ) {
        if (!packetsByEquipmentId.has(packet.equipmentId)) packetsByEquipmentId.set(packet.equipmentId, []);
        packetsByEquipmentId.get(packet.equipmentId).push(packet);
      }
    }
    const neededEquipmentIds = new Set(devices.map(item => item.equipmentId).filter(Boolean));
    const trackedEquipment = equipment
      .filter(item => neededEquipmentIds.has(item.id))
      .slice(0, limit);
    const snapshots = trackedEquipment.map((item) => {
      const device = currentDeviceByEquipmentId.get(item.id);
      const packets = packetsByEquipmentId.get(item.id) || [];
      const contactPacket = packets[0] || null;
      const telemetryPacket = packets.find(packet => packet.parseStatus === 'parsed') || null;
      const locationPacket = packets.find(packet => hasUsableGsmPacketLocation(packet)) || null;
      return buildDashboardSnapshot(
        item,
        { device, contactPacket, telemetryPacket, locationPacket },
        buildGsmBinding(item, rentals, ganttRentals, clientsById),
        packets.slice(0, 25),
      );
    });
    const counters = {
      total: snapshots.length,
      mapped: snapshots.filter(item => item.point).length,
      realGps: snapshots.filter(item => item.point?.source === 'gps').length,
      locationDerived: snapshots.filter(item => item.point && item.point.source !== 'gps').length,
      rented: snapshots.filter(item => item.equipment.status === 'rented').length,
      alerts: snapshots.reduce((sum, item) => sum + item.notifications.length, 0),
    };
    return {
      status: getRuntimeStatus(),
      analytics: gprsGateway.getAnalytics({}),
      counters,
      devices,
      snapshots,
      recentPackets: rawRecentPackets.slice(0, recentLimit).map((packet) => {
        const device = currentDeviceByEquipmentId.get(packet.equipmentId);
        const bindingVerified = Boolean(
          device
          && toText(packet.gsmDeviceRecordId) === toText(device.id)
          && Number(packet.gsmBindingRevision) === Number(device.bindingRevision)
          && hasNonFutureGsmServerTime(packet)
        );
        return {
          ...packet,
          bindingVerified,
          quarantineReason: bindingVerified ? null : 'binding_not_current_or_unverified',
        };
      }),
      generatedAt: nowIso(),
      limits: { equipment: limit, recentPackets: recentLimit },
    };
  }

  function findEquipmentForLink({ equipmentId, equipment = asArray(readData?.('equipment')) }) {
    const safeEquipmentId = toText(equipmentId);
    if (!safeEquipmentId) return null;
    return equipment.find(item => item.id === safeEquipmentId) || null;
  }

  function prepareGsmDevice(payload = {}, currentDevices = asArray(readData?.('gsm_devices'))) {
    const fields = gsmProvisioningFields(payload);
    const { imei, deviceId } = fields;
    if (!imei && !deviceId) throw new Error('Укажите IMEI или deviceId устройства');
    const equipmentId = toText(payload.equipmentId);
    if (!equipmentId) throw new Error('Укажите equipmentId для GSM-устройства');
    const timestamp = nowIso();
    const suppliedIdentities = new Set([imei, deviceId].filter(Boolean));
    const identityMatches = currentDevices.filter(item => (
      gsmDeviceIdentityValues(item).some(identity => suppliedIdentities.has(identity))
    ));
    if (identityMatches.length > 1) {
      const error = new Error('Идентификатор GSM устройства неоднозначен');
      error.code = 'GSM_DEVICE_IDENTITY_AMBIGUOUS';
      error.status = 409;
      throw error;
    }
    const equipmentMatches = currentDevices.filter(item => (
      isActiveGsmDeviceRecord(item) && toText(item.equipmentId) === equipmentId
    ));
    if (equipmentMatches.length > 1) {
      const error = new Error('К технике привязано несколько активных GSM-устройств');
      error.code = 'GSM_EQUIPMENT_DEVICE_AMBIGUOUS';
      error.status = 409;
      throw error;
    }
    const identityDevice = identityMatches[0] || null;
    const equipmentDevice = equipmentMatches[0] || null;
    if (equipmentDevice && (!identityDevice || toText(identityDevice.id) !== toText(equipmentDevice.id))) {
      const error = new Error('К технике уже привязано другое активное GSM-устройство');
      error.code = 'GSM_EQUIPMENT_ALREADY_PROVISIONED';
      error.status = 409;
      throw error;
    }
    const index = identityDevice ? currentDevices.indexOf(identityDevice) : -1;
    const current = index >= 0 ? currentDevices[index] : {
      id: generateId('GDEV'),
      createdAt: timestamp,
    };
    assertGsmDeviceIdentityAvailable({
      imei,
      deviceId,
      currentDeviceRecordId: current.id,
    });
    const previousEquipmentId = toText(current.equipmentId);
    const bindingChanged = Boolean(previousEquipmentId && previousEquipmentId !== equipmentId);
    const identityChanged = index >= 0 && Boolean(
      (imei && imei !== toText(current.imei))
      || (deviceId && deviceId !== toText(current.deviceId))
    );
    const protocol = fields.protocol || current.protocol || 'WIALON IPS TCP';
    const ingressMode = resolveGsmIngressMode({
      ingressMode: payload.ingressMode,
      protocol,
    });
    const currentIngressMode = index >= 0 ? gsmDeviceIngressMode(current) : null;
    const ingressModeChanged = index >= 0 && currentIngressMode !== ingressMode;
    const resetTelemetry = index < 0
      || bindingChanged
      || identityChanged
      || ingressModeChanged
      || !isActiveGsmDeviceRecord(current);
    const currentWithLifecycle = index >= 0
      ? ensureGsmDeviceBindingLifecycle(current, { at: timestamp })
      : current;
    const hasIngressSecret = Object.prototype.hasOwnProperty.call(payload, 'ingressSecret')
      && payload.ingressSecret !== null
      && payload.ingressSecret !== undefined
      && String(payload.ingressSecret) !== '';
    if (ingressMode === GSM_INGRESS_MODE_HTTP_TOKEN && hasIngressSecret) {
      const error = new Error('Индивидуальный пароль устройства неприменим для HTTP token ingress');
      error.code = 'GSM_DEVICE_CREDENTIAL_NOT_APPLICABLE';
      error.status = 400;
      throw error;
    }
    const retainedIngressSecretHash = ingressModeChanged ? null : (current.ingressSecretHash || null);
    const ingressSecretHash = ingressMode === GSM_INGRESS_MODE_HTTP_TOKEN
      ? null
      : (hasIngressSecret
        ? hashGsmIngressSecret(assertValidGsmIngressSecret(payload.ingressSecret))
        : retainedIngressSecretHash);
    if (ingressMode === GSM_INGRESS_MODE_TCP_DEVICE_CREDENTIAL && !ingressSecretHash) {
      const error = new Error('Для публичного TCP-протокола требуется индивидуальный пароль устройства');
      error.code = 'GSM_DEVICE_CREDENTIAL_REQUIRED';
      error.status = 400;
      throw error;
    }
    const ingressCredentialRevision = ingressMode === GSM_INGRESS_MODE_HTTP_TOKEN
      ? null
      : (hasIngressSecret
        ? Math.max(0, Number(current.ingressCredentialRevision) || 0) + 1
        : (Math.max(0, Number(current.ingressCredentialRevision) || 0) || null));
    let next = {
      ...currentWithLifecycle,
      equipmentId,
      companyId: toText(payload.companyId) || current.companyId || null,
      tenantId: toText(payload.tenantId) || current.tenantId || null,
      imei: imei || current.imei || null,
      deviceId: deviceId || current.deviceId || null,
      trackerId: identityChanged ? null : (current.trackerId || null),
      deviceType: fields.deviceType || current.deviceType || null,
      protocol,
      ingressMode,
      sim1: fields.sim1 || current.sim1 || null,
      oldServer: fields.oldServer || current.oldServer || null,
      targetServer: fields.targetServer || current.targetServer || null,
      ingressSecretHash,
      ingressCredentialRevision,
      status: resetTelemetry ? 'unknown' : (current.status || 'unknown'),
      lastPacketAt: resetTelemetry ? null : (current.lastPacketAt || null),
      lastOnlineAt: resetTelemetry ? null : (current.lastOnlineAt || null),
      lastLatitude: resetTelemetry ? null : (current.lastLatitude ?? null),
      lastLongitude: resetTelemetry ? null : (current.lastLongitude ?? null),
      lastSpeed: resetTelemetry ? null : (current.lastSpeed ?? null),
      lastCourse: resetTelemetry ? null : (current.lastCourse ?? null),
      lastSatellites: resetTelemetry ? null : (current.lastSatellites ?? null),
      lastVoltage: resetTelemetry ? null : (current.lastVoltage ?? null),
      lastIgnition: resetTelemetry ? null : (current.lastIgnition ?? null),
      lastRawPacket: resetTelemetry ? null : (current.lastRawPacket || null),
      updatedAt: timestamp,
    };
    next = index < 0
      ? ensureGsmDeviceBindingLifecycle(next, { at: timestamp, reason: 'provisioned' })
      : (resetTelemetry
        ? advanceGsmDeviceBindingLifecycle(next, {
          at: timestamp,
          reason: bindingChanged
            ? 'equipment_rebound'
            : (identityChanged
              ? 'identity_rotated'
              : (ingressModeChanged ? 'ingress_mode_changed' : 'reactivated')),
        })
        : ensureGsmDeviceBindingLifecycle(next, { at: timestamp }));
    delete next.retiredAt;
    delete next.retiredBy;
    delete next.retiredReason;
    const devices = index >= 0
      ? currentDevices.map((item, itemIndex) => itemIndex === index ? next : item)
      : [next, ...currentDevices];
    return {
      device: next,
      devices,
      previousEquipmentId,
      resetTelemetry,
    };
  }

  function clearEquipmentGsmProjection(record) {
    const cleared = Object.fromEntries(Object.entries(record).map(([field, value]) => [
      field,
      /^gsm/i.test(field) ? null : value,
    ]));
    for (const field of EQUIPMENT_GSM_PROJECTION_FIELDS) cleared[field] = null;
    return cleared;
  }

  function applyEquipmentGsmProjection(record, device, { resetTelemetry = false } = {}) {
    const current = resetTelemetry ? clearEquipmentGsmProjection(record) : record;
    return applyEquipmentGsmConfigurationProjection({
      ...current,
      gsmStatus: resetTelemetry ? 'unknown' : (current.gsmStatus || 'unknown'),
      gsmSignalStatus: resetTelemetry ? 'unknown' : (current.gsmSignalStatus || 'unknown'),
    }, device);
  }

  function prepareEquipmentGsm(equipment, equipmentId, device, {
    previousEquipmentId = '',
    resetTelemetry = false,
  } = {}) {
    if (!equipmentId) return { equipment, record: null };
    const index = equipment.findIndex(item => item.id === equipmentId);
    if (index === -1) return { equipment, record: null };
    const next = applyEquipmentGsmProjection(equipment[index], device, { resetTelemetry });
    return {
      equipment: equipment.map((item, itemIndex) => {
        if (itemIndex === index) return next;
        if (previousEquipmentId && previousEquipmentId !== equipmentId && item.id === previousEquipmentId) {
          return clearEquipmentGsmProjection(item);
        }
        return item;
      }),
      record: next,
    };
  }

  router.get('/gsm/status', requireAuth, requireGsmView, (_req, res) => {
    res.json(getRuntimeStatus());
  });

  router.post('/gsm/ingest', requireGsmIngestToken, (req, res) => {
    let payloadText;
    try {
      payloadText = validateHttpIngestBody(req.body, req);
    } catch (error) {
      return res.status(error.statusCode || 400).json({ ok: false, error: error.message });
    }

    try {
      const packet = gprsGateway.processRawPacket(Buffer.from(payloadText, 'utf8'), {
        ingressMode: GSM_INGRESS_MODE_HTTP_TOKEN,
        sourceIp: req.ip,
        remoteAddress: req.ip,
        remotePort: req.socket?.remotePort || null,
      });
      const status = packet.parseStatus === 'parsed' ? (packet.duplicate ? 200 : 202) : 400;
      return res.status(status).json({
        ok: packet.parseStatus === 'parsed',
        packetId: packet.id,
        duplicate: Boolean(packet.duplicate),
        duplicateOf: packet.duplicateOf || null,
        parseStatus: packet.parseStatus,
        parseError: packet.parseError || null,
        imei: packet.imei || null,
        deviceId: packet.deviceId || null,
        equipmentId: packet.equipmentId || null,
        receivedAt: packet.receivedAt || packet.createdAt || null,
      });
    } catch (error) {
      return res.status(error.statusCode || error.status || 400).json({
        ok: false,
        code: error.code || 'GSM_PACKET_REJECTED',
        error: error.message || 'GSM packet rejected',
      });
    }
  });

  router.get('/gsm/dashboard', requireAuth, requireGsmView, (req, res) => {
    res.json(buildGsmDashboard(req));
  });

  router.get('/gsm/diagnostics', requireAuth, requireGsmView, (req, res) => {
    if (req.user?.userRole !== 'Администратор') {
      return res.status(403).json({ ok: false, error: 'GSM diagnostics доступен только администратору' });
    }
    if (typeof gprsGateway.getDiagnostics !== 'function') {
      return res.status(501).json({ ok: false, error: 'GSM diagnostics недоступен' });
    }
    return res.json(gprsGateway.getDiagnostics());
  });

  router.get('/gsm/bindings', requireAuth, requireGsmView, (req, res) => {
    const search = toText(req.query.search).toLowerCase();
    const exactEquipmentId = toText(req.query.equipmentId);
    const limit = toSafeLimit(req.query.limit, 25, 50);
    const currentDeviceByEquipmentId = new Map(
      gprsGateway.listDevices().map(device => [toText(device.equipmentId), device]),
    );
    const rows = asArray(readData?.('equipment'))
      .filter((item) => {
        if (exactEquipmentId) return toText(item.id) === exactEquipmentId;
        const device = currentDeviceByEquipmentId.get(toText(item.id));
        if (!search) return true;
        return [
          item.id,
          item.inventoryNumber,
          item.serialNumber,
          item.manufacturer,
          item.model,
          device?.imei,
          device?.deviceId,
          device?.trackerId,
        ].some(value => toText(value).toLowerCase().includes(search));
      })
      .slice(0, limit)
      .map(item => sanitizeEquipmentForGsm(item, {
        device: currentDeviceByEquipmentId.get(toText(item.id)) || null,
      }));
    res.json({ items: rows, limit });
  });

  router.get('/gsm/packets', requireAuth, requireGsmView, (req, res) => {
    const filters = packetFilters(req);
    if (!validatePacketFilters(filters, res)) return;
    if (wantsPaginatedResponse(req.query)) {
      const params = normalizePaginationParams(req.query);
      const packets = gprsGateway.listPackets({ ...filters, limit: params.pageSize, offset: params.offset })
        .filter(item => itemMatchesSearch(item, req.query.search, ['id', 'imei', 'deviceId', 'equipmentId', 'raw', 'parseStatus']));
      const hasNextProbe = gprsGateway.listPackets({ ...filters, limit: 1, offset: params.offset + params.pageSize }).length > 0;
      return res.json({
        items: packets,
        pagination: {
          ...buildPaginationMeta(params.offset + packets.length + (hasNextProbe ? 1 : 0), params.page, params.pageSize),
          total: params.offset + packets.length + (hasNextProbe ? 1 : 0),
          totalPages: hasNextProbe ? params.page + 1 : params.page,
          hasNextPage: hasNextProbe,
          hasPrevPage: params.page > 1,
        },
      });
    }
    res.json(gprsGateway.listPackets(filters));
  });

  router.get('/gsm/devices', requireAuth, requireGsmView, (_req, res) => {
    res.json(gprsGateway.listDevices());
  });

  router.get('/gsm/devices/:imei', requireAuth, requireGsmView, (req, res) => {
    const imei = toText(req.params.imei);
    const device = gprsGateway.listDevices().find(item => toText(item.imei) === imei || toText(item.id) === imei);
    if (!device) return res.status(404).json({ ok: false, error: 'GSM устройство не найдено' });
    return res.json(device);
  });

  router.get('/gsm/equipment/:equipmentId', requireAuth, requireGsmView, (req, res) => {
    const equipmentId = toText(req.params.equipmentId);
    const devices = gprsGateway.listDevices().filter(item => item.equipmentId === equipmentId);
    const historyPackets = gprsGateway.listPackets({ equipmentId, limit: Number(req.query.limit) || 100 });
    const currentDevice = devices.length === 1 ? devices[0] : null;
    const packets = currentDevice
      ? historyPackets.filter(packet => (
        toText(packet.gsmDeviceRecordId) === toText(currentDevice.id)
        && Number(packet.gsmBindingRevision) === Number(currentDevice.bindingRevision)
      ))
      : [];
    res.json({ equipmentId, devices, packets, historyPackets });
  });

  router.post('/gsm/devices/link', requireAuth, requireWrite('gsm_devices'), (req, res) => {
    try {
      const equipmentRows = asArray(readData?.('equipment'));
      const equipment = findEquipmentForLink({
        equipmentId: req.body?.equipmentId,
        equipment: equipmentRows,
      });
      if (!equipment) return res.status(404).json({
        ok: false,
        code: 'GSM_EQUIPMENT_ID_REQUIRED',
        error: 'Техника для привязки по exact equipmentId не найдена',
      });

      const preparedDevice = prepareGsmDevice({
        equipmentId: equipment.id,
        companyId: equipment.companyId,
        tenantId: equipment.tenantId,
        imei: req.body?.imei,
        deviceId: req.body?.deviceId,
        deviceType: req.body?.deviceType,
        protocol: req.body?.protocol,
        ingressMode: req.body?.ingressMode,
        sim1: req.body?.sim1,
        oldServer: req.body?.oldServer,
        targetServer: req.body?.targetServer,
        ingressSecret: req.body?.ingressSecret,
      }, asArray(readData?.('gsm_devices')));
      const preparedEquipment = prepareEquipmentGsm(equipmentRows, equipment.id, preparedDevice.device, {
        previousEquipmentId: preparedDevice.previousEquipmentId,
        resetTelemetry: preparedDevice.resetTelemetry,
      });
      writeDataBatch([
        { name: 'gsm_devices', value: preparedDevice.devices },
        { name: 'equipment', value: preparedEquipment.equipment },
      ]);
      const device = preparedDevice.device;
      const updatedEquipment = preparedEquipment.record;
      res.status(201).json({
        ok: true,
        device: sanitizeGsmDeviceForRead(device),
        equipment: updatedEquipment ? {
          id: updatedEquipment.id,
          label: equipmentLabel(updatedEquipment),
          inventoryNumber: updatedEquipment.inventoryNumber || null,
          gsmImei: updatedEquipment.gsmImei || null,
          gsmProtocol: updatedEquipment.gsmProtocol || null,
        } : null,
      });
    } catch (error) {
      res.status(error.statusCode || error.status || 400).json({
        ok: false,
        code: error.code || 'GSM_DEVICE_LINK_REJECTED',
        error: error.message,
      });
    }
  });

  router.post('/gsm/devices/:id/retire', requireAuth, requireWrite('gsm_devices'), (req, res) => {
    try {
      const deviceId = toText(req.params.id);
      const devices = asArray(readData?.('gsm_devices'));
      const index = devices.findIndex(item => toText(item.id) === deviceId);
      if (index < 0) {
        return res.status(404).json({
          ok: false,
          code: 'GSM_DEVICE_NOT_FOUND',
          error: 'GSM-устройство не найдено',
        });
      }
      const current = devices[index];
      const equipmentId = toText(current.equipmentId);
      const remainingActive = devices.filter((item, itemIndex) => (
        itemIndex !== index
        && isActiveGsmDeviceRecord(item)
        && toText(item.equipmentId) === equipmentId
      ));
      if (remainingActive.length > 1) {
        const error = new Error('К технике привязано несколько других активных GSM-устройств');
        error.code = 'GSM_EQUIPMENT_DEVICE_AMBIGUOUS';
        error.status = 409;
        throw error;
      }
      const timestamp = nowIso();
      const alreadyInactive = !isActiveGsmDeviceRecord(current);
      const retiredDevice = closeGsmDeviceBindingLifecycle({
        ...current,
        status: 'retired',
        retiredAt: alreadyInactive && toText(current.retiredAt) ? current.retiredAt : timestamp,
        retiredBy: alreadyInactive && toText(current.retiredBy)
          ? current.retiredBy
          : (toText(req.user?.userName) || null),
        retiredReason: alreadyInactive && toText(current.retiredReason)
          ? current.retiredReason
          : (toText(req.body?.reason).slice(0, 200) || null),
        updatedAt: alreadyInactive && toText(current.updatedAt) ? current.updatedAt : timestamp,
      }, { at: timestamp, reason: 'retired' });
      const lifecycleIssue = gsmDeviceBindingLifecycleIssue(retiredDevice);
      if (lifecycleIssue) {
        const error = new Error('История привязки GSM-устройства не может быть безопасно закрыта');
        error.code = 'GSM_DEVICE_BINDING_HISTORY_INVALID';
        error.status = 409;
        error.details = { lifecycleIssue };
        throw error;
      }
      const nextDevices = devices.map((item, itemIndex) => itemIndex === index ? retiredDevice : item);
      const equipmentRows = asArray(readData?.('equipment'));
      const nextEquipment = equipmentRows.map((item) => {
        if (item.id !== equipmentId) return item;
        return remainingActive[0]
          ? applyEquipmentGsmProjection(item, remainingActive[0])
          : clearEquipmentGsmProjection(item);
      });
      writeDataBatch([
        { name: 'gsm_devices', value: nextDevices },
        { name: 'equipment', value: nextEquipment },
      ]);
      return res.json({ ok: true, retired: true, device: sanitizeGsmDeviceForRead(retiredDevice) });
    } catch (error) {
      return res.status(error.statusCode || error.status || 400).json({
        ok: false,
        code: error.code || 'GSM_DEVICE_RETIRE_REJECTED',
        error: error.message,
      });
    }
  });

  router.patch('/gsm/devices/:id/identity', requireAuth, requireWrite('gsm_devices'), (req, res) => {
    try {
      const recordId = toText(req.params.id);
      const devices = asArray(readData?.('gsm_devices'));
      const index = devices.findIndex(item => toText(item.id) === recordId);
      if (index < 0) {
        return res.status(404).json({
          ok: false,
          code: 'GSM_DEVICE_NOT_FOUND',
          error: 'GSM-устройство не найдено',
        });
      }
      const current = devices[index];
      if (!isActiveGsmDeviceRecord(current)) {
        const error = new Error('Сначала реактивируйте GSM-устройство через lifecycle привязки');
        error.code = 'GSM_DEVICE_NOT_ACTIVE';
        error.status = 409;
        throw error;
      }
      const hasImei = Object.prototype.hasOwnProperty.call(req.body || {}, 'imei');
      const hasDeviceId = Object.prototype.hasOwnProperty.call(req.body || {}, 'deviceId');
      const identityFields = gsmProvisioningFields({
        imei: hasImei ? req.body?.imei : current.imei,
        deviceId: hasDeviceId ? req.body?.deviceId : current.deviceId,
      });
      const imei = identityFields.imei;
      const deviceId = identityFields.deviceId;
      if (!imei && !deviceId) {
        const error = new Error('После ротации требуется IMEI или deviceId');
        error.code = 'GSM_DEVICE_IDENTIFIER_REQUIRED';
        error.status = 400;
        throw error;
      }
      assertGsmDeviceIdentityAvailable({
        imei,
        deviceId,
        currentDeviceRecordId: recordId,
      });
      if (imei === toText(current.imei) && deviceId === toText(current.deviceId)) {
        return res.json({ ok: true, rotated: false, device: sanitizeGsmDeviceForRead(current) });
      }
      const timestamp = nowIso();
      const withCurrentBinding = ensureGsmDeviceBindingLifecycle(current, { at: timestamp });
      const rotatedDevice = advanceGsmDeviceBindingLifecycle({
        ...withCurrentBinding,
        imei: imei || null,
        deviceId: deviceId || null,
        trackerId: null,
        status: isActiveGsmDeviceRecord(current) ? 'unknown' : current.status,
        lastPacketAt: null,
        lastOnlineAt: null,
        lastLatitude: null,
        lastLongitude: null,
        lastSpeed: null,
        lastCourse: null,
        lastSatellites: null,
        lastVoltage: null,
        lastIgnition: null,
        lastRawPacket: null,
        updatedAt: timestamp,
      }, { at: timestamp, reason: 'identity_rotated' });
      const nextDevices = devices.map((item, itemIndex) => itemIndex === index ? rotatedDevice : item);
      const equipmentRows = asArray(readData?.('equipment'));
      const nextEquipment = equipmentRows.map(item => (
        item.id === toText(current.equipmentId)
          ? applyEquipmentGsmProjection(item, rotatedDevice, { resetTelemetry: true })
          : item
      ));
      writeDataBatch([
        { name: 'gsm_devices', value: nextDevices },
        { name: 'equipment', value: nextEquipment },
      ]);
      return res.json({ ok: true, rotated: true, device: sanitizeGsmDeviceForRead(rotatedDevice) });
    } catch (error) {
      return res.status(error.statusCode || error.status || 400).json({
        ok: false,
        code: error.code || 'GSM_DEVICE_IDENTITY_ROTATION_REJECTED',
        error: error.message,
      });
    }
  });

  router.get('/gsm/route', requireAuth, requireGsmView, (req, res) => {
    const window = routeWindow(req, res);
    if (!window) return;
    res.json(gprsGateway.listRoute({
      equipmentId: String(req.query.equipmentId || '').trim(),
      from: window.from,
      to: window.to,
    }));
  });

  router.post('/gsm/commands', requireAuth, requireWrite('gsm_commands'), (req, res) => {
    try {
      const command = gprsGateway.createCommand({
        equipmentId: String(req.body?.equipmentId || '').trim(),
        deviceId: String(req.body?.deviceId || '').trim(),
        command: String(req.body?.command || '').trim(),
        payload: req.body?.payload && typeof req.body.payload === 'object' && !Array.isArray(req.body.payload)
          ? req.body.payload
          : {},
        createdBy: req.user?.userName || 'Оператор',
      });
      res.status(202).json(sanitizeTrustedGsmRecordForRead(command));
    } catch (error) {
      res.status(error.statusCode || error.status || 400).json({
        ok: false,
        code: error.code || 'GSM_COMMAND_REJECTED',
        error: error.message,
      });
    }
  });

  router.get('/gsm/gateway/status', requireAuth, requireGsmView, (_req, res) => {
    res.json(getRuntimeStatus());
  });

  router.get('/gsm/gateway/connections', requireAuth, requireGsmView, (_req, res) => {
    res.json(getRuntimeConnections());
  });

  router.get('/gsm/gateway/packets', requireAuth, requireGsmView, (req, res) => {
    const filters = packetFilters(req);
    if (!validatePacketFilters(filters, res)) return;
    if (wantsPaginatedResponse(req.query)) {
      const params = normalizePaginationParams(req.query);
      const packets = gprsGateway.listPackets({ ...filters, limit: params.pageSize, offset: params.offset })
        .filter(item => itemMatchesSearch(item, req.query.search, ['id', 'imei', 'deviceId', 'equipmentId', 'raw', 'parseStatus']));
      const hasNextProbe = gprsGateway.listPackets({ ...filters, limit: 1, offset: params.offset + params.pageSize }).length > 0;
      return res.json({
        items: packets,
        pagination: {
          ...buildPaginationMeta(params.offset + packets.length + (hasNextProbe ? 1 : 0), params.page, params.pageSize),
          total: params.offset + packets.length + (hasNextProbe ? 1 : 0),
          totalPages: hasNextProbe ? params.page + 1 : params.page,
          hasNextPage: hasNextProbe,
          hasPrevPage: params.page > 1,
        },
      });
    }
    res.json(gprsGateway.listPackets(filters));
  });

  router.get('/gsm/gateway/commands', requireAuth, requireGsmView, (req, res) => {
    const params = normalizePaginationParams(req.query);
    const commands = gprsGateway.listCommands({
      equipmentId: String(req.query.equipmentId || '').trim(),
      deviceId: String(req.query.deviceId || '').trim(),
      limit: wantsPaginatedResponse(req.query) ? params.pageSize : Number(req.query.limit) || 50,
      offset: wantsPaginatedResponse(req.query) ? params.offset : 0,
    });
    if (wantsPaginatedResponse(req.query)) {
      const rows = commands.filter(item => itemMatchesSearch(item, req.query.search, ['id', 'imei', 'deviceId', 'equipmentId', 'command', 'status']));
      const hasNextProbe = gprsGateway.listCommands({
        equipmentId: String(req.query.equipmentId || '').trim(),
        deviceId: String(req.query.deviceId || '').trim(),
        limit: 1,
        offset: params.offset + params.pageSize,
      }).length > 0;
      return res.json({
        items: rows,
        pagination: {
          ...buildPaginationMeta(params.offset + rows.length + (hasNextProbe ? 1 : 0), params.page, params.pageSize),
          total: params.offset + rows.length + (hasNextProbe ? 1 : 0),
          totalPages: hasNextProbe ? params.page + 1 : params.page,
          hasNextPage: hasNextProbe,
          hasPrevPage: params.page > 1,
        },
      });
    }
    res.json(commands);
  });

  router.get('/gsm/gateway/analytics', requireAuth, requireGsmView, (req, res) => {
    res.json(gprsGateway.getAnalytics({
      equipmentId: String(req.query.equipmentId || '').trim(),
      deviceId: String(req.query.deviceId || '').trim(),
    }));
  });

  router.post('/gsm/gateway/send', requireAuth, requireWrite('gsm_commands'), async (req, res) => {
    try {
      const command = await gprsGateway.sendCommand({
        equipmentId: String(req.body?.equipmentId || '').trim(),
        deviceId: String(req.body?.deviceId || '').trim(),
        payload: String(req.body?.payload || ''),
        encoding: String(req.body?.encoding || 'text'),
        appendNewline: req.body?.appendNewline !== false,
        createdBy: req.user?.userName || 'Оператор',
      });
      res.status(command.status === 'queued' ? 202 : 200).json(sanitizeTrustedGsmRecordForRead(command));
    } catch (error) {
      res.status(error.statusCode || error.status || 400).json({
        ok: false,
        code: error.code || 'GSM_COMMAND_REJECTED',
        error: error.message,
      });
    }
  });
}

module.exports = {
  registerGsmRoutes,
};
