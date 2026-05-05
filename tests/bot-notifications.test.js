import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { createAccessControl } = require('../server/lib/access-control.js');
const {
  createBotNotificationService,
  startBotNotificationScheduler,
} = require('../server/lib/bot-notifications.js');

function createMemoryNotifications(overrides = {}, options = {}) {
  const state = {
    users: [
      { id: 'U-manager-1', name: 'Иванов Иван', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-manager-2', name: 'Петров Петр', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-admin', name: 'Администратор', role: 'Администратор', status: 'Активен' },
      { id: 'U-inactive', name: 'Неактивный', role: 'Менеджер по аренде', status: 'Активен' },
    ],
    bot_users: {
      '100': {
        userId: 'U-manager-1',
        userName: 'Иванов Иван',
        userRole: 'rental_manager',
        isActive: true,
        replyTarget: { user_id: 100, chat_id: null },
      },
      '101': {
        userId: 'U-manager-2',
        userName: 'Петров Петр',
        userRole: 'Менеджер по аренде',
        isActive: true,
        replyTarget: { user_id: 101, chat_id: null },
      },
      '102': {
        userId: 'U-admin',
        userName: 'Администратор',
        userRole: 'administrator',
        isActive: true,
        replyTarget: { user_id: 102, chat_id: null },
      },
      '103': {
        userId: 'U-carrier',
        userName: 'Перевозчик',
        userRole: 'Перевозчик',
        role: 'carrier',
        botMode: 'delivery',
        isActive: true,
        carrierId: 'carrier-1',
        replyTarget: { user_id: 103, chat_id: null },
      },
      '104': {
        userId: 'U-inactive',
        userName: 'Неактивный',
        userRole: 'Менеджер по аренде',
        isActive: false,
        replyTarget: { user_id: 104, chat_id: null },
      },
    },
    rentals: [],
    gantt_rentals: [],
    equipment: [
      { id: 'EQ-1', inventoryNumber: '026', manufacturer: 'Mantall', model: 'XE80N', serialNumber: 'SN-026' },
      { id: 'EQ-2', inventoryNumber: '099', manufacturer: 'Mantall', model: 'XE100C', serialNumber: 'SN-099' },
    ],
    deliveries: [],
    clients: [],
    bot_notifications: [],
    ...overrides,
  };
  const messages = [];
  const readData = (name) => state[name] ?? [];
  const writeData = (name, value) => {
    state[name] = value;
  };
  const accessControl = createAccessControl({ readData });
  const service = createBotNotificationService({
    readData,
    writeData,
    sendMessage: options.sendMessage || (async (target, text) => {
      messages.push({ target, text });
      return { message: { message_id: `msg-${messages.length}` } };
    }),
    generateId: (prefix) => `${prefix}-${state.bot_notifications.length + 1}`,
    nowIso: () => '2026-04-30T08:00:00.000Z',
    accessControl,
    logger: { error: () => {}, warn: () => {}, log: () => {} },
  });
  return { state, messages, service };
}

test('scheduled return notifications go only to responsible managers and admins once', async () => {
  const { state, messages, service } = createMemoryNotifications({
    rentals: [
      {
        id: 'R-own',
        client: 'ООО Свой',
        equipmentId: 'EQ-1',
        plannedReturnDate: '2026-05-01',
        managerId: 'U-manager-1',
        manager: 'Иванов Иван',
        status: 'active',
      },
      {
        id: 'R-other',
        client: 'ООО Чужой',
        equipmentId: 'EQ-2',
        plannedReturnDate: '2026-05-01',
        managerId: 'U-manager-2',
        manager: 'Петров Петр',
        status: 'active',
      },
    ],
  });

  await service.runScheduledNotifications({ todayKey: '2026-04-30' });

  assert.equal(messages.length, 4);
  assert.equal(messages.filter(message => message.target.user_id === 100).length, 1);
  assert.equal(messages.filter(message => message.target.user_id === 101).length, 1);
  assert.equal(messages.filter(message => message.target.user_id === 102).length, 2);
  assert.equal(messages.some(message => message.target.user_id === 103), false);
  assert.equal(messages.some(message => message.target.user_id === 104), false);
  assert.match(messages.find(message => message.target.user_id === 100).text, /ООО Свой/);
  assert.doesNotMatch(messages.find(message => message.target.user_id === 100).text, /ООО Чужой/);
  assert.equal(state.bot_notifications.filter(item => item.status === 'sent').length, 4);

  await service.runScheduledNotifications({ todayKey: '2026-04-30' });

  assert.equal(messages.length, 4);
  assert.equal(state.bot_notifications.filter(item => item.status === 'sent').length, 4);
});

test('overdue return notification is deduplicated', async () => {
  const { state, messages, service } = createMemoryNotifications({
    rentals: [{
      id: 'R-overdue',
      client: 'ООО Просрочка',
      equipmentId: 'EQ-1',
      plannedReturnDate: '2026-04-29',
      managerId: 'U-manager-1',
      manager: 'Иванов Иван',
      status: 'active',
    }],
  });

  await service.runScheduledNotifications({ todayKey: '2026-04-30' });
  await service.runScheduledNotifications({ todayKey: '2026-04-30' });

  assert.equal(messages.length, 2);
  assert.equal(state.bot_notifications.filter(item => item.eventType === 'return_overdue' && item.status === 'sent').length, 2);
});

test('dispatch creation notifies manager and admin but not carrier', async () => {
  const { messages, service } = createMemoryNotifications();
  const delivery = {
    id: 'DL-1',
    type: 'shipping',
    status: 'new',
    transportDate: '2026-04-30',
    client: 'ООО Клиент',
    cargo: 'Mantall XE100C',
    destination: 'Казань, ул. Примерная, 10',
    managerId: 'U-manager-1',
    manager: 'Иванов Иван',
    carrierName: 'Иван Петров',
  };

  await service.notifyDeliveryCreated(delivery);

  assert.equal(messages.length, 2);
  assert.equal(messages.some(message => message.target.user_id === 100), true);
  assert.equal(messages.some(message => message.target.user_id === 102), true);
  assert.equal(messages.some(message => message.target.user_id === 103), false);
  assert.match(messages[0].text, /Отгрузка техники/);
});

test('dispatch status change is deduplicated per status and recipient', async () => {
  const { state, messages, service } = createMemoryNotifications();
  const previous = {
    id: 'DL-2',
    type: 'shipping',
    status: 'sent',
    transportDate: '2026-04-30',
    client: 'ООО Статус',
    managerId: 'U-manager-1',
    manager: 'Иванов Иван',
  };
  const next = { ...previous, status: 'in_transit' };

  await service.notifyDeliveryStatusChanged(previous, next);
  await service.notifyDeliveryStatusChanged(previous, next);

  assert.equal(messages.length, 2);
  assert.equal(state.bot_notifications.filter(item => item.eventType === 'dispatch_status_changed').length, 2);
});

test('inactive bot user is recorded as skipped and receives no notification', async () => {
  const { state, messages, service } = createMemoryNotifications({
    bot_users: {
      '104': {
        userId: 'U-inactive',
        userName: 'Неактивный',
        userRole: 'Менеджер по аренде',
        isActive: false,
        replyTarget: { user_id: 104, chat_id: null },
      },
    },
    rentals: [{
      id: 'R-inactive',
      client: 'ООО Без MAX',
      equipmentId: 'EQ-1',
      plannedReturnDate: '2026-05-01',
      managerId: 'U-inactive',
      manager: 'Неактивный',
      status: 'active',
    }],
  });

  await service.runScheduledNotifications({ todayKey: '2026-04-30' });

  assert.equal(messages.length, 0);
  assert.equal(state.bot_notifications.length, 1);
  assert.equal(state.bot_notifications[0].status, 'skipped_inactive');
  assert.equal(state.bot_notifications[0].reason, 'inactive_user');
});

test('failed_send does not block retry and later sent is recorded', async () => {
  let attempts = 0;
  const { state, messages, service } = createMemoryNotifications({}, {
    sendMessage: async (target, text) => {
      attempts += 1;
      if (attempts === 1) throw new Error('MAX temporary failure');
      messages.push({ target, text });
      return { message: { message_id: `msg-${messages.length}` } };
    },
  });
  const delivery = {
    id: 'DL-retry',
    type: 'shipping',
    status: 'new',
    transportDate: '2026-04-30',
    client: 'ООО Retry',
    cargo: 'Mantall XE100C',
    managerId: 'U-manager-1',
    manager: 'Иванов Иван',
  };

  await service.notifyDeliveryCreated(delivery);
  await service.notifyDeliveryCreated(delivery);

  const managerEvents = state.bot_notifications
    .filter(item => item.eventKey === 'dispatch_created:DL-retry:U-manager-1');
  assert.equal(attempts >= 2, true);
  assert.equal(messages.length >= 1, true);
  assert.equal(managerEvents.some(item => item.status === 'failed_send'), true);
  assert.equal(managerEvents.some(item => item.status === 'sent'), true);
});

test('skipped_no_bot_user does not block delivery after manager connects MAX', async () => {
  const { state, messages, service } = createMemoryNotifications({
    bot_users: {},
    rentals: [{
      id: 'R-connect-later',
      client: 'ООО Подключение',
      equipmentId: 'EQ-1',
      plannedReturnDate: '2026-05-01',
      managerId: 'U-manager-1',
      manager: 'Иванов Иван',
      status: 'active',
    }],
  });

  await service.runScheduledNotifications({ todayKey: '2026-04-30' });

  assert.equal(messages.length, 0);
  assert.equal(state.bot_notifications.some(item => item.status === 'skipped_no_bot_user'), true);

  state.bot_users['100'] = {
    userId: 'U-manager-1',
    userName: 'Иванов Иван',
    userRole: 'rental_manager',
    isActive: true,
    replyTarget: { user_id: 100, chat_id: null },
  };

  await service.runScheduledNotifications({ todayKey: '2026-04-30' });

  assert.equal(messages.length, 1);
  assert.equal(state.bot_notifications.some(item => item.status === 'sent' && item.eventKey === 'return_tomorrow:R-connect-later:2026-05-01:U-manager-1'), true);
});

test('sent status blocks duplicate successful notifications', async () => {
  const { state, messages, service } = createMemoryNotifications();
  const delivery = {
    id: 'DL-sent-once',
    type: 'shipping',
    status: 'new',
    transportDate: '2026-04-30',
    client: 'ООО Один раз',
    cargo: 'Mantall XE100C',
    managerId: 'U-manager-1',
    manager: 'Иванов Иван',
  };

  await service.notifyDeliveryCreated(delivery);
  await service.notifyDeliveryCreated(delivery);

  assert.equal(messages.length, 2);
  assert.equal(state.bot_notifications.filter(item => item.status === 'sent').length, 2);
  assert.equal(state.bot_notifications.filter(item => item.eventKey === 'dispatch_created:DL-sent-once:U-manager-1' && item.status === 'sent').length, 1);
  assert.equal(state.bot_notifications.filter(item => item.eventKey === 'dispatch_created:DL-sent-once:U-admin' && item.status === 'sent').length, 1);
});

test('notification diagnostics expose sent failed skipped summaries and latest events by key', async () => {
  const { state, service } = createMemoryNotifications({
    bot_notifications: [
      { id: 'n1', eventKey: 'k1', status: 'failed_send', reason: 'send_failed', createdAt: '2026-04-30T07:00:00.000Z' },
      { id: 'n2', eventKey: 'k1', status: 'sent', reason: null, createdAt: '2026-04-30T07:01:00.000Z' },
      { id: 'n3', eventKey: 'k2', status: 'skipped_no_bot_user', reason: 'no_bot_user', createdAt: '2026-04-30T07:02:00.000Z' },
    ],
  });

  const diagnostics = service.getDiagnostics({ todayKey: '2026-04-30' });

  assert.equal(diagnostics.notificationEvents.sent, 1);
  assert.equal(diagnostics.notificationEvents.failed, 1);
  assert.equal(diagnostics.notificationEvents.skipped, 1);
  assert.equal(diagnostics.notificationEvents.skippedReasonCounts.no_bot_user, 1);
  assert.equal(diagnostics.notificationEvents.latestByEventKey.some(item => item.eventKey === 'k1' && item.status === 'sent'), true);
  assert.equal(state.bot_notifications.length, 3);
});

test('service revision return notifies assigned mechanic and resolution notifies return author', async () => {
  const { state, messages, service } = createMemoryNotifications({
    users: [
      { id: 'U-office', name: 'Офис', role: 'Офис-менеджер', status: 'Активен' },
      { id: 'U-mechanic', name: 'Механик', role: 'Механик', status: 'Активен' },
    ],
    bot_users: {
      '200': {
        userId: 'U-office',
        userName: 'Офис',
        userRole: 'Офис-менеджер',
        isActive: true,
        replyTarget: { user_id: 200, chat_id: null },
      },
      '201': {
        userId: 'U-mechanic',
        userName: 'Механик',
        userRole: 'Механик',
        isActive: true,
        replyTarget: { user_id: 201, chat_id: null },
      },
    },
  });
  const ticket = {
    id: 'S-revision',
    equipment: 'Mantall XE80N',
    status: 'needs_revision',
    assignedMechanicId: 'U-mechanic',
    assignedMechanicName: 'Механик',
    revisionReason: 'Нет фото',
    revisionReturnedBy: 'U-office',
    revisionReturnedByName: 'Офис',
    revisionHistory: [{
      id: 'revision-1',
      createdAt: '2026-04-30T08:00:00.000Z',
      createdBy: 'U-office',
      createdByName: 'Офис',
      assignedMechanicId: 'U-mechanic',
      mechanicName: 'Механик',
      reason: 'Нет фото',
      checklist: ['Нет фото'],
    }],
  };

  await service.notifyServiceRevisionReturned(ticket);

  assert.equal(messages.length, 1);
  assert.equal(messages[0].target.user_id, 201);
  assert.match(messages[0].text, /Заявка возвращена на доработку/);
  assert.match(messages[0].text, /Нет фото/);

  await service.notifyServiceRevisionResolved({
    ...ticket,
    status: 'ready',
    revisionResolvedByName: 'Механик',
    revisionHistory: [{
      ...ticket.revisionHistory[0],
      resolvedAt: '2026-04-30T09:00:00.000Z',
      resolvedBy: 'U-mechanic',
      resolvedByName: 'Механик',
    }],
  });

  assert.equal(messages.length, 2);
  assert.equal(messages[1].target.user_id, 200);
  assert.match(messages[1].text, /Механик отправил заявку после доработки/);
  assert.equal(state.bot_notifications.filter(item => item.status === 'sent').length, 2);
});

test('notification scheduler is disabled in NODE_ENV=test without timers', () => {
  let timeoutCalls = 0;
  let intervalCalls = 0;

  const scheduler = startBotNotificationScheduler({
    env: { NODE_ENV: 'test' },
    runTick: () => {},
    logger: { log: () => {}, error: () => {} },
    setTimeoutImpl: () => { timeoutCalls += 1; },
    setIntervalImpl: () => { intervalCalls += 1; },
  });

  assert.equal(scheduler, null);
  assert.equal(timeoutCalls, 0);
  assert.equal(intervalCalls, 0);
});

test('BOT_NOTIFICATION_SCHEDULER=0 disables notification scheduler without timers', () => {
  let timeoutCalls = 0;
  let intervalCalls = 0;

  const scheduler = startBotNotificationScheduler({
    env: { NODE_ENV: 'production', BOT_NOTIFICATION_SCHEDULER: '0' },
    runTick: () => {},
    logger: { log: () => {}, error: () => {} },
    setTimeoutImpl: () => { timeoutCalls += 1; },
    setIntervalImpl: () => { intervalCalls += 1; },
  });

  assert.equal(scheduler, null);
  assert.equal(timeoutCalls, 0);
  assert.equal(intervalCalls, 0);
});

test('enabled notification scheduler unrefs both timers', () => {
  const timers = [];
  const makeTimer = () => {
    const timer = { unrefCalled: false, unref() { this.unrefCalled = true; } };
    timers.push(timer);
    return timer;
  };

  const scheduler = startBotNotificationScheduler({
    env: { NODE_ENV: 'production' },
    runTick: () => {},
    logger: { log: () => {}, error: () => {} },
    setTimeoutImpl: makeTimer,
    setIntervalImpl: makeTimer,
  });

  assert.equal(Boolean(scheduler), true);
  assert.equal(timers.length, 2);
  assert.equal(timers.every(timer => timer.unrefCalled), true);
});
