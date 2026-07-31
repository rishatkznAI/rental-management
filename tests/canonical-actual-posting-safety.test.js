import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import {
  createPr9aContext,
  eligibilityCommand,
  hash,
  postingCommand,
  postingGraphSnapshot,
  totalChanges,
} from './canonical-actual-posting-fixtures.js';

const require = createRequire(import.meta.url);
const {
  canonicalJson,
} = require('../server/lib/canonical-actual-posting-domain.js');
const {
  createCanonicalActualPostingService,
} = require('../server/lib/canonical-actual-posting-service.js');

const root = path.resolve(new URL('..', import.meta.url).pathname);

function insertObject(db, table, row) {
  const keys = Object.keys(row);
  db.prepare(`INSERT INTO ${table} (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`)
    .run(...keys.map(key => row[key]));
}

function auditFixture(context) {
  const event = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)).event;
  const idempotencyKey = `canonical-posting-fixture-${event.id}`;
  const canonicalReceivableId = `canonical-receivable-${event.id}`;
  const operationId = `canonical-operation-${event.id}`;
  const auditEventId = `canonical-audit-${event.id}`;
  const canonicalReceivableFingerprint = hash(`canonical-fingerprint-${event.id}`);
  const auditPayloadFingerprint = hash(`audit-payload-${event.id}`);
  const createdAt = event.createdAt;
  const receivable = {
    id: canonicalReceivableId,
    companyId: event.companyId,
    branchId: event.branchId,
    clientId: event.clientId,
    contractId: event.contractId,
    rentalId: event.rentalId,
    sourceDocumentType: 'rental_service_upd',
    sourceDocumentId: event.rootSourceDocumentLineageId,
    sourceLineId: event.economicLineageKey,
    sourceSystem: 'rentcore.billing_source_authority.v1',
    externalId: event.economicLineageKey,
    idempotencyKey,
    currency: 'RUB',
    originalAmountMinor: event.grossAmountMinor,
    issuedAt: null,
    postedAt: createdAt,
    contractualDueDate: event.contractualDueDate,
    dueDateProvenance: event.dueDateProvenance,
    companyTimezone: event.companyTimezoneSnapshot,
    workflowStatus: 'posted',
    cancellationReason: null,
    description: null,
    createdAt,
    updatedAt: createdAt,
    cancelledAt: null,
    closedAt: null,
    writtenOffAt: null,
    version: 1,
  };
  const operation = {
    id: operationId,
    companyId: event.companyId,
    branchId: event.branchId,
    operationType: 'canonical_receivable.initial_post.v1',
    idempotencyKey,
    eventId: event.id,
    eventHash: event.eventHash,
    economicLineageKey: event.economicLineageKey,
    economicSourceRevisionKey: event.economicSourceRevisionKey,
    currentPr6RevisionHash: event.currentPr6RevisionHash,
    sourceAdapterAuthorityRecordId: event.sourceAdapterAuthorityRecordId,
    sourceAdapterAuthorityVersion: event.sourceAdapterAuthorityVersion,
    sourceAdapterAuthorityRecordHash: event.sourceAdapterAuthorityRecordHash,
    sourceOwnershipManifestHash: event.sourceOwnershipManifestHash,
    postingAdapterAuthorityRecordId: context.authority.posting.recordId,
    postingAdapterAuthorityVersion: context.authority.posting.authorityVersion,
    postingAdapterAuthorityRecordHash: context.authority.posting.recordHash,
    postingAdapterAuthorityCompanyId: event.companyId,
    postingAdapterAuthorityBranchId: event.branchId,
    postingAdapterAuthorityKind: 'canonical_posting_adapter',
    writeAuthorizationRecordId: event.writeAuthorizationRecordId,
    activationRecordId: event.activationRecordId,
    acceptedDryRunsHash: event.acceptedDryRunsHash,
    acceptedPr8EvidenceHash: event.acceptedPr8EvidenceHash,
    dueDatePolicySetHash: event.dueDatePolicySetHash,
    selectedDueDateGateKind: event.selectedDueDateGateKind,
    selectedDueDatePolicyId: event.selectedDueDatePolicyId,
    selectedDueDatePolicyVersion: event.selectedDueDatePolicyVersion,
    selectedDueDatePolicyHash: event.selectedDueDatePolicyHash,
    dueDateTreatment: event.dueDateTreatment,
    unknownDueDateTreatmentMappingId: event.unknownDueDateTreatmentMappingId,
    unknownDueDateTreatmentMappingVersion: event.unknownDueDateTreatmentMappingVersion,
    unknownDueDateTreatmentMappingHash: event.unknownDueDateTreatmentMappingHash,
    canonicalReceivableId,
    canonicalReceivableFingerprint,
    sourceLineageHash: event.sourceLineageHash,
    commandFingerprint: hash(`command-${event.id}`),
    auditPayloadFingerprint,
    auditEventFingerprint: hash(`audit-event-${event.id}`),
    resultHash: hash(`result-${event.id}`),
    financialAuditEventId: auditEventId,
    correlationId: event.correlationId,
    schemaVersion: 1,
    createdAt,
  };
  const payload = {
    acceptedDryRunsHash: operation.acceptedDryRunsHash,
    acceptedPr8EvidenceHash: operation.acceptedPr8EvidenceHash,
    activationRecordId: operation.activationRecordId,
    actorAuthorityRecordId: operation.postingAdapterAuthorityRecordId,
    actorIdentityId: 'integration:rentcore-canonical-receivable-posting',
    auditPayloadFingerprint,
    canonicalReceivableFingerprint,
    dueDatePolicySetHash: operation.dueDatePolicySetHash,
    dueDateTreatment: operation.dueDateTreatment,
    economicLineageKey: operation.economicLineageKey,
    economicSourceRevisionKey: operation.economicSourceRevisionKey,
    eventHash: operation.eventHash,
    eventId: operation.eventId,
    operationId,
    postingAdapterAuthorityBranchId: operation.postingAdapterAuthorityBranchId,
    postingAdapterAuthorityCompanyId: operation.postingAdapterAuthorityCompanyId,
    postingAdapterAuthorityKind: operation.postingAdapterAuthorityKind,
    postingAdapterAuthorityRecordHash: operation.postingAdapterAuthorityRecordHash,
    postingAdapterAuthorityRecordId: operation.postingAdapterAuthorityRecordId,
    postingAdapterAuthorityVersion: operation.postingAdapterAuthorityVersion,
    selectedDueDateGateKind: operation.selectedDueDateGateKind,
    selectedDueDatePolicyHash: operation.selectedDueDatePolicyHash,
    selectedDueDatePolicyId: operation.selectedDueDatePolicyId,
    selectedDueDatePolicyVersion: operation.selectedDueDatePolicyVersion,
    sourceAdapterAuthorityRecordHash: operation.sourceAdapterAuthorityRecordHash,
    sourceAdapterAuthorityRecordId: operation.sourceAdapterAuthorityRecordId,
    sourceAdapterAuthorityVersion: operation.sourceAdapterAuthorityVersion,
    sourceLineageHash: operation.sourceLineageHash,
    sourceOwnershipManifestHash: operation.sourceOwnershipManifestHash,
    unknownDueDateTreatmentMappingHash: operation.unknownDueDateTreatmentMappingHash,
    unknownDueDateTreatmentMappingId: operation.unknownDueDateTreatmentMappingId,
    unknownDueDateTreatmentMappingVersion: operation.unknownDueDateTreatmentMappingVersion,
    writeAuthorizationRecordId: operation.writeAuthorizationRecordId,
  };
  const audit = {
    id: auditEventId,
    companyId: event.companyId,
    branchId: event.branchId,
    aggregateType: 'canonical_receivable',
    aggregateId: canonicalReceivableId,
    eventType: 'canonical_receivable.initial_posted.v1',
    actorId: 'integration:rentcore-canonical-receivable-posting',
    actorType: 'integration',
    occurredAt: createdAt,
    reason: 'canonical_actual_posting_initial_post_v1',
    previousValueJson: null,
    newValueJson: canonicalJson(payload),
    correlationId: event.correlationId,
    sourceSystem: 'rentcore.billing_source_authority.v1',
    createdAt,
  };
  return { event, receivable, operation, payload, audit };
}

function insertPostingTriplet(db, fixture, overrides = {}) {
  const receivable = { ...fixture.receivable, ...overrides.receivable };
  const operation = { ...fixture.operation, ...overrides.operation };
  const payload = { ...fixture.payload, ...overrides.payload };
  const audit = {
    ...fixture.audit,
    ...overrides.audit,
    newValueJson: overrides.audit?.newValueJson ?? canonicalJson(payload),
  };
  db.exec('BEGIN');
  try {
    insertObject(db, 'canonical_receivables', receivable);
    insertObject(db, 'canonical_receivable_posting_operations', operation);
    insertObject(db, 'financial_audit_events', audit);
    db.exec('COMMIT');
  } catch (error) {
    if (db.inTransaction) db.exec('ROLLBACK');
    throw error;
  }
}

test('audit seal activation predicate is exact and unrelated audit events remain unaffected', () => {
  const context = createPr9aContext();
  try {
    const trigger = context.db.prepare(`
      SELECT sql FROM sqlite_master
      WHERE type = 'trigger' AND name = 'trg_pr9_financial_audit_scope_validate_after_insert'
    `).get().sql.replace(/\s+/g, ' ');
    assert.match(trigger, /WHEN NEW\.eventType = 'canonical_receivable\.initial_posted\.v1' OR EXISTS \( SELECT 1 FROM canonical_receivable_posting_operations AS operation WHERE operation\.financialAuditEventId = NEW\.id \)/);
    insertObject(context.db, 'financial_audit_events', {
      id: 'unrelated-audit', companyId: 'company-a', branchId: 'branch-a-1',
      aggregateType: 'unrelated', aggregateId: 'unrelated-1', eventType: 'unrelated.event.v1',
      actorId: null, actorType: 'system', occurredAt: '2026-07-27T12:00:00.000Z',
      reason: null, previousValueJson: null, newValueJson: null,
      correlationId: 'unrelated-correlation', sourceSystem: 'unrelated',
      createdAt: '2026-07-27T12:00:00.000Z',
    });
    assert.equal(context.db.prepare("SELECT COUNT(*) AS count FROM financial_audit_events WHERE id = 'unrelated-audit'").get().count, 1);
  } finally {
    context.db.close();
  }
});

test('orphan exact literal cannot reserve a future audit ID and valid operation-first deferred pair succeeds', () => {
  const context = createPr9aContext();
  try {
    const fixture = auditFixture(context);
    assert.throws(
      () => insertObject(context.db, 'financial_audit_events', fixture.audit),
      /CANONICAL_AUDIT_SEAL_INTEGRITY_FAILED/,
    );
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM financial_audit_events WHERE id = ?').get(fixture.audit.id).count, 0);
    insertPostingTriplet(context.db, fixture);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_operations').get().count, 1);
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM financial_audit_events WHERE id = ?').get(fixture.audit.id).count, 1);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.db.close();
  }
});

test('audit seal rejects wrong literal, company, branch, operation, receivable, seal, extra key, and multiple references with full rollback', () => {
  const cases = [
    { name: 'wrong literal', overrides: { audit: { eventType: 'wrong.event.v1' } } },
    { name: 'wrong company', overrides: { audit: { companyId: 'wrong-company' } } },
    { name: 'wrong branch', overrides: { audit: { branchId: 'wrong-branch' } } },
    { name: 'wrong operation identity', overrides: { payload: { operationId: 'wrong-operation' } } },
    { name: 'wrong receivable identity', overrides: { audit: { aggregateId: 'wrong-receivable' } } },
    { name: 'wrong seal', overrides: { payload: { auditPayloadFingerprint: '0'.repeat(64) } } },
    { name: 'extra payload key', overrides: { payload: { unexpected: 'forbidden' } } },
  ];
  for (const entry of cases) {
    const context = createPr9aContext();
    try {
      const fixture = auditFixture(context);
      assert.throws(
        () => insertPostingTriplet(context.db, fixture, entry.overrides),
        /CANONICAL_AUDIT_SEAL_INTEGRITY_FAILED|FOREIGN KEY constraint failed/,
        entry.name,
      );
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_operations').get().count, 0, entry.name);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivables').get().count, 0, entry.name);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM financial_audit_events').get().count, 0, entry.name);
    } finally {
      context.db.close();
    }
  }

  const context = createPr9aContext();
  try {
    const fixture = auditFixture(context);
    context.db.exec('BEGIN');
    insertObject(context.db, 'canonical_receivables', fixture.receivable);
    insertObject(context.db, 'canonical_receivable_posting_operations', fixture.operation);
    assert.throws(
      () => insertObject(context.db, 'canonical_receivable_posting_operations', {
        ...fixture.operation, id: `${fixture.operation.id}-second`, idempotencyKey: `${fixture.operation.idempotencyKey}-second`,
      }),
      /UNIQUE constraint failed|CANONICAL_POSTING_OPERATION_SEAL_INTEGRITY_FAILED/,
    );
    context.db.exec('ROLLBACK');
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_operations').get().count, 0);
  } finally {
    context.db.close();
  }
});

test('PR9a remains disabled by default and authorization state is unchanged', () => {
  const server = fs.readFileSync(path.join(root, 'server/server.js'), 'utf8');
  const db = fs.readFileSync(path.join(root, 'server/db.js'), 'utf8');
  const gate = fs.readFileSync(path.join(root, 'docs/pr9a-implementation-authorization-gate.md'), 'utf8');
  assert.doesNotMatch(server, /canonical-actual-eligibility-event/);
  assert.match(db, /ensureCanonicalActualPostingSchema\(db\)/);
  for (const [field, value] of Object.entries({
    architectureDesignApproved: 'TRUE',
    pr9aImplementationAuthorized: 'TRUE',
    pr9bImplementationAuthorized: 'FALSE',
    pr9ImplementationAuthorized: 'FALSE',
    foundationDeploymentRetryAuthorized: 'FALSE',
    pr9DisabledDeploymentAuthorized: 'FALSE',
    productionActivationAuthorized: 'FALSE',
    canonicalProductionReadsAuthorized: 'FALSE',
    productionCanonicalWritesAuthorized: 'FALSE',
    settlementAuthorized: 'FALSE',
    shadowReadAuthorized: 'FALSE',
    cutoverAuthorized: 'FALSE',
  })) assert.match(gate, new RegExp(`${field}\\s*[=:|]\\s*(?:\\*\\*)?${value}`));
});

test('PR9B service remains default-disabled with zero business DML and no graph mutation', () => {
  const context = createPr9aContext();
  try {
    const event = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)).event;
    const service = createCanonicalActualPostingService({ db: context.db });
    const graphBefore = postingGraphSnapshot(context.db);
    const changesBefore = totalChanges(context.db);
    assert.throws(
      () => service.postCanonicalReceivable(postingCommand(context, event)),
      error => error.code === 'CANONICAL_PR9B_DISABLED',
    );
    assert.equal(totalChanges(context.db) - changesBefore, 0);
    assert.equal(postingGraphSnapshot(context.db), graphBefore);
  } finally {
    context.db.close();
  }
});

test('PR9B posting failures cannot leave a partial primary or denial graph', () => {
  for (const table of [
    'canonical_receivables',
    'canonical_receivable_posting_operations',
    'financial_audit_events',
  ]) {
    const context = createPr9aContext();
    try {
      const event = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)).event;
      context.db.exec(`CREATE TRIGGER pr9b_safety_abort BEFORE INSERT ON ${table}
        BEGIN SELECT RAISE(ABORT, 'PR9B safety rollback'); END`);
      const service = createCanonicalActualPostingService({
        db: context.db,
        runtimeContract: context.runtimeContract,
      });
      assert.throws(
        () => service.postCanonicalReceivable(postingCommand(context, event)),
        error => error.code === 'CANONICAL_POSTING_PERSISTENCE_FAILED',
      );
      for (const businessTable of [
        'canonical_receivables',
        'canonical_receivable_posting_operations',
        'financial_audit_events',
        'canonical_receivable_posting_conflicts',
        'canonical_receivable_posting_conflict_transitions',
      ]) {
        assert.equal(Number(context.db.prepare(
          `SELECT COUNT(*) AS count FROM ${businessTable}`,
        ).get().count), 0, `${table} -> ${businessTable}`);
      }
      assert.deepEqual(context.db.pragma('foreign_key_check'), []);
    } finally {
      context.db.close();
    }
  }
});
