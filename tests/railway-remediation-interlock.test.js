import test from 'node:test';
import assert from 'node:assert/strict';

import {
  NONTERMINAL_DEPLOYMENT_STATUSES,
  RAILWAY_GRAPHQL_URL,
  RAILWAY_REMEDIATION_INTERLOCK_QUERY,
  TERMINAL_DEPLOYMENT_STATUSES,
  buildInterlockVariables,
  canonicalJson,
  parseArgs,
  railwayGraphqlReadOnly,
  runRailwayRemediationInterlock,
  validateRailwayRemediationInterlock,
} from '../scripts/railway-remediation-interlock.mjs';

const expected = Object.freeze({
  commit: '5f071fc531c870fa2422320efe64bc83cafe509e',
  projectId: '1558b38d-bf16-4b50-9ee6-0871b7152116',
  environmentId: '62833109-61cb-4600-9200-d624d6537a05',
  serviceId: 'b2016e92-3c50-4b00-800d-625a139b219c',
  serviceName: 'rental-management',
  repository: 'rishatkznAI/rental-management',
  branch: 'main',
  rootDirectory: '/server',
  configFile: '/server/railway.toml',
  healthcheckPath: '/health',
  startCommand: 'node scripts/start-with-release-type.cjs',
});

const deploymentId = '11111111-1111-4111-8111-111111111111';
const deploymentInstanceId = '22222222-2222-4222-8222-222222222222';
const serviceInstanceId = '33333333-3333-4333-8333-333333333333';

function deployValues(overrides = {}) {
  return {
    healthcheckPath: expected.healthcheckPath,
    startCommand: expected.startCommand,
    ...overrides,
  };
}

function deploymentFixture(overrides = {}) {
  return {
    id: deploymentId,
    projectId: expected.projectId,
    environmentId: expected.environmentId,
    serviceId: expected.serviceId,
    status: 'SUCCESS',
    deploymentStopped: false,
    meta: {
      commitHash: expected.commit,
      repo: expected.repository,
      branch: expected.branch,
      rootDirectory: expected.rootDirectory,
      configFile: expected.configFile,
      fileServiceManifest: { deploy: deployValues() },
      serviceManifest: { deploy: deployValues() },
      propertyFileMapping: {
        'deploy.healthcheckPath': '$.deploy.healthcheckPath',
        'deploy.startCommand': '$.deploy.startCommand',
      },
    },
    instances: [{ id: deploymentInstanceId, status: 'RUNNING' }],
    ...overrides,
  };
}

function fixture() {
  return {
    projectToken: {
      projectId: expected.projectId,
      environmentId: expected.environmentId,
    },
    service: {
      id: expected.serviceId,
      name: expected.serviceName,
      projectId: expected.projectId,
    },
    serviceInstance: {
      id: serviceInstanceId,
      environmentId: expected.environmentId,
      serviceId: expected.serviceId,
      serviceName: expected.serviceName,
      rootDirectory: expected.rootDirectory,
      railwayConfigFile: null,
      healthcheckPath: null,
      startCommand: null,
      preDeployCommand: null,
      source: { repo: expected.repository, image: null },
      latestDeployment: deploymentFixture(),
      activeDeployments: [deploymentFixture()],
      resolvedFileConfig: {
        commitHash: expected.commit,
        configFile: expected.configFile,
        deploymentId,
        fileManifest: { deploy: deployValues() },
        propertyFileMapping: {
          'deploy.healthcheckPath': '$.deploy.healthcheckPath',
          'deploy.startCommand': '$.deploy.startCommand',
        },
        repo: expected.repository,
        resolvedAt: '2026-09-04T08:00:00.000Z',
      },
    },
    serviceInstanceAutoDeployStatus: { enabled: false },
    deploymentTriggers: {
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
    nonterminalDeployments: {
      edges: [],
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
}

function mutateFixture(mutator) {
  const value = structuredClone(fixture());
  mutator(value);
  return value;
}

test('interlock query is read-only and requests every required control-plane boundary', () => {
  assert.match(RAILWAY_REMEDIATION_INTERLOCK_QUERY, /^\s*query\s+RailwayRemediationInterlock/);
  assert.doesNotMatch(RAILWAY_REMEDIATION_INTERLOCK_QUERY, /\bmutation\b/i);
  for (const field of [
    'projectToken',
    'service(id: $serviceId)',
    'serviceInstance(environmentId: $environmentId, serviceId: $serviceId)',
    'source {',
    'rootDirectory',
    'railwayConfigFile',
    'resolvedFileConfig',
    'latestDeployment',
    'activeDeployments',
    'serviceInstanceAutoDeployStatus(',
    'deploymentTriggers(',
    'nonterminalDeployments: deployments(',
  ]) {
    assert.equal(RAILWAY_REMEDIATION_INTERLOCK_QUERY.includes(field), true, field);
  }
});

test('deployment query negatively excludes only known terminal statuses', () => {
  assert.deepEqual(NONTERMINAL_DEPLOYMENT_STATUSES, [
    'BUILDING',
    'DEPLOYING',
    'INITIALIZING',
    'NEEDS_APPROVAL',
    'QUEUED',
    'REMOVING',
    'WAITING',
  ]);
  const variables = buildInterlockVariables(expected);
  assert.deepEqual(variables.deploymentInput, {
    projectId: expected.projectId,
    environmentId: expected.environmentId,
    serviceId: expected.serviceId,
    includeDeleted: true,
    status: { notIn: [...TERMINAL_DEPLOYMENT_STATUSES] },
  });
  assert.deepEqual(TERMINAL_DEPLOYMENT_STATUSES, [
    'CRASHED',
    'FAILED',
    'REMOVED',
    'SKIPPED',
    'SLEEPING',
    'SUCCESS',
  ]);
  assert.equal(variables.connectionLimit, 100);
});

test('stable exact target with disabled autodeploy emits only canonical stable proof fields', () => {
  const proof = validateRailwayRemediationInterlock(fixture(), expected);
  assert.deepEqual(proof, {
    autoDeploy: { enabled: false },
    config: {
      configFile: 'server/railway.toml',
      healthcheckPath: expected.healthcheckPath,
      preDeployCommand: null,
      rootDirectory: 'server',
      startCommand: expected.startCommand,
    },
    deployment: {
      activeDeploymentCount: 1,
      commitSha: expected.commit,
      deploymentId,
      deploymentInstanceId,
      nonterminalDeploymentCount: 0,
      status: 'SUCCESS',
    },
    deploymentTriggers: [],
    environmentId: expected.environmentId,
    projectId: expected.projectId,
    repository: expected.repository.toLowerCase(),
    schemaVersion: 1,
    service: {
      id: expected.serviceId,
      instanceId: serviceInstanceId,
      name: expected.serviceName,
    },
    status: 'PASS',
  });
  const serialized = canonicalJson(proof);
  assert.equal(serialized.includes('\n'), false);
  assert.equal(serialized.includes('resolvedAt'), false);
  assert.equal(serialized.includes('createdAt'), false);
  assert.deepEqual(JSON.parse(serialized), proof);
  assert.equal(canonicalJson({ z: 1, a: { y: 2, x: 3 } }), '{"a":{"x":3,"y":2},"z":1}');
});

test('one inert exact GitHub deployment trigger is retained deterministically', () => {
  const value = fixture();
  value.deploymentTriggers.edges.push({
    node: {
      id: 'trigger-1',
      projectId: expected.projectId,
      environmentId: expected.environmentId,
      serviceId: expected.serviceId,
      provider: 'GitHub',
      repository: expected.repository,
      branch: expected.branch,
      checkSuites: true,
    },
  });
  assert.deepEqual(validateRailwayRemediationInterlock(value, expected).deploymentTriggers, [{
    branch: 'main',
    checkSuites: true,
    id: 'trigger-1',
    provider: 'github',
    repository: expected.repository.toLowerCase(),
  }]);
});

test('identity, source, config, autodeploy, and trigger drift fail closed', () => {
  const cases = [
    ['project token', value => { value.projectToken.projectId = 'wrong'; }, /project-token project ID mismatch/],
    ['service', value => { value.service.id = 'wrong'; }, /service ID mismatch/],
    ['instance', value => { value.serviceInstance.id = ''; }, /service-instance ID is required/],
    ['repository', value => { value.serviceInstance.source.repo = 'other/repository'; }, /connected source repository mismatch/],
    ['image source', value => { value.serviceInstance.source.image = 'registry/image:latest'; }, /connected Git source/],
    ['root', value => { value.serviceInstance.rootDirectory = '/other'; }, /root directory mismatch/],
    ['raw config', value => { value.serviceInstance.railwayConfigFile = '/other.toml'; }, /config file mismatch/],
    ['raw healthcheck', value => { value.serviceInstance.healthcheckPath = '/wrong'; }, /healthcheck path mismatch/],
    ['raw start', value => { value.serviceInstance.startCommand = 'node wrong.js'; }, /start command mismatch/],
    ['raw predeploy', value => { value.serviceInstance.preDeployCommand = 'node migrate.js'; }, /pre-deploy command must be absent/],
    ['autodeploy enabled', value => { value.serviceInstanceAutoDeployStatus.enabled = true; }, /autodeploy must be explicitly disabled/],
    ['autodeploy unknown', value => { value.serviceInstanceAutoDeployStatus = null; }, /autodeploy must be explicitly disabled/],
    ['trigger page', value => { value.deploymentTriggers.pageInfo.hasNextPage = true; }, /query was not exhaustive/],
    ['trigger branch', value => {
      value.deploymentTriggers.edges = [{ node: {
        id: 'trigger-1',
        projectId: expected.projectId,
        environmentId: expected.environmentId,
        serviceId: expected.serviceId,
        provider: 'github',
        repository: expected.repository,
        branch: 'other',
        checkSuites: false,
      } }];
    }, /deployment-trigger branch mismatch/],
    ['trigger provider', value => {
      value.deploymentTriggers.edges = [{ node: {
        id: 'trigger-1',
        projectId: expected.projectId,
        environmentId: expected.environmentId,
        serviceId: expected.serviceId,
        provider: 'gitlab',
        repository: expected.repository,
        branch: expected.branch,
        checkSuites: false,
      } }];
    }, /deployment-trigger provider mismatch/],
    ['trigger provider', value => {
      value.deploymentTriggers.edges = [{ node: {
        id: 'trigger-1',
        projectId: expected.projectId,
        environmentId: expected.environmentId,
        serviceId: expected.serviceId,
        provider: 'other',
        repository: expected.repository,
        branch: expected.branch,
        checkSuites: false,
      } }];
    }, /deployment-trigger provider mismatch/],
    ['resolved config', value => { value.serviceInstance.resolvedFileConfig.configFile = '/wrong.toml'; }, /resolved config file mismatch/],
    ['resolved config authority', value => {
      delete value.serviceInstance.resolvedFileConfig.propertyFileMapping['deploy.startCommand'];
    }, /resolved start-command file authority mismatch/],
  ];
  for (const [label, mutate, pattern] of cases) {
    assert.throws(
      () => validateRailwayRemediationInterlock(mutateFixture(mutate), expected),
      pattern,
      label,
    );
  }
});

test('latest and active deployment must be the same exact stable successful runtime', () => {
  const cases = [
    ['latest status', value => { value.serviceInstance.latestDeployment.status = 'FAILED'; }, /latest deployment status mismatch/],
    ['latest SHA', value => { value.serviceInstance.latestDeployment.meta.commitHash = '0'.repeat(40); }, /latest deployment commit SHA mismatch/],
    ['latest stopped', value => { value.serviceInstance.latestDeployment.deploymentStopped = true; }, /latest deployment stopped flag mismatch/],
    ['latest instance', value => { value.serviceInstance.latestDeployment.instances = []; }, /exactly one deployment instance/],
    ['active count zero', value => { value.serviceInstance.activeDeployments = []; }, /exactly one active deployment/],
    ['active count two', value => { value.serviceInstance.activeDeployments.push(deploymentFixture({ id: 'other' })); }, /exactly one active deployment/],
    ['active identity', value => { value.serviceInstance.activeDeployments[0].id = 'other'; }, /active\/latest deployment ID mismatch/],
    ['active replica', value => { value.serviceInstance.activeDeployments[0].instances[0].id = 'other'; }, /deployment-instance ID mismatch/],
    ['deployment metadata branch', value => { value.serviceInstance.latestDeployment.meta.branch = 'other'; }, /latest deployment branch mismatch/],
    ['deployment config', value => {
      value.serviceInstance.latestDeployment.meta.serviceManifest.deploy.startCommand = 'node wrong.js';
    }, /latest deployment resolved config start command mismatch/],
  ];
  for (const [label, mutate, pattern] of cases) {
    assert.throws(
      () => validateRailwayRemediationInterlock(mutateFixture(mutate), expected),
      pattern,
      label,
    );
  }
});

test('every enumerated nonterminal deployment state blocks the interlock', () => {
  for (const status of NONTERMINAL_DEPLOYMENT_STATUSES) {
    const value = fixture();
    value.nonterminalDeployments.edges = [{ node: {
      id: `pending-${status}`,
      projectId: expected.projectId,
      environmentId: expected.environmentId,
      serviceId: expected.serviceId,
      status,
    } }];
    assert.throws(
      () => validateRailwayRemediationInterlock(value, expected),
      /has 1 nonterminal deployment/,
      status,
    );
  }
  assert.throws(
    () => validateRailwayRemediationInterlock(mutateFixture((value) => {
      value.nonterminalDeployments.edges = [{ node: {
        id: 'future-status',
        projectId: expected.projectId,
        environmentId: expected.environmentId,
        serviceId: expected.serviceId,
        status: 'FUTURE_NONTERMINAL_STATUS',
      } }];
    }), expected),
    /unexpected status/,
  );
  assert.throws(
    () => validateRailwayRemediationInterlock(mutateFixture((value) => {
      value.nonterminalDeployments.pageInfo.hasNextPage = true;
    }), expected),
    /nonterminal deployment query was not exhaustive/,
  );
});

test('GraphQL transport is bounded, read-only, and uses only Project-Access-Token', async () => {
  const secret = 'railway-secret-that-must-not-enter-the-body';
  let request;
  const data = await railwayGraphqlReadOnly({
    token: secret,
    variables: buildInterlockVariables(expected),
    timeoutMs: 1234,
    fetchImpl: async (url, options) => {
      request = { url, options };
      return { ok: true, status: 200, json: async () => ({ data: fixture() }) };
    },
  });
  assert.deepEqual(data, fixture());
  assert.equal(request.url, RAILWAY_GRAPHQL_URL);
  assert.equal(request.options.method, 'POST');
  assert.equal(request.options.headers['Project-Access-Token'], secret);
  assert.equal(Object.hasOwn(request.options.headers, 'Authorization'), false);
  assert.equal(request.options.body.includes(secret), false);
  assert.equal(JSON.parse(request.options.body).query, RAILWAY_REMEDIATION_INTERLOCK_QUERY);
  assert.equal(request.options.signal instanceof AbortSignal, true);

  await assert.rejects(
    railwayGraphqlReadOnly({
      token: secret,
      query: 'mutation Unsafe { serviceDelete(id: "x") }',
      variables: {},
      fetchImpl: async () => assert.fail('mutation must not reach transport'),
    }),
    /only a read-only GraphQL query/,
  );
  await assert.rejects(
    railwayGraphqlReadOnly({
      token: `${secret}\nsecond-line`,
      variables: {},
      fetchImpl: async () => assert.fail('invalid token must not reach transport'),
    }),
    /must not contain a line break/,
  );
});

test('runner sends one query and returns no token or volatile control-plane fields', async () => {
  const token = 'not-output-secret';
  let request;
  const proof = await runRailwayRemediationInterlock({
    args: { ...expected, timeoutMs: 4321 },
    token,
    graphql: async (options) => {
      request = options;
      return fixture();
    },
  });
  assert.equal(request.token, token);
  assert.equal(request.query, RAILWAY_REMEDIATION_INTERLOCK_QUERY);
  assert.deepEqual(request.variables, buildInterlockVariables(expected));
  assert.equal(request.timeoutMs, 4321);
  const output = canonicalJson(proof);
  assert.equal(output.includes(token), false);
  assert.equal(output.includes('resolvedAt'), false);
  assert.equal(output.includes('meta'), false);
});

test('CLI arguments use GitHub Actions environment defaults and strict overrides', () => {
  const env = {
    EXPECTED_DEPLOYED_SHA: expected.commit,
    RAILWAY_PROJECT_ID: expected.projectId,
    RAILWAY_ENVIRONMENT_ID: expected.environmentId,
    RAILWAY_SERVICE_ID: expected.serviceId,
    RAILWAY_SERVICE_NAME: expected.serviceName,
    GITHUB_REPOSITORY: expected.repository,
  };
  assert.deepEqual(parseArgs([], env), {
    commit: expected.commit,
    projectId: expected.projectId,
    environmentId: expected.environmentId,
    serviceId: expected.serviceId,
    serviceName: expected.serviceName,
    repository: expected.repository,
    branch: 'main',
    rootDirectory: 'server',
    configFile: 'server/railway.toml',
    healthcheckPath: '/health',
    startCommand: expected.startCommand,
    timeoutMs: 30000,
  });
  const overridden = parseArgs([
    '--request-timeout-ms', '5000',
    '--root-directory', '/server',
    '--config-file', '/server/railway.toml',
  ], env);
  assert.equal(overridden.timeoutMs, 5000);
  assert.equal(overridden.rootDirectory, '/server');
  assert.equal(overridden.configFile, '/server/railway.toml');
  assert.throws(() => parseArgs(['--unknown', 'x'], env), /Unknown argument/);
  assert.throws(() => parseArgs(['--project-id'], env), /Missing value/);
  assert.throws(() => parseArgs(['--request-timeout-ms', '0'], env), /request timeout/);
  assert.throws(() => parseArgs([], { ...env, EXPECTED_DEPLOYED_SHA: 'bad' }), /exact lowercase/);
});
