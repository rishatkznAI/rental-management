#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');

const rootDir = path.resolve(__dirname, '..');
const serverRequire = createRequire(path.join(rootDir, 'server', 'package.json'));
const Database = serverRequire('better-sqlite3');
const {
  databaseContentFingerprint,
} = require('../server/lib/production-scope-remediation-runner.js');

function parseArgs(argv) {
  const args = {
    db: '',
    out: '',
    json: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--db') args.db = argv[++index] || '';
    else if (arg === '--out') args.out = argv[++index] || '';
    else if (arg === '--json') args.json = true;
    else if (arg === '--help' || arg === '-h') args.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
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

(async () => {
  if (!args.db || !args.out) throw new Error('Both explicit --db and --out paths are required.');
  const dbPath = path.resolve(rootDir, args.db);
  const outPath = path.resolve(rootDir, args.out);
  if (dbPath === outPath) throw new Error('Backup output must differ from the source database.');
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);
  if (fs.existsSync(outPath)) throw new Error(`Refusing to overwrite an existing backup: ${outPath}`);
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  let sourceFingerprint;
  try {
    sourceFingerprint = databaseContentFingerprint(db);
    await db.backup(outPath);
  } finally {
    db.close();
  }
  const verify = new Database(outPath, { readonly: true, fileMustExist: true });
  let appDataCollections = 0;
  let backupFingerprint;
  try {
    const quickCheck = verify.pragma('quick_check', { simple: true });
    if (quickCheck !== 'ok') throw new Error(`Backup quick_check failed: ${quickCheck}`);
    backupFingerprint = databaseContentFingerprint(verify);
    if (backupFingerprint !== sourceFingerprint) throw new Error('Backup content fingerprint does not match the source database.');
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
    sourceFingerprint,
    backupFingerprint,
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
