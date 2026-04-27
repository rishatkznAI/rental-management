const express = require('express');
const crypto = require('crypto');

const processedWebhookUpdates = new Map();
const WEBHOOK_UPDATE_DEDUPE_MS = 10 * 1000;
const BOT_CONNECTION_ROLES = [
  'Администратор',
  'Офис-менеджер',
  'Менеджер по аренде',
  'Менеджер по продажам',
  'Механик',
  'Младший стационарный механик',
  'Выездной механик',
  'Старший стационарный механик',
  'Перевозчик',
];

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

function getUpdateType(update) {
  return update?.update_type || update?.updateType || update?.type || '';
}

function extractUpdateMessage(update) {
  return update?.message ||
    update?.message_created?.message ||
    update?.messageCreated?.message ||
    update?.payload?.message ||
    null;
}

function extractUpdateSender(update, message, callback = null) {
  return message?.sender ||
    callback?.sender ||
    callback?.user ||
    update?.sender ||
    update?.user ||
    {};
}

function extractCallbackSender(update, callback = {}) {
  return callback?.user ||
    callback?.sender ||
    update?.user ||
    update?.sender ||
    callback?.message?.sender ||
    update?.message?.sender ||
    {};
}

function extractUpdateRecipient(update, message, callback = null) {
  return message?.recipient ||
    callback?.recipient ||
    update?.recipient ||
    {};
}

function firstTextValue(values) {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    if (typeof value === 'string') return value;
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  }
  return '';
}

function extractCallbackPayload(update, callback = {}) {
  return firstTextValue([
    callback?.payload,
    callback?.data,
    callback?.button?.payload,
    callback?.button?.data,
    callback?.action?.payload,
    callback?.action?.data,
    update?.payload?.payload,
    update?.payload?.data,
    update?.callback_payload,
    update?.callbackPayload,
    update?.data,
    update?.payload,
  ]);
}

function extractUpdateText(update, message) {
  const body = message?.body;
  if (typeof body === 'string') return body;
  return body?.text ||
    message?.text ||
    update?.text ||
    update?.payload?.text ||
    '';
}

function extractUpdateAttachments(message) {
  const body = message?.body;
  return body?.attachments || message?.attachments || [];
}

function webhookUpdateFingerprint(update) {
  const callback = update?.callback || update?.message_callback || update?.messageCallback || {};
  const message = extractUpdateMessage(update) || callback?.message || {};
  const sender = getUpdateType(update) === 'message_callback'
    ? extractCallbackSender(update, callback)
    : extractUpdateSender(update, message, callback);
  const body = message?.body || {};
  const callbackPayload = extractCallbackPayload(update, callback);
  const stableParts = [
    getUpdateType(update),
    update?.update_id,
    update?.updateId,
    update?.timestamp,
    update?.created_at,
    update?.createdAt,
    message?.message_id,
    message?.messageId,
    message?.mid,
    message?.id,
    message?.created_at,
    message?.createdAt,
    callback?.callback_id,
    callback?.callbackId,
    callbackPayload,
    sender?.user_id,
    sender?.userId,
    body?.text,
  ].filter(value => value !== undefined && value !== null && value !== '');

  if (stableParts.length > 1) return stableParts.map(String).join('|');

  return crypto
    .createHash('sha1')
    .update(JSON.stringify(update || {}))
    .digest('hex');
}

function shouldProcessWebhookUpdate(update) {
  const now = Date.now();
  for (const [key, timestamp] of processedWebhookUpdates.entries()) {
    if (now - timestamp > WEBHOOK_UPDATE_DEDUPE_MS) {
      processedWebhookUpdates.delete(key);
    }
  }

  const key = webhookUpdateFingerprint(update);
  if (processedWebhookUpdates.has(key)) return false;
  processedWebhookUpdates.set(key, now);
  return true;
}

function normalizeWebhookPath(webhookPath = '/bot/webhook') {
  return String(webhookPath || '/bot/webhook').startsWith('/')
    ? String(webhookPath || '/bot/webhook')
    : `/${String(webhookPath || 'bot/webhook')}`;
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

function normalizeBotConnectionRole(value) {
  const role = String(value || '').trim();
  return BOT_CONNECTION_ROLES.includes(role) ? role : '';
}

function clearBotConnectionSession(botSessions = {}, phone = '') {
  const nextSessions = { ...(botSessions || {}) };
  delete nextSessions[String(phone || '')];
  return nextSessions;
}

function updateBotConnectionRole(botUsers = {}, botSessions = {}, phone = '', userRole = '') {
  const phoneKey = String(phone || '').trim();
  if (!phoneKey || !botUsers?.[phoneKey]) {
    return { ok: false, status: 404, error: 'Подключение к боту не найдено.' };
  }

  const normalizedRole = normalizeBotConnectionRole(userRole);
  if (!normalizedRole) {
    return { ok: false, status: 400, error: 'Укажите корректную роль пользователя в боте.' };
  }

  const current = botUsers[phoneKey] || {};
  const nextUsers = { ...(botUsers || {}) };
  const nextUser = {
    ...current,
    userRole: normalizedRole,
    botMode: normalizedRole === 'Перевозчик' ? 'delivery' : 'staff',
    lastSeenAt: new Date().toISOString(),
  };

  if (normalizedRole !== 'Перевозчик') {
    delete nextUser.carrierId;
  }

  nextUsers[phoneKey] = nextUser;

  return {
    ok: true,
    botUsers: nextUsers,
    botSessions: clearBotConnectionSession(botSessions, phoneKey),
    user: nextUser,
  };
}

function disconnectBotConnection(botUsers = {}, botSessions = {}, phone = '') {
  const phoneKey = String(phone || '').trim();
  if (!phoneKey || !botUsers?.[phoneKey]) {
    return { ok: false, status: 404, error: 'Подключение к боту не найдено.' };
  }

  const nextUsers = { ...(botUsers || {}) };
  const removed = nextUsers[phoneKey];
  delete nextUsers[phoneKey];

  return {
    ok: true,
    botUsers: nextUsers,
    botSessions: clearBotConnectionSession(botSessions, phoneKey),
    removed,
  };
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
    saveBotUsers,
    saveBotSessions,
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

  function findBotConfig(req, res) {
    const config = BOT_CONFIGS.find(item => item.id === req.params.botId);
    if (!config) {
      res.status(404).json({ ok: false, error: 'Бот не найден.' });
      return null;
    }
    return config;
  }

  botRouter.get('/bots', requireAuth, requireBotAdmin, (_req, res) => {
    return res.json(BOT_CONFIGS.map(config => buildBotPayload(config).summary));
  });

  botRouter.get('/bots/:botId', requireAuth, requireBotAdmin, (req, res) => {
    const config = findBotConfig(req, res);
    if (!config) return;

    const { summary, connections, activity } = buildBotPayload(config);

    return res.json({
      bot: summary,
      connections,
      activity,
    });
  });

  botRouter.patch('/bots/:botId/connections/:phone', requireAuth, requireBotAdmin, (req, res) => {
    const config = findBotConfig(req, res);
    if (!config) return;

    const result = updateBotConnectionRole(
      getBotUsers() || {},
      getBotSessions() || {},
      req.params.phone,
      req.body?.userRole,
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({ ok: false, error: result.error });
    }

    saveBotUsers(result.botUsers);
    saveBotSessions(result.botSessions);
    const payload = buildBotPayload(config);
    const connection = payload.connections.find(item => item.phone === String(req.params.phone));
    return res.json({ ok: true, connection: connection || null });
  });

  botRouter.delete('/bots/:botId/connections/:phone', requireAuth, requireBotAdmin, (req, res) => {
    const config = findBotConfig(req, res);
    if (!config) return;

    const result = disconnectBotConnection(
      getBotUsers() || {},
      getBotSessions() || {},
      req.params.phone,
    );
    if (!result.ok) {
      return res.status(result.status || 400).json({ ok: false, error: result.error });
    }

    saveBotUsers(result.botUsers);
    saveBotSessions(result.botSessions);
    return res.json({ ok: true });
  });

  router.use(botRouter);
}

function createBotUpdateProcessor(deps) {
  const {
    handleCommand,
    handleBotStarted,
    handleCallback,
    logger = console,
    webhookPath = '/bot/webhook',
  } = deps;
  const normalizedWebhookPath = normalizeWebhookPath(webhookPath);

  return async function processBotUpdate(update) {
    const updateType = getUpdateType(update);

    if (updateType === 'bot_started') {
      const user = update.user || update.sender || {};
      if (!user?.user_id) return;
      const startReplyTarget = {
        chat_id: update.chat_id || update.chatId || update.recipient?.chat_id || user.chat_id,
        user_id: user.user_id,
        prefer_user_id: true,
      };
      logger.log(`[BOT] ${normalizedWebhookPath} [${user.name || user.user_id}] bot_started target=${JSON.stringify(startReplyTarget)}`);
      await handleBotStarted(startReplyTarget, String(user.user_id), update.payload);
      return;
    }

    if (updateType === 'message_callback') {
      const callback = update.callback || update.message_callback || update.messageCallback || {};
      const callbackId = callback.callback_id || callback.callbackId || update.callback_id;
      const payload = extractCallbackPayload(update, callback);
      const callbackMessage = callback.message || update.message || {};
      const sender = extractCallbackSender(update, callback);
      const recipient = extractUpdateRecipient(update, callbackMessage, callback);
      const callbackMessageId =
        callbackMessage.message_id ||
        callbackMessage.mid ||
        callbackMessage.id ||
        update.message_id ||
        update.mid ||
        null;
      const replyTarget = {
        chat_id: recipient.chat_id || recipient.chatId || update.chat_id || update.chatId,
        user_id: sender.user_id || sender.userId || update.user_id || update.userId,
        prefer_user_id: true,
      };
      const phone = String(replyTarget.user_id || '');

      logger.log(`[BOT] ${normalizedWebhookPath} callback payload=${payload || 'empty'} user=${replyTarget.user_id || 'unknown'}`);
      await handleCallback(replyTarget, phone, String(payload || ''), {
        callbackId,
        messageId: callbackMessageId,
        raw: callback,
      });
      return;
    }

    if (updateType !== 'message_created') {
      logger.log(`[BOT] ${normalizedWebhookPath} unhandled update type=${updateType || 'unknown'}`);
      return;
    }

    const msg = extractUpdateMessage(update);
    const sender = extractUpdateSender(update, msg);
    const userId = sender?.user_id || sender?.userId || update?.user_id || update?.userId;
    if (!userId) {
      logger.log(`[BOT] ${normalizedWebhookPath} message без user_id keys=${Object.keys(update || {}).join(',')}`);
      return;
    }
    const recipient = extractUpdateRecipient(update, msg);

    const replyTarget = {
      chat_id: recipient?.chat_id || recipient?.chatId || update?.chat_id || update?.chatId,
      user_id: userId,
      prefer_user_id: true,
    };
    const senderId = replyTarget;
    const phone = String(userId);
    const text = extractUpdateText(update, msg);
    const attachments = extractUpdateAttachments(msg);

    if (!text.trim() && (!Array.isArray(attachments) || attachments.length === 0)) return;

    logger.log(`[BOT] ${normalizedWebhookPath} message user=${userId} text=${describeIncomingText(text)} attachments=${Array.isArray(attachments) ? attachments.length : 0}`);
    await handleCommand(senderId, phone, text, { message: msg, body: msg?.body, attachments });
  };
}

function registerBotRoutes(app, deps) {
  const {
    logger = console,
    webhookPath = '/bot/webhook',
  } = deps;
  const normalizedWebhookPath = normalizeWebhookPath(webhookPath);
  const processBotUpdate = createBotUpdateProcessor({
    ...deps,
    webhookPath: normalizedWebhookPath,
  });

  app.post(normalizedWebhookPath, async (req, res) => {
    res.sendStatus(200);

    try {
      const updates = req.body?.updates || [req.body];
      logger.log(`[BOT] ${normalizedWebhookPath} webhook updates=${updates.length}`);

      for (const update of updates) {
        if (!shouldProcessWebhookUpdate(update)) {
          logger.log(`[BOT] ${normalizedWebhookPath} duplicate update skipped`);
          continue;
        }
        const startedAt = Date.now();
        await processBotUpdate(update);
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > 2000) {
          logger.warn(`[BOT] ${normalizedWebhookPath} Медленная обработка ${update.update_type || 'unknown'}: ${elapsedMs}ms`);
        }
      }
    } catch (err) {
      logger.error(`[BOT] ${normalizedWebhookPath} Ошибка обработки webhook:`, err?.message || String(err));
      logger.error(`[BOT] ${normalizedWebhookPath} Stack:`, err?.stack || 'no stack');
    }
  });
}

module.exports = {
  BOT_CONNECTION_ROLES,
  createBotUpdateProcessor,
  disconnectBotConnection,
  registerBotApiRoutes,
  registerBotRoutes,
  shouldProcessWebhookUpdate,
  updateBotConnectionRole,
};
