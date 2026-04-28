import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createBotHandlers } = require('../server/lib/bot-commands.js');
const { createAccessControl } = require('../server/lib/access-control.js');
const { toCarrierDeliveryDto } = require('../server/lib/carrier-delivery-dto.js');
const {
  BOT_STAGE_IMAGE_VERSION,
  MANAGER_STAGE_IMAGES,
  attachBotBrandImage,
  attachMechanicStageImage,
} = require('../server/lib/bot-stage-images.js');
const { createMaxApiClient } = require('../server/lib/max-api.js');
const {
  createBotUpdateProcessor,
  disconnectBotConnection,
  registerBotRoutes,
  updateBotConnectionRole,
} = require('../server/routes/bot.js');

function createMemoryBot(preferCarrierAutoLogin = false, overrides = {}) {
  const state = {
    bot_users: {
      '100': {
        userId: 'U-manager',
        userName: 'Руслан',
        userRole: 'Менеджер по аренде',
        email: 'manager@example.test',
        replyTarget: { user_id: 100, chat_id: null },
      },
    },
    bot_sessions: {},
    delivery_carriers: [
      {
        id: 'carrier-1',
        name: 'Быстрая доставка',
        status: 'active',
        maxCarrierKey: '100',
      },
    ],
    users: [],
    deliveries: [],
    equipment: [],
    gantt_rentals: [],
    payments: [],
    service_route_norms: [],
    service_field_trips: [],
    service: [],
    repair_work_items: [],
    repair_part_items: [],
    equipment_operation_sessions: [],
    bot_activity: [],
  };
  const messages = [];
  const readData = (name) => state[name] ?? [];
  const handlers = createBotHandlers({
    readData,
    writeData: (name, value) => {
      state[name] = value;
    },
    verifyPassword: overrides.verifyPassword || (() => false),
    getBotUsers: () => state.bot_users,
    saveBotUsers: (value) => {
      state.bot_users = value;
    },
    getBotSessions: () => state.bot_sessions,
    saveBotSessions: (value) => {
      state.bot_sessions = value;
    },
    sendMessage: async (target, text, options = {}) => {
      messages.push({ target, text, options });
      return { message: { message_id: `msg-${messages.length}` } };
    },
    deleteMessage: overrides.deleteMessage || (async () => ({ success: true })),
    answerCallback: overrides.answerCallback || (async () => ({ success: true })),
    generateId: (prefix) => `${prefix}-1`,
    idPrefixes: { deliveries: 'DL', repair_part_items: 'RPI', repair_work_items: 'RWI' },
    nowIso: () => '2026-04-24T08:00:00.000Z',
    readServiceTickets: overrides.readServiceTickets || (() => state.service || []),
    writeServiceTickets: overrides.writeServiceTickets || ((tickets) => {
      state.service = tickets;
    }),
    findServiceTicketById: overrides.findServiceTicketById || ((ticketId) =>
      (state.service || []).find(ticket => String(ticket.id).toLowerCase() === String(ticketId).toLowerCase()) || null),
    saveServiceTicket: overrides.saveServiceTicket || ((updatedTicket) => {
      state.service = (state.service || []).map(ticket => ticket.id === updatedTicket.id ? updatedTicket : ticket);
    }),
    appendServiceLog: overrides.appendServiceLog || ((ticket, text, author, type = 'comment') => ({
      ...ticket,
      workLog: [...(ticket.workLog || []), { date: '2026-04-24T08:00:00.000Z', text, author, type }],
    })),
    getMechanicReferenceByUser: () => null,
    syncEquipmentStatusForService: () => {},
    updateServiceTicketStatus: () => null,
    getOpenTicketByEquipment: () => null,
    serviceStatusLabel: (status) => status,
    preferCarrierAutoLogin,
    accessControl: createAccessControl({ readData }),
  });

  return { state, messages, handlers };
}

function createMockResponse() {
  return {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.body = payload;
      return this;
    },
    sendStatus(code) {
      this.statusCode = code;
      this.body = code;
      return this;
    },
  };
}

function setupMechanicRepairWithParts(parts = []) {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    userId: 'U-mechanic',
    userName: 'Дмитрий',
    userRole: 'Механик',
    email: 'mechanic@example.test',
    replyTarget: { user_id: 100, chat_id: null },
  };
  state.service = [{
    id: 'S-1',
    status: 'in_progress',
    equipment: 'Mantall HZ160JRT',
    reason: 'Полная диагностика',
    assignedMechanicName: 'Дмитрий',
    workLog: [],
  }];
  state.bot_sessions['100'] = { activeRepairId: 'S-1' };
  state.spare_parts = parts;
  return { state, messages, handlers };
}

function makePart(index, overrides = {}) {
  return {
    id: `P-${index}`,
    name: `Запчасть ${String(index).padStart(2, '0')}`,
    article: `ART-${String(index).padStart(2, '0')}`,
    sku: `ART-${String(index).padStart(2, '0')}`,
    category: 'Категория',
    manufacturer: 'Skytech',
    defaultPrice: 1000 + index,
    unit: 'шт',
    isActive: true,
    ...overrides,
  };
}

function lastKeyboard(messages) {
  return messages.at(-1)?.options?.attachments?.find((item) => item.type === 'inline_keyboard') || null;
}

function keyboardTexts(keyboardAttachment) {
  return keyboardAttachment?.payload?.buttons?.flat().map((item) => item.text) || [];
}

async function postBotWebhook(handlers, body, options = {}) {
  const routes = {};
  registerBotRoutes({
    post(pathName, handler) {
      routes[pathName] = handler;
    },
  }, {
    handleCommand: handlers.handleCommand,
    handleBotStarted: handlers.handleBotStarted,
    handleCallback: handlers.handleCallback,
    webhookPath: options.webhookPath || '/bot/webhook',
    webhookSecret: options.webhookSecret || '',
    logger: options.logger || { log: () => {}, warn: () => {}, error: () => {} },
  });

  const response = createMockResponse();
  await routes[options.webhookPath || '/bot/webhook']({
    headers: options.headers || {},
    params: options.params || {},
    body,
    ip: '127.0.0.1',
    socket: { remoteAddress: '127.0.0.1' },
  }, response);
  return response;
}

test('regular bot_started keeps an existing non-carrier role menu', async () => {
  const { state, messages, handlers } = createMemoryBot(false);

  await handlers.handleBotStarted({ user_id: 100 }, '100');

  assert.equal(state.bot_users['100'].userRole, 'Менеджер по аренде');
  assert.match(messages.at(-1).text, /Менеджер по аренде/);
  assert.doesNotMatch(messages.at(-1).text, /Здесь вы видите свои доставки/);
});

test('regular bot_started asks for login when user is not authorized', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users = {};

  await handlers.handleBotStarted({ user_id: 100 }, '100');

  assert.equal(state.bot_users['100'], undefined);
  assert.match(messages.at(-1).text, /Добро пожаловать/);
  assert.match(messages.at(-1).text, /Напишите логин/);
  assert.equal(state.bot_sessions['100'].pendingAction, 'login_email');
  const menu = messages.at(-1).options.attachments.find((item) => item.type === 'inline_keyboard');
  assert.equal(menu.payload.buttons[0][0].text, 'Назад');
  assert.equal(menu.payload.buttons[0][1].text, 'Главное меню');
});

test('regular bot_started keeps an existing carrier in delivery mode', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    userId: 'carrier-1',
    userName: 'Быстрая доставка',
    userRole: 'Перевозчик',
    botMode: 'delivery',
    carrierId: 'carrier-1',
    replyTarget: { user_id: 100, chat_id: null },
  };

  await handlers.handleBotStarted({ user_id: 100 }, '100');

  assert.equal(state.bot_users['100'].userRole, 'Перевозчик');
  assert.equal(state.bot_sessions['100'].pendingAction, null);
  assert.match(messages.at(-1).text, /Перевозчик/);
  assert.match(messages.at(-1).text, /доставки/);
});

test('shared bot delivery command asks for login when user is not authorized', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users = {};
  state.deliveries = [{
    id: 'DL-1',
    type: 'shipping',
    status: 'sent',
    transportDate: '2026-04-25',
    origin: 'Склад',
    destination: 'Клиент',
    cargo: 'Подъёмник',
    client: 'ООО Клиент',
    contactName: 'Иван',
    contactPhone: '+7 900 000-00-00',
    comment: 'Позвонить менеджеру за час до прибытия.',
    carrierKey: 'carrier-1',
  }];

  await handlers.handleCommand({ user_id: 100 }, '100', '/доставки');

  assert.equal(state.bot_users['100'], undefined);
  assert.equal(state.bot_sessions['100'].pendingAction, 'login_email');
  assert.match(messages.at(-1).text, /Вы не авторизованы/);
  assert.match(messages.at(-1).text, /Напишите логин/);
});

test('start command returns menu for an authorized manager', async () => {
  const { state, messages, handlers } = createMemoryBot(false);

  await handlers.handleCommand({ user_id: 100 }, '100', '/start');

  assert.equal(state.bot_users['100'].userRole, 'Менеджер по аренде');
  assert.match(messages.at(-1).text, /Менеджер по аренде/);
  const menu = messages.at(-1).options.attachments.find((item) => item.type === 'inline_keyboard');
  assert.equal(menu.payload.buttons[1][1].text, 'Новая доставка');
});

test('regular start returns delivery menu for an authorized carrier session', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    userId: 'carrier-1',
    userName: 'Быстрая доставка',
    userRole: 'Перевозчик',
    carrierId: 'carrier-1',
    replyTarget: { user_id: 100, chat_id: null },
  };

  await handlers.handleCommand({ user_id: 100 }, '100', '/start');

  assert.equal(state.bot_sessions['100'].pendingAction, null);
  assert.match(messages.at(-1).text, /Перевозчик/);
  assert.match(messages.at(-1).text, /доставки/);
});

test('dedicated delivery start returns menu for an authorized carrier', async () => {
  const { state, messages, handlers } = createMemoryBot(true);
  state.bot_users = {};

  await handlers.handleCommand({ user_id: 100 }, '100', '/start');

  assert.equal(state.bot_users['100'].userRole, 'Перевозчик');
  assert.match(messages.at(-1).text, /Перевозчик/);
  const menu = messages.at(-1).options.attachments.find((item) => item.type === 'inline_keyboard');
  assert.equal(menu.payload.buttons[0][0].text, 'Мои доставки');
  assert.equal(menu.payload.buttons[0][1].text, 'Обновить');
});

test('unknown command reports an error before authorization', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users = {};

  await handlers.handleCommand({ user_id: 100 }, '100', '/непонятно');

  assert.equal(state.bot_sessions['100']?.pendingAction, undefined);
  assert.match(messages.at(-1).text, /Неизвестная команда/);
});

test('MAX webhook without configured secret still processes updates in production', async () => {
  const previousNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users = {};

  try {
    const response = await postBotWebhook(handlers, {
      update_type: 'message_created',
      message: {
        body: { text: '/start' },
        sender: { user_id: 200 },
        recipient: { chat_id: 555 },
      },
    });

    assert.equal(response.statusCode, 200);
    assert.match(messages.at(-1).text, /Напишите логин/);
    assert.equal(state.bot_sessions['200']?.pendingAction, 'login_email');
  } finally {
    if (previousNodeEnv === undefined) {
      delete process.env.NODE_ENV;
    } else {
      process.env.NODE_ENV = previousNodeEnv;
    }
  }
});

test('MAX webhook unknown command responds with main menu for authorized user', async () => {
  const { messages, handlers } = createMemoryBot(false);

  const response = await postBotWebhook(handlers, {
    update_type: 'message_created',
    message: {
      body: { text: '/командакоторойнет' },
      sender: { user_id: 100 },
      recipient: { chat_id: 555 },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.match(messages.at(-1).text, /Команда не распознана|Неизвестная команда/);
  assert.ok(messages.at(-1).options.attachments);
});

test('MAX webhook callback action is routed without crashing', async () => {
  const { messages, handlers } = createMemoryBot(false);

  const response = await postBotWebhook(handlers, {
    update_type: 'message_callback',
    callback: {
      callback_id: 'cb-1',
      payload: 'menu:main',
      user_id: 100,
      message: {
        message_id: 'msg-1',
        recipient: { chat_id: 555 },
      },
    },
  });

  assert.equal(response.statusCode, 200);
  assert.ok(messages.length > 0);
  assert.match(messages.at(-1).text, /Менеджер по аренде|Главное меню/);
});

test('MAX update processor accepts camelCase message updates', async () => {
  const calls = [];
  const processor = createBotUpdateProcessor({
    handleCommand: async (...args) => calls.push(args),
    handleBotStarted: async () => {},
    handleCallback: async () => {},
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    webhookPath: '/bot/polling',
  });

  await processor({
    updateType: 'message_created',
    chatId: 555,
    userId: 100,
    messageCreated: {
      message: {
        body: '/start',
        recipient: { chatId: 555 },
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], { chat_id: 555, user_id: 100, prefer_user_id: true });
  assert.equal(calls[0][1], '100');
  assert.equal(calls[0][2], '/start');
});

test('MAX update processor routes callbacks to the user who clicked the button', async () => {
  const calls = [];
  const processor = createBotUpdateProcessor({
    handleCommand: async () => {},
    handleBotStarted: async () => {},
    handleCallback: async (...args) => calls.push(args),
    logger: { log: () => {}, warn: () => {}, error: () => {} },
    webhookPath: '/bot/webhook',
  });

  await processor({
    update_type: 'message_callback',
    callback: {
      callback_id: 'cb-1',
      payload: 'menu:main',
      user: { user_id: 100, name: 'Ришат' },
      message: {
        message_id: 'msg-1',
        sender: { user_id: 999, name: 'Скайтех бот' },
        recipient: { chat_id: 555 },
      },
    },
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0][0], { chat_id: 555, user_id: 100, prefer_user_id: true });
  assert.equal(calls[0][1], '100');
  assert.equal(calls[0][2], 'menu:main');
  assert.deepEqual(calls[0][3], {
    callbackId: 'cb-1',
    messageId: 'msg-1',
    raw: {
      callback_id: 'cb-1',
      payload: 'menu:main',
      user: { user_id: 100, name: 'Ришат' },
      message: {
        message_id: 'msg-1',
        sender: { user_id: 999, name: 'Скайтех бот' },
        recipient: { chat_id: 555 },
      },
    },
  });
});

test('admin bot role switch updates bot mode and clears active flow', () => {
  const result = updateBotConnectionRole(
    {
      '100': {
        userId: 'carrier-1',
        userName: 'Быстрая доставка',
        userRole: 'Перевозчик',
        botMode: 'delivery',
        carrierId: 'carrier-1',
      },
    },
    {
      '100': {
        pendingAction: 'operation_step',
        activeRepairId: 'S-1',
      },
    },
    '100',
    'Механик',
  );

  assert.equal(result.ok, true);
  assert.equal(result.botUsers['100'].userRole, 'Механик');
  assert.equal(result.botUsers['100'].botMode, 'staff');
  assert.equal(result.botUsers['100'].carrierId, undefined);
  assert.equal(result.botSessions['100'], undefined);
});

test('admin bot role switch accepts carrier role alias and marks bot-only carrier fields', () => {
  const result = updateBotConnectionRole(
    {
      '100': {
        userId: 'carrier-1',
        userName: 'Быстрая доставка',
        userRole: 'Менеджер по аренде',
        botMode: 'staff',
      },
    },
    {},
    '100',
    'carrier',
  );

  assert.equal(result.ok, true);
  assert.equal(result.botUsers['100'].userRole, 'Перевозчик');
  assert.equal(result.botUsers['100'].role, 'carrier');
  assert.equal(result.botUsers['100'].botMode, 'delivery');
  assert.equal(result.botUsers['100'].isActive, true);
});

test('admin bot disconnect removes authorization and session', () => {
  const result = disconnectBotConnection(
    {
      '100': {
        userId: 'U-manager',
        userName: 'Руслан',
        userRole: 'Менеджер по аренде',
      },
    },
    {
      '100': {
        pendingAction: 'login_password',
      },
    },
    '100',
  );

  assert.equal(result.ok, true);
  assert.equal(result.botUsers['100'], undefined);
  assert.equal(result.botSessions['100'], undefined);
});

test('shared bot blocks service commands while delivery mode is active', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    userId: 'carrier-1',
    userName: 'Быстрая доставка',
    userRole: 'Перевозчик',
    botMode: 'delivery',
    carrierId: 'carrier-1',
    replyTarget: { user_id: 100, chat_id: null },
  };
  state.service = [{
    id: 'S-1',
    status: 'in_progress',
    equipment: 'Mantall HZ160JRT',
    reason: 'Полная диагностика',
    assignedMechanicName: 'Дмитрий',
  }];

  await handlers.handleCommand({ user_id: 100 }, '100', '/мои заявки');

  assert.match(messages.at(-1).text, /режиме доставки/);
  assert.doesNotMatch(messages.at(-1).text, /Мои сервисные заявки/);
  const menu = messages.at(-1).options.attachments.find((item) => item.type === 'inline_keyboard');
  assert.equal(menu.payload.buttons[0][0].text, 'Войти как сотрудник');
});

test('shared bot blocks stale mechanic callbacks while delivery mode is active', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    userId: 'carrier-1',
    userName: 'Быстрая доставка',
    userRole: 'Перевозчик',
    botMode: 'delivery',
    carrierId: 'carrier-1',
    replyTarget: { user_id: 100, chat_id: null },
  };

  await handlers.handleCallback({ user_id: 100 }, '100', 'menu:new_ticket', { callbackId: 'cb-stale' });

  assert.match(messages.at(-1).text, /режиме доставки/);
  assert.equal(state.bot_sessions['100']?.pendingAction, undefined);
  const menu = messages.at(-1).options.attachments.find((item) => item.type === 'inline_keyboard');
  assert.equal(menu.payload.buttons[0][0].text, 'Войти как сотрудник');
});

test('shared bot blocks delivery commands while staff mode is active', async () => {
  const { state, messages, handlers } = createMemoryBot(false);

  await handlers.handleCommand({ user_id: 100 }, '100', '/доставки');

  assert.equal(state.bot_users['100'].userRole, 'Менеджер по аренде');
  assert.match(messages.at(-1).text, /режиме сотрудника/);
  const menu = messages.at(-1).options.attachments.find((item) => item.type === 'inline_keyboard');
  assert.equal(menu.payload.buttons[0][0].text, 'Перейти в доставку');
});

test('shared bot switch to delivery starts authorization when user is not logged in', async () => {
  const { state, messages, handlers } = createMemoryBot(false);

  await handlers.handleCallback({ user_id: 100 }, '100', 'mode:switch_delivery', { callbackId: 'cb-switch' });

  assert.equal(state.bot_users['100'], undefined);
  assert.equal(state.bot_sessions['100'].pendingAction, 'login_email');
  assert.match(messages.at(-1).text, /Вы не авторизованы/);
  assert.match(messages.at(-1).text, /Напишите логин/);
});

test('manager login flow greets manager with rental manager menu', async () => {
  const { state, messages, handlers } = createMemoryBot(false, {
    verifyPassword: (password, stored) => password === stored,
  });
  state.bot_users = {};
  state.users = [{
    id: 'U-manager',
    name: 'Руслан',
    role: 'Менеджер по аренде',
    email: 'manager@example.test',
    status: 'Активен',
    password: 'secret',
  }];

  await handlers.handleBotStarted({ user_id: 200 }, '200');
  await handlers.handleCallback({ user_id: 200 }, '200', 'auth:start', { callbackId: 'cb-login' });
  await handlers.handleCommand({ user_id: 200 }, '200', 'manager@example.test');
  await handlers.handleCommand({ user_id: 200 }, '200', 'secret');

  assert.match(messages.at(-1).text, /Менеджер по аренде \(Руслан\)/);
  assert.doesNotMatch(messages.at(-1).text, /undefined/);
  assert.equal(state.bot_users['200'].userRole, 'Менеджер по аренде');
  const menu = messages.at(-1).options.attachments.find((item) => item.type === 'inline_keyboard');
  assert.equal(menu.payload.buttons[1][1].text, 'Новая доставка');
});

test('manager free equipment command shows category buttons', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.equipment = [
    { id: 'E-1', status: 'available', inventoryNumber: '026', manufacturer: 'Mantall', model: '1932R', type: 'scissor' },
    { id: 'E-2', status: 'available', inventoryNumber: '027', manufacturer: 'JLG', model: '2632R', type: 'scissor' },
    { id: 'E-3', status: 'available', inventoryNumber: '056', manufacturer: 'Genie', model: 'Z45', type: 'articulated' },
    { id: 'E-4', status: 'rented', inventoryNumber: '999', manufacturer: 'Busy', model: 'Lift', type: 'scissor' },
  ];

  await handlers.handleCommand(100, '100', '/техника');

  const message = messages.at(-1);
  assert.match(message.text, /Свободная техника \(3\)/);
  assert.match(message.text, /Ножничный: 2/);
  assert.match(message.text, /Коленчатый: 1/);
  assert.doesNotMatch(message.text, /026 —/);
  const menu = message.options.attachments.find((item) => item.type === 'inline_keyboard');
  assert.equal(menu.payload.buttons[0][0].text, 'Ножничный · 2');
  assert.equal(menu.payload.buttons[0][0].payload, 'equipmentcat:0:0');
  assert.match(messages[0].options.attachments[0].payload.file, /manager-stages\/equipment-optimistic\.jpg$/);
});

test('manager free equipment category opens paged equipment list', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.equipment = Array.from({ length: 10 }, (_, index) => ({
    id: `E-${index + 1}`,
    status: 'available',
    inventoryNumber: String(index + 1).padStart(3, '0'),
    manufacturer: 'Mantall',
    model: `XE${index + 1}`,
    type: 'scissor',
  }));

  await handlers.handleCallback(100, '100', 'equipmentcat:0:0');

  const firstPage = messages.at(-1);
  assert.match(firstPage.text, /Ножничный: свободно 10/);
  assert.match(firstPage.text, /Страница 1 из 2/);
  assert.match(firstPage.text, /001 · Mantall XE1/);
  assert.doesNotMatch(firstPage.text, /009 · Mantall XE9/);
  const firstPageMenu = firstPage.options.attachments.find((item) => item.type === 'inline_keyboard');
  assert.ok(firstPageMenu.payload.buttons.some(row => row.some(item => item.payload === 'equipmentcat:0:1')));

  await handlers.handleCallback(100, '100', 'equipmentcat:0:1');

  const secondPage = messages.at(-1);
  assert.match(secondPage.text, /Страница 2 из 2/);
  assert.match(secondPage.text, /009 · Mantall XE9/);
});

test('dedicated delivery bot_started prefers linked carrier role', async () => {
  const { state, messages, handlers } = createMemoryBot(true);

  await handlers.handleBotStarted({ user_id: 100 }, '100');

  assert.equal(state.bot_users['100'].userRole, 'Перевозчик');
  assert.equal(state.bot_users['100'].carrierId, 'carrier-1');
  assert.match(messages.at(-1).text, /Перевозчик/);
  assert.match(messages.at(-1).text, /доставки/);
  assert.equal(messages.length, 2);
  assert.match(messages[0].options.attachments[0].payload.file, /delivery-stages\/main-menu-optimistic\.jpg$/);
});

test('dedicated delivery bot explains missing MAX carrier link', async () => {
  const { state, messages, handlers } = createMemoryBot(true);
  state.delivery_carriers = [];

  await handlers.handleBotStarted({ user_id: 100 }, '100');

  assert.equal(state.bot_users['100'].userRole, 'Менеджер по аренде');
  assert.equal(messages.length, 2);
  assert.match(messages.at(-1).text, /не привязан к перевозчику/);
  assert.match(messages[0].options.attachments[0].payload.file, /delivery-stages\/main-menu-optimistic\.jpg$/);
  assert.equal(messages.at(-1).options.attachments[0].type, 'inline_keyboard');
});

test('carrier system user login links MAX user to delivery carrier', async () => {
  const { state, messages, handlers } = createMemoryBot(true, {
    verifyPassword: (plain, stored) => plain === stored,
  });
  state.bot_users = {};
  state.delivery_carriers = [{
    id: 'carrier-1',
    name: 'Быстрая доставка',
    status: 'active',
    systemUserId: 'U-carrier',
  }];
  state.users = [{
    id: 'U-carrier',
    name: 'Водитель перевозчика',
    email: 'carrier@example.test',
    role: 'Перевозчик',
    status: 'Активен',
    password: 'secret',
  }];

  await handlers.handleCallback({ user_id: 555 }, '555', 'auth:start', { callbackId: 'cb-1' });
  await handlers.handleCommand({ user_id: 555 }, '555', 'carrier@example.test');
  await handlers.handleCommand({ user_id: 555 }, '555', 'secret');

  assert.equal(state.bot_users['555'].userRole, 'Перевозчик');
  assert.equal(state.bot_users['555'].role, 'carrier');
  assert.equal(state.bot_users['555'].botMode, 'delivery');
  assert.equal(state.bot_users['555'].carrierId, 'carrier-1');
  assert.equal(state.bot_users['555'].userId, 'U-carrier');
  assert.equal(state.delivery_carriers[0].maxCarrierKey, '555');
  assert.equal(state.users[0].botOnly, true);
  assert.equal(state.users[0].carrierId, 'carrier-1');
  assert.match(messages.at(-1).text, /Перевозчик/);
});

test('carrier system user login creates missing carrier record', async () => {
  const { state, messages, handlers } = createMemoryBot(true, {
    verifyPassword: (plain, stored) => plain === stored,
  });
  state.bot_users = {};
  state.delivery_carriers = [];
  state.users = [{
    id: 'U-carrier-missing',
    name: 'Тестовый перевозчик',
    email: '123@yandex.ru',
    role: 'Перевозчик',
    status: 'Активен',
    password: 'qweqwe',
  }];

  await handlers.handleCallback({ user_id: 777 }, '777', 'auth:start', { callbackId: 'cb-1' });
  await handlers.handleCommand({ user_id: 777 }, '777', '123@yandex.ru');
  await handlers.handleCommand({ user_id: 777 }, '777', 'qweqwe');

  assert.equal(state.bot_users['777'].userRole, 'Перевозчик');
  assert.equal(state.bot_users['777'].carrierId, 'U-carrier-missing');
  assert.equal(state.delivery_carriers.length, 1);
  assert.equal(state.delivery_carriers[0].id, 'U-carrier-missing');
  assert.equal(state.delivery_carriers[0].systemUserId, 'U-carrier-missing');
  assert.equal(state.delivery_carriers[0].maxCarrierKey, '777');
  assert.equal(state.users[0].botOnly, true);
  assert.equal(state.users[0].carrierId, 'U-carrier-missing');
  assert.match(messages.at(-1).text, /Перевозчик/);
});

test('dedicated delivery bot does not reuse an existing mechanic menu', async () => {
  const { state, messages, handlers } = createMemoryBot(true);
  state.delivery_carriers = [];
  state.bot_users['100'] = {
    userId: 'U-mechanic',
    userName: 'Дмитрий',
    userRole: 'Механик',
    email: 'mechanic@example.test',
    replyTarget: { user_id: 100, chat_id: null },
  };

  await handlers.handleCommand({ user_id: 100 }, '100', '/меню');

  assert.equal(messages.length, 2);
  assert.match(messages[0].options.attachments[0].payload.file, /delivery-stages\/main-menu-optimistic\.jpg$/);
  assert.match(messages.at(-1).text, /не привязан к перевозчику/);
  assert.equal(messages.at(-1).options.attachments[0].payload.buttons[0][0].text, 'Мои доставки');
});

test('dedicated delivery bot ignores stale mechanic callbacks', async () => {
  const { state, messages, handlers } = createMemoryBot(true);
  state.delivery_carriers = [];
  state.bot_users['100'] = {
    userId: 'U-mechanic',
    userName: 'Дмитрий',
    userRole: 'Механик',
    email: 'mechanic@example.test',
    replyTarget: { user_id: 100, chat_id: null },
  };

  await handlers.handleCallback({ user_id: 100 }, '100', 'menu:new_ticket', { callbackId: 'cb-1' });

  assert.equal(messages.length, 2);
  assert.match(messages[0].options.attachments[0].payload.file, /delivery-stages\/main-menu-optimistic\.jpg$/);
  assert.match(messages.at(-1).text, /не привязан к перевозчику/);
  assert.equal(messages.at(-1).options.attachments[0].payload.buttons[0][0].text, 'Мои доставки');
});

test('mechanic main navigation sends friendly stage image', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    ...state.bot_users['100'],
    userName: 'Дмитрий',
    userRole: 'Механик',
  };

  await handlers.handleBotStarted({ user_id: 100 }, '100');

  assert.equal(messages.length, 2);
  assert.equal(messages[0].text, '');
  const imageAttachments = messages[0].options.attachments;
  const menuAttachments = messages[1].options.attachments;
  assert.equal(imageAttachments[0].type, 'image');
  assert.match(imageAttachments[0].payload.file, /main-menu-optimistic\.jpg$/);
  assert.doesNotMatch(imageAttachments[0].payload.file, /skytech-logo/);
  assert.equal(menuAttachments[0].type, 'inline_keyboard');
});

test('mechanic my repairs command accepts spaced slash alias', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    userId: 'U-mechanic',
    userName: 'Дмитрий',
    userRole: 'Механик',
    email: 'mechanic@example.test',
    replyTarget: { user_id: 100, chat_id: null },
  };
  state.service = [{
    id: 'S-1',
    status: 'in_progress',
    equipment: 'Mantall HZ160JRT',
    reason: 'Полная диагностика',
    assignedMechanicName: 'Дмитрий',
  }];

  await handlers.handleCommand({ user_id: 100 }, '100', '/мои заявки');

  assert.match(messages.at(-1).text, /Мои сервисные заявки \(1\)/);
  assert.match(messages.at(-1).text, /S-1/);
  assert.doesNotMatch(messages.at(-1).text, /Неизвестная команда/);
});

test('mechanic new ticket search opens equipment action menu before repair reason', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    userId: 'U-mechanic',
    userName: 'Дмитрий',
    userRole: 'Механик',
    email: 'mechanic@example.test',
    replyTarget: { user_id: 100, chat_id: null },
  };
  state.equipment = [{
    id: 'EQ-1',
    inventoryNumber: '083',
    serialNumber: 'SN-083',
    manufacturer: 'Mantall',
    model: 'HZ160JRT',
    type: 'scissor',
    status: 'available',
  }];

  await handlers.handleCommand({ user_id: 100 }, '100', '/новаязаявка');
  await handlers.handleCommand({ user_id: 100 }, '100', '083');
  await handlers.handleCallback({ user_id: 100 }, '100', 'equipment:choose:EQ-1', { callbackId: 'cb-1' });

  assert.equal(state.bot_sessions['100'].pendingAction, 'equipment_action_menu');
  assert.doesNotMatch(messages.at(-1).text, /Напишите причину/);
  assert.match(messages.at(-1).text, /Выберите действие/);
  const menu = messages.at(-1).options.attachments.find((item) => item.type === 'inline_keyboard');
  const buttonTexts = menu.payload.buttons.flat().map((item) => item.text);
  assert.deepEqual(buttonTexts.slice(1, 5), ['Ремонт', 'ТО', 'ЧТО', 'ПТО']);
});

test('mechanic parts menu shows first page from spare_parts and pagination', async () => {
  const parts = Array.from({ length: 12 }, (_, index) => makePart(index + 1));
  parts.push(
    makePart(99, { id: 'P-inactive', name: 'Скрытая запчасть', isActive: false }),
    makePart(100, { id: 'P-1', name: 'Дубликат запчасти' }),
    makePart(101, { id: 'P-empty', name: '' }),
  );
  const { state, messages, handlers } = setupMechanicRepairWithParts(parts);

  await handlers.handleCallback({ user_id: 100 }, '100', 'menu:parts', { callbackId: 'cb-1' });

  assert.equal(state.bot_sessions['100'].pendingAction, 'part_pick');
  assert.equal(state.bot_sessions['100'].lastPartSearch.length, 10);
  assert.match(messages.at(-1).text, /Запчасти из справочника/);
  assert.match(messages.at(-1).text, /Показаны 1-10 из 12/);
  assert.match(messages.at(-1).text, /Запчасть 01/);
  assert.match(messages.at(-1).text, /Запчасть 10/);
  assert.doesNotMatch(messages.at(-1).text, /Запчасть 11/);
  assert.doesNotMatch(messages.at(-1).text, /Скрытая запчасть/);
  assert.doesNotMatch(messages.at(-1).text, /Дубликат запчасти/);
  assert.ok(keyboardTexts(lastKeyboard(messages)).includes('Следующие 10'));
});

test('mechanic parts pagination opens next and previous pages', async () => {
  const { state, messages, handlers } = setupMechanicRepairWithParts(
    Array.from({ length: 12 }, (_, index) => makePart(index + 1)),
  );

  await handlers.handleCallback({ user_id: 100 }, '100', 'menu:parts', { callbackId: 'cb-1' });
  await handlers.handleCallback({ user_id: 100 }, '100', 'part:page:1', { callbackId: 'cb-2' });

  assert.match(messages.at(-1).text, /Показаны 11-12 из 12/);
  assert.match(messages.at(-1).text, /Запчасть 11/);
  assert.match(messages.at(-1).text, /Запчасть 12/);
  assert.deepEqual(state.bot_sessions['100'].lastPartSearch.map((item) => item.id), ['P-11', 'P-12']);
  let texts = keyboardTexts(lastKeyboard(messages));
  assert.ok(texts.includes('Предыдущие 10'));
  assert.ok(!texts.includes('Следующие 10'));

  await handlers.handleCallback({ user_id: 100 }, '100', 'part:page:0', { callbackId: 'cb-3' });

  assert.match(messages.at(-1).text, /Показаны 1-10 из 12/);
  texts = keyboardTexts(lastKeyboard(messages));
  assert.ok(texts.includes('Следующие 10'));
});

test('mechanic can add part by absolute number from a later page', async () => {
  const { state, messages, handlers } = setupMechanicRepairWithParts(
    Array.from({ length: 12 }, (_, index) => makePart(index + 1)),
  );

  await handlers.handleCallback({ user_id: 100 }, '100', 'menu:parts', { callbackId: 'cb-1' });
  await handlers.handleCallback({ user_id: 100 }, '100', 'part:page:1', { callbackId: 'cb-2' });
  await handlers.handleCommand({ user_id: 100 }, '100', '11 1');

  assert.equal(state.repair_part_items.length, 1);
  assert.equal(state.repair_part_items[0].partId, 'P-11');
  assert.match(messages.at(-1).text, /Добавлена запчасть: Запчасть 11 × 1/);
});

test('mechanic parts search finds item outside first page', async () => {
  const parts = Array.from({ length: 12 }, (_, index) => makePart(index + 1));
  parts[11] = makePart(12, { name: 'Редкий гидрофильтр', article: 'RARE-12' });
  const { state, messages, handlers } = setupMechanicRepairWithParts(parts);

  await handlers.handleCommand({ user_id: 100 }, '100', '/запчасти редкий');

  assert.equal(state.bot_sessions['100'].pendingAction, 'part_pick');
  assert.deepEqual(state.bot_sessions['100'].lastPartSearch.map((item) => item.id), ['P-12']);
  assert.match(messages.at(-1).text, /Редкий гидрофильтр/);
  assert.ok(!keyboardTexts(lastKeyboard(messages)).includes('Следующие 10'));
});

test('mechanic parts search works by name', async () => {
  const { messages, handlers } = setupMechanicRepairWithParts([
    makePart(1, { name: 'Фильтр масляный', article: 'F-100' }),
    makePart(2, { name: 'Джойстик управления', article: 'J-200' }),
  ]);

  await handlers.handleCommand({ user_id: 100 }, '100', '/запчасти масляный');

  assert.match(messages.at(-1).text, /Фильтр масляный/);
  assert.doesNotMatch(messages.at(-1).text, /Джойстик управления/);
});

test('mechanic parts search works by article with punctuation-insensitive query', async () => {
  const { messages, handlers } = setupMechanicRepairWithParts([
    makePart(1, { name: 'Плата контроллера', article: 'ZX-999' }),
    makePart(2, { name: 'Колесо ведущее', article: 'W-200' }),
  ]);

  await handlers.handleCommand({ user_id: 100 }, '100', '/запчасти zx999');

  assert.match(messages.at(-1).text, /Плата контроллера/);
  assert.match(messages.at(-1).text, /ZX-999/);
  assert.doesNotMatch(messages.at(-1).text, /Колесо ведущее/);
});

test('mechanic sees part without category when it has a name', async () => {
  const { messages, handlers } = setupMechanicRepairWithParts([
    makePart(1, { name: 'Реле стартера', article: 'REL-1', category: '' }),
  ]);

  await handlers.handleCommand({ user_id: 100 }, '100', '/запчасти реле');

  assert.match(messages.at(-1).text, /Реле стартера/);
});

test('new spare part appears in bot without restart', async () => {
  const { state, messages, handlers } = setupMechanicRepairWithParts([
    makePart(1, { name: 'Старый фильтр', article: 'OLD-1' }),
  ]);

  await handlers.handleCommand({ user_id: 100 }, '100', '/запчасти новый');
  assert.match(messages.at(-1).text, /По вашему запросу запчасти не найдены/);

  state.spare_parts.push(makePart(2, { name: 'Новый датчик наклона', article: 'NEW-2' }));
  await handlers.handleCommand({ user_id: 100 }, '100', '/запчасти new-2');

  assert.match(messages.at(-1).text, /Новый датчик наклона/);
});

test('mechanic can add selected spare part to service ticket', async () => {
  const { state, messages, handlers } = setupMechanicRepairWithParts([
    makePart(1, { name: 'Фильтр масляный', article: 'F-100', defaultPrice: 1200 }),
  ]);

  await handlers.handleCommand({ user_id: 100 }, '100', '/запчасти фильтр');
  await handlers.handleCallback({ user_id: 100 }, '100', 'part:choose:P-1', { callbackId: 'cb-1' });
  await handlers.handleCallback({ user_id: 100 }, '100', 'qty:part:2', { callbackId: 'cb-2' });

  assert.equal(state.repair_part_items.length, 1);
  assert.equal(state.repair_part_items[0].repairId, 'S-1');
  assert.equal(state.repair_part_items[0].partId, 'P-1');
  assert.equal(state.repair_part_items[0].quantity, 2);
  assert.match(messages.at(-1).text, /Добавлена запчасть: Фильтр масляный × 2/);
});

test('mechanic parts menu explains empty catalog', async () => {
  const { state, messages, handlers } = setupMechanicRepairWithParts([]);

  await handlers.handleCommand({ user_id: 100 }, '100', '/запчасти');

  assert.equal(state.bot_sessions['100'].lastPartSearch.length, 0);
  assert.match(messages.at(-1).text, /Запчасти не найдены. Проверьте справочник запчастей в системе/);
});

test('mechanic parts search with several similar matches asks to choose', async () => {
  const { state, messages, handlers } = setupMechanicRepairWithParts([
    makePart(1, { name: 'Фильтр масляный', article: 'F-100' }),
    makePart(2, { name: 'Фильтр воздушный', article: 'F-200' }),
    makePart(3, { name: 'Колесо ведущее', article: 'W-300' }),
  ]);

  await handlers.handleCommand({ user_id: 100 }, '100', '/запчасти фильтр');

  assert.equal(state.bot_sessions['100'].pendingAction, 'part_pick');
  assert.deepEqual(state.bot_sessions['100'].lastPartSearch.map((item) => item.id), ['P-1', 'P-2']);
  assert.match(messages.at(-1).text, /Фильтр масляный/);
  assert.match(messages.at(-1).text, /Фильтр воздушный/);
  assert.doesNotMatch(messages.at(-1).text, /Колесо ведущее/);
  const texts = keyboardTexts(lastKeyboard(messages));
  assert.ok(texts.includes('1. Фильтр масляный'));
  assert.ok(texts.includes('2. Фильтр воздушный'));
});

test('delivery menu shows image and status buttons for carrier', async () => {
  const { state, messages, handlers } = createMemoryBot(true);
  state.bot_users['100'] = {
    userId: 'carrier-1',
    userName: 'Быстрая доставка',
    userRole: 'Перевозчик',
    carrierId: 'carrier-1',
    replyTarget: { user_id: 100, chat_id: null },
  };
  state.deliveries = [{
    id: 'DL-1',
    type: 'shipping',
    status: 'sent',
    transportDate: '2026-04-25',
    origin: 'Склад',
    destination: 'Клиент',
    cargo: 'Подъёмник',
    client: 'ООО Клиент',
    contactName: 'Иван',
    contactPhone: '+7 900 000-00-00',
    comment: 'Позвонить менеджеру за час до прибытия.',
    carrierKey: 'carrier-1',
  }];

  await handlers.handleCommand({ user_id: 100 }, '100', '/доставки');

  assert.equal(messages.length, 2);
  assert.match(messages[0].options.attachments[0].payload.file, /delivery-stages\/delivery-list-optimistic\.jpg$/);
  assert.match(messages[1].text, /Мои доставки/);
  assert.match(messages[1].text, /Комментарий менеджера: Позвонить менеджеру за час до прибытия\./);
  assert.deepEqual(messages[1].options.attachments[0].payload.buttons[0][0], {
    type: 'callback',
    text: 'Принять доставку',
    payload: 'delivery:status:DL-1:accepted',
  });
});

test('delivery menu hides completed deliveries for carrier', async () => {
  const { state, messages, handlers } = createMemoryBot(true);
  state.bot_users['100'] = {
    userId: 'carrier-1',
    userName: 'Быстрая доставка',
    userRole: 'Перевозчик',
    carrierId: 'carrier-1',
    replyTarget: { user_id: 100, chat_id: null },
  };
  state.deliveries = [
    {
      id: 'DL-active',
      type: 'shipping',
      status: 'sent',
      transportDate: '2026-04-25',
      origin: 'Новая база',
      destination: 'Портовая',
      cargo: 'Mantall XE120W',
      client: 'ООО Актив',
      contactName: 'Иван',
      contactPhone: '+7 900 000-00-00',
      carrierKey: 'carrier-1',
    },
    {
      id: 'DL-done',
      type: 'shipping',
      status: 'completed',
      transportDate: '2026-04-26',
      origin: 'Склад',
      destination: 'Клиент',
      cargo: 'Mantall XE140W',
      client: 'ООО Выполнено',
      contactName: 'Петр',
      contactPhone: '+7 900 111-11-11',
      carrierKey: 'carrier-1',
    },
  ];

  await handlers.handleCommand({ user_id: 100 }, '100', '/доставки');

  assert.match(messages[1].text, /Мои доставки \(1\)/);
  assert.match(messages[1].text, /Mantall XE120W/);
  assert.doesNotMatch(messages[1].text, /Mantall XE140W/);
  assert.doesNotMatch(messages[1].text, /Выполнена/);
  assert.deepEqual(messages[1].options.attachments[0].payload.buttons[0][0], {
    type: 'callback',
    text: 'Принять доставку',
    payload: 'delivery:status:DL-active:accepted',
  });
});

test('carrier sees only assigned deliveries without client or financial fields', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    userId: 'carrier-1',
    userName: 'Быстрая доставка',
    userRole: 'Перевозчик',
    role: 'carrier',
    botMode: 'delivery',
    isActive: true,
    carrierId: 'carrier-1',
    replyTarget: { user_id: 100, chat_id: null },
  };
  state.deliveries = [
    {
      id: 'DL-own',
      type: 'shipping',
      status: 'sent',
      transportDate: '2026-04-25',
      neededBy: '2026-04-26',
      origin: 'Склад',
      destination: 'Точка монтажа',
      cargo: 'Mantall XE120W',
      client: 'ООО Секретный клиент',
      clientName: 'ООО Секретный клиент',
      clientId: 'C-secret',
      rentalId: 'R-secret',
      ganttRentalId: 'GR-secret',
      cost: 987654321,
      amount: 7654321,
      debt: 1234567,
      margin: 555555,
      contactName: 'Иван',
      contactPhone: '+7 900 000-00-00',
      comment: 'Передать комплект закрывающих документов.',
      carrierId: 'carrier-1',
      carrierKey: 'carrier-1',
    },
    {
      id: 'DL-other',
      type: 'shipping',
      status: 'sent',
      transportDate: '2026-04-25',
      origin: 'Чужой склад',
      destination: 'Чужая точка',
      cargo: 'JLG 1930ES',
      client: 'ООО Чужой клиент',
      clientId: 'C-other',
      contactName: 'Петр',
      contactPhone: '+7 900 111-11-11',
      carrierId: 'carrier-2',
      carrierKey: 'carrier-2',
    },
  ];

  await handlers.handleCommand({ user_id: 100 }, '100', '/доставки');

  const text = messages.at(-1).text;
  assert.match(text, /Мои доставки \(1\)/);
  assert.match(text, /Mantall XE120W/);
  assert.doesNotMatch(text, /JLG 1930ES/);
  assert.doesNotMatch(text, /Секретный клиент|Чужой клиент|C-secret|R-secret|GR-secret/);
  assert.doesNotMatch(text, /987654321|7654321|1234567|555555/);
  assert.match(text, /Комментарий менеджера: Передать комплект закрывающих документов\./);

  const dto = toCarrierDeliveryDto(state.deliveries[0]);
  assert.equal(dto.driverComment, 'Передать комплект закрывающих документов.');
  assert.equal('client' in dto, false);
  assert.equal('clientName' in dto, false);
  assert.equal('clientId' in dto, false);
  assert.equal('rentalId' in dto, false);
  assert.equal('cost' in dto, false);
  assert.equal('amount' in dto, false);
  assert.equal('debt' in dto, false);
  assert.equal('margin' in dto, false);
});

test('carrier status callback checks role, carrierId and writes bot activity audit', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    userId: 'carrier-1',
    userName: 'Быстрая доставка',
    userRole: 'Перевозчик',
    role: 'carrier',
    botMode: 'delivery',
    isActive: true,
    carrierId: 'carrier-1',
    maxUserId: 100,
    replyTarget: { user_id: 100, chat_id: null },
  };
  state.deliveries = [{
    id: 'DL-1',
    type: 'shipping',
    status: 'sent',
    transportDate: '2026-04-25',
    origin: 'Склад',
    destination: 'Точка',
    cargo: 'Mantall XE120W',
    client: 'ООО Клиент',
    clientId: 'C-1',
    contactName: 'Иван',
    contactPhone: '+7',
    carrierId: 'carrier-1',
    carrierKey: 'carrier-1',
  }];

  await handlers.handleCallback({ user_id: 100 }, '100', 'delivery:status:DL-1:accepted');

  assert.equal(state.deliveries[0].status, 'accepted');
  assert.doesNotMatch(messages.at(-1).text, /ООО Клиент|C-1/);
  const audit = state.bot_activity.find(item => item.action === 'carrier.delivery_status');
  assert.ok(audit);
  assert.equal(audit.carrierId, 'carrier-1');
  assert.equal(audit.maxUserId, 100);
  assert.equal(audit.deliveryId, 'DL-1');
  assert.equal(audit.oldStatus, 'sent');
  assert.equal(audit.newStatus, 'accepted');
  assert.equal(audit.timestamp, '2026-04-24T08:00:00.000Z');
});

test('employee with another role cannot perform carrier delivery callback', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.deliveries = [{
    id: 'DL-1',
    type: 'shipping',
    status: 'sent',
    transportDate: '2026-04-25',
    origin: 'Склад',
    destination: 'Точка',
    cargo: 'Mantall XE120W',
    contactName: 'Иван',
    contactPhone: '+7',
    carrierId: 'carrier-1',
    carrierKey: 'carrier-1',
  }];

  await handlers.handleCallback({ user_id: 100 }, '100', 'delivery:status:DL-1:accepted');

  assert.equal(state.deliveries[0].status, 'sent');
  assert.equal(messages.at(-1).text, 'Эта доставка вам недоступна или уже закрыта.');
});

test('carrier without carrierId does not receive deliveries', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    userId: 'carrier-legacy',
    userName: 'Без привязки',
    userRole: 'Перевозчик',
    role: 'carrier',
    botMode: 'delivery',
    isActive: true,
    replyTarget: { user_id: 100, chat_id: null },
  };
  state.deliveries = [{
    id: 'DL-1',
    type: 'shipping',
    status: 'sent',
    transportDate: '2026-04-25',
    origin: 'Склад',
    destination: 'Точка',
    cargo: 'Mantall XE120W',
    contactName: 'Иван',
    contactPhone: '+7',
    carrierId: 'carrier-1',
    carrierKey: 'carrier-1',
  }];

  await handlers.handleCommand({ user_id: 100 }, '100', '/доставки');

  assert.match(messages.at(-1).text, /нет активных доставок/);
  assert.doesNotMatch(messages.at(-1).text, /Mantall XE120W/);
});

test('MAX callback notification is sent as a string', async () => {
  const requests = [];
  const client = createMaxApiClient({
    botToken: 'token',
    maxApiBase: 'https://platform-api.example',
    fetchImpl: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return { json: async () => ({ success: true }) };
    },
  });

  await client.answerCallback('callback-1', { notification: { text: 'Статус обновлён' } });

  assert.equal(requests.length, 1);
  assert.equal(requests[0].body.notification, 'Статус обновлён');
});

test('mechanic stage image is prepended to bot keyboard attachments', () => {
  const attachments = attachMechanicStageImage('field_trip', [{ type: 'inline_keyboard', payload: { buttons: [] } }]);

  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].type, 'image');
  assert.match(attachments[0].payload.file, /field-trip-optimistic\.jpg$/);
  assert.equal(fs.existsSync(attachments[0].payload.file), true);
  assert.equal(attachments[1].type, 'inline_keyboard');
});

test('delivery bot uses delivery-specific stage images', () => {
  const attachments = attachMechanicStageImage('delivery_main', [{ type: 'inline_keyboard', payload: { buttons: [] } }]);

  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].type, 'image');
  assert.match(attachments[0].payload.file, /delivery-stages\/main-menu-optimistic\.jpg$/);
  assert.equal(attachments[0].payload.publicPath, '/bot-assets/delivery-stages/main-menu-optimistic.jpg');
  assert.equal(attachments[0].payload.cacheKey, `delivery-stage:delivery_main:${BOT_STAGE_IMAGE_VERSION}`);
  assert.equal(fs.existsSync(attachments[0].payload.file), true);
  assert.equal(attachments[1].type, 'inline_keyboard');
});

test('rental manager bot uses manager-specific stage images', () => {
  const attachments = attachMechanicStageImage('manager_summary', [{ type: 'inline_keyboard', payload: { buttons: [] } }]);

  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].type, 'image');
  assert.equal(MANAGER_STAGE_IMAGES.manager_summary, 'summary-optimistic.jpg');
  assert.match(attachments[0].payload.file, /manager-stages\/summary-optimistic\.jpg$/);
  assert.equal(attachments[0].payload.publicPath, '/bot-assets/manager-stages/summary-optimistic.jpg');
  assert.equal(attachments[0].payload.cacheKey, `manager-stage:manager_summary:${BOT_STAGE_IMAGE_VERSION}`);
  assert.equal(fs.existsSync(attachments[0].payload.file), true);
  assert.equal(attachments[1].type, 'inline_keyboard');
});

test('bot brand logo is prepended to bot keyboard attachments', () => {
  const attachments = attachBotBrandImage([{ type: 'inline_keyboard', payload: { buttons: [] } }]);

  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].type, 'image');
  assert.match(attachments[0].payload.file, /skytech-logo\.png$/);
  assert.equal(fs.existsSync(attachments[0].payload.file), true);
  assert.equal(attachments[1].type, 'inline_keyboard');
});

test('MAX sendMessage uploads local image attachments before sending', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'max-stage-image-'));
  const imagePath = path.join(tmpDir, 'stage.jpg');
  fs.writeFileSync(imagePath, Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  const requests = [];

  try {
    const client = createMaxApiClient({
      botToken: 'token',
      maxApiBase: 'https://platform-api.example',
      fetchImpl: async (url, options) => {
        requests.push({ url, options });
        if (url === 'https://platform-api.example/uploads?type=image') {
          return { json: async () => ({ url: 'https://upload.example/stage' }) };
        }
        if (url === 'https://upload.example/stage') {
          assert.equal(options.method, 'POST');
          assert.match(options.headers['Content-Type'], /^multipart\/form-data; boundary=/);
          assert.equal(Buffer.isBuffer(options.body), true);
          return { json: async () => ({ token: 'stage-token' }) };
        }
        return { json: async () => ({ success: true }) };
      },
      logger: { log: () => {}, warn: () => {}, error: () => {} },
      useNativeUpload: false,
    });

    await client.sendMessage({ user_id: 100 }, 'Этап', {
      attachments: [
        { type: 'image', payload: { file: imagePath } },
        { type: 'inline_keyboard', payload: { buttons: [] } },
      ],
    });

    assert.equal(requests.length, 3);
    const messageBody = JSON.parse(requests[2].options.body);
    assert.deepEqual(messageBody.attachments, [
      { type: 'image', payload: { token: 'stage-token' } },
      { type: 'inline_keyboard', payload: { buttons: [] } },
    ]);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
});

test('MAX sendMessage can use public URL for bot stage images', async () => {
  const requests = [];
  const client = createMaxApiClient({
    botToken: 'token',
    maxApiBase: 'https://platform-api.example',
    webhookUrl: 'https://bot.example',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { json: async () => ({ success: true }) };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  await client.sendMessage({ user_id: 100 }, '', {
    attachments: [attachMechanicStageImage('main', [])[0]],
  });

  assert.equal(requests.length, 1);
  const messageBody = JSON.parse(requests[0].options.body);
  assert.deepEqual(messageBody.attachments, [
    {
      type: 'image',
      payload: { url: 'https://bot.example/bot-assets/mechanic-stages/main-menu-optimistic.jpg' },
    },
  ]);
});

test('MAX sendMessage keeps chat_id errors in the current bot chat by default', async () => {
  const requests = [];
  const client = createMaxApiClient({
    botToken: 'token',
    maxApiBase: 'https://platform-api.example',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.includes('chat_id=399385588')) {
        return { json: async () => ({ code: 'chat.not.found', message: 'Chat 399385588 not found' }) };
      }
      return { json: async () => ({ success: true, message_id: 'msg-1' }) };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  const result = await client.sendMessage({ chat_id: 399385588, user_id: 123946038 }, 'Проверка');

  assert.equal(result.code, 'chat.not.found');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /chat_id=399385588/);
});

test('MAX sendMessage can prefer user_id for private bot updates', async () => {
  const requests = [];
  const client = createMaxApiClient({
    botToken: 'token',
    maxApiBase: 'https://platform-api.example',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return { json: async () => ({ success: true, message_id: 'msg-1' }) };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  const result = await client.sendMessage({
    chat_id: 399385588,
    user_id: 123946038,
    prefer_user_id: true,
  }, 'Проверка');

  assert.equal(result.success, true);
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /user_id=123946038/);
  assert.doesNotMatch(requests[0].url, /chat_id=399385588/);
});

test('MAX sendMessage can explicitly fallback to user_id when chat_id is not found', async () => {
  const requests = [];
  const client = createMaxApiClient({
    botToken: 'token',
    maxApiBase: 'https://platform-api.example',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (url.includes('chat_id=399385588')) {
        return { json: async () => ({ code: 'chat.not.found', message: 'Chat 399385588 not found' }) };
      }
      return { json: async () => ({ success: true, message_id: 'msg-1' }) };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  const result = await client.sendMessage(
    { chat_id: 399385588, user_id: 123946038 },
    'Проверка',
    { fallbackToUserIdOnChatNotFound: true },
  );

  assert.equal(result.success, true);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /chat_id=399385588/);
  assert.match(requests[1].url, /user_id=123946038/);
});

test('MAX webhook ensure registers when subscription is missing', async () => {
  const requests = [];
  const client = createMaxApiClient({
    botToken: 'token',
    maxApiBase: 'https://platform-api.example',
    webhookUrl: 'https://app.example',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      if (options.method === 'GET') {
        return { json: async () => ({ subscriptions: [] }) };
      }
      return { json: async () => ({ success: true }) };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  const result = await client.ensureWebhookRegistered();

  assert.equal(result.success, true);
  assert.equal(requests.length, 2);
  assert.match(requests[0].url, /\/subscriptions$/);
  assert.equal(requests[0].options.method, 'GET');
  assert.match(requests[1].url, /\/subscriptions$/);
  assert.equal(requests[1].options.method, 'POST');
  assert.deepEqual(JSON.parse(requests[1].options.body), {
    url: 'https://app.example/bot/webhook',
    update_types: ['message_created', 'bot_started', 'message_callback'],
  });
});

test('MAX webhook ensure keeps existing subscription', async () => {
  const requests = [];
  const client = createMaxApiClient({
    botToken: 'token',
    maxApiBase: 'https://platform-api.example',
    webhookUrl: 'https://app.example',
    fetchImpl: async (url, options) => {
      requests.push({ url, options });
      return {
        json: async () => ({
          subscriptions: [{ url: 'https://app.example/bot/webhook' }],
        }),
      };
    },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  const result = await client.ensureWebhookRegistered();

  assert.deepEqual(result, { url: 'https://app.example/bot/webhook' });
  assert.equal(requests.length, 1);
  assert.equal(requests[0].options.method, 'GET');
});

test('bot callback sends the new message before slow cleanup finishes', async () => {
  let deleteStarted = false;
  let answerStarted = false;
  const never = new Promise(() => {});
  const { state, messages, handlers } = createMemoryBot(false, {
    answerCallback: async () => {
      answerStarted = true;
      return never;
    },
    deleteMessage: async () => {
      deleteStarted = true;
      return never;
    },
  });
  state.bot_sessions['100'] = { lastBotMessageId: 'old-message' };

  const result = await Promise.race([
    handlers.handleCallback({ user_id: 100, chat_id: null }, '100', 'menu:main', {
      callbackId: 'callback-1',
      messageId: 'old-message',
    }).then(() => 'done'),
    new Promise(resolve => setTimeout(() => resolve('timeout'), 50)),
  ]);

  await new Promise(resolve => setImmediate(resolve));

  assert.equal(result, 'done');
  assert.equal(messages.length, 2);
  assert.match(messages[0].options.attachments[0].payload.file, /manager-stages\/main-menu-optimistic\.jpg$/);
  assert.equal(state.bot_sessions['100'].lastBotImageMessageId, 'msg-1');
  assert.equal(state.bot_sessions['100'].lastBotMessageId, 'msg-2');
  assert.equal(answerStarted, true);
  assert.equal(deleteStarted, true);
});

test('MAX API request times out instead of hanging indefinitely', async () => {
  const client = createMaxApiClient({
    botToken: 'token',
    maxApiBase: 'https://platform-api.example',
    requestTimeoutMs: 10,
    fetchImpl: async (_url, options) => new Promise((_resolve, reject) => {
      options.signal.addEventListener('abort', () => {
        const error = new Error('aborted');
        error.name = 'AbortError';
        reject(error);
      });
    }),
  });

  const startedAt = Date.now();
  const result = await client.sendMessage({ user_id: 100 }, 'Проверка');

  assert.equal(result, null);
  assert.ok(Date.now() - startedAt < 500);
});

test('carrier cannot update another carrier delivery via callback payload', async () => {
  const { state, messages, handlers } = createMemoryBot(false);
  state.bot_users['100'] = {
    userId: 'carrier-1',
    userName: 'Быстрая доставка',
    userRole: 'Перевозчик',
    botMode: 'delivery',
    carrierId: 'carrier-1',
    replyTarget: { user_id: 100, chat_id: null },
  };
  state.delivery_carriers = [
    { id: 'carrier-1', name: 'Быстрая доставка', status: 'active', maxCarrierKey: '100' },
    { id: 'carrier-2', name: 'Чужая доставка', status: 'active', maxCarrierKey: '200' },
  ];
  state.deliveries = [
    { id: 'DL-own', status: 'sent', carrierId: 'carrier-1', carrierKey: 'carrier-1', transportDate: '2026-04-25', origin: 'А', destination: 'Б', cargo: 'Подъёмник', client: 'Клиент', contactName: 'Иван', contactPhone: '+7' },
    { id: 'DL-other', status: 'sent', carrierId: 'carrier-2', carrierKey: 'carrier-2', transportDate: '2026-04-25', origin: 'В', destination: 'Г', cargo: 'Подъёмник', client: 'Клиент', contactName: 'Петр', contactPhone: '+7' },
  ];

  await handlers.handleCallback({ user_id: 100 }, '100', 'delivery:status:DL-other:accepted');

  assert.equal(state.deliveries.find(item => item.id === 'DL-other').status, 'sent');
  assert.equal(messages.at(-1).text, 'Эта доставка вам недоступна или уже закрыта.');
});
