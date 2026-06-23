import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/app/pages/Payments.tsx', import.meta.url), 'utf8');

function extract(startMarker, endMarker) {
  const start = source.indexOf(startMarker);
  assert.notEqual(start, -1, `Missing start marker: ${startMarker}`);
  const end = source.indexOf(endMarker, start);
  assert.notEqual(end, -1, `Missing end marker: ${endMarker}`);
  return source.slice(start, end);
}

test('payments page preserves desktop table while exposing mobile cards', () => {
  assert.match(source, /data-payments-responsive-root="true"/);
  assert.match(source, /overflow-x-clip/);
  assert.match(source, /data-payment-desktop-table="true" className="hidden overflow-x-auto md:block"/);
  assert.match(source, /<table className="min-w-\[1040px\] w-full border-collapse text-sm">/);
  assert.match(source, /data-payment-mobile-list="true" className="grid gap-3 p-3 md:hidden"/);
  assert.match(source, /data-payment-mobile-card="true"/);
});

test('payment mobile cards expose safe office payment fields and actions', () => {
  const mobileBlock = extract('data-payment-mobile-list="true"', 'data-payment-desktop-table="true"');

  assert.match(mobileBlock, /data-payment-mobile-client="true"/);
  assert.match(mobileBlock, /data-payment-mobile-rental="true"/);
  assert.match(mobileBlock, /data-payment-mobile-amount="true"/);
  assert.match(mobileBlock, /data-payment-mobile-date="true"/);
  assert.match(mobileBlock, /data-payment-mobile-status="true"/);
  assert.match(mobileBlock, /data-payment-mobile-actions="true"/);
  assert.match(mobileBlock, /break-words/);
  assert.match(mobileBlock, /break-all/);
  assert.match(mobileBlock, /<PaymentStatusPill status=\{payment\.status\} \/>/);
  assert.match(mobileBlock, /setSelectedPaymentId\(payment\.id\)/);
  assert.doesNotMatch(mobileBlock, /<table/);
});

test('payments redesign exposes status tabs and right detail panel with safe fallbacks', () => {
  assert.match(source, /Платежи/);
  assert.match(source, /Управление платежами и задолженностями/);
  assert.match(source, /Новый платеж/);
  assert.match(source, /Экспорт/);
  assert.match(source, /Прогноз поступлений/);
  assert.match(source, /Все платежи/);
  assert.match(source, /К оплате/);
  assert.match(source, /Ожидают/);
  assert.match(source, /Просрочено/);
  assert.match(source, /Выберите платёж/);
  assert.match(source, /Связанные документы/);
  assert.match(source, /Скачать счёт/);
  assert.match(source, /Отметить оплаченным/);
  assert.match(source, /function safeLabel/);
  assert.match(source, /function paymentNumber/);
  assert.match(source, /function paymentClientName/);
  assert.match(source, /function PaymentStatusPill/);
});

test('payment detail allocation panel has mobile card structure and desktop table fallback', () => {
  assert.match(source, /data-payment-detail-responsive="true"/);
  assert.match(source, /max-w-full overflow-hidden/);
  assert.match(source, /data-payment-allocation-mobile-list="true" className="mt-5 space-y-3 md:hidden"/);
  assert.match(source, /data-payment-allocation-mobile-card="true"/);
  assert.match(source, /data-payment-allocation-desktop-table="true" className="mt-5 hidden overflow-x-auto rounded-lg border/);
});

test('payment forms and empty state are mobile-safe', () => {
  assert.match(source, /className="grid gap-3 sm:grid-cols-2"/);
  assert.match(source, /max-h-\[min\(92dvh,calc\(100dvh-2rem\)\)\]/);
  assert.match(source, /overflow-y-auto px-6 py-5/);
  assert.match(source, /Сбросить фильтры/);
  assert.match(source, /pagination\.setFilters\(\{ clientId: 'all', status: 'all' \}\)/);
});
