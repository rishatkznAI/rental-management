const crypto = require('crypto');
const {
  assertBranchScope,
  assertCapability,
  assertCompanyScope,
  assertScopeFresh,
  nonDisclosingNotFound,
} = require('./platform-authorization');
const {
  createPlatformIdentityRepository,
} = require('./platform-identity-repository');
const {
  BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE,
  BILLING_SOURCE_AUDIT_EVENTS_TABLE,
  BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
  BILLING_SOURCE_COVERAGE_SETS_TABLE,
  BILLING_SOURCE_COVERAGE_SLICES_TABLE,
  BILLING_SOURCE_EFFECTIVE_TERMS_TABLE,
  BILLING_SOURCE_OPERATIONS_TABLE,
  BILLING_SOURCE_PERIODS_TABLE,
  BILLING_SOURCE_PERIOD_VERSIONS_TABLE,
  BILLING_SOURCE_RENTAL_LINES_TABLE,
  BILLING_SOURCE_SNAPSHOT_EVIDENCE_TABLE,
  BILLING_SOURCE_SNAPSHOTS_TABLE,
  BILLING_SOURCE_UPD_LINES_TABLE,
  BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE,
  BILLING_SOURCE_UPDS_TABLE,
  BILLING_SOURCE_UPD_VERSIONS_TABLE,
  assertBillingSourceAuthorityStructure,
} = require('./billing-source-authority-schema');
const {
  BillingSourceAuthorityError,
  OPERATION_CAPABILITIES,
  assertBillingSourceCommandContext,
  assertBillingSourceCommandPlan,
  fingerprint,
  safeAdd,
  stableJson,
} = require('./billing-source-authority-domain');

function fail(code, message, field, status = 409) {
  throw new BillingSourceAuthorityError(code, message, field, status);
}

function id(prefix) {
  return `${prefix}-${crypto.randomUUID()}`;
}

function nowIso() {
  return new Date().toISOString();
}

function json(value) {
  return stableJson(value);
}

function sameJson(left, right) {
  return stableJson(left) === stableJson(right);
}

function createBillingSourceAuthorityRepository(db) {
  if (!db || typeof db.prepare !== 'function' || typeof db.transaction !== 'function') {
    fail('BILLING_SOURCE_DATABASE_REQUIRED', 'A better-sqlite3 database is required.', 'db', 500);
  }
  assertBillingSourceAuthorityStructure(db);

  function readUsers() {
    const row = db.prepare(`
      SELECT json FROM app_data WHERE name = 'users'
    `).get();
    if (!row) return [];
    try {
      const users = JSON.parse(row.json);
      return Array.isArray(users) ? users : [];
    } catch {
      return [];
    }
  }

  const platformRepository = createPlatformIdentityRepository(db, { readUsers });

  function authorize(context, capabilityKey) {
    assertBillingSourceCommandContext(context);
    assertScopeFresh(context, { repository: platformRepository, readUsers });
    assertCapability(context, capabilityKey);
    assertCompanyScope(context, context.companyId);
    assertBranchScope(context, context.branchId);
    const branch = db.prepare(`
      SELECT id
      FROM canonical_branches
      WHERE companyId = ? AND id = ? AND status = 'active'
    `).get(context.companyId, context.branchId);
    if (!branch) nonDisclosingNotFound();
    return context;
  }

  function transaction(operation) {
    return db.transaction(operation).immediate();
  }

  function scopedById(table, context, entityId) {
    return db.prepare(`
      SELECT * FROM ${table}
      WHERE companyId = ? AND branchId = ? AND id = ?
    `).get(context.companyId, context.branchId, entityId) || null;
  }

  function requireScopedById(table, context, entityId) {
    const row = scopedById(table, context, entityId);
    if (!row) nonDisclosingNotFound();
    return row;
  }

  function latestPeriodVersion(context, periodId) {
    return db.prepare(`
      SELECT *
      FROM ${BILLING_SOURCE_PERIOD_VERSIONS_TABLE}
      WHERE companyId = ? AND branchId = ? AND periodId = ?
      ORDER BY version DESC, id DESC
      LIMIT 1
    `).get(context.companyId, context.branchId, periodId) || null;
  }

  function latestUpdVersion(context, updId) {
    return db.prepare(`
      SELECT *
      FROM ${BILLING_SOURCE_UPD_VERSIONS_TABLE}
      WHERE companyId = ? AND branchId = ? AND updId = ?
      ORDER BY version DESC, id DESC
      LIMIT 1
    `).get(context.companyId, context.branchId, updId) || null;
  }

  function replayOrConflict(context, plan) {
    const row = db.prepare(`
      SELECT *
      FROM ${BILLING_SOURCE_OPERATIONS_TABLE}
      WHERE companyId = ? AND operationType = ? AND idempotencyKey = ?
    `).get(context.companyId, plan.operationType, plan.idempotencyKey);
    if (!row) return null;
    const commandFingerprint = fingerprint(plan);
    if (
      row.branchId !== context.branchId
      || row.actorPrincipalId !== context.principalId
      || row.actorMembershipId !== context.membershipId
      || Number(row.actorMembershipVersion) !== Number(context.membershipVersion)
      || Number(row.capabilityCatalogVersion) !== Number(context.capabilityCatalogVersion)
      || row.capabilityKey !== OPERATION_CAPABILITIES[plan.operationType]
      || row.commandFingerprint !== commandFingerprint
    ) {
      fail('BILLING_SOURCE_IDEMPOTENCY_CONFLICT', 'The idempotency key was already used with different authority or content.', 'idempotencyKey');
    }
    return Object.freeze({
      operationId: row.id,
      aggregateType: row.resultAggregateType,
      aggregateId: row.resultAggregateId,
      version: Number(row.resultVersion),
      fingerprint: row.resultFingerprint,
      replayed: true,
    });
  }

  function insertOperation(context, plan, result, operationId, createdAt) {
    const capabilityKey = OPERATION_CAPABILITIES[plan.operationType];
    db.prepare(`
      INSERT INTO ${BILLING_SOURCE_OPERATIONS_TABLE} (
        id, companyId, branchId, operationType, idempotencyKey, commandFingerprint,
        actorPrincipalId, actorMembershipId, actorMembershipVersion,
        capabilityCatalogVersion, capabilityKey, resultAggregateType,
        resultAggregateId, resultVersion, resultFingerprint, correlationId,
        schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @operationType, @idempotencyKey, @commandFingerprint,
        @actorPrincipalId, @actorMembershipId, @actorMembershipVersion,
        @capabilityCatalogVersion, @capabilityKey, @resultAggregateType,
        @resultAggregateId, @resultVersion, @resultFingerprint, @correlationId,
        @schemaVersion, @createdAt
      )
    `).run({
      id: operationId,
      companyId: context.companyId,
      branchId: context.branchId,
      operationType: plan.operationType,
      idempotencyKey: plan.idempotencyKey,
      commandFingerprint: fingerprint(plan),
      actorPrincipalId: context.principalId,
      actorMembershipId: context.membershipId,
      actorMembershipVersion: context.membershipVersion,
      capabilityCatalogVersion: context.capabilityCatalogVersion,
      capabilityKey,
      resultAggregateType: result.aggregateType,
      resultAggregateId: result.aggregateId,
      resultVersion: result.version,
      resultFingerprint: result.fingerprint,
      correlationId: context.correlationId,
      schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
      createdAt,
    });
  }

  function insertAudit(context, plan, result, operationId, createdAt, options = {}) {
    db.prepare(`
      INSERT INTO ${BILLING_SOURCE_AUDIT_EVENTS_TABLE} (
        id, companyId, branchId, aggregateType, aggregateId, aggregateVersion,
        eventType, actorType, actorPrincipalId, actorMembershipId,
        actorMembershipVersion, capabilityCatalogVersion, capabilityKey,
        correlationId, reasonCode, reasonText, beforeFingerprint,
        afterFingerprint, operationId, sourceSystem, metadataJson,
        schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @aggregateType, @aggregateId, @aggregateVersion,
        @eventType, 'user', @actorPrincipalId, @actorMembershipId,
        @actorMembershipVersion, @capabilityCatalogVersion, @capabilityKey,
        @correlationId, @reasonCode, @reasonText, @beforeFingerprint,
        @afterFingerprint, @operationId, @sourceSystem, @metadataJson,
        @schemaVersion, @createdAt
      )
    `).run({
      id: id('billing-source-audit'),
      companyId: context.companyId,
      branchId: context.branchId,
      aggregateType: result.aggregateType,
      aggregateId: result.aggregateId,
      aggregateVersion: result.version,
      eventType: options.eventType || plan.operationType,
      actorPrincipalId: context.principalId,
      actorMembershipId: context.membershipId,
      actorMembershipVersion: context.membershipVersion,
      capabilityCatalogVersion: context.capabilityCatalogVersion,
      capabilityKey: OPERATION_CAPABILITIES[plan.operationType],
      correlationId: context.correlationId,
      reasonCode: options.reasonCode || plan.reasonCode || null,
      reasonText: options.reasonText || plan.reasonText || null,
      beforeFingerprint: options.beforeFingerprint || null,
      afterFingerprint: result.fingerprint,
      operationId,
      sourceSystem: options.sourceSystem || plan.upd?.sourceSystem || plan.rentalLine?.sourceSystem || 'billing_source_authority',
      metadataJson: plan.auditMetadata == null ? null : json(plan.auditMetadata),
      schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
      createdAt,
    });
  }

  function finish(context, plan, result, operationId, createdAt, auditOptions) {
    insertOperation(context, plan, result, operationId, createdAt);
    insertAudit(context, plan, result, operationId, createdAt, auditOptions);
    return Object.freeze({
      operationId,
      aggregateType: result.aggregateType,
      aggregateId: result.aggregateId,
      version: result.version,
      fingerprint: result.fingerprint,
      replayed: false,
    });
  }

  function rentalLineImmutable(row) {
    return {
      rentalId: row.rentalId,
      clientId: row.clientId,
      contractId: row.contractId,
      equipmentId: row.equipmentId,
      activationBoundaryId: row.activationBoundaryId,
      sourceSystem: row.sourceSystem,
      sourceRentalRef: row.sourceRentalRef,
      sourceLineIdentityKind: row.sourceLineIdentityKind,
      sourceLineRef: row.sourceLineRef,
      sourceEventId: row.sourceEventId,
      sourceEventVersion: Number(row.sourceEventVersion),
      provenanceHash: row.provenanceHash,
    };
  }

  function resolveRentalLine(context, plan, createdAt) {
    const source = plan.rentalLine;
    const boundary = requireScopedById(
      BILLING_SOURCE_ACTIVATION_BOUNDARIES_TABLE,
      context,
      source.activationBoundaryId,
    );
    const existing = db.prepare(`
      SELECT *
      FROM ${BILLING_SOURCE_RENTAL_LINES_TABLE}
      WHERE companyId = ? AND branchId = ?
        AND sourceSystem = ? AND sourceRentalRef = ?
        AND sourceLineIdentityKind = ? AND sourceLineRef = ?
    `).get(
      context.companyId,
      context.branchId,
      source.sourceSystem,
      source.sourceRentalRef,
      source.sourceLineIdentityKind,
      source.sourceLineRef,
    );
    if (existing) {
      const { id: requestedId, ...immutableSource } = source;
      if ((requestedId && requestedId !== existing.id) || !sameJson(rentalLineImmutable(existing), immutableSource)) {
        fail('BILLING_SOURCE_RENTAL_LINE_CONFLICT', 'The stable rental-line binding conflicts with immutable source content.', 'rentalLine');
      }
      return { row: existing, boundary, created: false };
    }
    if (source.id) {
      fail('BILLING_SOURCE_RENTAL_LINE_NOT_FOUND', 'A supplied rental-line ID must already exist.', 'rentalLine.id', 404);
    }
    const rentalLineId = id('billing-source-rental-line');
    db.prepare(`
      INSERT INTO ${BILLING_SOURCE_RENTAL_LINES_TABLE} (
        id, companyId, branchId, rentalId, clientId, contractId, equipmentId,
        activationBoundaryId, sourceSystem, sourceRentalRef, sourceLineIdentityKind,
        sourceLineRef, sourceEventId, sourceEventVersion, provenanceHash,
        schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @rentalId, @clientId, @contractId, @equipmentId,
        @activationBoundaryId, @sourceSystem, @sourceRentalRef, @sourceLineIdentityKind,
        @sourceLineRef, @sourceEventId, @sourceEventVersion, @provenanceHash,
        @schemaVersion, @createdAt
      )
    `).run({
      ...source,
      id: rentalLineId,
      companyId: context.companyId,
      branchId: context.branchId,
      schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
      createdAt,
    });
    return {
      row: requireScopedById(BILLING_SOURCE_RENTAL_LINES_TABLE, context, rentalLineId),
      boundary,
      created: true,
    };
  }

  function termsImmutable(plan) {
    return {
      effectiveFromDate: plan.effectiveFromDate,
      effectiveToDateExclusive: plan.effectiveToDateExclusive,
      rateAmountMinor: plan.rateAmountMinor,
      rateUnitCode: plan.rateUnitCode,
      rateQuantityScale: plan.rateQuantityScale,
      contractualBillingCycleCode: plan.contractualBillingCycleCode,
      contractualBillingCycleVersion: plan.contractualBillingCycleVersion,
      minimumTermQuantity: plan.minimumTermQuantity,
      minimumTermUnitCode: plan.minimumTermUnitCode,
      discountKind: plan.discountKind,
      discountValue: plan.discountValue,
      currency: plan.currency,
      calculationPolicyRef: plan.calculationPolicyRef,
      vatPolicyRef: plan.vatPolicyRef,
      roundingPolicyRef: plan.roundingPolicyRef,
      policyDecisionRef: plan.policyDecisionRef,
      policyResolutionStatus: plan.policyResolutionStatus,
      unresolvedReasonCodesJson: json(plan.unresolvedReasonCodes),
      sourceSystem: plan.sourceSystem,
      sourceRef: plan.sourceRef,
      sourceVersion: plan.sourceVersion,
      sourceHash: plan.sourceHash,
    };
  }

  function resolveTerms(context, plan, rentalLine, period, createdAt) {
    let terms;
    if (plan.id) {
      terms = requireScopedById(BILLING_SOURCE_EFFECTIVE_TERMS_TABLE, context, plan.id);
      if (terms.rentalLineId !== rentalLine.id) nonDisclosingNotFound();
    } else {
      const latest = db.prepare(`
        SELECT *
        FROM ${BILLING_SOURCE_EFFECTIVE_TERMS_TABLE}
        WHERE companyId = ? AND branchId = ? AND rentalLineId = ?
        ORDER BY version DESC, id DESC
        LIMIT 1
      `).get(context.companyId, context.branchId, rentalLine.id) || null;
      const latestVersion = latest ? Number(latest.version) : 0;
      if (latestVersion !== plan.expectedLatestVersion) {
        fail('BILLING_SOURCE_TERMS_STALE', 'The expected effective-terms version is stale.', 'effectiveTerms.expectedLatestVersion');
      }
      if ((latestVersion === 0 && latest) || (latestVersion > 0 && !latest)) {
        fail('BILLING_SOURCE_TERMS_LINEAGE_INVALID', 'Effective-terms lineage is inconsistent.', 'effectiveTerms');
      }
      const termsId = id('billing-source-terms');
      db.prepare(`
        INSERT INTO ${BILLING_SOURCE_EFFECTIVE_TERMS_TABLE} (
          id, companyId, branchId, rentalLineId, version, supersedesTermsVersionId,
          effectiveFromDate, effectiveToDateExclusive, rateAmountMinor, rateUnitCode,
          rateQuantityScale, contractualBillingCycleCode, contractualBillingCycleVersion,
          minimumTermQuantity, minimumTermUnitCode, discountKind, discountValue, currency,
          calculationPolicyRef, vatPolicyRef, roundingPolicyRef, policyDecisionRef,
          policyResolutionStatus, unresolvedReasonCodesJson, sourceSystem, sourceRef,
          sourceVersion, sourceHash, schemaVersion, createdAt
        ) VALUES (
          @id, @companyId, @branchId, @rentalLineId, @version, @supersedesTermsVersionId,
          @effectiveFromDate, @effectiveToDateExclusive, @rateAmountMinor, @rateUnitCode,
          @rateQuantityScale, @contractualBillingCycleCode, @contractualBillingCycleVersion,
          @minimumTermQuantity, @minimumTermUnitCode, @discountKind, @discountValue, @currency,
          @calculationPolicyRef, @vatPolicyRef, @roundingPolicyRef, @policyDecisionRef,
          @policyResolutionStatus, @unresolvedReasonCodesJson, @sourceSystem, @sourceRef,
          @sourceVersion, @sourceHash, @schemaVersion, @createdAt
        )
      `).run({
        id: termsId,
        companyId: context.companyId,
        branchId: context.branchId,
        rentalLineId: rentalLine.id,
        version: latestVersion + 1,
        supersedesTermsVersionId: latest?.id || null,
        ...termsImmutable(plan),
        schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
        createdAt,
      });
      terms = requireScopedById(BILLING_SOURCE_EFFECTIVE_TERMS_TABLE, context, termsId);
    }
    if (
      terms.effectiveFromDate > period.periodStartDate
      || terms.effectiveToDateExclusive < period.periodEndDateExclusive
      || terms.contractualBillingCycleCode !== period.contractualBillingCycleCode
      || Number(terms.contractualBillingCycleVersion) !== Number(period.contractualBillingCycleVersion)
    ) {
      fail('BILLING_SOURCE_TERMS_COVERAGE_INVALID', 'One effective-terms version must cover the entire period.', 'effectiveTerms');
    }
    return terms;
  }

  function periodImmutable(period, rentalLine) {
    return {
      rentalId: rentalLine.rentalId,
      rentalLineId: rentalLine.id,
      activationBoundaryId: rentalLine.activationBoundaryId,
      contractualBillingCycleCode: period.contractualBillingCycleCode,
      contractualBillingCycleVersion: period.contractualBillingCycleVersion,
      cycleBoundaryEvidenceRef: period.cycleBoundaryEvidenceRef,
      periodStartDate: period.periodStartDate,
      periodEndDateExclusive: period.periodEndDateExclusive,
    };
  }

  function resolvePeriod(context, plan, rentalLine, boundary, createdAt) {
    const source = plan.period;
    if (source.periodStartDate < boundary.firstGovernedPeriodStartDate) {
      fail('BILLING_SOURCE_ACTIVATION_BOUNDARY', 'The complete period must begin inside the approved forward-only boundary.', 'period.periodStartDate');
    }
    let period = source.id ? scopedById(BILLING_SOURCE_PERIODS_TABLE, context, source.id) : null;
    if (!period) {
      period = db.prepare(`
        SELECT *
        FROM ${BILLING_SOURCE_PERIODS_TABLE}
        WHERE companyId = ? AND branchId = ? AND rentalLineId = ?
          AND contractualBillingCycleCode = ? AND contractualBillingCycleVersion = ?
          AND periodStartDate = ? AND periodEndDateExclusive = ?
      `).get(
        context.companyId,
        context.branchId,
        rentalLine.id,
        source.contractualBillingCycleCode,
        source.contractualBillingCycleVersion,
        source.periodStartDate,
        source.periodEndDateExclusive,
      ) || null;
    }
    const expected = periodImmutable(source, rentalLine);
    if (period) {
      if (source.id && source.id !== period.id) nonDisclosingNotFound();
      const actual = Object.fromEntries(Object.keys(expected).map(key => [key, key.endsWith('Version') ? Number(period[key]) : period[key]]));
      if (!sameJson(actual, expected)) {
        fail('BILLING_SOURCE_PERIOD_IDENTITY_CONFLICT', 'Period identity conflicts with immutable boundaries.', 'period');
      }
      return { row: period, created: false };
    }
    if (source.id) nonDisclosingNotFound();
    if (plan.expectedPeriodVersion !== 0) {
      fail('BILLING_SOURCE_PERIOD_STALE', 'A new period requires expected version zero.', 'expectedPeriodVersion');
    }
    const overlap = db.prepare(`
      SELECT id
      FROM ${BILLING_SOURCE_PERIODS_TABLE}
      WHERE companyId = ? AND branchId = ? AND rentalLineId = ?
        AND contractualBillingCycleCode = ? AND contractualBillingCycleVersion = ?
        AND periodStartDate < ? AND ? < periodEndDateExclusive
      LIMIT 1
    `).get(
      context.companyId,
      context.branchId,
      rentalLine.id,
      source.contractualBillingCycleCode,
      source.contractualBillingCycleVersion,
      source.periodEndDateExclusive,
      source.periodStartDate,
    );
    if (overlap) fail('BILLING_SOURCE_PERIOD_OVERLAP', 'Contractual billing periods cannot overlap.', 'period');
    const periodId = id('billing-source-period');
    const immutable = periodImmutable(source, rentalLine);
    db.prepare(`
      INSERT INTO ${BILLING_SOURCE_PERIODS_TABLE} (
        id, companyId, branchId, rentalId, rentalLineId, activationBoundaryId,
        contractualBillingCycleCode, contractualBillingCycleVersion,
        cycleBoundaryEvidenceRef, periodStartDate, periodEndDateExclusive,
        identityHash, schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @rentalId, @rentalLineId, @activationBoundaryId,
        @contractualBillingCycleCode, @contractualBillingCycleVersion,
        @cycleBoundaryEvidenceRef, @periodStartDate, @periodEndDateExclusive,
        @identityHash, @schemaVersion, @createdAt
      )
    `).run({
      id: periodId,
      companyId: context.companyId,
      branchId: context.branchId,
      ...immutable,
      identityHash: fingerprint({ schemaVersion: 1, companyId: context.companyId, branchId: context.branchId, ...immutable }),
      schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
      createdAt,
    });
    return { row: requireScopedById(BILLING_SOURCE_PERIODS_TABLE, context, periodId), created: true };
  }

  function assertExpectedPeriodState(context, period, expectedVersion, requiredPreviousState) {
    const latest = latestPeriodVersion(context, period.id);
    const actualVersion = latest ? Number(latest.version) : 0;
    if (actualVersion !== expectedVersion) {
      fail('BILLING_SOURCE_PERIOD_STALE', 'The expected period version is stale.', 'expectedPeriodVersion');
    }
    if (requiredPreviousState && latest?.eventType !== requiredPreviousState) {
      fail('BILLING_SOURCE_PERIOD_TRANSITION_INVALID', `Period must currently be ${requiredPreviousState}.`, 'periodId');
    }
    return latest;
  }

  function closeBillingPeriod(context, plan) {
    assertBillingSourceCommandContext(context);
    assertBillingSourceCommandPlan(plan, 'close_billing_period');
    return transaction(() => {
      authorize(context, 'billing.period.close');
      const replay = replayOrConflict(context, plan);
      if (replay) return replay;
      const createdAt = nowIso();
      const operationId = id('billing-source-operation');
      const line = resolveRentalLine(context, plan, createdAt);
      const periodResult = resolvePeriod(context, plan, line.row, line.boundary, createdAt);
      const latest = assertExpectedPeriodState(
        context,
        periodResult.row,
        plan.expectedPeriodVersion,
        plan.expectedPeriodVersion === 0 ? null : 'reopened',
      );
      if (latest?.eventType === 'closed') {
        fail('BILLING_SOURCE_PERIOD_TRANSITION_INVALID', 'A closed period must be reopened before another close.', 'period');
      }
      const terms = resolveTerms(context, plan.effectiveTerms, line.row, periodResult.row, createdAt);
      if (
        terms.currency !== plan.snapshot.currency
        || terms.calculationPolicyRef !== plan.snapshot.calculationPolicyRef
        || terms.vatPolicyRef !== plan.snapshot.vatPolicyRef
        || terms.roundingPolicyRef !== plan.snapshot.roundingPolicyRef
      ) {
        fail('BILLING_SOURCE_SNAPSHOT_TERMS_MISMATCH', 'Snapshot policy and currency must match the selected effective terms.', 'snapshot');
      }
      if (plan.snapshot.sourceIntegrityStatus === 'matched' && terms.policyResolutionStatus !== 'resolved') {
        fail('BILLING_SOURCE_POLICY_UNRESOLVED', 'Matched snapshots cannot use unresolved terms policies.', 'effectiveTerms');
      }

      const nextVersion = (latest ? Number(latest.version) : 0) + 1;
      const periodVersionId = id('billing-source-period-version');
      const snapshotId = id('billing-source-snapshot');
      db.prepare(`
        INSERT INTO ${BILLING_SOURCE_PERIOD_VERSIONS_TABLE} (
          id, companyId, branchId, periodId, version, eventType, previousVersionId,
          reopensClosedVersionId, effectiveTermsVersionId, snapshotId, operationId,
          actorPrincipalId, actorMembershipId, actorMembershipVersion,
          capabilityCatalogVersion, capabilityKey, reasonCode, reasonText,
          sourceEventId, sourceEventVersion, sourceHash, schemaVersion, createdAt
        ) VALUES (
          @id, @companyId, @branchId, @periodId, @version, 'closed', @previousVersionId,
          NULL, @effectiveTermsVersionId, @snapshotId, @operationId,
          @actorPrincipalId, @actorMembershipId, @actorMembershipVersion,
          @capabilityCatalogVersion, 'billing.period.close', NULL, NULL,
          @sourceEventId, @sourceEventVersion, @sourceHash, @schemaVersion, @createdAt
        )
      `).run({
        id: periodVersionId,
        companyId: context.companyId,
        branchId: context.branchId,
        periodId: periodResult.row.id,
        version: nextVersion,
        previousVersionId: latest?.id || null,
        effectiveTermsVersionId: terms.id,
        snapshotId,
        operationId,
        actorPrincipalId: context.principalId,
        actorMembershipId: context.membershipId,
        actorMembershipVersion: context.membershipVersion,
        capabilityCatalogVersion: context.capabilityCatalogVersion,
        sourceEventId: plan.sourceEventId,
        sourceEventVersion: plan.sourceEventVersion,
        sourceHash: plan.sourceHash,
        schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
        createdAt,
      });
      db.prepare(`
        INSERT INTO ${BILLING_SOURCE_SNAPSHOTS_TABLE} (
          id, companyId, branchId, rentalId, rentalLineId, periodId,
          closedPeriodVersionId, effectiveTermsVersionId, coveredStartDate,
          coveredEndDateExclusive, companyTimezone, currency, preDiscountNetMinor,
          discountMinor, netMinor, vatMinor, grossMinor, calculationAlgorithmVersion,
          calculationPolicyRef, vatPolicyRef, roundingPolicyRef, policyDecisionRef,
          sourceIntegrityStatus, blockerReasonCodesJson, calculationInputsJson,
          calculationInputsHash, evidenceSetHash, sourceHash, schemaVersion, createdAt
        ) VALUES (
          @id, @companyId, @branchId, @rentalId, @rentalLineId, @periodId,
          @closedPeriodVersionId, @effectiveTermsVersionId, @coveredStartDate,
          @coveredEndDateExclusive, @companyTimezone, @currency, @preDiscountNetMinor,
          @discountMinor, @netMinor, @vatMinor, @grossMinor, @calculationAlgorithmVersion,
          @calculationPolicyRef, @vatPolicyRef, @roundingPolicyRef, @policyDecisionRef,
          @sourceIntegrityStatus, @blockerReasonCodesJson, @calculationInputsJson,
          @calculationInputsHash, @evidenceSetHash, @sourceHash, @schemaVersion, @createdAt
        )
      `).run({
        id: snapshotId,
        companyId: context.companyId,
        branchId: context.branchId,
        rentalId: line.row.rentalId,
        rentalLineId: line.row.id,
        periodId: periodResult.row.id,
        closedPeriodVersionId: periodVersionId,
        effectiveTermsVersionId: terms.id,
        coveredStartDate: periodResult.row.periodStartDate,
        coveredEndDateExclusive: periodResult.row.periodEndDateExclusive,
        companyTimezone: context.companyTimezone,
        currency: plan.snapshot.currency,
        preDiscountNetMinor: plan.snapshot.preDiscountNetMinor,
        discountMinor: plan.snapshot.discountMinor,
        netMinor: plan.snapshot.netMinor,
        vatMinor: plan.snapshot.vatMinor,
        grossMinor: plan.snapshot.grossMinor,
        calculationAlgorithmVersion: plan.snapshot.calculationAlgorithmVersion,
        calculationPolicyRef: plan.snapshot.calculationPolicyRef,
        vatPolicyRef: plan.snapshot.vatPolicyRef,
        roundingPolicyRef: plan.snapshot.roundingPolicyRef,
        policyDecisionRef: plan.snapshot.policyDecisionRef,
        sourceIntegrityStatus: plan.snapshot.sourceIntegrityStatus,
        blockerReasonCodesJson: json(plan.snapshot.blockerReasonCodes),
        calculationInputsJson: json(plan.snapshot.calculationInputs),
        calculationInputsHash: plan.snapshot.calculationInputsHash,
        evidenceSetHash: plan.snapshot.evidenceSetHash,
        sourceHash: plan.snapshot.sourceHash,
        schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
        createdAt,
      });
      const insertEvidence = db.prepare(`
        INSERT INTO ${BILLING_SOURCE_SNAPSHOT_EVIDENCE_TABLE} (
          id, companyId, branchId, snapshotId, evidenceType, sourceSystem,
          sourceId, sourceVersion, sourceEventId, sourceEventVersion,
          coveredStartDate, coveredEndDateExclusive, authorityStatus,
          authorityPolicyRef, evidenceHash, schemaVersion, createdAt
        ) VALUES (
          @id, @companyId, @branchId, @snapshotId, @evidenceType, @sourceSystem,
          @sourceId, @sourceVersion, @sourceEventId, @sourceEventVersion,
          @coveredStartDate, @coveredEndDateExclusive, @authorityStatus,
          @authorityPolicyRef, @evidenceHash, @schemaVersion, @createdAt
        )
      `);
      for (const evidence of plan.evidence) {
        if (
          evidence.coveredStartDate < periodResult.row.periodStartDate
          || evidence.coveredEndDateExclusive > periodResult.row.periodEndDateExclusive
        ) fail('BILLING_SOURCE_EVIDENCE_COVERAGE_INVALID', 'Evidence coverage must remain inside the closed period.', 'evidence');
        insertEvidence.run({
          id: id('billing-source-evidence'),
          companyId: context.companyId,
          branchId: context.branchId,
          snapshotId,
          ...evidence,
          schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
          createdAt,
        });
      }
      const resultFingerprint = fingerprint({
        schemaVersion: 1,
        periodId: periodResult.row.id,
        periodVersionId,
        version: nextVersion,
        snapshotId,
        sourceHash: plan.sourceHash,
      });
      return finish(context, plan, {
        aggregateType: 'billing_period',
        aggregateId: periodResult.row.id,
        version: nextVersion,
        fingerprint: resultFingerprint,
      }, operationId, createdAt, {
        eventType: 'billing_period.closed',
        beforeFingerprint: latest?.sourceHash || null,
        sourceSystem: line.row.sourceSystem,
      });
    });
  }

  function reopenBillingPeriod(context, plan) {
    assertBillingSourceCommandContext(context);
    assertBillingSourceCommandPlan(plan, 'reopen_billing_period');
    return transaction(() => {
      authorize(context, 'billing.period.reopen');
      const replay = replayOrConflict(context, plan);
      if (replay) return replay;
      const period = requireScopedById(BILLING_SOURCE_PERIODS_TABLE, context, plan.periodId);
      const latest = assertExpectedPeriodState(context, period, plan.expectedPeriodVersion, 'closed');
      const createdAt = nowIso();
      const operationId = id('billing-source-operation');
      const versionId = id('billing-source-period-version');
      const nextVersion = Number(latest.version) + 1;
      db.prepare(`
        INSERT INTO ${BILLING_SOURCE_PERIOD_VERSIONS_TABLE} (
          id, companyId, branchId, periodId, version, eventType, previousVersionId,
          reopensClosedVersionId, effectiveTermsVersionId, snapshotId, operationId,
          actorPrincipalId, actorMembershipId, actorMembershipVersion,
          capabilityCatalogVersion, capabilityKey, reasonCode, reasonText,
          sourceEventId, sourceEventVersion, sourceHash, schemaVersion, createdAt
        ) VALUES (
          @id, @companyId, @branchId, @periodId, @version, 'reopened', @previousVersionId,
          @reopensClosedVersionId, NULL, NULL, @operationId,
          @actorPrincipalId, @actorMembershipId, @actorMembershipVersion,
          @capabilityCatalogVersion, 'billing.period.reopen', @reasonCode, @reasonText,
          @sourceEventId, @sourceEventVersion, @sourceHash, @schemaVersion, @createdAt
        )
      `).run({
        id: versionId,
        companyId: context.companyId,
        branchId: context.branchId,
        periodId: period.id,
        version: nextVersion,
        previousVersionId: latest.id,
        reopensClosedVersionId: latest.id,
        operationId,
        actorPrincipalId: context.principalId,
        actorMembershipId: context.membershipId,
        actorMembershipVersion: context.membershipVersion,
        capabilityCatalogVersion: context.capabilityCatalogVersion,
        reasonCode: plan.reasonCode,
        reasonText: plan.reasonText,
        sourceEventId: plan.sourceEventId,
        sourceEventVersion: plan.sourceEventVersion,
        sourceHash: plan.sourceHash,
        schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
        createdAt,
      });
      const resultFingerprint = fingerprint({ schemaVersion: 1, periodId: period.id, versionId, version: nextVersion, sourceHash: plan.sourceHash });
      return finish(context, plan, {
        aggregateType: 'billing_period',
        aggregateId: period.id,
        version: nextVersion,
        fingerprint: resultFingerprint,
      }, operationId, createdAt, {
        eventType: 'billing_period.reopened',
        reasonCode: plan.reasonCode,
        reasonText: plan.reasonText,
        beforeFingerprint: latest.sourceHash,
      });
    });
  }

  function updIdentityContent(context, upd) {
    return {
      companyId: context.companyId,
      branchId: context.branchId,
      clientId: upd.clientId,
      contractId: upd.contractId,
      sourceSystem: upd.sourceSystem,
      sourceDocumentRef: upd.sourceDocumentRef,
      legacyDocumentId: upd.legacyDocumentId,
      documentNumber: upd.documentNumber,
      documentDate: upd.documentDate,
      currency: upd.currency,
    };
  }

  function insertUpdVersion(context, row) {
    db.prepare(`
      INSERT INTO ${BILLING_SOURCE_UPD_VERSIONS_TABLE} (
        id, companyId, branchId, updId, version, state, previousVersionId,
        formedVersionId, correctsUpdVersionId, supersedesUpdVersionId,
        operationId, actorPrincipalId, actorMembershipId, actorMembershipVersion,
        capabilityCatalogVersion, capabilityKey, reasonCode, reasonText,
        lineSetHash, contentHash, sourceEventId, sourceEventVersion, conductedAt,
        conductedEvidenceRef, conductedEvidenceVersion, conductedEvidenceHash,
        conductedPolicyDecisionRef, clientSignatureEvidenceRef,
        signatureRequirementPolicyRef, sourceIntegrityStatus,
        blockerReasonCodesJson, schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @updId, @version, @state, @previousVersionId,
        @formedVersionId, @correctsUpdVersionId, @supersedesUpdVersionId,
        @operationId, @actorPrincipalId, @actorMembershipId, @actorMembershipVersion,
        @capabilityCatalogVersion, @capabilityKey, @reasonCode, @reasonText,
        @lineSetHash, @contentHash, @sourceEventId, @sourceEventVersion, @conductedAt,
        @conductedEvidenceRef, @conductedEvidenceVersion, @conductedEvidenceHash,
        @conductedPolicyDecisionRef, @clientSignatureEvidenceRef,
        @signatureRequirementPolicyRef, @sourceIntegrityStatus,
        @blockerReasonCodesJson, @schemaVersion, @createdAt
      )
    `).run({
      companyId: context.companyId,
      branchId: context.branchId,
      actorPrincipalId: context.principalId,
      actorMembershipId: context.membershipId,
      actorMembershipVersion: context.membershipVersion,
      capabilityCatalogVersion: context.capabilityCatalogVersion,
      schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
      reasonCode: null,
      reasonText: null,
      lineSetHash: null,
      conductedAt: null,
      conductedEvidenceRef: null,
      conductedEvidenceVersion: null,
      conductedEvidenceHash: null,
      conductedPolicyDecisionRef: null,
      clientSignatureEvidenceRef: null,
      signatureRequirementPolicyRef: null,
      ...row,
      blockerReasonCodesJson: json(row.blockerReasonCodes || []),
    });
  }

  function insertOrVersionUpdLines(context, upd, formedVersionId, lines, createdAt, { allowExisting }) {
    const results = [];
    for (const line of lines) {
      let logical = db.prepare(`
        SELECT *
        FROM ${BILLING_SOURCE_UPD_LINES_TABLE}
        WHERE companyId = ? AND branchId = ? AND updId = ?
          AND sourceLineRef = ?
      `).get(context.companyId, context.branchId, upd.id, line.sourceLineRef) || null;
      if (logical && !allowExisting) {
        fail('BILLING_SOURCE_UPD_LINE_CONFLICT', 'Initial UPD line identity already exists.', 'lines');
      }
      if (logical && logical.sourceLineIdentityKind !== line.sourceLineIdentityKind) {
        fail('BILLING_SOURCE_UPD_LINE_CONFLICT', 'Stable UPD line identity kind cannot change.', 'lines');
      }
      if (logical && line.id && line.id !== logical.id) nonDisclosingNotFound();
      if (!logical) {
        if (line.id) nonDisclosingNotFound();
        const logicalId = id('billing-source-upd-line');
        const identityHash = fingerprint({
          schemaVersion: 1,
          companyId: context.companyId,
          branchId: context.branchId,
          updId: upd.id,
          sourceLineIdentityKind: line.sourceLineIdentityKind,
          sourceLineRef: line.sourceLineRef,
        });
        db.prepare(`
          INSERT INTO ${BILLING_SOURCE_UPD_LINES_TABLE} (
            id, companyId, branchId, updId, sourceLineRef,
            sourceLineIdentityKind, identityHash, schemaVersion, createdAt
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          logicalId,
          context.companyId,
          context.branchId,
          upd.id,
          line.sourceLineRef,
          line.sourceLineIdentityKind,
          identityHash,
          BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
          createdAt,
        );
        logical = requireScopedById(BILLING_SOURCE_UPD_LINES_TABLE, context, logicalId);
      }
      const latest = db.prepare(`
        SELECT *
        FROM ${BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE}
        WHERE companyId = ? AND branchId = ? AND updLineId = ?
        ORDER BY version DESC, id DESC LIMIT 1
      `).get(context.companyId, context.branchId, logical.id) || null;
      const lineVersion = latest ? Number(latest.version) + 1 : 1;
      const lineVersionId = id('billing-source-upd-line-version');
      const contentHash = fingerprint({
        schemaVersion: 1,
        updLineId: logical.id,
        formedUpdVersionId: formedVersionId,
        version: lineVersion,
        sourceLineRef: line.sourceLineRef,
        displayPosition: line.displayPosition,
        description: line.description,
        quantityValueInteger: line.quantityValueInteger,
        quantityScale: line.quantityScale,
        unitCode: line.unitCode,
        currency: line.currency,
        netMinor: line.netMinor,
        vatMinor: line.vatMinor,
        grossMinor: line.grossMinor,
        vatPolicyRef: line.vatPolicyRef,
        roundingPolicyRef: line.roundingPolicyRef,
        policyDecisionRef: line.policyDecisionRef,
        sourceIntegrityStatus: line.sourceIntegrityStatus,
        blockerReasonCodes: line.blockerReasonCodes,
        sourceSystem: line.sourceSystem,
        sourceRef: line.sourceRef,
        sourceVersion: line.sourceVersion,
        sourceHash: line.sourceHash,
      });
      db.prepare(`
        INSERT INTO ${BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE} (
          id, companyId, branchId, updLineId, formedUpdVersionId, version,
          supersedesLineVersionId, displayPosition, description,
          quantityValueInteger, quantityScale, unitCode, currency,
          netMinor, vatMinor, grossMinor, vatPolicyRef, roundingPolicyRef,
          policyDecisionRef, sourceIntegrityStatus, blockerReasonCodesJson,
          sourceSystem, sourceRef, sourceVersion, contentHash, schemaVersion, createdAt
        ) VALUES (
          @id, @companyId, @branchId, @updLineId, @formedUpdVersionId, @version,
          @supersedesLineVersionId, @displayPosition, @description,
          @quantityValueInteger, @quantityScale, @unitCode, @currency,
          @netMinor, @vatMinor, @grossMinor, @vatPolicyRef, @roundingPolicyRef,
          @policyDecisionRef, @sourceIntegrityStatus, @blockerReasonCodesJson,
          @sourceSystem, @sourceRef, @sourceVersion, @contentHash, @schemaVersion, @createdAt
        )
      `).run({
        id: lineVersionId,
        companyId: context.companyId,
        branchId: context.branchId,
        updLineId: logical.id,
        formedUpdVersionId: formedVersionId,
        version: lineVersion,
        supersedesLineVersionId: latest?.id || null,
        displayPosition: line.displayPosition,
        description: line.description,
        quantityValueInteger: line.quantityValueInteger,
        quantityScale: line.quantityScale,
        unitCode: line.unitCode,
        currency: line.currency,
        netMinor: line.netMinor,
        vatMinor: line.vatMinor,
        grossMinor: line.grossMinor,
        vatPolicyRef: line.vatPolicyRef,
        roundingPolicyRef: line.roundingPolicyRef,
        policyDecisionRef: line.policyDecisionRef,
        sourceIntegrityStatus: line.sourceIntegrityStatus,
        blockerReasonCodesJson: json(line.blockerReasonCodes),
        sourceSystem: line.sourceSystem,
        sourceRef: line.sourceRef,
        sourceVersion: line.sourceVersion,
        contentHash,
        schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
        createdAt,
      });
      results.push({ logical, version: requireScopedById(BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE, context, lineVersionId), input: line });
    }
    return results;
  }

  function validateAndInsertCoverage(context, plan, upd, formedVersion, lineResults, coverage, operationId, createdAt) {
    if (!coverage) return null;
    const latestForFormed = db.prepare(`
      SELECT *
      FROM ${BILLING_SOURCE_COVERAGE_SETS_TABLE}
      WHERE companyId = ? AND branchId = ? AND updId = ? AND formedUpdVersionId = ?
      ORDER BY version DESC, id DESC LIMIT 1
    `).get(context.companyId, context.branchId, upd.id, formedVersion.id) || null;
    const latestVersion = latestForFormed ? Number(latestForFormed.version) : 0;
    if (latestVersion !== coverage.expectedCoverageVersion) {
      fail('BILLING_SOURCE_COVERAGE_STALE', 'The expected coverage version is stale.', 'coverage.expectedCoverageVersion');
    }
    let predecessor = null;
    if (coverage.supersedesCoverageSetId) {
      predecessor = requireScopedById(BILLING_SOURCE_COVERAGE_SETS_TABLE, context, coverage.supersedesCoverageSetId);
      if (predecessor.updId !== upd.id || predecessor.status !== 'validated') nonDisclosingNotFound();
      const successor = db.prepare(`
        SELECT id FROM ${BILLING_SOURCE_COVERAGE_SETS_TABLE}
        WHERE companyId = ? AND branchId = ?
          AND supersedesCoverageSetId = ? AND status = 'validated'
      `).get(context.companyId, context.branchId, predecessor.id);
      if (successor) fail('BILLING_SOURCE_COVERAGE_LINEAGE_CONFLICT', 'Validated coverage lineage cannot branch.', 'coverage.supersedesCoverageSetId');
    } else if (latestForFormed?.status === 'validated' && coverage.status === 'validated') {
      fail('BILLING_SOURCE_COVERAGE_SUPERSESSION_REQUIRED', 'Validated replacement must reference its predecessor.', 'coverage.supersedesCoverageSetId');
    }
    const byLineId = new Map(lineResults.map(item => [item.logical.id, item]));
    const bySourceRef = new Map(lineResults.map(item => [item.logical.sourceLineRef, item]));
    const normalizedSlices = [];
    for (const source of coverage.slices) {
      const line = source.updLineId ? byLineId.get(source.updLineId) : bySourceRef.get(source.sourceLineRef);
      if (!line) nonDisclosingNotFound();
      if (source.updLineVersionId && source.updLineVersionId !== line.version.id) nonDisclosingNotFound();
      const period = requireScopedById(BILLING_SOURCE_PERIODS_TABLE, context, source.periodId);
      const closedVersion = requireScopedById(BILLING_SOURCE_PERIOD_VERSIONS_TABLE, context, source.closedPeriodVersionId);
      const snapshot = requireScopedById(BILLING_SOURCE_SNAPSHOTS_TABLE, context, source.snapshotId);
      const latestPeriod = latestPeriodVersion(context, period.id);
      if (
        closedVersion.periodId !== period.id
        || closedVersion.eventType !== 'closed'
        || latestPeriod?.id !== closedVersion.id
        || snapshot.closedPeriodVersionId !== closedVersion.id
        || snapshot.periodId !== period.id
      ) fail('BILLING_SOURCE_PERIOD_NOT_CLOSED', 'Coverage requires the exact current closed period version and snapshot.', 'coverage.slices');
      if (source.sliceStartDate < period.periodStartDate || source.sliceEndDateExclusive > period.periodEndDateExclusive) {
        fail('BILLING_SOURCE_SLICE_OUTSIDE_PERIOD', 'Coverage slice must be contained inside its period.', 'coverage.slices');
      }
      const rentalLine = requireScopedById(BILLING_SOURCE_RENTAL_LINES_TABLE, context, period.rentalLineId);
      if (
        snapshot.rentalLineId !== rentalLine.id
        || snapshot.rentalId !== rentalLine.rentalId
        || period.rentalId !== rentalLine.rentalId
        || rentalLine.clientId !== upd.clientId
      ) fail('BILLING_SOURCE_COVERAGE_SCOPE_MISMATCH', 'Coverage references inconsistent rental/client source.', 'coverage.slices');
      const contractMismatch = !rentalLine.contractId || !upd.contractId || rentalLine.contractId !== upd.contractId;
      if (coverage.status === 'validated' && contractMismatch) {
        fail('BILLING_SOURCE_CONTRACT_UNRESOLVED', 'Validated coverage requires exact contract identity.', 'coverage.slices');
      }
      if (
        coverage.status === 'validated'
        && (snapshot.sourceIntegrityStatus !== 'matched' || line.version.sourceIntegrityStatus !== 'matched')
      ) fail('BILLING_SOURCE_BLOCKED_MAPPING', 'Blocked snapshot or line cannot enter validated coverage.', 'coverage');
      if (snapshot.currency !== upd.currency || line.version.currency !== upd.currency) {
        fail('BILLING_SOURCE_CURRENCY_MISMATCH', 'Coverage currency must match UPD, line, and snapshot.', 'coverage.slices');
      }
      normalizedSlices.push({ source, line, period, closedVersion, snapshot, rentalLine });
    }
    for (let left = 0; left < normalizedSlices.length; left += 1) {
      for (let right = left + 1; right < normalizedSlices.length; right += 1) {
        const a = normalizedSlices[left];
        const b = normalizedSlices[right];
        if (
          a.period.id === b.period.id
          && a.source.sliceStartDate < b.source.sliceEndDateExclusive
          && b.source.sliceStartDate < a.source.sliceEndDateExclusive
        ) fail('BILLING_SOURCE_COVERAGE_OVERLAP', 'Coverage slices cannot overlap economically.', 'coverage.slices');
      }
    }
    if (coverage.status === 'validated') {
      const lineGroups = new Map();
      const snapshotGroups = new Map();
      for (const item of normalizedSlices) {
        const lineGroup = lineGroups.get(item.line.version.id) || { row: item.line.version, net: [], vat: [], gross: [] };
        lineGroup.net.push(item.source.allocatedNetMinor);
        lineGroup.vat.push(item.source.allocatedVatMinor);
        lineGroup.gross.push(item.source.allocatedGrossMinor);
        lineGroups.set(item.line.version.id, lineGroup);
        const snapshotGroup = snapshotGroups.get(item.snapshot.id) || { row: item.snapshot, net: [], vat: [], gross: [] };
        snapshotGroup.net.push(item.source.allocatedNetMinor);
        snapshotGroup.vat.push(item.source.allocatedVatMinor);
        snapshotGroup.gross.push(item.source.allocatedGrossMinor);
        snapshotGroups.set(item.snapshot.id, snapshotGroup);
      }
      for (const group of lineGroups.values()) {
        if (
          safeAdd(group.net, 'coverage.line.net') !== group.row.netMinor
          || safeAdd(group.vat, 'coverage.line.vat') !== group.row.vatMinor
          || safeAdd(group.gross, 'coverage.line.gross') !== group.row.grossMinor
        ) fail('BILLING_SOURCE_LINE_RECONCILIATION', 'UPD line allocations must reconcile exactly.', 'coverage.slices');
      }
      for (const group of snapshotGroups.values()) {
        if (
          safeAdd(group.net, 'coverage.snapshot.net') !== group.row.netMinor
          || safeAdd(group.vat, 'coverage.snapshot.vat') !== group.row.vatMinor
          || safeAdd(group.gross, 'coverage.snapshot.gross') !== group.row.grossMinor
        ) fail('BILLING_SOURCE_SNAPSHOT_RECONCILIATION', 'Snapshot allocations must reconcile exactly.', 'coverage.slices');
      }
      if (lineGroups.size !== lineResults.length) {
        fail('BILLING_SOURCE_LINE_COVERAGE_INCOMPLETE', 'Every formed UPD line must participate in validated coverage.', 'coverage.slices');
      }
    }
    const mappingHash = fingerprint({
      schemaVersion: 1,
      mappingAlgorithmVersion: coverage.mappingAlgorithmVersion,
      updId: upd.id,
      formedUpdVersionId: formedVersion.id,
      status: coverage.status,
      slices: normalizedSlices.map(item => ({
        updLineId: item.line.logical.id,
        updLineVersionId: item.line.version.id,
        periodId: item.period.id,
        closedPeriodVersionId: item.closedVersion.id,
        snapshotId: item.snapshot.id,
        start: item.source.sliceStartDate,
        endExclusive: item.source.sliceEndDateExclusive,
        netMinor: item.source.allocatedNetMinor,
        vatMinor: item.source.allocatedVatMinor,
        grossMinor: item.source.allocatedGrossMinor,
        dueDate: item.source.contractualDueDate,
        dueDateProvenance: item.source.dueDateProvenance,
        dueDateEvidenceRef: item.source.dueDateEvidenceRef,
      })).sort((a, b) => stableJson(a).localeCompare(stableJson(b))),
    });
    const setId = id('billing-source-coverage-set');
    db.prepare(`
      INSERT INTO ${BILLING_SOURCE_COVERAGE_SETS_TABLE} (
        id, companyId, branchId, updId, formedUpdVersionId, version,
        supersedesCoverageSetId, mappingAlgorithmVersion, status, mappingHash,
        netDeltaMinor, vatDeltaMinor, grossDeltaMinor, blockerReasonCodesJson,
        operationId, schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @updId, @formedUpdVersionId, @version,
        @supersedesCoverageSetId, @mappingAlgorithmVersion, @status, @mappingHash,
        @netDeltaMinor, @vatDeltaMinor, @grossDeltaMinor, @blockerReasonCodesJson,
        @operationId, @schemaVersion, @createdAt
      )
    `).run({
      id: setId,
      companyId: context.companyId,
      branchId: context.branchId,
      updId: upd.id,
      formedUpdVersionId: formedVersion.id,
      version: latestVersion + 1,
      supersedesCoverageSetId: predecessor?.id || null,
      mappingAlgorithmVersion: coverage.mappingAlgorithmVersion,
      status: coverage.status,
      mappingHash,
      netDeltaMinor: coverage.netDeltaMinor,
      vatDeltaMinor: coverage.vatDeltaMinor,
      grossDeltaMinor: coverage.grossDeltaMinor,
      blockerReasonCodesJson: json(coverage.blockerReasonCodes),
      operationId,
      schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
      createdAt,
    });
    const insertSlice = db.prepare(`
      INSERT INTO ${BILLING_SOURCE_COVERAGE_SLICES_TABLE} (
        id, companyId, branchId, coverageSetId, updId, formedUpdVersionId,
        updLineId, updLineVersionId, periodId, closedPeriodVersionId,
        snapshotId, rentalId, rentalLineId, clientId, contractId,
        sliceStartDate, sliceEndDateExclusive, allocatedNetMinor,
        allocatedVatMinor, allocatedGrossMinor, currency, contractualDueDate,
        dueDateProvenance, dueDateEvidenceRef, sliceHash, schemaVersion, createdAt
      ) VALUES (
        @id, @companyId, @branchId, @coverageSetId, @updId, @formedUpdVersionId,
        @updLineId, @updLineVersionId, @periodId, @closedPeriodVersionId,
        @snapshotId, @rentalId, @rentalLineId, @clientId, @contractId,
        @sliceStartDate, @sliceEndDateExclusive, @allocatedNetMinor,
        @allocatedVatMinor, @allocatedGrossMinor, @currency, @contractualDueDate,
        @dueDateProvenance, @dueDateEvidenceRef, @sliceHash, @schemaVersion, @createdAt
      )
    `);
    for (const item of normalizedSlices) {
      const sliceContent = {
        schemaVersion: 1,
        coverageSetId: setId,
        updLineId: item.line.logical.id,
        updLineVersionId: item.line.version.id,
        periodId: item.period.id,
        closedPeriodVersionId: item.closedVersion.id,
        snapshotId: item.snapshot.id,
        sliceStartDate: item.source.sliceStartDate,
        sliceEndDateExclusive: item.source.sliceEndDateExclusive,
        allocatedNetMinor: item.source.allocatedNetMinor,
        allocatedVatMinor: item.source.allocatedVatMinor,
        allocatedGrossMinor: item.source.allocatedGrossMinor,
        contractualDueDate: item.source.contractualDueDate,
        dueDateProvenance: item.source.dueDateProvenance,
        dueDateEvidenceRef: item.source.dueDateEvidenceRef,
      };
      insertSlice.run({
        id: id('billing-source-coverage-slice'),
        companyId: context.companyId,
        branchId: context.branchId,
        coverageSetId: setId,
        updId: upd.id,
        formedUpdVersionId: formedVersion.id,
        updLineId: item.line.logical.id,
        updLineVersionId: item.line.version.id,
        periodId: item.period.id,
        closedPeriodVersionId: item.closedVersion.id,
        snapshotId: item.snapshot.id,
        rentalId: item.rentalLine.rentalId,
        rentalLineId: item.rentalLine.id,
        clientId: item.rentalLine.clientId,
        contractId: item.rentalLine.contractId,
        sliceStartDate: item.source.sliceStartDate,
        sliceEndDateExclusive: item.source.sliceEndDateExclusive,
        allocatedNetMinor: item.source.allocatedNetMinor,
        allocatedVatMinor: item.source.allocatedVatMinor,
        allocatedGrossMinor: item.source.allocatedGrossMinor,
        currency: upd.currency,
        contractualDueDate: item.source.contractualDueDate,
        dueDateProvenance: item.source.dueDateProvenance,
        dueDateEvidenceRef: item.source.dueDateEvidenceRef,
        sliceHash: fingerprint(sliceContent),
        schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
        createdAt,
      });
    }
    return requireScopedById(BILLING_SOURCE_COVERAGE_SETS_TABLE, context, setId);
  }

  function formUpd(context, plan) {
    assertBillingSourceCommandContext(context);
    assertBillingSourceCommandPlan(plan, 'form_upd');
    return transaction(() => {
      authorize(context, 'upd.form');
      const replay = replayOrConflict(context, plan);
      if (replay) return replay;
      if (plan.expectedUpdVersion !== 0) fail('BILLING_SOURCE_UPD_STALE', 'Initial form requires expected version zero.', 'expectedUpdVersion');
      const existing = db.prepare(`
        SELECT * FROM ${BILLING_SOURCE_UPDS_TABLE}
        WHERE companyId = ? AND branchId = ? AND sourceSystem = ? AND sourceDocumentRef = ?
      `).get(context.companyId, context.branchId, plan.upd.sourceSystem, plan.upd.sourceDocumentRef);
      if (existing) fail('BILLING_SOURCE_UPD_IDENTITY_CONFLICT', 'The stable UPD source identity already exists.', 'upd.sourceDocumentRef');
      if (plan.upd.id) nonDisclosingNotFound();
      const createdAt = nowIso();
      const operationId = id('billing-source-operation');
      const updId = id('billing-source-upd');
      const updContent = updIdentityContent(context, plan.upd);
      db.prepare(`
        INSERT INTO ${BILLING_SOURCE_UPDS_TABLE} (
          id, companyId, branchId, clientId, contractId, sourceSystem,
          sourceDocumentRef, legacyDocumentId, documentNumber, documentDate,
          currency, identityHash, schemaVersion, createdAt
        ) VALUES (
          @id, @companyId, @branchId, @clientId, @contractId, @sourceSystem,
          @sourceDocumentRef, @legacyDocumentId, @documentNumber, @documentDate,
          @currency, @identityHash, @schemaVersion, @createdAt
        )
      `).run({
        id: updId,
        ...updContent,
        identityHash: fingerprint({ schemaVersion: 1, ...updContent }),
        schemaVersion: BILLING_SOURCE_AUTHORITY_SCHEMA_VERSION,
        createdAt,
      });
      const upd = requireScopedById(BILLING_SOURCE_UPDS_TABLE, context, updId);
      const draftId = id('billing-source-upd-version');
      const formedId = id('billing-source-upd-version');
      insertUpdVersion(context, {
        id: draftId,
        updId,
        version: 1,
        state: 'draft',
        previousVersionId: null,
        formedVersionId: null,
        correctsUpdVersionId: null,
        supersedesUpdVersionId: null,
        operationId,
        capabilityKey: 'upd.form',
        contentHash: fingerprint({ schemaVersion: 1, state: 'draft', upd: updContent, sourceHash: plan.upd.sourceHash }),
        sourceEventId: plan.upd.sourceEventId,
        sourceEventVersion: plan.upd.sourceEventVersion,
        sourceIntegrityStatus: plan.upd.sourceIntegrityStatus,
        blockerReasonCodes: plan.upd.blockerReasonCodes,
        createdAt,
      });
      const lineResults = insertOrVersionUpdLines(context, upd, formedId, plan.lines, createdAt, { allowExisting: false });
      const lineSetHash = fingerprint({
        schemaVersion: 1,
        lines: lineResults.map(item => ({
          sourceLineRef: item.logical.sourceLineRef,
          identityHash: item.logical.identityHash,
          contentHash: item.version.contentHash,
        })).sort((a, b) => a.sourceLineRef.localeCompare(b.sourceLineRef)),
      });
      const formedHash = fingerprint({ schemaVersion: 1, state: 'formed', updId, lineSetHash, sourceHash: plan.upd.sourceHash });
      insertUpdVersion(context, {
        id: formedId,
        updId,
        version: 2,
        state: 'formed',
        previousVersionId: draftId,
        formedVersionId: formedId,
        correctsUpdVersionId: null,
        supersedesUpdVersionId: null,
        operationId,
        capabilityKey: 'upd.form',
        lineSetHash,
        contentHash: formedHash,
        sourceEventId: plan.upd.sourceEventId,
        sourceEventVersion: plan.upd.sourceEventVersion,
        sourceIntegrityStatus: plan.upd.sourceIntegrityStatus,
        blockerReasonCodes: plan.upd.blockerReasonCodes,
        createdAt,
      });
      const formed = requireScopedById(BILLING_SOURCE_UPD_VERSIONS_TABLE, context, formedId);
      validateAndInsertCoverage(context, plan, upd, formed, lineResults, plan.coverage, operationId, createdAt);
      return finish(context, plan, {
        aggregateType: 'upd',
        aggregateId: updId,
        version: 2,
        fingerprint: formedHash,
      }, operationId, createdAt, {
        eventType: 'upd.formed',
        sourceSystem: upd.sourceSystem,
      });
    });
  }

  function lineResultsForFormed(context, updId, formedVersionId) {
    const rows = db.prepare(`
      SELECT
        line.id AS logicalId,
        line.companyId, line.branchId, line.updId, line.sourceLineRef,
        line.sourceLineIdentityKind, line.identityHash,
        version.*
      FROM ${BILLING_SOURCE_UPD_LINES_TABLE} line
      JOIN ${BILLING_SOURCE_UPD_LINE_VERSIONS_TABLE} version
        ON version.updLineId = line.id
       AND version.companyId = line.companyId
       AND version.branchId = line.branchId
      WHERE line.companyId = ? AND line.branchId = ? AND line.updId = ?
        AND version.formedUpdVersionId = ?
      ORDER BY line.sourceLineRef, line.id
    `).all(context.companyId, context.branchId, updId, formedVersionId);
    return rows.map(row => ({
      logical: {
        id: row.logicalId,
        companyId: row.companyId,
        branchId: row.branchId,
        updId: row.updId,
        sourceLineRef: row.sourceLineRef,
        sourceLineIdentityKind: row.sourceLineIdentityKind,
        identityHash: row.identityHash,
      },
      version: { ...row, id: row.id },
    }));
  }

  function recordUpdCoverage(context, plan) {
    assertBillingSourceCommandContext(context);
    assertBillingSourceCommandPlan(plan, 'record_upd_coverage');
    return transaction(() => {
      authorize(context, 'upd.form');
      const replay = replayOrConflict(context, plan);
      if (replay) return replay;
      const upd = requireScopedById(BILLING_SOURCE_UPDS_TABLE, context, plan.updId);
      const formed = requireScopedById(BILLING_SOURCE_UPD_VERSIONS_TABLE, context, plan.formedUpdVersionId);
      const latest = latestUpdVersion(context, upd.id);
      if (
        formed.updId !== upd.id
        || formed.state !== 'formed'
        || Number(latest.version) !== plan.expectedUpdVersion
        || !['formed', 'conducted'].includes(latest.state)
        || (latest.state === 'formed' ? latest.id !== formed.id : latest.formedVersionId !== formed.id)
      ) fail('BILLING_SOURCE_UPD_STALE', 'Coverage requires the current formed version or its exact conducted successor.', 'formedUpdVersionId');
      const lineResults = lineResultsForFormed(context, upd.id, formed.id);
      if (lineResults.length === 0) fail('BILLING_SOURCE_UPD_LINES_REQUIRED', 'Formed UPD has no immutable lines.', 'formedUpdVersionId');
      const createdAt = nowIso();
      const operationId = id('billing-source-operation');
      const coverage = validateAndInsertCoverage(context, plan, upd, formed, lineResults, plan.coverage, operationId, createdAt);
      const resultFingerprint = coverage.mappingHash;
      return finish(context, plan, {
        aggregateType: 'upd_coverage',
        aggregateId: coverage.id,
        version: Number(coverage.version),
        fingerprint: resultFingerprint,
      }, operationId, createdAt, {
        eventType: 'upd.coverage_recorded',
        sourceSystem: upd.sourceSystem,
      });
    });
  }

  function conductUpd(context, plan) {
    assertBillingSourceCommandContext(context);
    assertBillingSourceCommandPlan(plan, 'conduct_upd');
    return transaction(() => {
      authorize(context, 'upd.conduct');
      const replay = replayOrConflict(context, plan);
      if (replay) return replay;
      const upd = requireScopedById(BILLING_SOURCE_UPDS_TABLE, context, plan.updId);
      const formed = requireScopedById(BILLING_SOURCE_UPD_VERSIONS_TABLE, context, plan.formedUpdVersionId);
      const latest = latestUpdVersion(context, upd.id);
      if (
        formed.updId !== upd.id
        || formed.state !== 'formed'
        || latest?.id !== formed.id
        || Number(latest.version) !== plan.expectedUpdVersion
      ) fail('BILLING_SOURCE_UPD_TRANSITION_INVALID', 'Conduct requires the exact current formed version.', 'formedUpdVersionId');
      const createdAt = nowIso();
      const operationId = id('billing-source-operation');
      const versionId = id('billing-source-upd-version');
      const nextVersion = Number(latest.version) + 1;
      const contentHash = fingerprint({
        schemaVersion: 1,
        state: 'conducted',
        updId: upd.id,
        formedVersionId: formed.id,
        lineSetHash: formed.lineSetHash,
        sourceEventId: plan.sourceEventId,
        sourceEventVersion: plan.sourceEventVersion,
        sourceHash: plan.sourceHash,
        conductedEvidenceRef: plan.conductedEvidenceRef,
        conductedEvidenceVersion: plan.conductedEvidenceVersion,
        conductedEvidenceHash: plan.conductedEvidenceHash,
        conductedPolicyDecisionRef: plan.conductedPolicyDecisionRef,
        clientSignatureEvidenceRef: plan.clientSignatureEvidenceRef,
        signatureRequirementPolicyRef: plan.signatureRequirementPolicyRef,
      });
      insertUpdVersion(context, {
        id: versionId,
        updId: upd.id,
        version: nextVersion,
        state: 'conducted',
        previousVersionId: latest.id,
        formedVersionId: formed.id,
        correctsUpdVersionId: null,
        supersedesUpdVersionId: null,
        operationId,
        capabilityKey: 'upd.conduct',
        lineSetHash: formed.lineSetHash,
        contentHash,
        sourceEventId: plan.sourceEventId,
        sourceEventVersion: plan.sourceEventVersion,
        conductedAt: createdAt,
        conductedEvidenceRef: plan.conductedEvidenceRef,
        conductedEvidenceVersion: plan.conductedEvidenceVersion,
        conductedEvidenceHash: plan.conductedEvidenceHash,
        conductedPolicyDecisionRef: plan.conductedPolicyDecisionRef,
        clientSignatureEvidenceRef: plan.clientSignatureEvidenceRef,
        signatureRequirementPolicyRef: plan.signatureRequirementPolicyRef,
        sourceIntegrityStatus: plan.sourceIntegrityStatus,
        blockerReasonCodes: plan.blockerReasonCodes,
        createdAt,
      });
      return finish(context, plan, {
        aggregateType: 'upd',
        aggregateId: upd.id,
        version: nextVersion,
        fingerprint: contentHash,
      }, operationId, createdAt, {
        eventType: 'upd.conducted',
        beforeFingerprint: latest.contentHash,
        sourceSystem: upd.sourceSystem,
      });
    });
  }

  function correctUpd(context, plan) {
    assertBillingSourceCommandContext(context);
    assertBillingSourceCommandPlan(plan, 'correct_upd');
    return transaction(() => {
      authorize(context, 'upd.correct');
      const replay = replayOrConflict(context, plan);
      if (replay) return replay;
      const upd = requireScopedById(BILLING_SOURCE_UPDS_TABLE, context, plan.updId);
      const latest = latestUpdVersion(context, upd.id);
      if (!latest || Number(latest.version) !== plan.expectedUpdVersion || !['formed', 'conducted'].includes(latest.state)) {
        fail('BILLING_SOURCE_UPD_STALE', 'Correction requires the exact current formed or conducted UPD.', 'expectedUpdVersion');
      }
      const createdAt = nowIso();
      const operationId = id('billing-source-operation');
      const correctionId = id('billing-source-upd-version');
      const correctedVersion = Number(latest.version) + 1;
      const correctionHash = fingerprint({
        schemaVersion: 1,
        state: plan.action === 'cancel' ? 'cancelled' : 'corrected',
        updId: upd.id,
        corrects: latest.id,
        reasonCode: plan.reasonCode,
        reasonText: plan.reasonText,
        sourceEventId: plan.sourceEventId,
        sourceEventVersion: plan.sourceEventVersion,
        sourceHash: plan.sourceHash,
      });
      insertUpdVersion(context, {
        id: correctionId,
        updId: upd.id,
        version: correctedVersion,
        state: plan.action === 'cancel' ? 'cancelled' : 'corrected',
        previousVersionId: latest.id,
        formedVersionId: latest.formedVersionId,
        correctsUpdVersionId: latest.id,
        supersedesUpdVersionId: latest.id,
        operationId,
        capabilityKey: 'upd.correct',
        reasonCode: plan.reasonCode,
        reasonText: plan.reasonText,
        lineSetHash: latest.lineSetHash,
        contentHash: correctionHash,
        sourceEventId: plan.sourceEventId,
        sourceEventVersion: plan.sourceEventVersion,
        sourceIntegrityStatus: latest.sourceIntegrityStatus,
        blockerReasonCodes: JSON.parse(latest.blockerReasonCodesJson),
        createdAt,
      });
      if (plan.action === 'cancel') {
        return finish(context, plan, {
          aggregateType: 'upd',
          aggregateId: upd.id,
          version: correctedVersion,
          fingerprint: correctionHash,
        }, operationId, createdAt, {
          eventType: 'upd.cancelled',
          beforeFingerprint: latest.contentHash,
          sourceSystem: upd.sourceSystem,
        });
      }

      const draftId = id('billing-source-upd-version');
      const formedId = id('billing-source-upd-version');
      insertUpdVersion(context, {
        id: draftId,
        updId: upd.id,
        version: correctedVersion + 1,
        state: 'draft',
        previousVersionId: correctionId,
        formedVersionId: null,
        correctsUpdVersionId: latest.id,
        supersedesUpdVersionId: latest.id,
        operationId,
        capabilityKey: 'upd.correct',
        contentHash: fingerprint({ schemaVersion: 1, state: 'draft', updId: upd.id, correctionId, sourceHash: plan.sourceHash }),
        sourceEventId: plan.sourceEventId,
        sourceEventVersion: plan.sourceEventVersion,
        sourceIntegrityStatus: latest.sourceIntegrityStatus,
        blockerReasonCodes: JSON.parse(latest.blockerReasonCodesJson),
        createdAt,
      });
      const lineResults = insertOrVersionUpdLines(context, upd, formedId, plan.lines, createdAt, { allowExisting: true });
      const lineSetHash = fingerprint({
        schemaVersion: 1,
        lines: lineResults.map(item => ({ sourceLineRef: item.logical.sourceLineRef, identityHash: item.logical.identityHash, contentHash: item.version.contentHash }))
          .sort((a, b) => a.sourceLineRef.localeCompare(b.sourceLineRef)),
      });
      const formedHash = fingerprint({ schemaVersion: 1, state: 'formed', updId: upd.id, correctionId, lineSetHash, sourceHash: plan.sourceHash });
      insertUpdVersion(context, {
        id: formedId,
        updId: upd.id,
        version: correctedVersion + 2,
        state: 'formed',
        previousVersionId: draftId,
        formedVersionId: formedId,
        correctsUpdVersionId: latest.id,
        supersedesUpdVersionId: latest.id,
        operationId,
        capabilityKey: 'upd.correct',
        lineSetHash,
        contentHash: formedHash,
        sourceEventId: plan.sourceEventId,
        sourceEventVersion: plan.sourceEventVersion,
        sourceIntegrityStatus: latest.sourceIntegrityStatus,
        blockerReasonCodes: JSON.parse(latest.blockerReasonCodesJson),
        createdAt,
      });
      const formed = requireScopedById(BILLING_SOURCE_UPD_VERSIONS_TABLE, context, formedId);
      validateAndInsertCoverage(context, plan, upd, formed, lineResults, plan.coverage, operationId, createdAt);
      return finish(context, plan, {
        aggregateType: 'upd',
        aggregateId: upd.id,
        version: correctedVersion + 2,
        fingerprint: formedHash,
      }, operationId, createdAt, {
        eventType: 'upd.replaced',
        beforeFingerprint: latest.contentHash,
        reasonCode: plan.reasonCode,
        reasonText: plan.reasonText,
        sourceSystem: upd.sourceSystem,
      });
    });
  }

  return Object.freeze({
    closeBillingPeriod,
    conductUpd,
    correctUpd,
    formUpd,
    recordUpdCoverage,
    reopenBillingPeriod,
  });
}

module.exports = {
  createBillingSourceAuthorityRepository,
};
