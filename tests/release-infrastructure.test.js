import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  DEPLOY_EXACT_COMMIT_MUTATION,
  deploymentCommit,
  parseRailwayDeployConfig,
  railwayGraphql,
  validateAndTriggerRailwayDeployment,
  validateDeploymentProvenance,
  validateExactGitSha,
  validateExecutionContext,
  validateRailwayTarget,
  validateRuntimeGate,
} from '../scripts/railway-backend-release.mjs';
import { classifyReleaseOutcome } from '../scripts/release-outcome.mjs';
import { classifyReleaseChangedFiles } from '../scripts/release-classifier.mjs';
import { resolveFrontendScriptUrls } from '../scripts/release-preflight.mjs';

const workflowSource = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const backendReleaseSource = readFileSync(new URL('../scripts/railway-backend-release.mjs', import.meta.url), 'utf8');
const railwayConfigSource = readFileSync(new URL('../server/railway.toml', import.meta.url), 'utf8');

const expected = {
  commit: '5f071fc531c870fa2422320efe64bc83cafe509e',
  deploymentId: 'deployment-1',
  projectId: 'project-1',
  environmentId: 'environment-1',
  serviceId: 'service-1',
  serviceName: 'rental-management',
  repository: 'rishatkznAI/rental-management',
};

function targetFixture(overrides = {}) {
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
      environmentId: expected.environmentId,
      serviceId: expected.serviceId,
      serviceName: expected.serviceName,
      rootDirectory: '/server',
      railwayConfigFile: null,
      healthcheckPath: '/health',
      startCommand: 'node scripts/start-with-release-type.cjs',
      source: {
        repo: 'rishatkznAI/rental-management',
        image: null,
      },
      activeDeployments: [deploymentFixture()],
      resolvedFileConfig: resolvedFileConfigFixture(),
    },
    ...overrides,
  };
}

function deploymentFixture(overrides = {}) {
  return {
    id: 'deployment-1',
    projectId: expected.projectId,
    environmentId: expected.environmentId,
    serviceId: expected.serviceId,
    status: 'SUCCESS',
    meta: {
      commitHash: expected.commit,
      repo: expected.repository,
      rootDirectory: '/server',
      configFile: '/server/railway.toml',
      fileServiceManifest: {
        deploy: {
          healthcheckPath: '/health',
          startCommand: 'node scripts/start-with-release-type.cjs',
        },
      },
      propertyFileMapping: {
        'deploy.healthcheckPath': '$.deploy.healthcheckPath',
        'deploy.startCommand': '$.deploy.startCommand',
      },
      serviceManifest: {
        deploy: {
          healthcheckPath: '/health',
          startCommand: 'node scripts/start-with-release-type.cjs',
        },
      },
    },
    ...overrides,
  };
}

function resolvedFileConfigFixture(overrides = {}) {
  return {
    commitHash: expected.commit,
    configFile: '/server/railway.toml',
    deploymentId: 'deployment-1',
    fileManifest: {
      deploy: {
        healthcheckPath: '/health',
        startCommand: 'node scripts/start-with-release-type.cjs',
      },
    },
    propertyFileMapping: {
      'deploy.healthcheckPath': '$.deploy.healthcheckPath',
      'deploy.startCommand': '$.deploy.startCommand',
    },
    repo: expected.repository,
    resolvedAt: '2026-08-25T19:00:02.248Z',
    ...overrides,
  };
}

function runtimeProbes(overrides = {}) {
  const build = {
    commitFull: expected.commit,
    releaseType: 'backend',
    deployment: { railwayDeploymentId: expected.deploymentId },
  };
  return {
    health: { status: 200, json: { ok: true, build } },
    readiness: { status: 200, json: { ok: true, build } },
    version: { status: 200, json: { ok: true, build } },
    ...overrides,
  };
}

test('exact Railway deploy mutation binds the immutable commit SHA', () => {
  assert.match(DEPLOY_EXACT_COMMIT_MUTATION, /serviceInstanceDeployV2/);
  assert.match(DEPLOY_EXACT_COMMIT_MUTATION, /commitSha:\s*\$commitSha/);
  assert.doesNotMatch(DEPLOY_EXACT_COMMIT_MUTATION, /latestCommit/);
  assert.doesNotMatch(backendReleaseSource, /railway\s+(?:up|redeploy)/i);
});

test('exact Git SHA validation rejects prefixes and non-hex input', () => {
  assert.equal(validateExactGitSha(expected.commit), expected.commit);
  assert.throws(() => validateExactGitSha(expected.commit.slice(0, 12)), /exact 40-character/);
  assert.throws(() => validateExactGitSha('z'.repeat(40)), /exact 40-character/);
});

test('backend deploy execution is restricted to the exact main workflow context', () => {
  const env = {
    GITHUB_ACTIONS: 'true',
    GITHUB_SHA: expected.commit,
    GITHUB_REPOSITORY: expected.repository,
    GITHUB_REF: 'refs/heads/main',
  };
  assert.deepEqual(validateExecutionContext({
    env,
    expectedCommit: expected.commit,
    expectedRepository: expected.repository,
    expectedBranch: 'main',
    requestedReleaseType: 'full-stack',
  }), {
    commit: expected.commit,
    repository: expected.repository.toLowerCase(),
    branch: 'main',
    requestedType: 'full-stack',
  });
  assert.throws(() => validateExecutionContext({
    env: { ...env, GITHUB_REF: 'refs/heads/feature' },
    expectedCommit: expected.commit,
    expectedRepository: expected.repository,
    requestedReleaseType: 'backend',
  }), /refs\/heads\/main/);
  assert.throws(() => validateExecutionContext({
    env,
    expectedCommit: expected.commit,
    expectedRepository: expected.repository,
    requestedReleaseType: 'frontend-only',
  }), /backend or full-stack/);
});

test('Railway target preflight accepts the connected production service contract', () => {
  const result = validateRailwayTarget(targetFixture(), expected, railwayConfigSource);
  assert.equal(result.projectId, expected.projectId);
  assert.equal(result.environmentId, expected.environmentId);
  assert.equal(result.serviceId, expected.serviceId);
  assert.equal(result.repository, expected.repository.toLowerCase());
});

test('Railway target preflight fails closed on identity and source drift', () => {
  const cases = [
    [targetFixture({ projectToken: { projectId: 'wrong', environmentId: expected.environmentId } }), /project token project ID/],
    [targetFixture({ service: { id: 'wrong', name: expected.serviceName, projectId: expected.projectId } }), /service ID/],
    [targetFixture({ serviceInstance: { ...targetFixture().serviceInstance, environmentId: 'wrong' } }), /environment ID/],
    [targetFixture({ serviceInstance: { ...targetFixture().serviceInstance, source: { repo: 'other/repo', image: null } } }), /source repository/],
    [targetFixture({ serviceInstance: { ...targetFixture().serviceInstance, source: { repo: expected.repository, image: 'registry/image:tag' } } }), /not an image source/],
    [targetFixture({ serviceInstance: { ...targetFixture().serviceInstance, rootDirectory: '/api' } }), /root directory/],
    [targetFixture({ serviceInstance: { ...targetFixture().serviceInstance, activeDeployments: [deploymentFixture(), deploymentFixture({ id: 'deployment-2' })] } }), /ambiguous multiple active deployments/],
  ];
  for (const [fixture, pattern] of cases) {
    assert.throws(() => validateRailwayTarget(fixture, expected, railwayConfigSource), pattern);
  }
});

test('file-managed null ServiceInstance config passes with committed and resolved evidence', () => {
  const instance = targetFixture().serviceInstance;
  const result = validateRailwayTarget(targetFixture({
    serviceInstance: {
      ...instance,
      healthcheckPath: null,
      startCommand: null,
    },
  }), expected, railwayConfigSource);
  assert.equal(result.healthcheckPath, '/health');
  assert.equal(result.startCommand, 'node scripts/start-with-release-type.cjs');
  assert.equal(result.configFile, '/server/railway.toml');
  assert.match(result.configAuthority, /committed railway\.toml/);
});

test('explicit matching ServiceInstance config passes without source ambiguity', () => {
  assert.doesNotThrow(() => validateRailwayTarget(targetFixture(), expected, railwayConfigSource));
});

test('explicit ServiceInstance healthcheck mismatch fails', () => {
  assert.throws(
    () => validateRailwayTarget(targetFixture({
      serviceInstance: { ...targetFixture().serviceInstance, healthcheckPath: '/status' },
    }), expected, railwayConfigSource),
    /Railway healthcheck path mismatch/,
  );
});

test('explicit ServiceInstance start-command mismatch fails', () => {
  assert.throws(
    () => validateRailwayTarget(targetFixture({
      serviceInstance: { ...targetFixture().serviceInstance, startCommand: 'node server.js' },
    }), expected, railwayConfigSource),
    /Railway start command mismatch/,
  );
});

test('null ServiceInstance config fails when committed railway.toml is missing', () => {
  const instance = targetFixture().serviceInstance;
  assert.throws(
    () => validateRailwayTarget(targetFixture({
      serviceInstance: { ...instance, healthcheckPath: null, startCommand: null },
    }), expected, ''),
    /committed Railway config source is required/,
  );
});

test('null ServiceInstance config fails when committed railway.toml values are wrong', () => {
  const instance = targetFixture().serviceInstance;
  const wrongConfig = railwayConfigSource.replace('healthcheckPath = "/health"', 'healthcheckPath = "/status"');
  assert.throws(
    () => validateRailwayTarget(targetFixture({
      serviceInstance: { ...instance, healthcheckPath: null, startCommand: null },
    }), expected, wrongConfig),
    /committed Railway healthcheck path mismatch/,
  );
});

test('correct railway.toml fails when the strict root directory is wrong', () => {
  assert.throws(
    () => validateRailwayTarget(targetFixture({
      serviceInstance: { ...targetFixture().serviceInstance, rootDirectory: '/api' },
    }), expected, railwayConfigSource),
    /Railway root directory mismatch/,
  );
});

test('pre-deploy commands fail closed in committed, resolved, and deployment metadata', () => {
  const withCommittedPreDeploy = `${railwayConfigSource.trim()}\npreDeployCommand = "node migrate.js"\n`;
  assert.throws(
    () => validateRailwayTarget(targetFixture(), expected, withCommittedPreDeploy),
    /committed Railway pre-deploy command must be absent/,
  );
  assert.throws(
    () => validateRailwayTarget(
      targetFixture(),
      expected,
      `${railwayConfigSource.trim()}\n"preDeployCommand" = "node migrate.js"\n`,
    ),
    /committed Railway pre-deploy command must be absent/,
  );

  const instance = targetFixture().serviceInstance;
  assert.throws(
    () => validateRailwayTarget(targetFixture({
      serviceInstance: {
        ...instance,
        resolvedFileConfig: resolvedFileConfigFixture({
          fileManifest: {
            deploy: {
              healthcheckPath: '/health',
              startCommand: 'node scripts/start-with-release-type.cjs',
              preDeployCommand: 'node migrate.js',
            },
          },
        }),
      },
    }), expected, railwayConfigSource),
    /resolved file pre-deploy command must be absent/,
  );

  const deployment = deploymentFixture();
  assert.throws(
    () => validateRailwayTarget(targetFixture({
      serviceInstance: {
        ...instance,
        activeDeployments: [deploymentFixture({
          meta: {
            ...deployment.meta,
            serviceManifest: {
              deploy: {
                healthcheckPath: '/health',
                startCommand: 'node scripts/start-with-release-type.cjs',
                preDeployCommand: ['node', 'migrate.js'],
              },
            },
          },
        })],
      },
    }), expected, railwayConfigSource),
    /resolved service pre-deploy command must be absent/,
  );
});

test('effective deployment metadata conflict fails despite correct railway.toml', () => {
  const conflictingDeployment = deploymentFixture({
    meta: {
      ...deploymentFixture().meta,
      fileServiceManifest: {
        deploy: {
          healthcheckPath: '/status',
          startCommand: 'node scripts/start-with-release-type.cjs',
        },
      },
    },
  });
  assert.throws(
    () => validateRailwayTarget(targetFixture({
      serviceInstance: {
        ...targetFixture().serviceInstance,
        healthcheckPath: null,
        startCommand: null,
        activeDeployments: [conflictingDeployment],
      },
    }), expected, railwayConfigSource),
    /effective deployment healthcheck path mismatch/,
  );
});

test('missing resolved deployment evidence fails closed', () => {
  const instance = targetFixture().serviceInstance;
  assert.throws(
    () => validateRailwayTarget(targetFixture({
      serviceInstance: {
        ...instance,
        healthcheckPath: null,
        startCommand: null,
        resolvedFileConfig: null,
      },
    }), expected, railwayConfigSource),
    /EFFECTIVE_RAILWAY_CONFIG_UNVERIFIED/,
  );
});

test('configuration validation failure causes zero deployment mutations', async () => {
  let mutationCalls = 0;
  const instance = targetFixture().serviceInstance;
  await assert.rejects(
    validateAndTriggerRailwayDeployment({
      token: 'redacted-test-token',
      targetData: targetFixture({
        serviceInstance: { ...instance, healthcheckPath: null, startCommand: null },
      }),
      expected,
      railwayConfigSource: railwayConfigSource.replace(
        'startCommand = "node scripts/start-with-release-type.cjs"',
        'startCommand = "node server.js"',
      ),
      graphql: async () => {
        mutationCalls += 1;
        return { serviceInstanceDeployV2: 'unexpected-deployment' };
      },
    }),
    /committed Railway start command mismatch/,
  );
  assert.equal(mutationCalls, 0);
});

test('committed railway.toml parser reads the exact deploy values', () => {
  assert.deepEqual(parseRailwayDeployConfig(railwayConfigSource), {
    startCommand: 'node scripts/start-with-release-type.cjs',
    healthcheckPath: '/health',
  });
});

test('deployment provenance requires the returned deployment ID, target IDs, SUCCESS, and exact metadata SHA', () => {
  const validationExpected = {
    ...expected,
    deploymentId: 'deployment-1',
    rootDirectory: 'server',
    configFile: '/server/railway.toml',
    healthcheckPath: '/health',
    startCommand: 'node scripts/start-with-release-type.cjs',
  };
  assert.equal(validateDeploymentProvenance(deploymentFixture(), validationExpected).commit, expected.commit);
  assert.equal(deploymentCommit({ meta: JSON.stringify({ commitHash: expected.commit }) }), expected.commit);
  assert.throws(
    () => validateDeploymentProvenance(deploymentFixture({ id: 'other' }), validationExpected),
    /deployment ID mismatch/,
  );
  assert.throws(
    () => validateDeploymentProvenance(deploymentFixture({ status: 'FAILED' }), validationExpected),
    /did not reach SUCCESS/,
  );
  assert.throws(
    () => validateDeploymentProvenance(deploymentFixture({ meta: { commitHash: 'a'.repeat(40) } }), validationExpected),
    /commit metadata mismatch/,
  );
  assert.throws(
    () => validateDeploymentProvenance(deploymentFixture({
      meta: {
        ...deploymentFixture().meta,
        serviceManifest: {
          deploy: {
            healthcheckPath: '/status',
            startCommand: 'node scripts/start-with-release-type.cjs',
          },
        },
      },
    }), validationExpected),
    /resolved service healthcheck path mismatch/,
  );
});

test('runtime gate requires all health endpoints and the exact backend commit', () => {
  assert.deepEqual(validateRuntimeGate(runtimeProbes(), expected), {
    commit: expected.commit,
    deploymentId: expected.deploymentId,
    releaseType: 'backend',
  });
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ health: { status: 503, json: { ok: false } } }), expected),
    /\/health must return HTTP 200/,
  );
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ health: { status: 200, json: { ok: true } } }), expected),
    /\/health build commit mismatch/,
  );
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ health: { status: 200, json: { ok: true, build: { commitFull: expected.commit } } } }), expected),
    /\/health Railway deployment ID mismatch/,
  );
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ readiness: { status: 200, json: { ok: true } } }), expected),
    /\/health\/ready build commit mismatch/,
  );
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ readiness: { status: 200, json: { ok: true, build: { commitFull: expected.commit } } } }), expected),
    /\/health\/ready Railway deployment ID mismatch/,
  );
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ version: { status: 200, json: { ok: true, build: { commitFull: 'a'.repeat(40), releaseType: 'backend' } } } }), expected),
    /build commit mismatch/,
  );
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ version: { status: 200, json: { ok: true, build: { commitFull: expected.commit, releaseType: 'unknown' } } } }), expected),
    /Railway deployment ID mismatch/,
  );
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ version: { status: 200, json: { ok: true, build: { commitFull: expected.commit, releaseType: 'backend' } } } }), expected),
    /Railway deployment ID mismatch/,
  );
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ version: { status: 200, json: { ok: true, build: { commitFull: expected.commit, releaseType: 'backend', deployment: { railwayDeploymentId: 'other-deployment' } } } } }), expected),
    /Railway deployment ID mismatch/,
  );
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ health: { status: 200, json: { ok: true, build: { commitFull: expected.commit, releaseType: 'backend', deployment: { railwayDeploymentId: 'other-deployment' } } } } }), expected),
    /Railway deployment ID mismatch/,
  );
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ readiness: { status: 200, json: { ok: true, build: { commitFull: expected.commit, releaseType: 'backend', deployment: { railwayDeploymentId: 'other-deployment' } } } } }), expected),
    /\/health\/ready Railway deployment ID mismatch/,
  );
  assert.throws(
    () => validateRuntimeGate(runtimeProbes({ version: { status: 200, json: { ok: true, build: { commitFull: expected.commit, releaseType: 'unknown', deployment: { railwayDeploymentId: expected.deploymentId } } } } }), expected),
    /release type must be backend or full-stack/,
  );
});

test('Railway GraphQL uses only the project-token header and preserves mutation variables', async () => {
  let request = null;
  const data = await railwayGraphql({
    token: 'redacted-test-token',
    query: DEPLOY_EXACT_COMMIT_MUTATION,
    variables: { commitSha: expected.commit },
    fetchImpl: async (url, options) => {
      request = { url, options };
      return {
        ok: true,
        status: 200,
        json: async () => ({ data: { serviceInstanceDeployV2: 'deployment-1' } }),
      };
    },
  });
  assert.equal(data.serviceInstanceDeployV2, 'deployment-1');
  assert.equal(request.options.headers['Project-Access-Token'], 'redacted-test-token');
  assert.equal(request.options.headers.Authorization, undefined);
  assert.equal(JSON.parse(request.options.body).variables.commitSha, expected.commit);
});

test('release outcome reports both directions of a full-stack partial rollout', () => {
  const backendNew = classifyReleaseOutcome({
    expectedCommit: expected.commit,
    releaseType: 'full-stack',
    backendCommit: expected.commit,
    frontendCommit: 'a'.repeat(40),
    gateStatus: 'skipped',
  });
  assert.equal(backendNew.status, 'PARTIAL_RELEASE');
  assert.equal(backendNew.backendMatch, true);
  assert.equal(backendNew.frontendMatch, false);

  const frontendNew = classifyReleaseOutcome({
    expectedCommit: expected.commit,
    releaseType: 'full-stack',
    backendCommit: 'a'.repeat(40),
    frontendCommit: expected.commit,
    gateStatus: 'failure',
  });
  assert.equal(frontendNew.status, 'PARTIAL_RELEASE');
  assert.equal(frontendNew.backendMatch, false);
  assert.equal(frontendNew.frontendMatch, true);
});

test('release outcome distinguishes verified and unverified exact rollouts', () => {
  assert.equal(classifyReleaseOutcome({
    expectedCommit: expected.commit,
    releaseType: 'full-stack',
    backendCommit: expected.commit,
    frontendCommit: expected.commit,
    gateStatus: 'success',
  }).status, 'RELEASE_VERIFIED');
  assert.equal(classifyReleaseOutcome({
    expectedCommit: expected.commit,
    releaseType: 'full-stack',
    backendCommit: expected.commit,
    frontendCommit: expected.commit,
    gateStatus: 'failure',
  }).status, 'RELEASE_UNVERIFIED');
});

test('frontend SHA collection follows the final document origin and ignores third-party scripts', () => {
  const html = `
    <script type="module" src="/assets/index-target.js"></script>
    <script defer src="https://static.cloudflareinsights.com/beacon.min.js"></script>
  `;
  assert.deepEqual(resolveFrontendScriptUrls(html, 'https://skytech-rent.ru/'), [
    'https://skytech-rent.ru/assets/index-target.js',
  ]);
});

test('production workflow orders backend before frontend and keeps failures fail closed', () => {
  assert.match(workflowSource, /backend-deploy:[\s\S]*environment:\s*\n\s*name: production/);
  assert.match(workflowSource, /frontend-deploy:[\s\S]*- backend-deploy/);
  assert.match(workflowSource, /needs\.backend-deploy\.result == 'success'/);
  assert.match(workflowSource, /production-gate:[\s\S]*- backend-deploy[\s\S]*- frontend-deploy/);
  assert.match(workflowSource, /RAILWAY_PROJECT_TOKEN: \$\{\{ secrets\.RAILWAY_PROJECT_TOKEN \}\}/);
  assert.match(workflowSource, /EXPECTED_RELEASE_COMMIT: \$\{\{ github\.sha \}\}/);
  assert.match(workflowSource, /cancel-in-progress: false/);
  assert.match(workflowSource, /PARTIAL_RELEASE|release-outcome\.mjs/);
  assert.doesNotMatch(workflowSource, /railway\s+(?:up|redeploy)/i);
  assert.doesNotMatch(workflowSource, /\bssh\b|remediation/i);
  assert.match(backendReleaseSource, /BACKEND_HEALTH_GATE_FAILED/);
  assert.match(backendReleaseSource, /timed out waiting for the exact-SHA Railway deployment/);
});

test('new release infrastructure paths remain deployment tooling, not backend runtime', () => {
  const result = classifyReleaseChangedFiles([
    '.github/workflows/deploy.yml',
    'scripts/railway-backend-release.mjs',
    'scripts/release-outcome.mjs',
    'tests/release-infrastructure.test.js',
    'docs/release-runbook.md',
  ]);
  assert.equal(result.releaseType, 'deploy-tooling');
  assert.equal(result.requiresBackendDeploy, false);
  assert.equal(result.failClosed, false);
});
