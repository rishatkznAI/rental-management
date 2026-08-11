import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const express = serverRequire('express');
const { createAccessControl } = serverRequire('./lib/access-control');
const { validateRentalPayload } = serverRequire('./lib/rental-validation');
const { registerRentalRoutes } = serverRequire('./routes/rentals');
const settingsSource = readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');
const rentalNewSource = readFileSync(new URL('../src/app/pages/RentalNew.tsx', import.meta.url), 'utf8');
const rentalDetailSource = readFileSync(new URL('../src/app/pages/RentalDetail.tsx', import.meta.url), 'utf8');
const rentalsPageSource = readFileSync(new URL('../src/app/pages/Rentals.tsx', import.meta.url), 'utf8');
const rentalDrawerSource = readFileSync(new URL('../src/app/components/gantt/RentalDrawer.tsx', import.meta.url), 'utf8');
const clientDetailSource = readFileSync(new URL('../src/app/pages/ClientDetail.tsx', import.meta.url), 'utf8');
const dashboardSource = readFileSync(new URL('../src/app/pages/Dashboard.tsx', import.meta.url), 'utf8');
const client360Source = readFileSync(new URL('../src/app/lib/client360.js', import.meta.url), 'utf8');
const {
  auditRentalCounterpartyRelations,
  canonicalizeRentalCounterpartyRelation,
  canonicalizeRentalPersistenceEntries,
  projectRentalCounterpartyRelations,
  repairRentalCounterpartyRelations,
} = serverRequire('./lib/rental-counterparty-relations');

function counterparty(id, overrides = {}) {
  return {
    id,
    legalName: `Контрагент ${id}`,
    shortName: id,
    status: 'active',
    archivedAt: null,
    roles: ['customer'],
    ...overrides,
  };
}

function rental(overrides = {}) {
  return {
    id: 'R-1',
    clientId: 'C-1',
    client: 'Display snapshot only',
    clientName: 'Another display snapshot',
    inn: '7700000000',
    equipmentId: 'EQ-1',
    startDate: '2026-08-12',
    plannedReturnDate: '2026-08-20',
    status: 'active',
    ...overrides,
  };
}

function state(overrides = {}) {
  return {
    clients: [{ id: 'C-1', counterpartyId: 'CP-1', company: 'ООО Клиент', inn: '7700000000' }],
    counterparties: [counterparty('CP-1')],
    rentals: [],
    gantt_rentals: [],
    ...overrides,
  };
}

function relationError(fn, code) {
  assert.throws(fn, error => {
    assert.equal(error.code, code);
    assert.equal(error.status >= 400, true);
    return true;
  });
}

async function withServer(app, fn) {
  const server = await new Promise(resolve => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  try {
    return await fn(`http://127.0.0.1:${server.address().port}`);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

function createRentalApi() {
  const store = state({
    counterparties: [counterparty('CP-1'), counterparty('CP-2')],
    users: [{ id: 'U-1', name: 'Админ', role: 'Администратор' }],
    client_objects: [{
      id: 'CO-1',
      clientId: 'C-1',
      counterpartyId: 'CP-1',
      name: 'Склад',
      address: 'Казань',
      status: 'active',
    }],
    client_contracts: [{
      id: 'CC-1',
      clientId: 'C-1',
      objectId: 'CO-1',
      number: 'Д-1',
      status: 'active',
    }],
    equipment: [{
      id: 'EQ-1',
      inventoryNumber: 'INV-1',
      serialNumber: 'SN-1',
      status: 'available',
      activeInFleet: true,
      category: 'own',
    }],
    service: [],
    equipment_downtimes: [],
    payments: [],
    payment_allocations: [],
  });
  const readData = name => store[name] || [];
  const writeData = (name, value) => { store[name] = value; };
  const writeDataBatch = entries => {
    const canonical = canonicalizeRentalPersistenceEntries(entries, { readData });
    for (const entry of canonical) store[entry.name] = entry.value;
  };
  const accessControl = createAccessControl({ readData });
  let idCounter = 0;
  const app = express();
  app.use(express.json());
  app.use('/api', registerRentalRoutes({
    readData,
    writeData,
    writeDataBatch,
    requireAuth(req, _res, next) {
      req.user = { userId: 'U-1', userName: 'Админ', userRole: 'Администратор' };
      next();
    },
    requireRead: () => (_req, _res, next) => next(),
    validateRentalPayload,
    mergeRentalHistory: (_previous, next) => next,
    normalizeGanttRentalList: list => list,
    normalizeGanttRentalStatus: item => item,
    normalizeRecordClientLink: item => item,
    canonicalizeRentalRelationForWrite: item => canonicalizeRentalCounterpartyRelation(item, { readData }),
    generateId: prefix => `${prefix}-${++idCounter}`,
    idPrefixes: { rentals: 'R', gantt_rentals: 'GR', rental_change_requests: 'RCR' },
    accessControl,
    auditLog: () => {},
    nowIso: () => '2026-08-11T10:00:00.000Z',
  }));
  return { app, store };
}

function apiRentalPayload(overrides = {}) {
  return {
    clientId: 'C-1',
    objectId: 'CO-1',
    contractId: 'CC-1',
    client: 'Display snapshot',
    contact: 'Иван',
    startDate: '2026-08-12',
    plannedReturnDate: '2026-08-20',
    equipmentId: 'EQ-1',
    equipment: ['INV-1'],
    equipmentInv: 'INV-1',
    price: 10000,
    rate: '1000',
    discount: 0,
    managerId: 'U-1',
    manager: 'Админ',
    status: 'active',
    paymentStatus: 'unpaid',
    ...overrides,
  };
}

test('Rental create using valid clientId derives canonical counterpartyId', () => {
  const result = canonicalizeRentalCounterpartyRelation(rental(), state());
  assert.equal(result.clientId, 'C-1');
  assert.equal(result.counterpartyId, 'CP-1');
});

test('Rental frontend relation recovery uses stable IDs and never client display names', () => {
  assert.doesNotMatch(rentalNewSource, /clients\.find\(item => item\.company === routeRequest\.client\.value/);
  assert.doesNotMatch(rentalDetailSource, /clients\.find\(c => c\.company ===/);
  assert.doesNotMatch(rentalDetailSource, /entry\.client === rental\.client/);
  assert.doesNotMatch(rentalDrawerSource, /item\.company === rental\.client/);
  assert.doesNotMatch(rentalsPageSource, /clientNamesCompatible|normalizedClientKey/);
  assert.doesNotMatch(clientDetailSource, /normalizeClientName\(r\.client\)/);
  assert.doesNotMatch(dashboardSource, /r\.client === c\.company/);
  assert.doesNotMatch(client360Source, /normalizeKey\(record\.client\) === normalizeKey\(client\.company\)/);
  assert.match(rentalsPageSource, /function matchesCanonicalCustomer/);
  assert.match(rentalsPageSource, /counterpartyId: rental\.counterpartyId \|\| ganttRental\.counterpartyId/);
});

test('Rental create accepts matching clientId and counterpartyId', () => {
  const result = canonicalizeRentalCounterpartyRelation(
    rental({ counterpartyId: 'CP-1' }),
    state(),
  );
  assert.equal(result.counterpartyId, 'CP-1');
});

test('Rental API create derives counterpartyId and returns a machine-readable mismatch error', async () => {
  const { app, store } = createRentalApi();
  await withServer(app, async baseUrl => {
    const created = await fetch(`${baseUrl}/api/rentals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(apiRentalPayload()),
    });
    const createdBody = await created.json();
    assert.equal(created.status, 201);
    assert.equal(createdBody.counterpartyId, 'CP-1');
    assert.equal(store.rentals[0].counterpartyId, 'CP-1');
    assert.equal(store.gantt_rentals[0].counterpartyId, 'CP-1');

    const mismatch = await fetch(`${baseUrl}/api/rentals`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(apiRentalPayload({ counterpartyId: 'CP-2' })),
    });
    const mismatchBody = await mismatch.json();
    assert.equal(mismatch.status, 409);
    assert.equal(mismatchBody.code, 'COUNTERPARTY_RELATION_MISMATCH');
  });
});

test('Rental create rejects clientId and counterpartyId mismatch', () => {
  relationError(
    () => canonicalizeRentalCounterpartyRelation(
      rental({ counterpartyId: 'CP-2' }),
      state({ counterparties: [counterparty('CP-1'), counterparty('CP-2')] }),
    ),
    'COUNTERPARTY_RELATION_MISMATCH',
  );
});

test('Rental relation reports missing Client and Counterparty targets', () => {
  relationError(
    () => canonicalizeRentalCounterpartyRelation(rental({ clientId: 'C-missing' }), state()),
    'COUNTERPARTY_RELATION_CLIENT_NOT_FOUND',
  );
  relationError(
    () => canonicalizeRentalCounterpartyRelation(rental(), state({ counterparties: [] })),
    'COUNTERPARTY_RELATION_COUNTERPARTY_NOT_FOUND',
  );
});

test('Rental relation rejects Counterparty without customer role', () => {
  relationError(
    () => canonicalizeRentalCounterpartyRelation(
      rental(),
      state({ counterparties: [counterparty('CP-1', { roles: ['supplier'] })] }),
    ),
    'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED',
  );
});

test('Rental relation rejects missing Client.counterpartyId and archived Counterparty', () => {
  relationError(
    () => canonicalizeRentalCounterpartyRelation(
      rental(),
      state({ clients: [{ id: 'C-1', company: 'Legacy Client' }] }),
    ),
    'COUNTERPARTY_RELATION_CLIENT_LINK_MISSING',
  );
  relationError(
    () => canonicalizeRentalCounterpartyRelation(
      rental(),
      state({ counterparties: [counterparty('CP-1', { status: 'archived', archivedAt: '2026-08-11T00:00:00.000Z' })] }),
    ),
    'COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED',
  );
});

test('Rental audit preserves historical archived relations but rejects active archived relations', () => {
  const archivedState = state({
    counterparties: [counterparty('CP-1', {
      status: 'archived',
      archivedAt: '2026-08-11T00:00:00.000Z',
    })],
    rentals: [
      rental({ id: 'R-active', counterpartyId: 'CP-1', status: 'active' }),
      rental({ id: 'R-closed', counterpartyId: 'CP-1', status: 'closed' }),
    ],
  });

  const audit = auditRentalCounterpartyRelations(archivedState);
  assert.deepEqual(audit.healthy.map(item => item.recordId), ['R-closed']);
  assert.deepEqual(audit.broken.map(item => item.recordId), ['R-active']);
  assert.equal(audit.broken[0].classification, 'B8');
});

test('future Counterparty-direct Rental is valid without inventing a Client', () => {
  const store = state({ clients: [] });
  const result = canonicalizeRentalCounterpartyRelation(
    rental({ clientId: undefined, counterpartyId: 'CP-1' }),
    store,
  );

  assert.equal(result.counterpartyId, 'CP-1');
  assert.equal(result.clientId, undefined);
  assert.equal(store.clients.length, 0);
});

test('duplicate Client and Counterparty stable IDs are ambiguity errors', () => {
  relationError(
    () => canonicalizeRentalCounterpartyRelation(rental(), state({
      clients: [
        { id: 'C-1', counterpartyId: 'CP-1' },
        { id: 'C-1', counterpartyId: 'CP-1' },
      ],
    })),
    'COUNTERPARTY_RELATION_AMBIGUOUS',
  );
  relationError(
    () => canonicalizeRentalCounterpartyRelation(rental(), state({
      counterparties: [counterparty('CP-1'), counterparty('CP-1')],
    })),
    'COUNTERPARTY_RELATION_AMBIGUOUS',
  );
});

test('existing Rental deterministic backfill updates only the stable ID chain and linked Gantt projection', () => {
  const store = state({
    rentals: [rental()],
    gantt_rentals: [{
      id: 'GR-1',
      rentalId: 'R-1',
      clientId: 'legacy-client',
      counterpartyId: 'legacy-counterparty',
      client: 'Legacy Gantt snapshot',
      status: 'active',
    }],
  });
  const readData = name => store[name] || [];
  const writeDataBatch = entries => {
    for (const entry of entries) store[entry.name] = entry.value;
  };

  const result = repairRentalCounterpartyRelations({ readData, writeDataBatch, dryRun: false });

  assert.equal(result.changed.length, 1);
  assert.equal(store.rentals[0].counterpartyId, 'CP-1');
  assert.equal(store.gantt_rentals[0].counterpartyId, 'CP-1');
  assert.equal(store.gantt_rentals[0].clientId, 'C-1');
  assert.equal(store.gantt_rentals[0].client, 'Display snapshot only');
});

test('metadata-only Rental cannot be repaired and name or INN duplicates do not influence resolution', () => {
  const store = state({
    clients: [
      { id: 'C-1', counterpartyId: 'CP-1', company: 'Дубликат', inn: '7700000000' },
      { id: 'C-2', counterpartyId: 'CP-2', company: 'Дубликат', inn: '7700000000' },
    ],
    counterparties: [counterparty('CP-1'), counterparty('CP-2')],
    rentals: [rental({ clientId: undefined, client: 'Дубликат', clientName: 'Дубликат', inn: '7700000000' })],
  });

  const result = repairRentalCounterpartyRelations({
    readData: name => store[name] || [],
    writeDataBatch: () => assert.fail('metadata-only repair must not write'),
    dryRun: false,
  });

  assert.equal(result.changed.length, 0);
  assert.equal(result.skipped[0].code, 'COUNTERPARTY_RELATION_ID_REQUIRED');
  assert.equal(store.rentals[0].counterpartyId, undefined);
});

test('bulk/import persistence uses the same canonical rules with staged Client and Counterparty data', () => {
  const current = state({ clients: [], counterparties: [] });
  const entries = canonicalizeRentalPersistenceEntries([
    { name: 'rentals', value: [rental()] },
    { name: 'clients', value: [{ id: 'C-1', counterpartyId: 'CP-1' }] },
    { name: 'counterparties', value: [counterparty('CP-1')] },
  ], { readData: name => current[name] || [] });

  const rentalsEntry = entries.find(entry => entry.name === 'rentals');
  assert.equal(rentalsEntry.value[0].counterpartyId, 'CP-1');

  relationError(
    () => canonicalizeRentalPersistenceEntries([
      { name: 'rentals', value: [rental({ counterpartyId: 'CP-2' })] },
      { name: 'clients', value: [{ id: 'C-1', counterpartyId: 'CP-1' }] },
      { name: 'counterparties', value: [counterparty('CP-1'), counterparty('CP-2')] },
    ], { readData: name => current[name] || [] }),
    'COUNTERPARTY_RELATION_MISMATCH',
  );
});

test('Gantt customer fields are derived from authoritative Classic Rental relation and lifecycle fields remain unchanged', () => {
  const canonicalRental = rental({ counterpartyId: 'CP-1', client: 'Authoritative snapshot', status: 'closed' });
  const gantt = [{
    id: 'GR-1',
    rentalId: 'R-1',
    clientId: 'wrong',
    counterpartyId: 'wrong',
    client: 'wrong',
    startDate: '2026-08-12',
    endDate: '2026-08-20',
    status: 'returned',
  }];

  const [projected] = projectRentalCounterpartyRelations(gantt, [canonicalRental], state());

  assert.equal(projected.clientId, 'C-1');
  assert.equal(projected.counterpartyId, 'CP-1');
  assert.equal(projected.client, 'Authoritative snapshot');
  assert.equal(projected.startDate, gantt[0].startDate);
  assert.equal(projected.endDate, gantt[0].endDate);
  assert.equal(projected.status, gantt[0].status);
});

test('backfill is idempotent and creates no Client or Counterparty records', () => {
  const store = state({ rentals: [rental()] });
  const originalClients = structuredClone(store.clients);
  const originalCounterparties = structuredClone(store.counterparties);
  const readData = name => store[name] || [];
  const writeDataBatch = entries => {
    for (const entry of entries) store[entry.name] = entry.value;
  };

  const first = repairRentalCounterpartyRelations({ readData, writeDataBatch, dryRun: false });
  const second = repairRentalCounterpartyRelations({ readData, writeDataBatch, dryRun: false });

  assert.equal(first.changed.length, 1);
  assert.equal(second.changed.length, 0);
  assert.deepEqual(store.clients, originalClients);
  assert.deepEqual(store.counterparties, originalCounterparties);
});

test('audit reports safe backfill separately from unresolved metadata-only rows', () => {
  const audit = auditRentalCounterpartyRelations(state({
    rentals: [
      rental({ id: 'R-safe' }),
      rental({ id: 'R-metadata', clientId: undefined, client: 'ООО Клиент' }),
    ],
  }));

  assert.equal(audit.repairable.length, 1);
  assert.equal(audit.repairable[0].recordId, 'R-safe');
  assert.equal(audit.broken.length, 1);
  assert.equal(audit.broken[0].recordId, 'R-metadata');
});

test('Rental CSV import requires stable clientId and never resolves Client by display name', () => {
  const start = settingsSource.indexOf('const handleRentalsImport = React.useCallback');
  const end = settingsSource.indexOf('const applyRentalImport = React.useCallback', start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const importSource = settingsSource.slice(start, end);

  assert.match(settingsSource, /'ID клиента', 'ID контрагента', 'ID объекта', 'ID договора'/);
  assert.match(importSource, /clients\.filter\(item => item\.id === clientId\)/);
  assert.match(importSource, /название клиента не используется для установления связи/);
  assert.match(importSource, /Не указаны стабильные ID объекта и договора/);
  assert.doesNotMatch(importSource, /clients\.find\(item => item\.company === client\)/);
  assert.doesNotMatch(importSource, /item\.client === client\s*&&/);

  const applyStart = settingsSource.indexOf('const applyRentalImport = React.useCallback', end);
  const applyEnd = settingsSource.indexOf('const handleEquipmentImport = React.useCallback', applyStart);
  const applySource = settingsSource.slice(applyStart, applyEnd);
  assert.match(applySource, /rentalsService\.bulkReplace\(nextClassicRentals\)/);
  assert.doesNotMatch(applySource, /gantt_rentals/);
  assert.doesNotMatch(applySource, /system-data\/import/);
});
