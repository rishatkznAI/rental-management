const COMPANY_ID = 'cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ';
const HEAD_OFFICE_ID = 'brn_VRNOM4ABOTHKRJYODGZSPVE3WPN6CGOJITLZBD2SCYWODKFF5NYQ';

function businessActor(userId, membershipId, roleTemplateKey, overrides = {}) {
  return {
    userId,
    action: 'CREATE_MEMBERSHIP',
    membershipId,
    companyId: COMPANY_ID,
    tenantId: COMPANY_ID,
    membershipRole: `${roleTemplateKey}:v1`,
    roleTemplateKey,
    roleTemplateVersion: 1,
    status: 'active',
    candidateForProductionMembership: true,
    ...overrides,
  };
}

function scopeRecord(collection, id) {
  return {
    collection,
    id,
    action: 'UPDATE_SCOPE',
    expectedBefore: { companyId: null, tenantId: null },
    companyId: COMPANY_ID,
    tenantId: COMPANY_ID,
    classification: 'PRODUCTION_BUSINESS_DATA',
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

// This is the fail-closed plan bundled into the application image. It is deliberately
// non-executable until a fresh non-SSH production preflight is reviewed and the
// authority/identityBootstrap section is replaced by an explicitly approved config.
module.exports = deepFreeze({
  planVersion: 1,
  planId: 'production-scope-remediation-2026-08-25-head-office-memberships-v4',
  sourceDbPath: '/data/app.sqlite',
  expected: {
    dbIdentity: {
      applicationId: 0,
      pageSize: 4096,
      schemaFingerprint: '58fcb559e6f8d2244222d5140e052d42ed4e17d95e32a22fcef1f3ce5b88a894',
      userVersion: 0,
    },
    identityCounts: {
      canonical_companies: [0],
      canonical_branches: [0],
      company_memberships: [0],
      membership_branch_access: [0],
      role_templates: [0],
      role_template_capabilities: [0],
      membership_capability_assignments: [0],
      authorization_audit_events: [0],
      identity_bootstrap_runs: [0],
    },
    collectionCounts: {
      counterparties: 2,
      counterparty_role_assignments: 2,
      clients: 1,
      client_objects: 3,
      users: 14,
    },
    collectionFingerprints: {
      counterparties: ['311d6c0f8c0b37c023e2e9810e7bb61a59549ec3a1cd0492b091d9860b3f9ac7'],
      counterparty_role_assignments: ['7839bf8adfb93e749717c96c79db990debb0f845b10bf9f3510b3b5af7268326'],
      clients: ['e59ded7d0b594aedc607567e2c1c8fc96f32e23ea4f2fbdd3737da7793610d59'],
      client_objects: ['6d040c797b0fa66e0068440bab390d4d44d2ff5277cbadb9f764dd9e7b1f66ad'],
      users: ['9fd6c109f529e85de72e3d4d079ecdfadf45bf1f4b39304f07039aa25f8a4c09'],
    },
  },
  authority: {
    status: 'PENDING_VERIFIED_PRODUCTION_DRY_RUN',
    companyId: COMPANY_ID,
    tenantId: COMPANY_ID,
    canonicalCompany: {
      canonicalIdentityKey: 'rentcore:company:v1|jurisdiction=RU|registry=INN|value=1660217548',
      jurisdiction: 'RU',
      registry: 'INN',
      registryValue: '1660217548',
      legalName: 'ОБЩЕСТВО С ОГРАНИЧЕННОЙ ОТВЕТСТВЕННОСТЬЮ "СКАЙТЕХ КОМПАНИ"',
      shortName: 'ООО "СКАЙТЕХ КОМПАНИ"',
      inn: '1660217548',
      kpp: '165501001',
      ogrn: '1141690077814',
      legalAddress: '420107, Республика Татарстан, г. Казань, ул. Островского, д. 107, помещ. 49',
      timezone: 'Europe/Moscow',
    },
    headOffice: {
      id: HEAD_OFFICE_ID,
      companyId: COMPANY_ID,
      displayName: 'Головной офис',
      timezone: 'Europe/Moscow',
      isHeadOffice: true,
      status: 'active',
    },
    identityBootstrap: null,
    reason: 'Fresh non-SSH production conflict scan, complete active-user disposition, coherent backup, and explicit Phase A approval are required.',
  },
  actorMappings: [
    businessActor(
      '1775756913074',
      'mbr_G2QDD6FEGGZ7TVGHUJQGJJM3JE4DM3HS43RNCDPUXXQ3BNZGAI7Q',
      'company-administrator',
      { name: 'Хабибрахманов Ришат Ринатович', companyWideBranchAuthority: true, branchIds: [] },
    ),
    businessActor(
      '1776673416137',
      'mbr_EYVSFKJBNRTLDU2ZTONKV5QCK37QB7FUARBUM6ORAHDUTMD5UJPA',
      'office-manager',
      { name: 'Мениса', companyWideBranchAuthority: false, branchIds: [HEAD_OFFICE_ID] },
    ),
    {
      userId: 'production-smoke-admin',
      action: 'UNRESOLVED',
      membershipId: null,
      companyId: null,
      tenantId: null,
      candidateForProductionMembership: false,
      recommendedDisposition: 'NO_MEMBERSHIP_PENDING_SMOKE_REDESIGN',
      reason: 'Known production smoke credential requires an explicit intentionally-unmapped approval.',
    },
    businessActor(
      '1787547467703',
      'mbr_S2S4CR7EHVLAAEXCFMBML6IUUPAA7V7RCRCPSPB5OEJVZFGINMEA',
      'rental-manager',
      { name: 'Айзат', companyWideBranchAuthority: false, branchIds: [HEAD_OFFICE_ID] },
    ),
  ],
  recordMappings: [
    scopeRecord('counterparties', 'CP-1787305873918-cb43be'),
    {
      collection: 'counterparties',
      id: 'CP-1787585239479-4a34e4',
      action: 'UNRESOLVED',
      classification: 'SMOKE_TEST_FIXTURE',
      reason: 'Known smoke fixture; Phase B cleanup is separately gated.',
    },
    scopeRecord('counterparty_role_assignments', 'CPRA-19e67e15a554df5b2d434852'),
    {
      collection: 'counterparty_role_assignments',
      id: 'CPRA-206c0cc4343e162cbfd7dcf6',
      action: 'UNRESOLVED',
      classification: 'SMOKE_TEST_FIXTURE',
      reason: 'Known smoke fixture; Phase B cleanup is separately gated.',
    },
    scopeRecord('clients', 'C-1787305873917-d5aa12'),
    {
      collection: 'client_objects',
      id: 'CO-1787567867426-2c27d0',
      action: 'UNRESOLVED',
      classification: 'SMOKE_TEST_FIXTURE_AND_ARCHIVED_HISTORICAL_ARTIFACT',
      reason: 'Known archived smoke fixture; Phase B cleanup is separately gated.',
    },
    scopeRecord('client_objects', 'CO-1787567881301-0301ec'),
    {
      collection: 'client_objects',
      id: 'CO-1787585252222-35e4d5',
      action: 'UNRESOLVED',
      classification: 'SMOKE_TEST_FIXTURE_AND_ARCHIVED_ORPHAN',
      reason: 'Known archived smoke orphan; Phase B cleanup is separately gated.',
    },
  ],
  relationMappings: [{
    collection: 'client_objects',
    id: 'CO-1787585252222-35e4d5',
    field: 'clientId',
    action: 'UNRESOLVED',
    before: 'C-1787585239478-5b4168',
    after: null,
    reason: 'Known smoke orphan relation; Phase B cleanup is separately gated.',
  }],
  backup: {
    verified: false,
    reference: null,
    sourceDbIdentity: null,
    timestamp: null,
    sizeBytes: null,
    sha256: null,
  },
  canonicalCompanyIdStrategy: {
    status: 'APPROVED',
    format: 'cmp_<base32(sha256(canonicalIdentityKey))>',
    encoding: 'RFC4648_BASE32_UPPERCASE_NO_PADDING',
    identity: { jurisdiction: 'RU', registry: 'INN', value: '1660217548' },
    canonicalIdentityKey: 'rentcore:company:v1|jurisdiction=RU|registry=INN|value=1660217548',
    sha256Hex: 'f9026198f378c197e6a565035b0299cac846c58ae97e6fa6209c2c3ca4e6c419',
    base32Digest: '7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ',
    companyId: COMPANY_ID,
    tenantId: COMPANY_ID,
  },
});
