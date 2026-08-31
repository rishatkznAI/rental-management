const COLLECTION_SCOPE_CATEGORY = Object.freeze({
  TENANT: 'TENANT',
  PLATFORM_DEFAULT_TENANT_OVERLAY: 'PLATFORM_DEFAULT_TENANT_OVERLAY',
  GLOBAL_REFERENCE: 'GLOBAL_REFERENCE',
  SYSTEM: 'SYSTEM',
  TENANT_TECHNICAL: 'TENANT_TECHNICAL',
  LEGACY_HISTORY: 'LEGACY_HISTORY',
  DERIVED_SCOPE: 'DERIVED_SCOPE',
});

const COLLECTION_SHAPE = Object.freeze({
  ARRAY: 'ARRAY',
  MAP: 'MAP',
  SINGLETON: 'SINGLETON',
});

function deepFreeze(value, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}

const PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS = Object.freeze([
  'knowledge_base_modules',
  'service_works',
  'spare_parts',
  'service_route_norms',
  'service_work_catalog',
  'spare_parts_catalog',
  'service_work_names',
  'spare_part_names',
]);

// This is the authoritative classification for every app_data collection. Keep
// policy here rather than duplicating security-sensitive collection lists in the
// database, access-control, import, and request-boundary layers.
const GROUPS = Object.freeze({
  [COLLECTION_SCOPE_CATEGORY.TENANT]: Object.freeze([
    'equipment',
    'rentals',
    'gantt_rentals',
    'service',
    'warranty_claims',
    'counterparties',
    'documents',
    'finance_accounts',
    'company_expenses',
    'leasing_contracts',
    'payroll_periods',
    'crm_deals',
    'crm_activities',
    'deliveries',
    'owners',
    'planner_items',
    'service_vehicles',
    'manager_activity',
    // One independently owned CMS document per company/tenant. Public delivery
    // is a separate projection path; the stored singleton is never global.
    'public_site_cms',
    // Mechanics are a tenant business roster. A system user link is optional;
    // standalone mechanic contacts remain valid long-lived records.
    'mechanics',
  ]),
  // These eight families contain two disjoint physical partitions in the same
  // JSON array: immutable-for-tenants unscoped platform defaults and exact
  // tenant-owned entries/overrides. An override uses its own physical `id` and
  // an explicit `platformDefaultId`; names, titles and articles are never keys.
  [COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY]: Object.freeze([
    ...PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
  ]),
  [COLLECTION_SCOPE_CATEGORY.GLOBAL_REFERENCE]: Object.freeze([]),
  [COLLECTION_SCOPE_CATEGORY.SYSTEM]: Object.freeze([
    'users',
    'bot_sessions',
  ]),
  [COLLECTION_SCOPE_CATEGORY.TENANT_TECHNICAL]: Object.freeze([
    'inline_relation_idempotency',
    'rental_create_idempotency',
    'knowledge_base_progress',
    'app_settings',
    'bot_users',
    'bot_activity',
    'bot_notifications',
    'snapshot',
  ]),
  [COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY]: Object.freeze([
    'audit_log',
    'audit_logs',
    // Historical side-car collections are still consulted by the stable-ID
    // lifecycle guard. They are absent from the current production snapshot,
    // but must remain explicitly classified so a legacy database cannot turn a
    // dynamic read into an ambient, unscoped bypass.
    'client_history',
    'client_object_history',
    'domain_history',
    // Service audit entries must outlive the service ticket they describe.
    // They are tenant-scoped immutable history, not a child projection whose
    // continued validity depends on the current parent row.
    'service_audit_log',
  ]),
  [COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE]: Object.freeze([
    'equipment_finance',
    'equipment_downtimes',
    'rental_change_requests',
    'counterparty_role_assignments',
    'supplier_profiles',
    'contractor_profiles',
    'clients',
    'client_objects',
    'client_contracts',
    'gsm_devices',
    'gsm_packets',
    'gsm_commands',
    'mechanic_documents',
    'payments',
    'payment_allocations',
    'debt_collection_plans',
    'debt_collection_actions',
    'receivable_payment_plans',
    'finance_operations',
    'leasing_payment_schedule',
    'payroll_profiles',
    'payroll_records',
    'payroll_adjustments',
    'payroll_audit_events',
    'delivery_carriers',
    'shipping_photos',
    'equipment_operation_sessions',
    'service_field_trips',
    'repair_work_items',
    'repair_part_items',
    'vehicle_trips',
    'management_action_states',
  ]),
});

const MAP_COLLECTIONS = new Set(['bot_users', 'bot_sessions']);
const SINGLETON_COLLECTIONS = new Set(['snapshot', 'public_site_cms']);
const LEGACY_IDEMPOTENCY_COLLECTIONS = new Set([
  'inline_relation_idempotency',
  'rental_create_idempotency',
]);
const APPEND_ONLY_COLLECTIONS = new Set([
  'payroll_audit_events',
]);

// A derived record must resolve at least one of these stable references to one
// authoritative parent. If several references are present they must all resolve
// to the same tenant. GSM device identifiers need additional exact-match logic
// in the telemetry repository and are still anchored here to registered devices.
const DERIVED_PARENT_RULES = deepFreeze({
  equipment_finance: Object.freeze([{ fields: ['equipmentId'], collections: ['equipment'] }]),
  equipment_downtimes: Object.freeze([{ fields: ['equipmentId'], collections: ['equipment'] }]),
  rental_change_requests: Object.freeze([
    { fields: ['rentalId', 'ganttRentalId', 'sourceRentalId'], collections: ['rentals', 'gantt_rentals'] },
    { fields: ['entityId'], collections: ['rentals', 'gantt_rentals', 'payments', 'documents'] },
  ]),
  counterparty_role_assignments: Object.freeze([{ fields: ['counterpartyId'], collections: ['counterparties'] }]),
  supplier_profiles: Object.freeze([{ fields: ['counterpartyId'], collections: ['counterparties'] }]),
  contractor_profiles: Object.freeze([{ fields: ['counterpartyId'], collections: ['counterparties'] }]),
  clients: Object.freeze([{ fields: ['counterpartyId'], collections: ['counterparties'] }]),
  client_objects: Object.freeze([
    { fields: ['clientId'], collections: ['clients'] },
    { fields: ['counterpartyId'], collections: ['counterparties'] },
  ]),
  client_contracts: Object.freeze([
    { fields: ['clientId'], collections: ['clients'] },
    { fields: ['counterpartyId'], collections: ['counterparties'] },
  ]),
  gsm_devices: Object.freeze([{ fields: ['equipmentId'], collections: ['equipment'] }]),
  gsm_packets: Object.freeze([
    { fields: ['gsmDeviceRecordId'], collections: ['gsm_devices'] },
    { fields: ['equipmentId'], collections: ['equipment'] },
  ]),
  gsm_commands: Object.freeze([
    { fields: ['gsmDeviceRecordId'], collections: ['gsm_devices'] },
    { fields: ['equipmentId'], collections: ['equipment'] },
  ]),
  mechanic_documents: Object.freeze([
    { fields: ['mechanicId'], collections: ['mechanics'] },
    { fields: ['serviceTicketId', 'serviceId'], collections: ['service'] },
  ]),
  payments: Object.freeze([
    { fields: ['clientId'], collections: ['clients'] },
    { fields: ['rentalId', 'rental'], collections: ['rentals', 'gantt_rentals'] },
    { fields: ['counterpartyId'], collections: ['counterparties'] },
    { fields: ['documentId', 'document'], collections: ['documents'] },
  ]),
  payment_allocations: Object.freeze([{ fields: ['paymentId'], collections: ['payments'] }]),
  debt_collection_plans: Object.freeze([
    { fields: ['clientId', 'debtorClientId'], collections: ['clients'] },
    { fields: ['counterpartyId', 'debtorCounterpartyId'], collections: ['counterparties'] },
  ]),
  debt_collection_actions: Object.freeze([
    { fields: ['debtCollectionPlanId', 'collectionPlanId', 'planId'], collections: ['debt_collection_plans'] },
    { fields: ['clientId', 'debtorClientId'], collections: ['clients'] },
    { fields: ['counterpartyId', 'debtorCounterpartyId'], collections: ['counterparties'] },
    { fields: ['rentalId'], collections: ['rentals', 'gantt_rentals'] },
    { fields: ['paymentId'], collections: ['payments'] },
    { fields: ['documentId'], collections: ['documents'] },
  ]),
  receivable_payment_plans: Object.freeze([
    { fields: ['clientId', 'debtorClientId'], collections: ['clients'] },
    { fields: ['counterpartyId', 'debtorCounterpartyId'], collections: ['counterparties'] },
    { fields: ['rentalId'], collections: ['rentals', 'gantt_rentals'] },
  ]),
  finance_operations: Object.freeze([{
    fields: ['accountId', 'financeAccountId', 'accountFromId', 'accountToId'],
    collections: ['finance_accounts'],
  }]),
  leasing_payment_schedule: Object.freeze([{ fields: ['leasingContractId'], collections: ['leasing_contracts'] }]),
  payroll_profiles: Object.freeze([{ fields: ['userId'], collections: ['users'] }]),
  payroll_records: Object.freeze([
    { fields: ['payrollPeriodId', 'periodId'], collections: ['payroll_periods'] },
    { fields: ['payrollProfileId', 'profileId'], collections: ['payroll_profiles'] },
  ]),
  payroll_adjustments: Object.freeze([
    { fields: ['payrollRecordId'], collections: ['payroll_records'] },
    { fields: ['payrollPeriodId', 'periodId'], collections: ['payroll_periods'] },
  ]),
  payroll_audit_events: Object.freeze([
    { fields: ['payrollRecordId'], collections: ['payroll_records'] },
    { fields: ['payrollPeriodId', 'periodId'], collections: ['payroll_periods'] },
    { fields: ['entityId'], collections: ['payroll_profiles', 'payroll_records', 'payroll_adjustments', 'payroll_periods'] },
    { fields: ['userId'], collections: ['users'] },
  ]),
  delivery_carriers: Object.freeze([{ fields: ['counterpartyId', 'contractorCounterpartyId'], collections: ['counterparties'] }]),
  shipping_photos: Object.freeze([
    { fields: ['equipmentId'], collections: ['equipment'] },
    { fields: ['rentalId'], collections: ['rentals', 'gantt_rentals'] },
    { fields: ['deliveryId'], collections: ['deliveries'] },
  ]),
  equipment_operation_sessions: Object.freeze([
    { fields: ['equipmentId'], collections: ['equipment'] },
    { fields: ['rentalId'], collections: ['rentals', 'gantt_rentals'] },
  ]),
  service_field_trips: Object.freeze([{ fields: ['serviceTicketId', 'serviceId', 'repairId'], collections: ['service'] }]),
  repair_work_items: Object.freeze([{ fields: ['serviceTicketId', 'serviceId', 'repairId', 'ticketId'], collections: ['service'] }]),
  repair_part_items: Object.freeze([{ fields: ['serviceTicketId', 'serviceId', 'repairId', 'ticketId'], collections: ['service'] }]),
  vehicle_trips: Object.freeze([{ fields: ['vehicleId', 'serviceCarId'], collections: ['service_vehicles'] }]),
  management_action_states: Object.freeze([{ fields: ['equipmentId'], collections: ['equipment'] }]),
});

const registryEntries = [];
for (const [category, names] of Object.entries(GROUPS)) {
  for (const name of names) {
    registryEntries.push([name, Object.freeze({
      name,
      category,
      shape: MAP_COLLECTIONS.has(name)
        ? COLLECTION_SHAPE.MAP
        : (SINGLETON_COLLECTIONS.has(name) ? COLLECTION_SHAPE.SINGLETON : COLLECTION_SHAPE.ARRAY),
      readPolicy: LEGACY_IDEMPOTENCY_COLLECTIONS.has(name)
        ? 'IMMUTABLE_LEGACY_TOMBSTONES_HIDDEN'
        : category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY
        ? 'PLATFORM_DEFAULT_PLUS_EXACT_TENANT_OVERLAY'
        : category === COLLECTION_SCOPE_CATEGORY.GLOBAL_REFERENCE
        ? 'AUTHENTICATED_GLOBAL_READ_ONLY'
        : category === COLLECTION_SCOPE_CATEGORY.SYSTEM
          ? 'DEDICATED_SYSTEM_POLICY'
          : category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY
            ? 'SCOPED_TENANT_OR_PLATFORM_HISTORY'
            : 'EXACT_TENANT_SCOPE',
      writeAuthority: LEGACY_IDEMPOTENCY_COLLECTIONS.has(name)
        ? 'PLATFORM_REMEDIATION_ONLY'
        : category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY
        ? 'PLATFORM_SYSTEM_OR_TRUSTED_TENANT_PARTITION'
        : category === COLLECTION_SCOPE_CATEGORY.GLOBAL_REFERENCE
        ? 'PLATFORM_SYSTEM_ONLY'
        : category === COLLECTION_SCOPE_CATEGORY.SYSTEM
          ? 'DEDICATED_SYSTEM_POLICY'
          : category === COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE
            ? 'AUTHORITATIVE_PARENT'
            : category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY
              ? 'AUDIT_REPOSITORY_ONLY'
              : 'TRUSTED_TENANT_ACTOR',
      mutationPolicy: LEGACY_IDEMPOTENCY_COLLECTIONS.has(name)
        ? 'IMMUTABLE'
        : category === COLLECTION_SCOPE_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY
          ? 'PARTITIONED_MUTABLE'
        : category === COLLECTION_SCOPE_CATEGORY.LEGACY_HISTORY
          || APPEND_ONLY_COLLECTIONS.has(name)
          ? 'APPEND_ONLY'
          : 'MUTABLE',
      parentResolver: category === COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE
        ? DERIVED_PARENT_RULES[name]
        : null,
    })]);
  }
}

const duplicateNames = registryEntries
  .map(([name]) => name)
  .filter((name, index, names) => names.indexOf(name) !== index);
if (duplicateNames.length > 0) {
  throw new Error(`Duplicate app_data scope classifications: ${[...new Set(duplicateNames)].join(', ')}`);
}

const COLLECTION_SCOPE_REGISTRY = Object.freeze(Object.fromEntries(registryEntries));
const ALL_APP_DATA_COLLECTIONS = Object.freeze(registryEntries.map(([name]) => name));

function assertUniqueNonemptyStrings(values, label) {
  if (!Array.isArray(values) || values.length === 0) {
    throw new Error(`${label} must be a non-empty array.`);
  }
  const normalized = values.map(value => String(value || '').trim());
  if (normalized.some(value => !value) || new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must contain unique non-empty names.`);
  }
}

function assertDerivedParentRegistry() {
  const derivedNames = new Set(GROUPS[COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE]);
  const resolverNames = Object.keys(DERIVED_PARENT_RULES);
  const missing = [...derivedNames].filter(name => !DERIVED_PARENT_RULES[name]);
  const unexpected = resolverNames.filter(name => !derivedNames.has(name));
  if (missing.length > 0 || unexpected.length > 0) {
    throw new Error(
      `Derived parent registry mismatch; missing=${missing.join(',') || 'none'}; unexpected=${unexpected.join(',') || 'none'}.`,
    );
  }

  for (const name of derivedNames) {
    const rules = DERIVED_PARENT_RULES[name];
    if (!Array.isArray(rules) || rules.length === 0) {
      throw new Error(`${name} requires at least one authoritative parent rule.`);
    }
    for (const [index, rule] of rules.entries()) {
      assertUniqueNonemptyStrings(rule?.fields, `${name}.parentResolver[${index}].fields`);
      assertUniqueNonemptyStrings(rule?.collections, `${name}.parentResolver[${index}].collections`);
      if (rule.collections.includes('users') && rule.collections.length !== 1) {
        throw new Error(`${name} must not mix the membership-bound users parent with tenant collections.`);
      }
      for (const parentName of rule.collections) {
        const parent = COLLECTION_SCOPE_REGISTRY[parentName];
        const isTenantParent = parent?.category === COLLECTION_SCOPE_CATEGORY.TENANT
          || parent?.category === COLLECTION_SCOPE_CATEGORY.DERIVED_SCOPE;
        const isMembershipBoundUser = parentName === 'users'
          && parent?.category === COLLECTION_SCOPE_CATEGORY.SYSTEM;
        if (!parent || parent.shape !== COLLECTION_SHAPE.ARRAY || (!isTenantParent && !isMembershipBoundUser)) {
          throw new Error(`${name} has an invalid authoritative parent collection: ${parentName}.`);
        }
      }
    }
  }

  const visiting = new Set();
  const visited = new Set();
  function visit(name) {
    if (visiting.has(name)) throw new Error(`Derived parent registry contains a cycle at ${name}.`);
    if (visited.has(name)) return;
    visiting.add(name);
    for (const rule of DERIVED_PARENT_RULES[name]) {
      for (const parentName of rule.collections) {
        if (derivedNames.has(parentName)) visit(parentName);
      }
    }
    visiting.delete(name);
    visited.add(name);
  }
  for (const name of derivedNames) visit(name);
}

assertDerivedParentRegistry();

function getCollectionScopePolicy(name) {
  return COLLECTION_SCOPE_REGISTRY[String(name || '').trim()] || null;
}

function collectionsForCategory(category) {
  return GROUPS[category] || Object.freeze([]);
}

function isCategory(name, category) {
  return getCollectionScopePolicy(name)?.category === category;
}

module.exports = {
  ALL_APP_DATA_COLLECTIONS,
  COLLECTION_SCOPE_CATEGORY,
  COLLECTION_SCOPE_REGISTRY,
  COLLECTION_SHAPE,
  DERIVED_PARENT_RULES,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
  collectionsForCategory,
  getCollectionScopePolicy,
  isCategory,
};
