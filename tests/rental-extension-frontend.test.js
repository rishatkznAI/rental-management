import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildExtensionConflictDisplay,
  buildExtensionFormState,
  formatExtensionDate,
  getRentalExtensionValidation,
} from '../src/app/lib/rentalExtension.js';

test('rental extension helper formats dates and disables invalid form', () => {
  const rental = {
    id: 'R-1',
    status: 'active',
    plannedReturnDate: '2026-06-10',
    equipment: ['INV-1'],
  };

  assert.equal(formatExtensionDate('2026-06-10'), '10.06.2026');
  assert.equal(formatExtensionDate('bad-value'), '—');

  const initial = buildExtensionFormState(rental);
  assert.equal(initial.newPlannedReturnDate, '2026-06-10');
  assert.match(getRentalExtensionValidation({ rental, form: initial, today: '2026-05-02', hasEquipment: true }), /позже/);

  const valid = { newPlannedReturnDate: '2026-06-12', reason: 'Клиент продлевает работы', comment: '' };
  assert.equal(getRentalExtensionValidation({ rental, form: valid, today: '2026-05-02', hasEquipment: true }), '');

  const noEquipment = getRentalExtensionValidation({ rental, form: valid, today: '2026-05-02', hasEquipment: false });
  assert.match(noEquipment, /без техники/);
});

test('rental extension helper displays conflict without unsafe text', () => {
  const display = buildExtensionConflictDisplay({
    date: '2026-06-12',
    startDate: '2026-06-12',
    endDate: '2026-06-15',
    client: undefined,
    rentalId: undefined,
    status: null,
  });

  assert.equal(display.client, 'Без клиента');
  assert.equal(display.rental, '—');
  assert.equal(display.status, '—');
  assert.equal(display.period, '12.06.2026 — 15.06.2026');
  assert.equal(JSON.stringify(display).includes('NaN'), false);
  assert.equal(JSON.stringify(display).includes('undefined'), false);
  assert.equal(JSON.stringify(display).includes('null'), false);
});
