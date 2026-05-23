import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const {
  normalizeEquipmentFinance,
  calculateEquipmentDepreciation,
} = require('../server/lib/equipment-depreciation.js');
const { createAccessControl } = require('../server/lib/access-control.js');
const { normalizeRole } = require('../server/lib/role-groups.js');
const { registerFinanceRoutes } = require('../server/routes/finance.js');

test('monthly straight-line depreciation is calculated', () => {
  const result = calculateEquipmentDepreciation({
    purchasePrice: 1200000,
    salvageValue: 120000,
    usefulLifeMonths: 36,
    depreciationMethod: 'straight_line',
    depreciationStartDate: '2026-01-01',
  }, '2026-01-31');

  assert.equal(result.status, 'configured');
  assert.equal(result.monthlyDepreciation, 30000);
});

test('residual value is capped at salvage value', () => {
  const result = calculateEquipmentDepreciation({
    purchasePrice: 1200000,
    salvageValue: 120000,
    usefulLifeMonths: 36,
    depreciationStartDate: '2020-01-01',
  }, '2026-05-23');

  assert.equal(result.accumulatedDepreciation, 1080000);
  assert.equal(result.residualValue, 120000);
});

test('usefulLifeMonths and salvage value validation rejects unsafe data', () => {
  assert.throws(() => normalizeEquipmentFinance({
    equipmentId: 'EQ-1',
    purchasePrice: 100000,
    usefulLifeMonths: 0,
  }), /Срок полезного использования/);

  assert.throws(() => normalizeEquipmentFinance({
    equipmentId: 'EQ-1',
    purchasePrice: 100000,
    usefulLifeMonths: 12,
    salvageValue: 120000,
  }), /Ликвидационная стоимость/);
});

test('missing data returns not_configured', () => {
  const result = calculateEquipmentDepreciation({}, '2026-05-23');

  assert.equal(result.status, 'not_configured');
  assert.equal(result.monthlyDepreciation, 0);
});

const READ_PERMISSIONS = {
  equipment: ['Администратор', 'Офис-менеджер', 'Менеджер по аренде', 'Механик', 'Инвестор'],
  equipment_finance: ['Администратор', 'Офис-менеджер'],
  finance_operations: ['Администратор', 'Офис-менеджер'],
};

const WRITE_PERMISSIONS = {
  equipment_finance: ['Администратор', 'Офис-менеджер'],
  app_settings: ['Администратор'],
};

function createFinanceRouteApp() {
  const state = {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор' },
      { id: 'U-manager', name: 'Менеджер', role: 'Менеджер по аренде' },
      { id: 'U-mechanic', name: 'Механик', role: 'Механик' },
      { id: 'U-investor', name: 'Инвестор', role: 'Инвестор', ownerId: 'OW-1' },
    ],
    equipment: [
      { id: 'EQ-1', inventoryNumber: '100', ownerId: 'OW-1', manufacturer: 'JLG', model: 'E450' },
      { id: 'EQ-2', inventoryNumber: '200', ownerId: 'OW-2', manufacturer: 'Genie', model: 'S65' },
    ],
    equipment_finance: [
      { id: 'EF-1', equipmentId: 'EQ-1', purchasePrice: 1200000, salvageValue: 120000, usefulLifeMonths: 36, depreciationStartDate: '2026-01-01' },
      { id: 'EF-2', equipmentId: 'EQ-2', purchasePrice: 2200000, salvageValue: 200000, usefulLifeMonths: 40, depreciationStartDate: '2026-01-01' },
    ],
    rentals: [],
    gantt_rentals: [],
    payments: [],
    payment_allocations: [],
    app_settings: [],
  };
  const sessions = new Map([
    ['admin-token', 'U-admin'],
    ['manager-token', 'U-manager'],
    ['mechanic-token', 'U-mechanic'],
    ['investor-token', 'U-investor'],
  ]);
  const readData = name => state[name] || [];
  const writeData = (name, value) => { state[name] = value; };
  const accessControl = createAccessControl({ readData });

  function requireAuth(req, res, next) {
    const auth = req.headers.authorization || '';
    if (!auth.startsWith('Bearer ')) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    const user = state.users.find(item => item.id === sessions.get(auth.slice(7)));
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = {
      userId: user.id,
      userName: user.name,
      userRole: normalizeRole(user.role),
      ownerId: user.ownerId || null,
    };
    return next();
  }

  function requireRead(collection) {
    return (req, res, next) => {
      const allowed = READ_PERMISSIONS[collection] || ['Администратор'];
      return allowed.includes(normalizeRole(req.user?.userRole)) ? next() : res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  function requireWrite(collection) {
    return (req, res, next) => {
      const allowed = WRITE_PERMISSIONS[collection] || ['Администратор'];
      return allowed.includes(normalizeRole(req.user?.userRole)) ? next() : res.status(403).json({ ok: false, error: 'Forbidden' });
    };
  }

  const app = express();
  app.use(express.json());
  const router = express.Router();
  registerFinanceRoutes(router, {
    requireAuth,
    requireRead,
    requireWrite,
    readData,
    writeData,
    accessControl,
    generateId: prefix => `${prefix}-new`,
    idPrefixes: { equipment_finance: 'EF', app_settings: 'APS' },
    nowIso: () => '2026-05-23T10:00:00.000Z',
    auditLog: () => {},
  });
  app.use('/api', router);
  return { app, state };
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  try {
    const address = server.address();
    await fn(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

async function request(baseUrl, method, path, token, body) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  return {
    status: response.status,
    body: text ? JSON.parse(text) : null,
  };
}

test('equipment economics read is restricted to finance roles', async () => {
  const { app } = createFinanceRouteApp();

  await withServer(app, async baseUrl => {
    assert.equal((await request(baseUrl, 'GET', '/api/equipment/EQ-1/economics', null)).status, 401);

    const admin = await request(baseUrl, 'GET', '/api/equipment/EQ-1/economics', 'admin-token');
    assert.equal(admin.status, 200);
    assert.equal(admin.body.finance.purchasePrice, 1200000);
    assert.equal(admin.body.depreciation.monthlyDepreciation, 30000);
    assert.equal(admin.body.depreciation.residualValue, 1050000);

    for (const token of ['manager-token', 'mechanic-token', 'investor-token']) {
      const response = await request(baseUrl, 'GET', '/api/equipment/EQ-1/economics', token);
      assert.equal(response.status, 403);
      assert.doesNotMatch(JSON.stringify(response.body), /purchasePrice|monthlyDepreciation|residualValue|accumulatedDepreciation/i);
    }
  });
});

test('equipment economics patch remains restricted', async () => {
  const { app } = createFinanceRouteApp();

  await withServer(app, async baseUrl => {
    const manager = await request(baseUrl, 'PATCH', '/api/equipment/EQ-1/economics', 'manager-token', { purchasePrice: 1, usefulLifeMonths: 1 });
    assert.equal(manager.status, 403);

    const admin = await request(baseUrl, 'PATCH', '/api/equipment/EQ-1/economics', 'admin-token', { purchasePrice: 100000, salvageValue: 0, usefulLifeMonths: 10 });
    assert.equal(admin.status, 200);
    assert.equal(admin.body.finance.purchasePrice, 100000);
  });
});
