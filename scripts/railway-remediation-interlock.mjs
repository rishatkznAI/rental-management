#!/usr/bin/env node

import { fileURLToPath } from 'node:url';

export const RAILWAY_GRAPHQL_URL = 'https://backboard.railway.com/graphql/v2';
export const NONTERMINAL_DEPLOYMENT_STATUSES = Object.freeze([
  'BUILDING',
  'DEPLOYING',
  'INITIALIZING',
  'NEEDS_APPROVAL',
  'QUEUED',
  'REMOVING',
  'WAITING',
]);
export const TERMINAL_DEPLOYMENT_STATUSES = Object.freeze([
  'CRASHED',
  'FAILED',
  'REMOVED',
  'SKIPPED',
  'SLEEPING',
  'SUCCESS',
]);

export const RAILWAY_REMEDIATION_INTERLOCK_QUERY = `
  query RailwayRemediationInterlock(
    $projectId: String!
    $environmentId: String!
    $serviceId: String!
    $deploymentInput: DeploymentListInput!
    $connectionLimit: Int!
  ) {
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
      id
      environmentId
      serviceId
      serviceName
      rootDirectory
      railwayConfigFile
      healthcheckPath
      startCommand
      preDeployCommand
      source {
        repo
        image
      }
      latestDeployment {
        id
        projectId
        environmentId
        serviceId
        status
        deploymentStopped
        meta
        instances {
          id
          status
        }
      }
      activeDeployments {
        id
        projectId
        environmentId
        serviceId
        status
        deploymentStopped
        meta
        instances {
          id
          status
        }
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
    serviceInstanceAutoDeployStatus(
      projectId: $projectId
      environmentId: $environmentId
      serviceId: $serviceId
    ) {
      enabled
    }
    deploymentTriggers(
      projectId: $projectId
      environmentId: $environmentId
      serviceId: $serviceId
      first: $connectionLimit
    ) {
      edges {
        node {
          id
          projectId
          environmentId
          serviceId
          provider
          repository
          branch
          checkSuites
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
    nonterminalDeployments: deployments(
      input: $deploymentInput
      first: $connectionLimit
    ) {
      edges {
        node {
          id
          projectId
          environmentId
          serviceId
          status
        }
      }
      pageInfo {
        hasNextPage
        endCursor
      }
    }
  }
`;

const SHA40_PATTERN = /^[a-f0-9]{40}$/;
const CONNECTION_LIMIT = 100;
const DEFAULT_ROOT_DIRECTORY = 'server';
const DEFAULT_CONFIG_FILE = 'server/railway.toml';
const DEFAULT_HEALTHCHECK_PATH = '/health';
const DEFAULT_START_COMMAND = 'node scripts/start-with-release-type.cjs';

function required(value, label) {
  const normalized = String(value || '').trim();
  if (!normalized) throw new Error(`${label} is required`);
  return normalized;
}

function exactSha(value, label = 'expected deployed SHA') {
  const normalized = required(value, label);
  if (!SHA40_PATTERN.test(normalized)) {
    throw new Error(`${label} must be an exact lowercase 40-character Git SHA`);
  }
  return normalized;
}

function normalizeRepository(value) {
  return required(value, 'expected Railway repository')
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\.git$/i, '')
    .replace(/^\/+|\/+$/g, '')
    .toLowerCase();
}

function normalizeRootDirectory(value) {
  return required(value, 'expected Railway root directory').replace(/^\/+|\/+$/g, '');
}

function normalizeConfigFile(value) {
  return required(value, 'expected Railway config file')
    .replace(/\\/g, '/')
    .replace(/^\/+|\/+$/g, '');
}

function optionalNormalizedConfigFile(value) {
  const normalized = String(value || '').trim();
  return normalized ? normalizeConfigFile(normalized) : null;
}

function objectValue(value, label) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value === 'string' && value.trim()) {
    let parsed;
    try {
      parsed = JSON.parse(value);
    } catch {
      throw new Error(`${label} is not valid JSON`);
    }
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
  }
  throw new Error(`${label} is missing or invalid`);
}

function nullableObjectValue(value) {
  if (value === undefined || value === null || value === '') return {};
  return objectValue(value, 'Railway configuration object');
}

function isAbsentCommand(value) {
  return value === undefined
    || value === null
    || (typeof value === 'string' && value.trim() === '')
    || (Array.isArray(value) && value.length === 0);
}

function assertEqual(actual, expected, label) {
  if (actual !== expected) throw new Error(`${label} mismatch`);
}

function connectionEdges(connection, label) {
  if (!connection || typeof connection !== 'object' || Array.isArray(connection)) {
    throw new Error(`${label} connection is missing`);
  }
  if (!Array.isArray(connection.edges)) throw new Error(`${label} edges are missing`);
  if (connection.pageInfo?.hasNextPage !== false) {
    throw new Error(`${label} query was not exhaustive`);
  }
  return connection.edges.map((edge) => {
    if (!edge?.node || typeof edge.node !== 'object' || Array.isArray(edge.node)) {
      throw new Error(`${label} returned an invalid edge`);
    }
    return edge.node;
  });
}

function effectiveDeployValues(value) {
  const manifest = nullableObjectValue(value);
  const deploy = nullableObjectValue(manifest.deploy);
  return {
    healthcheckPath: String(deploy.healthcheckPath || '').trim(),
    startCommand: String(deploy.startCommand || '').trim(),
    preDeployCommand: deploy.preDeployCommand,
  };
}

function assertEffectiveDeployValues(values, expected, label) {
  assertEqual(values.healthcheckPath, expected.healthcheckPath, `${label} healthcheck path`);
  assertEqual(values.startCommand, expected.startCommand, `${label} start command`);
  if (!isAbsentCommand(values.preDeployCommand)) {
    throw new Error(`${label} pre-deploy command must be absent`);
  }
}

function deploymentCommit(deployment) {
  const meta = objectValue(deployment?.meta, 'Railway deployment metadata');
  return String(meta.commitHash || '').trim().toLowerCase();
}

function validateDeployment(deployment, expected, label) {
  if (!deployment || typeof deployment !== 'object' || Array.isArray(deployment)) {
    throw new Error(`${label} is missing`);
  }
  const deploymentId = required(deployment.id, `${label} ID`);
  assertEqual(deployment.projectId, expected.projectId, `${label} project ID`);
  assertEqual(deployment.environmentId, expected.environmentId, `${label} environment ID`);
  assertEqual(deployment.serviceId, expected.serviceId, `${label} service ID`);
  assertEqual(String(deployment.status || '').trim().toUpperCase(), 'SUCCESS', `${label} status`);
  assertEqual(deployment.deploymentStopped, false, `${label} stopped flag`);
  assertEqual(deploymentCommit(deployment), expected.commit, `${label} commit SHA`);

  const meta = objectValue(deployment.meta, `${label} metadata`);
  assertEqual(normalizeRepository(meta.repo), expected.repository, `${label} repository`);
  assertEqual(String(meta.branch || '').trim(), expected.branch, `${label} branch`);
  assertEqual(normalizeRootDirectory(meta.rootDirectory), expected.rootDirectory, `${label} root directory`);
  assertEqual(normalizeConfigFile(meta.configFile), expected.configFile, `${label} config file`);
  assertEffectiveDeployValues(
    effectiveDeployValues(meta.fileServiceManifest),
    expected,
    `${label} file-managed config`,
  );
  assertEffectiveDeployValues(
    effectiveDeployValues(meta.serviceManifest),
    expected,
    `${label} resolved config`,
  );
  const mapping = nullableObjectValue(meta.propertyFileMapping);
  assertEqual(
    mapping['deploy.healthcheckPath'],
    '$.deploy.healthcheckPath',
    `${label} healthcheck file authority`,
  );
  assertEqual(
    mapping['deploy.startCommand'],
    '$.deploy.startCommand',
    `${label} start-command file authority`,
  );
  if (Object.hasOwn(mapping, 'deploy.preDeployCommand')) {
    throw new Error(`${label} pre-deploy command unexpectedly has file authority`);
  }

  if (!Array.isArray(deployment.instances) || deployment.instances.length !== 1) {
    throw new Error(`${label} must have exactly one deployment instance`);
  }
  const instance = deployment.instances[0];
  const instanceId = required(instance?.id, `${label} deployment-instance ID`);
  assertEqual(String(instance?.status || '').trim().toUpperCase(), 'RUNNING', `${label} instance status`);
  return { deploymentId, instanceId };
}

function normalizeExpected(expected = {}) {
  return {
    commit: exactSha(expected.commit),
    projectId: required(expected.projectId, 'expected Railway project ID'),
    environmentId: required(expected.environmentId, 'expected Railway environment ID'),
    serviceId: required(expected.serviceId, 'expected Railway service ID'),
    serviceName: required(expected.serviceName, 'expected Railway service name'),
    repository: normalizeRepository(expected.repository),
    branch: required(expected.branch || 'main', 'expected Railway source branch'),
    rootDirectory: normalizeRootDirectory(expected.rootDirectory || DEFAULT_ROOT_DIRECTORY),
    configFile: normalizeConfigFile(expected.configFile || DEFAULT_CONFIG_FILE),
    healthcheckPath: required(
      expected.healthcheckPath || DEFAULT_HEALTHCHECK_PATH,
      'expected Railway healthcheck path',
    ),
    startCommand: required(
      expected.startCommand || DEFAULT_START_COMMAND,
      'expected Railway start command',
    ),
  };
}

export function canonicalJson(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON cannot contain a non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => (
      `${JSON.stringify(key)}:${canonicalJson(value[key])}`
    )).join(',')}}`;
  }
  throw new Error('canonical JSON contains an unsupported value');
}

export function buildInterlockVariables(expected = {}) {
  const target = normalizeExpected(expected);
  return {
    projectId: target.projectId,
    environmentId: target.environmentId,
    serviceId: target.serviceId,
    connectionLimit: CONNECTION_LIMIT,
    deploymentInput: {
      projectId: target.projectId,
      environmentId: target.environmentId,
      serviceId: target.serviceId,
      includeDeleted: true,
      status: { notIn: [...TERMINAL_DEPLOYMENT_STATUSES] },
    },
  };
}

export function validateRailwayRemediationInterlock(data = {}, expected = {}) {
  const target = normalizeExpected(expected);
  const projectToken = data?.projectToken;
  const service = data?.service;
  const serviceInstance = data?.serviceInstance;
  if (!projectToken || !service || !serviceInstance) {
    throw new Error('Railway target identity is incomplete');
  }

  assertEqual(projectToken.projectId, target.projectId, 'project-token project ID');
  assertEqual(projectToken.environmentId, target.environmentId, 'project-token environment ID');
  assertEqual(service.id, target.serviceId, 'service ID');
  assertEqual(service.projectId, target.projectId, 'service project ID');
  assertEqual(service.name, target.serviceName, 'service name');
  assertEqual(serviceInstance.environmentId, target.environmentId, 'service-instance environment ID');
  assertEqual(serviceInstance.serviceId, target.serviceId, 'service-instance service ID');
  assertEqual(serviceInstance.serviceName, target.serviceName, 'service-instance name');
  const serviceInstanceId = required(serviceInstance.id, 'service-instance ID');

  const source = serviceInstance.source;
  if (!source || typeof source !== 'object' || Array.isArray(source)) {
    throw new Error('Railway connected source is missing');
  }
  assertEqual(normalizeRepository(source.repo), target.repository, 'connected source repository');
  if (String(source.image || '').trim()) {
    throw new Error('Railway service must use the connected Git source, not an image');
  }
  assertEqual(
    normalizeRootDirectory(serviceInstance.rootDirectory),
    target.rootDirectory,
    'service-instance root directory',
  );
  const rawConfigFile = optionalNormalizedConfigFile(serviceInstance.railwayConfigFile);
  if (rawConfigFile !== null) {
    assertEqual(rawConfigFile, target.configFile, 'service-instance config file');
  }
  const rawHealthcheckPath = String(serviceInstance.healthcheckPath || '').trim();
  if (rawHealthcheckPath) {
    assertEqual(rawHealthcheckPath, target.healthcheckPath, 'service-instance healthcheck path');
  }
  const rawStartCommand = String(serviceInstance.startCommand || '').trim();
  if (rawStartCommand) {
    assertEqual(rawStartCommand, target.startCommand, 'service-instance start command');
  }
  if (!isAbsentCommand(serviceInstance.preDeployCommand)) {
    throw new Error('service-instance pre-deploy command must be absent');
  }

  if (data?.serviceInstanceAutoDeployStatus?.enabled !== false) {
    throw new Error('Railway native autodeploy must be explicitly disabled');
  }

  const triggerNodes = connectionEdges(data.deploymentTriggers, 'deployment trigger');
  if (triggerNodes.length > 1) {
    throw new Error('Railway target has ambiguous multiple deployment triggers');
  }
  const deploymentTriggers = triggerNodes.map((trigger) => {
    assertEqual(trigger.projectId, target.projectId, 'deployment-trigger project ID');
    assertEqual(trigger.environmentId, target.environmentId, 'deployment-trigger environment ID');
    assertEqual(trigger.serviceId, target.serviceId, 'deployment-trigger service ID');
    assertEqual(normalizeRepository(trigger.repository), target.repository, 'deployment-trigger repository');
    assertEqual(String(trigger.branch || '').trim(), target.branch, 'deployment-trigger branch');
    const provider = required(trigger.provider, 'deployment-trigger provider').toLowerCase();
    assertEqual(provider, 'github', 'deployment-trigger provider');
    const id = required(trigger.id, 'deployment-trigger ID');
    if (typeof trigger.checkSuites !== 'boolean') {
      throw new Error('deployment-trigger check-suites state is invalid');
    }
    return {
      branch: target.branch,
      checkSuites: trigger.checkSuites,
      id,
      provider,
      repository: target.repository,
    };
  }).sort((left, right) => left.id.localeCompare(right.id));

  const nonterminalDeployments = connectionEdges(
    data.nonterminalDeployments,
    'nonterminal deployment',
  );
  for (const deployment of nonterminalDeployments) {
    assertEqual(deployment.projectId, target.projectId, 'nonterminal deployment project ID');
    assertEqual(deployment.environmentId, target.environmentId, 'nonterminal deployment environment ID');
    assertEqual(deployment.serviceId, target.serviceId, 'nonterminal deployment service ID');
    const status = String(deployment.status || '').trim().toUpperCase();
    if (!NONTERMINAL_DEPLOYMENT_STATUSES.includes(status)) {
      throw new Error('nonterminal deployment query returned an unexpected status');
    }
  }
  if (nonterminalDeployments.length !== 0) {
    throw new Error(`Railway target has ${nonterminalDeployments.length} nonterminal deployment(s)`);
  }

  const latest = validateDeployment(serviceInstance.latestDeployment, target, 'latest deployment');
  if (!Array.isArray(serviceInstance.activeDeployments)
      || serviceInstance.activeDeployments.length !== 1) {
    throw new Error('Railway target must have exactly one active deployment');
  }
  const active = validateDeployment(
    serviceInstance.activeDeployments[0],
    target,
    'active deployment',
  );
  assertEqual(active.deploymentId, latest.deploymentId, 'active/latest deployment ID');
  assertEqual(active.instanceId, latest.instanceId, 'active/latest deployment-instance ID');

  const resolved = serviceInstance.resolvedFileConfig;
  if (!resolved || typeof resolved !== 'object' || Array.isArray(resolved)) {
    throw new Error('resolved Railway file configuration is missing');
  }
  assertEqual(String(resolved.commitHash || '').trim().toLowerCase(), target.commit, 'resolved config commit');
  assertEqual(resolved.deploymentId, latest.deploymentId, 'resolved config deployment ID');
  assertEqual(normalizeRepository(resolved.repo), target.repository, 'resolved config repository');
  assertEqual(normalizeConfigFile(resolved.configFile), target.configFile, 'resolved config file');
  required(resolved.resolvedAt, 'resolved config timestamp');
  assertEffectiveDeployValues(
    effectiveDeployValues(resolved.fileManifest),
    target,
    'resolved file manifest',
  );
  const resolvedMapping = nullableObjectValue(resolved.propertyFileMapping);
  assertEqual(
    resolvedMapping['deploy.healthcheckPath'],
    '$.deploy.healthcheckPath',
    'resolved healthcheck file authority',
  );
  assertEqual(
    resolvedMapping['deploy.startCommand'],
    '$.deploy.startCommand',
    'resolved start-command file authority',
  );
  if (Object.hasOwn(resolvedMapping, 'deploy.preDeployCommand')) {
    throw new Error('resolved pre-deploy command unexpectedly has file authority');
  }

  return {
    autoDeploy: { enabled: false },
    config: {
      configFile: target.configFile,
      healthcheckPath: target.healthcheckPath,
      preDeployCommand: null,
      rootDirectory: target.rootDirectory,
      startCommand: target.startCommand,
    },
    deployment: {
      activeDeploymentCount: 1,
      commitSha: target.commit,
      deploymentId: latest.deploymentId,
      deploymentInstanceId: latest.instanceId,
      nonterminalDeploymentCount: 0,
      status: 'SUCCESS',
    },
    deploymentTriggers,
    environmentId: target.environmentId,
    projectId: target.projectId,
    repository: target.repository,
    schemaVersion: 1,
    service: {
      id: target.serviceId,
      instanceId: serviceInstanceId,
      name: target.serviceName,
    },
    status: 'PASS',
  };
}

export async function railwayGraphqlReadOnly({
  token,
  query = RAILWAY_REMEDIATION_INTERLOCK_QUERY,
  variables,
  endpoint = RAILWAY_GRAPHQL_URL,
  timeoutMs = 30_000,
  fetchImpl = fetch,
} = {}) {
  const projectToken = required(token, 'RAILWAY_PROJECT_TOKEN');
  if (projectToken.includes('\n') || projectToken.includes('\r')) {
    throw new Error('RAILWAY_PROJECT_TOKEN must not contain a line break');
  }
  if (endpoint !== RAILWAY_GRAPHQL_URL) throw new Error('unexpected Railway GraphQL endpoint');
  if (!/^\s*query\b/.test(query) || /\bmutation\b/i.test(query)) {
    throw new Error('Railway remediation interlock permits only a read-only GraphQL query');
  }
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 120_000) {
    throw new Error('Railway GraphQL timeout must be an integer from 1 to 120000 milliseconds');
  }
  const response = await fetchImpl(endpoint, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Project-Access-Token': projectToken,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response?.ok) {
    throw new Error(`Railway GraphQL request failed with HTTP ${response?.status || 'unknown'}`);
  }
  const body = await response.json();
  if (Array.isArray(body?.errors) && body.errors.length > 0) {
    const messages = body.errors.map(error => String(error?.message || 'GraphQL error').slice(0, 160));
    throw new Error(`Railway GraphQL error: ${messages.join('; ')}`);
  }
  if (!body?.data || typeof body.data !== 'object' || Array.isArray(body.data)) {
    throw new Error('Railway GraphQL response did not include data');
  }
  return body.data;
}

export function parseArgs(argv = [], env = process.env) {
  const args = {
    commit: env.EXPECTED_DEPLOYED_SHA || env.EXPECTED_RELEASE_COMMIT || env.GITHUB_SHA || '',
    projectId: env.RAILWAY_PROJECT_ID || '',
    environmentId: env.RAILWAY_ENVIRONMENT_ID || '',
    serviceId: env.RAILWAY_SERVICE_ID || '',
    serviceName: env.RAILWAY_SERVICE_NAME || '',
    repository: env.RAILWAY_EXPECTED_REPOSITORY || env.GITHUB_REPOSITORY || '',
    branch: env.RAILWAY_SOURCE_BRANCH || env.RAILWAY_EXPECTED_BRANCH || 'main',
    rootDirectory: env.RAILWAY_SOURCE_ROOT_DIRECTORY || DEFAULT_ROOT_DIRECTORY,
    configFile: env.RAILWAY_CONFIG_FILE || DEFAULT_CONFIG_FILE,
    healthcheckPath: env.RAILWAY_HEALTHCHECK_PATH || DEFAULT_HEALTHCHECK_PATH,
    startCommand: env.RAILWAY_START_COMMAND || DEFAULT_START_COMMAND,
    timeoutMs: Number(env.RAILWAY_INTERLOCK_TIMEOUT_MS || 30_000),
  };
  const valueArgs = new Map([
    ['--expected-deployed-sha', 'commit'],
    ['--expected-commit', 'commit'],
    ['--expected-sha', 'commit'],
    ['--project-id', 'projectId'],
    ['--environment-id', 'environmentId'],
    ['--service-id', 'serviceId'],
    ['--service-name', 'serviceName'],
    ['--repository', 'repository'],
    ['--branch', 'branch'],
    ['--root-directory', 'rootDirectory'],
    ['--config-file', 'configFile'],
    ['--healthcheck-path', 'healthcheckPath'],
    ['--start-command', 'startCommand'],
    ['--request-timeout-ms', 'timeoutMs'],
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const key = valueArgs.get(argv[index]);
    if (!key) throw new Error(`Unknown argument: ${argv[index]}`);
    if (index + 1 >= argv.length) throw new Error(`Missing value for argument: ${argv[index]}`);
    args[key] = argv[index + 1];
    index += 1;
  }
  args.timeoutMs = Number(args.timeoutMs);
  if (!Number.isInteger(args.timeoutMs) || args.timeoutMs <= 0 || args.timeoutMs > 120_000) {
    throw new Error('request timeout must be an integer from 1 to 120000 milliseconds');
  }
  normalizeExpected(args);
  return args;
}

function projectTokenFromEnv(env = process.env) {
  const primary = String(env.RAILWAY_PROJECT_TOKEN || '').trim();
  const compatibility = String(env.RAILWAY_TOKEN || '').trim();
  if (primary && compatibility && primary !== compatibility) {
    throw new Error('RAILWAY_PROJECT_TOKEN and RAILWAY_TOKEN disagree');
  }
  return required(primary || compatibility, 'RAILWAY_PROJECT_TOKEN');
}

export async function runRailwayRemediationInterlock({
  args,
  token,
  graphql = railwayGraphqlReadOnly,
} = {}) {
  const expected = normalizeExpected(args);
  const data = await graphql({
    token,
    query: RAILWAY_REMEDIATION_INTERLOCK_QUERY,
    variables: buildInterlockVariables(expected),
    timeoutMs: args.timeoutMs,
  });
  return validateRailwayRemediationInterlock(data, expected);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const token = projectTokenFromEnv();
  const proof = await runRailwayRemediationInterlock({ args, token });
  process.stdout.write(`${canonicalJson(proof)}\n`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((error) => {
    process.stderr.write(`[railway-remediation-interlock] ${String(error?.message || error)}\n`);
    process.exitCode = 1;
  });
}
