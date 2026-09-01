#!/usr/bin/env node

const Database = require('better-sqlite3');
const {
  repairDocumentContractCounterpartyRelations,
} = require('../lib/document-counterparty-relations');
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
    '  node server/scripts/document-contract-counterparty-integrity.js [--dry-run] [--db /path/to/app.sqlite]',
    '  node server/scripts/document-contract-counterparty-integrity.js --apply [--db /path/to/app.sqlite]',
    '',
    'Default mode is a machine-readable dry-run and performs no writes.',
    'Raw --apply is disabled; use an audited tenant-scoped maintenance runner.',
    'No mapping by name, INN, phone, email, address, or other display metadata is performed.',
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
  assertAuditedMaintenanceApplyUnavailable(args.apply, 'document/contract counterparty relation repair');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const storage = createStorage(db);
    const preview = repairDocumentContractCounterpartyRelations({
      readData: storage.readData,
      dryRun: true,
    });
    console.log(JSON.stringify({ mode: 'dry-run', dbPath, ...preview }, null, 2));
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      code: error?.code || 'DOCUMENT_CONTRACT_COUNTERPARTY_MIGRATION_FAILED',
      error: error?.message || String(error),
      details: error?.details,
    }, null, 2));
    process.exitCode = 1;
  }
}

module.exports = { createStorage, parseArgs };
