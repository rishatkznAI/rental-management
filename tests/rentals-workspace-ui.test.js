import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rentalsPagePath = path.join(process.cwd(), 'src/app/pages/Rentals.tsx');
const rentalsSource = fs.readFileSync(rentalsPagePath, 'utf8');

test('rentals workspace tabs have clear active state and mode descriptions', () => {
  assert.match(rentalsSource, /aria-pressed=\{active\}/);
  assert.match(rentalsSource, /data-state=\{active \? 'active' : 'inactive'\}/);
  assert.match(rentalsSource, /label: 'Список аренд'/);
  assert.match(rentalsSource, /label: 'План парка'/);
  assert.match(rentalsSource, /label: 'Возвраты'/);
  assert.match(rentalsSource, /label: 'Деньги и документы'/);
  assert.match(rentalsSource, /Операционный список сделок, клиентов, техники, статусов и действий\./);
  assert.match(rentalsSource, /Загрузка техники по датам: аренды, свободные окна, возвраты, доставки, сервис и простой\./);
  assert.match(rentalsSource, /Контроль ближайших, просроченных и запланированных возвратов\./);
  assert.match(rentalsSource, /Проблемные аренды: долги, оплаты, УПД, договоры и неподписанные документы\./);
});

test('rentals workspace uses contextual actions per mode', () => {
  assert.match(rentalsSource, /activeWorkspaceTab === 'planner'[\s\S]*Отметить простой/);
  assert.match(rentalsSource, /activeWorkspaceTab === 'returns'[\s\S]*Создать возвратную доставку/);
  assert.match(rentalsSource, /activeWorkspaceTab === 'debt_docs'[\s\S]*Открыть платежи/);
});

test('planner and returns are not ordinary rentals table variants', () => {
  assert.match(rentalsSource, /activeWorkspaceTab === 'planner'[\s\S]*Gantt Grid/);
  assert.match(rentalsSource, /Диспетчерская доска возвратов/);
  assert.match(rentalsSource, /activeWorkspaceTab !== 'returns' && \(/);
  assert.match(rentalsSource, /Нет данных по загрузке техники за выбранный период\./);
  assert.match(rentalsSource, /Нет актуальных возвратов за выбранный период\./);
  assert.doesNotMatch(rentalsSource, /Планировщик техники — критичные события/);
});

test('money and documents workspace keeps payment visibility guarded', () => {
  assert.match(rentalsSource, /value: canViewPayments \? formatCurrency\(rentalWorkspaceKpis\.rentalDebt\) : 'Скрыто'/);
  assert.match(rentalsSource, /\{canViewPayments && \(\s*<YAxis yAxisId="debt"/);
  assert.match(rentalsSource, /\{canViewPayments && \(\s*<Line yAxisId="debt"/);
  assert.match(rentalsSource, /\{canViewPayments && \(\s*<span className="inline-flex items-center gap-1"><span className="h-0\.5 w-4 rounded-full bg-red-600" \/> Просроченный долг, ₽<\/span>/);
  assert.match(rentalsSource, /canViewPayments \? formatCurrency\(row\.amount\) : 'Скрыто'/);
  assert.match(rentalsSource, /canViewPayments \? formatCurrency\(row\.paidAmount\) : 'Скрыто'/);
  assert.match(rentalsSource, /canViewPayments \? formatCurrency\(row\.debtAmount\) : 'Скрыто'/);
  assert.match(rentalsSource, /Нет проблем по оплатам и документам\./);
});
