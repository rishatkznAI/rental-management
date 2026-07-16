import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_USERS,
  createPlatformIdentityContext,
  seedAuthority,
  testActor,
} from './platform-identity-fixtures.js';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  assertBranchScope,
  assertCapability,
  assertCompanyScope,
  assertScopeFresh,
  buildScopedPredicate,
  narrowRequestedBranch,
  resolveTrustedScope,
} = require('../server/lib/platform-authorization.js');
const {
  createPlatformIdentityRepository,
} = require('../server/lib/platform-identity-repository.js');

function resolve(context, userId, options = {}) {
  return resolveTrustedScope({
    req: {
      user: { userId, principalType: options.clientPrincipalType },
      headers: options.headers || {},
      query: options.query || {},
      body: options.body || {},
    },
    repository: context.repository,
    readUsers: options.readUsers || context.readUsers,
    requestedCompanyId: options.requestedCompanyId,
    requestedBranchId: options.requestedBranchId,
    nowIso: () => '2026-07-16T12:00:00.000Z',
  });
}

function createManagementActor(context, {
  companyId = 'company-a',
  principalId = 'U-finance',
  membershipId = `membership-management-${companyId}`,
  templateKey = 'template-a',
} = {}) {
  const membership = context.repository.createMembership({
    id: membershipId,
    companyId,
    principalId,
    status: 'active',
    roleTemplateKey: templateKey,
    roleTemplateVersion: 1,
    companyWideBranchAuthority: true,
    branchIds: [],
    actorContext: testActor(),
    reason: 'test-management-actor',
  });
  return testActor({
    principalId,
    membershipId: membership.id,
    expectedMembershipVersion: membership.version,
    correlationId: `management-${companyId}`,
  });
}

test('legacy administrator role creates no platform membership, capability, or company-wide authority', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context, { templateCapabilities: [] });
    assert.throws(() => resolve(context, 'U-admin'), /Company scope is unavailable/);

    context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    const scope = resolve(context, 'U-admin');
    assert.deepEqual(scope.capabilities, []);
    assert.equal(scope.companyWideBranchAuthority, false);
    for (const capability of [
      'receivables.read',
      'billing.period.close',
      'billing.period.reopen',
      'upd.form',
      'upd.conduct',
      'upd.correct',
      'forecast.read',
      'forecast.calculate',
      'companies.manage',
      'branches.manage',
      'members.manage',
    ]) {
      assert.throws(() => assertCapability(scope, capability));
    }
  } finally {
    context.close();
  }
});

test('trusted scope is immutable, sorted, concrete, and ignores client authority fields', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context, {
      templateCapabilities: ['forecast.read', 'receivables.read'],
    });
    context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-2', 'branch-a-1', 'branch-a-2'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    const scope = resolve(context, 'U-admin', {
      clientPrincipalType: 'system',
      headers: {
        'x-system-actor': 'true',
        'x-integration-id': 'integration-forged',
      },
      query: {
        principalId: 'forged',
        companyWideBranchAuthority: 'true',
        capabilities: ['companies.manage'],
      },
      body: { allowedBranchIds: ['*'] },
    });
    assert.equal(scope.principalType, 'user');
    assert.equal(scope.principalId, 'U-admin');
    assert.deepEqual(scope.capabilities, ['forecast.read', 'receivables.read']);
    assert.deepEqual(scope.allowedBranchIds, ['branch-a-1', 'branch-a-2']);
    assert.equal(scope.companyWideBranchAuthority, false);
    assert.equal(Object.isFrozen(scope), true);
    assert.equal(Object.isFrozen(scope.capabilities), true);
    assert.equal(Object.isFrozen(scope.allowedBranchIds), true);
    assert.throws(() => scope.capabilities.push('companies.manage'), TypeError);
  } finally {
    context.close();
  }
});

test('missing, duplicate, inactive, and bot-only users fail closed after authentication', () => {
  const users = [
    ...DEFAULT_USERS,
    { id: 'U-inactive', status: 'Отключен' },
    { id: 'U-bot', status: 'Активен', botOnly: true },
  ];
  const context = createPlatformIdentityContext({ users });
  try {
    seedAuthority(context);
    const managementActor = createManagementActor(context);
    for (const principalId of ['U-inactive', 'U-bot']) {
      context.repository.createMembership({
        id: `membership-${principalId}`,
        companyId: 'company-a',
        principalId,
        status: 'active',
        roleTemplateKey: 'template-a',
        roleTemplateVersion: 1,
        companyWideBranchAuthority: false,
        branchIds: ['branch-a-1'],
        actorContext: managementActor,
        reason: 'test-approved',
      });
      assert.throws(() => resolve(context, principalId));
    }
    assert.throws(() => resolve(context, 'U-missing'));
    assert.throws(() => resolve(context, 'U-admin', {
      readUsers: () => [
        { id: 'U-admin', status: 'Активен' },
        { id: 'U-admin', status: 'Активен' },
      ],
    }));
    assert.throws(() => resolveTrustedScope({
      req: { user: { principalType: 'system' }, headers: { 'x-system-actor': 'true' } },
      repository: context.repository,
      readUsers: context.readUsers,
    }));
  } finally {
    context.close();
  }
});

test('pending, inactive, and revoked memberships do not authorize and revoked is terminal', () => {
  const users = [
    ...DEFAULT_USERS,
    { id: 'U-pending', status: 'Активен' },
    { id: 'U-inactive-member', status: 'Активен' },
    { id: 'U-revoked', status: 'Активен' },
  ];
  const context = createPlatformIdentityContext({ users });
  try {
    seedAuthority(context);
    const managementActor = createManagementActor(context);
    for (const [principalId, status] of [
      ['U-pending', 'pending'],
      ['U-inactive-member', 'inactive'],
      ['U-revoked', 'revoked'],
    ]) {
      context.repository.createMembership({
        id: `membership-${status}`,
        companyId: 'company-a',
        principalId,
        status,
        roleTemplateKey: 'template-a',
        roleTemplateVersion: 1,
        companyWideBranchAuthority: false,
        branchIds: [],
        actorContext: managementActor,
        reason: 'test-approved',
      });
      assert.throws(() => resolve(context, principalId));
    }
    const revoked = context.repository.getMembership('membership-revoked');
    assert.throws(() => context.repository.updateMembership({
      membershipId: revoked.id,
      expectedVersion: revoked.version,
      status: 'active',
      actorContext: managementActor,
      reason: 'forbidden-reactivation',
    }), /Revoked membership is terminal/);
  } finally {
    context.close();
  }
});

test('branch and capability mutations retain history and bump membership version atomically', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context, { templateCapabilities: [] });
    const managementActor = createManagementActor(context);
    let membership = context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'pending',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: [],
      actorContext: managementActor,
      reason: 'test-approved',
    });
    assert.equal(membership.version, 1);
    membership = context.repository.grantBranchAccess({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      branchId: 'branch-a-1',
      actorContext: managementActor,
      reason: 'test-approved',
    });
    assert.equal(membership.version, 2);
    membership = context.repository.grantBranchAccess({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      branchId: 'branch-a-2',
      actorContext: managementActor,
      reason: 'test-approved',
    });
    assert.equal(membership.version, 3);
    assert.throws(() => context.repository.grantBranchAccess({
      membershipId: membership.id,
      expectedMembershipVersion: 2,
      branchId: 'branch-a-ho',
      actorContext: managementActor,
      reason: 'stale',
    }), /stale/);
    membership = context.repository.revokeBranchAccess({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      branchId: 'branch-a-2',
      actorContext: managementActor,
      reason: 'test-approved',
    });
    assert.equal(membership.version, 4);
    membership = context.repository.assignCapability({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      capabilityKey: 'receivables.read',
      effect: 'grant',
      actorContext: managementActor,
      reason: 'test-approved',
    });
    assert.equal(membership.version, 5);
    membership = context.repository.revokeCapabilityAssignment({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      capabilityKey: 'receivables.read',
      actorContext: managementActor,
      reason: 'test-approved',
    });
    assert.equal(membership.version, 6);
    assert.equal(context.repository.listBranchAccess(membership.id).length, 2);
    assert.equal(
      context.repository.listBranchAccess(membership.id).filter(item => item.status === 'revoked').length,
      1,
    );
    assert.equal(context.repository.listCapabilityAssignments(membership.id).length, 1);
    assert.equal(context.repository.listCapabilityAssignments(membership.id)[0].status, 'revoked');
  } finally {
    context.close();
  }
});

test('explicit branch access never expands when a new branch is created', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context);
    context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    assert.deepEqual(resolve(context, 'U-admin').allowedBranchIds, ['branch-a-1']);
    context.repository.createBranch({
      companyId: 'company-a',
      id: 'branch-a-new',
      displayName: 'New branch',
      actorContext: testActor(),
      reason: 'test-approved',
    });
    assert.deepEqual(resolve(context, 'U-admin').allowedBranchIds, ['branch-a-1']);
    assert.throws(() => resolve(context, 'U-admin', { requestedBranchId: 'branch-a-new' }));
  } finally {
    context.close();
  }
});

test('company-wide authority materializes all concrete branches and mixed mode denies', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context, {
      templateCapabilities: ['companies.manage', 'receivables.read'],
    });
    const membership = context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: true,
      branchIds: [],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    let scope = resolve(context, 'U-admin');
    assert.equal(scope.companyWideBranchAuthority, true);
    assert.deepEqual(scope.allowedBranchIds, ['branch-a-1', 'branch-a-2', 'branch-a-ho']);
    assert.equal(scope.allowedBranchIds.includes('*'), false);
    assert.equal(assertCapability(scope, 'companies.manage'), true);
    context.repository.createBranch({
      companyId: 'company-a',
      id: 'branch-a-new',
      displayName: 'New branch',
      actorContext: testActor(),
      reason: 'test-approved',
    });
    scope = resolve(context, 'U-admin');
    assert.equal(scope.allowedBranchIds.includes('branch-a-new'), true);

    context.db.prepare(`
      INSERT INTO membership_branch_access (
        id, membershipId, companyId, branchId, status, version,
        grantedAt, grantedBy, reason
      ) VALUES (
        'corrupt-mixed-grant', ?, 'company-a', 'branch-a-1', 'active', 1,
        '2026-07-16T00:00:00.000Z', 'fixture', 'fixture-corruption'
      )
    `).run(membership.id);
    assert.throws(() => resolve(context, 'U-admin'));
  } finally {
    context.close();
  }
});

test('company and branch selectors only narrow and multi-company ambiguity denies', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context);
    context.repository.createMembership({
      id: 'membership-company-a',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1', 'branch-a-2'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    seedAuthority(context, {
      companyId: 'company-b',
      branches: [
        { id: 'branch-b-ho', displayName: 'B Head Office', isHeadOffice: true },
        { id: 'branch-b-1', displayName: 'B1', isHeadOffice: false },
      ],
      templateKey: 'template-b',
    });
    context.repository.createMembership({
      id: 'membership-company-b',
      companyId: 'company-b',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-b',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-b-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    assert.throws(() => resolve(context, 'U-admin'));
    const companyScope = resolve(context, 'U-admin', { requestedCompanyId: 'company-a' });
    assert.equal(companyScope.companyId, 'company-a');
    assert.throws(() => resolve(context, 'U-admin', { requestedCompanyId: 'company-missing' }));
    const branchScope = narrowRequestedBranch(companyScope, 'branch-a-2');
    assert.deepEqual(branchScope.allowedBranchIds, ['branch-a-2']);
    assert.throws(() => narrowRequestedBranch(companyScope, 'branch-b-1'));
  } finally {
    context.close();
  }
});

test('cross-company grants are rejected and scoped predicates are non-disclosing', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context);
    const membership = context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    seedAuthority(context, {
      companyId: 'company-b',
      branches: [
        { id: 'branch-b-ho', displayName: 'B Head Office', isHeadOffice: true },
        { id: 'branch-b-1', displayName: 'B1', isHeadOffice: false },
      ],
      templateKey: 'template-b',
    });
    assert.throws(() => context.repository.grantBranchAccess({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      branchId: 'branch-b-1',
      actorContext: testActor(),
      reason: 'cross-company',
    }));
    const scope = resolve(context, 'U-admin');
    const predicate = buildScopedPredicate(scope, {
      alias: 'entity',
      id: 'entity-1',
    });
    assert.match(predicate.where, /entity\.companyId = @trustedCompanyId/);
    assert.match(predicate.where, /entity\.branchId IN \(@trustedBranchId0\)/);
    assert.equal(predicate.params.trustedCompanyId, 'company-a');
    assert.equal(assertCompanyScope(scope, 'company-a'), true);
    assert.equal(assertBranchScope(scope, 'branch-a-1'), true);
    assert.throws(() => assertCompanyScope(scope, 'company-b'), error => error.status === 404);
    assert.throws(() => assertBranchScope(scope, 'branch-b-1'), error => error.status === 404);
  } finally {
    context.close();
  }
});

test('grants add capabilities, denies win, and company capabilities require company-wide authority', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context, {
      templateCapabilities: ['forecast.read', 'members.manage'],
    });
    assert.throws(() => context.repository.createMembership({
      id: 'membership-explicit-incompatible',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    }), /Company-scoped role-template capabilities require company-wide branch authority/);
    let membership = context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: true,
      branchIds: [],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    membership = context.repository.assignCapability({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      capabilityKey: 'receivables.read',
      effect: 'grant',
      actorContext: testActor(),
      reason: 'test-approved',
    });
    membership = context.repository.assignCapability({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      capabilityKey: 'forecast.read',
      effect: 'deny',
      actorContext: testActor(),
      reason: 'test-approved',
    });
    const scope = resolve(context, 'U-admin');
    assert.deepEqual(scope.capabilities, ['members.manage', 'receivables.read']);
    assert.equal(assertCapability(scope, 'receivables.read'), true);
    assert.throws(() => assertCapability(scope, 'forecast.read'));
    assert.equal(assertCapability(scope, 'members.manage'), true);
    assert.throws(() => context.repository.assignCapability({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      capabilityKey: 'canonical.receivables.post',
      effect: 'grant',
      actorContext: testActor(),
      reason: 'reserved',
    }));
  } finally {
    context.close();
  }
});

test('repository and resolver fail closed for incompatible company-scoped capability state', () => {
  const explicitGrant = createPlatformIdentityContext();
  try {
    seedAuthority(explicitGrant, { templateCapabilities: ['receivables.read'] });
    const membership = explicitGrant.repository.createMembership({
      id: 'membership-explicit-company-grant',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    assert.throws(() => explicitGrant.repository.assignCapability({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      capabilityKey: 'companies.manage',
      effect: 'grant',
      actorContext: testActor(),
      reason: 'must-fail-closed',
    }), /Company-scoped grants require company-wide branch authority/);
    assert.equal(
      explicitGrant.repository.listCapabilityAssignments(membership.id).length,
      0,
    );

    explicitGrant.repository.createRoleTemplate({
      companyId: 'company-a',
      templateKey: 'company-manager-template',
      templateVersion: 1,
      displayName: 'Company manager',
      capabilities: ['members.manage'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    assert.throws(() => explicitGrant.repository.updateMembership({
      membershipId: membership.id,
      expectedVersion: membership.version,
      roleTemplateKey: 'company-manager-template',
      roleTemplateVersion: 1,
      actorContext: testActor(),
      reason: 'must-fail-closed',
    }), /Company-scoped role-template capabilities require company-wide branch authority/);
    assert.equal(
      explicitGrant.repository.getMembership(membership.id).roleTemplateKey,
      'template-a',
    );

    explicitGrant.db.prepare(`
      INSERT INTO membership_capability_assignments (
        id, membershipId, companyId, catalogVersion, capabilityKey, effect,
        status, version, grantedAt, grantedBy, reason
      ) VALUES (
        'manual-company-grant', ?, 'company-a', 1, 'companies.manage', 'grant',
        'active', 1, '2026-07-16T00:00:00.000Z', 'manual-fixture', 'manual-corruption'
      )
    `).run(membership.id);
    assert.throws(
      () => resolve(explicitGrant, 'U-admin'),
      /Company-scoped grants require company-wide authority/,
    );
  } finally {
    explicitGrant.close();
  }

  const companyWide = createPlatformIdentityContext();
  try {
    seedAuthority(companyWide, { templateCapabilities: ['members.manage'] });
    const membership = companyWide.repository.createMembership({
      id: 'membership-company-wide-manager',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: true,
      branchIds: [],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    assert.throws(() => companyWide.repository.updateMembership({
      membershipId: membership.id,
      expectedVersion: membership.version,
      status: 'inactive',
      companyWideBranchAuthority: false,
      actorContext: testActor(),
      reason: 'must-fail-closed',
    }), /Company-scoped role-template capabilities require company-wide branch authority/);
    const unchanged = companyWide.repository.getMembership(membership.id);
    assert.equal(unchanged.status, 'active');
    assert.equal(unchanged.companyWideBranchAuthority, 1);
    assert.equal(unchanged.version, membership.version);
  } finally {
    companyWide.close();
  }
});

test('catalog checksum mismatch and conflicting active assignments fail closed', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context, { templateCapabilities: ['receivables.read'] });
    const membership = context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      capabilityAssignments: [{
        capabilityKey: 'forecast.read',
        effect: 'grant',
      }],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    context.db.exec('DROP INDEX uq_membership_capability_active');
    context.db.prepare(`
      INSERT INTO membership_capability_assignments (
        id, membershipId, companyId, catalogVersion, capabilityKey, effect,
        status, version, grantedAt, grantedBy, reason
      ) VALUES (
        'conflicting-assignment', ?, 'company-a', 1, 'forecast.read', 'deny',
        'active', 1, '2026-07-16T00:00:00.000Z', 'fixture', 'fixture-corruption'
      )
    `).run(membership.id);
    assert.throws(() => resolve(context, 'U-admin'));
  } finally {
    context.close();
  }

  const corruptCatalog = createPlatformIdentityContext();
  try {
    seedAuthority(corruptCatalog);
    corruptCatalog.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    corruptCatalog.db.exec(`
      DROP TRIGGER trg_capability_catalog_versions_no_update;
      UPDATE capability_catalog_versions SET checksum = '${'0'.repeat(64)}' WHERE version = 1;
    `);
    assert.throws(() => resolve(corruptCatalog, 'U-admin'));
  } finally {
    corruptCatalog.close();
  }
});

test('scope freshness detects membership mutation and branch narrowing stays fresh', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context);
    const managementActor = createManagementActor(context);
    const membership = context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1', 'branch-a-2'],
      actorContext: managementActor,
      reason: 'test-approved',
    });
    const scope = resolve(context, 'U-admin');
    const narrowed = narrowRequestedBranch(scope, 'branch-a-1');
    assert.equal(assertScopeFresh(narrowed, {
      repository: context.repository,
      readUsers: context.readUsers,
      nowIso: () => '2026-07-16T12:01:00.000Z',
    }), true);
    context.repository.assignCapability({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      capabilityKey: 'forecast.read',
      effect: 'grant',
      actorContext: testActor(),
      reason: 'test-approved',
    });
    assert.throws(() => assertScopeFresh(scope, {
      repository: context.repository,
      readUsers: context.readUsers,
    }));
  } finally {
    context.close();
  }
});

test('authorization audit is append-only, validates JSON, uses Head Office, and rolls mutations back on failure', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context);
    const managementActor = createManagementActor(context);
    const companyEvent = context.db.prepare(`
      SELECT *
      FROM authorization_audit_events
      WHERE action = 'company.authority.created'
    `).get();
    assert.equal(companyEvent.branchId, 'branch-a-ho');
    assert.throws(() => context.db.prepare(`
      UPDATE authorization_audit_events SET reasonCode = 'changed' WHERE id = ?
    `).run(companyEvent.id), /append-only/);
    assert.throws(() => context.db.prepare(`
      DELETE FROM authorization_audit_events WHERE id = ?
    `).run(companyEvent.id), /append-only/);
    assert.throws(() => context.db.prepare(`
      INSERT OR REPLACE INTO authorization_audit_events
      SELECT * FROM authorization_audit_events WHERE id = ?
    `).run(companyEvent.id), /append-only/);
    assert.throws(() => context.db.prepare(`
      INSERT INTO authorization_audit_events (
        id, companyId, branchId, actorType, actorPrincipalId,
        action, targetType, targetId, decision, reasonCode,
        beforeJson, correlationId, occurredAt, createdAt
      ) VALUES (
        'invalid-json-event', 'company-a', 'branch-a-ho', 'user', 'U-admin',
        'test.invalid', 'company', 'company-a', 'rejected', 'invalid-json',
        'not-json', 'correlation-invalid', '2026-07-16T00:00:00.000Z',
        '2026-07-16T00:00:00.000Z'
      )
    `).run());
    assert.throws(() => context.repository.insertAudit({
      companyId: 'company-a',
      actorContext: managementActor,
      action: 'test.secret',
      targetType: 'company',
      targetId: 'company-a',
      reasonCode: 'test',
      after: { accessToken: 'forbidden' },
    }), /Secret-bearing audit field/);
  } finally {
    context.close();
  }

  const rollback = createPlatformIdentityContext({
    beforeAuditInsert() {
      throw new Error('forced-audit-failure');
    },
  });
  try {
    assert.throws(() => rollback.repository.createCompanyAuthority({
      company: {
        id: 'company-rollback',
        displayName: 'Rollback',
        receivablesTimezone: 'Europe/Moscow',
      },
      branches: [{
        id: 'branch-rollback-ho',
        displayName: 'Rollback Head Office',
        isHeadOffice: true,
      }],
      actorContext: testActor(),
      reason: 'test-approved',
    }), /forced-audit-failure/);
    assert.equal(rollback.db.prepare('SELECT COUNT(*) AS count FROM canonical_companies').get().count, 0);
    assert.equal(rollback.db.prepare('SELECT COUNT(*) AS count FROM canonical_branches').get().count, 0);
    assert.equal(rollback.db.prepare('SELECT COUNT(*) AS count FROM authorization_audit_events').get().count, 0);
  } finally {
    rollback.close();
  }
});

test('root identity and membership constraints reject sentinel IDs, duplicates, mutation, and hard delete', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context);
    const managementActor = createManagementActor(context);
    assert.throws(() => context.repository.createBranch({
      companyId: 'company-a',
      id: '*',
      displayName: 'Wildcard',
      actorContext: managementActor,
      reason: 'test',
    }));
    assert.throws(() => context.repository.createBranch({
      companyId: 'company-a',
      id: 'branch-a-1',
      displayName: 'Duplicate',
      actorContext: managementActor,
      reason: 'test',
    }));
    const membership = context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: managementActor,
      reason: 'test-approved',
    });
    assert.throws(() => context.repository.createMembership({
      id: 'membership-admin-duplicate',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-2'],
      actorContext: managementActor,
      reason: 'test-approved',
    }));
    assert.throws(() => context.db.prepare(`
      UPDATE canonical_branches
      SET companyId = 'other-company', version = version + 1
      WHERE companyId = 'company-a' AND id = 'branch-a-1'
    `).run(), /immutable/);
    for (const [table, where, value] of [
      ['canonical_companies', 'id', 'company-a'],
      ['canonical_branches', 'id', 'branch-a-1'],
      ['company_memberships', 'id', membership.id],
    ]) {
      assert.throws(
        () => context.db.prepare(`DELETE FROM ${table} WHERE ${where} = ?`).run(value),
        /cannot be deleted/,
      );
    }
  } finally {
    context.close();
  }
});

test('company creation rejects missing, multiple, sentinel, and globally duplicate Head Office identities', () => {
  const context = createPlatformIdentityContext();
  try {
    const input = branches => ({
      company: {
        id: 'company-invalid',
        displayName: 'Invalid company',
        receivablesTimezone: 'Europe/Moscow',
      },
      branches,
      actorContext: testActor(),
      reason: 'test-approved',
    });
    assert.throws(() => context.repository.createCompanyAuthority(input([
      { id: 'branch-no-head', displayName: 'Ordinary', isHeadOffice: false },
    ])));
    assert.throws(() => context.repository.createCompanyAuthority(input([
      { id: 'branch-head-one', displayName: 'Head one', isHeadOffice: true },
      { id: 'branch-head-two', displayName: 'Head two', isHeadOffice: true },
    ])));
    assert.throws(() => context.repository.createCompanyAuthority(input([
      { id: '*', displayName: 'Wildcard Head Office', isHeadOffice: true },
    ])));
    assert.equal(context.repository.getCompany('company-invalid'), null);

    seedAuthority(context);
    assert.throws(() => context.repository.createCompanyAuthority({
      company: {
        id: 'company-b',
        displayName: 'Company B',
        receivablesTimezone: 'Europe/Moscow',
      },
      branches: [
        { id: 'branch-b-ho', displayName: 'B Head Office', isHeadOffice: true },
        { id: 'branch-a-1', displayName: 'Duplicate global branch', isHeadOffice: false },
      ],
      actorContext: testActor(),
      reason: 'test-approved',
    }));
    assert.equal(context.repository.getCompany('company-b'), null);
  } finally {
    context.close();
  }
});

test('unknown exact template versions and multiple active catalogs deny', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context);
    assert.throws(() => context.repository.createMembership({
      id: 'membership-unknown-template',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 2,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    }));
    context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    context.db.exec('DROP INDEX uq_capability_catalog_single_active');
    context.db.prepare(`
      INSERT INTO capability_catalog_versions (version, status, checksum, createdAt)
      VALUES (2, 'active', ?, '2026-07-16T00:00:00.000Z')
    `).run('1'.repeat(64));
    assert.throws(() => resolve(context, 'U-admin'));
  } finally {
    context.close();
  }
});

test('resolver denies missing or multiple Head Office state even after direct fixture corruption', () => {
  const missing = createPlatformIdentityContext();
  try {
    seedAuthority(missing);
    missing.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    missing.db.exec(`
      DROP TRIGGER trg_canonical_branches_active_head_office;
      DROP TRIGGER trg_canonical_companies_active_head_office;
      UPDATE canonical_companies
      SET status = 'inactive', version = version + 1
      WHERE id = 'company-a';
      UPDATE canonical_branches
      SET status = 'inactive', version = version + 1
      WHERE companyId = 'company-a' AND id = 'branch-a-ho';
      UPDATE canonical_companies
      SET status = 'active', version = version + 1
      WHERE id = 'company-a';
    `);
    assert.throws(() => resolve(missing, 'U-admin'));
  } finally {
    missing.close();
  }

  const multiple = createPlatformIdentityContext();
  try {
    seedAuthority(multiple);
    multiple.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    multiple.db.exec('DROP INDEX uq_canonical_branches_head_office');
    multiple.db.prepare(`
      INSERT INTO canonical_branches (
        companyId, id, isHeadOffice, createdAt, displayName, status, version, updatedAt
      ) VALUES (
        'company-a', 'branch-a-ho-duplicate', 1, '2026-07-16T00:00:00.000Z',
        'Duplicate Head Office', 'active', 1, '2026-07-16T00:00:00.000Z'
      )
    `).run();
    assert.throws(() => resolve(multiple, 'U-admin'));
  } finally {
    multiple.close();
  }
});

test('root updates require optimistic versions and active Head Office remains concrete', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context);
    const managementActor = createManagementActor(context);
    const company = context.repository.getCompany('company-a');
    const updatedCompany = context.repository.updateCompany({
      companyId: company.id,
      expectedVersion: company.version,
      displayName: 'Updated company',
      actorContext: managementActor,
      reason: 'test-approved',
    });
    assert.equal(updatedCompany.version, company.version + 1);
    assert.throws(() => context.repository.updateCompany({
      companyId: company.id,
      expectedVersion: company.version,
      displayName: 'Stale update',
      actorContext: managementActor,
      reason: 'test-approved',
    }), /stale/);
    const headOffice = context.repository.listHeadOffices('company-a')[0];
    assert.equal(headOffice.id, 'branch-a-ho');
    assert.equal(headOffice.isHeadOffice, 1);
    assert.throws(() => context.repository.updateBranch({
      companyId: 'company-a',
      branchId: headOffice.id,
      expectedVersion: headOffice.version,
      status: 'inactive',
      actorContext: managementActor,
      reason: 'test-approved',
    }), /retain its active Head Office/);
  } finally {
    context.close();
  }
});

test('audit failure rolls back a membership security mutation', () => {
  const context = createPlatformIdentityContext();
  try {
    seedAuthority(context);
    const membership = context.repository.createMembership({
      id: 'membership-admin',
      companyId: 'company-a',
      principalId: 'U-admin',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-1'],
      actorContext: testActor(),
      reason: 'test-approved',
    });
    let failAudit = true;
    const repository = createPlatformIdentityRepository(context.db, {
      readUsers: context.readUsers,
      nowIso: () => '2026-07-16T13:00:00.000Z',
      generateId: prefix => `${prefix}-forced`,
      beforeAuditInsert() {
        if (failAudit) throw new Error('forced-security-audit-failure');
      },
    });
    assert.throws(() => repository.assignCapability({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      capabilityKey: 'forecast.read',
      effect: 'grant',
      actorContext: testActor(),
      reason: 'test-approved',
    }), /forced-security-audit-failure/);
    failAudit = false;
    assert.equal(context.repository.getMembership(membership.id).version, membership.version);
    assert.equal(context.repository.listCapabilityAssignments(membership.id).length, 0);
  } finally {
    context.close();
  }
});
