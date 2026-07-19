import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  createBillingSourceContext,
  SOURCE_CAPABILITIES,
} from './billing-source-authority-fixtures.js';
import {
  createActualSourceDryRunContext,
  dryRunCommand,
  seedPositiveSource,
} from './actual-source-eligibility-dry-run-fixtures.js';

const require = createRequire(import.meta.url);
const {
  createTrustedUserActorContext,
} = require('../server/lib/platform-identity-repository.js');
const {
  ensureForecastReceivablesPlanningSchema,
} = require('../server/lib/forecast-receivables-planning-schema.js');
const {
  ensureActualSourceEligibilityDryRunSchema,
} = require('../server/lib/actual-source-eligibility-dry-run-schema.js');
const {
  createActualSourceEligibilityDryRunReadRepository,
  createActualSourceEligibilityDryRunReadScope,
} = require('../server/lib/actual-source-eligibility-dry-run-read-repository.js');

function createPersistedDiagnosticContext(options = {}) {
  const context = createActualSourceDryRunContext(options);
  seedPositiveSource(context);
  const result = context.dryRunService.evaluateActualSourceDryRun(
    context.dryRunContext,
    dryRunCommand({ idempotencyKey: `read-fresh-${options.id || 'default'}` }),
  );
  assert.equal(context.readRepository.getDryRun(context.readScope, result.dryRunId).dryRunId, result.dryRunId);
  return { context, result };
}

function assertFreshReadDenied(context, result) {
  assert.throws(
    () => context.readRepository.getDryRun(context.readScope, result.dryRunId),
    error => typeof error.code === 'string' && error.code.startsWith('PLATFORM_'),
  );
  assert.throws(
    () => context.readRepository.listCandidates(context.readScope, result.dryRunId),
    error => typeof error.code === 'string' && error.code.startsWith('PLATFORM_'),
  );
}

test('every diagnostic read reauthorizes live membership, role, catalog, capability and user state', async t => {
  const scenarios = [
    {
      name: 'membership-revoked',
      mutate(db) {
        db.prepare(`
          UPDATE company_memberships
          SET status = 'revoked', version = version + 1, updatedAt = ?, revokedAt = ?,
              updatedBy = 'U-billing', revokedBy = 'U-billing', reason = 'read revoke test'
          WHERE id = 'membership-billing'
        `).run('2026-09-16T00:00:00.000Z', '2026-09-16T00:00:00.000Z');
      },
    },
    {
      name: 'membership-version-changed',
      mutate(db) {
        db.prepare(`
          UPDATE company_memberships
          SET version = version + 1, updatedAt = ?, updatedBy = 'U-billing', reason = 'read version test'
          WHERE id = 'membership-billing'
        `).run('2026-09-16T00:00:00.000Z');
      },
    },
    {
      name: 'role-template-changed',
      mutate(_db, context) {
        context.platformRepository.createRoleTemplate({
          companyId: 'company-a',
          templateKey: 'billing-source-no-read',
          templateVersion: 1,
          displayName: 'Billing source without receivables read',
          capabilities: SOURCE_CAPABILITIES,
          actorContext: context.readActorContext,
          reason: 'read role change test',
          timestamp: '2026-09-16T00:00:00.000Z',
        });
        context.platformRepository.updateMembership({
          membershipId: 'membership-billing',
          expectedVersion: Number(context.db.prepare(`
            SELECT version FROM company_memberships WHERE id = 'membership-billing'
          `).get().version),
          roleTemplateKey: 'billing-source-no-read',
          roleTemplateVersion: 1,
          actorContext: context.readActorContext,
          reason: 'read role change test',
          timestamp: '2026-09-16T00:00:01.000Z',
        });
      },
    },
    {
      name: 'capability-revoked',
      mutate(db) {
        db.prepare(`
          INSERT INTO membership_capability_assignments (
            id, membershipId, companyId, catalogVersion, capabilityKey, effect,
            status, version, grantedAt, grantedBy, reason
          ) VALUES (
            'deny-receivables-read', 'membership-billing', 'company-a', 1,
            'receivables.read', 'deny', 'active', 1, ?, 'U-billing', 'read deny test'
          )
        `).run('2026-09-16T00:00:00.000Z');
      },
    },
    {
      name: 'capability-catalog-changed',
      mutate(db) {
        db.exec('DROP TRIGGER trg_capability_catalog_versions_no_update');
        db.prepare('UPDATE capability_catalog_versions SET status = ? WHERE version = 1').run('inactive');
      },
    },
    {
      name: 'branch-access-revoked',
      mutate(db) {
        db.prepare(`
          UPDATE membership_branch_access
          SET status = 'revoked', version = version + 1, revokedAt = ?,
              revokedBy = 'U-billing', reason = 'read branch revoke test'
          WHERE membershipId = 'membership-billing' AND branchId = 'branch-a-1'
        `).run('2026-09-16T00:00:00.000Z');
      },
    },
    {
      name: 'legacy-human-principal-disabled',
      mutate(db) {
        const users = JSON.parse(db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json);
        const changed = users.map(user => (
          user.id === 'U-billing' ? { ...user, status: 'Заблокирован' } : user
        ));
        db.prepare("UPDATE app_data SET json = ? WHERE name = 'users'").run(JSON.stringify(changed));
      },
    },
  ];

  for (const [index, scenario] of scenarios.entries()) {
    await t.test(scenario.name, () => {
      const { context, result } = createPersistedDiagnosticContext({ id: index });
      try {
        scenario.mutate(context.db, context);
        assertFreshReadDenied(context, result);
      } finally {
        context.close();
      }
    });
  }
});

test('deactivated branch invalidates an already-issued read scope', () => {
  const { context, result } = createPersistedDiagnosticContext({
    id: 'branch-deactivated',
    companyWideBranchAuthority: true,
  });
  try {
    const branch = context.db.prepare(`
      SELECT version FROM canonical_branches
      WHERE companyId = 'company-a' AND id = 'branch-a-1'
    `).get();
    context.platformRepository.updateBranch({
      companyId: 'company-a',
      branchId: 'branch-a-1',
      expectedVersion: Number(branch.version),
      status: 'inactive',
      actorContext: context.readActorContext,
      reason: 'read branch deactivate test',
      timestamp: '2026-09-16T00:00:00.000Z',
    });
    assertFreshReadDenied(context, result);
  } finally {
    context.close();
  }
});

test('forged, wrong-company, unauthorized-branch and integration scopes cannot be issued', () => {
  const context = createActualSourceDryRunContext();
  try {
    assert.throws(
      () => context.readRepository.listDryRuns({ ...context.readScope }),
      error => error.code === 'ACTUAL_SOURCE_READ_SCOPE_REQUIRED',
    );
    assert.throws(
      () => createActualSourceEligibilityDryRunReadScope(
        context.db,
        { ...context.readActorContext },
        { branchId: 'branch-a-1' },
      ),
      error => error.code === 'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
    );
    assert.throws(
      () => createActualSourceEligibilityDryRunReadScope(
        context.db,
        context.readActorContext,
        { companyId: 'company-b' },
      ),
      error => error.code === 'ACTUAL_SOURCE_READ_SCOPE_DENIED',
    );
    assert.throws(
      () => createActualSourceEligibilityDryRunReadScope(
        context.db,
        context.readActorContext,
        { branchId: 'branch-a-2' },
      ),
      error => typeof error.code === 'string' && error.code.startsWith('PLATFORM_'),
    );
    assert.throws(
      () => createActualSourceEligibilityDryRunReadScope(
        context.db,
        { principalType: 'integration', principalId: 'integration-1' },
      ),
      error => error.code === 'PLATFORM_IDENTITY_ACTOR_CONTEXT_REJECTED',
    );
  } finally {
    context.close();
  }
});

test('legacy Administrator label without receivables.read cannot issue read authority', () => {
  const base = createBillingSourceContext({ capabilities: SOURCE_CAPABILITIES });
  try {
    ensureForecastReceivablesPlanningSchema(base.db);
    ensureActualSourceEligibilityDryRunSchema(base.db);
    const actor = createTrustedUserActorContext({
      principalId: base.platformScope.principalId,
      membershipId: base.platformScope.membershipId,
      expectedMembershipVersion: base.platformScope.membershipVersion,
      correlationId: 'administrator-without-read',
    });
    const repository = createActualSourceEligibilityDryRunReadRepository(base.db);
    assert.ok(repository);
    assert.throws(
      () => createActualSourceEligibilityDryRunReadScope(base.db, actor, { branchId: 'branch-a-1' }),
      error => error.code === 'PLATFORM_CAPABILITY_DENIED',
    );
  } finally {
    base.close();
  }
});
