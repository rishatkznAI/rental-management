function registerBotRoutes(app, deps) {
  const {
    handleCommand,
    handleBotStarted,
    logger = console,
  } = deps;

  app.post('/bot/webhook', async (req, res) => {
    res.sendStatus(200);

    try {
      // Полная структура для отладки
      logger.log('[BOT] RAW body keys:', Object.keys(req.body || {}));
      logger.log('[BOT] RAW body:', JSON.stringify(req.body).slice(0, 600));
      const updates = req.body?.updates || [req.body];

      for (const update of updates) {
        if (update.update_type === 'bot_started') {
          const user = update.user;
          if (!user?.user_id) continue;
          const startReplyTarget = {
            chat_id: update.chat_id || update.chatId || update.recipient?.chat_id || user.chat_id,
            user_id: user.user_id,
          };
          logger.log(`[BOT] [${user.name || user.user_id}] bot_started target=${JSON.stringify(startReplyTarget)}`);
          await handleBotStarted(startReplyTarget, String(user.user_id), update.payload);
          continue;
        }

        if (update.update_type !== 'message_created') continue;

        const msg = update.message;
        const sender = msg?.sender;
        if (!sender?.user_id) continue;

        logger.log('[BOT] msg.recipient:', JSON.stringify(msg?.recipient));
        logger.log('[BOT] msg.sender:', JSON.stringify(sender));

        const replyTarget = {
          chat_id: msg?.recipient?.chat_id,
          user_id: sender.user_id,
        };
        const senderId = replyTarget;
        const phone = String(sender.user_id);
        const text = msg?.body?.text || '';

        if (!text.trim()) continue;

        logger.log(`[BOT] [${sender.name || sender.user_id}] replyTarget=${JSON.stringify(replyTarget)} ${text}`);
        await handleCommand(senderId, phone, text);
      }
    } catch (err) {
      logger.error('[BOT] Ошибка обработки webhook:', err?.message || String(err));
      logger.error('[BOT] Stack:', err?.stack || 'no stack');
    }
  });
}

module.exports = {
  registerBotRoutes,
};
