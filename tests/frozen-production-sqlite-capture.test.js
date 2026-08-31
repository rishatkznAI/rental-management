import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  REMOTE_DATABASE_PATHS,
  RUNTIME_CONSERVATION_EXPECTED,
  acquireFrozenProductionSqliteCapture,
  normalizeRailwayStatus,
  railwaySshArguments,
  validateOutputRoot,
} = require('../server/lib/frozen-production-sqlite-capture.js');
const {
  REQUIRED_SOURCE_BINDING_PATHS,
  REPOSITORY_ROOT,
  validateControl,
} = require('../server/lib/production-scope-evidence-builder.js');
const productionBaselineContract = require('../server/config/production-scope-baseline-authority.json');
const {
  validateBaselineContract,
} = require('../server/lib/production-scope-baseline-contract.js');
const {
  classificationAuthoritySnapshot,
} = require('../server/lib/production-scope-evidence-classification.js');
const {
  stableJson,
} = require('../server/lib/production-scope-remediation.js');
const reviewedEnvironment = require('../server/config/production-scope-remediation-environment.js');

const SERVICE_INSTANCE_ID = '11111111-1111-4111-8111-111111111111';
const DEPLOYMENT_ID = '22222222-2222-4222-8222-222222222222';
const DEPLOYMENT_INSTANCE_ID = '33333333-3333-4333-8333-333333333333';
const CAPTURE_IDS = [
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
];

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function gitHead() {
  return execFileSync('git', ['rev-parse', 'HEAD^{commit}'], {
    cwd: REPOSITORY_ROOT,
    encoding: 'utf8',
  }).trim();
}

function currentSourceBindings() {
  return REQUIRED_SOURCE_BINDING_PATHS.map(relativePath => {
    const bytes = fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath));
    return { relativePath, size: bytes.length, sha256: sha256(bytes) };
  });
}

function railwayStatus(headSha = gitHead(), overrides = {}) {
  const instance = {
    id: DEPLOYMENT_INSTANCE_ID,
    status: 'RUNNING',
    ...(overrides.instance || {}),
  };
  const deployment = {
    id: DEPLOYMENT_ID,
    status: 'SUCCESS',
    meta: { commitHash: headSha },
    instances: [instance],
    ...(overrides.deployment || {}),
  };
  const service = {
    id: SERVICE_INSTANCE_ID,
    serviceId: reviewedEnvironment.serviceId,
    latestDeployment: deployment,
    ...(overrides.service || {}),
  };
  const environment = {
    id: reviewedEnvironment.environmentId,
    serviceInstances: { edges: [{ node: service }] },
    volumeInstances: {
      edges: [{
        node: {
          serviceId: reviewedEnvironment.serviceId,
          volume: { id: reviewedEnvironment.volumeId, name: reviewedEnvironment.volumeName },
          mountPath: reviewedEnvironment.volumeMountPath,
          state: 'READY',
        },
      }],
    },
  };
  return {
    id: reviewedEnvironment.projectId,
    environments: { edges: [{ node: environment }] },
    ...(overrides.root || {}),
  };
}

function runtimeSnapshot(headSha = gitHead(), overrides = {}) {
  return {
    identity: {
      projectId: reviewedEnvironment.projectId,
      environmentId: reviewedEnvironment.environmentId,
      serviceId: reviewedEnvironment.serviceId,
      deploymentId: DEPLOYMENT_ID,
      replicaId: DEPLOYMENT_INSTANCE_ID,
      deployedSha: headSha,
      ...(overrides.identity || {}),
    },
    storage: {
      volumeName: reviewedEnvironment.volumeName,
      volumeMountPath: reviewedEnvironment.volumeMountPath,
      databasePath: reviewedEnvironment.sourceDbPath,
      ...(overrides.storage || {}),
    },
    conservation: {
      ...RUNTIME_CONSERVATION_EXPECTED,
      ...(overrides.conservation || {}),
    },
  };
}

function fileMetadata(files) {
  return REMOTE_DATABASE_PATHS.map(({ name }) => ({
    name,
    size: files[name].length,
    sha256: sha256(files[name]),
  }));
}

function baseFiles() {
  return {
    'app.sqlite': Buffer.from('sqlite database bytes\0\x01\x02'),
    'app.sqlite-wal': Buffer.from('wal bytes\0\x03\x04'),
    'app.sqlite-shm': Buffer.from('shm round A bytes'),
  };
}

function fixtureDependencies(options = {}) {
  const headSha = options.headSha || gitHead();
  const filesA = options.filesA || baseFiles();
  const filesB = options.filesB || { ...baseFiles(), 'app.sqlite-shm': Buffer.from('shm round B bytes') };
  const statuses = options.statuses || [railwayStatus(headSha), railwayStatus(headSha), railwayStatus(headSha)];
  const runtimes = options.runtimes || [runtimeSnapshot(headSha), runtimeSnapshot(headSha), runtimeSnapshot(headSha)];
  let statusIndex = 0;
  let runtimeIndex = 0;
  let uuidIndex = 0;
  let nowMs = Date.now() - 10_000;
  const dependencies = {
    initializeCalls: 0,
    streamCalls: [],
    async initialize() { this.initializeCalls += 1; },
    async repositoryHead() {
      return typeof options.repositoryHead === 'function' ? options.repositoryHead() : headSha;
    },
    async sourceBindings() {
      return typeof options.sourceBindings === 'function'
        ? options.sourceBindings()
        : currentSourceBindings();
    },
    async controlPlane() {
      const value = statuses[Math.min(statusIndex, statuses.length - 1)];
      statusIndex += 1;
      return value;
    },
    async runtimeSnapshot() {
      const value = runtimes[Math.min(runtimeIndex, runtimes.length - 1)];
      runtimeIndex += 1;
      return value;
    },
    async remoteMetadata({ phase }) {
      const round = phase.startsWith('roundA') ? 'roundA' : 'roundB';
      const files = round === 'roundA' ? filesA : filesB;
      if (typeof options.remoteMetadata === 'function') {
        return options.remoteMetadata({ phase, round, files, metadata: fileMetadata(files) });
      }
      return fileMetadata(files);
    },
    async streamRemoteFile(context) {
      this.streamCalls.push({
        round: context.round,
        name: context.name,
        remotePath: context.remotePath,
        destinationPath: context.destinationPath,
        deploymentInstanceId: context.railway.deploymentInstanceId,
      });
      if (typeof options.streamRemoteFile === 'function') {
        return options.streamRemoteFile(context, { filesA, filesB });
      }
      const files = context.round === 'roundA' ? filesA : filesB;
      fs.writeSync(context.destinationFd, files[context.name]);
      return { stderrSize: 0, stderrSha256: sha256(Buffer.alloc(0)) };
    },
    now() {
      nowMs += 1000;
      return new Date(nowMs);
    },
    randomUUID() {
      const value = CAPTURE_IDS[uuidIndex];
      uuidIndex += 1;
      return value;
    },
  };
  return { dependencies, headSha, filesA, filesB };
}

async function withOutputFixture(run) {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'frozen-production-capture-test-'));
  fs.chmodSync(parent, 0o700);
  const outputRoot = path.join(parent, 'capture');
  try {
    return await run({ parent, outputRoot });
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
}

test('acquires two exact-instance rounds and emits a builder-compatible private handoff', async () => {
  await withOutputFixture(async ({ outputRoot }) => {
    const fixture = fixtureDependencies();
    const result = await acquireFrozenProductionSqliteCapture({
      expectedCaptureSha: fixture.headSha,
      outputRoot,
    }, fixture.dependencies);

    assert.equal(result.output.verdict, 'FROZEN_PRODUCTION_SQLITE_CAPTURE_COMPLETE');
    assert.equal(result.output.productionWritePerformed, false);
    assert.equal(result.output.rawCaptureOpenedBySQLite, false);
    assert.equal(result.output.durableRoundsByteIdentical, true);
    assert.equal(result.output.shmObservationByteIdentical, false);
    assert.equal(fixture.dependencies.initializeCalls, 1);
    assert.equal(fixture.dependencies.streamCalls.length, 6);
    assert.ok(fixture.dependencies.streamCalls.every(call => (
      call.deploymentInstanceId === DEPLOYMENT_INSTANCE_ID
      && call.remotePath === `${reviewedEnvironment.volumeMountPath}/${call.name}`
    )));

    const control = JSON.parse(fs.readFileSync(result.captureControlPath, 'utf8'));
    assert.deepEqual(validateControl(control, new Date(Date.now() + 60_000)), control);
    assert.equal(control.controlVersion, 2);
    assert.deepEqual(control.baseline, validateBaselineContract(productionBaselineContract));
    assert.equal(control.baseline.productionExecutionAuthorized, false);
    const driftedControl = structuredClone(control);
    driftedControl.baseline.candidateKeySetSha256 = '0'.repeat(64);
    assert.throws(
      () => validateControl(driftedControl, new Date(Date.now() + 60_000)),
      error => error.code === 'BASELINE_AUTHORITY_MISMATCH',
    );
    assert.equal(
      control.classificationAuthorityFingerprint,
      sha256(stableJson(classificationAuthoritySnapshot())),
    );
    const classificationSnapshot = classificationAuthoritySnapshot();
    const classificationSnapshotText = JSON.stringify(classificationSnapshot);
    assert.equal(classificationSnapshotText.includes('cmp_'), false);
    assert.equal(classificationSnapshotText.includes('brn_'), false);
    assert.match(classificationSnapshot.canonicalScopeSha256, /^[a-f0-9]{64}$/);
    assert.match(classificationSnapshot.sensitiveAuthoritySha256, /^[a-f0-9]{64}$/);
    assert.equal(Object.values(classificationSnapshot.sensitiveAuthorityCounts).every(value => (
      Number.isSafeInteger(value) && value >= 0
    )), true);
    assert.equal(classificationSnapshot.canonicalCompanyId, undefined);
    assert.equal(classificationSnapshot.canonicalHeadOfficeId, undefined);
    assert.deepEqual(Object.keys(result.output.builderHandoff).sort(), [
      'analysisRound',
      'controlPath',
      'controlSha256',
      'roundADirectory',
      'roundBDirectory',
    ]);
    assert.equal('baselineManifestPath' in result.output.builderHandoff, false);
    assert.equal('baselineManifestSha256' in result.output.builderHandoff, false);
    assert.deepEqual(control.sourceBindings, currentSourceBindings());
    assert.ok(control.sourceBindings.some(row => row.relativePath === 'server/lib/frozen-production-sqlite-capture.js'));
    assert.ok(control.sourceBindings.some(row => row.relativePath === 'server/scripts/capture-frozen-production-sqlite.js'));
    assert.equal(control.rounds.roundA.captureId, CAPTURE_IDS[0]);
    assert.equal(control.rounds.roundB.captureId, CAPTURE_IDS[1]);
    assert.equal(control.analysisRound, 'roundB');

    const controlBytes = fs.readFileSync(result.captureControlPath);
    const outputBytes = fs.readFileSync(result.captureOutputPath);
    assert.equal(result.captureControlSha256, sha256(controlBytes));
    assert.equal(result.captureOutputSha256, sha256(outputBytes));
    assert.equal(
      fs.readFileSync(`${result.captureControlPath}.sha256`, 'utf8'),
      `${result.captureControlSha256}  capture-control.json\n`,
    );
    assert.equal(
      fs.readFileSync(`${result.captureOutputPath}.sha256`, 'utf8'),
      `${result.captureOutputSha256}  capture-output.json\n`,
    );

    assert.equal(fs.statSync(outputRoot).mode & 0o777, 0o700);
    for (const directory of ['round-a', 'round-b']) {
      assert.equal(fs.statSync(path.join(outputRoot, directory)).mode & 0o777, 0o700);
      for (const name of REMOTE_DATABASE_PATHS.map(row => row.name)) {
        const filePath = path.join(outputRoot, directory, name);
        assert.equal(fs.statSync(filePath).mode & 0o777, 0o600);
        assert.equal(fs.statSync(filePath).nlink, 1);
      }
    }
    for (const name of [
      'capture-control.json', 'capture-control.json.sha256',
      'capture-output.json', 'capture-output.json.sha256',
    ]) {
      assert.equal(fs.statSync(path.join(outputRoot, name)).mode & 0o777, 0o600);
    }
    assert.equal(fs.existsSync(path.join(outputRoot, '.railway-control')), false);
    assert.equal(fs.existsSync(`${outputRoot}.publish.lock`), false);
  });
});

test('detects command-mode binary stdout contamination and removes every partial file', async () => {
  await withOutputFixture(async ({ parent, outputRoot }) => {
    const fixture = fixtureDependencies({
      streamRemoteFile(context, { filesA, filesB }) {
        const files = context.round === 'roundA' ? filesA : filesB;
        fs.writeSync(context.destinationFd, Buffer.concat([Buffer.from('railway banner\n'), files[context.name]]));
      },
    });
    await assert.rejects(
      acquireFrozenProductionSqliteCapture({ expectedCaptureSha: fixture.headSha, outputRoot }, fixture.dependencies),
      error => error.code === 'BINARY_TRANSPORT_MISMATCH',
    );
    assert.equal(fs.existsSync(outputRoot), false);
    assert.deepEqual(fs.readdirSync(parent), []);
  });
});

test('rejects a remote file mutation between pre-state and post-state', async () => {
  await withOutputFixture(async ({ parent, outputRoot }) => {
    const fixture = fixtureDependencies({
      remoteMetadata({ phase, metadata }) {
        if (phase === 'roundA:post') {
          return metadata.map((row, index) => index === 1
            ? { ...row, sha256: 'f'.repeat(64) }
            : row);
        }
        return metadata;
      },
    });
    await assert.rejects(
      acquireFrozenProductionSqliteCapture({ expectedCaptureSha: fixture.headSha, outputRoot }, fixture.dependencies),
      error => error.code === 'REMOTE_FILE_MUTATED',
    );
    assert.equal(fs.existsSync(outputRoot), false);
    assert.deepEqual(fs.readdirSync(parent), []);
  });
});

test('fails closed for stale control-plane deployment, capture SHA, and runtime replica', async t => {
  await t.test('deployment changes between rounds', async () => {
    await withOutputFixture(async ({ outputRoot }) => {
      const headSha = gitHead();
      const changed = railwayStatus(headSha, {
        deployment: { id: '66666666-6666-4666-8666-666666666666' },
      });
      const fixture = fixtureDependencies({
        headSha,
        statuses: [railwayStatus(headSha), changed, changed],
      });
      await assert.rejects(
        acquireFrozenProductionSqliteCapture({ expectedCaptureSha: headSha, outputRoot }, fixture.dependencies),
        error => error.code === 'RUNTIME_IDENTITY_MISMATCH' || error.code === 'CAPTURE_IDENTITY_DRIFT',
      );
      assert.equal(fs.existsSync(outputRoot), false);
    });
  });

  await t.test('deployed SHA differs from exact capture SHA', async () => {
    await withOutputFixture(async ({ outputRoot }) => {
      const fixture = fixtureDependencies({
        statuses: [railwayStatus('a'.repeat(40))],
      });
      await assert.rejects(
        acquireFrozenProductionSqliteCapture({ expectedCaptureSha: fixture.headSha, outputRoot }, fixture.dependencies),
        error => error.code === 'RAILWAY_DEPLOYMENT_NOT_SINGLETON',
      );
      assert.equal(fs.existsSync(outputRoot), false);
    });
  });

  await t.test('runtime replica differs from selected deployment instance', async () => {
    await withOutputFixture(async ({ outputRoot }) => {
      const headSha = gitHead();
      const fixture = fixtureDependencies({
        headSha,
        runtimes: [runtimeSnapshot(headSha, {
          identity: { replicaId: '77777777-7777-4777-8777-777777777777' },
        })],
      });
      await assert.rejects(
        acquireFrozenProductionSqliteCapture({ expectedCaptureSha: headSha, outputRoot }, fixture.dependencies),
        error => error.code === 'RUNTIME_IDENTITY_MISMATCH',
      );
      assert.equal(fs.existsSync(outputRoot), false);
    });
  });
});

test('proves singleton deployment metadata instead of counting only running instances', () => {
  const headSha = gitHead();
  const status = railwayStatus(headSha);
  const deployment = status.environments.edges[0].node.serviceInstances.edges[0].node.latestDeployment;
  deployment.instances.push({
    id: '88888888-8888-4888-8888-888888888888',
    status: 'REMOVED',
  });
  assert.throws(
    () => normalizeRailwayStatus(status, headSha),
    error => error.code === 'RAILWAY_DEPLOYMENT_NOT_SINGLETON',
  );
});

test('partial streaming failure leaves neither requested output, staging, nor publication lock', async () => {
  await withOutputFixture(async ({ parent, outputRoot }) => {
    let calls = 0;
    const fixture = fixtureDependencies({
      streamRemoteFile(context, { filesA, filesB }) {
        calls += 1;
        const files = context.round === 'roundA' ? filesA : filesB;
        fs.writeSync(context.destinationFd, files[context.name]);
        if (calls === 2) {
          const error = new Error('injected stream failure');
          error.code = 'INJECTED_STREAM_FAILURE';
          throw error;
        }
      },
    });
    await assert.rejects(
      acquireFrozenProductionSqliteCapture({ expectedCaptureSha: fixture.headSha, outputRoot }, fixture.dependencies),
      error => error.code === 'INJECTED_STREAM_FAILURE',
    );
    assert.equal(fs.existsSync(outputRoot), false);
    assert.deepEqual(fs.readdirSync(parent), []);
  });
});

test('rejects unsafe output targets and detects hard-linking of a capture member', async t => {
  await t.test('repository and /data targets are forbidden before any acquisition', () => {
    assert.throws(
      () => validateOutputRoot(path.join(REPOSITORY_ROOT, 'capture-private')),
      error => error.code === 'OUTPUT_ROOT_FORBIDDEN',
    );
    assert.throws(
      () => validateOutputRoot('/data/capture-private'),
      error => error.code === 'OUTPUT_ROOT_FORBIDDEN',
    );
  });

  await t.test('pre-existing symlink and hardlink output roots are preserved and rejected', async () => {
    await withOutputFixture(async ({ parent, outputRoot }) => {
      const real = path.join(parent, 'real-file');
      fs.writeFileSync(real, 'preserve');
      fs.symlinkSync(real, outputRoot);
      const fixture = fixtureDependencies();
      await assert.rejects(
        acquireFrozenProductionSqliteCapture({ expectedCaptureSha: fixture.headSha, outputRoot }, fixture.dependencies),
        error => error.code === 'OUTPUT_ROOT_EXISTS',
      );
      assert.equal(fs.lstatSync(outputRoot).isSymbolicLink(), true);
      fs.unlinkSync(outputRoot);
      fs.linkSync(real, outputRoot);
      await assert.rejects(
        acquireFrozenProductionSqliteCapture({ expectedCaptureSha: fixture.headSha, outputRoot }, fixture.dependencies),
        error => error.code === 'OUTPUT_ROOT_EXISTS',
      );
      assert.equal(fs.statSync(outputRoot).nlink, 2);
    });
  });

  await t.test('a capture member hardlink introduced during streaming aborts publication', async () => {
    await withOutputFixture(async ({ parent, outputRoot }) => {
      let linked = false;
      const externalLink = path.join(parent, 'unexpected-hardlink');
      const fixture = fixtureDependencies({
        streamRemoteFile(context, { filesA, filesB }) {
          const files = context.round === 'roundA' ? filesA : filesB;
          fs.writeSync(context.destinationFd, files[context.name]);
          if (!linked) {
            fs.linkSync(context.destinationPath, externalLink);
            linked = true;
          }
        },
      });
      await assert.rejects(
        acquireFrozenProductionSqliteCapture({ expectedCaptureSha: fixture.headSha, outputRoot }, fixture.dependencies),
        error => error.code === 'LOCAL_CAPTURE_IDENTITY_INVALID',
      );
      assert.equal(fs.existsSync(outputRoot), false);
      assert.equal(fs.readFileSync(externalLink).equals(fixture.filesA['app.sqlite']), true);
    });
  });
});

test('rejects any false conservation proof before reading remote SQLite files', async () => {
  await withOutputFixture(async ({ outputRoot }) => {
    const headSha = gitHead();
    const fixture = fixtureDependencies({
      headSha,
      runtimes: [runtimeSnapshot(headSha, { conservation: { appDisabled: false } })],
    });
    await assert.rejects(
      acquireFrozenProductionSqliteCapture({ expectedCaptureSha: headSha, outputRoot }, fixture.dependencies),
      error => error.code === 'CAPTURE_CONSERVATION_INVALID',
    );
    assert.equal(fixture.dependencies.streamCalls.length, 0);
    assert.equal(fs.existsSync(outputRoot), false);
  });
});

test('retains distinct SHM but rejects any durable DB or WAL difference between rounds', async () => {
  await withOutputFixture(async ({ outputRoot }) => {
    const filesA = baseFiles();
    const filesB = { ...baseFiles(), 'app.sqlite-wal': Buffer.from('changed WAL') };
    const fixture = fixtureDependencies({ filesA, filesB });
    await assert.rejects(
      acquireFrozenProductionSqliteCapture({ expectedCaptureSha: fixture.headSha, outputRoot }, fixture.dependencies),
      error => error.code === 'CAPTURE_DURABLE_ROUNDS_MISMATCH',
    );
    assert.equal(fs.existsSync(outputRoot), false);
  });
});

test('rejects repository SHA and source drift across the acquisition window', async t => {
  await t.test('HEAD mismatch is rejected before Railway initialization', async () => {
    await withOutputFixture(async ({ outputRoot }) => {
      const fixture = fixtureDependencies();
      await assert.rejects(
        acquireFrozenProductionSqliteCapture({ expectedCaptureSha: 'a'.repeat(40), outputRoot }, fixture.dependencies),
        error => error.code === 'REPOSITORY_HEAD_MISMATCH',
      );
      assert.equal(fixture.dependencies.initializeCalls, 0);
    });
  });

  await t.test('source binding drift after round B is rejected', async () => {
    await withOutputFixture(async ({ outputRoot }) => {
      let calls = 0;
      const baseline = currentSourceBindings();
      const fixture = fixtureDependencies({
        sourceBindings() {
          calls += 1;
          if (calls === 1) return baseline;
          return baseline.map((row, index) => index === 0 ? { ...row, sha256: 'e'.repeat(64) } : row);
        },
      });
      await assert.rejects(
        acquireFrozenProductionSqliteCapture({ expectedCaptureSha: fixture.headSha, outputRoot }, fixture.dependencies),
        error => error.code === 'REPOSITORY_STATE_DRIFT',
      );
      assert.equal(fs.existsSync(outputRoot), false);
    });
  });
});

test('Railway SSH arguments always select the immutable target and exact deployment instance', () => {
  const args = railwaySshArguments(DEPLOYMENT_INSTANCE_ID, ['node', '-e', 'process.exit(0)']);
  assert.deepEqual(args.slice(0, 12), [
    'ssh',
    '--project', reviewedEnvironment.projectId,
    '--environment', reviewedEnvironment.environmentId,
    '--service', reviewedEnvironment.serviceId,
    '--deployment-instance', DEPLOYMENT_INSTANCE_ID,
    '--', 'node', '-e',
  ]);
  assert.equal(args.at(-1), 'process.exit(0)');
});
