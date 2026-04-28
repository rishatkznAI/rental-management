#!/usr/bin/env node

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const {
  analyzeGanttRentalLinks,
  backfillGanttRentalLinks,
} = require('../server/lib/rental-change-requests.js');

function parseArgs(argv) {
  const args = {
    db: process.env.DB_PATH || path.join(__dirname, '..', 'server', 'data', 'app.sqlite'),
    id: '',
    limit: 50,
    json: false,
    backfill: false,
    dryRun: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') args.db = argv[++index] || args.db;
    else if (arg === '--id') args.id = argv[++index] || '';
    else if (arg === '--limit') args.limit = Number(argv[++index]) || args.limit;
    else if (arg === '--json') args.json = true;
    else if (arg === '--backfill') args.backfill = true;
    else if (arg === '--dry-run') args.dryRun = true;
    else if (!arg.startsWith('--')) args.db = arg;
  }

  return args;
}

function sqliteJson(dbPath, sql) {
  const output = execFileSync('sqlite3', ['-json', dbPath, sql], { encoding: 'utf8' });
  return output.trim() ? JSON.parse(output) : [];
}

function loadCollections(dbPath) {
  const rows = sqliteJson(dbPath, "select name,json from app_data where name in ('rentals','gantt_rentals')");
  const state = { rentals: [], gantt_rentals: [] };
  for (const row of rows) {
    state[row.name] = row.json ? JSON.parse(row.json) : [];
  }
  return state;
}

function writeCollection(dbPath, name, value) {
  const sql = [
    'BEGIN;',
    `UPDATE app_data SET json='${JSON.stringify(value).replace(/'/g, "''")}', updated_at=CURRENT_TIMESTAMP WHERE name='${name.replace(/'/g, "''")}';`,
    'COMMIT;',
  ].join('\n');
  const file = path.join(os.tmpdir(), `rental-links-${process.pid}-${Date.now()}.sql`);
  fs.writeFileSync(file, sql);
  try {
    execFileSync('sqlite3', [dbPath, `.read ${file}`], { stdio: 'pipe' });
  } finally {
    fs.rmSync(file, { force: true });
  }
}

function formatSummary(label, diagnostics) {
  return [
    `${label}:`,
    `  rentals: ${diagnostics.rentalsCount}`,
    `  gantt_rentals: ${diagnostics.ganttRentalsCount}`,
    `  без rentalId: ${diagnostics.missingRentalIdCount}`,
    `  без любых связей rentalId/sourceRentalId/originalRentalId: ${diagnostics.missingAnyLinkCount}`,
    `  rentalId указывает в никуда: ${diagnostics.brokenRentalIdCount}`,
    `  все связи указывают в никуда: ${diagnostics.brokenAnyLinkCount}`,
    diagnostics.target ? [
      `  target ${diagnostics.targetId}:`,
      `    found in rentals.id: ${diagnostics.target.foundInRentals ? 'yes' : 'no'}`,
      `    found in gantt_rentals.id: ${diagnostics.target.foundInGanttRentals ? 'yes' : 'no'}`,
      `    found in gantt links: ${diagnostics.target.foundInGanttLinks ? 'yes' : 'no'}`,
    ].join('\n') : '',
  ].filter(Boolean).join('\n');
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!fs.existsSync(args.db)) {
    console.error(`DB not found: ${args.db}`);
    process.exit(2);
  }

  const state = loadCollections(args.db);
  const before = analyzeGanttRentalLinks({
    rentals: state.rentals,
    ganttRentals: state.gantt_rentals,
    targetId: args.id,
    limit: args.limit,
  });

  let backfill = null;
  let after = before;

  if (args.backfill || args.dryRun) {
    let nextState = state;
    backfill = backfillGanttRentalLinks({
      readData: name => nextState[name] || [],
      writeData: (name, value) => {
        nextState = { ...nextState, [name]: value };
        if (!args.dryRun) writeCollection(args.db, name, value);
      },
      logger: args.json ? { log: () => {}, warn: () => {} } : console,
      dryRun: args.dryRun,
    });

    const persistedState = args.dryRun ? nextState : loadCollections(args.db);
    after = analyzeGanttRentalLinks({
      rentals: persistedState.rentals,
      ganttRentals: persistedState.gantt_rentals,
      targetId: args.id,
      limit: args.limit,
    });
  }

  const payload = { db: args.db, before, backfill, after };
  if (args.json) {
    console.log(JSON.stringify(payload, null, 2));
    return;
  }

  console.log(`DB: ${args.db}`);
  console.log(formatSummary('Before', before));
  if (backfill) {
    console.log('');
    console.log(`Backfill: checked=${backfill.checked}, missingLink=${backfill.missingLink}, linked=${backfill.linked}, ambiguous=${backfill.ambiguous.length}, unresolved=${backfill.unresolved.length}, dryRun=${backfill.dryRun}`);
    console.log('');
    console.log(formatSummary('After', after));
  }
}

main();
