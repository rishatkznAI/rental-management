const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const Database = require('better-sqlite3');
const {
  ALL_APP_DATA_COLLECTIONS,
  COLLECTION_SCOPE_CATEGORY,
  COLLECTION_SCOPE_REGISTRY,
  COLLECTION_SHAPE,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
} = require('./app-data-scope-registry');
const {
  collectionFingerprint,
  databaseIdentity,
  identityCounts,
  stableJson,
} = require('./production-scope-remediation');
const {
  buildUserInventory,
  databaseContentFingerprint,
  sqliteFileSetFingerprint,
  sqliteObservedFileSetFingerprint,
} = require('./production-scope-remediation-runner');
const { deriveCanonicalCompanyId } = require('./canonical-company-id');
const {
  deriveCanonicalHeadOfficeId,
  deriveCanonicalMembershipId,
} = require('./canonical-authority-id');
const reviewedEnvironment = require('../config/production-scope-remediation-environment');
const reviewedPlan = require('../config/production-scope-remediation-plan');
const productionBaselineContract = require('../config/production-scope-baseline-authority.json');
const {
  deriveAndVerifyBaselineCandidates,
  stableJsonSha256: baselineStableJsonSha256,
  validateBaselineContract,
} = require('./production-scope-baseline-contract');
const {
  PRODUCTION_CLASSIFICATION_CONTRACT,
  classificationAuthoritySnapshot,
  createProductionScopeClassificationAuthority,
} = require('./production-scope-evidence-classification');

const REPOSITORY_ROOT = path.resolve(__dirname, '../..');
const SQLITE_FILE_NAMES = Object.freeze([
  'app.sqlite',
  'app.sqlite-wal',
  'app.sqlite-shm',
]);
const REQUIRED_SOURCE_BINDING_PATHS = Object.freeze([
  'server/config/production-scope-baseline-authority.json',
  'server/config/production-scope-remediation-environment.js',
  'server/config/production-scope-remediation-plan.js',
  'server/lib/app-data-scope-registry.js',
  'server/lib/canonical-authority-id.js',
  'server/lib/canonical-company-id.js',
  'server/lib/frozen-production-sqlite-capture.js',
  'server/lib/platform-default-tenant-overlay.js',
  'server/lib/platform-identity-bootstrap-validation.js',
  'server/lib/production-scope-baseline-contract.js',
  'server/lib/production-scope-evidence-builder.js',
  'server/lib/production-scope-evidence-classification.js',
  'server/lib/production-scope-execution-plan-bundle.js',
  'server/lib/production-scope-remediation-manifest.js',
  'server/lib/production-scope-remediation-runner.js',
  'server/lib/production-scope-remediation.js',
  'server/lib/production-smoke-identity.js',
  'server/lib/trusted-actor-scope.js',
  'server/scripts/build-production-scope-evidence.js',
  'server/scripts/capture-frozen-production-sqlite.js',
  'server/scripts/simulate-production-scope-remediation.js',
  'server/scripts/verify-production-scope-local-visibility.js',
].sort());
const PRODUCTION_BASELINE_CONTRACT = validateBaselineContract(productionBaselineContract);
const PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT = Object.freeze({
  contractVersion: 1,
  model: 'PLATFORM_DEFAULTS_PLUS_TENANT_OWNED_OVERLAYS',
  families: Object.freeze([...PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS]),
  platformDefaultPolicy: 'PRESERVE_UNSCOPED_NO_MIGRATION',
  tenantEntryPolicy: 'PRESERVE_EXACT_TENANT_SCOPE_NO_MIGRATION',
  overrideLinkField: 'platformDefaultId',
  overrideLinkPolicy: 'EXPLICIT_SAME_FAMILY_PLATFORM_DEFAULT_PHYSICAL_ID_ONLY',
  naturalKeyLinking: 'FORBIDDEN',
  automaticBackfill: 'FORBIDDEN',
  effectiveReadPolicy: 'PLATFORM_DEFAULTS_PLUS_EXACT_TENANT_ROWS_OVERRIDE_WINS_WITHIN_TENANT',
  malformedStatePolicy: 'FAIL_CLOSED',
});
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const MAX_CAPTURE_AGE_MS = 24 * 60 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

class ProductionScopeEvidenceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ProductionScopeEvidenceError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new ProductionScopeEvidenceError(code, message, details);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function text(value) {
  return String(value ?? '').trim();
}

function assertExactKeys(value, expected, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (stableJson(actual) !== stableJson(wanted)) {
    fail(code, `${label} has missing or unreviewed fields.`, { actual, expected: wanted });
  }
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

function hashFileDescriptor(fd, expectedSize = null) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (true) {
    const bytesRead = fs.readSync(fd, buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    hash.update(buffer.subarray(0, bytesRead));
    position += bytesRead;
  }
  if (expectedSize !== null && position !== expectedSize) {
    fail('INPUT_FILE_CHANGED', 'A bound file changed while it was being hashed.');
  }
  return { size: position, sha256: hash.digest('hex') };
}

function readRegularFileNoFollow(filePath, code, label) {
  const resolved = path.resolve(filePath);
  let fd;
  try {
    const beforePath = fs.lstatSync(resolved);
    if (!beforePath.isFile() || beforePath.isSymbolicLink()) {
      fail(code, `${label} must be a non-symlink regular file.`);
    }
    fd = fs.openSync(resolved, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(fd);
    if (!before.isFile() || Number(before.nlink) !== 1) {
      fail(code, `${label} must be a singly linked regular file.`);
    }
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    const afterPath = fs.lstatSync(resolved);
    if (
      !sameStatIdentity(before, after)
      || String(before.dev) !== String(afterPath.dev)
      || String(before.ino) !== String(afterPath.ino)
      || bytes.length !== Number(before.size)
    ) {
      fail('INPUT_FILE_CHANGED', `${label} changed while it was being read.`);
    }
    return { bytes, sha256: sha256(bytes), size: bytes.length, resolved };
  } catch (error) {
    if (error instanceof ProductionScopeEvidenceError) throw error;
    fail(code, `${label} cannot be read safely.`);
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function readHashBoundJson(filePath, expectedSha256, code, label) {
  const expected = text(expectedSha256).toLowerCase();
  if (!SHA256_PATTERN.test(expected)) {
    fail(`${code}_HASH_REQUIRED`, `${label} requires an externally reviewed SHA-256.`);
  }
  const input = readRegularFileNoFollow(filePath, `${code}_FILE_INVALID`, label);
  if (input.sha256 !== expected) {
    fail(`${code}_HASH_MISMATCH`, `${label} differs from its externally reviewed SHA-256.`);
  }
  try {
    return { ...input, value: JSON.parse(input.bytes.toString('utf8')) };
  } catch {
    fail(`${code}_JSON_INVALID`, `${label} is not valid JSON.`);
  }
}

function repositoryHeadSha() {
  let result;
  try {
    result = execFileSync('git', ['rev-parse', 'HEAD^{commit}'], {
      cwd: REPOSITORY_ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim().toLowerCase();
  } catch {
    fail('REPOSITORY_HEAD_UNAVAILABLE', 'The exact repository HEAD cannot be resolved.');
  }
  if (!SHA40_PATTERN.test(result)) {
    fail('REPOSITORY_HEAD_INVALID', 'The repository HEAD is not an exact commit SHA.');
  }
  return result;
}

function normalizedControlFileState(row) {
  assertExactKeys(row, ['name', 'sha256', 'size'], 'CAPTURE_CONTROL_INVALID', 'Capture file state');
  const name = text(row.name);
  const size = Number(row.size);
  const hash = text(row.sha256).toLowerCase();
  if (
    !SQLITE_FILE_NAMES.includes(name)
    || !Number.isSafeInteger(size)
    || size < 0
    || !SHA256_PATTERN.test(hash)
  ) {
    fail('CAPTURE_CONTROL_INVALID', 'A capture file state is invalid.');
  }
  return { name, size, sha256: hash };
}

function normalizedControlRound(round, label) {
  assertExactKeys(round, ['captureId', 'capturedAt', 'files'], 'CAPTURE_CONTROL_INVALID', label);
  if (!UUID_PATTERN.test(text(round.captureId))) {
    fail('CAPTURE_CONTROL_INVALID', `${label} requires a UUID captureId.`);
  }
  if (!ISO_TIMESTAMP_PATTERN.test(text(round.capturedAt))) {
    fail('CAPTURE_CONTROL_INVALID', `${label} requires an exact UTC timestamp.`);
  }
  const files = Array.isArray(round.files) ? round.files.map(normalizedControlFileState) : [];
  if (stableJson(files.map(row => row.name)) !== stableJson(SQLITE_FILE_NAMES)) {
    fail('CAPTURE_CONTROL_INVALID', `${label} must bind DB, WAL, and SHM exactly once in canonical order.`);
  }
  if (files[0].size <= 0) {
    fail('CAPTURE_CONTROL_INVALID', `${label} has an empty SQLite database.`);
  }
  return { captureId: text(round.captureId), capturedAt: text(round.capturedAt), files };
}

function validateTimestamps(control, now) {
  const times = [
    control.captureWindowStartedAt,
    control.rounds.roundA.capturedAt,
    control.rounds.roundB.capturedAt,
    control.evidenceGeneratedAt,
  ].map(value => Date.parse(value));
  if (times.some(value => !Number.isFinite(value))) {
    fail('CAPTURE_TIMESTAMP_INVALID', 'Capture timestamps are invalid.');
  }
  const [windowStartedAt, roundAAt, roundBAt, generatedAt] = times;
  if (!(windowStartedAt <= roundAAt && roundAAt < roundBAt && roundBAt <= generatedAt)) {
    fail('CAPTURE_TIMESTAMP_ORDER_INVALID', 'Capture timestamps are not strictly ordered.');
  }
  const nowMs = now.getTime();
  if (generatedAt > nowMs + MAX_CLOCK_SKEW_MS || nowMs - roundBAt > MAX_CAPTURE_AGE_MS) {
    fail('CAPTURE_NOT_FRESH', 'The frozen capture is stale or has an invalid future timestamp.');
  }
}

function validateControl(value, now = new Date(), {
  environment = reviewedEnvironment,
  baselineContract = PRODUCTION_BASELINE_CONTRACT,
  classificationContract = PRODUCTION_CLASSIFICATION_CONTRACT,
} = {}) {
  assertExactKeys(value, [
    'analysisRound',
    'baseline',
    'captureWindowStartedAt',
    'classificationAuthorityFingerprint',
    'conservation',
    'controlVersion',
    'evidenceGeneratedAt',
    'networkAccessAuthorized',
    'productionWriteAuthorized',
    'railway',
    'rawCaptureSQLiteOpenAuthorized',
    'repository',
    'rounds',
    'sourceBindings',
  ], 'CAPTURE_CONTROL_INVALID', 'Capture control');
  if (
    value.controlVersion !== 2
    || value.productionWriteAuthorized !== false
    || value.networkAccessAuthorized !== false
    || value.rawCaptureSQLiteOpenAuthorized !== false
    || !['roundA', 'roundB'].includes(value.analysisRound)
  ) {
    fail('CAPTURE_CONTROL_INVALID', 'Capture control is not the offline read-only version-2 contract.');
  }
  if (
    !ISO_TIMESTAMP_PATTERN.test(text(value.captureWindowStartedAt))
    || !ISO_TIMESTAMP_PATTERN.test(text(value.evidenceGeneratedAt))
  ) {
    fail('CAPTURE_CONTROL_INVALID', 'Capture control timestamps must be exact UTC timestamps.');
  }
  assertExactKeys(value.conservation, [
    'adminResetDisabled',
    'allowedModesEmpty',
    'appDisabled',
    'botDisabled',
    'cleanResetDisabled',
    'gsmDisabled',
    'gsmEnabled',
    'schemaCompatibilityDisabled',
    'singleReplica',
    'storageWriteGuardEnabled',
  ], 'CAPTURE_CONTROL_INVALID', 'Conservation evidence');
  const expectedConservation = {
    adminResetDisabled: true,
    allowedModesEmpty: true,
    appDisabled: true,
    botDisabled: true,
    cleanResetDisabled: true,
    gsmDisabled: true,
    gsmEnabled: false,
    schemaCompatibilityDisabled: true,
    singleReplica: true,
    storageWriteGuardEnabled: true,
  };
  if (stableJson(value.conservation) !== stableJson(expectedConservation)) {
    fail('CAPTURE_CONSERVATION_INVALID', 'The capture was not explicitly made under the complete post-compatibility freeze.');
  }
  assertExactKeys(value.repository, ['githubRepository', 'headSha'], 'CAPTURE_CONTROL_INVALID', 'Repository identity');
  assertExactKeys(value.railway, [
    'captureDeployedSha',
    'captureDeploymentId',
    'deploymentInstanceId',
    'environmentId',
    'projectId',
    'serviceId',
    'serviceInstanceId',
    'volumeId',
    'volumeMountPath',
    'volumeName',
  ], 'CAPTURE_CONTROL_INVALID', 'Railway capture identity');
  const railway = Object.fromEntries(Object.entries(value.railway).map(([key, item]) => [key, text(item)]));
  for (const field of [
    'projectId', 'environmentId', 'serviceId', 'volumeId', 'serviceInstanceId',
    'deploymentInstanceId', 'captureDeploymentId',
  ]) {
    if (!UUID_PATTERN.test(railway[field])) {
      fail('CAPTURE_RAILWAY_IDENTITY_INVALID', `Railway ${field} must be an exact UUID.`);
    }
  }
  if (!SHA40_PATTERN.test(railway.captureDeployedSha.toLowerCase())) {
    fail('CAPTURE_RAILWAY_IDENTITY_INVALID', 'The captured deployed SHA must be an exact commit SHA.');
  }
  const immutableRailwayTarget = {
    projectId: environment.projectId,
    environmentId: environment.environmentId,
    serviceId: environment.serviceId,
    volumeId: environment.volumeId,
    volumeName: environment.volumeName,
    volumeMountPath: environment.volumeMountPath,
  };
  const suppliedRailwayTarget = Object.fromEntries(Object.keys(immutableRailwayTarget).map(key => [key, railway[key]]));
  if (stableJson(suppliedRailwayTarget) !== stableJson(immutableRailwayTarget)) {
    fail('CAPTURE_RAILWAY_TARGET_MISMATCH', 'The capture does not belong to the immutable reviewed Railway target.');
  }
  if (
    value.repository.githubRepository !== environment.githubRepository
    || text(value.repository.headSha).toLowerCase() !== railway.captureDeployedSha.toLowerCase()
  ) {
    fail('CAPTURE_REPOSITORY_IDENTITY_MISMATCH', 'Repository and captured deployment identities do not match.');
  }
  assertExactKeys(value.rounds, ['roundA', 'roundB'], 'CAPTURE_CONTROL_INVALID', 'Capture rounds');
  const rounds = {
    roundA: normalizedControlRound(value.rounds.roundA, 'roundA'),
    roundB: normalizedControlRound(value.rounds.roundB, 'roundB'),
  };
  if (rounds.roundA.captureId === rounds.roundB.captureId) {
    fail('CAPTURE_ROUNDS_NOT_INDEPENDENT', 'The two capture rounds must have distinct capture IDs.');
  }
  let normalizedBaseline;
  try {
    normalizedBaseline = validateBaselineContract(value.baseline);
  } catch (error) {
    fail(error.code || 'BASELINE_CONTROL_INVALID', error.message, error.details);
  }
  if (stableJson(normalizedBaseline) !== stableJson(validateBaselineContract(baselineContract))) {
    fail('BASELINE_AUTHORITY_MISMATCH', 'The control does not bind the exact reviewed semantic baseline contract.');
  }
  const authorityFingerprint = sha256(stableJson(classificationAuthoritySnapshot(classificationContract)));
  if (text(value.classificationAuthorityFingerprint).toLowerCase() !== authorityFingerprint) {
    fail('CLASSIFICATION_AUTHORITY_MISMATCH', 'The classification authority differs from the reviewed control.');
  }
  const control = {
    ...value,
    repository: {
      githubRepository: value.repository.githubRepository,
      headSha: text(value.repository.headSha).toLowerCase(),
    },
    railway: { ...railway, captureDeployedSha: railway.captureDeployedSha.toLowerCase() },
    rounds,
    baseline: structuredClone(normalizedBaseline),
    classificationAuthorityFingerprint: authorityFingerprint,
  };
  validateTimestamps(control, now);
  return control;
}

function safeRelativeSourcePath(relativePath) {
  const normalized = text(relativePath).replace(/\\/g, '/');
  const resolved = path.resolve(REPOSITORY_ROOT, normalized);
  if (
    !normalized
    || path.isAbsolute(normalized)
    || normalized.includes('\0')
    || resolved === REPOSITORY_ROOT
    || !resolved.startsWith(`${REPOSITORY_ROOT}${path.sep}`)
  ) {
    fail('SOURCE_BINDING_PATH_INVALID', 'A source binding has an unsafe path.');
  }
  return { normalized, resolved };
}

function verifySourceBindings(sourceBindings) {
  if (!Array.isArray(sourceBindings)) {
    fail('SOURCE_BINDINGS_INVALID', 'Source bindings must be an exact array.');
  }
  const normalized = sourceBindings.map(row => {
    assertExactKeys(row, ['relativePath', 'sha256', 'size'], 'SOURCE_BINDINGS_INVALID', 'Source binding');
    const bindingPath = safeRelativeSourcePath(row.relativePath);
    const size = Number(row.size);
    const hash = text(row.sha256).toLowerCase();
    if (!Number.isSafeInteger(size) || size <= 0 || !SHA256_PATTERN.test(hash)) {
      fail('SOURCE_BINDINGS_INVALID', `Source binding metadata is invalid: ${bindingPath.normalized}.`);
    }
    return { relativePath: bindingPath.normalized, size, sha256: hash, resolved: bindingPath.resolved };
  });
  const actualPaths = normalized.map(row => row.relativePath);
  if (stableJson(actualPaths) !== stableJson(REQUIRED_SOURCE_BINDING_PATHS)) {
    fail('SOURCE_BINDING_SET_MISMATCH', 'The control does not bind the exact evidence and simulation source set.', {
      actual: actualPaths,
      expected: REQUIRED_SOURCE_BINDING_PATHS,
    });
  }
  const result = normalized.map(row => {
    const state = readRegularFileNoFollow(row.resolved, 'SOURCE_BINDING_FILE_INVALID', row.relativePath);
    if (state.size !== row.size || state.sha256 !== row.sha256) {
      fail('SOURCE_BINDING_DRIFT', `Pinned source drifted: ${row.relativePath}.`);
    }
    return { relativePath: row.relativePath, size: row.size, sha256: row.sha256 };
  });
  return result;
}

function sourceBindingsFingerprint(sourceBindings) {
  if (!Array.isArray(sourceBindings)) {
    fail('SOURCE_BINDINGS_INVALID', 'Source bindings must be an exact array.');
  }
  return sha256(stableJson(sourceBindings));
}

function currentRepositorySourceBindings() {
  return REQUIRED_SOURCE_BINDING_PATHS.map(relativePath => {
    const resolved = path.resolve(REPOSITORY_ROOT, relativePath);
    const state = readRegularFileNoFollow(
      resolved,
      'SOURCE_BINDING_FILE_INVALID',
      relativePath,
    );
    return { relativePath, size: state.size, sha256: state.sha256 };
  });
}

function currentRepositorySourceBindingsFingerprint() {
  return sourceBindingsFingerprint(currentRepositorySourceBindings());
}

function verifyEvidenceSourceBindingContract({
  sourceBindings,
  sourceBindingsFingerprint: claimedFingerprint,
  platformDefaultTenantOverlaySemantics,
}) {
  const verifiedSourceBindings = verifySourceBindings(sourceBindings);
  const verifiedFingerprint = sourceBindingsFingerprint(verifiedSourceBindings);
  if (text(claimedFingerprint).toLowerCase() !== verifiedFingerprint) {
    fail(
      'SOURCE_BINDINGS_FINGERPRINT_MISMATCH',
      'The evidence source-binding fingerprint is missing, stale, or inconsistent.',
    );
  }
  if (
    stableJson(platformDefaultTenantOverlaySemantics)
    !== stableJson(PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT)
  ) {
    fail(
      'OVERLAY_SEMANTICS_CONTRACT_MISMATCH',
      'The evidence does not bind the current platform-default/tenant-overlay semantics.',
    );
  }
  return {
    sourceBindings: verifiedSourceBindings,
    sourceBindingsFingerprint: verifiedFingerprint,
    platformDefaultTenantOverlaySemantics: structuredClone(
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    ),
  };
}

function assertSafeDirectory(directory, code, label) {
  const requested = path.resolve(directory);
  let stat;
  try {
    stat = fs.lstatSync(requested);
  } catch {
    fail(code, `${label} does not exist.`);
  }
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    fail(code, `${label} must be a non-symlink directory.`);
  }
  const resolved = fs.realpathSync(requested);
  const canonicalStat = fs.lstatSync(resolved);
  if (
    !canonicalStat.isDirectory()
    || canonicalStat.isSymbolicLink()
    || String(stat.dev) !== String(canonicalStat.dev)
    || String(stat.ino) !== String(canonicalStat.ino)
  ) {
    fail(code, `${label} cannot be resolved to one stable directory.`);
  }
  return { requested, resolved, stat: canonicalStat };
}

function assertOutsideDirectory(candidate, boundary, code, label) {
  if (candidate === boundary || candidate.startsWith(`${boundary}${path.sep}`)) {
    fail(code, `${label} overlaps a forbidden directory.`);
  }
}

function validateInputOutputPaths({ roundADir, roundBDir, outputDir }) {
  const repository = fs.realpathSync(REPOSITORY_ROOT);
  const roundA = assertSafeDirectory(roundADir, 'CAPTURE_DIRECTORY_INVALID', 'roundA directory');
  const roundB = assertSafeDirectory(roundBDir, 'CAPTURE_DIRECTORY_INVALID', 'roundB directory');
  if (
    roundA.resolved === roundB.resolved
    || (String(roundA.stat.dev) === String(roundB.stat.dev) && String(roundA.stat.ino) === String(roundB.stat.ino))
  ) {
    fail('CAPTURE_ROUNDS_NOT_INDEPENDENT', 'Round A and round B must be distinct directories.');
  }
  for (const round of [roundA.resolved, roundB.resolved]) {
    if (round === '/data' || round.startsWith('/data/')) {
      fail('PRODUCTION_PATH_FORBIDDEN', 'The evidence builder refuses live production volume paths.');
    }
  }
  const requestedOutput = path.resolve(outputDir);
  if (requestedOutput === '/' || requestedOutput === '/data' || requestedOutput.startsWith('/data/')) {
    fail('PRODUCTION_PATH_FORBIDDEN', 'The evidence output cannot target a production path.');
  }
  const requestedParent = path.dirname(requestedOutput);
  const parent = assertSafeDirectory(requestedParent, 'OUTPUT_PARENT_INVALID', 'Evidence output parent');
  const output = path.join(parent.resolved, path.basename(requestedOutput));
  assertOutsideDirectory(output, repository, 'REPOSITORY_OUTPUT_FORBIDDEN', 'Evidence output');
  assertOutsideDirectory(output, roundA.resolved, 'CAPTURE_OUTPUT_OVERLAP', 'Evidence output');
  assertOutsideDirectory(output, roundB.resolved, 'CAPTURE_OUTPUT_OVERLAP', 'Evidence output');
  assertOutsideDirectory(roundA.resolved, output, 'CAPTURE_OUTPUT_OVERLAP', 'roundA directory');
  assertOutsideDirectory(roundB.resolved, output, 'CAPTURE_OUTPUT_OVERLAP', 'roundB directory');
  try {
    fs.lstatSync(output);
    fail('OUTPUT_ALREADY_EXISTS', 'The evidence builder refuses to overwrite an existing path.');
  } catch (error) {
    if (error instanceof ProductionScopeEvidenceError) throw error;
    if (error?.code !== 'ENOENT') fail('OUTPUT_PATH_INVALID', 'The evidence output path cannot be inspected safely.');
  }
  return { roundA, roundB, output, outputParent: parent.resolved };
}

function copyHeldDescriptor(sourceFd, sourceState, destination) {
  const outputFd = fs.openSync(destination, 'wx', 0o600);
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  try {
    while (true) {
      const bytesRead = fs.readSync(sourceFd, buffer, 0, buffer.length, position);
      if (bytesRead === 0) break;
      hash.update(buffer.subarray(0, bytesRead));
      let written = 0;
      while (written < bytesRead) {
        written += fs.writeSync(outputFd, buffer, written, bytesRead - written, position + written);
      }
      position += bytesRead;
    }
    fs.fsyncSync(outputFd);
  } finally {
    fs.closeSync(outputFd);
  }
  const copied = { name: sourceState.name, size: position, sha256: hash.digest('hex') };
  if (copied.size !== sourceState.size || copied.sha256 !== sourceState.sha256) {
    fail('CAPTURE_COPY_MISMATCH', `Disposable copy differs from ${sourceState.name}.`);
  }
  return copied;
}

function closeCaptureHandle(handle) {
  if (!handle.closed) {
    fs.closeSync(handle.fd);
    handle.closed = true;
  }
}

function openCaptureRound(directoryState, expectedRound, label, disposableDirectory) {
  const handles = [];
  try {
    for (const expected of expectedRound.files) {
      const filePath = path.join(directoryState.resolved, expected.name);
      const pathBefore = fs.lstatSync(filePath);
      if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
        fail('CAPTURE_FILE_INVALID', `${label}/${expected.name} must be a regular non-symlink file.`);
      }
      const fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
      const before = fs.fstatSync(fd);
      if (!before.isFile() || Number(before.nlink) !== 1) {
        fs.closeSync(fd);
        fail('CAPTURE_FILE_INVALID', `${label}/${expected.name} must be a singly linked regular file.`);
      }
      const handle = { fd, filePath, before, state: null, closed: false };
      handles.push(handle);
      const observed = hashFileDescriptor(fd, Number(before.size));
      const after = fs.fstatSync(fd);
      if (!sameStatIdentity(before, after)) {
        fail('CAPTURE_FILE_CHANGED', `${label}/${expected.name} changed while it was hashed.`);
      }
      const state = { name: expected.name, size: observed.size, sha256: observed.sha256 };
      if (stableJson(state) !== stableJson(expected)) {
        fail('CAPTURE_HASH_MISMATCH', `${label}/${expected.name} differs from the hash-bound control.`);
      }
      handle.state = state;
      const disposablePath = path.join(disposableDirectory, expected.name);
      copyHeldDescriptor(fd, state, disposablePath);
    }
    return { handles, files: handles.map(item => item.state) };
  } catch (error) {
    for (const handle of handles) closeCaptureHandle(handle);
    throw error;
  }
}

function verifyAndCloseCaptureRound(round, directoryState, label) {
  let failure = null;
  for (const handle of round.handles) {
    try {
      const heldAfter = fs.fstatSync(handle.fd);
      const pathAfter = fs.lstatSync(handle.filePath);
      const finalHash = hashFileDescriptor(handle.fd, Number(heldAfter.size));
      if (
        !sameStatIdentity(handle.before, heldAfter)
        || String(handle.before.dev) !== String(pathAfter.dev)
        || String(handle.before.ino) !== String(pathAfter.ino)
        || stableJson(finalHash) !== stableJson({ size: handle.state.size, sha256: handle.state.sha256 })
      ) {
        failure = new ProductionScopeEvidenceError(
          'CAPTURE_EVIDENCE_SWAP',
          `${label}/${handle.state.name} changed or was replaced during analysis.`,
        );
      }
    } catch {
      failure = new ProductionScopeEvidenceError(
        'CAPTURE_EVIDENCE_SWAP',
        `${label}/${handle.state.name} cannot be revalidated after analysis.`,
      );
    } finally {
      closeCaptureHandle(handle);
    }
  }
  const directoryAfter = fs.lstatSync(directoryState.resolved);
  if (
    String(directoryState.stat.dev) !== String(directoryAfter.dev)
    || String(directoryState.stat.ino) !== String(directoryAfter.ino)
  ) {
    failure = new ProductionScopeEvidenceError('CAPTURE_EVIDENCE_SWAP', `${label} directory was replaced during analysis.`);
  }
  if (failure) throw failure;
}

function runnerFileSet(files) {
  const byName = new Map(files.map(row => [row.name, row]));
  const item = name => {
    const row = byName.get(name);
    return row ? { name, sizeBytes: row.size, sha256: row.sha256 } : null;
  };
  return {
    database: item('app.sqlite'),
    wal: item('app.sqlite-wal'),
    shm: item('app.sqlite-shm'),
  };
}

function durableFileSet(files) {
  const normalized = runnerFileSet(files);
  return { database: normalized.database, wal: normalized.wal };
}

function captureFingerprints(files) {
  const normalized = runnerFileSet(files);
  return {
    sourceFileSetHash: sqliteFileSetFingerprint(normalized),
    sourceObservedFileSetHash: sqliteObservedFileSetFingerprint(normalized),
  };
}

function scopeState(record) {
  const companyId = text(record?.companyId);
  const tenantId = text(record?.tenantId);
  if (!companyId && !tenantId) return 'UNSCOPED';
  if (!companyId || !tenantId) return 'PARTIAL_SCOPE';
  if (companyId !== tenantId) return 'SCOPE_MISMATCH';
  return 'FULLY_SCOPED';
}

function singletonEntries(value) {
  if (value === null || value === undefined) return [];
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const envelope = value.__tenantScopedValues;
    if (envelope && typeof envelope === 'object' && !Array.isArray(envelope)) {
      return Object.entries(envelope).map(([key, record]) => ({ key, record }));
    }
    if (Object.keys(value).length === 0) return [];
  }
  return [{ key: 'singleton', record: value }];
}

function recordsForPolicy(collection, policy, value) {
  if (policy.shape === COLLECTION_SHAPE.ARRAY) {
    if (!Array.isArray(value)) fail('COLLECTION_SHAPE_INVALID', `${collection} is not an array.`);
    return value.map((record, index) => ({ key: String(index), record }));
  }
  if (policy.shape === COLLECTION_SHAPE.MAP) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      fail('COLLECTION_SHAPE_INVALID', `${collection} is not a map.`);
    }
    return Object.entries(value).map(([key, record]) => ({ key, record }));
  }
  return singletonEntries(value);
}

function recordId(collection, policy, key, record) {
  const direct = text(record?.id || record?._id);
  if (direct) return direct;
  if (policy.shape === COLLECTION_SHAPE.MAP) return text(key);
  if (policy.shape === COLLECTION_SHAPE.SINGLETON) return `${collection}:${text(key) || 'singleton'}`;
  return `${collection}:anonymous:${sha256(stableJson(record)).slice(0, 16)}`;
}

function parentReferences(policy, record) {
  const refs = [];
  for (const rule of policy.parentResolver || []) {
    for (const field of rule.fields || []) {
      const value = text(record?.[field]);
      if (value) refs.push({ field, value, collections: [...(rule.collections || [])] });
    }
  }
  return refs;
}

function countBy(rows, selector) {
  const counts = {};
  for (const row of rows) {
    const key = selector(row);
    counts[key] = (counts[key] || 0) + 1;
  }
  return Object.fromEntries(Object.entries(counts).sort(([left], [right]) => left.localeCompare(right)));
}

function assertExpectedFrozenClassification({
  appRows,
  recordInventory,
  scopeRecords,
  ownershipCandidates,
  auditRows,
  userDispositions,
}, expected = classificationAuthoritySnapshot().expectedFrozenSnapshot) {
  const actual = {
    physicalAppDataCollectionCount: appRows.length,
    allRegistryRecordCount: recordInventory.length,
    scopeRelevantRecordCount: scopeRecords.length,
    systemRecordCount: recordInventory.length - scopeRecords.length,
    ownershipCandidateCount: ownershipCandidates.length,
    platformDefaultRecordCount: recordInventory.filter(row => (
      row.disposition === 'PLATFORM_DEFAULT_REFERENCE'
    )).length,
    fixtureRecordCount: recordInventory.filter(row => row.disposition === 'FIXTURE_DEMO_TEST').length,
    legacyIdempotencyRecordCount: recordInventory.filter(row => row.disposition === 'LEGACY_IDEMPOTENCY_TOMBSTONE').length,
    auditRecordCount: auditRows.length,
    auditCategoryCounts: countBy(auditRows, row => row.auditClassification),
    userDispositionCounts: countBy(userDispositions, row => row.classification),
  };
  if (stableJson(actual) !== stableJson(expected)) {
    fail('FROZEN_CLASSIFICATION_COUNT_MISMATCH', 'The frozen snapshot differs from the exact reviewed classification authority.', {
      expected,
      actual,
    });
  }
}

function analyzeDisposableDatabase({
  dbPath,
  control,
  capture,
  sourceBindings,
  baselineContract,
  classificationContract,
  plan,
}) {
  const db = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    db.pragma('query_only = ON');
    db.pragma('foreign_keys = ON');
    const quickCheck = db.pragma('quick_check', { simple: true });
    const foreignKeyViolations = db.pragma('foreign_key_check');
    if (quickCheck !== 'ok' || foreignKeyViolations.length !== 0) {
      fail('SQLITE_INTEGRITY_FAILED', 'The disposable capture copy failed SQLite integrity checks.');
    }
    const dbIdentity = databaseIdentity(db);
    const dbContentHash = databaseContentFingerprint(db);
    const identityTableCounts = identityCounts(db);
    const appRows = db.prepare('SELECT name, json, updated_at FROM app_data ORDER BY name').all();
    const appData = new Map();
    for (const row of appRows) {
      if (!COLLECTION_SCOPE_REGISTRY[row.name]) {
        fail('UNKNOWN_PHYSICAL_COLLECTION', `Unclassified app_data collection: ${row.name}.`);
      }
      try {
        appData.set(row.name, { ...row, value: JSON.parse(row.json) });
      } catch {
        fail('COLLECTION_JSON_INVALID', `Collection JSON is invalid: ${row.name}.`);
      }
    }
    if (ALL_APP_DATA_COLLECTIONS.length !== 76 || Object.keys(COLLECTION_SCOPE_REGISTRY).length !== 76) {
      fail('REGISTRY_ENTRY_COUNT_MISMATCH', 'The exact reviewed 76-entry registry is not loaded.');
    }
    const cmsPolicy = COLLECTION_SCOPE_REGISTRY.public_site_cms;
    if (
      cmsPolicy?.category !== COLLECTION_SCOPE_CATEGORY.TENANT
      || cmsPolicy?.shape !== COLLECTION_SHAPE.SINGLETON
      || cmsPolicy?.readPolicy !== 'EXACT_TENANT_SCOPE'
      || cmsPolicy?.writeAuthority !== 'TRUSTED_TENANT_ACTOR'
      || cmsPolicy?.mutationPolicy !== 'MUTABLE'
    ) {
      fail(
        'PUBLIC_SITE_CMS_CLASSIFICATION_MISMATCH',
        'public_site_cms must remain an exact tenant-owned mutable singleton.',
      );
    }
    const missingRegistryCollections = ALL_APP_DATA_COLLECTIONS.filter(name => !appData.has(name));
    const canonicalCompanyId = text(plan?.authority?.companyId);
    const canonicalTenantId = text(plan?.authority?.tenantId);
    const canonicalHeadOfficeId = text(plan?.authority?.headOffice?.id);
    if (
      !canonicalCompanyId
      || canonicalTenantId !== canonicalCompanyId
      || !canonicalHeadOfficeId
    ) {
      fail('CANONICAL_AUTHORITY_INVALID', 'The reviewed plan lacks one exact canonical Company/Head Office scope.');
    }

    const collectionInventory = [];
    const observedEntries = [];
    const observedKeys = new Set();
    for (const collection of ALL_APP_DATA_COLLECTIONS) {
      const policy = COLLECTION_SCOPE_REGISTRY[collection];
      const source = appData.get(collection);
      const entries = source ? recordsForPolicy(collection, policy, source.value) : [];
      const scopeCounts = { FULLY_SCOPED: 0, PARTIAL_SCOPE: 0, SCOPE_MISMATCH: 0, UNSCOPED: 0 };
      for (const { key, record } of entries) {
        const id = recordId(collection, policy, key, record);
        const inventoryKey = `${collection}:${id}`;
        if (!id || observedKeys.has(inventoryKey)) {
          fail('RECORD_ID_MISSING_OR_DUPLICATE', `Record identity is missing or duplicated: ${inventoryKey}.`);
        }
        observedKeys.add(inventoryKey);
        const state = scopeState(record);
        scopeCounts[state] += 1;
        observedEntries.push({ collection, policy, recordId: id, record, state, inventoryKey });
      }
      collectionInventory.push({
        collection,
        category: policy.category,
        shape: policy.shape,
        readPolicy: policy.readPolicy,
        writeAuthority: policy.writeAuthority,
        existsInSnapshot: Boolean(source),
        recordCount: entries.length,
        scopeCounts,
        rawJsonHash: source ? sha256(source.json) : null,
        canonicalCollectionHash: source ? collectionFingerprint(source.value) : null,
        updatedAt: source?.updated_at || null,
      });
    }

    const fixtureRecords = observedEntries.filter(({ collection, record }) => (
      collection !== 'users' && Boolean(text(record?.fixtureTag))
    )).map(({ collection, recordId: id }) => ({ collection, recordId: id }));
    let derivedCandidates;
    try {
      derivedCandidates = deriveAndVerifyBaselineCandidates({
        contract: baselineContract,
        canonicalScope: { companyId: canonicalCompanyId, tenantId: canonicalTenantId },
        observedRecords: observedEntries.map(({ collection, recordId: id, record }) => ({
          collection,
          recordId: id,
          oldCompanyId: text(record?.companyId) || null,
          oldTenantId: text(record?.tenantId) || null,
        })),
        fixtureRecords,
      });
    } catch (error) {
      fail(error.code || 'BASELINE_CANDIDATE_SET_MISMATCH', error.message, error.details);
    }
    const baselineCandidates = new Map(derivedCandidates.map(row => [
      `${row.collection}:${row.recordId}`,
      row,
    ]));

    const usersSource = appData.get('users');
    if (!Array.isArray(usersSource?.value)) fail('USERS_COLLECTION_INVALID', 'The users collection is missing or invalid.');
    const helperUserInventory = buildUserInventory(usersSource.value, plan);
    const helperById = new Map(helperUserInventory.rows.map(row => [row.id, row]));
    const mappingById = new Map((plan.actorMappings || []).map(row => [text(row.userId), row]));
    const demoPrincipalIds = usersSource.value
      .filter(user => Boolean(text(user?.fixtureTag)))
      .map(user => text(user.id));
    const demoPrincipalIdSet = new Set(demoPrincipalIds);
    const sensitiveAuthority = {
      retainedAuditEntityIds: derivedCandidates
        .filter(row => ['clients', 'client_objects', 'documents'].includes(row.collection))
        .map(row => row.recordId),
      businessPrincipalIds: (plan.actorMappings || [])
        .filter(row => row.action === 'CREATE_MEMBERSHIP')
        .map(row => text(row.userId)),
      explicitFixtureRecordKeys: fixtureRecords.map(row => `${row.collection}:${row.recordId}`),
      explicitDemoPrincipalIds: demoPrincipalIds,
      explicitInactivePrincipalIds: helperUserInventory.rows
        .filter(row => row.proposedAction === 'NO_ACTIVE_MEMBERSHIP' && !demoPrincipalIdSet.has(row.id))
        .map(row => row.id),
      productionSmokeSourcePrincipalIds: (plan.actorMappings || [])
        .filter(row => row.action === 'UNRESOLVED' && row.candidateForProductionMembership === false)
        .map(row => text(row.userId)),
    };
    let classificationAuthority;
    try {
      classificationAuthority = createProductionScopeClassificationAuthority({
        canonicalScope: { companyId: canonicalCompanyId, headOfficeId: canonicalHeadOfficeId },
        sensitiveAuthority,
        contract: classificationContract,
      });
    } catch (error) {
      fail(error.code || 'CLASSIFICATION_AUTHORITY_MISMATCH', error.message, error.details);
    }

    const recordInventory = [];
    const currentByKey = new Map();
    for (const entry of observedEntries) {
      const { collection, policy, recordId: id, record, state, inventoryKey } = entry;
      const baseline = baselineCandidates.get(inventoryKey) || null;
      const classification = classificationAuthority.classifyProductionScopeRecord({
        collection,
        policy,
        recordId: id,
        record,
        baseline,
      });
      const row = {
        collection,
        recordId: id,
        canonicalRecordHash: sha256(stableJson(record)),
        category: classification.evidenceCategory || policy.category,
        registryCategory: policy.category,
        shape: policy.shape,
        currentScopeState: state,
        currentCompanyId: text(record?.companyId) || null,
        currentTenantId: text(record?.tenantId) || null,
        parentReferences: parentReferences(policy, record),
        ...classification,
      };
      delete row.evidenceCategory;
      if (policy.category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY) {
        row.auditAction = text(record?.action) || null;
        row.auditEntityType = text(record?.entityType) || null;
        row.auditCreatedAt = text(record?.createdAt) || null;
        row.auditKindPresent = Boolean(text(record?.auditKind));
      }
      currentByKey.set(inventoryKey, { row, record });
      recordInventory.push(row);
    }
    recordInventory.sort((left, right) => (
      left.collection.localeCompare(right.collection) || left.recordId.localeCompare(right.recordId)
    ));
    const ownershipCandidates = [...baselineCandidates.entries()].map(([key, baseline]) => {
      const current = currentByKey.get(key);
      if (!current) {
        return { collection: baseline.collection, recordId: baseline.recordId, status: 'MISSING' };
      }
      const beforeMatches = (current.row.currentCompanyId ?? null) === (baseline.oldCompanyId ?? null)
        && (current.row.currentTenantId ?? null) === (baseline.oldTenantId ?? null);
      return {
        collection: baseline.collection,
        recordId: baseline.recordId,
        canonicalRecordHash: current.row.canonicalRecordHash,
        status: beforeMatches ? 'READY_CANDIDATE' : 'SOURCE_SCOPE_DRIFT',
        oldCompanyId: current.row.currentCompanyId,
        oldTenantId: current.row.currentTenantId,
        proposedCompanyId: canonicalCompanyId,
        proposedTenantId: canonicalTenantId,
        classification: baseline.classification,
        ownershipRule: baseline.scopeSource,
      };
    }).sort((left, right) => (
      left.collection.localeCompare(right.collection) || left.recordId.localeCompare(right.recordId)
    ));
    const candidateDrift = ownershipCandidates.filter(row => row.status !== 'READY_CANDIDATE');
    const expectedBusinessMappings = (plan.actorMappings || [])
      .filter(row => row.action === 'CREATE_MEMBERSHIP')
      .map(row => text(row.userId)).sort();
    if (stableJson(expectedBusinessMappings) !== stableJson([...sensitiveAuthority.businessPrincipalIds].sort())) {
      fail('ACTOR_MAPPING_AUTHORITY_MISMATCH', 'The reviewed plan business principals differ from classification authority.');
    }
    const userHashById = new Map(recordInventory
      .filter(row => row.collection === 'users')
      .map(row => [row.recordId, row.canonicalRecordHash]));
    const userDispositions = usersSource.value.map(user => {
      const principalId = text(user?.id);
      const helper = helperById.get(principalId);
      return {
        principalId,
        canonicalRecordHash: userHashById.get(principalId),
        status: text(user?.status) || null,
        currentRole: text(user?.role) || (Array.isArray(user?.roles)
          ? user.roles.map(text).filter(Boolean).sort().join(', ') : null),
        fixtureTagPresent: Boolean(text(user?.fixtureTag)),
        helperType: helper?.type || null,
        helperProposedAction: helper?.proposedAction || null,
        ...classificationAuthority.classifyProductionPrincipal({
          user,
          helperRow: helper,
          actorMapping: mappingById.get(principalId),
        }),
      };
    }).sort((left, right) => left.principalId.localeCompare(right.principalId));
    const duplicateUsers = userDispositions.filter((row, index, rows) => (
      !row.principalId || rows.findIndex(candidate => candidate.principalId === row.principalId) !== index
    ));
    if (duplicateUsers.length > 0) fail('USER_ID_MISSING_OR_DUPLICATE', 'The source user directory has invalid stable IDs.');
    const scopeRecords = recordInventory.filter(row => row.registryCategory !== COLLECTION_SCOPE_CATEGORY.SYSTEM);
    const unresolved = scopeRecords.filter(row => row.disposition === 'UNRESOLVED');
    const finalUnresolvedUsers = userDispositions.filter(row => row.classification === 'UNRESOLVED');
    const auditRows = recordInventory.filter(row => row.registryCategory === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY);
    if (candidateDrift.length > 0 || unresolved.length > 0 || finalUnresolvedUsers.length > 0) {
      fail('CLASSIFICATION_INCOMPLETE', 'Fresh classification has missing, drifted, or unresolved records.', {
        candidateDrift,
        unresolved: unresolved.map(row => ({ collection: row.collection, recordId: row.recordId })),
        finalUnresolvedUsers: finalUnresolvedUsers.map(row => row.principalId),
      });
    }
    assertExpectedFrozenClassification({
      appRows,
      recordInventory,
      scopeRecords,
      ownershipCandidates,
      auditRows,
      userDispositions,
    }, classificationContract.expectedFrozenSnapshot);
    const collectionRawFingerprints = Object.fromEntries(appRows.map(row => [row.name, sha256(row.json)]));
    const railwayIdentity = Object.fromEntries([
      'projectId', 'environmentId', 'serviceId', 'volumeId', 'volumeName', 'volumeMountPath',
    ].map(key => [key, control.railway[key]]));
    const deploymentIdentity = {
      serviceInstanceId: control.railway.serviceInstanceId,
      deploymentInstanceId: control.railway.deploymentInstanceId,
    };
    const sourceSnapshotHash = sha256(stableJson({
      captureDeployedSha: control.railway.captureDeployedSha,
      captureDeploymentId: control.railway.captureDeploymentId,
      railwayIdentity,
      deploymentIdentity,
      durableSourceFileSet: durableFileSet(capture.selectedRoundFiles),
      collectionFingerprints: collectionRawFingerprints,
    }));
    const appDataCanonicalFingerprint = sha256(stableJson(Object.fromEntries(
      collectionInventory.filter(row => row.existsInSnapshot).map(row => [row.collection, row.canonicalCollectionHash]),
    )));
    const canonicalCompanySource = plan?.authority?.canonicalCompany || {};
    const canonicalAuthority = {
      company: deriveCanonicalCompanyId({
        jurisdiction: canonicalCompanySource.jurisdiction,
        registry: canonicalCompanySource.registry,
        value: canonicalCompanySource.registryValue || canonicalCompanySource.inn,
      }),
      headOffice: deriveCanonicalHeadOfficeId({ companyId: canonicalCompanyId }),
      memberships: Object.fromEntries([...sensitiveAuthority.businessPrincipalIds].sort().map(principalId => [
        principalId,
        deriveCanonicalMembershipId({ companyId: canonicalCompanyId, principalId }),
      ])),
    };
    if (
      canonicalAuthority.company.companyId !== canonicalCompanyId
      || canonicalAuthority.headOffice.branchId !== canonicalHeadOfficeId
    ) {
      fail('CANONICAL_AUTHORITY_DERIVATION_MISMATCH', 'Canonical Company or Head Office derivation drifted.');
    }
    const registrySummary = {
      registryEntryCount: ALL_APP_DATA_COLLECTIONS.length,
      physicalAppDataCollectionCount: appRows.length,
      unknownPhysicalCollections: [],
      missingRegistryCollections,
      categoryCollectionCounts: countBy(Object.values(COLLECTION_SCOPE_REGISTRY), row => row.category),
      categoryRecordCounts: countBy(recordInventory, row => row.registryCategory),
      dispositionCounts: countBy(recordInventory, row => row.disposition),
      allRegistryRecordCount: recordInventory.length,
      scopeRelevantRecordCount: scopeRecords.length,
      systemRecordCount: recordInventory.length - scopeRecords.length,
      unresolvedRecordCount: unresolved.length,
    };
    const captureEvidence = {
      captureWindowStartedAt: control.captureWindowStartedAt,
      evidenceGeneratedAt: control.evidenceGeneratedAt,
      method: 'Two independently hash-bound offline volume downloads; DB/WAL durable equality checked before SQLite; SQLite opened only on a disposable copy.',
      analysisRound: control.analysisRound,
      railway: control.railway,
      repository: control.repository,
      conservation: control.conservation,
      roundA: capture.roundA.files,
      roundB: capture.roundB.files,
      durableRoundsByteIdentical: true,
      shmObservationByteIdentical: stableJson(capture.roundA.files[2]) === stableJson(capture.roundB.files[2]),
      sourceFileSetHash: capture.sourceFileSetHash,
      sourceObservedFileSetHash: capture.sourceObservedFileSetHash,
      sourceObservedFileSetHashes: capture.sourceObservedFileSetHashes,
      sourceSnapshotHash,
      rawCaptureOpenedBySQLite: false,
      productionWritePerformed: false,
    };
    const summary = {
      verdict: 'FRESH_PRODUCTION_CLASSIFICATION_COMPLETE',
      productionWritePerformed: false,
      repositoryWritePerformed: false,
      capture: captureEvidence,
      integrity: {
        quickCheck,
        foreignKeyViolations: foreignKeyViolations.length,
        databaseIdentity: dbIdentity,
        databaseContentFingerprint: dbContentHash,
        appDataCanonicalFingerprint,
        identityCounts: identityTableCounts,
      },
      registry: registrySummary,
      ownershipCandidates: {
        count: ownershipCandidates.length,
        baselineContractSha256: baselineStableJsonSha256(baselineContract),
        candidateKeySetSha256: baselineContract.candidateKeySetSha256,
        candidateAuthoritySha256: baselineContract.candidateAuthoritySha256,
        canonicalScopeSha256: baselineContract.canonicalScopeSha256,
        ready: ownershipCandidates.length - candidateDrift.length,
        drift: candidateDrift,
        canonicalCompanyId,
        canonicalBranchId: canonicalHeadOfficeId,
      },
      audit: {
        total: auditRows.length,
        categories: countBy(auditRows, row => row.auditClassification),
        tenantDerivedCandidatesOutsideBusiness97: auditRows.filter(row => row.auditClassification === 'A_ENTITY_DERIVED').length,
        unresolved: 0,
      },
      users: {
        total: userDispositions.length,
        helperFingerprint: helperUserInventory.fingerprint,
        helperEligibleActiveCount: helperUserInventory.eligibleActiveCount,
        helperBlockers: helperUserInventory.blockers,
        finalDispositionCounts: countBy(userDispositions, row => row.classification),
        finalUnresolved: finalUnresolvedUsers,
      },
      canonicalAuthority,
      classificationAuthorityFingerprint: control.classificationAuthorityFingerprint,
      sourceBindings,
      sourceBindingsFingerprint: sourceBindingsFingerprint(sourceBindings),
      platformDefaultTenantOverlaySemantics: structuredClone(
        PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
      ),
      repositoryHeadSha: control.repository.headSha,
    };
    return {
      auditRows,
      captureEvidence,
      collectionInventory,
      ownershipCandidates,
      recordInventory,
      registrySummary,
      scopeRecords,
      summary,
      userDispositions: {
        helperFingerprint: helperUserInventory.fingerprint,
        helperEligibleActiveCount: helperUserInventory.eligibleActiveCount,
        helperBlockers: helperUserInventory.blockers,
        rows: userDispositions,
      },
    };
  } finally {
    db.close();
  }
}

function secretScan(entries) {
  const patterns = [
    { code: 'OPENAI_KEY', regex: /\bsk-(?:proj-)?[A-Za-z0-9_-]{16,}\b/g },
    { code: 'GITHUB_TOKEN', regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g },
    { code: 'BEARER_TOKEN', regex: /\bBearer\s+[A-Za-z0-9._~+\/-]{16,}\b/gi },
    { code: 'JWT', regex: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
    { code: 'PASSWORD_FIELD', regex: /["'](?:password|passhash|passwordHash)["']\s*:/gi },
    { code: 'PRIVATE_KEY', regex: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
    { code: 'RAILWAY_TOKEN', regex: /\b(?:railway|project)[_-]?token\b\s*[:=]/gi },
  ];
  const findings = [];
  for (const entry of entries) {
    const source = entry.bytes.toString('utf8');
    for (const pattern of patterns) {
      pattern.regex.lastIndex = 0;
      if (pattern.regex.test(source)) findings.push({ code: pattern.code, relativePath: entry.relativePath });
    }
  }
  return {
    scannedFiles: entries.map(entry => entry.relativePath),
    findings,
    pass: findings.length === 0,
  };
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY);
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function writeExclusiveFile(filePath, bytes) {
  const fd = fs.openSync(filePath, 'wx', 0o600);
  try {
    fs.writeFileSync(fd, bytes);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function jsonBytes(value) {
  return Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function reportBytes(summary) {
  return Buffer.from([
    '# Fresh Production Scope Evidence',
    '',
    `Generated: \`${summary.capture.evidenceGeneratedAt}\``,
    '',
    `Verdict: **${summary.verdict}**`,
    '',
    '## Capture and integrity',
    '',
    `- Durable DB/WAL rounds byte-identical: \`${summary.capture.durableRoundsByteIdentical}\`.`,
    `- SHM observations byte-identical: \`${summary.capture.shmObservationByteIdentical}\`.`,
    `- Durable DB/WAL SHA-256: \`${summary.capture.sourceFileSetHash}\`.`,
    `- Selected forensic DB/WAL/SHM SHA-256: \`${summary.capture.sourceObservedFileSetHash}\`.`,
    `- Source snapshot SHA-256: \`${summary.capture.sourceSnapshotHash}\`.`,
    `- Database content fingerprint: \`${summary.integrity.databaseContentFingerprint}\`.`,
    `- Schema fingerprint: \`${summary.integrity.databaseIdentity.schemaFingerprint}\`.`,
    `- quick_check: \`${summary.integrity.quickCheck}\`; foreign-key violations: \`${summary.integrity.foreignKeyViolations}\`.`,
    '',
    '## Classification',
    '',
    `- Registry entries: \`${summary.registry.registryEntryCount}\`; physical collections: \`${summary.registry.physicalAppDataCollectionCount}\`.`,
    `- Scope-relevant records: \`${summary.registry.scopeRelevantRecordCount}\`.`,
    `- Exact baseline ownership records: \`${summary.ownershipCandidates.count}\`.`,
    `- Audit events: \`${summary.audit.total}\`; categories: \`${JSON.stringify(summary.audit.categories)}\`.`,
    `- User dispositions: \`${JSON.stringify(summary.users.finalDispositionCounts)}\`.`,
    '',
    '## Safety',
    '',
    '- No network, production write, deployment, restart, backup, or raw SQLite open was authorized.',
    '- SQLite analysis used only a private disposable copy and raw DB/WAL/SHM bytes are not included.',
    '- The private pack contains operational stable IDs and is sensitive local evidence; it is not repository-safe.',
    '',
  ].join('\n'), 'utf8');
}

function publishEvidencePack(outputPath, outputParent, analysis) {
  const lockPath = `${outputPath}.publish.lock`;
  let lockFd;
  let stagingRoot;
  try {
    lockFd = fs.openSync(lockPath, 'wx', 0o600);
    stagingRoot = fs.mkdtempSync(path.join(outputParent, '.skytech-production-evidence-staging-'));
    fs.chmodSync(stagingRoot, 0o700);
    const analysisDir = path.join(stagingRoot, 'analysis');
    fs.mkdirSync(analysisDir, { mode: 0o700 });
    const entries = [
      ['analysis/capture.json', jsonBytes(analysis.captureEvidence)],
      ['analysis/registry-summary.json', jsonBytes(analysis.registrySummary)],
      ['analysis/collection-inventory.json', jsonBytes(analysis.collectionInventory)],
      ['analysis/record-inventory.json', jsonBytes(analysis.recordInventory)],
      ['analysis/scope-record-inventory.json', jsonBytes(analysis.scopeRecords)],
      ['analysis/ownership-candidates.json', jsonBytes(analysis.ownershipCandidates)],
      ['analysis/audit-classification.json', jsonBytes(analysis.auditRows)],
      ['analysis/user-dispositions.json', jsonBytes(analysis.userDispositions)],
      ['analysis/summary.json', jsonBytes(analysis.summary)],
      ['analysis/report.md', reportBytes(analysis.summary)],
    ].map(([relativePath, bytes]) => ({ relativePath, bytes }));
    const scan = secretScan(entries);
    if (!scan.pass) fail('NON_SECRET_EVIDENCE_SCAN_FAILED', 'Generated evidence contains a forbidden secret pattern.', scan.findings);
    entries.push({ relativePath: 'analysis/secret-scan.json', bytes: jsonBytes(scan) });
    for (const entry of entries) {
      writeExclusiveFile(path.join(stagingRoot, entry.relativePath), entry.bytes);
    }
    const artifacts = entries.map(entry => ({
      relativePath: entry.relativePath,
      size: entry.bytes.length,
      sha256: sha256(entry.bytes),
      sensitive: true,
    })).sort((left, right) => left.relativePath.localeCompare(right.relativePath));
    const index = {
      indexVersion: 2,
      generatedAt: analysis.summary.capture.evidenceGeneratedAt,
      packFingerprint: sha256(stableJson(artifacts)),
      artifacts,
    };
    const indexBytes = jsonBytes(index);
    writeExclusiveFile(path.join(stagingRoot, 'artifact-index.json'), indexBytes);
    fsyncDirectory(analysisDir);
    fsyncDirectory(stagingRoot);
    try {
      fs.lstatSync(outputPath);
      fail('OUTPUT_ALREADY_EXISTS', 'The evidence builder refuses to overwrite an existing path.');
    } catch (error) {
      if (error instanceof ProductionScopeEvidenceError) throw error;
      if (error?.code !== 'ENOENT') fail('OUTPUT_PATH_INVALID', 'The output changed before publication.');
    }
    fs.renameSync(stagingRoot, outputPath);
    stagingRoot = null;
    fsyncDirectory(outputParent);
    return {
      outputPath,
      artifactIndexSha256: sha256(indexBytes),
      packFingerprint: index.packFingerprint,
      summary: analysis.summary,
      secretScan: scan,
    };
  } finally {
    if (stagingRoot) fs.rmSync(stagingRoot, { recursive: true, force: true });
    if (lockFd !== undefined) {
      fs.closeSync(lockFd);
      fs.unlinkSync(lockPath);
    }
  }
}

function buildFreshProductionScopeEvidence({
  controlPath,
  controlSha256,
  roundADir,
  roundBDir,
  outputDir,
  now = new Date(),
  baselineContract = PRODUCTION_BASELINE_CONTRACT,
  classificationContract = PRODUCTION_CLASSIFICATION_CONTRACT,
  environment = reviewedEnvironment,
  plan = reviewedPlan,
}) {
  const controlInput = readHashBoundJson(controlPath, controlSha256, 'CAPTURE_CONTROL', 'Capture control');
  const normalizedBaselineContract = validateBaselineContract(baselineContract);
  const control = validateControl(controlInput.value, now, {
    environment,
    baselineContract: normalizedBaselineContract,
    classificationContract,
  });
  const headBefore = repositoryHeadSha();
  if (headBefore !== control.railway.captureDeployedSha || headBefore !== control.repository.headSha) {
    fail('CAPTURE_DEPLOYED_SHA_MISMATCH', 'Repository HEAD does not equal the explicitly captured deployed SHA.');
  }
  const sourceBindings = verifySourceBindings(control.sourceBindings);
  const paths = validateInputOutputPaths({ roundADir, roundBDir, outputDir });
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'skytech-production-evidence-work-'));
  fs.chmodSync(workspace, 0o700);
  const disposableA = path.join(workspace, 'round-a');
  const disposableB = path.join(workspace, 'round-b');
  fs.mkdirSync(disposableA, { mode: 0o700 });
  fs.mkdirSync(disposableB, { mode: 0o700 });
  let roundA;
  let roundB;
  try {
    roundA = openCaptureRound(paths.roundA, control.rounds.roundA, 'roundA', disposableA);
    roundB = openCaptureRound(paths.roundB, control.rounds.roundB, 'roundB', disposableB);
    for (let index = 0; index < SQLITE_FILE_NAMES.length; index += 1) {
      const left = roundA.handles[index].before;
      const right = roundB.handles[index].before;
      if (String(left.dev) === String(right.dev) && String(left.ino) === String(right.ino)) {
        fail('CAPTURE_ROUNDS_NOT_INDEPENDENT', 'Capture rounds share a file inode.');
      }
    }
    const fingerprintsA = captureFingerprints(roundA.files);
    const fingerprintsB = captureFingerprints(roundB.files);
    if (fingerprintsA.sourceFileSetHash !== fingerprintsB.sourceFileSetHash) {
      fail('CAPTURE_DURABLE_ROUNDS_MISMATCH', 'DB/WAL differ between the two frozen capture rounds.');
    }
    const selectedRound = control.analysisRound === 'roundA' ? roundA : roundB;
    const selectedFingerprints = control.analysisRound === 'roundA' ? fingerprintsA : fingerprintsB;
    const capture = {
      roundA,
      roundB,
      selectedRoundFiles: selectedRound.files,
      sourceFileSetHash: selectedFingerprints.sourceFileSetHash,
      sourceObservedFileSetHash: selectedFingerprints.sourceObservedFileSetHash,
      sourceObservedFileSetHashes: {
        roundA: fingerprintsA.sourceObservedFileSetHash,
        roundB: fingerprintsB.sourceObservedFileSetHash,
      },
    };
    const analysis = analyzeDisposableDatabase({
      dbPath: path.join(control.analysisRound === 'roundA' ? disposableA : disposableB, 'app.sqlite'),
      control,
      capture,
      sourceBindings,
      baselineContract: normalizedBaselineContract,
      classificationContract,
      plan,
    });
    verifyAndCloseCaptureRound(roundA, paths.roundA, 'roundA');
    roundA = null;
    verifyAndCloseCaptureRound(roundB, paths.roundB, 'roundB');
    roundB = null;
    const headAfter = repositoryHeadSha();
    if (headAfter !== headBefore || headAfter !== control.railway.captureDeployedSha) {
      fail('REPOSITORY_HEAD_CHANGED', 'Repository HEAD changed during evidence generation.');
    }
    if (stableJson(verifySourceBindings(control.sourceBindings)) !== stableJson(sourceBindings)) {
      fail('SOURCE_BINDING_DRIFT', 'Evidence source bindings changed during analysis.');
    }
    return publishEvidencePack(paths.output, paths.outputParent, analysis);
  } finally {
    if (roundA) {
      for (const handle of roundA.handles) closeCaptureHandle(handle);
    }
    if (roundB) {
      for (const handle of roundB.handles) closeCaptureHandle(handle);
    }
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

module.exports = {
  PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
  PRODUCTION_BASELINE_CONTRACT,
  PRODUCTION_CLASSIFICATION_CONTRACT,
  ProductionScopeEvidenceError,
  REQUIRED_SOURCE_BINDING_PATHS,
  REPOSITORY_ROOT,
  SQLITE_FILE_NAMES,
  buildFreshProductionScopeEvidence,
  captureFingerprints,
  currentRepositorySourceBindings,
  currentRepositorySourceBindingsFingerprint,
  durableFileSet,
  readHashBoundJson,
  runnerFileSet,
  sourceBindingsFingerprint,
  validateControl,
  verifyEvidenceSourceBindingContract,
  verifySourceBindings,
};
