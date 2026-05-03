#!/usr/bin/env node

const crypto = require('crypto');
const path = require('path');

const STRONG_HASH_PREFIX = 'h2:scrypt:';
const SCRYPT_KEY_LENGTH = 64;
const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };
const DEMO_PASSWORD = process.env.DEMO_DEFAULT_PASSWORD || 'demo1234';

function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = crypto.scryptSync(String(plain), salt, SCRYPT_KEY_LENGTH, SCRYPT_OPTIONS).toString('base64url');
  return `${STRONG_HASH_PREFIX}${salt}:${hash}`;
}

function iso(date) {
  return new Date(date).toISOString();
}

function buildDemoData(now = new Date('2026-05-03T09:00:00.000Z')) {
  const nowIso = now.toISOString();
  const password = hashPassword(DEMO_PASSWORD);
  const users = [
    { id: 'demo-admin', name: 'Demo Admin', email: 'demo-admin@skytech.local', role: 'Администратор', status: 'Активен', password },
    { id: 'demo-office', name: 'Demo Office', email: 'demo-office@skytech.local', role: 'Офис-менеджер', status: 'Активен', password },
    { id: 'demo-rental-manager', name: 'Demo Rental Manager', email: 'demo-rental@skytech.local', role: 'Менеджер по аренде', status: 'Активен', password },
    { id: 'demo-service', name: 'Demo Mechanic', email: 'demo-service@skytech.local', role: 'Механик', status: 'Активен', password },
  ];

  const clients = [
    {
      id: 'demo-client-alpha',
      name: 'Демо Строй',
      company: 'Демо Строй',
      inn: '7700000001',
      contactPerson: 'Анна Демонстрационная',
      phone: '+7 900 000-00-01',
      email: 'client-alpha@example.test',
      manager: 'Demo Rental Manager',
      status: 'Активен',
      paymentTerms: 'По договору',
      riskLevel: 'Средний',
      createdAt: nowIso,
    },
    {
      id: 'demo-client-beta',
      name: 'Демо Логистика',
      company: 'Демо Логистика',
      inn: '7700000002',
      contactPerson: 'Илья Логистов',
      phone: '+7 900 000-00-02',
      email: 'client-beta@example.test',
      manager: 'Demo Office',
      status: 'Активен',
      paymentTerms: 'Предоплата',
      riskLevel: 'Низкий',
      createdAt: nowIso,
    },
  ];

  const equipment = [
    {
      id: 'demo-eq-boom-01',
      model: 'Haulotte HA16 RTJ',
      manufacturer: 'Haulotte',
      category: 'Коленчатый',
      type: 'Коленчатый',
      serialNumber: 'DEMO-SN-1001',
      inventoryNumber: 'DEMO-INV-001',
      status: 'В аренде',
      owner: 'Demo Fleet',
      ownerType: 'company',
      location: 'Казань, демо-площадка',
      createdAt: nowIso,
    },
    {
      id: 'demo-eq-scissor-01',
      model: 'Genie GS-3246',
      manufacturer: 'Genie',
      category: 'Ножничный',
      type: 'Ножничный',
      serialNumber: 'DEMO-SN-2001',
      inventoryNumber: 'DEMO-INV-002',
      status: 'Свободна',
      owner: 'Demo Fleet',
      ownerType: 'company',
      location: 'Склад демо',
      createdAt: nowIso,
    },
    {
      id: 'demo-eq-service-01',
      model: 'JLG 1930ES',
      manufacturer: 'JLG',
      category: 'Ножничный',
      type: 'Ножничный',
      serialNumber: 'DEMO-SN-3001',
      inventoryNumber: 'DEMO-INV-003',
      status: 'В сервисе',
      owner: 'Demo Fleet',
      ownerType: 'company',
      location: 'Сервисная зона',
      createdAt: nowIso,
    },
  ];

  const rentals = [
    {
      id: 'demo-rental-001',
      number: 'DEMO-001',
      clientId: 'demo-client-alpha',
      clientName: 'Демо Строй',
      client: 'Демо Строй',
      equipmentId: 'demo-eq-boom-01',
      equipmentModel: 'Haulotte HA16 RTJ',
      equipmentInventoryNumber: 'DEMO-INV-001',
      manager: 'Demo Rental Manager',
      startDate: '2026-05-01',
      endDate: '2026-05-14',
      status: 'active',
      paymentStatus: 'partial',
      totalAmount: 210000,
      paidAmount: 80000,
      history: [
        { id: 'demo-rental-history-001', createdAt: nowIso, userName: 'Demo Admin', action: 'created', description: 'Демо-аренда создана seed-скриптом' },
      ],
      createdAt: nowIso,
    },
    {
      id: 'demo-rental-002',
      number: 'DEMO-002',
      clientId: 'demo-client-beta',
      clientName: 'Демо Логистика',
      client: 'Демо Логистика',
      equipmentId: 'demo-eq-scissor-01',
      equipmentModel: 'Genie GS-3246',
      equipmentInventoryNumber: 'DEMO-INV-002',
      manager: 'Demo Office',
      startDate: '2026-05-06',
      endDate: '2026-05-12',
      status: 'planned',
      paymentStatus: 'unpaid',
      totalAmount: 96000,
      paidAmount: 0,
      history: [],
      createdAt: nowIso,
    },
  ];

  const ganttRentals = rentals.map(item => ({
    ...item,
    rentalId: item.id,
    equipment: item.equipmentId,
    equipmentName: item.equipmentModel,
    equipmentInv: item.equipmentInventoryNumber,
    start: item.startDate,
    end: item.endDate,
  }));

  const documents = [
    {
      id: 'demo-doc-contract-001',
      type: 'contract',
      title: 'Договор аренды DEMO-001',
      number: 'ДЕМО-ДА-001',
      status: 'signed',
      clientId: 'demo-client-alpha',
      clientName: 'Демо Строй',
      rentalId: 'demo-rental-001',
      equipmentId: 'demo-eq-boom-01',
      equipmentInv: 'DEMO-INV-001',
      date: '2026-05-01',
      signer: 'Анна Демонстрационная',
      createdAt: nowIso,
    },
    {
      id: 'demo-doc-upd-001',
      type: 'upd',
      title: 'УПД по аренде DEMO-001',
      number: 'ДЕМО-УПД-001',
      status: 'draft',
      clientId: 'demo-client-alpha',
      clientName: 'Демо Строй',
      rentalId: 'demo-rental-001',
      equipmentId: 'demo-eq-boom-01',
      equipmentInv: 'DEMO-INV-001',
      date: '2026-05-03',
      createdAt: nowIso,
    },
  ];

  const payments = [
    {
      id: 'demo-payment-001',
      invoice: 'DEMO-INV-PAY-001',
      clientId: 'demo-client-alpha',
      clientName: 'Демо Строй',
      rentalId: 'demo-rental-001',
      amount: 210000,
      paidAmount: 80000,
      dueDate: '2026-05-10',
      paidDate: '',
      status: 'partial',
      comment: 'Демо-счёт, реальные деньги не участвуют',
      createdAt: nowIso,
    },
    {
      id: 'demo-payment-002',
      invoice: 'DEMO-INV-PAY-002',
      clientId: 'demo-client-beta',
      clientName: 'Демо Логистика',
      rentalId: 'demo-rental-002',
      amount: 96000,
      paidAmount: 0,
      dueDate: '2026-05-06',
      status: 'pending',
      comment: 'Демо-платёж',
      createdAt: nowIso,
    },
  ];

  const service = [
    {
      id: 'demo-service-001',
      title: 'Диагностика подъёмника',
      equipmentId: 'demo-eq-service-01',
      equipmentModel: 'JLG 1930ES',
      equipmentInventoryNumber: 'DEMO-INV-003',
      clientId: 'demo-client-alpha',
      clientName: 'Демо Строй',
      rentalId: 'demo-rental-001',
      assignedMechanicId: 'demo-service',
      assignedMechanicName: 'Demo Mechanic',
      status: 'in_progress',
      priority: 'high',
      problemDescription: 'Демо-заявка: проверить заряд и гидравлику.',
      description: 'Демо-заявка: проверить заряд и гидравлику.',
      createdAt: iso('2026-05-02T08:00:00.000Z'),
    },
  ];

  const deliveries = [
    {
      id: 'demo-delivery-001',
      clientId: 'demo-client-alpha',
      clientName: 'Демо Строй',
      rentalId: 'demo-rental-001',
      equipmentId: 'demo-eq-boom-01',
      equipmentModel: 'Haulotte HA16 RTJ',
      pickupAddress: 'Казань, демо-площадка',
      deliveryAddress: 'Казань, тестовый объект',
      carrier: 'Demo Carrier',
      status: 'scheduled',
      scheduledDate: '2026-05-04',
      createdAt: nowIso,
    },
  ];

  const debtCollectionPlans = [
    {
      id: 'demo-debt-plan-001',
      clientId: 'demo-client-alpha',
      clientName: 'Демо Строй',
      responsible: 'Demo Office',
      status: 'active',
      nextAction: 'Позвонить клиенту и согласовать оплату',
      nextActionDate: '2026-05-05',
      comment: 'Демо-план взыскания, без реальных обязательств.',
      createdAt: nowIso,
    },
  ];

  const auditLogs = [
    {
      id: 'demo-audit-001',
      createdAt: nowIso,
      userId: 'demo-admin',
      userName: 'Demo Admin',
      action: 'demo.seed',
      entityType: 'system',
      entityId: 'demo',
      description: 'Демо-данные созданы seed-скриптом',
      metadata: { demo: true },
    },
  ];

  return {
    users,
    clients,
    equipment,
    rentals,
    gantt_rentals: ganttRentals,
    documents,
    payments,
    service,
    deliveries,
    debt_collection_plans: debtCollectionPlans,
    audit_logs: auditLogs,
    audit_log: auditLogs,
    bot_users: {},
    bot_sessions: {},
    bot_activity: [],
    bot_notifications: [],
    snapshot: {},
    app_settings: [
      { id: 'demo-setting-theme', key: 'theme', value: 'dark', updatedAt: nowIso },
    ],
    delivery_carriers: [
      { id: 'demo-carrier-001', name: 'Demo Carrier', phone: '+7 900 000-00-03', status: 'active' },
    ],
    owners: [
      { id: 'demo-owner-001', name: 'Demo Fleet', type: 'company', status: 'active' },
    ],
    mechanics: [
      { id: 'demo-mechanic-001', name: 'Demo Mechanic', role: 'Механик', status: 'active' },
    ],
    service_works: [
      { id: 'demo-work-001', name: 'Диагностика', normHours: 1, ratePerHour: 2500, isActive: true },
    ],
    spare_parts: [
      { id: 'demo-part-001', name: 'Демо-фильтр', article: 'DEMO-PART-001', unit: 'шт', defaultPrice: 1200, isActive: true },
    ],
  };
}

function seedDemoData({ reset = true, logger = console } = {}) {
  const { JSON_COLLECTIONS, resetAppData, setData, DB_PATH } = require('../db');
  const { assertDemoResetAllowed } = require('../lib/demo-mode');

  assertDemoResetAllowed({ dbPath: DB_PATH });
  if (reset) resetAppData(JSON_COLLECTIONS);

  const data = buildDemoData();
  for (const collection of JSON_COLLECTIONS) {
    if (Object.prototype.hasOwnProperty.call(data, collection)) {
      setData(collection, data[collection]);
    } else {
      setData(collection, []);
    }
  }

  logger.log(`[demo] Seeded demo database: ${DB_PATH}`);
  logger.log(`[demo] Demo users: demo-admin@skytech.local, demo-office@skytech.local, demo-rental@skytech.local, demo-service@skytech.local`);
  return data;
}

if (require.main === module) {
  process.env.DB_PATH ||= path.join(__dirname, '..', 'data', 'demo.sqlite');
  process.env.DEMO_MODE ||= 'true';
  try {
    seedDemoData({ reset: process.argv.includes('--reset') || !process.argv.includes('--no-reset') });
  } catch (error) {
    console.error(`[demo] ${error.message}`);
    process.exitCode = 1;
  }
}

module.exports = {
  DEMO_PASSWORD,
  buildDemoData,
  seedDemoData,
};
