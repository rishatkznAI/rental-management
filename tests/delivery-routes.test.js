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
    pickupTime: null,
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
    users: [{
      id: 'U-admin',
      name: 'Администратор',
      role: 'Администратор',
      status: 'Активен',
      phone: '+7 900 123-45-67',
      email: 'admin@example.test',
    }, {
      id: 'U-manager',
      name: 'Руслан',
      role: 'Менеджер по аренде',
      status: 'Активен',
      phone: '+7 900 111-22-33',
      email: 'manager@example.test',
    }, {
      id: 'U-head',
      name: 'Руководитель',
      role: 'Руководитель',
      status: 'Активен',
      phone: '+7 900 222-33-44',
      email: 'head@example.test',
    }, {
      id: 'U-carrier',
      name: 'ИП Сабитов Алмаз',
      role: 'Перевозчик',
      status: 'Активен',
      phone: '+7 900 000-00-00',
      email: 'carrier@example.test',
      carrierId: 'carrier-1',
      botOnly: false,
      allowFrontendLogin: true,
    }],
    clients: [
      { id: 'C-1', company: 'ИНЖИНИРИНГ' },
      { id: 'C-2', company: 'ДРУГОЙ' },
    ],
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
    client_objects: [],
    client_contracts: [],
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
    const sessionUserId = token === 'admin-token'
      ? 'U-admin'
      : (token === 'manager-token' ? 'U-manager' : (token === 'head-token' ? 'U-head' : (token === 'carrier-token' ? 'U-carrier' : null)));
    if (!sessionUserId) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const user = state.users.find(item => item.id === sessionUserId);
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = {
      userId: user.id,
      userName: user.name,
      userRole: user.role,
      email: user.email,
      carrierId: user.carrierId || null,
    };
    return next();
  }
  function requireRead(collection) {
    return (req, res, next) => {
      const allowed = {
        deliveries: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер', 'Руководитель', 'Перевозчик'],
        delivery_carriers: ['Администратор'],
      }[collection] || ['Администратор'];
      return allowed.includes(req.user?.userRole) ? next() : res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }
  function requireWrite(collection) {
    return (req, res, next) => {
      const allowed = {
        deliveries: ['Администратор', 'Менеджер по аренде', 'Офис-менеджер'],
      }[collection] || ['Администратор'];
      return allowed.includes(req.user?.userRole) ? next() : res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  registerDeliveryRoutes(apiRouter, {
    readData,
    writeData,
    requireAuth,
    requireRead,
    requireWrite,
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

async function request(baseUrl, method, path, body, token = 'admin-token') {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      authorization: `Bearer ${token}`,
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

test('frontend-enabled carrier reads only own active deliveries as sanitized operational data', async () => {
  const { app, state } = createDeliveryApp({
    id: 'DL-own',
    status: 'sent',
    carrierId: 'carrier-1',
    carrierKey: 'carrier-1',
    client: 'ООО Секретный клиент',
    clientId: 'C-1',
    rentalId: 'R-1',
    ganttRentalId: 'GR-1',
    classicRentalId: 'R-1',
    cost: 18000,
    carrierInvoiceReceived: true,
    clientPaymentVerified: true,
    botSentAt: '2026-04-28T09:00:00.000Z',
    botSendError: null,
    manager: 'Офис',
    responsibleManagerName: 'Офис',
    responsibleManagerPhone: '+7 900 111-22-33',
  });
  state.deliveries.push(
    makeDelivery({ id: 'DL-other', status: 'sent', carrierId: 'carrier-2', carrierKey: 'carrier-2' }),
    makeDelivery({ id: 'DL-closed', status: 'completed', carrierId: 'carrier-1', carrierKey: 'carrier-1' }),
  );

  await withServer(app, async (baseUrl) => {
    const list = await request(baseUrl, 'GET', '/api/deliveries', undefined, 'carrier-token');

    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map(item => item.id), ['DL-own']);
    assert.equal(list.body[0].origin, 'Новая база');
    assert.equal(list.body[0].destination, 'Аксубаево');
    assert.equal(list.body[0].cargo, 'LGMG AS1413 L13000065');
    for (const forbiddenField of [
      'cost',
      'client',
      'clientId',
      'rentalId',
      'ganttRentalId',
      'classicRentalId',
      'carrierId',
      'carrierKey',
      'carrierInvoiceReceived',
      'clientPaymentVerified',
      'botSentAt',
      'botSendError',
    ]) {
      assert.equal(Object.hasOwn(list.body[0], forbiddenField), false, `${forbiddenField} must not be exposed`);
    }

    const ownDetail = await request(baseUrl, 'GET', '/api/deliveries/DL-own', undefined, 'carrier-token');
    assert.equal(ownDetail.status, 200);
    assert.equal(Object.hasOwn(ownDetail.body, 'clientId'), false);
    assert.equal(Object.hasOwn(ownDetail.body, 'cost'), false);

    assert.equal((await request(baseUrl, 'GET', '/api/deliveries/DL-other', undefined, 'carrier-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/deliveries/DL-closed', undefined, 'carrier-token')).status, 403);
    assert.equal((await request(baseUrl, 'GET', '/api/delivery-carriers', undefined, 'carrier-token')).status, 403);
    assert.equal((await request(baseUrl, 'PATCH', '/api/deliveries/DL-own', { status: 'in_transit' }, 'carrier-token')).status, 403);
  });
});

test('delivery carrier directory is safe for rental manager while raw MAX connections stay admin-only', async () => {
  const { app, state } = createDeliveryApp();
  state.delivery_carriers.push({
    id: 'carrier-2',
    key: 'carrier-2',
    name: 'Неактивный перевозчик',
    phone: '+7 900 999-99-99',
    status: 'inactive',
    maxCarrierKey: '777',
  });
  state.bot_users['777'] = {
    userId: 'U-other-carrier',
    userName: 'Неактивный перевозчик',
    userRole: 'Перевозчик',
    role: 'carrier',
    botMode: 'delivery',
    carrierId: 'carrier-2',
    replyTarget: { user_id: 777, chat_id: 12345 },
  };

  await withServer(app, async (baseUrl) => {
    const managerDirectory = await request(baseUrl, 'GET', '/api/delivery-carriers', undefined, 'manager-token');

    assert.equal(managerDirectory.status, 200);
    assert.deepEqual(managerDirectory.body.map(item => item.id), ['carrier-1']);
    assert.equal(managerDirectory.body[0].name, 'ИП Сабитов Алмаз');
    assert.equal(managerDirectory.body[0].maxConnected, true);
    for (const forbiddenField of [
      'maxCarrierKey',
      'chatId',
      'userId',
      'systemUserId',
      'systemUserName',
      'systemUserEmail',
      'maxUserName',
      'email',
      'role',
    ]) {
      assert.equal(Object.hasOwn(managerDirectory.body[0], forbiddenField), false, `${forbiddenField} must not be exposed`);
    }

    const managerConnections = await request(baseUrl, 'GET', '/api/delivery-carrier-connections', undefined, 'manager-token');
    assert.equal(managerConnections.status, 403);

    const carrierConnections = await request(baseUrl, 'GET', '/api/delivery-carrier-connections', undefined, 'carrier-token');
    assert.equal(carrierConnections.status, 403);

    const adminConnections = await request(baseUrl, 'GET', '/api/delivery-carrier-connections');
    assert.equal(adminConnections.status, 200);
    assert.deepEqual(new Set(adminConnections.body.map(item => item.key)), new Set(['555', '777']));
    assert.equal(adminConnections.body.find(item => item.key === '777').chatId, 12345);
    assert.equal(adminConnections.body.find(item => item.key === '777').userId, 777);
  });
});

test('admin reads every delivery including completed and cancelled records', async () => {
  const { app, state } = createDeliveryApp({
    id: 'DL-active',
    status: 'sent',
    carrierId: 'carrier-1',
    carrierKey: 'carrier-1',
  });
  state.deliveries.push(
    makeDelivery({ id: 'DL-completed', status: 'completed', carrierId: 'carrier-1', carrierKey: 'carrier-1' }),
    makeDelivery({ id: 'DL-cancelled', status: 'cancelled', carrierId: 'carrier-2', carrierKey: 'carrier-2' }),
  );

  await withServer(app, async (baseUrl) => {
    const list = await request(baseUrl, 'GET', '/api/deliveries');

    assert.equal(list.status, 200);
    assert.deepEqual(new Set(list.body.map(item => item.id)), new Set(['DL-active', 'DL-completed', 'DL-cancelled']));
  });
});

test('paginated delivery status groups are not pre-filtered as literal statuses', async () => {
  const { app, state } = createDeliveryApp({
    id: 'DL-sent',
    status: 'sent',
    transportDate: '2026-04-28',
    carrierId: 'carrier-1',
    carrierKey: 'carrier-1',
  });
  state.deliveries.push(
    makeDelivery({ id: 'DL-new', status: 'new', transportDate: '2026-04-29' }),
    makeDelivery({ id: 'DL-completed', status: 'completed', transportDate: '2026-04-27' }),
    makeDelivery({ id: 'DL-cancelled', status: 'cancelled', transportDate: '2026-04-26' }),
  );

  await withServer(app, async (baseUrl) => {
    const active = await request(baseUrl, 'GET', '/api/deliveries?paginated=true&status=active');

    assert.equal(active.status, 200);
    assert.deepEqual(new Set(active.body.items.map(item => item.id)), new Set(['DL-sent', 'DL-new']));
    assert.equal(active.body.summary.active, 2);

    const planned = await request(baseUrl, 'GET', '/api/deliveries?paginated=true&status=planned');
    assert.equal(planned.status, 200);
    assert.deepEqual(new Set(planned.body.items.map(item => item.id)), new Set(['DL-sent', 'DL-new']));

    const completed = await request(baseUrl, 'GET', '/api/deliveries?paginated=true&status=completed');
    assert.equal(completed.status, 200);
    assert.deepEqual(completed.body.items.map(item => item.id), ['DL-completed']);
  });
});

test('head reads deliveries as read-only movement data without financial fields', async () => {
  const { app } = createDeliveryApp({
    id: 'DL-head',
    status: 'sent',
    cost: 18000,
    carrierInvoiceReceived: true,
    carrierInvoiceReceivedAt: '2026-04-28T10:00:00.000Z',
    clientPaymentVerified: true,
    clientPaymentVerifiedAt: '2026-04-28T10:05:00.000Z',
  });

  await withServer(app, async (baseUrl) => {
    const list = await request(baseUrl, 'GET', '/api/deliveries', undefined, 'head-token');

    assert.equal(list.status, 200);
    assert.deepEqual(list.body.map(item => item.id), ['DL-head']);
    assert.equal(list.body[0].origin, 'Новая база');
    assert.equal(list.body[0].destination, 'Аксубаево');
    assert.equal(list.body[0].cargo, 'LGMG AS1413 L13000065');
    for (const forbiddenField of [
      'cost',
      'carrierInvoiceReceived',
      'carrierInvoiceReceivedAt',
      'clientPaymentVerified',
      'clientPaymentVerifiedAt',
    ]) {
      assert.equal(Object.hasOwn(list.body[0], forbiddenField), false, `${forbiddenField} must not be exposed`);
    }

    const detail = await request(baseUrl, 'GET', '/api/deliveries/DL-head', undefined, 'head-token');
    assert.equal(detail.status, 200);
    assert.equal(Object.hasOwn(detail.body, 'cost'), false);

    assert.equal((await request(baseUrl, 'POST', '/api/deliveries', { id: 'DL-new' }, 'head-token')).status, 403);
    assert.equal((await request(baseUrl, 'PATCH', '/api/deliveries/DL-head', { status: 'completed' }, 'head-token')).status, 403);
    assert.equal((await request(baseUrl, 'DELETE', '/api/deliveries/DL-head', undefined, 'head-token')).status, 403);
  });
});

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

test('creating a delivery from rental copies object and contract context without financial fields', async () => {
  const { app, state, messages } = createDeliveryApp();
  state.deliveries = [];
  state.rentals = [{
    id: 'R-1',
    clientId: 'C-1',
    client: 'ИНЖИНИРИНГ',
    objectId: 'CO-1',
    contractId: 'CC-1',
    equipmentId: 'EQ-1',
    equipment: ['083'],
    startDate: '2026-04-29',
    plannedReturnDate: '2026-05-10',
    manager: 'Администратор',
  }];
  state.client_objects = [{
    id: 'CO-1',
    clientId: 'C-1',
    name: 'ТЦ Север',
    address: 'Казань, Северная 1',
    contactName: 'Ильдар',
    contactPhone: '+7 900 111-22-33',
  }];
  state.client_contracts = [{ id: 'CC-1', clientId: 'C-1', objectId: 'CO-1', number: 'Д-1', status: 'active' }];

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      rentalId: 'R-1',
      transportDate: '2026-04-29',
      origin: 'Новая база',
      destination: 'Казань, Северная 1',
      cargo: 'LGMG AS1413',
      contactName: 'Ильдар',
      contactPhone: '+7 900 111-22-33',
      client: 'ИНЖИНИРИНГ',
      manager: 'Администратор',
      carrierKey: 'carrier-1',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.objectId, 'CO-1');
    assert.equal(response.body.contractId, 'CC-1');
    assert.equal(response.body.objectName, 'ТЦ Север');
    assert.equal(response.body.objectAddress, 'Казань, Северная 1');
    assert.equal(messages.length, 1);
    assert.match(messages[0].text, /Объект: ТЦ Север/);
    assert.match(messages[0].text, /Адрес объекта: Казань, Северная 1/);
    assert.doesNotMatch(messages[0].text, /cost|amount|debt|финанс/i);
  });
});

test('delivery rejects foreign object and contract links before object snapshot', async () => {
  const { app, state } = createDeliveryApp();
  state.deliveries = [];
  state.client_objects = [
    { id: 'CO-1', clientId: 'C-1', name: 'Свой', address: 'Казань', contactName: 'Ильдар', contactPhone: '+7', status: 'active' },
    { id: 'CO-2', clientId: 'C-2', name: 'Чужой', address: 'Москва', contactName: 'Петр', contactPhone: '+7', status: 'active' },
  ];
  state.client_contracts = [
    { id: 'CC-1', clientId: 'C-1', objectId: 'CO-1', number: 'Д-1', status: 'active' },
    { id: 'CC-2', clientId: 'C-2', objectId: 'CO-2', number: 'Д-2', status: 'active' },
  ];

  await withServer(app, async (baseUrl) => {
    const foreignObject = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      clientId: 'C-1',
      objectId: 'CO-2',
      transportDate: '2026-04-29',
      origin: 'Новая база',
      destination: 'Ручной адрес',
      cargo: 'LGMG',
    });
    assert.equal(foreignObject.status, 400);
    assert.equal(state.deliveries.length, 0);

    const foreignContract = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      clientId: 'C-1',
      contractId: 'CC-2',
      transportDate: '2026-04-29',
      origin: 'Новая база',
      destination: 'Ручной адрес',
      cargo: 'LGMG',
    });
    assert.equal(foreignContract.status, 400);

    const valid = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      clientId: 'C-1',
      client: 'ИНЖИНИРИНГ',
      objectId: 'CO-1',
      contractId: 'CC-1',
      transportDate: '2026-04-29',
      origin: 'Новая база',
      destination: 'Ручной адрес',
      cargo: 'LGMG',
      contactName: 'Ильдар',
      contactPhone: '+7',
      carrierKey: 'carrier-1',
    });
    assert.equal(valid.status, 201);
    assert.equal(valid.body.objectAddress, 'Казань');
    assert.equal(valid.body.destination, 'Ручной адрес');
  });
});

test('creating a delivery stores creator contact fields and sends them to carrier', async () => {
  const { app, state, messages } = createDeliveryApp();
  state.deliveries = [];

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      transportDate: '2026-04-29',
      pickupTime: '09:30',
      neededBy: '2026-04-29',
      origin: 'Новая база',
      destination: 'Аксубаево',
      cargo: 'LGMG AS1413 L13000065',
      contactName: 'Олег',
      contactPhone: '+7 927 407-07-23',
      client: 'ИНЖИНИРИНГ',
      manager: 'Администратор',
      carrierKey: 'carrier-1',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.pickupTime, '09:30');
    assert.equal(response.body.createdBy, 'Администратор');
    assert.equal(response.body.createdByUserId, 'U-admin');
    assert.equal(response.body.createdByName, 'Администратор');
    assert.equal(response.body.createdByPhone, '+7 900 123-45-67');
    assert.equal(response.body.createdByEmail, 'admin@example.test');
    assert.equal(state.deliveries[0].createdByUserId, 'U-admin');
    assert.equal(state.deliveries[0].pickupTime, '09:30');
    assert.equal(messages.length, 1);
    assert.match(messages[0].text, /Время забора: 09:30/);
    assert.match(messages[0].text, /👤 Контакт по заявке:\nИмя: Администратор\nТелефон: \+7 900 123-45-67\nEmail: admin@example\.test/);
  });
});

test('delivery API reads and updates pickupTime', async () => {
  const { app, state } = createDeliveryApp({ pickupTime: undefined });

  await withServer(app, async (baseUrl) => {
    const before = await request(baseUrl, 'GET', '/api/deliveries/DL-1');
    assert.equal(before.status, 200);
    assert.equal(before.body.pickupTime, undefined);

    const response = await request(baseUrl, 'PATCH', '/api/deliveries/DL-1', {
      pickupTime: '14:45',
    });

    assert.equal(response.status, 200);
    assert.equal(response.body.pickupTime, '14:45');
    assert.equal(state.deliveries[0].pickupTime, '14:45');
  });
});

test('creating a delivery rejects negative delivery cost', async () => {
  const { app } = createDeliveryApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      transportDate: '2026-04-29',
      origin: 'Новая база',
      destination: 'Аксубаево',
      cargo: 'LGMG AS1413 L13000065',
      contactName: 'Олег',
      contactPhone: '+7 927 407-07-23',
      client: 'ИНЖИНИРИНГ',
      manager: 'Администратор',
      cost: -1,
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Стоимость доставки/);
  });
});

test('creating a delivery rejects non-numeric delivery cost', async () => {
  const { app } = createDeliveryApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      transportDate: '2026-04-29',
      origin: 'Новая база',
      destination: 'Аксубаево',
      cargo: 'LGMG AS1413 L13000065',
      contactName: 'Олег',
      contactPhone: '+7 927 407-07-23',
      client: 'ИНЖИНИРИНГ',
      manager: 'Администратор',
      cost: 'abc',
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Стоимость доставки/);
  });
});

test('creating a delivery rejects invalid transport date', async () => {
  const { app, state } = createDeliveryApp();

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      transportDate: 'not-a-date',
      origin: 'Казань',
      destination: 'Алабуга',
      cargo: 'Подъёмник',
      contactName: 'Иван',
      contactPhone: '+7',
      client: 'ИНЖИНИРИНГ',
      manager: 'Администратор',
    });

    assert.equal(response.status, 400);
    assert.match(response.body.error, /Дата перевозки/);
  });

  assert.equal(state.deliveries.length, 1);
});

test('creating a delivery treats empty delivery cost as zero', async () => {
  const { app, state } = createDeliveryApp();
  state.deliveries = [];

  await withServer(app, async (baseUrl) => {
    const response = await request(baseUrl, 'POST', '/api/deliveries', {
      type: 'shipping',
      transportDate: '2026-04-29',
      origin: 'Новая база',
      destination: 'Аксубаево',
      cargo: 'LGMG AS1413 L13000065',
      contactName: 'Олег',
      contactPhone: '+7 927 407-07-23',
      client: 'ИНЖИНИРИНГ',
      manager: 'Администратор',
      cost: '',
    });

    assert.equal(response.status, 201);
    assert.equal(response.body.cost, 0);
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
