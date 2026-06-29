const { isMechanicRole } = require('../lib/role-groups');
const {
  assertSafeAdminBulkReplaceInput,
  isAdminBulkReplaceBlockedField,
} = require('../lib/access-control');
const { redactAuditValue } = require('../lib/security-audit');
const { cleanupBackupArchive, createFullBackupArchive } = require('../lib/full-backup');
const { DEFAULT_ALLOWED_DOMAINS, DEFAULT_MAX_BYTES, archiveExternalPhotos } = require('../lib/external-photo-archive');
const {
  assertClientInnWriteAllowed,
  buildClientInnDuplicateReport,
  normalizeClientInnFields,
} = require('../lib/client-inn');
const {
  analyzeRentalEquipmentDiagnostics,
  planRentalEquipmentBackfill,
} = require('../lib/rental-equipment-diagnostics');
const {
  applyRepairPlan,
  buildAdminGanttRentalCleanupPreview,
  buildAdminGanttRentalRepairDiagnostics,
  buildBrokenGanttRentalsRepairPlan,
} = require('../lib/gantt-rental-repair-diagnostics');
const { buildRentalLinkDiagnostics } = require('../lib/rental-link-diagnostics');
const { buildDataIntegrityDiagnostics } = require('../lib/data-integrity-diagnostics');
const { buildServiceRepairQualityView } = require('../lib/service-repeat-breakdowns');
const {
  SYSTEM_FIXTURE_PROTECTED_CODE,
  SYSTEM_FIXTURE_PROTECTED_MESSAGE,
  assertProductionSmokeFixtureMutationAllowed,
} = require('../lib/protected-fixtures');
const {
  envFlagDisabled,
  envFlagEnabled,
  getBotDisabledConfig,
  getGsmDisabledConfig,
} = require('../lib/feature-flags');
const dns = require('dns');
const fs = require('fs');
const http = require('http');
const https = require('https');
const net = require('net');
const path = require('path');
const { execFileSync } = require('child_process');

const MAX_MEDIA_PROXY_BYTES = 10 * 1024 * 1024;
const MEDIA_PROXY_TIMEOUT_MS = 10_000;
const dnsPromises = dns.promises;

function isPrivateAddress(address) {
  if (!address) return true;
  if (address.startsWith('::ffff:')) {
    return isPrivateAddress(address.slice('::ffff:'.length));
  }

  const family = net.isIP(address);
  if (family === 4) {
    const parts = address.split('.').map(part => Number(part));
    if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return true;
    const [a, b] = parts;
    return a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51) ||
      (a === 203 && b === 0) ||
      a >= 224;
  }

  if (family === 6) {
    const normalized = address.toLowerCase();
    return normalized === '::1' ||
      normalized === '::' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      normalized.startsWith('fe80:') ||
      normalized.startsWith('ff') ||
      normalized.startsWith('2001:db8:');
  }

  return true;
}

async function assertPublicHttpUrl(sourceUrl) {
  let parsed;
  try {
    parsed = new URL(sourceUrl);
  } catch {
    throw new Error('Некорректный URL.');
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Поддерживаются только внешние http/https URL.');
  }
  if (parsed.username || parsed.password) {
    throw new Error('URL с учётными данными не поддерживаются.');
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname === 'localhost' || hostname.endsWith('.localhost')) {
    throw new Error('Внутренние адреса не поддерживаются.');
  }
  if (net.isIP(hostname)) {
    if (isPrivateAddress(hostname)) {
      throw new Error('Внутренние адреса не поддерживаются.');
    }
    return parsed;
  }

  const addresses = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  if (!addresses.length || addresses.some(item => isPrivateAddress(item.address))) {
    throw new Error('Внутренние адреса не поддерживаются.');
  }
  return parsed;
}

function createPublicLookup() {
  return (hostname, options, callback) => {
    dns.lookup(hostname, options, (error, address, family) => {
      if (error) {
        callback(error);
        return;
      }

      const entries = Array.isArray(address)
        ? address
        : [{ address, family }];
      if (!entries.length || entries.some(item => isPrivateAddress(item.address || item))) {
        callback(new Error('Внутренние адреса не поддерживаются.'));
        return;
      }

      if (Array.isArray(address)) {
        callback(null, address);
        return;
      }
      callback(null, address, family);
    });
  };
}

const mediaProxyLookup = createPublicLookup();
const mediaProxyHttpAgent = new http.Agent({ lookup: mediaProxyLookup });
const mediaProxyHttpsAgent = new https.Agent({ lookup: mediaProxyLookup });

function mediaProxyAgent(parsedUrl) {
  return parsedUrl.protocol === 'https:' ? mediaProxyHttpsAgent : mediaProxyHttpAgent;
}

const SYSTEM_DATA_COLLECTIONS = [
  'equipment',
  'rentals',
  'clients',
  'service',
  'documents',
  'payments',
  'debt_collection_plans',
  'debt_collection_actions',
  'receivable_payment_plans',
  'payroll_profiles',
  'payroll_periods',
  'payroll_records',
  'payroll_adjustments',
  'payroll_audit_events',
  'deliveries',
  'users',
  'owners',
  'mechanics',
  'delivery_carriers',
  'app_settings',
];

function nonEmptyString(...values) {
  return values.map(value => String(value || '').trim()).find(Boolean) || '';
}

function sendSystemFixtureProtectedError(req, res, auditLog, error) {
  auditLog?.(req, {
    action: `equipment.${error?.action || 'mutation'}.blocked`,
    entityType: 'equipment',
    entityId: error?.equipmentId,
    metadata: {
      reason: 'blocked_system_fixture_mutation',
      equipmentId: error?.equipmentId,
      userEmail: req.user?.email || null,
      attemptedFields: Array.isArray(error?.attemptedFields) ? error.attemptedFields : [],
      violations: Array.isArray(error?.violations) ? error.violations : [],
    },
  });
  return res.status(409).json({
    ok: false,
    code: SYSTEM_FIXTURE_PROTECTED_CODE,
    error: SYSTEM_FIXTURE_PROTECTED_MESSAGE,
    attemptedFields: Array.isArray(error?.attemptedFields) ? error.attemptedFields : [],
    violations: Array.isArray(error?.violations) ? error.violations : [],
  });
}

function runtimeEnvironment(env = process.env) {
  const nodeEnv = nonEmptyString(env.NODE_ENV);
  const appEnvironment = nonEmptyString(
    env.APP_ENVIRONMENT,
    env.APP_ENV,
    env.RAILWAY_ENVIRONMENT_NAME,
    env.RAILWAY_ENVIRONMENT,
    nodeEnv,
  );
  const haystack = `${nodeEnv} ${appEnvironment} ${env.RAILWAY_SERVICE_NAME || ''}`.toLowerCase();
  const appEnvironmentLower = appEnvironment.toLowerCase();
  const explicitStagingEnvironment = /\bstag(e|ing)?\b/.test(appEnvironmentLower) || /\btest\b/.test(appEnvironmentLower);
  const isProductionLike = !explicitStagingEnvironment && (/\bprod(uction)?\b/.test(haystack) || nodeEnv === 'production');
  const isStagingLike = explicitStagingEnvironment || /\bstag(e|ing)?\b/.test(haystack) || /\btest\b/.test(haystack);
  return {
    nodeEnv: nodeEnv || 'unknown',
    appEnvironment: appEnvironment || 'unknown',
    isProductionLike,
    isStagingLike,
  };
}

function safeDbPathLabel(dbPath) {
  const text = String(dbPath || '').trim();
  if (!text) return 'not configured';
  if (text === ':memory:') return ':memory:';
  const normalized = text.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  const tail = parts.slice(-2).join('/');
  return tail || path.basename(text) || 'configured';
}

function classifyDbPath(dbPath, envInfo, env = process.env) {
  const text = String(dbPath || '').trim();
  const lower = text.toLowerCase();
  const volumeMount = nonEmptyString(env.RAILWAY_VOLUME_MOUNT_PATH, env.RAILWAY_VOLUME_PATH, '/data');
  const volumeLower = volumeMount.toLowerCase();

  if (!text || text === ':memory:' || lower.includes('/server/data/')) {
    return 'local';
  }
  if (volumeLower && lower.startsWith(volumeLower) && envInfo.isProductionLike) {
    return 'production-volume';
  }
  if (volumeLower && lower.startsWith(volumeLower) && envInfo.isStagingLike) {
    return 'staging-volume';
  }
  if (lower.includes('/volume') || lower.includes('/mnt/')) {
    return envInfo.isProductionLike ? 'production-volume' : envInfo.isStagingLike ? 'staging-volume' : 'unknown';
  }
  return envInfo.isProductionLike || envInfo.isStagingLike ? 'unknown' : 'local';
}

function parseDfOutput(output) {
  const lines = String(output || '').trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return null;
  const parts = lines[lines.length - 1].trim().split(/\s+/);
  if (parts.length < 6) return null;
  return {
    device: parts[0] || '',
    totalKb: Number(parts[1]) || 0,
    usedKb: Number(parts[2]) || 0,
    freeKb: Number(parts[3]) || 0,
    capacity: parts[4] || '',
    mountPath: parts.slice(5).join(' ') || '',
  };
}

function inspectStorageSignal({ mountPath = '/data', execFile = execFileSync } = {}) {
  const safeMountPath = String(mountPath || '/data').trim() || '/data';
  const result = {
    mountPath: safeMountPath,
    available: false,
    signalPresent: false,
    device: '',
    statDevice: null,
    totalKb: null,
    usedKb: null,
    freeKb: null,
    capacity: '',
    error: '',
  };

  try {
    const stat = fs.statSync(safeMountPath);
    result.available = true;
    result.statDevice = Number.isFinite(Number(stat.dev)) ? Number(stat.dev) : null;
  } catch (error) {
    result.error = error?.code === 'ENOENT' ? 'mount-not-found' : 'mount-stat-unavailable';
    return result;
  }

  try {
    const output = execFile('df', ['-kP', safeMountPath], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1500,
    });
    const parsed = parseDfOutput(output);
    if (parsed) {
      result.signalPresent = true;
      result.device = parsed.device;
      result.totalKb = parsed.totalKb;
      result.usedKb = parsed.usedKb;
      result.freeKb = parsed.freeKb;
      result.capacity = parsed.capacity;
      result.mountPath = parsed.mountPath || safeMountPath;
    }
  } catch (_error) {
    result.error = result.error || 'df-unavailable';
  }

  return result;
}

function safeText(value, fallback = '') {
  const text = String(value ?? '').trim();
  if (!text || text === 'undefined' || text === 'null' || text === '[object Object]') return fallback;
  return text;
}

function safeEnvironmentLabel(environment) {
  if (environment.isProductionLike) return 'production';
  if (environment.isStagingLike) return 'staging';
  if (environment.nodeEnv === 'development') return 'development';
  return 'unknown';
}

function safeFrontendCommit({ requestCommit = '', env = process.env } = {}) {
  return safeText(
    requestCommit
    || env.FRONTEND_COMMIT
    || env.VITE_GIT_COMMIT
    || env.RAILWAY_GIT_COMMIT_SHA,
    'unknown',
  );
}

const KNOWN_RELEASE_TYPES = new Set([
  'frontend-only',
  'backend',
  'full-stack',
  'deploy-tooling',
  'frontend-deploy-tooling',
]);
const FRONTEND_DRIFT_RELEASE_TYPES = new Set([
  'frontend-only',
  'deploy-tooling',
  'frontend-deploy-tooling',
]);

function normalizeReleaseType(value = '') {
  const normalized = String(value || '').trim().toLowerCase();
  return KNOWN_RELEASE_TYPES.has(normalized) ? normalized : 'unknown';
}

function releaseTypeFromBuild(build = {}) {
  return normalizeReleaseType(
    build.releaseType
    || build.release_type
    || build.release?.type
    || build.release?.releaseType,
  );
}

function safeFrontendReleaseType({ requestReleaseType = '', env = process.env } = {}) {
  return normalizeReleaseType(
    requestReleaseType
    || env.FRONTEND_RELEASE_TYPE
    || env.VITE_RELEASE_TYPE,
  );
}

function commitsMatch(left = '', right = '') {
  const normalizedLeft = String(left || '').trim();
  const normalizedRight = String(right || '').trim();
  if (!normalizedLeft || !normalizedRight) return false;
  return normalizedLeft.startsWith(normalizedRight) || normalizedRight.startsWith(normalizedLeft);
}

function compareBuildTimes({ backendBuildTime = '', frontendBuildTime = '' } = {}) {
  const backendTime = Date.parse(String(backendBuildTime || ''));
  const frontendTime = Date.parse(String(frontendBuildTime || ''));
  if (!Number.isFinite(backendTime) || !Number.isFinite(frontendTime)) return 'unknown';
  if (Math.abs(backendTime - frontendTime) < 1000) return 'same';
  return backendTime > frontendTime ? 'backend-newer' : 'frontend-newer';
}

function classifyVersionRelease({
  backendCommit = '',
  frontendCommit = '',
  backendBuildTime = '',
  frontendBuildTime = '',
  backendReleaseType = 'unknown',
  frontendReleaseType = 'unknown',
  versionMatch = 'unknown',
} = {}) {
  const normalizedBackendType = normalizeReleaseType(backendReleaseType);
  const normalizedFrontendType = normalizeReleaseType(frontendReleaseType);
  const effectiveReleaseType = normalizedFrontendType !== 'unknown'
    ? normalizedFrontendType
    : normalizedBackendType;
  const buildOrder = compareBuildTimes({ backendBuildTime, frontendBuildTime });

  if (versionMatch === true) {
    return {
      status: 'ok',
      releaseType: effectiveReleaseType,
      backendReleaseType: normalizedBackendType,
      frontendReleaseType: normalizedFrontendType,
      buildOrder,
      compatible: true,
      message: 'Backend и frontend показывают один release commit.',
      action: 'Можно продолжать штатную работу.',
    };
  }

  if (versionMatch === 'unknown' || !backendCommit || !frontendCommit || backendCommit === 'unknown' || frontendCommit === 'unknown') {
    return {
      status: 'warning',
      releaseType: effectiveReleaseType,
      backendReleaseType: normalizedBackendType,
      frontendReleaseType: normalizedFrontendType,
      buildOrder,
      compatible: 'unknown',
      message: 'Commit backend или frontend не определён.',
      action: 'Проверить build metadata перед production-действиями.',
    };
  }

  if (FRONTEND_DRIFT_RELEASE_TYPES.has(effectiveReleaseType) && buildOrder !== 'backend-newer') {
    return {
      status: 'warning',
      releaseType: effectiveReleaseType,
      backendReleaseType: normalizedBackendType,
      frontendReleaseType: normalizedFrontendType,
      buildOrder,
      compatible: true,
      message: 'Frontend обновлён отдельно от backend. Это допустимо, если backend API не менялся.',
      action: 'Проверить, что release scope был frontend-only и backend API совместим.',
    };
  }

  return {
    status: 'risk',
    releaseType: effectiveReleaseType,
    backendReleaseType: normalizedBackendType,
    frontendReleaseType: normalizedFrontendType,
    buildOrder,
    compatible: false,
    message: 'Backend и frontend собраны из разных несовместимых release. Проверьте release перед production-действиями.',
    action: 'Остановить production-действия и выполнить корректный full-stack/backend deploy или подтвердить release_type.',
  };
}

function safeDbSizeBytes(dbPath) {
  const text = String(dbPath || '').trim();
  if (!text || text === ':memory:') return 0;
  try {
    const stat = fs.statSync(text);
    return Number.isFinite(Number(stat.size)) ? Number(stat.size) : 0;
  } catch {
    return 0;
  }
}

function safeWalPresent(dbPath) {
  const text = String(dbPath || '').trim();
  if (!text || text === ':memory:') return 'unknown';
  try {
    return fs.existsSync(`${text}-wal`);
  } catch {
    return 'unknown';
  }
}

function statusRank(status) {
  return { ok: 0, warning: 1, risk: 2, unknown: 1, danger: 2 }[status] ?? 1;
}

function highestStatus(statuses) {
  return statuses.reduce((highest, status) => (
    statusRank(status) > statusRank(highest) ? status : highest
  ), 'ok');
}

function traverseValues(value, visit) {
  visit(value);
  if (Array.isArray(value)) {
    value.forEach(item => traverseValues(item, visit));
    return;
  }
  if (isPlainObject(value)) {
    Object.values(value).forEach(item => traverseValues(item, visit));
  }
}

function buildDataRisks(readData) {
  const collections = [
    'equipment',
    'rentals',
    'gantt_rentals',
    'clients',
    'payments',
    'documents',
    'service',
    'deliveries',
    'warranty_claims',
    'repair_work_items',
    'repair_part_items',
  ];
  const risks = {
    undefinedLikeCount: 0,
    nullLikeCount: 0,
    objectObjectLikeCount: 0,
    brokenEquipmentLinks: 0,
    brokenRentalLinks: 0,
    brokenServiceLinks: 0,
  };

  for (const collection of collections) {
    const list = Array.isArray(readData?.(collection)) ? readData(collection) : [];
    traverseValues(list, value => {
      if (value === undefined || value === 'undefined') risks.undefinedLikeCount += 1;
      if (value === null || value === 'null') risks.nullLikeCount += 1;
      if (value === '[object Object]') risks.objectObjectLikeCount += 1;
    });
  }

  const equipmentIds = new Set((readData?.('equipment') || []).map(item => safeText(item?.id)).filter(Boolean));
  const rentalIds = new Set([
    ...(readData?.('rentals') || []),
    ...(readData?.('gantt_rentals') || []),
  ].map(item => safeText(item?.id || item?.rentalId)).filter(Boolean));
  const serviceIds = new Set((readData?.('service') || []).map(item => safeText(item?.id)).filter(Boolean));

  const equipmentLinkedCollections = [
    ...(readData?.('rentals') || []),
    ...(readData?.('gantt_rentals') || []),
    ...(readData?.('service') || []),
    ...(readData?.('deliveries') || []),
  ];
  risks.brokenEquipmentLinks = equipmentLinkedCollections
    .map(item => safeText(item?.equipmentId))
    .filter(id => id && !equipmentIds.has(id)).length;

  const rentalLinkedCollections = [
    ...(readData?.('payments') || []),
    ...(readData?.('documents') || []),
    ...(readData?.('deliveries') || []),
  ];
  risks.brokenRentalLinks = rentalLinkedCollections
    .flatMap(item => [item?.rentalId, item?.linkedRentalId, item?.sourceRentalId])
    .map(value => safeText(value))
    .filter(id => id && !rentalIds.has(id)).length;

  const serviceLinkedCollections = [
    ...(readData?.('warranty_claims') || []),
    ...(readData?.('repair_work_items') || []),
    ...(readData?.('repair_part_items') || []),
  ];
  risks.brokenServiceLinks = serviceLinkedCollections
    .flatMap(item => [item?.serviceTicketId, item?.repairId])
    .map(value => safeText(value))
    .filter(id => id && !serviceIds.has(id)).length;

  return risks;
}

function buildServiceQualitySummary(readData) {
  const quality = buildServiceRepairQualityView({
    equipment: readData?.('equipment') || [],
    tickets: readData?.('service') || [],
    mechanics: readData?.('mechanics') || [],
    workItems: readData?.('repair_work_items') || [],
    partItems: readData?.('repair_part_items') || [],
  });
  return {
    totalRepeats: Number(quality.summary?.totalRepeats) || 0,
    critical: Number(quality.summary?.critical) || 0,
    high: Number(quality.summary?.high) || 0,
    affectedEquipment: Number(quality.summary?.affectedEquipment) || 0,
    affectedMechanics: Number(quality.summary?.affectedMechanics) || 0,
    topScenario: safeText(quality.summary?.topScenario, 'Нет повторов'),
  };
}

function recommendation(level, title, description, action) {
  return { level, title, description, action };
}

function buildSystemControlCenterStatus({
  dbPath,
  buildInfo,
  getAppDisabledConfig,
  readData = () => [],
  requestFrontendCommit = '',
  requestFrontendBuildTime = '',
  requestFrontendReleaseType = '',
  env = process.env,
  inspectStorage = inspectStorageSignal,
} = {}) {
  const environment = runtimeEnvironment(env);
  const appDisabled = typeof getAppDisabledConfig === 'function'
    ? getAppDisabledConfig()
    : { disabled: envFlagEnabled(env.APP_DISABLED) };
  const botDisabled = getBotDisabledConfig(env);
  const gsmDisabled = getGsmDisabledConfig(env);
  const gsmEnabledValue = String(env.GSM_ENABLED ?? '').trim();
  const gsmExplicitlyEnabled = gsmEnabledValue
    ? !envFlagDisabled(gsmEnabledValue)
    : !gsmDisabled.disabled;
  const gsmWritesBlocked = Boolean(gsmDisabled.disabled);
  const dbPathKind = classifyDbPath(dbPath, environment, env);
  const storageSignal = typeof inspectStorage === 'function'
    ? inspectStorage({ mountPath: nonEmptyString(env.RAILWAY_VOLUME_MOUNT_PATH, env.RAILWAY_VOLUME_PATH, '/data') })
    : inspectStorageSignal({ mountPath: '/data' });
  const volumeSignals = [
    env.DB_PATH ? 'DB_PATH_SET' : 'DB_PATH_NOT_SET',
    env.RAILWAY_VOLUME_MOUNT_PATH || env.RAILWAY_VOLUME_PATH ? 'RAILWAY_VOLUME_SIGNAL_SET' : 'RAILWAY_VOLUME_SIGNAL_NOT_SET',
    env.RAILWAY_ENVIRONMENT_NAME || env.RAILWAY_ENVIRONMENT ? 'RAILWAY_ENVIRONMENT_SET' : 'RAILWAY_ENVIRONMENT_NOT_SET',
    storageSignal.signalPresent ? 'RUNTIME_STORAGE_SIGNAL_SET' : 'RUNTIME_STORAGE_SIGNAL_NOT_SET',
  ];
  const isolationUnknown = (environment.isProductionLike || environment.isStagingLike) && dbPathKind === 'unknown';
  const checks = [];
  const recommendations = [];

  const addCheck = (id, label, status, message) => checks.push({ id, label, status, message });

  addCheck(
    'app_disabled',
    'APP_DISABLED',
    environment.isProductionLike && !appDisabled.disabled ? 'warning' : 'ok',
    appDisabled.disabled ? 'Web access is conserved.' : 'Authenticated app access is open.',
  );
  addCheck(
    'bot_disabled',
    'BOT_DISABLED',
    environment.isProductionLike && !botDisabled.disabled ? 'warning' : 'ok',
    botDisabled.disabled ? 'MAX bot writes are blocked.' : 'MAX bot scenarios may write data.',
  );
  addCheck(
    'gsm_disabled',
    'GSM_ENABLED / GSM_DISABLED',
    environment.isProductionLike && !gsmWritesBlocked ? 'warning' : 'ok',
    gsmWritesBlocked ? 'GSM/GPRS writes are blocked.' : 'GSM/GPRS writes appear enabled.',
  );
  addCheck(
    'db_isolation',
    'DB_PATH / Railway volume',
    isolationUnknown || !storageSignal.signalPresent ? 'unknown' : 'ok',
    isolationUnknown
      ? 'Runtime signals cannot prove staging/production database isolation.'
      : storageSignal.signalPresent
        ? `Database path classified as ${dbPathKind}; storage device signal is present.`
        : `Database path classified as ${dbPathKind}; storage device signal is unavailable.`,
  );
  addCheck(
    'production_conserved',
    'Production conserved',
    environment.isProductionLike ? (appDisabled.disabled && botDisabled.disabled && gsmWritesBlocked ? 'ok' : 'warning') : 'unknown',
    environment.isProductionLike
      ? (appDisabled.disabled && botDisabled.disabled && gsmWritesBlocked
        ? 'Production conservation flags are active.'
        : 'One or more production conservation flags appear open.')
      : 'Not running in a production-labelled environment.',
  );
  addCheck(
    'staging_external_writes',
    'Staging external writes',
    environment.isStagingLike ? (botDisabled.disabled && gsmWritesBlocked ? 'ok' : 'warning') : 'unknown',
    environment.isStagingLike
      ? (botDisabled.disabled && gsmWritesBlocked
        ? 'Staging bot and GSM external writes are disabled.'
        : 'Staging bot or GSM external writes appear enabled.')
      : 'Not running in a staging-labelled environment.',
  );
  addCheck(
    'storage_signal',
    'Storage signal',
    storageSignal.signalPresent ? 'ok' : 'unknown',
    storageSignal.signalPresent
      ? `Runtime storage device: ${storageSignal.device || 'unknown device'}.`
      : 'Runtime storage df/stat signal is unavailable.',
  );

  if (environment.isProductionLike && !appDisabled.disabled) {
    recommendations.push(recommendation('info', 'Production открыт', 'APP_DISABLED=false: приложение доступно авторизованным пользователям.', 'Оставить как есть, если это ожидаемое рабочее состояние.'));
  }
  if (environment.isProductionLike && !botDisabled.disabled) {
    recommendations.push(recommendation('risk', 'MAX bot выглядит включённым', 'В production ожидается выключенный bot/write режим.', 'Проверить BOT_DISABLED во внешней панели переменных без изменения из приложения.'));
  }
  if (environment.isProductionLike && !gsmWritesBlocked) {
    recommendations.push(recommendation('risk', 'GSM/GPRS выглядит включённым', 'В production ожидается выключенный GSM/write режим.', 'Проверить GSM_DISABLED/GSM_ENABLED во внешней панели переменных без изменения из приложения.'));
  }
  if (isolationUnknown) {
    recommendations.push(recommendation('warning', 'Storage isolation не подтверждён', 'Runtime-сигналы не доказывают разделение staging/production volume.', 'Проверить Railway volume и DB_PATH вручную.'));
  }
  if (!storageSignal.signalPresent) {
    recommendations.push(recommendation('warning', 'Storage signal недоступен', 'df/stat сигнал по volume не получен.', 'Проверить /data mount во внешней runtime shell.'));
  }

  const build = buildInfo && typeof buildInfo === 'object' ? buildInfo : {};
  const backendCommit = safeText(build.commit || build.commitFull, 'unknown');
  const backendBuildTime = safeText(build.buildTime || build.startedAt, 'unknown');
  const frontendBuildTime = safeText(requestFrontendBuildTime, 'unknown');
  const frontendCommit = safeFrontendCommit({ requestCommit: requestFrontendCommit, env });
  const backendReleaseType = releaseTypeFromBuild(build);
  const frontendReleaseType = safeFrontendReleaseType({ requestReleaseType: requestFrontendReleaseType, env });
  const versionMatch = backendCommit === 'unknown' || frontendCommit === 'unknown'
    ? 'unknown'
    : commitsMatch(backendCommit, frontendCommit);
  const releaseStatus = classifyVersionRelease({
    backendCommit,
    frontendCommit,
    backendBuildTime,
    frontendBuildTime,
    backendReleaseType,
    frontendReleaseType,
    versionMatch,
  });
  const dataRisks = buildDataRisks(readData);
  const serviceQuality = buildServiceQualitySummary(readData);
  const hasDataRisk = Object.values(dataRisks).some(value => Number(value) > 0);
  const environmentLabel = safeEnvironmentLabel(environment);
  const runtimeRisk = (environment.isProductionLike && (!botDisabled.disabled || !gsmWritesBlocked)) ? 'risk' : 'ok';
  const dataRiskStatus = hasDataRisk ? 'warning' : 'ok';
  const serviceStatus = serviceQuality.critical > 0 ? 'risk' : serviceQuality.high > 0 ? 'warning' : 'ok';
  const storageStatus = isolationUnknown || !storageSignal.signalPresent ? 'warning' : 'ok';
  const versionStatus = releaseStatus.status === 'risk' ? 'risk' : releaseStatus.status === 'warning' ? 'warning' : 'ok';
  const topStatus = highestStatus([runtimeRisk, dataRiskStatus, serviceStatus, storageStatus, versionStatus]);

  if (versionMatch === false) {
    recommendations.push(recommendation(
      releaseStatus.status === 'risk' ? 'risk' : 'warning',
      releaseStatus.status === 'risk' ? 'Риск несовместимого release' : 'Frontend-only release drift',
      releaseStatus.message,
      releaseStatus.action,
    ));
  }
  if (hasDataRisk) {
    recommendations.push(recommendation('warning', 'Есть признаки грязных данных', 'Найдены placeholder-значения или битые ссылки.', 'Проверить записи точечно перед любыми исправлениями.'));
  }
  if (serviceQuality.critical > 0) {
    recommendations.push(recommendation('risk', 'Есть критичные повторы ремонта', 'Контроль качества ремонта показывает критичные повторные обращения.', 'Провести спокойный разбор диагностики и регламента без персональных обвинений.'));
  } else if (serviceQuality.high > 0) {
    recommendations.push(recommendation('warning', 'Есть высокие повторы ремонта', 'Контроль качества ремонта показывает повторные обращения высокого уровня.', 'Проверить сценарии и типовые работы.'));
  }
  recommendations.push(recommendation('info', 'Страница read-only', 'Раздел не пишет данные и не меняет runtime flags.', 'Для изменений использовать существующие утверждённые процедуры.'));

  return {
    status: topStatus,
    ok: true,
    generatedAt: new Date().toISOString(),
    runtime: {
      appDisabled: Boolean(appDisabled.disabled),
      botDisabled: Boolean(botDisabled.disabled),
      gsmDisabled: Boolean(gsmDisabled.disabled),
      environment: environmentLabel,
    },
    health: {
      api: 'ok',
      ready: 'unknown',
      lastCheckedAt: new Date().toISOString(),
    },
    dataRisks,
    serviceQuality,
    environment,
    conservation: {
      appDisabled: Boolean(appDisabled.disabled),
      botDisabled: Boolean(botDisabled.disabled),
      gsmDisabled: Boolean(gsmDisabled.disabled),
      gsmEnabled: Boolean(gsmExplicitlyEnabled),
      webAccessBlocked: Boolean(appDisabled.disabled),
      botWritesBlocked: Boolean(botDisabled.disabled),
      gsmWritesBlocked,
    },
    version: {
      backendCommit,
      backendBuildTime,
      nodeEnv: environmentLabel,
      frontendCommitFromRequestOrConfig: frontendCommit,
      versionMatch,
      releaseStatus: releaseStatus.status,
      releaseType: releaseStatus.releaseType,
      backendReleaseType: releaseStatus.backendReleaseType,
      frontendReleaseType: releaseStatus.frontendReleaseType,
      releaseBuildOrder: releaseStatus.buildOrder,
      releaseCompatible: releaseStatus.compatible,
      releaseMessage: releaseStatus.message,
      releaseAction: releaseStatus.action,
      buildTime: backendBuildTime,
      frontendBuildTime,
      frontendCommit,
    },
    database: {
      dbPathPresent: Boolean(dbPath),
      dbPathKind,
      dbPathSafeLabel: safeDbPathLabel(dbPath),
      usesSqlite: true,
    },
    storage: {
      dbSafeLabel: 'sqlite',
      dbPathSafeLabel: safeDbPathLabel(dbPath),
      volumeSafeSignal: storageSignal.signalPresent ? 'available' : storageSignal.available ? 'unknown' : 'unavailable',
      walPresent: safeWalPresent(dbPath),
      dbSizeBytes: safeDbSizeBytes(dbPath),
      classification: dbPathKind,
      volumeSignals,
      mountPath: storageSignal.mountPath,
      available: Boolean(storageSignal.available),
      signalPresent: Boolean(storageSignal.signalPresent),
      device: storageSignal.device || '',
      statDevice: Number.isFinite(Number(storageSignal.statDevice)) ? Number(storageSignal.statDevice) : 0,
      totalKb: Number.isFinite(Number(storageSignal.totalKb)) ? Number(storageSignal.totalKb) : 0,
      usedKb: Number.isFinite(Number(storageSignal.usedKb)) ? Number(storageSignal.usedKb) : 0,
      freeKb: Number.isFinite(Number(storageSignal.freeKb)) ? Number(storageSignal.freeKb) : 0,
      capacity: storageSignal.capacity || '',
      error: storageSignal.error || '',
      risk: isolationUnknown || !storageSignal.signalPresent ? 'unknown' : checks.some(check => check.status === 'warning' || check.status === 'danger') ? 'warning' : 'ok',
    },
    checks,
    recommendations,
  };
}

const SYSTEM_DATA_COLLECTION_SET = new Set(SYSTEM_DATA_COLLECTIONS);
const SENSITIVE_KEY_PATTERN = /(password|passhash|token|secret|apikey|api_key|authorization|cookie|session|webhook)/i;
const DEFAULT_AUDIT_ACTIONS = [
  'login.success',
  'login.fail',
  'logout',
  'system.backup.download',
  'system_data.export',
  'system_data.import',
  'rentals.return',
];

function isPlainObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function sanitizeSystemValue(value, stats) {
  if (Array.isArray(value)) {
    return value.map(item => sanitizeSystemValue(item, stats));
  }
  if (!isPlainObject(value)) return value;

  return Object.entries(value).reduce((acc, [key, child]) => {
    if (SENSITIVE_KEY_PATTERN.test(key)) {
      stats.strippedSensitiveFields += 1;
      return acc;
    }
    acc[key] = sanitizeSystemValue(child, stats);
    return acc;
  }, {});
}

function sanitizeSystemRecord(collection, record, stats) {
  const sanitized = sanitizeSystemValue(record, stats);
  if (collection === 'app_settings' && SENSITIVE_KEY_PATTERN.test(String(sanitized?.key || ''))) {
    stats.skippedSensitiveSettings += 1;
    return null;
  }
  return sanitized;
}

function normalizeSystemImportPayload(payload) {
  if (payload?.collections && isPlainObject(payload.collections)) return payload.collections;
  if (isPlainObject(payload)) {
    const knownKeys = Object.keys(payload).filter(key => SYSTEM_DATA_COLLECTION_SET.has(key));
    if (knownKeys.length > 0) {
      return knownKeys.reduce((acc, key) => {
        acc[key] = payload[key];
        return acc;
      }, {});
    }
  }
  return {};
}

function buildSystemDataExport(readData) {
  const stats = { strippedSensitiveFields: 0, skippedSensitiveSettings: 0 };
  const collections = {};
  for (const collection of SYSTEM_DATA_COLLECTIONS) {
    const source = readData(collection) || [];
    const list = Array.isArray(source) ? source : [];
    collections[collection] = list
      .map(item => sanitizeSystemRecord(collection, item, stats))
      .filter(item => item !== null);
  }
  return {
    ok: true,
    format: 'rental-management-system-data',
    version: 1,
    exportedAt: new Date().toISOString(),
    collections,
    warnings: [
      ...(stats.strippedSensitiveFields > 0 ? [`Удалено чувствительных полей: ${stats.strippedSensitiveFields}`] : []),
      ...(stats.skippedSensitiveSettings > 0 ? [`Пропущено чувствительных app_settings: ${stats.skippedSensitiveSettings}`] : []),
    ],
  };
}

function analyzeSystemDataImport(payload, readData) {
  const rawCollections = normalizeSystemImportPayload(payload);
  const unknownCollections = Object.keys(rawCollections).filter(name => !SYSTEM_DATA_COLLECTION_SET.has(name));
  const stats = { strippedSensitiveFields: 0, skippedSensitiveSettings: 0 };
  const collections = {};
  const duplicates = {};
  const clientInnDuplicates = [];
  const conflicts = {};
  const invalidCollections = [];
  const forbiddenFields = {};
  const sanitizedCollections = {};

  for (const collection of SYSTEM_DATA_COLLECTIONS) {
    if (!(collection in rawCollections)) continue;
    const rawValue = rawCollections[collection];
    if (!Array.isArray(rawValue)) {
      invalidCollections.push(collection);
      continue;
    }

    const sanitized = rawValue
      .map(item => sanitizeSystemRecord(collection, item, stats))
      .filter(item => item !== null);
    sanitizedCollections[collection] = sanitized;
    const blocked = new Set();
    for (const item of sanitized) {
      if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
      for (const field of Object.keys(item)) {
        if (isAdminBulkReplaceBlockedField(collection, field)) blocked.add(field);
      }
    }
    if (blocked.size > 0) forbiddenFields[collection] = Array.from(blocked).sort();
    collections[collection] = {
      incoming: sanitized.length,
      existing: Array.isArray(readData(collection)) ? (readData(collection) || []).length : 0,
    };

    const seen = new Set();
    const duplicateIds = new Set();
    sanitized.forEach(item => {
      const id = String(item?.id || '').trim();
      if (!id) return;
      if (seen.has(id)) duplicateIds.add(id);
      seen.add(id);
    });
    if (duplicateIds.size > 0) duplicates[collection] = Array.from(duplicateIds);
    if (collection === 'clients') {
      const normalizedClients = sanitized.map(normalizeClientInnFields);
      sanitizedCollections[collection] = normalizedClients;
      clientInnDuplicates.push(...buildClientInnDuplicateReport(normalizedClients));
      try {
        assertClientInnWriteAllowed(readData('clients') || [], normalizedClients);
      } catch (error) {
        invalidCollections.push(`clients:${error.message}`);
      }
    }

    const existingById = new Map((readData(collection) || [])
      .filter(item => item?.id)
      .map(item => [String(item.id), sanitizeSystemRecord(collection, item, { strippedSensitiveFields: 0, skippedSensitiveSettings: 0 })]));
    const conflictIds = sanitized
      .filter(item => item?.id && existingById.has(String(item.id)))
      .filter(item => JSON.stringify(existingById.get(String(item.id))) !== JSON.stringify(item))
      .map(item => String(item.id));
    if (conflictIds.length > 0) conflicts[collection] = conflictIds.slice(0, 50);
  }

  const blockingErrors = [
    ...unknownCollections.map(name => `Неизвестная коллекция: ${name}`),
    ...invalidCollections.map(name => name.startsWith('clients:')
      ? name.slice('clients:'.length)
      : `Коллекция ${name} должна быть массивом`),
    ...Object.entries(forbiddenFields).map(([name, fields]) => `Запрещённые поля в ${name}: ${fields.join(', ')}`),
    ...Object.entries(duplicates).map(([name, ids]) => `Дубликаты id в ${name}: ${ids.join(', ')}`),
    ...(clientInnDuplicates.length > 0 ? ['SYSTEM_IMPORT_CLIENT_INN_DUPLICATES: импорт содержит клиентов с одинаковым ИНН'] : []),
  ];

  return {
    ok: blockingErrors.length === 0,
    dryRun: true,
    collections,
    unknownCollections,
    duplicateIds: duplicates,
    clientInnDuplicates,
    conflicts,
    forbiddenFields,
    errorCode: clientInnDuplicates.length > 0 ? 'SYSTEM_IMPORT_CLIENT_INN_DUPLICATES' : undefined,
    strippedSensitiveFields: stats.strippedSensitiveFields,
    skippedSensitiveSettings: stats.skippedSensitiveSettings,
    errors: blockingErrors,
    sanitizedCollections,
  };
}

function mergeImportedUsers(incoming, existingUsers) {
  const existingById = new Map((existingUsers || []).map(user => [String(user?.id || ''), user]));
  return incoming.map(user => {
    const existing = existingById.get(String(user?.id || ''));
    if (!existing) return user;
    const preserved = {};
    for (const [key, value] of Object.entries(existing)) {
      if (SENSITIVE_KEY_PATTERN.test(key)) preserved[key] = value;
    }
    return { ...user, ...preserved };
  });
}

function safeAuditLogEntry(entry) {
  return {
    id: entry?.id || '',
    createdAt: entry?.createdAt || '',
    userId: entry?.userId || null,
    userName: entry?.userName || null,
    role: entry?.role || entry?.normalizedRole || null,
    rawRole: entry?.rawRole || null,
    normalizedRole: entry?.normalizedRole || entry?.role || null,
    action: entry?.action || '',
    entityType: entry?.entityType || '',
    entityId: entry?.entityId || null,
    description: entry?.description || '',
    before: redactAuditValue(entry?.before || null),
    after: redactAuditValue(entry?.after || null),
    metadata: redactAuditValue(entry?.metadata || null),
  };
}

function readAuditLogs(readData) {
  const current = readData('audit_logs');
  if (Array.isArray(current) && current.length > 0) return current;
  const legacy = readData('audit_log');
  return Array.isArray(legacy) ? legacy : [];
}

function backupHistoryEntry(entry) {
  const safe = safeAuditLogEntry(entry);
  const metadata = safe.metadata && typeof safe.metadata === 'object' ? safe.metadata : {};
  const collections = metadata.collections && typeof metadata.collections === 'object'
    ? metadata.collections
    : {};
  const collectionsCount = Object.keys(collections).length;
  const createdAt = safe.createdAt || entry?.timestamp || entry?.created_at || '';
  return {
    id: safe.id,
    createdAt,
    userName: safe.userName,
    userEmail: null,
    role: safe.normalizedRole || safe.role,
    filename: typeof metadata.filename === 'string' ? metadata.filename : '',
    size: typeof metadata.size === 'number' ? metadata.size : 0,
    collectionsCount,
    filesCount: typeof metadata.files === 'number' ? metadata.files : 0,
  };
}

function matchesAuditFilters(entry, query) {
  const user = String(query.user || '').trim().toLowerCase();
  const action = String(query.action || '').trim().toLowerCase();
  const section = String(query.section || query.entityType || '').trim().toLowerCase();
  const dateFrom = String(query.dateFrom || '').trim();
  const dateTo = String(query.dateTo || '').trim();
  const createdAt = String(entry?.createdAt || '');
  if (user) {
    const haystack = [entry?.userId, entry?.userName].map(value => String(value || '').toLowerCase()).join(' ');
    if (!haystack.includes(user)) return false;
  }
  if (action && String(entry?.action || '').toLowerCase() !== action) return false;
  if (section && String(entry?.entityType || '').toLowerCase() !== section) return false;
  if (dateFrom && createdAt.slice(0, 10) < dateFrom) return false;
  if (dateTo && createdAt.slice(0, 10) > dateTo) return false;
  return true;
}

function registerSystemRoutes(app, deps) {
  const {
    readData,
    writeData,
    getSnapshot,
    saveSnapshot,
    botToken,
    getBotUsers,
    sendMessage,
    countActiveSessions,
    dbPath,
    webhookUrl,
    requireAuth,
    requireAdmin,
    fetchImpl,
    auditLog,
    analyzeGanttRentalLinks,
    backfillGanttRentalLinks,
    getBuildInfo,
    getAppDisabledConfig,
    getRoleAccessSummary,
    jsonCollections = [],
    createDatabaseBackup,
    fileRoots,
    uploadRoot,
    assertPublicHttpUrlImpl = assertPublicHttpUrl,
    demo = { enabled: false, resetAllowed: false },
    resetDemoData,
  } = deps;

  function buildInfo() {
    return typeof getBuildInfo === 'function' ? getBuildInfo() : null;
  }

  const uploadsRoot = path.resolve(uploadRoot || path.join(path.dirname(dbPath || path.join(__dirname, '..', 'data', 'app.sqlite')), 'uploads'));

  async function downloadAllowlistedPhoto(sourceUrl, { maxBytes = DEFAULT_MAX_BYTES, allowDomains = DEFAULT_ALLOWED_DOMAINS } = {}) {
    const parsedUrl = await assertPublicHttpUrlImpl(sourceUrl);
    const domain = parsedUrl.hostname.toLowerCase();
    const allowed = new Set((Array.isArray(allowDomains) ? allowDomains : [])
      .map(item => String(item || '').trim().toLowerCase())
      .filter(Boolean));
    if (!allowed.has(domain)) {
      const error = new Error('domain-not-allowed');
      error.code = 'domain-not-allowed';
      throw error;
    }
    const upstream = await fetchImpl(parsedUrl.toString(), {
      headers: {
        'user-agent': 'Rental-Management-PhotoArchive/1.0',
        'accept': 'image/*',
      },
      agent: mediaProxyAgent(parsedUrl),
      redirect: 'manual',
      size: maxBytes,
      timeout: MEDIA_PROXY_TIMEOUT_MS,
    });
    if (upstream.status >= 300 && upstream.status < 400) {
      const error = new Error('redirect-not-supported');
      error.code = 'redirect-not-supported';
      throw error;
    }
    if (!upstream.ok) {
      const error = new Error('upstream-error');
      error.code = `upstream-${upstream.status || 'error'}`;
      throw error;
    }
    const declaredLength = Number(upstream.headers?.get?.('content-length') || 0);
    if (declaredLength > maxBytes) {
      const error = new Error('too-large');
      error.code = 'too-large';
      throw error;
    }
    const contentType = String(upstream.headers?.get?.('content-type') || 'application/octet-stream').split(';')[0].trim().toLowerCase();
    if (!contentType.startsWith('image/')) {
      const error = new Error('non-image-content');
      error.code = 'non-image-content';
      throw error;
    }
    const bytes = typeof upstream.buffer === 'function'
      ? await upstream.buffer()
      : Buffer.from(await upstream.arrayBuffer());
    if (bytes.length > maxBytes) {
      const error = new Error('too-large');
      error.code = 'too-large';
      throw error;
    }
    return { bytes, mimeType: contentType };
  }

  function getSafePublicSettings() {
    const requiredShellKeys = [
      'sidebar_navigation_groups',
      'sidebar_navigation_order',
      'sidebar_navigation_visibility',
    ];
    const allowedKeys = new Set(
      String(process.env.PUBLIC_APP_SETTING_KEYS || 'crm_archive_state,equipment_type_settings,theme,sales_section_settings')
        .split(',')
        .map(key => key.trim())
        .filter(Boolean),
    );
    requiredShellKeys.forEach(key => allowedKeys.add(key));
    return (readData('app_settings') || [])
      .filter(item => allowedKeys.has(String(item?.key || '').trim()))
      .map(item => ({ key: item.key, value: item.value }));
  }

  app.post('/api/sync', requireAuth, requireAdmin, async (req, res) => {
    if (process.env.ENABLE_LEGACY_SYNC !== '1') {
      return res.status(410).json({
        ok: false,
        error: 'Legacy sync отключён. Используйте обычные авторизованные CRUD API.',
      });
    }

    try {
      const {
        equipment,
        rentals,
        gantt_rentals,
        service,
        warranty_claims,
        clients,
        payments,
        company_expenses,
        users,
        documents,
        mechanic_documents,
        shipping_photos,
      } = req.body;
      const prev = getSnapshot();
      const now = Date.now();
      const normalizedClients = Array.isArray(clients) ? clients.map(normalizeClientInnFields) : clients;
      if (Array.isArray(normalizedClients)) {
        assertClientInnWriteAllowed(prev.clients || [], normalizedClients);
      }
      if (Array.isArray(equipment)) {
        assertProductionSmokeFixtureMutationAllowed({
          action: 'legacy_sync',
          existingList: prev.equipment || [],
          nextList: equipment,
        });
      }
      const syncPayload = {
        equipment,
        rentals,
        gantt_rentals,
        service,
        warranty_claims,
        clients: normalizedClients,
        payments,
        company_expenses,
        users,
        documents,
        mechanic_documents,
        shipping_photos,
      };
      for (const [collection, value] of Object.entries(syncPayload)) {
        if (Array.isArray(value)) {
          assertSafeAdminBulkReplaceInput(collection, value, 'legacy sync');
        }
      }
      if (equipment) writeData('equipment', equipment);
      if (rentals) writeData('rentals', rentals);
      if (gantt_rentals) writeData('gantt_rentals', gantt_rentals);
      if (service) writeData('service', service);
      if (warranty_claims) writeData('warranty_claims', warranty_claims);
      if (clients) writeData('clients', normalizedClients);
      if (payments) writeData('payments', payments);
      if (company_expenses) writeData('company_expenses', company_expenses);
      if (users) writeData('users', users);
      if (documents) writeData('documents', documents);
      if (mechanic_documents) writeData('mechanic_documents', mechanic_documents);
      if (shipping_photos) writeData('shipping_photos', shipping_photos);

      const notifications = [];

      if (rentals && prev.rentals) {
        const prevIds = new Set((prev.rentals || []).map(item => item.id));

        const newRentals = rentals.filter(item => !prevIds.has(item.id));
        for (const rental of newRentals) {
          notifications.push({
            role: 'all',
            managerName: rental.manager,
            text: `🆕 Новая аренда!\n${rental.equipmentInv} → ${rental.client}\nМенеджер: ${rental.manager}\nПериод: ${rental.startDate} — ${rental.endDate}`,
          });
        }

        if (service && prev.service) {
          const prevServiceIds = new Set((prev.service || []).map(item => item.id));
          const newTickets = service.filter(item => !prevServiceIds.has(item.id));
          for (const ticket of newTickets) {
            notifications.push({
              role: 'mechanic',
              text: `🔧 Новая сервисная заявка!\n${ticket.equipment}: ${ticket.reason}\nПриоритет: ${ticket.priority}`,
            });
          }
        }

        const lastOverdueCheck = prev.lastOverdueCheck || 0;
        if (now - lastOverdueCheck > 3600_000) {
          const today = new Date().toISOString().slice(0, 10);
          const overdue = rentals.filter(item =>
            item.status === 'active' && item.endDate && item.endDate < today
          );
          for (const rental of overdue) {
            notifications.push({
              role: 'manager',
              managerName: rental.manager,
              text: `⚠️ Просроченный возврат!\n${rental.equipmentInv} — ${rental.client}\nДолжен был вернуть: ${rental.endDate}`,
            });
          }
          prev.lastOverdueCheck = now;
        }
      }

      saveSnapshot({ ...req.body, lastOverdueCheck: prev.lastOverdueCheck || 0 });

      if (notifications.length && botToken) {
        const botUsers = getBotUsers();
        for (const notification of notifications) {
          for (const [phone, botUser] of Object.entries(botUsers)) {
            const shouldNotify =
              notification.role === 'all' ||
              (notification.role === 'mechanic' && isMechanicRole(botUser.userRole)) ||
              (notification.role === 'manager' && botUser.userName === notification.managerName);

            if (shouldNotify) {
              await sendMessage(botUser.replyTarget || { user_id: Number(phone) }, notification.text);
            }
          }
        }
      }

      res.json({ ok: true, synced: now, notifications: notifications.length });
      auditLog?.(req, {
        action: 'sync.bulk',
        entityType: 'sync',
        after: { collections: Object.keys(req.body || {}), notifications: notifications.length },
      });
    } catch (err) {
      if (err?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
        return sendSystemFixtureProtectedError(req, res, auditLog, err);
      }
      console.error('[SYNC] Ошибка:', err.message);
      res.status(err?.status || 500).json({ ok: false, error: err.message });
    }
  });

  app.get('/health', (req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()), build: buildInfo() });
  });

  app.get('/health/ready', (req, res) => {
    res.json({ ok: true, uptime: Math.round(process.uptime()), build: buildInfo() });
  });

  app.get('/', (req, res) => {
    res.json({ ok: true, service: 'rental-management-api', uptime: Math.round(process.uptime()), build: buildInfo() });
  });

  app.get('/api/version', (_req, res) => {
    const appDisabled = typeof getAppDisabledConfig === 'function' ? getAppDisabledConfig() : { disabled: false };
    res.json({
      ok: true,
      build: buildInfo(),
      app: appDisabled.disabled ? { disabled: true, message: appDisabled.message } : { disabled: false },
    });
  });

  app.get('/api/public-settings', (_req, res) => {
    res.json(getSafePublicSettings());
  });

  app.get('/api/demo/status', (_req, res) => {
    res.json({ ok: true, demo });
  });

  app.post('/api/demo/reset', requireAuth, requireAdmin, (req, res) => {
    if (!demo?.enabled || typeof resetDemoData !== 'function') {
      return res.status(404).json({ ok: false, error: 'Demo reset endpoint disabled' });
    }
    try {
      resetDemoData();
      auditLog?.(req, {
        action: 'demo.reset',
        entityType: 'system',
        entityId: 'demo',
        metadata: { demo: true },
      });
      res.json({ ok: true, demo });
    } catch (error) {
      res.status(error?.status || 403).json({ ok: false, error: error.message || 'Demo reset refused' });
    }
  });

  app.get('/api/bot-test', requireAuth, requireAdmin, async (req, res) => {
    if (process.env.ENABLE_BOT_TEST !== '1') {
      return res.status(404).json({ ok: false, error: 'Bot test endpoint disabled' });
    }

    const rawChatId = req.query.chatId ?? process.env.BOT_TEST_CHAT_ID;
    const chatId = Number(rawChatId);
    if (!Number.isFinite(chatId)) {
      return res.status(400).json({ ok: false, error: 'chatId is required for bot test endpoint' });
    }
    const text = req.query.text || 'Тест бота';
    try {
      const result = await sendMessage({ chat_id: chatId }, text);
      res.json({ ok: true, chatId, text, maxApiResponse: result });
    } catch (err) {
      res.json({ ok: false, error: err.message, stack: err.stack });
    }
  });

  app.get('/api/status', requireAuth, requireAdmin, (req, res) => {
    const equipment = readData('equipment') || [];
    const rentals = readData('rentals') || [];
    const service = readData('service') || [];
    const botUsers = getBotUsers();

    res.json({
      ok: true,
      uptime: Math.round(process.uptime()),
      build: buildInfo(),
      sessions: countActiveSessions(),
      storage: {
        driver: 'sqlite',
        path: dbPath,
        persistent: Boolean(process.env.DB_PATH),
      },
      data: {
        equipment: equipment.length,
        rentals: rentals.length,
        service: service.length,
      },
      botToken: botToken ? '✅ задан' : '❌ не задан',
      botUsers: Object.keys(botUsers).length,
      webhook: webhookUrl || '(не задан)',
    });
  });

  app.get('/api/admin/production-diagnostics', requireAuth, requireAdmin, (req, res) => {
    const endpointCollections = {
      equipment: 'equipment',
      rentals: 'rentals',
      service: 'service',
      deliveries: 'deliveries',
      documents: 'documents',
      payments: 'payments',
    };

    const endpoints = Object.entries(endpointCollections).reduce((acc, [name, collection]) => {
      try {
        const data = readData(collection);
        acc[name] = {
          ok: true,
          collection,
          count: Array.isArray(data) ? data.length : (data && typeof data === 'object' ? Object.keys(data).length : 0),
        };
      } catch (error) {
        acc[name] = {
          ok: false,
          collection,
          error: error?.message || 'Endpoint check failed',
        };
      }
      return acc;
    }, {});

    const role = req.user?.userRole || '';
    const roleAccess = typeof getRoleAccessSummary === 'function'
      ? getRoleAccessSummary(role)
      : null;
    const rentalLinkDiagnostics = buildRentalLinkDiagnostics({
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      equipment: readData('equipment') || [],
    });

    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      health: {
        ok: true,
        uptime: Math.round(process.uptime()),
      },
      backend: {
        build: buildInfo(),
      },
      user: {
        id: req.user?.userId || '',
        name: req.user?.userName || '',
        email: req.user?.email || '',
        rawRole: req.user?.rawRole || req.user?.userRole || '',
        normalizedRole: req.user?.normalizedRole || req.user?.userRole || '',
      },
      access: {
        readableCollections: roleAccess?.readableCollections || [],
        writableCollections: roleAccess?.writableCollections || [],
      },
      endpoints,
      rentalLinks: {
        summary: rentalLinkDiagnostics.summary,
        brokenGanttRentalLinks: rentalLinkDiagnostics.brokenGanttRentalLinks.slice(0, 50),
        rentalsWithoutGantt: rentalLinkDiagnostics.rentalsWithoutGantt.slice(0, 50),
      },
    });
  });

  app.get('/api/admin/system-control-center', requireAuth, requireAdmin, (req, res) => {
    return res.json(buildSystemControlCenterStatus({
      dbPath,
      buildInfo: buildInfo(),
      getAppDisabledConfig,
      readData,
      requestFrontendCommit: req.headers['x-frontend-commit'],
      requestFrontendBuildTime: req.headers['x-frontend-build-time'],
      requestFrontendReleaseType: req.headers['x-frontend-release-type'],
    }));
  });

  app.get('/api/admin/system-data/export', requireAuth, requireAdmin, (req, res) => {
    const payload = buildSystemDataExport(readData);
    auditLog?.(req, {
      action: 'system_data.export',
      entityType: 'system_data',
      after: {
        collections: Object.fromEntries(Object.entries(payload.collections).map(([name, list]) => [name, list.length])),
        warnings: payload.warnings.length,
      },
    });
    return res.json(payload);
  });

  app.get('/api/admin/backup/full', requireAuth, requireAdmin, async (req, res) => {
    let backup = null;
    const safeBackupErrorMessage = (error) => {
      const code = typeof error?.code === 'string' ? error.code : '';
      if (code === 'ENOENT') return 'local file disappeared before backup could read it';
      if (code === 'EACCES' || code === 'EPERM') return 'local file is not readable';
      return 'backup operation failed';
    };
    const logBackupError = (stage, error, extra = {}) => {
      console.error('[backup] full backup failed', {
        stage,
        code: typeof error?.code === 'string' ? error.code : 'unknown',
        message: safeBackupErrorMessage(error),
        ...extra,
      });
    };
    try {
      backup = await createFullBackupArchive({
        readData,
        dbPath,
        createDatabaseBackup,
        collections: jsonCollections,
        buildInfo: buildInfo(),
        fileRoots,
      });

      res.setHeader('Content-Type', 'application/zip');
      res.setHeader('Content-Length', String(backup.size));
      res.setHeader('Content-Disposition', `attachment; filename="${backup.filename}"`);
      let cleanedUp = false;
      let completed = false;
      const cleanupOnce = () => {
        if (cleanedUp) return;
        cleanedUp = true;
        cleanupBackupArchive(backup);
      };
      res.on('close', () => {
        if (!completed) cleanupOnce();
      });
      return res.sendFile(backup.path, (error) => {
        completed = true;
        cleanupOnce();
        if (error) {
          logBackupError('response', error, {
            filesCount: backup.manifest?.includedFilesCount || 0,
            embeddedPhotosCount: backup.manifest?.embeddedPhotosCount || 0,
            externalReferencesCount: backup.manifest?.externalReferencesCount || 0,
            skippedFilesCount: backup.manifest?.skippedFilesCount || 0,
          });
          if (!res.headersSent) {
            return res.status(500).json({ ok: false, error: 'Сервер не смог передать подготовленный backup.' });
          }
          return undefined;
        }

        auditLog?.(req, {
          action: 'system.backup.download',
          entityType: 'system',
          entityId: 'backup',
          metadata: {
            filename: backup.filename,
            size: backup.size,
            collections: backup.manifest?.counts || {},
            files: backup.manifest?.includedFilesCount || 0,
            filesCount: backup.manifest?.includedFilesCount || 0,
            embeddedPhotosCount: backup.manifest?.embeddedPhotosCount || 0,
            externalReferencesCount: backup.manifest?.externalReferencesCount || 0,
          },
        });
        return undefined;
      });
    } catch (error) {
      if (backup) cleanupBackupArchive(backup);
      logBackupError(error?.backupStage || 'prepare', error, {
        filesCount: backup?.manifest?.includedFilesCount || 0,
      });
      return res.status(500).json({ ok: false, error: 'Сервер не смог подготовить backup.' });
    }
  });

  app.get('/api/admin/backup/history', requireAuth, requireAdmin, (req, res) => {
    const history = readAuditLogs(readData)
      .filter(entry => entry?.action === 'system.backup.download')
      .map(backupHistoryEntry)
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
      .slice(0, 5);
    return res.json({ ok: true, history });
  });

  app.get('/api/admin/media/archive-external-photos/dry-run', requireAuth, requireAdmin, async (_req, res) => {
    try {
      const result = await archiveExternalPhotos({
        readData,
        collections: jsonCollections,
        uploadsRoot,
        allowDomains: DEFAULT_ALLOWED_DOMAINS,
        dryRun: true,
      });
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Не удалось проверить внешние фото.' });
    }
  });

  app.post('/api/admin/media/archive-external-photos', requireAuth, requireAdmin, async (req, res) => {
    const dryRun = req.body?.confirm !== true || req.body?.dryRun === true || req.query.dryRun === '1';
    const requestedDomains = Array.isArray(req.body?.allowDomains)
      ? req.body.allowDomains
      : DEFAULT_ALLOWED_DOMAINS;
    const configuredDomains = new Set(DEFAULT_ALLOWED_DOMAINS);
    const allowDomains = requestedDomains
      .map(item => String(item || '').trim().toLowerCase())
      .filter(item => configuredDomains.has(item))
      .filter(Boolean);

    try {
      const result = await archiveExternalPhotos({
        readData,
        writeData: dryRun ? undefined : writeData,
        collections: jsonCollections,
        uploadsRoot,
        allowDomains,
        dryRun,
        downloadPhoto: dryRun
          ? undefined
          : (url) => downloadAllowlistedPhoto(url, { allowDomains, maxBytes: DEFAULT_MAX_BYTES }),
      });
      if (!dryRun) {
        auditLog?.(req, {
          action: 'media.external_photos.archive',
          entityType: 'media',
          entityId: 'external_photos',
          metadata: {
            found: result.summary.found,
            archived: result.summary.archived,
            skipped: result.summary.skipped,
            failed: result.summary.failed,
            alreadyArchived: result.summary.alreadyArchived,
            allowDomains,
            collections: result.summary.collections,
            domains: result.summary.domains,
          },
        });
      }
      return res.json(result);
    } catch (error) {
      return res.status(500).json({ ok: false, error: error.message || 'Не удалось архивировать внешние фото.' });
    }
  });

  app.get('/api/admin/audit-logs', requireAuth, requireAdmin, (req, res) => {
    const allLogs = readAuditLogs(readData).map(safeAuditLogEntry);
    const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100) || 100));
    const logs = allLogs
      .filter(entry => matchesAuditFilters(entry, req.query))
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
      .slice(0, limit);
    const actions = Array.from(new Set([
      ...DEFAULT_AUDIT_ACTIONS,
      ...allLogs.map(entry => entry.action).filter(Boolean),
    ])).sort();
    const sections = Array.from(new Set(allLogs.map(entry => entry.entityType).filter(Boolean))).sort();
    return res.json({
      ok: true,
      logs,
      filters: { actions, sections },
    });
  });

  app.get('/uploads/*', requireAuth, (req, res) => {
    const relative = String(req.params?.[0] || '').replace(/\\/g, '/');
    const targetPath = path.resolve(uploadsRoot, relative);
    const inside = path.relative(uploadsRoot, targetPath);
    if (!inside || inside.startsWith('..') || path.isAbsolute(inside)) {
      return res.status(400).json({ ok: false, error: 'Некорректный путь файла.' });
    }
    if (!fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      return res.status(404).json({ ok: false, error: 'Файл не найден.' });
    }
    return res.sendFile(targetPath);
  });

  app.post('/api/admin/system-data/import/dry-run', requireAuth, requireAdmin, (req, res) => {
    const importEquipment = req.body?.collections?.equipment;
    if (Array.isArray(importEquipment)) {
      try {
        assertProductionSmokeFixtureMutationAllowed({
          action: 'system_import',
          existingList: readData('equipment') || [],
          nextList: importEquipment,
        });
      } catch (error) {
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, auditLog, error);
        }
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }
    }

    const analysis = analyzeSystemDataImport(req.body, readData);
    const { sanitizedCollections, ...publicAnalysis } = analysis;
    return res.status(analysis.ok ? 200 : 400).json(publicAnalysis);
  });

  app.post('/api/admin/system-data/import', requireAuth, requireAdmin, (req, res) => {
    if (req.body?.confirm !== true) {
      return res.status(400).json({ ok: false, error: 'Import requires confirm: true after dry-run.' });
    }

    const importEquipment = req.body?.collections?.equipment;
    if (Array.isArray(importEquipment)) {
      try {
        assertProductionSmokeFixtureMutationAllowed({
          action: 'system_import',
          existingList: readData('equipment') || [],
          nextList: importEquipment,
        });
      } catch (error) {
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, auditLog, error);
        }
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }
    }

    const analysis = analyzeSystemDataImport(req.body, readData);
    if (!analysis.ok) {
      const { sanitizedCollections, ...publicAnalysis } = analysis;
      return res.status(400).json(publicAnalysis);
    }

    const imported = {};
    for (const [collection, list] of Object.entries(analysis.sanitizedCollections)) {
      const nextList = collection === 'users'
        ? mergeImportedUsers(list, readData('users') || [])
        : list;
      if (collection === 'equipment') {
        try {
          assertProductionSmokeFixtureMutationAllowed({
            action: 'system_import',
            existingList: readData('equipment') || [],
            nextList,
          });
        } catch (error) {
          if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
            return sendSystemFixtureProtectedError(req, res, auditLog, error);
          }
          return res.status(error?.status || 400).json({ ok: false, error: error.message });
        }
      }
      writeData(collection, nextList);
      imported[collection] = nextList.length;
    }

    auditLog?.(req, {
      action: 'system_data.import',
      entityType: 'system_data',
      after: {
        imported,
        conflicts: Object.fromEntries(Object.entries(analysis.conflicts).map(([name, ids]) => [name, ids.length])),
        strippedSensitiveFields: analysis.strippedSensitiveFields,
      },
    });

    const { sanitizedCollections, ...publicAnalysis } = analysis;
    return res.json({ ...publicAnalysis, ok: true, dryRun: false, imported });
  });

  app.get('/api/admin/rental-link-diagnostics', requireAuth, requireAdmin, (req, res) => {
    const diagnostics = buildRentalLinkDiagnostics({
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      equipment: readData('equipment') || [],
    });
    return res.json(diagnostics);
  });

  app.get('/api/admin/rental-equipment-diagnostics', requireAuth, requireAdmin, (_req, res) => {
    const diagnostics = analyzeRentalEquipmentDiagnostics({
      equipment: readData('equipment') || [],
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
    });
    return res.json({
      ok: true,
      generatedAt: new Date().toISOString(),
      ...diagnostics,
    });
  });

  app.get('/api/admin/data-integrity-diagnostics', requireAuth, requireAdmin, (_req, res) => {
    const collections = {
      equipment: readData('equipment') || [],
      rentals: readData('rentals') || [],
      gantt_rentals: readData('gantt_rentals') || [],
      clients: readData('clients') || [],
      service: readData('service') || [],
      deliveries: readData('deliveries') || [],
      delivery_carriers: readData('delivery_carriers') || [],
      payments: readData('payments') || [],
      payment_allocations: readData('payment_allocations') || [],
      documents: readData('documents') || [],
      users: readData('users') || [],
      owners: readData('owners') || [],
      mechanics: readData('mechanics') || [],
      bot_users: readData('bot_users') || [],
      bot_sessions: readData('bot_sessions') || [],
      bot_activity: readData('bot_activity') || [],
      repair_work_items: readData('repair_work_items') || [],
      repair_part_items: readData('repair_part_items') || [],
      service_works: readData('service_works') || [],
      service_work_names: readData('service_work_names') || [],
      service_work_catalog: readData('service_work_catalog') || [],
      spare_part_names: readData('spare_part_names') || [],
      spare_parts: readData('spare_parts') || [],
      app_settings: readData('app_settings') || [],
    };
    return res.json(buildDataIntegrityDiagnostics(collections));
  });

  app.get('/api/admin/diagnostics/gantt-rentals-repair', requireAuth, requireAdmin, (_req, res) => {
    const diagnostics = buildAdminGanttRentalRepairDiagnostics({
      equipment: readData('equipment') || [],
      rentals: readData('rentals') || [],
      gantt_rentals: readData('gantt_rentals') || [],
      documents: readData('documents') || [],
      payments: readData('payments') || [],
      deliveries: readData('deliveries') || [],
      service: readData('service') || [],
    });
    return res.json(diagnostics);
  });

  app.get('/api/admin/diagnostics/gantt-rentals-cleanup-preview', requireAuth, requireAdmin, (_req, res) => {
    const preview = buildAdminGanttRentalCleanupPreview({
      equipment: readData('equipment') || [],
      rentals: readData('rentals') || [],
      gantt_rentals: readData('gantt_rentals') || [],
      documents: readData('documents') || [],
      payments: readData('payments') || [],
      deliveries: readData('deliveries') || [],
      service: readData('service') || [],
    });
    return res.json(preview);
  });

  app.post('/api/admin/diagnostics/gantt-rentals-repair', requireAuth, requireAdmin, (req, res) => {
    const collections = {
      equipment: readData('equipment') || [],
      rentals: readData('rentals') || [],
      gantt_rentals: readData('gantt_rentals') || [],
      documents: readData('documents') || [],
      payments: readData('payments') || [],
      deliveries: readData('deliveries') || [],
      service: readData('service') || [],
    };
    const plan = buildBrokenGanttRentalsRepairPlan(collections);
    const apply = req.body?.apply === true;
    let result;
    try {
      result = applyRepairPlan(collections, plan, {
        apply,
        ids: Array.isArray(req.body?.ids) ? req.body.ids : null,
        backupVerified: req.body?.backupVerified === true,
        confirm: req.body?.confirm === 'APPLY_GANTT_REPAIR',
      });
    } catch (error) {
      return res.status(400).json({
        ok: false,
        applied: false,
        productionDataChanged: false,
        error: error instanceof Error ? error.message : 'Repair rejected',
      });
    }

    if (apply && result.applied) {
      writeData('gantt_rentals', result.collections.gantt_rentals);
      auditLog?.(req, {
        action: 'gantt_rentals.repair_links',
        entityType: 'gantt_rentals',
        description: `Восстановлены связи gantt_rentals: ${result.operations.operations.length}`,
        after: {
          ids: result.operations.operations.map(operation => operation.id),
          count: result.operations.operations.length,
        },
      });
    }

    return res.json({
      ok: true,
      ...result.operations,
      applied: Boolean(apply && result.applied),
      productionDataChanged: Boolean(apply && result.applied),
    });
  });

  app.post('/api/admin/rental-equipment-diagnostics/backfill', requireAuth, requireAdmin, (req, res) => {
    const dryRun = req.body?.confirm !== true || req.body?.dryRun === true || req.query.dryRun === '1';
    const before = analyzeRentalEquipmentDiagnostics({
      equipment: readData('equipment') || [],
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
    });
    const plan = planRentalEquipmentBackfill({
      equipment: readData('equipment') || [],
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      maxChanges: Math.min(500, Math.max(1, Number(req.body?.limit || 200) || 200)),
    });

    if (!dryRun) {
      writeData('rentals', plan.nextRentals);
      writeData('gantt_rentals', plan.nextGanttRentals);
    }

    const after = dryRun
      ? before
      : analyzeRentalEquipmentDiagnostics({
        equipment: readData('equipment') || [],
        rentals: readData('rentals') || [],
        ganttRentals: readData('gantt_rentals') || [],
      });

    if (!dryRun) {
      auditLog?.(req, {
        action: 'rental_equipment.backfill',
        entityType: 'rental_equipment',
        after: {
          dryRun,
          rentalsUpdated: plan.summary.rentalsUpdated,
          ganttUpdated: plan.summary.ganttUpdated,
          skipped: plan.summary.skipped,
        },
      });
    }

    const { nextRentals, nextGanttRentals, ...publicPlan } = plan;
    return res.json({
      ok: true,
      dryRun,
      before,
      backfill: publicPlan,
      after,
    });
  });

  app.post('/api/admin/rental-link-diagnostics/backfill', requireAuth, requireAdmin, (req, res) => {
    if (typeof backfillGanttRentalLinks !== 'function' || typeof analyzeGanttRentalLinks !== 'function') {
      return res.status(500).json({ ok: false, error: 'Rental link backfill unavailable' });
    }
    const dryRun = req.body?.confirm !== true || req.body?.dryRun === true || req.query.dryRun === '1';
    const before = analyzeGanttRentalLinks({
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      equipment: readData('equipment') || [],
      targetId: req.body?.id || req.query.id || '',
      limit: req.body?.limit || req.query.limit || 100,
    });
    const backfill = backfillGanttRentalLinks({
      readData,
      writeData,
      logger: console,
      dryRun,
    });
    const after = analyzeGanttRentalLinks({
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      equipment: readData('equipment') || [],
      targetId: req.body?.id || req.query.id || '',
      limit: req.body?.limit || req.query.limit || 100,
    });
    if (!dryRun) {
      auditLog?.(req, {
        action: 'rental_links.backfill',
        entityType: 'rental_links',
        after: {
          dryRun: backfill.dryRun,
          linked: backfill.linked,
          missingLink: backfill.missingLink,
          ambiguous: backfill.ambiguous.length,
          unresolved: backfill.unresolved.length,
        },
      });
    }
    return res.json({ ok: true, before, backfill, after });
  });

  app.get('/api/media/fetch', requireAuth, async (req, res) => {
    const sourceUrl = String(req.query.url || '').trim();

    try {
      const parsedUrl = await assertPublicHttpUrl(sourceUrl);
      const upstream = await fetchImpl(parsedUrl.toString(), {
        headers: {
          'user-agent': 'Rental-Management-MediaProxy/1.0',
          'accept': '*/*',
        },
        agent: mediaProxyAgent(parsedUrl),
        redirect: 'manual',
        size: MAX_MEDIA_PROXY_BYTES,
        timeout: MEDIA_PROXY_TIMEOUT_MS,
      });

      if (upstream.status >= 300 && upstream.status < 400) {
        return res.status(400).json({ ok: false, error: 'Редиректы внешних файлов не поддерживаются.' });
      }

      if (!upstream.ok) {
        return res.status(502).json({ ok: false, error: `Источник вернул ${upstream.status}` });
      }

      const declaredLength = Number(upstream.headers.get('content-length') || 0);
      if (declaredLength > MAX_MEDIA_PROXY_BYTES) {
        return res.status(413).json({ ok: false, error: 'Файл слишком большой для прокси.' });
      }

      const buffer = await upstream.buffer();
      if (buffer.length > MAX_MEDIA_PROXY_BYTES) {
        return res.status(413).json({ ok: false, error: 'Файл слишком большой для прокси.' });
      }
      const contentType = upstream.headers.get('content-type') || 'application/octet-stream';
      const fileName = (parsedUrl.pathname.split('/').pop() || 'media.bin')
        .replace(/["\r\n\\]/g, '_')
        .slice(0, 160) || 'media.bin';

      res.setHeader('Content-Type', contentType);
      res.setHeader('Content-Length', String(buffer.length));
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      return res.send(buffer);
    } catch (error) {
      return res.status(502).json({ ok: false, error: error.message || 'Не удалось получить внешний файл.' });
    }
  });
}

module.exports = {
  buildSystemControlCenterStatus,
  registerSystemRoutes,
};
