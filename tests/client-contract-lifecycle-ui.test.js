import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const clientDetail = fs.readFileSync(new URL('../src/app/pages/ClientDetail.tsx', import.meta.url), 'utf8');
const rentalNew = fs.readFileSync(new URL('../src/app/pages/RentalNew.tsx', import.meta.url), 'utf8');
const rentalDetail = fs.readFileSync(new URL('../src/app/pages/RentalDetail.tsx', import.meta.url), 'utf8');
const documents = fs.readFileSync(new URL('../src/app/pages/Documents.tsx', import.meta.url), 'utf8');
const payments = fs.readFileSync(new URL('../src/app/pages/Payments.tsx', import.meta.url), 'utf8');
const serviceForm = fs.readFileSync(new URL('../src/app/components/service/ServiceTicketForm.tsx', import.meta.url), 'utf8');

test('Client Contract card exposes archive and confirmed delete with history-safe message', () => {
  assert.match(clientDetail, /handleArchiveContract/);
  assert.match(clientDetail, /Архивный/);
  assert.match(clientDetail, /Архивировать/);
  assert.match(clientDetail, /window\.confirm\(`Удалить договор/);
  assert.match(clientDetail, /CONTRACT_HAS_HISTORY/);
  assert.match(clientDetail, /Договор используется в истории и не может быть удалён\. Его можно архивировать\./);
});

test('new operation selectors hide archived contracts and historical Rental preserves its selected option', () => {
  assert.match(rentalNew, /item\.status !== 'archived'/);
  assert.match(serviceForm, /item\.status !== 'archived'/);
  assert.match(documents, /if \(contract\.status === 'archived'\) return false/);
  assert.match(payments, /item\.status !== 'archived'/);
  assert.match(rentalDetail, /selectedRentalContract && !activeContractOptions\.some/);
  assert.match(rentalDetail, /\[selectedRentalContract, \.\.\.activeContractOptions\]/);
});
