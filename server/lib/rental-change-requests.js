const { createRentalHistoryEntry } = require('./audit-history');

const RENTAL_CHANGE_REQUEST_STATUS = {
  PENDING: 'pending',
  APPROVED: 'approved',
  REJECTED: 'rejected',
};

const RENTAL_CHANGE_FIELD_LABELS = {
  clientId: 'Клиент',
  client: 'Клиент',
  contact: 'Контактное лицо',
  manager: 'Менеджер',
  startDate: 'Дата начала',
  plannedReturnDate: 'Плановый возврат',
  actualReturnDate: 'Фактический возврат',
  equipment: 'Техника',
  rate: 'Тариф',
  price: 'Стоимость аренды',
  discount: 'Скидка',
  deliveryAddress: 'Адрес доставки',
  deliveryTime: 'Время доставки',
  status: 'Статус аренды',
  comments: 'Комментарий',
  documents: 'Документы',
  internalNotes: 'Внутренние заметки',
  photos: 'Фото',
  attachments: 'Вложения',
  downtimeDays: 'Простой техники',
  downtimeReason: 'Причина простоя',
  writeOffDays: 'Списание дней аренды',
  waivedDays: 'Списание дней аренды',
};

const PROTECTED_KEYWORDS = [
  'downtime',
  'writeoff',
  'writeOff',
  'waived',
  'waiver',
  'paymentAdjustment',
];

function nowIso() {
  return new Date().toISOString();
}

function toDate(value) {
  if (!value) return null;
  const date = new Date(`${String(value).slice(0, 10)}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function todayKey() {
  return nowIso().slice(0, 10);
}

function normalizeComparable(value) {
  if (value === undefined || value === null || value === '') return null;
  if (Array.isArray(value)) return value.map(item => normalizeComparable(item));
  if (typeof value === 'object') {
    return Object.keys(value).sort().reduce((acc, key) => {
      acc[key] = normalizeComparable(value[key]);
      return acc;
    }, {});
  }
  return value;
}

function valuesEqual(a, b) {
  return JSON.stringify(normalizeComparable(a)) === JSON.stringify(normalizeComparable(b));
}

function displayValue(value) {
  if (value === undefined || value === null || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.join(', ') : '—';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value).trim() || '—';
}

function getFieldLabel(field) {
  return RENTAL_CHANGE_FIELD_LABELS[field] || field;
}

function getChangedFields(previous, patch) {
  return Object.keys(patch || {}).filter(field => !valuesEqual(previous?.[field], patch[field]));
}

function stripRentalPatchMeta(body = {}) {
  const {
    __linkedGanttRentalId,
    __changeReason,
    __changeComment,
    __changeAttachments,
    linkedGanttRentalId,
    changeRequestSummary,
    ...patch
  } = body || {};

  return {
    patch,
    meta: {
      linkedGanttRentalId: __linkedGanttRentalId || linkedGanttRentalId || '',
      reason: __changeReason || '',
      comment: __changeComment || '',
      attachments: Array.isArray(__changeAttachments) ? __changeAttachments : [],
    },
  };
}

function calculateRentalDebt(rental, payments = []) {
  if (!rental) return 0;
  const paidAmount = (payments || [])
    .filter(payment => payment.rentalId === rental.id)
    .reduce((sum, payment) => sum + (payment.paidAmount ?? (payment.status === 'paid' ? payment.amount : 0)), 0);
  return Math.max((Number(rental.price) || 0) - (Number(rental.discount) || 0) - paidAmount, 0);
}

function hasProtectedKeyword(field) {
  return PROTECTED_KEYWORDS.some(keyword => field.includes(keyword));
}

function isDocumentsAdditionOnly(previous = [], next = []) {
  if (!Array.isArray(previous) || !Array.isArray(next)) return false;
  return previous.every(item => next.includes(item)) && next.length >= previous.length;
}

function classifyRentalFieldChange({ previousRental, field, newValue, payments = [], today = todayKey() }) {
  const oldValue = previousRental?.[field];

  if (hasProtectedKeyword(field)) {
    return {
      mode: 'approval',
      type: 'Простой / списание дней',
      reason: 'Изменение простоя или списания дней требует согласования администратора.',
    };
  }

  if (field === 'price') {
    return { mode: 'approval', type: 'Изменение цены', reason: 'Изменение стоимости аренды требует согласования.' };
  }

  if (field === 'discount') {
    return { mode: 'approval', type: 'Изменение скидки', reason: 'Изменение скидки требует согласования.' };
  }

  if (field === 'rate') {
    return { mode: 'approval', type: 'Изменение тарифа', reason: 'Изменение коммерческих условий требует согласования.' };
  }

  if (field === 'startDate') {
    return { mode: 'approval', type: 'Изменение дат задним числом', reason: 'Дата начала аренды меняет уже согласованный период.' };
  }

  if (field === 'plannedReturnDate') {
    const oldDate = toDate(oldValue);
    const nextDate = toDate(newValue);
    const todayDate = toDate(today);
    if (!oldDate || !nextDate) {
      return { mode: 'approval', type: 'Изменение дат', reason: 'Изменение периода аренды требует проверки.' };
    }
    if (todayDate && nextDate < todayDate) {
      return { mode: 'approval', type: 'Изменение дат задним числом', reason: 'Новая дата возврата находится в прошлом.' };
    }
    if (nextDate < oldDate) {
      return { mode: 'approval', type: 'Сокращение аренды', reason: 'Сокращение аренды требует согласования.' };
    }
    return { mode: 'immediate', type: 'Продление аренды', reason: 'Продление применяется сразу после проверки конфликтов.' };
  }

  if (field === 'actualReturnDate') {
    const nextDate = toDate(newValue);
    const todayDate = toDate(today);
    if (nextDate && todayDate && nextDate < todayDate) {
      return { mode: 'approval', type: 'Изменение дат задним числом', reason: 'Фактическая дата возврата находится в прошлом.' };
    }
    return { mode: 'immediate', type: 'Фактический возврат', reason: 'Актуальная дата возврата применяется сразу.' };
  }

  if (field === 'status') {
    if (newValue === 'closed' && calculateRentalDebt(previousRental, payments) > 0) {
      return { mode: 'approval', type: 'Закрытие аренды с долгом', reason: 'Закрытие аренды при задолженности требует согласования.' };
    }
    return { mode: 'immediate', type: 'Изменение статуса', reason: 'Статус аренды применяется сразу.' };
  }

  if ((field === 'client' || field === 'clientId') && previousRental?.status === 'active') {
    return { mode: 'approval', type: 'Изменение клиента в активной аренде', reason: 'Клиент в активной аренде меняется только через согласование.' };
  }

  if (field === 'equipment' && previousRental?.status === 'active') {
    return { mode: 'approval', type: 'Изменение техники в активной аренде', reason: 'Техника в активной аренде меняется только через согласование.' };
  }

  if (field === 'documents') {
    if (isDocumentsAdditionOnly(oldValue || [], newValue || [])) {
      return { mode: 'immediate', type: 'Добавление документов', reason: 'Добавление документов применяется сразу.' };
    }
    return { mode: 'approval', type: 'Удаление документов', reason: 'Удаление или корректировка документов требует согласования.' };
  }

  if (field === 'comments') {
    return { mode: 'immediate', type: 'Комментарий', reason: 'Комментарии применяются сразу.' };
  }

  if (field === 'photos' || field === 'attachments' || field === 'internalNotes') {
    return { mode: 'immediate', type: field === 'photos' ? 'Прикрепление фото' : field === 'internalNotes' ? 'Внутренние заметки' : 'Вложения', reason: 'Операционное дополнение применяется сразу.' };
  }

  return { mode: 'immediate', type: 'Операционное изменение', reason: 'Изменение не относится к списку обязательных согласований.' };
}

function splitRentalPatch({ previousRental, patch, payments = [], today = todayKey() }) {
  const immediatePatch = {};
  const approvalChanges = [];

  for (const field of getChangedFields(previousRental, patch)) {
    const classification = classifyRentalFieldChange({
      previousRental,
      field,
      newValue: patch[field],
      payments,
      today,
    });

    if (classification.mode === 'approval') {
      approvalChanges.push({
        field,
        label: getFieldLabel(field),
        oldValue: previousRental?.[field],
        newValue: patch[field],
        type: classification.type,
        reason: classification.reason,
      });
    } else {
      immediatePatch[field] = patch[field];
    }
  }

  return { immediatePatch, approvalChanges };
}

function calculateFinancialImpact(previousRental, field, newValue) {
  const oldPrice = Number(previousRental?.price) || 0;
  const oldDiscount = Number(previousRental?.discount) || 0;
  const oldTotal = oldPrice - oldDiscount;
  const nextPrice = field === 'price' ? Number(newValue) || 0 : oldPrice;
  const nextDiscount = field === 'discount' ? Number(newValue) || 0 : oldDiscount;
  const nextTotal = nextPrice - nextDiscount;
  const amount = nextTotal - oldTotal;

  if (field === 'price' || field === 'discount' || field === 'rate') {
    return {
      amount,
      description: amount === 0
        ? 'Без прямого изменения суммы'
        : `${amount > 0 ? '+' : ''}${amount}`,
    };
  }

  return {
    amount: 0,
    description: 'Без прямого изменения суммы',
  };
}

function buildRentalChangeRequest({
  id,
  rental,
  linkedGanttRentalId,
  change,
  initiator,
  reason,
  comment,
  attachments,
}) {
  const createdAt = nowIso();
  return {
    id,
    entityType: 'rental',
    rentalId: rental.id,
    linkedGanttRentalId: linkedGanttRentalId || '',
    clientId: rental.clientId || '',
    client: rental.client,
    equipment: Array.isArray(rental.equipment) ? rental.equipment : [],
    initiatorId: initiator?.userId || '',
    initiatorName: initiator?.userName || 'Система',
    initiatorRole: initiator?.userRole || '',
    createdAt,
    status: RENTAL_CHANGE_REQUEST_STATUS.PENDING,
    statusLabel: buildRequestDecisionNotificationStatus(RENTAL_CHANGE_REQUEST_STATUS.PENDING),
    type: change.type,
    field: change.field,
    fieldLabel: change.label,
    oldValue: change.oldValue,
    newValue: change.newValue,
    reason: String(reason || '').trim() || change.reason,
    systemReason: change.reason,
    comment: String(comment || '').trim(),
    attachments: Array.isArray(attachments) ? attachments : [],
    financialImpact: calculateFinancialImpact(rental, change.field, change.newValue),
  };
}

function buildRentalImmediateHistoryEntries(previousRental, nextRental, author) {
  const entries = [];
  for (const field of getChangedFields(previousRental, nextRental)) {
    if (field === 'history') continue;
    entries.push(createRentalHistoryEntry(
      author,
      `Изменение применено сразу: ${getFieldLabel(field)}: ${displayValue(previousRental?.[field])} → ${displayValue(nextRental?.[field])}`,
    ));
  }
  return entries;
}

function appendRentalHistory(rental, entries = []) {
  if (!entries.length) return rental;
  return {
    ...rental,
    history: [...(rental.history || []), ...entries],
  };
}

function managerInitials(name = '') {
  const trimmed = String(name || '').trim();
  if (!trimmed) return '—';
  return trimmed.split(/\s+/).map(part => part[0] || '').join('').slice(0, 2).toUpperCase();
}

function rentalStatusToGanttStatus(status) {
  if (status === 'closed') return 'closed';
  if (status === 'active') return 'active';
  return 'created';
}

function applyRentalFieldToGantt(ganttRental, field, value) {
  if (!ganttRental) return ganttRental;
  if (field === 'clientId') return { ...ganttRental, clientId: value };
  if (field === 'client') {
    return { ...ganttRental, client: value, clientShort: String(value || '').substring(0, 20) };
  }
  if (field === 'startDate') return { ...ganttRental, startDate: value };
  if (field === 'plannedReturnDate') return { ...ganttRental, endDate: value };
  if (field === 'manager') return { ...ganttRental, manager: value, managerInitials: managerInitials(value) };
  if (field === 'status') return { ...ganttRental, status: rentalStatusToGanttStatus(value) };
  if (field === 'price') return { ...ganttRental, amount: Number(value) || 0 };
  return ganttRental;
}

function syncGanttRentalFields(ganttRental, previousRental, nextRental, author) {
  if (!ganttRental) return ganttRental;
  let nextGantt = { ...ganttRental };
  const entries = [];
  for (const field of getChangedFields(previousRental, nextRental)) {
    const beforeGantt = nextGantt;
    nextGantt = applyRentalFieldToGantt(nextGantt, field, nextRental?.[field]);
    if (beforeGantt !== nextGantt) {
      entries.push(createRentalHistoryEntry(
        author,
        `Карточка аренды обновила планировщик: ${getFieldLabel(field)}: ${displayValue(previousRental?.[field])} → ${displayValue(nextRental?.[field])}`,
      ));
    }
  }
  if (!entries.length) return nextGantt;
  return {
    ...nextGantt,
    comments: [...(nextGantt.comments || []), ...entries],
  };
}

function applyApprovedRentalChangeToGantt(ganttRental, request, author) {
  if (!ganttRental) return ganttRental;
  const nextGantt = applyRentalFieldToGantt(ganttRental, request.field, request.newValue);
  if (nextGantt === ganttRental) return nextGantt;
  return {
    ...nextGantt,
    comments: [
      ...(nextGantt.comments || []),
      createRentalHistoryEntry(
        author,
        `Согласовано и применено: ${request.fieldLabel || getFieldLabel(request.field)}: ${displayValue(request.oldValue)} → ${displayValue(request.newValue)}`,
      ),
    ],
  };
}

function buildRequestDecisionNotificationStatus(status) {
  if (status === RENTAL_CHANGE_REQUEST_STATUS.APPROVED) return 'Согласовано / Применено';
  if (status === RENTAL_CHANGE_REQUEST_STATUS.REJECTED) return 'Отклонено';
  return 'На согласовании';
}

module.exports = {
  RENTAL_CHANGE_REQUEST_STATUS,
  RENTAL_CHANGE_FIELD_LABELS,
  appendRentalHistory,
  applyApprovedRentalChangeToGantt,
  buildRentalChangeRequest,
  buildRentalImmediateHistoryEntries,
  buildRequestDecisionNotificationStatus,
  calculateFinancialImpact,
  calculateRentalDebt,
  classifyRentalFieldChange,
  displayValue,
  getChangedFields,
  getFieldLabel,
  splitRentalPatch,
  stripRentalPatchMeta,
  syncGanttRentalFields,
  valuesEqual,
};
