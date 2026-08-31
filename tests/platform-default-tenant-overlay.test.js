import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  CATALOG_ORIGIN_KINDS,
  PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS,
  TRUSTED_PLATFORM_CATALOG_AUTHORITY,
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
} = require('../server/lib/platform-default-tenant-overlay.js');

const COLLECTION = 'service_works';
const OTHER_COLLECTION = 'spare_parts';
const SCOPE_A = Object.freeze({ companyId: 'COMPANY-A', tenantId: 'COMPANY-A' });
const SCOPE_B = Object.freeze({ companyId: 'COMPANY-B', tenantId: 'COMPANY-B' });
const NOW = '2026-08-31T10:00:00.000Z';

function platformDefault(id, overrides = {}) {
  return {
    id,
    name: `Platform ${id}`,
    isActive: true,
    ratePerHour: 100,
    ...overrides,
  };
}

function tenantEntry(scope, id, overrides = {}) {
  return {
    id,
    name: `Tenant ${id}`,
    isActive: true,
    ...overrides,
    companyId: scope.companyId,
    tenantId: scope.tenantId,
  };
}

function tenantOverride(scope, id, platformDefaultId, overrides = {}) {
  return {
    id,
    name: `Override ${id}`,
    isActive: true,
    ...overrides,
    companyId: scope.companyId,
    tenantId: scope.tenantId,
    platformDefaultId,
  };
}

function assertCode(fn, code) {
  assert.throws(fn, error => {
    assert.equal(error?.code, code);
    return true;
  });
}

function sequenceGenerator(...ids) {
  let index = 0;
  return () => ids[index++];
}

test('the mixed catalog policy is allowlisted to exactly the eight approved families', () => {
  assert.deepEqual(PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS, [
    'knowledge_base_modules',
    'service_works',
    'spare_parts',
    'service_route_norms',
    'service_work_catalog',
    'spare_parts_catalog',
    'service_work_names',
    'spare_part_names',
  ]);
  for (const collection of PLATFORM_DEFAULT_TENANT_OVERLAY_COLLECTIONS) {
    assert.equal(isPlatformDefaultTenantOverlayCollection(collection), true);
    assert.deepEqual(
      readEffectiveCatalog({
        collection,
        records: [platformDefault(`${collection}-DEFAULT`)],
        scope: SCOPE_A,
      }).map(item => item.id),
      [`${collection}-DEFAULT`],
    );
  }
  assert.equal(isPlatformDefaultTenantOverlayCollection('clients'), false);
  assertCode(
    () => assertValidCatalogState({ collection: 'clients', records: [] }),
    'CATALOG_COLLECTION_NOT_ALLOWED',
  );
});

test('effective read combines defaults with own tenant entries and projects an override under the logical default ID', () => {
  const records = [
    platformDefault('DEFAULT-1', { name: 'Platform name', category: 'Base category' }),
    platformDefault('DEFAULT-2'),
    tenantOverride(SCOPE_A, 'OVERRIDE-A-PHYSICAL', 'DEFAULT-1', {
      name: 'Company A name',
      ratePerHour: 725,
    }),
    tenantEntry(SCOPE_A, 'TENANT-A-ONLY'),
    tenantOverride(SCOPE_B, 'OVERRIDE-B-PHYSICAL', 'DEFAULT-1', {
      name: 'Company B name',
      ratePerHour: 900,
    }),
    tenantEntry(SCOPE_B, 'TENANT-B-ONLY'),
  ];

  const effectiveA = readEffectiveCatalog({ collection: COLLECTION, records, scope: SCOPE_A });
  assert.deepEqual(effectiveA.map(item => item.id), ['DEFAULT-1', 'DEFAULT-2', 'TENANT-A-ONLY']);
  assert.equal(effectiveA[0].name, 'Company A name');
  assert.equal(effectiveA[0].category, 'Base category');
  assert.equal(effectiveA[0].ratePerHour, 725);
  assert.deepEqual(effectiveA[0].catalogOrigin, {
    kind: CATALOG_ORIGIN_KINDS.TENANT_OVERRIDE,
    logicalId: 'DEFAULT-1',
    tenantMutable: true,
    platformDefaultId: 'DEFAULT-1',
  });
  assert.equal(Object.hasOwn(effectiveA[0], 'platformDefaultId'), false);
  assert.equal(Object.hasOwn(effectiveA[0], 'companyId'), false);
  assert.equal(JSON.stringify(effectiveA).includes('OVERRIDE-A-PHYSICAL'), false);
  assert.equal(JSON.stringify(effectiveA).includes('COMPANY-B'), false);

  const effectiveB = readEffectiveCatalog({ collection: COLLECTION, records, scope: SCOPE_B });
  assert.equal(effectiveB.find(item => item.id === 'DEFAULT-1').name, 'Company B name');
  assert.ok(effectiveB.some(item => item.id === 'TENANT-B-ONLY'));
  assert.ok(!effectiveB.some(item => item.id === 'TENANT-A-ONLY'));

  assert.equal(
    readEffectiveCatalogRecord({
      collection: COLLECTION,
      records,
      scope: SCOPE_A,
      id: 'OVERRIDE-A-PHYSICAL',
    }),
    null,
    'physical override IDs are not public logical IDs',
  );
  assert.equal(
    readEffectiveCatalogRecord({
      collection: COLLECTION,
      records,
      scope: SCOPE_A,
      id: 'DEFAULT-1',
    }).name,
    'Company A name',
    'relationship consumers resolve the effective record by logical ID',
  );
});

test('platformDefaultId is same-family, non-dangling, and can target only an unscoped default', () => {
  assertCode(
    () => assertValidCatalogState({
      collection: COLLECTION,
      records: [tenantOverride(SCOPE_A, 'OVERRIDE', 'MISSING')],
    }),
    'CATALOG_OVERRIDE_DEFAULT_NOT_FOUND',
  );

  const catalogState = {
    [COLLECTION]: [tenantOverride(SCOPE_A, 'OVERRIDE', 'PART-DEFAULT')],
    [OTHER_COLLECTION]: [platformDefault('PART-DEFAULT')],
  };
  assertCode(
    () => assertValidCatalogFamilyState(catalogState),
    'CATALOG_OVERRIDE_CROSS_FAMILY_REFERENCE',
  );
  assertCode(
    () => createTenantCatalogOverride({
      collection: COLLECTION,
      records: [],
      scope: SCOPE_A,
      platformDefaultId: 'PART-DEFAULT',
      input: { name: 'Cross-family attack' },
      catalogState,
    }),
    'CATALOG_OVERRIDE_CROSS_FAMILY_REFERENCE',
  );

  const tenantTarget = tenantEntry(SCOPE_A, 'TENANT-TARGET');
  assertCode(
    () => assertValidCatalogState({
      collection: COLLECTION,
      records: [tenantTarget, tenantOverride(SCOPE_A, 'OVERRIDE', 'TENANT-TARGET')],
    }),
    'CATALOG_OVERRIDE_TARGET_NOT_PLATFORM_DEFAULT',
  );
  assertCode(
    () => createTenantCatalogOverride({
      collection: COLLECTION,
      records: [tenantTarget],
      scope: SCOPE_A,
      platformDefaultId: 'TENANT-TARGET',
      input: { name: 'Tenant target attack' },
    }),
    'CATALOG_OVERRIDE_TARGET_NOT_PLATFORM_DEFAULT',
  );
});

test('physical IDs are unique within a family and duplicate active overrides fail closed', () => {
  assertCode(
    () => assertValidCatalogState({
      collection: COLLECTION,
      records: [platformDefault('SAME'), tenantEntry(SCOPE_A, 'SAME')],
    }),
    'CATALOG_PHYSICAL_ID_DUPLICATE',
  );

  assertCode(
    () => assertValidCatalogState({
      collection: COLLECTION,
      records: [
        platformDefault('DEFAULT'),
        tenantOverride(SCOPE_A, 'OVERRIDE-1', 'DEFAULT'),
        tenantOverride(SCOPE_A, 'OVERRIDE-2', 'DEFAULT'),
      ],
    }),
    'CATALOG_ACTIVE_OVERRIDE_DUPLICATE',
  );

  assert.doesNotThrow(() => assertValidCatalogState({
    collection: COLLECTION,
    records: [
      platformDefault('DEFAULT'),
      tenantOverride(SCOPE_A, 'OVERRIDE-ACTIVE', 'DEFAULT'),
      tenantOverride(SCOPE_A, 'OVERRIDE-ARCHIVED', 'DEFAULT', {
        isActive: false,
        archivedAt: NOW,
      }),
      tenantOverride(SCOPE_B, 'OVERRIDE-B', 'DEFAULT'),
    ],
  }));
});

test('activity classification is backward compatible but rejects ambiguous override state', () => {
  assert.equal(classifyCatalogRecordActivity({}).active, true);
  assert.equal(classifyCatalogRecordActivity({ isActive: true }).active, true);
  assert.equal(classifyCatalogRecordActivity({ isActive: false }).active, false);
  assert.equal(classifyCatalogRecordActivity({ archivedAt: NOW }).active, false);
  assert.equal(classifyCatalogRecordActivity({ status: 'archived' }).active, false);
  assertCode(
    () => classifyCatalogRecordActivity({ isActive: true, archivedAt: NOW }),
    'CATALOG_ACTIVITY_AMBIGUOUS',
  );
  assertCode(
    () => classifyCatalogRecordActivity({ status: 'custom-maybe-active' }),
    'CATALOG_ACTIVITY_AMBIGUOUS',
  );
});

test('explicit tenant entry and override creation assign exact scope without implicit linkage', () => {
  let records = [platformDefault('DEFAULT', { description: 'Copied base' })];
  const standalone = createTenantCatalogEntry({
    collection: COLLECTION,
    records,
    scope: SCOPE_A,
    input: { name: 'Tenant-only work', isActive: true },
    generateId: sequenceGenerator('TENANT-PHYSICAL'),
  });
  records = standalone.records;
  assert.deepEqual(standalone.record, {
    id: 'TENANT-PHYSICAL',
    name: 'Tenant-only work',
    isActive: true,
    companyId: 'COMPANY-A',
    tenantId: 'COMPANY-A',
  });
  assert.equal(Object.hasOwn(standalone.record, 'platformDefaultId'), false);

  const override = createTenantCatalogOverride({
    collection: COLLECTION,
    records,
    scope: SCOPE_A,
    platformDefaultId: 'DEFAULT',
    input: { name: 'Tenant override', ratePerHour: 777 },
    generateId: sequenceGenerator('OVERRIDE-PHYSICAL'),
  });
  assert.equal(override.record.id, 'OVERRIDE-PHYSICAL');
  assert.equal(override.record.platformDefaultId, 'DEFAULT');
  assert.equal(override.record.companyId, 'COMPANY-A');
  assert.equal(override.record.description, 'Copied base');
  assert.equal(override.record.ratePerHour, 777);
  assert.equal(override.records[0].name, 'Platform DEFAULT', 'source default is unchanged');

  for (const forbiddenPayload of [
    { name: 'Spoof', companyId: 'COMPANY-B' },
    { name: 'Promote', tenantId: '' },
    { name: 'Link', platformDefaultId: 'DEFAULT' },
    { id: 'CLIENT-ID', name: 'Client physical ID' },
  ]) {
    assertCode(
      () => createTenantCatalogEntry({
        collection: COLLECTION,
        records,
        scope: SCOPE_A,
        input: forbiddenPayload,
      }),
      'CATALOG_CLIENT_RESERVED_FIELD_DENIED',
    );
  }
});

test('logical update creates or updates an override without changing the public default ID', () => {
  let records = [platformDefault('DEFAULT', { name: 'Platform value', category: 'Diagnostics' })];
  const created = updateEffectiveTenantCatalogRecord({
    collection: COLLECTION,
    records,
    scope: SCOPE_A,
    logicalId: 'DEFAULT',
    patch: { name: 'A override' },
    generateId: sequenceGenerator('OVERRIDE-PHYSICAL'),
  });
  records = created.records;
  assert.equal(created.record.id, 'OVERRIDE-PHYSICAL');
  assert.equal(created.record.platformDefaultId, 'DEFAULT');
  assert.equal(readEffectiveCatalogRecord({
    collection: COLLECTION,
    records,
    scope: SCOPE_A,
    id: 'DEFAULT',
  }).name, 'A override');

  const updated = updateEffectiveTenantCatalogRecord({
    collection: COLLECTION,
    records,
    scope: SCOPE_A,
    logicalId: 'DEFAULT',
    patch: { ratePerHour: 555 },
  });
  assert.equal(updated.record.id, 'OVERRIDE-PHYSICAL');
  assert.equal(updated.records.length, 2);
  assert.equal(updated.record.ratePerHour, 555);

  assertCode(
    () => updateTenantCatalogRecord({
      collection: COLLECTION,
      records,
      scope: SCOPE_A,
      physicalId: 'DEFAULT',
      patch: { name: 'Mutate platform' },
    }),
    'CATALOG_PLATFORM_DEFAULT_MUTATION_DENIED',
  );
  assertCode(
    () => updateTenantCatalogRecord({
      collection: COLLECTION,
      records,
      scope: SCOPE_A,
      physicalId: 'OVERRIDE-PHYSICAL',
      patch: { platformDefaultId: 'OTHER' },
    }),
    'CATALOG_CLIENT_RESERVED_FIELD_DENIED',
  );
  assertCode(
    () => updateTenantCatalogRecord({
      collection: COLLECTION,
      records,
      scope: SCOPE_A,
      physicalId: 'OVERRIDE-PHYSICAL',
      patch: { companyId: 'COMPANY-B' },
    }),
    'CATALOG_CLIENT_RESERVED_FIELD_DENIED',
  );
});

test('archive or delete of an override restores the platform default without mutating it', () => {
  const initial = [
    platformDefault('DEFAULT', { name: 'Platform value' }),
    tenantOverride(SCOPE_A, 'OVERRIDE-PHYSICAL', 'DEFAULT', { name: 'Tenant value' }),
  ];
  const originalDefault = structuredClone(initial[0]);

  const archived = archiveTenantCatalogRecord({
    collection: COLLECTION,
    records: initial,
    scope: SCOPE_A,
    physicalId: 'OVERRIDE-PHYSICAL',
    archivedAt: NOW,
  });
  assert.deepEqual(archived.records[0], originalDefault);
  assert.equal(readEffectiveCatalogRecord({
    collection: COLLECTION,
    records: archived.records,
    scope: SCOPE_A,
    id: 'DEFAULT',
  }).name, 'Platform value');
  assert.equal(archived.record.isActive, false);
  assert.equal(archived.record.archivedAt, NOW);

  const deleted = deleteTenantCatalogRecord({
    collection: COLLECTION,
    records: initial,
    scope: SCOPE_A,
    physicalId: 'OVERRIDE-PHYSICAL',
  });
  assert.deepEqual(deleted.records, [originalDefault]);
  assert.equal(readEffectiveCatalogRecord({
    collection: COLLECTION,
    records: deleted.records,
    scope: SCOPE_A,
    id: 'DEFAULT',
  }).name, 'Platform value');

  const reverted = revertTenantCatalogOverride({
    collection: COLLECTION,
    records: initial,
    scope: SCOPE_A,
    platformDefaultId: 'DEFAULT',
    mode: 'delete',
  });
  assert.deepEqual(reverted.records, [originalDefault]);

  assertCode(
    () => deleteEffectiveTenantCatalogRecord({
      collection: COLLECTION,
      records: [originalDefault],
      scope: SCOPE_A,
      logicalId: 'DEFAULT',
    }),
    'CATALOG_PLATFORM_DEFAULT_MUTATION_DENIED',
  );
});

test('cross-tenant and direct physical-ID access fail closed', () => {
  const records = [
    platformDefault('DEFAULT'),
    tenantOverride(SCOPE_A, 'OVERRIDE-A-PHYSICAL', 'DEFAULT'),
    tenantEntry(SCOPE_A, 'TENANT-A'),
    tenantEntry(SCOPE_B, 'TENANT-B'),
  ];

  assert.equal(readEffectiveCatalogRecord({
    collection: COLLECTION,
    records,
    scope: SCOPE_B,
    id: 'OVERRIDE-A-PHYSICAL',
  }), null);
  assert.equal(readEffectiveCatalogRecord({
    collection: COLLECTION,
    records,
    scope: SCOPE_A,
    id: 'TENANT-B',
  }), null);
  assert.equal(readTenantPhysicalCatalogRecord({
    collection: COLLECTION,
    records,
    scope: SCOPE_A,
    physicalId: 'OVERRIDE-A-PHYSICAL',
  }).platformDefaultId, 'DEFAULT');

  assertCode(
    () => readTenantPhysicalCatalogRecord({
      collection: COLLECTION,
      records,
      scope: SCOPE_B,
      physicalId: 'OVERRIDE-A-PHYSICAL',
    }),
    'CATALOG_CROSS_TENANT_ACCESS_DENIED',
  );
  assertCode(
    () => updateTenantCatalogRecord({
      collection: COLLECTION,
      records,
      scope: SCOPE_A,
      physicalId: 'TENANT-B',
      patch: { name: 'Cross-tenant mutation' },
    }),
    'CATALOG_CROSS_TENANT_ACCESS_DENIED',
  );
  assertCode(
    () => deleteTenantCatalogRecord({
      collection: COLLECTION,
      records,
      scope: SCOPE_A,
      physicalId: 'DEFAULT',
    }),
    'CATALOG_PLATFORM_DEFAULT_MUTATION_DENIED',
  );
});

test('tenant bulk replace preserves platform and foreign partitions and uses logical IDs for overrides', () => {
  const foreign = tenantEntry(SCOPE_B, 'TENANT-B', { marker: 'preserve-byte-for-byte' });
  const inactiveHistory = tenantOverride(SCOPE_A, 'OVERRIDE-OLD', 'DEFAULT-1', {
    name: 'Old archived override',
    isActive: false,
    archivedAt: '2026-08-01T00:00:00.000Z',
  });
  const records = [
    platformDefault('DEFAULT-1', { name: 'Platform one' }),
    platformDefault('DEFAULT-2', { name: 'Platform two' }),
    tenantOverride(SCOPE_A, 'OVERRIDE-CURRENT', 'DEFAULT-1', { name: 'Current override' }),
    inactiveHistory,
    tenantEntry(SCOPE_A, 'TENANT-REMOVE'),
    foreign,
  ];
  const current = readEffectiveCatalog({ collection: COLLECTION, records, scope: SCOPE_A });
  const defaultOne = current.find(item => item.id === 'DEFAULT-1');

  const replaced = replaceTenantCatalogPartition({
    collection: COLLECTION,
    records,
    scope: SCOPE_A,
    input: [
      { ...defaultOne, name: 'Bulk override' },
      { id: 'IMPORTED-TENANT-ENTRY', name: 'Imported entry', isActive: true },
    ],
  });
  assert.deepEqual(
    replaced.records.filter(item => !item.companyId).map(item => item.id),
    ['DEFAULT-1', 'DEFAULT-2'],
    'omitted platform defaults are never erased',
  );
  assert.deepEqual(replaced.records.find(item => item.id === 'TENANT-B'), foreign);
  assert.deepEqual(replaced.records.find(item => item.id === 'OVERRIDE-OLD'), inactiveHistory);
  assert.equal(replaced.records.some(item => item.id === 'TENANT-REMOVE'), false);
  assert.equal(
    replaced.records.find(item => item.id === 'OVERRIDE-CURRENT').platformDefaultId,
    'DEFAULT-1',
  );
  assert.equal(
    replaced.effective.find(item => item.id === 'DEFAULT-1').name,
    'Bulk override',
  );
  const imported = replaced.records.find(item => item.id === 'IMPORTED-TENANT-ENTRY');
  assert.equal(imported.companyId, 'COMPANY-A');
  assert.equal(Object.hasOwn(imported, 'platformDefaultId'), false);

  const fallbackInput = replaced.effective
    .filter(item => item.id === 'DEFAULT-1')
    .map(item => ({
      ...platformDefault('DEFAULT-1', { name: 'Platform one' }),
      catalogOrigin: item.catalogOrigin,
    }));
  const reverted = replaceTenantCatalogPartition({
    collection: COLLECTION,
    records: replaced.records,
    scope: SCOPE_A,
    input: fallbackInput,
  });
  assert.equal(reverted.records.some(item => item.id === 'OVERRIDE-CURRENT'), false);
  assert.equal(reverted.effective.find(item => item.id === 'DEFAULT-1').name, 'Platform one');
  assert.ok(reverted.effective.some(item => item.id === 'DEFAULT-2'));
});

test('bulk/import cannot spoof scope, linkage, origin, or use a hidden physical override ID', () => {
  const records = [
    platformDefault('DEFAULT'),
    tenantOverride(SCOPE_A, 'OVERRIDE-PHYSICAL', 'DEFAULT'),
  ];
  for (const input of [
    [{ id: 'NEW', name: 'Scope spoof', companyId: 'COMPANY-B' }],
    [{ id: 'NEW', name: 'Link spoof', platformDefaultId: 'DEFAULT' }],
  ]) {
    assertCode(
      () => replaceTenantCatalogPartition({
        collection: COLLECTION,
        records,
        scope: SCOPE_A,
        input,
      }),
      'CATALOG_CLIENT_RESERVED_FIELD_DENIED',
    );
  }
  assertCode(
    () => replaceTenantCatalogPartition({
      collection: COLLECTION,
      records,
      scope: SCOPE_A,
      input: [{
        id: 'DEFAULT',
        name: 'Spoof metadata',
        catalogOrigin: { kind: 'tenant_entry', logicalId: 'DEFAULT', tenantMutable: true },
      }],
    }),
    'CATALOG_ORIGIN_METADATA_SPOOFING_DENIED',
  );
  assertCode(
    () => replaceTenantCatalogPartition({
      collection: COLLECTION,
      records,
      scope: SCOPE_A,
      input: [{ id: 'OVERRIDE-PHYSICAL', name: 'Physical ID attack' }],
    }),
    'CATALOG_PHYSICAL_ID_NOT_PUBLIC',
  );
});

test('platform replacement requires trusted authority, preserves tenant rows, and cannot delete referenced defaults', () => {
  const tenantRows = [
    tenantOverride(SCOPE_A, 'OVERRIDE-PHYSICAL', 'DEFAULT', { name: 'Tenant value' }),
    tenantEntry(SCOPE_B, 'TENANT-B'),
  ];
  const records = [platformDefault('DEFAULT', { name: 'Platform old' }), ...tenantRows];

  assertCode(
    () => replacePlatformCatalogDefaults({
      collection: COLLECTION,
      records,
      input: [platformDefault('DEFAULT', { name: 'Platform new' })],
      authority: true,
    }),
    'CATALOG_PLATFORM_AUTHORITY_REQUIRED',
  );
  assertCode(
    () => replacePlatformCatalogDefaults({
      collection: COLLECTION,
      records,
      input: [],
      authority: TRUSTED_PLATFORM_CATALOG_AUTHORITY,
    }),
    'CATALOG_REFERENCED_PLATFORM_DEFAULT_DELETE_DENIED',
  );

  const replaced = replacePlatformCatalogDefaults({
    collection: COLLECTION,
    records,
    input: [
      platformDefault('DEFAULT', { name: 'Platform new', platformVersion: 2 }),
      platformDefault('DEFAULT-NEW'),
    ],
    authority: TRUSTED_PLATFORM_CATALOG_AUTHORITY,
  });
  assert.deepEqual(replaced.records.filter(item => item.companyId), tenantRows);
  assert.equal(
    readEffectiveCatalogRecord({
      collection: COLLECTION,
      records: replaced.records,
      scope: SCOPE_A,
      id: 'DEFAULT',
    }).name,
    'Tenant value',
    'platform update does not overwrite the tenant override',
  );
  assert.equal(
    replaced.records.filter(item => item.platformDefaultId === 'DEFAULT').length,
    1,
    'platform update does not clone defaults into tenants',
  );
});

test('raw fail-closed validation rejects partial scope, scope elevation, and persisted computed metadata', () => {
  assertCode(
    () => assertValidCatalogState({
      collection: COLLECTION,
      records: [{ id: 'PARTIAL', companyId: 'COMPANY-A' }],
    }),
    'CATALOG_STORED_SCOPE_INVALID',
  );
  assertCode(
    () => assertValidCatalogState({
      collection: COLLECTION,
      records: [{
        id: 'MISMATCH',
        companyId: 'COMPANY-A',
        tenantId: 'COMPANY-B',
      }],
    }),
    'CATALOG_STORED_SCOPE_INVALID',
  );
  assertCode(
    () => assertValidCatalogState({
      collection: COLLECTION,
      records: [{
        ...platformDefault('DEFAULT'),
        platformDefaultId: 'DEFAULT-2',
      }],
    }),
    'CATALOG_PLATFORM_DEFAULT_LINK_FORBIDDEN',
  );
  assertCode(
    () => assertValidCatalogState({
      collection: COLLECTION,
      records: [{
        ...platformDefault('DEFAULT'),
        catalogOrigin: { kind: 'platform_default' },
      }],
    }),
    'CATALOG_COMPUTED_METADATA_PERSISTED',
  );
});
