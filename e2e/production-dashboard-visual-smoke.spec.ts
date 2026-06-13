import { expect, request as playwrightRequest, test, type Browser, type Page, type TestInfo } from '@playwright/test';
import { requiredEnv } from './helpers/releaseSmoke';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

type Theme = 'dark' | 'light';
type ViewportName = 'desktop-1440' | 'mobile-390';

type VisualCase = {
  theme: Theme;
  viewportName: ViewportName;
  viewport: { width: number; height: number };
};

type UiIssue = {
  type: string;
  caseName: string;
  url?: string;
  status?: number;
  text?: string;
};

const VISUAL_CASES: VisualCase[] = [
  { theme: 'dark', viewportName: 'desktop-1440', viewport: { width: 1440, height: 900 } },
  { theme: 'dark', viewportName: 'mobile-390', viewport: { width: 390, height: 844 } },
  { theme: 'light', viewportName: 'desktop-1440', viewport: { width: 1440, height: 900 } },
  { theme: 'light', viewportName: 'mobile-390', viewport: { width: 390, height: 844 } },
];

function productionAppUrl(frontendUrl: string, route = '/') {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  return `${frontendUrl.replace(/\/$/, '')}/?debugVersion=1&_smoke=${Date.now()}#${normalizedRoute}`;
}

function sanitize(text = '', limit = 800) {
  return text
    .replace(/[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, '[token]')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer [token]')
    .slice(0, limit);
}

function parseRgb(value: string) {
  const match = value.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/i);
  if (!match) return null;
  return {
    r: Number(match[1]),
    g: Number(match[2]),
    b: Number(match[3]),
  };
}

function luminance(value: string) {
  const rgb = parseRgb(value);
  if (!rgb) return 0;
  return (0.2126 * rgb.r) + (0.7152 * rgb.g) + (0.0722 * rgb.b);
}

async function installReadOnlyGuard(page: Page, apiUrl: string, issues: UiIssue[], caseName: string) {
  await page.route('**/api/**', async (route) => {
    const request = route.request();
    const method = request.method().toUpperCase();
    if (['GET', 'HEAD', 'OPTIONS'].includes(method)) {
      await route.continue();
      return;
    }
    issues.push({ type: 'blocked-write', caseName, url: request.url(), text: method });
    await route.abort('blockedbyclient');
  });

  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    issues.push({ type: 'console.error', caseName, url: page.url(), text: sanitize(text) });
  });

  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', caseName, url: page.url(), text: sanitize(error.stack || error.message) });
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    const path = new URL(url).pathname;
    const isApi = url.startsWith(apiUrl) || /\/api\//.test(url);
    if (status >= 500) {
      issues.push({ type: 'http-5xx', caseName, url, status });
      return;
    }
    if (isApi && [401, 403].includes(status) && path !== '/api/auth/me') {
      issues.push({ type: 'authz-response', caseName, url, status });
    }
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || '';
    if (failure === 'net::ERR_ABORTED' || /favicon|\.map($|\?)/.test(request.url())) return;
    issues.push({ type: 'requestfailed', caseName, url: request.url(), text: sanitize(failure) });
  });
}

async function expectNoHorizontalOverflow(page: Page, caseName: string) {
  const overflow = await page.evaluate(() => {
    const documentWidth = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*'))
      .filter((element) => {
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') return false;
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && (rect.left < -1 || rect.right > documentWidth + 1);
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
    return {
      documentWidth,
      scrollWidth,
      overflowX: scrollWidth - documentWidth,
      offenders,
    };
  });

  expect(overflow.overflowX, `${caseName}: document should not scroll horizontally (${JSON.stringify(overflow)})`).toBeLessThanOrEqual(1);
  expect(overflow.offenders, `${caseName}: visible elements should stay inside viewport`).toEqual([]);
}

async function expectTheme(page: Page, theme: Theme, caseName: string) {
  const colors = await page.evaluate(() => {
    const sidebar = window.innerWidth < 640
      ? Array.from(document.querySelectorAll('nav')).find((element) => window.getComputedStyle(element).position === 'fixed')
      : document.querySelector('aside');
    const main = document.querySelector('main');
    const body = document.body;
    return {
      htmlClass: document.documentElement.className,
      storedTheme: window.localStorage.getItem('theme'),
      bodyBackground: window.getComputedStyle(body).backgroundColor,
      mainBackground: main ? window.getComputedStyle(main).backgroundColor : '',
      sidebarBackground: sidebar ? window.getComputedStyle(sidebar).backgroundColor : '',
    };
  });

  expect(colors.storedTheme, `${caseName}: localStorage theme should be ${theme}`).toBe(theme);
  if (theme === 'dark') {
    expect(colors.htmlClass, `${caseName}: html should have dark class`).toMatch(/\bdark\b/);
    expect(luminance(colors.bodyBackground), `${caseName}: dark body should be visually dark`).toBeLessThan(90);
    expect(luminance(colors.sidebarBackground), `${caseName}: dark sidebar should be visually dark`).toBeLessThan(120);
    return;
  }

  expect(colors.htmlClass, `${caseName}: html should not have dark class`).not.toMatch(/\bdark\b/);
  expect(luminance(colors.bodyBackground), `${caseName}: light body should be visually light`).toBeGreaterThan(180);
  expect(luminance(colors.sidebarBackground), `${caseName}: light sidebar should be visually light`).toBeGreaterThan(170);
}

async function captureDashboardCase(
  browser: Browser,
  testInfo: TestInfo,
  visualCase: VisualCase,
  config: { frontendUrl: string; apiUrl: string; token: string },
): Promise<{ frontendCommit: string; apiBaseUrl: string }> {
  const caseName = `${visualCase.theme}-${visualCase.viewportName}`;
  const issues: UiIssue[] = [];
  const context = await browser.newContext({ viewport: visualCase.viewport });
  const page = await context.newPage();
  await installReadOnlyGuard(page, config.apiUrl, issues, caseName);
  await page.addInitScript(({ token, theme }) => {
    window.localStorage.setItem('app_auth_token', token);
    window.localStorage.setItem('theme', theme);
    document.documentElement.classList.toggle('dark', theme === 'dark');
  }, { token: config.token, theme: visualCase.theme });

  try {
    await page.goto(productionAppUrl(config.frontendUrl, '/'), { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => Boolean(window.__SKYTECH_BUILD_INFO__?.commit));
    const frontendBuild = await page.evaluate(() => window.__SKYTECH_BUILD_INFO__ || null);
    await expect(page.getByRole('heading', { name: 'Операционный центр', exact: true }), `${caseName}: dashboard heading`).toBeVisible();
    await expect(page.getByRole('navigation').first(), `${caseName}: sidebar navigation`).toBeVisible();
    await expect(page.getByTestId('dashboard-executive-cockpit'), `${caseName}: dashboard cockpit`).toBeVisible();

    await expectTheme(page, visualCase.theme, caseName);
    await expectNoHorizontalOverflow(page, caseName);
    expect(issues, `${caseName}: console/page/request errors`).toEqual([]);

    await page.screenshot({
      path: testInfo.outputPath(`production-dashboard-${caseName}.png`),
      fullPage: true,
    });

    const viewport = page.viewportSize();
    console.log('[production-dashboard-visual-smoke] result', JSON.stringify({
      caseName,
      viewport,
      theme: visualCase.theme,
      frontendCommit: frontendBuild?.commit || '',
      horizontalOverflow: false,
      errors: 0,
    }));
    return {
      frontendCommit: frontendBuild?.commit || '',
      apiBaseUrl: frontendBuild?.apiBaseUrl || '',
    };
  } finally {
    await context.close();
  }
}

test('production authenticated dashboard visual smoke', async ({ browser }) => {
  test.setTimeout(180_000);

  const apiUrl = requiredEnv('PRODUCTION_API_URL', 'production dashboard visual smoke').replace(/\/$/, '');
  const frontendUrl = requiredEnv('PRODUCTION_FRONTEND_URL', 'production dashboard visual smoke').replace(/\/$/, '');
  const expectedCommit = String(process.env.EXPECTED_RELEASE_COMMIT || '').trim();

  const api = await playwrightRequest.newContext({ baseURL: apiUrl });
  try {
    const versionResponse = await api.get('/api/version');
    expect(versionResponse.ok(), 'production /api/version should return 200').toBeTruthy();
    const version = await versionResponse.json() as {
      ok?: boolean;
      build?: { commit?: string; commitFull?: string };
      app?: { disabled?: boolean };
    };
    expect(version.ok, 'production /api/version should report ok=true').toBe(true);
    expect(version.app?.disabled, 'production app.disabled should be false for authenticated visual smoke').toBe(false);

    if (expectedCommit) {
      const backendCommit = version.build?.commitFull || version.build?.commit || '';
      expect(
        backendCommit.startsWith(expectedCommit) || expectedCommit.startsWith(backendCommit) || backendCommit.startsWith(expectedCommit.slice(0, 12)),
        `backend marker should match expected production commit: expected=${expectedCommit.slice(0, 12)} backend=${backendCommit}`,
      ).toBeTruthy();
    }

    const loginResponse = await api.post('/api/auth/login', {
      data: {
        email: requiredEnv('PRODUCTION_ADMIN_EMAIL', 'production dashboard visual smoke'),
        password: requiredEnv('PRODUCTION_ADMIN_PASSWORD', 'production dashboard visual smoke'),
      },
    });
    expect(loginResponse.ok(), `production login should return 200: ${loginResponse.status()}`).toBeTruthy();
    const login = await loginResponse.json() as { token?: string };
    expect(login.token, 'production login should return token').toBeTruthy();

    const frontendBuilds = [];
    for (const visualCase of VISUAL_CASES) {
      frontendBuilds.push(await captureDashboardCase(browser, test.info(), visualCase, { frontendUrl, apiUrl, token: login.token || '' }));
    }
    for (const frontendBuild of frontendBuilds) {
      expect(frontendBuild.apiBaseUrl, 'frontend marker should point at production API').toBe(apiUrl);
      if (expectedCommit) {
        expect(
          frontendBuild.frontendCommit.startsWith(expectedCommit.slice(0, 12)) || expectedCommit.startsWith(frontendBuild.frontendCommit),
          `frontend marker should match expected production commit: expected=${expectedCommit.slice(0, 12)} frontend=${frontendBuild.frontendCommit}`,
        ).toBeTruthy();
      }
    }

    console.log('[production-dashboard-visual-smoke] frontend marker', JSON.stringify({
      expectedCommit: expectedCommit.slice(0, 12),
      frontendCommit: frontendBuilds[0]?.frontendCommit || '',
      backendCommit: version.build?.commit || version.build?.commitFull || '',
    }));
  } finally {
    await api.dispose();
  }
});
