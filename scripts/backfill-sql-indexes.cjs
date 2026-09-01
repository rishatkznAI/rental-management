#!/usr/bin/env node

const {
  assertAuditedMaintenanceApplyUnavailable,
} = require('../server/lib/maintenance-script-safety.js');

function parseArgs(argv) {
  const args = { db: '', json: false, apply: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') args.db = argv[++index] || '';
    else if (arg === '--json') args.json = true;
    else if (arg === '--apply') args.apply = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/backfill-sql-indexes.cjs --apply --db /explicit/path/to/app.sqlite',
    '',
    'Raw offline apply is disabled. Use the audited maintenance runner.',
  ].join('\n');
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}

try {
  if (!args.db) throw new Error('Refusing maintenance without an explicit --db path.');
  assertAuditedMaintenanceApplyUnavailable(args.apply, 'SQL shadow-index backfill');
  throw Object.assign(new Error('Specify --apply to request a backfill; dry-run is provided by diagnose-sql-index-consistency.cjs.'), {
    code: 'MAINTENANCE_APPLY_FLAG_REQUIRED',
  });
} catch (error) {
  console.error(`${error.code || 'SQL_SHADOW_BACKFILL_BLOCKED'}: ${error.message}`);
  process.exitCode = 2;
}
