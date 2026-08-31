const { AsyncLocalStorage } = require('node:async_hooks');
const {
  ActorScopeError,
  assertCompleteActorScope,
  assignTrustedScope,
  filterRecordsByActorScope,
} = require('./trusted-actor-scope');
const { COMPANY_MEMBERSHIPS_TABLE } = require('./platform-identity-schema');

// Every business collection in app_data is tenant-owned. System-wide collections
// are limited to platform identities, login sessions, and the single public-site
// snapshot shared by every visitor.
const TENANT_OWNED_ARRAY_COLLECTIONS = Object.freeze([
  'equipment',
  'equipment_finance',
  'equipment_downtimes',
  'rentals',
  'gantt_rentals',
  'rental_change_requests',
  'service',
  'warranty_claims',
  'counterparties',
  'counterparty_role_assignments',
  'supplier_profiles',
  'contractor_profiles',
  'clients',
  'client_objects',
  'client_contracts',
  'inline_relation_idempotency',
  'rental_create_idempotency',
  'knowledge_base_modules',
  'knowledge_base_progress',
  'app_settings',
  'gsm_devices',
  'gsm_packets',
  'gsm_commands',
  'documents',
  'mechanic_documents',
  'payments',
  'payment_allocations',
  'debt_collection_plans',
  'debt_collection_actions',
  'receivable_payment_plans',
  'finance_accounts',
  'finance_operations',
  'company_expenses',
  'leasing_contracts',
  'leasing_payment_schedule',
  'payroll_profiles',
  'payroll_periods',
  'payroll_records',
  'payroll_adjustments',
  'payroll_audit_events',
  'crm_deals',
  'crm_activities',
  'deliveries',
  'delivery_carriers',
  'shipping_photos',
  'equipment_operation_sessions',
  'owners',
  'mechanics',
  'service_works',
  'spare_parts',
  'service_route_norms',
  'service_field_trips',
  'repair_work_items',
  'repair_part_items',
  'service_audit_log',
  'service_work_catalog',
  'spare_parts_catalog',
  'service_work_names',
  'spare_part_names',
  'planner_items',
  'service_vehicles',
  'vehicle_trips',
  'bot_activity',
  'manager_activity',
  'bot_notifications',
  'audit_log',
  'audit_logs',
]);

const TENANT_OWNED_ARRAY_SET = new Set(TENANT_OWNED_ARRAY_COLLECTIONS);
const TENANT_OWNED_MAP_COLLECTIONS = Object.freeze([
  'bot_users',
]);
const TENANT_OWNED_MAP_SET = new Set(TENANT_OWNED_MAP_COLLECTIONS);
const TENANT_OWNED_SINGLETON_COLLECTIONS = Object.freeze(['snapshot']);
const TENANT_OWNED_SINGLETON_SET = new Set(TENANT_OWNED_SINGLETON_COLLECTIONS);
const SYSTEM_GLOBAL_COLLECTIONS = Object.freeze(['users', 'bot_sessions', 'public_site_cms']);
const SYSTEM_GLOBAL_SET = new Set(SYSTEM_GLOBAL_COLLECTIONS);
const TENANT_SINGLETON_ENVELOPE = '__tenantScopedValues';
const tenantContext = new AsyncLocalStorage();

class TenantDataBoundaryError extends Error {
  constructor(code, message, status = 403, details = undefined) {
    super(message);
    this.name = 'TenantDataBoundaryError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function text(value) {
  return String(value ?? '').trim();
}

function isTenantOwnedCollection(name) {
  const collection = text(name);
  return TENANT_OWNED_ARRAY_SET.has(collection)
    || TENANT_OWNED_MAP_SET.has(collection)
    || TENANT_OWNED_SINGLETON_SET.has(collection);
}

function runWithTenantActorScope(scope, operation) {
  const actorScope = assertCompleteActorScope(scope);
  return tenantContext.run(Object.freeze({ kind: 'tenant_actor', actorScope }), operation);
}

function runWithDeniedTenantScope(operation) {
  return tenantContext.run(Object.freeze({ kind: 'tenant_denied' }), operation);
}

function currentTenantContext() {
  return tenantContext.getStore() || null;
}

function scopeMatches(record, scope) {
  return text(record?.companyId) === scope.companyId
    && text(record?.tenantId) === scope.tenantId;
}

function assertIncomingScope(record, scope, collection) {
  for (const field of ['companyId', 'tenantId']) {
    if (!Object.prototype.hasOwnProperty.call(record || {}, field)) continue;
    const supplied = text(record?.[field]);
    if (supplied && supplied !== scope[field]) {
      throw new TenantDataBoundaryError(
        'TENANT_SCOPE_SPOOFING_DENIED',
        'Record ownership does not match trusted actor scope.',
        403,
        { collection, field },
      );
    }
  }
}

function stableRecordId(record) {
  return text(record?.id || record?._id);
}

function mergeTenantArray(collection, rawValue, nextValue, scope) {
  if (!Array.isArray(nextValue)) {
    throw new TenantDataBoundaryError(
      'TENANT_COLLECTION_SHAPE_INVALID',
      `Tenant-owned collection ${collection} must be an array.`,
      409,
    );
  }
  const raw = Array.isArray(rawValue) ? rawValue : [];
  const outsideScope = raw.filter(record => !scopeMatches(record, scope));
  const outsideIds = new Set(outsideScope.map(stableRecordId).filter(Boolean));
  const incomingIds = new Set();
  const scoped = nextValue.map(record => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TenantDataBoundaryError(
        'TENANT_RECORD_SHAPE_INVALID',
        `Tenant-owned collection ${collection} contains an invalid record.`,
        409,
      );
    }
    assertIncomingScope(record, scope, collection);
    const id = stableRecordId(record);
    if (id && (outsideIds.has(id) || incomingIds.has(id))) {
      throw new TenantDataBoundaryError(
        'TENANT_RECORD_ID_COLLISION',
        'Record identifier is unavailable.',
        409,
        { collection },
      );
    }
    if (id) incomingIds.add(id);
    return assignTrustedScope(record, scope);
  });
  return [...outsideScope, ...scoped];
}

function filterTenantMap(rawValue, scope) {
  if (!rawValue || typeof rawValue !== 'object' || Array.isArray(rawValue)) return {};
  return Object.fromEntries(Object.entries(rawValue).filter(([, value]) => scopeMatches(value, scope)));
}

function mergeTenantMap(collection, rawValue, nextValue, scope) {
  if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
    throw new TenantDataBoundaryError(
      'TENANT_COLLECTION_SHAPE_INVALID',
      `Tenant-owned collection ${collection} must be an object map.`,
      409,
    );
  }
  const raw = rawValue && typeof rawValue === 'object' && !Array.isArray(rawValue) ? rawValue : {};
  const outside = Object.fromEntries(Object.entries(raw).filter(([, value]) => !scopeMatches(value, scope)));
  const scoped = {};
  for (const [key, value] of Object.entries(nextValue)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new TenantDataBoundaryError(
        'TENANT_RECORD_SHAPE_INVALID',
        `Tenant-owned map ${collection} contains an invalid record.`,
        409,
      );
    }
    if (Object.prototype.hasOwnProperty.call(outside, key)) {
      throw new TenantDataBoundaryError(
        'TENANT_RECORD_ID_COLLISION',
        'Record identifier is unavailable.',
        409,
        { collection },
      );
    }
    assertIncomingScope(value, scope, collection);
    scoped[key] = assignTrustedScope(value, scope);
  }
  return { ...outside, ...scoped };
}

function readTenantSingleton(rawValue, scope) {
  const envelope = rawValue?.[TENANT_SINGLETON_ENVELOPE];
  const entry = envelope && typeof envelope === 'object' ? envelope[scope.companyId] : null;
  return scopeMatches(entry, scope) ? entry.value : null;
}

function mergeTenantSingleton(collection, rawValue, nextValue, scope) {
  if (!nextValue || typeof nextValue !== 'object' || Array.isArray(nextValue)) {
    throw new TenantDataBoundaryError(
      'TENANT_COLLECTION_SHAPE_INVALID',
      `Tenant-owned singleton ${collection} must be an object.`,
      409,
    );
  }
  const existingEnvelope = rawValue?.[TENANT_SINGLETON_ENVELOPE];
  const envelope = existingEnvelope && typeof existingEnvelope === 'object' && !Array.isArray(existingEnvelope)
    ? existingEnvelope
    : {};
  return {
    [TENANT_SINGLETON_ENVELOPE]: {
      ...envelope,
      [scope.companyId]: {
        companyId: scope.companyId,
        tenantId: scope.tenantId,
        value: nextValue,
      },
    },
  };
}

function createTenantDataBoundary({
  db,
  readRawData,
  writeRawData,
  writeRawDataBatch,
  assertRelationships = () => {},
} = {}) {
  if (!db || typeof db.prepare !== 'function') throw new TypeError('Tenant data boundary requires SQLite.');
  if (typeof readRawData !== 'function' || typeof writeRawData !== 'function') {
    throw new TypeError('Tenant data boundary requires raw storage functions.');
  }

  const activeMembershipsForCompany = db.prepare(`
    SELECT principalId
    FROM ${COMPANY_MEMBERSHIPS_TABLE}
    WHERE companyId = ? AND status = 'active'
      AND principalId IN (
        SELECT principalId
        FROM ${COMPANY_MEMBERSHIPS_TABLE}
        WHERE status = 'active'
        GROUP BY principalId
        HAVING COUNT(*) = 1
      )
    ORDER BY principalId
  `);

  function companyPrincipalIds(scope) {
    return new Set(activeMembershipsForCompany.all(scope.companyId).map(row => text(row.principalId)).filter(Boolean));
  }

  function readUsers(scope) {
    const allowed = companyPrincipalIds(scope);
    return (Array.isArray(readRawData('users')) ? readRawData('users') : [])
      .filter(user => allowed.has(text(user?.id)));
  }

  function readData(collection) {
    const name = text(collection);
    const context = currentTenantContext();
    const raw = readRawData(name);
    if (!context) return raw;
    if (context.kind === 'tenant_denied') {
      if (name === 'users' || isTenantOwnedCollection(name)) {
        if (TENANT_OWNED_MAP_SET.has(name)) return {};
        if (TENANT_OWNED_SINGLETON_SET.has(name)) return null;
        return [];
      }
      return name === 'bot_sessions' ? raw : null;
    }
    const scope = context.actorScope;
    if (name === 'users') return readUsers(scope);
    if (TENANT_OWNED_ARRAY_SET.has(name)) return filterRecordsByActorScope(raw, scope);
    if (TENANT_OWNED_MAP_SET.has(name)) return filterTenantMap(raw, scope);
    if (TENANT_OWNED_SINGLETON_SET.has(name)) return readTenantSingleton(raw, scope);
    if (SYSTEM_GLOBAL_SET.has(name)) return raw;
    return null;
  }

  function mergeUsers(rawValue, nextValue, scope) {
    if (!Array.isArray(nextValue)) {
      throw new TenantDataBoundaryError('USER_DIRECTORY_SHAPE_INVALID', 'User directory must be an array.', 409);
    }
    const raw = Array.isArray(rawValue) ? rawValue : [];
    const allowed = companyPrincipalIds(scope);
    const currentIds = new Set(raw.map(user => text(user?.id)).filter(id => allowed.has(id)));
    const nextIds = new Set();
    for (const user of nextValue) {
      const id = text(user?.id);
      if (!id || !allowed.has(id) || nextIds.has(id)) {
        throw new TenantDataBoundaryError(
          'USER_MEMBERSHIP_WORKFLOW_REQUIRED',
          'User creation, deletion, or cross-company mutation requires the Membership lifecycle.',
          409,
        );
      }
      nextIds.add(id);
    }
    if (currentIds.size !== nextIds.size || [...currentIds].some(id => !nextIds.has(id))) {
      throw new TenantDataBoundaryError(
        'USER_MEMBERSHIP_WORKFLOW_REQUIRED',
        'User creation, deletion, or cross-company mutation requires the Membership lifecycle.',
        409,
      );
    }
    const nextById = new Map(nextValue.map(user => [text(user?.id), user]));
    return raw.map(user => nextById.get(text(user?.id)) || user);
  }

  function prepareEntries(entries, scope) {
    const trusted = assertCompleteActorScope(scope);
    const prepared = [];
    for (const entry of entries || []) {
      const name = text(entry?.name);
      if (!name) throw new TenantDataBoundaryError('TENANT_COLLECTION_REQUIRED', 'Collection name is required.', 409);
      const raw = readRawData(name);
      let value = entry.value;
      if (name === 'users') value = mergeUsers(raw, value, trusted);
      else if (TENANT_OWNED_ARRAY_SET.has(name)) value = mergeTenantArray(name, raw, value, trusted);
      else if (TENANT_OWNED_MAP_SET.has(name)) value = mergeTenantMap(name, raw, value, trusted);
      else if (TENANT_OWNED_SINGLETON_SET.has(name)) value = mergeTenantSingleton(name, raw, value, trusted);
      else if (!SYSTEM_GLOBAL_SET.has(name)) {
        throw new TenantDataBoundaryError(
          'TENANT_COLLECTION_UNCLASSIFIED',
          'The requested data collection has no tenant security classification.',
          403,
        );
      }
      prepared.push({ name, value });
    }
    assertRelationships(prepared, {
      actorScope: trusted,
      readRawData,
      companyPrincipalIds: () => companyPrincipalIds(trusted),
    });
    return prepared;
  }

  function writeData(collection, value) {
    const context = currentTenantContext();
    if (!context) return writeRawData(collection, value);
    if (text(collection) === 'bot_sessions') return writeRawData(collection, value);
    if (context.kind !== 'tenant_actor') {
      throw new ActorScopeError('ACTOR_SCOPE_INCOMPLETE', 'Trusted company/tenant scope is required.', 403);
    }
    const [entry] = prepareEntries([{ name: collection, value }], context.actorScope);
    return writeRawData(entry.name, entry.value);
  }

  function writeDataBatch(entries) {
    const context = currentTenantContext();
    if (!context) {
      if (typeof writeRawDataBatch === 'function') return writeRawDataBatch(entries);
      for (const entry of entries || []) writeRawData(entry.name, entry.value);
      return undefined;
    }
    if ((entries || []).every(entry => text(entry?.name) === 'bot_sessions')) {
      if (typeof writeRawDataBatch === 'function') return writeRawDataBatch(entries);
      for (const entry of entries || []) writeRawData(entry.name, entry.value);
      return undefined;
    }
    if (context.kind !== 'tenant_actor') {
      throw new ActorScopeError('ACTOR_SCOPE_INCOMPLETE', 'Trusted company/tenant scope is required.', 403);
    }
    const prepared = prepareEntries(entries, context.actorScope);
    if (typeof writeRawDataBatch === 'function') return writeRawDataBatch(prepared);
    for (const entry of prepared) writeRawData(entry.name, entry.value);
    return undefined;
  }

  return Object.freeze({
    companyPrincipalIds,
    readData,
    writeData,
    writeDataBatch,
  });
}

module.exports = {
  SYSTEM_GLOBAL_COLLECTIONS,
  TENANT_OWNED_ARRAY_COLLECTIONS,
  TENANT_OWNED_MAP_COLLECTIONS,
  TENANT_OWNED_SINGLETON_COLLECTIONS,
  TenantDataBoundaryError,
  createTenantDataBoundary,
  currentTenantContext,
  isTenantOwnedCollection,
  runWithDeniedTenantScope,
  runWithTenantActorScope,
};
