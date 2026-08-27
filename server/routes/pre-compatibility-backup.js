'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const {
  cleanupBackupArchive,
  createFullBackupArchive,
} = require('../lib/full-backup');
const {
  assertPreCompatibilityBackupEnvironment,
  captureSqliteSourceState,
  durableSourceStateEqual,
  fileSha256,
  fsyncDirectory,
  validatePreCompatibilityBackup,
} = require('../lib/pre-compatibility-backup');

const OPERATION_LOCK_FILENAME = '.skytech-pre-compatibility-backup.lock.json';
const RECEIPT_FILENAME = 'skytech-pre-compatibility-backup-receipt.json';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

function backupDirectoryPath(dbPath) {
  const databaseDirectory = path.dirname(path.resolve(dbPath));
  const backupDirectory = path.join(databaseDirectory, 'backups');
  let directoryStat;
  try {
    directoryStat = fs.lstatSync(backupDirectory);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    fs.mkdirSync(backupDirectory, { recursive: false, mode: 0o700 });
    fs.chmodSync(backupDirectory, 0o700);
    fsyncDirectory(databaseDirectory);
    directoryStat = fs.lstatSync(backupDirectory);
  }
  if (
    !directoryStat.isDirectory()
    || directoryStat.isSymbolicLink()
    || fs.realpathSync(backupDirectory) !== backupDirectory
  ) {
    fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup directory is unsafe.');
  }
  directoryStat = fs.lstatSync(backupDirectory);
  if ((directoryStat.mode & 0o077) !== 0) {
    fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup directory is not private.');
  }
  return backupDirectory;
}

function backupOutputPath(dbPath, filename) {
  if (!/^skytech-pre-clean-reset-\d{8}T\d{6}Z\.zip$/.test(filename)) {
    fail('PRE_COMPATIBILITY_BACKUP_FILENAME_INVALID', 'Invalid preliminary backup filename.');
  }
  return path.join(backupDirectoryPath(dbPath), filename);
}

function writeAll(fd, bytes) {
  let position = 0;
  while (position < bytes.length) {
    position += fs.writeSync(fd, bytes, position, bytes.length - position, position);
  }
}

function createExclusiveDurableFile(filePath, bytes) {
  const fd = fs.openSync(
    filePath,
    fs.constants.O_WRONLY
      | fs.constants.O_CREAT
      | fs.constants.O_EXCL
      | (fs.constants.O_NOFOLLOW || 0),
    0o600,
  );
  try {
    fs.fchmodSync(fd, 0o600);
    writeAll(fd, bytes);
    fs.fsyncSync(fd);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== bytes.length || (stat.mode & 0o077) !== 0) {
      fail('PRE_COMPATIBILITY_BACKUP_OUTPUT_UNSAFE', 'A preliminary backup control file is unsafe.');
    }
  } finally {
    fs.closeSync(fd);
  }
  fsyncDirectory(path.dirname(filePath));
}

function publishAtomicBuffer(finalPath, bytes, operationId, onPublished = () => {}) {
  if (fs.existsSync(finalPath)) {
    fail('PRE_COMPATIBILITY_BACKUP_ALREADY_EXISTS', 'A preliminary backup output already exists.');
  }
  const temporaryPath = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${operationId}.tmp`);
  try {
    createExclusiveDurableFile(temporaryPath, bytes);
    if (fs.existsSync(finalPath)) {
      fail('PRE_COMPATIBILITY_BACKUP_ALREADY_EXISTS', 'A preliminary backup output already exists.');
    }
    fs.linkSync(temporaryPath, finalPath);
    onPublished();
    fs.unlinkSync(temporaryPath);
    fsyncDirectory(path.dirname(finalPath));
    const stat = fs.lstatSync(finalPath);
    if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || (stat.mode & 0o077) !== 0) {
      fail('PRE_COMPATIBILITY_BACKUP_OUTPUT_UNSAFE', 'The published preliminary backup output is unsafe.');
    }
    return stat;
  } catch (error) {
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* original error wins */ }
    throw error;
  }
}

function publishAtomicFile(sourcePath, finalPath, operationId) {
  const before = fs.lstatSync(sourcePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    fail('PRE_COMPATIBILITY_BACKUP_ARCHIVE_UNSAFE', 'The temporary preliminary backup archive is unsafe.');
  }
  const sourceFd = fs.openSync(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const temporaryPath = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${operationId}.tmp`);
  let targetFd;
  let size = 0;
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    if (fs.existsSync(finalPath)) {
      fail('PRE_COMPATIBILITY_BACKUP_ALREADY_EXISTS', 'A preliminary backup output already exists.');
    }
    targetFd = fs.openSync(
      temporaryPath,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    fs.fchmodSync(targetFd, 0o600);
    while (true) {
      const bytesRead = fs.readSync(sourceFd, buffer, 0, buffer.length, size);
      if (bytesRead === 0) break;
      let written = 0;
      while (written < bytesRead) {
        written += fs.writeSync(targetFd, buffer, written, bytesRead - written, size + written);
      }
      size += bytesRead;
    }
    fs.fsyncSync(targetFd);
    const after = fs.fstatSync(sourceFd);
    const pathAfter = fs.lstatSync(sourcePath);
    const targetStat = fs.fstatSync(targetFd);
    if (
      size !== before.size
      || after.dev !== before.dev
      || after.ino !== before.ino
      || after.size !== before.size
      || pathAfter.dev !== before.dev
      || pathAfter.ino !== before.ino
      || pathAfter.size !== before.size
      || !targetStat.isFile()
      || targetStat.nlink !== 1
      || targetStat.size !== size
      || (targetStat.mode & 0o077) !== 0
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_ARCHIVE_CHANGED', 'The preliminary backup archive changed before publication.');
    }
    fs.closeSync(targetFd);
    targetFd = undefined;
    fs.closeSync(sourceFd);
    if (fs.existsSync(finalPath)) {
      fail('PRE_COMPATIBILITY_BACKUP_ALREADY_EXISTS', 'A preliminary backup output already exists.');
    }
    fs.linkSync(temporaryPath, finalPath);
    fs.unlinkSync(temporaryPath);
    fsyncDirectory(path.dirname(finalPath));
    const finalStat = fs.lstatSync(finalPath);
    if (!finalStat.isFile() || finalStat.isSymbolicLink() || finalStat.nlink !== 1 || finalStat.size !== size) {
      fail('PRE_COMPATIBILITY_BACKUP_OUTPUT_UNSAFE', 'The published preliminary backup archive is unsafe.');
    }
    return finalStat;
  } finally {
    if (targetFd !== undefined) fs.closeSync(targetFd);
    try { fs.closeSync(sourceFd); } catch { /* it may already be closed after successful copy */ }
    try { fs.rmSync(temporaryPath, { force: true }); } catch { /* original error wins */ }
  }
}

function readPrivateJsonFile(filePath) {
  const pathBefore = fs.lstatSync(filePath);
  if (
    !pathBefore.isFile()
    || pathBefore.isSymbolicLink()
    || pathBefore.nlink !== 1
    || (pathBefore.mode & 0o077) !== 0
    || pathBefore.size > 4 * 1024 * 1024
  ) {
    fail('PRE_COMPATIBILITY_BACKUP_RECEIPT_UNSAFE', 'The preliminary backup receipt is unsafe.');
  }
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd);
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    const pathAfter = fs.lstatSync(filePath);
    if (
      before.dev !== after.dev
      || before.ino !== after.ino
      || before.size !== after.size
      || before.dev !== pathAfter.dev
      || before.ino !== pathAfter.ino
      || before.size !== pathAfter.size
      || bytes.length !== before.size
      || bytes.length > 4 * 1024 * 1024
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_RECEIPT_CHANGED', 'The preliminary backup receipt changed while reading.');
    }
    return JSON.parse(bytes.toString('utf8'));
  } catch (error) {
    if (error?.code?.startsWith?.('PRE_COMPATIBILITY_')) throw error;
    fail('PRE_COMPATIBILITY_BACKUP_RECEIPT_INVALID', 'The preliminary backup receipt is invalid.');
  } finally {
    fs.closeSync(fd);
  }
}

function sameSourceIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino && left?.realPath === right?.realPath;
}

function assertBoundSourceHandle(sourceHandle) {
  if (typeof sourceHandle?.assertBound !== 'function' || sourceHandle.assertBound() !== true) {
    fail(
      'PRE_COMPATIBILITY_DATABASE_DESCRIPTOR_MISMATCH',
      'The SQLite source handle is not bound to the exact production inode.',
    );
  }
}

function responseFromReceipt(receipt, receiptSha256, idempotent) {
  return {
    ok: true,
    idempotent,
    backup: {
      ...receipt.archive,
      operationId: receipt.operationId,
      requestNonce: receipt.requestNonce,
      receiptFilename: RECEIPT_FILENAME,
      receiptSha256,
      sourceStateBefore: receipt.source.before,
      sourceStateAfter: receipt.source.after,
    },
  };
}

function validateCompletedReceipt({ receipt, requestNonce, runtime, dbPath, sourceHandle }) {
  assertBoundSourceHandle(sourceHandle);
  if (
    receipt?.receiptVersion !== 1
    || receipt?.purpose !== 'pre-schema-compatibility-production-backup'
    || receipt?.status !== 'COMPLETE'
    || receipt?.requestNonce !== requestNonce
    || !UUID_PATTERN.test(String(receipt?.operationId || ''))
    || JSON.stringify(receipt.runtime) !== JSON.stringify(runtime)
    || !sameSourceIdentity(receipt?.source?.identity, sourceHandle.sourceIdentity)
    || receipt?.source?.queryOnly !== true
    || receipt?.source?.totalChangesBefore !== 0
    || receipt?.source?.totalChangesAfter !== 0
    || receipt?.source?.durableStateUnchanged !== true
  ) {
    fail('PRE_COMPATIBILITY_BACKUP_RECEIPT_MISMATCH', 'The completed preliminary backup receipt does not match this request.');
  }
  const archivePath = backupOutputPath(dbPath, receipt.archive?.filename);
  const archiveStat = fs.lstatSync(archivePath);
  if (
    !archiveStat.isFile()
    || archiveStat.isSymbolicLink()
    || archiveStat.nlink !== 1
    || archiveStat.size !== receipt.archive.size
    || fileSha256(archivePath) !== receipt.archive.sha256
  ) {
    fail('PRE_COMPATIBILITY_BACKUP_ARCHIVE_MISMATCH', 'The completed preliminary backup archive is missing or changed.');
  }
  const db = sourceHandle.db;
  if (db.readonly !== true || db.pragma('query_only', { simple: true }) !== 1) {
    fail('PRE_COMPATIBILITY_BACKUP_SOURCE_NOT_READ_ONLY', 'The receipt source is not read-only and query-only.');
  }
  const totalChangesBefore = Number(db.prepare('SELECT total_changes() AS count').get().count);
  let transactionStarted = false;
  try {
    const stateBeforeTransaction = captureSqliteSourceState({
      dbPath,
      sourceFd: sourceHandle.sourceFd,
      sourceIdentity: sourceHandle.sourceIdentity,
    });
    db.exec('BEGIN');
    transactionStarted = true;
    db.prepare('SELECT COUNT(*) AS count FROM sqlite_master').get();
    const stateAtSnapshot = captureSqliteSourceState({
      dbPath,
      sourceFd: sourceHandle.sourceFd,
      sourceIdentity: sourceHandle.sourceIdentity,
    });
    if (!durableSourceStateEqual(stateBeforeTransaction, stateAtSnapshot)) {
      fail('PRE_COMPATIBILITY_BACKUP_SOURCE_CHANGED', 'The source changed while the receipt snapshot was established.');
    }
    const validation = validatePreCompatibilityBackup({
      sourceDb: db,
      sourceDbPath: dbPath,
      backupPath: archivePath,
    });
    const stateBeforeCommit = captureSqliteSourceState({
      dbPath,
      sourceFd: sourceHandle.sourceFd,
      sourceIdentity: sourceHandle.sourceIdentity,
    });
    if (!durableSourceStateEqual(stateAtSnapshot, stateBeforeCommit)) {
      fail('PRE_COMPATIBILITY_BACKUP_SOURCE_CHANGED', 'The source changed during receipt validation.');
    }
    db.exec('COMMIT');
    transactionStarted = false;
    assertBoundSourceHandle(sourceHandle);
    const totalChangesAfter = Number(db.prepare('SELECT total_changes() AS count').get().count);
    const currentState = captureSqliteSourceState({
      dbPath,
      sourceFd: sourceHandle.sourceFd,
      sourceIdentity: sourceHandle.sourceIdentity,
    });
    if (
      totalChangesBefore !== 0
      || totalChangesAfter !== totalChangesBefore
      || !durableSourceStateEqual(stateAtSnapshot, currentState)
      || !durableSourceStateEqual(receipt.source.after, currentState)
      || validation.logicalDatabaseSha256 !== receipt.archive.logicalDatabaseSha256
      || validation.extractedDatabaseSha256 !== receipt.archive.databaseFileSha256
      || validation.extractedDatabaseSize !== receipt.archive.databaseFileSize
      || validation.businessFileCount !== receipt.archive.businessFileCount
      || validation.businessFileInventorySha256 !== receipt.archive.businessFileInventorySha256
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_SOURCE_CHANGED', 'The source or archive changed after the completed backup.');
    }
  } finally {
    if (transactionStarted) {
      try { db.exec('ROLLBACK'); } catch { /* original validation error wins */ }
    }
  }
}

function createPreCompatibilityBackupHandlers({
  dbPath,
  openSourceDatabase,
  startupSourceIdentity,
  buildInfo,
  expectedEnvironment,
  isBackupOnlyRuntime = () => false,
  env = process.env,
  now = () => new Date(),
  randomUUID = () => crypto.randomUUID(),
}) {
  let operationInFlight = false;

  function requireBackupCapability(req, res, next) {
    try {
      if (assertPreCompatibilityBackupEnvironment(env, { dbPath, expectedEnvironment }) !== true) {
        return res.status(404).json({ ok: false, error: 'Not found' });
      }
      const stat = fs.lstatSync(dbPath);
      if (
        isBackupOnlyRuntime() !== true
        || !stat.isFile()
        || stat.isSymbolicLink()
        || stat.nlink !== 1
        || path.resolve(dbPath) !== expectedEnvironment.sourceDbPath
        || fs.realpathSync(dbPath) !== expectedEnvironment.sourceDbPath
      ) {
        return res.status(404).json({ ok: false, error: 'Not found' });
      }
    } catch {
      return res.status(404).json({ ok: false, error: 'Not found' });
    }
    const expectedToken = env.SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN;
    const requestNonce = String(req.headers['x-skytech-pre-compatibility-backup-nonce'] || '');
    if (
      !safeEqual(req.headers['x-skytech-pre-compatibility-backup-token'], expectedToken)
      || String(expectedToken || '').length < 32
      || !UUID_PATTERN.test(requestNonce)
    ) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    req.preCompatibilityBackupNonce = requestNonce;
    return next();
  }

  async function handleBackup(req, res) {
    if (operationInFlight) {
      return res.status(409).json({ ok: false, error: 'Backup operation already in progress.' });
    }
    operationInFlight = true;
    let backup = null;
    let sourceHandle = null;
    let outputPath = null;
    let published = false;
    let receiptCommitted = false;
    let transactionStarted = false;
    let operationStage = 'authorize';
    const requestNonce = req.preCompatibilityBackupNonce;
    try {
      if (assertPreCompatibilityBackupEnvironment(env, { dbPath, expectedEnvironment }) !== true) {
        fail('PRE_COMPATIBILITY_BACKUP_NOT_ENABLED', 'The backup-only runtime is not explicitly enabled.');
      }
      const backupDirectory = backupDirectoryPath(dbPath);
      const receiptPath = path.join(backupDirectory, RECEIPT_FILENAME);
      const operationLockPath = path.join(backupDirectory, OPERATION_LOCK_FILENAME);
      const runtime = buildInfo();

      if (fs.existsSync(receiptPath)) {
        operationStage = 'idempotent-open';
        sourceHandle = openSourceDatabase();
        assertBoundSourceHandle(sourceHandle);
        const receipt = readPrivateJsonFile(receiptPath);
        validateCompletedReceipt({ receipt, requestNonce, runtime, dbPath, sourceHandle });
        return res.status(200).json(responseFromReceipt(receipt, fileSha256(receiptPath), true));
      }
      if (fs.existsSync(operationLockPath)) {
        fail('PRE_COMPATIBILITY_BACKUP_OPERATION_LOCKED', 'A prior preliminary backup attempt already owns the one-shot lock.');
      }

      const operationId = randomUUID();
      if (!UUID_PATTERN.test(operationId)) {
        fail('PRE_COMPATIBILITY_BACKUP_OPERATION_ID_INVALID', 'A valid preliminary backup operation ID is required.');
      }
      const startedAt = now();
      if (!(startedAt instanceof Date) || !Number.isFinite(startedAt.getTime())) {
        fail('PRE_COMPATIBILITY_BACKUP_TIME_INVALID', 'A valid preliminary backup time is required.');
      }
      createExclusiveDurableFile(operationLockPath, Buffer.from(`${JSON.stringify({
        lockVersion: 1,
        operationId,
        requestNonce,
        startedAt: startedAt.toISOString(),
        runtime,
      }, null, 2)}\n`));

      sourceHandle = openSourceDatabase();
      operationStage = 'source-open';
      assertBoundSourceHandle(sourceHandle);
      if (!sameSourceIdentity(startupSourceIdentity, sourceHandle.sourceIdentity)) {
        fail('PRE_COMPATIBILITY_BACKUP_SOURCE_IDENTITY_CHANGED', 'The SQLite source identity changed after runtime startup.');
      }
      const db = sourceHandle.db;
      if (db.pragma('query_only', { simple: true }) !== 1 || db.readonly !== true) {
        fail('PRE_COMPATIBILITY_BACKUP_SOURCE_NOT_READ_ONLY', 'The SQLite source is not read-only and query-only.');
      }
      const totalChangesBefore = Number(db.prepare('SELECT total_changes() AS count').get().count);
      if (totalChangesBefore !== 0) {
        fail('PRE_COMPATIBILITY_BACKUP_SOURCE_CONNECTION_CHANGED', 'The fresh source connection already reports writes.');
      }
      const sourceStateBeforeTransaction = captureSqliteSourceState({
        dbPath,
        sourceFd: sourceHandle.sourceFd,
        sourceIdentity: sourceHandle.sourceIdentity,
      });
      db.exec('BEGIN');
      transactionStarted = true;
      db.prepare('SELECT COUNT(*) AS count FROM sqlite_master').get();
      const sourceStateBefore = captureSqliteSourceState({
        dbPath,
        sourceFd: sourceHandle.sourceFd,
        sourceIdentity: sourceHandle.sourceIdentity,
      });
      if (!durableSourceStateEqual(sourceStateBeforeTransaction, sourceStateBefore)) {
        fail(
          'PRE_COMPATIBILITY_BACKUP_SOURCE_CHANGED',
          'The durable SQLite source changed while the coherent read snapshot was established.',
        );
      }
      operationStage = 'snapshot-established';
      backup = await createFullBackupArchive({
        readData: () => [],
        dbPath,
        createDatabaseBackup: targetPath => db.backup(targetPath),
        collections: [],
        buildInfo: runtime,
        now: startedAt,
      });
      operationStage = 'archive-created';
      if (backup.manifest?.database?.includedAs !== 'database/app.sqlite') {
        fail('PRE_COMPATIBILITY_BACKUP_DATABASE_MISSING', 'The backup omitted the coherent SQLite snapshot.');
      }
      if (Number(backup.manifest?.skippedFilesCount) !== 0) {
        fail('PRE_COMPATIBILITY_BACKUP_FILES_SKIPPED', 'The backup skipped one or more business files.');
      }
      const validation = validatePreCompatibilityBackup({
        sourceDb: db,
        sourceDbPath: dbPath,
        backupPath: backup.path,
      });
      operationStage = 'temporary-archive-validated';
      const filename = `skytech-pre-clean-reset-${backupTimestamp(startedAt)}.zip`;
      outputPath = backupOutputPath(dbPath, filename);
      const outputStat = publishAtomicFile(backup.path, outputPath, operationId);
      operationStage = 'archive-published';
      published = true;
      const archiveSha256BeforeValidation = fileSha256(outputPath);
      const publishedValidation = validatePreCompatibilityBackup({
        sourceDb: db,
        sourceDbPath: dbPath,
        backupPath: outputPath,
      });
      operationStage = 'published-archive-validated';
      const archiveSha256 = fileSha256(outputPath);
      if (
        archiveSha256 !== archiveSha256BeforeValidation
        || publishedValidation.logicalDatabaseSha256 !== validation.logicalDatabaseSha256
        || publishedValidation.extractedDatabaseSha256 !== validation.extractedDatabaseSha256
        || publishedValidation.extractedDatabaseSize !== validation.extractedDatabaseSize
      ) {
        fail('PRE_COMPATIBILITY_BACKUP_ARCHIVE_CHANGED', 'The published preliminary backup changed during validation.');
      }

      const sourceStateBeforeCommit = captureSqliteSourceState({
        dbPath,
        sourceFd: sourceHandle.sourceFd,
        sourceIdentity: sourceHandle.sourceIdentity,
      });
      if (!durableSourceStateEqual(sourceStateBefore, sourceStateBeforeCommit)) {
        fail('PRE_COMPATIBILITY_BACKUP_SOURCE_CHANGED', 'The durable SQLite source changed during backup creation.');
      }
      db.exec('COMMIT');
      transactionStarted = false;
      operationStage = 'source-committed';
      assertBoundSourceHandle(sourceHandle);
      const sourceStateAfterCommit = captureSqliteSourceState({
        dbPath,
        sourceFd: sourceHandle.sourceFd,
        sourceIdentity: sourceHandle.sourceIdentity,
      });
      const totalChangesAfter = Number(db.prepare('SELECT total_changes() AS count').get().count);
      const sourceStateAfter = captureSqliteSourceState({
        dbPath,
        sourceFd: sourceHandle.sourceFd,
        sourceIdentity: sourceHandle.sourceIdentity,
      });
      assertBoundSourceHandle(sourceHandle);
      if (
        !durableSourceStateEqual(sourceStateBefore, sourceStateAfterCommit)
        || !durableSourceStateEqual(sourceStateAfterCommit, sourceStateAfter)
        || totalChangesAfter !== totalChangesBefore
      ) {
        fail('PRE_COMPATIBILITY_BACKUP_SOURCE_CHANGED', 'The durable SQLite source changed before backup publication completed.');
      }

      const archive = {
        filename,
        size: outputStat.size,
        sha256: archiveSha256,
        generatedAt: startedAt.toISOString(),
        databaseIncludedAs: backup.manifest.database.includedAs,
        collectionCounts: backup.manifest.counts || {},
        includedFilesCount: backup.manifest.includedFilesCount || 0,
        skippedFilesCount: 0,
        businessFileCount: publishedValidation.businessFileCount,
        businessFileInventorySha256: publishedValidation.businessFileInventorySha256,
        databaseFileSha256: publishedValidation.extractedDatabaseSha256,
        databaseFileSize: publishedValidation.extractedDatabaseSize,
        databaseIntegrity: publishedValidation.databaseIntegrity,
        databaseForeignKeyViolations: publishedValidation.databaseForeignKeyViolations,
        logicalDatabaseSha256: publishedValidation.logicalDatabaseSha256,
      };
      const receipt = {
        receiptVersion: 1,
        purpose: 'pre-schema-compatibility-production-backup',
        status: 'COMPLETE',
        operationId,
        requestNonce,
        createdAt: new Date().toISOString(),
        runtime,
        source: {
          identity: sourceHandle.sourceIdentity,
          queryOnly: true,
          totalChangesBefore,
          totalChangesAfter,
          durableStateUnchanged: true,
          before: sourceStateBefore,
          after: sourceStateAfter,
        },
        archive,
      };
      const receiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
      const receiptSha256 = crypto.createHash('sha256').update(receiptBytes).digest('hex');
      const response = responseFromReceipt(receipt, receiptSha256, false);
      publishAtomicBuffer(receiptPath, receiptBytes, operationId, () => {
        receiptCommitted = true;
      });
      operationStage = 'receipt-published';
      return res.status(201).json(response);
    } catch (error) {
      if (transactionStarted) {
        try { sourceHandle?.db?.exec('ROLLBACK'); } catch { /* original error wins */ }
      }
      if (!receiptCommitted && published && outputPath && fs.existsSync(outputPath)) {
        try {
          fs.rmSync(outputPath, { force: false });
          fsyncDirectory(path.dirname(outputPath));
          published = false;
        } catch { /* persistent lock still prevents unsafe retry */ }
      }
      process.stderr.write(`${JSON.stringify({
        event: 'pre_compatibility_backup_failed',
        stage: operationStage,
        code: typeof error?.code === 'string' ? error.code : 'PRE_COMPATIBILITY_BACKUP_FAILED',
      })}\n`);
      return res.status(409).json({ ok: false, error: 'Preliminary backup failed.' });
    } finally {
      try { sourceHandle?.close(); } catch { /* request outcome is already fixed */ }
      if (!published && outputPath && fs.existsSync(outputPath)) {
        try { fs.rmSync(outputPath, { force: true }); } catch { /* persistent lock prevents reuse */ }
      }
      try { if (backup) cleanupBackupArchive(backup); } catch { /* durable outcome must not be replaced by temp cleanup */ }
      operationInFlight = false;
    }
  }

  return { handleBackup, requireBackupCapability };
}

function registerPreCompatibilityBackupRoute(router, options) {
  const { handleBackup, requireBackupCapability } = createPreCompatibilityBackupHandlers(options);
  router.post('/admin/skytech-pre-compatibility-backup', requireBackupCapability, handleBackup);
}

function registerPreCompatibilityBackupControlRoutes(router, { coordinator, ...options }) {
  if (
    !coordinator
    || typeof coordinator.start !== 'function'
    || typeof coordinator.status !== 'function'
  ) {
    fail('PRE_COMPATIBILITY_BACKUP_COORDINATOR_INVALID', 'A preliminary backup coordinator is required.');
  }
  const { requireBackupCapability } = createPreCompatibilityBackupHandlers(options);
  const endpoint = '/admin/skytech-pre-compatibility-backup';

  router.post(endpoint, requireBackupCapability, (req, res) => {
    try {
      const operation = coordinator.start(req.preCompatibilityBackupNonce);
      return res.status(202).json({
        ok: true,
        status: 'RUNNING',
        invocationId: operation.invocationId,
        requestNonce: operation.requestNonce,
        reused: operation.reused,
      });
    } catch (error) {
      process.stderr.write(`${JSON.stringify({
        event: 'pre_compatibility_backup_start_rejected',
        code: typeof error?.code === 'string' ? error.code : 'PRE_COMPATIBILITY_BACKUP_START_FAILED',
      })}\n`);
      return res.status(409).json({ ok: false, error: 'Preliminary backup could not start.' });
    }
  });

  router.get(`${endpoint}/status`, requireBackupCapability, (req, res) => {
    const invocationId = String(req.headers['x-skytech-pre-compatibility-backup-invocation-id'] || '');
    if (!UUID_PATTERN.test(invocationId)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    const operation = coordinator.status({
      requestNonce: req.preCompatibilityBackupNonce,
      invocationId,
    });
    if (!operation) return res.status(404).json({ ok: false, error: 'Not found' });
    if (operation.status === 'RUNNING') {
      return res.status(202).json({
        ok: true,
        status: 'RUNNING',
        invocationId,
        requestNonce: operation.requestNonce,
      });
    }
    if (operation.status !== 'COMPLETE' || !operation.body) {
      return res.status(409).json({ ok: false, error: 'Preliminary backup failed.' });
    }
    return res.status(200).json({
      ...operation.body,
      invocationId,
      workerStatusCode: operation.statusCode,
    });
  });
}

async function executePreCompatibilityBackup({ requestNonce, ...options }) {
  if (!UUID_PATTERN.test(String(requestNonce || ''))) {
    fail('PRE_COMPATIBILITY_BACKUP_NONCE_INVALID', 'A valid preliminary backup request nonce is required.');
  }
  const { handleBackup } = createPreCompatibilityBackupHandlers(options);
  let statusCode = 200;
  let responseBody;
  const response = {
    status(value) {
      statusCode = value;
      return this;
    },
    json(value) {
      responseBody = value;
      return value;
    },
  };
  await handleBackup({ preCompatibilityBackupNonce: requestNonce }, response);
  if (!Number.isSafeInteger(statusCode) || responseBody === undefined) {
    fail('PRE_COMPATIBILITY_BACKUP_RESPONSE_INVALID', 'The preliminary backup worker produced no response.');
  }
  return { statusCode, body: responseBody };
}

module.exports = {
  OPERATION_LOCK_FILENAME,
  RECEIPT_FILENAME,
  backupDirectoryPath,
  backupOutputPath,
  backupTimestamp,
  executePreCompatibilityBackup,
  registerPreCompatibilityBackupControlRoutes,
  registerPreCompatibilityBackupRoute,
};
