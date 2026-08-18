#!/usr/bin/env node

const path = require('path');
const Database = require('better-sqlite3');
const {
  applyReset,
  buildResetPlan,
  purgeQuarantine,
} = require('../lib/skytech-clean-production-reset');
const {
  getAppDisabledConfig,
  getBotDisabledConfig,
  getGsmDisabledConfig,
} = require('../lib/feature-flags');

function parseArgs(argv) {
  const args = {};
  for (const token of argv) {
    if (token === '--dry-run') args.mode = 'dry-run';
    else if (token === '--apply') args.mode = 'apply';
    else if (token === '--purge-quarantine') args.mode = 'purge-quarantine';
    else if (token === '--no-file-cleanup') args.cleanupFiles = false;
    else if (token.startsWith('--') && token.includes('=')) {
      const separator = token.indexOf('=');
      args[token.slice(2, separator)] = token.slice(separator + 1);
    } else {
      throw new Error(`Unknown argument: ${token}`);
    }
  }
  return args;
}

function assertEnvironmentGuard({ mode, environment, dbPath, env = process.env }) {
  if (!['production', 'isolated'].includes(environment)) {
    throw new Error('Reset environment must be exactly production or isolated.');
  }
  if (mode !== 'apply' || environment === 'production') return;
  const railwayProduction = String(env.RAILWAY_ENVIRONMENT_NAME || '').trim().toLowerCase() === 'production';
  const nodeProduction = String(env.NODE_ENV || '').trim().toLowerCase() === 'production';
  const relativeToData = path.relative('/data', path.resolve(dbPath));
  const productionStorage = relativeToData === '' || (!relativeToData.startsWith('..') && !path.isAbsolute(relativeToData));
  if (railwayProduction || nodeProduction || productionStorage) {
    throw new Error('Isolated apply is forbidden for a production runtime or /data storage path.');
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const mode = args.mode || 'dry-run';
  const dbPath = path.resolve(args.db || process.env.DB_PATH || path.join(__dirname, '..', 'data', 'app.sqlite'));
  const environment = String(args.environment || process.env.RAILWAY_ENVIRONMENT_NAME || process.env.NODE_ENV || 'isolated').toLowerCase();
  const fileRoots = args['file-roots']
    ? String(args['file-roots']).split(',').map((value) => value.trim()).filter(Boolean)
    : [];
  assertEnvironmentGuard({ mode, environment, dbPath });
  const db = new Database(dbPath, {
    readonly: mode === 'dry-run' || mode === 'purge-quarantine',
    fileMustExist: true,
  });
  db.pragma('busy_timeout = 5000');
  db.pragma('foreign_keys = ON');

  try {
    let result;
    if (mode === 'apply') {
      result = applyReset(db, {
        dbPath,
        environment,
        confirm: args.confirm,
        backupPath: args.backup ? path.resolve(args.backup) : '',
        backupSha256: args['backup-sha256'],
        preResetAudit: args['pre-reset-audit'],
        conservationState: {
          appDisabled: getAppDisabledConfig().disabled,
          botDisabled: getBotDisabledConfig().disabled,
          gsmDisabled: getGsmDisabledConfig().disabled,
        },
        cleanupFiles: args.cleanupFiles !== false,
        fileRoots,
      });
    } else if (mode === 'purge-quarantine') {
      result = purgeQuarantine({
        dbPath,
        quarantinePath: args.quarantine,
        confirm: args.confirm,
        backupPath: args.backup ? path.resolve(args.backup) : '',
        backupSha256: args['backup-sha256'],
      });
    } else {
      result = buildResetPlan(db, { dbPath, fileRoots });
    }
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    db.close();
  }
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, error: error?.message || String(error) })}\n`);
    process.exitCode = 1;
  }
}

module.exports = { assertEnvironmentGuard, parseArgs };
