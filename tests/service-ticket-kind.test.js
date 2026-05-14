import test from 'node:test';
import assert from 'node:assert/strict';

import {
  isActiveServiceTicket,
  isArchivedServiceTicket,
  isPdiServiceTicket,
  isRegularServiceTicket,
} from '../src/app/lib/serviceTicketKind.js';

test('service ticket helpers split active and archived regular service tickets', () => {
  const activeStatuses = ['new', 'in_progress', 'waiting_parts', 'needs_revision', 'ready'];

  for (const status of activeStatuses) {
    const ticket = { id: `S-${status}`, status };
    assert.equal(isRegularServiceTicket(ticket), true, `${status} remains regular service`);
    assert.equal(isActiveServiceTicket(ticket), true, `${status} must be active`);
    assert.equal(isArchivedServiceTicket(ticket), false, `${status} must not be archived`);
  }

  const closed = { id: 'S-closed', status: 'closed' };
  assert.equal(isActiveServiceTicket(closed), false);
  assert.equal(isArchivedServiceTicket(closed), true);
});

test('service ticket helpers keep PDI records out of service active and archive buckets', () => {
  const pdi = {
    id: 'PDI-1',
    type: 'pdi',
    scenario: 'pdi',
    source: 'sales',
    saleMode: true,
    pdiData: { result: 'ready_for_sale' },
    status: 'closed',
  };

  assert.equal(isPdiServiceTicket(pdi), true);
  assert.equal(isRegularServiceTicket(pdi), false);
  assert.equal(isActiveServiceTicket(pdi), false);
  assert.equal(isArchivedServiceTicket(pdi), false);
});

test('service ticket archive helper follows existing closed-status aliases only', () => {
  for (const status of ['done', 'complete', 'completed', 'finished']) {
    const ticket = { id: `S-${status}`, status };
    assert.equal(isActiveServiceTicket(ticket), false, `${status} is treated as archived legacy closed status`);
    assert.equal(isArchivedServiceTicket(ticket), true, `${status} is treated as archived legacy closed status`);
  }

  for (const status of ['archived', 'cancelled']) {
    const ticket = { id: `S-${status}`, status };
    assert.equal(isActiveServiceTicket(ticket), true, `${status} is not treated as archive without an existing normalizer`);
    assert.equal(isArchivedServiceTicket(ticket), false, `${status} is not treated as archive without an existing normalizer`);
  }
});
