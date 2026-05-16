import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, loginAsRentalManager, navigateInApp } from './helpers/auth';

type ApiHit = {
  method: string;
  status?: number;
  url: string;
};

function apiPath(url: string) {
  const parsed = new URL(url);
  return `${parsed.pathname}${parsed.search}`;
}

function installGateRecorder(page: Page) {
  const requests: ApiHit[] = [];
  const failures: ApiHit[] = [];
  const consoleErrors: string[] = [];

  page.on('request', request => {
    if (request.url().includes('/api/')) {
      requests.push({ method: request.method(), url: apiPath(request.url()) });
    }
  });
  page.on('response', response => {
    if (!response.url().includes('/api/')) return;
    const hit = { method: response.request().method(), status: response.status(), url: apiPath(response.url()) };
    if ([401, 403, 500].includes(response.status())) failures.push(hit);
  });
  page.on('console', message => {
    if (message.type() === 'error' && !/ResizeObserver|favicon|React DevTools/i.test(message.text())) {
      consoleErrors.push(message.text());
    }
  });

  return { requests, failures, consoleErrors };
}

function resetGate(gate: ReturnType<typeof installGateRecorder>) {
  gate.requests.length = 0;
  gate.failures.length = 0;
  gate.consoleErrors.length = 0;
}

function isFullGet(hits: ApiHit[], path: string) {
  return hits.some(hit => hit.method === 'GET' && hit.url === path);
}

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

test.describe('fix-forward pagination production smoke gates', () => {
  test('documents ordinary list avoids full documents and lazy references before wizard', async ({ page }) => {
    const gate = installGateRecorder(page);
    await loginAsAdmin(page);
    resetGate(gate);
    await navigateInApp(page, '/documents');
    await expect(page.locator('main').getByText('На странице')).toBeVisible();
    await expect.poll(() => gate.requests.some(hit =>
      hit.method === 'GET' &&
      hit.url.startsWith('/api/documents?') &&
      hit.url.includes('paginated=true'),
    )).toBeTruthy();
    await expect.poll(() => gate.requests.some(hit => hit.url === '/api/documents/registry/summary')).toBeTruthy();

    expect(isFullGet(gate.requests, '/api/documents')).toBeFalsy();
    expect(gate.requests.some(hit => hit.url.startsWith('/api/documents/references'))).toBeFalsy();
    expect(gate.failures).toEqual([]);
    expect(gate.consoleErrors).toEqual([]);
  });

  test('rental manager payments opens without receivables 403 and uses scoped backend summary', async ({ page }) => {
    const gate = installGateRecorder(page);
    await loginAsRentalManager(page);
    resetGate(gate);
    await navigateInApp(page, '/payments');
    await expect(page.locator('main').getByText('На странице')).toBeVisible();
    await expect.poll(() => gate.requests.some(hit =>
      hit.method === 'GET' &&
      hit.url.startsWith('/api/payments?') &&
      hit.url.includes('paginated=true'),
    )).toBeTruthy();
    await expect.poll(() => gate.requests.some(hit => hit.method === 'GET' && hit.url === '/api/finance/receivables')).toBeTruthy();

    expect(gate.failures).toEqual([]);
    expect(gate.consoleErrors).toEqual([]);
  });

  test('service ordinary list avoids full service load', async ({ page }) => {
    const gate = installGateRecorder(page);
    await loginAsAdmin(page);
    resetGate(gate);
    await navigateInApp(page, '/service');
    await expect(page.locator('main').getByText('На странице')).toBeVisible();
    await expect.poll(() => gate.requests.some(hit =>
      hit.method === 'GET' &&
      hit.url.startsWith('/api/service?') &&
      hit.url.includes('paginated=true'),
    )).toBeTruthy();

    expect(isFullGet(gate.requests, '/api/service')).toBeFalsy();
    expect(gate.failures).toEqual([]);
    expect(gate.consoleErrors).toEqual([]);
  });
});
