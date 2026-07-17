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
  ensureBillingSourceAuthoritySchema,
} = require('../server/lib/billing-source-authority-schema.js');
const {
  createPlatformIdentityRepository,
  createTrustedUserActorContext,
} = require('../server/lib/platform-identity-repository.js');
const {
  resolveTrustedScope,
} = require('../server/lib/platform-authorization.js');
const {
  createBillingSourceCommandContext,
  sha256,
} = require('../server/lib/billing-source-authority-domain.js');
const {
  createBillingSourceAuthorityService,
} = require('../server/lib/billing-source-authority-service.js');

export const SOURCE_CAPABILITIES = Object.freeze([
  'billing.period.close',
  'billing.period.reopen',
  'upd.form',
  'upd.conduct',
  'upd.correct',
]);

export function hash(value) {
  return sha256(String(value));
}

export function createBillingSourceContext({
  capabilities = SOURCE_CAPABILITIES,
  users = [
    { id: 'U-billing', status: 'Активен', role: 'Администратор', name: 'Legacy label only' },
    { id: 'U-other', status: 'Активен', role: 'Офис-менеджер', name: 'Other user' },
  ],
  dbPath = ':memory:',
  branchIds = ['branch-a-1'],
  companyWideBranchAuthority = false,
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
  db.prepare('INSERT INTO app_data (name, json) VALUES (?, ?)').run('users', JSON.stringify(users));
  ensureCanonicalReceivablesSchema(db);
  ensureCanonicalReceivablesSettlementSchema(db);
  ensurePlatformIdentitySchema(db);
  ensureBillingSourceAuthoritySchema(db);

  const readUsers = () => JSON.parse(
    db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json,
  );
  let sequence = 0;
  const platformRepository = createPlatformIdentityRepository(db, {
    readUsers,
    nowIso: () => `2026-07-17T00:00:${String(sequence++).padStart(2, '0')}.000Z`,
    generateId: prefix => `${prefix}-fixture-${++sequence}`,
  });
  const bootstrapActor = createTrustedUserActorContext({
    principalId: 'U-billing',
    correlationId: 'fixture-bootstrap',
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
      { id: 'branch-a-2', displayName: 'Branch A2', isHeadOffice: false },
    ],
    actorContext: bootstrapActor,
    reason: 'isolated-test-authority',
  });
  platformRepository.createRoleTemplate({
    companyId: 'company-a',
    templateKey: 'billing-source-test',
    templateVersion: 1,
    displayName: 'Billing source test role',
    capabilities,
    actorContext: bootstrapActor,
    reason: 'isolated-test-authority',
  });
  const membership = platformRepository.createMembership({
    id: 'membership-billing',
    companyId: 'company-a',
    principalId: 'U-billing',
    status: 'active',
    roleTemplateKey: 'billing-source-test',
    roleTemplateVersion: 1,
    companyWideBranchAuthority,
    branchIds: companyWideBranchAuthority ? [] : branchIds,
    actorContext: bootstrapActor,
    reason: 'isolated-test-authority',
  });
  const platformScope = resolveTrustedScope({
    req: { user: { userId: 'U-billing' } },
    repository: platformRepository,
    readUsers,
    nowIso: () => '2026-07-17T12:00:00.000Z',
  });
  const commandContext = createBillingSourceCommandContext(platformScope, {
    branchId: branchIds[0] || 'branch-a-1',
    correlationId: 'billing-source-test-correlation',
  });
  const service = createBillingSourceAuthorityService({ db });
  return {
    db,
    users,
    readUsers,
    platformRepository,
    platformScope,
    membership,
    commandContext,
    service,
    close() {
      db.close();
    },
  };
}

export function insertActivationBoundary(context, overrides = {}) {
  const row = {
    id: overrides.id || 'activation-a-1',
    companyId: overrides.companyId || 'company-a',
    branchId: overrides.branchId || 'branch-a-1',
    firstGovernedPeriodStartDate: overrides.firstGovernedPeriodStartDate || '2026-08-01',
    cohortReference: overrides.cohortReference || 'isolated-test-cohort',
    approvalReference: overrides.approvalReference || 'isolated-test-approval',
    approvalFingerprint: overrides.approvalFingerprint || hash('isolated-test-approval'),
    schemaVersion: 1,
    sourceHash: overrides.sourceHash || hash('isolated-test-boundary'),
    createdAt: overrides.createdAt || '2026-07-17T00:00:00.000Z',
  };
  context.db.prepare(`
    INSERT INTO billing_source_activation_boundaries (
      id, companyId, branchId, firstGovernedPeriodStartDate, cohortReference,
      approvalReference, approvalFingerprint, schemaVersion, sourceHash, createdAt
    ) VALUES (
      @id, @companyId, @branchId, @firstGovernedPeriodStartDate, @cohortReference,
      @approvalReference, @approvalFingerprint, @schemaVersion, @sourceHash, @createdAt
    )
  `).run(row);
  return row;
}

export function closePlan(overrides = {}) {
  const periodStartDate = overrides.periodStartDate || '2026-08-01';
  const periodEndDateExclusive = overrides.periodEndDateExclusive || '2026-09-01';
  return {
    operationType: 'close_billing_period',
    idempotencyKey: overrides.idempotencyKey || 'close-period-1',
    expectedPeriodVersion: overrides.expectedPeriodVersion ?? 0,
    sourceEventId: overrides.sourceEventId || 'close-event-1',
    sourceEventVersion: overrides.sourceEventVersion || 1,
    sourceHash: overrides.sourceHash || hash(`close:${overrides.sourceEventId || '1'}`),
    rentalLine: {
      ...(overrides.rentalLineId ? { id: overrides.rentalLineId } : {}),
      rentalId: overrides.rentalId || 'rental-1',
      clientId: overrides.clientId || 'client-1',
      contractId: overrides.contractId === undefined ? 'contract-1' : overrides.contractId,
      equipmentId: overrides.equipmentId === undefined ? 'equipment-1' : overrides.equipmentId,
      activationBoundaryId: overrides.activationBoundaryId || 'activation-a-1',
      sourceSystem: 'isolated_test_adapter',
      sourceRentalRef: overrides.sourceRentalRef || 'rental-source-1',
      sourceLineIdentityKind: overrides.sourceLineIdentityKind || 'source_system_line_id',
      sourceLineRef: overrides.sourceLineRef || 'rental-line-source-1',
      sourceEventId: 'rental-line-event-1',
      sourceEventVersion: 1,
      provenanceHash: overrides.provenanceHash || hash('rental-line-source'),
    },
    effectiveTerms: overrides.effectiveTermsId
      ? { id: overrides.effectiveTermsId }
      : {
          expectedLatestVersion: overrides.expectedLatestTermsVersion ?? 0,
          effectiveFromDate: overrides.termsFrom || '2026-08-01',
          effectiveToDateExclusive: overrides.termsTo || '2026-10-01',
          rateAmountMinor: overrides.rateAmountMinor ?? 100_000,
          rateUnitCode: 'calendar_day',
          rateQuantityScale: 0,
          contractualBillingCycleCode: 'calendar_month',
          contractualBillingCycleVersion: 1,
          minimumTermQuantity: 1,
          minimumTermUnitCode: 'calendar_day',
          discountKind: overrides.discountKind || 'none',
          discountValue: overrides.discountValue ?? 0,
          currency: overrides.currency || 'RUB',
          calculationPolicyRef: 'calculation-policy-test-v1',
          vatPolicyRef: 'vat-policy-test-v1',
          roundingPolicyRef: 'rounding-policy-test-v1',
          policyDecisionRef: 'policy-decision-test-v1',
          policyResolutionStatus: overrides.policyResolutionStatus || 'resolved',
          unresolvedReasonCodes: overrides.unresolvedReasonCodes || [],
          sourceSystem: 'isolated_test_adapter',
          sourceRef: overrides.termsSourceRef || 'terms-source-1',
          sourceVersion: overrides.termsSourceVersion || 1,
          sourceHash: overrides.termsSourceHash || hash(`terms:${overrides.termsSourceVersion || 1}`),
        },
    period: {
      ...(overrides.periodId ? { id: overrides.periodId } : {}),
      contractualBillingCycleCode: 'calendar_month',
      contractualBillingCycleVersion: 1,
      cycleBoundaryEvidenceRef: overrides.cycleBoundaryEvidenceRef || 'cycle-boundary-test-v1',
      periodStartDate,
      periodEndDateExclusive,
    },
    snapshot: {
      currency: overrides.currency || 'RUB',
      preDiscountNetMinor: overrides.preDiscountNetMinor ?? 100_000,
      discountMinor: overrides.discountMinor ?? 0,
      netMinor: overrides.netMinor ?? 100_000,
      vatMinor: overrides.vatMinor ?? 20_000,
      grossMinor: overrides.grossMinor ?? 120_000,
      calculationAlgorithmVersion: overrides.calculationAlgorithmVersion || 1,
      calculationPolicyRef: 'calculation-policy-test-v1',
      vatPolicyRef: 'vat-policy-test-v1',
      roundingPolicyRef: 'rounding-policy-test-v1',
      policyDecisionRef: 'policy-decision-test-v1',
      sourceIntegrityStatus: overrides.sourceIntegrityStatus || 'matched',
      blockerReasonCodes: overrides.blockerReasonCodes || [],
      calculationInputs: overrides.calculationInputs || {
        discountAppliedBeforeVat: true,
        observedQuantityInteger: 31,
        observedQuantityScale: 0,
      },
      evidenceSetHash: overrides.evidenceSetHash || hash('evidence-set-1'),
      sourceHash: overrides.snapshotSourceHash || hash('snapshot-1'),
    },
    evidence: overrides.evidence || [{
      evidenceType: 'rental',
      sourceSystem: 'isolated_test_adapter',
      sourceId: 'rental-source-1',
      sourceVersion: 1,
      sourceEventId: 'rental-evidence-event-1',
      sourceEventVersion: 1,
      coveredStartDate: periodStartDate,
      coveredEndDateExclusive: periodEndDateExclusive,
      authorityStatus: overrides.evidenceAuthorityStatus || 'approved_by_reference',
      authorityPolicyRef: overrides.evidenceAuthorityStatus === 'unresolved' ? null : 'rental-authority-policy-test-v1',
      evidenceHash: hash('rental-evidence-1'),
    }],
    ...(overrides.auditMetadata ? { auditMetadata: overrides.auditMetadata } : {}),
  };
}

export function sourceRows(context) {
  const period = context.db.prepare('SELECT * FROM billing_source_periods ORDER BY createdAt, id').get();
  const periodVersion = context.db.prepare("SELECT * FROM billing_source_period_versions WHERE eventType = 'closed' ORDER BY version DESC").get();
  const snapshot = context.db.prepare('SELECT * FROM billing_source_snapshots ORDER BY createdAt, id').get();
  const rentalLine = context.db.prepare('SELECT * FROM billing_source_rental_lines ORDER BY createdAt, id').get();
  return { period, periodVersion, snapshot, rentalLine };
}

export function formPlan(context, overrides = {}) {
  const source = sourceRows(context);
  const netMinor = overrides.netMinor ?? source.snapshot.netMinor;
  const vatMinor = overrides.vatMinor ?? source.snapshot.vatMinor;
  const grossMinor = overrides.grossMinor ?? source.snapshot.grossMinor;
  const lineRef = overrides.sourceLineRef || 'upd-line-source-1';
  const lines = overrides.lines || [{
    sourceLineRef: lineRef,
    sourceLineIdentityKind: overrides.sourceLineIdentityKind || 'source_system_line_id',
    displayPosition: 1,
    description: 'Display metadata only',
    quantityValueInteger: 1,
    quantityScale: 0,
    unitCode: 'service',
    currency: 'RUB',
    netMinor,
    vatMinor,
    grossMinor,
    vatPolicyRef: 'vat-policy-test-v1',
    roundingPolicyRef: 'rounding-policy-test-v1',
    policyDecisionRef: 'policy-decision-test-v1',
    sourceIntegrityStatus: overrides.lineIntegrityStatus || 'matched',
    blockerReasonCodes: overrides.lineBlockerReasonCodes || [],
    sourceSystem: 'isolated_test_adapter',
    sourceRef: lineRef,
    sourceVersion: 1,
    sourceHash: hash(`upd-line:${lineRef}`),
  }];
  const coverage = overrides.withoutCoverage ? undefined : {
    expectedCoverageVersion: 0,
    supersedesCoverageSetId: null,
    mappingAlgorithmVersion: 1,
    status: overrides.coverageStatus || 'validated',
    netDeltaMinor: overrides.netDeltaMinor ?? 0,
    vatDeltaMinor: overrides.vatDeltaMinor ?? 0,
    grossDeltaMinor: overrides.grossDeltaMinor ?? 0,
    blockerReasonCodes: overrides.coverageBlockerReasonCodes || [],
    slices: overrides.slices || [{
      sourceLineRef: lineRef,
      periodId: source.period.id,
      closedPeriodVersionId: source.periodVersion.id,
      snapshotId: source.snapshot.id,
      sliceStartDate: source.period.periodStartDate,
      sliceEndDateExclusive: source.period.periodEndDateExclusive,
      allocatedNetMinor: netMinor,
      allocatedVatMinor: vatMinor,
      allocatedGrossMinor: grossMinor,
      contractualDueDate: overrides.contractualDueDate === undefined ? '2026-09-10' : overrides.contractualDueDate,
      dueDateProvenance: overrides.dueDateProvenance || 'contractual_payment_due_date',
      dueDateEvidenceRef: overrides.dueDateEvidenceRef === undefined ? 'contract-due-date-test-v1' : overrides.dueDateEvidenceRef,
    }],
  };
  return {
    operationType: 'form_upd',
    idempotencyKey: overrides.idempotencyKey || 'form-upd-1',
    expectedUpdVersion: 0,
    upd: {
      clientId: overrides.clientId || 'client-1',
      contractId: overrides.contractId === undefined ? 'contract-1' : overrides.contractId,
      sourceSystem: 'isolated_test_adapter',
      sourceDocumentRef: overrides.sourceDocumentRef || 'upd-source-1',
      legacyDocumentId: overrides.legacyDocumentId === undefined ? null : overrides.legacyDocumentId,
      documentNumber: overrides.documentNumber || 'UPD-TEST-1',
      documentDate: overrides.documentDate || '2026-09-01',
      currency: 'RUB',
      sourceEventId: 'upd-formed-event-1',
      sourceEventVersion: 1,
      sourceHash: hash('upd-formed-source-1'),
      sourceIntegrityStatus: overrides.updIntegrityStatus || 'matched',
      blockerReasonCodes: overrides.updBlockerReasonCodes || [],
    },
    lines,
    ...(coverage ? { coverage } : {}),
  };
}

export function conductPlan(context, overrides = {}) {
  const upd = context.db.prepare('SELECT * FROM billing_source_upds ORDER BY createdAt, id').get();
  const formed = context.db.prepare("SELECT * FROM billing_source_upd_versions WHERE state = 'formed' ORDER BY version DESC").get();
  return {
    operationType: 'conduct_upd',
    idempotencyKey: overrides.idempotencyKey || 'conduct-upd-1',
    updId: upd.id,
    formedUpdVersionId: formed.id,
    expectedUpdVersion: overrides.expectedUpdVersion || formed.version,
    sourceEventId: overrides.sourceEventId || 'upd-conduct-event-1',
    sourceEventVersion: overrides.sourceEventVersion || 1,
    sourceHash: overrides.sourceHash || hash('upd-conduct-source-1'),
    conductedEvidenceRef: overrides.conductedEvidenceRef || 'accounting-conduct-event-1',
    conductedEvidenceVersion: overrides.conductedEvidenceVersion || 1,
    conductedEvidenceHash: overrides.conductedEvidenceHash || hash('accounting-conduct-event-1'),
    conductedPolicyDecisionRef: overrides.conductedPolicyDecisionRef === undefined
      ? 'conduct-policy-decision-test-v1'
      : overrides.conductedPolicyDecisionRef,
    clientSignatureEvidenceRef: overrides.clientSignatureEvidenceRef === undefined
      ? null
      : overrides.clientSignatureEvidenceRef,
    signatureRequirementPolicyRef: overrides.signatureRequirementPolicyRef === undefined
      ? 'signature-policy-test-v1'
      : overrides.signatureRequirementPolicyRef,
    sourceIntegrityStatus: overrides.sourceIntegrityStatus || 'matched',
    blockerReasonCodes: overrides.blockerReasonCodes || [],
  };
}
