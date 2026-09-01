import { expect, test, type Page } from '@playwright/test';
import { createServer } from 'node:http';
import { optionalEnv, requiredEnv, runReleaseSmoke } from './helpers/releaseSmoke';

const BACKUP_ONLY_MODE = 'pre-compatibility-backup-only';

for (const appDisabled of [false, 'missing'] as const) {
  test(`mode-bearing production evidence with app.disabled=${appDisabled} sends zero login requests`, async ({ page }) => {
    let loginRequests = 0;
    const build = { commit: 'd'.repeat(7) };
    const server = createServer((request, response) => {
      response.setHeader('content-type', 'application/json; charset=utf-8');
      if (request.method === 'POST' && request.url === '/api/auth/login') {
        loginRequests += 1;
        response.statusCode = 500;
        response.end(JSON.stringify({ ok: false, error: 'login must not be requested' }));
        return;
      }
      const probes: Record<string, object> = {
        '/health': { ok: true, mode: BACKUP_ONLY_MODE, build },
        '/health/ready': { ok: true, ready: true, mode: BACKUP_ONLY_MODE, build },
        '/api/version': {
          ok: true,
          mode: BACKUP_ONLY_MODE,
          build,
          ...(appDisabled === 'missing' ? {} : { app: { disabled: appDisabled } }),
        },
      };
      const payload = probes[request.url || ''];
      if (request.method === 'GET' && payload) {
        response.end(JSON.stringify(payload));
        return;
      }
      response.statusCode = 404;
      response.end(JSON.stringify({ ok: false, error: 'Not found' }));
    });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('test server must expose a TCP port');

    let failure = '';
    try {
      await runReleaseSmoke(page, {
        environmentName: 'production',
        frontendUrl: 'http://127.0.0.1:9',
        apiUrl: `http://127.0.0.1:${address.port}`,
        adminEmail: 'real-credentials-must-not-send@example.test',
        adminPassword: 'real-credentials-must-not-send',
        releaseType: 'backend',
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    } finally {
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
    }

    expect(failure).toContain('version must prove app.disabled=true before conserved login validation');
    expect(loginRequests, 'malformed conservation evidence must fail before Playwright sends credentials').toBe(0);
  });
}

async function runBackendOnlyConservationCase(page: Page, {
  actualFrontendCommit,
  expectedFrontendCommit,
  expectedFrontendCommitFull,
}: {
  actualFrontendCommit: string;
  expectedFrontendCommit?: string;
  expectedFrontendCommitFull?: string;
}) {
  const expectedBackendCommit = '6'.repeat(40);
  const loginBodies: string[] = [];
  const build = {
    commit: expectedBackendCommit.slice(0, 7),
    commitFull: expectedBackendCommit,
    releaseType: 'full-stack',
    release: { type: 'full-stack' },
    startedAt: '2026-08-27T15:52:27.000Z',
    deployment: {
      railwayDeploymentId: 'deployment-backend-only-smoke',
      railwayEnvironment: 'production',
      railwayService: 'rental-management',
      railwayReplicaId: 'replica-backend-only-smoke',
    },
  };
  let baseUrl = '';
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'POST' && requestUrl.pathname === '/api/auth/login') {
      let body = '';
      request.setEncoding('utf8');
      request.on('data', chunk => { body += chunk; });
      request.on('end', () => {
        loginBodies.push(body);
        response.statusCode = 404;
        response.setHeader('content-type', 'application/json; charset=utf-8');
        response.setHeader('cache-control', 'no-store');
        response.setHeader('x-content-type-options', 'nosniff');
        response.setHeader('content-security-policy', "default-src 'none'; frame-ancestors 'none'");
        response.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
        response.end(JSON.stringify({ ok: false, error: 'Not found' }));
      });
      return;
    }

    const probes: Record<string, object> = {
      '/health': { ok: true, mode: BACKUP_ONLY_MODE, build },
      '/health/ready': { ok: true, ready: true, mode: BACKUP_ONLY_MODE, build },
      '/api/version': {
        ok: true,
        mode: BACKUP_ONLY_MODE,
        build,
        app: { disabled: true, message: 'Система временно отключена.' },
      },
    };
    const payload = probes[requestUrl.pathname];
    if (request.method === 'GET' && payload) {
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(payload));
      return;
    }
    if (request.method === 'GET' && requestUrl.pathname === '/') {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html>
        <html><body>
          <main>Система временно отключена. Работа приложения приостановлена.</main>
          <script>window.__SKYTECH_BUILD_INFO__ = ${JSON.stringify({
            commit: actualFrontendCommit,
            apiBaseUrl: baseUrl,
            releaseType: 'full-stack',
          })};</script>
        </body></html>`);
      return;
    }
    response.statusCode = 404;
    response.setHeader('content-type', 'application/json; charset=utf-8');
    response.end(JSON.stringify({ ok: false, error: 'Not found' }));
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server must expose a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;

  let failure = '';
  try {
    try {
      await runReleaseSmoke(page, {
        environmentName: 'production',
        frontendUrl: baseUrl,
        apiUrl: baseUrl,
        adminEmail: 'real-credentials-must-not-send@example.test',
        adminPassword: 'real-credentials-must-not-send',
        expectedCommit: expectedBackendCommit,
        expectedFrontendCommit,
        expectedFrontendCommitFull,
        releaseType: 'backend',
      });
    } catch (error) {
      failure = error instanceof Error ? error.message : String(error);
    }
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  return { failure, loginBodies };
}

test('conserved backend-only release accepts the explicit captured frontend baseline and exact new backend', async ({ page }) => {
  const preservedFrontendCommitFull = '5'.repeat(40);
  const preservedFrontendCommit = preservedFrontendCommitFull.slice(0, 12);
  const result = await runBackendOnlyConservationCase(page, {
    actualFrontendCommit: preservedFrontendCommit,
    expectedFrontendCommit: preservedFrontendCommit,
    expectedFrontendCommitFull: preservedFrontendCommitFull,
  });

  expect(result.failure).toBe('');
  expect(result.loginBodies).toHaveLength(1);
  expect(result.loginBodies[0]).toContain('backup-only-smoke@example.invalid');
  expect(result.loginBodies[0]).not.toContain('real-credentials-must-not-send');
});

test('conserved backend-only release fails closed when the captured frontend baseline is missing', async ({ page }) => {
  const result = await runBackendOnlyConservationCase(page, {
    actualFrontendCommit: '5'.repeat(12),
  });

  expect(result.failure).toContain('expected conserved frontend marker commit is missing');
  expect(result.loginBodies, 'missing baseline must fail before any login request').toHaveLength(0);
});

test('conserved backend-only release fails closed when the frontend marker changes after capture', async ({ page }) => {
  const preservedFrontendCommitFull = '5'.repeat(40);
  const result = await runBackendOnlyConservationCase(page, {
    actualFrontendCommit: '4'.repeat(12),
    expectedFrontendCommit: preservedFrontendCommitFull.slice(0, 12),
    expectedFrontendCommitFull: preservedFrontendCommitFull,
  });

  expect(result.failure).toContain('conserved frontend marker changed');
  expect(result.loginBodies, 'changed frontend must fail before any login request').toHaveLength(0);
});

async function runOrdinaryContractCase(page: Page, {
  expectedCommit,
  releaseType,
  actualFrontendCommit,
}: {
  expectedCommit?: string;
  releaseType: string;
  actualFrontendCommit: string;
}) {
  const backendCommit = '7'.repeat(40);
  const backendBuild = {
    commit: backendCommit.slice(0, 7),
    commitFull: backendCommit,
    releaseType: 'full-stack',
  };
  let loginRequests = 0;
  let baseUrl = '';
  const server = createServer((request, response) => {
    const requestUrl = new URL(request.url || '/', 'http://127.0.0.1');
    if (request.method === 'POST' && requestUrl.pathname === '/api/auth/login') {
      loginRequests += 1;
      response.statusCode = 500;
      response.end('real credentials must not be sent');
      return;
    }
    const probes: Record<string, object> = {
      '/health': { ok: true, build: backendBuild },
      '/health/ready': { ok: true, ready: true, build: backendBuild },
      '/api/version': { ok: true, build: backendBuild, app: { disabled: false } },
    };
    if (request.method === 'GET' && probes[requestUrl.pathname]) {
      response.setHeader('content-type', 'application/json; charset=utf-8');
      response.end(JSON.stringify(probes[requestUrl.pathname]));
      return;
    }
    if (request.method === 'GET' && (requestUrl.pathname === '/' || requestUrl.pathname === '/login')) {
      response.setHeader('content-type', 'text/html; charset=utf-8');
      response.end(`<!doctype html><html><body><main>Login fixture</main><script>window.__SKYTECH_BUILD_INFO__=${JSON.stringify({
        commit: actualFrontendCommit,
        apiBaseUrl: baseUrl,
        releaseType: 'full-stack',
      })};</script></body></html>`);
      return;
    }
    response.statusCode = 404;
    response.end('not found');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('test server must expose a TCP port');
  baseUrl = `http://127.0.0.1:${address.port}`;

  let failure = '';
  try {
    await runReleaseSmoke(page, {
      environmentName: 'production',
      frontendUrl: baseUrl,
      apiUrl: baseUrl,
      adminEmail: 'real-credentials-must-not-send@example.test',
      adminPassword: 'real-credentials-must-not-send',
      expectedCommit,
      releaseType,
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  } finally {
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }

  return { failure, loginRequests };
}

test('ordinary release fails its shared commit contract before sending real credentials', async ({ page }) => {
  const result = await runOrdinaryContractCase(page, {
    expectedCommit: '7'.repeat(40),
    releaseType: 'full-stack',
    actualFrontendCommit: '8'.repeat(12),
  });

  expect(result.failure).toContain('frontend commit mismatch');
  expect(result.loginRequests, 'ordinary commit mismatch must fail before any login request').toBe(0);
});

test('ordinary release fails closed when the expected release commit is missing', async ({ page }) => {
  const result = await runOrdinaryContractCase(page, {
    releaseType: 'full-stack',
    actualFrontendCommit: '7'.repeat(12),
  });

  expect(result.failure).toContain('expected release commit is missing');
  expect(result.loginRequests, 'missing expected commit must fail before any login request').toBe(0);
});

test('ordinary release fails closed when the release type is unknown', async ({ page }) => {
  const result = await runOrdinaryContractCase(page, {
    expectedCommit: '7'.repeat(40),
    releaseType: 'mystery-release',
    actualFrontendCommit: '7'.repeat(12),
  });

  expect(result.failure).toContain('unknown release type "mystery-release"');
  expect(result.loginRequests, 'unknown release type must fail before any login request').toBe(0);
});

test('production read-only smoke', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await runReleaseSmoke(page, {
    environmentName: 'production',
    frontendUrl: requiredEnv('PRODUCTION_FRONTEND_URL', 'production smoke'),
    apiUrl: requiredEnv('PRODUCTION_API_URL', 'production smoke'),
    adminEmail: requiredEnv('PRODUCTION_ADMIN_EMAIL', 'production smoke'),
    adminPassword: requiredEnv('PRODUCTION_ADMIN_PASSWORD', 'production smoke'),
    expectedCommit: optionalEnv('EXPECTED_RELEASE_COMMIT') || requiredEnv('GITHUB_SHA', 'production smoke release contract'),
    expectedFrontendCommit: optionalEnv('EXPECTED_FRONTEND_COMMIT'),
    expectedFrontendCommitFull: optionalEnv('EXPECTED_FRONTEND_COMMIT_FULL'),
    releaseType: optionalEnv('RELEASE_TYPE') || 'full-stack',
    expectedCompanyHealthDirectionLinks: 3,
    readOnlySections: [
      { label: 'Техника', route: '/equipment', nav: /^Техника/ },
      { label: 'Клиенты', route: '/clients', nav: /^Клиенты/ },
      { label: 'Сервис', route: '/service', nav: /^Сервис/ },
      { label: 'База знаний', route: '/knowledge-base', nav: /^База знаний/ },
    ],
  }, testInfo);
});
