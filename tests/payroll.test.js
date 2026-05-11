import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createAccessControl } = require('../server/lib/access-control.js');
const { registerPayrollRoutes } = require('../server/routes/payroll.js');

function createApp() {
  const counters = {};
  let nowCounter = 0;
  const state = {
    users: [
      { id: 'U-admin', name: 'Админ', role: 'Администратор', status: 'Активен' },
      { id: 'U-manager', name: 'Руслан', role: 'Менеджер по аренде', status: 'Активен' },
      { id: 'U-sales', name: 'Мария', role: 'Менеджер по продажам', status: 'Активен' },
    ],
    payroll_profiles: [],
    payroll_periods: [],
    payroll_records: [],
    payroll_adjustments: [],
    payroll_audit_events: [],
    app_settings: [],
    service: [],
  };
  const users = {
    admin: { userId: 'U-admin', userName: 'Админ', userRole: 'Администратор' },
    manager: { userId: 'U-manager', userName: 'Руслан', userRole: 'Менеджер по аренде' },
    sales: { userId: 'U-sales', userName: 'Мария', userRole: 'Менеджер по продажам' },
  };

  const app = express();
  const router = express.Router();
  app.use(express.json());

  const readData = name => state[name] || [];
  const writeData = (name, value) => {
    state[name] = value;
  };
  const requireAuth = (req, res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = users[token];
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = user;
    return next();
  };
  const generateId = prefix => {
    counters[prefix] = (counters[prefix] || 0) + 1;
    return `${prefix}-${String(counters[prefix]).padStart(4, '0')}`;
  };
  const nowIso = () => {
    nowCounter += 1;
    return `2026-05-10T10:00:${String(nowCounter).padStart(2, '0')}.000Z`;
  };

  registerPayrollRoutes(router, {
    readData,
    writeData,
    requireAuth,
    generateId,
    idPrefixes: {
      payroll_profiles: 'PP',
      payroll_periods: 'PPRD',
      payroll_records: 'PR',
      payroll_adjustments: 'PADJ',
      payroll_audit_events: 'PAE',
      app_settings: 'SET',
    },
    nowIso,
    auditLog: null,
  });

  app.use('/api', router);
  return { app, state, readData, users };
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

async function request(baseUrl, method, path, token = 'admin', body) {
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

async function createProfile(baseUrl, overrides = {}) {
  const payload = {
    userId: 'U-manager',
    employeeName: 'Руслан',
    role: 'Менеджер по аренде',
    baseSalary: 100000,
    kpiSchemeType: 'manual',
    kpiPercent: 10,
    kpiFixedAmount: 5000,
    kpiDescription: 'План выполнен',
    isActive: true,
    ...overrides,
  };
  const created = await request(baseUrl, 'POST', '/api/payroll/profiles', 'admin', payload);
  assert.equal(created.response.status, 201);
  return created.json;
}

async function calculateMonth(baseUrl, month = '2026-05') {
  const calculated = await request(baseUrl, 'POST', '/api/payroll/periods/calculate', 'admin', { month });
  assert.equal(calculated.response.status, 201);
  return calculated.json;
}

test('payroll routes are admin-only and access-control hides payroll collections from non-admins', async () => {
  const { app, readData, users } = createApp();
  const accessControl = createAccessControl({ readData });

  assert.doesNotThrow(() => accessControl.assertCanReadCollection('payroll_profiles', users.admin));
  assert.throws(() => accessControl.assertCanReadCollection('payroll_profiles', users.manager));
  assert.equal(accessControl.filterCollectionByScope('payroll_records', [{ id: 'PR-1' }], users.manager).length, 0);

  await withServer(app, async (baseUrl) => {
    const deniedRead = await request(baseUrl, 'GET', '/api/payroll/profiles', 'manager');
    assert.equal(deniedRead.response.status, 403);

    const deniedWrite = await request(baseUrl, 'POST', '/api/payroll/profiles', 'sales', {
      userId: 'U-sales',
      employeeName: 'Мария',
      role: 'Менеджер по продажам',
      baseSalary: 90000,
      kpiSchemeType: 'none',
    });
    assert.equal(deniedWrite.response.status, 403);
  });
});

test('admin can create and update payroll profile, but cannot create duplicate active profile', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const empty = await request(baseUrl, 'GET', '/api/payroll/profiles');
    assert.equal(empty.response.status, 200);
    assert.deepEqual(empty.json, []);

    const profile = await createProfile(baseUrl);
    assert.equal(profile.baseSalary, 100000);
    assert.equal(profile.currency, 'RUB');

    const duplicate = await request(baseUrl, 'POST', '/api/payroll/profiles', 'admin', {
      userId: 'U-manager',
      employeeName: 'Руслан 2',
      role: 'Менеджер по аренде',
      baseSalary: 120000,
      kpiSchemeType: 'none',
      isActive: true,
    });
    assert.equal(duplicate.response.status, 409);

    const updated = await request(baseUrl, 'PATCH', `/api/payroll/profiles/${profile.id}`, 'admin', {
      baseSalary: 120499.4,
      kpiPercent: 15,
      kpiFixedAmount: 0,
      notes: 'Повышение оклада',
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.json.baseSalary, 120499);
    assert.equal(updated.json.kpiPercent, 15);
    assert.equal(updated.json.notes, 'Повышение оклада');
  });
});

test('calculate month creates payroll period and snapshot records from active profiles', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    await createProfile(baseUrl);
    const calculated = await calculateMonth(baseUrl);

    assert.equal(calculated.period.month, '2026-05');
    assert.equal(calculated.period.status, 'calculated');
    assert.equal(calculated.records.length, 1);

    const record = calculated.records[0];
    assert.equal(record.baseSalary, 100000);
    assert.equal(record.kpiSchemeType, 'manual');
    assert.equal(record.kpiBaseAmount, 100000);
    assert.equal(record.kpiAmount, 15000);
    assert.equal(record.grossAmount, 115000);
    assert.equal(record.netAmount, 115000);
    assert.equal(record.calculationDetails.some(item => item.type === 'base'), true);
    assert.equal(record.calculationDetails.some(item => item.type === 'kpi'), true);
  });
});

test('payroll KPI settings save and role formulas use safe bases', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    const saved = await request(baseUrl, 'PATCH', '/api/payroll/kpi-settings', 'admin', {
      rentalManager: {
        percentFromProfitWithoutVat: 12,
        paidOnly: true,
        closedRentalsOnly: true,
        minimumPlan: 500000,
        manualBaseAmount: 200000,
        comment: 'Прибыль без НДС вводится вручную',
      },
      salesManager: {
        percentFromMargin: 8,
        fixedBonusPerSoldEquipment: 1000,
        paidSalesOnly: true,
        manualMarginAmount: 300000,
        soldEquipmentCount: 2,
        comment: 'Маржа продаж вводится вручную',
      },
      serviceMechanic: {
        bonusPerClosedTicket: 2500,
        bonusPerFieldTrip: 1000,
        manualBonus: 500,
        manualClosedTickets: 1,
        manualFieldTrips: 2,
        comment: 'Сервисная схема',
      },
    });
    assert.equal(saved.response.status, 200);
    assert.equal(saved.json.rentalManager.percentFromProfitWithoutVat, 12);
    assert.equal(state.app_settings[0].key, 'payroll_kpi_settings');

    await createProfile(baseUrl, {
      userId: 'U-manager',
      employeeName: 'Руслан',
      role: 'Менеджер по аренде',
      kpiSchemeType: 'rental_manager',
      kpiPercent: 0,
      kpiFixedAmount: 0,
    });
    await createProfile(baseUrl, {
      userId: 'U-sales',
      employeeName: 'Мария',
      role: 'Менеджер по продажам',
      kpiSchemeType: 'sales_manager',
      kpiPercent: 0,
      kpiFixedAmount: 0,
    });

    const calculated = await calculateMonth(baseUrl);
    const rentalRecord = calculated.records.find(item => item.userId === 'U-manager');
    const salesRecord = calculated.records.find(item => item.userId === 'U-sales');
    assert.equal(rentalRecord.kpiBaseAmount, 200000);
    assert.equal(rentalRecord.kpiAmount, 24000);
    assert.equal(salesRecord.kpiBaseAmount, 300000);
    assert.equal(salesRecord.kpiAmount, 26000);
  });
});

test('service mechanic KPI uses closed service tickets when available and falls back safely without base', async () => {
  const { app, state } = createApp();
  state.users.push({ id: 'U-mechanic', name: 'Пётр', role: 'Механик', status: 'Активен' });
  state.service.push(
    { id: 'S-1', assignedUserId: 'U-mechanic', status: 'closed', closedAt: '2026-05-12T10:00:00.000Z' },
    { id: 'S-2', assignedUserId: 'U-mechanic', status: 'completed', completedAt: '2026-05-13T10:00:00.000Z' },
    { id: 'S-3', assignedUserId: 'U-mechanic', status: 'open', updatedAt: '2026-05-14T10:00:00.000Z' },
  );
  await withServer(app, async (baseUrl) => {
    await request(baseUrl, 'PATCH', '/api/payroll/kpi-settings', 'admin', {
      serviceMechanic: {
        bonusPerClosedTicket: 2000,
        bonusPerFieldTrip: 0,
        manualBonus: 0,
        manualClosedTickets: 0,
        manualFieldTrips: 0,
      },
    });
    await createProfile(baseUrl, {
      userId: 'U-mechanic',
      employeeName: 'Пётр',
      role: 'Механик',
      kpiSchemeType: 'service_mechanic',
      kpiPercent: 0,
      kpiFixedAmount: 0,
    });
    const calculated = await calculateMonth(baseUrl);
    assert.equal(calculated.records[0].kpiBaseAmount, 2);
    assert.equal(calculated.records[0].kpiAmount, 4000);

    const emptyApp = createApp();
    await withServer(emptyApp.app, async (emptyBaseUrl) => {
      await createProfile(emptyBaseUrl, {
        userId: 'U-manager',
        employeeName: 'Руслан',
        role: 'Менеджер по аренде',
        kpiSchemeType: 'rental_manager',
        kpiPercent: 0,
        kpiFixedAmount: 0,
      });
      const emptyCalculated = await calculateMonth(emptyBaseUrl);
      assert.equal(emptyCalculated.records[0].kpiBaseAmount, 0);
      assert.equal(emptyCalculated.records[0].kpiAmount, 0);
      assert.equal(emptyCalculated.records[0].calculationDetails.some(item => item.comment === 'Нет надёжной автоматической базы по прибыли аренды'), true);
    });
  });
});

test('calculate month does not overwrite approved or paid records', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const profile = await createProfile(baseUrl);
    const first = await calculateMonth(baseUrl);
    const periodId = first.period.id;
    const recordId = first.records[0].id;

    const approved = await request(baseUrl, 'POST', `/api/payroll/periods/${periodId}/approve`);
    assert.equal(approved.response.status, 200);
    assert.equal(approved.json.records[0].status, 'approved');

    const profileUpdate = await request(baseUrl, 'PATCH', `/api/payroll/profiles/${profile.id}`, 'admin', {
      baseSalary: 200000,
      kpiPercent: 20,
    });
    assert.equal(profileUpdate.response.status, 200);

    const recalculated = await calculateMonth(baseUrl);
    const preserved = recalculated.records.find(item => item.id === recordId);
    assert.equal(preserved.baseSalary, 100000);
    assert.equal(preserved.kpiAmount, 15000);
    assert.equal(preserved.status, 'approved');

    const paid = await request(baseUrl, 'POST', `/api/payroll/periods/${periodId}/mark-paid`);
    assert.equal(paid.response.status, 200);
    assert.equal(paid.json.records[0].status, 'paid');

    const paidRecalculated = await calculateMonth(baseUrl);
    assert.equal(paidRecalculated.records.find(item => item.id === recordId).baseSalary, 100000);
  });
});

test('adjustments update totals and preserve payroll history', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    await createProfile(baseUrl, { kpiSchemeType: 'none', kpiPercent: 0, kpiFixedAmount: 0 });
    const calculated = await calculateMonth(baseUrl);
    const recordId = calculated.records[0].id;

    const bonus = await request(baseUrl, 'POST', `/api/payroll/records/${recordId}/adjustments`, 'admin', {
      type: 'bonus',
      amount: 1234.56,
      reason: 'Премия за закрытие месяца',
    });
    assert.equal(bonus.response.status, 201);
    assert.equal(bonus.json.adjustment.amount, 1235);
    assert.equal(bonus.json.record.bonusAmount, 1235);
    assert.equal(bonus.json.record.grossAmount, 101235);
    assert.equal(bonus.json.record.netAmount, 101235);

    const deduction = await request(baseUrl, 'POST', `/api/payroll/records/${recordId}/adjustments`, 'admin', {
      type: 'deduction',
      amount: 500,
      reason: 'Удержание',
    });
    assert.equal(deduction.response.status, 201);
    assert.equal(deduction.json.record.deductionAmount, 500);
    assert.equal(deduction.json.record.netAmount, 100735);

    const advance = await request(baseUrl, 'POST', `/api/payroll/records/${recordId}/adjustments`, 'admin', {
      type: 'advance',
      amount: 10000,
      reason: 'Аванс',
    });
    assert.equal(advance.response.status, 201);
    assert.equal(advance.json.record.advanceAmount, 10000);
    assert.equal(advance.json.record.netAmount, 90735);

    const compensation = await request(baseUrl, 'POST', `/api/payroll/records/${recordId}/adjustments`, 'admin', {
      type: 'compensation',
      amount: 3000,
      reason: 'Компенсация ГСМ',
    });
    assert.equal(compensation.response.status, 201);
    assert.equal(compensation.json.record.compensationAmount, 3000);
    assert.equal(compensation.json.record.netAmount, 93735);

    const manualKpi = await request(baseUrl, 'POST', `/api/payroll/records/${recordId}/adjustments`, 'admin', {
      type: 'manual_kpi',
      amount: 7000,
      reason: 'Ручной KPI',
    });
    assert.equal(manualKpi.response.status, 201);
    assert.equal(manualKpi.json.record.kpiAmount, 7000);
    assert.equal(manualKpi.json.record.netAmount, 100735);

    const adjustmentHistory = await request(baseUrl, 'GET', `/api/payroll/records/${recordId}/adjustments`, 'admin');
    assert.equal(adjustmentHistory.response.status, 200);
    assert.equal(adjustmentHistory.json.length, 5);
    assert.equal(adjustmentHistory.json.some(item => item.createdByName === 'Админ' && item.reason === 'Ручной KPI'), true);

    const employeeAdjustments = await request(baseUrl, 'GET', '/api/payroll/adjustments?userId=U-manager', 'admin');
    assert.equal(employeeAdjustments.response.status, 200);
    assert.equal(employeeAdjustments.json.length, 5);
    assert.equal(employeeAdjustments.json[0].employeeName, 'Руслан');

    const auditEvents = await request(baseUrl, 'GET', '/api/payroll/audit-events?userId=U-manager', 'admin');
    assert.equal(auditEvents.response.status, 200);
    assert.equal(auditEvents.json.some(item => item.action === 'record.adjustment.bonus'), true);
    assert.equal(auditEvents.json.some(item => item.action === 'record.adjustment.deduction'), true);

    const recalculated = await calculateMonth(baseUrl);
    const preservedDraft = recalculated.records.find(item => item.id === recordId);
    assert.equal(preservedDraft.bonusAmount, 1235);
    assert.equal(preservedDraft.deductionAmount, 500);
    assert.equal(preservedDraft.advanceAmount, 10000);
    assert.equal(preservedDraft.compensationAmount, 3000);
    assert.equal(preservedDraft.kpiAmount, 7000);

    assert.equal(state.payroll_adjustments.length, 5);
    assert.equal(state.payroll_audit_events.some(item => item.action.startsWith('record.adjustment.')), true);
    assert.equal(deduction.json.record.calculationDetails.some(item => item.comment === 'Удержание'), true);
  });
});

test('payroll history keeps previous months and audit captures salary changes', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const profile = await createProfile(baseUrl, { baseSalary: 100000, kpiPercent: 10, kpiFixedAmount: 0 });
    const may = await calculateMonth(baseUrl, '2026-05');
    assert.equal(may.records[0].baseSalary, 100000);

    const update = await request(baseUrl, 'PATCH', `/api/payroll/profiles/${profile.id}`, 'admin', {
      baseSalary: 120000,
      kpiPercent: 15,
    });
    assert.equal(update.response.status, 200);

    const june = await calculateMonth(baseUrl, '2026-06');
    assert.equal(june.records[0].baseSalary, 120000);

    const history = await request(baseUrl, 'GET', '/api/payroll/records', 'admin');
    assert.equal(history.response.status, 200);
    const mayRecord = history.json.find(item => item.month === '2026-05');
    const juneRecord = history.json.find(item => item.month === '2026-06');
    assert.equal(mayRecord.baseSalary, 100000);
    assert.equal(juneRecord.baseSalary, 120000);

    const auditEvents = await request(baseUrl, 'GET', '/api/payroll/audit-events?userId=U-manager', 'admin');
    assert.equal(auditEvents.response.status, 200);
    const profileUpdate = auditEvents.json.find(item => item.action === 'profile.update');
    assert.ok(profileUpdate);
    assert.equal(profileUpdate.before.baseSalary, 100000);
    assert.equal(profileUpdate.after.baseSalary, 120000);
  });
});

test('non-admin cannot read payroll history endpoints', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const audit = await request(baseUrl, 'GET', '/api/payroll/audit-events', 'manager');
    assert.equal(audit.response.status, 403);
    const adjustments = await request(baseUrl, 'GET', '/api/payroll/adjustments', 'manager');
    assert.equal(adjustments.response.status, 403);
  });
});

test('manual record update recalculates gross and net amounts', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    await createProfile(baseUrl, { kpiSchemeType: 'none', kpiPercent: 0, kpiFixedAmount: 0 });
    const calculated = await calculateMonth(baseUrl);
    const recordId = calculated.records[0].id;

    const updated = await request(baseUrl, 'PATCH', `/api/payroll/records/${recordId}`, 'admin', {
      baseSalary: 110000,
      kpiAmount: 10000,
      bonusAmount: 2000,
      deductionAmount: 1500,
      advanceAmount: 5000,
      compensationAmount: 3000,
      adminComment: 'Ручная корректировка',
    });
    assert.equal(updated.response.status, 200);
    assert.equal(updated.json.grossAmount, 125000);
    assert.equal(updated.json.netAmount, 118500);
    assert.equal(updated.json.calculationDetails.some(item => item.label === 'Ручное изменение'), true);
  });
});

test('approve, mark-paid and close update period and records statuses', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    await createProfile(baseUrl);
    const calculated = await calculateMonth(baseUrl);
    const periodId = calculated.period.id;
    const recordId = calculated.records[0].id;

    const approved = await request(baseUrl, 'POST', `/api/payroll/periods/${periodId}/approve`);
    assert.equal(approved.response.status, 200);
    assert.equal(approved.json.period.status, 'approved');
    assert.equal(approved.json.records[0].status, 'approved');
    assert.ok(approved.json.period.approvedAt);

    const deniedApprovedAdjustment = await request(baseUrl, 'POST', `/api/payroll/records/${recordId}/adjustments`, 'admin', {
      type: 'bonus',
      amount: 1,
      reason: 'После утверждения',
    });
    assert.equal(deniedApprovedAdjustment.response.status, 409);

    const paid = await request(baseUrl, 'POST', `/api/payroll/periods/${periodId}/mark-paid`);
    assert.equal(paid.response.status, 200);
    assert.equal(paid.json.period.status, 'paid');
    assert.equal(paid.json.records[0].status, 'paid');
    assert.ok(paid.json.period.paidAt);

    const closed = await request(baseUrl, 'POST', `/api/payroll/periods/${periodId}/close`);
    assert.equal(closed.response.status, 200);
    assert.equal(closed.json.period.status, 'closed');
    assert.equal(closed.json.records[0].status, 'paid');
    assert.ok(closed.json.period.closedAt);

    const deniedPatch = await request(baseUrl, 'PATCH', `/api/payroll/records/${recordId}`, 'admin', {
      bonusAmount: 1,
    });
    assert.equal(deniedPatch.response.status, 409);

    const deniedAdjustment = await request(baseUrl, 'POST', `/api/payroll/records/${recordId}/adjustments`, 'admin', {
      type: 'bonus',
      amount: 1,
      reason: 'Поздняя корректировка',
    });
    assert.equal(deniedAdjustment.response.status, 409);

    const deniedCalculate = await request(baseUrl, 'POST', '/api/payroll/periods/calculate', 'admin', {
      month: '2026-05',
    });
    assert.equal(deniedCalculate.response.status, 409);
  });
});

test('payroll validates month format and non-negative money amounts', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const invalidMonth = await request(baseUrl, 'POST', '/api/payroll/periods/calculate', 'admin', {
      month: '2026-13',
    });
    assert.equal(invalidMonth.response.status, 400);

    const invalidSalary = await request(baseUrl, 'POST', '/api/payroll/profiles', 'admin', {
      userId: 'U-manager',
      employeeName: 'Руслан',
      role: 'Менеджер по аренде',
      baseSalary: -1,
      kpiSchemeType: 'none',
    });
    assert.equal(invalidSalary.response.status, 400);

    const invalidPercent = await request(baseUrl, 'POST', '/api/payroll/profiles', 'admin', {
      userId: 'U-manager',
      employeeName: 'Руслан',
      role: 'Менеджер по аренде',
      baseSalary: 100000,
      kpiSchemeType: 'manual',
      kpiPercent: 101,
    });
    assert.equal(invalidPercent.response.status, 400);
  });
});

test('profile edits do not mutate existing payroll record snapshots', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const profile = await createProfile(baseUrl, { baseSalary: 100000, kpiPercent: 10, kpiFixedAmount: 0 });
    const calculated = await calculateMonth(baseUrl);
    const recordId = calculated.records[0].id;

    const updatedProfile = await request(baseUrl, 'PATCH', `/api/payroll/profiles/${profile.id}`, 'admin', {
      baseSalary: 150000,
      kpiPercent: 25,
      kpiFixedAmount: 10000,
    });
    assert.equal(updatedProfile.response.status, 200);

    const record = await request(baseUrl, 'GET', `/api/payroll/records/${recordId}`, 'admin');
    assert.equal(record.response.status, 200);
    assert.equal(record.json.baseSalary, 100000);
    assert.equal(record.json.kpiPercent, 10);
    assert.equal(record.json.kpiAmount, 10000);
  });
});

test('non-admin cannot edit payroll profiles', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const profile = await createProfile(baseUrl);

    const denied = await request(baseUrl, 'PATCH', `/api/payroll/profiles/${profile.id}`, 'manager', {
      baseSalary: 1,
    });
    assert.equal(denied.response.status, 403);
  });
});
