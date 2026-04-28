const { isMechanicRole } = require('../lib/role-groups');
const dns = require('dns');
const http = require('http');
const https = require('https');
const net = require('net');

const MAX_MEDIA_PROXY_BYTES = 10 * 1024 * 1024;
const MEDIA_PROXY_TIMEOUT_MS = 10_000;
const dnsPromises = dns.promises;

function isPrivateAddress(address) {
  if (!address) return true;
  if (address.startsWith('::ffff:')) {
    return isPrivateAddress(address.slice('::ffff:'.length));
  }

  const family = net.isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      a >= 224;
  }

  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:');
  }

  return true;
}

async function assertPublicHttpUrl(sourceUrl) {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('Некорректный URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Поддерживаются только внешние http/https URL.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL с учётными данными не поддерживаются.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Внутренние адреса не поддерживаются.');
  }
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error('Внутренние адреса не поддерживаются.');
    }
    return parsed;
  }

  const addresses = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('Внутренние адреса не поддерживаются.');
  }
  return parsed;
}

function createPublicLookup() {
  return (hostname, options, callback) => {
    dns.lookup(hostname, options, (error, address, family) => {
      if (error) {
        callback(error);
        return;
      }

      const entries = Array.isArray(address)
        ? address
        : [{ address, family }];
      if (!entries.length || entries.some(item => isPrivateAddress(item.address || item))) {
        callback(new Error('Внутренние адреса не поддерживаются.'));
        return;
      }

      if (Array.isArray(address)) {
        callback(null, address);
        return;
      }
      callback(null, address, family);
    });
  };
}

const mediaProxyLookup = createPublicLookup();
const mediaProxyHttpAgent = new http.Agent({ lookup: mediaProxyLookup });
const mediaProxyHttpsAgent = new https.Agent({ lookup: mediaProxyLookup });

function mediaProxyAgent(parsedUrl) {
  return parsedUrl.protocol === 'https:' ? mediaProxyHttpsAgent : mediaProxyHttpAgent;
}

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
    requireAdmin,
    fetchImpl,
    auditLog,
  } = deps;

  function getSafePublicSettings() {
    const allowedKeys = new Set(
      String(process.env.PUBLIC_APP_SETTING_KEYS || 'crm_archive_state,equipment_type_settings,theme')
        .split(',')
        .map(key => key.trim())
        .filter(Boolean),
    );
    return (readData('app_settings') || [])
      .filter(item => allowedKeys.has(String(item?.key || '').trim()))
      .map(item => ({ key: item.key, value: item.value }));
  }

  app.post('/api/sync', requireAuth, requireAdmin, async (req, res) => {
    if (process.env.ENABLE_LEGACY_SYNC !== '1') {
      return res.status(410).json({
        ok: false,
        error: 'Legacy sync отключён. Используйте обычные авторизованные CRUD API.',
      });
    }

    try {
      const {
        equipment,
        rentals,
        gantt_rentals,
        service,
        warranty_claims,
        clients,
        payments,
        company_expenses,
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
      if (warranty_claims) writeData('warranty_claims', warranty_claims);
      if (clients) writeData('clients', clients);
      if (payments) writeData('payments', payments);
      if (company_expenses) writeData('company_expenses', company_expenses);
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
      auditLog?.(req, {
        action: 'sync.bulk',
        entityType: 'sync',
        after: { collections: Object.keys(req.body || {}), notifications: notifications.length },
      });
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

  app.get('/api/public-settings', (_req, res) => {
    res.json(getSafePublicSettings());
  });

  app.get('/api/bot-test', requireAuth, requireAdmin, async (req, res) => {
    if (process.env.ENABLE_BOT_TEST !== '1') {
      return res.status(404).json({ ok: false, error: 'Bot test endpoint disabled' });
    }

    const chatId = Number(req.query.chatId) || 134374193;
    const text = req.query.text || 'Тест бота';
    try {
      const result = await sendMessage({ chat_id: chatId }, text);
      res.json({ ok: true, chatId, text, maxApiResponse: result });
    } catch (err) {
      res.json({ ok: false, error: err.message, stack: err.stack });
    }
  });

  app.get('/api/status', requireAuth, requireAdmin, (req, res) => {
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

    try {
      const parsedUrl = await assertPublicHttpUrl(sourceUrl);
      const upstream = await fetchImpl(parsedUrl.toString(), {
        headers: {
          'user-agent': 'Rental-Management-MediaProxy/1.0',
          'accept': '*/*',
        },
        agent: mediaProxyAgent(parsedUrl),
        redirect: 'manual',
        size: MAX_MEDIA_PROXY_BYTES,
        timeout: MEDIA_PROXY_TIMEOUT_MS,
      });

      if (upstream.status >= 300 && upstream.status < 400) {
        return res.status(400).json({ ok: false, error: 'Редиректы внешних файлов не поддерживаются.' });
      }

      if (!upstream.ok) {
        return res.status(502).json({ ok: false, error: `Источник вернул ${upstream.status}` });
      }

      const declaredLength = Number(upstream.headers.get('content-length') || 0);
      if (declaredLength > MAX_MEDIA_PROXY_BYTES) {
        return res.status(413).json({ ok: false, error: 'Файл слишком большой для прокси.' });
      }

      const buffer = await upstream.buffer();
      if (buffer.length > MAX_MEDIA_PROXY_BYTES) {
        return res.status(413).json({ ok: false, error: 'Файл слишком большой для прокси.' });
      }
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const fileName = (parsedUrl.pathname.split('/').pop() || 'media.bin')
        .replace(/["\r\n\\]/g, '_')
        .slice(0, 160) || 'media.bin';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(buffer.length));
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
