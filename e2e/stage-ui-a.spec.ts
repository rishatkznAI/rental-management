import { expect, test } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

test('Stage UI-A preserves reduced motion and the four-KPI dashboard contract', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: 'dark' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await loginAsAdmin(page);
  await navigateInApp(page, '/');

  const dashboard = page.locator('.rentcore-command-screen');
  await expect(dashboard).toHaveAttribute('data-reduced-motion', 'true');
  await expect(page.locator('[data-testid="dashboard-executive-cockpit"] .rentcore-command-kpi')).toHaveCount(4);

  const visualContract = await page.evaluate(() => {
    const rootStyle = getComputedStyle(document.documentElement);
    const reveal = document.querySelector<HTMLElement>('.rentcore-dashboard-reveal');
    const sidebar = document.querySelector<HTMLElement>('aside');
    return {
      background: rootStyle.getPropertyValue('--background').trim(),
      primary: rootStyle.getPropertyValue('--primary').trim(),
      revealAnimationDuration: reveal ? getComputedStyle(reveal).animationDuration : '',
      revealAnimationDelay: reveal ? getComputedStyle(reveal).animationDelay : '',
      sidebarTransitionDuration: sidebar ? getComputedStyle(sidebar).transitionDuration : '',
      sidebarWidth: Math.round(sidebar?.getBoundingClientRect().width || 0),
    };
  });

  expect(visualContract).toEqual({
    background: '#080c12',
    primary: '#b7f23a',
    revealAnimationDuration: '0.001s',
    revealAnimationDelay: '0s',
    sidebarTransitionDuration: '0.001s',
    sidebarWidth: 248,
  });
});
