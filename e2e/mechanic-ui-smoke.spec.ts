import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login } from './helpers/auth';
import { withAdminApi } from './helpers/api';

test.use({ trace: 'off', screenshot: 'off', video: 'off' });

type UiIssue = {
  type: string;
  action: string;
  url: string;
  text?: string;
  status?: number;
};

type SmokeUser = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};

type Mechanic = {
  id: string;
  name: string;
  email?: string;
  userId?: string;
};

type SeedData = {
  user: SmokeUser;
  mechanic: Mechanic;
  equipment: { id: string; inventoryNumber: string; serialNumber: string; manufacturer: string; model: string };
  ticket: { id: string; reason: string };
  vehicle: { id: string; plateNumber: string };
  trip: { id: string; route: string };
};

const MECHANIC_CREDENTIALS = {
  email: 'smoke-service@yandex.ru',
  password: '123123',
};

const MECHANIC_SECTIONS: Array<{ name: RegExp; label: string; route: string }> = [
  { name: /^Центр задач/, label: 'Центр задач', route: '/tasks' },
  { name: /^Техника/, label: 'Техника', route: '/equipment' },
  { name: /^GSM/, label: 'GSM', route: '/gsm' },
  { name: /^Планировщик/, label: 'Планировщик', route: '/planner' },
  { name: /^Сервис/, label: 'Сервис', route: '/service' },
  { name: /^Сл\. машины/, label: 'Служебные машины', route: '/service-vehicles' },
  { name: /^Личные настройки/, label: 'Личные настройки', route: '/settings' },
];

const FORBIDDEN_NAV_ITEMS = [
  /^Дашборд/,
  /^База знаний/,
  /^Продажи/,
  /^Доставка/,
  /^Аренды/,
  /^Клиенты/,
  /^Документы/,
  /^Платежи/,
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
  await expect(page.getByText(/Cannot read properties|Maximum update depth exceeded|Unexpected Application Error|Application error|Something went wrong|React does not recognize|Function components cannot be given refs|ошибка приложения/i)).toHaveCount(0);
  await expect(page.locator('main').getByText(/Загружаем|Открываем раздел/i)).toHaveCount(0);
}

async function openSectionFromSidebar(page: Page, section: { name: RegExp; label: string; route: string }) {
  await page.locator('aside').getByRole('button', { name: section.name }).click();
  await expect(page).toHaveURL(new RegExp(`#${section.route.replace('/', '\\/')}(?:$|[?])`));
  await expectHealthyScreen(page, `open ${section.label}`);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expectHealthyScreen(page, `reload ${section.label}`);
}

async function goToRoute(page: Page, route: string) {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  const appRoot = await page.evaluate(() => `${window.location.origin}${window.location.pathname}`);
  await page.goto(`${appRoot}#${normalizedRoute}`, { waitUntil: 'domcontentloaded' });
  await page.reload({ waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`#${normalizedRoute.replace('/', '\\/')}(?:$|[?])`));
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
    const reset = dialog.getByRole('button', { name: /Сбросить/ }).first();
    if ((await reset.count()) > 0 && await reset.isVisible()) {
      await reset.click({ timeout: 5_000 });
    }
    const done = dialog.getByRole('button', { name: /Готово|Применить|Закрыть|Отмена/ }).last();
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

async function ensureSmokeMechanicUser(api: APIRequestContext): Promise<SmokeUser> {
  const usersResponse = await api.get('/api/users');
  expect(usersResponse.ok()).toBeTruthy();
  const users = await usersResponse.json() as SmokeUser[];
  const existing = users.find(user => String(user.email || '').toLowerCase() === MECHANIC_CREDENTIALS.email);
  if (existing) {
    expect(existing.role, 'existing smoke-service user must keep mechanic role').toMatch(/Механик|mechanic/i);
    expect(existing.status, 'existing smoke-service user must be active').toBe('Активен');
    return existing;
  }

  const create = await api.post('/api/users', {
    data: {
      name: 'SMOKE-SERVICE-User',
      email: MECHANIC_CREDENTIALS.email,
      role: 'Механик',
      status: 'Активен',
      password: MECHANIC_CREDENTIALS.password,
    },
  });
  expect(create.ok(), `create smoke-service user: ${create.status()} ${await create.text()}`).toBeTruthy();
  return (await create.json()) as SmokeUser;
}

async function ensureSmokeMechanic(api: APIRequestContext, user: SmokeUser, prefix: string): Promise<Mechanic> {
  const mechanicsResponse = await api.get('/api/mechanics');
  expect(mechanicsResponse.ok()).toBeTruthy();
  const mechanics = await mechanicsResponse.json() as Mechanic[];
  const existing = mechanics.find(item =>
    item.userId === user.id ||
    String(item.email || '').toLowerCase() === MECHANIC_CREDENTIALS.email ||
    item.name === user.name
  );
  if (existing) return existing;

  return postJson<Mechanic>(api, '/api/mechanics', {
    name: user.name || `${prefix}-Mechanic`,
    email: MECHANIC_CREDENTIALS.email,
    phone: '+79990000021',
    userId: user.id,
    specialization: 'SMOKE-SERVICE',
    status: 'active',
    notes: prefix,
  });
}

async function seedSmokeMechanicData(api: APIRequestContext, suffix: string): Promise<SeedData> {
  const user = await ensureSmokeMechanicUser(api);
  const prefix = `SMOKE-SERVICE-${suffix}`;
  const mechanic = await ensureSmokeMechanic(api, user, prefix);

  const equipment = await postJson<{ id: string; inventoryNumber: string; serialNumber: string; manufacturer: string; model: string }>(api, '/api/equipment', {
    inventoryNumber: `SS-${suffix}`.slice(0, 18),
    manufacturer: 'SMOKE-SERVICE',
    model: 'Service Lift',
    type: 'scissor',
    drive: 'electric',
    serialNumber: `${prefix}-SN`,
    year: 2026,
    hours: 42,
    liftHeight: 8,
    workingHeight: 10,
    location: `${prefix}-Yard`,
    status: 'service',
    owner: 'own',
    category: 'own',
    priority: 'medium',
    activeInFleet: true,
    plannedMonthlyRevenue: 0,
    nextMaintenance: '2026-06-15',
    history: [],
  });

  const vehicle = await postJson<{ id: string; plateNumber: string }>(api, '/api/service-vehicles', {
    make: 'SMOKE-SERVICE',
    model: 'Mechanic Van',
    plateNumber: `SS${suffix.slice(-3)}77`,
    vin: `${prefix}-VIN`,
    year: 2026,
    vehicleType: 'van',
    color: 'white',
    currentMileage: 100,
    mileageUpdatedAt: '2026-06-01',
    responsiblePerson: user.name || mechanic.name,
    conditionNote: prefix,
    status: 'active',
    osagoExpiresAt: '2026-12-31',
    insuranceExpiresAt: '2026-12-31',
    nextServiceAt: '2026-08-01',
    serviceNote: prefix,
  });

  const ticket = await postJson<{ id: string; reason: string }>(api, '/api/service', {
    equipmentId: equipment.id,
    equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
    inventoryNumber: equipment.inventoryNumber,
    serialNumber: equipment.serialNumber,
    location: `${prefix}-Service location`,
    reason: `${prefix}-Ticket`,
    description: `${prefix}-Repair smoke description`,
    priority: 'medium',
    status: 'new',
    assignedMechanicId: mechanic.id,
    assignedMechanicName: mechanic.name,
    mechanicId: mechanic.id,
    assignedTo: mechanic.name,
    serviceVehicleId: vehicle.id,
    createdAt: new Date().toISOString(),
    createdBy: 'Playwright',
  });

  const trip = await postJson<{ id: string; route: string }>(api, '/api/vehicle-trips', {
    vehicleId: vehicle.id,
    date: '2026-06-01',
    driver: mechanic.name,
    route: `${prefix}-Yard - ${prefix}-Service location`,
    purpose: `${prefix}-Service visit`,
    startMileage: 100,
    endMileage: 108,
    serviceTicketId: ticket.id,
    comment: prefix,
  });

  return { user, mechanic, equipment, ticket, vehicle, trip };
}

test('smoke-service can use mechanic UI without admin or commercial access', async ({ page, request }) => {
  test.setTimeout(270_000);
  const issues: UiIssue[] = [];
  let action = 'setup';
  installUiGuards(page, issues, () => action);

  const suffix = String(Date.now()).slice(-8);
  const seed = await withAdminApi(async (api) => seedSmokeMechanicData(api, suffix));

  action = 'preflight';
  const health = await request.get('http://127.0.0.1:3000/health');
  expect(health.ok()).toBeTruthy();
  const anonymousMe = await request.get('http://127.0.0.1:3000/api/auth/me');
  expect(anonymousMe.status()).toBe(401);

  action = 'login smoke-service';
  await login(page, MECHANIC_CREDENTIALS);
  await expect(page.locator('aside').getByRole('button', { name: /^Сервис/ })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/admin/);

  let token = await page.evaluate(() => window.localStorage.getItem('app_auth_token'));
  expect(token).toBeTruthy();
  let authHeaders = { Authorization: `Bearer ${token}` };
  const me = await request.get('http://127.0.0.1:3000/api/auth/me', { headers: authHeaders });
  expect(me.ok()).toBeTruthy();
  const meJson = await me.json();
  expect(meJson.user.userRole).toMatch(/Механик|mechanic/i);
  expect(meJson.user.permissions.readableCollections).toEqual(expect.arrayContaining([
    'equipment',
    'service',
    'mechanics',
    'service_works',
    'spare_parts',
    'repair_work_items',
    'repair_part_items',
    'planner_items',
    'service_vehicles',
    'vehicle_trips',
  ]));
  for (const forbiddenCollection of ['users', 'app_settings', 'clients', 'rentals', 'deliveries', 'documents', 'payments']) {
    expect(meJson.user.permissions.readableCollections).not.toContain(forbiddenCollection);
  }

  action = 'logout and re-login';
  await page.getByRole('button', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await login(page, MECHANIC_CREDENTIALS);
  await expect(page.locator('aside').getByRole('button', { name: /^Сервис/ })).toBeVisible();
  token = await page.evaluate(() => window.localStorage.getItem('app_auth_token'));
  expect(token).toBeTruthy();
  authHeaders = { Authorization: `Bearer ${token}` };

  const sidebar = page.locator('aside');
  for (const section of MECHANIC_SECTIONS) {
    await expect(sidebar.getByRole('button', { name: section.name }), `${section.label} should be visible`).toBeVisible();
  }
  for (const forbidden of FORBIDDEN_NAV_ITEMS) {
    await expect(sidebar.getByRole('button', { name: forbidden })).toBeHidden();
  }

  for (const section of MECHANIC_SECTIONS) {
    action = `section ${section.label}`;
    await openSectionFromSidebar(page, section);
    await exerciseVisibleTabs(page, section.label);
    await exerciseFilters(page, section.label);
    await closeDialogIfOpen(page);
  }

  action = 'service list and assigned ticket';
  await goToRoute(page, '/service');
  await expect(page.getByText(seed.ticket.reason)).toBeVisible();
  await expectHealthyScreen(page, action);

  action = 'service detail workflow';
  await goToRoute(page, `/service/${seed.ticket.id}`);
  await expect(page.getByText(seed.ticket.reason).first()).toBeVisible();
  await expect(page.getByText(seed.equipment.inventoryNumber).first()).toBeVisible();
  await exerciseVisibleTabs(page, 'service detail');
  const takeInWork = page.getByRole('button', { name: /Взять в работу/ });
  if (await takeInWork.isVisible().catch(() => false)) {
    await takeInWork.click();
    await expect(page.getByText(/В работе|in_progress/).first()).toBeVisible({ timeout: 10_000 });
  }
  const summary = page.getByPlaceholder('Краткий итог работ, что было сделано...');
  if (await summary.isVisible().catch(() => false)) {
    await summary.fill(`SMOKE-SERVICE-${suffix}-repair summary`);
    await page.getByRole('button', { name: 'Сохранить' }).first().click();
  }
  const mechanicComment = page.getByPlaceholder('Добавить комментарий...');
  if (await mechanicComment.isVisible().catch(() => false)) {
    await mechanicComment.fill(`SMOKE-SERVICE-${suffix}-comment`);
    await page.getByRole('button', { name: 'Добавить' }).last().click();
    await expect(page.getByText(`SMOKE-SERVICE-${suffix}-comment`)).toBeVisible({ timeout: 10_000 });
  }
  await expect(page.getByRole('button', { name: /Удалить заявку/ })).toBeHidden();
  await expectHealthyScreen(page, action);

  action = 'equipment detail';
  await goToRoute(page, `/equipment/${seed.equipment.id}`);
  await expect(page.getByText(seed.equipment.inventoryNumber).first()).toBeVisible();
  await expect(page.getByText('Финансовые показатели скрыты правами доступа.')).toBeVisible();
  await exerciseVisibleTabs(page, 'equipment detail');
  await expectHealthyScreen(page, action);

  action = 'service vehicle detail and trip';
  await goToRoute(page, `/service-vehicles/${seed.vehicle.id}`);
  await expect(page.getByText(seed.vehicle.plateNumber).first()).toBeVisible();
  await exerciseVisibleTabs(page, 'service vehicle detail');
  await page.getByRole('button', { name: /Журнал поездок/ }).click();
  await expect(page.getByText(seed.trip.route).first()).toBeVisible();
  await expectHealthyScreen(page, action);

  action = 'direct forbidden routes';
  const appRoot = await page.evaluate(() => `${window.location.origin}${window.location.pathname}`);
  for (const route of ['/admin', '/finance', '/payments', '/documents', '/clients', '/rentals', '/deliveries', '/reports', '/bots']) {
    await page.goto(`${appRoot}#${route}`, { waitUntil: 'domcontentloaded' });
    await page.reload({ waitUntil: 'domcontentloaded' });
    await expect(page).not.toHaveURL(new RegExp(`#${route}$`));
    await expectHealthyScreen(page, `forbidden route ${route}`);
  }

  action = 'rbac api checks';
  for (const path of [
    '/api/equipment',
    `/api/equipment/${seed.equipment.id}`,
    '/api/service',
    `/api/service/${seed.ticket.id}`,
    '/api/mechanics',
    '/api/service_works',
    '/api/spare_parts',
    `/api/repair_work_items?repair_id=${seed.ticket.id}`,
    `/api/repair_part_items?repair_id=${seed.ticket.id}`,
    '/api/planner',
    '/api/service_vehicles',
    `/api/service_vehicles/${seed.vehicle.id}`,
    `/api/vehicle-trips?vehicleId=${seed.vehicle.id}`,
  ]) {
    const response = await request.get(`http://127.0.0.1:3000${path}`, { headers: authHeaders });
    expect(response.ok(), `${path} should be readable for mechanic`).toBeTruthy();
  }

  const serviceList = await request.get('http://127.0.0.1:3000/api/service', { headers: authHeaders });
  const serviceListJson = await serviceList.json();
  expect(serviceListJson.some((item: { id: string }) => item.id === seed.ticket.id)).toBeTruthy();

  const patchCriticalFields = await request.patch(`http://127.0.0.1:3000/api/service/${seed.ticket.id}`, {
    headers: authHeaders,
    data: {
      status: 'in_progress',
      clientId: 'SMOKE-SERVICE-FORBIDDEN-CLIENT',
      rentalId: 'SMOKE-SERVICE-FORBIDDEN-RENTAL',
      assignedMechanicId: 'SMOKE-SERVICE-FORBIDDEN-MECHANIC',
      assignedUserId: 'SMOKE-SERVICE-FORBIDDEN-USER',
      result: `SMOKE-SERVICE-${suffix}-api-result`,
    },
  });
  expect(patchCriticalFields.ok(), 'mechanic should be able to update allowed service fields').toBeTruthy();
  const patchedTicket = await request.get(`http://127.0.0.1:3000/api/service/${seed.ticket.id}`, { headers: authHeaders });
  const patchedTicketJson = await patchedTicket.json();
  expect(patchedTicketJson.assignedMechanicId).toBe(seed.mechanic.id);
  expect(patchedTicketJson.assignedUserId).not.toBe('SMOKE-SERVICE-FORBIDDEN-USER');
  expect(patchedTicketJson.clientId).not.toBe('SMOKE-SERVICE-FORBIDDEN-CLIENT');
  expect(patchedTicketJson.rentalId).not.toBe('SMOKE-SERVICE-FORBIDDEN-RENTAL');

  for (const path of [
    '/api/users',
    '/api/clients',
    '/api/rentals',
    '/api/gantt_rentals',
    '/api/deliveries',
    '/api/documents',
    '/api/payments',
    '/api/app_settings',
    '/api/finance/debt-rows',
    '/api/admin/audit-logs',
    '/api/admin/system-data/export',
  ]) {
    const response = await request.get(`http://127.0.0.1:3000${path}`, { headers: authHeaders });
    expect([401, 403].includes(response.status()), `${path} must stay forbidden for mechanic`).toBeTruthy();
  }

  const userPatch = await request.patch('http://127.0.0.1:3000/api/users/U-reset-admin', {
    headers: authHeaders,
    data: { role: 'Администратор' },
  });
  expect(userPatch.status(), '/api/users write must stay forbidden for mechanic').toBe(403);

  const paymentCreate = await request.post('http://127.0.0.1:3000/api/payments', {
    headers: authHeaders,
    data: {
      invoiceNumber: `SMOKE-SERVICE-${suffix}-FORBIDDEN-PAY`,
      amount: 1,
      paidAmount: 0,
      dueDate: '2026-06-10',
      status: 'pending',
    },
  });
  expect(paymentCreate.status(), 'payment creation must stay forbidden for mechanic').toBe(403);

  const documentCreate = await request.post('http://127.0.0.1:3000/api/documents', {
    headers: authHeaders,
    data: {
      type: 'act',
      number: `SMOKE-SERVICE-${suffix}-FORBIDDEN-DOC`,
      status: 'draft',
      date: '2026-06-01',
    },
  });
  expect(documentCreate.status(), 'document creation must stay forbidden for mechanic').toBe(403);

  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
});
