'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
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
  validateHistoricalPreCompatibilityBackup,
  validatePreCompatibilityBackup,
} = require('../lib/pre-compatibility-backup');

const OPERATION_LOCK_FILENAME = '.skytech-pre-compatibility-backup.lock.json';
const RECEIPT_FILENAME = 'skytech-pre-compatibility-backup-receipt.json';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_COMMIT_PATTERN = /^[a-f0-9]{40}$/;
const SOURCE_COMMIT_HEADER = 'x-skytech-pre-compatibility-backup-source-commit';
const MAX_RECEIPT_BYTES = 4 * 1024 * 1024;
const UNSUPPORTED_ARTIFACT_REQUEST_HEADERS = Object.freeze([
  'range',
  'if-range',
  'if-match',
  'if-none-match',
  'if-modified-since',
  'if-unmodified-since',
  'transfer-encoding',
]);

function fail(code, message) {
  throw Object.assign(new Error(message), { code });
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ''));
  const b = Buffer.from(String(right || ''));
  return a.length > 0 && a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isRawIdentifier(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= 128
    && value === value.trim()
    && /^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value);
}

function isHistoricalReceiptRuntime(runtime, sourceCommit) {
  const startedAt = String(runtime?.startedAt || '');
  return Boolean(
    runtime
    && SOURCE_COMMIT_PATTERN.test(String(runtime.commitFull || ''))
    && safeEqual(runtime.commitFull, sourceCommit)
    && runtime.commit === runtime.commitFull.slice(0, 7)
    && ['backend', 'full-stack'].includes(runtime.releaseType)
    && runtime.release?.type === runtime.releaseType
    && startedAt.length > 0
    && !Number.isNaN(Date.parse(startedAt))
    && new Date(startedAt).toISOString() === startedAt
    && isRawIdentifier(runtime.deployment?.railwayDeploymentId)
    && runtime.deployment?.railwayEnvironment === 'production'
    && runtime.deployment?.railwayService === 'rental-management'
    && isRawIdentifier(runtime.deployment?.railwayReplicaId)
  );
}

function isCanonicalIsoTimestamp(value) {
  const text = String(value || '');
  return text.length > 0
    && !Number.isNaN(Date.parse(text))
    && new Date(text).toISOString() === text;
}

function isHistoricalSourceFileState(state, { allowMissing = false } = {}) {
  if (allowMissing && state?.exists === false && Object.keys(state).length === 1) return true;
  return Boolean(
    state?.exists === true
    && typeof state.dev === 'string'
    && /^(?:0|[1-9][0-9]*)$/.test(state.dev)
    && typeof state.ino === 'string'
    && /^(?:0|[1-9][0-9]*)$/.test(state.ino)
    && typeof state.mode === 'string'
    && /^(?:0|[1-9][0-9]*)$/.test(state.mode)
    && state.nlink === '1'
    && Number.isSafeInteger(state.size)
    && state.size >= 0
    && typeof state.mtimeMs === 'string'
    && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(state.mtimeMs)
    && typeof state.ctimeMs === 'string'
    && /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(state.ctimeMs)
    && SHA256_PATTERN.test(String(state.sha256 || ''))
  );
}

function isHistoricalSourceState(state) {
  return Boolean(
    state
    && isHistoricalSourceFileState(state.database)
    && isHistoricalSourceFileState(state.wal, { allowMissing: true })
    && isHistoricalSourceFileState(state.shm, { allowMissing: true })
  );
}

function setArtifactResponseSecurityHeaders(_req, res, next) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  next();
}

function backupTimestamp(date = new Date()) {
  return date.toISOString().replace(/\.\d{3}Z$/, 'Z').replace(/[-:]/g, '');
}

function sameStatIdentity(left, right) {
  return left?.dev === right?.dev && left?.ino === right?.ino;
}

function sameArtifactState(left, right) {
  return Boolean(
    left
    && right
    && left.dev === right.dev
    && left.ino === right.ino
    && left.mode === right.mode
    && left.nlink === right.nlink
    && left.uid === right.uid
    && left.gid === right.gid
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs
    && left.ctimeMs === right.ctimeMs,
  );
}

function isPrivateArtifactFile(stat, effectiveUid) {
  return Boolean(
    stat?.isFile?.()
    && !stat.isSymbolicLink?.()
    && stat.nlink === 1
    && stat.uid === effectiveUid
    && (stat.mode & 0o7777) === 0o600
    && Number.isSafeInteger(stat.size)
    && stat.size > 0,
  );
}

function assertPrivateArtifactHandle(handle) {
  const descriptorStat = fs.fstatSync(handle.fd);
  const pathStat = fs.lstatSync(handle.filePath);
  if (
    !isPrivateArtifactFile(descriptorStat, handle.effectiveUid)
    || !isPrivateArtifactFile(pathStat, handle.effectiveUid)
    || !sameArtifactState(handle.initialStat, descriptorStat)
    || !sameArtifactState(handle.initialStat, pathStat)
  ) {
    fail('PRE_COMPATIBILITY_BACKUP_ARTIFACT_CHANGED', 'The preliminary backup artifact changed while bound.');
  }
  return descriptorStat;
}

function openPrivateArtifactFile(filePath, { expectedSize, maxSize } = {}) {
  const effectiveUid = typeof process.geteuid === 'function' ? process.geteuid() : null;
  if (!Number.isSafeInteger(effectiveUid) || effectiveUid < 0) {
    fail('PRE_COMPATIBILITY_BACKUP_ARTIFACT_UNSAFE', 'The preliminary backup artifact owner is unavailable.');
  }
  const pathStat = fs.lstatSync(filePath);
  if (
    !isPrivateArtifactFile(pathStat, effectiveUid)
    || (expectedSize !== undefined && pathStat.size !== expectedSize)
    || (maxSize !== undefined && pathStat.size > maxSize)
  ) {
    fail('PRE_COMPATIBILITY_BACKUP_ARTIFACT_UNSAFE', 'The preliminary backup artifact is unsafe.');
  }
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const handle = { effectiveUid, fd, filePath, initialStat: pathStat };
  try {
    assertPrivateArtifactHandle(handle);
    return handle;
  } catch (error) {
    fs.closeSync(fd);
    throw error;
  }
}

function closeArtifactHandle(handle) {
  if (!handle || handle.fd === undefined) return;
  const fd = handle.fd;
  handle.fd = undefined;
  fs.closeSync(fd);
}

function readArtifactBytes(handle, maxSize) {
  const stat = assertPrivateArtifactHandle(handle);
  if (stat.size > maxSize) {
    fail('PRE_COMPATIBILITY_BACKUP_ARTIFACT_UNSAFE', 'The preliminary backup artifact is too large.');
  }
  const bytes = Buffer.alloc(stat.size);
  let position = 0;
  while (position < bytes.length) {
    const bytesRead = fs.readSync(handle.fd, bytes, position, bytes.length - position, position);
    if (bytesRead === 0) {
      fail('PRE_COMPATIBILITY_BACKUP_ARTIFACT_CHANGED', 'The preliminary backup artifact changed while reading.');
    }
    position += bytesRead;
  }
  assertPrivateArtifactHandle(handle);
  return bytes;
}

function hashArtifactHandle(handle) {
  const stat = assertPrivateArtifactHandle(handle);
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (position < stat.size) {
    const bytesRead = fs.readSync(
      handle.fd,
      buffer,
      0,
      Math.min(buffer.length, stat.size - position),
      position,
    );
    if (bytesRead === 0) {
      fail('PRE_COMPATIBILITY_BACKUP_ARTIFACT_CHANGED', 'The preliminary backup artifact changed while hashing.');
    }
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  assertPrivateArtifactHandle(handle);
  return hash.digest('hex');
}

function snapshotArtifactHandle(handle) {
  const sourceStat = assertPrivateArtifactHandle(handle);
  const tempDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'skytech-historical-artifact-'));
  const snapshotPath = path.join(tempDirectory, 'archive.zip');
  let snapshotFd;
  try {
    const tempDirectoryStat = fs.lstatSync(tempDirectory);
    if (
      !tempDirectoryStat.isDirectory()
      || tempDirectoryStat.isSymbolicLink()
      || tempDirectoryStat.uid !== sourceStat.uid
      || (tempDirectoryStat.mode & 0o7777) !== 0o700
    ) {
      fail(
        'PRE_COMPATIBILITY_BACKUP_ARTIFACT_UNSAFE',
        'The preliminary backup validation directory is unsafe.',
      );
    }
    snapshotFd = fs.openSync(
      snapshotPath,
      fs.constants.O_WRONLY
        | fs.constants.O_CREAT
        | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    fs.fchmodSync(snapshotFd, 0o600);
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < sourceStat.size) {
      const bytesRead = fs.readSync(
        handle.fd,
        buffer,
        0,
        Math.min(buffer.length, sourceStat.size - position),
        position,
      );
      if (bytesRead === 0) {
        fail(
          'PRE_COMPATIBILITY_BACKUP_ARTIFACT_CHANGED',
          'The preliminary backup artifact changed while being snapshotted.',
        );
      }
      let written = 0;
      while (written < bytesRead) {
        written += fs.writeSync(
          snapshotFd,
          buffer,
          written,
          bytesRead - written,
          position + written,
        );
      }
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    fs.fsyncSync(snapshotFd);
    const snapshotStat = fs.fstatSync(snapshotFd);
    const snapshotPathStat = fs.lstatSync(snapshotPath);
    if (
      !isPrivateArtifactFile(snapshotStat, sourceStat.uid)
      || !isPrivateArtifactFile(snapshotPathStat, sourceStat.uid)
      || !sameArtifactState(snapshotStat, snapshotPathStat)
      || snapshotStat.size !== sourceStat.size
    ) {
      fail(
        'PRE_COMPATIBILITY_BACKUP_ARTIFACT_UNSAFE',
        'The preliminary backup validation snapshot is unsafe.',
      );
    }
    assertPrivateArtifactHandle(handle);
    fs.closeSync(snapshotFd);
    snapshotFd = undefined;
    let cleaned = false;
    return {
      cleanup() {
        if (cleaned) return;
        cleaned = true;
        fs.rmSync(tempDirectory, { recursive: true, force: true });
      },
      path: snapshotPath,
      sha256: hash.digest('hex'),
      size: snapshotStat.size,
    };
  } catch (error) {
    if (snapshotFd !== undefined) {
      try { fs.closeSync(snapshotFd); } catch { /* original error wins */ }
    }
    try { fs.rmSync(tempDirectory, { recursive: true, force: true }); } catch { /* original error wins */ }
    throw error;
  }
}

function isOwnedStableDirectory(stat, { effectiveUid, device } = {}) {
  return Boolean(
    stat?.isDirectory?.()
    && !stat.isSymbolicLink?.()
    && stat.uid === effectiveUid
    && (device === undefined || stat.dev === device)
    && (stat.mode & 0o7000) === 0
    && (stat.mode & 0o700) === 0o700
    && (stat.mode & 0o022) === 0,
  );
}

function backupDirectoryPath(dbPath) {
  const databaseDirectory = path.dirname(path.resolve(dbPath));
  const backupDirectory = path.join(databaseDirectory, 'backups');
  const effectiveUid = typeof process.geteuid === 'function' ? process.geteuid() : null;
  let parentFd;
  let directoryFd;
  try {
    if (!Number.isSafeInteger(effectiveUid) || effectiveUid < 0) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The effective backup runtime owner is unavailable.');
    }
    const parentPathStat = fs.lstatSync(databaseDirectory);
    if (
      !isOwnedStableDirectory(parentPathStat, { effectiveUid })
      || fs.realpathSync(databaseDirectory) !== databaseDirectory
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup parent directory is unsafe.');
    }
    parentFd = fs.openSync(
      databaseDirectory,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY || 0)
        | (fs.constants.O_NOFOLLOW || 0),
    );
    const parentOpenedStat = fs.fstatSync(parentFd);
    if (
      !isOwnedStableDirectory(parentOpenedStat, { effectiveUid })
      || !sameStatIdentity(parentPathStat, parentOpenedStat)
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup parent directory changed before opening.');
    }

    let directoryStat;
    try {
      directoryStat = fs.lstatSync(backupDirectory);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      fs.mkdirSync(backupDirectory, { recursive: false, mode: 0o700 });
      fs.fsyncSync(parentFd);
      directoryStat = fs.lstatSync(backupDirectory);
    }
    if (
      !isOwnedStableDirectory(directoryStat, { effectiveUid, device: parentOpenedStat.dev })
      || fs.realpathSync(backupDirectory) !== backupDirectory
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup directory is unsafe.');
    }
    directoryFd = fs.openSync(
      backupDirectory,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY || 0)
        | (fs.constants.O_NOFOLLOW || 0),
    );
    const openedStat = fs.fstatSync(directoryFd);
    if (
      !isOwnedStableDirectory(openedStat, { effectiveUid, device: parentOpenedStat.dev })
      || !sameStatIdentity(directoryStat, openedStat)
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup directory changed before opening.');
    }
    if ((openedStat.mode & 0o777) !== 0o700) {
      fs.fchmodSync(directoryFd, 0o700);
    }
    fs.fsyncSync(directoryFd);
    const privateStat = fs.fstatSync(directoryFd);
    if (
      !isOwnedStableDirectory(privateStat, { effectiveUid, device: parentOpenedStat.dev })
      || !sameStatIdentity(openedStat, privateStat)
      || (privateStat.mode & 0o777) !== 0o700
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup directory is not private.');
    }

    const pathStat = fs.lstatSync(backupDirectory);
    const parentPathStatAfter = fs.lstatSync(databaseDirectory);
    if (
      !isOwnedStableDirectory(pathStat, { effectiveUid, device: parentOpenedStat.dev })
      || !sameStatIdentity(privateStat, pathStat)
      || (pathStat.mode & 0o777) !== 0o700
      || fs.realpathSync(backupDirectory) !== backupDirectory
      || !isOwnedStableDirectory(parentPathStatAfter, { effectiveUid })
      || !sameStatIdentity(parentOpenedStat, parentPathStatAfter)
      || fs.realpathSync(databaseDirectory) !== databaseDirectory
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup directory changed after securing.');
    }
    return backupDirectory;
  } catch (error) {
    if (error?.code === 'PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE') throw error;
    fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup directory could not be secured.');
  } finally {
    if (directoryFd !== undefined) {
      try { fs.closeSync(directoryFd); } catch { /* directory validation already has an authoritative result */ }
    }
    if (parentFd !== undefined) {
      try { fs.closeSync(parentFd); } catch { /* directory validation already has an authoritative result */ }
    }
  }
}

function existingPrivateBackupDirectoryPath(dbPath) {
  const databaseDirectory = path.dirname(path.resolve(dbPath));
  const backupDirectory = path.join(databaseDirectory, 'backups');
  const effectiveUid = typeof process.geteuid === 'function' ? process.geteuid() : null;
  let parentFd;
  let directoryFd;
  try {
    if (!Number.isSafeInteger(effectiveUid) || effectiveUid < 0) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The effective backup runtime owner is unavailable.');
    }
    const parentPathStat = fs.lstatSync(databaseDirectory);
    if (
      !isOwnedStableDirectory(parentPathStat, { effectiveUid })
      || fs.realpathSync(databaseDirectory) !== databaseDirectory
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup parent directory is unsafe.');
    }
    parentFd = fs.openSync(
      databaseDirectory,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY || 0)
        | (fs.constants.O_NOFOLLOW || 0),
    );
    const parentOpenedStat = fs.fstatSync(parentFd);
    if (
      !isOwnedStableDirectory(parentOpenedStat, { effectiveUid })
      || !sameStatIdentity(parentPathStat, parentOpenedStat)
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup parent directory changed before opening.');
    }
    const directoryStat = fs.lstatSync(backupDirectory);
    if (
      !isOwnedStableDirectory(directoryStat, { effectiveUid, device: parentOpenedStat.dev })
      || (directoryStat.mode & 0o777) !== 0o700
      || fs.realpathSync(backupDirectory) !== backupDirectory
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup directory is unsafe.');
    }
    directoryFd = fs.openSync(
      backupDirectory,
      fs.constants.O_RDONLY
        | (fs.constants.O_DIRECTORY || 0)
        | (fs.constants.O_NOFOLLOW || 0),
    );
    const openedStat = fs.fstatSync(directoryFd);
    if (
      !isOwnedStableDirectory(openedStat, { effectiveUid, device: parentOpenedStat.dev })
      || !sameStatIdentity(directoryStat, openedStat)
      || (openedStat.mode & 0o777) !== 0o700
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup directory changed before opening.');
    }
    const pathStatAfter = fs.lstatSync(backupDirectory);
    const parentPathStatAfter = fs.lstatSync(databaseDirectory);
    if (
      !sameStatIdentity(openedStat, pathStatAfter)
      || !isOwnedStableDirectory(pathStatAfter, { effectiveUid, device: parentOpenedStat.dev })
      || (pathStatAfter.mode & 0o777) !== 0o700
      || fs.realpathSync(backupDirectory) !== backupDirectory
      || !sameStatIdentity(parentOpenedStat, parentPathStatAfter)
      || !isOwnedStableDirectory(parentPathStatAfter, { effectiveUid })
      || fs.realpathSync(databaseDirectory) !== databaseDirectory
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup directory changed while binding.');
    }
    return backupDirectory;
  } catch (error) {
    if (error?.code === 'PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE') throw error;
    fail('PRE_COMPATIBILITY_BACKUP_DIRECTORY_UNSAFE', 'The preliminary backup directory could not be opened safely.');
  } finally {
    if (directoryFd !== undefined) {
      try { fs.closeSync(directoryFd); } catch { /* directory validation already has an authoritative result */ }
    }
    if (parentFd !== undefined) {
      try { fs.closeSync(parentFd); } catch { /* directory validation already has an authoritative result */ }
    }
  }
}

function backupArchivePath(backupDirectory, filename) {
  if (!/^skytech-pre-clean-reset-\d{8}T\d{6}Z\.zip$/.test(filename)) {
    fail('PRE_COMPATIBILITY_BACKUP_FILENAME_INVALID', 'Invalid preliminary backup filename.');
  }
  return path.join(backupDirectory, filename);
}

function backupOutputPath(dbPath, filename) {
  return backupArchivePath(backupDirectoryPath(dbPath), filename);
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
  let outputStat;
  try {
    fs.fchmodSync(fd, 0o600);
    writeAll(fd, bytes);
    fs.fsyncSync(fd);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || stat.nlink !== 1 || stat.size !== bytes.length || (stat.mode & 0o7777) !== 0o600) {
      fail('PRE_COMPATIBILITY_BACKUP_OUTPUT_UNSAFE', 'A preliminary backup control file is unsafe.');
    }
    outputStat = stat;
  } finally {
    fs.closeSync(fd);
  }
  fsyncDirectory(path.dirname(filePath));
  return outputStat;
}

function linkExclusive(sourcePath, finalPath) {
  try {
    fs.linkSync(sourcePath, finalPath);
  } catch (error) {
    if (error?.code === 'EEXIST') {
      fail('PRE_COMPATIBILITY_BACKUP_ALREADY_EXISTS', 'A preliminary backup output already exists.');
    }
    throw error;
  }
}

function publishAtomicBuffer(finalPath, bytes, operationId) {
  if (fs.existsSync(finalPath)) {
    fail('PRE_COMPATIBILITY_BACKUP_ALREADY_EXISTS', 'A preliminary backup output already exists.');
  }
  const temporaryPath = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${operationId}.tmp`);
  const temporaryStat = createExclusiveDurableFile(temporaryPath, bytes);
  if (fs.existsSync(finalPath)) {
    fail('PRE_COMPATIBILITY_BACKUP_ALREADY_EXISTS', 'A preliminary backup output already exists.');
  }
  linkExclusive(temporaryPath, finalPath);
  fs.unlinkSync(temporaryPath);
  fsyncDirectory(path.dirname(finalPath));
  const stat = fs.lstatSync(finalPath);
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.nlink !== 1
    || (stat.mode & 0o7777) !== 0o600
    || !sameStatIdentity(stat, temporaryStat)
    || stat.size !== temporaryStat.size
    || stat.uid !== temporaryStat.uid
  ) {
    fail('PRE_COMPATIBILITY_BACKUP_OUTPUT_UNSAFE', 'The published preliminary backup output is unsafe.');
  }
  return stat;
}

function publishAtomicFile(sourcePath, finalPath, operationId) {
  const before = fs.lstatSync(sourcePath);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1) {
    fail('PRE_COMPATIBILITY_BACKUP_ARCHIVE_UNSAFE', 'The temporary preliminary backup archive is unsafe.');
  }
  const sourceFd = fs.openSync(sourcePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const temporaryPath = path.join(path.dirname(finalPath), `.${path.basename(finalPath)}.${operationId}.tmp`);
  let targetFd;
  let targetIdentity;
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
      || (targetStat.mode & 0o7777) !== 0o600
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_ARCHIVE_CHANGED', 'The preliminary backup archive changed before publication.');
    }
    targetIdentity = targetStat;
    fs.closeSync(targetFd);
    targetFd = undefined;
    fs.closeSync(sourceFd);
    if (fs.existsSync(finalPath)) {
      fail('PRE_COMPATIBILITY_BACKUP_ALREADY_EXISTS', 'A preliminary backup output already exists.');
    }
    linkExclusive(temporaryPath, finalPath);
    fs.unlinkSync(temporaryPath);
    fsyncDirectory(path.dirname(finalPath));
    const finalStat = fs.lstatSync(finalPath);
    if (
      !finalStat.isFile()
      || finalStat.isSymbolicLink()
      || finalStat.nlink !== 1
      || finalStat.size !== size
      || (finalStat.mode & 0o7777) !== 0o600
      || !sameStatIdentity(finalStat, targetIdentity)
      || finalStat.uid !== targetIdentity.uid
    ) {
      fail('PRE_COMPATIBILITY_BACKUP_OUTPUT_UNSAFE', 'The published preliminary backup archive is unsafe.');
    }
    return finalStat;
  } finally {
    if (targetFd !== undefined) fs.closeSync(targetFd);
    try { fs.closeSync(sourceFd); } catch { /* it may already be closed after successful copy */ }
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

function validateCompletedReceipt({
  receipt,
  requestNonce,
  runtime,
  sourceCommit,
  dbPath,
  sourceHandle,
  startupSourceIdentity,
  archiveHandle,
  resolvedArchivePath,
}) {
  assertBoundSourceHandle(sourceHandle);
  const receiptSourceCommit = String(receipt?.runtime?.commitFull || '');
  const historicalRuntimeMatches = runtime === undefined
    && SOURCE_COMMIT_PATTERN.test(String(sourceCommit || ''))
    && isHistoricalReceiptRuntime(receipt?.runtime, sourceCommit);
  if (
    receipt?.receiptVersion !== 1
    || receipt?.purpose !== 'pre-schema-compatibility-production-backup'
    || receipt?.status !== 'COMPLETE'
    || !safeEqual(receipt?.requestNonce, requestNonce)
    || !UUID_PATTERN.test(String(receipt?.operationId || ''))
    || (runtime === undefined
      ? !historicalRuntimeMatches
      : JSON.stringify(receipt.runtime) !== JSON.stringify(runtime))
    || (startupSourceIdentity && !sameSourceIdentity(startupSourceIdentity, sourceHandle.sourceIdentity))
    || !sameSourceIdentity(receipt?.source?.identity, sourceHandle.sourceIdentity)
    || receipt?.source?.queryOnly !== true
    || receipt?.source?.totalChangesBefore !== 0
    || receipt?.source?.totalChangesAfter !== 0
    || receipt?.source?.durableStateUnchanged !== true
    || !durableSourceStateEqual(receipt?.source?.before, receipt?.source?.after)
    || !Number.isSafeInteger(receipt?.archive?.size)
    || receipt.archive.size <= 0
    || !SHA256_PATTERN.test(String(receipt?.archive?.sha256 || ''))
    || !SHA256_PATTERN.test(String(receipt?.archive?.logicalDatabaseSha256 || ''))
    || !SHA256_PATTERN.test(String(receipt?.archive?.databaseFileSha256 || ''))
    || !SHA256_PATTERN.test(String(receipt?.archive?.businessFileInventorySha256 || ''))
  ) {
    fail('PRE_COMPATIBILITY_BACKUP_RECEIPT_MISMATCH', 'The completed preliminary backup receipt does not match this request.');
  }
  const expectedArchivePath = backupArchivePath(
    path.join(path.dirname(path.resolve(dbPath)), 'backups'),
    receipt.archive?.filename,
  );
  const archivePath = resolvedArchivePath === undefined
    ? backupOutputPath(dbPath, receipt.archive?.filename)
    : resolvedArchivePath;
  if (archivePath !== expectedArchivePath) {
    fail('PRE_COMPATIBILITY_BACKUP_ARCHIVE_MISMATCH', 'The completed preliminary backup archive path is invalid.');
  }
  const archiveStat = fs.lstatSync(archivePath);
  const archiveSha256BeforeValidation = archiveHandle
    ? hashArtifactHandle(archiveHandle)
    : fileSha256(archivePath);
  if (
    !archiveStat.isFile()
    || archiveStat.isSymbolicLink()
    || archiveStat.nlink !== 1
    || archiveStat.size !== receipt.archive.size
    || (archiveHandle && (
      archiveHandle.filePath !== archivePath
      || !sameArtifactState(archiveHandle.initialStat, archiveStat)
    ))
    || archiveSha256BeforeValidation !== receipt.archive.sha256
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
    const archiveSha256AfterValidation = archiveHandle
      ? hashArtifactHandle(archiveHandle)
      : fileSha256(archivePath);
    if (
      totalChangesBefore !== 0
      || totalChangesAfter !== totalChangesBefore
      || !durableSourceStateEqual(stateAtSnapshot, currentState)
      || !durableSourceStateEqual(receipt.source.after, currentState)
      || archiveSha256AfterValidation !== archiveSha256BeforeValidation
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
  return {
    archivePath,
    archiveSha256: archiveSha256BeforeValidation,
    sourceCommit: receiptSourceCommit,
  };
}

function validateHistoricalArtifactReceipt({
  receipt,
  requestNonce,
  sourceCommit,
  dbPath,
  archiveHandle,
  resolvedArchivePath,
}) {
  const receiptSourceCommit = String(receipt?.runtime?.commitFull || '');
  const sourceIdentity = receipt?.source?.identity;
  const collectionCounts = receipt?.archive?.collectionCounts;
  if (
    receipt?.receiptVersion !== 1
    || receipt?.purpose !== 'pre-schema-compatibility-production-backup'
    || receipt?.status !== 'COMPLETE'
    || !safeEqual(receipt?.requestNonce, requestNonce)
    || !UUID_PATTERN.test(String(receipt?.operationId || ''))
    || !isCanonicalIsoTimestamp(receipt?.createdAt)
    || !isHistoricalReceiptRuntime(receipt?.runtime, sourceCommit)
    || typeof sourceIdentity?.dev !== 'string'
    || !/^(?:0|[1-9][0-9]*)$/.test(sourceIdentity.dev)
    || typeof sourceIdentity?.ino !== 'string'
    || !/^(?:0|[1-9][0-9]*)$/.test(sourceIdentity.ino)
    || sourceIdentity?.realPath !== path.resolve(dbPath)
    || receipt?.source?.queryOnly !== true
    || receipt?.source?.totalChangesBefore !== 0
    || receipt?.source?.totalChangesAfter !== 0
    || receipt?.source?.durableStateUnchanged !== true
    || !isHistoricalSourceState(receipt?.source?.before)
    || !isHistoricalSourceState(receipt?.source?.after)
    || receipt.source.before.database.dev !== sourceIdentity.dev
    || receipt.source.before.database.ino !== sourceIdentity.ino
    || receipt.source.after.database.dev !== sourceIdentity.dev
    || receipt.source.after.database.ino !== sourceIdentity.ino
    || !durableSourceStateEqual(receipt.source.before, receipt.source.after)
    || !Number.isSafeInteger(receipt?.archive?.size)
    || receipt.archive.size <= 0
    || !SHA256_PATTERN.test(String(receipt?.archive?.sha256 || ''))
    || !isCanonicalIsoTimestamp(receipt?.archive?.generatedAt)
    || !Number.isSafeInteger(receipt?.archive?.includedFilesCount)
    || receipt.archive.includedFilesCount < 0
    || receipt?.archive?.skippedFilesCount !== 0
    || !Number.isSafeInteger(receipt?.archive?.businessFileCount)
    || receipt.archive.businessFileCount < 0
    || !SHA256_PATTERN.test(String(receipt?.archive?.logicalDatabaseSha256 || ''))
    || !SHA256_PATTERN.test(String(receipt?.archive?.databaseFileSha256 || ''))
    || !Number.isSafeInteger(receipt?.archive?.databaseFileSize)
    || receipt.archive.databaseFileSize <= 0
    || receipt?.archive?.databaseIntegrity !== 'ok'
    || receipt?.archive?.databaseForeignKeyViolations !== 0
    || !SHA256_PATTERN.test(String(receipt?.archive?.businessFileInventorySha256 || ''))
    || !collectionCounts
    || typeof collectionCounts !== 'object'
    || Array.isArray(collectionCounts)
    || Object.values(collectionCounts).some(value => !Number.isSafeInteger(value) || value < 0)
  ) {
    fail(
      'PRE_COMPATIBILITY_BACKUP_RECEIPT_MISMATCH',
      'The completed historical preliminary backup receipt does not match this request.',
    );
  }

  const expectedFilename = `skytech-pre-clean-reset-${backupTimestamp(new Date(receipt.archive.generatedAt))}.zip`;
  const expectedArchivePath = backupArchivePath(
    path.join(path.dirname(path.resolve(dbPath)), 'backups'),
    receipt.archive.filename,
  );
  if (
    receipt.archive.filename !== expectedFilename
    || resolvedArchivePath !== expectedArchivePath
    || archiveHandle?.filePath !== expectedArchivePath
  ) {
    fail(
      'PRE_COMPATIBILITY_BACKUP_ARCHIVE_MISMATCH',
      'The completed historical preliminary backup archive path is invalid.',
    );
  }
  const archiveStat = assertPrivateArtifactHandle(archiveHandle);
  const archiveSha256BeforeValidation = hashArtifactHandle(archiveHandle);
  if (
    archiveStat.size !== receipt.archive.size
    || archiveSha256BeforeValidation !== receipt.archive.sha256
  ) {
    fail(
      'PRE_COMPATIBILITY_BACKUP_ARCHIVE_MISMATCH',
      'The completed historical preliminary backup archive is missing or changed.',
    );
  }
  let validationSnapshot;
  let validatedSnapshotHandle;
  try {
    validationSnapshot = snapshotArtifactHandle(archiveHandle);
    if (
      validationSnapshot.size !== receipt.archive.size
      || validationSnapshot.sha256 !== archiveSha256BeforeValidation
    ) {
      fail(
        'PRE_COMPATIBILITY_BACKUP_ARCHIVE_CHANGED',
        'The completed historical preliminary backup archive changed before validation.',
      );
    }
    validateHistoricalPreCompatibilityBackup({
      backupPath: validationSnapshot.path,
      receipt,
    });
    if (hashArtifactHandle(archiveHandle) !== archiveSha256BeforeValidation) {
      fail(
        'PRE_COMPATIBILITY_BACKUP_ARCHIVE_CHANGED',
        'The completed historical preliminary backup archive changed during validation.',
      );
    }
    validatedSnapshotHandle = openPrivateArtifactFile(validationSnapshot.path, {
      expectedSize: receipt.archive.size,
    });
    if (hashArtifactHandle(validatedSnapshotHandle) !== archiveSha256BeforeValidation) {
      fail(
        'PRE_COMPATIBILITY_BACKUP_ARCHIVE_CHANGED',
        'The validated historical preliminary backup snapshot changed before handoff.',
      );
    }
    const ownedValidationSnapshot = validationSnapshot;
    validationSnapshot = undefined;
    return {
      archivePath: expectedArchivePath,
      archiveSha256: archiveSha256BeforeValidation,
      archiveStreamCleanup: () => ownedValidationSnapshot.cleanup(),
      archiveStreamHandle: validatedSnapshotHandle,
      sourceCommit: receiptSourceCommit,
    };
  } catch (error) {
    try { closeArtifactHandle(validatedSnapshotHandle); } catch { /* original validation error wins */ }
    throw error;
  } finally {
    validationSnapshot?.cleanup();
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
      if (isBackupOnlyRuntime() !== true) {
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
    try {
      const stat = fs.lstatSync(dbPath);
      if (
        !stat.isFile()
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
    req.preCompatibilityBackupNonce = requestNonce;
    return next();
  }

  function requireArtifactDownloadRequest(req, res, next) {
    const sourceCommit = String(req.headers[SOURCE_COMMIT_HEADER] || '');
    if (!SOURCE_COMMIT_PATTERN.test(sourceCommit)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (
      UNSUPPORTED_ARTIFACT_REQUEST_HEADERS.some(header => req.headers[header] !== undefined)
      || (req.headers['content-length'] !== undefined && req.headers['content-length'] !== '0')
    ) {
      return res.status(400).json({ ok: false, error: 'Unsupported artifact request.' });
    }
    req.preCompatibilityBackupSourceCommit = sourceCommit;
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
        validateCompletedReceipt({
          receipt,
          requestNonce,
          runtime,
          dbPath,
          sourceHandle,
          startupSourceIdentity,
        });
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
      publishAtomicBuffer(receiptPath, receiptBytes, operationId);
      operationStage = 'receipt-published';
      return res.status(201).json(response);
    } catch (error) {
      if (transactionStarted) {
        try { sourceHandle?.db?.exec('ROLLBACK'); } catch { /* original error wins */ }
      }
      process.stderr.write(`${JSON.stringify({
        event: 'pre_compatibility_backup_failed',
        stage: operationStage,
        code: typeof error?.code === 'string' ? error.code : 'PRE_COMPATIBILITY_BACKUP_FAILED',
      })}\n`);
      return res.status(409).json({ ok: false, error: 'Preliminary backup failed.' });
    } finally {
      try { sourceHandle?.close(); } catch { /* request outcome is already fixed */ }
      try { if (backup) cleanupBackupArchive(backup); } catch { /* durable outcome must not be replaced by temp cleanup */ }
      operationInFlight = false;
    }
  }

  function handleArtifactDownload(artifact) {
    return (req, res) => {
      let receiptHandle;
      let archiveHandle;
      let validatedArchiveCleanup;
      let validatedArchiveHandle;
      let streamedHandle;
      try {
        const sourceCommit = req.preCompatibilityBackupSourceCommit;
        const backupDirectory = existingPrivateBackupDirectoryPath(dbPath);
        const receiptPath = path.join(backupDirectory, RECEIPT_FILENAME);
        receiptHandle = openPrivateArtifactFile(receiptPath, { maxSize: MAX_RECEIPT_BYTES });
        const receiptBytes = readArtifactBytes(receiptHandle, MAX_RECEIPT_BYTES);
        let receipt;
        try {
          receipt = JSON.parse(receiptBytes.toString('utf8'));
        } catch {
          fail('PRE_COMPATIBILITY_BACKUP_RECEIPT_INVALID', 'The preliminary backup receipt is invalid.');
        }
        const canonicalReceiptBytes = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
        if (
          canonicalReceiptBytes.length !== receiptBytes.length
          || !crypto.timingSafeEqual(canonicalReceiptBytes, receiptBytes)
        ) {
          fail('PRE_COMPATIBILITY_BACKUP_RECEIPT_INVALID', 'The preliminary backup receipt is not canonical.');
        }
        if (
          !safeEqual(receipt?.requestNonce, req.preCompatibilityBackupNonce)
          || !safeEqual(receipt?.runtime?.commitFull, sourceCommit)
        ) {
          return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        const archivePath = backupArchivePath(backupDirectory, receipt?.archive?.filename);
        archiveHandle = openPrivateArtifactFile(archivePath, { expectedSize: receipt?.archive?.size });
        const validated = validateHistoricalArtifactReceipt({
          receipt,
          requestNonce: req.preCompatibilityBackupNonce,
          sourceCommit,
          dbPath,
          archiveHandle,
          resolvedArchivePath: archivePath,
        });
        validatedArchiveCleanup = validated.archiveStreamCleanup;
        validatedArchiveHandle = validated.archiveStreamHandle;
        const receiptSha256Before = crypto.createHash('sha256').update(receiptBytes).digest('hex');
        const receiptSha256After = hashArtifactHandle(receiptHandle);
        if (receiptSha256After !== receiptSha256Before) {
          fail('PRE_COMPATIBILITY_BACKUP_RECEIPT_CHANGED', 'The preliminary backup receipt changed during validation.');
        }

        const filename = artifact === 'receipt' ? RECEIPT_FILENAME : receipt.archive.filename;
        const contentSha256 = artifact === 'receipt' ? receiptSha256Before : validated.archiveSha256;
        const contentType = artifact === 'receipt' ? 'application/json; charset=utf-8' : 'application/zip';
        const contentLength = artifact === 'receipt'
          ? receiptBytes.length
          : assertPrivateArtifactHandle(validatedArchiveHandle).size;
        res.status(200);
        res.setHeader('Content-Type', contentType);
        res.setHeader('Content-Length', String(contentLength));
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Skytech-Pre-Compatibility-Backup-Content-SHA256', contentSha256);
        res.setHeader('X-Skytech-Pre-Compatibility-Backup-Receipt-SHA256', receiptSha256Before);
        res.setHeader('X-Skytech-Pre-Compatibility-Backup-Source-Commit', validated.sourceCommit);

        closeArtifactHandle(receiptHandle);
        receiptHandle = undefined;
        closeArtifactHandle(archiveHandle);
        archiveHandle = undefined;
        if (artifact === 'receipt') {
          closeArtifactHandle(validatedArchiveHandle);
          validatedArchiveHandle = undefined;
          validatedArchiveCleanup();
          validatedArchiveCleanup = undefined;
          res.end(receiptBytes);
          return undefined;
        }

        streamedHandle = validatedArchiveHandle;
        validatedArchiveHandle = undefined;
        const stream = fs.createReadStream(null, {
          fd: streamedHandle.fd,
          autoClose: true,
          start: 0,
          end: streamedHandle.initialStat.size - 1,
        });
        streamedHandle.fd = undefined;
        const streamSnapshotCleanup = validatedArchiveCleanup;
        validatedArchiveCleanup = undefined;
        let streamSnapshotCleaned = false;
        const cleanupStreamSnapshot = () => {
          if (streamSnapshotCleaned) return;
          streamSnapshotCleaned = true;
          streamSnapshotCleanup();
        };
        const destroyStream = () => {
          stream.destroy();
          cleanupStreamSnapshot();
        };
        res.once('close', destroyStream);
        stream.once('close', () => {
          res.removeListener('close', destroyStream);
          cleanupStreamSnapshot();
        });
        stream.once('error', () => {
          cleanupStreamSnapshot();
          res.destroy();
        });
        stream.pipe(res);
        return undefined;
      } catch (error) {
        process.stderr.write(`${JSON.stringify({
          event: 'pre_compatibility_backup_artifact_failed',
          artifact,
          code: typeof error?.code === 'string' ? error.code : 'PRE_COMPATIBILITY_BACKUP_ARTIFACT_FAILED',
        })}\n`);
        if (res.headersSent) {
          res.destroy();
          return undefined;
        }
        return res.status(409).json({ ok: false, error: 'Backup artifact unavailable.' });
      } finally {
        try { closeArtifactHandle(receiptHandle); } catch { /* the generic request outcome is authoritative */ }
        try { closeArtifactHandle(archiveHandle); } catch { /* the generic request outcome is authoritative */ }
        try { closeArtifactHandle(validatedArchiveHandle); } catch { /* the generic request outcome is authoritative */ }
        try { validatedArchiveCleanup?.(); } catch { /* the generic request outcome is authoritative */ }
        try { closeArtifactHandle(streamedHandle); } catch { /* the stream owns its descriptor after handoff */ }
      }
    };
  }

  return {
    handleArtifactDownload,
    handleBackup,
    requireArtifactDownloadRequest,
    requireBackupCapability,
  };
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
  const {
    handleArtifactDownload,
    requireArtifactDownloadRequest,
    requireBackupCapability,
  } = createPreCompatibilityBackupHandlers(options);
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

  for (const artifact of ['receipt', 'archive']) {
    const artifactEndpoint = `${endpoint}/artifacts/${artifact}`;
    router.head(
      artifactEndpoint,
      setArtifactResponseSecurityHeaders,
      requireBackupCapability,
      (_req, res) => res.set('Allow', 'GET').status(405).json({ ok: false, error: 'Method not allowed.' }),
    );
    router.options(
      artifactEndpoint,
      setArtifactResponseSecurityHeaders,
      (_req, res) => res.set('Allow', 'GET').status(405).json({ ok: false, error: 'Method not allowed.' }),
    );
    router.get(
      artifactEndpoint,
      setArtifactResponseSecurityHeaders,
      requireBackupCapability,
      requireArtifactDownloadRequest,
      handleArtifactDownload(artifact),
    );
  }
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
