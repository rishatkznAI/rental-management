import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { createServiceAuditLog } = require('../server/lib/service-audit-log.js');
const { normalizeRole } = require('../server/lib/role-groups.js');
const { registerAuthRoutes } = require('../server/routes/auth.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');
const { registerRentalChangeRequestRoutes } = require('../server/routes/rental-change-requests.js');
const { registerRentalRoutes } = require('../server/routes/rentals.js');
const { registerBotRoutes } = require('../server/routes/bot.js');
const { registerStaffRoutes } = require('../server/routes/staff.js');
const { registerManagerMyPlanRoutes } = require('../server/routes/manager-my-plan.js');

const WARRANTY_MECHANIC_ROLE = 'Механик по гарантии';
const WARRANTY_MECHANIC_ROLE_ALIASES = ['warranty_mechanic', 'mechanic_warranty', 'warrantyMechanic', 'mechanicWarranty', 'warranty-mechanic', 'mechanic-warranty', 'механик по гарантии'];
const WARRANTY_MECHANIC_ROLES = [WARRANTY_MECHANIC_ROLE, ...WARRANTY_MECHANIC_ROLE_ALIASES];
const MECHANIC_ROLES = ['Механик', 'Младший стационарный механик', 'Выездной механик', 'Старший стационарный механик'];

const READ_PERMISSIONS = {
  app_settings: ['Администратор'],
  clients: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  client_objects: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  client_contracts: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  documents: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  equipment: ['Администратор', 'Офис-менеджер', 'Менеджер по аренде', 'Менеджер по продажам', 'Инвестор', ...WARRANTY_MECHANIC_ROLES, ...MECHANIC_ROLES],
  equipment_downtimes: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  rentals: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', 'Инвестор', ...WARRANTY_MECHANIC_ROLES],
  gantt_rentals: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', 'Инвестор', ...WARRANTY_MECHANIC_ROLES],
  rental_change_requests: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  deliveries: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', 'Руководитель', 'Перевозчик'],
  payments: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  crm_deals: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  repair_work_items: ['Администратор', 'Офис-менеджер', ...WARRANTY_MECHANIC_ROLES, ...MECHANIC_ROLES],
  repair_part_items: ['Администратор', 'Офис-менеджер', ...WARRANTY_MECHANIC_ROLES, ...MECHANIC_ROLES],
  service: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', ...WARRANTY_MECHANIC_ROLES, ...MECHANIC_ROLES],
  service_works: ['Администратор', 'Офис-менеджер', ...WARRANTY_MECHANIC_ROLES, ...MECHANIC_ROLES],
  spare_parts: ['Администратор', 'Офис-менеджер', ...WARRANTY_MECHANIC_ROLES, ...MECHANIC_ROLES],
  warranty_claims: ['Администратор', 'Офис-менеджер', ...WARRANTY_MECHANIC_ROLES, ...MECHANIC_ROLES],
  service_vehicles: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', ...MECHANIC_ROLES],
  vehicle_trips: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', ...MECHANIC_ROLES],
  users: ['Администратор'],
};

const WRITE_PERMISSIONS = {
  app_settings: ['Администратор'],
  clients: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  client_objects: ['Администратор', 'Офис-менеджер'],
  client_contracts: ['Администратор', 'Офис-менеджер'],
  documents: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  equipment: ['Администратор', 'Офис-менеджер'],
  equipment_downtimes: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  payments: ['Администратор', 'Офис-менеджер'],
  crm_deals: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  repair_work_items: ['Администратор'],
  repair_part_items: ['Администратор'],
  service: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', ...WARRANTY_MECHANIC_ROLES, ...MECHANIC_ROLES],
  service_works: ['Администратор'],
  spare_parts: ['Администратор'],
  warranty_claims: ['Администратор', 'Офис-менеджер', ...WARRANTY_MECHANIC_ROLES, ...MECHANIC_ROLES],
  service_vehicles: ['Администратор', 'Офис-менеджер', ...MECHANIC_ROLES],
  vehicle_trips: ['Администратор', 'Офис-менеджер', ...MECHANIC_ROLES],
  users: ['Администратор'],
};

function createState() {
  return {
    users: [
      { id: 'U-admin', name: 'Админ', email: 'admin@example.test', role: 'Администратор', status: 'Активен', password: 'admin', tokenVersion: 0 },
      { id: 'U-admin-alias', name: 'Админ Alias', email: 'admin-alias@example.test', role: 'administrator', status: 'Активен', password: 'admin', tokenVersion: 0 },
      { id: 'U-manager', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен', password: 'old-password', tokenVersion: 0 },
      { id: 'U-manager-alias', name: 'Руслан Alias', email: 'manager-alias@example.test', role: 'rental_manager', status: 'Активен', password: 'manager', tokenVersion: 0 },
      { id: 'U-sales', name: 'Светлана', email: 'sales@example.test', role: 'Менеджер по продажам', status: 'Активен', password: 'sales', tokenVersion: 0 },
      { id: 'U-office', name: 'Офис', email: 'office@example.test', role: 'Офис-менеджер', status: 'Активен', password: 'office', tokenVersion: 0 },
      { id: 'U-office-alias', name: 'Офис Alias', email: 'office-alias@example.test', role: 'office_manager', status: 'Активен', password: 'office', tokenVersion: 0 },
      { id: 'U-mechanic', name: 'Петров', email: 'mechanic@example.test', role: 'Механик', status: 'Активен', password: 'mechanic', tokenVersion: 0 },
      { id: 'U-mechanic-alias', name: 'Петров Alias', email: 'mechanic-alias@example.test', role: 'mechanic', status: 'Активен', password: 'mechanic', tokenVersion: 0 },
      { id: 'U-warranty', name: 'Гарантия', email: 'warranty@example.test', role: WARRANTY_MECHANIC_ROLE, status: 'Активен', password: 'warranty', tokenVersion: 0 },
      { id: 'U-warranty-alias', name: 'Гарантия Alias', email: 'warranty-alias@example.test', role: 'mechanic_warranty', status: 'Активен', password: 'warranty', tokenVersion: 0 },
      { id: 'U-warranty-camel', name: 'Гарантия Camel', email: 'warranty-camel@example.test', role: 'mechanicWarranty', status: 'Активен', password: 'warranty', tokenVersion: 0 },
      { id: 'U-investor', name: 'Инвестор', email: 'investor@example.test', role: 'Инвестор', status: 'Активен', password: 'investor', tokenVersion: 0, ownerId: 'OW-1' },
    ],
    rentals: [
      { id: 'R-own', manager: 'Руслан', managerId: 'U-manager', client: 'ООО Свой', equipmentId: 'EQ-own', price: 100000, discount: 5000, rate: '5000/день', documents: ['D-1'] },
      { id: 'R-other', manager: 'Анна', managerId: 'U-other', client: 'ООО Чужой', equipmentId: 'EQ-other', price: 120000, discount: 0, rate: '6000/день', documents: ['D-2'] },
    ],
    gantt_rentals: [
      { id: 'GR-own', manager: 'Руслан', managerId: 'U-manager', client: 'ООО Свой', equipmentId: 'EQ-own', amount: 100000, paymentStatus: 'unpaid', debt: 100000, documents: ['D-1'] },
      { id: 'GR-other', manager: 'Анна', managerId: 'U-other', client: 'ООО Чужой', equipmentId: 'EQ-other', amount: 120000, paymentStatus: 'partial', debt: 60000, documents: ['D-2'] },
    ],
    equipment: [
      { id: 'EQ-own', inventoryNumber: '100', ownerId: 'OW-1', notes: 'own', salePrice1: 1000000, salePrice2: 1100000, salePrice3: 1200000, subleasePrice: 10000, plannedMonthlyRevenue: 300000 },
      { id: 'EQ-other', inventoryNumber: '200', ownerId: 'OW-2', notes: 'other', salePrice1: 2000000, salePrice2: 2100000, salePrice3: 2200000, subleasePrice: 20000, plannedMonthlyRevenue: 400000 },
    ],
    equipment_downtimes: [],
    mechanics: [{ id: 'M-1', name: 'Петров', userId: 'U-mechanic' }],
    service: [
      { id: 'S-own', assignedMechanicId: 'M-1', assignedMechanicName: 'Петров', status: 'new' },
      { id: 'S-other', assignedMechanicId: 'M-2', assignedMechanicName: 'Другой', status: 'new', resultData: { partsUsed: [{ name: 'Фильтр', qty: 1, cost: 5000 }] }, amount: 9000 },
    ],
    service_works: [{ id: 'SW-1', name: 'Диагностика', normHours: 1, ratePerHour: 2500, isActive: true }],
    spare_parts: [{ id: 'SP-1', name: 'Фильтр', unit: 'шт', defaultPrice: 5000, isActive: true }],
    warranty_claims: [{ id: 'WC-1', serviceTicketId: 'S-other', status: 'draft' }],
    repair_work_items: [{ id: 'RW-1', repairId: 'S-other', workId: 'SW-1', quantity: 1, ratePerHourSnapshot: 2500, normHoursSnapshot: 1 }],
    repair_part_items: [{ id: 'RP-1', repairId: 'S-other', partId: 'SP-1', quantity: 1, priceSnapshot: 5000 }],
    service_audit_log: [],
    service_vehicles: [{ id: 'SV-1', make: 'Lada', model: 'Largus', plateNumber: 'A001AA', status: 'active' }],
    vehicle_trips: [{ id: 'VT-1', vehicleId: 'SV-1', driver: 'Петров', route: 'Склад — объект', date: '2026-05-01' }],
    payments: [{ id: 'P-1', rentalId: 'R-own', amount: 1000, status: 'new' }],
    rental_change_requests: [],
    crm_deals: [{
      id: 'CRM-own',
      title: 'Продажа подъёмника',
      pipeline: 'sales',
      stage: 'lead',
      status: 'open',
      priority: 'medium',
      company: 'ООО Свой',
      manager: 'Светлана',
      managerId: 'U-sales',
      budget: 100000,
      probability: 25,
    }],
    clients: [],
    client_objects: [],
    client_contracts: [],
    documents: [],
    app_settings: [{ id: 'AS-1', key: 'secret', value: { enabled: true } }],
    unknown_collection: [{ id: 'X-1', value: 'hidden' }],
  };
}

function createSecurityApp(state = createState()) {
  const app = express();
  app.use(express.json());
  const sessions = new Map([
    ['admin-token', { userId: 'U-admin', tokenVersion: 0, passwordChangedAt: null }],
    ['admin-alias-token', { userId: 'U-admin-alias', tokenVersion: 0, passwordChangedAt: null }],
    ['manager-token', { userId: 'U-manager', tokenVersion: 0, passwordChangedAt: null }],
    ['manager-alias-token', { userId: 'U-manager-alias', tokenVersion: 0, passwordChangedAt: null }],
    ['sales-token', { userId: 'U-sales', tokenVersion: 0, passwordChangedAt: null }],
    ['office-token', { userId: 'U-office', tokenVersion: 0, passwordChangedAt: null }],
    ['office-alias-token', { userId: 'U-office-alias', tokenVersion: 0, passwordChangedAt: null }],
    ['mechanic-token', { userId: 'U-mechanic', tokenVersion: 0, passwordChangedAt: null }],
    ['mechanic-alias-token', { userId: 'U-mechanic-alias', tokenVersion: 0, passwordChangedAt: null }],
    ['warranty-token', { userId: 'U-warranty', tokenVersion: 0, passwordChangedAt: null }],
    ['warranty-alias-token', { userId: 'U-warranty-alias', tokenVersion: 0, passwordChangedAt: null }],
    ['warranty-camel-token', { userId: 'U-warranty-camel', tokenVersion: 0, passwordChangedAt: null }],
    ['investor-token', { userId: 'U-investor', tokenVersion: 0, passwordChangedAt: null }],
  ]);
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });
  const serviceAuditLog = createServiceAuditLog({
    readData,
    writeData,
    generateId: prefix => `${prefix}-${state.service_audit_log.length + 1}`,
    nowIso: () => '2026-04-28T12:00:00.000Z',
  });
  const auditEntries = [];

  function requireAuth(req, res, next) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const token = auth.slice(7);
    const session = sessions.get(token);
    if (!session) return res.status(401).json({ ok: false, error: 'Session expired or invalid' });
    const user = state.users.find(item => item.id === session.userId);
    if (!user || user.status !== 'Активен') return res.status(401).json({ ok: false, error: 'Session expired or invalid' });
    if ((Number(user.tokenVersion) || 0) !== (Number(session.tokenVersion) || 0)) return res.status(401).json({ ok: false, error: 'Session expired or invalid' });
    if ((user.passwordChangedAt || null) !== (session.passwordChangedAt || null)) return res.status(401).json({ ok: false, error: 'Session expired or invalid' });
    req.user = {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      email: user.email,
      ownerId: user.ownerId || null,
      tokenVersion: Number(user.tokenVersion) || 0,
      passwordChangedAt: user.passwordChangedAt || null,
    };
    return next();
  }

  function requireRead(collection) {
    return (req, res, next) => {
      const allowed = READ_PERMISSIONS[collection] || ['Администратор'];
      return allowed.includes(normalizeRole(req.user?.userRole)) ? next() : res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  function requireWrite(collection) {
    return (req, res, next) => {
      const allowed = WRITE_PERMISSIONS[collection] || ['Администратор'];
      return allowed.includes(normalizeRole(req.user?.userRole)) ? next() : res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  registerAuthRoutes(app, {
    readData,
    writeData,
    verifyPassword: (plain, stored) => plain === stored,
    hashPassword: plain => `hash:${plain}`,
    needsPasswordRehash: () => false,
    createSession: user => {
      const token = `token-${user.id}-${Date.now()}`;
      sessions.set(token, { userId: user.id, tokenVersion: Number(user.tokenVersion) || 0, passwordChangedAt: user.passwordChangedAt || null });
      return token;
    },
    requireAuth,
    destroySession: token => sessions.delete(token),
    deleteSessionsForUserIds: ids => {
      let count = 0;
      for (const [token, session] of sessions.entries()) {
        if (ids.includes(session.userId)) {
          sessions.delete(token);
          count += 1;
        }
      }
      return count;
    },
    auditLog: (_req, entry) => auditEntries.push(entry),
    getRoleAccessSummary: role => ({
      normalizedRole: normalizeRole(role),
      readableCollections: Object.entries(READ_PERMISSIONS)
        .filter(([, roles]) => roles.includes(normalizeRole(role)))
        .map(([collection]) => collection),
      writableCollections: Object.entries(WRITE_PERMISSIONS)
        .filter(([, roles]) => roles.includes(normalizeRole(role)))
        .map(([collection]) => collection),
    }),
    nowIso: () => '2026-04-28T12:00:00.000Z',
  });

  const apiRouter = express.Router();
  apiRouter.use(registerStaffRoutes({
    readData,
    requireAuth,
  }));
  apiRouter.use(registerManagerMyPlanRoutes({
    readData,
    writeData,
    requireAuth,
    getRoleAccessSummary: role => ({
      normalizedRole: normalizeRole(role),
      readableCollections: Object.entries(READ_PERMISSIONS)
        .filter(([, roles]) => roles.includes(normalizeRole(role)))
        .map(([collection]) => collection),
      writableCollections: Object.entries(WRITE_PERMISSIONS)
        .filter(([, roles]) => roles.includes(normalizeRole(role)))
        .map(([collection]) => collection),
    }),
    todayKey: '2026-05-23',
    nowIso: () => '2026-05-23T10:00:00.000Z',
    generateId: prefix => `${prefix}-new`,
  }));
  apiRouter.use(registerRentalRoutes({
    readData,
    writeData,
    requireAuth,
    requireRead,
    validateRentalPayload: () => ({ ok: true }),
    mergeRentalHistory: (_previous, next) => next,
    normalizeGanttRentalList: list => list,
    normalizeGanttRentalStatus: item => item,
    generateId: prefix => `${prefix}-new`,
    idPrefixes: { rentals: 'R', gantt_rentals: 'GR', rental_change_requests: 'RCR' },
    accessControl,
    auditLog: (_req, entry) => auditEntries.push(entry),
    serviceAuditLog,
  }));
  apiRouter.use(registerRentalChangeRequestRoutes({
    readData,
    writeData,
    requireAuth,
    requireRead,
    validateRentalPayload: () => ({ ok: true }),
    generateId: prefix => `${prefix}-new`,
    idPrefixes: { rental_change_requests: 'RCR' },
    accessControl,
  }));
  apiRouter.use(registerCrudRoutes({
    collections: [
	      'equipment',
	      'equipment_downtimes',
	      'service',
      'warranty_claims',
      'app_settings',
      'payments',
      'users',
      'repair_work_items',
      'repair_part_items',
      'service_works',
      'spare_parts',
      'clients',
      'client_objects',
      'client_contracts',
      'documents',
      'crm_deals',
      'service_vehicles',
      'vehicle_trips',
      'unknown_collection',
    ],
    idPrefixes: {
	      equipment: 'EQ',
	      equipment_downtimes: 'EDT',
	      service: 'S',
      warranty_claims: 'WC',
      payments: 'P',
      users: 'U',
      repair_work_items: 'RW',
      repair_part_items: 'RP',
      service_works: 'SW',
      spare_parts: 'SP',
      clients: 'C',
      client_objects: 'CO',
      client_contracts: 'CC',
      documents: 'D',
      crm_deals: 'CRM',
      service_vehicles: 'SV',
      vehicle_trips: 'VT',
    },
    readData,
    writeData,
    deleteSessionsForUserIds: ids => ids.length,
    requireAuth,
    requireRead,
    requireWrite,
    sanitizeUser: user => ({ id: user.id, name: user.name, role: user.role }),
    publicUserView: user => ({ id: user.id, name: user.name }),
    canReadFullUsers: req => req.user?.userRole === 'Администратор',
    hashPassword: plain => `hash:${plain}`,
    normalizeServiceWorkRecord: item => item,
    normalizeSparePartRecord: item => item,
    validateRentalPayload: () => ({ ok: true }),
    mergeEntityHistory: (_collection, _previous, next) => next,
    requireNonEmptyString: (value, label) => {
      if (!String(value || '').trim()) throw new Error(`${label} required`);
    },
    generateId: prefix => `${prefix}-new`,
    nowIso: () => '2026-04-28T12:00:00.000Z',
    applyServiceTicketCreationEffects: () => {},
    accessControl,
    auditLog: (_req, entry) => auditEntries.push(entry),
    serviceAuditLog,
  }));
  app.use('/api', apiRouter);
  registerBotRoutes(app, {
    webhookPath: '/bot/webhook',
    webhookSecret: 'webhook-secret',
    handleCommand: async () => {},
    handleBotStarted: async () => {},
    handleCallback: async () => {},
    logger: { log: () => {}, warn: message => auditEntries.push({ action: 'log.warn', message }), error: () => {} },
  });

  return { app, state, auditEntries };
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, method, path, token, body, headers = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  let parsed = null;
  if (text) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = text;
    }
  }
  return {
    status: response.status,
    body: parsed,
  };
}

function assertNoCommercialFields(value) {
  const forbidden = new Set([
    'amount',
    'commercialTerms',
    'cost',
    'debt',
    'defaultPrice',
    'documents',
    'financialImpact',
    'invoiceNumber',
    'margin',
    'paidAmount',
    'paymentStatus',
    'plannedMonthlyRevenue',
    'price',
    'priceSnapshot',
    'profit',
    'rate',
    'ratePerHour',
    'ratePerHourSnapshot',
    'revenue',
    'salePrice1',
    'salePrice2',
    'salePrice3',
    'subleasePrice',
    'totalAmount',
  ]);

  function walk(node, path = '$') {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, `${path}[${index}]`));
      return;
    }
    for (const [key, child] of Object.entries(node)) {
      assert.equal(forbidden.has(key), false, `forbidden commercial field ${path}.${key}`);
      walk(child, `${path}.${key}`);
    }
  }

  walk(value);
}

function clientPayload(overrides = {}) {
  return {
    company: 'ООО Новый клиент',
    inn: '1655123456',
    contact: 'Иван',
    phone: '+79991234567',
    email: 'client@example.test',
    paymentTerms: 'Постоплата 14 дней',
    ...overrides,
  };
}

test('generic CRUD refuses to register without access-control', () => {
  assert.throws(() => registerCrudRoutes({
    collections: [],
    idPrefixes: {},
    readData: () => [],
    writeData: () => {},
    requireAuth: (_req, _res, next) => next(),
    requireRead: () => (_req, _res, next) => next(),
    requireWrite: () => (_req, _res, next) => next(),
  }), /requires access-control/);
});

test('/api/clients creates clients with normalized INN and rejects duplicate INN', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/clients', 'admin-token', clientPayload({
      company: 'ООО Альфа',
      inn: '1655 123456',
    }));
    assert.equal(created.status, 201);
    assert.equal(created.body.innNormalized, '1655123456');

    const duplicate = await request(baseUrl, 'POST', '/api/clients', 'admin-token', clientPayload({
      company: 'ООО Бета',
      inn: '1655-123456',
      email: 'beta@example.test',
    }));
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, 'Клиент с таким ИНН уже существует');
    assert.equal(duplicate.body.code, 'CLIENT_INN_DUPLICATE');
    assert.equal(duplicate.body.conflictClient.id, created.body.id);
  });

  assert.equal(state.clients.length, 1);
});

test('/api/clients allows editing own INN and rejects changing to another client INN', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-1', company: 'ООО Альфа', inn: '1655123456', email: 'alpha@example.test' }),
    clientPayload({ id: 'C-2', company: 'ООО Бета', inn: '7700 654321', email: 'beta@example.test' }),
  ];

  await withServer(app, async (baseUrl) => {
    const ownInn = await request(baseUrl, 'PATCH', '/api/clients/C-1', 'admin-token', {
      company: 'ООО Альфа плюс',
      inn: '1655-123456',
    });
    assert.equal(ownInn.status, 200);
    assert.equal(ownInn.body.innNormalized, '1655123456');

    const duplicate = await request(baseUrl, 'PATCH', '/api/clients/C-1', 'admin-token', {
      inn: '7700654321',
    });
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.error, 'Клиент с таким ИНН уже существует');
    assert.equal(duplicate.body.conflictClient.id, 'C-2');
  });
});

test('/api/clients allows office manager to save client rail contacts and partner card fields', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({
      id: 'C-1',
      company: 'ООО Альфа',
      inn: '1655123456',
      email: 'alpha@example.test',
      debt: 0,
      contacts: [{ id: 'old', name: 'Иван', phone: '+7900' }],
    }),
  ];

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'PATCH', '/api/clients/C-1', 'office-token', {
      contacts: [
        { id: 'old', name: 'Иван', phone: '+7900' },
        { id: 'new', name: 'Мария', role: 'Бухгалтер', phone: '+7901', email: 'maria@example.test', comment: 'Счета' },
      ],
      partnerCardFileName: 'Карта партнёра.pdf',
      partnerCardMimeType: 'application/pdf',
      partnerCardDataUrl: 'data:application/pdf;base64,JVBERi0x',
      partnerCardUploadedAt: '2026-05-10T09:00:00.000Z',
      partnerCardUploadedBy: 'Офис',
      debt: 999999,
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.contacts.length, 2);
    assert.equal(response.body.contacts[1].name, 'Мария');
    assert.equal(response.body.partnerCardFileName, 'Карта партнёра.pdf');
    assert.equal(response.body.debt, 0);
  });
});

test('/api/clients rejects unknown top-level fields on create without leaking nested client data', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/clients', 'admin-token', clientPayload({
      company: 'ООО Легальный клиент',
      inn: '1655123456',
      contacts: [{ id: 'primary', name: 'Иван', phone: '+7900' }],
      bankName: 'АО Тест Банк',
      bankBik: '044525225',
      bankAccount: '40702810900000000001',
      corrAccount: '30101810400000000225',
    }));
    assert.equal(created.status, 201);
    assert.equal(created.body.contacts[0].name, 'Иван');
    assert.equal(created.body.bankName, 'АО Тест Банк');

    const rejected = await request(baseUrl, 'POST', '/api/clients', 'admin-token', clientPayload({
      company: 'ООО Поле Атаки',
      inn: '7700654321',
      metadata: {
        bankAccount: '40702810999999999999',
        secret: 'nested-client-secret',
      },
    }));
    assert.equal(rejected.status, 403);
    assert.match(rejected.body.error, /metadata/);
    assert.doesNotMatch(rejected.body.error, /nested-client-secret/);
    assert.doesNotMatch(rejected.body.error, /40702810999999999999/);
  });

  assert.equal(state.clients.length, 1);
  assert.equal(state.clients.some(client => Object.prototype.hasOwnProperty.call(client, 'metadata')), false);
});

test('/api/clients rejects unknown top-level fields on patch without mutating existing client', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({
      id: 'C-1',
      company: 'ООО Альфа',
      inn: '1655123456',
      email: 'alpha@example.test',
      contacts: [],
      bankName: 'АО Старый Банк',
    }),
  ];

  await withServer(app, async (baseUrl) => {
    const allowed = await request(baseUrl, 'PATCH', '/api/clients/C-1', 'admin-token', {
      contacts: [{ id: 'bookkeeper', name: 'Мария', role: 'Бухгалтер', phone: '+7901' }],
      bankName: 'АО Новый Банк',
      bankBik: '044525225',
    });
    assert.equal(allowed.status, 200);
    assert.equal(allowed.body.contacts[0].name, 'Мария');
    assert.equal(allowed.body.bankName, 'АО Новый Банк');

    const rejected = await request(baseUrl, 'PATCH', '/api/clients/C-1', 'admin-token', {
      notes: 'Это легальное поле',
      requisites: {
        inn: '1655123456',
        bankAccount: '40702810999999999999',
        secret: 'nested-requisites-secret',
      },
    });
    assert.equal(rejected.status, 403);
    assert.match(rejected.body.error, /requisites/);
    assert.doesNotMatch(rejected.body.error, /nested-requisites-secret/);
    assert.doesNotMatch(rejected.body.error, /40702810999999999999/);
  });

  assert.equal(state.clients[0].notes, undefined);
  assert.equal(state.clients[0].requisites, undefined);
  assert.equal(state.clients[0].bankName, 'АО Новый Банк');
});

test('/api/clients rejects derived financial fields on ordinary writes', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({
      id: 'C-1',
      company: 'ООО Альфа',
      inn: '1655123456',
      email: 'alpha@example.test',
      debt: 0,
      totalRentals: 2,
      lastRentalDate: '2026-05-01',
    }),
  ];

  await withServer(app, async (baseUrl) => {
    const createWithLegacySummary = await request(baseUrl, 'POST', '/api/clients', 'admin-token', clientPayload({
      company: 'ООО Legacy Summary',
      inn: '7700654321',
      totalRentals: 999,
      lastRentalDate: '2099-01-01',
    }));
    assert.equal(createWithLegacySummary.status, 201);
    assert.equal(Object.prototype.hasOwnProperty.call(createWithLegacySummary.body, 'totalRentals'), false);
    assert.equal(Object.prototype.hasOwnProperty.call(createWithLegacySummary.body, 'lastRentalDate'), false);

    const createRejected = await request(baseUrl, 'POST', '/api/clients', 'admin-token', clientPayload({
      company: 'ООО Производное Поле',
      inn: '7800654321',
      currentDebt: 500000,
    }));
    assert.equal(createRejected.status, 403);
    assert.match(createRejected.body.error, /currentDebt/);

    const patchPreserved = await request(baseUrl, 'PATCH', '/api/clients/C-1', 'admin-token', {
      totalRentals: 999,
      lastRentalDate: '2099-01-01',
    });
    assert.equal(patchPreserved.status, 200);
    assert.equal(patchPreserved.body.totalRentals, 2);
    assert.equal(patchPreserved.body.lastRentalDate, '2026-05-01');
  });

  assert.equal(state.clients.length, 2);
  assert.equal(Object.prototype.hasOwnProperty.call(state.clients[1], 'totalRentals'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(state.clients[1], 'lastRentalDate'), false);
  assert.equal(state.clients[0].totalRentals, 2);
  assert.equal(state.clients[0].lastRentalDate, '2026-05-01');
});

test('/api/clients rejects audit timestamp spoofing on patch but allows legacy timestamps in bulk replace', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({
      id: 'C-1',
      company: 'ООО Аудит',
      inn: '1655123456',
      email: 'audit@example.test',
      createdAt: '2026-05-01T00:00:00.000Z',
      updatedAt: '2026-05-02T00:00:00.000Z',
    }),
  ];

  await withServer(app, async (baseUrl) => {
    const patchRejected = await request(baseUrl, 'PATCH', '/api/clients/C-1', 'admin-token', {
      createdAt: '2000-01-01T00:00:00.000Z',
    });
    assert.equal(patchRejected.status, 403);
    assert.match(patchRejected.body.error, /createdAt/);

    const bulkAllowed = await request(baseUrl, 'PUT', '/api/clients', 'admin-token', [
      clientPayload({
        id: 'C-1',
        company: 'ООО Аудит Импорт',
        inn: '1655123456',
        email: 'audit@example.test',
        createdAt: '2020-01-01T00:00:00.000Z',
        updatedAt: '2020-01-02T00:00:00.000Z',
        totalRentals: 7,
        lastRentalDate: '2020-01-10',
      }),
    ]);
    assert.equal(bulkAllowed.status, 200);
  });

  assert.equal(state.clients.length, 1);
  assert.equal(state.clients[0].createdAt, '2020-01-01T00:00:00.000Z');
  assert.equal(state.clients[0].updatedAt, '2020-01-02T00:00:00.000Z');
  assert.equal(state.clients[0].totalRentals, 7);
  assert.equal(state.clients[0].lastRentalDate, '2020-01-10');
});

test('/api/clients bulk replace rejects unknown top-level fields without corrupting existing data', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({
      id: 'C-1',
      company: 'ООО Альфа',
      inn: '1655123456',
      email: 'alpha@example.test',
      contacts: [{ id: 'primary', name: 'Иван' }],
      createdAt: '2026-05-01T00:00:00.000Z',
    }),
  ];

  await withServer(app, async (baseUrl) => {
    const allowed = await request(baseUrl, 'PUT', '/api/clients', 'admin-token', [
      clientPayload({
        id: 'C-1',
        company: 'ООО Альфа Обновлено',
        inn: '1655123456',
        email: 'alpha@example.test',
        contacts: [{ id: 'primary', name: 'Иван' }],
        legalAddress: 'Москва, ул. Тестовая, 1',
        bankName: 'АО Тест Банк',
        createdAt: '2026-05-01T00:00:00.000Z',
        updatedAt: '2026-05-24T00:00:00.000Z',
      }),
    ]);
    assert.equal(allowed.status, 200);
    assert.equal(state.clients[0].company, 'ООО Альфа Обновлено');
    assert.equal(state.clients[0].legalAddress, 'Москва, ул. Тестовая, 1');

    const rejected = await request(baseUrl, 'PUT', '/api/clients', 'admin-token', [
      clientPayload({
        id: 'C-1',
        company: 'ООО Должно Не Сохраниться',
        inn: '1655123456',
        email: 'alpha@example.test',
        metadata: { secret: 'bulk-nested-secret' },
      }),
    ]);
    assert.equal(rejected.status, 403);
    assert.match(rejected.body.error, /metadata/);
    assert.doesNotMatch(rejected.body.error, /bulk-nested-secret/);
  });

  assert.equal(state.clients.length, 1);
  assert.equal(state.clients[0].company, 'ООО Альфа Обновлено');
  assert.equal(state.clients[0].metadata, undefined);
});

test('/api/clients rejects clearing INN on save', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-1', company: 'ООО Альфа', inn: '1655123456', email: 'alpha@example.test' }),
    clientPayload({ id: 'C-2', company: 'ООО Бета', inn: '7700654321', email: 'beta@example.test' }),
  ];

  await withServer(app, async (baseUrl) => {
    const cleared = await request(baseUrl, 'PATCH', '/api/clients/C-1', 'admin-token', { inn: '' });
    assert.equal(cleared.status, 400);
    assert.match(cleared.body.error, /Укажите корректный ИНН/);

    const reused = await request(baseUrl, 'PATCH', '/api/clients/C-2', 'admin-token', { inn: '1655-123456' });
    assert.equal(reused.status, 409);
    assert.equal(reused.body.error, 'Клиент с таким ИНН уже существует');
  });
});

test('/api/clients rejects empty INN for new clients', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const first = await request(baseUrl, 'POST', '/api/clients', 'admin-token', clientPayload({
      company: 'ООО Без ИНН 1',
      inn: '',
      email: 'empty1@example.test',
    }));
    const second = await request(baseUrl, 'POST', '/api/clients', 'admin-token', clientPayload({
      company: 'ООО Без ИНН 2',
      inn: null,
      email: 'empty2@example.test',
    }));
    assert.equal(first.status, 400);
    assert.match(first.body.error, /Укажите корректный ИНН/);
    assert.equal(second.status, 400);
    assert.match(second.body.error, /Укажите корректный ИНН/);
  });

  assert.equal(state.clients.length, 0);
});

test('/api/clients delete removes client from uniqueness checks', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-1', company: 'ООО Альфа', inn: '1655123456', email: 'alpha@example.test' }),
  ];

  await withServer(app, async (baseUrl) => {
    const deleted = await request(baseUrl, 'DELETE', '/api/clients/C-1', 'admin-token');
    assert.equal(deleted.status, 200);

    const created = await request(baseUrl, 'POST', '/api/clients', 'admin-token', clientPayload({
      company: 'ООО Новый владелец ИНН',
      inn: '1655-123456',
      email: 'reuse@example.test',
    }));
    assert.equal(created.status, 201);
    assert.equal(created.body.innNormalized, '1655123456');
  });

  assert.equal(state.clients.length, 1);
  assert.equal(state.clients[0].company, 'ООО Новый владелец ИНН');
});

test('/api/clients delete returns 404 for missing client', async () => {
  const { app } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const deleted = await request(baseUrl, 'DELETE', '/api/clients/C-missing', 'admin-token');
    assert.equal(deleted.status, 404);
    assert.equal(deleted.body.error, 'Not found');
  });
});

test('/api/clients delete rejects clients linked to rentals by clientId', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-1', company: 'ООО Альфа', inn: '1655123456', email: 'alpha@example.test' }),
  ];
  state.rentals = [
    { id: 'R-1', rentalId: 'A-100', clientId: 'C-1', equipmentId: 'EQ-own', startDate: '2026-05-01', plannedReturnDate: '2026-05-10', status: 'active' },
  ];
  state.gantt_rentals = [];

  await withServer(app, async (baseUrl) => {
    const deleted = await request(baseUrl, 'DELETE', '/api/clients/C-1', 'admin-token');
    assert.equal(deleted.status, 409);
    assert.equal(deleted.body.error, 'CLIENT_HAS_RENTALS');
    assert.equal(deleted.body.message, 'Нельзя удалить клиента, потому что у него есть связанные аренды');
    assert.deepEqual(deleted.body.rentals, [{
      id: 'R-1',
      rentalId: 'A-100',
      equipmentId: 'EQ-own',
      equipmentInv: '100',
      startDate: '2026-05-01',
      endDate: '2026-05-10',
      status: 'active',
    }]);
  });

  assert.equal(state.clients.length, 1);
});

test('/api/clients delete rejects legacy rentals linked by client name without clientId', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-1', company: 'ООО Альфа', inn: '1655123456', email: 'alpha@example.test' }),
  ];
  state.rentals = [];
  state.gantt_rentals = [
    { id: 'GR-1', client: ' ООО Альфа ', equipmentInv: '700', startDate: '2026-05-02', endDate: '2026-05-12', status: 'confirmed' },
  ];

  await withServer(app, async (baseUrl) => {
    const deleted = await request(baseUrl, 'DELETE', '/api/clients/C-1', 'admin-token');
    assert.equal(deleted.status, 409);
    assert.equal(deleted.body.error, 'CLIENT_HAS_RENTALS');
    assert.equal(deleted.body.rentals[0].id, 'GR-1');
    assert.equal(deleted.body.rentals[0].equipmentInv, '700');
  });

  assert.equal(state.clients.length, 1);
});

test('/api/clients delete rejects clients with historical non-rental links', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-1', company: 'ООО История', inn: '1655123456', email: 'history@example.test' }),
  ];
  state.rentals = [];
  state.gantt_rentals = [];
  state.documents = [{ id: 'D-1', clientId: 'C-1', client: 'Старый снимок', rental: 'R-archived' }];
  state.payments = [{ id: 'P-1', clientId: 'C-1', client: 'ООО История', amount: 1000 }];
  state.deliveries = [{ id: 'DL-1', client: ' ООО История ' }];

  await withServer(app, async (baseUrl) => {
    const deleted = await request(baseUrl, 'DELETE', '/api/clients/C-1', 'admin-token');
    assert.equal(deleted.status, 409);
    assert.equal(deleted.body.error, 'CLIENT_HAS_HISTORY');
    assert.equal(deleted.body.links.find(item => item.collection === 'documents').count, 1);
    assert.equal(deleted.body.links.find(item => item.collection === 'payments').count, 1);
    assert.equal(deleted.body.links.find(item => item.collection === 'deliveries').count, 1);
    assert.equal(JSON.stringify(deleted.body).includes('Старый снимок'), false);
  });

  assert.equal(state.clients.length, 1);
});

test('/api/clients delete is limited to admin or client-management role', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-1', company: 'ООО Без истории', inn: '1655123456', email: 'alpha@example.test', manager: 'Руслан', managerId: 'U-manager' }),
  ];
  state.rentals = [];
  state.gantt_rentals = [];

  await withServer(app, async (baseUrl) => {
    const managerDelete = await request(baseUrl, 'DELETE', '/api/clients/C-1', 'manager-token');
    assert.equal(managerDelete.status, 403);
    assert.equal(managerDelete.body.error, 'Удаление клиентов доступно только администратору или офис-менеджеру.');

    const officeDelete = await request(baseUrl, 'DELETE', '/api/clients/C-1', 'office-token');
    assert.equal(officeDelete.status, 200);
  });

  assert.equal(state.clients.length, 0);
});

test('/api/rentals lets admin replace rental client and then old client can be deleted', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-old', company: 'ООО Старый клиент', inn: '1655123456', email: 'old@example.test' }),
    clientPayload({ id: 'C-new', company: 'ООО Новый клиент', inn: '7700654321', email: 'new@example.test' }),
  ];
  state.rentals = [
    {
      id: 'R-1',
      clientId: 'C-old',
      client: 'ООО Старый клиент',
      contact: 'Иван',
      startDate: '2026-05-01',
      plannedReturnDate: '2026-05-10',
      equipment: ['100'],
      manager: 'Админ',
      status: 'active',
      price: 1000,
      discount: 0,
      history: [],
    },
  ];
  state.gantt_rentals = [
    {
      id: 'GR-1',
      rentalId: 'R-1',
      clientId: 'C-old',
      client: 'ООО Старый клиент',
      startDate: '2026-05-01',
      endDate: '2026-05-10',
      equipmentId: 'EQ-own',
      equipmentInv: '100',
      status: 'active',
      amount: 1000,
      comments: [],
    },
  ];

  await withServer(app, async (baseUrl) => {
    const blocked = await request(baseUrl, 'DELETE', '/api/clients/C-old', 'admin-token');
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error, 'CLIENT_HAS_RENTALS');

    const update = await request(baseUrl, 'PATCH', '/api/rentals/R-1', 'admin-token', {
      clientId: 'C-new',
      client: 'ООО Новый клиент',
      rentalId: 'R-1',
      __linkedGanttRentalId: 'GR-1',
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.clientId, 'C-new');
    assert.equal(update.body.client, 'ООО Новый клиент');
    assert.equal(state.rentals[0].clientId, 'C-new');
    assert.equal(state.rentals[0].client, 'ООО Новый клиент');
    assert.equal(state.gantt_rentals[0].clientId, 'C-new');
    assert.equal(state.gantt_rentals[0].client, 'ООО Новый клиент');
    assert.equal(state.gantt_rentals[0].clientShort, 'ООО Новый клиент');

    const deleted = await request(baseUrl, 'DELETE', '/api/clients/C-old', 'admin-token');
    assert.equal(deleted.status, 200);
  });

  assert.deepEqual(state.clients.map(client => client.id), ['C-new']);
});

test('/api/rentals sends manager client replacement to approval without mutating rental', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-old', company: 'ООО Свой', inn: '1655123456', email: 'old@example.test' }),
    clientPayload({ id: 'C-new', company: 'ООО Новый клиент', inn: '7700654321', email: 'new@example.test' }),
  ];
  state.rentals = [
    {
      id: 'R-own',
      clientId: 'C-old',
      client: 'ООО Свой',
      contact: 'Иван',
      startDate: '2026-05-01',
      plannedReturnDate: '2026-05-10',
      equipment: ['100'],
      manager: 'Руслан',
      managerId: 'U-manager',
      status: 'active',
      price: 1000,
      discount: 0,
      history: [],
    },
  ];
  state.gantt_rentals = [
    {
      id: 'GR-own',
      rentalId: 'R-own',
      clientId: 'C-old',
      client: 'ООО Свой',
      startDate: '2026-05-01',
      endDate: '2026-05-10',
      equipmentId: 'EQ-own',
      equipmentInv: '100',
      manager: 'Руслан',
      managerId: 'U-manager',
      status: 'active',
      amount: 1000,
      comments: [],
    },
  ];

  await withServer(app, async (baseUrl) => {
    const update = await request(baseUrl, 'PATCH', '/api/rentals/R-own', 'manager-token', {
      clientId: 'C-new',
      client: 'ООО Новый клиент',
      rentalId: 'R-own',
      __linkedGanttRentalId: 'GR-own',
      __changeReason: 'Нужно заменить клиента',
    });
    assert.equal(update.status, 200);
    assert.equal(update.body.changeRequestSummary.pendingCount, 2);
    assert.deepEqual(update.body.changeRequestSummary.appliedFields, []);
  });

  assert.equal(state.rentals[0].clientId, 'C-old');
  assert.equal(state.rentals[0].client, 'ООО Свой');
  assert.equal(state.gantt_rentals[0].clientId, 'C-old');
  assert.equal(state.rental_change_requests.length, 2);
  assert.deepEqual(state.rental_change_requests.map(item => item.field).sort(), ['client', 'clientId']);
});

test('/api/clients allows unrelated writes while legacy duplicate INNs remain but blocks adding to duplicate group', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-1', company: 'ООО Старый дубль 1', inn: '1655 123456', email: 'dup1@example.test' }),
    clientPayload({ id: 'C-2', company: 'ООО Старый дубль 2', inn: '1655123456', email: 'dup2@example.test' }),
  ];

  await withServer(app, async (baseUrl) => {
    const unrelated = await request(baseUrl, 'POST', '/api/clients', 'admin-token', clientPayload({
      company: 'ООО Уникальный',
      inn: '7700654321',
      email: 'unique@example.test',
    }));
    assert.equal(unrelated.status, 201);

    const duplicate = await request(baseUrl, 'POST', '/api/clients', 'admin-token', clientPayload({
      company: 'ООО Новый дубль',
      inn: '1655-123456',
      email: 'new-dup@example.test',
    }));
    assert.equal(duplicate.status, 409);
    assert.equal(duplicate.body.code, 'CLIENT_INN_DUPLICATE');
  });

  assert.equal(state.clients.length, 3);
});

test('/api/clients duplicate INN diagnostics reports existing duplicate groups', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-1', company: 'ООО Альфа', inn: '1655 123456', email: 'alpha@example.test' }),
    clientPayload({ id: 'C-2', company: 'ООО Бета', inn: '1655123456', email: 'beta@example.test' }),
    clientPayload({ id: 'C-3', company: 'ООО Без ИНН', inn: '', email: 'empty@example.test' }),
  ];

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'GET', '/api/clients/diagnostics/duplicate-inn', 'admin-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.duplicates.length, 1);
    assert.equal(response.body.duplicates[0].innNormalized, '1655123456');
    assert.deepEqual(response.body.duplicates[0].clients.map(client => client.id), ['C-1', 'C-2']);
    assert.deepEqual(Object.keys(response.body.duplicates[0].clients[0]).sort(), ['company', 'id', 'inn', 'innNormalized']);
  });
});

test('/api/clients duplicate INN diagnostics follows clients read permissions', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [
    clientPayload({ id: 'C-1', company: 'ООО Альфа', inn: '1655 123456', email: 'alpha@example.test' }),
    clientPayload({ id: 'C-2', company: 'ООО Бета', inn: '1655123456', email: 'beta@example.test' }),
  ];

  await withServer(app, async (baseUrl) => {
    const allowed = await request(baseUrl, 'GET', '/api/clients/diagnostics/duplicate-inn', 'manager-token');
    assert.equal(allowed.status, 200);

    const forbidden = await request(baseUrl, 'GET', '/api/clients/diagnostics/duplicate-inn', 'investor-token');
    assert.equal(forbidden.status, 403);
  });
});

test('/api/service returns 200 for service roles and 403 for forbidden roles', async () => {
  const { app } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    for (const token of [
      'admin-token',
      'admin-alias-token',
      'office-token',
      'office-alias-token',
      'manager-token',
      'manager-alias-token',
      'mechanic-token',
      'mechanic-alias-token',
      'warranty-token',
      'warranty-alias-token',
      'warranty-camel-token',
    ]) {
      const response = await request(baseUrl, 'GET', '/api/service', token);
      assert.equal(response.status, 200, token);
      assert.equal(Array.isArray(response.body), true, token);
    }

    assert.equal((await request(baseUrl, 'GET', '/api/service', 'investor-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/service', null)).status, 401);
  });
});

test('/api/service/repeat-breakdowns is authenticated read-only analytics with scoped output', async () => {
  const { app, state } = createSecurityApp();
  state.equipment.push({ id: 'EQ-repeat', manufacturer: 'Genie', model: 'Z-45', inventoryNumber: 'STG-REPEAT-API', status: 'in_service' });
  state.service.push(
    {
      id: 'S-repeat-prev',
      equipmentId: 'EQ-repeat',
      equipment: 'Genie Z-45',
      inventoryNumber: 'STG-REPEAT-API',
      status: 'closed',
      serviceKind: 'repair',
      reason: 'Течь гидравлики',
      assignedMechanicId: 'M-1',
      assignedMechanicName: 'Петров',
      createdAt: '2026-05-01T08:00:00.000Z',
      closedAt: '2026-05-02T08:00:00.000Z',
      password: 'must-not-leak',
      token: 'must-not-leak',
    },
    {
      id: 'S-repeat-next',
      equipmentId: 'EQ-repeat',
      equipment: 'Genie Z-45',
      inventoryNumber: 'STG-REPEAT-API',
      status: 'in_progress',
      priority: 'high',
      serviceKind: 'repair',
      reason: 'Течь гидравлики',
      assignedMechanicId: 'M-1',
      assignedMechanicName: 'Петров',
      createdAt: '2026-05-05T08:00:00.000Z',
      secret: 'must-not-leak',
    },
  );
  state.repair_work_items.push(
    { id: 'RW-repeat-prev', repairId: 'S-repeat-prev', workId: 'SW-1', nameSnapshot: 'Диагностика гидравлики' },
    { id: 'RW-repeat-next', repairId: 'S-repeat-next', workId: 'SW-1', nameSnapshot: 'Диагностика гидравлики' },
  );

  await withServer(app, async (baseUrl) => {
    assert.equal((await request(baseUrl, 'GET', '/api/service/repeat-breakdowns', null)).status, 401);
    assert.equal((await request(baseUrl, 'GET', '/api/service/repeat-breakdowns', 'investor-token')).status, 403);

    const admin = await request(baseUrl, 'GET', '/api/service/repeat-breakdowns', 'admin-token');
    assert.equal(admin.status, 200);
    assert.equal(admin.body.ok, true);
    assert.equal(admin.body.summary.repeatWithin7, 1);
    assert.equal(admin.body.items[0].equipmentId, 'EQ-repeat');
    assert.deepEqual(Object.keys(admin.body.groups).sort(), ['byEquipment', 'byMechanic', 'byModel', 'byScenario'].sort());
    const serialized = JSON.stringify(admin.body);
    assert.equal(serialized.includes('must-not-leak'), false);
    assert.equal(serialized.includes('[object Object]'), false);
    assert.equal(serialized.includes('undefined'), false);

    const mechanic = await request(baseUrl, 'GET', '/api/service/repeat-breakdowns', 'mechanic-token');
    assert.equal(mechanic.status, 200);
    assert.equal(mechanic.body.items.some(item => item.equipmentId === 'EQ-repeat'), true);

    const quality = await request(baseUrl, 'GET', '/api/service/repeat-breakdowns?view=quality', 'admin-token');
    assert.equal(quality.status, 200);
    assert.equal(quality.body.ok, true);
    assert.equal(quality.body.summary.totalRepeatCases, 1);
    assert.equal(quality.body.equipment[0].qualityRisk, 'critical');
    assert.equal(quality.body.mechanics[0].mechanicName, 'Петров');
    assert.equal(quality.body.scenarios[0].scenario, 'Ремонт');
    const qualitySerialized = JSON.stringify(quality.body);
    assert.equal(/must-not-leak|password|token|secret|email|\[object Object\]|undefined|null/i.test(qualitySerialized), false);
  });
});

test('/api/documents remains readable for roles with Documents section access', async () => {
  const { app } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    for (const token of ['admin-token', 'office-token', 'manager-token', 'sales-token']) {
      const response = await request(baseUrl, 'GET', '/api/documents', token);
      assert.equal(response.status, 200, token);
      assert.equal(Array.isArray(response.body), true, token);
    }

    assert.equal((await request(baseUrl, 'GET', '/api/documents', 'mechanic-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/documents', null)).status, 401);
  });
});

test('/api/documents preserves stable rental, equipment and client links', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [{ id: 'C-1', company: 'ООО Свой' }];

  await withServer(app, async (baseUrl) => {
    const create = await request(baseUrl, 'POST', '/api/documents', 'admin-token', {
      type: 'contract',
      contractKind: 'rental',
      number: 'DOC-LINK-1',
      clientId: 'C-1',
      client: 'ООО Свой',
      rentalId: 'R-own',
      rental: 'R-own',
      equipmentId: 'EQ-own',
      equipmentInv: '100',
      equipment: '100',
      date: '2026-05-02',
      status: 'sent',
      manager: 'Руслан',
    });

    assert.equal(create.status, 201);
    assert.equal(create.body.clientId, 'C-1');
    assert.equal(create.body.rentalId, 'R-own');
    assert.equal(create.body.rental, 'R-own');
    assert.equal(create.body.equipmentId, 'EQ-own');
    assert.equal(create.body.equipmentInv, '100');
    assert.equal(create.body.status, 'sent');

    const stored = state.documents.find(item => item.id === create.body.id);
    assert.equal(stored.clientId, 'C-1');
    assert.equal(stored.rentalId, 'R-own');
    assert.equal(stored.equipmentId, 'EQ-own');

    const list = await request(baseUrl, 'GET', '/api/documents', 'office-token');
    assert.equal(list.status, 200);
    assert.equal(list.body.some(item => item.rentalId === 'R-own' && item.equipmentId === 'EQ-own'), true);
  });
});

test('equipment downtime CRUD supports rental roles and rejects unrelated roles', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/equipment_downtimes', 'manager-token', {
      equipmentId: 'EQ-own',
      equipmentInv: '100',
      startDate: '2026-05-01',
      endDate: '2026-05-03',
      reason: 'Нет спроса',
      comment: 'Окно согласовано',
    });

    assert.equal(created.status, 201);
    assert.equal(created.body.status, 'active');
    assert.equal(created.body.equipmentId, 'EQ-own');
    assert.equal(created.body.reason, 'Нет спроса');

    const updated = await request(baseUrl, 'PATCH', `/api/equipment_downtimes/${created.body.id}`, 'office-token', {
      endDate: '2026-05-04',
      reason: 'Ожидание клиента',
      comment: 'Перенесли выезд',
    });
    assert.equal(updated.status, 200);
    assert.equal(updated.body.endDate, '2026-05-04');
    assert.equal(updated.body.reason, 'Ожидание клиента');
    assert.equal(state.equipment_downtimes[0].comment, 'Перенесли выезд');

    const managerList = await request(baseUrl, 'GET', '/api/equipment_downtimes', 'manager-token');
    assert.equal(managerList.status, 200);
    assert.equal(managerList.body.length, 1);

    assert.equal((await request(baseUrl, 'POST', '/api/equipment_downtimes', 'mechanic-token', {
      equipmentId: 'EQ-own',
      equipmentInv: '100',
      startDate: '2026-05-10',
    })).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/equipment_downtimes', 'investor-token')).status, 403);
  });
});

test('real Express API routes deny direct object-level bypasses', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    assert.equal((await request(baseUrl, 'GET', '/api/rentals/R-other', 'manager-token')).status, 403);
    assert.equal((await request(baseUrl, 'PATCH', '/api/rentals/R-other', 'manager-token', { comments: 'bypass' })).status, 403);
    assert.equal((await request(baseUrl, 'PATCH', '/api/rentals/R-own', 'manager-token', { managerId: 'U-other', comments: 'ok' })).status, 200);
    assert.equal(state.rentals.find(item => item.id === 'R-own').managerId, 'U-manager');
    assert.equal((await request(baseUrl, 'GET', '/api/service_vehicles/SV-1', 'manager-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/vehicle_trips', 'manager-token')).status, 200);
    assert.equal((await request(baseUrl, 'PATCH', '/api/service_vehicles/SV-1', 'manager-token', { status: 'repair' })).status, 403);
    assert.equal((await request(baseUrl, 'PATCH', '/api/payments/P-1', 'manager-token', { amount: 1, status: 'paid' })).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/service/S-other', 'mechanic-token')).status, 403);
    assert.equal((await request(baseUrl, 'PATCH', '/api/service/S-own', 'mechanic-token', {
      status: 'in_progress',
    })).status, 200);
    assert.equal(state.service.find(item => item.id === 'S-own').status, 'in_progress');
    assert.equal((await request(baseUrl, 'PATCH', '/api/service/S-own', 'mechanic-token', {
      mechanicId: 'M-2',
      assignedMechanicId: 'M-2',
      assignedUserId: 'U-other',
    })).status, 403);
    assert.equal(state.service.find(item => item.id === 'S-own').assignedMechanicId, 'M-1');
    assert.equal(state.service.find(item => item.id === 'S-own').assignedUserId, undefined);
    assert.equal((await request(baseUrl, 'PATCH', '/api/service/S-own', 'mechanic-token', {
      status: 'done',
    })).status, 403);
    assert.equal(state.service.find(item => item.id === 'S-own').status, 'in_progress');
    assert.equal((await request(baseUrl, 'PATCH', '/api/service/S-own', 'mechanic-token', {
      workLog: [{ name: 'forged work' }],
      parts: [{ name: 'forged part' }],
      works: [{ name: 'forged work list' }],
    })).status, 403);
    assert.equal(state.service.find(item => item.id === 'S-own').workLog, undefined);
    assert.equal((await request(baseUrl, 'PATCH', '/api/service/S-own', 'office-token', {
      status: 'closed',
    })).status, 403);
    assert.equal(state.service.find(item => item.id === 'S-own').status, 'in_progress');
    for (const token of ['mechanic-token', 'office-token', 'manager-token', 'sales-token', 'warranty-token']) {
      const response = await request(baseUrl, 'POST', '/api/repair_work_items', token, { repairId: 'S-other', workId: 'SW-1', quantity: 1 });
      assert.equal(response.status, 403, token);
      assert.equal(response.body.error, 'Недостаточно прав. Работы и запчасти может изменять только администратор');
      const partResponse = await request(baseUrl, 'POST', '/api/repair_part_items', token, { repairId: 'S-other', partId: 'SP-1', quantity: 1 });
      assert.equal(partResponse.status, 403, token);
      assert.equal(partResponse.body.error, 'Недостаточно прав. Работы и запчасти может изменять только администратор');
    }
    const unknownWorkField = await request(baseUrl, 'POST', '/api/repair_work_items', 'admin-token', {
      repairId: 'S-other',
      workId: 'SW-1',
      quantity: 1,
      strayTopLevel: 'should-not-persist',
    });
    assert.equal(unknownWorkField.status, 403);
    assert.match(unknownWorkField.body.error, /strayTopLevel/);
    assert.equal(state.repair_work_items.some(item => item.strayTopLevel), false);

    const unknownPartField = await request(baseUrl, 'PATCH', '/api/repair_part_items/RP-1', 'admin-token', {
      strayTopLevel: 'should-not-persist',
    });
    assert.equal(unknownPartField.status, 403);
    assert.match(unknownPartField.body.error, /strayTopLevel/);
    assert.equal(state.repair_part_items.find(item => item.id === 'RP-1').strayTopLevel, undefined);

    const adminWork = await request(baseUrl, 'POST', '/api/repair_work_items', 'admin-token', { repairId: 'S-other', workId: 'SW-1', quantity: 2, nameSnapshot: 'Диагностика' });
    assert.equal(adminWork.status, 201);
    assert.equal(state.service_audit_log.at(-1).action, 'work_added');
    const adminDeleteWork = await request(baseUrl, 'DELETE', `/api/repair_work_items/${adminWork.body.id}`, 'admin-token');
    assert.equal(adminDeleteWork.status, 200);
    assert.equal(state.service_audit_log.at(-1).action, 'work_deleted');
    assert.equal(state.service_audit_log.at(-1).snapshot.quantity, 2);
    assert.equal((await request(baseUrl, 'GET', '/api/equipment/EQ-other', 'warranty-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/service/S-other', 'warranty-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/warranty_claims/WC-1', 'warranty-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/service_works/SW-1', 'warranty-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/spare_parts/SP-1', 'warranty-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/repair_work_items/RW-1', 'warranty-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/repair_part_items/RP-1', 'warranty-token')).status, 200);
    assert.equal((await request(baseUrl, 'PATCH', '/api/service/S-other', 'warranty-token', { status: 'in_progress', assignedMechanicId: 'M-1' })).status, 403);
    assert.equal(state.service.find(item => item.id === 'S-other').assignedMechanicId, 'M-2');
    assert.equal((await request(baseUrl, 'GET', '/api/rentals/R-own', 'warranty-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/gantt_rentals/GR-other', 'warranty-token')).status, 200);
    assert.equal((await request(baseUrl, 'PATCH', '/api/rentals/R-own', 'warranty-token', { comments: 'bypass' })).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/equipment/EQ-other', 'warranty-alias-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/service/S-other', 'warranty-alias-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/warranty_claims/WC-1', 'warranty-alias-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/equipment/EQ-other', 'warranty-camel-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/service/S-other', 'warranty-camel-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/warranty_claims/WC-1', 'warranty-camel-token')).status, 200);
    const authMe = await request(baseUrl, 'GET', '/api/auth/me', 'warranty-camel-token');
    assert.equal(authMe.status, 200);
    assert.equal(authMe.body.user.rawRole, 'mechanicWarranty');
    assert.equal(authMe.body.user.normalizedRole, WARRANTY_MECHANIC_ROLE);
    assert.equal(authMe.body.user.userRole, WARRANTY_MECHANIC_ROLE);
    assert.ok(authMe.body.user.permissions.readableCollections.includes('equipment'));
    assert.ok(authMe.body.user.permissions.readableCollections.includes('service'));
    assert.ok(authMe.body.user.permissions.readableCollections.includes('warranty_claims'));
    assert.equal(authMe.body.user.permissions.readableCollections.includes('payments'), false);
    const equipmentList = await request(baseUrl, 'GET', '/api/equipment', 'warranty-camel-token');
    assert.equal(equipmentList.status, 200);
    assert.equal(equipmentList.body.length, 2);
    assertNoCommercialFields(equipmentList.body);
    const serviceList = await request(baseUrl, 'GET', '/api/service', 'warranty-camel-token');
    assert.equal(serviceList.status, 200);
    assert.equal(serviceList.body.length, 2);
    assertNoCommercialFields(serviceList.body);
    const warrantyClaimList = await request(baseUrl, 'GET', '/api/warranty_claims', 'warranty-camel-token');
    assert.equal(warrantyClaimList.status, 200);
    assert.equal(warrantyClaimList.body.length, 1);
    assert.equal((await request(baseUrl, 'GET', '/api/payments/P-1', 'warranty-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/app_settings/AS-1', 'warranty-token')).status, 403);
    for (const path of [
      '/api/equipment/EQ-other',
      '/api/service/S-other',
      '/api/rentals/R-own',
      '/api/gantt_rentals/GR-other',
      '/api/service_works/SW-1',
      '/api/spare_parts/SP-1',
      '/api/repair_work_items/RW-1',
      '/api/repair_part_items/RP-1',
    ]) {
      const response = await request(baseUrl, 'GET', path, 'warranty-token');
      assert.equal(response.status, 200, path);
      assertNoCommercialFields(response.body);
    }
    const investorMe = await request(baseUrl, 'GET', '/api/auth/me', 'investor-token');
    assert.equal(investorMe.status, 200);
    assert.equal(investorMe.body.user.userRole, 'Инвестор');
    assert.equal(investorMe.body.user.ownerId, 'OW-1');
    assert.ok(investorMe.body.user.permissions.readableCollections.includes('equipment'));
    assert.ok(investorMe.body.user.permissions.readableCollections.includes('rentals'));
    assert.ok(investorMe.body.user.permissions.readableCollections.includes('gantt_rentals'));
    assert.equal(investorMe.body.user.permissions.readableCollections.includes('clients'), false);
    assert.equal(investorMe.body.user.permissions.readableCollections.includes('payments'), false);
    assert.equal(investorMe.body.user.permissions.readableCollections.includes('documents'), false);
    assert.equal(investorMe.body.user.permissions.readableCollections.includes('service'), false);
    const investorEquipment = await request(baseUrl, 'GET', '/api/equipment', 'investor-token');
    assert.equal(investorEquipment.status, 200);
    assert.deepEqual(investorEquipment.body.map(item => item.id), ['EQ-own']);
    assert.equal((await request(baseUrl, 'GET', '/api/equipment/EQ-own', 'investor-token')).status, 200);
    const investorRentals = await request(baseUrl, 'GET', '/api/rentals', 'investor-token');
    assert.equal(investorRentals.status, 200);
    assert.deepEqual(investorRentals.body.map(item => item.id), ['R-own']);
    assert.equal((await request(baseUrl, 'GET', '/api/rentals/R-own', 'investor-token')).status, 200);
    const investorGanttRentals = await request(baseUrl, 'GET', '/api/gantt_rentals', 'investor-token');
    assert.equal(investorGanttRentals.status, 200);
    assert.deepEqual(investorGanttRentals.body.map(item => item.id), ['GR-own']);
    assert.equal((await request(baseUrl, 'GET', '/api/rental_change_requests', 'manager-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/equipment/EQ-other', 'investor-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/rentals/R-other', 'investor-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/gantt_rentals/GR-other', 'investor-token')).status, 403);
    for (const path of ['/api/clients', '/api/payments', '/api/documents', '/api/users', '/api/service', '/api/app_settings', '/api/rental_change_requests']) {
      const response = await request(baseUrl, 'GET', path, 'investor-token');
      assert.equal(response.status, 403, path);
    }
    assert.equal((await request(baseUrl, 'PATCH', '/api/equipment/EQ-own', 'investor-token', { notes: 'bypass' })).status, 403);
    assert.equal((await request(baseUrl, 'POST', '/api/payments', 'investor-token', { rentalId: 'R-own', amount: 1 })).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/app_settings', 'manager-token')).status, 403);
    assert.equal((await request(baseUrl, 'POST', '/api/app_settings', 'manager-token', {
      key: 'sales_section_settings',
      value: { quoteTemplate: { title: 'Bypass' } },
    })).status, 403);
    assert.equal((await request(baseUrl, 'PATCH', '/api/app_settings/AS-1', 'manager-token', {
      key: 'sales_section_settings',
      value: { quoteTemplate: { title: 'Bypass' } },
    })).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/unknown_collection/X-1', 'admin-token')).status, 403);
    assert.equal((await request(baseUrl, 'PUT', '/api/payments', 'manager-token', [{ id: 'P-1', amount: 1 }])).status, 403);
    assert.equal((await request(baseUrl, 'PUT', '/api/app_settings', 'office-token', [{ id: 'AS-1', key: 'secret' }])).status, 403);
    assert.equal((await request(baseUrl, 'PUT', '/api/users', 'office-token', [{ id: 'U-manager', role: 'Администратор' }])).status, 403);
    assert.equal((await request(baseUrl, 'PUT', '/api/service', 'mechanic-token', [{ id: 'S-own', status: 'done' }])).status, 403);
    assert.equal((await request(baseUrl, 'PUT', '/api/equipment', 'investor-token', [{ id: 'EQ-other', ownerId: 'OW-1' }])).status, 403);
  });
});

test('service delete audits cascaded repair item snapshots before removing them', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'DELETE', '/api/service/S-other', 'admin-token');

    assert.equal(response.status, 200);
    assert.equal(state.repair_work_items.some(item => item.id === 'RW-1'), false);
    assert.equal(state.repair_part_items.some(item => item.id === 'RP-1'), false);
    const workAudit = state.service_audit_log.find(item => item.action === 'work_deleted' && item.entityId === 'RW-1');
    const partAudit = state.service_audit_log.find(item => item.action === 'part_deleted' && item.entityId === 'RP-1');
    assert.ok(workAudit);
    assert.ok(partAudit);
    assert.equal(workAudit.snapshot.workId, 'SW-1');
    assert.equal(workAudit.snapshot.quantity, 1);
    assert.equal(partAudit.snapshot.partId, 'SP-1');
    assert.equal(partAudit.snapshot.quantity, 1);
  });
});

test('non-admin cannot delete service ticket with repair facts', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'DELETE', '/api/service/S-other', 'office-token');

    assert.equal(response.status, 403);
    assert.match(response.body.error, /только администратору/);
    assert.equal(state.service.some(item => item.id === 'S-other'), true);
    assert.equal(state.repair_work_items.some(item => item.id === 'RW-1'), true);
    assert.equal(state.repair_part_items.some(item => item.id === 'RP-1'), true);
    assert.equal(state.service_audit_log.length, 0);
  });
});

test('service_audit_log is not mutable through generic CRUD routes', async () => {
  const { app, state } = createSecurityApp();
  state.service_audit_log.push({
    id: 'audit-locked',
    serviceId: 'S-other',
    action: 'work_added',
    entityType: 'repair_work_item',
    entityId: 'RW-1',
    snapshot: { workId: 'SW-1', quantity: 1 },
    actor: { id: 'U-admin', name: 'Админ', role: 'Администратор' },
    source: 'web',
    createdAt: '2026-04-28T12:00:00.000Z',
  });

  await withServer(app, async (baseUrl) => {
    const before = JSON.stringify(state.service_audit_log);
    const attempts = [
      request(baseUrl, 'POST', '/api/service_audit_log', 'admin-token', { id: 'audit-forged' }),
      request(baseUrl, 'PATCH', '/api/service_audit_log/audit-locked', 'admin-token', { action: 'part_deleted' }),
      request(baseUrl, 'DELETE', '/api/service_audit_log/audit-locked', 'admin-token'),
      request(baseUrl, 'PUT', '/api/service_audit_log', 'admin-token', []),
    ];
    const responses = await Promise.all(attempts);

    for (const response of responses) {
      assert.equal(response.status, 404);
    }
    assert.equal(JSON.stringify(state.service_audit_log), before);
  });
});

test('admin generic CRUD PATCH rejects system and credential fields', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const before = { ...state.equipment.find(item => item.id === 'EQ-own') };
    const response = await request(baseUrl, 'PATCH', '/api/equipment/EQ-own', 'admin-token', {
      notes: 'allowed',
      createdAt: '2030-01-01T00:00:00.000Z',
      passwordHash: 'forged',
    });

    assert.equal(response.status, 403);
    assert.match(response.body.error, /createdAt|passwordHash/);
    const equipment = state.equipment.find(item => item.id === 'EQ-own');
    assert.equal(equipment.notes, before.notes);
    assert.equal(equipment.createdAt, before.createdAt);
    assert.equal(equipment.passwordHash, undefined);
  });
});

test('admin generic CRUD bulk PUT rejects dangerous fields and keeps custom fields allowed', async () => {
  const { app, state, auditEntries } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const allowed = await request(baseUrl, 'PUT', '/api/equipment', 'admin-token', [
      {
        id: 'EQ-own',
        inventoryNumber: '100',
        notes: 'allowed',
        customFields: { region: 'north' },
        uiOnlyCustomValue: 'kept for flexible forms',
      },
      state.equipment.find(item => item.id === 'EQ-other'),
    ]);

    assert.equal(allowed.status, 200);
    assert.equal(state.equipment.find(item => item.id === 'EQ-own').customFields.region, 'north');
    assert.equal(state.equipment.find(item => item.id === 'EQ-own').uiOnlyCustomValue, 'kept for flexible forms');

    const before = JSON.stringify(state.equipment);
    const auditCount = auditEntries.length;
    const blocked = await request(baseUrl, 'PUT', '/api/equipment', 'admin-token', [
      {
        id: 'EQ-own',
        inventoryNumber: '100',
        notes: 'blocked',
        auditLog: [{ action: 'forged' }],
      },
    ]);

    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error, /auditLog/);
    assert.equal(JSON.stringify(state.equipment), before);
    assert.equal(auditEntries.length, auditCount);
  });
});

test('admin rental PATCH rejects system fields before writing', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const before = { ...state.rentals.find(item => item.id === 'R-own') };
    const response = await request(baseUrl, 'PATCH', '/api/rentals/R-own', 'admin-token', {
      client: 'ООО Новый клиент',
      auditLog: [{ action: 'forged' }],
    });

    assert.equal(response.status, 403);
    assert.match(response.body.error, /auditLog/);
    assert.deepEqual(state.rentals.find(item => item.id === 'R-own'), before);
  });
});

test('admin rental bulk PUT rejects system fields before writing', async () => {
  const { app, state, auditEntries } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const before = JSON.stringify(state.rentals);
    const auditCount = auditEntries.length;
    const response = await request(baseUrl, 'PUT', '/api/rentals', 'admin-token', [
      {
        ...state.rentals.find(item => item.id === 'R-own'),
        client: 'ООО Новый клиент',
        auditLog: [{ action: 'forged' }],
      },
    ]);

    assert.equal(response.status, 403);
    assert.match(response.body.error, /auditLog/);
    assert.equal(JSON.stringify(state.rentals), before);
    assert.equal(auditEntries.length, auditCount);
  });
});

test('admin user PATCH keeps user workflow but rejects runtime fields', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const valid = await request(baseUrl, 'PATCH', '/api/users/U-sales', 'admin-token', {
      role: 'Менеджер по аренде',
      password: 'new-password',
      confirm: true,
    });

    assert.equal(valid.status, 200);
    const updatedUser = state.users.find(user => user.id === 'U-sales');
    assert.equal(updatedUser.role, 'Менеджер по аренде');
    assert.equal(updatedUser.password, 'hash:new-password');
    assert.equal(updatedUser.tokenVersion, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(updatedUser, 'confirm'), false);

    const blocked = await request(baseUrl, 'PATCH', '/api/users/U-sales', 'admin-token', {
      tokenVersion: 999,
    });

    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error, /tokenVersion/);
    assert.equal(state.users.find(user => user.id === 'U-sales').tokenVersion, 1);
  });
});

test('admin user POST accepts allowed fields and rejects unknown top-level fields before writing', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const valid = await request(baseUrl, 'POST', '/api/users', 'admin-token', {
      name: 'Новый пользователь',
      email: 'new-user@example.test',
      phone: '+7 900 000-00-00',
      role: 'Инвестор',
      status: 'Активен',
      password: 'new-password',
      profilePhoto: 'https://cdn.example.test/new-user.jpg',
      ownerId: 'OW-1',
      ownerName: 'Владелец',
    });

    assert.equal(valid.status, 201);
    assert.equal(valid.body.id, 'U-new');
    assert.equal(valid.body.name, 'Новый пользователь');
    assert.equal(JSON.stringify(valid.body).includes('new-password'), false);

    const created = state.users.find(user => user.email === 'new-user@example.test');
    assert.equal(created.role, 'Инвестор');
    assert.equal(created.password, 'hash:new-password');
    assert.equal(created.ownerId, 'OW-1');

    const countBefore = state.users.length;
    const blocked = await request(baseUrl, 'POST', '/api/users', 'admin-token', {
      name: 'Blocked',
      email: 'blocked@example.test',
      role: 'Менеджер по аренде',
      status: 'Активен',
      password: 'blocked-password',
      metadata: { passwordHash: 'secret-hash-value' },
    });

    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error, /metadata/);
    assert.equal(JSON.stringify(blocked.body).includes('secret-hash-value'), false);
    assert.equal(state.users.length, countBefore);
    assert.equal(state.users.some(user => user.email === 'blocked@example.test'), false);
  });
});

test('admin user PATCH rejects unknown top-level fields before writing', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const before = { ...state.users.find(user => user.id === 'U-manager') };
    const valid = await request(baseUrl, 'PATCH', '/api/users/U-manager', 'admin-token', {
      name: 'Руслан Updated',
      profilePhoto: 'https://cdn.example.test/manager.jpg',
    });

    assert.equal(valid.status, 200);
    assert.equal(state.users.find(user => user.id === 'U-manager').name, 'Руслан Updated');
    assert.equal(state.users.find(user => user.id === 'U-manager').profilePhoto, 'https://cdn.example.test/manager.jpg');

    const blocked = await request(baseUrl, 'PATCH', '/api/users/U-manager', 'admin-token', {
      ownerId: 'OW-1',
      settings: { passwordHash: 'secret-hash-value' },
    });

    assert.equal(blocked.status, 403);
    assert.match(blocked.body.error, /settings/);
    assert.equal(JSON.stringify(blocked.body).includes('secret-hash-value'), false);

    const after = state.users.find(user => user.id === 'U-manager');
    assert.equal(after.ownerId, before.ownerId);
    assert.equal(Object.prototype.hasOwnProperty.call(after, 'settings'), false);
  });
});

test('admin user bulk PUT rejects unknown top-level fields before writing', async () => {
  const { app, state, auditEntries } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const salesUser = state.users.find(user => user.id === 'U-sales');
    salesUser.tokenVersion = 7;
    salesUser.passwordChangedAt = '2026-05-01T12:00:00.000Z';
    const before = JSON.stringify(state.users);
    const auditCount = auditEntries.length;
    const response = await request(baseUrl, 'PUT', '/api/users', 'admin-token', state.users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      ...(user.ownerId ? { ownerId: user.ownerId } : {}),
      ...(user.id === 'U-sales' ? { preferences: { passwordHash: 'secret-hash-value' } } : {}),
    })));

    assert.equal(response.status, 403);
    assert.match(response.body.error, /preferences/);
    assert.equal(JSON.stringify(response.body).includes('secret-hash-value'), false);
    assert.equal(JSON.stringify(state.users), before);
    assert.equal(auditEntries.length, auditCount);

    const blockedRuntime = await request(baseUrl, 'PUT', '/api/users', 'admin-token', state.users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      ...(user.id === 'U-sales' ? { tokenVersion: 999 } : {}),
    })));

    assert.equal(blockedRuntime.status, 403);
    assert.match(blockedRuntime.body.error, /tokenVersion/);
    assert.equal(JSON.stringify(state.users), before);

    const valid = await request(baseUrl, 'PUT', '/api/users', 'admin-token', state.users.map(user => ({
      id: user.id,
      name: user.name,
      email: user.email,
      role: user.role,
      status: user.status,
      ...(user.ownerId ? { ownerId: user.ownerId } : {}),
    })));

    assert.equal(valid.status, 200);
    const preserved = state.users.find(user => user.id === 'U-sales');
    assert.equal(preserved.password, 'sales');
    assert.equal(preserved.tokenVersion, 7);
    assert.equal(preserved.passwordChangedAt, '2026-05-01T12:00:00.000Z');
  });
});

test('old bearer token stops working after password change', async () => {
  const { app } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const change = await request(baseUrl, 'POST', '/api/auth/change-password', 'manager-token', {
      currentPassword: 'old-password',
      newPassword: 'new-password',
    });
    assert.equal(change.status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/payments', 'manager-token')).status, 401);
  });
});

test('admin can deactivate a regular user and writes safe audit events', async () => {
  const { app, state, auditEntries } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'PATCH', '/api/users/U-manager', 'admin-token', {
      status: 'Неактивен',
      confirm: true,
    });

    assert.equal(response.status, 200);
    assert.equal(state.users.find(user => user.id === 'U-manager').status, 'Неактивен');
    assert.ok(auditEntries.some(entry => entry.action === 'users.status_change' && entry.entityId === 'U-manager'));
    const deactivate = auditEntries.find(entry => entry.action === 'users.deactivate' && entry.entityId === 'U-manager');
    assert.ok(deactivate);
    assert.equal(deactivate.before.status, 'Активен');
    assert.equal(deactivate.after.status, 'Неактивен');
    assert.equal(JSON.stringify(deactivate).includes('old-password'), false);
  });
});

test('non-admin roles cannot change users', async () => {
  const { app } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    for (const token of ['manager-token', 'office-token', 'mechanic-token']) {
      const response = await request(baseUrl, 'PATCH', '/api/users/U-sales', token, {
        status: 'Неактивен',
        confirm: true,
      });
      assert.equal(response.status, 403, token);
    }
  });
});

test('office manager gets safe staff options without user-management access', async () => {
  const { app } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const users = await request(baseUrl, 'GET', '/api/users', 'office-token');
    assert.equal(users.status, 200);
    assert.equal(JSON.stringify(users.body).includes('password'), false);
    assert.equal((await request(baseUrl, 'GET', '/api/users/U-sales', 'office-token')).status, 403);
    assert.equal((await request(baseUrl, 'PATCH', '/api/users/U-sales', 'office-token', { role: 'Администратор' })).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/users', 'mechanic-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/users', 'warranty-token')).status, 403);

    const options = await request(baseUrl, 'GET', '/api/staff/manager-options', 'office-token');
    assert.equal(options.status, 200);
    assert.deepEqual(
      options.body.map(item => item.id).sort(),
      ['U-manager', 'U-manager-alias', 'U-office', 'U-office-alias', 'U-sales'].sort(),
    );
    assert.equal(JSON.stringify(options.body).includes('password'), false);
    assert.equal(JSON.stringify(options.body).includes('admin@example.test'), false);

    assert.equal((await request(baseUrl, 'GET', '/api/client_objects', 'office-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/client_contracts', 'office-token')).status, 200);
  });
});

test('cannot deactivate or delete the last active admin', async () => {
  const state = createState();
  state.users = state.users.filter(user => user.id !== 'U-admin-alias');
  const { app } = createSecurityApp(state);

  await withServer(app, async (baseUrl) => {
    const deactivate = await request(baseUrl, 'PATCH', '/api/users/U-admin', 'admin-token', {
      status: 'Неактивен',
      confirm: true,
    });
    assert.equal(deactivate.status, 409);
    assert.match(deactivate.body.error, /последнего активного администратора/);

    const remove = await request(baseUrl, 'DELETE', '/api/users/U-admin', 'admin-token', {
      emailConfirmation: 'admin@example.test',
    });
    assert.equal(remove.status, 409);
    assert.match(remove.body.error, /последнего активного администратора/);
  });
});

test('cannot deactivate or delete yourself when another admin exists', async () => {
  const { app } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const deactivate = await request(baseUrl, 'PATCH', '/api/users/U-admin', 'admin-token', {
      status: 'Неактивен',
      confirm: true,
    });
    assert.equal(deactivate.status, 403);
    assert.match(deactivate.body.error, /самого себя/);

    const remove = await request(baseUrl, 'DELETE', '/api/users/U-admin', 'admin-token', {
      emailConfirmation: 'admin@example.test',
    });
    assert.equal(remove.status, 403);
    assert.match(remove.body.error, /самого себя/);
  });
});

test('user delete requires exact email confirmation', async () => {
  const { app, state, auditEntries } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const missing = await request(baseUrl, 'DELETE', '/api/users/U-sales', 'admin-token');
    assert.equal(missing.status, 400);
    assert.match(missing.body.error, /email пользователя/);

    const wrong = await request(baseUrl, 'DELETE', '/api/users/U-sales', 'admin-token', {
      emailConfirmation: 'wrong@example.test',
    });
    assert.equal(wrong.status, 400);
    assert.match(wrong.body.error, /email пользователя/);

    const ok = await request(baseUrl, 'DELETE', '/api/users/U-sales', 'admin-token', {
      emailConfirmation: 'sales@example.test',
    });
    assert.equal(ok.status, 200);
    assert.equal(state.users.some(user => user.id === 'U-sales'), false);
    const deleteAudit = auditEntries.find(entry => entry.action === 'users.delete' && entry.entityId === 'U-sales');
    assert.ok(deleteAudit);
    assert.equal(JSON.stringify(deleteAudit).includes('sales'), true);
    assert.equal(JSON.stringify(deleteAudit).includes('password'), false);
  });
});

test('payments API rejects negative payment amount', async () => {
  const { app } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/payments', 'admin-token', {
      rentalId: 'R-own',
      client: 'ООО Свой',
      amount: -1,
      status: 'partial',
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Сумма платежа/);
  });
});

test('payments API rejects negative paidAmount', async () => {
  const { app } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/payments', 'admin-token', {
      rentalId: 'R-own',
      client: 'ООО Свой',
      amount: 1000,
      paidAmount: -1,
      status: 'partial',
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Оплачено/);
  });
});

test('payments API rejects non-numeric payment amount', async () => {
  const { app } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/payments', 'admin-token', {
      rentalId: 'R-own',
      client: 'ООО Свой',
      amount: 'abc',
      status: 'partial',
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Сумма платежа/);
  });
});

test('payments API accepts explicit zero paidAmount', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/payments', 'admin-token', {
      rentalId: 'R-own',
      client: 'ООО Свой',
      amount: 1000,
      paidAmount: 0,
      status: 'partial',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.paidAmount, 0);
    assert.equal(state.payments.at(-1).paidAmount, 0);
  });
});

test('payments API accepts ordinary create fields and rejects unknown, id, documentId, and derived fields', async () => {
  const { app, state } = createSecurityApp();
  state.clients = [{ id: 'C-1', company: 'ООО Свой', inn: '1655000000' }];
  state.client_objects = [{ id: 'OBJ-1', clientId: 'C-1', name: 'Объект 1', status: 'active' }];
  state.client_contracts = [{ id: 'CTR-1', clientId: 'C-1', objectId: 'OBJ-1', number: 'Д-1', status: 'active' }];

  await withServer(app, async (baseUrl) => {
    const valid = await request(baseUrl, 'POST', '/api/payments', 'admin-token', {
      rentalId: 'R-own',
      clientId: 'C-1',
      client: 'ООО Свой',
      objectId: 'OBJ-1',
      contractId: 'CTR-1',
      invoiceNumber: 'INV-1',
      amount: 1000,
      paidAmount: 500,
      dueDate: '2026-05-20',
      paidDate: '2026-05-21',
      status: 'partial',
      method: 'bank',
      comment: 'ordinary',
      attachments: ['receipt.pdf'],
    });
    assert.equal(valid.status, 201);
    assert.equal(valid.body.id, 'P-new');
    assert.equal(valid.body.contractId, 'CTR-1');
    assert.deepEqual(valid.body.attachments, ['receipt.pdf']);

    const cases = [
      ['unknownField', { unknownField: 'nope' }],
      ['id', { id: 'P-client-supplied' }],
      ['documentId', { documentId: 'D-ordinary' }],
      ['allocatedAmount', { allocatedAmount: 100 }],
    ];
    for (const [field, extra] of cases) {
      const before = JSON.stringify(state.payments);
      const response = await request(baseUrl, 'POST', '/api/payments', 'admin-token', {
        rentalId: 'R-own',
        client: 'ООО Свой',
        amount: 1000,
        status: 'paid',
        ...extra,
      });
      assert.equal(response.status, 403);
      assert.match(response.body.error, new RegExp(field));
      assert.equal(JSON.stringify(state.payments), before);
    }
  });
});

test('payments API rejects dangerous patch fields without mutating existing payment', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const valid = await request(baseUrl, 'PATCH', '/api/payments/P-1', 'admin-token', {
      amount: 1500,
      paidAmount: 1000,
      status: 'partial',
      rentalId: 'R-other',
      comment: 'admin correction',
    });
    assert.equal(valid.status, 200);
    assert.equal(valid.body.amount, 1500);
    assert.equal(valid.body.rentalId, 'R-other');

    const rejectedFields = [
      'unknownTopLevel',
      'id',
      'allocatedAmount',
      'unallocatedAmount',
      'debt',
      'balance',
      'receivable',
      'payment_allocations',
      'createdAt',
      'updatedAt',
      'createdBy',
      'updatedBy',
      'confirmed',
      'posted',
      'imported',
      'source',
    ];
    for (const field of rejectedFields) {
      const before = JSON.stringify(state.payments.find(item => item.id === 'P-1'));
      const value = field === 'payment_allocations' ? [{ rentalId: 'R-own', amount: 100 }] : 'blocked';
      const response = await request(baseUrl, 'PATCH', '/api/payments/P-1', 'admin-token', { [field]: value });
      assert.equal(response.status, 403, field);
      assert.match(response.body.error, new RegExp(field));
      assert.equal(JSON.stringify(state.payments.find(item => item.id === 'P-1')), before, field);
    }
  });
});

test('payments API bulk replace permits legacy import fields and rejects unsafe fields atomically', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const valid = await request(baseUrl, 'PUT', '/api/payments', 'admin-token', [
      {
        id: 'P-import',
        rentalId: 'R-own',
        clientId: 'C-1',
        client: 'ООО Свой',
        invoiceNumber: 'INV-import',
        amount: 2000,
        paidAmount: 2000,
        dueDate: '2026-05-22',
        paidDate: '2026-05-23',
        date: '2026-05-23',
        paymentDate: '2026-05-23',
        documentId: 'D-import',
        status: 'paid',
        method: 'bank',
        comment: 'import row',
      },
    ]);
    assert.equal(valid.status, 200);
    assert.equal(state.payments.length, 1);
    assert.equal(state.payments[0].id, 'P-import');
    assert.equal(state.payments[0].date, '2026-05-23');
    assert.equal(state.payments[0].paymentDate, '2026-05-23');
    assert.equal(state.payments[0].documentId, 'D-import');

    const unsafeCases = [
      ['unknownBulkField', { unknownBulkField: 'nope' }],
      ['allocatedAmount', { allocatedAmount: 100 }],
      ['payment_allocations', { payment_allocations: [{ secret: 'bulk-secret' }] }],
    ];
    for (const [field, extra] of unsafeCases) {
      const before = JSON.stringify(state.payments);
      const response = await request(baseUrl, 'PUT', '/api/payments', 'admin-token', [
        {
          id: 'P-next',
          rentalId: 'R-own',
          client: 'ООО Свой',
          amount: 3000,
          status: 'paid',
          ...extra,
        },
      ]);
      assert.equal(response.status, 403, field);
      assert.match(response.body.error, new RegExp(field));
      assert.equal(JSON.stringify(state.payments), before, field);
    }
  });
});

test('payments API errors name rejected fields without leaking nested payment values', async () => {
  const { app } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    const metadata = await request(baseUrl, 'POST', '/api/payments', 'admin-token', {
      rentalId: 'R-own',
      client: 'ООО Свой',
      amount: 1000,
      status: 'paid',
      metadata: { bankSecret: 'secret-bank-token' },
    });
    assert.equal(metadata.status, 403);
    assert.match(metadata.body.error, /metadata/);
    assert.equal(metadata.body.error.includes('secret-bank-token'), false);

    const allocations = await request(baseUrl, 'PATCH', '/api/payments/P-1', 'admin-token', {
      payment_allocations: [{ secret: 'allocation-secret' }],
    });
    assert.equal(allocations.status, 403);
    assert.match(allocations.body.error, /payment_allocations/);
    assert.equal(allocations.body.error.includes('allocation-secret'), false);
  });
});

test('rental change request payment approval sanitizes ordinary payment patches', async () => {
  const { app, state } = createSecurityApp();
  state.rental_change_requests = [{
    id: 'RCR-payment-safe',
    entityType: 'payment',
    entityId: 'P-1',
    paymentId: 'P-1',
    rentalId: 'R-own',
    operation: 'update',
    type: 'Удаление или корректировка платежей',
    status: 'pending',
    newValue: {
      id: 'P-client-supplied',
      amount: 2000,
      status: 'paid',
      comment: 'approved correction',
    },
  }];

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/rental_change_requests/RCR-payment-safe/approve', 'admin-token', {});
    assert.equal(response.status, 200);
    assert.equal(state.payments[0].id, 'P-1');
    assert.equal(state.payments[0].amount, 2000);
    assert.equal(state.payments[0].comment, 'approved correction');
    assert.equal(state.rental_change_requests[0].status, 'approved');
  });
});

test('rental change request payment approval rejects unsanitized payment newValue fields', async () => {
  const unsafeFields = [
    ['unknownTopLevel', 'blocked'],
    ['allocatedAmount', 100],
    ['unallocatedAmount', 50],
    ['debt', 1000],
    ['balance', 1000],
    ['receivable', 1000],
    ['payment_allocations', [{ secret: 'approval-secret' }]],
    ['createdAt', '2026-05-24T00:00:00.000Z'],
    ['updatedAt', '2026-05-24T00:00:00.000Z'],
    ['createdBy', 'U-other'],
    ['updatedBy', 'U-other'],
    ['confirmed', true],
    ['posted', true],
    ['imported', true],
    ['source', 'bank-import'],
    ['documentId', 'D-ordinary'],
  ];

  for (const [field, value] of unsafeFields) {
    const { app, state } = createSecurityApp();
    state.rental_change_requests = [{
      id: `RCR-payment-unsafe-${field}`,
      entityType: 'payment',
      entityId: 'P-1',
      paymentId: 'P-1',
      rentalId: 'R-own',
      operation: 'update',
      type: 'Удаление или корректировка платежей',
      status: 'pending',
      newValue: {
        amount: 2000,
        status: 'paid',
        [field]: value,
      },
    }];

    await withServer(app, async (baseUrl) => {
      const before = JSON.stringify(state.payments);
      const response = await request(baseUrl, 'POST', `/api/rental_change_requests/RCR-payment-unsafe-${field}/approve`, 'admin-token', {});
      assert.equal(response.status, 403, field);
      assert.match(response.body.error, new RegExp(field), field);
      assert.equal(response.body.error.includes('approval-secret'), false, field);
      assert.equal(JSON.stringify(state.payments), before, field);
      assert.equal(state.rental_change_requests[0].status, 'pending', field);
    });
  }
});

test('CRM rejects negative budget', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/crm_deals', 'admin-token', {
      title: 'Сделка',
      company: 'ООО Клиент',
      budget: -1,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Сумма сделки/);
  });
});

test('CRM rejects non-numeric budget', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/crm_deals', 'admin-token', {
      title: 'Сделка',
      company: 'ООО Клиент',
      budget: 'abc',
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Сумма сделки/);
  });
});

test('CRM rejects Infinity budget', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/crm_deals', 'admin-token', {
      title: 'Сделка',
      company: 'ООО Клиент',
      budget: 'Infinity',
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Сумма сделки/);
  });
});

test('CRM rejects probability below zero', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/crm_deals', 'admin-token', {
      title: 'Сделка',
      company: 'ООО Клиент',
      probability: -1,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Вероятность/);
  });
});

test('CRM rejects probability above one hundred', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/crm_deals', 'admin-token', {
      title: 'Сделка',
      company: 'ООО Клиент',
      probability: 101,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Вероятность/);
  });
});

test('sales manager can persist CRM budget and probability', async () => {
  const { app, state } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/crm_deals', 'sales-token', {
      title: 'Новая продажа',
      pipeline: 'sales',
      stage: 'lead',
      status: 'open',
      priority: 'high',
      company: 'ООО Новый клиент',
      budget: 250000,
      probability: 40,
      responsibleUserId: 'U-sales',
      responsibleUserName: 'Светлана',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.budget, 250000);
    assert.equal(response.body.probability, 40);
    const saved = state.crm_deals.find(item => item.id === response.body.id);
    assert.equal(saved.budget, 250000);
    assert.equal(saved.probability, 40);
    assert.equal(saved.managerId, 'U-sales');
  });
});

test('non-admin CRM update does not silently drop allowed fields', async () => {
  const { app, state } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'PATCH', '/api/crm_deals/CRM-own', 'sales-token', {
      pipeline: 'sales',
      status: 'open',
      priority: 'high',
      company: 'ООО Обновленный',
      budget: 300000,
      probability: 65,
      responsibleUserId: 'U-sales',
      responsibleUserName: 'Светлана',
    });

    assert.equal(response.status, 200);
    const saved = state.crm_deals.find(item => item.id === 'CRM-own');
    assert.equal(saved.pipeline, 'sales');
    assert.equal(saved.status, 'open');
    assert.equal(saved.priority, 'high');
    assert.equal(saved.company, 'ООО Обновленный');
    assert.equal(saved.budget, 300000);
    assert.equal(saved.probability, 65);
    assert.equal(saved.responsibleUserId, 'U-sales');
    assert.equal(saved.responsibleUserName, 'Светлана');
  });
});

test('non-admin CRM mass-assignment still strips forbidden fields', async () => {
  const { app, state } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'PATCH', '/api/crm_deals/CRM-own', 'sales-token', {
      budget: 350000,
      role: 'Администратор',
      isAdmin: true,
      amount: 999999,
      managerId: 'U-other',
    });

    assert.equal(response.status, 200);
    const saved = state.crm_deals.find(item => item.id === 'CRM-own');
    assert.equal(saved.budget, 350000);
    assert.equal(saved.role, undefined);
    assert.equal(saved.isAdmin, undefined);
    assert.equal(saved.amount, undefined);
    assert.equal(saved.managerId, 'U-sales');
  });
});

test('service work catalog rejects non-numeric normHours', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/service_works', 'admin-token', {
      name: 'Диагностика',
      normHours: 'abc',
    });

    assert.equal(response.status, 400);
  });
});

test('service work catalog rejects negative normHours', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/service_works', 'admin-token', {
      name: 'Диагностика',
      normHours: -1,
    });

    assert.equal(response.status, 400);
  });
});

test('service work catalog rejects non-numeric ratePerHour', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/service_works', 'admin-token', {
      name: 'Диагностика',
      ratePerHour: 'abc',
    });

    assert.equal(response.status, 400);
  });
});

test('service work catalog rejects negative ratePerHour', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/service_works', 'admin-token', {
      name: 'Диагностика',
      ratePerHour: -1,
    });

    assert.equal(response.status, 400);
  });
});

test('spare part catalog rejects non-numeric defaultPrice', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/spare_parts', 'admin-token', {
      name: 'Фильтр',
      unit: 'шт',
      defaultPrice: 'abc',
    });

    assert.equal(response.status, 400);
  });
});

test('spare part catalog rejects negative defaultPrice', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/spare_parts', 'admin-token', {
      name: 'Фильтр',
      unit: 'шт',
      defaultPrice: -1,
    });

    assert.equal(response.status, 400);
  });
});

test('spare part catalog accepts omitted defaultPrice', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/spare_parts', 'admin-token', {
      name: 'Фильтр',
      unit: 'шт',
    });

    assert.equal(response.status, 201);
  });
});

const servicePayload = {
  equipmentId: 'EQ-own',
  equipment: 'Mantall HZ160 (INV: 100)',
  inventoryNumber: '100',
  reason: 'Течь гидравлики',
  description: 'Проверить гидролинию',
  priority: 'medium',
  sla: '24 ч',
  status: 'new',
};

test('mechanic service create assigns current mechanic through API', async () => {
  const { app, state } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/service', 'mechanic-token', servicePayload);

    assert.equal(response.status, 201);
    assert.equal(response.body.assignedMechanicId, 'M-1');
    assert.equal(response.body.mechanicId, 'M-1');
    assert.equal(response.body.assignedMechanicName, 'Петров');
    assert.equal(response.body.assignedTo, 'Петров');
    assert.equal(state.service.at(-1).assignedMechanicId, 'M-1');
  });
});

test('mechanic service create ignores another mechanic in payload', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/service', 'mechanic-token', {
      ...servicePayload,
      assignedMechanicId: 'M-other',
      mechanicId: 'M-other',
      assignedMechanicName: 'Другой механик',
      assignedTo: 'Другой механик',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.assignedMechanicId, 'M-1');
    assert.equal(response.body.mechanicId, 'M-1');
    assert.equal(response.body.assignedMechanicName, 'Петров');
    assert.equal(response.body.assignedTo, 'Петров');
  });
});

test('admin service create keeps selected mechanic through API', async () => {
  const { app, state } = createSecurityApp();
  state.mechanics.push({ id: 'M-2', name: 'Другой механик', userId: 'U-other' });
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/service', 'admin-token', {
      ...servicePayload,
      assignedMechanicId: 'M-2',
      mechanicId: 'M-2',
      assignedMechanicName: 'Другой механик',
      assignedTo: 'Другой механик',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.assignedMechanicId, 'M-2');
    assert.equal(response.body.mechanicId, 'M-2');
    assert.equal(response.body.assignedMechanicName, 'Другой механик');
    assert.equal(response.body.assignedTo, 'Другой механик');
  });
});

test('admin service create may leave mechanic unassigned through API', async () => {
  const { app } = createSecurityApp();
  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'POST', '/api/service', 'admin-token', servicePayload);

    assert.equal(response.status, 201);
    assert.equal(response.body.assignedMechanicId, undefined);
    assert.equal(response.body.assignedMechanicName, undefined);
    assert.equal(response.body.assignedTo, undefined);
  });
});

test('service create preserves client links for web service roles without exposing clients to forbidden roles', async () => {
  const { app, state } = createSecurityApp();
  state.clients.push({ id: 'C-service', company: 'ООО Сервис клиент', inn: '7707083893' });
  state.rentals.push({ id: 'R-service', clientId: 'C-service', client: 'ООО Сервис клиент', equipmentId: 'EQ-own' });

  await withServer(app, async baseUrl => {
    for (const [token, roleName] of [
      ['admin-token', 'Администратор'],
      ['office-token', 'Офис-менеджер'],
      ['manager-token', 'Менеджер по аренде'],
    ]) {
      const response = await request(baseUrl, 'POST', '/api/service', token, {
        ...servicePayload,
        clientId: 'C-service',
        client: 'ООО Сервис клиент',
        clientName: 'ООО Сервис клиент',
        rentalId: 'R-service',
      });

      assert.equal(response.status, 201, roleName);
      assert.equal(response.body.clientId, 'C-service', roleName);
      assert.equal(response.body.clientName, 'ООО Сервис клиент', roleName);
      assert.equal(response.body.rentalId, 'R-service', roleName);
    }

    const list = await request(baseUrl, 'GET', '/api/service', 'office-token');
    assert.equal(list.status, 200);
    assert.equal(list.body.some(item => item.clientId === 'C-service' && item.clientName === 'ООО Сервис клиент'), true);

    assert.equal((await request(baseUrl, 'GET', '/api/clients', 'investor-token')).status, 403);
  });
});

test('service create rejects rental from another client and can infer client from rental', async () => {
  const { app, state } = createSecurityApp();
  state.clients.push(
    { id: 'C-a', company: 'ООО Клиент А', inn: '7707083893' },
    { id: 'C-b', company: 'ООО Клиент Б', inn: '7707083894' },
  );
  state.client_objects.push(
    { id: 'CO-a', clientId: 'C-a', name: 'Объект А', address: 'Казань', status: 'active' },
    { id: 'CO-b', clientId: 'C-b', name: 'Объект Б', address: 'Москва', status: 'active' },
  );
  state.client_contracts.push(
    { id: 'CC-a', clientId: 'C-a', objectId: 'CO-a', number: 'Д-А', status: 'active' },
    { id: 'CC-b', clientId: 'C-b', objectId: 'CO-b', number: 'Д-Б', status: 'active' },
  );
  state.rentals.push(
    { id: 'R-a', clientId: 'C-a', client: 'ООО Клиент А', objectId: 'CO-a', contractId: 'CC-a', equipmentId: 'EQ-own' },
    { id: 'R-b', clientId: 'C-b', client: 'ООО Клиент Б', objectId: 'CO-b', contractId: 'CC-b', equipmentId: 'EQ-other' },
  );

  await withServer(app, async baseUrl => {
    const valid = await request(baseUrl, 'POST', '/api/service', 'admin-token', {
      ...servicePayload,
      clientId: 'C-a',
      client: 'ООО Клиент А',
      clientName: 'ООО Клиент А',
      rentalId: 'R-a',
      objectId: 'CO-a',
      contractId: 'CC-a',
    });
    assert.equal(valid.status, 201);
    assert.equal(valid.body.clientId, 'C-a');
    assert.equal(valid.body.rentalId, 'R-a');
    assert.equal(valid.body.objectId, 'CO-a');
    assert.equal(valid.body.contractId, 'CC-a');

    const foreignRental = await request(baseUrl, 'POST', '/api/service', 'admin-token', {
      ...servicePayload,
      clientId: 'C-a',
      client: 'ООО Клиент А',
      clientName: 'ООО Клиент А',
      rentalId: 'R-b',
    });
    assert.equal(foreignRental.status, 400);
    assert.equal(foreignRental.body.error, 'Аренда не принадлежит выбранному клиенту');

    const inferred = await request(baseUrl, 'POST', '/api/service', 'admin-token', {
      ...servicePayload,
      rentalId: 'R-b',
    });
    assert.equal(inferred.status, 201);
    assert.equal(inferred.body.clientId, 'C-b');
    assert.equal(inferred.body.clientName, 'ООО Клиент Б');
    assert.equal(inferred.body.objectId, 'CO-b');
    assert.equal(inferred.body.contractId, 'CC-b');

    const oldTicket = await request(baseUrl, 'GET', '/api/service/S-own', 'admin-token');
    assert.equal(oldTicket.status, 200);
    assert.equal(oldTicket.body.id, 'S-own');
  });
});

test('service patch rejects conflicting rental client link', async () => {
  const { app, state } = createSecurityApp();
  state.clients.push(
    { id: 'C-a', company: 'ООО Клиент А', inn: '7707083893' },
    { id: 'C-b', company: 'ООО Клиент Б', inn: '7707083894' },
  );
  state.rentals.push(
    { id: 'R-a', clientId: 'C-a', client: 'ООО Клиент А', equipmentId: 'EQ-own' },
    { id: 'R-b', clientId: 'C-b', client: 'ООО Клиент Б', equipmentId: 'EQ-other' },
  );
  state.service.push({
    ...servicePayload,
    id: 'S-client-a',
    clientId: 'C-a',
    client: 'ООО Клиент А',
    clientName: 'ООО Клиент А',
    rentalId: 'R-a',
  });

  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'PATCH', '/api/service/S-client-a', 'admin-token', {
      rentalId: 'R-b',
    });
    assert.equal(response.status, 400);
    assert.equal(response.body.error, 'Аренда не принадлежит выбранному клиенту');
  });
});

test('MAX webhook accepts header secret and rejects missing, wrong, or query secrets', async () => {
  const { app, auditEntries } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    assert.equal((await request(baseUrl, 'POST', '/bot/webhook', null, { update_type: 'message_created' })).status, 401);
    assert.equal((await request(baseUrl, 'POST', '/bot/webhook?secret=webhook-secret', null, { update_type: 'message_created' })).status, 401);
    assert.equal((await request(baseUrl, 'POST', '/bot/webhook', null, { update_type: 'message_created' }, { 'x-max-webhook-secret': 'wrong' })).status, 401);
    assert.equal((await request(baseUrl, 'POST', '/bot/webhook', null, { update_type: 'message_created' }, { 'x-max-webhook-secret': 'webhook-secret' })).status, 200);
  });

  assert.doesNotMatch(JSON.stringify(auditEntries), /webhook-secret/);
});

test('/api/manager/my-plan is read-only and does not expose secret-like fields', async () => {
  const { app, state } = createSecurityApp();
  state.equipment = [
    { id: 'EQ-1', inventoryNumber: '101', status: 'available', activeInFleet: true, category: 'own', password: 'hidden' },
    { id: 'EQ-2', inventoryNumber: '102', status: 'available', activeInFleet: true, category: 'own', token: 'hidden' },
  ];
  state.gantt_rentals = [
    { id: 'GR-1', managerId: 'U-manager', manager: 'Руслан', clientId: 'C-1', client: 'ООО План', equipmentId: 'EQ-1', status: 'active', plannedReturnDate: '2026-05-23', debt: 1000, cookie: 'hidden' },
  ];
  state.clients = [{ id: 'C-1', company: 'ООО План', managerId: 'U-manager', manager: 'Руслан', passwordHash: 'hidden' }];
  const before = JSON.stringify(state);

  await withServer(app, async baseUrl => {
    const response = await request(baseUrl, 'GET', '/api/manager/my-plan', 'manager-token');
    assert.equal(response.status, 200);
    assert.equal(response.body.summary.managerName, 'Руслан');
    assert.equal(response.body.summary.planStatus, 'needs_activity');
    assert.doesNotMatch(JSON.stringify(response.body), /hidden|password|token|cookie|secret|privateKey|authorization/i);
  });

  assert.equal(JSON.stringify(state), before);
});
