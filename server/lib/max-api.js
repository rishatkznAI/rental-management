function createMaxApiClient({ botToken, maxApiBase, fetchImpl, webhookUrl, logger = console }) {
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

  async function sendMessage(target, text) {
    const recipientQuery = resolveRecipientQuery(target);
    logger.log(`[MAX API] sendMessage → ${recipientQuery} text="${String(text).slice(0, 60)}"`);
    const res = await maxRequest('POST', `/messages?${recipientQuery}`, {
      text,
    });
    logger.log(`[MAX API] sendMessage ← ${JSON.stringify(res).slice(0, 200)}`);
    return res;
  }

  async function registerWebhook() {
    if (!botToken) return;
    if (!webhookUrl) {
      logger.log('[BOT] WEBHOOK_URL не задан — пропускаем регистрацию.');
      return;
    }
    const res = await maxRequest('POST', '/subscriptions', {
      url: `${webhookUrl}/bot/webhook`,
      update_types: ['message_created', 'bot_started'],
    });
    if (res && !res.error) {
      logger.log(`[BOT] Webhook зарегистрирован: ${webhookUrl}/bot/webhook`);
    } else {
      logger.error('[BOT] Ошибка регистрации webhook:', res?.message || res);
    }
  }

  return {
    maxRequest,
    sendMessage,
    registerWebhook,
  };
}

module.exports = {
  createMaxApiClient,
};
