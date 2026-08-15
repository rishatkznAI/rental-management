import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  ISSUE_CLASSES,
  RELATION_SOURCES,
  SEVERITIES,
  diagnosePaymentAllocationFinancialImpact,
} = serverRequire('./lib/payment-allocation-financial-impact');
const { buildRentalDebtRows } = serverRequire('./lib/finance-core');
const { buildManagerReportRows } = serverRequire('./lib/manager-report');

const scriptPath = new URL('../server/scripts/payment-allocation-financial-impact.js', import.meta.url).pathname;

function counterparty(id, overrides = {}) {
  return { id, roles: ['customer'], status: 'active', archivedAt: null, ...overrides };
}

function rental(id, counterpartyId, overrides = {}) {
  return {
    id,
    counterpartyId,
    status: 'active',
    amount: 100,
    startDate: '2026-08-01',
    endDate: '2026-08-31',
    ...overrides,
  };
}

function payment(id, counterpartyId, overrides = {}) {
  return {
    id,
    counterpartyId,
    status: 'paid',
    amount: 100,
    paidAmount: 100,
    ...overrides,
  };
}

function allocation(id, paymentId, rentalId, overrides = {}) {
  return { id, paymentId, rentalId, amount: 100, status: 'active', ...overrides };
}

function state(overrides = {}) {
  return {
    counterparties: [counterparty('CP-A'), counterparty('CP-B')],
    counterparty_role_assignments: [],
    clients: [],
    rentals: [],
    gantt_rentals: [rental('R-A', 'CP-A'), rental('R-B', 'CP-B')],
    payments: [],
    payment_allocations: [],
    documents: [],
    ...overrides,
  };
}

function diagnose(overrides = {}) {
  return diagnosePaymentAllocationFinancialImpact(state(overrides));
}

function relation(result, source, id) {
  return result.relations.find(item => (
    item.relationSource === source
    && (source === RELATION_SOURCES.EXPLICIT_ALLOCATION ? item.allocationId === id : item.paymentId === id)
  ));
}

test('same-Counterparty explicit allocation reproduces finance-core effective amount', () => {
  const input = state({
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-1', 'P-A', 'R-A')],
  });
  const result = diagnosePaymentAllocationFinancialImpact(input);
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1');
  assert.equal(item.canonicalValidity.valid, true);
  assert.equal(item.effectiveAmount, 100);
  assert.equal(item.affectsCurrentAr, true);
  assert.equal(item.affectedCounterpartyId, 'CP-A');
  assert.equal(buildRentalDebtRows(input.gantt_rentals, input.payments, {
    paymentAllocations: input.payment_allocations,
  }).find(row => row.rentalId === 'R-A')?.paidAmount ?? 100, item.effectiveAmount);
});

test('same-Counterparty direct Payment relation is counted correctly', () => {
  const result = diagnose({ payments: [payment('P-A', 'CP-A', { rentalId: 'R-A' })] });
  const item = relation(result, RELATION_SOURCES.DIRECT_PAYMENT_RENTAL, 'P-A');
  assert.equal(item.canonicalIssueClass, ISSUE_CLASSES.SAFE);
  assert.equal(item.canonicalValidity.valid, true);
  assert.equal(item.effectiveAmount, 100);
  assert.equal(item.affectsCurrentAr, true);
  assert.equal(item.whyCounted, 'direct fallback relation');
});

test('legacy direct Payment can resolve canonical identity through its authoritative Rental', () => {
  const result = diagnose({
    payments: [{ id: 'P-RENTAL-ONLY', rentalId: 'R-A', status: 'paid', amount: 100, paidAmount: 100 }],
  });
  const item = relation(result, RELATION_SOURCES.DIRECT_PAYMENT_RENTAL, 'P-RENTAL-ONLY');
  assert.equal(item.canonicalValidity.valid, true);
  assert.equal(item.paymentCounterpartyId, 'CP-A');
  assert.equal(item.rentalCounterpartyId, 'CP-A');
  assert.equal(item.canonicalIssueClass, ISSUE_CLASSES.LEGACY_RESOLVED);
});

test('explicit allocation precedence prevents direct double counting', () => {
  const result = diagnose({
    gantt_rentals: [rental('R-1', 'CP-A'), rental('R-2', 'CP-A')],
    payments: [payment('P-A', 'CP-A', { rentalId: 'R-1' })],
    payment_allocations: [allocation('A-1', 'P-A', 'R-2')],
  });
  const explicit = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1');
  const direct = relation(result, RELATION_SOURCES.DIRECT_PAYMENT_RENTAL, 'P-A');
  assert.equal(explicit.effectiveAmount, 100);
  assert.equal(explicit.affectedRentalId, 'R-2');
  assert.equal(direct.effectiveAmount, 0);
  assert.equal(direct.affectsCurrentAr, false);
  assert.equal(direct.currentReaderEffect.suppressedByExplicitAllocation, true);
});

test('effective explicit cross-Counterparty allocation is a precise AR-impact blocker', () => {
  const result = diagnose({
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-X', 'P-A', 'R-B', { amount: 73 })],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-X');
  assert.equal(item.issueClass, ISSUE_CLASSES.CROSS_COUNTERPARTY);
  assert.equal(item.severity, SEVERITIES.BLOCKING);
  assert.equal(item.affectsCurrentAr, true);
  assert.equal(item.effectiveAmount, 73);
  assert.equal(item.affectedCounterpartyId, 'CP-B');
});

test('direct cross-Counterparty Payment relation is a precise AR-impact blocker', () => {
  const result = diagnose({ payments: [payment('P-X', 'CP-A', { rentalId: 'R-B', paidAmount: 44 })] });
  const item = relation(result, RELATION_SOURCES.DIRECT_PAYMENT_RENTAL, 'P-X');
  assert.equal(item.issueClass, ISSUE_CLASSES.CROSS_COUNTERPARTY);
  assert.equal(item.severity, SEVERITIES.BLOCKING);
  assert.equal(item.affectsCurrentAr, true);
  assert.equal(item.effectiveAmount, 44);
});

test('cancelled cross-Counterparty allocation remains visible without current AR impact', () => {
  const result = diagnose({
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-CANCEL', 'P-A', 'R-B', { status: 'cancelled' })],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-CANCEL');
  assert.equal(item.issueClass, ISSUE_CLASSES.CROSS_COUNTERPARTY);
  assert.equal(item.issueClasses.includes(ISSUE_CLASSES.CANCELLED), true);
  assert.equal(item.severity, SEVERITIES.WARNING);
  assert.equal(item.affectsCurrentAr, false);
  assert.equal(item.effectiveAmount, 0);
});

test('unresolved Payment identity is classified independently from a valid Rental', () => {
  const result = diagnose({
    payments: [{ id: 'P-NO-ID', status: 'paid', amount: 100, paidAmount: 100, client: 'display only' }],
    payment_allocations: [allocation('A-1', 'P-NO-ID', 'R-A')],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1');
  assert.equal(item.issueClass, ISSUE_CLASSES.UNRESOLVED_PAYMENT);
  assert.equal(item.paymentCounterpartyId, null);
  assert.equal(item.rentalCounterpartyId, 'CP-A');
});

test('unresolved Rental identity is classified independently from a valid Payment', () => {
  const result = diagnose({
    gantt_rentals: [rental('R-NO-ID', undefined, { counterpartyId: undefined, client: 'display only' })],
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-1', 'P-A', 'R-NO-ID')],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1');
  assert.equal(item.issueClass, ISSUE_CLASSES.UNRESOLVED_RENTAL);
  assert.equal(item.paymentCounterpartyId, 'CP-A');
  assert.equal(item.rentalCounterpartyId, null);
});

test('Payment dual-ID mismatch is payment_identity_conflict', () => {
  const result = diagnose({
    clients: [{ id: 'C-A', counterpartyId: 'CP-A' }],
    payments: [payment('P-DUAL', 'CP-B', { clientId: 'C-A' })],
    payment_allocations: [allocation('A-1', 'P-DUAL', 'R-A')],
  });
  assert.equal(
    relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1').issueClass,
    ISSUE_CLASSES.PAYMENT_IDENTITY_CONFLICT,
  );
});

test('Rental dual-ID mismatch is rental_identity_conflict', () => {
  const result = diagnose({
    clients: [{ id: 'C-A', counterpartyId: 'CP-A' }],
    gantt_rentals: [rental('R-DUAL', 'CP-B', { clientId: 'C-A' })],
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-1', 'P-A', 'R-DUAL')],
  });
  assert.equal(
    relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1').issueClass,
    ISSUE_CLASSES.RENTAL_IDENTITY_CONFLICT,
  );
});

test('allocation with a missing Payment endpoint is orphan_payment', () => {
  const result = diagnose({ payment_allocations: [allocation('A-ORPHAN-P', 'P-MISSING', 'R-A')] });
  assert.equal(
    relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-ORPHAN-P').issueClass,
    ISSUE_CLASSES.ORPHAN_PAYMENT,
  );
});

test('allocation with a missing Rental endpoint is orphan_rental', () => {
  const result = diagnose({
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-ORPHAN-R', 'P-A', 'R-MISSING')],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-ORPHAN-R');
  assert.equal(item.issueClass, ISSUE_CLASSES.ORPHAN_RENTAL);
  assert.equal(item.effectiveAmount, 100);
  assert.equal(item.affectsCurrentAr, false);
  assert.equal(item.severity, SEVERITIES.BLOCKING);
});

test('missing Counterparty is orphan_counterparty', () => {
  const result = diagnose({
    payments: [payment('P-MISSING-CP', 'CP-MISSING')],
    payment_allocations: [allocation('A-1', 'P-MISSING-CP', 'R-A')],
  });
  assert.equal(
    relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1').issueClass,
    ISSUE_CLASSES.ORPHAN_COUNTERPARTY,
  );
});

test('ambiguous Classic/Gantt exact Rental identity is duplicate_rental_id', () => {
  const result = diagnose({
    rentals: [rental('R-SAME', 'CP-A')],
    gantt_rentals: [rental('R-SAME', 'CP-A')],
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-1', 'P-A', 'R-SAME')],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1');
  assert.equal(item.issueClass, ISSUE_CLASSES.DUPLICATE_RENTAL_ID);
  assert.equal(item.canonicalValidity.rental.endpointMatches, 2);
});

test('invalid allocation amount is explicit and cannot silently become zero-safe', () => {
  const result = diagnose({
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-BAD', 'P-A', 'R-A', { amount: 'not-money' })],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-BAD');
  assert.equal(item.issueClass, ISSUE_CLASSES.INVALID_AMOUNT);
  assert.equal(item.rawAmount, null);
  assert.equal(item.effectiveAmount, 0);
  assert.equal(item.severity, SEVERITIES.BLOCKING);
});

test('negative allocation amount is reported and never contributes money', () => {
  const result = diagnose({
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-NEG', 'P-A', 'R-A', { amount: -5 })],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-NEG');
  assert.equal(item.issueClasses.includes(ISSUE_CLASSES.NEGATIVE_AMOUNT), true);
  assert.equal(item.rawAmount, -5);
  assert.equal(item.effectiveAmount, 0);
});

test('Payment cap and persisted allocation ordering produce 80 then 20', () => {
  const result = diagnose({
    gantt_rentals: [rental('R-1', 'CP-A'), rental('R-2', 'CP-A')],
    payments: [payment('P-A', 'CP-A', { amount: 100, paidAmount: 100 })],
    payment_allocations: [
      allocation('A-1', 'P-A', 'R-1', { amount: 80 }),
      allocation('A-2', 'P-A', 'R-2', { amount: 80 }),
    ],
  });
  const first = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1');
  const second = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-2');
  assert.equal(first.effectiveAmount, 80);
  assert.equal(second.effectiveAmount, 20);
  assert.equal(second.issueClasses.includes(ISSUE_CLASSES.OVER_CAP), true);
  assert.equal(second.issueClasses.includes(ISSUE_CLASSES.ORDERING_EFFECT), true);
  assert.equal(second.whyCounted, 'ordering-selected capped contribution');
});

test('multiple allocations share one Payment without exceeding its cap', () => {
  const result = diagnose({
    gantt_rentals: [rental('R-1', 'CP-A'), rental('R-2', 'CP-A'), rental('R-3', 'CP-A')],
    payments: [payment('P-A', 'CP-A', { amount: 90, paidAmount: 90 })],
    payment_allocations: [
      allocation('A-1', 'P-A', 'R-1', { amount: 30 }),
      allocation('A-2', 'P-A', 'R-2', { amount: 30 }),
      allocation('A-3', 'P-A', 'R-3', { amount: 30 }),
    ],
  });
  assert.equal(
    result.relations
      .filter(item => item.relationSource === RELATION_SOURCES.EXPLICIT_ALLOCATION)
      .reduce((sum, item) => sum + item.effectiveAmount, 0),
    90,
  );
});

test('cancelled allocation demonstrates the real backend manager reader divergence', () => {
  const input = state({
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-CANCEL', 'P-A', 'R-A', { status: 'cancelled', amount: 60 })],
  });
  const result = diagnosePaymentAllocationFinancialImpact(input);
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-CANCEL');
  assert.equal(item.readerEffects.finance_core_ar.effectiveAmount, 0);
  assert.equal(item.readerEffects.manager_report_backend.effectiveAmount, 60);
  assert.equal(item.readerEffects.manager_report_frontend.effectiveAmount, 0);
  assert.equal(item.issueClasses.includes(ISSUE_CLASSES.READER_DIFFERENCE), true);

  const rows = buildManagerReportRows(input.gantt_rentals, [], input.payments, {}, input.payment_allocations);
  assert.equal(rows.find(row => row.rentalId === 'R-A').paidAmount, 60);
});

test('frontend finance mirror exposes its distinct no-id allocation dedupe semantics', () => {
  const result = diagnose({
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [
      { paymentId: 'P-A', rentalId: 'R-A', documentId: 'D-1', objectId: 'O-1', amount: 30, status: 'active' },
      { paymentId: 'P-A', rentalId: 'R-A', documentId: 'D-1', objectId: 'O-2', amount: 30, status: 'active' },
    ],
  });
  const second = result.relations.find(item => (
    item.relationSource === RELATION_SOURCES.EXPLICIT_ALLOCATION && item.sourceIndex === 1
  ));
  assert.equal(second.readerEffects.finance_core_ar.effectiveAmount, 30);
  assert.equal(second.readerEffects.frontend_finance_mirror.effectiveAmount, 0);
  assert.equal(second.issueClasses.includes(ISSUE_CLASSES.READER_DIFFERENCE), true);
});

test('finance route linked-Rental boundary is distinct from global finance-core input semantics', () => {
  const result = diagnose({
    rentals: [rental('R-CLASSIC', 'CP-A')],
    gantt_rentals: [rental('GR-UNLINKED', 'CP-A')],
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-1', 'P-A', 'GR-UNLINKED')],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1');
  assert.equal(item.readerEffects.finance_core_ar.affectsBalance, true);
  assert.equal(item.readerEffects.finance_routes_linked_ar.affectsBalance, false);
  assert.equal(
    item.readerDifferences.some(difference => difference.reader === 'finance_routes_linked_ar'),
    true,
  );
});

test('payment-status sync counts explicit allocation for a Payment without direct rentalId', () => {
  const result = diagnose({
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-1', 'P-A', 'R-A', { amount: 55 })],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1');
  assert.equal(item.readerEffects.payment_status_sync.effectiveAmount, 55);
  assert.equal(item.readerEffects.payment_status_sync.targetRentalId, 'R-A');
});

test('ignored Payment status excludes its active allocation in finance-core', () => {
  const result = diagnose({
    payments: [payment('P-REVERSED', 'CP-A', { status: 'reversed' })],
    payment_allocations: [allocation('A-1', 'P-REVERSED', 'R-A')],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1');
  assert.equal(item.issueClasses.includes(ISSUE_CLASSES.CANCELLED), true);
  assert.equal(item.currentReaderEffect.statusExcluded, true);
  assert.equal(item.affectsCurrentAr, false);
});

test('duplicate Payment and Allocation stable IDs remain explicit blockers', () => {
  const result = diagnose({
    payments: [payment('P-DUP', 'CP-A'), payment('P-DUP', 'CP-A')],
    payment_allocations: [
      allocation('A-DUP', 'P-DUP', 'R-A', { amount: 40 }),
      allocation('A-DUP', 'P-DUP', 'R-A', { amount: 40 }),
    ],
  });
  const items = result.relations.filter(item => item.allocationId === 'A-DUP');
  assert.equal(items.length, 2);
  assert.equal(items.every(item => item.issueClasses.includes(ISSUE_CLASSES.DUPLICATE_PAYMENT_ID)), true);
  assert.equal(items.every(item => item.issueClasses.includes(ISSUE_CLASSES.DUPLICATE_ALLOCATION_ID)), true);
});

test('legacy Client identity resolves only through stable IDs', () => {
  const result = diagnose({
    clients: [{ id: 'C-A', counterpartyId: 'CP-A', company: 'mutable' }],
    gantt_rentals: [rental('R-LEGACY', undefined, { counterpartyId: undefined, clientId: 'C-A' })],
    payments: [payment('P-LEGACY', undefined, { counterpartyId: undefined, clientId: 'C-A' })],
    payment_allocations: [allocation('A-LEGACY', 'P-LEGACY', 'R-LEGACY')],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-LEGACY');
  assert.equal(item.issueClasses.includes(ISSUE_CLASSES.LEGACY_RESOLVED), true);
  assert.equal(item.paymentCounterpartyId, 'CP-A');
  assert.equal(item.rentalCounterpartyId, 'CP-A');
});

test('Document backfill provenance is reported but does not change monetary interpretation', () => {
  const result = diagnose({
    documents: [{ id: 'D-1', rentalId: 'R-A' }],
    payments: [payment('P-A', 'CP-A', { documentId: 'D-1' })],
    payment_allocations: [allocation('A-1', 'P-A', 'R-A', {
      documentId: 'D-1',
      source: 'legacy_backfill',
    })],
  });
  const item = relation(result, RELATION_SOURCES.EXPLICIT_ALLOCATION, 'A-1');
  assert.deepEqual(item.provenance, {
    source: 'legacy_backfill',
    documentId: 'D-1',
    documentMatches: 1,
    affectsMonetaryInterpretation: false,
  });
});

function fileFingerprint(file) {
  const bytes = readFileSync(file);
  const stat = statSync(file);
  return {
    sha256: createHash('sha256').update(bytes).digest('hex'),
    size: stat.size,
    mtimeMs: stat.mtimeMs,
  };
}

function createDiagnosticDatabase(dbPath, input) {
  const db = new Database(dbPath);
  try {
    db.exec('CREATE TABLE app_data (name TEXT PRIMARY KEY, json TEXT NOT NULL, updated_at TEXT NOT NULL)');
    const insert = db.prepare('INSERT INTO app_data (name, json, updated_at) VALUES (?, ?, ?)');
    for (const [name, value] of Object.entries(input)) {
      insert.run(name, JSON.stringify(value), 'unchanged');
    }
  } finally {
    db.close();
  }
}

test('CLI leaves the SQLite file fingerprint and app_data timestamps unchanged', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'allocation-impact-'));
  const dbPath = path.join(directory, 'backup.sqlite');
  createDiagnosticDatabase(dbPath, state({
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-1', 'P-A', 'R-A')],
  }));
  try {
    const before = fileFingerprint(dbPath);
    const run = spawnSync(process.execPath, [scriptPath, '--db', dbPath, '--json'], { encoding: 'utf8' });
    assert.equal(run.status, 0, run.stderr);
    assert.equal(JSON.parse(run.stdout).mode, 'read-only');
    assert.deepEqual(fileFingerprint(dbPath), before);
    const verify = new Database(dbPath, { readonly: true, fileMustExist: true });
    try {
      assert.deepEqual(
        verify.prepare('SELECT DISTINCT updated_at FROM app_data').all(),
        [{ updated_at: 'unchanged' }],
      );
    } finally {
      verify.close();
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('JSON output is byte-for-byte deterministic across repeated CLI runs', () => {
  const directory = mkdtempSync(path.join(tmpdir(), 'allocation-impact-json-'));
  const dbPath = path.join(directory, 'backup.sqlite');
  createDiagnosticDatabase(dbPath, state({
    payments: [payment('P-A', 'CP-A', { rentalId: 'R-A' })],
  }));
  try {
    const first = spawnSync(process.execPath, [scriptPath, '--db', dbPath, '--json'], { encoding: 'utf8' });
    const second = spawnSync(process.execPath, [scriptPath, '--db', dbPath, '--json'], { encoding: 'utf8' });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(second.status, 0, second.stderr);
    assert.equal(second.stdout, first.stdout);
    assert.deepEqual(JSON.parse(second.stdout), JSON.parse(first.stdout));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('CLI source has no runtime storage, startup, migration, backup, or write path', () => {
  const source = readFileSync(scriptPath, 'utf8');
  assert.match(source, /readonly:\s*true/);
  assert.match(source, /fileMustExist:\s*true/);
  assert.doesNotMatch(source, /require\(['"]\.\.\/db/);
  assert.doesNotMatch(source, /setData|setDataBatch|writeData|runStartup|migrateJson|createBackup|--apply/);
  assert.doesNotMatch(source, /\b(?:INSERT|UPDATE|DELETE|REPLACE|CREATE|ALTER|DROP)\b/i);
});

test('in-memory evaluator is deterministic and does not mutate source records', () => {
  const input = state({
    payments: [payment('P-A', 'CP-A')],
    payment_allocations: [allocation('A-1', 'P-A', 'R-A')],
  });
  const snapshot = structuredClone(input);
  const first = diagnosePaymentAllocationFinancialImpact(input);
  const second = diagnosePaymentAllocationFinancialImpact(input);
  assert.deepEqual(second, first);
  assert.deepEqual(input, snapshot);
});
