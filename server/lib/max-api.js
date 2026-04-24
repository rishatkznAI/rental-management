function createMaxApiClient({ botToken, maxApiBase, fetchImpl, webhookUrl, webhookPath = '/bot/webhook', logger = console }) {
  function normalizeCallbackNotification(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value.text === 'string') return value.text;
    return String(value);
  }

  function resolveRecipientQuery(target) {
    if (target && typeof target === 'object') {
      const chatId = target.chatId ?? target.chat_id;
      if (chatId) return `chat_id=${encodeURIComponent(chatId)}`;

      const userId = target.userId ?? target.user_id;
      if (userId) return `user_id=${encodeURIComponent(userId)}`;
    }

    return `user_id=${encodeURIComponent(target)}`;
  }

  async function maxRequest(method, endpoint, body = null) {
    const token = (botToken || '').trim();
    const url = `${maxApiBase}${endpoint}`;
    logger.log(`[MAX API] token prefix="${token.slice(0, 8)}" len=${token.length}`);
    const opts = {
      method,
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);

    try {
      const res = await fetchImpl(url, opts);
      const json = await res.json();
      if (json.error) {
        logger.error(`[MAX API] Ошибка ответа (${endpoint}):`, JSON.stringify(json));
      }
      return json;
    } catch (err) {
      logger.error('[MAX API] Ошибка:', err.message);
      return null;
    }
  }

  async function sendMessage(target, text, options = {}) {
    const recipientQuery = resolveRecipientQuery(target);
    logger.log(`[MAX API] sendMessage → ${recipientQuery} text="${String(text).slice(0, 60)}"`);
    const body = {
      text,
      ...(options.attachments ? { attachments: options.attachments } : {}),
      ...(options.format ? { format: options.format } : {}),
      ...(options.notify != null ? { notify: options.notify } : {}),
    };
    const res = await maxRequest('POST', `/messages?${recipientQuery}`, body);
    logger.log(`[MAX API] sendMessage ← ${JSON.stringify(res).slice(0, 200)}`);
    return res;
  }

  async function deleteMessage(messageId) {
    if (!messageId) return null;
    const res = await maxRequest('DELETE', `/messages?message_id=${encodeURIComponent(messageId)}`);
    logger.log(`[MAX API] deleteMessage(${messageId}) ← ${JSON.stringify(res).slice(0, 200)}`);
    return res;
  }

  async function answerCallback(callbackId, options = {}) {
    if (!callbackId) return null;
    const notification = normalizeCallbackNotification(options.notification);
    const res = await maxRequest('POST', `/answers?callback_id=${encodeURIComponent(callbackId)}`, {
      ...(notification ? { notification } : {}),
      ...(options.message ? { message: options.message } : {}),
    });
    logger.log(`[MAX API] answerCallback ← ${JSON.stringify(res).slice(0, 200)}`);
    return res;
  }

  async function registerWebhook() {
    if (!botToken) return;
    if (!webhookUrl) {
      logger.log('[BOT] WEBHOOK_URL не задан — пропускаем регистрацию.');
      return;
    }
    const normalizedPath = String(webhookPath || '/bot/webhook').startsWith('/')
      ? String(webhookPath || '/bot/webhook')
      : `/${String(webhookPath || 'bot/webhook')}`;
    const res = await maxRequest('POST', '/subscriptions', {
      url: `${webhookUrl}${normalizedPath}`,
      update_types: ['message_created', 'bot_started', 'message_callback'],
    });
    if (res && !res.error) {
      logger.log(`[BOT] Webhook зарегистрирован: ${webhookUrl}${normalizedPath}`);
    } else {
      logger.error('[BOT] Ошибка регистрации webhook:', res?.message || res);
    }
  }

  return {
    maxRequest,
    sendMessage,
    deleteMessage,
    answerCallback,
    registerWebhook,
  };
}

module.exports = {
  createMaxApiClient,
};
