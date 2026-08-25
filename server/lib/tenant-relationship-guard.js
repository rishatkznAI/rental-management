const { assertCompleteActorScope } = require('./trusted-actor-scope');
const { TenantDataBoundaryError } = require('./tenant-data-boundary');

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
  managerUserId: ['users'],
  responsibleUserId: ['users'],
  assignedUserId: ['users'],
  assignedToUserId: ['users'],
  assignedBy: ['users'],
  acceptedByUserId: ['users'],
  actorUserId: ['users'],
  approvedByUserId: ['users'],
  carrierUserId: ['users'],
  createdByUserId: ['users'],
  selectedByUserId: ['users'],
  systemUserId: ['users'],
  updatedByUserId: ['users'],
  approvedById: ['users'],
  mechanicId: ['mechanics', 'users'],
  assignedMechanicId: ['mechanics', 'users'],
  ownerId: ['owners', 'users'],
});

const ARRAY_RELATION_FIELDS = Object.freeze({
  counterpartyIds: ['counterparties'],
  clientIds: ['clients'],
  equipmentIds: ['equipment'],
  objectIds: ['client_objects'],
  contractObjectIds: ['client_objects'],
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
  ownerIds: ['owners', 'users'],
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

function relationIds(record, field) {
  const value = record?.[field];
  if (ARRAY_RELATION_FIELDS[field]) {
    return asArray(value).map(item => text(typeof item === 'object' ? item?.id : item)).filter(Boolean);
  }
  const id = text(value);
  return id ? [id] : [];
}

function nestedEquipmentIds(record) {
  return asArray(record?.equipment)
    .map(item => text(typeof item === 'object'
      ? (item?.id || item?.equipmentId)
      : item))
    .filter(Boolean);
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
  }[type];
  return targets ? [{ id, targets, field: 'relatedEntityId' }] : [];
}

function buildStagedRead(entries, readRawData) {
  const staged = new Map((entries || []).map(entry => [entry.name, entry.value]));
  return name => staged.has(name) ? staged.get(name) : readRawData(name);
}

function assertTargetScope({ id, targets, field, actorScope, read, allowedUserIds, sourceCollection }) {
  let found = false;
  for (const targetCollection of targets) {
    if (targetCollection === 'users') {
      const users = asArray(read('users')).filter(user => text(user?.id) === id);
      if (users.length === 0) continue;
      found = true;
      if (!allowedUserIds.has(id) || users.length !== 1) {
        throw new TenantDataBoundaryError(
          'CROSS_TENANT_RELATION_DENIED',
          'Referenced record is unavailable.',
          409,
          { collection: sourceCollection, field },
        );
      }
      continue;
    }
    const matches = asArray(read(targetCollection)).filter(record => text(record?.id) === id);
    if (matches.length === 0) continue;
    found = true;
    if (matches.length !== 1 || !recordMatchesScope(matches[0], actorScope)) {
      throw new TenantDataBoundaryError(
        'CROSS_TENANT_RELATION_DENIED',
        'Referenced record is unavailable.',
        409,
        { collection: sourceCollection, field },
      );
    }
  }
  return found;
}

function assertTenantRelationships(entries, {
  actorScope,
  readRawData,
  companyPrincipalIds,
} = {}) {
  const scope = assertCompleteActorScope(actorScope);
  if (typeof readRawData !== 'function') throw new TypeError('Relationship guard requires raw storage access.');
  const read = buildStagedRead(entries, readRawData);
  const allowedUserIds = typeof companyPrincipalIds === 'function'
    ? companyPrincipalIds()
    : new Set();

  for (const entry of entries || []) {
    const records = asArray(entry?.value).filter(record => recordMatchesScope(record, scope));
    for (const record of records) {
      for (const [field, targets] of Object.entries(RELATION_FIELDS)) {
        for (const id of relationIds(record, field)) {
          assertTargetScope({
            id,
            targets,
            field,
            actorScope: scope,
            read,
            allowedUserIds,
            sourceCollection: entry.name,
          });
        }
      }
      for (const [field, targets] of Object.entries(ARRAY_RELATION_FIELDS)) {
        for (const id of relationIds(record, field)) {
          assertTargetScope({
            id,
            targets,
            field,
            actorScope: scope,
            read,
            allowedUserIds,
            sourceCollection: entry.name,
          });
        }
      }
      for (const id of nestedEquipmentIds(record)) {
        assertTargetScope({
          id,
          targets: ['equipment'],
          field: 'equipment',
          actorScope: scope,
          read,
          allowedUserIds,
          sourceCollection: entry.name,
        });
      }
      for (const dynamic of dynamicRelatedEntityTargets(record)) {
        assertTargetScope({
          ...dynamic,
          actorScope: scope,
          read,
          allowedUserIds,
          sourceCollection: entry.name,
        });
      }
    }
  }
  return true;
}

module.exports = {
  ARRAY_RELATION_FIELDS,
  RELATION_FIELDS,
  assertTenantRelationships,
};
