const express = require('express');
const crypto = require('crypto');
const {
  appendRentalHistory,
  buildRentalChangeRequest,
  buildRentalImmediateHistoryEntries,
  buildRentalPendingApprovalHistoryEntries,
  displayValue,
  ensureGanttRentalLink,
  getFieldLabel,
  resolveGanttRentalLink,
  resolveRentalForChangeRequest,
  splitRentalPatch,
  stripRentalPatchMeta,
  syncGanttRentalFields,
} = require('../lib/rental-change-requests');
const { normalizeClientRelationLinks } = require('../lib/client-relations');
const {
  RENTAL_MUTATION_PROTECTED_FIELDS,
  canonicalizeRentalCreatePayload,
  canonicalizeRentalPatch,
  rentalServerOwnedAuditFields,
  rentalMutationProtectedFields,
  strictRentalDate,
  stripRentalServerOwnedAuditFields,
} = require('../lib/rental-data-integrity');
const { buildClientFinancialSnapshots } = require('../lib/finance-core');
const { assertPaymentAllocationPersistenceEntriesSafe } = require('../lib/payment-counterparty-relations');
const { rentalMatchesEquipment } = require('../lib/rental-validation');
const {
  affectedEquipmentIdsForRentals,
  findEquipmentForRental: findLifecycleEquipmentForRental,
  reconcileEquipmentRentalProjection,
  validateRentalLifecycleAvailability,
  validateTerminalRentalTransition,
} = require('../lib/rental-lifecycle');
const { LEGACY_AUDIT_COLLECTION, redactAuditValue } = require('../lib/security-audit');
const {
  cancelRentalDowntime,
  createRentalDowntime,
  normalizeRentalDowntimePeriods,
  updateRentalDowntime,
} = require('../lib/rental-downtime-periods');
const {
  linkedRentalIds,
  isStandalonePlannerRow,
  validateGanttRentalLinkRequirement,
} = require('../lib/gantt-rental-link-guard');
const {
  buildPaginatedResponse,
  itemMatchesSearch,
  wantsPaginatedResponse,
} = require('../lib/pagination');
const {
  SYSTEM_FIXTURE_PROTECTED_CODE,
  SYSTEM_FIXTURE_PROTECTED_MESSAGE,
  assertProductionSmokeFixtureMutationAllowed,
  createSystemFixtureProtectedError,
  isProductionSmokeEquipmentFixture,
} = require('../lib/protected-fixtures');

const AUDIT_COLLECTION = 'audit_logs';
const RENTAL_CREATE_IDEMPOTENCY_COLLECTION = 'rental_create_idempotency';
const RENTAL_AUDIT_LIMIT = 20;
const CLOSED_RENTAL_STATUSES = new Set(['closed', 'returned', 'cancelled', 'canceled', 'completed']);
const RENTAL_PLANNER_SYNC_FIELDS = new Set([
  ...RENTAL_MUTATION_PROTECTED_FIELDS,
  'counterpartyId',
  'clientId',
  'client',
  'objectId',
  'objectName',
  'objectAddress',
  'objectContactName',
  'objectContactPhone',
  'contractId',
  'contractNumber',
  'equipmentId',
  'equipmentInv',
  'inventoryNumber',
  'serialNumber',
  'equipment',
  'managerId',
  'manager',
  'status',
  'paymentStatus',
  'updSigned',
  'updDate',
  'comments',
]);
const RENTAL_AUDIT_FINANCE_FIELDS = new Set([
  'amount',
  'paidAmount',
  'paymentStatus',
  'price',
  'discount',
  'rate',
  'debt',
  'currency',
]);
const RENTAL_AUDIT_FIELD_LABELS = {
  id: 'ID',
  client: 'Клиент',
  clientId: 'ID клиента',
  counterpartyId: 'ID контрагента',
  rental: 'Аренда',
  rentalId: 'ID аренды',
  equipment: 'Техника',
  equipmentId: 'ID техники',
  equipmentInv: 'Инв. номер',
  inventoryNumber: 'Инв. номер',
  manager: 'Менеджер',
  managerId: 'ID менеджера',
  startDate: 'Дата начала',
  endDate: 'Дата окончания',
  plannedReturnDate: 'Плановая дата возврата',
  actualReturnDate: 'Фактическая дата возврата',
  returnDate: 'Дата возврата',
  status: 'Статус',
  paymentStatus: 'Статус оплаты',
  amount: 'Сумма',
  price: 'Цена',
  discount: 'Скидка',
  rate: 'Ставка',
  hasDamage: 'Повреждения',
  serviceTicketId: 'Сервисная заявка',
  equipmentStatus: 'Статус техники',
};

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter(key => value[key] !== undefined)
      .sort()
      .map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function rentalCreateFingerprint(input) {
  return crypto.createHash('sha256').update(stableJson(input)).digest('hex');
}

function readRentalCreateIdempotencyKey(req, collection) {
  if (collection !== 'rentals') return '';
  const key = String(req.get('Idempotency-Key') || '').trim();
  if (!key) return '';
  if (!/^[A-Za-z0-9._:-]{8,128}$/.test(key)) {
    const error = new Error('Idempotency-Key должен содержать от 8 до 128 безопасных символов.');
    error.status = 400;
    error.code = 'INVALID_IDEMPOTENCY_KEY';
    throw error;
  }
  return key;
}

function sendSystemFixtureProtectedError(req, res, auditLog, error) {
  auditLog?.(req, {
    action: `equipment.${error?.action || 'mutation'}.blocked`,
    entityType: 'equipment',
    entityId: error?.equipmentId,
    metadata: {
      reason: 'blocked_system_fixture_mutation',
      equipmentId: error?.equipmentId,
      userEmail: req.user?.email || null,
      attemptedFields: Array.isArray(error?.attemptedFields) ? error.attemptedFields : [],
      violations: Array.isArray(error?.violations) ? error.violations : [],
    },
  });
  return res.status(409).json({
    ok: false,
    code: SYSTEM_FIXTURE_PROTECTED_CODE,
    error: SYSTEM_FIXTURE_PROTECTED_MESSAGE,
    attemptedFields: Array.isArray(error?.attemptedFields) ? error.attemptedFields : [],
    violations: Array.isArray(error?.violations) ? error.violations : [],
  });
}

function sendRentalPayloadValidationError(res, error) {
  return res.status(error?.status || 400).json({
    ok: false,
    code: error?.code || 'RENTAL_PAYLOAD_VALIDATION_FAILED',
    error: error?.message || 'Некорректные данные аренды.',
    field: error?.field,
    fieldErrors: error?.fieldErrors,
  });
}

function sendRentalLifecycleError(res, validation) {
  return res.status(validation?.status || 409).json({
    ok: false,
    code: validation?.code || 'RENTAL_LIFECYCLE_CONFLICT',
    error: validation?.error || 'Конфликт жизненного цикла аренды.',
    field: validation?.field,
    fieldErrors: validation?.fieldErrors,
  });
}

function isTerminalRentalStatus(status) {
  return ['returned', 'closed', 'cancelled'].includes(String(status || '').trim().toLowerCase());
}

const RENTAL_PAGINATION_CONFIG = {
  searchFields: ['id', 'client', 'clientName', 'clientId', 'equipmentInv', 'equipment', 'manager', 'managerName', 'objectName', 'contractNumber'],
  sortFields: {
    startDate: item => item.startDate,
    endDate: item => item.endDate || item.plannedReturnDate,
    plannedReturnDate: item => item.plannedReturnDate || item.endDate,
    client: item => item.clientName || item.client,
    status: item => item.status,
    manager: item => item.managerName || item.manager,
    amount: item => Number(item.amount || item.totalAmount || 0),
    createdAt: item => item.createdAt || item.id,
  },
  defaultSort: { sortBy: 'startDate', sortDir: 'desc' },
};

function isActiveRentalForSummary(item) {
  return !isClosedRentalStatus(item?.status) && !item?.actualReturnDate;
}

function buildRentalsSummary(rows, today = new Date().toISOString().slice(0, 10)) {
  const active = rows.filter(isActiveRentalForSummary);
  return {
    total: rows.length,
    active: active.length,
    created: rows.filter(item => String(item?.status || '') === 'created').length,
    returned: rows.filter(item => String(item?.status || '') === 'returned').length,
    closed: rows.filter(item => isClosedRentalStatus(item?.status)).length,
    overdueReturns: active.filter(item => String(item?.plannedReturnDate || item?.endDate || '').slice(0, 10) < today).length,
    returnsToday: active.filter(item => String(item?.plannedReturnDate || item?.endDate || '').slice(0, 10) === today).length,
    unpaid: rows.filter(item => String(item?.paymentStatus || '') !== 'paid').length,
  };
}

function filterRentalsForPagination(data, query) {
  let rows = Array.isArray(data) ? data : [];
  rows = rows.filter(item => itemMatchesSearch(item, query.search, RENTAL_PAGINATION_CONFIG.searchFields));
  const filters = {
    status: item => item.status,
    managerId: item => item.managerId || item.manager,
    clientId: item => item.clientId,
    equipmentId: item => item.equipmentId,
    ownerId: item => item.ownerId,
    paymentStatus: item => item.paymentStatus,
    updSigned: item => item.updSigned ? 'yes' : 'no',
  };
  Object.entries(filters).forEach(([name, getter]) => {
    const value = String(query[name] || '').trim();
    if (value && value !== 'all') rows = rows.filter(item => String(getter(item) || '') === value);
  });
  const client = String(query.client || '').trim().toLowerCase();
  if (client) {
    rows = rows.filter(item => String(item.clientName || item.client || '').toLowerCase().includes(client));
  }
  const equipment = String(query.equipment || '').trim().toLowerCase();
  if (equipment) {
    rows = rows.filter(item => [
      item.equipmentId,
      item.equipmentInv,
      item.inventoryNumber,
      item.serialNumber,
      ...(Array.isArray(item.equipment) ? item.equipment : []),
    ].filter(Boolean).join(' ').toLowerCase().includes(equipment));
  }
  const dateFrom = String(query.dateFrom || '').trim();
  const dateTo = String(query.dateTo || '').trim();
  if (dateFrom || dateTo) {
    rows = rows.filter(item => {
      const start = String(item.startDate || '').slice(0, 10);
      const end = String(item.endDate || item.plannedReturnDate || '').slice(0, 10);
      if (dateFrom && end && end < dateFrom) return false;
      if (dateTo && start && start > dateTo) return false;
      return true;
    });
  }
  const preset = String(query.preset || '').trim();
  const today = new Date().toISOString().slice(0, 10);
  if (preset === 'returns_today') {
    rows = rows.filter(item => String(item.endDate || item.plannedReturnDate || '').slice(0, 10) === today && !['returned', 'closed'].includes(String(item.status || '')));
  } else if (preset === 'overdue') {
    rows = rows.filter(item => String(item.endDate || item.plannedReturnDate || '').slice(0, 10) < today && !['returned', 'closed'].includes(String(item.status || '')));
  } else if (preset === 'unpaid') {
    rows = rows.filter(item => item.paymentStatus !== 'paid');
  }
  return rows;
}

function normalizeAuditText(value) {
  return String(value ?? '').trim();
}

function auditValueMatchesId(value, ids) {
  if (value === null || value === undefined) return false;
  if (typeof value !== 'object') return ids.has(normalizeAuditText(value));
  if (Array.isArray(value)) return value.some(item => auditValueMatchesId(item, ids));
  return Object.values(value).some(item => auditValueMatchesId(item, ids));
}

function readAuditLogs(readData) {
  const current = readData(AUDIT_COLLECTION);
  const legacy = readData(LEGACY_AUDIT_COLLECTION);
  return [
    ...(Array.isArray(current) ? current : []),
    ...(Array.isArray(legacy) ? legacy : []),
  ];
}

function auditActionLabel(action) {
  const value = normalizeAuditText(action);
  if (value === 'rentals.create' || value === 'gantt_rentals.create') return 'Создание аренды';
  if (value === 'rentals.update' || value === 'gantt_rentals.update') return 'Изменение аренды';
  if (value === 'rentals.return') return 'Возврат аренды';
  if (value === 'rentals.change_request') return 'Изменение на согласовании';
  if (value === 'rentals.delete' || value === 'gantt_rentals.delete') return 'Удаление аренды';
  if (value.endsWith('.bulk_replace')) return 'Массовое обновление';
  return value || 'Событие';
}

function auditActionKind(action, changes = []) {
  const value = normalizeAuditText(action);
  const changedFields = changes.map(item => item.field);
  if (value === 'rentals.return') return 'return';
  if (value.endsWith('.create')) return 'create';
  if (value.endsWith('.delete')) return 'delete';
  if (changedFields.includes('status')) return 'status';
  if (changedFields.includes('plannedReturnDate') || changedFields.includes('endDate')) return 'extension';
  return 'update';
}

function canSeeRentalAuditFinance(user) {
  return user?.userRole === 'Администратор';
}

function normalizeDateKey(value) {
  return String(value || '').slice(0, 10);
}

function normalizeEquipmentRef(value) {
  const normalized = String(value ?? '').trim();
  if (!normalized || normalized === 'undefined' || normalized === 'null') return '';
  return normalized;
}

function parseDateKey(value) {
  const key = normalizeDateKey(value);
  if (!key) return null;
  const date = new Date(`${key}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function compareDateKeys(left, right) {
  const leftDate = parseDateKey(left);
  const rightDate = parseDateKey(right);
  if (!leftDate || !rightDate) return null;
  return leftDate.getTime() - rightDate.getTime();
}

function isClosedRentalStatus(status) {
  return CLOSED_RENTAL_STATUSES.has(String(status || '').trim().toLowerCase());
}

function sanitizeRentalAuditSnapshot(value, canViewFinance) {
  const redacted = redactAuditValue(value);
  if (!redacted || typeof redacted !== 'object') return redacted ?? null;
  if (Array.isArray(redacted)) return redacted.map(item => sanitizeRentalAuditSnapshot(item, canViewFinance));
  return Object.entries(redacted).reduce((acc, [key, item]) => {
    if (!canViewFinance && RENTAL_AUDIT_FINANCE_FIELDS.has(key)) return acc;
    acc[key] = sanitizeRentalAuditSnapshot(item, canViewFinance);
    return acc;
  }, {});
}

function buildRentalAuditChanges(before, after, canViewFinance) {
  const safeBefore = sanitizeRentalAuditSnapshot(before, canViewFinance) || {};
  const safeAfter = sanitizeRentalAuditSnapshot(after, canViewFinance) || {};
  const rawBefore = redactAuditValue(before) || {};
  const rawAfter = redactAuditValue(after) || {};
  const keys = new Set([...Object.keys(rawBefore), ...Object.keys(rawAfter)]);
  return [...keys]
    .filter(field => field !== 'id')
    .filter(field => !(!canViewFinance && RENTAL_AUDIT_FINANCE_FIELDS.has(field) && JSON.stringify(rawBefore[field] ?? null) === JSON.stringify(rawAfter[field] ?? null)))
    .filter(field => JSON.stringify(rawBefore[field] ?? null) !== JSON.stringify(rawAfter[field] ?? null))
    .slice(0, 12)
    .map(field => {
      const hidden = !canViewFinance && RENTAL_AUDIT_FINANCE_FIELDS.has(field);
      return {
        field,
        label: RENTAL_AUDIT_FIELD_LABELS[field] || field,
        before: hidden ? null : (safeBefore[field] ?? null),
        after: hidden ? null : (safeAfter[field] ?? null),
        hidden,
      };
    });
}

function buildRentalAuditEntry(entry, canViewFinance) {
  const before = sanitizeRentalAuditSnapshot(entry.before, canViewFinance);
  const after = sanitizeRentalAuditSnapshot(entry.after, canViewFinance);
  const metadata = sanitizeRentalAuditSnapshot(entry.metadata, canViewFinance);
  const changes = buildRentalAuditChanges(entry.before, entry.after, canViewFinance);
  return {
    id: normalizeAuditText(entry.id),
    createdAt: normalizeAuditText(entry.createdAt),
    userId: normalizeAuditText(entry.userId),
    userName: normalizeAuditText(entry.userName) || 'Система',
    role: normalizeAuditText(entry.normalizedRole || entry.role || entry.rawRole) || '—',
    action: normalizeAuditText(entry.action),
    actionLabel: auditActionLabel(entry.action),
    actionKind: auditActionKind(entry.action, changes),
    entityType: normalizeAuditText(entry.entityType),
    entityId: normalizeAuditText(entry.entityId),
    description: normalizeAuditText(entry.description),
    before,
    after,
    metadata,
    changes,
  };
}

function registerRentalRoutes(deps) {
  const {
    readData,
    writeData,
    requireAuth,
    requireRead,
    validateRentalPayload,
    mergeRentalHistory,
    normalizeGanttRentalList,
    normalizeGanttRentalStatus,
    normalizeRecordClientLink,
    canonicalizeRentalRelationForWrite = item => item,
    normalizeServiceTicketForWrite,
    generateId,
    idPrefixes,
    accessControl,
    auditLog,
    botNotifications = null,
    reconcileEquipmentRentalProjection: reconcileEquipmentRentalProjectionForWrite = reconcileEquipmentRentalProjection,
    writeDataBatch: persistDataBatchUnsafe = entries => {
      for (const entry of entries || []) writeData(entry.name, entry.value);
    },
    nowIso = () => new Date().toISOString(),
  } = deps;

  const router = express.Router();

  function assertAllocationSafeEntries(entries) {
    return assertPaymentAllocationPersistenceEntriesSafe(entries, { readData });
  }

  function persistDataBatch(entries) {
    assertAllocationSafeEntries(entries);
    return persistDataBatchUnsafe(entries);
  }

  function sendRentalPersistenceError(res, error, fallbackCode, fallbackMessage) {
    const relationError = String(error?.code || '').startsWith('COUNTERPARTY_RELATION_');
    return res.status(error?.status || (relationError ? 409 : 500)).json({
      ok: false,
      code: error?.code || fallbackCode,
      error: error?.message || fallbackMessage,
      ...(error?.details ? { details: error.details } : {}),
    });
  }
  const requiredAccessMethods = ['filterCollectionByScope', 'canAccessEntity', 'assertCanUpdateEntity', 'assertSafeAdminBulkReplaceInput', 'splitForbiddenRentalManagerPatch'];
  const missingAccessMethods = !accessControl
    ? requiredAccessMethods
    : requiredAccessMethods.filter(name => typeof accessControl[name] !== 'function');
  if (missingAccessMethods.length > 0) {
    throw new Error(`Rental routes require access-control methods: ${missingAccessMethods.join(', ')}`);
  }

  function rentalWriteForbiddenReason(req, collection, method) {
    const role = req.user?.userRole;
    if (method === 'POST') {
      if (role !== 'Администратор' && role !== 'Офис-менеджер') {
        return 'Недостаточно прав: создавать аренду могут только администратор и офис-менеджер.';
      }
      return null;
    }

    if (method === 'PATCH' && collection === 'rentals') {
      if (role === 'Администратор' || role === 'Офис-менеджер' || role === 'Менеджер по аренде') {
        return null;
      }
      return 'Недостаточно прав: редактировать карточку аренды могут администратор, офис-менеджер и менеджер по аренде.';
    }

    if (role !== 'Администратор') {
      return 'Недостаточно прав: изменять, удалять и восстанавливать аренду может только администратор.';
    }

    return null;
  }

  function rejectDirectGanttProjectionMutation(res, collection) {
    if (collection !== 'gantt_rentals') return false;
    res.status(409).json({
      ok: false,
      code: 'GANTT_PROJECTION_READ_ONLY',
      error: 'gantt_rentals является read-only проекцией Classic Rental. Измените карточку аренды через canonical Rental workflow; самостоятельные события создавайте в planner_items.',
    });
    return true;
  }

  function registerRentalCollection(collection) {
    const prefix = idPrefixes[collection] || collection;
    const requestPrefix = idPrefixes.rental_change_requests || 'RCR';

    function withClientLink(item, context) {
      if (typeof normalizeRecordClientLink !== 'function') return item;
      // IMPORTANT: rentals carry clientId as the durable link. The client name is editable
      // display text and must not be the source of debt/payment/document relationships.
      return normalizeRecordClientLink(item, readData('clients') || [], {
        context: context || `${collection}:${item?.id || 'new'}`,
        logger: console,
        allowLegacyRecovery: false,
      });
    }

    function normalizeRentalRelationLinks(item, existing = null, mutationInput = null) {
      let relationInput = item;
      if (
        existing
        && mutationInput
        && Object.prototype.hasOwnProperty.call(mutationInput, 'clientId')
        && !Object.prototype.hasOwnProperty.call(mutationInput, 'counterpartyId')
        && String(item?.clientId || '') !== String(existing?.clientId || '')
      ) {
        relationInput = { ...item };
        delete relationInput.counterpartyId;
      }
      const clientId = relationInput?.clientId || existing?.clientId;
      const normalized = (!clientId && !relationInput?.objectId && !relationInput?.contractId)
        ? relationInput
        : normalizeClientRelationLinks(relationInput, clientId, {
          readData,
          requireRentalRelations: collection === 'rentals' && !existing,
          requireActiveObject: !existing || String(item?.objectId || '') !== String(existing?.objectId || ''),
          allowArchivedObjectId: existing?.objectId,
          includeObjectSnapshot: true,
          includeContractSnapshot: true,
        });
      return collection === 'rentals'
        ? canonicalizeRentalRelationForWrite(normalized)
        : normalized;
    }

    function managerDisplayName(user) {
      return String(user?.name || user?.userName || user?.fullName || user?.email || '').trim();
    }

    function canonicalizeRentalEquipment(item, existing = null, { equipmentFieldsTouched = false } = {}) {
      if (!item || !['rentals', 'gantt_rentals'].includes(collection)) return item;
      const equipmentId = String(item.equipmentId || '').trim();
      if (!equipmentId) return item;
      const equipment = (readData('equipment') || []).find(entry => String(entry?.id || '').trim() === equipmentId);
      if (!equipment) {
        if (!equipmentFieldsTouched && existing && String(existing.equipmentId || '').trim() === equipmentId) return item;
        const error = new Error(`Техника с ID ${equipmentId} не найдена.`);
        error.status = 400;
        error.code = 'RENTAL_EQUIPMENT_NOT_FOUND';
        error.field = 'equipmentId';
        error.fieldErrors = { equipmentId: error.message };
        throw error;
      }
      const inventoryNumber = equipment.inventoryNumber || equipment.equipmentInv || '';
      const serialNumber = equipment.serialNumber || '';
      return {
        ...item,
        equipmentId: String(equipment.id),
        equipmentInv: inventoryNumber,
        inventoryNumber,
        serialNumber,
        equipment: inventoryNumber ? [inventoryNumber] : (serialNumber ? [serialNumber] : []),
      };
    }

    function canonicalizeRentalManager(item, existing = null, { managerFieldsTouched = false } = {}) {
      if (!item || !['rentals', 'gantt_rentals'].includes(collection)) return item;
      const managerId = String(item.managerId || '').trim();
      const manager = String(item.manager || '').trim();
      const users = readData('users') || [];
      if (managerId) {
        const user = users.find(entry => String(entry?.id || '').trim() === managerId);
        if (!user) {
          if (!managerFieldsTouched && existing && String(existing.managerId || '').trim() === managerId) return item;
          const error = new Error(`Менеджер с ID ${managerId} не найден.`);
          error.status = 400;
          error.code = 'RENTAL_MANAGER_NOT_FOUND';
          error.field = 'managerId';
          error.fieldErrors = { managerId: error.message };
          throw error;
        }
        return {
          ...item,
          managerId,
          manager: managerDisplayName(user),
        };
      }
      if (!manager) return item;
      const normalizedManager = manager.toLowerCase().replace(/ё/g, 'е');
      const matches = users.filter(user => (
        managerDisplayName(user).toLowerCase().replace(/ё/g, 'е') === normalizedManager
      ));
      if (matches.length === 1) {
        return {
          ...item,
          managerId: String(matches[0].id || '').trim() || undefined,
          manager: managerDisplayName(matches[0]),
        };
      }
      if (matches.length > 1 && managerFieldsTouched) {
        const error = new Error('Имя менеджера неоднозначно. Выберите менеджера по ID.');
        error.status = 409;
        error.code = 'RENTAL_MANAGER_AMBIGUOUS';
        error.field = 'manager';
        error.fieldErrors = { manager: error.message };
        throw error;
      }
      // Legacy rows without managerId remain readable and can be updated in unrelated fields.
      return item;
    }

    function validateLifecycleCandidate(rental) {
      return validateRentalLifecycleAvailability({
        rental,
        equipmentList: readData('equipment') || [],
        serviceTickets: readData('service') || [],
        equipmentDowntimes: readData('equipment_downtimes') || [],
      });
    }

    function rentalLifecycleFieldsTouched(input) {
      return [
        'equipmentId',
        'equipmentInv',
        'inventoryNumber',
        'serialNumber',
        'equipment',
        'startDate',
        'plannedReturnDate',
        'endDate',
        'status',
      ].some(field => Object.prototype.hasOwnProperty.call(input || {}, field));
    }

    function validateLinkedGanttAuthority(previous, next) {
      if (collection !== 'gantt_rentals' || isStandalonePlannerRow(next)) return { ok: true };
      const linkedId = linkedRentalIds(next).find(id => (readData('rentals') || []).some(rental => String(rental?.id || '') === String(id || '')));
      if (!linkedId) return { ok: true };
      const classicRental = (readData('rentals') || []).find(rental => String(rental?.id || '') === String(linkedId || ''));
      const canonical = ensureGanttRentalLink({ ...next }, classicRental, readData('equipment') || []);
      const authoritativeFields = [
        'counterpartyId', 'clientId', 'client', 'objectId', 'contractId', 'equipmentId', 'equipmentInv',
        'inventoryNumber', 'serialNumber', 'startDate', 'endDate', 'managerId', 'manager',
        'status', 'amount', 'paymentStatus',
      ];
      const contradictoryFields = authoritativeFields.filter(field => (
        JSON.stringify(previous?.[field] ?? null) !== JSON.stringify(next?.[field] ?? null)
        && JSON.stringify(next?.[field] ?? null) !== JSON.stringify(canonical?.[field] ?? null)
      ));
      if (contradictoryFields.length === 0) return { ok: true };
      return {
        ok: false,
        status: 409,
        code: 'LINKED_GANTT_CLASSIC_RENTAL_CONFLICT',
        error: 'Связанную строку планировщика нельзя изменять в обход карточки аренды.',
        field: contradictoryFields[0],
        fieldErrors: Object.fromEntries(contradictoryFields.map(field => [field, 'Измените поле через карточку аренды.'])),
      };
    }

    function reconcileRentalEquipment({
      rentals,
      ganttRentals,
      equipmentList = readData('equipment') || [],
      affectedRentals = [],
      serviceTickets = readData('service') || [],
      author,
      reason,
    }) {
      const affectedEquipmentIds = affectedEquipmentIdsForRentals(affectedRentals, equipmentList);
      return reconcileEquipmentRentalProjectionForWrite({
        equipmentList,
        rentals,
        ganttRentals,
        serviceTickets,
        affectedEquipmentIds,
        nowIso,
        author: author || 'Система',
        reason,
      });
    }

    function rentalEquipmentReadSnapshot(equipment) {
      if (!equipment) return undefined;
      return {
        id: equipment.id,
        inventoryNumber: equipment.inventoryNumber,
        serialNumber: equipment.serialNumber,
        manufacturer: equipment.manufacturer,
        model: equipment.model,
        status: equipment.status,
        category: equipment.category,
        activeInFleet: equipment.activeInFleet,
        type: equipment.type,
        drive: equipment.drive,
        owner: equipment.owner,
        ownerId: equipment.ownerId,
        ownerName: equipment.ownerName,
      };
    }

    function buildRentalReadContext() {
      const rentals = readData('rentals') || [];
      return {
        equipmentList: readData('equipment') || [],
        usersById: new Map((readData('users') || []).map(entry => [String(entry?.id || ''), entry])),
        objectsById: new Map((readData('client_objects') || []).map(entry => [String(entry?.id || ''), entry])),
        contractsById: new Map((readData('client_contracts') || []).map(entry => [String(entry?.id || ''), entry])),
        rentalsById: new Map(rentals.map(entry => [String(entry?.id || ''), entry])),
      };
    }

    function enrichRentalForRead(item, context = null, itemCollection = collection) {
      if (!item) return item;
      const readContext = context || buildRentalReadContext();
      const linkedClassicRental = itemCollection === 'gantt_rentals'
        ? [item.rentalId, item.sourceRentalId, item.originalRentalId]
            .map(id => readContext.rentalsById.get(String(id || '')))
            .find(Boolean) || null
        : item;
      const equipment = findEquipmentForRental(item, readContext.equipmentList);
      const objectId = item.objectId || linkedClassicRental?.objectId;
      const contractId = item.contractId || linkedClassicRental?.contractId;
      const object = readContext.objectsById.get(String(objectId || ''));
      const contract = readContext.contractsById.get(String(contractId || ''));
      const storedContractNumber = item.contractNumber || linkedClassicRental?.contractNumber;
      const managerId = item.managerId || linkedClassicRental?.managerId;
      const managerUser = readContext.usersById.get(String(managerId || ''));
      return {
        ...item,
        ...(managerId ? { managerId } : {}),
        ...(managerUser ? { manager: managerDisplayName(managerUser) } : {}),
        ...(objectId && !item.objectId ? { objectId } : {}),
        ...(contractId && !item.contractId ? { contractId } : {}),
        ...(equipment ? {
          equipmentId: item.equipmentId || equipment.id,
          equipmentInv: item.equipmentInv || equipment.inventoryNumber,
          inventoryNumber: item.inventoryNumber || equipment.inventoryNumber,
          serialNumber: item.serialNumber || equipment.serialNumber,
          equipmentDetails: rentalEquipmentReadSnapshot(equipment),
        } : {}),
        ...(object ? {
          objectName: object.name || item.objectName || linkedClassicRental?.objectName,
          objectAddress: object.address || item.objectAddress || linkedClassicRental?.objectAddress,
        } : linkedClassicRental && linkedClassicRental !== item ? {
          objectName: item.objectName || linkedClassicRental.objectName,
          objectAddress: item.objectAddress || linkedClassicRental.objectAddress,
        } : {}),
        ...((contract?.number || storedContractNumber) ? {
          contractNumber: contract?.number || storedContractNumber,
        } : {}),
      };
    }

    function buildRentalClientCreditRisk(clientId) {
      const normalizedClientId = String(clientId || '').trim();
      const client = (readData('clients') || [])
        .find(entry => String(entry?.id || '') === normalizedClientId);
      if (!client) return null;
      const snapshot = buildClientFinancialSnapshots(
        [client],
        readData('gantt_rentals') || [],
        readData('payments') || [],
        String(nowIso() || '').slice(0, 10),
        {
          paymentAllocations: readData('payment_allocations') || [],
          relationData: { readData },
        },
      )[0];
      if (!snapshot) return null;
      return {
        clientId: normalizedClientId,
        currentDebt: Number(snapshot.currentDebt || 0),
        creditLimit: Number(snapshot.creditLimit || 0),
        unpaidRentals: Number(snapshot.unpaidRentals || 0),
        overdueRentals: Number(snapshot.overdueRentals || 0),
        exceededLimit: snapshot.exceededLimit === true,
        requiresAcknowledgement: snapshot.exceededLimit === true || Number(snapshot.overdueRentals || 0) > 0,
      };
    }

    function buildLinkedGanttRentalUpdate(linkedGanttRentalId, previousRental, nextRental, author) {
      if (!linkedGanttRentalId) return null;
      const ganttRentals = readData('gantt_rentals') || [];
      const ganttIdx = ganttRentals.findIndex(entry => entry.id === linkedGanttRentalId);
      if (ganttIdx === -1) return null;
      return {
        ganttRentals,
        ganttIdx,
        nextGanttRental: syncGanttRentalFields(ganttRentals[ganttIdx], previousRental, nextRental, author, readData('equipment') || []),
      };
    }

    function validateLinkedGanttRental(linkedGanttRentalId, previousRental, nextRental, author) {
      const update = buildLinkedGanttRentalUpdate(linkedGanttRentalId, previousRental, nextRental, author);
      if (!update) return { ok: true };
      return validateRentalPayload(
        'gantt_rentals',
        update.nextGanttRental,
        update.ganttRentals,
        readData('equipment') || [],
        update.nextGanttRental.id,
        { skipConflictCheck: true },
      );
    }

    function duplicateGanttRentalLink(ganttRental, list, excludeId = '') {
      if (!ganttRental || isStandalonePlannerRow(ganttRental)) return null;
      const ids = new Set(linkedRentalIds(ganttRental));
      if (ids.size === 0) return null;
      const excluded = String(excludeId || '').trim();
      return (list || []).find(item => {
        if (!item || isStandalonePlannerRow(item)) return false;
        if (excluded && String(item.id || '') === excluded) return false;
        return linkedRentalIds(item).some(id => ids.has(id));
      }) || null;
    }

    function duplicateGanttRentalLinkError(duplicate) {
      return {
        ok: false,
        status: 409,
        code: 'DUPLICATE_GANTT_RENTAL_LINK',
        error: `Для аренды уже есть строка планировщика ${duplicate?.id || ''}`.trim(),
      };
    }

    function linkGanttRentalForWrite(ganttRental, list, context, excludeId = '') {
      if (collection !== 'gantt_rentals') return { ok: true, item: ganttRental };
      const rentals = readData('rentals') || [];
      const linkRequirement = validateGanttRentalLinkRequirement(ganttRental, rentals);
      if (!linkRequirement.ok) return linkRequirement;
      if (isStandalonePlannerRow(ganttRental)) return { ok: true, item: ganttRental };
      const equipment = readData('equipment') || [];
      const resolution = resolveGanttRentalLink({
        ganttRental,
        rentals,
        ganttRentals: list,
        equipment,
        context,
      });
      if (!resolution.ok) return resolution;
      const duplicate = duplicateGanttRentalLink(
        ensureGanttRentalLink(ganttRental, resolution.rental || { id: resolution.rentalId }, equipment),
        list,
        excludeId,
      );
      if (duplicate) return duplicateGanttRentalLinkError(duplicate);
      return {
        ok: true,
        item: ensureGanttRentalLink(ganttRental, resolution.rental || { id: resolution.rentalId }, equipment),
      };
    }

    async function emitRentalNotification(previousRental, nextRental) {
      if (!botNotifications?.notifyRentalChanged || !previousRental || !nextRental) return;
      try {
        await botNotifications.notifyRentalChanged(previousRental, nextRental);
      } catch (error) {
        console.error('[BOT] Не удалось отправить уведомление по аренде:', error?.message || error);
      }
    }

    function openServiceStatuses() {
      return ['new', 'in_progress', 'waiting_parts', 'needs_revision'];
    }

    function findEquipmentForRental(rental, equipmentList) {
      return (equipmentList || []).find(equipment => rentalMatchesEquipment(rental, equipment, equipmentList)) || null;
    }

    function currentDateKey() {
      return String(nowIso() || '').slice(0, 10);
    }

    function normalizeClassicRentalLifecycleForCreate(rental) {
      if (!rental || isTerminalRentalStatus(rental.status) || rental.actualReturnDate) return rental;
      const today = currentDateKey();
      const startDate = normalizeDateKey(rental.startDate);
      const endDate = normalizeDateKey(rental.plannedReturnDate || rental.endDate);
      if (endDate && endDate < today) {
        const error = new Error('Историческая аренда должна иметь завершённый статус.');
        error.status = 400;
        throw error;
      }
      return {
        ...rental,
        status: startDate && startDate > today ? 'created' : 'active',
      };
    }

    function isRentalCurrentOnDate(rental, dateKey) {
      if (!rental || isTerminalRentalStatus(rental.status) || rental.actualReturnDate) return false;
      const startDate = normalizeDateKey(rental.startDate);
      const endDate = normalizeDateKey(rental.plannedReturnDate || rental.endDate);
      return Boolean(startDate && endDate && startDate <= dateKey && endDate >= dateKey);
    }

    function isRentalFutureAfterDate(rental, dateKey) {
      if (!rental || isTerminalRentalStatus(rental.status) || rental.actualReturnDate) return false;
      const startDate = normalizeDateKey(rental.startDate);
      return Boolean(startDate && startDate > dateKey);
    }

    function buildEquipmentLifecycleForRentalCreate(rental, rentals, equipmentList, author) {
      if (!rental || isTerminalRentalStatus(rental.status) || rental.actualReturnDate) {
        return { nextEquipment: equipmentList, changed: false, equipment: null };
      }
      const equipment = findEquipmentForRental(rental, equipmentList);
      if (!equipment) {
        const error = new Error('Не удалось однозначно определить технику для аренды.');
        error.status = 409;
        throw error;
      }
      const openServiceTicket = findOpenServiceTicketForEquipment(equipment);
      if (openServiceTicket || equipment.status === 'in_service') {
        const error = new Error(openServiceTicket
          ? `Нельзя создать аренду: есть активная сервисная заявка ${openServiceTicket.id}.`
          : 'Нельзя создать аренду: техника находится в сервисе.');
        error.status = 409;
        throw error;
      }
      if (equipment.status === 'inactive') {
        const error = new Error('Нельзя создать аренду: техника списана или неактивна.');
        error.status = 409;
        throw error;
      }

      const today = currentDateKey();
      const candidates = [...(rentals || []), rental]
        .filter(item => rentalMatchesEquipment(item, equipment, equipmentList));
      const lifecycleRental = candidates
        .filter(item => isRentalCurrentOnDate(item, today))
        .sort((left, right) => String(left.startDate || '').localeCompare(String(right.startDate || '')))[0]
        || candidates
          .filter(item => isRentalFutureAfterDate(item, today))
          .sort((left, right) => String(left.startDate || '').localeCompare(String(right.startDate || '')))[0]
        || rental;
      const nextStatus = isRentalCurrentOnDate(lifecycleRental, today) ? 'rented' : 'reserved';
      const timestamp = nowIso();
      const nextEquipment = equipmentList.map(item => {
        if (String(item?.id || '') !== String(equipment.id || '')) return item;
        return {
          ...item,
          status: nextStatus,
          currentClient: lifecycleRental.client || lifecycleRental.clientName || '',
          returnDate: lifecycleRental.plannedReturnDate || lifecycleRental.endDate || '',
          history: [
            ...(Array.isArray(item.history) ? item.history : []),
            {
              date: timestamp,
              text: nextStatus === 'rented'
                ? `Аренда ${rental.id} создана: техника переведена в аренду`
                : `Аренда ${rental.id} создана: техника зарезервирована`,
              author,
              type: 'system',
            },
          ],
        };
      });
      return { nextEquipment, changed: true, equipment };
    }

    function findLinkedGanttRental(classicRental) {
      const ganttRentals = readData('gantt_rentals') || [];
      const classicId = String(classicRental?.id || '');
      return ganttRentals.find(item =>
        classicId &&
        [item.rentalId, item.sourceRentalId, item.originalRentalId].some(id => String(id || '') === classicId)
      )
        || null;
    }

    function findClassicRentalForRoute(routeId, rentals, ganttRentals) {
      let classicRental = rentals.find(item => String(item.id || '') === String(routeId || '')) || null;
      let ganttRental = null;
      if (!classicRental) {
        ganttRental = ganttRentals.find(item => String(item.id || '') === String(routeId || '')) || null;
        const linkedClassicId = ganttRental?.rentalId || ganttRental?.sourceRentalId || ganttRental?.originalRentalId || '';
        classicRental = linkedClassicId
          ? rentals.find(item => String(item.id || '') === String(linkedClassicId)) || null
          : null;
        if (!classicRental && ganttRental) {
          const resolution = resolveGanttRentalLink({
            ganttRental,
            rentals,
            ganttRentals,
            equipment: readData('equipment') || [],
            context: `findClassicRentalForRoute:${routeId}`,
            allowLegacyFallback: false,
          });
          if (resolution.ok) {
            classicRental = resolution.rental;
            ganttRental = ensureGanttRentalLink(ganttRental, classicRental, readData('equipment') || []);
          } else {
            return { classicRental: null, ganttRental, resolution };
          }
        }
      }
      if (!ganttRental && classicRental) {
        ganttRental = findLinkedGanttRental(classicRental);
      }
      return { classicRental, ganttRental };
    }

    function hasRentalEquipment(rental) {
      return Boolean(
        rental?.equipmentId ||
        rental?.equipmentInv ||
        rental?.inventoryNumber ||
        rental?.serialNumber ||
        (Array.isArray(rental?.equipment) && rental.equipment.some(Boolean)) ||
        (Array.isArray(rental?.equipmentIds) && rental.equipmentIds.some(Boolean))
      );
    }

    function rentalDateRange(rental) {
      return {
        startDate: normalizeDateKey(rental?.startDate),
        endDate: normalizeDateKey(rental?.endDate || rental?.plannedReturnDate),
      };
    }

    function conflictDto(rental) {
      const { startDate, endDate } = rentalDateRange(rental);
      return {
        date: startDate || endDate || '',
        startDate,
        endDate,
        client: String(rental?.client || rental?.clientName || 'Без клиента'),
        rentalId: String(rental?.rentalId || rental?.sourceRentalId || rental?.originalRentalId || rental?.id || ''),
        ganttRentalId: String(/^GR-/i.test(String(rental?.id || '')) ? rental.id : ''),
        status: String(rental?.status || ''),
      };
    }

    function findExtensionConflict({ classicRental, ganttRental, newPlannedReturnDate, equipmentList, rentals }) {
      const currentEnd = normalizeDateKey(classicRental?.plannedReturnDate || ganttRental?.endDate);
      const extensionEnd = normalizeDateKey(newPlannedReturnDate);
      const equipment = findEquipmentForRental(classicRental || ganttRental, equipmentList);
      if (!equipment || !currentEnd || !extensionEnd) return null;
      const currentId = String(classicRental?.id || '');
      const candidates = rentals || [];
      return candidates.find(item => {
        if (!item) return false;
        if (String(item.id || '') === currentId) return false;
        if (isClosedRentalStatus(item.status)) return false;
        if (!rentalMatchesEquipment(item, equipment, equipmentList)) return false;
        const { startDate, endDate } = rentalDateRange(item);
        if (!startDate || !endDate) return false;
        const startsBeforeExtensionEnds = compareDateKeys(startDate, extensionEnd);
        const endsAfterCurrentEnd = compareDateKeys(endDate, currentEnd);
        return startsBeforeExtensionEnds !== null &&
          endsAfterCurrentEnd !== null &&
          startsBeforeExtensionEnds <= 0 &&
          endsAfterCurrentEnd >= 0;
      }) || null;
    }

    function buildExtensionHistoryEntry(oldDate, newDate, reason, comment, author) {
      return {
        date: new Date().toISOString(),
        text: `Аренда продлена: ${oldDate} → ${newDate}. Причина: ${reason}${comment ? `. Комментарий: ${comment}` : ''}`,
        author,
        type: 'system',
      };
    }

    function getRentalDays(startDate, endDate) {
      const start = parseDateKey(startDate);
      const end = parseDateKey(endDate);
      if (!start || !end || end < start) return 0;
      return Math.floor((end.getTime() - start.getTime()) / 86400000) + 1;
    }

    function isRentalDateExtensionPatch(collection, previous, patch) {
      if (!patch || typeof patch !== 'object') return false;
      const currentEnd = normalizeDateKey(previous?.plannedReturnDate || previous?.endDate);
      const requestedEnd = collection === 'gantt_rentals'
        ? normalizeDateKey(patch.endDate ?? patch.plannedReturnDate)
        : normalizeDateKey(patch.plannedReturnDate ?? patch.endDate);
      if (!currentEnd || !requestedEnd) return false;
      const comparison = compareDateKeys(requestedEnd, currentEnd);
      return comparison !== null && comparison > 0;
    }

    function directRentalWorkflowPatchError(patch) {
      if (!patch || typeof patch !== 'object') return null;
      const blockedFields = [
        'actualReturnDate',
        'returnDate',
        'returnedAt',
        'closedAt',
        'completedAt',
        'cancelledAt',
        'canceledAt',
        'returnCondition',
        'damages',
        'missingItems',
      ];
      for (const field of blockedFields) {
        if (Object.prototype.hasOwnProperty.call(patch, field)) {
          return `Поле ${field} нельзя менять напрямую: используйте workflow возврата/закрытия аренды.`;
        }
      }
      if (Object.prototype.hasOwnProperty.call(patch, 'status')) {
        const status = String(patch.status || '').trim().toLowerCase();
        if (CLOSED_RENTAL_STATUSES.has(status)) {
          return `Статус ${patch.status} нельзя менять напрямую: используйте workflow возврата/закрытия аренды.`;
        }
      }
      return null;
    }

    function parseMoneyValue(value) {
      if (value === undefined || value === null || value === '') return null;
      if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : null;
      const text = String(value).replace(/\s+/g, '').replace(',', '.');
      const match = text.match(/\d+(?:\.\d+)?/);
      if (!match) return null;
      const numeric = Number(match[0]);
      return Number.isFinite(numeric) && numeric >= 0 ? numeric : null;
    }

    function inferDailyRateForExtension(rental, currentEnd) {
      const explicitDaily = parseMoneyValue(rental?.dailyRate);
      if (explicitDaily !== null) return { dailyRate: explicitDaily, source: 'dailyRate' };

      const monthlyRate = parseMoneyValue(rental?.monthlyRate);
      if (monthlyRate !== null) return { dailyRate: Math.round((monthlyRate / 30) * 100) / 100, source: 'monthlyRate' };

      const rateText = String(rental?.rate || '').toLowerCase();
      const rateValue = parseMoneyValue(rental?.rate);
      if (rateValue !== null) {
        if (/мес|month/.test(rateText)) return { dailyRate: Math.round((rateValue / 30) * 100) / 100, source: 'rate_month' };
        return { dailyRate: rateValue, source: 'rate_day' };
      }

      const currentDays = getRentalDays(rental?.startDate, currentEnd);
      const currentAmount = parseMoneyValue(rental?.price ?? rental?.amount);
      if (currentDays > 0 && currentAmount !== null) {
        return { dailyRate: Math.round((currentAmount / currentDays) * 100) / 100, source: 'current_amount' };
      }
      return { dailyRate: 0, source: 'unknown' };
    }

    function shouldCountExtensionPayment(payment) {
      const status = String(payment?.status || '').trim().toLowerCase();
      return !['cancelled', 'canceled', 'void', 'error', 'failed', 'closed', 'deleted', 'reversed'].includes(status);
    }

    function getEffectiveExtensionPaidAmount(payment) {
      if (!shouldCountExtensionPayment(payment)) return 0;
      if (Number.isFinite(Number(payment?.paidAmount))) return Math.max(0, Number(payment.paidAmount));
      return payment?.status === 'paid' ? Math.max(0, Number(payment?.amount) || 0) : 0;
    }

    function calculateExtensionFinancials({ rental, currentEnd, newEndDate, payments, ganttRental }) {
      const extensionDays = getRentalDays(addDaysKey(currentEnd, 1), newEndDate);
      const { dailyRate, source } = inferDailyRateForExtension(rental, currentEnd);
      const additionalAmount = Math.round(Math.max(0, dailyRate) * extensionDays * 100) / 100;
      const currentPrice = Math.max(0, Number(rental?.price ?? rental?.amount ?? ganttRental?.amount) || 0);
      const nextPrice = currentPrice + additionalAmount;
      const linkedIds = new Set([
        rental?.id,
        rental?.rentalId,
        ganttRental?.id,
        ganttRental?.rentalId,
      ].map(value => String(value || '').trim()).filter(Boolean));
      const paidAmount = (payments || [])
        .filter(payment => linkedIds.has(String(payment?.rentalId || '').trim()))
        .reduce((sum, payment) => sum + getEffectiveExtensionPaidAmount(payment), 0);
      const nextPaymentStatus = paidAmount >= nextPrice
        ? 'paid'
        : paidAmount > 0
          ? 'partial'
          : 'unpaid';
      return {
        extensionDays,
        dailyRate,
        rateSource: source,
        additionalAmount,
        previousAmount: currentPrice,
        nextAmount: nextPrice,
        paidAmount,
        outstanding: Math.max(0, nextPrice - paidAmount),
        nextPaymentStatus,
      };
    }

    function addDaysKey(dateKey, days) {
      const match = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})$/);
      if (!match) return '';
      const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
      date.setUTCDate(date.getUTCDate() + days);
      return date.toISOString().slice(0, 10);
    }

    function isReturnedClassicRental(rental) {
      return Boolean(rental?.actualReturnDate) || rental?.status === 'closed' || rental?.status === 'returned';
    }

    function isRestoringReturnedClassicRental(previousRental, nextRental) {
      return isReturnedClassicRental(previousRental) && !isReturnedClassicRental(nextRental) && nextRental?.status === 'active';
    }

    function findOpenServiceTicketForEquipment(equipment) {
      if (!equipment) return null;
      const equipmentList = readData('equipment') || [];
      return (readData('service') || []).find(ticket =>
        openServiceStatuses().includes(ticket.status) &&
        (
          (ticket.equipmentId && ticket.equipmentId === equipment.id) ||
          (ticket.serialNumber && equipment.serialNumber && ticket.serialNumber === equipment.serialNumber) ||
          (ticket.inventoryNumber && equipment.inventoryNumber && ticket.inventoryNumber === equipment.inventoryNumber)
        )
      ) || null;
    }

    function findOtherBlockingRental(ganttRentals, currentGanttId, equipment) {
      if (!equipment) return null;
      const equipmentList = readData('equipment') || [];
      const candidates = (ganttRentals || []).filter(rental =>
        String(rental.id || '') !== String(currentGanttId || '') &&
        rentalMatchesEquipment(rental, equipment, equipmentList) &&
        rental.status !== 'returned' &&
        rental.status !== 'closed'
      );
      return candidates.sort((left, right) => {
        const leftActive = left?.status === 'active' ? 0 : 1;
        const rightActive = right?.status === 'active' ? 0 : 1;
        if (leftActive !== rightActive) return leftActive - rightActive;
        return String(left?.startDate || '').localeCompare(String(right?.startDate || ''));
      })[0] || null;
    }

    function validateRentalRestore(previousRental, nextRental) {
      if (!isRestoringReturnedClassicRental(previousRental, nextRental)) return { ok: true };
      const equipment = findEquipmentForRental(nextRental, readData('equipment') || []);
      if (!equipment) {
        return { ok: false, status: 409, error: 'Не удалось однозначно определить технику для восстановления аренды.' };
      }
      if (isProductionSmokeEquipmentFixture(equipment)) {
        return { ok: false, status: 409, code: SYSTEM_FIXTURE_PROTECTED_CODE, equipmentId: equipment.id };
      }
      if (equipment.status === 'inactive') {
        return { ok: false, status: 409, error: 'Нельзя восстановить аренду: техника списана или неактивна.' };
      }
      const openServiceTicket = findOpenServiceTicketForEquipment(equipment);
      if (openServiceTicket || equipment.status === 'in_service') {
        return {
          ok: false,
          status: 409,
          error: openServiceTicket
            ? `Нельзя восстановить аренду: есть активная сервисная заявка ${openServiceTicket.id}.`
            : 'Нельзя восстановить аренду: техника находится в сервисе.',
        };
      }
      return { ok: true, equipment };
    }

    function rentalTargetsProductionSmokeFixture(rental) {
      if (!rental || isTerminalRentalStatus(rental.status)) return null;
      const equipmentList = readData('equipment') || [];
      return equipmentList.find(item => {
        if (!isProductionSmokeEquipmentFixture(item)) return false;
        return rentalMatchesEquipment(rental, item, equipmentList);
      }) || null;
    }

    function assertRentalDoesNotTargetProductionSmokeFixture(rental, action) {
      const target = rentalTargetsProductionSmokeFixture(rental);
      if (!target) return;
      throw createSystemFixtureProtectedError({
        action,
        equipmentId: target.id,
        attemptedFields: ['equipmentId'],
        violations: ['rentalLink'],
      });
    }

    function syncEquipmentForRestoredRental(previousRental, nextRental, author) {
      const validation = validateRentalRestore(previousRental, nextRental);
      if (!validation.ok || !validation.equipment) return;
      const equipmentList = readData('equipment') || [];
      const equipment = validation.equipment;
      const nextEquipment = equipmentList.map(item => {
        if (String(item?.id || '') !== String(equipment.id || '')) return item;
        return {
          ...item,
          status: 'rented',
          currentClient: nextRental.client,
          returnDate: nextRental.plannedReturnDate,
          history: [
            ...(Array.isArray(item.history) ? item.history : []),
            {
              date: new Date().toISOString(),
              text: `Аренда ${nextRental.id} восстановлена: техника снова в аренде`,
              author,
              type: 'system',
            },
          ],
        };
      });
      writeData('equipment', nextEquipment);
    }

    function buildReturnServiceTicket(rental, equipment, returnDate, damageDescription, author) {
      const now = new Date().toISOString();
      const ticket = {
        id: generateId(idPrefixes.service || 'S'),
        equipmentId: equipment.id,
        equipment: `${equipment.manufacturer || ''} ${equipment.model || ''} (INV: ${equipment.inventoryNumber || ''})`.trim(),
        inventoryNumber: equipment.inventoryNumber,
        serialNumber: equipment.serialNumber,
        equipmentType: equipment.type,
        location: equipment.location,
        reason: 'Приёмка с аренды',
        description: damageDescription
          ? `Техника возвращена с повреждениями: ${damageDescription}`
          : 'Техника принята с аренды. Требуется осмотр и дефектовка после возврата.',
        priority: damageDescription ? 'high' : 'medium',
        sla: '24 ч',
        createdBy: author,
        createdByUserId: '',
        createdByUserName: author,
        reporterContact: rental?.client || author,
        source: 'system',
        status: 'new',
        resultData: { summary: '', partsUsed: [], worksPerformed: [] },
        workLog: [{
          date: now,
          text: `Заявка автоматически создана после возврата техники из аренды ${rental?.id || ''} (${returnDate})`,
          author,
          type: 'status_change',
        }],
        parts: [],
        createdAt: now,
        photos: [],
        archived: false,
        rentalId: rental?.id,
        counterpartyId: rental?.counterpartyId,
        clientId: rental?.clientId,
        client: rental?.client,
        objectId: rental?.objectId,
        contractId: rental?.contractId,
      };
      return typeof normalizeServiceTicketForWrite === 'function'
        ? normalizeServiceTicketForWrite(ticket, {
            actor: { userName: author },
            isCreate: true,
            nowIso: () => now,
          })
        : ticket;
    }

    function buildLinkedGanttRentalFromClassic(classicRental) {
      if (collection !== 'rentals' || !classicRental?.id) return null;
      const base = {
        id: generateId(idPrefixes.gantt_rentals || 'GR'),
        rentalId: classicRental.id,
        sourceRentalId: classicRental.id,
        originalRentalId: classicRental.id,
        clientId: classicRental.clientId || '',
        objectId: classicRental.objectId || undefined,
        contractId: classicRental.contractId || undefined,
        client: classicRental.client || classicRental.clientName || '',
        clientShort: String(classicRental.client || classicRental.clientName || '').substring(0, 20),
        startDate: classicRental.startDate || '',
        endDate: classicRental.plannedReturnDate || classicRental.endDate || '',
        manager: classicRental.manager || '',
        managerId: classicRental.managerId || '',
        status: classicRental.status || 'created',
        paymentStatus: classicRental.paymentStatus || '',
        amount: Number(classicRental.price ?? classicRental.amount) || 0,
        comments: [],
      };
      return normalizeGanttRentalStatus(ensureGanttRentalLink(base, classicRental, readData('equipment') || []));
    }

    function buildLinkedGanttRentalIfMissing(classicRental, author) {
      if (collection !== 'rentals' || !classicRental?.id) {
        return { linkedGanttRental: null, nextGanttRentals: readData('gantt_rentals') || [] };
      }
      const ganttRentals = readData('gantt_rentals') || [];
      const existing = ganttRentals.find(item =>
        [item.rentalId, item.sourceRentalId, item.originalRentalId].some(id => String(id || '') === String(classicRental.id || ''))
      );
      if (existing) return { linkedGanttRental: existing, nextGanttRentals: ganttRentals };

      const linkedGanttRental = mergeRentalHistory(null, buildLinkedGanttRentalFromClassic(classicRental), author);
      const validation = validateRentalPayload(
        'gantt_rentals',
        linkedGanttRental,
        ganttRentals,
        readData('equipment') || [],
        '',
        { skipConflictCheck: true },
      );
      if (!validation.ok) {
        throw Object.assign(new Error(validation.error), { status: validation.status });
      }
      return {
        linkedGanttRental,
        nextGanttRentals: [...ganttRentals, linkedGanttRental],
      };
    }

    function logRentalResolutionFailure(req, resolution, rawMeta) {
      if (resolution.status !== 404 && resolution.status !== 409) return;
      const details = resolution.details || {};
      const debug = buildRentalResolutionDebug(req, resolution, rawMeta);
      console.warn('[rental-approval] rental resolver failed', JSON.stringify({
        route: `${req.method} ${req.originalUrl || req.url}`,
        paramsId: req.params.id,
        rentalId: rawMeta.rentalId || '',
        linkedGanttRentalId: rawMeta.linkedGanttRentalId || rawMeta.ganttRentalId || '',
        sourceRentalId: rawMeta.sourceRentalId || '',
        status: resolution.status,
        searchedIds: details.searchedIds || [],
        foundRentalById: details.foundRentalById ?? 0,
        foundGanttById: details.foundGanttById ?? 0,
        foundGanttByLink: details.foundGanttByLink ?? 0,
        fallbackCandidateCount: details.fallbackCandidateCount ?? 0,
        rentalCandidateIds: details.rentalCandidateIds || [],
        ganttCandidateIds: details.ganttCandidateIds || [],
        fallbackCandidateIds: details.fallbackCandidateIds || [],
        possibleReason: debug.possibleReason,
        frontendAction: debug.frontendAction,
      }));
    }

    function buildRentalResolutionDebug(req, resolution, rawMeta) {
      const details = resolution.details || {};
      const receivedId = String(req.params.id || '');
      const receivedRentalId = String(rawMeta.rentalId || rawMeta.sourceRentalId || '');
      const receivedGanttRentalId = String(rawMeta.linkedGanttRentalId || rawMeta.ganttRentalId || '');
      const snapshot = rawMeta.ganttSnapshot && typeof rawMeta.ganttSnapshot === 'object' ? rawMeta.ganttSnapshot : null;
      const frontendAction = String(rawMeta.actionType || rawMeta.entityType || '').trim();
      const idLooksLikeGantt = /^GR-/i.test(receivedId);
      let possibleReason = 'Аренда не найдена по переданным идентификаторам.';
      let recommendation = 'Снимите Network body этого PATCH-запроса и проверьте production DB через /api/admin/rental-link-diagnostics?id=' + encodeURIComponent(receivedId);

      if (idLooksLikeGantt && !receivedRentalId && !receivedGanttRentalId && (details.foundGanttById ?? 0) === 0) {
        possibleReason = 'Frontend отправил только GR-id, которого нет в production gantt_rentals. Возможен старый frontend build, stale state/cache или временный клиентский GR-id.';
        recommendation = 'Очистите frontend cache/localStorage/sessionStorage, проверьте commit frontend и найдите источник GR-id в Network initiator.';
      } else if (idLooksLikeGantt && (details.foundGanttById ?? 0) === 0) {
        possibleReason = 'GR-id из URL не найден в production gantt_rentals.';
        recommendation = 'Проверьте, существует ли этот GR-id в рабочей DB и совпадает ли frontend с backend deployment.';
      } else if ((details.foundGanttById ?? 0) > 0 && Array.isArray(details.linkedIds) && details.linkedIds.length === 0) {
        possibleReason = 'gantt_rentals найден, но у него нет rentalId/sourceRentalId/originalRentalId.';
        recommendation = 'Запустите backfill и проверьте fallback-кандидаты. Если кандидатов несколько, исправьте связь вручную.';
      } else if (Array.isArray(details.linkedIds) && details.linkedIds.length > 0 && (details.foundRentalById ?? 0) === 0) {
        possibleReason = 'gantt_rentals содержит связь, но связанная rentals.id отсутствует.';
        recommendation = 'Проверьте целостность rentals/gantt_rentals и восстановите исходную карточку аренды или связь.';
      } else if ((details.fallbackCandidateCount ?? 0) > 1) {
        possibleReason = 'Fallback нашёл несколько похожих аренд, backend не может безопасно выбрать одну.';
        recommendation = 'Проставьте точный rentalId в gantt_rentals или отправьте rentalId из frontend.';
      }

      return {
        receivedId,
        receivedRentalId,
        receivedGanttRentalId,
        receivedSourceRentalId: String(rawMeta.sourceRentalId || ''),
        receivedGanttSnapshotId: String(rawMeta.ganttSnapshot?.id || ''),
        hasGanttSnapshot: Boolean(rawMeta.ganttSnapshot),
        snapshotClient: String(snapshot?.client || snapshot?.clientName || ''),
        snapshotClientId: String(snapshot?.clientId || ''),
        snapshotEquipmentId: String(snapshot?.equipmentId || ''),
        snapshotEquipmentInv: String(snapshot?.equipmentInv || snapshot?.inventoryNumber || ''),
        snapshotStartDate: String(snapshot?.startDate || ''),
        snapshotEndDate: String(snapshot?.endDate || snapshot?.plannedReturnDate || ''),
        oldStartDate: String(rawMeta.oldValues?.startDate || ''),
        oldEndDate: String(rawMeta.oldValues?.plannedReturnDate || rawMeta.oldValues?.endDate || ''),
        newStartDate: String(rawMeta.newValues?.startDate || req.body?.startDate || ''),
        newEndDate: String(rawMeta.newValues?.plannedReturnDate || rawMeta.newValues?.endDate || req.body?.plannedReturnDate || req.body?.endDate || ''),
        searchedCollections: details.searchedCollections || [],
        possibleReason,
        frontendAction,
        bodyKeys: Object.keys(req.body || {}).sort(),
        requestRoute: `${req.method} ${req.originalUrl || req.url}`,
        recommendation,
      };
    }

    function createApprovalRequests(previousRental, changes, meta, req, options = {}) {
      if (!changes.length) return [];
      const requests = readData('rental_change_requests') || [];
      const equipment = readData('equipment') || [];
      const created = changes.map(change => buildRentalChangeRequest({
        id: generateId(requestPrefix),
        rental: previousRental,
        equipment,
        linkedGanttRentalId: meta.linkedGanttRentalId,
        sourceRentalId: meta.sourceRentalId,
        change,
        initiator: req.user,
        reason: meta.reason,
        comment: meta.comment,
        attachments: meta.attachments,
      }));
      if (options.persist !== false) {
        writeData('rental_change_requests', [...requests, ...created]);
      }
      return created;
    }

    function validateImmediateRentalPatch(previousRental, patch, data, approvalChanges, meta, author) {
      if (Object.keys(patch).length === 0) {
        return { ok: true, patch, nextItem: previousRental };
      }

      let nextPatch = { ...patch };
      let nextItem;
      try {
        const canonical = canonicalizeRentalPatch(previousRental, nextPatch);
        nextPatch = canonical.patch;
        nextItem = withClientLink(canonical.rental, `${collection}:approval:${previousRental.id}`);
      } catch (error) {
        return {
          ok: false,
          status: error?.status || 400,
          code: error?.code,
          error: error.message,
          field: error?.field,
          fieldErrors: error?.fieldErrors,
        };
      }
      let validation = validateRentalPayload(collection, nextItem, data, readData('equipment') || [], previousRental.id);
      if (validation.ok) {
        validation = validateLinkedGanttRental(meta.linkedGanttRentalId, previousRental, nextItem, author);
      }

      if (!validation.ok && validation.status === 409 && Object.prototype.hasOwnProperty.call(nextPatch, 'plannedReturnDate')) {
        approvalChanges.push({
          field: 'plannedReturnDate',
          label: getFieldLabel('plannedReturnDate'),
          oldValue: previousRental.plannedReturnDate,
          newValue: nextPatch.plannedReturnDate,
          type: 'Продление аренды с конфликтом',
          reason: validation.error || 'Продление конфликтует с будущей арендой и требует решения администратора.',
        });
        delete nextPatch.plannedReturnDate;
        try {
          const canonical = canonicalizeRentalPatch(previousRental, nextPatch);
          nextPatch = canonical.patch;
          nextItem = withClientLink(canonical.rental, `${collection}:approval:${previousRental.id}`);
        } catch (error) {
          return {
            ok: false,
            status: error?.status || 400,
            code: error?.code,
            error: error.message,
            field: error?.field,
            fieldErrors: error?.fieldErrors,
          };
        }
        if (Object.keys(nextPatch).length > 0) {
          validation = validateRentalPayload(collection, nextItem, data, readData('equipment') || [], previousRental.id);
          if (validation.ok) {
            validation = validateLinkedGanttRental(meta.linkedGanttRentalId, previousRental, nextItem, author);
          }
        } else {
          validation = { ok: true };
        }
      }

      if (!validation.ok) return validation;
      return { ok: true, patch: nextPatch, nextItem };
    }

    router.get(`/${collection}`, requireAuth, requireRead(collection), (req, res) => {
      const data = readData(collection) || [];
      const readContext = buildRentalReadContext();
      const readable = accessControl
        .filterCollectionByScope(collection, data, req.user)
        .map(item => enrichRentalForRead(item, readContext));
      const scoped = accessControl.sanitizeCollectionForRead(
        collection,
        readable,
        req.user,
      );
      if (wantsPaginatedResponse(req.query)) {
        const rows = filterRentalsForPagination(scoped, req.query);
        return res.json(buildPaginatedResponse(rows, req.query, {
          ...RENTAL_PAGINATION_CONFIG,
          summary: buildRentalsSummary(rows),
        }));
      }
      return res.json(scoped);
    });

    if (collection === 'rentals') {
      router.get(`/${collection}/:id/context`, requireAuth, requireRead(collection), (req, res) => {
        const routeId = normalizeAuditText(req.params.id);
        const rentals = readData('rentals') || [];
        const ganttRentals = readData('gantt_rentals') || [];
        let rental = rentals.find(item => normalizeAuditText(item?.id) === routeId) || null;
        let ganttRental = ganttRentals.find(item => normalizeAuditText(item?.id) === routeId) || null;

        if (!rental && ganttRental) {
          const linkedId = normalizeAuditText(ganttRental.rentalId || ganttRental.sourceRentalId || ganttRental.originalRentalId);
          rental = linkedId ? rentals.find(item => normalizeAuditText(item?.id) === linkedId) || null : null;
        }
        if (!rental && !ganttRental) return res.status(404).json({ ok: false, error: 'Not found' });
        const accessEntity = rental || ganttRental;
        const accessCollection = rental ? 'rentals' : 'gantt_rentals';
        if (!accessControl.canAccessEntity(accessCollection, accessEntity, req.user)) {
          return res.status(403).json({ ok: false, error: 'Forbidden' });
        }

        const ids = new Set([
          routeId,
          rental?.id,
          ganttRental?.id,
          ganttRental?.rentalId,
          ganttRental?.sourceRentalId,
          ganttRental?.originalRentalId,
        ].map(normalizeAuditText).filter(Boolean));
        const linkedGanttRentals = ganttRentals.filter(item => ids.has(normalizeAuditText(item?.id)) || ids.has(normalizeAuditText(item?.rentalId)) || ids.has(normalizeAuditText(item?.sourceRentalId)) || ids.has(normalizeAuditText(item?.originalRentalId)));
        linkedGanttRentals.forEach(item => ids.add(normalizeAuditText(item?.id)));

        const equipmentRefs = new Set([
          rental?.equipmentId,
          rental?.equipmentInv,
          rental?.inventoryNumber,
          rental?.serialNumber,
          ...(Array.isArray(rental?.equipment) ? rental.equipment : []),
          ganttRental?.equipmentId,
          ganttRental?.equipmentInv,
          ganttRental?.inventoryNumber,
          ganttRental?.serialNumber,
          ...linkedGanttRentals.flatMap(item => [item?.equipmentId, item?.equipmentInv, item?.inventoryNumber, item?.serialNumber]),
        ].map(normalizeAuditText).filter(Boolean));
        const scopedEquipment = accessControl.filterCollectionByScope('equipment', readData('equipment') || [], req.user);
        const equipment = scopedEquipment.filter(item => equipmentRefs.has(normalizeAuditText(item?.id)) || equipmentRefs.has(normalizeAuditText(item?.inventoryNumber)) || equipmentRefs.has(normalizeAuditText(item?.serialNumber)));
        const clientId = normalizeAuditText(rental?.clientId || ganttRental?.clientId);
        let clients = [];
        if (clientId) {
          try {
            accessControl.assertCanReadCollection('clients', req.user);
            clients = accessControl.filterCollectionByScope('clients', readData('clients') || [], req.user).filter(item => normalizeAuditText(item?.id) === clientId);
          } catch {
            clients = [];
          }
        }

        function scopedRelated(collectionName, predicate) {
          try {
            accessControl.assertCanReadCollection(collectionName, req.user);
          } catch {
            return [];
          }
          return accessControl
            .sanitizeCollectionForRead(collectionName, accessControl.filterCollectionByScope(collectionName, readData(collectionName) || [], req.user), req.user)
            .filter(predicate)
            .slice(0, 100);
        }

        const payments = scopedRelated('payments', item => ids.has(normalizeAuditText(item?.rentalId)) || (!!clientId && normalizeAuditText(item?.clientId) === clientId));
        const documents = scopedRelated('documents', item => ids.has(normalizeAuditText(item?.rentalId || item?.rental)) || (!!clientId && normalizeAuditText(item?.clientId) === clientId));
        const deliveries = scopedRelated('deliveries', item => ids.has(normalizeAuditText(item?.rentalId)) || equipmentRefs.has(normalizeAuditText(item?.equipmentId)) || equipmentRefs.has(normalizeAuditText(item?.equipmentInv)));
        const serviceTickets = scopedRelated('service', item => equipmentRefs.has(normalizeAuditText(item?.equipmentId)) || equipmentRefs.has(normalizeAuditText(item?.inventoryNumber)));

        return res.json({
          rental: rental ? accessControl.sanitizeEntityForRead('rentals', enrichRentalForRead(rental), req.user) : null,
          ganttRentals: accessControl.sanitizeCollectionForRead(
            'gantt_rentals',
            linkedGanttRentals.map(item => enrichRentalForRead(item, null, 'gantt_rentals')),
            req.user,
          ),
          equipment: accessControl.sanitizeCollectionForRead('equipment', equipment, req.user),
          clients: accessControl.sanitizeCollectionForRead('clients', clients, req.user),
          payments,
          documents,
          deliveries,
          serviceTickets,
        });
      });
    }

    router.get(`/${collection}/:id`, requireAuth, requireRead(collection), (req, res) => {
      const data = readData(collection) || [];
      const item = data.find(entry => entry.id === req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
      if (!accessControl.canAccessEntity(collection, item, req.user)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      return res.json(accessControl.sanitizeEntityForRead(collection, enrichRentalForRead(item), req.user));
    });

    if (collection === 'rentals') {
      router.get(`/${collection}/:id/audit`, requireAuth, requireRead(collection), (req, res) => {
        const rentals = readData('rentals') || [];
        const ganttRentals = readData('gantt_rentals') || [];
        const routeId = normalizeAuditText(req.params.id);
        let classicRental = rentals.find(item => normalizeAuditText(item?.id) === routeId) || null;
        let ganttRental = ganttRentals.find(item => normalizeAuditText(item?.id) === routeId) || null;

        if (!classicRental && ganttRental) {
          const linkedClassicId = normalizeAuditText(ganttRental.rentalId || ganttRental.sourceRentalId || ganttRental.originalRentalId);
          classicRental = linkedClassicId
            ? rentals.find(item => normalizeAuditText(item?.id) === linkedClassicId) || null
            : null;
        }
        if (!ganttRental && classicRental) {
          ganttRental = findLinkedGanttRental(classicRental);
        }
        if (!classicRental && !ganttRental) {
          return res.status(404).json({ ok: false, error: 'Аренда не найдена.' });
        }

        const targetCollection = classicRental ? 'rentals' : 'gantt_rentals';
        const targetRental = classicRental || ganttRental;
        if (!accessControl.canAccessEntity(targetCollection, targetRental, req.user)) {
          return res.status(403).json({ ok: false, error: 'Forbidden' });
        }

        const ids = new Set([
          routeId,
          classicRental?.id,
          ganttRental?.id,
          ganttRental?.rentalId,
          ganttRental?.sourceRentalId,
          ganttRental?.originalRentalId,
        ].map(normalizeAuditText).filter(Boolean));
        const canViewFinance = canSeeRentalAuditFinance(req.user);
        const logs = readAuditLogs(readData)
          .filter(entry => ['rentals', 'gantt_rentals'].includes(normalizeAuditText(entry?.entityType)))
          .filter(entry =>
            ids.has(normalizeAuditText(entry?.entityId)) ||
            auditValueMatchesId(entry?.before, ids) ||
            auditValueMatchesId(entry?.after, ids) ||
            auditValueMatchesId(entry?.metadata, ids)
          )
          .map(entry => buildRentalAuditEntry(entry, canViewFinance))
          .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')))
          .slice(0, RENTAL_AUDIT_LIMIT);

        return res.json({
          ok: true,
          rentalId: classicRental?.id || '',
          ganttRentalId: ganttRental?.id || '',
          canViewFinance,
          logs,
        });
      });
    }

    router.post(`/${collection}`, requireAuth, (req, res) => {
      if (rejectDirectGanttProjectionMutation(res, collection)) return;
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'POST');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const data = readData(collection) || [];
      const equipment = readData('equipment') || [];
      let createInput = ['rentals', 'gantt_rentals'].includes(collection)
        ? stripRentalServerOwnedAuditFields(req.body)
        : (req.body || {});
      const creditRiskAcknowledged = req.body?.creditRiskAcknowledged;
      if (collection === 'rentals') {
        try {
          createInput = canonicalizeRentalCreatePayload(createInput);
        } catch (error) {
          return res.status(error?.status || 400).json({
            ok: false,
            code: error?.code || 'RENTAL_PAYLOAD_VALIDATION_FAILED',
            error: error.message,
            field: error?.field,
            fieldErrors: error?.fieldErrors,
          });
        }
      }
      let idempotencyKey = '';
      try {
        idempotencyKey = readRentalCreateIdempotencyKey(req, collection);
      } catch (error) {
        return res.status(error?.status || 400).json({
          ok: false,
          code: error?.code,
          error: error.message,
        });
      }
      const idempotencyFingerprint = idempotencyKey
        ? rentalCreateFingerprint({
          ...createInput,
          creditRiskAcknowledged,
        })
        : '';
      const actorUserId = String(req.user?.userId || '');
      const idempotencyRecords = idempotencyKey
        ? readData(RENTAL_CREATE_IDEMPOTENCY_COLLECTION) || []
        : [];
      const previousAttempt = idempotencyKey
        ? idempotencyRecords.find(item => item?.key === idempotencyKey)
        : null;
      if (previousAttempt) {
        if (
          previousAttempt.fingerprint !== idempotencyFingerprint
          || String(previousAttempt.actorUserId || '') !== actorUserId
        ) {
          return res.status(409).json({
            ok: false,
            code: 'IDEMPOTENCY_KEY_REUSED',
            error: 'Idempotency-Key уже использован с другим содержимым запроса или пользователем.',
          });
        }
        const existing = data.find(item => String(item?.id || '') === String(previousAttempt.rentalId || ''));
        if (!existing) {
          return res.status(409).json({
            ok: false,
            code: 'IDEMPOTENCY_RESULT_UNAVAILABLE',
            error: 'Результат предыдущего создания аренды больше недоступен.',
          });
        }
        if (!accessControl.canAccessEntity(collection, existing, req.user)) {
          return res.status(403).json({ ok: false, error: 'Forbidden' });
        }
        res.setHeader('Idempotency-Replayed', 'true');
        return res.status(200).json(enrichRentalForRead(existing));
      }
      let newId = req.body?.id || generateId(prefix);
      while ((data || []).some(item => String(item?.id || '') === String(newId || ''))) {
        newId = generateId(prefix);
      }
      const requestBody = createInput;
      let newItem = withClientLink({ ...requestBody, id: newId }, `${collection}:create`);
      if (collection === 'gantt_rentals') {
        const linked = linkGanttRentalForWrite(newItem, data, `${collection}:create`, newItem.id);
        if (!linked.ok) {
          return res.status(linked.status || 400).json({ ok: false, error: linked.code || linked.error, message: linked.error });
        }
        newItem = linked.item;
      }
      try {
        newItem = normalizeRentalRelationLinks(newItem);
        newItem = canonicalizeRentalEquipment(newItem, null, {
          equipmentFieldsTouched: Boolean(newItem.equipmentId || newItem.equipmentInv || newItem.inventoryNumber),
        });
        newItem = canonicalizeRentalManager(newItem, null, {
          managerFieldsTouched: Boolean(newItem.managerId || newItem.manager),
        });
      } catch (error) {
        return sendRentalPayloadValidationError(res, error);
      }
      const validation = validateRentalPayload(collection, newItem, data, equipment, '', {
        skipConflictCheck: collection === 'gantt_rentals' && Boolean(newItem.rentalId),
      });
      if (!validation.ok) {
        const { status, ...body } = validation;
        return res.status(status).json(body);
      }
      if (collection === 'rentals') {
        const lifecycleValidation = validateLifecycleCandidate(newItem);
        if (!lifecycleValidation.ok) return sendRentalLifecycleError(res, lifecycleValidation);
      }
      if (collection === 'rentals') {
        const creditRisk = buildRentalClientCreditRisk(newItem.clientId);
        if (creditRisk?.requiresAcknowledgement && creditRiskAcknowledged !== true) {
          return res.status(409).json({
            ok: false,
            code: 'CLIENT_CREDIT_RISK_ACKNOWLEDGEMENT_REQUIRED',
            error: 'Подтвердите создание аренды при просроченной задолженности или превышенном кредитном лимите.',
            risk: creditRisk,
          });
        }
        if (creditRisk?.requiresAcknowledgement) {
          newItem = {
            ...newItem,
            creditRiskAcknowledgedAt: nowIso(),
            creditRiskAcknowledgedByUserId: req.user?.userId || '',
            creditRiskAcknowledgedBy: req.user?.userName || '',
            creditRiskSnapshot: creditRisk,
          };
        }
      }
      try {
        assertRentalDoesNotTargetProductionSmokeFixture(newItem, `${collection}.create`);
      } catch (error) {
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, auditLog, error);
        }
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }
      try {
        if (collection === 'rentals') newItem = normalizeClassicRentalLifecycleForCreate(newItem);
      } catch (error) {
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }

      if (collection === 'gantt_rentals') {
        newItem = normalizeGanttRentalStatus(newItem);
        newItem = mergeRentalHistory(null, newItem, req.user.userName);
      }
      let linkedGanttRental = null;
      try {
        if (collection === 'rentals') {
          const linked = buildLinkedGanttRentalIfMissing(newItem, req.user.userName);
          linkedGanttRental = linked.linkedGanttRental;
          const lifecycle = reconcileRentalEquipment({
            rentals: [...data, newItem],
            ganttRentals: linked.nextGanttRentals,
            equipmentList: equipment,
            affectedRentals: [newItem],
            author: req.user.userName,
            reason: `Создание аренды ${newItem.id}`,
          });
          const writes = [
            { name: 'rentals', value: [...data, newItem] },
            { name: 'gantt_rentals', value: linked.nextGanttRentals },
          ];
          if (lifecycle.changed) writes.push({ name: 'equipment', value: lifecycle.nextEquipment });
          if (idempotencyKey) {
            writes.push({
              name: RENTAL_CREATE_IDEMPOTENCY_COLLECTION,
              value: [...idempotencyRecords, {
                key: idempotencyKey,
                fingerprint: idempotencyFingerprint,
                rentalId: newItem.id,
                actorUserId,
                createdAt: nowIso(),
              }],
            });
          }
          persistDataBatch(writes);
        } else {
          writeData(collection, [...data, newItem]);
        }
      } catch (error) {
        return sendRentalPersistenceError(
          res,
          error,
          'RENTAL_CREATE_PERSISTENCE_FAILED',
          'Не удалось сохранить аренду.',
        );
      }
      auditLog?.(req, {
        action: `${collection}.create`,
        entityType: collection,
        entityId: newItem.id,
        after: newItem,
      });
      if (linkedGanttRental) {
        auditLog?.(req, {
          action: 'gantt_rentals.create',
          entityType: 'gantt_rentals',
          entityId: linkedGanttRental.id,
          after: linkedGanttRental,
        });
      }
      return res.status(201).json(enrichRentalForRead(newItem));
    });

    router.patch(`/${collection}/:id`, requireAuth, async (req, res) => {
      if (rejectDirectGanttProjectionMutation(res, collection)) return;
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const { patch: rawPatch, meta: rawMeta } = stripRentalPatchMeta(req.body);
      let patch = rawPatch;
      let meta = rawMeta;
      if (['rentals', 'gantt_rentals'].includes(collection)) {
        const forgedAuditFields = rentalServerOwnedAuditFields(patch);
        if (forgedAuditFields.length > 0) {
          return res.status(403).json({
            ok: false,
            code: 'RENTAL_AUDIT_FIELDS_IMMUTABLE',
            error: `Audit-поля аренды нельзя менять через общий PATCH: ${forgedAuditFields.join(', ')}.`,
          });
        }
      }
      const earlyDirectWorkflowError = directRentalWorkflowPatchError(patch);
      if (earlyDirectWorkflowError) {
        return res.status(403).json({ ok: false, error: earlyDirectWorkflowError });
      }
      const data = [...(readData(collection) || [])];
      let idx = data.findIndex(entry => String(entry.id) === String(req.params.id));
      if (collection === 'gantt_rentals' && idx !== -1) {
        const linkFieldPatch = ['rentalId', 'sourceRentalId', 'originalRentalId']
          .some(field => Object.prototype.hasOwnProperty.call(req.body || {}, field));
        if (linkFieldPatch) {
          const linkCandidate = {
            ...data[idx],
            ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'rentalId') ? { rentalId: req.body.rentalId } : {}),
            ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'sourceRentalId') ? { sourceRentalId: req.body.sourceRentalId } : {}),
            ...(Object.prototype.hasOwnProperty.call(req.body || {}, 'originalRentalId') ? { originalRentalId: req.body.originalRentalId } : {}),
          };
          const linkRequirement = validateGanttRentalLinkRequirement(linkCandidate, readData('rentals') || []);
          if (!linkRequirement.ok) {
            return res.status(linkRequirement.status || 400).json({
              ok: false,
              error: linkRequirement.code || linkRequirement.error,
              message: linkRequirement.error,
            });
          }
        }
      }
      if (collection === 'rentals') {
        const rawRentalId = String(rawMeta.rentalId || '').trim();
        const rawSourceRentalId = String(rawMeta.sourceRentalId || '').trim();
        const safeRentalId = /^GR-/i.test(rawRentalId) ? '' : rawRentalId;
        const safeSourceRentalId = /^GR-/i.test(rawSourceRentalId) ? '' : rawSourceRentalId;
        const linkedGanttRentalId = rawMeta.linkedGanttRentalId ||
          rawMeta.ganttRentalId ||
          (String(req.params.id || '').startsWith('GR-') ? req.params.id : '');
        const fallbackGanttRental = rawMeta.ganttSnapshot
          ? {
              ...rawMeta.ganttSnapshot,
              client: rawMeta.ganttSnapshot.client || rawMeta.oldValues?.client,
              clientId: rawMeta.ganttSnapshot.clientId || rawMeta.oldValues?.clientId,
              previousStartDate: rawMeta.oldValues?.startDate || rawMeta.ganttSnapshot.previousStartDate,
              previousEndDate:
                rawMeta.oldValues?.plannedReturnDate ||
                rawMeta.oldValues?.endDate ||
                rawMeta.ganttSnapshot.previousEndDate,
            }
          : rawMeta.ganttSnapshot;
        const ganttRentalsForResolution = readData('gantt_rentals') || [];
        const resolution = resolveRentalForChangeRequest({
          rentalId: safeRentalId || safeSourceRentalId || req.params.id,
          linkedGanttRentalId,
          fallbackGanttRental,
          rentals: data,
          ganttRentals: ganttRentalsForResolution,
          equipment: readData('equipment') || [],
          context: `${req.method} ${req.originalUrl || req.url}`,
          allowLegacyFallback: false,
        });
        if (!resolution.ok) {
          const debug = buildRentalResolutionDebug(req, resolution, rawMeta);
          logRentalResolutionFailure(req, resolution, rawMeta);
          return res.status(resolution.status).json({
            ok: false,
            code: resolution.code,
            error: resolution.error,
            details: {
              ...resolution.details,
              ...debug,
            },
          });
        }
        const resolvedLinkedGanttRental = resolution.linkedGanttRental ||
          findLinkedGanttRental(resolution.rental) ||
          null;
        idx = resolution.rentalIndex;
        const linkedGanttRental = resolvedLinkedGanttRental;
        const linkedGanttMatchesRental = [
          linkedGanttRental?.rentalId,
          linkedGanttRental?.sourceRentalId,
          linkedGanttRental?.originalRentalId,
        ].some(id => String(id || '').trim() === String(resolution.rentalId || '').trim());
        meta = {
          ...rawMeta,
          sourceRentalId: safeSourceRentalId || resolution.sourceRentalId || '',
          linkedGanttRentalId: rawMeta.linkedGanttRentalId || rawMeta.ganttRentalId || linkedGanttRental?.id || resolution.linkedGanttRentalId || '',
          canonicalRentalIdVerified: Boolean(
            safeRentalId ||
            safeSourceRentalId ||
            resolution.rentalId ||
            String(req.params.id || '').trim() === String(resolution.rentalId || '').trim() ||
            linkedGanttMatchesRental
          ),
        };
      }
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      try {
        accessControl.assertCanUpdateEntity(collection, data[idx], req.user);
      } catch (error) {
        return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
      }
      if (req.user?.userRole === 'Администратор') {
        try {
          patch = accessControl.sanitizeUpdateInput(collection, patch, req.user, data[idx]);
        } catch (error) {
          return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
        }
      }
      if (isRentalDateExtensionPatch(collection, data[idx], patch)) {
        return res.status(400).json({
          ok: false,
          error: 'Продление аренды выполняется через отдельную операцию /extend с расчётом суммы и подтверждением клиента.',
        });
      }
      const directWorkflowError = directRentalWorkflowPatchError(patch);
      if (directWorkflowError) {
        return res.status(403).json({ ok: false, error: directWorkflowError });
      }

      if (collection === 'rentals' && req.user?.userRole !== 'Администратор') {
        const previousRental = data[idx];
        const managerSplit = req.user?.userRole === 'Менеджер по аренде'
          ? accessControl.splitForbiddenRentalManagerPatch(previousRental, patch)
          : { immediatePatch: patch, approvalFields: [] };
        const { immediatePatch, approvalChanges } = splitRentalPatch({
          previousRental,
          patch: managerSplit.immediatePatch,
          payments: readData('payments') || [],
        });
        for (const field of managerSplit.approvalFields || []) {
          approvalChanges.push({
            field,
            label: getFieldLabel(field),
            oldValue: previousRental?.[field],
            newValue: patch[field],
            type: 'Критичное изменение аренды',
            reason: 'Критичные поля аренды меняются через согласование администратора.',
          });
        }

        let normalizedImmediatePatch = immediatePatch;
        try {
          if (Object.keys(immediatePatch || {}).length > 0) {
            let normalizedItem = normalizeRentalRelationLinks(
              { ...previousRental, ...immediatePatch, id: previousRental.id },
              previousRental,
              immediatePatch,
            );
            normalizedItem = canonicalizeRentalEquipment(normalizedItem, previousRental, {
              equipmentFieldsTouched: rentalLifecycleFieldsTouched(immediatePatch),
            });
            normalizedItem = canonicalizeRentalManager(normalizedItem, previousRental, {
              managerFieldsTouched: Object.prototype.hasOwnProperty.call(immediatePatch, 'manager')
                || Object.prototype.hasOwnProperty.call(immediatePatch, 'managerId'),
            });
            const normalizedFields = new Set(Object.keys(immediatePatch));
            if (normalizedFields.has('manager') || normalizedFields.has('managerId')) {
              normalizedFields.add('manager');
              normalizedFields.add('managerId');
            }
            normalizedImmediatePatch = Object.fromEntries([...normalizedFields].map(field => [field, normalizedItem[field]]));
          }
        } catch (error) {
          return sendRentalPayloadValidationError(res, error);
        }
        const immediateValidation = validateImmediateRentalPatch(previousRental, normalizedImmediatePatch, data, approvalChanges, meta, req.user.userName);
        if (!immediateValidation.ok) {
          const { status, ...body } = immediateValidation;
          return res.status(status).json(body);
        }
        const terminalValidation = validateTerminalRentalTransition(previousRental, immediateValidation.nextItem);
        if (!terminalValidation.ok) return sendRentalLifecycleError(res, terminalValidation);
        if (rentalLifecycleFieldsTouched(normalizedImmediatePatch)) {
          const lifecycleValidation = validateLifecycleCandidate(immediateValidation.nextItem);
          if (!lifecycleValidation.ok) return sendRentalLifecycleError(res, lifecycleValidation);
        }

        if (approvalChanges.some(change => ['startDate', 'plannedReturnDate', 'actualReturnDate'].includes(change.field)) && !meta.canonicalRentalIdVerified) {
          return res.status(400).json({
            ok: false,
            error: 'Нельзя создать согласование изменения дат без канонического rentalId редактируемой аренды.',
          });
        }

        const createdRequests = createApprovalRequests(previousRental, approvalChanges, meta, req, { persist: false });
        const nextRequests = createdRequests.length > 0
          ? [...(readData('rental_change_requests') || []), ...createdRequests]
          : null;
        let nextItem = immediateValidation.nextItem;
        try {
          assertRentalDoesNotTargetProductionSmokeFixture(nextItem, 'rentals.update');
        } catch (error) {
          if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
            return sendSystemFixtureProtectedError(req, res, auditLog, error);
          }
          return res.status(error?.status || 400).json({ ok: false, error: error.message });
        }
        const appliedFields = Object.keys(immediateValidation.patch || {});
        const pendingHistoryEntries = buildRentalPendingApprovalHistoryEntries(createdRequests, req.user.userName);
        if (appliedFields.length > 0) {
          nextItem = appendRentalHistory(
            nextItem,
            [
              ...buildRentalImmediateHistoryEntries(previousRental, nextItem, req.user.userName),
              ...pendingHistoryEntries,
            ],
          );
          data[idx] = nextItem;
          const linkedGanttUpdate = buildLinkedGanttRentalUpdate(
            meta.linkedGanttRentalId,
            previousRental,
            nextItem,
            req.user.userName,
          );
          let nextGanttRentals = readData('gantt_rentals') || [];
          if (linkedGanttUpdate) {
            nextGanttRentals = [...linkedGanttUpdate.ganttRentals];
            nextGanttRentals[linkedGanttUpdate.ganttIdx] = ensureGanttRentalLink(
              linkedGanttUpdate.nextGanttRental,
              nextItem,
              readData('equipment') || [],
            );
          }
          const lifecycle = reconcileRentalEquipment({
            rentals: data,
            ganttRentals: nextGanttRentals,
            affectedRentals: [previousRental, nextItem],
            author: req.user.userName,
            reason: `Изменение аренды ${nextItem.id}`,
          });
          const writes = [
            { name: collection, value: data },
            ...(linkedGanttUpdate ? [{ name: 'gantt_rentals', value: nextGanttRentals }] : []),
            ...(lifecycle.changed ? [{ name: 'equipment', value: lifecycle.nextEquipment }] : []),
            ...(nextRequests ? [{ name: 'rental_change_requests', value: nextRequests }] : []),
          ];
          try {
            persistDataBatch(writes);
          } catch (error) {
            return sendRentalPersistenceError(
              res,
              error,
              'RENTAL_UPDATE_PERSISTENCE_FAILED',
              'Не удалось атомарно обновить аренду.',
            );
          }
          auditLog?.(req, {
            action: 'rentals.update',
            entityType: 'rentals',
            entityId: nextItem.id,
            before: previousRental,
            after: nextItem,
          });
          await emitRentalNotification(previousRental, nextItem);
        } else if (createdRequests.length > 0) {
          data[idx] = appendRentalHistory(previousRental, pendingHistoryEntries);
          try {
            persistDataBatch([
              { name: collection, value: data },
              { name: 'rental_change_requests', value: nextRequests },
            ]);
          } catch (error) {
            return res.status(500).json({ ok: false, error: error.message || 'Не удалось атомарно создать согласование.' });
          }
          auditLog?.(req, {
            action: 'rentals.change_request',
            entityType: 'rentals',
            entityId: previousRental.id,
            after: { requestIds: createdRequests.map(item => item.id) },
          });
        }

        return res.json({
          ...data[idx],
          changeRequestSummary: {
            appliedFields,
            pendingCount: createdRequests.length,
            pendingRequestIds: createdRequests.map(item => item.id),
            pendingDescriptions: createdRequests.map(item => `${item.fieldLabel}: ${displayValue(item.oldValue)} → ${displayValue(item.newValue)}`),
          },
        });
      }

      let canonicalRentalCandidate = null;
      if (collection === 'rentals') {
        try {
          const canonical = canonicalizeRentalPatch(data[idx], patch);
          patch = canonical.patch;
          canonicalRentalCandidate = canonical.rental;
        } catch (error) {
          return sendRentalPayloadValidationError(res, error);
        }
      }
      let nextItem = withClientLink(
        canonicalRentalCandidate || { ...data[idx], ...patch, id: data[idx].id },
        `${collection}:update:${data[idx].id}`,
      );
      if (collection === 'gantt_rentals') {
        const directAuthority = validateLinkedGanttAuthority(data[idx], nextItem);
        if (!directAuthority.ok) return sendRentalLifecycleError(res, directAuthority);
        const linked = linkGanttRentalForWrite(nextItem, data, `${collection}:update:${data[idx].id}`, data[idx].id);
        if (!linked.ok) {
          return res.status(linked.status || 400).json({ ok: false, error: linked.code || linked.error, message: linked.error });
        }
        nextItem = linked.item;
        nextItem = normalizeGanttRentalStatus(nextItem);
      }
      try {
        nextItem = normalizeRentalRelationLinks(nextItem, data[idx], patch);
        nextItem = canonicalizeRentalEquipment(nextItem, data[idx], {
          equipmentFieldsTouched: rentalLifecycleFieldsTouched(patch),
        });
        nextItem = canonicalizeRentalManager(nextItem, data[idx], {
          managerFieldsTouched: Object.prototype.hasOwnProperty.call(patch, 'manager')
            || Object.prototype.hasOwnProperty.call(patch, 'managerId'),
        });
      } catch (error) {
        return sendRentalPayloadValidationError(res, error);
      }
      if (collection === 'rentals') {
        const terminalValidation = validateTerminalRentalTransition(data[idx], nextItem);
        if (!terminalValidation.ok) return sendRentalLifecycleError(res, terminalValidation);
      }
      if (collection === 'rentals' && rentalLifecycleFieldsTouched(patch)) {
        const lifecycleValidation = validateLifecycleCandidate(nextItem);
        if (!lifecycleValidation.ok) return sendRentalLifecycleError(res, lifecycleValidation);
      }
      const validation = validateRentalPayload(collection, nextItem, data, readData('equipment') || [], data[idx].id);
      if (!validation.ok) {
        const { status, ...validationBody } = validation;
        return res.status(status).json(validationBody);
      }
      const ganttAuthority = validateLinkedGanttAuthority(data[idx], nextItem);
      if (!ganttAuthority.ok) return sendRentalLifecycleError(res, ganttAuthority);
      if (collection === 'rentals') {
        const linkedValidation = validateLinkedGanttRental(meta.linkedGanttRentalId, data[idx], nextItem, req.user.userName);
        if (!linkedValidation.ok) {
          return res.status(linkedValidation.status).json({ ok: false, error: linkedValidation.error });
        }
        const restoreValidation = validateRentalRestore(data[idx], nextItem);
        if (!restoreValidation.ok) {
          if (restoreValidation.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
            return sendSystemFixtureProtectedError(req, res, auditLog, createSystemFixtureProtectedError({
              action: 'rental_restore',
              equipmentId: restoreValidation.equipmentId,
              attemptedFields: ['status'],
              violations: ['rentalLink'],
            }));
          }
          return res.status(restoreValidation.status || 409).json({ ok: false, error: restoreValidation.error });
        }
      }
      try {
        assertRentalDoesNotTargetProductionSmokeFixture(nextItem, `${collection}.update`);
      } catch (error) {
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, auditLog, error);
        }
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }

      if (collection === 'gantt_rentals') {
        nextItem = mergeRentalHistory(data[idx], nextItem, req.user.userName);
      } else if (collection === 'rentals') {
        nextItem = appendRentalHistory(
          nextItem,
          buildRentalImmediateHistoryEntries(data[idx], nextItem, req.user.userName),
        );
      }
      const previousRental = data[idx];
      data[idx] = nextItem;
      let linkedGanttUpdate = null;
      if (collection === 'rentals') {
        linkedGanttUpdate = buildLinkedGanttRentalUpdate(
          meta.linkedGanttRentalId,
          previousRental,
          nextItem,
          req.user.userName,
        );
      }
      let nextGanttRentals = collection === 'gantt_rentals' ? data : (readData('gantt_rentals') || []);
      if (linkedGanttUpdate) {
        nextGanttRentals = [...linkedGanttUpdate.ganttRentals];
        nextGanttRentals[linkedGanttUpdate.ganttIdx] = ensureGanttRentalLink(
          linkedGanttUpdate.nextGanttRental,
          nextItem,
          readData('equipment') || [],
        );
      }
      const lifecycleRentals = collection === 'rentals' ? data : (readData('rentals') || []);
      const lifecycle = reconcileRentalEquipment({
        rentals: lifecycleRentals,
        ganttRentals: nextGanttRentals,
        affectedRentals: [previousRental, nextItem],
        author: req.user.userName,
        reason: `Изменение ${collection} ${nextItem.id}`,
      });
      try {
        const writes = [
          { name: collection, value: data },
          ...(linkedGanttUpdate ? [{ name: 'gantt_rentals', value: nextGanttRentals }] : []),
          ...(lifecycle.changed ? [{ name: 'equipment', value: lifecycle.nextEquipment }] : []),
        ];
        persistDataBatch(writes);
      } catch (error) {
        return sendRentalPersistenceError(
          res,
          error,
          'RENTAL_UPDATE_PERSISTENCE_FAILED',
          'Не удалось атомарно обновить аренду.',
        );
      }
      auditLog?.(req, {
        action: `${collection}.update`,
        entityType: collection,
        entityId: nextItem.id,
        before: previousRental,
        after: nextItem,
      });
      await emitRentalNotification(previousRental, nextItem);
      return res.json(data[idx]);
    });

    if (collection === 'rentals') {
      function resolveRentalDowntimeRouteTarget(req, body = {}) {
        const rentals = readData('rentals') || [];
        const ganttRentals = readData('gantt_rentals') || [];
        const routeId = String(req.params.id || '');
        const linkedGanttRentalId = String(
          body.linkedGanttRentalId ||
          body.ganttRentalId ||
          body.__linkedGanttRentalId ||
          body.__ganttRentalId ||
          ''
        ).trim();
        const fallbackGanttRental = body.ganttSnapshot || body.__ganttSnapshot || null;
        const resolution = resolveRentalForChangeRequest({
          rentalId: routeId,
          linkedGanttRentalId,
          fallbackGanttRental,
          rentals,
          ganttRentals,
          equipment: readData('equipment') || [],
          context: `rentals:downtimes:${routeId}`,
          allowLegacyFallback: false,
        });
        if (!resolution.ok) {
          return {
            ok: false,
            status: resolution.status || 404,
            code: resolution.code,
            error: resolution.error || 'Аренда для простоя не найдена.',
            details: resolution.details,
          };
        }
        return {
          ok: true,
          rentals,
          rental: resolution.rental,
          rentalIndex: resolution.rentalIndex,
          ganttRental: resolution.linkedGanttRental || findLinkedGanttRental(resolution.rental),
          linkedGanttRentalId: linkedGanttRentalId || resolution.linkedGanttRentalId || resolution.linkedGanttRental?.id || '',
        };
      }

      function rentalDowntimeHistoryEntry(action, downtime, author) {
        const period = downtime?.startDate && downtime?.endDate
          ? `${downtime.startDate} — ${downtime.endDate}`
          : downtime?.startDate || '';
        const reason = downtime?.reason ? ` · ${downtime.reason}` : '';
        const billing = downtime?.affectsBilling ? ' · влияет на начисление' : ' · не влияет на начисление';
        return {
          date: new Date().toISOString(),
          text: `${action}: ${period}${reason}${billing}`,
          author: author || 'Система',
          type: 'system',
        };
      }

      function applyRentalDowntimeApproval(req, target, previousRental, nextRental, downtime, actionLabel) {
        const change = {
          field: 'downtimePeriods',
          label: getFieldLabel('downtimePeriods'),
          oldValue: previousRental.downtimePeriods,
          newValue: nextRental.downtimePeriods,
          type: 'Простой аренды',
          reason: `${actionLabel}: ${downtime.startDate} — ${downtime.endDate}`,
        };
        const createdRequests = createApprovalRequests(previousRental, [change], {
          linkedGanttRentalId: target.linkedGanttRentalId || target.ganttRental?.id || '',
          sourceRentalId: previousRental.id,
          rentalId: previousRental.id,
          reason: change.reason,
        }, req, { persist: false });
        const nextWithHistory = appendRentalHistory(previousRental, buildRentalPendingApprovalHistoryEntries(createdRequests, req.user.userName));
        const nextRentals = [...target.rentals];
        nextRentals[target.rentalIndex] = nextWithHistory;
        persistDataBatch([
          { name: 'rentals', value: nextRentals },
          {
            name: 'rental_change_requests',
            value: [...(readData('rental_change_requests') || []), ...createdRequests],
          },
        ]);
        auditLog?.(req, {
          action: 'rentals.change_request',
          entityType: 'rentals',
          entityId: previousRental.id,
          after: { requestIds: createdRequests.map(item => item.id), downtime },
        });
        return {
          ok: true,
          applied: false,
          downtime,
          rental: nextWithHistory,
          approval: {
            created: createdRequests.length > 0,
            requestIds: createdRequests.map(item => item.id),
          },
        };
      }

      async function persistRentalDowntimeMutation(req, res, target, result, actionLabel) {
        if (!result.ok) return res.status(result.status || 400).json({ ok: false, error: result.error });
        const previousRental = target.rental;
        const nextRental = appendRentalHistory(
          result.rental,
          [rentalDowntimeHistoryEntry(actionLabel, result.downtime, req.user.userName)],
        );

        if (req.user?.userRole === 'Менеджер по аренде') {
          try {
            return res.status(202).json(applyRentalDowntimeApproval(req, target, previousRental, nextRental, result.downtime, actionLabel));
          } catch (error) {
            return res.status(500).json({
              ok: false,
              code: 'RENTAL_DOWNTIME_APPROVAL_PERSISTENCE_FAILED',
              error: error?.message || 'Не удалось атомарно создать согласование простоя.',
            });
          }
        }

        const validation = validateRentalPayload('rentals', nextRental, target.rentals, readData('equipment') || [], previousRental.id);
        if (!validation.ok) return res.status(validation.status).json({ ok: false, error: validation.error });
        const linkedValidation = validateLinkedGanttRental(target.linkedGanttRentalId || target.ganttRental?.id || '', previousRental, nextRental, req.user.userName);
        if (!linkedValidation.ok) return res.status(linkedValidation.status).json({ ok: false, error: linkedValidation.error });

        const linkedGanttId = target.linkedGanttRentalId || target.ganttRental?.id || '';
        let nextGanttRentals = readData('gantt_rentals') || [];
        try {
          const linkedGanttUpdate = buildLinkedGanttRentalUpdate(
            linkedGanttId,
            previousRental,
            nextRental,
            req.user.userName,
          );
          if (linkedGanttUpdate) {
            nextGanttRentals = [...linkedGanttUpdate.ganttRentals];
            nextGanttRentals[linkedGanttUpdate.ganttIdx] = ensureGanttRentalLink(
              linkedGanttUpdate.nextGanttRental,
              nextRental,
              readData('equipment') || [],
            );
          }
          const nextRentals = [...target.rentals];
          nextRentals[target.rentalIndex] = nextRental;
          const lifecycle = reconcileRentalEquipment({
            rentals: nextRentals,
            ganttRentals: nextGanttRentals,
            affectedRentals: [previousRental, nextRental],
            author: req.user.userName,
            reason: `${actionLabel} для аренды ${nextRental.id}`,
          });
          persistDataBatch([
            { name: 'rentals', value: nextRentals },
            ...(linkedGanttUpdate ? [{ name: 'gantt_rentals', value: nextGanttRentals }] : []),
            ...(lifecycle.changed ? [{ name: 'equipment', value: lifecycle.nextEquipment }] : []),
          ]);
        } catch (error) {
          return sendRentalPersistenceError(
            res,
            error,
            'RENTAL_DOWNTIME_PERSISTENCE_FAILED',
            'Не удалось атомарно сохранить простой аренды.',
          );
        }
        auditLog?.(req, {
          action: 'rentals.downtime',
          entityType: 'rentals',
          entityId: nextRental.id,
          before: previousRental,
          after: nextRental,
          metadata: { downtimeId: result.downtime.id, actionLabel },
        });
        await emitRentalNotification(previousRental, nextRental);
        const updatedGantt = (readData('gantt_rentals') || []).find(item =>
          String(item.id || '') === String(linkedGanttId)
        ) || null;
        return res.json({ ok: true, applied: true, downtime: result.downtime, rental: nextRental, ganttRental: updatedGantt });
      }

      router.get(`/${collection}/:id/downtimes`, requireAuth, (req, res) => {
        const target = resolveRentalDowntimeRouteTarget(req);
        if (!target.ok) return res.status(target.status || 404).json({ ok: false, code: target.code, error: target.error, details: target.details });
        try {
          accessControl.assertCanUpdateEntity(collection, target.rental, req.user);
        } catch (error) {
          if (!accessControl.canAccessEntity(collection, target.rental, req.user)) {
            return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
          }
        }
        return res.json({ ok: true, rentalId: target.rental.id, downtimes: normalizeRentalDowntimePeriods(target.rental) });
      });

      router.post(`/${collection}/:id/downtimes`, requireAuth, async (req, res) => {
        const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
        if (forbiddenReason) return res.status(403).json({ ok: false, error: forbiddenReason });
        const target = resolveRentalDowntimeRouteTarget(req, req.body || {});
        if (!target.ok) return res.status(target.status || 404).json({ ok: false, code: target.code, error: target.error, details: target.details });
        try {
          accessControl.assertCanUpdateEntity(collection, target.rental, req.user);
        } catch (error) {
          return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
        }
        const result = createRentalDowntime(target.rental, req.body || {}, {
          id: generateId(idPrefixes.rental_downtimes || 'RDT'),
          author: req.user.userName,
        });
        return persistRentalDowntimeMutation(req, res, target, result, 'Простой создан');
      });

      router.patch(`/${collection}/:id/downtimes/:downtimeId`, requireAuth, async (req, res) => {
        const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
        if (forbiddenReason) return res.status(403).json({ ok: false, error: forbiddenReason });
        const target = resolveRentalDowntimeRouteTarget(req, req.body || {});
        if (!target.ok) return res.status(target.status || 404).json({ ok: false, code: target.code, error: target.error, details: target.details });
        try {
          accessControl.assertCanUpdateEntity(collection, target.rental, req.user);
        } catch (error) {
          return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
        }
        const result = updateRentalDowntime(target.rental, req.params.downtimeId, req.body || {}, { author: req.user.userName });
        return persistRentalDowntimeMutation(req, res, target, result, 'Простой изменён');
      });

      router.post(`/${collection}/:id/downtimes/:downtimeId/cancel`, requireAuth, async (req, res) => {
        const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
        if (forbiddenReason) return res.status(403).json({ ok: false, error: forbiddenReason });
        const target = resolveRentalDowntimeRouteTarget(req, req.body || {});
        if (!target.ok) return res.status(target.status || 404).json({ ok: false, code: target.code, error: target.error, details: target.details });
        try {
          accessControl.assertCanUpdateEntity(collection, target.rental, req.user);
        } catch (error) {
          return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
        }
        const result = cancelRentalDowntime(target.rental, req.params.downtimeId, { author: req.user.userName });
        return persistRentalDowntimeMutation(req, res, target, result, 'Простой отменён');
      });

      router.post(`/${collection}/:id/extend`, requireAuth, async (req, res) => {
        const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
        if (forbiddenReason) {
          return res.status(403).json({ ok: false, error: forbiddenReason });
        }

        const rentals = [...(readData(collection) || [])];
        const ganttRentals = [...(readData('gantt_rentals') || [])];
        const equipmentList = readData('equipment') || [];
        const payments = readData('payments') || [];
        const routeId = String(req.params.id || '');
        const requestedEndDate = req.body?.newEndDate ?? req.body?.newPlannedReturnDate;
        let newPlannedReturnDate = '';
        try {
          newPlannedReturnDate = strictRentalDate(
            requestedEndDate,
            'plannedReturnDate',
            'Дата окончания аренды',
          ).key;
        } catch (error) {
          return sendRentalPayloadValidationError(res, error);
        }
        const reason = String(req.body?.reason || '').trim();
        const comment = String(req.body?.comment || '').trim();
        const confirmedByClient = req.body?.confirmedByClient === true;
        const invoiceSentToClient = req.body?.invoiceSentToClient === true || req.body?.invoiceSent === true;
        const { classicRental, ganttRental, resolution: routeResolution } = findClassicRentalForRoute(routeId, rentals, ganttRentals);

        if (!classicRental && !ganttRental) {
          return res.status(404).json({ ok: false, error: 'Аренда для продления не найдена.' });
        }
        if (!classicRental && routeResolution && !routeResolution.ok) {
          return res.status(routeResolution.status || 409).json({
            ok: false,
            error: routeResolution.error,
            code: routeResolution.code,
            details: routeResolution.details,
          });
        }
        const rentalForAccess = classicRental || ganttRental;
        try {
          accessControl.assertCanUpdateEntity(classicRental ? 'rentals' : 'gantt_rentals', rentalForAccess, req.user);
        } catch (error) {
          return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
        }

        const currentEnd = normalizeDateKey(classicRental?.plannedReturnDate || ganttRental?.endDate || ganttRental?.plannedReturnDate);
        if (!confirmedByClient) return res.status(400).json({ ok: false, error: 'Подтвердите, что клиент согласовал продление.' });
        if (!currentEnd || !parseDateKey(currentEnd)) {
          return res.status(400).json({ ok: false, error: 'В аренде не указана текущая дата окончания.' });
        }
        if (isClosedRentalStatus(classicRental?.status)) {
          return res.status(409).json({ ok: false, error: 'Нельзя продлить закрытую или отменённую аренду.' });
        }
        if (compareDateKeys(newPlannedReturnDate, currentEnd) <= 0) {
          return res.status(400).json({ ok: false, error: 'Новая дата должна быть позже текущей даты окончания.' });
        }
        if (compareDateKeys(newPlannedReturnDate, new Date().toISOString().slice(0, 10)) < 0) {
          return res.status(400).json({ ok: false, error: 'Нельзя продлить аренду в прошлую дату.' });
        }
        if (!invoiceSentToClient) {
          return res.status(400).json({ ok: false, error: 'Подтвердите, что счёт отправлен клиенту.' });
        }
        if (!hasRentalEquipment(classicRental || ganttRental)) {
          return res.status(409).json({ ok: false, error: 'Нельзя продлить аренду без техники.' });
        }
        const financials = calculateExtensionFinancials({
          rental: classicRental || ganttRental,
          currentEnd,
          newEndDate: newPlannedReturnDate,
          payments,
          ganttRental,
        });
        if (financials.additionalAmount <= 0) {
          return res.status(400).json({
            ok: false,
            error: 'Не удалось рассчитать положительную доплату за продление. Укажите ставку аренды или сумму аренды перед продлением.',
            financialImpact: financials,
          });
        }

        const conflict = findExtensionConflict({
          classicRental,
          ganttRental,
          newPlannedReturnDate,
          equipmentList,
          rentals,
        });
        if (conflict) {
          const createdRequests = classicRental
            ? createApprovalRequests(classicRental, [{
                field: 'plannedReturnDate',
                label: getFieldLabel('plannedReturnDate'),
                oldValue: currentEnd,
                newValue: newPlannedReturnDate,
                type: 'Продление аренды с конфликтом',
                reason: `Конфликт с арендой ${conflict.id || conflict.rentalId || ''}`,
              }], {
                linkedGanttRentalId: ganttRental?.id || '',
                sourceRentalId: ganttRental?.id || '',
                reason: reason || 'Продление аренды',
                comment,
              }, req)
            : [];
          auditLog?.(req, {
            action: 'rentals.change_request',
            entityType: 'rentals',
            entityId: classicRental?.id || ganttRental?.id,
            after: { rentalId: classicRental?.id, requestIds: createdRequests.map(item => item.id) },
            metadata: { reason, comment, invoiceSentToClient, conflict: conflictDto(conflict) },
          });
          return res.status(202).json({
            ok: true,
            applied: false,
            rental: classicRental || null,
            ganttRental: ganttRental || null,
            conflict: conflictDto(conflict),
            financialImpact: financials,
            approval: {
              created: createdRequests.length > 0,
              requestIds: createdRequests.map(item => item.id),
            },
          });
        }

        const author = req.user?.userName || 'Система';
        const classicIdx = classicRental ? rentals.findIndex(item => item.id === classicRental.id) : -1;
        const ganttIdx = ganttRental ? ganttRentals.findIndex(item => item.id === ganttRental.id) : -1;
        let nextClassic = classicRental
          ? {
                ...classicRental,
                plannedReturnDate: newPlannedReturnDate,
                endDate: newPlannedReturnDate,
                price: financials.nextAmount,
                amount: financials.nextAmount,
                paymentStatus: financials.nextPaymentStatus,
                extensionConfirmedByClient: true,
                extensionInvoiceSentToClient: invoiceSentToClient,
                extensionFinancials: {
                  ...(classicRental.extensionFinancials || {}),
                  last: financials,
                },
            }
          : null;
        if (nextClassic) {
          try {
            nextClassic = canonicalizeRentalPatch(nextClassic, {
              plannedReturnDate: newPlannedReturnDate,
              price: financials.nextAmount,
              amount: financials.nextAmount,
            }).rental;
          } catch (error) {
            return sendRentalPayloadValidationError(res, error);
          }
          nextClassic = appendRentalHistory(
              nextClassic,
              [buildExtensionHistoryEntry(
                currentEnd,
                newPlannedReturnDate,
                reason || 'Продление аренды',
                [
                  comment,
                  invoiceSentToClient ? 'счёт отправлен клиенту' : '',
                  `дней: ${financials.extensionDays}`,
                  `сумма: ${financials.previousAmount} → ${financials.nextAmount}`,
                  `дополнительно: ${financials.additionalAmount}`,
                ].filter(Boolean).join('; '),
                author,
              )],
            );
        }
        let nextGantt = ganttRental
          ? ensureGanttRentalLink(mergeRentalHistory(ganttRental, {
              ...ganttRental,
              endDate: newPlannedReturnDate,
              plannedReturnDate: newPlannedReturnDate,
              amount: financials.nextAmount,
              paymentStatus: financials.nextPaymentStatus,
              extensionConfirmedByClient: true,
              extensionInvoiceSentToClient: invoiceSentToClient,
            }, author), nextClassic || classicRental, equipmentList)
          : null;
        if (nextGantt && nextClassic && classicRental) {
          nextGantt = ensureGanttRentalLink(
            syncGanttRentalFields(nextGantt, classicRental, nextClassic, author, equipmentList),
            nextClassic,
            equipmentList,
          );
        }

        if (nextClassic) {
          const validation = validateRentalPayload('rentals', nextClassic, rentals, equipmentList, classicRental.id);
          if (!validation.ok) return res.status(validation.status).json({ ok: false, error: validation.error });
          const lifecycleValidation = validateLifecycleCandidate(nextClassic);
          if (!lifecycleValidation.ok) return sendRentalLifecycleError(res, lifecycleValidation);
        }
        if (nextGantt) {
          const validation = validateRentalPayload(
            'gantt_rentals',
            nextGantt,
            ganttRentals,
            equipmentList,
            ganttRental.id,
            { skipConflictCheck: true },
          );
          if (!validation.ok) return res.status(validation.status).json({ ok: false, error: validation.error });
        }

        const extensionWrites = [];
        if (classicIdx !== -1 && nextClassic) {
          rentals[classicIdx] = nextClassic;
          extensionWrites.push({ name: collection, value: rentals });
        }
        if (ganttIdx !== -1 && nextGantt) {
          ganttRentals[ganttIdx] = nextGantt;
          extensionWrites.push({ name: 'gantt_rentals', value: ganttRentals });
        }
        const lifecycle = reconcileRentalEquipment({
          rentals,
          ganttRentals,
          equipmentList,
          affectedRentals: [classicRental, nextClassic, ganttRental, nextGantt].filter(Boolean),
          author,
          reason: `Продление аренды ${nextClassic?.id || classicRental?.id || ganttRental?.id}`,
        });
        if (lifecycle.changed) extensionWrites.push({ name: 'equipment', value: lifecycle.nextEquipment });
        try {
          persistDataBatch(extensionWrites);
        } catch (error) {
          return sendRentalPersistenceError(
            res,
            error,
            'RENTAL_EXTENSION_PERSISTENCE_FAILED',
            'Не удалось атомарно продлить аренду.',
          );
        }

        const auditMetadata = {
          oldPlannedReturnDate: currentEnd,
          newPlannedReturnDate,
          reason,
          comment,
          confirmedByClient,
          invoiceSentToClient,
          financialImpact: financials,
          rentalId: nextClassic?.id || classicRental?.id || '',
          ganttRentalId: nextGantt?.id || ganttRental?.id || '',
          equipmentId: nextClassic?.equipmentId || nextGantt?.equipmentId || '',
        };
        if (nextClassic) {
          auditLog?.(req, {
            action: 'rentals.extend',
            entityType: 'rentals',
            entityId: nextClassic.id,
            before: { id: classicRental.id, plannedReturnDate: currentEnd, equipmentId: classicRental.equipmentId },
            after: { id: nextClassic.id, plannedReturnDate: newPlannedReturnDate, equipmentId: nextClassic.equipmentId },
            metadata: auditMetadata,
          });
          auditLog?.(req, {
            action: 'rentals.planned_return_date_change',
            entityType: 'rentals',
            entityId: nextClassic.id,
            before: { id: classicRental.id, plannedReturnDate: currentEnd },
            after: { id: nextClassic.id, plannedReturnDate: newPlannedReturnDate },
            metadata: auditMetadata,
          });
        }
        if (nextGantt) {
          auditLog?.(req, {
            action: 'gantt_rentals.extend',
            entityType: 'gantt_rentals',
            entityId: nextGantt.id,
            before: { id: ganttRental.id, endDate: currentEnd, plannedReturnDate: currentEnd, equipmentId: ganttRental.equipmentId },
            after: { id: nextGantt.id, endDate: newPlannedReturnDate, plannedReturnDate: newPlannedReturnDate, equipmentId: nextGantt.equipmentId },
            metadata: auditMetadata,
          });
        }

        if (nextClassic) await emitRentalNotification(classicRental, nextClassic);
        return res.json({
          ok: true,
          applied: true,
          rental: nextClassic,
          ganttRental: nextGantt,
          conflict: null,
          financialImpact: financials,
          approval: { created: false, requestIds: [] },
        });
      });

      router.post(`/${collection}/:id/return`, requireAuth, async (req, res) => {
        const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
        if (forbiddenReason) {
          return res.status(403).json({ ok: false, error: forbiddenReason });
        }

        const data = readData(collection) || [];
        const equipmentList = readData('equipment') || [];
        const ganttRentals = readData('gantt_rentals') || [];
        const routeId = String(req.params.id || '');
        const returnDate = String(req.body?.returnDate || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const hasDamage = req.body?.hasDamage === true || req.body?.result === 'service';
        const damageDescription = String(req.body?.damageDescription || '').trim();

        const routeLookup = findClassicRentalForRoute(routeId, data, ganttRentals);
        const classicRental = routeLookup.classicRental;
        const ganttRental = routeLookup.ganttRental;
        const routeResolution = routeLookup.resolution;
        if (!classicRental && routeResolution && !routeResolution.ok) {
          return res.status(routeResolution.status || 409).json({
            ok: false,
            error: routeResolution.error,
            code: routeResolution.code,
            details: routeResolution.details,
          });
        }
        if (!classicRental && !ganttRental) {
          return res.status(404).json({ ok: false, error: 'Аренда для возврата не найдена.' });
        }

        const rentalForAccess = classicRental || ganttRental;
        try {
          accessControl.assertCanUpdateEntity(classicRental ? 'rentals' : 'gantt_rentals', rentalForAccess, req.user);
        } catch (error) {
          return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
        }

        if (isReturnedClassicRental(classicRental)) {
          return res.status(409).json({ ok: false, error: 'Возврат уже оформлен для этой аренды.' });
        }

        const equipment = findEquipmentForRental(classicRental || ganttRental, equipmentList);
        if (!equipment) {
          return res.status(409).json({ ok: false, error: 'Не удалось однозначно определить технику для возврата.' });
        }
        if (equipment.status === 'inactive') {
          return res.status(409).json({ ok: false, error: 'Нельзя оформить возврат: техника списана или неактивна.' });
        }

        const openServiceTicket = findOpenServiceTicketForEquipment(equipment);
        if (!hasDamage && openServiceTicket) {
          return res.status(409).json({
            ok: false,
            error: `Нельзя освободить технику: есть активная сервисная заявка ${openServiceTicket.id}.`,
          });
        }
        if (!hasDamage && equipment.status === 'in_service') {
          return res.status(409).json({
            ok: false,
            error: 'Нельзя освободить технику: текущий статус уже «В сервисе».',
          });
        }

        const author = req.user?.userName || 'Система';
        const nextRentals = data.map(item => {
          if (!classicRental || item.id !== classicRental.id) return item;
          return appendRentalHistory(
            {
              ...item,
              actualReturnDate: returnDate,
              status: 'closed',
            },
            [{
              date: new Date().toISOString(),
              text: hasDamage
                ? `Возврат оформлен: техника принята с повреждениями${damageDescription ? ` (${damageDescription})` : ''}`
                : 'Возврат оформлен: аренда закрыта, техника возвращена в парк',
              author,
              type: 'system',
            }],
          );
        });

        const nextGanttRentals = ganttRentals.map(item => {
          if (!ganttRental || item.id !== ganttRental.id) return item;
          const returnedGanttRental = mergeRentalHistory(
            item,
            {
              ...item,
              endDate: returnDate || item.endDate,
              status: 'returned',
            },
            author,
          );
          return {
            ...ensureGanttRentalLink(returnedGanttRental, classicRental, readData('equipment') || []),
            endDate: returnDate || returnedGanttRental.endDate,
            status: 'returned',
          };
        });

        const nextService = [...(readData('service') || [])];
        let createdServiceTicket = null;
        if (hasDamage) {
          if (!openServiceTicket) {
            createdServiceTicket = buildReturnServiceTicket(classicRental || ganttRental, equipment, returnDate, damageDescription, author);
            nextService.push(createdServiceTicket);
          }
        }
        const lifecycle = reconcileRentalEquipment({
          rentals: nextRentals,
          ganttRentals: nextGanttRentals,
          equipmentList,
          affectedRentals: [classicRental, ganttRental].filter(Boolean),
          serviceTickets: nextService,
          author,
          reason: `Возврат аренды ${classicRental?.id || ganttRental?.id}`,
        });
        const nextEquipment = lifecycle.nextEquipment;
        const resultingEquipmentStatus = nextEquipment.find(item => item.id === equipment.id)?.status || equipment.status;
        try {
          assertProductionSmokeFixtureMutationAllowed({
            action: 'rental_return',
            existingList: equipmentList,
            nextList: nextEquipment,
          });
        } catch (error) {
          if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
            return sendSystemFixtureProtectedError(req, res, auditLog, error);
          }
          return res.status(error?.status || 400).json({ ok: false, error: error.message });
        }

        try {
          persistDataBatch([
            { name: collection, value: nextRentals },
            { name: 'gantt_rentals', value: nextGanttRentals },
            ...(lifecycle.changed ? [{ name: 'equipment', value: nextEquipment }] : []),
            ...(createdServiceTicket ? [{ name: 'service', value: nextService }] : []),
          ]);
        } catch (error) {
          return sendRentalPersistenceError(
            res,
            error,
            'RENTAL_RETURN_PERSISTENCE_FAILED',
            'Не удалось атомарно оформить возврат.',
          );
        }

        const returnedRental = classicRental
          ? nextRentals.find(item => item.id === classicRental.id)
          : null;
        auditLog?.(req, {
          action: 'rentals.return',
          entityType: 'rentals',
          entityId: returnedRental?.id || ganttRental?.id,
          after: {
            returnDate,
            hasDamage,
            equipmentId: equipment.id,
            equipmentStatus: resultingEquipmentStatus,
            serviceTicketId: createdServiceTicket?.id || openServiceTicket?.id || null,
          },
        });
        if (returnedRental) await emitRentalNotification(classicRental, returnedRental);
        return res.json({
          ok: true,
          rental: returnedRental,
          ganttRental: ganttRental ? nextGanttRentals.find(item => item.id === ganttRental.id) : null,
          equipment: nextEquipment.find(item => item.id === equipment.id),
          serviceTicket: createdServiceTicket || openServiceTicket || null,
          documentsPreserved: (readData('documents') || []).filter(item => item.rentalId === returnedRental?.id || item.rental === returnedRental?.id).length,
          paymentsPreserved: (readData('payments') || []).filter(item => item.rentalId === returnedRental?.id).length,
        });
      });
    }

    function rentalDeleteBlocker(rentalId) {
      const pendingRequest = (readData('rental_change_requests') || []).find(request => (
        String(request?.rentalId || '') === String(rentalId || '')
        && String(request?.status || 'pending') === 'pending'
      ));
      if (pendingRequest) {
        return {
          code: 'RENTAL_DELETE_PENDING_CHANGE_REQUEST',
          error: `Нельзя удалить аренду: заявка ${pendingRequest.id} ожидает согласования.`,
          dependentId: pendingRequest.id,
        };
      }
      const activeDelivery = (readData('deliveries') || []).find(delivery => (
        [delivery?.rentalId, delivery?.classicRentalId].some(id => String(id || '') === String(rentalId || ''))
        && !['completed', 'cancelled', 'canceled'].includes(String(delivery?.status || '').toLowerCase())
      ));
      if (activeDelivery) {
        return {
          code: 'RENTAL_DELETE_ACTIVE_DELIVERY',
          error: `Нельзя удалить аренду: доставка ${activeDelivery.id} ещё активна.`,
          dependentId: activeDelivery.id,
        };
      }
      return null;
    }

    router.delete(`/${collection}/:id`, requireAuth, (req, res) => {
      if (rejectDirectGanttProjectionMutation(res, collection)) return;
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'DELETE');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const data = readData(collection) || [];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });

      const removed = data[idx];
      const equipmentList = readData('equipment') || [];
      let nextRentals = collection === 'rentals' ? data.filter((_, index) => index !== idx) : (readData('rentals') || []);
      let nextGanttRentals = collection === 'gantt_rentals' ? data.filter((_, index) => index !== idx) : (readData('gantt_rentals') || []);
      let affectedRentals = [removed];
      let cascadedGanttCount = 0;

      if (collection === 'rentals') {
        const blocker = rentalDeleteBlocker(removed.id);
        if (blocker) {
          return res.status(409).json({ ok: false, ...blocker });
        }
        const linkedGantt = nextGanttRentals.filter(item => linkedRentalIds(item).some(id => String(id || '') === String(removed.id || '')));
        cascadedGanttCount = linkedGantt.length;
        affectedRentals = [...affectedRentals, ...linkedGantt];
        nextGanttRentals = nextGanttRentals.filter(item => !linkedRentalIds(item).some(id => String(id || '') === String(removed.id || '')));
      } else if (!isStandalonePlannerRow(removed)) {
        const linkedClassic = linkedRentalIds(removed).find(id => nextRentals.some(rental => String(rental?.id || '') === String(id || '')));
        if (linkedClassic) {
          return res.status(409).json({
            ok: false,
            code: 'LINKED_GANTT_DELETE_REQUIRES_RENTAL_DELETE',
            error: 'Связанную строку планировщика нельзя удалить отдельно от карточки аренды.',
            field: 'rentalId',
          });
        }
      }

      const lifecycle = reconcileRentalEquipment({
        rentals: nextRentals,
        ganttRentals: nextGanttRentals,
        equipmentList,
        affectedRentals,
        author: req.user.userName,
        reason: `Удаление ${collection} ${removed.id}`,
      });
      try {
        const writes = [
          { name: collection, value: collection === 'rentals' ? nextRentals : nextGanttRentals },
          ...(collection === 'rentals' ? [{ name: 'gantt_rentals', value: nextGanttRentals }] : []),
          ...(lifecycle.changed ? [{ name: 'equipment', value: lifecycle.nextEquipment }] : []),
        ];
        persistDataBatch(writes);
      } catch (error) {
        return sendRentalPersistenceError(
          res,
          error,
          'RENTAL_DELETE_PERSISTENCE_FAILED',
          'Не удалось атомарно удалить аренду.',
        );
      }
      auditLog?.(req, {
        action: `${collection}.delete`,
        entityType: collection,
        entityId: req.params.id,
      });
      return res.json({
        ok: true,
        cascadedGanttCount,
        retainedHistory: collection === 'rentals' ? {
          payments: (readData('payments') || []).filter(item => String(item?.rentalId || '') === String(removed.id || '')).length,
          documents: (readData('documents') || []).filter(item => String(item?.rentalId || item?.rental || '') === String(removed.id || '')).length,
          service: (readData('service') || []).filter(item => String(item?.rentalId || '') === String(removed.id || '')).length,
          deliveries: (readData('deliveries') || []).filter(item => [item?.rentalId, item?.classicRentalId].some(id => String(id || '') === String(removed.id || ''))).length,
        } : undefined,
      });
    });

    router.put(`/${collection}`, requireAuth, (req, res) => {
      if (rejectDirectGanttProjectionMutation(res, collection)) return;
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PUT');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const body = req.body;
      let list = Array.isArray(body) ? body : body.data;
      if (!Array.isArray(list)) {
        return res.status(400).json({ ok: false, error: 'Expected array' });
      }
      if (['rentals', 'gantt_rentals'].includes(collection)) {
        const forgedAuditFields = [...new Set(list.flatMap(item => rentalServerOwnedAuditFields(item)))];
        if (forgedAuditFields.length > 0) {
          return res.status(403).json({
            ok: false,
            code: 'RENTAL_AUDIT_FIELDS_IMMUTABLE',
            error: `Audit-поля аренды нельзя менять через bulk replace: ${forgedAuditFields.join(', ')}.`,
          });
        }
      }
      try {
        for (const item of list) {
          assertRentalDoesNotTargetProductionSmokeFixture(item, `${collection}.bulk_replace`);
        }
      } catch (error) {
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, auditLog, error);
        }
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }
      try {
        accessControl.assertSafeAdminBulkReplaceInput(collection, list);
      } catch (error) {
        return res.status(error?.status || 403).json({
          ok: false,
          ...(error?.code ? { code: error.code } : {}),
          error: error?.message || 'Forbidden',
        });
      }

      const existingList = readData(collection) || [];
      const incomingIds = new Set(list.map(item => String(item?.id || '')).filter(Boolean));
      const removedItems = existingList.filter(item => !incomingIds.has(String(item?.id || '')));
      if (collection === 'rentals') {
        for (const removed of removedItems) {
          const blocker = rentalDeleteBlocker(removed.id);
          if (blocker) return res.status(409).json({ ok: false, ...blocker });
        }
      } else {
        const classicIds = new Set((readData('rentals') || []).map(item => String(item?.id || '')));
        const forbiddenRemoval = removedItems.find(item => (
          !isStandalonePlannerRow(item)
          && linkedRentalIds(item).some(id => classicIds.has(String(id || '')))
        ));
        if (forbiddenRemoval) {
          return res.status(409).json({
            ok: false,
            code: 'LINKED_GANTT_DELETE_REQUIRES_RENTAL_DELETE',
            error: `Строку планировщика ${forbiddenRemoval.id} нельзя удалить отдельно от карточки аренды.`,
          });
        }
      }

      const plannerSyncRentalIds = new Set();
      if (collection === 'rentals') {
        const existingById = new Map((readData('rentals') || []).map(item => [String(item?.id || ''), item]));
        try {
          list = list.map(item => {
            const existing = existingById.get(String(item?.id || '')) || null;
            if (!existing) {
              plannerSyncRentalIds.add(String(item?.id || ''));
              return canonicalizeRentalCreatePayload(item);
            }
            const changedPlannerFields = [...RENTAL_PLANNER_SYNC_FIELDS].filter(field =>
              Object.prototype.hasOwnProperty.call(existing, field) !== Object.prototype.hasOwnProperty.call(item, field)
              || JSON.stringify(existing[field] ?? null) !== JSON.stringify(item[field] ?? null)
            );
            if (changedPlannerFields.length > 0) plannerSyncRentalIds.add(String(item.id || ''));
            const changedProtectedFields = [...new Set([
              ...rentalMutationProtectedFields(existing),
              ...rentalMutationProtectedFields(item),
            ])].filter(field =>
              Object.prototype.hasOwnProperty.call(existing, field) !== Object.prototype.hasOwnProperty.call(item, field)
              || JSON.stringify(existing[field] ?? null) !== JSON.stringify(item[field] ?? null)
            );
            if (changedProtectedFields.length === 0) return item;
            return canonicalizeRentalCreatePayload(item);
          });
        } catch (error) {
          return sendRentalPayloadValidationError(res, error);
        }
      }

      const equipment = readData('equipment') || [];
      for (const item of list) {
        const validation = validateRentalPayload(collection, item, list, equipment, item.id);
        if (!validation.ok) {
          return res.status(validation.status).json({ ok: false, error: validation.error });
        }
      }

      const linkedList = list.map(item => withClientLink(item, `${collection}:bulk:${item?.id || 'new'}`));
      let nextList = linkedList;
      if (collection === 'gantt_rentals') {
        const existingById = new Map((readData('gantt_rentals') || []).map(item => [String(item?.id || ''), item]));
        nextList = [];
        for (const item of linkedList) {
          const existing = existingById.get(String(item?.id || '')) || null;
          const candidate = {
            ...item,
            rentalId: Object.prototype.hasOwnProperty.call(item || {}, 'rentalId') ? item.rentalId : existing?.rentalId,
            sourceRentalId: Object.prototype.hasOwnProperty.call(item || {}, 'sourceRentalId') ? item.sourceRentalId : existing?.sourceRentalId,
            originalRentalId: Object.prototype.hasOwnProperty.call(item || {}, 'originalRentalId') ? item.originalRentalId : existing?.originalRentalId,
          };
          const linked = linkGanttRentalForWrite(candidate, linkedList, `${collection}:bulk:${item?.id || 'new'}`, item?.id || '');
          if (!linked.ok) {
            return res.status(linked.status || 400).json({ ok: false, error: linked.code || linked.error, message: linked.error });
          }
          nextList.push(linked.item);
        }
        nextList = normalizeGanttRentalList(nextList);
      }
      try {
        const existingById = new Map((readData(collection) || []).map(item => [String(item?.id || ''), item]));
        nextList = nextList.map(item => {
          const existing = existingById.get(String(item?.id || '')) || null;
          let normalized = normalizeRentalRelationLinks(item, existing);
          normalized = canonicalizeRentalEquipment(normalized, existing, {
            equipmentFieldsTouched: !existing || rentalLifecycleFieldsTouched(item),
          });
          normalized = canonicalizeRentalManager(normalized, existing, {
            managerFieldsTouched: !existing
              || JSON.stringify(existing?.managerId ?? null) !== JSON.stringify(item?.managerId ?? null)
              || JSON.stringify(existing?.manager ?? null) !== JSON.stringify(item?.manager ?? null),
          });
          return normalized;
        });
        if (collection === 'rentals') {
          for (const rental of nextList) {
            const existing = existingById.get(String(rental?.id || '')) || null;
            const terminalValidation = validateTerminalRentalTransition(existing, rental);
            if (!terminalValidation.ok) return sendRentalLifecycleError(res, terminalValidation);
          }
        }
        for (const item of nextList) {
          assertRentalDoesNotTargetProductionSmokeFixture(item, `${collection}.bulk_replace`);
        }
      } catch (error) {
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, auditLog, error);
        }
        return sendRentalPayloadValidationError(res, error);
      }

      let nextRentals = collection === 'rentals' ? nextList : (readData('rentals') || []);
      let nextGanttRentals = collection === 'gantt_rentals' ? nextList : (readData('gantt_rentals') || []);
      if (collection === 'rentals') {
        const removedRentalIds = new Set(removedItems.map(item => String(item?.id || '')));
        const nextRentalById = new Map(nextRentals.map(item => [String(item?.id || ''), item]));
        nextGanttRentals = nextGanttRentals
          .filter(item => !linkedRentalIds(item).some(id => removedRentalIds.has(String(id || ''))))
          .map(item => {
            const linkedRentalId = linkedRentalIds(item).find(id => nextRentalById.has(String(id || '')));
            const nextRental = linkedRentalId ? nextRentalById.get(String(linkedRentalId)) : null;
            if (!nextRental || !plannerSyncRentalIds.has(String(linkedRentalId || ''))) return item;
            return ensureGanttRentalLink(
              syncGanttRentalFields(item, null, nextRental, req.user.userName, equipment),
              nextRental,
              equipment,
            );
          });
        const linkedClassicIds = new Set(nextGanttRentals.flatMap(item => linkedRentalIds(item).map(String)));
        for (const rental of nextRentals) {
          if (linkedClassicIds.has(String(rental.id || ''))) continue;
          const createdGantt = mergeRentalHistory(null, buildLinkedGanttRentalFromClassic(rental), req.user.userName);
          nextGanttRentals.push(createdGantt);
          linkedClassicIds.add(String(rental.id || ''));
        }
        const existingById = new Map(existingList.map(item => [String(item?.id || ''), item]));
        for (const rental of nextRentals) {
          const existing = existingById.get(String(rental?.id || '')) || null;
          if (!existing || rentalLifecycleFieldsTouched(Object.fromEntries(
            Object.keys(rental).filter(field => JSON.stringify(existing?.[field] ?? null) !== JSON.stringify(rental?.[field] ?? null)).map(field => [field, rental[field]]),
          ))) {
            const lifecycleValidation = validateLifecycleCandidate(rental);
            if (!lifecycleValidation.ok) return sendRentalLifecycleError(res, lifecycleValidation);
          }
        }
      } else {
        const existingById = new Map(existingList.map(item => [String(item?.id || ''), item]));
        for (const ganttRental of nextGanttRentals) {
          const existing = existingById.get(String(ganttRental?.id || '')) || {};
          const authority = validateLinkedGanttAuthority(existing, ganttRental);
          if (!authority.ok) return sendRentalLifecycleError(res, authority);
        }
      }

      for (const ganttRental of nextGanttRentals) {
        const validation = validateRentalPayload(
          'gantt_rentals',
          ganttRental,
          nextGanttRentals,
          equipment,
          ganttRental.id,
          { skipConflictCheck: Boolean(linkedRentalIds(ganttRental).length) },
        );
        if (!validation.ok) {
          const { status, ...validationBody } = validation;
          return res.status(status).json(validationBody);
        }
      }
      const lifecycle = reconcileRentalEquipment({
        rentals: nextRentals,
        ganttRentals: nextGanttRentals,
        equipmentList: equipment,
        affectedRentals: [...removedItems, ...nextList],
        author: req.user.userName,
        reason: `Массовая замена ${collection}`,
      });
      try {
        const writes = [
          { name: collection, value: nextList },
          ...(collection === 'rentals' ? [{ name: 'gantt_rentals', value: nextGanttRentals }] : []),
          ...(lifecycle.changed ? [{ name: 'equipment', value: lifecycle.nextEquipment }] : []),
        ];
        persistDataBatch(writes);
      } catch (error) {
        return sendRentalPersistenceError(
          res,
          error,
          'RENTAL_BULK_REPLACE_PERSISTENCE_FAILED',
          'Не удалось атомарно заменить аренды.',
        );
      }
      auditLog?.(req, {
        action: `${collection}.bulk_replace`,
        entityType: collection,
        after: { count: nextList.length },
      });
      return res.json({ ok: true, count: nextList.length });
    });
  }

  registerRentalCollection('rentals');
  registerRentalCollection('gantt_rentals');

  return router;
}

module.exports = {
  registerRentalRoutes,
};
