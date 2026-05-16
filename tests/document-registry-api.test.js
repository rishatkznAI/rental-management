import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createAccessControl } = require('../server/lib/access-control.js');
const { registerDocumentRoutes } = require('../server/routes/documents.js');

function createApp() {
  let idCounter = 0;
  const state = {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' },
      { id: 'U-office', name: 'Офис', role: 'Офис-менеджер', status: 'Активен' },
      { id: 'U-manager', name: 'Руслан', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-mechanic', name: 'Петров', role: 'Механик', status: 'Активен' },
    ],
    clients: [{
      id: 'C-1',
      company: 'ООО Клиент',
      inn: '7701000000',
      kpp: '770101001',
      ogrn: '1027700000000',
      legalAddress: 'Москва, ул. Тестовая, 1',
      postalAddress: '101000, Москва, а/я 5',
      bankName: 'АО Тест Банк',
      bankBik: '044525000',
      bankAccount: '40702810000000000001',
      corrAccount: '30101810000000000000',
    }],
    rentals: [{ id: 'R-1', clientId: 'C-1', client: 'ООО Клиент', manager: 'Руслан', managerId: 'U-manager' }],
    gantt_rentals: [],
    equipment: [{ id: 'EQ-1', inventoryNumber: 'A-1' }],
    documents: [],
    app_settings: [],
  };
  const users = {
    admin: { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' },
    office: { userId: 'U-office', userName: 'Офис', userRole: 'Офис-менеджер' },
    manager: { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' },
    mechanic: { userId: 'U-mechanic', userName: 'Петров', userRole: 'Механик' },
  };
  const app = express();
  const router = express.Router();
  app.use(express.json());
  const readData = name => state[name] || [];
  const writeData = (name, value) => {
    state[name] = value;
  };
  const accessControl = createAccessControl({ readData });
  const requireAuth = (req, res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = users[token];
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = user;
    next();
  };
  const requireRead = collection => (req, res, next) => {
    if (collection === 'documents' && ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
  const requireWrite = collection => (req, res, next) => {
    if (collection === 'documents' && ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };

  registerDocumentRoutes(router, {
    readData,
    writeData,
    requireAuth,
    requireRead,
    requireWrite,
    accessControl,
    generateId: prefix => `${prefix}-${++idCounter}`,
    idPrefixes: { documents: 'D' },
    nowIso: () => '2026-05-09T10:00:00.000Z',
    auditLog: null,
    normalizeRecordClientLink: item => item,
  });
  app.use('/api', router);
  return { app, state };
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const { port } = server.address();
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await response.json().catch(() => null);
  return { response, json };
}

test('documents API creates documents with automatic numbers and separate sequences', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    const act = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-1',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(act.response.status, 201);
    assert.equal(act.json.number, 'ACT-2026-0001');
    assert.equal(state.documents[0].history.some(entry => entry.action === 'number_assigned'), true);

    const invoice = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'invoice',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(invoice.response.status, 201);
    assert.equal(invoice.json.number, 'INVOICE-2026-0001');
  });
});

test('closing rental documents snapshot downtime-adjusted billing amount', async () => {
  const { app, state } = createApp();
  state.rentals = [{
    id: 'R-metal',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    price: 310000,
  }];
  state.gantt_rentals = [{
    id: 'GR-metal',
    rentalId: 'R-metal',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
    downtimePeriods: [
      { id: 'DT-1', rentalId: 'R-metal', startDate: '2026-05-01', endDate: '2026-05-07', reason: 'ожидание клиента', affectsBilling: true, status: 'active' },
      { id: 'DT-2', rentalId: 'R-metal', startDate: '2026-05-13', endDate: '2026-05-17', reason: 'эвакуатор не мог забрать технику', affectsBilling: true, status: 'active' },
    ],
  }];

  await withServer(app, async (baseUrl) => {
    const act = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-metal',
      amount: 310000,
      date: '2026-05-31',
      status: 'draft',
    });

    assert.equal(act.response.status, 201);
    assert.equal(act.json.amount, 190000);
    assert.equal(act.json.rentalBillingSnapshot.grossRentalAmount, 310000);
    assert.equal(act.json.rentalBillingSnapshot.downtimeAdjustmentAmount, 120000);
    assert.equal(act.json.rentalBillingSnapshot.finalRentalAmount, 190000);
    assert.equal(act.json.rentalBillingSnapshot.billingDowntimeDays, 12);

    const upd = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'upd',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-metal',
      date: '2026-05-31',
      status: 'draft',
    });

    assert.equal(upd.response.status, 201);
    assert.equal(upd.json.amount, 190000);
    assert.equal(upd.json.billingSnapshot.billableDays, 19);
  });
});

test('document snapshots stay fixed and new documents use current downtime billing', async () => {
  const { app, state } = createApp();
  state.rentals = [{
    id: 'R-snapshot',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    price: 310000,
  }];
  state.gantt_rentals = [{
    id: 'GR-snapshot',
    rentalId: 'R-snapshot',
    clientId: 'C-1',
    client: 'ООО Клиент',
    manager: 'Руслан',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
    downtimePeriods: [
      { id: 'DT-1', rentalId: 'R-snapshot', startDate: '2026-05-01', endDate: '2026-05-07', reason: 'ожидание клиента', affectsBilling: true, status: 'active' },
    ],
  }];

  await withServer(app, async (baseUrl) => {
    const first = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-snapshot',
      date: '2026-05-31',
      status: 'draft',
    });
    assert.equal(first.response.status, 201);
    assert.equal(first.json.amount, 240000);

    state.gantt_rentals[0].downtimePeriods.push(
      { id: 'DT-2', rentalId: 'R-snapshot', startDate: '2026-05-13', endDate: '2026-05-17', reason: 'эвакуатор', affectsBilling: true, status: 'active' },
    );

    const oldDoc = await request(baseUrl, 'GET', `/api/documents/${first.json.id}`, 'office');
    assert.equal(oldDoc.response.status, 200);
    assert.equal(oldDoc.json.amount, 240000);
    assert.equal(oldDoc.json.rentalBillingSnapshot.finalRentalAmount, 240000);

    const second = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-snapshot',
      date: '2026-05-31',
      status: 'draft',
    });
    assert.equal(second.response.status, 201);
    assert.equal(second.json.amount, 190000);
    assert.equal(second.json.rentalBillingSnapshot.finalRentalAmount, 190000);
  });
});

test('contract and custom invoice amounts are not overwritten by downtime billing', async () => {
  const { app, state } = createApp();
  state.rentals = [{
    id: 'R-contract',
    clientId: 'C-1',
    client: 'ООО Клиент',
    startDate: '2026-05-01',
    plannedReturnDate: '2026-05-31',
    price: 310000,
  }];
  state.gantt_rentals = [{
    id: 'GR-contract',
    rentalId: 'R-contract',
    startDate: '2026-05-01',
    endDate: '2026-05-31',
    amount: 310000,
    downtimePeriods: [
      { id: 'DT-1', rentalId: 'R-contract', startDate: '2026-05-01', endDate: '2026-05-07', reason: 'ожидание клиента', affectsBilling: true, status: 'active' },
    ],
  }];

  await withServer(app, async (baseUrl) => {
    const contract = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-contract',
      amount: 310000,
      date: '2026-05-01',
      status: 'draft',
    });
    assert.equal(contract.response.status, 201);
    assert.equal(contract.json.amount, 310000);
    assert.equal(contract.json.rentalBillingSnapshot.finalRentalAmount, 240000);

    const invoice = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'invoice',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-contract',
      amount: 50000,
      date: '2026-05-10',
      status: 'draft',
    });
    assert.equal(invoice.response.status, 201);
    assert.equal(invoice.json.amount, 50000);
    assert.equal(invoice.json.rentalBillingSnapshot.finalRentalAmount, 240000);
  });
});

test('documents API rejects duplicate manual numbers and PATCH duplicates', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const first = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      number: 'CONTRACT-2026-0007',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(first.response.status, 201);

    const duplicate = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      number: 'CONTRACT-2026-0007',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-10',
      status: 'draft',
    });
    assert.equal(duplicate.response.status, 409);

    const second = await request(baseUrl, 'POST', '/api/documents', 'office', {
      type: 'contract',
      number: 'CONTRACT-2026-0008',
      clientId: 'C-1',
      client: 'ООО Клиент',
      date: '2026-05-10',
      status: 'draft',
    });
    assert.equal(second.response.status, 201);

    const patchDuplicate = await request(baseUrl, 'PATCH', `/api/documents/${second.json.id}`, 'office', {
      number: 'CONTRACT-2026-0007',
    });
    assert.equal(patchDuplicate.response.status, 409);
  });
});

test('documents API assigns number to legacy document and reports registry summary', async () => {
  const { app, state } = createApp();
  state.documents = [{
    id: 'D-legacy',
    type: 'upd',
    number: '',
    clientId: 'C-1',
    client: 'ООО Клиент',
    date: '2026-05-08',
    status: 'sent',
  }];
  await withServer(app, async (baseUrl) => {
    const before = await request(baseUrl, 'GET', '/api/documents/registry/summary', 'office');
    assert.equal(before.response.status, 200);
    assert.equal(before.json.withoutNumber, 1);

    const assigned = await request(baseUrl, 'POST', '/api/documents/D-legacy/assign-number', 'office');
    assert.equal(assigned.response.status, 200);
    assert.equal(assigned.json.number, 'UPD-2026-0001');
    assert.equal(assigned.json.history.some(entry => entry.action === 'number_changed'), true);

    const after = await request(baseUrl, 'GET', '/api/documents/registry/summary', 'office');
    assert.equal(after.json.withoutNumber, 0);
  });
});

test('documents API records status history and blocks forbidden roles', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const denied = await request(baseUrl, 'GET', '/api/documents', 'mechanic');
    assert.equal(denied.response.status, 403);

    const managerManual = await request(baseUrl, 'POST', '/api/documents', 'manager', {
      type: 'act',
      number: 'ACT-2026-0099',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-1',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(managerManual.response.status, 403);

    const auto = await request(baseUrl, 'POST', '/api/documents', 'manager', {
      type: 'act',
      clientId: 'C-1',
      client: 'ООО Клиент',
      rentalId: 'R-1',
      date: '2026-05-09',
      status: 'draft',
    });
    assert.equal(auto.response.status, 201);

    const sent = await request(baseUrl, 'PATCH', `/api/documents/${auto.json.id}`, 'manager', { status: 'sent' });
    assert.equal(sent.response.status, 200);
    assert.equal(sent.json.sentAt, '2026-05-09T10:00:00.000Z');
    assert.equal(sent.json.history.some(entry => entry.field === 'status'), true);
  });
});

test('documents generate API creates every workspace document type with snapshots and print html', async () => {
  const { app, state } = createApp();
  state.service = [{
    id: 'S-1',
    clientId: 'C-1',
    rentalId: 'R-1',
    equipmentId: 'EQ-1',
    reason: 'Проверка после возврата',
    assignedMechanicId: 'M-1',
    assignedMechanicName: 'Петров',
  }];
  state.deliveries = [{ id: 'DEL-1', rentalId: 'R-1', clientId: 'C-1', equipmentId: 'EQ-1', status: 'planned', routeTo: 'Объект клиента' }];
  state.mechanics = [{ id: 'M-1', name: 'Петров' }];
  state.service_vehicles = [{ id: 'CAR-1', make: 'УАЗ', model: 'Профи', plateNumber: 'А001АА' }];

  const cases = [
    ['rental_contract', { clientId: 'C-1', signerName: 'Иванов Иван', signerPosition: 'директор', signerBasis: 'Устав' }, 'DA-2026-0001'],
    ['rental_specification', { clientId: 'C-1', rentalId: 'R-1', equipmentId: 'EQ-1' }, 'SP-2026-0001'],
    ['transfer_act_to_client', { clientId: 'C-1', rentalId: 'R-1', deliveryId: 'DEL-1', equipmentId: 'EQ-1' }, 'AP-2026-0001'],
    ['return_act_from_client', { clientId: 'C-1', rentalId: 'R-1', deliveryId: 'DEL-1', equipmentId: 'EQ-1', serviceTicketId: 'S-1' }, 'AR-2026-0001'],
    ['work_order', { serviceTicketId: 'S-1', equipmentId: 'EQ-1', mechanicId: 'M-1', clientId: 'C-1', rentalId: 'R-1' }, 'ZN-2026-0001'],
    ['trip_ticket', { mechanicId: 'M-1', serviceCarId: 'CAR-1', serviceTicketId: 'S-1' }, 'PL-2026-0001'],
  ];

  await withServer(app, async (baseUrl) => {
    for (const [type, payload, expectedNumber] of cases) {
      const generated = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
        type,
        date: '2026-05-09',
        ...payload,
      });
      assert.equal(generated.response.status, 201, `${type}: ${JSON.stringify(generated.json)}`);
      assert.equal(generated.json.type, type);
      assert.equal(generated.json.number, expectedNumber);
      assert.equal(generated.json.date, '2026-05-09');
      assert.equal(generated.json.documentDate, '2026-05-09');
      assert.equal(generated.json.status, 'draft');
      assert.ok(generated.json.snapshot.generatedAt);
      assert.match(generated.json.printHtml, /<!doctype html>/i);
      assert.ok(Array.isArray(generated.json.payload.lines));
      if (type === 'rental_contract') {
        assert.equal(generated.json.rentalId, undefined);
        assert.equal(generated.json.payload.signer.name, 'Иванов Иван');
        assert.equal(generated.json.payload.requisites.inn, '7701000000');
        assert.equal(generated.json.payload.bank.bankName, 'АО Тест Банк');
        assert.match(generated.json.printHtml, /№ DA-2026-0001 от 2026-05-09/);
        assert.match(generated.json.printHtml, /рамочным договором аренды/);
        assert.match(generated.json.printHtml, /спецификация является приложением/);
        assert.match(generated.json.printHtml, /Юридическое название/);
        assert.match(generated.json.printHtml, /ИНН/);
        assert.match(generated.json.printHtml, /7701000000/);
        assert.match(generated.json.printHtml, /КПП/);
        assert.match(generated.json.printHtml, /770101001/);
        assert.match(generated.json.printHtml, /ОГРН/);
        assert.match(generated.json.printHtml, /1027700000000/);
        assert.match(generated.json.printHtml, /Юридический адрес/);
        assert.match(generated.json.printHtml, /Москва, ул\. Тестовая, 1/);
        assert.match(generated.json.printHtml, /Почтовый адрес/);
        assert.match(generated.json.printHtml, /101000, Москва, а\/я 5/);
        assert.match(generated.json.printHtml, /ФИО подписанта/);
        assert.match(generated.json.printHtml, /Должность подписанта/);
        assert.match(generated.json.printHtml, /Основание подписания/);
        assert.match(generated.json.printHtml, /Банковские реквизиты/);
        assert.match(generated.json.printHtml, /АО Тест Банк/);
        assert.match(generated.json.printHtml, /044525000/);
        assert.match(generated.json.printHtml, /40702810000000000001/);
        assert.match(generated.json.printHtml, /Подписи сторон/);
        assert.match(generated.json.printHtml, /Арендодатель/);
        assert.match(generated.json.printHtml, /Арендатор/);
        assert.doesNotMatch(generated.json.printHtml, /A-1/);
        assert.doesNotMatch(generated.json.printHtml, /R-1/);
        assert.doesNotMatch(generated.json.printHtml, /Сервисная заявка/);
        assert.doesNotMatch(generated.json.printHtml, /Механик/);
        assert.doesNotMatch(generated.json.printHtml, /Служебный автомобиль|служебная машина/i);
        assert.doesNotMatch(generated.json.printHtml, /Пробег|Запчасти|Выполненные работы/);
      }
    }
  });
});

test('rental contract print uses stored snapshot, preserves date, and tolerates partial client requisites', async () => {
  const { app, state } = createApp();
  state.clients.push({
    id: 'C-partial',
    company: 'ИП Частичный',
    inn: '771122334455',
    legalAddress: 'Москва, пер. Короткий, 2',
  });

  await withServer(app, async (baseUrl) => {
    const created = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      clientId: 'C-1',
      signerName: 'Иванов Иван Иванович',
      signerPosition: 'Генеральный директор',
      signerBasis: 'Устав',
      date: '2026-05-09',
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.json.date, '2026-05-09');
    assert.equal(created.json.documentDate, '2026-05-09');
    assert.equal(created.json.snapshot.client.inn, '7701000000');

    state.clients[0] = {
      ...state.clients[0],
      company: 'ООО Клиент После Изменения',
      inn: '9999999999',
      legalAddress: 'Новый адрес',
      bankName: 'Новый Банк',
    };

    const print = await fetch(`${baseUrl}/api/documents/${created.json.id}/print`, {
      headers: { authorization: 'Bearer office' },
    });
    const html = await print.text();
    assert.equal(print.status, 200);
    assert.match(html, /№ DA-2026-0001 от 2026-05-09/);
    assert.match(html, /7701000000/);
    assert.match(html, /Москва, ул\. Тестовая, 1/);
    assert.match(html, /АО Тест Банк/);
    assert.doesNotMatch(html, /9999999999/);
    assert.doesNotMatch(html, /Новый адрес/);
    assert.doesNotMatch(html, /Новый Банк/);

    const partial = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      clientId: 'C-partial',
      signerName: 'Петров Пётр Петрович',
      signerPosition: 'Индивидуальный предприниматель',
      signerBasis: 'ОГРНИП',
      date: '2026-05-09',
    });
    assert.equal(partial.response.status, 201);
    assert.match(partial.json.printHtml, /ИП Частичный/);
    assert.match(partial.json.printHtml, /771122334455/);
    assert.match(partial.json.printHtml, /Москва, пер\. Короткий, 2/);
    assert.doesNotMatch(partial.json.printHtml, /<th>КПП<\/th>/);
    assert.doesNotMatch(partial.json.printHtml, /<th>ОГРН<\/th>/);
    assert.doesNotMatch(partial.json.printHtml, /Банковские реквизиты/);
  });
});

test('documents generate API rejects missing required data and supports status endpoints, duplicate, print and delete', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const missingClient = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      signerName: 'Иванов Иван',
      signerPosition: 'директор',
      signerBasis: 'Устав',
      date: '2026-05-09',
    });
    assert.equal(missingClient.response.status, 400);
    assert.equal(missingClient.json.code, 'DOCUMENT_REQUIRED_FIELDS');

    const missing = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      clientId: 'C-1',
      signerName: 'Иванов Иван',
      signerPosition: 'директор',
      date: '2026-05-09',
    });
    assert.equal(missing.response.status, 400);
    assert.equal(missing.json.code, 'DOCUMENT_REQUIRED_FIELDS');

    const missingSigner = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      clientId: 'C-1',
      signerPosition: 'директор',
      signerBasis: 'Устав',
      date: '2026-05-09',
    });
    assert.equal(missingSigner.response.status, 400);
    assert.equal(missingSigner.json.code, 'DOCUMENT_REQUIRED_FIELDS');

    const created = await request(baseUrl, 'POST', '/api/documents/generate', 'office', {
      type: 'rental_contract',
      clientId: 'C-1',
      signerName: 'Иванов Иван',
      signerPosition: 'директор',
      signerBasis: 'Устав',
      date: '2026-05-09',
    });
    assert.equal(created.response.status, 201);
    assert.equal(created.json.clientId, 'C-1');
    assert.equal(created.json.date, '2026-05-09');
    assert.equal(created.json.documentDate, '2026-05-09');

    const sent = await request(baseUrl, 'POST', `/api/documents/${created.json.id}/mark-sent`, 'office', { status: 'pending_signature' });
    assert.equal(sent.response.status, 200);
    assert.equal(sent.json.status, 'pending_signature');
    assert.equal(sent.json.sentAt, '2026-05-09T10:00:00.000Z');

    const signed = await request(baseUrl, 'POST', `/api/documents/${created.json.id}/mark-signed`, 'office');
    assert.equal(signed.response.status, 200);
    assert.equal(signed.json.status, 'signed');
    assert.equal(signed.json.signedAt, '2026-05-09T10:00:00.000Z');

    const duplicate = await request(baseUrl, 'POST', `/api/documents/${created.json.id}/duplicate`, 'office');
    assert.equal(duplicate.response.status, 201);
    assert.equal(duplicate.json.status, 'draft');
    assert.notEqual(duplicate.json.number, created.json.number);

    const print = await fetch(`${baseUrl}/api/documents/${created.json.id}/print`, {
      headers: { authorization: 'Bearer office' },
    });
    assert.equal(print.status, 200);
    assert.match(await print.text(), /Договор аренды/);

    const deleted = await request(baseUrl, 'DELETE', `/api/documents/${duplicate.json.id}`, 'admin');
    assert.equal(deleted.response.status, 200);
    assert.equal(deleted.json.ok, true);
  });
});
