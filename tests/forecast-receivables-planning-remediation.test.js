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
  FORECAST_COMMAND_MAX_BYTES,
} = require('../server/lib/forecast-receivables-planning-domain.js');
const {
  createForecastReceivablesPlanningReadRepository,
  createForecastReceivablesReadScope,
} = require('../server/lib/forecast-receivables-planning-read-repository.js');
const {
  createForecastReceivablesPlanningService,
} = require('../server/lib/forecast-receivables-planning-service.js');
const {
  FORECAST_RECEIVABLES_PLANNING_TABLES,
} = require('../server/lib/forecast-receivables-planning-schema.js');

function forecastCounts(db) {
  return Object.fromEntries(FORECAST_RECEIVABLES_PLANNING_TABLES.map(table => [
    table,
    db.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count,
  ]));
}

function assertNoForecastRows(db) {
  for (const [table, count] of Object.entries(forecastCounts(db))) {
    assert.equal(count, 0, table);
  }
  assert.deepEqual(db.pragma('foreign_key_check'), []);
  assert.equal(db.inTransaction, false);
}

function inputForInterval(input, startDate, endDateExclusive, { manifest = true } = {}) {
  const value = structuredClone(input);
  value.candidateStartDate = startDate;
  value.candidateEndDateExclusive = endDateExclusive;
  value.completenessManifest = manifest ? {
    ...value.completenessManifest,
    coveredStartDate: startDate,
    coveredEndDateExclusive: endDateExclusive,
  } : null;
  value.events = value.events.map(event => ({
    ...event,
    effectiveStartDate: startDate,
    effectiveEndDateExclusive: endDateExclusive,
  }));
  return value;
}

test('persisted input manifests are complete, inspectable, and hash-identical to run, operation, and audit', () => {
  const context = createForecastTestContext();
  const result = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context),
  );
  const run = context.db.prepare('SELECT * FROM forecast_receivable_runs').get();
  const snapshot = context.db.prepare('SELECT * FROM forecast_receivable_input_snapshots').get();
  const operation = context.db.prepare('SELECT * FROM forecast_receivable_operations').get();
  const audit = context.db.prepare('SELECT * FROM forecast_receivable_audit_events').get();

  assert.equal(run.inputSetManifestPresent, 1);
  assert.equal(run.inputSetManifestSourceSystem, 'isolated_forecast_test_adapter');
  assert.equal(run.inputSetManifestSourceSnapshotVersion, 1);
  assert.equal(run.inputSetManifestCoveredBranchId, 'branch-a-1');
  assert.equal(run.inputSetManifestCoveredStartDate, '2026-09-01');
  assert.equal(run.inputSetManifestCoveredEndDateExclusive, '2026-10-01');
  assert.deepEqual(JSON.parse(run.inputSetManifestRentalStatusesJson), ['active', 'planned_future', 'return_planned']);
  assert.equal(run.inputSetManifestAuthorityStatus, 'approved_by_reference');
  assert.equal(run.inputSetManifestPolicyRef, 'forecast-input-set-policy-test-v1');
  assert.match(run.inputSetManifestSourceHash, /^[a-f0-9]{64}$/);
  assert.match(run.inputSetManifestHash, /^[a-f0-9]{64}$/);
  assert.equal(run.inputSetManifestSchemaVersion, 1);
  assert.equal(run.inputSnapshotCount, 1);
  assert.equal(run.inputEventCount, 2);
  assert.equal(run.inputCompletenessManifestCount, 1);

  assert.equal(snapshot.completenessManifestPresent, 1);
  assert.equal(snapshot.manifestSourceSystem, 'isolated_forecast_test_adapter');
  assert.equal(snapshot.manifestSourceSnapshotVersion, 1);
  assert.equal(snapshot.manifestSourceEventWatermarkVersion, 1);
  assert.deepEqual(JSON.parse(snapshot.manifestEventKindsCoveredJson), [
    'downtime', 'effective_terms', 'extension', 'rental_status', 'return',
  ]);
  assert.equal(snapshot.manifestCoveredStartDate, '2026-09-01');
  assert.equal(snapshot.manifestCoveredEndDateExclusive, '2026-10-01');
  assert.match(snapshot.manifestSourceHash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.manifestAuthorityStatus, 'approved_by_reference');
  assert.equal(snapshot.manifestPolicyRef, 'forecast-manifest-policy-test-v1');
  assert.match(snapshot.eventManifestHash, /^[a-f0-9]{64}$/);
  assert.match(snapshot.activationBoundarySourceHash, /^[a-f0-9]{64}$/);
  assert.equal(snapshot.effectiveTermsSourceVersion, 1);
  assert.match(snapshot.effectiveTermsSourceHash, /^[a-f0-9]{64}$/);
  assert.equal(result.inputSetHash, run.inputSetHash);
  assert.equal(run.inputSetHash, operation.inputSetHash);
  assert.equal(operation.inputSetHash, audit.inputSetHash);
  context.close();
});

test('valid complete empty input set retains its full persisted input-set manifest proof', () => {
  const context = createForecastTestContext();
  const command = forecastCommand(context);
  command.inputs = [];
  const result = context.forecastService.calculateForecastRun(context.forecastCommandContext, command);
  const run = context.db.prepare('SELECT * FROM forecast_receivable_runs').get();
  assert.equal(result.status, 'calculated');
  assert.equal(result.completeness, 'complete');
  assert.equal(run.inputSetManifestPresent, 1);
  assert.equal(run.inputSetManifestSourceSystem, command.inputSetManifest.sourceSystem);
  assert.equal(run.inputSetManifestCoveredBranchId, command.inputSetManifest.coveredBranchId);
  assert.deepEqual(JSON.parse(run.inputSetManifestRentalStatusesJson), command.inputSetManifest.rentalStatusesCovered);
  assert.match(run.inputSetManifestHash, /^[a-f0-9]{64}$/);
  assert.equal(run.inputSnapshotCount, 0);
  assert.equal(run.inputEventCount, 0);
  assert.equal(run.inputCompletenessManifestCount, 0);
  assert.equal(context.db.prepare('SELECT inputSetHash FROM forecast_receivable_operations').get().inputSetHash, run.inputSetHash);
  assert.equal(context.db.prepare('SELECT inputSetHash FROM forecast_receivable_audit_events').get().inputSetHash, run.inputSetHash);
  context.close();
});

test('coverage policy requires an exact contiguous candidate cover and hashes distinct valid partitions', () => {
  const calculate = slices => {
    const context = createForecastTestContext({
      policyRegistry: deterministicForecastPolicy({ partition: () => ({
        policyVersion: 'forecast-coverage-test-v1',
        slices,
      }) }),
    });
    const result = context.forecastService.calculateForecastRun(
      context.forecastCommandContext,
      forecastCommand(context),
    );
    context.close();
    return result;
  };
  const full = calculate([{
    coverageStartDate: '2026-09-01',
    coverageEndDateExclusive: '2026-10-01',
  }]);
  const adjacent = calculate([
    { coverageStartDate: '2026-09-01', coverageEndDateExclusive: '2026-09-15' },
    { coverageStartDate: '2026-09-15', coverageEndDateExclusive: '2026-10-01' },
  ]);
  assert.equal(full.status, 'calculated');
  assert.equal(full.itemCount, 1);
  assert.equal(adjacent.status, 'calculated');
  assert.equal(adjacent.itemCount, 2);
  assert.notEqual(full.resultHash, adjacent.resultHash);

  const invalidPartitions = [
    [{ coverageStartDate: '2026-09-02', coverageEndDateExclusive: '2026-10-01' }],
    [{ coverageStartDate: '2026-09-01', coverageEndDateExclusive: '2026-09-30' }],
    [
      { coverageStartDate: '2026-09-01', coverageEndDateExclusive: '2026-09-15' },
      { coverageStartDate: '2026-09-16', coverageEndDateExclusive: '2026-10-01' },
    ],
    [
      { coverageStartDate: '2026-09-01', coverageEndDateExclusive: '2026-09-20' },
      { coverageStartDate: '2026-09-15', coverageEndDateExclusive: '2026-10-01' },
    ],
    [
      { coverageStartDate: '2026-09-01', coverageEndDateExclusive: '2026-10-01' },
      { coverageStartDate: '2026-09-01', coverageEndDateExclusive: '2026-10-01' },
    ],
    [
      { coverageStartDate: '2026-09-01', coverageEndDateExclusive: '2026-09-30' },
    ],
  ];
  for (const slices of invalidPartitions) {
    const context = createForecastTestContext({
      policyRegistry: deterministicForecastPolicy({ partition: () => ({
        policyVersion: 'forecast-coverage-test-v1',
        slices,
      }) }),
    });
    assert.throws(
      () => context.forecastService.calculateForecastRun(
        context.forecastCommandContext,
        forecastCommand(context),
      ),
      error => error.code === 'FORECAST_COVERAGE_POLICY_INVALID',
    );
    assertNoForecastRows(context.db);
    context.close();
  }

  const emptyContext = createForecastTestContext({
    policyRegistry: deterministicForecastPolicy({ partition: () => ({
      policyVersion: 'forecast-coverage-test-v1',
      slices: [],
    }) }),
  });
  const empty = emptyContext.forecastService.calculateForecastRun(
    emptyContext.forecastCommandContext,
    forecastCommand(emptyContext),
  );
  assert.equal(empty.status, 'insufficient');
  assert.equal(empty.completeness, 'insufficient');
  assert.equal(empty.itemCount, 0);
  assert.ok(emptyContext.db.prepare(`
    SELECT 1 FROM forecast_receivable_diagnostics
    WHERE reasonCode = 'FORECAST_COVERAGE_PARTITION_UNRESOLVED' AND severity = 'blocking'
  `).get());
  emptyContext.close();
});

test('candidate interval must be inside service before policy and policy cannot escape service', () => {
  for (const inputPatch of [
    { serviceStartDate: '2026-09-02', serviceEndDateExclusive: '2026-10-01' },
    { serviceStartDate: '2026-09-01', serviceEndDateExclusive: '2026-09-30' },
    { serviceStartDate: '2026-10-01', serviceEndDateExclusive: '2026-11-01' },
  ]) {
    let callbacks = 0;
    const context = createForecastTestContext({
      policyRegistry: deterministicForecastPolicy({ partition: ({ input }) => {
        callbacks += 1;
        return {
          policyVersion: 'forecast-coverage-test-v1',
          slices: [{
            coverageStartDate: input.candidateStartDate,
            coverageEndDateExclusive: input.candidateEndDateExclusive,
          }],
        };
      } }),
    });
    const command = forecastCommand(context);
    Object.assign(command.inputs[0], inputPatch);
    assert.throws(
      () => context.forecastService.calculateForecastRun(context.forecastCommandContext, command),
      error => error.code === 'FORECAST_CANDIDATE_OUTSIDE_SERVICE_INTERVAL',
    );
    assert.equal(callbacks, 0);
    assertNoForecastRows(context.db);
    context.close();
  }

  for (const [service, candidate] of [
    [['2026-09-01', '2026-10-01'], ['2026-09-01', '2026-10-01']],
    [['2026-09-01', '2026-10-01'], ['2026-09-02', '2026-09-30']],
  ]) {
    const context = createForecastTestContext();
    const command = forecastCommand(context, {
      candidateStartDate: candidate[0],
      candidateEndDateExclusive: candidate[1],
    });
    command.inputSetManifest.coveredEndDateExclusive = '2026-10-01';
    command.inputs[0].serviceStartDate = service[0];
    command.inputs[0].serviceEndDateExclusive = service[1];
    const result = context.forecastService.calculateForecastRun(context.forecastCommandContext, command);
    assert.equal(result.status, 'calculated');
    assert.equal(result.itemCount, 1);
    context.close();
  }

  const escaped = createForecastTestContext({
    policyRegistry: deterministicForecastPolicy({ partition: () => ({
      policyVersion: 'forecast-coverage-test-v1',
      slices: [{ coverageStartDate: '2026-09-01', coverageEndDateExclusive: '2026-09-30' }],
    }) }),
  });
  const command = forecastCommand(escaped, {
    candidateStartDate: '2026-09-02',
    candidateEndDateExclusive: '2026-09-30',
  });
  command.inputSetManifest.coveredEndDateExclusive = '2026-10-01';
  command.inputs[0].serviceStartDate = '2026-09-02';
  command.inputs[0].serviceEndDateExclusive = '2026-09-30';
  assert.throws(
    () => escaped.forecastService.calculateForecastRun(escaped.forecastCommandContext, command),
    error => error.code === 'FORECAST_COVERAGE_POLICY_INVALID',
  );
  assertNoForecastRows(escaped.db);
  escaped.close();
});

test('unbranded and malformed contexts execute zero injected policy callbacks', () => {
  const context = createForecastTestContext();
  const calls = { partition: 0, calculate: 0, classify: 0 };
  const service = createForecastReceivablesPlanningService({
    db: context.db,
    policyRegistry: deterministicForecastPolicy({
      partition: ({ input }) => {
        calls.partition += 1;
        return {
          policyVersion: 'forecast-coverage-test-v1',
          slices: [{
            coverageStartDate: input.candidateStartDate,
            coverageEndDateExclusive: input.candidateEndDateExclusive,
          }],
        };
      },
      calculate: () => {
        calls.calculate += 1;
        throw new Error('must not execute');
      },
      classify: () => {
        calls.classify += 1;
        throw new Error('must not execute');
      },
    }),
  });
  for (const rejected of [null, {}, { ...context.forecastCommandContext }]) {
    assert.throws(
      () => service.calculateForecastRun(rejected, forecastCommand(context)),
      error => error.code === 'FORECAST_COMMAND_CONTEXT_REJECTED',
    );
  }
  assert.deepEqual(calls, { partition: 0, calculate: 0, classify: 0 });
  assertNoForecastRows(context.db);
  context.close();
});

test('inert byte budget counts unknown object keys and all JSON structure', () => {
  const context = createForecastTestContext();
  const command = forecastCommand(context);
  command[`x${'k'.repeat(FORECAST_COMMAND_MAX_BYTES)}`] = true;
  assert.throws(
    () => context.forecastService.calculateForecastRun(context.forecastCommandContext, command),
    error => error.code === 'FORECAST_COMMAND_MAX_BYTES',
  );
  assertNoForecastRows(context.db);
  context.close();
});

test('RAISE(IGNORE), omission, extra rows, and persisted lineage mutations roll back every PR7 row', async t => {
  const faults = [
    {
      name: 'input-set manifest persistence ignored',
      sql: `
        CREATE TEMP TRIGGER ignore_forecast_input_set_manifest
        BEFORE INSERT ON forecast_receivable_runs
        BEGIN SELECT RAISE(IGNORE); END;
      `,
    },
    {
      name: 'input snapshot ignored',
      sql: `
        CREATE TEMP TRIGGER ignore_forecast_input_snapshot
        BEFORE INSERT ON forecast_receivable_input_snapshots
        BEGIN SELECT RAISE(IGNORE); END;
      `,
    },
    {
      name: 'input event ignored',
      sql: `
        CREATE TEMP TRIGGER ignore_forecast_input_event
        BEFORE INSERT ON forecast_receivable_input_events
        BEGIN SELECT RAISE(IGNORE); END;
      `,
    },
    {
      name: 'one persisted event omitted',
      sql: `
        CREATE TEMP TRIGGER omit_one_forecast_input_event
        BEFORE INSERT ON forecast_receivable_input_events
        WHEN NEW.eventKind = 'rental_status'
        BEGIN SELECT RAISE(IGNORE); END;
      `,
    },
    {
      name: 'extra persisted event',
      sql: `
        CREATE TEMP TRIGGER add_extra_forecast_input_event
        AFTER INSERT ON forecast_receivable_input_events
        WHEN NEW.eventKind = 'rental_status'
        BEGIN
          INSERT INTO forecast_receivable_input_events (
            id, forecastRunId, inputSnapshotId, companyId, branchId, rentalLineId,
            eventKind, sourceSystem, sourceId, sourceVersion, sourceEventId,
            sourceEventVersion, effectiveStartDate, effectiveEndDateExclusive,
            authorityStatus, authorityPolicyRef, evidenceHash, schemaVersion, createdAt
          ) VALUES (
            NEW.id || '-extra', NEW.forecastRunId, NEW.inputSnapshotId, NEW.companyId,
            NEW.branchId, NEW.rentalLineId, NEW.eventKind, NEW.sourceSystem,
            NEW.sourceId || '-extra', NEW.sourceVersion, NEW.sourceEventId || '-extra',
            NEW.sourceEventVersion, NEW.effectiveStartDate, NEW.effectiveEndDateExclusive,
            NEW.authorityStatus, NEW.authorityPolicyRef, NEW.evidenceHash,
            NEW.schemaVersion, NEW.createdAt
          );
        END;
      `,
    },
    {
      name: 'persisted top-level manifest content mismatch',
      sql: `
        DROP TRIGGER trg_forecast_receivable_runs_no_update;
        CREATE TEMP TRIGGER mutate_forecast_input_set_manifest
        AFTER INSERT ON forecast_receivable_runs
        BEGIN
          UPDATE forecast_receivable_runs
          SET inputSetManifestSourceSnapshotVersion = inputSetManifestSourceSnapshotVersion + 1
          WHERE id = NEW.id;
        END;
      `,
    },
    {
      name: 'changed persisted completeness watermark',
      sql: `
        DROP TRIGGER trg_forecast_receivable_input_snapshots_no_update;
        CREATE TEMP TRIGGER mutate_forecast_manifest_watermark
        AFTER INSERT ON forecast_receivable_input_snapshots
        BEGIN
          UPDATE forecast_receivable_input_snapshots
          SET manifestSourceEventWatermarkVersion = manifestSourceEventWatermarkVersion + 1
          WHERE id = NEW.id;
        END;
      `,
    },
    {
      name: 'changed persisted completeness event kinds',
      sql: `
        DROP TRIGGER trg_forecast_receivable_input_snapshots_no_update;
        CREATE TEMP TRIGGER mutate_forecast_manifest_event_kinds
        AFTER INSERT ON forecast_receivable_input_snapshots
        BEGIN
          UPDATE forecast_receivable_input_snapshots
          SET manifestEventKindsCoveredJson = '["downtime","effective_terms","extension","rental_status"]'
          WHERE id = NEW.id;
        END;
      `,
    },
  ];

  for (const fault of faults) {
    await t.test(fault.name, () => {
      const context = createForecastTestContext();
      context.db.exec(fault.sql);
      assert.throws(() => context.forecastService.calculateForecastRun(
        context.forecastCommandContext,
        forecastCommand(context),
      ));
      assertNoForecastRows(context.db);
      context.close();
    });
  }
});

test('diagnostics and completeness link to exact input index for shared line/component intervals', async t => {
  async function scenario(name, firstManifest, secondManifest, expected) {
    await t.test(name, () => {
      const context = createForecastTestContext();
      const command = forecastCommand(context);
      const sourceInput = command.inputs[0];
      command.inputs = [
        inputForInterval(sourceInput, '2026-09-01', '2026-09-15', { manifest: firstManifest }),
        inputForInterval(sourceInput, '2026-09-15', '2026-10-01', { manifest: secondManifest }),
      ];
      const result = context.forecastService.calculateForecastRun(context.forecastCommandContext, command);
      assert.equal(result.itemCount, expected.itemCount);
      const rows = context.db.prepare(`
        SELECT input.id, input.candidateStartDate, input.candidateEndDateExclusive,
               input.completenessStatus, diagnostic.inputSnapshotId, diagnostic.reasonCode
        FROM forecast_receivable_input_snapshots input
        LEFT JOIN forecast_receivable_diagnostics diagnostic
          ON diagnostic.inputSnapshotId = input.id
         AND diagnostic.reasonCode = 'FORECAST_INPUT_MANIFEST_MISSING'
        ORDER BY input.candidateStartDate
      `).all();
      assert.deepEqual(rows.map(row => ({
        start: row.candidateStartDate,
        status: row.completenessStatus,
        linked: row.inputSnapshotId === row.id,
        reasonCode: row.reasonCode,
      })), expected.rows);
      context.close();
    });
  }

  await scenario('diagnostic on first input only', false, true, {
    itemCount: 1,
    rows: [
      { start: '2026-09-01', status: 'missing', linked: true, reasonCode: 'FORECAST_INPUT_MANIFEST_MISSING' },
      { start: '2026-09-15', status: 'complete', linked: false, reasonCode: null },
    ],
  });
  await scenario('diagnostic on second input only', true, false, {
    itemCount: 1,
    rows: [
      { start: '2026-09-01', status: 'complete', linked: false, reasonCode: null },
      { start: '2026-09-15', status: 'missing', linked: true, reasonCode: 'FORECAST_INPUT_MANIFEST_MISSING' },
    ],
  });
  await scenario('diagnostics on both inputs', false, false, {
    itemCount: 0,
    rows: [
      { start: '2026-09-01', status: 'missing', linked: true, reasonCode: 'FORECAST_INPUT_MANIFEST_MISSING' },
      { start: '2026-09-15', status: 'missing', linked: true, reasonCode: 'FORECAST_INPUT_MANIFEST_MISSING' },
    ],
  });
});

test('SQLite diagnostic lineage rejects an exact-snapshot interval mismatch from direct SQL', () => {
  const context = createForecastTestContext();
  const command = forecastCommand(context);
  const sourceInput = command.inputs[0];
  command.inputs = [
    inputForInterval(sourceInput, '2026-09-01', '2026-09-15'),
    inputForInterval(sourceInput, '2026-09-15', '2026-10-01'),
  ];
  const result = context.forecastService.calculateForecastRun(context.forecastCommandContext, command);
  const runColumns = context.db.prepare('PRAGMA table_info(forecast_receivable_runs)').all().map(row => row.name);
  const runSelect = runColumns.map(column => {
    if (column === 'id') return '@manualRunId';
    if (column === 'operationId') return '@manualOperationId';
    return column;
  }).join(', ');
  const snapshotColumns = context.db.prepare('PRAGMA table_info(forecast_receivable_input_snapshots)').all().map(row => row.name);
  const snapshotSelect = snapshotColumns.map(column => {
    if (column === 'id') return "'manual-' || id";
    if (column === 'forecastRunId') return '@manualRunId';
    return column;
  }).join(', ');

  context.db.exec('BEGIN IMMEDIATE');
  try {
    context.db.prepare(`
      INSERT INTO forecast_receivable_runs (${runColumns.join(', ')})
      SELECT ${runSelect} FROM forecast_receivable_runs WHERE id = @sourceRunId
    `).run({
      manualRunId: 'manual-lineage-run',
      manualOperationId: 'manual-lineage-operation',
      sourceRunId: result.forecastRunId,
    });
    context.db.prepare(`
      INSERT INTO forecast_receivable_input_snapshots (${snapshotColumns.join(', ')})
      SELECT ${snapshotSelect}
      FROM forecast_receivable_input_snapshots WHERE forecastRunId = @sourceRunId
    `).run({
      manualRunId: 'manual-lineage-run',
      sourceRunId: result.forecastRunId,
    });
    const first = context.db.prepare(`
      SELECT * FROM forecast_receivable_input_snapshots
      WHERE forecastRunId = 'manual-lineage-run' AND candidateStartDate = '2026-09-01'
    `).get();
    const second = context.db.prepare(`
      SELECT * FROM forecast_receivable_input_snapshots
      WHERE forecastRunId = 'manual-lineage-run' AND candidateStartDate = '2026-09-15'
    `).get();
    assert.throws(() => context.db.prepare(`
      INSERT INTO forecast_receivable_diagnostics (
        id, forecastRunId, inputSnapshotId, companyId, branchId, rentalLineId,
        componentKind, affectedStartDate, affectedEndDateExclusive, severity,
        confidence, reasonCode, sourceIdentity, sourceHash, policyRef,
        correlationId, schemaVersion, createdAt
      ) VALUES (
        'manual-mismatched-diagnostic', @forecastRunId, @inputSnapshotId,
        @companyId, @branchId, @rentalLineId, @componentKind,
        @affectedStartDate, @affectedEndDateExclusive, 'blocking', 'insufficient',
        'FORECAST_TEST_MISMATCH', @sourceIdentity, @sourceHash, NULL,
        @correlationId, 1, @createdAt
      )
    `).run({
      forecastRunId: 'manual-lineage-run',
      inputSnapshotId: second.id,
      companyId: second.companyId,
      branchId: second.branchId,
      rentalLineId: second.rentalLineId,
      componentKind: second.componentKind,
      affectedStartDate: first.candidateStartDate,
      affectedEndDateExclusive: first.candidateEndDateExclusive,
      sourceIdentity: second.sourceIdentity,
      sourceHash: second.sourceHash,
      correlationId: 'manual-lineage-correlation',
      createdAt: '2026-07-18T06:00:00.000Z',
    }), /forecast diagnostic lineage invalid/);
  } finally {
    context.db.exec('ROLLBACK');
  }
  assert.equal(context.db.prepare("SELECT COUNT(*) AS count FROM forecast_receivable_runs WHERE id = 'manual-lineage-run'").get().count, 0);
  context.close();
});

function readDetailWithSyntheticInputCount(snapshotCount, {
  itemCount = 0,
  diagnosticOnly = false,
} = {}) {
  const context = createForecastTestContext();
  const baseline = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context),
  );
  const repository = createForecastReceivablesPlanningReadRepository(context.db);
  const scope = createForecastReceivablesReadScope(context.platformScope);
  const runColumns = context.db.prepare('PRAGMA table_info(forecast_receivable_runs)').all().map(row => row.name);
  const zeroTotalColumns = new Set([
    'openPeriodForecastNetMinor', 'openPeriodForecastVatMinor', 'openPeriodForecastGrossMinor',
    'plannedFutureNetMinor', 'plannedFutureVatMinor', 'plannedFutureGrossMinor',
    'primaryForecastMinor',
  ]);
  const runSelect = runColumns.map(column => {
    if (column === 'id') return '@runId';
    if (column === 'operationId') return '@operationId';
    if (column === 'inputSnapshotCount') return '@snapshotCount';
    if (column === 'inputEventCount') return '0';
    if (column === 'inputCompletenessManifestCount') return '@snapshotCount';
    if (column === 'itemCount') return '@itemCount';
    if (column === 'diagnosticCount' || column === 'blockingDiagnosticCount') {
      return diagnosticOnly ? '@snapshotCount' : '0';
    }
    if (column === 'status') return diagnosticOnly ? "'insufficient'" : "'calculated'";
    if (column === 'completenessState') return diagnosticOnly ? "'insufficient'" : "'complete'";
    if (zeroTotalColumns.has(column) && (diagnosticOnly || itemCount === 0)) return '0';
    return column;
  }).join(', ');
  const snapshotColumns = context.db.prepare('PRAGMA table_info(forecast_receivable_input_snapshots)').all().map(row => row.name);
  const snapshotSelect = snapshotColumns.map(column => {
    if (column === 'id') return '@snapshotId';
    if (column === 'forecastRunId') return '@runId';
    if (column === 'componentKind') return '@componentKind';
    if (column === 'candidateStartDate') return '@candidateStartDate';
    if (column === 'candidateEndDateExclusive') return '@candidateEndDateExclusive';
    if (column === 'inputSourceHash') return '@inputSourceHash';
    if (column === 'completenessStatus') return diagnosticOnly ? "'incomplete'" : "'complete'";
    return column;
  }).join(', ');
  const snapshotInsert = context.db.prepare(`
    INSERT INTO forecast_receivable_input_snapshots (${snapshotColumns.join(', ')})
    SELECT ${snapshotSelect}
    FROM forecast_receivable_input_snapshots
    WHERE forecastRunId = @sourceRunId
    LIMIT 1
  `);
  const diagnosticInsert = context.db.prepare(`
    INSERT INTO forecast_receivable_diagnostics (
      id, forecastRunId, inputSnapshotId, companyId, branchId, rentalLineId,
      componentKind, affectedStartDate, affectedEndDateExclusive, severity,
      confidence, reasonCode, sourceIdentity, sourceHash, policyRef,
      correlationId, schemaVersion, createdAt
    ) VALUES (
      @id, @forecastRunId, @inputSnapshotId, @companyId, @branchId, @rentalLineId,
      @componentKind, @affectedStartDate, @affectedEndDateExclusive, 'blocking',
      'insufficient', 'FORECAST_SYNTHETIC_DIAGNOSTIC_ONLY', @sourceIdentity,
      @sourceHash, NULL, 'synthetic-read-correlation', 1, '2026-07-18T06:00:00.000Z'
    )
  `);
  const dates = [
    ...Array.from({ length: 30 }, (_, index) => `2026-09-${String(index + 1).padStart(2, '0')}`),
    '2026-10-01',
  ];
  const identities = [];
  for (const componentKind of ['open_period_forecast', 'planned_future']) {
    for (let start = 0; start < 30; start += 1) {
      for (let end = start + 1; end <= 30; end += 1) {
        identities.push({
          componentKind,
          candidateStartDate: dates[start],
          candidateEndDateExclusive: dates[end],
        });
      }
    }
  }
  assert.ok(identities.length >= snapshotCount);

  context.db.exec('BEGIN IMMEDIATE');
  try {
    context.db.prepare(`
      INSERT INTO forecast_receivable_runs (${runColumns.join(', ')})
      SELECT ${runSelect} FROM forecast_receivable_runs WHERE id = @sourceRunId
    `).run({
      runId: 'synthetic-read-run',
      operationId: 'synthetic-read-operation',
      snapshotCount,
      itemCount,
      sourceRunId: baseline.forecastRunId,
    });
    identities.slice(0, snapshotCount).forEach((identity, index) => {
      const snapshotId = `synthetic-read-input-${String(index).padStart(3, '0')}`;
      snapshotInsert.run({
        snapshotId,
        runId: 'synthetic-read-run',
        sourceRunId: baseline.forecastRunId,
        inputSourceHash: `${(index % 16).toString(16)}`.repeat(64),
        ...identity,
      });
      if (diagnosticOnly) {
        const snapshot = context.db.prepare(`
          SELECT * FROM forecast_receivable_input_snapshots WHERE id = ?
        `).get(snapshotId);
        diagnosticInsert.run({
          id: `synthetic-read-diagnostic-${String(index).padStart(3, '0')}`,
          forecastRunId: 'synthetic-read-run',
          inputSnapshotId: snapshotId,
          companyId: snapshot.companyId,
          branchId: snapshot.branchId,
          rentalLineId: snapshot.rentalLineId,
          componentKind: snapshot.componentKind,
          affectedStartDate: snapshot.candidateStartDate,
          affectedEndDateExclusive: snapshot.candidateEndDateExclusive,
          sourceIdentity: snapshot.sourceIdentity,
          sourceHash: snapshot.sourceHash,
        });
      }
    });
    return repository.getRun(scope, 'synthetic-read-run');
  } finally {
    context.db.exec('ROLLBACK');
    context.close();
  }
}

test('run detail input truncation uses a 201-row sentinel independent of item count', () => {
  for (const scenario of [
    { snapshots: 199, itemCount: 0, expectedLength: 199, truncated: false },
    { snapshots: 200, itemCount: 0, expectedLength: 200, truncated: false },
    { snapshots: 201, itemCount: 0, expectedLength: 200, truncated: true },
    { snapshots: 199, itemCount: 500, expectedLength: 199, truncated: false },
  ]) {
    const detail = readDetailWithSyntheticInputCount(scenario.snapshots, {
      itemCount: scenario.itemCount,
    });
    assert.equal(detail.inputSnapshots.length, scenario.expectedLength);
    assert.equal(detail.inputSnapshotsTruncated, scenario.truncated);
  }
  const diagnosticOnly = readDetailWithSyntheticInputCount(500, { diagnosticOnly: true });
  assert.equal(diagnosticOnly.itemCount, 0);
  assert.equal(diagnosticOnly.diagnosticCount, 500);
  assert.equal(diagnosticOnly.inputSnapshots.length, 200);
  assert.equal(diagnosticOnly.inputSnapshotsTruncated, true);
});

test('more calculated items than inputs does not report input snapshot truncation', () => {
  const context = createForecastTestContext({
    policyRegistry: deterministicForecastPolicy({ partition: () => ({
      policyVersion: 'forecast-coverage-test-v1',
      slices: [
        { coverageStartDate: '2026-09-01', coverageEndDateExclusive: '2026-09-15' },
        { coverageStartDate: '2026-09-15', coverageEndDateExclusive: '2026-10-01' },
      ],
    }) }),
  });
  const result = context.forecastService.calculateForecastRun(
    context.forecastCommandContext,
    forecastCommand(context),
  );
  const repository = createForecastReceivablesPlanningReadRepository(context.db);
  const detail = repository.getRun(
    createForecastReceivablesReadScope(context.platformScope),
    result.forecastRunId,
  );
  assert.equal(detail.itemCount, 2);
  assert.equal(detail.inputSnapshots.length, 1);
  assert.equal(detail.inputSnapshotsTruncated, false);
  context.close();
});

test('exact PR6 closed candidate suppresses a multi-slice partition while partial overlap remains blocking', () => {
  const policyRegistry = deterministicForecastPolicy({ partition: ({ input }) => ({
    policyVersion: 'forecast-coverage-test-v1',
    slices: input.candidateStartDate === '2026-09-01'
      ? [
          { coverageStartDate: '2026-09-01', coverageEndDateExclusive: '2026-09-15' },
          { coverageStartDate: '2026-09-15', coverageEndDateExclusive: '2026-10-01' },
        ]
      : [
          { coverageStartDate: '2026-08-01', coverageEndDateExclusive: '2026-08-15' },
          { coverageStartDate: '2026-08-15', coverageEndDateExclusive: '2026-08-31' },
        ],
  }) });
  const exact = createForecastTestContext({
    policyRegistry,
    sourceCloseOverrides: {
      periodStartDate: '2026-09-01',
      periodEndDateExclusive: '2026-10-01',
      termsFrom: '2026-09-01',
    },
  });
  const exactResult = exact.forecastService.calculateForecastRun(
    exact.forecastCommandContext,
    forecastCommand(exact),
  );
  assert.equal(exactResult.status, 'calculated');
  assert.equal(exactResult.itemCount, 0);
  assert.equal(exact.db.prepare(`
    SELECT COUNT(*) AS count FROM forecast_receivable_diagnostics
    WHERE reasonCode = 'FORECAST_CLOSED_COVERAGE_SUPPRESSED'
  `).get().count, 1);
  exact.close();

  const partial = createForecastTestContext({ policyRegistry });
  const partialCommand = forecastCommand(partial, {
    asOfDate: '2026-08-01',
    candidateStartDate: '2026-08-01',
    candidateEndDateExclusive: '2026-08-31',
  });
  const partialResult = partial.forecastService.calculateForecastRun(
    partial.forecastCommandContext,
    partialCommand,
  );
  assert.equal(partialResult.status, 'insufficient');
  assert.equal(partialResult.itemCount, 0);
  assert.equal(partial.db.prepare(`
    SELECT COUNT(*) AS count FROM forecast_receivable_diagnostics
    WHERE reasonCode = 'FORECAST_CLOSED_COVERAGE_OVERLAP'
  `).get().count, 2);
  partial.close();
});
