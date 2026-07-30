import { createRequire } from 'node:module';
import {
  SOURCE_CAPABILITIES,
  conductPlan,
  formPlan,
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
  createCanonicalActualPostingRepository,
} = require('../server/lib/canonical-actual-posting-repository.js');
const {
  createCanonicalActualPostingService,
} = require('../server/lib/canonical-actual-posting-service.js');
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
  computeCanonicalPostingCommandFingerprint,
  computeCanonicalEvidenceReadDigest,
  createCanonicalActualPostingRuntimeContract,
  computeDueDatePolicySetHash,
  computeGovernedAuthorityRecordHash,
  computeUnknownDueDateMappingHash,
  computeWriteAuthorizationRecordHash,
  normalizeCanonicalPostingCommand,
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

export function createPr9aContext({ dbPath = ':memory:', authorityNowMs = Date.now() } = {}) {
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
  const authority = seedAuthorityFoundation(context, dryRun.dryRunId, { nowMs: authorityNowMs });
  const runtimeContractInput = runtimeContractForAuthority(authority);
  const runtimeContract = createCanonicalActualPostingRuntimeContract(runtimeContractInput);
  const eligibilityRepository = createCanonicalActualEligibilityEventRepository(db, runtimeContract);
  const eligibilityService = createCanonicalActualEligibilityEventService({ db, runtimeContract });
  return {
    ...context,
    dryRun,
    authority,
    eligibilityRepository,
    eligibilityService,
    runtimeContract,
    runtimeContractInput,
  };
}

export function runtimeContractForAuthority(authority, overrides = {}) {
  const authorities = {};
  for (const [kind, record] of [
    ['source_adapter', authority.source],
    ['eligibility_producer', authority.producer],
    ['canonical_posting_adapter', authority.posting],
  ]) {
    authorities[kind] = {
      artifactDigest: record.artifactDigest,
      configurationHash: record.configurationHash,
      policyHash: record.policyHash,
      sourceCommitSha: record.sourceCommitSha,
      ...(overrides[kind] || {}),
    };
  }
  return { authorities, enabled: true, version: 1 };
}

export function appendConductedSourceCorrection(
  context,
  suffix = 'pr9a-correction',
  { conduct = true } = {},
) {
  const upd = context.db.prepare(`
    SELECT * FROM billing_source_upds ORDER BY createdAt, id LIMIT 1
  `).get();
  const latestUpdVersion = context.db.prepare(`
    SELECT * FROM billing_source_upd_versions
    WHERE updId = ? ORDER BY version DESC, id DESC LIMIT 1
  `).get(upd.id);
  const line = context.db.prepare(`
    SELECT * FROM billing_source_upd_lines WHERE updId = ? ORDER BY id LIMIT 1
  `).get(upd.id);
  const latestLineVersion = context.db.prepare(`
    SELECT * FROM billing_source_upd_line_versions
    WHERE updLineId = ? ORDER BY version DESC, id DESC LIMIT 1
  `).get(line.id);
  const predecessor = context.db.prepare(`
    SELECT coverage.id
    FROM billing_source_coverage_sets AS coverage
    LEFT JOIN billing_source_coverage_supersessions AS successor
      ON successor.originalCoverageSetId = coverage.id
    WHERE coverage.updId = ? AND successor.id IS NULL
    ORDER BY coverage.createdAt, coverage.id LIMIT 1
  `).get(upd.id);
  const replacement = context.service.correctUpd(context.commandContext, {
    operationType: 'correct_upd',
    idempotencyKey: `replace-upd-${suffix}`,
    updId: upd.id,
    expectedUpdVersion: Number(latestUpdVersion.version),
    action: 'replace',
    reasonCode: 'ACCOUNTING_REPLACE',
    reasonText: 'Explicit PR9a correction evidence',
    sourceEventId: `replace-event-${suffix}`,
    sourceEventVersion: 1,
    sourceHash: hash(`replace-event-${suffix}`),
    lines: [{
      id: line.id,
      sourceLineRef: line.sourceLineRef,
      sourceLineIdentityKind: line.sourceLineIdentityKind,
      displayPosition: Number(latestLineVersion.version) + 1,
      description: 'Corrected PR9a source revision',
      quantityValueInteger: 1,
      quantityScale: 0,
      unitCode: 'service',
      currency: 'RUB',
      netMinor: 100_000,
      vatMinor: 20_000,
      grossMinor: 120_000,
      vatPolicyRef: 'vat-policy-test-v1',
      roundingPolicyRef: 'rounding-policy-test-v1',
      policyDecisionRef: 'policy-decision-test-v1',
      sourceIntegrityStatus: 'matched',
      blockerReasonCodes: [],
      sourceSystem: 'isolated_test_adapter',
      sourceRef: line.sourceLineRef,
      sourceVersion: Number(latestLineVersion.version) + 1,
      sourceHash: hash(`replacement-line-${suffix}`),
    }],
    coverage: {
      ...formPlan(context).coverage,
      supersedesCoverageSetIds: [predecessor.id],
    },
  });
  const conducted = conduct ? context.service.conductUpd(context.commandContext, conductPlan(context, {
    conductedEvidenceHash: hash(`conducted-replacement-${suffix}`),
    conductedEvidenceRef: `conducted-replacement-${suffix}`,
    idempotencyKey: `conduct-replacement-${suffix}`,
    sourceEventId: `conduct-replacement-event-${suffix}`,
    sourceHash: hash(`conduct-replacement-event-${suffix}`),
  })) : null;
  return { conducted, replacement };
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
  const freshnessDurationMs = 900000;
  const validUntilExclusive = new Date(Date.parse(validFrom) + freshnessDurationMs).toISOString();
  const freshnessPolicyHash = sha256Canonical({
    domain: 'rentcore.canonical_actual_posting.pr8_freshness_policy',
    durationMs: freshnessDurationMs,
    intervalKind: 'half_open',
    policyId: 'rentcore.pr8_evidence_freshness.v1',
    policyVersion: 1,
    version: 1,
  });
  const freshnessWindowFingerprint = sha256Canonical({
    domain: 'rentcore.canonical_actual_posting.pr8_freshness_window',
    finalizedAt: run.finalizedAt,
    freshnessDurationMs,
    freshnessPolicyHash,
    freshnessPolicyId: 'rentcore.pr8_evidence_freshness.v1',
    freshnessPolicyVersion: 1,
    validFrom,
    validUntilExclusive,
    version: 1,
  });
  const evidencePackHash = hash('accepted-pr8-evidence-pack-fixture');
  const sourceOwnershipManifestHash = hash('pr9-source-ownership-manifest-fixture');
  const acceptedRuns = [{
    companyTimezoneSnapshot: run.companyTimezone,
    dryRunId: run.id,
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
    sourceOwnershipManifestHash,
    validFrom,
    validUntilExclusive,
  }];
  const acceptedFreshnessWindowsHash = sha256Canonical({
    domain: 'rentcore.canonical_actual_posting.accepted_freshness_windows',
    windows: acceptedRuns.map(entry => ({
      dryRunId: entry.dryRunId,
      freshnessWindowFingerprint: entry.freshnessWindowFingerprint,
    })),
    version: 1,
  });
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

export function seedAuthorityFoundation(
  context,
  dryRunId,
  { nowMs = Date.parse('2026-07-27T12:00:00.000Z') } = {},
) {
  const { db } = context;
  const repository = createCanonicalActualPostingAuthorityRepository(db);
  const run = db.prepare('SELECT * FROM actual_source_dry_runs WHERE id = ?').get(dryRunId);
  const evidence = acceptedEvidence(db, run);
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
  const amount = gates.find(gate => gate.key === 'canonical_amount_basis');
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
    amountBasisPolicyRef: amount.decisionRef,
    amountBasisPolicyHash: amount.decisionHash,
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

export function postingCommand(context, event = context.event, overrides = {}) {
  return {
    companyId: event.companyId,
    branchId: event.branchId,
    eventId: event.id,
    operationType: 'canonical_receivable.initial_post.v1',
    assertedEventHash: event.eventHash,
    assertedWriteAuthorizationRecordId: event.writeAuthorizationRecordId,
    requestedActivationRecordId: event.activationRecordId,
    requestedSourceAdapterAuthorityRecordId: event.sourceAdapterAuthorityRecordId,
    requestedPostingAdapterAuthorityRecordId: context.authority.posting.recordId,
    requestedPostingAdapterAuthorityVersion: context.authority.posting.authorityVersion,
    requestedPostingAdapterAuthorityRecordHash: context.authority.posting.recordHash,
    assertedDueDatePolicySetHash: event.dueDatePolicySetHash,
    assertedSelectedDueDateGateKind: event.selectedDueDateGateKind,
    assertedSelectedDueDatePolicyId: event.selectedDueDatePolicyId,
    assertedSelectedDueDatePolicyVersion: event.selectedDueDatePolicyVersion,
    assertedSelectedDueDatePolicyHash: event.selectedDueDatePolicyHash,
    assertedDueDateTreatment: event.dueDateTreatment,
    assertedUnknownDueDateTreatmentMappingId: event.unknownDueDateTreatmentMappingId,
    assertedUnknownDueDateTreatmentMappingVersion: event.unknownDueDateTreatmentMappingVersion,
    assertedUnknownDueDateTreatmentMappingHash: event.unknownDueDateTreatmentMappingHash,
    ...overrides,
  };
}

export function createPr9bContext(options = {}) {
  const context = createPr9aContext(options);
  const eventResult = context.eligibilityService.produceEligibleEvent(eligibilityCommand(context));
  const postingRepository = createCanonicalActualPostingRepository(context.db, context.runtimeContract);
  const postingService = createCanonicalActualPostingService({
    db: context.db,
    runtimeContract: context.runtimeContract,
  });
  return {
    ...context,
    event: eventResult.event,
    postingRepository,
    postingService,
  };
}

export function createPostingRepositoryForTest(context, dependencies = {}) {
  return createCanonicalActualPostingRepository(
    context.db,
    context.runtimeContract,
    dependencies,
  );
}

export function createEvidenceTrace() {
  const entries = [];
  return Object.freeze({
    digest() {
      const entryDigests = entries.map((entry, index) => ({
        digest: computeCanonicalEvidenceReadDigest([entry]),
        index,
      }));
      return computeCanonicalEvidenceReadDigest(entryDigests);
    },
    entries,
    record(entry) {
      entries.push(entry);
    },
    reset() {
      entries.length = 0;
    },
    snapshot() {
      return JSON.parse(canonicalJson(entries));
    },
  });
}

export function mutateProtectedRow(db, table, setClause, parameters = []) {
  const triggers = db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL
    ORDER BY name
  `).all(table);
  for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`);
  const previousIgnoreChecks = Number(db.pragma('ignore_check_constraints', { simple: true }));
  db.pragma('ignore_check_constraints = ON');
  try {
    db.prepare(`UPDATE "${table}" SET ${setClause}`).run(...parameters);
  } finally {
    db.pragma(`ignore_check_constraints = ${previousIgnoreChecks ? 'ON' : 'OFF'}`);
    for (const trigger of triggers) db.exec(trigger.sql);
  }
}

export function insertProtectedRow(db, table, row) {
  const triggers = db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL
    ORDER BY name
  `).all(table);
  for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`);
  const previousIgnoreChecks = Number(db.pragma('ignore_check_constraints', { simple: true }));
  const previousForeignKeys = Number(db.pragma('foreign_keys', { simple: true }));
  db.pragma('ignore_check_constraints = ON');
  db.pragma('foreign_keys = OFF');
  try {
    const columns = Object.keys(row);
    db.prepare(`
      INSERT INTO "${table}" (${columns.map(column => `"${column}"`).join(', ')})
      VALUES (${columns.map(() => '?').join(', ')})
    `).run(...columns.map(column => row[column]));
  } finally {
    db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
    db.pragma(`ignore_check_constraints = ${previousIgnoreChecks ? 'ON' : 'OFF'}`);
    for (const trigger of triggers) db.exec(trigger.sql);
  }
}

export function deleteProtectedRows(db, table, whereClause, parameters = []) {
  const triggers = db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND tbl_name = ? AND sql IS NOT NULL
    ORDER BY name
  `).all(table);
  for (const trigger of triggers) db.exec(`DROP TRIGGER "${trigger.name}"`);
  const previousForeignKeys = Number(db.pragma('foreign_keys', { simple: true }));
  db.pragma('foreign_keys = OFF');
  try {
    db.prepare(`DELETE FROM "${table}" WHERE ${whereClause}`).run(...parameters);
  } finally {
    db.pragma(`foreign_keys = ${previousForeignKeys ? 'ON' : 'OFF'}`);
    for (const trigger of triggers) db.exec(trigger.sql);
  }
}

export function mutatePr8CandidateForPostingConflict(context, value = 'pr9b-conflict-v2') {
  const trigger = context.db.prepare(`
    SELECT name, sql FROM sqlite_master
    WHERE type = 'trigger' AND name = 'trg_actual_source_dry_run_candidates_no_update'
  `).get();
  context.db.exec(`DROP TRIGGER ${trigger.name}`);
  try {
    context.db.prepare('UPDATE actual_source_dry_run_candidates SET dueDateEvidenceRef = ? WHERE id = ?')
      .run(value, context.authority.candidate.id);
  } finally {
    context.db.exec(trigger.sql);
  }
}

export function appendAuthorityDescendant(context, previous, overrides = {}) {
  const { recordHash: _recordHash, ...previousWithoutHash } = previous;
  const version = Number(previous.authorityVersion) + 1;
  const record = authorityRecord({
    kind: previous.authorityKind,
    ownershipHash: previous.sourceOwnershipManifestHash,
    overrides: {
      ...previousWithoutHash,
      authorityVersion: version,
      createdAt: new Date(Date.now()).toISOString(),
      previousRecordId: previous.recordId,
      recordId: `authority-record-${previous.authorityKind}-v${version}`,
      ...overrides,
    },
  });
  return context.authority.repository.appendAuthorityRecord(record).record;
}

export function totalChanges(db) {
  return Number(db.prepare('SELECT total_changes() AS total').get().total);
}

export function postingGraphSnapshot(db) {
  const tables = [
    'actual_receivable_eligible_events',
    'canonical_receivable_posting_conflicts',
    'canonical_receivable_posting_conflict_transitions',
    'canonical_receivable_posting_operations',
    'canonical_receivables',
    'financial_audit_events',
  ];
  const graph = {};
  for (const table of tables) {
    const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(column => column.name);
    const orderBy = columns.includes('id') ? 'id' : 'transitionId';
    graph[table] = db.prepare(`SELECT * FROM ${table} ORDER BY ${orderBy}`).all();
  }
  return canonicalJson(graph);
}

export function postingEvidenceReadSet(trace) {
  return trace.snapshot();
}

export function postingEvidenceReadDigest(trace) {
  return trace.digest();
}

export function normalizedPostingCommandEvidence(commandInput) {
  const normalized = normalizeCanonicalPostingCommand(commandInput);
  return Object.freeze({
    fingerprint: computeCanonicalPostingCommandFingerprint(normalized),
    normalized,
  });
}

export function createInstrumentedEligibilityRepository(context, dependencies = {}) {
  return createCanonicalActualEligibilityEventRepository(
    context.db,
    context.runtimeContract,
    {
      ...dependencies,
      testOnlyBuildPostingDenialPackage: true,
    },
  );
}

export function createPostingDenialStageFixture(stage, options = {}) {
  const context = createPr9bContext(options);
  mutatePr8CandidateForPostingConflict(context);
  const repository = createInstrumentedEligibilityRepository(context);
  const command = postingCommand(context);
  const seamCommand = {
    assertedDenialCause: 'PR8_EVIDENCE_MISMATCH',
    denialAttemptId: '11111111-1111-4111-8111-111111111111',
    postingCommand: command,
  };
  const deniedAttemptedAt = new Date(Date.now()).toISOString();
  const packageValue = repository.__testBuildPostingDenialPackage({
    deniedAttemptedAt,
    seamCommand,
  });
  const triggerSql = {
    PENDING: `CREATE TRIGGER pr9b_stage_abort BEFORE UPDATE
      ON canonical_receivable_posting_conflict_transitions
      BEGIN SELECT RAISE(ABORT, 'hold PENDING'); END`,
    ACCOUNTED: `CREATE TRIGGER pr9b_stage_abort BEFORE UPDATE
      ON canonical_receivable_posting_conflict_transitions
      WHEN NEW.state = 'CIRCUIT_APPLIED'
      BEGIN SELECT RAISE(ABORT, 'hold ACCOUNTED'); END`,
    CIRCUIT_APPLIED: `CREATE TRIGGER pr9b_stage_abort BEFORE UPDATE
      ON canonical_receivable_posting_conflict_transitions
      WHEN NEW.state = 'COMPLETE'
      BEGIN SELECT RAISE(ABORT, 'hold CIRCUIT_APPLIED'); END`,
  }[stage];
  if (triggerSql) context.db.exec(triggerSql);
  let initialError = null;
  try {
    repository.persistDenialEvidence(packageValue);
  } catch (error) {
    initialError = error;
  } finally {
    if (triggerSql) context.db.exec('DROP TRIGGER pr9b_stage_abort');
  }
  if (stage === 'COMPLETE' && initialError) throw initialError;
  if (stage !== 'COMPLETE' && initialError?.code !== 'CANONICAL_CONFLICT_TRANSITION_RECOVERY_REQUIRED') {
    throw initialError || new Error(`Expected recovery interruption at ${stage}`);
  }
  const transition = context.db.prepare(`
    SELECT * FROM canonical_receivable_posting_conflict_transitions
  `).get();
  if (transition?.state !== stage) throw new Error(`Expected ${stage}, got ${transition?.state}`);
  return {
    ...context,
    command,
    packageValue,
    repository,
    seamCommand,
  };
}

export { canonicalJson, hash };
