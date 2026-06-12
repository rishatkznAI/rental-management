import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const financeSource = fs.readFileSync(new URL('../src/app/pages/Finance.tsx', import.meta.url), 'utf8');
const receivablesSource = fs.readFileSync(new URL('../src/app/components/finance/ReceivablesPanel.tsx', import.meta.url), 'utf8');

test('finance keeps desktop management tables while adding mobile card lists', () => {
  for (const table of [
    'latest-operations',
    'cash-flow-items',
    'equipment-economics',
    'operations-register',
    'recurring-expenses',
    'accounts',
  ]) {
    assert.match(financeSource, new RegExp(`data-finance-desktop-table="${table}"[\\s\\S]{0,120}<Table>`));
  }

  for (const list of [
    'latest-operations',
    'cash-flow-items',
    'equipment-economics',
    'operations',
    'recurring-expenses',
    'upcoming-payments',
    'accounts',
  ]) {
    assert.match(financeSource, new RegExp(`data-finance-mobile-list="${list}"`));
  }

  assert.match(receivablesSource, /data-finance-desktop-table="receivables"[\s\S]{0,120}<Table>/);
  assert.match(receivablesSource, /data-finance-mobile-list="receivables"/);
});

test('finance mobile cards expose amount date category status and action blocks', () => {
  assert.match(financeSource, /FinanceMobileField label="Сумма" value=\{formatCurrency\(expense\.amount\)\}/);
  assert.match(financeSource, /FinanceMobileField label="Категория" value=\{categoryLabel\}/);
  assert.match(financeSource, /FinanceMobileField[\s\S]{0,120}label="Ближайшая оплата"/);
  assert.match(financeSource, /getStatusBadge\(displayStatus\.status/);
  assert.match(financeSource, /data-finance-mobile-actions/);
  assert.match(financeSource, /Редактировать расход/);
  assert.match(financeSource, /Поставить расход на паузу/);
  assert.match(financeSource, /Архивировать расход/);
});

test('receivables mobile cards expose debt aging manager client status and actions', () => {
  assert.match(receivablesSource, /ReceivableMobileField label="Менеджер"/);
  assert.match(receivablesSource, /ReceivableMobileField label="Сумма долга"/);
  assert.match(receivablesSource, /ReceivableMobileField[\s\S]{0,120}label="Возраст просрочки"/);
  assert.match(receivablesSource, /ReceivableMobileField[\s\S]{0,160}label="Связанная аренда"/);
  assert.match(receivablesSource, /Badge variant=\{statusVariant\(row\.collectionStatus\)\}/);
  assert.match(receivablesSource, /data-finance-mobile-actions/);
  assert.match(receivablesSource, /Уведомление/);
  assert.match(receivablesSource, /Претензия/);
});

test('finance tabs filters and dialogs are mobile-safe', () => {
  assert.match(financeSource, /app-scroll-fade-x max-w-full min-w-0 overflow-x-auto/);
  assert.match(financeSource, /<TabsList className="w-max min-w-full justify-start sm:min-w-0">/);
  assert.match(receivablesSource, /data-finance-mobile-filters/);
  assert.match(receivablesSource, /SelectTrigger className="h-8 w-full sm:w-52"/);
  assert.match(receivablesSource, /SelectTrigger className="h-8 w-full sm:w-64"/);
  assert.match(financeSource, /DialogContent className="max-h-\[90vh\] w-\[calc\(100vw-2rem\)\] overflow-y-auto/);
  assert.match(receivablesSource, /DialogContent className="max-h-\[85vh\] w-\[calc\(100vw-2rem\)\] overflow-y-auto/);
});

test('finance mobile layout is not table-only on narrow screens', () => {
  assert.doesNotMatch(financeSource, /data-finance-mobile-list="recurring-expenses"[\s\S]{0,260}<Table>/);
  assert.doesNotMatch(financeSource, /data-finance-mobile-list="operations"[\s\S]{0,260}<Table>/);
  assert.doesNotMatch(financeSource, /data-finance-mobile-list="accounts"[\s\S]{0,260}<Table>/);
  assert.doesNotMatch(receivablesSource, /data-finance-mobile-list="receivables"[\s\S]{0,260}<Table>/);
  assert.match(financeSource, /hidden overflow-x-auto md:block/);
  assert.match(receivablesSource, /hidden overflow-x-auto md:block/);
});
