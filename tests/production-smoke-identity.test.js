import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const { createAccessControl } = require('../server/lib/access-control');
const { deriveCanonicalCompanyId } = require('../server/lib/canonical-company-id');
const {
  deriveCanonicalHeadOfficeId,
  deriveCanonicalMembershipId,
} = require('../server/lib/canonical-authority-id');
const { normalizeRole } = require('../server/lib/role-groups');
const {
  PRODUCTION_SMOKE_READER_EMAIL,
  PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
  PRODUCTION_SMOKE_READER_ROLE,
  PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
  PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
  applyProductionSmokeIdentityTransition,
  getProjectedSmokeIdentityUsers,
  planProductionSmokeIdentityTransition,
  validateProductionSmokeBootstrapBinding,
} = require('../server/lib/production-smoke-identity');

const COMPANY_ID = deriveCanonicalCompanyId({
  jurisdiction: 'ZZ',
  registry: 'TEST_FIXTURE',
  value: 'production-smoke-identity-primary-v1',
}).companyId;
const OTHER_COMPANY_ID = deriveCanonicalCompanyId({
  jurisdiction: 'ZZ',
  registry: 'TEST_FIXTURE',
  value: 'production-smoke-identity-secondary-v1',
}).companyId;
const BRANCH_ID = deriveCanonicalHeadOfficeId({ companyId: COMPANY_ID }).branchId;
const MEMBERSHIP_ID = deriveCanonicalMembershipId({
  companyId: COMPANY_ID,
  principalId: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
}).membershipId;

function transitionConfig(overrides = {}) {
  const base = {
    transitionVersion: 1,
    status: 'APPROVED',
    sourcePrincipalId: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
    expectedSourceRole: 'Администратор',
    replacement: {
      id: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
      name: 'Production Smoke Reader',
      email: PRODUCTION_SMOKE_READER_EMAIL,
      role: PRODUCTION_SMOKE_READER_ROLE,
    },
    membership: {
      id: MEMBERSHIP_ID,
      companyId: COMPANY_ID,
      branchId: BRANCH_ID,
      roleTemplateKey: PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
      roleTemplateVersion: 1,
    },
  };
  return {
    ...base,
    ...overrides,
    replacement: { ...base.replacement, ...(overrides.replacement || {}) },
    membership: { ...base.membership, ...(overrides.membership || {}) },
  };
}

function sourceUser(overrides = {}) {
  return {
    id: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID,
    name: 'Synthetic legacy smoke administrator',
    email: 'fixture-legacy-smoke@example.test',
    role: 'Администратор',
    status: 'Активен',
    password: 'h2:scrypt:c2FsdA:aGFzaA',
    tokenVersion: 7,
    allowFrontendLogin: true,
    frontendAccess: true,
    profilePhoto: 'must-not-be-copied',
    permissions: { all: true },
    ...overrides,
  };
}

class FakeDb {
  constructor(users) {
    this.raw = JSON.stringify(users);
    this.updatedAt = 'before';
  }

  prepare(sql) {
    if (/^SELECT json FROM app_data/.test(sql.trim())) {
      return { get: name => name === 'users' ? { json: this.raw } : undefined };
    }
    if (/^UPDATE app_data/.test(sql.trim())) {
      return {
        run: (nextRaw, updatedAt, name, expectedRaw) => {
          if (name !== 'users' || expectedRaw !== this.raw) return { changes: 0 };
          this.raw = nextRaw;
          this.updatedAt = updatedAt;
          return { changes: 1 };
        },
      };
    }
    throw new Error(`Unexpected SQL: ${sql}`);
  }

  users() {
    return JSON.parse(this.raw);
  }
}

test('technical auditor is a canonical normalized role', () => {
  assert.equal(normalizeRole('technical_auditor'), PRODUCTION_SMOKE_READER_ROLE);
  assert.equal(normalizeRole('smoke-reader'), PRODUCTION_SMOKE_READER_ROLE);
  assert.equal(normalizeRole(PRODUCTION_SMOKE_READER_ROLE), PRODUCTION_SMOKE_READER_ROLE);
});

test('technical auditor reads authorized smoke surfaces including platform defaults and commercial fields are redacted', () => {
  const companyId = COMPANY_ID;
  const user = {
    userId: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
    userRole: PRODUCTION_SMOKE_READER_ROLE,
    companyId,
    tenantId: companyId,
  };
  const data = {
    equipment: [],
    clients: [],
    service: [],
    service_works: [],
  };
  const access = createAccessControl({ readData: collection => data[collection] || [] });
  const own = { id: 'own', companyId, tenantId: companyId, debt: 15, cost: 20, price: 25, name: 'visible' };
  const other = {
    id: 'fixture-other-tenant-record',
    companyId: OTHER_COMPANY_ID,
    tenantId: OTHER_COMPANY_ID,
    name: 'hidden',
  };

  for (const collection of ['equipment', 'counterparties', 'clients', 'client_objects', 'service']) {
    assert.equal(access.canAccessEntity(collection, own, user), true, collection);
    assert.equal(access.canAccessEntity(collection, other, user), false, collection);
    assert.equal(access.canMutateEntity(collection, own, user), false, collection);
  }
  for (const collection of ['knowledge_base_modules', 'service_works', 'spare_parts', 'service_route_norms']) {
    const defaultId = `platform-${collection}`;
    const platformDefault = {
      id: defaultId,
      catalogOrigin: {
        kind: 'platform_default',
        logicalId: defaultId,
        tenantMutable: false,
      },
    };
    const tenantId = `tenant-${collection}`;
    const tenantEntry = {
      id: tenantId,
      catalogOrigin: {
        kind: 'tenant_entry',
        logicalId: tenantId,
        tenantMutable: true,
      },
    };
    assert.equal(access.canAccessEntity(collection, platformDefault, user), true, collection);
    assert.equal(access.canAccessEntity(collection, tenantEntry, user), true, collection);
    assert.equal(access.canAccessEntity(collection, { ...other, id: `raw-${collection}` }, user), false, collection);
    assert.equal(access.canMutateEntity(collection, platformDefault, user), false, collection);
    assert.equal(access.canMutateEntity(collection, tenantEntry, user), false, collection);
  }
  for (const collection of ['documents', 'payments', 'finance_operations', 'app_settings', 'users']) {
    assert.equal(access.canAccessEntity(collection, own, user), false, collection);
  }
  assert.throws(
    () => access.assertCanCreateCollection('service', user, own),
    error => error?.status === 403,
  );
  assert.deepEqual(access.sanitizeEntityForRead('clients', own, user), {
    id: 'own',
    companyId,
    tenantId: companyId,
    name: 'visible',
  });
  const safeEquipment = access.sanitizeEntityForRead('equipment', {
    ...own,
    gsmDeviceRecordId: 'GDEV-RESTRICTED',
    gsmImei: '860000000000066',
    gsmStatus: 'online',
  }, user);
  assert.equal(Object.keys(safeEquipment).some(key => /^gsm/i.test(key)), false);
});

test('frontend and backend permission matrices keep technical auditor read-only', () => {
  const root = path.join(__dirname, '..');
  const serverSource = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
  const frontendSource = fs.readFileSync(path.join(root, 'src/app/lib/permissions.ts'), 'utf8');
  const knowledgeBaseSource = fs.readFileSync(path.join(root, 'src/app/pages/KnowledgeBase.tsx'), 'utf8');
  const clientDetailSource = fs.readFileSync(path.join(root, 'src/app/pages/ClientDetail.tsx'), 'utf8');
  const productionSmokeSource = fs.readFileSync(path.join(root, 'e2e/production-smoke.spec.ts'), 'utf8');
  const releaseSmokeSource = fs.readFileSync(path.join(root, 'e2e/helpers/releaseSmoke.ts'), 'utf8');
  const writeBlock = serverSource.slice(
    serverSource.indexOf('const WRITE_PERMISSIONS = {'),
    serverSource.indexOf('const READ_PERMISSIONS = {'),
  );
  const readBlock = serverSource.slice(
    serverSource.indexOf('const READ_PERMISSIONS = {'),
    serverSource.indexOf('// ── Middleware'),
  );
  assert.doesNotMatch(writeBlock, /TECHNICAL_AUDITOR_ROLE/);
  for (const collection of [
    'equipment',
    'clients',
    'client_objects',
    'service',
    'knowledge_base_modules',
    'service_works',
    'spare_parts',
    'service_route_norms',
  ]) {
    assert.match(readBlock, new RegExp(`${collection}:[^\\n]*TECHNICAL_AUDITOR_ROLE`), collection);
  }
  for (const collection of ['documents', 'payments', 'finance_operations', 'app_settings', 'users']) {
    assert.doesNotMatch(readBlock, new RegExp(`${collection}:[^\\n]*TECHNICAL_AUDITOR_ROLE`), collection);
  }
  const frontendRoleBlock = frontendSource.slice(
    frontendSource.indexOf('[TECHNICAL_AUDITOR_ROLE]'),
    frontendSource.indexOf("'\u0418\u043d\u0432\u0435\u0441\u0442\u043e\u0440':"),
  );
  for (const section of ['dashboard', 'equipment', 'knowledge_base', 'service', 'clients', 'profile_settings']) {
    assert.match(frontendRoleBlock, new RegExp(`${section}:\\s+VIEW`), section);
  }
  assert.doesNotMatch(frontendRoleBlock, /\bALL\b|VIEW_CREATE|create|edit|delete|documents|payments|finance|admin_panel/);
  assert.match(knowledgeBaseSource, /role === TECHNICAL_AUDITOR_ROLE\) return true/);
  assert.match(knowledgeBaseSource, /enabled: canReadCollection\('knowledge_base_progress'\)/);
  assert.match(clientDetailSource, /useClientContractsList\(\{\s*enabled: canReadCollection\('client_contracts'\)/);
  assert.match(clientDetailSource, /useDebtCollectionPlans\(\{\s*enabled: canReadCollection\('debt_collection_plans'\)/);
  assert.match(productionSmokeSource, /expectedCompanyHealthDirectionLinks:\s*3/);
  assert.match(releaseSmokeSource, /role-authorized direction links/);
});

test('smoke transition clones only the hashed credential and emits a secret-free diff', () => {
  const source = sourceUser();
  const other = {
    id: 'fixture-ordinary-principal-v1',
    email: 'fixture-ordinary-user@example.test',
    status: 'Активен',
  };
  const plan = planProductionSmokeIdentityTransition({
    users: [source, other],
    config: transitionConfig(),
    usersRawFingerprint: 'a'.repeat(64),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.status, 'pending');
  assert.equal(plan.plannedDiff.CREATE.length, 1);
  assert.equal(plan.plannedDiff.UPDATE.length, 1);
  assert.doesNotMatch(JSON.stringify(plan), /h2:scrypt|password|profilePhoto|permissions/);

  const projected = getProjectedSmokeIdentityUsers(plan);
  const oldUser = projected.find(user => user.id === PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID);
  const newUser = projected.find(user => user.id === PRODUCTION_SMOKE_READER_PRINCIPAL_ID);
  assert.equal(oldUser.status, 'Неактивен');
  assert.equal(oldUser.tokenVersion, 8);
  assert.equal(oldUser.allowFrontendLogin, false);
  assert.equal(oldUser.frontendAccess, false);
  assert.equal(newUser.password, source.password);
  assert.deepEqual(Object.keys(newUser).sort(), [
    'allowFrontendLogin',
    'botOnly',
    'email',
    'frontendAccess',
    'id',
    'name',
    'password',
    'replacementForPrincipalId',
    'replacementReason',
    'role',
    'status',
    'tokenVersion',
  ]);
  assert.equal(newUser.profilePhoto, undefined);
  assert.equal(newUser.permissions, undefined);
});

test('smoke transition requires exact identity state and rejects credential material in config', () => {
  const plaintext = planProductionSmokeIdentityTransition({
    users: [sourceUser({ password: 'plaintext' })],
    config: transitionConfig(),
  });
  assert.equal(plaintext.ok, false);
  assert.ok(plaintext.blockers.some(item => item.code === 'SMOKE_TRANSITION_SOURCE_HASH_REQUIRED'));

  const secretConfig = planProductionSmokeIdentityTransition({
    users: [sourceUser()],
    config: transitionConfig({ replacement: { password: 'forbidden' } }),
  });
  assert.equal(secretConfig.ok, false);
  assert.ok(secretConfig.blockers.some(item => item.code === 'SMOKE_TRANSITION_SECRET_FIELD_FORBIDDEN'));

  const unapprovedEmail = planProductionSmokeIdentityTransition({
    users: [sourceUser()],
    config: transitionConfig({ replacement: { email: 'fixture-alternate-reader@example.test' } }),
  });
  assert.equal(unapprovedEmail.ok, false);
  assert.ok(unapprovedEmail.blockers.some(item => item.code === 'SMOKE_TRANSITION_REPLACEMENT_EMAIL_UNAPPROVED'));

  const conflict = planProductionSmokeIdentityTransition({
    users: [sourceUser(), { id: PRODUCTION_SMOKE_READER_PRINCIPAL_ID, email: 'other@example.test' }],
    config: transitionConfig(),
  });
  assert.equal(conflict.ok, false);
  assert.ok(conflict.blockers.some(item => item.code === 'SMOKE_TRANSITION_REPLACEMENT_CONFLICT'));
});

test('smoke bootstrap binding is exact, branch-scoped, capability-free, and excludes the old account', () => {
  const config = transitionConfig();
  const identityBootstrap = {
    roleTemplates: [{
      templateKey: PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
      templateVersion: 1,
      displayName: 'Production Smoke Reader',
      capabilities: [],
    }],
    memberships: [{
      id: MEMBERSHIP_ID,
      principalId: PRODUCTION_SMOKE_READER_PRINCIPAL_ID,
      status: 'active',
      roleTemplateKey: PRODUCTION_SMOKE_READER_TEMPLATE_KEY,
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: [BRANCH_ID],
      capabilityAssignments: [],
    }],
  };
  assert.deepEqual(validateProductionSmokeBootstrapBinding({ config, identityBootstrap }), {
    ok: true,
    blockers: [],
  });

  const overprivileged = structuredClone(identityBootstrap);
  overprivileged.roleTemplates[0].capabilities = ['members.manage'];
  overprivileged.memberships[0].companyWideBranchAuthority = true;
  overprivileged.memberships.push({ principalId: PRODUCTION_SMOKE_SOURCE_PRINCIPAL_ID });
  const denied = validateProductionSmokeBootstrapBinding({ config, identityBootstrap: overprivileged });
  assert.equal(denied.ok, false);
  assert.ok(denied.blockers.some(item => item.code === 'SMOKE_TRANSITION_TEMPLATE_MUST_HAVE_NO_CAPABILITIES'));
  assert.ok(denied.blockers.some(item => item.code === 'SMOKE_TRANSITION_MEMBERSHIP_SCOPE_INVALID'));
  assert.ok(denied.blockers.some(item => item.code === 'SMOKE_TRANSITION_SOURCE_MEMBERSHIP_FORBIDDEN'));
});

test('smoke identity apply uses compare-and-swap and is idempotent after a fresh preview', () => {
  const config = transitionConfig();
  const db = new FakeDb([sourceUser()]);
  const beforePlan = planProductionSmokeIdentityTransition({
    users: db.users(),
    config,
    usersRawFingerprint: crypto.createHash('sha256').update(db.raw).digest('hex'),
  });
  const applied = applyProductionSmokeIdentityTransition({
    db,
    config,
    expectedTransitionChecksum: beforePlan.transitionChecksum,
    mutationTimestamp: '2026-08-26T12:00:00.000Z',
  });
  assert.deepEqual(applied, { status: 'succeeded', writes: 1 });
  assert.equal(db.updatedAt, '2026-08-26T12:00:00.000Z');

  const afterPlan = planProductionSmokeIdentityTransition({
    users: db.users(),
    config,
    usersRawFingerprint: crypto.createHash('sha256').update(db.raw).digest('hex'),
  });
  assert.equal(afterPlan.status, 'already_applied');
  assert.deepEqual(applyProductionSmokeIdentityTransition({
    db,
    config,
    expectedTransitionChecksum: afterPlan.transitionChecksum,
    mutationTimestamp: '2026-08-26T12:00:00.000Z',
  }), { status: 'noop', writes: 0 });
});
