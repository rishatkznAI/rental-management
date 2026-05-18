#!/usr/bin/env node

const path = require('path');

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
    '  node server/scripts/backfill-service-created-at.js [--dry-run] [--db /path/to/app.sqlite]',
    '  node server/scripts/backfill-service-created-at.js --apply [--db /path/to/app.sqlite]',
    '',
    'Default mode is dry-run and never writes to the database.',
    '--apply writes only service tickets missing createdAt and creates a SQLite backup first.',
  ].join('\n'));
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printUsage();
    return;
  }

  if (args.dbPath) {
    process.env.DB_PATH = path.resolve(args.dbPath);
  }

  const { DB_PATH, createSqliteBackup, getData, setData } = require('../db');
  const { backfillServiceTicketCreatedAt } = require('../lib/service-dto');

  const service = getData('service') || [];
  const result = backfillServiceTicketCreatedAt(service, {
    nowIso: () => new Date().toISOString(),
  });

  console.log(`Mode: ${args.apply ? 'apply' : 'dry-run'}`);
  console.log(`DB: ${DB_PATH}`);
  console.log(`Service tickets: ${result.stats.total}`);
  console.log(`Missing createdAt: ${result.stats.missingCreatedAt}`);
  console.log(`Changed: ${result.stats.changed}`);
  console.log(`Sources: createdDate=${result.stats.fromCreatedDate}, date=${result.stats.fromDate}, requestedAt=${result.stats.fromRequestedAt}, updatedAt=${result.stats.fromUpdatedAt}, approximate=${result.stats.fromNow}`);

  if (!args.apply) {
    console.log('Dry-run only: no database writes were performed.');
    return;
  }

  if (result.stats.changed === 0) {
    console.log('Apply requested: nothing to update.');
    return;
  }

  const backupPath = path.join(
    path.dirname(DB_PATH),
    'backups',
    `pre-service-created-at-backfill-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`,
  );
  await createSqliteBackup(backupPath);
  console.log(`Backup created: ${backupPath}`);

  setData('service', result.items);
  console.log(`Applied: changed=${result.stats.changed}`);
}

main().catch(error => {
  console.error(error?.message || String(error));
  process.exitCode = 1;
});
