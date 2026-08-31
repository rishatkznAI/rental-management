const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const {
  REQUIRED_SOURCE_BINDING_PATHS,
  REPOSITORY_ROOT,
  SQLITE_FILE_NAMES,
} = require('./production-scope-evidence-builder');
const {
  classificationAuthoritySnapshot,
} = require('./production-scope-evidence-classification');
const {
  validateBaselineContract,
} = require('./production-scope-baseline-contract');
const { stableJson } = require('./production-scope-remediation');
const productionBaselineContract = require('../config/production-scope-baseline-authority.json');
const reviewedEnvironment = require('../config/production-scope-remediation-environment');

const CAPTURE_CONTROL_FILE = 'capture-control.json';
const CAPTURE_OUTPUT_FILE = 'capture-output.json';
const ANALYSIS_ROUND = 'roundB';
const RAILWAY_CLI_VERSION = 'railway 4.60.0';
const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const PRODUCTION_BASELINE_CONTRACT = validateBaselineContract(productionBaselineContract);
const REMOTE_DATABASE_PATHS = Object.freeze(SQLITE_FILE_NAMES.map(name => ({
  name,
  remotePath: `${reviewedEnvironment.volumeMountPath}/${name}`,
})));

const RUNTIME_SNAPSHOT_SCRIPT = String.raw`
'use strict';
const e = process.env;
const exactEmpty = name => e[name] === '';
const result = {
  identity: {
    projectId: e.RAILWAY_PROJECT_ID || '',
    environmentId: e.RAILWAY_ENVIRONMENT_ID || '',
    serviceId: e.RAILWAY_SERVICE_ID || '',
    deploymentId: e.RAILWAY_DEPLOYMENT_ID || '',
    replicaId: e.RAILWAY_REPLICA_ID || '',
    deployedSha: e.RAILWAY_GIT_COMMIT_SHA || ''
  },
  storage: {
    volumeName: e.RAILWAY_VOLUME_NAME || '',
    volumeMountPath: e.RAILWAY_VOLUME_MOUNT_PATH || '',
    databasePath: e.DB_PATH || ''
  },
  conservation: {
    nodeEnvProduction: e.NODE_ENV === 'production',
    appDisabled: e.APP_DISABLED === 'true',
    botDisabled: e.BOT_DISABLED === 'true',
    gsmDisabled: e.GSM_DISABLED === 'true',
    gsmEnabled: e.GSM_ENABLED === 'true',
    cleanResetDisabled: e.SKYTECH_CLEAN_RESET_ENABLED === 'false' && exactEmpty('SKYTECH_CLEAN_RESET_TOKEN'),
    adminResetDisabled: exactEmpty('ADMIN_RESET_PASSWORD'),
    allowedModesEmpty: exactEmpty('PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES') && exactEmpty('PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE'),
    schemaCompatibilityDisabled: e.PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY === 'false',
    validationReadOnlyDisabled: e.PRODUCTION_SCOPE_REMEDIATION_VALIDATION_READ_ONLY === 'false',
    storageWriteGuardEnabled: e.PRODUCTION_SCOPE_REMEDIATION_ENABLED === 'true' && e.PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE === 'true',
    preCompatibilityBackupDisabled: e.SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED === 'false'
      && exactEmpty('SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA')
      && exactEmpty('SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN'),
    remediationSigningSecretEmpty: exactEmpty('PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET'),
    expectedExecutionShaEmpty: exactEmpty('PRODUCTION_SCOPE_REMEDIATION_EXPECTED_EXECUTION_SHA')
  }
};
process.stdout.write(JSON.stringify(result));
`;

const REMOTE_FILE_METADATA_SCRIPT = String.raw`
'use strict';
const crypto = require('node:crypto');
const fs = require('node:fs');
const entries = JSON.parse(process.argv[1]);
const same = (a, b) => String(a.dev) === String(b.dev) && String(a.ino) === String(b.ino)
  && String(a.size) === String(b.size) && String(a.mtimeMs) === String(b.mtimeMs)
  && String(a.ctimeMs) === String(b.ctimeMs) && String(a.nlink) === String(b.nlink);
const rows = [];
for (const entry of entries) {
  const pathState = fs.lstatSync(entry.remotePath);
  if (!pathState.isFile() || pathState.isSymbolicLink() || Number(pathState.nlink) !== 1) process.exit(71);
  const fd = fs.openSync(entry.remotePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const before = fs.fstatSync(fd);
    if (!before.isFile() || Number(before.nlink) !== 1 || !same(before, pathState)) process.exit(72);
    const hash = crypto.createHash('sha256');
    const buffer = Buffer.allocUnsafe(1024 * 1024);
    let position = 0;
    while (true) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, position);
      if (count === 0) break;
      hash.update(buffer.subarray(0, count));
      position += count;
    }
    const after = fs.fstatSync(fd);
    const pathAfter = fs.lstatSync(entry.remotePath);
    if (!same(before, after) || !same(before, pathAfter) || position !== Number(before.size)) process.exit(73);
    rows.push({ name: entry.name, size: position, sha256: hash.digest('hex') });
  } finally {
    fs.closeSync(fd);
  }
}
process.stdout.write(JSON.stringify(rows));
`;

function remoteStreamScript(remotePath) {
  return String.raw`
'use strict';
const fs = require('node:fs');
const target = ${JSON.stringify(remotePath)};
const beforePath = fs.lstatSync(target);
if (!beforePath.isFile() || beforePath.isSymbolicLink() || Number(beforePath.nlink) !== 1) process.exit(81);
const fd = fs.openSync(target, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
const before = fs.fstatSync(fd);
if (!before.isFile() || Number(before.nlink) !== 1 || String(before.dev) !== String(beforePath.dev) || String(before.ino) !== String(beforePath.ino)) process.exit(82);
const input = fs.createReadStream(target, { fd, autoClose: false });
input.on('error', () => { try { fs.closeSync(fd); } catch {} process.exit(83); });
input.on('end', () => {
  try {
    const after = fs.fstatSync(fd);
    const afterPath = fs.lstatSync(target);
    if (String(before.dev) !== String(after.dev) || String(before.ino) !== String(after.ino)
      || String(before.size) !== String(after.size) || String(before.dev) !== String(afterPath.dev)
      || String(before.ino) !== String(afterPath.ino) || Number(after.nlink) !== 1) process.exitCode = 84;
  } catch { process.exitCode = 85; }
  try { fs.closeSync(fd); } catch { process.exitCode = 86; }
});
input.pipe(process.stdout);
`;
}

class FrozenProductionCaptureError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'FrozenProductionCaptureError';
    this.code = code;
    this.details = details;
  }
}

function fail(code, message, details) {
  throw new FrozenProductionCaptureError(code, message, details);
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function exactObjectKeys(value, expected, code, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(code, `${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (stableJson(actual) !== stableJson(wanted)) {
    fail(code, `${label} has missing or unreviewed fields.`);
  }
}

function sameValue(left, right) {
  return stableJson(left) === stableJson(right);
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

function sameStat(left, right) {
  return sameValue(statIdentity(left), statIdentity(right));
}

function assertExactSha40(value, code, label) {
  if (typeof value !== 'string' || !SHA40_PATTERN.test(value)) {
    fail(code, `${label} must be an exact lowercase 40-hex commit SHA.`);
  }
  return value;
}

function safeJsonFromStdout(bytes, code, label) {
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.includes(0)) {
    fail(code, `${label} did not return one JSON document.`);
  }
  const decoded = bytes.toString('utf8');
  if (Buffer.from(decoded, 'utf8').compare(bytes) !== 0 || decoded.includes('\uFFFD')) {
    fail(code, `${label} returned invalid UTF-8.`);
  }
  try {
    return JSON.parse(decoded);
  } catch {
    fail(code, `${label} stdout was contaminated or was not valid JSON.`);
  }
}

function assertUuid(value, code, label) {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    fail(code, `${label} must be an exact UUID.`);
  }
  return value;
}

function normalizeRailwayStatus(raw, expectedCaptureSha) {
  const environments = raw?.environments?.edges;
  if (raw?.id !== reviewedEnvironment.projectId || !Array.isArray(environments)) {
    fail('RAILWAY_TARGET_MISMATCH', 'Railway status does not identify the immutable reviewed project.');
  }
  const matchingEnvironments = environments.map(edge => edge?.node).filter(node => (
    node?.id === reviewedEnvironment.environmentId
  ));
  if (matchingEnvironments.length !== 1) {
    fail('RAILWAY_TARGET_MISMATCH', 'Railway status does not contain exactly one reviewed environment.');
  }
  const environment = matchingEnvironments[0];
  const services = environment?.serviceInstances?.edges;
  const volumes = environment?.volumeInstances?.edges;
  if (!Array.isArray(services) || !Array.isArray(volumes)) {
    fail('RAILWAY_TARGET_MISMATCH', 'Railway status is missing service or volume metadata.');
  }
  const matchingServices = services.map(edge => edge?.node).filter(node => (
    node?.serviceId === reviewedEnvironment.serviceId
  ));
  const matchingVolumes = volumes.map(edge => edge?.node).filter(node => (
    node?.serviceId === reviewedEnvironment.serviceId
    && node?.volume?.id === reviewedEnvironment.volumeId
    && node?.volume?.name === reviewedEnvironment.volumeName
    && node?.mountPath === reviewedEnvironment.volumeMountPath
  ));
  if (
    matchingServices.length !== 1
    || matchingVolumes.length !== 1
    || matchingVolumes[0].state !== 'READY'
  ) {
    fail('RAILWAY_TARGET_MISMATCH', 'Railway service or volume identity is not exact and unique.');
  }
  const service = matchingServices[0];
  const deployment = service.latestDeployment;
  const instances = deployment?.instances;
  if (
    deployment?.status !== 'SUCCESS'
    || deployment?.meta?.commitHash !== expectedCaptureSha
    || !Array.isArray(instances)
    || instances.length !== 1
    || instances[0]?.status !== 'RUNNING'
  ) {
    fail('RAILWAY_DEPLOYMENT_NOT_SINGLETON', 'The expected successful deployment does not have exactly one running instance.');
  }
  return {
    projectId: reviewedEnvironment.projectId,
    environmentId: reviewedEnvironment.environmentId,
    serviceId: reviewedEnvironment.serviceId,
    serviceInstanceId: assertUuid(service.id, 'RAILWAY_IDENTITY_INVALID', 'Railway service instance ID'),
    volumeId: reviewedEnvironment.volumeId,
    volumeName: reviewedEnvironment.volumeName,
    volumeMountPath: reviewedEnvironment.volumeMountPath,
    volumeState: 'READY',
    captureDeploymentId: assertUuid(deployment.id, 'RAILWAY_IDENTITY_INVALID', 'Railway deployment ID'),
    captureDeployedSha: expectedCaptureSha,
    deploymentInstanceId: assertUuid(
      instances[0].id,
      'RAILWAY_IDENTITY_INVALID',
      'Railway deployment instance ID',
    ),
    deploymentInstanceStatus: 'RUNNING',
    replicaCount: 1,
  };
}

const RUNTIME_CONSERVATION_EXPECTED = Object.freeze({
  nodeEnvProduction: true,
  appDisabled: true,
  botDisabled: true,
  gsmDisabled: true,
  gsmEnabled: false,
  cleanResetDisabled: true,
  adminResetDisabled: true,
  allowedModesEmpty: true,
  schemaCompatibilityDisabled: true,
  validationReadOnlyDisabled: true,
  storageWriteGuardEnabled: true,
  preCompatibilityBackupDisabled: true,
  remediationSigningSecretEmpty: true,
  expectedExecutionShaEmpty: true,
});

function normalizeRuntimeSnapshot(raw, railway, expectedCaptureSha) {
  exactObjectKeys(raw, ['identity', 'storage', 'conservation'], 'RUNTIME_SNAPSHOT_INVALID', 'Runtime snapshot');
  exactObjectKeys(raw.identity, [
    'deployedSha', 'deploymentId', 'environmentId', 'projectId', 'replicaId', 'serviceId',
  ], 'RUNTIME_SNAPSHOT_INVALID', 'Runtime identity');
  exactObjectKeys(raw.storage, [
    'databasePath', 'volumeMountPath', 'volumeName',
  ], 'RUNTIME_SNAPSHOT_INVALID', 'Runtime storage identity');
  exactObjectKeys(raw.conservation, Object.keys(RUNTIME_CONSERVATION_EXPECTED), 'RUNTIME_SNAPSHOT_INVALID', 'Runtime conservation');
  const expectedIdentity = {
    projectId: reviewedEnvironment.projectId,
    environmentId: reviewedEnvironment.environmentId,
    serviceId: reviewedEnvironment.serviceId,
    deploymentId: railway.captureDeploymentId,
    replicaId: railway.deploymentInstanceId,
    deployedSha: expectedCaptureSha,
  };
  const expectedStorage = {
    volumeName: reviewedEnvironment.volumeName,
    volumeMountPath: reviewedEnvironment.volumeMountPath,
    databasePath: reviewedEnvironment.sourceDbPath,
  };
  if (!sameValue(raw.identity, expectedIdentity) || !sameValue(raw.storage, expectedStorage)) {
    fail('RUNTIME_IDENTITY_MISMATCH', 'Runtime identity, replica, deployment, or storage differs from the control plane.');
  }
  if (!sameValue(raw.conservation, RUNTIME_CONSERVATION_EXPECTED)) {
    fail('CAPTURE_CONSERVATION_INVALID', 'The complete frozen-runtime conservation contract is not active.');
  }
  return {
    identity: expectedIdentity,
    storage: expectedStorage,
    conservation: { ...RUNTIME_CONSERVATION_EXPECTED },
  };
}

function normalizeRemoteMetadata(raw, label) {
  if (!Array.isArray(raw) || raw.length !== SQLITE_FILE_NAMES.length) {
    fail('REMOTE_FILE_METADATA_INVALID', `${label} did not bind all three SQLite files.`);
  }
  const result = raw.map((row, index) => {
    exactObjectKeys(row, ['name', 'sha256', 'size'], 'REMOTE_FILE_METADATA_INVALID', `${label} file state`);
    if (
      row.name !== SQLITE_FILE_NAMES[index]
      || !Number.isSafeInteger(row.size)
      || row.size < 0
      || typeof row.sha256 !== 'string'
      || !SHA256_PATTERN.test(row.sha256)
    ) {
      fail('REMOTE_FILE_METADATA_INVALID', `${label} contains an invalid file state.`);
    }
    return { name: row.name, size: row.size, sha256: row.sha256 };
  });
  if (result[0].size <= 0) {
    fail('REMOTE_DATABASE_EMPTY', `${label} reports an empty production database.`);
  }
  return result;
}

function hashOpenDescriptor(fd, expectedSize) {
  const hash = crypto.createHash('sha256');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let position = 0;
  while (true) {
    const count = fs.readSync(fd, buffer, 0, buffer.length, position);
    if (count === 0) break;
    hash.update(buffer.subarray(0, count));
    position += count;
  }
  if (position !== expectedSize) {
    fail('LOCAL_CAPTURE_CHANGED', 'A local capture file changed while it was hashed.');
  }
  return { size: position, sha256: hash.digest('hex') };
}

function openExclusivePrivateFile(filePath) {
  let fd;
  try {
    fd = fs.openSync(
      filePath,
      fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    fs.fchmodSync(fd, 0o600);
    const stat = fs.fstatSync(fd);
    if (!stat.isFile() || Number(stat.nlink) !== 1 || (Number(stat.mode) & 0o777) !== 0o600) {
      fail('LOCAL_OUTPUT_FILE_INVALID', 'A capture output is not a private singly linked regular file.');
    }
    return fd;
  } catch (error) {
    if (fd !== undefined) fs.closeSync(fd);
    if (error instanceof FrozenProductionCaptureError) throw error;
    fail('LOCAL_OUTPUT_FILE_EXISTS', 'A capture output file already exists or cannot be created exclusively.');
  }
}

function finalizeCapturedFile(fd, filePath, expected, label) {
  fs.fsyncSync(fd);
  const before = fs.fstatSync(fd);
  const pathState = fs.lstatSync(filePath);
  if (
    !before.isFile()
    || Number(before.nlink) !== 1
    || (Number(before.mode) & 0o777) !== 0o600
    || !sameStat(before, pathState)
  ) {
    fail('LOCAL_CAPTURE_IDENTITY_INVALID', `${label} is not a private singly linked stable file.`);
  }
  const actual = hashOpenDescriptor(fd, Number(before.size));
  const after = fs.fstatSync(fd);
  const pathAfter = fs.lstatSync(filePath);
  if (!sameStat(before, after) || !sameStat(before, pathAfter)) {
    fail('LOCAL_CAPTURE_CHANGED', `${label} changed during local verification.`);
  }
  if (!sameValue(actual, { size: expected.size, sha256: expected.sha256 })) {
    fail('BINARY_TRANSPORT_MISMATCH', `${label} differs from the pre-capture remote size or SHA-256.`);
  }
  return { name: expected.name, ...actual };
}

function writeExclusivePrivateFile(filePath, bytes) {
  const fd = openExclusivePrivateFile(filePath);
  try {
    let position = 0;
    while (position < bytes.length) {
      position += fs.writeSync(fd, bytes, position, bytes.length - position, position);
    }
    fs.fsyncSync(fd);
    const stat = fs.fstatSync(fd);
    const pathState = fs.lstatSync(filePath);
    if (
      Number(stat.size) !== bytes.length
      || Number(stat.nlink) !== 1
      || (Number(stat.mode) & 0o777) !== 0o600
      || !sameStat(stat, pathState)
    ) {
      fail('LOCAL_OUTPUT_FILE_INVALID', 'A generated output file is not stable and private.');
    }
  } finally {
    fs.closeSync(fd);
  }
}

function fsyncDirectory(directory) {
  const fd = fs.openSync(directory, fs.constants.O_RDONLY | (fs.constants.O_DIRECTORY || 0));
  try {
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
}

function assertOutsideBoundary(candidate, boundary, code, label) {
  if (candidate === boundary || candidate.startsWith(`${boundary}${path.sep}`)) {
    fail(code, `${label} overlaps a forbidden directory.`);
  }
}

function validateOutputRoot(outputRoot) {
  if (typeof outputRoot !== 'string' || outputRoot.length === 0 || outputRoot.includes('\0')) {
    fail('OUTPUT_ROOT_INVALID', 'The capture output root must be an explicit new path.');
  }
  const requested = path.resolve(outputRoot);
  const repository = fs.realpathSync(REPOSITORY_ROOT);
  assertOutsideBoundary(requested, repository, 'OUTPUT_ROOT_FORBIDDEN', 'Capture output root');
  assertOutsideBoundary(requested, path.resolve('/data'), 'OUTPUT_ROOT_FORBIDDEN', 'Capture output root');
  if (requested === path.parse(requested).root) {
    fail('OUTPUT_ROOT_FORBIDDEN', 'A filesystem root cannot be used as capture output.');
  }
  const parentRequested = path.dirname(requested);
  let parentStat;
  let parentResolved;
  try {
    parentStat = fs.lstatSync(parentRequested);
    parentResolved = fs.realpathSync(parentRequested);
  } catch {
    fail('OUTPUT_PARENT_INVALID', 'The capture output parent must already exist.');
  }
  const resolvedStat = fs.lstatSync(parentResolved);
  if (
    !parentStat.isDirectory()
    || parentStat.isSymbolicLink()
    || !resolvedStat.isDirectory()
    || resolvedStat.isSymbolicLink()
    || String(parentStat.dev) !== String(resolvedStat.dev)
    || String(parentStat.ino) !== String(resolvedStat.ino)
  ) {
    fail('OUTPUT_PARENT_INVALID', 'The capture output parent must be one real non-symlink directory.');
  }
  assertOutsideBoundary(parentResolved, repository, 'OUTPUT_ROOT_FORBIDDEN', 'Capture output parent');
  const canonicalRequested = path.join(parentResolved, path.basename(requested));
  try {
    fs.lstatSync(canonicalRequested);
    fail('OUTPUT_ROOT_EXISTS', 'The capture output root must not already exist.');
  } catch (error) {
    if (error instanceof FrozenProductionCaptureError) throw error;
    if (error?.code !== 'ENOENT') fail('OUTPUT_ROOT_INVALID', 'The capture output root cannot be inspected safely.');
  }
  return { requested: canonicalRequested, parent: parentResolved };
}

function safeRemoveCreatedDirectory(directory, identity, parent) {
  if (!directory || !identity) return;
  const resolved = path.resolve(directory);
  if (path.dirname(resolved) !== parent) return;
  try {
    const stat = fs.lstatSync(resolved);
    if (
      stat.isDirectory()
      && !stat.isSymbolicLink()
      && String(stat.dev) === String(identity.dev)
      && String(stat.ino) === String(identity.ino)
    ) {
      fs.rmSync(resolved, { recursive: true, force: false });
    }
  } catch {
    // Cleanup must never broaden its target after a path swap.
  }
}

function normalizeSourceBindings(value) {
  if (!Array.isArray(value) || value.length !== REQUIRED_SOURCE_BINDING_PATHS.length) {
    fail('SOURCE_BINDINGS_INVALID', 'The capture must bind the exact evidence-builder source set.');
  }
  return value.map((row, index) => {
    exactObjectKeys(row, ['relativePath', 'sha256', 'size'], 'SOURCE_BINDINGS_INVALID', 'Source binding');
    if (
      row.relativePath !== REQUIRED_SOURCE_BINDING_PATHS[index]
      || !Number.isSafeInteger(row.size)
      || row.size <= 0
      || typeof row.sha256 !== 'string'
      || !SHA256_PATTERN.test(row.sha256)
    ) {
      fail('SOURCE_BINDINGS_INVALID', 'A source binding is missing, reordered, or invalid.');
    }
    return { relativePath: row.relativePath, size: row.size, sha256: row.sha256 };
  });
}

function readRegularFileNoFollow(filePath) {
  let fd;
  try {
    const pathBefore = fs.lstatSync(filePath);
    if (!pathBefore.isFile() || pathBefore.isSymbolicLink()) {
      fail('SOURCE_FILE_INVALID', 'A bound repository source is not a regular file.');
    }
    fd = fs.openSync(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
    const before = fs.fstatSync(fd);
    if (!before.isFile() || Number(before.nlink) !== 1) {
      fail('SOURCE_FILE_INVALID', 'A bound repository source is not singly linked.');
    }
    const bytes = fs.readFileSync(fd);
    const after = fs.fstatSync(fd);
    const pathAfter = fs.lstatSync(filePath);
    if (!sameStat(before, after) || !sameStat(before, pathAfter) || bytes.length !== Number(before.size)) {
      fail('SOURCE_FILE_CHANGED', 'A bound repository source changed while it was read.');
    }
    return bytes;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function runCommandBuffered(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const stdout = [];
    const stderr = [];
    let stdoutSize = 0;
    let stderrSize = 0;
    let settled = false;
    const maxOutput = options.maxOutput || 8 * 1024 * 1024;
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs || 60_000);
    child.stdout.on('data', chunk => {
      stdoutSize += chunk.length;
      if (stdoutSize > maxOutput) child.kill('SIGKILL');
      else stdout.push(chunk);
    });
    child.stderr.on('data', chunk => {
      stderrSize += chunk.length;
      if (stderrSize > maxOutput) child.kill('SIGKILL');
      else stderr.push(chunk);
    });
    child.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new FrozenProductionCaptureError('SUBPROCESS_FAILED', 'A required local subprocess could not start.'));
    });
    child.on('close', (code, signal) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 || signal || stdoutSize > maxOutput || stderrSize > maxOutput) {
        reject(new FrozenProductionCaptureError('SUBPROCESS_FAILED', 'A required subprocess failed; its output was withheld.'));
        return;
      }
      resolve({ stdout: Buffer.concat(stdout), stderrSha256: sha256(Buffer.concat(stderr)), stderrSize });
    });
  });
}

function streamCommandToDescriptor(command, args, fd, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env,
      shell: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const output = fs.createWriteStream('/dev/null', { fd, autoClose: false, start: 0 });
    const stderrHash = crypto.createHash('sha256');
    let stderrSize = 0;
    let childClosed = false;
    let outputFinished = false;
    let childResult = null;
    let settled = false;
    const maxStderr = options.maxStderr || 1024 * 1024;
    const timer = setTimeout(() => child.kill('SIGKILL'), options.timeoutMs || 30 * 60_000);
    const finish = () => {
      if (settled || !childClosed || !outputFinished) return;
      settled = true;
      clearTimeout(timer);
      if (childResult.code !== 0 || childResult.signal || stderrSize > maxStderr) {
        reject(new FrozenProductionCaptureError('REMOTE_STREAM_FAILED', 'Railway SSH streaming failed; stderr was withheld.'));
        return;
      }
      resolve({ stderrSize, stderrSha256: stderrHash.digest('hex') });
    };
    const abort = code => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(new FrozenProductionCaptureError(code, 'Railway SSH streaming failed safely.'));
    };
    child.stderr.on('data', chunk => {
      stderrSize += chunk.length;
      stderrHash.update(chunk);
      if (stderrSize > maxStderr) child.kill('SIGKILL');
    });
    child.on('error', () => abort('REMOTE_STREAM_FAILED'));
    output.on('error', () => abort('LOCAL_CAPTURE_WRITE_FAILED'));
    output.on('finish', () => { outputFinished = true; finish(); });
    child.on('close', (code, signal) => { childClosed = true; childResult = { code, signal }; finish(); });
    child.stdout.pipe(output);
  });
}

function railwaySshArguments(deploymentInstanceId, commandArgs) {
  assertUuid(deploymentInstanceId, 'RAILWAY_IDENTITY_INVALID', 'Railway deployment instance ID');
  return [
    'ssh',
    '--project', reviewedEnvironment.projectId,
    '--environment', reviewedEnvironment.environmentId,
    '--service', reviewedEnvironment.serviceId,
    '--deployment-instance', deploymentInstanceId,
    '--',
    ...commandArgs,
  ];
}

function createNativeCaptureDependencies({ workDirectory, env = process.env } = {}) {
  if (!workDirectory) fail('WORK_DIRECTORY_REQUIRED', 'A private acquisition work directory is required.');
  const childEnv = { ...env };
  for (const name of [
    'NODE_ENV', 'DB_PATH',
    'RAILWAY_PROJECT_ID', 'RAILWAY_ENVIRONMENT_ID', 'RAILWAY_SERVICE_ID',
    'RAILWAY_DEPLOYMENT_ID', 'RAILWAY_REPLICA_ID', 'RAILWAY_GIT_COMMIT_SHA',
    'RAILWAY_VOLUME_NAME', 'RAILWAY_VOLUME_MOUNT_PATH',
    'APP_DISABLED', 'BOT_DISABLED', 'GSM_DISABLED', 'GSM_ENABLED',
    'SKYTECH_CLEAN_RESET_ENABLED', 'SKYTECH_CLEAN_RESET_TOKEN', 'ADMIN_RESET_PASSWORD',
    'SKYTECH_PRE_COMPATIBILITY_BACKUP_ENABLED', 'SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA',
    'SKYTECH_PRE_COMPATIBILITY_BACKUP_TOKEN',
    'PRODUCTION_SCOPE_REMEDIATION_ENABLED', 'PRODUCTION_SCOPE_REMEDIATION_WRITE_FREEZE',
    'PRODUCTION_SCOPE_REMEDIATION_SCHEMA_COMPATIBILITY',
    'PRODUCTION_SCOPE_REMEDIATION_VALIDATION_READ_ONLY',
    'PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODES', 'PRODUCTION_SCOPE_REMEDIATION_ALLOWED_MODE',
    'PRODUCTION_SCOPE_REMEDIATION_SIGNING_SECRET',
    'PRODUCTION_SCOPE_REMEDIATION_EXPECTED_EXECUTION_SHA',
  ]) {
    delete childEnv[name];
  }
  async function sshBuffered(deploymentInstanceId, commandArgs, code) {
    const result = await runCommandBuffered(
      'railway',
      railwaySshArguments(deploymentInstanceId, commandArgs),
      {
        cwd: workDirectory,
        env: childEnv,
        timeoutMs: 10 * 60_000,
      },
    );
    return safeJsonFromStdout(result.stdout, code, code);
  }
  return {
    now: () => new Date(),
    randomUUID: () => crypto.randomUUID(),
    async initialize() {
      const version = await runCommandBuffered('railway', ['--version'], {
        cwd: workDirectory,
        env: childEnv,
      });
      if (version.stdout.toString('utf8').trimEnd() !== RAILWAY_CLI_VERSION) {
        fail('RAILWAY_CLI_VERSION_MISMATCH', `The capture requires ${RAILWAY_CLI_VERSION}.`);
      }
      await runCommandBuffered('railway', ['whoami'], {
        cwd: workDirectory,
        env: childEnv,
      });
      await runCommandBuffered('railway', [
        'link',
        '--project', reviewedEnvironment.projectId,
        '--environment', reviewedEnvironment.environmentId,
        '--service', reviewedEnvironment.serviceId,
      ], { cwd: workDirectory, env: childEnv });
    },
    async repositoryHead() {
      const result = await runCommandBuffered('git', ['rev-parse', 'HEAD^{commit}'], {
        cwd: REPOSITORY_ROOT,
        env: childEnv,
      });
      const match = /^([a-f0-9]{40})\n?$/.exec(result.stdout.toString('utf8'));
      if (!match) fail('REPOSITORY_HEAD_INVALID', 'The repository HEAD is not one exact commit.');
      return match[1];
    },
    async sourceBindings({ headSha }) {
      const rows = [];
      for (const relativePath of REQUIRED_SOURCE_BINDING_PATHS) {
        const bytes = readRegularFileNoFollow(path.join(REPOSITORY_ROOT, relativePath));
        const committed = await runCommandBuffered('git', ['show', `${headSha}:${relativePath}`], {
          cwd: REPOSITORY_ROOT,
          env: childEnv,
          maxOutput: Math.max(8 * 1024 * 1024, bytes.length + 1024),
        });
        if (!committed.stdout.equals(bytes)) {
          fail('SOURCE_BINDING_NOT_COMMITTED', `Pinned source is not the exact content committed at capture HEAD: ${relativePath}.`);
        }
        rows.push({ relativePath, size: bytes.length, sha256: sha256(bytes) });
      }
      return rows;
    },
    async controlPlane() {
      const result = await runCommandBuffered('railway', ['status', '--json'], {
        cwd: workDirectory,
        env: childEnv,
        timeoutMs: 60_000,
      });
      return safeJsonFromStdout(result.stdout, 'RAILWAY_STATUS_INVALID', 'Railway status');
    },
    async runtimeSnapshot({ railway }) {
      return sshBuffered(
        railway.deploymentInstanceId,
        ['node', '-e', RUNTIME_SNAPSHOT_SCRIPT],
        'RUNTIME_SNAPSHOT_INVALID',
      );
    },
    async remoteMetadata({ railway }) {
      return sshBuffered(
        railway.deploymentInstanceId,
        ['node', '-e', REMOTE_FILE_METADATA_SCRIPT, JSON.stringify(REMOTE_DATABASE_PATHS)],
        'REMOTE_FILE_METADATA_INVALID',
      );
    },
    async streamRemoteFile({ railway, remotePath, destinationFd }) {
      return streamCommandToDescriptor(
        'railway',
        railwaySshArguments(railway.deploymentInstanceId, ['node', '-e', remoteStreamScript(remotePath)]),
        destinationFd,
        {
          cwd: workDirectory,
          env: childEnv,
        },
      );
    },
  };
}

function nextTimestamp(nowValue, afterMs = null) {
  const supplied = nowValue instanceof Date ? nowValue.getTime() : new Date(nowValue).getTime();
  if (!Number.isFinite(supplied)) fail('CLOCK_INVALID', 'Capture clock returned an invalid timestamp.');
  const value = afterMs === null ? supplied : Math.max(supplied, afterMs + 1);
  return { ms: value, iso: new Date(value).toISOString() };
}

function builderConservation(runtime) {
  return {
    adminResetDisabled: runtime.conservation.adminResetDisabled,
    allowedModesEmpty: runtime.conservation.allowedModesEmpty,
    appDisabled: runtime.conservation.appDisabled,
    botDisabled: runtime.conservation.botDisabled,
    cleanResetDisabled: runtime.conservation.cleanResetDisabled,
    gsmDisabled: runtime.conservation.gsmDisabled,
    gsmEnabled: runtime.conservation.gsmEnabled,
    schemaCompatibilityDisabled: runtime.conservation.schemaCompatibilityDisabled,
    singleReplica: true,
    storageWriteGuardEnabled: runtime.conservation.storageWriteGuardEnabled,
  };
}

async function captureRound({ label, directory, railway, dependencies, capturedAt, captureId }) {
  const pre = normalizeRemoteMetadata(
    await dependencies.remoteMetadata({ railway, phase: `${label}:pre` }),
    `${label} pre-capture metadata`,
  );
  const files = [];
  for (let index = 0; index < REMOTE_DATABASE_PATHS.length; index += 1) {
    const remote = REMOTE_DATABASE_PATHS[index];
    const expected = pre[index];
    const destinationPath = path.join(directory, remote.name);
    const fd = openExclusivePrivateFile(destinationPath);
    try {
      await dependencies.streamRemoteFile({
        railway,
        round: label,
        name: remote.name,
        remotePath: remote.remotePath,
        destinationPath,
        destinationFd: fd,
      });
      files.push(finalizeCapturedFile(fd, destinationPath, expected, `${label}/${remote.name}`));
    } finally {
      fs.closeSync(fd);
    }
  }
  const post = normalizeRemoteMetadata(
    await dependencies.remoteMetadata({ railway, phase: `${label}:post` }),
    `${label} post-capture metadata`,
  );
  if (!sameValue(pre, post) || !sameValue(files, pre)) {
    fail('REMOTE_FILE_MUTATED', `${label} changed between its pre-state, stream, and post-state.`);
  }
  fsyncDirectory(directory);
  return { captureId, capturedAt, files };
}

async function acquireFrozenProductionSqliteCapture(options, injectedDependencies = null) {
  const expectedCaptureSha = assertExactSha40(
    options?.expectedCaptureSha,
    'EXPECTED_CAPTURE_SHA_INVALID',
    'Expected capture SHA',
  );
  const output = validateOutputRoot(options?.outputRoot);
  const lockPath = `${output.requested}.publish.lock`;
  let lockFd;
  let stagingDirectory;
  let stagingIdentity;
  let publishedIdentity;
  let published = false;
  try {
    lockFd = fs.openSync(
      lockPath,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL | (fs.constants.O_NOFOLLOW || 0),
      0o600,
    );
    fs.fchmodSync(lockFd, 0o600);
  } catch {
    fail('OUTPUT_LOCK_EXISTS', 'The exclusive capture publication lock cannot be acquired.');
  }
  try {
    try {
      fs.mkdirSync(output.requested, { mode: 0o700 });
    } catch {
      fail('OUTPUT_ROOT_EXISTS', 'The capture output root appeared or cannot be created exclusively.');
    }
    stagingDirectory = output.requested;
    fs.chmodSync(stagingDirectory, 0o700);
    stagingIdentity = fs.lstatSync(stagingDirectory);
    if (!stagingIdentity.isDirectory() || stagingIdentity.isSymbolicLink()) {
      fail('OUTPUT_STAGING_INVALID', 'The capture staging directory is unsafe.');
    }
    published = true;
    publishedIdentity = stagingIdentity;
    const roundADirectory = path.join(stagingDirectory, 'round-a');
    const roundBDirectory = path.join(stagingDirectory, 'round-b');
    const railwayWorkDirectory = path.join(stagingDirectory, '.railway-control');
    for (const directory of [roundADirectory, roundBDirectory, railwayWorkDirectory]) {
      fs.mkdirSync(directory, { mode: 0o700 });
      fs.chmodSync(directory, 0o700);
    }
    const dependencies = injectedDependencies || createNativeCaptureDependencies({
      workDirectory: railwayWorkDirectory,
    });
    for (const method of [
      'initialize', 'repositoryHead', 'sourceBindings', 'controlPlane', 'runtimeSnapshot',
      'remoteMetadata', 'streamRemoteFile', 'now', 'randomUUID',
    ]) {
      if (typeof dependencies[method] !== 'function') {
        fail('CAPTURE_DEPENDENCY_INVALID', `Capture dependency is missing: ${method}.`);
      }
    }

    const windowStart = nextTimestamp(dependencies.now());
    const headBefore = await dependencies.repositoryHead();
    if (headBefore !== expectedCaptureSha) {
      fail('REPOSITORY_HEAD_MISMATCH', 'Repository HEAD differs from the expected frozen capture SHA.');
    }
    const sourcesBefore = normalizeSourceBindings(await dependencies.sourceBindings({ headSha: headBefore }));
    await dependencies.initialize({ workDirectory: railwayWorkDirectory });

    const railwayBefore = normalizeRailwayStatus(
      await dependencies.controlPlane({ phase: 'before' }),
      expectedCaptureSha,
    );
    const runtimeBefore = normalizeRuntimeSnapshot(
      await dependencies.runtimeSnapshot({ railway: railwayBefore, phase: 'before' }),
      railwayBefore,
      expectedCaptureSha,
    );

    const roundATime = nextTimestamp(dependencies.now(), windowStart.ms);
    const roundAId = dependencies.randomUUID();
    assertUuid(roundAId, 'CAPTURE_ID_INVALID', 'roundA capture ID');
    const roundA = await captureRound({
      label: 'roundA',
      directory: roundADirectory,
      railway: railwayBefore,
      dependencies,
      capturedAt: roundATime.iso,
      captureId: roundAId,
    });

    const railwayBetween = normalizeRailwayStatus(
      await dependencies.controlPlane({ phase: 'between' }),
      expectedCaptureSha,
    );
    const runtimeBetween = normalizeRuntimeSnapshot(
      await dependencies.runtimeSnapshot({ railway: railwayBetween, phase: 'between' }),
      railwayBetween,
      expectedCaptureSha,
    );
    if (!sameValue(railwayBefore, railwayBetween) || !sameValue(runtimeBefore, runtimeBetween)) {
      fail('CAPTURE_IDENTITY_DRIFT', 'Control-plane or runtime identity changed between capture rounds.');
    }

    const roundBTime = nextTimestamp(dependencies.now(), roundATime.ms);
    let roundBId = dependencies.randomUUID();
    assertUuid(roundBId, 'CAPTURE_ID_INVALID', 'roundB capture ID');
    if (roundBId === roundAId) fail('CAPTURE_ID_INVALID', 'Capture rounds require distinct UUIDs.');
    const roundB = await captureRound({
      label: 'roundB',
      directory: roundBDirectory,
      railway: railwayBefore,
      dependencies,
      capturedAt: roundBTime.iso,
      captureId: roundBId,
    });

    const railwayAfter = normalizeRailwayStatus(
      await dependencies.controlPlane({ phase: 'after' }),
      expectedCaptureSha,
    );
    const runtimeAfter = normalizeRuntimeSnapshot(
      await dependencies.runtimeSnapshot({ railway: railwayAfter, phase: 'after' }),
      railwayAfter,
      expectedCaptureSha,
    );
    if (
      !sameValue(railwayBefore, railwayAfter)
      || !sameValue(runtimeBefore, runtimeAfter)
      || !sameValue(railwayBefore, railwayBetween)
      || !sameValue(runtimeBefore, runtimeBetween)
    ) {
      fail('CAPTURE_IDENTITY_DRIFT', 'Control-plane or runtime identity changed during capture.');
    }
    for (const index of [0, 1]) {
      if (!sameValue(roundA.files[index], roundB.files[index])) {
        fail('CAPTURE_DURABLE_ROUNDS_MISMATCH', 'DB/WAL are not byte-identical across the two frozen rounds.');
      }
    }

    const headAfter = await dependencies.repositoryHead();
    const sourcesAfter = normalizeSourceBindings(await dependencies.sourceBindings({ headSha: headAfter }));
    if (headAfter !== headBefore || !sameValue(sourcesBefore, sourcesAfter)) {
      fail('REPOSITORY_STATE_DRIFT', 'Repository HEAD or evidence source bindings changed during capture.');
    }

    const generatedTime = nextTimestamp(dependencies.now(), roundBTime.ms);
    const classificationAuthorityFingerprint = sha256(stableJson(classificationAuthoritySnapshot()));
    const control = {
      controlVersion: 2,
      productionWriteAuthorized: false,
      networkAccessAuthorized: false,
      rawCaptureSQLiteOpenAuthorized: false,
      analysisRound: ANALYSIS_ROUND,
      captureWindowStartedAt: windowStart.iso,
      evidenceGeneratedAt: generatedTime.iso,
      conservation: builderConservation(runtimeBefore),
      repository: {
        githubRepository: reviewedEnvironment.githubRepository,
        headSha: expectedCaptureSha,
      },
      railway: {
        projectId: railwayBefore.projectId,
        environmentId: railwayBefore.environmentId,
        serviceId: railwayBefore.serviceId,
        volumeId: railwayBefore.volumeId,
        volumeName: railwayBefore.volumeName,
        volumeMountPath: railwayBefore.volumeMountPath,
        serviceInstanceId: railwayBefore.serviceInstanceId,
        deploymentInstanceId: railwayBefore.deploymentInstanceId,
        captureDeploymentId: railwayBefore.captureDeploymentId,
        captureDeployedSha: railwayBefore.captureDeployedSha,
      },
      rounds: { roundA, roundB },
      baseline: structuredClone(PRODUCTION_BASELINE_CONTRACT),
      classificationAuthorityFingerprint,
      sourceBindings: sourcesBefore,
    };
    const controlBytes = Buffer.from(`${JSON.stringify(control, null, 2)}\n`);
    const controlSha256 = sha256(controlBytes);
    writeExclusivePrivateFile(path.join(stagingDirectory, CAPTURE_CONTROL_FILE), controlBytes);
    writeExclusivePrivateFile(
      path.join(stagingDirectory, `${CAPTURE_CONTROL_FILE}.sha256`),
      Buffer.from(`${controlSha256}  ${CAPTURE_CONTROL_FILE}\n`),
    );

    const safeOutput = {
      outputVersion: 1,
      verdict: 'FROZEN_PRODUCTION_SQLITE_CAPTURE_COMPLETE',
      productionWritePerformed: false,
      rawCaptureOpenedBySQLite: false,
      networkAcquisitionPerformed: true,
      commandModeRailwaySsh: true,
      exactDeploymentInstancePinned: true,
      captureControlSha256: controlSha256,
      repository: control.repository,
      railway: control.railway,
      runtime: runtimeBefore,
      conservation: control.conservation,
      rounds: control.rounds,
      durableRoundsByteIdentical: true,
      shmObservationByteIdentical: sameValue(roundA.files[2], roundB.files[2]),
      prePostRemoteMetadataStable: true,
      controlPlaneAndRuntimeStable: true,
      builderHandoff: {
        controlPath: CAPTURE_CONTROL_FILE,
        controlSha256,
        roundADirectory: 'round-a',
        roundBDirectory: 'round-b',
        analysisRound: ANALYSIS_ROUND,
      },
    };
    const outputBytes = Buffer.from(`${JSON.stringify(safeOutput, null, 2)}\n`);
    const outputSha256 = sha256(outputBytes);
    writeExclusivePrivateFile(path.join(stagingDirectory, CAPTURE_OUTPUT_FILE), outputBytes);
    writeExclusivePrivateFile(
      path.join(stagingDirectory, `${CAPTURE_OUTPUT_FILE}.sha256`),
      Buffer.from(`${outputSha256}  ${CAPTURE_OUTPUT_FILE}\n`),
    );

    fs.rmSync(railwayWorkDirectory, { recursive: true, force: false });
    for (const directory of [roundADirectory, roundBDirectory, stagingDirectory]) fsyncDirectory(directory);
    const publishedState = fs.lstatSync(output.requested);
    if (
      !publishedState.isDirectory()
      || publishedState.isSymbolicLink()
      || String(publishedState.dev) !== String(publishedIdentity.dev)
      || String(publishedState.ino) !== String(publishedIdentity.ino)
    ) {
      fail('OUTPUT_PUBLICATION_INVALID', 'The exclusive capture directory changed identity.');
    }
    fsyncDirectory(output.parent);
    fs.closeSync(lockFd);
    lockFd = undefined;
    fs.unlinkSync(lockPath);
    fsyncDirectory(output.parent);
    return {
      outputRoot: output.requested,
      captureControlPath: path.join(output.requested, CAPTURE_CONTROL_FILE),
      captureControlSha256: controlSha256,
      captureOutputPath: path.join(output.requested, CAPTURE_OUTPUT_FILE),
      captureOutputSha256: outputSha256,
      control,
      output: safeOutput,
    };
  } catch (error) {
    if (published) safeRemoveCreatedDirectory(output.requested, publishedIdentity, output.parent);
    else safeRemoveCreatedDirectory(stagingDirectory, stagingIdentity, output.parent);
    throw error;
  } finally {
    if (lockFd !== undefined) {
      try { fs.closeSync(lockFd); } catch {}
    }
    try {
      const stat = fs.lstatSync(lockPath);
      if (stat.isFile() && !stat.isSymbolicLink() && Number(stat.nlink) === 1) fs.unlinkSync(lockPath);
    } catch {}
  }
}

module.exports = {
  ANALYSIS_ROUND,
  CAPTURE_CONTROL_FILE,
  CAPTURE_OUTPUT_FILE,
  REMOTE_DATABASE_PATHS,
  RUNTIME_CONSERVATION_EXPECTED,
  FrozenProductionCaptureError,
  acquireFrozenProductionSqliteCapture,
  createNativeCaptureDependencies,
  normalizeRailwayStatus,
  normalizeRemoteMetadata,
  normalizeRuntimeSnapshot,
  railwaySshArguments,
  validateOutputRoot,
};
