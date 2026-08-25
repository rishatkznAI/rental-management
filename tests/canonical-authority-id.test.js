import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const {
  canonicalHeadOfficeIdentityKey,
  canonicalMembershipIdentityKey,
  deriveCanonicalHeadOfficeId,
  deriveCanonicalMembershipId,
} = require('../server/lib/canonical-authority-id.js');

const COMPANY_ID = 'cmp_7EBGDGHTPDAZPZVFMUBVWAUZZLEENRMK5F7G7JRATQWDZJHGYQMQ';
const HEAD_OFFICE_ID = 'brn_VRNOM4ABOTHKRJYODGZSPVE3WPN6CGOJITLZBD2SCYWODKFF5NYQ';
const MEMBERSHIP_IDS = Object.freeze({
  '1775756913074': 'mbr_G2QDD6FEGGZ7TVGHUJQGJJM3JE4DM3HS43RNCDPUXXQ3BNZGAI7Q',
  '1776673416137': 'mbr_EYVSFKJBNRTLDU2ZTONKV5QCK37QB7FUARBUM6ORAHDUTMD5UJPA',
  '1787547467703': 'mbr_S2S4CR7EHVLAAEXCFMBML6IUUPAA7V7RCRCPSPB5OEJVZFGINMEA',
});

function readPlan() {
  return JSON.parse(readFileSync(
    new URL('../docs/production-scope-remediation-plan-2026-08-25.json', import.meta.url),
    'utf8',
  ));
}

test('Head Office ID is deterministic from immutable Company identity and kind', () => {
  const result = deriveCanonicalHeadOfficeId({ companyId: COMPANY_ID });

  assert.equal(
    result.canonicalIdentityKey,
    `rentcore:branch:v1|companyId=${COMPANY_ID}|kind=HEAD_OFFICE`,
  );
  assert.equal(result.sha256Hex, 'ac5ae6700174cea8a70e19b327d49bb3dbe119c944d7908f52162ce1a8a5eb71');
  assert.equal(result.base32Digest, 'VRNOM4ABOTHKRJYODGZSPVE3WPN6CGOJITLZBD2SCYWODKFF5NYQ');
  assert.equal(result.branchId, HEAD_OFFICE_ID);
  assert.equal(result.branchId.length, 56);
});

test('Head Office ID ignores mutable branch evidence and changes with Company identity', () => {
  const initial = deriveCanonicalHeadOfficeId({
    companyId: COMPANY_ID,
    displayName: 'Головной офис',
    address: 'Initial address',
    timezone: 'Europe/Moscow',
  });
  const renamed = deriveCanonicalHeadOfficeId({
    companyId: COMPANY_ID,
    displayName: 'Renamed',
    address: 'Different address',
    timezone: 'Asia/Yekaterinburg',
  });

  assert.deepEqual(renamed, initial);
  assert.notEqual(
    deriveCanonicalHeadOfficeId({ companyId: `cmp_${'A'.repeat(52)}` }).branchId,
    HEAD_OFFICE_ID,
  );
});

test('Membership IDs are deterministic per Company and stable principal ID', () => {
  for (const [principalId, expectedId] of Object.entries(MEMBERSHIP_IDS)) {
    const result = deriveCanonicalMembershipId({ companyId: COMPANY_ID, principalId });
    assert.equal(
      result.canonicalIdentityKey,
      `rentcore:membership:v1|companyId=${COMPANY_ID}|principalId=${principalId}`,
    );
    assert.equal(result.membershipId, expectedId);
    assert.equal(result.membershipId.length, 56);
  }
  assert.equal(new Set(Object.values(MEMBERSHIP_IDS)).size, 3);
});

test('authority identity keys reject separators, whitespace, and non-canonical Company IDs', () => {
  assert.throws(() => canonicalHeadOfficeIdentityKey({ companyId: 'company-name' }), /companyId is invalid/);
  assert.throws(
    () => canonicalMembershipIdentityKey({ companyId: COMPANY_ID, principalId: 'user|other' }),
    /principalId is invalid/,
  );
  assert.throws(
    () => deriveCanonicalMembershipId({ companyId: COMPANY_ID, principalId: 'user id' }),
    /principalId is invalid/,
  );
});

test('offline authority plan has one Head Office and exactly one active Membership per approved actor', () => {
  const plan = readPlan();
  const bootstrap = plan.proposedIdentityBootstrap;
  const approvedActorIds = Object.keys(MEMBERSHIP_IDS);

  assert.equal(bootstrap.executable, false);
  assert.equal(plan.authority.identityBootstrap, null);
  assert.equal(bootstrap.company.id, COMPANY_ID);
  assert.equal(bootstrap.company.receivablesTimezone, 'Europe/Moscow');
  assert.equal(bootstrap.branches.length, 1);
  assert.deepEqual(bootstrap.branches[0], {
    id: HEAD_OFFICE_ID,
    displayName: 'Головной офис',
    isHeadOffice: true,
    status: 'active',
  });
  assert.equal(plan.authority.headOffice.approvedAddressEvidence.includes('Островского'), true);
  assert.equal(plan.authority.headOffice.domainModelNote.includes('no address or timezone columns'), true);

  assert.equal(bootstrap.memberships.length, 3);
  assert.equal(new Set(bootstrap.memberships.map(item => item.principalId)).size, 3);
  assert.equal(new Set(bootstrap.memberships.map(item => item.id)).size, 3);
  for (const principalId of approvedActorIds) {
    const matches = bootstrap.memberships.filter(item => (
      item.principalId === principalId && item.status === 'active'
    ));
    assert.equal(matches.length, 1, principalId);
    assert.equal(matches[0].id, MEMBERSHIP_IDS[principalId], principalId);
  }
  assert.equal(bootstrap.memberships.some(item => item.principalId === 'production-smoke-admin'), false);
});

test('role templates and branch authority use minimum canonical catalog privileges', () => {
  const plan = readPlan();
  const bootstrap = plan.proposedIdentityBootstrap;
  const templates = new Map(bootstrap.roleTemplates.map(template => [template.templateKey, template]));
  const memberships = new Map(bootstrap.memberships.map(membership => [membership.principalId, membership]));

  assert.deepEqual(templates.get('company-administrator').capabilities, [
    'branches.manage',
    'companies.manage',
    'members.manage',
  ]);
  assert.deepEqual(templates.get('office-manager').capabilities, []);
  assert.deepEqual(templates.get('rental-manager').capabilities, []);

  assert.equal(memberships.get('1775756913074').companyWideBranchAuthority, true);
  assert.deepEqual(memberships.get('1775756913074').branchIds, []);
  for (const principalId of ['1776673416137', '1787547467703']) {
    assert.equal(memberships.get(principalId).companyWideBranchAuthority, false);
    assert.deepEqual(memberships.get(principalId).branchIds, [HEAD_OFFICE_ID]);
  }
  assert.equal(plan.expectedPostState.membershipBranchAccessRows, 2);
  assert.equal(plan.expectedPostState.tenantCompanyMismatch, 0);
});

test('Phase A scope updates and Phase B cleanup remain exact-ID and disjoint', () => {
  const plan = readPlan();
  const updateIds = new Set(plan.proposedPhaseA.update.map(value => value.split(':').at(-1)));
  const cleanupIds = new Set(plan.proposedPhaseB.mutations.map(item => item.id));

  assert.deepEqual(updateIds, new Set([
    'CP-1787305873918-cb43be',
    'CPRA-19e67e15a554df5b2d434852',
    'C-1787305873917-d5aa12',
    'CO-1787567881301-0301ec',
  ]));
  assert.equal([...updateIds].some(id => cleanupIds.has(id)), false);
  assert.equal(plan.proposedPhaseA.wildcardBackfill, false);
  assert.equal(plan.proposedPhaseB.includedInPhaseA, false);
  assert.equal(
    plan.proposedPhaseB.mutations.find(item => item.id === 'C-1787585239478-5b4168').action,
    'NO_ACTION_DO_NOT_RESTORE',
  );
});

test('blocked fresh audit cannot be mistaken for an executable or approved plan', () => {
  const plan = readPlan();

  assert.equal(plan.authority.status, 'PENDING_VERIFIED_PRODUCTION_DRY_RUN');
  assert.equal(plan.freshProductionAudit.status, 'BLOCKED_SSH_HOST_IDENTITY_NOT_VERIFIED');
  assert.equal(plan.freshProductionAudit.sshAttempted, false);
  assert.equal(plan.freshProductionAudit.unsafeOverridesUsed, false);
  assert.equal(plan.freshProductionAudit.databaseEvidence.readOnlyConnection, 'NOT_OPENED');
  assert.equal(plan.backup.verified, false);
  assert.equal(plan.productionWrites, 'NONE');
  assert.equal(plan.deploy, 'NOT_PERFORMED');
});
