import { test } from '@playwright/test';
import { optionalEnv, requiredEnv, runReleaseSmoke } from './helpers/releaseSmoke';

test('staging read-only smoke', async ({ page }) => {
  test.setTimeout(180_000);
  await runReleaseSmoke(page, {
    environmentName: 'staging',
    frontendUrl: requiredEnv('STAGING_FRONTEND_URL', 'staging smoke'),
    apiUrl: requiredEnv('STAGING_API_URL', 'staging smoke'),
    adminEmail: requiredEnv('STAGING_ADMIN_EMAIL', 'staging smoke'),
    adminPassword: requiredEnv('STAGING_ADMIN_PASSWORD', 'staging smoke'),
    expectedCommit: optionalEnv('EXPECTED_RELEASE_COMMIT') || optionalEnv('GITHUB_SHA'),
  });
});
