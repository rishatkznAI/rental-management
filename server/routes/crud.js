const express = require('express');
const { getEffectivePaidAmount, syncGanttRentalPaymentStatuses } = require('../lib/payment-status-sync');
const { normalizeRole } = require('../lib/role-groups');
const {
  buildPaginatedResponse,
  itemMatchesSearch,
  wantsPaginatedResponse,
} = require('../lib/pagination');
const { buildClientFinancialSnapshots } = require('../lib/finance-core');
const { assignCurrentUserAsMechanicIfNeeded } = require('../lib/service-assignment');
const {
  normalizeServiceTicketForWrite,
  normalizeServiceTicketList,
  normalizeServiceTicketRecord,
  serviceCreatedAtValue,
} = require('../lib/service-dto');
const { buildServiceRepeatBreakdowns, buildServiceRepairQualityView } = require('../lib/service-repeat-breakdowns');
const {
  SERVICE_REPAIR_ITEMS_ADMIN_MESSAGE,
  assertRepairItemsAdmin,
  inferServiceAuditSource,
  isRepairItemCollection,
} = require('../lib/service-audit-log');
const {
  RENTAL_CHANGE_REQUEST_STATUS,
  buildRequestDecisionNotificationStatus,
  displayValue,
} = require('../lib/rental-change-requests');
const {
  assertClientInnListUnique,
  assertClientInnValid,
  assertClientInnUnique,
  buildClientInnDuplicateReport,
  normalizeClientInnFields,
} = require('../lib/client-inn');
const {
  enrichRecordFromRentalLinks,
  normalizeClientRelationLinks,
  normalizeClientContractRecord,
  normalizeClientObjectRecord,
} = require('../lib/client-relations');
const {
  normalizeEquipmentReceiptPatch,
  shouldCreateReceiptServiceTicket,
} = require('../lib/equipment-receipt');
const {
  normalizeEquipmentDowntimeRecord,
  validateEquipmentDowntimePayload,
} = require('../lib/equipment-downtime');
const {
  normalizeEquipmentStoragePatch,
  normalizeEquipmentStorageRecord,
} = require('../lib/equipment-classification');
const {
  SYSTEM_FIXTURE_PROTECTED_CODE,
  SYSTEM_FIXTURE_PROTECTED_MESSAGE,
  assertProductionSmokeFixtureMutationAllowed,
  createSystemFixtureProtectedError,
  isAvailableForRentEquipment,
  isProductionSmokeEquipmentFixture,
} = require('../lib/protected-fixtures');
const { linkedRentalIds } = require('../lib/gantt-rental-link-guard');

function registerCrudRoutes(deps) {
  const {
    collections,
    idPrefixes,
    readData,
    writeData,
    deleteSessionsForUserIds,
    requireAuth,
    requireRead,
    requireWrite,
    sanitizeUser,
    publicUserView,
    canReadFullUsers,
    hashPassword,
    normalizeServiceWorkRecord,
    normalizeSparePartRecord,
    validateRentalPayload,
    mergeEntityHistory,
    requireNonEmptyString,
    generateId,
    nowIso,
    applyServiceTicketCreationEffects,
    accessControl,
    auditLog,
    serviceAuditLog,
    normalizeRecordClientLink,
    normalizeClientLinks,
  } = deps;

  const router = express.Router();
  const requiredAccessMethods = [
    'assertCanReadCollection',
    'assertCanCreateCollection',
    'assertCanUpdateEntity',
    'assertCanDeleteEntity',
    'assertCanBulkReplace',
    'assertSafeAdminBulkReplaceInput',
    'canAccessEntity',
    'filterCollectionByScope',
    'sanitizeCreateInput',
    'sanitizeUpdateInput',
  ];
  const missingAccessMethods = !accessControl
    ? requiredAccessMethods
    : requiredAccessMethods.filter(name => typeof accessControl[name] !== 'function');
  if (missingAccessMethods.length > 0) {
    throw new Error(`Generic CRUD requires access-control methods: ${missingAccessMethods.join(', ')}`);
  }

  function sendAccessError(res, error) {
    return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
  }

  function writeMiddlewares(collection) {
    return isRepairItemCollection(collection)
      ? [requireAuth]
      : [requireAuth, requireWrite(collection)];
  }

  function sendRepairItemsAdminError(res, error) {
    return res.status(error?.status || 403).json({
      ok: false,
      error: error?.message || SERVICE_REPAIR_ITEMS_ADMIN_MESSAGE,
    });
  }

  function isOfficeManager(req) {
    return req.user?.userRole === 'Офис-менеджер';
  }

  function isCriticalAuditCollection(collection) {
    return Boolean(collection);
  }

  function syncPaymentStatusesAfterPaymentWrite(payments) {
    const currentGanttRentals = readData('gantt_rentals') || [];
    const nextGanttRentals = syncGanttRentalPaymentStatuses(currentGanttRentals, payments, readData('payment_allocations') || []);
    writeData('gantt_rentals', nextGanttRentals);
  }

  function validateEquipmentDowntimeRecord(record, existingDowntimes, excludeId = '') {
    return validateEquipmentDowntimePayload(record, {
      equipment: readData('equipment') || [],
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      downtimes: existingDowntimes || [],
      excludeId,
    });
  }

  function createReceiptServiceTicket(previousItem, nextItem, authorName) {
    if (!shouldCreateReceiptServiceTicket(previousItem, nextItem)) return;
    const service = readData('service') || [];
    const alreadyExists = service.some(ticket =>
      ticket?.source === 'sales_receipt'
      && ticket?.equipmentId === nextItem.id
      && !['closed', 'ready'].includes(String(ticket?.status || '').toLowerCase())
    );
    if (alreadyExists) return;
    const ticket = normalizeServiceTicketForWrite({
      id: generateId(idPrefixes.service || 'S'),
      type: 'pdi',
      scenario: 'pdi',
      source: 'sales_receipt',
      saleMode: true,
      status: 'new',
      priority: 'high',
      equipmentId: nextItem.id,
      equipment: [nextItem.manufacturer, nextItem.model].filter(Boolean).join(' ') || nextItem.inventoryNumber || nextItem.id,
      inventoryNumber: nextItem.inventoryNumber || '',
      serialNumber: nextItem.serialNumber || '',
      reason: 'Замечания при приёмке новой техники',
      description: [
        nextItem.acceptanceComment,
        ...(Array.isArray(nextItem.acceptanceDefects) ? nextItem.acceptanceDefects : []),
      ].filter(Boolean).join('\n'),
      photos: nextItem.acceptancePhotos || {},
      createdAt: nowIso(),
      createdBy: authorName || 'Система',
      createdByUserId: '',
    }, {
      actor: { userName: authorName || 'Система' },
      isCreate: true,
      nowIso,
    });
    writeData('service', [...service, ticket]);
    applyServiceTicketCreationEffects?.(ticket, authorName || 'Система');
  }

  function relatedRentalsById() {
    const map = new Map();
    const rentals = readData('rentals') || [];
    const rentalIds = new Set(rentals.map(item => String(item?.id || '').trim()).filter(Boolean));
    rentals.forEach(item => {
      if (item?.id) map.set(String(item.id), item);
    });
    (readData('gantt_rentals') || []).forEach(item => {
      if (item?.id && linkedRentalIds(item).some(id => rentalIds.has(id))) map.set(String(item.id), item);
    });
    return map;
  }

  function withClientLink(collection, item) {
    if (typeof normalizeRecordClientLink !== 'function') return item;
    if (!['payments', 'documents', 'crm_deals'].includes(collection)) return item;
    // IMPORTANT: payments/documents must keep stable clientId links. Client name fields
    // are display labels and can change after the financial/document history is created.
    return normalizeRecordClientLink(item, readData('clients') || [], {
      context: `${collection}:${item?.id || item?.rentalId || item?.number || 'new'}`,
      relatedRentalsById: relatedRentalsById(),
      logger: console,
    });
  }

  function normalizeClientDomainRecord(collection, item, existing = null) {
    if (collection === 'clients') {
      const normalized = normalizeClientInnFields(item);
      assertClientInnValid(normalized);
      return normalized;
    }
    if (collection === 'client_objects') {
      return normalizeClientObjectRecord(item, existing, { readData, nowIso });
    }
    if (collection === 'client_contracts') {
      return normalizeClientContractRecord(item, existing, { readData, nowIso });
    }
    if (collection === 'payments' || collection === 'payment_allocations' || collection === 'documents' || collection === 'service') {
      const enriched = enrichRecordFromRentalLinks(item, readData);
      if (collection === 'service') validateServiceRelationLinks(enriched);
      const normalized = normalizeClientRelationLinks(enriched, enriched.clientId, {
        readData,
        requireActiveObject: !existing,
        allowArchivedObjectId: existing?.objectId,
        includeObjectSnapshot: collection === 'service',
        includeContractSnapshot: collection === 'service',
      });
      if (collection === 'payment_allocations') validatePaymentAllocationRecord(normalized, existing);
      return normalized;
    }
    return item;
  }

  function normalizeStoredClientLinksAfterClientWrite() {
    if (typeof normalizeClientLinks !== 'function') return;
    normalizeClientLinks({
      readData,
      writeData,
      logger: console,
    });
  }

  function normalizeClientName(value) {
    return String(value || '').trim().toLowerCase();
  }

  function text(value) {
    return String(value ?? '').trim();
  }

  function lowerText(value) {
    return text(value).toLowerCase().replaceAll('ё', 'е');
  }

  function inferServiceKindForPagination(ticket) {
    const kind = lowerText(ticket?.serviceKind || ticket?.scenario || ticket?.type);
    if (['repair', 'to', 'chto', 'pto'].includes(kind)) return kind;
    const reason = lowerText(ticket?.reason);
    if (reason === 'то') return 'to';
    if (reason === 'что') return 'chto';
    if (reason === 'пто') return 'pto';
    return 'repair';
  }

  function getServiceWorkflowKindForPagination(ticket) {
    const kind = inferServiceKindForPagination(ticket);
    if (kind !== 'repair') return 'maintenance';
    const value = lowerText(`${ticket?.reason || ''} ${ticket?.description || ''}`);
    if (value.includes('прием') || value.includes('возврат') || value.includes('аренд')) return 'receiving';
    if (value.includes('диагност')) return 'diagnostics';
    return 'repair';
  }

  function isServiceTicketOverdueForPagination(ticket) {
    const status = lowerText(ticket?.status);
    if (status === 'closed') return false;
    const due = text(ticket?.dueDate || ticket?.deadline || ticket?.targetDate || ticket?.plannedDate || ticket?.scheduledDate).slice(0, 10);
    return Boolean(due && due < new Date().toISOString().slice(0, 10));
  }

  function findRentalForServiceLink(rentalId) {
    const id = text(rentalId);
    if (!id) return null;
    return [
      ...(readData('rentals') || []),
      ...(readData('gantt_rentals') || []),
    ].find(item => [
      item?.id,
      item?.rentalId,
      item?.sourceRentalId,
      item?.originalRentalId,
    ].some(candidate => text(candidate) === id)) || null;
  }

  function serviceRentalBelongsToClient(rental, record) {
    const clientId = text(record?.clientId);
    const rentalClientId = text(rental?.clientId);
    if (clientId && rentalClientId) return clientId === rentalClientId;
    if (rentalClientId) return false;
    if (!clientId) return true;

    const client = (readData('clients') || []).find(item => text(item?.id) === clientId);
    const selectedNames = [
      record?.client,
      record?.clientName,
      client?.company,
      client?.name,
    ].map(normalizeClientName).filter(Boolean);
    const rentalNames = [
      rental?.client,
      rental?.clientName,
      rental?.companyName,
    ].map(normalizeClientName).filter(Boolean);
    if (selectedNames.length === 0 || rentalNames.length === 0) return true;
    return selectedNames.some(name => rentalNames.includes(name));
  }

  function validateServiceRelationLinks(record) {
    if (!record || !record.rentalId) return;
    const rental = findRentalForServiceLink(record.rentalId);
    if (!rental) return;
    if (!serviceRentalBelongsToClient(rental, record)) {
      const error = new Error('Аренда не принадлежит выбранному клиенту');
      error.status = 400;
      throw error;
    }
  }

  function rentalBelongsToClient(rental, client) {
    const clientId = String(client?.id || '').trim();
    const rentalClientId = String(rental?.clientId || '').trim();
    if (clientId && rentalClientId) return rentalClientId === clientId;
    if (rentalClientId) return false;

    const clientName = normalizeClientName(client?.company || client?.name);
    const rentalClientName = normalizeClientName(rental?.client || rental?.clientName);
    return Boolean(clientName && rentalClientName && clientName === rentalClientName);
  }

  function rentalDeleteBlockDto(rental, equipmentById) {
    const equipmentId = rental?.equipmentId || '';
    const equipment = equipmentId ? equipmentById.get(String(equipmentId)) : null;
    const equipmentInv = rental?.equipmentInv
      || rental?.inventoryNumber
      || equipment?.inventoryNumber
      || '';
    return {
      id: rental?.id,
      rentalId: rental?.rentalId || rental?.sourceRentalId || rental?.originalRentalId || rental?.id,
      equipmentId,
      equipmentInv,
      startDate: rental?.startDate,
      endDate: rental?.endDate || rental?.plannedReturnDate,
      status: rental?.status,
    };
  }

  function findClientLinkedRentals(client) {
    const equipmentById = new Map((readData('equipment') || [])
      .filter(item => item?.id)
      .map(item => [String(item.id), item]));
    const seen = new Set();
    return [...(readData('rentals') || []), ...(readData('gantt_rentals') || [])]
      .filter(rental => rentalBelongsToClient(rental, client))
      .map(rental => rentalDeleteBlockDto(rental, equipmentById))
      .filter(rental => {
        const key = `${rental.id || ''}:${rental.rentalId || ''}:${rental.equipmentId || ''}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
  }

  function recordBelongsToClient(record, client, nameFields) {
    const clientId = String(client?.id || '').trim();
    const recordClientId = String(record?.clientId || '').trim();
    if (clientId && recordClientId) return recordClientId === clientId;
    if (recordClientId) return false;

    const clientName = normalizeClientName(client?.company || client?.name);
    if (!clientName) return false;
    return nameFields.some(field => normalizeClientName(record?.[field]) === clientName);
  }

  function findClientHistoryLinks(client) {
    const linkSpecs = [
      { collection: 'documents', label: 'documents', nameFields: ['client', 'clientName'] },
      { collection: 'payments', label: 'payments', nameFields: ['client', 'clientName'] },
      { collection: 'deliveries', label: 'deliveries', nameFields: ['client', 'clientName'] },
      { collection: 'service', label: 'service', nameFields: ['client', 'clientName'] },
      { collection: 'warranty_claims', label: 'warranty_claims', nameFields: ['client', 'clientName'] },
      { collection: 'crm_deals', label: 'crm_deals', nameFields: ['company', 'client', 'clientName'] },
      { collection: 'debt_collection_plans', label: 'debt_collection_plans', nameFields: ['clientName', 'client'] },
    ];

    return linkSpecs
      .map(spec => {
        const items = readData(spec.collection) || [];
        const matches = items.filter(item => recordBelongsToClient(item, client, spec.nameFields));
        return matches.length > 0
          ? { collection: spec.label, count: matches.length }
          : null;
      })
      .filter(Boolean);
  }

  function canDeleteClients(req) {
    const role = normalizeRole(req.user?.userRole);
    return role === 'Администратор' || role === 'Офис-менеджер';
  }

  function sendClientHasRentalsError(res, rentals) {
    return res.status(409).json({
      error: 'CLIENT_HAS_RENTALS',
      message: 'Нельзя удалить клиента, потому что у него есть связанные аренды',
      rentals,
    });
  }

  function sendClientHasHistoryError(res, links) {
    return res.status(409).json({
      error: 'CLIENT_HAS_HISTORY',
      message: 'Нельзя удалить клиента, потому что у него есть исторические связи. Переведите клиента в архивный/неактивный статус вместо удаления.',
      links,
    });
  }

  function sendClientInnError(res, error) {
    return res.status(error?.status || 400).json({
      ok: false,
      error: error?.message || 'Клиент с таким ИНН уже существует',
      code: error?.code,
      conflictClient: error?.conflictClient,
      duplicates: error?.duplicates,
    });
  }

  function normalizedEquipmentField(value) {
    return String(value ?? '').trim().toLowerCase();
  }

  function equipmentFieldChanged(previous, next, field) {
    if (!previous) return Boolean(normalizedEquipmentField(next?.[field]));
    return normalizedEquipmentField(previous?.[field]) !== normalizedEquipmentField(next?.[field]);
  }

  function findEquipmentIdentifierConflict(equipmentList, candidate, field, ignoreId = '') {
    const normalizedValue = normalizedEquipmentField(candidate?.[field]);
    if (!normalizedValue) return null;
    return (equipmentList || []).find(item => (
      String(item?.id || '') !== String(ignoreId || '')
      && normalizedEquipmentField(item?.[field]) === normalizedValue
    )) || null;
  }

  function validateEquipmentRecord(nextItem, equipmentList, previousItem = null) {
    if (!String(nextItem?.model || '').trim()) {
      throw Object.assign(new Error('Модель техники обязательна'), {
        status: 400,
        code: 'EQUIPMENT_MODEL_REQUIRED',
      });
    }

    for (const field of ['inventoryNumber', 'serialNumber']) {
      if (!equipmentFieldChanged(previousItem, nextItem, field)) continue;
      const conflict = findEquipmentIdentifierConflict(equipmentList, nextItem, field, nextItem?.id);
      if (!conflict) continue;
      const label = field === 'inventoryNumber' ? 'инвентарным номером' : 'серийным номером';
      throw Object.assign(new Error(`Техника с таким ${label} уже существует`), {
        status: 409,
        code: 'EQUIPMENT_IDENTIFIER_DUPLICATE',
        field,
        conflictEquipment: {
          id: conflict.id,
          inventoryNumber: conflict.inventoryNumber,
          serialNumber: conflict.serialNumber,
          model: conflict.model,
        },
      });
    }
  }

  function sendEquipmentValidationError(res, error) {
    return res.status(error?.status || 400).json({
      ok: false,
      error: error?.message || 'Некорректные данные техники',
      code: error?.code,
      field: error?.field,
      conflictEquipment: error?.conflictEquipment,
    });
  }

  function auditBlockedSystemFixtureMutation(req, error) {
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
  }

  function sendSystemFixtureProtectedError(req, res, error) {
    auditBlockedSystemFixtureMutation(req, error);
    return res.status(409).json({
      ok: false,
      code: SYSTEM_FIXTURE_PROTECTED_CODE,
      error: SYSTEM_FIXTURE_PROTECTED_MESSAGE,
      attemptedFields: Array.isArray(error?.attemptedFields) ? error.attemptedFields : [],
      violations: Array.isArray(error?.violations) ? error.violations : [],
    });
  }

  function assertNoRawProductionSmokeFixturePatch(previous, patch) {
    if (!isProductionSmokeEquipmentFixture(previous)) return;
    const protectedFields = [
      'inventoryNumber',
      'serialNumber',
      'saleMode',
      'forSale',
      'isForSale',
      'saleStatus',
      'salesStatus',
      'category',
      'status',
      'activeInFleet',
    ];
    const attemptedFields = protectedFields.filter(field => Object.prototype.hasOwnProperty.call(patch || {}, field));
    if (!attemptedFields.length) return;
    throw createSystemFixtureProtectedError({
      action: 'update',
      equipmentId: previous?.id,
      attemptedFields,
      violations: attemptedFields,
    });
  }

  function serviceTicketTargetsProductionSmokeFixture(ticket = {}) {
    const equipmentList = readData('equipment') || [];
    return equipmentList.find(item => {
      if (!isProductionSmokeEquipmentFixture(item)) return false;
      return (ticket.equipmentId && String(ticket.equipmentId) === String(item.id))
        || (ticket.inventoryNumber && String(ticket.inventoryNumber).trim() === String(item.inventoryNumber || '').trim())
        || (ticket.serialNumber && String(ticket.serialNumber).trim() === String(item.serialNumber || '').trim());
    }) || null;
  }

  function assertServiceTicketDoesNotTargetProductionSmokeFixture(ticket = {}, action = 'service_update') {
    const target = serviceTicketTargetsProductionSmokeFixture(ticket);
    if (!target) return;
    throw createSystemFixtureProtectedError({
      action,
      equipmentId: target.id,
      attemptedFields: ['service'],
      violations: ['serviceMode'],
    });
  }

  function canReadPublicUsers(req) {
    return new Set([
      'Администратор',
      'Офис-менеджер',
      'Менеджер по аренде',
      'Менеджер по продажам',
    ]).has(normalizeRole(req.user?.userRole));
  }

  function hasReadAccess(req, collection) {
    if (collection === 'users') {
      return canReadPublicUsers(req)
        ? true
        : {
            denied: true,
            statusCode: 403,
            payload: { ok: false, error: 'Forbidden' },
          };
    }
    if (typeof requireRead !== 'function') {
      return Promise.resolve({
        denied: true,
        statusCode: 403,
        payload: { ok: false, error: 'Forbidden' },
      });
    }
    return new Promise((resolve) => {
      requireRead(collection)(req, {
        status(statusCode) {
          return {
            json(payload) {
              resolve({ denied: true, statusCode, payload });
            },
          };
        },
      }, () => resolve({ denied: false }));
    });
  }

  function normalizeUserPasswordForWrite(user, existing = null) {
    const next = { ...user };
    if (!next.password && existing?.password) {
      next.password = existing.password;
    } else if (next.password && !String(next.password).startsWith('h1:') && !String(next.password).startsWith('h2:scrypt:')) {
      next.password = hashPassword(String(next.password));
    }
    if (normalizeRole(next.role) === 'Перевозчик') {
      // IMPORTANT: carrier accounts are MAX-only by default. Do not grant frontend access
      // unless a separate backend-reviewed business rule explicitly allows it.
      next.role = 'Перевозчик';
      next.botOnly = true;
      next.allowFrontendLogin = false;
      next.frontendAccess = false;
    } else if (next.role) {
      next.role = normalizeRole(next.role);
    }
    return next;
  }

  function preserveExistingUserAuthState(nextUser, existingUser) {
    if (!existingUser) return nextUser;
    const next = { ...nextUser };
    if (!Object.prototype.hasOwnProperty.call(next, 'tokenVersion')
      && Object.prototype.hasOwnProperty.call(existingUser, 'tokenVersion')) {
      next.tokenVersion = existingUser.tokenVersion;
    }
    if (!Object.prototype.hasOwnProperty.call(next, 'passwordChangedAt')
      && Object.prototype.hasOwnProperty.call(existingUser, 'passwordChangedAt')) {
      next.passwordChangedAt = existingUser.passwordChangedAt;
    }
    return next;
  }

  function isActiveUser(user) {
    return user?.status === 'Активен';
  }

  function isAdminUser(user) {
    return normalizeRole(user?.role) === 'Администратор';
  }

  function activeAdminCount(users) {
    return (users || []).filter(user => isActiveUser(user) && isAdminUser(user)).length;
  }

  function validateUserSafetyChange(req, users, previousUser, nextUser, operation, confirmation = {}) {
    const actorId = String(req.user?.userId || '');
    const targetId = String(previousUser?.id || '');
    const deletesUser = operation === 'delete';
    const previousIsAdmin = isActiveUser(previousUser) && isAdminUser(previousUser);
    const nextIsActiveAdmin = nextUser ? isActiveUser(nextUser) && isAdminUser(nextUser) : false;
    const removesAdminAccess = previousIsAdmin && !nextIsActiveAdmin;
    const deactivatesUser = isActiveUser(previousUser) && nextUser && !isActiveUser(nextUser);

    if ((deletesUser || removesAdminAccess) && previousIsAdmin) {
      const remainingActiveAdmins = activeAdminCount(users.filter(user => String(user?.id || '') !== targetId));
      if (remainingActiveAdmins < 1) {
        const message = deletesUser
          ? 'Нельзя удалить последнего активного администратора'
          : 'Нельзя деактивировать последнего активного администратора';
        throw Object.assign(new Error(message), { status: 409 });
      }
    }

    if (targetId && actorId && targetId === actorId && (deletesUser || deactivatesUser || removesAdminAccess)) {
      throw Object.assign(new Error(deletesUser ? 'Нельзя удалить самого себя' : 'Нельзя деактивировать самого себя'), { status: 403 });
    }

    if (deletesUser) {
      const expectedEmail = String(previousUser?.email || '').trim();
      const providedEmail = String(confirmation?.emailConfirmation || confirmation?.confirmEmail || '').trim();
      if (!expectedEmail || providedEmail !== expectedEmail) {
        throw Object.assign(new Error('Для удаления введите email пользователя'), { status: 400 });
      }
    }

    if (deactivatesUser && confirmation?.confirm !== true) {
      throw Object.assign(new Error(isAdminUser(previousUser) ? 'Подтвердите деактивацию администратора' : 'Подтвердите деактивацию пользователя'), { status: 400 });
    }
  }

  function auditUserStatusChanges(req, previousUser, nextUser) {
    if (!previousUser || !nextUser || previousUser.status === nextUser.status) return;
    auditLog?.(req, {
      action: 'users.status_change',
      entityType: 'users',
      entityId: nextUser.id,
      before: {
        id: previousUser.id,
        email: previousUser.email,
        role: previousUser.role,
        status: previousUser.status,
      },
      after: {
        id: nextUser.id,
        email: nextUser.email,
        role: nextUser.role,
        status: nextUser.status,
      },
    });
    if (previousUser.status === 'Активен' && nextUser.status !== 'Активен') {
      auditLog?.(req, {
        action: 'users.deactivate',
        entityType: 'users',
        entityId: nextUser.id,
        before: {
          id: previousUser.id,
          email: previousUser.email,
          role: previousUser.role,
          status: previousUser.status,
        },
        after: {
          id: nextUser.id,
          email: nextUser.email,
          role: nextUser.role,
          status: nextUser.status,
        },
      });
    }
  }

  function crmArchiveForbiddenReason(collection) {
    if (collection !== 'crm_deals') return null;
    const settings = readData('app_settings') || [];
    const setting = settings.find(item => item?.key === 'crm_archive_state');
    const value = setting?.value && typeof setting.value === 'object' ? setting.value : {};
    const status = value?.status;
    if (status === 'archived') return 'CRM находится в архиве и временно скрыта из системы.';
    if (status === 'deleted') return 'CRM удалена из системы.';
    return null;
  }

  function invalidateAffectedUserSessions(previousUsers, nextUsers) {
    if (typeof deleteSessionsForUserIds !== 'function') return;
    const previous = Array.isArray(previousUsers) ? previousUsers : [];
    const next = Array.isArray(nextUsers) ? nextUsers : [];
    const nextById = new Map(next.map(item => [item.id, item]));
    const affectedIds = previous
      .filter(item => {
        const nextItem = nextById.get(item.id);
        if (!nextItem) return true;
        return nextItem.status !== 'Активен' || nextItem.email !== item.email || nextItem.role !== item.role;
      })
      .map(item => item.id);

    if (affectedIds.length > 0) {
      deleteSessionsForUserIds(affectedIds);
    }
  }

  function createEntityChangeRequest(req, {
    entityType,
    entity,
    rentalId,
    operation,
    type,
    field,
    oldValue,
    newValue,
    financialImpact,
  }) {
    const rentals = readData('rentals') || [];
    const rental = rentals.find(item => item.id === rentalId);
    const requests = readData('rental_change_requests') || [];
    // IMPORTANT: approval records preserve clientId/rentalId so payment and document
    // corrections stay attached even if the displayed client name changes later.
    const request = {
      id: generateId(idPrefixes.rental_change_requests || 'RCR'),
      entityType,
      entityId: entity?.id || '',
      rentalId: rentalId || '',
      client: rental?.client || entity?.client || '',
      clientId: rental?.clientId || entity?.clientId || '',
      equipment: Array.isArray(rental?.equipment) ? rental.equipment : [],
      initiatorId: req.user?.userId || '',
      initiatorName: req.user?.userName || 'Система',
      initiatorRole: req.user?.userRole || '',
      createdAt: nowIso(),
      status: RENTAL_CHANGE_REQUEST_STATUS.PENDING,
      statusLabel: buildRequestDecisionNotificationStatus(RENTAL_CHANGE_REQUEST_STATUS.PENDING),
      operation,
      type,
      field,
      fieldLabel: field,
      oldValue,
      newValue,
      reason: `${type} требует согласования администратора.`,
      comment: '',
      attachments: [],
      financialImpact: financialImpact || { amount: 0, description: 'Без прямого изменения суммы' },
    };
    writeData('rental_change_requests', [...requests, request]);
    return request;
  }

  function buildPaymentFinancialImpact(payment, nextValue, operation) {
    if (operation === 'delete') {
      const amount = -getEffectivePaidAmount(payment);
      return { amount, description: `${amount}` };
    }
    const oldAmount = getEffectivePaidAmount(payment);
    const nextAmount = getEffectivePaidAmount({ ...payment, ...nextValue });
    const amount = nextAmount - oldAmount;
    return {
      amount,
      description: amount === 0 ? 'Без прямого изменения суммы' : `${amount > 0 ? '+' : ''}${amount}`,
    };
  }

  function parsePaymentMoney(value, fieldLabel, { required = false } = {}) {
    if (value === undefined || value === null || value === '') {
      if (required) throw new Error(`${fieldLabel} должен быть числом не меньше 0`);
      return undefined;
    }
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new Error(`${fieldLabel} должен быть числом не меньше 0`);
    }
    return numeric;
  }

  function validatePaymentRecord(record, { partial = false } = {}) {
    const hasAmount = record && Object.prototype.hasOwnProperty.call(record, 'amount');
    const hasPaidAmount = record && Object.prototype.hasOwnProperty.call(record, 'paidAmount');
    if (!partial || hasAmount) parsePaymentMoney(record?.amount, 'Сумма платежа', { required: true });
    if (hasPaidAmount) parsePaymentMoney(record?.paidAmount, 'Оплачено');
  }

  const PAYMENT_ALLOCATION_EDIT_GUARD_FIELDS = new Set([
    'amount',
    'paidAmount',
    'status',
    'rentalId',
    'clientId',
    'objectId',
    'contractId',
  ]);

  function hasActivePaymentAllocations(paymentId) {
    const id = String(paymentId || '').trim();
    if (!id) return false;
    return (readData('payment_allocations') || []).some(item =>
      String(item?.paymentId || '').trim() === id &&
      String(item?.status || '').trim().toLowerCase() !== 'cancelled'
    );
  }

  function comparablePaymentFieldValue(field, value) {
    if (field === 'amount' || field === 'paidAmount') {
      const numeric = Number(value);
      return Number.isFinite(numeric) ? numeric : value;
    }
    return value == null ? '' : String(value);
  }

  function assertAllocatedPaymentPatchSafe(previous, patch) {
    if (!hasActivePaymentAllocations(previous?.id)) return;
    for (const field of PAYMENT_ALLOCATION_EDIT_GUARD_FIELDS) {
      if (!Object.prototype.hasOwnProperty.call(patch || {}, field)) continue;
      if (comparablePaymentFieldValue(field, previous?.[field]) === comparablePaymentFieldValue(field, patch[field])) continue;
      const error = new Error('Payment has allocations. Use correction/reversal workflow instead of direct edit.');
      error.status = 409;
      throw error;
    }
  }

  function assertAllocatedPaymentDeleteSafe(payment) {
    if (!hasActivePaymentAllocations(payment?.id)) return;
    const error = new Error('Payment has allocations. Reverse or cancel it with reason instead of deleting.');
    error.status = 409;
    throw error;
  }

  function paymentAllocationCap(payment) {
    const paid = getEffectivePaidAmount(payment);
    const amount = Number(payment?.amount);
    return Number.isFinite(amount) && amount > 0 ? Math.min(paid, amount) : paid;
  }

  function validatePaymentAllocationRecord(record, existing = null) {
    const paymentId = String(record?.paymentId || '').trim();
    if (!paymentId) throw new Error('Для распределения платежа укажите paymentId');
    const amount = parsePaymentMoney(record?.amount, 'Сумма распределения', { required: true });
    if (amount <= 0) throw new Error('Сумма распределения должна быть больше 0');
    const payment = (readData('payments') || []).find(item => String(item?.id || '').trim() === paymentId);
    if (!payment) throw new Error('Платёж для распределения не найден');
    const rentalId = String(record?.rentalId || '').trim();
    if (rentalId) {
      const rentalExists = [...(readData('gantt_rentals') || []), ...(readData('rentals') || [])]
        .some(item => String(item?.id || '').trim() === rentalId);
      if (!rentalExists) throw new Error('Аренда для распределения не найдена');
    }
    const documentId = String(record?.documentId || '').trim();
    if (documentId) {
      const documentExists = (readData('documents') || []).some(item => String(item?.id || '').trim() === documentId);
      if (!documentExists) throw new Error('Документ для распределения не найден');
    }
    const allocated = (readData('payment_allocations') || [])
      .filter(item => String(item?.paymentId || '').trim() === paymentId)
      .filter(item => String(item?.id || '').trim() !== String(existing?.id || record?.id || '').trim())
      .filter(item => String(item?.status || '').trim() !== 'cancelled')
      .reduce((sum, item) => sum + (Number.isFinite(Number(item?.amount)) && Number(item.amount) > 0 ? Number(item.amount) : 0), 0);
    if (allocated + amount > paymentAllocationCap(payment) + 0.000001) {
      throw new Error('Сумма распределений не может превышать сумму платежа');
    }
  }

  function validatePaymentAllocationBulkReplace(records) {
    const paymentsById = new Map((readData('payments') || [])
      .map(item => [String(item?.id || '').trim(), item])
      .filter(([id]) => id));
    const rentalIds = new Set([...(readData('gantt_rentals') || []), ...(readData('rentals') || [])]
      .map(item => String(item?.id || '').trim())
      .filter(Boolean));
    const documentIds = new Set((readData('documents') || [])
      .map(item => String(item?.id || '').trim())
      .filter(Boolean));
    const totalsByPaymentId = new Map();
    for (const record of records || []) {
      const paymentId = String(record?.paymentId || '').trim();
      if (!paymentId) throw new Error('Для распределения платежа укажите paymentId');
      if (!paymentsById.has(paymentId)) throw new Error('Платёж для распределения не найден');
      const rentalId = String(record?.rentalId || '').trim();
      if (rentalId && !rentalIds.has(rentalId)) throw new Error('Аренда для распределения не найдена');
      const documentId = String(record?.documentId || '').trim();
      if (documentId && !documentIds.has(documentId)) throw new Error('Документ для распределения не найден');
      if (String(record?.status || '').trim().toLowerCase() === 'cancelled') continue;
      const amount = Number(record?.amount);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      totalsByPaymentId.set(paymentId, (totalsByPaymentId.get(paymentId) || 0) + amount);
    }
    for (const [paymentId, amount] of totalsByPaymentId) {
      const payment = paymentsById.get(paymentId);
      if (!payment) continue;
      if (amount > paymentAllocationCap(payment) + 0.000001) {
        throw new Error('Сумма распределений не может превышать сумму платежа');
      }
    }
  }

  function parseOptionalServiceNumber(record, field, fieldLabel, { required = false } = {}) {
    if (!record || !Object.prototype.hasOwnProperty.call(record, field)) {
      if (required) throw new Error(`${fieldLabel} должно быть числом не меньше 0`);
      return;
    }
    const value = record[field];
    if (value === undefined || value === null || value === '') return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < 0) {
      throw new Error(`${fieldLabel} должно быть числом не меньше 0`);
    }
  }

  function validateServiceWorkCatalogRecord(record) {
    parseOptionalServiceNumber(record, 'normHours', 'Нормо-часы');
    parseOptionalServiceNumber(record, 'ratePerHour', 'Стоимость нормо-часа');
    parseOptionalServiceNumber(record, 'defaultNormHours', 'Нормо-часы');
    parseOptionalServiceNumber(record, 'defaultMechanicRate', 'Ставка механика');
    parseOptionalServiceNumber(record, 'fixedAmount', 'Фиксированное начисление');
    if (Object.prototype.hasOwnProperty.call(record || {}, 'payType')) {
      const payType = String(record.payType || '').trim();
      if (payType && !['hourly_norm', 'fixed', 'no_pay'].includes(payType)) {
        throw new Error('Тип начисления должен быть hourly_norm, fixed или no_pay');
      }
    }
  }

  function validateSparePartCatalogRecord(record) {
    parseOptionalServiceNumber(record, 'defaultPrice', 'Базовая цена');
  }

  function parseOptionalCrmNumber(record, field, fieldLabel, { min = 0, max = Infinity } = {}) {
    if (!record || !Object.prototype.hasOwnProperty.call(record, field)) return;
    const value = record[field];
    if (value === undefined || value === null || value === '') return;
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric < min || numeric > max) {
      const rangeLabel = Number.isFinite(max)
        ? `от ${min} до ${max}`
        : `не меньше ${min}`;
      throw new Error(`${fieldLabel} должно быть числом ${rangeLabel}`);
    }
  }

  function validateCrmDealRecord(record) {
    parseOptionalCrmNumber(record, 'budget', 'Сумма сделки');
    parseOptionalCrmNumber(record, 'probability', 'Вероятность', { min: 0, max: 100 });
  }

  function isPaymentStatusOnlyPatch(previousPayment, patch) {
    const changedFields = Object.keys(patch || {}).filter(field => {
      if (field === 'id') return false;
      return JSON.stringify(previousPayment?.[field] ?? null) !== JSON.stringify(patch[field] ?? null);
    });
    return changedFields.length === 1 && changedFields[0] === 'status';
  }

  function officeManagerCanOnlyCreateRental(req, collection, method) {
    const isRentalCollection = collection === 'rentals' || collection === 'gantt_rentals';
    if (!isRentalCollection) return false;
    if (req.user?.userRole !== 'Офис-менеджер') return false;
    return method !== 'POST';
  }

  function rentalWriteForbiddenReason(req, collection, method) {
    const isRentalCollection = collection === 'rentals' || collection === 'gantt_rentals';
    if (!isRentalCollection) return null;

    const role = req.user?.userRole;
    if (method === 'POST') {
      if (role !== 'Администратор' && role !== 'Офис-менеджер') {
        return 'Недостаточно прав: создавать аренду могут только администратор и офис-менеджер.';
      }
      return null;
    }

    if (role !== 'Администратор') {
      return 'Недостаточно прав: изменять, удалять и восстанавливать аренду может только администратор.';
    }

    return null;
  }

  function serviceWriteForbiddenReason(req, collection, method) {
    if (collection !== 'service') return null;

    const role = req.user?.userRole;
    if (role === 'Менеджер по аренде' && method !== 'POST') {
      return 'Недостаточно прав: менеджер по аренде может только создавать сервисные заявки.';
    }

    return null;
  }

  function isKnowledgeBaseReviewer(req) {
    return req.user?.userRole === 'Администратор' || req.user?.userRole === 'Офис-менеджер';
  }

  function knowledgeBaseProgressForbiddenReason(req, collection, method, existingItem) {
    if (collection !== 'knowledge_base_progress') return null;
    if (isKnowledgeBaseReviewer(req)) return null;

    if (method === 'DELETE' || method === 'PUT') {
      return 'Недостаточно прав: массово менять или удалять прогресс обучения может только администратор или офис-менеджер.';
    }

    if (existingItem && existingItem.userId !== req.user?.userId) {
      return 'Недостаточно прав: можно менять только свой прогресс обучения.';
    }

    return null;
  }

  function knowledgeBaseModuleForbiddenReason(req, collection, method) {
    if (collection !== 'knowledge_base_modules') return null;
    if (method !== 'DELETE') return null;
    if (req.user?.userRole === 'Администратор') return null;
    return 'Недостаточно прав: удалять учебные модули может только администратор.';
  }

  const PAGINATED_COLLECTION_CONFIG = {
    equipment: {
      searchFields: ['inventoryNumber', 'serialNumber', 'manufacturer', 'model', 'location', 'ownerName'],
      sortFields: {
        inventoryNumber: item => item.inventoryNumber,
        manufacturer: item => item.manufacturer,
        model: item => item.model,
        status: item => item.status,
        ownerName: item => item.ownerName || item.owner,
        location: item => item.location,
        updatedAt: item => item.updatedAt || item.createdAt || item.id,
      },
      defaultSort: { sortBy: 'inventoryNumber', sortDir: 'asc' },
      filters: {
        status: (item, value) => item.status === value,
        ownerId: (item, value) => item.ownerId === value || item.owner === value,
        type: (item, value) => item.type === value || item.equipmentType === value,
        category: (item, value) => item.category === value,
        drive: (item, value) => item.drive === value,
        location: (item, value) => item.location === value,
        activeInFleet: (item, value) => String(item.activeInFleet) === value,
        saleState: (item, value) => {
          if (value === 'for_sale') return Boolean(item.saleMode || item.forSale || item.isForSale) && item.saleStatus !== 'sold';
          if (value === 'sold') return item.saleStatus === 'sold' || item.status === 'sold';
          if (value === 'available_for_rent') return isAvailableForRentEquipment(item);
          return true;
        },
      },
      summary: items => ({
        total: items.length,
        available: items.filter(item => item.status === 'available').length,
        rented: items.filter(item => item.status === 'rented').length,
        inService: items.filter(item => item.status === 'in_service').length,
      }),
    },
    service: {
      searchFields: ['id', 'equipment', 'inventoryNumber', 'serialNumber', 'reason', 'description', 'client', 'clientName', 'assignedMechanicName', 'assignedTo', 'createdByUserName', 'contractNumber'],
      sortFields: {
        createdAt: item => serviceCreatedAtValue(item),
        updatedAt: item => item.updatedAt || serviceCreatedAtValue(item),
        priority: item => item.priority,
        status: item => item.status,
        plannedDate: item => item.plannedDate || item.scheduledDate || item.dueDate,
      },
      defaultSort: { sortBy: 'createdAt', sortDir: 'desc' },
      filters: {
        status: (item, value) => item.status === value,
        mechanicId: (item, value) => item.mechanicId === value || item.assignedMechanicId === value || item.assignedUserId === value,
        mechanic: (item, value) => item.mechanicId === value || item.assignedMechanicId === value || item.assignedUserId === value || item.assignedMechanicName === value || item.assignedTo === value,
        equipmentId: (item, value) => item.equipmentId === value,
        clientId: (item, value) => item.clientId === value,
        priority: (item, value) => item.priority === value,
        scenario: (item, value) => inferServiceKindForPagination(item) === value,
        workflow: (item, value) => getServiceWorkflowKindForPagination(item) === value,
        preset: (item, value) => {
          const status = lowerText(item.status);
          const priority = lowerText(item.priority);
          if (value === 'unassigned') return !item.assignedMechanicId && !item.assignedTo && !item.assignedMechanicName;
          if (value === 'urgent') return ['high', 'critical'].includes(priority);
          if (value === 'waiting_parts') return status === 'waiting_parts';
          if (value === 'needs_revision') return status === 'needs_revision';
          if (value === 'maintenance') return ['to', 'chto', 'pto'].includes(inferServiceKindForPagination(item));
          return true;
        },
      },
      summary: items => ({
        total: items.length,
        open: items.filter(item => !['closed', 'done'].includes(lowerText(item.status))).length,
        active: items.filter(item => !['closed', 'done'].includes(lowerText(item.status))).length,
        archived: items.filter(item => ['closed', 'done'].includes(lowerText(item.status))).length,
        inProgress: items.filter(item => lowerText(item.status) === 'in_progress').length,
        waitingParts: items.filter(item => lowerText(item.status) === 'waiting_parts').length,
        ready: items.filter(item => lowerText(item.status) === 'ready').length,
        unassigned: items.filter(item => !item.assignedMechanicId && !item.assignedTo && !item.assignedMechanicName).length,
        overdue: items.filter(isServiceTicketOverdueForPagination).length,
      }),
    },
    warranty_claims: {
      searchFields: ['id', 'equipmentLabel', 'factoryName', 'clientName', 'responsibleName', 'description'],
      sortFields: {
        createdAt: item => item.createdAt,
        updatedAt: item => item.updatedAt || item.createdAt,
        status: item => item.status,
        equipmentLabel: item => item.equipmentLabel,
      },
      defaultSort: { sortBy: 'createdAt', sortDir: 'desc' },
      filters: {
        status: (item, value) => item.status === value,
        equipmentId: (item, value) => item.equipmentId === value,
        clientId: (item, value) => item.clientId === value,
      },
    },
    clients: {
      searchFields: ['company', 'name', 'inn', 'contact', 'phone', 'email', 'manager'],
      sortFields: {
        company: item => item.company || item.name,
        inn: item => item.inn,
        contact: item => item.contact,
        createdAt: item => item.createdAt || item.id,
      },
      defaultSort: { sortBy: 'company', sortDir: 'asc' },
      filters: {
        managerId: (item, value) => item.managerId === value || item.ownerId === value,
        status: (item, value) => item.status === value,
      },
    },
    documents: {
      searchFields: ['number', 'documentNumber', 'type', 'documentType', 'client', 'clientName', 'clientId', 'rentalId', 'rental', 'equipmentInv', 'equipmentId', 'deliveryId', 'status', 'signatoryName', 'signatoryBasis'],
      sortFields: {
        date: item => item.date || item.documentDate || item.createdAt,
        number: item => item.number || item.documentNumber,
        client: item => item.clientName || item.client,
        status: item => item.status,
        createdAt: item => item.createdAt,
      },
      defaultSort: { sortBy: 'date', sortDir: 'desc' },
      filters: {
        status: (item, value) => item.status === value,
        type: (item, value) => item.type === value || item.documentType === value,
        clientId: (item, value) => item.clientId === value,
        rentalId: (item, value) => item.rentalId === value || item.rental === value,
        equipmentId: (item, value) => item.equipmentId === value,
      },
    },
    payments: {
      searchFields: ['id', 'invoiceNumber', 'documentNumber', 'documentId', 'client', 'clientName', 'clientId', 'rentalId', 'method', 'status', 'comment', 'purpose'],
      sortFields: {
        date: item => item.date || item.paymentDate || item.createdAt,
        amount: item => Number(item.amount || 0),
        client: item => item.clientName || item.client,
        status: item => item.status,
        createdAt: item => item.createdAt,
      },
      defaultSort: { sortBy: 'date', sortDir: 'desc' },
      filters: {
        status: (item, value) => item.status === value,
        clientId: (item, value) => item.clientId === value,
        rentalId: (item, value) => item.rentalId === value,
        managerId: (item, value) => item.managerId === value || item.responsibleManagerId === value,
      },
      summary: items => ({
        totalAmount: items.reduce((sum, item) => sum + Number(item.amount || 0), 0),
        count: items.length,
        pendingAmount: items.filter(item => ['pending', 'partial'].includes(lowerText(item.status))).reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0) - Number(item.paidAmount || 0)), 0),
        paidAmount: items.filter(item => lowerText(item.status) === 'paid').reduce((sum, item) => sum + Number(item.paidAmount ?? item.amount ?? 0), 0),
        overdueAmount: items.filter(item => lowerText(item.status) === 'overdue').reduce((sum, item) => sum + Math.max(0, Number(item.amount || 0) - Number(item.paidAmount || 0)), 0),
        partialAmount: items.filter(item => lowerText(item.status) === 'partial').reduce((sum, item) => sum + Number(item.paidAmount || 0), 0),
      }),
    },
    company_expenses: {
      searchFields: ['category', 'description', 'counterparty', 'comment'],
      sortFields: {
        date: item => item.date || item.createdAt,
        amount: item => Number(item.amount || 0),
        category: item => item.category,
      },
      defaultSort: { sortBy: 'date', sortDir: 'desc' },
    },
    finance_operations: {
      searchFields: ['category', 'description', 'counterparty', 'accountName', 'comment'],
      sortFields: {
        date: item => item.date || item.createdAt,
        amount: item => Number(item.amount || 0),
        category: item => item.category,
      },
      defaultSort: { sortBy: 'date', sortDir: 'desc' },
    },
  };

  function filterPaginatedCollection(collection, data, query) {
    const config = PAGINATED_COLLECTION_CONFIG[collection] || {};
    let rows = Array.isArray(data) ? data : [];
    rows = rows.filter(item => itemMatchesSearch(item, query.search, config.searchFields || ['id']));
    Object.entries(config.filters || {}).forEach(([name, predicate]) => {
      const value = String(query[name] || '').trim();
      if (value && value !== 'all') rows = rows.filter(item => predicate(item, value));
    });
    const dateFrom = String(query.dateFrom || '').trim();
    const dateTo = String(query.dateTo || '').trim();
    if (dateFrom || dateTo) {
      rows = rows.filter(item => {
        const date = String(collection === 'service'
          ? serviceCreatedAtValue(item)
          : item.date || item.documentDate || item.paymentDate || item.createdAt || item.updatedAt || '').slice(0, 10);
        if (!date) return false;
        if (dateFrom && date < dateFrom) return false;
        if (dateTo && date > dateTo) return false;
        return true;
      });
    }
    return rows;
  }

  function buildPaginatedCollectionResponse(collection, data, query) {
    const config = PAGINATED_COLLECTION_CONFIG[collection] || {};
    const rows = filterPaginatedCollection(collection, data, query);
    return buildPaginatedResponse(rows, query, {
      sortFields: config.sortFields || { id: item => item.id },
      defaultSort: config.defaultSort || { sortBy: 'id', sortDir: 'asc' },
      summary: typeof config.summary === 'function' ? config.summary(rows) : undefined,
    });
  }

  function canReadCollectionForSummary(collection, user) {
    try {
      accessControl.assertCanReadCollection(collection, user);
      return true;
    } catch {
      return false;
    }
  }

  function enrichClientsWithBackendFinancials(clients, user) {
    if (!Array.isArray(clients) || clients.length === 0) return clients;
    const canReadRentals = canReadCollectionForSummary('gantt_rentals', user);
    const canReadPayments = canReadCollectionForSummary('payments', user);
    if (!canReadRentals || !canReadPayments) return clients;

    const scopedRentals = accessControl.filterCollectionByScope('gantt_rentals', readData('gantt_rentals') || [], user);
    const scopedPayments = accessControl.filterCollectionByScope('payments', readData('payments') || [], user);
    const scopedAllocations = canReadCollectionForSummary('payment_allocations', user)
      ? accessControl.filterCollectionByScope('payment_allocations', readData('payment_allocations') || [], user)
      : [];
    const snapshots = buildClientFinancialSnapshots(clients, scopedRentals, scopedPayments, new Date().toISOString().slice(0, 10), {
      paymentAllocations: scopedAllocations,
    });
    const byClientId = new Map(snapshots.map(item => [String(item.clientId || ''), item]));
    return clients.map(client => {
      const summary = byClientId.get(String(client.id || ''));
      if (!summary) return client;
      return {
        ...client,
        debt: summary.currentDebt,
        totalRentals: summary.totalRentals,
        lastRentalDate: summary.lastRentalDate,
      };
    });
  }

  function registerCRUD(collection) {
    if (collection === 'rentals' || collection === 'gantt_rentals') {
      return;
    }
    const prefix = idPrefixes[collection] || collection;

    router.get(`/${collection}`, requireAuth, async (req, res) => {
      const readAccess = await hasReadAccess(req, collection);
      if (readAccess.denied) {
        return res.status(readAccess.statusCode).json(readAccess.payload);
      }
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      try {
        accessControl.assertCanReadCollection(collection, req.user);
      } catch (error) {
        return sendAccessError(res, error);
      }
      let data = readData(collection) || [];
      if (collection === 'service_works') {
        data = data
          .map(normalizeServiceWorkRecord)
          .sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ru'));
        if (req.query.active === '1') {
          data = data.filter(item => item.isActive);
        }
      }
      if (collection === 'spare_parts') {
        data = data
          .map(normalizeSparePartRecord)
          .sort((a, b) => a.name.localeCompare(b.name, 'ru'));
        if (req.query.active === '1') {
          data = data.filter(item => item.isActive);
        }
      }
      if (collection === 'service') {
        data = normalizeServiceTicketList(data);
      }
      if (collection === 'users') {
        if (canReadFullUsers(req)) {
          return res.json(data.map(sanitizeUser));
        }
        return res.json(data.filter(item => item.status === 'Активен').map(publicUserView));
      }
      if (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req)) {
        return res.json(data.filter(item => item.userId === req.user.userId));
      }
      data = accessControl.sanitizeCollectionForRead(
        collection,
        accessControl.filterCollectionByScope(collection, data, req.user),
        req.user,
      );
      if (wantsPaginatedResponse(req.query)) {
        if (collection === 'clients') {
          data = enrichClientsWithBackendFinancials(data, req.user);
        }
        return res.json(buildPaginatedCollectionResponse(collection, data, req.query));
      }
      return res.json(data);
    });

    if (collection === 'clients') {
      router.get('/clients/diagnostics/duplicate-inn', requireAuth, async (req, res) => {
        const readAccess = await hasReadAccess(req, collection);
        if (readAccess.denied) {
          return res.status(readAccess.statusCode).json(readAccess.payload);
        }
        try {
          accessControl.assertCanReadCollection(collection, req.user);
        } catch (error) {
          return sendAccessError(res, error);
        }
        const data = accessControl.filterCollectionByScope(collection, readData(collection) || [], req.user);
        return res.json({
          ok: true,
          duplicates: buildClientInnDuplicateReport(data),
        });
      });
    }

    if (collection === 'service') {
      router.get('/service/repeat-breakdowns', requireAuth, requireRead('service'), (req, res) => {
        try {
          accessControl.assertCanReadCollection('service', req.user);
          const tickets = accessControl.sanitizeCollectionForRead(
            'service',
            accessControl.filterCollectionByScope('service', normalizeServiceTicketList(readData('service') || []), req.user),
            req.user,
          );
          const workItems = accessControl.sanitizeCollectionForRead(
            'repair_work_items',
            accessControl.filterCollectionByScope('repair_work_items', readData('repair_work_items') || [], req.user),
            req.user,
          );
          const partItems = accessControl.sanitizeCollectionForRead(
            'repair_part_items',
            accessControl.filterCollectionByScope('repair_part_items', readData('repair_part_items') || [], req.user),
            req.user,
          );
          const equipment = accessControl.sanitizeCollectionForRead(
            'equipment',
            accessControl.filterCollectionByScope('equipment', readData('equipment') || [], req.user),
            req.user,
          );
          const mechanics = canReadCollectionForSummary('mechanics', req.user)
            ? accessControl.sanitizeCollectionForRead(
                'mechanics',
                accessControl.filterCollectionByScope('mechanics', readData('mechanics') || [], req.user),
                req.user,
              )
            : [];
          const payload = {
            tickets,
            equipment,
            mechanics,
            workItems,
            partItems,
            fieldTrips: accessControl.filterCollectionByScope('service_field_trips', readData('service_field_trips') || [], req.user),
            warrantyClaims: accessControl.filterCollectionByScope('warranty_claims', readData('warranty_claims') || [], req.user),
          };
          if (String(req.query.view || '').trim() === 'quality') {
            return res.json(buildServiceRepairQualityView(payload));
          }
          return res.json(buildServiceRepeatBreakdowns(payload));
        } catch (error) {
          return sendAccessError(res, error);
        }
      });
    }

    router.get(`/${collection}/:id`, requireAuth, async (req, res) => {
      const readAccess = await hasReadAccess(req, collection);
      if (readAccess.denied) {
        return res.status(readAccess.statusCode).json(readAccess.payload);
      }
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      try {
        accessControl.assertCanReadCollection(collection, req.user);
      } catch (error) {
        return sendAccessError(res, error);
      }
      const data = readData(collection) || [];
      let item = data.find(entry => entry.id === req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
      if (collection === 'service_works') item = normalizeServiceWorkRecord(item);
      if (collection === 'spare_parts') item = normalizeSparePartRecord(item);
      if (collection === 'service') item = normalizeServiceTicketRecord(item);
      if (collection === 'users') {
        if (canReadFullUsers(req) || item.id === req.user.userId) {
          return res.json(sanitizeUser(item));
        }
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      if (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req) && item.userId !== req.user.userId) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      if (!accessControl.canAccessEntity(collection, item, req.user)) {
        return res.status(403).json({ ok: false, error: 'Forbidden' });
      }
      return res.json(accessControl.sanitizeEntityForRead(collection, item, req.user));
    });

    router.post(`/${collection}`, ...writeMiddlewares(collection), (req, res) => {
      if (isRepairItemCollection(collection)) {
        try {
          assertRepairItemsAdmin(req.user, { mode: 'create', input: req.body, readData });
        } catch (error) {
          return sendRepairItemsAdminError(res, error);
        }
      }
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'POST');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'POST');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'POST');
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'POST');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }
      try {
        accessControl.assertCanCreateCollection(collection, req.user, req.body);
        let input = accessControl.sanitizeCreateInput(collection, req.body, req.user);
        if (collection === 'equipment') {
          input = normalizeEquipmentReceiptPatch({}, input, {
            user: req.user,
            nowIso,
          });
          input = normalizeEquipmentStorageRecord(input);
        }
        if (collection === 'rentals' || collection === 'gantt_rentals') {
          const validation = validateRentalPayload(collection, input, readData(collection) || []);
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
        }

        if (collection === 'service_works') {
          requireNonEmptyString(input?.name, 'Название работы');
          validateServiceWorkCatalogRecord(input);
        }
        if (collection === 'spare_parts') {
          requireNonEmptyString(input?.name, 'Название запчасти');
          requireNonEmptyString(input?.unit, 'Единица измерения');
          validateSparePartCatalogRecord(input);
        }
        if (collection === 'payments') {
          validatePaymentRecord(input);
        }
        if (collection === 'crm_deals') {
          validateCrmDealRecord(input);
        }

        const data = readData(collection) || [];
        let newItem = withClientLink(collection, { ...input, id: input.id || generateId(prefix) });
        newItem = normalizeClientDomainRecord(collection, newItem);
        if (collection === 'service') {
          newItem = assignCurrentUserAsMechanicIfNeeded(newItem, req.user, {
            mechanics: readData('mechanics') || [],
            users: readData('users') || [],
          });
          newItem = normalizeServiceTicketForWrite(newItem, {
            actor: req.user,
            isCreate: true,
            nowIso,
          });
          assertServiceTicketDoesNotTargetProductionSmokeFixture(newItem, 'service_create');
        }
        if (collection === 'equipment_downtimes') {
          newItem = normalizeEquipmentDowntimeRecord(newItem, null, { user: req.user, nowIso });
          const validation = validateEquipmentDowntimeRecord(newItem, data);
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
        }
        if (collection === 'clients') {
          assertClientInnUnique(data, newItem);
        }
        if (collection === 'equipment') {
          validateEquipmentRecord(newItem, data);
          assertProductionSmokeFixtureMutationAllowed({
            action: 'create',
            next: newItem,
          });
        }
        if (collection === 'users') {
          newItem = normalizeUserPasswordForWrite(newItem);
        }
        if (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req)) {
          newItem = {
            ...newItem,
            userId: req.user.userId,
            userName: req.user.userName,
            userRole: req.user.userRole,
          };
        }
        if (collection === 'service_works') {
          newItem = normalizeServiceWorkRecord({ ...newItem, updatedAt: nowIso() });
        }
        if (collection === 'spare_parts') {
          newItem = normalizeSparePartRecord({ ...newItem, updatedAt: nowIso() });
        }
        if (collection === 'clients' || collection === 'equipment') {
          newItem = mergeEntityHistory(collection, null, newItem, req.user.userName);
        }
        data.push(newItem);
        writeData(collection, data);
        if (collection === 'clients') {
          normalizeStoredClientLinksAfterClientWrite();
        }
        if (isCriticalAuditCollection(collection)) {
          auditLog?.(req, {
            action: `${collection}.create`,
            entityType: collection,
            entityId: newItem.id,
            after: newItem,
          });
        }
        if (collection === 'repair_work_items') {
          serviceAuditLog?.(req, {
            serviceId: newItem.repairId,
            action: 'work_added',
            entityType: 'repair_work_item',
            entityId: newItem.id,
            snapshot: newItem,
            source: inferServiceAuditSource(req, 'api'),
          });
        }
        if (collection === 'repair_part_items') {
          serviceAuditLog?.(req, {
            serviceId: newItem.repairId,
            action: 'part_added',
            entityType: 'repair_part_item',
            entityId: newItem.id,
            snapshot: newItem,
            source: inferServiceAuditSource(req, 'api'),
          });
        }
        if (collection === 'users' && newItem.status !== 'Активен') {
          invalidateAffectedUserSessions([], [newItem]);
        }
        if (collection === 'payments') {
          syncPaymentStatusesAfterPaymentWrite(data);
        }
        if (collection === 'payment_allocations') {
          syncPaymentStatusesAfterPaymentWrite(readData('payments') || []);
        }
        if (collection === 'service') {
          applyServiceTicketCreationEffects?.(newItem, req.user.userName);
        }
        if (collection === 'users') {
          return res.status(201).json(sanitizeUser(newItem));
        }
        return res.status(201).json(newItem);
      } catch (error) {
        if (collection === 'clients' && error?.code === 'CLIENT_INN_DUPLICATE') {
          return sendClientInnError(res, error);
        }
        if (collection === 'equipment' && error?.code?.startsWith('EQUIPMENT_')) {
          return sendEquipmentValidationError(res, error);
        }
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, error);
        }
        if (error?.status) return sendAccessError(res, error);
        return res.status(400).json({ ok: false, error: error.message });
      }
    });

    router.patch(`/${collection}/:id`, ...writeMiddlewares(collection), (req, res) => {
      if (isRepairItemCollection(collection)) {
        try {
          assertRepairItemsAdmin(req.user);
        } catch (error) {
          return sendRepairItemsAdminError(res, error);
        }
      }
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'PATCH');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'PATCH');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      if (officeManagerCanOnlyCreateRental(req, collection, 'PATCH')) {
        return res.status(403).json({ ok: false, error: 'Недостаточно прав: офис-менеджер может только создавать аренду.' });
      }
      const data = readData(collection) || [];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      try {
        accessControl.assertCanUpdateEntity(collection, data[idx], req.user);
        if (collection === 'equipment') {
          assertNoRawProductionSmokeFixturePatch(data[idx], req.body);
        }
      } catch (error) {
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, error);
        }
        return sendAccessError(res, error);
      }
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'PATCH', data[idx]);
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'PATCH');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }

      if (collection === 'payments' && req.user?.userRole !== 'Администратор' && !isOfficeManager(req)) {
        const request = createEntityChangeRequest(req, {
          entityType: 'payment',
          entity: data[idx],
          rentalId: data[idx].rentalId,
          operation: 'update',
          type: 'Удаление или корректировка платежей',
          field: 'Платёж',
          oldValue: data[idx],
          newValue: { ...data[idx], ...req.body, id: data[idx].id },
          financialImpact: buildPaymentFinancialImpact(data[idx], req.body, 'update'),
        });
        return res.status(202).json({
          ok: true,
          changeRequest: request,
          message: `Изменение платежа отправлено на согласование: ${displayValue(request.oldValue?.invoiceNumber || request.entityId)}`,
        });
      }

      try {
        let safePatch = accessControl.sanitizeUpdateInput(collection, req.body, req.user, data[idx]);
        if (collection === 'equipment') {
          safePatch = normalizeEquipmentReceiptPatch(data[idx], safePatch, {
            user: req.user,
            nowIso,
          });
          safePatch = normalizeEquipmentStoragePatch(safePatch);
        }
        const previousItem = { ...data[idx] };
        if (collection === 'payments') {
          assertAllocatedPaymentPatchSafe(data[idx], safePatch);
          validatePaymentRecord({ ...data[idx], ...safePatch });
        }
        if (collection === 'crm_deals') {
          validateCrmDealRecord(safePatch);
        }
        if (collection === 'rentals' || collection === 'gantt_rentals') {
          const validation = validateRentalPayload(
            collection,
            { ...data[idx], ...safePatch },
            data,
            data[idx].id,
          );
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
        }
        if (collection === 'equipment_downtimes') {
          const nextDowntime = normalizeEquipmentDowntimeRecord(
            { ...data[idx], ...safePatch, id: data[idx].id },
            data[idx],
            { user: req.user, nowIso },
          );
          const validation = validateEquipmentDowntimeRecord(nextDowntime, data, data[idx].id);
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
          safePatch = nextDowntime;
        }
        if (collection === 'users') {
          validateUserSafetyChange(req, data, data[idx], { ...data[idx], ...safePatch, id: data[idx].id }, 'update', req.body);
        }

        if (collection === 'service_works') {
          requireNonEmptyString(safePatch?.name ?? data[idx].name, 'Название работы');
          validateServiceWorkCatalogRecord(safePatch);
          data[idx] = normalizeServiceWorkRecord({
            ...data[idx],
            ...safePatch,
            id: data[idx].id,
            createdAt: data[idx].createdAt,
            updatedAt: nowIso(),
          });
        } else if (collection === 'spare_parts') {
          requireNonEmptyString(safePatch?.name ?? data[idx].name, 'Название запчасти');
          requireNonEmptyString(safePatch?.unit ?? data[idx].unit, 'Единица измерения');
          validateSparePartCatalogRecord(safePatch);
          data[idx] = normalizeSparePartRecord({
            ...data[idx],
            ...safePatch,
            id: data[idx].id,
            createdAt: data[idx].createdAt,
            updatedAt: nowIso(),
          });
        } else {
          let nextItem = withClientLink(collection, { ...data[idx], ...safePatch, id: data[idx].id });
          nextItem = normalizeClientDomainRecord(collection, nextItem, data[idx]);
          if (collection === 'service') {
            nextItem = normalizeServiceTicketForWrite(nextItem, {
              previous: data[idx],
              actor: req.user,
              isCreate: false,
              nowIso,
            });
            assertServiceTicketDoesNotTargetProductionSmokeFixture(nextItem, 'service_update');
          }
          if (collection === 'clients') {
            assertClientInnUnique(data, nextItem, data[idx].id);
          }
          if (collection === 'equipment') {
            validateEquipmentRecord(nextItem, data, data[idx]);
          }
          if (collection === 'users') {
            if (
              safePatch.password ||
              safePatch.role !== undefined ||
              safePatch.status !== undefined ||
              safePatch.email !== undefined
            ) {
              nextItem.tokenVersion = (Number(data[idx].tokenVersion) || 0) + 1;
              nextItem.passwordChangedAt = safePatch.password ? nowIso() : data[idx].passwordChangedAt;
            }
            nextItem = normalizeUserPasswordForWrite(nextItem, data[idx]);
          }
          if (collection === 'equipment') {
            nextItem = normalizeEquipmentStorageRecord(nextItem);
            assertProductionSmokeFixtureMutationAllowed({
              action: 'update',
              previous: data[idx],
              next: nextItem,
            });
          }
          data[idx] = collection === 'clients' || collection === 'equipment'
            ? mergeEntityHistory(collection, data[idx], nextItem, req.user.userName)
            : (collection === 'knowledge_base_progress' && !isKnowledgeBaseReviewer(req)
              ? {
                  ...nextItem,
                  userId: data[idx].userId,
                  userName: data[idx].userName,
                  userRole: data[idx].userRole,
                }
              : nextItem);
        }
        writeData(collection, data);
        if (collection === 'equipment') {
          createReceiptServiceTicket(previousItem, data[idx], req.user.userName);
        }
        if (collection === 'clients') {
          normalizeStoredClientLinksAfterClientWrite();
        }
        if (isCriticalAuditCollection(collection)) {
          auditLog?.(req, {
            action: `${collection}.update`,
            entityType: collection,
            entityId: data[idx].id,
            before: collection === 'users'
              ? {
                  id: previousItem.id,
                  email: previousItem.email,
                  role: previousItem.role,
                  status: previousItem.status,
                }
              : previousItem,
            after: collection === 'users'
              ? {
                  id: data[idx].id,
                  email: data[idx].email,
                  role: data[idx].role,
                  status: data[idx].status,
                }
              : data[idx],
          });
        }
        if (collection === 'users') {
          auditUserStatusChanges(req, previousItem, data[idx]);
        }
        if (collection === 'users' && previousItem) {
          invalidateAffectedUserSessions([previousItem], [data[idx]]);
        }
        if (collection === 'payments') {
          syncPaymentStatusesAfterPaymentWrite(data);
        }
        if (collection === 'payment_allocations') {
          syncPaymentStatusesAfterPaymentWrite(readData('payments') || []);
        }
        if (collection === 'users') {
          return res.json(sanitizeUser(data[idx]));
        }
        return res.json(data[idx]);
      } catch (error) {
        if (collection === 'clients' && error?.code === 'CLIENT_INN_DUPLICATE') {
          return sendClientInnError(res, error);
        }
        if (collection === 'equipment' && error?.code?.startsWith('EQUIPMENT_')) {
          return sendEquipmentValidationError(res, error);
        }
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, error);
        }
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }
    });

    router.delete(`/${collection}/:id`, ...writeMiddlewares(collection), (req, res) => {
      if (isRepairItemCollection(collection)) {
        try {
          assertRepairItemsAdmin(req.user);
        } catch (error) {
          return sendRepairItemsAdminError(res, error);
        }
      }
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'DELETE');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'DELETE');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'DELETE');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }
      if (officeManagerCanOnlyCreateRental(req, collection, 'DELETE')) {
        return res.status(403).json({ ok: false, error: 'Недостаточно прав: офис-менеджер может только создавать аренду.' });
      }
      const data = readData(collection) || [];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      try {
        accessControl.assertCanDeleteEntity(collection, data[idx], req.user);
      } catch (error) {
        return sendAccessError(res, error);
      }
      if (collection === 'clients' && !canDeleteClients(req)) {
        return res.status(403).json({ ok: false, error: 'Удаление клиентов доступно только администратору или офис-менеджеру.' });
      }
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'DELETE', data[idx]);
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const removedItem = data[idx];
      try {
        if (collection === 'equipment') {
          assertProductionSmokeFixtureMutationAllowed({
            action: 'delete',
            previous: removedItem,
          });
        }
      } catch (error) {
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, error);
        }
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }
      if (collection === 'clients') {
        const linkedRentals = findClientLinkedRentals(removedItem);
        if (linkedRentals.length > 0) {
          return sendClientHasRentalsError(res, linkedRentals);
        }
        const historyLinks = findClientHistoryLinks(removedItem);
        if (historyLinks.length > 0) {
          return sendClientHasHistoryError(res, historyLinks);
        }
      }
      if (collection === 'payments' && req.user?.userRole !== 'Администратор') {
        const request = createEntityChangeRequest(req, {
          entityType: 'payment',
          entity: removedItem,
          rentalId: removedItem.rentalId,
          operation: 'delete',
          type: 'Удаление или корректировка платежей',
          field: 'Платёж',
          oldValue: removedItem,
          newValue: null,
          financialImpact: buildPaymentFinancialImpact(removedItem, null, 'delete'),
        });
        return res.status(202).json({ ok: true, changeRequest: request });
      }
      try {
        if (collection === 'payments') {
          assertAllocatedPaymentDeleteSafe(removedItem);
        }
      } catch (error) {
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }
      if (collection === 'documents' && req.user?.userRole !== 'Администратор') {
        const request = createEntityChangeRequest(req, {
          entityType: 'document',
          entity: removedItem,
          rentalId: removedItem.rental,
          operation: 'delete',
          type: 'Удаление документов',
          field: 'Документ',
          oldValue: removedItem,
          newValue: null,
          financialImpact: { amount: 0, description: 'Без прямого изменения суммы' },
        });
        return res.status(202).json({ ok: true, changeRequest: request });
      }
      if (collection === 'service' && req.user?.userRole !== 'Администратор') {
        const repairId = removedItem.id;
        const hasRepairFacts =
          (readData('repair_work_items') || []).some(item => item.repairId === repairId || item.serviceTicketId === repairId) ||
          (readData('repair_part_items') || []).some(item => item.repairId === repairId || item.serviceTicketId === repairId);
        if (hasRepairFacts) {
          return res.status(403).json({
            ok: false,
            error: 'Удаление сервисной заявки с работами или запчастями доступно только администратору.',
          });
        }
      }
      if (collection === 'users') {
        try {
          validateUserSafetyChange(req, data, removedItem, null, 'delete', req.body);
        } catch (error) {
          return res.status(error?.status || 400).json({ ok: false, error: error.message });
        }
      }
      if (collection === 'service') {
        const repairId = removedItem.id;
        for (const workItem of (readData('repair_work_items') || []).filter(item => item.repairId === repairId)) {
          serviceAuditLog?.(req, {
            serviceId: repairId,
            action: 'work_deleted',
            entityType: 'repair_work_item',
            entityId: workItem.id,
            snapshot: workItem,
            source: inferServiceAuditSource(req, 'api'),
          });
        }
        for (const partItem of (readData('repair_part_items') || []).filter(item => item.repairId === repairId)) {
          serviceAuditLog?.(req, {
            serviceId: repairId,
            action: 'part_deleted',
            entityType: 'repair_part_item',
            entityId: partItem.id,
            snapshot: partItem,
            source: inferServiceAuditSource(req, 'api'),
          });
        }
        writeData('repair_work_items', (readData('repair_work_items') || []).filter(item => item.repairId !== repairId));
        writeData('repair_part_items', (readData('repair_part_items') || []).filter(item => item.repairId !== repairId));
      }
      if (collection === 'repair_work_items') {
        serviceAuditLog?.(req, {
          serviceId: removedItem.repairId,
          action: 'work_deleted',
          entityType: 'repair_work_item',
          entityId: removedItem.id,
          snapshot: removedItem,
          source: inferServiceAuditSource(req, 'api'),
        });
      }
      if (collection === 'repair_part_items') {
        serviceAuditLog?.(req, {
          serviceId: removedItem.repairId,
          action: 'part_deleted',
          entityType: 'repair_part_item',
          entityId: removedItem.id,
          snapshot: removedItem,
          source: inferServiceAuditSource(req, 'api'),
        });
      }
      data.splice(idx, 1);
      writeData(collection, data);
      if (isCriticalAuditCollection(collection)) {
        auditLog?.(req, {
          action: `${collection}.delete`,
          entityType: collection,
          entityId: removedItem.id,
          before: collection === 'users'
            ? {
                id: removedItem.id,
                email: removedItem.email,
                role: removedItem.role,
                status: removedItem.status,
              }
            : removedItem,
        });
      }
      if (collection === 'users') {
        invalidateAffectedUserSessions([removedItem], []);
      }
      if (collection === 'payments') {
        syncPaymentStatusesAfterPaymentWrite(data);
      }
      if (collection === 'payment_allocations') {
        syncPaymentStatusesAfterPaymentWrite(readData('payments') || []);
      }
      return res.json({ ok: true });
    });

    router.put(`/${collection}`, ...writeMiddlewares(collection), (req, res) => {
      if (isRepairItemCollection(collection)) {
        try {
          assertRepairItemsAdmin(req.user);
        } catch (error) {
          return sendRepairItemsAdminError(res, error);
        }
      }
      const crmForbiddenReason = crmArchiveForbiddenReason(collection);
      if (crmForbiddenReason) {
        return res.status(410).json({ ok: false, error: crmForbiddenReason });
      }
      const rentalForbiddenReason = rentalWriteForbiddenReason(req, collection, 'PUT');
      if (rentalForbiddenReason) {
        return res.status(403).json({ ok: false, error: rentalForbiddenReason });
      }
      const serviceForbiddenReason = serviceWriteForbiddenReason(req, collection, 'PUT');
      if (serviceForbiddenReason) {
        return res.status(403).json({ ok: false, error: serviceForbiddenReason });
      }
      if (officeManagerCanOnlyCreateRental(req, collection, 'PUT')) {
        return res.status(403).json({ ok: false, error: 'Недостаточно прав: офис-менеджер может только создавать аренду.' });
      }
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'PUT');
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const knowledgeModuleForbiddenReason = knowledgeBaseModuleForbiddenReason(req, collection, 'PUT');
      if (knowledgeModuleForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeModuleForbiddenReason });
      }
      const body = req.body;
      let list = Array.isArray(body) ? body : body.data;
      if (!Array.isArray(list)) {
        return res.status(400).json({ ok: false, error: 'Expected array' });
      }
      if (collection === 'equipment') {
        try {
          assertProductionSmokeFixtureMutationAllowed({
            action: 'bulk_replace',
            existingList: readData('equipment') || [],
            nextList: list,
            buildPaginatedCollectionResponse,
          });
        } catch (error) {
          if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
            return sendSystemFixtureProtectedError(req, res, error);
          }
          return res.status(error?.status || 400).json({ ok: false, error: error.message });
        }
      }
      try {
        accessControl.assertCanBulkReplace(collection, req.user);
        accessControl.assertSafeAdminBulkReplaceInput(collection, list);
      } catch (error) {
        return sendAccessError(res, error);
      }

      if (collection === 'rentals' || collection === 'gantt_rentals') {
        for (const item of list) {
          const validation = validateRentalPayload(collection, item, list, item.id);
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
        }
      }
      if (collection === 'equipment_downtimes') {
        list = list.map(item => normalizeEquipmentDowntimeRecord(item, null, { user: req.user, nowIso }));
        for (const item of list) {
          const validation = validateEquipmentDowntimeRecord(item, list, item.id);
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
        }
      }
      try {
        if (collection === 'payments') {
          for (const item of list) validatePaymentRecord(item);
        }
        if (collection === 'payment_allocations') {
          validatePaymentAllocationBulkReplace(list);
        }
        if (collection === 'clients') {
          for (const item of list) assertClientInnValid(item);
          assertClientInnListUnique(list);
        }
        if (collection === 'client_objects' || collection === 'client_contracts') {
          for (const item of list) normalizeClientDomainRecord(collection, item);
        }
        if (collection === 'service_works') {
          for (const item of list) validateServiceWorkCatalogRecord(item);
        }
        if (collection === 'spare_parts') {
          for (const item of list) validateSparePartCatalogRecord(item);
        }
        if (collection === 'crm_deals') {
          for (const item of list) validateCrmDealRecord(item);
        }
      } catch (error) {
        if (collection === 'clients' && error?.code === 'CLIENT_INN_DUPLICATE') {
          return sendClientInnError(res, error);
        }
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }

      if (collection === 'service_works') {
        writeData(collection, list.map(item => normalizeServiceWorkRecord({ ...item, updatedAt: nowIso() })));
        auditLog?.(req, {
          action: `${collection}.bulk_replace`,
          entityType: collection,
          after: { count: list.length },
        });
        return res.json({ ok: true, count: list.length });
      }

      if (collection === 'spare_parts') {
        writeData(collection, list.map(item => normalizeSparePartRecord({ ...item, updatedAt: nowIso() })));
        auditLog?.(req, {
          action: `${collection}.bulk_replace`,
          entityType: collection,
          after: { count: list.length },
        });
        return res.json({ ok: true, count: list.length });
      }

      if (collection === 'users') {
        const existing = readData('users') || [];
        const existingById = new Map(existing.map(item => [item.id, item]));
        const merged = list.map(item => {
          const existingUser = existingById.get(item.id);
          if (!item.password) {
            const existingPwd = existingUser?.password;
            if (existingPwd) return preserveExistingUserAuthState({ ...item, password: existingPwd }, existingUser);
          }
          return preserveExistingUserAuthState(normalizeUserPasswordForWrite(item, existingUser), existingUser);
        });
        const incomingIds = new Set(merged.map(item => String(item?.id || '')));
        for (const existingUser of existing) {
          if (!incomingIds.has(String(existingUser?.id || ''))) {
            return res.status(400).json({ ok: false, error: 'Массовое удаление пользователей запрещено. Деактивируйте пользователя или используйте подтверждённое удаление.' });
          }
        }
        try {
          for (const nextUser of merged) {
            const previousUser = existingById.get(nextUser.id);
            if (previousUser) {
              if (previousUser.status !== nextUser.status) {
                return res.status(400).json({ ok: false, error: 'Массовое изменение статуса пользователей запрещено. Используйте подтверждённую деактивацию или активацию пользователя.' });
              }
              validateUserSafetyChange(req, existing, previousUser, nextUser, 'update', { confirm: true });
            }
          }
        } catch (error) {
          return res.status(error?.status || 400).json({ ok: false, error: error.message });
        }
        writeData('users', merged);
        invalidateAffectedUserSessions(existing, merged);
        auditLog?.(req, {
          action: `${collection}.bulk_replace`,
          entityType: collection,
          after: { count: merged.length },
        });
        for (const nextUser of merged) {
          auditUserStatusChanges(req, existingById.get(nextUser.id), nextUser);
        }
        return res.json({ ok: true, count: merged.length });
      }

      if (isRepairItemCollection(collection)) {
        const existing = readData(collection) || [];
        const incomingIds = new Set(list.map(item => String(item?.id || '')).filter(Boolean));
        const existingIds = new Set(existing.map(item => String(item?.id || '')).filter(Boolean));
        const source = inferServiceAuditSource(req, 'sync');
        for (const removed of existing) {
          if (!incomingIds.has(String(removed?.id || ''))) {
            serviceAuditLog?.(req, {
              serviceId: removed.repairId,
              action: collection === 'repair_work_items' ? 'work_deleted' : 'part_deleted',
              entityType: collection === 'repair_work_items' ? 'repair_work_item' : 'repair_part_item',
              entityId: removed.id,
              snapshot: removed,
              source,
            });
          }
        }
        for (const added of list) {
          if (!existingIds.has(String(added?.id || ''))) {
            serviceAuditLog?.(req, {
              serviceId: added.repairId,
              action: collection === 'repair_work_items' ? 'work_added' : 'part_added',
              entityType: collection === 'repair_work_items' ? 'repair_work_item' : 'repair_part_item',
              entityId: added.id,
              snapshot: added,
              source,
            });
          }
        }
      }

      const normalizedList = list.map(item => {
        const linked = withClientLink(collection, item);
        const normalized = normalizeClientDomainRecord(collection, linked);
        return collection === 'equipment' ? normalizeEquipmentStorageRecord(normalized) : normalized;
      });
      try {
        if (collection === 'equipment') {
          assertProductionSmokeFixtureMutationAllowed({
            action: 'bulk_replace',
            existingList: readData('equipment') || [],
            nextList: normalizedList,
            buildPaginatedCollectionResponse,
          });
        }
      } catch (error) {
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, error);
        }
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }
      writeData(collection, normalizedList);
      if (collection === 'clients') {
        normalizeStoredClientLinksAfterClientWrite();
      }
      auditLog?.(req, {
        action: `${collection}.bulk_replace`,
        entityType: collection,
        after: { count: list.length },
      });
      if (collection === 'payments') {
        syncPaymentStatusesAfterPaymentWrite(normalizedList);
      }
      if (collection === 'payment_allocations') {
        syncPaymentStatusesAfterPaymentWrite(readData('payments') || []);
      }
      return res.json({ ok: true, count: list.length });
    });
  }

  for (const collection of collections) {
    registerCRUD(collection);
  }

  return router;
}

module.exports = {
  registerCrudRoutes,
};
