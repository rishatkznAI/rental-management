#!/usr/bin/env node

import fs from 'node:fs';
import { appendFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import {
  DEPLOYMENT_QUERY,
  RELEASE_TARGET_QUERY,
  deploymentCommit,
  railwayGraphql,
  validateAndTriggerRailwayDeployment,
  validateDeploymentProvenance,
  validateExactGitSha,
  validateRailwayEffectiveConfig,
} from './railway-backend-release.mjs';
import { validateRailwayEmptyStagedChangeProof } from './railway-empty-staged-change-proof.mjs';
import {
  HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
  ROUTE_RELEASE_IDENTITY,
  createTargetServiceConfigFingerprints,
  parsePrivateVariableSnapshot,
  validateDecryptedTargetServiceConfigPin,
  validateOnlyExpectedPinChanged,
} from './historical-backup-route-release-control-plane.mjs';

const TERMINAL_FAILURE_STATUSES = new Set([
  'CANCELED',
  'CANCELLED',
  'CRASHED',
  'FAILED',
  'REMOVED',
  'SKIPPED',
  'STOPPED',
]);

export const ROUTE_RELEASE_TARGET_QUERY = RELEASE_TARGET_QUERY
  .replace(
    'query ReleaseTarget($environmentId: String!, $serviceId: String!)',
    'query HistoricalBackupRouteReleaseTarget($projectId: String!, $environmentId: String!, $serviceId: String!)',
  )
  .replace(
    '    service(id: $serviceId) {',
    `    environment(id: $environmentId) {
      id
      name
      unmergedChangesCount
      config(decryptVariables: true)
    }
    environmentStagedChanges(environmentId: $environmentId) {
      id
      environmentId
      status
      patch(decryptVariables: false)
    }
    serviceVariables: variables(
      projectId: $projectId
      environmentId: $environmentId
      serviceId: $serviceId
    )
    service(id: $serviceId) {`,
  );

function exactString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(`${label} must be an exact nonblank string`);
  }
  return value;
}

function exactIdentifier(value, label) {
  const identifier = exactString(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(identifier)) {
    throw new Error(`${label} is not a safe exact identifier`);
  }
  return identifier;
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

export function validatePreTriggerTargetServiceConfigFingerprint({
  targetData,
  expectedFingerprint,
} = {}) {
  if (!/^[a-f0-9]{64}$/.test(String(expectedFingerprint || ''))) {
    throw new Error('reviewed staged target-service config fingerprint is invalid');
  }
  const { targetServiceConfigFingerprint } = createTargetServiceConfigFingerprints(
    targetData?.environment?.config,
  );
  if (targetServiceConfigFingerprint !== expectedFingerprint) {
    throw new Error('Railway target service config changed after staged proof');
  }
  return true;
}

function exactPrivateFile(filePath, label) {
  const resolved = exactString(filePath, label);
  const stat = fs.lstatSync(resolved);
  const effectiveUid = typeof process.geteuid === 'function' ? process.geteuid() : null;
  if (
    !stat.isFile()
    || stat.isSymbolicLink()
    || stat.nlink !== 1
    || !Number.isSafeInteger(effectiveUid)
    || stat.uid !== effectiveUid
    || (stat.mode & 0o7777) !== 0o600
    || stat.size <= 0
    || stat.size > 64 * 1024 * 1024
  ) {
    throw new Error(`${label} is not an exact private runner file`);
  }
  return resolved;
}

function exactJsonFile(filePath, label) {
  const privatePath = exactPrivateFile(filePath, label);
  let parsed;
  try {
    parsed = JSON.parse(fs.readFileSync(privatePath, 'utf8'));
  } catch {
    throw new Error(`${label} is not valid JSON`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`${label} must contain a JSON object`);
  }
  return parsed;
}

function assertContext(expectedWorkflowCommit) {
  const commit = validateExactGitSha(expectedWorkflowCommit, 'expected workflow commit');
  const expectedWorkflowRef = `${ROUTE_RELEASE_IDENTITY.repository}/.github/workflows/skytech-historical-backup-route-release.yml@refs/heads/${ROUTE_RELEASE_IDENTITY.branch}`;
  const checks = [
    [process.env.GITHUB_ACTIONS === 'true', 'exact deploy is GitHub Actions only'],
    [process.env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'exact deploy event mismatch'],
    [process.env.GITHUB_REPOSITORY === ROUTE_RELEASE_IDENTITY.repository, 'exact deploy repository mismatch'],
    [process.env.GITHUB_REF === `refs/heads/${ROUTE_RELEASE_IDENTITY.branch}`, 'exact deploy ref mismatch'],
    [validateExactGitSha(process.env.GITHUB_SHA, 'GITHUB_SHA') === commit, 'exact deploy SHA mismatch'],
    [process.env.GITHUB_WORKFLOW_SHA === commit, 'exact deploy workflow SHA mismatch'],
    [process.env.GITHUB_WORKFLOW_REF === expectedWorkflowRef, 'exact deploy workflow ref mismatch'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
  return commit;
}

function assertIrreversibleMarker(marker, {
  workflowCommit,
  previousCommit,
  previousDeploymentId,
} = {}) {
  const checks = [
    [marker.markerVersion === 1, 'irreversible marker version mismatch'],
    [marker.workflowCommit === workflowCommit, 'irreversible marker workflow SHA mismatch'],
    [marker.previousCommit === previousCommit, 'irreversible marker previous SHA mismatch'],
    [marker.previousDeploymentId === previousDeploymentId, 'irreversible marker previous deployment mismatch'],
    [marker.decision === 'DEPLOYMENT_ATTEMPT_AUTHORIZED_NO_AUTOMATIC_ROLLBACK',
      'irreversible marker decision mismatch'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
}

function assertStageProof(stageProof, {
  workflowCommit,
  previousCommit,
  previousDeploymentId,
} = {}) {
  const checks = [
    [stageProof.mode === 'staged', 'staged pin proof mode mismatch'],
    [stageProof.workflowCommit === workflowCommit, 'staged pin workflow SHA mismatch'],
    [stageProof.backupExpectedSha === workflowCommit, 'staged pin value mismatch'],
    [stageProof.railway?.deployedSha === previousCommit, 'staged pin active SHA mismatch'],
    [stageProof.railway?.deploymentId === previousDeploymentId, 'staged pin deployment mismatch'],
    [stageProof.runningDeploymentUnchanged === true, 'staged pin changed the running deployment'],
    [stageProof.reviewedCommittedVariableDeltaOnly === true, 'skip-deploy pin delta was not singular'],
    [stageProof.railwayEnvironmentStagedPatchEmpty === true,
      'Railway environment staged patch was not canonically empty'],
    [stageProof.skipDeployVariableDelta?.key === HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
      'staged pin key mismatch'],
    [stageProof.skipDeployVariableDelta?.oldSha === previousCommit, 'staged pin old SHA mismatch'],
    [stageProof.skipDeployVariableDelta?.newSha === workflowCommit, 'staged pin new SHA mismatch'],
    [stageProof.skipDeployVariableDelta?.changedVariableCount === 1, 'staged pin change count mismatch'],
    [stageProof.railway?.stagedChangesEmpty === true, 'unrelated Railway staged changes exist'],
    [stageProof.decryptedConfigPinExact === true, 'staged decrypted config pin was not proven'],
    [stageProof.decryptedConfigPin?.key === HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
      'staged decrypted config pin key mismatch'],
    [JSON.stringify(stageProof.decryptedConfigPin?.containerOwnKeys) === JSON.stringify(['value']),
      'staged decrypted config pin container shape mismatch'],
    [stageProof.decryptedConfigPin?.valueType === 'string',
      'staged decrypted config pin type mismatch'],
    [stageProof.decryptedConfigPin?.valueExact === true,
      'staged decrypted config pin value was not proven'],
    [stageProof.decryptedConfigPin?.rawValueEmitted === false,
      'staged decrypted config pin evidence is not private-safe'],
    [/^[a-f0-9]{64}$/.test(String(stageProof.railway?.targetServiceConfigFingerprint || '')),
      'staged target-service config fingerprint is missing'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollExactDeployment({
  token,
  deploymentId,
  expected,
  timeoutMs,
  intervalMs,
  graphql = railwayGraphql,
}) {
  const deadline = Date.now() + timeoutMs;
  let previousStatus = '';
  while (Date.now() < deadline) {
    const data = await graphql({ token, query: DEPLOYMENT_QUERY, variables: { id: deploymentId } });
    const deployment = data?.deployment;
    if (!deployment?.id) throw new Error('exact Railway deployment query returned no deployment');
    const status = String(deployment.status || '').trim().toUpperCase();
    if (status !== previousStatus) {
      console.log(`[historical-backup-route-release] deployment status=${status || 'missing'}`);
      previousStatus = status;
    }
    if (status === 'SUCCESS') {
      validateDeploymentProvenance(deployment, { ...expected, deploymentId });
      return deployment;
    }
    if (TERMINAL_FAILURE_STATUSES.has(status)) {
      throw new Error(`exact Railway deployment ended with status=${status}`);
    }
    if (Date.now() < deadline) await sleep(intervalMs);
  }
  throw new Error('exact Railway deployment outcome is uncertain after the bounded poll');
}

async function appendOutput(name, value) {
  const outputPath = exactString(process.env.GITHUB_OUTPUT, 'GITHUB_OUTPUT');
  await appendFile(outputPath, `${name}=${value}\n`, 'utf8');
}

export async function deployHistoricalBackupRouteFix({
  token,
  workflowCommit,
  previousCommit,
  previousDeploymentId,
  currentVariables,
  baselineVariables,
  stageProof,
  marker,
  railwayConfigSource,
  graphql = railwayGraphql,
  pollTimeoutMs = 20 * 60_000,
  pollIntervalMs = 10_000,
} = {}) {
  const expectedCommit = validateExactGitSha(workflowCommit, 'reviewed route-fix commit');
  const oldCommit = validateExactGitSha(previousCommit, 'previous backend commit');
  const oldDeploymentId = exactIdentifier(previousDeploymentId, 'previous deployment ID');
  if (expectedCommit === oldCommit) throw new Error('route-fix and previous commits must differ');
  assertStageProof(stageProof, {
    workflowCommit: expectedCommit,
    previousCommit: oldCommit,
    previousDeploymentId: oldDeploymentId,
  });
  assertIrreversibleMarker(marker, {
    workflowCommit: expectedCommit,
    previousCommit: oldCommit,
    previousDeploymentId: oldDeploymentId,
  });
  validateOnlyExpectedPinChanged(baselineVariables, currentVariables, {
    oldPin: oldCommit,
    newPin: expectedCommit,
  });

  const targetData = await graphql({
    token: exactString(token, 'RAILWAY_PROJECT_TOKEN'),
    query: ROUTE_RELEASE_TARGET_QUERY,
    variables: {
      projectId: ROUTE_RELEASE_IDENTITY.projectId,
      environmentId: ROUTE_RELEASE_IDENTITY.environmentId,
      serviceId: ROUTE_RELEASE_IDENTITY.serviceId,
    },
  });
  const liveVariables = parsePrivateVariableSnapshot(JSON.stringify(targetData?.serviceVariables));
  if (JSON.stringify(Object.entries(liveVariables).sort()) !== JSON.stringify(Object.entries(currentVariables).sort())) {
    throw new Error('Railway variables changed after the reviewed skip-deploy proof');
  }
  const staged = validateRailwayEmptyStagedChangeProof({
    environment: targetData?.environment,
    stagedChanges: targetData?.environmentStagedChanges,
    expectedEnvironmentId: ROUTE_RELEASE_IDENTITY.environmentId,
  });
  if (staged.stagedChangesEmpty !== true) throw new Error('Railway has unreviewed staged changes');
  validateDecryptedTargetServiceConfigPin(targetData?.environment?.config, expectedCommit);
  const target = validateRailwayEffectiveConfig(targetData, ROUTE_RELEASE_IDENTITY, railwayConfigSource);
  if (
    target.activeDeployments.length !== 1
    || target.activeDeployments[0].id !== oldDeploymentId
    || deploymentCommit(target.activeDeployments[0]) !== oldCommit
    || String(target.activeDeployments[0].status || '').trim().toUpperCase() !== 'SUCCESS'
  ) {
    throw new Error('previous Railway singleton changed before the exact deploy trigger');
  }
  validatePreTriggerTargetServiceConfigFingerprint({
    targetData,
    expectedFingerprint: stageProof.railway.targetServiceConfigFingerprint,
  });

  // This is the only deployment mutation in this workflow. A lost response is
  // deliberately treated as uncertain; callers must never retry automatically.
  const triggered = await validateAndTriggerRailwayDeployment({
    token,
    targetData,
    railwayConfigSource,
    expected: {
      ...ROUTE_RELEASE_IDENTITY,
      commit: expectedCommit,
    },
    graphql,
  });
  const deploymentId = exactIdentifier(triggered.deploymentId, 'exact route-fix deployment ID');
  const deployment = await pollExactDeployment({
    token,
    deploymentId,
    expected: {
      ...triggered.target,
      commit: expectedCommit,
    },
    timeoutMs: pollTimeoutMs,
    intervalMs: pollIntervalMs,
    graphql,
  });
  return {
    evidenceVersion: 1,
    deploymentAttemptCount: 1,
    automaticRollbackAllowed: false,
    previousCommit: oldCommit,
    previousDeploymentId: oldDeploymentId,
    deployedCommit: expectedCommit,
    deploymentId,
    deploymentStatus: String(deployment.status || '').trim().toUpperCase(),
    pinKey: HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
    pinSha: expectedCommit,
    stagedPatchWasEmptyAtTrigger: true,
    decryptedConfigPinExactAtTrigger: true,
    decryptedConfigRawValuesEmitted: false,
    rawVariableValuesEmitted: false,
  };
}

function parseArgs(argv) {
  const args = {
    expectedWorkflowCommit: '',
    previousCommit: '',
    previousDeploymentId: '',
    variablesFile: '',
    baselineVariables: '',
    stageProof: '',
    irreversibleMarker: '',
    output: '',
  };
  const names = new Map([
    ['--expected-workflow-commit', 'expectedWorkflowCommit'],
    ['--previous-commit', 'previousCommit'],
    ['--previous-deployment-id', 'previousDeploymentId'],
    ['--variables-file', 'variablesFile'],
    ['--baseline-variables', 'baselineVariables'],
    ['--stage-proof', 'stageProof'],
    ['--irreversible-marker', 'irreversibleMarker'],
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

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const workflowCommit = assertContext(args.expectedWorkflowCommit);
  const variables = parsePrivateVariableSnapshot(
    fs.readFileSync(exactPrivateFile(args.variablesFile, 'current variables file')),
  );
  const baselineVariables = parsePrivateVariableSnapshot(
    fs.readFileSync(exactPrivateFile(args.baselineVariables, 'baseline variables file')),
  );
  const stageProof = exactJsonFile(args.stageProof, 'staged pin proof');
  const marker = exactJsonFile(args.irreversibleMarker, 'irreversible deployment marker');
  const result = await deployHistoricalBackupRouteFix({
    token: process.env.RAILWAY_PROJECT_TOKEN,
    workflowCommit,
    previousCommit: args.previousCommit,
    previousDeploymentId: args.previousDeploymentId,
    currentVariables: variables,
    baselineVariables,
    stageProof,
    marker,
    railwayConfigSource: fs.readFileSync(new URL('../server/railway.toml', import.meta.url), 'utf8'),
  });
  fs.writeFileSync(args.output, `${JSON.stringify(result, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  await appendOutput('deployment_id', result.deploymentId);
  console.log(`[historical-backup-route-release] exact deployment id=${result.deploymentId}`);
  console.log('[historical-backup-route-release] exact deployment SUCCESS; terminal proof still required');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[historical-backup-route-release] DEPLOYMENT STATE UNCERTAIN: ${error.message}`);
    process.exit(1);
  });
}
