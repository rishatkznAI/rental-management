import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
  RAILWAY_DERIVED_COMMIT_SHA_KEY,
  ROUTE_RELEASE_IDENTITY,
  createTargetServiceConfigFingerprints,
  parsePrivateVariableSnapshot,
  validateExactVariableInventory,
  validateDecryptedTargetServiceConfigPin,
  validateOnlyExpectedPinChanged,
  validateStableRailwayIdentity,
  validateTerminalTargetServiceConfigFingerprints,
  validateTerminalVariableInventory,
} from '../scripts/historical-backup-route-release-control-plane.mjs';
import {
  ROUTE_RELEASE_TARGET_QUERY,
  deployHistoricalBackupRouteFix,
  validatePreTriggerTargetServiceConfigFingerprint,
} from '../scripts/historical-backup-route-release-deploy.mjs';
import { createRouteReleaseApiProof } from '../scripts/historical-backup-route-release-api-proof.mjs';

const workflowPath = fileURLToPath(
  new URL('../.github/workflows/skytech-historical-backup-route-release.yml', import.meta.url),
);
const workflow = readFileSync(workflowPath, 'utf8');
const controlPlaneSource = readFileSync(
  new URL('../scripts/historical-backup-route-release-control-plane.mjs', import.meta.url),
  'utf8',
);
const deploySource = readFileSync(
  new URL('../scripts/historical-backup-route-release-deploy.mjs', import.meta.url),
  'utf8',
);
const apiProofSource = readFileSync(
  new URL('../scripts/historical-backup-route-release-api-proof.mjs', import.meta.url),
  'utf8',
);
const genericDeploySource = readFileSync(
  new URL('../scripts/railway-backend-release.mjs', import.meta.url),
  'utf8',
);
const railwayConfigSource = readFileSync(new URL('../server/railway.toml', import.meta.url), 'utf8');

const OLD_SHA = '1'.repeat(40);
const NEW_SHA = '2'.repeat(40);
const OLD_DEPLOYMENT_ID = 'deployment-old-exact';
const NEW_DEPLOYMENT_ID = 'deployment-new-exact';

function count(source, pattern) {
  return (source.match(pattern) || []).length;
}

function deploymentFixture(commit, id = OLD_DEPLOYMENT_ID) {
  return {
    id,
    projectId: ROUTE_RELEASE_IDENTITY.projectId,
    environmentId: ROUTE_RELEASE_IDENTITY.environmentId,
    serviceId: ROUTE_RELEASE_IDENTITY.serviceId,
    status: 'SUCCESS',
    meta: {
      commitHash: commit,
      branch: ROUTE_RELEASE_IDENTITY.branch,
      repo: ROUTE_RELEASE_IDENTITY.repository,
      rootDirectory: ROUTE_RELEASE_IDENTITY.rootDirectory,
      configFile: ROUTE_RELEASE_IDENTITY.configFile,
      fileServiceManifest: {
        deploy: {
          healthcheckPath: ROUTE_RELEASE_IDENTITY.healthcheckPath,
          startCommand: ROUTE_RELEASE_IDENTITY.startCommand,
        },
      },
      propertyFileMapping: {
        'deploy.healthcheckPath': '$.deploy.healthcheckPath',
        'deploy.startCommand': '$.deploy.startCommand',
      },
      serviceManifest: {
        deploy: {
          healthcheckPath: ROUTE_RELEASE_IDENTITY.healthcheckPath,
          startCommand: ROUTE_RELEASE_IDENTITY.startCommand,
          region: 'us-west1',
          numReplicas: 1,
        },
      },
    },
  };
}

function targetServiceConfigFixture(pin = NEW_SHA) {
  const expectedProjection = stableRailwayProof(OLD_SHA).effectiveConfigProjection;
  return {
    build: {
      builder: 'NIXPACKS',
      buildEnvironment: 'V3',
      watchPatterns: ['server/**'],
    },
    deploy: {
      startCommand: expectedProjection.service.deploy.startCommand,
      healthcheckPath: expectedProjection.service.deploy.healthcheckPath,
      preDeployCommand: expectedProjection.service.deploy.preDeployCommand,
      multiRegionConfig: expectedProjection.service.deploy.multiRegionConfig,
      ipv6EgressEnabled: true,
      runtime: 'V2',
      useLegacyStacker: false,
    },
    networking: {
      serviceDomains: { api: { targetPort: 8080 } },
    },
    source: {
      repo: expectedProjection.service.source.repo,
      branch: expectedProjection.service.source.branch,
      commitSha: expectedProjection.service.source.commitSha,
      rootDirectory: expectedProjection.service.source.rootDirectory,
      image: expectedProjection.service.source.image,
    },
    variables: {
      [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: { value: pin },
      DATABASE_URL: { value: '${{Postgres.DATABASE_URL}}' },
    },
    volumeMounts: expectedProjection.service.volumeMounts,
  };
}

function targetFixture(serviceVariables) {
  const oldDeployment = deploymentFixture(OLD_SHA);
  return {
    projectToken: {
      projectId: ROUTE_RELEASE_IDENTITY.projectId,
      environmentId: ROUTE_RELEASE_IDENTITY.environmentId,
    },
    environment: {
      id: ROUTE_RELEASE_IDENTITY.environmentId,
      name: 'production',
      unmergedChangesCount: 0,
      config: {
        services: {
          [ROUTE_RELEASE_IDENTITY.serviceId]: targetServiceConfigFixture(NEW_SHA),
        },
      },
    },
    environmentStagedChanges: {
      id: 'staged-change-proof',
      environmentId: ROUTE_RELEASE_IDENTITY.environmentId,
      status: 'STAGED',
      patch: {},
    },
    serviceVariables,
    service: {
      id: ROUTE_RELEASE_IDENTITY.serviceId,
      name: ROUTE_RELEASE_IDENTITY.serviceName,
      projectId: ROUTE_RELEASE_IDENTITY.projectId,
    },
    serviceInstance: {
      environmentId: ROUTE_RELEASE_IDENTITY.environmentId,
      serviceId: ROUTE_RELEASE_IDENTITY.serviceId,
      serviceName: ROUTE_RELEASE_IDENTITY.serviceName,
      rootDirectory: ROUTE_RELEASE_IDENTITY.rootDirectory,
      railwayConfigFile: null,
      healthcheckPath: ROUTE_RELEASE_IDENTITY.healthcheckPath,
      startCommand: ROUTE_RELEASE_IDENTITY.startCommand,
      source: { repo: ROUTE_RELEASE_IDENTITY.repository, image: null },
      activeDeployments: [oldDeployment],
      resolvedFileConfig: {
        commitHash: OLD_SHA,
        configFile: ROUTE_RELEASE_IDENTITY.configFile,
        deploymentId: OLD_DEPLOYMENT_ID,
        fileManifest: oldDeployment.meta.fileServiceManifest,
        propertyFileMapping: oldDeployment.meta.propertyFileMapping,
        repo: ROUTE_RELEASE_IDENTITY.repository,
        resolvedAt: '2026-08-27T12:00:00.000Z',
      },
    },
  };
}

function stagedProof() {
  const configFingerprints = createTargetServiceConfigFingerprints({
    services: {
      [ROUTE_RELEASE_IDENTITY.serviceId]: targetServiceConfigFixture(NEW_SHA),
    },
  });
  return {
    mode: 'staged',
    workflowCommit: NEW_SHA,
    backupExpectedSha: NEW_SHA,
    railway: {
      deployedSha: OLD_SHA,
      deploymentId: OLD_DEPLOYMENT_ID,
      stagedChangesEmpty: true,
      effectiveConfigProjection: stableRailwayProof(OLD_SHA).effectiveConfigProjection,
      ...configFingerprints,
    },
    runningDeploymentUnchanged: true,
    reviewedCommittedVariableDeltaOnly: true,
    railwayEnvironmentStagedPatchEmpty: true,
    decryptedConfigPinExact: true,
    decryptedConfigPin: {
      key: HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
      containerOwnKeys: ['value'],
      valueType: 'string',
      valueExact: true,
      rawValueEmitted: false,
    },
    skipDeployVariableDelta: {
      key: HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
      oldSha: OLD_SHA,
      newSha: NEW_SHA,
      changedVariableCount: 1,
    },
  };
}

function irreversibleMarker(overrides = {}) {
  return {
    markerVersion: 1,
    workflowCommit: NEW_SHA,
    previousCommit: OLD_SHA,
    previousDeploymentId: OLD_DEPLOYMENT_ID,
    decision: 'DEPLOYMENT_ATTEMPT_AUTHORIZED_NO_AUTOMATIC_ROLLBACK',
    ...overrides,
  };
}

function stableRailwayProof(commit, overrides = {}) {
  const expected = ROUTE_RELEASE_IDENTITY;
  return {
    projectId: expected.projectId,
    environmentId: expected.environmentId,
    serviceId: expected.serviceId,
    serviceName: expected.serviceName,
    volumeId: expected.volumeId,
    volumeName: expected.volumeName,
    volumeMountPath: expected.volumeMountPath,
    volumeState: 'READY',
    volumeAttachmentCount: 1,
    repository: expected.repository,
    sourceBranch: expected.branch,
    effectiveConfigProjection: {
      environment: { id: expected.environmentId, name: 'production' },
      service: {
        id: expected.serviceId,
        source: {
          repo: expected.repository,
          branch: null,
          deploymentMetadataBranch: expected.branch,
          commitSha: commit,
          rootDirectory: expected.rootDirectory,
          image: null,
        },
        deploy: {
          startCommand: expected.startCommand,
          healthcheckPath: expected.healthcheckPath,
          preDeployCommand: null,
          multiRegionConfig: { 'us-west1': { numReplicas: 1 } },
          desiredReplicaCount: 1,
        },
        volumeMounts: { [expected.volumeId]: { mountPath: expected.volumeMountPath } },
      },
    },
    ...overrides,
  };
}

test('route-release workflow YAML and every shell run block are syntactically valid', () => {
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

test('release is manual, production-serialized, and bound to exact reviewed main and workflow identity', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:/m);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule):/m);
  assert.match(workflow, /expected_main_sha:[\s\S]*expected_active_backend_sha:[\s\S]*confirmation:/);
  assert.match(workflow, /RELEASE_HISTORICAL_BACKUP_ROUTE_FIX_WITH_PIN_HANDOFF/);
  for (const binding of [
    'test "$GITHUB_EVENT_NAME" = "workflow_dispatch"',
    'test "$RUNNER_ENVIRONMENT" = "github-hosted"',
    'test "$GITHUB_REPOSITORY" = "$EXPECTED_REPOSITORY"',
    'test "$GITHUB_REF" = "$EXPECTED_REF"',
    'test "$GITHUB_SHA" = "$EXPECTED_MAIN_SHA"',
    'test "$GITHUB_WORKFLOW_SHA" = "$GITHUB_SHA"',
    'test "$GITHUB_WORKFLOW_REF" = "$EXPECTED_WORKFLOW_REF"',
  ]) assert.equal(workflow.includes(binding), true, `missing exact binding: ${binding}`);
  assert.match(workflow, /environment: production/);
  assert.match(workflow, /group: production-release/);
  assert.match(workflow, /cancel-in-progress: false/);
  assert.match(workflow, /permissions:\n  contents: read/);
});

test('actions, Node, Railway CLI, dependency locks, and full exact-checkout test gate are pinned', () => {
  const actionUses = [...workflow.matchAll(/uses:\s+([^\s]+)/g)].map(match => match[1]);
  assert.deepEqual(actionUses, [
    'actions/checkout@1af3b93b6815bc44a9784bd300feb67ff0d1eeb3',
    'actions/setup-node@2028fbc5c25fe9cf00d9f06a71cc4710d4507903',
  ]);
  assert.match(workflow, /node-version: 20\.20\.2/);
  assert.match(workflow, /cache-dependency-path: \|\n\s+package-lock\.json\n\s+server\/package-lock\.json/);
  assert.match(workflow, /npm install --global @railway\/cli@5\.45\.0/);
  assert.match(workflow, /test "\$\(railway --version\)" = "railway 5\.45\.0"/);
  assert.match(workflow, /npm ci\n\s+npm ci --prefix server\n\s+npm test/);
  assert.ok(workflow.indexOf('npm test') < workflow.indexOf('Capture exact frontend representation'));
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
});

test('workflow and helpers bind the canonical API and exact Railway singleton identity', () => {
  for (const exactValue of [
    ROUTE_RELEASE_IDENTITY.projectId,
    ROUTE_RELEASE_IDENTITY.environmentId,
    ROUTE_RELEASE_IDENTITY.serviceId,
    ROUTE_RELEASE_IDENTITY.volumeId,
    ROUTE_RELEASE_IDENTITY.volumeName,
    ROUTE_RELEASE_IDENTITY.volumeMountPath,
    ROUTE_RELEASE_IDENTITY.repository,
    'https://api.skytech-rent.ru',
    'https://app.skytech-rent.ru',
    HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
  ]) {
    assert.equal(workflow.includes(exactValue), true, `workflow must bind ${exactValue}`);
  }
  assert.match(controlPlaneSource, /createRailwayRecoveryProof/);
  assert.match(apiProofSource, /createBackupOnlyApiProof/);
  assert.match(controlPlaneSource, /private pre-trigger variables are required for terminal proof/);
  assert.match(workflow, /--expected-variables "\$STAGED_VARIABLES_FILE"/);
  assert.match(ROUTE_RELEASE_TARGET_QUERY, /environment\(id: \$environmentId\)[\s\S]*config\(decryptVariables: true\)/);
  assert.match(controlPlaneSource, /query\.split\(decryptedConfigClause\)\.length !== 2/);
  assert.doesNotMatch(controlPlaneSource, /query\.replace\([^\n]*decryptVariables/);
  assert.match(controlPlaneSource, /Railway CLI and GraphQL resolved variable inventories/);
  assert.match(controlPlaneSource, /railwayVariableSourcesExact: true/);
  assert.match(controlPlaneSource, /recursive-key-sorted decrypted environment\.config target service/);
});

test('proof order is old backup-only runtime, singular skip-deploy pin handoff, then exact new runtime', () => {
  const order = [
    'Preprove exact old pin',
    'Preprove exact canonical backup-only API',
    'Stage only the reviewed backup-runtime pin with deploys skipped',
    'Establish irreversible deployment uncertainty boundary',
    'Trigger exactly one reviewed SHA deployment',
    'Prove exact new pin, deployment, replica, volume',
    'Prove exact new canonical backup-only API runtime',
  ].map(label => workflow.indexOf(label));
  assert.equal(order.every(position => position >= 0), true);
  assert.deepEqual([...order].sort((left, right) => left - right), order);
  assert.match(controlPlaneSource, /activeDeploymentCount !== 1|activeDeploymentCount !== 1/);
  assert.match(controlPlaneSource, /running Railway deployment changed during skip-deploy pin staging/);
  assert.match(controlPlaneSource, /pin committed with --skip-deploys; running deployment unchanged; environment staged patch canonically empty/);
  assert.match(controlPlaneSource, /terminalVariablesConservedWithSingleRailwayDerivedExemption: true/);
  assert.match(controlPlaneSource, /exemptionKey: RAILWAY_DERIVED_COMMIT_SHA_KEY/);
  assert.match(controlPlaneSource, /terminalTargetServiceConfigConserved: true/);
  assert.match(controlPlaneSource, /targetServiceConfigWithoutPinAndSourceCommitFingerprint/);
  assert.match(controlPlaneSource, /oldDeploymentNoLongerActive: true/);
  assert.match(controlPlaneSource, /terminalStagedPatchEmpty:/);
});

test('raw Railway variables stay in mode-0600 runner files and are never rendered or uploaded', () => {
  assert.match(workflow, /install -d -m 700 "\$evidence_directory"/);
  assert.equal(count(workflow, /railway variable list \\/g), 4);
  assert.equal(count(workflow, /--json > "\$(?:BASELINE|STAGED|TERMINAL|ROLLBACK)_VARIABLES_FILE"/g), 4);
  for (const variableFile of [
    'BASELINE_VARIABLES_FILE',
    'STAGED_VARIABLES_FILE',
    'TERMINAL_VARIABLES_FILE',
    'ROLLBACK_VARIABLES_FILE',
  ]) assert.match(workflow, new RegExp(`install -m 600 /dev/null "\\$${variableFile}"`));
  assert.doesNotMatch(workflow, /(?:cat|head|tail|less|more|tee)\s+[^\n]*VARIABLES_FILE/);
  assert.doesNotMatch(workflow, /upload-artifact|actions\/cache|::debug::|set -x/);
  assert.match(workflow, /Always delete raw variable JSON and transient evidence[\s\S]*if: always\(\)/);
  assert.match(controlPlaneSource, /rawVariableValuesEmitted: false/);
  assert.match(deploySource, /rawVariableValuesEmitted: false/);
});

test('the only pre-deploy production mutation is an exact pin set with --skip-deploys', () => {
  assert.equal(count(workflow, /railway variable set /g), 2, 'stage plus pre-marker failure restoration only');
  for (const match of workflow.matchAll(/railway variable set[\s\S]*?--json > "\$[A-Z_]+"/g)) {
    assert.match(match[0], /"\$PIN_KEY=\$EXPECTED_(?:MAIN_SHA|ACTIVE_BACKEND_SHA)"/);
    assert.match(match[0], /--skip-deploys/);
    assert.match(match[0], /--project "\$RAILWAY_PROJECT_ID"/);
    assert.match(match[0], /--environment "\$RAILWAY_ENVIRONMENT_ID"/);
    assert.match(match[0], /--service "\$RAILWAY_SERVICE_ID"/);
  }
  assert.equal(count(workflow, /--skip-deploys/g), 2);
  assert.equal(
    count(workflow, /timeout --signal=TERM --kill-after=15s 120s railway (?:variable|status)/g),
    7,
    'every normal-path Railway state call is bounded far below the job timeout',
  );
  assert.equal(
    count(workflow, /timeout --signal=TERM --kill-after=10s (?:60|45)s railway (?:variable|status)/g),
    3,
    'cancellation-path rollback and proof captures fit inside the cancellation grace period',
  );
  assert.doesNotMatch(workflow, /railway\s+(?:up|redeploy|down|delete|restart|run|shell|ssh)\b/i);
  assert.doesNotMatch(workflow, /railway\s+variable\s+(?:delete|remove)\b/i);
  assert.doesNotMatch(workflow, /\b(?:ssh|sftp|scp)\b/i);
  assert.doesNotMatch(workflow, /server\/data|app\.sqlite|maintenance[-_ ]mode/i);
  assert.match(workflow, /app\/data\/write-freeze mutation: `NONE`/);
});

test('a separate irreversible marker precedes the one exact deploy mutation and forbids retry or rollback', () => {
  const markerStep = workflow.indexOf('- name: Establish irreversible deployment uncertainty boundary');
  const deployStep = workflow.indexOf('- name: Trigger exactly one reviewed SHA deployment');
  assert.ok(markerStep > 0 && deployStep > markerStep);
  const between = workflow.slice(markerStep, deployStep);
  assert.match(between, /DEPLOYMENT_ATTEMPT_AUTHORIZED_NO_AUTOMATIC_ROLLBACK/);
  assert.match(between, /mv "\$marker_tmp" "\$IRREVERSIBLE_MARKER"/);
  assert.equal(count(deploySource, /validateAndTriggerRailwayDeployment\(\{/g), 1);
  assert.match(genericDeploySource, /serviceInstanceDeployV2[\s\S]*commitSha:\s*\$commitSha/);
  assert.match(deploySource, /lost response is[\s\S]*never retry automatically/i);
  assert.match(deploySource, /DEPLOYMENT STATE UNCERTAIN/);
  assert.match(deploySource, /deploymentAttemptCount: 1/);
  assert.match(deploySource, /automaticRollbackAllowed: false/);
  assert.doesNotMatch(deploySource, /while[\s\S]{0,250}validateAndTriggerRailwayDeployment/);
});

test('failure or cancellation restoration is first after the terminal chain and proves exact old state', () => {
  const terminalApiStart = workflow.indexOf('- name: Prove exact new canonical backup-only API runtime');
  const rollbackStart = workflow.indexOf('- name: Roll back only a pre-deploy staged pin after non-success');
  const frontendStart = workflow.indexOf('- name: Verify frontend conservation', rollbackStart);
  const rollback = workflow.slice(rollbackStart, frontendStart);
  assert.ok(terminalApiStart > 0 && rollbackStart > terminalApiStart && frontendStart > rollbackStart);
  assert.match(rollback, /if: failure\(\) \|\| cancelled\(\)\n\s+env:/);
  assert.doesNotMatch(workflow, /\$\{\{\s*(?:failure|cancelled)\(\)/);
  assert.doesNotMatch(rollback, /PRIOR_NON_SUCCESS/);
  assert.doesNotMatch(rollback, /PRIOR_FAILURE: \$\{\{ failure\(\) \}\}/);
  assert.ok(rollback.indexOf('test -e "$IRREVERSIBLE_MARKER"') < rollback.indexOf('railway variable set'));
  assert.match(rollback, /irreversible marker: `PRESENT`/);
  assert.match(rollback, /automatic rollback: `NOT ATTEMPTED`/);
  assert.match(rollback, /automatic deploy retry: `NOT ATTEMPTED`/);
  assert.match(rollback, /"\$PIN_KEY=\$EXPECTED_ACTIVE_BACKEND_SHA"[\s\S]*--skip-deploys/);
  assert.match(rollback, /--mode rollback[\s\S]*--baseline-variables "\$BASELINE_VARIABLES_FILE"/);
  assert.match(rollback, /timeout --signal=TERM --kill-after=10s 60s railway variable set/);
  assert.match(rollback, /timeout --signal=TERM --kill-after=10s 60s node scripts\/historical-backup-route-release-control-plane\.mjs/);
  assert.match(rollback, /trap cleanup_non_success_evidence EXIT/);
  assert.match(rollback, /rm -rf "\$ROUTE_RELEASE_EVIDENCE_DIRECTORY"/);
  assert.match(controlPlaneSource, /exactVariablesRestored: true/);
  assert.match(controlPlaneSource, /runningDeploymentUnchanged: true/);
  assert.match(controlPlaneSource, /stagedPatchEmptyAfterRollback:/);
});

test('frontend conservation is always checked after any possible backend deployment outcome', () => {
  const capture = workflow.indexOf('--mode capture');
  const marker = workflow.indexOf('Establish irreversible deployment uncertainty boundary');
  const verify = workflow.indexOf('--mode verify');
  const summary = workflow.indexOf('Publish allowlisted terminal conservation evidence');
  const rollback = workflow.indexOf('Roll back only a pre-deploy staged pin');
  assert.ok(capture > 0 && capture < marker && rollback > marker && verify > rollback && verify < summary);
  assert.match(workflow, /if: always\(\) && steps\.frontend_baseline\.outcome == 'success'/);
  assert.match(workflow, /EXPECTED_FRONTEND_REPRESENTATION_SHA256/);
  assert.match(workflow, /--expected-representation-sha256 "\$EXPECTED_FRONTEND_REPRESENTATION_SHA256"/);
  assert.equal(
    count(workflow, /timeout --signal=TERM --kill-after=15s 300s node scripts\/frontend-release-snapshot\.mjs/g),
    2,
  );
  assert.match(workflow, /frontend representation conserved: `PASS`/);
  assert.match(workflow, /full target-service config conservation: `PASS`/);
  assert.match(
    workflow,
    /only documented Railway-derived `RAILWAY_GIT_COMMIT_SHA` may change; presence and 40-hex shape proven/,
  );
  assert.match(workflow, /decrypted deploy-config pin: `PASS`/);
  assert.match(workflow, /CLI\/GraphQL resolved variable inventories: `EXACT`/);
});

test('private variable delta validation permits only the one exact pin and emits no secret values', () => {
  const baseline = parsePrivateVariableSnapshot(JSON.stringify({
    DATABASE_URL: 'private-database-url',
    internalSecret: 'private-secret-before\nprivate-secret-continuation',
    [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: OLD_SHA,
  }));
  const staged = {
    ...baseline,
    [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: NEW_SHA,
  };
  assert.deepEqual(validateOnlyExpectedPinChanged(baseline, staged, {
    oldPin: OLD_SHA,
    newPin: NEW_SHA,
  }), {
    key: HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
    oldSha: OLD_SHA,
    newSha: NEW_SHA,
    changedVariableCount: 1,
    otherVariablesUnchanged: true,
  });
  assert.equal(validateExactVariableInventory(staged, structuredClone(staged)), true);
  let caught;
  try {
    validateOnlyExpectedPinChanged(baseline, { ...staged, internalSecret: 'private-secret-after' }, {
      oldPin: OLD_SHA,
      newPin: NEW_SHA,
    });
  } catch (error) {
    caught = error;
  }
  assert.match(caught?.message || '', /delta is not the one reviewed backup-runtime pin/);
  assert.doesNotMatch(caught?.message || '', /private-secret-(?:before|after)/);
  assert.throws(
    () => validateExactVariableInventory(staged, { ...staged, EXTRA_SECRET: 'private-extra' }, 'terminal variables'),
    /changed outside the reviewed release handoff/,
  );
});

test('terminal variable conservation permits only the documented Railway-derived commit SHA drift', () => {
  const expected = {
    DATABASE_URL: 'private-database-url',
    INTERNAL_SECRET: 'private-secret-before',
    [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: NEW_SHA,
    [RAILWAY_DERIVED_COMMIT_SHA_KEY]: 'A'.repeat(40),
  };
  const terminal = {
    ...expected,
    [RAILWAY_DERIVED_COMMIT_SHA_KEY]: 'b'.repeat(40),
  };
  assert.deepEqual(validateTerminalVariableInventory(expected, terminal, {
    expectedPin: NEW_SHA,
  }), {
    exactKeyInventory: true,
    allNonExemptValuesExact: true,
    exemptionKey: RAILWAY_DERIVED_COMMIT_SHA_KEY,
    exemptionAuthority: 'documented Railway-provided deployment metadata',
    exemptionPresenceSymmetric: true,
    exemptionValuesAreExactHexSha: true,
    rawVariableValuesEmitted: false,
  });

  assert.throws(
    () => validateTerminalVariableInventory(expected, {
      ...terminal,
      INTERNAL_SECRET: 'private-secret-after',
    }, { expectedPin: NEW_SHA }),
    /changed outside the documented derived exemption/,
  );
  for (const invalidDerivedValue of ['not-a-sha', 'c'.repeat(39), 'g'.repeat(40), 4]) {
    assert.throws(
      () => validateTerminalVariableInventory(expected, {
        ...terminal,
        [RAILWAY_DERIVED_COMMIT_SHA_KEY]: invalidDerivedValue,
      }, { expectedPin: NEW_SHA }),
      /not a 40-character hex SHA/,
    );
  }
  const withoutExemption = { ...terminal };
  delete withoutExemption[RAILWAY_DERIVED_COMMIT_SHA_KEY];
  assert.throws(
    () => validateTerminalVariableInventory(expected, withoutExemption, { expectedPin: NEW_SHA }),
    /key inventory changed/,
  );
  assert.throws(
    () => validateTerminalVariableInventory(expected, {
      ...terminal,
      ADDED_VARIABLE: 'private-added-value',
    }, { expectedPin: NEW_SHA }),
    /key inventory changed/,
  );
});

test('decrypted target-service config pin requires the exact private Railway value container', () => {
  const exactConfig = {
    services: {
      [ROUTE_RELEASE_IDENTITY.serviceId]: targetServiceConfigFixture(NEW_SHA),
    },
  };
  assert.deepEqual(validateDecryptedTargetServiceConfigPin(exactConfig, NEW_SHA), {
    key: HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
    containerOwnKeys: ['value'],
    valueType: 'string',
    valueExact: true,
    rawValueEmitted: false,
  });
  assert.doesNotMatch(
    JSON.stringify(validateDecryptedTargetServiceConfigPin(exactConfig, NEW_SHA)),
    new RegExp(NEW_SHA),
  );
  const wrongValue = structuredClone(exactConfig);
  wrongValue.services[ROUTE_RELEASE_IDENTITY.serviceId]
    .variables[HISTORICAL_BACKUP_EXPECTED_SHA_KEY].value = OLD_SHA;
  const wrongShape = structuredClone(exactConfig);
  wrongShape.services[ROUTE_RELEASE_IDENTITY.serviceId]
    .variables[HISTORICAL_BACKUP_EXPECTED_SHA_KEY].generator = null;
  const rawString = structuredClone(exactConfig);
  rawString.services[ROUTE_RELEASE_IDENTITY.serviceId]
    .variables[HISTORICAL_BACKUP_EXPECTED_SHA_KEY] = NEW_SHA;
  for (const invalidConfig of [wrongValue, wrongShape, rawString]) {
    assert.throws(
      () => validateDecryptedTargetServiceConfigPin(invalidConfig, NEW_SHA),
      /decrypted target-service backup-runtime pin is not the exact expected SHA/,
    );
  }
  assert.match(controlPlaneSource, /decryptedConfigPinExact: true/);
  assert.match(deploySource, /decryptedConfigPinExactAtTrigger: true/);
  const configPinProof = controlPlaneSource.indexOf(
    'const decryptedConfigPin = validateDecryptedTargetServiceConfigPin(',
  );
  const firstModeReturn = controlPlaneSource.indexOf("if (mode === 'baseline') return evidence;");
  assert.ok(configPinProof > 0 && configPinProof < firstModeReturn);
});

test('stable control-plane comparison excludes only the intentional source commit transition', () => {
  const before = stableRailwayProof(OLD_SHA);
  const after = stableRailwayProof(NEW_SHA);
  assert.equal(validateStableRailwayIdentity(before, after), true);
  const repoDrift = structuredClone(after);
  repoDrift.effectiveConfigProjection.service.source.repo = 'other/repository';
  assert.throws(() => validateStableRailwayIdentity(before, repoDrift), /target or volume identity changed/);
  const deployDrift = structuredClone(after);
  deployDrift.effectiveConfigProjection.service.deploy.desiredReplicaCount = 2;
  assert.throws(() => validateStableRailwayIdentity(before, deployDrift), /target or volume identity changed/);
  assert.doesNotMatch(
    controlPlaneSource.slice(
      controlPlaneSource.indexOf('function stableRailwayIdentity'),
      controlPlaneSource.indexOf('export function validateStableRailwayIdentity'),
    ),
    /effectiveConfigFingerprint/,
  );
});

test('deploy helper performs exactly one exact-SHA mutation and never retries a lost response', async () => {
  const baselineVariables = {
    OTHER_PRIVATE_VALUE: 'unchanged-private-value',
    [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: OLD_SHA,
  };
  const currentVariables = {
    ...baselineVariables,
    [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: NEW_SHA,
  };
  let targetQueries = 0;
  let mutationCalls = 0;
  let deploymentPolls = 0;
  const graphql = async ({ query }) => {
    if (query === ROUTE_RELEASE_TARGET_QUERY) {
      targetQueries += 1;
      return targetFixture(currentVariables);
    }
    if (query.includes('serviceInstanceDeployV2')) {
      mutationCalls += 1;
      return { serviceInstanceDeployV2: NEW_DEPLOYMENT_ID };
    }
    deploymentPolls += 1;
    return { deployment: deploymentFixture(NEW_SHA, NEW_DEPLOYMENT_ID) };
  };
  const proof = await deployHistoricalBackupRouteFix({
    token: 'private-test-token',
    workflowCommit: NEW_SHA,
    previousCommit: OLD_SHA,
    previousDeploymentId: OLD_DEPLOYMENT_ID,
    currentVariables,
    baselineVariables,
    stageProof: stagedProof(),
    marker: irreversibleMarker(),
    railwayConfigSource,
    graphql,
    pollTimeoutMs: 1_000,
    pollIntervalMs: 1,
  });
  assert.equal(proof.deploymentId, NEW_DEPLOYMENT_ID);
  assert.equal(proof.deploymentAttemptCount, 1);
  assert.deepEqual({ targetQueries, mutationCalls, deploymentPolls }, {
    targetQueries: 1,
    mutationCalls: 1,
    deploymentPolls: 1,
  });

  mutationCalls = 0;
  await assert.rejects(
    deployHistoricalBackupRouteFix({
      token: 'private-test-token',
      workflowCommit: NEW_SHA,
      previousCommit: OLD_SHA,
      previousDeploymentId: OLD_DEPLOYMENT_ID,
      currentVariables,
      baselineVariables,
      stageProof: stagedProof(),
      marker: irreversibleMarker(),
      railwayConfigSource,
      graphql: async ({ query }) => {
        if (query === ROUTE_RELEASE_TARGET_QUERY) return targetFixture(currentVariables);
        if (query.includes('serviceInstanceDeployV2')) {
          mutationCalls += 1;
          throw new Error('simulated lost mutation response');
        }
        throw new Error('unexpected automatic deployment poll');
      },
    }),
    /simulated lost mutation response/,
  );
  assert.equal(mutationCalls, 1);
});

test('pre-trigger drift or an invalid irreversible marker causes zero deployment mutations', async () => {
  const baselineVariables = {
    OTHER_PRIVATE_VALUE: 'before',
    [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: OLD_SHA,
  };
  const currentVariables = {
    OTHER_PRIVATE_VALUE: 'after',
    [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: NEW_SHA,
  };
  let graphqlCalls = 0;
  const common = {
    token: 'private-test-token',
    workflowCommit: NEW_SHA,
    previousCommit: OLD_SHA,
    previousDeploymentId: OLD_DEPLOYMENT_ID,
    currentVariables,
    baselineVariables,
    stageProof: stagedProof(),
    railwayConfigSource,
    graphql: async () => {
      graphqlCalls += 1;
      throw new Error('must not reach Railway');
    },
  };
  await assert.rejects(
    deployHistoricalBackupRouteFix({ ...common, marker: irreversibleMarker() }),
    /delta is not the one reviewed backup-runtime pin/,
  );
  assert.equal(graphqlCalls, 0);
  await assert.rejects(
    deployHistoricalBackupRouteFix({
      ...common,
      currentVariables: {
        ...baselineVariables,
        [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: NEW_SHA,
      },
      marker: irreversibleMarker({ decision: 'ALLOW_RETRY' }),
    }),
    /irreversible marker decision mismatch/,
  );
  assert.equal(graphqlCalls, 0);
});

test('a decrypted deploy-config pin mismatch causes zero deployment mutations', async () => {
  const baselineVariables = {
    OTHER_PRIVATE_VALUE: 'unchanged',
    [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: OLD_SHA,
  };
  const currentVariables = {
    ...baselineVariables,
    [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: NEW_SHA,
  };
  const mismatchedTarget = targetFixture(currentVariables);
  mismatchedTarget.environment.config.services[ROUTE_RELEASE_IDENTITY.serviceId]
    .variables[HISTORICAL_BACKUP_EXPECTED_SHA_KEY].value = OLD_SHA;
  let mutationCalls = 0;
  await assert.rejects(
    deployHistoricalBackupRouteFix({
      token: 'private-test-token',
      workflowCommit: NEW_SHA,
      previousCommit: OLD_SHA,
      previousDeploymentId: OLD_DEPLOYMENT_ID,
      currentVariables,
      baselineVariables,
      stageProof: stagedProof(),
      marker: irreversibleMarker(),
      railwayConfigSource,
      graphql: async ({ query }) => {
        if (query === ROUTE_RELEASE_TARGET_QUERY) return mismatchedTarget;
        if (query.includes('serviceInstanceDeployV2')) mutationCalls += 1;
        throw new Error('unexpected call after decrypted config pin mismatch');
      },
    }),
    /decrypted target-service backup-runtime pin is not the exact expected SHA/,
  );
  assert.equal(mutationCalls, 0);
});

test('the full decrypted target-service config hash allows only the reviewed pin delta before staging', () => {
  const oldConfig = {
    services: { [ROUTE_RELEASE_IDENTITY.serviceId]: targetServiceConfigFixture(OLD_SHA) },
  };
  const newConfig = {
    services: { [ROUTE_RELEASE_IDENTITY.serviceId]: targetServiceConfigFixture(NEW_SHA) },
  };
  const oldFingerprints = createTargetServiceConfigFingerprints(oldConfig);
  const newFingerprints = createTargetServiceConfigFingerprints(newConfig);
  assert.notEqual(
    oldFingerprints.targetServiceConfigFingerprint,
    newFingerprints.targetServiceConfigFingerprint,
  );
  assert.equal(
    oldFingerprints.targetServiceConfigWithoutPinFingerprint,
    newFingerprints.targetServiceConfigWithoutPinFingerprint,
  );
  const terminalConfig = structuredClone(newConfig);
  terminalConfig.services[ROUTE_RELEASE_IDENTITY.serviceId].source.commitSha = NEW_SHA;
  assert.equal(
    createTargetServiceConfigFingerprints(oldConfig)
      .targetServiceConfigWithoutPinAndSourceCommitFingerprint,
    createTargetServiceConfigFingerprints(terminalConfig)
      .targetServiceConfigWithoutPinAndSourceCommitFingerprint,
  );
  const drifted = structuredClone(newConfig);
  drifted.services[ROUTE_RELEASE_IDENTITY.serviceId].build.builder = 'RAILPACK';
  assert.notEqual(
    createTargetServiceConfigFingerprints(drifted).targetServiceConfigWithoutPinFingerprint,
    newFingerprints.targetServiceConfigWithoutPinFingerprint,
  );
  assert.notEqual(
    createTargetServiceConfigFingerprints(drifted)
      .targetServiceConfigWithoutPinAndSourceCommitFingerprint,
    createTargetServiceConfigFingerprints(terminalConfig)
      .targetServiceConfigWithoutPinAndSourceCommitFingerprint,
  );

  for (const specialKey of ['__proto__', 'constructor', 'prototype']) {
    const left = structuredClone(newConfig);
    const right = structuredClone(newConfig);
    for (const [config, drift] of [[left, 'one'], [right, 'two']]) {
      Object.defineProperty(
        config.services[ROUTE_RELEASE_IDENTITY.serviceId].networking,
        specialKey,
        {
          value: { drift },
          configurable: true,
          enumerable: true,
          writable: true,
        },
      );
    }
    const leftFingerprints = createTargetServiceConfigFingerprints(left);
    const rightFingerprints = createTargetServiceConfigFingerprints(right);
    assert.notEqual(
      leftFingerprints.targetServiceConfigFingerprint,
      rightFingerprints.targetServiceConfigFingerprint,
      `${specialKey} must affect the full decrypted config fingerprint`,
    );
    assert.notEqual(
      leftFingerprints.targetServiceConfigWithoutPinAndSourceCommitFingerprint,
      rightFingerprints.targetServiceConfigWithoutPinAndSourceCommitFingerprint,
      `${specialKey} must affect the terminal stable config fingerprint`,
    );
  }
});

test('terminal builder, runtime, and networking drift are rejected after allowed pin and commit changes', () => {
  const baselineConfig = {
    services: { [ROUTE_RELEASE_IDENTITY.serviceId]: targetServiceConfigFixture(OLD_SHA) },
  };
  const terminalConfig = {
    services: { [ROUTE_RELEASE_IDENTITY.serviceId]: targetServiceConfigFixture(NEW_SHA) },
  };
  terminalConfig.services[ROUTE_RELEASE_IDENTITY.serviceId].source.commitSha = NEW_SHA;
  const baselineRailway = createTargetServiceConfigFingerprints(baselineConfig);
  const currentRailway = createTargetServiceConfigFingerprints(terminalConfig);
  assert.equal(validateTerminalTargetServiceConfigFingerprints(baselineRailway, currentRailway), true);

  const drifts = [
    service => { service.build.builder = 'RAILPACK'; },
    service => { service.deploy.runtime = 'V3'; },
    service => { service.networking.serviceDomains.api.targetPort = 9090; },
  ];
  for (const introduceDrift of drifts) {
    const drifted = structuredClone(terminalConfig);
    introduceDrift(drifted.services[ROUTE_RELEASE_IDENTITY.serviceId]);
    assert.throws(
      () => validateTerminalTargetServiceConfigFingerprints(
        baselineRailway,
        createTargetServiceConfigFingerprints(drifted),
      ),
      /changed beyond pin and source commit/,
    );
  }
});

test('live full target-service config drift after staged proof causes zero deployment mutations', async () => {
  const baselineVariables = {
    OTHER_PRIVATE_VALUE: 'unchanged',
    [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: OLD_SHA,
  };
  const currentVariables = {
    ...baselineVariables,
    [HISTORICAL_BACKUP_EXPECTED_SHA_KEY]: NEW_SHA,
  };
  const expectedFingerprint = stagedProof().railway.targetServiceConfigFingerprint;
  const validTarget = targetFixture(currentVariables);
  assert.equal(validatePreTriggerTargetServiceConfigFingerprint({
    targetData: validTarget,
    expectedFingerprint,
  }), true);

  const driftCases = [
    target => {
      target.environment.config.services[ROUTE_RELEASE_IDENTITY.serviceId].build.builder = 'RAILPACK';
    },
    target => {
      target.environment.config.services[ROUTE_RELEASE_IDENTITY.serviceId].deploy.runtime = 'V3';
    },
    target => {
      target.environment.config.services[ROUTE_RELEASE_IDENTITY.serviceId].networking = {
        serviceDomains: { api: { targetPort: 9090 } },
      };
    },
    target => {
      target.environment.config.services[ROUTE_RELEASE_IDENTITY.serviceId].source.repo = 'other/repository';
    },
    target => {
      target.environment.config.services[ROUTE_RELEASE_IDENTITY.serviceId]
        .volumeMounts[ROUTE_RELEASE_IDENTITY.volumeId].mountPath = '/other-data';
    },
  ];
  for (const introduceDrift of driftCases) {
    let mutationCalls = 0;
    const driftedTarget = structuredClone(validTarget);
    introduceDrift(driftedTarget);
    await assert.rejects(
      deployHistoricalBackupRouteFix({
        token: 'private-test-token',
        workflowCommit: NEW_SHA,
        previousCommit: OLD_SHA,
        previousDeploymentId: OLD_DEPLOYMENT_ID,
        currentVariables,
        baselineVariables,
        stageProof: stagedProof(),
        marker: irreversibleMarker(),
        railwayConfigSource,
        graphql: async ({ query }) => {
          if (query === ROUTE_RELEASE_TARGET_QUERY) return driftedTarget;
          if (query.includes('serviceInstanceDeployV2')) mutationCalls += 1;
          throw new Error('unexpected call after effective-config drift');
        },
      }),
      /target service config changed after staged proof/,
    );
    assert.equal(mutationCalls, 0);
  }
});

test('API proof binds canonical backup-only evidence to terminal control-plane conservation', async () => {
  const railway = {
    mode: 'terminal',
    backupExpectedSha: NEW_SHA,
    railwayVariableSourcesExact: true,
    railwayVariableSourceAuthority: 'exact private CLI inventory equals GraphQL rendered variables query',
    decryptedConfigRawValuesEmitted: false,
    decryptedConfigPinExact: true,
    decryptedConfigPin: {
      key: HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
      containerOwnKeys: ['value'],
      valueType: 'string',
      valueExact: true,
      rawValueEmitted: false,
    },
    oldDeploymentNoLongerActive: true,
    terminalVariablesConservedWithSingleRailwayDerivedExemption: true,
    terminalVariableConservation: {
      exactKeyInventory: true,
      exemptionKey: RAILWAY_DERIVED_COMMIT_SHA_KEY,
      exemptionAuthority: 'documented Railway-provided deployment metadata',
      exemptionPresenceSymmetric: true,
      exemptionValuesAreExactHexSha: true,
      allNonExemptValuesExact: true,
      rawVariableValuesEmitted: false,
    },
    terminalTargetServiceConfigConserved: true,
    terminalStagedPatchEmpty: true,
    railway: {
      deploymentId: NEW_DEPLOYMENT_ID,
      deployedSha: NEW_SHA,
      replicaId: 'replica-new-exact',
    },
  };
  const proof = await createRouteReleaseApiProof({
    phase: 'terminal',
    origin: 'https://api.skytech-rent.ru',
    expectedCommit: NEW_SHA,
    expectedDeploymentId: NEW_DEPLOYMENT_ID,
    railway,
    createProof: async ({ expectedCommit, railway: railwayIdentity }) => ({
      mode: 'backup-only',
      expectedCommit,
      railwayIdentity,
    }),
  });
  assert.equal(proof.commit, NEW_SHA);
  assert.equal(proof.deploymentId, NEW_DEPLOYMENT_ID);
  await assert.rejects(
    createRouteReleaseApiProof({
      phase: 'terminal',
      origin: 'https://api.skytech-rent.ru',
      expectedCommit: NEW_SHA,
      expectedDeploymentId: NEW_DEPLOYMENT_ID,
      railway: {
        ...railway,
        terminalVariablesConservedWithSingleRailwayDerivedExemption: false,
      },
      createProof: async () => ({ mode: 'backup-only' }),
    }),
    /terminal Railway proof is not bound/,
  );
  await assert.rejects(
    createRouteReleaseApiProof({
      phase: 'terminal',
      origin: 'https://api.skytech-rent.ru',
      expectedCommit: NEW_SHA,
      expectedDeploymentId: NEW_DEPLOYMENT_ID,
      railway: { ...railway, decryptedConfigPinExact: false },
      createProof: async () => ({ mode: 'backup-only' }),
    }),
    /terminal Railway proof is not bound/,
  );
  await assert.rejects(
    createRouteReleaseApiProof({
      phase: 'terminal',
      origin: 'https://api.skytech-rent.ru',
      expectedCommit: NEW_SHA,
      expectedDeploymentId: NEW_DEPLOYMENT_ID,
      railway: { ...railway, railwayVariableSourcesExact: false },
      createProof: async () => ({ mode: 'backup-only' }),
    }),
    /terminal Railway proof is not bound/,
  );
});
