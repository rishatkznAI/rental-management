const NUMBER_SEQUENCE_SCHEMA_VERSION = 1;

const NUMBER_SEQUENCE_ENTITY_CONFIG = Object.freeze({
  RENTAL: Object.freeze({ prefix: 'RNT' }),
  SERVICE_TICKET: Object.freeze({ prefix: 'SRV' }),
  DELIVERY: Object.freeze({ prefix: 'DLV' }),
  WARRANTY_CLAIM: Object.freeze({ prefix: 'WCL' }),
  CLIENT_CONTRACT: Object.freeze({ prefix: 'CTR' }),
  RENTAL_SPECIFICATION: Object.freeze({ prefix: 'SP' }),
  TRANSFER_ACT_TO_CLIENT: Object.freeze({ prefix: 'AP' }),
  RETURN_ACT_FROM_CLIENT: Object.freeze({ prefix: 'AR' }),
  WORK_ORDER: Object.freeze({ prefix: 'ZN' }),
  VEHICLE_TRIP: Object.freeze({ prefix: 'PL' }),
  INVOICE: Object.freeze({ prefix: 'INV' }),
});

const DEFAULT_NUMBERING_SCOPE = Object.freeze({
  scopeType: 'company',
  scopeId: 'SKYTECH',
});

function text(value) {
  return String(value ?? '').trim();
}

function numberingError(code, message, status = 500, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function normalizeScopePart(value, field) {
  const normalized = text(value);
  if (!normalized || normalized.length > 120 || !/^[A-Za-z0-9_.:-]+$/.test(normalized)) {
    throw numberingError(
      'NUMBERING_SCOPE_INVALID',
      `Некорректное серверное значение ${field} для нумерации.`,
      500,
      { field },
    );
  }
  return normalized;
}

function resolveServerNumberingScope(env = process.env) {
  return Object.freeze({
    scopeType: normalizeScopePart(
      env.NUMBERING_SCOPE_TYPE || DEFAULT_NUMBERING_SCOPE.scopeType,
      'scopeType',
    ),
    scopeId: normalizeScopePart(
      env.NUMBERING_SCOPE_ID || env.RENTCORE_INSTANCE_ID || DEFAULT_NUMBERING_SCOPE.scopeId,
      'scopeId',
    ),
  });
}

function normalizeEntityType(value) {
  const entityType = text(value).toUpperCase();
  if (!NUMBER_SEQUENCE_ENTITY_CONFIG[entityType]) {
    throw numberingError(
      'NUMBERING_ENTITY_TYPE_UNSUPPORTED',
      `Тип сущности ${entityType || '(empty)'} не поддерживает автоматическую нумерацию.`,
      500,
      { entityType },
    );
  }
  return entityType;
}

function normalizeSequenceYear(value) {
  const year = Number(value);
  if (!Number.isInteger(year) || year < 2000 || year > 9999) {
    throw numberingError('NUMBERING_YEAR_INVALID', 'Некорректный год последовательности.', 400, { year: value });
  }
  return year;
}

function yearFromIso(value) {
  const raw = text(value);
  const match = raw.match(/^(\d{4})-/);
  if (!match) {
    throw numberingError('NUMBERING_DATE_INVALID', 'Не удалось определить год последовательности.', 400);
  }
  return normalizeSequenceYear(match[1]);
}

function formatBusinessNumber(entityType, year, sequenceValue) {
  const normalizedType = normalizeEntityType(entityType);
  const normalizedYear = normalizeSequenceYear(year);
  const sequence = Number(sequenceValue);
  if (!Number.isInteger(sequence) || sequence < 1 || sequence > 999999) {
    throw numberingError(
      'NUMBERING_SEQUENCE_EXHAUSTED',
      'Последовательность вышла за пределы шестизначного формата.',
      409,
      { entityType: normalizedType, year: normalizedYear, sequenceValue },
    );
  }
  const prefix = NUMBER_SEQUENCE_ENTITY_CONFIG[normalizedType].prefix;
  return `${prefix}-${String(normalizedYear).slice(-2)}-${String(sequence).padStart(6, '0')}`;
}

function ensureNumberSequenceSchema(db) {
  if (!db || typeof db.exec !== 'function' || typeof db.transaction !== 'function') {
    throw numberingError('NUMBERING_DATABASE_REQUIRED', 'Для нумерации требуется SQLite database handle.');
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS number_sequence_schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS number_sequences (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      year INTEGER NOT NULL,
      last_value INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id, entity_type, year),
      CHECK (length(trim(scope_type)) > 0),
      CHECK (length(trim(scope_id)) > 0),
      CHECK (length(trim(entity_type)) > 0),
      CHECK (typeof(year) = 'integer' AND year >= 2000 AND year <= 9999),
      CHECK (typeof(last_value) = 'integer' AND last_value >= 1 AND last_value <= 999999)
    );

    CREATE TABLE IF NOT EXISTS business_numbers (
      scope_type TEXT NOT NULL,
      scope_id TEXT NOT NULL,
      entity_type TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      year INTEGER NOT NULL,
      sequence_value INTEGER NOT NULL,
      number TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (scope_type, scope_id, entity_type, entity_id),
      UNIQUE (scope_type, scope_id, entity_type, year, sequence_value),
      UNIQUE (scope_type, scope_id, entity_type, number),
      FOREIGN KEY (scope_type, scope_id, entity_type, year)
        REFERENCES number_sequences(scope_type, scope_id, entity_type, year)
        ON UPDATE RESTRICT ON DELETE RESTRICT,
      CHECK (length(trim(entity_id)) > 0),
      CHECK (length(trim(number)) > 0),
      CHECK (typeof(sequence_value) = 'integer' AND sequence_value >= 1 AND sequence_value <= 999999)
    );

    CREATE INDEX IF NOT EXISTS idx_business_numbers_lookup
      ON business_numbers(scope_type, scope_id, number);
  `);

  const existing = db.prepare(`
    SELECT version FROM number_sequence_schema_migrations WHERE version = ?
  `).get(NUMBER_SEQUENCE_SCHEMA_VERSION);
  if (!existing) {
    db.prepare(`
      INSERT INTO number_sequence_schema_migrations (version, applied_at)
      VALUES (?, ?)
    `).run(NUMBER_SEQUENCE_SCHEMA_VERSION, new Date().toISOString());
  }
  return true;
}

function createNumberSequenceAllocator({
  db,
  scope = resolveServerNumberingScope(),
  nowIso = () => new Date().toISOString(),
} = {}) {
  ensureNumberSequenceSchema(db);
  if (typeof db.pragma === 'function') db.pragma('busy_timeout = 10000');

  const trustedScope = Object.freeze({
    scopeType: normalizeScopePart(scope.scopeType, 'scopeType'),
    scopeId: normalizeScopePart(scope.scopeId, 'scopeId'),
  });
  const findByEntity = db.prepare(`
    SELECT scope_type, scope_id, entity_type, entity_id, year, sequence_value, number, created_at
    FROM business_numbers
    WHERE scope_type = @scopeType
      AND scope_id = @scopeId
      AND entity_type = @entityType
      AND entity_id = @entityId
  `);
  const incrementSequence = db.prepare(`
    INSERT INTO number_sequences (
      scope_type, scope_id, entity_type, year, last_value, created_at, updated_at
    ) VALUES (
      @scopeType, @scopeId, @entityType, @year, 1, @now, @now
    )
    ON CONFLICT(scope_type, scope_id, entity_type, year) DO UPDATE SET
      last_value = number_sequences.last_value + 1,
      updated_at = excluded.updated_at
    RETURNING last_value
  `);
  const insertBusinessNumber = db.prepare(`
    INSERT INTO business_numbers (
      scope_type, scope_id, entity_type, entity_id, year, sequence_value, number, created_at
    ) VALUES (
      @scopeType, @scopeId, @entityType, @entityId, @year, @sequenceValue, @number, @now
    )
  `);

  const allocateTransaction = db.transaction(({ entityType, entityId, year, now }) => {
    const params = {
      ...trustedScope,
      entityType,
      entityId,
      year,
      now,
    };
    const existing = findByEntity.get(params);
    if (existing) return existing;

    const row = incrementSequence.get(params);
    const sequenceValue = Number(row?.last_value);
    const number = formatBusinessNumber(entityType, year, sequenceValue);
    insertBusinessNumber.run({
      ...params,
      sequenceValue,
      number,
    });
    return {
      scope_type: trustedScope.scopeType,
      scope_id: trustedScope.scopeId,
      entity_type: entityType,
      entity_id: entityId,
      year,
      sequence_value: sequenceValue,
      number,
      created_at: now,
    };
  });

  function allocate({ entityType, entityId, year } = {}) {
    const normalizedType = normalizeEntityType(entityType);
    const normalizedId = text(entityId);
    if (!normalizedId) {
      throw numberingError('NUMBERING_ENTITY_ID_REQUIRED', 'Для присвоения номера нужен canonical entity id.', 500);
    }
    const now = nowIso();
    const normalizedYear = year === undefined || year === null
      ? yearFromIso(now)
      : normalizeSequenceYear(year);
    const row = allocateTransaction.immediate({
      entityType: normalizedType,
      entityId: normalizedId,
      year: normalizedYear,
      now,
    });
    return {
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      year: Number(row.year),
      sequenceValue: Number(row.sequence_value),
      number: row.number,
      createdAt: row.created_at,
    };
  }

  function find(entityType, entityId) {
    const row = findByEntity.get({
      ...trustedScope,
      entityType: normalizeEntityType(entityType),
      entityId: text(entityId),
    });
    return row ? {
      scopeType: row.scope_type,
      scopeId: row.scope_id,
      entityType: row.entity_type,
      entityId: row.entity_id,
      year: Number(row.year),
      sequenceValue: Number(row.sequence_value),
      number: row.number,
      createdAt: row.created_at,
    } : null;
  }

  return Object.freeze({
    allocate,
    find,
    scope: trustedScope,
  });
}

module.exports = {
  DEFAULT_NUMBERING_SCOPE,
  NUMBER_SEQUENCE_ENTITY_CONFIG,
  NUMBER_SEQUENCE_SCHEMA_VERSION,
  createNumberSequenceAllocator,
  ensureNumberSequenceSchema,
  formatBusinessNumber,
  normalizeSequenceYear,
  resolveServerNumberingScope,
  yearFromIso,
};
