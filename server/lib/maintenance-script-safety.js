const fs = require('fs');
const path = require('path');

const AUDITED_MAINTENANCE_RUNNER_REQUIRED = 'AUDITED_MAINTENANCE_RUNNER_REQUIRED';

function safetyError(code, message, details) {
  const error = new Error(message);
  error.code = code;
  if (details !== undefined) error.details = details;
  return error;
}

function requiredText(value, field) {
  const text = String(value ?? '').trim();
  if (!text) throw safetyError('MAINTENANCE_ARGUMENT_REQUIRED', `${field} is required.`);
  if (/\0|[\r\n]/.test(text)) {
    throw safetyError('MAINTENANCE_ARGUMENT_INVALID', `${field} contains forbidden control characters.`);
  }
  return text;
}

function resolveExplicitDatabasePath(value, { cwd = process.cwd() } = {}) {
  const input = requiredText(value, '--db');
  const resolved = path.resolve(cwd, input);
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw safetyError('MAINTENANCE_DATABASE_NOT_FOUND', `SQLite database not found: ${resolved}`);
    }
    throw error;
  }
  if (!stat.isFile()) {
    throw safetyError('MAINTENANCE_DATABASE_INVALID', `Database path is not a file: ${resolved}`);
  }
  return resolved;
}

function assertAuditedMaintenanceApplyUnavailable(apply, operation = 'maintenance mutation') {
  if (!apply) return true;
  throw safetyError(
    AUDITED_MAINTENANCE_RUNNER_REQUIRED,
    `Refused ${operation}: raw offline apply is disabled. Use an authorized, tenant-scoped, CAS-protected maintenance runner with an atomic audit journal and verified backup.`,
  );
}

function parseAppDataValue(row, name, { expected = 'array', missing = [] } = {}) {
  if (!row) return structuredClone(missing);
  let value;
  try {
    value = JSON.parse(row.json);
  } catch (cause) {
    throw safetyError(
      'MAINTENANCE_COLLECTION_INVALID_JSON',
      `Collection ${name} contains invalid JSON.`,
      { collection: name, cause: cause.message },
    );
  }
  if (expected === 'array' && !Array.isArray(value)) {
    throw safetyError(
      'MAINTENANCE_COLLECTION_SHAPE_INVALID',
      `Collection ${name} must contain an array.`,
      { collection: name, actualType: value === null ? 'null' : typeof value },
    );
  }
  if (expected === 'object' && (!value || Array.isArray(value) || typeof value !== 'object')) {
    throw safetyError(
      'MAINTENANCE_COLLECTION_SHAPE_INVALID',
      `Collection ${name} must contain an object.`,
      { collection: name, actualType: value === null ? 'null' : typeof value },
    );
  }
  return value;
}

function createStrictReadOnlyStorage(db, { allowCollections = null } = {}) {
  const allowlist = allowCollections ? new Set(allowCollections) : null;
  const read = db.prepare('SELECT json FROM app_data WHERE name = ?');
  return Object.freeze({
    readData(name) {
      if (allowlist && !allowlist.has(name)) {
        throw safetyError(
          'MAINTENANCE_COLLECTION_DENIED',
          `Collection is not allowlisted for this diagnostic: ${name}`,
        );
      }
      return parseAppDataValue(read.get(name), name, { expected: 'array', missing: [] });
    },
  });
}

const DISPOSABLE_MARKERS = Object.freeze({
  demo: Object.freeze({ env: 'DEMO_DATABASE_DISPOSABLE', value: 'true', path: /demo/i }),
  e2e: Object.freeze({ env: 'E2E_DATABASE_DISPOSABLE', value: '1', path: /(?:^|[-_.\/])e2e(?:[-_.\/]|$)/i }),
  staging: Object.freeze({ env: 'STAGING_FIXTURE_DATABASE_DISPOSABLE', value: 'true', path: /(?:stag(?:e|ing)|fixture)/i }),
});

function assertDisposableFixtureDatabase({ dbPath, env = process.env, kind }) {
  const contract = DISPOSABLE_MARKERS[kind];
  if (!contract) throw safetyError('FIXTURE_DATABASE_KIND_INVALID', `Unknown fixture database kind: ${kind}`);
  const explicit = requiredText(dbPath, 'DB_PATH');
  const resolved = path.resolve(explicit);
  const productionDefault = path.resolve(__dirname, '..', 'data', 'app.sqlite');
  if (resolved === productionDefault || path.basename(resolved).toLowerCase() === 'app.sqlite') {
    throw safetyError(
      'FIXTURE_DATABASE_TARGET_DENIED',
      'Fixture seeds refuse app.sqlite and the production default database path.',
    );
  }
  if (!contract.path.test(resolved)) {
    throw safetyError(
      'FIXTURE_DATABASE_TARGET_DENIED',
      `Fixture DB_PATH must be clearly named for ${kind}.`,
    );
  }
  if (String(env[contract.env] || '').trim().toLowerCase() !== contract.value) {
    throw safetyError(
      'FIXTURE_DATABASE_DISPOSABLE_CONFIRMATION_REQUIRED',
      `Refused: set ${contract.env}=${contract.value} for a disposable ${kind} database.`,
    );
  }
  return resolved;
}

module.exports = {
  AUDITED_MAINTENANCE_RUNNER_REQUIRED,
  assertAuditedMaintenanceApplyUnavailable,
  assertDisposableFixtureDatabase,
  createStrictReadOnlyStorage,
  parseAppDataValue,
  requiredText,
  resolveExplicitDatabasePath,
  safetyError,
};
