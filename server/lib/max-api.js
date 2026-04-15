function createMaxApiClient({ botToken, maxApiBase, fetchImpl, webhookUrl, logger = console }) {
  async function maxRequest(method, endpoint, body = null) {
    const url = `${maxApiBase}${endpoint}`;
    const opts = {
      method,
      headers: {
        Authorization: botToken,
        'Content-Type': 'application/json',
      },
    };
    if (body) opts.body = JSON.stringify(body);

    try {
      const res = await fetchImpl(url, opts);
      const json = await res.json();
      return json;
    } catch (err) {
      logger.error('[MAX API] Ошибка:', err.message);
      return null;
    }
  }

  async function sendMessage(userId, text) {
    return maxRequest('POST', '/messages', {
      recipient: { user_id: userId },
      body: { type: 'text', text },
    });
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
