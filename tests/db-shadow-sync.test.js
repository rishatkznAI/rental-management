import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');

test('app_data gantt write survives shadow SQL sync failure', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rental-db-shadow-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const previousDbPath = process.env.DB_PATH;
  const previousConsoleError = console.error;
  const errors = [];
  process.env.DB_PATH = dbPath;
  console.error = (...args) => {
    errors.push(args.map(String).join(' '));
  };

  try {
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE app_data (
        name TEXT PRIMARY KEY,
        json TEXT NOT NULL,
        updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE gantt_rentals_sql (
        id TEXT PRIMARY KEY,
        rentalId TEXT,
        sourceRentalId TEXT,
        originalRentalId TEXT,
        equipmentId TEXT,
        clientId TEXT,
        managerId TEXT,
        ownerId TEXT,
        status TEXT,
        startDate TEXT,
        endDate TEXT,
        plannedReturnDate TEXT,
        objectId TEXT,
        contractId TEXT,
        searchText TEXT,
        rawJson TEXT NOT NULL
      );
      CREATE TRIGGER fail_gantt_shadow_insert
      BEFORE INSERT ON gantt_rentals_sql
      BEGIN
        SELECT RAISE(ABORT, 'shadow sync unavailable');
      END;
    `);
    db.close();

    const { getData, setData, ensureDb } = require('../server/db.js');
    setData('gantt_rentals', [{
      id: 'GR-shadow-fail',
      rentalId: 'R-shadow-fail',
      equipmentId: 'EQ-shadow-fail',
      startDate: '2026-05-01',
      endDate: '2026-05-02',
    }]);

    assert.deepEqual(getData('gantt_rentals').map(item => item.id), ['GR-shadow-fail']);
    assert.equal(ensureDb().prepare('SELECT COUNT(*) AS count FROM app_data WHERE name = ?').get('gantt_rentals').count, 1);
    assert.ok(errors.some(line => line.includes('[sql-shadow] failed to sync gantt_rentals')));
  } finally {
    console.error = previousConsoleError;
    if (previousDbPath === undefined) delete process.env.DB_PATH;
    else process.env.DB_PATH = previousDbPath;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
