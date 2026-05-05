const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  assertClientInnListUnique,
  assertClientInnWriteAllowed,
  buildClientInnDuplicateReport,
  getClientInnNormalized,
  normalizeClientInnFields,
} = require('./lib/client-inn');

const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DEFAULT_DATA_DIR, 'app.sqlite');
const DATA_DIR = path.dirname(DB_PATH);

const JSON_COLLECTIONS = [
  // IMPORTANT: app_data records are schemaless JSON and older rows may not have newly
  // introduced fields. Keep readers/writers backward compatible.
  'equipment',
  'rentals',
  'gantt_rentals',
  'rental_change_requests',
  'service',
  'warranty_claims',
  'clients',
  'knowledge_base_modules',
  'knowledge_base_progress',
  'app_settings',
  'gsm_packets',
  'gsm_commands',
  'documents',
  'mechanic_documents',
  'payments',
  'debt_collection_plans',
  'company_expenses',
  'crm_deals',
  'deliveries',
  'delivery_carriers',
  'users',
  'shipping_photos',
  'equipment_operation_sessions',
  'owners',
  'mechanics',
  'service_works',
  'spare_parts',
  'service_route_norms',
  'service_field_trips',
  'repair_work_items',
  'repair_part_items',
  'service_audit_log',
  'service_work_catalog',
  'spare_parts_catalog',
  'planner_items',
  'service_vehicles',
  'vehicle_trips',
  'bot_users',
  'bot_sessions',
  'bot_activity',
  'bot_notifications',
  'audit_log',
  'audit_logs',
  'snapshot',
];

let dbInstance = null;

function ensureDb() {
  if (dbInstance) return dbInstance;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new Database(DB_PATH);
  db.pragma('journal_mode = WAL');
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
  } catch {
    return null;
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
    replace.run(innNormalized, String(client.id || ''), client.company || client.name || '');
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
  const db = ensureDb();
  const previousValue = name === 'clients' ? getData('clients') : null;
  const nextValue = name === 'clients' && Array.isArray(value)
    ? value.map(normalizeClientInnFields)
    : value;
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
  });
  tx();
}

function migrateJsonFilesToDb() {
  const db = ensureDb();
  const hasRows = db.prepare('SELECT COUNT(*) AS count FROM app_data').get().count > 0;
  if (hasRows) return;

  for (const collection of JSON_COLLECTIONS) {
    const legacy = readLegacyJson(collection);
    if (legacy !== null) {
      setData(collection, legacy);
    }
  }
}

function cloneCollectionIfMissing(targetName, sourceName, mapItem = value => value) {
  const target = getData(targetName);
  if (Array.isArray(target) && target.length > 0) return;

  const source = getData(sourceName);
  if (!Array.isArray(source) || source.length === 0) return;

  setData(targetName, source.map(mapItem));
}

function saveSession(token, value, expiresAt) {
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
    deleteSession(token);
    return null;
  }
  try {
    return JSON.parse(row.json);
  } catch {
    deleteSession(token);
    return null;
  }
}

function deleteSession(token) {
  const db = ensureDb();
  db.prepare('DELETE FROM app_sessions WHERE token = ?').run(token);
}

function deleteSessionsForUserIds(userIds) {
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
  const db = ensureDb();
  db.prepare('DELETE FROM app_sessions WHERE expires_at <= ?').run(now);
}

function resetAppData(collections = JSON_COLLECTIONS) {
  const db = ensureDb();
  const names = Array.isArray(collections) && collections.length > 0
    ? [...new Set(collections.map(name => String(name || '').trim()).filter(Boolean))]
    : JSON_COLLECTIONS;
  const deleteData = db.prepare('DELETE FROM app_data WHERE name = ?');
  const tx = db.transaction((collectionNames) => {
    for (const name of collectionNames) deleteData.run(name);
    db.prepare('DELETE FROM app_sessions').run();
    if (collectionNames.includes('clients')) {
      db.prepare('DELETE FROM client_inn_index').run();
    }
  });
  tx(names);
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
  DB_PATH,
  cloneCollectionIfMissing,
  countActiveSessions,
  createSqliteBackup,
  cleanupExpiredSessions,
  deleteSession,
  deleteSessionsForUserIds,
  getData,
  getSession,
  JSON_COLLECTIONS,
  setData,
  migrateJsonFilesToDb,
  resetAppData,
  saveSession,
  syncClientInnIndex,
};
