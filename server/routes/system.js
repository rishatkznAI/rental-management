const { isMechanicRole } = require('../lib/role-groups');

function registerSystemRoutes(app, deps) {
  const {
    readData,
    writeData,
    getSnapshot,
    saveSnapshot,
    botToken,
    getBotUsers,
    sendMessage,
    countActiveSessions,
    dbPath,
    webhookUrl,
    requireAuth,
    fetchImpl,
  } = deps;

  app.post('/api/sync', async (req, res) => {
    try {
      const {
        equipment,
        rentals,
        gantt_rentals,
        service,
        clients,
        payments,
        users,
        documents,
        mechanic_documents,
        shipping_photos,
      } = req.body;
      const prev = getSnapshot();
      const now = Date.now();

      if (equipment) writeData('equipment', equipment);
      if (rentals) writeData('rentals', rentals);
      if (gantt_rentals) writeData('gantt_rentals', gantt_rentals);
      if (service) writeData('service', service);
      if (clients) writeData('clients', clients);
      if (payments) writeData('payments', payments);
      if (users) writeData('users', users);
      if (documents) writeData('documents', documents);
      if (mechanic_documents) writeData('mechanic_documents', mechanic_documents);
      if (shipping_photos) writeData('shipping_photos', shipping_photos);

      const notifications = [];

      if (rentals && prev.rentals) {
        const prevIds = new Set((prev.rentals || []).map(item => item.id));

        const newRentals = rentals.filter(item => !prevIds.has(item.id));
        for (const rental of newRentals) {
          notifications.push({
            role: 'all',
            managerName: rental.manager,
            text: `🆕 Новая аренда!\n${rental.equipmentInv} → ${rental.client}\nМенеджер: ${rental.manager}\nПериод: ${rental.startDate} — ${rental.endDate}`,
          });
        }

        if (service && prev.service) {
          const prevServiceIds = new Set((prev.service || []).map(item => item.id));
          const newTickets = service.filter(item => !prevServiceIds.has(item.id));
          for (const ticket of newTickets) {
            notifications.push({
              role: 'mechanic',
              text: `🔧 Новая сервисная заявка!\n${ticket.equipment}: ${ticket.reason}\nПриоритет: ${ticket.priority}`,
            });
          }
        }

        const lastOverdueCheck = prev.lastOverdueCheck || 0;
        if (now - lastOverdueCheck > 3600_000) {
          const today = new Date().toISOString().slice(0, 10);
          const overdue = rentals.filter(item =>
            item.status === 'active' && item.endDate && item.endDate < today
          );
          for (const rental of overdue) {
            notifications.push({
              role: 'manager',
              managerName: rental.manager,
              text: `⚠️ Просроченный возврат!\n${rental.equipmentInv} — ${rental.client}\nДолжен был вернуть: ${rental.endDate}`,
            });
          }
          prev.lastOverdueCheck = now;
        }
      }

      saveSnapshot({ ...req.body, lastOverdueCheck: prev.lastOverdueCheck || 0 });

      if (notifications.length && botToken) {
        const botUsers = getBotUsers();
        for (const notification of notifications) {
          for (const [phone, botUser] of Object.entries(botUsers)) {
            const shouldNotify =
              notification.role === 'all' ||
              (notification.role === 'mechanic' && isMechanicRole(botUser.userRole)) ||
              (notification.role === 'manager' && botUser.userName === notification.managerName);

            if (shouldNotify) {
              await sendMessage(botUser.replyTarget || { user_id: Number(phone) }, notification.text);
            }
          }
        }
      }

      res.json({ ok: true, synced: now, notifications: notifications.length });
    } catch (err) {
      console.error('[SYNC] Ошибка:', err.message);
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()) });
  });

  app.get('/', (req, res) => {
    res.json({ ok: true, service: 'rental-management-api', uptime: Math.round(process.uptime()) });
  });

  app.get('/api/bot-test', async (req, res) => {
    const chatId = Number(req.query.chatId) || 134374193;
    const text = req.query.text || 'Тест бота';
    try {
      const result = await sendMessage({ chat_id: chatId }, text);
      res.json({ ok: true, chatId, text, maxApiResponse: result });
    } catch (err) {
      res.json({ ok: false, error: err.message, stack: err.stack });
    }
  });

  app.get('/api/status', (req, res) => {
    const equipment = readData('equipment') || [];
    const rentals = readData('rentals') || [];
    const service = readData('service') || [];
    const botUsers = getBotUsers();

    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      sessions: countActiveSessions(),
      storage: {
        driver: 'sqlite',
        path: dbPath,
        persistent: Boolean(process.env.DB_PATH),
      },
      data: {
        equipment: equipment.length,
        rentals: rentals.length,
        service: service.length,
      },
      botToken: botToken ? '✅ задан' : '❌ не задан',
      botUsers: Object.keys(botUsers).length,
      webhook: webhookUrl || '(не задан)',
    });
  });

  app.get('/api/media/fetch', requireAuth, async (req, res) => {
    const sourceUrl = String(req.query.url || '').trim();
    if (!/^https?:\/\//i.test(sourceUrl)) {
      return res.status(400).json({ ok: false, error: 'Поддерживаются только внешние http/https URL.' });
    }

    try {
      const upstream = await fetchImpl(sourceUrl, {
        headers: {
          'user-agent': 'Rental-Management-MediaProxy/1.0',
          'accept': '*/*',
        },
      });

      if (!upstream.ok) {
        return res.status(502).json({ ok: false, error: `Источник вернул ${upstream.status}` });
      }

      const buffer = await upstream.buffer();
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const contentLength = upstream.headers.get('content-length');
      const fileName = sourceUrl.split('/').pop()?.split('?')[0] || 'media.bin';

      res.setHeader('Content-Type', contentType);
      if (contentLength) {
        res.setHeader('Content-Length', contentLength);
      }
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      return res.send(buffer);
    } catch (error) {
      return res.status(502).json({ ok: false, error: error.message || 'Не удалось получить внешний файл.' });
    }
  });
}

module.exports = {
  registerSystemRoutes,
};
