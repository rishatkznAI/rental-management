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
import {
  closePlan,
  conductPlan,
  formPlan,
} from './billing-source-authority-fixtures.js';

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

function rewriteRowById(db, table, row) {
  const columns = Object.keys(row);
  mutateAppendOnlyTable(db, table, () => {
    db.prepare(`
      UPDATE ${table}
      SET ${columns.map(column => `"${column}" = ?`).join(', ')}
      WHERE id = ?
    `).run(...columns.map(column => row[column]), row.id);
  });
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

function resealAcceptedPolicyManifestSet(context, policyManifestHashes) {
  const policyManifestHashesJson = oracleCanonicalJson([...policyManifestHashes].sort());
  const activation = context.db.prepare(`
    SELECT * FROM canonical_posting_activation_records WHERE recordId = ?
  `).get(context.authority.activation.recordId);
  activation.policyManifestHashesJson = policyManifestHashesJson;
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
  authorization.policyManifestHashesJson = policyManifestHashesJson;
  authorization.cohortHash = activation.cohortHash;
  authorization.recordHash = oracleRecordHash(
    authorization,
    ORACLE_WRITE_AUTHORIZATION_FIELDS,
    'rentcore.canonical_actual_posting.write_authorization',
  );
  rewriteWholeRow(context.db, 'canonical_write_authorization_records', authorization);
  return { activation, authorization };
}

function reopenAcceptedBillingPeriod(context, suffix = 'p1-red') {
  const candidate = context.authority.candidate;
  const closed = context.db.prepare(`
    SELECT * FROM billing_source_period_versions
    WHERE id = ? AND companyId = ? AND branchId = ?
  `).get(candidate.closedPeriodVersionId, candidate.companyId, candidate.branchId);
  const result = context.service.reopenBillingPeriod(context.commandContext, {
    operationType: 'reopen_billing_period',
    idempotencyKey: `reopen-${suffix}`,
    periodId: candidate.periodId,
    expectedPeriodVersion: Number(closed.version),
    reasonCode: 'SOURCE_CORRECTION',
    reasonText: 'Independent PR9a period-current remediation proof',
    sourceEventId: `reopen-${suffix}-event`,
    sourceEventVersion: 1,
    sourceHash: oracleHash({ mutation: 'billing-period-reopen', suffix }),
  });
  const operation = context.db.prepare('SELECT * FROM billing_source_operations WHERE id = ?')
    .get(result.operationId);
  const audit = context.db.prepare('SELECT * FROM billing_source_audit_events WHERE operationId = ?')
    .get(result.operationId);
  const reopened = context.db.prepare(`
    SELECT * FROM billing_source_period_versions
    WHERE periodId = ? ORDER BY version DESC, id DESC LIMIT 1
  `).get(candidate.periodId);
  assert.equal(reopened.eventType, 'reopened');
  assert.equal(reopened.previousVersionId, closed.id);
  assert.equal(reopened.reopensClosedVersionId, closed.id);
  assert.equal(result.fingerprint, operation.resultFingerprint);
  assert.equal(result.fingerprint, audit.afterFingerprint);
  return { audit, closed, operation, reopened, result };
}

function appendRawPeriodVersion(context, overrides = {}) {
  const candidate = context.authority.candidate;
  const base = context.db.prepare(`
    SELECT * FROM billing_source_period_versions
    WHERE id = ?
  `).get(overrides.baseId || candidate.closedPeriodVersionId);
  const closedEvidence = context.db.prepare(`
    SELECT * FROM billing_source_period_versions WHERE id = ?
  `).get(candidate.closedPeriodVersionId);
  const eventType = overrides.eventType || 'reopened';
  const row = {
    ...base,
    id: overrides.id || `hostile-period-version-${overrides.suffix || 'next'}`,
    periodId: overrides.periodId || candidate.periodId,
    version: overrides.version ?? Number(base.version) + 1,
    eventType,
    previousVersionId: overrides.previousVersionId === undefined
      ? base.id
      : overrides.previousVersionId,
    reopensClosedVersionId: eventType === 'reopened'
      ? (overrides.reopensClosedVersionId || base.id)
      : null,
    effectiveTermsVersionId: eventType === 'closed' ? closedEvidence.effectiveTermsVersionId : null,
    snapshotId: eventType === 'closed' ? closedEvidence.snapshotId : null,
    capabilityKey: eventType === 'closed' ? 'billing.period.close' : 'billing.period.reopen',
    reasonCode: eventType === 'closed' ? null : 'HOSTILE_REOPEN',
    reasonText: eventType === 'closed' ? null : 'Independent hostile period graph mutation',
    sourceEventId: `hostile-period-event-${overrides.suffix || 'next'}`,
    sourceHash: oracleHash({
      eventType,
      periodId: overrides.periodId || candidate.periodId,
      suffix: overrides.suffix || 'next',
      version: overrides.version ?? Number(base.version) + 1,
    }),
    createdAt: overrides.createdAt || '2026-07-27T12:05:00.000Z',
  };
  insertCopiedRow(context.db, 'billing_source_period_versions', row);
  return row;
}

function snapshotEvidencePlan(context, snapshotId) {
  return context.db.prepare(`
    SELECT evidenceType, sourceSystem, sourceId, sourceVersion, sourceEventId,
           sourceEventVersion, coveredStartDate, coveredEndDateExclusive,
           authorityStatus, authorityPolicyRef, evidenceHash
    FROM billing_source_snapshot_evidence
    WHERE snapshotId = ?
    ORDER BY evidenceType, sourceSystem, sourceId, sourceVersion, sourceEventId,
             sourceEventVersion, coveredStartDate, coveredEndDateExclusive
  `).all(snapshotId);
}

function appendWriterSealedIllegalClose(context, suffix, baseId = null) {
  const candidate = context.authority.candidate;
  const base = context.db.prepare(`
    SELECT * FROM billing_source_period_versions
    WHERE id = ?
  `).get(baseId || candidate.closedPeriodVersionId);
  const original = { ...base };
  const temporaryReopen = {
    ...base,
    eventType: 'reopened',
    reopensClosedVersionId: base.previousVersionId || base.id,
    effectiveTermsVersionId: null,
    snapshotId: null,
    capabilityKey: 'billing.period.reopen',
    reasonCode: 'HOSTILE_TEMPORARY_REOPEN',
    reasonText: 'Temporary state used to synthesize sealed hostile persistence',
  };
  rewriteRowById(context.db, 'billing_source_period_versions', temporaryReopen);
  let result;
  try {
    const period = context.db.prepare('SELECT * FROM billing_source_periods WHERE id = ?')
      .get(candidate.periodId);
    const terms = context.db.prepare(`
      SELECT * FROM billing_source_effective_terms
      WHERE rentalLineId = ? ORDER BY version DESC, id DESC LIMIT 1
    `).get(period.rentalLineId);
    result = context.service.closeBillingPeriod(context.commandContext, closePlan({
      idempotencyKey: `hostile-sealed-close-${suffix}`,
      periodId: period.id,
      rentalLineId: period.rentalLineId,
      effectiveTermsId: terms.id,
      evidence: snapshotEvidencePlan(context, original.snapshotId),
      expectedPeriodVersion: Number(base.version),
      sourceEventId: `hostile-sealed-close-${suffix}-event`,
      sourceEventVersion: 1,
      sourceHash: oracleHash({ hostileSealedClose: suffix }),
      snapshotSourceHash: oracleHash({ hostileSealedCloseSnapshot: suffix }),
    }));
  } finally {
    rewriteRowById(context.db, 'billing_source_period_versions', original);
  }
  const closed = context.db.prepare(`
    SELECT * FROM billing_source_period_versions
    WHERE periodId = ? AND version = ?
  `).get(candidate.periodId, Number(base.version) + 1);
  const operation = context.db.prepare('SELECT * FROM billing_source_operations WHERE id = ?')
    .get(closed.operationId);
  const audit = context.db.prepare('SELECT * FROM billing_source_audit_events WHERE operationId = ?')
    .get(closed.operationId);
  assert.equal(closed.eventType, 'closed');
  assert.equal(closed.previousVersionId, base.id);
  assert.equal(closed.reopensClosedVersionId, null);
  assert.equal(result.fingerprint, operation.resultFingerprint);
  assert.equal(result.fingerprint, audit.afterFingerprint);
  return { audit, closed, operation, result };
}

function recloseAcceptedBillingPeriod(context, suffix) {
  const { reopened } = reopenAcceptedBillingPeriod(context, `valid-${suffix}`);
  const candidate = context.authority.candidate;
  const period = context.db.prepare('SELECT * FROM billing_source_periods WHERE id = ?')
    .get(candidate.periodId);
  const terms = context.db.prepare(`
    SELECT * FROM billing_source_effective_terms
    WHERE rentalLineId = ? ORDER BY version DESC, id DESC LIMIT 1
  `).get(period.rentalLineId);
  const result = context.service.closeBillingPeriod(context.commandContext, closePlan({
    idempotencyKey: `valid-reclose-${suffix}`,
    periodId: period.id,
    rentalLineId: period.rentalLineId,
    effectiveTermsId: terms.id,
    evidence: snapshotEvidencePlan(context, context.authority.candidate.snapshotId),
    expectedPeriodVersion: Number(reopened.version),
    sourceEventId: `valid-reclose-${suffix}-event`,
    sourceEventVersion: 1,
    sourceHash: oracleHash({ validReclose: suffix }),
    snapshotSourceHash: oracleHash({ validRecloseSnapshot: suffix }),
  }));
  const closed = context.db.prepare(`
    SELECT * FROM billing_source_period_versions
    WHERE periodId = ? ORDER BY version DESC, id DESC LIMIT 1
  `).get(candidate.periodId);
  assert.equal(closed.eventType, 'closed');
  assert.equal(closed.previousVersionId, reopened.id);
  assert.equal(closed.reopensClosedVersionId, null);
  return { closed, reopened, result };
}

function replaceCoverageForClosedVersion(context, closedVersion, suffix) {
  const slice = context.db.prepare(`
    SELECT * FROM billing_source_coverage_slices
    WHERE id = ?
  `).get(context.authority.candidate.coverageSliceId);
  const changedSlice = {
    ...slice,
    closedPeriodVersionId: closedVersion.id,
    snapshotId: closedVersion.snapshotId,
  };
  changedSlice.sliceHash = oracleHash({
    schemaVersion: 1,
    coverageSetId: changedSlice.coverageSetId,
    updLineId: changedSlice.updLineId,
    updLineVersionId: changedSlice.updLineVersionId,
    periodId: changedSlice.periodId,
    closedPeriodVersionId: changedSlice.closedPeriodVersionId,
    snapshotId: changedSlice.snapshotId,
    sliceStartDate: changedSlice.sliceStartDate,
    sliceEndDateExclusive: changedSlice.sliceEndDateExclusive,
    allocatedNetMinor: Number(changedSlice.allocatedNetMinor),
    allocatedVatMinor: Number(changedSlice.allocatedVatMinor),
    allocatedGrossMinor: Number(changedSlice.allocatedGrossMinor),
    contractualDueDate: changedSlice.contractualDueDate,
    dueDateProvenance: changedSlice.dueDateProvenance,
    dueDateEvidenceRef: changedSlice.dueDateEvidenceRef,
  });
  rewriteRowById(context.db, 'billing_source_coverage_slices', changedSlice);

  const coverage = context.db.prepare('SELECT * FROM billing_source_coverage_sets WHERE id = ?')
    .get(changedSlice.coverageSetId);
  const changedCoverage = {
    ...coverage,
    mappingHash: oracleHash({
      schemaVersion: 1,
      mappingAlgorithmVersion: Number(coverage.mappingAlgorithmVersion),
      updId: coverage.updId,
      formedUpdVersionId: coverage.formedUpdVersionId,
      status: coverage.status,
      predecessorMappingHashes: [],
      lifecycleAction: null,
      slices: [{
        updLineId: changedSlice.updLineId,
        updLineVersionId: changedSlice.updLineVersionId,
        periodId: changedSlice.periodId,
        closedPeriodVersionId: changedSlice.closedPeriodVersionId,
        snapshotId: changedSlice.snapshotId,
        start: changedSlice.sliceStartDate,
        endExclusive: changedSlice.sliceEndDateExclusive,
        netMinor: Number(changedSlice.allocatedNetMinor),
        vatMinor: Number(changedSlice.allocatedVatMinor),
        grossMinor: Number(changedSlice.allocatedGrossMinor),
        dueDate: changedSlice.contractualDueDate,
        dueDateProvenance: changedSlice.dueDateProvenance,
        dueDateEvidenceRef: changedSlice.dueDateEvidenceRef,
      }],
    }),
  };
  rewriteRowById(context.db, 'billing_source_coverage_sets', changedCoverage);

  const operation = context.db.prepare('SELECT * FROM billing_source_operations WHERE id = ?')
    .get(changedCoverage.operationId);
  rewriteRowById(context.db, 'billing_source_operations', {
    ...operation,
    resultFingerprint: changedCoverage.mappingHash,
  });
  const audit = context.db.prepare('SELECT * FROM billing_source_audit_events WHERE operationId = ?')
    .get(changedCoverage.operationId);
  rewriteRowById(context.db, 'billing_source_audit_events', {
    ...audit,
    afterFingerprint: changedCoverage.mappingHash,
  });
  return { coverage: changedCoverage, slice: changedSlice, suffix };
}

function acceptRunForCurrentClosedVersion(context, closedVersion, suffix) {
  replaceCoverageForClosedVersion(context, closedVersion, suffix);
  const accepted = acceptAdditionalPolicyRun(
    context,
    approvedTestPolicyManifest(),
    `lifecycle-${suffix}`,
    { closedPeriodVersionId: closedVersion.id },
  );
  assert.equal(accepted.selectedCandidate.closedPeriodVersionId, closedVersion.id);
  return accepted;
}

function createValidCurrentV3(context, suffix) {
  const lifecycle = recloseAcceptedBillingPeriod(context, suffix);
  const accepted = acceptRunForCurrentClosedVersion(context, lifecycle.closed, suffix);
  return { ...lifecycle, ...accepted };
}

function appendForeignPeriodLifecycle(context, suffix = 'foreign') {
  const candidate = context.authority.candidate;
  const period = context.db.prepare('SELECT * FROM billing_source_periods WHERE id = ?')
    .get(candidate.periodId);
  const foreignPeriod = {
    ...period,
    id: `hostile-${suffix}-period`,
    periodStartDate: '2026-09-01',
    periodEndDateExclusive: '2026-10-01',
    identityHash: oracleHash({ foreignPeriod: suffix }),
  };
  insertCopiedRow(context.db, 'billing_source_periods', foreignPeriod);
  const closed = appendRawPeriodVersion(context, {
    id: `hostile-${suffix}-period-closed`,
    periodId: foreignPeriod.id,
    previousVersionId: null,
    suffix: `${suffix}-closed`,
    version: 1,
    eventType: 'closed',
  });
  const reopened = appendRawPeriodVersion(context, {
    baseId: closed.id,
    id: `hostile-${suffix}-period-reopened`,
    periodId: foreignPeriod.id,
    suffix: `${suffix}-reopened`,
    version: 2,
  });
  return { closed, foreignPeriod, reopened };
}

function installAfterEventInsertMutation(db, mutation) {
  const originalPrepare = db.prepare;
  let armed = true;
  Object.defineProperty(db, 'prepare', {
    configurable: true,
    value(sql) {
      const statement = originalPrepare.call(db, sql);
      if (
        armed
        && /^\s*INSERT INTO actual_receivable_eligible_events\b/.test(String(sql))
      ) {
        return {
          run(...args) {
            const result = statement.run(...args);
            armed = false;
            mutation();
            return result;
          },
        };
      }
      return statement;
    },
  });
  return () => { delete db.prepare; };
}

function insertForeignTermsIdentity(context, suffix, overrides = {}) {
  const candidate = context.authority.candidate;
  const rentalLine = context.db.prepare(`
    SELECT * FROM billing_source_rental_lines WHERE id = ?
  `).get(candidate.rentalLineId);
  const snapshot = context.db.prepare(`
    SELECT * FROM billing_source_snapshots WHERE id = ?
  `).get(candidate.snapshotId);
  const close = context.db.prepare(`
    SELECT * FROM billing_source_period_versions WHERE id = ?
  `).get(candidate.closedPeriodVersionId);
  const originalTerms = context.db.prepare(`
    SELECT * FROM billing_source_effective_terms WHERE id = ?
  `).get(snapshot.effectiveTermsVersionId);
  const foreignRentalLine = {
    ...rentalLine,
    id: `foreign-terms-rental-line-${suffix}`,
    rentalId: overrides.rentalId || `foreign-terms-rental-${suffix}`,
    clientId: overrides.clientId || `foreign-terms-client-${suffix}`,
    contractId: overrides.contractId === undefined
      ? `foreign-terms-contract-${suffix}`
      : overrides.contractId,
    sourceRentalRef: `foreign-terms-rental-source-${suffix}`,
    sourceLineRef: `foreign-terms-line-source-${suffix}`,
    sourceEventId: `foreign-terms-line-event-${suffix}`,
    provenanceHash: overrides.provenanceHash || originalTerms.sourceHash,
  };
  insertCopiedRow(context.db, 'billing_source_rental_lines', foreignRentalLine);
  const foreignTerms = {
    ...originalTerms,
    id: `foreign-terms-version-${suffix}`,
    rentalLineId: foreignRentalLine.id,
    effectiveFromDate: overrides.effectiveFromDate || originalTerms.effectiveFromDate,
    effectiveToDateExclusive:
      overrides.effectiveToDateExclusive || originalTerms.effectiveToDateExclusive,
    contractualBillingCycleCode:
      overrides.contractualBillingCycleCode || originalTerms.contractualBillingCycleCode,
    contractualBillingCycleVersion:
      overrides.contractualBillingCycleVersion || originalTerms.contractualBillingCycleVersion,
    sourceRef: overrides.sourceRef || originalTerms.sourceRef,
    sourceHash: overrides.sourceHash || originalTerms.sourceHash,
  };
  insertCopiedRow(context.db, 'billing_source_effective_terms', foreignTerms);
  if (overrides.bindSnapshot !== false) {
    rewriteRowById(context.db, 'billing_source_snapshots', {
      ...snapshot,
      effectiveTermsVersionId: foreignTerms.id,
    });
  }
  if (overrides.bindClose !== false) {
    rewriteRowById(context.db, 'billing_source_period_versions', {
      ...close,
      effectiveTermsVersionId: foreignTerms.id,
    });
  }
  return {
    close,
    foreignRentalLine,
    foreignTerms,
    originalTerms,
    snapshot,
  };
}

function appendTermsSuccessor(context, suffix, baseTermsId = null) {
  const candidate = context.authority.candidate;
  const snapshot = context.db.prepare(`
    SELECT * FROM billing_source_snapshots WHERE id = ?
  `).get(candidate.snapshotId);
  const base = context.db.prepare(`
    SELECT * FROM billing_source_effective_terms WHERE id = ?
  `).get(baseTermsId || snapshot.effectiveTermsVersionId);
  const successor = {
    ...base,
    id: `hostile-terms-successor-${suffix}`,
    version: Number(base.version) + 1,
    supersedesTermsVersionId: base.id,
    sourceRef: `hostile-terms-successor-source-${suffix}`,
    sourceVersion: Number(base.sourceVersion) + 1,
    sourceHash: oracleHash({ hostileTermsSuccessor: suffix }),
  };
  insertCopiedRow(context.db, 'billing_source_effective_terms', successor);
  return successor;
}

function seedSecondPr8CandidateSource(context, suffix) {
  const existingSnapshotId = context.authority.candidate.snapshotId;
  context.service.closeBillingPeriod(context.commandContext, closePlan({
    clientId: `second-candidate-client-${suffix}`,
    contractId: `second-candidate-contract-${suffix}`,
    equipmentId: `second-candidate-equipment-${suffix}`,
    evidence: snapshotEvidencePlan(context, existingSnapshotId),
    idempotencyKey: `second-candidate-close-${suffix}`,
    provenanceHash: oracleHash({ secondCandidateRentalLine: suffix }),
    rentalId: `second-candidate-rental-${suffix}`,
    sourceEventId: `second-candidate-close-event-${suffix}`,
    sourceHash: oracleHash({ secondCandidateClose: suffix }),
    sourceLineRef: `second-candidate-rental-line-ref-${suffix}`,
    sourceRentalRef: `second-candidate-rental-ref-${suffix}`,
    snapshotSourceHash: oracleHash({ secondCandidateSnapshot: suffix }),
    termsSourceRef: `second-candidate-terms-ref-${suffix}`,
    termsSourceHash: oracleHash({ secondCandidateTerms: suffix }),
  }));
  const rentalLine = context.db.prepare(`
    SELECT * FROM billing_source_rental_lines WHERE rentalId = ?
  `).get(`second-candidate-rental-${suffix}`);
  const period = context.db.prepare(`
    SELECT * FROM billing_source_periods WHERE rentalLineId = ?
  `).get(rentalLine.id);
  const close = context.db.prepare(`
    SELECT * FROM billing_source_period_versions
    WHERE periodId = ? AND eventType = 'closed'
  `).get(period.id);
  const snapshot = context.db.prepare(`
    SELECT * FROM billing_source_snapshots WHERE id = ?
  `).get(close.snapshotId);
  const sourceLineRef = `second-candidate-upd-line-${suffix}`;
  context.service.formUpd(context.commandContext, formPlan(context, {
    clientId: rentalLine.clientId,
    contractId: rentalLine.contractId,
    documentNumber: `SECOND-${suffix}`,
    idempotencyKey: `second-candidate-form-${suffix}`,
    sourceDocumentRef: `second-candidate-upd-${suffix}`,
    sourceLineRef,
    slices: [{
      sourceLineRef,
      periodId: period.id,
      closedPeriodVersionId: close.id,
      snapshotId: snapshot.id,
      sliceStartDate: period.periodStartDate,
      sliceEndDateExclusive: period.periodEndDateExclusive,
      allocatedNetMinor: Number(snapshot.netMinor),
      allocatedVatMinor: Number(snapshot.vatMinor),
      allocatedGrossMinor: Number(snapshot.grossMinor),
      contractualDueDate: '2026-09-10',
      dueDateProvenance: 'contractual_payment_due_date',
      dueDateEvidenceRef: `second-candidate-due-date-${suffix}`,
    }],
  }));
  const upd = context.db.prepare(`
    SELECT * FROM billing_source_upds WHERE sourceDocumentRef = ?
  `).get(`second-candidate-upd-${suffix}`);
  const formed = context.db.prepare(`
    SELECT * FROM billing_source_upd_versions
    WHERE updId = ? AND state = 'formed'
  `).get(upd.id);
  context.service.conductUpd(context.commandContext, {
    ...conductPlan(context, {
      idempotencyKey: `second-candidate-conduct-${suffix}`,
      sourceEventId: `second-candidate-conduct-event-${suffix}`,
      sourceHash: oracleHash({ secondCandidateConduct: suffix }),
    }),
    expectedUpdVersion: Number(formed.version),
    formedUpdVersionId: formed.id,
    updId: upd.id,
  });
  return {
    close,
    period,
    rentalLine,
    snapshot,
    terms: context.db.prepare(`
      SELECT * FROM billing_source_effective_terms WHERE id = ?
    `).get(snapshot.effectiveTermsVersionId),
  };
}

function acceptForeignTermsIdentity(context, suffix, overrides = {}) {
  const edge = insertForeignTermsIdentity(context, suffix, overrides);
  const accepted = acceptAdditionalPolicyRun(
    context,
    approvedTestPolicyManifest(),
    `foreign-terms-${suffix}`,
  );
  assert.equal(accepted.selectedCandidate.status, 'eligible_candidate');
  const acceptedRuns = [oracleAcceptedRun(context, accepted.selectedRun.id)];
  const acceptedDryRuns = acceptedRuns.map(row => ({
    dryRunId: row.dryRunId,
    resultHash: row.resultHash,
  }));
  resealAcceptance(context, { acceptedDryRuns, acceptedRuns });
  resealAcceptedPolicyManifestSet(context, [accepted.selectedRun.policyManifestHash]);
  const termsInput = context.db.prepare(`
    SELECT * FROM actual_source_dry_run_inputs
    WHERE runId = ? AND sourceKind = 'billing_source_effective_terms' AND sourceId = ?
  `).get(accepted.selectedRun.id, edge.foreignTerms.id);
  assert.ok(termsInput);
  assert.equal(
    JSON.parse(termsInput.relationshipJson).rentalLineId,
    edge.foreignRentalLine.id,
  );
  return { ...accepted, ...edge, termsInput };
}

function replacePeriodVersionsWithPermissiveStorage(context) {
  const table = 'billing_source_period_versions';
  const rows = context.db.prepare(`SELECT * FROM ${table} ORDER BY rowid`).all();
  const columnInfo = context.db.prepare(`PRAGMA table_info(${table})`).all();
  const columns = columnInfo.map(row => row.name);
  context.db.pragma('foreign_keys = OFF');
  context.db.exec(`DROP TABLE ${table}`);
  context.db.exec(`
    CREATE TABLE ${table} (
      ${columnInfo.map(column => (
        `"${column.name}"${column.name === 'version' ? '' : ` ${column.type}`}`
        + `${column.name === 'id' ? ' PRIMARY KEY' : ''}`
      )).join(', ')}
    )
  `);
  const placeholders = columns.map(column => (
    column === 'version' ? 'CAST(? AS INTEGER)' : '?'
  )).join(', ');
  const insert = context.db.prepare(`
    INSERT INTO ${table} (${columns.map(column => `"${column}"`).join(', ')})
    VALUES (${placeholders})
  `);
  for (const row of rows) insert.run(...columns.map(column => row[column]));
}

function setRawPeriodSemanticVersion(context, rowId, sqlExpression, { permissive = true } = {}) {
  if (permissive) replacePeriodVersionsWithPermissiveStorage(context);
  const update = () => {
    context.db.exec(`
      UPDATE billing_source_period_versions
      SET version = ${sqlExpression}
      WHERE id = '${rowId.replaceAll("'", "''")}'
    `);
  };
  if (permissive) {
    update();
  } else {
    context.db.pragma('ignore_check_constraints = ON');
    try {
      mutateAppendOnlyTable(context.db, 'billing_source_period_versions', update);
    } finally {
      context.db.pragma('ignore_check_constraints = OFF');
    }
  }
  const raw = context.db.prepare(`
    SELECT quote(version) AS rawValue, typeof(version) AS storageClass, version
    FROM billing_source_period_versions WHERE id = ?
  `).get(rowId);
  return {
    jsType: typeof raw.version,
    jsValue: raw.version,
    rawValue: raw.rawValue,
    storageClass: raw.storageClass,
  };
}

function replacePr6TableWithPermissiveStorage(context, table, permissiveColumns = []) {
  const rows = context.db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all();
  const columnInfo = context.db.prepare(`PRAGMA table_info("${table}")`).all();
  const columns = columnInfo.map(row => row.name);
  const permissive = new Set(permissiveColumns);
  context.db.pragma('foreign_keys = OFF');
  context.db.exec(`DROP TABLE "${table}"`);
  context.db.exec(`
    CREATE TABLE "${table}" (
      ${columnInfo.map(column => (
        `"${column.name}"${permissive.has(column.name) ? '' : ` ${column.type}`}`
        + `${column.name === 'id' ? ' PRIMARY KEY' : ''}`
      )).join(', ')}
    )
  `);
  const insert = context.db.prepare(`
    INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(', ')})
    VALUES (${columnInfo.map(column => (
      permissive.has(column.name) && column.type.toUpperCase() === 'INTEGER'
        ? 'CAST(? AS INTEGER)'
        : '?'
    )).join(', ')})
  `);
  for (const row of rows) insert.run(...columns.map(column => row[column]));
  return { columns, rows };
}

function setRawPr6Integer(context, table, column, rowId, sqlExpression, { replace = true } = {}) {
  if (replace) replacePr6TableWithPermissiveStorage(context, table, [column]);
  context.db.exec(`
    UPDATE "${table}"
    SET "${column}" = ${sqlExpression}
    WHERE id = '${rowId.replaceAll("'", "''")}'
  `);
  const raw = context.db.prepare(`
    SELECT quote("${column}") AS rawValue,
           typeof("${column}") AS storageClass,
           "${column}" AS value
    FROM "${table}" WHERE id = ?
  `).get(rowId);
  return {
    jsType: typeof raw.value,
    jsValue: raw.value,
    rawValue: raw.rawValue,
    storageClass: raw.storageClass,
  };
}

function rewriteRowIgnoringChecks(db, table, row) {
  db.pragma('ignore_check_constraints = ON');
  try {
    rewriteRowById(db, table, row);
  } finally {
    db.pragma('ignore_check_constraints = OFF');
  }
}

function oraclePr8SourceVersion(row) {
  for (const field of ['version', 'sourceVersion', 'sourceEventVersion', 'resultVersion', 'aggregateVersion']) {
    if (Number.isSafeInteger(row[field]) && row[field] >= 1) return row[field];
  }
  return null;
}

function oraclePr8ExternalAssertionHash(row) {
  const fields = [
    'sourceHash', 'contentHash', 'evidenceHash', 'sliceHash', 'mappingHash', 'identityHash',
    'provenanceHash', 'calculationInputsHash', 'evidenceSetHash', 'lineSetHash',
    'approvalFingerprint', 'commandFingerprint', 'resultFingerprint', 'afterFingerprint',
  ];
  const assertions = {};
  for (const field of fields) {
    if (typeof row[field] === 'string' && /^[a-f0-9]{64}$/.test(row[field])) {
      assertions[field] = row[field];
    }
  }
  const keys = Object.keys(assertions);
  if (keys.length === 0) return null;
  if (keys.length === 1) return assertions[keys[0]];
  return oracleHash(assertions);
}

function oraclePr8Relationships(row) {
  const fields = [
    'activationBoundaryId', 'rentalLineId', 'periodId', 'closedPeriodVersionId',
    'snapshotId', 'updId', 'formedUpdVersionId', 'previousVersionId',
    'updLineId', 'updLineVersionId', 'coverageSetId', 'originalCoverageSetId',
    'replacementCoverageSetId', 'operationId', 'rentalId', 'clientId', 'contractId',
  ];
  return Object.fromEntries(fields
    .filter(field => row[field] !== undefined && row[field] !== null)
    .map(field => [field, row[field]]));
}

function oraclePr8RelationshipColumn(row, field) {
  if (field === 'updVersionId') return row.id && row.updId && row.version ? row.id : null;
  if (field === 'coverageSliceId') return row.coverageSetId && row.updLineVersionId ? row.id : null;
  if (field === 'sourceOperationId') return row.operationId || null;
  return row[field] || null;
}

function oraclePr8AuthoritativeProjection(sourceKind, row) {
  const canonicalRow = Object.fromEntries(Object.entries(row).sort(([left], [right]) => (
    left < right ? -1 : left > right ? 1 : 0
  )));
  return {
    activationBoundaryId: oraclePr8RelationshipColumn(row, 'activationBoundaryId'),
    closedPeriodVersionId: oraclePr8RelationshipColumn(row, 'closedPeriodVersionId'),
    coverageSetId: oraclePr8RelationshipColumn(row, 'coverageSetId'),
    coverageSliceId: oraclePr8RelationshipColumn(row, 'coverageSliceId'),
    deterministicOrderKey: oracleHash({ sourceKind, sourceId: String(row.id) }),
    externalAssertionHash: oraclePr8ExternalAssertionHash(row),
    normalizedInputHash: oracleHash({ sourceKind, row: canonicalRow }),
    periodId: oraclePr8RelationshipColumn(row, 'periodId'),
    relationshipJson: oracleCanonicalJson(oraclePr8Relationships(row)),
    rentalLineId: oraclePr8RelationshipColumn(row, 'rentalLineId'),
    snapshotId: oraclePr8RelationshipColumn(row, 'snapshotId'),
    sourceId: String(row.id),
    sourceKind,
    sourceOperationId: oraclePr8RelationshipColumn(row, 'sourceOperationId'),
    sourceState: String(
      row.state
      || row.status
      || row.eventType
      || row.sourceIntegrityStatus
      || row.authorityStatus
      || row.action
      || row.operationType
      || 'recorded'
    ),
    sourceTableIdentity: sourceKind,
    sourceVersion: oraclePr8SourceVersion(row),
    updId: oraclePr8RelationshipColumn(row, 'updId'),
    updLineId: oraclePr8RelationshipColumn(row, 'updLineId'),
    updLineVersionId: oraclePr8RelationshipColumn(row, 'updLineVersionId'),
    updVersionId: oraclePr8RelationshipColumn(row, 'updVersionId'),
  };
}

function selectedEffectiveTermsState(context) {
  const candidate = context.authority.candidate;
  const snapshot = context.db.prepare(`
    SELECT * FROM billing_source_snapshots WHERE id = ?
  `).get(candidate.snapshotId);
  const close = context.db.prepare(`
    SELECT * FROM billing_source_period_versions WHERE id = ?
  `).get(candidate.closedPeriodVersionId);
  const terms = context.db.prepare(`
    SELECT * FROM billing_source_effective_terms WHERE id = ?
  `).get(snapshot.effectiveTermsVersionId);
  const input = context.db.prepare(`
    SELECT * FROM actual_source_dry_run_inputs
    WHERE runId = ? AND sourceKind = 'billing_source_effective_terms' AND sourceId = ?
  `).get(context.authority.run.id, terms.id);
  return { candidate, close, input, snapshot, terms };
}

function assertPr8ContentDriftDenial(
  context,
  {
    changedField,
    newValue,
    oldValue,
    persistedInput,
    sourceKind,
    sourceRow,
  },
  command = eligibilityCommand(context),
  before = counts(context.db),
) {
  const authoritative = oraclePr8AuthoritativeProjection(sourceKind, sourceRow);
  const details = {
    actualError: null,
    authoritativeNormalizedProjection: authoritative,
    changedField,
    expectedHash: authoritative.normalizedInputHash,
    expectedOutcome: 'PR8_EVIDENCE_MISMATCH',
    newValue,
    oldValue,
    persistedPr8Projection: {
      externalAssertionHash: persistedInput.externalAssertionHash,
      normalizedInputHash: persistedInput.normalizedInputHash,
      relationshipJson: persistedInput.relationshipJson,
      sourceId: persistedInput.sourceId,
      sourceKind: persistedInput.sourceKind,
      sourceVersion: persistedInput.sourceVersion,
    },
  };
  assert.notEqual(
    authoritative.normalizedInputHash,
    persistedInput.normalizedInputHash,
    oracleCanonicalJson(details),
  );
  let error;
  try {
    context.eligibilityService.produceEligibleEvent(command);
  } catch (caught) {
    error = caught;
  }
  details.actualError = error?.code ?? null;
  details.replayed = error?.replayed ?? null;
  details.accounting = counts(context.db);
  assert.equal(error?.code, 'PR8_EVIDENCE_MISMATCH', oracleCanonicalJson(details));
  assert.equal(error.replayed, false, oracleCanonicalJson(details));
  assert.deepEqual(counts(context.db), {
    events: before.events,
    conflicts: before.conflicts + 1,
    transitions: before.transitions + 1,
    receivables: before.receivables,
    operations: before.operations,
  }, oracleCanonicalJson(details));
  const transition = context.db.prepare(`
    SELECT * FROM canonical_receivable_posting_conflict_transitions
    ORDER BY scopeSequence DESC LIMIT 1
  `).get();
  assert.deepEqual(
    [transition.state, transition.attemptApplied, transition.rateApplied, transition.circuitApplied],
    ['COMPLETE', 1, 1, 1],
    oracleCanonicalJson(details),
  );
  return { authoritative, details, error, transition };
}

function assertOperationalIntegrityFailure(context, command, expectedCode, before = counts(context.db)) {
  assert.throws(
    () => context.eligibilityService.produceEligibleEvent(command),
    error => error.code === expectedCode,
  );
  assert.deepEqual(counts(context.db), before);
}

function acceptAdditionalPolicyRun(context, manifest, suffix, { closedPeriodVersionId = null } = {}) {
  const second = context.dryRunService.evaluateActualSourceDryRun(
    context.dryRunContext,
    dryRunCommand({
      asOfDate: '2026-09-15',
      idempotencyKey: `p1-02-policy-${suffix}`,
      policyManifest: manifest,
    }),
  );
  const selectedRun = context.db.prepare('SELECT * FROM actual_source_dry_runs WHERE id = ?')
    .get(second.dryRunId);
  const selectedCandidate = closedPeriodVersionId
    ? context.db.prepare(`
      SELECT * FROM actual_source_dry_run_candidates
      WHERE runId = ? AND closedPeriodVersionId = ?
      ORDER BY candidateKey, id LIMIT 1
    `).get(second.dryRunId, closedPeriodVersionId)
    : context.db.prepare(`
      SELECT * FROM actual_source_dry_run_candidates
      WHERE runId = ? ORDER BY candidateKey, id LIMIT 1
    `).get(second.dryRunId);
  assert.ok(selectedCandidate);
  const acceptedRuns = [
    oracleAcceptedRun(context, context.authority.run.id),
    oracleAcceptedRun(context, selectedRun.id),
  ].sort((left, right) => left.dryRunId < right.dryRunId ? -1 : left.dryRunId > right.dryRunId ? 1 : 0);
  const acceptedDryRuns = acceptedRuns.map(entry => ({
    dryRunId: entry.dryRunId,
    resultHash: entry.resultHash,
  }));
  const policyManifestHashes = [...new Set(acceptedRuns.map(entry => entry.policyManifestHash))].sort();
  resealAcceptance(context, {
    acceptedDryRuns,
    acceptedRuns,
    authorization: { policyManifestHashesJson: oracleCanonicalJson(policyManifestHashes) },
  });
  resealAcceptedPolicyManifestSet(context, policyManifestHashes);
  return {
    command: eligibilityCommand(context, {
      candidateId: selectedCandidate.id,
      dryRunId: selectedRun.id,
    }),
    selectedCandidate,
    selectedRun,
  };
}

function oracleDueDatePolicySetHash(policySet) {
  return oracleHash({
    contractualDueDate: policySet.contractualDueDate,
    domain: 'rentcore.canonical_actual_posting.due_date_policy_set',
    unknownDueDateTreatment: policySet.unknownDueDateTreatment,
    version: 1,
  });
}

function oracleDueDatePolicySetFromManifest(manifest) {
  const contractual = manifest.gates.find(gate => gate.key === 'contractual_due_date');
  const unknown = manifest.gates.find(gate => gate.key === 'unknown_due_date_treatment');
  const mappingHash = oracleHash({
    agingTreatment: 'excluded_from_aging',
    contractualDueDate: null,
    domain: 'rentcore.canonical_actual_posting.unknown_due_date_mapping',
    mappingId: 'rentcore.unknown_due_date_posting_treatment.v1',
    mappingVersion: 1,
    postingTreatment: 'post_without_aging_v1',
    sourceDecisionLiteral: 'allow_unknown_without_aging',
    sourceGateKind: 'unknown_due_date_treatment',
    version: 1,
  });
  return {
    contractualDueDate: {
      expectedSourceRef: contractual.expectedSourceRef,
      gateKind: contractual.key,
      policyHash: contractual.decisionHash,
      policyId: contractual.decisionRef,
      policyVersion: contractual.decisionVersion,
    },
    unknownDueDateTreatment: {
      decisionLiteral: unknown.decisionValue,
      gateKind: unknown.key,
      mappingHash,
      mappingId: 'rentcore.unknown_due_date_posting_treatment.v1',
      mappingVersion: 1,
      policyHash: unknown.decisionHash,
      policyId: unknown.decisionRef,
      policyVersion: unknown.decisionVersion,
    },
  };
}

function independentlyResealDueDatePolicies(context, authorizationSet, activationSet = authorizationSet) {
  const authorization = context.db.prepare(`
    SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
  `).get(context.authority.authorization.recordId);
  authorization.dueDatePolicySetJson = oracleCanonicalJson(authorizationSet);
  authorization.dueDatePolicySetHash = oracleDueDatePolicySetHash(authorizationSet);
  authorization.recordHash = oracleRecordHash(
    authorization,
    ORACLE_WRITE_AUTHORIZATION_FIELDS,
    'rentcore.canonical_actual_posting.write_authorization',
  );
  rewriteWholeRow(context.db, 'canonical_write_authorization_records', authorization);

  const activation = context.db.prepare(`
    SELECT * FROM canonical_posting_activation_records WHERE recordId = ?
  `).get(context.authority.activation.recordId);
  activation.dueDatePolicySetJson = oracleCanonicalJson(activationSet);
  activation.dueDatePolicySetHash = oracleDueDatePolicySetHash(activationSet);
  activation.recordHash = oracleRecordHash(
    activation,
    ORACLE_ACTIVATION_FIELDS,
    'rentcore.canonical_actual_posting.activation',
  );
  rewriteWholeRow(context.db, 'canonical_posting_activation_records', activation);
  return { activation, authorization };
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

test('P1-01 red proof: a fully sealed accepted-period reopen removes the current revision before event lookup', () => {
  const context = createPr9aContext();
  try {
    const { result } = reopenAcceptedBillingPeriod(context, 'p1-01-red');
    assert.match(result.fingerprint, /^[0-9a-f]{64}$/);
    const { observation } = assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    assert.equal(observation.expectedProjection.currentRevisionState, 'unique');
    assert.equal(observation.observedProjection.currentRevisionState, 'missing');
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

test('P1-02 red proof: selected multi-run named policies cannot come from another accepted run', () => {
  const context = createPr9aContext();
  try {
    const selectedManifest = approvedTestPolicyManifest({
      manifestId: 'isolated-test-pr8-policy-v2',
      manifestVersion: 2,
      gates: {
        contractual_due_date: {
          decisionRef: 'isolated-test-contractual_due_date-decision-v2',
          decisionVersion: 2,
          decisionHash: oracleHash({ gate: 'contractual_due_date', version: 2 }),
        },
        canonical_amount_basis: {
          decisionRef: 'isolated-test-canonical_amount_basis-decision-v2',
          decisionVersion: 2,
          decisionHash: oracleHash({ gate: 'canonical_amount_basis', version: 2 }),
        },
      },
    });
    const second = context.dryRunService.evaluateActualSourceDryRun(
      context.dryRunContext,
      dryRunCommand({
        asOfDate: '2026-09-15',
        idempotencyKey: 'p1-02-selected-policy-v2',
        policyManifest: selectedManifest,
      }),
    );
    const selectedRun = context.db.prepare('SELECT * FROM actual_source_dry_runs WHERE id = ?')
      .get(second.dryRunId);
    const selectedCandidate = context.db.prepare(`
      SELECT * FROM actual_source_dry_run_candidates WHERE runId = ? ORDER BY candidateKey, id LIMIT 1
    `).get(second.dryRunId);
    const acceptedRuns = [
      oracleAcceptedRun(context, context.authority.run.id),
      oracleAcceptedRun(context, selectedRun.id),
    ].sort((left, right) => left.dryRunId < right.dryRunId ? -1 : left.dryRunId > right.dryRunId ? 1 : 0);
    const acceptedDryRuns = acceptedRuns.map(entry => ({
      dryRunId: entry.dryRunId,
      resultHash: entry.resultHash,
    }));
    const policyManifestHashes = [...new Set(acceptedRuns.map(entry => entry.policyManifestHash))].sort();
    const resealed = resealAcceptance(context, {
      acceptedDryRuns,
      acceptedRuns,
      authorization: { policyManifestHashesJson: oracleCanonicalJson(policyManifestHashes) },
    });
    const bound = resealAcceptedPolicyManifestSet(context, policyManifestHashes);
    assert.equal(resealed.authorization.acceptedPr8EvidenceHash, bound.authorization.acceptedPr8EvidenceHash);
    assert.equal(bound.authorization.recordHash, oracleRecordHash(
      bound.authorization,
      ORACLE_WRITE_AUTHORIZATION_FIELDS,
      'rentcore.canonical_actual_posting.write_authorization',
    ));
    assert.equal(bound.activation.recordHash, oracleRecordHash(
      bound.activation,
      ORACLE_ACTIVATION_FIELDS,
      'rentcore.canonical_actual_posting.activation',
    ));
    const { observation } = assertRequiredDenial(
      context,
      'DUE_DATE_POLICY_DRIFT',
      eligibilityCommand(context, {
        candidateId: selectedCandidate.id,
        dryRunId: selectedRun.id,
      }),
    );
    assert.equal(observation.observedProjection.bindingState, 'ambiguous');
  } finally {
    context.db.close();
  }
});

test('P1 billing-period semantic lifecycle remediation contract', async t => {
  await t.test('1. closed v1 to closed v2 is denied when PR8 selects stale v1', () => {
    const context = createPr9aContext();
    try {
      appendWriterSealedIllegalClose(context, 'selected-v1');
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('2. closed v1 to closed v2 is denied when resealed PR8 selects v2', () => {
    const context = createPr9aContext();
    try {
      const { closed } = appendWriterSealedIllegalClose(context, 'selected-v2');
      const accepted = acceptRunForCurrentClosedVersion(context, closed, 'selected-v2');
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', accepted.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('3. closed v1 to closed v2 to closed v3 is denied when PR8 selects v3', () => {
    const context = createPr9aContext();
    try {
      const v2 = appendWriterSealedIllegalClose(context, 'three-v2').closed;
      const v3 = appendWriterSealedIllegalClose(context, 'three-v3', v2.id).closed;
      const accepted = acceptRunForCurrentClosedVersion(context, v3, 'three-v3');
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', accepted.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('4. reopened v1 root is denied even with a valid selected v3 descendant', () => {
    const context = createPr9aContext();
    try {
      const lifecycle = recloseAcceptedBillingPeriod(context, 'reopened-root');
      const v1 = context.db.prepare(`
        SELECT * FROM billing_source_period_versions
        WHERE periodId = ? AND version = 1
      `).get(context.authority.candidate.periodId);
      rewriteRowById(context.db, 'billing_source_period_versions', {
        ...v1,
        eventType: 'reopened',
        previousVersionId: null,
        reopensClosedVersionId: v1.id,
        effectiveTermsVersionId: null,
        snapshotId: null,
        capabilityKey: 'billing.period.reopen',
        reasonCode: 'HOSTILE_REOPENED_ROOT',
        reasonText: 'A reopened event cannot be an initial period version',
      });
      const accepted = acceptRunForCurrentClosedVersion(context, lifecycle.closed, 'reopened-root');
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', accepted.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('5. closed v1 to reopened v2 to reopened v3 is denied', () => {
    const context = createPr9aContext();
    try {
      const { reopened } = reopenAcceptedBillingPeriod(context, 'double-reopen');
      appendRawPeriodVersion(context, {
        baseId: reopened.id,
        id: 'hostile-double-reopen-v3',
        eventType: 'reopened',
        previousVersionId: reopened.id,
        reopensClosedVersionId: context.authority.candidate.closedPeriodVersionId,
        suffix: 'double-reopen-v3',
        version: 3,
      });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('6. closed v1 to reopened v2 to independently closed v3 is valid', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'valid-control');
      const result = context.eligibilityService.produceEligibleEvent(current.command);
      assert.equal(result.replayed, false);
      assert.equal(result.event.closedPeriodVersionId, current.closed.id);
      assert.deepEqual(counts(context.db), {
        events: 1, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
      });
    } finally {
      context.db.close();
    }
  });

  await t.test('7. valid lifecycle denies PR8 stale v1', () => {
    const context = createPr9aContext();
    try {
      recloseAcceptedBillingPeriod(context, 'stale-v1');
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('8. valid lifecycle accepts PR8 current v3', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'current-v3');
      const result = context.eligibilityService.produceEligibleEvent(current.command);
      assert.equal(result.event.closedPeriodVersionId, current.closed.id);
      assert.equal(result.replayed, false);
    } finally {
      context.db.close();
    }
  });

  await t.test('9. duplicate semantic version is denied', () => {
    const context = createPr9aContext();
    try {
      context.db.exec('DROP INDEX uq_billing_source_period_version');
      appendRawPeriodVersion(context, { id: 'hostile-duplicate-version-a', suffix: 'duplicate-a', version: 2 });
      appendRawPeriodVersion(context, { id: 'hostile-duplicate-version-b', suffix: 'duplicate-b', version: 2 });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('10. semantic version gap is denied', () => {
    const context = createPr9aContext();
    try {
      appendRawPeriodVersion(context, { id: 'hostile-version-gap-v3', suffix: 'gap-v3', version: 3 });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('11. same semantic version with different IDs is denied', () => {
    const context = createPr9aContext();
    try {
      context.db.exec('DROP INDEX uq_billing_source_period_version');
      appendRawPeriodVersion(context, {
        eventType: 'closed', id: 'hostile-same-version-close-a', suffix: 'same-version-a', version: 2,
      });
      appendRawPeriodVersion(context, {
        eventType: 'closed', id: 'hostile-same-version-close-b', suffix: 'same-version-b', version: 2,
      });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('12. successor pointing to a foreign-period predecessor is denied', () => {
    const context = createPr9aContext();
    try {
      const foreign = appendForeignPeriodLifecycle(context, 'foreign-predecessor');
      appendRawPeriodVersion(context, {
        eventType: 'closed',
        id: 'hostile-foreign-predecessor-close-v2',
        previousVersionId: foreign.reopened.id,
        suffix: 'foreign-predecessor-main-v2',
        version: 2,
      });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('13. same-period ownership drift is denied', () => {
    const context = createPr9aContext();
    try {
      const base = context.db.prepare('SELECT * FROM billing_source_period_versions WHERE id = ?')
        .get(context.authority.candidate.closedPeriodVersionId);
      const drifted = {
        ...base,
        id: 'hostile-period-ownership-drift-v2',
        companyId: 'hostile-foreign-company',
        branchId: 'hostile-foreign-branch',
        version: 2,
        previousVersionId: base.id,
        sourceEventId: 'hostile-period-ownership-drift-event',
        sourceHash: oracleHash({ hostilePeriodOwnershipDrift: true }),
      };
      context.db.pragma('foreign_keys = OFF');
      try {
        insertCopiedRow(context.db, 'billing_source_period_versions', drifted);
      } finally {
        context.db.pragma('foreign_keys = ON');
      }
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('14. competing roots in one period are denied', () => {
    const context = createPr9aContext();
    try {
      context.db.exec('DROP INDEX uq_billing_source_period_version');
      appendRawPeriodVersion(context, {
        eventType: 'closed',
        id: 'hostile-competing-closed-root',
        previousVersionId: null,
        suffix: 'competing-closed-root',
        version: 1,
      });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('15. multiple closed successors/current revisions are denied', () => {
    const context = createPr9aContext();
    try {
      context.db.exec('DROP INDEX uq_billing_source_period_version');
      appendRawPeriodVersion(context, {
        eventType: 'closed', id: 'hostile-current-close-a', suffix: 'current-a', version: 2,
      });
      appendRawPeriodVersion(context, {
        eventType: 'closed', id: 'hostile-current-close-b', suffix: 'current-b', version: 2,
      });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('16. physical insertion order does not override semantic version order', () => {
    const context = createPr9aContext();
    try {
      const lifecycle = recloseAcceptedBillingPeriod(context, 'physical-order');
      const v2 = context.db.prepare(`
        SELECT * FROM billing_source_period_versions WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      const v3 = context.db.prepare(`
        SELECT * FROM billing_source_period_versions WHERE periodId = ? AND version = 3
      `).get(context.authority.candidate.periodId);
      context.db.pragma('foreign_keys = OFF');
      try {
        mutateAppendOnlyTable(context.db, 'billing_source_period_versions', () => {
          context.db.prepare('DELETE FROM billing_source_period_versions WHERE id IN (?, ?)').run(v2.id, v3.id);
          insertCopiedRow(context.db, 'billing_source_period_versions', v3);
          insertCopiedRow(context.db, 'billing_source_period_versions', v2);
        });
      } finally {
        context.db.pragma('foreign_keys = ON');
      }
      const physical = context.db.prepare(`
        SELECT version FROM billing_source_period_versions WHERE version IN (2, 3) ORDER BY rowid
      `).all().map(row => Number(row.version));
      assert.deepEqual(physical, [3, 2]);
      const accepted = acceptRunForCurrentClosedVersion(context, lifecycle.closed, 'physical-order');
      const result = context.eligibilityService.produceEligibleEvent(accepted.command);
      assert.equal(result.event.closedPeriodVersionId, v3.id);
      assert.deepEqual(context.db.pragma('foreign_key_check'), []);
    } finally {
      context.db.close();
    }
  });

  await t.test('17. exact replay is blocked after an illegal lifecycle append', () => {
    const context = createPr9aContext();
    try {
      context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      appendWriterSealedIllegalClose(context, 'after-exact-replay');
      const { denial } = assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
      assert.equal(denial.replayed, false);
      assert.deepEqual(counts(context.db), {
        events: 1, conflicts: 1, transitions: 1, receivables: 0, operations: 0,
      });
    } finally {
      context.db.close();
    }
  });

  await t.test('18. illegal transition introduced after insert fails locked reread and rolls back', () => {
    const context = createPr9aContext();
    const current = createValidCurrentV3(context, 'post-insert-illegal');
    const v1 = context.db.prepare(`
      SELECT * FROM billing_source_period_versions WHERE periodId = ? AND version = 1
    `).get(context.authority.candidate.periodId);
    const v2 = context.db.prepare(`
      SELECT * FROM billing_source_period_versions WHERE periodId = ? AND version = 2
    `).get(context.authority.candidate.periodId);
    const restore = installAfterEventInsertMutation(context.db, () => {
      rewriteRowById(context.db, 'billing_source_period_versions', {
        ...v2,
        eventType: 'closed',
        reopensClosedVersionId: null,
        effectiveTermsVersionId: v1.effectiveTermsVersionId,
        snapshotId: v1.snapshotId,
        capabilityKey: 'billing.period.close',
        reasonCode: null,
        reasonText: null,
      });
    });
    try {
      assert.throws(
        () => context.eligibilityRepository.produceEligibleEvent(current.command),
        error => error.code === 'CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED',
      );
      assert.deepEqual(counts(context.db), {
        events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
      });
      assert.equal(context.db.prepare(`
        SELECT eventType FROM billing_source_period_versions WHERE id = ?
      `).get(v2.id).eventType, 'reopened');
    } finally {
      restore();
      context.db.close();
    }
  });

  await t.test('19. PR8 corruption retains precedence over simultaneous illegal lifecycle', () => {
    const context = createPr9aContext();
    try {
      appendWriterSealedIllegalClose(context, 'precedence');
      mutateCandidateForConflict(context);
      assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
    } finally {
      context.db.close();
    }
  });

  await t.test('20. fully resealed authorization and activation cannot bless illegal lifecycle', () => {
    const context = createPr9aContext();
    try {
      const sealed = appendWriterSealedIllegalClose(context, 'fully-resealed');
      const accepted = acceptRunForCurrentClosedVersion(context, sealed.closed, 'fully-resealed');
      const authorization = context.db.prepare(`
        SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
      `).get(context.authority.authorization.recordId);
      const activation = context.db.prepare(`
        SELECT * FROM canonical_posting_activation_records WHERE recordId = ?
      `).get(context.authority.activation.recordId);
      assert.equal(authorization.recordHash, oracleRecordHash(
        authorization,
        ORACLE_WRITE_AUTHORIZATION_FIELDS,
        'rentcore.canonical_actual_posting.write_authorization',
      ));
      assert.equal(activation.recordHash, oracleRecordHash(
        activation,
        ORACLE_ACTIVATION_FIELDS,
        'rentcore.canonical_actual_posting.activation',
      ));
      assert.match(sealed.operation.resultFingerprint, /^[0-9a-f]{64}$/);
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', accepted.command);
    } finally {
      context.db.close();
    }
  });
});

test('P1 billing-period lifecycle adversarial self-audit beyond the reported finding', async t => {
  await t.test('alternating states cannot reuse an earlier close snapshot', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'self-audit-snapshot-reuse');
      const v1 = context.db.prepare(`
        SELECT * FROM billing_source_period_versions WHERE periodId = ? AND version = 1
      `).get(context.authority.candidate.periodId);
      rewriteRowById(context.db, 'billing_source_period_versions', {
        ...current.closed,
        snapshotId: v1.snapshotId,
      });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', current.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('non-integer semantic version storage is rejected', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'self-audit-real-version');
      const v2 = context.db.prepare(`
        SELECT * FROM billing_source_period_versions WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      context.db.pragma('ignore_check_constraints = ON');
      try {
        rewriteRowById(context.db, 'billing_source_period_versions', { ...v2, version: 2.5 });
      } finally {
        context.db.pragma('ignore_check_constraints = OFF');
      }
      assertOperationalIntegrityFailure(
        context,
        current.command,
        'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('root predecessor cycle is rejected even when the latest close is selected', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'self-audit-cycle');
      const v1 = context.db.prepare(`
        SELECT * FROM billing_source_period_versions WHERE periodId = ? AND version = 1
      `).get(context.authority.candidate.periodId);
      rewriteRowById(context.db, 'billing_source_period_versions', {
        ...v1,
        previousVersionId: current.closed.id,
      });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', current.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('reopened state cannot carry close snapshot and terms payload', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'self-audit-reopen-payload');
      const v1 = context.db.prepare(`
        SELECT * FROM billing_source_period_versions WHERE periodId = ? AND version = 1
      `).get(context.authority.candidate.periodId);
      const v2 = context.db.prepare(`
        SELECT * FROM billing_source_period_versions WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      context.db.pragma('ignore_check_constraints = ON');
      try {
        rewriteRowById(context.db, 'billing_source_period_versions', {
          ...v2,
          effectiveTermsVersionId: v1.effectiveTermsVersionId,
          snapshotId: v1.snapshotId,
        });
      } finally {
        context.db.pragma('ignore_check_constraints = OFF');
      }
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', current.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('selected close snapshot ownership drift is rejected', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'self-audit-snapshot-ownership');
      const snapshot = context.db.prepare('SELECT * FROM billing_source_snapshots WHERE id = ?')
        .get(current.closed.snapshotId);
      context.db.pragma('foreign_keys = OFF');
      try {
        rewriteRowById(context.db, 'billing_source_snapshots', {
          ...snapshot,
          companyId: 'hostile-snapshot-company',
          branchId: 'hostile-snapshot-branch',
        });
      } finally {
        context.db.pragma('foreign_keys = ON');
      }
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', current.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('exact replay is blocked after semantic predecessor corruption', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'self-audit-replay-predecessor');
      context.eligibilityService.produceEligibleEvent(current.command);
      const v2 = context.db.prepare(`
        SELECT * FROM billing_source_period_versions WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      rewriteRowById(context.db, 'billing_source_period_versions', {
        ...v2,
        previousVersionId: current.closed.id,
      });
      const { denial } = assertRequiredDenial(
        context,
        'SOURCE_LINEAGE_NO_CURRENT_REVISION',
        current.command,
      );
      assert.equal(denial.replayed, false);
      assert.deepEqual(counts(context.db), {
        events: 1, conflicts: 1, transitions: 1, receivables: 0, operations: 0,
      });
    } finally {
      context.db.close();
    }
  });
});

test('P1 effectiveTermsVersionId semantic ownership RED contract', async t => {
  const fullySealedForeignCases = [
    ['terms from another rental line in the same company and branch', 'foreign-line'],
    ['terms from another rental line with the same billing cycle', 'same-cycle'],
    ['terms from another rental line with the same coverage interval', 'same-coverage'],
    ['terms persisted under another economic source', 'foreign-economic-source'],
    ['candidate input lineage selects the foreign persisted terms row', 'foreign-input-lineage'],
    ['foreign terms row is part of the selected PR6 closure', 'foreign-pr6-closure'],
    ['fully resealed PR8 acceptance retains the foreign terms identity', 'resealed-pr8'],
    ['fully resealed authorization and activation retain the foreign terms identity', 'resealed-auth'],
    ['same labels and hashes do not make a foreign persisted identity equivalent', 'same-labels'],
    ['aggregate ownership hash cannot replace the rental-line/terms edge', 'aggregate-owner'],
  ];
  for (const [name, suffix] of fullySealedForeignCases) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        const accepted = acceptForeignTermsIdentity(context, suffix);
        const acceptedRun = JSON.parse(
          context.db.prepare(`
            SELECT acceptedPr8EvidenceJson
            FROM canonical_write_authorization_records WHERE recordId = ?
          `).get(context.authority.authorization.recordId).acceptedPr8EvidenceJson,
        ).find(row => row.dryRunId === accepted.selectedRun.id);
        assert.ok(acceptedRun);
        assert.equal(
          acceptedRun.sourceOwnershipManifestHash,
          context.authority.authorization.sourceOwnershipManifestHash,
        );
        assert.match(
          oraclePersistedRowFingerprint(
            context.db,
            'billing_source_effective_terms',
            accepted.foreignTerms,
          ),
          /^[0-9a-f]{64}$/,
        );
        assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', accepted.command);
      } finally {
        context.db.close();
      }
    });
  }

  const postAcceptanceMutations = [
    ['terms effective interval belongs to another billing period', (context, accepted) => {
      rewriteRowById(context.db, 'billing_source_effective_terms', {
        ...accepted.foreignTerms,
        effectiveFromDate: '2026-10-01',
        effectiveToDateExclusive: '2026-11-01',
      });
    }],
    ['terms do not cover the selected coverage interval', (context, accepted) => {
      rewriteRowById(context.db, 'billing_source_effective_terms', {
        ...accepted.foreignTerms,
        effectiveToDateExclusive: '2026-08-15',
      });
    }],
    ['terms billing cycle semantics differ from the selected period', (context, accepted) => {
      rewriteRowById(context.db, 'billing_source_effective_terms', {
        ...accepted.foreignTerms,
        contractualBillingCycleCode: 'hostile_non_month_cycle',
      });
    }],
  ];
  for (const [name, mutate] of postAcceptanceMutations) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        const accepted = acceptForeignTermsIdentity(
          context,
          name.replace(/\W+/g, '-').toLowerCase(),
        );
        mutate(context, accepted);
        assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH', accepted.command);
      } finally {
        context.db.close();
      }
    });
  }

  await t.test('stale predecessor terms revision is not current', () => {
    const context = createPr9aContext();
    try {
      appendTermsSuccessor(context, 'stale-predecessor');
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('successor revision cannot coexist with a candidate selecting its predecessor', () => {
    const context = createPr9aContext();
    try {
      const accepted = acceptForeignTermsIdentity(context, 'successor-old-candidate');
      appendTermsSuccessor(
        context,
        'successor-old-candidate',
        accepted.foreignTerms.id,
      );
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', accepted.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('terms from another PR8 candidate are rejected after complete run resealing', () => {
    const context = createPr9aContext();
    try {
      const foreign = seedSecondPr8CandidateSource(context, 'foreign-candidate');
      const snapshot = context.db.prepare(`
        SELECT * FROM billing_source_snapshots WHERE id = ?
      `).get(context.authority.candidate.snapshotId);
      const close = context.db.prepare(`
        SELECT * FROM billing_source_period_versions WHERE id = ?
      `).get(context.authority.candidate.closedPeriodVersionId);
      rewriteRowById(context.db, 'billing_source_snapshots', {
        ...snapshot,
        effectiveTermsVersionId: foreign.terms.id,
      });
      rewriteRowById(context.db, 'billing_source_period_versions', {
        ...close,
        effectiveTermsVersionId: foreign.terms.id,
      });
      const evaluated = context.dryRunService.evaluateActualSourceDryRun(
        context.dryRunContext,
        dryRunCommand({
          asOfDate: '2026-09-15',
          idempotencyKey: 'foreign-candidate-terms-run',
          policyManifest: approvedTestPolicyManifest(),
        }),
      );
      const run = context.db.prepare(`
        SELECT * FROM actual_source_dry_runs WHERE id = ?
      `).get(evaluated.dryRunId);
      const candidates = context.db.prepare(`
        SELECT * FROM actual_source_dry_run_candidates
        WHERE runId = ? ORDER BY candidateKey, id
      `).all(run.id);
      assert.equal(candidates.length, 2);
      const selected = candidates.find(row => (
        row.rentalLineId === context.authority.candidate.rentalLineId
      ));
      const foreignCandidate = candidates.find(row => row.rentalLineId === foreign.rentalLine.id);
      assert.ok(selected);
      assert.ok(foreignCandidate);
      const acceptedRuns = [oracleAcceptedRun(context, run.id)];
      resealAcceptance(context, {
        acceptedDryRuns: [{ dryRunId: run.id, resultHash: run.resultHash }],
        acceptedRuns,
      });
      resealAcceptedPolicyManifestSet(context, [run.policyManifestHash]);
      const command = eligibilityCommand(context, {
        candidateId: selected.id,
        dryRunId: run.id,
      });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', command);
    } finally {
      context.db.close();
    }
  });

  await t.test('snapshot with a foreign terms ID is rejected', () => {
    const context = createPr9aContext();
    try {
      const accepted = acceptForeignTermsIdentity(context, 'snapshot-only', {
        bindClose: false,
      });
      assert.equal(
        context.db.prepare(`
          SELECT effectiveTermsVersionId FROM billing_source_snapshots WHERE id = ?
        `).get(context.authority.candidate.snapshotId).effectiveTermsVersionId,
        accepted.foreignTerms.id,
      );
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', accepted.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('period close with a foreign terms ID is rejected', () => {
    const context = createPr9aContext();
    try {
      insertForeignTermsIdentity(context, 'close-only', { bindSnapshot: false });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('snapshot and period close cannot point at different terms identities', () => {
    const context = createPr9aContext();
    try {
      const accepted = acceptForeignTermsIdentity(context, 'split-close-snapshot', {
        bindClose: false,
      });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', accepted.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('exact replay is blocked after terms ownership mutation', () => {
    const context = createPr9aContext();
    try {
      const command = eligibilityCommand(context);
      context.eligibilityService.produceEligibleEvent(command);
      const edge = insertForeignTermsIdentity(context, 'replay-mutation', {
        bindClose: false,
        bindSnapshot: false,
      });
      rewriteRowById(context.db, 'billing_source_effective_terms', {
        ...edge.originalTerms,
        rentalLineId: edge.foreignRentalLine.id,
        supersedesTermsVersionId: edge.foreignTerms.id,
        version: 2,
      });
      const { denial } = assertRequiredDenial(
        context,
        'PR8_EVIDENCE_MISMATCH',
        command,
      );
      assert.equal(denial.replayed, false);
      assert.deepEqual(counts(context.db), {
        events: 1, conflicts: 1, transitions: 1, receivables: 0, operations: 0,
      });
    } finally {
      context.db.close();
    }
  });

  await t.test('terms mutation after insert is rejected by the locked reread and rolled back', () => {
    const context = createPr9aContext();
    const edge = insertForeignTermsIdentity(context, 'postinsert-mutation', {
      bindClose: false,
      bindSnapshot: false,
    });
    const before = context.db.prepare(`
      SELECT * FROM billing_source_effective_terms WHERE id = ?
    `).get(edge.originalTerms.id);
    const restore = installAfterEventInsertMutation(context.db, () => {
      rewriteRowById(context.db, 'billing_source_effective_terms', {
        ...before,
        rentalLineId: edge.foreignRentalLine.id,
        supersedesTermsVersionId: edge.foreignTerms.id,
        version: 2,
      });
    });
    try {
      assert.throws(
        () => context.eligibilityRepository.produceEligibleEvent(eligibilityCommand(context)),
        error => error.code === 'CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED',
      );
      assert.deepEqual(counts(context.db), {
        events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
      });
      const after = context.db.prepare(`
        SELECT * FROM billing_source_effective_terms WHERE id = ?
      `).get(edge.originalTerms.id);
      assert.equal(oracleCanonicalJson(after), oracleCanonicalJson(before));
    } finally {
      restore();
      context.db.close();
    }
  });

  await t.test('valid control proves the exact rental-line terms relationship', () => {
    const context = createPr9aContext();
    try {
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

test('P1 persisted semantic-version storage fail-before-hash RED contract', async t => {
  await t.test('invalid semantic versions have no synthetic fingerprint construction path', () => {
    const source = fs.readFileSync(repositoryPath, 'utf8');
    assert.equal(
      source.includes('rentcore.billing_source_authority.invalid_semantic_version'),
      false,
    );
    const verifierStart = source.indexOf('function verifyPr8EvidenceGraph(');
    const preflight = source.indexOf(
      'assertSelectedPeriodVersionStorageIntegrity(db, candidate);',
      verifierStart,
    );
    const firstPr8Hash = source.indexOf('pr8Fingerprint(', verifierStart);
    assert.ok(verifierStart >= 0 && preflight > verifierStart && firstPr8Hash > preflight);
    const fingerprintStart = source.indexOf('function persistedRowFingerprint(');
    const storageCheck = source.indexOf(
      'assertPersistedPeriodVersionRowStorage(db, row);',
      fingerprintStart,
    );
    const rowHash = source.indexOf('rowFingerprint: sha256Canonical(', fingerprintStart);
    assert.ok(fingerprintStart >= 0 && storageCheck > fingerprintStart && rowHash > storageCheck);
  });

  const invalidCases = [
    ['REAL 2.0', 'CAST(2.0 AS REAL)', 'real', 2],
    ['REAL 2.5', 'CAST(2.5 AS REAL)', 'real', 2.5],
    ['TEXT "2"', "CAST('2' AS TEXT)", 'text', '2'],
    ['TEXT "02"', "CAST('02' AS TEXT)", 'text', '02'],
    ['TEXT "2e0"', "CAST('2e0' AS TEXT)", 'text', '2e0'],
    ['BLOB representation', "x'32'", 'blob', Buffer.from('2')],
    ['NULL representation', 'NULL', 'null', null],
    ['zero INTEGER', '0', 'integer', 0],
    ['negative INTEGER', '-1', 'integer', -1],
    ['unsafe INTEGER above Number.MAX_SAFE_INTEGER', '9007199254740992', 'integer', 9007199254740992],
  ];
  for (const [name, expression, storageClass, jsValue] of invalidCases) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        const current = createValidCurrentV3(
          context,
          `storage-${name.replace(/\W+/g, '-').toLowerCase()}`,
        );
        const middle = context.db.prepare(`
          SELECT * FROM billing_source_period_versions
          WHERE periodId = ? AND version = 2
        `).get(context.authority.candidate.periodId);
        const observed = setRawPeriodSemanticVersion(context, middle.id, expression);
        assert.equal(observed.storageClass, storageClass);
        if (Buffer.isBuffer(jsValue)) assert.deepEqual(observed.jsValue, jsValue);
        else assert.equal(observed.jsValue, jsValue);
        assertOperationalIntegrityFailure(
          context,
          current.command,
          'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
        );
      } finally {
        context.db.close();
      }
    });
  }

  const malformedPositions = [
    ['malformed root version', 1, "CAST('root' AS TEXT)", 'text'],
    ['malformed middle version', 2, 'CAST(2.5 AS REAL)', 'real'],
    ['malformed latest version', 3, "x'33'", 'blob'],
  ];
  for (const [name, version, expression, storageClass] of malformedPositions) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        const current = createValidCurrentV3(
          context,
          `storage-${name.replace(/\W+/g, '-').toLowerCase()}`,
        );
        const row = context.db.prepare(`
          SELECT * FROM billing_source_period_versions
          WHERE periodId = ? AND version = ?
        `).get(context.authority.candidate.periodId, version);
        const observed = setRawPeriodSemanticVersion(context, row.id, expression);
        assert.equal(observed.storageClass, storageClass);
        assertOperationalIntegrityFailure(
          context,
          current.command,
          'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
        );
      } finally {
        context.db.close();
      }
    });
  }

  await t.test('INTEGER 2 is a valid storage control', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'storage-integer-control');
      const middle = context.db.prepare(`
        SELECT id FROM billing_source_period_versions
        WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      const observed = setRawPeriodSemanticVersion(context, middle.id, '2');
      assert.deepEqual(
        [observed.storageClass, observed.jsType, observed.jsValue],
        ['integer', 'number', 2],
      );
      const result = context.eligibilityService.produceEligibleEvent(current.command);
      assert.equal(result.replayed, false);
    } finally {
      context.db.close();
    }
  });

  await t.test('maximum safe INTEGER reaches semantic lifecycle validation without coercion', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'storage-max-safe');
      const middle = context.db.prepare(`
        SELECT id FROM billing_source_period_versions
        WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      const observed = setRawPeriodSemanticVersion(context, middle.id, '9007199254740991');
      assert.deepEqual(
        [observed.storageClass, observed.jsType, observed.jsValue],
        ['integer', 'number', Number.MAX_SAFE_INTEGER],
      );
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', current.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('TEXT input converted by INTEGER affinity is classified by persisted storage', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'storage-text-affinity');
      const middle = context.db.prepare(`
        SELECT id FROM billing_source_period_versions
        WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      const observed = setRawPeriodSemanticVersion(context, middle.id, "'02'", {
        permissive: false,
      });
      assert.deepEqual(
        [observed.storageClass, observed.jsType, observed.jsValue],
        ['integer', 'number', 2],
      );
      const result = context.eligibilityService.produceEligibleEvent(current.command);
      assert.equal(result.replayed, false);
    } finally {
      context.db.close();
    }
  });

  await t.test('REAL expression converted by INTEGER affinity is classified by persisted storage', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'storage-real-affinity');
      const middle = context.db.prepare(`
        SELECT id FROM billing_source_period_versions
        WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      const observed = setRawPeriodSemanticVersion(context, middle.id, 'CAST(2.0 AS REAL)', {
        permissive: false,
      });
      assert.deepEqual(
        [observed.storageClass, observed.jsType, observed.jsValue],
        ['integer', 'number', 2],
      );
      const result = context.eligibilityService.produceEligibleEvent(current.command);
      assert.equal(result.replayed, false);
    } finally {
      context.db.close();
    }
  });

  await t.test('duplicate after apparent numeric coercion remains a business lineage denial', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'storage-coerced-duplicate');
      const middle = context.db.prepare(`
        SELECT id FROM billing_source_period_versions
        WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      const observed = setRawPeriodSemanticVersion(
        context,
        middle.id,
        "CAST('3' AS INTEGER)",
      );
      assert.deepEqual([observed.storageClass, observed.jsValue], ['integer', 3]);
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', current.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('version gap represented as TEXT fails type integrity before lineage classification', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'storage-text-gap');
      const middle = context.db.prepare(`
        SELECT id FROM billing_source_period_versions
        WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      const observed = setRawPeriodSemanticVersion(context, middle.id, "CAST('4' AS TEXT)");
      assert.equal(observed.storageClass, 'text');
      assertOperationalIntegrityFailure(
        context,
        current.command,
        'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('exact replay never precedes malformed persisted storage validation', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'storage-replay');
      context.eligibilityService.produceEligibleEvent(current.command);
      const middle = context.db.prepare(`
        SELECT id FROM billing_source_period_versions
        WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      setRawPeriodSemanticVersion(context, middle.id, 'CAST(2.5 AS REAL)');
      assertOperationalIntegrityFailure(
        context,
        current.command,
        'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
        { events: 1, conflicts: 0, transitions: 0, receivables: 0, operations: 0 },
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('malformed value after insert rolls back the event and the mutation', () => {
    const context = createPr9aContext();
    const current = createValidCurrentV3(context, 'storage-postinsert');
    const middle = context.db.prepare(`
      SELECT id FROM billing_source_period_versions
      WHERE periodId = ? AND version = 2
    `).get(context.authority.candidate.periodId);
    replacePeriodVersionsWithPermissiveStorage(context);
    const restore = installAfterEventInsertMutation(context.db, () => {
      context.db.exec(`
        UPDATE billing_source_period_versions
        SET version = CAST(2.5 AS REAL)
        WHERE id = '${middle.id.replaceAll("'", "''")}'
      `);
    });
    try {
      assertOperationalIntegrityFailure(
        context,
        current.command,
        'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
      );
      const observed = context.db.prepare(`
        SELECT version, typeof(version) AS storageClass
        FROM billing_source_period_versions WHERE id = ?
      `).get(middle.id);
      assert.deepEqual([observed.version, observed.storageClass], [2, 'integer']);
    } finally {
      restore();
      context.db.close();
    }
  });

  await t.test('malformed storage has precedence over an independent PR8 mismatch', () => {
    const context = createPr9aContext();
    try {
      const current = createValidCurrentV3(context, 'storage-pr8-precedence');
      mutateCandidateForConflict(context);
      const middle = context.db.prepare(`
        SELECT id FROM billing_source_period_versions
        WHERE periodId = ? AND version = 2
      `).get(context.authority.candidate.periodId);
      setRawPeriodSemanticVersion(context, middle.id, 'CAST(2.5 AS REAL)');
      assertOperationalIntegrityFailure(
        context,
        current.command,
        'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
      );
    } finally {
      context.db.close();
    }
  });
});

test('P1-01 PR8 authoritative economic-content binding RED contract', async t => {
  const mutations = [
    {
      name: 'rateAmountMinor drift',
      sourceKind: 'billing_source_effective_terms',
      field: 'rateAmountMinor',
      value: row => Number(row.rateAmountMinor) + 1,
    },
    {
      name: 'currency drift',
      sourceKind: 'billing_source_effective_terms',
      field: 'currency',
      value: () => 'USD',
      ignoreChecks: true,
    },
    {
      name: 'billing cycle drift',
      sourceKind: 'billing_source_effective_terms',
      field: 'contractualBillingCycleCode',
      value: () => 'hostile_calendar_cycle',
    },
    {
      name: 'VAT mode drift',
      sourceKind: 'billing_source_effective_terms',
      field: 'vatPolicyRef',
      value: () => 'vat-policy-hostile-v2',
    },
    {
      name: 'calculation basis drift',
      sourceKind: 'billing_source_effective_terms',
      field: 'calculationPolicyRef',
      value: () => 'calculation-policy-hostile-v2',
    },
    {
      name: 'rounding policy drift',
      sourceKind: 'billing_source_effective_terms',
      field: 'roundingPolicyRef',
      value: () => 'rounding-policy-hostile-v2',
    },
    {
      name: 'effective-from boundary drift',
      sourceKind: 'billing_source_effective_terms',
      field: 'effectiveFromDate',
      value: () => '2026-07-31',
    },
    {
      name: 'effective-to boundary drift',
      sourceKind: 'billing_source_effective_terms',
      field: 'effectiveToDateExclusive',
      value: () => '2026-10-02',
    },
    {
      name: 'contract reference drift',
      sourceKind: 'billing_source_rental_lines',
      field: 'contractId',
      value: () => 'contract-hostile-v2',
    },
    {
      name: 'source-system/version/hash drift',
      sourceKind: 'billing_source_effective_terms',
      field: 'sourceSystem/sourceVersion/sourceHash',
      values: row => ({
        sourceSystem: 'hostile_source_adapter',
        sourceVersion: Number(row.sourceVersion) + 1,
        sourceHash: oracleHash({ hostileTermsSource: row.id }),
      }),
    },
    {
      name: 'terms predecessor identity drift',
      sourceKind: 'billing_source_effective_terms',
      field: 'supersedesTermsVersionId',
      value: row => row.id,
    },
    {
      name: 'terms content drift with unchanged ID',
      sourceKind: 'billing_source_effective_terms',
      field: 'discountValue',
      value: () => 1,
      ignoreChecks: true,
    },
  ];

  for (const mutation of mutations) {
    await t.test(mutation.name, () => {
      const context = createPr9aContext();
      try {
        const initial = selectedEffectiveTermsState(context);
        const table = mutation.sourceKind;
        const row = table === 'billing_source_effective_terms'
          ? initial.terms
          : context.db.prepare('SELECT * FROM billing_source_rental_lines WHERE id = ?')
            .get(initial.candidate.rentalLineId);
        const persistedInput = context.db.prepare(`
          SELECT * FROM actual_source_dry_run_inputs
          WHERE runId = ? AND sourceKind = ? AND sourceId = ?
        `).get(context.authority.run.id, table, row.id);
        const changed = {
          ...row,
          ...(mutation.values ? mutation.values(row) : {
            [mutation.field]: mutation.value(row),
          }),
        };
        const oldValue = mutation.values
          ? {
            sourceSystem: row.sourceSystem,
            sourceVersion: row.sourceVersion,
            sourceHash: row.sourceHash,
          }
          : row[mutation.field];
        const newValue = mutation.values
          ? mutation.values(row)
          : changed[mutation.field];
        if (mutation.ignoreChecks) rewriteRowIgnoringChecks(context.db, table, changed);
        else rewriteRowById(context.db, table, changed);
        const authoritative = context.db.prepare(`SELECT * FROM "${table}" WHERE id = ?`).get(row.id);
        const after = selectedEffectiveTermsState(context);
        assert.equal(after.snapshot.id, initial.snapshot.id);
        assert.equal(after.close.id, initial.close.id);
        assert.equal(after.snapshot.effectiveTermsVersionId, initial.snapshot.effectiveTermsVersionId);
        assert.equal(after.close.effectiveTermsVersionId, initial.close.effectiveTermsVersionId);
        assert.equal(
          persistedInput.normalizedInputHash,
          oraclePr8AuthoritativeProjection(table, row).normalizedInputHash,
        );
        assertPr8ContentDriftDenial(context, {
          changedField: mutation.field,
          newValue,
          oldValue,
          persistedInput,
          sourceKind: table,
          sourceRow: authoritative,
        });
      } finally {
        context.db.close();
      }
    });
  }

  await t.test('fully resealed authorization and activation do not bless stale PR8 input', () => {
    const context = createPr9aContext();
    try {
      const initial = selectedEffectiveTermsState(context);
      const changed = {
        ...initial.terms,
        rateAmountMinor: Number(initial.terms.rateAmountMinor) + 1,
      };
      rewriteRowById(context.db, 'billing_source_effective_terms', changed);
      const acceptedRuns = [oracleAcceptedRun(context, context.authority.run.id)];
      resealAcceptance(context, {
        acceptedDryRuns: acceptedRuns.map(row => ({
          dryRunId: row.dryRunId,
          resultHash: row.resultHash,
        })),
        acceptedRuns,
      });
      const persistedInput = context.db.prepare(`
        SELECT * FROM actual_source_dry_run_inputs
        WHERE runId = ? AND sourceKind = 'billing_source_effective_terms' AND sourceId = ?
      `).get(context.authority.run.id, changed.id);
      assertPr8ContentDriftDenial(context, {
        changedField: 'rateAmountMinor',
        newValue: changed.rateAmountMinor,
        oldValue: initial.terms.rateAmountMinor,
        persistedInput,
        sourceKind: 'billing_source_effective_terms',
        sourceRow: changed,
      });
    } finally {
      context.db.close();
    }
  });

  await t.test('existing event cannot replay after authoritative terms content changes', () => {
    const context = createPr9aContext();
    try {
      const command = eligibilityCommand(context);
      const initial = selectedEffectiveTermsState(context);
      context.eligibilityService.produceEligibleEvent(command);
      const changed = {
        ...initial.terms,
        rateAmountMinor: Number(initial.terms.rateAmountMinor) + 1,
      };
      rewriteRowById(context.db, 'billing_source_effective_terms', changed);
      assertPr8ContentDriftDenial(context, {
        changedField: 'rateAmountMinor',
        newValue: changed.rateAmountMinor,
        oldValue: initial.terms.rateAmountMinor,
        persistedInput: initial.input,
        sourceKind: 'billing_source_effective_terms',
        sourceRow: changed,
      }, command, {
        events: 1, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
      });
    } finally {
      context.db.close();
    }
  });

  await t.test('content drift introduced after insert fails the locked reread and rolls back', () => {
    const context = createPr9aContext();
    const initial = selectedEffectiveTermsState(context);
    const changed = {
      ...initial.terms,
      rateAmountMinor: Number(initial.terms.rateAmountMinor) + 1,
    };
    const restore = installAfterEventInsertMutation(context.db, () => {
      rewriteRowById(context.db, 'billing_source_effective_terms', changed);
    });
    try {
      assert.throws(
        () => context.eligibilityService.produceEligibleEvent(eligibilityCommand(context)),
        error => error.code === 'CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED',
      );
      assert.deepEqual(counts(context.db), {
        events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
      });
      assert.equal(
        context.db.prepare('SELECT rateAmountMinor FROM billing_source_effective_terms WHERE id = ?')
          .get(initial.terms.id).rateAmountMinor,
        initial.terms.rateAmountMinor,
      );
    } finally {
      restore();
      context.db.close();
    }
  });

  await t.test('content drift plus candidate corruption retains PR8 mismatch precedence', () => {
    const context = createPr9aContext();
    try {
      const initial = selectedEffectiveTermsState(context);
      const changed = {
        ...initial.terms,
        rateAmountMinor: Number(initial.terms.rateAmountMinor) + 1,
      };
      rewriteRowById(context.db, 'billing_source_effective_terms', changed);
      mutateCandidateForConflict(context);
      assertPr8ContentDriftDenial(context, {
        changedField: 'rateAmountMinor + candidate.dueDateEvidenceRef',
        newValue: changed.rateAmountMinor,
        oldValue: initial.terms.rateAmountMinor,
        persistedInput: initial.input,
        sourceKind: 'billing_source_effective_terms',
        sourceRow: changed,
      });
    } finally {
      context.db.close();
    }
  });

  await t.test('valid authoritative content remains eligible', () => {
    const context = createPr9aContext();
    try {
      const state = selectedEffectiveTermsState(context);
      const authoritative = oraclePr8AuthoritativeProjection(
        'billing_source_effective_terms',
        state.terms,
      );
      assert.equal(authoritative.normalizedInputHash, state.input.normalizedInputHash);
      const result = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      assert.equal(result.replayed, false);
      assert.deepEqual(counts(context.db), {
        events: 1, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
      });
    } finally {
      context.db.close();
    }
  });

  await t.test('a current successor with new content and freshly generated PR8 evidence is eligible', () => {
    const context = createPr9aContext();
    try {
      const initial = selectedEffectiveTermsState(context);
      const successor = appendTermsSuccessor(context, 'fresh-content-control');
      rewriteRowById(context.db, 'billing_source_effective_terms', {
        ...successor,
        rateAmountMinor: Number(successor.rateAmountMinor) + 1,
      });
      rewriteRowById(context.db, 'billing_source_period_versions', {
        ...initial.close,
        effectiveTermsVersionId: successor.id,
      });
      rewriteRowById(context.db, 'billing_source_snapshots', {
        ...initial.snapshot,
        effectiveTermsVersionId: successor.id,
      });
      const accepted = acceptAdditionalPolicyRun(
        context,
        approvedTestPolicyManifest(),
        'fresh-terms-successor',
      );
      const acceptedRuns = [oracleAcceptedRun(context, accepted.selectedRun.id)];
      resealAcceptance(context, {
        acceptedDryRuns: acceptedRuns.map(row => ({
          dryRunId: row.dryRunId,
          resultHash: row.resultHash,
        })),
        acceptedRuns,
      });
      resealAcceptedPolicyManifestSet(context, [accepted.selectedRun.policyManifestHash]);
      const termsInput = context.db.prepare(`
        SELECT * FROM actual_source_dry_run_inputs
        WHERE runId = ? AND sourceKind = 'billing_source_effective_terms' AND sourceId = ?
      `).get(accepted.selectedRun.id, successor.id);
      const currentTerms = context.db.prepare(`
        SELECT * FROM billing_source_effective_terms WHERE id = ?
      `).get(successor.id);
      assert.equal(
        termsInput.normalizedInputHash,
        oraclePr8AuthoritativeProjection(
          'billing_source_effective_terms',
          currentTerms,
        ).normalizedInputHash,
      );
      const result = context.eligibilityService.produceEligibleEvent(accepted.command);
      assert.equal(result.replayed, false);
    } finally {
      context.db.close();
    }
  });
});

test('P1-02 full PR6 persisted storage preflight RED contract', async t => {
  const fullIntegerStorageMatrix = {
    billing_source_activation_boundaries: ['schemaVersion'],
    billing_source_rental_lines: ['sourceEventVersion', 'schemaVersion'],
    billing_source_effective_terms: [
      'version', 'rateAmountMinor', 'rateQuantityScale', 'contractualBillingCycleVersion',
      'minimumTermQuantity', 'discountValue', 'sourceVersion', 'schemaVersion',
    ],
    billing_source_periods: ['contractualBillingCycleVersion', 'schemaVersion'],
    billing_source_period_versions: [
      'version', 'actorMembershipVersion', 'capabilityCatalogVersion',
      'sourceEventVersion', 'schemaVersion',
    ],
    billing_source_snapshots: [
      'preDiscountNetMinor', 'discountMinor', 'netMinor', 'vatMinor', 'grossMinor',
      'calculationAlgorithmVersion', 'schemaVersion',
    ],
    billing_source_snapshot_evidence: ['sourceVersion', 'sourceEventVersion', 'schemaVersion'],
    billing_source_upds: ['schemaVersion'],
    billing_source_upd_versions: [
      'version', 'actorMembershipVersion', 'capabilityCatalogVersion',
      'sourceEventVersion', 'conductedEvidenceVersion', 'schemaVersion',
    ],
    billing_source_upd_lines: ['schemaVersion'],
    billing_source_upd_line_versions: [
      'version', 'displayPosition', 'quantityValueInteger', 'quantityScale',
      'netMinor', 'vatMinor', 'grossMinor', 'sourceVersion', 'schemaVersion',
    ],
    billing_source_coverage_sets: [
      'version', 'mappingAlgorithmVersion', 'netDeltaMinor', 'vatDeltaMinor',
      'grossDeltaMinor', 'schemaVersion',
    ],
    billing_source_coverage_supersessions: [
      'actorMembershipVersion', 'capabilityCatalogVersion',
      'sourceEventVersion', 'schemaVersion',
    ],
    billing_source_coverage_slices: [
      'allocatedNetMinor', 'allocatedVatMinor', 'allocatedGrossMinor', 'schemaVersion',
    ],
    billing_source_operations: [
      'actorMembershipVersion', 'capabilityCatalogVersion', 'resultVersion', 'schemaVersion',
    ],
    billing_source_audit_events: [
      'aggregateVersion', 'actorMembershipVersion', 'capabilityCatalogVersion', 'schemaVersion',
    ],
  };

  await t.test('repository preflight is ordered before PR8, fingerprint, clock, and replay lookups', () => {
    const source = fs.readFileSync(repositoryPath, 'utf8');
    const producerStart = source.indexOf('function produceEligibleEvent(commandInput)');
    const initialPreflight = source.indexOf(
      'assertPr6PersistedStoragePreflight(db, command);',
      producerStart,
    );
    const clockRead = source.indexOf('const clock = readRepositoryClock();', producerStart);
    const acceptedContext = source.indexOf('const context = loadAcceptedContext(', producerStart);
    const replayLookup = source.indexOf(
      `SELECT * FROM \${ACTUAL_RECEIVABLE_ELIGIBLE_EVENTS_TABLE}`,
      acceptedContext,
    );
    const insert = source.indexOf('insertExact(', acceptedContext);
    const lockedPreflight = source.indexOf(
      'assertPr6PersistedStoragePreflight(db, command);',
      initialPreflight + 1,
    );
    const lockedReread = source.indexOf('const refreshedContext = loadAcceptedContext(', insert);
    assert.ok(
      producerStart >= 0
      && initialPreflight > producerStart
      && clockRead > initialPreflight
      && acceptedContext > clockRead
      && replayLookup > acceptedContext
      && insert > replayLookup
      && lockedPreflight > insert
      && lockedReread > lockedPreflight,
    );
    assert.equal(
      Object.keys(fullIntegerStorageMatrix).length,
      16,
    );
    for (const [table, columns] of Object.entries(fullIntegerStorageMatrix)) {
      assert.ok(source.includes(`${table}: Object.freeze({`), table);
      for (const column of columns) {
        assert.match(
          source,
          new RegExp(`\\b${column}: pr6(?:Positive|NonNegative|Signed)Integer\\(`),
          `${table}.${column}`,
        );
      }
    }
  });

  for (const [table, columns] of Object.entries(fullIntegerStorageMatrix)) {
    await t.test(`${table} validates every strict INTEGER column by SQLite storage class`, () => {
      const context = createPr9aContext();
      try {
        const seededCorrection = table === 'billing_source_coverage_supersessions';
        if (seededCorrection) {
          appendConductedSourceCorrection(context, 'storage-matrix-supersession', {
            conduct: false,
          });
        }
        const selectedRows = Object.fromEntries(columns.map(column => {
          const row = context.db.prepare(`
            SELECT id, "${column}" AS value
            FROM "${table}"
            WHERE companyId = ? AND branchId = ? AND "${column}" IS NOT NULL
            ORDER BY id ASC
            LIMIT 1
          `).get(
            context.authority.candidate.companyId,
            context.authority.candidate.branchId,
          );
          assert.ok(row, `${table}.${column}`);
          return [column, row];
        }));
        replacePr6TableWithPermissiveStorage(context, table, columns);
        for (const column of columns) {
          const selected = selectedRows[column];
          const observed = setRawPr6Integer(
            context,
            table,
            column,
            selected.id,
            `CAST(${selected.value} AS REAL)`,
            { replace: false },
          );
          assert.equal(observed.storageClass, 'real', `${table}.${column}`);
          assertOperationalIntegrityFailure(
            context,
            eligibilityCommand(context),
            'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
          );
          context.db.prepare(`
            UPDATE "${table}"
            SET "${column}" = CAST(? AS INTEGER)
            WHERE id = ?
          `).run(selected.value, selected.id);
        }
        if (seededCorrection) {
          let error;
          try {
            context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
          } catch (caught) {
            error = caught;
          }
          assert.notEqual(error?.code, 'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID');
        } else {
          const result = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
          assert.equal(result.replayed, false);
        }
      } finally {
        context.db.close();
      }
    });
  }

  const semanticColumns = [
    {
      table: 'billing_source_period_versions',
      column: 'version',
      row: context => context.db.prepare(`
        SELECT * FROM billing_source_period_versions WHERE id = ?
      `).get(context.authority.candidate.closedPeriodVersionId),
    },
    {
      table: 'billing_source_effective_terms',
      column: 'version',
      row: context => selectedEffectiveTermsState(context).terms,
    },
    {
      table: 'billing_source_upd_versions',
      column: 'version',
      row: context => context.db.prepare(`
        SELECT * FROM billing_source_upd_versions WHERE id = ?
      `).get(context.authority.candidate.currentConductedUpdVersionId),
    },
    {
      table: 'billing_source_upd_line_versions',
      column: 'version',
      row: context => context.db.prepare(`
        SELECT * FROM billing_source_upd_line_versions WHERE id = ?
      `).get(context.authority.candidate.updLineVersionId),
    },
    {
      table: 'billing_source_coverage_sets',
      column: 'version',
      row: context => context.db.prepare(`
        SELECT * FROM billing_source_coverage_sets WHERE id = ?
      `).get(context.authority.candidate.coverageSetId),
    },
    {
      table: 'billing_source_operations',
      column: 'resultVersion',
      row: context => context.db.prepare(`
        SELECT operation.* FROM billing_source_operations AS operation
        JOIN billing_source_coverage_sets AS coverage ON coverage.operationId = operation.id
        WHERE coverage.id = ?
      `).get(context.authority.candidate.coverageSetId),
    },
    {
      table: 'billing_source_audit_events',
      column: 'aggregateVersion',
      row: context => context.db.prepare(`
        SELECT audit.* FROM billing_source_audit_events AS audit
        JOIN billing_source_coverage_sets AS coverage ON coverage.operationId = audit.operationId
        WHERE coverage.id = ?
      `).get(context.authority.candidate.coverageSetId),
    },
  ];
  const invalidRepresentations = [
    ['REAL 1.0', 'CAST(1.0 AS REAL)', 'real'],
    ['REAL 1.5', 'CAST(1.5 AS REAL)', 'real'],
    ['TEXT "1"', "CAST('1' AS TEXT)", 'text'],
    ['TEXT "01"', "CAST('01' AS TEXT)", 'text'],
    ['TEXT "1e0"', "CAST('1e0' AS TEXT)", 'text'],
    ['BLOB', "x'31'", 'blob'],
    ['NULL', 'NULL', 'null'],
    ['zero', '0', 'integer'],
    ['negative', '-1', 'integer'],
    ['above max safe', '9007199254740992', 'integer'],
  ];

  for (const spec of semanticColumns) {
    await t.test(`${spec.table}.${spec.column} rejects every non-canonical representation before DML`, () => {
      const context = createPr9aContext();
      try {
        const selected = spec.row(context);
        assert.ok(selected);
        const originalValue = selected[spec.column];
        replacePr6TableWithPermissiveStorage(context, spec.table, [spec.column]);
        for (const [name, expression, storageClass] of invalidRepresentations) {
          const observed = setRawPr6Integer(
            context,
            spec.table,
            spec.column,
            selected.id,
            expression,
            { replace: false },
          );
          assert.equal(observed.storageClass, storageClass, `${spec.table}.${spec.column}:${name}`);
          assertOperationalIntegrityFailure(
            context,
            eligibilityCommand(context),
            'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
          );
          context.db.prepare(`
            UPDATE "${spec.table}"
            SET "${spec.column}" = CAST(? AS INTEGER)
            WHERE id = ?
          `).run(originalValue, selected.id);
        }
        const restored = context.db.prepare(`
          SELECT "${spec.column}" AS value, typeof("${spec.column}") AS storageClass
          FROM "${spec.table}" WHERE id = ?
        `).get(selected.id);
        assert.deepEqual([restored.value, restored.storageClass], [originalValue, 'integer']);
        const result = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
        assert.equal(result.replayed, false);
        const maxSafe = setRawPr6Integer(
          context,
          spec.table,
          spec.column,
          selected.id,
          '9007199254740991',
          { replace: false },
        );
        assert.deepEqual(
          [maxSafe.storageClass, maxSafe.jsType, maxSafe.jsValue],
          ['integer', 'number', Number.MAX_SAFE_INTEGER],
        );
        mutateCandidateForConflict(context);
        assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
      } finally {
        context.db.close();
      }
    });
  }

  await t.test('invalid disconnected same-scope terms row is rejected', () => {
    const context = createPr9aContext();
    try {
      const original = selectedEffectiveTermsState(context).terms;
      replacePr6TableWithPermissiveStorage(
        context,
        'billing_source_effective_terms',
        ['version'],
      );
      const disconnected = {
        ...original,
        id: 'disconnected-same-scope-terms-storage',
        rentalLineId: 'disconnected-same-scope-rental-line',
        version: 1,
        sourceRef: 'disconnected-same-scope-source',
      };
      insertCopiedRow(context.db, 'billing_source_effective_terms', disconnected);
      const observed = setRawPr6Integer(
        context,
        'billing_source_effective_terms',
        'version',
        disconnected.id,
        'CAST(1.0 AS REAL)',
        { replace: false },
      );
      assert.equal(observed.storageClass, 'real');
      assertOperationalIntegrityFailure(
        context,
        eligibilityCommand(context),
        'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('invalid foreign-scope terms row does not block the selected branch', () => {
    const context = createPr9aContext();
    try {
      const original = selectedEffectiveTermsState(context).terms;
      replacePr6TableWithPermissiveStorage(
        context,
        'billing_source_effective_terms',
        ['version'],
      );
      const foreign = {
        ...original,
        id: 'foreign-scope-terms-storage',
        companyId: 'foreign-company',
        branchId: 'foreign-branch',
        rentalLineId: 'foreign-rental-line',
        version: 1,
        sourceRef: 'foreign-scope-source',
      };
      insertCopiedRow(context.db, 'billing_source_effective_terms', foreign);
      const observed = setRawPr6Integer(
        context,
        'billing_source_effective_terms',
        'version',
        foreign.id,
        'CAST(1.0 AS REAL)',
        { replace: false },
      );
      assert.equal(observed.storageClass, 'real');
      const result = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      assert.equal(result.replayed, false);
    } finally {
      context.db.close();
    }
  });

  await t.test('invalid storage has precedence over PR8 candidate corruption', () => {
    const context = createPr9aContext();
    try {
      const terms = selectedEffectiveTermsState(context).terms;
      setRawPr6Integer(
        context,
        'billing_source_effective_terms',
        'version',
        terms.id,
        'CAST(1.0 AS REAL)',
      );
      mutateCandidateForConflict(context);
      assertOperationalIntegrityFailure(
        context,
        eligibilityCommand(context),
        'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('invalid storage has precedence over an invalid billing-period lifecycle', () => {
    const context = createPr9aContext();
    try {
      const terms = selectedEffectiveTermsState(context).terms;
      appendRawPeriodVersion(context, {
        id: 'hostile-storage-plus-lifecycle-reopen',
        suffix: 'storage-plus-lifecycle',
      });
      setRawPr6Integer(
        context,
        'billing_source_effective_terms',
        'version',
        terms.id,
        'CAST(1.0 AS REAL)',
      );
      assertOperationalIntegrityFailure(
        context,
        eligibilityCommand(context),
        'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('invalid storage is checked before replay lookup after an existing event', () => {
    const context = createPr9aContext();
    try {
      const command = eligibilityCommand(context);
      const terms = selectedEffectiveTermsState(context).terms;
      context.eligibilityService.produceEligibleEvent(command);
      setRawPr6Integer(
        context,
        'billing_source_effective_terms',
        'version',
        terms.id,
        'CAST(1.0 AS REAL)',
      );
      assertOperationalIntegrityFailure(
        context,
        command,
        'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
        { events: 1, conflicts: 0, transitions: 0, receivables: 0, operations: 0 },
      );
    } finally {
      context.db.close();
    }
  });

  await t.test('invalid storage introduced after insert is detected by locked reread and rolled back', () => {
    const context = createPr9aContext();
    const terms = selectedEffectiveTermsState(context).terms;
    replacePr6TableWithPermissiveStorage(
      context,
      'billing_source_effective_terms',
      ['version'],
    );
    const restore = installAfterEventInsertMutation(context.db, () => {
      setRawPr6Integer(
        context,
        'billing_source_effective_terms',
        'version',
        terms.id,
        'CAST(1.0 AS REAL)',
        { replace: false },
      );
    });
    try {
      assertOperationalIntegrityFailure(
        context,
        eligibilityCommand(context),
        'CANONICAL_PR6_PERSISTED_ROW_TYPE_INVALID',
      );
      const restored = context.db.prepare(`
        SELECT version, typeof(version) AS storageClass
        FROM billing_source_effective_terms WHERE id = ?
      `).get(terms.id);
      assert.deepEqual([restored.version, restored.storageClass], [terms.version, 'integer']);
    } finally {
      restore();
      context.db.close();
    }
  });
});

test('P1 effective-terms remediation adversarial self-audit after green proof', async t => {
  await t.test('correct terms ID with a wrong persisted rental-line owner is denied', () => {
    const context = createPr9aContext();
    try {
      const edge = insertForeignTermsIdentity(context, 'audit-wrong-owner', {
        bindClose: false,
        bindSnapshot: false,
      });
      rewriteRowById(context.db, 'billing_source_effective_terms', {
        ...edge.originalTerms,
        rentalLineId: edge.foreignRentalLine.id,
        supersedesTermsVersionId: edge.foreignTerms.id,
        version: 2,
      });
      assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
    } finally {
      context.db.close();
    }
  });

  await t.test('correct rental line with period billing semantics drift is denied', () => {
    const context = createPr9aContext();
    try {
      const period = context.db.prepare(`
        SELECT * FROM billing_source_periods WHERE id = ?
      `).get(context.authority.candidate.periodId);
      rewriteRowById(context.db, 'billing_source_periods', {
        ...period,
        contractualBillingCycleCode: 'hostile_period_cycle',
      });
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
    } finally {
      context.db.close();
    }
  });

  await t.test('foreign persisted identity with byte-equal labels and source hash is denied', () => {
    const context = createPr9aContext();
    try {
      const accepted = acceptForeignTermsIdentity(context, 'audit-foreign-identity');
      assert.equal(accepted.foreignTerms.sourceRef, accepted.originalTerms.sourceRef);
      assert.equal(accepted.foreignTerms.sourceHash, accepted.originalTerms.sourceHash);
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', accepted.command);
    } finally {
      context.db.close();
    }
  });

  await t.test('stale terms revision after an existing event blocks exact replay', () => {
    const context = createPr9aContext();
    try {
      const command = eligibilityCommand(context);
      context.eligibilityService.produceEligibleEvent(command);
      appendTermsSuccessor(context, 'audit-stale-after-event');
      assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION', command);
      assert.deepEqual(counts(context.db), {
        events: 1, conflicts: 1, transitions: 1, receivables: 0, operations: 0,
      });
    } finally {
      context.db.close();
    }
  });

  await t.test('close and snapshot terms divergence after insert rolls back atomically', () => {
    const context = createPr9aContext();
    const edge = insertForeignTermsIdentity(context, 'audit-postinsert-divergence', {
      bindClose: false,
      bindSnapshot: false,
    });
    const close = context.db.prepare(`
      SELECT * FROM billing_source_period_versions WHERE id = ?
    `).get(context.authority.candidate.closedPeriodVersionId);
    const restore = installAfterEventInsertMutation(context.db, () => {
      rewriteRowById(context.db, 'billing_source_period_versions', {
        ...close,
        effectiveTermsVersionId: edge.foreignTerms.id,
      });
    });
    try {
      assert.throws(
        () => context.eligibilityRepository.produceEligibleEvent(eligibilityCommand(context)),
        error => error.code === 'CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED',
      );
      assert.deepEqual(counts(context.db), {
        events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
      });
      const after = context.db.prepare(`
        SELECT * FROM billing_source_period_versions WHERE id = ?
      `).get(close.id);
      assert.equal(oracleCanonicalJson(after), oracleCanonicalJson(close));
    } finally {
      restore();
      context.db.close();
    }
  });
});

test('P1-01 hostile billing-period current-state matrix is reconstructed from authoritative PR6 rows', async t => {
  const deniedCases = [
    ['closed to reopened', context => reopenAcceptedBillingPeriod(context, 'matrix-reopen')],
    ['closed to reopened to closed again keeps the old PR8 close non-current', context => {
      const { reopened } = reopenAcceptedBillingPeriod(context, 'matrix-reclose');
      appendRawPeriodVersion(context, {
        baseId: reopened.id,
        eventType: 'closed',
        id: 'hostile-period-reclosed-v3',
        previousVersionId: reopened.id,
        suffix: 'reclosed-v3',
        version: 3,
      });
    }],
    ['two reopen descendants', context => {
      const { reopened } = reopenAcceptedBillingPeriod(context, 'matrix-two-reopens');
      appendRawPeriodVersion(context, {
        baseId: reopened.id,
        id: 'hostile-second-reopen-v3',
        previousVersionId: reopened.id,
        reopensClosedVersionId: context.authority.candidate.closedPeriodVersionId,
        suffix: 'second-reopen-v3',
        version: 3,
      });
    }],
    ['reopen with wrong previousVersionId', context => {
      const foreign = appendForeignPeriodLifecycle(context, 'wrong-previous');
      appendRawPeriodVersion(context, {
        id: 'hostile-wrong-previous-main-reopen',
        previousVersionId: foreign.closed.id,
        reopensClosedVersionId: context.authority.candidate.closedPeriodVersionId,
        suffix: 'wrong-previous-main',
        version: 2,
      });
    }],
    ['latest version id order differs from semantic version order', context => {
      const reopened = appendRawPeriodVersion(context, {
        id: 'zzzz-hostile-period-v2',
        suffix: 'physical-v2',
        version: 2,
      });
      appendRawPeriodVersion(context, {
        baseId: reopened.id,
        eventType: 'closed',
        id: 'aaaa-hostile-period-v3',
        previousVersionId: reopened.id,
        suffix: 'physical-v3',
        version: 3,
      });
      const byId = context.db.prepare(`
        SELECT id FROM billing_source_period_versions
        WHERE periodId = ? ORDER BY id ASC LIMIT 1
      `).get(context.authority.candidate.periodId);
      assert.equal(byId.id, 'aaaa-hostile-period-v3');
    }],
    ['fully resealed authorization and activation still cannot bless stale old PR8 evidence', context => {
      reopenAcceptedBillingPeriod(context, 'matrix-resealed-old-pr8');
      const acceptedRuns = JSON.parse(context.authority.authorization.acceptedPr8EvidenceJson);
      const acceptedDryRuns = JSON.parse(context.authority.authorization.acceptedDryRunsJson);
      const resealed = resealAcceptance(context, { acceptedDryRuns, acceptedRuns });
      const policyHashes = [...new Set(acceptedRuns.map(run => run.policyManifestHash))].sort();
      const policyResealed = resealAcceptedPolicyManifestSet(context, policyHashes);
      assert.equal(resealed.authorization.acceptedPr8EvidenceHash, policyResealed.authorization.acceptedPr8EvidenceHash);
      assert.equal(policyResealed.authorization.recordHash, oracleRecordHash(
        policyResealed.authorization,
        ORACLE_WRITE_AUTHORIZATION_FIELDS,
        'rentcore.canonical_actual_posting.write_authorization',
      ));
      assert.equal(policyResealed.activation.recordHash, oracleRecordHash(
        policyResealed.activation,
        ORACLE_ACTIVATION_FIELDS,
        'rentcore.canonical_actual_posting.activation',
      ));
    }],
    ['competing reopened roots cannot manufacture a latest close', context => {
      appendRawPeriodVersion(context, {
        id: 'hostile-competing-reopen-a',
        suffix: 'competing-a',
        version: 2,
      });
      context.db.exec('DROP INDEX uq_billing_source_period_version');
      appendRawPeriodVersion(context, {
        id: 'hostile-competing-reopen-b',
        suffix: 'competing-b',
        version: 2,
      });
    }],
  ];
  for (const [name, mutate] of deniedCases) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        mutate(context);
        const { observation } = assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
        assert.equal(observation.observedProjection.currentRevisionState, 'missing');
        assert.equal(observation.observedProjection.currentRevisionCount, 0);
        assert.deepEqual(context.db.pragma('foreign_key_check'), []);
      } finally {
        context.db.close();
      }
    });
  }

  await t.test('reopen in a foreign period scope is ignored', () => {
    const context = createPr9aContext();
    try {
      appendForeignPeriodLifecycle(context, 'foreign-scope');
      const result = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      assert.equal(result.replayed, false);
      assert.deepEqual(counts(context.db), {
        events: 1, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
      });
    } finally {
      context.db.close();
    }
  });

  await t.test('audit and operation rows without a period successor are ignored', () => {
    const context = createPr9aContext();
    try {
      const operation = context.db.prepare('SELECT * FROM billing_source_operations ORDER BY id LIMIT 1').get();
      const audit = context.db.prepare(`
        SELECT * FROM billing_source_audit_events WHERE operationId = ?
      `).get(operation.id);
      const copiedOperation = {
        ...operation,
        id: 'hostile-audit-only-operation',
        idempotencyKey: 'hostile-audit-only-idempotency',
      };
      const copiedAudit = {
        ...audit,
        id: 'hostile-audit-only-event',
        operationId: copiedOperation.id,
        aggregateId: context.authority.candidate.periodId,
      };
      context.db.exec('BEGIN');
      insertCopiedRow(context.db, 'billing_source_operations', copiedOperation);
      insertCopiedRow(context.db, 'billing_source_audit_events', copiedAudit);
      context.db.exec('COMMIT');
      const result = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      assert.equal(result.replayed, false);
      assert.equal(counts(context.db).events, 1);
    } finally {
      if (context.db.inTransaction) context.db.exec('ROLLBACK');
      context.db.close();
    }
  });

  await t.test('PR8 evidence mismatch retains precedence over a simultaneous reopen', () => {
    const context = createPr9aContext();
    try {
      reopenAcceptedBillingPeriod(context, 'matrix-precedence');
      mutateCandidateForConflict(context);
      assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
    } finally {
      context.db.close();
    }
  });

  await t.test('semantic reopen validation precedes exact replay lookup', () => {
    const context = createPr9aContext();
    try {
      context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
      reopenAcceptedBillingPeriod(context, 'matrix-after-event-replay');
      const { denial } = assertRequiredDenial(context, 'SOURCE_LINEAGE_NO_CURRENT_REVISION');
      assert.equal(denial.replayed, false);
      assert.deepEqual(counts(context.db), {
        events: 1, conflicts: 1, transitions: 1, receivables: 0, operations: 0,
      });
    } finally {
      context.db.close();
    }
  });
});

test('P1-01 post-insert reread rejects a reopen and rolls back the entire event transaction', () => {
  const context = createPr9aContext();
  const beforePeriodCount = Number(context.db.prepare(`
    SELECT COUNT(*) AS count FROM billing_source_period_versions WHERE periodId = ?
  `).get(context.authority.candidate.periodId).count);
  const restore = installAfterEventInsertMutation(context.db, () => {
    appendRawPeriodVersion(context, {
      id: 'hostile-postinsert-period-reopen',
      suffix: 'postinsert-reopen',
      version: 2,
    });
  });
  try {
    assert.throws(
      () => context.eligibilityRepository.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === 'CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED',
    );
    assert.deepEqual(counts(context.db), {
      events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
    });
    assert.equal(Number(context.db.prepare(`
      SELECT COUNT(*) AS count FROM billing_source_period_versions WHERE periodId = ?
    `).get(context.authority.candidate.periodId).count), beforePeriodCount);
  } finally {
    restore();
    context.db.close();
  }
});

test('P1-02 selected-run policy binding hostile matrix rejects cross-run named identities', async t => {
  const dueDrifts = [
    ['contractual decisionRef drift', {
      decisionRef: 'isolated-test-contractual-due-ref-v2',
    }],
    ['contractual decisionVersion drift', {
      decisionVersion: 2,
    }],
    ['contractual decisionHash drift', {
      decisionHash: oracleHash({ contractualDuePolicy: 'v2' }),
    }],
  ];
  for (const [name, patch] of dueDrifts) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        const manifest = approvedTestPolicyManifest({
          manifestId: `isolated-test-${name.replace(/\W+/g, '-')}`,
          manifestVersion: 2,
          gates: { contractual_due_date: patch },
        });
        const selected = acceptAdditionalPolicyRun(context, manifest, name.replace(/\W+/g, '-'));
        const { observation } = assertRequiredDenial(
          context,
          'DUE_DATE_POLICY_DRIFT',
          selected.command,
        );
        assert.equal(observation.expectedProjection.bindingState, 'valid');
        assert.equal(observation.observedProjection.bindingState, 'ambiguous');
      } finally {
        context.db.close();
      }
    });
  }

  await t.test('unknown-due literal drift is a due-date denial even for a known-due candidate', () => {
    const context = createPr9aContext();
    try {
      const manifest = approvedTestPolicyManifest({
        manifestId: 'isolated-test-unknown-due-literal-v2',
        manifestVersion: 2,
        gates: {
          unknown_due_date_treatment: { decisionValue: 'allow_unknown_with_aging' },
        },
      });
      const selected = acceptAdditionalPolicyRun(context, manifest, 'unknown-due-literal');
      assertRequiredDenial(context, 'DUE_DATE_POLICY_DRIFT', selected.command);
    } finally {
      context.db.close();
    }
  });

  const amountDrifts = [
    ['amount decisionRef drift', { decisionRef: 'isolated-test-amount-ref-v2' }],
    ['amount decisionVersion drift', { decisionVersion: 2 }],
    ['amount decisionHash drift', { decisionHash: oracleHash({ amountBasisPolicy: 'v2' }) }],
    ['amount decisionValue drift', { decisionValue: 'slice_net_minor' }],
  ];
  for (const [name, patch] of amountDrifts) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        const manifest = approvedTestPolicyManifest({
          manifestId: `isolated-test-${name.replace(/\W+/g, '-')}`,
          manifestVersion: 2,
          gates: { canonical_amount_basis: patch },
        });
        const selected = acceptAdditionalPolicyRun(context, manifest, name.replace(/\W+/g, '-'));
        assert.throws(
          () => context.eligibilityService.produceEligibleEvent(selected.command),
          error => error.code === 'CANONICAL_WRITE_AUTHORIZATION_INTEGRITY_FAILED',
        );
        assert.deepEqual(counts(context.db), {
          events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
        });
      } finally {
        context.db.close();
      }
    });
  }

  await t.test('selected run v1 and independently valid activation v2 due policies cannot cross-bind', () => {
    const context = createPr9aContext();
    try {
      const baseline = JSON.parse(context.authority.run.policyManifestJson);
      const activationManifest = approvedTestPolicyManifest({
        manifestId: 'isolated-test-activation-policy-v2',
        manifestVersion: 2,
        gates: {
          contractual_due_date: {
            decisionRef: 'isolated-test-activation-due-v2',
            decisionVersion: 2,
            decisionHash: oracleHash({ activationDuePolicy: 'v2' }),
          },
        },
      });
      const baselineSet = oracleDueDatePolicySetFromManifest(baseline);
      const activationSet = oracleDueDatePolicySetFromManifest(activationManifest);
      const resealed = independentlyResealDueDatePolicies(context, baselineSet, activationSet);
      assert.equal(resealed.authorization.recordHash, oracleRecordHash(
        resealed.authorization,
        ORACLE_WRITE_AUTHORIZATION_FIELDS,
        'rentcore.canonical_actual_posting.write_authorization',
      ));
      assert.equal(resealed.activation.recordHash, oracleRecordHash(
        resealed.activation,
        ORACLE_ACTIVATION_FIELDS,
        'rentcore.canonical_actual_posting.activation',
      ));
      assertRequiredDenial(context, 'DUE_DATE_POLICY_DRIFT');
    } finally {
      context.db.close();
    }
  });

  await t.test('authorization and activation each valid but bound to different accepted runs are denied', () => {
    const context = createPr9aContext();
    try {
      const manifest = approvedTestPolicyManifest({
        manifestId: 'isolated-test-split-binding-v2',
        manifestVersion: 2,
        gates: {
          contractual_due_date: {
            decisionRef: 'isolated-test-split-due-v2',
            decisionVersion: 2,
            decisionHash: oracleHash({ splitDuePolicy: 'v2' }),
          },
        },
      });
      const selected = acceptAdditionalPolicyRun(context, manifest, 'split-binding');
      const baselineSet = oracleDueDatePolicySetFromManifest(
        JSON.parse(context.authority.run.policyManifestJson),
      );
      const selectedSet = oracleDueDatePolicySetFromManifest(manifest);
      independentlyResealDueDatePolicies(context, selectedSet, baselineSet);
      assertRequiredDenial(context, 'DUE_DATE_POLICY_DRIFT', selected.command);
    } finally {
      context.db.close();
    }
  });

  const storedManifestMutations = [
    ['missing named entry', manifest => {
      manifest.gates = manifest.gates.filter(gate => gate.key !== 'contractual_due_date');
    }],
    ['duplicate named entry', manifest => {
      manifest.gates.push({ ...manifest.gates.find(gate => gate.key === 'contractual_due_date') });
    }],
    ['same policyManifestHash label with different logical content', manifest => {
      manifest.gates.find(gate => gate.key === 'contractual_due_date').decisionRef = 'forged-same-label-ref';
    }],
    ['reordered manifest gate membership', manifest => {
      manifest.gates.reverse();
    }],
    ['foreign policy entry', manifest => {
      manifest.gates.push({
        ...manifest.gates[0],
        key: 'foreign_posting_policy',
        decisionRef: 'foreign-posting-policy-v1',
      });
    }],
  ];
  for (const [name, mutate] of storedManifestMutations) {
    await t.test(name, () => {
      const context = createPr9aContext();
      try {
        const run = context.db.prepare('SELECT * FROM actual_source_dry_runs WHERE id = ?')
          .get(context.authority.run.id);
        const manifest = JSON.parse(run.policyManifestJson);
        mutate(manifest);
        mutateAppendOnlyTable(context.db, 'actual_source_dry_runs', () => {
          context.db.prepare(`
            UPDATE actual_source_dry_runs SET policyManifestJson = ? WHERE id = ?
          `).run(oracleCanonicalJson(manifest), run.id);
        });
        assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
      } finally {
        context.db.close();
      }
    });
  }

  await t.test('manifest content from a second run cannot be substituted into the selected first pair', () => {
    const context = createPr9aContext();
    try {
      const secondManifest = approvedTestPolicyManifest({
        manifestId: 'isolated-test-substitution-v2',
        manifestVersion: 2,
        gates: {
          contractual_due_date: {
            decisionRef: 'isolated-test-substitution-due-v2',
            decisionVersion: 2,
            decisionHash: oracleHash({ substitutionDue: 'v2' }),
          },
        },
      });
      const second = context.dryRunService.evaluateActualSourceDryRun(
        context.dryRunContext,
        dryRunCommand({
          idempotencyKey: 'p1-02-manifest-substitution',
          policyManifest: secondManifest,
        }),
      );
      const secondRun = context.db.prepare('SELECT * FROM actual_source_dry_runs WHERE id = ?')
        .get(second.dryRunId);
      mutateAppendOnlyTable(context.db, 'actual_source_dry_runs', () => {
        context.db.prepare(`
          UPDATE actual_source_dry_runs SET policyManifestJson = ? WHERE id = ?
        `).run(secondRun.policyManifestJson, context.authority.run.id);
      });
      assertRequiredDenial(context, 'PR8_EVIDENCE_MISMATCH');
    } finally {
      context.db.close();
    }
  });
});

test('P1-02 post-insert reread rolls back an event when amount policy binding changes', () => {
  const context = createPr9aContext();
  const original = context.db.prepare(`
    SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
  `).get(context.authority.authorization.recordId);
  const restore = installAfterEventInsertMutation(context.db, () => {
    const authorization = context.db.prepare(`
      SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
    `).get(context.authority.authorization.recordId);
    authorization.amountBasisPolicyRef = 'hostile-postinsert-amount-policy';
    authorization.amountBasisPolicyHash = oracleHash({ hostilePostinsertAmountPolicy: true });
    authorization.recordHash = oracleRecordHash(
      authorization,
      ORACLE_WRITE_AUTHORIZATION_FIELDS,
      'rentcore.canonical_actual_posting.write_authorization',
    );
    rewriteWholeRow(context.db, 'canonical_write_authorization_records', authorization);
  });
  try {
    assert.throws(
      () => context.eligibilityRepository.produceEligibleEvent(eligibilityCommand(context)),
      error => error.code === 'CANONICAL_ELIGIBILITY_EVENT_PERSISTENCE_FAILED',
    );
    assert.deepEqual(counts(context.db), {
      events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
    });
    const after = context.db.prepare(`
      SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
    `).get(context.authority.authorization.recordId);
    assert.equal(oracleCanonicalJson(after), oracleCanonicalJson(original));
  } finally {
    restore();
    context.db.close();
  }
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
    assert.equal(calls.length, 2, 'exact event replay consumes one UUID for its own invocation');
    assert.deepEqual(calls, [
      { disableEntropyCache: true },
      { disableEntropyCache: true },
    ]);
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

test('P1-03 UUID cardinality is exact across post-guard failures and pre-entropy guards', () => {
  const fixedUuid = '33333333-3333-4333-8333-333333333333';

  const loadFailure = createPr9aContext();
  try {
    loadFailure.authority.repository.appendAuthorityRecord(nextAuthority(loadFailure.authority.source, 2, {
      status: 'expired',
      revocationReasonCode: 'p1-03-load-context-failure',
    }));
    const calls = [];
    const repository = freshRepositoryWith(loadFailure, () => replaceFunction(crypto, 'randomUUID', options => {
      calls.push(options);
      return fixedUuid;
    }));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(loadFailure)),
      error => error.code === 'AUTHORITY_LATEST_EXPIRED_DESCENDANT_UNREPRESENTABLE_V1',
    );
    assert.deepEqual(calls, [{ disableEntropyCache: true }]);
    assert.deepEqual(counts(loadFailure.db), {
      events: 0, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
    });
  } finally {
    loadFailure.db.close();
  }

  const replayMismatch = createPr9aContext();
  try {
    replayMismatch.eligibilityService.produceEligibleEvent(eligibilityCommand(replayMismatch));
    const event = replayMismatch.db.prepare('SELECT * FROM actual_receivable_eligible_events').get();
    mutateAppendOnlyTable(replayMismatch.db, 'actual_receivable_eligible_events', () => {
      replayMismatch.db.prepare(`
        UPDATE actual_receivable_eligible_events SET eventHash = ? WHERE id = ?
      `).run('0'.repeat(64), event.id);
    });
    const calls = [];
    const repository = freshRepositoryWith(replayMismatch, () => replaceFunction(crypto, 'randomUUID', options => {
      calls.push(options);
      return fixedUuid;
    }));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(replayMismatch)),
      error => error.code === ERROR_CODES.ENVELOPE_INVALID,
    );
    assert.deepEqual(calls, [{ disableEntropyCache: true }]);
    assert.deepEqual(counts(replayMismatch.db), {
      events: 1, conflicts: 0, transitions: 0, receivables: 0, operations: 0,
    });
  } finally {
    replayMismatch.db.close();
  }

  const operationalFailure = createPr9aContext();
  try {
    const authorization = operationalFailure.db.prepare(`
      SELECT * FROM canonical_write_authorization_records WHERE recordId = ?
    `).get(operationalFailure.authority.authorization.recordId);
    authorization.amountBasisPolicyRef = 'p1-03-hostile-amount-policy';
    authorization.amountBasisPolicyHash = oracleHash({ p103: 'amount-policy' });
    authorization.recordHash = oracleRecordHash(
      authorization,
      ORACLE_WRITE_AUTHORIZATION_FIELDS,
      'rentcore.canonical_actual_posting.write_authorization',
    );
    rewriteWholeRow(operationalFailure.db, 'canonical_write_authorization_records', authorization);
    const calls = [];
    const repository = freshRepositoryWith(operationalFailure, () => replaceFunction(crypto, 'randomUUID', options => {
      calls.push(options);
      return fixedUuid;
    }));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(operationalFailure)),
      error => error.code === 'CANONICAL_WRITE_AUTHORIZATION_INTEGRITY_FAILED',
    );
    assert.deepEqual(calls, [{ disableEntropyCache: true }]);
  } finally {
    operationalFailure.db.close();
  }

  const clockFailure = createPr9aContext();
  try {
    const calls = [];
    const repository = freshRepositoryWith(clockFailure, () => {
      const restoreUuid = replaceFunction(crypto, 'randomUUID', options => {
        calls.push(options);
        return fixedUuid;
      });
      const restoreClock = replaceFunction(Date, 'now', () => { throw new Error('p1-03 clock failure'); });
      return () => {
        restoreClock();
        restoreUuid();
      };
    });
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(clockFailure)),
      error => error.code === 'CANONICAL_REPOSITORY_CLOCK_FAILED',
    );
    assert.deepEqual(calls, []);
  } finally {
    clockFailure.db.close();
  }

  const incomplete = createPr9aContext();
  try {
    incomplete.eligibilityService.produceEligibleEvent(eligibilityCommand(incomplete));
    mutateCandidateForConflict(incomplete);
    incomplete.db.exec(`
      CREATE TRIGGER pr9_p103_pending_transition
      BEFORE UPDATE ON canonical_receivable_posting_conflict_transitions
      BEGIN SELECT RAISE(ABORT, 'p1-03 pending transition'); END;
    `);
    assert.throws(
      () => incomplete.eligibilityService.produceEligibleEvent(eligibilityCommand(incomplete)),
      error => error.code === ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED,
    );
    incomplete.db.exec('DROP TRIGGER pr9_p103_pending_transition');
    const calls = [];
    const repository = freshRepositoryWith(incomplete, () => replaceFunction(crypto, 'randomUUID', options => {
      calls.push(options);
      return fixedUuid;
    }));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(incomplete)),
      error => error.code === ERROR_CODES.CONFLICT_TRANSITION_RECOVERY_REQUIRED,
    );
    assert.deepEqual(calls, []);
  } finally {
    incomplete.db.close();
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
    const calls = [];
    const repository = freshRepositoryWith(collision, () => replaceFunction(crypto, 'randomUUID', options => {
      calls.push(options);
      return conflict.denialAttemptId;
    }));
    assert.throws(
      () => repository.produceEligibleEvent(eligibilityCommand(collision)),
      error => error.code === ERROR_CODES.DENIAL_ATTEMPT_ID_COLLISION,
    );
    assert.deepEqual(calls, [{ disableEntropyCache: true }]);
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
