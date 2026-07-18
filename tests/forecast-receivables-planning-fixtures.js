import { createRequire } from 'node:module';
import {
  SOURCE_CAPABILITIES,
  closePlan,
  createBillingSourceContext,
  hash,
  insertActivationBoundary,
  sourceRows,
} from './billing-source-authority-fixtures.js';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  ensureForecastReceivablesPlanningSchema,
} = require('../server/lib/forecast-receivables-planning-schema.js');
const {
  createForecastReceivablesPolicyRegistry,
} = require('../server/lib/forecast-receivables-planning-policy.js');
const {
  createForecastReceivablesPlanningService,
} = require('../server/lib/forecast-receivables-planning-service.js');
const {
  createPlatformIdentityRepository,
} = require('../server/lib/platform-identity-repository.js');
const {
  resolveTrustedScope,
} = require('../server/lib/platform-authorization.js');

export const FORECAST_CAPABILITIES = Object.freeze([
  ...SOURCE_CAPABILITIES,
  'forecast.read',
  'forecast.calculate',
]);

export function deterministicForecastPolicy(overrides = {}) {
  return createForecastReceivablesPolicyRegistry({
    coveragePartitionPolicy: {
      version: overrides.coveragePolicyVersion || 'forecast-coverage-test-v1',
      partition({ input }) {
        if (overrides.partition) return overrides.partition({ input });
        return {
          policyVersion: overrides.coveragePolicyVersion || 'forecast-coverage-test-v1',
          slices: [{
            coverageStartDate: input.candidateStartDate,
            coverageEndDateExclusive: input.candidateEndDateExclusive,
          }],
        };
      },
    },
    pricingPolicy: {
      version: overrides.calculationVersion || 'forecast-calculation-test-v1',
      calculate({ input, slice }) {
        if (overrides.calculate) return overrides.calculate({ input, slice });
        const netAmountMinor = input.componentKind === 'planned_future' ? 3_000 : 10_000;
        const vatAmountMinor = input.componentKind === 'planned_future' ? 600 : 2_000;
        return {
          calculationVersion: overrides.calculationVersion || 'forecast-calculation-test-v1',
          calculationPolicyRef: 'forecast-calculation-policy-test-v1',
          vatPolicyRef: 'forecast-vat-policy-test-v1',
          roundingPolicyRef: 'forecast-rounding-policy-test-v1',
          policyDecisionRef: 'forecast-policy-decision-test-v1',
          minimumTermPolicyRef: 'forecast-minimum-term-policy-test-v1',
          netAmountMinor,
          vatAmountMinor,
          grossAmountMinor: netAmountMinor + vatAmountMinor,
          normalizedCalculationEvidence: {
            observedCalendarDays: 30,
            explicitTestPolicy: true,
          },
        };
      },
    },
    confidencePolicy: {
      version: overrides.confidencePolicyVersion || 'forecast-confidence-test-v1',
      classify({ input, slice, pricing }) {
        if (overrides.classify) return overrides.classify({ input, slice, pricing });
        return {
          confidencePolicyVersion: overrides.confidencePolicyVersion || 'forecast-confidence-test-v1',
          confidence: 'high',
          reasonCodes: ['FORECAST_TEST_INPUT_COMPLETE'],
        };
      },
    },
  });
}

export function createForecastTestContext({
  capabilities = FORECAST_CAPABILITIES,
  dbPath = ':memory:',
  policyRegistry = deterministicForecastPolicy(),
  sourceCloseOverrides = {},
} = {}) {
  const context = createBillingSourceContext({ capabilities, dbPath });
  ensureForecastReceivablesPlanningSchema(context.db);
  insertActivationBoundary(context);
  context.service.closeBillingPeriod(context.commandContext, closePlan({
    termsTo: '2026-12-01',
    idempotencyKey: 'forecast-source-close-1',
    ...sourceCloseOverrides,
  }));
  const forecastService = createForecastReceivablesPlanningService({
    db: context.db,
    policyRegistry,
  });
  const forecastCommandContext = forecastService.createCommandContext(context.platformScope);
  return {
    ...context,
    forecastService,
    forecastCommandContext,
  };
}

export function openExistingForecastTestContext(dbPath, {
  policyRegistry = deterministicForecastPolicy(),
  correlationId = 'forecast-concurrency-context',
} = {}) {
  const db = new Database(dbPath);
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  const readUsers = () => JSON.parse(
    db.prepare("SELECT json FROM app_data WHERE name = 'users'").get().json,
  );
  const platformRepository = createPlatformIdentityRepository(db, { readUsers });
  const platformScope = resolveTrustedScope({
    req: { user: { userId: 'U-billing' } },
    repository: platformRepository,
    readUsers,
    nowIso: () => '2026-07-18T06:00:00.000Z',
  });
  const forecastService = createForecastReceivablesPlanningService({
    db,
    policyRegistry,
  });
  const forecastCommandContext = forecastService.createCommandContext(platformScope);
  return {
    db,
    readUsers,
    platformRepository,
    platformScope,
    forecastService,
    forecastCommandContext,
    correlationId,
    close() {
      db.close();
    },
  };
}

export function forecastCommand(context, overrides = {}) {
  const source = sourceRows(context);
  const terms = context.db.prepare(`
    SELECT * FROM billing_source_effective_terms
    WHERE rentalLineId = ? ORDER BY version DESC LIMIT 1
  `).get(source.rentalLine.id);
  const boundary = context.db.prepare(`
    SELECT * FROM billing_source_activation_boundaries WHERE id = ?
  `).get(source.rentalLine.activationBoundaryId);
  const asOfDate = overrides.asOfDate || '2026-09-01';
  const candidateStartDate = overrides.candidateStartDate || asOfDate;
  const candidateEndDateExclusive = overrides.candidateEndDateExclusive || '2026-10-01';
  const rentalStatus = overrides.rentalStatus || 'active';
  const componentKind = overrides.componentKind || 'open_period_forecast';
  const input = {
    rentalLineId: source.rentalLine.id,
    activationBoundaryId: boundary.id,
    activationBoundarySourceHash: boundary.sourceHash,
    effectiveTermsVersionId: terms.id,
    effectiveTermsSourceVersion: terms.sourceVersion,
    effectiveTermsSourceHash: terms.sourceHash,
    clientId: source.rentalLine.clientId,
    contractId: source.rentalLine.contractId,
    rentalId: source.rentalLine.rentalId,
    equipmentId: source.rentalLine.equipmentId,
    rentalStatus,
    componentKind,
    serviceStartDate: '2026-08-01',
    serviceEndDateExclusive: '2026-12-01',
    candidateStartDate,
    candidateEndDateExclusive,
    sourceSystem: source.rentalLine.sourceSystem,
    sourceIdentity: source.rentalLine.sourceLineRef,
    sourceEventId: source.rentalLine.sourceEventId,
    sourceEventVersion: source.rentalLine.sourceEventVersion,
    sourceHash: source.rentalLine.provenanceHash,
    completenessManifest: overrides.completenessManifest === null
      ? null
      : {
          sourceSystem: 'isolated_forecast_test_adapter',
          sourceSnapshotVersion: 1,
          sourceEventWatermarkVersion: 1,
          eventKindsCovered: overrides.eventKindsCovered || [
            'downtime',
            'effective_terms',
            'extension',
            'rental_status',
            'return',
          ],
          coveredStartDate: candidateStartDate,
          coveredEndDateExclusive: candidateEndDateExclusive,
          sourceHash: hash(`forecast-manifest:${source.rentalLine.id}`),
          authorityStatus: 'approved_by_reference',
          policyRef: 'forecast-manifest-policy-test-v1',
        },
    events: overrides.events || [
      {
        eventKind: 'rental_status',
        sourceSystem: 'isolated_forecast_test_adapter',
        sourceId: `status:${source.rentalLine.id}`,
        sourceVersion: 1,
        sourceEventId: `status-event:${source.rentalLine.id}`,
        sourceEventVersion: 1,
        effectiveStartDate: candidateStartDate,
        effectiveEndDateExclusive: candidateEndDateExclusive,
        authorityStatus: 'approved_by_reference',
        authorityPolicyRef: 'forecast-status-policy-test-v1',
        evidenceHash: hash(`forecast-status:${source.rentalLine.id}`),
      },
      {
        eventKind: 'effective_terms',
        sourceSystem: 'isolated_forecast_test_adapter',
        sourceId: terms.id,
        sourceVersion: terms.sourceVersion,
        sourceEventId: `terms-event:${terms.id}`,
        sourceEventVersion: 1,
        effectiveStartDate: candidateStartDate,
        effectiveEndDateExclusive: candidateEndDateExclusive,
        authorityStatus: 'approved_by_reference',
        authorityPolicyRef: 'forecast-terms-policy-test-v1',
        evidenceHash: hash(`forecast-terms:${terms.id}`),
      },
    ],
    ...(overrides.input || {}),
  };
  return {
    branchId: 'branch-a-1',
    asOfDate,
    idempotencyKey: overrides.idempotencyKey || 'forecast-calculation-1',
    correlationId: overrides.correlationId || 'forecast-correlation-1',
    expectedActiveRunIds: overrides.expectedActiveRunIds || [],
    inputSetManifest: overrides.inputSetManifest === null
      ? null
      : {
          sourceSystem: 'isolated_forecast_test_adapter',
          sourceSnapshotVersion: 1,
          coveredBranchId: 'branch-a-1',
          coveredStartDate: asOfDate,
          coveredEndDateExclusive: candidateEndDateExclusive,
          rentalStatusesCovered: ['active', 'planned_future', 'return_planned'],
          authorityStatus: 'approved_by_reference',
          policyRef: 'forecast-input-set-policy-test-v1',
          sourceHash: hash(`forecast-input-set:${asOfDate}`),
        },
    inputs: overrides.inputs || [input],
    ...(overrides.expectedInputSetHash ? { expectedInputSetHash: overrides.expectedInputSetHash } : {}),
    reasonCode: overrides.reasonCode || 'FORECAST_TEST_CALCULATION',
    reasonText: overrides.reasonText || 'Deterministic isolated forecast calculation.',
  };
}
