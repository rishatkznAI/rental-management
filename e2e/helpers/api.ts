import { expect, request as playwrightRequest, type APIRequestContext } from '@playwright/test';

type AuthUser = {
  id: string;
  name: string;
  role: string;
  email: string;
};

type AuthResponse = {
  ok: boolean;
  token: string;
  user: AuthUser;
};

type ClientRecord = {
  id: string;
  company: string;
  inn: string;
  contact: string;
  phone: string;
  email: string;
  paymentTerms: string;
  creditLimit: number;
  debt: number;
  totalRentals: number;
  status?: string;
};

type EquipmentRecord = {
  id: string;
  inventoryNumber: string;
  manufacturer: string;
  model: string;
  serialNumber: string;
  status: string;
};

type RentalRecord = {
  id: string;
  client: string;
};

type ServiceTicketRecord = {
  id: string;
  reason: string;
  equipmentId?: string;
  status?: string;
};

type DocumentRecord = {
  id: string;
  type: string;
  number: string;
  client: string;
  clientId?: string;
  rentalId?: string;
  rental?: string;
  equipmentId?: string;
  equipmentInv?: string;
  status: string;
  manager?: string;
};

type UserRecord = {
  id: string;
  name: string;
  email: string;
  role: string;
  status: string;
};

type GanttRentalRecord = {
  id: string;
  client: string;
  equipmentId?: string;
  equipmentInv: string;
  status: string;
};

const API_BASE_URL = 'http://127.0.0.1:3000';

async function createAuthedContext(email: string, password: string): Promise<APIRequestContext> {
  const bootstrap = await playwrightRequest.newContext({ baseURL: API_BASE_URL });
  const authRes = await bootstrap.post('/api/auth/login', {
    data: { email, password },
  });
  expect(authRes.ok()).toBeTruthy();
  const authJson = (await authRes.json()) as AuthResponse;
  await bootstrap.dispose();

  return playwrightRequest.newContext({
    baseURL: API_BASE_URL,
    extraHTTPHeaders: {
      Authorization: `Bearer ${authJson.token}`,
      'Content-Type': 'application/json',
    },
  });
}

export async function withAdminApi<T>(fn: (api: APIRequestContext) => Promise<T>) {
  const api = await createAuthedContext('admin@rental.local', 'admin123');
  try {
    return await fn(api);
  } finally {
    await api.dispose();
  }
}

export async function getAnyRentableEquipment(api: APIRequestContext): Promise<EquipmentRecord> {
  return createEquipment(api, `seed-${Date.now()}`);
}

export async function createEquipment(api: APIRequestContext, suffix: string): Promise<EquipmentRecord> {
  const res = await api.post('/api/equipment', {
    data: {
      inventoryNumber: `E2E-${suffix}`.slice(-12),
      manufacturer: 'E2E',
      model: `Lift-${suffix}`.slice(0, 24),
      type: 'scissor',
      drive: 'electric',
      serialNumber: `SN-${suffix}`,
      year: 2026,
      hours: 12,
      liftHeight: 8,
      workingHeight: 10,
      location: 'E2E площадка',
      status: 'available',
      owner: 'own',
      category: 'own',
      priority: 'medium',
      activeInFleet: true,
      plannedMonthlyRevenue: 0,
      nextMaintenance: '2026-05-01',
      history: [],
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as EquipmentRecord;
}

export async function createClient(api: APIRequestContext, suffix: string): Promise<ClientRecord> {
  const company = `E2E Client ${suffix}`;
  const res = await api.post('/api/clients', {
    data: {
      company,
      inn: `${Date.now()}`.slice(-10),
      contact: `E2E Contact ${suffix}`,
      phone: '+79990000000',
      email: `e2e-client-${suffix}@example.local`,
      address: 'Kazan',
      paymentTerms: '7 дней',
      creditLimit: 0,
      debt: 0,
      totalRentals: 0,
      status: 'active',
      createdAt: new Date().toISOString(),
      createdBy: 'E2E',
      notes: 'Created by Playwright',
      history: [],
    },
  });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as ClientRecord;
}

export async function findClientByCompany(api: APIRequestContext, company: string): Promise<ClientRecord> {
  const res = await api.get('/api/clients');
  expect(res.ok()).toBeTruthy();
  const clients = (await res.json()) as ClientRecord[];
  const client = [...clients].reverse().find(item => item.company === company);
  expect(client, `Expected client ${company}`).toBeTruthy();
  return client!;
}

export async function findEquipmentBySerialNumber(api: APIRequestContext, serialNumber: string): Promise<EquipmentRecord> {
  const res = await api.get('/api/equipment');
  expect(res.ok()).toBeTruthy();
  const equipment = (await res.json()) as EquipmentRecord[];
  const item = [...equipment].reverse().find(entry => entry.serialNumber === serialNumber);
  expect(item, `Expected equipment with serial number ${serialNumber}`).toBeTruthy();
  return item!;
}

export async function ensureUser(
  api: APIRequestContext,
  user: {
    name: string;
    email: string;
    role: string;
    password?: string;
  },
): Promise<{ email: string; password: string }> {
  const password = user.password ?? '1234';
  const getRes = await api.get('/api/users');
  expect(getRes.ok()).toBeTruthy();
  const users = (await getRes.json()) as UserRecord[];
  const existing = users.find(item => item.email === user.email);
  if (existing) {
    const patchRes = await api.patch(`/api/users/${existing.id}`, {
      data: {
        name: user.name,
        role: user.role,
        status: 'Активен',
        password,
      },
    });
    expect(patchRes.ok()).toBeTruthy();
    return { email: user.email, password };
  }

  const createRes = await api.post('/api/users', {
    data: {
      name: user.name,
      email: user.email,
      role: user.role,
      status: 'Активен',
      password,
    },
  });
  expect(createRes.ok()).toBeTruthy();
  return { email: user.email, password };
}

export async function ensureOfficeManager(api: APIRequestContext, suffix: string) {
  const email = `e2e-office-${suffix}@example.local`;
  const getRes = await api.get('/api/users');
  expect(getRes.ok()).toBeTruthy();
  const users = (await getRes.json()) as Array<{ email: string }>;
  const exists = users.some(user => user.email === email);
  if (!exists) {
    const createRes = await api.post('/api/users', {
      data: {
        name: `E2E Office ${suffix}`,
        email,
        role: 'Офис-менеджер',
        status: 'Активен',
        password: '1234',
      },
    });
    expect(createRes.ok()).toBeTruthy();
  }
  return { email, password: '1234' };
}

export async function createRentalPair(
  api: APIRequestContext,
  options: {
    client: string;
    equipment: EquipmentRecord;
    startDate: string;
    endDate: string;
    amount?: number;
    manager?: string;
  },
): Promise<{ rental: RentalRecord; ganttId: string }> {
  const amount = options.amount ?? 10000;
  const manager = options.manager ?? 'E2E';
  const rentalRes = await api.post('/api/rentals', {
    data: {
      client: options.client,
      contact: 'E2E Contact',
      startDate: options.startDate,
      plannedReturnDate: options.endDate,
      equipment: [options.equipment.inventoryNumber],
      rate: '1000 ₽/день',
      price: amount,
      discount: 0,
      deliveryAddress: 'Kazan',
      manager,
      status: 'new',
      comments: 'Created by Playwright',
    },
  });
  expect(rentalRes.ok()).toBeTruthy();
  const rental = (await rentalRes.json()) as RentalRecord;

  const ganttRes = await api.post('/api/gantt_rentals', {
    data: {
      rentalId: rental.id,
      client: options.client,
      clientShort: options.client.slice(0, 20),
      equipmentId: options.equipment.id,
      equipmentInv: options.equipment.inventoryNumber,
      startDate: options.startDate,
      endDate: options.endDate,
      manager,
      managerInitials: 'E2E',
      status: 'created',
      paymentStatus: 'unpaid',
      updSigned: false,
      amount,
      comments: [],
    },
  });
  expect(ganttRes.ok()).toBeTruthy();
  const gantt = (await ganttRes.json()) as { id: string };

  return { rental, ganttId: gantt.id };
}

export async function findRentalByClient(api: APIRequestContext, client: string): Promise<RentalRecord> {
  const res = await api.get('/api/rentals');
  expect(res.ok()).toBeTruthy();
  const rentals = (await res.json()) as RentalRecord[];
  const rental = [...rentals].reverse().find(item => item.client === client);
  expect(rental, `Expected rental for client ${client}`).toBeTruthy();
  return rental!;
}

export async function findServiceTicketByReason(api: APIRequestContext, reason: string): Promise<ServiceTicketRecord> {
  const res = await api.get('/api/service');
  expect(res.ok()).toBeTruthy();
  const tickets = (await res.json()) as ServiceTicketRecord[];
  const ticket = [...tickets].reverse().find(item => item.reason === reason);
  expect(ticket, `Expected service ticket for reason ${reason}`).toBeTruthy();
  return ticket!;
}

export async function findGanttRentalById(api: APIRequestContext, id: string): Promise<GanttRentalRecord> {
  const res = await api.get('/api/gantt_rentals');
  expect(res.ok()).toBeTruthy();
  const rentals = (await res.json()) as GanttRentalRecord[];
  const rental = rentals.find(item => item.id === id);
  expect(rental, `Expected gantt rental ${id}`).toBeTruthy();
  return rental!;
}

export async function getEquipmentById(api: APIRequestContext, id: string): Promise<EquipmentRecord> {
  const res = await api.get(`/api/equipment/${id}`);
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as EquipmentRecord;
}

export async function findServiceTicketByEquipmentId(api: APIRequestContext, equipmentId: string): Promise<ServiceTicketRecord | null> {
  const res = await api.get('/api/service');
  expect(res.ok()).toBeTruthy();
  const tickets = (await res.json()) as ServiceTicketRecord[];
  return [...tickets].reverse().find(item => item.equipmentId === equipmentId) ?? null;
}

export async function createDocument(
  api: APIRequestContext,
  data: Omit<DocumentRecord, 'id'>,
): Promise<DocumentRecord> {
  const res = await api.post('/api/documents', { data });
  expect(res.ok()).toBeTruthy();
  return (await res.json()) as DocumentRecord;
}
