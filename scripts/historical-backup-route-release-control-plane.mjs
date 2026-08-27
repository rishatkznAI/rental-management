#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  HISTORICAL_RECOVERY_RAILWAY_IDENTITY,
  createRailwayRecoveryProof,
} from './historical-backup-recovery-railway-proof.mjs';
import { railwayGraphql, validateExactGitSha } from './railway-backend-release.mjs';

export const HISTORICAL_BACKUP_EXPECTED_SHA_KEY = 'SKYTECH_PRE_COMPATIBILITY_BACKUP_EXPECTED_SHA';
export const RAILWAY_DERIVED_COMMIT_SHA_KEY = 'RAILWAY_GIT_COMMIT_SHA';
export const ROUTE_RELEASE_IDENTITY = HISTORICAL_RECOVERY_RAILWAY_IDENTITY;

const MODES = new Set(['baseline', 'staged', 'terminal', 'rollback']);

function exactString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(`${label} must be an exact nonblank string`);
  }
  return value;
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function canonicalEntries(variables) {
  return Object.entries(variables).sort(([left], [right]) => (
    left < right ? -1 : (left > right ? 1 : 0)
  ));
}

function parsedObject(value, label) {
  if (plainObject(value)) return value;
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${label} is missing`);
  }
  try {
    const parsed = JSON.parse(value);
    if (plainObject(parsed)) return parsed;
  } catch {
    // Fall through to the one non-disclosing shape error below.
  }
  throw new Error(`${label} is not a JSON object`);
}

function canonicalJsonValue(value, label) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) {
    return value.map(item => canonicalJsonValue(item, label));
  }
  if (plainObject(value)) {
    const canonical = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      canonical[key] = canonicalJsonValue(value[key], label);
    }
    return canonical;
  }
  throw new Error(`${label} contains a non-JSON value`);
}

function fingerprintCanonicalJson(value, domain) {
  return crypto.createHash('sha256')
    .update(`${domain}\0`, 'utf8')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

export function createTargetServiceConfigFingerprints(environmentConfig) {
  const config = parsedObject(environmentConfig, 'Railway environment config');
  const services = parsedObject(config.services, 'Railway environment services config');
  const rawService = parsedObject(
    services[ROUTE_RELEASE_IDENTITY.serviceId],
    'Railway target service config',
  );
  const service = canonicalJsonValue(rawService, 'Railway target service config');
  const variables = service.variables;
  if (!plainObject(variables) || !Object.hasOwn(variables, HISTORICAL_BACKUP_EXPECTED_SHA_KEY)) {
    throw new Error('Railway target service raw config does not contain the backup-runtime pin');
  }
  const withoutPin = canonicalJsonValue(service, 'Railway target service config');
  delete withoutPin.variables[HISTORICAL_BACKUP_EXPECTED_SHA_KEY];
  const withoutPinAndSourceCommit = canonicalJsonValue(
    withoutPin,
    'Railway target service config',
  );
  if (plainObject(withoutPinAndSourceCommit.source)) {
    delete withoutPinAndSourceCommit.source.commitSha;
  }
  return {
    targetServiceConfigFingerprint: fingerprintCanonicalJson(
      service,
      'skytech.historical-backup-route-release.target-service-config.full.v1',
    ),
    targetServiceConfigWithoutPinFingerprint: fingerprintCanonicalJson(
      withoutPin,
      'skytech.historical-backup-route-release.target-service-config.without-pin.v1',
    ),
    targetServiceConfigWithoutPinAndSourceCommitFingerprint: fingerprintCanonicalJson(
      withoutPinAndSourceCommit,
      'skytech.historical-backup-route-release.target-service-config.without-pin-and-source-commit.v1',
    ),
  };
}

export function validateDecryptedTargetServiceConfigPin(environmentConfig, expectedPin) {
  const pin = validateExactGitSha(expectedPin, 'expected decrypted target-service pin');
  const config = parsedObject(environmentConfig, 'Railway decrypted environment config');
  const services = parsedObject(config.services, 'Railway decrypted environment services config');
  const service = parsedObject(
    services[ROUTE_RELEASE_IDENTITY.serviceId],
    'Railway decrypted target service config',
  );
  const variables = parsedObject(service.variables, 'Railway decrypted target service variables');
  const container = variables[HISTORICAL_BACKUP_EXPECTED_SHA_KEY];
  if (
    !plainObject(container)
    || JSON.stringify(Object.keys(container).sort()) !== JSON.stringify(['value'])
    || typeof container.value !== 'string'
    || container.value !== pin
  ) {
    throw new Error('Railway decrypted target-service backup-runtime pin is not the exact expected SHA');
  }
  return {
    key: HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
    containerOwnKeys: ['value'],
    valueType: 'string',
    valueExact: true,
    rawValueEmitted: false,
  };
}

export function validateTerminalTargetServiceConfigFingerprints(baselineRailway, currentRailway) {
  const baselineFingerprint = baselineRailway
    ?.targetServiceConfigWithoutPinAndSourceCommitFingerprint;
  const currentFingerprint = currentRailway
    ?.targetServiceConfigWithoutPinAndSourceCommitFingerprint;
  if (
    !/^[a-f0-9]{64}$/.test(String(baselineFingerprint || ''))
    || !/^[a-f0-9]{64}$/.test(String(currentFingerprint || ''))
    || currentFingerprint !== baselineFingerprint
  ) {
    throw new Error('terminal Railway target service config changed beyond pin and source commit');
  }
  return true;
}

export function validateExactVariableInventory(expected, current, label = 'Railway variables') {
  if (!plainObject(expected) || !plainObject(current)) {
    throw new Error(`${label} must be private variable objects`);
  }
  if (JSON.stringify(canonicalEntries(expected)) !== JSON.stringify(canonicalEntries(current))) {
    throw new Error(`${label} changed outside the reviewed release handoff`);
  }
  return true;
}

export function validateTerminalVariableInventory(expected, current, { expectedPin } = {}) {
  if (!plainObject(expected) || !plainObject(current)) {
    throw new Error('terminal Railway variables must be private variable objects');
  }
  const expectedKeys = Object.keys(expected).sort();
  const currentKeys = Object.keys(current).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(currentKeys)) {
    throw new Error('terminal Railway variable key inventory changed');
  }
  if (
    !Object.hasOwn(expected, RAILWAY_DERIVED_COMMIT_SHA_KEY)
    || !Object.hasOwn(current, RAILWAY_DERIVED_COMMIT_SHA_KEY)
  ) {
    throw new Error('documented Railway-derived commit variable presence changed or is missing');
  }
  assertExpectedPin(expected, expectedPin);
  assertExpectedPin(current, expectedPin);
  for (const key of expectedKeys) {
    if (key === RAILWAY_DERIVED_COMMIT_SHA_KEY) {
      if (
        typeof expected[key] !== 'string'
        || typeof current[key] !== 'string'
        || !/^[A-Fa-f0-9]{40}$/.test(expected[key])
        || !/^[A-Fa-f0-9]{40}$/.test(current[key])
      ) {
        throw new Error('documented Railway-derived commit variable is not a 40-character hex SHA');
      }
      continue;
    }
    if (expected[key] !== current[key]) {
      throw new Error('terminal Railway variable changed outside the documented derived exemption');
    }
  }
  return {
    exactKeyInventory: true,
    allNonExemptValuesExact: true,
    exemptionKey: RAILWAY_DERIVED_COMMIT_SHA_KEY,
    exemptionAuthority: 'documented Railway-provided deployment metadata',
    exemptionPresenceSymmetric: true,
    exemptionValuesAreExactHexSha: true,
    rawVariableValuesEmitted: false,
  };
}

export function parsePrivateVariableSnapshot(source) {
  let parsed;
  try {
    parsed = JSON.parse(Buffer.isBuffer(source) ? source.toString('utf8') : String(source));
  } catch {
    throw new Error('Railway variable snapshot is not valid JSON');
  }
  if (!plainObject(parsed) || Object.keys(parsed).length === 0) {
    throw new Error('Railway variable snapshot must be a nonempty object');
  }
  if (Object.entries(parsed).some(([key, value]) => (
    !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)
    || typeof value !== 'string'
  ))) {
    throw new Error('Railway variable snapshot has an invalid shape');
  }
  return parsed;
}

function assertExpectedPin(variables, expectedPin) {
  const expected = validateExactGitSha(expectedPin, 'expected backup-runtime pin');
  if (variables[HISTORICAL_BACKUP_EXPECTED_SHA_KEY] !== expected) {
    throw new Error('Railway backup-runtime pin does not match the expected SHA');
  }
  return expected;
}

export function validateOnlyExpectedPinChanged(before, after, {
  oldPin,
  newPin,
} = {}) {
  const oldSha = validateExactGitSha(oldPin, 'old backup-runtime pin');
  const newSha = validateExactGitSha(newPin, 'new backup-runtime pin');
  if (oldSha === newSha) throw new Error('old and new backup-runtime pins must differ');
  assertExpectedPin(before, oldSha);
  assertExpectedPin(after, newSha);
  const beforeEntries = canonicalEntries(before);
  const afterEntries = canonicalEntries(after);
  if (beforeEntries.length !== afterEntries.length) {
    throw new Error('Railway variable inventory changed outside the reviewed pin update');
  }
  const changedKeys = [];
  for (let index = 0; index < beforeEntries.length; index += 1) {
    const [beforeKey, beforeValue] = beforeEntries[index];
    const [afterKey, afterValue] = afterEntries[index];
    if (beforeKey !== afterKey) {
      throw new Error('Railway variable key inventory changed outside the reviewed pin update');
    }
    if (beforeValue !== afterValue) changedKeys.push(beforeKey);
  }
  if (
    changedKeys.length !== 1
    || changedKeys[0] !== HISTORICAL_BACKUP_EXPECTED_SHA_KEY
  ) {
    throw new Error('Railway variable delta is not the one reviewed backup-runtime pin');
  }
  return {
    key: HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
    oldSha,
    newSha,
    changedVariableCount: 1,
    otherVariablesUnchanged: true,
  };
}

function validateVariablesRestored(baseline, current, expectedPin) {
  assertExpectedPin(current, expectedPin);
  validateExactVariableInventory(baseline, current, 'Railway variables restored after pre-deploy failure');
  return true;
}

function stableEffectiveConfigProjection(proof) {
  const projection = proof?.effectiveConfigProjection;
  if (!plainObject(projection) || !plainObject(projection.service)) {
    throw new Error('Railway effective-config projection is missing');
  }
  const source = projection.service.source;
  if (!plainObject(source)) throw new Error('Railway effective source projection is missing');
  return {
    environment: projection.environment,
    service: {
      id: projection.service.id,
      source: {
        repo: source.repo,
        branch: source.branch,
        deploymentMetadataBranch: source.deploymentMetadataBranch,
        rootDirectory: source.rootDirectory,
        image: source.image,
      },
      deploy: projection.service.deploy,
      volumeMounts: projection.service.volumeMounts,
    },
  };
}

function stableRailwayIdentity(proof) {
  return {
    projectId: proof.projectId,
    environmentId: proof.environmentId,
    serviceId: proof.serviceId,
    serviceName: proof.serviceName,
    volumeId: proof.volumeId,
    volumeName: proof.volumeName,
    volumeMountPath: proof.volumeMountPath,
    volumeState: proof.volumeState,
    volumeAttachmentCount: proof.volumeAttachmentCount,
    // The exact deploy intentionally changes source.commitSha. Its new value is
    // proven independently by deployedSha/deploymentId below; every other
    // effective source/deploy/volume field remains part of this stable identity.
    effectiveConfigWithoutCommit: stableEffectiveConfigProjection(proof),
    repository: proof.repository,
    sourceBranch: proof.sourceBranch,
  };
}

export function validateStableRailwayIdentity(baseline, current) {
  if (JSON.stringify(stableRailwayIdentity(baseline)) !== JSON.stringify(stableRailwayIdentity(current))) {
    throw new Error('Railway target or volume identity changed during the route release');
  }
  return true;
}

function assertExecutionContext(expectedWorkflowCommit) {
  const workflowCommit = validateExactGitSha(expectedWorkflowCommit, 'expected workflow commit');
  const expectedWorkflowRef = `${ROUTE_RELEASE_IDENTITY.repository}/.github/workflows/skytech-historical-backup-route-release.yml@refs/heads/${ROUTE_RELEASE_IDENTITY.branch}`;
  const checks = [
    [process.env.GITHUB_ACTIONS === 'true', 'Railway route-release proof is GitHub Actions only'],
    [process.env.GITHUB_EVENT_NAME === 'workflow_dispatch', 'GitHub event must be workflow_dispatch'],
    [process.env.GITHUB_REPOSITORY === ROUTE_RELEASE_IDENTITY.repository, 'GitHub repository mismatch'],
    [process.env.GITHUB_REF === `refs/heads/${ROUTE_RELEASE_IDENTITY.branch}`, 'GitHub ref mismatch'],
    [validateExactGitSha(process.env.GITHUB_SHA, 'GITHUB_SHA') === workflowCommit,
      'GITHUB_SHA does not equal the reviewed workflow commit'],
    [process.env.GITHUB_WORKFLOW_SHA === workflowCommit, 'GitHub workflow SHA mismatch'],
    [process.env.GITHUB_WORKFLOW_REF === expectedWorkflowRef, 'GitHub workflow ref mismatch'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
  return workflowCommit;
}

export async function createRouteReleaseControlPlaneProof({
  mode,
  token,
  expectedWorkflowCommit,
  expectedActiveCommit,
  expectedPin,
  expectedDeploymentId = '',
  status,
  variables,
  baselineProof = null,
  baselineVariables = null,
  expectedVariables = null,
  graphql,
} = {}) {
  if (!MODES.has(mode)) throw new Error('route-release proof mode is invalid');
  const workflowCommit = validateExactGitSha(expectedWorkflowCommit, 'expected workflow commit');
  const activeCommit = validateExactGitSha(expectedActiveCommit, 'expected active backend commit');
  const pin = assertExpectedPin(variables, expectedPin);
  if (mode === 'baseline' && pin !== activeCommit) {
    throw new Error('baseline backup-runtime pin must equal the exact active backend commit');
  }
  if (['staged', 'terminal'].includes(mode) && pin !== workflowCommit) {
    throw new Error('reviewed backup-runtime pin must equal the exact workflow commit');
  }
  if (mode === 'terminal' && activeCommit !== workflowCommit) {
    throw new Error('terminal active backend commit must equal the exact workflow commit');
  }
  let recoveryTargetData = null;
  const graphqlImpl = graphql || railwayGraphql;
  const railway = await createRailwayRecoveryProof({
    token: exactString(token, 'RAILWAY_PROJECT_TOKEN'),
    expectedCommit: activeCommit,
    status,
    railwayConfigSource: fs.readFileSync(new URL('../server/railway.toml', import.meta.url), 'utf8'),
    graphql: async request => {
      const decryptedConfigClause = 'config(decryptVariables: true)';
      const query = String(request?.query || '');
      if (
        query.split(decryptedConfigClause).length !== 2
        || query.includes('config(decryptVariables: false)')
      ) {
        throw new Error('Railway release proof query does not contain one exact decrypted config clause');
      }
      const data = await graphqlImpl(request);
      recoveryTargetData = data;
      return data;
    },
  });
  const renderedVariables = parsePrivateVariableSnapshot(
    JSON.stringify(recoveryTargetData?.serviceVariables),
  );
  validateExactVariableInventory(
    variables,
    renderedVariables,
    'Railway CLI and GraphQL resolved variable inventories',
  );
  const decryptedConfigPin = validateDecryptedTargetServiceConfigPin(
    recoveryTargetData?.environment?.config,
    pin,
  );
  const configFingerprints = createTargetServiceConfigFingerprints(
    recoveryTargetData?.environment?.config,
  );
  const railwayEvidence = {
    ...railway,
    ...configFingerprints,
    targetServiceConfigFingerprintAuthority:
      'recursive-key-sorted decrypted environment.config target service; raw values never emitted',
  };
  const evidence = {
    evidenceVersion: 1,
    mode,
    workflowCommit,
    backupExpectedShaKey: HISTORICAL_BACKUP_EXPECTED_SHA_KEY,
    backupExpectedSha: pin,
    variableCount: Object.keys(variables).length,
    rawVariableValuesEmitted: false,
    railwayVariableSourcesExact: true,
    railwayVariableSourceAuthority: 'exact private CLI inventory equals GraphQL rendered variables query',
    decryptedConfigRawValuesEmitted: false,
    decryptedConfigPinExact: true,
    decryptedConfigPin,
    railway: railwayEvidence,
  };

  if (mode === 'baseline') return evidence;
  if (!plainObject(baselineProof) || baselineProof.mode !== 'baseline') {
    throw new Error('exact baseline proof is required');
  }
  validateStableRailwayIdentity(baselineProof.railway, railway);

  if (mode === 'staged') {
    if (!plainObject(baselineVariables)) throw new Error('private baseline variables are required');
    const delta = validateOnlyExpectedPinChanged(baselineVariables, variables, {
      oldPin: baselineProof.backupExpectedSha,
      newPin: pin,
    });
    if (
      railwayEvidence.deploymentId !== baselineProof.railway.deploymentId
      || railwayEvidence.replicaId !== baselineProof.railway.replicaId
      || railwayEvidence.deployedSha !== baselineProof.railway.deployedSha
    ) {
      throw new Error('running Railway deployment changed during skip-deploy pin staging');
    }
    if (
      railwayEvidence.targetServiceConfigWithoutPinFingerprint
      !== baselineProof.railway.targetServiceConfigWithoutPinFingerprint
    ) {
      throw new Error('Railway target service config changed outside the reviewed raw pin entry');
    }
    return {
      ...evidence,
      skipDeployVariableDelta: delta,
      runningDeploymentUnchanged: true,
      reviewedCommittedVariableDeltaOnly: true,
      railwayEnvironmentStagedPatchEmpty: railway.stagedChangesEmpty === true,
      skipDeployHandoffSemantics:
        'pin committed with --skip-deploys; running deployment unchanged; environment staged patch canonically empty',
      stagedPinAuthority: 'private before/after Railway variable JSON + empty environmentStagedChanges',
    };
  }

  if (mode === 'rollback') {
    if (!plainObject(baselineVariables)) throw new Error('private baseline variables are required');
    validateVariablesRestored(baselineVariables, variables, pin);
    if (
      railwayEvidence.deploymentId !== baselineProof.railway.deploymentId
      || railwayEvidence.replicaId !== baselineProof.railway.replicaId
      || railwayEvidence.deployedSha !== baselineProof.railway.deployedSha
    ) {
      throw new Error('running Railway deployment changed before staged-pin rollback completed');
    }
    if (
      railwayEvidence.targetServiceConfigFingerprint
      !== baselineProof.railway.targetServiceConfigFingerprint
    ) {
      throw new Error('Railway target service raw config was not exactly restored');
    }
    return {
      ...evidence,
      exactVariablesRestored: true,
      runningDeploymentUnchanged: true,
      stagedPatchEmptyAfterRollback: railway.stagedChangesEmpty === true,
    };
  }

  const deploymentId = exactString(expectedDeploymentId, 'expected new Railway deployment ID');
  if (!plainObject(expectedVariables)) {
    throw new Error('private pre-trigger variables are required for terminal proof');
  }
  assertExpectedPin(expectedVariables, workflowCommit);
  const terminalVariableConservation = validateTerminalVariableInventory(
    expectedVariables,
    variables,
    { expectedPin: workflowCommit },
  );
  if (
    railwayEvidence.deploymentId !== deploymentId
    || railwayEvidence.deploymentId === baselineProof.railway.deploymentId
    || railwayEvidence.deployedSha !== workflowCommit
    || railwayEvidence.activeDeploymentCount !== 1
  ) {
    throw new Error('terminal Railway deployment handoff is not exact');
  }
  validateTerminalTargetServiceConfigFingerprints(baselineProof.railway, railwayEvidence);
  return {
    ...evidence,
    previousDeploymentId: baselineProof.railway.deploymentId,
    expectedDeploymentId: deploymentId,
    oldDeploymentNoLongerActive: true,
    exactNewDeploymentActive: true,
    terminalVariablesConservedWithSingleRailwayDerivedExemption: true,
    terminalVariableConservation,
    terminalTargetServiceConfigConserved: true,
    terminalStagedPatchEmpty: railway.stagedChangesEmpty === true,
  };
}

function parseArgs(argv) {
  const args = {
    mode: '',
    expectedWorkflowCommit: '',
    expectedActiveCommit: '',
    expectedPin: '',
    expectedDeploymentId: '',
    statusFile: '',
    variablesFile: '',
    baselineProof: '',
    baselineVariables: '',
    expectedVariables: '',
    output: '',
  };
  const names = new Map([
    ['--mode', 'mode'],
    ['--expected-workflow-commit', 'expectedWorkflowCommit'],
    ['--expected-active-commit', 'expectedActiveCommit'],
    ['--expected-pin', 'expectedPin'],
    ['--expected-deployment-id', 'expectedDeploymentId'],
    ['--status-file', 'statusFile'],
    ['--variables-file', 'variablesFile'],
    ['--baseline-proof', 'baselineProof'],
    ['--baseline-variables', 'baselineVariables'],
    ['--expected-variables', 'expectedVariables'],
    ['--output', 'output'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const name = names.get(argv[index]);
    if (!name) throw new Error(`Unknown argument: ${argv[index]}`);
    args[name] = argv[++index] || '';
  }
  for (const name of ['mode', 'expectedWorkflowCommit', 'expectedActiveCommit', 'expectedPin', 'statusFile', 'variablesFile', 'output']) {
    exactString(args[name], name);
  }
  if (args.mode !== 'baseline') exactString(args.baselineProof, 'baselineProof');
  if (['staged', 'rollback'].includes(args.mode)) exactString(args.baselineVariables, 'baselineVariables');
  if (args.mode === 'terminal') {
    exactString(args.expectedDeploymentId, 'expectedDeploymentId');
    exactString(args.expectedVariables, 'expectedVariables');
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  assertExecutionContext(args.expectedWorkflowCommit);
  const status = JSON.parse(fs.readFileSync(args.statusFile, 'utf8'));
  const variables = parsePrivateVariableSnapshot(fs.readFileSync(args.variablesFile));
  const baselineProof = args.baselineProof
    ? JSON.parse(fs.readFileSync(args.baselineProof, 'utf8'))
    : null;
  const baselineVariables = args.baselineVariables
    ? parsePrivateVariableSnapshot(fs.readFileSync(args.baselineVariables))
    : null;
  const expectedVariables = args.expectedVariables
    ? parsePrivateVariableSnapshot(fs.readFileSync(args.expectedVariables))
    : null;
  const proof = await createRouteReleaseControlPlaneProof({
    mode: args.mode,
    token: process.env.RAILWAY_PROJECT_TOKEN,
    expectedWorkflowCommit: args.expectedWorkflowCommit,
    expectedActiveCommit: args.expectedActiveCommit,
    expectedPin: args.expectedPin,
    expectedDeploymentId: args.expectedDeploymentId,
    status,
    variables,
    baselineProof,
    baselineVariables,
    expectedVariables,
  });
  fs.writeFileSync(args.output, `${JSON.stringify(proof, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  console.log(`[historical-backup-route-release] control-plane ${args.mode} PASS`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[historical-backup-route-release] control-plane FAIL: ${error.message}`);
    process.exit(1);
  });
}
