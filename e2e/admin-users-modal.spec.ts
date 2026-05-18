import { expect, test, type Locator, type Page } from '@playwright/test';
import { ensureUser, withAdminApi } from './helpers/api';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

async function setTheme(page: Page, theme: 'light' | 'dark') {
  await page.evaluate((nextTheme) => {
    localStorage.setItem('theme', nextTheme);
    document.documentElement.classList.toggle('dark', nextTheme === 'dark');
  }, theme);
}

async function openUserEditor(page: Page, email: string) {
  await navigateInApp(page, '/admin');
  await expect(page.getByRole('heading', { name: 'Панель администратора' })).toBeVisible();
  await page.getByRole('tab', { name: 'Пользователи и роли' }).click();

  const row = page.getByRole('row', { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
  await expect(row).toBeVisible();
  await row.getByTitle('Редактировать').click();

  const dialog = page.getByRole('dialog', { name: 'Редактировать пользователя' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseSelectValue(trigger: Locator, optionName: string) {
  await trigger.click();
  await trigger.page().getByRole('option', { name: optionName, exact: true }).click();
  await expect(trigger).toContainText(optionName);
}

async function expectReadableSelect(trigger: Locator, theme: 'light' | 'dark') {
  const styles = await trigger.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      backgroundColor: style.backgroundColor,
      borderColor: style.borderColor,
      color: style.color,
    };
  });

  expect(styles.borderColor).not.toBe('rgba(0, 0, 0, 0)');
  if (theme === 'light') {
    expect(styles.backgroundColor).toBe('rgb(255, 255, 255)');
    expect(styles.color).not.toBe('rgb(255, 255, 255)');
    expect(styles.color).not.toBe('rgba(0, 0, 0, 0)');
  } else {
    expect(styles.backgroundColor).not.toBe('rgb(255, 255, 255)');
    expect(styles.color).not.toBe(styles.backgroundColor);
  }
}

test('admin user editor shows selected role and active status in light and dark themes', async ({ page }) => {
  test.setTimeout(60_000);
  const email = 'e2e-admin-select-modal@example.local';

  await withAdminApi((api) => ensureUser(api, {
    name: 'E2E Admin Select Modal',
    email,
    role: 'Офис-менеджер',
    password: '1234',
  }));

  await loginAsAdmin(page);

  for (const theme of ['light', 'dark'] as const) {
    await setTheme(page, theme);
    const dialog = await openUserEditor(page, email);
    const triggers = dialog.locator('[data-slot="select-trigger"]');
    const roleTrigger = triggers.nth(0);
    const statusTrigger = triggers.nth(1);

    await chooseSelectValue(roleTrigger, 'Менеджер по аренде');
    await chooseSelectValue(statusTrigger, 'Активен');
    await expectReadableSelect(roleTrigger, theme);
    await expectReadableSelect(statusTrigger, theme);

    await dialog.getByRole('button', { name: 'Сохранить' }).click();
    await expect(dialog).toBeHidden();
    const row = page.getByRole('row', { name: new RegExp(email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) });
    await expect(row).toContainText('Менеджер по аренде');
    await expect(row).toContainText('Активен');
  }
});
