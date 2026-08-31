import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  ALL_APP_DATA_COLLECTIONS,
  COLLECTION_SCOPE_CATEGORY,
  COLLECTION_SCOPE_REGISTRY,
  COLLECTION_SHAPE,
  collectionsForCategory,
} = require('../server/lib/app-data-scope-registry.js');

// Deliberately independent of db.JSON_COLLECTIONS and registry construction.
// This reviewed fixture makes a newly added storage collection fail until its
// tenant semantics and shape receive an explicit test disposition.
const EXPECTED_BY_CATEGORY = Object.freeze({
  TENANT: Object.freeze([
    'equipment', 'rentals', 'gantt_rentals', 'service', 'warranty_claims',
    'counterparties', 'documents', 'finance_accounts', 'company_expenses',
    'leasing_contracts', 'payroll_periods', 'crm_deals', 'crm_activities',
    'deliveries', 'owners', 'planner_items', 'service_vehicles',
    'manager_activity', 'mechanics', 'public_site_cms',
  ]),
  PLATFORM_DEFAULT_TENANT_OVERLAY: Object.freeze([
    'knowledge_base_modules', 'service_works', 'spare_parts',
    'service_route_norms', 'service_work_catalog', 'spare_parts_catalog',
    'service_work_names', 'spare_part_names',
  ]),
  GLOBAL_REFERENCE: Object.freeze([]),
  SYSTEM: Object.freeze(['users', 'bot_sessions']),
  TENANT_TECHNICAL: Object.freeze([
    'inline_relation_idempotency', 'rental_create_idempotency',
    'knowledge_base_progress', 'app_settings', 'bot_users', 'bot_activity',
    'bot_notifications', 'snapshot',
  ]),
  LEGACY_HISTORY: Object.freeze([
    'audit_log', 'audit_logs', 'client_history', 'client_object_history',
    'domain_history', 'service_audit_log',
  ]),
  DERIVED_SCOPE: Object.freeze([
    'equipment_finance', 'equipment_downtimes', 'rental_change_requests',
    'counterparty_role_assignments', 'supplier_profiles', 'contractor_profiles',
    'clients', 'client_objects', 'client_contracts', 'gsm_devices', 'gsm_packets',
    'gsm_commands', 'mechanic_documents', 'payments', 'payment_allocations',
    'debt_collection_plans', 'debt_collection_actions',
    'receivable_payment_plans', 'finance_operations',
    'leasing_payment_schedule', 'payroll_profiles', 'payroll_records',
    'payroll_adjustments', 'payroll_audit_events', 'delivery_carriers',
    'shipping_photos', 'equipment_operation_sessions', 'service_field_trips',
    'repair_work_items', 'repair_part_items', 'vehicle_trips',
    'management_action_states',
  ]),
});

test('mixed catalogue policy is explicit and partition-aware', () => {
  for (const name of EXPECTED_BY_CATEGORY.PLATFORM_DEFAULT_TENANT_OVERLAY) {
    const policy = COLLECTION_SCOPE_REGISTRY[name];
    assert.equal(policy.readPolicy, 'PLATFORM_DEFAULT_PLUS_EXACT_TENANT_OVERLAY', name);
    assert.equal(policy.writeAuthority, 'PLATFORM_SYSTEM_OR_TRUSTED_TENANT_PARTITION', name);
    assert.equal(policy.mutationPolicy, 'PARTITIONED_MUTABLE', name);
  }
});

test('reviewed app_data inventory independently covers all 76 collection semantics', () => {
  const reviewed = Object.values(EXPECTED_BY_CATEGORY).flat();
  assert.equal(reviewed.length, 76);
  assert.equal(new Set(reviewed).size, reviewed.length);
  assert.deepEqual([...ALL_APP_DATA_COLLECTIONS].sort(), [...reviewed].sort());
  assert.deepEqual(Object.keys(COLLECTION_SCOPE_REGISTRY).sort(), [...reviewed].sort());

  for (const [category, expected] of Object.entries(EXPECTED_BY_CATEGORY)) {
    assert.deepEqual(
      [...collectionsForCategory(COLLECTION_SCOPE_CATEGORY[category])].sort(),
      [...expected].sort(),
      category,
    );
    for (const name of expected) {
      assert.equal(COLLECTION_SCOPE_REGISTRY[name].category, category, name);
    }
  }
});

test('reviewed root shapes match the storage contract', () => {
  const mapCollections = new Set(['bot_sessions', 'bot_users']);
  const singletonCollections = new Set(['snapshot', 'public_site_cms']);
  const shapeCounts = { ARRAY: 0, MAP: 0, SINGLETON: 0 };

  for (const name of ALL_APP_DATA_COLLECTIONS) {
    const expectedShape = mapCollections.has(name)
      ? COLLECTION_SHAPE.MAP
      : singletonCollections.has(name)
        ? COLLECTION_SHAPE.SINGLETON
        : COLLECTION_SHAPE.ARRAY;
    assert.equal(COLLECTION_SCOPE_REGISTRY[name].shape, expectedShape, name);
    shapeCounts[expectedShape] += 1;
  }
  assert.deepEqual(shapeCounts, { ARRAY: 72, MAP: 2, SINGLETON: 2 });
});

test('public_site_cms is an exact tenant-owned mutable singleton', () => {
  assert.deepEqual(COLLECTION_SCOPE_REGISTRY.public_site_cms, {
    name: 'public_site_cms',
    category: COLLECTION_SCOPE_CATEGORY.TENANT,
    shape: COLLECTION_SHAPE.SINGLETON,
    readPolicy: 'EXACT_TENANT_SCOPE',
    writeAuthority: 'TRUSTED_TENANT_ACTOR',
    mutationPolicy: 'MUTABLE',
    parentResolver: null,
  });
});
