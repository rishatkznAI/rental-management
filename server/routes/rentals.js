const express = require('express');
const {
  appendRentalHistory,
  buildRentalChangeRequest,
  buildRentalImmediateHistoryEntries,
  buildRentalPendingApprovalHistoryEntries,
  displayValue,
  getFieldLabel,
  resolveRentalForChangeRequest,
  splitRentalPatch,
  stripRentalPatchMeta,
  syncGanttRentalFields,
} = require('../lib/rental-change-requests');
const { rentalMatchesEquipment } = require('../lib/rental-validation');
const { LEGACY_AUDIT_COLLECTION, redactAuditValue } = require('../lib/security-audit');

const AUDIT_COLLECTION = 'audit_logs';
const RENTAL_AUDIT_LIMIT = 20;
const CLOSED_RENTAL_STATUSES = new Set(['closed', 'returned', 'cancelled', 'canceled', 'completed']);
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
    generateId,
    idPrefixes,
    accessControl,
    auditLog,
    botNotifications = null,
  } = deps;

  const router = express.Router();
  const requiredAccessMethods = ['filterCollectionByScope', 'canAccessEntity', 'assertCanUpdateEntity', 'splitForbiddenRentalManagerPatch'];
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
      });
    }

    function buildLinkedGanttRentalUpdate(linkedGanttRentalId, previousRental, nextRental, author) {
      if (!linkedGanttRentalId) return null;
      const ganttRentals = readData('gantt_rentals') || [];
      const ganttIdx = ganttRentals.findIndex(entry => entry.id === linkedGanttRentalId);
      if (ganttIdx === -1) return null;
      return {
        ganttRentals,
        ganttIdx,
        nextGanttRental: syncGanttRentalFields(ganttRentals[ganttIdx], previousRental, nextRental, author),
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
      );
    }

    function syncLinkedGanttRental(linkedGanttRentalId, previousRental, nextRental, author) {
      const update = buildLinkedGanttRentalUpdate(linkedGanttRentalId, previousRental, nextRental, author);
      if (!update) return;
      const { ganttRentals, ganttIdx, nextGanttRental } = update;
      ganttRentals[ganttIdx] = nextGanttRental;
      writeData('gantt_rentals', ganttRentals);
    }

    function mergeGanttRentalForRepair(primary, fallback) {
      if (!fallback) return primary;
      if (!primary) return fallback;
      return {
        ...fallback,
        ...primary,
        clientId: primary.clientId || fallback.clientId,
        client: primary.client || fallback.client,
        clientShort: primary.clientShort || fallback.clientShort,
        equipmentId: primary.equipmentId || fallback.equipmentId,
        equipmentInv: primary.equipmentInv || fallback.equipmentInv || fallback.inventoryNumber,
        startDate: primary.startDate || fallback.startDate,
        endDate: primary.endDate || primary.plannedReturnDate || fallback.endDate || fallback.plannedReturnDate,
        manager: primary.manager || fallback.manager,
        managerId: primary.managerId || fallback.managerId,
        amount: primary.amount ?? fallback.amount,
      };
    }

    function generateUniqueRentalId(existingRentals) {
      const existingIds = new Set((existingRentals || []).map(item => String(item?.id || '')));
      let id = generateId(prefix);
      for (let attempt = 0; attempt < 5 && existingIds.has(id); attempt += 1) {
        id = generateId(prefix);
      }
      return id;
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
      return ['new', 'in_progress', 'waiting_parts'];
    }

    function findEquipmentForRental(rental, equipmentList) {
      return (equipmentList || []).find(equipment => rentalMatchesEquipment(rental, equipment, equipmentList)) || null;
    }

    function findLinkedGanttRental(classicRental, routeId) {
      const ganttRentals = readData('gantt_rentals') || [];
      const normalizedRouteId = String(routeId || '');
      const classicId = String(classicRental?.id || '');
      return ganttRentals.find(item => String(item.id || '') === normalizedRouteId)
        || ganttRentals.find(item =>
          classicId &&
          [item.rentalId, item.sourceRentalId, item.originalRentalId].some(id => String(id || '') === classicId)
        )
        || ganttRentals.find(item => {
          if (!classicRental) return false;
          const sameClient = item.clientId && classicRental.clientId
            ? item.clientId === classicRental.clientId
            : item.client === classicRental.client;
          if (!sameClient) return false;
          const sameDates = item.startDate === classicRental.startDate
            && item.endDate === classicRental.plannedReturnDate;
          if (!sameDates) return false;
          const equipmentList = readData('equipment') || [];
          const equipment = findEquipmentForRental(classicRental, equipmentList);
          return equipment ? rentalMatchesEquipment(item, equipment, equipmentList) : false;
        })
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
      }
      if (!ganttRental && classicRental) {
        ganttRental = findLinkedGanttRental(classicRental, routeId);
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

    function findExtensionConflict({ classicRental, ganttRental, newPlannedReturnDate, equipmentList, rentals, ganttRentals }) {
      const currentEnd = normalizeDateKey(classicRental?.plannedReturnDate || ganttRental?.endDate);
      const extensionEnd = normalizeDateKey(newPlannedReturnDate);
      const equipment = findEquipmentForRental(classicRental || ganttRental, equipmentList);
      if (!equipment || !currentEnd || !extensionEnd) return null;
      const currentId = String(classicRental?.id || '');
      const linkedGanttId = String(ganttRental?.id || '');
      const candidates = [
        ...(ganttRentals || []).map(item => ({ ...item, __collection: 'gantt_rentals' })),
        ...(rentals || []).map(item => ({ ...item, __collection: 'rentals' })),
      ];
      return candidates.find(item => {
        if (!item) return false;
        if (item.__collection === 'rentals' && String(item.id || '') === currentId) return false;
        if (item.__collection === 'gantt_rentals' && String(item.id || '') === linkedGanttId) return false;
        if (currentId && [item.rentalId, item.sourceRentalId, item.originalRentalId].some(id => String(id || '') === currentId)) return false;
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

    function isReturnedClassicRental(rental) {
      return Boolean(rental?.actualReturnDate) || rental?.status === 'closed' || rental?.status === 'returned';
    }

    function isReturnedGanttRental(rental) {
      return rental?.status === 'returned' || rental?.status === 'closed';
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

    function hasOtherBlockingRental(ganttRentals, currentGanttId, equipment) {
      if (!equipment) return false;
      const equipmentList = readData('equipment') || [];
      return (ganttRentals || []).some(rental =>
        String(rental.id || '') !== String(currentGanttId || '') &&
        rentalMatchesEquipment(rental, equipment, equipmentList) &&
        rental.status !== 'returned' &&
        rental.status !== 'closed'
      );
    }

    function buildReturnServiceTicket(rental, equipment, returnDate, damageDescription, author) {
      const now = new Date().toISOString();
      return {
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
        clientId: rental?.clientId,
        client: rental?.client,
      };
    }

    function buildClassicRentalFromGantt(ganttRental, rawMeta, author, existingRentals) {
      const equipmentList = readData('equipment') || [];
      const equipmentById = equipmentList.find(item => item.id === ganttRental.equipmentId);
      const equipmentInv = ganttRental.equipmentInv || ganttRental.inventoryNumber || equipmentById?.inventoryNumber || '';
      const oldValues = rawMeta.oldValues || {};
      const restored = withClientLink({
        id: generateUniqueRentalId(existingRentals),
        clientId: ganttRental.clientId || oldValues.clientId || '',
        client: ganttRental.client || oldValues.client || '',
        contact: ganttRental.contact || '',
        startDate: oldValues.startDate || ganttRental.startDate || '',
        plannedReturnDate: oldValues.plannedReturnDate || oldValues.endDate || ganttRental.endDate || ganttRental.plannedReturnDate || '',
        equipmentId: ganttRental.equipmentId || '',
        equipmentInv,
        equipment: equipmentInv ? [equipmentInv] : (ganttRental.equipmentId ? [ganttRental.equipmentId] : []),
        rate: ganttRental.rate || '',
        price: Number(ganttRental.amount ?? ganttRental.price) || 0,
        discount: Number(ganttRental.discount) || 0,
        deliveryAddress: ganttRental.deliveryAddress || '',
        deliveryTime: ganttRental.deliveryTime || '',
        manager: ganttRental.manager || '',
        managerId: ganttRental.managerId || '',
        status: ganttRental.status === 'closed' || ganttRental.status === 'returned' ? ganttRental.status : 'active',
        expectedPaymentDate: ganttRental.expectedPaymentDate || '',
        paymentStatus: ganttRental.paymentStatus || '',
        documents: Array.isArray(ganttRental.documents) ? ganttRental.documents : [],
        comments: '',
        history: [{
          date: new Date().toISOString(),
          text: `Карточка аренды восстановлена из записи планировщика ${ganttRental.id}`,
          author: author || 'Система',
          type: 'system',
        }],
      }, `rentals:repair-from-gantt:${ganttRental.id}`);
      return restored;
    }

    function restoreOrphanGanttRentalIfSafe(req, data, rawMeta, fallbackGanttRental, resolution) {
      if (collection !== 'rentals') return null;
      if (resolution?.status !== 404) return null;
      const requestedIds = [
        req.params.id,
        rawMeta.linkedGanttRentalId,
        rawMeta.ganttRentalId,
        fallbackGanttRental?.id,
      ].map(value => String(value || '').trim()).filter(Boolean);
      if (!requestedIds.some(value => /^GR-/i.test(value))) return null;

      const ganttRentals = readData('gantt_rentals') || [];
      const ganttIdx = ganttRentals.findIndex(item => requestedIds.some(id => String(item?.id || '') === id));
      if (ganttIdx === -1) return null;
      const exactGanttRental = ganttRentals[ganttIdx];
      if (exactGanttRental.rentalId || exactGanttRental.sourceRentalId || exactGanttRental.originalRentalId) return null;

      try {
        accessControl.assertCanUpdateEntity('gantt_rentals', exactGanttRental, req.user);
      } catch {
        return null;
      }

      const repairSource = mergeGanttRentalForRepair(exactGanttRental, fallbackGanttRental);
      const restoredRental = buildClassicRentalFromGantt(repairSource, rawMeta, req.user?.userName, data);
      const validation = validateRentalPayload('rentals', restoredRental, data, readData('equipment') || [], '', { skipConflictCheck: false });
      if (!validation.ok) {
        console.warn('[rental-approval] orphan gantt repair skipped', JSON.stringify({
          ganttRentalId: exactGanttRental.id,
          status: validation.status,
          error: validation.error,
        }));
        return null;
      }

      data.push(restoredRental);
      writeData('rentals', data);
      const repairedGanttRental = {
        ...exactGanttRental,
        rentalId: restoredRental.id,
        sourceRentalId: restoredRental.id,
        originalRentalId: exactGanttRental.originalRentalId || restoredRental.id,
      };
      ganttRentals[ganttIdx] = repairedGanttRental;
      writeData('gantt_rentals', ganttRentals);
      auditLog?.(req, {
        action: 'rentals.repair_from_gantt',
        entityType: 'rentals',
        entityId: restoredRental.id,
        after: { rentalId: restoredRental.id, ganttRentalId: repairedGanttRental.id },
      });
      return { restoredRental, ganttRentals };
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

    function createApprovalRequests(previousRental, changes, meta, req) {
      if (!changes.length) return [];
      const requests = readData('rental_change_requests') || [];
      const created = changes.map(change => buildRentalChangeRequest({
        id: generateId(requestPrefix),
        rental: previousRental,
        linkedGanttRentalId: meta.linkedGanttRentalId,
        sourceRentalId: meta.sourceRentalId,
        change,
        initiator: req.user,
        reason: meta.reason,
        comment: meta.comment,
        attachments: meta.attachments,
      }));
      writeData('rental_change_requests', [...requests, ...created]);
      return created;
    }

    function validateImmediateRentalPatch(previousRental, patch, data, approvalChanges, meta, author) {
      if (Object.keys(patch).length === 0) {
        return { ok: true, patch, nextItem: previousRental };
      }

      let nextPatch = { ...patch };
      let nextItem = withClientLink({ ...previousRental, ...nextPatch, id: previousRental.id }, `${collection}:approval:${previousRental.id}`);
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
        nextItem = withClientLink({ ...previousRental, ...nextPatch, id: previousRental.id }, `${collection}:approval:${previousRental.id}`);
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
      return res.json(accessControl.sanitizeCollectionForRead(
        collection,
        accessControl.filterCollectionByScope(collection, data, req.user),
        req.user,
      ));
    });

    router.get(`/${collection}/:id`, requireAuth, requireRead(collection), (req, res) => {
      const data = readData(collection) || [];
      const item = data.find(entry => entry.id === req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
      if (!accessControl.canAccessEntity(collection, item, req.user)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      return res.json(accessControl.sanitizeEntityForRead(collection, item, req.user));
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
          ganttRental = findLinkedGanttRental(classicRental, routeId);
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
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'POST');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const data = readData(collection) || [];
      const equipment = readData('equipment') || [];
      const validation = validateRentalPayload(collection, req.body, data, equipment);
      if (!validation.ok) {
        return res.status(validation.status).json({ ok: false, error: validation.error });
      }

      let newItem = withClientLink({ ...req.body, id: req.body.id || generateId(prefix) }, `${collection}:create`);
      if (collection === 'gantt_rentals') {
        newItem = normalizeGanttRentalStatus(newItem);
        newItem = mergeRentalHistory(null, newItem, req.user.userName);
      }
      data.push(newItem);
      writeData(collection, data);
      auditLog?.(req, {
        action: `${collection}.create`,
        entityType: collection,
        entityId: newItem.id,
        after: newItem,
      });
      return res.status(201).json(newItem);
    });

    router.patch(`/${collection}/:id`, requireAuth, async (req, res) => {
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const { patch, meta: rawMeta } = stripRentalPatchMeta(req.body);
      let meta = rawMeta;
      const data = readData(collection) || [];
      let idx = data.findIndex(entry => String(entry.id) === String(req.params.id));
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
        let ganttRentalsForResolution = readData('gantt_rentals') || [];
        let resolution = resolveRentalForChangeRequest({
          rentalId: safeRentalId || safeSourceRentalId || req.params.id,
          linkedGanttRentalId,
          fallbackGanttRental,
          rentals: data,
          ganttRentals: ganttRentalsForResolution,
          equipment: readData('equipment') || [],
          context: `${req.method} ${req.originalUrl || req.url}`,
        });
        if (!resolution.ok) {
          const repaired = restoreOrphanGanttRentalIfSafe(req, data, rawMeta, fallbackGanttRental, resolution);
          if (repaired) {
            ganttRentalsForResolution = repaired.ganttRentals;
            resolution = resolveRentalForChangeRequest({
              rentalId: repaired.restoredRental.id,
              linkedGanttRentalId,
              fallbackGanttRental: {
                ...fallbackGanttRental,
                rentalId: repaired.restoredRental.id,
                sourceRentalId: repaired.restoredRental.id,
                originalRentalId: repaired.restoredRental.id,
              },
              rentals: data,
              ganttRentals: ganttRentalsForResolution,
              equipment: readData('equipment') || [],
              context: `${req.method} ${req.originalUrl || req.url}`,
            });
          }
        }
        if (!resolution.ok) {
          const debug = buildRentalResolutionDebug(req, resolution, rawMeta);
          logRentalResolutionFailure(req, resolution, rawMeta);
          return res.status(resolution.status).json({
            ok: false,
            error: resolution.error,
            details: {
              ...resolution.details,
              ...debug,
            },
          });
        }
        idx = resolution.rentalIndex;
        meta = {
          ...rawMeta,
          sourceRentalId: safeSourceRentalId || resolution.sourceRentalId || '',
          linkedGanttRentalId: rawMeta.linkedGanttRentalId || rawMeta.ganttRentalId || resolution.linkedGanttRentalId || '',
        };
      }
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      try {
        accessControl.assertCanUpdateEntity(collection, data[idx], req.user);
      } catch (error) {
        return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
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

        const immediateValidation = validateImmediateRentalPatch(previousRental, immediatePatch, data, approvalChanges, meta, req.user.userName);
        if (!immediateValidation.ok) {
          return res.status(immediateValidation.status).json({ ok: false, error: immediateValidation.error });
        }

        const createdRequests = createApprovalRequests(previousRental, approvalChanges, meta, req);
        let nextItem = immediateValidation.nextItem;
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
          writeData(collection, data);
          auditLog?.(req, {
            action: 'rentals.update',
            entityType: 'rentals',
            entityId: nextItem.id,
            before: previousRental,
            after: nextItem,
          });
          syncLinkedGanttRental(meta.linkedGanttRentalId, previousRental, nextItem, req.user.userName);
          await emitRentalNotification(previousRental, nextItem);
        } else if (createdRequests.length > 0) {
          data[idx] = appendRentalHistory(previousRental, pendingHistoryEntries);
          writeData(collection, data);
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

      let nextItem = withClientLink({ ...data[idx], ...patch, id: data[idx].id }, `${collection}:update:${data[idx].id}`);
      if (collection === 'gantt_rentals') {
        nextItem = normalizeGanttRentalStatus(nextItem);
      }
      const validation = validateRentalPayload(collection, nextItem, data, readData('equipment') || [], data[idx].id);
      if (!validation.ok) {
        return res.status(validation.status).json({ ok: false, error: validation.error });
      }
      if (collection === 'rentals') {
        const linkedValidation = validateLinkedGanttRental(meta.linkedGanttRentalId, data[idx], nextItem, req.user.userName);
        if (!linkedValidation.ok) {
          return res.status(linkedValidation.status).json({ ok: false, error: linkedValidation.error });
        }
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
      writeData(collection, data);
      auditLog?.(req, {
        action: `${collection}.update`,
        entityType: collection,
        entityId: nextItem.id,
        before: previousRental,
        after: nextItem,
      });
      if (collection === 'rentals') {
        syncLinkedGanttRental(meta.linkedGanttRentalId, previousRental, nextItem, req.user.userName);
      }
      await emitRentalNotification(previousRental, nextItem);
      return res.json(data[idx]);
    });

    if (collection === 'rentals') {
      router.post(`/${collection}/:id/extend`, requireAuth, async (req, res) => {
        const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
        if (forbiddenReason) {
          return res.status(403).json({ ok: false, error: forbiddenReason });
        }

        const rentals = readData(collection) || [];
        const ganttRentals = readData('gantt_rentals') || [];
        const equipmentList = readData('equipment') || [];
        const routeId = String(req.params.id || '');
        const newPlannedReturnDate = normalizeDateKey(req.body?.newPlannedReturnDate);
        const reason = String(req.body?.reason || '').trim();
        const comment = String(req.body?.comment || '').trim();
        const { classicRental, ganttRental } = findClassicRentalForRoute(routeId, rentals, ganttRentals);

        if (!classicRental && !ganttRental) {
          return res.status(404).json({ ok: false, error: 'Аренда для продления не найдена.' });
        }
        const rentalForAccess = classicRental || ganttRental;
        try {
          accessControl.assertCanUpdateEntity(classicRental ? 'rentals' : 'gantt_rentals', rentalForAccess, req.user);
        } catch (error) {
          return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
        }

        const currentEnd = normalizeDateKey(classicRental?.plannedReturnDate || ganttRental?.endDate || ganttRental?.plannedReturnDate);
        if (!reason) return res.status(400).json({ ok: false, error: 'Укажите причину продления.' });
        if (!newPlannedReturnDate || !parseDateKey(newPlannedReturnDate)) {
          return res.status(400).json({ ok: false, error: 'Укажите новую дату окончания аренды.' });
        }
        if (!currentEnd || !parseDateKey(currentEnd)) {
          return res.status(400).json({ ok: false, error: 'В аренде не указана текущая дата окончания.' });
        }
        if (compareDateKeys(newPlannedReturnDate, currentEnd) <= 0) {
          return res.status(400).json({ ok: false, error: 'Новая дата должна быть позже текущей даты окончания.' });
        }
        if (compareDateKeys(newPlannedReturnDate, new Date().toISOString().slice(0, 10)) < 0) {
          return res.status(400).json({ ok: false, error: 'Нельзя продлить аренду в прошлую дату.' });
        }
        if (isClosedRentalStatus(classicRental?.status) || isClosedRentalStatus(ganttRental?.status)) {
          return res.status(409).json({ ok: false, error: 'Нельзя продлить закрытую или отменённую аренду.' });
        }
        if (!hasRentalEquipment(classicRental || ganttRental)) {
          return res.status(409).json({ ok: false, error: 'Нельзя продлить аренду без техники.' });
        }

        const conflict = findExtensionConflict({
          classicRental,
          ganttRental,
          newPlannedReturnDate,
          equipmentList,
          rentals,
          ganttRentals,
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
                reason,
                comment,
              }, req)
            : [];
          auditLog?.(req, {
            action: 'rentals.change_request',
            entityType: 'rentals',
            entityId: classicRental?.id || ganttRental?.id,
            after: { rentalId: classicRental?.id, requestIds: createdRequests.map(item => item.id) },
            metadata: { reason, comment, conflict: conflictDto(conflict) },
          });
          return res.status(202).json({
            ok: true,
            applied: false,
            rental: classicRental || null,
            ganttRental: ganttRental || null,
            conflict: conflictDto(conflict),
            approval: {
              created: createdRequests.length > 0,
              requestIds: createdRequests.map(item => item.id),
            },
          });
        }

        const author = req.user?.userName || 'Система';
        const classicIdx = classicRental ? rentals.findIndex(item => item.id === classicRental.id) : -1;
        const ganttIdx = ganttRental ? ganttRentals.findIndex(item => item.id === ganttRental.id) : -1;
        const nextClassic = classicRental
          ? appendRentalHistory(
              { ...classicRental, plannedReturnDate: newPlannedReturnDate },
              [buildExtensionHistoryEntry(currentEnd, newPlannedReturnDate, reason, comment, author)],
            )
          : null;
        const nextGantt = ganttRental
          ? mergeRentalHistory(ganttRental, {
              ...ganttRental,
              endDate: newPlannedReturnDate,
              plannedReturnDate: newPlannedReturnDate,
            }, author)
          : null;

        if (nextClassic) {
          const validation = validateRentalPayload('rentals', nextClassic, rentals, equipmentList, classicRental.id);
          if (!validation.ok) return res.status(validation.status).json({ ok: false, error: validation.error });
        }
        if (nextGantt) {
          const validation = validateRentalPayload('gantt_rentals', nextGantt, ganttRentals, equipmentList, ganttRental.id);
          if (!validation.ok) return res.status(validation.status).json({ ok: false, error: validation.error });
        }

        if (classicIdx !== -1 && nextClassic) {
          rentals[classicIdx] = nextClassic;
          writeData(collection, rentals);
        }
        if (ganttIdx !== -1 && nextGantt) {
          ganttRentals[ganttIdx] = nextGantt;
          writeData('gantt_rentals', ganttRentals);
        }

        const auditMetadata = {
          oldPlannedReturnDate: currentEnd,
          newPlannedReturnDate,
          reason,
          comment,
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

        let classicRental = data.find(item => String(item.id) === routeId) || null;
        let ganttRental = null;
        if (!classicRental) {
          ganttRental = ganttRentals.find(item => String(item.id) === routeId) || null;
          const linkedClassicId = ganttRental?.rentalId || ganttRental?.sourceRentalId || ganttRental?.originalRentalId || '';
          classicRental = linkedClassicId
            ? data.find(item => String(item.id) === String(linkedClassicId)) || null
            : null;
        }
        if (!ganttRental) {
          ganttRental = findLinkedGanttRental(classicRental, routeId);
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

        if (isReturnedClassicRental(classicRental) || isReturnedGanttRental(ganttRental)) {
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
          return mergeRentalHistory(
            item,
            {
              ...item,
              endDate: returnDate || item.endDate,
              status: 'returned',
            },
            author,
          );
        });

        const otherBlockingRental = hasOtherBlockingRental(nextGanttRentals, ganttRental?.id, equipment);
        const nextService = readData('service') || [];
        let createdServiceTicket = null;
        let resultingEquipmentStatus = equipment.status;
        if (hasDamage) {
          resultingEquipmentStatus = 'in_service';
          if (!openServiceTicket) {
            createdServiceTicket = buildReturnServiceTicket(classicRental || ganttRental, equipment, returnDate, damageDescription, author);
            nextService.push(createdServiceTicket);
          }
        } else if (otherBlockingRental) {
          resultingEquipmentStatus = 'rented';
        } else {
          resultingEquipmentStatus = 'available';
        }

        const nextEquipment = equipmentList.map(item => {
          if (item.id !== equipment.id) return item;
          return {
            ...item,
            status: resultingEquipmentStatus,
            currentClient: otherBlockingRental ? item.currentClient : undefined,
            returnDate: otherBlockingRental ? item.returnDate : undefined,
            history: [
              ...(Array.isArray(item.history) ? item.history : []),
              {
                date: new Date().toISOString(),
                text: hasDamage
                  ? 'Возврат из аренды: техника переведена в сервис'
                  : otherBlockingRental
                    ? 'Возврат из аренды: техника осталась занята другой активной арендой'
                    : 'Возврат из аренды: техника доступна',
                author,
                type: 'system',
              },
            ],
          };
        });

        writeData(collection, nextRentals);
        writeData('gantt_rentals', nextGanttRentals);
        writeData('equipment', nextEquipment);
        if (createdServiceTicket) writeData('service', nextService);

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

    router.delete(`/${collection}/:id`, requireAuth, (req, res) => {
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'DELETE');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const data = readData(collection) || [];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });

      data.splice(idx, 1);
      writeData(collection, data);
      auditLog?.(req, {
        action: `${collection}.delete`,
        entityType: collection,
        entityId: req.params.id,
      });
      return res.json({ ok: true });
    });

    router.put(`/${collection}`, requireAuth, (req, res) => {
      const forbiddenReason = rentalWriteForbiddenReason(req, collection, 'PUT');
      if (forbiddenReason) {
        return res.status(403).json({ ok: false, error: forbiddenReason });
      }

      const body = req.body;
      const list = Array.isArray(body) ? body : body.data;
      if (!Array.isArray(list)) {
        return res.status(400).json({ ok: false, error: 'Expected array' });
      }

      const equipment = readData('equipment') || [];
      for (const item of list) {
        const validation = validateRentalPayload(collection, item, list, equipment, item.id);
        if (!validation.ok) {
          return res.status(validation.status).json({ ok: false, error: validation.error });
        }
      }

      const linkedList = list.map(item => withClientLink(item, `${collection}:bulk:${item?.id || 'new'}`));
      const nextList = collection === 'gantt_rentals'
        ? normalizeGanttRentalList(linkedList)
        : linkedList;

      writeData(collection, nextList);
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
