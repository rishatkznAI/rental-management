import { expect, test } from '@playwright/test';
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

test('production read-only smoke', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await runReleaseSmoke(page, {
    environmentName: 'production',
    frontendUrl: requiredEnv('PRODUCTION_FRONTEND_URL', 'production smoke'),
    apiUrl: requiredEnv('PRODUCTION_API_URL', 'production smoke'),
    adminEmail: requiredEnv('PRODUCTION_ADMIN_EMAIL', 'production smoke'),
    adminPassword: requiredEnv('PRODUCTION_ADMIN_PASSWORD', 'production smoke'),
    expectedCommit: optionalEnv('EXPECTED_RELEASE_COMMIT') || optionalEnv('GITHUB_SHA'),
    releaseType: optionalEnv('RELEASE_TYPE') || 'full-stack',
  }, testInfo);
});
