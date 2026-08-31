const express = require('express');
const crypto = require('crypto');
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
  prepareAuditedServiceMutationEntries,
  prepareServiceMutationAuditEntries,
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
  canonicalizeDocumentCounterpartyRelation,
  isHistoricalDocumentRelation,
} = require('../lib/document-counterparty-relations');
const {
  prepareClientCompatibilityBulkReplace,
  prepareClientCompatibilityCreate,
  prepareClientCompatibilityUpdate,
} = require('../lib/counterparty');
const {
  CONTRACTOR_PROFILES_COLLECTION,
  ROLE_ASSIGNMENTS_COLLECTION,
  SUPPLIER_PROFILES_COLLECTION,
  synchronizeClientRoleBoundary,
} = require('../lib/counterparty-role-profiles');
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
  appendEquipmentPhoto,
  createUploadedPhoto,
  deleteEquipmentPhoto,
  makeEquipmentPhotoMain,
} = require('../lib/equipment-photo-gallery');
const {
  SYSTEM_FIXTURE_PROTECTED_CODE,
  SYSTEM_FIXTURE_PROTECTED_MESSAGE,
  assertProductionSmokeFixtureMutationAllowed,
  createSystemFixtureProtectedError,
  isAvailableForRentEquipment,
  isProductionSmokeEquipmentFixture,
} = require('../lib/protected-fixtures');
const { linkedRentalIds } = require('../lib/gantt-rental-link-guard');
const { equipmentProjectionForState, reconcileEquipmentRentalProjection } = require('../lib/rental-lifecycle');
const {
  assertPaymentAllocationCandidateCanonical,
  assertPaymentAllocationPersistenceEntriesSafe,
  assertPaymentRentalCounterpartyMatch,
  canonicalizePaymentCounterpartyRelation,
  decoratePaymentCounterparty,
  resolvePaymentAllocationEndpoints,
} = require('../lib/payment-counterparty-relations');
const {
  canonicalizeDeliveryCarrierCounterpartyRelation,
  deliveryCarrierReferenceBlockers,
  isHistoricalDeliveryCarrierRelation,
} = require('../lib/delivery-counterparty-relations');
const {
  canonicalizeServiceTicketCounterpartyRelation,
  decorateServiceTicketCounterparty,
} = require('../lib/service-counterparty-relations');
const { assertBusinessNumberNotProvided } = require('../lib/business-numbering');
const { assertEntityOwnerScope } = require('../lib/client-master-data-lifecycle');
const {
  canonicalizeWarrantyClaimCounterpartyRelation,
  decorateWarrantyClaimCounterparty,
  isTerminalWarrantyClaim,
} = require('../lib/warranty-claim-counterparty-relations');
const {
  canonicalizeWarrantyClaimFactoryCounterpartyRelation,
  decorateWarrantyClaimFactoryCounterparty,
  listEligibleWarrantyFactoryCounterparties,
} = require('../lib/warranty-claim-factory-counterparty-relations');
const {
  AR_WORKFLOW_COLLECTIONS,
  assertCanonicalArWorkflowWrite,
  decorateArWorkflowRecord,
} = require('../lib/ar-debtor-workflow');
const {
  CONTRACT_HAS_HISTORY_CODE,
  assertClientContractAvailableForNewLink,
  assertClientContractDeleteContext,
  clientContractStatus,
  findClientContractHistoryLinks,
} = require('../lib/client-contract-lifecycle');
const {
  assertOwnershipFieldsNotClientSupplied,
  assertRecordMatchesActorScope,
  assignTrustedScope,
  filterRecordsByActorScope,
  isScopedMasterDataCollection,
  requireRequestActorScope,
} = require('../lib/trusted-actor-scope');
const { hasUserAuthorityChange } = require('../lib/user-authority-transition');
const {
  CATALOG_ORIGIN_KINDS,
  isPlatformDefaultTenantOverlayCollection,
} = require('../lib/platform-default-tenant-overlay');
const {
  assertEquipmentGsmProjectionMutation,
  preserveEquipmentGsmProjection,
  stripEquipmentGsmProjectionFields,
} = require('../lib/gsm/trusted-device-scope');

const INLINE_RELATION_IDEMPOTENCY_SCOPES = new Set(['client_objects', 'client_contracts']);

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

function inlineRelationFingerprint(collection, input) {
  return crypto
    .createHash('sha256')
    .update(stableJson({ collection, input }))
    .digest('hex');
}

function readInlineRelationIdempotencyKey(req, collection) {
  if (!INLINE_RELATION_IDEMPOTENCY_SCOPES.has(collection)) return '';
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

function registerCrudRoutes(deps) {
  const {
    collections,
    idPrefixes,
    readData,
    writeData,
    writeDataBatch,
    writeServiceDataBatch,
    persistUserAuthorityTransition,
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
    persistServiceTicketUpdate,
    persistServiceTicketDeletion,
    persistServiceTicketBulkReplace,
    accessControl,
    auditLog,
    serviceAuditLog,
    normalizeRecordClientLink,
    businessNumbering = null,
    requestIdempotency = null,
    catalogLifecycle = null,
    db = null,
  } = deps;
  const persistDataBatch = typeof writeDataBatch === 'function'
    ? writeDataBatch
    : entries => {
        for (const entry of entries || []) writeData(entry.name, entry.value);
      };

  function requireAtomicServiceWriter() {
    if (typeof writeServiceDataBatch === 'function') return writeServiceDataBatch;
    const error = new Error('Atomic service audit persistence is unavailable.');
    error.code = 'SERVICE_ATOMIC_AUDIT_REQUIRED';
    error.status = 503;
    throw error;
  }

  function serviceMutationAuditEntries(req, serviceEvents, securityEvents) {
    return prepareServiceMutationAuditEntries({
      reqOrUser: req,
      serviceEvents,
      securityEvents,
      serviceAuditLog,
      auditLog,
    });
  }

  function persistAuditedServiceMutation(req, businessEntries, serviceEvents, securityEvents) {
    requireAtomicServiceWriter()(prepareAuditedServiceMutationEntries({
      reqOrUser: req,
      businessEntries,
      serviceEvents,
      securityEvents,
      serviceAuditLog,
      auditLog,
    }));
  }

  function serviceTicketAuditEvent(req, action, ticket) {
    return {
      serviceId: ticket.id,
      action,
      entityType: 'service_ticket',
      entityId: ticket.id,
      snapshot: ticket,
      source: inferServiceAuditSource(req, 'api'),
    };
  }

  function repairItemAuditEvent(req, collection, action, item) {
    return {
      serviceId: item.serviceTicketId || item.repairId,
      action,
      entityType: collection === 'repair_work_items' ? 'repair_work_item' : 'repair_part_item',
      entityId: item.id,
      snapshot: item,
      source: inferServiceAuditSource(req, 'api'),
    };
  }

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
  if (
    (collections || []).includes('users')
    && (
      typeof persistUserAuthorityTransition !== 'function'
      || typeof auditLog?.preparePersistenceEntry !== 'function'
    )
  ) {
    throw new Error('Generic users CRUD requires atomic user-authority transition persistence.');
  }
  const registersMixedCatalog = (collections || []).some(isPlatformDefaultTenantOverlayCollection);
  const requiredCatalogLifecycleMethods = [
    'createTenantCatalogEntry',
    'updateEffectiveTenantCatalogRecord',
    'deleteEffectiveTenantCatalogRecord',
  ];
  if (
    registersMixedCatalog
    && (
      !catalogLifecycle
      || requiredCatalogLifecycleMethods.some(name => typeof catalogLifecycle[name] !== 'function')
    )
  ) {
    throw new Error('Generic mixed-catalog CRUD requires the trusted logical catalog lifecycle.');
  }

  function sendAccessError(res, error) {
    return res.status(error?.status || 403).json({
      ok: false,
      ...(error?.code ? { code: error.code } : {}),
      error: error?.message || 'Forbidden',
    });
  }

  function sendCatalogLifecycleError(res, error) {
    return res.status(error?.status || 409).json({
      ok: false,
      ...(error?.code ? { code: error.code } : {}),
      error: error?.message || 'Catalog lifecycle mutation failed.',
      ...(error?.details !== undefined ? { details: error.details } : {}),
    });
  }

  function sanitizeCatalogResult(collection, item, user) {
    return item ? accessControl.sanitizeEntityForRead(collection, item, user) : null;
  }

  function normalizeMixedCatalogCreateInput(collection, input) {
    let normalized = { ...input };
    if (collection === 'service_works') {
      normalized = normalizeServiceWorkRecord({ ...normalized, updatedAt: nowIso() });
    } else if (collection === 'spare_parts') {
      normalized = normalizeSparePartRecord({ ...normalized, updatedAt: nowIso() });
    } else {
      const timestamp = nowIso();
      normalized = {
        ...normalized,
        createdAt: normalized.createdAt || timestamp,
        updatedAt: timestamp,
      };
    }
    // Physical identity and scope are allocated atomically by the trusted
    // boundary. The generic normalizers historically allocated an ID, so drop
    // that server-local placeholder before entering the lifecycle.
    delete normalized.id;
    delete normalized.companyId;
    delete normalized.tenantId;
    delete normalized.platformDefaultId;
    delete normalized.catalogOrigin;
    return normalized;
  }

  function normalizeMixedCatalogPatch(collection, current, patch) {
    if (collection === 'service_works') {
      const normalized = normalizeServiceWorkRecord({
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: nowIso(),
      });
      delete normalized.id;
      delete normalized.catalogOrigin;
      return normalized;
    }
    if (collection === 'spare_parts') {
      const normalized = normalizeSparePartRecord({
        ...current,
        ...patch,
        id: current.id,
        createdAt: current.createdAt,
        updatedAt: nowIso(),
      });
      delete normalized.id;
      delete normalized.catalogOrigin;
      return normalized;
    }
    return { ...patch, updatedAt: nowIso() };
  }

  function requireRequestIdempotency() {
    if (
      !requestIdempotency
      || typeof requestIdempotency.inspect !== 'function'
      || typeof requestIdempotency.execute !== 'function'
    ) {
      const error = new Error('Сервис серверной идемпотентности недоступен.');
      error.status = 503;
      error.code = 'IDEMPOTENCY_SERVICE_UNAVAILABLE';
      throw error;
    }
    return requestIdempotency;
  }

  function inlineIdempotencyInput(req, collection, actorScope, key, fingerprint) {
    return {
      scope: actorScope,
      operation: `${collection}.create`,
      clientKey: key,
      requestFingerprint: fingerprint,
      resultType: collection,
      createdByUserId: String(req.user?.userId || ''),
    };
  }

  function sendInlineRelationReplay(req, res, collection, actorScope, resultId) {
    const existing = (readData(collection) || [])
      .find(item => String(item?.id || '') === String(resultId || ''));
    if (!existing) {
      return res.status(409).json({
        ok: false,
        code: 'IDEMPOTENCY_RESULT_UNAVAILABLE',
        error: 'Результат предыдущего запроса больше недоступен. Обновите список перед повтором.',
      });
    }
    if (!accessControl.canAccessEntity(collection, existing, req.user)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    if (actorScope) assertRecordMatchesActorScope(existing, actorScope);
    res.setHeader('Idempotency-Replayed', 'true');
    const replayed = accessControl.sanitizeEntityForRead(collection, existing, req.user);
    return res.status(200).json(collection === 'payments'
      ? decoratePaymentCounterparty(replayed, { readData })
      : replayed);
  }

  function sendCounterpartyCompatibilityError(res, error) {
    return res.status(error?.status || 400).json({
      ok: false,
      code: error?.code || 'COUNTERPARTY_VALIDATION_FAILED',
      error: error?.message || 'Не удалось сохранить связь Client с контрагентом.',
      ...(error?.details !== undefined ? { details: error.details } : {}),
    });
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

  function isPaymentProjectionCollection(collection) {
    return collection === 'payments' || collection === 'payment_allocations';
  }

  function buildPaymentProjectionEntries(collection, nextValue) {
    const payments = collection === 'payments' ? nextValue : (readData('payments') || []);
    const paymentAllocations = collection === 'payment_allocations'
      ? nextValue
      : (readData('payment_allocations') || []);
    return [
      { name: collection, value: nextValue },
      {
        name: 'gantt_rentals',
        value: syncGanttRentalPaymentStatuses(
          readData('gantt_rentals') || [],
          payments,
          paymentAllocations,
        ),
      },
    ];
  }

  function persistPaymentProjection(collection, nextValue) {
    if (typeof writeDataBatch !== 'function') {
      const error = new Error('Atomic payment projection persistence is unavailable.');
      error.status = 503;
      error.code = 'PAYMENT_PROJECTION_ATOMIC_WRITE_REQUIRED';
      throw error;
    }
    const entries = buildPaymentProjectionEntries(collection, nextValue);
    assertPaymentAllocationPersistenceEntriesSafe(entries, { readData });
    persistDataBatch(entries);
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
    if (typeof applyServiceTicketCreationEffects === 'function') {
      const lifecycleResult = applyServiceTicketCreationEffects(ticket, authorName || 'Система', {
        persistService: true,
        serviceTickets: [...service, ticket],
      });
      if (lifecycleResult?.persisted !== true) writeData('service', [...service, ticket]);
    } else {
      writeData('service', [...service, ticket]);
    }
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
      allowLegacyRecovery: false,
    });
  }

  function normalizeClientDomainRecord(collection, item, existing = null, readDataOverride = readData) {
    if (collection === 'clients') {
      const normalized = normalizeClientInnFields(item);
      if (normalized.counterpartyId && !normalized.inn) return normalized;
      assertClientInnValid(normalized);
      return normalized;
    }
    if (collection === 'client_objects') {
      return normalizeClientObjectRecord(item, existing, { readData: readDataOverride, nowIso });
    }
    if (collection === 'client_contracts') {
      return normalizeClientContractRecord(item, existing, { readData: readDataOverride, nowIso });
    }
    if (['payments', 'payment_allocations', 'documents', 'service'].includes(collection) && item?.contractId) {
      assertClientContractAvailableForNewLink(readDataOverride, item.contractId, {
        allowArchivedContractId: existing?.contractId,
      });
    }
    if (collection === 'delivery_carriers') {
      return canonicalizeDeliveryCarrierCounterpartyRelation(item, { readData: readDataOverride }, {
        existing,
        allowArchived: isHistoricalDeliveryCarrierRelation(item),
      });
    }
    if (collection === 'warranty_claims') {
      const customerCanonical = canonicalizeWarrantyClaimCounterpartyRelation(item, { readData: readDataOverride }, {
        existing,
        // Existing terminal history may retain an inactive target. New API rows may not.
        allowHistoricalTarget: Boolean(existing)
          && isTerminalWarrantyClaim(existing)
          && isTerminalWarrantyClaim(item),
      });
      return canonicalizeWarrantyClaimFactoryCounterpartyRelation(
        customerCanonical,
        { readData: readDataOverride },
        {
          existing,
          allowHistoricalTarget: Boolean(existing)
            && isTerminalWarrantyClaim(existing)
            && isTerminalWarrantyClaim(item),
        },
      );
    }
    if (collection === 'payments' || collection === 'payment_allocations' || collection === 'documents' || collection === 'service') {
      const enriched = enrichRecordFromRentalLinks(item, readDataOverride);
      if (collection === 'documents') {
        return canonicalizeDocumentCounterpartyRelation(enriched, readDataOverride, {
          existing,
          allowArchived: isHistoricalDocumentRelation(enriched),
          requireActiveObject: !existing,
        });
      }
      if (collection === 'service') {
        return canonicalizeServiceTicketCounterpartyRelation(enriched, { readData: readDataOverride }, { existing });
      }
      const normalized = normalizeClientRelationLinks(enriched, enriched.clientId, {
        readData: readDataOverride,
        requireActiveObject: !existing,
        allowArchivedObjectId: existing?.objectId,
      });
      if (collection === 'payment_allocations') validatePaymentAllocationRecord(normalized, existing);
      if (collection === 'payments') {
        return canonicalizePaymentCounterpartyRelation(normalized, { readData: readDataOverride });
      }
      return normalized;
    }
    return item;
  }

  function assertWarrantyTargetServiceAccess(nextClaim, previousClaim, user) {
    const nextServiceTicketId = String(nextClaim?.serviceTicketId || '').trim();
    const previousServiceTicketId = String(previousClaim?.serviceTicketId || '').trim();
    if (!nextServiceTicketId || nextServiceTicketId === previousServiceTicketId) return;
    const matches = (readData('service') || [])
      .filter(ticket => String(ticket?.id || '').trim() === nextServiceTicketId);
    // Relation canonicalization owns missing/duplicate diagnostics. Authorization is
    // evaluated only after an exact unique target exists.
    if (matches.length !== 1) return;
    if (!accessControl.canAccessEntity('service', matches[0], user)) {
      const error = new Error('Недостаточно прав на целевую сервисную заявку рекламации.');
      error.status = 403;
      error.code = 'WARRANTY_TARGET_SERVICE_FORBIDDEN';
      throw error;
    }
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

  function assertEquipmentLifecycleProjection(nextEquipmentList, equipmentIds) {
    const affectedEquipmentIds = new Set((equipmentIds || []).map(value => String(value || '')).filter(Boolean));
    if (affectedEquipmentIds.size === 0) return;
    const today = nowIso().slice(0, 10);
    for (const item of nextEquipmentList) {
      if (!affectedEquipmentIds.has(String(item?.id || ''))) continue;
      const activeProjection = equipmentProjectionForState({
        equipment: { ...item, activeInFleet: true, status: 'available' },
        equipmentList: nextEquipmentList,
        rentals: readData('rentals') || [],
        ganttRentals: readData('gantt_rentals') || [],
        serviceTickets: readData('service') || [],
        today,
      });
      if (
        ['rental', 'service'].includes(activeProjection.source)
        && (item.activeInFleet === false || String(item.status || '').toLowerCase() === 'inactive')
      ) {
        const error = new Error('Нельзя деактивировать технику с активной арендой или сервисной заявкой.');
        error.status = 409;
        error.code = 'EQUIPMENT_LIFECYCLE_PROJECTION_CONFLICT';
        error.field = item.activeInFleet === false ? 'activeInFleet' : 'status';
        error.equipmentId = item.id;
        throw error;
      }
    }
    const lifecycle = reconcileEquipmentRentalProjection({
      equipmentList: nextEquipmentList,
      rentals: readData('rentals') || [],
      ganttRentals: readData('gantt_rentals') || [],
      serviceTickets: readData('service') || [],
      affectedEquipmentIds,
      nowIso,
      author: 'Система',
      reason: 'Проверка прямого изменения техники',
    });
    const projectedById = new Map(lifecycle.nextEquipment.map(item => [String(item?.id || ''), item]));
    const contradiction = nextEquipmentList.find(item => {
      if (!affectedEquipmentIds.has(String(item?.id || ''))) return false;
      const projected = projectedById.get(String(item?.id || ''));
      return String(item?.status || '') !== String(projected?.status || '')
        || String(item?.currentClient || '') !== String(projected?.currentClient || '')
        || String(item?.returnDate || '').slice(0, 10) !== String(projected?.returnDate || '').slice(0, 10);
    });
    if (!contradiction) return;
    const error = new Error('Статус, клиент и дата возврата техники управляются lifecycle-операциями аренды и сервиса.');
    error.status = 409;
    error.code = 'EQUIPMENT_LIFECYCLE_PROJECTION_CONFLICT';
    error.field = 'status';
    error.equipmentId = contradiction.id;
    throw error;
  }

  function equipmentReferenceBlocker(equipment) {
    const refs = new Set([
      String(equipment?.id || ''),
      String(equipment?.inventoryNumber || ''),
      String(equipment?.serialNumber || ''),
    ].filter(Boolean));
    const matches = record => [
      record?.equipmentId,
      record?.equipmentInv,
      record?.inventoryNumber,
      record?.serialNumber,
      ...(Array.isArray(record?.equipment) ? record.equipment : []),
    ].some(value => refs.has(String(value || '')));
    for (const collectionName of ['rentals', 'gantt_rentals', 'service', 'deliveries', 'documents']) {
      const dependent = (readData(collectionName) || []).find(matches);
      if (dependent) return { collection: collectionName, id: dependent.id };
    }
    return null;
  }

  const CLIENT_CONTRACT_PATCH_FIELDS = new Set(['date', 'title', 'objectId', 'objectIds', 'notes', 'status']);
  const CLIENT_CONTRACT_IMMUTABLE_FIELDS = new Set([
    'id',
    'number',
    'businessNumber',
    'createdAt',
    'updatedAt',
    'clientId',
    'counterpartyId',
    'companyId',
    'tenantId',
  ]);
  const CLIENT_CONTRACT_ACTIVITY_FIELDS = ['date', 'title', 'objectId', 'objectIds', 'notes', 'status'];

  function scopedValue(value) {
    return String(value || '').trim();
  }

  function assertClientContractUpdateScope(req, contract) {
    const actorScope = requireRequestActorScope(req);
    const ownerClient = (readData('clients') || [])
      .find(client => scopedValue(client?.id) === scopedValue(contract?.clientId)) || null;
    const ownerCounterparty = (readData('counterparties') || [])
      .find(counterparty => scopedValue(counterparty?.id) === scopedValue(contract?.counterpartyId)) || null;
    for (const field of ['companyId', 'tenantId']) {
      const values = [...new Set([contract, ownerClient, ownerCounterparty]
        .map(record => scopedValue(record?.[field]))
        .filter(Boolean))];
      if (values.length === 0) {
        const error = new Error(`Legacy scope договора нельзя определить по ${field}.`);
        error.status = 409;
        error.code = 'CLIENT_CONTRACT_SCOPE_UNKNOWN';
        error.details = { field };
        throw error;
      }
      if (values.length > 1) {
        const error = new Error('Scope договора конфликтует с canonical owner scope.');
        error.status = 409;
        error.code = 'CLIENT_CONTRACT_SCOPE_CONFLICT';
        error.details = { field, values };
        throw error;
      }
      if (values[0] !== actorScope[field]) {
        const error = new Error('Договор не принадлежит компании или tenant текущего пользователя.');
        error.status = 403;
        error.code = 'CLIENT_CONTRACT_SCOPE_FORBIDDEN';
        error.details = { field };
        throw error;
      }
    }
  }

  function assertScopedClientContractPatch(req, contract) {
    assertClientContractUpdateScope(req, contract);
    const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
    const immutableField = Object.keys(body).find(field => CLIENT_CONTRACT_IMMUTABLE_FIELDS.has(field));
    if (immutableField) {
      const error = new Error(`Поле ${immutableField} договора нельзя изменять.`);
      error.status = 409;
      error.code = 'CLIENT_CONTRACT_FIELD_IMMUTABLE';
      throw error;
    }
    const unsupportedField = Object.keys(body).find(field => !CLIENT_CONTRACT_PATCH_FIELDS.has(field));
    if (unsupportedField) {
      const error = new Error(`Поле ${unsupportedField} не поддерживается формой редактирования договора.`);
      error.status = 400;
      error.code = 'CLIENT_CONTRACT_PATCH_FIELD_UNSUPPORTED';
      throw error;
    }
    if (Object.prototype.hasOwnProperty.call(body, 'status') && !['active', 'archived'].includes(body.status)) {
      const error = new Error('Статус договора должен быть active или archived.');
      error.status = 400;
      error.code = 'CLIENT_CONTRACT_STATUS_INVALID';
      throw error;
    }
  }

  function clientContractChanged(previous, next) {
    return CLIENT_CONTRACT_ACTIVITY_FIELDS.some(field => stableJson(previous?.[field]) !== stableJson(next?.[field]));
  }

  function appendClientContractActivity(clients, contract, actor) {
    const clientId = scopedValue(contract?.clientId);
    if (!clientId) return clients;
    const index = clients.findIndex(client => scopedValue(client?.id) === clientId);
    if (index === -1) return clients;
    const next = [...clients];
    const current = next[index];
    next[index] = {
      ...current,
      history: [
        ...(Array.isArray(current?.history) ? current.history : []),
        {
          date: nowIso(),
          text: `Договор изменён: ${contract.number}`,
          author: actor?.userName || actor?.name || 'Система',
          type: 'system',
        },
      ],
    };
    return next;
  }

  function sendEquipmentValidationError(res, error) {
    return res.status(error?.status || 400).json({
      ok: false,
      error: error?.message || 'Некорректные данные техники',
      code: error?.code,
      field: error?.field,
      fieldErrors: error?.fieldErrors,
      equipmentId: error?.equipmentId,
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
    } else if (existing?.password && next.password === existing.password) {
      // A profile-only PATCH carries the stored password through the merged record.
      // Do not mistake that inherited legacy value for a password reset.
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

  function safeUserAuditSnapshot(user) {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      status: user.status,
    };
  }

  function userStatusAuditEvents(previousUser, nextUser) {
    if (!previousUser || !nextUser || previousUser.status === nextUser.status) return [];
    const events = [{
      action: 'users.status_change',
      entityType: 'users',
      entityId: nextUser.id,
      before: safeUserAuditSnapshot(previousUser),
      after: safeUserAuditSnapshot(nextUser),
    }];
    if (previousUser.status === 'Активен' && nextUser.status !== 'Активен') {
      events.push({
        action: 'users.deactivate',
        entityType: 'users',
        entityId: nextUser.id,
        before: safeUserAuditSnapshot(previousUser),
        after: safeUserAuditSnapshot(nextUser),
      });
    }
    return events;
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

  function persistUserMutation(req, {
    previousUsers,
    nextUsers,
    action,
    entityId = null,
    before = null,
    after = null,
    metadata = null,
  }) {
    const previous = Array.isArray(previousUsers) ? previousUsers : [];
    const next = Array.isArray(nextUsers) ? nextUsers : [];
    const previousById = new Map(previous.map(item => [String(item?.id || ''), item]));
    const statusEvents = next.flatMap(item => userStatusAuditEvents(
      previousById.get(String(item?.id || '')),
      item,
    ));
    const auditEntry = auditLog.preparePersistenceEntry(req, [{
      action,
      entityType: 'users',
      entityId,
      before: safeUserAuditSnapshot(before),
      after: safeUserAuditSnapshot(after),
      metadata,
    }, ...statusEvents]);
    if (!auditEntry) {
      const error = new Error('Atomic user authority audit persistence is unavailable.');
      error.code = 'USER_AUTHORITY_AUDIT_REQUIRED';
      error.status = 503;
      throw error;
    }
    return persistUserAuthorityTransition({
      entries: [
        { name: 'users', value: next },
        auditEntry,
      ],
      expectedUsers: previous,
    });
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
    const effective = String(record?.status || '').trim().toLowerCase() !== 'cancelled';
    let payment;
    if (effective) {
      payment = assertPaymentAllocationCandidateCanonical(record, { readData }).paymentRecord;
    } else {
      const endpoints = resolvePaymentAllocationEndpoints(record, { readData }, { requireRental: false });
      payment = endpoints.paymentRecord;
      if (endpoints.rentalRecord) {
        assertPaymentRentalCounterpartyMatch(payment, endpoints.rentalRecord, { readData });
      }
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
    const documentIds = new Set((readData('documents') || [])
      .map(item => String(item?.id || '').trim())
      .filter(Boolean));
    const totalsByPaymentId = new Map();
    for (const record of records || []) {
      const paymentId = String(record?.paymentId || '').trim();
      if (!paymentId) throw new Error('Для распределения платежа укажите paymentId');
      const effective = String(record?.status || '').trim().toLowerCase() !== 'cancelled';
      if (effective) {
        assertPaymentAllocationCandidateCanonical(record, { readData });
      } else {
        const endpoints = resolvePaymentAllocationEndpoints(record, { readData }, { requireRental: false });
        if (endpoints.rentalRecord) {
          assertPaymentRentalCounterpartyMatch(
            endpoints.paymentRecord,
            endpoints.rentalRecord,
            { readData },
          );
        }
      }
      const documentId = String(record?.documentId || '').trim();
      if (documentId && !documentIds.has(documentId)) throw new Error('Документ для распределения не найден');
      if (!effective) continue;
      const amount = Number(record?.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        throw new Error('Сумма распределения должна быть больше 0');
      }
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
      searchFields: ['id', 'number', 'equipment', 'inventoryNumber', 'serialNumber', 'reason', 'description', 'client', 'clientName', 'assignedMechanicName', 'assignedTo', 'createdByUserName', 'contractNumber'],
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
      searchFields: ['id', 'number', 'equipmentLabel', 'factoryName', 'factoryCounterpartyId', 'factoryCounterpartyDisplayName', 'counterpartyId', 'counterpartyName', 'customerDisplayName', 'clientName', 'responsibleName', 'description'],
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
        counterpartyId: (item, value) => item.counterpartyId === value,
        factoryCounterpartyId: (item, value) => item.factoryCounterpartyId === value,
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
      searchFields: ['number', 'documentNumber', 'type', 'documentType', 'client', 'clientName', 'clientId', 'counterpartyId', 'rentalId', 'rental', 'equipmentInv', 'equipmentId', 'deliveryId', 'status', 'signatoryName', 'signatoryBasis'],
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
        counterpartyId: (item, value) => item.counterpartyId === value,
        clientId: (item, value) => item.clientId === value,
        rentalId: (item, value) => item.rentalId === value || item.rental === value,
        equipmentId: (item, value) => item.equipmentId === value,
      },
    },
    payments: {
      searchFields: [
        'id',
        'invoiceNumber',
        'documentNumber',
        'documentId',
        'client',
        'clientName',
        'clientId',
        'counterpartyId',
        item => item?.counterparty?.legalName,
        item => item?.counterparty?.shortName,
        item => item?.counterparty?.inn,
        item => item?.counterparty?.phone,
        'rentalId',
        'method',
        'status',
        'comment',
        'purpose',
      ],
      sortFields: {
        date: item => item.date || item.paymentDate || item.createdAt,
        amount: item => Number(item.amount || 0),
        client: item => item?.counterparty?.shortName || item?.counterparty?.legalName || item.clientName || item.client,
        status: item => item.status,
        createdAt: item => item.createdAt,
      },
      defaultSort: { sortBy: 'date', sortDir: 'desc' },
      filters: {
        status: (item, value) => item.status === value,
        counterpartyId: (item, value) => item.counterpartyId === value,
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
      relationData: { readData },
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
      let actorScope = null;
      if (isScopedMasterDataCollection(collection)) {
        try {
          actorScope = requireRequestActorScope(req);
        } catch (error) {
          return sendAccessError(res, error);
        }
      }
      let data = readData(collection) || [];
      if (actorScope) data = filterRecordsByActorScope(data, actorScope);
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
      if (collection === 'client_contracts') {
        data = data.map(item => ({ ...item, status: clientContractStatus(item) }));
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
      if (collection === 'service') {
        data = data.map(item => decorateServiceTicketCounterparty(item, { readData }));
      }
      if (collection === 'warranty_claims') {
        data = data.map(item => decorateWarrantyClaimFactoryCounterparty(
          decorateWarrantyClaimCounterparty(item, { readData }),
          { readData },
        ));
        if (req.query.counterpartyId) {
          data = data.filter(item => item.counterpartyId === req.query.counterpartyId);
        }
        if (req.query.factoryCounterpartyId) {
          data = data.filter(item => item.factoryCounterpartyId === req.query.factoryCounterpartyId);
        }
        if (req.query.clientId) {
          data = data.filter(item => item.clientId === req.query.clientId);
        }
      }
      if (collection === 'payments') {
        data = data.map(item => decoratePaymentCounterparty(item, { readData }));
      }
      if (AR_WORKFLOW_COLLECTIONS.has(collection)) {
        data = data.map(item => decorateArWorkflowRecord(collection, item, { readData }));
      }
      if (wantsPaginatedResponse(req.query)) {
        if (collection === 'clients') {
          data = enrichClientsWithBackendFinancials(data, req.user);
        }
        return res.json(buildPaginatedCollectionResponse(collection, data, req.query));
      }
      return res.json(data);
    });

    if (collection === 'warranty_claims') {
      router.get(
        '/warranty_claims/factory-counterparty-options',
        requireAuth,
        requireRead('warranty_claims'),
        (req, res) => {
          try {
            accessControl.assertCanReadCollection('warranty_claims', req.user);
            return res.json(listEligibleWarrantyFactoryCounterparties({ readData }));
          } catch (error) {
            return sendAccessError(res, error);
          }
        },
      );
    }

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
        let actorScope;
        try {
          actorScope = requireRequestActorScope(req);
        } catch (error) {
          return sendAccessError(res, error);
        }
        const data = accessControl.filterCollectionByScope(
          collection,
          filterRecordsByActorScope(readData(collection) || [], actorScope),
          req.user,
        );
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
      let actorScope = null;
      if (isScopedMasterDataCollection(collection)) {
        try {
          actorScope = requireRequestActorScope(req);
        } catch (error) {
          return sendAccessError(res, error);
        }
      }
      const data = readData(collection) || [];
      let item = data.find(entry => entry.id === req.params.id);
      if (!item) return res.status(404).json({ ok: false, error: 'Not found' });
      if (actorScope) {
        try {
          assertRecordMatchesActorScope(item, actorScope);
        } catch (error) {
          return sendAccessError(res, error);
        }
      }
      if (collection === 'service_works') item = normalizeServiceWorkRecord(item);
      if (collection === 'spare_parts') item = normalizeSparePartRecord(item);
      if (collection === 'service') item = normalizeServiceTicketRecord(item);
      if (collection === 'client_contracts') item = { ...item, status: clientContractStatus(item) };
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
      const sanitized = accessControl.sanitizeEntityForRead(collection, item, req.user);
      return res.json(collection === 'payments'
        ? decoratePaymentCounterparty(sanitized, { readData })
        : collection === 'service'
          ? decorateServiceTicketCounterparty(sanitized, { readData })
          : collection === 'warranty_claims'
            ? decorateWarrantyClaimFactoryCounterparty(
                decorateWarrantyClaimCounterparty(sanitized, { readData }),
                { readData },
              )
            : AR_WORKFLOW_COLLECTIONS.has(collection)
              ? decorateArWorkflowRecord(collection, sanitized, { readData })
              : sanitized);
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
        const actorScope = isScopedMasterDataCollection(collection)
          ? requireRequestActorScope(req)
          : null;
        if (actorScope) assertOwnershipFieldsNotClientSupplied(req.body);
        if (businessNumbering && ['service', 'warranty_claims', 'client_contracts'].includes(collection)) {
          assertBusinessNumberNotProvided(req.body);
        }
        accessControl.assertCanCreateCollection(collection, req.user, req.body);
        if (collection === 'equipment') {
          assertEquipmentGsmProjectionMutation(req.body);
        }
        let input = accessControl.sanitizeCreateInput(collection, req.body, req.user);
        if (collection === 'equipment') {
          input = stripEquipmentGsmProjectionFields(input);
        }
        if (actorScope) input = assignTrustedScope(input, actorScope);
        const idempotencyKey = readInlineRelationIdempotencyKey(req, collection);
        const idempotencyFingerprint = idempotencyKey
          ? inlineRelationFingerprint(collection, input)
          : '';
        const idempotencyInput = idempotencyKey
          ? inlineIdempotencyInput(req, collection, actorScope, idempotencyKey, idempotencyFingerprint)
          : null;
        if (idempotencyKey) {
          const inspected = requireRequestIdempotency().inspect(idempotencyInput);
          if (inspected.status === 'replayed') {
            return sendInlineRelationReplay(
              req,
              res,
              collection,
              actorScope,
              inspected.resultId,
            );
          }
        }
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
        if (isPlatformDefaultTenantOverlayCollection(collection)) {
          const created = catalogLifecycle.createTenantCatalogEntry(
            collection,
            normalizeMixedCatalogCreateInput(collection, input),
          );
          auditLog?.(req, {
            action: `${collection}.create`,
            entityType: collection,
            entityId: created.id,
            after: created,
          });
          return res.status(201).json(sanitizeCatalogResult(collection, created, req.user));
        }
        if (collection === 'payments') {
          validatePaymentRecord(input);
        }
        if (collection === 'crm_deals') {
          validateCrmDealRecord(input);
        }

        const data = readData(collection) || [];
        let newItem = withClientLink(collection, { ...input, id: input.id || generateId(prefix) });
        const deferClientContractNumber = Boolean(
          collection === 'client_contracts'
          && businessNumbering
          && idempotencyKey,
        );
        const prepareClientContractNumberInPersistence = Boolean(
          collection === 'client_contracts'
          && businessNumbering,
        );
        newItem = prepareClientContractNumberInPersistence
          ? normalizeClientContractRecord(newItem, null, {
            readData,
            nowIso,
            // The server-owned number is allocated only inside the eventual
            // persistence transaction. A keyed request keeps its explicit
            // allocation after winning idempotency; an unkeyed request is
            // numbered by the central canonical batch writer.
            allowMissingServerNumber: true,
          })
          : normalizeClientDomainRecord(collection, newItem);
        if (collection === 'client_objects') {
          assertEntityOwnerScope({
            actor: { ...req.user, ...actorScope },
            entityType: 'client_object',
            entity: newItem,
            readData,
          });
        }
        if (collection === 'client_contracts') {
          assertClientContractUpdateScope(req, newItem);
        }
        if (AR_WORKFLOW_COLLECTIONS.has(collection)) {
          newItem = assertCanonicalArWorkflowWrite(collection, newItem, { readData }, {
            recordId: newItem.id,
          });
        }
        if (collection === 'warranty_claims') {
          assertWarrantyTargetServiceAccess(newItem, null, req.user);
        }
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
          newItem = validation.downtime;
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
        let clientCompatibilityWrite = null;
        if (collection === 'clients') {
          const prepared = prepareClientCompatibilityCreate({
            client: newItem,
            clients: data,
            counterparties: readData('counterparties') || [],
            generateId,
            nowIso,
          });
          newItem = prepared.client;
          clientCompatibilityWrite = synchronizeClientRoleBoundary({
            counterparties: prepared.counterparties,
            clients: [...data, newItem],
            roleAssignments: readData(ROLE_ASSIGNMENTS_COLLECTION) || [],
            supplierProfiles: readData(SUPPLIER_PROFILES_COLLECTION) || [],
            contractorProfiles: readData(CONTRACTOR_PROFILES_COLLECTION) || [],
            clientIds: [newItem.id],
            actor: req.user,
            source: 'client_create',
            nowIso,
          });
          newItem = clientCompatibilityWrite.state.clients
            .find(client => String(client?.id || '') === String(newItem.id)) || newItem;
        }
        if (collection === 'payment_allocations') {
          assertPaymentAllocationPersistenceEntriesSafe([
            { name: 'payment_allocations', value: [...data, newItem] },
          ], { readData });
        }
        if (collection === 'users') {
          persistUserMutation(req, {
            previousUsers: data,
            nextUsers: [...data, newItem],
            action: 'users.create',
            entityId: newItem.id,
            after: newItem,
          });
        } else if (collection === 'service') {
          if (typeof applyServiceTicketCreationEffects !== 'function') {
            throw Object.assign(new Error('Atomic service creation lifecycle is unavailable.'), {
              code: 'SERVICE_ATOMIC_AUDIT_REQUIRED',
              status: 503,
            });
          }
          const lifecycleResult = applyServiceTicketCreationEffects(newItem, req.user.userName, {
            persistService: true,
            serviceTickets: [...data, newItem],
            writeDataBatch: requireAtomicServiceWriter(),
            buildExtraEntries: persistedTicket => serviceMutationAuditEntries(
              req,
              [serviceTicketAuditEvent(req, 'ticket_created', persistedTicket)],
              [{
                action: 'service.create',
                entityType: 'service',
                entityId: persistedTicket.id,
                after: persistedTicket,
              }],
            ),
          });
          newItem = lifecycleResult?.ticket || newItem;
          if (lifecycleResult?.persisted !== true) {
            persistAuditedServiceMutation(req, [{
              name: collection,
              value: [...data, newItem],
            }], [serviceTicketAuditEvent(req, 'ticket_created', newItem)], [{
              action: 'service.create',
              entityType: 'service',
              entityId: newItem.id,
              after: newItem,
            }]);
          }
        } else if (isRepairItemCollection(collection)) {
          persistAuditedServiceMutation(req, [{
            name: collection,
            value: [...data, newItem],
          }], [repairItemAuditEvent(
            req,
            collection,
            collection === 'repair_work_items' ? 'work_added' : 'part_added',
            newItem,
          )], [{
            action: `${collection}.create`,
            entityType: collection,
            entityId: newItem.id,
            after: newItem,
          }]);
        } else if (collection === 'clients') {
          persistDataBatch(clientCompatibilityWrite.entries);
        } else if (idempotencyKey) {
          const outcome = requireRequestIdempotency().execute(idempotencyInput, () => {
            if (deferClientContractNumber) {
              businessNumbering.assignNewRecord('client_contracts', newItem);
              newItem = normalizeClientContractRecord(newItem, null, { readData, nowIso });
            }
            persistDataBatch([{ name: collection, value: [...data, newItem] }]);
            return newItem.id;
          });
          if (outcome.status === 'replayed') {
            return sendInlineRelationReplay(
              req,
              res,
              collection,
              actorScope,
              outcome.resultId,
            );
          }
        } else if (isPaymentProjectionCollection(collection)) {
          persistPaymentProjection(collection, [...data, newItem]);
        } else {
          writeData(collection, [...data, newItem]);
        }
        if (
          isCriticalAuditCollection(collection)
          && collection !== 'users'
          && collection !== 'service'
          && !isRepairItemCollection(collection)
        ) {
          auditLog?.(req, {
            action: `${collection}.create`,
            entityType: collection,
            entityId: newItem.id,
            after: newItem,
          });
        }
        if (collection === 'users') {
          return res.status(201).json(sanitizeUser(newItem));
        }
        return res.status(201).json(collection === 'payments'
          ? decoratePaymentCounterparty(newItem, { readData })
          : collection === 'service'
            ? decorateServiceTicketCounterparty(newItem, { readData })
            : collection === 'warranty_claims'
              ? decorateWarrantyClaimFactoryCounterparty(
                  decorateWarrantyClaimCounterparty(newItem, { readData }),
                  { readData },
                )
            : AR_WORKFLOW_COLLECTIONS.has(collection)
              ? decorateArWorkflowRecord(collection, newItem, { readData })
              : newItem);
      } catch (error) {
        if (String(error?.code || '').startsWith('COUNTERPARTY_')) {
          return sendCounterpartyCompatibilityError(res, error);
        }
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
      if (
        isScopedMasterDataCollection(collection)
        && ['companyId', 'tenantId'].some(field => Object.prototype.hasOwnProperty.call(req.body || {}, field))
      ) {
        return res.status(409).json({
          ok: false,
          code: collection === 'client_contracts'
            ? 'CLIENT_CONTRACT_FIELD_IMMUTABLE'
            : 'MASTER_DATA_SCOPE_IMMUTABLE',
          error: collection === 'client_contracts'
            ? 'Поле companyId/tenantId договора нельзя изменять.'
            : 'Scope master-data нельзя менять через generic PATCH.',
        });
      }
      if (
        collection === 'client_objects'
        && Object.prototype.hasOwnProperty.call(req.body || {}, 'status')
      ) {
        return res.status(409).json({
          ok: false,
          code: 'CLIENT_OBJECT_LIFECYCLE_ENDPOINT_REQUIRED',
          error: 'Статус объекта изменяется только через domain lifecycle endpoint.',
        });
      }
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
      if (businessNumbering && ['service', 'warranty_claims', 'client_contracts'].includes(collection)) {
        try {
          assertBusinessNumberNotProvided(req.body);
        } catch (error) {
          return res.status(error.status || 400).json({ ok: false, code: error.code, error: error.message });
        }
      }
      let data = [...(readData(collection) || [])];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      try {
        if (isScopedMasterDataCollection(collection)) {
          const actorScope = requireRequestActorScope(req);
          assertRecordMatchesActorScope(data[idx], actorScope);
        }
        if (collection === 'client_contracts') {
          assertScopedClientContractPatch(req, data[idx]);
        }
        if (collection === 'clients' || collection === 'client_objects') {
          assertEntityOwnerScope({
            actor: req.user,
            entityType: collection === 'clients' ? 'client' : 'client_object',
            entity: data[idx],
            readData,
          });
        }
        if (
          isPlatformDefaultTenantOverlayCollection(collection)
          && data[idx]?.catalogOrigin?.kind === CATALOG_ORIGIN_KINDS.PLATFORM_DEFAULT
        ) {
          // Updating a logical platform default means creating a tenant-owned
          // override. Authorize it as tenant creation, never as default mutation.
          accessControl.assertCanCreateCollection(collection, req.user, req.body);
        } else {
          accessControl.assertCanUpdateEntity(collection, data[idx], req.user);
        }
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
        let clientCompatibilityWrite = null;
        if (collection === 'equipment') {
          assertEquipmentGsmProjectionMutation(req.body, { current: data[idx] });
        }
        let safePatch = accessControl.sanitizeUpdateInput(collection, req.body, req.user, data[idx]);
        if (collection === 'equipment') {
          safePatch = stripEquipmentGsmProjectionFields(safePatch);
        }
        if (isPlatformDefaultTenantOverlayCollection(collection)) {
          if (Object.keys(safePatch).length === 0) {
            const error = new Error('Catalog PATCH must contain at least one mutable business field.');
            error.status = 400;
            error.code = 'CATALOG_PATCH_EMPTY';
            throw error;
          }
          if (collection === 'service_works') {
            requireNonEmptyString(safePatch?.name ?? data[idx].name, 'Название работы');
            validateServiceWorkCatalogRecord(safePatch);
          }
          if (collection === 'spare_parts') {
            requireNonEmptyString(safePatch?.name ?? data[idx].name, 'Название запчасти');
            requireNonEmptyString(safePatch?.unit ?? data[idx].unit, 'Единица измерения');
            validateSparePartCatalogRecord(safePatch);
          }
          const updated = catalogLifecycle.updateEffectiveTenantCatalogRecord(
            collection,
            req.params.id,
            normalizeMixedCatalogPatch(collection, data[idx], safePatch),
          );
          auditLog?.(req, {
            action: `${collection}.update`,
            entityType: collection,
            entityId: req.params.id,
            before: data[idx],
            after: updated,
          });
          return res.json(sanitizeCatalogResult(collection, updated, req.user));
        }
        if (collection === 'warranty_claims') {
          assertWarrantyTargetServiceAccess({ ...data[idx], ...safePatch }, data[idx], req.user);
        }
        if (
          collection === 'service'
          && Object.prototype.hasOwnProperty.call(safePatch, 'comment')
          && String(safePatch.comment || '').trim()
        ) {
          safePatch = {
            ...safePatch,
            workLog: [
              ...(Array.isArray(data[idx].workLog) ? data[idx].workLog : []),
              {
                date: nowIso(),
                text: String(safePatch.comment).trim(),
                author: req.user?.userName || 'Оператор',
                type: 'comment',
              },
            ],
          };
        }
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
          safePatch = validation.downtime;
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
          if (AR_WORKFLOW_COLLECTIONS.has(collection)) {
            nextItem = assertCanonicalArWorkflowWrite(collection, nextItem, { readData }, {
              recordId: nextItem.id,
            });
          }
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
            nextItem = normalizeUserPasswordForWrite(nextItem, data[idx]);
            if (hasUserAuthorityChange(data[idx], nextItem)) {
              const passwordChanged = nextItem.password !== data[idx].password;
              nextItem.tokenVersion = (Number(data[idx].tokenVersion) || 0) + 1;
              nextItem.passwordChangedAt = passwordChanged ? nowIso() : data[idx].passwordChangedAt;
            }
          }
          if (collection === 'equipment') {
            nextItem = normalizeEquipmentStorageRecord(nextItem);
            assertProductionSmokeFixtureMutationAllowed({
              action: 'update',
              previous: data[idx],
              next: nextItem,
            });
            if (['status', 'currentClient', 'returnDate', 'activeInFleet'].some(field => Object.prototype.hasOwnProperty.call(safePatch, field))) {
              assertEquipmentLifecycleProjection(
                data.map((item, itemIndex) => itemIndex === idx ? nextItem : item),
                [nextItem.id],
              );
            }
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
          if (collection === 'payments') {
            assertPaymentAllocationPersistenceEntriesSafe([
              { name: 'payments', value: data },
            ], { readData });
          }
          if (collection === 'clients') {
            const prepared = prepareClientCompatibilityUpdate({
              previousClient: previousItem,
              nextClient: data[idx],
              patch: safePatch,
              clients: data,
              counterparties: readData('counterparties') || [],
              nowIso,
            });
            data[idx] = prepared.client;
            clientCompatibilityWrite = synchronizeClientRoleBoundary({
              counterparties: prepared.counterparties,
              clients: data,
              roleAssignments: readData(ROLE_ASSIGNMENTS_COLLECTION) || [],
              supplierProfiles: readData(SUPPLIER_PROFILES_COLLECTION) || [],
              contractorProfiles: readData(CONTRACTOR_PROFILES_COLLECTION) || [],
              clientIds: [data[idx].id],
              actor: req.user,
              source: 'client_update',
              nowIso,
            });
            data = clientCompatibilityWrite.state.clients;
          }
        }
        if (collection === 'payment_allocations') {
          assertPaymentAllocationPersistenceEntriesSafe([
            { name: 'payment_allocations', value: data },
          ], { readData });
        }
        const contractActivityClients = collection === 'client_contracts' && clientContractChanged(previousItem, data[idx])
          ? appendClientContractActivity(readData('clients') || [], data[idx], req.user)
          : null;
        if (collection === 'users') {
          persistUserMutation(req, {
            previousUsers: readData('users') || [],
            nextUsers: data,
            action: 'users.update',
            entityId: data[idx].id,
            before: previousItem,
            after: data[idx],
          });
        } else if (collection === 'service') {
          if (typeof persistServiceTicketUpdate !== 'function') {
            throw Object.assign(new Error('Atomic service update lifecycle is unavailable.'), {
              code: 'SERVICE_ATOMIC_AUDIT_REQUIRED',
              status: 503,
            });
          }
          data[idx] = persistServiceTicketUpdate(data[idx], req.user.userName, {
            writeDataBatch: requireAtomicServiceWriter(),
            buildExtraEntries: persistedTicket => serviceMutationAuditEntries(
              req,
              [serviceTicketAuditEvent(req, 'ticket_updated', persistedTicket)],
              [{
                action: 'service.update',
                entityType: 'service',
                entityId: persistedTicket.id,
                before: previousItem,
                after: persistedTicket,
              }],
            ),
          });
        } else if (isRepairItemCollection(collection)) {
          persistAuditedServiceMutation(req, [{
            name: collection,
            value: data,
          }], [repairItemAuditEvent(
            req,
            collection,
            collection === 'repair_work_items' ? 'work_updated' : 'part_updated',
            data[idx],
          )], [{
            action: `${collection}.update`,
            entityType: collection,
            entityId: data[idx].id,
            before: previousItem,
            after: data[idx],
          }]);
        } else if (collection === 'clients') {
          persistDataBatch(clientCompatibilityWrite.entries);
        } else if (contractActivityClients) {
          persistDataBatch([
            { name: 'client_contracts', value: data },
            { name: 'clients', value: contractActivityClients },
          ]);
        } else if (isPaymentProjectionCollection(collection)) {
          persistPaymentProjection(collection, data);
        } else {
          writeData(collection, data);
        }
        if (collection === 'equipment') {
          createReceiptServiceTicket(previousItem, data[idx], req.user.userName);
        }
        if (
          isCriticalAuditCollection(collection)
          && collection !== 'users'
          && collection !== 'service'
          && !isRepairItemCollection(collection)
        ) {
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
          return res.json(sanitizeUser(data[idx]));
        }
        return res.json(collection === 'payments'
          ? decoratePaymentCounterparty(data[idx], { readData })
          : collection === 'service'
            ? decorateServiceTicketCounterparty(data[idx], { readData })
            : collection === 'warranty_claims'
              ? decorateWarrantyClaimFactoryCounterparty(
                  decorateWarrantyClaimCounterparty(data[idx], { readData }),
                  { readData },
                )
            : AR_WORKFLOW_COLLECTIONS.has(collection)
              ? decorateArWorkflowRecord(collection, data[idx], { readData })
              : data[idx]);
      } catch (error) {
        if (String(error?.code || '').startsWith('COUNTERPARTY_')) {
          return sendCounterpartyCompatibilityError(res, error);
        }
        if (collection === 'clients' && error?.code === 'CLIENT_INN_DUPLICATE') {
          return sendClientInnError(res, error);
        }
        if (collection === 'equipment' && error?.code?.startsWith('EQUIPMENT_')) {
          return sendEquipmentValidationError(res, error);
        }
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, error);
        }
        return res.status(error?.status || 400).json({
          ok: false,
          error: error.message,
          ...(error?.code ? { code: error.code } : {}),
          ...(error?.details ? { details: error.details } : {}),
        });
      }
    });

    router.delete(`/${collection}/:id`, ...writeMiddlewares(collection), (req, res) => {
      if (collection === 'clients' || collection === 'client_objects') {
        return res.status(405).json({
          ok: false,
          code: 'DOMAIN_LIFECYCLE_ENDPOINT_REQUIRED',
          error: `Generic DELETE для ${collection} отключён; требуется domain lifecycle handler.`,
        });
      }
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
      const data = [...(readData(collection) || [])];
      const idx = data.findIndex(entry => entry.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      try {
        if (isScopedMasterDataCollection(collection)) {
          const actorScope = requireRequestActorScope(req);
          assertRecordMatchesActorScope(data[idx], actorScope);
        }
        if (collection === 'client_contracts') {
          assertClientContractUpdateScope(req, data[idx]);
        }
        accessControl.assertCanDeleteEntity(collection, data[idx], req.user);
      } catch (error) {
        return sendAccessError(res, error);
      }
      const knowledgeProgressForbiddenReason = knowledgeBaseProgressForbiddenReason(req, collection, 'DELETE', data[idx]);
      if (knowledgeProgressForbiddenReason) {
        return res.status(403).json({ ok: false, error: knowledgeProgressForbiddenReason });
      }
      const removedItem = data[idx];
      if (isPlatformDefaultTenantOverlayCollection(collection)) {
        try {
          const fallback = catalogLifecycle.deleteEffectiveTenantCatalogRecord(
            collection,
            req.params.id,
          );
          auditLog?.(req, {
            action: `${collection}.delete`,
            entityType: collection,
            entityId: req.params.id,
            before: removedItem,
            after: fallback,
          });
          return res.json({
            ok: true,
            effective: sanitizeCatalogResult(collection, fallback, req.user),
          });
        } catch (error) {
          return sendCatalogLifecycleError(res, error);
        }
      }
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
        if (String(error?.code || '').startsWith('EQUIPMENT_')) {
          return sendEquipmentValidationError(res, error);
        }
        return res.status(error?.status || 400).json({ ok: false, error: error.message });
      }
      if (collection === 'client_contracts') {
        try {
          assertClientContractDeleteContext(removedItem, req.query);
        } catch (error) {
          return res.status(error.status || 400).json({
            ok: false,
            code: error.code,
            error: error.message,
            details: error.details,
          });
        }
        const historyLinks = findClientContractHistoryLinks(removedItem, { readData, db });
        if (historyLinks.length > 0) {
          return res.status(409).json({
            ok: false,
            code: CONTRACT_HAS_HISTORY_CODE,
            error: 'Договор используется в истории и не может быть удалён. Его можно архивировать.',
            links: historyLinks,
          });
        }
      }
      if (collection === 'equipment') {
        const blocker = equipmentReferenceBlocker(removedItem);
        if (blocker) {
          return res.status(409).json({
            ok: false,
            code: 'EQUIPMENT_DELETE_HAS_LIFECYCLE_REFERENCES',
            error: `Технику нельзя удалить: есть связанная запись ${blocker.collection} ${blocker.id}. Деактивируйте карточку вместо удаления.`,
          });
        }
      }
      if (collection === 'delivery_carriers') {
        const blockers = deliveryCarrierReferenceBlockers(removedItem, { readData });
        if (blockers.length > 0) {
          return res.status(409).json({
            ok: false,
            code: 'DELIVERY_CARRIER_HAS_HISTORY',
            error: 'Перевозчика нельзя удалить: существуют связанные доставки. Переведите запись в неактивный статус.',
            blockers,
          });
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
      let serviceDeleteEntries = [];
      let serviceDeleteEvents = [];
      if (collection === 'service') {
        const repairId = removedItem.id;
        const belongsToTicket = item => (
          String(item?.serviceTicketId || item?.repairId || '') === String(repairId)
        );
        const removedWorks = (readData('repair_work_items') || []).filter(belongsToTicket);
        const removedParts = (readData('repair_part_items') || []).filter(belongsToTicket);
        serviceDeleteEvents = [
          ...removedWorks.map(workItem => repairItemAuditEvent(req, 'repair_work_items', 'work_deleted', workItem)),
          ...removedParts.map(partItem => repairItemAuditEvent(req, 'repair_part_items', 'part_deleted', partItem)),
          serviceTicketAuditEvent(req, 'ticket_deleted', removedItem),
        ];
        serviceDeleteEntries = [
          { name: 'repair_work_items', value: (readData('repair_work_items') || []).filter(item => !belongsToTicket(item)) },
          { name: 'repair_part_items', value: (readData('repair_part_items') || []).filter(item => !belongsToTicket(item)) },
        ];
      }
      const previousUsers = collection === 'users' ? [...data] : null;
      data.splice(idx, 1);
      if (collection === 'users') {
        try {
          persistUserMutation(req, {
            previousUsers,
            nextUsers: data,
            action: 'users.delete',
            entityId: removedItem.id,
            before: removedItem,
          });
        } catch (error) {
          return res.status(error?.status || 500).json({
            ok: false,
            ...(error?.code ? { code: error.code } : {}),
            error: error?.message || 'Не удалось атомарно удалить пользователя.',
          });
        }
      } else if (collection === 'service') {
        try {
          if (typeof persistServiceTicketDeletion !== 'function') {
            throw Object.assign(new Error('Atomic service deletion lifecycle is unavailable.'), {
              code: 'SERVICE_ATOMIC_AUDIT_REQUIRED',
              status: 503,
            });
          }
          persistServiceTicketDeletion(removedItem, req.user.userName, {
            writeDataBatch: requireAtomicServiceWriter(),
            extraEntries: [
              ...serviceDeleteEntries,
              ...serviceMutationAuditEntries(req, serviceDeleteEvents, [{
                action: 'service.delete',
                entityType: 'service',
                entityId: removedItem.id,
                before: removedItem,
              }]),
            ],
          });
        } catch (error) {
          return res.status(error?.status || 500).json({
            ok: false,
            code: error?.code || 'SERVICE_DELETE_PERSISTENCE_FAILED',
            error: error?.message || 'Не удалось атомарно удалить сервисную заявку.',
          });
        }
      } else if (isRepairItemCollection(collection)) {
        try {
          persistAuditedServiceMutation(req, [{
            name: collection,
            value: data,
          }], [repairItemAuditEvent(
            req,
            collection,
            collection === 'repair_work_items' ? 'work_deleted' : 'part_deleted',
            removedItem,
          )], [{
            action: `${collection}.delete`,
            entityType: collection,
            entityId: removedItem.id,
            before: removedItem,
          }]);
        } catch (error) {
          return res.status(error?.status || 500).json({
            ok: false,
            ...(error?.code ? { code: error.code } : {}),
            error: error?.message || 'Не удалось атомарно удалить сервисный факт.',
          });
        }
      } else if (isPaymentProjectionCollection(collection)) {
        try {
          persistPaymentProjection(collection, data);
        } catch (error) {
          return res.status(error?.status || 500).json({
            ok: false,
            ...(error?.code ? { code: error.code } : {}),
            error: error?.message || 'Atomic payment projection persistence failed.',
          });
        }
      } else {
        for (const entry of serviceDeleteEntries) writeData(entry.name, entry.value);
        writeData(collection, data);
      }
      if (
        isCriticalAuditCollection(collection)
        && collection !== 'users'
        && collection !== 'service'
        && !isRepairItemCollection(collection)
      ) {
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
        if (collection === 'equipment') {
          const existingById = new Map((readData('equipment') || [])
            .map(item => [String(item?.id || '').trim(), item])
            .filter(([id]) => id));
          list = list.map((item) => {
            const previous = existingById.get(String(item?.id || '').trim()) || null;
            assertEquipmentGsmProjectionMutation(item, { current: previous });
            return stripEquipmentGsmProjectionFields(item);
          });
        }
        accessControl.assertSafeAdminBulkReplaceInput(collection, list);
      } catch (error) {
        return sendAccessError(res, error);
      }

      let trustedBulkScope = null;
      if (isScopedMasterDataCollection(collection)) {
        try {
          trustedBulkScope = requireRequestActorScope(req);
        } catch (error) {
          return sendAccessError(res, error);
        }
      }

      if (trustedBulkScope) {
        const existing = readData(collection) || [];
        const existingById = new Map(existing
          .map(item => [String(item?.id || '').trim(), item])
          .filter(([id]) => id));
        try {
          list = list.map(item => {
            const previous = existingById.get(String(item?.id || '').trim());
            if (previous) {
              assertRecordMatchesActorScope(previous, trustedBulkScope);
              for (const field of ['companyId', 'tenantId']) {
                if (
                  Object.prototype.hasOwnProperty.call(item || {}, field)
                  && scopedValue(item?.[field]) !== scopedValue(previous?.[field])
                ) {
                  const error = new Error('Scope existing master-data нельзя менять через bulk replace.');
                  error.status = 409;
                  error.code = 'MASTER_DATA_SCOPE_IMMUTABLE';
                  throw error;
                }
              }
              return {
                ...item,
                companyId: previous.companyId,
                tenantId: previous.tenantId,
              };
            }
            for (const field of ['companyId', 'tenantId']) {
              if (
                Object.prototype.hasOwnProperty.call(item || {}, field)
                && scopedValue(item?.[field]) !== trustedBulkScope[field]
              ) {
                const error = new Error('New master-data scope не совпадает с trusted actor scope.');
                error.status = 409;
                error.code = 'MASTER_DATA_SCOPE_CLIENT_SUPPLIED';
                throw error;
              }
            }
            return assignTrustedScope(item, trustedBulkScope);
          });
        } catch (error) {
          return sendAccessError(res, error);
        }
      }

      if (collection === 'equipment') {
        const existingById = new Map((readData('equipment') || [])
          .map(item => [String(item?.id || '').trim(), item])
          .filter(([id]) => id));
        try {
          list = list.map((item) => {
            const previous = existingById.get(String(item?.id || '').trim()) || null;
            assertEquipmentGsmProjectionMutation(item, { current: previous });
            return preserveEquipmentGsmProjection(item, previous);
          });
        } catch (error) {
          return sendAccessError(res, error);
        }
      }

      if (collection === 'clients' || collection === 'client_objects') {
        const existing = readData(collection) || [];
        const incomingIds = new Set(list.map(item => String(item?.id || '').trim()).filter(Boolean));
        const omittedIds = existing
          .map(item => String(item?.id || '').trim())
          .filter(id => id && !incomingIds.has(id));
        if (omittedIds.length > 0) {
          return res.status(409).json({
            ok: false,
            code: 'DOMAIN_LIFECYCLE_BULK_DELETE_FORBIDDEN',
            error: `Bulk replace не может удалять ${collection}; используйте domain lifecycle endpoint.`,
            details: { omittedIds },
          });
        }
        const existingById = new Map(existing.map(item => [String(item?.id || '').trim(), item]));
        for (const item of existing) {
          try {
            assertEntityOwnerScope({
              actor: { ...req.user, ...trustedBulkScope },
              entityType: collection === 'clients' ? 'client' : 'client_object',
              entity: item,
              readData,
            });
          } catch (error) {
            return sendAccessError(res, error);
          }
        }
        if (collection === 'client_objects') {
          const lifecycleStatusMutation = list.find(item => {
            const previous = existingById.get(String(item?.id || '').trim());
            return previous && String(item?.status || 'active') !== String(previous?.status || 'active');
          });
          if (lifecycleStatusMutation) {
            return res.status(409).json({
              ok: false,
              code: 'CLIENT_OBJECT_LIFECYCLE_ENDPOINT_REQUIRED',
              error: 'Статус объекта изменяется только через domain lifecycle endpoint.',
            });
          }
        }
        list = list.map(item => {
          const previous = existingById.get(String(item?.id || '').trim());
          return {
            ...item,
            companyId: previous?.companyId || trustedBulkScope.companyId,
            tenantId: previous?.tenantId || trustedBulkScope.tenantId,
          };
        });
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
        const canonicalDowntimes = [];
        for (const item of list) {
          const validation = validateEquipmentDowntimeRecord(item, list, item.id);
          if (!validation.ok) {
            return res.status(validation.status).json({ ok: false, error: validation.error });
          }
          canonicalDowntimes.push(validation.downtime);
        }
        list = canonicalDowntimes;
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
        if (collection === 'client_objects' || collection === 'client_contracts' || collection === 'documents') {
          const existingById = new Map((readData(collection) || [])
            .map(item => [String(item?.id || ''), item]));
          if (collection === 'client_contracts') {
            const incomingIds = new Set(list.map(item => String(item?.id || '')).filter(Boolean));
            const removedContract = [...existingById.values()]
              .find(item => !incomingIds.has(String(item?.id || '')));
            if (removedContract) {
              const error = new Error('Массовая замена не может удалять договоры клиентов. Используйте защищённое удаление конкретного договора.');
              error.status = 409;
              error.code = 'CLIENT_CONTRACT_BULK_DELETE_FORBIDDEN';
              throw error;
            }
          }
          const stagedReadData = name => name === collection ? list : readData(name);
          list = list.map(item => normalizeClientDomainRecord(
            collection,
            item,
            existingById.get(String(item?.id || '')) || null,
            stagedReadData,
          ));
          if (collection === 'client_objects') {
            for (const item of list) {
              assertEntityOwnerScope({
                actor: { ...req.user, ...trustedBulkScope },
                entityType: 'client_object',
                entity: item,
                readData: stagedReadData,
              });
            }
          }
          if (collection === 'client_contracts') {
            for (const item of list) assertClientContractUpdateScope(req, item);
          }
        }
        if (collection === 'delivery_carriers') {
          const existing = readData('delivery_carriers') || [];
          const existingById = new Map(existing.map(item => [String(item?.id || ''), item]));
          const incomingIds = new Set(list.map(item => String(item?.id || '')).filter(Boolean));
          for (const carrier of existing) {
            if (incomingIds.has(String(carrier?.id || ''))) continue;
            const blockers = deliveryCarrierReferenceBlockers(carrier, { readData });
            if (blockers.length > 0) {
              const error = new Error('Массовая замена не может удалить перевозчика со связанной историей.');
              error.status = 409;
              error.code = 'DELIVERY_CARRIER_HAS_HISTORY';
              error.blockers = blockers;
              throw error;
            }
          }
          const stagedReadData = name => name === 'delivery_carriers' ? list : readData(name);
          list = list.map(item => canonicalizeDeliveryCarrierCounterpartyRelation(
            item,
            { readData: stagedReadData },
            {
              existing: existingById.get(String(item?.id || '')) || null,
              allowArchived: isHistoricalDeliveryCarrierRelation(item),
            },
          ));
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
        if (String(error?.code || '').startsWith('COUNTERPARTY_')) {
          return sendCounterpartyCompatibilityError(res, error);
        }
        if (collection === 'clients' && error?.code === 'CLIENT_INN_DUPLICATE') {
          return sendClientInnError(res, error);
        }
        return res.status(error?.status || 400).json({
          ok: false,
          ...(error?.code ? { code: error.code } : {}),
          error: error.message,
        });
      }

      if (isPlatformDefaultTenantOverlayCollection(collection)) {
        try {
          const normalizedList = collection === 'service_works'
            ? list.map(item => normalizeServiceWorkRecord(item))
            : collection === 'spare_parts'
              ? list.map(item => normalizeSparePartRecord(item))
              : list;
          writeData(collection, normalizedList);
          const effective = readData(collection) || [];
          auditLog?.(req, {
            action: `${collection}.bulk_replace`,
            entityType: collection,
            after: { count: effective.length },
          });
          return res.json({ ok: true, count: effective.length });
        } catch (error) {
          return sendCatalogLifecycleError(res, error);
        }
      }

      if (collection === 'users') {
        const existing = readData('users') || [];
        const existingById = new Map(existing.map(item => [item.id, item]));
        const merged = list.map(item => {
          const existingUser = existingById.get(item.id);
          let nextUser;
          if (!item.password) {
            const existingPwd = existingUser?.password;
            if (existingPwd) {
              nextUser = preserveExistingUserAuthState({ ...item, password: existingPwd }, existingUser);
            }
          }
          if (!nextUser) {
            nextUser = preserveExistingUserAuthState(
              normalizeUserPasswordForWrite(item, existingUser),
              existingUser,
            );
          }
          if (existingUser && hasUserAuthorityChange(existingUser, nextUser)) {
            const passwordChanged = nextUser.password !== existingUser.password;
            nextUser.tokenVersion = (Number(existingUser.tokenVersion) || 0) + 1;
            nextUser.passwordChangedAt = passwordChanged ? nowIso() : existingUser.passwordChangedAt;
          }
          return nextUser;
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
        try {
          persistUserMutation(req, {
            previousUsers: existing,
            nextUsers: merged,
            action: `${collection}.bulk_replace`,
            metadata: { count: merged.length },
          });
        } catch (error) {
          return res.status(error?.status || 500).json({
            ok: false,
            ...(error?.code ? { code: error.code } : {}),
            error: error?.message || 'Не удалось атомарно заменить пользователей.',
          });
        }
        return res.json({ ok: true, count: merged.length });
      }

      let repairBulkEvents = [];
      if (isRepairItemCollection(collection)) {
        const existing = readData(collection) || [];
        const incomingIds = new Set(list.map(item => String(item?.id || '')).filter(Boolean));
        const existingIds = new Set(existing.map(item => String(item?.id || '')).filter(Boolean));
        const existingById = new Map(existing.map(item => [String(item?.id || ''), item]));
        repairBulkEvents = [
          ...existing
            .filter(removed => !incomingIds.has(String(removed?.id || '')))
            .map(removed => repairItemAuditEvent(
              req,
              collection,
              collection === 'repair_work_items' ? 'work_deleted' : 'part_deleted',
              removed,
            )),
          ...list
            .filter(added => !existingIds.has(String(added?.id || '')))
            .map(added => repairItemAuditEvent(
              req,
              collection,
              collection === 'repair_work_items' ? 'work_added' : 'part_added',
              added,
            )),
          ...list
            .filter(updated => {
              const previous = existingById.get(String(updated?.id || ''));
              return previous && stableJson(previous) !== stableJson(updated);
            })
            .map(updated => repairItemAuditEvent(
              req,
              collection,
              collection === 'repair_work_items' ? 'work_updated' : 'part_updated',
              updated,
            )),
        ];
      }

      let normalizedList;
      let clientCompatibilityWrite = null;
      try {
        const existingById = new Map((readData(collection) || [])
          .map(item => [String(item?.id || ''), item]));
        normalizedList = list.map(item => {
          const linked = withClientLink(collection, item);
          const normalized = normalizeClientDomainRecord(
            collection,
            linked,
            collection === 'warranty_claims'
              ? (existingById.get(String(item?.id || '')) || null)
              : null,
          );
          return collection === 'equipment' ? normalizeEquipmentStorageRecord(normalized) : normalized;
        });
        if (AR_WORKFLOW_COLLECTIONS.has(collection)) {
          const stagedReadData = name => name === collection ? normalizedList : readData(name);
          normalizedList = normalizedList.map(item => assertCanonicalArWorkflowWrite(
            collection,
            item,
            { readData: stagedReadData },
            { recordId: item?.id },
          ));
        }
        if (collection === 'clients') {
          const prepared = prepareClientCompatibilityBulkReplace({
            previousClients: readData('clients') || [],
            nextClients: normalizedList,
            counterparties: readData('counterparties') || [],
            nowIso,
          });
          normalizedList = prepared.clients;
          clientCompatibilityWrite = synchronizeClientRoleBoundary({
            counterparties: prepared.counterparties,
            clients: normalizedList,
            roleAssignments: readData(ROLE_ASSIGNMENTS_COLLECTION) || [],
            supplierProfiles: readData(SUPPLIER_PROFILES_COLLECTION) || [],
            contractorProfiles: readData(CONTRACTOR_PROFILES_COLLECTION) || [],
            clientIds: normalizedList.map(client => client.id),
            actor: req.user,
            source: 'client_bulk_replace',
            nowIso,
          });
          normalizedList = clientCompatibilityWrite.state.clients;
        }
        if (collection === 'equipment') {
          assertProductionSmokeFixtureMutationAllowed({
            action: 'bulk_replace',
            existingList: readData('equipment') || [],
            nextList: normalizedList,
            buildPaginatedCollectionResponse,
          });
          const existingById = new Map((readData('equipment') || []).map(item => [String(item?.id || ''), item]));
          const lifecycleChangedIds = normalizedList
            .filter((item, itemIndex) => {
              const previous = existingById.get(String(item?.id || ''));
              const rawItem = list[itemIndex] || {};
              return !previous
                || ['status', 'currentClient', 'returnDate'].some(field => (
                  String(previous?.[field] || '') !== String(item?.[field] || '')
                ))
                || (
                  Object.prototype.hasOwnProperty.call(rawItem, 'activeInFleet')
                  && Boolean(previous?.activeInFleet) !== Boolean(item?.activeInFleet)
                );
            })
            .map(item => item.id);
          assertEquipmentLifecycleProjection(normalizedList, lifecycleChangedIds);
        }
        if (collection === 'payments') {
          assertPaymentAllocationPersistenceEntriesSafe([
            { name: 'payments', value: normalizedList },
          ], { readData });
        }
        if (collection === 'payment_allocations') {
          assertPaymentAllocationPersistenceEntriesSafe([
            { name: 'payment_allocations', value: normalizedList },
          ], { readData });
        }
      } catch (error) {
        if (String(error?.code || '').startsWith('COUNTERPARTY_')) {
          return sendCounterpartyCompatibilityError(res, error);
        }
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, error);
        }
        return res.status(error?.status || 400).json({
          ok: false,
          error: error.message,
          ...(error?.code ? { code: error.code } : {}),
          ...(error?.details ? { details: error.details } : {}),
        });
      }
      if (collection === 'service') {
        try {
          if (typeof persistServiceTicketBulkReplace !== 'function') {
            throw Object.assign(new Error('Atomic service bulk lifecycle is unavailable.'), {
              code: 'SERVICE_ATOMIC_AUDIT_REQUIRED',
              status: 503,
            });
          }
          persistServiceTicketBulkReplace(normalizedList, req.user.userName, {
            writeDataBatch: requireAtomicServiceWriter(),
            buildExtraEntries: (nextTickets, previousTickets) => {
              const previousById = new Map(previousTickets.map(item => [String(item?.id || ''), item]));
              const nextById = new Map(nextTickets.map(item => [String(item?.id || ''), item]));
              const serviceEvents = [
                ...nextTickets
                  .filter(item => !previousById.has(String(item?.id || '')))
                  .map(item => serviceTicketAuditEvent(req, 'ticket_created', item)),
                ...nextTickets
                  .filter(item => {
                    const previous = previousById.get(String(item?.id || ''));
                    return previous && stableJson(previous) !== stableJson(item);
                  })
                  .map(item => serviceTicketAuditEvent(req, 'ticket_updated', item)),
                ...previousTickets
                  .filter(item => !nextById.has(String(item?.id || '')))
                  .map(item => serviceTicketAuditEvent(req, 'ticket_deleted', item)),
              ];
              return serviceMutationAuditEntries(req, serviceEvents, [{
                action: 'service.bulk_replace',
                entityType: 'service',
                after: { count: nextTickets.length },
              }]);
            },
          });
        } catch (error) {
          return res.status(error?.status || 500).json({
            ok: false,
            code: error?.code || 'SERVICE_BULK_REPLACE_PERSISTENCE_FAILED',
            error: error?.message || 'Не удалось атомарно заменить сервисные заявки.',
            ...(error?.details ? { details: error.details } : {}),
          });
        }
      } else if (isRepairItemCollection(collection)) {
        try {
          persistAuditedServiceMutation(req, [{
            name: collection,
            value: normalizedList,
          }], repairBulkEvents, [{
            action: `${collection}.bulk_replace`,
            entityType: collection,
            after: { count: normalizedList.length },
          }]);
        } catch (error) {
          return res.status(error?.status || 500).json({
            ok: false,
            ...(error?.code ? { code: error.code } : {}),
            error: error?.message || 'Не удалось атомарно заменить сервисные факты.',
          });
        }
      } else if (collection === 'clients') {
        persistDataBatch(clientCompatibilityWrite.entries);
      } else if (isPaymentProjectionCollection(collection)) {
        persistPaymentProjection(collection, normalizedList);
      } else {
        writeData(collection, normalizedList);
      }
      if (collection !== 'service' && !isRepairItemCollection(collection)) {
        auditLog?.(req, {
          action: `${collection}.bulk_replace`,
          entityType: collection,
          after: { count: list.length },
        });
      }
      return res.json({ ok: true, count: list.length });
    });
  }

  function registerEquipmentPhotoRoutes() {
    const collection = 'equipment';

    function persistPhotoChange(req, res, action, mutate, successStatus = 200) {
      const equipment = readData(collection) || [];
      const index = equipment.findIndex(item => item?.id === req.params.id);
      if (index === -1) return res.status(404).json({ ok: false, error: 'Not found' });

      const previous = equipment[index];
      try {
        accessControl.assertCanUpdateEntity(collection, previous, req.user);
        assertNoRawProductionSmokeFixturePatch(previous, req.body);
        const next = normalizeEquipmentStorageRecord(mutate(previous));
        validateEquipmentRecord(next, equipment, previous);
        assertProductionSmokeFixtureMutationAllowed({
          action: 'update',
          previous,
          next,
        });

        // Build a new collection so a storage failure cannot mutate the in-memory
        // gallery returned by readData before persistence succeeds.
        const nextEquipment = equipment.map((item, itemIndex) => itemIndex === index ? next : item);
        writeData(collection, nextEquipment);
        auditLog?.(req, {
          action,
          entityType: collection,
          entityId: next.id,
          before: previous,
          after: next,
        });
        return res.status(successStatus).json(accessControl.sanitizeEntityForRead(collection, next, req.user));
      } catch (error) {
        if (error?.code === SYSTEM_FIXTURE_PROTECTED_CODE) {
          return sendSystemFixtureProtectedError(req, res, error);
        }
        if (error?.code?.startsWith('EQUIPMENT_') && !error.status) {
          return sendEquipmentValidationError(res, error);
        }
        return res.status(error?.status || 500).json({ ok: false, error: error?.message || 'Не удалось сохранить фотографию.' });
      }
    }

    router.post('/equipment/:id/photos', ...writeMiddlewares(collection), (req, res) => {
      let photo;
      try {
        photo = createUploadedPhoto(req.body, {
          id: generateId(idPrefixes.equipment_photos || 'EPH'),
          uploadedAt: nowIso(),
          uploadedBy: req.user?.userName,
        });
      } catch (error) {
        return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Некорректная фотография.' });
      }
      return persistPhotoChange(
        req,
        res,
        'equipment.photo.add',
        equipment => appendEquipmentPhoto(equipment, photo),
        201,
      );
    });

    router.patch('/equipment/:id/photos/main', ...writeMiddlewares(collection), (req, res) => (
      persistPhotoChange(
        req,
        res,
        'equipment.photo.make_main',
        equipment => makeEquipmentPhotoMain(equipment, req.body?.photoIndex),
      )
    ));

    router.delete('/equipment/:id/photos/:photoIndex', ...writeMiddlewares(collection), (req, res) => {
      if (req.body?.confirm !== true) {
        return res.status(400).json({ ok: false, error: 'Удаление фотографии требует подтверждения.' });
      }
      return persistPhotoChange(
        req,
        res,
        'equipment.photo.delete',
        equipment => deleteEquipmentPhoto(equipment, req.params.photoIndex),
      );
    });
  }

  registerEquipmentPhotoRoutes();
  for (const collection of collections) {
    registerCRUD(collection);
  }

  return router;
}

module.exports = {
  registerCrudRoutes,
};
