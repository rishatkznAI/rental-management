import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createBotHandlers } = require('../server/lib/bot-commands.js');
const { createMaxApiClient } = require('../server/lib/max-api.js');

function createMemoryBot(preferCarrierAutoLogin = false) {
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
    deleteMessage: async () => ({ success: true }),
    answerCallback: async () => ({ success: true }),
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
