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
import {
  extractFrontendBuildMarkerFromBundle,
  readFrontendBundle,
  readFrontendBundleWithPropagationRetry,
  releaseVerificationContractResult,
  resolveFrontendScriptUrls,
} from '../scripts/release-preflight.mjs';

const workflowSource = readFileSync(new URL('../.github/workflows/deploy.yml', import.meta.url), 'utf8');
const backendReleaseSource = readFileSync(new URL('../scripts/railway-backend-release.mjs', import.meta.url), 'utf8');
const releaseOutcomeSource = readFileSync(new URL('../scripts/release-outcome.mjs', import.meta.url), 'utf8');
const railwayConfigSource = readFileSync(new URL('../server/railway.toml', import.meta.url), 'utf8');

function textFetchResult(url, text, { status = 200, headers = {} } = {}) {
  const normalizedHeaders = Object.fromEntries(
    Object.entries({
      'content-type': 'text/html; charset=utf-8',
      ...headers,
    }).map(([name, value]) => [name.toLowerCase(), String(value)]),
  );
  return {
    response: {
      status,
      url,
      headers: {
        get(name) {
          return normalizedHeaders[String(name).toLowerCase()] ?? null;
        },
      },
    },
    text,
  };
}

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

test('frontend propagation retry uses absolute offsets and never fetches third-party scripts', async () => {
  const frontendUrl = 'https://app.skytech-rent.test/';
  const apiUrl = 'https://api.skytech-rent.test';
  const representations = [
    '<html><body>temporarily empty</body></html>',
    '<html><script src="https://static.example.test/beacon.js"></script></html>',
    '<html><script type="module" src="/assets/index-exact.js"></script></html>',
  ];
  let clockMs = 0;
  let rootCalls = 0;
  const rootCallTimes = [];
  const assetCalls = [];
  const waits = [];
  const retries = [];
  const fetchTextImpl = async url => {
    const parsed = new URL(url);
    if (parsed.origin === 'https://app.skytech-rent.test' && parsed.pathname === '/') {
      rootCallTimes.push(clockMs);
      const html = representations[rootCalls++];
      return textFetchResult(url, html, {
        headers: { 'content-type': 'text/html; charset=utf-8', 'x-cache': 'MISS' },
      });
    }
    if (parsed.pathname === '/assets/index-exact.js') {
      assetCalls.push(url);
      return textFetchResult(url, [
        'const build={service:"frontend",',
        `commit:"${expected.commit}",`,
        'releaseType:"full-stack",',
        `apiBaseUrl:"${apiUrl}"};`,
      ].join(''));
    }
    throw new Error(`unexpected frontend fetch ${parsed.origin}${parsed.pathname}`);
  };
  const bundle = await readFrontendBundleWithPropagationRetry(frontendUrl, {
    retryOffsetsMs: [0, 30, 90],
    readBundle: (url, options) => readFrontendBundle(url, { ...options, fetchTextImpl }),
    now: () => clockMs,
    sleep: async delayMs => {
      waits.push(delayMs);
      clockMs += delayMs;
    },
    onRetry: event => retries.push(event),
  });

  assert.equal(rootCalls, 3);
  assert.deepEqual(rootCallTimes, [0, 30, 90]);
  assert.deepEqual(waits, [30, 60]);
  assert.equal(assetCalls.length, 1);
  assert.equal(assetCalls[0], 'https://app.skytech-rent.test/assets/index-exact.js');
  assert.equal(retries.length, 2);
  assert.deepEqual(retries.map(retry => retry.error.evidence.totalScriptCount), [0, 1]);
  assert.deepEqual(retries.map(retry => retry.error.evidence.sameOriginScriptCount), [0, 0]);
  assert.equal(bundle.combinedText.includes(expected.commit), true);
  assert.equal(bundle.combinedText.includes(apiUrl), true);
});

test('frontend propagation retry exhausts the exact bounded schedule with safe terminal evidence', async () => {
  const frontendUrl = 'https://app.skytech-rent.test/';
  const retryOffsetsMs = [0, 30_000, 90_000, 210_000, 390_000, 630_000];
  let clockMs = 0;
  let rootCalls = 0;
  const rootCallTimes = [];
  const rawSentinel = 'raw-body-secret-must-not-be-logged';
  const fetchTextImpl = async url => {
    rootCallTimes.push(clockMs);
    rootCalls += 1;
    return textFetchResult(url, `<html>${rawSentinel}-${rootCalls}</html>`, {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'max-age=600',
        age: '421',
        etag: 'public-etag',
        'last-modified': 'Thu, 27 Aug 2026 12:14:34 GMT',
        server: 'GitHub.com',
        'x-cache': 'HIT',
        'x-served-by': 'cache-iad-kcgs7200071-IAD',
        'x-github-edge-region': 'eastus',
        'x-github-request-id': 'SAFE:PUBLIC:REQUEST:ID',
        'set-cookie': 'session=raw-cookie-secret-must-not-be-logged',
        authorization: 'Bearer raw-authorization-secret-must-not-be-logged',
      },
    });
  };

  await assert.rejects(
    () => readFrontendBundleWithPropagationRetry(frontendUrl, {
      retryOffsetsMs,
      readBundle: (url, options) => readFrontendBundle(url, { ...options, fetchTextImpl }),
      now: () => clockMs,
      sleep: async delayMs => {
        assert.ok(delayMs <= 60_000);
        clockMs += delayMs;
      },
      onRetry: () => {},
    }),
    error => {
      assert.equal(error?.code, 'FRONTEND_REPRESENTATION_NOT_READY');
      assert.equal(error?.evidence?.status, 200);
      assert.equal(error?.evidence?.attempts, 6);
      assert.equal(error?.evidence?.durationMs, 630_000);
      assert.equal(error?.evidence?.deadlineMs, 690_000);
      assert.deepEqual(error?.evidence?.retryOffsetsMs, retryOffsetsMs);
      assert.equal(error?.evidence?.finalOrigin, 'https://app.skytech-rent.test');
      assert.equal(error?.evidence?.cacheControl, 'max-age=600');
      assert.equal(error?.evidence?.age, '421');
      assert.equal(error?.evidence?.server, 'GitHub.com');
      assert.equal(error?.evidence?.cache, 'HIT');
      assert.equal(error?.evidence?.totalScriptCount, 0);
      assert.equal(error?.evidence?.sameOriginScriptCount, 0);
      assert.match(error?.evidence?.bodySha256 || '', /^[a-f0-9]{64}$/);
      assert.ok(Number.isSafeInteger(error?.evidence?.bodyBytes));
      assert.equal(error.message.includes(rawSentinel), false);
      assert.equal(error.message.includes('raw-cookie-secret'), false);
      assert.equal(error.message.includes('raw-authorization-secret'), false);
      return true;
    },
  );

  assert.equal(rootCalls, 6);
  assert.deepEqual(rootCallTimes, retryOffsetsMs);
});

test('frontend propagation retry fails immediately for root and same-origin asset HTTP errors', async t => {
  await t.test('root response is non-200', async () => {
    let calls = 0;
    let sleeps = 0;
    await assert.rejects(
      () => readFrontendBundleWithPropagationRetry('https://app.skytech-rent.test/', {
        readBundle: (url, options) => readFrontendBundle(url, {
          ...options,
          fetchTextImpl: async requestUrl => {
            calls += 1;
            return textFetchResult(requestUrl, 'unavailable', { status: 503 });
          },
        }),
        sleep: async () => { sleeps += 1; },
      }),
      /frontend URL must return 200\. HTTP 503/,
    );
    assert.equal(calls, 1);
    assert.equal(sleeps, 0);
  });

  await t.test('same-origin asset response is non-200', async () => {
    let rootCalls = 0;
    let assetCalls = 0;
    let sleeps = 0;
    await assert.rejects(
      () => readFrontendBundleWithPropagationRetry('https://app.skytech-rent.test/', {
        readBundle: (url, options) => readFrontendBundle(url, {
          ...options,
          fetchTextImpl: async requestUrl => {
            const parsed = new URL(requestUrl);
            if (parsed.pathname === '/') {
              rootCalls += 1;
              return textFetchResult(requestUrl, '<script src="/assets/index.js"></script>');
            }
            assetCalls += 1;
            return textFetchResult(requestUrl, 'unavailable', { status: 503 });
          },
        }),
        sleep: async () => { sleeps += 1; },
      }),
      /frontend asset must return 200\. HTTP 503/,
    );
    assert.equal(rootCalls, 1);
    assert.equal(assetCalls, 1);
    assert.equal(sleeps, 0);
  });
});

test('frontend propagation retry fails immediately for non-HTML or missing media types', async t => {
  for (const [name, contentType, expectedType] of [
    ['JSON', 'application/json; charset=utf-8', 'application/json'],
    ['missing Content-Type', '', 'missing'],
  ]) {
    await t.test(name, async () => {
      let calls = 0;
      let sleeps = 0;
      await assert.rejects(
        () => readFrontendBundleWithPropagationRetry('https://app.skytech-rent.test/', {
          readBundle: (url, options) => readFrontendBundle(url, {
            ...options,
            fetchTextImpl: async requestUrl => {
              calls += 1;
              return textFetchResult(requestUrl, '<html>no scripts</html>', {
                headers: { 'content-type': contentType },
              });
            },
          }),
          sleep: async () => { sleeps += 1; },
        }),
        new RegExp(`frontend URL must return text/html\\. content-type=${expectedType}`),
      );
      assert.equal(calls, 1);
      assert.equal(sleeps, 0);
    });
  }
});

test('frontend propagation retry fails immediately for a root network error', async () => {
  let calls = 0;
  let sleeps = 0;
  await assert.rejects(
    () => readFrontendBundleWithPropagationRetry('https://app.skytech-rent.test/', {
      readBundle: (url, options) => readFrontendBundle(url, {
        ...options,
        fetchTextImpl: async () => {
          calls += 1;
          throw new Error('simulated network failure');
        },
      }),
      sleep: async () => { sleeps += 1; },
    }),
    /simulated network failure/,
  );
  assert.equal(calls, 1);
  assert.equal(sleeps, 0);
});

test('frontend propagation retry never retries a collected stale marker or wrong API target', async t => {
  const apiUrl = 'https://api.skytech-rent.test';
  const backendBuild = { commitFull: expected.commit, releaseType: 'full-stack' };
  const okProbe = { ok: true, status: 200, timeoutMs: 15_000, timedOut: false, error: '' };

  async function collectBundle(assetText) {
    let rootCalls = 0;
    let assetCalls = 0;
    let sleeps = 0;
    const bundle = await readFrontendBundleWithPropagationRetry('https://app.skytech-rent.test/', {
      readBundle: (url, options) => readFrontendBundle(url, {
        ...options,
        fetchTextImpl: async requestUrl => {
          const parsed = new URL(requestUrl);
          if (parsed.pathname === '/') {
            rootCalls += 1;
            return textFetchResult(requestUrl, '<script src="/assets/index.js"></script>');
          }
          assetCalls += 1;
          return textFetchResult(requestUrl, assetText);
        },
      }),
      sleep: async () => { sleeps += 1; },
    });
    assert.equal(rootCalls, 1);
    assert.equal(assetCalls, 1);
    assert.equal(sleeps, 0);
    return bundle;
  }

  await t.test('stale marker remains a strict contract failure', async () => {
    const staleCommit = 'a'.repeat(40);
    const bundle = await collectBundle(
      `const b={service:"frontend",commit:"${staleCommit}",releaseType:"full-stack",apiBaseUrl:"${apiUrl}"};`,
    );
    const result = releaseVerificationContractResult({
      env: 'production',
      releaseType: 'full-stack',
      frontendBuild: extractFrontendBuildMarkerFromBundle(bundle.combinedText) || {},
      backendBuild,
      expectedCommit: expected.commit,
      frontendEvidence: { ...okProbe, ok: bundle.combinedText.includes(apiUrl) },
      backendVersion: okProbe,
      health: okProbe,
      readiness: okProbe,
    });
    assert.equal(result.pass, false);
    assert.ok(result.failureReasons.some(reason => reason.includes('frontend commit mismatch')));
  });

  await t.test('wrong API target remains a strict contract failure', async () => {
    const bundle = await collectBundle(
      `const b={service:"frontend",commit:"${expected.commit}",releaseType:"full-stack",apiBaseUrl:"https://wrong-api.test"};`,
    );
    const hasExpectedApi = bundle.combinedText.includes(apiUrl);
    const result = releaseVerificationContractResult({
      env: 'production',
      releaseType: 'full-stack',
      frontendBuild: extractFrontendBuildMarkerFromBundle(bundle.combinedText) || {},
      backendBuild,
      expectedCommit: expected.commit,
      frontendEvidence: {
        ...okProbe,
        ok: hasExpectedApi,
        error: hasExpectedApi ? '' : `frontend bundle does not contain expected API URL ${apiUrl}`,
      },
      backendVersion: okProbe,
      health: okProbe,
      readiness: okProbe,
    });
    assert.equal(result.pass, false);
    assert.ok(result.failureReasons.some(reason => reason.includes('frontend marker required')));
  });
});

test('release outcome remains a single-shot observer instead of extending the propagation retry window', () => {
  assert.match(releaseOutcomeSource, /\breadFrontendBundle\b/);
  assert.doesNotMatch(releaseOutcomeSource, /\breadFrontendBundleWithPropagationRetry\b/);
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
    'scripts/release-conservation-contract.mjs',
    'scripts/release-targeted-smoke.mjs',
    'scripts/railway-backend-release.mjs',
    'scripts/release-outcome.mjs',
    'tests/release-infrastructure.test.js',
    'docs/release-runbook.md',
  ]);
  assert.equal(result.releaseType, 'deploy-tooling');
  assert.equal(result.requiresBackendDeploy, false);
  assert.equal(result.failClosed, false);
  assert.match(workflowSource, /- 'scripts\/release-conservation-contract\.mjs'/);
  assert.match(workflowSource, /- 'scripts\/release-targeted-smoke\.mjs'/);
});
