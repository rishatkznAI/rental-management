import { expect, test } from '@playwright/test';
import { login } from './helpers/auth';
import { ensureUser, withAdminApi } from './helpers/api';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test('bot-only carrier account cannot enter the frontend shell', async ({ page, request }) => {
  const suffix = String(Date.now()).slice(-8);
  const credentials = {
    email: `smoke-carrier-${suffix}@example.local`,
    password: '123123',
  };

  await withAdminApi((api) => ensureUser(api, {
    name: `SMOKE-CARRIER-BotOnly-${suffix}`,
    email: credentials.email,
    role: 'Перевозчик',
    password: credentials.password,
  }));

  const apiLogin = await request.post('http://127.0.0.1:3000/api/auth/login', {
    data: credentials,
  });
  expect(apiLogin.status()).toBe(401);

  await login(page, credentials);
  await expect(page.getByText('Неверный логин или пароль')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Войти' })).toBeVisible();
  await expect(page.locator('aside')).toHaveCount(0);

  const storedToken = await page.evaluate(() => window.localStorage.getItem('app_auth_token'));
  expect(storedToken).toBeNull();
});
