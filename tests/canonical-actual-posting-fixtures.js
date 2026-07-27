import { createRequire } from 'node:module';
import {
  SOURCE_CAPABILITIES,
  hash,
} from './billing-source-authority-fixtures.js';
import {
  approvedTestPolicyManifest,
  dryRunCommand,
  seedPositiveSource,
} from './actual-source-eligibility-dry-run-fixtures.js';

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
  ensureBillingSourceAuthoritySchema,
} = require('../server/lib/billing-source-authority-schema.js');
const {
  ensureForecastReceivablesPlanningSchema,
} = require('../server/lib/forecast-receivables-planning-schema.js');
const {
  ensureActualSourceEligibilityDryRunSchema,
} = require('../server/lib/actual-source-eligibility-dry-run-schema.js');
const {
  ensureCanonicalActualPostingSchema,
} = require('../server/lib/canonical-actual-posting-schema.js');
const {
  createPlatformIdentityRepository,
  createTrustedUserActorContext,
} = require('../server/lib/platform-identity-repository.js');
const {
  resolveTrustedScope,
} = require('../server/lib/platform-authorization.js');
const {
  createBillingSourceCommandContext,
} = require('../server/lib/billing-source-authority-domain.js');
const {
  createBillingSourceAuthorityService,
} = require('../server/lib/billing-source-authority-service.js');
const {
  createActualSourceEligibilityDryRunService,
} = require('../server/lib/actual-source-eligibility-dry-run-service.js');
const {
  createCanonicalActualPostingAuthorityRepository,
} = require('../server/lib/canonical-actual-posting-authority-repository.js');
const {
  createCanonicalActualEligibilityEventService,
} = require('../server/lib/canonical-actual-eligibility-event-service.js');
const {
  createCanonicalActualEligibilityEventRepository,
} = require('../server/lib/canonical-actual-eligibility-event-repository.js');
const {
  canonicalJson,
  canonicalPostingBoundaryEnvelope,
  canonicalPostingCohortEnvelope,
  computeAcceptedDryRunsHash,
  computeAcceptedPr8EvidenceHash,
  computeActivationRecordHash,
  computeAuthorityId,
  computeCanonicalPostingBoundaryHash,
  computeCanonicalPostingCohortHash,
  computeDueDatePolicySetHash,
  computeGovernedAuthorityRecordHash,
  computeUnknownDueDateMappingHash,
  computeWriteAuthorizationRecordHash,
  sha256Canonical,
} = require('../server/lib/canonical-actual-posting-domain.js');

export const PR9_CAPABILITIES = Object.freeze([...SOURCE_CAPABILITIES, 'receivables.read']);

export function initializeSchemas(db) {
  ensureCanonicalReceivablesSchema(db);
  ensureCanonicalReceivablesSettlementSchema(db);
  ensurePlatformIdentitySchema(db);
  ensureBillingSourceAuthoritySchema(db);
  ensureForecastReceivablesPlanningSchema(db);
  ensureActualSourceEligibilityDryRunSchema(db);
  ensureCanonicalActualPostingSchema(db);
}

export function createPr9aSchemaDb({ dbPath = ':memory:' } = {}) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  initializeSchemas(db);
  return db;
}

export function createPr9aContext({ dbPath = ':memory:' } = {}) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE app_data (
      name TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);
  const users = [
    { id: 'U-pr9', status: 'Активен', role: 'Администратор', name: 'Fixture user' },
    { id: 'U-pr9-other', status: 'Активен', role: 'Офис-менеджер', name: 'Other fixture user' },
  ];
  db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)').run('users', JSON.stringify(users));
  initializeSchemas(db);

  const readUsers = () => JSON.parse(db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json);
  let sequence = 0;
  const platformRepository = createPlatformIdentityRepository(db, {
    readUsers,
    nowIso: () => `2026-07-27T10:00:${String(sequence++).padStart(2, '0')}.000Z`,
    generateId: prefix => `${prefix}-pr9-fixture-${++sequence}`,
  });
  const bootstrapActor = createTrustedUserActorContext({
    principalId: 'U-pr9',
    correlationId: 'pr9-fixture-bootstrap',
  });
  platformRepository.createCompanyAuthority({
    company: {
      id: 'company-a',
      displayName: 'Company A',
      receivablesTimezone: 'Europe/Moscow',
    },
    branches: [
      { id: 'branch-a-ho', displayName: 'Head Office', isHeadOffice: true },
      { id: 'branch-a-1', displayName: 'Branch A1', isHeadOffice: false },
    ],
    actorContext: bootstrapActor,
    reason: 'pr9-isolated-fixture',
  });
  platformRepository.createRoleTemplate({
    companyId: 'company-a',
    templateKey: 'pr9-fixture-role',
    templateVersion: 1,
    displayName: 'PR9 fixture role',
    capabilities: PR9_CAPABILITIES,
    actorContext: bootstrapActor,
    reason: 'pr9-isolated-fixture',
  });
  const membership = platformRepository.createMembership({
    id: 'membership-pr9',
    companyId: 'company-a',
    principalId: 'U-pr9',
    status: 'active',
    roleTemplateKey: 'pr9-fixture-role',
    roleTemplateVersion: 1,
    companyWideBranchAuthority: false,
    branchIds: ['branch-a-1'],
    actorContext: bootstrapActor,
    reason: 'pr9-isolated-fixture',
  });
  const platformScope = resolveTrustedScope({
    req: { user: { userId: 'U-pr9' } },
    repository: platformRepository,
    readUsers,
    nowIso: () => '2026-07-27T12:00:00.000Z',
  });
  const commandContext = createBillingSourceCommandContext(platformScope, {
    branchId: 'branch-a-1',
    correlationId: 'pr9-billing-source-fixture',
  });
  const service = createBillingSourceAuthorityService({ db });
  const dryRunService = createActualSourceEligibilityDryRunService({ db });
  const dryRunContext = dryRunService.createCommandContext(platformScope);
  const context = {
    db,
    users,
    readUsers,
    platformRepository,
    platformScope,
    membership,
    commandContext,
    service,
    dryRunService,
    dryRunContext,
  };
  seedPositiveSource(context);
  const dryRun = dryRunService.evaluateActualSourceDryRun(
    dryRunContext,
    dryRunCommand({
      asOfDate: '2026-09-15',
      idempotencyKey: 'pr9-accepted-dry-run',
      policyManifest: approvedTestPolicyManifest(),
    }),
  );
  const authority = seedAuthorityFoundation(context, dryRun.dryRunId);
  const eligibilityRepository = createCanonicalActualEligibilityEventRepository(db);
  const eligibilityService = createCanonicalActualEligibilityEventService({ db });
  return { ...context, dryRun, authority, eligibilityRepository, eligibilityService };
}

export function authorityRecord({ kind, ownershipHash, nowMs = Date.now(), overrides = {} }) {
  const actorId = {
    source_adapter: 'integration:rentcore-source-adapter-fixture',
    eligibility_producer: 'integration:rentcore-actual-receivable-eligibility-producer',
    canonical_posting_adapter: 'integration:rentcore-canonical-receivable-posting',
  }[kind];
  const allowedOperation = {
    source_adapter: 'source_lineage.read.v1',
    eligibility_producer: 'actual_receivable_eligible.append.v1',
    canonical_posting_adapter: 'canonical_receivable.initial_post.v1',
  }[kind];
  const base = {
    recordId: `authority-record-${kind}-v1`,
    authorityId: computeAuthorityId({
      actorId,
      authorityKind: kind,
      branchId: 'branch-a-1',
      companyId: 'company-a',
    }),
    authorityVersion: 1,
    previousRecordId: null,
    authorityKind: kind,
    status: 'authorized',
    environment: 'production',
    actorId,
    companyId: 'company-a',
    branchId: 'branch-a-1',
    sourceSystemIdsJson: canonicalJson(['isolated_test_adapter']),
    sourceRowClassesJson: canonicalJson([...new Set(['conducted_upd_validated_coverage_slice_v1'])]),
    allowedOperation,
    artifactDigest: `${kind}-artifact-fixture-v1`,
    sourceCommitSha: '0123456789abcdef0123456789abcdef01234567',
    configurationHash: hash(`${kind}-configuration`),
    policyHash: hash(`${kind}-policy`),
    sourceOwnershipManifestHash: ownershipHash,
    credentialType: 'none_same_process_repository_owned',
    credentialFingerprint: null,
    credentialIssuerRef: null,
    effectiveFrom: new Date(nowMs - 60 * 60 * 1000).toISOString(),
    expiresAt: new Date(nowMs + 23 * 60 * 60 * 1000).toISOString(),
    ownerRef: `${kind}-owner-fixture`,
    approvalRef: `${kind}-approval-fixture`,
    approvalHash: hash(`${kind}-approval`),
    revocationReasonCode: null,
    schemaVersion: 1,
    createdAt: new Date(nowMs - 60 * 60 * 1000).toISOString(),
    ...overrides,
  };
  base.recordHash = computeGovernedAuthorityRecordHash(base);
  return base;
}

function acceptedEvidence(db, run) {
  const acceptedDryRuns = [{ dryRunId: run.id, resultHash: run.resultHash }];
  const acceptedDryRunsHash = computeAcceptedDryRunsHash(acceptedDryRuns);
  const reconciliationHashes = db.prepare(`
    SELECT reconciliationHash
    FROM actual_source_dry_run_reconciliations
    WHERE runId = ? ORDER BY reconciliationHash
  `).all(run.id).map(row => row.reconciliationHash);
  const reconciliationSetHash = sha256Canonical({
    domain: 'rentcore.canonical_actual_posting.pr8_reconciliation_set',
    dryRunId: run.id,
    reconciliationHashes,
    version: 1,
  });
  const validFrom = run.finalizedAt;
  const validUntilExclusive = new Date(Date.parse(validFrom) + 24 * 60 * 60 * 1000).toISOString();
  const acceptedFreshnessWindowsHash = hash('accepted-freshness-windows-fixture');
  const evidencePackHash = hash('accepted-pr8-evidence-pack-fixture');
  const sourceOwnershipManifestHash = hash('pr9-source-ownership-manifest-fixture');
  const acceptedRuns = [{
    companyTimezoneSnapshot: run.companyTimezone,
    dryRunId: run.id,
    finalizedAt: run.finalizedAt,
    freshnessDurationMs: 24 * 60 * 60 * 1000,
    freshnessPolicyHash: hash('freshness-policy-fixture'),
    freshnessPolicyId: 'freshness-policy-fixture-v1',
    freshnessPolicyVersion: 1,
    freshnessWindowFingerprint: hash('freshness-window-fixture'),
    policyManifestHash: run.policyManifestHash,
    reconciliationSetHash,
    resultHash: run.resultHash,
    sourceInputManifestHash: run.sourceInputManifestHash,
    sourceOwnershipManifestHash,
    validFrom,
    validUntilExclusive,
  }];
  return {
    acceptedDryRuns,
    acceptedDryRunsHash,
    acceptedFreshnessWindowsHash,
    acceptedPr8EvidenceHash: computeAcceptedPr8EvidenceHash({
      acceptedDryRunsHash,
      acceptedFreshnessWindowsHash,
      acceptedRuns,
      evidencePackHash,
    }),
    acceptedRuns,
    evidencePackHash,
    sourceOwnershipManifestHash,
  };
}

export function seedAuthorityFoundation(context, dryRunId) {
  const { db } = context;
  const repository = createCanonicalActualPostingAuthorityRepository(db);
  const run = db.prepare('SELECT * FROM actual_source_dry_runs WHERE id = ?').get(dryRunId);
  const evidence = acceptedEvidence(db, run);
  const nowMs = Date.now();
  const source = authorityRecord({ kind: 'source_adapter', ownershipHash: evidence.sourceOwnershipManifestHash, nowMs });
  const producer = authorityRecord({ kind: 'eligibility_producer', ownershipHash: evidence.sourceOwnershipManifestHash, nowMs });
  const posting = authorityRecord({ kind: 'canonical_posting_adapter', ownershipHash: evidence.sourceOwnershipManifestHash, nowMs });
  repository.appendAuthorityRecord(source);
  repository.appendAuthorityRecord(producer);
  repository.appendAuthorityRecord(posting);

  const candidate = db.prepare('SELECT * FROM actual_source_dry_run_candidates WHERE runId = ?').get(run.id);
  const gates = JSON.parse(run.policyManifestJson).gates;
  const contractual = gates.find(gate => gate.key === 'contractual_due_date');
  const unknown = gates.find(gate => gate.key === 'unknown_due_date_treatment');
  const dueDatePolicySet = {
    contractualDueDate: {
      expectedSourceRef: candidate.dueDateProvenance,
      gateKind: 'contractual_due_date',
      policyHash: contractual.decisionHash,
      policyId: contractual.decisionRef,
      policyVersion: contractual.decisionVersion,
    },
    unknownDueDateTreatment: {
      decisionLiteral: 'allow_unknown_without_aging',
      gateKind: 'unknown_due_date_treatment',
      mappingHash: computeUnknownDueDateMappingHash(),
      mappingId: 'rentcore.unknown_due_date_posting_treatment.v1',
      mappingVersion: 1,
      policyHash: unknown.decisionHash,
      policyId: unknown.decisionRef,
      policyVersion: unknown.decisionVersion,
    },
  };
  const policyManifestHashes = [run.policyManifestHash];
  const cohortInput = {
    allowedDocumentClasses: ['rental_service_upd'],
    allowedRentalClasses: ['equipment_rental_line'],
    branchIds: ['branch-a-1'],
    companyId: 'company-a',
    currency: 'RUB',
    explicitExclusions: [],
    forwardOnlyStartDate: '2026-07-01',
    policyManifestHashes,
    sourceSystems: ['rentcore.billing_source_authority.v1'],
  };
  const boundaryInput = {
    boundaryEndUtc: null,
    branchIds: ['branch-a-1'],
    companyId: 'company-a',
    companyTimezoneSnapshot: 'Europe/Moscow',
    currency: 'RUB',
    exclusionRules: [],
    forwardOnlyStartDate: '2026-07-01',
    forwardOnlyStartUtc: '2026-06-30T21:00:00.000Z',
    sourceSystems: ['rentcore.billing_source_authority.v1'],
  };
  canonicalPostingCohortEnvelope(cohortInput);
  canonicalPostingBoundaryEnvelope(boundaryInput);
  const activationBoundary = db.prepare('SELECT * FROM billing_source_activation_boundaries LIMIT 1').get();
  const effectiveFrom = new Date(nowMs - 60 * 60 * 1000).toISOString();
  const expiresAt = new Date(nowMs + 23 * 60 * 60 * 1000).toISOString();
  const authorization = {
    recordId: 'write-authorization-record-v1',
    authorizationId: 'canonical-write-authorization-fixture',
    authorizationVersion: 1,
    previousRecordId: null,
    status: 'authorized',
    companyId: 'company-a',
    branchId: 'branch-a-1',
    activationBoundaryId: activationBoundary.id,
    activationCohortRef: 'pr9-fixture-cohort-v1',
    cohortHash: computeCanonicalPostingCohortHash(cohortInput),
    boundaryHash: computeCanonicalPostingBoundaryHash(boundaryInput),
    sourceSystemIdsJson: canonicalJson(['rentcore.billing_source_authority.v1']),
    sourceAdapterAuthorityRecordId: source.recordId,
    sourceAdapterAuthorityVersion: source.authorityVersion,
    sourceAdapterAuthorityRecordHash: source.recordHash,
    sourceOwnershipManifestHash: evidence.sourceOwnershipManifestHash,
    producerAuthorityRecordId: producer.recordId,
    producerAuthorityVersion: producer.authorityVersion,
    producerAuthorityRecordHash: producer.recordHash,
    producerAuthorityCompanyId: producer.companyId,
    producerAuthorityBranchId: producer.branchId,
    producerAuthorityKind: producer.authorityKind,
    postingAdapterAuthorityRecordId: posting.recordId,
    postingAdapterAuthorityVersion: posting.authorityVersion,
    postingAdapterAuthorityRecordHash: posting.recordHash,
    postingAdapterAuthorityCompanyId: posting.companyId,
    postingAdapterAuthorityBranchId: posting.branchId,
    postingAdapterAuthorityKind: posting.authorityKind,
    eventSchemaVersion: 'ActualReceivableEligibleV1',
    operationType: 'canonical_receivable.initial_post.v1',
    primaryEffectTablesJson: canonicalJson([
      'canonical_receivable_posting_operations', 'canonical_receivables', 'financial_audit_events',
    ]),
    denialEvidenceTable: 'canonical_receivable_posting_conflicts',
    denialEvidencePermission: 'canonical_receivable_posting_conflicts.append_after_denial.v1',
    denialTransitionTable: 'canonical_receivable_posting_conflict_transitions',
    denialTransitionPermission: 'canonical_receivable_posting_conflict_transitions.create_and_advance.v1',
    forbiddenOperationsJson: canonicalJson([
      'adjust', 'allocate', 'backfill', 'cancel', 'correct', 'delete', 'dual_write',
      'refund', 'settle', 'update', 'write_off',
    ]),
    policyManifestHashesJson: canonicalJson(policyManifestHashes),
    evidencePackHash: evidence.evidencePackHash,
    acceptedDryRunsJson: canonicalJson(evidence.acceptedDryRuns),
    acceptedDryRunsHash: evidence.acceptedDryRunsHash,
    acceptedPr8EvidenceJson: canonicalJson(evidence.acceptedRuns),
    acceptedPr8EvidenceHash: evidence.acceptedPr8EvidenceHash,
    acceptedCompanyTimezoneSnapshot: run.companyTimezone,
    acceptedFreshnessWindowsHash: evidence.acceptedFreshnessWindowsHash,
    amountBasisPolicyRef: 'canonical-amount-basis-fixture-v1',
    amountBasisPolicyHash: hash('canonical-amount-basis-fixture'),
    dueDatePolicySetJson: canonicalJson(dueDatePolicySet),
    dueDatePolicySetHash: computeDueDatePolicySetHash(dueDatePolicySet),
    operationalControlRef: 'pr9-operational-control-fixture-v1',
    retentionControlRef: 'pr9-retention-control-fixture-v1',
    backupEvidenceRef: 'pr9-backup-evidence-fixture-v1',
    approvalSetJson: canonicalJson({
      accountantFinance: hash('accountant'),
      independentReconciliationReviewer: hash('reviewer'),
      legal: hash('legal'),
      postingAdapterOwner: hash('posting-owner'),
      producerOwner: hash('producer-owner'),
      product: hash('product'),
      releaseOperations: hash('release'),
      securityIdentity: hash('security'),
      sourceAdapterOwner: hash('source-owner'),
      tax: hash('tax'),
    }),
    effectiveFrom,
    expiresAt,
    revocationReasonCode: null,
    schemaVersion: 1,
    createdAt: effectiveFrom,
  };
  authorization.recordHash = computeWriteAuthorizationRecordHash(authorization);
  repository.appendWriteAuthorizationRecord(authorization);

  const activation = {
    recordId: 'posting-activation-record-v1',
    activationId: 'canonical-posting-activation-fixture',
    activationVersion: 1,
    previousRecordId: null,
    status: 'authorized',
    companyId: 'company-a',
    branchId: 'branch-a-1',
    activationBoundaryId: activationBoundary.id,
    forwardOnlyStartDate: '2026-07-01',
    forwardOnlyStartUtc: '2026-06-30T21:00:00.000Z',
    boundaryEndUtc: null,
    companyTimezoneSnapshot: run.companyTimezone,
    sourceSystemIdsJson: canonicalJson(['rentcore.billing_source_authority.v1']),
    allowedDocumentClassesJson: canonicalJson(['rental_service_upd']),
    allowedRentalClassesJson: canonicalJson(['equipment_rental_line']),
    currency: 'RUB',
    explicitExclusionsJson: canonicalJson([]),
    cohortHash: authorization.cohortHash,
    boundaryHash: authorization.boundaryHash,
    policyManifestHashesJson: authorization.policyManifestHashesJson,
    acceptedDryRunsHash: authorization.acceptedDryRunsHash,
    acceptedPr8EvidenceHash: authorization.acceptedPr8EvidenceHash,
    acceptedFreshnessWindowsHash: authorization.acceptedFreshnessWindowsHash,
    dueDatePolicySetJson: authorization.dueDatePolicySetJson,
    dueDatePolicySetHash: authorization.dueDatePolicySetHash,
    postingAdapterAuthorityRecordId: posting.recordId,
    postingAdapterAuthorityVersion: posting.authorityVersion,
    postingAdapterAuthorityRecordHash: posting.recordHash,
    postingAdapterAuthorityCompanyId: posting.companyId,
    postingAdapterAuthorityBranchId: posting.branchId,
    postingAdapterAuthorityKind: posting.authorityKind,
    writeAuthorizationRecordId: authorization.recordId,
    effectiveFrom,
    expiresAt,
    approvalRef: 'pr9-activation-approval-fixture',
    approvalHash: hash('pr9-activation-approval-fixture'),
    revocationReasonCode: null,
    schemaVersion: 1,
    createdAt: effectiveFrom,
  };
  activation.recordHash = computeActivationRecordHash(activation);
  repository.appendActivationRecord(activation);
  return { repository, source, producer, posting, authorization, activation, run, candidate };
}

export function eligibilityCommand(context, overrides = {}) {
  return {
    activationRecordId: context.authority.activation.recordId,
    branchId: 'branch-a-1',
    candidateId: context.authority.candidate.id,
    companyId: 'company-a',
    dryRunId: context.authority.run.id,
    writeAuthorizationRecordId: context.authority.authorization.recordId,
    ...overrides,
  };
}

export { hash };
