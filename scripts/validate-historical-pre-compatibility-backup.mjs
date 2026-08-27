#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  extractStoredZipEntry,
  hashStoredZipEntry,
  inspectFullBackupArchive,
  validateStoredZipEntry,
} = require('../server/lib/full-backup-validation.js');
const {
  databaseLogicalDigest,
  optionalAppDataMetadata,
} = require('../server/lib/pre-compatibility-backup.js');

export const HISTORICAL_PRE_COMPATIBILITY_BACKUP = Object.freeze({
  sourceCommit: '5f01ec09bbff89066ca7f856a2f7167d27623e7a',
  sourceDeploymentId: '3e619e81-d972-44f1-a8d8-86918a00e1ca',
  sourceReplicaId: '3438d4e6-bcaa-4b59-8e4b-15d00f26548d',
  requestNonce: '108970e3-9adf-4369-ba48-dff4fcfb1d20',
  archiveFilename: 'skytech-pre-clean-reset-20260827T143126Z.zip',
  archiveSize: 11_930_936,
  archiveSha256: '2ae3d46e2e0606d21476a820e0063e64c8638e8dbc6f660e6a1f85118b819437',
  receiptFilename: 'skytech-pre-compatibility-backup-receipt.json',
  receiptSize: 3_835,
  receiptSha256: '6fdd362ede52d66225ed53910b7ef49b8db364658b47516b9274c5988ed3959c',
  generatedAt: '2026-08-27T14:31:26.467Z',
  databaseIncludedAs: 'database/app.sqlite',
  databaseSourcePath: 'app.sqlite',
  sourceDatabasePath: '/data/app.sqlite',
});

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const BUSINESS_FILE_PREFIXES = [
  'files/uploads/',
  'files/photos/',
  'files/documents/',
  'files/files/',
  'files/attachments/',
];

function exactString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(`${label} must be an exact nonblank string`);
  }
  return value;
}

function canonicalTimestamp(value, label) {
  const timestamp = exactString(value, label);
  if (new Date(timestamp).toISOString() !== timestamp) {
    throw new Error(`${label} must be a canonical ISO timestamp`);
  }
  return timestamp;
}

function sha256Bytes(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

const BOUND_FILE_STATE_KEYS = [
  'dev',
  'ino',
  'mode',
  'nlink',
  'uid',
  'gid',
  'size',
  'mtimeMs',
  'ctimeMs',
];

function sameBoundFileState(left, right) {
  return BOUND_FILE_STATE_KEYS.every(key => left?.[key] === right?.[key]);
}

function assertPrivateValidationInput(stat, expectedSize, label) {
  const effectiveUid = typeof process.geteuid === 'function' ? process.geteuid() : null;
  if (
    !Number.isSafeInteger(effectiveUid)
    || effectiveUid < 0
    || !stat?.isFile?.()
    || stat.isSymbolicLink?.()
    || stat.nlink !== 1
    || stat.uid !== effectiveUid
    || (stat.mode & 0o7777) !== 0o600
    || stat.size !== expectedSize
  ) {
    throw new Error(`${label} is not an exact private validation input`);
  }
}

function readBoundValidationInput(filePath, expectedSize, label) {
  const pathBefore = fs.lstatSync(filePath);
  assertPrivateValidationInput(pathBefore, expectedSize, label);
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const descriptorBefore = fs.fstatSync(fd);
    assertPrivateValidationInput(descriptorBefore, expectedSize, label);
    if (!sameBoundFileState(pathBefore, descriptorBefore)) {
      throw new Error(`${label} identity changed before reading`);
    }
    const bytes = Buffer.alloc(expectedSize);
    let position = 0;
    while (position < bytes.length) {
      const bytesRead = fs.readSync(fd, bytes, position, bytes.length - position, position);
      if (bytesRead === 0) throw new Error(`${label} ended while reading`);
      position += bytesRead;
    }
    const descriptorAfter = fs.fstatSync(fd);
    const pathAfter = fs.lstatSync(filePath);
    if (
      !sameBoundFileState(descriptorBefore, descriptorAfter)
      || !sameBoundFileState(descriptorBefore, pathAfter)
    ) {
      throw new Error(`${label} changed while reading`);
    }
    return bytes;
  } finally {
    fs.closeSync(fd);
  }
}

export function createPrivateValidationSnapshot({
  sourcePath,
  snapshotPath,
  expectedSize,
  label = 'backup validation input',
} = {}) {
  const pathBefore = fs.lstatSync(sourcePath);
  assertPrivateValidationInput(pathBefore, expectedSize, label);
  const sourceFd = fs.openSync(
    sourcePath,
    fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0),
  );
  let snapshotFd;
  try {
    const descriptorBefore = fs.fstatSync(sourceFd);
    assertPrivateValidationInput(descriptorBefore, expectedSize, label);
    if (!sameBoundFileState(pathBefore, descriptorBefore)) {
      throw new Error(`${label} identity changed before snapshotting`);
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
    while (position < expectedSize) {
      const bytesRead = fs.readSync(
        sourceFd,
        buffer,
        0,
        Math.min(buffer.length, expectedSize - position),
        position,
      );
      if (bytesRead === 0) throw new Error(`${label} ended while snapshotting`);
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
    const descriptorAfter = fs.fstatSync(sourceFd);
    const pathAfter = fs.lstatSync(sourcePath);
    const snapshotDescriptor = fs.fstatSync(snapshotFd);
    const snapshotPathState = fs.lstatSync(snapshotPath);
    assertPrivateValidationInput(snapshotDescriptor, expectedSize, `${label} snapshot`);
    assertPrivateValidationInput(snapshotPathState, expectedSize, `${label} snapshot`);
    if (
      !sameBoundFileState(descriptorBefore, descriptorAfter)
      || !sameBoundFileState(descriptorBefore, pathAfter)
      || !sameBoundFileState(snapshotDescriptor, snapshotPathState)
    ) {
      throw new Error(`${label} changed while snapshotting`);
    }
    return {
      path: snapshotPath,
      sha256: hash.digest('hex'),
      size: expectedSize,
    };
  } catch (error) {
    try { fs.rmSync(snapshotPath, { force: true }); } catch { /* original error wins */ }
    throw error;
  } finally {
    if (snapshotFd !== undefined) fs.closeSync(snapshotFd);
    fs.closeSync(sourceFd);
  }
}

function sha256File(filePath) {
  const statBefore = fs.lstatSync(filePath);
  if (!statBefore.isFile() || statBefore.isSymbolicLink() || statBefore.nlink !== 1) {
    throw new Error('backup validation input is not a safe regular file');
  }
  const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  try {
    const descriptorBefore = fs.fstatSync(fd);
    while (position < descriptorBefore.size) {
      const bytesRead = fs.readSync(
        fd,
        buffer,
        0,
        Math.min(buffer.length, descriptorBefore.size - position),
        position,
      );
      if (bytesRead === 0) throw new Error('backup validation input changed while hashing');
      hash.update(buffer.subarray(0, bytesRead));
      position += bytesRead;
    }
    const descriptorAfter = fs.fstatSync(fd);
    const pathAfter = fs.lstatSync(filePath);
    for (const key of ['dev', 'ino', 'size', 'mtimeMs', 'ctimeMs']) {
      if (descriptorBefore[key] !== descriptorAfter[key] || descriptorBefore[key] !== pathAfter[key]) {
        throw new Error('backup validation input changed while hashing');
      }
    }
    return hash.digest('hex');
  } finally {
    fs.closeSync(fd);
  }
}

function equalJson(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function validateCapturedFileState(value, label, { required = false } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || typeof value.exists !== 'boolean') {
    throw new Error(`${label} is not a captured file state`);
  }
  if (!value.exists) {
    if (required || Object.keys(value).length !== 1) throw new Error(`${label} missing state is invalid`);
    return;
  }
  for (const field of ['dev', 'ino', 'mode']) {
    if (typeof value[field] !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value[field])) {
      throw new Error(`${label}.${field} is invalid`);
    }
  }
  if (value.nlink !== '1') throw new Error(`${label}.nlink is invalid`);
  if (!Number.isSafeInteger(value.size) || value.size < 0) {
    throw new Error(`${label}.size is invalid`);
  }
  for (const field of ['mtimeMs', 'ctimeMs']) {
    if (typeof value[field] !== 'string' || !/^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/.test(value[field])) {
      throw new Error(`${label}.${field} is invalid`);
    }
  }
  if (!SHA256_PATTERN.test(String(value.sha256 || ''))) throw new Error(`${label}.sha256 is invalid`);
}

export function validateCapturedSourceIdentity(value, label = 'source identity') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is invalid`);
  }
  for (const field of ['dev', 'ino']) {
    if (typeof value[field] !== 'string' || !/^(?:0|[1-9][0-9]*)$/.test(value[field])) {
      throw new Error(`${label}.${field} is invalid`);
    }
  }
}

export function validateCapturedSourceBinding(source) {
  const identity = source?.identity;
  const before = source?.before;
  const after = source?.after;
  if (
    before?.database?.dev !== identity?.dev
    || before?.database?.ino !== identity?.ino
    || after?.database?.dev !== identity?.dev
    || after?.database?.ino !== identity?.ino
  ) {
    throw new Error('captured source database identity is not bound');
  }
  // SQLite SHM is ephemeral coordination state. The captured backup's durable
  // conservation contract intentionally covers the database and WAL only.
  for (const name of ['database', 'wal']) {
    if (!equalJson(before?.[name], after?.[name])) {
      throw new Error(`captured source ${name} state changed`);
    }
  }
}

function validateReceipt(receipt) {
  const expected = HISTORICAL_PRE_COMPATIBILITY_BACKUP;
  canonicalTimestamp(receipt?.createdAt, 'receipt createdAt');
  canonicalTimestamp(receipt?.runtime?.startedAt, 'receipt runtime startedAt');
  validateCapturedSourceIdentity(receipt?.source?.identity);
  validateCapturedSourceBinding(receipt?.source);
  const checks = [
    [receipt?.receiptVersion === 1, 'receipt version mismatch'],
    [receipt?.purpose === 'pre-schema-compatibility-production-backup', 'receipt purpose mismatch'],
    [receipt?.status === 'COMPLETE', 'receipt status mismatch'],
    [receipt?.requestNonce === expected.requestNonce, 'receipt nonce mismatch'],
    [UUID_PATTERN.test(String(receipt?.operationId || '')), 'receipt operation ID is invalid'],
    [receipt?.runtime?.commitFull === expected.sourceCommit, 'historical runtime commit mismatch'],
    [receipt?.runtime?.commit === expected.sourceCommit.slice(0, 7), 'historical runtime short commit mismatch'],
    [['backend', 'full-stack'].includes(receipt?.runtime?.releaseType), 'historical runtime release type is invalid'],
    [receipt?.runtime?.release?.type === receipt?.runtime?.releaseType, 'historical runtime release aliases disagree'],
    [receipt?.runtime?.deployment?.railwayDeploymentId === expected.sourceDeploymentId, 'historical deployment ID mismatch'],
    [receipt?.runtime?.deployment?.railwayReplicaId === expected.sourceReplicaId, 'historical replica ID mismatch'],
    [receipt?.runtime?.deployment?.railwayEnvironment === 'production', 'historical environment mismatch'],
    [receipt?.runtime?.deployment?.railwayService === 'rental-management', 'historical service mismatch'],
    [receipt?.source?.identity?.realPath === expected.sourceDatabasePath, 'source database path mismatch'],
    [receipt?.source?.queryOnly === true, 'receipt source is not query-only'],
    [receipt?.source?.totalChangesBefore === 0, 'receipt source changed before backup'],
    [receipt?.source?.totalChangesAfter === 0, 'receipt source changed after backup'],
    [receipt?.source?.durableStateUnchanged === true, 'receipt source is not conserved'],
    [receipt?.archive?.filename === expected.archiveFilename, 'historical archive filename mismatch'],
    [receipt?.archive?.size === expected.archiveSize, 'historical archive size mismatch'],
    [receipt?.archive?.generatedAt === expected.generatedAt, 'historical archive timestamp mismatch'],
    [receipt?.archive?.databaseIncludedAs === expected.databaseIncludedAs, 'historical database archive path mismatch'],
    [receipt?.archive?.sha256 === expected.archiveSha256, 'historical archive SHA-256 mismatch'],
    [SHA256_PATTERN.test(String(receipt?.archive?.databaseFileSha256 || '')), 'database file SHA-256 is invalid'],
    [SHA256_PATTERN.test(String(receipt?.archive?.logicalDatabaseSha256 || '')), 'logical database SHA-256 is invalid'],
    [SHA256_PATTERN.test(String(receipt?.archive?.businessFileInventorySha256 || '')), 'business inventory SHA-256 is invalid'],
    [Number.isSafeInteger(receipt?.archive?.databaseFileSize) && receipt.archive.databaseFileSize > 0, 'database file size is invalid'],
    [Number.isSafeInteger(receipt?.archive?.businessFileCount) && receipt.archive.businessFileCount >= 0, 'business file count is invalid'],
    [Number.isSafeInteger(receipt?.archive?.includedFilesCount) && receipt.archive.includedFilesCount >= 0, 'included file count is invalid'],
    [receipt?.archive?.skippedFilesCount === 0, 'historical archive skipped files'],
    [receipt?.archive?.databaseIntegrity === 'ok', 'receipt database integrity is not ok'],
    [receipt?.archive?.databaseForeignKeyViolations === 0, 'receipt database has foreign-key violations'],
    [receipt?.archive?.collectionCounts && typeof receipt.archive.collectionCounts === 'object'
      && !Array.isArray(receipt.archive.collectionCounts), 'receipt collection counts are invalid'],
    [Object.values(receipt?.archive?.collectionCounts || {})
      .every(value => Number.isSafeInteger(value) && value >= 0),
    'receipt collection count value is invalid'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
  validateCapturedFileState(receipt.source.before.database, 'source.before.database', { required: true });
  validateCapturedFileState(receipt.source.after.database, 'source.after.database', { required: true });
  validateCapturedFileState(receipt.source.before.wal, 'source.before.wal');
  validateCapturedFileState(receipt.source.after.wal, 'source.after.wal');
  validateCapturedFileState(receipt.source.before.shm, 'source.before.shm');
  validateCapturedFileState(receipt.source.after.shm, 'source.after.shm');
}

export function validateManifest(manifest, receipt, archive) {
  const expected = HISTORICAL_PRE_COMPATIBILITY_BACKUP;
  const files = [...archive.entries.keys()].filter(name => name.startsWith('files/'));
  const localFiles = files.filter(name => BUSINESS_FILE_PREFIXES.some(prefix => name.startsWith(prefix)));
  const embeddedFiles = files.filter(name => name.startsWith('files/embedded-photos/'));
  const listedLocalFiles = Array.isArray(manifest?.files?.included) ? manifest.files.included : [];
  const expectedEntryNames = new Set([
    'manifest.json',
    'README-backup.txt',
    expected.databaseIncludedAs,
    ...files,
  ]);
  const checks = [
    [manifest?.generatedAt === expected.generatedAt, 'manifest generation timestamp mismatch'],
    [manifest?.generatedAt === receipt?.archive?.generatedAt,
      'manifest and receipt archive timestamps mismatch'],
    [manifest?.backupSize === expected.archiveSize, 'manifest archive size mismatch'],
    [manifest?.appName === 'Skytech Rental Management', 'manifest app identity mismatch'],
    [equalJson(manifest?.appVersion, receipt.runtime), 'manifest runtime provenance mismatch'],
    [manifest?.appVersion?.commitFull === expected.sourceCommit, 'manifest source commit mismatch'],
    [manifest?.appVersion?.startedAt === receipt.runtime.startedAt, 'manifest runtime start mismatch'],
    [manifest?.appVersion?.deployment?.railwayDeploymentId === expected.sourceDeploymentId, 'manifest deployment ID mismatch'],
    [manifest?.appVersion?.deployment?.railwayReplicaId === expected.sourceReplicaId, 'manifest replica ID mismatch'],
    [manifest?.appVersion?.deployment?.railwayEnvironment === 'production', 'manifest environment mismatch'],
    [manifest?.appVersion?.deployment?.railwayService === 'rental-management', 'manifest service mismatch'],
    [manifest?.database?.type === 'sqlite', 'manifest database type mismatch'],
    [manifest?.database?.includedAs === expected.databaseIncludedAs, 'manifest database path mismatch'],
    [manifest?.database?.sourcePath === expected.databaseSourcePath, 'manifest database source path mismatch'],
    [equalJson(manifest?.counts, receipt.archive.collectionCounts), 'manifest collection counts mismatch'],
    [manifest?.includedFilesCount === receipt.archive.includedFilesCount, 'manifest included-file count mismatch'],
    [manifest?.includedFilesCount === files.length, 'ZIP file-entry count mismatch'],
    [manifest?.localFilesCount === localFiles.length, 'manifest local-file count mismatch'],
    [manifest?.embeddedPhotosCount === embeddedFiles.length, 'manifest embedded-photo count mismatch'],
    [manifest?.skippedFilesCount === 0, 'manifest skipped files'],
    [manifest?.files && typeof manifest.files === 'object'
      && !Array.isArray(manifest.files), 'manifest nested file inventory is invalid'],
    [manifest?.files?.includedCount === files.length, 'manifest nested included count mismatch'],
    [manifest?.files?.includedFilesCount === files.length, 'manifest nested included-file count mismatch'],
    [manifest?.files?.localFilesCount === localFiles.length, 'manifest nested local-file count mismatch'],
    [manifest?.files?.embeddedPhotosCount === embeddedFiles.length, 'manifest nested embedded-photo count mismatch'],
    [manifest?.files?.skippedFilesCount === 0, 'manifest nested skipped files'],
    [files.length === localFiles.length + embeddedFiles.length, 'ZIP contains an unknown business-file root'],
    [archive.entries.size === expectedEntryNames.size
      && [...archive.entries.keys()].every(name => expectedEntryNames.has(name)),
    'ZIP entry set is not exact'],
    [listedLocalFiles.length === localFiles.length, 'manifest local-file inventory length mismatch'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
  if (listedLocalFiles.some(item => (
    !item
    || typeof item !== 'object'
    || Array.isArray(item)
    || typeof item.path !== 'string'
    || !Number.isSafeInteger(item.size)
    || item.size < 0
  ))) {
    throw new Error('manifest local-file inventory has an invalid entry');
  }
  const manifestLocalMap = new Map(listedLocalFiles.map(item => [item.path, item.size]));
  if (manifestLocalMap.size !== listedLocalFiles.length) throw new Error('manifest local-file inventory has duplicates');
  for (const name of localFiles) {
    if (manifestLocalMap.get(name) !== archive.entries.get(name).size) {
      throw new Error('manifest local-file inventory does not match the ZIP');
    }
  }
  const businessInventory = localFiles
    .map(name => ({
      zipPath: name,
      size: archive.entries.get(name).size,
      sha256: hashStoredZipEntry(archive, name),
    }))
    .sort((left, right) => left.zipPath.localeCompare(right.zipPath));
  if (
    businessInventory.length !== receipt.archive.businessFileCount
    || sha256Bytes(JSON.stringify(businessInventory)) !== receipt.archive.businessFileInventorySha256
  ) {
    throw new Error('business-file inventory hash mismatch');
  }
  return { businessFileCount: businessInventory.length };
}

export function validateHistoricalPreCompatibilityBackup({ receiptPath, archivePath } = {}) {
  const expected = HISTORICAL_PRE_COMPATIBILITY_BACKUP;
  const temporaryDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'skytech-historical-backup-validation-'));
  fs.chmodSync(temporaryDirectory, 0o700);
  const archiveSnapshotPath = path.join(temporaryDirectory, 'archive.snapshot.zip');
  const databasePath = path.join(temporaryDirectory, 'app.sqlite');
  let database;
  try {
    const effectiveUid = typeof process.geteuid === 'function' ? process.geteuid() : null;
    const temporaryDirectoryState = fs.lstatSync(temporaryDirectory);
    if (
      !Number.isSafeInteger(effectiveUid)
      || !temporaryDirectoryState.isDirectory()
      || temporaryDirectoryState.isSymbolicLink()
      || temporaryDirectoryState.uid !== effectiveUid
      || (temporaryDirectoryState.mode & 0o7777) !== 0o700
    ) {
      throw new Error('historical validation directory is not private');
    }
    const receiptBytes = readBoundValidationInput(
      receiptPath,
      expected.receiptSize,
      'historical receipt',
    );
    const receiptSha256 = sha256Bytes(receiptBytes);
    if (receiptSha256 !== expected.receiptSha256) {
      throw new Error('historical receipt SHA-256 mismatch');
    }
    let receipt;
    try {
      receipt = JSON.parse(receiptBytes.toString('utf8'));
    } catch {
      throw new Error('historical receipt is not valid JSON');
    }
    const canonicalReceipt = Buffer.from(`${JSON.stringify(receipt, null, 2)}\n`);
    if (
      canonicalReceipt.length !== receiptBytes.length
      || !crypto.timingSafeEqual(canonicalReceipt, receiptBytes)
    ) {
      throw new Error('historical receipt is not in its exact canonical byte representation');
    }
    validateReceipt(receipt);
    const archiveSnapshot = createPrivateValidationSnapshot({
      sourcePath: archivePath,
      snapshotPath: archiveSnapshotPath,
      expectedSize: expected.archiveSize,
      label: 'historical archive',
    });
    const archiveSha256 = archiveSnapshot.sha256;
    if (archiveSha256 !== receipt.archive.sha256) {
      throw new Error('historical archive SHA-256 mismatch');
    }

    const archive = inspectFullBackupArchive(archiveSnapshot.path);
    if (archive.size !== expected.archiveSize) throw new Error('inspected ZIP size mismatch');
    for (const name of archive.entries.keys()) validateStoredZipEntry(archive, name);
    const manifestValidation = validateManifest(archive.manifest, receipt, archive);

    const extracted = extractStoredZipEntry(archive, expected.databaseIncludedAs, databasePath);
    if (
      extracted.sha256 !== receipt.archive.databaseFileSha256
      || extracted.size !== receipt.archive.databaseFileSize
    ) {
      throw new Error('extracted database file hash or size mismatch');
    }
    database = new Database(databasePath, { readonly: true, fileMustExist: true });
    database.pragma('foreign_keys = ON');
    database.pragma('query_only = ON');
    const integrity = database.pragma('integrity_check');
    const foreignKeyViolations = database.pragma('foreign_key_check');
    if (integrity.length !== 1 || integrity[0].integrity_check !== 'ok') {
      throw new Error('historical SQLite integrity_check failed');
    }
    if (foreignKeyViolations.length !== 0) {
      throw new Error('historical SQLite foreign_key_check failed');
    }
    const logicalDatabaseSha256 = databaseLogicalDigest(database);
    if (logicalDatabaseSha256 !== receipt.archive.logicalDatabaseSha256) {
      throw new Error('historical logical database SHA-256 mismatch');
    }
    const metadata = optionalAppDataMetadata(database);
    if (!metadata.supported) throw new Error('historical app_data metadata is unsupported');
    const manifestCollectionNames = Object.keys(archive.manifest.counts).sort();
    // The captured preliminary generator used `collections: []`, so its exact
    // empty manifest is not a DB inventory. The receipt-bound logical digest
    // above still covers all SQLite rows; any nonempty inventory is exact.
    if (manifestCollectionNames.length > 0 && (
      !equalJson(metadata.names, manifestCollectionNames)
      || !equalJson(metadata.counts, archive.manifest.counts)
    )) {
      throw new Error('historical app_data inventory or counts mismatch');
    }
    if (sha256File(archiveSnapshot.path) !== archiveSha256) {
      throw new Error('historical archive validation snapshot changed');
    }
    return {
      sourceCommit: expected.sourceCommit,
      sourceDeploymentId: expected.sourceDeploymentId,
      sourceReplicaId: expected.sourceReplicaId,
      requestNonce: expected.requestNonce,
      receiptFilename: expected.receiptFilename,
      receiptSize: expected.receiptSize,
      receiptSha256,
      archiveFilename: expected.archiveFilename,
      archiveSize: expected.archiveSize,
      archiveSha256,
      archiveEntryCount: archive.entries.size,
      businessFileCount: manifestValidation.businessFileCount,
      businessFileInventorySha256: receipt.archive.businessFileInventorySha256,
      databaseFileSize: extracted.size,
      databaseFileSha256: extracted.sha256,
      logicalDatabaseSha256,
      databaseIntegrity: 'ok',
      databaseForeignKeyViolations: 0,
    };
  } finally {
    try { database?.close(); } catch { /* validation outcome remains authoritative */ }
    fs.rmSync(temporaryDirectory, { recursive: true, force: true });
  }
}

function parseArgs(argv) {
  const args = { receipt: '', archive: '', output: '' };
  const names = new Map([
    ['--receipt', 'receipt'],
    ['--archive', 'archive'],
    ['--output', 'output'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = names.get(argv[index]);
    if (!name) throw new Error(`Unknown argument: ${argv[index]}`);
    args[name] = argv[++index] || '';
  }
  for (const [name, value] of Object.entries(args)) exactString(value, name);
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = validateHistoricalPreCompatibilityBackup({
    receiptPath: args.receipt,
    archivePath: args.archive,
  });
  fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  console.log('[historical-backup-recovery] receipt, manifest, ZIP, SQLite, and hashes PASS');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    console.error(`[historical-backup-recovery] archive validation FAIL: ${error.message}`);
    process.exit(1);
  }
}
