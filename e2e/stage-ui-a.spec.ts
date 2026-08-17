import { expect, test } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

test('Stage UI-A preserves reduced motion and the active four-KPI dashboard contract', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsAdmin(page);
  await navigateInApp(page, '/');

  const dashboard = page.locator('.rentcore-command-screen');
  await expect(dashboard).toBeVisible();
  await expect(page.locator('[data-testid="dashboard-executive-cockpit"] .rentcore-command-kpi')).toHaveCount(4);

  const visualContract = await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const kpi = document.querySelector<HTMLElement>('[data-testid="dashboard-executive-cockpit"] .rentcore-command-kpi');
    const sidebar = document.querySelector<HTMLElement>('aside');
    return {
      background: rootStyle.getPropertyValue('--background').trim(),
      primary: rootStyle.getPropertyValue('--primary').trim(),
      retiredRevealCount: document.querySelectorAll('.rentcore-dashboard-reveal').length,
      kpiTransitionDuration: kpi ? getComputedStyle(kpi).transitionDuration : '',
      sidebarTransitionDuration: sidebar ? getComputedStyle(sidebar).transitionDuration : '',
      sidebarWidth: Math.round(sidebar?.getBoundingClientRect().width || 0),
    };
  });

  expect(visualContract).toEqual({
    background: '#080c12',
    primary: '#b7f23a',
    retiredRevealCount: 0,
    kpiTransitionDuration: '0.001s',
    sidebarTransitionDuration: '0.001s',
    sidebarWidth: 248,
  });
});
