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

  function equipmentLabel(equipment) {
    if (!equipment) return null;
    return [
      equipment.manufacturer,
      equipment.model,
      equipment.inventoryNumber ? `INV ${equipment.inventoryNumber}` : '',
    ].filter(Boolean).join(' · ') || equipment.id || null;
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
    res.json(gprsGateway.listRoute({
      equipmentId: String(req.query.equipmentId || '').trim(),
      from: String(req.query.from || '').trim(),
      to: String(req.query.to || '').trim(),
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
