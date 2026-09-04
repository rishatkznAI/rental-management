import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { createPlatformIdentityContext } from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const mutableFs = require('node:fs');
const {
  assertOutputPaths,
  copyInspectedSourceFile,
  resolveSafeEphemeralRoot,
  writeExclusiveEvidence,
} = require('../server/scripts/simulate-production-scope-identity-authorization-read-only.js');
const {
  AUTHORITY,
  COMPANY_ID,
  EXPECTED_EXACT_CHANGES,
  EXPECTED_ROW_COUNT_DELTAS,
  OWNER_MEMBERSHIP_ID,
  OWNER_PRINCIPAL_ID,
  buildCanonicalIdentityBootstrapConfig,
} = require('../server/lib/identity-bootstrap-execution-bundle.js');
const {
  calculateBootstrapChecksum,
  getSchemaFingerprint,
} = require('../server/lib/platform-identity-bootstrap-validation.js');
const {
  validateIdentitySimulation,
} = require('../server/lib/production-scope-execution-authorization.js');
const {
  buildProductionScopeExecutionBundle,
} = require('../server/lib/production-scope-execution-plan-bundle.js');
const {
  PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
  PRODUCTION_BASELINE_CONTRACT,
  currentRepositorySourceBindingsFingerprint,
} = require('../server/lib/production-scope-evidence-builder.js');
const {
  classificationAuthoritySnapshot,
} = require('../server/lib/production-scope-evidence-classification.js');
const {
  stableJsonSha256: baselineStableJsonSha256,
} = require('../server/lib/production-scope-baseline-contract.js');
const {
  calculateSourceSnapshotHash,
} = require('../server/lib/production-scope-remediation-manifest.js');
const {
  databaseContentFingerprint,
  sqliteFileSetFingerprint,
  sqliteObservedFileSetFingerprint,
} = require('../server/lib/production-scope-remediation-runner.js');
const {
  collectionFingerprint,
  databaseIdentity,
  stableJson,
} = require('../server/lib/production-scope-remediation.js');

const SCRIPT = 'server/scripts/simulate-production-scope-identity-authorization-read-only.js';
const EXECUTION_SHA = '1'.repeat(40);
const CAPTURE_DEPLOYMENT_ID = '11111111-1111-4111-8111-111111111111';
const USERS = Object.freeze([
  Object.freeze({
    id: OWNER_PRINCIPAL_ID,
    status: 'Активен',
    role: 'Администратор',
    name: 'Хабибрахманов Ришат Ринатович',
  }),
  Object.freeze({
    id: '1776673416137',
    status: 'Активен',
    role: 'Офис-менеджер',
    name: 'Мениса',
    email: 'kmzh@mantall.ru',
  }),
  Object.freeze({
    id: '1787547467703',
    status: 'Активен',
    role: 'Менеджер по аренде',
    name: 'Айзат',
    email: 'mp2@mantall.ru',
  }),
  Object.freeze({
    id: 'DEMO-USER-CARRIER',
    status: 'Активен',
    role: 'Перевозчик',
    name: 'Demo Carrier User',
  }),
  Object.freeze({
    id: 'production-smoke-admin',
    status: 'Активен',
    role: 'Администратор',
    name: 'Production Smoke Admin',
  }),
]);

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function fileStatIdentity(stat) {
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

function manifestHash(manifest) {
  const projected = structuredClone(manifest);
  delete projected.manifestSha256;
  return sha256(stableJson(projected));
}

function sourceFileSet(dbPath) {
  const file = name => {
    const suffix = name === 'app.sqlite' ? '' : name.slice('app.sqlite'.length);
    const filePath = `${dbPath}${suffix}`;
    if (!existsSync(filePath)) return null;
    const bytes = readFileSync(filePath);
    return { name, sizeBytes: bytes.length, sha256: sha256(bytes) };
  };
  return {
    database: file('app.sqlite'),
    wal: file('app.sqlite-wal'),
    shm: file('app.sqlite-shm'),
  };
}

function sourceFileRows(files) {
  return ['database', 'wal', 'shm'].filter(key => files[key]).map(key => ({
    name: files[key].name,
    size: files[key].sizeBytes,
    sha256: files[key].sha256,
  }));
}

function identityCounts() {
  return Object.fromEntries(Object.entries(EXPECTED_ROW_COUNT_DELTAS).map(
    ([table, delta]) => [table, delta === 0 ? [0] : [0, delta]],
  ));
}

function authorityCommitments() {
  return {
    baselineContractSha256: baselineStableJsonSha256(PRODUCTION_BASELINE_CONTRACT),
    candidateKeySetSha256: PRODUCTION_BASELINE_CONTRACT.candidateKeySetSha256,
    candidateAuthoritySha256: PRODUCTION_BASELINE_CONTRACT.candidateAuthoritySha256,
    canonicalScopeSha256: PRODUCTION_BASELINE_CONTRACT.canonicalScopeSha256,
    classificationAuthorityFingerprint: sha256(stableJson(classificationAuthoritySnapshot())),
  };
}

function buildReviewBundleFixture(t) {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fresh-identity-simulation-test-'));
  const liveDirectory = path.join(directory, 'live');
  const captureDirectory = path.join(directory, 'frozen-capture');
  mkdirSync(liveDirectory);
  mkdirSync(captureDirectory);
  const liveDbPath = path.join(liveDirectory, 'app.sqlite');
  const dbPath = path.join(captureDirectory, 'app.sqlite');
  const context = createPlatformIdentityContext({ users: USERS, dbPath: liveDbPath });
  const db = context.db;
  assert.equal(db.pragma('journal_mode = WAL', { simple: true }), 'wal');
  db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)').run(
    'app_settings',
    JSON.stringify({ preserveExactly: true }),
  );
  const schemaFingerprint = getSchemaFingerprint(db);
  const unsignedConfig = buildCanonicalIdentityBootstrapConfig({
    approvedAt: '2026-09-01T00:00:00.000Z',
    schemaFingerprint,
    backupReference: 'UNRESOLVED_FRESH_PRODUCTION_BACKUP',
  });
  const configChecksum = calculateBootstrapChecksum(db, unsignedConfig);
  const config = buildCanonicalIdentityBootstrapConfig({
    approvedAt: '2026-09-01T00:00:00.000Z',
    schemaFingerprint,
    backupReference: 'UNRESOLVED_FRESH_PRODUCTION_BACKUP',
    configChecksum,
  });
  const users = context.readUsers();
  const dbIdentity = databaseIdentity(db);
  const databaseFingerprint = databaseContentFingerprint(db);
  const collectionFingerprints = Object.fromEntries(db
    .prepare('SELECT name, json FROM app_data ORDER BY name').all()
    .map(row => [row.name, sha256(row.json)]));
  for (const suffix of ['', '-wal', '-shm']) {
    copyFileSync(`${liveDbPath}${suffix}`, `${dbPath}${suffix}`);
  }
  context.close();

  const files = sourceFileSet(dbPath);
  const sourceBindingsFingerprint = currentRepositorySourceBindingsFingerprint();
  const source = {
    captureDeployedSha: EXECUTION_SHA,
    captureDeploymentId: CAPTURE_DEPLOYMENT_ID,
    railwayIdentity: {
      projectId: '22222222-2222-4222-8222-222222222222',
      environmentId: '33333333-3333-4333-8333-333333333333',
      serviceId: '44444444-4444-4444-8444-444444444444',
      volumeId: '55555555-5555-4555-8555-555555555555',
      volumeName: 'skytech-production-data',
      volumeMountPath: '/data',
    },
    deploymentIdentity: {
      serviceInstanceId: '66666666-6666-4666-8666-666666666666',
      deploymentInstanceId: '77777777-7777-4777-8777-777777777777',
    },
    sourceFileSetHash: sqliteFileSetFingerprint(files),
    sourceObservedFileSetHash: sqliteObservedFileSetFingerprint(files),
    databaseContentFingerprint: databaseFingerprint,
    schemaFingerprint,
  };
  source.sourceSnapshotHash = calculateSourceSnapshotHash({
    captureDeployedSha: source.captureDeployedSha,
    captureDeploymentId: source.captureDeploymentId,
    railwayIdentity: source.railwayIdentity,
    deploymentIdentity: source.deploymentIdentity,
    sourceFileSet: sourceFileRows(files),
    collectionFingerprints,
  });

  const evidence = {
    artifactIndexSha256: '2'.repeat(64),
    ...authorityCommitments(),
    packFingerprint: '3'.repeat(64),
    sourceBindingsFingerprint,
    platformDefaultTenantOverlaySemantics: structuredClone(
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    ),
    reviewedPlanFileSha256: '4'.repeat(64),
    approvedReconciliationFingerprint: '5'.repeat(64),
  };
  const manifest = {
    manifestVersion: 2,
    status: 'READY_FOR_DISPOSABLE_SIMULATION',
    productionExecutionAuthorized: false,
    platformDefaultTenantOverlaySemantics: structuredClone(
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    ),
    source,
    canonicalScope: { companyId: COMPANY_ID, tenantId: COMPANY_ID },
    registry: { entryCount: 0, globalReferenceCollectionCount: 0 },
    evidence: {
      artifactIndexSha256: evidence.artifactIndexSha256,
      ...authorityCommitments(),
      packFingerprint: evidence.packFingerprint,
      approvedReconciliationFingerprint: evidence.approvedReconciliationFingerprint,
      sourceBindingsFingerprint,
      platformDefaultTenantOverlaySemantics: structuredClone(
        PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
      ),
    },
    identity: { reviewedPlanFileSha256: evidence.reviewedPlanFileSha256 },
    summary: {
      classifiedRecordCount: 0,
      operationCounts: {},
      collectionWriteCounts: {},
      semanticScopeWriteCount: 0,
      unresolvedRecordCount: 0,
    },
    records: [],
    blockers: [],
  };
  manifest.manifestSha256 = manifestHash(manifest);

  const plan = {
    executionScope: 'IDENTITY_ONLY',
    planVersion: 1,
    manifestVersion: 2,
    sourceBindingsFingerprint,
    platformDefaultTenantOverlaySemantics: structuredClone(
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    ),
    planId: 'skytech-owner-approved-identity-bootstrap-v1',
    sourceDbPath: '/data/app.sqlite',
    expected: {
      dbIdentity,
      identityCounts: identityCounts(),
      collectionCounts: { users: users.length },
      collectionFingerprints: { users: [collectionFingerprint(users)] },
    },
    authority: {
      status: 'APPROVED',
      companyId: COMPANY_ID,
      tenantId: COMPANY_ID,
      identityBootstrap: config,
    },
    actorMappings: [
      {
        userId: OWNER_PRINCIPAL_ID,
        action: 'CREATE_MEMBERSHIP',
        membershipId: OWNER_MEMBERSHIP_ID,
        companyId: COMPANY_ID,
        tenantId: COMPANY_ID,
      },
      ...AUTHORITY.intentionallyUnmappedUserIds.map(userId => ({
        userId,
        action: 'NO_MEMBERSHIP',
        candidateForProductionMembership: false,
      })),
    ],
    recordMappings: [],
    relationMappings: [],
    backup: {
      verified: false,
      reference: null,
      sourceDbIdentity: null,
      timestamp: null,
      sizeBytes: null,
      sha256: null,
    },
  };
  const reviewBundle = buildProductionScopeExecutionBundle({ plan, manifest });
  const reviewBundlePath = path.join(directory, 'review-bundle.json');
  const reviewBytes = Buffer.from(`${JSON.stringify(reviewBundle, null, 2)}\n`);
  writeFileSync(reviewBundlePath, reviewBytes, { mode: 0o600 });
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return {
    directory,
    dbPath,
    reviewBundle,
    reviewBundlePath,
    reviewBundleSha256: sha256(reviewBytes),
  };
}

function runProducer(fixture, label, overrides = {}) {
  const output = path.join(fixture.directory, `${label}.json`);
  const outputSha256 = `${output}.sha256`;
  const args = [
    SCRIPT,
    '--db', overrides.db || fixture.dbPath,
    '--review-bundle', fixture.reviewBundlePath,
    '--review-bundle-sha256', overrides.reviewBundleSha256 || fixture.reviewBundleSha256,
    '--authorized-execution-sha', overrides.authorizedExecutionSha || EXECUTION_SHA,
    '--output', output,
    '--output-sha256', outputSha256,
  ];
  return {
    output,
    outputSha256,
    process: spawnSync(process.execPath, args, {
      cwd: path.resolve('.'),
      encoding: 'utf8',
      env: overrides.env || process.env,
    }),
  };
}

test('fresh identity simulation producer emits two byte-identical self-validating proofs', t => {
  const fixture = buildReviewBundleFixture(t);
  const sourceBefore = ['', '-wal', '-shm'].map(suffix => readFileSync(`${fixture.dbPath}${suffix}`));
  const first = runProducer(fixture, 'simulation-one');
  const second = runProducer(fixture, 'simulation-two');

  assert.equal(first.process.status, 0, first.process.stderr);
  assert.equal(second.process.status, 0, second.process.stderr);
  const firstBytes = readFileSync(first.output);
  const secondBytes = readFileSync(second.output);
  assert.deepEqual(secondBytes, firstBytes);
  const digest = sha256(firstBytes);
  assert.equal(readFileSync(first.outputSha256, 'utf8'), `${digest}\n`);
  assert.equal(readFileSync(second.outputSha256, 'utf8'), `${digest}\n`);
  assert.equal(statSync(first.output).mode & 0o777, 0o600);
  assert.equal(statSync(first.outputSha256).mode & 0o777, 0o600);

  const result = JSON.parse(firstBytes);
  validateIdentitySimulation(result, fixture.reviewBundle);
  assert.equal(result.classification, 'FRESH_PINNED_READ_ONLY_IDENTITY_SIMULATION');
  assert.equal(result.authorizedExecutionSha, EXECUTION_SHA);
  assert.equal(result.readOnlyProof.sourceDatabaseOpenedBySqlite, false);
  assert.equal(result.readOnlyProof.ephemeralMirrorRemoved, true);
  assert.equal(result.identity.membershipCount, EXPECTED_EXACT_CHANGES.memberships);
  assert.deepEqual(
    ['', '-wal', '-shm'].map(suffix => readFileSync(`${fixture.dbPath}${suffix}`)),
    sourceBefore,
  );
  assert.equal(existsSync(`${fixture.dbPath}-wal`), true);
  assert.equal(existsSync(`${fixture.dbPath}-shm`), true);
});

test('fresh identity simulation producer fails closed on every independent binding drift', t => {
  const fixture = buildReviewBundleFixture(t);
  const cases = [
    ['review-hash', { reviewBundleSha256: '0'.repeat(64) }, 'IDENTITY_SIMULATION_REVIEW_BUNDLE_HASH_MISMATCH'],
    ['execution-sha', { authorizedExecutionSha: '2'.repeat(40) }, 'AUTHORIZED_EXECUTION_SHA_MISMATCH'],
  ];
  for (const [label, overrides, code] of cases) {
    const attempt = runProducer(fixture, label, overrides);
    assert.notEqual(attempt.process.status, 0, label);
    assert.equal(JSON.parse(attempt.process.stderr).code, code, attempt.process.stderr);
    assert.equal(existsSync(attempt.output), false);
    assert.equal(existsSync(attempt.outputSha256), false);
  }

  const alteredDb = path.join(fixture.directory, 'altered.sqlite');
  writeFileSync(alteredDb, readFileSync(fixture.dbPath), { mode: 0o600 });
  const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
  const Database = serverRequire('better-sqlite3');
  const altered = new Database(alteredDb);
  altered.prepare("UPDATE app_data SET json = ? WHERE name = 'users'").run('[]');
  altered.close();
  const changed = runProducer(fixture, 'changed-source', { db: alteredDb });
  assert.notEqual(changed.process.status, 0);
  assert.equal(JSON.parse(changed.process.stderr).code, 'FRESH_SOURCE_BINDING_MISMATCH');
  assert.equal(existsSync(changed.output), false);
  assert.equal(existsSync(changed.outputSha256), false);
});

test('fresh identity simulation producer never follows a source symlink or overwrites evidence', t => {
  const fixture = buildReviewBundleFixture(t);
  const linkedDb = path.join(fixture.directory, 'linked.sqlite');
  symlinkSync(fixture.dbPath, linkedDb);
  const linked = runProducer(fixture, 'linked-source', { db: linkedDb });
  assert.notEqual(linked.process.status, 0);
  assert.equal(JSON.parse(linked.process.stderr).code, 'SOURCE_SQLITE_FILE_INVALID');
  assert.equal(existsSync(linked.output), false);

  const output = path.join(fixture.directory, 'already-there.json');
  writeFileSync(output, 'preserve-me', { mode: 0o600 });
  const attempt = runProducer(fixture, 'already-there');
  assert.notEqual(attempt.process.status, 0);
  assert.equal(JSON.parse(attempt.process.stderr).code, 'OUTPUT_ALREADY_EXISTS');
  assert.equal(readFileSync(output, 'utf8'), 'preserve-me');
  assert.equal(existsSync(`${output}.sha256`), false);

  const productionPath = runProducer(fixture, 'production-path', { db: '/data/app.sqlite' });
  assert.notEqual(productionPath.process.status, 0);
  assert.equal(
    JSON.parse(productionPath.process.stderr).code,
    'OFFLINE_FROZEN_CAPTURE_REQUIRED',
  );
  assert.equal(existsSync(productionPath.output), false);
});

test('fresh identity simulation canonicalizes parent aliases before enforcing every path boundary', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fresh-identity-path-boundary-test-'));
  const captureDirectory = path.join(directory, 'capture');
  const outputDirectory = path.join(directory, 'output');
  mkdirSync(captureDirectory);
  mkdirSync(outputDirectory);
  const dbPath = path.join(captureDirectory, 'app.sqlite');
  const reviewBundlePath = path.join(captureDirectory, 'review-bundle.json');
  writeFileSync(dbPath, 'frozen-db', { mode: 0o600 });
  writeFileSync(reviewBundlePath, '{}\n', { mode: 0o600 });

  const captureAlias = path.join(directory, 'capture-alias');
  const outputAliasOne = path.join(directory, 'output-alias-one');
  const outputAliasTwo = path.join(directory, 'output-alias-two');
  symlinkSync(captureDirectory, captureAlias, 'dir');
  symlinkSync(outputDirectory, outputAliasOne, 'dir');
  symlinkSync(outputDirectory, outputAliasTwo, 'dir');
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const safe = assertOutputPaths({
    dbPath: path.join(captureAlias, 'app.sqlite'),
    reviewBundlePath: path.join(captureAlias, 'review-bundle.json'),
    outputPath: path.join(outputAliasOne, 'simulation.json'),
    outputSha256Path: path.join(outputAliasTwo, 'simulation.json.sha256'),
  });
  assert.equal(safe.db, realpathSync(dbPath));
  assert.equal(safe.reviewBundle, realpathSync(reviewBundlePath));
  assert.equal(safe.output, path.join(realpathSync(outputDirectory), 'simulation.json'));
  assert.equal(
    safe.outputSha256,
    path.join(realpathSync(outputDirectory), 'simulation.json.sha256'),
  );

  for (const inputName of [
    'app.sqlite',
    'app.sqlite-wal',
    'app.sqlite-shm',
    'review-bundle.json',
    'APP.SQLITE-WAL',
    'REVIEW-BUNDLE.JSON',
  ]) {
    assert.throws(
      () => assertOutputPaths({
        dbPath,
        reviewBundlePath,
        outputPath: path.join(captureAlias, inputName),
        outputSha256Path: path.join(outputAliasOne, `safe-${inputName}.sha256`),
      }),
      error => error?.code === 'OUTPUT_PATH_INVALID',
      inputName,
    );
  }
  assert.throws(
    () => assertOutputPaths({
      dbPath,
      reviewBundlePath,
      outputPath: path.join(outputAliasOne, 'same-path'),
      outputSha256Path: path.join(outputAliasTwo, 'same-path'),
    }),
    error => error?.code === 'OUTPUT_PATH_INVALID',
  );

  const repositoryDataAlias = path.join(directory, 'repository-data-alias');
  symlinkSync(path.resolve('server/data'), repositoryDataAlias, 'dir');
  for (const liveSourceName of ['app.sqlite', 'APP.SQLITE']) {
    assert.throws(
      () => assertOutputPaths({
        dbPath: path.join(repositoryDataAlias, liveSourceName),
        reviewBundlePath,
        outputPath: path.join(outputAliasOne, `safe-${liveSourceName}.json`),
        outputSha256Path: path.join(outputAliasOne, `safe-${liveSourceName}.json.sha256`),
      }),
      error => error?.code === 'OFFLINE_FROZEN_CAPTURE_REQUIRED',
      liveSourceName,
    );
  }
  for (const liveName of [
    'app.sqlite',
    'app.sqlite-wal',
    'app.sqlite-shm',
    'app.sqlite-journal',
    'APP.SQLITE',
    'APP.SQLITE-WAL',
    'APP.SQLITE-SHM',
    'APP.SQLITE-JOURNAL',
  ]) {
    assert.throws(
      () => assertOutputPaths({
        dbPath,
        reviewBundlePath,
        outputPath: path.join(repositoryDataAlias, liveName),
        outputSha256Path: path.join(outputAliasOne, `safe-${liveName}.sha256`),
      }),
      error => error?.code === 'OUTPUT_PATH_INVALID',
      liveName,
    );
  }
  assert.throws(
    () => assertOutputPaths({
      dbPath,
      reviewBundlePath,
      outputPath: '/data/fresh-simulation.json',
      outputSha256Path: path.join(outputAliasOne, 'safe-production.sha256'),
    }),
    error => error?.code === 'OUTPUT_PATH_INVALID',
  );
  assert.throws(
    () => assertOutputPaths({
      dbPath,
      reviewBundlePath,
      outputPath: '/DATA/fresh-simulation.json',
      outputSha256Path: path.join(outputAliasOne, 'safe-uppercase-production.sha256'),
    }),
    error => error?.code === 'OUTPUT_PATH_INVALID',
  );
});

test('fresh identity simulation rejects production or live-data ephemeral roots before mkdtemp', t => {
  const fixture = buildReviewBundleFixture(t);
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fresh-identity-temp-root-test-'));
  const repositoryDataAlias = path.join(directory, 'repository-data-alias');
  symlinkSync(path.resolve('server/data'), repositoryDataAlias, 'dir');
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  assert.throws(
    () => resolveSafeEphemeralRoot(repositoryDataAlias),
    error => error?.code === 'EPHEMERAL_MIRROR_ROOT_FORBIDDEN',
  );

  const result = runProducer(fixture, 'forbidden-temp-root', {
    env: { ...process.env, TMPDIR: repositoryDataAlias },
  });
  assert.notEqual(result.process.status, 0);
  assert.equal(
    JSON.parse(result.process.stderr).code,
    'EPHEMERAL_MIRROR_ROOT_FORBIDDEN',
  );
  assert.equal(existsSync(result.output), false);
  assert.equal(existsSync(result.outputSha256), false);
});

test('fresh identity simulation refuses replaced output-parent inodes before exclusive writes', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fresh-identity-parent-race-test-'));
  const sourceDirectory = path.join(directory, 'source');
  mkdirSync(sourceDirectory);
  const dbPath = path.join(sourceDirectory, 'app.sqlite');
  const reviewBundlePath = path.join(sourceDirectory, 'review-bundle.json');
  writeFileSync(dbPath, 'frozen-db', { mode: 0o600 });
  writeFileSync(reviewBundlePath, '{}\n', { mode: 0o600 });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  for (const replacement of ['directory', 'symlink']) {
    const outputDirectory = path.join(directory, `output-${replacement}`);
    const movedDirectory = path.join(directory, `moved-${replacement}`);
    const redirectDirectory = path.join(directory, `redirect-${replacement}`);
    mkdirSync(outputDirectory);
    mkdirSync(redirectDirectory);
    const paths = assertOutputPaths({
      dbPath,
      reviewBundlePath,
      outputPath: path.join(outputDirectory, 'simulation.json'),
      outputSha256Path: path.join(outputDirectory, 'simulation.json.sha256'),
    });
    renameSync(outputDirectory, movedDirectory);
    if (replacement === 'directory') mkdirSync(outputDirectory);
    else symlinkSync(redirectDirectory, outputDirectory, 'dir');

    const bytes = Buffer.from('{"stable":true}\n', 'utf8');
    const digest = sha256(bytes);
    assert.throws(
      () => writeExclusiveEvidence(
        paths.output,
        paths.outputSha256,
        bytes,
        digest,
        paths.outputParents,
      ),
      error => error?.code === 'OUTPUT_PARENT_CHANGED',
    );
    assert.equal(existsSync(path.join(movedDirectory, 'simulation.json')), false);
    assert.equal(existsSync(path.join(redirectDirectory, 'simulation.json')), false);
    assert.equal(existsSync(path.join(outputDirectory, 'simulation.json')), false);
  }
});

test('fresh identity simulation never reopens a replaced source parent for mirror copy', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fresh-identity-source-race-test-'));
  const captureDirectory = path.join(directory, 'capture');
  const movedCaptureDirectory = path.join(directory, 'moved-capture');
  const replacementDirectory = path.join(directory, 'replacement');
  mkdirSync(captureDirectory);
  mkdirSync(replacementDirectory);
  const sourcePath = path.join(captureDirectory, 'app.sqlite');
  writeFileSync(sourcePath, 'frozen-capture', { mode: 0o600 });
  writeFileSync(path.join(replacementDirectory, 'app.sqlite'), 'replacement', { mode: 0o600 });
  const sourceFd = mutableFs.openSync(sourcePath, mutableFs.constants.O_RDONLY);
  const source = {
    canonicalName: 'app.sqlite',
    fd: sourceFd,
    resolved: realpathSync(sourcePath),
    stat: fileStatIdentity(mutableFs.fstatSync(sourceFd)),
  };
  renameSync(captureDirectory, movedCaptureDirectory);
  symlinkSync(replacementDirectory, captureDirectory, 'dir');
  t.after(() => {
    try { mutableFs.closeSync(sourceFd); } catch {}
    rmSync(directory, { recursive: true, force: true });
  });

  const destination = path.join(directory, 'mirror.sqlite');
  assert.throws(
    () => copyInspectedSourceFile(source, destination),
    error => error?.code === 'SOURCE_SQLITE_FILE_CHANGED',
  );
  assert.equal(existsSync(destination), false);
});

test('fresh identity simulation revalidates parent identity immediately after exclusive writes', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fresh-identity-post-write-race-test-'));
  const sourceDirectory = path.join(directory, 'source');
  const outputDirectory = path.join(directory, 'output');
  const movedDirectory = path.join(directory, 'moved-output');
  const redirectDirectory = path.join(directory, 'redirect');
  mkdirSync(sourceDirectory);
  mkdirSync(outputDirectory);
  mkdirSync(redirectDirectory);
  const dbPath = path.join(sourceDirectory, 'app.sqlite');
  const reviewBundlePath = path.join(sourceDirectory, 'review-bundle.json');
  writeFileSync(dbPath, 'frozen-db', { mode: 0o600 });
  writeFileSync(reviewBundlePath, '{}\n', { mode: 0o600 });
  const paths = assertOutputPaths({
    dbPath,
    reviewBundlePath,
    outputPath: path.join(outputDirectory, 'simulation.json'),
    outputSha256Path: path.join(outputDirectory, 'simulation.json.sha256'),
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const originalFsyncSync = mutableFs.fsyncSync;
  let fsyncCount = 0;
  mutableFs.fsyncSync = function fsyncAndReplaceParent(fd) {
    const result = originalFsyncSync.call(this, fd);
    fsyncCount += 1;
    if (fsyncCount === 2) {
      renameSync(outputDirectory, movedDirectory);
      symlinkSync(redirectDirectory, outputDirectory, 'dir');
    }
    return result;
  };
  const bytes = Buffer.from('{"stable":true}\n', 'utf8');
  try {
    assert.throws(
      () => writeExclusiveEvidence(
        paths.output,
        paths.outputSha256,
        bytes,
        sha256(bytes),
        paths.outputParents,
      ),
      error => error?.code === 'OUTPUT_PARENT_CHANGED',
    );
  } finally {
    mutableFs.fsyncSync = originalFsyncSync;
  }
  assert.equal(existsSync(path.join(redirectDirectory, 'simulation.json')), false);
  assert.equal(existsSync(path.join(movedDirectory, 'simulation.json')), true);
  assert.equal(existsSync(path.join(movedDirectory, 'simulation.json.sha256')), true);
});

test('fresh identity simulation rechecks output stat after descriptor-bound verification', t => {
  const directory = mkdtempSync(path.join(os.tmpdir(), 'fresh-identity-output-stat-test-'));
  const dbPath = path.join(directory, 'app.sqlite');
  const reviewBundlePath = path.join(directory, 'review-bundle.json');
  writeFileSync(dbPath, 'frozen-db', { mode: 0o600 });
  writeFileSync(reviewBundlePath, '{}\n', { mode: 0o600 });
  const paths = assertOutputPaths({
    dbPath,
    reviewBundlePath,
    outputPath: path.join(directory, 'simulation.json'),
    outputSha256Path: path.join(directory, 'simulation.json.sha256'),
  });
  t.after(() => rmSync(directory, { recursive: true, force: true }));

  const bytes = Buffer.from('{"stable":true}\n', 'utf8');
  const originalReadSync = mutableFs.readSync;
  let changed = false;
  mutableFs.readSync = function readAndChangeMode(...args) {
    const bytesRead = originalReadSync.apply(this, args);
    if (!changed && bytesRead > 0) {
      changed = true;
      mutableFs.chmodSync(paths.output, 0o640);
    }
    return bytesRead;
  };
  try {
    assert.throws(
      () => writeExclusiveEvidence(
        paths.output,
        paths.outputSha256,
        bytes,
        sha256(bytes),
        paths.outputParents,
      ),
      error => error?.code === 'OUTPUT_VERIFICATION_FAILED',
    );
  } finally {
    mutableFs.readSync = originalReadSync;
  }
  assert.equal(changed, true);
  assert.equal(existsSync(paths.output), false);
  assert.equal(existsSync(paths.outputSha256), false);
});

test('fresh identity simulation CLI rejects any apply-shaped or incomplete interface', () => {
  const apply = spawnSync(process.execPath, [SCRIPT, '--apply', 'yes'], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.notEqual(apply.status, 0);
  assert.equal(JSON.parse(apply.stderr).code, 'ARGUMENT_INVALID');

  const incomplete = spawnSync(process.execPath, [SCRIPT, '--db', '/tmp/not-opened.sqlite'], {
    cwd: path.resolve('.'),
    encoding: 'utf8',
  });
  assert.notEqual(incomplete.status, 0);
  assert.equal(JSON.parse(incomplete.stderr).code, 'ARGUMENT_REQUIRED');
});
