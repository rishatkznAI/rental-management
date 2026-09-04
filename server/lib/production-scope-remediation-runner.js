const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  prepareSqliteReadonlyStatement,
} = require('./sqlite-readonly-statement');
const {
  cleanupBackupArchive,
  createFullBackupArchive,
} = require('./full-backup');
const {
  inspectFullBackupArchive,
  readStoredZipEntry,
  validateStoredZipEntry,
} = require('./full-backup-validation');
const {
  applyProductionScopeRemediation,
  databaseIdentity,
  planProductionScopeRemediation,
  sqliteTotalChanges,
  stableJson,
  targetCollectionsForPlan,
} = require('./production-scope-remediation');
const { isEligiblePlatformUser } = require('./platform-identity-repository');
const { createTrustedActorScopeResolver } = require('./trusted-actor-scope');

const APPLY_CONFIRMATION = 'RENTCORE_PHASE_A_APPLY';
const INDEPENDENT_COPY_CONFIRMATION = 'INDEPENDENT_COPY_VERIFIED';
const BACKUP_FILENAME = /^rentcore-phase-a-\d{8}T\d{6}Z\.zip$/;
const BACKUP_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const HEX_64 = /^[a-f0-9]{64}$/;
const SHA_40 = /^[a-f0-9]{40}$/;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/;
const ISO_UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_BACKUP_AGE_MS = 24 * 60 * 60 * 1000;
class ProductionScopeRunnerError extends Error {
  constructor(code, message, status = 409, blockers = []) {
    super(message);
    this.name = 'ProductionScopeRunnerError';
    this.code = code;
    this.status = status;
    this.blockers = blockers;
  }
}

function fail(code, message, status, blockers) {
  throw new ProductionScopeRunnerError(code, message, status, blockers);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(filePath) {
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, 'r');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    let bytesRead;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
    } while (bytesRead > 0);
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function fileState(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      name: path.basename(filePath),
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: stat.isFile() ? fileSha256(filePath) : null,
    };
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function sqliteFileSet(dbPath) {
  return {
    database: fileState(dbPath),
    wal: fileState(`${dbPath}-wal`),
    shm: fileState(`${dbPath}-shm`),
  };
}

function normalizedSqliteFileSet(files) {
  return Object.fromEntries(['database', 'wal', 'shm'].map(key => [key, files?.[key]
    ? {
      name: normalizedText(files[key].name, 160),
      sizeBytes: Number(files[key].sizeBytes),
      sha256: normalizedText(files[key].sha256, 64),
    }
    : null]));
}

function normalizedSqliteDurableFileSet(files) {
  const normalized = normalizedSqliteFileSet(files);
  return {
    database: normalized.database,
    wal: normalized.wal,
  };
}

// The database and WAL are the authoritative durable SQLite state. The SHM file
// is a transient WAL index: opening an otherwise read-only database may rebuild
// it byte-for-byte differently without changing database content or the WAL.
// Keep hashing SHM as forensic evidence, but never use it as a mutation gate.
function sqliteFileSetFingerprint(files) {
  return sha256(stableJson(normalizedSqliteDurableFileSet(files)));
}

function sqliteObservedFileSetFingerprint(files) {
  return sha256(stableJson(normalizedSqliteFileSet(files)));
}

function dataFilesUnchanged(before, after) {
  return sqliteFileSetFingerprint(before) === sqliteFileSetFingerprint(after);
}

function quoteIdentifier(value) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function fingerprintSqlValue(value) {
  if (Buffer.isBuffer(value)) return { type: 'blob', base64: value.toString('base64') };
  if (value === null) return { type: 'null' };
  if (typeof value === 'number') return { type: 'number', value: String(value) };
  if (typeof value === 'bigint') return { type: 'bigint', value: value.toString() };
  return { type: typeof value, value: String(value) };
}

function databaseContentFingerprint(db) {
  const databaseHeader = {
    applicationId: Number(db.pragma('application_id', { simple: true })),
    userVersion: Number(db.pragma('user_version', { simple: true })),
    pageSize: Number(db.pragma('page_size', { simple: true })),
    encoding: String(db.pragma('encoding', { simple: true })),
    autoVacuum: Number(db.pragma('auto_vacuum', { simple: true })),
  };
  const schema = prepareSqliteReadonlyStatement(db, `
    SELECT type, name, tbl_name AS tableName, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_%' OR name = 'sqlite_sequence'
    ORDER BY type, name
  `).all().map(row => ({
    type: row.type,
    name: row.name,
    tableName: row.tableName,
    sql: row.sql,
  }));
  const tables = schema.filter(item => item.type === 'table').map(item => item.name);
  const contents = tables.map(name => {
    const encodedRows = prepareSqliteReadonlyStatement(db, `SELECT * FROM ${quoteIdentifier(name)}`).all().map(row => (
      Object.fromEntries(Object.keys(row).sort().map(key => [key, fingerprintSqlValue(row[key])]))
    ));
    encodedRows.sort((left, right) => {
      const leftJson = stableJson(left);
      const rightJson = stableJson(right);
      if (leftJson < rightJson) return -1;
      if (leftJson > rightJson) return 1;
      return 0;
    });
    return { name, rows: encodedRows };
  });
  return sha256(stableJson({ databaseHeader, schema, contents }));
}

function normalizedText(value, maxLength = 240) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function hasIdentityBootstrap(plan) {
  const bootstrap = plan?.authority?.identityBootstrap;
  return Boolean(bootstrap && typeof bootstrap === 'object' && !Array.isArray(bootstrap));
}

function authorityConfigChecksum(plan) {
  if (!hasIdentityBootstrap(plan)) return null;
  const checksum = plan.authority.identityBootstrap?.approval?.configChecksum;
  return typeof checksum === 'string' && HEX_64.test(checksum) ? checksum : null;
}

function authorityConfigChecksumBlockers(plan, preview) {
  if (!hasIdentityBootstrap(plan)) return [];
  const checksum = authorityConfigChecksum(plan);
  if (!checksum) return [{ code: 'AUTHORITY_CONFIG_CHECKSUM_REQUIRED' }];
  if (preview?.identity?.configChecksum !== checksum) {
    return [{ code: 'AUTHORITY_CONFIG_CHECKSUM_MISMATCH' }];
  }
  return [];
}

function normalizedRailwayTarget(value) {
  return Object.fromEntries([
    'projectId',
    'environmentId',
    'serviceId',
    'volumeId',
    'volumeName',
    'volumeMountPath',
  ].map(field => [field, normalizedText(value?.[field], 160)]));
}

function assertDeploymentSha(expectedDeployedSha, actualDeployedSha) {
  const expected = normalizedText(expectedDeployedSha, 40).toLowerCase();
  const actual = normalizedText(actualDeployedSha, 80).toLowerCase();
  if (!SHA_40.test(expected) || !SHA_40.test(actual)) {
    fail('DEPLOYED_SHA_REQUIRED', 'An exact 40-character deployed commit SHA is required.');
  }
  if (expected !== actual) {
    fail('DEPLOYED_SHA_MISMATCH', 'The deployed commit does not match the approved target.');
  }
  return actual;
}

function exactSourceBindingBlockers(
  plan,
  { databaseFingerprint, railwayIdentity, acceptedDatabaseFingerprints = [] } = {},
) {
  const requiresBinding = Number(plan?.manifestVersion || 0) >= 2;
  const source = plan?.exactSourceBinding?.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    return requiresBinding ? [{ code: 'EXACT_SOURCE_BINDING_REQUIRED' }] : [];
  }
  const captureDeployedSha = normalizedText(source.captureDeployedSha, 40).toLowerCase();
  const captureDeploymentId = normalizedText(source.captureDeploymentId, 36).toLowerCase();
  const expectedDatabaseFingerprint = normalizedText(source.databaseContentFingerprint, 64);
  const expectedRailwayTarget = normalizedRailwayTarget(source.railwayIdentity);
  if (
    !SHA_40.test(captureDeployedSha)
    || !UUID.test(captureDeploymentId)
    || !HEX_64.test(expectedDatabaseFingerprint)
    || Object.values(expectedRailwayTarget).some(value => !value)
  ) {
    return [{ code: 'EXACT_SOURCE_BINDING_INVALID' }];
  }
  const blockers = [];
  const allowedDatabaseFingerprints = new Set([
    expectedDatabaseFingerprint,
    ...acceptedDatabaseFingerprints
      .map(value => normalizedText(value, 64))
      .filter(value => HEX_64.test(value)),
  ]);
  if (!allowedDatabaseFingerprints.has(normalizedText(databaseFingerprint, 64))) {
    blockers.push({ code: 'EXACT_SOURCE_DATABASE_FINGERPRINT_MISMATCH' });
  }
  if (stableJson(expectedRailwayTarget) !== stableJson(normalizedRailwayTarget(railwayIdentity))) {
    blockers.push({ code: 'EXACT_SOURCE_RAILWAY_TARGET_MISMATCH' });
  }
  return blockers;
}

function readUsers(db) {
  const row = prepareSqliteReadonlyStatement(db, 'SELECT json FROM app_data WHERE name = ?').get('users');
  if (!row) fail('USERS_COLLECTION_MISSING', 'The authoritative users collection is missing.');
  let users;
  try {
    users = JSON.parse(row.json);
  } catch {
    fail('USERS_COLLECTION_INVALID', 'The authoritative users collection is invalid.');
  }
  if (!Array.isArray(users)) fail('USERS_COLLECTION_INVALID', 'The users collection is not an array.');
  return users;
}

function userRole(user) {
  if (typeof user?.role === 'string') return normalizedText(user.role, 120);
  if (Array.isArray(user?.roles)) {
    return user.roles.map(item => normalizedText(item, 80)).filter(Boolean).sort().join(', ');
  }
  return '';
}

function userName(user) {
  return normalizedText(
    user?.name || user?.fullName || user?.displayName || user?.username || '',
    160,
  );
}

function inventoryDisposition(user, mapping) {
  const eligible = isEligiblePlatformUser(user);
  if (mapping?.action === 'CREATE_MEMBERSHIP') {
    return {
      type: 'business user',
      proposedAction: 'CREATE_APPROVED_MEMBERSHIP',
      evidence: 'Explicit stable user-ID mapping in the reviewed Phase A plan.',
      blocker: null,
    };
  }
  if (mapping?.action === 'NO_MEMBERSHIP') {
    return {
      type: mapping.actorType || 'smoke/test or service/system',
      proposedAction: 'INTENTIONALLY_NO_MEMBERSHIP',
      evidence: 'Explicit stable user-ID exclusion in the reviewed Phase A plan.',
      blocker: null,
    };
  }
  if (mapping?.action === 'UNRESOLVED') {
    return {
      type: mapping.candidateForProductionMembership === false ? 'smoke/test' : 'unknown',
      proposedAction: 'HUMAN_DISPOSITION_REQUIRED',
      evidence: 'Known stable user ID is present, but its final disposition is not approved.',
      blocker: {
        code: 'ACTOR_DISPOSITION_UNRESOLVED',
        userId: normalizedText(user?.id, 160),
      },
    };
  }
  if (user?.botOnly === true && !eligible) {
    return {
      type: 'service/system',
      proposedAction: 'NO_ACTIVE_BUSINESS_MEMBERSHIP',
      evidence: 'Authoritative user flags make the account bot-only and frontend-ineligible.',
      blocker: null,
    };
  }
  if (!eligible) {
    return {
      type: 'inactive',
      proposedAction: 'NO_ACTIVE_MEMBERSHIP',
      evidence: 'Authoritative status or frontend-eligibility flags make the account ineligible.',
      blocker: null,
    };
  }
  return {
    type: 'unknown',
    proposedAction: 'HUMAN_DISPOSITION_REQUIRED',
    evidence: 'Eligible active production user has no explicit stable-ID disposition.',
    blocker: {
      code: 'NEW_ACTOR_REQUIRES_HUMAN_DISPOSITION',
      userId: normalizedText(user?.id, 160),
    },
  };
}

function buildUserInventory(users, plan) {
  const mappings = new Map((Array.isArray(plan?.actorMappings) ? plan.actorMappings : [])
    .map(mapping => [normalizedText(mapping?.userId, 160), mapping]));
  const seen = new Set();
  const blockers = [];
  const rows = users.map(user => {
    const id = normalizedText(user?.id, 160);
    if (!id || seen.has(id)) {
      blockers.push({ code: 'USER_ID_MISSING_OR_DUPLICATE', userId: id || null });
    }
    seen.add(id);
    const disposition = inventoryDisposition(user, mappings.get(id));
    if (disposition.blocker) blockers.push(disposition.blocker);
    return {
      id,
      name: userName(user),
      status: normalizedText(user?.status, 80),
      currentRole: userRole(user),
      type: disposition.type,
      proposedAction: disposition.proposedAction,
      evidence: disposition.evidence,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));
  return {
    rows,
    fingerprint: sha256(stableJson(rows)),
    blockers,
    eligibleActiveCount: users.filter(isEligiblePlatformUser).length,
  };
}

function planHash(plan) {
  return sha256(stableJson(plan));
}

function dbIdentityHash(identity) {
  return sha256(stableJson(identity));
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

function safeBackupPath(dbPath, filename) {
  const safeName = path.basename(normalizedText(filename, 120));
  if (!BACKUP_FILENAME.test(safeName)) {
    fail('BACKUP_REFERENCE_INVALID', 'The remediation backup filename is invalid.');
  }
  return path.join(path.dirname(path.resolve(dbPath)), 'backups', safeName);
}

function safeReceiptPath(dbPath, filename) {
  return `${safeBackupPath(dbPath, filename)}.receipt.json`;
}

function assertConservation(state) {
  if (
    state?.appDisabled !== true
    || state?.botDisabled !== true
    || state?.gsmDisabled !== true
    || state?.storageWriteGuardEnabled !== true
    || state?.schemaCompatibilityDisabled !== true
    || state?.cleanResetDisabled !== true
    || state?.adminResetDisabled !== true
  ) {
    fail(
      'MAINTENANCE_WRITE_FREEZE_REQUIRED',
      'Every application, bot, GSM, storage, compatibility, reset, and startup write path must be frozen.',
    );
  }
}

function assertProductionExecutionAuthorized(plan) {
  if (
    plan?.productionExecutionAuthorized === false
    || (Number(plan?.manifestVersion || 0) >= 2 && plan?.productionExecutionAuthorized !== true)
  ) {
    fail(
      'PRODUCTION_EXECUTION_NOT_AUTHORIZED',
      'The embedded exact execution plan is review-only; guarded backup/apply is disabled.',
    );
  }
}

function clone(value) {
  return structuredClone(value);
}

function buildExecutionPlan(basePlan, receipt) {
  const requiresAuthorityConfigChecksum = hasIdentityBootstrap(basePlan);
  const receiptAuthorityConfigChecksum = receipt?.authorityConfigChecksum;
  if (
    !receipt
    || receipt.receiptVersion !== 2
    || !BACKUP_ID.test(normalizedText(receipt.backupId, 36).toLowerCase())
    || !BACKUP_FILENAME.test(normalizedText(receipt.filename, 120))
    || !HEX_64.test(normalizedText(receipt.sha256, 64))
    || !Number.isSafeInteger(receipt.sizeBytes)
    || receipt.sizeBytes <= 0
    || !normalizedText(receipt.sourceDbIdentity, 160)
    || !normalizedText(receipt.generatedAt, 80)
    || !HEX_64.test(normalizedText(receipt.databaseFingerprint, 64))
    || !HEX_64.test(normalizedText(receipt.sourceFileSetFingerprint, 64))
    || !HEX_64.test(normalizedText(receipt.sourceObservedFileSetFingerprint, 64))
    || !HEX_64.test(normalizedText(receipt.stateFingerprint, 64))
    || !HEX_64.test(normalizedText(receipt.userInventoryFingerprint, 64))
    || !SHA_40.test(normalizedText(receipt.deployedSha, 40))
    || !HEX_64.test(normalizedText(receipt.bundledPlanChecksum, 64))
    || !normalizedText(receipt.canonicalCompanyId, 160)
    || (
      (requiresAuthorityConfigChecksum || receiptAuthorityConfigChecksum != null)
      && (typeof receiptAuthorityConfigChecksum !== 'string'
        || !HEX_64.test(receiptAuthorityConfigChecksum))
    )
  ) {
    fail('VERIFIED_BACKUP_REQUIRED', 'Complete verified backup receipt metadata is required.');
  }
  if (
    requiresAuthorityConfigChecksum
    && receiptAuthorityConfigChecksum !== authorityConfigChecksum(basePlan)
  ) {
    fail(
      'BACKUP_RECEIPT_AUTHORITY_CONFIG_CHECKSUM_MISMATCH',
      'The backup receipt is not bound to the approved identity authority configuration.',
    );
  }
  const plan = clone(basePlan);
  plan.backup = {
    verified: true,
    reference: receipt.filename,
    sourceDbIdentity: receipt.sourceDbIdentity,
    timestamp: receipt.generatedAt,
    sizeBytes: receipt.sizeBytes,
    sha256: receipt.sha256,
    backupId: receipt.backupId,
    deployedSha: receipt.deployedSha,
    databaseFingerprint: receipt.databaseFingerprint,
    sourceFileSetFingerprint: receipt.sourceFileSetFingerprint,
    sourceObservedFileSetFingerprint: receipt.sourceObservedFileSetFingerprint,
    stateFingerprint: receipt.stateFingerprint,
    userInventoryFingerprint: receipt.userInventoryFingerprint,
    canonicalCompanyId: receipt.canonicalCompanyId,
    bundledPlanChecksum: receipt.bundledPlanChecksum,
    authorityConfigChecksum: receipt.authorityConfigChecksum ?? null,
    railwayIdentity: receipt.railwayIdentity,
  };
  if (plan.authority?.identityBootstrap?.approval) {
    plan.authority.identityBootstrap.approval.backupReference = receipt.filename;
  }
  // Loaded lazily to avoid the intentional execution-bundle -> remediation
  // validation dependency becoming an initialization-time cycle.
  const {
    inheritAuthorizedIdentityExecutionPlan,
  } = require('./production-scope-execution-plan-bundle');
  return inheritAuthorizedIdentityExecutionPlan(basePlan, plan);
}

function writeStoredReceipt(dbPath, receipt) {
  const receiptPath = safeReceiptPath(dbPath, receipt.filename);
  const fd = fs.openSync(receiptPath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, `${stableJson(receipt)}\n`, 'utf8');
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  const directoryFd = fs.openSync(path.dirname(receiptPath), 'r');
  try {
    fs.fsyncSync(directoryFd);
  } finally {
    fs.closeSync(directoryFd);
  }
  return receiptPath;
}

function loadStoredReceipt(dbPath, reference, plan) {
  const filename = normalizedText(reference?.filename, 120);
  const backupId = normalizedText(reference?.backupId, 36).toLowerCase();
  if (!BACKUP_FILENAME.test(filename) || !BACKUP_ID.test(backupId)) {
    fail('VERIFIED_BACKUP_REQUIRED', 'An exact stored backup identity and filename are required.');
  }
  const receiptPath = safeReceiptPath(dbPath, filename);
  let stored;
  try {
    stored = JSON.parse(fs.readFileSync(receiptPath, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') {
      fail('VERIFIED_BACKUP_REQUIRED', 'The stored backup receipt is missing.');
    }
    fail('BACKUP_RECEIPT_INVALID', 'The stored backup receipt is invalid.');
  }
  if (stored?.filename !== filename || String(stored?.backupId || '').toLowerCase() !== backupId) {
    fail('BACKUP_RECEIPT_MISMATCH', 'The stored backup receipt identity does not match.');
  }
  buildExecutionPlan(plan, stored);
  if (!HEX_64.test(normalizedText(stored.executionPlanChecksum, 64))) {
    fail('BACKUP_RECEIPT_INVALID', 'The stored backup receipt has no execution plan checksum.');
  }
  if (!HEX_64.test(normalizedText(stored.expectedPostDatabaseFingerprint, 64))) {
    fail('BACKUP_RECEIPT_INVALID', 'The stored receipt has no exact expected post-state fingerprint.');
  }
  if (sqliteFileSetFingerprint(stored.sourceFileSet) !== stored.sourceFileSetFingerprint) {
    fail('BACKUP_RECEIPT_INVALID', 'The stored durable DB/WAL fingerprint is internally inconsistent.');
  }
  if (sqliteObservedFileSetFingerprint(stored.sourceFileSet) !== stored.sourceObservedFileSetFingerprint) {
    fail('BACKUP_RECEIPT_INVALID', 'The stored observed DB/WAL/SHM fingerprint is internally inconsistent.');
  }
  return stored;
}

function assertReceiptBindings({ receipt, plan, deployedSha, railwayIdentity }) {
  const exactSourceBlockers = exactSourceBindingBlockers(plan, {
    databaseFingerprint: receipt?.databaseFingerprint,
    railwayIdentity: receipt?.railwayIdentity,
  });
  if (
    receipt.deployedSha !== deployedSha
    || receipt.canonicalCompanyId !== plan?.authority?.companyId
    || receipt.canonicalCompanyId !== plan?.authority?.tenantId
    || receipt.bundledPlanChecksum !== planHash(plan)
    || (
      hasIdentityBootstrap(plan)
      && receipt.authorityConfigChecksum !== authorityConfigChecksum(plan)
    )
    || stableJson(receipt.railwayIdentity || null) !== stableJson(railwayIdentity || null)
  ) {
    fail('BACKUP_RECEIPT_CONTEXT_MISMATCH', 'The stored receipt belongs to another release or production context.');
  }
  if (exactSourceBlockers.length > 0) {
    fail(
      'BACKUP_RECEIPT_SOURCE_BINDING_MISMATCH',
      'The stored receipt differs from the exact reviewed source binding.',
      409,
      exactSourceBlockers,
    );
  }
}

function coreBlockersExceptBackup(preview) {
  return (preview?.blockers || []).filter(blocker => blocker.code !== 'RECOVERABLE_BACKUP_NOT_VERIFIED');
}

function runPreflight({
  dbPath,
  plan,
  expectedDeployedSha,
  actualDeployedSha,
  railwayIdentity,
  acceptedExactDatabaseFingerprints = [],
  DatabaseConstructor = Database,
}) {
  const deployedSha = assertDeploymentSha(expectedDeployedSha, actualDeployedSha);
  const resolvedDbPath = path.resolve(dbPath);
  if (plan?.sourceDbPath && path.resolve(plan.sourceDbPath) !== resolvedDbPath) {
    fail('SOURCE_DB_PATH_MISMATCH', 'The plan is pinned to a different SQLite path.');
  }
  if (!fs.existsSync(resolvedDbPath)) fail('DATABASE_NOT_FOUND', 'The production SQLite file is missing.');
  const beforeFiles = sqliteFileSet(resolvedDbPath);
  const db = new DatabaseConstructor(resolvedDbPath, { readonly: true, fileMustExist: true });
  let preview;
  let inventory;
  let totalChangesBefore;
  let totalChangesAfter;
  let integrity;
  let foreignKeyViolations;
  let databaseFingerprint;
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('query_only = ON');
    totalChangesBefore = sqliteTotalChanges(db);
    db.transaction(() => {
      preview = planProductionScopeRemediation({ db, plan });
      inventory = buildUserInventory(readUsers(db), plan);
      integrity = db.pragma('integrity_check');
      foreignKeyViolations = db.pragma('foreign_key_check');
      databaseFingerprint = databaseContentFingerprint(db);
    })();
    totalChangesAfter = sqliteTotalChanges(db);
  } finally {
    db.close();
  }
  const afterFiles = sqliteFileSet(resolvedDbPath);
  const runtimeBlockers = [
    ...inventory.blockers,
    ...authorityConfigChecksumBlockers(plan, preview),
    ...exactSourceBindingBlockers(plan, {
      databaseFingerprint,
      railwayIdentity,
      acceptedDatabaseFingerprints: acceptedExactDatabaseFingerprints,
    }),
  ];
  if (totalChangesAfter - totalChangesBefore !== 0) {
    runtimeBlockers.push({ code: 'PREFLIGHT_REPORTED_WRITES' });
  }
  if (!dataFilesUnchanged(beforeFiles, afterFiles)) {
    runtimeBlockers.push({ code: 'PRODUCTION_DATA_FILES_CHANGED_DURING_PREFLIGHT' });
  }
  if (integrity?.[0]?.integrity_check !== 'ok') {
    runtimeBlockers.push({ code: 'SQLITE_INTEGRITY_CHECK_FAILED' });
  }
  if (foreignKeyViolations.length > 0) {
    runtimeBlockers.push({ code: 'SQLITE_FOREIGN_KEY_CHECK_FAILED', count: foreignKeyViolations.length });
  }
  const nonBackupCoreBlockers = coreBlockersExceptBackup(preview);
  return {
    mode: 'preflight',
    ok: preview.blockers.length === 0 && runtimeBlockers.length === 0,
    readyForBackup: nonBackupCoreBlockers.length === 0 && runtimeBlockers.length === 0,
    readyToApply: preview.readyToApply && runtimeBlockers.length === 0,
    deployedSha,
    railwayIdentity: railwayIdentity || null,
    bundledPlanChecksum: planHash(plan),
    authorityConfigChecksum: preview.identity?.configChecksum || null,
    executionPlanChecksum: preview.planChecksum,
    stateFingerprint: preview.stateFingerprint,
    databaseFingerprint,
    sourceDbIdentity: dbIdentityHash(preview.observed.dbIdentity),
    blockers: [...preview.blockers, ...runtimeBlockers],
    plannedDiff: preview.plannedDiff,
    expectedPostState: preview.expectedPostState,
    observed: preview.observed,
    userInventory: {
      rows: inventory.rows,
      fingerprint: inventory.fingerprint,
      totalCount: inventory.rows.length,
      eligibleActiveCount: inventory.eligibleActiveCount,
    },
    sqlite: {
      integrity: integrity?.[0]?.integrity_check || null,
      foreignKeyViolationCount: foreignKeyViolations.length,
      beforeFiles,
      afterFiles,
      beforeFileSetFingerprint: sqliteFileSetFingerprint(beforeFiles),
      afterFileSetFingerprint: sqliteFileSetFingerprint(afterFiles),
      beforeObservedFileSetFingerprint: sqliteObservedFileSetFingerprint(beforeFiles),
      afterObservedFileSetFingerprint: sqliteObservedFileSetFingerprint(afterFiles),
      databaseAndWalUnchanged: dataFilesUnchanged(beforeFiles, afterFiles),
      shmObservationUnchanged: stableJson(normalizedSqliteFileSet(beforeFiles).shm)
        === stableJson(normalizedSqliteFileSet(afterFiles).shm),
    },
    runtimeSafety: {
      readonly: true,
      queryOnly: true,
      totalChangesBefore,
      totalChangesAfter,
      totalChangesDelta: totalChangesAfter - totalChangesBefore,
    },
  };
}

function validateSnapshotDatabase(snapshotPath, plan, DatabaseConstructor = Database) {
  const db = new DatabaseConstructor(snapshotPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('query_only = ON');
    const preview = planProductionScopeRemediation({ db, plan });
    const integrity = db.pragma('integrity_check');
    const foreignKeyViolations = db.pragma('foreign_key_check');
    if (integrity?.[0]?.integrity_check !== 'ok' || foreignKeyViolations.length > 0) {
      fail('BACKUP_SQLITE_VALIDATION_FAILED', 'The SQLite backup failed integrity validation.');
    }
    return {
      stateFingerprint: preview.stateFingerprint,
      databaseFingerprint: databaseContentFingerprint(db),
      sourceDbIdentity: dbIdentityHash(databaseIdentity(db)),
      authorityConfigChecksum: preview.identity?.configChecksum || null,
      integrity: integrity[0].integrity_check,
      foreignKeyViolationCount: foreignKeyViolations.length,
    };
  } finally {
    db.close();
  }
}

function inspectBackupDatabase(backupPath, plan, DatabaseConstructor = Database) {
  const archive = inspectFullBackupArchive(backupPath);
  for (const name of archive.entries.keys()) validateStoredZipEntry(archive, name);
  const snapshot = readStoredZipEntry(archive, 'database/app.sqlite');
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rentcore-remediation-verify-'));
  const snapshotPath = path.join(tempDir, 'app.sqlite');
  try {
    fs.writeFileSync(snapshotPath, snapshot, { mode: 0o600, flag: 'wx' });
    return {
      archive,
      validation: validateSnapshotDatabase(snapshotPath, plan, DatabaseConstructor),
    };
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
}

async function runBackup({
  dbPath,
  plan,
  expectedDeployedSha,
  actualDeployedSha,
  conservationState,
  readData,
  createSqliteBackup,
  collections,
  buildInfo,
  railwayIdentity,
  now = new Date(),
  DatabaseConstructor = Database,
}) {
  assertProductionExecutionAuthorized(plan);
  assertConservation(conservationState);
  const preflight = runPreflight({
    dbPath,
    plan,
    expectedDeployedSha,
    actualDeployedSha,
    railwayIdentity,
    DatabaseConstructor,
  });
  const blockers = coreBlockersExceptBackup({ blockers: preflight.blockers });
  if (blockers.length > 0 || !preflight.readyForBackup) {
    fail('BACKUP_PREFLIGHT_BLOCKED', 'Backup source preflight has blockers.', 409, blockers);
  }
  const filename = `rentcore-phase-a-${backupTimestamp(now)}.zip`;
  const outputPath = safeBackupPath(dbPath, filename);
  if (fs.existsSync(outputPath)) fail('BACKUP_ALREADY_EXISTS', 'The backup already exists.');
  fs.mkdirSync(path.dirname(outputPath), { recursive: true, mode: 0o700 });
  let backup = null;
  let receiptPath = null;
  let published = false;
  try {
    const sourceFilesBeforeBackup = sqliteFileSet(dbPath);
    if (sqliteFileSetFingerprint(sourceFilesBeforeBackup) !== preflight.sqlite.afterFileSetFingerprint) {
      fail('BACKUP_SOURCE_STATE_CHANGED', 'Durable SQLite DB/WAL changed after the frozen preflight.');
    }
    backup = await createFullBackupArchive({
      readData,
      dbPath,
      createDatabaseBackup: createSqliteBackup,
      collections,
      buildInfo,
      now,
    });
    if (backup.manifest?.database?.includedAs !== 'database/app.sqlite') {
      fail('COHERENT_SQLITE_BACKUP_MISSING', 'The archive has no SQLite backup API snapshot.');
    }
    if (Number(backup.manifest?.skippedFilesCount) !== 0) {
      fail('BACKUP_FILES_SKIPPED', 'The full backup omitted one or more business files.');
    }
    const inspected = inspectBackupDatabase(backup.path, plan, DatabaseConstructor);
    if (inspected.validation.stateFingerprint !== preflight.stateFingerprint) {
      fail('BACKUP_SOURCE_STATE_CHANGED', 'Backup snapshot state differs from the frozen preflight.');
    }
    if (inspected.validation.databaseFingerprint !== preflight.databaseFingerprint) {
      fail('BACKUP_SOURCE_STATE_CHANGED', 'Backup snapshot database differs from the frozen preflight.');
    }
    if (inspected.validation.authorityConfigChecksum !== preflight.authorityConfigChecksum) {
      fail(
        'BACKUP_SOURCE_STATE_CHANGED',
        'Backup snapshot identity authority checksum differs from the frozen preflight.',
      );
    }
    const sourceFilesAfterBackup = sqliteFileSet(dbPath);
    if (sqliteFileSetFingerprint(sourceFilesAfterBackup) !== sqliteFileSetFingerprint(sourceFilesBeforeBackup)) {
      fail('BACKUP_SOURCE_FILES_CHANGED', 'Durable SQLite DB/WAL changed while the backup was created.');
    }
    fs.copyFileSync(backup.path, outputPath, fs.constants.COPYFILE_EXCL);
    fs.chmodSync(outputPath, 0o600);
    const outputFd = fs.openSync(outputPath, 'r');
    try {
      fs.fsyncSync(outputFd);
    } finally {
      fs.closeSync(outputFd);
    }
    const receipt = {
      receiptVersion: 2,
      backupId: crypto.randomUUID(),
      filename,
      generatedAt: now.toISOString(),
      sizeBytes: fs.statSync(outputPath).size,
      sha256: fileSha256(outputPath),
      sourceDbIdentity: inspected.validation.sourceDbIdentity,
      stateFingerprint: inspected.validation.stateFingerprint,
      databaseFingerprint: inspected.validation.databaseFingerprint,
      userInventoryFingerprint: preflight.userInventory.fingerprint,
      sourceFileSet: normalizedSqliteFileSet(sourceFilesAfterBackup),
      sourceFileSetFingerprint: sqliteFileSetFingerprint(sourceFilesAfterBackup),
      sourceObservedFileSetFingerprint: sqliteObservedFileSetFingerprint(sourceFilesAfterBackup),
      deployedSha: preflight.deployedSha,
      bundledPlanChecksum: preflight.bundledPlanChecksum,
      authorityConfigChecksum: preflight.authorityConfigChecksum,
      canonicalCompanyId: plan.authority.companyId,
      railwayIdentity: railwayIdentity || null,
      integrity: inspected.validation.integrity,
      foreignKeyViolationCount: inspected.validation.foreignKeyViolationCount,
      databaseIncludedAs: backup.manifest.database.includedAs,
      skippedFilesCount: Number(backup.manifest.skippedFilesCount),
    };
    const executionPlan = buildExecutionPlan(plan, receipt);
    const snapshotPreview = inspectBackupDatabase(outputPath, executionPlan, DatabaseConstructor);
    const dbBuffer = readStoredZipEntry(snapshotPreview.archive, 'database/app.sqlite');
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'rentcore-remediation-plan-'));
    const snapshotPath = path.join(tempDir, 'app.sqlite');
    let executionPreview;
    let expectedPostDatabaseFingerprint;
    try {
      fs.writeFileSync(snapshotPath, dbBuffer, { mode: 0o600, flag: 'wx' });
      const snapshotDb = new DatabaseConstructor(snapshotPath, { fileMustExist: true });
      try {
        snapshotDb.pragma('foreign_keys = ON');
        executionPreview = planProductionScopeRemediation({ db: snapshotDb, plan: executionPlan });
        if (executionPreview.readyToApply) {
          applyProductionScopeRemediation({
            db: snapshotDb,
            plan: executionPlan,
            explicitApply: true,
            expectedPlanChecksum: executionPreview.planChecksum,
          });
          expectedPostDatabaseFingerprint = databaseContentFingerprint(snapshotDb);
        }
      } finally {
        snapshotDb.close();
      }
    } finally {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
    receipt.executionPlanChecksum = executionPreview.planChecksum;
    receipt.expectedPostDatabaseFingerprint = expectedPostDatabaseFingerprint || null;
    receiptPath = writeStoredReceipt(dbPath, receipt);
    published = true;
    return {
      mode: 'backup',
      ok: true,
      deployedSha: preflight.deployedSha,
      receipt,
      executionPlanChecksum: executionPreview.planChecksum,
      readyToApplyAfterIndependentCopy: executionPreview.readyToApply,
      blockers: executionPreview.blockers,
      nextGate: 'Copy the archive to approved independent protected storage, verify SHA-256, then run apply separately.',
    };
  } finally {
    if (!published && fs.existsSync(outputPath)) fs.rmSync(outputPath, { force: true });
    if (!published && receiptPath && fs.existsSync(receiptPath)) fs.rmSync(receiptPath, { force: true });
    if (backup) cleanupBackupArchive(backup);
  }
}

function assertFreshReceipt(receipt, now = new Date()) {
  const timestamp = Date.parse(receipt.generatedAt);
  if (!Number.isFinite(timestamp) || timestamp > now.getTime() + 60_000
    || now.getTime() - timestamp > MAX_BACKUP_AGE_MS) {
    fail('BACKUP_NOT_FRESH', 'The verified remediation backup is not fresh.');
  }
}

function validateStoredBackup({
  dbPath,
  plan,
  receipt,
  expectedStateFingerprint,
  expectedDatabaseFingerprint,
  DatabaseConstructor,
}) {
  const backupPath = safeBackupPath(dbPath, receipt?.filename);
  if (!fs.existsSync(backupPath)) fail('VERIFIED_BACKUP_REQUIRED', 'The verified backup file is missing.');
  if (fs.statSync(backupPath).size !== receipt.sizeBytes || fileSha256(backupPath) !== receipt.sha256) {
    fail('BACKUP_RECEIPT_MISMATCH', 'The stored backup does not match its approved receipt.');
  }
  const inspected = inspectBackupDatabase(backupPath, plan, DatabaseConstructor);
  if (
    inspected.validation.stateFingerprint !== receipt.stateFingerprint
    || inspected.validation.stateFingerprint !== expectedStateFingerprint
    || inspected.validation.sourceDbIdentity !== receipt.sourceDbIdentity
    || inspected.validation.authorityConfigChecksum !== (receipt.authorityConfigChecksum ?? null)
    || inspected.validation.databaseFingerprint !== receipt.databaseFingerprint
    || inspected.validation.databaseFingerprint !== expectedDatabaseFingerprint
  ) {
    fail('BACKUP_SOURCE_MISMATCH', 'The stored backup is not from the approved source state.');
  }
  return inspected.validation;
}

function assertIndependentBackupEvidence(evidence, receipt, now = new Date()) {
  const repository = normalizedText(evidence?.repository, 160);
  const runId = normalizedText(evidence?.runId, 32);
  const artifactName = normalizedText(evidence?.artifactName, 180);
  const artifactUrl = normalizedText(evidence?.artifactUrl, 500);
  const approvalReference = normalizedText(evidence?.operatorApprovalReference, 240);
  const verifiedAt = Date.parse(evidence?.verifiedAt);
  const expectedArtifactName = `production-scope-remediation-backup-${runId}`;
  const expectedArtifactUrlPrefix = `https://github.com/${repository}/actions/runs/${runId}/artifacts/`;
  const receiptBindingsMatch = (
    evidence?.backupId === receipt.backupId
    && evidence?.filename === receipt.filename
    && evidence?.backupSha256 === receipt.sha256
    && evidence?.backupSizeBytes === receipt.sizeBytes
    && evidence?.deployedSha === receipt.deployedSha
    && evidence?.stateFingerprint === receipt.stateFingerprint
    && evidence?.userInventoryFingerprint === receipt.userInventoryFingerprint
    && evidence?.databaseFingerprint === receipt.databaseFingerprint
    && evidence?.sourceFileSetFingerprint === receipt.sourceFileSetFingerprint
    && evidence?.sourceObservedFileSetFingerprint === receipt.sourceObservedFileSetFingerprint
    && evidence?.canonicalCompanyId === receipt.canonicalCompanyId
    && evidence?.bundledPlanChecksum === receipt.bundledPlanChecksum
    && (
      receipt.authorityConfigChecksum == null
      || evidence?.authorityConfigChecksum === receipt.authorityConfigChecksum
    )
    && evidence?.executionPlanChecksum === receipt.executionPlanChecksum
    && evidence?.expectedPostDatabaseFingerprint === receipt.expectedPostDatabaseFingerprint
    && stableJson(evidence?.railwayIdentity || null) === stableJson(receipt.railwayIdentity || null)
  );
  if (
    evidence?.evidenceVersion !== 1
    || evidence?.provider !== 'github-actions-encrypted-artifact'
    || repository !== 'rishatkznAI/rental-management'
    || !/^[1-9][0-9]{0,19}$/.test(runId)
    || artifactName !== expectedArtifactName
    || !artifactUrl.startsWith(expectedArtifactUrlPrefix)
    || !/^[1-9][0-9]*$/.test(artifactUrl.slice(expectedArtifactUrlPrefix.length))
    || !HEX_64.test(normalizedText(evidence?.encryptedArchiveSha256, 64))
    || !/^(?:sha256:)?[a-f0-9]{64}$/.test(normalizedText(evidence?.githubArtifactDigest, 80))
    || !Number.isSafeInteger(evidence?.encryptedArchiveSizeBytes)
    || evidence.encryptedArchiveSizeBytes <= 0
    || evidence?.decryptabilityVerified !== true
    || evidence?.decryptedArchiveSha256 !== receipt.sha256
    || evidence?.decryptedArchiveSizeBytes !== receipt.sizeBytes
    || approvalReference.length < 16
    || /[\u0000-\u001f\u007f]/.test(approvalReference)
    || evidence?.confirmation !== INDEPENDENT_COPY_CONFIRMATION
    || !ISO_UTC_TIMESTAMP.test(String(evidence?.verifiedAt || ''))
    || !Number.isFinite(verifiedAt)
    || verifiedAt < Date.parse(receipt.generatedAt)
    || verifiedAt > now.getTime() + 60_000
    || !receiptBindingsMatch
  ) {
    fail(
      'INDEPENDENT_BACKUP_EVIDENCE_INVALID',
      'Complete receipt-bound protected off-volume copy evidence is required.',
    );
  }
  return sha256(stableJson(evidence));
}

function runApply({
  dbPath,
  plan,
  receipt,
  expectedDeployedSha,
  actualDeployedSha,
  expectedAuthorityConfigChecksum,
  expectedPlanChecksum,
  expectedStateFingerprint,
  expectedUserInventoryFingerprint,
  expectedDatabaseFingerprint,
  expectedSourceFileSetFingerprint,
  expectedPostDatabaseFingerprint,
  approvedCompanyId,
  confirmation,
  independentBackupEvidence,
  conservationState,
  ensureDb,
  railwayIdentity,
  now = new Date(),
  DatabaseConstructor = Database,
  faultInjector,
}) {
  assertProductionExecutionAuthorized(plan);
  assertConservation(conservationState);
  const deployedSha = assertDeploymentSha(expectedDeployedSha, actualDeployedSha);
  if (confirmation !== APPLY_CONFIRMATION) {
    fail('EXPLICIT_APPLY_CONFIRMATION_REQUIRED', 'Exact Phase A apply confirmation is required.');
  }
  if (approvedCompanyId !== plan?.authority?.companyId || approvedCompanyId !== plan?.authority?.tenantId) {
    fail('APPROVED_COMPANY_ID_MISMATCH', 'The approved canonical Company ID does not match the plan.');
  }
  const plannedAuthorityConfigChecksum = authorityConfigChecksum(plan);
  if (
    hasIdentityBootstrap(plan)
    && (typeof expectedAuthorityConfigChecksum !== 'string'
      || !HEX_64.test(expectedAuthorityConfigChecksum))
  ) {
    fail(
      'AUTHORITY_CONFIG_CHECKSUM_REQUIRED',
      'The exact approved identity authority configuration checksum is required.',
    );
  }
  if (
    hasIdentityBootstrap(plan)
    && expectedAuthorityConfigChecksum !== plannedAuthorityConfigChecksum
  ) {
    fail(
      'AUTHORITY_CONFIG_CHECKSUM_MISMATCH',
      'The approved identity authority configuration checksum does not match the plan.',
    );
  }
  if (!HEX_64.test(normalizedText(expectedPlanChecksum, 64))) {
    fail('PLAN_CHECKSUM_REQUIRED', 'The exact approved execution plan checksum is required.');
  }
  if (!HEX_64.test(normalizedText(expectedStateFingerprint, 64))) {
    fail('STATE_FINGERPRINT_REQUIRED', 'The exact approved state fingerprint is required.');
  }
  if (!HEX_64.test(normalizedText(expectedUserInventoryFingerprint, 64))) {
    fail('USER_INVENTORY_FINGERPRINT_REQUIRED', 'The approved user inventory fingerprint is required.');
  }
  if (!HEX_64.test(normalizedText(expectedDatabaseFingerprint, 64))) {
    fail('DATABASE_FINGERPRINT_REQUIRED', 'The exact approved database fingerprint is required.');
  }
  if (!HEX_64.test(normalizedText(expectedSourceFileSetFingerprint, 64))) {
    fail('SQLITE_FILE_SET_FINGERPRINT_REQUIRED', 'The exact approved durable DB/WAL fingerprint is required.');
  }
  if (!HEX_64.test(normalizedText(expectedPostDatabaseFingerprint, 64))) {
    fail('EXPECTED_POST_DATABASE_FINGERPRINT_REQUIRED', 'The exact approved post-state fingerprint is required.');
  }
  const storedReceipt = loadStoredReceipt(dbPath, receipt, plan);
  assertReceiptBindings({ receipt: storedReceipt, plan, deployedSha, railwayIdentity });
  if (
    hasIdentityBootstrap(plan)
    && storedReceipt.authorityConfigChecksum !== expectedAuthorityConfigChecksum
  ) {
    fail(
      'BACKUP_RECEIPT_AUTHORITY_CONFIG_CHECKSUM_MISMATCH',
      'The approved identity authority configuration checksum does not match the stored receipt.',
    );
  }
  if (
    storedReceipt.executionPlanChecksum !== expectedPlanChecksum
    || storedReceipt.stateFingerprint !== expectedStateFingerprint
    || storedReceipt.userInventoryFingerprint !== expectedUserInventoryFingerprint
    || storedReceipt.databaseFingerprint !== expectedDatabaseFingerprint
    || storedReceipt.sourceFileSetFingerprint !== expectedSourceFileSetFingerprint
    || storedReceipt.expectedPostDatabaseFingerprint !== expectedPostDatabaseFingerprint
  ) {
    fail('BACKUP_RECEIPT_APPROVAL_MISMATCH', 'Approved fingerprints do not match the stored receipt.');
  }
  const independentBackupEvidenceSha256 = assertIndependentBackupEvidence(
    independentBackupEvidence,
    storedReceipt,
    now,
  );
  const executionPlan = buildExecutionPlan(plan, storedReceipt);
  assertFreshReceipt(storedReceipt, now);
  const preflight = runPreflight({
    dbPath,
    plan: executionPlan,
    expectedDeployedSha,
    actualDeployedSha,
    railwayIdentity,
    DatabaseConstructor,
  });
  if (preflight.userInventory.fingerprint !== expectedUserInventoryFingerprint) {
    fail('USER_INVENTORY_CHANGED', 'The production user inventory changed after approval.');
  }
  if (preflight.stateFingerprint !== expectedStateFingerprint) {
    fail('STATE_FINGERPRINT_MISMATCH', 'Production state changed after approval.');
  }
  if (preflight.executionPlanChecksum !== expectedPlanChecksum) {
    fail('PLAN_CHECKSUM_MISMATCH', 'The approved execution plan checksum does not match.');
  }
  if (
    hasIdentityBootstrap(plan)
    && preflight.authorityConfigChecksum !== expectedAuthorityConfigChecksum
  ) {
    fail(
      'AUTHORITY_CONFIG_CHECKSUM_MISMATCH',
      'The fresh apply preflight authority configuration checksum does not match.',
    );
  }
  if (preflight.databaseFingerprint !== storedReceipt.databaseFingerprint) {
    fail('DATABASE_FINGERPRINT_MISMATCH', 'The complete production database changed after backup.');
  }
  if (preflight.sqlite.afterFileSetFingerprint !== storedReceipt.sourceFileSetFingerprint) {
    fail('SQLITE_FILE_SET_CHANGED', 'Production DB/WAL changed after backup.');
  }
  if (!preflight.readyToApply) {
    fail('APPLY_PREFLIGHT_BLOCKED', 'Apply preflight has blockers.', 409, preflight.blockers);
  }
  validateStoredBackup({
    dbPath,
    plan,
    receipt: storedReceipt,
    expectedStateFingerprint,
    expectedDatabaseFingerprint: storedReceipt.databaseFingerprint,
    DatabaseConstructor,
  });
  const db = ensureDb();
  // better-sqlite3 turns a nested transaction into a SAVEPOINT, even when the
  // wrapper's `.immediate()` variant is used. Accepting an already-active outer
  // transaction would therefore lose both guarantees this runner needs: it
  // would not acquire its own BEGIN IMMEDIATE lock and could return success
  // before the outer transaction commits. Fail closed before any mutation.
  if (db?.inTransaction) {
    fail(
      'REMEDIATION_DATABASE_TRANSACTION_ACTIVE',
      'Production remediation requires sole ownership of a top-level SQLite transaction.',
    );
  }
  db.pragma('foreign_keys = ON');
  const before = sqliteTotalChanges(db);
  const result = applyProductionScopeRemediation({
    db,
    plan: executionPlan,
    explicitApply: true,
    expectedPlanChecksum,
    transactionalGuard() {
      if (hasIdentityBootstrap(executionPlan)) {
        const transactionalPreflight = planProductionScopeRemediation({
          db,
          plan: executionPlan,
        });
        if (
          transactionalPreflight.identity?.configChecksum !== expectedAuthorityConfigChecksum
          || authorityConfigChecksum(executionPlan) !== expectedAuthorityConfigChecksum
        ) {
          fail(
            'TRANSACTIONAL_AUTHORITY_CONFIG_CHECKSUM_MISMATCH',
            'The transaction-local identity authority configuration checksum changed before the first write.',
          );
        }
      }
      if (sqliteFileSetFingerprint(sqliteFileSet(dbPath)) !== storedReceipt.sourceFileSetFingerprint) {
        fail('TRANSACTIONAL_SQLITE_FILE_SET_MISMATCH', 'DB/WAL changed before the first write.');
      }
      if (databaseContentFingerprint(db) !== storedReceipt.databaseFingerprint) {
        fail('TRANSACTIONAL_DATABASE_FINGERPRINT_MISMATCH', 'Database changed before the first write.');
      }
    },
    transactionalPostGuard() {
      if (databaseContentFingerprint(db) !== storedReceipt.expectedPostDatabaseFingerprint) {
        fail('TRANSACTIONAL_POST_STATE_FINGERPRINT_MISMATCH', 'Unexpected post-state before commit.');
      }
    },
    faultInjector,
  });
  return {
    mode: 'apply',
    ok: true,
    status: result.status,
    writes: sqliteTotalChanges(db) - before,
    collectionWrites: result.collectionWrites,
    bootstrapStatus: result.bootstrapStatus,
    planChecksum: expectedPlanChecksum,
    authorityConfigChecksum: plannedAuthorityConfigChecksum,
    sourceStateFingerprint: expectedStateFingerprint,
    postDatabaseFingerprint: storedReceipt.expectedPostDatabaseFingerprint,
    backupId: storedReceipt.backupId,
    independentBackupEvidenceSha256,
  };
}

function readCollection(db, name) {
  const row = prepareSqliteReadonlyStatement(db, 'SELECT json FROM app_data WHERE name = ?').get(name);
  if (!row) return [];
  const value = JSON.parse(row.json);
  return Array.isArray(value) ? value : [];
}

function runVerify({
  dbPath,
  plan,
  receipt,
  expectedDeployedSha,
  actualDeployedSha,
  conservationState,
  railwayIdentity,
  DatabaseConstructor = Database,
}) {
  assertConservation(conservationState);
  const deployedSha = assertDeploymentSha(expectedDeployedSha, actualDeployedSha);
  const storedReceipt = loadStoredReceipt(dbPath, receipt, plan);
  assertReceiptBindings({ receipt: storedReceipt, plan, deployedSha, railwayIdentity });
  const executionPlan = buildExecutionPlan(plan, storedReceipt);
  validateStoredBackup({
    dbPath,
    plan,
    receipt: storedReceipt,
    expectedStateFingerprint: storedReceipt.stateFingerprint,
    expectedDatabaseFingerprint: storedReceipt.databaseFingerprint,
    DatabaseConstructor,
  });
  const preflight = runPreflight({
    dbPath,
    plan: executionPlan,
    expectedDeployedSha,
    actualDeployedSha,
    railwayIdentity,
    acceptedExactDatabaseFingerprints: [storedReceipt.expectedPostDatabaseFingerprint],
    DatabaseConstructor,
  });
  const verifyBeforeFiles = sqliteFileSet(dbPath);
  const db = new DatabaseConstructor(path.resolve(dbPath), { readonly: true, fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('query_only = ON');
    const companyId = executionPlan.authority.companyId;
    const company = prepareSqliteReadonlyStatement(db, 'SELECT id, status FROM canonical_companies WHERE id = ?').get(companyId);
    const headOfficeId = executionPlan.authority?.headOffice?.id
      || executionPlan.authority?.identityBootstrap?.branches?.find(branch => branch.isHeadOffice)?.id;
    const headOffice = prepareSqliteReadonlyStatement(db, `
      SELECT id, companyId, status, isHeadOffice
      FROM canonical_branches WHERE id = ?
    `).get(headOfficeId);
    const membershipRows = prepareSqliteReadonlyStatement(db, `
      SELECT id, principalId, companyId, status, companyWideBranchAuthority
      FROM company_memberships WHERE companyId = ? ORDER BY principalId
    `).all(companyId);
    const resolver = createTrustedActorScopeResolver({ db });
    const trustedScopes = [];
    const verificationBlockers = [];
    const totalChangesBefore = sqliteTotalChanges(db);
    if (preflight.databaseFingerprint !== storedReceipt.expectedPostDatabaseFingerprint) {
      verificationBlockers.push({ code: 'UNEXPECTED_POST_DATABASE_FINGERPRINT' });
    }
    // runPreflight and this final verification use separate readonly handles.
    // Recompute the complete logical database after establishing the final file
    // baseline so a write in that handoff cannot hide outside scoped collections.
    // A later write is still caught by the before/after durable DB/WAL gate.
    const verificationDatabaseFingerprint = databaseContentFingerprint(db);
    if (verificationDatabaseFingerprint !== preflight.databaseFingerprint) {
      verificationBlockers.push({ code: 'DATABASE_MUTATION_DURING_VERIFY' });
    }
    if (
      verificationDatabaseFingerprint !== storedReceipt.expectedPostDatabaseFingerprint
      && !verificationBlockers.some(blocker => blocker.code === 'UNEXPECTED_POST_DATABASE_FINGERPRINT')
    ) {
      verificationBlockers.push({ code: 'UNEXPECTED_POST_DATABASE_FINGERPRINT' });
    }
    for (const mapping of executionPlan.actorMappings.filter(item => item.action === 'CREATE_MEMBERSHIP')) {
      try {
        const scope = resolver(mapping.userId);
        trustedScopes.push({
          principalId: mapping.userId,
          companyId: scope.companyId,
          tenantId: scope.tenantId,
          membershipId: scope.membershipId,
        });
      } catch (error) {
        verificationBlockers.push({ code: 'TRUSTED_SCOPE_VERIFICATION_FAILED', userId: mapping.userId });
      }
    }
    for (const mapping of executionPlan.actorMappings.filter(item => item.action === 'NO_MEMBERSHIP')) {
      const unexpected = membershipRows.find(row => row.principalId === mapping.userId && row.status === 'active');
      if (unexpected) {
        verificationBlockers.push({ code: 'INTENTIONALLY_UNMAPPED_ACTOR_HAS_AUTHORITY', userId: mapping.userId });
      }
    }
    const smokeScopeViolations = [];
    for (const mapping of executionPlan.recordMappings.filter(item => item.action === 'LEAVE_UNSCOPED')) {
      const row = readCollection(db, mapping.collection).find(item => item?.id === mapping.id);
      if (!row || normalizedText(row.companyId) || normalizedText(row.tenantId)) {
        smokeScopeViolations.push(`${mapping.collection}:${mapping.id}`);
      }
    }
    let tenantMismatchCount = 0;
    for (const collection of targetCollectionsForPlan(executionPlan)) {
      tenantMismatchCount += readCollection(db, collection).filter(row => (
        normalizedText(row?.companyId) !== normalizedText(row?.tenantId)
      )).length;
    }
    if (!company || company.status !== 'active') verificationBlockers.push({ code: 'COMPANY_VERIFY_FAILED' });
    if (!headOffice || headOffice.companyId !== companyId || headOffice.status !== 'active'
      || Number(headOffice.isHeadOffice) !== 1) {
      verificationBlockers.push({ code: 'HEAD_OFFICE_VERIFY_FAILED' });
    }
    if (smokeScopeViolations.length > 0) {
      verificationBlockers.push({ code: 'SMOKE_RECORD_SCOPE_VIOLATION', count: smokeScopeViolations.length });
    }
    if (tenantMismatchCount > 0) {
      verificationBlockers.push({ code: 'TENANT_COMPANY_MISMATCH', count: tenantMismatchCount });
    }
    const diffCount = preflight.plannedDiff.CREATE.length
      + preflight.plannedDiff.UPDATE.length
      + preflight.plannedDiff.RELINK.length;
    if (diffCount !== 0) verificationBlockers.push({ code: 'IDEMPOTENCY_VERIFY_FAILED', diffCount });
    if (preflight.blockers.length > 0) verificationBlockers.push(...preflight.blockers);
    const totalChangesAfter = sqliteTotalChanges(db);
    const verifyAfterFiles = sqliteFileSet(dbPath);
    if (totalChangesAfter !== totalChangesBefore) {
      verificationBlockers.push({ code: 'VERIFY_REPORTED_WRITES' });
    }
    if (!dataFilesUnchanged(verifyBeforeFiles, verifyAfterFiles)) {
      verificationBlockers.push({ code: 'PRODUCTION_DATA_FILES_CHANGED_DURING_VERIFY' });
    }
    return {
      mode: 'verify',
      ok: verificationBlockers.length === 0,
      deployedSha: preflight.deployedSha,
      stateFingerprint: preflight.stateFingerprint,
      databaseFingerprint: verificationDatabaseFingerprint,
      planChecksum: preflight.executionPlanChecksum,
      blockers: verificationBlockers,
      summary: {
        company: company ? { id: company.id, status: company.status } : null,
        headOffice: headOffice || null,
        memberships: membershipRows,
        trustedScopes,
        smokeScopeViolationCount: smokeScopeViolations.length,
        tenantMismatchCount,
        idempotentPlannedWriteCount: diffCount,
      },
      runtimeSafety: preflight.runtimeSafety,
      verifyRuntimeSafety: {
        readonly: true,
        queryOnly: true,
        totalChangesBefore,
        totalChangesAfter,
        totalChangesDelta: totalChangesAfter - totalChangesBefore,
        beforeFileSetFingerprint: sqliteFileSetFingerprint(verifyBeforeFiles),
        afterFileSetFingerprint: sqliteFileSetFingerprint(verifyAfterFiles),
        beforeObservedFileSetFingerprint: sqliteObservedFileSetFingerprint(verifyBeforeFiles),
        afterObservedFileSetFingerprint: sqliteObservedFileSetFingerprint(verifyAfterFiles),
        databaseAndWalUnchanged: dataFilesUnchanged(verifyBeforeFiles, verifyAfterFiles),
        shmObservationUnchanged: stableJson(normalizedSqliteFileSet(verifyBeforeFiles).shm)
          === stableJson(normalizedSqliteFileSet(verifyAfterFiles).shm),
      },
    };
  } finally {
    db.close();
  }
}

function runRemediation(options = {}) {
  const mode = normalizedText(options.mode || 'preflight', 20);
  if (mode === 'preflight') return runPreflight(options);
  if (mode === 'backup') return runBackup(options);
  if (mode === 'apply') return runApply(options);
  if (mode === 'verify') return runVerify(options);
  fail('REMEDIATION_MODE_INVALID', 'Remediation mode must be preflight, backup, apply, or verify.');
}

module.exports = {
  APPLY_CONFIRMATION,
  INDEPENDENT_COPY_CONFIRMATION,
  ProductionScopeRunnerError,
  buildExecutionPlan,
  buildUserInventory,
  databaseContentFingerprint,
  fileSha256,
  planHash,
  runApply,
  runBackup,
  runRemediation,
  runPreflight,
  runVerify,
  safeBackupPath,
  sqliteFileSet,
  sqliteFileSetFingerprint,
  sqliteObservedFileSetFingerprint,
};
