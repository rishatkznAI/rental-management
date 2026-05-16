#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const rootDir = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(rootDir, 'server', 'package.json'));
const Database = serverRequire('better-sqlite3');

function parseArgs(argv) {
  const timestamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  const args = {
    db: process.env.DB_PATH || 'server/data/app.sqlite',
    out: `server/data/backups/app-${timestamp}.sqlite`,
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') args.db = argv[++index] || args.db;
    else if (arg === '--out') args.out = argv[++index] || args.out;
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node scripts/backup-sqlite.cjs --db server/data/app.sqlite --out server/data/backups/app.sqlite',
    '',
    'Creates a SQLite backup using better-sqlite3 backup API and verifies the copy can be opened.',
  ].join('\n');
}

const args = parseArgs(process.argv.slice(2));
if (args.help) {
  console.log(usage());
  process.exit(0);
}

const dbPath = path.resolve(rootDir, args.db);
const outPath = path.resolve(rootDir, args.out);

(async () => {
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const db = new Database(dbPath, { fileMustExist: true });
  try {
    await db.backup(outPath);
  } finally {
    db.close();
  }
  const verify = new Database(outPath, { readonly: true, fileMustExist: true });
  let appDataCollections = 0;
  try {
    appDataCollections = verify.prepare('SELECT COUNT(*) AS count FROM app_data').get()?.count || 0;
  } finally {
    verify.close();
  }
  const payload = {
    ok: true,
    source: dbPath,
    backup: outPath,
    sizeBytes: fs.statSync(outPath).size,
    appDataCollections,
  };
  if (args.json) console.log(JSON.stringify(payload, null, 2));
  else {
    console.log('SQLite backup created and verified');
    console.log(`Source: ${dbPath}`);
    console.log(`Backup: ${outPath}`);
    console.log(`app_data collections: ${appDataCollections}`);
  }
})().catch(error => {
  console.error(error.message);
  process.exitCode = 2;
});
