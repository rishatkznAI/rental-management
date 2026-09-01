#!/usr/bin/env node

const Database = require('better-sqlite3');
const {
  repairCounterpartyRelations,
} = require('../lib/counterparty-relations');
const {
  assertAuditedMaintenanceApplyUnavailable,
  createStrictReadOnlyStorage,
  resolveExplicitDatabasePath,
} = require('../lib/maintenance-script-safety');

function parseArgs(argv) {
  const result = { apply: false, dbPath: '' };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--apply') {
      result.apply = true;
    } else if (argument === '--dry-run') {
      result.apply = false;
    } else if (argument === '--db') {
      result.dbPath = argv[index + 1] || '';
      index += 1;
    } else if (argument === '--help' || argument === '-h') {
      result.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return result;
}

function printUsage() {
  console.log([
    'Usage:',
    '  node server/scripts/counterparty-relation-integrity.js [--dry-run] [--db /path/to/app.sqlite]',
    '  node server/scripts/counterparty-relation-integrity.js --apply [--db /path/to/app.sqlite]',
    '',
    'Default mode is dry-run and performs no relation writes.',
    'Raw --apply is disabled; use an audited tenant-scoped maintenance runner.',
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
  assertAuditedMaintenanceApplyUnavailable(args.apply, 'counterparty relation repair');

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const storage = createStorage(db);
    const preview = repairCounterpartyRelations({
      readData: storage.readData,
      dryRun: true,
    });

    console.log(`Mode: ${args.apply ? 'apply' : 'dry-run'}`);
    console.log(`DB: ${dbPath}`);
    console.log(JSON.stringify(preview, null, 2));
    console.log('Dry-run only: no relation writes were performed.');
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  console.error(error?.message || String(error));
  process.exitCode = 1;
}
