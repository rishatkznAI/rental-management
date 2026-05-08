import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login, navigateInApp } from './helpers/auth';
import { withAdminApi } from './helpers/api';

type UiIssue = {
  type: string;
  action: string;
  url: string;
  text?: string;
  status?: number;
};

type SeedData = {
  client: { id: string; company: string; contact: string };
  equipment: { id: string; inventoryNumber: string; serialNumber: string; manufacturer: string; model: string };
  rentalEquipment: { id: string; inventoryNumber: string; serialNumber: string };
  serviceEquipment: { id: string; inventoryNumber: string; serialNumber: string };
  rental: { id: string };
  serviceTicket: { id: string; reason: string };
};

const OFFICE_CREDENTIALS = {
  email: 'smoke-office@yandex.ru',
  password: '123123',
};

const OFFICE_SECTIONS: Array<{ name: RegExp; label: string; route: string }> = [
  { name: /^Дашборд/, label: 'Дашборд', route: '/' },
  { name: /^Центр задач/, label: 'Центр задач', route: '/tasks' },
  { name: /^Техника/, label: 'Техника', route: '/equipment' },
  { name: /^GSM/, label: 'GSM', route: '/gsm' },
  { name: /^База знаний/, label: 'База знаний', route: '/knowledge-base' },
  { name: /^Продажи/, label: 'Продажи', route: '/sales' },
  { name: /^Доставка/, label: 'Доставка', route: '/deliveries' },
  { name: /^Аренды/, label: 'Аренды', route: '/rentals' },
  { name: /^Планировщик/, label: 'Планировщик', route: '/planner' },
  { name: /^Сервис/, label: 'Сервис', route: '/service' },
  { name: /^Сл\. машины/, label: 'Служебные машины', route: '/service-vehicles' },
  { name: /^Клиенты/, label: 'Клиенты', route: '/clients' },
  { name: /^Документы/, label: 'Документы', route: '/documents' },
  { name: /^Платежи/, label: 'Платежи', route: '/payments' },
  { name: /^Личные настройки/, label: 'Личные настройки', route: '/settings' },
];

const FORBIDDEN_NAV_ITEMS = [
  /^Финансы/,
  /^Бот/,
  /^Отчёты/,
  /^Панель администратора/,
];

function sanitize(text: string) {
  return text.replace(/[a-f0-9]{64}/gi, '[token]').slice(0, 800);
}

function isIgnoredRequestFailure(url: string, failure: string) {
  if (failure === 'net::ERR_ABORTED') return true;
  return /favicon|\.map($|\?)|fonts\.googleapis\.com|interactive-examples\.mdn\.mozilla\.net|tile\.openstreetmap\.org|\/node_modules\/\.vite\/deps\/|\/src\/app\/pages\//.test(url);
}

function installUiGuards(page: Page, issues: UiIssue[], getAction: () => string) {
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    if (/ResizeObserver loop|Download the React DevTools|favicon/i.test(text)) return;
    issues.push({ type: 'console.error', action: getAction(), url: page.url(), text: sanitize(text) });
  });

  page.on('pageerror', (error) => {
    issues.push({ type: 'pageerror', action: getAction(), url: page.url(), text: sanitize(error.stack || error.message) });
  });

  page.on('requestfailed', (request) => {
    const failure = request.failure()?.errorText || '';
    if (isIgnoredRequestFailure(request.url(), failure)) return;
    issues.push({ type: 'requestfailed', action: getAction(), url: request.url(), text: sanitize(failure) });
  });

  page.on('response', (response) => {
    const status = response.status();
    const url = response.url();
    const isApi = /\/api\//.test(url);
    if (status >= 500 || (isApi && [400, 401, 403, 404, 409, 422].includes(status))) {
      issues.push({ type: 'bad-response', action: getAction(), url, status });
    }
  });
}

async function expectHealthyScreen(page: Page, action: string) {
  const main = page.locator('main');
  await expect(main, `${action}: main should be visible`).toBeVisible();
  const text = (await main.innerText()).trim();
  expect(text.length, `${action}: main should not be blank`).toBeGreaterThan(10);
  await expect(page.getByText(/Cannot read properties|Maximum update depth exceeded|Unexpected Application Error|Application error|Something went wrong|ошибка приложения/i)).toHaveCount(0);
}

async function openSectionFromSidebar(page: Page, section: { name: RegExp; label: string; route: string }) {
  const button = page.locator('aside').getByRole('button', { name: section.name });
  await expect(button, `${section.label} nav button should be visible`).toBeVisible();
  await button.click();
  await goToRoute(page, section.route);
  await expectHealthyScreen(page, `open ${section.label}`);
}

async function goToRoute(page: Page, route: string) {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  const appRoot = await page.evaluate(() => `${window.location.origin}${window.location.pathname}`);
  await page.goto(`${appRoot}?_smoke=${Date.now()}#${normalizedRoute}`, { waitUntil: 'domcontentloaded' });
}

async function exerciseVisibleTabs(page: Page, label: string) {
  const tabs = page.locator('main').getByRole('tab');
  const count = await tabs.count();
  for (let index = 0; index < Math.min(count, 8); index += 1) {
    const tab = tabs.nth(index);
    if (await tab.isVisible() && await tab.isEnabled()) {
      await tab.click();
      await expectHealthyScreen(page, `${label} tab ${index + 1}`);
    }
  }
}

async function closeDialogIfOpen(page: Page) {
  const dialog = page.getByRole('dialog');
  if (!(await dialog.first().isVisible().catch(() => false))) return;

  await page.keyboard.press('Escape');
  if (await dialog.first().isHidden({ timeout: 5_000 }).catch(() => false)) return;

  const closeButton = dialog.first().getByRole('button', { name: /Отмена|Закрыть|Готово/ });
  if ((await closeButton.count()) > 0 && await closeButton.first().isVisible()) {
    await closeButton.first().click({ force: true, timeout: 3_000 });
  } else {
    await page.keyboard.press('Escape');
  }
  await expect(dialog.first()).toBeHidden({ timeout: 5_000 });
}

async function exerciseFilters(page: Page, label: string) {
  const filters = page.locator('main').getByRole('button', { name: /Фильтры|Фильтр/ });
  if ((await filters.count()) === 0) return;
  const first = filters.first();
  if (!(await first.isVisible()) || !(await first.isEnabled())) return;
  await first.click();
  await expectHealthyScreen(page, `${label} filters`);
  const dialog = page.getByRole('dialog').first();
  if (await dialog.isVisible().catch(() => false)) {
    const done = dialog.getByRole('button', { name: /Готово|Закрыть|Отмена/ }).last();
    if ((await done.count()) > 0 && await done.isVisible()) {
      await done.click({ timeout: 5_000 });
    } else {
      await page.keyboard.press('Escape');
    }
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }
}

async function postJson<T>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post(path, { data });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

async function ensureSmokeOfficeUser(api: APIRequestContext) {
  const usersResponse = await api.get('/api/users');
  expect(usersResponse.ok()).toBeTruthy();
  const users = await usersResponse.json() as Array<{ email?: string; role?: string; status?: string }>;
  const existing = users.find(user => String(user.email || '').toLowerCase() === OFFICE_CREDENTIALS.email);
  if (existing) {
    expect(existing.role, 'existing smoke-office user must keep office role').toMatch(/Офис-менеджер|office/i);
    expect(existing.status, 'existing smoke-office user must be active').toBe('Активен');
    return;
  }

  const create = await api.post('/api/users', {
    data: {
      name: 'SMOKE-OFFICE-User',
      email: OFFICE_CREDENTIALS.email,
      role: 'Офис-менеджер',
      status: 'Активен',
      password: OFFICE_CREDENTIALS.password,
    },
  });
  expect(create.ok(), `create smoke-office user: ${create.status()} ${await create.text()}`).toBeTruthy();
}

async function seedSmokeOfficeData(api: APIRequestContext, suffix: string): Promise<SeedData> {
  const prefix = `SMOKE-OFFICE-${suffix}`;
  const client = await postJson<{ id: string; company: string; contact: string }>(api, '/api/clients', {
    company: `${prefix}-Client`,
    inn: `${Date.now()}`.slice(-10),
    contact: `${prefix}-Contact`,
    phone: '+79990000002',
    email: `smoke-office-client-${suffix}@example.local`,
    address: `${prefix}-Address`,
    paymentTerms: 'Постоплата 14 дней',
    creditLimit: 0,
    debt: 0,
    totalRentals: 0,
    status: 'active',
    createdAt: new Date().toISOString(),
    createdBy: 'Playwright',
    notes: prefix,
    history: [],
  });

  async function createEquipment(kind: string) {
    return postJson<{ id: string; inventoryNumber: string; serialNumber: string; manufacturer: string; model: string }>(api, '/api/equipment', {
      inventoryNumber: `SO-${kind}-${suffix}`.slice(0, 18),
      manufacturer: 'SMOKE-OFFICE',
      model: `Lift-${kind}`,
      type: 'scissor',
      drive: 'electric',
      serialNumber: `${prefix}-SN-${kind}`,
      year: 2026,
      hours: 12,
      liftHeight: 8,
      workingHeight: 10,
      location: `${prefix}-Yard`,
      status: 'available',
      owner: 'own',
      category: 'own',
      priority: 'medium',
      activeInFleet: true,
      plannedMonthlyRevenue: 0,
      nextMaintenance: '2026-06-01',
      history: [],
    });
  }

  const equipment = await createEquipment('CARD');
  const rentalEquipment = await createEquipment('RENT');
  const serviceEquipment = await createEquipment('SERV');

  const rental = await postJson<{ id: string }>(api, '/api/rentals', {
    client: client.company,
    clientId: client.id,
    contact: client.contact,
    startDate: '2026-06-01',
    plannedReturnDate: '2026-06-05',
    equipment: [equipment.inventoryNumber],
    equipmentId: equipment.id,
    rate: '3000 ₽/день',
    price: 12000,
    discount: 0,
    deliveryAddress: `${prefix}-Object`,
    manager: 'SMOKE-OFFICE-Manager',
    status: 'new',
    comments: prefix,
  });

  const gantt = await postJson<{ id: string }>(api, '/api/gantt_rentals', {
    rentalId: rental.id,
    client: client.company,
    clientId: client.id,
    clientShort: client.company.slice(0, 20),
    equipmentId: equipment.id,
    equipmentInv: equipment.inventoryNumber,
    startDate: '2026-06-01',
    endDate: '2026-06-05',
    manager: 'SMOKE-OFFICE-Manager',
    managerInitials: 'SO',
    status: 'created',
    paymentStatus: 'unpaid',
    updSigned: false,
    amount: 12000,
    comments: [],
  });

  await postJson(api, '/api/documents', {
    type: 'contract',
    number: `${prefix}-DOC`,
    clientId: client.id,
    client: client.company,
    rentalId: rental.id,
    rental: rental.id,
    equipmentId: equipment.id,
    equipmentInv: equipment.inventoryNumber,
    status: 'draft',
    date: '2026-05-08',
    manager: 'SMOKE-OFFICE-Manager',
  });

  await postJson(api, '/api/payments', {
    invoiceNumber: `${prefix}-PAY`,
    clientId: client.id,
    client: client.company,
    rentalId: rental.id,
    amount: 12000,
    paidAmount: 0,
    dueDate: '2026-06-01',
    status: 'pending',
    comment: prefix,
  });

  await postJson(api, '/api/deliveries', {
    type: 'shipping',
    status: 'new',
    transportDate: '2026-06-01',
    neededBy: '2026-06-01',
    origin: `${prefix}-Yard`,
    destination: `${prefix}-Object`,
    cargo: `${equipment.manufacturer} ${equipment.model} · INV ${equipment.inventoryNumber}`,
    contactName: client.contact,
    contactPhone: '+79990000002',
    cost: 0,
    comment: prefix,
    client: client.company,
    clientId: client.id,
    manager: 'SMOKE-OFFICE-Manager',
    ganttRentalId: gantt.id,
    classicRentalId: rental.id,
    equipmentId: equipment.id,
    equipmentInv: equipment.inventoryNumber,
    equipmentLabel: `${equipment.manufacturer} ${equipment.model}`,
  });

  const serviceTicket = await postJson<{ id: string; reason: string }>(api, '/api/service', {
    equipmentId: equipment.id,
    equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
    inventoryNumber: equipment.inventoryNumber,
    serialNumber: equipment.serialNumber,
    clientId: client.id,
    client: client.company,
    location: `${prefix}-Object`,
    reason: `${prefix}-Service`,
    description: `${prefix}-Service description`,
    priority: 'low',
    status: 'new',
    createdAt: new Date().toISOString(),
  });

  return { client, equipment, rentalEquipment, serviceEquipment, rental, serviceTicket };
}

async function selectEquipment(page: Page, query: string) {
  await page.getByText('Введите модель, INV или серийный номер…').click();
  const combobox = page.getByPlaceholder('Введите модель, INV или серийный номер…');
  await combobox.fill(query);
  await page.locator('li[data-eq-item]').first().click();
}

test('smoke-office can use permitted office UI without admin access or runtime errors', async ({ page, request }) => {
  test.setTimeout(240_000);
  const issues: UiIssue[] = [];
  let action = 'setup';
  installUiGuards(page, issues, () => action);

  const suffix = String(Date.now()).slice(-8);
  const seed = await withAdminApi(async (api) => {
    await ensureSmokeOfficeUser(api);
    return seedSmokeOfficeData(api, suffix);
  });

  action = 'preflight';
  const health = await request.get('http://127.0.0.1:3000/health');
  expect(health.ok()).toBeTruthy();
  const anonymousMe = await request.get('http://127.0.0.1:3000/api/auth/me');
  expect(anonymousMe.status()).toBe(401);

  action = 'login smoke-office';
  await login(page, OFFICE_CREDENTIALS);
  await expect(page.locator('aside').getByRole('button', { name: /^Дашборд/ })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/admin/);

  const token = await page.evaluate(() => window.localStorage.getItem('app_auth_token'));
  expect(token).toBeTruthy();
  const authHeaders = { Authorization: `Bearer ${token}` };
  const me = await request.get('http://127.0.0.1:3000/api/auth/me', { headers: authHeaders });
  expect(me.ok()).toBeTruthy();
  const meJson = await me.json();
  expect(meJson.user.userRole).toBe('Офис-менеджер');

  const sidebar = page.locator('aside');
  for (const section of OFFICE_SECTIONS) {
    await expect(sidebar.getByRole('button', { name: section.name }), `${section.label} should be visible`).toBeVisible();
  }
  for (const forbidden of FORBIDDEN_NAV_ITEMS) {
    await expect(sidebar.getByRole('button', { name: forbidden })).toBeHidden();
  }

  for (const section of OFFICE_SECTIONS) {
    action = `section ${section.label}`;
    await openSectionFromSidebar(page, section);
    await exerciseVisibleTabs(page, section.label);
    await exerciseFilters(page, section.label);
  }

  action = 'client creation';
  await navigateInApp(page, '/clients/new');
  await expect(page.getByRole('heading', { name: 'Новый клиент' })).toBeVisible();
  const uiClientName = `SMOKE-OFFICE-${suffix}-UI-Client`;
  await page.getByPlaceholder('ООО «Компания»').fill(uiClientName);
  await page.getByPlaceholder('1234567890').fill(`${Date.now()}`.slice(-10));
  await page.getByPlaceholder('info@company.ru').fill(`smoke-office-ui-${suffix}@example.local`);
  await page.getByPlaceholder('Иванов Иван Иванович').fill('SMOKE-OFFICE Contact');
  await page.getByPlaceholder('+7 (999) 123-45-67').fill('+79990000003');
  await page.getByRole('button', { name: 'Создать клиента' }).click();
  await expect(page).toHaveURL(/#\/clients\/.+/);
  await expect(page.getByRole('heading', { name: uiClientName })).toBeVisible();
  await expectHealthyScreen(page, action);

  action = 'rental creation';
  await navigateInApp(page, `/rentals/new?clientId=${seed.client.id}`);
  await expect(page.getByRole('heading', { name: 'Новая аренда' })).toBeVisible();
  await page.locator('input[type="date"]').nth(0).fill('2026-12-10');
  await page.locator('input[type="date"]').nth(1).fill('2026-12-17');
  await selectEquipment(page, seed.rentalEquipment.serialNumber);
  await expect(page.getByText(/Техника занята на выбранный период/)).toHaveCount(0);
  await page.locator('input[type="number"]').first().fill('2500');
  await page.getByRole('button', { name: 'Создать договор' }).click();
  await goToRoute(page, '/rentals');
  await expect(page.locator('main')).toContainText('Планировщик аренды');
  await expectHealthyScreen(page, action);

  action = 'service ticket creation';
  await navigateInApp(page, '/service/new');
  await expect(page.getByRole('heading', { name: 'Новая заявка в сервис' })).toBeVisible();
  await selectEquipment(page, seed.serviceEquipment.serialNumber);
  await page.getByPlaceholder('Например: объект клиента, склад, адрес площадки').fill(`SMOKE-OFFICE-${suffix}-Service location`);
  await page.getByPlaceholder('Например: Не реагирует на команды, не поднимается, ошибка на дисплее').fill(`SMOKE-OFFICE-${suffix}-Service reason`);
  await page.getByPlaceholder('Опишите неисправность или проблему, с которой обратились в сервис.').fill(`SMOKE-OFFICE-${suffix}-Service description`);
  await page.getByRole('button', { name: 'Создать заявку' }).click();
  await expect(page).toHaveURL(/#\/service\/.+/);
  await expectHealthyScreen(page, action);

  action = 'documents create modal';
  await goToRoute(page, '/documents');
  await expect(page.getByRole('heading', { name: 'Документы' })).toBeVisible();
  await expectHealthyScreen(page, action);
  await page.getByRole('button', { name: /Договор аренды/ }).click();
  await expect(page.getByRole('dialog', { name: /Договор аренды/ })).toBeVisible();
  await closeDialogIfOpen(page);

  action = 'payments create modal';
  await navigateInApp(page, '/payments');
  await expect(page).toHaveURL(/#\/payments$/);
  await expectHealthyScreen(page, action);
  await page.getByRole('button', { name: /Добавить платёж/ }).first().click();
  await expect(page.getByRole('heading', { name: 'Добавить платёж' })).toBeVisible();
  await page.getByRole('button', { name: 'Отмена' }).click();

  action = 'delivery create sheet';
  await navigateInApp(page, '/deliveries');
  await expect(page).toHaveURL(/#\/deliveries$/);
  await expectHealthyScreen(page, action);
  await page.getByRole('button', { name: /Новая доставка/ }).click();
  await expect(page.getByRole('dialog', { name: /Новая доставка/ })).toBeVisible();
  await closeDialogIfOpen(page);

  for (const detail of [
    { label: 'equipment detail', path: `/equipment/${seed.equipment.id}`, text: /Техника 360°/ },
    { label: 'client detail', path: `/clients/${seed.client.id}`, text: seed.client.company },
    { label: 'rental detail', path: `/rentals/${seed.rental.id}`, text: seed.rental.id },
    { label: 'service detail', path: `/service/${seed.serviceTicket.id}`, text: seed.serviceTicket.reason },
  ]) {
    action = detail.label;
    await navigateInApp(page, detail.path);
    await expect(page).toHaveURL(new RegExp(`#${detail.path.replace('/', '\\/')}`));
    await expect(page.getByText(detail.text).first()).toBeVisible();
    await expectHealthyScreen(page, detail.label);
  }

  action = 'forbidden admin route';
  await navigateInApp(page, '/admin');
  await expect(page).not.toHaveURL(/#\/admin$/);
  await expect(sidebar.getByRole('button', { name: /^Панель администратора/ })).toBeHidden();

  action = 'rbac api checks';
  for (const path of ['/api/equipment', '/api/clients', '/api/rentals', '/api/gantt_rentals', '/api/deliveries', '/api/service', '/api/documents', '/api/payments']) {
    const response = await request.get(`http://127.0.0.1:3000${path}`, { headers: authHeaders });
    expect(response.ok(), `${path} should be readable for office manager`).toBeTruthy();
  }
  const staffOptions = await request.get('http://127.0.0.1:3000/api/staff/manager-options', { headers: authHeaders });
  expect(staffOptions.ok()).toBeTruthy();
  expect(JSON.stringify(await staffOptions.json())).not.toMatch(/password|token/i);

  const usersList = await request.get('http://127.0.0.1:3000/api/users', { headers: authHeaders });
  expect(usersList.ok()).toBeTruthy();
  expect(JSON.stringify(await usersList.json())).not.toMatch(/password|token/i);
  const userPatch = await request.patch('http://127.0.0.1:3000/api/users/U-reset-admin', {
    headers: authHeaders,
    data: { role: 'Администратор' },
  });
  expect(userPatch.status(), '/api/users write must stay forbidden for office manager').toBe(403);

  for (const path of ['/api/app_settings', '/api/status']) {
    const response = await request.get(`http://127.0.0.1:3000${path}`, { headers: authHeaders });
    expect(response.status(), `${path} must stay forbidden for office manager`).toBe(403);
  }

  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
});
