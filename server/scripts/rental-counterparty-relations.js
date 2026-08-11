#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  repairRentalCounterpartyRelations,
} = require('../lib/rental-counterparty-relations');

function parseArgs(argv) {
  const result = { apply: false, dbPath: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') result.apply = true;
    else if (argument === '--dry-run') result.apply = false;
    else if (argument === '--db') {
      result.dbPath = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--help' || argument === '-h') result.help = true;
    else throw new Error(`Unknown argument: ${argument}`);
  }
  return result;
}

function printUsage() {
  console.log([
    'Usage:',
    '  node server/scripts/rental-counterparty-relations.js [--dry-run] [--db /path/to/app.sqlite]',
    '  node server/scripts/rental-counterparty-relations.js --apply [--db /path/to/app.sqlite]',
    '',
    'Default mode is dry-run and performs no writes.',
    '--apply creates a SQLite backup, then fills only deterministic Rental.counterpartyId links.',
    'Only Rental.clientId -> unique Client -> unique customer Counterparty is eligible.',
    'Names, INN and other metadata are never used. No Client or Counterparty is created.',
    'Run --apply only during a maintenance window with application writes stopped.',
  ].join('\n'));
}

function createStorage(db) {
  const readStatement = db.prepare('SELECT json FROM app_data WHERE name = ?');
  const writeStatement = db.prepare(`
    INSERT INTO app_data (name, json, updated_at)
    VALUES (?, ?, CURRENT_TIMESTAMP)
    ON CONFLICT(name) DO UPDATE SET
      json = excluded.json,
      updated_at = CURRENT_TIMESTAMP
  `);
  const writeBatch = db.transaction(entries => {
    for (const entry of entries || []) {
      writeStatement.run(entry.name, JSON.stringify(entry.value));
    }
  });
  return {
    readData(name) {
      const row = readStatement.get(name);
      return row ? JSON.parse(row.json) : [];
    },
    writeDataBatch(entries) {
      writeBatch(entries);
    },
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const dbPath = path.resolve(args.dbPath || path.join(__dirname, '..', 'data', 'app.sqlite'));
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);

  const db = new Database(dbPath, { readonly: !args.apply, fileMustExist: true });
  try {
    const storage = createStorage(db);
    const preview = repairRentalCounterpartyRelations({
      readData: storage.readData,
      dryRun: true,
    });
    console.log(`Mode: ${args.apply ? 'apply' : 'dry-run'}`);
    console.log(`DB: ${dbPath}`);

    if (!args.apply || preview.changed.length === 0) {
      console.log(JSON.stringify(preview, null, 2));
      console.log(args.apply
        ? 'Apply requested: nothing deterministic to update.'
        : 'Dry-run only: no relation writes were performed.');
      return;
    }

    console.log('Apply safety: application writes must remain stopped for this maintenance run.');
    const backupPath = path.join(
      path.dirname(dbPath),
      'backups',
      `pre-rental-counterparty-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    await db.backup(backupPath);
    console.log(`Backup created: ${backupPath}`);

    const result = repairRentalCounterpartyRelations({
      readData: storage.readData,
      writeDataBatch: storage.writeDataBatch,
      dryRun: false,
    });
    console.log(JSON.stringify(result, null, 2));
    if (result.failed.length > 0) process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
