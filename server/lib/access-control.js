const { MECHANIC_ROLES, WARRANTY_MECHANIC_ROLE } = require('./role-groups');

const ROLES = {
  ADMIN: 'Администратор',
  OFFICE: 'Офис-менеджер',
  RENTAL_MANAGER: 'Менеджер по аренде',
  SALES_MANAGER: 'Менеджер по продажам',
  INVESTOR: 'Инвестор',
  CARRIER: 'Перевозчик',
  WARRANTY_MECHANIC: WARRANTY_MECHANIC_ROLE,
};

const SYSTEM_FIELD_PATTERN = /^(?:__|_)/;

const MASS_ASSIGNMENT_BLOCKED_FIELDS = new Set([
  'role',
  'roles',
  'permissions',
  'isAdmin',
  'ownerId',
  'owner_id',
  'ownerName',
  'owner',
  'managerId',
  'manager_id',
  'mechanicId',
  'assignedMechanicId',
  'assignedUserId',
  'assignedCarrierId',
  'assignedBy',
  'createdBy',
  'createdById',
  'approvedBy',
  'approvedById',
  'approvedAt',
  'closedBy',
  'closedAt',
  'status',
  'paymentStatus',
  'amount',
  'paidAmount',
  'userId',
  'maxId',
  'maxUserId',
  'carrierId',
  'carrierKey',
  'carrierUserId',
  'passwordHash',
  'password',
  'token',
  'botToken',
  'session',
  'secret',
  'createdAt',
  'updatedAt',
  'deletedAt',
]);

const NON_ADMIN_BULK_ALLOWED_COLLECTIONS = new Set([
]);

const ACCESS_CONTROLLED_COLLECTIONS = new Set([
  'app_settings',
  'clients',
  'company_expenses',
  'crm_deals',
  'delivery_carriers',
  'deliveries',
  'documents',
  'equipment',
  'gantt_rentals',
  'gsm_commands',
  'gsm_packets',
  'knowledge_base_modules',
  'knowledge_base_progress',
  'mechanic_documents',
  'mechanics',
  'owners',
  'payments',
  'planner_items',
  'repair_part_items',
  'repair_work_items',
  'rentals',
  'service',
  'service_field_trips',
  'service_route_norms',
  'service_vehicles',
  'service_work_catalog',
  'service_works',
  'shipping_photos',
  'spare_parts',
  'spare_parts_catalog',
  'users',
  'vehicle_trips',
  'warranty_claims',
]);

const SERVICE_MECHANIC_UPDATE_FIELDS = new Set([
  'status',
  'comment',
  'comments',
  'photos',
  'attachments',
  'result',
  'resultData',
  'summary',
  'workLog',
  'parts',
  'works',
]);

const NON_ADMIN_UPDATE_FIELDS = {
  clients: new Set(['company', 'inn', 'email', 'address', 'contact', 'phone', 'paymentTerms', 'notes']),
  documents: new Set(['type', 'number', 'client', 'clientId', 'rental', 'rentalId', 'date', 'fileName', 'fileUrl', 'comment', 'attachments']),
  equipment: new Set([
    'manufacturer',
    'model',
    'serialNumber',
    'type',
    'drive',
    'year',
    'hours',
    'liftHeight',
    'workingHeight',
    'loadCapacity',
    'weight',
    'dimensions',
    'category',
    'priority',
    'activeInFleet',
    'location',
    'nextMaintenance',
    'maintenanceCHTO',
    'maintenancePTO',
    'notes',
    'photos',
    'gsmImei',
    'gsmDeviceId',
    'gsmProtocol',
    'gsmSimNumber',
  ]),
  knowledge_base_progress: new Set(['moduleId', 'status', 'progress', 'answers', 'score', 'completedAt', 'startedAt']),
  knowledge_base_modules: new Set([
    'title',
    'section',
    'category',
    'audience',
    'description',
    'videoUrl',
    'videoDurationMin',
    'passingScorePercent',
    'sortOrder',
    'isActive',
    'quiz',
  ]),
  shipping_photos: new Set(['rentalId', 'deliveryId', 'type', 'photo', 'photos', 'comment', 'createdAt']),
  warranty_claims: new Set(['status', 'comment', 'comments', 'attachments', 'resolution']),
  crm_deals: new Set(['title', 'client', 'clientId', 'contact', 'phone', 'stage', 'comment', 'comments', 'nextActionAt']),
  payments: new Set([
    'rentalId',
    'client',
    'clientId',
    'invoiceNumber',
    'amount',
    'paidAmount',
    'dueDate',
    'paidDate',
    'status',
    'method',
    'comment',
    'attachments',
  ]),
  service_field_trips: new Set(['status', 'routeFrom', 'routeTo', 'distanceKm', 'closedNormHours', 'comment', 'completedAt']),
  repair_work_items: new Set(['repairId', 'workId', 'quantity']),
  repair_part_items: new Set(['repairId', 'partId', 'quantity', 'priceSnapshot']),
  planner_items: new Set(['rentalId', 'equipmentRef', 'prepStatus', 'priorityOverride', 'riskOverride', 'comment']),
  service_vehicles: new Set([
    'make',
    'model',
    'plateNumber',
    'vin',
    'year',
    'vehicleType',
    'color',
    'currentMileage',
    'mileageUpdatedAt',
    'responsiblePerson',
    'conditionNote',
    'osagoExpiresAt',
    'insuranceExpiresAt',
    'nextServiceAt',
    'serviceNote',
  ]),
  vehicle_trips: new Set(['vehicleId', 'date', 'driver', 'route', 'purpose', 'startMileage', 'endMileage', 'serviceTicketId', 'clientId', 'comment']),
  service: SERVICE_MECHANIC_UPDATE_FIELDS,
};

const NON_ADMIN_CREATE_FIELDS = {
  ...NON_ADMIN_UPDATE_FIELDS,
  service: new Set([
    'serviceKind',
    'reason',
    'description',
    'equipment',
    'equipmentId',
    'equipmentType',
    'equipmentTypeLabel',
    'inventoryNumber',
    'serialNumber',
    'priority',
    'status',
    'comment',
    'comments',
    'photos',
    'attachments',
  ]),
  documents: new Set(['type', 'number', 'client', 'clientId', 'rental', 'rentalId', 'date', 'fileName', 'fileUrl', 'comment', 'attachments']),
};

const RENTAL_MANAGER_APPROVAL_FIELDS = new Set([
  'startDate',
  'endDate',
  'actualReturnDate',
  'price',
  'amount',
  'client',
  'clientId',
  'equipment',
  'equipmentId',
  'equipmentInv',
  'manager',
  'managerId',
  'status',
  'paymentStatus',
  'discount',
  'debt',
  'approvedBy',
]);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase();
}

function sameText(left, right) {
  const l = normalizeText(left);
  const r = normalizeText(right);
  return Boolean(l && r && l === r);
}

function sameId(left, right) {
  return sameText(left, right);
}

function compact(values) {
  return values
    .flat()
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function roleIs(user, role) {
  return user?.userRole === role || user?.role === role;
}

function currentRole(user) {
  return user?.userRole || user?.role || '';
}

function isKnownRole(user) {
  const role = currentRole(user);
  return Object.values(ROLES).includes(role) || MECHANIC_ROLES.includes(role);
}

function isKnownCollection(collection) {
  return ACCESS_CONTROLLED_COLLECTIONS.has(collection);
}

function forbidden(message = 'Forbidden') {
  const error = new Error(message);
  error.status = 403;
  return error;
}

function isAdmin(user) {
  return roleIs(user, ROLES.ADMIN);
}

function isOfficeManager(user) {
  return roleIs(user, ROLES.OFFICE);
}

function isRentalManager(user) {
  return roleIs(user, ROLES.RENTAL_MANAGER);
}

function isSalesManager(user) {
  return roleIs(user, ROLES.SALES_MANAGER);
}

function isInvestor(user) {
  return roleIs(user, ROLES.INVESTOR);
}

function isCarrier(user) {
  return roleIs(user, ROLES.CARRIER);
}

function isMechanic(user) {
  return MECHANIC_ROLES.includes(user?.userRole || user?.role);
}

function isWarrantyMechanic(user) {
  return roleIs(user, ROLES.WARRANTY_MECHANIC);
}

function userName(user) {
  return user?.userName || user?.name || '';
}

function userId(user) {
  return user?.userId || user?.id || '';
}

function getOwnerKeys(user) {
  return compact([
    user?.ownerId,
    user?.ownerName,
    user?.owner,
  ]);
}

function getEntityManagerKeys(entity) {
  return compact([
    entity?.managerId,
    entity?.manager_id,
    entity?.managerUserId,
    entity?.manager,
    entity?.responsibleManager,
    entity?.createdBy,
    entity?.createdById,
  ]);
}

function matchesUserManager(entity, user) {
  const userKeys = compact([userId(user), userName(user), user?.email]);
  const managerKeys = getEntityManagerKeys(entity);
  return userKeys.some(left => managerKeys.some(right => sameText(left, right)));
}

function getMechanicIdsForUser(user, readData) {
  const mechanics = readData('mechanics') || [];
  const keys = compact([userId(user), userName(user), user?.email]);
  return compact([
    userId(user),
    ...mechanics
      .filter(item => keys.some(key => sameText(key, item.id) || sameText(key, item.userId) || sameText(key, item.name) || sameText(key, item.email)))
      .map(item => item.id),
  ]);
}

function isAssignedMechanic(ticket, user, readData) {
  if (!isMechanic(user)) return false;
  const mechanicIds = getMechanicIdsForUser(user, readData);
  const userKeys = compact([userId(user), userName(user), user?.email, ...mechanicIds]);
  const ticketKeys = compact([
    ticket?.assignedMechanicId,
    ticket?.mechanicId,
    ticket?.assignedToId,
    ticket?.assignedUserId,
    ticket?.assignedMechanicName,
    ticket?.assignedTo,
  ]);
  return userKeys.some(left => ticketKeys.some(right => sameText(left, right)));
}

function isEquipmentOwnedBy(equipment, user) {
  const ownerKeys = getOwnerKeys(user);
  if (ownerKeys.length === 0) return false;
  const equipmentOwnerKeys = compact([
    equipment?.ownerId,
    equipment?.owner_id,
    equipment?.ownerName,
    equipment?.owner,
    equipment?.ownerTitle,
  ]);
  return ownerKeys.some(left => equipmentOwnerKeys.some(right => sameText(left, right)));
}

function rentalEquipmentRefs(rental) {
  const equipmentList = Array.isArray(rental?.equipment) ? rental.equipment : [];
  const equipmentIds = Array.isArray(rental?.equipmentIds) ? rental.equipmentIds : [];
  return compact([
    rental?.equipmentId,
    rental?.equipmentInv,
    rental?.inventoryNumber,
    rental?.serialNumber,
    equipmentIds,
    equipmentList.map(item => typeof item === 'object'
      ? [item.id, item.equipmentId, item.inventoryNumber, item.serialNumber, item.inv]
      : item),
  ]);
}

function rentalMatchesEquipment(rental, equipment) {
  const refs = rentalEquipmentRefs(rental);
  const equipmentRefs = compact([
    equipment?.id,
    equipment?.equipmentId,
    equipment?.inventoryNumber,
    equipment?.serialNumber,
    equipment?.inv,
  ]);
  return refs.some(left => equipmentRefs.some(right => sameText(left, right)));
}

function getScopedEquipment(user, readData) {
  const equipment = readData('equipment') || [];
  if (isAdmin(user) || isOfficeManager(user) || isRentalManager(user) || isSalesManager(user) || isMechanic(user) || isWarrantyMechanic(user)) {
    return equipment;
  }
  if (isInvestor(user)) {
    return equipment.filter(item => isEquipmentOwnedBy(item, user));
  }
  return [];
}

function isInvestorRental(rental, user, readData) {
  if (!isInvestor(user)) return false;
  const equipment = getScopedEquipment(user, readData);
  return equipment.some(item => rentalMatchesEquipment(rental, item));
}

function getScopedRentals(user, readData) {
  const rentals = [
    ...(readData('rentals') || []),
    ...(readData('gantt_rentals') || []),
  ];
  if (isAdmin(user) || isOfficeManager(user) || isWarrantyMechanic(user)) return rentals;
  if (isRentalManager(user) || isSalesManager(user)) {
    return rentals.filter(item => matchesUserManager(item, user));
  }
  if (isInvestor(user)) {
    return rentals.filter(item => isInvestorRental(item, user, readData));
  }
  return [];
}

function entityRentalIds(entity) {
  return compact([
    entity?.rentalId,
    entity?.rental,
    entity?.ganttRentalId,
    entity?.classicRentalId,
  ]);
}

function entityServiceTicketIds(entity) {
  return compact([
    entity?.serviceTicketId,
    entity?.serviceId,
    entity?.repairId,
    entity?.ticketId,
  ]);
}

function findLinkedServiceTicket(entity, readData) {
  const ids = entityServiceTicketIds(entity);
  if (ids.length === 0) return null;
  return (readData('service') || []).find(item => ids.some(id => sameId(id, item.id))) || null;
}

function isMechanicLinkedEntity(entity, user, readData) {
  if (!isMechanic(user)) return false;
  const ticket = findLinkedServiceTicket(entity, readData);
  if (ticket) return canAccessEntity('service', ticket, user, readData);
  const mechanicIds = getMechanicIdsForUser(user, readData);
  const userKeys = compact([userId(user), userName(user), user?.email, ...mechanicIds]);
  const entityKeys = compact([
    entity?.mechanicId,
    entity?.assignedMechanicId,
    entity?.assignedUserId,
    entity?.userId,
    entity?.mechanicName,
    entity?.assignedMechanicName,
    entity?.assignedTo,
    entity?.driver,
  ]);
  return userKeys.some(left => entityKeys.some(right => sameText(left, right)));
}

function matchesScopedRental(entity, user, readData) {
  const scopedRentals = getScopedRentals(user, readData);
  const scopedIds = compact(scopedRentals.map(item => item.id));
  const ids = entityRentalIds(entity);
  if (ids.length > 0 && ids.some(id => scopedIds.some(scopedId => sameId(id, scopedId)))) return true;

  const clientKeys = compact([entity?.clientId, entity?.client, entity?.company]);
  if (clientKeys.length === 0) return false;
  return scopedRentals.some(rental => {
    const rentalClientKeys = compact([rental?.clientId, rental?.client, rental?.company]);
    return clientKeys.some(left => rentalClientKeys.some(right => sameText(left, right)));
  });
}

function isCarrierDelivery(delivery, user) {
  const carrierKeys = compact([
    user?.carrierId,
  ]);
  const deliveryCarrierKeys = compact([
    delivery?.carrierId,
    delivery?.carrierKey,
  ]);
  return carrierKeys.some(left => deliveryCarrierKeys.some(right => sameText(left, right)));
}

function canAccessEntity(collection, entity, user, readData) {
  if (!entity || !user) return false;
  if (!isKnownRole(user) || !isKnownCollection(collection)) return false;
  if (isAdmin(user)) return true;
  if (collection === 'app_settings') return false;

  switch (collection) {
    case 'users':
      return sameId(entity.id, userId(user));
    case 'rentals':
    case 'gantt_rentals':
      if (isOfficeManager(user)) return true;
      if (isWarrantyMechanic(user)) return true;
      if (isRentalManager(user) || isSalesManager(user)) return matchesUserManager(entity, user);
      if (isInvestor(user)) return isInvestorRental(entity, user, readData);
      return false;
    case 'equipment':
      if (isInvestor(user)) return isEquipmentOwnedBy(entity, user);
      if (isOfficeManager(user) || isRentalManager(user) || isSalesManager(user) || isMechanic(user) || isWarrantyMechanic(user)) return true;
      return false;
    case 'owners':
      if (isInvestor(user)) return isEquipmentOwnedBy(entity, user) || getOwnerKeys(user).some(key => sameText(key, entity.id) || sameText(key, entity.name));
      return false;
    case 'clients':
    case 'documents':
    case 'payments':
      if (isOfficeManager(user)) return true;
      if (isRentalManager(user) || isSalesManager(user)) return matchesScopedRental(entity, user, readData) || matchesUserManager(entity, user);
      return false;
    case 'mechanic_documents':
      if (isOfficeManager(user)) return true;
      if (isRentalManager(user) || isSalesManager(user)) return matchesScopedRental(entity, user, readData) || matchesUserManager(entity, user);
      if (isMechanic(user)) return isMechanicLinkedEntity(entity, user, readData);
      return false;
    case 'service':
      if (isOfficeManager(user) || isRentalManager(user)) return true;
      if (isWarrantyMechanic(user)) return true;
      if (isMechanic(user)) return isAssignedMechanic(entity, user, readData);
      return false;
    case 'warranty_claims':
      if (isOfficeManager(user)) return true;
      if (isWarrantyMechanic(user)) return true;
      if (isMechanic(user)) return isMechanicLinkedEntity(entity, user, readData);
      return false;
    case 'repair_work_items':
    case 'repair_part_items': {
      const ticket = findLinkedServiceTicket(entity, readData);
      return ticket ? canAccessEntity('service', ticket, user, readData) : false;
    }
    case 'service_field_trips': {
      if (isOfficeManager(user)) return true;
      if (isMechanic(user)) {
        if (entity.serviceTicketId) {
          const ticket = (readData('service') || []).find(item => item.id === entity.serviceTicketId);
          if (ticket) return canAccessEntity('service', ticket, user, readData);
        }
        const mechanicIds = getMechanicIdsForUser(user, readData);
        return compact([entity.mechanicId, entity.mechanicName]).some(value =>
          mechanicIds.some(id => sameText(id, value)) || sameText(value, userName(user)),
        );
      }
      return false;
    }
    case 'deliveries':
      if (isOfficeManager(user)) return true;
      if (isRentalManager(user) || isSalesManager(user)) return matchesUserManager(entity, user);
      if (isCarrier(user)) return isCarrierDelivery(entity, user);
      return false;
    case 'knowledge_base_modules':
      return isOfficeManager(user) || isRentalManager(user) || isSalesManager(user);
    case 'knowledge_base_progress':
      if (isOfficeManager(user)) return true;
      return sameId(entity.userId, userId(user));
    case 'crm_deals':
      if (isOfficeManager(user)) return true;
      if (isRentalManager(user) || isSalesManager(user)) return matchesUserManager(entity, user);
      return false;
    case 'shipping_photos':
      if (isOfficeManager(user)) return true;
      if (isRentalManager(user) || isSalesManager(user)) return matchesScopedRental(entity, user, readData) || matchesUserManager(entity, user);
      if (isMechanic(user)) return isMechanicLinkedEntity(entity, user, readData);
      return false;
    case 'mechanics':
      if (isWarrantyMechanic(user)) return true;
      if (isOfficeManager(user)) return true;
      if (isMechanic(user)) {
        const mechanicIds = getMechanicIdsForUser(user, readData);
        const entityKeys = compact([entity.id, entity.userId, entity.name, entity.email]);
        const userKeys = compact([userId(user), userName(user), user?.email, ...mechanicIds]);
        return userKeys.some(left => entityKeys.some(right => sameText(left, right)));
      }
      return false;
    case 'service_works':
    case 'spare_parts':
    case 'service_route_norms':
      return isOfficeManager(user) || isMechanic(user) || isWarrantyMechanic(user);
    case 'service_work_catalog':
    case 'spare_parts_catalog':
    case 'company_expenses':
    case 'delivery_carriers':
      return false;
    case 'planner_items':
      if (isOfficeManager(user)) return true;
      if (isRentalManager(user) || isSalesManager(user)) return matchesScopedRental(entity, user, readData) || matchesUserManager(entity, user);
      if (isMechanic(user)) return isMechanicLinkedEntity(entity, user, readData);
      return false;
    case 'service_vehicles':
      return isOfficeManager(user) || isMechanic(user);
    case 'vehicle_trips':
      if (isOfficeManager(user)) return true;
      if (isMechanic(user)) return isMechanicLinkedEntity(entity, user, readData);
      return false;
    default:
      return false;
  }
}

function canMutateEntity(collection, entity, user, readData) {
  if (!user) return false;
  if (!isKnownRole(user) || !isKnownCollection(collection)) return false;
  if (isAdmin(user)) return true;
  if (collection === 'app_settings' || collection === 'users' || collection === 'owners' || collection === 'delivery_carriers') {
    return false;
  }
  if (collection === 'payments') {
    return isOfficeManager(user);
  }
  if (collection === 'equipment') {
    return isOfficeManager(user);
  }
  if (collection === 'rentals' || collection === 'gantt_rentals') {
    if (isOfficeManager(user)) return true;
    if (isRentalManager(user)) return canAccessEntity(collection, entity, user, readData);
    return false;
  }
  if (collection === 'service') {
    if (isOfficeManager(user)) return true;
    if (isRentalManager(user)) return false;
    if (isWarrantyMechanic(user)) return canAccessEntity(collection, entity, user, readData);
    if (isMechanic(user)) return canAccessEntity(collection, entity, user, readData);
    return false;
  }
  if (collection === 'repair_work_items' || collection === 'repair_part_items' || collection === 'service_field_trips') {
    return canAccessEntity(collection, entity, user, readData);
  }
  if (collection === 'deliveries') {
    if (isOfficeManager(user)) return true;
    if (isRentalManager(user) || isSalesManager(user)) return canAccessEntity(collection, entity, user, readData);
    return false;
  }
  return canAccessEntity(collection, entity, user, readData);
}

function filterCollectionByScope(collection, list, user, readData) {
  const data = Array.isArray(list) ? list : [];
  if (!isKnownRole(user) || !isKnownCollection(collection)) return [];
  if (isAdmin(user)) return data;
  if (collection === 'app_settings') return [];
  return data.filter(item => canAccessEntity(collection, item, user, readData));
}

function isSystemField(field) {
  return SYSTEM_FIELD_PATTERN.test(field) || MASS_ASSIGNMENT_BLOCKED_FIELDS.has(field);
}

function stripMassAssignmentFields(input, user, collection, mode = 'update') {
  const body = input && typeof input === 'object' ? input : {};
  if (isAdmin(user)) return { ...body };
  const allowedFields = (mode === 'create' ? NON_ADMIN_CREATE_FIELDS[collection] : NON_ADMIN_UPDATE_FIELDS[collection]) || null;
  if (!allowedFields) return {};
  return Object.entries(body).reduce((acc, [field, value]) => {
    if (isSystemField(field) && !(allowedFields && allowedFields.has(field))) return acc;
    if (allowedFields && !allowedFields.has(field)) return acc;
    acc[field] = value;
    return acc;
  }, {});
}

function sanitizeCreateInput(collection, input, user) {
  if (!isKnownRole(user) || !isKnownCollection(collection)) {
    throw forbidden();
  }
  const safe = stripMassAssignmentFields(input, user, collection, 'create');
  if (!isAdmin(user)) {
    delete safe.id;
  }
  if (collection === 'service' && isMechanic(user)) {
    safe.status = safe.status || 'new';
    safe.assignedTo = userName(user);
    safe.assignedUserId = userId(user);
  }
  if ((collection === 'clients' || collection === 'documents' || collection === 'crm_deals') && (isRentalManager(user) || isSalesManager(user))) {
    safe.manager = userName(user);
    safe.managerId = userId(user);
  }
  return safe;
}

function sanitizeUpdateInput(collection, input, user, existing = null) {
  if (!isKnownRole(user) || !isKnownCollection(collection)) {
    throw forbidden();
  }
  if (isAdmin(user)) return { ...(input || {}) };
  if (collection === 'service' && isMechanic(user)) {
    const safe = {};
    for (const [field, value] of Object.entries(input || {})) {
      if (SERVICE_MECHANIC_UPDATE_FIELDS.has(field)) safe[field] = value;
    }
    return safe;
  }
  const safe = stripMassAssignmentFields(input, user, collection);
  if ((collection === 'clients' || collection === 'documents' || collection === 'crm_deals') && (isRentalManager(user) || isSalesManager(user))) {
    safe.manager = existing?.manager || userName(user);
    safe.managerId = existing?.managerId || userId(user);
  }
  return safe;
}

function assertCanReadCollection(collection, user) {
  if (!isKnownRole(user) || !isKnownCollection(collection)) {
    throw forbidden();
  }
  if (collection === 'app_settings' && !isAdmin(user)) {
    throw forbidden();
  }
}

function assertCanCreateCollection(collection, user, input = {}, readData) {
  if (!isKnownRole(user) || !isKnownCollection(collection)) {
    throw forbidden();
  }
  if (collection === 'payments' && !(isAdmin(user) || isOfficeManager(user))) {
    throw forbidden('Платежи можно создавать только администратору или офис-менеджеру.');
  }
  if (collection === 'app_settings' && !isAdmin(user)) {
    throw forbidden();
  }
  if (!isAdmin(user) && !NON_ADMIN_CREATE_FIELDS[collection]) {
    throw forbidden();
  }
  if (['repair_work_items', 'repair_part_items', 'service_field_trips', 'warranty_claims'].includes(collection)) {
    if (!canMutateEntity(collection, input, user, readData)) {
      throw forbidden();
    }
  }
}

function assertCanUpdateEntity(collection, entity, user, readData) {
  if (!isKnownRole(user) || !isKnownCollection(collection)) {
    throw forbidden();
  }
  if (!canMutateEntity(collection, entity, user, readData)) {
    throw forbidden();
  }
}

function assertCanDeleteEntity(collection, entity, user, readData) {
  if (!isKnownRole(user) || !isKnownCollection(collection)) {
    throw forbidden();
  }
  if (!isAdmin(user)) {
    if (collection === 'payments') {
      throw forbidden('Удаление платежей доступно только администратору.');
    }
    if (collection === 'service' && !isOfficeManager(user)) {
      throw forbidden('Удаление сервисных заявок доступно только администратору или офис-менеджеру.');
    }
    if (!canMutateEntity(collection, entity, user, readData)) {
      throw forbidden();
    }
  }
}

function assertCanBulkReplace(collection, user) {
  if (!isKnownRole(user) || !isKnownCollection(collection)) {
    throw forbidden();
  }
  if (isAdmin(user)) return;
  if (!NON_ADMIN_BULK_ALLOWED_COLLECTIONS.has(collection)) {
    throw forbidden('Массовое обновление коллекции доступно только администратору.');
  }
}

function splitForbiddenRentalManagerPatch(previousRental, patch) {
  const immediatePatch = {};
  const approvalFields = [];
  for (const [field, value] of Object.entries(patch || {})) {
    if (RENTAL_MANAGER_APPROVAL_FIELDS.has(field)) {
      if (JSON.stringify(previousRental?.[field] ?? null) !== JSON.stringify(value ?? null)) {
        approvalFields.push(field);
      }
    } else {
      immediatePatch[field] = value;
    }
  }
  return { immediatePatch, approvalFields };
}

function createAccessControl({ readData }) {
  return {
    ROLES,
    MASS_ASSIGNMENT_BLOCKED_FIELDS,
    assertCanBulkReplace,
    assertCanCreateCollection: (collection, user, input) => assertCanCreateCollection(collection, user, input, readData),
    assertCanDeleteEntity: (collection, entity, user) => assertCanDeleteEntity(collection, entity, user, readData),
    assertCanReadCollection,
    assertCanUpdateEntity: (collection, entity, user) => assertCanUpdateEntity(collection, entity, user, readData),
    canAccessEntity: (collection, entity, user) => canAccessEntity(collection, entity, user, readData),
    canMutateEntity: (collection, entity, user) => canMutateEntity(collection, entity, user, readData),
    filterCollectionByScope: (collection, list, user) => filterCollectionByScope(collection, list, user, readData),
    getScopedEquipment: user => getScopedEquipment(user, readData),
    getScopedRentals: user => getScopedRentals(user, readData),
    isAdmin,
    isAssignedMechanic: (ticket, user) => isAssignedMechanic(ticket, user, readData),
    isCarrierDelivery,
    isInvestor,
    isMechanic,
    isOfficeManager,
    isRentalManager,
    isSalesManager,
    matchesScopedRental: (entity, user) => matchesScopedRental(entity, user, readData),
    matchesUserManager,
    sanitizeCreateInput,
    sanitizeUpdateInput,
    splitForbiddenRentalManagerPatch,
  };
}

module.exports = {
  ROLES,
  createAccessControl,
  isCarrierDelivery,
};
