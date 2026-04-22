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
 *  /моизаявки               — сервисные заявки механика
 *  /вработу <id>            — взять заявку в работу
 *  /ремонт <id>             — выбрать текущую заявку
 *  /итог <текст>            — сохранить итог ремонта
 *  /работы <поиск>          — найти работы в справочнике
 *  /добавитьработу <№> <qty>
 *  /запчасти <поиск>        — найти запчасти в справочнике
 *  /добавитьзапчасть <№> <qty> [цена]
 *  /черновик                — показать текущий отчет по ремонту
 *  /ожидание                — перевести в ожидание запчастей
 *  /готово                  — завершить работы
 *  /закрыть                 — закрыть заявку
 *  /сброс                   — сбросить текущую заявку
 *  /помощь                  — список команд
 */

require('dotenv').config();
const express = require('express');
const cors    = require('cors');
const fetch   = require('node-fetch');
const crypto  = require('crypto');
const path    = require('path');
const {
  equipmentMatchesServiceTicket,
} = require('./lib/equipment-matching');
const {
  validateRentalPayload,
} = require('./lib/rental-validation');
const {
  normalizeGanttRentalList,
  normalizeGanttRentalStatus,
} = require('./lib/gantt-rental-status');
const {
  getRentalDebtOverdueDays,
  buildRentalDebtRows,
  buildClientReceivables,
  buildClientFinancialSnapshots,
  buildManagerReceivables,
  buildOverdueBuckets,
  buildFinanceReport,
} = require('./lib/finance-core');
const {
  mergeEntityHistory,
  mergeRentalHistory,
} = require('./lib/audit-history');
const { createBotHandlers } = require('./lib/bot-commands');
const { createMaxApiClient } = require('./lib/max-api');
const { createServiceCore } = require('./lib/service-core');
const { startServer } = require('./lib/startup');
const { registerAuthRoutes } = require('./routes/auth');
const { registerBotApiRoutes, registerBotRoutes } = require('./routes/bot');
const { registerCrudRoutes } = require('./routes/crud');
const { registerDeliveryRoutes } = require('./routes/deliveries');
const { registerFinanceRoutes } = require('./routes/finance');
const { registerRentalRoutes } = require('./routes/rentals');
const { registerServiceRoutes } = require('./routes/service');
const { registerSystemRoutes } = require('./routes/system');
const {
  DB_PATH,
  cloneCollectionIfMissing,
  countActiveSessions,
  cleanupExpiredSessions,
  deleteSession,
  getData,
  getSession: getStoredSession,
  migrateJsonFilesToDb,
  saveSession,
  setData,
} = require('./db');

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
  'http://127.0.0.1:5173',                 // Vite dev server (Playwright / local)
  'http://localhost:4173',                 // Vite preview
  'http://127.0.0.1:4173',                 // Vite preview (Playwright / local)
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
const MAX_API   = 'https://platform-api.max.ru';
const WEBHOOK_URL = process.env.WEBHOOK_URL;

function readData(name) {
  return getData(name);
}

function writeData(name, data) {
  setData(name, data);
}

function getBotUsers()    { return readData('bot_users') || {}; }
function saveBotUsers(u)  { writeData('bot_users', u); }
function getBotSessions() { return readData('bot_sessions') || {}; }
function saveBotSessions(s) { writeData('bot_sessions', s); }
function getBotActivity() { return readData('bot_activity') || []; }
function saveBotActivity(a) { writeData('bot_activity', Array.isArray(a) ? a : []); }
function getSnapshot()    { return readData('snapshot') || {}; }
function saveSnapshot(s)  { writeData('snapshot', s); }

const {
  sendMessage,
  deleteMessage,
  answerCallback,
  registerWebhook,
} = createMaxApiClient({
  botToken: BOT_TOKEN,
  maxApiBase: MAX_API,
  fetchImpl: fetch,
  webhookUrl: WEBHOOK_URL,
  logger: console,
});

// ── Сессии (SQLite-backed, Bearer-токен) ──────────────────────────────────────

const SESSION_TTL = 24 * 60 * 60 * 1000; // 24 часа

function createSession(user) {
  const token = crypto.randomBytes(32).toString('hex');
  const session = {
    userId:    user.id,
    userName:  user.name,
    userRole:  user.role,
    email:     user.email,
    createdAt: Date.now(),
  };
  saveSession(token, session, session.createdAt + SESSION_TTL);
  return token;
}

function getSession(token) {
  return getStoredSession(token);
}

function destroySession(token) {
  deleteSession(token);
}

// Чистим протухшие сессии каждый час
setInterval(() => {
  cleanupExpiredSessions();
}, 3600_000);

// ── RBAC ──────────────────────────────────────────────────────────────────────

// Права на запись по коллекциям
const WRITE_PERMISSIONS = {
  equipment:      ['Администратор', 'Офис-менеджер'],
  rentals:        ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  gantt_rentals:  ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  deliveries:     ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  delivery_carriers: ['Администратор'],
  service:        ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', 'Механик'],
  clients:        ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  documents:      ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  mechanic_documents: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  payments:       ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  users:          ['Администратор'],
  shipping_photos:['Администратор', 'Механик', 'Менеджер по аренде'],
  owners:         ['Администратор'],
  mechanics:      ['Администратор'],
  service_works:  ['Администратор'],
  spare_parts:    ['Администратор'],
  repair_work_items: ['Администратор', 'Механик'],
  repair_part_items: ['Администратор', 'Механик'],
  service_work_catalog: ['Администратор'],
  spare_parts_catalog: ['Администратор'],
  planner_items:  ['Администратор', 'Офис-менеджер', 'Механик'],
  service_vehicles: ['Администратор', 'Офис-менеджер', 'Механик'],
  vehicle_trips:    ['Администратор', 'Офис-менеджер', 'Механик'],
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
  mechanic_documents: 'MD',
  payments:       'P',
  deliveries:     'DL',
  delivery_carriers: 'DC',
  users:          'U',
  shipping_photos:'SP',
  owners:         'OW',
  service_works:  'SW',
  spare_parts:    'PT',
  repair_work_items: 'RWI',
  repair_part_items: 'RPI',
  planner_items:    'PI',
  service_vehicles: 'SV',
  vehicle_trips:    'VT',
};

function nowIso() {
  return new Date().toISOString();
}

function normalizeServiceWorkRecord(record) {
  const timestamp = nowIso();
  return {
    id: record.id || generateId(ID_PREFIXES.service_works),
    name: String(record.name || '').trim(),
    category: record.category ? String(record.category).trim() : undefined,
    description: record.description ? String(record.description).trim() : undefined,
    normHours: Math.max(0, Number(record.normHours) || 0),
    ratePerHour: Math.max(0, Number(record.ratePerHour) || 0),
    isActive: record.isActive !== false,
    sortOrder: Number.isFinite(Number(record.sortOrder)) ? Number(record.sortOrder) : 0,
    createdAt: record.createdAt || timestamp,
    updatedAt: record.updatedAt || timestamp,
  };
}

function normalizeSparePartRecord(record) {
  const timestamp = nowIso();
  const article = record.article ?? record.sku;
  return {
    id: record.id || generateId(ID_PREFIXES.spare_parts),
    name: String(record.name || '').trim(),
    article: article ? String(article).trim() : undefined,
    sku: article ? String(article).trim() : undefined,
    unit: String(record.unit || 'шт').trim() || 'шт',
    defaultPrice: Math.max(0, Number(record.defaultPrice) || 0),
    category: record.category ? String(record.category).trim() : undefined,
    manufacturer: record.manufacturer ? String(record.manufacturer).trim() : undefined,
    isActive: record.isActive !== false,
    createdAt: record.createdAt || timestamp,
    updatedAt: record.updatedAt || timestamp,
  };
}

function migrateReferenceCollections() {
  cloneCollectionIfMissing('service_works', 'service_work_catalog', item => normalizeServiceWorkRecord({
    ...item,
    isActive: item.status !== 'inactive',
    sortOrder: 0,
  }));
  cloneCollectionIfMissing('spare_parts', 'spare_parts_catalog', item => normalizeSparePartRecord({
    ...item,
    article: item.article ?? item.sku,
    defaultPrice: item.defaultPrice ?? item.unitCost,
  }));
  if (!Array.isArray(readData('repair_work_items'))) {
    writeData('repair_work_items', []);
  }
  if (!Array.isArray(readData('repair_part_items'))) {
    writeData('repair_part_items', []);
  }
}

function ensureMigratedWorkReference(legacyWork, serviceWorks) {
  const byId = legacyWork.catalogId
    ? serviceWorks.find(item => item.id === legacyWork.catalogId)
    : null;
  if (byId) return byId;

  const byName = serviceWorks.find(item =>
    item.name === legacyWork.name
    && Math.abs((Number(item.normHours) || 0) - (Number(legacyWork.normHours) || 0)) < 0.0001,
  );
  if (byName) return byName;

  const created = normalizeServiceWorkRecord({
    id: legacyWork.catalogId || generateId(ID_PREFIXES.service_works),
    name: legacyWork.name || 'Работа из истории',
    category: legacyWork.categorySnapshot,
    description: 'Автоматически создано при миграции истории ремонта',
    normHours: Number(legacyWork.normHours) || 0,
    isActive: false,
    sortOrder: 9999,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  serviceWorks.push(created);
  return created;
}

function ensureMigratedPartReference(legacyPart, spareParts) {
  const legacyArticle = legacyPart.articleSnapshot || legacyPart.sku;
  const byId = legacyPart.catalogId
    ? spareParts.find(item => item.id === legacyPart.catalogId)
    : null;
  if (byId) return byId;

  const byName = spareParts.find(item =>
    item.name === legacyPart.name
    && (item.article || item.sku || '') === (legacyArticle || ''),
  );
  if (byName) return byName;

  const created = normalizeSparePartRecord({
    id: legacyPart.catalogId || generateId(ID_PREFIXES.spare_parts),
    name: legacyPart.name || 'Запчасть из истории',
    article: legacyArticle,
    sku: legacyArticle,
    unit: legacyPart.unitSnapshot || 'шт',
    defaultPrice: Number(legacyPart.cost) || Number(legacyPart.priceSnapshot) || 0,
    category: undefined,
    manufacturer: undefined,
    isActive: false,
    createdAt: nowIso(),
    updatedAt: nowIso(),
  });
  spareParts.push(created);
  return created;
}

function migrateLegacyRepairFacts() {
  const tickets = readData('service') || [];
  const existingServiceWorks = readData('service_works') || [];
  const existingSpareParts = readData('spare_parts') || [];
  const serviceWorks = existingServiceWorks.map(normalizeServiceWorkRecord);
  const spareParts = existingSpareParts.map(normalizeSparePartRecord);
  const repairWorkItems = readData('repair_work_items') || [];
  const repairPartItems = readData('repair_part_items') || [];

  let worksChanged = false;
  let partsChanged = false;
  let workRefsChanged = false;
  let partRefsChanged = false;
  let createdWorkRefs = 0;
  let createdPartRefs = 0;
  let migratedWorkItems = 0;
  let migratedPartItems = 0;
  const originalWorkIds = new Set(existingServiceWorks.map(item => item.id));
  const originalPartIds = new Set(existingSpareParts.map(item => item.id));

  for (const ticket of tickets) {
    const legacyTicketWorks = Array.isArray(ticket.resultData?.worksPerformed) ? ticket.resultData.worksPerformed : [];
    const legacyTicketParts = Array.isArray(ticket.resultData?.partsUsed)
      ? ticket.resultData.partsUsed
      : (Array.isArray(ticket.parts) ? ticket.parts : []);

    const hasNewWorks = repairWorkItems.some(item => item.repairId === ticket.id);
    const hasNewParts = repairPartItems.some(item => item.repairId === ticket.id);

    if (!hasNewWorks && legacyTicketWorks.length > 0) {
      for (const work of legacyTicketWorks) {
        const reference = ensureMigratedWorkReference(work, serviceWorks);
        if (!originalWorkIds.has(reference.id)) {
          createdWorkRefs += 1;
          originalWorkIds.add(reference.id);
        }
        const quantity = Math.max(1, Number(work.qty) || 1);
        repairWorkItems.push({
          id: generateId(ID_PREFIXES.repair_work_items),
          repairId: ticket.id,
          workId: reference.id,
          quantity,
          normHoursSnapshot: Math.max(0, Number(work.normHours) || 0),
          nameSnapshot: work.name || reference.name,
          categorySnapshot: reference.category,
          createdAt: ticket.createdAt || nowIso(),
        });
        migratedWorkItems += 1;
      }
      worksChanged = true;
    }

    if (!hasNewParts && legacyTicketParts.length > 0) {
      for (const part of legacyTicketParts) {
        const reference = ensureMigratedPartReference(part, spareParts);
        if (!originalPartIds.has(reference.id)) {
          createdPartRefs += 1;
          originalPartIds.add(reference.id);
        }
        const quantity = Math.max(1, Number(part.qty) || 1);
        repairPartItems.push({
          id: generateId(ID_PREFIXES.repair_part_items),
          repairId: ticket.id,
          partId: reference.id,
          quantity,
          priceSnapshot: Math.max(0, Number(part.cost) || Number(part.priceSnapshot) || 0),
          nameSnapshot: part.name || reference.name,
          articleSnapshot: part.sku || part.articleSnapshot || reference.article || reference.sku,
          unitSnapshot: part.unitSnapshot || reference.unit || 'шт',
          createdAt: ticket.createdAt || nowIso(),
        });
        migratedPartItems += 1;
      }
      partsChanged = true;
    }
  }

  const originalWorksCount = (readData('service_works') || []).length;
  const originalPartsCount = (readData('spare_parts') || []).length;
  workRefsChanged = serviceWorks.length !== originalWorksCount;
  partRefsChanged = spareParts.length !== originalPartsCount;

  if (workRefsChanged) writeData('service_works', serviceWorks);
  if (partRefsChanged) writeData('spare_parts', spareParts);
  if (worksChanged) writeData('repair_work_items', repairWorkItems);
  if (partsChanged) writeData('repair_part_items', repairPartItems);

  return {
    createdWorkRefs,
    createdPartRefs,
    migratedWorkItems,
    migratedPartItems,
    ticketsScanned: tickets.length,
  };
}

const apiRouter = express.Router();

const COLLECTIONS = [
  'equipment',
  'service',
  'clients',
  'documents',
  'mechanic_documents',
  'payments',
  'delivery_carriers',
  'users',
  'shipping_photos',
  'owners',
  'mechanics',
  'service_works',
  'spare_parts',
  'service_work_catalog',
  'spare_parts_catalog',
  'planner_items',
  'service_vehicles',
  'vehicle_trips',
];

registerAuthRoutes(app, {
  readData,
  verifyPassword,
  createSession,
  requireAuth,
  destroySession,
});

apiRouter.use(registerRentalRoutes({
  readData,
  writeData,
  requireAuth,
  validateRentalPayload,
  mergeRentalHistory,
  normalizeGanttRentalList,
  normalizeGanttRentalStatus,
  generateId,
  idPrefixes: ID_PREFIXES,
}));

registerFinanceRoutes(apiRouter, {
  requireAuth,
  readData,
  getRentalDebtOverdueDays,
  buildRentalDebtRows,
  buildClientReceivables,
  buildClientFinancialSnapshots,
  buildManagerReceivables,
  buildOverdueBuckets,
  buildFinanceReport,
});

registerDeliveryRoutes(apiRouter, {
  readData,
  writeData,
  requireAuth,
  requireWrite,
  sendMessage,
  getBotUsers,
  nowIso,
  generateId,
  idPrefixes: ID_PREFIXES,
});

const serviceCore = createServiceCore({
  readData,
  writeData,
  nowIso,
  equipmentMatchesServiceTicket,
});

const {
  serviceStatusLabel,
  readServiceTickets,
  writeServiceTickets,
  findServiceTicketById,
  saveServiceTicket,
  appendServiceLog,
  findServiceTicketOr404,
  getMechanicReferenceByUser,
  applyServiceTicketCreationEffects,
  syncEquipmentStatusForService,
  updateServiceTicketStatus,
  getOpenTicketByEquipment,
} = serviceCore;

apiRouter.use(registerCrudRoutes({
  collections: COLLECTIONS,
  idPrefixes: ID_PREFIXES,
  readData,
  writeData,
  requireAuth,
  requireWrite,
  sanitizeUser,
  publicUserView,
  canReadFullUsers,
  normalizeServiceWorkRecord,
  normalizeSparePartRecord,
  validateRentalPayload,
  mergeEntityHistory,
  requireNonEmptyString,
  generateId,
  nowIso,
  applyServiceTicketCreationEffects,
}));

function requireNonEmptyString(value, fieldName) {
  if (!String(value || '').trim()) {
    throw new Error(`Поле «${fieldName}» обязательно`);
  }
}

registerServiceRoutes(apiRouter, {
  readData,
  writeData,
  requireAuth,
  requireWrite,
  normalizeServiceWorkRecord,
  normalizeSparePartRecord,
  requireNonEmptyString,
  nowIso,
  generateId,
  idPrefixes: ID_PREFIXES,
  findServiceTicketOr404,
  migrateLegacyRepairFacts,
});

registerBotApiRoutes(apiRouter, {
  requireAuth,
  readData,
  getBotUsers,
  getBotSessions,
  botToken: BOT_TOKEN,
  webhookUrl: WEBHOOK_URL,
});

const {
  handleBotStarted,
  handleCommand,
  handleCallback,
  buildManagerMorningSummaryMessage,
  getDefaultKeyboardForRole,
} = createBotHandlers({
  readData,
  writeData,
  verifyPassword,
  getBotUsers,
  saveBotUsers,
  getBotSessions,
  saveBotSessions,
  sendMessage,
  deleteMessage,
  answerCallback,
  generateId,
  idPrefixes: ID_PREFIXES,
  nowIso,
  readServiceTickets,
  writeServiceTickets,
  findServiceTicketById,
  saveServiceTicket,
  appendServiceLog,
  getMechanicReferenceByUser,
  syncEquipmentStatusForService,
  updateServiceTicketStatus,
  getOpenTicketByEquipment,
  serviceStatusLabel,
});

function getMoscowDateParts(date = new Date()) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Moscow',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  const parts = Object.fromEntries(
    formatter
      .formatToParts(date)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
  return {
    dateKey: `${parts.year}-${parts.month}-${parts.day}`,
    hour: Number(parts.hour || 0),
    minute: Number(parts.minute || 0),
  };
}

async function sendRentalManagerMorningDigests() {
  const { dateKey, hour, minute } = getMoscowDateParts();
  if (hour !== 8 || minute >= 15) return;

  const botUsers = getBotUsers();
  let changed = false;

  for (const [phone, user] of Object.entries(botUsers)) {
    if (!user || user.userRole !== 'Менеджер по аренде') continue;
    if (!user.replyTarget) continue;
    if (user.lastManagerDigestDate === dateKey) continue;

    try {
      await sendMessage(user.replyTarget, buildManagerMorningSummaryMessage(user), {
        attachments: getDefaultKeyboardForRole(user.userRole),
      });
      botUsers[phone] = {
        ...user,
        lastManagerDigestDate: dateKey,
      };
      changed = true;
    } catch (error) {
      console.error('[BOT] Не удалось отправить утреннюю сводку менеджеру по аренде', user.userName || phone, error?.message || error);
    }
  }

  if (changed) {
    saveBotUsers(botUsers);
  }
}

setInterval(() => {
  sendRentalManagerMorningDigests().catch(error => {
    console.error('[BOT] Ошибка утренней рассылки менеджерам по аренде', error?.message || error);
  });
}, 10 * 60_000);

const BOT_ACTIVITY_LIMIT = 2000;

function trimBotAuditText(value, maxLength = 160) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function toBotNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function syncBotConnection(phone, senderId, previousUser = null) {
  const phoneKey = String(phone || '');
  if (!phoneKey) return null;

  const botUsers = getBotUsers();
  const current = botUsers[phoneKey];
  if (!current) return null;

  botUsers[phoneKey] = {
    ...current,
    botId: 'max',
    phone: phoneKey,
    maxUserId: current.maxUserId ?? toBotNumber(phoneKey) ?? toBotNumber(current.replyTarget?.user_id),
    connectedAt: current.connectedAt || previousUser?.connectedAt || nowIso(),
    lastSeenAt: nowIso(),
    replyTarget: current.replyTarget || {
      chat_id: senderId?.chat_id ?? null,
      user_id: senderId?.user_id ?? toBotNumber(phoneKey),
    },
  };

  saveBotUsers(botUsers);
  return botUsers[phoneKey];
}

function appendBotActivity(entry) {
  const activity = getBotActivity();
  activity.push(entry);
  saveBotActivity(activity.slice(-BOT_ACTIVITY_LIMIT));
}

function recordBotActivity({
  phone,
  senderId,
  eventType,
  action,
  details = null,
  user = null,
}) {
  const phoneKey = String(phone || '');
  const linkedUser = user || getBotUsers()[phoneKey] || null;

  appendBotActivity({
    id: generateId('botact'),
    botId: 'max',
    phone: phoneKey || null,
    maxUserId: linkedUser?.maxUserId ?? toBotNumber(phoneKey) ?? toBotNumber(senderId?.user_id),
    userId: linkedUser?.userId || null,
    userName: linkedUser?.userName || null,
    userRole: linkedUser?.userRole || null,
    email: linkedUser?.email || null,
    eventType,
    action: trimBotAuditText(action),
    details: details ? trimBotAuditText(details, 220) : null,
    createdAt: nowIso(),
  });
}

function describeBotMessage(text, session = {}, attachments = []) {
  const trimmed = String(text || '').trim();
  const attachmentsCount = Array.isArray(attachments) ? attachments.length : 0;

  if (session.pendingAction === 'login_password') {
    return {
      eventType: 'authorization',
      action: 'Ввод пароля',
      details: 'Содержимое скрыто из журнала',
    };
  }

  if (session.pendingAction === 'login_email') {
    return {
      eventType: 'authorization',
      action: 'Ввод логина',
      details: null,
    };
  }

  if (trimmed.startsWith('/start')) {
    return {
      eventType: 'authorization',
      action: 'Команда /start',
      details: 'Запрошена авторизация',
    };
  }

  if (trimmed.startsWith('/')) {
    const [command, ...rest] = trimmed.split(/\s+/);
    return {
      eventType: 'command',
      action: `Команда ${command}`,
      details: rest.length > 0 ? trimBotAuditText(rest.join(' '), 120) : null,
    };
  }

  if (!trimmed && attachmentsCount > 0) {
    return {
      eventType: 'message',
      action: `Отправлено вложений: ${attachmentsCount}`,
      details: null,
    };
  }

  return {
    eventType: 'message',
    action: trimBotAuditText(trimmed || 'Пустое сообщение'),
    details: attachmentsCount > 0 ? `Вложений: ${attachmentsCount}` : null,
  };
}

function describeBotCallback(payload) {
  return {
    eventType: 'callback',
    action: trimBotAuditText(`Нажата кнопка: ${payload || 'без payload'}`),
    details: null,
  };
}

async function auditedHandleBotStarted(senderId, phone, payload) {
  recordBotActivity({
    phone,
    senderId,
    eventType: 'session_started',
    action: 'Пользователь открыл бота',
    details: payload ? `Payload: ${payload}` : null,
  });
  return handleBotStarted(senderId, phone, payload);
}

async function auditedHandleCommand(senderId, phone, text, messageMeta, uiContext) {
  const phoneKey = String(phone || '');
  const session = getBotSessions()[phoneKey] || {};
  const beforeUser = getBotUsers()[phoneKey] || null;
  const event = describeBotMessage(text, session, messageMeta?.attachments);

  recordBotActivity({
    phone,
    senderId,
    eventType: event.eventType,
    action: event.action,
    details: event.details,
    user: beforeUser,
  });

  const result = await handleCommand(senderId, phone, text, messageMeta, uiContext);
  const afterUser = syncBotConnection(phone, senderId, beforeUser);

  if (afterUser?.userId && (!beforeUser || beforeUser.userId !== afterUser.userId)) {
    recordBotActivity({
      phone,
      senderId,
      eventType: 'authorization',
      action: beforeUser ? 'Пользователь переподключил бота' : 'Пользователь подключил бота',
      details: afterUser.userName ? `Сотрудник: ${afterUser.userName}` : null,
      user: afterUser,
    });
  }

  return result;
}

async function auditedHandleCallback(senderId, phone, payload, callbackContext) {
  const beforeUser = getBotUsers()[String(phone || '')] || null;
  const event = describeBotCallback(payload);

  recordBotActivity({
    phone,
    senderId,
    eventType: event.eventType,
    action: event.action,
    details: event.details,
    user: beforeUser,
  });

  const result = await handleCallback(senderId, phone, payload, callbackContext);
  syncBotConnection(phone, senderId, beforeUser);
  return result;
}

// ── Планировщик подготовки техники к аренде ──────────────────────────────────

/**
 * GET /api/planner
 * Возвращает строки планировщика: объединение аренд, техники, клиентов и оверлеев.
 * Включает аренды со статусом не 'closed', у которых есть техника и дата начала.
 * Исключает строки с prepStatus === 'shipped' (уже отгруженные) — если только
 * не передан query-параметр ?include_shipped=1.
 */
apiRouter.get('/planner', requireAuth, (req, res) => {
  try {
    const includeShipped = req.query.include_shipped === '1';

    const rentals      = readData('rentals') || [];
    const deliveries   = readData('deliveries') || [];
    const serviceTickets = readData('service') || [];
    const equipment    = readData('equipment') || [];
    const plannerItems = readData('planner_items') || [];

    // Индексы для быстрого доступа
    const eqByInv = new Map(equipment.map(e => [e.inventoryNumber, e]));
    const eqById  = new Map(equipment.map(e => [e.id, e]));

    // Оверлеи: ключ = "rentalId__equipmentRef"
    const overlayMap = new Map(
      plannerItems.map(p => [`${p.rentalId}__${p.equipmentRef}`, p])
    );

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const rows = [];

    for (const rental of rentals) {
      // Пропускаем закрытые аренды
      if (rental.status === 'closed') continue;
      // Пропускаем аренды без даты начала
      if (!rental.startDate) continue;

      const equipmentRefs = Array.isArray(rental.equipment) ? rental.equipment : [];
      if (equipmentRefs.length === 0) continue;

      const startDate = new Date(rental.startDate);
      startDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.round((startDate - today) / (1000 * 60 * 60 * 24));

      for (const ref of equipmentRefs) {
        if (!ref) continue;

        // Ищем технику по ID или по инвентарному номеру
        const eq = eqById.get(ref) || eqByInv.get(ref) || null;
        const equipmentRef = eq ? (eq.inventoryNumber || ref) : ref;
        const rowId = `${rental.id}__${equipmentRef}`;

        // Оверлей
        const overlay = overlayMap.get(rowId) || null;
        const prepStatus = overlay?.prepStatus || 'planned';

        // Пропускаем отгруженные, если не нужны
        if (!includeShipped && prepStatus === 'shipped') continue;

        // Автоматический приоритет
        let autoPriority;
        if (daysUntil <= 1) autoPriority = 'high';
        else if (daysUntil <= 3) autoPriority = 'medium';
        else autoPriority = 'low';

        // Если статус подготовки «готова» / «отгружена» — понижаем до medium при daysUntil<=1
        const isReadyOrShipped = prepStatus === 'ready' || prepStatus === 'shipped';
        if (isReadyOrShipped && daysUntil <= 1) autoPriority = 'medium';

        const priority = overlay?.priorityOverride || autoPriority;

        // Автоматический флаг риска
        const isInRepair = eq?.status === 'in_service';
        const autoRisk = (
          (daysUntil <= 2 && !isReadyOrShipped) ||
          isInRepair ||
          (daysUntil < 0 && !isReadyOrShipped)  // просрочено
        );
        const risk = overlay?.riskOverride !== null && overlay?.riskOverride !== undefined
          ? overlay.riskOverride
          : autoRisk;

        rows.push({
          id:              rowId,
          rentalId:        rental.id,
          equipmentId:     eq?.id || null,
          equipmentRef,
          startDate:       rental.startDate,
          daysUntil,
          equipmentLabel:  eq ? `${eq.manufacturer || ''} ${eq.model || ''}`.trim() : ref,
          inventoryNumber: eq?.inventoryNumber || ref,
          serialNumber:    eq?.serialNumber || null,
          equipmentType:   eq?.type || null,
          client:          rental.client || '',
          deliveryAddress: rental.deliveryAddress || '',
          manager:         rental.manager || '',
          equipmentStatus: eq?.status || null,
          prepStatus,
          priority,
          risk,
          comment:         overlay?.comment || '',
          rentalStatus:    rental.status,
          sourceType:      'rental',
          operationType:   'rental',
        });
      }
    }

    for (const delivery of deliveries) {
      if (!delivery.transportDate) continue;
      if (delivery.status === 'cancelled') continue;

      const eq = delivery.equipmentId
        ? eqById.get(delivery.equipmentId) || null
        : (delivery.equipmentInv ? eqByInv.get(delivery.equipmentInv) || null : null);
      const equipmentRef = eq?.inventoryNumber || delivery.equipmentInv || delivery.cargo || delivery.id;
      const rowId = `delivery:${delivery.id}__${equipmentRef}`;
      const overlay = overlayMap.get(rowId) || null;

      const startDate = new Date(delivery.transportDate);
      startDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.round((startDate - today) / (1000 * 60 * 60 * 24));

      let autoPriority;
      if (daysUntil <= 1) autoPriority = 'high';
      else if (daysUntil <= 3) autoPriority = 'medium';
      else autoPriority = 'low';

      const isCompleted = delivery.status === 'completed';
      const autoRisk = !isCompleted && daysUntil <= 1;
      const priority = overlay?.priorityOverride || autoPriority;
      const risk = overlay?.riskOverride !== null && overlay?.riskOverride !== undefined
        ? overlay.riskOverride
        : autoRisk;

      const defaultPrepStatus = isCompleted
        ? (delivery.type === 'shipping' ? 'shipped' : 'ready')
        : (delivery.type === 'shipping' ? 'planned' : 'inspection');
      const prepStatus = overlay?.prepStatus || defaultPrepStatus;

      if (!includeShipped && prepStatus === 'shipped') continue;

      rows.push({
        id: rowId,
        rentalId: `delivery:${delivery.id}`,
        equipmentId: eq?.id || delivery.equipmentId || null,
        equipmentRef,
        startDate: delivery.transportDate,
        daysUntil,
        equipmentLabel: delivery.equipmentLabel || (eq ? `${eq.manufacturer || ''} ${eq.model || ''}`.trim() : delivery.cargo),
        inventoryNumber: equipmentRef,
        serialNumber: eq?.serialNumber || null,
        equipmentType: eq?.type || null,
        client: delivery.client || '',
        deliveryAddress: `${delivery.origin} → ${delivery.destination}`,
        manager: delivery.manager || '',
        equipmentStatus: eq?.status || null,
        prepStatus,
        priority,
        risk,
        comment: overlay?.comment || `${delivery.type === 'shipping' ? 'Отгрузка' : 'Приёмка'} · ${delivery.cargo}`,
        rentalStatus: delivery.type === 'shipping' ? 'delivery' : 'return_planned',
        sourceType: 'delivery',
        operationType: delivery.type,
      });
    }

    for (const ticket of serviceTickets) {
      if (!ticket?.plannedDate) continue;
      if (ticket.status === 'closed') continue;

      const eq = ticket.equipmentId
        ? eqById.get(ticket.equipmentId) || null
        : (ticket.inventoryNumber ? eqByInv.get(ticket.inventoryNumber) || null : null);
      const equipmentRef = eq?.inventoryNumber || ticket.inventoryNumber || ticket.equipmentId || ticket.id;
      const rowId = `service:${ticket.id}__${equipmentRef}`;
      const overlay = overlayMap.get(rowId) || null;

      const startDate = new Date(ticket.plannedDate);
      startDate.setHours(0, 0, 0, 0);
      const daysUntil = Math.round((startDate - today) / (1000 * 60 * 60 * 24));

      const servicePriority = ticket.priority === 'critical' || ticket.priority === 'high'
        ? 'high'
        : ticket.priority === 'medium'
          ? 'medium'
          : 'low';
      const timePriority = daysUntil <= 1 ? 'high' : daysUntil <= 3 ? 'medium' : 'low';
      const priorityOrder = { high: 3, medium: 2, low: 1 };
      const autoPriority = priorityOrder[servicePriority] >= priorityOrder[timePriority]
        ? servicePriority
        : timePriority;
      const priority = overlay?.priorityOverride || autoPriority;

      const defaultPrepStatus =
        ticket.status === 'ready' ? 'ready'
        : ticket.status === 'waiting_parts' ? 'on_hold'
        : ticket.status === 'in_progress' ? 'in_repair'
        : 'planned';

      const prepStatus = overlay?.prepStatus || defaultPrepStatus;
      if (!includeShipped && prepStatus === 'shipped') continue;

      const isReady = prepStatus === 'ready';
      const autoRisk =
        ticket.status === 'waiting_parts' ||
        (daysUntil <= 1 && !isReady) ||
        (daysUntil < 0 && !isReady);
      const risk = overlay?.riskOverride !== null && overlay?.riskOverride !== undefined
        ? overlay.riskOverride
        : autoRisk;

      const serviceLabel = ticket.serviceKind
        ? String(ticket.serviceKind).trim().toUpperCase()
        : 'Сервис';
      const reason = String(ticket.reason || '').trim();
      const description = String(ticket.description || '').trim();
      const workTitle = reason || description || 'Запланированная работа';
      const comment = overlay?.comment || [ticket.id, workTitle].filter(Boolean).join(' · ');

      rows.push({
        id: rowId,
        rentalId: `service:${ticket.id}`,
        equipmentId: eq?.id || ticket.equipmentId || null,
        equipmentRef,
        startDate: ticket.plannedDate,
        daysUntil,
        equipmentLabel: ticket.equipment || (eq ? `${eq.manufacturer || ''} ${eq.model || ''}`.trim() : equipmentRef),
        inventoryNumber: eq?.inventoryNumber || ticket.inventoryNumber || equipmentRef,
        serialNumber: ticket.serialNumber || eq?.serialNumber || null,
        equipmentType: eq?.type || null,
        client: `${serviceLabel} · ${workTitle}`,
        deliveryAddress: description && description !== reason ? description : (ticket.location || ''),
        manager: ticket.assignedMechanicName || ticket.assignedTo || ticket.createdByUserName || ticket.createdBy || '',
        equipmentStatus: eq?.status || (ticket.status === 'in_progress' || ticket.status === 'waiting_parts' ? 'in_service' : null),
        prepStatus,
        priority,
        risk,
        comment,
        rentalStatus: 'new',
        sourceType: 'service',
        operationType: 'service',
      });
    }

    // Сортируем: сначала по дате (раньше = выше), потом по приоритету
    const priorityOrder = { high: 0, medium: 1, low: 2 };
    rows.sort((a, b) => {
      const dateDiff = new Date(a.startDate) - new Date(b.startDate);
      if (dateDiff !== 0) return dateDiff;
      return (priorityOrder[a.priority] ?? 99) - (priorityOrder[b.priority] ?? 99);
    });

    res.json(rows);
  } catch (err) {
    console.error('[PLANNER] GET /api/planner error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PUT /api/planner/:rowId
 * Upsert оверлей для строки планировщика.
 * rowId = "rentalId__equipmentRef"
 * Body: { prepStatus?, priorityOverride?, riskOverride?, comment? }
 */
apiRouter.put('/planner/:rowId', requireAuth, requireWrite('planner_items'), (req, res) => {
  try {
    const { rowId } = req.params;
    if (!rowId || !rowId.includes('__')) {
      return res.status(400).json({ ok: false, error: 'Неверный формат rowId' });
    }

    const [rentalId, ...refParts] = rowId.split('__');
    const equipmentRef = refParts.join('__');

    const items = readData('planner_items') || [];
    const existingIdx = items.findIndex(p => p.rentalId === rentalId && p.equipmentRef === equipmentRef);

    const updatedFields = {};
    if (req.body.prepStatus        !== undefined) updatedFields.prepStatus        = req.body.prepStatus;
    if (req.body.priorityOverride  !== undefined) updatedFields.priorityOverride  = req.body.priorityOverride;
    if (req.body.riskOverride      !== undefined) updatedFields.riskOverride      = req.body.riskOverride;
    if (req.body.comment           !== undefined) updatedFields.comment           = req.body.comment;

    let item;
    if (existingIdx >= 0) {
      items[existingIdx] = {
        ...items[existingIdx],
        ...updatedFields,
        updatedAt: nowIso(),
        updatedBy: req.user.userName,
      };
      item = items[existingIdx];
    } else {
      item = {
        id:               generateId('PI'),
        rentalId,
        equipmentRef,
        prepStatus:       updatedFields.prepStatus       || 'planned',
        priorityOverride: updatedFields.priorityOverride ?? null,
        riskOverride:     updatedFields.riskOverride     ?? null,
        comment:          updatedFields.comment          || '',
        updatedAt:        nowIso(),
        updatedBy:        req.user.userName,
      };
      items.push(item);
    }

    writeData('planner_items', items);
    res.json(item);
  } catch (err) {
    console.error('[PLANNER] PUT /api/planner/:rowId error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Служебные машины — кастомные эндпоинты ────────────────────────────────────

/**
 * POST /api/service-vehicles
 * Создать служебную машину.
 */
apiRouter.post('/service-vehicles', requireAuth, requireWrite('service_vehicles'), (req, res) => {
  try {
    const body = req.body || {};
    if (!String(body.make || '').trim()) return res.status(400).json({ ok: false, error: 'Поле «Марка» обязательно' });
    if (!String(body.model || '').trim()) return res.status(400).json({ ok: false, error: 'Поле «Модель» обязательно' });
    if (!String(body.plateNumber || '').trim()) return res.status(400).json({ ok: false, error: 'Поле «Госномер» обязательно' });

    const now = nowIso();
    const vehicle = {
      id: generateId(ID_PREFIXES.service_vehicles),
      make: String(body.make).trim(),
      model: String(body.model).trim(),
      plateNumber: String(body.plateNumber).trim().toUpperCase(),
      vin: body.vin ? String(body.vin).trim() : null,
      year: body.year ? Number(body.year) : null,
      vehicleType: body.vehicleType || 'car',
      color: body.color ? String(body.color).trim() : null,
      currentMileage: Math.max(0, Number(body.currentMileage) || 0),
      mileageUpdatedAt: body.mileageUpdatedAt || null,
      responsiblePerson: String(body.responsiblePerson || '').trim(),
      conditionNote: String(body.conditionNote || '').trim(),
      status: body.status || 'active',
      osagoExpiresAt: body.osagoExpiresAt || null,
      insuranceExpiresAt: body.insuranceExpiresAt || null,
      nextServiceAt: body.nextServiceAt || null,
      serviceNote: body.serviceNote ? String(body.serviceNote).trim() : null,
      createdAt: now,
      updatedAt: now,
      createdBy: req.user.userName,
    };

    const list = readData('service_vehicles') || [];
    list.push(vehicle);
    writeData('service_vehicles', list);
    res.status(201).json(vehicle);
  } catch (err) {
    console.error('[SV] POST error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PUT /api/service-vehicles/:id
 * Обновить служебную машину.
 */
apiRouter.put('/service-vehicles/:id', requireAuth, requireWrite('service_vehicles'), (req, res) => {
  try {
    const list = readData('service_vehicles') || [];
    const idx = list.findIndex(v => v.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Машина не найдена' });

    const body = req.body || {};
    const existing = list[idx];
    const updated = {
      ...existing,
      make:              body.make !== undefined ? String(body.make).trim() : existing.make,
      model:             body.model !== undefined ? String(body.model).trim() : existing.model,
      plateNumber:       body.plateNumber !== undefined ? String(body.plateNumber).trim().toUpperCase() : existing.plateNumber,
      vin:               body.vin !== undefined ? (body.vin ? String(body.vin).trim() : null) : existing.vin,
      year:              body.year !== undefined ? (body.year ? Number(body.year) : null) : existing.year,
      vehicleType:       body.vehicleType !== undefined ? body.vehicleType : existing.vehicleType,
      color:             body.color !== undefined ? (body.color ? String(body.color).trim() : null) : existing.color,
      currentMileage:    body.currentMileage !== undefined ? Math.max(0, Number(body.currentMileage) || 0) : existing.currentMileage,
      mileageUpdatedAt:  body.mileageUpdatedAt !== undefined ? body.mileageUpdatedAt : existing.mileageUpdatedAt,
      responsiblePerson: body.responsiblePerson !== undefined ? String(body.responsiblePerson).trim() : existing.responsiblePerson,
      conditionNote:     body.conditionNote !== undefined ? String(body.conditionNote).trim() : existing.conditionNote,
      status:            body.status !== undefined ? body.status : existing.status,
      osagoExpiresAt:    body.osagoExpiresAt !== undefined ? body.osagoExpiresAt : existing.osagoExpiresAt,
      insuranceExpiresAt: body.insuranceExpiresAt !== undefined ? body.insuranceExpiresAt : existing.insuranceExpiresAt,
      nextServiceAt:     body.nextServiceAt !== undefined ? body.nextServiceAt : existing.nextServiceAt,
      serviceNote:       body.serviceNote !== undefined ? (body.serviceNote ? String(body.serviceNote).trim() : null) : existing.serviceNote,
      updatedAt:         nowIso(),
    };

    list[idx] = updated;
    writeData('service_vehicles', list);
    res.json(updated);
  } catch (err) {
    console.error('[SV] PUT error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

// ── Журнал поездок ─────────────────────────────────────────────────────────────

/**
 * POST /api/vehicle-trips
 * Создать запись поездки. Автоматически обновляет пробег машины.
 */
apiRouter.post('/vehicle-trips', requireAuth, requireWrite('vehicle_trips'), (req, res) => {
  try {
    const body = req.body || {};
    if (!body.vehicleId) return res.status(400).json({ ok: false, error: 'vehicleId обязателен' });
    if (!String(body.driver || '').trim()) return res.status(400).json({ ok: false, error: 'Поле «Водитель» обязательно' });
    if (!String(body.route || '').trim()) return res.status(400).json({ ok: false, error: 'Поле «Маршрут» обязательно' });

    const startMileage = Math.max(0, Number(body.startMileage) || 0);
    const endMileage   = Math.max(0, Number(body.endMileage)   || 0);
    if (endMileage < startMileage) {
      return res.status(400).json({ ok: false, error: 'Конечный пробег не может быть меньше начального' });
    }

    const distance = endMileage - startMileage;
    const now = nowIso();

    const trip = {
      id: generateId(ID_PREFIXES.vehicle_trips),
      vehicleId:       body.vehicleId,
      date:            body.date || now.slice(0, 10),
      driver:          String(body.driver).trim(),
      route:           String(body.route).trim(),
      purpose:         String(body.purpose || '').trim(),
      startMileage,
      endMileage,
      distance,
      serviceTicketId: body.serviceTicketId || null,
      clientId:        body.clientId || null,
      comment:         String(body.comment || '').trim(),
      createdAt:       now,
      createdBy:       req.user.userName,
    };

    const trips = readData('vehicle_trips') || [];
    trips.push(trip);
    writeData('vehicle_trips', trips);

    // Обновить текущий пробег машины
    const vehicles = readData('service_vehicles') || [];
    const vIdx = vehicles.findIndex(v => v.id === body.vehicleId);
    if (vIdx !== -1 && endMileage >= (vehicles[vIdx].currentMileage || 0)) {
      vehicles[vIdx] = {
        ...vehicles[vIdx],
        currentMileage: endMileage,
        mileageUpdatedAt: now,
        updatedAt: now,
      };
      writeData('service_vehicles', vehicles);
    }

    res.status(201).json(trip);
  } catch (err) {
    console.error('[VT] POST error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * GET /api/vehicle-trips
 * Получить поездки (фильтр ?vehicleId=...).
 */
apiRouter.get('/vehicle-trips', requireAuth, (req, res) => {
  try {
    let trips = readData('vehicle_trips') || [];
    if (req.query.vehicleId) {
      trips = trips.filter(t => t.vehicleId === req.query.vehicleId);
    }
    trips.sort((a, b) => b.date.localeCompare(a.date));
    res.json(trips);
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * PUT /api/vehicle-trips/:id
 * Обновить запись поездки.
 */
apiRouter.put('/vehicle-trips/:id', requireAuth, requireWrite('vehicle_trips'), (req, res) => {
  try {
    const trips = readData('vehicle_trips') || [];
    const idx = trips.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Запись не найдена' });

    const body = req.body || {};
    const existing = trips[idx];
    const startMileage = body.startMileage !== undefined ? Math.max(0, Number(body.startMileage) || 0) : existing.startMileage;
    const endMileage   = body.endMileage   !== undefined ? Math.max(0, Number(body.endMileage)   || 0) : existing.endMileage;
    if (endMileage < startMileage) {
      return res.status(400).json({ ok: false, error: 'Конечный пробег не может быть меньше начального' });
    }

    const updated = {
      ...existing,
      date:            body.date !== undefined ? body.date : existing.date,
      driver:          body.driver !== undefined ? String(body.driver).trim() : existing.driver,
      route:           body.route !== undefined ? String(body.route).trim() : existing.route,
      purpose:         body.purpose !== undefined ? String(body.purpose).trim() : existing.purpose,
      startMileage,
      endMileage,
      distance:        endMileage - startMileage,
      serviceTicketId: body.serviceTicketId !== undefined ? body.serviceTicketId : existing.serviceTicketId,
      clientId:        body.clientId !== undefined ? body.clientId : existing.clientId,
      comment:         body.comment !== undefined ? String(body.comment).trim() : existing.comment,
    };

    trips[idx] = updated;
    writeData('vehicle_trips', trips);
    res.json(updated);
  } catch (err) {
    console.error('[VT] PUT error:', err.message);
    res.status(500).json({ ok: false, error: err.message });
  }
});

/**
 * DELETE /api/vehicle-trips/:id
 */
apiRouter.delete('/vehicle-trips/:id', requireAuth, requireWrite('vehicle_trips'), (req, res) => {
  try {
    const trips = readData('vehicle_trips') || [];
    const idx = trips.findIndex(t => t.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Запись не найдена' });
    trips.splice(idx, 1);
    writeData('vehicle_trips', trips);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ ok: false, error: err.message });
  }
});

app.use('/api', apiRouter);

// ── Seed default admin ────────────────────────────────────────────────────────

function getDefaultUsers() {
  return [
    {
      id:       'U-default-admin',
      name:     'Администратор',
      email:    'admin@rental.local',
      role:     'Администратор',
      status:   'Активен',
      password: hashPassword('admin123'),
    },
    {
      id:       'U-default-mp2',
      name:     'mp2',
      email:    'mp2@mantall.ru',
      role:     'Менеджер по аренде',
      status:   'Активен',
      password: hashPassword('1234'),
    },
    {
      id:       'U-default-smirnova',
      name:     'Смирнова Анна Петровна',
      email:    'smirnova@company.ru',
      role:     'Менеджер по аренде',
      status:   'Активен',
      password: hashPassword('1234'),
    },
    {
      id:       'U-default-kozlov',
      name:     'Козлов Дмитрий Владимирович',
      email:    'kozlov@company.ru',
      role:     'Менеджер по аренде',
      status:   'Активен',
      password: hashPassword('1234'),
    },
    {
      id:       'U-default-petrov',
      name:     'Петров Иван Сергеевич',
      email:    'petrov@company.ru',
      role:     'Механик',
      status:   'Активен',
      password: hashPassword('1234'),
    },
    {
      id:       'U-default-hrrkzn',
      name:     'Администратор',
      email:    'hrrkzn@yandex.ru',
      role:     'Администратор',
      status:   'Активен',
      password: hashPassword('kazan2013'),
    },
  ];
}

function seedDefaultUsers() {
  const existing = readData('users');
  if (existing && existing.length > 0) return; // уже есть данные

  const defaults = getDefaultUsers();
  writeData('users', defaults);
  console.log('[INIT] Созданы стандартные пользователи для первого входа');
  console.log('[INIT] Администратор по умолчанию: admin@rental.local / admin123');
  console.log('[INIT] ⚠️  Обязательно смените пароли в настройках!');
}

function ensureLegacyDefaultUsers() {
  const users = readData('users') || [];
  const isSingleDefaultAdmin =
    users.length === 1 &&
    String(users[0]?.email || '').trim().toLowerCase() === 'admin@rental.local';

  if (!isSingleDefaultAdmin) return;

  const existingEmails = new Set(users.map(u => String(u.email || '').trim().toLowerCase()));
  const missingDefaults = getDefaultUsers().filter(
    user => !existingEmails.has(String(user.email || '').trim().toLowerCase())
  );

  if (missingDefaults.length === 0) return;

  writeData('users', [...users, ...missingDefaults]);
  console.log(`[AUTH] Восстановлены стандартные пользователи: ${missingDefaults.map(u => u.email).join(', ')}`);
}

function applyAdminResetFromEnv() {
  const resetPassword = process.env.ADMIN_RESET_PASSWORD;
  if (!resetPassword) return;

  const resetEmail = (process.env.ADMIN_RESET_EMAIL || 'admin@rental.local').trim().toLowerCase();
  const users = readData('users') || [];
  const existingIndex = users.findIndex(u => String(u.email || '').toLowerCase() === resetEmail);

  if (existingIndex >= 0) {
    const current = users[existingIndex];
    users[existingIndex] = {
      ...current,
      role: current.role || 'Администратор',
      status: 'Активен',
      password: hashPassword(resetPassword),
    };
    writeData('users', users);
    console.log(`[AUTH] Пароль пользователя ${resetEmail} обновлён через ADMIN_RESET_PASSWORD`);
  } else {
    const restoredAdmin = {
      id:       'U-reset-admin',
      name:     'Администратор',
      email:    resetEmail,
      role:     'Администратор',
      status:   'Активен',
      password: hashPassword(resetPassword),
    };
    writeData('users', [...users, restoredAdmin]);
    console.log(`[AUTH] Администратор ${resetEmail} создан через ADMIN_RESET_PASSWORD`);
  }

  console.log('[AUTH] ⚠️  После входа удалите ADMIN_RESET_PASSWORD из env Railway');
}

registerBotRoutes(app, {
  handleCommand: auditedHandleCommand,
  handleBotStarted: auditedHandleBotStarted,
  handleCallback: auditedHandleCallback,
  answerCallback,
  logger: console,
});

registerSystemRoutes(app, {
  readData,
  writeData,
  getSnapshot,
  saveSnapshot,
  botToken: BOT_TOKEN,
  getBotUsers,
  sendMessage,
  countActiveSessions,
  dbPath: DB_PATH,
  webhookUrl: WEBHOOK_URL,
});

startServer({
  app,
  port: PORT,
  deps: {
    migrateJsonFilesToDb,
    cleanupExpiredSessions,
    seedDefaultUsers,
    ensureLegacyDefaultUsers,
    migrateReferenceCollections,
    migrateLegacyRepairFacts,
    applyAdminResetFromEnv,
    registerWebhook,
    dbPath: DB_PATH,
    botToken: BOT_TOKEN,
    readData,
    writeData,
    normalizeServiceWorkRecord,
    seedsDir: path.join(__dirname, 'seeds'),
  },
  logger: console,
});
