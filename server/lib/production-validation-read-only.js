const EXPECTED_PRODUCTION_ENVIRONMENT = require('../config/production-scope-remediation-environment');
const {
  PRODUCTION_SMOKE_READER_EMAIL,
  PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
  PRODUCTION_SMOKE_READER_ROLE,
  PRODUCTION_SMOKE_REPLACEMENT_REASON,
  PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
} = require('./production-smoke-identity');

const VALIDATION_READ_ONLY_FLAG = 'PRODUCTION_SCOPE_REMEDIATION_VALIDATION_READ_ONLY';

const SAFE_HTTP_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const ALLOWED_TECHNICAL_MUTATIONS = new Set(['/api/auth/login']);
const VALIDATION_SMOKE_LOGIN_ALLOWED_OPERATIONS = new Set([
  'session write',
  'collection compare-and-swap batch write',
  'collection write (audit_logs)',
]);
let validationTechnicalWriteDepth = 0;

class ProductionValidationReadOnlyError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'ProductionValidationReadOnlyError';
    this.code = code;
  }
}

function requested(env = process.env) {
  return env[VALIDATION_READ_ONLY_FLAG] === 'true';
}

function isExactProductionSmokeReaderUser(user) {
  return Boolean(user)
    && String(user.id || '').trim() === PRODUCTION_SMOKE_READER_PRINCIPAL_ID
    && String(user.email || '').trim().toLowerCase() === PRODUCTION_SMOKE_READER_EMAIL
    && String(user.role || '').trim() === PRODUCTION_SMOKE_READER_ROLE
    && user.status === 'Активен'
    && user.botOnly === false
    && user.allowFrontendLogin === true
    && user.frontendAccess === true
    && Number(user.tokenVersion) === 0
    && String(user.replacementForPrincipalId || '').trim() === PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID
    && String(user.replacementReason || '').trim() === PRODUCTION_SMOKE_REPLACEMENT_REASON;
}

function runWithProductionValidationSmokeLoginWrites(operation) {
  if (typeof operation !== 'function') {
    throw new TypeError('Production validation technical write scope requires an operation.');
  }
  if (validationTechnicalWriteDepth !== 0) {
    const error = new ProductionValidationReadOnlyError(
      'PRODUCTION_VALIDATION_TECHNICAL_SCOPE_REENTRANT',
      'Production validation technical write scope cannot be nested.',
    );
    throw error;
  }
  validationTechnicalWriteDepth += 1;
  try {
    return operation();
  } finally {
    validationTechnicalWriteDepth -= 1;
  }
}

function isProductionValidationSmokeLoginWriteScopeActive() {
  return validationTechnicalWriteDepth === 1;
}

function assertProductionValidationWriteAllowed(operation, env = process.env) {
  if (!requested(env)) return true;
  if (
    isProductionValidationSmokeLoginWriteScopeActive()
    && VALIDATION_SMOKE_LOGIN_ALLOWED_OPERATIONS.has(String(operation || ''))
  ) return true;
  const error = new ProductionValidationReadOnlyError(
    'PRODUCTION_VALIDATION_READ_ONLY_WRITE_BLOCKED',
    `Blocked ${String(operation || 'database write')}: production validation read-only mode is active.`,
  );
  error.status = 503;
  throw error;
}

function assertProductionValidationReadOnlyEnvironment(env = process.env) {
  if (!requested(env)) return false;

  const violations = [];
  if (env.NODE_ENV !== 'production') violations.push('NODE_ENV=production');
  if (env.DB_PATH !== EXPECTED_PRODUCTION_ENVIRONMENT.sourceDbPath) {
    violations.push(`DB_PATH=${EXPECTED_PRODUCTION_ENVIRONMENT.sourceDbPath}`);
  }
  if (env.RAILWAY_PROJECT_ID !== EXPECTED_PRODUCTION_ENVIRONMENT.projectId) {
    violations.push('exact Railway project');
  }
  if (env.RAILWAY_ENVIRONMENT_ID !== EXPECTED_PRODUCTION_ENVIRONMENT.environmentId) {
    violations.push('exact Railway environment');
  }
  if (env.RAILWAY_SERVICE_ID !== EXPECTED_PRODUCTION_ENVIRONMENT.serviceId) {
    violations.push('exact Railway service');
  }
  if (env.RAILWAY_VOLUME_NAME !== EXPECTED_PRODUCTION_ENVIRONMENT.volumeName) {
    violations.push('exact Railway volume name');
  }
  if (env.RAILWAY_VOLUME_MOUNT_PATH !== EXPECTED_PRODUCTION_ENVIRONMENT.volumeMountPath) {
    violations.push('exact Railway volume mount');
  }
  if (!String(env.RAILWAY_REPLICA_ID || '').trim()) violations.push('nonempty Railway replica ID');
  if (!/^[a-f0-9]{40}$/.test(String(env.RAILWAY_GIT_COMMIT_SHA || '').trim().toLowerCase())) {
    violations.push('immutable Railway deployed SHA');
  }
  if (env.PRODUCTION_SCOPE_REMEDIATION_ENABLED !== 'false') {
    violations.push('PRODUCTION_SCOPE_REMEDIATION_ENABLED=false');
  }
  if (env.PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE !== 'false') {
    violations.push('PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE=false');
  }
  if (env.PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY !== 'false') {
    violations.push('PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY=false');
  }
  if (String(env.PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES ?? '').trim() !== '') {
    violations.push('PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES empty');
  }
  if (String(env.PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE ?? '').trim() !== '') {
    violations.push('PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE empty');
  }
  if (env.APP_DISABLED !== 'false') violations.push('APP_DISABLED=false');
  if (env.BOT_DISABLED !== 'true') violations.push('BOT_DISABLED=true');
  if (env.GSM_DISABLED !== 'true') violations.push('GSM_DISABLED=true');
  if (env.GSM_ENABLED !== 'false') violations.push('GSM_ENABLED=false');
  if (env.SKYTECH_CLEAN_RESET_ENABLED !== 'false') {
    violations.push('SKYTECH_CLEAN_RESET_ENABLED=false');
  }
  if (env.SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED !== 'false') {
    violations.push('SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED=false');
  }
  if (env.SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA !== '') {
    violations.push('SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA empty');
  }
  if (String(env.ADMIN_RESET_PASSWORD ?? '') !== '') violations.push('ADMIN_RESET_PASSWORD empty');
  if (String(env.SKYTECH_CLEAN_RESET_TOKEN ?? '') !== '') {
    violations.push('SKYTECH_CLEAN_RESET_TOKEN empty');
  }
  if (String(env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN ?? '') !== '') {
    violations.push('SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN empty');
  }
  if (String(env.PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET ?? '') !== '') {
    violations.push('PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET empty');
  }

  if (violations.length > 0) {
    throw new ProductionValidationReadOnlyError(
      'PRODUCTION_VALIDATION_READ_ONLY_CONSERVATION_REQUIRED',
      `Production validation read-only mode requires exact conservation controls: ${violations.join(', ')}.`,
    );
  }
  return true;
}

function normalizedRequestPath(req) {
  const raw = String(req?.originalUrl || req?.url || req?.path || '').split('?')[0];
  if (!raw) return '/';
  return raw.length > 1 ? raw.replace(/\/+$/, '') : raw;
}

function isExactProductionSmokeLogin(req) {
  const body = req?.body;
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const keys = Object.keys(body).sort();
  const exactShape = JSON.stringify(keys) === JSON.stringify(['email', 'password'])
    || JSON.stringify(keys) === JSON.stringify(['login', 'password']);
  if (!exactShape) return false;
  const login = String(body.login ?? body.email ?? '').trim().toLowerCase();
  return login === PRODUCTION_SMOKE_READER_EMAIL
    && typeof body.password === 'string'
    && body.password.length > 0
    && body.password.length <= 1024;
}

function createProductionValidationReadOnlyMiddleware({
  env = process.env,
  getEnabled = () => requested(env),
} = {}) {
  return function productionValidationReadOnlyMiddleware(req, res, next) {
    if (!getEnabled()) return next();

    const method = String(req.method || '').trim().toUpperCase();
    const requestPath = normalizedRequestPath(req);
    if (SAFE_HTTP_METHODS.has(method)) return next();
    if (
      method === 'POST'
      && ALLOWED_TECHNICAL_MUTATIONS.has(requestPath)
      && isExactProductionSmokeLogin(req)
    ) return next();

    res.setHeader('Retry-After', '60');
    return res.status(503).json({
      ok: false,
      code: 'PRODUCTION_VALIDATION_READ_ONLY',
      error: 'Production verification is in progress; business writes are temporarily blocked.',
    });
  };
}

module.exports = {
  ALLOWED_TECHNICAL_MUTATIONS,
  SAFE_HTTP_METHODS,
  VALIDATION_READ_ONLY_FLAG,
  ProductionValidationReadOnlyError,
  assertProductionValidationReadOnlyEnvironment,
  assertProductionValidationWriteAllowed,
  createProductionValidationReadOnlyMiddleware,
  isExactProductionSmokeLogin,
  isExactProductionSmokeReaderUser,
  isProductionValidationSmokeLoginWriteScopeActive,
  normalizedRequestPath,
  requested,
  runWithProductionValidationSmokeLoginWrites,
};
