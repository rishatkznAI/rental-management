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

function normalizeRentalIdentifier(value) {
  if (value === undefined || value === null) return '';
  const normalized = String(value).trim();
  if (!normalized || normalized === 'undefined' || normalized === 'null') return '';
  return normalized;
}

function sameRentalIdentifier(left, right) {
  const normalizedLeft = normalizeRentalIdentifier(left);
  const normalizedRight = normalizeRentalIdentifier(right);
  return Boolean(normalizedLeft && normalizedRight && normalizedLeft === normalizedRight);
}

function uniqueIdentifiers(values) {
  return [...new Set((values || []).map(normalizeRentalIdentifier).filter(Boolean))];
}

function rentalLinkIdsFromGantt(ganttRental) {
  return uniqueIdentifiers([
    ganttRental?.rentalId,
    ganttRental?.sourceRentalId,
    ganttRental?.originalRentalId,
    ganttRental?.classicRentalId,
    ganttRental?.entityId,
    ganttRental?.approvalEntityId,
  ]);
}

function rentalEquipmentRefs(rental) {
  return uniqueIdentifiers([
    rental?.equipmentId,
    rental?.equipmentInv,
    rental?.inventoryNumber,
    ...(Array.isArray(rental?.equipment) ? rental.equipment : []),
  ]);
}

function normalizedText(value) {
  return String(value || '').trim().toLowerCase();
}

function ganttMatchesClassicRental(ganttRental, rental) {
  if (!ganttRental || !rental) return false;

  const linkedIds = rentalLinkIdsFromGantt(ganttRental);
  if (linkedIds.length > 0) {
    if (linkedIds.some(id => sameRentalIdentifier(id, rental.id))) return true;
  }

  const ganttClientId = normalizeRentalIdentifier(ganttRental.clientId);
  const rentalClientId = normalizeRentalIdentifier(rental.clientId);
  const sameClient = ganttClientId && rentalClientId
    ? ganttClientId === rentalClientId
    : normalizedText(ganttRental.client) === normalizedText(rental.client);
  if (!sameClient) return false;

  const sameDates =
    String(rental.startDate || '') === String(ganttRental.startDate || '') &&
    String(rental.plannedReturnDate || rental.endDate || '') === String(ganttRental.endDate || ganttRental.plannedReturnDate || '');
  if (!sameDates) return false;

  const ganttRefs = rentalEquipmentRefs(ganttRental);
  const classicRefs = rentalEquipmentRefs(rental);
  return ganttRefs.some(ref => classicRefs.includes(ref));
}

function uniqueRentalMatches(matches) {
  const byId = new Map();
  for (const match of matches || []) {
    const id = normalizeRentalIdentifier(match?.rental?.id);
    if (!id || byId.has(id)) continue;
    byId.set(id, match);
  }
  return [...byId.values()];
}

function findRentalsByIds(rentals, ids) {
  const normalizedIds = uniqueIdentifiers(ids);
  if (normalizedIds.length === 0) return [];
  return (rentals || [])
    .map((rental, index) => ({ rental, index }))
    .filter(({ rental }) => normalizedIds.some(id => sameRentalIdentifier(id, rental?.id)));
}

function buildRentalResolutionFailure(status, message, searchedIds) {
  return {
    ok: false,
    status,
    error: message,
    details: {
      searchedIds: uniqueIdentifiers(searchedIds),
      searchedCollections: [
        'rentals.id',
        'gantt_rentals.id',
        'gantt_rentals.rentalId',
        'gantt_rentals.sourceRentalId',
        'gantt_rentals.originalRentalId',
      ],
    },
  };
}

function buildRentalResolutionSuccess(match, sourceRentalId, linkedGanttRental) {
  const sourceId = normalizeRentalIdentifier(sourceRentalId);
  return {
    ok: true,
    rental: match.rental,
    rentalIndex: match.index,
    rentalId: normalizeRentalIdentifier(match.rental?.id),
    sourceRentalId: sourceId && !sameRentalIdentifier(sourceId, match.rental?.id) ? sourceId : '',
    linkedGanttRental: linkedGanttRental || null,
    linkedGanttRentalId: normalizeRentalIdentifier(linkedGanttRental?.id),
  };
}

function resolveRentalForChangeRequest({
  rentalId,
  linkedGanttRentalId,
  rentals = [],
  ganttRentals = [],
} = {}) {
  const requestedRentalId = normalizeRentalIdentifier(rentalId);
  const requestedGanttId = normalizeRentalIdentifier(linkedGanttRentalId);
  const searchedIds = uniqueIdentifiers([requestedRentalId, requestedGanttId]);

  if (!requestedRentalId && !requestedGanttId) {
    return buildRentalResolutionFailure(
      400,
      'Не передан rentalId для согласования аренды.',
      searchedIds,
    );
  }

  const directMatches = findRentalsByIds(rentals, [requestedRentalId]);
  if (directMatches.length === 1) {
    const linkedGanttRental = (ganttRentals || []).find(item => sameRentalIdentifier(item?.id, requestedGanttId)) || null;
    return buildRentalResolutionSuccess(directMatches[0], requestedRentalId, linkedGanttRental);
  }
  if (directMatches.length > 1) {
    return buildRentalResolutionFailure(
      409,
      `Найдено несколько карточек аренды с id "${requestedRentalId}". Откройте карточку аренды вручную.`,
      searchedIds,
    );
  }

  const ganttCandidates = uniqueRentalMatches((ganttRentals || [])
    .map((ganttRental, index) => ({ rental: ganttRental, index }))
    .filter(({ rental: ganttRental }) => {
      const byGanttId =
        sameRentalIdentifier(ganttRental?.id, requestedGanttId) ||
        sameRentalIdentifier(ganttRental?.id, requestedRentalId);
      const byLinkedId = rentalLinkIdsFromGantt(ganttRental)
        .some(id => sameRentalIdentifier(id, requestedRentalId));
      return byGanttId || byLinkedId;
    }));

  const linkedIds = uniqueIdentifiers(ganttCandidates.flatMap(({ rental: ganttRental }) => rentalLinkIdsFromGantt(ganttRental)));
  const explicitMatches = findRentalsByIds(rentals, linkedIds);
  if (explicitMatches.length === 1) {
    const linkedGanttRental = ganttCandidates.find(({ rental: ganttRental }) =>
      rentalLinkIdsFromGantt(ganttRental).some(id => sameRentalIdentifier(id, explicitMatches[0].rental.id)),
    )?.rental || ganttCandidates[0]?.rental || null;
    return buildRentalResolutionSuccess(
      explicitMatches[0],
      requestedRentalId || requestedGanttId || linkedGanttRental?.id,
      linkedGanttRental,
    );
  }
  if (explicitMatches.length > 1) {
    return buildRentalResolutionFailure(
      409,
      `Найдено несколько карточек аренды по связи gantt_rentals для id "${requestedRentalId || requestedGanttId}". Откройте карточку аренды вручную.`,
      [...searchedIds, ...linkedIds],
    );
  }
  if (linkedIds.length > 0) {
    return buildRentalResolutionFailure(
      404,
      `Связанная карточка аренды для "${requestedRentalId || requestedGanttId}" не найдена: в gantt_rentals указана связь ${linkedIds.join(', ')}, но такой rentals.id нет.`,
      [...searchedIds, ...linkedIds],
    );
  }

  const shapeMatches = uniqueRentalMatches(ganttCandidates.flatMap(({ rental: ganttRental }) =>
    (rentals || [])
      .map((rental, index) => ({ rental, index, linkedGanttRental: ganttRental }))
      .filter(({ rental }) => ganttMatchesClassicRental(ganttRental, rental)),
  ));
  if (shapeMatches.length === 1) {
    return buildRentalResolutionSuccess(
      shapeMatches[0],
      requestedRentalId || requestedGanttId || shapeMatches[0].linkedGanttRental?.id,
      shapeMatches[0].linkedGanttRental,
    );
  }
  if (shapeMatches.length > 1) {
    return buildRentalResolutionFailure(
      409,
      `Найдено несколько похожих карточек аренды для id "${requestedRentalId || requestedGanttId}". Откройте карточку аренды вручную.`,
      [...searchedIds, ...linkedIds],
    );
  }

  return buildRentalResolutionFailure(
    404,
    `Не найдена карточка аренды для согласования: id "${requestedRentalId || requestedGanttId}", искали в rentals.id и связях gantt_rentals.`,
    [...searchedIds, ...linkedIds],
  );
}

function stripRentalPatchMeta(body = {}) {
  const {
    __linkedGanttRentalId,
    __sourceRentalId,
    __rentalId,
    __changeReason,
    __changeComment,
    __changeAttachments,
    linkedGanttRentalId,
    sourceRentalId,
    rentalId,
    changeRequestSummary,
    ...patch
  } = body || {};

  return {
    patch,
    meta: {
      rentalId: __rentalId || rentalId || '',
      sourceRentalId: __sourceRentalId || sourceRentalId || '',
      linkedGanttRentalId: __linkedGanttRentalId || linkedGanttRentalId || '',
      reason: __changeReason || '',
      comment: __changeComment || '',
      attachments: Array.isArray(__changeAttachments) ? __changeAttachments : [],
    },
  };
}

function hasGanttRentalLink(ganttRental) {
  return rentalLinkIdsFromGantt(ganttRental).length > 0;
}

function compactGanttRentalProblem(ganttRental, resolution) {
  return {
    id: normalizeRentalIdentifier(ganttRental?.id),
    client: ganttRental?.client || '',
    clientId: normalizeRentalIdentifier(ganttRental?.clientId),
    startDate: ganttRental?.startDate || '',
    endDate: ganttRental?.endDate || ganttRental?.plannedReturnDate || '',
    equipmentId: normalizeRentalIdentifier(ganttRental?.equipmentId),
    equipmentInv: normalizeRentalIdentifier(ganttRental?.equipmentInv),
    status: resolution?.status || 0,
    error: resolution?.error || 'Не удалось восстановить связь с rentals.',
  };
}

function logGanttRentalLinkProblems(logger, label, list) {
  if (!logger || typeof logger.warn !== 'function' || !list.length) return;
  logger.warn(`[rental-links] ${label}: ${list.length}`);
  for (const item of list.slice(0, 20)) {
    logger.warn(
      `[rental-links] ${label}: id=${item.id || '—'} client="${item.client || '—'}" ` +
      `period=${item.startDate || '—'}..${item.endDate || '—'} equipment=${item.equipmentInv || item.equipmentId || '—'} ` +
      `reason="${item.error}"`,
    );
  }
  if (list.length > 20) {
    logger.warn(`[rental-links] ${label}: ещё ${list.length - 20} записей скрыто из лога`);
  }
}

function backfillGanttRentalLinks({ readData, writeData, logger = console, dryRun = false } = {}) {
  const rentals = typeof readData === 'function' ? (readData('rentals') || []) : [];
  const ganttRentals = typeof readData === 'function' ? (readData('gantt_rentals') || []) : [];
  const result = {
    checked: Array.isArray(ganttRentals) ? ganttRentals.length : 0,
    missingLink: 0,
    linked: 0,
    ambiguous: [],
    unresolved: [],
    dryRun: Boolean(dryRun),
  };

  if (!Array.isArray(ganttRentals) || ganttRentals.length === 0) return result;

  let changed = false;
  const nextGanttRentals = ganttRentals.map(ganttRental => {
    if (!ganttRental || hasGanttRentalLink(ganttRental)) return ganttRental;
    result.missingLink += 1;

    const resolution = resolveRentalForChangeRequest({
      rentalId: ganttRental.id,
      linkedGanttRentalId: ganttRental.id,
      rentals,
      ganttRentals: [ganttRental],
    });

    if (resolution.ok && resolution.rentalId) {
      result.linked += 1;
      changed = true;
      return { ...ganttRental, rentalId: resolution.rentalId };
    }

    const problem = compactGanttRentalProblem(ganttRental, resolution);
    if (resolution.status === 409) {
      result.ambiguous.push(problem);
    } else {
      result.unresolved.push(problem);
    }
    return ganttRental;
  });

  if (changed && !dryRun && typeof writeData === 'function') {
    writeData('gantt_rentals', nextGanttRentals);
  }

  if (result.linked > 0 && logger && typeof logger.log === 'function') {
    logger.log(`[rental-links] Gantt rental backfill: linked ${result.linked}/${result.missingLink}`);
  }
  logGanttRentalLinkProblems(logger, 'Неоднозначная связь gantt_rentals', result.ambiguous);
  logGanttRentalLinkProblems(logger, 'Не найдена связь gantt_rentals', result.unresolved);

  return result;
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
  sourceRentalId,
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
    entityId: rental.id,
    rentalId: rental.id,
    sourceRentalId: sourceRentalId || '',
    linkedGanttRentalId: linkedGanttRentalId || '',
    clientId: rental.clientId || '',
    client: rental.client,
    equipment: Array.isArray(rental.equipment) ? rental.equipment : [],
    requestedBy: initiator?.userId || '',
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
    oldValues: { [change.field]: change.oldValue },
    newValues: { [change.field]: change.newValue },
    changes: [{
      field: change.field,
      label: change.label,
      oldValue: change.oldValue,
      newValue: change.newValue,
      type: change.type,
      reason: change.reason,
    }],
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

function buildRentalPendingApprovalHistoryEntries(requests = [], author) {
  return (requests || []).map(request => createRentalHistoryEntry(
    author,
    `Изменение отправлено на согласование: ${request.fieldLabel || getFieldLabel(request.field)}: ${displayValue(request.oldValue)} → ${displayValue(request.newValue)}`,
  ));
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
  backfillGanttRentalLinks,
  buildRentalChangeRequest,
  buildRentalImmediateHistoryEntries,
  buildRentalPendingApprovalHistoryEntries,
  buildRequestDecisionNotificationStatus,
  calculateFinancialImpact,
  calculateRentalDebt,
  classifyRentalFieldChange,
  displayValue,
  getChangedFields,
  getFieldLabel,
  normalizeRentalIdentifier,
  resolveRentalForChangeRequest,
  splitRentalPatch,
  stripRentalPatchMeta,
  syncGanttRentalFields,
  valuesEqual,
};
