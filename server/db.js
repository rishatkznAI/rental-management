const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DATA_DIR = path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'app.sqlite');

const JSON_COLLECTIONS = [
  'equipment',
  'rentals',
  'gantt_rentals',
  'service',
  'clients',
  'documents',
  'payments',
  'users',
  'shipping_photos',
  'owners',
  'bot_users',
  'snapshot',
];

let dbInstance = null;

function ensureDb() {
  if (dbInstance) return dbInstance;

  fs.mkdirSync(DATA_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec(`
    CREATE TABLE IF NOT EXISTS app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
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

module.exports = {
  DB_PATH,
  getData,
  setData,
  migrateJsonFilesToDb,
};
