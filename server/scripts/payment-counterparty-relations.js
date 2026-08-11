#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  repairPaymentCounterpartyRelations,
} = require('../lib/payment-counterparty-relations');

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
    '  node server/scripts/payment-counterparty-relations.js [--dry-run] [--db /path/to/app.sqlite]',
    '  node server/scripts/payment-counterparty-relations.js --apply [--db /path/to/app.sqlite]',
    '',
    'Default mode is dry-run and performs no writes.',
    '--apply creates a SQLite backup, then fills only deterministic Payment.counterpartyId links.',
    'Only Payment.clientId -> unique Client -> Client.counterpartyId -> unique Counterparty is eligible.',
    'Names, INN, phone, addresses and other metadata are never used.',
    'No Client or Counterparty is created and no Counterparty role is changed.',
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
  let backupPath = null;
  try {
    const storage = createStorage(db);
    const preview = repairPaymentCounterpartyRelations({
      readData: storage.readData,
      dryRun: true,
    });

    if (!args.apply || preview.changed.length === 0) {
      console.log(JSON.stringify({
        mode: args.apply ? 'apply' : 'dry-run',
        dbPath,
        backupPath,
        wrote: false,
        result: preview,
      }, null, 2));
      return;
    }

    backupPath = path.join(
      path.dirname(dbPath),
      'backups',
      `pre-payment-counterparty-repair-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
    );
    fs.mkdirSync(path.dirname(backupPath), { recursive: true });
    await db.backup(backupPath);

    const result = repairPaymentCounterpartyRelations({
      readData: storage.readData,
      writeDataBatch: storage.writeDataBatch,
      dryRun: false,
    });
    console.log(JSON.stringify({
      mode: 'apply',
      dbPath,
      backupPath,
      wrote: result.changed.length > 0,
      result,
    }, null, 2));
    if (result.failed.length > 0) process.exitCode = 1;
  } finally {
    db.close();
  }
}

main().catch(error => {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code || 'PAYMENT_COUNTERPARTY_MIGRATION_FAILED',
    error: error?.message || String(error),
  }));
  process.exitCode = 1;
});
