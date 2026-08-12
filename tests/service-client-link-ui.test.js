import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const formSource = readFileSync(new URL('../src/app/components/service/ServiceTicketForm.tsx', import.meta.url), 'utf8');
const serviceNewSource = readFileSync(new URL('../src/app/pages/ServiceNew.tsx', import.meta.url), 'utf8');
const serviceListSource = readFileSync(new URL('../src/app/pages/Service.tsx', import.meta.url), 'utf8');
const serviceDetailSource = readFileSync(new URL('../src/app/pages/ServiceDetail.tsx', import.meta.url), 'utf8');
const counterpartyComboboxSource = readFileSync(new URL('../src/app/components/ui/CustomerCounterpartyCombobox.tsx', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/app/pages/Settings.tsx', import.meta.url), 'utf8');
const dtoSource = readFileSync(new URL('../src/app/services/service-tickets.service.ts', import.meta.url), 'utf8');

test('service create form is Counterparty-first and keeps Client compatibility optional', () => {
  assert.match(formSource, /counterpartiesService\.getAll\(\{ role: 'customer' \}\)/);
  assert.match(formSource, /<CustomerCounterpartyCombobox/);
  assert.match(formSource, /counterpartyId=\{formData\.counterpartyId\}/);
  assert.match(formSource, /Профиль Client \(необязательно\)/);
  assert.match(formSource, /compatibleClients = clients\.filter\(item => item\.counterpartyId === formData\.counterpartyId\)/);
  assert.match(formSource, /Без профиля Client/);
});

test('service create form submits canonical Counterparty and stable compatibility links', () => {
  assert.match(formSource, /counterpartyId: formData\.counterpartyId \|\| undefined/);
  assert.match(formSource, /clientId: formData\.clientId \|\| undefined/);
  assert.match(formSource, /clientName: formData\.counterpartyId/);
  assert.match(formSource, /rentalId: formData\.rentalId \|\| undefined/);
  assert.match(formSource, /objectId: formData\.objectId \|\| undefined/);
  assert.match(formSource, /contractId: formData\.contractId \|\| undefined/);
});

test('service create form preserves internal tickets and supports stable Rental prefill', () => {
  assert.match(serviceNewSource, /searchParams\.get\('rentalId'\)/);
  assert.match(formSource, /initialRentalId/);
  assert.match(formSource, /activeRentalForEquipment/);
  assert.match(formSource, /Связать с арендой/);
  assert.match(formSource, /if \(!rental\.counterpartyId\)/);
  assert.match(formSource, /counterpartyId: rental\.counterpartyId \|\| prev\.counterpartyId/);
  assert.match(formSource, /Можно оставить пустым только для внутренней заявки/);
});

test('service form filters every customer context by selected Counterparty and resets stale links', () => {
  assert.match(formSource, /rentalBelongsToSelectedCounterparty/);
  assert.match(formSource, /rentalCounterpartyId === selectedId/);
  assert.match(formSource, /clientObjects\.filter\(item => item\.counterpartyId === formData\.counterpartyId/);
  assert.match(formSource, /clientContracts\.filter\(item =>\s*item\.counterpartyId === formData\.counterpartyId/);
  assert.match(formSource, /Аренда не принадлежит выбранному Counterparty/);
  assert.match(formSource, /Аренда сброшена, потому что она относится к другому Counterparty/);
  assert.match(formSource, /Сначала выберите Counterparty, затем аренду/);
  assert.match(formSource, /objectId: ''/);
  assert.match(formSource, /contractId: ''/);
});

test('same-name Counterparties are visibly disambiguated by stable ID', () => {
  assert.match(counterpartyComboboxSource, /`ID \$\{selection\.counterpartyId\}`/);
  assert.match(counterpartyComboboxSource, /optionId\(counterparty\.id\)/);
});

test('Service list and detail enrichment use stable IDs without customer-name lookup', () => {
  assert.match(serviceListSource, /ticket\.clientId \? clientLookup\.get\(ticket\.clientId\)/);
  assert.doesNotMatch(serviceListSource, /clientLookup\.get\(`name:/);
  assert.match(serviceDetailSource, /item\.id === ticket\.clientId && item\.counterpartyId === ticket\.counterpartyId/);
  assert.doesNotMatch(serviceDetailSource, /item\.company === ticket\.client/);
  assert.match(serviceDetailSource, /Counterparty ID/);
});

test('Settings Service CSV round-trips stable IDs and rejects unsafe legacy customer CSV', () => {
  assert.match(settingsSource, /'ID контрагента'.*'ID клиента'.*'ID аренды'.*'ID объекта'.*'ID договора'/s);
  assert.match(settingsSource, /Legacy CSV сервиса не содержит stable ID контрагента/);
  assert.match(settingsSource, /clientName && !counterpartyId && !clientId && !rentalId && !objectId && !contractId/);
});

test('service DTO keeps canonical and compatibility link fields from API responses', () => {
  assert.match(dtoSource, /counterpartyId: stringValue\(item\.counterpartyId \?\? item\.counterparty_id\) \|\| undefined/);
  assert.match(dtoSource, /counterpartyName: stringValue\(item\.counterpartyName\) \|\| undefined/);
  assert.match(dtoSource, /customerDisplayName: stringValue\(item\.customerDisplayName\) \|\| undefined/);
  assert.match(dtoSource, /clientId: stringValue\(item\.clientId \?\? item\.client_id\) \|\| undefined/);
  assert.match(dtoSource, /rentalId: stringValue\(item\.rentalId \?\? item\.rental_id\) \|\| undefined/);
});
