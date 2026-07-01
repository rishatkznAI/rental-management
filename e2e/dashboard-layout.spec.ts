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
    const radial = rectFor('[data-testid="dashboard-radial-overview"]');
    const radialCore = document.querySelector('[data-testid="dashboard-radial-core"]');
    const healthElement = document.querySelector('[data-testid="dashboard-company-health"]');
    const healthRect = healthElement?.getBoundingClientRect();
    const companyHealthOffenders = Array.from(healthElement?.querySelectorAll<HTMLElement>('*') ?? [])
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0
          && rect.height > 0
          && (
            rect.right > viewportWidth + 1
            || (healthRect ? rect.right > healthRect.right + 1 : false)
          );
      })
      .slice(0, 8)
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          tag: element.tagName.toLowerCase(),
          testId: element.getAttribute('data-testid') || '',
          className: String(element.className || '').slice(0, 120),
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          width: Math.round(rect.width),
        };
      });
    const header = rectFor('body > div header');
    const commandHeader = rectFor('.rentcore-command-header');
    const cockpit = rectFor('[data-testid="dashboard-top-cockpit"]');
    const screen = rectFor('.rentcore-command-screen');
    const radialNodes = Array.from(document.querySelectorAll('[data-testid="dashboard-radial-node"]'));
    const kpiCards = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="dashboard-executive-cockpit"] .rentcore-command-kpi'));
    const kpiReadability = kpiCards.map((card) => {
      const value = card.querySelector<HTMLElement>('.dashboard-kpi-value');
      const cardRect = card.getBoundingClientRect();
      const valueRect = value?.getBoundingClientRect();
      const style = value ? window.getComputedStyle(value) : null;
      return {
        text: value?.textContent?.trim() || '',
        cardWidth: Math.round(cardRect.width),
        valueWidth: Math.round(valueRect?.width || 0),
        clipped: Boolean(valueRect && (valueRect.left < cardRect.left - 1 || valueRect.right > cardRect.right + 1)),
        wordBreak: style?.wordBreak || '',
        overflowWrap: style?.overflowWrap || '',
      };
    });

    return {
      setupBannerCount: Array.from(document.body.querySelectorAll('*')).filter(element => element.textContent?.includes('Дашборд ещё собирает управленческую картину')).length,
      overflowX: scrollWidth - viewportWidth,
      offenders,
      header,
      commandHeader,
      cockpit,
      screen,
      board,
      health,
      radial,
      radialCoreExists: Boolean(document.querySelector('[data-testid="dashboard-radial-core"]')),
      radialNodeCount: radialNodes.length,
      radialEmptyExists: Boolean(document.querySelector('[data-testid="dashboard-radial-empty"]')),
      healthSvgCount: document.querySelectorAll('[data-testid="dashboard-company-health-svg"]').length,
      healthWidthShare: board && health ? health.width / Math.max(board.width, 1) : 1,
      companyHealthOffenders,
      radialWidthShare: health && radial ? radial.width / Math.max(health.width, 1) : 1,
      radialCoreText: radialCore?.textContent?.trim() || '',
      compactHealthCards: document.querySelectorAll('[data-testid="dashboard-company-health-compact"] a.rentcore-command-card').length,
      kpiReadability,
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

      expect(snapshot.setupBannerCount, `${viewport.name}: removed setup banner should not be visible`).toBe(0);
      expect(snapshot.overflowX, `${viewport.name}: document should not scroll horizontally (${JSON.stringify(snapshot)})`).toBeLessThanOrEqual(1);
      expect(snapshot.offenders, `${viewport.name}: visible elements should stay inside viewport`).toEqual([]);
      expect(snapshot.companyHealthOffenders, `${viewport.name}: company health children should stay inside card and viewport`).toEqual([]);
      expect(snapshot.screen?.top ?? 0, `${viewport.name}: dashboard content should start below header`).toBeGreaterThanOrEqual((snapshot.header?.bottom ?? 0) - 1);
      expect(snapshot.cockpit?.top ?? 0, `${viewport.name}: KPI row should start below the dashboard command header`).toBeGreaterThanOrEqual((snapshot.commandHeader?.bottom ?? 0) - 1);
      expect(snapshot.healthSvgCount, `${viewport.name}: company health should not render a dominant central SVG circle`).toBe(0);
      expect(snapshot.radial?.visible, `${viewport.name}: executive health visual should remain visible (${JSON.stringify(snapshot)})`).toBe(true);
      expect(snapshot.radial?.height ?? 0, `${viewport.name}: executive health visual should not collapse (${JSON.stringify(snapshot)})`).toBeGreaterThanOrEqual(200);
      expect(snapshot.radialCoreText, `${viewport.name}: empty radial core must not show a huge Нет placeholder`).not.toContain('Нет');
      expect(snapshot.radialCoreExists, `${viewport.name}: legacy radial core selector should be preserved (${JSON.stringify(snapshot)})`).toBe(true);
      expect(snapshot.radialEmptyExists, `${viewport.name}: legacy radial empty selector should be preserved (${JSON.stringify(snapshot)})`).toBe(true);
      expect(snapshot.radialNodeCount, `${viewport.name}: radial overview should keep business contour node selectors (${JSON.stringify(snapshot)})`).toBeGreaterThanOrEqual(6);
      expect(snapshot.compactHealthCards, `${viewport.name}: company health should keep all business contours`).toBeGreaterThanOrEqual(6);
      expect(snapshot.kpiReadability, `${viewport.name}: KPI values should render`).not.toEqual([]);
      expect(snapshot.kpiReadability.filter(item => item.clipped), `${viewport.name}: KPI values should not clip`).toEqual([]);
      expect(snapshot.kpiReadability.filter(item => item.wordBreak === 'break-all' || item.overflowWrap === 'anywhere'), `${viewport.name}: KPI values should not force letter wrapping`).toEqual([]);

      if (viewport.name === 'desktop') {
        expect(snapshot.healthWidthShare, `${viewport.name}: company health should be an executive-width module`).toBeGreaterThanOrEqual(0.75);
        expect(snapshot.radialWidthShare, `${viewport.name}: radial visual should not dominate company health (${JSON.stringify(snapshot)})`).toBeLessThanOrEqual(0.36);
        expect(Math.min(...snapshot.kpiReadability.map(item => item.cardWidth)), `${viewport.name}: KPI cards should keep readable width (${JSON.stringify(snapshot.kpiReadability)})`).toBeGreaterThanOrEqual(220);
      }
    });
  }

  test('dashboard keeps the same app shell and RentCore logo as equipment', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.addInitScript(() => {
      window.localStorage.setItem('rental-management:desktop-sidebar-state', 'expanded');
    });
    await loginAsAdmin(page);

    const shellSnapshot = async () => page.evaluate(() => {
      const aside = document.querySelector('aside');
      const logoTitle = aside?.querySelector('.app-shell-title');
      const themeToggle = aside?.querySelector('[data-testid="sidebar-theme-toggle"]');
      const search = aside?.querySelector('[data-sidebar-search]');
      const logoIcon = aside?.querySelector('img[alt="rentCore"]');
      const asideRect = aside?.getBoundingClientRect();
      return {
        asideWidth: Math.round(asideRect?.width || 0),
        logoText: logoTitle?.textContent?.trim() || '',
        logoVisible: Boolean(logoTitle && window.getComputedStyle(logoTitle).display !== 'none'),
        logoIconVisible: Boolean(logoIcon && window.getComputedStyle(logoIcon).display !== 'none'),
        themeToggleVisible: Boolean(themeToggle && window.getComputedStyle(themeToggle).display !== 'none'),
        searchVisible: Boolean(search && window.getComputedStyle(search).display !== 'none'),
        navButtonCount: aside?.querySelectorAll('nav button').length || 0,
      };
    });

    await navigateInApp(page, '/');
    await expect(page.getByRole('heading', { name: 'Операционный центр', exact: true })).toBeVisible();
    const dashboardShell = await shellSnapshot();

    await navigateInApp(page, '/equipment');
    await expect(page.getByRole('heading', { name: /Техника|Парк техники/ })).toBeVisible();
    const equipmentShell = await shellSnapshot();

    expect(dashboardShell.logoText, 'Dashboard should keep the global rentCore logo text').toMatch(/^rentcore$/i);
    expect(dashboardShell.logoText, 'Dashboard and Equipment should show the same brand text').toBe(equipmentShell.logoText);
    expect(dashboardShell.logoVisible, 'Dashboard logo text should be visible').toBe(true);
    expect(dashboardShell.logoIconVisible, 'Dashboard logo icon should be visible').toBe(true);
    expect(dashboardShell.themeToggleVisible, 'Dashboard sidebar theme toggle should stay visible').toBe(true);
    expect(dashboardShell.searchVisible, 'Dashboard sidebar search should stay visible').toBe(true);
    expect(dashboardShell, 'Dashboard and Equipment should use the same app shell primitives').toEqual(equipmentShell);
  });
});
