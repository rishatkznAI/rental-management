const {
  ROLE_ASSIGNMENTS_COLLECTION,
  SUPPLIER_PROFILES_COLLECTION,
  CONTRACTOR_PROFILES_COLLECTION,
  activeRolesForCounterparty,
  archiveCounterpartyRoleProfiles,
  boundaryEntries,
  boundaryState,
  deactivateCounterpartyRole,
} = require('./counterparty-role-profiles');
const {
  AUDIT_COLLECTION,
  LEGACY_AUDIT_COLLECTION,
  createAuditEntry: createSecurityAuditEntry,
} = require('./security-audit');
const { normalizeRole } = require('./role-groups');

const TERMINAL_STATUSES = new Set([
  'archived',
  'cancelled',
  'canceled',
  'closed',
  'completed',
  'done',
  'inactive',
  'paid',
  'ready',
  'returned',
  'resolved',
]);

const MASTER_DATA_ROLES = new Set(['Администратор', 'Офис-менеджер']);
const STABLE_REFERENCE_FIELDS = Object.freeze([
  'counterpartyId',
  'clientId',
  'objectId',
  'clientObjectId',
  'siteId',
  'objectIds',
]);

const customer = Object.freeze(['customer']);
const supplier = Object.freeze(['supplier']);
const contractor = Object.freeze(['contractor']);
const allRoles = Object.freeze(['customer', 'supplier', 'contractor']);

function spec(collection, {
  clientFields = ['clientId'],
  objectFields = ['objectId', 'clientObjectId', 'siteId', 'objectIds'],
  counterpartyFields = { counterpartyId: customer },
  blocking = true,
  alwaysHistorical = false,
} = {}) {
  return Object.freeze({
    collection,
    clientFields: Object.freeze([...clientFields]),
    objectFields: Object.freeze([...objectFields]),
    counterpartyFields: Object.freeze({ ...counterpartyFields }),
    blocking,
    alwaysHistorical,
  });
}

/**
 * The only stable-ID reference inventory used by Client/Counterparty/Client Object
 * lifecycle decisions. Display names, phone numbers, email addresses and other
 * editable labels deliberately do not appear here.
 */
const REFERENCE_REGISTRY = Object.freeze([
  spec('clients', { clientFields: [], objectFields: [], counterpartyFields: { counterpartyId: customer } }),
  spec('rentals'),
  spec('gantt_rentals'),
  spec('rental_change_requests'),
  spec('client_contracts'),
  spec('documents'),
  spec('payments', { counterpartyFields: { counterpartyId: allRoles } }),
  spec('payment_allocations', { counterpartyFields: {} }),
  spec('deliveries', {
    counterpartyFields: {
      counterpartyId: customer,
      contractorCounterpartyId: contractor,
      carrierCounterpartyId: contractor,
    },
  }),
  spec('service', {
    counterpartyFields: { counterpartyId: customer, contractorCounterpartyId: contractor },
  }),
  spec('service_field_trips', {
    counterpartyFields: { counterpartyId: customer, contractorCounterpartyId: contractor },
  }),
  spec('warranty_claims', {
    counterpartyFields: { counterpartyId: customer, factoryCounterpartyId: supplier },
  }),
  spec('crm_activities', { alwaysHistorical: true }),
  spec('crm_deals'),
  spec('debt_collection_plans'),
  spec('debt_collection_actions'),
  spec('receivable_payment_plans'),
  spec('client_objects'),
  spec('delivery_carriers', {
    clientFields: [],
    objectFields: [],
    counterpartyFields: { counterpartyId: contractor, contractorCounterpartyId: contractor },
  }),
  spec('company_expenses', {
    clientFields: [],
    objectFields: [],
    counterpartyFields: { supplierCounterpartyId: supplier, vendorCounterpartyId: supplier },
  }),
  spec('finance_operations', {
    clientFields: [],
    objectFields: [],
    counterpartyFields: { supplierCounterpartyId: supplier, vendorCounterpartyId: supplier },
  }),
  spec('spare_parts', {
    clientFields: [],
    objectFields: [],
    counterpartyFields: { supplierCounterpartyId: supplier, vendorCounterpartyId: supplier },
  }),
  spec('client_history', { alwaysHistorical: true }),
  spec('client_object_history', { alwaysHistorical: true }),
  spec('domain_history', { alwaysHistorical: true }),
  spec(AUDIT_COLLECTION, {
    clientFields: [],
    objectFields: [],
    counterpartyFields: {},
    blocking: false,
    alwaysHistorical: true,
  }),
  spec(LEGACY_AUDIT_COLLECTION, {
    clientFields: [],
    objectFields: [],
    counterpartyFields: {},
    blocking: false,
    alwaysHistorical: true,
  }),
]);

function lifecycleError(code, message, status = 409, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function relationId(value) {
  return String(value ?? '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readCollection(data, name) {
  if (typeof data === 'function') return asArray(data(name));
  if (data && typeof data.readData === 'function') return asArray(data.readData(name));
  return asArray(data?.[name]);
}

function valuesForField(record, field) {
  const value = record?.[field];
  return Array.isArray(value) ? value.map(relationId).filter(Boolean) : [relationId(value)].filter(Boolean);
}

function dynamicChangeRequestReferences(record) {
  const stableField = relationId(record?.field);
  if (!STABLE_REFERENCE_FIELDS.includes(stableField)) return [];
  const values = [record?.oldValue, record?.newValue];
  for (const container of [record?.oldValues, record?.newValues]) {
    if (container && typeof container === 'object') values.push(container[stableField]);
  }
  return values.flatMap(value => Array.isArray(value) ? value : [value]).map(relationId).filter(Boolean)
    .map(value => ({ field: stableField, value }));
}

function auditReference(record, entityType, entityId) {
  const type = relationId(record?.entityType).toLowerCase();
  const acceptedTypes = entityType === 'client'
    ? new Set(['client', 'clients'])
    : entityType === 'client_object'
      ? new Set(['client_object', 'client_objects'])
      : new Set(['counterparty', 'counterparties']);
  return acceptedTypes.has(type) && relationId(record?.entityId) === entityId;
}

function isHistoricalRecord(record, definition) {
  if (definition.alwaysHistorical) return true;
  if (record?.archivedAt || record?.actualReturnDate || record?.closedAt || record?.completedAt) return true;
  return TERMINAL_STATUSES.has(relationId(record?.status).toLowerCase());
}

function matchingReferenceFields({
  definition,
  record,
  entityType,
  entityId,
  clientIds,
  roleCode,
  activeWarrantyCustomerReferenceIds,
}) {
  if ([AUDIT_COLLECTION, LEGACY_AUDIT_COLLECTION].includes(definition.collection)) {
    return auditReference(record, entityType, entityId) ? ['entityId'] : [];
  }

  const fields = ['client_history', 'client_object_history', 'domain_history'].includes(definition.collection)
    && auditReference(record, entityType, entityId)
    ? ['entityId']
    : [];
  if (entityType === 'client') {
    for (const field of definition.clientFields) {
      if (valuesForField(record, field).includes(entityId)) fields.push(field);
    }
  } else if (entityType === 'client_object') {
    for (const field of definition.objectFields) {
      if (valuesForField(record, field).includes(entityId)) fields.push(field);
    }
  } else if (entityType === 'counterparty') {
    for (const [field, roles] of Object.entries(definition.counterpartyFields)) {
      if (roleCode && !roles.includes(roleCode)) continue;
      if (valuesForField(record, field).includes(entityId)) fields.push(field);
    }
    if (!roleCode || roleCode === 'customer') {
      for (const field of definition.clientFields) {
        if (valuesForField(record, field).some(value => clientIds.has(value))) fields.push(field);
      }
    }
  }

  if (
    definition.collection === 'warranty_claims'
    && entityType === 'counterparty'
    && (!roleCode || roleCode === 'customer')
    && activeWarrantyCustomerReferenceIds.has(relationId(record?.id))
  ) {
    for (const field of ['counterpartyId', 'clientId', 'rentalId', 'serviceTicketId']) {
      if (relationId(record?.[field])) fields.push(field);
    }
  }

  if (definition.collection === 'rental_change_requests') {
    const dynamic = dynamicChangeRequestReferences(record);
    for (const reference of dynamic) {
      const matches = entityType === 'client'
        ? reference.field === 'clientId' && reference.value === entityId
        : entityType === 'client_object'
          ? ['objectId', 'clientObjectId', 'siteId', 'objectIds'].includes(reference.field)
            && reference.value === entityId
          : reference.field === 'counterpartyId' && reference.value === entityId
            || (reference.field === 'clientId' && clientIds.has(reference.value));
      if (matches) fields.push(`change:${reference.field}`);
    }
  }
  return [...new Set(fields)];
}

function reasonForReference(classification, definition) {
  if (!definition.blocking) return 'retained audit evidence';
  return classification === 'active'
    ? 'active business reference'
    : 'durable historical reference';
}

function analyzeReferences({ entityType, entityId, data, roleCode = null }) {
  const id = relationId(entityId);
  const clients = entityType === 'counterparty'
    ? readCollection(data, 'clients').filter(client => relationId(client?.counterpartyId) === id)
    : [];
  const clientIds = new Set(clients.map(client => relationId(client?.id)).filter(Boolean));
  const activeWarrantyCustomerReferenceIds = new Set();
  if (entityType === 'counterparty' && (!roleCode || roleCode === 'customer')) {
    // The Warranty domain already owns the exact stable-ID resolution chain
    // Warranty -> Service/Rental -> Client/Counterparty. Load it lazily to avoid
    // the role-profile module cycle and fold the result into this registry.
    const { activeWarrantyCounterpartyReferences } = require('./warranty-claim-counterparty-relations');
    for (const claim of activeWarrantyCounterpartyReferences(id, data)) {
      const claimId = relationId(claim?.id);
      if (claimId) activeWarrantyCustomerReferenceIds.add(claimId);
    }
  }
  const activeReferences = [];
  const historicalReferences = [];

  for (const definition of REFERENCE_REGISTRY) {
    for (const record of readCollection(data, definition.collection)) {
      if (definition.collection === 'clients' && entityType === 'client' && relationId(record?.id) === id) continue;
      if (definition.collection === 'client_objects' && entityType === 'client_object' && relationId(record?.id) === id) continue;
      const referenceFields = matchingReferenceFields({
        definition,
        record,
        entityType,
        entityId: id,
        clientIds,
        roleCode,
        activeWarrantyCustomerReferenceIds,
      });
      if (referenceFields.length === 0) continue;
      const classification = isHistoricalRecord(record, definition) ? 'historical' : 'active';
      const item = {
        collection: definition.collection,
        recordId: relationId(record?.id) || null,
        reason: reasonForReference(classification, definition),
        referenceFields,
        classification,
        blocking: definition.blocking,
      };
      (classification === 'active' ? activeReferences : historicalReferences).push(item);
    }
  }

  if (entityType === 'client') {
    const client = readCollection(data, 'clients').find(item => relationId(item?.id) === id);
    for (const history of asArray(client?.history)) {
      const creationAuditOnly = relationId(history?.type || 'system') === 'system'
        && relationId(history?.text).startsWith('Клиент создан:');
      historicalReferences.push({
        collection: 'clients.history',
        recordId: relationId(history?.id || history?.timestamp || history?.date) || `${id}:history`,
        reason: creationAuditOnly ? 'retained creation audit evidence' : 'durable embedded client history',
        referenceFields: ['history'],
        classification: 'historical',
        blocking: !creationAuditOnly,
      });
    }
  }

  const blockers = [...activeReferences, ...historicalReferences].filter(item => item.blocking);
  return {
    entityType,
    entityId: id,
    activeReferences,
    historicalReferences,
    blockers,
    canArchive: true,
    canDelete: blockers.length === 0,
  };
}

function analyzeClientReferences(clientId, data) {
  return analyzeReferences({ entityType: 'client', entityId: clientId, data });
}

function analyzeClientObjectReferences(objectId, data) {
  return analyzeReferences({ entityType: 'client_object', entityId: objectId, data });
}

function analyzeCounterpartyReferences(counterpartyId, data, { roleCode = null } = {}) {
  const analysis = analyzeReferences({ entityType: 'counterparty', entityId: counterpartyId, data, roleCode });
  const archiveBlockers = analysis.blockers.filter(blocker => (
    blocker.collection === 'clients' || blocker.classification === 'active'
  ));
  return {
    ...analysis,
    canArchive: archiveBlockers.length === 0,
    // Counterparty is retained as a canonical historical identity in every policy.
    canDelete: false,
  };
}

function findCounterpartyRoleRemovalBlockers({ counterpartyId, roleCode, data }) {
  const analysis = analyzeCounterpartyReferences(counterpartyId, data, { roleCode });
  const grouped = new Map();
  const policyBlockers = analysis.blockers.filter(blocker => {
    if (roleCode === 'customer' && blocker.collection === 'clients') return false;
    if (roleCode === 'contractor') return true;
    return blocker.classification === 'active';
  });
  for (const blocker of policyBlockers) {
    if (!grouped.has(blocker.collection)) {
      grouped.set(blocker.collection, {
        collection: blocker.collection,
        recordIds: [],
        count: 0,
        relationFields: [],
      });
    }
    const item = grouped.get(blocker.collection);
    if (blocker.recordId) item.recordIds.push(blocker.recordId);
    item.relationFields.push(...blocker.referenceFields);
    item.count += 1;
  }
  return [...grouped.values()].map(item => ({
    ...item,
    recordIds: [...new Set(item.recordIds)],
    relationFields: [...new Set(item.relationFields)],
    ...(roleCode !== 'customer' && item.collection === 'payments'
      ? { ambiguity: 'Payment has no role-specific direction; removal fails closed.' }
      : {}),
  }));
}

function actorRole(actor) {
  return normalizeRole(relationId(actor?.userRole || actor?.normalizedRole || actor?.role));
}

function assertAuthorizedActor(actor) {
  if (!actor || !relationId(actor?.userId || actor?.id)) {
    throw lifecycleError('MASTER_DATA_AUTH_REQUIRED', 'Требуется аутентифицированный пользователь.', 401);
  }
  if (!MASTER_DATA_ROLES.has(actorRole(actor))) {
    throw lifecycleError('MASTER_DATA_FORBIDDEN', 'Недостаточно прав для изменения master data.', 403);
  }
}

function uniqueScopeValues(records, field) {
  return [...new Set(records.map(record => relationId(record?.[field])).filter(Boolean))];
}

function assertLifecycleScope({ actor, entityType, entity, ownerClient = null, ownerCounterparty = null }) {
  const prefix = entityType === 'client'
    ? 'CLIENT'
    : entityType === 'client_object' ? 'CLIENT_OBJECT' : 'COUNTERPARTY';
  const records = [entity, ownerClient, ownerCounterparty].filter(Boolean);
  const resolved = {};
  for (const field of ['companyId', 'tenantId']) {
    const values = uniqueScopeValues(records, field);
    if (values.length > 1) {
      throw lifecycleError(
        `${prefix}_SCOPE_CONFLICT`,
        'Scope сущности конфликтует с scope канонического владельца.',
        409,
        { field, values },
      );
    }
    if (values.length === 0) {
      throw lifecycleError(
        `${prefix}_SCOPE_UNKNOWN`,
        `Legacy scope сущности нельзя определить по ${field}.`,
        409,
        { field },
      );
    }
    resolved[field] = values[0];
    if (relationId(actor?.[field]) !== values[0]) {
      throw lifecycleError(
        `${prefix}_SCOPE_FORBIDDEN`,
        'Сущность не принадлежит company/tenant текущего пользователя.',
        403,
        { field },
      );
    }
  }
  if (resolved.companyId !== resolved.tenantId) {
    throw lifecycleError(
      `${prefix}_SCOPE_CONFLICT`,
      'Company и tenant сущности должны иметь один canonical ID.',
      409,
    );
  }
  return resolved;
}

function resolveOwners({ entityType, entity, readData }) {
  const clients = readCollection(readData, 'clients');
  const counterparties = readCollection(readData, 'counterparties');
  const clientId = entityType === 'client' ? relationId(entity?.id) : relationId(entity?.clientId);
  const ownerClient = entityType === 'client'
    ? entity
    : clientId ? clients.find(item => relationId(item?.id) === clientId) || null : null;
  if (clientId && !ownerClient) {
    throw lifecycleError(
      `${entityType === 'client_object' ? 'CLIENT_OBJECT' : 'CLIENT'}_SCOPE_UNKNOWN`,
      'Канонический Client owner отсутствует.',
      409,
      { clientId },
    );
  }
  const clientCounterpartyId = relationId(ownerClient?.counterpartyId);
  const directCounterpartyId = entityType === 'counterparty'
    ? relationId(entity?.id)
    : relationId(entity?.counterpartyId);
  if (clientCounterpartyId && directCounterpartyId && clientCounterpartyId !== directCounterpartyId) {
    throw lifecycleError(
      `${entityType === 'client_object' ? 'CLIENT_OBJECT' : 'CLIENT'}_SCOPE_CONFLICT`,
      'Stable-ID owner links конфликтуют.',
      409,
      { clientCounterpartyId, directCounterpartyId },
    );
  }
  const counterpartyId = clientCounterpartyId || directCounterpartyId;
  const ownerCounterparty = counterpartyId
    ? counterparties.find(item => relationId(item?.id) === counterpartyId) || null
    : null;
  if (counterpartyId && !ownerCounterparty) {
    throw lifecycleError(
      `${entityType === 'counterparty' ? 'COUNTERPARTY' : entityType === 'client_object' ? 'CLIENT_OBJECT' : 'CLIENT'}_SCOPE_UNKNOWN`,
      'Канонический Counterparty owner отсутствует.',
      409,
      { counterpartyId },
    );
  }
  return { ownerClient, ownerCounterparty };
}

function assertEntityOwnerScope({ actor, entityType, entity, readData }) {
  if (!actor || !relationId(actor?.userId || actor?.id)) {
    throw lifecycleError('MASTER_DATA_AUTH_REQUIRED', 'Требуется аутентифицированный пользователь.', 401);
  }
  const owners = resolveOwners({ entityType, entity, readData });
  return assertLifecycleScope({ actor, entityType, entity, ...owners });
}

function createAuditEntry({ generateId, nowIso, actor, action, entityType, entityId, before, after, metadata = null }) {
  const companyId = relationId(actor?.companyId);
  const tenantId = relationId(actor?.tenantId);
  if (!companyId || tenantId !== companyId) {
    throw lifecycleError(
      'MASTER_DATA_SCOPE_UNKNOWN',
      'Semantic audit requires exact trusted company/tenant scope.',
      403,
    );
  }
  return createSecurityAuditEntry({
    ...actor,
    actorScope: { companyId, tenantId },
  }, {
    action,
    entityType,
    entityId,
    before,
    after,
    metadata,
  }, { generateId, nowIso });
}

function createClientMasterDataLifecycleService({
  readData,
  writeDataBatch,
  generateId = prefix => `${prefix}-${Date.now()}`,
  nowIso = () => new Date().toISOString(),
}) {
  if (typeof readData !== 'function' || typeof writeDataBatch !== 'function') {
    throw new Error('Client master-data lifecycle requires readData and atomic writeDataBatch.');
  }

  function appendAudit(entries, input) {
    const logs = [...readCollection(readData, AUDIT_COLLECTION)];
    logs.push(createAuditEntry({ generateId, nowIso, ...input }));
    return [...entries, { name: AUDIT_COLLECTION, value: logs }];
  }

  function findEntity(collection, id, notFoundCode, message) {
    const entity = readCollection(readData, collection).find(item => relationId(item?.id) === relationId(id));
    if (!entity) throw lifecycleError(notFoundCode, message, 404, { id: relationId(id) });
    return entity;
  }

  function assertMutationContext(actor, entityType, entity) {
    assertAuthorizedActor(actor);
    const owners = resolveOwners({ entityType, entity, readData });
    assertLifecycleScope({ actor, entityType, entity, ...owners });
    return owners;
  }

  function getClientObjectLifecycle({ id, actor }) {
    const object = findEntity('client_objects', id, 'CLIENT_OBJECT_NOT_FOUND', 'Объект клиента не найден.');
    assertMutationContext(actor, 'client_object', object);
    const analysis = analyzeClientObjectReferences(object.id, { readData });
    const active = relationId(object.status || 'active').toLowerCase() !== 'archived';
    return {
      ...analysis,
      status: active ? 'active' : 'archived',
      canArchive: active,
      canDelete: !active && analysis.blockers.length === 0,
    };
  }

  function deleteClient({ id, actor }) {
    const client = findEntity('clients', id, 'CLIENT_NOT_FOUND', 'Client не найден.');
    assertMutationContext(actor, 'client', client);
    const analysis = analyzeClientReferences(client.id, { readData });
    if (!analysis.canDelete) {
      throw lifecycleError(
        'CLIENT_HAS_HISTORY',
        'Client нельзя удалить: существуют durable stable-ID references.',
        409,
        { blockers: analysis.blockers },
      );
    }
    const clients = readCollection(readData, 'clients').filter(item => relationId(item?.id) !== relationId(client.id));
    const entries = appendAudit([{ name: 'clients', value: clients }], {
      actor,
      action: 'clients.projection_delete',
      entityType: 'clients',
      entityId: client.id,
      before: client,
      after: null,
      metadata: { cascade: false },
    });
    writeDataBatch(entries);
    return { ok: true, changed: true, deletedId: client.id, analysis };
  }

  function archiveClientObject({ id, actor }) {
    const object = findEntity('client_objects', id, 'CLIENT_OBJECT_NOT_FOUND', 'Объект клиента не найден.');
    assertMutationContext(actor, 'client_object', object);
    if (relationId(object.status).toLowerCase() === 'archived') {
      return { ok: true, changed: false, clientObject: object };
    }
    const timestamp = nowIso();
    const archived = { ...object, status: 'archived', archivedAt: object.archivedAt || timestamp, updatedAt: timestamp };
    const objects = readCollection(readData, 'client_objects')
      .map(item => relationId(item?.id) === relationId(id) ? archived : item);
    const entries = appendAudit([{ name: 'client_objects', value: objects }], {
      actor,
      action: 'client_objects.archive',
      entityType: 'client_objects',
      entityId: object.id,
      before: object,
      after: archived,
    });
    writeDataBatch(entries);
    return { ok: true, changed: true, clientObject: archived };
  }

  function deleteClientObject({ id, actor }) {
    const object = findEntity('client_objects', id, 'CLIENT_OBJECT_NOT_FOUND', 'Объект клиента не найден.');
    assertMutationContext(actor, 'client_object', object);
    if (relationId(object.status || 'active').toLowerCase() !== 'archived') {
      throw lifecycleError('CLIENT_OBJECT_ACTIVE', 'Активный объект нельзя удалить. Сначала архивируйте его.', 409);
    }
    const analysis = analyzeClientObjectReferences(object.id, { readData });
    if (!analysis.canDelete) {
      throw lifecycleError(
        'CLIENT_OBJECT_HAS_HISTORY',
        'Объект нельзя удалить: он используется в истории клиента.',
        409,
        { blockers: analysis.blockers },
      );
    }
    const objects = readCollection(readData, 'client_objects')
      .filter(item => relationId(item?.id) !== relationId(object.id));
    const entries = appendAudit([{ name: 'client_objects', value: objects }], {
      actor,
      action: 'client_objects.delete',
      entityType: 'client_objects',
      entityId: object.id,
      before: object,
      after: null,
    });
    writeDataBatch(entries);
    return { ok: true, changed: true, deletedId: object.id, analysis };
  }

  function roleState() {
    return boundaryState({
      counterparties: readCollection(readData, 'counterparties').map(item => ({ ...item })),
      clients: readCollection(readData, 'clients').map(item => ({ ...item })),
      [ROLE_ASSIGNMENTS_COLLECTION]: readCollection(readData, ROLE_ASSIGNMENTS_COLLECTION).map(item => ({ ...item })),
      [SUPPLIER_PROFILES_COLLECTION]: readCollection(readData, SUPPLIER_PROFILES_COLLECTION).map(item => ({ ...item })),
      [CONTRACTOR_PROFILES_COLLECTION]: readCollection(readData, CONTRACTOR_PROFILES_COLLECTION).map(item => ({ ...item })),
    });
  }

  function archiveCounterpartyState({ state, counterparty, actor, source, timestamp }) {
    const index = state.counterparties.findIndex(item => relationId(item?.id) === relationId(counterparty.id));
    const archived = {
      ...state.counterparties[index],
      roles: [],
      status: 'archived',
      archivedAt: state.counterparties[index].archivedAt || timestamp,
      updatedAt: timestamp,
    };
    state.counterparties[index] = archived;
    archiveCounterpartyRoleProfiles({
      state,
      counterpartyId: counterparty.id,
      actor,
      source,
      nowIso: () => timestamp,
    });
    return archived;
  }

  function deactivateCustomerRole({ id, actor, reason = null, source = 'customer_role_lifecycle' }) {
    const counterparty = findEntity('counterparties', id, 'COUNTERPARTY_NOT_FOUND', 'Контрагент не найден.');
    assertMutationContext(actor, 'counterparty', counterparty);
    if (counterparty.archivedAt || relationId(counterparty.status).toLowerCase() === 'archived') {
      return { ok: true, changed: false, counterparty };
    }
    const analysis = analyzeCounterpartyReferences(counterparty.id, { readData }, { roleCode: 'customer' });
    const blockers = analysis.blockers.filter(blocker => (
      blocker.collection !== 'clients' && blocker.classification === 'active'
    ));
    if (blockers.length > 0) {
      throw lifecycleError(
        'COUNTERPARTY_IN_USE',
        'Customer role используется durable business references.',
        409,
        { roleCode: 'customer', blockers },
      );
    }
    const state = roleState();
    const assignments = state[ROLE_ASSIGNMENTS_COLLECTION]
      .filter(item => relationId(item?.counterpartyId) === relationId(counterparty.id));
    const projectedRoles = activeRolesForCounterparty(state[ROLE_ASSIGNMENTS_COLLECTION], counterparty.id);
    const activeRoles = assignments.length > 0 ? projectedRoles : asArray(counterparty.roles);
    if (!activeRoles.includes('customer')) {
      return { ok: true, changed: false, counterparty };
    }
    const timestamp = nowIso();
    let updated;
    if (activeRoles.filter(role => role !== 'customer').length === 0) {
      updated = archiveCounterpartyState({ state, counterparty, actor, source, timestamp });
    } else {
      const result = deactivateCounterpartyRole({
        state,
        data: { readData },
        counterpartyId: counterparty.id,
        roleCode: 'customer',
        actor,
        reason,
        source,
        nowIso: () => timestamp,
      });
      updated = result.counterparty;
    }
    const entries = appendAudit(boundaryEntries(state), {
      actor,
      action: 'counterparties.customer_role.deactivate',
      entityType: 'counterparties',
      entityId: counterparty.id,
      before: counterparty,
      after: updated,
      metadata: { reason, source },
    });
    writeDataBatch(entries);
    return { ok: true, changed: true, counterparty: updated };
  }

  function archiveCounterparty({ id, actor }) {
    const counterparty = findEntity('counterparties', id, 'COUNTERPARTY_NOT_FOUND', 'Контрагент не найден.');
    assertMutationContext(actor, 'counterparty', counterparty);
    if (counterparty.archivedAt || relationId(counterparty.status).toLowerCase() === 'archived') {
      return { ok: true, changed: false, counterparty };
    }
    const analysis = analyzeCounterpartyReferences(counterparty.id, { readData });
    const blockers = analysis.blockers.filter(blocker => (
      blocker.collection === 'clients' || blocker.classification === 'active'
    ));
    if (blockers.length > 0) {
      throw lifecycleError(
        'COUNTERPARTY_IN_USE',
        'Контрагент используется durable business references.',
        409,
        { blockers },
      );
    }
    const state = roleState();
    const timestamp = nowIso();
    const archived = archiveCounterpartyState({
      state,
      counterparty,
      actor,
      source: 'counterparty_archive',
      timestamp,
    });
    const entries = appendAudit(boundaryEntries(state), {
      actor,
      action: 'counterparties.archive',
      entityType: 'counterparties',
      entityId: counterparty.id,
      before: counterparty,
      after: archived,
    });
    writeDataBatch(entries);
    return { ok: true, changed: true, counterparty: archived };
  }

  return {
    analyzeClientReferences: id => analyzeClientReferences(id, { readData }),
    analyzeClientObjectReferences: id => analyzeClientObjectReferences(id, { readData }),
    analyzeCounterpartyReferences: (id, options) => analyzeCounterpartyReferences(id, { readData }, options),
    archiveClientObject,
    archiveCounterparty,
    deactivateCustomerRole,
    deleteClient,
    deleteClientObject,
    getClientObjectLifecycle,
  };
}

module.exports = {
  REFERENCE_REGISTRY,
  STABLE_REFERENCE_FIELDS,
  analyzeClientObjectReferences,
  analyzeClientReferences,
  analyzeCounterpartyReferences,
  assertEntityOwnerScope,
  assertLifecycleScope,
  createClientMasterDataLifecycleService,
  findCounterpartyRoleRemovalBlockers,
  lifecycleError,
};
