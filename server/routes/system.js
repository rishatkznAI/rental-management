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

const SYSTEM_DATA_COLLECTIONS = [
  'equipment',
  'rentals',
  'clients',
  'service',
  'documents',
  'payments',
  'deliveries',
  'users',
  'owners',
  'mechanics',
  'delivery_carriers',
  'app_settings',
];

const SYSTEM_DATA_COLLECTION_SET = new Set(SYSTEM_DATA_COLLECTIONS);
const SENSITIVE_KEY_PATTERN = /(password|passhash|token|secret|apikey|api_key|authorization|cookie|session|webhook)/i;

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeSystemValue(value, stats) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeSystemValue(item, stats));
  }
  if (!isPlainObject(value)) return value;

  return Object.entries(value).reduce((acc, [key, child]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      stats.strippedSensitiveFields += 1;
      return acc;
    }
    acc[key] = sanitizeSystemValue(child, stats);
    return acc;
  }, {});
}

function sanitizeSystemRecord(collection, record, stats) {
  const sanitized = sanitizeSystemValue(record, stats);
  if (collection === 'app_settings' && SENSITIVE_KEY_PATTERN.test(String(sanitized?.key || ''))) {
    stats.skippedSensitiveSettings += 1;
    return null;
  }
  return sanitized;
}

function normalizeSystemImportPayload(payload) {
  if (payload?.collections && isPlainObject(payload.collections)) return payload.collections;
  if (isPlainObject(payload)) {
    const knownKeys = Object.keys(payload).filter(key => SYSTEM_DATA_COLLECTION_SET.has(key));
    if (knownKeys.length > 0) {
      return knownKeys.reduce((acc, key) => {
        acc[key] = payload[key];
        return acc;
      }, {});
    }
  }
  return {};
}

function buildSystemDataExport(readData) {
  const stats = { strippedSensitiveFields: 0, skippedSensitiveSettings: 0 };
  const collections = {};
  for (const collection of SYSTEM_DATA_COLLECTIONS) {
    const source = readData(collection) || [];
    const list = Array.isArray(source) ? source : [];
    collections[collection] = list
      .map(item => sanitizeSystemRecord(collection, item, stats))
      .filter(item => item !== null);
  }
  return {
    ok: true,
    format: 'rental-management-system-data',
    version: 1,
    exportedAt: new Date().toISOString(),
    collections,
    warnings: [
      ...(stats.strippedSensitiveFields > 0 ? [`Удалено чувствительных полей: ${stats.strippedSensitiveFields}`] : []),
      ...(stats.skippedSensitiveSettings > 0 ? [`Пропущено чувствительных app_settings: ${stats.skippedSensitiveSettings}`] : []),
    ],
  };
}

function analyzeSystemDataImport(payload, readData) {
  const rawCollections = normalizeSystemImportPayload(payload);
  const unknownCollections = Object.keys(rawCollections).filter(name => !SYSTEM_DATA_COLLECTION_SET.has(name));
  const stats = { strippedSensitiveFields: 0, skippedSensitiveSettings: 0 };
  const collections = {};
  const duplicates = {};
  const conflicts = {};
  const invalidCollections = [];
  const sanitizedCollections = {};

  for (const collection of SYSTEM_DATA_COLLECTIONS) {
    if (!(collection in rawCollections)) continue;
    const rawValue = rawCollections[collection];
    if (!Array.isArray(rawValue)) {
      invalidCollections.push(collection);
      continue;
    }

    const sanitized = rawValue
      .map(item => sanitizeSystemRecord(collection, item, stats))
      .filter(item => item !== null);
    sanitizedCollections[collection] = sanitized;
    collections[collection] = {
      incoming: sanitized.length,
      existing: Array.isArray(readData(collection)) ? (readData(collection) || []).length : 0,
    };

    const seen = new Set();
    const duplicateIds = new Set();
    sanitized.forEach(item => {
      const id = String(item?.id || '').trim();
      if (!id) return;
      if (seen.has(id)) duplicateIds.add(id);
      seen.add(id);
    });
    if (duplicateIds.size > 0) duplicates[collection] = Array.from(duplicateIds);

    const existingById = new Map((readData(collection) || [])
      .filter(item => item?.id)
      .map(item => [String(item.id), sanitizeSystemRecord(collection, item, { strippedSensitiveFields: 0, skippedSensitiveSettings: 0 })]));
    const conflictIds = sanitized
      .filter(item => item?.id && existingById.has(String(item.id)))
      .filter(item => JSON.stringify(existingById.get(String(item.id))) !== JSON.stringify(item))
      .map(item => String(item.id));
    if (conflictIds.length > 0) conflicts[collection] = conflictIds.slice(0, 50);
  }

  const blockingErrors = [
    ...unknownCollections.map(name => `Неизвестная коллекция: ${name}`),
    ...invalidCollections.map(name => `Коллекция ${name} должна быть массивом`),
    ...Object.entries(duplicates).map(([name, ids]) => `Дубликаты id в ${name}: ${ids.join(', ')}`),
  ];

  return {
    ok: blockingErrors.length === 0,
    dryRun: true,
    collections,
    unknownCollections,
    duplicateIds: duplicates,
    conflicts,
    strippedSensitiveFields: stats.strippedSensitiveFields,
    skippedSensitiveSettings: stats.skippedSensitiveSettings,
    errors: blockingErrors,
    sanitizedCollections,
  };
}

function mergeImportedUsers(incoming, existingUsers) {
  const existingById = new Map((existingUsers || []).map(user => [String(user?.id || ''), user]));
  return incoming.map(user => {
    const existing = existingById.get(String(user?.id || ''));
    if (!existing) return user;
    const preserved = {};
    for (const [key, value] of Object.entries(existing)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) preserved[key] = value;
    }
    return { ...user, ...preserved };
  });
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
    analyzeGanttRentalLinks,
    backfillGanttRentalLinks,
    getBuildInfo,
    getRoleAccessSummary,
  } = deps;

  function buildInfo() {
    return typeof getBuildInfo === 'function' ? getBuildInfo() : null;
  }

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
    res.json({ ok: true, uptime: Math.round(process.uptime()), build: buildInfo() });
  });

  app.get('/', (req, res) => {
    res.json({ ok: true, service: 'rental-management-api', uptime: Math.round(process.uptime()), build: buildInfo() });
  });

  app.get('/api/version', (_req, res) => {
    res.json({ ok: true, build: buildInfo() });
  });

  app.get('/api/public-settings', (_req, res) => {
    res.json(getSafePublicSettings());
  });

  app.get('/api/bot-test', requireAuth, requireAdmin, async (req, res) => {
    if (process.env.ENABLE_BOT_TEST !== '1') {
      return res.status(404).json({ ok: false, error: 'Bot test endpoint disabled' });
    }

    const rawChatId = req.query.chatId ?? process.env.BOT_TEST_CHAT_ID;
    const chatId = Number(rawChatId);
    if (!Number.isFinite(chatId)) {
      return res.status(400).json({ ok: false, error: 'chatId is required for bot test endpoint' });
    }
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
      build: buildInfo(),
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

  app.get('/api/admin/production-diagnostics', requireAuth, requireAdmin, (req, res) => {
    const endpointCollections = {
      equipment: 'equipment',
      rentals: 'rentals',
      service: 'service',
      deliveries: 'deliveries',
      documents: 'documents',
      payments: 'payments',
    };

    const endpoints = Object.entries(endpointCollections).reduce((acc, [name, collection]) => {
      try {
        const data = readData(collection);
        acc[name] = {
          ok: true,
          collection,
          count: Array.isArray(data) ? data.length : (data && typeof data === 'object' ? Object.keys(data).length : 0),
        };
      } catch (error) {
        acc[name] = {
          ok: false,
          collection,
          error: error?.message || 'Endpoint check failed',
        };
      }
      return acc;
    }, {});

    const role = req.user?.userRole || '';
    const roleAccess = typeof getRoleAccessSummary === 'function'
      ? getRoleAccessSummary(role)
      : null;

    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      health: {
        ok: true,
        uptime: Math.round(process.uptime()),
      },
      backend: {
        build: buildInfo(),
      },
      user: {
        id: req.user?.userId || '',
        name: req.user?.userName || '',
        email: req.user?.email || '',
        rawRole: req.user?.rawRole || req.user?.userRole || '',
        normalizedRole: req.user?.normalizedRole || req.user?.userRole || '',
      },
      access: {
        readableCollections: roleAccess?.readableCollections || [],
        writableCollections: roleAccess?.writableCollections || [],
      },
      endpoints,
    });
  });

  app.get('/api/admin/system-data/export', requireAuth, requireAdmin, (req, res) => {
    const payload = buildSystemDataExport(readData);
    auditLog?.(req, {
      action: 'system_data.export',
      entityType: 'system_data',
      after: {
        collections: Object.fromEntries(Object.entries(payload.collections).map(([name, list]) => [name, list.length])),
        warnings: payload.warnings.length,
      },
    });
    return res.json(payload);
  });

  app.post('/api/admin/system-data/import/dry-run', requireAuth, requireAdmin, (req, res) => {
    const analysis = analyzeSystemDataImport(req.body, readData);
    const { sanitizedCollections, ...publicAnalysis } = analysis;
    return res.status(analysis.ok ? 200 : 400).json(publicAnalysis);
  });

  app.post('/api/admin/system-data/import', requireAuth, requireAdmin, (req, res) => {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ ok: false, error: 'Import requires confirm: true after dry-run.' });
    }

    const analysis = analyzeSystemDataImport(req.body, readData);
    if (!analysis.ok) {
      const { sanitizedCollections, ...publicAnalysis } = analysis;
      return res.status(400).json(publicAnalysis);
    }

    const imported = {};
    for (const [collection, list] of Object.entries(analysis.sanitizedCollections)) {
      const nextList = collection === 'users'
        ? mergeImportedUsers(list, readData('users') || [])
        : list;
      writeData(collection, nextList);
      imported[collection] = nextList.length;
    }

    auditLog?.(req, {
      action: 'system_data.import',
      entityType: 'system_data',
      after: {
        imported,
        conflicts: Object.fromEntries(Object.entries(analysis.conflicts).map(([name, ids]) => [name, ids.length])),
        strippedSensitiveFields: analysis.strippedSensitiveFields,
      },
    });

    const { sanitizedCollections, ...publicAnalysis } = analysis;
    return res.json({ ...publicAnalysis, ok: true, dryRun: false, imported });
  });

  app.get('/api/admin/rental-link-diagnostics', requireAuth, requireAdmin, (req, res) => {
    if (typeof analyzeGanttRentalLinks !== 'function') {
      return res.status(500).json({ ok: false, error: 'Rental link diagnostics unavailable' });
    }
    const diagnostics = analyzeGanttRentalLinks({
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      equipment: readData('equipment') || [],
      targetId: req.query.id || '',
      limit: req.query.limit || 100,
    });
    return res.json({ ok: true, diagnostics });
  });

  app.post('/api/admin/rental-link-diagnostics/backfill', requireAuth, requireAdmin, (req, res) => {
    if (typeof backfillGanttRentalLinks !== 'function' || typeof analyzeGanttRentalLinks !== 'function') {
      return res.status(500).json({ ok: false, error: 'Rental link backfill unavailable' });
    }
    const before = analyzeGanttRentalLinks({
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      equipment: readData('equipment') || [],
      targetId: req.body?.id || req.query.id || '',
      limit: req.body?.limit || req.query.limit || 100,
    });
    const backfill = backfillGanttRentalLinks({
      readData,
      writeData,
      logger: console,
      dryRun: req.body?.dryRun === true || req.query.dryRun === '1',
    });
    const after = analyzeGanttRentalLinks({
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      equipment: readData('equipment') || [],
      targetId: req.body?.id || req.query.id || '',
      limit: req.body?.limit || req.query.limit || 100,
    });
    auditLog?.(req, {
      action: 'rental_links.backfill',
      entityType: 'rental_links',
      after: {
        dryRun: backfill.dryRun,
        linked: backfill.linked,
        missingLink: backfill.missingLink,
        ambiguous: backfill.ambiguous.length,
        unresolved: backfill.unresolved.length,
      },
    });
    return res.json({ ok: true, before, backfill, after });
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
