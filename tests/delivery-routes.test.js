import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { createAccessControl } = require('../server/lib/access-control.js');
const { registerDeliveryRoutes } = require('../server/routes/deliveries.js');

function makeDelivery(overrides = {}) {
  return {
    id: 'DL-1',
    type: 'shipping',
    status: 'new',
    transportDate: '2026-04-28',
    neededBy: '2026-04-28',
    origin: 'Новая база',
    destination: 'Аксубаево',
    cargo: 'LGMG AS1413 L13000065',
    contactName: 'Олег',
    contactPhone: '+7 927 407-07-23',
    cost: 18000,
    comment: '',
    client: 'ИНЖИНИРИНГ',
    clientId: null,
    manager: 'Хабибрахманов Ришат Ринатович',
    carrierId: null,
    carrierKey: null,
    carrierName: null,
    carrierPhone: null,
    carrierChatId: null,
    carrierUserId: null,
    botSentAt: null,
    botSendError: 'Перевозчик не выбран',
    carrierInvoiceReceived: false,
    clientPaymentVerified: false,
    createdAt: '2026-04-28T08:00:00.000Z',
    updatedAt: '2026-04-28T08:00:00.000Z',
    createdBy: 'Администратор',
    ...overrides,
  };
}

function createDeliveryApp(deliveryOverrides = {}) {
  const state = {
    users: [{ id: 'U-admin', name: 'Администратор', role: 'Администратор', status: 'Активен' }],
    deliveries: [makeDelivery(deliveryOverrides)],
    delivery_carriers: [{
      id: 'carrier-1',
      name: 'ИП Сабитов Алмаз',
      phone: '+7 900 000-00-00',
      status: 'active',
      maxCarrierKey: '555',
    }],
    bot_users: {
      '555': {
        userId: 'U-carrier',
        userName: 'ИП Сабитов Алмаз',
        userRole: 'Перевозчик',
        role: 'carrier',
        botMode: 'delivery',
        carrierId: 'carrier-1',
        replyTarget: { user_id: 555, chat_id: null },
      },
    },
    equipment: [],
    gantt_rentals: [],
    rentals: [],
  };
  const messages = [];
  const app = express();
  app.use(express.json());
  const apiRouter = express.Router();
  const readData = (name) => state[name] || [];
  const writeData = (name, value) => {
    state[name] = value;
  };
  const accessControl = createAccessControl({ readData });

  function requireAuth(req, res, next) {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if (token !== 'admin-token') return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = {
      userId: 'U-admin',
      userName: 'Администратор',
      userRole: 'Администратор',
    };
    return next();
  }

  registerDeliveryRoutes(apiRouter, {
    readData,
    writeData,
    requireAuth,
    requireRead: () => (_req, _res, next) => next(),
    requireWrite: () => (_req, _res, next) => next(),
    sendMessage: async (target, text, options = {}) => {
      messages.push({ target, text, options });
      return { message: { message_id: `msg-${messages.length}` } };
    },
    getBotUsers: () => state.bot_users,
    saveBotUsers: (value) => {
      state.bot_users = value;
    },
    nowIso: () => '2026-04-28T09:00:00.000Z',
    generateId: (prefix) => `${prefix}-new`,
    idPrefixes: { deliveries: 'DL' },
    accessControl,
    auditLog: () => {},
  });

  app.use('/api', apiRouter);
  return { app, state, messages };
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

async function request(baseUrl, method, path, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: 'Bearer admin-token',
      'content-type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

test('updating a delivery with a carrier sends the previously unsent request to MAX', async () => {
  const { app, state, messages } = createDeliveryApp({
    comment: 'Забрать у охраны пропуск и комплект документов.',
  });

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'PATCH', '/api/deliveries/DL-1', {
      carrierKey: 'carrier-1',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.carrierId, 'carrier-1');
    assert.equal(response.body.carrierName, 'ИП Сабитов Алмаз');
    assert.equal(response.body.status, 'sent');
    assert.equal(response.body.botSentAt, '2026-04-28T09:00:00.000Z');
    assert.equal(response.body.botSendError, null);
    assert.equal(messages.length, 1);
    assert.deepEqual(messages[0].target, { user_id: 555, chat_id: null });
    assert.match(messages[0].text, /^Появилась новая заявка на отгрузку/);
    assert.match(messages[0].text, /Комментарий менеджера: Забрать у охраны пропуск и комплект документов\./);
    assert.equal(state.deliveries[0].botSendError, null);
  });
});

test('updating manager comment on a sent delivery notifies carrier again', async () => {
  const { app, messages } = createDeliveryApp({
    status: 'sent',
    carrierId: 'carrier-1',
    carrierKey: 'carrier-1',
    carrierName: 'ИП Сабитов Алмаз',
    carrierPhone: '+7 900 000-00-00',
    botSentAt: '2026-04-28T08:10:00.000Z',
    botSendError: null,
    comment: 'Старый комментарий',
  });

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'PATCH', '/api/deliveries/DL-1', {
      comment: 'Новый комментарий менеджера: въезд через КПП-2.',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.botSendError, null);
    assert.equal(messages.length, 1);
    assert.match(messages[0].text, /Комментарий менеджера: Новый комментарий менеджера: въезд через КПП-2\./);
  });
});

test('saving a delivery recovers old records that already have a carrier but a stale missing-carrier error', async () => {
  const { app, messages } = createDeliveryApp({
    carrierId: 'carrier-1',
    carrierKey: 'carrier-1',
    carrierName: 'ИП Сабитов Алмаз',
    carrierPhone: '+7 900 000-00-00',
  });

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'PATCH', '/api/deliveries/DL-1', {
      comment: 'Уточнили контакт',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.status, 'sent');
    assert.equal(response.body.botSentAt, '2026-04-28T09:00:00.000Z');
    assert.equal(response.body.botSendError, null);
    assert.equal(messages.length, 1);
  });
});
