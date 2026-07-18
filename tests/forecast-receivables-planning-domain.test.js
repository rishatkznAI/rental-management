import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import {
  createForecastTestContext,
  deterministicForecastPolicy,
  forecastCommand,
} from './forecast-receivables-planning-fixtures.js';

const require = createRequire(import.meta.url);
const {
  addCivilDays,
  buildForecastHorizon,
  computeForecastCoverageKey,
  fingerprint,
  materializeForecastCalculationCommand,
} = require('../server/lib/forecast-receivables-planning-domain.js');
const {
  canonicalInputSet,
} = require('../server/lib/forecast-receivables-planning-repository.js');
const {
  createForecastReceivablesPlanningService,
} = require('../server/lib/forecast-receivables-planning-service.js');

test('forecast horizon uses a fixed half-open 30 civil-day interval', () => {
  assert.deepEqual(buildForecastHorizon('2026-01-31', 'Europe/Moscow'), {
    horizonStartDate: '2026-01-31',
    horizonEndDateExclusive: '2026-03-02',
    horizonDays: 30,
    companyTimezone: 'Europe/Moscow',
  });
  assert.equal(addCivilDays('2024-02-10', 30), '2024-03-11');
  assert.equal(addCivilDays('2026-12-15', 30), '2027-01-14');
  assert.equal(addCivilDays('2026-03-01', 30), '2026-03-31');
});

test('forecast horizon rejects invalid company timezones and client-selected horizon fields', () => {
  assert.throws(
    () => buildForecastHorizon('2026-09-01', 'Mars/Olympus'),
    error => error.code === 'FORECAST_INVALID_TIMEZONE',
  );
  const context = createForecastTestContext();
  assert.throws(
    () => context.forecastService.calculateForecastRun(
      context.forecastCommandContext,
      { ...forecastCommand(context), horizonDays: 90 },
    ),
    error => error.code === 'FORECAST_UNKNOWN_FIELD' && error.field === 'command.horizonDays',
  );
  context.close();
});

for (const rentalStatus of ['active', 'return_planned']) {
  test(`${rentalStatus} creates primary open-period forecast only`, () => {
    const context = createForecastTestContext();
    const result = context.forecastService.calculateForecastRun(
      context.forecastCommandContext,
      forecastCommand(context, { rentalStatus }),
    );
    assert.equal(result.status, 'calculated');
    assert.equal(result.openPeriodForecastGrossMinor, 12_000);
    assert.equal(result.primaryForecastMinor, 12_000);
    assert.equal(result.plannedFutureGrossMinor, 0);
    context.close();
  });
}

test('planned_future is separate and excluded from primary forecast', () => {
  const context = createForecastTestContext();
  const result = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, {
      rentalStatus: 'planned_future',
      componentKind: 'planned_future',
    }),
  );
  assert.equal(result.status, 'calculated');
  assert.equal(result.openPeriodForecastGrossMinor, 0);
  assert.equal(result.primaryForecastMinor, 0);
  assert.equal(result.plannedFutureGrossMinor, 3_600);
  const item = context.db.prepare('SELECT * FROM forecast_receivable_items').get();
  assert.equal(item.componentKind, 'planned_future');
  context.close();
});

test('unsupported rental status produces insufficient diagnostic and no monetary item', () => {
  const context = createForecastTestContext();
  const result = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, { rentalStatus: 'legacy_display_label' }),
  );
  assert.equal(result.status, 'insufficient');
  assert.equal(result.itemCount, 0);
  assert.equal(result.primaryForecastMinor, 0);
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_items').get().count, 0);
  assert.ok(context.db.prepare(`
    SELECT 1 FROM forecast_receivable_diagnostics
    WHERE reasonCode = 'FORECAST_UNSUPPORTED_RENTAL_STATUS' AND confidence = 'insufficient'
  `).get());
  context.close();
});

test('missing per-line completeness manifest never treats absent events as zero', () => {
  const context = createForecastTestContext();
  const result = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, { completenessManifest: null }),
  );
  assert.equal(result.status, 'insufficient');
  assert.equal(result.itemCount, 0);
  assert.ok(context.db.prepare(`
    SELECT 1 FROM forecast_receivable_diagnostics
    WHERE reasonCode = 'FORECAST_INPUT_MANIFEST_MISSING'
  `).get());
  context.close();
});

test('incomplete event manifest produces blocking diagnostic without money', () => {
  const context = createForecastTestContext();
  const result = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context, {
      eventKindsCovered: ['effective_terms', 'extension', 'rental_status', 'return'],
    }),
  );
  assert.equal(result.status, 'insufficient');
  assert.equal(result.itemCount, 0);
  assert.ok(context.db.prepare(`
    SELECT 1 FROM forecast_receivable_diagnostics
    WHERE reasonCode = 'FORECAST_INPUT_MANIFEST_INCOMPLETE'
  `).get());
  context.close();
});

test('unresolved return/downtime/extension evidence fails closed', () => {
  for (const [eventKind, reasonCode] of [
    ['return', 'FORECAST_RETURN_AUTHORITY_UNRESOLVED'],
    ['downtime', 'FORECAST_DOWNTIME_AUTHORITY_UNRESOLVED'],
    ['extension', 'FORECAST_EXTENSION_AUTHORITY_UNRESOLVED'],
  ]) {
    const context = createForecastTestContext();
    const base = forecastCommand(context);
    const unresolved = {
      eventKind,
      sourceSystem: 'isolated_forecast_test_adapter',
      sourceId: `${eventKind}-1`,
      sourceVersion: 1,
      sourceEventId: `${eventKind}-event-1`,
      sourceEventVersion: 1,
      effectiveStartDate: '2026-09-01',
      effectiveEndDateExclusive: '2026-10-01',
      authorityStatus: 'unresolved',
      authorityPolicyRef: null,
      evidenceHash: fingerprint(`${eventKind}-evidence`),
    };
    base.inputs[0].events.push(unresolved);
    const result = context.forecastService.calculateForecastRun(context.forecastCommandContext, base);
    assert.equal(result.status, 'insufficient');
    assert.ok(context.db.prepare(`
      SELECT 1 FROM forecast_receivable_diagnostics WHERE reasonCode = ?
    `).get(reasonCode));
    context.close();
  }
});

test('production-default unavailable policies yield explicit blockers and no item', () => {
  const context = createForecastTestContext();
  const service = createForecastReceivablesPlanningService({
    db: context.db,
    readUsers: context.readUsers,
  });
  const result = service.calculateForecastRun(
    service.createCommandContext(context.platformScope),
    forecastCommand(context),
  );
  assert.equal(result.status, 'insufficient');
  assert.equal(result.itemCount, 0);
  const reasons = context.db.prepare(`
    SELECT reasonCode FROM forecast_receivable_diagnostics ORDER BY reasonCode
  `).all().map(row => row.reasonCode);
  for (const reason of [
    'FORECAST_CONFIDENCE_POLICY_UNAVAILABLE',
    'FORECAST_COVERAGE_PARTITION_UNRESOLVED',
    'FORECAST_MINIMUM_TERM_POLICY_UNAVAILABLE',
    'FORECAST_ROUNDING_POLICY_UNAVAILABLE',
    'FORECAST_VAT_POLICY_UNAVAILABLE',
  ]) assert.ok(reasons.includes(reason), reason);
  context.close();
});

test('complete authoritative empty input set creates a distinguishable valid zero run', () => {
  const context = createForecastTestContext();
  const command = forecastCommand(context);
  command.inputs = [];
  const result = context.forecastService.calculateForecastRun(context.forecastCommandContext, command);
  assert.equal(result.status, 'calculated');
  assert.equal(result.completeness, 'complete');
  assert.equal(result.itemCount, 0);
  assert.equal(result.primaryForecastMinor, 0);
  context.close();
});

test('pricing policy rejects float, negative, overflow, and broken net/VAT reconciliation', () => {
  for (const calculated of [
    { netAmountMinor: 1.5, vatAmountMinor: 0, grossAmountMinor: 1.5 },
    { netAmountMinor: -1, vatAmountMinor: 0, grossAmountMinor: -1 },
    { netAmountMinor: Number.MAX_SAFE_INTEGER, vatAmountMinor: 1, grossAmountMinor: Number.MAX_SAFE_INTEGER },
    { netAmountMinor: 100, vatAmountMinor: 20, grossAmountMinor: 119 },
  ]) {
    const policy = deterministicForecastPolicy({
      calculate: () => ({
        calculationVersion: 'forecast-calculation-test-v1',
        calculationPolicyRef: 'calc-v1',
        vatPolicyRef: 'vat-v1',
        roundingPolicyRef: 'round-v1',
        policyDecisionRef: 'decision-v1',
        minimumTermPolicyRef: 'minimum-v1',
        ...calculated,
        normalizedCalculationEvidence: { explicit: true },
      }),
    });
    const context = createForecastTestContext({ policyRegistry: policy });
    assert.throws(
      () => context.forecastService.calculateForecastRun(context.forecastCommandContext, forecastCommand(context)),
      error => [
        'FORECAST_COMMAND_NOT_INERT',
        'FORECAST_INVALID_MONEY',
        'FORECAST_MONEY_OVERFLOW',
        'FORECAST_RECONCILIATION_FAILED',
      ].includes(error.code),
    );
    assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 0);
    context.close();
  }
});

test('confidence policy owns level assignment and cannot create insufficient money', () => {
  const context = createForecastTestContext({
    policyRegistry: deterministicForecastPolicy({
      classify: () => ({
        confidencePolicyVersion: 'forecast-confidence-test-v1',
        confidence: 'insufficient',
        reasonCodes: ['FORECAST_TEST_INSUFFICIENT'],
      }),
    }),
  });
  assert.throws(
    () => context.forecastService.calculateForecastRun(context.forecastCommandContext, forecastCommand(context)),
    error => error.code === 'FORECAST_CONFIDENCE_POLICY_INVALID',
  );
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 0);
  context.close();
});

test('forecast command rejects actual/debt/aging lifecycle fields', () => {
  const context = createForecastTestContext();
  for (const field of [
    'canonicalReceivableId', 'convertedToActual', 'actualized', 'posted', 'overdue',
    'agingBucket', 'collectionStatus', 'settlementStatus', 'contractualDueDate',
    'canonicalWorkflowStatus',
  ]) {
    const command = forecastCommand(context);
    command.inputs[0][field] = 'forbidden';
    assert.throws(
      () => context.forecastService.calculateForecastRun(context.forecastCommandContext, command),
      error => error.code === 'FORECAST_UNKNOWN_FIELD',
      field,
    );
  }
  context.close();
});

test('coverage key is deterministic and changes on material semantic input', () => {
  const base = {
    companyId: 'company-a',
    branchId: 'branch-a-1',
    contractId: 'contract-1',
    rentalId: 'rental-1',
    rentalLineId: 'line-1',
    componentKind: 'open_period_forecast',
    coverageStartDate: '2026-09-01',
    coverageEndDateExclusive: '2026-10-01',
    effectiveTermsVersionId: 'terms-1',
    calculationVersion: 'calculation-v1',
    coveragePolicyVersion: 'coverage-v1',
  };
  const first = computeForecastCoverageKey(base);
  assert.equal(first, computeForecastCoverageKey({ ...base }));
  assert.notEqual(first, computeForecastCoverageKey({ ...base, effectiveTermsVersionId: 'terms-2' }));
  assert.match(first, /^[a-f0-9]{64}$/);
});

test('input-set hash is independent of input and event order and changes on material input', () => {
  const context = createForecastTestContext();
  const firstCommand = forecastCommand(context);
  const secondInput = structuredClone(firstCommand.inputs[0]);
  secondInput.rentalLineId = 'synthetic-line-2';
  secondInput.rentalId = 'synthetic-rental-2';
  secondInput.sourceIdentity = 'synthetic-source-line-2';
  secondInput.sourceEventId = 'synthetic-source-event-2';
  secondInput.sourceHash = fingerprint('synthetic-source-2');
  const commandA = materializeForecastCalculationCommand({
    ...firstCommand,
    inputs: [firstCommand.inputs[0], secondInput],
  });
  const reversedFirst = structuredClone(firstCommand.inputs[0]);
  reversedFirst.events.reverse();
  const commandB = materializeForecastCalculationCommand({
    ...firstCommand,
    inputs: [secondInput, reversedFirst],
  });
  assert.equal(fingerprint(canonicalInputSet(commandA)), fingerprint(canonicalInputSet(commandB)));
  const changed = structuredClone(firstCommand);
  changed.inputs[0].sourceHash = fingerprint('material-change');
  const commandC = materializeForecastCalculationCommand(changed);
  assert.notEqual(fingerprint(canonicalInputSet(commandA)), fingerprint(canonicalInputSet(commandC)));
  context.close();
});

test('deeply inert boundary rejects proxies, accessors, dates, sparse arrays, and secret-like keys', () => {
  const context = createForecastTestContext();
  const cases = [];
  const proxyCommand = forecastCommand(context);
  proxyCommand.inputs[0] = new Proxy(proxyCommand.inputs[0], {});
  cases.push(proxyCommand);
  const getterCommand = forecastCommand(context);
  Object.defineProperty(getterCommand, 'branchId', { enumerable: true, get: () => 'branch-a-1' });
  cases.push(getterCommand);
  const dateCommand = forecastCommand(context);
  dateCommand.inputs[0].events[0].observedAt = new Date();
  cases.push(dateCommand);
  const sparseCommand = forecastCommand(context);
  sparseCommand.inputs = new Array(2);
  sparseCommand.inputs[0] = forecastCommand(context).inputs[0];
  cases.push(sparseCommand);
  const secretCommand = forecastCommand(context);
  secretCommand.inputs[0].accessToken = 'forbidden';
  cases.push(secretCommand);
  for (const command of cases) {
    assert.throws(
      () => context.forecastService.calculateForecastRun(context.forecastCommandContext, command),
      error => ['FORECAST_COMMAND_NOT_INERT', 'FORECAST_SECRET_FIELD_REJECTED'].includes(error.code),
    );
  }
  assert.equal(context.db.prepare('SELECT COUNT(*) AS count FROM forecast_receivable_runs').get().count, 0);
  context.close();
});
