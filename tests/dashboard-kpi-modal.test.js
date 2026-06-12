import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const source = fs.readFileSync(
  path.join(process.cwd(), 'src/app/components/modals/KPIDetailModal.tsx'),
  'utf8',
);
const approvalHistorySheetSource = fs.readFileSync(
  path.join(process.cwd(), 'src/app/components/gantt/RentalApprovalHistorySheet.tsx'),
  'utf8',
);

test('dashboard KPI modal uses stable fallback keys for legacy rows without ids', () => {
  assert.match(source, /function kpiRowKey/);
  assert.match(source, /key=\{kpiRowKey\('debt-client', client, index, client\?\.company\)\}/);
  assert.match(source, /key=\{kpiRowKey\('total-debt-payment', p, index, p\?\.invoiceNumber\)\}/);
  assert.doesNotMatch(source, /key=\{client\.id\}/);
  assert.doesNotMatch(source, /<div key=\{p\.id\}/);
});

test('dashboard KPI modal does not build detail routes from missing entity ids', () => {
  assert.match(source, /function entityHref/);
  assert.match(source, /to=\{rental\.link \|\| entityHref\('rentals', rental\.id\)\}/);
  assert.match(source, /to=\{entityHref\('service', ticket\.id\)\}/);
  assert.match(source, /to=\{entityHref\('clients', client\.id\)\}/);
  assert.equal(source.includes('`/rentals/${rental.id}`'), false);
  assert.equal(source.includes('`/service/${ticket.id}`'), false);
  assert.equal(source.includes('`/clients/${client.id}`'), false);
});

test('dashboard KPI modal formats missing money values as zero rubles instead of NaN', () => {
  assert.match(source, /function safeCurrency/);
  assert.match(source, /Number\.isFinite\(amount\) \? amount : 0/);
  assert.doesNotMatch(source, /formatCurrency\(client\.debt\)/);
  assert.doesNotMatch(source, /formatCurrency\(data\.totalDebt\)/);
});

test('deep dashboard modal and approval history sheet use semantic UI tokens', () => {
  const legacyColorUtility = /\b(?:bg|text|border|divide)-(?:white|gray|slate|blue|red|yellow|amber|emerald|green|orange|purple|violet)-/;

  assert.doesNotMatch(source, legacyColorUtility);
  assert.doesNotMatch(approvalHistorySheetSource, legacyColorUtility);
});
