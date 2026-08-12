#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  repairDeliveryCounterpartyRelations,
} = require('../lib/delivery-counterparty-relations');

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
    '  node server/scripts/delivery-counterparty-relations.js [--dry-run] [--db /path/to/app.sqlite]',
    '  node server/scripts/delivery-counterparty-relations.js --apply [--db /path/to/app.sqlite]',
    '',
    'Default mode is a machine-readable dry-run and performs no writes.',
    '--apply creates a SQLite backup and atomically writes deterministic relation-field repairs only.',
    'Allowed chains are stable IDs such as Delivery.clientId -> Client.counterpartyId,',
    'Delivery.rentalId -> Rental.counterpartyId, and Delivery.carrierId -> DeliveryCarrier.counterpartyId.',
    'No mapping by name, INN, phone, address, or other display metadata is performed.',
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
    for (const entry of entries || []) writeStatement.run(entry.name, JSON.stringify(entry.value));
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
    const preview = repairDeliveryCounterpartyRelations({
      readData: storage.readData,
      dryRun: true,
    });
    const blocked = (preview.audit?.summary?.classifications?.conflicting || 0)
      + (preview.audit?.summary?.classifications?.unresolved || 0) > 0;
    if (args.apply && blocked) {
      repairDeliveryCounterpartyRelations({ readData: storage.readData, dryRun: false });
    }
    if (!args.apply || !preview.changed) {
      console.log(JSON.stringify({ mode: args.apply ? 'apply' : 'dry-run', dbPath, ...preview }, null, 2));
      return;
    }
    const backupPath = path.join(
      path.dirname(dbPath),
      'backups',
      `pre-delivery-counterparty-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    await db.backup(backupPath);
    const result = repairDeliveryCounterpartyRelations({
      readData: storage.readData,
      writeDataBatch: storage.writeDataBatch,
      dryRun: false,
    });
    console.log(JSON.stringify({ mode: 'apply', dbPath, backupPath, ...result }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  main().catch(error => {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || 'DELIVERY_COUNTERPARTY_MIGRATION_FAILED',
      error: error?.message || String(error),
      details: error?.details,
    }, null, 2));
    process.exitCode = 1;
  });
}

module.exports = { createStorage, parseArgs };
