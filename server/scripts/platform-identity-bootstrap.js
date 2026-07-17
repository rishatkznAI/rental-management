#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  runPlatformIdentityBootstrap,
} = require('../lib/platform-identity-bootstrap');

function parseArgs(argv) {
  const [mode, ...rest] = argv;
  const values = { mode, explicitApply: false };
  for (let index = 0; index < rest.length; index += 1) {
    const argument = rest[index];
    if (argument === '--apply') {
      values.explicitApply = true;
      continue;
    }
    if (argument.startsWith('--')) {
      values[argument.slice(2)] = rest[index + 1];
      index += 1;
    }
  }
  return values;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!['inspect', 'validate', 'plan', 'apply'].includes(args.mode)) {
    throw new Error('Usage: platform-identity-bootstrap.js <inspect|validate|plan|apply> --db <path> [--config <path>] [--expected-checksum <sha256>] [--apply]');
  }
  const dbPath = path.resolve(args.db || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.sqlite'));
  const readonly = args.mode !== 'apply';
  const db = new Database(dbPath, { readonly, fileMustExist: true });
  try {
    db.pragma('foreign_keys = ON');
    const config = args.mode === 'inspect'
      ? undefined
      : JSON.parse(fs.readFileSync(path.resolve(args.config), 'utf8'));
    const result = runPlatformIdentityBootstrap({
      db,
      mode: args.mode,
      config,
      env: process.env,
      explicitApply: args.explicitApply,
      expectedChecksum: args['expected-checksum'],
    });
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    db.close();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error.code || 'BOOTSTRAP_FAILED',
    message: error.message,
    blockers: error.blockers || [],
  }, null, 2)}\n`);
  process.exitCode = 1;
}
