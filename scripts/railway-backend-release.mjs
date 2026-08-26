#!/usr/bin/env node

import { appendFile, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

export const RAILWAY_GRAPHQL_URL = 'https://backboard.railway.com/graphql/v2';

export const RELEASE_TARGET_QUERY = `
  query ReleaseTarget($environmentId: String!, $serviceId: String!) {
    projectToken {
      projectId
      environmentId
    }
    service(id: $serviceId) {
      id
      name
      projectId
    }
    serviceInstance(environmentId: $environmentId, serviceId: $serviceId) {
      environmentId
      serviceId
      serviceName
      rootDirectory
      railwayConfigFile
      healthcheckPath
      startCommand
      source {
        repo
        image
      }
      activeDeployments {
        id
        projectId
        environmentId
        serviceId
        status
        meta
      }
      resolvedFileConfig {
        commitHash
        configFile
        deploymentId
        fileManifest
        propertyFileMapping
        repo
        resolvedAt
      }
    }
  }
`;

export const DEPLOY_EXACT_COMMIT_MUTATION = `
  mutation DeployExactCommit($environmentId: String!, $serviceId: String!, $commitSha: String!) {
    serviceInstanceDeployV2(
      environmentId: $environmentId
      serviceId: $serviceId
      commitSha: $commitSha
    )
  }
`;

export const DEPLOYMENT_QUERY = `
  query ReleaseDeployment($id: String!) {
    deployment(id: $id) {
      id
      projectId
      environmentId
      serviceId
      status
      createdAt
      updatedAt
      meta
    }
  }
`;

const TERMINAL_FAILURE_STATUSES = new Set([
  'CANCELED',
  'CANCELLED',
  'CRASHED',
  'FAILED',
  'REMOVED',
  'SKIPPED',
  'STOPPED',
]);

const ALLOWED_RUNTIME_RELEASE_TYPES = new Set(['backend', 'full-stack']);
const DEFAULT_ROOT_DIRECTORY = 'server';
const DEFAULT_HEALTHCHECK_PATH = '/health';
const DEFAULT_START_COMMAND = 'node scripts/start-with-release-type.cjs';

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

export function validateExactGitSha(value = '', label = 'Git SHA') {
  const normalized = String(value || '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(normalized)) {
    throw new Error(`${label} must be an exact 40-character hexadecimal Git SHA`);
  }
  return normalized;
}

function normalizeRepository(value = '') {
  return String(value || '')
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function normalizeRootDirectory(value = '') {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

function normalizeConfigFile(value = '') {
  const normalized = String(value || '').trim().replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
  return normalized ? `/${normalized}` : '';
}

function normalizeUrl(value = '') {
  return String(value || '').trim().replace(/\/+$/, '');
}

function releaseType(value = '') {
  return String(value || '').trim().toLowerCase();
}

function metadataObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function deploymentCommit(deployment = {}) {
  const meta = metadataObject(deployment?.meta);
  return String(meta.commitHash || meta.commitSha || meta.commit || '').trim().toLowerCase();
}

function stripTomlComment(line = '') {
  let quote = '';
  let escaped = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (quote === '"' && character === '\\' && !escaped) {
      escaped = true;
      continue;
    }
    if ((character === '"' || character === "'") && !escaped) {
      quote = quote === character ? '' : (quote || character);
    }
    if (character === '#' && !quote) return line.slice(0, index);
    escaped = false;
  }
  return line;
}

function parseTomlString(value = '', label = 'Railway config value') {
  const normalized = String(value || '').trim();
  if (normalized.startsWith('"') && normalized.endsWith('"')) {
    try {
      return JSON.parse(normalized);
    } catch {
      throw new Error(`${label} must be a valid TOML string`);
    }
  }
  if (normalized.startsWith("'") && normalized.endsWith("'")) {
    return normalized.slice(1, -1);
  }
  throw new Error(`${label} must be a quoted TOML string`);
}

export function parseRailwayDeployConfig(source = '') {
  if (!String(source || '').trim()) {
    throw new Error('committed Railway config source is required');
  }
  const result = {};
  let section = '';
  for (const rawLine of String(source).split(/\r?\n/)) {
    const line = stripTomlComment(rawLine).trim();
    if (!line) continue;
    const sectionMatch = line.match(/^\[([^\]]+)]$/);
    if (sectionMatch) {
      section = sectionMatch[1].trim();
      continue;
    }
    if (section !== 'deploy') continue;
    const assignment = line.match(/^(startCommand|healthcheckPath)\s*=\s*(.+)$/);
    if (!assignment) continue;
    const [, key, rawValue] = assignment;
    if (Object.hasOwn(result, key)) {
      throw new Error(`committed Railway config has duplicate deploy.${key}`);
    }
    result[key] = parseTomlString(rawValue, `committed Railway deploy.${key}`);
  }
  return result;
}

function expectedRailwayConfig(expected = {}) {
  const rootDirectory = normalizeRootDirectory(expected.rootDirectory || DEFAULT_ROOT_DIRECTORY);
  return {
    rootDirectory,
    configFile: normalizeConfigFile(expected.configFile || `${rootDirectory}/railway.toml`),
    healthcheckPath: String(expected.healthcheckPath || DEFAULT_HEALTHCHECK_PATH).trim(),
    startCommand: String(expected.startCommand || DEFAULT_START_COMMAND).trim(),
  };
}

function effectiveDeployValues(value = {}) {
  const object = metadataObject(value);
  const deploy = metadataObject(object.deploy);
  return {
    healthcheckPath: String(deploy.healthcheckPath || '').trim(),
    startCommand: String(deploy.startCommand || '').trim(),
  };
}

function validateEffectiveDeploymentMetadata(deployment = {}, expected = {}) {
  const meta = metadataObject(deployment?.meta);
  const fileValues = effectiveDeployValues(meta.fileServiceManifest);
  const resolvedValues = effectiveDeployValues(meta.serviceManifest);
  const mapping = metadataObject(meta.propertyFileMapping);
  const repository = normalizeRepository(expected.repository);
  const checks = [
    [normalizeRootDirectory(meta.rootDirectory) === expected.rootDirectory, 'effective deployment root directory mismatch'],
    [normalizeConfigFile(meta.configFile) === expected.configFile, 'effective deployment config file mismatch'],
    [fileValues.healthcheckPath === expected.healthcheckPath, 'effective deployment healthcheck path mismatch'],
    [fileValues.startCommand === expected.startCommand, 'effective deployment start command mismatch'],
    [resolvedValues.healthcheckPath === expected.healthcheckPath, 'resolved service healthcheck path mismatch'],
    [resolvedValues.startCommand === expected.startCommand, 'resolved service start command mismatch'],
    [mapping['deploy.healthcheckPath'] === '$.deploy.healthcheckPath', 'healthcheck path is not proven file-managed'],
    [mapping['deploy.startCommand'] === '$.deploy.startCommand', 'start command is not proven file-managed'],
  ];
  if (repository) {
    checks.push([normalizeRepository(meta.repo) === repository, 'effective deployment repository mismatch']);
  }
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);
}

export function validateExecutionContext({
  env = process.env,
  expectedCommit = '',
  expectedRepository = '',
  expectedBranch = 'main',
  requestedReleaseType = '',
} = {}) {
  const commit = validateExactGitSha(expectedCommit, 'expected release commit');
  const repository = normalizeRepository(expectedRepository);
  const branch = required(expectedBranch, 'expected branch');
  const requestedType = releaseType(requestedReleaseType);

  if (String(env.GITHUB_ACTIONS || '').trim().toLowerCase() !== 'true') {
    throw new Error('backend deploy is allowed only from GitHub Actions');
  }
  if (validateExactGitSha(env.GITHUB_SHA, 'GITHUB_SHA') !== commit) {
    throw new Error('GITHUB_SHA does not equal the requested release commit');
  }
  if (normalizeRepository(env.GITHUB_REPOSITORY) !== repository) {
    throw new Error('GITHUB_REPOSITORY does not equal the expected connected repository');
  }
  if (String(env.GITHUB_REF || '').trim() !== `refs/heads/${branch}`) {
    throw new Error(`backend deploy must run from refs/heads/${branch}`);
  }
  if (!['backend', 'full-stack'].includes(requestedType)) {
    throw new Error('backend deploy release type must be backend or full-stack');
  }

  return { commit, repository, branch, requestedType };
}

export function validateRailwayTargetIdentity(data = {}, expected = {}) {
  const projectId = required(expected.projectId, 'expected Railway project ID');
  const environmentId = required(expected.environmentId, 'expected Railway environment ID');
  const serviceId = required(expected.serviceId, 'expected Railway service ID');
  const repository = normalizeRepository(required(expected.repository, 'expected Railway repository'));
  const { rootDirectory } = expectedRailwayConfig(expected);
  const expectedServiceName = String(expected.serviceName || '').trim();
  const token = data?.projectToken || {};
  const service = data?.service || {};
  const instance = data?.serviceInstance || {};
  const source = instance?.source || {};
  const activeDeployments = Array.isArray(instance?.activeDeployments)
    ? instance.activeDeployments
    : [];

  const checks = [
    [token.projectId === projectId, 'project token project ID mismatch'],
    [token.environmentId === environmentId, 'project token environment ID mismatch'],
    [service.id === serviceId, 'Railway service ID mismatch'],
    [service.projectId === projectId, 'Railway service project ID mismatch'],
    [instance.environmentId === environmentId, 'Railway service instance environment ID mismatch'],
    [instance.serviceId === serviceId, 'Railway service instance service ID mismatch'],
    [normalizeRepository(source.repo) === repository, 'Railway service source repository mismatch'],
    [!String(source.image || '').trim(), 'Railway service must use the Git repository source, not an image source'],
    [normalizeRootDirectory(instance.rootDirectory) === rootDirectory, 'Railway root directory mismatch'],
    [activeDeployments.length <= 1, 'Railway target has ambiguous multiple active deployments'],
  ];
  if (expectedServiceName) {
    checks.push([service.name === expectedServiceName, 'Railway service name mismatch']);
    checks.push([instance.serviceName === expectedServiceName, 'Railway service instance name mismatch']);
  }

  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);

  return {
    projectId,
    environmentId,
    serviceId,
    serviceName: String(service.name || instance.serviceName || ''),
    repository,
    rootDirectory,
    activeDeployments,
  };
}

export function validateRailwayEffectiveConfig(data = {}, expected = {}, railwayConfigSource = '') {
  const identity = validateRailwayTargetIdentity(data, expected);
  const config = expectedRailwayConfig({ ...expected, rootDirectory: identity.rootDirectory });
  const instance = data?.serviceInstance || {};
  const committed = parseRailwayDeployConfig(railwayConfigSource);
  const rawHealthcheckPath = String(instance.healthcheckPath || '').trim();
  const rawStartCommand = String(instance.startCommand || '').trim();
  const rawConfigFile = normalizeConfigFile(instance.railwayConfigFile);

  const committedChecks = [
    [committed.healthcheckPath === config.healthcheckPath, 'committed Railway healthcheck path mismatch'],
    [committed.startCommand === config.startCommand, 'committed Railway start command mismatch'],
  ];
  const rawChecks = [
    [!rawHealthcheckPath || rawHealthcheckPath === config.healthcheckPath, 'Railway healthcheck path mismatch'],
    [!rawStartCommand || rawStartCommand === config.startCommand, 'Railway start command mismatch'],
    [!rawConfigFile || rawConfigFile === config.configFile, 'Railway config file mismatch'],
  ];
  const failedCommitted = committedChecks.find(([ok]) => !ok);
  if (failedCommitted) throw new Error(failedCommitted[1]);
  const failedRaw = rawChecks.find(([ok]) => !ok);
  if (failedRaw) throw new Error(failedRaw[1]);

  if (identity.activeDeployments.length !== 1) {
    throw new Error('EFFECTIVE_RAILWAY_CONFIG_UNVERIFIED: one active deployment is required');
  }
  const activeDeployment = identity.activeDeployments[0];
  const resolved = instance.resolvedFileConfig;
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    throw new Error('EFFECTIVE_RAILWAY_CONFIG_UNVERIFIED: resolved file config is missing');
  }
  const resolvedManifest = effectiveDeployValues(resolved.fileManifest);
  const resolvedMapping = metadataObject(resolved.propertyFileMapping);
  const resolvedCommit = String(resolved.commitHash || '').trim().toLowerCase();
  const evidenceChecks = [
    [String(activeDeployment.status || '').trim().toUpperCase() === 'SUCCESS', 'effective evidence deployment is not successful'],
    [activeDeployment.projectId === identity.projectId, 'effective evidence project ID mismatch'],
    [activeDeployment.environmentId === identity.environmentId, 'effective evidence environment ID mismatch'],
    [activeDeployment.serviceId === identity.serviceId, 'effective evidence service ID mismatch'],
    [resolved.deploymentId === activeDeployment.id, 'resolved file config deployment ID mismatch'],
    [/^[0-9a-f]{40}$/.test(resolvedCommit), 'resolved file config commit is not exact'],
    [resolvedCommit === deploymentCommit(activeDeployment), 'resolved file config commit mismatch'],
    [normalizeRepository(resolved.repo) === identity.repository, 'resolved file config repository mismatch'],
    [normalizeConfigFile(resolved.configFile) === config.configFile, 'resolved Railway config file mismatch'],
    [String(resolved.resolvedAt || '').trim(), 'resolved file config timestamp is missing'],
    [resolvedManifest.healthcheckPath === config.healthcheckPath, 'resolved file healthcheck path mismatch'],
    [resolvedManifest.startCommand === config.startCommand, 'resolved file start command mismatch'],
    [resolvedMapping['deploy.healthcheckPath'] === '$.deploy.healthcheckPath', 'resolved healthcheck path is not proven file-managed'],
    [resolvedMapping['deploy.startCommand'] === '$.deploy.startCommand', 'resolved start command is not proven file-managed'],
  ];
  const failedEvidence = evidenceChecks.find(([ok]) => !ok);
  if (failedEvidence) {
    throw new Error(`EFFECTIVE_RAILWAY_CONFIG_UNVERIFIED: ${failedEvidence[1]}`);
  }
  validateEffectiveDeploymentMetadata(activeDeployment, {
    ...config,
    repository: identity.repository,
  });

  return {
    ...identity,
    configFile: config.configFile,
    healthcheckPath: config.healthcheckPath,
    startCommand: config.startCommand,
    configAuthority: 'committed railway.toml + resolved deployment metadata',
  };
}

export function validateRailwayTarget(data = {}, expected = {}, railwayConfigSource = '') {
  return validateRailwayEffectiveConfig(data, expected, railwayConfigSource);
}

export function validateDeploymentProvenance(deployment = {}, expected = {}) {
  const deploymentId = required(expected.deploymentId, 'expected deployment ID');
  const projectId = required(expected.projectId, 'expected Railway project ID');
  const environmentId = required(expected.environmentId, 'expected Railway environment ID');
  const serviceId = required(expected.serviceId, 'expected Railway service ID');
  const commit = validateExactGitSha(expected.commit, 'expected release commit');
  const status = String(deployment?.status || '').trim().toUpperCase();

  const checks = [
    [deployment.id === deploymentId, 'Railway deployment ID mismatch'],
    [deployment.projectId === projectId, 'Railway deployment project ID mismatch'],
    [deployment.environmentId === environmentId, 'Railway deployment environment ID mismatch'],
    [deployment.serviceId === serviceId, 'Railway deployment service ID mismatch'],
    [status === 'SUCCESS', `Railway deployment did not reach SUCCESS (status=${status || 'missing'})`],
    [deploymentCommit(deployment) === commit, 'Railway deployment commit metadata mismatch'],
  ];
  const failed = checks.find(([ok]) => !ok);
  if (failed) throw new Error(failed[1]);

  if (expected.configFile || expected.healthcheckPath || expected.startCommand) {
    validateEffectiveDeploymentMetadata(deployment, {
      ...expectedRailwayConfig(expected),
      repository: expected.repository,
    });
  }

  return { deploymentId, status, commit };
}

function buildCommit(json = {}) {
  return String(json?.build?.commitFull || json?.build?.commit || '').trim().toLowerCase();
}

export function validateRuntimeGate(probes = {}, expected = {}) {
  const commit = validateExactGitSha(expected.commit, 'expected release commit');
  const requiredProbes = [
    ['/health', probes.health],
    ['/health/ready', probes.readiness],
    ['/api/version', probes.version],
  ];

  for (const [path, probe] of requiredProbes) {
    if (probe?.status !== 200 || probe?.json?.ok !== true) {
      throw new Error(`${path} must return HTTP 200 with JSON ok=true`);
    }
    const observedCommit = buildCommit(probe.json);
    if (observedCommit && observedCommit !== commit) {
      throw new Error(`${path} build commit mismatch`);
    }
  }

  const versionCommit = buildCommit(probes.version?.json);
  if (versionCommit !== commit) throw new Error('/api/version build commit mismatch');
  const observedReleaseType = releaseType(probes.version?.json?.build?.releaseType);
  if (!ALLOWED_RUNTIME_RELEASE_TYPES.has(observedReleaseType)) {
    throw new Error('/api/version build release type must be backend or full-stack');
  }

  return { commit, releaseType: observedReleaseType };
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 30_000) {
  return fetch(url, {
    ...options,
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function railwayGraphql({
  token,
  query,
  variables = {},
  endpoint = RAILWAY_GRAPHQL_URL,
  fetchImpl = fetchWithTimeout,
} = {}) {
  const projectToken = required(token, 'RAILWAY_PROJECT_TOKEN');
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Project-Access-Token': projectToken,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(`Railway GraphQL request failed with HTTP ${response.status}`);
  }
  const body = await response.json();
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    const messages = body.errors.map(error => String(error?.message || 'GraphQL error').slice(0, 200));
    throw new Error(`Railway GraphQL error: ${messages.join('; ')}`);
  }
  if (!body?.data) throw new Error('Railway GraphQL response did not include data');
  return body.data;
}

export async function validateAndTriggerRailwayDeployment({
  token,
  targetData,
  expected,
  railwayConfigSource,
  graphql = railwayGraphql,
} = {}) {
  const commit = validateExactGitSha(expected?.commit, 'expected release commit');
  const target = validateRailwayTarget(targetData, expected, railwayConfigSource);
  const deploymentData = await graphql({
    token,
    query: DEPLOY_EXACT_COMMIT_MUTATION,
    variables: {
      environmentId: target.environmentId,
      serviceId: target.serviceId,
      commitSha: commit,
    },
  });
  const deploymentId = required(
    deploymentData?.serviceInstanceDeployV2,
    'Railway exact-SHA deployment ID',
  );
  return { deploymentId, target };
}

function parseArgs(argv) {
  const args = {
    expectedCommit: process.env.EXPECTED_RELEASE_COMMIT || process.env.GITHUB_SHA || '',
    projectId: process.env.RAILWAY_PROJECT_ID || '',
    environmentId: process.env.RAILWAY_ENVIRONMENT_ID || '',
    serviceId: process.env.RAILWAY_SERVICE_ID || '',
    serviceName: process.env.RAILWAY_SERVICE_NAME || '',
    repository: process.env.RAILWAY_EXPECTED_REPOSITORY || process.env.GITHUB_REPOSITORY || '',
    branch: process.env.RAILWAY_EXPECTED_BRANCH || 'main',
    apiBaseUrl: process.env.PRODUCTION_API_URL || '',
    requestedReleaseType: process.env.RELEASE_TYPE || '',
    pollTimeoutMs: 20 * 60_000,
    pollIntervalMs: 10_000,
    runtimeAttempts: 30,
    runtimeIntervalMs: 5_000,
  };

  const valueArgs = new Map([
    ['--expected-commit', 'expectedCommit'],
    ['--project-id', 'projectId'],
    ['--environment-id', 'environmentId'],
    ['--service-id', 'serviceId'],
    ['--service-name', 'serviceName'],
    ['--repository', 'repository'],
    ['--branch', 'branch'],
    ['--api-base-url', 'apiBaseUrl'],
    ['--release-type', 'requestedReleaseType'],
    ['--poll-timeout-ms', 'pollTimeoutMs'],
    ['--poll-interval-ms', 'pollIntervalMs'],
    ['--runtime-attempts', 'runtimeAttempts'],
    ['--runtime-interval-ms', 'runtimeIntervalMs'],
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const key = valueArgs.get(argv[index]);
    if (!key) throw new Error(`Unknown argument: ${argv[index]}`);
    args[key] = argv[++index] || '';
  }

  for (const key of ['pollTimeoutMs', 'pollIntervalMs', 'runtimeAttempts', 'runtimeIntervalMs']) {
    args[key] = Number(args[key]);
    if (!Number.isInteger(args[key]) || args[key] <= 0) throw new Error(`${key} must be a positive integer`);
  }
  return args;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function pollDeployment({ token, deploymentId, expected, timeoutMs, intervalMs }) {
  const deadline = Date.now() + timeoutMs;
  let previousStatus = '';
  while (Date.now() < deadline) {
    const data = await railwayGraphql({
      token,
      query: DEPLOYMENT_QUERY,
      variables: { id: deploymentId },
    });
    const deployment = data?.deployment;
    if (!deployment?.id) throw new Error('Railway deployment query returned no deployment');
    const status = String(deployment.status || '').trim().toUpperCase();
    if (status !== previousStatus) {
      console.log(`[railway-backend-release] deployment status=${status || 'missing'}`);
      previousStatus = status;
    }
    if (status === 'SUCCESS') {
      validateDeploymentProvenance(deployment, { ...expected, deploymentId });
      return deployment;
    }
    if (TERMINAL_FAILURE_STATUSES.has(status)) {
      throw new Error(`Railway deployment ended with status=${status}`);
    }
    await sleep(intervalMs);
  }
  throw new Error('timed out waiting for the exact-SHA Railway deployment');
}

async function jsonProbe(baseUrl, path) {
  try {
    const response = await fetchWithTimeout(`${baseUrl}${path}`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
    }, 15_000);
    let json = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    return { status: response.status, json };
  } catch {
    return { status: null, json: null };
  }
}

async function pollRuntime({ apiBaseUrl, expectedCommit, attempts, intervalMs }) {
  let lastError = new Error('runtime gate was not attempted');
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const [health, readiness, version] = await Promise.all([
      jsonProbe(apiBaseUrl, '/health'),
      jsonProbe(apiBaseUrl, '/health/ready'),
      jsonProbe(apiBaseUrl, '/api/version'),
    ]);
    try {
      const result = validateRuntimeGate({ health, readiness, version }, { commit: expectedCommit });
      console.log(`[railway-backend-release] runtime gate PASS attempt=${attempt}`);
      return result;
    } catch (error) {
      lastError = error;
      console.log(`[railway-backend-release] runtime gate pending attempt=${attempt}`);
    }
    const backoffMs = Math.min(intervalMs * (2 ** Math.floor((attempt - 1) / 3)), 30_000);
    if (attempt < attempts) await sleep(backoffMs);
  }
  throw new Error(`BACKEND_HEALTH_GATE_FAILED: ${lastError.message}`);
}

async function appendSummary(lines) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (!summaryPath) return;
  await appendFile(summaryPath, `${lines.join('\n')}\n`, 'utf8');
}

async function appendOutput(name, value) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;
  await appendFile(outputPath, `${name}=${value}\n`, 'utf8');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const context = validateExecutionContext({
    expectedCommit: args.expectedCommit,
    expectedRepository: args.repository,
    expectedBranch: args.branch,
    requestedReleaseType: args.requestedReleaseType,
  });
  const token = required(process.env.RAILWAY_PROJECT_TOKEN, 'RAILWAY_PROJECT_TOKEN');
  const projectId = required(args.projectId, 'RAILWAY_PROJECT_ID');
  const environmentId = required(args.environmentId, 'RAILWAY_ENVIRONMENT_ID');
  const serviceId = required(args.serviceId, 'RAILWAY_SERVICE_ID');
  const apiBaseUrl = normalizeUrl(required(args.apiBaseUrl, 'PRODUCTION_API_URL'));

  console.log(`[railway-backend-release] exact commit=${context.commit}`);
  console.log(`[railway-backend-release] release type=${context.requestedType}`);

  const targetData = await railwayGraphql({
    token,
    query: RELEASE_TARGET_QUERY,
    variables: { environmentId, serviceId },
  });
  const railwayConfigSource = await readFile(
    new URL('../server/railway.toml', import.meta.url),
    'utf8',
  );
  const { deploymentId, target } = await validateAndTriggerRailwayDeployment({
    token,
    targetData,
    railwayConfigSource,
    expected: {
      commit: context.commit,
      projectId,
      environmentId,
      serviceId,
      serviceName: args.serviceName,
      repository: context.repository,
    },
  });
  console.log('[railway-backend-release] target identity and effective config PASS');
  console.log(`[railway-backend-release] deployment id=${deploymentId}`);
  await appendOutput('deployment_id', deploymentId);
  await appendSummary([
    '### Railway backend deployment trigger',
    '',
    `- deployment ID: \`${deploymentId}\``,
    `- requested exact commit: \`${context.commit}\``,
    '- verification: `PENDING`',
  ]);

  await pollDeployment({
    token,
    deploymentId,
    expected: { ...target, commit: context.commit },
    timeoutMs: args.pollTimeoutMs,
    intervalMs: args.pollIntervalMs,
  });
  const runtime = await pollRuntime({
    apiBaseUrl,
    expectedCommit: context.commit,
    attempts: args.runtimeAttempts,
    intervalMs: args.runtimeIntervalMs,
  });

  await appendOutput('backend_commit', runtime.commit);
  await appendOutput('backend_release_type', runtime.releaseType);
  await appendSummary([
    '### Railway backend release',
    '',
    `- result: \`PASS\``,
    `- deployment ID: \`${deploymentId}\``,
    `- project ID: \`${target.projectId}\``,
    `- environment ID: \`${target.environmentId}\``,
    `- service ID: \`${target.serviceId}\``,
    `- exact commit: \`${runtime.commit}\``,
    `- runtime release type: \`${runtime.releaseType}\``,
    '- gates: Railway SUCCESS + deployment provenance + `/health` + `/health/ready` + `/api/version`',
  ]);
  console.log('[railway-backend-release] PASS');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(`[railway-backend-release] FAIL: ${error.message}`);
    process.exit(1);
  });
}
