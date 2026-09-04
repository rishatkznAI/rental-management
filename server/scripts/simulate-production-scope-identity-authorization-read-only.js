#!/usr/bin/env node
'use strict';

const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const {
  AUTHORITY,
  COMPANY_ID,
  EXPECTED_EXACT_CHANGES,
  EXPECTED_ROW_COUNT_DELTAS,
  HEAD_OFFICE_ID,
  OWNER_MEMBERSHIP_ID,
  OWNER_PRINCIPAL_ID,
} = require('../lib/identity-bootstrap-execution-bundle');
const {
  getSchemaFingerprint,
  planPlatformIdentityBootstrap,
} = require('../lib/platform-identity-bootstrap-validation');
const {
  IDENTITY_SIMULATION_CLASSIFICATION,
  validateIdentitySimulation,
} = require('../lib/production-scope-execution-authorization');
const {
  validateProductionScopeExecutionBundle,
} = require('../lib/production-scope-execution-plan-bundle');
const {
  calculateSourceSnapshotHash,
} = require('../lib/production-scope-remediation-manifest');
const {
  PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
  readHashBoundJson,
} = require('../lib/production-scope-evidence-builder');
const {
  databaseContentFingerprint,
  sqliteFileSetFingerprint,
  sqliteObservedFileSetFingerprint,
} = require('../lib/production-scope-remediation-runner');
const {
  databaseIdentity,
  planProductionScopeRemediation,
  stableJson,
} = require('../lib/production-scope-remediation');

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const LIVE_REPOSITORY_DATABASE = path.resolve(__dirname, '../data/app.sqlite');
const SQLITE_FILE_KEYS = Object.freeze(['database', 'wal', 'shm']);
const SQLITE_FILE_NAMES = Object.freeze({
  database: 'app.sqlite',
  wal: 'app.sqlite-wal',
  shm: 'app.sqlite-shm',
});
const ACCEPTED_ARGUMENTS = new Set([
  '--db',
  '--review-bundle',
  '--review-bundle-sha256',
  '--authorized-execution-sha',
  '--output',
  '--output-sha256',
]);
const EXPECTED_IDENTITY_CREATE_KEYS = Object.freeze([
  `Branch:${HEAD_OFFICE_ID}`,
  `Company:${COMPANY_ID}`,
  `Membership:${OWNER_MEMBERSHIP_ID}`,
  'RoleTemplate:company-administrator:v1',
].sort());

class FreshIdentitySimulationError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'FreshIdentitySimulationError';
    this.code = code;
  }
}

function fail(code, message) {
  throw new FreshIdentitySimulationError(code, message);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function exactText(value) {
  return typeof value === 'string' && value === value.trim() ? value : '';
}

function parseArgs(argv) {
  const args = {};
  const seen = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    const name = argv[index];
    if (name === '--help' || name === '-h') return { help: true };
    if (!ACCEPTED_ARGUMENTS.has(name) || seen.has(name)) {
      fail('ARGUMENT_INVALID', `Unknown or repeated argument: ${name}`);
    }
    seen.add(name);
    const value = argv[++index];
    if (!value || value.startsWith('--')) {
      fail('ARGUMENT_INVALID', `Missing value for ${name}.`);
    }
    args[name.slice(2).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }
  return args;
}

function usage() {
  return [
    'Usage:',
    '  node server/scripts/simulate-production-scope-identity-authorization-read-only.js \\',
    '    --db <frozen retained app.sqlite> \\',
    '    --review-bundle <fresh review-only execution bundle> \\',
    '    --review-bundle-sha256 <independently supplied exact SHA-256> \\',
    '    --authorized-execution-sha <exact deployed 40-hex mechanism SHA> \\',
    '    --output <new simulation JSON path> \\',
    '    --output-sha256 <new SHA-256 sidecar path>',
    '',
    'The source SQLite files are never opened by SQLite. DB/WAL bytes are copied to an',
    'ephemeral local mirror, which is opened readonly with query_only and foreign keys on.',
    'Both output paths must be absent; this command never overwrites an existing artifact.',
    'There is no production, deploy, backup, apply, migration, or environment-write mode.',
  ].join('\n');
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
  return stableJson(statIdentity(left)) === stableJson(statIdentity(right));
}

const nativeRealpathSync = fs.realpathSync.native || fs.realpathSync;

function sameDeviceAndInode(left, right) {
  return String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino);
}

function canonicalPathAllowMissing(filePath) {
  let cursor = path.resolve(filePath);
  const missingSegments = [];
  while (true) {
    try {
      return path.resolve(nativeRealpathSync(cursor), ...missingSegments.reverse());
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
      const parent = path.dirname(cursor);
      if (parent === cursor) throw error;
      missingSegments.push(path.basename(cursor));
      cursor = parent;
    }
  }
}

function canonicalExistingRegularFile(
  filePath,
  { code, label, required = true },
) {
  const requested = path.resolve(filePath);
  let requestedState;
  try {
    requestedState = fs.lstatSync(requested);
  } catch (error) {
    if (error?.code === 'ENOENT' && !required) return null;
    fail(code, `${label} cannot be resolved as an existing regular file.`);
  }
  if (requestedState.isSymbolicLink() || !requestedState.isFile()) {
    fail(code, `${label} must be a non-symlink regular file.`);
  }

  try {
    const canonical = nativeRealpathSync(requested);
    const canonicalState = fs.lstatSync(canonical);
    if (
      canonicalState.isSymbolicLink()
      || !canonicalState.isFile()
      || !sameDeviceAndInode(requestedState, canonicalState)
    ) {
      fail(code, `${label} changed while its canonical path was resolved.`);
    }
    return { requested, canonical, state: canonicalState };
  } catch (error) {
    if (error instanceof FreshIdentitySimulationError) throw error;
    fail(code, `${label} cannot be resolved safely.`);
  }
}

function canonicalExistingDirectory(directoryPath, { code, label }) {
  const requested = path.resolve(directoryPath);
  try {
    const requestedState = fs.statSync(requested);
    const canonical = nativeRealpathSync(requested);
    const canonicalState = fs.lstatSync(canonical);
    if (
      !requestedState.isDirectory()
      || canonicalState.isSymbolicLink()
      || !canonicalState.isDirectory()
      || !sameDeviceAndInode(requestedState, canonicalState)
      || !isSamePath(nativeRealpathSync(requested), canonical)
    ) {
      fail(code, `${label} changed while its canonical path was resolved.`);
    }
    return { requested, canonical, state: canonicalState };
  } catch (error) {
    if (error instanceof FreshIdentitySimulationError) throw error;
    fail(code, `${label} cannot be resolved as an existing directory.`);
  }
}

function pathComparisonKey(candidate) {
  return path.resolve(candidate).normalize('NFC').toLowerCase();
}

function isSamePath(left, right) {
  return pathComparisonKey(left) === pathComparisonKey(right);
}

function isPathWithin(candidate, root) {
  const candidateKey = pathComparisonKey(candidate);
  const rootKey = pathComparisonKey(root);
  return candidateKey === rootKey || candidateKey.startsWith(`${rootKey}${path.sep}`);
}

function canonicalRestrictedPaths() {
  const productionDataRoot = canonicalPathAllowMissing('/data');
  const liveDatabase = canonicalPathAllowMissing(LIVE_REPOSITORY_DATABASE);
  const liveRepositorySlot = path.join(
    nativeRealpathSync(path.dirname(LIVE_REPOSITORY_DATABASE)),
    path.basename(LIVE_REPOSITORY_DATABASE),
  );
  const liveDatabaseFiles = [liveDatabase, liveRepositorySlot].flatMap(database => [
    database,
    `${database}-wal`,
    `${database}-shm`,
    `${database}-journal`,
  ]);
  return {
    productionDataRoot,
    liveDatabase,
    liveDatabaseFiles: new Set(liveDatabaseFiles.map(pathComparisonKey)),
  };
}

function assertOfflineFrozenDatabasePath(canonicalDbPath) {
  const restricted = canonicalRestrictedPaths();
  if (
    isPathWithin(canonicalDbPath, restricted.productionDataRoot)
    || restricted.liveDatabaseFiles.has(pathComparisonKey(canonicalDbPath))
  ) {
    fail(
      'OFFLINE_FROZEN_CAPTURE_REQUIRED',
      'Simulation refuses the production volume and the repository live database path.',
    );
  }
}

function resolveSafeEphemeralRoot(directoryPath = os.tmpdir()) {
  const root = canonicalExistingDirectory(directoryPath, {
    code: 'EPHEMERAL_MIRROR_ROOT_INVALID',
    label: 'Ephemeral mirror root',
  });
  const restricted = canonicalRestrictedPaths();
  const liveRepositoryDataRoot = nativeRealpathSync(path.dirname(LIVE_REPOSITORY_DATABASE));
  if (
    isPathWithin(root.canonical, restricted.productionDataRoot)
    || isPathWithin(root.canonical, liveRepositoryDataRoot)
  ) {
    fail(
      'EPHEMERAL_MIRROR_ROOT_FORBIDDEN',
      'Ephemeral mirror root cannot be the production volume or repository live-data directory.',
    );
  }
  return root;
}

function hashFileDescriptor(fd, expectedSize) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (true) {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  if (position !== expectedSize) {
    fail('SOURCE_SQLITE_FILE_CHANGED', 'A source SQLite file changed while it was hashed.');
  }
  return hash.digest('hex');
}

function inspectSourceFile(
  filePath,
  canonicalName,
  { required = false, holdOpen = false } = {},
) {
  const canonicalFile = canonicalExistingRegularFile(filePath, {
    code: 'SOURCE_SQLITE_FILE_INVALID',
    label: canonicalName,
    required,
  });
  if (!canonicalFile) return null;
  const resolved = canonicalFile.canonical;
  let fd;
  try {
    fd = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(fd);
    if (
      !before.isFile()
      || Number(before.nlink) !== 1
      || Number(before.size) < 0
      || !sameDeviceAndInode(before, canonicalFile.state)
    ) {
      fail('SOURCE_SQLITE_FILE_INVALID', `${canonicalName} must be a singly linked regular file.`);
    }
    const digest = hashFileDescriptor(fd, Number(before.size));
    const after = fs.fstatSync(fd);
    const afterPath = fs.lstatSync(resolved);
    if (
      !sameStatIdentity(before, after)
      || String(after.dev) !== String(afterPath.dev)
      || String(after.ino) !== String(afterPath.ino)
    ) {
      fail('SOURCE_SQLITE_FILE_CHANGED', `${canonicalName} changed while it was inspected.`);
    }
    const inspected = {
      canonicalName,
      resolved,
      stat: statIdentity(after),
      file: {
        name: canonicalName,
        sizeBytes: Number(after.size),
        sha256: digest,
      },
    };
    if (holdOpen) {
      inspected.fd = fd;
      fd = undefined;
    }
    return inspected;
  } catch (error) {
    if (error instanceof FreshIdentitySimulationError) throw error;
    fail('SOURCE_SQLITE_FILE_INVALID', `${canonicalName} cannot be read safely.`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function closeInspectedSourceFiles(states) {
  for (const key of SQLITE_FILE_KEYS) {
    if (states?.[key]?.fd !== undefined) {
      fs.closeSync(states[key].fd);
      states[key].fd = undefined;
    }
  }
}

function inspectSourceFileSet(dbPath, { holdOpen = false } = {}) {
  let potentialCanonicalDbPath;
  try {
    potentialCanonicalDbPath = canonicalPathAllowMissing(dbPath);
  } catch {
    fail('SOURCE_SQLITE_FILE_INVALID', 'app.sqlite cannot be resolved safely.');
  }
  assertOfflineFrozenDatabasePath(potentialCanonicalDbPath);
  const states = { database: null, wal: null, shm: null };
  try {
    states.database = inspectSourceFile(dbPath, SQLITE_FILE_NAMES.database, {
      required: true,
      holdOpen,
    });
    assertOfflineFrozenDatabasePath(states.database.resolved);
    const resolvedDbPath = states.database.resolved;
    states.wal = inspectSourceFile(`${resolvedDbPath}-wal`, SQLITE_FILE_NAMES.wal, { holdOpen });
    states.shm = inspectSourceFile(`${resolvedDbPath}-shm`, SQLITE_FILE_NAMES.shm, { holdOpen });
    if (!states.database || states.database.file.sizeBytes <= 0) {
      fail('SOURCE_DATABASE_EMPTY', 'The frozen retained SQLite database must be non-empty.');
    }
    return states;
  } catch (error) {
    closeInspectedSourceFiles(states);
    throw error;
  }
}

function fileSetProjection(states) {
  return Object.fromEntries(SQLITE_FILE_KEYS.map(key => [key, states[key]?.file || null]));
}

function fileSetRows(states) {
  return SQLITE_FILE_KEYS.filter(key => states[key]).map(key => ({
    name: states[key].file.name,
    size: states[key].file.sizeBytes,
    sha256: states[key].file.sha256,
  }));
}

function fileSetIdentity(states) {
  return Object.fromEntries(SQLITE_FILE_KEYS.map(key => [key, states[key] ? {
    resolved: states[key].resolved,
    stat: states[key].stat,
    file: states[key].file,
  } : null]));
}

function assertSourceFileSetUnchanged(before, after) {
  if (stableJson(fileSetIdentity(before)) !== stableJson(fileSetIdentity(after))) {
    fail('SOURCE_SQLITE_FILES_CHANGED', 'DB/WAL/SHM identity or bytes changed during simulation.');
  }
}

function copyInspectedSourceFile(source, destination) {
  let destinationFd;
  try {
    if (source?.fd === undefined) {
      fail('SOURCE_SQLITE_FILE_CHANGED', `${source?.canonicalName || 'SQLite source'} is not held open.`);
    }
    const sourceFd = source.fd;
    const canonicalBefore = nativeRealpathSync(source.resolved);
    assertOfflineFrozenDatabasePath(canonicalBefore);
    const sourceBefore = fs.fstatSync(sourceFd);
    const sourcePathState = fs.lstatSync(source.resolved);
    if (
      !isSamePath(canonicalBefore, source.resolved)
      || !sourceBefore.isFile()
      || Number(sourceBefore.nlink) !== 1
      || stableJson(statIdentity(sourceBefore)) !== stableJson(source.stat)
      || sourcePathState.isSymbolicLink()
      || !sameDeviceAndInode(sourceBefore, sourcePathState)
    ) {
      fail('SOURCE_SQLITE_FILE_CHANGED', `${source.canonicalName} changed before mirror copy.`);
    }

    destinationFd = fs.openSync(
      destination,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL
        | (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (position < Number(sourceBefore.size)) {
      const bytesRead = fs.readSync(
        sourceFd,
        buffer,
        0,
        Math.min(buffer.length, Number(sourceBefore.size) - position),
        position,
      );
      if (bytesRead === 0) {
        fail('SOURCE_SQLITE_FILE_CHANGED', `${source.canonicalName} changed during mirror copy.`);
      }
      let written = 0;
      while (written < bytesRead) {
        const bytesWritten = fs.writeSync(
          destinationFd,
          buffer,
          written,
          bytesRead - written,
          position + written,
        );
        if (bytesWritten === 0) {
          fail('EPHEMERAL_MIRROR_COPY_FAILED', 'The ephemeral mirror write made no progress.');
        }
        written += bytesWritten;
      }
      position += bytesRead;
    }
    fs.fchmodSync(destinationFd, 0o600);
    fs.fsyncSync(destinationFd);
    const sourceAfter = fs.fstatSync(sourceFd);
    const sourcePathAfter = fs.lstatSync(source.resolved);
    const canonicalAfter = nativeRealpathSync(source.resolved);
    assertOfflineFrozenDatabasePath(canonicalAfter);
    if (
      !sameStatIdentity(sourceBefore, sourceAfter)
      || !isSamePath(canonicalAfter, source.resolved)
      || sourcePathAfter.isSymbolicLink()
      || !sameDeviceAndInode(sourceAfter, sourcePathAfter)
    ) {
      fail('SOURCE_SQLITE_FILE_CHANGED', `${source.canonicalName} changed during mirror copy.`);
    }
  } catch (error) {
    if (error instanceof FreshIdentitySimulationError) throw error;
    fail('SOURCE_SQLITE_FILE_CHANGED', `${source.canonicalName} could not be copied safely.`);
  } finally {
    if (destinationFd !== undefined) fs.closeSync(destinationFd);
  }
}

function createEphemeralMirror(sourceStates) {
  const root = resolveSafeEphemeralRoot();
  const directory = fs.mkdtempSync(
    path.join(root.canonical, 'skytech-identity-auth-sim-'),
  );
  fs.chmodSync(directory, 0o700);
  const directoryBinding = canonicalExistingDirectory(directory, {
    code: 'EPHEMERAL_MIRROR_PATH_INVALID',
    label: 'Ephemeral mirror directory',
  });
  if (!isPathWithin(directoryBinding.canonical, root.canonical)) {
    fail('EPHEMERAL_MIRROR_PATH_INVALID', 'Ephemeral mirror escaped its validated root.');
  }
  const dbPath = path.join(directory, 'app.sqlite');
  try {
    copyInspectedSourceFile(sourceStates.database, dbPath);
    if (sourceStates.wal) {
      copyInspectedSourceFile(sourceStates.wal, `${dbPath}-wal`);
    }
    const mirrorStates = inspectSourceFileSet(dbPath);
    for (const key of ['database', 'wal']) {
      if (stableJson(sourceStates[key]?.file || null) !== stableJson(mirrorStates[key]?.file || null)) {
        fail('EPHEMERAL_MIRROR_COPY_MISMATCH', `The ephemeral ${key} copy is not byte-exact.`);
      }
    }
    return {
      directory: directoryBinding.canonical,
      directoryStat: statIdentity(directoryBinding.state),
      root: root.canonical,
      dbPath: path.join(directoryBinding.canonical, 'app.sqlite'),
    };
  } catch (error) {
    removeEphemeralMirror({
      directory: directoryBinding.canonical,
      directoryStat: statIdentity(directoryBinding.state),
      root: root.canonical,
    });
    throw error;
  }
}

function removeEphemeralMirror(mirror) {
  const expectedPrefix = path.join(mirror?.root || '', 'skytech-identity-auth-sim-');
  let current;
  try {
    current = fs.lstatSync(mirror?.directory || '');
  } catch {
    fail('EPHEMERAL_MIRROR_PATH_INVALID', 'Ephemeral simulation path cannot be revalidated.');
  }
  if (
    !mirror?.directory
    || !mirror?.directoryStat
    || !mirror?.root
    || !mirror.directory.startsWith(expectedPrefix)
    || current.isSymbolicLink()
    || !current.isDirectory()
    || String(current.dev) !== mirror.directoryStat.dev
    || String(current.ino) !== mirror.directoryStat.ino
    || (Number(current.mode) & 0o777) !== 0o700
    || !isSamePath(nativeRealpathSync(mirror.directory), mirror.directory)
  ) {
    fail('EPHEMERAL_MIRROR_PATH_INVALID', 'Refusing to remove an unexpected simulation path.');
  }
  fs.rmSync(mirror.directory, { recursive: true, force: true });
  if (fs.existsSync(mirror.directory)) {
    fail('EPHEMERAL_MIRROR_NOT_REMOVED', 'The ephemeral simulation mirror was not removed.');
  }
}

function sourceCollectionFingerprints(db) {
  const rows = db.prepare('SELECT name, json FROM app_data ORDER BY name').all();
  return Object.fromEntries(rows.map(row => [row.name, sha256(row.json)]));
}

function exactSimulationSource(reviewBundle) {
  return {
    captureDeployedSha: reviewBundle.source.captureDeployedSha,
    captureDeploymentId: reviewBundle.source.captureDeploymentId,
    railwayIdentity: structuredClone(reviewBundle.source.railwayIdentity),
    deploymentIdentity: structuredClone(reviewBundle.source.deploymentIdentity),
    sourceSnapshotHash: reviewBundle.source.sourceSnapshotHash,
    sourceFileSetHash: reviewBundle.source.sourceFileSetHash,
    sourceObservedFileSetHash: reviewBundle.source.sourceObservedFileSetHash,
    databaseContentFingerprint: reviewBundle.source.databaseContentFingerprint,
    schemaFingerprint: reviewBundle.source.schemaFingerprint,
  };
}

function assertExactSourceBindings(db, sourceStates, reviewBundle, authorizedExecutionSha) {
  if (reviewBundle.source.captureDeployedSha !== authorizedExecutionSha) {
    fail(
      'AUTHORIZED_EXECUTION_SHA_MISMATCH',
      'The authorized mechanism SHA differs from the fresh capture deployment SHA.',
    );
  }
  const fileSet = fileSetProjection(sourceStates);
  const sourceFileSetHash = sqliteFileSetFingerprint(fileSet);
  const sourceObservedFileSetHash = sqliteObservedFileSetFingerprint(fileSet);
  const databaseFingerprint = databaseContentFingerprint(db);
  const schemaFingerprint = getSchemaFingerprint(db);
  const sourceSnapshotHash = calculateSourceSnapshotHash({
    captureDeployedSha: reviewBundle.source.captureDeployedSha,
    captureDeploymentId: reviewBundle.source.captureDeploymentId,
    railwayIdentity: reviewBundle.source.railwayIdentity,
    deploymentIdentity: reviewBundle.source.deploymentIdentity,
    sourceFileSet: fileSetRows(sourceStates),
    collectionFingerprints: sourceCollectionFingerprints(db),
  });
  const actual = {
    sourceSnapshotHash,
    sourceFileSetHash,
    sourceObservedFileSetHash,
    databaseContentFingerprint: databaseFingerprint,
    schemaFingerprint,
  };
  const expected = Object.fromEntries(Object.keys(actual).map(key => [key, reviewBundle.source[key]]));
  if (stableJson(actual) !== stableJson(expected)) {
    fail('FRESH_SOURCE_BINDING_MISMATCH', 'The retained SQLite capture differs from the reviewed source.');
  }
  if (
    stableJson(reviewBundle.platformDefaultTenantOverlaySemantics)
      !== stableJson(PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT)
  ) {
    fail('OVERLAY_SEMANTICS_BINDING_MISMATCH', 'The reviewed overlay-semantics contract is stale.');
  }
  return { databaseFingerprint, schemaFingerprint };
}

function expectedBeforeCounts() {
  return Object.fromEntries(Object.keys(EXPECTED_ROW_COUNT_DELTAS).map(table => [table, 0]));
}

function assertExactIdentityPlan(identityPlan) {
  const expectedMapped = [OWNER_PRINCIPAL_ID];
  const expectedUnmapped = [...AUTHORITY.intentionallyUnmappedUserIds];
  const expectedEligible = [OWNER_PRINCIPAL_ID, ...expectedUnmapped];
  if (
    identityPlan.mode !== 'plan'
    || identityPlan.ok !== true
    || identityPlan.writes !== 0
    || identityPlan.blockers.length !== 0
    || identityPlan.warnings.length !== 0
    || stableJson(identityPlan.beforeCounts) !== stableJson(expectedBeforeCounts())
    || stableJson(identityPlan.afterCounts) !== stableJson(EXPECTED_ROW_COUNT_DELTAS)
    || stableJson(identityPlan.exactChanges) !== stableJson(EXPECTED_EXACT_CHANGES)
    || stableJson(identityPlan.mappedUserIds) !== stableJson(expectedMapped)
    || stableJson(identityPlan.intentionallyUnmappedUserIds) !== stableJson(expectedUnmapped)
    || stableJson(identityPlan.eligibleActiveUserIds) !== stableJson(expectedEligible)
  ) {
    fail('IDENTITY_PLAN_NOT_EXACT', 'The retained capture does not produce the exact approved identity plan.');
  }
}

function semanticSimulationPlan(reviewBundle, sourceStates) {
  const plan = structuredClone(reviewBundle.executionPlan);
  plan.backup = {
    verified: true,
    reference: 'READ_ONLY_SIMULATION_ONLY',
    sourceDbIdentity: sha256(stableJson(plan.expected.dbIdentity)),
    timestamp: plan.authority.identityBootstrap.approval.approvedAt,
    sizeBytes: sourceStates.database.file.sizeBytes,
    sha256: sourceStates.database.file.sha256,
  };
  plan.authority.identityBootstrap.approval.backupReference = 'READ_ONLY_SIMULATION_ONLY';
  return plan;
}

function assertReviewAndSemanticPreviews(db, reviewBundle, sourceStates) {
  const reviewPreview = planProductionScopeRemediation({
    db,
    plan: reviewBundle.executionPlan,
  });
  const nonBackupBlockers = reviewPreview.blockers.filter(blocker => (
    blocker?.code !== 'RECOVERABLE_BACKUP_NOT_VERIFIED'
  ));
  const backupBlockerCount = reviewPreview.blockers.length - nonBackupBlockers.length;
  if (
    reviewPreview.writes !== 0
    || reviewPreview.readyToApply !== false
    || backupBlockerCount !== 1
    || nonBackupBlockers.length !== 0
  ) {
    fail(
      'REVIEW_PLAN_PREFLIGHT_INVALID',
      'The reviewed plan must be blocked only by the future recoverable-backup binding.',
    );
  }

  const semanticPreview = planProductionScopeRemediation({
    db,
    plan: semanticSimulationPlan(reviewBundle, sourceStates),
  });
  const createKeys = semanticPreview.plannedDiff.CREATE
    .map(row => `${row.type}:${row.id}`)
    .sort();
  if (
    semanticPreview.ok !== true
    || semanticPreview.readyToApply !== true
    || semanticPreview.writes !== 0
    || semanticPreview.blockers.length !== 0
    || stableJson(semanticPreview.observed.targetCollections) !== '[]'
    || stableJson(createKeys) !== stableJson(EXPECTED_IDENTITY_CREATE_KEYS)
    || semanticPreview.plannedDiff.UPDATE.length !== 0
    || semanticPreview.plannedDiff.RELINK.length !== 0
    || semanticPreview.plannedDiff.UNRESOLVED.length !== 0
    || semanticPreview.smokeIdentity.enabled !== false
  ) {
    fail('IDENTITY_SEMANTIC_SIMULATION_FAILED', 'The read-only semantic preview is not identity-only and exact.');
  }
  return nonBackupBlockers.length;
}

function exactIdentityResult() {
  return {
    companyCount: EXPECTED_EXACT_CHANGES.companies,
    headOfficeCount: EXPECTED_EXACT_CHANGES.branches,
    roleTemplateCount: EXPECTED_EXACT_CHANGES.roleTemplates,
    roleTemplateCapabilityCount: EXPECTED_EXACT_CHANGES.roleTemplateCapabilities,
    membershipCount: EXPECTED_EXACT_CHANGES.memberships,
    branchGrantCount: EXPECTED_EXACT_CHANGES.branchGrants,
    directCapabilityAssignmentCount: EXPECTED_EXACT_CHANGES.capabilityAssignments,
    authorizationAuditEventCount: EXPECTED_EXACT_CHANGES.authorizationAuditEvents,
    identityBootstrapRunCount: EXPECTED_EXACT_CHANGES.bootstrapRuns,
    membershipPrincipalIds: [OWNER_PRINCIPAL_ID],
    mappedPrincipalIds: [OWNER_PRINCIPAL_ID],
    intentionallyUnmappedPrincipalIds: [...AUTHORITY.intentionallyUnmappedUserIds],
    unmappedMembershipCount: 0,
  };
}

function zeroNonWriteSet() {
  return {
    appDataMutationCount: 0,
    businessDataMutationCount: 0,
    collectionWriteCount: 0,
    environmentMutationCount: 0,
    financialDataMutationCount: 0,
    migrationMutationCount: 0,
    recordMappingCount: 0,
    relationMappingCount: 0,
    schemaMutationCount: 0,
    smokeIdentityMutationCount: 0,
    tenantGuardMutationCount: 0,
    userRecordMutationCount: 0,
  };
}

function simulateFreshIdentityAuthorization({
  db: dbPath,
  reviewBundle,
  authorizedExecutionSha,
}) {
  if (!dbPath) fail('DATABASE_PATH_REQUIRED', '--db is required.');
  if (!reviewBundle || typeof reviewBundle !== 'object' || Array.isArray(reviewBundle)) {
    fail('REVIEW_BUNDLE_REQUIRED', 'A parsed review-only execution bundle is required.');
  }
  if (!SHA40_PATTERN.test(exactText(authorizedExecutionSha))) {
    fail('AUTHORIZED_EXECUTION_SHA_INVALID', '--authorized-execution-sha must be exact lowercase 40-hex.');
  }
  const validatedBundle = validateProductionScopeExecutionBundle(reviewBundle);
  if (
    validatedBundle.authorized !== false
    || reviewBundle.productionExecutionAuthorized !== false
    || reviewBundle.authorization !== null
  ) {
    fail('REVIEW_ONLY_BUNDLE_REQUIRED', 'Fresh simulation requires a non-authorizing review-only bundle.');
  }

  const sourceStatesBefore = inspectSourceFileSet(dbPath, { holdOpen: true });
  let mirror;
  try {
    mirror = createEphemeralMirror(sourceStatesBefore);
  } finally {
    closeInspectedSourceFiles(sourceStatesBefore);
  }
  let db;
  let provisional;
  try {
    db = new Database(mirror.dbPath, { readonly: true, fileMustExist: true });
    db.pragma('query_only = ON');
    db.pragma('foreign_keys = ON');
    if (db.pragma('query_only', { simple: true }) !== 1) {
      fail('SQLITE_QUERY_ONLY_NOT_ENABLED', 'SQLite query_only could not be enabled.');
    }
    if (db.pragma('foreign_keys', { simple: true }) !== 1) {
      fail('SQLITE_FOREIGN_KEYS_NOT_ENABLED', 'SQLite foreign keys could not be enabled.');
    }

    const totalChangesBefore = Number(db.prepare('SELECT total_changes() AS count').get().count);
    if (totalChangesBefore !== 0) {
      fail('READ_ONLY_SIMULATION_REPORTED_WRITES', 'The fresh readonly connection began with changes.');
    }
    const sourceEvidence = assertExactSourceBindings(
      db,
      sourceStatesBefore,
      reviewBundle,
      authorizedExecutionSha,
    );
    const appDataBefore = sha256(stableJson(
      db.prepare('SELECT * FROM app_data ORDER BY name').all(),
    ));
    const contentBefore = sourceEvidence.databaseFingerprint;
    const schemaBefore = sourceEvidence.schemaFingerprint;

    const identityPlan = planPlatformIdentityBootstrap(
      db,
      reviewBundle.executionPlan.authority.identityBootstrap,
    );
    assertExactIdentityPlan(identityPlan);
    const nonBackupPreflightBlockerCount = assertReviewAndSemanticPreviews(
      db,
      reviewBundle,
      sourceStatesBefore,
    );

    const quickCheckRows = db.pragma('quick_check').map(row => String(Object.values(row)[0]));
    const foreignKeyFailures = db.pragma('foreign_key_check');
    const totalChangesAfter = Number(db.prepare('SELECT total_changes() AS count').get().count);
    const appDataAfter = sha256(stableJson(
      db.prepare('SELECT * FROM app_data ORDER BY name').all(),
    ));
    const contentAfter = databaseContentFingerprint(db);
    const schemaAfter = getSchemaFingerprint(db);
    if (
      totalChangesAfter !== totalChangesBefore
      || appDataAfter !== appDataBefore
      || contentAfter !== contentBefore
      || schemaAfter !== schemaBefore
    ) {
      fail('READ_ONLY_SIMULATION_REPORTED_WRITES', 'Read-only state changed during simulation.');
    }
    if (stableJson(quickCheckRows) !== stableJson(['ok']) || foreignKeyFailures.length !== 0) {
      fail('SQLITE_INTEGRITY_CHECK_FAILED', 'The retained capture failed SQLite integrity checks.');
    }

    provisional = {
      simulationVersion: 1,
      classification: IDENTITY_SIMULATION_CLASSIFICATION,
      status: 'PASS',
      executionScope: 'IDENTITY_ONLY',
      productionExecutionAuthorized: false,
      productionWritePerformed: false,
      writesPerformed: 0,
      authorizationBindingsComplete: true,
      authorizedExecutionSha,
      authorityConfigChecksum:
        reviewBundle.executionPlan.authority.identityBootstrap.approval.configChecksum,
      unresolvedAuthorizationBindings: [],
      invariantViolations: [],
      source: exactSimulationSource(reviewBundle),
      manifest: { sha256: reviewBundle.scopeManifestSha256 },
      executionPlanBundle: {
        bundleSha256: reviewBundle.bundleSha256,
        executionPlanSha256: reviewBundle.executionPlanSha256,
        scopeManifestSha256: reviewBundle.scopeManifestSha256,
        productionExecutionAuthorized: false,
        status: 'REVIEW_REQUIRED',
        nonBackupPreflightBlockerCount,
      },
      readOnlyProof: {
        sourceDatabaseOpenedBySqlite: false,
        simulationDatabaseSource: 'EPHEMERAL_LOCAL_MIRROR',
        sqliteOpenMode: 'readonly',
        sqliteQueryOnly: true,
        sqliteForeignKeys: true,
        totalChangesBefore,
        totalChangesAfter,
        totalChangesDelta: totalChangesAfter - totalChangesBefore,
        foreignKeyFailureCount: foreignKeyFailures.length,
        sqliteFilesByteIdentical: true,
        ephemeralMirrorRemoved: true,
      },
      integrity: {
        quickCheck: 'ok',
        foreignKeyViolationCount: foreignKeyFailures.length,
      },
      identity: exactIdentityResult(),
      nonWriteSet: zeroNonWriteSet(),
    };
  } finally {
    if (db?.open) db.close();
    removeEphemeralMirror(mirror);
  }

  const sourceStatesAfter = inspectSourceFileSet(dbPath);
  assertSourceFileSetUnchanged(sourceStatesBefore, sourceStatesAfter);
  if (fs.existsSync(mirror.directory)) {
    fail('EPHEMERAL_MIRROR_NOT_REMOVED', 'The ephemeral simulation mirror still exists.');
  }
  validateIdentitySimulation(provisional, reviewBundle);
  return provisional;
}

function canonicalOutputTarget(outputPath) {
  const requested = path.resolve(outputPath);
  const requestedParent = path.dirname(requested);
  try {
    const canonicalParent = nativeRealpathSync(requestedParent);
    const requestedParentState = fs.statSync(requestedParent);
    const canonicalParentState = fs.lstatSync(canonicalParent);
    if (
      !requestedParentState.isDirectory()
      || canonicalParentState.isSymbolicLink()
      || !canonicalParentState.isDirectory()
      || !sameDeviceAndInode(requestedParentState, canonicalParentState)
      || nativeRealpathSync(requestedParent) !== canonicalParent
    ) {
      fail('OUTPUT_PARENT_INVALID', 'An output parent changed while it was canonicalized.');
    }
    return {
      target: path.join(canonicalParent, path.basename(requested)),
      parent: {
        path: canonicalParent,
        dev: String(canonicalParentState.dev),
        ino: String(canonicalParentState.ino),
      },
    };
  } catch (error) {
    if (error instanceof FreshIdentitySimulationError) throw error;
    fail('OUTPUT_PARENT_INVALID', 'An output parent cannot be resolved safely.');
  }
}

function uniqueOutputParents(bindings) {
  const unique = new Map();
  for (const binding of bindings) {
    const previous = unique.get(binding.path);
    if (
      previous
      && (previous.dev !== binding.dev || previous.ino !== binding.ino)
    ) {
      fail('OUTPUT_PARENT_CHANGED', 'An output parent changed during path validation.');
    }
    unique.set(binding.path, binding);
  }
  return [...unique.values()];
}

function assertOutputParentsUnchanged(bindings) {
  for (const binding of bindings) {
    try {
      const current = fs.lstatSync(binding.path);
      if (
        current.isSymbolicLink()
        || !current.isDirectory()
        || String(current.dev) !== binding.dev
        || String(current.ino) !== binding.ino
        || nativeRealpathSync(binding.path) !== binding.path
      ) {
        fail('OUTPUT_PARENT_CHANGED', 'An output parent changed before evidence publication completed.');
      }
    } catch (error) {
      if (error instanceof FreshIdentitySimulationError) throw error;
      fail('OUTPUT_PARENT_CHANGED', 'An output parent changed before evidence publication completed.');
    }
  }
}

function assertOutputPaths({ dbPath, reviewBundlePath, outputPath, outputSha256Path }) {
  let potentialDb;
  let potentialOutputs;
  try {
    potentialDb = canonicalPathAllowMissing(dbPath);
    potentialOutputs = [
      canonicalPathAllowMissing(outputPath),
      canonicalPathAllowMissing(outputSha256Path),
    ];
  } catch {
    fail('OUTPUT_PATH_INVALID', 'Input and output paths must resolve canonically.');
  }
  assertOfflineFrozenDatabasePath(potentialDb);
  const restricted = canonicalRestrictedPaths();
  if (potentialOutputs.some(output => (
    isPathWithin(output, restricted.productionDataRoot)
    || restricted.liveDatabaseFiles.has(pathComparisonKey(output))
  ))) {
    fail('OUTPUT_PATH_INVALID', 'Output paths cannot target production or repository live SQLite files.');
  }

  const database = canonicalExistingRegularFile(dbPath, {
    code: 'SOURCE_SQLITE_FILE_INVALID',
    label: SQLITE_FILE_NAMES.database,
  });
  assertOfflineFrozenDatabasePath(database.canonical);
  const reviewBundle = canonicalExistingRegularFile(reviewBundlePath, {
    code: 'REVIEW_BUNDLE_PATH_INVALID',
    label: 'Fresh identity review bundle',
  });
  const output = canonicalOutputTarget(outputPath);
  const outputSha256 = canonicalOutputTarget(outputSha256Path);
  const outputParents = uniqueOutputParents([output.parent, outputSha256.parent]);
  const resolved = {
    db: database.canonical,
    reviewBundle: reviewBundle.canonical,
    output: output.target,
    outputSha256: outputSha256.target,
    outputParents,
  };
  const sourcePaths = new Set([
    resolved.db,
    `${resolved.db}-wal`,
    `${resolved.db}-shm`,
    resolved.reviewBundle,
  ].map(pathComparisonKey));
  if (
    isSamePath(resolved.output, resolved.outputSha256)
    || sourcePaths.has(pathComparisonKey(resolved.output))
    || sourcePaths.has(pathComparisonKey(resolved.outputSha256))
    || isPathWithin(resolved.output, restricted.productionDataRoot)
    || isPathWithin(resolved.outputSha256, restricted.productionDataRoot)
    || restricted.liveDatabaseFiles.has(pathComparisonKey(resolved.output))
    || restricted.liveDatabaseFiles.has(pathComparisonKey(resolved.outputSha256))
  ) {
    fail('OUTPUT_PATH_INVALID', 'Output paths must be distinct from each other and every input file.');
  }
  for (const output of [resolved.output, resolved.outputSha256]) {
    try {
      fs.lstatSync(output);
      fail('OUTPUT_ALREADY_EXISTS', `Refusing to overwrite existing output: ${path.basename(output)}`);
    } catch (error) {
      if (error instanceof FreshIdentitySimulationError) throw error;
      if (error?.code !== 'ENOENT') throw error;
    }
  }
  assertOutputParentsUnchanged(outputParents);
  return resolved;
}

function safeUnlinkCreated(filePath, expectedStat) {
  try {
    const actual = fs.lstatSync(filePath);
    if (
      actual.isFile()
      && !actual.isSymbolicLink()
      && String(actual.dev) === String(expectedStat.dev)
      && String(actual.ino) === String(expectedStat.ino)
    ) {
      fs.unlinkSync(filePath);
    }
  } catch {}
}

function assertCreatedOutput(fd, filePath, expectedSize, previousState = null) {
  const descriptorState = fs.fstatSync(fd);
  const pathState = fs.lstatSync(filePath);
  if (
    !descriptorState.isFile()
    || Number(descriptorState.nlink) !== 1
    || Number(descriptorState.size) !== expectedSize
    || (Number(descriptorState.mode) & 0o777) !== 0o600
    || pathState.isSymbolicLink()
    || !pathState.isFile()
    || !sameStatIdentity(descriptorState, pathState)
    || (previousState && !sameStatIdentity(previousState, descriptorState))
  ) {
    fail('OUTPUT_VERIFICATION_FAILED', 'Written simulation evidence changed during publication.');
  }
  return descriptorState;
}

function readExactFileDescriptor(fd, expectedSize) {
  const bytes = Buffer.alloc(expectedSize);
  let position = 0;
  while (position < expectedSize) {
    const bytesRead = fs.readSync(fd, bytes, position, expectedSize - position, position);
    if (bytesRead === 0) break;
    position += bytesRead;
  }
  if (position !== expectedSize) {
    fail('OUTPUT_VERIFICATION_FAILED', 'Written simulation evidence could not be read exactly.');
  }
  return bytes;
}

function writeExclusiveEvidence(
  outputPath,
  outputSha256Path,
  bytes,
  digest,
  outputParents,
) {
  const created = [];
  let outputFd;
  let shaFd;
  const parentBindings = uniqueOutputParents(outputParents || []);
  if (
    parentBindings.length === 0
    || !parentBindings.some(binding => binding.path === path.dirname(outputPath))
    || !parentBindings.some(binding => binding.path === path.dirname(outputSha256Path))
  ) {
    fail('OUTPUT_PARENT_INVALID', 'Every output path must have a validated canonical parent.');
  }
  const flags = fs.constants.O_RDWR
    | fs.constants.O_CREAT
    | fs.constants.O_EXCL
    | (fs.constants.O_NOFOLLOW || 0);
  try {
    assertOutputParentsUnchanged(parentBindings);
    outputFd = fs.openSync(outputPath, flags, 0o600);
    created.push({ path: outputPath, stat: fs.fstatSync(outputFd) });
    assertOutputParentsUnchanged(parentBindings);
    shaFd = fs.openSync(outputSha256Path, flags, 0o600);
    created.push({ path: outputSha256Path, stat: fs.fstatSync(shaFd) });
    fs.fchmodSync(outputFd, 0o600);
    fs.fchmodSync(shaFd, 0o600);
    fs.writeFileSync(outputFd, bytes);
    fs.writeFileSync(shaFd, `${digest}\n`, 'utf8');
    fs.fsyncSync(outputFd);
    fs.fsyncSync(shaFd);
    assertOutputParentsUnchanged(parentBindings);

    const sidecarBytes = Buffer.from(`${digest}\n`, 'utf8');
    const outputState = assertCreatedOutput(outputFd, outputPath, bytes.length);
    const shaState = assertCreatedOutput(shaFd, outputSha256Path, sidecarBytes.length);
    if (
      sha256(readExactFileDescriptor(outputFd, bytes.length)) !== digest
      || !readExactFileDescriptor(shaFd, sidecarBytes.length).equals(sidecarBytes)
    ) {
      fail('OUTPUT_VERIFICATION_FAILED', 'Written simulation evidence could not be verified.');
    }
    assertOutputParentsUnchanged(parentBindings);
    const verifiedOutputState = assertCreatedOutput(
      outputFd,
      outputPath,
      bytes.length,
      outputState,
    );
    const verifiedShaState = assertCreatedOutput(
      shaFd,
      outputSha256Path,
      sidecarBytes.length,
      shaState,
    );
    return [
      { path: outputPath, stat: verifiedOutputState },
      { path: outputSha256Path, stat: verifiedShaState },
    ];
  } catch (error) {
    for (const item of created.reverse()) safeUnlinkCreated(item.path, item.stat);
    for (const handle of [outputFd, shaFd]) {
      if (handle !== undefined) {
        try { fs.closeSync(handle); } catch {}
      }
    }
    outputFd = undefined;
    shaFd = undefined;
    if (error?.code === 'EEXIST') {
      fail('OUTPUT_ALREADY_EXISTS', 'Refusing to overwrite an existing output artifact.');
    }
    throw error;
  } finally {
    if (outputFd !== undefined) fs.closeSync(outputFd);
    if (shaFd !== undefined) fs.closeSync(shaFd);
  }
}

function produceFreshIdentitySimulation(args) {
  for (const [key, flag] of [
    ['db', '--db'],
    ['reviewBundle', '--review-bundle'],
    ['reviewBundleSha256', '--review-bundle-sha256'],
    ['authorizedExecutionSha', '--authorized-execution-sha'],
    ['output', '--output'],
    ['outputSha256', '--output-sha256'],
  ]) {
    if (!args?.[key]) fail('ARGUMENT_REQUIRED', `${flag} is required.`);
  }
  if (!SHA256_PATTERN.test(exactText(args.reviewBundleSha256))) {
    fail('REVIEW_BUNDLE_HASH_INVALID', '--review-bundle-sha256 must be exact lowercase SHA-256.');
  }
  if (!SHA40_PATTERN.test(exactText(args.authorizedExecutionSha))) {
    fail('AUTHORIZED_EXECUTION_SHA_INVALID', '--authorized-execution-sha must be exact lowercase 40-hex.');
  }
  const paths = assertOutputPaths({
    dbPath: args.db,
    reviewBundlePath: args.reviewBundle,
    outputPath: args.output,
    outputSha256Path: args.outputSha256,
  });
  const reviewed = readHashBoundJson(
    paths.reviewBundle,
    args.reviewBundleSha256,
    'IDENTITY_SIMULATION_REVIEW_BUNDLE',
    'Fresh identity review bundle',
  );
  const result = simulateFreshIdentityAuthorization({
    db: paths.db,
    reviewBundle: reviewed.value,
    authorizedExecutionSha: args.authorizedExecutionSha,
  });
  // Re-read the independently pinned review artifact after the simulation so
  // an in-flight replacement cannot become the evidence source.
  const reviewedAfter = readHashBoundJson(
    paths.reviewBundle,
    args.reviewBundleSha256,
    'IDENTITY_SIMULATION_REVIEW_BUNDLE',
    'Fresh identity review bundle',
  );
  if (stableJson(reviewed.value) !== stableJson(reviewedAfter.value)) {
    fail('REVIEW_BUNDLE_CHANGED', 'The review bundle changed during simulation.');
  }

  const bytes = Buffer.from(`${JSON.stringify(result, null, 2)}\n`, 'utf8');
  const digest = sha256(bytes);
  writeExclusiveEvidence(
    paths.output,
    paths.outputSha256,
    bytes,
    digest,
    paths.outputParents,
  );
  return { result, sha256: digest };
}

function main() {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      process.stdout.write(`${usage()}\n`);
      return;
    }
    const produced = produceFreshIdentitySimulation(args);
    process.stdout.write(`${JSON.stringify({
      ok: true,
      classification: produced.result.classification,
      sha256: produced.sha256,
    })}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      code: error.code || 'FRESH_IDENTITY_SIMULATION_FAILED',
      message: error.message,
    })}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) main();

module.exports = {
  FreshIdentitySimulationError,
  assertOutputPaths,
  copyInspectedSourceFile,
  produceFreshIdentitySimulation,
  resolveSafeEphemeralRoot,
  simulateFreshIdentityAuthorization,
  writeExclusiveEvidence,
};
