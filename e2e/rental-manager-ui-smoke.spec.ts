import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { login, navigateInApp } from './helpers/auth';
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

type SeedData = {
  user: SmokeUser;
  client: { id: string; company: string; contact: string };
  uiClientName: string;
  object: { id: string; name: string };
  contract: { id: string; number: string };
  equipment: { id: string; inventoryNumber: string; serialNumber: string; manufacturer: string; model: string };
  serviceEquipment: { id: string; inventoryNumber: string; serialNumber: string };
  rental: { id: string };
  serviceTicket: { id: string; reason: string };
  serviceVehicle: { id: string; plateNumber: string };
  payment: { id: string; invoiceNumber: string };
  document: { id: string; number: string };
};

const RENTAL_CREDENTIALS = {
  email: 'smoke-rental@yandex.ru',
  password: '123123',
};

const RENTAL_MANAGER_SECTIONS: Array<{ name: RegExp; label: string; route: string }> = [
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
  await expect(page).toHaveURL(new RegExp(`#${normalizedRoute.replace('/', '\\/')}(?:$|[?])`));
}

async function exerciseVisibleTabs(page: Page, label: string) {
  const tabs = page.locator('main').getByRole('tab');
  const count = await tabs.count();
  for (let index = 0; index < Math.min(count, 8); index += 1) {
    const tab = tabs.nth(index);
    if (await tab.isVisible().catch(() => false) && await tab.isEnabled({ timeout: 500 }).catch(() => false)) {
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

async function ensureSmokeRentalUser(api: APIRequestContext): Promise<SmokeUser> {
  const usersResponse = await api.get('/api/users');
  expect(usersResponse.ok()).toBeTruthy();
  const users = await usersResponse.json() as SmokeUser[];
  const existing = users.find(user => String(user.email || '').toLowerCase() === RENTAL_CREDENTIALS.email);
  if (existing) {
    expect(existing.role, 'existing smoke-rental user must keep rental manager role').toMatch(/Менеджер по аренде|rental/i);
    expect(existing.status, 'existing smoke-rental user must be active').toBe('Активен');
    return existing;
  }

  const create = await api.post('/api/users', {
    data: {
      name: 'SMOKE-RENTAL-User',
      email: RENTAL_CREDENTIALS.email,
      role: 'Менеджер по аренде',
      status: 'Активен',
      password: RENTAL_CREDENTIALS.password,
    },
  });
  expect(create.ok(), `create smoke-rental user: ${create.status()} ${await create.text()}`).toBeTruthy();
  return (await create.json()) as SmokeUser;
}

async function seedSmokeRentalData(api: APIRequestContext, suffix: string): Promise<SeedData> {
  const user = await ensureSmokeRentalUser(api);
  const prefix = `SMOKE-RENTAL-${suffix}`;
  const managerName = user.name || 'SMOKE-RENTAL-User';

  const client = await postJson<{ id: string; company: string; contact: string }>(api, '/api/clients', {
    company: `${prefix}-Client`,
    inn: `${Date.now()}`.slice(-10),
    contact: `${prefix}-Contact`,
    phone: '+79990000012',
    email: `smoke-rental-client-${suffix}@example.local`,
    address: `${prefix}-Address`,
    paymentTerms: 'Постоплата 7 дней',
    creditLimit: 0,
    debt: 0,
    totalRentals: 0,
    status: 'active',
    manager: managerName,
    managerId: user.id,
    createdAt: new Date().toISOString(),
    createdBy: 'Playwright',
    notes: prefix,
    history: [],
  });

  const object = await postJson<{ id: string; name: string }>(api, '/api/client_objects', {
    clientId: client.id,
    name: `${prefix}-Object`,
    address: `${prefix}-Object address`,
    contactName: client.contact,
    contactPhone: '+79990000012',
    status: 'active',
    notes: prefix,
  });

  const contract = await postJson<{ id: string; number: string }>(api, '/api/client_contracts', {
    clientId: client.id,
    objectId: object.id,
    number: `${prefix}-Contract`,
    title: `${prefix}-Contract title`,
    date: '2026-06-01',
    status: 'active',
    notes: prefix,
  });

  async function createEquipment(kind: string) {
    return postJson<{ id: string; inventoryNumber: string; serialNumber: string; manufacturer: string; model: string }>(api, '/api/equipment', {
      inventoryNumber: `SR-${kind}-${suffix}`.slice(0, 18),
      manufacturer: 'SMOKE-RENTAL',
      model: `Lift-${kind}`,
      type: 'scissor',
      drive: 'electric',
      serialNumber: `${prefix}-SN-${kind}`,
      year: 2026,
      hours: 10,
      liftHeight: 8,
      workingHeight: 10,
      location: `${prefix}-Yard`,
      status: 'available',
      owner: 'own',
      category: 'own',
      priority: 'medium',
      activeInFleet: true,
      plannedMonthlyRevenue: 0,
      nextMaintenance: '2026-06-15',
      history: [],
    });
  }

  const equipment = await createEquipment('CARD');
  const serviceEquipment = await createEquipment('SERV');

  const rental = await postJson<{ id: string }>(api, '/api/rentals', {
    client: client.company,
    clientId: client.id,
    objectId: object.id,
    contractId: contract.id,
    contact: client.contact,
    startDate: '2026-06-10',
    plannedReturnDate: '2026-06-14',
    equipment: [equipment.inventoryNumber],
    equipmentId: equipment.id,
    rate: '3500 ₽/день',
    price: 14000,
    discount: 0,
    deliveryAddress: `${prefix}-Object address`,
    manager: managerName,
    managerId: user.id,
    status: 'new',
    comments: prefix,
  });

  const gantt = await postJson<{ id: string }>(api, '/api/gantt_rentals', {
    rentalId: rental.id,
    client: client.company,
    clientId: client.id,
    objectId: object.id,
    contractId: contract.id,
    clientShort: client.company.slice(0, 20),
    equipmentId: equipment.id,
    equipmentInv: equipment.inventoryNumber,
    startDate: '2026-06-10',
    endDate: '2026-06-14',
    manager: managerName,
    managerId: user.id,
    managerInitials: 'SR',
    status: 'created',
    paymentStatus: 'unpaid',
    updSigned: false,
    amount: 14000,
    comments: [],
  });

  const document = await postJson<{ id: string; number: string }>(api, '/api/documents', {
    type: 'contract',
    number: `${prefix}-DOC`,
    clientId: client.id,
    client: client.company,
    objectId: object.id,
    contractId: contract.id,
    rentalId: rental.id,
    rental: rental.id,
    equipmentId: equipment.id,
    equipmentInv: equipment.inventoryNumber,
    status: 'draft',
    date: '2026-06-01',
    manager: managerName,
    managerId: user.id,
  });

  const payment = await postJson<{ id: string; invoiceNumber: string }>(api, '/api/payments', {
    invoiceNumber: `${prefix}-PAY`,
    clientId: client.id,
    client: client.company,
    objectId: object.id,
    contractId: contract.id,
    rentalId: rental.id,
    amount: 14000,
    paidAmount: 0,
    dueDate: '2026-06-10',
    status: 'pending',
    comment: prefix,
  });

  await postJson(api, '/api/deliveries', {
    type: 'shipping',
    status: 'new',
    transportDate: '2026-06-10',
    neededBy: '2026-06-10',
    origin: `${prefix}-Yard`,
    destination: `${prefix}-Object address`,
    cargo: `${equipment.manufacturer} ${equipment.model} · INV ${equipment.inventoryNumber}`,
    contactName: client.contact,
    contactPhone: '+79990000012',
    cost: 0,
    comment: prefix,
    client: client.company,
    clientId: client.id,
    manager: managerName,
    managerId: user.id,
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
    location: `${prefix}-Object address`,
    reason: `${prefix}-Service`,
    description: `${prefix}-Service description`,
    priority: 'low',
    status: 'new',
    createdAt: new Date().toISOString(),
  });

  const serviceVehicle = await postJson<{ id: string; plateNumber: string }>(api, '/api/service-vehicles', {
    make: 'SMOKE-RENTAL',
    model: 'Service Van',
    plateNumber: `SR${suffix.slice(-3)}77`,
    vin: `${prefix}-VIN`,
    year: 2026,
    vehicleType: 'van',
    color: 'white',
    currentMileage: 100,
    mileageUpdatedAt: '2026-06-01',
    responsiblePerson: managerName,
    conditionNote: prefix,
    status: 'active',
    osagoExpiresAt: '2026-12-31',
    insuranceExpiresAt: '2026-12-31',
    nextServiceAt: '2026-08-01',
    serviceNote: prefix,
  });

  const uiClientName = `${prefix}-UI-Client`;

  return { user, client, uiClientName, object, contract, equipment, serviceEquipment, rental, serviceTicket, serviceVehicle, payment, document };
}

async function selectEquipment(page: Page, query: string) {
  await page.getByText('Введите модель, INV или серийный номер…').click();
  const combobox = page.getByPlaceholder('Введите модель, INV или серийный номер…');
  await combobox.fill(query);
  await page.locator('li[data-eq-item]').first().click();
}

test('smoke-rental can use rental manager UI without admin access or runtime errors', async ({ page, request }) => {
  test.setTimeout(270_000);
  const issues: UiIssue[] = [];
  let action = 'setup';
  installUiGuards(page, issues, () => action);

  const suffix = String(Date.now()).slice(-8);
  const seed = await withAdminApi(async (api) => seedSmokeRentalData(api, suffix));

  action = 'preflight';
  const health = await request.get('http://127.0.0.1:3000/health');
  expect(health.ok()).toBeTruthy();
  const anonymousMe = await request.get('http://127.0.0.1:3000/api/auth/me');
  expect(anonymousMe.status()).toBe(401);

  action = 'login smoke-rental';
  await login(page, RENTAL_CREDENTIALS);
  await expect(page.locator('aside').getByRole('button', { name: /^Дашборд/ })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/admin/);

  let token = await page.evaluate(() => window.localStorage.getItem('app_auth_token'));
  expect(token).toBeTruthy();
  let authHeaders = { Authorization: `Bearer ${token}` };
  const me = await request.get('http://127.0.0.1:3000/api/auth/me', { headers: authHeaders });
  expect(me.ok()).toBeTruthy();
  const meJson = await me.json();
  expect(meJson.user.userRole).toBe('Менеджер по аренде');
  expect(meJson.user.permissions.readableCollections).toEqual(expect.arrayContaining([
    'clients',
    'client_objects',
    'client_contracts',
    'rentals',
    'gantt_rentals',
    'deliveries',
    'documents',
    'payments',
    'service',
  ]));
  expect(meJson.user.permissions.writableCollections).not.toContain('users');
  expect(meJson.user.permissions.writableCollections).not.toContain('app_settings');
  expect(meJson.user.permissions.writableCollections).not.toContain('payments');

  action = 'logout and re-login';
  await page.getByRole('button', { name: /SMOKE-RENTAL-User/ }).click();
  await page.getByRole('menu').getByRole('menuitem', { name: 'Выйти' }).click();
  await expect(page).toHaveURL(/#\/login$/);
  await login(page, RENTAL_CREDENTIALS);
  await expect(page.locator('aside').getByRole('button', { name: /^Дашборд/ })).toBeVisible();
  token = await page.evaluate(() => window.localStorage.getItem('app_auth_token'));
  expect(token).toBeTruthy();
  authHeaders = { Authorization: `Bearer ${token}` };

  const sidebar = page.locator('aside');
  for (const section of RENTAL_MANAGER_SECTIONS) {
    await expect(sidebar.getByRole('button', { name: section.name }), `${section.label} should be visible`).toBeVisible();
  }
  for (const forbidden of FORBIDDEN_NAV_ITEMS) {
    await expect(sidebar.getByRole('button', { name: forbidden })).toBeHidden();
  }

  for (const section of RENTAL_MANAGER_SECTIONS) {
    action = `section ${section.label}`;
    await openSectionFromSidebar(page, section);
    await exerciseVisibleTabs(page, section.label);
    await exerciseFilters(page, section.label);
  }

  action = 'client creation';
  await navigateInApp(page, '/clients/new');
  await expect(page.getByRole('heading', { name: 'Новый клиент' })).toBeVisible();
  await page.getByPlaceholder('ООО «Компания»').fill(seed.uiClientName);
  await page.getByPlaceholder('1234567890').fill(`${Date.now()}`.slice(-10));
  await page.getByPlaceholder('info@company.ru').fill(`smoke-rental-ui-${suffix}@example.local`);
  await page.getByPlaceholder('Иванов Иван Иванович').fill('SMOKE-RENTAL Contact');
  await page.getByPlaceholder('+7 (999) 123-45-67').fill('+79990000013');
  await page.getByRole('button', { name: 'Создать клиента' }).click();
  await expect(page).toHaveURL(/#\/clients\/.+/);
  await expect(page.getByRole('heading', { name: seed.uiClientName })).toBeVisible();
  await expectHealthyScreen(page, action);

  action = 'rental creation remains forbidden';
  await navigateInApp(page, `/rentals/new?clientId=${seed.client.id}`);
  await expect(page).toHaveURL(/#\/rentals$/);
  await expect(page.getByRole('heading', { name: 'Аренды', level: 1 })).toBeVisible();
  await expectHealthyScreen(page, action);

  action = 'service ticket creation';
  await navigateInApp(page, '/service/new');
  await expect(page.getByRole('heading', { name: 'Новая заявка в сервис' })).toBeVisible();
  await selectEquipment(page, seed.serviceEquipment.serialNumber);
  await page.getByPlaceholder('Например: объект клиента, склад, адрес площадки').fill(`SMOKE-RENTAL-${suffix}-Service location`);
  await page.getByPlaceholder('Например: Не реагирует на команды, не поднимается, ошибка на дисплее').fill(`SMOKE-RENTAL-${suffix}-Service reason`);
  await page.getByPlaceholder('Опишите неисправность или проблему, с которой обратились в сервис.').fill(`SMOKE-RENTAL-${suffix}-Service description`);
  await page.getByRole('button', { name: 'Создать заявку' }).click();
  await expect(page).toHaveURL(/#\/service\/.+/);
  await expectHealthyScreen(page, action);

  action = 'delivery create sheet';
  await navigateInApp(page, '/deliveries');
  await expect(page).toHaveURL(/#\/deliveries$/);
  await expectHealthyScreen(page, action);
  await page.getByRole('button', { name: /Новая доставка/ }).click();
  await expect(page.getByRole('dialog', { name: /Новая доставка/ })).toBeVisible();
  await expect(page.getByText(/Счёт получен|Ждём счёт/)).toHaveCount(0);
  await closeDialogIfOpen(page);

  action = 'documents create modal';
  await navigateInApp(page, '/documents');
  await expect(page).toHaveURL(/#\/documents$/);
  await expectHealthyScreen(page, action);
  await expect(page.getByText(seed.document.number)).toBeVisible();
  await page.getByRole('button', { name: /^Создать документ$/ }).first().click();
  await expect(page.getByRole('dialog', { name: /Создать документ/ })).toBeVisible();
  await expect(page.getByRole('button', { name: /Договор аренды/ })).toBeVisible();
  await closeDialogIfOpen(page);

  action = 'payments read-only';
  await navigateInApp(page, '/payments');
  await expect(page).toHaveURL(/#\/payments$/);
  await expectHealthyScreen(page, action);
  await expect(page.getByText(seed.payment.invoiceNumber)).toBeVisible();
  await expect(page.getByRole('button', { name: /Добавить платёж/ })).toBeHidden();

  for (const detail of [
    { label: 'equipment detail', path: `/equipment/${seed.equipment.id}`, text: seed.equipment.model },
    { label: 'client detail', path: `/clients/${seed.client.id}`, text: seed.client.company },
    { label: 'rental detail', path: `/rentals/${seed.rental.id}`, text: seed.rental.id },
    { label: 'service detail', path: `/service/${seed.serviceTicket.id}`, text: seed.serviceTicket.reason },
    { label: 'service vehicle detail', path: `/service-vehicles/${seed.serviceVehicle.id}`, text: seed.serviceVehicle.plateNumber },
  ]) {
    action = detail.label;
    await navigateInApp(page, detail.path);
    await expect(page).toHaveURL(new RegExp(`#${detail.path.replace('/', '\\/')}`));
    await expect(page.getByText(detail.text).first()).toBeVisible();
    await exerciseVisibleTabs(page, detail.label);
    await expectHealthyScreen(page, detail.label);
  }

  action = 'client links read';
  await navigateInApp(page, `/clients/${seed.client.id}`);
  await expect(page.locator('main')).toContainText(seed.object.name);
  await expect(page.locator('main')).toContainText(seed.contract.number);
  await expect(page.locator('main')).toContainText(seed.rental.id);
  await expectHealthyScreen(page, action);

  action = 'forbidden direct routes';
  for (const route of ['/finance', '/bots', '/reports', '/admin']) {
    await navigateInApp(page, route);
    await expect(page).not.toHaveURL(new RegExp(`#${route}$`));
    await expectHealthyScreen(page, `forbidden route ${route}`);
  }
  await expect(sidebar.getByRole('button', { name: /^Панель администратора/ })).toBeHidden();

  action = 'rbac api checks';
  for (const path of [
    '/api/equipment',
    '/api/clients',
    '/api/client_objects',
    '/api/client_contracts',
    '/api/rentals',
    '/api/gantt_rentals',
    '/api/deliveries',
    '/api/service',
    '/api/documents',
    '/api/payments',
    '/api/staff/manager-options',
    '/api/service_vehicles',
    '/api/vehicle-trips',
  ]) {
    const response = await request.get(`http://127.0.0.1:3000${path}`, { headers: authHeaders });
    expect(response.ok(), `${path} should be readable for rental manager`).toBeTruthy();
  }

  const staffOptions = await request.get('http://127.0.0.1:3000/api/staff/manager-options', { headers: authHeaders });
  expect(JSON.stringify(await staffOptions.json())).not.toMatch(/password|token|smoke-rental@yandex\.ru/i);

  const usersList = await request.get('http://127.0.0.1:3000/api/users', { headers: authHeaders });
  expect(usersList.ok()).toBeTruthy();
  expect(JSON.stringify(await usersList.json())).not.toMatch(/password|token|smoke-rental@yandex\.ru/i);
  const userPatch = await request.patch('http://127.0.0.1:3000/api/users/U-reset-admin', {
    headers: authHeaders,
    data: { role: 'Администратор' },
  });
  expect(userPatch.status(), '/api/users write must stay forbidden for rental manager').toBe(403);

  for (const path of ['/api/app_settings', '/api/admin/audit-logs', '/api/admin/system-data/export']) {
    const response = await request.get(`http://127.0.0.1:3000${path}`, { headers: authHeaders });
    expect([401, 403].includes(response.status()), `${path} must stay forbidden for rental manager`).toBeTruthy();
  }

  const paymentCreate = await request.post('http://127.0.0.1:3000/api/payments', {
    headers: authHeaders,
    data: {
      invoiceNumber: `SMOKE-RENTAL-${suffix}-FORBIDDEN-PAY`,
      clientId: seed.client.id,
      client: seed.client.company,
      rentalId: seed.rental.id,
      amount: 1,
      paidAmount: 0,
      dueDate: '2026-06-10',
      status: 'pending',
    },
  });
  expect(paymentCreate.status(), 'payment creation must stay forbidden for rental manager').toBe(403);

  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
});
