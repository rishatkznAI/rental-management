import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { registerBotRoutes } = require('../server/routes/bot.js');
const { createMaxApiClient } = require('../server/lib/max-api.js');

function createMockResponse() {
  return {
    statusCode: 200,
    payload: undefined,
    sentStatus: undefined,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
    sendStatus(code) {
      this.sentStatus = code;
      this.statusCode = code;
      return this;
    },
  };
}

test('MAX webhook rejects unsigned requests when secret is configured', async () => {
  const routes = {};
  let handled = false;
  const app = {
    post(path, handler) { routes[path] = handler; },
  };

  registerBotRoutes(app, {
    webhookPath: '/bot/webhook',
    webhookSecret: 'secret-value',
    handleCommand: async () => { handled = true; },
    handleBotStarted: async () => { handled = true; },
    handleCallback: async () => { handled = true; },
    logger: { log: () => {}, warn: () => {}, error: () => {} },
  });

  const res = createMockResponse();
  await routes['/bot/webhook']({
    headers: {},
    params: {},
    query: {},
    body: { update_type: 'message_created' },
    ip: '127.0.0.1',
  }, res);

  assert.equal(res.statusCode, 401);
  assert.equal(handled, false);
});

test('MAX API logs token presence without leaking token prefix', async () => {
  const logs = [];
  const client = createMaxApiClient({
    botToken: 'super-secret-bot-token',
    maxApiBase: 'https://max.example.test',
    webhookUrl: 'https://app.example.test',
    webhookSecret: 'webhook-secret',
    fetchImpl: async () => ({
      json: async () => ({ ok: true }),
    }),
    logger: {
      log: (...args) => logs.push(args.join(' ')),
      warn: (...args) => logs.push(args.join(' ')),
      error: (...args) => logs.push(args.join(' ')),
    },
  });

  await client.sendMessage({ user_id: 100 }, 'test');
  await client.registerWebhook();

  const joined = logs.join('\n');
  assert.match(joined, /bot token configured: true/);
  assert.doesNotMatch(joined, /super-sec/);
  assert.doesNotMatch(joined, /webhook-secret/);
});
