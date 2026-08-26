#!/usr/bin/env node

import { appendFile } from 'node:fs/promises';
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

export function validateRailwayTarget(data = {}, expected = {}) {
  const projectId = required(expected.projectId, 'expected Railway project ID');
  const environmentId = required(expected.environmentId, 'expected Railway environment ID');
  const serviceId = required(expected.serviceId, 'expected Railway service ID');
  const repository = normalizeRepository(required(expected.repository, 'expected Railway repository'));
  const rootDirectory = normalizeRootDirectory(expected.rootDirectory || 'server');
  const healthcheckPath = String(expected.healthcheckPath || '/health').trim();
  const startCommand = String(expected.startCommand || 'node scripts/start-with-release-type.cjs').trim();
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
    [String(instance.healthcheckPath || '').trim() === healthcheckPath, 'Railway healthcheck path mismatch'],
    [String(instance.startCommand || '').trim() === startCommand, 'Railway start command mismatch'],
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
    healthcheckPath,
    startCommand,
  };
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
  const target = validateRailwayTarget(targetData, {
    projectId,
    environmentId,
    serviceId,
    serviceName: args.serviceName,
    repository: context.repository,
  });
  console.log('[railway-backend-release] target identity PASS');

  const deploymentData = await railwayGraphql({
    token,
    query: DEPLOY_EXACT_COMMIT_MUTATION,
    variables: {
      environmentId,
      serviceId,
      commitSha: context.commit,
    },
  });
  const deploymentId = required(
    deploymentData?.serviceInstanceDeployV2,
    'Railway exact-SHA deployment ID',
  );
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
    expected: { projectId, environmentId, serviceId, commit: context.commit },
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
