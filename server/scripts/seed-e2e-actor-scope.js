const crypto = require('crypto');
const {
  ensureDb,
  getData,
  setData,
} = require('../db');
const {
  createPlatformIdentityRepository,
  createTrustedUserActorContext,
} = require('../lib/platform-identity-repository');

const E2E_COMPANY_ID = 'e2e-company';
const E2E_MEMBERSHIP_ID = 'e2e-admin-membership';
const E2E_PRINCIPAL_ID = 'U-reset-admin';
const E2E_TEMPLATE_KEY = 'e2e-admin-template';

function legacyPasswordHash(password) {
  const value = crypto.createHash('sha256')
    .update(`${password}:rental-mgmt-v1`)
    .digest('hex');
  return `h1:${value}`;
}

function seedE2eActorScope() {
  if (process.env.E2E_TRUSTED_SCOPE_BOOTSTRAP !== '1' || process.env.NODE_ENV !== 'test') {
    throw new Error('E2E actor-scope bootstrap is restricted to explicit NODE_ENV=test runs.');
  }

  const email = String(process.env.E2E_ADMIN_EMAIL || 'smoke-admin@yandex.ru').trim().toLowerCase();
  const password = String(process.env.E2E_ADMIN_PASSWORD || '123123');
  const db = ensureDb();
  const users = (getData('users') || [])
    .filter(user => (
      String(user?.id || '') !== E2E_PRINCIPAL_ID
      && String(user?.email || '').trim().toLowerCase() !== email
    ));
  users.push({
    id: E2E_PRINCIPAL_ID,
    name: 'E2E Administrator',
    email,
    role: 'Администратор',
    status: 'Активен',
    password: legacyPasswordHash(password),
    tokenVersion: 0,
  });
  setData('users', users);

  const readUsers = () => getData('users') || [];
  let sequence = 0;
  const repository = createPlatformIdentityRepository(db, {
    readUsers,
    nowIso: () => new Date().toISOString(),
    generateId: prefix => `${prefix}-e2e-${++sequence}`,
  });
  const actorContext = createTrustedUserActorContext({
    principalId: E2E_PRINCIPAL_ID,
    correlationId: 'playwright-e2e-actor-scope-bootstrap',
  });

  if (!repository.getCompany(E2E_COMPANY_ID)) {
    repository.createCompanyAuthority({
      company: {
        id: E2E_COMPANY_ID,
        displayName: 'E2E Company',
        receivablesTimezone: 'Europe/Moscow',
      },
      branches: [{
        id: 'e2e-head-office',
        displayName: 'E2E Head Office',
        isHeadOffice: true,
      }],
      actorContext,
      reason: 'playwright-e2e-bootstrap',
    });
  }

  if (!repository.getRoleTemplate(E2E_COMPANY_ID, E2E_TEMPLATE_KEY, 1)) {
    repository.createRoleTemplate({
      companyId: E2E_COMPANY_ID,
      templateKey: E2E_TEMPLATE_KEY,
      templateVersion: 1,
      displayName: 'E2E Administrator',
      capabilities: [],
      actorContext,
      reason: 'playwright-e2e-bootstrap',
    });
  }

  const membership = repository.getMembership(E2E_MEMBERSHIP_ID);
  if (!membership) {
    repository.createMembership({
      id: E2E_MEMBERSHIP_ID,
      companyId: E2E_COMPANY_ID,
      principalId: E2E_PRINCIPAL_ID,
      status: 'active',
      roleTemplateKey: E2E_TEMPLATE_KEY,
      roleTemplateVersion: 1,
      companyWideBranchAuthority: true,
      branchIds: [],
      actorContext,
      reason: 'playwright-e2e-bootstrap',
    });
  } else if (
    membership.status !== 'active'
    || membership.companyId !== E2E_COMPANY_ID
    || membership.principalId !== E2E_PRINCIPAL_ID
  ) {
    throw new Error('Existing E2E membership does not match the trusted actor-scope contract.');
  }
}

module.exports = {
  E2E_COMPANY_ID,
  E2E_MEMBERSHIP_ID,
  E2E_PRINCIPAL_ID,
  seedE2eActorScope,
};
