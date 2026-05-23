#!/usr/bin/env node

const crypto = require('crypto');
const path = require('path');

const STRONG_HASH_PREFIX = 'h2:scrypt:';
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };
const DEMO_PREFIX = 'DEMO-';
const DEMO_USER_EMAILS = [
  'demo-admin@skytech.local',
  'demo-manager@skytech.local',
  'demo-service@skytech.local',
  'demo-viewer@skytech.local',
];

function truthy(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function envText(env = process.env) {
  return [
    env.APP_ENVIRONMENT,
    env.APP_ENV,
    env.RAILWAY_ENVIRONMENT_NAME,
    env.RAILWAY_ENVIRONMENT,
    env.RAILWAY_PROJECT_NAME,
    env.RAILWAY_SERVICE_NAME,
    env.NODE_ENV,
  ].filter(Boolean).join(' ').toLowerCase();
}

function isProductionLike(env = process.env) {
  const text = envText(env);
  return /\bprod(uction)?\b/.test(text) && !/\bdemo\b/.test(text);
}

function isStagingLike(env = process.env) {
  return /\bstag(e|ing)?\b/.test(envText(env));
}

function hasDemoEnvironmentName(env = process.env) {
  return [
    env.APP_ENVIRONMENT,
    env.APP_ENV,
    env.RAILWAY_ENVIRONMENT_NAME,
    env.RAILWAY_ENVIRONMENT,
  ].filter(Boolean).some(value => /\bdemo\b/i.test(String(value)));
}

function assertDemoSeedAllowed({ env = process.env, dbPath = env.DB_PATH } = {}) {
  if (!truthy(env.DEMO_ENV) && !truthy(env.ALLOW_DEMO_SEED)) {
    throw new Error('Refused: set DEMO_ENV=true or ALLOW_DEMO_SEED=true to seed demo data.');
  }
  if (isProductionLike(env)) throw new Error('Refused: environment looks production-like.');
  if (isStagingLike(env)) throw new Error('Refused: environment looks staging-like.');
  if (!truthy(env.DEMO_ENV) && !hasDemoEnvironmentName(env)) {
    throw new Error('Refused: environment name is not clearly demo.');
  }

  const resolved = path.resolve(String(dbPath || ''));
  const base = path.basename(resolved).toLowerCase();
  if (!base.includes('demo') || base === 'app.sqlite') {
    throw new Error('Refused: DB_PATH must point to a clearly named demo database.');
  }
  return true;
}

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(String(plain), salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS).toString('base64url');
  return `${STRONG_HASH_PREFIX}${salt}:${hash}`;
}

function demoPassword(env = process.env) {
  return String(env.DEMO_DEFAULT_PASSWORD || env.DEMO_SEED_PASSWORD || 'demo-local-change-me');
}

function iso(date) {
  return new Date(date).toISOString();
}

function dateOnly(date) {
  return iso(date).slice(0, 10);
}

function addDays(now, days) {
  return new Date(now.getTime() + days * 24 * 60 * 60 * 1000);
}

function demoRecordId(record) {
  return [
    record?.id,
    record?.rentalId,
    record?.equipmentId,
    record?.clientId,
    record?.number,
    record?.invoice,
    record?.inventoryNumber,
    record?.documentNumber,
  ].some(value => String(value || '').startsWith(DEMO_PREFIX));
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function replaceDemoRecords(collectionName, fixtures, predicate = demoRecordId) {
  const { getData, setData } = require('../db');
  const current = asArray(getData(collectionName));
  const kept = current.filter(item => !predicate(item));
  const next = [...kept, ...fixtures];
  setData(collectionName, next);
  return {
    collection: collectionName,
    removed: current.length - kept.length,
    upserted: fixtures.length,
    total: next.length,
  };
}

function buildDemoData({ now = new Date('2026-05-23T09:00:00.000Z'), env = process.env } = {}) {
  const nowIso = now.toISOString();
  const passwordHash = hashPassword(demoPassword(env));
  const users = [
    { id: 'DEMO-USER-ADMIN', name: 'Demo Admin', email: 'demo-admin@skytech.local', role: 'Администратор', status: 'Активен', password: passwordHash, fixtureTag: DEMO_PREFIX, createdAt: nowIso },
    { id: 'DEMO-USER-MANAGER', name: 'Demo Rental Manager', email: 'demo-manager@skytech.local', role: 'Менеджер по аренде', status: 'Активен', password: passwordHash, fixtureTag: DEMO_PREFIX, createdAt: nowIso },
    { id: 'DEMO-USER-SERVICE', name: 'Demo Service Mechanic', email: 'demo-service@skytech.local', role: 'Механик', status: 'Активен', password: passwordHash, fixtureTag: DEMO_PREFIX, createdAt: nowIso },
    { id: 'DEMO-USER-VIEWER', name: 'Demo Viewer', email: 'demo-viewer@skytech.local', role: 'Инвестор', status: 'Активен', password: passwordHash, ownerId: 'DEMO-OWNER-001', fixtureTag: DEMO_PREFIX, createdAt: nowIso },
  ];

  const clients = [
    ['001', 'Демо Строй Парк', 'DEMO-INN-0000000001', 'Алина Макетова', 'client-001@example.test', 780000],
    ['002', 'Вектор Демо Девелопмент', 'DEMO-INN-0000000002', 'Илья Образцов', 'client-002@example.test', 540000],
    ['003', 'Северная Тестовая Линия', 'DEMO-INN-0000000003', 'Мария Сценариева', 'client-003@example.test', 320000],
    ['004', 'Каскад Учебный Проект', 'DEMO-INN-0000000004', 'Павел Примеров', 'client-004@example.test', 410000],
    ['005', 'Монтаж Демо Групп', 'DEMO-INN-0000000005', 'Нина Контурова', 'client-005@example.test', 250000],
  ].map(([suffix, company, inn, contactPerson, email, creditLimit], index) => ({
    id: `DEMO-CLIENT-${suffix}`,
    name: company,
    company,
    inn,
    contactPerson,
    phone: `+7 900 100-0${index + 1}-00`,
    email,
    managerId: 'DEMO-USER-MANAGER',
    manager: 'Demo Rental Manager',
    status: 'Активен',
    paymentTerms: index % 2 === 0 ? 'Постоплата 7 дней' : 'Предоплата',
    creditLimit,
    debt: index === 0 ? 130000 : 0,
    riskLevel: index === 0 ? 'Средний' : 'Низкий',
    fixtureTag: DEMO_PREFIX,
    createdAt: nowIso,
  }));

  const equipmentSpecs = [
    ['001', 'Dingli JCPT1212DC', 'Dingli', 'scissor', 'electric', 'available', 2023, 11.8, 320],
    ['002', 'Genie GS-3246', 'Genie', 'scissor', 'electric', 'rented', 2021, 11.8, 318],
    ['003', 'JLG 1930ES', 'JLG', 'scissor', 'electric', 'in_service', 2020, 7.8, 230],
    ['004', 'Skyjack SJ6832 RT', 'Skyjack', 'scissor', 'diesel', 'reserved', 2022, 11.6, 454],
    ['005', 'Haulotte Compact 12', 'Haulotte', 'scissor', 'electric', 'available', 2023, 12, 450],
    ['006', 'Genie GS-4069 RT', 'Genie', 'scissor', 'diesel', 'available', 2021, 14.1, 363],
    ['007', 'Haulotte HA16 RTJ', 'Haulotte', 'articulated', 'diesel', 'rented', 2022, 16, 230],
    ['008', 'JLG 450AJ', 'JLG', 'articulated', 'diesel', 'available', 2020, 15.7, 250],
    ['009', 'Genie Z-45 XC', 'Genie', 'articulated', 'diesel', 'in_service', 2021, 15.9, 300],
    ['010', 'Manitou 160 ATJ', 'Manitou', 'articulated', 'diesel', 'reserved', 2022, 16.3, 230],
    ['011', 'Haulotte HA20 RTJ', 'Haulotte', 'articulated', 'diesel', 'available', 2023, 20.6, 230],
    ['012', 'JLG 600AJ', 'JLG', 'articulated', 'diesel', 'available', 2019, 20.5, 230],
    ['013', 'Genie S-45 XC', 'Genie', 'telescopic', 'diesel', 'rented', 2021, 15.6, 300],
    ['014', 'JLG 660SJ', 'JLG', 'telescopic', 'diesel', 'available', 2020, 22.3, 230],
    ['015', 'Haulotte HT23 RTJ', 'Haulotte', 'telescopic', 'diesel', 'in_service', 2022, 22.5, 230],
    ['016', 'Genie S-65 XC', 'Genie', 'telescopic', 'diesel', 'reserved', 2023, 21.8, 300],
    ['017', 'Manitou 220 TJ', 'Manitou', 'telescopic', 'diesel', 'available', 2021, 21.7, 230],
    ['018', 'JLG 860SJ', 'JLG', 'telescopic', 'diesel', 'available', 2019, 28.2, 230],
    ['019', 'Dingli BA22ERT', 'Dingli', 'articulated', 'electric', 'available', 2024, 22.2, 230],
    ['020', 'Genie GS-5390 RT', 'Genie', 'scissor', 'diesel', 'rented', 2020, 18.2, 680],
  ];
  const equipment = equipmentSpecs.map(([suffix, model, manufacturer, type, drive, status, year, workingHeight, loadCapacity], index) => ({
    id: `DEMO-EQ-${suffix}`,
    inventoryNumber: `DEMO-EQ-${suffix}`,
    serialNumber: `DEMO-SN-${suffix}`,
    manufacturer,
    model,
    category: 'own',
    type,
    drive,
    status,
    owner: 'own',
    ownerId: 'DEMO-OWNER-001',
    ownerName: 'Demo Fleet',
    activeInFleet: true,
    priority: status === 'in_service' ? 'high' : 'medium',
    year,
    hours: 320 + index * 87,
    workingHeight,
    liftHeight: Math.max(0, Number(workingHeight) - 2),
    loadCapacity,
    plannedMonthlyRevenue: 180000 + index * 15000,
    location: status === 'in_service' ? 'Демо сервисная зона' : 'Демо склад',
    nextMaintenance: dateOnly(addDays(now, 14 + index)),
    notes: 'DEMO DATA: вымышленная единица техники без реального владельца, объекта или телеметрии.',
    fixtureTag: DEMO_PREFIX,
    createdAt: nowIso,
    updatedAt: nowIso,
  }));

  const rentalBase = (suffix, clientSuffix, equipmentSuffix, status, startOffset, endOffset, amount, paidAmount, extra = {}) => {
    const client = clients.find(item => item.id === `DEMO-CLIENT-${clientSuffix}`);
    const eq = equipment.find(item => item.id === `DEMO-EQ-${equipmentSuffix}`);
    return {
      id: `DEMO-RENTAL-${suffix}`,
      rentalId: `DEMO-RENTAL-${suffix}`,
      number: `DEMO-R-${suffix}`,
      clientId: client.id,
      clientName: client.company,
      client: client.company,
      contact: client.contactPerson,
      equipmentId: eq.id,
      equipment: [eq.id],
      equipmentModel: eq.model,
      equipmentName: eq.model,
      equipmentInventoryNumber: eq.inventoryNumber,
      equipmentInv: eq.inventoryNumber,
      managerId: 'DEMO-USER-MANAGER',
      manager: 'Demo Rental Manager',
      startDate: dateOnly(addDays(now, startOffset)),
      endDate: dateOnly(addDays(now, endOffset)),
      plannedReturnDate: dateOnly(addDays(now, endOffset)),
      status,
      paymentStatus: paidAmount >= amount ? 'paid' : paidAmount > 0 ? 'partial' : 'unpaid',
      amount,
      price: amount,
      totalAmount: amount,
      paidAmount,
      debt: Math.max(0, amount - paidAmount),
      rate: `${Math.round(amount / Math.max(1, endOffset - startOffset + 1)).toLocaleString('ru-RU')} ₽ / день`,
      deliveryAddress: `Казань, демо-объект ${suffix}`,
      updSigned: status === 'closed',
      history: [{ id: `DEMO-HISTORY-${suffix}`, createdAt: nowIso, userName: 'Demo Admin', action: 'demo.seed', description: 'Демо-аренда создана seed-скриптом' }],
      fixtureTag: DEMO_PREFIX,
      createdAt: nowIso,
      updatedAt: nowIso,
      ...extra,
    };
  };

  const rentals = [
    rentalBase('001', '001', '007', 'active', -6, 8, 280000, 150000),
    rentalBase('002', '002', '013', 'active', -2, 12, 315000, 315000),
    rentalBase('003', '003', '020', 'active', -1, 18, 360000, 120000),
    rentalBase('004', '004', '004', 'created', 4, 14, 198000, 0),
    rentalBase('005', '005', '010', 'created', 7, 20, 245000, 0),
    rentalBase('006', '001', '002', 'closed', -28, -12, 210000, 210000, { actualReturnDate: dateOnly(addDays(now, -12)) }),
    rentalBase('007', '002', '016', 'closed', -40, -22, 300000, 260000, { actualReturnDate: dateOnly(addDays(now, -22)) }),
  ];

  const gantt_rentals = rentals.map(item => ({
    ...item,
    equipment: item.equipmentId,
    equipmentName: item.equipmentModel,
    equipmentInv: item.equipmentInventoryNumber,
    start: item.startDate,
    end: item.endDate,
    clientShort: item.clientName,
    managerInitials: 'DM',
    comments: item.history,
  }));

  const documents = [
    ['CONTRACT-001', 'contract', 'Договор аренды DEMO-R-001', 'signed', '001', '001', '007'],
    ['UPD-001', 'upd', 'УПД по DEMO-R-001', 'draft', '001', '001', '007'],
    ['ACT-002', 'act', 'Акт выполненных работ DEMO-R-002', 'signed', '002', '002', '013'],
    ['INVOICE-003', 'invoice', 'Счет DEMO-R-003', 'issued', '003', '003', '020'],
  ].map(([suffix, type, title, status, rentalSuffix, clientSuffix, equipmentSuffix]) => {
    const client = clients.find(item => item.id === `DEMO-CLIENT-${clientSuffix}`);
    return {
      id: `DEMO-DOC-${suffix}`,
      type,
      title,
      number: `DEMO-DOC-${suffix}`,
      documentNumber: `DEMO-DOC-${suffix}`,
      status,
      clientId: client.id,
      clientName: client.company,
      rentalId: `DEMO-RENTAL-${rentalSuffix}`,
      equipmentId: `DEMO-EQ-${equipmentSuffix}`,
      equipmentInv: `DEMO-EQ-${equipmentSuffix}`,
      fileName: '',
      fileUrl: '',
      note: 'DEMO DATA: документ без реального файла или реквизитов.',
      date: dateOnly(now),
      fixtureTag: DEMO_PREFIX,
      createdAt: nowIso,
    };
  });

  const payments = rentals.slice(0, 5).map((rental, index) => ({
    id: `DEMO-PAYMENT-${String(index + 1).padStart(3, '0')}`,
    invoice: `DEMO-PAY-${String(index + 1).padStart(3, '0')}`,
    clientId: rental.clientId,
    clientName: rental.clientName,
    rentalId: rental.id,
    amount: rental.amount,
    paidAmount: rental.paidAmount,
    dueDate: dateOnly(addDays(now, index - 2)),
    paidDate: rental.paidAmount >= rental.amount ? dateOnly(addDays(now, -1)) : '',
    status: rental.paymentStatus === 'paid' ? 'paid' : rental.paymentStatus === 'partial' ? 'partial' : 'pending',
    comment: 'DEMO DATA: тестовый платеж, реальные деньги не участвуют.',
    fixtureTag: DEMO_PREFIX,
    createdAt: nowIso,
  }));

  const service = [
    ['001', '003', 'in_progress', 'Диагностика гидростанции', -5, 'Падение скорости подъема платформы.'],
    ['002', '009', 'waiting_parts', 'Ожидание датчика наклона', -4, 'Повторная ошибка датчика после прошлого ремонта.'],
    ['003', '015', 'in_progress', 'Проверка стрелы после возврата', -2, 'Контроль люфтов и гидролиний.'],
    ['004', '009', 'closed', 'Повторная диагностика датчика', -18, 'Закрыто после калибровки, повтор проявился через 14 дней.'],
    ['005', '009', 'closed', 'Первичная замена разъема датчика', -32, 'Закрыто, заявка участвует в контроле качества ремонта.'],
    ['006', '001', 'closed', 'Плановое ТО перед демо-показом', -10, 'Закрыто без замечаний.'],
  ].map(([suffix, equipmentSuffix, status, title, createdOffset, description]) => {
    const eq = equipment.find(item => item.id === `DEMO-EQ-${equipmentSuffix}`);
    return {
      id: `DEMO-SERVICE-${suffix}`,
      number: `DEMO-SERVICE-${suffix}`,
      title,
      equipmentId: eq.id,
      equipment: eq.model,
      equipmentModel: eq.model,
      inventoryNumber: eq.inventoryNumber,
      equipmentInventoryNumber: eq.inventoryNumber,
      assignedMechanicId: 'DEMO-USER-SERVICE',
      assignedMechanicName: 'Demo Service Mechanic',
      status,
      serviceKind: 'repair',
      priority: status === 'waiting_parts' ? 'high' : 'medium',
      reason: title,
      problemDescription: `DEMO DATA: ${description}`,
      description: `DEMO DATA: ${description}`,
      createdAt: iso(addDays(now, Number(createdOffset))),
      closedAt: status === 'closed' ? iso(addDays(now, Number(createdOffset) + 2)) : '',
      completedAt: status === 'closed' ? iso(addDays(now, Number(createdOffset) + 2)) : '',
      resultData: status === 'closed' ? { completedAt: iso(addDays(now, Number(createdOffset) + 2)), qualityNote: 'DEMO DATA: закрытый ремонт для витрины качества.' } : {},
      fixtureTag: DEMO_PREFIX,
      updatedAt: nowIso,
    };
  });

  const deliveries = [
    ['001', '001', 'new', 'shipping', 1],
    ['002', '002', 'in_transit', 'shipping', 0],
    ['003', '006', 'completed', 'receiving', -12],
  ].map(([suffix, rentalSuffix, status, type, offset]) => {
    const rental = rentals.find(item => item.id === `DEMO-RENTAL-${rentalSuffix}`);
    return {
      id: `DEMO-DELIVERY-${suffix}`,
      number: `DEMO-DELIVERY-${suffix}`,
      clientId: rental.clientId,
      clientName: rental.clientName,
      rentalId: rental.id,
      equipmentId: rental.equipmentId,
      equipmentModel: rental.equipmentModel,
      pickupAddress: 'Казань, демо-склад',
      deliveryAddress: rental.deliveryAddress,
      carrierId: 'DEMO-CARRIER-001',
      carrier: 'Demo Carrier',
      status,
      scheduledDate: dateOnly(addDays(now, Number(offset))),
      transportDate: dateOnly(addDays(now, Number(offset))),
      type,
      comment: 'DEMO DATA: перевозка без реального адреса и клиента.',
      fixtureTag: DEMO_PREFIX,
      createdAt: nowIso,
    };
  });

  const debt_collection_plans = [
    {
      id: 'DEMO-DEBT-PLAN-001',
      clientId: 'DEMO-CLIENT-001',
      clientName: 'Демо Строй Парк',
      responsible: 'Demo Rental Manager',
      status: 'active',
      nextAction: 'Согласовать оплату демо-долга',
      nextActionDate: dateOnly(addDays(now, 1)),
      comment: 'DEMO DATA: тестовая дебиторка без реальных обязательств.',
      fixtureTag: DEMO_PREFIX,
      createdAt: nowIso,
    },
  ];

  const repair_work_items = service.map((ticket, index) => ({
    id: `DEMO-REPAIR-WORK-${String(index + 1).padStart(3, '0')}`,
    repairId: ticket.id,
    serviceTicketId: ticket.id,
    workId: 'DEMO-WORK-001',
    nameSnapshot: index % 2 === 0 ? 'DEMO диагностика гидросистемы' : 'DEMO проверка электрической цепи',
    categorySnapshot: 'DEMO service',
    quantity: 1,
    normHoursSnapshot: 1.5,
    ratePerHourSnapshot: 2500,
    fixtureTag: DEMO_PREFIX,
    updatedAt: nowIso,
  }));

  const repair_part_items = service.filter((_, index) => index < 3).map((ticket, index) => ({
    id: `DEMO-REPAIR-PART-${String(index + 1).padStart(3, '0')}`,
    repairId: ticket.id,
    serviceTicketId: ticket.id,
    partId: `DEMO-PART-${String(index + 1).padStart(3, '0')}`,
    nameSnapshot: ['DEMO датчик наклона', 'DEMO гидравлический фильтр', 'DEMO комплект уплотнений'][index],
    articleSnapshot: `DEMO-PART-${String(index + 1).padStart(3, '0')}`,
    quantity: 1,
    priceSnapshot: [8200, 3100, 5400][index],
    fixtureTag: DEMO_PREFIX,
    updatedAt: nowIso,
  }));

  const audit_logs = [{
    id: 'DEMO-AUDIT-001',
    createdAt: nowIso,
    userId: 'DEMO-USER-ADMIN',
    userName: 'Demo Admin',
    action: 'demo.seed',
    entityType: 'system',
    entityId: 'DEMO',
    description: 'DEMO DATA: демонстрационные записи обновлены seed-скриптом.',
    metadata: { demo: true, prefix: DEMO_PREFIX },
  }];

  return {
    users,
    clients,
    equipment,
    rentals,
    gantt_rentals,
    documents,
    payments,
    service,
    deliveries,
    debt_collection_plans,
    repair_work_items,
    repair_part_items,
    audit_logs,
    audit_log: audit_logs,
    app_settings: [
      { id: 'DEMO-SETTING-001', key: 'demoMode', value: { enabled: true, label: 'DEMO' }, fixtureTag: DEMO_PREFIX, updatedAt: nowIso },
    ],
    delivery_carriers: [
      { id: 'DEMO-CARRIER-001', name: 'Demo Carrier', phone: '+7 900 200-00-00', status: 'active', fixtureTag: DEMO_PREFIX },
    ],
    owners: [
      { id: 'DEMO-OWNER-001', name: 'Demo Fleet', type: 'company', status: 'active', fixtureTag: DEMO_PREFIX },
    ],
    mechanics: [
      { id: 'DEMO-MECHANIC-001', userId: 'DEMO-USER-SERVICE', name: 'Demo Service Mechanic', role: 'Механик', status: 'active', fixtureTag: DEMO_PREFIX },
    ],
    service_works: [
      { id: 'DEMO-WORK-001', name: 'DEMO диагностика', normHours: 1.5, ratePerHour: 2500, isActive: true, fixtureTag: DEMO_PREFIX },
    ],
    spare_parts: [
      { id: 'DEMO-PART-001', name: 'DEMO датчик наклона', article: 'DEMO-PART-001', unit: 'шт', defaultPrice: 8200, isActive: true, fixtureTag: DEMO_PREFIX },
      { id: 'DEMO-PART-002', name: 'DEMO гидравлический фильтр', article: 'DEMO-PART-002', unit: 'шт', defaultPrice: 3100, isActive: true, fixtureTag: DEMO_PREFIX },
      { id: 'DEMO-PART-003', name: 'DEMO комплект уплотнений', article: 'DEMO-PART-003', unit: 'шт', defaultPrice: 5400, isActive: true, fixtureTag: DEMO_PREFIX },
    ],
  };
}

function seedDemoData({ logger = console, env = process.env, now = new Date('2026-05-23T09:00:00.000Z') } = {}) {
  const { DB_PATH } = require('../db');
  assertDemoSeedAllowed({ env, dbPath: DB_PATH });

  const data = buildDemoData({ now, env });
  const results = Object.entries(data).map(([collection, fixtures]) => replaceDemoRecords(collection, fixtures));

  logger.log(`[demo] Seeded demo records: collections=${results.length}`);
  logger.log(`[demo] Demo users: ${DEMO_USER_EMAILS.join(', ')}`);
  return {
    ok: true,
    prefix: DEMO_PREFIX,
    users: DEMO_USER_EMAILS,
    results,
  };
}

if (require.main === module) {
  process.env.DB_PATH ||= path.join(__dirname, '..', 'data', 'demo.sqlite');
  process.env.DEMO_ENV ||= 'true';
  process.env.DEMO_MODE ||= 'true';
  try {
    const result = seedDemoData({ logger: console });
    if (process.argv.includes('--json')) {
      console.log(JSON.stringify(result, null, 2));
    }
  } catch (error) {
    console.error(`[demo] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEMO_PREFIX,
  DEMO_USER_EMAILS,
  assertDemoSeedAllowed,
  buildDemoData,
  seedDemoData,
};
