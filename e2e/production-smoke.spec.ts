import { test } from '@playwright/test';
import { optionalEnv, requiredEnv, runReleaseSmoke } from './helpers/releaseSmoke';

test('production read-only smoke', async ({ page }) => {
  test.setTimeout(180_000);
  await runReleaseSmoke(page, {
    environmentName: 'production',
    frontendUrl: requiredEnv('PRODUCTION_FRONTEND_URL', 'production smoke'),
    apiUrl: requiredEnv('PRODUCTION_API_URL', 'production smoke'),
    adminEmail: requiredEnv('PRODUCTION_ADMIN_EMAIL', 'production smoke'),
    adminPassword: requiredEnv('PRODUCTION_ADMIN_PASSWORD', 'production smoke'),
    expectedCommit: optionalEnv('EXPECTED_RELEASE_COMMIT') || optionalEnv('GITHUB_SHA'),
    releaseType: optionalEnv('RELEASE_TYPE') || 'full-stack',
  });
});
