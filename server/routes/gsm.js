const {
  buildPaginationMeta,
  itemMatchesSearch,
  normalizePaginationParams,
  wantsPaginatedResponse,
} = require('../lib/pagination');

function registerGsmRoutes(router, deps) {
  const {
    requireAuth,
    requireWrite,
    gprsGateway,
    readData,
    writeData,
    generateId = prefix => `${prefix}-${Date.now()}`,
    nowIso = () => new Date().toISOString(),
    gsmIngestToken = process.env.GSM_INGEST_TOKEN || process.env.GSM_GATEWAY_SECRET || '',
    gsmMaxPacketAgeSeconds = Number(process.env.GSM_MAX_PACKET_AGE_SECONDS || process.env.GSM_MAX_PACKET_AGE || 7 * 24 * 60 * 60),
    gsmMaxHttpPayloadBytes = Number(process.env.GSM_HTTP_MAX_PAYLOAD_BYTES || process.env.GPRS_MAX_PACKET_BYTES || 16 * 1024),
  } = deps;

  const GSM_VIEW_ROLES = new Set([
    'Администратор',
    'Офис-менеджер',
    'Менеджер по аренде',
    'Менеджер по продажам',
    'Механик',
    'Младший стационарный механик',
    'Старший стационарный механик',
    'Выездной механик',
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
    if (requestBytes > gsmMaxHttpPayloadBytes) {
      const error = new Error(`payload_too_large: ${requestBytes} bytes > ${gsmMaxHttpPayloadBytes}`);
      error.statusCode = 413;
      throw error;
    }

    const payloadText = normalizeHttpIngestPayload(body);
    const byteLength = Buffer.byteLength(payloadText);
    if (byteLength > gsmMaxHttpPayloadBytes) {
      const error = new Error(`payload_too_large: ${byteLength} bytes > ${gsmMaxHttpPayloadBytes}`);
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
    if (Math.abs(Date.now() - packetMs) > gsmMaxPacketAgeSeconds * 1000) {
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

  function equipmentTrackerId(equipment = {}) {
    return toText(equipment.gsmDeviceId || equipment.gsmTrackerId || equipment.gsmImei);
  }

  function sanitizeEquipmentForGsm(equipment = {}) {
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
      gsmImei: equipment.gsmImei || null,
      gsmDeviceId: equipment.gsmDeviceId || equipment.gsmTrackerId || null,
      gsmTrackerId: equipment.gsmTrackerId || null,
      gsmSimNumber: equipment.gsmSimNumber || null,
      gsmProtocol: equipment.gsmProtocol || null,
      gsmStatus: equipment.gsmStatus || null,
      gsmSignalStatus: equipment.gsmSignalStatus || null,
      gsmLastSeenAt: equipment.gsmLastSeenAt || equipment.gsmLastSignalAt || null,
      gsmLastSignalAt: equipment.gsmLastSignalAt || equipment.gsmLastSeenAt || null,
      gsmLastLat: toNumberOrNull(equipment.gsmLastLat ?? equipment.gsmLatitude),
      gsmLastLng: toNumberOrNull(equipment.gsmLastLng ?? equipment.gsmLongitude),
      gsmLatitude: toNumberOrNull(equipment.gsmLatitude ?? equipment.gsmLastLat),
      gsmLongitude: toNumberOrNull(equipment.gsmLongitude ?? equipment.gsmLastLng),
      gsmLastSpeed: toNumberOrNull(equipment.gsmLastSpeed ?? equipment.gsmSpeedKph),
      gsmSpeedKph: toNumberOrNull(equipment.gsmSpeedKph ?? equipment.gsmLastSpeed),
      gsmLastVoltage: toNumberOrNull(equipment.gsmLastVoltage ?? equipment.gsmBatteryVoltage),
      gsmBatteryVoltage: toNumberOrNull(equipment.gsmBatteryVoltage ?? equipment.gsmLastVoltage),
      gsmLastMotoHours: toNumberOrNull(equipment.gsmLastMotoHours ?? equipment.gsmHourmeter),
      gsmHourmeter: toNumberOrNull(equipment.gsmHourmeter ?? equipment.gsmLastMotoHours),
      gsmIgnitionOn: typeof equipment.gsmIgnitionOn === 'boolean' ? equipment.gsmIgnitionOn : null,
    };
  }

  function isActiveRental(row = {}) {
    const status = toText(row.status || row.ganttStatus).toLowerCase();
    return !['closed', 'returned', 'cancelled', 'canceled', 'completed', 'archived'].includes(status);
  }

  function rentalMatchesEquipment(row = {}, equipment = {}) {
    const equipmentId = toText(equipment.id);
    if (equipmentId && toText(row.equipmentId) === equipmentId) return true;
    const inventory = toText(equipment.inventoryNumber);
    return Boolean(inventory && toText(row.equipmentInv || row.inventoryNumber) === inventory);
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
    const lat = toNumberOrNull(packet?.lat ?? equipment.gsmLastLat ?? equipment.gsmLatitude);
    const lng = toNumberOrNull(packet?.lng ?? equipment.gsmLastLng ?? equipment.gsmLongitude);
    if (lat !== null && lng !== null && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return {
        lat,
        lng,
        source: packet ? 'gps' : 'approximate',
        address: packet?.address || equipment.gsmAddress || equipment.location || binding?.objectAddress || 'GSM точка',
      };
    }
    return null;
  }

  function deriveSignalState(equipment, packet) {
    const status = equipment.gsmStatus || equipment.gsmSignalStatus;
    if (status === 'online') return 'online';
    const at = parseDateMs(packet?.receivedAt || packet?.createdAt || equipment.gsmLastSeenAt || equipment.gsmLastSignalAt);
    if (at !== null && Date.now() - at <= 24 * 60 * 60 * 1000) return 'online';
    if (equipment.location) return 'location_only';
    return 'offline';
  }

  function buildDashboardSnapshot(equipment, packet, binding, routePackets) {
    const point = resolveGsmPoint(equipment, packet, binding);
    const signalState = deriveSignalState(equipment, packet);
    const lastSeenAt = packet?.receivedAt || packet?.createdAt || equipment.gsmLastSeenAt || equipment.gsmLastSignalAt || null;
    const routePoints = asArray(routePackets)
      .filter(item => toNumberOrNull(item.lat) !== null && toNumberOrNull(item.lng) !== null)
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
    const notifications = signalState === 'offline' && equipmentTrackerId(equipment)
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
      equipment: sanitizeEquipmentForGsm(equipment),
      point,
      hasRealTracker: Boolean(equipmentTrackerId(equipment)),
      signalState,
      lastSeenAt,
      binding,
      telemetry: {
        engineHours: toNumberOrNull(equipment.gsmLastMotoHours ?? equipment.gsmHourmeter),
        ignitionOn: typeof equipment.gsmIgnitionOn === 'boolean' ? equipment.gsmIgnitionOn : null,
        batteryVoltage: toNumberOrNull(packet?.voltage ?? equipment.gsmLastVoltage ?? equipment.gsmBatteryVoltage),
        speedKph: toNumberOrNull(packet?.speed ?? equipment.gsmLastSpeed ?? equipment.gsmSpeedKph),
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
    const equipment = asArray(readData?.('equipment'));
    const rentals = asArray(readData?.('rentals'));
    const ganttRentals = asArray(readData?.('gantt_rentals'));
    const clientsById = new Map(asArray(readData?.('clients')).map(item => [toText(item.id), item]));
    const devices = gprsGateway.listDevices().slice(0, limit);
    const recentPackets = gprsGateway.listPackets({ limit: recentLimit });
    const packetByEquipmentId = new Map();
    for (const packet of recentPackets) {
      if (packet.equipmentId && !packetByEquipmentId.has(packet.equipmentId)) packetByEquipmentId.set(packet.equipmentId, packet);
    }
    const neededEquipmentIds = new Set([
      ...devices.map(item => item.equipmentId).filter(Boolean),
      ...recentPackets.map(item => item.equipmentId).filter(Boolean),
    ]);
    const trackedEquipment = equipment
      .filter(item => neededEquipmentIds.has(item.id) || equipmentTrackerId(item))
      .slice(0, limit);
    const snapshots = trackedEquipment.map((item) => {
      const packet = packetByEquipmentId.get(item.id) || null;
      return buildDashboardSnapshot(
        item,
        packet,
        buildGsmBinding(item, rentals, ganttRentals, clientsById),
        packet ? gprsGateway.listPackets({ equipmentId: item.id, limit: 25 }) : [],
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
      status: gprsGateway.getStatus(),
      analytics: gprsGateway.getAnalytics({}),
      counters,
      devices,
      snapshots,
      recentPackets,
      generatedAt: nowIso(),
      limits: { equipment: limit, recentPackets: recentLimit },
    };
  }

  function findEquipmentForLink({ equipmentId, model, inventoryNumber }) {
    const equipment = asArray(readData?.('equipment'));
    const safeEquipmentId = toText(equipmentId);
    const safeModel = toText(model).toLowerCase();
    const safeInventoryNumber = toText(inventoryNumber);
    return equipment.find(item => safeEquipmentId && item.id === safeEquipmentId)
      || equipment.find(item => (
        safeInventoryNumber
        && toText(item.inventoryNumber) === safeInventoryNumber
        && (!safeModel || [item.manufacturer, item.model].filter(Boolean).join(' ').toLowerCase().includes(safeModel))
      ))
      || null;
  }

  function upsertGsmDevice(payload = {}) {
    const imei = toText(payload.imei);
    if (!imei) throw new Error('Укажите IMEI устройства');
    const devices = asArray(readData?.('gsm_devices'));
    const timestamp = nowIso();
    const index = devices.findIndex(item => toText(item.imei) === imei);
    const current = index >= 0 ? devices[index] : {
      id: generateId('GDEV'),
      imei,
      createdAt: timestamp,
    };
    const next = {
      ...current,
      equipmentId: toText(payload.equipmentId) || current.equipmentId || null,
      imei,
      deviceType: toText(payload.deviceType) || current.deviceType || 'UMKA',
      protocol: toText(payload.protocol) || current.protocol || 'WIALON IPS TCP',
      sim1: toText(payload.sim1) || current.sim1 || null,
      oldServer: toText(payload.oldServer) || current.oldServer || null,
      targetServer: toText(payload.targetServer) || current.targetServer || null,
      status: current.status || 'unknown',
      lastPacketAt: current.lastPacketAt || null,
      lastOnlineAt: current.lastOnlineAt || null,
      lastLatitude: current.lastLatitude ?? null,
      lastLongitude: current.lastLongitude ?? null,
      lastSpeed: current.lastSpeed ?? null,
      lastCourse: current.lastCourse ?? null,
      lastSatellites: current.lastSatellites ?? null,
      lastVoltage: current.lastVoltage ?? null,
      lastIgnition: current.lastIgnition ?? null,
      lastRawPacket: current.lastRawPacket || null,
      updatedAt: timestamp,
    };
    if (index >= 0) devices[index] = next;
    else devices.unshift(next);
    writeData('gsm_devices', devices);
    return next;
  }

  function patchEquipmentGsm(equipmentId, device) {
    if (!equipmentId) return null;
    const equipment = asArray(readData?.('equipment'));
    const index = equipment.findIndex(item => item.id === equipmentId);
    if (index === -1) return null;
    const current = equipment[index];
    const next = {
      ...current,
      gsmImei: device.imei || current.gsmImei || null,
      gsmDeviceId: device.imei || current.gsmDeviceId || null,
      gsmSimNumber: device.sim1 || current.gsmSimNumber || null,
      gsmProtocol: device.protocol || current.gsmProtocol || null,
    };
    equipment[index] = next;
    writeData('equipment', equipment);
    return next;
  }

  router.get('/gsm/status', requireAuth, requireGsmView, (_req, res) => {
    res.json(gprsGateway.getStatus());
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
      return res.status(400).json({ ok: false, error: error.message || 'GSM packet rejected' });
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
    const limit = toSafeLimit(req.query.limit, 25, 50);
    const rows = asArray(readData?.('equipment'))
      .filter((item) => {
        if (!search) return true;
        return [
          item.id,
          item.inventoryNumber,
          item.serialNumber,
          item.manufacturer,
          item.model,
          item.gsmImei,
          item.gsmDeviceId,
          item.gsmTrackerId,
        ].some(value => toText(value).toLowerCase().includes(search));
      })
      .slice(0, limit)
      .map(item => sanitizeEquipmentForGsm(item));
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
    const packets = gprsGateway.listPackets({ equipmentId, limit: Number(req.query.limit) || 100 });
    res.json({ equipmentId, devices, packets });
  });

  router.post('/gsm/devices/link', requireAuth, requireWrite('gsm_devices'), (req, res) => {
    try {
      const equipment = findEquipmentForLink({
        equipmentId: req.body?.equipmentId,
        model: req.body?.model || 'MANTALL XE140W',
        inventoryNumber: req.body?.inventoryNumber || '03300976',
      });
      if (!equipment) return res.status(404).json({ ok: false, error: 'Техника для привязки не найдена' });

      const device = upsertGsmDevice({
        equipmentId: equipment.id,
        imei: req.body?.imei || '869132070808689',
        deviceType: req.body?.deviceType || 'UMKA',
        protocol: req.body?.protocol || 'WIALON IPS TCP',
        sim1: req.body?.sim1 || '+79625678660',
        oldServer: req.body?.oldServer || 'gw1.glonasssoft.ru:15050',
        targetServer: req.body?.targetServer,
      });
      const updatedEquipment = patchEquipmentGsm(equipment.id, device);
      res.status(201).json({
        ok: true,
        device,
        equipment: updatedEquipment ? {
          id: updatedEquipment.id,
          label: equipmentLabel(updatedEquipment),
          inventoryNumber: updatedEquipment.inventoryNumber || null,
          gsmImei: updatedEquipment.gsmImei || null,
          gsmProtocol: updatedEquipment.gsmProtocol || null,
        } : null,
      });
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
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
        command: String(req.body?.command || '').trim(),
        payload: req.body?.payload && typeof req.body.payload === 'object' && !Array.isArray(req.body.payload)
          ? req.body.payload
          : {},
        createdBy: req.user?.userName || 'Оператор',
      });
      res.status(202).json(command);
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  router.get('/gsm/gateway/status', requireAuth, requireGsmView, (_req, res) => {
    res.json(gprsGateway.getStatus());
  });

  router.get('/gsm/gateway/connections', requireAuth, requireGsmView, (_req, res) => {
    res.json(gprsGateway.listConnections());
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
        encoding: req.body?.encoding === 'hex' ? 'hex' : 'text',
        appendNewline: req.body?.appendNewline !== false,
        createdBy: req.user?.userName || 'Оператор',
      });
      res.status(command.status === 'queued' ? 202 : 200).json(command);
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });
}

module.exports = {
  registerGsmRoutes,
};
