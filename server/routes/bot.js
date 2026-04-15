function registerBotRoutes(app, deps) {
  const {
    handleCommand,
    handleBotStarted,
    logger = console,
  } = deps;

  app.post('/bot/webhook', async (req, res) => {
    res.sendStatus(200);

    try {
      logger.log('[BOT] Webhook получен:', JSON.stringify(req.body).slice(0, 300));
      const updates = req.body?.updates || [req.body];

      for (const update of updates) {
        if (update.update_type === 'bot_started') {
          const user = update.user;
          if (!user?.user_id) continue;
          // chat_id для bot_started: берём из update.chat или fallback к user_id
          const startChatId = update.chat?.chat_id || user.user_id;
          logger.log(`[BOT] [${user.name || user.user_id}] bot_started chatId=${startChatId}`);
          await handleBotStarted(startChatId, String(startChatId), update.payload);
          continue;
        }

        if (update.update_type !== 'message_created') continue;

        const msg = update.message;
        const sender = msg?.sender;
        if (!sender?.user_id) continue;

        // MAX API: для отправки ответа нужен chat_id, а не user_id
        // Используем chat_id как единый ключ сессий и цель для sendMessage
        const chatId = msg?.recipient?.chat_id || sender.user_id;
        const senderId = chatId;
        const phone = String(chatId);
        const text = msg?.body?.text || '';

        if (!text.trim()) continue;

        logger.log(`[BOT] [${sender.name || sender.user_id}] chatId=${chatId} ${text}`);
        await handleCommand(senderId, phone, text);
      }
    } catch (err) {
      logger.error('[BOT] Ошибка обработки webhook:', err.message);
    }
  });
}

module.exports = {
  registerBotRoutes,
};
