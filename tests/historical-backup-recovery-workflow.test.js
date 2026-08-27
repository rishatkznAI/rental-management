import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs, { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  HISTORICAL_RECOVERY_RAILWAY_IDENTITY,
  createRecoveryConfigurationConservationProof,
  validateRailwayStatus,
} from '../scripts/historical-backup-recovery-railway-proof.mjs';
import {
  createPrivateValidationSnapshot,
  validateCapturedFileState,
  validateCapturedSourceBinding,
  validateCapturedSourceIdentity,
  validateManifest,
} from '../scripts/validate-historical-pre-compatibility-backup.mjs';

const workflow = readFileSync(
  new URL('../.github/workflows/skytech-historical-backup-recovery.yml', import.meta.url),
  'utf8',
);
const railwayProof = readFileSync(
  new URL('../scripts/historical-backup-recovery-railway-proof.mjs', import.meta.url),
  'utf8',
);
const apiProof = readFileSync(
  new URL('../scripts/historical-backup-recovery-api-proof.mjs', import.meta.url),
  'utf8',
);
const backupValidator = readFileSync(
  new URL('../scripts/validate-historical-pre-compatibility-backup.mjs', import.meta.url),
  'utf8',
);

const SOURCE_COMMIT = '5f01ec09bbff89066ca7f856a2f7167d27623e7a';
const SOURCE_DEPLOYMENT = '3e619e81-d972-44f1-a8d8-86918a00e1ca';
const SOURCE_REPLICA = '3438d4e6-bcaa-4b59-8e4b-15d00f26548d';
const REQUEST_NONCE = '108970e3-9adf-4369-ba48-dff4fcfb1d20';

test('historical recovery workflow is syntactically valid YAML', () => {
  const workflowPath = fileURLToPath(
    new URL('../.github/workflows/skytech-historical-backup-recovery.yml', import.meta.url),
  );
  execFileSync('ruby', [
    '-e',
    [
      "require 'yaml'",
      "require 'open3'",
      "parsed = YAML.load(File.read(ARGV.fetch(0)))",
      "abort('workflow YAML is not a mapping') unless parsed.is_a?(Hash)",
      "parsed.fetch('jobs').each_value do |job|",
      "  job.fetch('steps').each do |step|",
      "    next unless step['run']",
      "    _stdout, stderr, status = Open3.capture3('bash', '-n', stdin_data: step['run'])",
      "    abort(\"workflow run block is invalid: #{stderr}\") unless status.success?",
      '  end',
      'end',
    ].join('; '),
    workflowPath,
  ], { stdio: 'pipe' });
});

test('historical recovery is a manual production-environment operation serialized with releases', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (push|pull_request|schedule):/m);
  assert.match(workflow, /expected_main_sha:/);
  assert.match(workflow, /expected_backend_sha:/);
  assert.match(workflow, /test "\$GITHUB_SHA" = "\$EXPECTED_MAIN_SHA"/);
  assert.match(workflow, /test "\$GITHUB_WORKFLOW_SHA" = "\$GITHUB_SHA"/);
  assert.match(workflow, /refs\/heads\/main/);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /test "\$RUNNER_ENVIRONMENT" = "github-hosted"/);
  assert.match(workflow, /group: production-release/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /permissions:\n  actions: read\n  contents: read/);
});

test('workflow and validator bind the one exact historical receipt and archive', () => {
  for (const exactValue of [
    SOURCE_COMMIT,
    SOURCE_DEPLOYMENT,
    SOURCE_REPLICA,
    REQUEST_NONCE,
    'skytech-pre-clean-reset-20260827T143126Z.zip',
    '11930936',
    'skytech-pre-compatibility-backup-receipt.json',
    '3835',
  ]) {
    assert.equal(workflow.includes(exactValue), true, `workflow must bind ${exactValue}`);
    assert.equal(backupValidator.includes(exactValue.replace('11930936', '11_930_936').replace('3835', '3_835')), true);
  }
  assert.match(backupValidator, /generatedAt: '2026-08-27T14:31:26\.000Z'/);
  assert.match(backupValidator, /historical receipt is not in its exact canonical byte representation/);
  assert.match(backupValidator, /inspectFullBackupArchive/);
  assert.match(backupValidator, /validateStoredZipEntry/);
  assert.match(backupValidator, /hashStoredZipEntry/);
  assert.match(backupValidator, /databaseLogicalDigest/);
  assert.match(backupValidator, /integrity_check/);
  assert.match(backupValidator, /foreign_key_check/);
  assert.match(backupValidator, /business-file inventory hash mismatch/);
});

test('historical validator accepts the exact mixed string and numeric captured-file schema', () => {
  const captured = {
    exists: true,
    dev: '2049',
    ino: '123456',
    mode: '33188',
    nlink: '1',
    size: 11_930_936,
    mtimeMs: '1787841086000.125',
    ctimeMs: '1787841086001',
    sha256: 'a'.repeat(64),
  };
  assert.doesNotThrow(() => validateCapturedFileState(captured, 'fixture', { required: true }));
  assert.throws(
    () => validateCapturedFileState({ ...captured, size: String(captured.size) }, 'fixture'),
    /fixture\.size is invalid/,
  );
  assert.throws(
    () => validateCapturedFileState({ ...captured, nlink: '2' }, 'fixture'),
    /fixture\.nlink is invalid/,
  );
  assert.doesNotThrow(() => validateCapturedSourceIdentity({ dev: '2049', ino: '123456' }));
  assert.throws(
    () => validateCapturedSourceIdentity({ dev: 2049, ino: '123456' }),
    /source identity\.dev is invalid/,
  );
  assert.throws(
    () => validateCapturedSourceIdentity({ dev: '2049', ino: 123456 }),
    /source identity\.ino is invalid/,
  );
  const source = {
    identity: { dev: '2049', ino: '123456' },
    before: {
      database: structuredClone(captured),
      wal: { exists: false },
      shm: { exists: false },
    },
  };
  source.after = structuredClone(source.before);
  assert.doesNotThrow(() => validateCapturedSourceBinding(source));
  assert.doesNotThrow(() => validateCapturedSourceBinding({
    ...source,
    after: {
      ...source.after,
      shm: { exists: true, coordinationStateMayDiffer: true },
    },
  }));
  assert.throws(
    () => validateCapturedSourceBinding({
      ...source,
      identity: { ...source.identity, ino: '654321' },
    }),
    /database identity is not bound/,
  );
});

test('independent recovery manifest validation rejects unknown roots, entry drift, and provenance drift', () => {
  const runtime = {
    commit: SOURCE_COMMIT.slice(0, 7),
    commitFull: SOURCE_COMMIT,
    releaseType: 'backend',
    release: { type: 'backend' },
    startedAt: '2026-08-27T14:00:00.000Z',
    deployment: {
      railwayDeploymentId: SOURCE_DEPLOYMENT,
      railwayReplicaId: SOURCE_REPLICA,
      railwayEnvironment: 'production',
      railwayService: 'rental-management',
    },
  };
  const manifest = {
    generatedAt: '2026-08-27T14:31:26.000Z',
    backupSize: 11_930_936,
    appName: 'Skytech Rental Management',
    appVersion: runtime,
    database: {
      type: 'sqlite',
      includedAs: 'database/app.sqlite',
      sourcePath: 'app.sqlite',
    },
    counts: {},
    includedFilesCount: 0,
    localFilesCount: 0,
    embeddedPhotosCount: 0,
    skippedFilesCount: 0,
    files: {
      included: [],
      includedCount: 0,
      includedFilesCount: 0,
      localFilesCount: 0,
      embeddedPhotosCount: 0,
      skippedFilesCount: 0,
    },
  };
  const receipt = {
    runtime,
    archive: {
      collectionCounts: {},
      includedFilesCount: 0,
      businessFileCount: 0,
      businessFileInventorySha256: crypto.createHash('sha256')
        .update(JSON.stringify([]))
        .digest('hex'),
    },
  };
  const exactEntries = new Map([
    ['manifest.json', { size: 1 }],
    ['README-backup.txt', { size: 1 }],
    ['database/app.sqlite', { size: 1 }],
  ]);
  assert.deepEqual(
    validateManifest(manifest, receipt, { entries: exactEntries }),
    { businessFileCount: 0 },
  );

  const unknownManifest = structuredClone(manifest);
  unknownManifest.includedFilesCount = 1;
  unknownManifest.files.includedCount = 1;
  unknownManifest.files.includedFilesCount = 1;
  const unknownReceipt = structuredClone(receipt);
  unknownReceipt.archive.includedFilesCount = 1;
  assert.throws(
    () => validateManifest(unknownManifest, unknownReceipt, {
      entries: new Map([...exactEntries, ['files/unknown/payload.bin', { size: 1 }]]),
    }),
    /unknown business-file root/,
  );
  const missingReadme = new Map(exactEntries);
  missingReadme.delete('README-backup.txt');
  assert.throws(
    () => validateManifest(manifest, receipt, { entries: missingReadme }),
    /entry set is not exact/,
  );
  assert.throws(
    () => validateManifest(manifest, receipt, {
      entries: new Map([...exactEntries, ['unexpected.txt', { size: 1 }]]),
    }),
    /entry set is not exact/,
  );
  const divergentProvenance = structuredClone(manifest);
  divergentProvenance.appVersion.deployment.railwayService = 'other-service';
  assert.throws(
    () => validateManifest(divergentProvenance, receipt, { entries: exactEntries }),
    /runtime provenance mismatch/,
  );
});

test('historical validator snapshots one bound private archive identity before path-based inspection', () => {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'historical-validator-snapshot-')));
  fs.chmodSync(root, 0o700);
  const sourcePath = path.join(root, 'downloaded.zip');
  const snapshotPath = path.join(root, 'validation.snapshot.zip');
  const originalBytes = Buffer.from('one exact historical byte sequence');
  const replacementBytes = Buffer.from('a different sequence, same length!');
  assert.equal(replacementBytes.length, originalBytes.length);
  try {
    fs.writeFileSync(sourcePath, originalBytes, { mode: 0o600 });
    fs.chmodSync(sourcePath, 0o600);
    const snapshot = createPrivateValidationSnapshot({
      sourcePath,
      snapshotPath,
      expectedSize: originalBytes.length,
      label: 'test historical archive',
    });
    const replacementPath = path.join(root, 'replacement.zip');
    fs.writeFileSync(replacementPath, replacementBytes, { mode: 0o600 });
    fs.chmodSync(replacementPath, 0o600);
    fs.renameSync(replacementPath, sourcePath);
    assert.deepEqual(fs.readFileSync(snapshot.path), originalBytes);
    assert.deepEqual(fs.readFileSync(sourcePath), replacementBytes);
    assert.equal(
      snapshot.sha256,
      crypto.createHash('sha256').update(originalBytes).digest('hex'),
    );
    assert.match(backupValidator, /inspectFullBackupArchive\(archiveSnapshot\.path\)/);
    assert.match(backupValidator, /sha256File\(archiveSnapshot\.path\) !== archiveSha256/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('recovery conservation fingerprints the full decrypted target config and resolved variables', () => {
  const service = {
    build: { builder: 'DOCKERFILE' },
    deploy: { runtime: 'V2', startCommand: 'node server.js' },
    networking: { serviceDomains: { api: { targetPort: 8080 } } },
    source: { repo: 'rishatkznAI/rental-management', commitSha: SOURCE_COMMIT },
    variables: { PRIVATE_VALUE: { value: 'private-raw-secret' } },
    volumeMounts: {
      [HISTORICAL_RECOVERY_RAILWAY_IDENTITY.volumeId]: { mountPath: '/data' },
    },
  };
  const environmentConfig = {
    services: { [HISTORICAL_RECOVERY_RAILWAY_IDENTITY.serviceId]: service },
  };
  const resolvedVariables = {
    PRIVATE_VALUE: 'private-resolved-secret',
    RAILWAY_GIT_COMMIT_SHA: SOURCE_COMMIT,
  };
  const baseline = createRecoveryConfigurationConservationProof({
    environmentConfig,
    resolvedVariables,
  });
  assert.match(baseline.targetServiceConfigFingerprint, /^[a-f0-9]{64}$/);
  assert.match(baseline.resolvedVariableInventoryFingerprint, /^[a-f0-9]{64}$/);
  assert.match(baseline.resolvedVariableKeyInventoryFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(baseline.resolvedVariableCount, 2);
  assert.equal(baseline.rawValuesEmitted, false);
  assert.doesNotMatch(JSON.stringify(baseline), /private-(?:raw|resolved)-secret/);

  for (const mutate of [
    current => { current.build.builder = 'RAILPACK'; },
    current => { current.deploy.runtime = 'V3'; },
    current => { current.networking.serviceDomains.api.targetPort = 9090; },
    current => { current.variables.PRIVATE_VALUE.value = 'other-private-raw-secret'; },
    current => {
      current.networking = JSON.parse('{"__proto__":{"drift":"present"}}');
    },
  ]) {
    const driftedConfig = structuredClone(environmentConfig);
    mutate(driftedConfig.services[HISTORICAL_RECOVERY_RAILWAY_IDENTITY.serviceId]);
    const drifted = createRecoveryConfigurationConservationProof({
      environmentConfig: driftedConfig,
      resolvedVariables,
    });
    assert.notEqual(drifted.targetServiceConfigFingerprint, baseline.targetServiceConfigFingerprint);
  }
  const resolvedDrift = createRecoveryConfigurationConservationProof({
    environmentConfig,
    resolvedVariables: { ...resolvedVariables, PRIVATE_VALUE: 'other-private-resolved-secret' },
  });
  assert.notEqual(
    resolvedDrift.resolvedVariableInventoryFingerprint,
    baseline.resolvedVariableInventoryFingerprint,
  );
});

test('Railway proof is exact, read-only, singleton, staged-empty, volume-bound, and repeated terminally', () => {
  for (const exactValue of [
    '1558b38d-bf16-4b50-9ee6-0871b7152116',
    '62833109-61cb-4600-9200-d624d6537a05',
    'b2016e92-3c50-4b00-800d-625a139b219c',
    '48b8768c-a8a9-4a87-8a4b-b980fff5d00c',
    '/data',
  ]) {
    assert.equal(workflow.includes(exactValue), true);
    assert.equal(railwayProof.includes(exactValue), true);
  }
  assert.match(railwayProof, /validateRailwayEmptyStagedChangeProof/);
  assert.match(railwayProof, /config\(decryptVariables: true\)/);
  assert.match(railwayProof, /serviceVariables: variables\(/);
  assert.match(railwayProof, /createRecoveryConfigurationConservationProof/);
  assert.match(railwayProof, /activeDeployments\.length !== 1/);
  assert.match(railwayProof, /instances\.length === 1/);
  assert.match(railwayProof, /volumeAttachments\.length !== 1/);
  assert.match(railwayProof, /desiredReplicaCount === 1/);
  assert.match(workflow, /railway-historical-recovery-before\.json/);
  assert.match(workflow, /railway-historical-recovery-after\.json/);
  assert.match(workflow, /cmp --silent railway-historical-recovery-before\.json railway-historical-recovery-after\.json/);
  assert.equal(
    (workflow.match(/RAILWAY_TOKEN: \$\{\{ secrets\.RAILWAY_PROJECT_TOKEN \}\}/g) || []).length,
    2,
  );
  assert.equal(
    (workflow.match(/timeout --signal=TERM --kill-after=15s 120s railway status/g) || []).length,
    2,
  );
  assert.doesNotMatch(workflow, /railway\s+(?:up|redeploy|deploy|variables?\s+(?:set|delete))/i);
  assert.doesNotMatch(railwayProof, /serviceInstanceDeployV2|DEPLOY_EXACT_COMMIT_MUTATION/);
});

test('public API proof enforces the canonical strict backup-only identity before and after', () => {
  assert.match(workflow, /PRODUCTION_API_ORIGIN: https:\/\/api\.skytech-rent\.ru/);
  assert.match(apiProof, /HISTORICAL_RECOVERY_API_ORIGIN = 'https:\/\/api\.skytech-rent\.ru'/);
  assert.match(apiProof, /redirect: 'manual'/);
  assert.match(apiProof, /MAX_JSON_BYTES = 1024 \* 1024/);
  assert.match(apiProof, /validateConservedProductionLogin/);
  assert.match(apiProof, /classification\.backupOnly !== true/);
  assert.match(apiProof, /identity\.railwayDeploymentId === railway\?\.deploymentId/);
  assert.match(apiProof, /identity\.railwayReplicaId === railway\?\.replicaId/);
  assert.match(apiProof, /version\.json\?\.app\?\.disabled === true/);
  assert.match(workflow, /api-historical-recovery-before\.json/);
  assert.match(workflow, /api-historical-recovery-after\.json/);
  assert.match(workflow, /cmp --silent api-historical-recovery-before\.json api-historical-recovery-after\.json/);
});

test('artifact transport is strict HTTPS receipt-archive-receipt with exact bounds and no CORS', () => {
  assert.ok(workflow.indexOf('fetch_exact "$base_url/receipt"') < workflow.indexOf('fetch_exact "$base_url/archive"'));
  assert.ok(workflow.indexOf('fetch_exact "$base_url/archive"') < workflow.indexOf('fetch_exact "$base_url/receipt"', workflow.indexOf('fetch_exact "$base_url/archive"') + 1));
  assert.match(workflow, /--proto '=https' --tlsv1\.2/);
  assert.match(workflow, /--max-redirs 0 --max-filesize "\$max_bytes"/);
  assert.match(workflow, /test "\$\{fields\[2\]\}" = "0"/);
  assert.match(workflow, /Origin: https:\/\/historical-backup-recovery\.invalid/);
  assert.match(workflow, /reject_header_prefix 'Access-Control-'/);
  assert.match(workflow, /Cache-Control.*no-store/s);
  assert.match(workflow, /Content-Security-Policy.*default-src 'none'; frame-ancestors 'none'/s);
  assert.match(workflow, /Strict-Transport-Security.*max-age=31536000; includeSubDomains/s);
  assert.match(workflow, /terminally re-prove the exact durable receipt/i);
  assert.doesNotMatch(workflow, /\b(?:ssh|sftp|scp)\b/i);
});

test('encryption secret is purpose-specific, consumed only, and plaintext is removed before retrieval', () => {
  assert.match(workflow, /secrets\.SKYTECH_HISTORICAL_BACKUP_RECOVERY_PASSPHRASE/);
  assert.doesNotMatch(workflow, /secrets\.PRODUCTION_SCOPE_REMEDIATION_BACKUP_ENCRYPTION_PASSPHRASE/);
  assert.doesNotMatch(workflow, /(?:gh\s+secret|secret\s+set|createOrUpdateEnvironmentSecret)/i);
  assert.match(workflow, /age\/releases\/download\/v1\.3\.1/);
  assert.match(workflow, /bdc69c09cbdd6cf8b1f333d372a1f58247b3a33146406333e30c0f26e8f51377/);
  assert.match(workflow, /test "\$\(\$AGE_BINARY --version\)" = "v1\.3\.1"/);
  assert.match(workflow, /age-plugin-batchpass/);
  assert.match(workflow, /--arg format "age-v1-plugin-batchpass"/);
  assert.equal((workflow.match(/export PATH="\$\(dirname "\$AGE_BINARY"\):\$PATH"/g) || []).length, 2);
  assert.match(workflow, /--encrypt -j batchpass/);
  assert.match(workflow, /--decrypt -j batchpass/);
  assert.doesNotMatch(workflow, /\$AGE_BINARY[^\n]*--passphrase/);
  assert.ok((workflow.match(/AGE_PASSPHRASE: \$\{\{ secrets\.SKYTECH_HISTORICAL_BACKUP_RECOVERY_PASSPHRASE \}\}/g) || []).length >= 2);
  const plaintextRemoval = workflow.indexOf('test ! -e "$RECOVERY_DOWNLOAD_DIRECTORY"');
  const artifactDownload = workflow.indexOf('Independently download the immutable artifact by exact artifact ID');
  assert.ok(plaintextRemoval > 0 && plaintextRemoval < artifactDownload);
});

test('artifact actions and CLI are immutable-pinned and exact ID plus digest are independently round-tripped', () => {
  assert.match(workflow, /actions\/checkout@1af3b93b6815bc44a9784bd300feb67ff0d1eeb3/);
  assert.match(workflow, /actions\/setup-node@2028fbc5c25fe9cf00d9f06a71cc4710d4507903/);
  assert.match(workflow, /node-version: 20\.20\.2/);
  assert.doesNotMatch(workflow, /node-version: ['"]?20['"]?\s*$/m);
  assert.match(workflow, /actions\/upload-artifact@b7c566a772e6b6bfb58ed0dc250532a479d7789f/);
  assert.match(workflow, /actions\/download-artifact@018cc2cf5baa6db3ef3c5f8a56943fffe632ef53/);
  assert.doesNotMatch(workflow, /uses:\s*[^\n]+@v\d+/);
  assert.match(workflow, /@railway\/cli@5\.45\.0/);
  assert.match(workflow, /retention-days: 90/);
  assert.match(workflow, /const observedRetentionSeconds = \(expiresAt - createdAt\) \/ 1000/);
  assert.match(workflow, /const minimumAcceptedRetentionSeconds = 89 \* 24 \* 60 \* 60/);
  assert.match(workflow, /const maximumAcceptedRetentionSeconds = 91 \* 24 \* 60 \* 60/);
  assert.match(workflow, /observedRetentionSeconds >= minimumAcceptedRetentionSeconds/);
  assert.match(workflow, /observedRetentionSeconds <= maximumAcceptedRetentionSeconds/);
  assert.match(workflow, /requestedRetentionDays: 90/);
  assert.match(workflow, /\.artifact\.metadata\.observedRetentionSeconds >= \.artifact\.metadata\.minimumAcceptedRetentionSeconds/);
  assert.doesNotMatch(workflow, /retentionMilliseconds ===/);
  assert.doesNotMatch(workflow, /\bretentionDays:\s*90/);
  assert.match(workflow, /overwrite: false/);
  assert.match(workflow, /artifact-ids: \$\{\{ steps\.recovery_artifact\.outputs\.artifact-id \}\}/);
  assert.match(workflow, /steps\.recovery_artifact\.outputs\.artifact-digest/);
  assert.match(workflow, /const metadataEndpoint = `https:\/\/api\.github\.com\/repos\/\$\{process\.env\.GITHUB_REPOSITORY\}\/actions\/artifacts\/\$\{process\.env\.ARTIFACT_ID\}`/);
  assert.match(workflow, /const expectedArchiveUrl = `\$\{metadataEndpoint\}\/zip`/);
  assert.match(workflow, /exact artifact-ID envelope digest mismatch/);
  assert.match(workflow, /cmp --silent "\$action_ciphertext" "\$stored_ciphertext"/);
  assert.match(workflow, /cmp --silent historical-backup-validation-before\.json historical-backup-validation-after\.json/);
});

test('artifact metadata retention proof accepts observed GitHub upload latency but keeps a fail-closed floor', () => {
  const observedRepositoryArtifactSeconds = 7_775_684;
  assert.ok(observedRepositoryArtifactSeconds >= 89 * 24 * 60 * 60);
  assert.ok(observedRepositoryArtifactSeconds <= 91 * 24 * 60 * 60);
  assert.match(workflow, /expiresAt > Date\.now\(\)/);
  assert.match(workflow, /artifact observed retention window is outside the accepted 89-to-91-day bounds/);
  assert.match(workflow, /minimumAcceptedObservedRetentionSeconds: \$artifactMetadata\.minimumAcceptedRetentionSeconds/);
});

test('always cleanup is terminal and covers secret headers and every plaintext location', () => {
  const cleanupPosition = workflow.lastIndexOf('if: always()');
  assert.ok(cleanupPosition > workflow.indexOf('Terminally re-prove the exact canonical public backup-only API identity'));
  const cleanup = workflow.slice(cleanupPosition);
  assert.match(cleanup, /skytech-historical-backup-request-headers/);
  assert.match(cleanup, /skytech-historical-backup-terminal-request-headers/);
  assert.match(cleanup, /skytech-historical-backup-download/);
  assert.match(cleanup, /skytech-historical-backup-revalidation/);
  assert.match(cleanup, /skytech-historical-backup-validation/);
  assert.match(cleanup, /skytech-historical-backup-recovery\.tar/);
  assert.match(cleanup, /skytech-historical-backup-recovery\.tar\.age/);
  assert.match(cleanup, /skytech-historical-backup-stored-artifact\.zip/);
});

test('allowlisted durable run summary includes exact artifact and backup digests without secrets', () => {
  const summaryStart = workflow.indexOf('Publish allowlisted non-secret recovery evidence to the run summary');
  const cleanupStart = workflow.indexOf('Always remove plaintext', summaryStart);
  const summary = workflow.slice(summaryStart, cleanupStart);
  assert.match(summary, /GITHUB_STEP_SUMMARY/);
  assert.match(summary, /immutable Actions artifact ID/);
  assert.match(summary, /immutable Actions artifact digest/);
  assert.match(summary, /exact receipt SHA-256/);
  assert.match(summary, /exact archive SHA-256/);
  assert.match(summary, /receipt\/manifest\/ZIP\/SQLite\/foreign-key\/hash revalidation: `PASS`/);
  assert.doesNotMatch(summary, /PRELIMINARY_BACKUP_TOKEN|AGE_PASSPHRASE|RAILWAY_PROJECT_TOKEN/);
});

test('Railway CLI status validator rejects replica and volume ambiguity', () => {
  const expected = HISTORICAL_RECOVERY_RAILWAY_IDENTITY;
  const deployment = {
    id: 'deployment-current',
    status: 'SUCCESS',
    meta: { commitHash: 'a'.repeat(40) },
    instances: [{ id: 'replica-current', status: 'RUNNING' }],
  };
  const status = {
    id: expected.projectId,
    environments: {
      edges: [{
        node: {
          id: expected.environmentId,
          serviceInstances: { edges: [{ node: { serviceId: expected.serviceId, latestDeployment: deployment } }] },
          volumeInstances: {
            edges: [{
              node: {
                serviceId: expected.serviceId,
                volume: { id: expected.volumeId, name: expected.volumeName },
                mountPath: expected.volumeMountPath,
                state: 'READY',
              },
            }],
          },
        },
      }],
    },
  };
  const options = {
    activeDeployment: deployment,
    expectedCommit: 'a'.repeat(40),
    controlPlane: {
      activeDeploymentCount: 1,
      deploymentMetadataReplicaCount: 1,
      effectiveConfigDesiredReplicaCount: 1,
    },
  };
  assert.equal(validateRailwayStatus(status, options).volumeMountPath, '/data');
  const twoReplicas = structuredClone(status);
  twoReplicas.environments.edges[0].node.serviceInstances.edges[0].node.latestDeployment.instances.push({
    id: 'replica-other', status: 'RUNNING',
  });
  assert.throws(() => validateRailwayStatus(twoReplicas, options), /replica count/);
  const twoVolumes = structuredClone(status);
  twoVolumes.environments.edges[0].node.volumeInstances.edges.push(
    structuredClone(twoVolumes.environments.edges[0].node.volumeInstances.edges[0]),
  );
  assert.throws(() => validateRailwayStatus(twoVolumes, options), /singleton predicate/);
});
