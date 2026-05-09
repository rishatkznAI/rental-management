const {
  buildRentalDebtRows,
  getEffectivePaidAmount,
  getRentalDebtOverdueDays,
} = require('./finance-core');
const { getStableClientId, normalizeText } = require('./client-links');

const ACTION_TYPES = new Set([
  'call',
  'message',
  'email',
  'meeting',
  'legal_notice',
  'payment_promise',
  'payment_plan',
  'escalation',
  'comment',
]);

const ACTION_STATUSES = new Set(['planned', 'done', 'missed', 'cancelled']);
const PLAN_STATUSES = new Set(['planned', 'paid', 'missed', 'cancelled']);
const COLLECTION_STATUSES = new Set([
  'new',
  'in_work',
  'promised',
  'payment_plan',
  'overdue_promise',
  'escalated',
  'closed',
  'disputed',
]);

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function text(value) {
  return String(value ?? '').trim();
}

function dateOnly(value) {
  const valueText = text(value);
  if (!valueText) return '';
  const parsed = new Date(valueText);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function nowDate(today = new Date().toISOString().slice(0, 10)) {
  return dateOnly(today) || new Date().toISOString().slice(0, 10);
}

function clientKey(record) {
  const clientId = getStableClientId(record);
  if (clientId) return `id:${clientId}`;
  const name = normalizeText(record?.client || record?.clientName || record?.company);
  return name ? `name:${name}` : '';
}

function byId(items) {
  return new Map((items || []).filter(item => item?.id).map(item => [String(item.id), item]));
}

function sortByDateDesc(left, right) {
  return String(right?.actionDate || right?.createdAt || '').localeCompare(String(left?.actionDate || left?.createdAt || ''));
}

function normalizeAction(input = {}, previous = null, context = {}) {
  const now = context.nowIso ? context.nowIso() : new Date().toISOString();
  const actionType = text(input.actionType ?? previous?.actionType ?? 'comment');
  const status = text(input.status ?? previous?.status ?? (actionType === 'comment' ? 'done' : 'planned'));
  if (!ACTION_TYPES.has(actionType)) {
    const error = new Error('Некорректный тип действия взыскания.');
    error.status = 400;
    throw error;
  }
  if (!ACTION_STATUSES.has(status)) {
    const error = new Error('Некорректный статус действия взыскания.');
    error.status = 400;
    throw error;
  }
  const promisedAmount = toNumber(input.promisedAmount ?? previous?.promisedAmount);
  return {
    ...(previous || {}),
    id: previous?.id || text(input.id) || context.generateId(context.idPrefix || 'DCA'),
    clientId: text(input.clientId ?? previous?.clientId) || undefined,
    rentalId: text(input.rentalId ?? previous?.rentalId) || undefined,
    paymentId: text(input.paymentId ?? previous?.paymentId) || undefined,
    managerId: text(input.managerId ?? input.responsibleUserId ?? previous?.managerId ?? previous?.responsibleUserId) || undefined,
    responsibleUserId: text(input.responsibleUserId ?? input.managerId ?? previous?.responsibleUserId ?? previous?.managerId) || undefined,
    actionType,
    status,
    actionDate: dateOnly(input.actionDate ?? previous?.actionDate) || now.slice(0, 10),
    nextActionDate: dateOnly(input.nextActionDate ?? previous?.nextActionDate) || undefined,
    promisedPaymentDate: dateOnly(input.promisedPaymentDate ?? previous?.promisedPaymentDate) || undefined,
    promisedAmount: promisedAmount > 0 ? promisedAmount : undefined,
    comment: text(input.comment ?? previous?.comment) || undefined,
    createdBy: previous?.createdBy || context.userName || undefined,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    updatedBy: context.userName || undefined,
  };
}

function normalizePaymentPlan(input = {}, previous = null, context = {}) {
  const now = context.nowIso ? context.nowIso() : new Date().toISOString();
  const status = text(input.status ?? previous?.status ?? 'planned');
  if (!PLAN_STATUSES.has(status)) {
    const error = new Error('Некорректный статус платежа плана.');
    error.status = 400;
    throw error;
  }
  const amount = toNumber(input.amount ?? previous?.amount);
  if (amount <= 0) {
    const error = new Error('Укажите сумму платежа плана.');
    error.status = 400;
    throw error;
  }
  const paymentDate = dateOnly(input.paymentDate ?? previous?.paymentDate);
  if (!paymentDate) {
    const error = new Error('Укажите дату платежа плана.');
    error.status = 400;
    throw error;
  }
  return {
    ...(previous || {}),
    id: previous?.id || text(input.id) || context.generateId(context.idPrefix || 'RPP'),
    clientId: text(input.clientId ?? previous?.clientId) || undefined,
    rentalId: text(input.rentalId ?? previous?.rentalId) || undefined,
    paymentDate,
    amount,
    status,
    comment: text(input.comment ?? previous?.comment) || undefined,
    createdBy: previous?.createdBy || context.userName || undefined,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    updatedBy: context.userName || undefined,
  };
}

function buildReceivables(input = {}, todayInput) {
  const today = nowDate(todayInput);
  const clients = input.clients || [];
  const rentals = input.rentals || [];
  const payments = input.payments || [];
  const documents = input.documents || [];
  const actions = input.actions || [];
  const paymentPlans = input.paymentPlans || [];
  const clientsById = byId(clients);
  const debtRows = buildRentalDebtRows(rentals, payments);
  const paymentsByRentalId = new Map();
  const documentsByClientKey = new Map();
  const actionsByClientKey = new Map();
  const plansByClientKey = new Map();
  const grouped = new Map();

  for (const payment of payments) {
    if (!payment?.rentalId) continue;
    if (!paymentsByRentalId.has(payment.rentalId)) paymentsByRentalId.set(payment.rentalId, []);
    paymentsByRentalId.get(payment.rentalId).push(payment);
  }

  for (const doc of documents) {
    const key = clientKey(doc);
    if (!key) continue;
    if (!documentsByClientKey.has(key)) documentsByClientKey.set(key, []);
    documentsByClientKey.get(key).push(doc);
  }

  for (const action of actions) {
    const key = clientKey(action);
    if (!key) continue;
    if (!actionsByClientKey.has(key)) actionsByClientKey.set(key, []);
    actionsByClientKey.get(key).push(action);
  }

  for (const plan of paymentPlans) {
    const key = clientKey(plan);
    if (!key) continue;
    if (!plansByClientKey.has(key)) plansByClientKey.set(key, []);
    plansByClientKey.get(key).push(plan);
  }

  for (const row of debtRows) {
    const rowClientId = getStableClientId(row);
    const client = rowClientId ? clientsById.get(rowClientId) : null;
    const key = clientKey(row) || `rental:${row.rentalId}`;
    const overdueDays = getRentalDebtOverdueDays(row, today);
    const existing = grouped.get(key) || {
      clientId: client?.id || rowClientId || undefined,
      client: client?.company || row.client || 'Клиент не привязан',
      inn: client?.inn || client?.taxId || '',
      contacts: {
        contact: client?.contact || client?.contactName || '',
        phone: client?.phone || '',
        email: client?.email || '',
        address: client?.address || '',
      },
      manager: row.manager || client?.manager || 'Не назначен',
      totalDebt: 0,
      overdueDebt: 0,
      oldestOverdueDays: 0,
      rentals: [],
      payments: [],
      documents: [],
      actions: [],
      paymentPlans: [],
    };
    existing.totalDebt += row.outstanding;
    if (overdueDays > 0) existing.overdueDebt += row.outstanding;
    existing.oldestOverdueDays = Math.max(existing.oldestOverdueDays, overdueDays);
    existing.rentals.push({
      rentalId: row.rentalId,
      equipmentInv: row.equipmentInv || '',
      startDate: row.startDate || '',
      endDate: row.endDate || '',
      dueDate: row.expectedPaymentDate || row.endDate || '',
      amount: row.amount,
      paidAmount: row.paidAmount,
      outstanding: row.outstanding,
      overdueDays,
      status: row.rentalStatus,
    });
    for (const payment of paymentsByRentalId.get(row.rentalId) || []) {
      existing.payments.push({
        id: payment.id,
        rentalId: payment.rentalId,
        invoiceNumber: payment.invoiceNumber || '',
        amount: toNumber(payment.amount),
        paidAmount: getEffectivePaidAmount(payment),
        dueDate: payment.dueDate || '',
        paidDate: payment.paidDate || '',
        status: payment.status || '',
        comment: payment.comment || '',
      });
    }
    grouped.set(key, existing);
  }

  for (const [key, row] of grouped.entries()) {
    row.documents = documentsByClientKey.get(key) || [];
    row.actions = (actionsByClientKey.get(key) || []).slice().sort(sortByDateDesc);
    row.paymentPlans = (plansByClientKey.get(key) || []).slice().sort((a, b) => String(a.paymentDate || '').localeCompare(String(b.paymentDate || '')));

    const openActions = row.actions.filter(action => !['done', 'cancelled'].includes(text(action.status)));
    const latestAction = row.actions[0] || null;
    const latestContact = row.actions.find(action => action.status === 'done' && action.actionType !== 'comment') || null;
    const nextAction = openActions
      .slice()
      .sort((a, b) => String(a.nextActionDate || a.actionDate || '').localeCompare(String(b.nextActionDate || b.actionDate || '')))[0] || null;
    const latestPromise = row.actions.find(action => action.actionType === 'payment_promise' && action.promisedPaymentDate) || null;
    const activePlanRows = row.paymentPlans.filter(plan => plan.status === 'planned');
    const missedPlanRows = activePlanRows.filter(plan => dateOnly(plan.paymentDate) && dateOnly(plan.paymentDate) < today);
    const missedActions = openActions.filter(action => {
      const due = dateOnly(action.nextActionDate || action.actionDate);
      return due && due < today;
    });
    let collectionStatus = 'new';
    if (row.totalDebt <= 0) collectionStatus = 'closed';
    else if (latestPromise?.promisedPaymentDate && dateOnly(latestPromise.promisedPaymentDate) < today) collectionStatus = 'overdue_promise';
    else if (row.actions.some(action => action.actionType === 'escalation')) collectionStatus = 'escalated';
    else if (activePlanRows.length > 0) collectionStatus = 'payment_plan';
    else if (latestPromise) collectionStatus = 'promised';
    else if (row.actions.some(action => action.actionType === 'legal_notice' || /спор|разноглас/i.test(String(action.comment || '')))) collectionStatus = 'disputed';
    else if (row.actions.length > 0) collectionStatus = 'in_work';
    if (!COLLECTION_STATUSES.has(collectionStatus)) collectionStatus = 'new';

    row.lastContactDate = dateOnly(latestContact?.actionDate);
    row.nextActionDate = dateOnly(nextAction?.nextActionDate || nextAction?.actionDate);
    row.nextActionType = nextAction?.actionType || '';
    row.collectionStatus = collectionStatus;
    row.promisedPaymentDate = dateOnly(latestPromise?.promisedPaymentDate);
    row.promisedAmount = toNumber(latestPromise?.promisedAmount);
    row.comment = latestAction?.comment || '';
    row.hasPaymentPlan = activePlanRows.length > 0;
    row.noNextAction = row.overdueDebt > 0 && !row.nextActionDate && collectionStatus !== 'closed';
    row.missedActions = missedActions.length;
    row.missedPlanPayments = missedPlanRows.length;
  }

  const rows = Array.from(grouped.values())
    .filter(row => row.totalDebt > 0)
    .sort((a, b) => b.overdueDebt - a.overdueDebt || b.totalDebt - a.totalDebt || b.oldestOverdueDays - a.oldestOverdueDays || a.client.localeCompare(b.client, 'ru'));

  return {
    rows,
    debtRows,
    summary: buildReceivablesSummary(rows),
  };
}

function buildReceivablesSummary(rows) {
  const summary = {
    totalDebt: 0,
    overdueDebt: 0,
    age0_7: 0,
    age8_30: 0,
    age31_60: 0,
    age60Plus: 0,
    clientsWithDebt: 0,
    withoutNextAction: 0,
    promisedAmount: 0,
    paymentPlanAmount: 0,
  };
  for (const row of rows || []) {
    summary.totalDebt += toNumber(row.totalDebt);
    summary.overdueDebt += toNumber(row.overdueDebt);
    summary.clientsWithDebt += row.totalDebt > 0 ? 1 : 0;
    summary.withoutNextAction += row.noNextAction ? 1 : 0;
    summary.promisedAmount += toNumber(row.promisedAmount);
    summary.paymentPlanAmount += (row.paymentPlans || [])
      .filter(plan => plan.status === 'planned')
      .reduce((sum, plan) => sum + toNumber(plan.amount), 0);
    for (const rental of row.rentals || []) {
      const outstanding = toNumber(rental.outstanding);
      if (outstanding <= 0) continue;
      const days = toNumber(rental.overdueDays);
      if (days <= 7) summary.age0_7 += outstanding;
      else if (days <= 30) summary.age8_30 += outstanding;
      else if (days <= 60) summary.age31_60 += outstanding;
      else summary.age60Plus += outstanding;
    }
  }
  return summary;
}

module.exports = {
  ACTION_TYPES,
  ACTION_STATUSES,
  PLAN_STATUSES,
  COLLECTION_STATUSES,
  normalizeAction,
  normalizePaymentPlan,
  buildReceivables,
  buildReceivablesSummary,
};
