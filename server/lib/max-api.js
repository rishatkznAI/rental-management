const fs = require('fs');
const path = require('path');

function createMaxApiClient({
  botToken,
  maxApiBase,
  fetchImpl,
  webhookUrl,
  webhookPath = '/bot/webhook',
  logger = console,
  requestTimeoutMs = Number(process.env.MAX_API_TIMEOUT_MS || 8000),
  slowRequestMs = Number(process.env.MAX_API_SLOW_MS || 1500),
  useNativeUpload = true,
  publicAssetBaseUrl = webhookUrl,
}) {
  const uploadPayloadCache = new Map();

  function normalizeCallbackNotification(value) {
    if (!value) return null;
    if (typeof value === 'string') return value;
    if (typeof value.text === 'string') return value.text;
    return String(value);
  }

  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async function readResponseJson(res) {
    if (!res) return null;
    if (typeof res.json === 'function') return res.json();
    if (typeof res.text === 'function') {
      const text = await res.text();
      if (!text) return {};
      try {
        return JSON.parse(text);
      } catch {
        return { raw: text };
      }
    }
    return null;
  }

  function createAbortSignal() {
    const controller = typeof AbortController !== 'undefined' && requestTimeoutMs > 0
      ? new AbortController()
      : null;
    const timeout = controller
      ? setTimeout(() => controller.abort(), requestTimeoutMs)
      : null;
    return { controller, timeout };
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

  function resolveUserRecipientQuery(target) {
    if (!target || typeof target !== 'object') return null;
    const userId = target.userId ?? target.user_id;
    if (!userId) return null;
    return `user_id=${encodeURIComponent(userId)}`;
  }

  async function maxRequest(method, endpoint, body = null) {
    const token = (botToken || '').trim();
    const url = `${maxApiBase}${endpoint}`;
    logger.log(`[MAX API] token prefix="${token.slice(0, 8)}" len=${token.length}`);
    const { controller, timeout } = createAbortSignal();
    const opts = {
      method,
      headers: {
        Authorization: token,
        'Content-Type': 'application/json',
      },
      ...(controller ? { signal: controller.signal } : {}),
    };
    if (body != null) opts.body = JSON.stringify(body);

    const startedAt = Date.now();
    try {
      const res = await fetchImpl(url, opts);
      const json = await readResponseJson(res);
      const elapsedMs = Date.now() - startedAt;
      if (elapsedMs > slowRequestMs) {
        logger.warn(`[MAX API] Медленный запрос ${method} ${endpoint}: ${elapsedMs}ms`);
      }
      if (json.error) {
        logger.error(`[MAX API] Ошибка ответа (${endpoint}):`, JSON.stringify(json));
      }
      return json;
    } catch (err) {
      const elapsedMs = Date.now() - startedAt;
      const timedOut = err?.name === 'AbortError';
      logger.error(timedOut
        ? `[MAX API] Таймаут ${method} ${endpoint} после ${elapsedMs}ms`
        : `[MAX API] Ошибка ${method} ${endpoint}: ${err.message}`);
      return null;
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }

  function mimeTypeForFile(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    return ({
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.bmp': 'image/bmp',
      '.tif': 'image/tiff',
      '.tiff': 'image/tiff',
      '.heic': 'image/heic',
    })[ext] || 'application/octet-stream';
  }

  function multipartFileBody(filePath) {
    const boundary = `----rental-mgmt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const filename = path.basename(filePath).replace(/"/g, '');
    const fileBuffer = fs.readFileSync(filePath);
    const header = Buffer.from(
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="data"; filename="${filename}"\r\n` +
      `Content-Type: ${mimeTypeForFile(filePath)}\r\n\r\n`,
    );
    const footer = Buffer.from(`\r\n--${boundary}--\r\n`);
    return {
      body: Buffer.concat([header, fileBuffer, footer]),
      contentType: `multipart/form-data; boundary=${boundary}`,
    };
  }

  async function uploadWithNativeFormData(uploadUrl, resolved, uploadType, signal) {
    if (
      typeof globalThis.fetch !== 'function' ||
      typeof globalThis.FormData !== 'function' ||
      typeof globalThis.Blob !== 'function'
    ) {
      return null;
    }

    const formData = new globalThis.FormData();
    const bytes = fs.readFileSync(resolved);
    formData.append(
      'data',
      new globalThis.Blob([bytes], { type: mimeTypeForFile(resolved) }),
      path.basename(resolved),
    );

    const res = await globalThis.fetch(uploadUrl, {
      method: 'POST',
      body: formData,
      ...(signal ? { signal } : {}),
    });
    const payload = await readResponseJson(res);
    logger.log(`[MAX API] native upload ${uploadType} ${path.basename(resolved)} status=${res.status}`);
    return payload;
  }

  function attachmentUploadType(attachment) {
    const type = String(attachment?.type || '').trim();
    return ['image', 'file', 'video', 'audio'].includes(type) ? type : 'image';
  }

  function localAttachmentPath(attachment) {
    const payload = attachment?.payload || {};
    return payload.file || payload.path || payload.localPath || '';
  }

  function publicAttachmentUrl(attachment) {
    const payload = attachment?.payload || {};
    if (payload.url) return payload.url;
    if (!payload.publicPath || !publicAssetBaseUrl) return '';
    try {
      return new URL(payload.publicPath, publicAssetBaseUrl).toString();
    } catch {
      return '';
    }
  }

  function fileCacheKey(filePath, uploadType) {
    const resolved = path.resolve(filePath);
    const stat = fs.statSync(resolved);
    if (!stat.isFile()) throw new Error(`Файл вложения не найден: ${resolved}`);
    return {
      resolved,
      key: `${uploadType}:${resolved}:${stat.size}:${Math.round(stat.mtimeMs)}`,
    };
  }

  async function uploadLocalAttachment(attachment) {
    const uploadType = attachmentUploadType(attachment);
    const { resolved, key } = fileCacheKey(localAttachmentPath(attachment), uploadType);
    if (uploadPayloadCache.has(key)) {
      return uploadPayloadCache.get(key);
    }

    const uploadPromise = (async () => {
      const uploadInfo = await maxRequest('POST', `/uploads?type=${encodeURIComponent(uploadType)}`);
      const uploadUrl = uploadInfo?.url;
      if (!uploadUrl) {
        throw new Error(`MAX не вернул URL загрузки для ${path.basename(resolved)}`);
      }

      const token = (botToken || '').trim();
      const { controller, timeout } = createAbortSignal();
      const startedAt = Date.now();
      try {
        let payload = null;
        if (useNativeUpload) {
          try {
            payload = await uploadWithNativeFormData(
              uploadUrl,
              resolved,
              uploadType,
              controller?.signal,
            );
          } catch (error) {
            logger.warn(`[MAX API] native upload fallback ${path.basename(resolved)}: ${error.message}`);
          }
        }
        if (!payload) {
          const { body, contentType } = multipartFileBody(resolved);
          const res = await fetchImpl(uploadUrl, {
            method: 'POST',
            headers: {
              Authorization: token,
              'Content-Type': contentType,
              'Content-Length': String(body.length),
            },
            body,
            ...(controller ? { signal: controller.signal } : {}),
          });
          payload = await readResponseJson(res);
        }
        const elapsedMs = Date.now() - startedAt;
        if (elapsedMs > slowRequestMs) {
          logger.warn(`[MAX API] Медленная загрузка ${uploadType} ${path.basename(resolved)}: ${elapsedMs}ms`);
        }
        if (!payload || payload.error || (!payload.token && !payload.payload && !payload.url)) {
          throw new Error(`MAX не принял вложение ${path.basename(resolved)}: ${JSON.stringify(payload)}`);
        }
        logger.log(`[MAX API] upload ${uploadType} ${path.basename(resolved)} accepted`);
        return payload.payload || payload;
      } catch (err) {
        const elapsedMs = Date.now() - startedAt;
        const timedOut = err?.name === 'AbortError';
        throw new Error(timedOut
          ? `таймаут загрузки ${path.basename(resolved)} после ${elapsedMs}ms`
          : err.message);
      } finally {
        if (timeout) clearTimeout(timeout);
      }
    })();

    uploadPayloadCache.set(key, uploadPromise);
    try {
      return await uploadPromise;
    } catch (error) {
      uploadPayloadCache.delete(key);
      throw error;
    }
  }

  async function prepareAttachments(attachments) {
    if (!Array.isArray(attachments)) return attachments;
    const prepared = [];
    for (const attachment of attachments) {
      const filePath = localAttachmentPath(attachment);
      const publicUrl = attachmentUploadType(attachment) === 'image'
        ? publicAttachmentUrl(attachment)
        : '';
      if (publicUrl) {
        prepared.push({
          type: 'image',
          payload: { url: publicUrl },
        });
        continue;
      }
      if (!filePath) {
        prepared.push(attachment);
        continue;
      }
      try {
        const payload = await uploadLocalAttachment(attachment);
        prepared.push({
          type: attachmentUploadType(attachment),
          payload,
        });
      } catch (error) {
        logger.error(`[MAX API] Не удалось подготовить вложение ${filePath}: ${error.message}`);
      }
    }
    return prepared;
  }

  function isAttachmentNotReady(response) {
    const code = response?.code || response?.error?.code || response?.error;
    return code === 'attachment.not.ready';
  }

  function isChatNotFound(response) {
    const code = response?.code || response?.error?.code || response?.error;
    return code === 'chat.not.found';
  }

  async function sendMessage(target, text, options = {}) {
    let recipientQuery = resolveRecipientQuery(target);
    logger.log(`[MAX API] sendMessage → ${recipientQuery} text="${String(text).slice(0, 60)}"`);
    const attachments = await prepareAttachments(options.attachments);
    const body = {
      text,
      ...(attachments ? { attachments } : {}),
      ...(options.format ? { format: options.format } : {}),
      ...(options.notify != null ? { notify: options.notify } : {}),
    };
    let res = await maxRequest('POST', `/messages?${recipientQuery}`, body);
    if (isChatNotFound(res)) {
      const userRecipientQuery = resolveUserRecipientQuery(target);
      if (userRecipientQuery && userRecipientQuery !== recipientQuery) {
        logger.warn(`[MAX API] ${recipientQuery} не найден, повторяем отправку через ${userRecipientQuery}`);
        recipientQuery = userRecipientQuery;
        res = await maxRequest('POST', `/messages?${recipientQuery}`, body);
      }
    }
    for (const delayMs of options.attachmentRetryDelaysMs || [800, 1600]) {
      if (!isAttachmentNotReady(res)) break;
      logger.warn(`[MAX API] Вложение ещё обрабатывается, повтор отправки через ${delayMs}ms`);
      await sleep(delayMs);
      res = await maxRequest('POST', `/messages?${recipientQuery}`, body);
    }
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
