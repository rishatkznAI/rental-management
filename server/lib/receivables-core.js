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
  'generate_notification',
  'send_notification',
  'generate_pretrial_claim',
  'send_pretrial_claim',
  'court_preparing',
  'schedule_court',
  'court_stage_update',
  'court_decision',
  'receive_writ',
  'send_to_enforcement',
  'enforcement_update',
  'debt_recovered',
  'write_off',
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

const COLLECTION_STAGES = new Set([
  'new_debt',
  'notification_draft',
  'notification_sent',
  'notification_waiting',
  'pretrial_claim_draft',
  'pretrial_claim_sent',
  'pretrial_waiting',
  'court_preparing',
  'court_scheduled',
  'court_stage_1',
  'court_stage_2',
  'court_stage_3',
  'court_decision_received',
  'writ_received',
  'enforcement_sent',
  'enforcement_in_progress',
  'recovered',
  'closed',
  'written_off',
  'disputed',
]);

const STAGE_TRANSITIONS = {
  new_debt: ['notification_draft', 'disputed', 'closed', 'written_off'],
  notification_draft: ['notification_sent', 'notification_waiting', 'disputed', 'closed', 'written_off'],
  notification_sent: ['notification_waiting', 'pretrial_claim_draft', 'disputed', 'closed', 'written_off'],
  notification_waiting: ['pretrial_claim_draft', 'disputed', 'closed', 'written_off'],
  pretrial_claim_draft: ['pretrial_claim_sent', 'pretrial_waiting', 'disputed', 'closed', 'written_off'],
  pretrial_claim_sent: ['pretrial_waiting', 'court_preparing', 'disputed', 'closed', 'written_off'],
  pretrial_waiting: ['court_preparing', 'disputed', 'closed', 'written_off'],
  court_preparing: ['court_scheduled', 'disputed', 'closed', 'written_off'],
  court_scheduled: ['court_stage_1', 'court_decision_received', 'disputed', 'closed', 'written_off'],
  court_stage_1: ['court_stage_2', 'court_decision_received', 'disputed', 'closed', 'written_off'],
  court_stage_2: ['court_stage_3', 'court_decision_received', 'disputed', 'closed', 'written_off'],
  court_stage_3: ['court_decision_received', 'disputed', 'closed', 'written_off'],
  court_decision_received: ['writ_received', 'recovered', 'closed', 'written_off', 'disputed'],
  writ_received: ['enforcement_sent', 'recovered', 'closed', 'written_off'],
  enforcement_sent: ['enforcement_in_progress', 'recovered', 'closed', 'written_off'],
  enforcement_in_progress: ['recovered', 'written_off', 'closed'],
  recovered: ['closed'],
  closed: [],
  written_off: [],
  disputed: ['notification_draft', 'pretrial_claim_draft', 'court_preparing', 'closed', 'written_off'],
};

const ACTION_STAGE_DEFAULTS = {
  generate_notification: 'notification_draft',
  send_notification: 'notification_waiting',
  generate_pretrial_claim: 'pretrial_claim_draft',
  send_pretrial_claim: 'pretrial_waiting',
  court_preparing: 'court_preparing',
  schedule_court: 'court_scheduled',
  court_stage_update: 'court_stage_1',
  court_decision: 'court_decision_received',
  receive_writ: 'writ_received',
  send_to_enforcement: 'enforcement_sent',
  enforcement_update: 'enforcement_in_progress',
  debt_recovered: 'recovered',
  write_off: 'written_off',
  escalation: 'court_preparing',
};

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

function normalizeStage(value, fallback = '') {
  const stage = text(value || fallback);
  return COLLECTION_STAGES.has(stage) ? stage : '';
}

function getDefaultStageForAction(actionType, input = {}) {
  if (actionType === 'court_stage_update') {
    const explicit = normalizeStage(input.toStage);
    if (['court_stage_1', 'court_stage_2', 'court_stage_3'].includes(explicit)) return explicit;
    return 'court_stage_1';
  }
  return ACTION_STAGE_DEFAULTS[actionType] || '';
}

function validateStageTransition(fromStage, toStage, { override = false, comment = '', userRole = '' } = {}) {
  const from = normalizeStage(fromStage, 'new_debt') || 'new_debt';
  const to = normalizeStage(toStage);
  if (!to) {
    const error = new Error('Некорректный этап взыскания.');
    error.status = 400;
    throw error;
  }
  if (from === to) return true;
  const allowed = STAGE_TRANSITIONS[from] || [];
  if (allowed.includes(to)) return true;
  if (override && userRole === 'Администратор' && text(comment)) return true;
  const error = new Error('Недопустимый переход этапа взыскания.');
  error.status = 409;
  throw error;
}

function validateWorkflowActionFields(action) {
  if (action.toStage === 'court_scheduled' && !action.courtDate && !action.nextCourtDate) {
    const error = new Error('Для назначения суда укажите дату заседания.');
    error.status = 400;
    throw error;
  }
  if (['court_stage_1', 'court_stage_2', 'court_stage_3'].includes(action.toStage) && !action.courtDate && !action.nextCourtDate) {
    const error = new Error('Для этапа суда укажите дату заседания.');
    error.status = 400;
    throw error;
  }
  if (action.toStage === 'court_decision_received' && (!action.decisionDate || !action.decisionStatus)) {
    const error = new Error('Для решения суда укажите дату и результат.');
    error.status = 400;
    throw error;
  }
  if (action.toStage === 'writ_received' && (!action.writNumber || !action.writDate)) {
    const error = new Error('Для исполнительного листа укажите номер и дату.');
    error.status = 400;
    throw error;
  }
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
  const toStage = normalizeStage(input.toStage ?? previous?.toStage) || getDefaultStageForAction(actionType, input);
  const fromStage = normalizeStage(input.fromStage ?? previous?.fromStage);
  const action = {
    ...(previous || {}),
    id: previous?.id || text(input.id) || context.generateId(context.idPrefix || 'DCA'),
    clientId: text(input.clientId ?? previous?.clientId) || undefined,
    rentalId: text(input.rentalId ?? previous?.rentalId) || undefined,
    paymentId: text(input.paymentId ?? previous?.paymentId) || undefined,
    documentId: text(input.documentId ?? previous?.documentId) || undefined,
    managerId: text(input.managerId ?? input.responsibleUserId ?? previous?.managerId ?? previous?.responsibleUserId) || undefined,
    responsibleUserId: text(input.responsibleUserId ?? input.managerId ?? previous?.responsibleUserId ?? previous?.managerId) || undefined,
    actionType,
    status,
    fromStage: fromStage || undefined,
    toStage: toStage || undefined,
    actionDate: dateOnly(input.actionDate ?? previous?.actionDate) || now.slice(0, 10),
    dueDate: dateOnly(input.dueDate ?? previous?.dueDate) || undefined,
    nextActionDate: dateOnly(input.nextActionDate ?? previous?.nextActionDate) || undefined,
    promisedPaymentDate: dateOnly(input.promisedPaymentDate ?? previous?.promisedPaymentDate) || undefined,
    promisedAmount: promisedAmount > 0 ? promisedAmount : undefined,
    sendMethod: text(input.sendMethod ?? previous?.sendMethod) || undefined,
    sentTo: text(input.sentTo ?? previous?.sentTo) || undefined,
    attachmentUrl: text(input.attachmentUrl ?? previous?.attachmentUrl) || undefined,
    fileUrl: text(input.fileUrl ?? previous?.fileUrl) || undefined,
    courtName: text(input.courtName ?? previous?.courtName) || undefined,
    caseNumber: text(input.caseNumber ?? previous?.caseNumber) || undefined,
    claimAmount: toNumber(input.claimAmount ?? previous?.claimAmount) || undefined,
    courtDate: dateOnly(input.courtDate ?? previous?.courtDate) || undefined,
    nextCourtDate: dateOnly(input.nextCourtDate ?? previous?.nextCourtDate) || undefined,
    courtStageComment: text(input.courtStageComment ?? previous?.courtStageComment) || undefined,
    decisionDate: dateOnly(input.decisionDate ?? previous?.decisionDate) || undefined,
    decisionAmount: toNumber(input.decisionAmount ?? previous?.decisionAmount) || undefined,
    decisionStatus: text(input.decisionStatus ?? previous?.decisionStatus) || undefined,
    writNumber: text(input.writNumber ?? previous?.writNumber) || undefined,
    writDate: dateOnly(input.writDate ?? previous?.writDate) || undefined,
    writAmount: toNumber(input.writAmount ?? previous?.writAmount) || undefined,
    receivedBy: text(input.receivedBy ?? previous?.receivedBy) || undefined,
    enforcementSentDate: dateOnly(input.enforcementSentDate ?? previous?.enforcementSentDate) || undefined,
    bailiffDepartment: text(input.bailiffDepartment ?? previous?.bailiffDepartment) || undefined,
    enforcementNumber: text(input.enforcementNumber ?? previous?.enforcementNumber) || undefined,
    enforcementStatus: text(input.enforcementStatus ?? previous?.enforcementStatus) || undefined,
    recoveredAmount: toNumber(input.recoveredAmount ?? previous?.recoveredAmount) || undefined,
    remainingAmount: toNumber(input.remainingAmount ?? previous?.remainingAmount) || undefined,
    nextControlDate: dateOnly(input.nextControlDate ?? previous?.nextControlDate) || undefined,
    override: Boolean(input.override ?? previous?.override) || undefined,
    comment: text(input.comment ?? previous?.comment) || undefined,
    createdBy: previous?.createdBy || context.userName || undefined,
    createdAt: previous?.createdAt || now,
    updatedAt: now,
    updatedBy: context.userName || undefined,
  };
  validateWorkflowActionFields(action);
  return action;
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

function findLatestAction(actions, predicate) {
  return (actions || []).find(predicate) || null;
}

function deriveWorkflow(row, today) {
  const actions = row.actions || [];
  const workflowActions = actions.filter(action => normalizeStage(action.toStage));
  const latestWorkflow = workflowActions[0] || null;
  const latestByStage = stage => findLatestAction(actions, action => action.toStage === stage);
  const latestByType = type => findLatestAction(actions, action => action.actionType === type);
  const stage = normalizeStage(latestWorkflow?.toStage) || (row.overdueDebt > 0 ? 'new_debt' : 'closed');
  const notification = latestByType('send_notification') || latestByStage('notification_sent') || latestByStage('notification_waiting');
  const pretrial = latestByType('send_pretrial_claim') || latestByStage('pretrial_claim_sent') || latestByStage('pretrial_waiting');
  const court = latestByType('schedule_court') || latestByStage('court_scheduled') || latestByStage('court_stage_1') || latestByStage('court_stage_2') || latestByStage('court_stage_3');
  const decision = latestByType('court_decision') || latestByStage('court_decision_received');
  const writ = latestByType('receive_writ') || latestByStage('writ_received');
  const enforcement = latestByType('send_to_enforcement') || latestByStage('enforcement_sent') || latestByStage('enforcement_in_progress');
  const recovery = latestByType('debt_recovered') || latestByStage('recovered');
  const nextControlDate = dateOnly(enforcement?.nextControlDate || latestWorkflow?.nextControlDate);

  return {
    collectionStage: stage,
    lastWorkflowActionDate: dateOnly(latestWorkflow?.actionDate),
    notificationSentDate: dateOnly(notification?.actionDate),
    notificationDueDate: dateOnly(notification?.dueDate),
    pretrialClaimSentDate: dateOnly(pretrial?.actionDate),
    pretrialClaimDueDate: dateOnly(pretrial?.dueDate),
    courtDate: dateOnly(court?.courtDate),
    nextCourtDate: dateOnly(court?.nextCourtDate),
    caseNumber: court?.caseNumber || decision?.caseNumber || '',
    decisionDate: dateOnly(decision?.decisionDate),
    decisionStatus: decision?.decisionStatus || '',
    writNumber: writ?.writNumber || '',
    writDate: dateOnly(writ?.writDate),
    enforcementNumber: enforcement?.enforcementNumber || '',
    enforcementStatus: enforcement?.enforcementStatus || '',
    recoveredAmount: toNumber(recovery?.recoveredAmount),
    remainingAmount: toNumber(recovery?.remainingAmount || enforcement?.remainingAmount),
    nextControlDate,
    notificationOverdue: Boolean(notification?.dueDate && dateOnly(notification.dueDate) < today && row.totalDebt > 0 && !['pretrial_claim_draft', 'pretrial_claim_sent', 'pretrial_waiting', 'court_preparing', 'court_scheduled', 'court_stage_1', 'court_stage_2', 'court_stage_3', 'court_decision_received', 'writ_received', 'enforcement_sent', 'enforcement_in_progress', 'recovered', 'closed', 'written_off'].includes(stage)),
    pretrialOverdue: Boolean(pretrial?.dueDate && dateOnly(pretrial.dueDate) < today && row.totalDebt > 0 && !['court_preparing', 'court_scheduled', 'court_stage_1', 'court_stage_2', 'court_stage_3', 'court_decision_received', 'writ_received', 'enforcement_sent', 'enforcement_in_progress', 'recovered', 'closed', 'written_off'].includes(stage)),
  };
}

function buildReceivables(input = {}, todayInput) {
  const today = nowDate(todayInput);
  const clients = input.clients || [];
  const rentals = input.rentals || [];
  const payments = input.payments || [];
  const paymentAllocations = input.paymentAllocations || [];
  const documents = input.documents || [];
  const actions = input.actions || [];
  const paymentPlans = input.paymentPlans || [];
  const clientsById = byId(clients);
  const debtRows = buildRentalDebtRows(rentals, payments, { paymentAllocations });
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
    row.actions = (actionsByClientKey.get(key) || [])
      .map((action, index) => ({ action, index }))
      .sort((left, right) => sortByDateDesc(left.action, right.action) || right.index - left.index)
      .map(item => item.action);
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
    Object.assign(row, deriveWorkflow(row, today));
  }

  const rows = Array.from(grouped.values())
    .filter(row => row.totalDebt > 0)
    .sort((a, b) => b.overdueDebt - a.overdueDebt || b.totalDebt - a.totalDebt || b.oldestOverdueDays - a.oldestOverdueDays || a.client.localeCompare(b.client, 'ru'));

  return {
    rows,
    debtRows,
    summary: buildReceivablesSummary(rows, today),
  };
}

function buildReceivablesSummary(rows, todayInput) {
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
    withoutNotification: 0,
    notificationOverdue: 0,
    pretrialOverdue: 0,
    courtNext7Days: 0,
    overdueNextAction: 0,
    writNotEnforced: 0,
    enforcementStale: 0,
  };
  const today = nowDate(todayInput);
  const inSevenDays = new Date(`${today}T00:00:00`);
  inSevenDays.setDate(inSevenDays.getDate() + 7);
  const sevenKey = inSevenDays.toISOString().slice(0, 10);
  for (const row of rows || []) {
    summary.totalDebt += toNumber(row.totalDebt);
    summary.overdueDebt += toNumber(row.overdueDebt);
    summary.clientsWithDebt += row.totalDebt > 0 ? 1 : 0;
    summary.withoutNextAction += row.noNextAction ? 1 : 0;
    summary.promisedAmount += toNumber(row.promisedAmount);
    summary.withoutNotification += row.overdueDebt > 0 && row.collectionStage === 'new_debt' ? 1 : 0;
    summary.notificationOverdue += row.notificationOverdue ? 1 : 0;
    summary.pretrialOverdue += row.pretrialOverdue ? 1 : 0;
    summary.overdueNextAction += row.nextActionDate && dateOnly(row.nextActionDate) < today ? 1 : 0;
    summary.courtNext7Days += row.courtDate && row.courtDate >= today && row.courtDate <= sevenKey ? 1 : 0;
    summary.writNotEnforced += row.collectionStage === 'writ_received' ? 1 : 0;
    summary.enforcementStale += row.collectionStage === 'enforcement_in_progress' && (!row.nextControlDate || dateOnly(row.nextControlDate) < today) ? 1 : 0;
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
  COLLECTION_STAGES,
  STAGE_TRANSITIONS,
  ACTION_STAGE_DEFAULTS,
  normalizeAction,
  normalizePaymentPlan,
  validateStageTransition,
  buildReceivables,
  buildReceivablesSummary,
};
