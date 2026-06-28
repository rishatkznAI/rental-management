import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

async function dashboardLayoutSnapshot(page: Page) {
  return page.evaluate(() => {
    const rectFor = (selector: string) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      const style = window.getComputedStyle(element);
      return {
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
        visible: style.display !== 'none' && style.visibility !== 'hidden' && rect.width > 0 && rect.height > 0,
      };
    };

    const viewportWidth = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && rect.right > viewportWidth + 1;
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          testId: element.getAttribute('data-testid') || '',
          className: String(element.className || '').slice(0, 120),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });

    const board = rectFor('[data-testid="dashboard-command-board"]');
    const health = rectFor('[data-testid="dashboard-company-health"]');
    const header = rectFor('body > div header');
    const commandHeader = rectFor('.rentcore-command-header');
    const cockpit = rectFor('[data-testid="dashboard-top-cockpit"]');
    const screen = rectFor('.rentcore-command-screen');

    return {
      overflowX: scrollWidth - viewportWidth,
      offenders,
      header,
      commandHeader,
      cockpit,
      screen,
      board,
      health,
      healthSvgCount: document.querySelectorAll('[data-testid="dashboard-company-health-svg"]').length,
      healthWidthShare: board && health ? health.width / Math.max(board.width, 1) : 1,
      compactHealthCards: document.querySelectorAll('[data-testid="dashboard-company-health-compact"] a.rentcore-command-card').length,
    };
  });
}

test.describe('Dashboard enterprise layout', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} keeps dashboard aligned and readable`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginAsAdmin(page);
      await navigateInApp(page, '/');

      await expect(page.getByRole('heading', { name: 'Операционный центр', exact: true })).toBeVisible();
      for (const label of ['Критические сигналы', 'Задачи', 'Динамика месяца', 'Загрузка техники', 'Возраст дебиторки']) {
        await expect(page.getByText(label, { exact: true }).first(), `${label} should be visible`).toBeVisible();
      }

      const snapshot = await dashboardLayoutSnapshot(page);

      expect(snapshot.overflowX, `${viewport.name}: document should not scroll horizontally (${JSON.stringify(snapshot)})`).toBeLessThanOrEqual(1);
      expect(snapshot.offenders, `${viewport.name}: visible elements should stay inside viewport`).toEqual([]);
      expect(snapshot.screen?.top ?? 0, `${viewport.name}: dashboard content should start below header`).toBeGreaterThanOrEqual((snapshot.header?.bottom ?? 0) - 1);
      expect(snapshot.cockpit?.top ?? 0, `${viewport.name}: KPI row should start below the dashboard command header`).toBeGreaterThanOrEqual((snapshot.commandHeader?.bottom ?? 0) - 1);
      expect(snapshot.healthSvgCount, `${viewport.name}: company health should not render a dominant central SVG circle`).toBe(0);
      expect(snapshot.compactHealthCards, `${viewport.name}: compact company health should keep all business contours`).toBeGreaterThanOrEqual(6);

      if (viewport.name === 'desktop') {
        expect(snapshot.healthWidthShare, `${viewport.name}: company health should not dominate dashboard width`).toBeLessThanOrEqual(0.38);
      }
    });
  }
});
