import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createAccessControl } = require('../server/lib/access-control.js');
const { registerFinanceRoutes } = require('../server/routes/finance.js');
const financeCore = require('../server/lib/finance-core.js');
const receivablesCore = require('../server/lib/receivables-core.js');

function createApp() {
  let idCounter = 0;
  const state = {
    clients: [{ id: 'c-1', company: 'ООО Долг', inn: '7701000000', manager: 'Office' }],
    gantt_rentals: [{
      id: 'r-1',
      clientId: 'c-1',
      client: 'ООО Долг',
      equipmentInv: 'A-1',
      manager: 'Office',
      startDate: '2026-04-01',
      endDate: '2026-04-10',
      expectedPaymentDate: '2026-04-15',
      amount: 100000,
      status: 'active',
    }],
    payments: [],
    documents: [],
    app_settings: [],
    client_objects: [],
    leasing_contracts: [],
    leasing_payment_schedule: [],
    debt_collection_actions: [],
    receivable_payment_plans: [],
  };
  const users = {
    admin: { userId: 'u-admin', userName: 'Admin', userRole: 'Администратор' },
    office: { userId: 'u-office', userName: 'Office', userRole: 'Офис-менеджер' },
    mechanic: { userId: 'u-mechanic', userName: 'Mechanic', userRole: 'Механик' },
  };
  const readData = name => state[name] || [];
  const writeData = (name, value) => {
    state[name] = value;
  };
  const accessControl = createAccessControl({ readData });
  const app = express();
  const router = express.Router();
  app.use(express.json());
  const requireAuth = (req, res, next) => {
    const token = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const user = users[token];
    if (!user) return res.status(401).json({ ok: false, error: 'Unauthorized' });
    req.user = user;
    next();
  };
  const requireRead = collection => (req, res, next) => {
    if (collection === 'finance_operations' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    if (collection === 'payments' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
  const requireWrite = collection => (req, res, next) => {
    if (collection === 'debt_collection_actions' && ['Администратор', 'Офис-менеджер'].includes(req.user?.userRole)) return next();
    return res.status(403).json({ ok: false, error: 'Forbidden' });
  };
  registerFinanceRoutes(router, {
    requireAuth,
    requireRead,
    requireWrite,
    readData,
    writeData,
    accessControl,
    generateId: prefix => `${prefix}-${++idCounter}`,
    idPrefixes: { documents: 'D', debt_collection_actions: 'DCA', receivable_payment_plans: 'RPP' },
    nowIso: () => '2026-05-09T12:00:00.000Z',
    auditLog: null,
    ...financeCore,
    ...receivablesCore,
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

test('receivables legal workflow generates notification document and sends it', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    const generated = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'generate_notification',
      comment: 'Подготовить уведомление',
    });
    assert.equal(generated.response.status, 201);
    assert.equal(generated.json.action.toStage, 'notification_draft');
    assert.equal(generated.json.document.type, 'debt_notification');
    assert.equal(generated.json.document.number, 'DEBTNOTICE-2026-0001');
    assert.equal(state.documents.length, 1);

    const sent = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'send_notification',
      sendMethod: 'email',
      sentTo: 'client@example.test',
      dueDate: '2026-05-14',
      comment: 'Отправлено на почту',
    });
    assert.equal(sent.response.status, 201);
    assert.equal(sent.json.action.toStage, 'notification_waiting');

    const after = await request(baseUrl, 'GET', '/api/finance/receivables?today=2026-05-20', 'office');
    assert.equal(after.json.rows[0].collectionStage, 'notification_waiting');
    assert.equal(after.json.rows[0].notificationDueDate, '2026-05-14');
    assert.equal(after.json.summary.notificationOverdue, 1);
  });
});

test('receivables legal workflow generates and sends pretrial claim', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', { clientId: 'c-1', actionType: 'generate_notification' });
    await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', { clientId: 'c-1', actionType: 'send_notification' });

    const claim = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'generate_pretrial_claim',
      comment: 'Готовим претензию',
    });
    assert.equal(claim.response.status, 201);
    assert.equal(claim.json.document.type, 'pretrial_claim');
    assert.equal(claim.json.document.number, 'CLAIM-2026-0001');

    const sentClaim = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'send_pretrial_claim',
      sendMethod: 'courier',
      dueDate: '2026-05-25',
    });
    assert.equal(sentClaim.response.status, 201);
    assert.equal(sentClaim.json.action.toStage, 'pretrial_waiting');
    assert.equal(state.documents.length, 2);
  });
});

test('receivables legal workflow validates transitions and court/writ fields', async () => {
  const { app, state } = createApp();
  await withServer(app, async (baseUrl) => {
    const invalidClaim = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'generate_pretrial_claim',
    });
    assert.equal(invalidClaim.response.status, 409);
    assert.equal(state.documents.length, 0);

    const jump = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'court_stage_update',
      toStage: 'court_stage_2',
      courtDate: '2026-06-01',
    });
    assert.equal(jump.response.status, 409);

    const adminOverride = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'admin', {
      clientId: 'c-1',
      actionType: 'court_stage_update',
      toStage: 'court_stage_2',
      courtDate: '2026-06-01',
      override: true,
      comment: 'Переносим legacy-долг на фактический этап',
    });
    assert.equal(adminOverride.response.status, 201);

    const badCourt = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'schedule_court',
    });
    assert.equal(badCourt.response.status, 400);
  });
});

test('receivables legal workflow records court decision writ and enforcement', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', { clientId: 'c-1', actionType: 'generate_notification' });
    await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', { clientId: 'c-1', actionType: 'send_notification' });
    await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', { clientId: 'c-1', actionType: 'generate_pretrial_claim' });
    await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', { clientId: 'c-1', actionType: 'send_pretrial_claim' });
    await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', { clientId: 'c-1', actionType: 'court_preparing' });
    const scheduled = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'schedule_court',
      courtName: 'АС РТ',
      caseNumber: 'А65-1/2026',
      courtDate: '2026-06-01',
    });
    assert.equal(scheduled.response.status, 201);

    const decision = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'court_decision',
      decisionDate: '2026-06-10',
      decisionStatus: 'won',
      decisionAmount: 100000,
    });
    assert.equal(decision.response.status, 201);

    const badWrit = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'receive_writ',
      writDate: '2026-06-20',
    });
    assert.equal(badWrit.response.status, 400);

    const writ = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'receive_writ',
      writNumber: 'ИЛ-77',
      writDate: '2026-06-20',
      writAmount: 100000,
    });
    assert.equal(writ.response.status, 201);

    const enforcement = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'office', {
      clientId: 'c-1',
      actionType: 'send_to_enforcement',
      bailiffDepartment: 'РОСП',
      enforcementNumber: 'ИП-1',
      nextControlDate: '2026-07-01',
    });
    assert.equal(enforcement.response.status, 201);

    const after = await request(baseUrl, 'GET', '/api/finance/receivables?today=2026-06-21', 'office');
    assert.equal(after.json.rows[0].collectionStage, 'enforcement_sent');
    assert.equal(after.json.rows[0].writNumber, 'ИЛ-77');
    assert.equal(after.json.rows[0].enforcementNumber, 'ИП-1');
  });
});

test('receivables legal workflow denies roles without receivables write access', async () => {
  const { app } = createApp();
  await withServer(app, async (baseUrl) => {
    const denied = await request(baseUrl, 'POST', '/api/finance/receivables/workflow-actions', 'mechanic', {
      clientId: 'c-1',
      actionType: 'generate_notification',
    });
    assert.equal(denied.response.status, 403);
  });
});
