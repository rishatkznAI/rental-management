function registerGsmRoutes(router, deps) {
  const {
    requireAuth,
    requireWrite,
    gprsGateway,
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

  router.get('/gsm/gateway/status', requireAuth, requireGsmView, (_req, res) => {
    res.json(gprsGateway.getStatus());
  });

  router.get('/gsm/gateway/connections', requireAuth, requireGsmView, (_req, res) => {
    res.json(gprsGateway.listConnections());
  });

  router.get('/gsm/gateway/packets', requireAuth, requireGsmView, (req, res) => {
    res.json(gprsGateway.listPackets({
      equipmentId: String(req.query.equipmentId || '').trim(),
      deviceId: String(req.query.deviceId || '').trim(),
      limit: Number(req.query.limit) || 50,
    }));
  });

  router.get('/gsm/gateway/commands', requireAuth, requireGsmView, (req, res) => {
    res.json(gprsGateway.listCommands({
      equipmentId: String(req.query.equipmentId || '').trim(),
      deviceId: String(req.query.deviceId || '').trim(),
      limit: Number(req.query.limit) || 50,
    }));
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
