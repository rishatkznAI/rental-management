const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const DEFAULT_DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = process.env.DB_PATH
  ? path.resolve(process.env.DB_PATH)
  : path.join(DEFAULT_DATA_DIR, 'app.sqlite');
const DATA_DIR = path.dirname(DB_PATH);

const JSON_COLLECTIONS = [
  'equipment',
  'rentals',
  'gantt_rentals',
  'service',
  'clients',
  'knowledge_base_modules',
  'knowledge_base_progress',
  'documents',
  'mechanic_documents',
  'payments',
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
  'service_work_catalog',
  'spare_parts_catalog',
  'bot_users',
  'bot_sessions',
  'bot_activity',
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
  `);
  dbInstance = db;
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

function setData(name, value) {
  const db = ensureDb();
  db.prepare(`
    INSERT INTO app_data (name, json)
    VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET
      json = excluded.json,
      updated_at = CURRENT_TIMESTAMP
  `).run(name, JSON.stringify(value));
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

function cleanupExpiredSessions(now = Date.now()) {
  const db = ensureDb();
  db.prepare('DELETE FROM app_sessions WHERE expires_at <= ?').run(now);
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
  cleanupExpiredSessions,
  deleteSession,
  getData,
  getSession,
  setData,
  migrateJsonFilesToDb,
  saveSession,
};
