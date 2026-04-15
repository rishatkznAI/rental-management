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
          logger.log(`[BOT] [${user.name || user.user_id}] bot_started`);
          await handleBotStarted(user.user_id, user.user_id, update.payload);
          continue;
        }

        if (update.update_type !== 'message_created') continue;

        const msg = update.message;
        const sender = msg?.sender;
        if (!sender?.user_id) continue;

        const senderId = sender.user_id;
        const phone = sender.user_id;
        const text = msg?.body?.text || '';

        if (!text.trim()) continue;

        logger.log(`[BOT] [${sender.name || senderId}] ${text}`);
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
