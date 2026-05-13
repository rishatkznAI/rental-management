import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

function readSource(file) {
  return fs.readFileSync(path.join(process.cwd(), file), 'utf-8');
}

test('Payments page exposes allocation management UI and auto-allocation flow', () => {
  const source = readSource('src/app/pages/Payments.tsx');

  assert.match(source, /Распределение оплаты/);
  assert.match(source, /Сумма платежа/);
  assert.match(source, /Распределено/);
  assert.match(source, /Не распределено/);
  assert.match(source, /Часть платежа не распределена и не закрывает долг по арендам/);
  assert.match(source, /Добавить распределение/);
  assert.match(source, /Подобрать долги клиента/);
  assert.match(source, /Предпросмотр автозачёта/);
  assert.match(source, /Применить автозачёт/);
  assert.match(source, /usePaymentAllocationsList/);
  assert.match(source, /useCreatePaymentAllocation/);
  assert.match(source, /useUpdatePaymentAllocation/);
  assert.match(source, /useDeletePaymentAllocation/);
  assert.match(source, /previewPaymentAllocation\(payment\.id\)/);
  assert.match(source, /applyPaymentAllocationPreview\(payment\.id, preview\)/);
});

test('Client and rental details show allocation-aware finance state', () => {
  const clientDetail = readSource('src/app/pages/ClientDetail.tsx');
  const rentalDetail = readSource('src/app/pages/RentalDetail.tsx');

  assert.match(clientDetail, /Нераспределённые оплаты \/ авансы/);
  assert.match(clientDetail, /buildClientFinancialSnapshots\(\[client\], ganttRentals, payments, paymentAllocations\)/);
  assert.match(rentalDetail, /usePaymentAllocationsList/);
  assert.match(rentalDetail, /Оплачено через распределения/);
  assert.match(rentalDetail, /relatedAllocations/);
});

test('Client combobox tolerates legacy clients without optional contact fields', () => {
  const source = readSource('src/app/components/ui/ClientCombobox.tsx');

  assert.match(source, /String\(value \|\| ''\)\.toLowerCase\(\)\.includes\(lower\)/);
  assert.match(source, /client\.contactPerson/);
  assert.doesNotMatch(source, /client\\.contact\\.toLowerCase\\(\\)/);
  assert.doesNotMatch(source, /client\\.email\\.toLowerCase\\(\\)/);
});
