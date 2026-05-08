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
  serviceWork: { id: string; name: string };
  sparePart: { id: string; name: string };
};

const WARRANTY_ROLE = 'Механик по гарантии';
const WARRANTY_CREDENTIALS = {
  email: 'smoke-service@yandex.ru',
  password: '123123',
};

const ALLOWED_SECTIONS: Array<{ name: RegExp; label: string; route: string }> = [
  { name: /^Центр задач/, label: 'Центр задач', route: '/tasks' },
  { name: /^Техника/, label: 'Техника', route: '/equipment' },
  { name: /^Продажи/, label: 'Продажи', route: '/sales' },
  { name: /^Аренды/, label: 'Аренды', route: '/rentals' },
  { name: /^Сервис/, label: 'Сервис', route: '/service' },
];

const FORBIDDEN_NAV_ITEMS = [
  /^Дашборд/,
  /^GSM/,
  /^База знаний/,
  /^Доставка/,
  /^Планировщик/,
  /^Сл\. машины/,
  /^Клиенты/,
  /^Документы/,
  /^Платежи/,
  /^Финансы/,
  /^Бот/,
  /^Отчёты/,
  /^Личные настройки/,
  /^Панель администратора/,
];

const PHOTO_DATA_URL = 'data:image/gif;base64,R0lGODlhAQABAAAAACw=';

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
}

async function goToRoute(page: Page, route: string) {
  const normalizedRoute = route.startsWith('/') ? route : `/${route}`;
  const appRoot = await page.evaluate(() => `${window.location.origin}${window.location.pathname}`);
  await page.goto(`${appRoot}?_smoke=${Date.now()}#${normalizedRoute}`, { waitUntil: 'domcontentloaded' });
  await expect(page).toHaveURL(new RegExp(`#${normalizedRoute.replace('/', '\\/')}(?:$|[?])`));
}

async function openSectionFromSidebar(page: Page, section: { name: RegExp; label: string; route: string }) {
  const button = page.locator('aside').getByRole('button', { name: section.name });
  await expect(button, `${section.label} nav button should be visible`).toBeVisible();
  await button.click();
  await goToRoute(page, section.route);
  await expectHealthyScreen(page, `open ${section.label}`);
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

async function postJson<T>(api: APIRequestContext, path: string, data: unknown): Promise<T> {
  const response = await api.post(path, { data });
  expect(response.ok(), `${path}: ${response.status()} ${await response.text()}`).toBeTruthy();
  return (await response.json()) as T;
}

async function ensureWarrantySmokeUser(api: APIRequestContext): Promise<SmokeUser> {
  const usersResponse = await api.get('/api/users');
  expect(usersResponse.ok()).toBeTruthy();
  const users = await usersResponse.json() as SmokeUser[];
  const existing = users.find(user => String(user.email || '').toLowerCase() === WARRANTY_CREDENTIALS.email);
  if (existing) {
    const patch = await api.patch(`/api/users/${existing.id}`, {
      data: {
        name: existing.name || 'SMOKE-WARRANTY-MECH-User',
        role: WARRANTY_ROLE,
        status: 'Активен',
        password: WARRANTY_CREDENTIALS.password,
      },
    });
    expect(patch.ok(), `set smoke-service warranty mechanic role: ${patch.status()} ${await patch.text()}`).toBeTruthy();
    return (await patch.json()) as SmokeUser;
  }

  return postJson<SmokeUser>(api, '/api/users', {
    name: 'SMOKE-WARRANTY-MECH-User',
    email: WARRANTY_CREDENTIALS.email,
    role: WARRANTY_ROLE,
    status: 'Активен',
    password: WARRANTY_CREDENTIALS.password,
  });
}

async function ensureWarrantyMechanic(api: APIRequestContext, user: SmokeUser, prefix: string): Promise<Mechanic> {
  const mechanicsResponse = await api.get('/api/mechanics');
  expect(mechanicsResponse.ok()).toBeTruthy();
  const mechanics = await mechanicsResponse.json() as Mechanic[];
  const existing = mechanics.find(item =>
    item.userId === user.id ||
    String(item.email || '').toLowerCase() === WARRANTY_CREDENTIALS.email ||
    item.name === user.name
  );
  if (existing) return existing;

  return postJson<Mechanic>(api, '/api/mechanics', {
    name: user.name || `${prefix}-Mechanic`,
    email: WARRANTY_CREDENTIALS.email,
    phone: '+79990000041',
    userId: user.id,
    specialization: 'SMOKE-WARRANTY-MECH',
    status: 'active',
    notes: prefix,
  });
}

async function seedWarrantyMechanicData(api: APIRequestContext, suffix: string): Promise<SeedData> {
  const prefix = `SMOKE-WARRANTY-MECH-${suffix}`;
  const user = await ensureWarrantySmokeUser(api);
  const mechanic = await ensureWarrantyMechanic(api, user, prefix);

  const equipment = await postJson<{ id: string; inventoryNumber: string; serialNumber: string; manufacturer: string; model: string }>(api, '/api/equipment', {
    inventoryNumber: `SWM-${suffix}`.slice(0, 18),
    manufacturer: 'SMOKE-WARRANTY-MECH',
    model: 'Warranty Lift',
    type: 'scissor',
    drive: 'electric',
    serialNumber: `${prefix}-SN`,
    year: 2026,
    hours: 77,
    liftHeight: 8,
    workingHeight: 10,
    location: `${prefix}-Warranty bay`,
    status: 'service',
    owner: 'own',
    category: 'own',
    priority: 'medium',
    activeInFleet: true,
    plannedMonthlyRevenue: 150000,
    nextMaintenance: '2026-06-15',
    history: [],
  });

  const serviceWork = await postJson<{ id: string; name: string }>(api, '/api/service_works', {
    name: `${prefix}-Hydraulic diagnostics`,
    category: 'warranty',
    normHours: 1.5,
    ratePerHour: 2500,
    isActive: true,
    sortOrder: 1,
    description: prefix,
  });

  const sparePart = await postJson<{ id: string; name: string }>(api, '/api/spare_parts', {
    name: `${prefix}-Seal kit`,
    article: `SWM-${suffix}-SEAL`,
    unit: 'шт',
    defaultPrice: 4200,
    category: 'hydraulic',
    manufacturer: 'SMOKE-WARRANTY-MECH',
    isActive: true,
  });

  const ticket = await postJson<{ id: string; reason: string }>(api, '/api/service', {
    equipmentId: equipment.id,
    equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
    inventoryNumber: equipment.inventoryNumber,
    serialNumber: equipment.serialNumber,
    location: `${prefix}-Warranty bay`,
    reason: `${prefix}-Ticket`,
    description: `${prefix}-Warranty repair and factory claim smoke`,
    priority: 'high',
    status: 'new',
    assignedMechanicId: mechanic.id,
    assignedMechanicName: mechanic.name,
    mechanicId: mechanic.id,
    assignedTo: mechanic.name,
    createdAt: new Date().toISOString(),
    createdBy: 'Playwright',
    photos: [PHOTO_DATA_URL],
    repairPhotos: {
      before: [PHOTO_DATA_URL],
      after: [PHOTO_DATA_URL],
      beforeUploadedAt: new Date().toISOString(),
      beforeUploadedBy: 'Playwright',
      afterUploadedAt: new Date().toISOString(),
      afterUploadedBy: 'Playwright',
    },
  });

  await postJson(api, '/api/repair_work_items', {
    repairId: ticket.id,
    workId: serviceWork.id,
    quantity: 1,
  });

  await postJson(api, '/api/repair_part_items', {
    repairId: ticket.id,
    partId: sparePart.id,
    quantity: 1,
    priceSnapshot: 4200,
  });

  return { user, mechanic, equipment, ticket, serviceWork, sparePart };
}

test('smoke-service can use warranty mechanic UI and warranty workflows without commercial/admin access', async ({ page, request }) => {
  test.setTimeout(270_000);
  const issues: UiIssue[] = [];
  let action = 'setup';
  installUiGuards(page, issues, () => action);

  const suffix = String(Date.now()).slice(-8);
  const seed = await withAdminApi(async (api) => seedWarrantyMechanicData(api, suffix));

  action = 'preflight';
  const health = await request.get('http://127.0.0.1:3000/health');
  expect(health.ok()).toBeTruthy();
  const anonymousMe = await request.get('http://127.0.0.1:3000/api/auth/me');
  expect(anonymousMe.status()).toBe(401);

  action = 'login smoke-service warranty mechanic';
  await login(page, WARRANTY_CREDENTIALS);
  await expect(page.locator('aside').getByRole('button', { name: /^Сервис/ })).toBeVisible();
  await expect(page).not.toHaveURL(/#\/admin/);

  const token = await page.evaluate(() => window.localStorage.getItem('app_auth_token'));
  expect(token).toBeTruthy();
  const authHeaders = { Authorization: `Bearer ${token}` };
  const me = await request.get('http://127.0.0.1:3000/api/auth/me', { headers: authHeaders });
  expect(me.ok()).toBeTruthy();
  const meJson = await me.json();
  expect([meJson.user.rawRole, meJson.user.normalizedRole, meJson.user.userRole]).toContain(WARRANTY_ROLE);
  expect(meJson.user.permissions.readableCollections).toEqual(expect.arrayContaining([
    'equipment',
    'rentals',
    'gantt_rentals',
    'service',
    'warranty_claims',
    'mechanics',
    'service_works',
    'spare_parts',
    'repair_work_items',
    'repair_part_items',
  ]));
  for (const forbiddenCollection of [
    'users',
    'app_settings',
    'clients',
    'client_objects',
    'client_contracts',
    'deliveries',
    'documents',
    'payments',
    'reports',
    'service_vehicles',
    'vehicle_trips',
    'gsm_packets',
    'gsm_commands',
  ]) {
    expect(meJson.user.permissions.readableCollections).not.toContain(forbiddenCollection);
  }

  const sidebar = page.locator('aside');
  for (const section of ALLOWED_SECTIONS) {
    await expect(sidebar.getByRole('button', { name: section.name }), `${section.label} should be visible`).toBeVisible();
  }
  for (const forbidden of FORBIDDEN_NAV_ITEMS) {
    await expect(sidebar.getByRole('button', { name: forbidden })).toBeHidden();
  }

  action = 'warranty claim api create/update';
  const claimPayload = {
    serviceTicketId: seed.ticket.id,
    equipmentId: seed.equipment.id,
    equipmentLabel: `${seed.equipment.manufacturer} ${seed.equipment.model} (INV: ${seed.equipment.inventoryNumber})`,
    inventoryNumber: seed.equipment.inventoryNumber,
    serialNumber: seed.equipment.serialNumber,
    manufacturer: seed.equipment.manufacturer,
    factoryName: seed.equipment.manufacturer,
    factoryContact: `${seed.ticket.reason}@factory.example`,
    factoryCaseNumber: `${seed.ticket.reason}-CASE`,
    failureDescription: `${seed.ticket.reason}-factory failure`,
    requestedResolution: `${seed.ticket.reason}-replace defective unit`,
    status: 'draft',
    priority: 'high',
    responseDueDate: '2026-06-20',
    createdByUserId: seed.user.id,
    createdByUserName: seed.user.name,
    history: [
      {
        date: new Date().toISOString(),
        text: 'SMOKE-WARRANTY-MECH claim created',
        author: seed.user.name,
        type: 'status_change',
      },
    ],
  };
  const createClaim = await request.post('http://127.0.0.1:3000/api/warranty_claims', {
    headers: authHeaders,
    data: claimPayload,
  });
  expect(createClaim.ok(), `warranty claim create: ${createClaim.status()} ${await createClaim.text()}`).toBeTruthy();
  const createdClaim = await createClaim.json();
  expect(createdClaim.serviceTicketId).toBe(seed.ticket.id);
  expect(createdClaim.factoryName).toBe(seed.equipment.manufacturer);
  expect(createdClaim.failureDescription).toBe(claimPayload.failureDescription);
  expect(createdClaim.requestedResolution).toBe(claimPayload.requestedResolution);

  const updateClaim = await request.patch(`http://127.0.0.1:3000/api/warranty_claims/${createdClaim.id}`, {
    headers: authHeaders,
    data: {
      status: 'sent_to_factory',
      factoryResponse: `${seed.ticket.reason}-factory accepted`,
      decision: `${seed.ticket.reason}-warranty approved`,
      responseDueDate: '2026-06-25',
      history: [
        ...(createdClaim.history || []),
        {
          date: new Date().toISOString(),
          text: 'SMOKE-WARRANTY-MECH claim sent',
          author: seed.user.name,
          type: 'status_change',
        },
      ],
    },
  });
  expect(updateClaim.ok(), `warranty claim update: ${updateClaim.status()} ${await updateClaim.text()}`).toBeTruthy();
  const updatedClaim = await updateClaim.json();
  expect(updatedClaim.status).toBe('sent_to_factory');
  expect(updatedClaim.factoryResponse).toContain('factory accepted');
  expect(updatedClaim.decision).toContain('warranty approved');

  action = 'allowed sections';
  for (const section of ALLOWED_SECTIONS) {
    action = `section ${section.label}`;
    await openSectionFromSidebar(page, section);
    await exerciseVisibleTabs(page, section.label);
    await closeDialogIfOpen(page);
  }

  action = 'service detail warranty workflow';
  await goToRoute(page, `/service/${seed.ticket.id}`);
  await expect(page.getByText(seed.ticket.reason).first()).toBeVisible();
  await expect(page.getByText(seed.equipment.inventoryNumber).first()).toBeVisible();
  await expect(page.getByText(seed.serviceWork.name).first()).toBeVisible();
  await expect(page.getByText(seed.sparePart.name).first()).toBeVisible();
  await expect(page.getByText('Фото заявки')).toBeVisible();
  await expect(page.getByText('Фото ремонта')).toBeVisible();
  await expect(page.getByRole('button', { name: /Удалить заявку/ })).toBeHidden();
  const takeInWork = page.getByRole('button', { name: /Взять в работу/ });
  if (await takeInWork.isVisible().catch(() => false)) {
    await takeInWork.click();
    await expect(page.getByText(/В работе|in_progress/).first()).toBeVisible({ timeout: 10_000 });
  }
  const summary = page.getByPlaceholder('Краткий итог работ и состояние техники после ремонта');
  if (await summary.isVisible().catch(() => false)) {
    await summary.fill(`${seed.ticket.reason}-repair summary`);
    await page.getByRole('button', { name: 'Сохранить' }).first().click();
  }
  const mechanicComment = page.getByPlaceholder('Добавить комментарий...');
  if (await mechanicComment.isVisible().catch(() => false)) {
    await mechanicComment.fill(`${seed.ticket.reason}-comment`);
    await page.getByRole('button', { name: 'Добавить' }).last().click();
    await expect(page.getByText(`${seed.ticket.reason}-comment`)).toBeVisible({ timeout: 10_000 });
  }
  await expectHealthyScreen(page, action);

  action = 'warranty tab';
  await goToRoute(page, '/service');
  await page.getByRole('tab', { name: /Рекламации/ }).click();
  await expect(page.getByText(createdClaim.id).first()).toBeVisible();
  await expect(page.getByText(claimPayload.failureDescription).first()).toBeVisible();
  await expectHealthyScreen(page, action);

  action = 'equipment detail redaction';
  await goToRoute(page, `/equipment/${seed.equipment.id}`);
  await expect(page.getByText(seed.equipment.inventoryNumber).first()).toBeVisible();
  await expect(page.getByText('Финансовые показатели скрыты правами доступа.')).toBeVisible();
  await expectHealthyScreen(page, action);

  action = 'rbac api checks';
  for (const path of [
    '/api/equipment',
    `/api/equipment/${seed.equipment.id}`,
    '/api/rentals',
    '/api/gantt_rentals',
    '/api/service',
    `/api/service/${seed.ticket.id}`,
    '/api/warranty_claims',
    `/api/warranty_claims/${createdClaim.id}`,
    '/api/mechanics',
    '/api/service_works',
    '/api/spare_parts',
    `/api/repair_work_items?repair_id=${seed.ticket.id}`,
    `/api/repair_part_items?repair_id=${seed.ticket.id}`,
  ]) {
    const response = await request.get(`http://127.0.0.1:3000${path}`, { headers: authHeaders });
    expect(response.ok(), `${path} should be readable for warranty mechanic`).toBeTruthy();
  }

  const partItemsResponse = await request.get(`http://127.0.0.1:3000/api/repair_part_items?repair_id=${seed.ticket.id}`, { headers: authHeaders });
  const partItems = await partItemsResponse.json();
  expect(partItems[0].nameSnapshot).toBe(seed.sparePart.name);
  expect(partItems[0].priceSnapshot).toBeUndefined();

  const patchCriticalFields = await request.patch(`http://127.0.0.1:3000/api/service/${seed.ticket.id}`, {
    headers: authHeaders,
    data: {
      status: 'in_progress',
      clientId: 'SMOKE-WARRANTY-MECH-FORBIDDEN-CLIENT',
      rentalId: 'SMOKE-WARRANTY-MECH-FORBIDDEN-RENTAL',
      assignedMechanicId: 'SMOKE-WARRANTY-MECH-FORBIDDEN-MECHANIC',
      assignedUserId: 'SMOKE-WARRANTY-MECH-FORBIDDEN-USER',
      result: `${seed.ticket.reason}-api-result`,
    },
  });
  expect(patchCriticalFields.ok(), 'warranty mechanic should update allowed service fields').toBeTruthy();
  const patchedTicket = await request.get(`http://127.0.0.1:3000/api/service/${seed.ticket.id}`, { headers: authHeaders });
  const patchedTicketJson = await patchedTicket.json();
  expect(patchedTicketJson.assignedMechanicId).toBe(seed.mechanic.id);
  expect(patchedTicketJson.assignedUserId).not.toBe('SMOKE-WARRANTY-MECH-FORBIDDEN-USER');
  expect(patchedTicketJson.clientId).not.toBe('SMOKE-WARRANTY-MECH-FORBIDDEN-CLIENT');
  expect(patchedTicketJson.rentalId).not.toBe('SMOKE-WARRANTY-MECH-FORBIDDEN-RENTAL');

  const bulkEquipment = await request.put('http://127.0.0.1:3000/api/equipment', {
    headers: authHeaders,
    data: [{ id: seed.equipment.id, status: 'available' }],
  });
  expect(bulkEquipment.status(), 'warranty mechanic must not bulk-update equipment').toBe(403);

  const serviceDelete = await request.delete(`http://127.0.0.1:3000/api/service/${seed.ticket.id}`, { headers: authHeaders });
  expect(serviceDelete.status(), 'warranty mechanic must not delete service tickets').toBe(403);

  for (const path of [
    '/api/users',
    '/api/clients',
    '/api/client_objects',
    '/api/client_contracts',
    '/api/deliveries',
    '/api/documents',
    '/api/payments',
    '/api/app_settings',
    '/api/service_vehicles',
    '/api/vehicle-trips',
    '/api/gsm/packets',
    '/api/gsm/gateway/packets',
    '/api/gsm/gateway/commands',
    '/api/finance/debt-rows',
    '/api/reports/mechanics-workload',
    '/api/admin/audit-logs',
    '/api/admin/system-data/export',
  ]) {
    const response = await request.get(`http://127.0.0.1:3000${path}`, { headers: authHeaders });
    expect([401, 403].includes(response.status()), `${path} must stay forbidden for warranty mechanic`).toBeTruthy();
  }

  const userPatch = await request.patch('http://127.0.0.1:3000/api/users/U-reset-admin', {
    headers: authHeaders,
    data: { role: 'Администратор' },
  });
  expect(userPatch.status(), '/api/users write must stay forbidden for warranty mechanic').toBe(403);

  const paymentCreate = await request.post('http://127.0.0.1:3000/api/payments', {
    headers: authHeaders,
    data: {
      invoiceNumber: `${seed.ticket.reason}-FORBIDDEN-PAY`,
      amount: 1,
      paidAmount: 0,
      dueDate: '2026-06-10',
      status: 'pending',
    },
  });
  expect(paymentCreate.status(), 'payment creation must stay forbidden for warranty mechanic').toBe(403);

  const documentCreate = await request.post('http://127.0.0.1:3000/api/documents', {
    headers: authHeaders,
    data: {
      type: 'act',
      number: `${seed.ticket.reason}-FORBIDDEN-DOC`,
      status: 'draft',
      date: '2026-06-01',
    },
  });
  expect(documentCreate.status(), 'document creation must stay forbidden for warranty mechanic').toBe(403);

  expect(issues, JSON.stringify(issues, null, 2)).toEqual([]);
});
