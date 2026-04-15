function registerBotRoutes(app, deps) {
  const {
    handleCommand,
    handleBotStarted,
    handleCallback,
    answerCallback,
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

        if (update.update_type === 'message_callback') {
          const callback = update.callback || update.message_callback || update.messageCallback || {};
          const callbackId = callback.callback_id || callback.callbackId || update.callback_id;
          const payload = callback.payload || callback.data || update.payload || '';
          const sender = callback.sender || callback.user || update.user || {};
          const recipient = callback.recipient || update.recipient || {};
          const replyTarget = {
            chat_id: recipient.chat_id || recipient.chatId || update.chat_id || update.chatId,
            user_id: sender.user_id || sender.userId || update.user_id,
          };
          const phone = String(replyTarget.user_id || '');

          logger.log(`[BOT] callback payload=${payload} target=${JSON.stringify(replyTarget)}`);
          await answerCallback(callbackId, { notification: { text: 'Обрабатываю...' } });
          await handleCallback(replyTarget, phone, String(payload || ''), callback);
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
        const attachments = msg?.body?.attachments || msg?.attachments || [];

        if (!text.trim() && (!Array.isArray(attachments) || attachments.length === 0)) continue;

        logger.log(`[BOT] [${sender.name || sender.user_id}] replyTarget=${JSON.stringify(replyTarget)} text="${text}" attachments=${Array.isArray(attachments) ? attachments.length : 0}`);
        await handleCommand(senderId, phone, text, { message: msg, body: msg?.body, attachments });
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
