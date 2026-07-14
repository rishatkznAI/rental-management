import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
  CANONICAL_RECEIVABLES_MIGRATION_ID,
  CANONICAL_RECEIVABLES_SCHEMA_VERSION,
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
  ensureCanonicalReceivablesSchema,
} = require('../server/lib/canonical-receivables-schema.js');
const canonicalRepositoryModule = require('../server/lib/canonical-receivables-repository.js');
const {
  createCanonicalReceivablesRepository,
} = canonicalRepositoryModule;

function makeDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-receivables-pr1-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    INSERT INTO app_data (name, json) VALUES ('legacy_probe', '[{"id":"legacy-1"}]');
  `);
  return { db, dbPath, dir };
}

function closeDb({ db, dir }) {
  db.close();
  fs.rmSync(dir, { recursive: true, force: true });
}

function seedScopes(db) {
  const insertCompany = db.prepare(`
    INSERT INTO ${CANONICAL_COMPANIES_TABLE} (id, receivablesTimezone)
    VALUES (?, ?)
  `);
  const insertBranch = db.prepare(`
    INSERT INTO ${CANONICAL_BRANCHES_TABLE} (companyId, id, isHeadOffice)
    VALUES (?, ?, ?)
  `);
  insertCompany.run('company-1', 'Europe/Moscow');
  insertCompany.run('company-2', 'Europe/Moscow');
  insertBranch.run('company-1', 'branch-1', 1);
  insertBranch.run('company-2', 'branch-2', 1);
}

function receivable(overrides = {}) {
  return {
    id: 'receivable-1',
    companyId: 'company-1',
    branchId: 'branch-1',
    clientId: 'client-1',
    contractId: null,
    rentalId: null,
    sourceDocumentType: 'unconfirmed_source_type',
    sourceDocumentId: 'source-1',
    sourceLineId: null,
    sourceSystem: 'test_source',
    externalId: null,
    idempotencyKey: 'idempotency-1',
    currency: 'RUB',
    originalAmountMinor: 15000,
    issuedAt: null,
    postedAt: null,
    contractualDueDate: null,
    dueDateProvenance: 'unknown',
    companyTimezone: 'Europe/Moscow',
    workflowStatus: 'draft',
    cancellationReason: null,
    description: null,
    createdAt: '2026-07-13T09:00:00.000Z',
    updatedAt: '2026-07-13T09:00:00.000Z',
    cancelledAt: null,
    closedAt: null,
    writtenOffAt: null,
    version: 1,
    ...overrides,
  };
}

function insertReceivable(db, row) {
  return db.prepare(`
    INSERT INTO ${CANONICAL_RECEIVABLES_TABLE} (
      id,
      companyId,
      branchId,
      clientId,
      contractId,
      rentalId,
      sourceDocumentType,
      sourceDocumentId,
      sourceLineId,
      sourceSystem,
      externalId,
      idempotencyKey,
      currency,
      originalAmountMinor,
      issuedAt,
      postedAt,
      contractualDueDate,
      dueDateProvenance,
      companyTimezone,
      workflowStatus,
      cancellationReason,
      description,
      createdAt,
      updatedAt,
      cancelledAt,
      closedAt,
      writtenOffAt,
      version
    ) VALUES (
      @id,
      @companyId,
      @branchId,
      @clientId,
      @contractId,
      @rentalId,
      @sourceDocumentType,
      @sourceDocumentId,
      @sourceLineId,
      @sourceSystem,
      @externalId,
      @idempotencyKey,
      @currency,
      @originalAmountMinor,
      @issuedAt,
      @postedAt,
      @contractualDueDate,
      @dueDateProvenance,
      @companyTimezone,
      @workflowStatus,
      @cancellationReason,
      @description,
      @createdAt,
      @updatedAt,
      @cancelledAt,
      @closedAt,
      @writtenOffAt,
      @version
    )
  `).run(row);
}

function indexColumns(db, indexName) {
  return db.prepare(`PRAGMA index_info(${indexName})`).all().map(column => column.name);
}

test('PR1 migration creates the canonical tables idempotently without changing legacy rows or creating financial rows', () => {
  const context = makeDb();
  try {
    const legacySqlBefore = context.db.prepare(`
      SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'app_data'
    `).get().sql;
    assert.equal(ensureCanonicalReceivablesSchema(context.db), true);
    context.db.prepare(`
      UPDATE sql_shadow_schema_migrations
      SET applied_at = '2000-01-01 00:00:00'
      WHERE name = ?
    `).run(CANONICAL_RECEIVABLES_MIGRATION_ID);
    assert.equal(ensureCanonicalReceivablesSchema(context.db), false);

    const tables = new Set(context.db.prepare(`
      SELECT name FROM sqlite_master WHERE type = 'table'
    `).all().map(row => row.name));
    for (const table of [
      CANONICAL_COMPANIES_TABLE,
      CANONICAL_BRANCHES_TABLE,
      CANONICAL_RECEIVABLES_TABLE,
      FINANCIAL_AUDIT_EVENTS_TABLE,
    ]) {
      assert.ok(tables.has(table), `${table} should exist`);
    }

    const columns = new Map(context.db.prepare(`
      PRAGMA table_info(${CANONICAL_RECEIVABLES_TABLE})
    `).all().map(column => [column.name, column]));
    for (const field of [
      'id',
      'companyId',
      'branchId',
      'clientId',
      'contractId',
      'rentalId',
      'sourceDocumentType',
      'sourceDocumentId',
      'sourceLineId',
      'sourceSystem',
      'externalId',
      'idempotencyKey',
      'currency',
      'originalAmountMinor',
      'issuedAt',
      'postedAt',
      'contractualDueDate',
      'dueDateProvenance',
      'companyTimezone',
      'workflowStatus',
      'description',
      'createdAt',
      'updatedAt',
      'cancelledAt',
      'closedAt',
      'writtenOffAt',
      'version',
    ]) {
      assert.ok(columns.has(field), `${field} should exist`);
    }
    for (const requiredField of [
      'companyId',
      'branchId',
      'clientId',
      'sourceDocumentType',
      'sourceDocumentId',
      'sourceSystem',
      'idempotencyKey',
      'currency',
      'originalAmountMinor',
      'dueDateProvenance',
      'companyTimezone',
      'workflowStatus',
      'createdAt',
      'updatedAt',
      'version',
    ]) {
      assert.equal(columns.get(requiredField).notnull, 1, `${requiredField} should be NOT NULL`);
    }
    const companyColumns = new Map(context.db.prepare(`
      PRAGMA table_info(${CANONICAL_COMPANIES_TABLE})
    `).all().map(column => [column.name, column]));
    assert.equal(companyColumns.get('receivablesTimezone').notnull, 1);
    const auditColumns = new Set(context.db.prepare(`
      PRAGMA table_info(${FINANCIAL_AUDIT_EVENTS_TABLE})
    `).all().map(column => column.name));
    for (const field of [
      'id',
      'companyId',
      'branchId',
      'aggregateType',
      'aggregateId',
      'eventType',
      'actorId',
      'actorType',
      'occurredAt',
      'reason',
      'previousValueJson',
      'newValueJson',
      'correlationId',
      'sourceSystem',
      'createdAt',
    ]) {
      assert.ok(auditColumns.has(field), `${field} should exist on the audit table`);
    }

    const migration = context.db.prepare(`
      SELECT version, applied_at FROM sql_shadow_schema_migrations WHERE name = ?
    `).get(CANONICAL_RECEIVABLES_MIGRATION_ID);
    assert.equal(migration.version, CANONICAL_RECEIVABLES_SCHEMA_VERSION);
    assert.equal(migration.applied_at, '2000-01-01 00:00:00');
    assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${CANONICAL_RECEIVABLES_TABLE}`).get().count, 0);
    assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${FINANCIAL_AUDIT_EVENTS_TABLE}`).get().count, 0);
    assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${CANONICAL_COMPANIES_TABLE}`).get().count, 0);
    assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${CANONICAL_BRANCHES_TABLE}`).get().count, 0);
    assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM app_data`).get().count, 1);
    assert.equal(
      context.db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'app_data'`).get().sql,
      legacySqlBefore,
    );
  } finally {
    closeDb(context);
  }
});

test('receivable table exposes every required company-first index', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSchema(context.db);
    const expected = {
      idx_canonical_receivables_company: ['companyId'],
      idx_canonical_receivables_company_branch: ['companyId', 'branchId'],
      idx_canonical_receivables_company_client: ['companyId', 'clientId'],
      idx_canonical_receivables_company_workflow: ['companyId', 'workflowStatus'],
      idx_canonical_receivables_company_due_date: ['companyId', 'contractualDueDate'],
      uq_canonical_receivables_source_identity: [
        'companyId',
        'sourceSystem',
        'sourceDocumentType',
        'sourceDocumentId',
        'normalizedSourceLineId',
      ],
      uq_canonical_receivables_idempotency: ['companyId', 'idempotencyKey'],
      uq_canonical_receivables_external_identity: ['companyId', 'sourceSystem', 'externalId'],
    };
    const indexes = new Set(context.db.prepare(`
      PRAGMA index_list(${CANONICAL_RECEIVABLES_TABLE})
    `).all().map(index => index.name));
    for (const [name, columns] of Object.entries(expected)) {
      assert.ok(indexes.has(name), `${name} should exist`);
      assert.deepEqual(indexColumns(context.db, name), columns);
      assert.equal(columns[0], 'companyId');
    }
  } finally {
    closeDb(context);
  }
});

test('mandatory scope, integer minor-unit money, RUB, version, and approved workflow constraints are enforced', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSchema(context.db);
    seedScopes(context.db);

    for (const field of ['companyId', 'branchId', 'clientId']) {
      assert.throws(() => insertReceivable(context.db, receivable({
        id: `missing-${field}`,
        idempotencyKey: `missing-${field}`,
        sourceDocumentId: `missing-${field}`,
        [field]: null,
      })));
    }
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'float-amount',
      sourceDocumentId: 'float-amount',
      idempotencyKey: 'float-amount',
      originalAmountMinor: 10.5,
    })));
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'negative-amount',
      sourceDocumentId: 'negative-amount',
      idempotencyKey: 'negative-amount',
      originalAmountMinor: -1,
    })));
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'unsupported-currency',
      sourceDocumentId: 'unsupported-currency',
      idempotencyKey: 'unsupported-currency',
      currency: 'USD',
    })));
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'bad-version',
      sourceDocumentId: 'bad-version',
      idempotencyKey: 'bad-version',
      version: 0,
    })));
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'bad-status',
      sourceDocumentId: 'bad-status',
      idempotencyKey: 'bad-status',
      workflowStatus: 'paid',
    })));
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'bad-contractual-date',
      sourceDocumentId: 'bad-contractual-date',
      idempotencyKey: 'bad-contractual-date',
      contractualDueDate: '2026-99-99',
    })));

    insertReceivable(context.db, receivable({
      id: 'zero-draft',
      sourceDocumentId: 'zero-draft',
      idempotencyKey: 'zero-draft',
      originalAmountMinor: 0,
    }));
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'zero-posted',
      sourceDocumentId: 'zero-posted',
      idempotencyKey: 'zero-posted',
      originalAmountMinor: 0,
      workflowStatus: 'posted',
      postedAt: '2026-07-13T09:00:00.000Z',
    })));
  } finally {
    closeDb(context);
  }
});

test('source, idempotency, and external uniqueness are company-scoped with safe null normalization', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSchema(context.db);
    seedScopes(context.db);
    insertReceivable(context.db, receivable());
    assert.equal(context.db.prepare(`
      SELECT normalizedSourceLineId
      FROM ${CANONICAL_RECEIVABLES_TABLE}
      WHERE id = 'receivable-1'
    `).get().normalizedSourceLineId, '__document_total__');

    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'same-source-empty-line',
      sourceLineId: '',
      idempotencyKey: 'idempotency-2',
    })), /UNIQUE constraint failed/);
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'same-source-whitespace-line',
      sourceLineId: '   ',
      idempotencyKey: 'idempotency-3',
    })), /UNIQUE constraint failed/);
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'same-idempotency',
      sourceDocumentId: 'different-source',
      sourceLineId: 'line-2',
    })), /UNIQUE constraint failed/);

    insertReceivable(context.db, receivable({
      id: 'second-null-external-id',
      sourceDocumentId: 'second-null-external-id',
      idempotencyKey: 'second-null-external-id',
    }));
    insertReceivable(context.db, receivable({
      id: 'cross-company',
      companyId: 'company-2',
      branchId: 'branch-2',
    }));
    insertReceivable(context.db, receivable({
      id: 'external-id-owner',
      sourceDocumentId: 'external-id-owner',
      idempotencyKey: 'external-id-owner',
      externalId: 'external-1',
    }));
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'duplicate-external-id',
      sourceDocumentId: 'duplicate-external-id',
      idempotencyKey: 'duplicate-external-id',
      externalId: 'external-1',
    })), /UNIQUE constraint failed/);
    insertReceivable(context.db, receivable({
      id: 'other-source-system-external-id',
      sourceSystem: 'other_source',
      sourceDocumentId: 'other-source-system-external-id',
      idempotencyKey: 'other-source-system-external-id',
      externalId: 'external-1',
    }));

    assert.equal(context.db.prepare(`
      SELECT COUNT(*) AS count
      FROM ${CANONICAL_RECEIVABLES_TABLE}
      WHERE companyId = 'company-1' AND externalId IS NULL
    `).get().count, 2);
    assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${CANONICAL_RECEIVABLES_TABLE}`).get().count, 5);
  } finally {
    closeDb(context);
  }
});

test('each company can have only one Head Office branch', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSchema(context.db);
    seedScopes(context.db);
    assert.throws(() => context.db.prepare(`
      INSERT INTO ${CANONICAL_BRANCHES_TABLE} (companyId, id, isHeadOffice)
      VALUES ('company-1', 'second-head-office', 1)
    `).run(), /UNIQUE constraint failed/);
    context.db.prepare(`
      INSERT INTO ${CANONICAL_BRANCHES_TABLE} (companyId, id, isHeadOffice)
      VALUES ('company-1', 'operating-branch', 0)
    `).run();
    assert.equal(context.db.prepare(`
      SELECT COUNT(*) AS count
      FROM ${CANONICAL_BRANCHES_TABLE}
      WHERE isHeadOffice = 1
    `).get().count, 2);
  } finally {
    closeDb(context);
  }
});

test('due-date provenance constraints accept unknown without a date and require dates for accepted provenance', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSchema(context.db);
    seedScopes(context.db);

    insertReceivable(context.db, receivable());
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'missing-accepted-date',
      sourceDocumentId: 'missing-accepted-date',
      idempotencyKey: 'missing-accepted-date',
      dueDateProvenance: 'invoice_due_date',
    })));
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'bad-provenance',
      sourceDocumentId: 'bad-provenance',
      idempotencyKey: 'bad-provenance',
      dueDateProvenance: 'expected_payment_date',
    })));
    insertReceivable(context.db, receivable({
      id: 'accepted-date',
      sourceDocumentId: 'accepted-date',
      idempotencyKey: 'accepted-date',
      contractualDueDate: '2026-07-31',
      dueDateProvenance: 'contractual_payment_due_date',
    }));
  } finally {
    closeDb(context);
  }
});

test('composite company/branch foreign keys reject cross-company ownership', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSchema(context.db);
    seedScopes(context.db);
    assert.equal(context.db.pragma('foreign_keys', { simple: true }), 1);
    assert.throws(() => insertReceivable(context.db, receivable({
      id: 'branch-mismatch',
      branchId: 'branch-2',
      sourceDocumentId: 'branch-mismatch',
      idempotencyKey: 'branch-mismatch',
    })), /FOREIGN KEY constraint failed/);
  } finally {
    closeDb(context);
  }
});

test('posted receivable immutable fields are blocked while approved metadata changes remain possible', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSchema(context.db);
    seedScopes(context.db);
    insertReceivable(context.db, receivable({
      workflowStatus: 'posted',
      postedAt: '2026-07-13T09:00:00.000Z',
    }));
    for (const [field, sqlValue] of [
      ['originalAmountMinor', 'originalAmountMinor + 1'],
      ['companyId', "'company-2'"],
      ['branchId', "'branch-2'"],
      ['clientId', "'client-2'"],
      ['sourceSystem', "'other_source'"],
      ['sourceDocumentType', "'other_type'"],
      ['sourceDocumentId', "'other-document'"],
      ['sourceLineId', "''"],
      ['sourceLineId', "'   '"],
      ['sourceLineId', "'other-line'"],
      ['currency', "'USD'"],
      ['companyTimezone', "'Asia/Yekaterinburg'"],
    ]) {
      assert.throws(() => context.db.prepare(`
        UPDATE ${CANONICAL_RECEIVABLES_TABLE}
        SET ${field} = ${sqlValue}
        WHERE id = 'receivable-1'
      `).run(), /posted receivable immutable fields cannot change/);
    }

    context.db.prepare(`
      UPDATE ${CANONICAL_RECEIVABLES_TABLE}
      SET workflowStatus = 'disputed',
          description = 'Dispute is tracked through append-only audit metadata',
          updatedAt = '2026-07-13T10:00:00.000Z',
          version = 2
      WHERE id = 'receivable-1'
    `).run();
    const updated = context.db.prepare(`
      SELECT workflowStatus, description, updatedAt, version
      FROM ${CANONICAL_RECEIVABLES_TABLE}
      WHERE id = 'receivable-1'
    `).get();
    assert.deepEqual(updated, {
      workflowStatus: 'disputed',
      description: 'Dispute is tracked through append-only audit metadata',
      updatedAt: '2026-07-13T10:00:00.000Z',
      version: 2,
    });
  } finally {
    closeDb(context);
  }
});

test('repository reads require company scope and cannot return another company records', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSchema(context.db);
    seedScopes(context.db);
    insertReceivable(context.db, receivable());
    insertReceivable(context.db, receivable({
      id: 'company-2-receivable',
      companyId: 'company-2',
      branchId: 'branch-2',
    }));
    const repository = createCanonicalReceivablesRepository(context.db);
    assert.deepEqual(Object.keys(canonicalRepositoryModule).sort(), [
      'CanonicalReceivablesRepositoryError',
      'createCanonicalReceivablesRepository',
    ]);
    assert.deepEqual(Object.keys(repository).sort(), [
      'appendFinancialAuditEvent',
      'getReceivable',
      'listReceivables',
    ]);
    assert.throws(() => repository.listReceivables(), /companyId is required/);
    assert.throws(() => repository.getReceivable({ id: 'receivable-1' }), /companyId is required/);
    assert.deepEqual(repository.listReceivables({ companyId: 'company-1' }).map(row => row.id), ['receivable-1']);
    assert.equal(repository.getReceivable({ companyId: 'company-2', id: 'receivable-1' }), null);
    assert.equal(repository.createReceivable, undefined);
  } finally {
    closeDb(context);
  }
});

test('financial audit events append with correlation/source context and reject update/delete paths', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSchema(context.db);
    seedScopes(context.db);
    const repository = createCanonicalReceivablesRepository(context.db);
    const appended = repository.appendFinancialAuditEvent({
      id: 'audit-1',
      companyId: 'company-1',
      branchId: 'branch-1',
      aggregateType: 'receivable',
      aggregateId: 'receivable-1',
      eventType: 'receivable_schema_probe',
      actorId: 'user-1',
      actorType: 'user',
      occurredAt: '2026-07-13T09:00:00.000Z',
      reason: 'PR1 append-only verification',
      previousValueJson: null,
      newValueJson: { originalAmountMinor: 15000, currency: 'RUB' },
      correlationId: 'correlation-1',
      sourceSystem: 'test_source',
      createdAt: '2026-07-13T09:00:00.000Z',
    });
    assert.equal(appended.correlationId, 'correlation-1');
    assert.equal(appended.sourceSystem, 'test_source');
    assert.deepEqual(JSON.parse(appended.newValueJson), { originalAmountMinor: 15000, currency: 'RUB' });
    const systemEvent = repository.appendFinancialAuditEvent({
      ...appended,
      id: 'audit-system',
      actorId: null,
      actorType: 'system',
      previousValueJson: null,
      newValueJson: null,
    });
    assert.equal(systemEvent.actorId, null);
    assert.equal(repository.updateFinancialAuditEvent, undefined);
    assert.equal(repository.deleteFinancialAuditEvent, undefined);
    assert.throws(() => context.db.prepare(`
      UPDATE ${FINANCIAL_AUDIT_EVENTS_TABLE} SET reason = 'changed' WHERE id = 'audit-1'
    `).run(), /financial audit events are append-only/);
    assert.throws(() => context.db.prepare(`
      DELETE FROM ${FINANCIAL_AUDIT_EVENTS_TABLE} WHERE id = 'audit-1'
    `).run(), /financial audit events are append-only/);
    assert.throws(() => context.db.prepare(`
      INSERT OR REPLACE INTO ${FINANCIAL_AUDIT_EVENTS_TABLE}
      SELECT * FROM ${FINANCIAL_AUDIT_EVENTS_TABLE} WHERE id = 'audit-1'
    `).run(), /financial audit events are append-only/);
    assert.throws(() => repository.appendFinancialAuditEvent({
      ...appended,
      id: 'audit-user-without-actor',
      actorId: null,
      previousValueJson: null,
      newValueJson: null,
    }), /actorId is required/);
    assert.throws(() => repository.appendFinancialAuditEvent({
      ...appended,
      id: 'audit-secret',
      newValueJson: { integration: { accessToken: 'must-not-be-stored' } },
    }), /contains a secret-bearing field/);
  } finally {
    closeDb(context);
  }
});
