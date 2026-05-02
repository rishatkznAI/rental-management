import test from 'node:test';
import assert from 'node:assert/strict';
import { formatRentalAuditEvents, FINANCE_HIDDEN_TEXT } from '../src/app/lib/rentalAuditHistory.js';

test('rental audit history formatter is defensive and hides finance changes', () => {
  const events = formatRentalAuditEvents([
    {
      id: 'AUD-1',
      createdAt: '',
      userName: '',
      role: null,
      action: 'rentals.update',
      actionLabel: 'Изменение аренды',
      actionKind: 'update',
      entityType: 'rentals',
      entityId: 'R-1',
      description: null,
      changes: [
        { field: 'plannedReturnDate', label: 'Плановая дата возврата', before: '2026-04-25', after: '2026-04-30' },
        { field: 'price', label: 'Цена', before: null, after: null, hidden: true },
        { field: 'bad', label: 'Плохое поле', before: Number.NaN, after: undefined },
      ],
    },
  ]);

  assert.equal(events.length, 1);
  assert.equal(events[0].userName, 'Система');
  assert.equal(events[0].changes[1].text, FINANCE_HIDDEN_TEXT);
  assert.equal(JSON.stringify(events).includes('NaN'), false);
  assert.equal(JSON.stringify(events).includes('undefined'), false);
});
