const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');
const DEFAULT_PRODUCTION_ENVIRONMENT = require('../config/production-scope-remediation-environment');
const {
  extractStoredZipEntry,
  hashStoredZipEntry,
  inspectFullBackupArchive,
  validateStoredZipEntry,
} = require('./full-backup-validation');
const {
  normalizeZipPath,
} = require('./zip-store');

const BUSINESS_FILE_ROOT_NAMES = Object.freeze(['uploads', 'photos', 'documents', 'files', 'attachments']);

function requested(env = process.env) {
  return env.SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED === 'true';
}

function assertPreCompatibilityBackupEnvironment(
  env = process.env,
  { dbPath = env.DB_PATH, expectedEnvironment = DEFAULT_PRODUCTION_ENVIRONMENT } = {},
) {
  const replicaId = String(env.RAILWAY_REPLICA_ID || '');
  const deploymentId = String(env.RAILWAY_DEPLOYMENT_ID || '');
  const runtimeSha = String(env.RAILWAY_GIT_COMMIT_SHA || '');
  const expectedRuntimeSha = String(env.SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA || '');
  const token = String(env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN || '');
  const violations = [];
  if (!requested(env)) violations.push('backup runtime explicitly enabled');
  if (env.NODE_ENV !== 'production') violations.push('NODE_ENV=production');
  if (dbPath !== expectedEnvironment.sourceDbPath) {
    violations.push(`DB_PATH=${expectedEnvironment.sourceDbPath}`);
  }
  if (env.RAILWAY_PROJECT_ID !== expectedEnvironment.projectId) violations.push('exact Railway project');
  if (env.RAILWAY_ENVIRONMENT_ID !== expectedEnvironment.environmentId) violations.push('exact Railway environment');
  if (env.RAILWAY_SERVICE_ID !== expectedEnvironment.serviceId) violations.push('exact Railway service');
  if (env.RAILWAY_VOLUME_NAME !== expectedEnvironment.volumeName) violations.push('exact Railway volume name');
  if (env.RAILWAY_VOLUME_MOUNT_PATH !== expectedEnvironment.volumeMountPath) {
    violations.push('exact Railway volume mount');
  }
  if (!replicaId || replicaId !== replicaId.trim()) violations.push('nonempty raw Railway replica identity');
  if (!deploymentId || deploymentId !== deploymentId.trim()) {
    violations.push('nonempty raw Railway deployment identity');
  }
  if (!/^[a-f0-9]{40}$/.test(runtimeSha)) violations.push('exact lowercase runtime SHA');
  if (!/^[a-f0-9]{40}$/.test(expectedRuntimeSha) || expectedRuntimeSha !== runtimeSha) {
    violations.push('exact reviewed backup runtime SHA');
  }
  if (env.PRODUCTION_SCOPE_REMEDIATION_ENABLED !== 'true') violations.push('remediation enabled');
  if (env.PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE !== 'true') violations.push('write freeze enabled');
  if (env.PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY !== 'false') {
    violations.push('schema compatibility disabled');
  }
  if (env.PRODUCTION_SCOPE_REMEDIATION_VALIDATION_READ_ONLY !== 'false') {
    violations.push('validation disabled');
  }
  if (env.PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES !== '') violations.push('allowed modes empty');
  if (env.PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE !== '') violations.push('allowed mode empty');
  if (env.PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET !== '') violations.push('signing secret empty');
  if (env.APP_DISABLED !== 'true') violations.push('APP_DISABLED=true');
  if (env.BOT_DISABLED !== 'true') violations.push('BOT_DISABLED=true');
  if (env.GSM_DISABLED !== 'true') violations.push('GSM_DISABLED=true');
  if (env.GSM_ENABLED !== 'false') violations.push('GSM_ENABLED=false');
  if (env.SKYTECH_CLEAN_RESET_ENABLED !== 'false') violations.push('clean reset disabled');
  if (env.SKYTECH_CLEAN_RESET_TOKEN !== '') violations.push('clean reset token empty');
  if (env.ADMIN_RESET_PASSWORD !== '') violations.push('admin reset password empty');
  if (token.length < 32 || /[\r\n]/.test(token)) violations.push('valid dedicated backup token');

  if (violations.length > 0) {
    const error = new Error(`Pre-compatibility backup requires exact conservation controls: ${violations.join(', ')}.`);
    error.code = 'PRE_COMPATIBILITY_BACKUP_CONSERVATION_REQUIRED';
    throw error;
  }
  return true;
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileSha256(filePath) {
  const pathBefore = fs.lstatSync(filePath);
  if (!pathBefore.isFile() || pathBefore.isSymbolicLink() || pathBefore.nlink !== 1) {
    throw Object.assign(new Error('The file selected for hashing is unsafe.'), {
      code: 'PRE_COMPATIBILITY_BACKUP_OUTPUT_UNSAFE',
    });
  }
  const hash = crypto.createHash('sha256');
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    const before = fs.fstatSync(fd);
    if (!sameStatIdentity(pathBefore, before)) {
      throw Object.assign(new Error('The file selected for hashing changed before opening.'), {
        code: 'PRE_COMPATIBILITY_BACKUP_OUTPUT_CHANGED',
      });
    }
    let bytesRead;
    let position = 0;
    do {
      bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (bytesRead > 0) hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    } while (bytesRead > 0);
    const after = fs.fstatSync(fd);
    const pathAfter = fs.lstatSync(filePath);
    if (position !== before.size || !sameStatIdentity(before, after) || !sameStatIdentity(before, pathAfter)) {
      throw Object.assign(new Error('The file selected for hashing changed while reading.'), {
        code: 'PRE_COMPATIBILITY_BACKUP_OUTPUT_CHANGED',
      });
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest('hex');
}

function statIdentity(stat) {
  return {
    dev: String(stat.dev),
    ino: String(stat.ino),
    mode: String(stat.mode),
    nlink: String(stat.nlink),
    size: String(stat.size),
    mtimeMs: String(stat.mtimeMs),
    ctimeMs: String(stat.ctimeMs),
  };
}

function sameStatIdentity(left, right) {
  return JSON.stringify(statIdentity(left)) === JSON.stringify(statIdentity(right));
}

function hashOpenDescriptor(fd, expectedSize) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (true) {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  if (position !== Number(expectedSize)) {
    throw Object.assign(new Error('A preliminary backup source file changed while hashing.'), {
      code: 'PRE_COMPATIBILITY_BACKUP_SOURCE_CHANGED',
    });
  }
  return { size: position, sha256: hash.digest('hex') };
}

function captureOpenFileState(filePath, fd, { requiredIdentity = null } = {}) {
  const before = fs.fstatSync(fd);
  const pathBefore = fs.lstatSync(filePath);
  if (
    !before.isFile()
    || !pathBefore.isFile()
    || pathBefore.isSymbolicLink()
    || before.nlink !== 1
    || !sameStatIdentity(before, pathBefore)
    || (requiredIdentity && (
      String(before.dev) !== requiredIdentity.dev
      || String(before.ino) !== requiredIdentity.ino
    ))
  ) {
    throw Object.assign(new Error('A preliminary backup source file identity is unsafe.'), {
      code: 'PRE_COMPATIBILITY_BACKUP_SOURCE_IDENTITY_INVALID',
    });
  }
  const content = hashOpenDescriptor(fd, before.size);
  const after = fs.fstatSync(fd);
  const pathAfter = fs.lstatSync(filePath);
  if (!sameStatIdentity(before, after) || !sameStatIdentity(before, pathAfter)) {
    throw Object.assign(new Error('A preliminary backup source file changed while observed.'), {
      code: 'PRE_COMPATIBILITY_BACKUP_SOURCE_CHANGED',
    });
  }
  return { exists: true, ...statIdentity(after), ...content };
}

function capturePathFileState(filePath) {
  let pathState;
  try {
    pathState = fs.lstatSync(filePath);
  } catch (error) {
    if (error?.code === 'ENOENT') return { exists: false };
    throw error;
  }
  if (!pathState.isFile() || pathState.isSymbolicLink() || pathState.nlink !== 1) {
    throw Object.assign(new Error('A preliminary backup SQLite sidecar is unsafe.'), {
      code: 'PRE_COMPATIBILITY_BACKUP_SOURCE_IDENTITY_INVALID',
    });
  }
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    return captureOpenFileState(filePath, fd);
  } finally {
    fs.closeSync(fd);
  }
}

function captureSqliteSourceState({ dbPath, sourceFd, sourceIdentity }) {
  return {
    database: captureOpenFileState(dbPath, sourceFd, { requiredIdentity: sourceIdentity }),
    wal: capturePathFileState(`${dbPath}-wal`),
    shm: capturePathFileState(`${dbPath}-shm`),
  };
}

function durableSourceStateEqual(before, after) {
  return JSON.stringify({ database: before.database, wal: before.wal })
    === JSON.stringify({ database: after.database, wal: after.wal });
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0));
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function quoteIdentifier(value) {
  return `"${String(value).replaceAll('"', '""')}"`;
}

function databaseSchemaDigest(db) {
  const rows = db.prepare(`
    SELECT type, name, tbl_name, sql
    FROM sqlite_master
    WHERE name NOT LIKE 'sqlite_autoindex_%'
    ORDER BY type, name
  `).all();
  return sha256(JSON.stringify(rows));
}

function updateDigestLength(hash, length) {
  const bytes = Buffer.allocUnsafe(8);
  bytes.writeBigUInt64BE(BigInt(length));
  hash.update(bytes);
}

function updateDigestText(hash, tag, value) {
  const text = String(value);
  hash.update(tag);
  updateDigestLength(hash, Buffer.byteLength(text));
  hash.update(text, 'utf8');
}

function updateDigestSqlValue(hash, value) {
  if (value === null) {
    hash.update('N');
    return;
  }
  if (typeof value === 'bigint') {
    updateDigestText(hash, 'I', value.toString(10));
    return;
  }
  if (typeof value === 'number') {
    const bytes = Buffer.allocUnsafe(8);
    bytes.writeDoubleBE(value);
    hash.update('R');
    hash.update(bytes);
    return;
  }
  if (typeof value === 'string') {
    updateDigestText(hash, 'T', value);
    return;
  }
  if (Buffer.isBuffer(value)) {
    hash.update('B');
    updateDigestLength(hash, value.length);
    hash.update(value);
    return;
  }
  throw Object.assign(new Error('SQLite returned an unsupported value while hashing the backup.'), {
    code: 'PRE_COMPATIBILITY_BACKUP_DATABASE_VALUE_UNSUPPORTED',
  });
}

function tableReadPlan(db, name, sql) {
  const columns = db.prepare('SELECT name, pk FROM pragma_table_xinfo(?) ORDER BY cid')
    .all(name);
  if (/\bWITHOUT\s+ROWID\b/i.test(String(sql || ''))) {
    const primaryKey = columns.filter(column => Number(column.pk) > 0)
      .sort((left, right) => Number(left.pk) - Number(right.pk));
    if (primaryKey.length === 0) {
      throw Object.assign(new Error('A WITHOUT ROWID table has no provable primary-key order.'), {
        code: 'PRE_COMPATIBILITY_BACKUP_DATABASE_ORDER_UNPROVEN',
      });
    }
    return {
      mode: 'PRIMARY_KEY',
      sql: `SELECT * FROM ${quoteIdentifier(name)} ORDER BY ${primaryKey.map(column => quoteIdentifier(column.name)).join(', ')}`,
    };
  }
  const columnNames = new Set(columns.map(column => String(column.name).toLowerCase()));
  const rowIdName = ['rowid', '_rowid_', 'oid'].find(candidate => !columnNames.has(candidate));
  if (rowIdName) {
    return {
      mode: `ROWID:${rowIdName}`,
      sql: `SELECT ${rowIdName}, * FROM ${quoteIdentifier(name)} ORDER BY ${rowIdName}`,
    };
  }
  if (columns.length === 0) {
    throw Object.assign(new Error('A SQLite table has no deterministic logical read plan.'), {
      code: 'PRE_COMPATIBILITY_BACKUP_DATABASE_ORDER_UNPROVEN',
    });
  }
  return {
    mode: 'ALL_COLUMNS',
    sql: `SELECT * FROM ${quoteIdentifier(name)} ORDER BY ${columns.map(column => quoteIdentifier(column.name)).join(', ')}`,
  };
}

function databaseLogicalDigest(db) {
  const tables = db.prepare(`
    SELECT name, sql
    FROM sqlite_master
    WHERE type = 'table'
    ORDER BY name
  `).all();
  const hash = crypto.createHash('sha256');
  updateDigestText(hash, 'S', databaseSchemaDigest(db));
  updateDigestText(hash, 'U', String(db.pragma('user_version', { simple: true })));
  for (const table of tables) {
    const plan = tableReadPlan(db, table.name, table.sql);
    updateDigestText(hash, 'D', table.name);
    updateDigestText(hash, 'O', plan.mode);
    const statement = db.prepare(plan.sql).raw(true).safeIntegers(true);
    let rowCount = 0n;
    for (const row of statement.iterate()) {
      hash.update('Q');
      updateDigestLength(hash, row.length);
      for (const value of row) updateDigestSqlValue(hash, value);
      rowCount += 1n;
    }
    updateDigestText(hash, 'C', rowCount.toString(10));
  }
  return hash.digest('hex');
}

function collectionCount(json) {
  const value = JSON.parse(json);
  if (Array.isArray(value)) return value.length;
  if (value && typeof value === 'object') return Object.keys(value).length;
  return 0;
}

function optionalAppDataMetadata(db) {
  const table = db.prepare(`
    SELECT name
    FROM sqlite_master
    WHERE type = 'table' AND name = 'app_data'
  `).get();
  if (!table) return { supported: false, names: [], counts: {}, values: new Map() };
  const columns = new Set(db.pragma('table_info(app_data)').map(column => column.name));
  if (!columns.has('name') || !columns.has('json')) {
    return { supported: false, names: [], counts: {}, values: new Map() };
  }
  const rows = db.prepare('SELECT name, json FROM app_data ORDER BY name').all();
  const values = new Map();
  const counts = {};
  for (const row of rows) {
    if (typeof row.name !== 'string' || values.has(row.name) || typeof row.json !== 'string') {
      return { supported: false, names: [], counts: {}, values: new Map() };
    }
    let value;
    try {
      value = JSON.parse(row.json);
    } catch {
      return { supported: false, names: [], counts: {}, values: new Map() };
    }
    values.set(row.name, value);
    counts[row.name] = collectionCount(row.json);
  }
  return { supported: true, names: [...values.keys()], counts, values };
}

function resolveBusinessFileRoots(dbPath, explicitRoots = []) {
  const dataDirectory = path.dirname(path.resolve(dbPath));
  const roots = explicitRoots.length > 0
    ? explicitRoots.map(root => path.resolve(root))
    : BUSINESS_FILE_ROOT_NAMES.map(name => path.join(dataDirectory, name));
  return roots.map(root => {
    const relative = path.relative(dataDirectory, root);
    if (
      !relative
      || relative.startsWith('..')
      || path.isAbsolute(relative)
      || !BUSINESS_FILE_ROOT_NAMES.includes(relative)
    ) {
      throw Object.assign(new Error('The preliminary backup file root is unsafe.'), {
        code: 'PRE_COMPATIBILITY_BACKUP_FILE_ROOT_UNSAFE',
      });
    }
    return root;
  });
}

function validateBusinessFileCoverage(archive, dbPath, fileRoots = []) {
  let currentFiles = 0;
  const inventory = [];
  for (const root of resolveBusinessFileRoots(dbPath, fileRoots)) {
    if (!fs.existsSync(root)) continue;
    const rootStat = fs.lstatSync(root);
    if (!rootStat.isDirectory() || rootStat.isSymbolicLink() || fs.realpathSync(root) !== root) {
      throw Object.assign(new Error('A preliminary backup file root is unsafe.'), {
        code: 'PRE_COMPATIBILITY_BACKUP_FILE_ROOT_UNSAFE',
      });
    }
    const stack = [root];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const candidate = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(candidate);
          continue;
        }
        if (!entry.isFile()) {
          throw Object.assign(new Error('A preliminary backup file root contains an unsupported entry.'), {
            code: 'PRE_COMPATIBILITY_BACKUP_FILE_ENTRY_UNSAFE',
          });
        }
        const real = fs.realpathSync(candidate);
        const relativeToRoot = path.relative(root, real);
        if (!relativeToRoot || relativeToRoot.startsWith('..') || path.isAbsolute(relativeToRoot)) {
          throw Object.assign(new Error('A preliminary backup file escaped its root.'), {
            code: 'PRE_COMPATIBILITY_BACKUP_FILE_ENTRY_UNSAFE',
          });
        }
        currentFiles += 1;
        const zipName = `files/${path.basename(root)}/${normalizeZipPath(relativeToRoot)}`;
        const archived = archive.entries.get(zipName);
        const sourceState = capturePathFileState(real);
        const archivedSha256 = archived ? hashStoredZipEntry(archive, zipName) : '';
        if (
          !sourceState.exists
          || !archived
          || archived.size !== sourceState.size
          || archivedSha256 !== sourceState.sha256
        ) {
          throw Object.assign(new Error('The preliminary backup does not exactly cover a business file.'), {
            code: 'PRE_COMPATIBILITY_BACKUP_FILE_COVERAGE_MISMATCH',
          });
        }
        validateStoredZipEntry(archive, zipName);
        inventory.push({ zipPath: zipName, size: sourceState.size, sha256: sourceState.sha256 });
      }
    }
  }
  const archivedFileNames = [...archive.entries.keys()].filter(name => name.startsWith('files/'));
  const archivedFiles = archivedFileNames.length;
  const archivedEmbeddedFiles = archivedFileNames
    .filter(name => name.startsWith('files/embedded-photos/')).length;
  const archivedLocalFiles = archivedFiles - archivedEmbeddedFiles;
  const manifestFiles = Number(archive.manifest.includedFilesCount ?? archive.manifest.files?.includedFilesCount);
  const manifestLocalFiles = Number(archive.manifest.localFilesCount ?? archive.manifest.files?.localFilesCount);
  const manifestEmbeddedFiles = Number(
    archive.manifest.embeddedPhotosCount ?? archive.manifest.files?.embeddedPhotosCount,
  );
  if (
    !Number.isSafeInteger(manifestFiles)
    || !Number.isSafeInteger(manifestLocalFiles)
    || !Number.isSafeInteger(manifestEmbeddedFiles)
    || manifestFiles !== archivedFiles
    || manifestLocalFiles !== archivedLocalFiles
    || manifestEmbeddedFiles !== archivedEmbeddedFiles
    || manifestLocalFiles !== currentFiles
    || manifestFiles !== manifestLocalFiles + manifestEmbeddedFiles
  ) {
    throw Object.assign(new Error('The preliminary backup file manifest is incomplete.'), {
      code: 'PRE_COMPATIBILITY_BACKUP_FILE_MANIFEST_MISMATCH',
    });
  }
  inventory.sort((left, right) => left.zipPath.localeCompare(right.zipPath));
  return {
    currentFiles,
    archivedFiles,
    businessFileInventory: inventory,
    businessFileInventorySha256: sha256(JSON.stringify(inventory)),
  };
}

function validatePreCompatibilityBackup({
  sourceDb,
  sourceDbPath,
  backupPath,
  fileRoots = [],
  DatabaseConstructor = Database,
}) {
  const backupStat = fs.lstatSync(backupPath);
  if (!backupStat.isFile() || backupStat.isSymbolicLink() || backupStat.nlink !== 1) {
    throw Object.assign(new Error('The preliminary backup archive target is unsafe.'), {
      code: 'PRE_COMPATIBILITY_BACKUP_ARCHIVE_UNSAFE',
    });
  }
  const archive = inspectFullBackupArchive(backupPath);
  for (const name of archive.entries.keys()) validateStoredZipEntry(archive, name);
  const fileCoverage = validateBusinessFileCoverage(archive, sourceDbPath, fileRoots);
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'skytech-pre-compatibility-verify-'));
  const tempDbPath = path.join(tempDirectory, 'app.sqlite');
  const extractedDatabase = extractStoredZipEntry(archive, 'database/app.sqlite', tempDbPath);
  let backupDb;
  try {
    backupDb = new DatabaseConstructor(tempDbPath, { readonly: true, fileMustExist: true });
    backupDb.pragma('foreign_keys = ON');
    backupDb.pragma('query_only = ON');
    const sourceIntegrity = sourceDb.pragma('integrity_check');
    const backupIntegrity = backupDb.pragma('integrity_check');
    const sourceForeignKeyViolations = sourceDb.pragma('foreign_key_check').length;
    const backupForeignKeyViolations = backupDb.pragma('foreign_key_check').length;
    if (
      sourceIntegrity.length !== 1
      || sourceIntegrity[0].integrity_check !== 'ok'
      || backupIntegrity.length !== 1
      || backupIntegrity[0].integrity_check !== 'ok'
    ) {
      throw Object.assign(new Error('The preliminary backup database failed integrity_check.'), {
        code: 'PRE_COMPATIBILITY_BACKUP_DATABASE_INTEGRITY_FAILED',
      });
    }
    if (sourceForeignKeyViolations !== 0 || backupForeignKeyViolations !== 0) {
      throw Object.assign(new Error('The preliminary backup database failed foreign_key_check.'), {
        code: 'PRE_COMPATIBILITY_BACKUP_DATABASE_FOREIGN_KEYS_FAILED',
      });
    }

    const manifestNames = Object.keys(archive.manifest.counts).sort();
    if (manifestNames.length > 0) {
      const sourceCollections = optionalAppDataMetadata(sourceDb);
      const backupCollections = optionalAppDataMetadata(backupDb);
      if (!sourceCollections.supported || !backupCollections.supported) {
        throw Object.assign(new Error('The preliminary backup collection metadata is unsupported.'), {
          code: 'PRE_COMPATIBILITY_BACKUP_COLLECTION_SET_MISMATCH',
        });
      }
      if (JSON.stringify(sourceCollections.names) !== JSON.stringify(backupCollections.names)) {
        throw Object.assign(new Error('The preliminary backup collection inventory is incomplete.'), {
          code: 'PRE_COMPATIBILITY_BACKUP_COLLECTION_SET_MISMATCH',
        });
      }
      if (JSON.stringify(sourceCollections.names) !== JSON.stringify(manifestNames)) {
        throw Object.assign(new Error('The preliminary backup collection metadata is partial.'), {
          code: 'PRE_COMPATIBILITY_BACKUP_COLLECTION_SET_MISMATCH',
        });
      }
      for (const name of sourceCollections.names) {
        if (Number(archive.manifest.counts[name]) !== sourceCollections.counts[name]) {
          throw Object.assign(new Error('The preliminary backup collection counts are incomplete.'), {
            code: 'PRE_COMPATIBILITY_BACKUP_COLLECTION_COUNT_MISMATCH',
          });
        }
      }
    }
    const sourceLogicalSha256 = databaseLogicalDigest(sourceDb);
    const backupLogicalSha256 = databaseLogicalDigest(backupDb);
    if (sourceLogicalSha256 !== backupLogicalSha256) {
      throw Object.assign(new Error('The preliminary SQLite snapshot is not logically exact.'), {
        code: 'PRE_COMPATIBILITY_BACKUP_DATABASE_MISMATCH',
      });
    }
    return {
      archiveEntries: archive.entries.size,
      generatedAt: archive.manifest.generatedAt || null,
      includedFilesCount: Number(archive.manifest.includedFilesCount ?? archive.manifest.files?.includedFilesCount) || 0,
      skippedFilesCount: 0,
      currentBusinessFiles: fileCoverage.currentFiles,
      archivedFiles: fileCoverage.archivedFiles,
      businessFileCount: fileCoverage.businessFileInventory.length,
      businessFileInventorySha256: fileCoverage.businessFileInventorySha256,
      databaseIntegrity: 'ok',
      databaseForeignKeyViolations: 0,
      logicalDatabaseSha256: backupLogicalSha256,
      extractedDatabaseSha256: extractedDatabase.sha256,
      extractedDatabaseSize: extractedDatabase.size,
    };
  } finally {
    try { backupDb?.close(); } catch { /* cleanup still runs */ }
    fs.rmSync(tempDirectory, { recursive: true, force: true });
  }
}

module.exports = {
  BUSINESS_FILE_ROOT_NAMES,
  assertPreCompatibilityBackupEnvironment,
  captureSqliteSourceState,
  databaseLogicalDigest,
  durableSourceStateEqual,
  fileSha256,
  fsyncDirectory,
  optionalAppDataMetadata,
  requested,
  sameStatIdentity,
  statIdentity,
  validatePreCompatibilityBackup,
};
