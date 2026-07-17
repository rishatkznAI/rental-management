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
  AUDIT_JSON_MAX_BYTES,
  AUDIT_JSON_MAX_DEPTH,
  auditJson,
  createTrustedUserActorContext,
} = require('../server/lib/platform-identity-repository.js');

function replaceUsers(context, users) {
  context.db.prepare("UPDATE app_data SET json = ? WHERE name = 'users'").run(
    JSON.stringify(users),
  );
}

function createAuthorityWithActorMembership() {
  const context = createPlatformIdentityContext();
  seedAuthority(context);
  const membership = context.repository.createMembership({
    id: 'membership-admin-actor',
    companyId: 'company-a',
    principalId: 'U-admin',
    status: 'active',
    roleTemplateKey: 'template-a',
    roleTemplateVersion: 1,
    companyWideBranchAuthority: false,
    branchIds: ['branch-a-1'],
    actorContext: testActor(),
    reason: 'initial-provisioning',
  });
  return {
    context,
    membership,
    actorContext: testActor({
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
    }),
  };
}

function attemptCompanyRename(context, actorContext, displayName = 'Renamed company') {
  const company = context.repository.getCompany('company-a');
  return context.repository.updateCompany({
    companyId: company.id,
    expectedVersion: company.version,
    displayName,
    actorContext,
    reason: 'security-remediation-test',
  });
}

function authorityCounts(context) {
  return Object.fromEntries([
    'canonical_companies',
    'canonical_branches',
    'company_memberships',
    'membership_branch_access',
    'role_templates',
    'role_template_capabilities',
    'membership_capability_assignments',
    'authorization_audit_events',
    'identity_bootstrap_runs',
  ].map(table => [
    table,
    context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

test('trusted actor validation denies missing, inactive, and duplicate live users without writes', async t => {
  const cases = [
    {
      name: 'missing user',
      users: [{ id: 'U-finance', status: 'Активен' }],
    },
    {
      name: 'inactive user',
      users: [
        { id: 'U-admin', status: 'Неактивен' },
        { id: 'U-finance', status: 'Активен' },
      ],
    },
    {
      name: 'duplicate user',
      users: [
        { id: 'U-admin', status: 'Активен' },
        { id: 'U-admin', status: 'Активен' },
        { id: 'U-finance', status: 'Активен' },
      ],
    },
  ];

  for (const scenario of cases) {
    await t.test(scenario.name, () => {
      const { context, actorContext } = createAuthorityWithActorMembership();
      try {
        const before = authorityCounts(context);
        const companyBefore = context.repository.getCompany('company-a');
        replaceUsers(context, scenario.users);
        assert.throws(
          () => attemptCompanyRename(context, actorContext),
          error => error.code === 'PLATFORM_IDENTITY_ACTOR_USER_DENIED',
        );
        assert.deepEqual(authorityCounts(context), before);
        assert.deepEqual(context.repository.getCompany('company-a'), companyBefore);
      } finally {
        context.close();
      }
    });
  }
});

test('trusted actor context rejects forged DTOs, arbitrary actor types, and request-selected actors', () => {
  const { context, membership } = createAuthorityWithActorMembership();
  try {
    const before = authorityCounts(context);
    const forged = {
      principalId: 'U-admin',
      membershipId: membership.id,
      expectedMembershipVersion: membership.version,
      correlationId: 'forged-request-context',
    };
    assert.throws(
      () => attemptCompanyRename(context, forged),
      error => error.code === 'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
    );
    for (const type of ['system', 'integration']) {
      assert.throws(
        () => createTrustedUserActorContext({
          type,
          principalId: 'U-admin',
          correlationId: `forged-${type}`,
        }),
        error => error.code === 'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
      );
      assert.throws(
        () => attemptCompanyRename(context, {
          type,
          principalId: 'U-admin',
          correlationId: `plain-${type}`,
        }),
        error => error.code === 'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
      );
    }

    const request = {
      headers: {
        'x-actor-type': 'system',
        'x-actor-principal-id': 'U-admin',
      },
      body: {
        actor: forged,
        actorPrincipalId: 'U-admin',
        actorMembershipVersion: membership.version,
      },
    };
    const company = context.repository.getCompany('company-a');
    assert.throws(
      () => context.repository.updateCompany({
        companyId: company.id,
        expectedVersion: company.version,
        displayName: 'Header/body forged',
        ...request.body,
        headers: request.headers,
        reason: 'request-fields-must-not-select-actor',
      }),
      error => error.code === 'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
    );
    assert.deepEqual(authorityCounts(context), before);
  } finally {
    context.close();
  }
});

test('trusted actor membership must match principal, company, active status, and current version', () => {
  const { context, membership, actorContext } = createAuthorityWithActorMembership();
  try {
    assert.throws(
      () => attemptCompanyRename(context, testActor({
        principalId: 'U-finance',
        membershipId: membership.id,
        expectedMembershipVersion: membership.version,
      })),
      error => error.code === 'PLATFORM_IDENTITY_ACTOR_MEMBERSHIP_DENIED',
    );
    assert.throws(
      () => attemptCompanyRename(context, testActor({
        membershipId: 'missing-membership',
        expectedMembershipVersion: 1,
      })),
      error => error.code === 'PLATFORM_IDENTITY_ACTOR_MEMBERSHIP_DENIED',
    );
    assert.throws(
      () => attemptCompanyRename(context, testActor({
        membershipId: membership.id,
        expectedMembershipVersion: membership.version - 1,
      })),
      error => error.code === 'PLATFORM_IDENTITY_ACTOR_MEMBERSHIP_DENIED',
    );
    assert.throws(
      () => createTrustedUserActorContext({
        principalId: 'U-admin',
        membershipId: membership.id,
        expectedMembershipVersion: membership.version,
        actorMembershipVersion: 999,
        correlationId: 'version-substitution',
      }),
      error => error.code === 'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
    );

    context.repository.createCompanyAuthority({
      company: {
        id: 'company-b',
        displayName: 'Company B',
        receivablesTimezone: 'Europe/Moscow',
      },
      branches: [{
        id: 'branch-b-ho',
        displayName: 'Company B Head Office',
        isHeadOffice: true,
      }],
      actorContext: testActor(),
      reason: 'initial-provisioning',
    });
    const companyB = context.repository.getCompany('company-b');
    assert.throws(
      () => context.repository.updateCompany({
        companyId: companyB.id,
        expectedVersion: companyB.version,
        displayName: 'Cross-company actor',
        actorContext,
        reason: 'cross-company-actor-denied',
      }),
      error => error.code === 'PLATFORM_IDENTITY_ACTOR_MEMBERSHIP_DENIED',
    );

    const updated = attemptCompanyRename(context, actorContext, 'Validated actor company');
    const event = context.db.prepare(`
      SELECT actorType, actorPrincipalId, actorMembershipId, actorMembershipVersion
      FROM authorization_audit_events
      WHERE action = 'company.updated' AND targetId = ?
      ORDER BY createdAt DESC, id DESC
      LIMIT 1
    `).get(updated.id);
    assert.deepEqual(event, {
      actorType: 'user',
      actorPrincipalId: 'U-admin',
      actorMembershipId: membership.id,
      actorMembershipVersion: membership.version,
    });

    const inactivated = context.repository.updateMembership({
      membershipId: membership.id,
      expectedVersion: membership.version,
      status: 'inactive',
      actorContext,
      reason: 'inactivate-actor-membership',
    });
    assert.equal(inactivated.status, 'inactive');
    assert.throws(
      () => attemptCompanyRename(context, testActor({
        membershipId: membership.id,
        expectedMembershipVersion: inactivated.version,
      })),
      error => error.code === 'PLATFORM_IDENTITY_ACTOR_MEMBERSHIP_DENIED',
    );
  } finally {
    context.close();
  }
});

test('membership-free actor access is limited to empty-authority initial provisioning', () => {
  const { context } = createAuthorityWithActorMembership();
  try {
    assert.throws(() => context.repository.createRoleTemplate({
      companyId: 'company-a',
      templateKey: 'outsider-template',
      templateVersion: 1,
      displayName: 'Outsider template',
      capabilities: ['receivables.read'],
      actorContext: testActor({ principalId: 'U-finance' }),
      reason: 'must-require-company-membership',
    }), error => error.code === 'PLATFORM_IDENTITY_ACTOR_MEMBERSHIP_DENIED');
    assert.throws(() => context.repository.createMembership({
      id: 'outsider-created-membership',
      companyId: 'company-a',
      principalId: 'U-finance',
      status: 'active',
      roleTemplateKey: 'template-a',
      roleTemplateVersion: 1,
      companyWideBranchAuthority: false,
      branchIds: ['branch-a-2'],
      actorContext: testActor({ principalId: 'U-finance' }),
      reason: 'must-require-company-membership',
    }), error => error.code === 'PLATFORM_IDENTITY_ACTOR_MEMBERSHIP_DENIED');
  } finally {
    context.close();
  }
});

test('audit JSON recursively rejects secrets across naming styles and array nesting', () => {
  for (const payload of [
    { nested: { accessToken: 'secret' } },
    { nested: { access_token: 'secret' } },
    { nested: { 'access-token': 'secret' } },
    { nested: { AccessToken: 'secret' } },
    { nested: { clientSecret: 'secret' } },
    { items: [{ refresh_token: 'secret' }] },
    { passwordHash: 'secret' },
    { authorization: 'secret' },
    { cookie: 'secret' },
    { session: 'secret' },
    { sessionToken: 'secret' },
    { apiKey: 'secret' },
    { privateKey: 'secret' },
  ]) {
    assert.throws(
      () => auditJson(payload),
      error => error.code === 'PLATFORM_IDENTITY_AUDIT_SECRET_REJECTED',
    );
  }

  const deeplyNested = { level: {} };
  let cursor = deeplyNested.level;
  for (let index = 0; index < 10; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  cursor.client_secret = 'secret';
  assert.throws(
    () => auditJson(deeplyNested),
    error => error.code === 'PLATFORM_IDENTITY_AUDIT_SECRET_REJECTED',
  );
});

test('audit JSON rejects string payloads, exotic values, toJSON, cycles, depth, and size abuse', () => {
  const ownToJson = { safe: true };
  ownToJson.toJSON = () => ({ safe: false });
  const inheritedToJson = Object.create({ toJSON() { return {}; } });
  inheritedToJson.safe = true;
  class CustomPayload {
    constructor() {
      this.safe = true;
    }
  }
  const cyclic = { safe: true };
  cyclic.self = cyclic;
  const accessor = {};
  Object.defineProperty(accessor, 'safe', {
    enumerable: true,
    get() {
      throw new Error('must-not-run');
    },
  });
  const hidden = {};
  Object.defineProperty(hidden, 'hidden', {
    enumerable: false,
    value: 'not-json',
  });
  const symbolKey = { safe: true };
  symbolKey[Symbol('hidden')] = true;
  const sparse = [];
  sparse.length = 1;

  for (const payload of [
    '{"nested":{"accessToken":"secret"}}',
    'plain string',
    ownToJson,
    inheritedToJson,
    Object.create(null),
    new CustomPayload(),
    new Date(),
    Buffer.from('safe'),
    new Map([['safe', true]]),
    new Set(['safe']),
    () => {},
    Symbol('value'),
    1n,
    undefined,
    { nested: undefined },
    { nested: () => {} },
    { nested: Symbol('value') },
    { nested: 1n },
    { nested: Number.NaN },
    { nested: Number.POSITIVE_INFINITY },
    cyclic,
    accessor,
    hidden,
    symbolKey,
    sparse,
    new Proxy({ safe: true }, {}),
  ]) {
    assert.throws(
      () => auditJson(payload),
      error => error.code === 'PLATFORM_IDENTITY_AUDIT_JSON_REJECTED',
    );
  }

  const excessiveDepth = {};
  let cursor = excessiveDepth;
  for (let index = 0; index <= AUDIT_JSON_MAX_DEPTH; index += 1) {
    cursor.next = {};
    cursor = cursor.next;
  }
  assert.throws(
    () => auditJson(excessiveDepth),
    error => error.code === 'PLATFORM_IDENTITY_AUDIT_JSON_REJECTED',
  );
  assert.throws(
    () => auditJson({ value: 'x'.repeat(AUDIT_JSON_MAX_BYTES + 1) }),
    error => error.code === 'PLATFORM_IDENTITY_AUDIT_JSON_REJECTED',
  );
});

test('audit JSON accepts and canonicalizes safe nested objects and arrays', () => {
  assert.equal(
    auditJson({
      z: [null, true, 3, 'safe', { b: 2, a: 1 }],
      a: { child: ['one', 'two'] },
    }),
    '{"a":{"child":["one","two"]},"z":[null,true,3,"safe",{"a":1,"b":2}]}',
  );
  assert.equal(auditJson([null, { safe: true }, ['nested']]), '[null,{"safe":true},["nested"]]');
  assert.equal(auditJson(null), null);
});

test('audit serialization failure rolls back an enclosing authority mutation', () => {
  const { context, actorContext } = createAuthorityWithActorMembership();
  try {
    const companyBefore = context.repository.getCompany('company-a');
    const auditCountBefore = context.db.prepare(`
      SELECT COUNT(*) AS count FROM authorization_audit_events
    `).get().count;
    const mutateAndAudit = context.db.transaction(() => {
      context.db.prepare(`
        UPDATE canonical_companies
        SET displayName = ?, version = version + 1, updatedAt = ?
        WHERE id = ?
      `).run(
        'Must roll back',
        '2026-07-16T02:00:00.000Z',
        companyBefore.id,
      );
      context.repository.insertAudit({
        companyId: companyBefore.id,
        actorContext,
        action: 'test.serialization-failure',
        targetType: 'company',
        targetId: companyBefore.id,
        reasonCode: 'security-remediation-test',
        after: '{"nested":{"accessToken":"secret"}}',
      });
    });
    assert.throws(
      () => mutateAndAudit(),
      error => error.code === 'PLATFORM_IDENTITY_AUDIT_JSON_REJECTED',
    );
    assert.deepEqual(context.repository.getCompany('company-a'), companyBefore);
    assert.equal(context.db.prepare(`
      SELECT COUNT(*) AS count FROM authorization_audit_events
    `).get().count, auditCountBefore);
  } finally {
    context.close();
  }
});
