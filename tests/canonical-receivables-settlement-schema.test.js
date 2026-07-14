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
  CANONICAL_RECEIVABLES_MIGRATION_ID,
  ensureCanonicalReceivablesSchema,
} = require('../server/lib/canonical-receivables-schema.js');
const {
  CANONICAL_APPROVAL_REQUESTS_TABLE,
  CANONICAL_PAYMENT_ALLOCATIONS_TABLE,
  CANONICAL_PAYMENTS_TABLE,
  CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE,
  CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID,
  CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION,
  ensureCanonicalReceivablesSettlementSchema,
} = require('../server/lib/canonical-receivables-settlement-schema.js');

function makeDb({ applyPr1 = true, populateLegacy = true } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canonical-receivables-pr2-schema-'));
  const dbPath = path.join(dir, 'app.sqlite');
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  if (populateLegacy) db.exec(`
    INSERT INTO app_data (name, json) VALUES
      ('payments', '[{"id":"legacy-payment","amount":12.34,"status":"paid"}]'),
      ('payment_allocations', '[{"id":"legacy-allocation","paymentId":"legacy-payment"}]');
  `);
  if (applyPr1) ensureCanonicalReceivablesSchema(db);
  return { db, dbPath, dir };
}

function closeDb(context) {
  context.db.close();
  fs.rmSync(context.dir, { recursive: true, force: true });
}

function seedScopes(db) {
  db.exec(`
    INSERT INTO canonical_companies (id, receivablesTimezone) VALUES
      ('company-1', 'Europe/Moscow'),
      ('company-2', 'Europe/Moscow');
    INSERT INTO canonical_branches (companyId, id, isHeadOffice) VALUES
      ('company-1', 'branch-1', 1),
      ('company-1', 'branch-1b', 0),
      ('company-2', 'branch-2', 1);
  `);
}

function insertReceivable(db, overrides = {}) {
  const row = {
    id: 'receivable-1',
    companyId: 'company-1',
    branchId: 'branch-1',
    clientId: 'client-1',
    sourceDocumentType: 'invoice',
    sourceDocumentId: 'invoice-1',
    sourceSystem: 'test',
    idempotencyKey: 'receivable-key-1',
    currency: 'RUB',
    originalAmountMinor: 10000,
    postedAt: '2026-07-14T09:00:00.000Z',
    dueDateProvenance: 'unknown',
    companyTimezone: 'Europe/Moscow',
    workflowStatus: 'posted',
    createdAt: '2026-07-14T09:00:00.000Z',
    updatedAt: '2026-07-14T09:00:00.000Z',
    version: 1,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO canonical_receivables (
      id, companyId, branchId, clientId, sourceDocumentType, sourceDocumentId,
      sourceSystem, idempotencyKey, currency, originalAmountMinor, postedAt,
      dueDateProvenance, companyTimezone, workflowStatus, createdAt, updatedAt, version
    ) VALUES (
      @id, @companyId, @branchId, @clientId, @sourceDocumentType, @sourceDocumentId,
      @sourceSystem, @idempotencyKey, @currency, @originalAmountMinor, @postedAt,
      @dueDateProvenance, @companyTimezone, @workflowStatus, @createdAt, @updatedAt, @version
    )
  `).run(row);
}

function insertReceipt(db, overrides = {}) {
  const row = {
    id: 'payment-1',
    companyId: 'company-1',
    branchId: 'branch-1',
    clientId: 'client-1',
    externalId: null,
    idempotencyKey: 'payment-key-1',
    currency: 'RUB',
    paymentKind: 'receipt',
    receivedAmountMinor: 10000,
    refundAmountMinor: 0,
    receivedAt: '2026-07-14T10:00:00.000Z',
    workflowStatus: 'confirmed',
    sourceSystem: 'test',
    sourceDocumentType: null,
    sourceDocumentId: null,
    internalTransfer: 0,
    reversalOfPaymentId: null,
    approvalRequestId: null,
    reason: null,
    correlationId: 'payment-correlation-1',
    createdAt: '2026-07-14T10:00:00.000Z',
    updatedAt: '2026-07-14T10:00:00.000Z',
    version: 1,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO ${CANONICAL_PAYMENTS_TABLE} (
      id, companyId, branchId, clientId, externalId, idempotencyKey, currency,
      paymentKind, receivedAmountMinor, refundAmountMinor, receivedAt, workflowStatus,
      sourceSystem, sourceDocumentType, sourceDocumentId, internalTransfer,
      reversalOfPaymentId, approvalRequestId, reason, correlationId, createdAt, updatedAt, version
    ) VALUES (
      @id, @companyId, @branchId, @clientId, @externalId, @idempotencyKey, @currency,
      @paymentKind, @receivedAmountMinor, @refundAmountMinor, @receivedAt, @workflowStatus,
      @sourceSystem, @sourceDocumentType, @sourceDocumentId, @internalTransfer,
      @reversalOfPaymentId, @approvalRequestId, @reason, @correlationId, @createdAt, @updatedAt, @version
    )
  `).run(row);
}

function insertApproval(db, overrides = {}) {
  const row = {
    id: 'approval-1',
    companyId: 'company-1',
    operationType: 'allocation',
    aggregateType: 'payment_allocation',
    aggregateId: 'allocation-1',
    initiatedBy: 'user-1',
    initiatorActorType: 'user',
    requestedAt: '2026-07-14T11:00:00.000Z',
    approvedBy: null,
    approverActorType: null,
    approvedAt: null,
    rejectedBy: null,
    rejectedAt: null,
    status: 'pending',
    reason: 'approval required',
    rejectionReason: null,
    correlationId: 'allocation-correlation-1',
    operationPayloadJson: JSON.stringify({
      paymentId: 'payment-1',
      receivableId: 'receivable-1',
      allocatedAmountMinor: 1000,
      reversalAllocationId: null,
      currency: 'RUB',
      paymentBranchId: 'branch-1',
      receivableBranchId: 'branch-1',
      matchingEvidenceType: 'manual_ambiguous',
      matchingEvidenceReference: null,
      allocationReason: 'test allocation',
      correlationId: 'allocation-correlation-1',
    }),
    createdAt: '2026-07-14T11:00:00.000Z',
    version: 1,
    ...overrides,
  };
  db.prepare(`
    INSERT INTO ${CANONICAL_APPROVAL_REQUESTS_TABLE} (
      id, companyId, operationType, aggregateType, aggregateId,
      initiatedBy, initiatorActorType, requestedAt,
      approvedBy, approverActorType, approvedAt, rejectedBy, rejectedAt,
      status, reason, rejectionReason, correlationId, operationPayloadJson, createdAt, version
    ) VALUES (
      @id, @companyId, @operationType, @aggregateType, @aggregateId,
      @initiatedBy, @initiatorActorType, @requestedAt,
      @approvedBy, @approverActorType, @approvedAt, @rejectedBy, @rejectedAt,
      @status, @reason, @rejectionReason, @correlationId, @operationPayloadJson, @createdAt, @version
    )
  `).run(row);
}

function tableColumns(db, table) {
  return new Map(db.prepare(`PRAGMA table_info(${table})`).all().map(column => [column.name, column]));
}

test('PR2 requires an already-applied and structurally present PR1 migration', () => {
  const context = makeDb({ applyPr1: false, populateLegacy: false });
  try {
    assert.throws(
      () => ensureCanonicalReceivablesSettlementSchema(context.db),
      /PR2 requires canonical_receivables_pr1_schema version 1/,
    );
    for (const table of [
      CANONICAL_PAYMENTS_TABLE,
      CANONICAL_PAYMENT_ALLOCATIONS_TABLE,
      CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE,
      CANONICAL_APPROVAL_REQUESTS_TABLE,
    ]) {
      assert.equal(context.db.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
      ).get(table).count, 0);
    }
  } finally {
    closeDb(context);
  }
});

test('fresh database registers PR1 before PR2 and leaves all eight canonical tables empty', () => {
  const context = makeDb({ populateLegacy: false });
  try {
    assert.equal(ensureCanonicalReceivablesSettlementSchema(context.db), true);
    const registrationOrder = context.db.prepare(`
      SELECT name, version FROM sql_shadow_schema_migrations
      WHERE name IN (?, ?)
      ORDER BY rowid
    `).all(CANONICAL_RECEIVABLES_MIGRATION_ID, CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID);
    assert.deepEqual(registrationOrder, [
      { name: CANONICAL_RECEIVABLES_MIGRATION_ID, version: 1 },
      { name: CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID, version: 1 },
    ]);
    for (const table of [
      'canonical_companies',
      'canonical_branches',
      'canonical_receivables',
      'financial_audit_events',
      CANONICAL_PAYMENTS_TABLE,
      CANONICAL_PAYMENT_ALLOCATIONS_TABLE,
      CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE,
      CANONICAL_APPROVAL_REQUESTS_TABLE,
    ]) {
      assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0, table);
    }
  } finally {
    closeDb(context);
  }
});

test('failed PR2 DDL rolls back every new table and does not register the migration', () => {
  const context = makeDb({ populateLegacy: false });
  try {
    context.db.exec(`CREATE TABLE ${CANONICAL_APPROVAL_REQUESTS_TABLE} (id TEXT PRIMARY KEY)`);
    assert.throws(() => ensureCanonicalReceivablesSettlementSchema(context.db));
    assert.equal(context.db.prepare(`
      SELECT COUNT(*) AS count FROM sql_shadow_schema_migrations WHERE name = ?
    `).get(CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID).count, 0);
    for (const table of [
      CANONICAL_PAYMENTS_TABLE,
      CANONICAL_PAYMENT_ALLOCATIONS_TABLE,
      CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE,
    ]) {
      assert.equal(context.db.prepare(
        "SELECT COUNT(*) AS count FROM sqlite_master WHERE type='table' AND name=?",
      ).get(table).count, 0, table);
    }
    assert.equal(context.db.prepare(`
      SELECT COUNT(*) AS count FROM sql_shadow_schema_migrations WHERE name = ?
    `).get(CANONICAL_RECEIVABLES_MIGRATION_ID).count, 1);
  } finally {
    closeDb(context);
  }
});

test('PR2 migration is additive, registered once, idempotent, empty, and preserves legacy schema/data', () => {
  const context = makeDb();
  try {
    const legacySchema = context.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_data'").get().sql;
    const legacyRows = context.db.prepare('SELECT * FROM app_data ORDER BY name').all();
    assert.equal(ensureCanonicalReceivablesSettlementSchema(context.db), true);
    context.db.prepare(`
      UPDATE sql_shadow_schema_migrations SET applied_at = '2000-01-01 00:00:00'
      WHERE name = ?
    `).run(CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID);
    assert.equal(ensureCanonicalReceivablesSettlementSchema(context.db), false);

    const migration = context.db.prepare(`
      SELECT version, applied_at, COUNT(*) OVER () AS registrationCount
      FROM sql_shadow_schema_migrations WHERE name = ?
    `).get(CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID);
    assert.equal(migration.version, CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION);
    assert.equal(migration.applied_at, '2000-01-01 00:00:00');
    assert.equal(migration.registrationCount, 1);
    for (const table of [
      CANONICAL_PAYMENTS_TABLE,
      CANONICAL_PAYMENT_ALLOCATIONS_TABLE,
      CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE,
      CANONICAL_APPROVAL_REQUESTS_TABLE,
    ]) {
      assert.ok(context.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table));
      assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count, 0);
    }
    assert.equal(context.db.pragma('foreign_keys', { simple: true }), 1);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
    assert.equal(context.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='app_data'").get().sql, legacySchema);
    assert.deepEqual(context.db.prepare('SELECT * FROM app_data ORDER BY name').all(), legacyRows);
  } finally {
    closeDb(context);
  }
});

test('PR2 tables expose every required field and company-first identity/index contract', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSettlementSchema(context.db);
    const required = {
      [CANONICAL_PAYMENTS_TABLE]: [
        'id', 'companyId', 'branchId', 'clientId', 'externalId', 'idempotencyKey', 'currency',
        'receivedAmountMinor', 'receivedAt', 'workflowStatus', 'sourceSystem',
        'sourceDocumentType', 'sourceDocumentId', 'internalTransfer', 'reversalOfPaymentId',
        'createdAt', 'updatedAt', 'version',
      ],
      [CANONICAL_PAYMENT_ALLOCATIONS_TABLE]: [
        'id', 'companyId', 'paymentId', 'receivableId', 'paymentBranchId', 'receivableBranchId',
        'allocatedAmountMinor', 'allocationStatus', 'allocationReason', 'matchingEvidenceType',
        'matchingEvidenceReference', 'initiatedBy', 'initiatedAt', 'approvedBy', 'approvedAt',
        'approvalStatus', 'reversedAt', 'reversalAllocationId', 'idempotencyKey',
        'correlationId', 'createdAt', 'version',
      ],
      [CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE]: [
        'id', 'companyId', 'branchId', 'receivableId', 'adjustmentType', 'amountMinor',
        'workflowStatus', 'reason', 'supportingDocumentReference', 'sourceDocumentType',
        'sourceDocumentId', 'reversesAdjustmentId', 'initiatedBy', 'initiatedAt',
        'approvedBy', 'approvedAt', 'approvalStatus', 'idempotencyKey', 'correlationId',
        'effectiveAt', 'createdAt', 'version',
      ],
      [CANONICAL_APPROVAL_REQUESTS_TABLE]: [
        'id', 'companyId', 'operationType', 'aggregateType', 'aggregateId', 'initiatedBy',
        'requestedAt', 'approvedBy', 'approvedAt', 'rejectedBy', 'rejectedAt', 'status',
        'reason', 'rejectionReason', 'correlationId', 'createdAt', 'version',
      ],
    };
    for (const [table, fields] of Object.entries(required)) {
      const columns = tableColumns(context.db, table);
      for (const field of fields) assert.ok(columns.has(field), `${table}.${field}`);
      assert.equal(columns.get('companyId').notnull, 1);
      assert.equal(columns.get('version').notnull, 1);
    }
    for (const index of [
      'uq_canonical_payments_idempotency',
      'uq_canonical_payment_allocations_idempotency',
      'uq_canonical_receivable_adjustments_idempotency',
      'idx_canonical_approval_requests_company_status',
    ]) {
      assert.ok(context.db.prepare("SELECT 1 FROM sqlite_master WHERE type='index' AND name=?").get(index), index);
    }
  } finally {
    closeDb(context);
  }
});

test('payment money, currency, receipt status, source identity, and company-scoped idempotency constraints are enforced', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSettlementSchema(context.db);
    seedScopes(context.db);
    insertReceipt(context.db);
    assert.throws(() => insertReceipt(context.db, {
      id: 'float-payment', idempotencyKey: 'float-payment', receivedAmountMinor: 1.5,
    }));
    assert.throws(() => insertReceipt(context.db, {
      id: 'zero-payment', idempotencyKey: 'zero-payment', receivedAmountMinor: 0,
    }));
    assert.throws(() => insertReceipt(context.db, {
      id: 'usd-payment', idempotencyKey: 'usd-payment', currency: 'USD',
    }));
    assert.throws(() => insertReceipt(context.db, {
      id: 'scheduled-payment', idempotencyKey: 'scheduled-payment', workflowStatus: 'scheduled',
    }));
    assert.throws(() => insertReceipt(context.db, {
      id: 'duplicate-idempotency', externalId: 'other',
    }), /UNIQUE constraint failed/);
    insertReceipt(context.db, {
      id: 'other-company-payment',
      companyId: 'company-2',
      branchId: 'branch-2',
      clientId: 'client-2',
      externalId: null,
      correlationId: 'other-company',
    });
    assert.equal(context.db.prepare(`SELECT COUNT(*) AS count FROM ${CANONICAL_PAYMENTS_TABLE}`).get().count, 2);
  } finally {
    closeDb(context);
  }
});

test('foreign keys, approval status, separation of duties, and cross-branch approval are enforced', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSettlementSchema(context.db);
    seedScopes(context.db);
    insertReceivable(context.db);
    insertReceipt(context.db);
    assert.throws(() => insertApproval(context.db, {
      id: 'self-approved',
      aggregateId: 'self-approved',
      status: 'approved',
      approvedBy: 'user-1',
      approverActorType: 'user',
      approvedAt: '2026-07-14T11:30:00.000Z',
    }));
    insertApproval(context.db, {
      status: 'approved',
      approvedBy: 'user-2',
      approverActorType: 'user',
      approvedAt: '2026-07-14T11:30:00.000Z',
    });
    const statement = context.db.prepare(`
      INSERT INTO ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} (
        id, companyId, paymentId, receivableId, paymentBranchId, receivableBranchId,
        allocatedAmountMinor, allocationKind, allocationStatus, allocationReason,
        matchingEvidenceType, matchingEvidenceReference, initiatedBy, initiatedAt,
        approvedBy, approvedAt, approvalStatus, approvalRequestId,
        idempotencyKey, correlationId, createdAt, version
      ) VALUES (
        @id, @companyId, @paymentId, @receivableId, @paymentBranchId, @receivableBranchId,
        @allocatedAmountMinor, 'allocation', 'confirmed', 'test allocation',
        'manual_ambiguous', NULL, 'user-1', '2026-07-14T11:00:00.000Z',
        @approvedBy, @approvedAt, @approvalStatus, @approvalRequestId,
        @idempotencyKey, @correlationId, '2026-07-14T11:00:00.000Z', 1
      )
    `);
    statement.run({
      id: 'allocation-1', companyId: 'company-1', paymentId: 'payment-1', receivableId: 'receivable-1',
      paymentBranchId: 'branch-1', receivableBranchId: 'branch-1', allocatedAmountMinor: 1000,
      approvedBy: 'user-2', approvedAt: '2026-07-14T11:30:00.000Z', approvalStatus: 'approved',
      approvalRequestId: 'approval-1', idempotencyKey: 'allocation-key-1', correlationId: 'allocation-correlation-1',
    });
    insertApproval(context.db, {
      id: 'wrong-operation-approval',
      operationType: 'allocation_reversal',
      aggregateId: 'wrong-operation-allocation',
      status: 'approved',
      approvedBy: 'user-2',
      approverActorType: 'user',
      approvedAt: '2026-07-14T11:30:00.000Z',
      correlationId: 'wrong-operation-approval',
    });
    assert.throws(() => statement.run({
      id: 'wrong-operation-allocation', companyId: 'company-1', paymentId: 'payment-1',
      receivableId: 'receivable-1', paymentBranchId: 'branch-1', receivableBranchId: 'branch-1',
      allocatedAmountMinor: 100, approvedBy: 'user-2', approvedAt: '2026-07-14T11:30:00.000Z',
      approvalStatus: 'approved', approvalRequestId: 'wrong-operation-approval',
      idempotencyKey: 'wrong-operation-allocation', correlationId: 'wrong-operation-allocation',
    }), /matching final approval/);
    insertApproval(context.db, {
      id: 'wrong-payload-approval',
      aggregateId: 'wrong-payload-allocation',
      status: 'approved',
      approvedBy: 'user-2',
      approverActorType: 'user',
      approvedAt: '2026-07-14T11:30:00.000Z',
      correlationId: 'wrong-payload-approval',
      operationPayloadJson: JSON.stringify({
        paymentId: 'payment-1',
        receivableId: 'receivable-1',
        allocatedAmountMinor: 999,
        reversalAllocationId: null,
        currency: 'RUB',
        paymentBranchId: 'branch-1',
        receivableBranchId: 'branch-1',
        matchingEvidenceType: 'manual_ambiguous',
        matchingEvidenceReference: null,
        allocationReason: 'test allocation',
        correlationId: 'wrong-payload-allocation',
      }),
    });
    assert.throws(() => statement.run({
      id: 'wrong-payload-allocation', companyId: 'company-1', paymentId: 'payment-1',
      receivableId: 'receivable-1', paymentBranchId: 'branch-1', receivableBranchId: 'branch-1',
      allocatedAmountMinor: 100, approvedBy: 'user-2', approvedAt: '2026-07-14T11:30:00.000Z',
      approvalStatus: 'approved', approvalRequestId: 'wrong-payload-approval',
      idempotencyKey: 'wrong-payload-allocation', correlationId: 'wrong-payload-allocation',
    }), /matching final approval/);
    assert.throws(() => statement.run({
      id: 'cross-company', companyId: 'company-2', paymentId: 'payment-1', receivableId: 'receivable-1',
      paymentBranchId: 'branch-2', receivableBranchId: 'branch-2', allocatedAmountMinor: 1000,
      approvedBy: 'user-2', approvedAt: '2026-07-14T11:30:00.000Z', approvalStatus: 'approved',
      approvalRequestId: null, idempotencyKey: 'cross-company', correlationId: 'cross-company',
    }), /FOREIGN KEY constraint failed|allocation payment\/receivable contract invalid/);
    assert.throws(() => context.db.prepare(`
      INSERT INTO ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} (
        id, companyId, paymentId, receivableId, paymentBranchId, receivableBranchId,
        allocatedAmountMinor, allocationKind, allocationStatus, allocationReason,
        matchingEvidenceType, matchingEvidenceReference, initiatedBy, initiatedAt,
        approvalStatus, idempotencyKey, correlationId, createdAt, version
      ) VALUES (
        'cross-branch-no-approval', 'company-1', 'payment-1', 'receivable-1',
        'branch-1', 'branch-1b', 100, 'allocation', 'confirmed', 'invalid',
        'exact_document_reference', 'invoice-1', 'user-1', '2026-07-14T11:00:00.000Z',
        'not_required', 'cross-branch-no-approval', 'cross-branch-no-approval',
        '2026-07-14T11:00:00.000Z', 1
      )
    `).run());
  } finally {
    closeDb(context);
  }
});

test('database capacity guards reject direct over-allocation and final rows are append-only', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSettlementSchema(context.db);
    seedScopes(context.db);
    insertReceivable(context.db, { originalAmountMinor: 5000 });
    insertReceipt(context.db, { receivedAmountMinor: 4000 });
    const insert = context.db.prepare(`
      INSERT INTO ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} (
        id, companyId, paymentId, receivableId, paymentBranchId, receivableBranchId,
        allocatedAmountMinor, allocationKind, allocationStatus, allocationReason,
        matchingEvidenceType, matchingEvidenceReference, initiatedBy, initiatedAt,
        approvalStatus, idempotencyKey, correlationId, createdAt, version
      ) VALUES (?, 'company-1', ?, 'receivable-1', 'branch-1', 'branch-1',
        ?, 'allocation', 'confirmed', 'exact', 'exact_document_reference', 'invoice-1',
        'user-1', '2026-07-14T11:00:00.000Z', 'not_required', ?, ?,
        '2026-07-14T11:00:00.000Z', 1)
    `);
    insert.run('allocation-1', 'payment-1', 3000, 'allocation-key-1', 'allocation-correlation-1');
    assert.throws(() => insert.run(
      'allocation-over-payment', 'payment-1', 2000, 'allocation-key-2', 'allocation-correlation-2',
    ), /payment balance insufficient/);
    insertReceipt(context.db, {
      id: 'payment-other-client',
      clientId: 'client-2',
      externalId: null,
      idempotencyKey: 'payment-other-client',
      correlationId: 'payment-other-client',
    });
    assert.throws(() => insert.run(
      'allocation-other-client', 'payment-other-client', 100,
      'allocation-other-client', 'allocation-other-client',
    ), /allocation payment\/receivable contract invalid/);
    assert.throws(() => context.db.prepare(`
      UPDATE ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} SET allocatedAmountMinor = 1 WHERE id = 'allocation-1'
    `).run(), /immutable/);
    assert.throws(() => context.db.prepare(`
      DELETE FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} WHERE id = 'allocation-1'
    `).run(), /append-only/);
    assert.throws(() => context.db.prepare(`
      UPDATE ${CANONICAL_PAYMENTS_TABLE} SET receivedAmountMinor = 1 WHERE id = 'payment-1'
    `).run(), /immutable/);
    assert.throws(() => context.db.prepare(`
      DELETE FROM ${CANONICAL_PAYMENTS_TABLE} WHERE id = 'payment-1'
    `).run(), /append-only/);
  } finally {
    closeDb(context);
  }
});

test('idempotency and single-reversal uniqueness are company scoped and final approvals cannot conflict', () => {
  const context = makeDb();
  try {
    ensureCanonicalReceivablesSettlementSchema(context.db);
    seedScopes(context.db);
    insertApproval(context.db);
    assert.throws(() => context.db.prepare(`
      UPDATE ${CANONICAL_APPROVAL_REQUESTS_TABLE}
      SET operationPayloadJson = '{"allocatedAmountMinor":999}'
      WHERE id = 'approval-1'
    `).run(), /identity and payload are immutable/);
    assert.throws(() => insertApproval(context.db, {
      id: 'approval-duplicate-operation',
    }), /UNIQUE constraint failed/);
    assert.throws(() => insertApproval(context.db, {
      id: 'approval-second-pending',
      correlationId: 'allocation-correlation-second',
      operationPayloadJson: JSON.stringify({
        paymentId: 'payment-1', receivableId: 'receivable-1', allocatedAmountMinor: 1000,
        reversalAllocationId: null, currency: 'RUB', paymentBranchId: 'branch-1',
        receivableBranchId: 'branch-1', matchingEvidenceType: 'manual_ambiguous',
        matchingEvidenceReference: null, allocationReason: 'test allocation',
        correlationId: 'allocation-correlation-second',
      }),
    }), /UNIQUE constraint failed/);
    context.db.prepare(`
      UPDATE ${CANONICAL_APPROVAL_REQUESTS_TABLE}
      SET status='approved', approvedBy='user-2', approverActorType='user',
          approvedAt='2026-07-14T12:00:00.000Z', version=2
      WHERE id='approval-1'
    `).run();
    assert.throws(() => context.db.prepare(`
      UPDATE ${CANONICAL_APPROVAL_REQUESTS_TABLE}
      SET status='rejected', approvedBy=NULL, approvedAt=NULL,
          rejectedBy='user-3', rejectedAt='2026-07-14T13:00:00.000Z', rejectionReason='conflict'
      WHERE id='approval-1'
    `).run(), /immutable/);
    assert.throws(() => context.db.prepare(`DELETE FROM ${CANONICAL_APPROVAL_REQUESTS_TABLE}`).run(), /append-only/);
  } finally {
    closeDb(context);
  }
});
