import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  ensureCanonicalReceivablesSchema,
} = require('../server/lib/canonical-receivables-schema.js');
const {
  ensureCanonicalReceivablesSettlementSchema,
} = require('../server/lib/canonical-receivables-settlement-schema.js');
const {
  ensurePlatformIdentitySchema,
} = require('../server/lib/platform-identity-schema.js');
const {
  createPlatformIdentityRepository,
  createTrustedUserActorContext,
} = require('../server/lib/platform-identity-repository.js');

export const DEFAULT_USERS = Object.freeze([
  Object.freeze({
    id: 'U-admin',
    status: 'Активен',
    role: 'Администратор',
    name: 'Legacy admin display only',
  }),
  Object.freeze({
    id: 'U-finance',
    status: 'Активен',
    role: 'Офис-менеджер',
    name: 'Legacy finance display only',
  }),
]);

export function createPlatformIdentityContext({
  users = DEFAULT_USERS,
  beforeAuditInsert,
  dbPath = ':memory:',
} = {}) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)').run(
    'users',
    JSON.stringify(users),
  );
  ensureCanonicalReceivablesSchema(db);
  ensureCanonicalReceivablesSettlementSchema(db);
  ensurePlatformIdentitySchema(db);
  const readUsers = () => JSON.parse(
    db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json,
  );
  let sequence = 0;
  const repository = createPlatformIdentityRepository(db, {
    readUsers,
    nowIso: () => `2026-07-16T00:00:${String(sequence++).padStart(2, '0')}.000Z`,
    generateId: prefix => `${prefix}-${++sequence}`,
    beforeAuditInsert,
  });
  return {
    db,
    repository,
    readUsers,
    close() {
      db.close();
    },
  };
}

export function testActor(overrides = {}) {
  return createTrustedUserActorContext({
    principalId: overrides.principalId || 'U-admin',
    membershipId: overrides.membershipId,
    expectedMembershipVersion: overrides.expectedMembershipVersion,
    correlationId: overrides.correlationId || 'test-correlation-1',
  });
}

export function seedAuthority(context, {
  companyId = 'company-a',
  branches = [
    { id: 'branch-a-ho', displayName: 'Head Office', isHeadOffice: true },
    { id: 'branch-a-1', displayName: 'Branch A1', isHeadOffice: false },
    { id: 'branch-a-2', displayName: 'Branch A2', isHeadOffice: false },
  ],
  templateKey = 'template-a',
  templateCapabilities = ['receivables.read'],
} = {}) {
  const actorContext = testActor();
  context.repository.createCompanyAuthority({
    company: {
      id: companyId,
      displayName: `Company ${companyId}`,
      receivablesTimezone: 'Europe/Moscow',
    },
    branches,
    actorContext,
    reason: 'test-approved',
  });
  context.repository.createRoleTemplate({
    companyId,
    templateKey,
    templateVersion: 1,
    displayName: `Template ${templateKey}`,
    capabilities: templateCapabilities,
    actorContext,
    reason: 'test-approved',
  });
  return { actorContext, companyId, templateKey };
}
