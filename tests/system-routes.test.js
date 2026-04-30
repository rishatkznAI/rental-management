import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');

const { registerSystemRoutes } = require('../server/routes/system.js');

function createSystemApp() {
  const app = express();
  const messages = [];
  app.use(express.json());
  registerSystemRoutes(app, {
    readData: () => [],
    writeData: () => {},
    getSnapshot: () => ({}),
    saveSnapshot: () => {},
    botToken: 'token-present',
    getBotUsers: () => ({}),
    sendMessage: async (target, text) => {
      messages.push({ target, text });
      return { ok: true };
    },
    countActiveSessions: () => 0,
    dbPath: ':memory:',
    webhookUrl: '',
    requireAuth: (req, _res, next) => {
      req.user = { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' };
      next();
    },
    requireAdmin: (_req, _res, next) => next(),
    auditLog: () => {},
    getBuildInfo: () => ({ version: 'test' }),
  });
  return { app, messages };
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function getJson(baseUrl, path) {
  const response = await fetch(`${baseUrl}${path}`);
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

test('/api/bot-test requires explicit chatId or env chat id', async () => {
  const previousEnabled = process.env.ENABLE_BOT_TEST;
  const previousChatId = process.env.BOT_TEST_CHAT_ID;
  process.env.ENABLE_BOT_TEST = '1';
  delete process.env.BOT_TEST_CHAT_ID;
  const { app, messages } = createSystemApp();

  try {
    await withServer(app, async (baseUrl) => {
      const response = await getJson(baseUrl, '/api/bot-test');
      assert.equal(response.status, 400);
      assert.match(response.body.error, /chatId is required/);
      assert.equal(messages.length, 0);
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_BOT_TEST;
    else process.env.ENABLE_BOT_TEST = previousEnabled;
    if (previousChatId === undefined) delete process.env.BOT_TEST_CHAT_ID;
    else process.env.BOT_TEST_CHAT_ID = previousChatId;
  }
});

test('/api/bot-test sends only to provided chatId', async () => {
  const previousEnabled = process.env.ENABLE_BOT_TEST;
  const previousChatId = process.env.BOT_TEST_CHAT_ID;
  process.env.ENABLE_BOT_TEST = '1';
  delete process.env.BOT_TEST_CHAT_ID;
  const { app, messages } = createSystemApp();

  try {
    await withServer(app, async (baseUrl) => {
      const response = await getJson(baseUrl, '/api/bot-test?chatId=777&text=ping');
      assert.equal(response.status, 200);
      assert.equal(response.body.chatId, 777);
      assert.deepEqual(messages[0], { target: { chat_id: 777 }, text: 'ping' });
    });
  } finally {
    if (previousEnabled === undefined) delete process.env.ENABLE_BOT_TEST;
    else process.env.ENABLE_BOT_TEST = previousEnabled;
    if (previousChatId === undefined) delete process.env.BOT_TEST_CHAT_ID;
    else process.env.BOT_TEST_CHAT_ID = previousChatId;
  }
});
