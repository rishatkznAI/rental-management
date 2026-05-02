const express = require('express');
const { buildClientDebtAgingRows, buildRentalDebtRows } = require('../lib/finance-core');
const { normalizeRole } = require('../lib/role-groups');

const OPEN_RENTAL_STATUSES = new Set(['active', 'confirmed', 'return_planned']);
const OPEN_SERVICE_STATUSES = new Set(['new', 'open', 'assigned', 'in_progress', 'waiting_parts', 'ready']);
const CLOSED_DEBT_PLAN_STATUSES = new Set(['closed']);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function normalizeStatus(value) {
  return normalizeText(value).toLowerCase();
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function dateKey(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function addDaysKey(todayKey, days) {
  const parsed = new Date(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function compareDateKey(left, right) {
  if (!left && !right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  return left.localeCompare(right);
}

function uniqueTaskId(...parts) {
  return parts.map(part => normalizeText(part).replace(/\s+/g, '-')).filter(Boolean).join(':').toLowerCase();
}

function safeClientName(...values) {
  return values.map(normalizeText).find(Boolean) || 'Клиент не указан';
}

function safeEquipmentName(...values) {
  return values.map(value => {
    if (Array.isArray(value)) return value.map(normalizeText).filter(Boolean).join(', ');
    return normalizeText(value);
  }).find(Boolean) || 'Техника не указана';
}

function taskPriority(priority) {
  return ['low', 'medium', 'high', 'critical'].includes(priority) ? priority : 'medium';
}

function makeTask(input) {
  return {
    id: uniqueTaskId(input.type, input.entityType, input.entityId, input.dueDate, input.title),
    type: normalizeText(input.type) || 'system',
    title: normalizeText(input.title) || 'Задача',
    description: normalizeText(input.description),
    priority: taskPriority(input.priority),
    dueDate: dateKey(input.dueDate),
    section: normalizeText(input.section) || 'system',
    entityType: normalizeText(input.entityType),
    entityId: normalizeText(input.entityId),
    clientId: normalizeText(input.clientId) || undefined,
    clientName: normalizeText(input.clientName) || undefined,
    assignedTo: normalizeText(input.assignedTo) || undefined,
    responsible: normalizeText(input.responsible) || undefined,
    status: 'open',
    actionUrl: normalizeText(input.actionUrl) || '/',
    detectedAt: input.detectedAt || new Date().toISOString(),
    source: 'computed',
    amount: typeof input.amount === 'number' && Number.isFinite(input.amount) ? input.amount : undefined,
  };
}

function collectionData({ readData, accessControl, req, collection, normalize = value => value }) {
  if (!req.canReadCollection(req, collection)) return [];
  const raw = Array.isArray(readData(collection)) ? readData(collection) : [];
  const normalized = normalize(raw);
  const scoped = accessControl.filterCollectionByScope(collection, normalized, req.user);
  return accessControl.sanitizeCollectionForRead(collection, scoped, req.user);
}

function canViewFinance(req) {
  // Keep backend at least as strict as frontend can('view', 'finance') today.
  return normalizeRole(req.user?.userRole || req.user?.role) === 'Администратор';
}

function isOpenRental(rental) {
  return OPEN_RENTAL_STATUSES.has(normalizeStatus(rental?.status));
}

function isOpenService(ticket) {
  const status = normalizeStatus(ticket?.status);
  return !status || OPEN_SERVICE_STATUSES.has(status) || status !== 'closed';
}

function isUnsignedDocument(doc) {
  const type = normalizeStatus(doc?.type);
  const status = normalizeStatus(doc?.status);
  return ['contract', 'act'].includes(type) && status !== 'signed';
}

function isDebtPlanOpen(plan) {
  return !CLOSED_DEBT_PLAN_STATUSES.has(normalizeStatus(plan?.status));
}

function clientPlanKey(clientId, clientName) {
  const id = normalizeText(clientId);
  if (id) return `id:${id}`;
  const name = normalizeText(clientName).toLowerCase();
  return name ? `name:${name}` : '';
}

function buildTasksCenterSummary(tasks, todayKey) {
  const overdue = tasks.filter(task => task.dueDate && task.dueDate < todayKey).length;
  const today = tasks.filter(task => task.dueDate === todayKey).length;
  return {
    total: tasks.length,
    critical: tasks.filter(task => task.priority === 'critical').length,
    high: tasks.filter(task => task.priority === 'high').length,
    overdue,
    today,
  };
}

function buildTasksCenterPayload(input) {
  const {
    readData,
    accessControl,
    req,
    nowIso = () => new Date().toISOString(),
  } = input;
  const generatedAt = nowIso();
  const todayKey = dateKey(input.today || generatedAt) || new Date().toISOString().slice(0, 10);
  const tomorrowKey = addDaysKey(todayKey, 1);
  const canFinance = canViewFinance(req);
  const tasks = [];

  const clients = collectionData({ readData, accessControl, req, collection: 'clients' });
  const rentals = collectionData({ readData, accessControl, req, collection: 'rentals' });
  const ganttRentals = collectionData({ readData, accessControl, req, collection: 'gantt_rentals' });
  const payments = collectionData({ readData, accessControl, req, collection: 'payments' });
  const documents = collectionData({ readData, accessControl, req, collection: 'documents' });
  const service = collectionData({ readData, accessControl, req, collection: 'service' });
  const deliveries = collectionData({ readData, accessControl, req, collection: 'deliveries' });
  const plans = collectionData({ readData, accessControl, req, collection: 'debt_collection_plans' });

  for (const rental of ganttRentals.filter(isOpenRental)) {
    const due = dateKey(rental?.endDate || rental?.plannedReturnDate);
    if (!due) continue;
    if (due < todayKey || due === todayKey || due === tomorrowKey) {
      const isOverdue = due < todayKey;
      tasks.push(makeTask({
        type: isOverdue ? 'rentals.return_overdue' : due === todayKey ? 'rentals.return_today' : 'rentals.return_tomorrow',
        title: isOverdue ? 'Просроченный возврат аренды' : due === todayKey ? 'Возврат аренды сегодня' : 'Возврат аренды завтра',
        description: `${safeClientName(rental?.client)} · ${safeEquipmentName(rental?.equipmentInv, rental?.equipment)}`,
        priority: isOverdue ? 'critical' : due === todayKey ? 'high' : 'medium',
        dueDate: due,
        section: 'rentals',
        entityType: 'gantt_rentals',
        entityId: rental?.id,
        clientId: rental?.clientId,
        clientName: rental?.client,
        responsible: rental?.manager,
        actionUrl: rental?.id ? `/rentals/${rental.id}` : '/rentals',
        detectedAt: generatedAt,
      }));
    }
  }

  if (payments.length > 0 && ganttRentals.length > 0) {
    const rentalDebtRows = buildRentalDebtRows(ganttRentals, payments);
    const clientDebtRows = buildClientDebtAgingRows(clients, rentalDebtRows, todayKey);
    const openPlanKeys = new Set(plans.filter(isDebtPlanOpen).map(plan => clientPlanKey(plan.clientId, plan.clientName)).filter(Boolean));
    for (const row of clientDebtRows) {
      const debt = safeNumber(row?.debt);
      const maxOverdueDays = safeNumber(row?.maxOverdueDays);
      if (debt <= 0 || maxOverdueDays < 30) continue;
      const key = clientPlanKey(row?.clientId, row?.client);
      if (key && openPlanKeys.has(key)) continue;
      tasks.push(makeTask({
        type: 'debt.no_plan_30_plus',
        title: 'Долг 30+ дней без плана взыскания',
        description: canFinance
          ? `${safeClientName(row?.client)} · ${maxOverdueDays} дн. · ${debt.toLocaleString('ru-RU')} ₽`
          : `${safeClientName(row?.client)} · финансовые данные скрыты правами доступа`,
        priority: maxOverdueDays > 60 ? 'critical' : 'high',
        dueDate: todayKey,
        section: 'finance',
        entityType: 'clients',
        entityId: row?.clientId,
        clientId: row?.clientId,
        clientName: row?.client,
        responsible: row?.manager,
        actionUrl: row?.clientId ? `/clients/${row.clientId}` : '/finance',
        amount: canFinance ? debt : undefined,
        detectedAt: generatedAt,
      }));
    }
  }

  for (const plan of plans.filter(isDebtPlanOpen)) {
    const nextActionDate = dateKey(plan?.nextActionDate);
    const promisedPaymentDate = dateKey(plan?.promisedPaymentDate);
    const priority = normalizeStatus(plan?.priority);
    if (nextActionDate && nextActionDate < todayKey) {
      tasks.push(makeTask({
        type: 'debt_collection.next_action_overdue',
        title: 'Просрочено действие по взысканию',
        description: `${safeClientName(plan?.clientName)} · ${normalizeText(plan?.comment) || 'нужно обновить план'}`,
        priority: priority === 'critical' ? 'critical' : 'high',
        dueDate: nextActionDate,
        section: 'finance',
        entityType: 'debt_collection_plans',
        entityId: plan?.id,
        clientId: plan?.clientId,
        clientName: plan?.clientName,
        responsible: plan?.responsibleName,
        actionUrl: plan?.clientId ? `/clients/${plan.clientId}` : '/finance',
        detectedAt: generatedAt,
      }));
    }
    if (promisedPaymentDate === todayKey) {
      tasks.push(makeTask({
        type: 'debt_collection.promised_today',
        title: 'Обещанная оплата сегодня',
        description: `${safeClientName(plan?.clientName)} · проверить поступление и обновить статус`,
        priority: ['critical', 'high'].includes(priority) ? priority : 'medium',
        dueDate: promisedPaymentDate,
        section: 'finance',
        entityType: 'debt_collection_plans',
        entityId: plan?.id,
        clientId: plan?.clientId,
        clientName: plan?.clientName,
        responsible: plan?.responsibleName,
        actionUrl: plan?.clientId ? `/clients/${plan.clientId}` : '/finance',
        detectedAt: generatedAt,
      }));
    }
    if (['high', 'critical'].includes(priority)) {
      tasks.push(makeTask({
        type: 'debt_collection.high_priority',
        title: priority === 'critical' ? 'Критичный план взыскания' : 'Высокий приоритет взыскания',
        description: `${safeClientName(plan?.clientName)} · ${normalizeText(plan?.result || plan?.comment) || 'требует контроля'}`,
        priority: priority === 'critical' ? 'critical' : 'high',
        dueDate: nextActionDate || promisedPaymentDate || '',
        section: 'finance',
        entityType: 'debt_collection_plans',
        entityId: plan?.id,
        clientId: plan?.clientId,
        clientName: plan?.clientName,
        responsible: plan?.responsibleName,
        actionUrl: plan?.clientId ? `/clients/${plan.clientId}` : '/finance',
        detectedAt: generatedAt,
      }));
    }
    if (!normalizeText(plan?.responsibleName) && !normalizeText(plan?.responsibleUserId)) {
      tasks.push(makeTask({
        type: 'debt_collection.no_responsible',
        title: 'План взыскания без ответственного',
        description: safeClientName(plan?.clientName),
        priority: 'medium',
        dueDate: nextActionDate || todayKey,
        section: 'finance',
        entityType: 'debt_collection_plans',
        entityId: plan?.id,
        clientId: plan?.clientId,
        clientName: plan?.clientName,
        actionUrl: plan?.clientId ? `/clients/${plan.clientId}` : '/finance',
        detectedAt: generatedAt,
      }));
    }
  }

  for (const doc of documents.filter(isUnsignedDocument)) {
    tasks.push(makeTask({
      type: normalizeStatus(doc?.status) === 'sent' ? 'documents.sent_unsigned' : 'documents.unsigned',
      title: normalizeStatus(doc?.status) === 'sent' ? 'Документ отправлен, но не подписан' : 'Документ без подписи',
      description: `${safeClientName(doc?.client)} · ${normalizeText(doc?.type) || 'документ'}`,
      priority: normalizeStatus(doc?.status) === 'sent' ? 'high' : 'medium',
      dueDate: dateKey(doc?.date) || '',
      section: 'documents',
      entityType: 'documents',
      entityId: doc?.id,
      clientId: doc?.clientId,
      clientName: doc?.client,
      responsible: doc?.manager,
      actionUrl: '/documents',
      detectedAt: generatedAt,
    }));
  }

  for (const ticket of service.filter(isOpenService)) {
    const noMechanic = !normalizeText(ticket?.assignedMechanicId) && !normalizeText(ticket?.assignedMechanicName) && !normalizeText(ticket?.assignedTo);
    const status = normalizeStatus(ticket?.status);
    const priority = normalizeStatus(ticket?.priority);
    if (!noMechanic && status !== 'waiting_parts' && !['high', 'critical'].includes(priority)) continue;
    tasks.push(makeTask({
      type: noMechanic ? 'service.unassigned' : status === 'waiting_parts' ? 'service.waiting_parts' : 'service.high_priority',
      title: noMechanic ? 'Сервисная заявка без механика' : status === 'waiting_parts' ? 'Сервис ждёт запчасти' : 'Срочная сервисная заявка',
      description: `${safeEquipmentName(ticket?.inventoryNumber, ticket?.equipment)} · ${normalizeText(ticket?.reason || ticket?.description) || 'заявка требует внимания'}`,
      priority: priority === 'critical' ? 'critical' : priority === 'high' || status === 'waiting_parts' ? 'high' : 'medium',
      dueDate: dateKey(ticket?.dueDate || ticket?.createdAt),
      section: 'service',
      entityType: 'service',
      entityId: ticket?.id,
      clientId: ticket?.clientId,
      clientName: ticket?.client,
      assignedTo: ticket?.assignedMechanicName || ticket?.assignedTo,
      actionUrl: ticket?.id ? `/service/${ticket.id}` : '/service',
      detectedAt: generatedAt,
    }));
  }

  for (const delivery of deliveries) {
    const due = dateKey(delivery?.date || delivery?.deliveryDate || delivery?.plannedDate || delivery?.scheduledAt);
    const status = normalizeStatus(delivery?.status);
    if (['completed', 'cancelled'].includes(status)) continue;
    const noCarrier = !normalizeText(delivery?.carrierId) && !normalizeText(delivery?.carrierName) && !normalizeText(delivery?.assignedCarrierId);
    if (!noCarrier && due !== todayKey && !(due && due < todayKey)) continue;
    tasks.push(makeTask({
      type: noCarrier ? 'deliveries.no_carrier' : due && due < todayKey ? 'deliveries.overdue' : 'deliveries.today',
      title: noCarrier ? 'Доставка без перевозчика' : due && due < todayKey ? 'Доставка просрочена' : 'Доставка сегодня',
      description: `${safeClientName(delivery?.client)} · ${safeEquipmentName(delivery?.equipment, delivery?.equipmentInv)}`,
      priority: due && due < todayKey ? 'high' : noCarrier ? 'medium' : 'low',
      dueDate: due,
      section: 'deliveries',
      entityType: 'deliveries',
      entityId: delivery?.id,
      clientId: delivery?.clientId,
      clientName: delivery?.client,
      responsible: delivery?.manager,
      actionUrl: '/deliveries',
      detectedAt: generatedAt,
    }));
  }

  const deduped = Array.from(new Map(tasks.map(task => [task.id, task])).values())
    .sort((left, right) =>
      ['critical', 'high', 'medium', 'low'].indexOf(left.priority) - ['critical', 'high', 'medium', 'low'].indexOf(right.priority)
      || compareDateKey(left.dueDate, right.dueDate)
      || left.title.localeCompare(right.title, 'ru')
    );

  return {
    generatedAt,
    permissions: {
      canViewFinance: canFinance,
    },
    summary: buildTasksCenterSummary(deduped, todayKey),
    tasks: deduped,
  };
}

function registerTasksCenterRoutes(deps) {
  const {
    readData,
    requireAuth,
    accessControl,
    canReadCollection,
    nowIso = () => new Date().toISOString(),
  } = deps;
  const router = express.Router();

  router.get('/tasks-center', requireAuth, (req, res) => {
    const request = {
      ...req,
      canReadCollection,
    };
    try {
      return res.json(buildTasksCenterPayload({
        readData,
        accessControl,
        req: request,
        nowIso,
      }));
    } catch (error) {
      return res.status(500).json({ ok: false, error: 'Не удалось сформировать центр задач' });
    }
  });

  return router;
}

module.exports = {
  buildTasksCenterPayload,
  registerTasksCenterRoutes,
};
