import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import test from 'node:test';
import { Worker } from 'node:worker_threads';
import {
  authorityRecord,
  appendConductedSourceCorrection,
  createPr9aContext,
  eligibilityCommand,
  runtimeContractForAuthority,
} from './canonical-actual-posting-fixtures.js';
import {
  approvedTestPolicyManifest,
  dryRunCommand,
} from './actual-source-eligibility-dry-run-fixtures.js';

const require = createRequire(import.meta.url);
const repositoryPath = require.resolve('../server/lib/canonical-actual-eligibility-event-repository.js');
const {
  ERROR_CODES,
  canonicalJson,
  createCanonicalActualPostingRuntimeContract,
  computeEconomicLineageCandidateFingerprint,
  computeActivationRecordHash,
  computeDueDatePolicySetHash,
  computeEligibleEventHash,
  computeWriteAuthorizationRecordHash,
  deriveRepositoryIdentity,
  sha256Canonical,
  validateEligibleEventRecord,
} = require('../server/lib/canonical-actual-posting-domain.js');
const {
  createCanonicalActualEligibilityEventService,
} = require('../server/lib/canonical-actual-eligibility-event-service.js');

function counts(db) {
  return {
    events: Number(db.prepare('SELECT COUNT(*) AS count FROM actual_receivable_eligible_events').get().count),
    conflicts: Number(db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflicts').get().count),
    transitions: Number(db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflict_transitions').get().count),
    receivables: Number(db.prepare("SELECT COUNT(*) AS count FROM canonical_receivables WHERE sourceSystem = 'rentcore.billing_source_authority.v1'").get().count),
    operations: Number(db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_operations').get().count),
  };
}

function replaceFunction(object, property, value) {
  const descriptor = Object.getOwnPropertyDescriptor(object, property);
  Object.defineProperty(object, property, { ...descriptor, value });
  return () => Object.defineProperty(object, property, descriptor);
}

function freshRepositoryWith(context, install) {
  const restore = install();
  delete require.cache[repositoryPath];
  try {
    const { createCanonicalActualEligibilityEventRepository } = require(repositoryPath);
    return createCanonicalActualEligibilityEventRepository(context.db, context.runtimeContract);
  } finally {
    restore();
    delete require.cache[repositoryPath];
  }
}

function mutateCandidateForConflict(context) {
  const trigger = context.db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name = 'trg_actual_source_dry_run_candidates_no_update'
  `).get();
  context.db.exec(`DROP TRIGGER ${trigger.name}`);
  context.db.prepare('UPDATE actual_source_dry_run_candidates SET dueDateEvidenceRef = ? WHERE id = ?')
    .run('contract-due-date-conflict-v2', context.authority.candidate.id);
  context.db.exec(trigger.sql);
}

function mutateAppendOnlyTable(db, table, mutation) {
  const triggers = db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL
    ORDER BY name
  `).all(table);
  for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`);
  try {
    mutation();
  } finally {
    for (const trigger of triggers) db.exec(trigger.sql);
  }
}

function insertCopiedRow(db, table, row) {
  const columns = Object.keys(row);
  db.prepare(`
    INSERT INTO ${table} (${columns.map(column => `"${column}"`).join(', ')})
    VALUES (${columns.map(() => '?').join(', ')})
  `).run(...columns.map(column => row[column]));
}

// Independent hostile-test oracle: this intentionally does not call the PR9a
// production canonical/hash/projection constructors. It implements only the
// exact JSON subset and envelopes needed to reseal adversarial persisted rows.
function oracleCanonicalJson(value) {
  if (value === null) return 'null';
  if (value === true) return 'true';
  if (value === false) return 'false';
  if (typeof value === 'number') return String(value);
  if (typeof value === 'string') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(oracleCanonicalJson).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map(key => `${JSON.stringify(key)}:${oracleCanonicalJson(value[key])}`).join(',')}}`;
}

function oracleHash(value) {
  return crypto.createHash('sha256').update(Buffer.from(oracleCanonicalJson(value), 'utf8')).digest('hex');
}

const ORACLE_WRITE_AUTHORIZATION_FIELDS = [
  'acceptedCompanyTimezoneSnapshot', 'acceptedDryRunsHash', 'acceptedDryRunsJson',
  'acceptedPr8EvidenceHash', 'acceptedPr8EvidenceJson', 'activationBoundaryId',
  'activationCohortRef', 'amountBasisPolicyHash', 'amountBasisPolicyRef',
  'approvalSetJson', 'authorizationId', 'authorizationVersion', 'backupEvidenceRef',
  'boundaryHash', 'branchId', 'cohortHash', 'companyId', 'denialEvidencePermission',
  'denialEvidenceTable', 'denialTransitionPermission', 'denialTransitionTable',
  'dueDatePolicySetHash', 'dueDatePolicySetJson', 'effectiveFrom', 'eventSchemaVersion',
  'evidencePackHash', 'expiresAt', 'forbiddenOperationsJson',
  'acceptedFreshnessWindowsHash', 'operationType', 'operationalControlRef',
  'policyManifestHashesJson', 'postingAdapterAuthorityBranchId',
  'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityKind',
  'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityRecordId',
  'postingAdapterAuthorityVersion', 'previousRecordId', 'primaryEffectTablesJson',
  'producerAuthorityBranchId', 'producerAuthorityCompanyId', 'producerAuthorityKind',
  'producerAuthorityRecordHash', 'producerAuthorityRecordId', 'producerAuthorityVersion',
  'retentionControlRef', 'revocationReasonCode', 'schemaVersion',
  'sourceAdapterAuthorityRecordHash', 'sourceAdapterAuthorityRecordId',
  'sourceAdapterAuthorityVersion', 'sourceOwnershipManifestHash', 'sourceSystemIdsJson',
  'status',
];

const ORACLE_ACTIVATION_FIELDS = [
  'acceptedDryRunsHash', 'acceptedPr8EvidenceHash', 'activationBoundaryId', 'activationId',
  'activationVersion', 'allowedDocumentClassesJson', 'allowedRentalClassesJson',
  'approvalHash', 'approvalRef', 'boundaryEndUtc', 'boundaryHash', 'branchId',
  'cohortHash', 'companyId', 'companyTimezoneSnapshot', 'currency',
  'dueDatePolicySetHash', 'dueDatePolicySetJson', 'effectiveFrom',
  'explicitExclusionsJson', 'expiresAt', 'acceptedFreshnessWindowsHash',
  'forwardOnlyStartDate', 'forwardOnlyStartUtc', 'policyManifestHashesJson',
  'postingAdapterAuthorityBranchId', 'postingAdapterAuthorityCompanyId',
  'postingAdapterAuthorityKind', 'postingAdapterAuthorityRecordHash',
  'postingAdapterAuthorityRecordId', 'postingAdapterAuthorityVersion',
  'previousRecordId', 'revocationReasonCode', 'schemaVersion', 'sourceSystemIdsJson',
  'status', 'writeAuthorizationRecordId',
];

function oracleRecordHash(row, fields, domain) {
  const envelope = { domain };
  for (const field of fields) envelope[field] = row[field];
  envelope.version = 1;
  return oracleHash(envelope);
}

function rewriteWholeRow(db, table, row) {
  const columns = Object.keys(row);
  mutateAppendOnlyTable(db, table, () => {
    db.prepare(`
      UPDATE ${table}
      SET ${columns.map(column => `"${column}" = ?`).join(', ')}
      WHERE recordId = ?
    `).run(...columns.map(column => row[column]), row.recordId);
  });
}

function oracleAcceptedDryRunsHash(acceptedDryRuns) {
  const normalized = acceptedDryRuns
    .map(entry => ({ dryRunId: entry.dryRunId, resultHash: entry.resultHash }))
    .sort((left, right) => left.dryRunId < right.dryRunId ? -1 : left.dryRunId > right.dryRunId ? 1 : 0);
  return oracleHash({
    acceptedDryRuns: normalized,
    domain: 'rentcore.canonical_actual_posting.accepted_dry_runs',
    version: 1,
  });
}

function oracleFreshnessWindowsHash(acceptedRuns) {
  const windows = acceptedRuns
    .map(entry => ({
      dryRunId: entry.dryRunId,
      freshnessWindowFingerprint: entry.freshnessWindowFingerprint,
    }))
    .sort((left, right) => left.dryRunId < right.dryRunId ? -1 : left.dryRunId > right.dryRunId ? 1 : 0);
  return oracleHash({
    domain: 'rentcore.canonical_actual_posting.accepted_freshness_windows',
    version: 1,
    windows,
  });
}

function oracleAcceptedPr8EvidenceHash({
  acceptedDryRunsHash,
  acceptedFreshnessWindowsHash,
  acceptedRuns,
  evidencePackHash,
}) {
  return oracleHash({
    acceptedDryRunsHash,
    acceptedFreshnessWindowsHash,
    acceptedRuns: [...acceptedRuns].sort((left, right) => (
      left.dryRunId < right.dryRunId ? -1 : left.dryRunId > right.dryRunId ? 1 : 0
    )),
    domain: 'rentcore.canonical_actual_posting.accepted_pr8_evidence',
    evidencePackHash,
    version: 1,
  });
}

function oracleAcceptedRun(context, dryRunId) {
  const run = context.db.prepare('SELECT * FROM actual_source_dry_runs WHERE id = ?').get(dryRunId);
  const reconciliationHashes = context.db.prepare(`
    SELECT reconciliationHash FROM actual_source_dry_run_reconciliations
    WHERE runId = ? ORDER BY reconciliationHash ASC
  `).all(dryRunId).map(row => row.reconciliationHash);
  const reconciliationSetHash = oracleHash({
    domain: 'rentcore.canonical_actual_posting.pr8_reconciliation_set',
    dryRunId,
    reconciliationHashes,
    version: 1,
  });
  const freshnessDurationMs = 900000;
  const freshnessPolicyHash = oracleHash({
    domain: 'rentcore.canonical_actual_posting.pr8_freshness_policy',
    durationMs: freshnessDurationMs,
    intervalKind: 'half_open',
    policyId: 'rentcore.pr8_evidence_freshness.v1',
    policyVersion: 1,
    version: 1,
  });
  const validUntilExclusive = new Date(Date.parse(run.finalizedAt) + freshnessDurationMs).toISOString();
  const freshnessWindowFingerprint = oracleHash({
    domain: 'rentcore.canonical_actual_posting.pr8_freshness_window',
    finalizedAt: run.finalizedAt,
    freshnessDurationMs,
    freshnessPolicyHash,
    freshnessPolicyId: 'rentcore.pr8_evidence_freshness.v1',
    freshnessPolicyVersion: 1,
    validFrom: run.finalizedAt,
    validUntilExclusive,
    version: 1,
  });
  return {
    companyTimezoneSnapshot: run.companyTimezone,
    dryRunId,
    finalizedAt: run.finalizedAt,
    freshnessDurationMs,
    freshnessPolicyHash,
    freshnessPolicyId: 'rentcore.pr8_evidence_freshness.v1',
    freshnessPolicyVersion: 1,
    freshnessWindowFingerprint,
    policyManifestHash: run.policyManifestHash,
    reconciliationSetHash,
    resultHash: run.resultHash,
    sourceInputManifestHash: run.sourceInputManifestHash,
    sourceOwnershipManifestHash: context.authority.authorization.sourceOwnershipManifestHash,
    validFrom: run.finalizedAt,
    validUntilExclusive,
  };
}

function oracleCohortHash(activation, overrides = {}) {
  const value = { ...activation, ...overrides };
  return oracleHash({
    allowedDocumentClasses: JSON.parse(value.allowedDocumentClassesJson),
    allowedRentalClasses: JSON.parse(value.allowedRentalClassesJson),
    branchIds: [value.branchId],
    cohortVersion: 1,
    companyId: value.companyId,
    currency: value.currency,
    domain: 'rentcore.canonical_actual_posting.cohort',
    explicitExclusions: JSON.parse(value.explicitExclusionsJson),
    forwardOnlyStartDate: value.forwardOnlyStartDate,
    policyManifestHashes: JSON.parse(value.policyManifestHashesJson),
    sourceSystems: JSON.parse(value.sourceSystemIdsJson),
    version: 1,
  });
}

function oracleBoundaryHash(activation, overrides = {}) {
  const value = { ...activation, ...overrides };
  return oracleHash({
    boundaryEndUtc: null,
    boundaryVersion: 1,
    branchIds: [value.branchId],
    companyId: value.companyId,
    companyTimezoneSnapshot: value.companyTimezoneSnapshot,
    currency: value.currency,
    domain: 'rentcore.canonical_actual_posting.boundary',
    exclusionRules: JSON.parse(value.explicitExclusionsJson),
    forwardOnlyStartDate: value.forwardOnlyStartDate,
    forwardOnlyStartUtc: value.forwardOnlyStartUtc,
    sourceClass: 'conducted_upd_validated_coverage_slice_v1',
    sourceSystems: JSON.parse(value.sourceSystemIdsJson),
    version: 1,
  });
}

function oraclePersistedRowFingerprint(db, tableName, row) {
  const columns = db.prepare(`PRAGMA table_xinfo(${tableName})`).all()
    .filter(column => Number(column.hidden) === 0)
    .sort((left, right) => Number(left.cid) - Number(right.cid))
    .map(column => ({ columnName: column.name, value: row[column.name] }));
  let rowVersion = null;
  for (const field of ['version', 'sourceVersion', 'sourceEventVersion', 'resultVersion', 'aggregateVersion']) {
    if (row[field] != null) {
      rowVersion = Number(row[field]);
      break;
    }
  }
  return oracleHash({
    columns,
    domain: 'rentcore.billing_source_authority.persisted_row',
    rowId: row.id,
    rowVersion,
    tableName,
    version: 1,
  });
}

function oracleBrokenEdge(context, relation, rootCoverageLineageId, edgeFailureState) {
  const relationRowFingerprint = oraclePersistedRowFingerprint(
    context.db,
    'billing_source_coverage_supersessions',
    relation,
  );
  const brokenEdgeFingerprint = oracleHash({
    branchId: relation.branchId,
    companyId: relation.companyId,
    domain: 'rentcore.canonical_actual_posting.broken_successor_edge',
    edgeFailureState,
    fromCoverageSetId: relation.originalCoverageSetId,
    relationRowFingerprint,
    rootCoverageLineageId,
    toCoverageSetId: relation.replacementCoverageSetId,
    version: 1,
  });
  return {
    brokenEdgeFingerprint,
    edgeFailureState,
    fromCoverageSetId: relation.originalCoverageSetId,
    toCoverageSetId: relation.replacementCoverageSetId,
  };
}

function resealAcceptance(context, { acceptedDryRuns, acceptedRuns, authorization = {} }) {
  const persistedAuthorization = context.db.prepare(`
    SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
  `).get(context.authority.authorization.recordId);
  const acceptedDryRunsHash = oracleAcceptedDryRunsHash(acceptedDryRuns);
  const acceptedFreshnessWindowsHash = oracleFreshnessWindowsHash(acceptedRuns);
  const acceptedPr8EvidenceHash = oracleAcceptedPr8EvidenceHash({
    acceptedDryRunsHash,
    acceptedFreshnessWindowsHash,
    acceptedRuns,
    evidencePackHash: persistedAuthorization.evidencePackHash,
  });
  const changedAuthorization = {
    ...persistedAuthorization,
    ...authorization,
    acceptedDryRunsJson: oracleCanonicalJson(acceptedDryRuns),
    acceptedDryRunsHash,
    acceptedPr8EvidenceJson: oracleCanonicalJson(acceptedRuns),
    acceptedPr8EvidenceHash,
    acceptedFreshnessWindowsHash,
  };
  changedAuthorization.recordHash = oracleRecordHash(
    changedAuthorization,
    ORACLE_WRITE_AUTHORIZATION_FIELDS,
    'rentcore.canonical_actual_posting.write_authorization',
  );
  rewriteWholeRow(context.db, 'canonical_write_authorization_records', changedAuthorization);

  const persistedActivation = context.db.prepare(`
    SELECT * FROM canonical_posting_activation_records WHERE recordId = ?
  `).get(context.authority.activation.recordId);
  const changedActivation = {
    ...persistedActivation,
    acceptedDryRunsHash,
    acceptedPr8EvidenceHash,
    acceptedFreshnessWindowsHash,
  };
  changedActivation.recordHash = oracleRecordHash(
    changedActivation,
    ORACLE_ACTIVATION_FIELDS,
    'rentcore.canonical_actual_posting.activation',
  );
  rewriteWholeRow(context.db, 'canonical_posting_activation_records', changedActivation);
  return { authorization: changedAuthorization, activation: changedActivation };
}

function insertDisconnectedCoverageRoot(context, suffix = 'hostile-disconnected') {
  const coverageSet = context.db.prepare('SELECT * FROM billing_source_coverage_sets ORDER BY id LIMIT 1').get();
  const coverageSlice = context.db.prepare(`
    SELECT * FROM billing_source_coverage_slices WHERE coverageSetId = ? ORDER BY id LIMIT 1
  `).get(coverageSet.id);
  const competingSet = {
    ...coverageSet,
    id: `coverage-set-${suffix}`,
    version: Number(context.db.prepare(`
      SELECT MAX(version) AS version FROM billing_source_coverage_sets WHERE updId = ?
    `).get(coverageSet.updId).version) + 1,
    createdAt: '2026-07-27T12:00:01.000Z',
  };
  const competingSlice = {
    ...coverageSlice,
    id: `coverage-slice-${suffix}`,
    coverageSetId: competingSet.id,
    createdAt: '2026-07-27T12:00:01.000Z',
  };
  insertCopiedRow(context.db, 'billing_source_coverage_sets', competingSet);
  const overlapTrigger = context.db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name = 'trg_billing_source_coverage_slices_no_overlap'
  `).get();
  context.db.exec(`DROP TRIGGER "${overlapTrigger.name}"`);
  try {
    insertCopiedRow(context.db, 'billing_source_coverage_slices', competingSlice);
  } finally {
    context.db.exec(overlapTrigger.sql);
  }
  return { competingSet, competingSlice };
}

function deletePr8RowIgnoringForeignKeys(context, table, id) {
  context.db.pragma('foreign_keys = OFF');
  try {
    mutateAppendOnlyTable(context.db, table, () => {
      context.db.prepare(`DELETE FROM ${table} WHERE id = ?`).run(id);
    });
  } finally {
    context.db.pragma('foreign_keys = ON');
  }
}

test('independent PR9a hostile oracle matches a fixed external SHA-256 golden', () => {
  const value = {
    version: 1,
    domain: 'rentcore.pr9a.independent_oracle_golden',
  };
  assert.equal(
    oracleCanonicalJson(value),
    '{"domain":"rentcore.pr9a.independent_oracle_golden","version":1}',
  );
  assert.equal(
    oracleHash(value),
    '8ae402684170acf5b0ebae32faf3d5581a1dae7efa3d80d1394d9d5d6860a87b',
  );
});

function insertPostingTriplet(context, event) {
  const canonicalReceivableId = `canonical-receivable-${event.id}`;
  const operationId = `canonical-operation-${event.id}`;
  const auditEventId = `canonical-audit-${event.id}`;
  const idempotencyKey = `canonical-posting-${event.id}`;
  const canonicalReceivableFingerprint = sha256Canonical({ eventId: event.id, fixture: 'canonical' });
  const auditPayloadFingerprint = sha256Canonical({ eventId: event.id, fixture: 'payload' });
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
    currency: event.currency,
    originalAmountMinor: event.grossAmountMinor,
    issuedAt: null,
    postedAt: event.createdAt,
    contractualDueDate: event.contractualDueDate,
    dueDateProvenance: event.dueDateProvenance,
    companyTimezone: event.companyTimezoneSnapshot,
    workflowStatus: 'posted',
    cancellationReason: null,
    description: null,
    createdAt: event.createdAt,
    updatedAt: event.createdAt,
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
    commandFingerprint: sha256Canonical({ eventId: event.id, fixture: 'command' }),
    auditPayloadFingerprint,
    auditEventFingerprint: sha256Canonical({ eventId: event.id, fixture: 'audit-event' }),
    resultHash: sha256Canonical({ eventId: event.id, fixture: 'result' }),
    financialAuditEventId: auditEventId,
    correlationId: event.correlationId,
    schemaVersion: 1,
    createdAt: event.createdAt,
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
    occurredAt: event.createdAt,
    reason: 'canonical_actual_posting_initial_post_v1',
    previousValueJson: null,
    newValueJson: canonicalJson(payload),
    correlationId: event.correlationId,
    sourceSystem: 'rentcore.billing_source_authority.v1',
    createdAt: event.createdAt,
  };
  context.db.exec('BEGIN');
  try {
    insertCopiedRow(context.db, 'canonical_receivables', receivable);
    insertCopiedRow(context.db, 'canonical_receivable_posting_operations', operation);
    insertCopiedRow(context.db, 'financial_audit_events', audit);
    context.db.exec('COMMIT');
  } catch (error) {
    if (context.db.inTransaction) context.db.exec('ROLLBACK');
    throw error;
  }
  return { audit, operation, receivable };
}

function assertRequiredDenial(context, expectedType, command = eligibilityCommand(context)) {
  const before = counts(context.db);
  let denial;
  try {
    context.eligibilityService.produceEligibleEvent(command);
  } catch (error) {
    denial = error;
  }
  assert.ok(denial);
  assert.equal(denial.code, expectedType);
  assert.equal(denial.replayed, false);
  assert.deepEqual(counts(context.db), {
    events: before.events,
    conflicts: before.conflicts + 1,
    transitions: before.transitions + 1,
    receivables: before.receivables,
    operations: before.operations,
  });
  const conflict = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
  const transition = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflict_transitions').get();
  assert.equal(conflict.conflictType, expectedType);
  assert.deepEqual(
    [transition.state, transition.attemptApplied, transition.rateApplied, transition.circuitApplied],
    ['COMPLETE', 1, 1, 1],
  );
  const observation = JSON.parse(conflict.conflictObservationJson);
  assert.equal(observation.conflictType, expectedType);
  assert.notEqual(canonicalJson(observation.expectedProjection), canonicalJson(observation.observedProjection));
  const beforeReplay = canonicalJson({ conflict, transition });
  const pair = context.eligibilityRepository.readConflictPair(transition.transitionId);
  assert.equal(canonicalJson({ conflict: pair.conflict, transition: pair.transition }), beforeReplay);
  assert.equal(canonicalJson({
    conflict: context.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get(),
    transition: context.db.prepare('SELECT * FROM canonical_receivable_posting_conflict_transitions').get(),
  }), beforeReplay);
  return { conflict, denial, observation, transition };
}

function mutateAfterNextRollback(db, mutation) {
  const originalExec = db.exec;
  let armed = true;
  Object.defineProperty(db, 'exec', {
    configurable: true,
    value(sql) {
      const result = originalExec.call(db, sql);
      if (armed && String(sql).trim().toUpperCase() === 'ROLLBACK') {
        armed = false;
        mutation();
      }
      return result;
    },
  });
  return () => { delete db.exec; };
}

function nextAuthority(previous, version, overrides = {}) {
  const { recordHash: _recordHash, ...previousWithoutHash } = previous;
  return authorityRecord({
    kind: previous.authorityKind,
    ownershipHash: previous.sourceOwnershipManifestHash,
    overrides: {
      ...previousWithoutHash,
      recordId: `authority-record-${previous.authorityKind}-v${version}`,
      authorityVersion: version,
      previousRecordId: previous.recordId,
      createdAt: `2026-07-27T10:${String(version).padStart(2, '0')}:00.000Z`,
      ...overrides,
    },
  });
}

function appendAuthorizationVersion(context, overrides = {}) {
  const previous = context.authority.repository.readLatestWriteAuthorization({
    branchId: 'branch-a-1', companyId: 'company-a',
  });
  const record = {
    ...previous,
    ...overrides,
    authorizationVersion: previous.authorizationVersion + 1,
    createdAt: new Date(Date.now() + previous.authorizationVersion).toISOString(),
    previousRecordId: previous.recordId,
    recordId: `write-authorization-record-v${previous.authorizationVersion + 1}`,
  };
  delete record.recordHash;
  record.recordHash = computeWriteAuthorizationRecordHash(record);
  return context.authority.repository.appendWriteAuthorizationRecord(record).record;
}

function appendActivationVersion(context, writeAuthorization, overrides = {}) {
  const previous = context.authority.repository.readLatestActivation({
    branchId: 'branch-a-1', companyId: 'company-a',
  });
  const record = {
    ...previous,
    ...overrides,
    activationVersion: previous.activationVersion + 1,
    createdAt: new Date(Date.now() + previous.activationVersion).toISOString(),
    previousRecordId: previous.recordId,
    recordId: `posting-activation-record-v${previous.activationVersion + 1}`,
    writeAuthorizationRecordId: writeAuthorization.recordId,
  };
  delete record.recordHash;
  record.recordHash = computeActivationRecordHash(record);
  return context.authority.repository.appendActivationRecord(record).record;
}

function produceConflict(context) {
  context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
  mutateCandidateForConflict(context);
  let error;
  try {
    context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
  } catch (caught) {
    error = caught;
  }
  assert.ok(error);
  return error;
}

function runWorker(dbPath, command, runtimeContractInput) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(
      new URL('./helpers/canonical-actual-eligibility-concurrency-worker.mjs', import.meta.url),
      { workerData: { dbPath, command, runtimeContractInput } },
    );
    worker.once('message', resolve);
    worker.once('error', reject);
    worker.once('exit', code => {
      if (code !== 0) reject(new Error(`worker exited ${code}`));
    });
  });
}

test('Algorithm A creates one deterministic eligibility event and never performs canonical business DML', () => {
  const context = createPr9aContext();
  try {
    const result = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    assert.equal(result.replayed, false);
    assert.equal(result.event.eventSchemaVersion, 'ActualReceivableEligibleV1');
    assert.equal(result.event.eventVersion, 1);
    assert.equal(result.event.schemaVersion, 1);
    assert.equal(result.event.occurredAt, result.event.createdAt);
    assert.equal(result.event.companyTimezoneSnapshot, 'Europe/Moscow');
    assert.equal(result.event.writeAuthorizationRecordId, context.authority.authorization.recordId);
    assert.equal(validateEligibleEventRecord(result.event).eventHash, result.event.eventHash);
    assert.deepEqual(counts(context.db), {
      events: 1, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
    });
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.db.close();
  }
});

test('Algorithm A independently accepts the complete locked PR8 evidence graph', () => {
  const context = createPr9aContext();
  try {
    const result = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    assert.equal(result.replayed, false);
    assert.equal(result.event.candidateResultHash, context.authority.candidate.resultHash);
    assert.deepEqual(counts(context.db), {
      events: 1, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
    });
  } finally {
    context.db.close();
  }
});

test('every hostile PR8 graph mutation is a required PR8_EVIDENCE_MISMATCH denial with zero event DML', async t => {
  const mutations = [
    ['due-date evidence binding with stale result hash', context => {
      mutateAppendOnlyTable(context.db, 'actual_source_dry_run_candidates', () => {
        context.db.prepare(`
          UPDATE actual_source_dry_run_candidates SET dueDateEvidenceRef = ? WHERE id = ?
        `).run('contract-due-date-hostile-v2', context.authority.candidate.id);
      });
    }],
    ['candidate economic field', context => {
      mutateAppendOnlyTable(context.db, 'actual_source_dry_run_candidates', () => {
        context.db.prepare(`
          UPDATE actual_source_dry_run_candidates
          SET proposedOriginalAmountMinor = proposedOriginalAmountMinor + 1 WHERE id = ?
        `).run(context.authority.candidate.id);
      });
    }],
    ['result aggregate field', context => {
      mutateAppendOnlyTable(context.db, 'actual_source_dry_runs', () => {
        context.db.prepare(`
          UPDATE actual_source_dry_runs
          SET runNetMinor = runNetMinor + 1, runGrossMinor = runGrossMinor + 1
          WHERE id = ?
        `).run(context.dryRun.dryRunId);
      });
    }],
    ['child deterministic ordering', context => {
      mutateAppendOnlyTable(context.db, 'actual_source_dry_run_inputs', () => {
        const input = context.db.prepare(`
          SELECT id FROM actual_source_dry_run_inputs ORDER BY deterministicOrderKey, id LIMIT 1
        `).get();
        context.db.prepare(`
          UPDATE actual_source_dry_run_inputs SET deterministicOrderKey = ? WHERE id = ?
        `).run('f'.repeat(64), input.id);
      });
    }],
    ['missing child row', context => {
      mutateAppendOnlyTable(context.db, 'actual_source_dry_run_checks', () => {
        const check = context.db.prepare(`
          SELECT id FROM actual_source_dry_run_checks ORDER BY id LIMIT 1
        `).get();
        context.db.prepare('DELETE FROM actual_source_dry_run_checks WHERE id = ?').run(check.id);
      });
    }],
    ['duplicate child row', context => {
      context.db.exec('DROP INDEX uq_actual_source_check_identity');
      mutateAppendOnlyTable(context.db, 'actual_source_dry_run_checks', () => {
        const check = context.db.prepare(`
          SELECT * FROM actual_source_dry_run_checks WHERE candidateId IS NOT NULL ORDER BY id LIMIT 1
        `).get();
        insertCopiedRow(context.db, 'actual_source_dry_run_checks', {
          ...check,
          id: 'actual-source-check-hostile-duplicate',
        });
      });
    }],
    ['reconciliation delta', context => {
      mutateAppendOnlyTable(context.db, 'actual_source_dry_run_reconciliations', () => {
        const row = context.db.prepare(`
          SELECT id FROM actual_source_dry_run_reconciliations ORDER BY id LIMIT 1
        `).get();
        context.db.prepare(`
          UPDATE actual_source_dry_run_reconciliations
          SET deltaNetMinor = 1, blockerState = 1 WHERE id = ?
        `).run(row.id);
      });
    }],
    ['audit and operation seal', context => {
      mutateAppendOnlyTable(context.db, 'actual_source_dry_run_audit_events', () => {
        context.db.prepare(`
          UPDATE actual_source_dry_run_audit_events SET resultHash = ? WHERE aggregateId = ?
        `).run('0'.repeat(64), context.dryRun.dryRunId);
      });
    }],
    ['stale run result hash', context => {
      mutateAppendOnlyTable(context.db, 'actual_source_dry_runs', () => {
        context.db.prepare(`
          UPDATE actual_source_dry_runs SET resultHash = ? WHERE id = ?
        `).run('0'.repeat(64), context.dryRun.dryRunId);
      });
    }],
  ];
  const commonKeys = [
    'denialAttemptId', 'deniedAttemptedAt', 'postingAdapterAuthorityBranchId',
    'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityKind',
    'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityRecordId',
    'postingAdapterAuthorityVersion', 'postingAuthorityChainSnapshotHash',
    'producerAuthorityBranchId', 'producerAuthorityCompanyId', 'producerAuthorityKind',
    'producerAuthorityRecordHash', 'producerAuthorityRecordId', 'producerAuthorityVersion',
    'producerAuthorityChainSnapshotHash', 'sourceAuthorityChainSnapshotHash',
  ];
  const specificKeys = [
    'acceptedDryRunsHash', 'acceptedPr8EvidenceHash', 'deniedFreshnessWindowFingerprint',
    'dryRunId', 'freshnessState', 'freshnessWindowFingerprint',
    'reconciliationSetHash', 'resultHash',
  ];
  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        mutate(context);
        const { observation } = assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
        const expectedKeys = [...commonKeys, ...specificKeys].sort();
        assert.deepEqual(Object.keys(observation.expectedProjection).sort(), expectedKeys);
        assert.deepEqual(Object.keys(observation.observedProjection).sort(), expectedKeys);
        assert.deepEqual(context.db.pragma('foreign_key_check'), []);
      } finally {
        context.db.close();
      }
    });
  }
});

test('independent remediation hostile proofs reject fully resealed trust-boundary bypasses', async t => {
  await t.test('A-01 rejects an accepted evidence run absent from the complete pair projection', () => {
    const context = createPr9aContext();
    try {
      const acceptedDryRuns = JSON.parse(context.authority.authorization.acceptedDryRunsJson);
      const acceptedRuns = JSON.parse(context.authority.authorization.acceptedPr8EvidenceJson);
      const foreignRun = {
        ...acceptedRuns[0],
        dryRunId: 'foreign-resealed-pr8-run',
        resultHash: oracleHash({ fixture: 'foreign-resealed-pr8-run' }),
      };
      resealAcceptance(context, {
        acceptedDryRuns,
        acceptedRuns: [...acceptedRuns, foreignRun],
      });
      assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
    } finally {
      context.db.close();
    }
  });

  await t.test('A-01 rejects a fully resealed accepted-run ownership mutation', () => {
    const context = createPr9aContext();
    try {
      const acceptedDryRuns = JSON.parse(context.authority.authorization.acceptedDryRunsJson);
      const acceptedRuns = JSON.parse(context.authority.authorization.acceptedPr8EvidenceJson);
      acceptedRuns[0] = {
        ...acceptedRuns[0],
        sourceOwnershipManifestHash: oracleHash({ fixture: 'foreign-ownership' }),
      };
      resealAcceptance(context, { acceptedDryRuns, acceptedRuns });
      assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
    } finally {
      context.db.close();
    }
  });

  await t.test('A-02 rejects self-consistent forged policy, cohort, and boundary labels', () => {
    const context = createPr9aContext();
    try {
      const authorization = context.db.prepare(`
        SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
      `).get(context.authority.authorization.recordId);
      authorization.policyManifestHashesJson = oracleCanonicalJson([
        oracleHash({ fixture: 'forged-policy-manifest' }),
      ]);
      authorization.cohortHash = oracleHash({ fixture: 'forged-cohort-label' });
      authorization.boundaryHash = oracleHash({ fixture: 'forged-boundary-label' });
      authorization.recordHash = oracleRecordHash(
        authorization,
        ORACLE_WRITE_AUTHORIZATION_FIELDS,
        'rentcore.canonical_actual_posting.write_authorization',
      );
      rewriteWholeRow(context.db, 'canonical_write_authorization_records', authorization);

      const activation = context.db.prepare(`
        SELECT * FROM canonical_posting_activation_records WHERE recordId = ?
      `).get(context.authority.activation.recordId);
      activation.policyManifestHashesJson = authorization.policyManifestHashesJson;
      activation.cohortHash = authorization.cohortHash;
      activation.boundaryHash = authorization.boundaryHash;
      activation.recordHash = oracleRecordHash(
        activation,
        ORACLE_ACTIVATION_FIELDS,
        'rentcore.canonical_actual_posting.activation',
      );
      rewriteWholeRow(context.db, 'canonical_posting_activation_records', activation);

      assert.throws(
        () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
        error => error.code === 'CANONICAL_WRITE_AUTHORIZATION_INTEGRITY_FAILED',
      );
      assert.deepEqual(counts(context.db), {
        events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
      });
    } finally {
      context.db.close();
    }
  });

  await t.test('A-03 rejects a disconnected same-dimension PR6 coverage root', () => {
    const context = createPr9aContext();
    try {
      insertDisconnectedCoverageRoot(context);
      assertRequiredDenial(context, 'SOURCE_LINEAGE_ROOT_CONFLICT');
    } finally {
      context.db.close();
    }
  });

  await t.test('A-04 excludes a valid post-boundary authority append from historical C classification', () => {
    const context = createPr9aContext();
    let restore = () => {};
    try {
      mutateCandidateForConflict(context);
      restore = mutateAfterNextRollback(context.db, () => {
        context.authority.repository.appendAuthorityRecord(nextAuthority(context.authority.source, 2));
      });
      assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
    } finally {
      restore();
      context.db.close();
    }
  });

  await t.test('A-05 persists nullable PR8 mismatch evidence for a missing selected candidate', () => {
    const context = createPr9aContext();
    try {
      deletePr8RowIgnoringForeignKeys(
        context,
        'actual_source_dry_run_candidates',
        context.authority.candidate.id,
      );
      const { observation } = assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
      assert.equal(observation.observedProjection.resultHash, context.authority.run.resultHash);
      assert.equal(observation.observedProjection.reconciliationSetHash, null);
    } finally {
      context.db.close();
    }
  });
});

test('A-01 complete accepted PR8 set rejects independently resealed set, pair, time, and source drift', async t => {
  const cases = [
    ['pair entry absent from evidence', context => {
      const acceptedRuns = JSON.parse(context.authority.authorization.acceptedPr8EvidenceJson);
      const acceptedDryRuns = JSON.parse(context.authority.authorization.acceptedDryRunsJson);
      acceptedDryRuns.push({
        dryRunId: 'foreign-pair-only-run',
        resultHash: oracleHash({ fixture: 'foreign-pair-only-run' }),
      });
      resealAcceptance(context, { acceptedDryRuns, acceptedRuns });
    }],
    ['duplicate selected pair entry', context => {
      const acceptedRuns = JSON.parse(context.authority.authorization.acceptedPr8EvidenceJson);
      const acceptedDryRuns = JSON.parse(context.authority.authorization.acceptedDryRunsJson);
      acceptedDryRuns.push({ ...acceptedDryRuns[0] });
      resealAcceptance(context, { acceptedDryRuns, acceptedRuns });
    }],
    ['selected pair differs from full evidence projection', context => {
      const acceptedRuns = JSON.parse(context.authority.authorization.acceptedPr8EvidenceJson);
      const acceptedDryRuns = JSON.parse(context.authority.authorization.acceptedDryRunsJson);
      acceptedDryRuns[0] = {
        ...acceptedDryRuns[0],
        resultHash: oracleHash({ fixture: 'selected-pair-mismatch' }),
      };
      resealAcceptance(context, { acceptedDryRuns, acceptedRuns });
    }],
    ['company timezone snapshot drift', context => {
      const acceptedRuns = JSON.parse(context.authority.authorization.acceptedPr8EvidenceJson);
      const acceptedDryRuns = JSON.parse(context.authority.authorization.acceptedDryRunsJson);
      acceptedRuns[0] = { ...acceptedRuns[0], companyTimezoneSnapshot: 'UTC' };
      resealAcceptance(context, { acceptedDryRuns, acceptedRuns });
    }],
    ['persisted accepted run is absent', context => {
      deletePr8RowIgnoringForeignKeys(context, 'actual_source_dry_runs', context.authority.run.id);
    }],
    ['stale fully resealed acceptance window', context => {
      const acceptedRuns = JSON.parse(context.authority.authorization.acceptedPr8EvidenceJson);
      const acceptedDryRuns = JSON.parse(context.authority.authorization.acceptedDryRunsJson);
      const finalizedAt = '2026-07-27T09:00:00.000Z';
      const validUntilExclusive = '2026-07-27T09:15:00.000Z';
      acceptedRuns[0] = {
        ...acceptedRuns[0],
        finalizedAt,
        validFrom: finalizedAt,
        validUntilExclusive,
      };
      acceptedRuns[0].freshnessWindowFingerprint = oracleHash({
        domain: 'rentcore.canonical_actual_posting.pr8_freshness_window',
        finalizedAt,
        freshnessDurationMs: acceptedRuns[0].freshnessDurationMs,
        freshnessPolicyHash: acceptedRuns[0].freshnessPolicyHash,
        freshnessPolicyId: acceptedRuns[0].freshnessPolicyId,
        freshnessPolicyVersion: acceptedRuns[0].freshnessPolicyVersion,
        validFrom: finalizedAt,
        validUntilExclusive,
        version: 1,
      });
      resealAcceptance(context, { acceptedDryRuns, acceptedRuns });
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        mutate(context);
        assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
      } finally {
        context.db.close();
      }
    });
  }

  await t.test('multi-run acceptance rejects one run with different timezone and ownership', () => {
    const context = createPr9aContext();
    try {
      const second = context.dryRunService.evaluateActualSourceDryRun(
        context.dryRunContext,
        dryRunCommand({
          asOfDate: '2026-09-15',
          idempotencyKey: 'pr9-hostile-second-accepted-run',
          policyManifest: approvedTestPolicyManifest(),
        }),
      );
      const acceptedRuns = [
        oracleAcceptedRun(context, context.authority.run.id),
        oracleAcceptedRun(context, second.dryRunId),
      ].sort((left, right) => left.dryRunId < right.dryRunId ? -1 : left.dryRunId > right.dryRunId ? 1 : 0);
      acceptedRuns[1] = {
        ...acceptedRuns[1],
        companyTimezoneSnapshot: 'UTC',
        sourceOwnershipManifestHash: oracleHash({ fixture: 'multi-run-foreign-owner' }),
      };
      const acceptedDryRuns = acceptedRuns.map(entry => ({
        dryRunId: entry.dryRunId,
        resultHash: entry.resultHash,
      }));
      resealAcceptance(context, { acceptedDryRuns, acceptedRuns });
      assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
    } finally {
      context.db.close();
    }
  });

  await t.test('valid multi-run acceptance proves every persisted run graph', () => {
    const context = createPr9aContext();
    try {
      const second = context.dryRunService.evaluateActualSourceDryRun(
        context.dryRunContext,
        dryRunCommand({
          asOfDate: '2026-09-15',
          idempotencyKey: 'pr9-valid-second-accepted-run',
          policyManifest: approvedTestPolicyManifest(),
        }),
      );
      const acceptedRuns = [
        oracleAcceptedRun(context, context.authority.run.id),
        oracleAcceptedRun(context, second.dryRunId),
      ].sort((left, right) => left.dryRunId < right.dryRunId ? -1 : left.dryRunId > right.dryRunId ? 1 : 0);
      const acceptedDryRuns = acceptedRuns.map(entry => ({
        dryRunId: entry.dryRunId,
        resultHash: entry.resultHash,
      }));
      resealAcceptance(context, { acceptedDryRuns, acceptedRuns });
      const result = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      assert.equal(result.replayed, false);
      assert.deepEqual(counts(context.db), {
        events: 1, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
      });
    } finally {
      context.db.close();
    }
  });
});

test('A-02 authority projections reject independently resealed logical and normalized drift', async t => {
  const mutateActivation = (context, mutate) => {
    const activation = context.db.prepare(`
      SELECT * FROM canonical_posting_activation_records WHERE recordId = ?
    `).get(context.authority.activation.recordId);
    mutate(activation);
    activation.recordHash = oracleRecordHash(
      activation,
      ORACLE_ACTIVATION_FIELDS,
      'rentcore.canonical_actual_posting.activation',
    );
    rewriteWholeRow(context.db, 'canonical_posting_activation_records', activation);
  };
  const cases = [
    ['arbitrary equal cohort labels', context => {
      const forged = oracleHash({ fixture: 'arbitrary-equal-cohort' });
      const authorization = context.db.prepare(`
        SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
      `).get(context.authority.authorization.recordId);
      authorization.cohortHash = forged;
      authorization.recordHash = oracleRecordHash(
        authorization,
        ORACLE_WRITE_AUTHORIZATION_FIELDS,
        'rentcore.canonical_actual_posting.write_authorization',
      );
      rewriteWholeRow(context.db, 'canonical_write_authorization_records', authorization);
      mutateActivation(context, activation => { activation.cohortHash = forged; });
    }],
    ['arbitrary equal boundary labels', context => {
      const forged = oracleHash({ fixture: 'arbitrary-equal-boundary' });
      const authorization = context.db.prepare(`
        SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
      `).get(context.authority.authorization.recordId);
      authorization.boundaryHash = forged;
      authorization.recordHash = oracleRecordHash(
        authorization,
        ORACLE_WRITE_AUTHORIZATION_FIELDS,
        'rentcore.canonical_actual_posting.write_authorization',
      );
      rewriteWholeRow(context.db, 'canonical_write_authorization_records', authorization);
      mutateActivation(context, activation => { activation.boundaryHash = forged; });
    }],
    ['policy manifest differs from accepted evidence', context => {
      const authorization = context.db.prepare(`
        SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
      `).get(context.authority.authorization.recordId);
      authorization.policyManifestHashesJson = oracleCanonicalJson([
        oracleHash({ fixture: 'policy-not-in-accepted-evidence' }),
      ]);
      authorization.recordHash = oracleRecordHash(
        authorization,
        ORACLE_WRITE_AUTHORIZATION_FIELDS,
        'rentcore.canonical_actual_posting.write_authorization',
      );
      rewriteWholeRow(context.db, 'canonical_write_authorization_records', authorization);
    }],
    ['duplicate normalized source-system array', context => {
      mutateActivation(context, activation => {
        activation.sourceSystemIdsJson = oracleCanonicalJson([
          'rentcore.billing_source_authority.v1',
          'rentcore.billing_source_authority.v1',
        ]);
      });
    }],
    ['reordered normalized policy array', context => {
      mutateActivation(context, activation => {
        const existing = JSON.parse(activation.policyManifestHashesJson)[0];
        activation.policyManifestHashesJson = oracleCanonicalJson([
          oracleHash({ fixture: 'second-policy' }),
          existing,
        ].sort().reverse());
      });
    }],
    ['logical boundary fields retain stale stored labels', context => {
      mutateActivation(context, activation => {
        activation.forwardOnlyStartDate = '2026-08-02';
        activation.forwardOnlyStartUtc = '2026-08-01T21:00:00.000Z';
      });
    }],
  ];
  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        const activation = context.db.prepare(`
          SELECT * FROM canonical_posting_activation_records WHERE recordId = ?
        `).get(context.authority.activation.recordId);
        assert.equal(activation.cohortHash, oracleCohortHash(activation));
        assert.equal(activation.boundaryHash, oracleBoundaryHash(activation));
        let storageRejection = null;
        try {
          mutate(context);
        } catch (error) {
          storageRejection = error;
        }
        if (storageRejection) {
          assert.match(String(storageRejection.code), /^SQLITE_CONSTRAINT/);
          assert.deepEqual(counts(context.db), {
            events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
          });
          return;
        }
        assert.throws(
          () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
          error => [
            'CANONICAL_WRITE_AUTHORIZATION_INTEGRITY_FAILED',
            'CANONICAL_POSTING_ACTIVATION_INTEGRITY_FAILED',
            'CANONICAL_AUTHORITY_LOGICAL_PROJECTION_INVALID',
          ].includes(error.code),
        );
        assert.deepEqual(counts(context.db), {
          events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
        });
      } finally {
        context.db.close();
      }
    });
  }

  await t.test('source slice before the forward-only date is denied', () => {
    const context = createPr9aContext();
    try {
      mutateAppendOnlyTable(context.db, 'actual_source_dry_run_candidates', () => {
        context.db.prepare(`
          UPDATE actual_source_dry_run_candidates SET sliceStartDate = '2026-07-31'
          WHERE id = ?
        `).run(context.authority.candidate.id);
      });
      assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
    } finally {
      context.db.close();
    }
  });

  await t.test('self-consistent policy projection still must match persisted PR8 policy', () => {
    const context = createPr9aContext();
    try {
      const forgedPolicy = oracleHash({ fixture: 'self-consistent-foreign-policy' });
      const acceptedDryRuns = JSON.parse(context.authority.authorization.acceptedDryRunsJson);
      const acceptedRuns = JSON.parse(context.authority.authorization.acceptedPr8EvidenceJson);
      acceptedRuns[0] = { ...acceptedRuns[0], policyManifestHash: forgedPolicy };
      resealAcceptance(context, {
        acceptedDryRuns,
        acceptedRuns,
        authorization: { policyManifestHashesJson: oracleCanonicalJson([forgedPolicy]) },
      });
      const activation = context.db.prepare(`
        SELECT * FROM canonical_posting_activation_records WHERE recordId = ?
      `).get(context.authority.activation.recordId);
      activation.policyManifestHashesJson = oracleCanonicalJson([forgedPolicy]);
      activation.cohortHash = oracleCohortHash(activation);
      activation.recordHash = oracleRecordHash(
        activation,
        ORACLE_ACTIVATION_FIELDS,
        'rentcore.canonical_actual_posting.activation',
      );
      rewriteWholeRow(context.db, 'canonical_posting_activation_records', activation);
      const authorization = context.db.prepare(`
        SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
      `).get(context.authority.authorization.recordId);
      authorization.cohortHash = activation.cohortHash;
      authorization.recordHash = oracleRecordHash(
        authorization,
        ORACLE_WRITE_AUTHORIZATION_FIELDS,
        'rentcore.canonical_actual_posting.write_authorization',
      );
      rewriteWholeRow(context.db, 'canonical_write_authorization_records', authorization);
      assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
    } finally {
      context.db.close();
    }
  });
});

test('A-03 full same-scope PR6 graph seals complete sorted roots, edges, and revisions', async t => {
  await t.test('three disconnected competing overlapping roots seal the full sorted root set', () => {
    const context = createPr9aContext();
    try {
      const first = insertDisconnectedCoverageRoot(context, 'root-z');
      const second = insertDisconnectedCoverageRoot(context, 'root-a');
      const { observation } = assertRequiredDenial(context, 'SOURCE_LINEAGE_ROOT_CONFLICT');
      const roots = [
        context.authority.candidate.coverageSetId,
        first.competingSet.id,
        second.competingSet.id,
      ].sort();
      assert.equal(observation.observedProjection.rootCount, 3);
      assert.equal(observation.observedProjection.rootObservationState, 'disconnected_roots');
      assert.equal(observation.observedProjection.rootCoverageLineageIdsHash, oracleHash({
        domain: 'rentcore.canonical_actual_posting.root_lineage_ids',
        rootCoverageLineageIds: roots,
        version: 1,
      }));
      assert.equal(observation.observedProjection.rootSourceDocumentLineageIdsHash, oracleHash({
        domain: 'rentcore.canonical_actual_posting.root_source_document_lineage_ids',
        rootSourceDocumentLineageIds: [context.authority.candidate.updId],
        version: 1,
      }));
    } finally {
      context.db.close();
    }
  });

  await t.test('forked successor seals every sorted edge and never selects by order', () => {
    const context = createPr9aContext();
    try {
      context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      appendConductedSourceCorrection(context, 'full-fork');
      const relation = context.db.prepare('SELECT * FROM billing_source_coverage_supersessions').get();
      context.db.exec('DROP INDEX uq_billing_source_coverage_supersession_original');
      mutateAppendOnlyTable(context.db, 'billing_source_coverage_supersessions', () => {
        insertCopiedRow(context.db, 'billing_source_coverage_supersessions', {
          ...relation,
          id: 'billing-source-supersession-hostile-full-fork',
          sourceEventId: 'hostile-full-fork-event',
        });
      });
      const { observation } = assertRequiredDenial(context, 'SOURCE_LINEAGE_BROKEN_SUCCESSOR');
      assert.equal(observation.observedProjection.brokenEdgeCount, 2);
      assert.equal(observation.observedProjection.brokenEdgeFingerprint, null);
      assert.equal(observation.observedProjection.brokenEdgeFromId, null);
      assert.equal(observation.observedProjection.brokenEdgeToId, null);
      const persistedRelations = context.db.prepare(`
        SELECT * FROM billing_source_coverage_supersessions
        ORDER BY originalCoverageSetId, replacementCoverageSetId, action, id
      `).all();
      const brokenEdges = persistedRelations.map(row => oracleBrokenEdge(
        context,
        row,
        observation.observedProjection.rootCoverageLineageId,
        'forked_successor',
      )).sort((left, right) => {
        const a = oracleCanonicalJson(left);
        const b = oracleCanonicalJson(right);
        return a < b ? -1 : a > b ? 1 : 0;
      });
      assert.equal(observation.observedProjection.brokenEdgesHash, oracleHash({
        brokenEdges,
        domain: 'rentcore.canonical_actual_posting.broken_successor_edges',
        version: 1,
      }));
    } finally {
      context.db.close();
    }
  });

  await t.test('formedVersionId drift cannot manufacture a current revision', () => {
    const context = createPr9aContext();
    try {
      context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      appendConductedSourceCorrection(context, 'formed-version-drift');
      const latestSlice = context.db.prepare(`
        SELECT * FROM billing_source_coverage_slices ORDER BY createdAt DESC, id DESC LIMIT 1
      `).get();
      context.db.pragma('foreign_keys = OFF');
      try {
        mutateAppendOnlyTable(context.db, 'billing_source_coverage_slices', () => {
          context.db.prepare(`
            UPDATE billing_source_coverage_slices
            SET formedUpdVersionId = 'missing-formed-version'
            WHERE id = ?
          `).run(latestSlice.id);
        });
      } finally {
        context.db.pragma('foreign_keys = ON');
      }
      const { observation } = assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
      assert.equal(observation.observedProjection.currentRevisionCount, 0);
      assert.equal(observation.observedProjection.currentRevisionKeysHash, oracleHash({
        currentSourceRevisionKeys: [],
        domain: 'rentcore.canonical_actual_posting.current_revision_keys',
        version: 1,
      }));
    } finally {
      context.db.close();
    }
  });
});

test('A-04 Algorithm C validates live authority suffix only as immutable contiguous evidence', async t => {
  const cases = [
    ['malformed suffix row', context => {
      const descendant = nextAuthority(context.authority.source, 2);
      context.authority.repository.appendAuthorityRecord(descendant);
      mutateAppendOnlyTable(context.db, 'governed_adapter_authority_records', () => {
        context.db.prepare(`
          UPDATE governed_adapter_authority_records SET ownerRef = 'malformed-suffix-owner'
          WHERE recordId = ?
        `).run(descendant.recordId);
      });
    }],
    ['gap in suffix', context => {
      const second = nextAuthority(context.authority.source, 2);
      const third = nextAuthority(second, 3);
      context.authority.repository.appendAuthorityRecord(second);
      context.authority.repository.appendAuthorityRecord(third);
      context.db.pragma('foreign_keys = OFF');
      try {
        mutateAppendOnlyTable(context.db, 'governed_adapter_authority_records', () => {
          context.db.prepare(`
            DELETE FROM governed_adapter_authority_records WHERE recordId = ?
          `).run(second.recordId);
        });
      } finally {
        context.db.pragma('foreign_keys = ON');
      }
    }],
    ['mutation at frozen maximum', context => {
      mutateAppendOnlyTable(context.db, 'governed_adapter_authority_records', () => {
        context.db.prepare(`
          UPDATE governed_adapter_authority_records SET ownerRef = 'mutated-frozen-owner'
          WHERE recordId = ?
        `).run(context.authority.source.recordId);
      });
    }],
  ];
  for (const [name, corrupt] of cases) {
    await t.test(name, () => {
      const context = createPr9aContext();
      let restore = () => {};
      try {
        mutateCandidateForConflict(context);
        restore = mutateAfterNextRollback(context.db, () => corrupt(context));
        assert.throws(
          () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
          error => [
            ERROR_CODES.AUTHORITY_FROZEN_CHAIN_SNAPSHOT_INTEGRITY_FAILED,
            ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED,
          ].includes(error.code),
        );
        assert.deepEqual(counts(context.db), {
          events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
        });
      } finally {
        restore();
        context.db.close();
      }
    });
  }
});

test('A-05 missing PR8 parents retain exact nullable projection and complete Algorithm C accounting', async t => {
  for (const [name, remove] of [
    ['selected run missing', context => {
      deletePr8RowIgnoringForeignKeys(context, 'actual_source_dry_runs', context.authority.run.id);
    }],
    ['selected candidate missing', context => {
      deletePr8RowIgnoringForeignKeys(context, 'actual_source_dry_run_candidates', context.authority.candidate.id);
    }],
    ['selected run and candidate missing', context => {
      deletePr8RowIgnoringForeignKeys(context, 'actual_source_dry_run_candidates', context.authority.candidate.id);
      deletePr8RowIgnoringForeignKeys(context, 'actual_source_dry_runs', context.authority.run.id);
    }],
  ]) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        remove(context);
        const before = counts(context.db);
        const { observation, transition } = assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
        const specificKeys = [
          'acceptedDryRunsHash', 'acceptedPr8EvidenceHash', 'deniedFreshnessWindowFingerprint',
          'dryRunId', 'freshnessState', 'freshnessWindowFingerprint',
          'reconciliationSetHash', 'resultHash',
        ];
        for (const projection of [observation.expectedProjection, observation.observedProjection]) {
          for (const key of specificKeys) assert.ok(Object.hasOwn(projection, key));
        }
        assert.equal(observation.observedProjection.reconciliationSetHash, null);
        assert.deepEqual(
          [transition.state, transition.attemptApplied, transition.rateApplied, transition.circuitApplied],
          ['COMPLETE', 1, 1, 1],
        );
        assert.deepEqual(counts(context.db), {
          ...before,
          conflicts: before.conflicts + 1,
          transitions: before.transitions + 1,
        });
      } finally {
        context.db.close();
      }
    });
  }
});

test('required authorization, activation, due-date, and timezone denials all flow through Algorithm C', async t => {
  const cases = [
    ['authorization missing', 'AUTHORIZATION_DRIFT', context => ({
      command: eligibilityCommand(context, { writeAuthorizationRecordId: 'missing-write-authorization' }),
    })],
    ['authorization latest-version drift', 'AUTHORIZATION_DRIFT', context => {
      appendAuthorizationVersion(context);
      return { command: eligibilityCommand(context) };
    }],
    ['activation missing', 'ACTIVATION_DRIFT', context => ({
      command: eligibilityCommand(context, { activationRecordId: 'missing-posting-activation' }),
    })],
    ['activation latest-version drift', 'ACTIVATION_DRIFT', context => {
      appendActivationVersion(context, context.authority.authorization);
      return { command: eligibilityCommand(context) };
    }],
    ['due-date policy drift', 'DUE_DATE_POLICY_DRIFT', context => {
      const dueDatePolicySet = JSON.parse(context.authority.authorization.dueDatePolicySetJson);
      dueDatePolicySet.contractualDueDate.expectedSourceRef = 'invoice_due_date';
      const dueDatePolicySetJson = canonicalJson(dueDatePolicySet);
      const dueDatePolicySetHash = computeDueDatePolicySetHash(dueDatePolicySet);
      const authorization = appendAuthorizationVersion(context, {
        dueDatePolicySetHash,
        dueDatePolicySetJson,
      });
      const activation = appendActivationVersion(context, authorization, {
        dueDatePolicySetHash,
        dueDatePolicySetJson,
      });
      return {
        command: eligibilityCommand(context, {
          activationRecordId: activation.recordId,
          writeAuthorizationRecordId: authorization.recordId,
        }),
      };
    }],
    ['company timezone drift', 'COMPANY_TIMEZONE_DRIFT', context => {
      mutateAppendOnlyTable(context.db, 'canonical_companies', () => {
        context.db.prepare(`
          UPDATE canonical_companies SET receivablesTimezone = 'UTC' WHERE id = 'company-a'
        `).run();
      });
      return { command: eligibilityCommand(context) };
    }],
  ];
  const specificKeys = {
    AUTHORIZATION_DRIFT: [
      'authorizationId', 'authorizationTemporalState', 'authorizationVersion', 'recordHash',
      'status', 'temporalWindowFingerprint', 'validFrom', 'validUntil',
    ],
    ACTIVATION_DRIFT: [
      'activationId', 'activationTemporalState', 'activationVersion', 'recordHash',
      'status', 'temporalWindowFingerprint', 'validFrom', 'validUntil',
    ],
    DUE_DATE_POLICY_DRIFT: [
      'bindingState', 'dueDatePolicySetHash', 'dueDateTreatment', 'selectedDueDateGateKind',
      'selectedDueDatePolicyHash', 'selectedDueDatePolicyId', 'selectedDueDatePolicyVersion',
      'unknownDueDateTreatmentMappingHash', 'unknownDueDateTreatmentMappingId',
      'unknownDueDateTreatmentMappingVersion',
    ],
    COMPANY_TIMEZONE_DRIFT: [
      'acceptedCompanyTimezoneSnapshot', 'activationCompanyTimezoneSnapshot',
      'eventCompanyTimezoneSnapshot', 'pr5ReceivablesTimezone', 'pr8RunCompanyTimezone',
      'timezoneState',
    ],
  };
  const commonKeys = [
    'denialAttemptId', 'deniedAttemptedAt', 'postingAdapterAuthorityBranchId',
    'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityKind',
    'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityRecordId',
    'postingAdapterAuthorityVersion', 'postingAuthorityChainSnapshotHash',
    'producerAuthorityBranchId', 'producerAuthorityCompanyId', 'producerAuthorityKind',
    'producerAuthorityRecordHash', 'producerAuthorityRecordId', 'producerAuthorityVersion',
    'producerAuthorityChainSnapshotHash', 'sourceAuthorityChainSnapshotHash',
  ];
  for (const [name, expectedType, arrange] of cases) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        const { command } = arrange(context);
        const { observation } = assertRequiredDenial(context, expectedType, command);
        const expectedKeys = [...commonKeys, ...specificKeys[expectedType]].sort();
        assert.deepEqual(Object.keys(observation.expectedProjection).sort(), expectedKeys);
        assert.deepEqual(Object.keys(observation.observedProjection).sort(), expectedKeys);
        assert.equal(Object.keys(observation.expectedProjection).some(key => key.startsWith('CANONICAL_')), false);
      } finally {
        context.db.close();
      }
    });
  }
});

test('locked source revision state machine classifies revision change, correction, posting, and lineage failures with exact precedence', async t => {
  const commonKeys = [
    'denialAttemptId', 'deniedAttemptedAt', 'postingAdapterAuthorityBranchId',
    'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityKind',
    'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityRecordId',
    'postingAdapterAuthorityVersion', 'postingAuthorityChainSnapshotHash',
    'producerAuthorityBranchId', 'producerAuthorityCompanyId', 'producerAuthorityKind',
    'producerAuthorityRecordHash', 'producerAuthorityRecordId', 'producerAuthorityVersion',
    'producerAuthorityChainSnapshotHash', 'sourceAuthorityChainSnapshotHash',
  ];
  const assertProjectionKeys = (observation, keys) => {
    const expected = [...commonKeys, ...keys].sort();
    assert.deepEqual(Object.keys(observation.expectedProjection).sort(), expected);
    assert.deepEqual(Object.keys(observation.observedProjection).sort(), expected);
  };

  await t.test('same revision IDs with changed content before posting', () => {
    const context = createPr9aContext();
    try {
      const event = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)).event;
      mutateAppendOnlyTable(context.db, 'billing_source_upd_versions', () => {
        context.db.prepare(`
          UPDATE billing_source_upd_versions SET contentHash = ? WHERE id = ?
        `).run('0'.repeat(64), event.conductedUpdVersionId);
      });
      const { observation } = assertRequiredDenial(
        context,
        'SOURCE_REVISION_CHANGED_BEFORE_POSTING',
      );
      assertProjectionKeys(observation, [
        'currentPr6RevisionHash', 'currentSourceRevisionKey', 'economicLineageKey',
        'eventId', 'sealedPr6RevisionHash', 'sealedSourceRevisionKey',
      ]);
      assert.equal(observation.expectedProjection.eventId, event.id);
      assert.equal(observation.expectedProjection.sealedPr6RevisionHash, event.currentPr6RevisionHash);
      assert.notEqual(
        observation.observedProjection.currentPr6RevisionHash,
        observation.expectedProjection.currentPr6RevisionHash,
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('event-sealed PR6 lineage drift uses its dedicated registry type', () => {
    const context = createPr9aContext();
    try {
      const event = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)).event;
      const changed = { ...event, sourceLineageHash: '0'.repeat(64) };
      delete changed.id;
      delete changed.eventHash;
      const eventHash = computeEligibleEventHash(changed);
      mutateAppendOnlyTable(context.db, 'actual_receivable_eligible_events', () => {
        context.db.prepare(`
          UPDATE actual_receivable_eligible_events
          SET sourceLineageHash = ?, eventHash = ? WHERE id = ?
        `).run(changed.sourceLineageHash, eventHash, event.id);
      });
      const { observation } = assertRequiredDenial(context, 'PR6_LINEAGE_DRIFT');
      assertProjectionKeys(observation, ['sourceLineageHash']);
      assert.equal(observation.expectedProjection.sourceLineageHash, changed.sourceLineageHash);
      assert.equal(observation.observedProjection.sourceLineageHash, event.sourceLineageHash);
    } finally {
      context.db.close();
    }
  });

  await t.test('self-consistent event content collision remains ECONOMIC_SOURCE_EVENT_MISMATCH', () => {
    const context = createPr9aContext();
    try {
      const event = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)).event;
      const changed = {
        ...event,
        grossAmountMinor: event.grossAmountMinor + 1,
        netAmountMinor: event.netAmountMinor + 1,
        originalAmountMinor: event.originalAmountMinor + 1,
      };
      delete changed.id;
      delete changed.eventHash;
      const eventHash = computeEligibleEventHash(changed);
      mutateAppendOnlyTable(context.db, 'actual_receivable_eligible_events', () => {
        context.db.prepare(`
          UPDATE actual_receivable_eligible_events
          SET grossAmountMinor = ?, netAmountMinor = ?, originalAmountMinor = ?, eventHash = ?
          WHERE id = ?
        `).run(
          changed.grossAmountMinor,
          changed.netAmountMinor,
          changed.originalAmountMinor,
          eventHash,
          event.id,
        );
      });
      const { observation } = assertRequiredDenial(context, 'ECONOMIC_SOURCE_EVENT_MISMATCH');
      assertProjectionKeys(observation, [
        'economicLineageKey', 'economicSourceRevisionKey', 'eventHash', 'eventId',
      ]);
      assert.notEqual(observation.expectedProjection.eventHash, observation.observedProjection.eventHash);
    } finally {
      context.db.close();
    }
  });

  await t.test('valid replacement edge after eligibility', () => {
    const context = createPr9aContext();
    try {
      const event = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)).event;
      appendConductedSourceCorrection(context, 'after-eligibility');
      const { observation } = assertRequiredDenial(
        context,
        'SOURCE_CORRECTION_AFTER_ELIGIBILITY',
      );
      assertProjectionKeys(observation, [
        'currentSourceRevisionKey', 'economicLineageKey', 'eventId',
        'eventSourceRevisionKey', 'replacementRelationHash',
      ]);
      assert.equal(observation.expectedProjection.eventId, event.id);
      assert.equal(observation.expectedProjection.eventSourceRevisionKey, event.economicSourceRevisionKey);
      assert.notEqual(
        observation.expectedProjection.replacementRelationHash,
        observation.observedProjection.replacementRelationHash,
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('correction after a posting operation exists wins over all lower revision states', () => {
    const context = createPr9aContext();
    try {
      const event = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)).event;
      const posting = insertPostingTriplet(context, event);
      appendConductedSourceCorrection(context, 'after-posting');
      const currentConducted = context.db.prepare(`
        SELECT id FROM billing_source_upd_versions WHERE state = 'conducted'
        ORDER BY version DESC LIMIT 1
      `).get();
      mutateAppendOnlyTable(context.db, 'billing_source_upd_versions', () => {
        context.db.prepare(`
          UPDATE billing_source_upd_versions SET contentHash = ? WHERE id = ?
        `).run('1'.repeat(64), currentConducted.id);
      });
      const { conflict, observation } = assertRequiredDenial(
        context,
        'SOURCE_CORRECTION_AFTER_POSTING',
      );
      assertProjectionKeys(observation, [
        'canonicalReceivableId', 'currentSourceRevisionKey', 'economicLineageKey',
        'eventId', 'eventSourceRevisionKey', 'replacementRelationHash',
      ]);
      assert.equal(conflict.existingOperationId, posting.operation.id);
      assert.equal(conflict.existingReceivableId, posting.receivable.id);
      assert.equal(observation.expectedProjection.canonicalReceivableId, posting.receivable.id);
    } finally {
      context.db.close();
    }
  });

  await t.test('missing replacement edge cannot be misclassified as a valid correction', () => {
    const context = createPr9aContext();
    try {
      context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      appendConductedSourceCorrection(context, 'missing-edge');
      mutateAppendOnlyTable(context.db, 'billing_source_coverage_supersessions', () => {
        context.db.prepare('DELETE FROM billing_source_coverage_supersessions').run();
      });
      const { observation } = assertRequiredDenial(context, 'SOURCE_LINEAGE_ROOT_CONFLICT');
      assert.equal(observation.observedProjection.rootObservationState, 'disconnected_roots');
      assert.equal(observation.observedProjection.rootCount, 2);
    } finally {
      context.db.close();
    }
  });

  await t.test('invalid replacement target is a reconstructed broken-successor denial', () => {
    const context = createPr9aContext();
    try {
      context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      appendConductedSourceCorrection(context, 'broken-edge');
      context.db.pragma('foreign_keys = OFF');
      mutateAppendOnlyTable(context.db, 'billing_source_coverage_supersessions', () => {
        context.db.prepare(`
          UPDATE billing_source_coverage_supersessions
          SET replacementCoverageSetId = 'missing-replacement-coverage-set'
        `).run();
      });
      context.db.pragma('foreign_keys = ON');
      const { observation } = assertRequiredDenial(context, 'SOURCE_LINEAGE_BROKEN_SUCCESSOR');
      assertProjectionKeys(observation, [
        'branchId', 'brokenEdgeCount', 'brokenEdgeFingerprint', 'brokenEdgesHash',
        'brokenEdgeFromId', 'brokenEdgeToId', 'companyId',
        'economicLineageCandidateFingerprint', 'rootCoverageLineageId',
        'successorObservationState',
      ]);
      assert.equal(observation.observedProjection.successorObservationState, 'broken');
      assert.equal(observation.observedProjection.brokenEdgeCount, 1);
    } finally {
      context.db.close();
    }
  });

  await t.test('replacement without a conducted current revision is a no-current denial', () => {
    const context = createPr9aContext();
    try {
      context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      appendConductedSourceCorrection(context, 'no-current', { conduct: false });
      const { observation } = assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
      assertProjectionKeys(observation, [
        'currentRevisionCount', 'currentRevisionKey', 'currentRevisionKeysHash',
        'currentRevisionState', 'economicLineageKey', 'rootCoverageLineageId',
      ]);
      assert.equal(observation.observedProjection.currentRevisionState, 'missing');
      assert.equal(observation.observedProjection.currentRevisionCount, 0);
    } finally {
      context.db.close();
    }
  });

  await t.test('multiple conducted current revisions are never selected by sort order', () => {
    const context = createPr9aContext();
    try {
      context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      appendConductedSourceCorrection(context, 'multiple-current');
      const conducted = context.db.prepare(`
        SELECT * FROM billing_source_upd_versions WHERE state = 'conducted'
        ORDER BY version DESC LIMIT 1
      `).get();
      mutateAppendOnlyTable(context.db, 'billing_source_upd_versions', () => {
        insertCopiedRow(context.db, 'billing_source_upd_versions', {
          ...conducted,
          id: 'billing-source-upd-version-hostile-second-current',
          previousVersionId: conducted.id,
          sourceEventId: 'hostile-second-current-event',
          version: Number(conducted.version) + 1,
        });
      });
      const { observation } = assertRequiredDenial(
        context,
        'SOURCE_LINEAGE_MULTIPLE_CURRENT_REVISIONS',
      );
      assert.equal(observation.observedProjection.currentRevisionState, 'multiple');
      assert.equal(observation.observedProjection.currentRevisionCount, 2);
      assert.equal(observation.observedProjection.currentRevisionKey, null);
      assert.ok(observation.observedProjection.currentRevisionKeysHash);
    } finally {
      context.db.close();
    }
  });

  await t.test('cycle/root conflict has precedence over successor and revision classifications', () => {
    const context = createPr9aContext();
    try {
      context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      appendConductedSourceCorrection(context, 'cycle-root');
      const relation = context.db.prepare('SELECT * FROM billing_source_coverage_supersessions').get();
      mutateAppendOnlyTable(context.db, 'billing_source_coverage_supersessions', () => {
        insertCopiedRow(context.db, 'billing_source_coverage_supersessions', {
          ...relation,
          id: 'billing-source-supersession-hostile-cycle',
          originalCoverageSetId: relation.replacementCoverageSetId,
          replacementCoverageSetId: relation.originalCoverageSetId,
          sourceEventId: 'hostile-cycle-event',
        });
      });
      const { observation } = assertRequiredDenial(context, 'SOURCE_LINEAGE_ROOT_CONFLICT');
      assertProjectionKeys(observation, [
        'economicLineageCandidateFingerprint', 'rootCount', 'rootCoverageLineageIdsHash',
        'rootObservationState', 'rootSourceDocumentLineageIdsHash',
      ]);
      assert.equal(observation.observedProjection.rootObservationState, 'cycle');
    } finally {
      context.db.close();
    }
  });
});

test('Algorithm C rejects frozen non-authority claims when its independent locked reread changes type, value, policy, timezone, PR8 graph, or precedence', async t => {
  const expectIntegrityFailure = (context, arrange, mutateAfterRollback) => {
    const command = arrange();
    const restore = mutateAfterNextRollback(context.db, mutateAfterRollback);
    try {
      assert.throws(
        () => context.eligibilityService.produceEligibleEvent(command || eligibilityCommand(context)),
        error => error.code === ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED,
      );
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflicts').get().count, 0);
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflict_transitions').get().count, 0);
    } finally {
      restore();
    }
  };

  await t.test('wrong PR8 graph claim', () => {
    const context = createPr9aContext();
    try {
      const original = context.authority.candidate.dueDateEvidenceRef;
      expectIntegrityFailure(
        context,
        () => {
          mutateCandidateForConflict(context);
          return eligibilityCommand(context);
        },
        () => mutateAppendOnlyTable(context.db, 'actual_source_dry_run_candidates', () => {
          context.db.prepare(`
            UPDATE actual_source_dry_run_candidates SET dueDateEvidenceRef = ? WHERE id = ?
          `).run(original, context.authority.candidate.id);
        }),
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('wrong timezone claim', () => {
    const context = createPr9aContext();
    try {
      expectIntegrityFailure(
        context,
        () => {
          mutateAppendOnlyTable(context.db, 'canonical_companies', () => {
            context.db.prepare(`
              UPDATE canonical_companies SET receivablesTimezone = 'UTC' WHERE id = 'company-a'
            `).run();
          });
          return eligibilityCommand(context);
        },
        () => mutateAppendOnlyTable(context.db, 'canonical_companies', () => {
          context.db.prepare(`
            UPDATE canonical_companies SET receivablesTimezone = 'Europe/Moscow' WHERE id = 'company-a'
          `).run();
        }),
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('wrong source revision classification', () => {
    const context = createPr9aContext();
    try {
      context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      expectIntegrityFailure(
        context,
        () => {
          appendConductedSourceCorrection(context, 'reconstructor-source');
          return eligibilityCommand(context);
        },
        () => mutateAppendOnlyTable(context.db, 'billing_source_coverage_supersessions', () => {
          context.db.prepare('DELETE FROM billing_source_coverage_supersessions').run();
        }),
      );
      assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM actual_receivable_eligible_events').get().count, 1);
    } finally {
      context.db.close();
    }
  });

  await t.test('wrong authority precedence claim', () => {
    const context = createPr9aContext();
    try {
      const original = context.authority.candidate.dueDateEvidenceRef;
      expectIntegrityFailure(
        context,
        () => {
          mutateCandidateForConflict(context);
          return eligibilityCommand(context);
        },
        () => {
          mutateAppendOnlyTable(context.db, 'actual_source_dry_run_candidates', () => {
            context.db.prepare(`
              UPDATE actual_source_dry_run_candidates SET dueDateEvidenceRef = ? WHERE id = ?
            `).run(original, context.authority.candidate.id);
          });
          context.authority.repository.appendAuthorityRecord(nextAuthority(context.authority.source, 2));
        },
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('wrong due-date policy claim', () => {
    const context = createPr9aContext();
    try {
      let command;
      let originalDueDatePolicySet;
      expectIntegrityFailure(
        context,
        () => {
          originalDueDatePolicySet = JSON.parse(context.authority.authorization.dueDatePolicySetJson);
          const drifted = JSON.parse(context.authority.authorization.dueDatePolicySetJson);
          drifted.contractualDueDate.expectedSourceRef = 'invoice_due_date';
          const dueDatePolicySetJson = canonicalJson(drifted);
          const dueDatePolicySetHash = computeDueDatePolicySetHash(drifted);
          const authorization = appendAuthorizationVersion(context, {
            dueDatePolicySetHash,
            dueDatePolicySetJson,
          });
          const activation = appendActivationVersion(context, authorization, {
            dueDatePolicySetHash,
            dueDatePolicySetJson,
          });
          command = eligibilityCommand(context, {
            activationRecordId: activation.recordId,
            writeAuthorizationRecordId: authorization.recordId,
          });
          return command;
        },
        () => {
          const dueDatePolicySetJson = canonicalJson(originalDueDatePolicySet);
          const dueDatePolicySetHash = computeDueDatePolicySetHash(originalDueDatePolicySet);
          const authorization = appendAuthorizationVersion(context, {
            dueDatePolicySetHash,
            dueDatePolicySetJson,
          });
          appendActivationVersion(context, authorization, {
            dueDatePolicySetHash,
            dueDatePolicySetJson,
          });
        },
      );
    } finally {
      context.db.close();
    }
  });
});

test('Algorithm C rejects self-consistent malformed projection claims with valid incoming hashes', async t => {
  const domain = require('../server/lib/canonical-actual-posting-domain.js');
  const cases = [
    ['extra key', projection => ({ ...projection, unregisteredKey: 'hostile' })],
    ['missing key', projection => {
      const changed = { ...projection };
      delete changed.resultHash;
      return changed;
    }],
    ['wrong key set', projection => {
      const { dryRunId, ...changed } = projection;
      return { ...changed, dryRunIdentity: dryRunId };
    }],
    ['wrong type', projection => ({ ...projection, dryRunId: 42 })],
    ['malformed value', projection => ({ ...projection, resultHash: 'self-consistent-not-a-hash' })],
  ];
  for (const [name, mutateProjection] of cases) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        mutateCandidateForConflict(context);
        const originalBuild = domain.buildConflictContracts;
        let constructionCalls = 0;
        const repository = freshRepositoryWith(context, () => replaceFunction(
          domain,
          'buildConflictContracts',
          input => {
            constructionCalls += 1;
            if (constructionCalls <= 2 && input.conflictType === 'PR8_EVIDENCE_MISMATCH') {
              return originalBuild({
                ...input,
                observedProjection: mutateProjection(input.observedProjection),
              });
            }
            return originalBuild(input);
          },
        ));
        assert.throws(
          () => repository.produceEligibleEvent(eligibilityCommand(context)),
          error => error.code === ERROR_CODES.CONFLICT_FROZEN_DENIAL_INTEGRITY_FAILED,
        );
        assert.ok(constructionCalls >= 3, 'Algorithm C performed an independent reconstruction');
        assert.deepEqual(counts(context.db), {
          events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
        });
      } finally {
        context.db.close();
      }
    });
  }
});

test('Algorithm A exact event replay is read-only and returns byte-identical persisted fields', () => {
  const context = createPr9aContext();
  try {
    const first = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    const before = counts(context.db);
    const replay = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    assert.equal(replay.replayed, true);
    assert.equal(canonicalJson(replay.event), canonicalJson(first.event));
    assert.deepEqual(counts(context.db), before);
  } finally {
    context.db.close();
  }
});

test('Algorithm A applies source-before-producer global authority precedence and persists exact frozen denial evidence', () => {
  const context = createPr9aContext();
  try {
    const sourceDescendant = nextAuthority(context.authority.source, 2);
    const producerDescendant = nextAuthority(context.authority.producer, 2);
    context.authority.repository.appendAuthorityRecord(producerDescendant);
    context.authority.repository.appendAuthorityRecord(sourceDescendant);

    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => {
        assert.equal(error.code, 'SOURCE_ADAPTER_LATEST_CHAIN_MISMATCH');
        assert.equal(error.replayed, false);
        assert.equal(error.conflict.deniedAuthorityKind, 'source_adapter');
        assert.equal(error.conflict.deniedAuthorityRecordId, sourceDescendant.recordId);
        assert.equal(error.conflict.deniedAuthorityVersion, 2);
        assert.equal(error.conflict.deniedAuthorityRecordHash, sourceDescendant.recordHash);
        assert.equal(error.conflict.economicLineageKey, null);
        assert.equal(error.conflict.economicSourceRevisionKey, null);
        return true;
      },
    );

    assert.deepEqual(counts(context.db), {
      events: 0, conflicts: 1, transitions: 1, receivables: 0, operations: 0,
    });
    const conflict = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
    const observation = JSON.parse(conflict.conflictObservationJson);
    const projectionKeys = [
      'actorId', 'artifactIdentityHash', 'authorityId', 'authorityKind',
      'authorityRecordId', 'authorityVersion', 'bindingState', 'configurationHash',
      'denialAttemptId', 'deniedAttemptedAt', 'effectiveFrom', 'effectiveUntil',
      'latestRecordHash', 'ownershipManifestHash', 'policyHash',
      'postingAuthorityChainSnapshotHash', 'producerAuthorityChainSnapshotHash',
      'recordHash', 'scopeFingerprint', 'sourceAuthorityChainSnapshotHash',
      'stateCode', 'status', 'temporalEvaluationState', 'temporalWindowFingerprint',
    ].sort();
    assert.deepEqual(Object.keys(observation.expectedProjection).sort(), projectionKeys);
    assert.deepEqual(Object.keys(observation.observedProjection).sort(), projectionKeys);
    assert.equal(observation.expectedProjection.authorityRecordId, context.authority.source.recordId);
    assert.equal(observation.observedProjection.authorityRecordId, sourceDescendant.recordId);
    assert.equal(observation.observedProjection.stateCode, 'LATEST_CHAIN_MISMATCH');
    assert.equal(JSON.parse(conflict.sourceAuthorityChainSnapshotJson).precedenceState, 'selected');
    assert.equal(JSON.parse(conflict.producerAuthorityChainSnapshotJson).precedenceState, 'suppressed_by_higher_kind');
    assert.equal(JSON.parse(conflict.postingAuthorityChainSnapshotJson).precedenceState, 'unaffected_active_latest');
    assert.equal(
      context.db.prepare('SELECT state FROM canonical_receivable_posting_conflict_transitions').get().state,
      'COMPLETE',
    );
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.db.close();
  }
});

test('repository-owned runtime identities make artifact, configuration, and policy drift reachable for all authority kinds', async t => {
  const cases = [
    ['source_adapter', 'SOURCE_ADAPTER'],
    ['eligibility_producer', 'ELIGIBILITY_PRODUCER'],
    ['canonical_posting_adapter', 'CANONICAL_POSTING_ADAPTER'],
  ];
  const fields = [
    ['artifactDigest', 'ARTIFACT_IDENTITY_DRIFT', 'runtime-artifact-v2'],
    ['sourceCommitSha', 'ARTIFACT_IDENTITY_DRIFT', 'fedcba9876543210fedcba9876543210fedcba98'],
    ['configurationHash', 'CONFIGURATION_HASH_DRIFT', sha256Canonical({ fixture: 'runtime-config-v2' })],
    ['policyHash', 'POLICY_HASH_DRIFT', sha256Canonical({ fixture: 'runtime-policy-v2' })],
  ];
  for (const [kind, prefix] of cases) {
    for (const [field, suffix, value] of fields) {
      await t.test(`${kind} ${suffix}`, () => {
        const context = createPr9aContext();
        try {
          const runtimeContract = createCanonicalActualPostingRuntimeContract(
            runtimeContractForAuthority(context.authority, { [kind]: { [field]: value } }),
          );
          const service = createCanonicalActualEligibilityEventService({ db: context.db, runtimeContract });
          assert.throws(
            () => service.produceEligibleEvent(eligibilityCommand(context)),
            error => {
              assert.equal(error.code, `${prefix}_${suffix}`);
              assert.equal(error.conflict.deniedAuthorityKind, kind);
              return true;
            },
          );
          assert.deepEqual(counts(context.db), {
            events: 0, conflicts: 1, transitions: 1, receivables: 0, operations: 0,
          });
          const conflict = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
          const observation = JSON.parse(conflict.conflictObservationJson);
          const authority = {
            source_adapter: context.authority.source,
            eligibility_producer: context.authority.producer,
            canonical_posting_adapter: context.authority.posting,
          }[kind];
          if (field === 'configurationHash' || field === 'policyHash') {
            assert.equal(observation.expectedProjection[field], value);
            assert.equal(observation.observedProjection[field], authority[field]);
          } else {
            assert.notEqual(
              observation.expectedProjection.artifactIdentityHash,
              observation.observedProjection.artifactIdentityHash,
            );
          }
          for (const [snapshotKind, jsonField] of [
            ['source_adapter', 'sourceAuthorityChainSnapshotJson'],
            ['eligibility_producer', 'producerAuthorityChainSnapshotJson'],
            ['canonical_posting_adapter', 'postingAuthorityChainSnapshotJson'],
          ]) {
            assert.equal(
              JSON.parse(conflict[jsonField]).precedenceState,
              snapshotKind === kind ? 'selected' : 'unaffected_active_latest',
            );
          }
          const transition = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflict_transitions').get();
          assert.equal(transition.state, 'COMPLETE');
          assert.deepEqual(
            [transition.attemptApplied, transition.rateApplied, transition.circuitApplied],
            [1, 1, 1],
          );
        } finally {
          context.db.close();
        }
      });
    }
  }
});

test('runtime identity denial precedence remains source then producer then posting', () => {
  const context = createPr9aContext();
  try {
    const runtimeContract = createCanonicalActualPostingRuntimeContract(runtimeContractForAuthority(
      context.authority,
      {
        source_adapter: { policyHash: sha256Canonical({ drift: 'source' }) },
        eligibility_producer: { artifactDigest: 'producer-runtime-drift-v2' },
        canonical_posting_adapter: { configurationHash: sha256Canonical({ drift: 'posting' }) },
      },
    ));
    const service = createCanonicalActualEligibilityEventService({ db: context.db, runtimeContract });
    assert.throws(
      () => service.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === 'SOURCE_ADAPTER_POLICY_HASH_DRIFT',
    );
    const conflict = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
    assert.equal(JSON.parse(conflict.sourceAuthorityChainSnapshotJson).precedenceState, 'selected');
    assert.equal(JSON.parse(conflict.producerAuthorityChainSnapshotJson).precedenceState, 'suppressed_by_higher_kind');
    assert.equal(JSON.parse(conflict.postingAuthorityChainSnapshotJson).precedenceState, 'suppressed_by_higher_kind');
  } finally {
    context.db.close();
  }
});

test('later expired authority descendant is unrepresentable and performs zero conflict or event DML', () => {
  const context = createPr9aContext();
  try {
    const expiredDescendant = nextAuthority(context.authority.source, 2, {
      status: 'expired',
      revocationReasonCode: 'expired-descendant-fixture',
    });
    context.authority.repository.appendAuthorityRecord(expiredDescendant);
    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === 'AUTHORITY_LATEST_EXPIRED_DESCENDANT_UNREPRESENTABLE_V1',
    );
    assert.deepEqual(counts(context.db), {
      events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
    });
  } finally {
    context.db.close();
  }
});

test('command validation and repository UUID/clock failures perform zero DML with stable literals', () => {
  const invalid = createPr9aContext();
  try {
    assert.throws(
      () => invalid.eligibilityService.produceEligibleEvent({ ...eligibilityCommand(invalid), callerId: 'forbidden' }),
      error => error.code === ERROR_CODES.ENVELOPE_INVALID,
    );
    assert.deepEqual(counts(invalid.db), { events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0 });
  } finally {
    invalid.db.close();
  }

  const badUuid = createPr9aContext();
  try {
    const repository = freshRepositoryWith(badUuid, () => replaceFunction(crypto, 'randomUUID', () => 'not-a-uuid'));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(badUuid)),
      error => error.code === ERROR_CODES.DENIAL_ATTEMPT_ID_GENERATION_FAILED,
    );
    assert.deepEqual(counts(badUuid.db), { events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0 });
  } finally {
    badUuid.db.close();
  }

  const thrownUuid = createPr9aContext();
  try {
    const repository = freshRepositoryWith(thrownUuid, () => replaceFunction(crypto, 'randomUUID', () => {
      throw new Error('entropy unavailable');
    }));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(thrownUuid)),
      error => error.code === ERROR_CODES.DENIAL_ATTEMPT_ID_GENERATION_FAILED,
    );
    assert.deepEqual(counts(thrownUuid.db), { events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0 });
  } finally {
    thrownUuid.db.close();
  }

  const badClock = createPr9aContext();
  try {
    const repository = freshRepositoryWith(badClock, () => replaceFunction(Date, 'now', () => { throw new Error('clock failed'); }));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(badClock)),
      error => error.code === 'CANONICAL_REPOSITORY_CLOCK_FAILED',
    );
    assert.deepEqual(counts(badClock.db), { events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0 });
  } finally {
    badClock.db.close();
  }
});

test('one entropy call is reserved for denialAttemptId and every other repository identity is deterministic and domain-separated', () => {
  const fixedUuid = '11111111-1111-4111-8111-111111111111';
  const success = createPr9aContext();
  try {
    const calls = [];
    const repository = freshRepositoryWith(success, () => replaceFunction(crypto, 'randomUUID', options => {
      calls.push(options);
      return fixedUuid;
    }));
    const result = repository.produceEligibleEvent(eligibilityCommand(success));
    assert.deepEqual(calls, [{ disableEntropyCache: true }]);
    const candidate = success.authority.candidate;
    const identityInput = {
      branchId: candidate.branchId,
      companyId: candidate.companyId,
      denialAttemptId: fixedUuid,
      economicLineageCandidateFingerprint: computeEconomicLineageCandidateFingerprint({
        branchId: candidate.branchId,
        companyId: candidate.companyId,
        contractId: candidate.contractId ?? null,
        coverageEndExclusive: candidate.sliceEndDateExclusive,
        coverageStart: candidate.sliceStartDate,
        currency: candidate.currency,
        rentalId: candidate.rentalId,
        rentalLineId: candidate.rentalLineId,
      }),
      economicSourceRevisionKey: result.event.economicSourceRevisionKey,
      sourceLineageHash: result.event.sourceLineageHash,
    };
    const expectedEventId = deriveRepositoryIdentity(
      'rentcore.canonical_actual_posting.eligibility_event_identity',
      identityInput,
    );
    const expectedCorrelationId = deriveRepositoryIdentity(
      'rentcore.canonical_actual_posting.eligibility_correlation_identity',
      identityInput,
    );
    assert.equal(result.event.id, expectedEventId);
    assert.equal(result.event.correlationId, expectedCorrelationId);
    assert.notEqual(expectedEventId, expectedCorrelationId);
    assert.equal(
      deriveRepositoryIdentity('rentcore.canonical_actual_posting.eligibility_event_identity', identityInput),
      expectedEventId,
    );
    const replay = repository.produceEligibleEvent(eligibilityCommand(success));
    assert.equal(replay.replayed, true);
    assert.equal(calls.length, 1, 'exact event replay performs zero additional UUID calls');
  } finally {
    success.db.close();
  }

  const denial = createPr9aContext();
  try {
    mutateCandidateForConflict(denial);
    let callCount = 0;
    const repository = freshRepositoryWith(denial, () => replaceFunction(crypto, 'randomUUID', options => {
      assert.deepEqual(options, { disableEntropyCache: true });
      callCount += 1;
      return fixedUuid;
    }));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(denial)),
      error => error.code === 'PR8_EVIDENCE_MISMATCH',
    );
    assert.equal(callCount, 1);
    const conflict = denial.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
    const expectedConflictId = deriveRepositoryIdentity(
      'rentcore.canonical_actual_posting.conflict_row_identity',
      {
        branchId: conflict.branchId,
        companyId: conflict.companyId,
        conflictHash: conflict.conflictHash,
        denialAttemptId: fixedUuid,
      },
    );
    assert.equal(conflict.id, expectedConflictId);
    assert.equal(conflict.correlationId, deriveRepositoryIdentity(
      'rentcore.canonical_actual_posting.conflict_correlation_identity',
      {
        branchId: conflict.branchId,
        companyId: conflict.companyId,
        conflictHash: conflict.conflictHash,
        denialAttemptId: fixedUuid,
      },
    ));
    assert.notEqual(conflict.id, conflict.correlationId);
  } finally {
    denial.db.close();
  }
});

test('transition recovery performs zero UUID calls', () => {
  const context = createPr9aContext();
  try {
    context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    mutateCandidateForConflict(context);
    context.db.exec(`
      CREATE TRIGGER pr9_test_uuid_recovery_abort
      BEFORE UPDATE ON canonical_receivable_posting_conflict_transitions
      BEGIN SELECT RAISE(ABORT, 'test uuid recovery'); END;
    `);
    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED,
    );
    context.db.exec('DROP TRIGGER pr9_test_uuid_recovery_abort');
    const transition = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflict_transitions').get();
    let callCount = 0;
    const repository = freshRepositoryWith(context, () => replaceFunction(crypto, 'randomUUID', () => {
      callCount += 1;
      return '22222222-2222-4222-8222-222222222222';
    }));
    assert.equal(repository.reconcileTransition(transition.transitionId).transition.state, 'COMPLETE');
    assert.equal(callCount, 0);
  } finally {
    context.db.close();
  }
});

test('event insert failure rolls back the complete Algorithm A transaction', () => {
  const context = createPr9aContext();
  try {
    context.db.exec(`
      CREATE TRIGGER pr9_test_abort_event_insert
      BEFORE INSERT ON actual_receivable_eligible_events
      BEGIN SELECT RAISE(ABORT, 'test forced rollback'); END;
    `);
    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === 'CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED',
    );
    assert.deepEqual(counts(context.db), { events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0 });
  } finally {
    context.db.close();
  }
});

test('required denial commits a reciprocal pair, synchronously reaches COMPLETE, and returns only afterward', () => {
  const context = createPr9aContext();
  try {
    const error = produceConflict(context);
    assert.equal(error.code, 'PR8_EVIDENCE_MISMATCH');
    assert.equal(error.replayed, false);
    assert.ok(error.conflict);
    const observation = JSON.parse(error.conflict.conflictObservationJson);
    for (const key of [
      'denialAttemptId', 'deniedAttemptedAt', 'postingAdapterAuthorityBranchId',
      'postingAdapterAuthorityCompanyId', 'postingAdapterAuthorityKind',
      'postingAdapterAuthorityRecordHash', 'postingAdapterAuthorityRecordId',
      'postingAdapterAuthorityVersion', 'postingAuthorityChainSnapshotHash',
      'producerAuthorityBranchId', 'producerAuthorityCompanyId', 'producerAuthorityKind',
      'producerAuthorityRecordHash', 'producerAuthorityRecordId', 'producerAuthorityVersion',
      'producerAuthorityChainSnapshotHash', 'sourceAuthorityChainSnapshotHash',
    ]) {
      assert.ok(Object.hasOwn(observation.expectedProjection, key), key);
      assert.equal(observation.expectedProjection[key], observation.observedProjection[key], key);
    }
    const transition = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflict_transitions').get();
    assert.deepEqual(
      { state: transition.state, attemptApplied: transition.attemptApplied, rateApplied: transition.rateApplied, circuitApplied: transition.circuitApplied },
      { state: 'COMPLETE', attemptApplied: 1, rateApplied: 1, circuitApplied: 1 },
    );
    const pair = context.eligibilityRepository.readConflictPair(transition.transitionId);
    assert.equal(pair.conflict.id, transition.conflictId);
    assert.equal(pair.conflict.transitionId, transition.transitionId);
    assert.deepEqual(context.db.pragma('foreign_key_check'), []);
  } finally {
    context.db.close();
  }
});

test('pair-commit crash simulation blocks admission until idempotent synchronous recovery completes', () => {
  const context = createPr9aContext();
  try {
    context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    mutateCandidateForConflict(context);
    context.db.exec(`
      CREATE TRIGGER pr9_test_abort_transition_stage
      BEFORE UPDATE ON canonical_receivable_posting_conflict_transitions
      BEGIN SELECT RAISE(ABORT, 'test stage crash'); END;
    `);
    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED,
    );
    const pending = context.db.prepare('SELECT * FROM canonical_receivable_posting_conflict_transitions').get();
    assert.equal(pending.state, 'PENDING');
    assert.equal(pending.attemptApplied, 0);
    const beforeBlocked = counts(context.db);
    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED,
    );
    assert.deepEqual(counts(context.db), beforeBlocked);
    context.db.exec('DROP TRIGGER pr9_test_abort_transition_stage');
    const complete = context.eligibilityRepository.reconcileTransition(pending.transitionId);
    assert.equal(complete.transition.state, 'COMPLETE');
    const beforeReplay = canonicalJson(context.db.prepare(
      'SELECT * FROM canonical_receivable_posting_conflict_transitions WHERE transitionId = ?',
    ).get(pending.transitionId));
    const repeated = context.eligibilityRepository.reconcileTransition(pending.transitionId);
    assert.equal(repeated.transition.state, 'COMPLETE');
    const afterReplay = canonicalJson(context.db.prepare(
      'SELECT * FROM canonical_receivable_posting_conflict_transitions WHERE transitionId = ?',
    ).get(pending.transitionId));
    assert.equal(afterReplay, beforeReplay);
  } finally {
    context.db.close();
  }
});

test('self-consistent denial UUID collision and corrupted persisted pair are distinct fail-closed results', () => {
  const collision = createPr9aContext();
  try {
    produceConflict(collision);
    const conflict = collision.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
    const repository = freshRepositoryWith(collision, () => replaceFunction(crypto, 'randomUUID', () => conflict.denialAttemptId));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(collision)),
      error => error.code === ERROR_CODES.DENIAL_ATTEMPT_ID_COLLISION,
    );
    assert.equal(counts(collision.db).conflicts, 1);
  } finally {
    collision.db.close();
  }

  const corrupted = createPr9aContext();
  try {
    produceConflict(corrupted);
    const conflict = corrupted.db.prepare('SELECT * FROM canonical_receivable_posting_conflicts').get();
    const trigger = corrupted.db.prepare(`
      SELECT name, sql FROM sqlite_master
      WHERE type = 'trigger' AND tbl_name = 'canonical_receivable_posting_conflicts'
        AND name LIKE '%no_update'
    `).get();
    corrupted.db.exec(`DROP TRIGGER ${trigger.name}`);
    corrupted.db.prepare('UPDATE canonical_receivable_posting_conflicts SET eventHash = ? WHERE id = ?')
      .run('0'.repeat(64), conflict.id);
    corrupted.db.exec(trigger.sql);
    const repository = freshRepositoryWith(corrupted, () => replaceFunction(crypto, 'randomUUID', () => conflict.denialAttemptId));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(corrupted)),
      error => error.code === ERROR_CODES.CONFLICT_REPLAY_INTEGRITY_FAILED,
    );
    assert.equal(counts(corrupted.db).conflicts, 1);
  } finally {
    corrupted.db.close();
  }
});

test('31 direct denial candidates commit at most 30 pairs and the 31st is blocked before pair DML', () => {
  const context = createPr9aContext();
  try {
    context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
    mutateCandidateForConflict(context);
    for (let attempt = 1; attempt <= 30; attempt += 1) {
      assert.throws(
        () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
        error => error.code === 'PR8_EVIDENCE_MISMATCH',
      );
    }
    assert.equal(counts(context.db).conflicts, 30);
    assert.throws(
      () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === ERROR_CODES.CONFLICT_EVIDENCE_PERSISTENCE_FAILED,
    );
    assert.equal(counts(context.db).conflicts, 30);
    assert.equal(context.db.prepare("SELECT COUNT(*) AS count FROM canonical_receivable_posting_conflict_transitions WHERE state = 'COMPLETE'").get().count, 30);
  } finally {
    context.db.close();
  }
});

test('concurrent Algorithm A execution serializes to one event and one exact replay', async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'pr9a-concurrency-'));
  const dbPath = path.join(directory, 'fixture.sqlite');
  const context = createPr9aContext({ dbPath });
  const command = eligibilityCommand(context);
  context.db.close();
  try {
    const results = await Promise.all([
      runWorker(dbPath, command, context.runtimeContractInput),
      runWorker(dbPath, command, context.runtimeContractInput),
    ]);
    assert.ok(results.every(result => result.ok), JSON.stringify(results));
    assert.deepEqual(results.map(result => result.id), [results[0].id, results[0].id]);
    assert.deepEqual(results.map(result => result.replayed).sort(), [false, true]);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
