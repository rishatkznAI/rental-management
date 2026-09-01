const { randomUUID } = require('node:crypto');
const { isDeepStrictEqual } = require('node:util');

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
const PLATFORM_DEFAULT_TENANT_OVERLAY_SET = new Set(
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
);

const CATALOG_ORIGIN_KINDS = Object.freeze({
  PLATFORM_DEFAULT: 'platform_default',
  TENANT_ENTRY: 'tenant_entry',
  TENANT_OVERRIDE: 'tenant_override',
});

// Callers cannot manufacture this authority from request data. Only trusted
// server code that imports the module can opt into platform-partition writes.
const TRUSTED_PLATFORM_CATALOG_AUTHORITY = Symbol('trusted-platform-catalog-authority');

const ACTIVE_STATUSES = new Set([
  'active',
  'enabled',
  'published',
  'активен',
  'активна',
  'активно',
]);
const INACTIVE_STATUSES = new Set([
  'inactive',
  'archived',
  'disabled',
  'deleted',
  'cancelled',
  'canceled',
  'неактивен',
  'неактивна',
  'архив',
  'архивный',
  'архивная',
]);
const OWNERSHIP_OR_LINK_FIELDS = Object.freeze([
  'companyId',
  'tenantId',
  'platformDefaultId',
]);
const CLIENT_RESERVED_FIELDS = Object.freeze([
  ...OWNERSHIP_OR_LINK_FIELDS,
  '_id',
  'physicalId',
  '_physicalId',
]);

class PlatformDefaultTenantOverlayError extends Error {
  constructor(code, message, status = 409, details = undefined) {
    super(message);
    this.name = 'PlatformDefaultTenantOverlayError';
    this.code = code;
    this.status = status;
    if (details !== undefined) this.details = details;
  }
}

function hasOwn(value, key) {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function text(value) {
  return String(value ?? '').trim();
}

function clone(value) {
  return structuredClone(value);
}

function isPlainRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function fail(code, message, status = 409, details) {
  throw new PlatformDefaultTenantOverlayError(code, message, status, details);
}

function isPlatformDefaultTenantOverlayCollection(collection) {
  return PLATFORM_DEFAULT_TENANT_OVERLAY_SET.has(text(collection));
}

function assertCollection(collection) {
  const normalized = text(collection);
  if (!PLATFORM_DEFAULT_TENANT_OVERLAY_SET.has(normalized)) {
    fail(
      'CATALOG_COLLECTION_NOT_ALLOWED',
      'Collection is not a platform-default/tenant-overlay catalog.',
      400,
      { collection: normalized || null },
    );
  }
  return normalized;
}

function exactRequiredString(value, field, details = {}) {
  if (typeof value !== 'string' || !value || value !== value.trim()) {
    fail(
      'CATALOG_IDENTIFIER_INVALID',
      `${field} must be a non-empty canonical string.`,
      409,
      { ...details, field },
    );
  }
  return value;
}

function assertTenantScope(scope) {
  const companyId = exactRequiredString(scope?.companyId, 'companyId');
  const tenantId = exactRequiredString(scope?.tenantId, 'tenantId');
  if (companyId !== tenantId) {
    fail(
      'CATALOG_ACTOR_SCOPE_INCOMPLETE',
      'Company and tenant actor scope must use the same canonical ID.',
      403,
    );
  }
  return Object.freeze({ companyId, tenantId });
}

function classifyStoredScope(record, { collection }) {
  const rawCompanyId = record.companyId;
  const rawTenantId = record.tenantId;
  const companyId = text(rawCompanyId);
  const tenantId = text(rawTenantId);

  if (!companyId && !tenantId) {
    return Object.freeze({ kind: 'platform_default' });
  }
  if (
    typeof rawCompanyId !== 'string'
    || typeof rawTenantId !== 'string'
    || rawCompanyId !== companyId
    || rawTenantId !== tenantId
    || companyId !== tenantId
  ) {
    fail(
      'CATALOG_STORED_SCOPE_INVALID',
      'Catalog row must be unscoped or have exact matching companyId and tenantId.',
      409,
      { collection },
    );
  }
  return Object.freeze({ kind: 'tenant', companyId, tenantId });
}

function classifyCatalogRecordActivity(record) {
  if (!isPlainRecord(record)) {
    fail('CATALOG_RECORD_SHAPE_INVALID', 'Catalog record must be a plain object.');
  }

  const activeSignals = [];
  const inactiveSignals = [];

  if (hasOwn(record, 'isActive')) {
    if (typeof record.isActive !== 'boolean') {
      fail(
        'CATALOG_ACTIVITY_AMBIGUOUS',
        'isActive must be boolean when present.',
        409,
        { field: 'isActive' },
      );
    }
    (record.isActive ? activeSignals : inactiveSignals).push('isActive');
  }

  for (const field of ['archived', 'isArchived']) {
    if (!hasOwn(record, field)) continue;
    if (typeof record[field] !== 'boolean') {
      fail(
        'CATALOG_ACTIVITY_AMBIGUOUS',
        `${field} must be boolean when present.`,
        409,
        { field },
      );
    }
    if (record[field]) inactiveSignals.push(field);
  }

  for (const field of ['archivedAt', 'deletedAt']) {
    if (!hasOwn(record, field) || record[field] === null || record[field] === '') continue;
    if (typeof record[field] !== 'string' || record[field] !== record[field].trim()) {
      fail(
        'CATALOG_ACTIVITY_AMBIGUOUS',
        `${field} must be null, empty, or a canonical non-empty string.`,
        409,
        { field },
      );
    }
    inactiveSignals.push(field);
  }

  if (hasOwn(record, 'status') && text(record.status)) {
    const status = text(record.status).toLowerCase();
    if (ACTIVE_STATUSES.has(status)) activeSignals.push('status');
    else if (INACTIVE_STATUSES.has(status)) inactiveSignals.push('status');
    else {
      fail(
        'CATALOG_ACTIVITY_AMBIGUOUS',
        'Unknown explicit catalog status cannot determine override activity safely.',
        409,
        { field: 'status' },
      );
    }
  }

  if (activeSignals.length > 0 && inactiveSignals.length > 0) {
    fail(
      'CATALOG_ACTIVITY_AMBIGUOUS',
      'Catalog activity and archive signals conflict.',
      409,
      { activeSignals, inactiveSignals },
    );
  }

  return Object.freeze({
    active: inactiveSignals.length === 0,
    activeSignals: Object.freeze(activeSignals),
    inactiveSignals: Object.freeze(inactiveSignals),
  });
}

function foreignPlatformDefaultFamily(catalogState, collection, platformDefaultId) {
  if (!catalogState || typeof catalogState !== 'object' || Array.isArray(catalogState)) return null;
  for (const candidateCollection of PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS) {
    if (candidateCollection === collection) continue;
    const candidateRecords = catalogState[candidateCollection];
    if (!Array.isArray(candidateRecords)) continue;
    const found = candidateRecords.some(record => (
      isPlainRecord(record)
      && text(record.id) === platformDefaultId
      && !text(record.companyId)
      && !text(record.tenantId)
    ));
    if (found) return candidateCollection;
  }
  return null;
}

function analyzeCatalogState({ collection, records, catalogState } = {}) {
  const normalizedCollection = assertCollection(collection);
  if (!Array.isArray(records)) {
    fail(
      'CATALOG_COLLECTION_SHAPE_INVALID',
      'Mixed catalog collection must be an array.',
      409,
      { collection: normalizedCollection },
    );
  }

  const byId = new Map();
  const defaults = [];
  const tenantEntries = [];
  const overrides = [];

  records.forEach((record, index) => {
    if (!isPlainRecord(record)) {
      fail(
        'CATALOG_RECORD_SHAPE_INVALID',
        'Catalog collection contains a non-object row.',
        409,
        { collection: normalizedCollection, index },
      );
    }
    if (hasOwn(record, 'catalogOrigin')) {
      fail(
        'CATALOG_COMPUTED_METADATA_PERSISTED',
        'catalogOrigin is computed and must never be persisted.',
        409,
        { collection: normalizedCollection, index },
      );
    }
    if (hasOwn(record, '_id') || hasOwn(record, 'physicalId') || hasOwn(record, '_physicalId')) {
      fail(
        'CATALOG_PHYSICAL_ID_AMBIGUOUS',
        'Catalog rows have exactly one physical identifier: id.',
        409,
        { collection: normalizedCollection, index },
      );
    }

    const id = exactRequiredString(record.id, 'id', {
      collection: normalizedCollection,
      index,
    });
    if (byId.has(id)) {
      fail(
        'CATALOG_PHYSICAL_ID_DUPLICATE',
        'Physical catalog IDs must be unique inside a catalog family.',
        409,
        { collection: normalizedCollection },
      );
    }

    const storedScope = classifyStoredScope(record, { collection: normalizedCollection });
    const linkPresent = hasOwn(record, 'platformDefaultId');
    if (storedScope.kind === 'platform_default') {
      if (linkPresent) {
        fail(
          'CATALOG_PLATFORM_DEFAULT_LINK_FORBIDDEN',
          'Platform defaults cannot themselves be overrides.',
          409,
          { collection: normalizedCollection, id },
        );
      }
      const descriptor = { record, id, storedScope, index };
      defaults.push(descriptor);
      byId.set(id, descriptor);
      return;
    }

    if (!linkPresent) {
      const descriptor = { record, id, storedScope, index, kind: 'tenant_entry' };
      tenantEntries.push(descriptor);
      byId.set(id, descriptor);
      return;
    }

    const platformDefaultId = exactRequiredString(record.platformDefaultId, 'platformDefaultId', {
      collection: normalizedCollection,
    });
    const activity = classifyCatalogRecordActivity(record);
    const descriptor = {
      record,
      id,
      storedScope,
      index,
      kind: 'tenant_override',
      platformDefaultId,
      activity,
    };
    overrides.push(descriptor);
    byId.set(id, descriptor);
  });

  const activeOverrideKeys = new Map();
  for (const descriptor of overrides) {
    const target = byId.get(descriptor.platformDefaultId);
    if (!target) {
      const foreignFamily = foreignPlatformDefaultFamily(
        catalogState,
        normalizedCollection,
        descriptor.platformDefaultId,
      );
      if (foreignFamily) {
        fail(
          'CATALOG_OVERRIDE_CROSS_FAMILY_REFERENCE',
          'platformDefaultId must reference a default in the same catalog family.',
          409,
          { collection: normalizedCollection },
        );
      }
      fail(
        'CATALOG_OVERRIDE_DEFAULT_NOT_FOUND',
        'platformDefaultId references no existing default in this catalog family.',
        409,
        { collection: normalizedCollection },
      );
    }
    if (target.storedScope.kind !== 'platform_default') {
      fail(
        'CATALOG_OVERRIDE_TARGET_NOT_PLATFORM_DEFAULT',
        'platformDefaultId cannot reference a tenant-owned row.',
        409,
        { collection: normalizedCollection },
      );
    }
    if (!descriptor.activity.active) continue;
    const key = `${descriptor.storedScope.tenantId}\u0000${descriptor.platformDefaultId}`;
    if (activeOverrideKeys.has(key)) {
      fail(
        'CATALOG_ACTIVE_OVERRIDE_DUPLICATE',
        'A tenant may have at most one active override for a platform default.',
        409,
        { collection: normalizedCollection },
      );
    }
    activeOverrideKeys.set(key, descriptor.id);
  }

  return {
    collection: normalizedCollection,
    records,
    byId,
    defaults,
    tenantEntries,
    overrides,
  };
}

function assertValidCatalogState(options) {
  const analysis = analyzeCatalogState(options);
  return Object.freeze({
    collection: analysis.collection,
    platformDefaultCount: analysis.defaults.length,
    tenantEntryCount: analysis.tenantEntries.length,
    tenantOverrideCount: analysis.overrides.length,
  });
}

function assertValidCatalogFamilyState(catalogState) {
  if (!catalogState || typeof catalogState !== 'object' || Array.isArray(catalogState)) {
    fail('CATALOG_FAMILY_STATE_INVALID', 'Catalog family state must be an object map.');
  }
  const result = {};
  for (const collection of PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS) {
    if (!hasOwn(catalogState, collection)) continue;
    result[collection] = assertValidCatalogState({
      collection,
      records: catalogState[collection],
      catalogState,
    });
  }
  return Object.freeze(result);
}

function withoutKeys(record, keys) {
  const result = clone(record);
  for (const key of keys) delete result[key];
  return result;
}

function storedBusinessFields(record) {
  return withoutKeys(record, [
    'id',
    '_id',
    'companyId',
    'tenantId',
    'platformDefaultId',
    'catalogOrigin',
    'physicalId',
    '_physicalId',
  ]);
}

function computedOrigin(kind, logicalId, extra = {}) {
  return Object.freeze({
    kind,
    logicalId,
    tenantMutable: kind !== CATALOG_ORIGIN_KINDS.PLATFORM_DEFAULT,
    ...extra,
  });
}

function projectPlatformDefault(descriptor) {
  const record = withoutKeys(descriptor.record, OWNERSHIP_OR_LINK_FIELDS);
  record.catalogOrigin = computedOrigin(CATALOG_ORIGIN_KINDS.PLATFORM_DEFAULT, descriptor.id);
  return record;
}

function projectTenantEntry(descriptor) {
  const record = withoutKeys(descriptor.record, OWNERSHIP_OR_LINK_FIELDS);
  record.catalogOrigin = computedOrigin(CATALOG_ORIGIN_KINDS.TENANT_ENTRY, descriptor.id);
  return record;
}

function projectTenantOverride(defaultDescriptor, overrideDescriptor) {
  const record = {
    ...storedBusinessFields(defaultDescriptor.record),
    ...storedBusinessFields(overrideDescriptor.record),
    id: defaultDescriptor.id,
  };
  record.catalogOrigin = computedOrigin(
    CATALOG_ORIGIN_KINDS.TENANT_OVERRIDE,
    defaultDescriptor.id,
    { platformDefaultId: defaultDescriptor.id },
  );
  return record;
}

function ownTenantRows(analysis, scope) {
  return {
    entries: analysis.tenantEntries.filter(item => item.storedScope.tenantId === scope.tenantId),
    overrides: analysis.overrides.filter(item => item.storedScope.tenantId === scope.tenantId),
  };
}

function readEffectiveCatalog({ collection, records, scope, catalogState } = {}) {
  const trustedScope = assertTenantScope(scope);
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  const own = ownTenantRows(analysis, trustedScope);
  const activeOverrides = new Map(
    own.overrides
      .filter(item => item.activity.active)
      .map(item => [item.platformDefaultId, item]),
  );

  const effectiveDefaults = analysis.defaults.map(defaultDescriptor => {
    const override = activeOverrides.get(defaultDescriptor.id);
    return override
      ? projectTenantOverride(defaultDescriptor, override)
      : projectPlatformDefault(defaultDescriptor);
  });
  return [
    ...effectiveDefaults,
    ...own.entries.map(projectTenantEntry),
  ];
}

function readEffectiveCatalogRecord({ collection, records, scope, id, catalogState } = {}) {
  const logicalId = exactRequiredString(id, 'id', { collection: text(collection) });
  return readEffectiveCatalog({ collection, records, scope, catalogState })
    .find(record => record.id === logicalId) || null;
}

function findMutablePhysicalDescriptor(analysis, scope, physicalId) {
  const id = exactRequiredString(physicalId, 'physicalId', { collection: analysis.collection });
  const descriptor = analysis.byId.get(id);
  if (!descriptor) {
    fail(
      'CATALOG_RECORD_NOT_FOUND',
      'Catalog record was not found.',
      404,
      { collection: analysis.collection },
    );
  }
  if (descriptor.storedScope.kind === 'platform_default') {
    fail(
      'CATALOG_PLATFORM_DEFAULT_MUTATION_DENIED',
      'Tenant actors cannot mutate platform defaults.',
      403,
      { collection: analysis.collection },
    );
  }
  if (descriptor.storedScope.tenantId !== scope.tenantId) {
    fail(
      'CATALOG_CROSS_TENANT_ACCESS_DENIED',
      'Catalog record is outside the trusted tenant scope.',
      403,
      { collection: analysis.collection },
    );
  }
  return descriptor;
}

function readTenantPhysicalCatalogRecord({
  collection,
  records,
  scope,
  physicalId,
  catalogState,
} = {}) {
  const trustedScope = assertTenantScope(scope);
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  const descriptor = findMutablePhysicalDescriptor(analysis, trustedScope, physicalId);
  return clone(descriptor.record);
}

function assertClientPayload(input, { allowId = false, allowComputedOrigin = false } = {}) {
  if (!isPlainRecord(input)) {
    fail('CATALOG_RECORD_SHAPE_INVALID', 'Catalog payload must be a plain object.', 400);
  }
  const forbidden = CLIENT_RESERVED_FIELDS.filter(field => hasOwn(input, field));
  if (!allowId && hasOwn(input, 'id')) forbidden.push('id');
  if (!allowComputedOrigin && hasOwn(input, 'catalogOrigin')) forbidden.push('catalogOrigin');
  if (forbidden.length > 0) {
    fail(
      'CATALOG_CLIENT_RESERVED_FIELD_DENIED',
      'Ownership, linkage, physical identity, and computed metadata are server-controlled.',
      409,
      { fields: [...new Set(forbidden)].sort() },
    );
  }
  return clone(input);
}

function stateWithCollection(catalogState, collection, records) {
  return catalogState && typeof catalogState === 'object' && !Array.isArray(catalogState)
    ? { ...catalogState, [collection]: records }
    : undefined;
}

function validateNextState(collection, records, catalogState) {
  analyzeCatalogState({
    collection,
    records,
    catalogState: stateWithCollection(catalogState, collection, records),
  });
  return records;
}

function generatePhysicalId(generateId, { collection, kind, occupiedIds }) {
  const prefix = kind === 'tenant_override' ? 'OVR' : 'TEN';
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const candidate = generateId
      ? generateId(prefix, { collection, kind, attempt })
      : `${prefix}-${randomUUID()}`;
    const id = exactRequiredString(candidate, 'generatedId', { collection, kind });
    if (!occupiedIds.has(id)) {
      occupiedIds.add(id);
      return id;
    }
  }
  fail(
    'CATALOG_PHYSICAL_ID_COLLISION',
    'Could not allocate a unique physical catalog ID.',
    409,
    { collection, kind },
  );
}

function createTenantCatalogEntry({
  collection,
  records,
  scope,
  input,
  generateId,
  catalogState,
} = {}) {
  const trustedScope = assertTenantScope(scope);
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  const payload = assertClientPayload(input);
  const id = generatePhysicalId(generateId, {
    collection: analysis.collection,
    kind: 'tenant_entry',
    occupiedIds: new Set(analysis.byId.keys()),
  });
  const record = {
    ...payload,
    id,
    companyId: trustedScope.companyId,
    tenantId: trustedScope.tenantId,
  };
  const nextRecords = validateNextState(
    analysis.collection,
    [...records, record],
    catalogState,
  );
  return { records: clone(nextRecords), record: clone(record) };
}

function createTenantCatalogOverride({
  collection,
  records,
  scope,
  platformDefaultId,
  input,
  generateId,
  catalogState,
} = {}) {
  const trustedScope = assertTenantScope(scope);
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  const defaultId = exactRequiredString(platformDefaultId, 'platformDefaultId', {
    collection: analysis.collection,
  });
  const target = analysis.byId.get(defaultId);
  if (!target) {
    const foreignFamily = foreignPlatformDefaultFamily(catalogState, analysis.collection, defaultId);
    fail(
      foreignFamily
        ? 'CATALOG_OVERRIDE_CROSS_FAMILY_REFERENCE'
        : 'CATALOG_OVERRIDE_DEFAULT_NOT_FOUND',
      foreignFamily
        ? 'platformDefaultId must reference a default in the same catalog family.'
        : 'platformDefaultId references no existing default in this catalog family.',
      409,
      foreignFamily ? { foreignFamily } : undefined,
    );
  }
  if (target.storedScope.kind !== 'platform_default') {
    fail(
      'CATALOG_OVERRIDE_TARGET_NOT_PLATFORM_DEFAULT',
      'A tenant override can target only an unscoped platform default.',
      409,
      { collection: analysis.collection },
    );
  }
  const existing = analysis.overrides.find(item => (
    item.storedScope.tenantId === trustedScope.tenantId
    && item.platformDefaultId === defaultId
    && item.activity.active
  ));
  if (existing) {
    fail(
      'CATALOG_ACTIVE_OVERRIDE_DUPLICATE',
      'This tenant already has an active override for the platform default.',
      409,
      { collection: analysis.collection, platformDefaultId: defaultId },
    );
  }

  const payload = assertClientPayload(input);
  const id = generatePhysicalId(generateId, {
    collection: analysis.collection,
    kind: 'tenant_override',
    occupiedIds: new Set(analysis.byId.keys()),
  });
  const record = {
    ...storedBusinessFields(target.record),
    ...payload,
    id,
    companyId: trustedScope.companyId,
    tenantId: trustedScope.tenantId,
    platformDefaultId: defaultId,
  };
  if (!classifyCatalogRecordActivity(record).active) {
    fail(
      'CATALOG_OVERRIDE_MUST_BE_ACTIVE',
      'A newly created override must be active; archive an existing override explicitly.',
    );
  }
  const nextRecords = validateNextState(
    analysis.collection,
    [...records, record],
    catalogState,
  );
  return { records: clone(nextRecords), record: clone(record) };
}

function updateTenantCatalogRecord({
  collection,
  records,
  scope,
  physicalId,
  patch,
  catalogState,
} = {}) {
  const trustedScope = assertTenantScope(scope);
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  const descriptor = findMutablePhysicalDescriptor(analysis, trustedScope, physicalId);
  const payload = assertClientPayload(patch);
  const record = {
    ...descriptor.record,
    ...payload,
    id: descriptor.id,
    companyId: trustedScope.companyId,
    tenantId: trustedScope.tenantId,
  };
  if (descriptor.kind === 'tenant_override') {
    record.platformDefaultId = descriptor.platformDefaultId;
  } else {
    delete record.platformDefaultId;
  }
  const next = records.map(item => item === descriptor.record ? record : item);
  validateNextState(analysis.collection, next, catalogState);
  return { records: clone(next), record: clone(record) };
}

function updateEffectiveTenantCatalogRecord({
  collection,
  records,
  scope,
  logicalId,
  patch,
  generateId,
  catalogState,
} = {}) {
  const trustedScope = assertTenantScope(scope);
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  const id = exactRequiredString(logicalId, 'logicalId', { collection: analysis.collection });
  const target = analysis.byId.get(id);
  if (target?.storedScope.kind === 'platform_default') {
    const activeOverride = analysis.overrides.find(item => (
      item.storedScope.tenantId === trustedScope.tenantId
      && item.platformDefaultId === id
      && item.activity.active
    ));
    if (activeOverride) {
      return updateTenantCatalogRecord({
        collection: analysis.collection,
        records,
        scope: trustedScope,
        physicalId: activeOverride.id,
        patch,
        catalogState,
      });
    }
    return createTenantCatalogOverride({
      collection: analysis.collection,
      records,
      scope: trustedScope,
      platformDefaultId: id,
      input: patch,
      generateId,
      catalogState,
    });
  }
  if (target?.kind === 'tenant_entry' && target.storedScope.tenantId === trustedScope.tenantId) {
    return updateTenantCatalogRecord({
      collection: analysis.collection,
      records,
      scope: trustedScope,
      physicalId: id,
      patch,
      catalogState,
    });
  }
  fail(
    'CATALOG_LOGICAL_RECORD_NOT_FOUND',
    'No tenant-visible catalog record has this logical ID.',
    404,
    { collection: analysis.collection },
  );
}

function deleteTenantCatalogRecord({
  collection,
  records,
  scope,
  physicalId,
  catalogState,
} = {}) {
  const trustedScope = assertTenantScope(scope);
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  const descriptor = findMutablePhysicalDescriptor(analysis, trustedScope, physicalId);
  const next = records.filter(item => item !== descriptor.record);
  validateNextState(analysis.collection, next, catalogState);
  return { records: clone(next), deleted: clone(descriptor.record) };
}

function deleteEffectiveTenantCatalogRecord({
  collection,
  records,
  scope,
  logicalId,
  catalogState,
} = {}) {
  const trustedScope = assertTenantScope(scope);
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  const id = exactRequiredString(logicalId, 'logicalId', { collection: analysis.collection });
  const target = analysis.byId.get(id);
  if (target?.storedScope.kind === 'platform_default') {
    const activeOverride = analysis.overrides.find(item => (
      item.storedScope.tenantId === trustedScope.tenantId
      && item.platformDefaultId === id
      && item.activity.active
    ));
    if (!activeOverride) {
      fail(
        'CATALOG_PLATFORM_DEFAULT_MUTATION_DENIED',
        'Deleting a logical platform default is forbidden.',
        403,
        { collection: analysis.collection },
      );
    }
    return deleteTenantCatalogRecord({
      collection: analysis.collection,
      records,
      scope: trustedScope,
      physicalId: activeOverride.id,
      catalogState,
    });
  }
  if (target?.kind === 'tenant_entry' && target.storedScope.tenantId === trustedScope.tenantId) {
    return deleteTenantCatalogRecord({
      collection: analysis.collection,
      records,
      scope: trustedScope,
      physicalId: id,
      catalogState,
    });
  }
  fail(
    'CATALOG_LOGICAL_RECORD_NOT_FOUND',
    'No tenant-visible catalog record has this logical ID.',
    404,
    { collection: analysis.collection },
  );
}

function archiveTenantCatalogRecord({
  collection,
  records,
  scope,
  physicalId,
  archivedAt,
  catalogState,
} = {}) {
  const timestamp = exactRequiredString(archivedAt, 'archivedAt', { collection: text(collection) });
  const trustedScope = assertTenantScope(scope);
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  const descriptor = findMutablePhysicalDescriptor(analysis, trustedScope, physicalId);
  const patch = { isActive: false, archivedAt: timestamp };
  if (hasOwn(descriptor.record, 'status')) patch.status = 'archived';
  if (hasOwn(descriptor.record, 'archived')) patch.archived = true;
  if (hasOwn(descriptor.record, 'isArchived')) patch.isArchived = true;
  return updateTenantCatalogRecord({
    collection: analysis.collection,
    records,
    scope: trustedScope,
    physicalId: descriptor.id,
    patch,
    catalogState,
  });
}

function revertTenantCatalogOverride({
  collection,
  records,
  scope,
  platformDefaultId,
  mode = 'delete',
  archivedAt,
  catalogState,
} = {}) {
  const trustedScope = assertTenantScope(scope);
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  const defaultId = exactRequiredString(platformDefaultId, 'platformDefaultId', {
    collection: analysis.collection,
  });
  const activeOverride = analysis.overrides.find(item => (
    item.storedScope.tenantId === trustedScope.tenantId
    && item.platformDefaultId === defaultId
    && item.activity.active
  ));
  if (!activeOverride) {
    fail(
      'CATALOG_ACTIVE_OVERRIDE_NOT_FOUND',
      'No active tenant override exists for this platform default.',
      404,
      { collection: analysis.collection, platformDefaultId: defaultId },
    );
  }
  if (mode === 'delete') {
    return deleteTenantCatalogRecord({
      collection: analysis.collection,
      records,
      scope: trustedScope,
      physicalId: activeOverride.id,
      catalogState,
    });
  }
  if (mode === 'archive') {
    return archiveTenantCatalogRecord({
      collection: analysis.collection,
      records,
      scope: trustedScope,
      physicalId: activeOverride.id,
      archivedAt,
      catalogState,
    });
  }
  fail('CATALOG_REVERT_MODE_INVALID', 'Override revert mode must be delete or archive.', 400);
}

function normalizeBulkInputRecord(input, expectedOrigin, collection) {
  const payload = assertClientPayload(input, { allowId: true, allowComputedOrigin: true });
  const id = exactRequiredString(payload.id, 'id', { collection });
  if (hasOwn(payload, 'catalogOrigin')) {
    if (!expectedOrigin || !isDeepStrictEqual(payload.catalogOrigin, expectedOrigin)) {
      fail(
        'CATALOG_ORIGIN_METADATA_SPOOFING_DENIED',
        'Computed catalog origin metadata does not match the trusted effective view.',
        409,
        { collection, id },
      );
    }
    delete payload.catalogOrigin;
  }
  return payload;
}

function replaceTenantCatalogPartition({
  collection,
  records,
  scope,
  input,
  generateId,
  catalogState,
} = {}) {
  const trustedScope = assertTenantScope(scope);
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  if (!Array.isArray(input)) {
    fail(
      'CATALOG_COLLECTION_SHAPE_INVALID',
      'Tenant catalog bulk replace input must be an effective array.',
      400,
      { collection: analysis.collection },
    );
  }

  const effective = readEffectiveCatalog({
    collection: analysis.collection,
    records,
    scope: trustedScope,
    catalogState,
  });
  const effectiveById = new Map(effective.map(item => [item.id, item]));
  const defaultsById = new Map(analysis.defaults.map(item => [item.id, item]));
  const own = ownTenantRows(analysis, trustedScope);
  const ownEntriesById = new Map(own.entries.map(item => [item.id, item]));
  const activeOverridesByDefaultId = new Map(
    own.overrides
      .filter(item => item.activity.active)
      .map(item => [item.platformDefaultId, item]),
  );
  const occupiedIds = new Set(analysis.byId.keys());
  const seenLogicalIds = new Set();
  const nextTenantRows = [];

  for (const inputRecord of input) {
    const candidateId = text(inputRecord?.id);
    const expected = effectiveById.get(candidateId);
    const payload = normalizeBulkInputRecord(
      inputRecord,
      expected?.catalogOrigin,
      analysis.collection,
    );
    const id = payload.id;
    if (seenLogicalIds.has(id)) {
      fail(
        'CATALOG_LOGICAL_ID_DUPLICATE',
        'Tenant bulk replace contains a duplicate logical ID.',
        409,
        { collection: analysis.collection, id },
      );
    }
    seenLogicalIds.add(id);

    const defaultDescriptor = defaultsById.get(id);
    if (defaultDescriptor) {
      const incomingBusiness = storedBusinessFields(payload);
      const defaultBusiness = storedBusinessFields(defaultDescriptor.record);
      if (isDeepStrictEqual(incomingBusiness, defaultBusiness)) {
        continue;
      }
      const existingOverride = activeOverridesByDefaultId.get(id);
      const physicalId = existingOverride?.id || generatePhysicalId(generateId, {
        collection: analysis.collection,
        kind: 'tenant_override',
        occupiedIds,
      });
      const record = {
        ...defaultBusiness,
        ...incomingBusiness,
        id: physicalId,
        companyId: trustedScope.companyId,
        tenantId: trustedScope.tenantId,
        platformDefaultId: id,
      };
      if (!classifyCatalogRecordActivity(record).active) {
        fail(
          'CATALOG_OVERRIDE_MUST_BE_ACTIVE',
          'Bulk replace cannot hide a default with an inactive override.',
          409,
          { collection: analysis.collection, platformDefaultId: id },
        );
      }
      nextTenantRows.push(record);
      continue;
    }

    const existingEntry = ownEntriesById.get(id);
    if (existingEntry) {
      nextTenantRows.push({
        ...storedBusinessFields(payload),
        id,
        companyId: trustedScope.companyId,
        tenantId: trustedScope.tenantId,
      });
      continue;
    }

    if (analysis.byId.has(id)) {
      fail(
        'CATALOG_PHYSICAL_ID_NOT_PUBLIC',
        'Override and foreign physical IDs cannot be used as logical IDs.',
        403,
        { collection: analysis.collection },
      );
    }
    occupiedIds.add(id);
    nextTenantRows.push({
      ...storedBusinessFields(payload),
      id,
      companyId: trustedScope.companyId,
      tenantId: trustedScope.tenantId,
    });
  }

  const preserved = records.filter(record => {
    const descriptor = analysis.byId.get(record.id);
    if (descriptor.storedScope.kind === 'platform_default') return true;
    if (descriptor.storedScope.tenantId !== trustedScope.tenantId) return true;
    return descriptor.kind === 'tenant_override' && !descriptor.activity.active;
  });
  const next = [...preserved, ...nextTenantRows];
  validateNextState(analysis.collection, next, catalogState);
  return { records: clone(next), effective: readEffectiveCatalog({
    collection: analysis.collection,
    records: next,
    scope: trustedScope,
    catalogState: stateWithCollection(catalogState, analysis.collection, next),
  }) };
}

function replacePlatformCatalogDefaults({
  collection,
  records,
  input,
  authority,
  catalogState,
} = {}) {
  if (authority !== TRUSTED_PLATFORM_CATALOG_AUTHORITY) {
    fail(
      'CATALOG_PLATFORM_AUTHORITY_REQUIRED',
      'Only trusted platform/system authority may replace platform defaults.',
      403,
      { collection: text(collection) },
    );
  }
  const analysis = analyzeCatalogState({ collection, records, catalogState });
  if (!Array.isArray(input)) {
    fail(
      'CATALOG_COLLECTION_SHAPE_INVALID',
      'Platform default replacement input must be an array.',
      400,
      { collection: analysis.collection },
    );
  }

  const incomingDefaults = input.map(record => {
    const payload = assertClientPayload(record, { allowId: true });
    exactRequiredString(payload.id, 'id', { collection: analysis.collection });
    return payload;
  });
  const incomingIds = new Set();
  for (const record of incomingDefaults) {
    if (incomingIds.has(record.id)) {
      fail(
        'CATALOG_PHYSICAL_ID_DUPLICATE',
        'Platform default replacement contains duplicate IDs.',
        409,
        { collection: analysis.collection, id: record.id },
      );
    }
    incomingIds.add(record.id);
  }

  for (const override of analysis.overrides) {
    if (!incomingIds.has(override.platformDefaultId)) {
      fail(
        'CATALOG_REFERENCED_PLATFORM_DEFAULT_DELETE_DENIED',
        'A platform default referenced by a tenant override cannot be deleted.',
        409,
        {
          collection: analysis.collection,
          platformDefaultId: override.platformDefaultId,
        },
      );
    }
  }

  const tenantRows = analysis.records
    .filter(record => text(record.companyId) || text(record.tenantId))
    .map(clone);
  const next = [...incomingDefaults.map(clone), ...tenantRows];
  validateNextState(analysis.collection, next, catalogState);
  return { records: clone(next), platformDefaults: clone(incomingDefaults) };
}

module.exports = {
  CATALOG_ORIGIN_KINDS,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
  TRUSTED_PLATFORM_CATALOG_AUTHORITY,
  PlatformDefaultTenantOverlayError,
  archiveTenantCatalogRecord,
  assertValidCatalogFamilyState,
  assertValidCatalogState,
  classifyCatalogRecordActivity,
  createTenantCatalogEntry,
  createTenantCatalogOverride,
  deleteEffectiveTenantCatalogRecord,
  deleteTenantCatalogRecord,
  isPlatformDefaultTenantOverlayCollection,
  readEffectiveCatalog,
  readEffectiveCatalogRecord,
  readTenantPhysicalCatalogRecord,
  replacePlatformCatalogDefaults,
  replaceTenantCatalogPartition,
  revertTenantCatalogOverride,
  updateEffectiveTenantCatalogRecord,
  updateTenantCatalogRecord,
};
