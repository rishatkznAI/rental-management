/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  Rental Management — Backend Server + MAX Bot                   ║
 * ║  Node.js + Express                                              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Что умеет:
 *  1. Хранит данные в JSON-файлах (аренды, техника, сервис, клиенты)
 *  2. Принимает синхронизацию из браузера (localStorage → сервер)
 *  3. Обрабатывает webhook от MAX бота
 *  4. Отправляет уведомления в MAX при новых арендах/просрочках/заявках
 *
 * Команды бота:
 *  /start <email> <пароль>  — авторизация
 *  /аренды                  — мои активные аренды
 *  /техника                 — свободная техника
 *  /сервис                  — открытые заявки
 *  /помощь                  — список команд
 */

require('dotenv').config();
const express  = require('express');
const cors     = require('cors');
const fs       = require('fs');
const path     = require('path');
const fetch    = require('node-fetch');
const crypto   = require('crypto');

// ── Проверка паролей (совместима с frontend userStorage.ts) ───────────────────
// Frontend хранит пароли как 'h1:<sha256hex(plain + ":rental-mgmt-v1")>'
// При legacy plain-text паролях проверяем прямое сравнение для обратной совместимости

const HASH_PREFIX = 'h1:';
const HASH_SALT   = 'rental-mgmt-v1';

function hashPassword(plain) {
  const hex = crypto.createHash('sha256').update(plain + ':' + HASH_SALT).digest('hex');
  return HASH_PREFIX + hex;
}

function verifyPassword(plain, stored) {
  if (stored.startsWith(HASH_PREFIX)) {
    return hashPassword(plain) === stored;
  }
  // Обратная совместимость: legacy plain-text пароль
  return plain === stored;
}

const app  = express();
const PORT = process.env.PORT || 3000;

app.use(express.json({ limit: '10mb' }));
const ALLOWED_ORIGINS = [
  'https://rishatknai.github.io',
  'http://localhost:5173',
  'http://localhost:4173',
];
app.use(cors({
  origin: (origin, callback) => {
    // allow requests with no origin (curl, mobile apps)
    if (!origin) return callback(null, true);
    if (ALLOWED_ORIGINS.includes(origin)) return callback(null, true);
    callback(new Error(`CORS: origin ${origin} not allowed`));
  },
}));

// ── Конфигурация ───────────────────────────────────────────────────────────────

const BOT_TOKEN  = process.env.BOT_TOKEN  || '';
const MAX_API    = 'https://botapi.max.ru';
const DATA_DIR   = path.join(__dirname, 'data');

// ── Хелперы для работы с JSON-файлами ──────────────────────────────────────────

function filePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readData(name) {
  try {
    const raw = fs.readFileSync(filePath(name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function writeData(name, data) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(filePath(name), JSON.stringify(data, null, 2), 'utf8');
}

// Таблица маппинга: phone → { userId, userName, userRole }
function getBotUsers() { return readData('bot_users') || {}; }
function saveBotUsers(u) { writeData('bot_users', u); }

// Хранилище "последнего снимка" для определения изменений
function getSnapshot() { return readData('snapshot') || {}; }
function saveSnapshot(s) { writeData('snapshot', s); }

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

// ── Регистрация webhook в MAX ──────────────────────────────────────────────────

async function registerWebhook() {
  if (!BOT_TOKEN) return;
  const webhookUrl = process.env.WEBHOOK_URL;
  if (!webhookUrl) {
    console.log('[BOT] WEBHOOK_URL не задан — пропускаем регистрацию.');
    console.log('[BOT] Укажите WEBHOOK_URL=https://xxx.ngrok.io в .env и перезапустите.');
    return;
  }
  const res = await maxRequest('POST', '/subscriptions', {
    url:    `${webhookUrl}/bot/webhook`,
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
  const botUsers = getBotUsers();
  return botUsers[phone] || null;
}

// ── Обработчики команд бота ────────────────────────────────────────────────────

function formatRentals(rentals, managerName, role) {
  // Администратор и Офис-менеджер видят все аренды, менеджер — только свои
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

function formatService(tickets, role) {
  const open = (role === 'Механик')
    ? tickets.filter(t => t.status !== 'closed')
    : tickets.filter(t => t.status !== 'closed');

  if (!open.length) return '✅ Открытых заявок нет.';

  const priorityIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };

  const lines = open.slice(0, 10).map(t => {
    const icon = priorityIcon[t.priority] || '⚪';
    return `${icon} ${t.id} — ${t.equipment}: ${t.reason}`;
  });

  return [`🔧 Открытые сервисные заявки (${open.length}):`, ...lines,
    open.length > 10 ? `... и ещё ${open.length - 10}` : ''].filter(Boolean).join('\n');
}

async function handleCommand(senderId, phone, text) {
  const lower = text.trim().toLowerCase();
  const parts = text.trim().split(/\s+/);

  // ── /start email пароль ──
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
      `✅ Вы вошли как ${user.name} (${user.role})\n\n${getHelpText(user.role)}`
    );
  }

  // Проверяем авторизацию для остальных команд
  const authUser = getAuthorizedUser(String(phone));
  if (!authUser) {
    return sendMessage(senderId,
      '🔒 Вы не авторизованы.\n\nНапишите:\n/start email@company.ru пароль'
    );
  }

  const { userName, userRole } = authUser;

  // ── /аренды ──
  if (lower === '/аренды' || lower === '/rentals' || lower === '/мои' || lower === 'аренды') {
    const rentals = readData('rentals') || [];
    return sendMessage(senderId, formatRentals(rentals, userName, userRole));
  }

  // ── /техника ──
  if (lower === '/техника' || lower === '/equipment' || lower === 'техника' || lower === 'свободная техника') {
    const equipment = readData('equipment') || [];
    return sendMessage(senderId, formatEquipment(equipment));
  }

  // ── /сервис ──
  if (lower === '/сервис' || lower === '/service' || lower === 'сервис' || lower === 'заявки') {
    const tickets = readData('service') || [];
    return sendMessage(senderId, formatService(tickets, userRole));
  }

  // ── /помощь ──
  if (lower === '/помощь' || lower === '/help' || lower === 'помощь') {
    return sendMessage(senderId, getHelpText(userRole));
  }

  // ── Неизвестная команда ──
  return sendMessage(senderId,
    `❓ Неизвестная команда. Напишите /помощь для списка команд.`
  );
}

function getHelpText(role) {
  const cmds = [
    '',
    '📱 Доступные команды:',
    '',
    '  /аренды    — активные аренды' + (role === 'Менеджер по аренде' ? ' (только ваши)' : ''),
    '  /техника   — свободная техника',
    role !== 'Механик' ? null : null,
    '  /сервис    — открытые сервисные заявки',
    '  /помощь    — этот список',
  ].filter(l => l !== null);

  return cmds.join('\n');
}

// ── Webhook endpoint ───────────────────────────────────────────────────────────

app.post('/bot/webhook', async (req, res) => {
  res.sendStatus(200); // отвечаем MAX сразу

  try {
    const updates = req.body?.updates || [req.body];

    for (const update of updates) {
      if (update.update_type !== 'message_created') continue;

      const msg    = update.message;
      const sender = msg?.sender;
      if (!sender) continue;

      const senderId = sender.user_id;
      const phone    = sender.user_id; // MAX не всегда даёт номер, используем user_id как ключ
      const text     = msg?.body?.text || '';

      if (!text.trim()) continue;

      console.log(`[BOT] [${sender.name || senderId}] ${text}`);
      await handleCommand(senderId, phone, text);
    }
  } catch (err) {
    console.error('[BOT] Ошибка обработки webhook:', err.message);
  }
});

// ── API синхронизации данных из браузера ───────────────────────────────────────

/**
 * POST /api/sync
 * Body: { equipment, rentals, service, clients, payments, users }
 * Браузер отправляет все данные из localStorage — сервер сохраняет их в файлы
 * и проверяет: нет ли новых аренд или просроченных возвратов для уведомлений.
 */
app.post('/api/sync', async (req, res) => {
  try {
    const { equipment, rentals, service, clients, payments, users } = req.body;
    const prev = getSnapshot();
    const now  = Date.now();

    // Сохраняем данные
    if (equipment) writeData('equipment', equipment);
    if (rentals)   writeData('rentals',   rentals);
    if (service)   writeData('service',   service);
    if (clients)   writeData('clients',   clients);
    if (payments)  writeData('payments',  payments);
    if (users)     writeData('users',     users);

    // ── Проверяем изменения для уведомлений ──────────────────────────────────

    const notifications = [];

    if (rentals && prev.rentals) {
      const prevIds = new Set((prev.rentals || []).map(r => r.id));

      // Новые аренды
      const newRentals = rentals.filter(r => !prevIds.has(r.id));
      for (const r of newRentals) {
        notifications.push({
          role: 'all',
          managerName: r.manager,
          text: `🆕 Новая аренда!\n${r.equipmentInv} → ${r.client}\nМенеджер: ${r.manager}\nПериод: ${r.startDate} — ${r.endDate}`,
        });
      }

      // Новые сервисные заявки
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

      // Просроченные возвраты (проверяем раз в час)
      const lastOverdueCheck = prev.lastOverdueCheck || 0;
      if (now - lastOverdueCheck > 3600_000) {
        const today = new Date().toISOString().slice(0, 10);
        const overdue = rentals.filter(r =>
          (r.status === 'active') && r.endDate && r.endDate < today
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

    // Обновляем снимок
    saveSnapshot({ ...req.body, lastOverdueCheck: prev.lastOverdueCheck || 0 });

    // ── Отправляем уведомления авторизованным пользователям ──────────────────

    if (notifications.length && BOT_TOKEN) {
      const botUsers   = getBotUsers();
      const systemUsers = users || readData('users') || [];

      for (const notif of notifications) {
        for (const [phone, bu] of Object.entries(botUsers)) {
          const shouldNotify =
            notif.role === 'all' ||
            (notif.role === 'mechanic' && bu.userRole === 'Механик') ||
            (notif.role === 'manager' && bu.userName === notif.managerName) ||
            (notif.managerName === bu.userName);

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

// ── Статус сервера ─────────────────────────────────────────────────────────────

app.get('/api/status', (req, res) => {
  const equipment = readData('equipment') || [];
  const rentals   = readData('rentals')   || [];
  const service   = readData('service')   || [];
  const botUsers  = getBotUsers();

  res.json({
    ok: true,
    uptime:    Math.round(process.uptime()),
    data: {
      equipment: equipment.length,
      rentals:   rentals.length,
      service:   service.length,
    },
    botToken:  BOT_TOKEN ? '✅ задан' : '❌ не задан',
    botUsers:  Object.keys(botUsers).length,
    webhook:   process.env.WEBHOOK_URL || '(не задан)',
  });
});

// ── Запуск ─────────────────────────────────────────────────────────────────────

app.listen(PORT, async () => {
  console.log('');
  console.log('╔══════════════════════════════════════════════╗');
  console.log('║  Rental Management Server — запущен!         ║');
  console.log(`║  http://localhost:${PORT}                        ║`);
  console.log('╠══════════════════════════════════════════════╣');
  console.log(`║  POST /api/sync    — синхронизация данных    ║`);
  console.log(`║  GET  /api/status  — статус сервера          ║`);
  console.log(`║  POST /bot/webhook — MAX бот webhook         ║`);
  console.log('╚══════════════════════════════════════════════╝');
  console.log('');

  if (!BOT_TOKEN) {
    console.log('⚠️  BOT_TOKEN не задан. Создайте файл .env:');
    console.log('   BOT_TOKEN=ваш_токен_от_MAX');
    console.log('');
  }

  await registerWebhook();
});
