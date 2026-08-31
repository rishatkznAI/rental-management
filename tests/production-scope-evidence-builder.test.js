import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createPlatformIdentityContext } from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const {
  PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
  REQUIRED_SOURCE_BINDING_PATHS,
  REPOSITORY_ROOT,
  buildFreshProductionScopeEvidence,
  sourceBindingsFingerprint,
} = require('../server/lib/production-scope-evidence-builder.js');
const {
  ALL_APP_DATA_COLLECTIONS,
  COLLECTION_SCOPE_REGISTRY,
  COLLECTION_SHAPE,
} = require('../server/lib/app-data-scope-registry.js');
const {
  classificationAuthoritySnapshot,
  classifyProductionScopeRecord,
  createClassificationContract,
} = require('../server/lib/production-scope-evidence-classification.js');
const {
  buildBaselineContract,
  deriveAndVerifyBaselineCandidates,
  validateBaselineContract,
} = require('../server/lib/production-scope-baseline-contract.js');
const { deriveCanonicalCompanyId } = require('../server/lib/canonical-company-id.js');
const {
  deriveCanonicalHeadOfficeId,
  deriveCanonicalMembershipId,
} = require('../server/lib/canonical-authority-id.js');
const {
  verifyEvidencePack,
} = require('../server/scripts/simulate-production-scope-remediation.js');
const {
  parseArgs: parseEvidenceBuilderArgs,
} = require('../server/scripts/build-production-scope-evidence.js');
const {
  exactDisposablePath,
  mixedCatalogVisibility,
} = require('../server/scripts/verify-production-scope-local-visibility.js');
const {
  ensureBillingSourceAuthoritySchema,
} = require('../server/lib/billing-source-authority-schema.js');
const {
  ensureForecastReceivablesPlanningSchema,
} = require('../server/lib/forecast-receivables-planning-schema.js');
const {
  ensureActualSourceEligibilityDryRunSchema,
} = require('../server/lib/actual-source-eligibility-dry-run-schema.js');
const {
  ensureCanonicalActualPostingSchema,
} = require('../server/lib/canonical-actual-posting-schema.js');
const {
  ensureNumberSequenceSchema,
} = require('../server/lib/number-sequences.js');

const MISSING_COLLECTIONS = new Set([
  'service_work_names',
  'spare_part_names',
  'client_history',
  'client_object_history',
  'domain_history',
]);
const SQLITE_FILES = ['app.sqlite', 'app.sqlite-wal', 'app.sqlite-shm'];
const HEAD_SHA = crypto.createHash('sha1').update('unused').digest('hex');
const { stableJson } = require('../server/lib/production-scope-remediation.js');

const SYNTHETIC_REGISTRY_SOURCE = Object.freeze({
  jurisdiction: 'ZZ',
  registry: 'TEST_FIXTURE',
  value: 'production-scope-evidence-builder-v1',
});
const SYNTHETIC_COMPANY_ID = deriveCanonicalCompanyId(SYNTHETIC_REGISTRY_SOURCE).companyId;
const SYNTHETIC_HEAD_OFFICE_ID = deriveCanonicalHeadOfficeId({
  companyId: SYNTHETIC_COMPANY_ID,
}).branchId;
const BUSINESS_PRINCIPAL_IDS = Object.freeze([
  'fixture-business-admin-v1',
  'fixture-business-office-v1',
  'fixture-business-rental-v1',
]);
const INACTIVE_PRINCIPAL_ID = 'fixture-inactive-principal-v1';
const DEMO_PRINCIPAL_IDS = Object.freeze(Array.from(
  { length: 9 },
  (_, index) => `fixture-demo-principal-${String(index + 1).padStart(2, '0')}`,
));
const SMOKE_PRINCIPAL_ID = 'fixture-smoke-principal-v1';
const INFRASTRUCTURE = Object.freeze({
  githubRepository: 'example.test/rental-management-fixture',
  projectId: '00000000-0000-4000-8000-000000000101',
  environmentId: '00000000-0000-4000-8000-000000000102',
  serviceId: '00000000-0000-4000-8000-000000000103',
  volumeId: '00000000-0000-4000-8000-000000000104',
  volumeName: 'fixture-production-scope-volume',
  volumeMountPath: '/data',
  sourceDbPath: '/data/app.sqlite',
});
const FIXTURE_RECORDS = Object.freeze([
  { collection: 'bot_notifications', recordId: 'fixture-bot-notification-v1' },
  { collection: 'bot_users', recordId: 'fixture-bot-user-01' },
  { collection: 'bot_users', recordId: 'fixture-bot-user-02' },
  { collection: 'bot_users', recordId: 'fixture-bot-user-03' },
  { collection: 'client_objects', recordId: 'fixture-client-object-01' },
  { collection: 'client_objects', recordId: 'fixture-client-object-02' },
  { collection: 'counterparties', recordId: 'fixture-counterparty-v1' },
  { collection: 'counterparty_role_assignments', recordId: 'fixture-counterparty-role-v1' },
]);
const COLLECTION_RULES = Object.freeze([
  { collection: 'app_settings', classification: 'TENANT_REFERENCE_DATA', scopeSource: 'CONFIG_AUTHORITY' },
  { collection: 'client_objects', classification: 'TENANT_BUSINESS_DATA', scopeSource: 'PARENT_DERIVED' },
  { collection: 'clients', classification: 'TENANT_BUSINESS_DATA', scopeSource: 'PARENT_DERIVED' },
  { collection: 'counterparties', classification: 'TENANT_BUSINESS_DATA', scopeSource: 'DIRECT_OWNER' },
  { collection: 'counterparty_role_assignments', classification: 'TENANT_BUSINESS_DATA', scopeSource: 'PARENT_DERIVED' },
  { collection: 'documents', classification: 'TENANT_BUSINESS_DATA', scopeSource: 'PARENT_DERIVED' },
  { collection: 'equipment', classification: 'TENANT_BUSINESS_DATA', scopeSource: 'DIRECT_OWNER' },
]);

function candidateRecords() {
  return [
    { collection: 'app_settings', recordId: 'fixture-app-settings-v1' },
    { collection: 'client_objects', recordId: 'fixture-business-client-object-v1' },
    { collection: 'clients', recordId: 'fixture-business-client-v1' },
    { collection: 'counterparties', recordId: 'fixture-business-counterparty-v1' },
    { collection: 'counterparty_role_assignments', recordId: 'fixture-business-counterparty-role-v1' },
    { collection: 'documents', recordId: 'fixture-business-document-v1' },
    ...Array.from({ length: 91 }, (_, index) => ({
      collection: 'equipment',
      recordId: `fixture-equipment-${String(index + 1).padStart(3, '0')}`,
    })),
  ];
}

function symbolicPlan() {
  const roleKeys = ['company-administrator', 'office-manager', 'rental-manager'];
  return {
    productionExecutionAuthorized: false,
    authority: {
      companyId: SYNTHETIC_COMPANY_ID,
      tenantId: SYNTHETIC_COMPANY_ID,
      canonicalCompany: {
        jurisdiction: SYNTHETIC_REGISTRY_SOURCE.jurisdiction,
        registry: SYNTHETIC_REGISTRY_SOURCE.registry,
        registryValue: SYNTHETIC_REGISTRY_SOURCE.value,
      },
      headOffice: { id: SYNTHETIC_HEAD_OFFICE_ID, companyId: SYNTHETIC_COMPANY_ID },
    },
    actorMappings: [
      ...BUSINESS_PRINCIPAL_IDS.map((userId, index) => ({
        userId,
        action: 'CREATE_MEMBERSHIP',
        membershipId: deriveCanonicalMembershipId({
          companyId: SYNTHETIC_COMPANY_ID,
          principalId: userId,
        }).membershipId,
        companyId: SYNTHETIC_COMPANY_ID,
        tenantId: SYNTHETIC_COMPANY_ID,
        branchIds: index === 0 ? [] : [SYNTHETIC_HEAD_OFFICE_ID],
        companyWideBranchAuthority: index === 0,
        roleTemplateKey: roleKeys[index],
        roleTemplateVersion: 1,
      })),
      {
        userId: SMOKE_PRINCIPAL_ID,
        action: 'UNRESOLVED',
        candidateForProductionMembership: false,
      },
    ],
  };
}

function rawBaselineAuthority(records = candidateRecords()) {
  const ruleByCollection = new Map(COLLECTION_RULES.map(rule => [rule.collection, rule]));
  return {
    manifestVersion: 1,
    productionExecutionAuthorized: false,
    source: {
      deployedSha: 'a'.repeat(40),
      deploymentId: '00000000-0000-4000-8000-000000000105',
      snapshotCapturedAt: '2026-01-01T00:00:00.000Z',
      sourceSnapshotHash: 'b'.repeat(64),
    },
    canonicalScope: { companyId: SYNTHETIC_COMPANY_ID, tenantId: SYNTHETIC_COMPANY_ID },
    records: records.map(({ collection, recordId }) => ({
      collection,
      recordId,
      oldCompanyId: null,
      oldTenantId: null,
      newCompanyId: SYNTHETIC_COMPANY_ID,
      newTenantId: SYNTHETIC_COMPANY_ID,
      classification: ruleByCollection.get(collection).classification,
      scopeSource: ruleByCollection.get(collection).scopeSource,
      scopeEvidence: 'Deterministic symbolic test authority.',
    })),
  };
}

function symbolicBaselineContract(records = candidateRecords(), fixtureRecords = FIXTURE_RECORDS) {
  return buildBaselineContract({
    rawAuthority: rawBaselineAuthority(records),
    collectionRules: COLLECTION_RULES,
    fixtureRecords,
  });
}

function symbolicSensitiveAuthority() {
  return {
    retainedAuditEntityIds: [
      'fixture-business-client-v1',
      'fixture-business-client-object-v1',
      'fixture-business-document-v1',
    ],
    businessPrincipalIds: [...BUSINESS_PRINCIPAL_IDS],
    explicitFixtureRecordKeys: FIXTURE_RECORDS.map(row => `${row.collection}:${row.recordId}`),
    explicitDemoPrincipalIds: [...DEMO_PRINCIPAL_IDS],
    explicitInactivePrincipalIds: [INACTIVE_PRINCIPAL_ID],
    productionSmokeSourcePrincipalIds: [SMOKE_PRINCIPAL_ID],
  };
}

function symbolicClassificationContract() {
  return createClassificationContract({
    canonicalScope: {
      companyId: SYNTHETIC_COMPANY_ID,
      headOfficeId: SYNTHETIC_HEAD_OFFICE_ID,
    },
    sensitiveAuthority: symbolicSensitiveAuthority(),
  });
}

function observedBaselineRecords({
  candidates = candidateRecords(),
  fixtures = FIXTURE_RECORDS,
} = {}) {
  return [...candidates, ...fixtures].map(({ collection, recordId }) => ({
    collection,
    recordId,
    oldCompanyId: null,
    oldTenantId: null,
  }));
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function gitHead() {
  return require('node:child_process').execFileSync(
    'git',
    ['rev-parse', 'HEAD^{commit}'],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  ).trim();
}

function writeJson(filePath, value) {
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  return sha256(fs.readFileSync(filePath));
}

function fileState(directory, name) {
  const bytes = fs.readFileSync(path.join(directory, name));
  return { name, size: bytes.length, sha256: sha256(bytes) };
}

function sourceBindings() {
  return REQUIRED_SOURCE_BINDING_PATHS.map(relativePath => {
    const bytes = fs.readFileSync(path.join(REPOSITORY_ROOT, relativePath));
    return { relativePath, size: bytes.length, sha256: sha256(bytes) };
  });
}

function productionUsers() {
  return [
    { id: BUSINESS_PRINCIPAL_IDS[0], status: 'Активен', role: 'Администратор' },
    { id: BUSINESS_PRINCIPAL_IDS[1], status: 'Активен', role: 'Офис-менеджер' },
    { id: INACTIVE_PRINCIPAL_ID, status: 'Неактивен', role: 'Менеджер по аренде' },
    { id: BUSINESS_PRINCIPAL_IDS[2], status: 'Активен', role: 'Менеджер по аренде' },
    ...DEMO_PRINCIPAL_IDS.map((id, index) => ({
      id,
      status: index === 1 ? 'Активен' : 'Неактивен',
      role: index === 1 ? 'Перевозчик' : 'Инвестор',
      fixtureTag: 'FIXTURE-',
    })),
    {
      id: SMOKE_PRINCIPAL_ID,
      status: 'Активен',
      role: 'Администратор',
      password: `h1:${'a'.repeat(64)}`,
      tokenVersion: 0,
      allowFrontendLogin: true,
      frontendAccess: true,
    },
  ];
}

function emptyCollection(name) {
  const policy = COLLECTION_SCOPE_REGISTRY[name];
  if (policy.shape === COLLECTION_SHAPE.MAP) return {};
  if (policy.shape === COLLECTION_SHAPE.SINGLETON) return {};
  return [];
}

function auditRecords() {
  const rows = [];
  const retained = [
    'fixture-business-client-v1',
    'fixture-business-client-object-v1',
    'fixture-business-document-v1',
  ];
  for (let index = 0; index < 6; index += 1) {
    rows.push({
      id: `AUDIT-A-${index}`,
      entityType: index % 3 === 0 ? 'clients' : (index % 3 === 1 ? 'client_objects' : 'documents'),
      entityId: retained[index % retained.length],
      action: 'updated',
    });
  }
  for (let index = 0; index < 28; index += 1) {
    rows.push({
      id: `AUDIT-B-${index}`,
      entityType: 'business',
      entityId: `UNRETAINED-${index}`,
      userId: BUSINESS_PRINCIPAL_IDS[index % BUSINESS_PRINCIPAL_IDS.length],
      action: 'viewed',
    });
  }
  for (let index = 0; index < 122; index += 1) {
    rows.push({ id: `AUDIT-C-${index}`, entityType: 'auth', action: 'login' });
  }
  for (let index = 0; index < 26; index += 1) {
    rows.push({ id: `AUDIT-D-${index}`, entityType: 'unknown', entityId: `FIXTURE-${index}`, action: 'test' });
  }
  return rows;
}

function createFixture({
  analysisRound = 'roundB',
  extraEquipment = false,
  baselineScopeDrift = false,
  mutateCatalogRows,
} = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-evidence-builder-test-'));
  const baselineContract = symbolicBaselineContract();
  const classificationContract = symbolicClassificationContract();
  const plan = symbolicPlan();
  const baselineByCollection = new Map();
  for (const row of candidateRecords()) {
    const records = baselineByCollection.get(row.collection) || [];
    records.push({ id: row.recordId });
    baselineByCollection.set(row.collection, records);
  }
  const sourceDbPath = path.join(root, 'source.sqlite');
  const context = createPlatformIdentityContext({ users: productionUsers(), dbPath: sourceDbPath });
  ensureBillingSourceAuthoritySchema(context.db);
  ensureForecastReceivablesPlanningSchema(context.db);
  ensureActualSourceEligibilityDryRunSchema(context.db);
  ensureCanonicalActualPostingSchema(context.db);
  ensureNumberSequenceSchema(context.db);
  context.db.pragma('journal_mode = WAL');
  const upsert = context.db.prepare(`
    INSERT INTO app_data (name, json) VALUES (?, ?)
    ON CONFLICT(name) DO UPDATE SET json = excluded.json
  `);
  for (const name of ALL_APP_DATA_COLLECTIONS) {
    if (!MISSING_COLLECTIONS.has(name)) upsert.run(name, JSON.stringify(emptyCollection(name)));
  }
  const equipmentBaselineRecords = baselineByCollection.get('equipment');
  if (baselineScopeDrift) equipmentBaselineRecords[0].companyId = 'unexpected-company';
  upsert.run('equipment', JSON.stringify(extraEquipment
    ? [...equipmentBaselineRecords, { id: 'EQ-UNREVIEWED', name: 'Unreviewed' }]
    : equipmentBaselineRecords));
  const catalogRows = Array.from({ length: 399 }, (_, index) => ({
    id: `KB-CATALOG-${String(index + 1).padStart(3, '0')}`,
    title: `Catalog ${index + 1}`,
  }));
  if (typeof mutateCatalogRows === 'function') mutateCatalogRows(catalogRows);
  upsert.run('knowledge_base_modules', JSON.stringify(catalogRows));
  upsert.run('audit_logs', JSON.stringify(auditRecords()));
  upsert.run('bot_notifications', JSON.stringify([
    { id: FIXTURE_RECORDS[0].recordId, fixtureTag: 'FIXTURE-' },
  ]));
  upsert.run('bot_users', JSON.stringify({
    [FIXTURE_RECORDS[1].recordId]: { id: FIXTURE_RECORDS[1].recordId, fixtureTag: 'FIXTURE-' },
    [FIXTURE_RECORDS[2].recordId]: { id: FIXTURE_RECORDS[2].recordId, fixtureTag: 'FIXTURE-' },
    [FIXTURE_RECORDS[3].recordId]: { id: FIXTURE_RECORDS[3].recordId, fixtureTag: 'FIXTURE-' },
  }));
  upsert.run('client_objects', JSON.stringify([
    ...baselineByCollection.get('client_objects'),
    { id: FIXTURE_RECORDS[4].recordId, fixtureTag: 'FIXTURE-' },
    { id: FIXTURE_RECORDS[5].recordId, fixtureTag: 'FIXTURE-' },
  ]));
  upsert.run('clients', JSON.stringify(baselineByCollection.get('clients')));
  upsert.run('documents', JSON.stringify(baselineByCollection.get('documents')));
  upsert.run('counterparties', JSON.stringify([
    ...baselineByCollection.get('counterparties'),
    { id: FIXTURE_RECORDS[6].recordId, fixtureTag: 'FIXTURE-' },
  ]));
  upsert.run('counterparty_role_assignments', JSON.stringify([
    ...baselineByCollection.get('counterparty_role_assignments'),
    { id: FIXTURE_RECORDS[7].recordId, fixtureTag: 'FIXTURE-' },
  ]));
  upsert.run('app_settings', JSON.stringify(baselineByCollection.get('app_settings')));
  upsert.run('inline_relation_idempotency', JSON.stringify([{ key: 'legacy-inline' }]));
  upsert.run('rental_create_idempotency', JSON.stringify([{ key: 'legacy-rental' }]));
  upsert.run('users', JSON.stringify(productionUsers()));
  const roundA = path.join(root, 'round-a');
  const roundB = path.join(root, 'round-b');
  fs.mkdirSync(roundA, { mode: 0o700 });
  fs.mkdirSync(roundB, { mode: 0o700 });
  for (const name of SQLITE_FILES) {
    fs.copyFileSync(name === 'app.sqlite' ? sourceDbPath : `${sourceDbPath}${name.slice('app.sqlite'.length)}`, path.join(roundA, name));
    fs.copyFileSync(name === 'app.sqlite' ? sourceDbPath : `${sourceDbPath}${name.slice('app.sqlite'.length)}`, path.join(roundB, name));
  }
  context.close();
  const headSha = gitHead();
  const generatedAt = new Date(Date.now() - 5_000);
  const roundBAt = new Date(generatedAt.getTime() - 1_000);
  const roundAAt = new Date(roundBAt.getTime() - 1_000);
  const control = {
    controlVersion: 2,
    productionWriteAuthorized: false,
    networkAccessAuthorized: false,
    rawCaptureSQLiteOpenAuthorized: false,
    analysisRound,
    captureWindowStartedAt: new Date(roundAAt.getTime() - 1_000).toISOString(),
    evidenceGeneratedAt: generatedAt.toISOString(),
    conservation: {
      adminResetDisabled: true,
      allowedModesEmpty: true,
      appDisabled: true,
      botDisabled: true,
      cleanResetDisabled: true,
      gsmDisabled: true,
      gsmEnabled: false,
      schemaCompatibilityDisabled: true,
      singleReplica: true,
      storageWriteGuardEnabled: true,
    },
    repository: {
      githubRepository: INFRASTRUCTURE.githubRepository,
      headSha,
    },
    railway: {
      projectId: INFRASTRUCTURE.projectId,
      environmentId: INFRASTRUCTURE.environmentId,
      serviceId: INFRASTRUCTURE.serviceId,
      volumeId: INFRASTRUCTURE.volumeId,
      volumeName: INFRASTRUCTURE.volumeName,
      volumeMountPath: INFRASTRUCTURE.volumeMountPath,
      serviceInstanceId: '11111111-1111-4111-8111-111111111111',
      deploymentInstanceId: '22222222-2222-4222-8222-222222222222',
      captureDeploymentId: '33333333-3333-4333-8333-333333333333',
      captureDeployedSha: headSha,
    },
    rounds: {
      roundA: {
        captureId: '44444444-4444-4444-8444-444444444444',
        capturedAt: roundAAt.toISOString(),
        files: SQLITE_FILES.map(name => fileState(roundA, name)),
      },
      roundB: {
        captureId: '55555555-5555-4555-8555-555555555555',
        capturedAt: roundBAt.toISOString(),
        files: SQLITE_FILES.map(name => fileState(roundB, name)),
      },
    },
    baseline: structuredClone(baselineContract),
    classificationAuthorityFingerprint: '',
    sourceBindings: sourceBindings(),
  };
  control.classificationAuthorityFingerprint = sha256(stableJson(
    classificationAuthoritySnapshot(classificationContract),
  ));
  const controlPath = path.join(root, 'capture-control.json');
  const controlSha256 = writeJson(controlPath, control);
  return {
    root,
    roundA,
    roundB,
    baselineContract,
    classificationContract,
    plan,
    control,
    controlPath,
    controlSha256,
    outputDir: path.join(root, 'published-evidence'),
    cleanup() { fs.rmSync(root, { recursive: true, force: true }); },
    refreshControl() {
      this.control.rounds.roundA.files = SQLITE_FILES.map(name => fileState(this.roundA, name));
      this.control.rounds.roundB.files = SQLITE_FILES.map(name => fileState(this.roundB, name));
      this.control.sourceBindings = sourceBindings();
      this.controlSha256 = writeJson(this.controlPath, this.control);
    },
    build(overrides = {}) {
      return buildFreshProductionScopeEvidence({
        controlPath: this.controlPath,
        controlSha256: this.controlSha256,
        roundADir: this.roundA,
        roundBDir: this.roundB,
        outputDir: this.outputDir,
        baselineContract: this.baselineContract,
        classificationContract: this.classificationContract,
        environment: INFRASTRUCTURE,
        plan: this.plan,
        ...overrides,
      });
    },
  };
}

test('digest-only baseline contract binds the complete symbolic authority', async t => {
  const contract = symbolicBaselineContract();
  const canonicalScope = {
    companyId: SYNTHETIC_COMPANY_ID,
    tenantId: SYNTHETIC_COMPANY_ID,
  };
  const observedRecords = observedBaselineRecords();
  const derive = (overrides = {}) => deriveAndVerifyBaselineCandidates({
    contract,
    canonicalScope,
    observedRecords,
    fixtureRecords: FIXTURE_RECORDS,
    ...overrides,
  });

  await t.test('accepts the exact set independent of record ordering', () => {
    const normalizedContract = validateBaselineContract(contract);
    assert.equal(normalizedContract.productionExecutionAuthorized, false);
    assert.equal(normalizedContract.candidateCount, 97);
    assert.equal(normalizedContract.fixtureRecordCount, 8);
    const forward = derive();
    const reversed = derive({
      observedRecords: [...observedRecords].reverse(),
      fixtureRecords: [...FIXTURE_RECORDS].reverse(),
    });
    assert.equal(forward.length, 97);
    assert.deepEqual(reversed, forward);
  });

  await t.test('rejects a missing candidate', () => {
    assert.throws(() => derive({
      observedRecords: observedRecords.filter(row => !(
        row.collection === 'equipment' && row.recordId === 'fixture-equipment-001'
      )),
    }), { code: 'BASELINE_CANDIDATE_SET_MISMATCH' });
  });

  await t.test('rejects an extra candidate', () => {
    assert.throws(() => derive({
      observedRecords: [
        ...observedRecords,
        {
          collection: 'equipment',
          recordId: 'fixture-equipment-unreviewed',
          oldCompanyId: null,
          oldTenantId: null,
        },
      ],
    }), { code: 'BASELINE_CANDIDATE_SET_MISMATCH' });
  });

  await t.test('rejects a changed candidate record ID or before-state', () => {
    const changedId = structuredClone(observedRecords);
    changedId[0].recordId = 'fixture-app-settings-changed';
    assert.throws(() => derive({ observedRecords: changedId }), {
      code: 'BASELINE_CANDIDATE_SET_MISMATCH',
    });

    const changedBeforeState = structuredClone(observedRecords);
    const equipment = changedBeforeState.find(row => row.collection === 'equipment');
    equipment.oldCompanyId = 'fixture-unreviewed-company';
    assert.throws(() => derive({ observedRecords: changedBeforeState }), {
      code: 'BASELINE_CANDIDATE_SET_MISMATCH',
    });
  });

  await t.test('rejects canonical scope drift', () => {
    assert.throws(() => derive({
      canonicalScope: {
        companyId: 'fixture-different-company',
        tenantId: 'fixture-different-company',
      },
    }), { code: 'BASELINE_CANONICAL_SCOPE_MISMATCH' });
  });

  await t.test('rejects missing, removed, or added fixture authority', () => {
    const missingObservedFixture = observedRecords.filter(row => !(
      row.collection === FIXTURE_RECORDS[0].collection
      && row.recordId === FIXTURE_RECORDS[0].recordId
    ));
    assert.throws(() => derive({ observedRecords: missingObservedFixture }), {
      code: 'BASELINE_FIXTURE_RECORD_MISSING',
    });
    assert.throws(() => derive({ fixtureRecords: FIXTURE_RECORDS.slice(1) }), {
      code: 'BASELINE_FIXTURE_SET_MISMATCH',
    });
    assert.throws(() => derive({
      fixtureRecords: [
        ...FIXTURE_RECORDS,
        { collection: 'bot_users', recordId: 'fixture-bot-user-unreviewed' },
      ],
    }), { code: 'BASELINE_FIXTURE_SET_MISMATCH' });
  });

  await t.test('rejects collection classification drift', () => {
    const driftedContract = structuredClone(contract);
    driftedContract.collectionRules[0].classification = 'UNREVIEWED_CLASSIFICATION';
    assert.throws(() => derive({ contract: driftedContract }), {
      code: 'BASELINE_CANDIDATE_SET_MISMATCH',
    });
  });
});

test('mixed catalog evidence classification is explicit and never infers override linkage', () => {
  const collection = 'knowledge_base_modules';
  const policy = COLLECTION_SCOPE_REGISTRY[collection];
  const classify = record => classifyProductionScopeRecord({
    collection,
    policy,
    recordId: record.id,
    record,
    baseline: null,
  });

  assert.equal(classify({ id: 'DEFAULT-1', title: 'Same title' }).disposition,
    'PLATFORM_DEFAULT_REFERENCE');
  assert.equal(classifyProductionScopeRecord({
    collection,
    policy,
    recordId: 'DEFAULT-1',
    record: { id: 'DEFAULT-1', title: 'Same title' },
    baseline: { scopeSource: 'SUPERSEDED_TENANT_ONLY_CLAIM' },
  }).disposition, 'PLATFORM_DEFAULT_REFERENCE');
  assert.equal(classify({
    id: 'TENANT-1',
    title: 'Same title',
    companyId: 'cmp_A',
    tenantId: 'cmp_A',
  }).disposition, 'TENANT_OWNED_CATALOG_ENTRY');
  const override = classify({
    id: 'OVERRIDE-1',
    companyId: 'cmp_A',
    tenantId: 'cmp_A',
    platformDefaultId: 'DEFAULT-1',
  });
  assert.equal(override.disposition, 'TENANT_CATALOG_OVERRIDE');
  assert.equal(override.migrationRequired, 'NO');
  assert.equal(classify({
    id: 'INVALID-1',
    platformDefaultId: 'DEFAULT-1',
  }).disposition, 'UNRESOLVED');
  assert.equal(classify({
    id: 'INVALID-2',
    companyId: 'cmp_A',
  }).disposition, 'UNRESOLVED');
});

test('evidence source bindings include the mixed catalog state validator', () => {
  assert.equal(
    REQUIRED_SOURCE_BINDING_PATHS.includes('server/lib/platform-default-tenant-overlay.js'),
    true,
  );
  assert.equal(
    REQUIRED_SOURCE_BINDING_PATHS.includes('server/scripts/verify-production-scope-local-visibility.js'),
    true,
  );
});

test('local visibility model exposes defaults and only the selected tenant overlay', () => {
  const raw = [
    { id: 'DEFAULT-1', title: 'Platform title' },
    {
      id: 'OVERRIDE-A',
      title: 'Tenant A title',
      companyId: 'cmp_A',
      tenantId: 'cmp_A',
      platformDefaultId: 'DEFAULT-1',
    },
    { id: 'ENTRY-A', title: 'A only', companyId: 'cmp_A', tenantId: 'cmp_A' },
    { id: 'ENTRY-B', title: 'B only', companyId: 'cmp_B', tenantId: 'cmp_B' },
  ];
  const origin = (kind, logicalId, tenantMutable, extra = {}) => ({
    kind,
    logicalId,
    tenantMutable,
    ...extra,
  });
  const tenantA = [
    {
      id: 'DEFAULT-1',
      title: 'Tenant A title',
      catalogOrigin: origin('tenant_override', 'DEFAULT-1', true, {
        platformDefaultId: 'DEFAULT-1',
      }),
    },
    {
      id: 'ENTRY-A',
      title: 'A only',
      catalogOrigin: origin('tenant_entry', 'ENTRY-A', true),
    },
  ];
  const tenantB = [
    {
      id: 'DEFAULT-1',
      title: 'Platform title',
      catalogOrigin: origin('platform_default', 'DEFAULT-1', false),
    },
    {
      id: 'ENTRY-B',
      title: 'B only',
      catalogOrigin: origin('tenant_entry', 'ENTRY-B', true),
    },
  ];
  assert.equal(mixedCatalogVisibility(
    'knowledge_base_modules', raw, tenantA, { tenantId: 'cmp_A', fixtureExpected: false },
  ), true);
  assert.equal(mixedCatalogVisibility(
    'knowledge_base_modules', raw, tenantB, { tenantId: 'cmp_B', fixtureExpected: false },
  ), true);
  assert.equal(mixedCatalogVisibility(
    'knowledge_base_modules', raw, tenantB.map(record => ({ ...record, normalizedServerDefault: true })), {
      tenantId: 'cmp_B',
      fixtureExpected: false,
    },
  ), true);
  assert.equal(mixedCatalogVisibility(
    'knowledge_base_modules', raw, tenantB.map(record => (
      record.id === 'DEFAULT-1' ? { ...record, title: 'Changed response value' } : record
    )), {
      tenantId: 'cmp_B',
      fixtureExpected: false,
    },
  ), false);
  assert.equal(mixedCatalogVisibility(
    'knowledge_base_modules', raw, [...tenantB, tenantA[1]], {
      tenantId: 'cmp_B',
      fixtureExpected: false,
    },
  ), false);
});

test('publishes simulator-compatible private evidence without touching raw captures', () => {
  const fixture = createFixture();
  try {
    const rawBefore = Object.fromEntries([fixture.roundA, fixture.roundB].flatMap(directory => (
      SQLITE_FILES.map(name => [`${directory}:${name}`, {
        ...fileState(directory, name),
        ino: fs.statSync(path.join(directory, name)).ino,
      }])
    )));
    const result = fixture.build();
    assert.equal(result.summary.verdict, 'FRESH_PRODUCTION_CLASSIFICATION_COMPLETE');
    assert.equal(result.summary.capture.durableRoundsByteIdentical, true);
    assert.equal(result.summary.capture.rawCaptureOpenedBySQLite, false);
    assert.equal(result.summary.registry.scopeRelevantRecordCount, 688);
    assert.equal(result.summary.ownershipCandidates.count, 97);
    assert.equal(
      result.summary.sourceBindingsFingerprint,
      sourceBindingsFingerprint(sourceBindings()),
    );
    assert.deepEqual(
      result.summary.platformDefaultTenantOverlaySemantics,
      PLATFORM_DEFAULT_TENANT_OVERLAY_SEMANTICS_CONTRACT,
    );
    assert.equal(
      classificationAuthoritySnapshot().expectedFrozenSnapshot.platformDefaultRecordCount,
      399,
    );
    const recordInventory = JSON.parse(fs.readFileSync(
      path.join(fixture.outputDir, 'analysis/record-inventory.json'),
      'utf8',
    ));
    const platformDefaults = recordInventory.filter(row => (
      row.disposition === 'PLATFORM_DEFAULT_REFERENCE'
    ));
    assert.equal(platformDefaults.length, 399);
    assert.equal(platformDefaults.every(row => (
      row.registryCategory === 'PLATFORM_DEFAULT_TENANT_OVERLAY'
      && row.currentScopeState === 'UNSCOPED'
      && row.futureState === 'PRESERVE_UNSCOPED_PLATFORM_DEFAULT'
      && row.migrationRequired === 'NO'
    )), true);
    assert.equal(recordInventory.some(row => row.disposition === 'TENANT_CATALOG_SEED'), false);
    assert.deepEqual(result.summary.users.finalDispositionCounts, {
      BUSINESS_USER: 3,
      DEMO_FIXTURE: 9,
      INTENTIONALLY_UNMAPPED: 1,
      SMOKE_ACCOUNT: 1,
    });
    assert.equal(fs.existsSync(path.join(fixture.outputDir, 'capture')), false);
    assert.equal(result.secretScan.pass, true);
    assert.deepEqual(result.secretScan.findings, []);
    assert.equal(fs.statSync(fixture.outputDir).mode & 0o777, 0o700);
    assert.equal(fs.statSync(path.join(fixture.outputDir, 'analysis')).mode & 0o777, 0o700);
    const artifactIndex = JSON.parse(
      fs.readFileSync(path.join(fixture.outputDir, 'artifact-index.json'), 'utf8'),
    );
    assert.equal(artifactIndex.indexVersion, 2);
    for (const artifact of artifactIndex.artifacts) {
      assert.equal(fs.statSync(path.join(fixture.outputDir, artifact.relativePath)).mode & 0o777, 0o600);
      assert.equal(artifact.sensitive, true);
    }
    assert.equal(fs.existsSync(`${fixture.outputDir}.publish.lock`), false);
    const verified = verifyEvidencePack(fixture.outputDir, result.artifactIndexSha256);
    assert.equal(verified.index.packFingerprint, result.packFingerprint);
    const rawAfter = Object.fromEntries([fixture.roundA, fixture.roundB].flatMap(directory => (
      SQLITE_FILES.map(name => [`${directory}:${name}`, {
        ...fileState(directory, name),
        ino: fs.statSync(path.join(directory, name)).ino,
      }])
    )));
    assert.deepEqual(rawAfter, rawBefore);
  } finally {
    fixture.cleanup();
  }
});

test('propagates the injected whole-authority commitments into symbolic evidence', () => {
  const fixture = createFixture();
  try {
    const evidence = fixture.build();
    assert.equal(
      evidence.summary.ownershipCandidates.baselineContractSha256,
      sha256(stableJson(validateBaselineContract(fixture.baselineContract))),
    );
    assert.equal(
      evidence.summary.ownershipCandidates.candidateKeySetSha256,
      fixture.baselineContract.candidateKeySetSha256,
    );
    assert.equal(
      evidence.summary.ownershipCandidates.candidateAuthoritySha256,
      fixture.baselineContract.candidateAuthoritySha256,
    );
    assert.equal(
      evidence.summary.ownershipCandidates.canonicalScopeSha256,
      fixture.baselineContract.canonicalScopeSha256,
    );
    assert.equal(
      evidence.summary.classificationAuthorityFingerprint,
      fixture.control.classificationAuthorityFingerprint,
    );
  } finally {
    fixture.cleanup();
  }
});

test('local API visibility verifier accepts only one unlinked regular database beneath the OS temp root', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'scope-local-visibility-safety-'));
  try {
    const database = path.join(directory, 'app.sqlite');
    fs.writeFileSync(database, 'disposable-copy', { mode: 0o600 });
    assert.equal(exactDisposablePath(database).canonical, fs.realpathSync(database));
    assert.throws(
      () => exactDisposablePath(path.join(REPOSITORY_ROOT, 'package.json')),
      error => error.code === 'DISPOSABLE_DATABASE_REQUIRED',
    );
    const symlink = path.join(directory, 'symlink.sqlite');
    fs.symlinkSync(database, symlink);
    assert.throws(
      () => exactDisposablePath(symlink),
      error => error.code === 'DISPOSABLE_DATABASE_REQUIRED',
    );
    const hardlink = path.join(directory, 'hardlink.sqlite');
    fs.linkSync(database, hardlink);
    assert.throws(
      () => exactDisposablePath(database),
      error => error.code === 'DISPOSABLE_DATABASE_REQUIRED',
    );
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('accepts independently hash-bound SHM drift while durable DB/WAL remain identical', () => {
  const fixture = createFixture({ analysisRound: 'roundA' });
  try {
    const shmPath = path.join(fixture.roundB, 'app.sqlite-shm');
    const bytes = fs.readFileSync(shmPath);
    bytes[0] ^= 0xff;
    fs.writeFileSync(shmPath, bytes);
    fixture.refreshControl();
    const result = fixture.build();
    assert.equal(result.summary.capture.durableRoundsByteIdentical, true);
    assert.equal(result.summary.capture.shmObservationByteIdentical, false);
    assert.notEqual(
      result.summary.capture.sourceObservedFileSetHashes.roundA,
      result.summary.capture.sourceObservedFileSetHashes.roundB,
    );
  } finally {
    fixture.cleanup();
  }
});

test('rejects a hash-bound durable WAL mismatch between rounds', () => {
  const fixture = createFixture();
  try {
    fs.appendFileSync(path.join(fixture.roundB, 'app.sqlite-wal'), Buffer.from([0]));
    fixture.refreshControl();
    assert.throws(() => fixture.build(), { code: 'CAPTURE_DURABLE_ROUNDS_MISMATCH' });
    assert.equal(fs.existsSync(fixture.outputDir), false);
  } finally {
    fixture.cleanup();
  }
});

test('rejects symlinked capture members', async t => {
  await t.test('capture member', () => {
    const fixture = createFixture();
    try {
      const target = path.join(fixture.roundA, 'app.sqlite');
      const moved = `${target}.real`;
      fs.renameSync(target, moved);
      fs.symlinkSync(moved, target);
      assert.throws(() => fixture.build(), { code: 'CAPTURE_FILE_INVALID' });
    } finally {
      fixture.cleanup();
    }
  });
});

test('rejects output overwrite, repository output, capture overlap, and production paths', async t => {
  await t.test('overwrite', () => {
    const fixture = createFixture();
    try {
      fs.mkdirSync(fixture.outputDir);
      assert.throws(() => fixture.build(), { code: 'OUTPUT_ALREADY_EXISTS' });
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('repository output', () => {
    const fixture = createFixture();
    try {
      assert.throws(() => fixture.build({
        outputDir: path.join(REPOSITORY_ROOT, 'forbidden-evidence-output'),
      }), { code: 'REPOSITORY_OUTPUT_FORBIDDEN' });
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('capture overlap', () => {
    const fixture = createFixture();
    try {
      assert.throws(() => fixture.build({
        outputDir: path.join(fixture.roundA, 'evidence'),
      }), { code: 'CAPTURE_OUTPUT_OVERLAP' });
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('production output', () => {
    const fixture = createFixture();
    try {
      assert.throws(() => fixture.build({ outputDir: '/data/evidence' }), {
        code: 'PRODUCTION_PATH_FORBIDDEN',
      });
    } finally {
      fixture.cleanup();
    }
  });
});

test('rejects hash/control/baseline/source-binding drift', async t => {
  await t.test('control hash', () => {
    const fixture = createFixture();
    try {
      fixture.control.productionWriteAuthorized = true;
      writeJson(fixture.controlPath, fixture.control);
      assert.throws(() => fixture.build(), { code: 'CAPTURE_CONTROL_HASH_MISMATCH' });
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('embedded baseline commitment', () => {
    const fixture = createFixture();
    try {
      fixture.control.baseline.candidateKeySetSha256 = '0'.repeat(64);
      fixture.controlSha256 = writeJson(fixture.controlPath, fixture.control);
      assert.throws(() => fixture.build(), { code: 'BASELINE_AUTHORITY_MISMATCH' });
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('injected baseline contract', () => {
    const fixture = createFixture();
    try {
      const baselineContract = structuredClone(fixture.baselineContract);
      baselineContract.candidateAuthoritySha256 = '1'.repeat(64);
      assert.throws(() => fixture.build({ baselineContract }), {
        code: 'BASELINE_AUTHORITY_MISMATCH',
      });
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('source binding', () => {
    const fixture = createFixture();
    try {
      fixture.control.sourceBindings[0].sha256 = 'f'.repeat(64);
      fixture.controlSha256 = writeJson(fixture.controlPath, fixture.control);
      assert.throws(() => fixture.build(), { code: 'SOURCE_BINDING_DRIFT' });
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('pre-overlay source-binding set is obsolete', () => {
    const fixture = createFixture();
    try {
      fixture.control.sourceBindings = fixture.control.sourceBindings.filter(row => ![
        'server/lib/platform-default-tenant-overlay.js',
        'server/scripts/verify-production-scope-local-visibility.js',
      ].includes(row.relativePath));
      fixture.controlSha256 = writeJson(fixture.controlPath, fixture.control);
      assert.throws(() => fixture.build(), { code: 'SOURCE_BINDING_SET_MISMATCH' });
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('classification authority', () => {
    const fixture = createFixture();
    try {
      fixture.control.classificationAuthorityFingerprint = 'e'.repeat(64);
      fixture.controlSha256 = writeJson(fixture.controlPath, fixture.control);
      assert.throws(() => fixture.build(), { code: 'CLASSIFICATION_AUTHORITY_MISMATCH' });
    } finally {
      fixture.cleanup();
    }
  });
});

test('rejects stale capture evidence and a capture SHA that is not current HEAD', async t => {
  await t.test('stale capture', () => {
    const fixture = createFixture();
    try {
      const generatedAt = new Date(Date.now() - (25 * 60 * 60 * 1_000));
      const roundBAt = new Date(generatedAt.getTime() - 1_000);
      const roundAAt = new Date(roundBAt.getTime() - 1_000);
      fixture.control.captureWindowStartedAt = new Date(roundAAt.getTime() - 1_000).toISOString();
      fixture.control.rounds.roundA.capturedAt = roundAAt.toISOString();
      fixture.control.rounds.roundB.capturedAt = roundBAt.toISOString();
      fixture.control.evidenceGeneratedAt = generatedAt.toISOString();
      fixture.controlSha256 = writeJson(fixture.controlPath, fixture.control);
      assert.throws(() => fixture.build(), { code: 'CAPTURE_NOT_FRESH' });
      assert.equal(fs.existsSync(fixture.outputDir), false);
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('capture deployed SHA mismatch', () => {
    const fixture = createFixture();
    try {
      const wrongSha = 'a'.repeat(40) === gitHead() ? 'b'.repeat(40) : 'a'.repeat(40);
      fixture.control.repository.headSha = wrongSha;
      fixture.control.railway.captureDeployedSha = wrongSha;
      fixture.controlSha256 = writeJson(fixture.controlPath, fixture.control);
      assert.throws(() => fixture.build(), { code: 'CAPTURE_DEPLOYED_SHA_MISMATCH' });
      assert.equal(fs.existsSync(fixture.outputDir), false);
    } finally {
      fixture.cleanup();
    }
  });
});

test('CLI has no apply or production-write escape hatch', () => {
  assert.throws(() => parseEvidenceBuilderArgs(['--apply']), {
    code: 'ARGUMENT_INVALID',
  });
  assert.throws(() => parseEvidenceBuilderArgs(['--production-write']), {
    code: 'ARGUMENT_INVALID',
  });
  assert.throws(() => parseEvidenceBuilderArgs(['--baseline-manifest', '/tmp/obsolete.json']), {
    code: 'ARGUMENT_INVALID',
  });
});

test('indexed evidence swap is rejected after publication', () => {
  const fixture = createFixture();
  try {
    const evidence = fixture.build();
    fs.appendFileSync(path.join(fixture.outputDir, 'analysis/summary.json'), ' ');
    assert.throws(() => verifyEvidencePack(fixture.outputDir, evidence.artifactIndexSha256), {
      code: 'EVIDENCE_ARTIFACT_HASH_MISMATCH',
    });
  } finally {
    fixture.cleanup();
  }
});

test('rejects same-round reuse and a same-byte evidence path swap', async t => {
  await t.test('same round directory', () => {
    const fixture = createFixture();
    try {
      assert.throws(() => fixture.build({ roundBDir: fixture.roundA }), {
        code: 'CAPTURE_ROUNDS_NOT_INDEPENDENT',
      });
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('same-byte path replacement', () => {
    const fixture = createFixture();
    const originalLstatSync = fs.lstatSync;
    try {
      const target = fs.realpathSync(path.join(fixture.roundB, 'app.sqlite'));
      let targetLstatCount = 0;
      fs.lstatSync = function attackedLstat(filePath, ...args) {
        if (path.resolve(filePath) === target) {
          targetLstatCount += 1;
          if (targetLstatCount === 2) {
            const original = `${target}.original`;
            fs.renameSync(target, original);
            fs.copyFileSync(original, target);
          }
        }
        return originalLstatSync.call(fs, filePath, ...args);
      };
      assert.throws(() => fixture.build(), { code: 'CAPTURE_EVIDENCE_SWAP' });
      assert.equal(fs.existsSync(fixture.outputDir), false);
    } finally {
      fs.lstatSync = originalLstatSync;
      fixture.cleanup();
    }
  });
});

test('fails closed for new records, users, and baseline scope drift', async t => {
  await t.test('unclassified record', () => {
    const fixture = createFixture({ extraEquipment: true });
    try {
      assert.throws(() => fixture.build(), { code: 'BASELINE_CANDIDATE_SET_MISMATCH' });
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('baseline before-state drift', () => {
    const fixture = createFixture({ baselineScopeDrift: true });
    try {
      assert.throws(() => fixture.build(), { code: 'BASELINE_CANDIDATE_SET_MISMATCH' });
    } finally {
      fixture.cleanup();
    }
  });
  await t.test('unscoped row cannot carry an override link', () => {
    const fixture = createFixture({
      mutateCatalogRows(rows) {
        rows[0].platformDefaultId = rows[1].id;
      },
    });
    try {
      assert.throws(() => fixture.build(), { code: 'CLASSIFICATION_INCOMPLETE' });
    } finally {
      fixture.cleanup();
    }
  });
});

test('test fixture does not rely on a synthetic deployed SHA', () => {
  assert.notEqual(gitHead(), HEAD_SHA);
  assert.match(gitHead(), /^[a-f0-9]{40}$/);
});
