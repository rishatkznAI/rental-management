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
const fs      = require('fs');
const path    = require('path');
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
const MAX_API   = 'https://platform-api.max.ru';

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
function getSnapshot()    { return readData('snapshot') || {}; }
function saveSnapshot(s)  { writeData('snapshot', s); }

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
  rentals:        ['Администратор', 'Менеджер по аренде'],
  gantt_rentals:  ['Администратор', 'Менеджер по аренде'],
  service:        ['Администратор', 'Механик'],
  clients:        ['Администратор', 'Менеджер по аренде'],
  documents:      ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
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
    const normalizedEmail = String(email).trim().toLowerCase();
    const user = users.find(
      u => String(u.email || '').trim().toLowerCase() === normalizedEmail
    );

    if (!user) {
      return res.status(401).json({ ok: false, error: 'Пользователь с таким email не найден' });
    }

    if (user.status !== 'Активен') {
      return res.status(403).json({ ok: false, error: 'Аккаунт деактивирован. Обратитесь к администратору' });
    }

    if (!verifyPassword(password, user.password)) {
      return res.status(401).json({ ok: false, error: 'Неверный пароль' });
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
  service_works:  'SW',
  spare_parts:    'PT',
  repair_work_items: 'RWI',
  repair_part_items: 'RPI',
  planner_items:  'PI',
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

function normalizeEquipmentRecord(equipment) {
  if (!equipment) return equipment;
  return {
    ...equipment,
    category: equipment.category || 'own',
    activeInFleet: equipment.activeInFleet !== false,
    priority: equipment.priority || 'medium',
  };
}

function canEquipmentParticipateInRentals(equipment) {
  const normalized = normalizeEquipmentRecord(equipment);
  return normalized.activeInFleet && (normalized.category === 'own' || normalized.category === 'partner');
}

function findEquipmentForRentalPayload(payload) {
  const equipmentId = payload?.equipmentId;
  const inventoryNumber =
    payload?.equipmentInv
    || payload?.inventoryNumber
    || (Array.isArray(payload?.equipment) ? payload.equipment[0] : null);

  const equipment = (readData('equipment') || []).map(normalizeEquipmentRecord);
  if (equipmentId) {
    const byId = equipment.find(item => item.id === equipmentId);
    if (byId) return byId;
  }
  if (!inventoryNumber) return null;
  return equipment.find(item => item.inventoryNumber === inventoryNumber) || null;
}

function validateRentalEquipmentPayload(payload) {
  const equipment = findEquipmentForRentalPayload(payload);
  if (!equipment) {
    return { ok: false, status: 400, error: 'Техника для аренды не найдена' };
  }

  if (!canEquipmentParticipateInRentals(equipment)) {
    return {
      ok: false,
      status: 400,
      error: 'Эта техника не может участвовать в аренде: проверьте категорию и признак активного парка',
    };
  }

  return { ok: true };
}

function registerCRUD(router, collection) {
  const prefix = ID_PREFIXES[collection] || collection;

  // GET /api/:collection — список
  router.get(`/${collection}`, requireAuth, (req, res) => {
    let data = readData(collection) || [];
    if (collection === 'service_works') {
      data = data.map(normalizeServiceWorkRecord).sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
      if (req.query.active === '1') {
        data = data.filter(item => item.isActive);
      }
    }
    if (collection === 'spare_parts') {
      data = data.map(normalizeSparePartRecord).sort((a, b) => a.name.localeCompare(b.name, 'ru'));
      if (req.query.active === '1') {
        data = data.filter(item => item.isActive);
      }
    }
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
    let item = data.find(i => i.id === req.params.id);
    if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
    if (collection === 'service_works') item = normalizeServiceWorkRecord(item);
    if (collection === 'spare_parts') item = normalizeSparePartRecord(item);
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
    try {
      if (collection === 'rentals' || collection === 'gantt_rentals') {
        const validation = validateRentalEquipmentPayload(req.body);
        if (!validation.ok) {
          return res.status(validation.status).json({ ok: false, error: validation.error });
        }
      }

      if (collection === 'service_works') {
        requireNonEmptyString(req.body?.name, 'Название работы');
      }
      if (collection === 'spare_parts') {
        requireNonEmptyString(req.body?.name, 'Название запчасти');
        requireNonEmptyString(req.body?.unit, 'Единица измерения');
      }

      const data = readData(collection) || [];
      let newItem = { ...req.body, id: req.body.id || generateId(prefix) };
      if (collection === 'service_works') {
        newItem = normalizeServiceWorkRecord({ ...newItem, updatedAt: nowIso() });
      }
      if (collection === 'spare_parts') {
        newItem = normalizeSparePartRecord({ ...newItem, updatedAt: nowIso() });
      }
      data.push(newItem);
      writeData(collection, data);
      if (collection === 'users') {
        return res.status(201).json(sanitizeUser(newItem));
      }
      res.status(201).json(newItem);
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // PATCH /api/:collection/:id — обновить
  router.patch(`/${collection}/:id`, requireAuth, requireWrite(collection), (req, res) => {
    const data = readData(collection) || [];
    const idx = data.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });

    try {
      if (collection === 'rentals' || collection === 'gantt_rentals') {
        const validation = validateRentalEquipmentPayload({ ...data[idx], ...req.body });
        if (!validation.ok) {
          return res.status(validation.status).json({ ok: false, error: validation.error });
        }
      }

      if (collection === 'service_works') {
        requireNonEmptyString(req.body?.name ?? data[idx].name, 'Название работы');
        data[idx] = normalizeServiceWorkRecord({ ...data[idx], ...req.body, id: data[idx].id, createdAt: data[idx].createdAt, updatedAt: nowIso() });
      } else if (collection === 'spare_parts') {
        requireNonEmptyString(req.body?.name ?? data[idx].name, 'Название запчасти');
        requireNonEmptyString(req.body?.unit ?? data[idx].unit, 'Единица измерения');
        data[idx] = normalizeSparePartRecord({ ...data[idx], ...req.body, id: data[idx].id, createdAt: data[idx].createdAt, updatedAt: nowIso() });
      } else {
        data[idx] = { ...data[idx], ...req.body, id: data[idx].id };
      }
      writeData(collection, data);
      if (collection === 'users') {
        return res.json(sanitizeUser(data[idx]));
      }
      res.json(data[idx]);
    } catch (error) {
      res.status(400).json({ ok: false, error: error.message });
    }
  });

  // DELETE /api/:collection/:id — удалить
  router.delete(`/${collection}/:id`, requireAuth, requireWrite(collection), (req, res) => {
    const data = readData(collection) || [];
    const idx = data.findIndex(i => i.id === req.params.id);
    if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
    if (collection === 'service') {
      const repairId = data[idx].id;
      writeData('repair_work_items', (readData('repair_work_items') || []).filter(item => item.repairId !== repairId));
      writeData('repair_part_items', (readData('repair_part_items') || []).filter(item => item.repairId !== repairId));
    }
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

    if (collection === 'rentals' || collection === 'gantt_rentals') {
      for (const item of list) {
        const validation = validateRentalEquipmentPayload(item);
        if (!validation.ok) {
          return res.status(validation.status).json({ ok: false, error: validation.error });
        }
      }
    }

    if (collection === 'service_works') {
      writeData(collection, list.map(item => normalizeServiceWorkRecord({ ...item, updatedAt: nowIso() })));
      return res.json({ ok: true, count: list.length });
    }

    if (collection === 'spare_parts') {
      writeData(collection, list.map(item => normalizeSparePartRecord({ ...item, updatedAt: nowIso() })));
      return res.json({ ok: true, count: list.length });
    }

    // Для users: сохраняем пароли из базы, если в теле запроса их нет
    // (GET /api/users возвращает пользователей без паролей через sanitizeUser,
    //  поэтому при bulkReplace пароли нужно восстановить из существующих данных)
    if (collection === 'users') {
      const existing = readData('users') || [];
      const existingById = new Map(existing.map(u => [u.id, u]));
      const merged = list.map(u => {
        if (!u.password) {
          const existingPwd = existingById.get(u.id)?.password;
          if (existingPwd) return { ...u, password: existingPwd };
        }
        return u;
      });
      writeData('users', merged);
      return res.json({ ok: true, count: merged.length });
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
  'mechanics',
  'service_works',
  'spare_parts',
  'service_work_catalog',
  'spare_parts_catalog',
  'planner_items',
];

for (const col of COLLECTIONS) {
  registerCRUD(apiRouter, col);
}

function requireNonEmptyString(value, fieldName) {
  if (!String(value || '').trim()) {
    throw new Error(`Поле «${fieldName}» обязательно`);
  }
}

function findServiceTicketOr404(repairId, res) {
  const tickets = readData('service') || [];
  const ticket = tickets.find(item => item.id === repairId);
  if (!ticket) {
    res.status(404).json({ ok: false, error: 'Заявка на ремонт не найдена' });
    return null;
  }
  return ticket;
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
        });
      }
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

apiRouter.get('/service_works/active', requireAuth, (req, res) => {
  const list = (readData('service_works') || [])
    .map(normalizeServiceWorkRecord)
    .filter(item => item.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
  res.json(list);
});

apiRouter.post('/service_works/:id/deactivate', requireAuth, requireWrite('service_works'), (req, res) => {
  const list = readData('service_works') || [];
  const index = list.findIndex(item => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ ok: false, error: 'Работа не найдена' });
  }
  list[index] = normalizeServiceWorkRecord({ ...list[index], isActive: false, id: list[index].id, createdAt: list[index].createdAt, updatedAt: nowIso() });
  writeData('service_works', list);
  res.json(list[index]);
});

apiRouter.get('/spare_parts/active', requireAuth, (req, res) => {
  const list = (readData('spare_parts') || [])
    .map(normalizeSparePartRecord)
    .filter(item => item.isActive)
    .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
  res.json(list);
});

apiRouter.post('/spare_parts/:id/deactivate', requireAuth, requireWrite('spare_parts'), (req, res) => {
  const list = readData('spare_parts') || [];
  const index = list.findIndex(item => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ ok: false, error: 'Запчасть не найдена' });
  }
  list[index] = normalizeSparePartRecord({ ...list[index], isActive: false, id: list[index].id, createdAt: list[index].createdAt, updatedAt: nowIso() });
  writeData('spare_parts', list);
  res.json(list[index]);
});

apiRouter.get('/repair_work_items', requireAuth, (req, res) => {
  const repairId = String(req.query.repair_id || '').trim();
  const list = readData('repair_work_items') || [];
  const catalog = readData('service_works') || [];
  const catalogById = new Map(catalog.map(w => [w.id, w]));
  const sanitized = list.map(item => {
    const ref = catalogById.get(item.workId);
    const normHours = isNaN(item.normHoursSnapshot) || item.normHoursSnapshot == null
      ? (ref ? Math.max(0, Number(ref.normHours) || 0) : 0)
      : Number(item.normHoursSnapshot);
    const ratePerHour = isNaN(item.ratePerHourSnapshot) || item.ratePerHourSnapshot == null
      ? (ref ? Math.max(0, Number(ref.ratePerHour) || 0) : 0)
      : Number(item.ratePerHourSnapshot);
    return {
      ...item,
      normHoursSnapshot: normHours,
      ratePerHourSnapshot: ratePerHour,
      nameSnapshot: item.nameSnapshot || ref?.name || 'Работа',
      quantity: isNaN(item.quantity) || item.quantity == null ? 1 : Number(item.quantity),
    };
  });
  res.json(repairId ? sanitized.filter(item => item.repairId === repairId) : sanitized);
});

apiRouter.post('/repair_work_items', requireAuth, requireWrite('repair_work_items'), (req, res) => {
  try {
    const { repairId, workId } = req.body || {};
    const quantity = Number(req.body?.quantity);
    requireNonEmptyString(repairId, 'Заявка');
    requireNonEmptyString(workId, 'Работа');
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Количество работы должно быть больше 0');
    }
    if (!findServiceTicketOr404(repairId, res)) return;

    const work = (readData('service_works') || []).find(item => item.id === workId && item.isActive !== false);
    if (!work) {
      return res.status(404).json({ ok: false, error: 'Работа из справочника не найдена или отключена' });
    }

    const list = readData('repair_work_items') || [];
    const item = {
      id: generateId(ID_PREFIXES.repair_work_items),
      repairId,
      workId,
      quantity,
      normHoursSnapshot: Math.max(0, Number(work.normHours) || 0),
      ratePerHourSnapshot: Math.max(0, Number(work.ratePerHour) || 0),
      nameSnapshot: String(work.name || '').trim(),
      categorySnapshot: work.category ? String(work.category).trim() : undefined,
      createdAt: nowIso(),
    };
    list.push(item);
    writeData('repair_work_items', list);
    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

apiRouter.delete('/repair_work_items/:id', requireAuth, requireWrite('repair_work_items'), (req, res) => {
  const list = readData('repair_work_items') || [];
  const index = list.findIndex(item => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ ok: false, error: 'Строка работы не найдена' });
  }
  list.splice(index, 1);
  writeData('repair_work_items', list);
  res.json({ ok: true });
});

apiRouter.get('/repair_part_items', requireAuth, (req, res) => {
  const repairId = String(req.query.repair_id || '').trim();
  const list = readData('repair_part_items') || [];
  const catalog = readData('spare_parts') || [];
  const catalogById = new Map(catalog.map(p => [p.id, p]));
  const sanitized = list.map(item => {
    const ref = catalogById.get(item.partId);
    return {
      ...item,
      nameSnapshot: item.nameSnapshot || ref?.name || 'Запчасть',
      priceSnapshot: isNaN(item.priceSnapshot) || item.priceSnapshot == null
        ? (ref ? Math.max(0, Number(ref.defaultPrice) || 0) : 0)
        : Number(item.priceSnapshot),
      quantity: isNaN(item.quantity) || item.quantity == null ? 1 : Number(item.quantity),
      unitSnapshot: item.unitSnapshot || ref?.unit || 'шт',
    };
  });
  res.json(repairId ? sanitized.filter(item => item.repairId === repairId) : sanitized);
});

apiRouter.post('/repair_part_items', requireAuth, requireWrite('repair_part_items'), (req, res) => {
  try {
    const { repairId, partId } = req.body || {};
    const quantity = Number(req.body?.quantity);
    const priceSnapshot = Number(req.body?.priceSnapshot);
    requireNonEmptyString(repairId, 'Заявка');
    requireNonEmptyString(partId, 'Запчасть');
    if (!Number.isFinite(quantity) || quantity <= 0) {
      throw new Error('Количество запчастей должно быть больше 0');
    }
    if (!findServiceTicketOr404(repairId, res)) return;

    const part = (readData('spare_parts') || []).find(item => item.id === partId && item.isActive !== false);
    if (!part) {
      return res.status(404).json({ ok: false, error: 'Запчасть из справочника не найдена или отключена' });
    }

    const safePrice = Number.isFinite(priceSnapshot)
      ? Math.max(0, priceSnapshot)
      : Math.max(0, Number(part.defaultPrice) || 0);

    const list = readData('repair_part_items') || [];
    const item = {
      id: generateId(ID_PREFIXES.repair_part_items),
      repairId,
      partId,
      quantity,
      priceSnapshot: safePrice,
      nameSnapshot: String(part.name || '').trim(),
      articleSnapshot: part.article ? String(part.article).trim() : (part.sku ? String(part.sku).trim() : undefined),
      unitSnapshot: String(part.unit || 'шт').trim() || 'шт',
      createdAt: nowIso(),
    };
    list.push(item);
    writeData('repair_part_items', list);
    res.status(201).json(item);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
  }
});

apiRouter.delete('/repair_part_items/:id', requireAuth, requireWrite('repair_part_items'), (req, res) => {
  const list = readData('repair_part_items') || [];
  const index = list.findIndex(item => item.id === req.params.id);
  if (index === -1) {
    return res.status(404).json({ ok: false, error: 'Строка запчасти не найдена' });
  }
  list.splice(index, 1);
  writeData('repair_part_items', list);
  res.json({ ok: true });
});

apiRouter.get('/reports/mechanics-workload', requireAuth, (req, res) => {
  const mechanics = readData('mechanics') || [];
  const tickets = readData('service') || [];
  const equipment = readData('equipment') || [];
  const workItems = readData('repair_work_items') || [];
  const partItems = readData('repair_part_items') || [];

  const ticketMap = new Map(tickets.map(item => [item.id, item]));
  const equipmentMap = new Map(equipment.map(item => [item.id, item]));
  const partsByRepair = new Map();
  for (const part of partItems) {
    const list = partsByRepair.get(part.repairId) || [];
    list.push(part);
    partsByRepair.set(part.repairId, list);
  }

  const rows = workItems.map(item => {
    const ticket = ticketMap.get(item.repairId);
    const eq = ticket?.equipmentId ? equipmentMap.get(ticket.equipmentId) : null;
    const mechanic = ticket?.assignedMechanicId
      ? mechanics.find(entry => entry.id === ticket.assignedMechanicId)
      : null;
    const repairParts = partsByRepair.get(item.repairId) || [];
    const partsCost = repairParts.reduce((sum, part) => sum + (Number(part.priceSnapshot) || 0) * (Number(part.quantity) || 0), 0);
    const partNames = Array.from(new Set(repairParts.map(part => part.nameSnapshot).filter(Boolean)));
    return {
      mechanicId: ticket?.assignedMechanicId || '',
      mechanicName: mechanic?.name || ticket?.assignedMechanicName || ticket?.assignedTo || 'Не назначен',
      repairId: item.repairId,
      repairStatus: ticket?.status || '',
      createdAt: item.createdAt || ticket?.createdAt || '',
      equipmentId: ticket?.equipmentId || '',
      equipmentLabel: ticket?.equipment || [eq?.manufacturer, eq?.model].filter(Boolean).join(' ') || '—',
      equipmentType: eq?.type || ticket?.equipmentType || '',
      equipmentTypeLabel: ticket?.equipmentTypeLabel || ticket?.equipmentType || eq?.type || '',
      inventoryNumber: ticket?.inventoryNumber || eq?.inventoryNumber || '—',
      serialNumber: ticket?.serialNumber || eq?.serialNumber || '—',
      workName: item.nameSnapshot,
      workCategory: item.categorySnapshot || '',
      partNames,
      partNamesLabel: partNames.join(', '),
      quantity: Number(item.quantity) || 0,
      normHours: Number(item.normHoursSnapshot) || 0,
      totalNormHours: (Number(item.quantity) || 0) * (Number(item.normHoursSnapshot) || 0),
      partsCost,
    };
  });

  const summaryMap = new Map();
  for (const row of rows) {
    const key = row.mechanicId || row.mechanicName;
    if (!summaryMap.has(key)) {
      summaryMap.set(key, {
        mechanicId: row.mechanicId,
        mechanicName: row.mechanicName,
        repairsCount: 0,
        worksCount: 0,
        totalNormHours: 0,
        partsCost: 0,
        equipmentIds: new Set(),
      });
    }
    const summary = summaryMap.get(key);
    summary.repairsCount += 1;
    summary.worksCount += row.quantity;
    summary.totalNormHours += row.totalNormHours;
    summary.partsCost += row.partsCost;
    if (row.equipmentId) summary.equipmentIds.add(row.equipmentId);
  }

  const summary = [...summaryMap.values()].map(item => ({
    mechanicId: item.mechanicId,
    mechanicName: item.mechanicName,
    repairsCount: item.repairsCount,
    worksCount: item.worksCount,
    totalNormHours: Number(item.totalNormHours.toFixed(2)),
    partsCost: Number(item.partsCost.toFixed(2)),
    equipmentCount: item.equipmentIds.size,
  })).sort((a, b) => b.totalNormHours - a.totalNormHours);

  res.json({ summary, rows });
});

apiRouter.post('/admin/migrate-repair-facts', requireAuth, requireWrite('service_works'), (req, res) => {
  const result = migrateLegacyRepairFacts();
  res.json({ ok: true, ...result });
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

// ── MAX Bot API ────────────────────────────────────────────────────────────────

async function maxRequest(method, endpoint, body = null) {
  const url = `${MAX_API}${endpoint}`;
  const opts = {
    method,
    headers: {
      'Authorization': BOT_TOKEN,
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
    update_types: ['message_created', 'bot_started'],
  });
  if (res && !res.error) {
    console.log(`[BOT] Webhook зарегистрирован: ${webhookUrl}/bot/webhook`);
  } else {
    console.error('[BOT] Ошибка регистрации webhook:', res?.message || res);
  }
}

async function handleBotStarted(senderId, phone, payload) {
  const payloadLine = payload ? `\nPayload: ${payload}` : '';
  return sendMessage(
    senderId,
    `👋 Добро пожаловать в бот «Подъёмники»!${payloadLine}\n\nДля входа напишите:\n/start email@company.ru пароль`,
  );
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

function getBotSession(phone) {
  return getBotSessions()[phone] || {};
}

function updateBotSession(phone, patch) {
  const sessions = getBotSessions();
  sessions[phone] = {
    ...(sessions[phone] || {}),
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  saveBotSessions(sessions);
  return sessions[phone];
}

function clearBotSession(phone) {
  const sessions = getBotSessions();
  delete sessions[phone];
  saveBotSessions(sessions);
}

function normalizeBotText(value) {
  return String(value || '').trim().toLowerCase();
}

function botSearchMatches(haystack, query) {
  const text = normalizeBotText(haystack);
  const normalizedQuery = normalizeBotText(query);
  if (!normalizedQuery) return true;
  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  return tokens.every(token => {
    if (text.includes(token)) return true;
    if (token.length >= 5 && text.includes(token.slice(0, -1))) return true;
    if (token.length >= 6 && text.includes(token.slice(0, -2))) return true;
    return false;
  });
}

function serviceStatusLabel(status) {
  return ({
    new: 'Новый',
    in_progress: 'В работе',
    waiting_parts: 'Ожидание запчастей',
    ready: 'Готово',
    closed: 'Закрыто',
  })[status] || status;
}

function servicePriorityLabel(priority) {
  return ({
    low: 'Низкий',
    medium: 'Средний',
    high: 'Высокий',
    critical: 'Критический',
  })[priority] || priority;
}

function openServiceStatuses() {
  return ['new', 'in_progress', 'waiting_parts', 'ready'];
}

function readServiceTickets() {
  return readData('service') || [];
}

function writeServiceTickets(tickets) {
  writeData('service', tickets);
}

function findServiceTicketById(ticketId) {
  const normalizedId = normalizeBotText(ticketId);
  return readServiceTickets().find(ticket => normalizeBotText(ticket.id) === normalizedId) || null;
}

function saveServiceTicket(updatedTicket) {
  const tickets = readServiceTickets();
  const nextTickets = tickets.map(ticket => ticket.id === updatedTicket.id ? updatedTicket : ticket);
  writeServiceTickets(nextTickets);
}

function appendServiceLog(ticket, text, author, type = 'comment') {
  return {
    ...ticket,
    workLog: [
      ...(ticket.workLog || []),
      { date: new Date().toISOString(), text, author, type },
    ],
  };
}

function getMechanicReferenceByUser(authUser) {
  const mechanics = readData('mechanics') || [];
  const byName = mechanics.find(item => item.status === 'active' && normalizeBotText(item.name) === normalizeBotText(authUser.userName));
  return byName || null;
}

function syncEquipmentStatusForService(ticket, newStatus) {
  if (!ticket?.equipmentId && !ticket?.inventoryNumber) return;

  const equipmentList = readData('equipment') || [];
  const ganttRentals = readData('gantt_rentals') || [];
  const tickets = readServiceTickets();
  const openStatuses = openServiceStatuses();

  const remainingOpen = tickets.some(existing =>
    existing.id !== ticket.id &&
    openStatuses.includes(existing.status) &&
    (
      (ticket.equipmentId && existing.equipmentId === ticket.equipmentId) ||
      (ticket.inventoryNumber && existing.inventoryNumber === ticket.inventoryNumber)
    )
  );

  const hasActiveRental = ganttRentals.some(rental =>
    rental.equipmentInv === ticket.inventoryNumber &&
    rental.status !== 'returned' &&
    rental.status !== 'closed'
  );

  const nextEquipment = equipmentList.map(item => {
    const matches =
      (ticket.equipmentId && item.id === ticket.equipmentId) ||
      (ticket.inventoryNumber && item.inventoryNumber === ticket.inventoryNumber);
    if (!matches) return item;

    let nextStatus = item.status;
    if (openStatuses.includes(newStatus)) {
      nextStatus = 'in_service';
    } else if (!remainingOpen) {
      nextStatus = hasActiveRental ? 'rented' : 'available';
    }
    return { ...item, status: nextStatus };
  });

  writeData('equipment', nextEquipment);
}

function updateServiceTicketStatus(ticket, newStatus, author, text) {
  const updated = appendServiceLog({
    ...ticket,
    status: newStatus,
    closedAt: (newStatus === 'closed' || newStatus === 'ready') ? new Date().toISOString() : ticket.closedAt,
  }, text, author, 'status_change');
  saveServiceTicket(updated);
  syncEquipmentStatusForService(updated, newStatus);
  return updated;
}

function formatTicketLine(ticket) {
  const assigned = ticket.assignedMechanicName ? ` · ${ticket.assignedMechanicName}` : '';
  return `• ${ticket.id} · ${serviceStatusLabel(ticket.status)} · ${ticket.equipment}\n  ${ticket.reason}${assigned}`;
}

function formatCurrentRepairDraft(ticket) {
  const workItems = (readData('repair_work_items') || []).filter(item => item.repairId === ticket.id);
  const partItems = (readData('repair_part_items') || []).filter(item => item.repairId === ticket.id);
  const summary = ticket.resultData?.summary || ticket.result || 'не заполнен';
  const worksText = workItems.length
    ? workItems.map((item, index) => `${index + 1}. ${item.nameSnapshot} × ${item.quantity}`).join('\n')
    : 'нет';
  const partsText = partItems.length
    ? partItems.map((item, index) => `${index + 1}. ${item.nameSnapshot} × ${item.quantity} (${Number(item.priceSnapshot || 0).toLocaleString('ru-RU')} ₽)`).join('\n')
    : 'нет';

  return [
    `🧾 Текущий отчет по ${ticket.id}`,
    `${ticket.equipment}`,
    `Статус: ${serviceStatusLabel(ticket.status)}`,
    `Итог: ${summary}`,
    '',
    `Работы:\n${worksText}`,
    '',
    `Запчасти:\n${partsText}`,
  ].join('\n');
}

function getAccessibleServiceTickets(authUser) {
  const tickets = readServiceTickets();
  if (authUser.userRole === 'Механик') {
    return tickets.filter(ticket =>
      ticket.status !== 'closed' &&
      (
        !ticket.assignedMechanicName ||
        normalizeBotText(ticket.assignedMechanicName) === normalizeBotText(authUser.userName)
      )
    );
  }
  return tickets.filter(ticket => ticket.status !== 'closed');
}

function formatServiceForUser(authUser) {
  const tickets = getAccessibleServiceTickets(authUser);
  if (!tickets.length) return '✅ Открытых сервисных заявок нет.';

  const lines = tickets.slice(0, 10).map(formatTicketLine);
  return [
    authUser.userRole === 'Механик'
      ? `🔧 Доступные вам сервисные заявки (${tickets.length}):`
      : `🔧 Открытые сервисные заявки (${tickets.length}):`,
    ...lines,
    '',
    'Подсказка: /вработу ID или /ремонт ID',
    tickets.length > 10 ? `... и ещё ${tickets.length - 10}` : '',
  ].filter(Boolean).join('\n');
}

function setCurrentRepair(phone, repairId) {
  updateBotSession(phone, {
    activeRepairId: repairId,
    lastEquipmentSearch: [],
    lastWorkSearch: [],
    lastPartSearch: [],
  });
}

function getCurrentRepair(phone) {
  const session = getBotSession(phone);
  if (!session.activeRepairId) return null;
  return findServiceTicketById(session.activeRepairId);
}

function searchServiceWorks(query) {
  const works = (readData('service_works') || []).filter(item => item.isActive !== false);
  if (!normalizeBotText(query)) return works.slice(0, 7);
  return works.filter(item =>
    botSearchMatches(item.name, query) ||
    botSearchMatches(item.category, query) ||
    botSearchMatches(item.description, query)
  ).slice(0, 7);
}

function searchSpareParts(query) {
  const parts = (readData('spare_parts') || []).filter(item => item.isActive !== false);
  if (!normalizeBotText(query)) return parts.slice(0, 7);
  return parts.filter(item =>
    botSearchMatches(item.name, query) ||
    botSearchMatches(item.article, query) ||
    botSearchMatches(item.category, query) ||
    botSearchMatches(item.manufacturer, query)
  ).slice(0, 7);
}

function searchEquipmentForBot(query) {
  const equipment = readData('equipment') || [];
  if (!normalizeBotText(query)) return equipment.slice(0, 7);
  return equipment.filter(item =>
    botSearchMatches(item.inventoryNumber, query) ||
    botSearchMatches(item.serialNumber, query) ||
    botSearchMatches(item.manufacturer, query) ||
    botSearchMatches(item.model, query) ||
    botSearchMatches(item.location, query)
  ).slice(0, 7);
}

function getOpenTicketByEquipment(equipment) {
  return readServiceTickets().find(ticket =>
    openServiceStatuses().includes(ticket.status) &&
    (
      (equipment.id && ticket.equipmentId === equipment.id) ||
      (equipment.serialNumber && ticket.serialNumber === equipment.serialNumber) ||
      (equipment.inventoryNumber && ticket.inventoryNumber === equipment.inventoryNumber)
    )
  ) || null;
}

function createServiceTicketFromBot(equipment, authUser, reason, description = '') {
  const now = new Date().toISOString();
  const mechanicRef = getMechanicReferenceByUser(authUser);
  const assignedName = mechanicRef?.name || authUser.userName;
  const newTicket = {
    id: generateId(ID_PREFIXES.service),
    equipmentId: equipment.id,
    equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
    inventoryNumber: equipment.inventoryNumber,
    serialNumber: equipment.serialNumber,
    equipmentType: equipment.type,
    equipmentTypeLabel: equipment.type,
    location: equipment.location,
    reason,
    description: description || reason,
    priority: 'medium',
    sla: '24 ч',
    assignedTo: assignedName,
    assignedMechanicId: mechanicRef?.id,
    assignedMechanicName: assignedName,
    createdBy: authUser.userName,
    createdByUserId: authUser.userId,
    createdByUserName: authUser.userName,
    reporterContact: authUser.userName,
    source: 'bot',
    status: 'in_progress',
    result: '',
    resultData: {
      summary: '',
      partsUsed: [],
      worksPerformed: [],
    },
    workLog: [
      {
        date: now,
        text: 'Заявка создана через MAX',
        author: authUser.userName,
        type: 'status_change',
      },
      {
        date: now,
        text: `Механик ${assignedName} взял заявку в работу через MAX`,
        author: assignedName,
        type: 'assign',
      },
    ],
    parts: [],
    createdAt: now,
  };

  writeServiceTickets([...readServiceTickets(), newTicket]);
  syncEquipmentStatusForService(newTicket, 'in_progress');
  return newTicket;
}

function addRepairWorkItemFromCatalog(ticket, work, quantity) {
  const items = readData('repair_work_items') || [];
  const nextItem = {
    id: generateId(ID_PREFIXES.repair_work_items),
    repairId: ticket.id,
    workId: work.id,
    quantity,
    normHoursSnapshot: Math.max(0, Number(work.normHours) || 0),
    nameSnapshot: work.name,
    categorySnapshot: work.category,
    createdAt: nowIso(),
  };
  items.push(nextItem);
  writeData('repair_work_items', items);
  return nextItem;
}

function addRepairPartItemFromCatalog(ticket, part, quantity, priceSnapshot) {
  const items = readData('repair_part_items') || [];
  const nextItem = {
    id: generateId(ID_PREFIXES.repair_part_items),
    repairId: ticket.id,
    partId: part.id,
    quantity,
    priceSnapshot,
    nameSnapshot: part.name,
    articleSnapshot: part.article || part.sku,
    unitSnapshot: part.unit || 'шт',
    createdAt: nowIso(),
  };
  items.push(nextItem);
  writeData('repair_part_items', items);
  return nextItem;
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

function formatEquipmentForBot(item) {
  const typeLabel =
    item.type === 'scissor' ? 'ножничный'
      : item.type === 'articulated' ? 'коленчатый'
      : item.type === 'telescopic' ? 'телескопический'
      : 'подъёмник';

  return [
    item.inventoryNumber || 'без INV',
    `${item.manufacturer || ''} ${item.model || ''}`.trim(),
    item.serialNumber ? `SN ${item.serialNumber}` : '',
    typeLabel,
  ].filter(Boolean).join(' · ');
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
  const lines = [
    '',
    '📱 Доступные команды:',
    '',
    `  /аренды    — активные аренды${role === 'Менеджер по аренде' ? ' (только ваши)' : ''}`,
    '  /техника   — свободная техника',
    '  /сервис    — открытые сервисные заявки',
  ];

  if (role === 'Механик' || role === 'Администратор') {
    lines.push(
      '  /моизаявки             — мои заявки в сервисе',
      '  /найтитехнику поиск    — найти технику для ремонта',
      '  /создатьзаявку № причина — открыть ремонт по технике',
      '  /вработу ID           — взять заявку в работу',
      '  /ремонт ID            — выбрать текущую заявку',
      '  /итог текст           — сохранить итог ремонта',
      '  /работы поиск         — найти работы в справочнике',
      '  /добавитьработу № qty — добавить работу в отчет',
      '  /запчасти поиск       — найти запчасти в справочнике',
      '  /добавитьзапчасть № qty [цена] — добавить запчасть',
      '  /черновик             — показать текущий отчет',
      '  /ожидание             — ожидание запчастей',
      '  /готово               — работы завершены',
      '  /закрыть              — закрыть заявку',
      '  /сброс                — сбросить текущую заявку',
    );
  }

  lines.push('  /помощь    — этот список');
  return lines.join('\n');
}

async function handleCommand(senderId, phone, text) {
  const trimmed = text.trim();
  const lower = trimmed.toLowerCase();
  const parts  = trimmed.split(/\s+/);

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
  const canManageRepair = userRole === 'Механик' || userRole === 'Администратор';

  if (lower === '/аренды' || lower === '/rentals' || lower === '/мои' || lower === 'аренды') {
    const rentals = readData('rentals') || [];
    return sendMessage(senderId, formatRentals(rentals, userName, userRole));
  }

  if (lower === '/техника' || lower === '/equipment' || lower === 'техника') {
    const equipment = readData('equipment') || [];
    return sendMessage(senderId, formatEquipment(equipment));
  }

  if (lower === '/сервис' || lower === '/service' || lower === 'сервис' || lower === 'заявки') {
    return sendMessage(senderId, canManageRepair ? formatServiceForUser(authUser) : formatService(readData('service') || []));
  }

  if ((lower === '/моизаявки' || lower === '/myrepairs' || lower === 'мои заявки') && canManageRepair) {
    return sendMessage(senderId, formatServiceForUser(authUser));
  }

  if ((lower.startsWith('/найтитехнику') || lower.startsWith('/техпоиск')) && canManageRepair) {
    const command = lower.startsWith('/техпоиск') ? '/техпоиск' : '/найтитехнику';
    const query = trimmed.slice(command.length).trim();
    const matches = searchEquipmentForBot(query);
    if (!matches.length) {
      return sendMessage(senderId, '🔎 Техника не найдена. Ищите по INV, SN, модели или производителю.');
    }
    updateBotSession(phone, {
      lastEquipmentSearch: matches.map(item => ({
        id: item.id,
        inventoryNumber: item.inventoryNumber,
        serialNumber: item.serialNumber,
        model: item.model,
      })),
    });
    return sendMessage(senderId, [
      '🚜 Найденная техника:',
      ...matches.map((item, index) => `${index + 1}. ${formatEquipmentForBot(item)}`),
      '',
      'Чтобы открыть ремонт: /создатьзаявку НОМЕР причина',
      'Пример: /создатьзаявку 1 Течь гидравлики',
    ].join('\n'));
  }

  if (lower.startsWith('/создатьзаявку ') && canManageRepair) {
    const ticketArgs = trimmed.slice('/создатьзаявку'.length).trim();
    const firstSpace = ticketArgs.indexOf(' ');
    if (firstSpace <= 0) {
      return sendMessage(senderId, '❌ Формат команды: /создатьзаявку НОМЕР причина');
    }
    const index = Number(ticketArgs.slice(0, firstSpace).trim());
    const reason = ticketArgs.slice(firstSpace + 1).trim();
    const session = getBotSession(phone);
    const lastEquipmentSearch = Array.isArray(session.lastEquipmentSearch) ? session.lastEquipmentSearch : [];
    if (!Number.isInteger(index) || index <= 0 || index > lastEquipmentSearch.length) {
      return sendMessage(senderId, '❌ Неверный номер техники. Сначала выполните /найтитехнику поиск.');
    }
    if (!reason) {
      return sendMessage(senderId, '❌ Укажите причину обращения после номера техники.');
    }
    const selected = lastEquipmentSearch[index - 1];
    const equipment = (readData('equipment') || []).find(item => item.id === selected.id);
    if (!equipment) {
      return sendMessage(senderId, '❌ Техника больше не найдена в системе. Выполните поиск заново.');
    }
    const existingOpenTicket = getOpenTicketByEquipment(equipment);
    if (existingOpenTicket) {
      setCurrentRepair(phone, existingOpenTicket.id);
      return sendMessage(senderId, [
        `ℹ️ По этой технике уже есть открытая заявка: ${existingOpenTicket.id}`,
        `${existingOpenTicket.equipment}`,
        `Причина: ${existingOpenTicket.reason}`,
        '',
        'Я открыл её как текущую. Можете продолжать работу:',
        '• /итог текст',
        '• /работы поиск',
        '• /запчасти поиск',
        '• /готово',
        '• /закрыть',
      ].join('\n'));
    }
    const ticket = createServiceTicketFromBot(equipment, authUser, reason);
    setCurrentRepair(phone, ticket.id);
    return sendMessage(senderId, [
      `✅ Создана заявка ${ticket.id}`,
      formatEquipmentForBot(equipment),
      `Причина: ${ticket.reason}`,
      '',
      'Заявка уже открыта как текущая. Дальше можно писать:',
      '• /итог текст',
      '• /работы поиск',
      '• /запчасти поиск',
      '• /черновик',
      '• /готово',
      '• /закрыть',
    ].join('\n'));
  }

  if (lower.startsWith('/вработу ') && canManageRepair) {
    const repairId = trimmed.slice('/вработу'.length).trim();
    const ticket = findServiceTicketById(repairId);
    if (!ticket) {
      return sendMessage(senderId, '❌ Заявка не найдена. Используйте /моизаявки или /сервис.');
    }
    const mechanicRef = getMechanicReferenceByUser(authUser);
    const assignedName = mechanicRef?.name || authUser.userName;
    const updated = appendServiceLog({
      ...ticket,
      assignedTo: assignedName,
      assignedMechanicId: mechanicRef?.id || ticket.assignedMechanicId,
      assignedMechanicName: assignedName,
    }, `Механик ${assignedName} взял заявку в работу через MAX`, assignedName, 'assign');
    saveServiceTicket(updated);
    const withStatus = updateServiceTicketStatus(updated, 'in_progress', assignedName, 'Заявка взята в работу через MAX');
    setCurrentRepair(phone, withStatus.id);
    return sendMessage(senderId, [
      `✅ Заявка ${withStatus.id} взята в работу`,
      `${withStatus.equipment}`,
      `Причина: ${withStatus.reason}`,
      '',
      'Дальше можно сразу работать в чате:',
      '• /итог текст',
      '• /работы гидравлика',
      '• /запчасти фильтр',
      '• /черновик',
      '• /готово',
    ].join('\n'));
  }

  if (lower.startsWith('/ремонт ') && canManageRepair) {
    const repairId = trimmed.slice('/ремонт'.length).trim();
    const ticket = findServiceTicketById(repairId);
    if (!ticket) {
      return sendMessage(senderId, '❌ Заявка не найдена.');
    }
    setCurrentRepair(phone, ticket.id);
    return sendMessage(senderId, [
      `🛠 Текущая заявка: ${ticket.id}`,
      `${ticket.equipment}`,
      `Причина: ${ticket.reason}`,
      `Статус: ${serviceStatusLabel(ticket.status)}`,
      '',
      'Теперь можно отправлять:',
      '• /итог текст',
      '• /работы поиск',
      '• /запчасти поиск',
      '• /черновик',
    ].join('\n'));
  }

  if (lower === '/черновик' && canManageRepair) {
    const ticket = getCurrentRepair(phone);
    if (!ticket) {
      return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID или /вработу ID');
    }
    return sendMessage(senderId, formatCurrentRepairDraft(ticket));
  }

  if (lower === '/сброс' && canManageRepair) {
    clearBotSession(phone);
    return sendMessage(senderId, '🧹 Текущая заявка сброшена. Выберите новую через /ремонт ID');
  }

  if (lower.startsWith('/итог ') && canManageRepair) {
    const ticket = getCurrentRepair(phone);
    if (!ticket) {
      return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
    }
    const summary = trimmed.slice('/итог'.length).trim();
    if (!summary) {
      return sendMessage(senderId, '❌ После команды /итог нужно написать текст результата ремонта.');
    }
    const updated = appendServiceLog({
      ...ticket,
      result: summary,
      resultData: {
        ...(ticket.resultData || {}),
        summary,
        worksPerformed: ticket.resultData?.worksPerformed || [],
        partsUsed: ticket.resultData?.partsUsed || [],
      },
    }, 'Обновлён итог ремонта через MAX', authUser.userName, 'repair_result');
    saveServiceTicket(updated);
    return sendMessage(senderId, `✅ Итог ремонта сохранён для ${ticket.id}`);
  }

  if (lower.startsWith('/работы') && canManageRepair) {
    const ticket = getCurrentRepair(phone);
    if (!ticket) {
      return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
    }
    const query = trimmed.slice('/работы'.length).trim();
    const matches = searchServiceWorks(query);
    if (!matches.length) {
      return sendMessage(senderId, '🔎 По этому запросу активные работы не найдены.');
    }
    updateBotSession(phone, {
      activeRepairId: ticket.id,
      lastWorkSearch: matches.map(item => ({ id: item.id, name: item.name })),
    });
    return sendMessage(senderId, [
      '🧰 Найденные работы:',
      ...matches.map((item, index) => `${index + 1}. ${item.name}${item.category ? ` · ${item.category}` : ''} · ${Number(item.normHours || 0).toLocaleString('ru-RU')} н/ч`),
      '',
      'Добавить: /добавитьработу НОМЕР КОЛИЧЕСТВО',
      'Пример: /добавитьработу 1 2',
    ].join('\n'));
  }

  if (lower.startsWith('/добавитьработу ') && canManageRepair) {
    const ticket = getCurrentRepair(phone);
    if (!ticket) {
      return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
    }
    const [, indexRaw, qtyRaw] = parts;
    const index = Number(indexRaw);
    const quantity = Number(qtyRaw);
    const session = getBotSession(phone);
    const lastWorkSearch = Array.isArray(session.lastWorkSearch) ? session.lastWorkSearch : [];
    if (!Number.isInteger(index) || index <= 0 || index > lastWorkSearch.length) {
      return sendMessage(senderId, '❌ Номер работы указан неверно. Сначала выполните /работы поиск.');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return sendMessage(senderId, '❌ Количество работы должно быть числом больше 0.');
    }
    const selected = lastWorkSearch[index - 1];
    const work = (readData('service_works') || []).find(item => item.id === selected.id && item.isActive !== false);
    if (!work) {
      return sendMessage(senderId, '❌ Работа больше недоступна в справочнике. Выполните поиск заново.');
    }
    addRepairWorkItemFromCatalog(ticket, work, quantity);
    const updated = appendServiceLog(ticket, `Добавлена работа через MAX: ${work.name} × ${quantity}`, authUser.userName, 'repair_result');
    saveServiceTicket(updated);
    return sendMessage(senderId, `✅ Добавлена работа: ${work.name} × ${quantity}`);
  }

  if (lower.startsWith('/запчасти') && canManageRepair) {
    const ticket = getCurrentRepair(phone);
    if (!ticket) {
      return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
    }
    const query = trimmed.slice('/запчасти'.length).trim();
    const matches = searchSpareParts(query);
    if (!matches.length) {
      return sendMessage(senderId, '🔎 По этому запросу активные запчасти не найдены.');
    }
    updateBotSession(phone, {
      activeRepairId: ticket.id,
      lastPartSearch: matches.map(item => ({ id: item.id, name: item.name })),
    });
    return sendMessage(senderId, [
      '📦 Найденные запчасти:',
      ...matches.map((item, index) => `${index + 1}. ${item.name}${item.article ? ` · ${item.article}` : ''} · ${Number(item.defaultPrice || 0).toLocaleString('ru-RU')} ₽/${item.unit || 'шт'}`),
      '',
      'Добавить: /добавитьзапчасть НОМЕР КОЛИЧЕСТВО [ЦЕНА]',
      'Пример: /добавитьзапчасть 1 2 3500',
      'Если цену не указать, возьмётся базовая из справочника.',
    ].join('\n'));
  }

  if (lower.startsWith('/добавитьзапчасть ') && canManageRepair) {
    const ticket = getCurrentRepair(phone);
    if (!ticket) {
      return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
    }
    const [, indexRaw, qtyRaw, priceRaw] = parts;
    const index = Number(indexRaw);
    const quantity = Number(qtyRaw);
    const session = getBotSession(phone);
    const lastPartSearch = Array.isArray(session.lastPartSearch) ? session.lastPartSearch : [];
    if (!Number.isInteger(index) || index <= 0 || index > lastPartSearch.length) {
      return sendMessage(senderId, '❌ Номер запчасти указан неверно. Сначала выполните /запчасти поиск.');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return sendMessage(senderId, '❌ Количество запчасти должно быть числом больше 0.');
    }
    const selected = lastPartSearch[index - 1];
    const part = (readData('spare_parts') || []).find(item => item.id === selected.id && item.isActive !== false);
    if (!part) {
      return sendMessage(senderId, '❌ Запчасть больше недоступна в справочнике. Выполните поиск заново.');
    }
    const price = priceRaw == null ? Number(part.defaultPrice || 0) : Number(priceRaw);
    if (!Number.isFinite(price) || price < 0) {
      return sendMessage(senderId, '❌ Цена должна быть числом не меньше 0.');
    }
    addRepairPartItemFromCatalog(ticket, part, quantity, price);
    const updated = appendServiceLog(ticket, `Добавлена запчасть через MAX: ${part.name} × ${quantity}`, authUser.userName, 'repair_result');
    saveServiceTicket(updated);
    return sendMessage(senderId, `✅ Добавлена запчасть: ${part.name} × ${quantity} по ${price.toLocaleString('ru-RU')} ₽`);
  }

  if (lower === '/ожидание' && canManageRepair) {
    const ticket = getCurrentRepair(phone);
    if (!ticket) {
      return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
    }
    updateServiceTicketStatus(ticket, 'waiting_parts', authUser.userName, 'Заявка переведена в ожидание запчастей через MAX');
    return sendMessage(senderId, `🟠 ${ticket.id} переведена в статус «Ожидание запчастей»`);
  }

  if (lower === '/готово' && canManageRepair) {
    const ticket = getCurrentRepair(phone);
    if (!ticket) {
      return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
    }
    const updated = updateServiceTicketStatus(ticket, 'ready', authUser.userName, 'Работы завершены через MAX');
    return sendMessage(senderId, [
      `✅ Заявка ${updated.id} переведена в статус «Готово»`,
      'Если нужно, можно ещё закрыть её командой /закрыть',
      'Или посмотреть отчет: /черновик',
    ].join('\n'));
  }

  if (lower === '/закрыть' && canManageRepair) {
    const ticket = getCurrentRepair(phone);
    if (!ticket) {
      return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
    }
    const updated = updateServiceTicketStatus(ticket, 'closed', authUser.userName, 'Заявка закрыта через MAX');
    clearBotSession(phone);
    return sendMessage(senderId, `✅ Заявка ${updated.id} закрыта.`);
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
      if (update.update_type === 'bot_started') {
        const user = update.user;
        if (!user?.user_id) continue;
        console.log(`[BOT] [${user.name || user.user_id}] bot_started`);
        await handleBotStarted(user.user_id, user.user_id, update.payload);
        continue;
      }

      if (update.update_type !== 'message_created') continue;

      const msg = update.message;
      const sender = msg?.sender;
      if (!sender?.user_id) continue;

      const senderId = sender.user_id;
      const phone = sender.user_id;
      const text = msg?.body?.text || '';

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
    sessions: countActiveSessions(),
    storage: {
      driver: 'sqlite',
      path: DB_PATH,
      persistent: Boolean(process.env.DB_PATH),
    },
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

/** Загружает виды работ из seeds/service_works.json, если справочник пуст */
function seedServiceWorks() {
  try {
    const existing = readData('service_works') || [];
    if (existing.length > 0) return; // уже заполнен — не трогаем
    const seedPath = path.join(__dirname, 'seeds', 'service_works.json');
    if (!fs.existsSync(seedPath)) return;
    const works = JSON.parse(fs.readFileSync(seedPath, 'utf-8'));
    if (!Array.isArray(works) || works.length === 0) return;
    const normalized = works.map(w => normalizeServiceWorkRecord(w));
    writeData('service_works', normalized);
    console.log(`✓ Справочник работ загружен из seed: ${normalized.length} записей`);
  } catch (e) {
    console.warn('seedServiceWorks error:', e.message);
  }
}

app.listen(PORT, async () => {
  migrateJsonFilesToDb();
  cleanupExpiredSessions();
  seedDefaultUsers();
  ensureLegacyDefaultUsers();
  migrateReferenceCollections();
  migrateLegacyRepairFacts();
  seedServiceWorks();
  applyAdminResetFromEnv();

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
  if (process.env.DB_PATH) {
    console.log(`[DB] ✅  SQLite (persistent): ${DB_PATH}`);
  } else {
    console.log(`[DB] SQLite: ${DB_PATH}`);
    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════════╗');
    console.log('║  ⚠️  ВНИМАНИЕ: DB_PATH не задан!                                ║');
    console.log('║  База данных хранится внутри контейнера.                        ║');
    console.log('║  При каждом деплое на Railway ВСЕ данные (включая сессии)       ║');
    console.log('║  будут УНИЧТОЖЕНЫ — пользователи будут разлогинены.             ║');
    console.log('║                                                                  ║');
    console.log('║  Для постоянного хранения:                                      ║');
    console.log('║    1. Создайте Volume в Railway (Settings → Volumes)            ║');
    console.log('║    2. Mount path: /data                                         ║');
    console.log('║    3. Добавьте env: DB_PATH=/data/app.sqlite                    ║');
    console.log('╚══════════════════════════════════════════════════════════════════╝');
  }
  console.log('');

  if (!BOT_TOKEN) {
    console.log('⚠️  BOT_TOKEN не задан. Создайте файл .env:');
    console.log('   BOT_TOKEN=ваш_токен_от_MAX');
    console.log('');
  }

  await registerWebhook();
});
