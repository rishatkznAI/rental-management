import { expect, test, type Locator } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

async function motionSnapshot(locator: Locator) {
  return locator.evaluate((element) => {
    const styles = window.getComputedStyle(element);
    return {
      animationName: styles.animationName,
      animationDuration: styles.animationDuration,
      className: element.getAttribute('class') || '',
      state: element.getAttribute('data-state') || '',
    };
  });
}

async function expectAnimation(locator: Locator, className: string, animationName: RegExp) {
  await expect(locator).toHaveClass(new RegExp(className));
  const snapshot = await motionSnapshot(locator);
  expect(snapshot.animationName).toMatch(animationName);
  expect(snapshot.animationDuration).not.toBe('0s');
  return snapshot;
}

test.describe('animation smoke', () => {
  test('core primitives expose visible motion classes and respect reduced motion', async ({ page }) => {
    await loginAsAdmin(page);

    await page.goto('./?debugVersion=1#/', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Дашборд' })).toBeVisible();
    const buildInfo = await page.evaluate(() => (
      window as Window & { __SKYTECH_BUILD_INFO__?: { commit?: string } }
    ).__SKYTECH_BUILD_INFO__);
    expect(buildInfo?.commit).toBeTruthy();

    await page.getByRole('button', { name: 'Уведомления' }).first().click();
    const sheet = page.locator('[data-slot="sheet-content"]').first();
    await expect(sheet).toBeVisible();
    const sheetMotion = await expectAnimation(sheet, 'app-animate-drawer', /app-drawer-right-in/);
    expect(sheetMotion.animationDuration).toMatch(/0\.26s|260ms/);
    await page.keyboard.press('Escape');
    await expect(sheet).toBeHidden();

    await navigateInApp(page, '/documents');
    await page.getByRole('button', { name: /Фильтры/ }).first().click();
    const dialog = page.locator('[data-slot="dialog-content"]').first();
    await expect(dialog).toBeVisible();
    const dialogMotion = await expectAnimation(dialog, 'app-animate-modal', /app-modal-in/);
    expect(dialogMotion.animationDuration).toMatch(/0\.22s|220ms/);

    await dialog.getByRole('combobox').first().click();
    const selectContent = page.locator('[data-slot="select-content"]').first();
    await expect(selectContent).toBeVisible();
    const selectMotion = await expectAnimation(selectContent, 'app-animate-popover', /app-popover-in/);
    expect(selectMotion.animationDuration).toMatch(/0\.15s|150ms/);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();

    await navigateInApp(page, '/service');
    await page.getByRole('tab', { name: 'Очередь сервиса' }).click();
    const tabContent = page.locator('[data-slot="tabs-content"][data-state="active"]').first();
    await expect(tabContent).toBeVisible();
    const tabMotion = await expectAnimation(tabContent, 'app-animate-tabs', /app-tabs-in/);
    expect(tabMotion.animationDuration).toMatch(/0\.18s|180ms/);

    await page.emulateMedia({ reducedMotion: 'reduce' });
    await navigateInApp(page, '/documents');
    await page.getByRole('button', { name: /Фильтры/ }).first().click();
    const reducedDialog = page.locator('[data-slot="dialog-content"]').first();
    await expect(reducedDialog).toBeVisible();
    const reducedMotion = await motionSnapshot(reducedDialog);
    expect(reducedMotion.animationDuration).toMatch(/0\.001s|1ms/);
  });
});
