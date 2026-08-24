import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const serverRequire = createRequire(new URL('../server/package.json', import.meta.url));
const Database = serverRequire('better-sqlite3');
const {
  clientContractStatus,
  findSqlClientContractHistoryLinks,
  recordReferencesClientContract,
} = require('../server/lib/client-contract-lifecycle.js');

test('legacy ClientContract status defaults to active without a backfill', () => {
  assert.equal(clientContractStatus({ id: 'CC-legacy' }), 'active');
  assert.equal(clientContractStatus({ id: 'CC-active', status: 'active' }), 'active');
  assert.equal(clientContractStatus({ id: 'CC-archived', status: 'archived' }), 'archived');
});

test('contract history matcher detects direct, legacy, array, change-request, and document snapshot links', () => {
  const id = 'CC-1';
  assert.equal(recordReferencesClientContract({ contractId: id }, id), true);
  assert.equal(recordReferencesClientContract({ clientContractId: id }, id), true);
  assert.equal(recordReferencesClientContract({ contractIds: ['CC-2', id] }, id), true);
  assert.equal(recordReferencesClientContract({ newValue: { contractId: id } }, id), true);
  assert.equal(recordReferencesClientContract({ snapshot: { clientContract: { id } } }, id), true);
  assert.equal(recordReferencesClientContract({ leasingContractId: id }, id), false);
  assert.equal(recordReferencesClientContract({ contractId: 'CC-2' }, id), false);
});

test('SQL contract history scan covers canonical operational tables', () => {
  const db = new Database(':memory:');
  try {
    db.exec(`
      CREATE TABLE canonical_receivables (id TEXT PRIMARY KEY, contractId TEXT);
      CREATE TABLE unrelated (id TEXT PRIMARY KEY, leasingContractId TEXT);
      INSERT INTO canonical_receivables (id, contractId) VALUES ('AR-1', 'CC-1');
      INSERT INTO unrelated (id, leasingContractId) VALUES ('LC-1', 'CC-1');
    `);
    assert.deepEqual(findSqlClientContractHistoryLinks('CC-1', db), [
      { collection: 'canonical_receivables', count: 1, source: 'sql' },
    ]);
    assert.deepEqual(findSqlClientContractHistoryLinks('CC-2', db), []);
  } finally {
    db.close();
  }
});
