import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  shouldWarnForMissingMaxWebhookSecret,
} = require('../server/lib/feature-flags.js');
const { createMaxApiClient } = require('../server/lib/max-api.js');

function collectLogger() {
  const entries = [];
  return {
    entries,
    log: (...args) => entries.push(['log', args.join(' ')]),
    warn: (...args) => entries.push(['warn', args.join(' ')]),
    error: (...args) => entries.push(['error', args.join(' ')]),
  };
}

test('disabled bot without MAX_WEBHOOK_SECRET does not warn', () => {
  assert.equal(shouldWarnForMissingMaxWebhookSecret({
    botDisabled: true,
    transport: 'webhook',
    webhookSecret: '',
  }), false);
});

test('enabled webhook transport without MAX_WEBHOOK_SECRET warns', () => {
  assert.equal(shouldWarnForMissingMaxWebhookSecret({
    botDisabled: false,
    transport: 'webhook',
    webhookSecret: '',
  }), true);
});

test('MAX_WEBHOOK_SECRET value is not needed or logged for warning decision', () => {
  const logger = collectLogger();
  const secret = 'super-secret-webhook-value';

  assert.equal(shouldWarnForMissingMaxWebhookSecret({
    botDisabled: false,
    transport: 'webhook',
    webhookSecret: secret,
  }), false);

  assert.doesNotMatch(logger.entries.map(([, message]) => message).join('\n'), /super-secret-webhook-value/);
});

test('disabled bot keeps webhook registration skipped without calling MAX', async () => {
  const logger = collectLogger();
  let fetchCalled = false;
  const client = createMaxApiClient({
    botToken: 'bot-token',
    webhookUrl: 'https://app.example.test',
    webhookSecret: '',
    fetchImpl: async () => {
      fetchCalled = true;
      return { json: async () => ({ ok: true }) };
    },
    logger,
    botDisabled: true,
  });

  const result = await client.registerWebhook();

  assert.deepEqual(result, { ok: true, disabled: true });
  assert.equal(fetchCalled, false);
  assert.match(logger.entries.map(([, message]) => message).join('\n'), /BOT_DISABLED=true/);
  assert.equal(logger.entries.some(([level]) => level === 'warn' || level === 'error'), false);
});
