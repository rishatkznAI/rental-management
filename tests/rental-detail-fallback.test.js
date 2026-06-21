import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const badgeSource = readFileSync(new URL('../src/app/components/ui/badge.tsx', import.meta.url), 'utf8');
const rentalDetailSource = readFileSync(new URL('../src/app/pages/RentalDetail.tsx', import.meta.url), 'utf8');
const selectSource = readFileSync(new URL('../src/app/components/ui/select.tsx', import.meta.url), 'utf8');

test('rental detail status badge has defensive fallback for legacy statuses', () => {
  assert.match(rentalDetailSource, /getRentalStatusBadge\(isEditing \? formState\.status : rental\.status\)/);
  assert.match(badgeSource, /function getBadgeMeta/);
  assert.match(badgeSource, /readableFallback/);
  assert.match(badgeSource, /map\[key\] \|\| \{ label: readableFallback\(value, emptyLabel\), variant: 'default' \}/);
  assert.match(badgeSource, /getRentalStatusBadge\(status: RentalStatus \| string \| null \| undefined\)/);
  assert.doesNotMatch(badgeSource, /const \{ label, variant \} = map\[status\];/);
});

test('shared select keeps selected labels visible after choosing an item', () => {
  assert.match(selectSource, /const SelectLabelContext = React\.createContext/);
  assert.match(selectSource, /function normalizeSelectValue\(value: unknown\): string \| undefined/);
  assert.match(selectSource, /value=\{normalizedValue\}/);
  assert.match(selectSource, /defaultValue=\{normalizedDefaultValue\}/);
  assert.match(selectSource, /onValueChange=\{handleValueChange\}/);
  assert.match(selectSource, /labelContext\.labels\.get\(labelContext\.selectedValue\)/);
  assert.match(selectSource, /\{children \?\? selectedLabel\}/);
  assert.match(selectSource, /value=\{normalizedValue\}/);
  assert.match(selectSource, /labelContext\?\.registerLabel\(normalizedValue, label\)/);
});

test('rental document creation modal renders selected type and status labels', () => {
  const dialogStart = rentalDetailSource.indexOf('<Dialog open={documentDialogOpen}');
  const dialogEnd = rentalDetailSource.indexOf('<Dialog open={paymentDialogOpen}', dialogStart);
  const dialogSource = rentalDetailSource.slice(dialogStart, dialogEnd > dialogStart ? dialogEnd : undefined);

  assert.match(rentalDetailSource, /const RENTAL_DOCUMENT_TYPE_LABELS: Partial<Record<DocumentType, string>> = \{/);
  assert.match(rentalDetailSource, /invoice: 'Счёт'/);
  assert.match(rentalDetailSource, /act: 'Акт'/);
  assert.match(rentalDetailSource, /contract: 'Договор'/);
  assert.match(rentalDetailSource, /const RENTAL_DOCUMENT_STATUS_LABELS: Record<'draft' \| 'sent' \| 'signed', string> = \{/);
  assert.match(dialogSource, /<SelectValue>\{RENTAL_DOCUMENT_TYPE_LABELS\[documentForm\.type\] \|\| 'Без названия'\}<\/SelectValue>/);
  assert.match(dialogSource, /<SelectValue>\{RENTAL_DOCUMENT_STATUS_LABELS\[documentForm\.status\] \|\| 'Не указан'\}<\/SelectValue>/);
  assert.match(dialogSource, /<SelectItem value="invoice">Счёт<\/SelectItem>/);
  assert.match(dialogSource, /<SelectItem value="draft">Черновик<\/SelectItem>/);
});
