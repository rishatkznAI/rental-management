import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const rentalsPagePath = path.join(process.cwd(), 'src/app/pages/Rentals.tsx');
const rentalsSource = fs.readFileSync(rentalsPagePath, 'utf8');
const ganttModalsPath = path.join(process.cwd(), 'src/app/components/gantt/GanttModals.tsx');
const ganttModalsSource = fs.readFileSync(ganttModalsPath, 'utf8');
const rentalDrawerPath = path.join(process.cwd(), 'src/app/components/gantt/RentalDrawer.tsx');
const rentalDrawerSource = fs.readFileSync(rentalDrawerPath, 'utf8');

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
  assert.match(rentalsSource, /downtimeFlow\.flow === 'rental'[\s\S]*saveAsRentalDowntime\(downtimeFlow\.rental\)/);
  assert.match(rentalsSource, /rentalsService\.createRentalDowntime/);
  assert.match(rentalsSource, /rentalsService\.updateRentalDowntime/);
  assert.doesNotMatch(rentalsSource, /data\.id\s*\?\s*\{\s*flow:\s*'standalone'\s*\}/);
  assert.match(rentalsSource, /rentalsService\.createDowntime\(payload\)/);
  assert.match(rentalsSource, /rentalsService\.updateDowntime\(data\.id,\s*payload\)/);
  assert.match(rentalsSource, /queryClient\.setQueryData<DowntimePeriod\[\]>\(RENTAL_KEYS\.downtimes/);
  assert.match(rentalsSource, /queryClient\.invalidateQueries\(\{\s*queryKey:\s*RENTAL_KEYS\.downtimes\s*\}\)/);
  assert.doesNotMatch(rentalsSource, /mockDowntimes/);
});

test('opening rentals workspace does not bulk-save gantt rows as cleanup', () => {
  assert.doesNotMatch(
    rentalsSource,
    /React\.useEffect\(\(\)\s*=>\s*\{[\s\S]*status === 'created'[\s\S]*void persistGanttRentals\(cleaned\)/,
  );
  assert.doesNotMatch(
    rentalsSource,
    /React\.useEffect\(\(\)\s*=>\s*\{[\s\S]*bulkReplaceGantt/,
  );
});

test('fleet planner row downtime action is visible and explicit', () => {
  assert.match(rentalsSource, /opacity-100 transition-opacity/);
  assert.match(rentalsSource, /title="Добавить простой"[\s\S]*aria-label="Добавить простой"/);
  assert.match(rentalsSource, /<span>Простой<\/span>/);
  assert.doesNotMatch(rentalsSource, /opacity-0 transition-opacity group-hover:opacity-100/);
});

test('rental drawer downtime action opens downtime modal flow', () => {
  assert.match(rentalDrawerSource, /onDowntime:\s*\(rental:\s*GanttRentalData,\s*downtime\?:\s*DowntimePeriod\)\s*=>\s*void/);
  assert.match(rentalDrawerSource, /Создать простой/);
  assert.match(rentalDrawerSource, /onClick=\{\(\)\s*=>\s*onDowntime\(rental\)\}/);
  assert.match(rentalDrawerSource, /Простои/);
  assert.match(rentalDrawerSource, /downtimePeriods\.map/);
  assert.match(rentalsSource, /onDowntime=\{\(rental,\s*downtime\)\s*=>\s*\{/);
  assert.match(rentalsSource, /handleOpenDowntime\(currentEquipment,\s*downtimePreset,\s*rental\)/);
});

test('fleet planner shows rental downtime updates on rental bars', () => {
  assert.match(rentalsSource, /downtimeDays:\s*rental\.downtimeDays/);
  assert.match(rentalsSource, /downtimeStartDate:\s*rental\.downtimeStartDate/);
  assert.match(rentalsSource, /downtimePeriods:\s*\(rental\.downtimePeriods/);
  assert.match(rentalsSource, /RENTAL_DOWNTIME_ID_PREFIX/);
  assert.match(rentalsSource, /rentalDowntimePeriodsFromRental/);
  assert.match(rentalsSource, /getRentalDowntimesForEquipment/);
  assert.match(rentalsSource, /mergeDowntimeLists\(getDowntimesForEquipment\(eq\),\s*getRentalDowntimesForEquipment\(eq\)\)/);
  assert.match(rentalsSource, /data\.id\?\.startsWith\(RENTAL_DOWNTIME_ID_PREFIX\)/);
  assert.match(rentalsSource, /rentalDowntimePeriods\.map\(period =>/);
  assert.match(rentalsSource, /setGanttRentals\(current => current\.map\(item => item\.id === response\.ganttRental\?\.id/);
  assert.match(rentalsSource, /data-payment-alert="downtime"/);
  assert.match(rentalsSource, /Простой аренды добавлен/);
});

test('fleet planner keeps equipment-id rentals out of inventory fallback buckets', () => {
  assert.match(rentalsSource, /const filteredRentalsByEquipmentId = useMemo/);
  assert.match(rentalsSource, /const filteredRentalsBySerial = useMemo/);
  assert.match(rentalsSource, /const filteredRentalsByInventory = useMemo/);
  assert.match(rentalsSource, /if \(!rental\.equipmentInv \|\| rental\.equipmentId \|\| rental\.serialNumber\) return;/);
  assert.match(rentalsSource, /mergeGanttRentalLists\(byId, bySerial, byInventory\)/);
});

test('downtime modal supports add edit close cancel and human validation', () => {
  assert.match(ganttModalsSource, /isEditing \? 'Изменить простой' : 'Добавить простой'/);
  assert.match(ganttModalsSource, /serialNumber/);
  assert.match(ganttModalsSource, /Комментарий/);
  assert.match(ganttModalsSource, /Закрыть простой/);
  assert.match(ganttModalsSource, /Отменить простой/);
  assert.match(ganttModalsSource, /Выберите технику для простоя/);
  assert.match(ganttModalsSource, /Укажите дату начала простоя/);
  assert.match(ganttModalsSource, /Укажите дату окончания простоя/);
  assert.match(ganttModalsSource, /Укажите причину простоя/);
  assert.match(ganttModalsSource, /Влияет на начисление/);
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

test('rentals workspace paginates rendered rental rows after filters and tab selection', () => {
  assert.match(rentalsSource, /DEFAULT_RENTAL_LIST_PAGE_SIZE/);
  assert.match(rentalsSource, /RENTAL_LIST_PAGE_SIZE_OPTIONS/);
  assert.match(rentalsSource, /const \[currentPage, setCurrentPage\] = useState\(1\)/);
  assert.match(rentalsSource, /const \[pageSize, setPageSize\] = useState\(DEFAULT_RENTAL_LIST_PAGE_SIZE\)/);
  assert.match(rentalsSource, /const filteredRentalRows = useMemo/);
  assert.match(rentalsSource, /getRentalListPageState\(filteredRentalRows, currentPage, pageSize\)/);
  assert.match(rentalsSource, /const paginatedRentalRows = rentalListPagination\.pageItems/);
  assert.match(rentalsSource, /rentalListPagination\.total === 0/);
  assert.match(rentalsSource, /\) : paginatedRentalRows\.map\(row =>/);
  assert.match(rentalsSource, /rows: paginatedRentalRows\.filter\(row => row\.isReturnToday\)/);
  assert.doesNotMatch(rentalsSource, /filteredRentalRows\.map\(row =>/);
  assert.doesNotMatch(rentalsSource, /rows: returnsWorkspaceRows\.filter\(row => row\.isReturnToday\)/);
  assert.match(rentalsSource, /\{filteredRentalRows\.length\} записей по текущим фильтрам/);
  assert.match(rentalsSource, /const activeRows = rentalDealRows\.filter\(row => row\.isActive\)/);
});

test('rentals workspace pagination controls reset clamp and keep table actions working', () => {
  assert.match(rentalsSource, /data-rental-list-pagination=\{placement\}/);
  assert.match(rentalsSource, /rentalListPaginationControls\('top'\)/);
  assert.match(rentalsSource, /rentalListPaginationControls\('bottom'\)/);
  assert.match(rentalsSource, /aria-label="Записей на странице"/);
  assert.match(rentalsSource, /disabled=\{!rentalListPagination\.hasPreviousPage\}[\s\S]*Назад/);
  assert.match(rentalsSource, /disabled=\{!rentalListPagination\.hasNextPage\}[\s\S]*Вперёд/);
  assert.match(rentalsSource, /setCurrentPage\(1\);[\s\S]*filterClient[\s\S]*filterManager[\s\S]*filterModel[\s\S]*filterStatus[\s\S]*pageSize[\s\S]*returnStateFilter/);
  assert.match(rentalsSource, /if \(currentPage !== rentalListPagination\.currentPage\) \{[\s\S]*setCurrentPage\(rentalListPagination\.currentPage\)/);
  assert.match(rentalsSource, /onClick=\{\(\) => setSelectedRental\(row\.rental\)\}/);
  assert.match(rentalsSource, /Ничего не найдено/);
});
