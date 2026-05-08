import { expect, request as playwrightRequest, test, type APIRequestContext, type Page } from '@playwright/test';
import { login } from './helpers/auth';
import { createClient, createDocument, createEquipment, createRentalPair, ensureUser, withAdminApi } from './helpers/api';

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
  ownerId?: string;
  ownerName?: string;
};

type OwnerRecord = {
  id: string;
  name: string;
};

type EquipmentRecord = {
  id: string;
  inventoryNumber: string;
  serialNumber: string;
  manufacturer: string;
  model: string;
  status: string;
};

type RentalPair = {
  rental: { id: string; client: string };
  ganttId: string;
};

type SeedData = {
  credentials: { email: string; password: string };
  owner: OwnerRecord;
  otherOwner: OwnerRecord;
  ownEquipment: EquipmentRecord;
  otherEquipment: EquipmentRecord;
  ownRental: RentalPair;
  otherRental: RentalPair;
  ownClient: { id: string; company: string };
};

const API_BASE_URL = 'http://127.0.0.1:3000';

function sanitize(text: string) {
  return text.replace(/[a-f0-9]{64}/gi, '[token]').slice(0, 800);
}

function isIgnoredRequestFailure(url: string, failure: string) {
  if (failure === 'net::ERR_ABORTED') return true;
  return /favicon|\.map($|\?)|\/node_modules\/\.vite\/deps\/|\/src\/app\/pages\//.test(url);
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

async function createAuthedApi(email: string, password: string): Promise<APIRequestContext> {
  const bootstrap = await playwrightRequest.newContext({ baseURL: API_BASE_URL });
  const authRes = await bootstrap.post('/api/auth/login', {
    data: { email, password },
  });
  expect(authRes.ok(), `login ${email}: ${authRes.status()} ${await authRes.text()}`).toBeTruthy();
  const authJson = await authRes.json() as { token: string };
  await bootstrap.dispose();

  return playwrightRequest.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${authJson.token}`,
      'Content-Type': 'application/json',
    },
  });
}

async function postJson<T>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post(path, { data });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

async function patchOk<T>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.patch(path, { data });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

async function ensureOwner(api: APIRequestContext, name: string): Promise<OwnerRecord> {
  const listResponse = await api.get('/api/owners');
  expect(listResponse.ok(), `GET /api/owners: ${listResponse.status()} ${await listResponse.text()}`).toBeTruthy();
  const owners = await listResponse.json() as OwnerRecord[];
  const existing = owners.find(owner => owner.name === name);
  if (existing) return existing;

  return postJson<OwnerRecord>(api, '/api/owners', {
    name,
    type: 'investor',
    contact: name,
    phone: '+79990000055',
    email: `${name.toLowerCase()}@example.local`,
    notes: name,
  });
}

async function ensureInvestorUser(
  api: APIRequestContext,
  credentials: { email: string; password: string },
  owner: OwnerRecord,
  suffix: string,
): Promise<SmokeUser> {
  await ensureUser(api, {
    name: `SMOKE-INVESTOR-User-${suffix}`,
    email: credentials.email,
    role: 'Инвестор',
    password: credentials.password,
  });

  const usersResponse = await api.get('/api/users');
  expect(usersResponse.ok()).toBeTruthy();
  const users = await usersResponse.json() as SmokeUser[];
  const user = users.find(item => item.email === credentials.email);
  expect(user, `Expected investor user ${credentials.email}`).toBeTruthy();

  return patchOk<SmokeUser>(api, `/api/users/${user!.id}`, {
    name: `SMOKE-INVESTOR-User-${suffix}`,
    role: 'Инвестор',
    status: 'Активен',
    password: credentials.password,
    ownerId: owner.id,
    ownerName: owner.name,
  });
}

async function attachOwner(api: APIRequestContext, equipment: EquipmentRecord, owner: OwnerRecord) {
  return patchOk<EquipmentRecord>(api, `/api/equipment/${equipment.id}`, {
    owner: 'investor',
    ownerId: owner.id,
    ownerName: owner.name,
    category: 'own',
    activeInFleet: true,
    status: 'rented',
  });
}

async function seedInvestorData(suffix: string): Promise<SeedData> {
  const prefix = `SMOKE-INVESTOR-${suffix}`;
  const credentials = {
    email: `smoke-investor-${suffix}@example.local`,
    password: '123123',
  };

  return withAdminApi(async (api) => {
    const owner = await ensureOwner(api, `${prefix}-Owner`);
    const otherOwner = await ensureOwner(api, `${prefix}-OtherOwner`);
    await ensureInvestorUser(api, credentials, owner, suffix);

    const ownEquipment = await attachOwner(api, await createEquipment(api, `${prefix}-OWN`), owner);
    const otherEquipment = await attachOwner(api, await createEquipment(api, `${prefix}-OTHER`), otherOwner);
    const ownClient = await createClient(api, `${prefix}-Client`);
    const otherClient = await createClient(api, `${prefix}-OtherClient`);

    const ownRental = await createRentalPair(api, {
      client: ownClient.company,
      equipment: ownEquipment,
      startDate: '2026-05-06',
      endDate: '2026-05-20',
      amount: 75000,
      manager: 'SMOKE-INVESTOR-Manager',
      status: 'active',
      ganttStatus: 'active',
    });
    const otherRental = await createRentalPair(api, {
      client: otherClient.company,
      equipment: otherEquipment,
      startDate: '2026-05-06',
      endDate: '2026-05-20',
      amount: 88000,
      manager: 'SMOKE-INVESTOR-OtherManager',
      status: 'active',
      ganttStatus: 'active',
    });

    await postJson(api, '/api/payments', {
      rentalId: ownRental.rental.id,
      clientId: ownClient.id,
      client: ownClient.company,
      invoiceNumber: `${prefix}-INV`,
      amount: 75000,
      paidAmount: 0,
      dueDate: '2026-05-20',
      status: 'pending',
      method: 'bank',
      comment: prefix,
    });
    await createDocument(api, {
      type: 'invoice',
      number: `${prefix}-DOC`,
      client: ownClient.company,
      clientId: ownClient.id,
      rentalId: ownRental.rental.id,
      rental: ownRental.rental.id,
      equipmentId: ownEquipment.id,
      equipmentInv: ownEquipment.inventoryNumber,
      status: 'sent',
      manager: 'SMOKE-INVESTOR-Manager',
    });

    return { credentials, owner, otherOwner, ownEquipment, otherEquipment, ownRental, otherRental, ownClient };
  });
}

async function goToRoute(page: Page, route: string) {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  const appRoot = await page.evaluate(() => `${window.location.origin}${window.location.pathname}`);
  await page.goto(`${appRoot}?_smoke=${Date.now()}#${normalizedRoute}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`#${normalizedRoute.replace('/', '\\/')}(?:$|[?])`));
}

async function expectHealthyScreen(page: Page, action: string) {
  const main = page.locator('main');
  await expect(main, `${action}: main should be visible`).toBeVisible();
  const text = (await main.innerText()).trim();
  expect(text.length, `${action}: main should not be blank`).toBeGreaterThan(10);
  await expect(page.getByText(/Cannot read properties|Maximum update depth exceeded|Unexpected Application Error|Application error|Something went wrong|ошибка приложения/i)).toHaveCount(0);
}

async function expectVisibleText(page: Page, text: string) {
  await expect.poll(async () => {
    const matches = page.getByText(text);
    const count = await matches.count();
    for (let index = 0; index < count; index += 1) {
      if (await matches.nth(index).isVisible().catch(() => false)) return true;
    }
    return false;
  }, { message: `Expected visible text: ${text}` }).toBe(true);
}

test('investor sees only own owner equipment and rentals without forbidden UI/API access', async ({ page }) => {
  const suffix = String(Date.now()).slice(-8);
  const seed = await seedInvestorData(suffix);
  const issues: UiIssue[] = [];
  let action = 'bootstrap';
  installUiGuards(page, issues, () => action);

  const investorApi = await createAuthedApi(seed.credentials.email, seed.credentials.password);
  try {
    const meResponse = await investorApi.get('/api/auth/me');
    expect(meResponse.ok()).toBeTruthy();
    const me = await meResponse.json() as { user: { userRole: string; ownerId?: string; ownerName?: string; permissions?: { readableCollections: string[]; writableCollections: string[] } } };
    expect(me.user.userRole).toBe('Инвестор');
    expect(me.user.ownerId).toBe(seed.owner.id);
    expect(me.user.ownerName).toBe(seed.owner.name);
    expect(me.user.permissions?.readableCollections).toEqual(expect.arrayContaining(['equipment', 'rentals', 'gantt_rentals', 'owners']));
    expect(me.user.permissions?.readableCollections).not.toEqual(expect.arrayContaining(['clients', 'payments', 'documents', 'service', 'users', 'app_settings']));
    expect(me.user.permissions?.writableCollections ?? []).toHaveLength(0);

    const equipmentResponse = await investorApi.get('/api/equipment');
    expect(equipmentResponse.ok()).toBeTruthy();
    const equipment = await equipmentResponse.json() as Array<{ id: string; ownerId?: string }>;
    expect(equipment.map(item => item.id)).toContain(seed.ownEquipment.id);
    expect(equipment.map(item => item.id)).not.toContain(seed.otherEquipment.id);
    expect(equipment.every(item => item.ownerId === seed.owner.id)).toBeTruthy();
    expect((await investorApi.get(`/api/equipment/${seed.ownEquipment.id}`)).status()).toBe(200);
    expect((await investorApi.get(`/api/equipment/${seed.otherEquipment.id}`)).status()).toBe(403);

    const ownersResponse = await investorApi.get('/api/owners');
    expect(ownersResponse.ok()).toBeTruthy();
    const owners = await ownersResponse.json() as OwnerRecord[];
    expect(owners.map(owner => owner.id)).toContain(seed.owner.id);
    expect(owners.map(owner => owner.id)).not.toContain(seed.otherOwner.id);

    const rentalsResponse = await investorApi.get('/api/rentals');
    expect(rentalsResponse.ok()).toBeTruthy();
    const rentals = await rentalsResponse.json() as Array<{ id: string }>;
    expect(rentals.map(item => item.id)).toContain(seed.ownRental.rental.id);
    expect(rentals.map(item => item.id)).not.toContain(seed.otherRental.rental.id);
    expect((await investorApi.get(`/api/rentals/${seed.ownRental.rental.id}`)).status()).toBe(200);
    expect((await investorApi.get(`/api/rentals/${seed.otherRental.rental.id}`)).status()).toBe(403);

    const ganttResponse = await investorApi.get('/api/gantt_rentals');
    expect(ganttResponse.ok()).toBeTruthy();
    const ganttRentals = await ganttResponse.json() as Array<{ id: string }>;
    expect(ganttRentals.map(item => item.id)).toContain(seed.ownRental.ganttId);
    expect(ganttRentals.map(item => item.id)).not.toContain(seed.otherRental.ganttId);

    for (const path of ['/api/clients', '/api/payments', '/api/documents', '/api/service', '/api/users', '/api/app_settings', '/api/rental_change_requests']) {
      const response = await investorApi.get(path);
      expect(response.status(), path).toBe(403);
    }
    expect((await investorApi.patch(`/api/equipment/${seed.ownEquipment.id}`, { data: { notes: 'SMOKE-INVESTOR-BYPASS' } })).status()).toBe(403);
    expect((await investorApi.post('/api/payments', { data: { rentalId: seed.ownRental.rental.id, amount: 1 } })).status()).toBe(403);

    action = 'login';
    await login(page, seed.credentials);
    await expect(page.locator('aside').getByRole('button', { name: /^Техника/ })).toBeVisible();
    await expect(page.locator('aside').getByRole('button', { name: /^Аренды/ })).toBeVisible();
    for (const navName of [/^Клиенты/, /^Документы/, /^Платежи/, /^Финансы/, /^Сервис/, /^Доставка/, /^Отчёты/, /^Панель администратора/]) {
      await expect(page.locator('aside').getByRole('button', { name: navName })).toHaveCount(0);
    }

    action = 'equipment page';
    await goToRoute(page, '/equipment');
    await expect(page.getByRole('heading', { name: 'Техника', exact: true })).toBeVisible();
    await expectVisibleText(page, seed.ownEquipment.inventoryNumber);
    await expect(page.getByText(seed.otherEquipment.inventoryNumber)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Добавить технику/ })).toHaveCount(0);
    await expectHealthyScreen(page, action);

    action = 'equipment detail';
    await goToRoute(page, `/equipment/${seed.ownEquipment.id}`);
    await expectVisibleText(page, seed.ownEquipment.inventoryNumber);
    await expect(page.getByRole('button', { name: /Сохранить|Удалить|Создать заявку|Отправка техники|Приёмка/i })).toHaveCount(0);
    await expectHealthyScreen(page, action);

    action = 'rentals page';
    await goToRoute(page, '/rentals');
    await expect(page.getByRole('heading', { name: 'Планировщик аренды' })).toBeVisible();
    await expectVisibleText(page, seed.ownEquipment.inventoryNumber);
    await expect(page.getByText(seed.otherEquipment.inventoryNumber)).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Новая аренда/ })).toHaveCount(0);
    await expectHealthyScreen(page, action);

    action = 'rental detail';
    await goToRoute(page, `/rentals/${seed.ownRental.rental.id}`);
    await expectVisibleText(page, seed.ownClient.company);
    await expect(page.getByRole('button', { name: /Создать документ|Зарегистрировать платёж|Добавить документ|Добавить платёж|Согласовать/i })).toHaveCount(0);
    await expectHealthyScreen(page, action);

    action = 'foreign rental detail';
    await goToRoute(page, `/rentals/${seed.otherRental.rental.id}`);
    await expect(page.getByRole('heading', { name: 'Аренда не найдена' })).toBeVisible();
    await expect(page.getByText(seed.otherEquipment.inventoryNumber)).toHaveCount(0);
    await expectHealthyScreen(page, action);

    action = 'forbidden route redirect';
    {
      const appRoot = await page.evaluate(() => `${window.location.origin}${window.location.pathname}`);
      await page.goto(`${appRoot}?_smoke=${Date.now()}#/payments`, { waitUntil: 'domcontentloaded' });
    }
    await expect(page).toHaveURL(/#\/equipment/);
    await expect(page.getByRole('heading', { name: 'Техника', exact: true })).toBeVisible();

    expect(issues).toEqual([]);
  } finally {
    await investorApi.dispose();
  }
});
