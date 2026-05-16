import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const formSource = readFileSync(new URL('../src/app/components/service/ServiceTicketForm.tsx', import.meta.url), 'utf8');
const serviceNewSource = readFileSync(new URL('../src/app/pages/ServiceNew.tsx', import.meta.url), 'utf8');
const dtoSource = readFileSync(new URL('../src/app/services/service-tickets.service.ts', import.meta.url), 'utf8');

test('service create form loads clients and renders searchable client combobox', () => {
  assert.match(formSource, /useClientsList\(\{ enabled: canViewClients \}\)/);
  assert.match(formSource, /<ClientCombobox/);
  assert.match(formSource, /Введите название, ИНН, контакт или телефон/);
  assert.match(formSource, /onClientSelect=\{\(client\) =>/);
});

test('service create form submits client and rental links', () => {
  assert.match(formSource, /clientId: formData\.clientId \|\| undefined/);
  assert.match(formSource, /clientName: selectedClient\?\.company \|\| formData\.client \|\| undefined/);
  assert.match(formSource, /rentalId: formData\.rentalId \|\| undefined/);
});

test('service create form supports rental prefill and explicit active rental link', () => {
  assert.match(serviceNewSource, /searchParams\.get\('rentalId'\)/);
  assert.match(formSource, /initialRentalId/);
  assert.match(formSource, /activeRentalForEquipment/);
  assert.match(formSource, /Связать с арендой/);
  assert.match(formSource, /applyRentalLink/);
});

test('service DTO keeps client link fields from API responses', () => {
  assert.match(dtoSource, /clientId: stringValue\(item\.clientId \?\? item\.client_id\) \|\| undefined/);
  assert.match(dtoSource, /clientName: stringValue\(item\.clientName \?\? item\.client\) \|\| undefined/);
  assert.match(dtoSource, /rentalId: stringValue\(item\.rentalId \?\? item\.rental_id\) \|\| undefined/);
});
