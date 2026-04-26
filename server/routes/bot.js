const express = require('express');

function trimText(value, maxLength = 160) {
  const normalized = String(value || '').replace(/\s+/g, ' ').trim();
  if (!normalized) return '';
  return normalized.length > maxLength
    ? `${normalized.slice(0, maxLength - 1)}…`
    : normalized;
}

function describeIncomingText(text) {
  const value = String(text || '').trim();
  if (!value) return 'empty';
  if (value.toLowerCase().startsWith('/start')) return '/start [redacted]';
  return `len=${value.length}`;
}

function toFiniteNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function pendingActionLabel(action) {
  const map = {
    login_email: 'Ожидает логин',
    login_password: 'Ожидает пароль',
    equipment_search: 'Поиск техники',
    ticket_reason: 'Причина заявки',
    work_search: 'Поиск работ',
    work_pick: 'Добавление работы',
    part_search: 'Поиск запчастей',
    part_pick: 'Добавление запчасти',
    summary: 'Итог ремонта',
    maintenance_summary: 'Комментарий по ТО',
    operation_step: 'Шаг отгрузки/приёмки',
    repair_photo_before: 'Фото до ремонта',
    repair_photo_after: 'Фото после ремонта',
    repair_close_checklist: 'Чек-лист закрытия',
  };
  return map[action] || (action ? trimText(action, 80) : null);
}

function byDateDesc(left, right) {
  const leftTime = left ? Date.parse(left) : 0;
  const rightTime = right ? Date.parse(right) : 0;
  return rightTime - leftTime;
}

function matchesDeliveryActivity(entry) {
  const haystack = [
    entry?.action,
    entry?.details,
    entry?.pendingAction,
    entry?.pendingActionLabel,
  ]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

  return haystack.includes('delivery:') ||
    haystack.includes('доставк') ||
    haystack.includes('перевоз');
}

function requireBotAdmin(req, res, next) {
  if (req.user?.userRole !== 'Администратор') {
    return res.status(403).json({ ok: false, error: 'Раздел бота доступен только администратору.' });
  }
  return next();
}

function buildBotConnections(botId, botUsers = {}, botSessions = {}, activity = []) {
  const latestActivityByPhone = new Map();
  const authorizationByPhone = new Map();

  (Array.isArray(activity) ? activity : []).forEach(entry => {
    if (entry?.botId !== botId || !entry.phone) return;
    if (!latestActivityByPhone.has(entry.phone)) {
      latestActivityByPhone.set(entry.phone, entry);
    }
    if (entry.eventType === 'authorization' && !authorizationByPhone.has(entry.phone)) {
      authorizationByPhone.set(entry.phone, entry);
    }
  });

  return Object.entries(botUsers || {})
    .map(([phone, user]) => {
      const session = botSessions?.[phone] || {};
      const latestActivity = latestActivityByPhone.get(phone);
      const authorization = authorizationByPhone.get(phone);

      return {
        id: `${botId}:${phone}`,
        botId,
        phone,
        maxUserId: user?.maxUserId ?? toFiniteNumber(phone) ?? toFiniteNumber(user?.replyTarget?.user_id),
        userId: user?.userId || null,
        userName: user?.userName || null,
        userRole: user?.userRole || null,
        email: user?.email || null,
        replyTarget: user?.replyTarget || null,
        connectedAt: user?.connectedAt || authorization?.createdAt || null,
        lastSeenAt: user?.lastSeenAt || session?.updatedAt || latestActivity?.createdAt || null,
        pendingAction: session?.pendingAction || null,
        pendingActionLabel: pendingActionLabel(session?.pendingAction),
        activeRepairId: session?.activeRepairId || null,
        sessionUpdatedAt: session?.updatedAt || null,
      };
    })
    .sort((left, right) => byDateDesc(left.lastSeenAt || left.connectedAt, right.lastSeenAt || right.connectedAt));
}

function buildBotActivity(botId, botUsers = {}, activity = []) {
  return (Array.isArray(activity) ? activity : [])
    .filter(entry => entry?.botId === botId)
    .map(entry => {
      const linkedUser = botUsers?.[entry.phone] || {};
      return {
        id: entry.id,
        botId,
        phone: entry.phone || null,
        maxUserId: entry.maxUserId ?? toFiniteNumber(entry.phone) ?? linkedUser.maxUserId ?? null,
        userId: entry.userId || linkedUser.userId || null,
        userName: entry.userName || linkedUser.userName || null,
        userRole: entry.userRole || linkedUser.userRole || null,
        email: entry.email || linkedUser.email || null,
        eventType: entry.eventType || 'message',
        action: trimText(entry.action || 'Действие без описания'),
        details: entry.details ? trimText(entry.details, 220) : null,
        createdAt: entry.createdAt || null,
      };
    })
    .sort((left, right) => byDateDesc(left.createdAt, right.createdAt));
}

function buildBotSummary({
  botId,
  name,
  provider,
  description,
  botToken,
  webhookUrl,
  connections,
  activity,
}) {
  const actions24h = activity.filter(entry => {
    if (!entry.createdAt) return false;
    return Date.now() - Date.parse(entry.createdAt) <= 24 * 60 * 60 * 1000;
  }).length;
  const pendingCount = connections.filter(item => Boolean(item.pendingAction)).length;
  const lastActivityAt = activity[0]?.createdAt || connections[0]?.lastSeenAt || null;

  return {
    id: botId,
    name,
    provider,
    description,
    status: botToken ? 'online' : 'offline',
    webhookConfigured: Boolean(webhookUrl),
    totalConnections: connections.length,
    pendingConnections: pendingCount,
    totalActivity: activity.length,
    activity24h: actions24h,
    lastActivityAt,
    connectionsPreview: connections.slice(0, 5),
    recentActivity: activity.slice(0, 8),
  };
}

function registerBotApiRoutes(router, deps) {
  const {
    requireAuth,
    readData,
    getBotUsers,
    getBotSessions,
    botToken,
    webhookUrl,
    managerBotToken,
    managerWebhookUrl,
    deliveryBotToken,
    deliveryWebhookUrl,
  } = deps;

  const botRouter = express.Router();
  const BOT_CONFIGS = [
    {
      id: 'max',
      name: 'MAX бот',
      description: 'Общий рабочий бот MAX: авторизация сотрудников, сервисные сценарии и действия в чате.',
      filterConnections: () => true,
      filterActivity: () => true,
    },
    {
      id: 'manager',
      name: 'Бот менеджера аренды',
      description: 'Утренняя сводка, свободная техника, создание доставки и сервисных заявок для менеджеров аренды.',
      botToken: managerBotToken || botToken || '',
      webhookUrl: managerBotToken ? (managerWebhookUrl || null) : (webhookUrl || null),
      filterConnections: (connection) => connection.userRole === 'Менеджер по аренде',
      filterActivity: (entry) => entry.userRole === 'Менеджер по аренде',
    },
    {
      id: 'delivery',
      name: 'Бот доставки',
      description: 'Статусы доставки, работа перевозчиков и действия по логистическим заявкам в MAX.',
      botToken: deliveryBotToken || '',
      webhookUrl: deliveryBotToken ? (deliveryWebhookUrl || null) : null,
      filterConnections: (connection) =>
        connection.userRole === 'Перевозчик' ||
        matchesDeliveryActivity(connection),
      filterActivity: (entry) => matchesDeliveryActivity(entry),
    },
  ];

  function readBotActivity() {
    return readData('bot_activity') || [];
  }

  function buildBotPayload(config) {
    const botUsers = getBotUsers() || {};
    const botSessions = getBotSessions() || {};
    const rawActivity = buildBotActivity('max', botUsers, readBotActivity());
    const rawConnections = buildBotConnections('max', botUsers, botSessions, rawActivity);
    const activity = rawActivity
      .filter(config.filterActivity)
      .map(entry => ({ ...entry, botId: config.id, id: `${config.id}:${entry.id}` }));
    const connections = rawConnections
      .filter(config.filterConnections)
      .map(connection => ({ ...connection, botId: config.id, id: `${config.id}:${connection.phone}` }));
    const summary = buildBotSummary({
      botId: config.id,
      name: config.name,
      provider: 'MAX',
      description: config.description,
      botToken: config.botToken ?? botToken,
      webhookUrl: config.webhookUrl ?? webhookUrl,
      connections,
      activity,
    });

    return { summary, connections, activity };
  }

  botRouter.get('/bots', requireAuth, requireBotAdmin, (_req, res) => {
    return res.json(BOT_CONFIGS.map(config => buildBotPayload(config).summary));
  });

  botRouter.get('/bots/:botId', requireAuth, requireBotAdmin, (req, res) => {
    const config = BOT_CONFIGS.find(item => item.id === req.params.botId);
    if (!config) {
      return res.status(404).json({ ok: false, error: 'Бот не найден.' });
    }

    const { summary, connections, activity } = buildBotPayload(config);

    return res.json({
      bot: summary,
      connections,
      activity,
    });
  });

  router.use(botRouter);
}

function registerBotRoutes(app, deps) {
  const {
    handleCommand,
    handleBotStarted,
    handleCallback,
    answerCallback,
    logger = console,
    webhookPath = '/bot/webhook',
  } = deps;

  async function processBotUpdate(update) {
    if (update.update_type === 'bot_started') {
      const user = update.user;
      if (!user?.user_id) return;
      const startReplyTarget = {
        chat_id: update.chat_id || update.chatId || update.recipient?.chat_id || user.chat_id,
        user_id: user.user_id,
      };
      logger.log(`[BOT] [${user.name || user.user_id}] bot_started target=${JSON.stringify(startReplyTarget)}`);
      await handleBotStarted(startReplyTarget, String(user.user_id), update.payload);
      return;
    }

    if (update.update_type === 'message_callback') {
      const callback = update.callback || update.message_callback || update.messageCallback || {};
      const callbackId = callback.callback_id || callback.callbackId || update.callback_id;
      const payload = callback.payload || callback.data || update.payload || '';
      const sender = callback.sender || callback.user || update.user || {};
      const recipient = callback.recipient || update.recipient || {};
      const callbackMessage = callback.message || update.message || {};
      const callbackMessageId =
        callbackMessage.message_id ||
        callbackMessage.mid ||
        callbackMessage.id ||
        update.message_id ||
        update.mid ||
        null;
      const replyTarget = {
        chat_id: recipient.chat_id || recipient.chatId || update.chat_id || update.chatId,
        user_id: sender.user_id || sender.userId || update.user_id,
      };
      const phone = String(replyTarget.user_id || '');

      logger.log(`[BOT] callback payload=${payload} user=${replyTarget.user_id || 'unknown'}`);
      await handleCallback(replyTarget, phone, String(payload || ''), {
        callbackId,
        messageId: callbackMessageId,
        raw: callback,
      });
      return;
    }

    if (update.update_type !== 'message_created') return;

    const msg = update.message;
    const sender = msg?.sender;
    if (!sender?.user_id) return;

    const replyTarget = {
      chat_id: msg?.recipient?.chat_id,
      user_id: sender.user_id,
    };
    const senderId = replyTarget;
    const phone = String(sender.user_id);
    const text = msg?.body?.text || '';
    const attachments = msg?.body?.attachments || msg?.attachments || [];

    if (!text.trim() && (!Array.isArray(attachments) || attachments.length === 0)) return;

    logger.log(`[BOT] message user=${sender.user_id} text=${describeIncomingText(text)} attachments=${Array.isArray(attachments) ? attachments.length : 0}`);
    await handleCommand(senderId, phone, text, { message: msg, body: msg?.body, attachments });
  }

  app.post(webhookPath, async (req, res) => {
    res.sendStatus(200);

    try {
      const updates = req.body?.updates || [req.body];
      logger.log(`[BOT] webhook updates=${updates.length}`);

      for (const update of updates) {
        const startedAt = Date.now();
        await processBotUpdate(update);
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > 2000) {
          logger.warn(`[BOT] Медленная обработка ${update.update_type || 'unknown'}: ${elapsedMs}ms`);
        }
      }
    } catch (err) {
      logger.error('[BOT] Ошибка обработки webhook:', err?.message || String(err));
      logger.error('[BOT] Stack:', err?.stack || 'no stack');
    }
  });
}

module.exports = {
  registerBotApiRoutes,
  registerBotRoutes,
};
