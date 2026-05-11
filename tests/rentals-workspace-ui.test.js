import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rentalsPagePath = path.join(process.cwd(), 'src/app/pages/Rentals.tsx');
const rentalsSource = fs.readFileSync(rentalsPagePath, 'utf8');
const ganttModalsPath = path.join(process.cwd(), 'src/app/components/gantt/GanttModals.tsx');
const ganttModalsSource = fs.readFileSync(ganttModalsPath, 'utf8');

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
  assert.match(rentalsSource, /activeWorkspaceTab === 'planner'[\s\S]*Добавить простой/);
  assert.match(rentalsSource, /activeWorkspaceTab === 'returns'[\s\S]*Создать возвратную доставку/);
  assert.match(rentalsSource, /activeWorkspaceTab === 'debt_docs'[\s\S]*Открыть платежи/);
});

test('fleet planner persists equipment downtime and refreshes rows after save', () => {
  assert.match(rentalsSource, /queryKey:\s*RENTAL_KEYS\.downtimes/);
  assert.match(rentalsSource, /queryFn:\s*rentalsService\.getDowntimes/);
  assert.match(rentalsSource, /findDowntimeRentalFlowTarget/);
  assert.match(rentalsSource, /downtimeFlow\.flow === 'rental'[\s\S]*requestClassicRentalChange/);
  assert.match(rentalsSource, /buildRentalDowntimePatch\(payload\)/);
  assert.doesNotMatch(rentalsSource, /data\.id\s*\?\s*\{\s*flow:\s*'standalone'\s*\}/);
  assert.match(rentalsSource, /rentalsService\.createDowntime\(payload\)/);
  assert.match(rentalsSource, /rentalsService\.updateDowntime\(data\.id,\s*payload\)/);
  assert.match(rentalsSource, /queryClient\.setQueryData<DowntimePeriod\[\]>\(RENTAL_KEYS\.downtimes/);
  assert.match(rentalsSource, /queryClient\.invalidateQueries\(\{\s*queryKey:\s*RENTAL_KEYS\.downtimes\s*\}\)/);
  assert.doesNotMatch(rentalsSource, /mockDowntimes/);
});

test('fleet planner shows rental downtime updates on rental bars', () => {
  assert.match(rentalsSource, /downtimeDays:\s*rental\.downtimeDays/);
  assert.match(rentalsSource, /setGanttRentals\(current => current\.map\(item => item\.id === currentGanttRental\.id/);
  assert.match(rentalsSource, /data-payment-alert="downtime"/);
  assert.match(rentalsSource, /Простой по аренде сохранён/);
});

test('downtime modal supports add edit close cancel and human validation', () => {
  assert.match(ganttModalsSource, /isEditing \? 'Изменить простой' : 'Добавить простой'/);
  assert.match(ganttModalsSource, /Комментарий/);
  assert.match(ganttModalsSource, /Закрыть простой/);
  assert.match(ganttModalsSource, /Отменить простой/);
  assert.match(ganttModalsSource, /Выберите технику для простоя/);
  assert.match(ganttModalsSource, /Укажите дату начала простоя/);
  assert.match(ganttModalsSource, /Дата окончания простоя не может быть раньше даты начала/);
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

test('rentals workspace KPI cards have icons and honest compact trends', () => {
  assert.match(rentalsSource, /function RentalKpiCard/);
  assert.match(rentalsSource, /function RentalKpiSparkline/);
  assert.match(rentalsSource, /const rentalWorkspaceKpiCards = useMemo<RentalKpiCardConfig\[\]>/);

  assert.match(rentalsSource, /title: 'Активные аренды'[\s\S]*icon: CalendarCheck[\s\S]*sparkline: rentalMovementSparkValues\.active/);
  assert.match(rentalsSource, /title: 'Возвраты'[\s\S]*icon: RotateCcw[\s\S]*sparkline: rentalMovementSparkValues\.returns/);
  assert.match(rentalsSource, /title: 'Просроченные возвраты'[\s\S]*icon: AlertTriangle[\s\S]*sparkline: rentalMovementSparkValues\.overdueReturns/);
  assert.match(rentalsSource, /title: 'Долг по арендам'[\s\S]*icon: Wallet[\s\S]*sparkline: canViewPayments \? rentalMovementSparkValues\.overdueDebt : undefined/);
  assert.match(rentalsSource, /title: 'Без УПД \/ договора'[\s\S]*icon: FileWarning[\s\S]*progress: missingDocsShare/);
  assert.match(rentalsSource, /title: 'Доставка сегодня'[\s\S]*icon: Truck[\s\S]*sparkline: rentalMovementSparkValues\.deliveries/);

  assert.match(rentalsSource, /const hasDrawableData = normalizedValues\.length >= 2 && normalizedValues\.some\(value => value > 0\)/);
  assert.match(rentalsSource, /sparklineFallback: 'доставок в графике нет'/);
  assert.doesNotMatch(rentalsSource, /Math\.random|fake|mock trend|mockTrend/i);
});
