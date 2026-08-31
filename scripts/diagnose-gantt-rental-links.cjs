#!/usr/bin/env node

const path = require('path');
const { createRequire } = require('module');
const {
  analyzeGanttRentalLinks,
  backfillGanttRentalLinks,
} = require('../server/lib/rental-change-requests.js');
const {
  assertAuditedMaintenanceApplyUnavailable,
  createStrictReadOnlyStorage,
  resolveExplicitDatabasePath,
} = require('../server/lib/maintenance-script-safety.js');

const rootDir = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(rootDir, 'server', 'package.json'));
const Database = serverRequire('better-sqlite3');

function parseArgs(argv) {
  const args = { db: '', id: '', limit: 50, json: false, backfill: false, dryRun: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') args.db = argv[++index] || '';
    else if (arg === '--id') args.id = argv[++index] || '';
    else if (arg === '--limit') {
      const limit = Number(argv[++index]);
      if (!Number.isInteger(limit) || limit < 1 || limit > 1000) throw new Error('--limit must be an integer from 1 to 1000.');
      args.limit = limit;
    } else if (arg === '--json') args.json = true;
    else if (arg === '--backfill') args.backfill = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return args;
}

function formatSummary(label, diagnostics) {
  return [
    `${label}:`,
    `  rentals: ${diagnostics.rentalsCount}`,
    `  gantt_rentals: ${diagnostics.ganttRentalsCount}`,
    `  without rentalId: ${diagnostics.missingRentalIdCount}`,
    `  without any stable rental link: ${diagnostics.missingAnyLinkCount}`,
    `  broken rentalId: ${diagnostics.brokenRentalIdCount}`,
    `  all stable links broken: ${diagnostics.brokenAnyLinkCount}`,
  ].join('\n');
}

function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  if (args.help) {
    console.log('Usage: node scripts/diagnose-gantt-rental-links.cjs --db /explicit/path/app.sqlite [--id id] [--backfill --dry-run]');
    return null;
  }
  const dbPath = resolveExplicitDatabasePath(args.db, { cwd: rootDir });
  if (args.backfill && !args.dryRun) {
    assertAuditedMaintenanceApplyUnavailable(true, 'gantt rental-link backfill');
  }

  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    const storage = createStrictReadOnlyStorage(db, {
      allowCollections: ['rentals', 'gantt_rentals', 'equipment'],
    });
    const state = {
      rentals: storage.readData('rentals'),
      gantt_rentals: storage.readData('gantt_rentals'),
      equipment: storage.readData('equipment'),
    };
    const before = analyzeGanttRentalLinks({
      rentals: state.rentals,
      ganttRentals: state.gantt_rentals,
      equipment: state.equipment,
      targetId: args.id,
      limit: args.limit,
    });
    const backfill = args.backfill
      ? backfillGanttRentalLinks({
        readData: name => state[name],
        writeData: () => { throw new Error('Readonly diagnostic attempted a write.'); },
        logger: args.json ? { log() {}, warn() {} } : console,
        dryRun: true,
      })
      : null;
    const payload = { db: dbPath, mode: 'read-only', productionDataChanged: false, before, backfill };
    if (args.json) console.log(JSON.stringify(payload, null, 2));
    else {
      console.log(`DB: ${dbPath}`);
      console.log(formatSummary('Current state', before));
      if (backfill) console.log(`Backfill preview: linked=${backfill.linked}, ambiguous=${backfill.ambiguous.length}, unresolved=${backfill.unresolved.length}`);
    }
    return payload;
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(`${error.code || 'GANTT_LINK_DIAGNOSTIC_FAILED'}: ${error.message || error}`);
    process.exitCode = 2;
  }
}

module.exports = { main, parseArgs };
