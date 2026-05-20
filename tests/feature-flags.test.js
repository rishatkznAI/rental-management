import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { registerAuthRoutes } = require('../server/routes/auth.js');
const { registerBotRoutes } = require('../server/routes/bot.js');
const { registerSystemRoutes } = require('../server/routes/system.js');
const {
  createAppDisabledMiddleware,
  getAppDisabledConfig,
  getBotDisabledConfig,
  getGsmDisabledConfig,
  sendAppDisabled,
} = require('../server/lib/feature-flags.js');

function createAppDisabledTestApp() {
  const app = express();
  const state = {
    users: [{
      id: 'U-admin',
      name: 'Админ',
      email: 'admin@example.test',
      role: 'Администратор',
      status: 'Активен',
      password: 'right',
    }],
    equipment: [{ id: 'EQ-1', name: 'Подъёмник' }],
  };
  app.use(express.json());

  function requireAuth(_req, res, _next) {
    return sendAppDisabled(res, getAppDisabledConfig());
  }

  registerAuthRoutes(app, {
    readData: name => state[name] || [],
    writeData: (name, value) => { state[name] = value; },
    verifyPassword: (plain, stored) => plain === stored,
    hashPassword: plain => `hash:${plain}`,
    needsPasswordRehash: () => false,
    createSession: () => 'token',
    requireAuth,
    destroySession: () => {},
    deleteSessionsForUserIds: () => 0,
    auditLog: () => {},
    getAppDisabledConfig,
    sendAppDisabled,
  });

  const apiRouter = express.Router();
  apiRouter.use(createAppDisabledMiddleware({ getConfig: getAppDisabledConfig }));
  apiRouter.get('/equipment', requireAuth, (_req, res) => res.json(state.equipment));
  apiRouter.post('/equipment', requireAuth, (req, res) => {
    state.equipment.push(req.body);
    res.status(201).json(req.body);
  });
  app.use('/api', apiRouter);

  registerSystemRoutes(app, {
    readData: name => state[name] || [],
    writeData: (name, value) => { state[name] = value; },
    getSnapshot: () => ({}),
    saveSnapshot: () => {},
    botToken: '',
    getBotUsers: () => ({}),
    sendMessage: async () => ({ ok: true }),
    countActiveSessions: () => 0,
    webhookUrl: '',
    requireAuth,
    requireAdmin: (_req, _res, next) => next(),
    fetchImpl: fetch,
    auditLog: () => {},
    getBuildInfo: () => ({ version: 'test' }),
    getAppDisabledConfig,
    jsonCollections: ['equipment', 'users'],
    dbPath: ':memory:',
  });

  return { app, state };
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

async function requestJson(baseUrl, path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: { 'content-type': 'application/json', ...(options.headers || {}) },
    ...options,
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('APP_DISABLED keeps health/version alive and blocks login/protected writes', async () => {
  const previousDisabled = process.env.APP_DISABLED;
  const previousMessage = process.env.APP_DISABLED_MESSAGE;
  process.env.APP_DISABLED = 'true';
  process.env.APP_DISABLED_MESSAGE = 'Техническая пауза';
  const { app, state } = createAppDisabledTestApp();

  try {
    await withServer(app, async (baseUrl) => {
      const health = await requestJson(baseUrl, '/health');
      assert.equal(health.status, 200);
      assert.equal(health.body.ok, true);

      const ready = await requestJson(baseUrl, '/health/ready');
      assert.equal(ready.status, 200);
      assert.equal(ready.body.ok, true);

      const version = await requestJson(baseUrl, '/api/version');
      assert.equal(version.status, 200);
      assert.equal(version.body.app.disabled, true);
      assert.equal(version.body.app.message, 'Техническая пауза');

      const login = await requestJson(baseUrl, '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ login: 'admin@example.test', password: 'right' }),
      });
      assert.equal(login.status, 503);
      assert.equal(login.body.code, 'APP_DISABLED');
      assert.equal(login.body.message, 'Техническая пауза');

      const protectedRead = await requestJson(baseUrl, '/api/equipment');
      assert.equal(protectedRead.status, 503);
      assert.equal(protectedRead.body.code, 'APP_DISABLED');

      const protectedWrite = await requestJson(baseUrl, '/api/equipment', {
        method: 'POST',
        body: JSON.stringify({ id: 'EQ-2' }),
      });
      assert.equal(protectedWrite.status, 503);
      assert.equal(state.equipment.length, 1);
    });
  } finally {
    if (previousDisabled === undefined) delete process.env.APP_DISABLED;
    else process.env.APP_DISABLED = previousDisabled;
    if (previousMessage === undefined) delete process.env.APP_DISABLED_MESSAGE;
    else process.env.APP_DISABLED_MESSAGE = previousMessage;
  }
});

test('BOT_DISABLED acknowledges webhook without running scenarios or deleting bot state', async () => {
  const previousDisabled = process.env.BOT_DISABLED;
  const previousMessage = process.env.BOT_DISABLED_MESSAGE;
  process.env.BOT_DISABLED = 'true';
  process.env.BOT_DISABLED_MESSAGE = 'Бот на паузе';

  const routes = {};
  const state = {
    bot_users: { '100': { userId: 'U-1', userRole: 'Механик' } },
    bot_sessions: { '100': { pendingAction: 'ticket_reason' } },
    bot_activity: [],
    service: [],
    deliveries: [{ id: 'DL-1', status: 'new' }],
  };
  let handled = false;
  const app = {
    post(path, handler) { routes[path] = handler; },
  };

  registerBotRoutes(app, {
    webhookPath: '/bot/webhook',
    webhookSecret: '',
    getBotDisabledConfig,
    recordBotDisabledActivity: event => {
      state.bot_activity.unshift({
        eventType: 'bot_disabled_received',
        ...event,
      });
    },
    handleCommand: async () => { handled = true; state.service.push({ id: 'S-1' }); },
    handleBotStarted: async () => { handled = true; },
    handleCallback: async () => { handled = true; state.deliveries[0].status = 'completed'; },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  try {
    const res = {
      statusCode: 200,
      body: null,
      status(code) { this.statusCode = code; return this; },
      json(payload) { this.body = payload; return this; },
      sendStatus(code) { this.statusCode = code; this.body = code; return this; },
    };
    await routes['/bot/webhook']({
      headers: {},
      params: {},
      body: {
        update_type: 'message_created',
        message: { sender: { user_id: 100 }, body: { text: '/сервис' } },
      },
      ip: '127.0.0.1',
    }, res);

    assert.equal(res.statusCode, 200);
    assert.equal(res.body.ok, true);
    assert.equal(res.body.disabled, true);
    assert.equal(handled, false);
    assert.deepEqual(state.service, []);
    assert.equal(state.deliveries[0].status, 'new');
    assert.deepEqual(state.bot_users, { '100': { userId: 'U-1', userRole: 'Механик' } });
    assert.deepEqual(state.bot_sessions, { '100': { pendingAction: 'ticket_reason' } });
    assert.equal(state.bot_activity.length, 1);
    assert.equal(state.bot_activity[0].eventType, 'bot_disabled_received');
  } finally {
    if (previousDisabled === undefined) delete process.env.BOT_DISABLED;
    else process.env.BOT_DISABLED = previousDisabled;
    if (previousMessage === undefined) delete process.env.BOT_DISABLED_MESSAGE;
    else process.env.BOT_DISABLED_MESSAGE = previousMessage;
  }
});

test('GSM conservation config treats GSM_ENABLED=false as a global ingest disable', () => {
  const config = getGsmDisabledConfig({
    GSM_ENABLED: 'false',
    GSM_DISABLED_MESSAGE: 'Telemetry paused',
  });

  assert.equal(config.disabled, true);
  assert.equal(config.message, 'Telemetry paused');
});
