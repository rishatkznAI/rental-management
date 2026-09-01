#!/usr/bin/env node

const Database = require('better-sqlite3');
const {
  assertAuditedMaintenanceApplyUnavailable,
  parseAppDataValue,
  resolveExplicitDatabasePath,
} = require('../lib/maintenance-script-safety');

function parseArgs(argv) {
  const args = {
    apply: false,
    dbPath: '',
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--apply') {
      args.apply = true;
    } else if (arg === '--dry-run') {
      args.apply = false;
    } else if (arg === '--db') {
      args.dbPath = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return args;
}

function printUsage() {
  console.log([
    'Usage:',
    '  node server/scripts/backfill-service-created-at.js --dry-run --db /explicit/path/to/app.sqlite',
    '',
    'Default mode is dry-run and never writes to the database.',
    'Raw --apply is disabled; use an audited tenant-scoped maintenance runner.',
  ].join('\n'));
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  const dbPath = resolveExplicitDatabasePath(args.dbPath);
  assertAuditedMaintenanceApplyUnavailable(args.apply, 'service createdAt backfill');
  const { backfillServiceTicketCreatedAt } = require('../lib/service-dto');
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  let service;
  try {
    const row = db.prepare('SELECT json FROM app_data WHERE name = ?').get('service');
    service = parseAppDataValue(row, 'service', { expected: 'array', missing: [] });
  } finally {
    db.close();
  }
  const result = backfillServiceTicketCreatedAt(service, {
    nowIso: () => new Date().toISOString(),
  });

  console.log(`Mode: ${args.apply ? 'apply' : 'dry-run'}`);
  console.log(`DB: ${dbPath}`);
  console.log(`Service tickets: ${result.stats.total}`);
  console.log(`Missing createdAt: ${result.stats.missingCreatedAt}`);
  console.log(`Changed: ${result.stats.changed}`);
  console.log(`Sources: createdDate=${result.stats.fromCreatedDate}, date=${result.stats.fromDate}, requestedAt=${result.stats.fromRequestedAt}, updatedAt=${result.stats.fromUpdatedAt}, approximate=${result.stats.fromNow}`);

  console.log('Dry-run only: no database writes were performed.');
}

try {
  main();
} catch (error) {
  console.error(error?.message || String(error));
  process.exitCode = 1;
}
