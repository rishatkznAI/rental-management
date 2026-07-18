const DEFAULT_APP_DISABLED_MESSAGE = 'Система временно отключена. Обратитесь к администратору.';
const DEFAULT_BOT_DISABLED_MESSAGE = 'Бот временно отключён. Обратитесь к администратору.';
const DEFAULT_GSM_DISABLED_MESSAGE = 'GSM/GPRS ingest временно отключён.';

function envFlagEnabled(value) {
  return ['1', 'true', 'yes', 'on', 'enabled'].includes(String(value || '').trim().toLowerCase());
}

function envFlagDisabled(value) {
  return ['0', 'false', 'no', 'off', 'disabled'].includes(String(value || '').trim().toLowerCase());
}

function getAppDisabledConfig(env = process.env) {
  return {
    disabled: envFlagEnabled(env.APP_DISABLED),
    message: String(env.APP_DISABLED_MESSAGE || DEFAULT_APP_DISABLED_MESSAGE).trim() || DEFAULT_APP_DISABLED_MESSAGE,
  };
}

function getBotDisabledConfig(env = process.env) {
  return {
    disabled: envFlagEnabled(env.BOT_DISABLED),
    message: String(env.BOT_DISABLED_MESSAGE || DEFAULT_BOT_DISABLED_MESSAGE).trim() || DEFAULT_BOT_DISABLED_MESSAGE,
  };
}

function getGsmDisabledConfig(env = process.env) {
  return {
    disabled: envFlagEnabled(env.GSM_DISABLED) || envFlagDisabled(env.GSM_ENABLED),
    message: String(env.GSM_DISABLED_MESSAGE || DEFAULT_GSM_DISABLED_MESSAGE).trim() || DEFAULT_GSM_DISABLED_MESSAGE,
  };
}

function isCanonicalReceivablesReadApiEnabled(env = process.env) {
  return envFlagEnabled(env.CANONICAL_RECEIVABLES_READ_API_ENABLED);
}

function isForecastReceivablesReadApiEnabled(env = process.env) {
  return envFlagEnabled(env.FORECAST_RECEIVABLES_READ_API_ENABLED);
}

function shouldWarnForMissingMaxWebhookSecret({ botDisabled = false, transport = '', webhookSecret = '' } = {}) {
  return !botDisabled &&
    String(transport || '').trim().toLowerCase() === 'webhook' &&
    !String(webhookSecret || '').trim();
}

function buildDisabledResponse(config, code) {
  return {
    ok: false,
    code,
    error: config.message,
    message: config.message,
  };
}

function sendAppDisabled(res, config = getAppDisabledConfig()) {
  return res.status(503).json(buildDisabledResponse(config, 'APP_DISABLED'));
}

function createAppDisabledMiddleware({ getConfig = getAppDisabledConfig } = {}) {
  return function appDisabledMiddleware(req, res, next) {
    const config = getConfig();
    if (!config.disabled) return next();

    const path = String(req.path || req.originalUrl || '').split('?')[0];
    if (path === '/version') return next();

    return sendAppDisabled(res, config);
  };
}

module.exports = {
  DEFAULT_APP_DISABLED_MESSAGE,
  DEFAULT_BOT_DISABLED_MESSAGE,
  DEFAULT_GSM_DISABLED_MESSAGE,
  buildDisabledResponse,
  createAppDisabledMiddleware,
  envFlagDisabled,
  envFlagEnabled,
  getAppDisabledConfig,
  getBotDisabledConfig,
  getGsmDisabledConfig,
  isCanonicalReceivablesReadApiEnabled,
  isForecastReceivablesReadApiEnabled,
  sendAppDisabled,
  shouldWarnForMissingMaxWebhookSecret,
};
