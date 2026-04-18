import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const {
  mergeEntityHistory,
  mergeRentalHistory,
} = require('../server/lib/audit-history.js');

test('mergeEntityHistory creates server-side client creation entry', () => {
  const client = mergeEntityHistory(
    'clients',
    null,
    {
      id: 'c-1',
      company: 'ЭМ-СТРОЙ',
      history: [],
    },
    'Руслан',
  );

  assert.equal(client.history.length, 1);
  assert.equal(client.history[0].author, 'Руслан');
  assert.match(client.history[0].text, /Клиент создан/);
});

test('mergeEntityHistory appends equipment diff history and preserves custom incoming entries', () => {
  const previous = {
    id: 'eq-1',
    inventoryNumber: '083',
    status: 'available',
    history: [
      { date: '2026-04-18T10:00:00.000Z', author: 'Система', text: 'Старая запись', type: 'system' },
    ],
  };
  const next = {
    ...previous,
    status: 'in_service',
    history: [
      ...previous.history,
      { date: '2026-04-18T11:00:00.000Z', author: 'Руслан', text: 'Передана в сервис после возврата', type: 'system' },
    ],
  };

  const merged = mergeEntityHistory('equipment', previous, next, 'Руслан');

  assert.equal(merged.history.length, 3);
  assert.equal(merged.history.some(entry => entry.text.includes('Передана в сервис после возврата')), true);
  assert.equal(merged.history.some(entry => entry.text.includes('Обновлена карточка техники')), true);
});

test('mergeRentalHistory creates server-side rental creation entry and preserves user comment', () => {
  const rental = mergeRentalHistory(
    null,
    {
      id: 'gr-1',
      client: 'ЭМ-СТРОЙ',
      startDate: '2026-04-10',
      endDate: '2026-04-20',
      status: 'created',
      comments: [
        { date: '2026-04-18T11:00:00.000Z', author: 'Руслан', text: 'Клиент просил раннюю доставку', type: 'comment' },
      ],
    },
    'Руслан',
  );

  assert.equal(rental.comments.length, 2);
  assert.equal(rental.comments.some(entry => entry.type === 'comment'), true);
  assert.equal(rental.comments.some(entry => entry.text.includes('Аренда создана')), true);
});

test('mergeRentalHistory appends server diff history without duplicating existing entries', () => {
  const previous = {
    id: 'gr-1',
    client: 'ЭМ-СТРОЙ',
    manager: 'Руслан',
    startDate: '2026-04-10',
    endDate: '2026-04-20',
    amount: 100000,
    expectedPaymentDate: '2026-04-15',
    comments: [
      { date: '2026-04-18T10:00:00.000Z', author: 'Руслан', text: 'Старая запись', type: 'system' },
    ],
  };
  const next = {
    ...previous,
    endDate: '2026-04-22',
    comments: [...previous.comments],
  };

  const merged = mergeRentalHistory(previous, next, 'Руслан');

  assert.equal(merged.comments.length, 2);
  assert.equal(merged.comments.some(entry => entry.text.includes('Обновлена аренда')), true);
});
