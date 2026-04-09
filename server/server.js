/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Rental Management — Backend Server + MAX Bot                   ║
 * ║  Node.js + Express                                              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Что умеет:
 *  1. Хранит данные в SQLite (аренды, техника, сервис, клиенты)
 *  2. REST CRUD API для всех сущностей
 *  3. Сессионная аутентификация (Bearer-токен, 24ч TTL)
 *  4. Серверная RBAC (права по роли на запись)
 *  5. Принимает bulk-replace синхронизацию из браузера
 *  6. Обрабатывает webhook от MAX бота
 *  7. Отправляет уведомления в MAX при новых арендах/просрочках/заявках
 *
 * Команды бота:
 *  /start <email> <пароль>  — авторизация
 *  /аренды                  — мои активные аренды
 *  /техника                 — свободная техника
 *  /сервис                  — открытые заявки
 *  /помощь                  — список команд
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const crypto  = require('crypto');
const { DB_PATH, getData, setData, migrateJsonFilesToDb } = require('./db');

// ── Пароли (совместимо с frontend userStorage.ts) ─────────────────────────────

const HASH_PREFIX = 'h1:';
const HASH_SALT   = 'rental-mgmt-v1';

function hashPassword(plain) {
  const hex = crypto.createHash('sha256').update(plain + ':' + HASH_SALT).digest('hex');
  return HASH_PREFIX + hex;
}

function verifyPassword(plain, stored) {
  if (stored && stored.startsWith(HASH_PREFIX)) {
    return hashPassword(plain) === stored;
  }
  return plain === stored; // legacy plain-text
}

// ── Express ───────────────────────────────────────────────────────────────────

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '20mb' }));

const ALLOWED_ORIGINS = [
  'https://rishatkznai.github.io',        // GitHub Pages (production)
  'http://localhost:5173',                 // Vite dev server
  'http://localhost:4173',                 // Vite preview
  ...(process.env.CORS_ORIGIN             // Railway / любой другой домен через env
    ? process.env.CORS_ORIGIN.split(',').map(s => s.trim())
    : []),
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true); // curl / server-to-server
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    console.warn(`[CORS] Blocked origin: ${origin}`);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
  credentials: true,
}));

// ── Конфигурация ───────────────────────────────────────────────────────────────

const BOT_TOKEN = process.env.BOT_TOKEN || '';
const MAX_API   = 'https://botapi.max.ru';

function readData(name) {
  return getData(name);
}

function writeData(name, data) {
  setData(name, data);
}

function getBotUsers()    { return readData('bot_users') || {}; }
function saveBotUsers(u)  { writeData('bot_users', u); }
function getSnapshot()    { return readData('snapshot') || {}; }
function saveSnapshot(s)  { writeData('snapshot', s); }

// ── Сессии (in-memory, Bearer-токен) ──────────────────────────────────────────

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 часа

/** Map<token, { userId, userName, userRole, email, createdAt }> */
const sessions = new Map();

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  sessions.set(token, {
    userId:    user.id,
    userName:  user.name,
    userRole:  user.role,
    email:     user.email,
    createdAt: Date.now(),
  });
  return token;
}

function getSession(token) {
  const session = sessions.get(token);
  if (!session) return null;
  if (Date.now() - session.createdAt > SESSION_TTL) {
    sessions.delete(token);
    return null;
  }
  return session;
}

function destroySession(token) {
  sessions.delete(token);
}

// Чистим протухшие сессии каждый час
setInterval(() => {
  const now = Date.now();
  for (const [token, session] of sessions.entries()) {
    if (now - session.createdAt > SESSION_TTL) sessions.delete(token);
  }
}, 3600_000);

// ── RBAC ──────────────────────────────────────────────────────────────────────

// Права на запись по коллекциям
const WRITE_PERMISSIONS = {
  equipment:      ['Администратор'],
  rentals:        ['Администратор', 'Менеджер по аренде'],
  gantt_rentals:  ['Администратор', 'Менеджер по аренде'],
  service:        ['Администратор', 'Механик'],
  clients:        ['Администратор', 'Менеджер по аренде'],
  documents:      ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  payments:       ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  users:          ['Администратор'],
  shipping_photos:['Администратор', 'Механик', 'Менеджер по аренде'],
  owners:         ['Администратор'],
};

// ── Middleware ─────────────────────────────────────────────────────────────────

function requireAuth(req, res, next) {
  const auth = req.headers['authorization'];
  if (!auth || !auth.startsWith('Bearer ')) {
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }
  const token = auth.slice(7);
  const session = getSession(token);
  if (!session) {
    return res.status(401).json({ ok: false, error: 'Session expired or invalid' });
  }
  req.user = session;
  next();
}

function requireWrite(collection) {
  return (req, res, next) => {
    const allowed = WRITE_PERMISSIONS[collection] || ['Администратор'];
    if (!allowed.includes(req.user.userRole)) {
      return res.status(403).json({ ok: false, error: 'Forbidden: insufficient role' });
    }
    next();
  };
}

function sanitizeUser(user) {
  if (!user) return user;
  const { password, ...safeUser } = user;
  return safeUser;
}

function publicUserView(user) {
  const safeUser = sanitizeUser(user);
  if (!safeUser) return safeUser;
  return {
    id: safeUser.id,
    name: safeUser.name,
    role: safeUser.role,
    status: safeUser.status,
  };
}

function canReadFullUsers(req) {
  return req.user?.userRole === 'Администратор';
}

// ── Auth endpoints ────────────────────────────────────────────────────────────

/**
 * POST /api/auth/login
 * Body: { email, password }
 * Returns: { ok, token, user }
 */
app.post('/api/auth/login', (req, res) => {
  try {
    const { email, password } = req.body || {};
    if (!email || !password) {
      return res.status(400).json({ ok: false, error: 'email and password required' });
    }

    const users = readData('users') || [];
    const user = users.find(
      u => u.email.toLowerCase() === email.toLowerCase() &&
           verifyPassword(password, u.password) &&
           u.status === 'Активен'
    );

    if (!user) {
      return res.status(401).json({ ok: false, error: 'Неверный email или пароль' });
    }

    const token = createSession(user);
    console.log(`[AUTH] Вход: ${user.name} (${user.role})`);

    res.json({
      ok: true,
      token,
      user: {
        id:    user.id,
        name:  user.name,
        email: user.email,
        role:  user.role,
      },
    });
  } catch (err) {
    console.error('[AUTH] login error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/auth/me
 * Returns current session user
 */
app.get('/api/auth/me', requireAuth, (req, res) => {
  res.json({ ok: true, user: req.user });
});

/**
 * POST /api/auth/logout
 * Invalidates the current session
 */
app.post('/api/auth/logout', requireAuth, (req, res) => {
  const token = req.headers['authorization'].slice(7);
  destroySession(token);
  res.json({ ok: true });
});

// ── Generic CRUD factory ──────────────────────────────────────────────────────

function generateId(prefix) {
  return `${prefix}-${Date.now()}-${crypto.randomBytes(3).toString('hex')}`;
}

const ID_PREFIXES = {
  equipment:      'eq',
  rentals:        'R',
  gantt_rentals:  'GR',
  service:        'S',
  clients:        'C',
  documents:      'D',
  payments:       'P',
  users:          'U',
  shipping_photos:'SP',
  owners:         'OW',
};

function registerCRUD(router, collection) {
  const prefix = ID_PREFIXES[collection] || collection;

  // GET /api/:collection — список
  router.get(`/${collection}`, requireAuth, (req, res) => {
    const data = readData(collection) || [];
    if (collection === 'users') {
      if (canReadFullUsers(req)) {
        return res.json(data.map(sanitizeUser));
      }
      return res.json(data.filter(u => u.status === 'Активен').map(publicUserView));
    }
    res.json(data);
  });

  // GET /api/:collection/:id — один элемент
  router.get(`/${collection}/:id`, requireAuth, (req, res) => {
    const data = readData(collection) || [];
    const item = data.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
    if (collection === 'users') {
      if (canReadFullUsers(req) || item.id === req.user.userId) {
        return res.json(sanitizeUser(item));
      }
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    res.json(item);
  });

  // POST /api/:collection — создать
  router.post(`/${collection}`, requireAuth, requireWrite(collection), (req, res) => {
    const data = readData(collection) || [];
    const newItem = { ...req.body, id: req.body.id || generateId(prefix) };
    data.push(newItem);
    writeData(collection, data);
    if (collection === 'users') {
      return res.status(201).json(sanitizeUser(newItem));
    }
    res.status(201).json(newItem);
  });

  // PATCH /api/:collection/:id — обновить
  router.patch(`/${collection}/:id`, requireAuth, requireWrite(collection), (req, res) => {
    const data = readData(collection) || [];
    const idx = data.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
    data[idx] = { ...data[idx], ...req.body, id: data[idx].id };
    writeData(collection, data);
    if (collection === 'users') {
      return res.json(sanitizeUser(data[idx]));
    }
    res.json(data[idx]);
  });

  // DELETE /api/:collection/:id — удалить
  router.delete(`/${collection}/:id`, requireAuth, requireWrite(collection), (req, res) => {
    const data = readData(collection) || [];
    const idx = data.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
    data.splice(idx, 1);
    writeData(collection, data);
    res.json({ ok: true });
  });

  // PUT /api/:collection — bulk replace (для синхронизации)
  router.put(`/${collection}`, requireAuth, requireWrite(collection), (req, res) => {
    const body = req.body;
    const list = Array.isArray(body) ? body : body.data;
    if (!Array.isArray(list)) {
      return res.status(400).json({ ok: false, error: 'Expected array' });
    }
    writeData(collection, list);
    res.json({ ok: true, count: list.length });
  });
}

const apiRouter = express.Router();

const COLLECTIONS = [
  'equipment',
  'rentals',
  'gantt_rentals',
  'service',
  'clients',
  'documents',
  'payments',
  'users',
  'shipping_photos',
  'owners',
];

for (const col of COLLECTIONS) {
  registerCRUD(apiRouter, col);
}

app.use('/api', apiRouter);

// ── Seed default admin ────────────────────────────────────────────────────────

function seedDefaultUsers() {
  const existing = readData('users');
  if (existing && existing.length > 0) return; // уже есть данные

  const defaultAdmin = {
    id:       'U-default-admin',
    name:     'Администратор',
    email:    'admin@rental.local',
    role:     'Администратор',
    status:   'Активен',
    password: hashPassword('admin123'),
  };

  writeData('users', [defaultAdmin]);
  console.log('[INIT] Создан дефолтный пользователь: admin@rental.local / admin123');
  console.log('[INIT] ⚠️  Обязательно смените пароль в настройках!');
}

// ── MAX Bot API ────────────────────────────────────────────────────────────────

async function maxRequest(method, endpoint, body = null) {
  const url = `${MAX_API}${endpoint}`;
  const opts = {
    method,
    headers: {
      'Authorization': `Bearer ${BOT_TOKEN}`,
      'Content-Type':  'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  try {
    const res  = await fetch(url, opts);
    const json = await res.json();
    return json;
  } catch (err) {
    console.error('[MAX API] Ошибка:', err.message);
    return null;
  }
}

async function sendMessage(userId, text) {
  return maxRequest('POST', '/messages', {
    recipient: { user_id: userId },
    body:      { type: 'text', text },
  });
}

async function registerWebhook() {
  if (!BOT_TOKEN) return;
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('[BOT] WEBHOOK_URL не задан — пропускаем регистрацию.');
    return;
  }
  const res = await maxRequest('POST', '/subscriptions', {
    url:          `${webhookUrl}/bot/webhook`,
    update_types: ['message_created'],
  });
  if (res && !res.error) {
    console.log(`[BOT] Webhook зарегистрирован: ${webhookUrl}/bot/webhook`);
  } else {
    console.error('[BOT] Ошибка регистрации webhook:', res?.message || res);
  }
}

// ── Авторизация пользователя бота ──────────────────────────────────────────────

function authorizeUser(phone, email, password) {
  const users = readData('users') || [];
  const found = users.find(
    u => u.email.toLowerCase() === email.toLowerCase() &&
         verifyPassword(password, u.password) &&
         u.status === 'Активен'
  );
  if (!found) return null;

  const botUsers = getBotUsers();
  botUsers[phone] = {
    userId:   found.id,
    userName: found.name,
    userRole: found.role,
    email:    found.email,
  };
  saveBotUsers(botUsers);
  return found;
}

function getAuthorizedUser(phone) {
  return getBotUsers()[phone] || null;
}

// ── Обработчики команд бота ────────────────────────────────────────────────────

function formatRentals(rentals, managerName, role) {
  const filtered = (role === 'Менеджер по аренде')
    ? rentals.filter(r => r.manager === managerName && (r.status === 'active' || r.status === 'created'))
    : rentals.filter(r => r.status === 'active' || r.status === 'created');

  if (!filtered.length) return '📋 Активных аренд нет.';

  const lines = filtered.slice(0, 10).map(r => {
    const end = r.endDate ? `до ${r.endDate}` : '';
    return `• ${r.equipmentInv} → ${r.client} ${end}`.trim();
  });

  const header = role === 'Менеджер по аренде'
    ? `📋 Ваши активные аренды (${filtered.length}):`
    : `📋 Все активные аренды (${filtered.length}):`;

  return [header, ...lines, filtered.length > 10 ? `... и ещё ${filtered.length - 10}` : '']
    .filter(Boolean).join('\n');
}

function formatEquipment(equipment) {
  const free = equipment.filter(e => e.status === 'available');
  if (!free.length) return '🚧 Свободной техники нет.';

  const lines = free.slice(0, 10).map(e =>
    `• ${e.inventoryNumber} — ${e.model} (${e.type === 'scissor' ? 'Ножничный' : e.type === 'articulated' ? 'Коленчатый' : 'Телескопический'})`
  );

  return [`🟢 Свободная техника (${free.length}):`, ...lines,
    free.length > 10 ? `... и ещё ${free.length - 10}` : ''].filter(Boolean).join('\n');
}

function formatService(tickets) {
  const open = tickets.filter(t => t.status !== 'closed');
  if (!open.length) return '✅ Открытых заявок нет.';

  const priorityIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };

  const lines = open.slice(0, 10).map(t => {
    const icon = priorityIcon[t.priority] || '⚪';
    return `${icon} ${t.id} — ${t.equipment}: ${t.reason}`;
  });

  return [`🔧 Открытые сервисные заявки (${open.length}):`, ...lines,
    open.length > 10 ? `... и ещё ${open.length - 10}` : ''].filter(Boolean).join('\n');
}

function getHelpText(role) {
  return [
    '',
    '📱 Доступные команды:',
    '',
    `  /аренды    — активные аренды${role === 'Менеджер по аренде' ? ' (только ваши)' : ''}`,
    '  /техника   — свободная техника',
    '  /сервис    — открытые сервисные заявки',
    '  /помощь    — этот список',
  ].join('\n');
}

async function handleCommand(senderId, phone, text) {
  const lower = text.trim().toLowerCase();
  const parts  = text.trim().split(/\s+/);

  if (lower.startsWith('/start')) {
    if (parts.length < 3) {
      return sendMessage(senderId,
        '👋 Добро пожаловать в бот «Подъёмники»!\n\nДля входа напишите:\n/start email@company.ru пароль'
      );
    }
    const [, email, password] = parts;
    const user = authorizeUser(String(phone), email, password);
    if (!user) {
      return sendMessage(senderId,
        '❌ Неверный email или пароль, либо аккаунт деактивирован.\n\nПопробуйте снова:\n/start email@company.ru пароль'
      );
    }
    return sendMessage(senderId,
      `✅ Вы вошли как ${user.name} (${user.role})\n${getHelpText(user.role)}`
    );
  }

  const authUser = getAuthorizedUser(String(phone));
  if (!authUser) {
    return sendMessage(senderId,
      '🔒 Вы не авторизованы.\n\nНапишите:\n/start email@company.ru пароль'
    );
  }

  const { userName, userRole } = authUser;

  if (lower === '/аренды' || lower === '/rentals' || lower === '/мои' || lower === 'аренды') {
    const rentals = readData('rentals') || [];
    return sendMessage(senderId, formatRentals(rentals, userName, userRole));
  }

  if (lower === '/техника' || lower === '/equipment' || lower === 'техника') {
    const equipment = readData('equipment') || [];
    return sendMessage(senderId, formatEquipment(equipment));
  }

  if (lower === '/сервис' || lower === '/service' || lower === 'сервис' || lower === 'заявки') {
    const tickets = readData('service') || [];
    return sendMessage(senderId, formatService(tickets));
  }

  if (lower === '/помощь' || lower === '/help' || lower === 'помощь') {
    return sendMessage(senderId, getHelpText(userRole));
  }

  return sendMessage(senderId, `❓ Неизвестная команда. Напишите /помощь для списка команд.`);
}

// ── Webhook endpoint ───────────────────────────────────────────────────────────

app.post('/bot/webhook', async (req, res) => {
  res.sendStatus(200);

  try {
    const updates = req.body?.updates || [req.body];

    for (const update of updates) {
      if (update.update_type !== 'message_created') continue;

      const msg    = update.message;
      const sender = msg?.sender;
      if (!sender) continue;

      const senderId = sender.user_id;
      const phone    = sender.user_id;
      const text     = msg?.body?.text || '';

      if (!text.trim()) continue;

      console.log(`[BOT] [${sender.name || senderId}] ${text}`);
      await handleCommand(senderId, phone, text);
    }
  } catch (err) {
    console.error('[BOT] Ошибка обработки webhook:', err.message);
  }
});

// ── Bulk sync (legacy endpoint, сохраняем совместимость) ─────────────────────

app.post('/api/sync', async (req, res) => {
  try {
    const { equipment, rentals, gantt_rentals, service, clients, payments, users, documents, shipping_photos } = req.body;
    const prev = getSnapshot();
    const now  = Date.now();

    if (equipment)       writeData('equipment',       equipment);
    if (rentals)         writeData('rentals',         rentals);
    if (gantt_rentals)   writeData('gantt_rentals',   gantt_rentals);
    if (service)         writeData('service',         service);
    if (clients)         writeData('clients',         clients);
    if (payments)        writeData('payments',        payments);
    if (users)           writeData('users',           users);
    if (documents)       writeData('documents',       documents);
    if (shipping_photos) writeData('shipping_photos', shipping_photos);

    const notifications = [];

    if (rentals && prev.rentals) {
      const prevIds = new Set((prev.rentals || []).map(r => r.id));

      const newRentals = rentals.filter(r => !prevIds.has(r.id));
      for (const r of newRentals) {
        notifications.push({
          role: 'all',
          managerName: r.manager,
          text: `🆕 Новая аренда!\n${r.equipmentInv} → ${r.client}\nМенеджер: ${r.manager}\nПериод: ${r.startDate} — ${r.endDate}`,
        });
      }

      if (service && prev.service) {
        const prevServiceIds = new Set((prev.service || []).map(t => t.id));
        const newTickets = service.filter(t => !prevServiceIds.has(t.id));
        for (const t of newTickets) {
          notifications.push({
            role: 'mechanic',
            text: `🔧 Новая сервисная заявка!\n${t.equipment}: ${t.reason}\nПриоритет: ${t.priority}`,
          });
        }
      }

      const lastOverdueCheck = prev.lastOverdueCheck || 0;
      if (now - lastOverdueCheck > 3600_000) {
        const today = new Date().toISOString().slice(0, 10);
        const overdue = rentals.filter(r =>
          r.status === 'active' && r.endDate && r.endDate < today
        );
        for (const r of overdue) {
          notifications.push({
            role: 'manager',
            managerName: r.manager,
            text: `⚠️ Просроченный возврат!\n${r.equipmentInv} — ${r.client}\nДолжен был вернуть: ${r.endDate}`,
          });
        }
        prev.lastOverdueCheck = now;
      }
    }

    saveSnapshot({ ...req.body, lastOverdueCheck: prev.lastOverdueCheck || 0 });

    if (notifications.length && BOT_TOKEN) {
      const botUsers    = getBotUsers();
      const systemUsers = users || readData('users') || [];

      for (const notif of notifications) {
        for (const [phone, bu] of Object.entries(botUsers)) {
          const shouldNotify =
            notif.role === 'all' ||
            (notif.role === 'mechanic' && bu.userRole === 'Механик') ||
            (notif.role === 'manager' && bu.userName === notif.managerName);

          if (shouldNotify) {
            await sendMessage(Number(phone), notif.text);
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

// ── Health check (Railway, uptime monitors) ───────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ ok: true, uptime: Math.round(process.uptime()) });
});

app.get('/', (req, res) => {
  res.json({ ok: true, service: 'rental-management-api', uptime: Math.round(process.uptime()) });
});

// ── Статус сервера ─────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const equipment = readData('equipment') || [];
  const rentals   = readData('rentals')   || [];
  const service   = readData('service')   || [];
  const botUsers  = getBotUsers();

  res.json({
    ok: true,
    uptime:   Math.round(process.uptime()),
    sessions: sessions.size,
    data: {
      equipment: equipment.length,
      rentals:   rentals.length,
      service:   service.length,
    },
    botToken: BOT_TOKEN ? '✅ задан' : '❌ не задан',
    botUsers: Object.keys(botUsers).length,
    webhook:  process.env.WEBHOOK_URL || '(не задан)',
  });
});

// ── Запуск ─────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  migrateJsonFilesToDb();
  seedDefaultUsers();

  console.log('');
  console.log('╔══════════════════════════════════════════════════════╗');
  console.log('║  Rental Management Server — запущен!                 ║');
  console.log(`║  http://localhost:${PORT}                                ║`);
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  POST /api/auth/login  — вход, получить токен        ║');
  console.log('║  GET  /api/auth/me     — текущий пользователь        ║');
  console.log('║  POST /api/auth/logout — выход                       ║');
  console.log('║  GET  /api/equipment   — список техники               ║');
  console.log('║  GET  /api/clients     — клиенты                     ║');
  console.log('║  GET  /api/service     — сервисные заявки            ║');
  console.log('║  GET  /api/rentals     — аренды                      ║');
  console.log('║  GET  /api/payments    — платежи                     ║');
  console.log('║  ... и ещё 5 коллекций (PATCH/POST/DELETE/PUT)       ║');
  console.log('╠══════════════════════════════════════════════════════╣');
  console.log('║  POST /api/sync        — bulk sync (legacy)          ║');
  console.log('║  GET  /api/status      — статус сервера              ║');
  console.log('║  POST /bot/webhook     — MAX бот webhook             ║');
  console.log('╚══════════════════════════════════════════════════════╝');
  console.log('');
  console.log(`[DB] SQLite: ${DB_PATH}`);
  console.log('');

  if (!BOT_TOKEN) {
    console.log('⚠️  BOT_TOKEN не задан. Создайте файл .env:');
    console.log('   BOT_TOKEN=ваш_токен_от_MAX');
    console.log('');
  }

  await registerWebhook();
});
