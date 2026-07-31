const {
  DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT,
  createCanonicalActualPostingRuntimeContract,
} = require('./canonical-actual-posting-domain');
const { envFlagEnabled } = require('./feature-flags');

const CANONICAL_ACTUAL_POSTING_RUNTIME_FLAG = 'CANONICAL_ACTUAL_POSTING_RUNTIME_ENABLED';
const CANONICAL_ACTUAL_POSTING_AUTHORITIES_ENV = 'CANONICAL_ACTUAL_POSTING_RUNTIME_AUTHORITIES_JSON';
const CANONICAL_ACTUAL_POSTING_TRIGGER_TOKEN_ENV = 'CANONICAL_ACTUAL_POSTING_TRIGGER_TOKEN';
const MIN_TRIGGER_TOKEN_BYTES = 32;

function firstEnvironmentLabel(env) {
  return String(
    env.APP_ENVIRONMENT
    || env.APP_ENV
    || env.RAILWAY_ENVIRONMENT_NAME
    || env.RAILWAY_ENVIRONMENT
    || env.NODE_ENV
    || '',
  ).trim().toLowerCase();
}

function isStagingEnvironment(label) {
  return /^(?:staging|stage|test)(?:[-_].*)?$/.test(label);
}

function hasExplicitProductionEnvironment(env) {
  return [
    env.APP_ENVIRONMENT,
    env.APP_ENV,
    env.RAILWAY_ENVIRONMENT_NAME,
    env.RAILWAY_ENVIRONMENT,
  ].some(value => /^(?:production|prod)(?:[-_].*)?$/.test(String(value || '').trim().toLowerCase()));
}

function disabledConfig({ requested, environment, reason }) {
  return Object.freeze({
    diagnostics: Object.freeze({
      enabled: false,
      environment: environment || 'unknown',
      productionAllowed: false,
      reason,
      requested,
      triggerTokenConfigured: false,
    }),
    enabled: false,
    runtimeContract: DISABLED_CANONICAL_ACTUAL_POSTING_RUNTIME_CONTRACT,
    triggerToken: null,
  });
}

function buildCanonicalActualPostingRuntimeConfig(env = process.env) {
  const requested = envFlagEnabled(env[CANONICAL_ACTUAL_POSTING_RUNTIME_FLAG]);
  const environment = firstEnvironmentLabel(env);
  if (!requested) return disabledConfig({ requested, environment, reason: 'flag_disabled' });
  if (hasExplicitProductionEnvironment(env) || !isStagingEnvironment(environment)) {
    return disabledConfig({ requested, environment, reason: 'staging_environment_required' });
  }

  const triggerToken = String(env[CANONICAL_ACTUAL_POSTING_TRIGGER_TOKEN_ENV] || '');
  if (Buffer.byteLength(triggerToken, 'utf8') < MIN_TRIGGER_TOKEN_BYTES) {
    return disabledConfig({ requested, environment, reason: 'trigger_token_missing_or_short' });
  }

  let authorities;
  try {
    authorities = JSON.parse(String(env[CANONICAL_ACTUAL_POSTING_AUTHORITIES_ENV] || ''));
  } catch {
    return disabledConfig({ requested, environment, reason: 'authorities_json_invalid' });
  }

  let runtimeContract;
  try {
    runtimeContract = createCanonicalActualPostingRuntimeContract({
      authorities,
      enabled: true,
      version: 1,
    });
  } catch {
    return disabledConfig({ requested, environment, reason: 'authorities_contract_invalid' });
  }

  return Object.freeze({
    diagnostics: Object.freeze({
      enabled: true,
      environment,
      productionAllowed: false,
      reason: 'staging_enabled',
      requested,
      triggerTokenConfigured: true,
    }),
    enabled: true,
    runtimeContract,
    triggerToken,
  });
}

function logCanonicalActualPostingRuntimeConfig(config, logger = console) {
  const message = `[canonical-actual-posting] runtime ${JSON.stringify(config.diagnostics)}`;
  if (config.enabled) logger.log?.(message);
  else if (config.diagnostics.requested) logger.warn?.(message);
  else logger.log?.(message);
}

module.exports = {
  CANONICAL_ACTUAL_POSTING_AUTHORITIES_ENV,
  CANONICAL_ACTUAL_POSTING_RUNTIME_FLAG,
  CANONICAL_ACTUAL_POSTING_TRIGGER_TOKEN_ENV,
  MIN_TRIGGER_TOKEN_BYTES,
  buildCanonicalActualPostingRuntimeConfig,
  hasExplicitProductionEnvironment,
  isStagingEnvironment,
  logCanonicalActualPostingRuntimeConfig,
};
