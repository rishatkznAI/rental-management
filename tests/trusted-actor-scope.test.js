import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

import {
  createPlatformIdentityContext,
  seedAuthority,
  testActor,
} from './platform-identity-fixtures.js';

const require = createRequire(import.meta.url);
const {
  TENANT_MODEL,
  assertCompleteActorScope,
  createTrustedActorScopeResolver,
} = require('../server/lib/trusted-actor-scope.js');

function createMembership(context, {
  companyId = 'company-a',
  id = `membership-${companyId}`,
  principalId = 'U-admin',
  templateKey = `template-${companyId}`,
} = {}) {
  return context.repository.createMembership({
    id,
    companyId,
    principalId,
    status: 'active',
    roleTemplateKey: templateKey,
    roleTemplateVersion: 1,
    companyWideBranchAuthority: true,
    branchIds: [],
    actorContext: testActor(),
    reason: 'trusted-actor-scope-test',
  });
}

function seedCompany(context, companyId) {
  return seedAuthority(context, {
    companyId,
    branches: [{
      id: `branch-${companyId}`,
      displayName: `Head office ${companyId}`,
      isHeadOffice: true,
    }],
    templateKey: `template-${companyId}`,
    templateCapabilities: [],
  });
}

test('trusted actor scope resolves only from one active membership and its active company', () => {
  const context = createPlatformIdentityContext({
    users: [{
      id: 'U-admin',
      name: 'Admin',
      role: 'Администратор',
      status: 'Активен',
      companyId: 'forged-user-company',
      tenantId: 'forged-user-tenant',
    }],
  });
  try {
    seedCompany(context, 'company-a');
    const membership = createMembership(context);
    const resolve = createTrustedActorScopeResolver({ db: context.db });

    const scope = resolve('U-admin');
    assert.deepEqual(scope, {
      companyId: 'company-a',
      tenantId: 'company-a',
      membershipId: membership.id,
      membershipVersion: membership.version,
      principalId: 'U-admin',
      source: 'active_company_membership',
      tenantModel: TENANT_MODEL,
    });
    assert.equal(Object.isFrozen(scope), true);
  } finally {
    context.close();
  }
});

test('trusted actor scope fails closed for missing, ambiguous, or inactive authority', () => {
  const missing = createPlatformIdentityContext();
  try {
    seedCompany(missing, 'company-a');
    const resolve = createTrustedActorScopeResolver({ db: missing.db });
    assert.throws(() => resolve('U-admin'), error => error?.code === 'ACTOR_SCOPE_INCOMPLETE');
  } finally {
    missing.close();
  }

  const ambiguous = createPlatformIdentityContext();
  try {
    seedCompany(ambiguous, 'company-a');
    seedCompany(ambiguous, 'company-b');
    createMembership(ambiguous, { companyId: 'company-a' });
    createMembership(ambiguous, { companyId: 'company-b' });
    const resolve = createTrustedActorScopeResolver({ db: ambiguous.db });
    assert.throws(
      () => resolve('U-admin'),
      error => error?.code === 'ACTOR_SCOPE_INCOMPLETE' && error?.details?.activeMembershipCount === 2,
    );
  } finally {
    ambiguous.close();
  }

  const inactive = createPlatformIdentityContext();
  try {
    seedCompany(inactive, 'company-a');
    createMembership(inactive);
    inactive.db.prepare(`
      UPDATE canonical_companies
      SET status = 'inactive', version = version + 1, updatedAt = ?
      WHERE id = ?
    `).run('2026-08-24T00:00:00.000Z', 'company-a');
    const resolve = createTrustedActorScopeResolver({ db: inactive.db });
    assert.throws(() => resolve('U-admin'), error => error?.code === 'ACTOR_SCOPE_INCOMPLETE');
  } finally {
    inactive.close();
  }
});

test('company is the tenant and an inconsistent injected scope fails closed', () => {
  assert.throws(
    () => assertCompleteActorScope({ companyId: 'company-a', tenantId: 'company-b' }),
    error => error?.code === 'ACTOR_SCOPE_INCOMPLETE',
  );
});
