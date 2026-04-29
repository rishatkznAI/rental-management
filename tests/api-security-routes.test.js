import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { registerAuthRoutes } = require('../server/routes/auth.js');
const { registerCrudRoutes } = require('../server/routes/crud.js');
const { registerRentalRoutes } = require('../server/routes/rentals.js');
const { registerBotRoutes } = require('../server/routes/bot.js');

const WARRANTY_MECHANIC_ROLE = 'Механик по гарантии';
const MECHANIC_ROLES = ['Механик', 'Младший стационарный механик', 'Выездной механик', 'Старший стационарный механик'];

const READ_PERMISSIONS = {
  app_settings: ['Администратор'],
  clients: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  documents: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  equipment: ['Администратор', 'Офис-менеджер', 'Менеджер по аренде', 'Менеджер по продажам', 'Инвестор', WARRANTY_MECHANIC_ROLE, ...MECHANIC_ROLES],
  payments: ['Администратор', 'Менеджер по аренде', 'Менеджер по продажам', 'Офис-менеджер'],
  repair_work_items: ['Администратор', 'Офис-менеджер', WARRANTY_MECHANIC_ROLE, ...MECHANIC_ROLES],
  service: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', WARRANTY_MECHANIC_ROLE, ...MECHANIC_ROLES],
  users: ['Администратор'],
};

const WRITE_PERMISSIONS = {
  app_settings: ['Администратор'],
  clients: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  documents: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
  equipment: ['Администратор', 'Офис-менеджер'],
  payments: ['Администратор', 'Офис-менеджер'],
  repair_work_items: ['Администратор', WARRANTY_MECHANIC_ROLE, ...MECHANIC_ROLES],
  service: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', WARRANTY_MECHANIC_ROLE, ...MECHANIC_ROLES],
  users: ['Администратор'],
};

function createState() {
  return {
    users: [
      { id: 'U-admin', name: 'Админ', email: 'admin@example.test', role: 'Администратор', status: 'Активен', password: 'admin', tokenVersion: 0 },
      { id: 'U-manager', name: 'Руслан', email: 'manager@example.test', role: 'Менеджер по аренде', status: 'Активен', password: 'old-password', tokenVersion: 0 },
      { id: 'U-office', name: 'Офис', email: 'office@example.test', role: 'Офис-менеджер', status: 'Активен', password: 'office', tokenVersion: 0 },
      { id: 'U-mechanic', name: 'Петров', email: 'mechanic@example.test', role: 'Механик', status: 'Активен', password: 'mechanic', tokenVersion: 0 },
      { id: 'U-warranty', name: 'Гарантия', email: 'warranty@example.test', role: WARRANTY_MECHANIC_ROLE, status: 'Активен', password: 'warranty', tokenVersion: 0 },
      { id: 'U-investor', name: 'Инвестор', email: 'investor@example.test', role: 'Инвестор', status: 'Активен', password: 'investor', tokenVersion: 0, ownerId: 'OW-1' },
    ],
    rentals: [
      { id: 'R-own', manager: 'Руслан', managerId: 'U-manager', client: 'ООО Свой', equipmentId: 'EQ-own' },
      { id: 'R-other', manager: 'Анна', managerId: 'U-other', client: 'ООО Чужой', equipmentId: 'EQ-other' },
    ],
    gantt_rentals: [
      { id: 'GR-own', manager: 'Руслан', managerId: 'U-manager', client: 'ООО Свой', equipmentId: 'EQ-own' },
      { id: 'GR-other', manager: 'Анна', managerId: 'U-other', client: 'ООО Чужой', equipmentId: 'EQ-other' },
    ],
    equipment: [
      { id: 'EQ-own', inventoryNumber: '100', ownerId: 'OW-1', notes: 'own' },
      { id: 'EQ-other', inventoryNumber: '200', ownerId: 'OW-2', notes: 'other' },
    ],
    mechanics: [{ id: 'M-1', name: 'Петров', userId: 'U-mechanic' }],
    service: [
      { id: 'S-own', assignedMechanicId: 'M-1', assignedMechanicName: 'Петров', status: 'new' },
      { id: 'S-other', assignedMechanicId: 'M-2', assignedMechanicName: 'Другой', status: 'new' },
    ],
    repair_work_items: [],
    payments: [{ id: 'P-1', rentalId: 'R-own', amount: 1000, status: 'new' }],
    clients: [],
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
    ['manager-token', { userId: 'U-manager', tokenVersion: 0, passwordChangedAt: null }],
    ['office-token', { userId: 'U-office', tokenVersion: 0, passwordChangedAt: null }],
    ['mechanic-token', { userId: 'U-mechanic', tokenVersion: 0, passwordChangedAt: null }],
    ['warranty-token', { userId: 'U-warranty', tokenVersion: 0, passwordChangedAt: null }],
    ['investor-token', { userId: 'U-investor', tokenVersion: 0, passwordChangedAt: null }],
  ]);
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });
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
      return allowed.includes(req.user?.userRole) ? next() : res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  function requireWrite(collection) {
    return (req, res, next) => {
      const allowed = WRITE_PERMISSIONS[collection] || ['Администратор'];
      return allowed.includes(req.user?.userRole) ? next() : res.status(403).json({ ok: false, error: 'Forbidden' });
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
    nowIso: () => '2026-04-28T12:00:00.000Z',
  });

  const apiRouter = express.Router();
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
  }));
  apiRouter.use(registerCrudRoutes({
    collections: ['equipment', 'service', 'app_settings', 'payments', 'users', 'repair_work_items', 'clients', 'documents', 'unknown_collection'],
    idPrefixes: { equipment: 'EQ', service: 'S', payments: 'P', users: 'U', repair_work_items: 'RW', clients: 'C', documents: 'D' },
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

test('real Express API routes deny direct object-level bypasses', async () => {
  const { app, state } = createSecurityApp();

  await withServer(app, async (baseUrl) => {
    assert.equal((await request(baseUrl, 'GET', '/api/rentals/R-other', 'manager-token')).status, 403);
    assert.equal((await request(baseUrl, 'PATCH', '/api/rentals/R-other', 'manager-token', { comments: 'bypass' })).status, 403);
    assert.equal((await request(baseUrl, 'PATCH', '/api/rentals/R-own', 'manager-token', { managerId: 'U-other', comments: 'ok' })).status, 200);
    assert.equal(state.rentals.find(item => item.id === 'R-own').managerId, 'U-manager');
    assert.equal((await request(baseUrl, 'PATCH', '/api/payments/P-1', 'manager-token', { amount: 1, status: 'paid' })).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/service/S-other', 'mechanic-token')).status, 403);
    assert.equal((await request(baseUrl, 'PATCH', '/api/service/S-own', 'mechanic-token', {
      status: 'in_progress',
      mechanicId: 'M-2',
      assignedMechanicId: 'M-2',
      assignedUserId: 'U-other',
    })).status, 200);
    assert.equal(state.service.find(item => item.id === 'S-own').assignedMechanicId, 'M-1');
    assert.equal(state.service.find(item => item.id === 'S-own').assignedUserId, undefined);
    assert.equal((await request(baseUrl, 'POST', '/api/repair_work_items', 'mechanic-token', { repairId: 'S-other', workId: 'W-1', quantity: 1 })).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/equipment/EQ-other', 'warranty-token')).status, 200);
    assert.equal((await request(baseUrl, 'GET', '/api/service/S-other', 'warranty-token')).status, 200);
    assert.equal((await request(baseUrl, 'PATCH', '/api/service/S-other', 'warranty-token', { status: 'in_progress', assignedMechanicId: 'M-1' })).status, 200);
    assert.equal(state.service.find(item => item.id === 'S-other').assignedMechanicId, 'M-2');
    assert.equal((await request(baseUrl, 'GET', '/api/rentals/R-own', 'warranty-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/equipment/EQ-other', 'investor-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/gantt_rentals/GR-other', 'investor-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/app_settings', 'manager-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/unknown_collection/X-1', 'admin-token')).status, 403);
    assert.equal((await request(baseUrl, 'PUT', '/api/payments', 'manager-token', [{ id: 'P-1', amount: 1 }])).status, 403);
    assert.equal((await request(baseUrl, 'PUT', '/api/app_settings', 'office-token', [{ id: 'AS-1', key: 'secret' }])).status, 403);
    assert.equal((await request(baseUrl, 'PUT', '/api/users', 'office-token', [{ id: 'U-manager', role: 'Администратор' }])).status, 403);
    assert.equal((await request(baseUrl, 'PUT', '/api/service', 'mechanic-token', [{ id: 'S-own', status: 'done' }])).status, 403);
    assert.equal((await request(baseUrl, 'PUT', '/api/equipment', 'investor-token', [{ id: 'EQ-other', ownerId: 'OW-1' }])).status, 403);
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
