#!/usr/bin/env node

const Database = require('better-sqlite3');
const {
  repairPaymentCounterpartyRelations,
} = require('../lib/payment-counterparty-relations');
const {
  assertAuditedMaintenanceApplyUnavailable,
  createStrictReadOnlyStorage,
  resolveExplicitDatabasePath,
} = require('../lib/maintenance-script-safety');

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
    'Raw --apply is disabled; use an audited tenant-scoped maintenance runner.',
    'Only Payment.clientId -> unique Client -> Client.counterpartyId -> unique Counterparty is eligible.',
    'Names, INN, phone, addresses and other metadata are never used.',
    'No Client or Counterparty is created and no Counterparty role is changed.',
  ].join('\n'));
}

function createStorage(db) {
  return createStrictReadOnlyStorage(db);
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const dbPath = resolveExplicitDatabasePath(args.dbPath);
  assertAuditedMaintenanceApplyUnavailable(args.apply, 'payment counterparty relation repair');

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const storage = createStorage(db);
    const preview = repairPaymentCounterpartyRelations({
      readData: storage.readData,
      dryRun: true,
    });

    console.log(JSON.stringify({
      mode: 'dry-run',
      dbPath,
      backupPath: null,
      wrote: false,
      result: preview,
    }, null, 2));
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    code: error?.code || 'PAYMENT_COUNTERPARTY_MIGRATION_FAILED',
    error: error?.message || String(error),
  }));
  process.exitCode = 1;
}
