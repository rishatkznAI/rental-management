const { assertCompleteActorScope } = require('./trusted-actor-scope');
const {
  TenantDataBoundaryError,
  isGlobalReferenceCollection,
} = require('./tenant-data-boundary');
const {
  isPlatformDefaultTenantOverlayCollection,
  readEffectiveCatalog,
} = require('./platform-default-tenant-overlay');
const { assertGsmDataIntegrity } = require('./gsm/device-integrity');

const RELATION_FIELDS = Object.freeze({
  counterpartyId: ['counterparties'],
  actualCounterpartyId: ['counterparties'],
  carrierCounterpartyId: ['counterparties'],
  clientCounterpartyId: ['counterparties'],
  contractCounterpartyId: ['counterparties'],
  contractorCounterpartyId: ['counterparties'],
  debtorCounterpartyId: ['counterparties'],
  factoryCounterpartyId: ['counterparties'],
  paymentCounterpartyId: ['counterparties'],
  rentalCounterpartyId: ['counterparties'],
  supplierCounterpartyId: ['counterparties'],
  vendorCounterpartyId: ['counterparties'],
  clientId: ['clients'],
  customerId: ['clients'],
  client_id: ['clients'],
  contractClientId: ['clients'],
  documentClientId: ['clients'],
  ganttClientId: ['clients'],
  paymentClientId: ['clients'],
  relatedClientId: ['clients'],
  rentalClientId: ['clients'],
  objectId: ['client_objects'],
  clientObjectId: ['client_objects'],
  linkedObjectId: ['client_objects'],
  siteId: ['client_objects'],
  contractId: ['client_contracts'],
  clientContractId: ['client_contracts'],
  rentalId: ['rentals', 'gantt_rentals'],
  classicRentalId: ['rentals', 'gantt_rentals'],
  ganttRentalId: ['rentals', 'gantt_rentals'],
  linkedGanttRentalId: ['rentals', 'gantt_rentals'],
  linkedRentalId: ['rentals', 'gantt_rentals'],
  sourceRentalId: ['rentals', 'gantt_rentals'],
  originalRentalId: ['rentals', 'gantt_rentals'],
  documentRentalId: ['rentals', 'gantt_rentals'],
  paymentRentalId: ['rentals', 'gantt_rentals'],
  relatedRentalId: ['rentals', 'gantt_rentals'],
  equipmentId: ['equipment'],
  equipment_id: ['equipment'],
  linkedEquipmentId: ['equipment'],
  relatedEquipmentId: ['equipment'],
  serviceTicketId: ['service'],
  serviceId: ['service'],
  repairId: ['service'],
  warrantyClaimId: ['warranty_claims'],
  deliveryId: ['deliveries'],
  paymentId: ['payments'],
  refundPaymentId: ['payments'],
  reversalOfPaymentId: ['payments'],
  documentId: ['documents'],
  actDocumentId: ['documents'],
  invoiceDocumentId: ['documents'],
  parentDocumentId: ['documents'],
  sourceDocumentId: ['documents'],
  specificationId: ['documents'],
  debtCollectionPlanId: ['debt_collection_plans'],
  collectionPlanId: ['debt_collection_plans'],
  receivableActionId: ['debt_collection_actions'],
  leasingContractId: ['leasing_contracts'],
  carrierId: ['delivery_carriers'],
  assignedCarrierId: ['delivery_carriers'],
  vehicleId: ['service_vehicles'],
  serviceCarId: ['service_vehicles'],
  workId: ['service_works', 'service_work_catalog'],
  workCatalogId: ['service_works', 'service_work_catalog'],
  partId: ['spare_parts', 'spare_parts_catalog'],
  sparePartId: ['spare_parts', 'spare_parts_catalog'],
  moduleId: ['knowledge_base_modules'],
  userId: ['users'],
  managerId: ['users'],
  manager_id: ['users'],
  managerUserId: ['users'],
  responsibleManagerId: ['users'],
  responsibleUserId: ['users'],
  assignedUserId: ['users'],
  assignedToUserId: ['users'],
  assignedBy: ['users'],
  acceptedByUserId: ['users'],
  actorUserId: ['users'],
  approvedByUserId: ['users'],
  createdById: ['users'],
  createdByUserId: ['users'],
  selectedByUserId: ['users'],
  systemUserId: ['users'],
  updatedByUserId: ['users'],
  approvedById: ['users'],
  mechanicId: ['mechanics', 'users'],
  assignedMechanicId: ['mechanics', 'users'],
  assignedToId: ['mechanics', 'users'],
  ownerId: ['owners'],
  owner_id: ['owners'],
});

// Field names alone are not a sufficient identity namespace. These relations
// have authoritative semantics only in the named source collection, while
// similarly named fields elsewhere may be transport IDs or display snapshots.
const COLLECTION_RELATION_FIELDS = Object.freeze({
  users: Object.freeze({
    ownerId: Object.freeze(['owners']),
    carrierId: Object.freeze(['delivery_carriers']),
    assignedCarrierId: Object.freeze(['delivery_carriers']),
    carrierKey: Object.freeze(['delivery_carriers']),
  }),
  bot_users: Object.freeze({
    userId: Object.freeze(['users']),
    carrierId: Object.freeze(['delivery_carriers']),
    assignedCarrierId: Object.freeze(['delivery_carriers']),
    carrierKey: Object.freeze(['delivery_carriers']),
    systemUserId: Object.freeze(['users']),
  }),
  delivery_carriers: Object.freeze({
    systemUserId: Object.freeze(['users']),
    system_user_id: Object.freeze(['users']),
  }),
  bot_notifications: Object.freeze({
    userId: Object.freeze(['users']),
    recipientId: Object.freeze(['users']),
  }),
  shipping_photos: Object.freeze({
    operationSessionId: Object.freeze(['equipment_operation_sessions']),
  }),
  rental_change_requests: Object.freeze({
    requestedBy: Object.freeze(['users']),
    requestedById: Object.freeze(['users']),
    initiatorId: Object.freeze(['users']),
    decidedById: Object.freeze(['users']),
    createdBy: Object.freeze(['users']),
  }),
  rentals: Object.freeze({
    creditRiskAcknowledgedByUserId: Object.freeze(['users']),
    creditRiskApprovedByUserId: Object.freeze(['users']),
    createdById: Object.freeze(['users']),
    updatedById: Object.freeze(['users']),
    equipmentItemId: Object.freeze(['equipment']),
  }),
  gantt_rentals: Object.freeze({
    creditRiskAcknowledgedByUserId: Object.freeze(['users']),
    creditRiskApprovedByUserId: Object.freeze(['users']),
    createdById: Object.freeze(['users']),
    updatedById: Object.freeze(['users']),
    equipmentItemId: Object.freeze(['equipment']),
    entityId: Object.freeze(['rentals', 'gantt_rentals']),
    approvalEntityId: Object.freeze(['rentals', 'gantt_rentals']),
  }),
  clients: Object.freeze({
    openingReceivableCreatedByUserId: Object.freeze(['users']),
    openingReceivableUpdatedByUserId: Object.freeze(['users']),
  }),
  service: Object.freeze({
    serviceVehicleId: Object.freeze(['service_vehicles']),
    revisionReturnedBy: Object.freeze(['users']),
    revisionResolvedBy: Object.freeze(['users']),
    assignedToId: Object.freeze(['mechanics', 'users']),
    machineId: Object.freeze(['equipment']),
    counterparty_id: Object.freeze(['counterparties']),
    rental_id: Object.freeze(['rentals', 'gantt_rentals']),
  }),
  service_field_trips: Object.freeze({
    serviceVehicleId: Object.freeze(['service_vehicles']),
    routeNormId: Object.freeze(['service_route_norms']),
  }),
  documents: Object.freeze({
    responsibleId: Object.freeze(['users']),
    vehicleTripId: Object.freeze(['vehicle_trips']),
    parentId: Object.freeze(['documents']),
    specId: Object.freeze(['documents']),
    rental: Object.freeze(['rentals', 'gantt_rentals']),
    serviceTicket: Object.freeze(['service']),
  }),
  payments: Object.freeze({
    rental: Object.freeze(['rentals', 'gantt_rentals']),
    document: Object.freeze(['documents']),
  }),
  repair_work_items: Object.freeze({
    ticketId: Object.freeze(['service']),
    catalogId: Object.freeze(['service_works', 'service_work_catalog']),
  }),
  repair_part_items: Object.freeze({
    ticketId: Object.freeze(['service']),
    catalogId: Object.freeze(['spare_parts', 'spare_parts_catalog']),
  }),
  vehicle_trips: Object.freeze({
    serviceRequestId: Object.freeze(['service']),
  }),
  crm_activities: Object.freeze({
    dealId: Object.freeze(['crm_deals']),
    contactId: Object.freeze(['client_contacts']),
    createdBy: Object.freeze(['users']),
    updatedBy: Object.freeze(['users']),
    deletedBy: Object.freeze(['users']),
  }),
  counterparty_role_assignments: Object.freeze({
    createdBy: Object.freeze(['users']),
    deactivatedBy: Object.freeze(['users']),
  }),
  manager_activity: Object.freeze({
    createdBy: Object.freeze(['users']),
  }),
  deliveries: Object.freeze({
    carrierKey: Object.freeze(['delivery_carriers']),
    machineId: Object.freeze(['equipment']),
  }),
  gsm_packets: Object.freeze({
    gsmDeviceRecordId: Object.freeze(['gsm_devices']),
  }),
  gsm_commands: Object.freeze({
    gsmDeviceRecordId: Object.freeze(['gsm_devices']),
  }),
});

// These are deliberately not app-user foreign keys. Keeping the exclusions
// explicit prevents a future generic field rule from reclassifying MAX IDs.
const COLLECTION_EXTERNAL_ID_FIELDS = Object.freeze({
  deliveries: Object.freeze(['carrierUserId']),
  delivery_carriers: Object.freeze(['userId']),
});

// These fields are stable internal references, but their target namespace is
// encoded by the record value and cannot be represented by RELATION_FIELDS.
// They are removed from the generic scalar pass and resolved explicitly below.
const COLLECTION_DYNAMIC_RELATION_FIELDS = Object.freeze({
  planner_items: Object.freeze(['rentalId']),
});

const COLLECTION_RELATION_SENTINELS = Object.freeze({
  bot_notifications: Object.freeze({
    userId: Object.freeze([Object.freeze({
      value: 'manager',
      status: 'skipped_no_manager',
      reason: 'no_responsible_manager',
    })]),
  }),
  counterparty_role_assignments: Object.freeze({
    createdBy: Object.freeze([
      Object.freeze({ value: 'system:migration', source: 'stage_j_b_migration' }),
      Object.freeze({ value: 'system:import', source: 'system_data_import' }),
    ]),
    deactivatedBy: Object.freeze([
      Object.freeze({
        value: 'system',
        source: 'counterparty_archive',
        status: 'inactive',
        reason: 'counterparty_archived',
      }),
    ]),
  }),
});

const EXACT_COLLECTION_RELATION_SOURCES = Object.freeze([
  'users',
  'bot_users',
  'delivery_carriers',
  'bot_notifications',
]);

const ARRAY_RELATION_FIELDS = Object.freeze({
  counterpartyIds: ['counterparties'],
  clientIds: ['clients'],
  equipmentIds: ['equipment'],
  objectIds: ['client_objects'],
  contractObjectIds: ['client_objects'],
  contractIds: ['client_contracts'],
  clientContractIds: ['client_contracts'],
  rentalIds: ['rentals', 'gantt_rentals'],
  classicRentalIds: ['rentals', 'gantt_rentals'],
  ganttRentalIds: ['rentals', 'gantt_rentals'],
  serviceIds: ['service'],
  warrantyClaimIds: ['warranty_claims'],
  deliveryIds: ['deliveries'],
  paymentIds: ['payments'],
  documentIds: ['documents'],
  carrierIds: ['delivery_carriers'],
  userIds: ['users'],
  mechanicIds: ['mechanics', 'users'],
  ownerIds: ['owners'],
});

function text(value) {
  return String(value ?? '').trim();
}

function recordMatchesScope(record, scope) {
  return text(record?.companyId) === scope.companyId
    && text(record?.tenantId) === scope.tenantId;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function sourceRecords(value) {
  if (Array.isArray(value)) {
    return value.map(record => ({ record, sourceKey: null }));
  }
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).map(([sourceKey, record]) => ({ record, sourceKey }));
}

function scalarRelationFieldsForCollection(collection) {
  const exact = COLLECTION_RELATION_FIELDS[collection] || {};
  const external = new Set(COLLECTION_EXTERNAL_ID_FIELDS[collection] || []);
  const dynamic = new Set(COLLECTION_DYNAMIC_RELATION_FIELDS[collection] || []);
  const fields = new Set(EXACT_COLLECTION_RELATION_SOURCES.includes(collection)
    ? Object.keys(exact)
    : [...Object.keys(RELATION_FIELDS), ...Object.keys(exact)]);
  return [...fields]
    .filter(field => !external.has(field) && !dynamic.has(field))
    .map(field => [field, Object.prototype.hasOwnProperty.call(exact, field)
      ? exact[field]
      : RELATION_FIELDS[field]]);
}

function isScalarRelationSentinel(collection, record, field, id) {
  const sentinels = COLLECTION_RELATION_SENTINELS[collection]?.[field] || [];
  return sentinels.some(sentinel => Object.entries(sentinel).every(([key, expected]) => (
    key === 'value'
      ? id === text(expected)
      : text(record?.[key]) === text(expected)
  )));
}

function relationIds(record, field) {
  const value = record?.[field];
  if (ARRAY_RELATION_FIELDS[field]) {
    return asArray(value).map(item => text(typeof item === 'object' ? item?.id : item)).filter(Boolean);
  }
  const id = text(typeof value === 'object' ? value?.id : value);
  return id ? [id] : [];
}

function nestedEquipmentIds(record) {
  return asArray(record?.equipment)
    // Rental/Gantt legacy arrays also contain inventory-number display
    // strings. Only explicit object identity fields are authoritative links.
    .map(item => text(item && typeof item === 'object'
      ? (item.id || item.equipmentId)
      : ''))
    .filter(Boolean);
}

function uniqueNestedSlot(item, index, identityFields, identityCounts) {
  for (const identityField of identityFields) {
    const value = text(item?.[identityField]);
    if (value && identityCounts.get(identityField)?.get(value) === 1) {
      return `${identityField}:${value}`;
    }
  }
  return `index:${index}`;
}

function nestedIdentityCounts(items, identityFields) {
  return new Map(identityFields.map(identityField => {
    const counts = new Map();
    for (const item of items) {
      const value = text(item?.[identityField]);
      if (value) counts.set(value, (counts.get(value) || 0) + 1);
    }
    return [identityField, counts];
  }));
}

function nestedAuthoritativeReferences(collection, record) {
  const references = [];
  const addArrayRelations = ({ items, path, identityFields, fields }) => {
    const identityCounts = nestedIdentityCounts(items, identityFields);
    items.forEach((item, index) => {
      const slot = uniqueNestedSlot(item, index, identityFields, identityCounts);
      for (const [field, targets] of Object.entries(fields)) {
        const id = text(item?.[field]);
        if (id) references.push({ id, targets, field: `${path}[].${field}`, slot });
      }
    });
  };

  if (collection === 'documents') {
    addArrayRelations({
      items: asArray(record?.history),
      path: 'history',
      identityFields: ['id'],
      fields: { createdByUserId: ['users'] },
    });
  }
  if (collection === 'equipment') {
    addArrayRelations({
      items: asArray(record?.receiptHistory),
      path: 'receiptHistory',
      identityFields: ['id', 'date'],
      fields: { userId: ['users'] },
    });
  }
  if (collection === 'service') {
    addArrayRelations({
      items: asArray(record?.revisionHistory),
      path: 'revisionHistory',
      identityFields: ['id'],
      fields: {
        createdBy: ['users'],
        resolvedBy: ['users'],
        assignedMechanicId: ['mechanics', 'users'],
      },
    });
    const selectedByUserId = text(record?.ticketContext?.selectedByUserId);
    if (selectedByUserId) references.push({
      id: selectedByUserId,
      targets: ['users'],
      field: 'ticketContext.selectedByUserId',
      slot: 'singleton',
    });
  }
  if (collection === 'rentals' || collection === 'gantt_rentals') {
    addArrayRelations({
      items: asArray(record?.downtimePeriods),
      path: 'downtimePeriods',
      identityFields: ['id'],
      fields: {
        rentalId: ['rentals', 'gantt_rentals'],
        ganttRentalId: ['rentals', 'gantt_rentals'],
        linkedGanttRentalId: ['rentals', 'gantt_rentals'],
        clientId: ['clients'],
        equipmentId: ['equipment'],
      },
    });
  }
  return references;
}

function knowledgeQuizCorrectOptionRelations(record) {
  const questions = asArray(record?.quiz);
  const identityFields = ['id'];
  const identityCounts = nestedIdentityCounts(questions, identityFields);
  const allOptionIds = new Set(questions.flatMap(question => (
    asArray(question?.options).map(option => text(option?.id)).filter(Boolean)
  )));
  return questions.map((question, index) => {
    const id = text(question?.correctOptionId);
    const matches = asArray(question?.options)
      .filter(option => text(option?.id) === id);
    return {
      id,
      slot: uniqueNestedSlot(question, index, identityFields, identityCounts),
      valid: Boolean(id) && matches.length === 1,
      found: Boolean(id) && allOptionIds.has(id),
    };
  });
}

function assertKnowledgeQuizRelationships(record, previous) {
  const previousRelations = knowledgeQuizCorrectOptionRelations(previous);
  for (const relation of knowledgeQuizCorrectOptionRelations(record)) {
    if (relation.valid) continue;
    const prior = previousRelations.filter(candidate => candidate.slot === relation.slot);
    if (prior.length === 1 && prior[0].id === relation.id) {
      if (!prior[0].valid) continue;
      throw new TenantDataBoundaryError(
        'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
        'The mutation would make a previously valid local stable relationship unresolved.',
        409,
        { collection: 'knowledge_base_modules', field: 'quiz[].correctOptionId' },
      );
    }
    throw new TenantDataBoundaryError(
      relation.found
        ? 'TENANT_LOCAL_RELATION_SCOPE_DENIED'
        : 'TENANT_LOCAL_RELATION_TARGET_REQUIRED',
      'The quiz correct option must resolve exactly once inside its own question.',
      409,
      { collection: 'knowledge_base_modules', field: 'quiz[].correctOptionId' },
    );
  }
}

function dynamicRelatedEntityTargets(record) {
  const id = text(record?.relatedEntityId);
  if (!id) return [];
  const type = text(record?.relatedEntityType).toLowerCase();
  const targets = {
    client: ['clients'],
    counterparty: ['counterparties'],
    rental: ['rentals', 'gantt_rentals'],
    equipment: ['equipment'],
    service: ['service'],
    document: ['documents'],
    payment: ['payments'],
    delivery: ['deliveries'],
    leasing: ['leasing_contracts'],
  }[type];
  if (targets) return [{ id, targets, field: 'relatedEntityId', type }];
  // "other" is an explicitly external/free-form association. Every other
  // type must be classified so a typo cannot bypass an internal stable-ID
  // boundary. Existing unknown legacy values are handled by the normal
  // pre/post compatibility comparison below.
  if (type === 'other') return [];
  return [{ id, targets: [], field: 'relatedEntityId', type, invalidType: true }];
}

function dynamicPlannerSourceTargets(collection, record) {
  if (collection !== 'planner_items') return [];
  const storedValue = String(record?.rentalId ?? '');
  const value = storedValue.trim();
  if (!value) return [];

  // Planner row IDs use this exact encoding in planner-core. Whitespace or an
  // unregistered prefix would be unreadable by the route and must not become a
  // free-form escape from the stable relationship boundary. Existing malformed
  // rows remain compatible through the normal pre/post grandfathering path.
  if (storedValue !== value) {
    return [{
      id: value,
      targets: [],
      field: 'rentalId',
      type: 'planner:malformed',
      invalidType: true,
    }];
  }

  for (const [prefix, targets] of [
    ['service:', ['service']],
    ['delivery:', ['deliveries']],
  ]) {
    if (!value.startsWith(prefix)) continue;
    return [{
      id: value.slice(prefix.length),
      targets,
      field: 'rentalId',
      type: `planner:${prefix.slice(0, -1)}`,
    }];
  }

  const separator = value.indexOf(':');
  if (separator >= 0) {
    return [{
      id: value,
      targets: [],
      field: 'rentalId',
      type: `planner:unknown:${value.slice(0, separator).toLowerCase()}`,
      invalidType: true,
    }];
  }

  return [{
    id: value,
    targets: ['rentals', 'gantt_rentals'],
    field: 'rentalId',
    type: 'planner:rental',
  }];
}

function dynamicAuthoritativeReferences(collection, record) {
  return [
    ...dynamicRelatedEntityTargets(record),
    ...dynamicPlannerSourceTargets(collection, record),
  ];
}

function buildStagedRead(entries, readRawData) {
  const staged = new Map((entries || []).map(entry => [entry.name, entry.value]));
  return name => staged.has(name) ? staged.get(name) : readRawData(name);
}

function stableRecordId(record) {
  return text(record?.id || record?._id);
}

function previousSourceRecord({
  entry,
  record,
  sourceKey,
  actorScope,
  originalValues,
  allowUnscopedSource = false,
}) {
  const source = originalValues instanceof Map ? originalValues.get(entry.name) : null;
  if (sourceKey !== null) {
    if (!source || typeof source !== 'object' || Array.isArray(source)) return null;
    const candidate = source[sourceKey];
    return recordMatchesScope(candidate, actorScope) ? candidate : null;
  }
  if (!Array.isArray(source)) return null;
  const id = stableRecordId(record);
  if (!id) return null;
  return source.find(candidate => (
    stableRecordId(candidate) === id
    && (
      allowUnscopedSource
      || recordMatchesScope(candidate, actorScope)
    )
  )) || null;
}

function targetResolution({
  id,
  targets,
  field,
  actorScope,
  read,
  allowedUserIds,
  sourceCollection,
  sourceRecord,
  isTargetAuthoritative,
}) {
  let found = false;
  let invalid = false;
  for (const targetCollection of targets) {
    if (targetCollection === 'client_contacts') {
      const clients = asArray(read('clients'));
      const allContactMatches = clients.flatMap(client => (
        asArray(client?.contacts)
          .filter(contact => text(contact?.id) === id)
          .map(contact => ({ client, contact }))
      ));
      if (allContactMatches.length > 0) found = true;
      const sourceClientId = text(sourceRecord?.clientId);
      const parentMatches = clients.filter(client => text(client?.id) === sourceClientId);
      const parent = parentMatches.length === 1 ? parentMatches[0] : null;
      const exactContacts = parent
        ? asArray(parent.contacts).filter(contact => text(contact?.id) === id)
        : [];
      if (
        !parent
        || parentMatches.length !== 1
        || !recordMatchesScope(parent, actorScope)
        || exactContacts.length !== 1
        || (
          typeof isTargetAuthoritative === 'function'
          && !isTargetAuthoritative({
            collection: 'clients',
            record: parent,
            actorScope,
            read,
          })
        )
      ) invalid = true;
      continue;
    }
    if (targetCollection === 'users') {
      const users = asArray(read('users')).filter(user => text(user?.id) === id);
      if (users.length === 0) continue;
      found = true;
      if (!allowedUserIds.has(id) || users.length !== 1) {
        invalid = true;
      }
      continue;
    }
    const targetRecords = asArray(read(targetCollection));
    if (isPlatformDefaultTenantOverlayCollection(targetCollection)) {
      const matches = readEffectiveCatalog({
        collection: targetCollection,
        records: targetRecords,
        scope: actorScope,
      }).filter(record => text(record?.id) === id);
      if (matches.length === 1) {
        found = true;
        if (
          typeof isTargetAuthoritative === 'function'
          && !isTargetAuthoritative({
            collection: targetCollection,
            record: matches[0],
            actorScope,
            read,
          })
        ) invalid = true;
        continue;
      }
      // A physical override ID or another tenant's standalone physical ID is
      // deliberately not a logical relationship target. Mark it as found but
      // inaccessible so callers receive the same non-enumerating denial used
      // for every other cross-tenant relation.
      const physicalFound = targetRecords.some(record => text(record?.id) === id);
      if (physicalFound) {
        found = true;
        invalid = true;
      }
      if (matches.length > 1) invalid = true;
      continue;
    }
    const matches = targetRecords.filter(record => text(record?.id) === id);
    if (matches.length === 0) continue;
    found = true;
    if (isGlobalReferenceCollection(targetCollection)) {
      const exactGlobalMatch = matches.length === 1
        && !text(matches[0]?.companyId)
        && !text(matches[0]?.tenantId);
      if (!exactGlobalMatch) invalid = true;
      continue;
    }
    if (
      matches.length !== 1
      || !recordMatchesScope(matches[0], actorScope)
      || (
        typeof isTargetAuthoritative === 'function'
        && !isTargetAuthoritative({
          collection: targetCollection,
          record: matches[0],
          actorScope,
          read,
        })
      )
    ) {
      invalid = true;
    }
  }
  return { found, valid: found && !invalid };
}

function assertReference({
  id,
  targets,
  field,
  previousIds,
  actorScope,
  read,
  beforeRead,
  allowedUserIds,
  sourceCollection,
  sourceRecord,
  previousRecord,
  isTargetAuthoritative,
  invalidType = false,
}) {
  const options = {
    id,
    targets,
    field,
    actorScope,
    allowedUserIds,
    sourceCollection,
    sourceRecord,
    isTargetAuthoritative,
  };
  const current = targetResolution({ ...options, read });
  if (current.valid) return;
  if (previousIds.includes(id)) {
    const previous = targetResolution({
      ...options,
      sourceRecord: previousRecord,
      read: beforeRead,
    });
    if (!previous.valid) return;
    throw new TenantDataBoundaryError(
      'TENANT_PARENT_MUTATION_ORPHANS_CHILD',
      'The mutation would make a previously valid stable relationship unresolved.',
      409,
      { collection: sourceCollection, field },
    );
  }
  throw new TenantDataBoundaryError(
    invalidType
      ? 'TENANT_RELATION_TYPE_UNCLASSIFIED'
      : (current.found ? 'CROSS_TENANT_RELATION_DENIED' : 'TENANT_RELATION_TARGET_REQUIRED'),
    'Referenced record is unavailable.',
    409,
    { collection: sourceCollection, field },
  );
}

function assertTenantRelationships(entries, {
  actorScope,
  readRawData,
  companyPrincipalIds,
  originalValues = new Map(),
  recordsToValidate = new Map(),
  isTargetAuthoritative,
  unscopedSourceCollections = [],
} = {}) {
  const scope = assertCompleteActorScope(actorScope);
  if (typeof readRawData !== 'function') throw new TypeError('Relationship guard requires raw storage access.');
  const read = buildStagedRead(entries, readRawData);
  const beforeRead = name => (
    originalValues instanceof Map && originalValues.has(name)
      ? originalValues.get(name)
      : readRawData(name)
  );
  const allowedUserIds = typeof companyPrincipalIds === 'function'
    ? companyPrincipalIds()
    : new Set();
  const unscopedSources = new Set(unscopedSourceCollections || []);

  assertGsmDataIntegrity({ read, beforeRead });

  for (const entry of entries || []) {
    const candidateRecords = recordsToValidate instanceof Map && recordsToValidate.has(entry.name)
      ? recordsToValidate.get(entry.name)
      : entry?.value;
    const records = sourceRecords(candidateRecords)
      .filter(({ record }) => (
        unscopedSources.has(entry.name)
        || recordMatchesScope(record, scope)
      ));
    for (const { record, sourceKey } of records) {
      const previous = previousSourceRecord({
        entry,
        record,
        sourceKey,
        actorScope: scope,
        originalValues,
        allowUnscopedSource: unscopedSources.has(entry.name),
      });
      for (const [field, targets] of scalarRelationFieldsForCollection(entry.name)) {
        for (const id of relationIds(record, field)) {
          if (isScalarRelationSentinel(entry.name, record, field, id)) continue;
          const previousIds = relationIds(previous, field).filter(previousId => (
            !isScalarRelationSentinel(entry.name, previous, field, previousId)
          ));
          assertReference({
            id,
            targets,
            field,
            actorScope: scope,
            read,
            allowedUserIds,
            sourceCollection: entry.name,
            sourceRecord: record,
            previousRecord: previous,
            isTargetAuthoritative,
            previousIds,
            beforeRead,
          });
        }
      }
      for (const [field, targets] of Object.entries(ARRAY_RELATION_FIELDS)) {
        for (const id of relationIds(record, field)) {
          assertReference({
            id,
            targets,
            field,
            actorScope: scope,
            read,
            allowedUserIds,
            sourceCollection: entry.name,
            sourceRecord: record,
            previousRecord: previous,
            isTargetAuthoritative,
            previousIds: relationIds(previous, field),
            beforeRead,
          });
        }
      }
      for (const id of nestedEquipmentIds(record)) {
        assertReference({
          id,
          targets: ['equipment'],
          field: 'equipment',
          actorScope: scope,
          read,
          allowedUserIds,
          sourceCollection: entry.name,
          sourceRecord: record,
          previousRecord: previous,
          isTargetAuthoritative,
          previousIds: nestedEquipmentIds(previous),
          beforeRead,
        });
      }
      {
        const previousNestedRelations = nestedAuthoritativeReferences(entry.name, previous);
        for (const relation of nestedAuthoritativeReferences(entry.name, record)) {
          assertReference({
            id: relation.id,
            targets: relation.targets,
            field: relation.field,
            actorScope: scope,
            read,
            allowedUserIds,
            sourceCollection: entry.name,
            sourceRecord: record,
            previousRecord: previous,
            isTargetAuthoritative,
            previousIds: previousNestedRelations
              .filter(candidate => (
                candidate.field === relation.field
                && candidate.slot === relation.slot
              ))
              .map(candidate => candidate.id),
            beforeRead,
          });
        }
      }
      if (entry.name === 'knowledge_base_modules') {
        assertKnowledgeQuizRelationships(record, previous);
      }
      for (const dynamic of dynamicAuthoritativeReferences(entry.name, record)) {
        const previousDynamic = dynamicAuthoritativeReferences(entry.name, previous)
          .filter(candidate => (
            candidate.field === dynamic.field
            && candidate.type === dynamic.type
            && candidate.targets.length === dynamic.targets.length
            && candidate.targets.every((target, index) => target === dynamic.targets[index])
          ))
          .map(candidate => candidate.id);
        assertReference({
          ...dynamic,
          actorScope: scope,
          read,
          allowedUserIds,
          sourceCollection: entry.name,
          sourceRecord: record,
          previousRecord: previous,
          isTargetAuthoritative,
          invalidType: dynamic.invalidType,
          previousIds: previousDynamic,
          beforeRead,
        });
      }
    }
  }
  return true;
}

module.exports = {
  ARRAY_RELATION_FIELDS,
  COLLECTION_DYNAMIC_RELATION_FIELDS,
  COLLECTION_EXTERNAL_ID_FIELDS,
  COLLECTION_RELATION_FIELDS,
  COLLECTION_RELATION_SENTINELS,
  EXACT_COLLECTION_RELATION_SOURCES,
  RELATION_FIELDS,
  assertTenantRelationships,
};
