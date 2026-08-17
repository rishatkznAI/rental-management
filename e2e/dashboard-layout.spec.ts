import { expect, test, type Page } from '@playwright/test';
import { loginAsAdmin, navigateInApp } from './helpers/auth';

const VIEWPORTS = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1280, height: 800 },
  { name: 'tablet', width: 1024, height: 768 },
  { name: 'mobile', width: 390, height: 844 },
] as const;

type Scenario = 'healthy' | 'troubled' | 'empty' | 'partial';

function dateOffset(days: number) {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function dashboardFixture(scenario: Scenario) {
  if (scenario === 'empty' || scenario === 'partial') {
    return {
      equipment: [], rentals: [], gantt_rentals: [], payments: [], payment_allocations: [], service: [], clients: [], documents: [], deliveries: [], debt_collection_plans: [], crm_deals: [],
    };
  }

  const equipment = [
    { id: 'eq-1', category: 'own', status: 'rented', activeInFleet: true, inventoryNumber: 'INV-001', manufacturer: 'Mantall', model: 'HZ260', plannedMonthlyRevenue: 300000 },
    { id: 'eq-2', category: 'own', status: scenario === 'troubled' ? 'in_service' : 'rented', activeInFleet: true, inventoryNumber: 'INV-002', manufacturer: 'Mantall', model: 'XE80', plannedMonthlyRevenue: 240000 },
    { id: 'eq-3', category: 'own', status: 'rented', activeInFleet: true, inventoryNumber: 'INV-003', manufacturer: 'Dingli', model: 'JCPT', plannedMonthlyRevenue: 180000 },
    { id: 'eq-4', category: 'own', status: 'available', activeInFleet: true, inventoryNumber: 'INV-004', manufacturer: 'LGMG', model: 'AS1212', plannedMonthlyRevenue: 150000 },
  ];
  const clients = [
    { id: 'client-1', counterpartyId: 'cp-1', company: 'ООО Строй', status: 'active', manager: 'Администратор', creditLimit: 1000000 },
    { id: 'client-2', counterpartyId: 'cp-2', company: 'ООО Альфа', status: 'active', manager: 'Администратор', creditLimit: 1000000 },
  ];
  const gantt_rentals = [
    { id: 'rent-1', counterpartyId: 'cp-1', clientId: 'client-1', client: 'ООО Строй', equipmentId: 'eq-1', equipmentInv: 'INV-001', startDate: dateOffset(-12), endDate: scenario === 'troubled' ? dateOffset(-4) : dateOffset(12), status: 'active', amount: 280000, manager: 'Администратор', expectedPaymentDate: scenario === 'troubled' ? dateOffset(-9) : dateOffset(7) },
    { id: 'rent-2', counterpartyId: 'cp-2', clientId: 'client-2', client: 'ООО Альфа', equipmentId: 'eq-2', equipmentInv: 'INV-002', startDate: dateOffset(-7), endDate: dateOffset(15), status: 'active', amount: 210000, manager: 'Администратор', expectedPaymentDate: dateOffset(8) },
    { id: 'rent-3', counterpartyId: 'cp-1', clientId: 'client-1', client: 'ООО Строй', equipmentId: 'eq-3', equipmentInv: 'INV-003', startDate: dateOffset(-3), endDate: dateOffset(18), status: 'active', amount: 160000, manager: 'Администратор', expectedPaymentDate: dateOffset(10) },
  ];
  const rentals = gantt_rentals.map(rental => ({ ...rental, plannedReturnDate: rental.endDate, equipment: [rental.equipmentInv], price: rental.amount, rate: '', discount: 0, deliveryAddress: '', contact: '' }));
  const payments = scenario === 'healthy' ? [
    { id: 'pay-1', invoiceNumber: 'INV-PAY-1', counterpartyId: 'cp-1', clientId: 'client-1', rentalId: 'rent-1', amount: 280000, paidAmount: 280000, dueDate: dateOffset(-2), paidDate: dateOffset(-1), status: 'paid' },
    { id: 'pay-2', invoiceNumber: 'INV-PAY-2', counterpartyId: 'cp-2', clientId: 'client-2', rentalId: 'rent-2', amount: 210000, paidAmount: 210000, dueDate: dateOffset(-1), paidDate: dateOffset(0), status: 'paid' },
  ] : [];
  const payment_allocations = payments.map((payment, index) => ({ id: `alloc-${index + 1}`, paymentId: payment.id, rentalId: payment.rentalId, clientId: payment.clientId, amount: payment.paidAmount, status: 'active' }));
  const service = scenario === 'troubled' ? [
    { id: 'service-1', equipmentId: 'eq-2', equipment: 'Mantall XE80', inventoryNumber: 'INV-002', reason: 'Аварийный ремонт', priority: 'critical', status: 'in_progress', createdAt: `${dateOffset(-5)}T08:00:00.000Z`, plannedDate: dateOffset(-2) },
  ] : [];
  const deliveries = scenario === 'troubled' ? [
    { id: 'delivery-1', type: 'shipping', status: 'in_transit', transportDate: dateOffset(-2), origin: 'Склад', destination: 'Объект', cargo: 'Mantall', contactName: 'Иван', contactPhone: '+70000000000', cost: 10000, client: 'ООО Строй', counterpartyId: 'cp-1', clientId: 'client-1', equipmentId: 'eq-1', rentalId: 'rent-1', manager: 'Администратор', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), createdBy: 'admin' },
  ] : [];
  return { equipment, rentals, gantt_rentals, payments, payment_allocations, service, clients, documents: [], deliveries, debt_collection_plans: [], crm_deals: [] };
}

async function installScenario(page: Page, scenario: Scenario) {
  const fixture = dashboardFixture(scenario);
  await page.route('**/api/**', async route => {
    const request = route.request();
    if (request.method() !== 'GET') return route.continue();
    const url = new URL(request.url());
    const key = url.pathname.replace(/^\/api\//, '') as keyof typeof fixture;
    if (scenario === 'partial' && (key === 'payments' || key === 'service')) {
      return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'fixture unavailable' }) });
    }
    if (key in fixture) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(fixture[key]) });
    if (url.pathname === '/api/management/action-queue' && url.searchParams.get('view') === 'attention') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        ok: true,
        summary: { critical: 0, overdue: 0, dueToday: 0, unassigned: 0, stale: 0, totalEstimatedLoss: 0, totalDailyLoss: 0 },
        groups: { critical: [], today: [], unassigned: [], topLoss: [], byResponsibleArea: [] },
      }) });
    }
    return route.continue();
  });
}

async function layoutSnapshot(page: Page) {
  return page.evaluate(() => {
    const rect = (testId: string) => {
      const element = document.querySelector<HTMLElement>(`[data-testid="${testId}"]`);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { top: box.top, bottom: box.bottom, left: box.left, right: box.right, width: box.width, height: box.height };
    };
    const viewportWidth = document.documentElement.clientWidth;
    const offenders = Array.from(document.body.querySelectorAll<HTMLElement>('*')).filter(element => {
      const style = getComputedStyle(element);
      if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed') return false;
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.right > viewportWidth + 1;
    }).slice(0, 8).map(element => ({ tag: element.tagName, testId: element.dataset.testid || '', width: element.getBoundingClientRect().width }));
    const kpiValues = Array.from(document.querySelectorAll<HTMLElement>('.dashboard-kpi-value')).map(element => ({ text: element.textContent || '', clipped: element.scrollWidth > element.clientWidth + 1 }));
    return {
      overflowX: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - viewportWidth,
      offenders,
      attention: rect('dashboard-key-signals'), kpis: rect('dashboard-top-cockpit'), month: rect('dashboard-month-dynamics'), money: rect('dashboard-receivables-aging'), fleet: rect('dashboard-fleet-utilization'), service: rect('dashboard-service-executive'), health: rect('dashboard-company-health'), header: rect('dashboard-executive-header'), kpiValues,
    };
  });
}

test.describe('Dashboard V2 responsive executive hierarchy', () => {
  for (const viewport of VIEWPORTS) {
    test(`${viewport.name} has no overflow and preserves priority`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await loginAsAdmin(page);
      await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
      await expect(page.getByTestId('dashboard-executive-cockpit').locator('a')).toHaveCount(4);
      for (const heading of ['Требует внимания', 'Динамика месяца', 'Здоровье компании', 'Парк', 'Деньги', 'Сервис']) {
        await expect(page.getByRole('heading', { name: heading, exact: true })).toBeAttached();
      }
      const snapshot = await layoutSnapshot(page);
      expect(snapshot.overflowX, JSON.stringify(snapshot)).toBeLessThanOrEqual(0);
      expect(snapshot.offenders, JSON.stringify(snapshot)).toEqual([]);
      expect(snapshot.kpiValues.length).toBe(4);
      expect(snapshot.kpiValues.filter(item => item.clipped), JSON.stringify(snapshot.kpiValues)).toEqual([]);
      expect(snapshot.header?.height || 0).toBeLessThanOrEqual(120);
      if (viewport.name === 'mobile') {
        expect(snapshot.attention?.top || 0).toBeLessThan(snapshot.kpis?.top || 0);
        expect(snapshot.kpis?.top || 0).toBeLessThan(snapshot.month?.top || 0);
        expect(snapshot.money?.top || 0).toBeLessThan(snapshot.fleet?.top || 0);
        expect(snapshot.fleet?.top || 0).toBeLessThan(snapshot.service?.top || 0);
        expect(snapshot.service?.top || 0).toBeLessThan(snapshot.health?.top || 0);
      } else if (viewport.width >= 1280) {
        expect(snapshot.kpis?.top || 0).toBeLessThan(snapshot.attention?.top || 0);
        expect(snapshot.health?.height || 0).toBeLessThanOrEqual(300);
      }
    });
  }
});

test.describe('Dashboard V2 data states', () => {
  for (const scenario of ['healthy', 'troubled', 'empty', 'partial'] as const) {
    test(`${scenario} fixture remains honest and actionable`, async ({ page }) => {
      await page.setViewportSize({ width: 1280, height: 800 });
      await loginAsAdmin(page);
      const pageErrors: string[] = [];
      page.on('pageerror', error => pageErrors.push(error.stack || error.message));
      await installScenario(page, scenario);
      await navigateInApp(page, '/');
      await expect(page.getByRole('heading', { name: 'Dashboard', exact: true })).toBeVisible();
      await page.waitForTimeout(250);
      expect(pageErrors, pageErrors.join('\n')).toEqual([]);
      if (scenario === 'healthy') {
        await expect(page.getByTestId('dashboard-kpi-month-payments')).toContainText('₽');
        await expect(page.getByTestId('dashboard-key-signals')).not.toContainText('Просроченная дебиторка');
      }
      if (scenario === 'troubled') {
        await expect(page.getByTestId('dashboard-kpi-overdue-debt')).toContainText('Не подтверждены договорные сроки');
        await expect(page.getByTestId('dashboard-key-signals')).not.toContainText('Просроченная дебиторка');
        await expect(page.getByTestId('dashboard-key-signals')).toContainText('Сервисные блокеры');
        await expect(page.getByTestId('dashboard-key-signals').getByRole('link').first()).toHaveAttribute('href', /finance|rentals|service|deliveries/);
      }
      if (scenario === 'empty') {
        await expect(page.getByTestId('dashboard-kpi-month-payments')).toContainText('За выбранный период поступлений нет');
        await expect(page.getByTestId('dashboard-kpi-month-payments')).not.toContainText('Нет данных');
      }
      if (scenario === 'partial') {
        await expect(page.getByText('Часть данных недоступна', { exact: true })).toBeVisible();
        await expect(page.getByTestId('dashboard-kpi-month-payments')).toContainText('—');
        await expect(page.getByTestId('dashboard-service-executive')).toContainText('—');
        await expect(page.getByTestId('dashboard-service-executive')).toContainText('Не удалось загрузить данные блока');
      }
      const snapshot = await layoutSnapshot(page);
      expect(snapshot.overflowX, JSON.stringify(snapshot)).toBeLessThanOrEqual(0);
      expect(snapshot.offenders, JSON.stringify(snapshot)).toEqual([]);
      if (scenario === 'empty' || scenario === 'partial') {
        expect(snapshot.attention?.height || 0, JSON.stringify(snapshot)).toBeLessThanOrEqual(220);
        expect(snapshot.month?.height || 0, JSON.stringify(snapshot)).toBeLessThanOrEqual(300);
      }
      expect(pageErrors, pageErrors.join('\n')).toEqual([]);
    });
  }
});
