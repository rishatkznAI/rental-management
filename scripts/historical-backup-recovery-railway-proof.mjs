#!/usr/bin/env node

import crypto from 'node:crypto';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  RELEASE_TARGET_QUERY,
  deploymentCommit,
  railwayGraphql,
  validateExactGitSha,
  validateRailwayEffectiveConfig,
  validateRailwayTargetIdentity,
} from './railway-backend-release.mjs';
import { validateRailwayEmptyStagedChangeProof } from './railway-empty-staged-change-proof.mjs';

export const HISTORICAL_RECOVERY_RAILWAY_IDENTITY = Object.freeze({
  projectId: '1558b38d-bf16-4b50-9ee6-0871b7152116',
  environmentId: '62833109-61cb-4600-9200-d624d6537a05',
  environmentName: 'production',
  serviceId: 'b2016e92-3c50-4b00-800d-625a139b219c',
  serviceName: 'rental-management',
  volumeId: '48b8768c-a8a9-4a87-8a4b-b980fff5d00c',
  volumeName: 'rental-management-volume',
  volumeMountPath: '/data',
  repository: 'rishatkznAI/rental-management',
  branch: 'main',
  rootDirectory: '/server',
  configFile: '/server/railway.toml',
  healthcheckPath: '/health',
  startCommand: 'node scripts/start-with-release-type.cjs',
});

function exactString(value, label) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    throw new Error(`${label} must be an exact nonblank string`);
  }
  return value;
}

function objectValue(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  const parsed = JSON.parse(value);
  return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
}

function plainObject(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function canonicalPrivateJson(value, label) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (Array.isArray(value)) return value.map(item => canonicalPrivateJson(item, label));
  if (plainObject(value)) {
    const canonical = Object.create(null);
    for (const key of Object.keys(value).sort()) {
      canonical[key] = canonicalPrivateJson(value[key], label);
    }
    return canonical;
  }
  throw new Error(`${label} contains a non-JSON value`);
}

function privateFingerprint(value, domain) {
  return crypto.createHash('sha256')
    .update(`${domain}\0`, 'utf8')
    .update(JSON.stringify(value), 'utf8')
    .digest('hex');
}

export function createRecoveryConfigurationConservationProof({
  environmentConfig,
  resolvedVariables,
} = {}) {
  if (!plainObject(environmentConfig) || !plainObject(environmentConfig.services)) {
    throw new Error('Railway decrypted environment config is invalid');
  }
  const rawService = environmentConfig.services[HISTORICAL_RECOVERY_RAILWAY_IDENTITY.serviceId];
  if (!plainObject(rawService)) throw new Error('Railway decrypted target service config is missing');
  if (!plainObject(resolvedVariables) || Object.keys(resolvedVariables).length === 0) {
    throw new Error('Railway resolved target-service variables are missing');
  }
  const variableEntries = Object.entries(resolvedVariables)
    .sort(([left], [right]) => (left < right ? -1 : (left > right ? 1 : 0)));
  if (variableEntries.some(([key, value]) => (
    // Preserve the one legacy empty-key Railway entry as opaque state. It is
    // fingerprinted with its exact private value and must remain identical;
    // no other nonstandard key is accepted.
    (key !== '' && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(key))
    || typeof value !== 'string'
  ))) {
    throw new Error('Railway resolved target-service variable inventory is invalid');
  }
  const canonicalService = canonicalPrivateJson(
    rawService,
    'Railway decrypted target service config',
  );
  const canonicalVariables = canonicalPrivateJson(
    resolvedVariables,
    'Railway resolved target-service variables',
  );
  return {
    targetServiceConfigFingerprint: privateFingerprint(
      canonicalService,
      'skytech.historical-backup-recovery.target-service-config.decrypted.v1',
    ),
    targetServiceConfigTopLevelKeyCount: Object.keys(rawService).length,
    resolvedVariableInventoryFingerprint: privateFingerprint(
      canonicalVariables,
      'skytech.historical-backup-recovery.resolved-variable-inventory.v1',
    ),
    resolvedVariableKeyInventoryFingerprint: privateFingerprint(
      variableEntries.map(([key]) => key),
      'skytech.historical-backup-recovery.resolved-variable-key-inventory.v1',
    ),
    resolvedVariableCount: variableEntries.length,
    legacyEmptyVariableKeyPresent: Object.hasOwn(resolvedVariables, ''),
    legacyNonstandardVariableCount: Object.hasOwn(resolvedVariables, '') ? 1 : 0,
    legacyEmptyVariableKeyValueEmitted: false,
    legacyEmptyVariablePolicy:
      'optional one-key opaque legacy state; exact value and key presence are fingerprinted',
    authority: 'decrypted environment.config target service + Railway rendered variables query',
    rawValuesEmitted: false,
  };
}

function replicaCountFromDeployment(deployment) {
  const metadata = objectValue(deployment?.meta);
  const deploy = objectValue(objectValue(metadata.serviceManifest).deploy);
  if (deploy.multiRegionConfig !== undefined && deploy.multiRegionConfig !== null) {
    const counts = Object.values(objectValue(deploy.multiRegionConfig)).map(value => (
      value === null ? 0 : Number(value?.numReplicas)
    ));
    if (counts.some(value => !Number.isSafeInteger(value) || value < 0)) {
      throw new Error('deployment-metadata replica configuration is invalid');
    }
    return counts.reduce((total, value) => total + value, 0);
  }
  if (typeof deploy.region === 'string' && deploy.region.trim()) {
    const count = deploy.numReplicas === undefined ? 1 : Number(deploy.numReplicas);
    if (!Number.isSafeInteger(count) || count < 0) {
      throw new Error('deployment-metadata replica count is invalid');
    }
    return count;
  }
  throw new Error('deployment-metadata replica count is not proven');
}

function effectiveConfigIdentity(environment, deployment, expectedCommit) {
  const config = objectValue(environment?.config);
  const services = objectValue(config.services);
  const service = objectValue(services[HISTORICAL_RECOVERY_RAILWAY_IDENTITY.serviceId]);
  const source = objectValue(service.source);
  const deploy = objectValue(service.deploy);
  const volumeMounts = objectValue(service.volumeMounts);
  const volumeMountIds = Object.keys(volumeMounts).sort();
  const volume = objectValue(volumeMounts[HISTORICAL_RECOVERY_RAILWAY_IDENTITY.volumeId]);
  const metadata = objectValue(deployment?.meta);
  const sourceCommit = String(source.commitSha || '').trim().toLowerCase();
  const sourceBranch = source.branch;
  const sourceBranchAbsent = sourceBranch === undefined || sourceBranch === null || sourceBranch === '';
  const preDeployAbsent = deploy.preDeployCommand === undefined
    || deploy.preDeployCommand === null
    || (typeof deploy.preDeployCommand === 'string' && deploy.preDeployCommand.trim() === '');
  const regions = objectValue(deploy.multiRegionConfig);
  const canonicalRegions = {};
  for (const [region, rawConfig] of Object.entries(regions).sort(([left], [right]) => left.localeCompare(right))) {
    const count = Number(objectValue(rawConfig).numReplicas);
    if (!region.trim() || !Number.isSafeInteger(count) || count < 0) {
      throw new Error('effective Railway replica configuration is invalid');
    }
    canonicalRegions[region] = { numReplicas: count };
  }
  const desiredReplicaCount = Object.values(canonicalRegions)
    .reduce((total, region) => total + region.numReplicas, 0);
  const checks = [
    [environment?.id === HISTORICAL_RECOVERY_RAILWAY_IDENTITY.environmentId, 'effective environment ID mismatch'],
    [environment?.name === HISTORICAL_RECOVERY_RAILWAY_IDENTITY.environmentName, 'effective environment name mismatch'],
    [Object.keys(services).length > 0, 'effective services config is empty'],
    [Object.hasOwn(services, HISTORICAL_RECOVERY_RAILWAY_IDENTITY.serviceId), 'target service is absent from effective config'],
    [source.repo === HISTORICAL_RECOVERY_RAILWAY_IDENTITY.repository, 'effective source repository mismatch'],
    [sourceBranchAbsent || sourceBranch === HISTORICAL_RECOVERY_RAILWAY_IDENTITY.branch, 'effective source branch mismatch'],
    [metadata.branch === HISTORICAL_RECOVERY_RAILWAY_IDENTITY.branch, 'deployment source branch mismatch'],
    [!sourceCommit || sourceCommit === expectedCommit, 'effective source commit mismatch'],
    [source.rootDirectory === HISTORICAL_RECOVERY_RAILWAY_IDENTITY.rootDirectory, 'effective source root mismatch'],
    [source.image === undefined || source.image === null || source.image === '', 'effective source unexpectedly uses an image'],
    [!String(deploy.startCommand || '').trim()
      || String(deploy.startCommand).trim() === HISTORICAL_RECOVERY_RAILWAY_IDENTITY.startCommand,
    'effective start command mismatch'],
    [!String(deploy.healthcheckPath || '').trim()
      || String(deploy.healthcheckPath).trim() === HISTORICAL_RECOVERY_RAILWAY_IDENTITY.healthcheckPath,
    'effective healthcheck path mismatch'],
    [preDeployAbsent, 'effective pre-deploy command must be absent'],
    [desiredReplicaCount === 1, 'effective desired replica count is not exactly one'],
    [volumeMountIds.length === 1, 'effective config must contain exactly one volume mount'],
    [volumeMountIds[0] === HISTORICAL_RECOVERY_RAILWAY_IDENTITY.volumeId, 'effective volume ID mismatch'],
    [volume.mountPath === HISTORICAL_RECOVERY_RAILWAY_IDENTITY.volumeMountPath, 'effective volume mount mismatch'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
  const projection = {
    environment: {
      id: environment.id,
      name: environment.name,
    },
    service: {
      id: HISTORICAL_RECOVERY_RAILWAY_IDENTITY.serviceId,
      source: {
        repo: source.repo,
        branch: sourceBranchAbsent ? null : sourceBranch,
        deploymentMetadataBranch: metadata.branch,
        commitSha: sourceCommit || null,
        rootDirectory: source.rootDirectory,
        image: null,
      },
      deploy: {
        startCommand: String(deploy.startCommand || '').trim() || null,
        healthcheckPath: String(deploy.healthcheckPath || '').trim() || null,
        preDeployCommand: null,
        multiRegionConfig: canonicalRegions,
        desiredReplicaCount,
      },
      volumeMounts: {
        [HISTORICAL_RECOVERY_RAILWAY_IDENTITY.volumeId]: {
          mountPath: volume.mountPath,
        },
      },
    },
  };
  return {
    desiredReplicaCount,
    projection,
    fingerprint: crypto.createHash('sha256').update(JSON.stringify(projection)).digest('hex'),
  };
}

export function validateRailwayStatus(status, {
  activeDeployment,
  expectedCommit,
  controlPlane,
} = {}) {
  const expected = HISTORICAL_RECOVERY_RAILWAY_IDENTITY;
  const environments = status?.environments?.edges
    ?.map(edge => edge?.node)
    .filter(environment => environment?.id === expected.environmentId) || [];
  if (status?.id !== expected.projectId || environments.length !== 1) {
    throw new Error('Railway CLI project/environment identity mismatch');
  }
  const environment = environments[0];
  const services = environment?.serviceInstances?.edges
    ?.map(edge => edge?.node)
    .filter(service => service?.serviceId === expected.serviceId) || [];
  const volumeAttachments = environment?.volumeInstances?.edges
    ?.map(edge => edge?.node)
    .filter(volume => volume?.volume?.id === expected.volumeId) || [];
  const volumes = volumeAttachments.filter(volume => (
    volume.serviceId === expected.serviceId
      && volume.volume?.name === expected.volumeName
      && volume.mountPath === expected.volumeMountPath
      && volume.state === 'READY'
  ));
  if (services.length !== 1 || volumeAttachments.length !== 1 || volumes.length !== 1) {
    throw new Error('Railway CLI service/volume singleton predicate failed');
  }
  const latest = services[0]?.latestDeployment;
  const instances = Array.isArray(latest?.instances) ? latest.instances : [];
  const checks = [
    [latest?.id === activeDeployment.id, 'Railway CLI deployment ID mismatch'],
    [latest?.status === 'SUCCESS', 'Railway CLI deployment is not successful'],
    [deploymentCommit(latest) === expectedCommit, 'Railway CLI deployment commit mismatch'],
    [instances.length === 1, 'Railway CLI replica count is not exactly one'],
    [instances[0]?.status === 'RUNNING', 'Railway CLI replica is not running'],
    [typeof instances[0]?.id === 'string' && instances[0].id.length > 0, 'Railway CLI replica ID is missing'],
    [controlPlane.activeDeploymentCount === 1, 'Railway control plane has concurrent active deployments'],
    [controlPlane.deploymentMetadataReplicaCount === 1, 'deployment metadata replica count is not exactly one'],
    [controlPlane.effectiveConfigDesiredReplicaCount === 1, 'effective replica count is not exactly one'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
  return {
    projectId: expected.projectId,
    environmentId: expected.environmentId,
    serviceId: expected.serviceId,
    serviceName: expected.serviceName,
    volumeId: expected.volumeId,
    volumeName: expected.volumeName,
    volumeMountPath: expected.volumeMountPath,
    volumeState: volumes[0].state,
    volumeAttachmentCount: volumeAttachments.length,
    deploymentId: latest.id,
    deploymentStatus: latest.status,
    deployedSha: deploymentCommit(latest),
    deploymentInstanceCount: instances.length,
    replicaId: instances[0].id,
    replicaStatus: instances[0].status,
  };
}

export async function createRailwayRecoveryProof({
  token,
  expectedCommit,
  status,
  railwayConfigSource,
  graphql = railwayGraphql,
} = {}) {
  const commit = validateExactGitSha(expectedCommit, 'expected deployed commit');
  const expected = HISTORICAL_RECOVERY_RAILWAY_IDENTITY;
  const query = RELEASE_TARGET_QUERY
    .replace(
      'query ReleaseTarget($environmentId: String!, $serviceId: String!)',
      'query HistoricalBackupRecoveryTarget($projectId: String!, $environmentId: String!, $serviceId: String!)',
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
  if (query === RELEASE_TARGET_QUERY) throw new Error('Railway proof query extension failed');
  const data = await graphql({
    token: exactString(token, 'RAILWAY_PROJECT_TOKEN'),
    query,
    variables: {
      projectId: expected.projectId,
      environmentId: expected.environmentId,
      serviceId: expected.serviceId,
    },
  });
  const identity = validateRailwayTargetIdentity(data, expected);
  validateRailwayEffectiveConfig(data, expected, railwayConfigSource);
  if (identity.activeDeployments.length !== 1) {
    throw new Error('exactly one active Railway deployment is required');
  }
  const activeDeployment = identity.activeDeployments[0];
  const checks = [
    [activeDeployment.projectId === expected.projectId, 'active deployment project mismatch'],
    [activeDeployment.environmentId === expected.environmentId, 'active deployment environment mismatch'],
    [activeDeployment.serviceId === expected.serviceId, 'active deployment service mismatch'],
    [String(activeDeployment.status || '').trim().toUpperCase() === 'SUCCESS', 'active deployment is not successful'],
    [deploymentCommit(activeDeployment) === commit, 'active deployment commit mismatch'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
  const staged = validateRailwayEmptyStagedChangeProof({
    environment: data?.environment,
    stagedChanges: data?.environmentStagedChanges,
    expectedEnvironmentId: expected.environmentId,
  });
  const configurationConservation = createRecoveryConfigurationConservationProof({
    environmentConfig: data?.environment?.config,
    resolvedVariables: data?.serviceVariables,
  });
  const effective = effectiveConfigIdentity(data.environment, activeDeployment, commit);
  const deploymentMetadataReplicaCount = replicaCountFromDeployment(activeDeployment);
  const controlPlane = {
    activeDeploymentCount: identity.activeDeployments.length,
    deploymentMetadataReplicaCount,
    effectiveConfigDesiredReplicaCount: effective.desiredReplicaCount,
  };
  const cli = validateRailwayStatus(status, {
    activeDeployment,
    expectedCommit: commit,
    controlPlane,
  });
  return {
    ...cli,
    repository: expected.repository,
    sourceBranch: expected.branch,
    activeDeploymentCount: identity.activeDeployments.length,
    deploymentMetadataReplicaCount,
    effectiveConfigDesiredReplicaCount: effective.desiredReplicaCount,
    effectiveConfigFingerprint: effective.fingerprint,
    effectiveConfigProjection: effective.projection,
    unmergedChangesCountObserved: staged.unmergedChangesCountObserved,
    unmergedChangesCountUsedAsEmptyProof: staged.unmergedChangesCountUsedAsEmptyProof,
    stagedChangesEmpty: staged.stagedChangesEmpty,
    stagedPatchId: staged.stagedPatchId,
    stagedPatchEnvironmentId: staged.stagedPatchEnvironmentId,
    stagedPatchStatus: staged.stagedPatchStatus,
    stagedPatchCanonicalEmpty: staged.stagedPatchCanonicalEmpty,
    stagedPatchAuthority: staged.stagedPatchAuthority,
    stagedPatchStructuralChangeCount: staged.stagedPatchStructuralChangeCount,
    stagedPatchFingerprint: staged.stagedPatchFingerprint,
    ...configurationConservation,
  };
}

function parseArgs(argv) {
  const args = { expectedCommit: '', expectedWorkflowCommit: '', statusFile: '', output: '' };
  const names = new Map([
    ['--expected-commit', 'expectedCommit'],
    ['--expected-workflow-commit', 'expectedWorkflowCommit'],
    ['--status-file', 'statusFile'],
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
  const commit = validateExactGitSha(args.expectedCommit, 'expected deployed commit');
  const workflowCommit = validateExactGitSha(args.expectedWorkflowCommit, 'expected workflow commit');
  if (process.env.GITHUB_ACTIONS !== 'true') throw new Error('Railway proof is GitHub Actions only');
  if (process.env.GITHUB_REPOSITORY !== HISTORICAL_RECOVERY_RAILWAY_IDENTITY.repository) {
    throw new Error('GitHub repository mismatch');
  }
  if (process.env.GITHUB_REF !== `refs/heads/${HISTORICAL_RECOVERY_RAILWAY_IDENTITY.branch}`) {
    throw new Error('GitHub ref mismatch');
  }
  if (validateExactGitSha(process.env.GITHUB_SHA, 'GITHUB_SHA') !== workflowCommit) {
    throw new Error('GITHUB_SHA does not equal the expected workflow commit');
  }
  const status = JSON.parse(fs.readFileSync(args.statusFile, 'utf8'));
  const railwayConfigSource = fs.readFileSync(new URL('../server/railway.toml', import.meta.url), 'utf8');
  const proof = await createRailwayRecoveryProof({
    token: process.env.RAILWAY_PROJECT_TOKEN,
    expectedCommit: commit,
    status,
    railwayConfigSource,
  });
  fs.writeFileSync(args.output, `${JSON.stringify(proof, null, 2)}\n`, {
    encoding: 'utf8',
    flag: 'wx',
    mode: 0o600,
  });
  console.log('[historical-backup-recovery] exact Railway singleton and empty staged patch PASS');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[historical-backup-recovery] Railway proof FAIL: ${error.message}`);
    process.exit(1);
  });
}
