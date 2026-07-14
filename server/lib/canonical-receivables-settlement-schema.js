const {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
  CANONICAL_RECEIVABLES_MIGRATION_ID,
  CANONICAL_RECEIVABLES_SCHEMA_VERSION,
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
} = require('./canonical-receivables-schema');

const CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION = 1;
const CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID = 'canonical_receivables_pr2_settlement';

const CANONICAL_PAYMENTS_TABLE = 'canonical_payments';
const CANONICAL_PAYMENT_ALLOCATIONS_TABLE = 'canonical_payment_allocations';
const CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE = 'canonical_receivable_adjustments';
const CANONICAL_APPROVAL_REQUESTS_TABLE = 'canonical_approval_requests';

function assertCanonicalReceivablesPrerequisite(db) {
  const registry = db.prepare(`
    SELECT 1
    FROM sqlite_master
    WHERE type = 'table' AND name = 'sql_shadow_schema_migrations'
  `).get();
  if (!registry) {
    throw new Error(
      `PR2 requires ${CANONICAL_RECEIVABLES_MIGRATION_ID} version ${CANONICAL_RECEIVABLES_SCHEMA_VERSION} before migration`,
    );
  }
  const applied = db.prepare(`
    SELECT version
    FROM sql_shadow_schema_migrations
    WHERE name = ?
  `).get(CANONICAL_RECEIVABLES_MIGRATION_ID);
  const requiredTables = [
    CANONICAL_COMPANIES_TABLE,
    CANONICAL_BRANCHES_TABLE,
    CANONICAL_RECEIVABLES_TABLE,
    FINANCIAL_AUDIT_EVENTS_TABLE,
  ];
  const missingTables = requiredTables.filter(table => !db.prepare(`
    SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?
  `).get(table));
  if (
    Number(applied?.version) < CANONICAL_RECEIVABLES_SCHEMA_VERSION
    || missingTables.length > 0
  ) {
    const missing = missingTables.length > 0 ? `; missing tables: ${missingTables.join(', ')}` : '';
    throw new Error(
      `PR2 requires ${CANONICAL_RECEIVABLES_MIGRATION_ID} version ${CANONICAL_RECEIVABLES_SCHEMA_VERSION}${missing}`,
    );
  }
}

function ensureCanonicalReceivablesSettlementSchema(db) {
  db.pragma('foreign_keys = ON');
  assertCanonicalReceivablesPrerequisite(db);

  const migrate = db.transaction(() => {
    const applied = db.prepare(`
      SELECT version
      FROM sql_shadow_schema_migrations
      WHERE name = ?
    `).get(CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID);
    if (Number(applied?.version) >= CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION) return false;

    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_receivables_company_id
        ON ${CANONICAL_RECEIVABLES_TABLE}(companyId, id);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_receivables_company_id_branch
        ON ${CANONICAL_RECEIVABLES_TABLE}(companyId, id, branchId);

      CREATE TABLE IF NOT EXISTS ${CANONICAL_APPROVAL_REQUESTS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        operationType TEXT NOT NULL,
        aggregateType TEXT NOT NULL,
        aggregateId TEXT NOT NULL,
        initiatedBy TEXT NOT NULL,
        initiatorActorType TEXT NOT NULL DEFAULT 'user',
        requestedAt TEXT NOT NULL,
        approvedBy TEXT,
        approverActorType TEXT,
        approvedAt TEXT,
        rejectedBy TEXT,
        rejectedAt TEXT,
        status TEXT NOT NULL,
        reason TEXT NOT NULL,
        rejectionReason TEXT,
        correlationId TEXT NOT NULL,
        operationPayloadJson TEXT NOT NULL DEFAULT '{}',
        createdAt TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE (companyId, id),
        UNIQUE (companyId, operationType, aggregateType, aggregateId, correlationId),
        FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(id)) > 0),
        CHECK (length(trim(companyId)) > 0),
        CHECK (operationType IN (
          'allocation',
          'allocation_reversal',
          'adjustment',
          'adjustment_reversal',
          'refund',
          'refund_reversal',
          'write_off',
          'due_date_change',
          'posted_receivable_cancellation'
        )),
        CHECK (aggregateType IN ('payment_allocation', 'receivable_adjustment', 'payment', 'receivable')),
        CHECK (length(trim(aggregateId)) > 0),
        CHECK (length(trim(initiatedBy)) > 0),
        CHECK (initiatorActorType IN ('user', 'system', 'integration')),
        CHECK (status IN ('pending', 'approved', 'rejected')),
        CHECK (length(trim(reason)) > 0),
        CHECK (length(trim(correlationId)) > 0),
        CHECK (json_valid(operationPayloadJson)),
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (
          (status = 'pending'
            AND approvedBy IS NULL AND approvedAt IS NULL
            AND rejectedBy IS NULL AND rejectedAt IS NULL AND rejectionReason IS NULL)
          OR
          (status = 'approved'
            AND approvedBy IS NOT NULL AND length(trim(approvedBy)) > 0
            AND approvedAt IS NOT NULL
            AND approverActorType = 'user'
            AND approvedBy != initiatedBy
            AND rejectedBy IS NULL AND rejectedAt IS NULL AND rejectionReason IS NULL)
          OR
          (status = 'rejected'
            AND rejectedBy IS NOT NULL AND length(trim(rejectedBy)) > 0
            AND rejectedAt IS NOT NULL
            AND rejectedBy != initiatedBy
            AND rejectionReason IS NOT NULL AND length(trim(rejectionReason)) > 0
            AND approvedBy IS NULL AND approvedAt IS NULL)
        )
      );

      CREATE TABLE IF NOT EXISTS ${CANONICAL_PAYMENTS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        clientId TEXT NOT NULL,
        externalId TEXT,
        idempotencyKey TEXT NOT NULL,
        currency TEXT NOT NULL,
        paymentKind TEXT NOT NULL,
        receivedAmountMinor INTEGER NOT NULL,
        refundAmountMinor INTEGER NOT NULL DEFAULT 0,
        receivedAt TEXT NOT NULL,
        workflowStatus TEXT NOT NULL,
        sourceSystem TEXT NOT NULL,
        sourceDocumentType TEXT,
        sourceDocumentId TEXT,
        internalTransfer INTEGER NOT NULL DEFAULT 0,
        reversalOfPaymentId TEXT,
        approvalRequestId TEXT,
        reason TEXT,
        correlationId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE (companyId, id),
        UNIQUE (companyId, id, branchId),
        FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, branchId) REFERENCES ${CANONICAL_BRANCHES_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, reversalOfPaymentId) REFERENCES ${CANONICAL_PAYMENTS_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, approvalRequestId) REFERENCES ${CANONICAL_APPROVAL_REQUESTS_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(id)) > 0),
        CHECK (length(trim(companyId)) > 0),
        CHECK (length(trim(branchId)) > 0),
        CHECK (length(trim(clientId)) > 0),
        CHECK (length(trim(idempotencyKey)) > 0),
        CHECK (currency = 'RUB'),
        CHECK (paymentKind IN ('receipt', 'refund', 'reversal')),
        CHECK (typeof(receivedAmountMinor) = 'integer' AND receivedAmountMinor > 0),
        CHECK (typeof(refundAmountMinor) = 'integer' AND refundAmountMinor >= 0),
        CHECK (workflowStatus IN ('pending', 'confirmed', 'failed', 'cancelled')),
        CHECK (length(trim(receivedAt)) > 0),
        CHECK (length(trim(sourceSystem)) > 0),
        CHECK (internalTransfer IN (0, 1)),
        CHECK (length(trim(correlationId)) > 0),
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (
          (sourceDocumentType IS NULL AND sourceDocumentId IS NULL)
          OR
          (sourceDocumentType IS NOT NULL AND length(trim(sourceDocumentType)) > 0
            AND sourceDocumentId IS NOT NULL AND length(trim(sourceDocumentId)) > 0)
        ),
        CHECK (
          (paymentKind = 'receipt'
            AND receivedAmountMinor > 0
            AND refundAmountMinor = 0
            AND reversalOfPaymentId IS NULL
            AND approvalRequestId IS NULL)
          OR
          (paymentKind IN ('refund', 'reversal')
            AND refundAmountMinor = receivedAmountMinor
            AND reversalOfPaymentId IS NOT NULL
            AND approvalRequestId IS NOT NULL
            AND reason IS NOT NULL AND length(trim(reason)) > 0)
        )
      );

      CREATE TABLE IF NOT EXISTS ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        paymentId TEXT NOT NULL,
        receivableId TEXT NOT NULL,
        paymentBranchId TEXT NOT NULL,
        receivableBranchId TEXT NOT NULL,
        allocatedAmountMinor INTEGER NOT NULL,
        allocationKind TEXT NOT NULL DEFAULT 'allocation',
        allocationStatus TEXT NOT NULL,
        allocationReason TEXT NOT NULL,
        matchingEvidenceType TEXT NOT NULL,
        matchingEvidenceReference TEXT,
        initiatedBy TEXT NOT NULL,
        initiatedAt TEXT NOT NULL,
        approvedBy TEXT,
        approvedAt TEXT,
        approvalStatus TEXT NOT NULL,
        approvalRequestId TEXT,
        reversedAt TEXT,
        reversalAllocationId TEXT,
        idempotencyKey TEXT NOT NULL,
        correlationId TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE (companyId, id),
        FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, paymentId, paymentBranchId)
          REFERENCES ${CANONICAL_PAYMENTS_TABLE}(companyId, id, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, receivableId, receivableBranchId)
          REFERENCES ${CANONICAL_RECEIVABLES_TABLE}(companyId, id, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, paymentBranchId) REFERENCES ${CANONICAL_BRANCHES_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, receivableBranchId) REFERENCES ${CANONICAL_BRANCHES_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, reversalAllocationId)
          REFERENCES ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, approvalRequestId)
          REFERENCES ${CANONICAL_APPROVAL_REQUESTS_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(id)) > 0),
        CHECK (length(trim(companyId)) > 0),
        CHECK (length(trim(paymentId)) > 0),
        CHECK (length(trim(receivableId)) > 0),
        CHECK (length(trim(paymentBranchId)) > 0),
        CHECK (length(trim(receivableBranchId)) > 0),
        CHECK (typeof(allocatedAmountMinor) = 'integer' AND allocatedAmountMinor > 0),
        CHECK (allocationKind IN ('allocation', 'reversal')),
        CHECK (allocationStatus IN ('pending', 'confirmed', 'rejected', 'cancelled')),
        CHECK (length(trim(allocationReason)) > 0),
        CHECK (matchingEvidenceType IN (
          'exact_document_reference',
          'explicit_client_instruction',
          'manual_ambiguous'
        )),
        CHECK (
          matchingEvidenceType = 'manual_ambiguous'
          OR (matchingEvidenceReference IS NOT NULL AND length(trim(matchingEvidenceReference)) > 0)
        ),
        CHECK (length(trim(initiatedBy)) > 0),
        CHECK (approvalStatus IN ('not_required', 'pending', 'approved', 'rejected')),
        CHECK (length(trim(idempotencyKey)) > 0),
        CHECK (length(trim(correlationId)) > 0),
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (
          (approvalStatus = 'not_required'
            AND approvalRequestId IS NULL AND approvedBy IS NULL AND approvedAt IS NULL)
          OR
          (approvalStatus = 'pending'
            AND approvalRequestId IS NOT NULL AND approvedBy IS NULL AND approvedAt IS NULL)
          OR
          (approvalStatus = 'approved'
            AND approvalRequestId IS NOT NULL
            AND approvedBy IS NOT NULL AND length(trim(approvedBy)) > 0
            AND approvedAt IS NOT NULL AND approvedBy != initiatedBy)
          OR
          (approvalStatus = 'rejected'
            AND approvalRequestId IS NOT NULL AND approvedBy IS NULL AND approvedAt IS NULL)
        ),
        CHECK (
          allocationStatus != 'confirmed'
          OR approvalStatus IN ('not_required', 'approved')
        ),
        CHECK (
          allocationKind = 'allocation'
          OR (reversalAllocationId IS NOT NULL AND approvalStatus != 'not_required')
        ),
        CHECK (allocationKind = 'reversal' OR reversalAllocationId IS NULL),
        CHECK (
          allocationKind != 'reversal'
          OR allocationStatus != 'confirmed'
          OR reversedAt IS NOT NULL
        ),
        CHECK (
          allocationStatus != 'confirmed'
          OR paymentBranchId = receivableBranchId
          OR approvalStatus = 'approved'
        ),
        CHECK (
          allocationStatus != 'confirmed'
          OR matchingEvidenceType != 'manual_ambiguous'
          OR approvalStatus = 'approved'
        )
      );

      CREATE TABLE IF NOT EXISTS ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        receivableId TEXT NOT NULL,
        adjustmentType TEXT NOT NULL,
        balanceEffect TEXT NOT NULL,
        amountMinor INTEGER NOT NULL,
        workflowStatus TEXT NOT NULL,
        reason TEXT NOT NULL,
        supportingDocumentReference TEXT,
        sourceDocumentType TEXT,
        sourceDocumentId TEXT,
        reversesAdjustmentId TEXT,
        initiatedBy TEXT NOT NULL,
        initiatedAt TEXT NOT NULL,
        approvedBy TEXT,
        approvedAt TEXT,
        approvalStatus TEXT NOT NULL,
        approvalRequestId TEXT NOT NULL,
        idempotencyKey TEXT NOT NULL,
        correlationId TEXT NOT NULL,
        effectiveAt TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        UNIQUE (companyId, id),
        FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, branchId) REFERENCES ${CANONICAL_BRANCHES_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, receivableId, branchId)
          REFERENCES ${CANONICAL_RECEIVABLES_TABLE}(companyId, id, branchId)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, reversesAdjustmentId)
          REFERENCES ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, approvalRequestId)
          REFERENCES ${CANONICAL_APPROVAL_REQUESTS_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(id)) > 0),
        CHECK (length(trim(companyId)) > 0),
        CHECK (length(trim(branchId)) > 0),
        CHECK (length(trim(receivableId)) > 0),
        CHECK (adjustmentType IN (
          'credit', 'debit', 'discount', 'penalty', 'correction',
          'write_off', 'refund_effect', 'reversal'
        )),
        CHECK (balanceEffect IN ('increase', 'decrease', 'none')),
        CHECK (typeof(amountMinor) = 'integer' AND amountMinor > 0),
        CHECK (workflowStatus IN ('pending', 'confirmed', 'rejected', 'cancelled')),
        CHECK (length(trim(reason)) > 0),
        CHECK (length(trim(initiatedBy)) > 0),
        CHECK (approvalStatus IN ('pending', 'approved', 'rejected')),
        CHECK (length(trim(approvalRequestId)) > 0),
        CHECK (length(trim(idempotencyKey)) > 0),
        CHECK (length(trim(correlationId)) > 0),
        CHECK (typeof(version) = 'integer' AND version >= 1),
        CHECK (
          (adjustmentType IN ('debit', 'penalty') AND balanceEffect = 'increase')
          OR (adjustmentType IN ('credit', 'discount', 'write_off') AND balanceEffect = 'decrease')
          OR (adjustmentType = 'refund_effect' AND balanceEffect = 'none')
          OR (adjustmentType IN ('correction', 'reversal') AND balanceEffect IN ('increase', 'decrease', 'none'))
        ),
        CHECK (
          (adjustmentType = 'reversal' AND reversesAdjustmentId IS NOT NULL)
          OR (adjustmentType != 'reversal' AND reversesAdjustmentId IS NULL)
        ),
        CHECK (
          adjustmentType != 'write_off'
          OR (supportingDocumentReference IS NOT NULL AND length(trim(supportingDocumentReference)) > 0)
        ),
        CHECK (
          (sourceDocumentType IS NULL AND sourceDocumentId IS NULL)
          OR
          (sourceDocumentType IS NOT NULL AND length(trim(sourceDocumentType)) > 0
            AND sourceDocumentId IS NOT NULL AND length(trim(sourceDocumentId)) > 0)
        ),
        CHECK (
          (approvalStatus = 'pending' AND approvedBy IS NULL AND approvedAt IS NULL)
          OR
          (approvalStatus = 'approved'
            AND approvedBy IS NOT NULL AND length(trim(approvedBy)) > 0
            AND approvedAt IS NOT NULL AND approvedBy != initiatedBy)
          OR
          (approvalStatus = 'rejected' AND approvedBy IS NULL AND approvedAt IS NULL)
        ),
        CHECK (workflowStatus != 'confirmed' OR approvalStatus = 'approved')
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_payments_idempotency
        ON ${CANONICAL_PAYMENTS_TABLE}(companyId, idempotencyKey);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_payments_external_identity
        ON ${CANONICAL_PAYMENTS_TABLE}(companyId, sourceSystem, externalId)
        WHERE externalId IS NOT NULL;
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_payment_single_reversal
        ON ${CANONICAL_PAYMENTS_TABLE}(companyId, reversalOfPaymentId)
        WHERE paymentKind = 'reversal';
      CREATE INDEX IF NOT EXISTS idx_canonical_payments_company_branch
        ON ${CANONICAL_PAYMENTS_TABLE}(companyId, branchId, receivedAt);
      CREATE INDEX IF NOT EXISTS idx_canonical_payments_company_client
        ON ${CANONICAL_PAYMENTS_TABLE}(companyId, clientId, receivedAt);

      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_payment_allocations_idempotency
        ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}(companyId, idempotencyKey);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_payment_allocation_reversal
        ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}(companyId, reversalAllocationId)
        WHERE reversalAllocationId IS NOT NULL AND allocationStatus IN ('pending', 'confirmed');
      CREATE INDEX IF NOT EXISTS idx_canonical_payment_allocations_payment
        ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}(companyId, paymentId, allocationStatus);
      CREATE INDEX IF NOT EXISTS idx_canonical_payment_allocations_receivable
        ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}(companyId, receivableId, allocationStatus);

      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_receivable_adjustments_idempotency
        ON ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}(companyId, idempotencyKey);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_receivable_adjustment_reversal
        ON ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}(companyId, reversesAdjustmentId)
        WHERE reversesAdjustmentId IS NOT NULL AND workflowStatus IN ('pending', 'confirmed');
      CREATE INDEX IF NOT EXISTS idx_canonical_receivable_adjustments_receivable
        ON ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}(companyId, receivableId, workflowStatus);

      CREATE INDEX IF NOT EXISTS idx_canonical_approval_requests_company_status
        ON ${CANONICAL_APPROVAL_REQUESTS_TABLE}(companyId, status, requestedAt);
      CREATE INDEX IF NOT EXISTS idx_canonical_approval_requests_aggregate
        ON ${CANONICAL_APPROVAL_REQUESTS_TABLE}(companyId, aggregateType, aggregateId);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_approval_requests_pending_operation
        ON ${CANONICAL_APPROVAL_REQUESTS_TABLE}(companyId, operationType, aggregateType, aggregateId)
        WHERE status = 'pending';
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_approval_requests_financial_operation
        ON ${CANONICAL_APPROVAL_REQUESTS_TABLE}(companyId, operationType, aggregateType, aggregateId)
        WHERE aggregateType != 'receivable' AND status IN ('pending', 'approved');

      CREATE TRIGGER IF NOT EXISTS trg_canonical_approval_requests_pending_identity_immutable
      BEFORE UPDATE ON ${CANONICAL_APPROVAL_REQUESTS_TABLE}
      FOR EACH ROW
      WHEN OLD.status = 'pending' AND (
        OLD.id IS NOT NEW.id
        OR OLD.companyId IS NOT NEW.companyId
        OR OLD.operationType IS NOT NEW.operationType
        OR OLD.aggregateType IS NOT NEW.aggregateType
        OR OLD.aggregateId IS NOT NEW.aggregateId
        OR OLD.initiatedBy IS NOT NEW.initiatedBy
        OR OLD.initiatorActorType IS NOT NEW.initiatorActorType
        OR OLD.requestedAt IS NOT NEW.requestedAt
        OR OLD.reason IS NOT NEW.reason
        OR OLD.correlationId IS NOT NEW.correlationId
        OR OLD.operationPayloadJson IS NOT NEW.operationPayloadJson
        OR OLD.createdAt IS NOT NEW.createdAt
      )
      BEGIN
        SELECT RAISE(ABORT, 'approval request identity and payload are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_approval_requests_final_immutable
      BEFORE UPDATE ON ${CANONICAL_APPROVAL_REQUESTS_TABLE}
      FOR EACH ROW
      WHEN OLD.status IN ('approved', 'rejected')
      BEGIN
        SELECT RAISE(ABORT, 'final approval requests are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_approval_requests_no_delete
      BEFORE DELETE ON ${CANONICAL_APPROVAL_REQUESTS_TABLE}
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'approval requests are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_payments_pending_identity_immutable
      BEFORE UPDATE ON ${CANONICAL_PAYMENTS_TABLE}
      FOR EACH ROW
      WHEN OLD.workflowStatus = 'pending' AND (
        OLD.id IS NOT NEW.id
        OR OLD.companyId IS NOT NEW.companyId
        OR OLD.branchId IS NOT NEW.branchId
        OR OLD.clientId IS NOT NEW.clientId
        OR OLD.externalId IS NOT NEW.externalId
        OR OLD.idempotencyKey IS NOT NEW.idempotencyKey
        OR OLD.currency IS NOT NEW.currency
        OR OLD.paymentKind IS NOT NEW.paymentKind
        OR OLD.receivedAmountMinor IS NOT NEW.receivedAmountMinor
        OR OLD.refundAmountMinor IS NOT NEW.refundAmountMinor
        OR OLD.receivedAt IS NOT NEW.receivedAt
        OR OLD.sourceSystem IS NOT NEW.sourceSystem
        OR OLD.sourceDocumentType IS NOT NEW.sourceDocumentType
        OR OLD.sourceDocumentId IS NOT NEW.sourceDocumentId
        OR OLD.internalTransfer IS NOT NEW.internalTransfer
        OR OLD.reversalOfPaymentId IS NOT NEW.reversalOfPaymentId
        OR OLD.approvalRequestId IS NOT NEW.approvalRequestId
        OR OLD.reason IS NOT NEW.reason
        OR OLD.correlationId IS NOT NEW.correlationId
        OR OLD.createdAt IS NOT NEW.createdAt
      )
      BEGIN
        SELECT RAISE(ABORT, 'pending payment identity and financial payload are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_payments_final_business_immutable
      BEFORE UPDATE ON ${CANONICAL_PAYMENTS_TABLE}
      FOR EACH ROW
      WHEN OLD.workflowStatus IN ('confirmed', 'failed', 'cancelled') AND (
        OLD.companyId IS NOT NEW.companyId
        OR OLD.branchId IS NOT NEW.branchId
        OR OLD.clientId IS NOT NEW.clientId
        OR OLD.externalId IS NOT NEW.externalId
        OR OLD.idempotencyKey IS NOT NEW.idempotencyKey
        OR OLD.currency IS NOT NEW.currency
        OR OLD.paymentKind IS NOT NEW.paymentKind
        OR OLD.receivedAmountMinor IS NOT NEW.receivedAmountMinor
        OR OLD.refundAmountMinor IS NOT NEW.refundAmountMinor
        OR OLD.receivedAt IS NOT NEW.receivedAt
        OR OLD.workflowStatus IS NOT NEW.workflowStatus
        OR OLD.sourceSystem IS NOT NEW.sourceSystem
        OR OLD.sourceDocumentType IS NOT NEW.sourceDocumentType
        OR OLD.sourceDocumentId IS NOT NEW.sourceDocumentId
        OR OLD.internalTransfer IS NOT NEW.internalTransfer
        OR OLD.reversalOfPaymentId IS NOT NEW.reversalOfPaymentId
        OR OLD.approvalRequestId IS NOT NEW.approvalRequestId
        OR OLD.reason IS NOT NEW.reason
        OR OLD.correlationId IS NOT NEW.correlationId
        OR OLD.createdAt IS NOT NEW.createdAt
      )
      BEGIN
        SELECT RAISE(ABORT, 'confirmed payment business fields are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_payments_no_delete
      BEFORE DELETE ON ${CANONICAL_PAYMENTS_TABLE}
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'canonical payments are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_payment_allocations_final_immutable
      BEFORE UPDATE ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      FOR EACH ROW
      WHEN OLD.allocationStatus IN ('confirmed', 'rejected', 'cancelled')
      BEGIN
        SELECT RAISE(ABORT, 'final payment allocations are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_payment_allocations_no_delete
      BEFORE DELETE ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'canonical payment allocations are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_payment_allocations_pending_identity_immutable
      BEFORE UPDATE ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      FOR EACH ROW
      WHEN OLD.allocationStatus = 'pending' AND (
        OLD.id IS NOT NEW.id
        OR OLD.companyId IS NOT NEW.companyId
        OR OLD.paymentId IS NOT NEW.paymentId
        OR OLD.receivableId IS NOT NEW.receivableId
        OR OLD.paymentBranchId IS NOT NEW.paymentBranchId
        OR OLD.receivableBranchId IS NOT NEW.receivableBranchId
        OR OLD.allocatedAmountMinor IS NOT NEW.allocatedAmountMinor
        OR OLD.allocationKind IS NOT NEW.allocationKind
        OR OLD.allocationReason IS NOT NEW.allocationReason
        OR OLD.matchingEvidenceType IS NOT NEW.matchingEvidenceType
        OR OLD.matchingEvidenceReference IS NOT NEW.matchingEvidenceReference
        OR OLD.initiatedBy IS NOT NEW.initiatedBy
        OR OLD.initiatedAt IS NOT NEW.initiatedAt
        OR OLD.approvalRequestId IS NOT NEW.approvalRequestId
        OR OLD.reversalAllocationId IS NOT NEW.reversalAllocationId
        OR OLD.idempotencyKey IS NOT NEW.idempotencyKey
        OR OLD.correlationId IS NOT NEW.correlationId
        OR OLD.createdAt IS NOT NEW.createdAt
      )
      BEGIN
        SELECT RAISE(ABORT, 'pending allocation identity and financial payload are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_payment_allocations_pending_approval_guard
      BEFORE UPDATE OF approvalStatus ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      FOR EACH ROW
      WHEN OLD.approvalStatus = 'pending' AND NEW.approvalStatus = 'not_required'
      BEGIN
        SELECT RAISE(ABORT, 'required allocation approval cannot be removed');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_receivable_adjustments_final_immutable
      BEFORE UPDATE ON ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      FOR EACH ROW
      WHEN OLD.workflowStatus IN ('confirmed', 'rejected', 'cancelled')
      BEGIN
        SELECT RAISE(ABORT, 'final receivable adjustments are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_receivable_adjustments_no_delete
      BEFORE DELETE ON ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'canonical receivable adjustments are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_receivable_adjustments_pending_identity_immutable
      BEFORE UPDATE ON ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      FOR EACH ROW
      WHEN OLD.workflowStatus = 'pending' AND (
        OLD.id IS NOT NEW.id
        OR OLD.companyId IS NOT NEW.companyId
        OR OLD.branchId IS NOT NEW.branchId
        OR OLD.receivableId IS NOT NEW.receivableId
        OR OLD.adjustmentType IS NOT NEW.adjustmentType
        OR OLD.balanceEffect IS NOT NEW.balanceEffect
        OR OLD.amountMinor IS NOT NEW.amountMinor
        OR OLD.reason IS NOT NEW.reason
        OR OLD.supportingDocumentReference IS NOT NEW.supportingDocumentReference
        OR OLD.sourceDocumentType IS NOT NEW.sourceDocumentType
        OR OLD.sourceDocumentId IS NOT NEW.sourceDocumentId
        OR OLD.reversesAdjustmentId IS NOT NEW.reversesAdjustmentId
        OR OLD.initiatedBy IS NOT NEW.initiatedBy
        OR OLD.initiatedAt IS NOT NEW.initiatedAt
        OR OLD.approvalRequestId IS NOT NEW.approvalRequestId
        OR OLD.idempotencyKey IS NOT NEW.idempotencyKey
        OR OLD.correlationId IS NOT NEW.correlationId
        OR OLD.effectiveAt IS NOT NEW.effectiveAt
        OR OLD.createdAt IS NOT NEW.createdAt
      )
      BEGIN
        SELECT RAISE(ABORT, 'pending adjustment identity and financial payload are immutable');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_payments_reversal_reference_guard
      BEFORE INSERT ON ${CANONICAL_PAYMENTS_TABLE}
      FOR EACH ROW
      WHEN NEW.paymentKind IN ('refund', 'reversal')
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversalOfPaymentId
            AND original.workflowStatus = 'confirmed'
            AND original.branchId = NEW.branchId
            AND original.clientId = NEW.clientId
            AND original.currency = NEW.currency
            AND (
              (NEW.paymentKind = 'refund' AND original.paymentKind = 'receipt')
              OR (NEW.paymentKind = 'reversal' AND original.paymentKind IN ('receipt', 'refund'))
            )
        ) THEN RAISE(ABORT, 'payment event must reference an eligible confirmed original') END;
        SELECT CASE WHEN NEW.paymentKind = 'reversal' AND NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversalOfPaymentId
            AND NEW.refundAmountMinor = CASE original.paymentKind
              WHEN 'receipt' THEN original.receivedAmountMinor
              ELSE original.refundAmountMinor END
        ) THEN RAISE(ABORT, 'payment reversal must exactly compensate the original') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_allocations_reversal_reference_guard
      BEFORE INSERT ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      FOR EACH ROW
      WHEN NEW.allocationKind = 'reversal'
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversalAllocationId
            AND original.allocationKind = 'allocation'
            AND original.allocationStatus = 'confirmed'
            AND original.paymentId = NEW.paymentId
            AND original.receivableId = NEW.receivableId
            AND original.paymentBranchId = NEW.paymentBranchId
            AND original.receivableBranchId = NEW.receivableBranchId
            AND original.allocatedAmountMinor = NEW.allocatedAmountMinor
        ) THEN RAISE(ABORT, 'allocation reversal must reference an eligible confirmed original') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_adjustments_reversal_reference_guard
      BEFORE INSERT ON ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      FOR EACH ROW
      WHEN NEW.adjustmentType = 'reversal'
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversesAdjustmentId
            AND original.adjustmentType != 'reversal'
            AND original.workflowStatus = 'confirmed'
            AND original.receivableId = NEW.receivableId
            AND original.branchId = NEW.branchId
            AND original.amountMinor = NEW.amountMinor
            AND NEW.balanceEffect = CASE original.balanceEffect
              WHEN 'increase' THEN 'decrease'
              WHEN 'decrease' THEN 'increase'
              ELSE 'none' END
        ) THEN RAISE(ABORT, 'adjustment reversal must reference an eligible confirmed original') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_allocations_approval_insert_guard
      BEFORE INSERT ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      FOR EACH ROW
      WHEN NEW.allocationStatus = 'confirmed' AND NEW.approvalStatus = 'approved'
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_APPROVAL_REQUESTS_TABLE} approval
          WHERE approval.companyId = NEW.companyId
            AND approval.id = NEW.approvalRequestId
            AND approval.aggregateType = 'payment_allocation'
            AND approval.aggregateId = NEW.id
            AND approval.operationType = CASE NEW.allocationKind
              WHEN 'reversal' THEN 'allocation_reversal'
              ELSE 'allocation' END
            AND json_extract(approval.operationPayloadJson, '$.paymentId') = NEW.paymentId
            AND json_extract(approval.operationPayloadJson, '$.receivableId') = NEW.receivableId
            AND json_extract(approval.operationPayloadJson, '$.allocatedAmountMinor') = NEW.allocatedAmountMinor
            AND json_extract(approval.operationPayloadJson, '$.reversalAllocationId') IS NEW.reversalAllocationId
            AND json_extract(approval.operationPayloadJson, '$.currency') = (
              SELECT currency FROM ${CANONICAL_PAYMENTS_TABLE}
              WHERE companyId = NEW.companyId AND id = NEW.paymentId
            )
            AND json_extract(approval.operationPayloadJson, '$.paymentBranchId') = NEW.paymentBranchId
            AND json_extract(approval.operationPayloadJson, '$.receivableBranchId') = NEW.receivableBranchId
            AND json_extract(approval.operationPayloadJson, '$.matchingEvidenceType') = NEW.matchingEvidenceType
            AND json_extract(approval.operationPayloadJson, '$.matchingEvidenceReference') IS NEW.matchingEvidenceReference
            AND json_extract(approval.operationPayloadJson, '$.allocationReason') = NEW.allocationReason
            AND json_extract(approval.operationPayloadJson, '$.correlationId') = NEW.correlationId
            AND approval.correlationId = NEW.correlationId
            AND approval.status = 'approved'
            AND approval.approvedBy = NEW.approvedBy
        ) THEN RAISE(ABORT, 'approved allocation requires a matching final approval') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_allocations_approval_update_guard
      BEFORE UPDATE OF allocationStatus, approvalStatus ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      FOR EACH ROW
      WHEN NEW.allocationStatus = 'confirmed' AND NEW.approvalStatus = 'approved'
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_APPROVAL_REQUESTS_TABLE} approval
          WHERE approval.companyId = NEW.companyId
            AND approval.id = NEW.approvalRequestId
            AND approval.aggregateType = 'payment_allocation'
            AND approval.aggregateId = NEW.id
            AND approval.operationType = CASE NEW.allocationKind
              WHEN 'reversal' THEN 'allocation_reversal'
              ELSE 'allocation' END
            AND json_extract(approval.operationPayloadJson, '$.paymentId') = NEW.paymentId
            AND json_extract(approval.operationPayloadJson, '$.receivableId') = NEW.receivableId
            AND json_extract(approval.operationPayloadJson, '$.allocatedAmountMinor') = NEW.allocatedAmountMinor
            AND json_extract(approval.operationPayloadJson, '$.reversalAllocationId') IS NEW.reversalAllocationId
            AND json_extract(approval.operationPayloadJson, '$.currency') = (
              SELECT currency FROM ${CANONICAL_PAYMENTS_TABLE}
              WHERE companyId = NEW.companyId AND id = NEW.paymentId
            )
            AND json_extract(approval.operationPayloadJson, '$.paymentBranchId') = NEW.paymentBranchId
            AND json_extract(approval.operationPayloadJson, '$.receivableBranchId') = NEW.receivableBranchId
            AND json_extract(approval.operationPayloadJson, '$.matchingEvidenceType') = NEW.matchingEvidenceType
            AND json_extract(approval.operationPayloadJson, '$.matchingEvidenceReference') IS NEW.matchingEvidenceReference
            AND json_extract(approval.operationPayloadJson, '$.allocationReason') = NEW.allocationReason
            AND json_extract(approval.operationPayloadJson, '$.correlationId') = NEW.correlationId
            AND approval.correlationId = NEW.correlationId
            AND approval.status = 'approved'
            AND approval.approvedBy = NEW.approvedBy
        ) THEN RAISE(ABORT, 'approved allocation requires a matching final approval') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_adjustments_approval_insert_guard
      BEFORE INSERT ON ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      FOR EACH ROW
      WHEN NEW.workflowStatus = 'confirmed'
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_APPROVAL_REQUESTS_TABLE} approval
          WHERE approval.companyId = NEW.companyId
            AND approval.id = NEW.approvalRequestId
            AND approval.aggregateType = 'receivable_adjustment'
            AND approval.aggregateId = NEW.id
            AND approval.operationType = CASE NEW.adjustmentType
              WHEN 'write_off' THEN 'write_off'
              WHEN 'reversal' THEN 'adjustment_reversal'
              ELSE 'adjustment' END
            AND json_extract(approval.operationPayloadJson, '$.receivableId') = NEW.receivableId
            AND json_extract(approval.operationPayloadJson, '$.adjustmentType') = NEW.adjustmentType
            AND json_extract(approval.operationPayloadJson, '$.balanceEffect') = NEW.balanceEffect
            AND json_extract(approval.operationPayloadJson, '$.amountMinor') = NEW.amountMinor
            AND json_extract(approval.operationPayloadJson, '$.reversesAdjustmentId') IS NEW.reversesAdjustmentId
            AND json_extract(approval.operationPayloadJson, '$.branchId') = NEW.branchId
            AND json_extract(approval.operationPayloadJson, '$.currency') = (
              SELECT currency FROM ${CANONICAL_RECEIVABLES_TABLE}
              WHERE companyId = NEW.companyId AND id = NEW.receivableId
            )
            AND json_extract(approval.operationPayloadJson, '$.reason') = NEW.reason
            AND json_extract(approval.operationPayloadJson, '$.supportingDocumentReference') IS NEW.supportingDocumentReference
            AND json_extract(approval.operationPayloadJson, '$.sourceDocumentType') IS NEW.sourceDocumentType
            AND json_extract(approval.operationPayloadJson, '$.sourceDocumentId') IS NEW.sourceDocumentId
            AND json_extract(approval.operationPayloadJson, '$.correlationId') = NEW.correlationId
            AND approval.correlationId = NEW.correlationId
            AND approval.status = 'approved'
            AND approval.approvedBy = NEW.approvedBy
        ) THEN RAISE(ABORT, 'confirmed adjustment requires a matching final approval') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_adjustments_approval_update_guard
      BEFORE UPDATE OF workflowStatus, approvalStatus ON ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      FOR EACH ROW
      WHEN NEW.workflowStatus = 'confirmed'
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_APPROVAL_REQUESTS_TABLE} approval
          WHERE approval.companyId = NEW.companyId
            AND approval.id = NEW.approvalRequestId
            AND approval.aggregateType = 'receivable_adjustment'
            AND approval.aggregateId = NEW.id
            AND approval.operationType = CASE NEW.adjustmentType
              WHEN 'write_off' THEN 'write_off'
              WHEN 'reversal' THEN 'adjustment_reversal'
              ELSE 'adjustment' END
            AND json_extract(approval.operationPayloadJson, '$.receivableId') = NEW.receivableId
            AND json_extract(approval.operationPayloadJson, '$.adjustmentType') = NEW.adjustmentType
            AND json_extract(approval.operationPayloadJson, '$.balanceEffect') = NEW.balanceEffect
            AND json_extract(approval.operationPayloadJson, '$.amountMinor') = NEW.amountMinor
            AND json_extract(approval.operationPayloadJson, '$.reversesAdjustmentId') IS NEW.reversesAdjustmentId
            AND json_extract(approval.operationPayloadJson, '$.branchId') = NEW.branchId
            AND json_extract(approval.operationPayloadJson, '$.currency') = (
              SELECT currency FROM ${CANONICAL_RECEIVABLES_TABLE}
              WHERE companyId = NEW.companyId AND id = NEW.receivableId
            )
            AND json_extract(approval.operationPayloadJson, '$.reason') = NEW.reason
            AND json_extract(approval.operationPayloadJson, '$.supportingDocumentReference') IS NEW.supportingDocumentReference
            AND json_extract(approval.operationPayloadJson, '$.sourceDocumentType') IS NEW.sourceDocumentType
            AND json_extract(approval.operationPayloadJson, '$.sourceDocumentId') IS NEW.sourceDocumentId
            AND json_extract(approval.operationPayloadJson, '$.correlationId') = NEW.correlationId
            AND approval.correlationId = NEW.correlationId
            AND approval.status = 'approved'
            AND approval.approvedBy = NEW.approvedBy
        ) THEN RAISE(ABORT, 'confirmed adjustment requires a matching final approval') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_refunds_approval_insert_guard
      BEFORE INSERT ON ${CANONICAL_PAYMENTS_TABLE}
      FOR EACH ROW
      WHEN NEW.workflowStatus = 'confirmed' AND NEW.paymentKind IN ('refund', 'reversal')
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_APPROVAL_REQUESTS_TABLE} approval
          WHERE approval.companyId = NEW.companyId
            AND approval.id = NEW.approvalRequestId
            AND approval.aggregateType = 'payment'
            AND approval.aggregateId = NEW.id
            AND approval.operationType = CASE
              WHEN NEW.paymentKind = 'reversal' AND EXISTS (
                SELECT 1 FROM ${CANONICAL_PAYMENTS_TABLE} originalRefund
                WHERE originalRefund.companyId = NEW.companyId
                  AND originalRefund.id = NEW.reversalOfPaymentId
                  AND originalRefund.paymentKind = 'refund'
              ) THEN 'refund_reversal'
              ELSE 'refund' END
            AND json_extract(approval.operationPayloadJson, '$.paymentKind') = NEW.paymentKind
            AND json_extract(approval.operationPayloadJson, '$.reversalOfPaymentId') = NEW.reversalOfPaymentId
            AND json_extract(approval.operationPayloadJson, '$.refundAmountMinor') = NEW.refundAmountMinor
            AND json_extract(approval.operationPayloadJson, '$.currency') = NEW.currency
            AND json_extract(approval.operationPayloadJson, '$.branchId') = NEW.branchId
            AND json_extract(approval.operationPayloadJson, '$.reason') = NEW.reason
            AND json_extract(approval.operationPayloadJson, '$.correlationId') = NEW.correlationId
            AND approval.correlationId = NEW.correlationId
            AND approval.status = 'approved'
        ) THEN RAISE(ABORT, 'confirmed refund requires a matching final approval') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_refunds_approval_update_guard
      BEFORE UPDATE OF workflowStatus ON ${CANONICAL_PAYMENTS_TABLE}
      FOR EACH ROW
      WHEN NEW.workflowStatus = 'confirmed' AND NEW.paymentKind IN ('refund', 'reversal')
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_APPROVAL_REQUESTS_TABLE} approval
          WHERE approval.companyId = NEW.companyId
            AND approval.id = NEW.approvalRequestId
            AND approval.aggregateType = 'payment'
            AND approval.aggregateId = NEW.id
            AND approval.operationType = CASE
              WHEN NEW.paymentKind = 'reversal' AND EXISTS (
                SELECT 1 FROM ${CANONICAL_PAYMENTS_TABLE} originalRefund
                WHERE originalRefund.companyId = NEW.companyId
                  AND originalRefund.id = NEW.reversalOfPaymentId
                  AND originalRefund.paymentKind = 'refund'
              ) THEN 'refund_reversal'
              ELSE 'refund' END
            AND json_extract(approval.operationPayloadJson, '$.paymentKind') = NEW.paymentKind
            AND json_extract(approval.operationPayloadJson, '$.reversalOfPaymentId') = NEW.reversalOfPaymentId
            AND json_extract(approval.operationPayloadJson, '$.refundAmountMinor') = NEW.refundAmountMinor
            AND json_extract(approval.operationPayloadJson, '$.currency') = NEW.currency
            AND json_extract(approval.operationPayloadJson, '$.branchId') = NEW.branchId
            AND json_extract(approval.operationPayloadJson, '$.reason') = NEW.reason
            AND json_extract(approval.operationPayloadJson, '$.correlationId') = NEW.correlationId
            AND approval.correlationId = NEW.correlationId
            AND approval.status = 'approved'
        ) THEN RAISE(ABORT, 'confirmed refund requires a matching final approval') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_receivables_due_date_operation_guard
      BEFORE UPDATE OF contractualDueDate, dueDateProvenance ON ${CANONICAL_RECEIVABLES_TABLE}
      FOR EACH ROW
      WHEN OLD.contractualDueDate IS NOT NEW.contractualDueDate
        OR OLD.dueDateProvenance IS NOT NEW.dueDateProvenance
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1
          FROM ${FINANCIAL_AUDIT_EVENTS_TABLE} requested
          WHERE requested.companyId = NEW.companyId
            AND requested.branchId = NEW.branchId
            AND requested.aggregateType = 'receivable'
            AND requested.aggregateId = NEW.id
            AND requested.eventType = 'due_date_change_requested'
            AND json_extract(requested.previousValueJson, '$.contractualDueDate') IS OLD.contractualDueDate
            AND json_extract(requested.previousValueJson, '$.dueDateProvenance') = OLD.dueDateProvenance
            AND json_extract(requested.newValueJson, '$.requestedDueDate') IS NEW.contractualDueDate
            AND json_extract(requested.newValueJson, '$.provenance') = NEW.dueDateProvenance
            AND json_extract(requested.newValueJson, '$.branchId') = NEW.branchId
            AND json_extract(requested.newValueJson, '$.currency') = NEW.currency
            AND json_extract(requested.newValueJson, '$.correlationId') = requested.correlationId
            AND NOT EXISTS (
              SELECT 1 FROM ${FINANCIAL_AUDIT_EVENTS_TABLE} completed
              WHERE completed.companyId = requested.companyId
                AND completed.aggregateType = requested.aggregateType
                AND completed.aggregateId = requested.aggregateId
                AND completed.eventType = 'due_date_change_approved'
                AND completed.correlationId = requested.correlationId
            )
            AND (
              (
                json_extract(requested.newValueJson, '$.approvalRequired') = 0
                AND NOT EXISTS (
                  SELECT 1 FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} allocation
                  WHERE allocation.companyId = NEW.companyId
                    AND allocation.receivableId = NEW.id
                )
              )
              OR
              (
                json_extract(requested.newValueJson, '$.approvalRequired') = 1
                AND EXISTS (
                  SELECT 1 FROM ${CANONICAL_APPROVAL_REQUESTS_TABLE} approval
                  WHERE approval.companyId = NEW.companyId
                    AND approval.operationType = 'due_date_change'
                    AND approval.aggregateType = 'receivable'
                    AND approval.aggregateId = NEW.id
                    AND approval.status = 'approved'
                    AND approval.correlationId = requested.correlationId
                    AND json_extract(approval.operationPayloadJson, '$.requestedDueDate') IS NEW.contractualDueDate
                    AND json_extract(approval.operationPayloadJson, '$.priorDueDate') IS OLD.contractualDueDate
                    AND json_extract(approval.operationPayloadJson, '$.provenance') = NEW.dueDateProvenance
                    AND json_extract(approval.operationPayloadJson, '$.priorProvenance') = OLD.dueDateProvenance
                    AND json_extract(approval.operationPayloadJson, '$.branchId') = NEW.branchId
                    AND json_extract(approval.operationPayloadJson, '$.currency') = NEW.currency
                    AND json_extract(approval.operationPayloadJson, '$.correlationId') = requested.correlationId
                )
              )
            )
        ) THEN RAISE(ABORT, 'due-date change requires an immutable audited operation') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_receivables_posted_cancellation_guard
      BEFORE UPDATE OF workflowStatus ON ${CANONICAL_RECEIVABLES_TABLE}
      FOR EACH ROW
      WHEN OLD.workflowStatus != 'draft'
        AND OLD.workflowStatus != 'cancelled'
        AND NEW.workflowStatus = 'cancelled'
      BEGIN
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.receivableId = NEW.id
            AND (
              original.allocationStatus = 'pending'
              OR (
                original.allocationKind = 'allocation'
                AND original.allocationStatus = 'confirmed'
                AND NOT EXISTS (
                  SELECT 1 FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} reversal
                  WHERE reversal.companyId = original.companyId
                    AND reversal.reversalAllocationId = original.id
                    AND reversal.allocationKind = 'reversal'
                    AND reversal.allocationStatus = 'confirmed'
                )
              )
            )
        ) OR EXISTS (
          SELECT 1 FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.receivableId = NEW.id
            AND (
              original.workflowStatus = 'pending'
              OR (
                original.adjustmentType != 'reversal'
                AND original.workflowStatus = 'confirmed'
                AND NOT EXISTS (
                  SELECT 1 FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} reversal
                  WHERE reversal.companyId = original.companyId
                    AND reversal.reversesAdjustmentId = original.id
                    AND reversal.adjustmentType = 'reversal'
                    AND reversal.workflowStatus = 'confirmed'
                )
              )
            )
        ) THEN RAISE(ABORT, 'cancellation requires compensating operations') END;
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1
          FROM ${FINANCIAL_AUDIT_EVENTS_TABLE} requested
          JOIN ${CANONICAL_APPROVAL_REQUESTS_TABLE} approval
            ON approval.companyId = requested.companyId
           AND approval.operationType = 'posted_receivable_cancellation'
           AND approval.aggregateType = 'receivable'
           AND approval.aggregateId = requested.aggregateId
           AND approval.status = 'approved'
           AND approval.correlationId = requested.correlationId
          WHERE requested.companyId = NEW.companyId
            AND requested.branchId = NEW.branchId
            AND requested.aggregateType = 'receivable'
            AND requested.aggregateId = NEW.id
            AND requested.eventType = 'cancellation_requested'
            AND json_extract(requested.previousValueJson, '$.workflowStatus') = OLD.workflowStatus
            AND json_extract(requested.newValueJson, '$.workflowStatus') = 'cancelled'
            AND json_extract(requested.newValueJson, '$.approvalRequired') = 1
            AND json_extract(requested.newValueJson, '$.approvalRequestId') = approval.id
            AND json_extract(approval.operationPayloadJson, '$.priorWorkflowStatus') = OLD.workflowStatus
            AND json_extract(approval.operationPayloadJson, '$.branchId') = NEW.branchId
            AND json_extract(approval.operationPayloadJson, '$.currency') = NEW.currency
            AND json_extract(approval.operationPayloadJson, '$.correlationId') = requested.correlationId
            AND NOT EXISTS (
              SELECT 1 FROM ${FINANCIAL_AUDIT_EVENTS_TABLE} completed
              WHERE completed.companyId = requested.companyId
                AND completed.aggregateType = requested.aggregateType
                AND completed.aggregateId = requested.aggregateId
                AND completed.eventType = 'cancellation_approved'
                AND completed.correlationId = requested.correlationId
            )
        ) THEN RAISE(ABORT, 'posted cancellation requires an immutable approved audited operation') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_allocations_confirm_insert_guard
      BEFORE INSERT ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      FOR EACH ROW
      WHEN NEW.allocationStatus = 'confirmed'
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1
          FROM ${CANONICAL_PAYMENTS_TABLE} payment
          JOIN ${CANONICAL_RECEIVABLES_TABLE} receivable
            ON receivable.companyId = payment.companyId
           AND receivable.id = NEW.receivableId
          WHERE payment.companyId = NEW.companyId
            AND payment.id = NEW.paymentId
            AND payment.branchId = NEW.paymentBranchId
            AND receivable.branchId = NEW.receivableBranchId
            AND payment.workflowStatus = 'confirmed'
            AND payment.paymentKind = 'receipt'
            AND payment.internalTransfer = 0
            AND payment.currency = receivable.currency
            AND payment.clientId = receivable.clientId
        ) THEN RAISE(ABORT, 'allocation payment/receivable contract invalid') END;
        SELECT CASE WHEN NEW.allocationKind = 'allocation' AND NEW.allocatedAmountMinor > (
          SELECT payment.receivedAmountMinor
            - COALESCE((SELECT SUM(CASE
                WHEN paymentEvent.reversalOfPaymentId = NEW.paymentId
                  THEN paymentEvent.refundAmountMinor
                ELSE -paymentEvent.refundAmountMinor END)
              FROM ${CANONICAL_PAYMENTS_TABLE} paymentEvent
              LEFT JOIN ${CANONICAL_PAYMENTS_TABLE} originalRefund
                ON originalRefund.companyId = paymentEvent.companyId
               AND originalRefund.id = paymentEvent.reversalOfPaymentId
              WHERE paymentEvent.companyId = NEW.companyId
                AND paymentEvent.workflowStatus = 'confirmed'
                AND (
                  paymentEvent.reversalOfPaymentId = NEW.paymentId
                  OR (
                    paymentEvent.paymentKind = 'reversal'
                    AND originalRefund.paymentKind = 'refund'
                    AND originalRefund.reversalOfPaymentId = NEW.paymentId
                  )
                )), 0)
            - COALESCE((SELECT SUM(CASE allocation.allocationKind
                WHEN 'allocation' THEN allocation.allocatedAmountMinor
                ELSE -allocation.allocatedAmountMinor END)
              FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} allocation
              WHERE allocation.companyId = NEW.companyId
                AND allocation.paymentId = NEW.paymentId
                AND allocation.allocationStatus = 'confirmed'), 0)
          FROM ${CANONICAL_PAYMENTS_TABLE} payment
          WHERE payment.companyId = NEW.companyId AND payment.id = NEW.paymentId
        ) THEN RAISE(ABORT, 'payment balance insufficient') END;
        SELECT CASE WHEN NEW.allocationKind = 'allocation' AND NEW.allocatedAmountMinor > (
          SELECT receivable.originalAmountMinor
            + COALESCE((SELECT SUM(CASE adjustment.balanceEffect
                WHEN 'increase' THEN adjustment.amountMinor
                WHEN 'decrease' THEN -adjustment.amountMinor
                ELSE 0 END)
              FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} adjustment
              WHERE adjustment.companyId = NEW.companyId
                AND adjustment.receivableId = NEW.receivableId
                AND adjustment.workflowStatus = 'confirmed'), 0)
            - COALESCE((SELECT SUM(CASE allocation.allocationKind
                WHEN 'allocation' THEN allocation.allocatedAmountMinor
                ELSE -allocation.allocatedAmountMinor END)
              FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} allocation
              WHERE allocation.companyId = NEW.companyId
                AND allocation.receivableId = NEW.receivableId
                AND allocation.allocationStatus = 'confirmed'), 0)
          FROM ${CANONICAL_RECEIVABLES_TABLE} receivable
          WHERE receivable.companyId = NEW.companyId AND receivable.id = NEW.receivableId
        ) THEN RAISE(ABORT, 'receivable already settled') END;
        SELECT CASE WHEN NEW.allocationKind = 'reversal' AND NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversalAllocationId
            AND original.allocationKind = 'allocation'
            AND original.allocationStatus = 'confirmed'
            AND original.paymentId = NEW.paymentId
            AND original.receivableId = NEW.receivableId
            AND original.allocatedAmountMinor = NEW.allocatedAmountMinor
        ) THEN RAISE(ABORT, 'allocation reversal must exactly reference a confirmed allocation') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_allocations_confirm_update_guard
      BEFORE UPDATE OF allocationStatus, approvalStatus ON ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE}
      FOR EACH ROW
      WHEN OLD.allocationStatus = 'pending' AND NEW.allocationStatus = 'confirmed'
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1
          FROM ${CANONICAL_PAYMENTS_TABLE} payment
          JOIN ${CANONICAL_RECEIVABLES_TABLE} receivable
            ON receivable.companyId = payment.companyId
           AND receivable.id = NEW.receivableId
          WHERE payment.companyId = NEW.companyId
            AND payment.id = NEW.paymentId
            AND payment.workflowStatus = 'confirmed'
            AND payment.paymentKind = 'receipt'
            AND payment.internalTransfer = 0
            AND payment.currency = receivable.currency
            AND payment.clientId = receivable.clientId
        ) THEN RAISE(ABORT, 'allocation payment/receivable contract invalid') END;
        SELECT CASE WHEN NEW.allocationKind = 'allocation' AND NEW.allocatedAmountMinor > (
          SELECT payment.receivedAmountMinor
            - COALESCE((SELECT SUM(CASE
                WHEN paymentEvent.reversalOfPaymentId = NEW.paymentId
                  THEN paymentEvent.refundAmountMinor
                ELSE -paymentEvent.refundAmountMinor END)
              FROM ${CANONICAL_PAYMENTS_TABLE} paymentEvent
              LEFT JOIN ${CANONICAL_PAYMENTS_TABLE} originalRefund
                ON originalRefund.companyId = paymentEvent.companyId
               AND originalRefund.id = paymentEvent.reversalOfPaymentId
              WHERE paymentEvent.companyId = NEW.companyId
                AND paymentEvent.workflowStatus = 'confirmed'
                AND (
                  paymentEvent.reversalOfPaymentId = NEW.paymentId
                  OR (
                    paymentEvent.paymentKind = 'reversal'
                    AND originalRefund.paymentKind = 'refund'
                    AND originalRefund.reversalOfPaymentId = NEW.paymentId
                  )
                )), 0)
            - COALESCE((SELECT SUM(CASE allocation.allocationKind
                WHEN 'allocation' THEN allocation.allocatedAmountMinor
                ELSE -allocation.allocatedAmountMinor END)
              FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} allocation
              WHERE allocation.companyId = NEW.companyId
                AND allocation.paymentId = NEW.paymentId
                AND allocation.allocationStatus = 'confirmed'
                AND allocation.id != NEW.id), 0)
          FROM ${CANONICAL_PAYMENTS_TABLE} payment
          WHERE payment.companyId = NEW.companyId AND payment.id = NEW.paymentId
        ) THEN RAISE(ABORT, 'payment balance insufficient') END;
        SELECT CASE WHEN NEW.allocationKind = 'allocation' AND NEW.allocatedAmountMinor > (
          SELECT receivable.originalAmountMinor
            + COALESCE((SELECT SUM(CASE adjustment.balanceEffect
                WHEN 'increase' THEN adjustment.amountMinor
                WHEN 'decrease' THEN -adjustment.amountMinor
                ELSE 0 END)
              FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} adjustment
              WHERE adjustment.companyId = NEW.companyId
                AND adjustment.receivableId = NEW.receivableId
                AND adjustment.workflowStatus = 'confirmed'), 0)
            - COALESCE((SELECT SUM(CASE allocation.allocationKind
                WHEN 'allocation' THEN allocation.allocatedAmountMinor
                ELSE -allocation.allocatedAmountMinor END)
              FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} allocation
              WHERE allocation.companyId = NEW.companyId
                AND allocation.receivableId = NEW.receivableId
                AND allocation.allocationStatus = 'confirmed'
                AND allocation.id != NEW.id), 0)
          FROM ${CANONICAL_RECEIVABLES_TABLE} receivable
          WHERE receivable.companyId = NEW.companyId AND receivable.id = NEW.receivableId
        ) THEN RAISE(ABORT, 'receivable already settled') END;
        SELECT CASE WHEN NEW.allocationKind = 'reversal' AND NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversalAllocationId
            AND original.allocationKind = 'allocation'
            AND original.allocationStatus = 'confirmed'
            AND original.paymentId = NEW.paymentId
            AND original.receivableId = NEW.receivableId
            AND original.allocatedAmountMinor = NEW.allocatedAmountMinor
        ) THEN RAISE(ABORT, 'allocation reversal must exactly reference a confirmed allocation') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_adjustments_confirm_insert_guard
      BEFORE INSERT ON ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      FOR EACH ROW
      WHEN NEW.workflowStatus = 'confirmed'
      BEGIN
        SELECT CASE WHEN NEW.balanceEffect = 'decrease' AND NEW.amountMinor > (
          SELECT receivable.originalAmountMinor
            + COALESCE((SELECT SUM(CASE adjustment.balanceEffect
                WHEN 'increase' THEN adjustment.amountMinor
                WHEN 'decrease' THEN -adjustment.amountMinor
                ELSE 0 END)
              FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} adjustment
              WHERE adjustment.companyId = NEW.companyId
                AND adjustment.receivableId = NEW.receivableId
                AND adjustment.workflowStatus = 'confirmed'), 0)
            - COALESCE((SELECT SUM(CASE allocation.allocationKind
                WHEN 'allocation' THEN allocation.allocatedAmountMinor
                ELSE -allocation.allocatedAmountMinor END)
              FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} allocation
              WHERE allocation.companyId = NEW.companyId
                AND allocation.receivableId = NEW.receivableId
                AND allocation.allocationStatus = 'confirmed'), 0)
          FROM ${CANONICAL_RECEIVABLES_TABLE} receivable
          WHERE receivable.companyId = NEW.companyId AND receivable.id = NEW.receivableId
        ) THEN RAISE(ABORT, 'adjustment exceeds receivable outstanding') END;
        SELECT CASE WHEN NEW.adjustmentType = 'reversal' AND NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversesAdjustmentId
            AND original.workflowStatus = 'confirmed'
            AND original.adjustmentType != 'reversal'
            AND original.receivableId = NEW.receivableId
            AND original.amountMinor = NEW.amountMinor
            AND NEW.balanceEffect = CASE original.balanceEffect
              WHEN 'increase' THEN 'decrease'
              WHEN 'decrease' THEN 'increase'
              ELSE 'none' END
        ) THEN RAISE(ABORT, 'adjustment reversal must exactly compensate a confirmed adjustment') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_adjustments_confirm_update_guard
      BEFORE UPDATE OF workflowStatus, approvalStatus ON ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE}
      FOR EACH ROW
      WHEN OLD.workflowStatus = 'pending' AND NEW.workflowStatus = 'confirmed'
      BEGIN
        SELECT CASE WHEN NEW.balanceEffect = 'decrease' AND NEW.amountMinor > (
          SELECT receivable.originalAmountMinor
            + COALESCE((SELECT SUM(CASE adjustment.balanceEffect
                WHEN 'increase' THEN adjustment.amountMinor
                WHEN 'decrease' THEN -adjustment.amountMinor
                ELSE 0 END)
              FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} adjustment
              WHERE adjustment.companyId = NEW.companyId
                AND adjustment.receivableId = NEW.receivableId
                AND adjustment.workflowStatus = 'confirmed'
                AND adjustment.id != NEW.id), 0)
            - COALESCE((SELECT SUM(CASE allocation.allocationKind
                WHEN 'allocation' THEN allocation.allocatedAmountMinor
                ELSE -allocation.allocatedAmountMinor END)
              FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} allocation
              WHERE allocation.companyId = NEW.companyId
                AND allocation.receivableId = NEW.receivableId
                AND allocation.allocationStatus = 'confirmed'), 0)
          FROM ${CANONICAL_RECEIVABLES_TABLE} receivable
          WHERE receivable.companyId = NEW.companyId AND receivable.id = NEW.receivableId
        ) THEN RAISE(ABORT, 'adjustment exceeds receivable outstanding') END;
        SELECT CASE WHEN NEW.adjustmentType = 'reversal' AND NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversesAdjustmentId
            AND original.workflowStatus = 'confirmed'
            AND original.adjustmentType != 'reversal'
            AND original.receivableId = NEW.receivableId
            AND original.amountMinor = NEW.amountMinor
            AND NEW.balanceEffect = CASE original.balanceEffect
              WHEN 'increase' THEN 'decrease'
              WHEN 'decrease' THEN 'increase'
              ELSE 'none' END
        ) THEN RAISE(ABORT, 'adjustment reversal must exactly compensate a confirmed adjustment') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_refunds_confirm_insert_guard
      BEFORE INSERT ON ${CANONICAL_PAYMENTS_TABLE}
      FOR EACH ROW
      WHEN NEW.workflowStatus = 'confirmed' AND NEW.paymentKind IN ('refund', 'reversal')
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversalOfPaymentId
            AND original.workflowStatus = 'confirmed'
            AND original.clientId = NEW.clientId
            AND original.currency = NEW.currency
            AND (
              (NEW.paymentKind = 'refund' AND original.paymentKind = 'receipt')
              OR (NEW.paymentKind = 'reversal' AND original.paymentKind IN ('receipt', 'refund'))
            )
        ) THEN RAISE(ABORT, 'refund must reference a confirmed receipt') END;
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversalOfPaymentId
            AND original.paymentKind = 'receipt'
        ) AND NEW.refundAmountMinor > (
          SELECT original.receivedAmountMinor
            - COALESCE((SELECT SUM(CASE allocation.allocationKind
                WHEN 'allocation' THEN allocation.allocatedAmountMinor
                ELSE -allocation.allocatedAmountMinor END)
              FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} allocation
              WHERE allocation.companyId = NEW.companyId
                AND allocation.paymentId = NEW.reversalOfPaymentId
                AND allocation.allocationStatus = 'confirmed'), 0)
            - COALESCE((SELECT SUM(CASE
                WHEN paymentEvent.reversalOfPaymentId = NEW.reversalOfPaymentId
                  THEN paymentEvent.refundAmountMinor
                ELSE -paymentEvent.refundAmountMinor END)
              FROM ${CANONICAL_PAYMENTS_TABLE} paymentEvent
              LEFT JOIN ${CANONICAL_PAYMENTS_TABLE} originalRefund
                ON originalRefund.companyId = paymentEvent.companyId
               AND originalRefund.id = paymentEvent.reversalOfPaymentId
              WHERE paymentEvent.companyId = NEW.companyId
                AND paymentEvent.workflowStatus = 'confirmed'
                AND (
                  paymentEvent.reversalOfPaymentId = NEW.reversalOfPaymentId
                  OR (
                    paymentEvent.paymentKind = 'reversal'
                    AND originalRefund.paymentKind = 'refund'
                    AND originalRefund.reversalOfPaymentId = NEW.reversalOfPaymentId
                  )
                )), 0)
          FROM ${CANONICAL_PAYMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId AND original.id = NEW.reversalOfPaymentId
        ) THEN RAISE(ABORT, 'refund exceeds available refundable amount') END;
        SELECT CASE WHEN NEW.paymentKind = 'reversal' AND EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversalOfPaymentId
            AND original.paymentKind = 'refund'
            AND original.refundAmountMinor != NEW.refundAmountMinor
        ) THEN RAISE(ABORT, 'refund reversal must exactly compensate the refund') END;
      END;

      CREATE TRIGGER IF NOT EXISTS trg_canonical_refunds_confirm_update_guard
      BEFORE UPDATE OF workflowStatus ON ${CANONICAL_PAYMENTS_TABLE}
      FOR EACH ROW
      WHEN OLD.workflowStatus = 'pending'
        AND NEW.workflowStatus = 'confirmed'
        AND NEW.paymentKind IN ('refund', 'reversal')
      BEGIN
        SELECT CASE WHEN NOT EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversalOfPaymentId
            AND original.workflowStatus = 'confirmed'
            AND original.clientId = NEW.clientId
            AND original.currency = NEW.currency
            AND (
              (NEW.paymentKind = 'refund' AND original.paymentKind = 'receipt')
              OR (NEW.paymentKind = 'reversal' AND original.paymentKind IN ('receipt', 'refund'))
            )
        ) THEN RAISE(ABORT, 'refund must reference a confirmed receipt') END;
        SELECT CASE WHEN EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversalOfPaymentId
            AND original.paymentKind = 'receipt'
        ) AND NEW.refundAmountMinor > (
          SELECT original.receivedAmountMinor
            - COALESCE((SELECT SUM(CASE allocation.allocationKind
                WHEN 'allocation' THEN allocation.allocatedAmountMinor
                ELSE -allocation.allocatedAmountMinor END)
              FROM ${CANONICAL_PAYMENT_ALLOCATIONS_TABLE} allocation
              WHERE allocation.companyId = NEW.companyId
                AND allocation.paymentId = NEW.reversalOfPaymentId
                AND allocation.allocationStatus = 'confirmed'), 0)
            - COALESCE((SELECT SUM(CASE
                WHEN paymentEvent.reversalOfPaymentId = NEW.reversalOfPaymentId
                  THEN paymentEvent.refundAmountMinor
                ELSE -paymentEvent.refundAmountMinor END)
              FROM ${CANONICAL_PAYMENTS_TABLE} paymentEvent
              LEFT JOIN ${CANONICAL_PAYMENTS_TABLE} originalRefund
                ON originalRefund.companyId = paymentEvent.companyId
               AND originalRefund.id = paymentEvent.reversalOfPaymentId
              WHERE paymentEvent.companyId = NEW.companyId
                AND paymentEvent.workflowStatus = 'confirmed'
                AND paymentEvent.id != NEW.id
                AND (
                  paymentEvent.reversalOfPaymentId = NEW.reversalOfPaymentId
                  OR (
                    paymentEvent.paymentKind = 'reversal'
                    AND originalRefund.paymentKind = 'refund'
                    AND originalRefund.reversalOfPaymentId = NEW.reversalOfPaymentId
                  )
                )), 0)
          FROM ${CANONICAL_PAYMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId AND original.id = NEW.reversalOfPaymentId
        ) THEN RAISE(ABORT, 'refund exceeds available refundable amount') END;
        SELECT CASE WHEN NEW.paymentKind = 'reversal' AND EXISTS (
          SELECT 1 FROM ${CANONICAL_PAYMENTS_TABLE} original
          WHERE original.companyId = NEW.companyId
            AND original.id = NEW.reversalOfPaymentId
            AND original.paymentKind = 'refund'
            AND original.refundAmountMinor != NEW.refundAmountMinor
        ) THEN RAISE(ABORT, 'refund reversal must exactly compensate the refund') END;
      END;
    `);

    db.prepare(`
      INSERT INTO sql_shadow_schema_migrations (name, version)
      VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET
        version = excluded.version,
        applied_at = CURRENT_TIMESTAMP
    `).run(
      CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID,
      CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION,
    );
    return true;
  });

  return migrate();
}

module.exports = {
  CANONICAL_APPROVAL_REQUESTS_TABLE,
  CANONICAL_PAYMENT_ALLOCATIONS_TABLE,
  CANONICAL_PAYMENTS_TABLE,
  CANONICAL_RECEIVABLE_ADJUSTMENTS_TABLE,
  CANONICAL_RECEIVABLES_SETTLEMENT_MIGRATION_ID,
  CANONICAL_RECEIVABLES_SETTLEMENT_SCHEMA_VERSION,
  ensureCanonicalReceivablesSettlementSchema,
};
