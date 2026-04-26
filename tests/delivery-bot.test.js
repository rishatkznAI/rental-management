import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { createBotHandlers } = require('../server/lib/bot-commands.js');
const { attachBotBrandImage, attachMechanicStageImage } = require('../server/lib/bot-stage-images.js');
const { createMaxApiClient } = require('../server/lib/max-api.js');

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
  };
  const messages = [];
  const handlers = createBotHandlers({
    readData: (name) => state[name] ?? [],
    writeData: (name, value) => {
      state[name] = value;
    },
    verifyPassword: () => false,
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
    idPrefixes: { deliveries: 'DL' },
    nowIso: () => '2026-04-24T08:00:00.000Z',
    readServiceTickets: () => [],
    writeServiceTickets: () => {},
    findServiceTicketById: () => null,
    saveServiceTicket: () => {},
    appendServiceLog: () => {},
    getMechanicReferenceByUser: () => null,
    syncEquipmentStatusForService: () => {},
    updateServiceTicketStatus: () => null,
    getOpenTicketByEquipment: () => null,
    serviceStatusLabel: (status) => status,
    preferCarrierAutoLogin,
  });

  return { state, messages, handlers };
}

test('regular bot_started keeps an existing non-carrier role menu', async () => {
  const { state, messages, handlers } = createMemoryBot(false);

  await handlers.handleBotStarted({ user_id: 100 }, '100');

  assert.equal(state.bot_users['100'].userRole, 'Менеджер по аренде');
  assert.match(messages.at(-1).text, /Менеджер по аренде/);
  assert.doesNotMatch(messages.at(-1).text, /Здесь вы видите свои доставки/);
});

test('dedicated delivery bot_started prefers linked carrier role', async () => {
  const { state, messages, handlers } = createMemoryBot(true);

  await handlers.handleBotStarted({ user_id: 100 }, '100');

  assert.equal(state.bot_users['100'].userRole, 'Перевозчик');
  assert.equal(state.bot_users['100'].carrierId, 'carrier-1');
  assert.match(messages.at(-1).text, /Перевозчик/);
  assert.match(messages.at(-1).text, /доставки/);
  assert.equal(messages.length, 2);
  assert.match(messages[0].options.attachments[0].payload.file, /delivery-stages\/main-menu\.jpg$/);
});

test('dedicated delivery bot explains missing MAX carrier link', async () => {
  const { state, messages, handlers } = createMemoryBot(true);
  state.delivery_carriers = [];

  await handlers.handleBotStarted({ user_id: 100 }, '100');

  assert.equal(state.bot_users['100'].userRole, 'Менеджер по аренде');
  assert.equal(messages.length, 2);
  assert.match(messages.at(-1).text, /не привязан к перевозчику/);
  assert.match(messages[0].options.attachments[0].payload.file, /delivery-stages\/main-menu\.jpg$/);
  assert.equal(messages.at(-1).options.attachments[0].type, 'inline_keyboard');
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
  assert.match(messages[0].options.attachments[0].payload.file, /delivery-stages\/main-menu\.jpg$/);
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
  assert.match(messages[0].options.attachments[0].payload.file, /delivery-stages\/main-menu\.jpg$/);
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
  assert.match(imageAttachments[0].payload.file, /main-menu\.jpg$/);
  assert.doesNotMatch(imageAttachments[0].payload.file, /skytech-logo/);
  assert.equal(menuAttachments[0].type, 'inline_keyboard');
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
    carrierKey: 'carrier-1',
  }];

  await handlers.handleCommand({ user_id: 100 }, '100', '/доставки');

  assert.equal(messages.length, 2);
  assert.match(messages[0].options.attachments[0].payload.file, /delivery-stages\/delivery-list\.jpg$/);
  assert.match(messages[1].text, /Мои доставки/);
  assert.deepEqual(messages[1].options.attachments[0].payload.buttons[0][0], {
    type: 'callback',
    text: 'Принял',
    payload: 'delivery:status:DL-1:accepted',
  });
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
  assert.match(attachments[0].payload.file, /field-trip\.jpg$/);
  assert.equal(fs.existsSync(attachments[0].payload.file), true);
  assert.equal(attachments[1].type, 'inline_keyboard');
});

test('delivery bot uses delivery-specific stage images', () => {
  const attachments = attachMechanicStageImage('delivery_main', [{ type: 'inline_keyboard', payload: { buttons: [] } }]);

  assert.equal(attachments.length, 2);
  assert.equal(attachments[0].type, 'image');
  assert.match(attachments[0].payload.file, /delivery-stages\/main-menu\.jpg$/);
  assert.equal(attachments[0].payload.publicPath, '/bot-assets/delivery-stages/main-menu.jpg');
  assert.equal(attachments[0].payload.cacheKey, 'delivery-stage:delivery_main');
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
      payload: { url: 'https://bot.example/bot-assets/mechanic-stages/main-menu.jpg' },
    },
  ]);
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
  assert.equal(messages.length, 1);
  assert.equal(state.bot_sessions['100'].lastBotMessageId, 'msg-1');
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
