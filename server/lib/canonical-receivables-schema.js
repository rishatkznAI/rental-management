const CANONICAL_RECEIVABLES_SCHEMA_VERSION = 1;
const CANONICAL_RECEIVABLES_MIGRATION_ID = 'canonical_receivables_pr1_schema';

const CANONICAL_COMPANIES_TABLE = 'canonical_companies';
const CANONICAL_BRANCHES_TABLE = 'canonical_branches';
const CANONICAL_RECEIVABLES_TABLE = 'canonical_receivables';
const FINANCIAL_AUDIT_EVENTS_TABLE = 'financial_audit_events';

function ensureCanonicalReceivablesSchema(db) {
  db.pragma('foreign_keys = ON');

  // Keep using the repository's existing schema-version registry. The registry
  // table name predates this normalized schema, but introducing a second
  // migration mechanism would make startup ordering ambiguous.
  db.exec(`
    CREATE TABLE IF NOT EXISTS sql_shadow_schema_migrations (
      name TEXT PRIMARY KEY,
      version INTEGER NOT NULL,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const migrate = db.transaction(() => {
    const applied = db.prepare(`
      SELECT version
      FROM sql_shadow_schema_migrations
      WHERE name = ?
    `).get(CANONICAL_RECEIVABLES_MIGRATION_ID);
    if (Number(applied?.version) >= CANONICAL_RECEIVABLES_SCHEMA_VERSION) return false;

    db.exec(`
      CREATE TABLE IF NOT EXISTS ${CANONICAL_COMPANIES_TABLE} (
        id TEXT PRIMARY KEY,
        receivablesTimezone TEXT NOT NULL,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        CHECK (length(trim(id)) > 0),
        CHECK (length(trim(receivablesTimezone)) > 0)
      );

      CREATE TABLE IF NOT EXISTS ${CANONICAL_BRANCHES_TABLE} (
        companyId TEXT NOT NULL,
        id TEXT NOT NULL,
        isHeadOffice INTEGER NOT NULL DEFAULT 0,
        createdAt TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (companyId, id),
        FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(companyId)) > 0),
        CHECK (length(trim(id)) > 0),
        CHECK (isHeadOffice IN (0, 1))
      );

      CREATE TABLE IF NOT EXISTS ${CANONICAL_RECEIVABLES_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        clientId TEXT NOT NULL,
        contractId TEXT,
        rentalId TEXT,
        sourceDocumentType TEXT NOT NULL,
        sourceDocumentId TEXT NOT NULL,
        sourceLineId TEXT,
        normalizedSourceLineId TEXT GENERATED ALWAYS AS (
          COALESCE(NULLIF(trim(sourceLineId), ''), '__document_total__')
        ) STORED,
        sourceSystem TEXT NOT NULL,
        externalId TEXT,
        idempotencyKey TEXT NOT NULL,
        currency TEXT NOT NULL,
        originalAmountMinor INTEGER NOT NULL,
        issuedAt TEXT,
        postedAt TEXT,
        contractualDueDate TEXT,
        dueDateProvenance TEXT NOT NULL,
        companyTimezone TEXT NOT NULL,
        workflowStatus TEXT NOT NULL,
        cancellationReason TEXT,
        description TEXT,
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL,
        cancelledAt TEXT,
        closedAt TEXT,
        writtenOffAt TEXT,
        version INTEGER NOT NULL DEFAULT 1,
        FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, branchId) REFERENCES ${CANONICAL_BRANCHES_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(id)) > 0),
        CHECK (length(trim(companyId)) > 0),
        CHECK (length(trim(branchId)) > 0),
        CHECK (length(trim(clientId)) > 0),
        CHECK (length(trim(sourceDocumentType)) > 0),
        CHECK (length(trim(sourceDocumentId)) > 0),
        CHECK (length(trim(sourceSystem)) > 0),
        CHECK (length(trim(idempotencyKey)) > 0),
        CHECK (currency = 'RUB'),
        CHECK (typeof(originalAmountMinor) = 'integer' AND originalAmountMinor >= 0),
        CHECK (
          workflowStatus IN ('draft', 'cancelled')
          OR originalAmountMinor > 0
        ),
        CHECK (
          contractualDueDate IS NULL
          OR (
            contractualDueDate GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND date(contractualDueDate) IS NOT NULL
            AND date(contractualDueDate) = contractualDueDate
          )
        ),
        CHECK (
          dueDateProvenance IN (
            'invoice_due_date',
            'contractual_payment_due_date',
            'installment_due_date',
            'migrated_verified',
            'unknown'
          )
        ),
        CHECK (
          dueDateProvenance = 'unknown'
          OR contractualDueDate IS NOT NULL
        ),
        CHECK (length(trim(companyTimezone)) > 0),
        CHECK (workflowStatus IN ('draft', 'posted', 'disputed', 'cancelled', 'written_off')),
        CHECK (
          workflowStatus NOT IN ('posted', 'disputed', 'written_off')
          OR postedAt IS NOT NULL
        ),
        CHECK (
          workflowStatus != 'cancelled'
          OR (
            cancelledAt IS NOT NULL
            AND cancellationReason IS NOT NULL
            AND length(trim(cancellationReason)) > 0
          )
        ),
        CHECK (workflowStatus != 'written_off' OR writtenOffAt IS NOT NULL),
        CHECK (typeof(version) = 'integer' AND version >= 1)
      );

      CREATE TABLE IF NOT EXISTS ${FINANCIAL_AUDIT_EVENTS_TABLE} (
        id TEXT PRIMARY KEY,
        companyId TEXT NOT NULL,
        branchId TEXT NOT NULL,
        aggregateType TEXT NOT NULL,
        aggregateId TEXT NOT NULL,
        eventType TEXT NOT NULL,
        actorId TEXT,
        actorType TEXT NOT NULL,
        occurredAt TEXT NOT NULL,
        reason TEXT,
        previousValueJson TEXT,
        newValueJson TEXT,
        correlationId TEXT NOT NULL,
        sourceSystem TEXT NOT NULL,
        createdAt TEXT NOT NULL,
        FOREIGN KEY (companyId) REFERENCES ${CANONICAL_COMPANIES_TABLE}(id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        FOREIGN KEY (companyId, branchId) REFERENCES ${CANONICAL_BRANCHES_TABLE}(companyId, id)
          ON UPDATE RESTRICT ON DELETE RESTRICT,
        CHECK (length(trim(id)) > 0),
        CHECK (length(trim(companyId)) > 0),
        CHECK (length(trim(branchId)) > 0),
        CHECK (length(trim(aggregateType)) > 0),
        CHECK (length(trim(aggregateId)) > 0),
        CHECK (length(trim(eventType)) > 0),
        CHECK (actorType IN ('user', 'integration', 'system')),
        CHECK (actorType != 'user' OR (actorId IS NOT NULL AND length(trim(actorId)) > 0)),
        CHECK (previousValueJson IS NULL OR json_valid(previousValueJson)),
        CHECK (newValueJson IS NULL OR json_valid(newValueJson)),
        CHECK (length(trim(correlationId)) > 0),
        CHECK (length(trim(sourceSystem)) > 0)
      );

      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_branches_head_office
        ON ${CANONICAL_BRANCHES_TABLE}(companyId)
        WHERE isHeadOffice = 1;

      CREATE INDEX IF NOT EXISTS idx_canonical_receivables_company
        ON ${CANONICAL_RECEIVABLES_TABLE}(companyId);
      CREATE INDEX IF NOT EXISTS idx_canonical_receivables_company_branch
        ON ${CANONICAL_RECEIVABLES_TABLE}(companyId, branchId);
      CREATE INDEX IF NOT EXISTS idx_canonical_receivables_company_client
        ON ${CANONICAL_RECEIVABLES_TABLE}(companyId, clientId);
      CREATE INDEX IF NOT EXISTS idx_canonical_receivables_company_workflow
        ON ${CANONICAL_RECEIVABLES_TABLE}(companyId, workflowStatus);
      CREATE INDEX IF NOT EXISTS idx_canonical_receivables_company_due_date
        ON ${CANONICAL_RECEIVABLES_TABLE}(companyId, contractualDueDate);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_receivables_source_identity
        ON ${CANONICAL_RECEIVABLES_TABLE}(
          companyId,
          sourceSystem,
          sourceDocumentType,
          sourceDocumentId,
          normalizedSourceLineId
        );
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_receivables_idempotency
        ON ${CANONICAL_RECEIVABLES_TABLE}(companyId, idempotencyKey);
      CREATE UNIQUE INDEX IF NOT EXISTS uq_canonical_receivables_external_identity
        ON ${CANONICAL_RECEIVABLES_TABLE}(companyId, sourceSystem, externalId)
        WHERE externalId IS NOT NULL;

      CREATE INDEX IF NOT EXISTS idx_financial_audit_events_company
        ON ${FINANCIAL_AUDIT_EVENTS_TABLE}(companyId);
      CREATE INDEX IF NOT EXISTS idx_financial_audit_events_company_branch
        ON ${FINANCIAL_AUDIT_EVENTS_TABLE}(companyId, branchId);
      CREATE INDEX IF NOT EXISTS idx_financial_audit_events_company_aggregate
        ON ${FINANCIAL_AUDIT_EVENTS_TABLE}(companyId, aggregateType, aggregateId, occurredAt);

      CREATE TRIGGER IF NOT EXISTS trg_canonical_receivables_posted_immutability
      BEFORE UPDATE ON ${CANONICAL_RECEIVABLES_TABLE}
      FOR EACH ROW
      WHEN OLD.workflowStatus != 'draft' AND (
        OLD.companyId IS NOT NEW.companyId
        OR OLD.branchId IS NOT NEW.branchId
        OR OLD.clientId IS NOT NEW.clientId
        OR OLD.sourceSystem IS NOT NEW.sourceSystem
        OR OLD.sourceDocumentType IS NOT NEW.sourceDocumentType
        OR OLD.sourceDocumentId IS NOT NEW.sourceDocumentId
        OR OLD.sourceLineId IS NOT NEW.sourceLineId
        OR OLD.currency IS NOT NEW.currency
        OR OLD.companyTimezone IS NOT NEW.companyTimezone
        OR OLD.originalAmountMinor IS NOT NEW.originalAmountMinor
      )
      BEGIN
        SELECT RAISE(ABORT, 'posted receivable immutable fields cannot change');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_financial_audit_events_no_update
      BEFORE UPDATE ON ${FINANCIAL_AUDIT_EVENTS_TABLE}
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'financial audit events are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_financial_audit_events_no_delete
      BEFORE DELETE ON ${FINANCIAL_AUDIT_EVENTS_TABLE}
      FOR EACH ROW
      BEGIN
        SELECT RAISE(ABORT, 'financial audit events are append-only');
      END;

      CREATE TRIGGER IF NOT EXISTS trg_financial_audit_events_no_replace
      BEFORE INSERT ON ${FINANCIAL_AUDIT_EVENTS_TABLE}
      FOR EACH ROW
      WHEN EXISTS (
        SELECT 1
        FROM ${FINANCIAL_AUDIT_EVENTS_TABLE}
        WHERE id = NEW.id
      )
      BEGIN
        SELECT RAISE(ABORT, 'financial audit events are append-only');
      END;
    `);

    db.prepare(`
      INSERT INTO sql_shadow_schema_migrations (name, version)
      VALUES (?, ?)
      ON CONFLICT(name) DO UPDATE SET
        version = excluded.version,
        applied_at = CURRENT_TIMESTAMP
    `).run(CANONICAL_RECEIVABLES_MIGRATION_ID, CANONICAL_RECEIVABLES_SCHEMA_VERSION);
    return true;
  });

  return migrate();
}

module.exports = {
  CANONICAL_BRANCHES_TABLE,
  CANONICAL_COMPANIES_TABLE,
  CANONICAL_RECEIVABLES_MIGRATION_ID,
  CANONICAL_RECEIVABLES_SCHEMA_VERSION,
  CANONICAL_RECEIVABLES_TABLE,
  FINANCIAL_AUDIT_EVENTS_TABLE,
  ensureCanonicalReceivablesSchema,
};
