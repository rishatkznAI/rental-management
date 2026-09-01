const REQUEST_IDEMPOTENCY_SCHEMA_VERSION = 1;
const REQUEST_IDEMPOTENCY_TABLE = 'request_idempotency';
const REQUEST_IDEMPOTENCY_MIGRATIONS_TABLE = 'request_idempotency_schema_migrations';
const LEGACY_IDEMPOTENCY_COLLECTIONS = Object.freeze([
  'inline_relation_idempotency',
  'rental_create_idempotency',
]);

function text(value) {
  return String(value ?? '').trim();
}

function idempotencyError(code, message, status = 500, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function tableExists(db, table) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = ?
  `).get(table));
}

function objectExists(db, type, name) {
  return Boolean(db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = ? AND name = ?
  `).get(type, name));
}

function tableColumns(db, table) {
  if (!tableExists(db, table)) return [];
  return db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
}

function assertDatabase(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    throw idempotencyError(
      'IDEMPOTENCY_DATABASE_REQUIRED',
      'Для серверной идемпотентности требуется SQLite database handle.',
    );
  }
}

function assertRequestIdempotencySchema(db) {
  assertDatabase(db);
  const requiredTables = [REQUEST_IDEMPOTENCY_MIGRATIONS_TABLE, REQUEST_IDEMPOTENCY_TABLE];
  for (const table of requiredTables) {
    if (!tableExists(db, table)) {
      throw idempotencyError('IDEMPOTENCY_SCHEMA_MISSING', `Отсутствует таблица ${table}.`);
    }
  }

  const requiredColumns = new Set([
    'tenant_id',
    'operation',
    'client_key',
    'request_fingerprint',
    'result_type',
    'result_id',
    'created_by_user_id',
    'created_at',
  ]);
  const actualColumns = new Set(tableColumns(db, REQUEST_IDEMPOTENCY_TABLE));
  for (const column of requiredColumns) {
    if (!actualColumns.has(column)) {
      throw idempotencyError(
        'IDEMPOTENCY_SCHEMA_DRIFT',
        `Отсутствует колонка ${REQUEST_IDEMPOTENCY_TABLE}.${column}.`,
      );
    }
  }

  const migration = db.prepare(`
    SELECT version
    FROM ${REQUEST_IDEMPOTENCY_MIGRATIONS_TABLE}
    WHERE version = ?
  `).get(REQUEST_IDEMPOTENCY_SCHEMA_VERSION);
  if (!migration) {
    throw idempotencyError(
      'IDEMPOTENCY_SCHEMA_DRIFT',
      `Не зарегистрирована версия схемы идемпотентности ${REQUEST_IDEMPOTENCY_SCHEMA_VERSION}.`,
    );
  }

  for (const trigger of [
    'trg_request_idempotency_no_update',
    'trg_request_idempotency_no_delete',
    'trg_request_idempotency_no_replace',
  ]) {
    if (!objectExists(db, 'trigger', trigger)) {
      throw idempotencyError('IDEMPOTENCY_SCHEMA_DRIFT', `Отсутствует триггер ${trigger}.`);
    }
  }
  return true;
}

function ensureRequestIdempotencySchema(db) {
  assertDatabase(db);
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${REQUEST_IDEMPOTENCY_MIGRATIONS_TABLE} (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ${REQUEST_IDEMPOTENCY_TABLE} (
      tenant_id TEXT NOT NULL,
      operation TEXT NOT NULL,
      client_key TEXT NOT NULL,
      request_fingerprint TEXT NOT NULL,
      result_type TEXT NOT NULL,
      result_id TEXT NOT NULL,
      created_by_user_id TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (tenant_id, operation, client_key),
      CHECK (length(trim(tenant_id)) > 0),
      CHECK (length(trim(operation)) > 0),
      CHECK (length(trim(client_key)) BETWEEN 8 AND 128),
      CHECK (length(request_fingerprint) = 64),
      CHECK (length(trim(result_type)) > 0),
      CHECK (length(trim(result_id)) > 0),
      CHECK (length(trim(created_by_user_id)) > 0),
      CHECK (length(trim(created_at)) > 0)
    );

    CREATE TRIGGER IF NOT EXISTS trg_request_idempotency_no_update
    BEFORE UPDATE ON ${REQUEST_IDEMPOTENCY_TABLE}
    BEGIN
      SELECT RAISE(ABORT, 'REQUEST_IDEMPOTENCY_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_request_idempotency_no_delete
    BEFORE DELETE ON ${REQUEST_IDEMPOTENCY_TABLE}
    BEGIN
      SELECT RAISE(ABORT, 'REQUEST_IDEMPOTENCY_IMMUTABLE');
    END;

    CREATE TRIGGER IF NOT EXISTS trg_request_idempotency_no_replace
    BEFORE INSERT ON ${REQUEST_IDEMPOTENCY_TABLE}
    WHEN EXISTS (
      SELECT 1
      FROM ${REQUEST_IDEMPOTENCY_TABLE}
      WHERE tenant_id = NEW.tenant_id
        AND operation = NEW.operation
        AND client_key = NEW.client_key
    )
    BEGIN
      SELECT RAISE(ABORT, 'REQUEST_IDEMPOTENCY_IMMUTABLE');
    END;
  `);
  db.prepare(`
    INSERT OR IGNORE INTO ${REQUEST_IDEMPOTENCY_MIGRATIONS_TABLE} (version, applied_at)
    VALUES (?, ?)
  `).run(REQUEST_IDEMPOTENCY_SCHEMA_VERSION, new Date().toISOString());
  return assertRequestIdempotencySchema(db);
}

function normalizeScope(scope) {
  const companyId = text(scope?.companyId);
  const tenantId = text(scope?.tenantId);
  if (!companyId || !tenantId || companyId !== tenantId) {
    throw idempotencyError(
      'ACTOR_SCOPE_INCOMPLETE',
      'Для идемпотентной операции требуется подтверждённый tenant scope.',
      403,
    );
  }
  return Object.freeze({ companyId, tenantId });
}

function normalizeOperation(value) {
  const operation = text(value);
  if (!operation || operation.length > 160 || !/^[A-Za-z0-9._:-]+$/.test(operation)) {
    throw idempotencyError('IDEMPOTENCY_OPERATION_INVALID', 'Некорректный тип идемпотентной операции.');
  }
  return operation;
}

function normalizeClientKey(value) {
  const key = text(value);
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    throw idempotencyError(
      'INVALID_IDEMPOTENCY_KEY',
      'Idempotency-Key должен содержать от 8 до 128 безопасных символов.',
      400,
    );
  }
  return key;
}

function normalizeFingerprint(value) {
  const fingerprint = text(value).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(fingerprint)) {
    throw idempotencyError('IDEMPOTENCY_FINGERPRINT_INVALID', 'Некорректный fingerprint идемпотентной операции.');
  }
  return fingerprint;
}

function normalizeExecutionInput(input) {
  const scope = normalizeScope(input?.scope);
  const operation = normalizeOperation(input?.operation);
  const clientKey = normalizeClientKey(input?.clientKey);
  const requestFingerprint = normalizeFingerprint(input?.requestFingerprint);
  const resultType = text(input?.resultType);
  const createdByUserId = text(input?.createdByUserId);
  if (!resultType || resultType.length > 120) {
    throw idempotencyError('IDEMPOTENCY_RESULT_TYPE_INVALID', 'Некорректный тип результата идемпотентной операции.');
  }
  if (!createdByUserId || createdByUserId.length > 160) {
    throw idempotencyError('IDEMPOTENCY_ACTOR_REQUIRED', 'Не определён автор идемпотентной операции.', 403);
  }
  return {
    tenantId: scope.tenantId,
    operation,
    clientKey,
    requestFingerprint,
    resultType,
    createdByUserId,
  };
}

function parseLegacyCollection(row, collection) {
  if (!row) return [];
  let value;
  try {
    value = JSON.parse(row.json);
  } catch {
    throw idempotencyError(
      'LEGACY_IDEMPOTENCY_STORAGE_INVALID',
      `Legacy-хранилище ${collection} повреждено; операция остановлена безопасно.`,
      503,
    );
  }
  if (!Array.isArray(value)) {
    throw idempotencyError(
      'LEGACY_IDEMPOTENCY_STORAGE_INVALID',
      `Legacy-хранилище ${collection} имеет неожиданный формат; операция остановлена безопасно.`,
      503,
    );
  }
  return value;
}

function findLegacyTombstone(db, clientKey) {
  if (!tableExists(db, 'app_data')) {
    throw idempotencyError(
      'LEGACY_IDEMPOTENCY_STORAGE_UNAVAILABLE',
      'Legacy-хранилище ключей идемпотентности недоступно; операция остановлена безопасно.',
      503,
    );
  }
  const read = db.prepare('SELECT json FROM app_data WHERE name = ?');
  for (const collection of LEGACY_IDEMPOTENCY_COLLECTIONS) {
    const records = parseLegacyCollection(read.get(collection), collection);
    const match = records.find(record => text(record?.key) === clientKey);
    if (match) return Object.freeze({ collection, key: clientKey });
  }
  return null;
}

function legacyReservedError(tombstone) {
  return idempotencyError(
    'LEGACY_IDEMPOTENCY_KEY_RESERVED',
    'Этот Idempotency-Key зарезервирован исторической операцией и не может быть повторно использован.',
    409,
    { legacyCollection: tombstone.collection },
  );
}

function changedRequestError() {
  return idempotencyError(
    'IDEMPOTENCY_KEY_REUSED',
    'Idempotency-Key уже использован с другим содержимым запроса.',
    409,
  );
}

function createRequestIdempotencyService({
  db,
  ensureSchema = true,
  nowIso = () => new Date().toISOString(),
} = {}) {
  assertDatabase(db);
  if (ensureSchema) ensureRequestIdempotencySchema(db);
  let schemaError = null;
  if (!ensureSchema) {
    try {
      assertRequestIdempotencySchema(db);
    } catch (error) {
      schemaError = error;
    }
  }

  const selectReceipt = schemaError ? null : db.prepare(`
    SELECT
      tenant_id AS tenantId,
      operation,
      client_key AS clientKey,
      request_fingerprint AS requestFingerprint,
      result_type AS resultType,
      result_id AS resultId,
      created_by_user_id AS createdByUserId,
      created_at AS createdAt
    FROM ${REQUEST_IDEMPOTENCY_TABLE}
    WHERE tenant_id = ? AND operation = ? AND client_key = ?
  `);
  const insertReceipt = schemaError ? null : db.prepare(`
    INSERT INTO ${REQUEST_IDEMPOTENCY_TABLE} (
      tenant_id,
      operation,
      client_key,
      request_fingerprint,
      result_type,
      result_id,
      created_by_user_id,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  function inspect(input) {
    if (schemaError) {
      throw idempotencyError(
        'IDEMPOTENCY_SERVICE_UNAVAILABLE',
        `Схема серверной идемпотентности недоступна: ${schemaError.code || schemaError.message}`,
        503,
      );
    }
    const normalized = normalizeExecutionInput(input);
    const tombstone = findLegacyTombstone(db, normalized.clientKey);
    if (tombstone) throw legacyReservedError(tombstone);
    const receipt = selectReceipt.get(normalized.tenantId, normalized.operation, normalized.clientKey);
    if (!receipt) return Object.freeze({ status: 'new' });
    if (
      receipt.requestFingerprint !== normalized.requestFingerprint
      || receipt.resultType !== normalized.resultType
    ) {
      throw changedRequestError();
    }
    return Object.freeze({ status: 'replayed', resultId: receipt.resultId });
  }

  const executeImmediate = db.transaction((normalized, createResult) => {
    const tombstone = findLegacyTombstone(db, normalized.clientKey);
    if (tombstone) throw legacyReservedError(tombstone);

    const existing = selectReceipt.get(normalized.tenantId, normalized.operation, normalized.clientKey);
    if (existing) {
      if (
        existing.requestFingerprint !== normalized.requestFingerprint
        || existing.resultType !== normalized.resultType
      ) {
        throw changedRequestError();
      }
      return Object.freeze({ status: 'replayed', resultId: existing.resultId });
    }

    const resultId = text(createResult());
    if (!resultId) {
      throw idempotencyError(
        'IDEMPOTENCY_RESULT_REQUIRED',
        'Идемпотентная операция не вернула стабильный идентификатор результата.',
      );
    }
    insertReceipt.run(
      normalized.tenantId,
      normalized.operation,
      normalized.clientKey,
      normalized.requestFingerprint,
      normalized.resultType,
      resultId,
      normalized.createdByUserId,
      text(nowIso()),
    );
    return Object.freeze({ status: 'created', resultId });
  });

  function execute(input, createResult) {
    if (schemaError) {
      throw idempotencyError(
        'IDEMPOTENCY_SERVICE_UNAVAILABLE',
        `Схема серверной идемпотентности недоступна: ${schemaError.code || schemaError.message}`,
        503,
      );
    }
    if (typeof createResult !== 'function') {
      throw idempotencyError('IDEMPOTENCY_CALLBACK_REQUIRED', 'Не задана операция сохранения результата.');
    }
    const normalized = normalizeExecutionInput(input);
    return executeImmediate.immediate(normalized, createResult);
  }

  return Object.freeze({ inspect, execute });
}

module.exports = {
  LEGACY_IDEMPOTENCY_COLLECTIONS,
  REQUEST_IDEMPOTENCY_MIGRATIONS_TABLE,
  REQUEST_IDEMPOTENCY_SCHEMA_VERSION,
  REQUEST_IDEMPOTENCY_TABLE,
  assertRequestIdempotencySchema,
  createRequestIdempotencyService,
  ensureRequestIdempotencySchema,
  idempotencyError,
};
