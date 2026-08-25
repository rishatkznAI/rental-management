#!/usr/bin/env node

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const {
  planProductionScopeRemediation,
  sqliteTotalChanges,
} = require('../lib/production-scope-remediation');

function parseArgs(argv) {
  const result = {
    apply: false,
    dbPath: '',
    planPath: '',
  };
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === '--dry-run') {
      result.apply = false;
    } else if (argument === '--apply') {
      const error = new Error('Direct CLI apply is disabled; use the guarded HTTPS remediation runner.');
      error.code = 'DIRECT_APPLY_DISABLED';
      throw error;
    } else if (argument === '--db') {
      result.dbPath = argv[++index] || '';
    } else if (argument === '--plan') {
      result.planPath = argv[++index] || '';
    } else if (argument === '--help' || argument === '-h') {
      result.help = true;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return result;
}

function usage() {
  return [
    'Usage:',
    '  node server/scripts/production-scope-remediation.js --dry-run --db <sqlite> --plan <json>',
    '',
    'Default mode is dry-run. Dry-run opens SQLite readonly, enables query_only, and performs zero writes.',
    'Direct CLI apply is disabled. Production apply exists only behind the guarded HTTPS remediation runner.',
  ].join('\n');
}

function hashFile(filePath) {
  const hash = crypto.createHash('sha256');
  hash.update(fs.readFileSync(filePath));
  return hash.digest('hex');
}

function fileState(filePath) {
  try {
    const stat = fs.statSync(filePath);
    return {
      path: filePath,
      sizeBytes: stat.size,
      mtimeMs: stat.mtimeMs,
      sha256: hashFile(filePath),
    };
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
}

function sqliteFileSet(dbPath) {
  return {
    database: fileState(dbPath),
    wal: fileState(`${dbPath}-wal`),
    shm: fileState(`${dbPath}-shm`),
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    process.stdout.write(`${usage()}\n`);
    return;
  }
  if (!args.dbPath || !args.planPath) throw new Error(usage());
  const dbPath = path.resolve(args.dbPath);
  const planPath = path.resolve(args.planPath);
  if (!fs.existsSync(dbPath)) throw new Error(`SQLite database not found: ${dbPath}`);
  const plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  if (plan.sourceDbPath && path.resolve(plan.sourceDbPath) !== dbPath) {
    throw Object.assign(new Error('Plan is pinned to a different production DB path.'), {
      code: 'SOURCE_DB_PATH_MISMATCH',
    });
  }

  const beforeFiles = sqliteFileSet(dbPath);
  const db = new Database(dbPath, {
    readonly: true,
    fileMustExist: true,
  });
  try {
    db.pragma('foreign_keys = ON');
    db.pragma('query_only = ON');
    const totalChangesBefore = sqliteTotalChanges(db);
    const preview = planProductionScopeRemediation({ db, plan });
    const totalChangesAfter = sqliteTotalChanges(db);
    db.close();
    const afterFiles = sqliteFileSet(dbPath);
    const result = {
      ...preview,
      mode: 'dry-run',
      applyResult: null,
      runtimeSafety: {
        readonly: true,
        queryOnly: true,
        totalChangesBefore,
        totalChangesAfter,
        totalChangesDelta: totalChangesAfter - totalChangesBefore,
        beforeFiles,
        afterFiles,
        filesUnchanged: JSON.stringify(beforeFiles) === JSON.stringify(afterFiles),
      },
    };
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    if (!preview.readyToApply) process.exitCode = 2;
  } finally {
    if (db.open) db.close();
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error.code || 'PRODUCTION_SCOPE_REMEDIATION_FAILED',
    message: error.message,
    blockers: error.blockers || [],
  }, null, 2)}\n`);
  process.exitCode = 1;
}
