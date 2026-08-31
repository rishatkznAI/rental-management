const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  ensureSqlShadowSchema,
  syncSqlShadowIndexForCollection,
} = require('./lib/sql-shadow-indexes');
const {
  ensureCanonicalReceivablesSchema,
} = require('./lib/canonical-receivables-schema');
const {
  ensureCanonicalReceivablesSettlementSchema,
} = require('./lib/canonical-receivables-settlement-schema');
const {
  ensurePlatformIdentitySchema,
} = require('./lib/platform-identity-schema');
const {
  ensureBillingSourceAuthoritySchema,
} = require('./lib/billing-source-authority-schema');
const {
  ensureForecastReceivablesPlanningSchema,
} = require('./lib/forecast-receivables-planning-schema');
const {
  ensureActualSourceEligibilityDryRunSchema,
} = require('./lib/actual-source-eligibility-dry-run-schema');
const {
  ensureCanonicalActualPostingSchema,
} = require('./lib/canonical-actual-posting-schema');
const {
  ensureNumberSequenceSchema,
} = require('./lib/number-sequences');
const {
  ensureRequestIdempotencySchema,
} = require('./lib/request-idempotency');
const {
  assertClientInnListUnique,
  assertClientInnWriteAllowed,
  buildClientInnDuplicateReport,
  getClientInnNormalized,
  normalizeClientInnFields,
} = require('./lib/client-inn');
const {
  isProductionScopeWriteFreezeEnabled,
} = require('./lib/feature-flags');
const {
  assertProductionValidationReadOnlyEnvironment,
  assertProductionValidationWriteAllowed,
  isProductionValidationSmokeLoginWriteScopeActive,
  requested: isProductionValidationReadOnlyRequested,
} = require('./lib/production-validation-read-only');
const { ALL_APP_DATA_COLLECTIONS } = require('./lib/app-data-scope-registry');

const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DEFAULT_DATA_DIR, 'app.sqlite');
const DATA_DIR = path.dirname(DB_PATH);

// IMPORTANT: app_data records are schemaless JSON and older rows may not have newly
// introduced fields. The scope registry is the single authoritative inventory.
const JSON_COLLECTIONS = [...ALL_APP_DATA_COLLECTIONS];

let dbInstance = null;

function assertProductionWriteAllowed(operation = 'database write', env = process.env) {
  if (isProductionScopeWriteFreezeEnabled(env)) {
    const error = new Error(`Blocked ${operation}: production scope remediation write freeze is active.`);
    error.code = 'PRODUCTION_SCOPE_WRITE_FREEZE_ACTIVE';
    throw error;
  }
  return assertProductionValidationWriteAllowed(operation, env);
}

function openExactProductionValidationDatabase(dbPath, DatabaseConstructor = Database) {
  let validationDbFd = null;
  let db = null;
  try {
    const stat = fs.lstatSync(dbPath);
    if (!stat.isFile() || stat.isSymbolicLink() || fs.realpathSync(dbPath) !== dbPath) {
      const error = new Error('Validation read-only mode requires the exact non-symlink production database.');
      error.code = 'VALIDATION_PRODUCTION_DATABASE_IDENTITY_MISMATCH';
      throw error;
    }
    validationDbFd = fs.openSync(
      dbPath,
      fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
    );
    const fdStat = fs.fstatSync(validationDbFd);
    if (!fdStat.isFile() || fdStat.dev !== stat.dev || fdStat.ino !== stat.ino) {
      const error = new Error('Validation read-only mode requires a stable production database identity.');
      error.code = 'VALIDATION_PRODUCTION_DATABASE_IDENTITY_MISMATCH';
      throw error;
    }

    db = new DatabaseConstructor(dbPath, { fileMustExist: true });
    const after = fs.lstatSync(dbPath);
    const main = db.pragma('database_list').find(row => row.name === 'main');
    const stableIdentity = after.isFile()
      && !after.isSymbolicLink()
      && after.dev === stat.dev
      && after.ino === stat.ino
      && fs.realpathSync(dbPath) === dbPath
      && path.resolve(String(main?.file || '')) === dbPath;
    if (!stableIdentity) {
      const error = new Error('Production database identity changed while validation opened SQLite.');
      error.code = 'VALIDATION_PRODUCTION_DATABASE_IDENTITY_CHANGED';
      throw error;
    }
    return db;
  } catch (cause) {
    db?.close();
    if (cause?.code?.startsWith?.('VALIDATION_PRODUCTION_DATABASE_')) throw cause;
    const error = new Error('Validation read-only mode requires the exact non-symlink production database.');
    error.code = 'VALIDATION_PRODUCTION_DATABASE_IDENTITY_MISMATCH';
    error.cause = cause;
    throw error;
  } finally {
    if (validationDbFd !== null) fs.closeSync(validationDbFd);
  }
}

function executeProductionValidationSmokeLoginWriteTransaction(db, operation, env = process.env) {
  if (!isProductionValidationReadOnlyRequested(env)) {
    const error = new Error('Production validation smoke-login transaction requires validation mode.');
    error.code = 'PRODUCTION_VALIDATION_TRANSACTION_MODE_REQUIRED';
    throw error;
  }
  assertProductionValidationReadOnlyEnvironment(env);
  if (!isProductionValidationSmokeLoginWriteScopeActive()) {
    const error = new Error('Production validation smoke-login transaction requires its exact technical scope.');
    error.code = 'PRODUCTION_VALIDATION_TRANSACTION_SCOPE_REQUIRED';
    throw error;
  }
  if (!db || typeof db.transaction !== 'function' || typeof operation !== 'function') {
    throw new TypeError('Production validation smoke-login transaction requires SQLite and an operation.');
  }
  if (db.inTransaction) {
    const error = new Error('Production validation smoke-login transaction must own the top-level transaction.');
    error.code = 'PRODUCTION_VALIDATION_TRANSACTION_ALREADY_ACTIVE';
    throw error;
  }
  if (Number(db.pragma('query_only', { simple: true })) !== 1) {
    const error = new Error('Production validation SQLite must be query-only before a smoke login.');
    error.code = 'PRODUCTION_VALIDATION_QUERY_ONLY_REQUIRED';
    throw error;
  }

  let originalError = null;
  try {
    db.pragma('query_only = OFF');
    const transaction = db.transaction(() => {
      const result = operation();
      if (result && typeof result.then === 'function') {
        const error = new Error('Production validation smoke-login persistence must be synchronous.');
        error.code = 'PRODUCTION_VALIDATION_ASYNC_WRITE_FORBIDDEN';
        throw error;
      }
      return result;
    });
    return transaction.immediate();
  } catch (error) {
    originalError = error;
    throw error;
  } finally {
    try {
      db.pragma('query_only = ON');
      if (Number(db.pragma('query_only', { simple: true })) !== 1) {
        throw new Error('SQLite did not restore query-only mode.');
      }
    } catch (cause) {
      const error = new Error('Failed to restore production validation SQLite query-only mode.');
      error.code = 'PRODUCTION_VALIDATION_QUERY_ONLY_RESTORE_FAILED';
      error.cause = cause;
      if (originalError) error.originalError = originalError;
      throw error;
    }
  }
}

function ensureDb() {
  // DB_PATH is captured when this module is loaded. Validate that exact resolved
  // path rather than a mutable later process.env value before SQLite is touched.
  const startupEnvironment = { ...process.env, DB_PATH };
  const validationReadOnlyEnabled = assertProductionValidationReadOnlyEnvironment(startupEnvironment);
  if (dbInstance) {
    if (
      validationReadOnlyEnabled
      && !isProductionValidationSmokeLoginWriteScopeActive()
      && Number(dbInstance.pragma('query_only', { simple: true })) !== 1
    ) {
      const error = new Error('Production validation SQLite escaped query-only mode.');
      error.code = 'PRODUCTION_VALIDATION_QUERY_ONLY_REQUIRED';
      throw error;
    }
    return dbInstance;
  }
  const writeFreezeEnabled = isProductionScopeWriteFreezeEnabled();
  const schemaMutationSuppressed = writeFreezeEnabled || validationReadOnlyEnabled;
  if (schemaMutationSuppressed && !fs.existsSync(DB_PATH)) {
    const error = new Error(
      validationReadOnlyEnabled
        ? 'Production database must already exist during validation read-only mode.'
        : 'Production database must already exist when the remediation write freeze is active.',
    );
    error.code = validationReadOnlyEnabled
      ? 'VALIDATION_PRODUCTION_DATABASE_MISSING'
      : 'FROZEN_PRODUCTION_DATABASE_MISSING';
    throw error;
  }
  if (validationReadOnlyEnabled) {
    const db = openExactProductionValidationDatabase(DB_PATH);
    try {
      db.pragma('foreign_keys = ON');
      db.pragma('query_only = ON');
      dbInstance = db;
      return db;
    } catch (error) {
      db?.close();
      throw error;
    }
  }
  if (!schemaMutationSuppressed) fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH, schemaMutationSuppressed ? { fileMustExist: true } : undefined);
  if (schemaMutationSuppressed) {
    try {
      db.pragma('foreign_keys = ON');
      dbInstance = db;
      return db;
    } catch (error) {
      db.close();
      throw error;
    }
  }
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

    CREATE TABLE IF NOT EXISTS app_sessions (
      token TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS client_inn_index (
      inn_normalized TEXT PRIMARY KEY,
      client_id TEXT NOT NULL UNIQUE,
      company TEXT,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  dbInstance = db;
  ensureSqlShadowSchema(db);
  ensureCanonicalReceivablesSchema(db);
  ensureCanonicalReceivablesSettlementSchema(db);
  ensurePlatformIdentitySchema(db);
  ensureBillingSourceAuthoritySchema(db);
  ensureForecastReceivablesPlanningSchema(db);
  ensureActualSourceEligibilityDryRunSchema(db);
  ensureCanonicalActualPostingSchema(db);
  ensureNumberSequenceSchema(db);
  ensureRequestIdempotencySchema(db);
  syncClientInnIndex({ throwOnDuplicates: false });
  return db;
}

function legacyFilePath(name) {
  return path.join(DATA_DIR, `${name}.json`);
}

function readLegacyJson(name) {
  try {
    const raw = fs.readFileSync(legacyFilePath(name), 'utf8');
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function getData(name) {
  const db = ensureDb();
  const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get(name);
  if (!row) return null;
  try {
    return JSON.parse(row.json);
  } catch (cause) {
    const error = new Error(`Collection ${name} contains invalid JSON.`);
    error.code = 'APP_DATA_INVALID_JSON';
    error.collection = name;
    error.cause = cause;
    throw error;
  }
}

function appDataValueFingerprint(value) {
  return JSON.stringify(value ?? null);
}

function assertExpectedAppDataValues(db, entries) {
  const read = db.prepare('SELECT json FROM app_data WHERE name = ?');
  for (const entry of entries) {
    const row = read.get(entry.name);
    let current = null;
    if (row) {
      try {
        current = JSON.parse(row.json);
      } catch {
        const error = new Error(`Collection ${entry.name} contains invalid JSON.`);
        error.code = 'APP_DATA_COMPARE_AND_SWAP_INVALID_JSON';
        throw error;
      }
    }
    if (appDataValueFingerprint(current) !== entry.expectedFingerprint) {
      const error = new Error(`Collection ${entry.name} changed after it was read; retry the operation.`);
      error.code = 'APP_DATA_CONCURRENT_MODIFICATION';
      error.status = 409;
      error.collection = entry.name;
      throw error;
    }
  }
}

function replaceClientInnIndex(db, clients) {
  const replace = db.prepare(`
    INSERT INTO client_inn_index (inn_normalized, client_id, company)
    VALUES (?, ?, ?)
    ON CONFLICT(inn_normalized) DO UPDATE SET
      client_id = excluded.client_id,
      company = excluded.company,
      updated_at = CURRENT_TIMESTAMP
  `);
  db.prepare('DELETE FROM client_inn_index').run();
  for (const client of clients) {
    const innNormalized = getClientInnNormalized(client);
    if (!innNormalized) continue;
    const companyId = String(client?.companyId || '').trim();
    const tenantId = String(client?.tenantId || '').trim();
    const scopeKey = companyId && tenantId && companyId === tenantId
      ? `tenant:${companyId}`
      : 'legacy-unscoped';
    replace.run(`${scopeKey}|${innNormalized}`, String(client.id || ''), client.company || client.name || '');
  }
}

function checkClientInnDuplicates(clients, { throwOnDuplicates = true } = {}) {
  const duplicates = buildClientInnDuplicateReport(clients);
  if (duplicates.length > 0) {
    const message = `[db] client_inn_index не обновлён: найдены клиенты с одинаковым нормализованным ИНН: ${duplicates
      .map(group => `${group.innNormalized}: ${group.clients.map(client => `${client.company || client.id || 'без названия'} (${client.id || 'без id'})`).join(', ')}`)
      .join('; ')}`;
    if (throwOnDuplicates) {
      assertClientInnListUnique(clients);
    }
    console.warn(message);
    return { ok: false, duplicates };
  }
  return { ok: true, duplicates: [] };
}

function syncClientInnIndex({ throwOnDuplicates = true } = {}) {
  assertProductionWriteAllowed('client INN index synchronization');
  const db = ensureDb();
  const clients = getData('clients');
  if (!Array.isArray(clients)) return { ok: true, duplicates: [] };

  const check = checkClientInnDuplicates(clients, { throwOnDuplicates });
  if (!check.ok) return check;

  const tx = db.transaction((list) => {
    replaceClientInnIndex(db, list);
  });
  tx(clients);
  return { ok: true, duplicates: [] };
}

function setData(name, value) {
  assertProductionWriteAllowed(`collection write (${String(name || 'unknown')})`);
  const db = ensureDb();
  const previousValue = name === 'clients' ? getData('clients') : null;
  const nextValue = name === 'clients' && Array.isArray(value)
    ? value.map(normalizeClientInnFields)
    : value;
  const shouldSyncShadowIndex = (name === 'documents' || name === 'gantt_rentals') && Array.isArray(nextValue);
  if (name === 'clients') {
    if (Array.isArray(previousValue)) {
      assertClientInnWriteAllowed(previousValue, nextValue);
    } else {
      assertClientInnListUnique(nextValue);
    }
  }
  const upsert = db.prepare(`
      INSERT INTO app_data (name, json)
      VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET
        json = excluded.json,
        updated_at = CURRENT_TIMESTAMP
    `);
  const tx = db.transaction(() => {
    upsert.run(name, JSON.stringify(nextValue));
    if (name === 'clients') {
      const duplicateCheck = checkClientInnDuplicates(nextValue, { throwOnDuplicates: false });
      if (duplicateCheck.ok) {
        replaceClientInnIndex(db, nextValue);
      } else {
        db.prepare('DELETE FROM client_inn_index').run();
      }
    }
    if (shouldSyncShadowIndex) {
      const result = syncSqlShadowIndexForCollection(db, name, nextValue);
      const errors = result?.errors || [];
      if (errors.length > 0) {
        const label = name === 'gantt_rentals' ? 'Gantt' : 'Document';
        const error = new Error(`${label} SQL shadow sync failed: ${errors[0].error}`);
        error.code = name === 'gantt_rentals'
          ? 'GANTT_SQL_SHADOW_SYNC_FAILED'
          : 'DOCUMENT_SQL_SHADOW_SYNC_FAILED';
        error.collection = name;
        error.details = { failedRecordIds: errors.map(entry => entry.id).filter(Boolean) };
        throw error;
      }
    }
  });
  tx();
}

function setDataBatch(entries) {
  assertProductionWriteAllowed('collection batch write');
  const normalizedEntries = Array.isArray(entries)
    ? entries.map(entry => ({ name: entry?.name, value: entry?.value }))
    : [];
  if (normalizedEntries.length === 0) return;
  for (const entry of normalizedEntries) {
    if (!entry.name) throw new Error('Collection name is required for batch write');
  }

  const db = ensureDb();
  const tx = db.transaction((rows) => {
    for (const entry of rows) setData(entry.name, entry.value);
  });
  tx(normalizedEntries);
}

function setDataBatchCompareAndSwap(entries) {
  assertProductionWriteAllowed('collection compare-and-swap batch write');
  const normalizedEntries = Array.isArray(entries)
    ? entries.map(entry => ({
      name: String(entry?.name || '').trim(),
      value: entry?.value,
      expectedFingerprint: entry?.expectedFingerprint,
    }))
    : [];
  if (normalizedEntries.length === 0) return;
  for (const entry of normalizedEntries) {
    if (!entry.name) throw new Error('Collection name is required for compare-and-swap write');
    if (typeof entry.expectedFingerprint !== 'string') {
      const error = new Error(`Expected collection fingerprint is required: ${entry.name}.`);
      error.code = 'APP_DATA_EXPECTED_FINGERPRINT_REQUIRED';
      throw error;
    }
  }

  const db = ensureDb();
  const tx = db.transaction((rows) => {
    // BEGIN IMMEDIATE is acquired before the locked reread. All expected values
    // are checked before the first mutation, so a stale tenant view can neither
    // overwrite a peer tenant nor leave a partial multi-collection write.
    assertExpectedAppDataValues(db, rows);
    for (const entry of rows) setData(entry.name, entry.value);
  });
  tx.immediate(normalizedEntries);
}

function setDataCompareAndSwap(name, value, expectedFingerprint) {
  return setDataBatchCompareAndSwap([{ name, value, expectedFingerprint }]);
}

function migrateJsonFilesToDb() {
  const error = new Error(
    'Raw legacy JSON import is disabled. Use the backed-up, manifest-driven, tenant-scoped remediation runner.',
  );
  error.code = 'AUDITED_MAINTENANCE_RUNNER_REQUIRED';
  throw error;
}

function cloneCollectionIfMissing() {
  const error = new Error(
    'Raw collection cloning is disabled. Use a trusted tenant boundary or the audited remediation runner.',
  );
  error.code = 'AUDITED_MAINTENANCE_RUNNER_REQUIRED';
  throw error;
}

function saveSession(token, value, expiresAt) {
  assertProductionWriteAllowed('session write');
  const db = ensureDb();
  db.prepare(`
    INSERT INTO app_sessions (token, json, created_at, expires_at)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(token) DO UPDATE SET
      json = excluded.json,
      created_at = excluded.created_at,
      expires_at = excluded.expires_at
  `).run(token, JSON.stringify(value), Date.now(), expiresAt);
}

function getSession(token) {
  const db = ensureDb();
  const row = db.prepare('SELECT json, expires_at FROM app_sessions WHERE token = ?').get(token);
  if (!row) return null;
  if (Date.now() > row.expires_at) {
    if (!isProductionValidationReadOnlyRequested()) deleteSession(token);
    return null;
  }
  try {
    return JSON.parse(row.json);
  } catch {
    if (!isProductionValidationReadOnlyRequested()) deleteSession(token);
    return null;
  }
}

function deleteSession(token) {
  assertProductionWriteAllowed('session deletion');
  const db = ensureDb();
  db.prepare('DELETE FROM app_sessions WHERE token = ?').run(token);
}

function deleteSessionsForUserIds(userIds) {
  assertProductionWriteAllowed('user session deletion');
  const ids = Array.isArray(userIds)
    ? [...new Set(userIds.map(value => String(value || '').trim()).filter(Boolean))]
    : [];
  if (ids.length === 0) return 0;

  const db = ensureDb();
  const rows = db.prepare('SELECT token, json FROM app_sessions').all();
  const tokensToDelete = rows
    .map(row => {
      try {
        const session = JSON.parse(row.json);
        return ids.includes(String(session?.userId || '').trim()) ? row.token : null;
      } catch {
        return row.token;
      }
    })
    .filter(Boolean);

  const del = db.prepare('DELETE FROM app_sessions WHERE token = ?');
  const tx = db.transaction((tokens) => {
    for (const token of tokens) del.run(token);
  });
  tx(tokensToDelete);
  return tokensToDelete.length;
}

function cleanupExpiredSessions(now = Date.now()) {
  assertProductionWriteAllowed('expired session cleanup');
  const db = ensureDb();
  db.prepare('DELETE FROM app_sessions WHERE expires_at <= ?').run(now);
}

function resetAppData() {
  const error = new Error('Raw application reset is disabled; use the audited clean-reset runner.');
  error.code = 'AUDITED_MAINTENANCE_RUNNER_REQUIRED';
  throw error;
}

async function createSqliteBackup(targetPath) {
  const db = ensureDb();
  fs.mkdirSync(path.dirname(targetPath), { recursive: true });
  await db.backup(targetPath);
  return targetPath;
}

function countActiveSessions(now = Date.now()) {
  const db = ensureDb();
  const row = db.prepare('SELECT COUNT(*) AS count FROM app_sessions WHERE expires_at > ?').get(now);
  return row?.count || 0;
}

module.exports = {
  appDataValueFingerprint,
  assertProductionWriteAllowed,
  DB_PATH,
  cloneCollectionIfMissing,
  countActiveSessions,
  createSqliteBackup,
  cleanupExpiredSessions,
  deleteSession,
  deleteSessionsForUserIds,
  ensureDb,
  executeProductionValidationSmokeLoginWriteTransaction,
  getData,
  getSession,
  JSON_COLLECTIONS,
  setData,
  setDataCompareAndSwap,
  migrateJsonFilesToDb,
  openExactProductionValidationDatabase,
  resetAppData,
  saveSession,
  syncClientInnIndex,
  setDataBatch,
  setDataBatchCompareAndSwap,
};
