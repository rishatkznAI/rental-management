const { MECHANIC_ROLES, normalizeRole } = require('./role-groups');

const SALE_RECEIPT_STATUSES = [
  'planned_arrival',
  'arrived_waiting_acceptance',
  'acceptance_in_progress',
  'accepted',
  'acceptance_rejected',
  'cancelled',
];

const SALE_RECEIPT_STATUS_SET = new Set(SALE_RECEIPT_STATUSES);

const SALE_RECEIPT_LABELS = {
  planned_arrival: 'Планируется поступление',
  arrived_waiting_acceptance: 'Поступила, ожидает приёмки',
  acceptance_in_progress: 'Приёмка в работе',
  accepted: 'Принята',
  acceptance_rejected: 'Приёмка с замечаниями',
  cancelled: 'Отменено / не поступит',
};

const RECEIPT_STATUSES_REQUIRING_ACTUAL_ARRIVAL = new Set([
  'arrived_waiting_acceptance',
  'acceptance_in_progress',
  'accepted',
  'acceptance_rejected',
]);

const ACCEPTANCE_REQUIRED_PHOTOS = [
  'front',
  'rear',
  'left',
  'right',
  'serial_plate',
  'hour_meter',
  'lower_controls',
  'upper_controls',
  'platform',
  'engine_bay',
  'undercarriage',
];

const ACCEPTANCE_REQUIRED_CHECKLIST = [
  'serialNumberConfirmed',
  'modelConfirmed',
  'configurationChecked',
  'documentsReceived',
  'keysRemoteChargerSpareReceived',
  'visualDamageFound',
  'starts',
  'serviceRequired',
  'mechanicComment',
];

function normalizeSaleReceiptStatus(value) {
  const normalized = String(value || '').trim();
  return SALE_RECEIPT_STATUS_SET.has(normalized) ? normalized : undefined;
}

function hasValue(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (value && typeof value === 'object') return Object.keys(value).length > 0;
  if (typeof value === 'boolean') return true;
  return String(value || '').trim() !== '';
}

function photoBucketHasValue(value) {
  if (Array.isArray(value)) return value.some(hasValue);
  return hasValue(value);
}

function missingRequiredAcceptancePhotos(photos = {}) {
  const source = photos && typeof photos === 'object' ? photos : {};
  return ACCEPTANCE_REQUIRED_PHOTOS.filter(key => !photoBucketHasValue(source[key]));
}

function missingRequiredAcceptanceChecklist(checklist = {}) {
  const source = checklist && typeof checklist === 'object' ? checklist : {};
  return ACCEPTANCE_REQUIRED_CHECKLIST.filter(key => !hasValue(source[key]));
}

function normalizeAcceptancePhotos(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.entries(value).reduce((acc, [key, photos]) => {
    if (!ACCEPTANCE_REQUIRED_PHOTOS.includes(key) && key !== 'defects') return acc;
    acc[key] = Array.isArray(photos) ? photos.filter(hasValue) : (hasValue(photos) ? [photos] : []);
    return acc;
  }, {});
}

function normalizeAcceptanceChecklist(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return ACCEPTANCE_REQUIRED_CHECKLIST.reduce((acc, key) => {
    if (Object.prototype.hasOwnProperty.call(value, key)) acc[key] = value[key];
    return acc;
  }, {});
}

function normalizeAcceptanceDefects(value) {
  if (Array.isArray(value)) return value.filter(hasValue);
  if (!hasValue(value)) return [];
  return [value];
}

function buildReceiptHistoryEntry({ previousStatus, nextStatus, user, comment, nowIso }) {
  return {
    date: nowIso(),
    oldStatus: previousStatus || '',
    newStatus: nextStatus || '',
    oldStatusLabel: SALE_RECEIPT_LABELS[previousStatus] || 'Не указан',
    newStatusLabel: SALE_RECEIPT_LABELS[nextStatus] || 'Не указан',
    userId: user?.userId || '',
    userName: user?.userName || user?.name || 'Система',
    comment: String(comment || '').trim(),
  };
}

function normalizeEquipmentReceiptPatch(existing = {}, patch = {}, context = {}) {
  const nowIso = context.nowIso || (() => new Date().toISOString());
  const user = context.user || {};
  const role = normalizeRole(user.userRole || user.role || '');
  const next = { ...patch };
  const nextStatus = Object.prototype.hasOwnProperty.call(next, 'saleReceiptStatus')
    ? normalizeSaleReceiptStatus(next.saleReceiptStatus)
    : normalizeSaleReceiptStatus(existing.saleReceiptStatus);
  const previousStatus = normalizeSaleReceiptStatus(existing.saleReceiptStatus) || '';

  if (Object.prototype.hasOwnProperty.call(next, 'saleReceiptStatus')) {
    if (!nextStatus) {
      const error = new Error('Некорректный статус поступления техники.');
      error.status = 400;
      throw error;
    }
    next.saleReceiptStatus = nextStatus;
  }

  if (Object.prototype.hasOwnProperty.call(next, 'acceptancePhotos')) {
    next.acceptancePhotos = normalizeAcceptancePhotos(next.acceptancePhotos);
  }
  if (Object.prototype.hasOwnProperty.call(next, 'acceptanceChecklist')) {
    next.acceptanceChecklist = normalizeAcceptanceChecklist(next.acceptanceChecklist);
  }
  if (Object.prototype.hasOwnProperty.call(next, 'acceptanceDefects')) {
    next.acceptanceDefects = normalizeAcceptanceDefects(next.acceptanceDefects);
  }

  const effective = { ...existing, ...next };
  const effectiveStatus = normalizeSaleReceiptStatus(effective.saleReceiptStatus);

  if (effectiveStatus === 'arrived_waiting_acceptance' && !hasValue(effective.actualArrivalDate)) {
    next.actualArrivalDate = nowIso().slice(0, 10);
    effective.actualArrivalDate = next.actualArrivalDate;
  }

  if (effectiveStatus === 'acceptance_in_progress' && !hasValue(effective.actualArrivalDate)) {
    const error = new Error('Фактическая дата поступления обязательна перед началом приёмки.');
    error.status = 400;
    throw error;
  }

  if (effectiveStatus === 'acceptance_in_progress' && nextStatus !== previousStatus && role !== 'Администратор' && !MECHANIC_ROLES.includes(role)) {
    const error = new Error('Начать приёмку может только механик или администратор.');
    error.status = 403;
    throw error;
  }

  if (RECEIPT_STATUSES_REQUIRING_ACTUAL_ARRIVAL.has(effectiveStatus) && !hasValue(effective.actualArrivalDate)) {
    const error = new Error('Фактическая дата поступления обязательна для этого статуса.');
    error.status = 400;
    throw error;
  }

  if (effectiveStatus === 'accepted' || effectiveStatus === 'acceptance_rejected') {
    if (role !== 'Администратор' && !MECHANIC_ROLES.includes(role)) {
      const error = new Error('Завершить приёмку может только механик или администратор.');
      error.status = 403;
      throw error;
    }
    const missingPhotos = missingRequiredAcceptancePhotos(effective.acceptancePhotos);
    if (missingPhotos.length > 0) {
      const error = new Error(`Нельзя завершить приёмку без обязательных фото: ${missingPhotos.join(', ')}`);
      error.status = 400;
      throw error;
    }
    const missingChecklist = missingRequiredAcceptanceChecklist(effective.acceptanceChecklist);
    if (missingChecklist.length > 0) {
      const error = new Error(`Нельзя завершить приёмку без чеклиста: ${missingChecklist.join(', ')}`);
      error.status = 400;
      throw error;
    }
    if (effectiveStatus === 'accepted') {
      next.acceptedAt = effective.acceptedAt || nowIso();
      next.acceptedByUserId = effective.acceptedByUserId || user.userId || user.id || '';
      next.acceptedByName = effective.acceptedByName || user.userName || user.name || '';
      if (!next.acceptedByUserId || !next.acceptedByName || !next.acceptedAt) {
        const error = new Error('Для статуса «Принята» обязательны дата и пользователь приёмки.');
        error.status = 400;
        throw error;
      }
    }
  }

  if (nextStatus && nextStatus !== previousStatus) {
    const entry = buildReceiptHistoryEntry({
      previousStatus,
      nextStatus,
      user,
      comment: next.acceptanceComment || next.comment || '',
      nowIso,
    });
    next.receiptHistory = [
      ...(Array.isArray(existing.receiptHistory) ? existing.receiptHistory : []),
      entry,
    ];
  }

  return next;
}

function shouldCreateReceiptServiceTicket(previous = {}, next = {}) {
  return normalizeSaleReceiptStatus(previous.saleReceiptStatus) !== 'acceptance_rejected'
    && normalizeSaleReceiptStatus(next.saleReceiptStatus) === 'acceptance_rejected';
}

module.exports = {
  ACCEPTANCE_REQUIRED_CHECKLIST,
  ACCEPTANCE_REQUIRED_PHOTOS,
  SALE_RECEIPT_LABELS,
  SALE_RECEIPT_STATUSES,
  missingRequiredAcceptanceChecklist,
  missingRequiredAcceptancePhotos,
  normalizeEquipmentReceiptPatch,
  normalizeSaleReceiptStatus,
  shouldCreateReceiptServiceTicket,
};
