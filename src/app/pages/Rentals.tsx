import React, { useState, useMemo, useRef, useCallback } from 'react';
import {
  Plus, ChevronLeft, ChevronRight, RotateCcw, CirclePause as PauseCircle,
  Search, CircleCheck, CircleAlert, CreditCard,
  AlertTriangle, Wrench
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { RentalDrawer } from '../components/gantt/RentalDrawer';
import { ReturnModal, DowntimeModal, NewRentalModal } from '../components/gantt/GanttModals';
import {
  mockDowntimes,
  mockServicePeriods,
  loadEquipment, saveEquipment, EQUIPMENT_STORAGE_KEY,
  loadGanttRentals, saveGanttRentals, GANTT_RENTALS_STORAGE_KEY,
  loadPayments, savePayments, PAYMENTS_STORAGE_KEY,
} from '../mock-data';
import { loadUsers } from './Settings';
import type { GanttRentalData, DowntimePeriod, ServicePeriod } from '../mock-data';
import type { Equipment, EquipmentType, EquipmentStatus, Payment } from '../types';
import {
  addDays, differenceInDays, format, startOfDay,
  isSameDay, isWeekend, max as dateMax, min as dateMin
} from 'date-fns';
import { ru } from 'date-fns/locale';

// ========== Constants & Types ==========
type Scale = 'day' | 'week' | 'month';

const SCALE_CONFIG: Record<Scale, { dayWidth: number; totalDays: number; label: string }> = {
  day: { dayWidth: 80, totalDays: 14, label: 'День' },
  week: { dayWidth: 40, totalDays: 28, label: 'Неделя' },
  month: { dayWidth: 14, totalDays: 90, label: 'Месяц' },
};

const LEFT_PANEL_WIDTH = 280;
const ROW_HEIGHT = 80;

const TYPE_LABELS: Record<EquipmentType, string> = {
  scissor: 'Ножничный',
  articulated: 'Коленчатый',
  telescopic: 'Телескопический',
};

const EQ_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  available: { label: 'Свободна', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  rented: { label: 'В аренде', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  reserved: { label: 'Бронь', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  in_service: { label: 'В сервисе', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  inactive: { label: 'Списан', color: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
};

const RENTAL_BAR_COLORS: Record<GanttRentalData['status'], string> = {
  active: 'bg-blue-600 dark:bg-blue-500 border-l-4 border-l-blue-800',
  created: 'bg-slate-500 dark:bg-slate-400 border-l-4 border-l-slate-700',
  returned: 'bg-emerald-600 dark:bg-emerald-500 border-l-4 border-l-emerald-800',
  closed: 'bg-gray-400 dark:bg-gray-500 border-l-4 border-l-gray-600',
};

const RENTAL_STATUS_LABEL: Record<GanttRentalData['status'], string> = {
  active: 'Аренда',
  created: 'Бронь',
  returned: 'Возвр.',
  closed: 'Закр.',
};

const PAYMENT_STATUS_FILTERS = [
  { value: '', label: 'Все' },
  { value: 'paid', label: 'Оплачено' },
  { value: 'unpaid', label: 'Не оплачено' },
  { value: 'partial', label: 'Частично' },
];

const RENTAL_STATUS_FILTERS = [
  { value: '', label: 'Все статусы' },
  { value: 'created', label: 'Создана' },
  { value: 'active', label: 'В аренде' },
  { value: 'returned', label: 'Возвращена' },
  { value: 'closed', label: 'Закрыта' },
];

// ========== Helpers ==========
function getVisibleRange(baseDate: Date, scale: Scale) {
  const cfg = SCALE_CONFIG[scale];
  const offset = Math.floor(cfg.totalDays / 3);
  const viewStart = startOfDay(addDays(baseDate, -offset));
  const viewEnd = startOfDay(addDays(viewStart, cfg.totalDays));
  return { viewStart, viewEnd, totalDays: cfg.totalDays };
}

function barPosition(
  barStart: Date, barEnd: Date, viewStart: Date, totalDays: number, dayWidth: number
) {
  const clampedStart = dateMax([barStart, viewStart]);
  const viewEnd = addDays(viewStart, totalDays);
  const clampedEnd = dateMin([barEnd, viewEnd]);
  if (clampedStart >= clampedEnd) return null;

  const leftDays = differenceInDays(clampedStart, viewStart);
  const widthDays = differenceInDays(clampedEnd, clampedStart);
  return {
    left: leftDays * dayWidth,
    width: Math.max(widthDays * dayWidth, dayWidth * 0.5),
  };
}

function detectConflicts(rentals: GanttRentalData[], equipmentInv: string): Set<string> {
  const eqRentals = rentals.filter(r => r.equipmentInv === equipmentInv);
  const conflictIds = new Set<string>();

  for (let i = 0; i < eqRentals.length; i++) {
    for (let j = i + 1; j < eqRentals.length; j++) {
      const a = eqRentals[i];
      const b = eqRentals[j];
      const aStart = new Date(a.startDate);
      const aEnd = new Date(a.endDate);
      const bStart = new Date(b.startDate);
      const bEnd = new Date(b.endDate);
      if (aStart < bEnd && bStart < aEnd) {
        conflictIds.add(a.id);
        conflictIds.add(b.id);
      }
    }
  }
  return conflictIds;
}

/**
 * Единый источник истины для статуса техники.
 * Вычисляет статус на основе активных аренд (не из поля equipment.status).
 * equipment.status используется только для 'inactive' и 'in_service' (ручные статусы).
 */
function computeEffectiveStatus(
  equipment: Equipment,
  rentals: GanttRentalData[], // уже отфильтрованные для данной единицы техники
  today: Date,
): EquipmentStatus {
  // Ручные статусы переопределяют всё
  if (equipment.status === 'inactive' || equipment.status === 'in_service') {
    return equipment.status;
  }
  const todayStr = format(today, 'yyyy-MM-dd');
  const activeRentals = rentals.filter(
    r => r.status !== 'returned' && r.status !== 'closed',
  );
  // Аренда, охватывающая сегодняшний день
  const current = activeRentals.find(
    r => r.startDate <= todayStr && r.endDate >= todayStr,
  );
  if (current) {
    return current.status === 'active' ? 'rented' : 'reserved';
  }
  // Будущая аренда (забронирована)
  const upcoming = activeRentals.find(r => r.startDate > todayStr);
  if (upcoming) return 'reserved';
  return 'available';
}

// ========== Main Component ==========
export default function Rentals() {
  const today = useMemo(() => startOfDay(new Date()), []);
  const [ganttRentals, setGanttRentals] = useState<GanttRentalData[]>(() => loadGanttRentals());
  const [equipmentList, setEquipmentList] = useState(() => loadEquipment());
  const [payments, setPayments] = useState<Payment[]>(() => loadPayments());

  React.useEffect(() => {
    const reload = () => {
      setGanttRentals(loadGanttRentals());
      setEquipmentList(loadEquipment());
      setPayments(loadPayments());
    };
    const onStorage = (e: StorageEvent) => {
      if (e.key === GANTT_RENTALS_STORAGE_KEY || e.key === EQUIPMENT_STORAGE_KEY || e.key === PAYMENTS_STORAGE_KEY) reload();
    };
    // Перезагружаем данные при возврате на вкладку (focus / visibilitychange)
    const onVisible = () => { if (document.visibilityState === 'visible') reload(); };
    window.addEventListener('storage', onStorage);
    window.addEventListener('focus', reload);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('focus', reload);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

  // Очистка «призрачных» аренд при загрузке страницы:
  // - 'created' с прошедшей endDate → 'closed'  (не активированные черновики)
  // - 'active'  с прошедшей endDate → 'returned' (техника вернулась, но возврат не оформили вручную)
  React.useEffect(() => {
    const todayStr = format(today, 'yyyy-MM-dd');
    const current = loadGanttRentals();

    const needsCleanup = current.some(r =>
      (r.status === 'created' && r.endDate < todayStr) ||
      (r.status === 'active'  && r.endDate < todayStr),
    );

    if (!needsCleanup) return;

    const cleaned = current.map(r => {
      if (r.status === 'created' && r.endDate < todayStr)
        return { ...r, status: 'closed' as const };
      if (r.status === 'active' && r.endDate < todayStr)
        return { ...r, status: 'returned' as const };
      return r;
    });
    saveGanttRentals(cleaned);
    setGanttRentals(cleaned);

    // Для закрытых/возвращённых аренд: если у техники больше нет активных аренд —
    // обновляем статус техники на 'available'.
    const eqList = loadEquipment();
    const affectedInvs = new Set(
      current
        .filter(r =>
          (r.status === 'created' || r.status === 'active') && r.endDate < todayStr,
        )
        .map(r => r.equipmentInv),
    );
    let eqChanged = false;
    const updatedEq = eqList.map(e => {
      if (!affectedInvs.has(e.inventoryNumber)) return e;
      const stillActive = cleaned.some(
        r => r.equipmentInv === e.inventoryNumber
          && r.status !== 'returned' && r.status !== 'closed',
      );
      if (!stillActive && e.status !== 'inactive' && e.status !== 'in_service') {
        eqChanged = true;
        return { ...e, status: 'available' as EquipmentStatus, currentClient: undefined, returnDate: undefined };
      }
      return e;
    });
    if (eqChanged) {
      saveEquipment(updatedEq);
      setEquipmentList(updatedEq);
    }
  }, [today]);

  // Менеджеры для фильтра (динамически из базы пользователей)
  const managersList = useMemo(() => loadUsers().filter(u => u.status === 'Активен'), []);

  // Toast-уведомление
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const [scale, setScale] = useState<Scale>('week');
  const [baseDate, setBaseDate] = useState(today);
  const [selectedRental, setSelectedRental] = useState<GanttRentalData | null>(null);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showDowntimeModal, setShowDowntimeModal] = useState(false);
  const [showNewRentalModal, setShowNewRentalModal] = useState(false);
  const [preselectedEquipment, setPreselectedEquipment] = useState('');
  const [returnRental, setReturnRental] = useState<GanttRentalData | null>(null);

  // Filters
  const [filterModel, setFilterModel] = useState('');
  const [filterManager, setFilterManager] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterUpd, setFilterUpd] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filtersApplied, setFiltersApplied] = useState(false);

  // Refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ===== Computed =====
  const { viewStart, viewEnd, totalDays } = useMemo(
    () => getVisibleRange(baseDate, scale),
    [baseDate, scale]
  );
  const dayWidth = SCALE_CONFIG[scale].dayWidth;
  const timelineWidth = totalDays * dayWidth;

  // Generate day columns
  const days = useMemo(() => {
    const result: Date[] = [];
    for (let i = 0; i < totalDays; i++) {
      result.push(addDays(viewStart, i));
    }
    return result;
  }, [viewStart, totalDays]);

  // Group days by month for header
  const monthGroups = useMemo(() => {
    const groups: { month: string; startIdx: number; count: number }[] = [];
    days.forEach((day, idx) => {
      const monthLabel = format(day, 'LLLL yyyy', { locale: ru });
      const last = groups[groups.length - 1];
      if (last && last.month === monthLabel) {
        last.count++;
      } else {
        groups.push({ month: monthLabel, startIdx: idx, count: 1 });
      }
    });
    return groups;
  }, [days]);

  // Filter equipment
  const filteredEquipment = useMemo(() => {
    let eq = [...equipmentList];
    if (filtersApplied && filterModel) {
      eq = eq.filter(e => e.model.toLowerCase().includes(filterModel.toLowerCase()) || e.inventoryNumber.toLowerCase().includes(filterModel.toLowerCase()));
    }
    return eq;
  }, [equipmentList, filterModel, filtersApplied]);

  // Filter rentals
  const filteredRentals = useMemo(() => {
    let rentals = [...ganttRentals];
    if (filtersApplied) {
      if (filterManager) rentals = rentals.filter(r => r.manager === filterManager);
      if (filterClient) rentals = rentals.filter(r => r.client.toLowerCase().includes(filterClient.toLowerCase()));
      if (filterUpd === 'yes') rentals = rentals.filter(r => r.updSigned);
      if (filterUpd === 'no') rentals = rentals.filter(r => !r.updSigned);
      if (filterPayment) rentals = rentals.filter(r => r.paymentStatus === filterPayment);
      if (filterStatus) rentals = rentals.filter(r => r.status === filterStatus);
    }
    return rentals;
  }, [ganttRentals, filtersApplied, filterManager, filterClient, filterUpd, filterPayment, filterStatus]);

  // Conflict detection for all equipment
  const conflictSets = useMemo(() => {
    const map = new Map<string, Set<string>>();
    filteredEquipment.forEach(eq => {
      map.set(eq.inventoryNumber, detectConflicts(filteredRentals, eq.inventoryNumber));
    });
    return map;
  }, [filteredEquipment, filteredRentals]);

  // Stats
  const totalEquipment = equipmentList.length;
  const totalRentals = ganttRentals.length;
  const shownEquipment = filteredEquipment.length;
  const shownRentals = filteredRentals.length;

  // ===== Handlers =====
  const navigateTime = useCallback((direction: 'prev' | 'next' | 'today') => {
    if (direction === 'today') {
      setBaseDate(today);
      return;
    }
    const offsets: Record<Scale, number> = { day: 7, week: 14, month: 30 };
    const offset = offsets[scale] * (direction === 'prev' ? -1 : 1);
    setBaseDate(prev => addDays(prev, offset));
  }, [scale, today]);

  const applyFilters = () => setFiltersApplied(true);
  const resetFilters = () => {
    setFilterModel('');
    setFilterManager('');
    setFilterClient('');
    setFilterUpd('');
    setFilterPayment('');
    setFilterStatus('');
    setFiltersApplied(false);
  };

  const handleOpenReturn = (rental?: GanttRentalData) => {
    setReturnRental(rental || null);
    setShowReturnModal(true);
  };

  const handleOpenDowntime = (equipmentInv?: string) => {
    setPreselectedEquipment(equipmentInv || '');
    setShowDowntimeModal(true);
  };

  const handleOpenNewRental = (equipmentInv?: string) => {
    setPreselectedEquipment(equipmentInv || '');
    setShowNewRentalModal(true);
  };

  // ===== New handlers for RentalDrawer =====

  // Add payment: creates a Payment record, updates ganttRental.paymentStatus
  const handleAddPayment = useCallback((rentalId: string, amount: number, paidDate: string, comment: string) => {
    const rental = ganttRentals.find(r => r.id === rentalId);
    if (!rental) return;

    const newPayment: Payment = {
      id: `PAY-${Date.now()}`,
      invoiceNumber: `INV-${rental.id}`,
      rentalId,
      client: rental.client,
      amount: rental.amount,
      paidAmount: amount,
      dueDate: rental.expectedPaymentDate || rental.endDate,
      paidDate,
      status: 'paid',
      comment: comment || undefined,
    };

    const allPayments = [...payments, newPayment];
    setPayments(allPayments);
    savePayments(allPayments);

    // Recalculate paymentStatus for this rental
    const rentalPayments = allPayments.filter(p => p.rentalId === rentalId);
    const totalPaid = rentalPayments.reduce((sum, p) => sum + (p.paidAmount ?? p.amount), 0);
    let newPaymentStatus: GanttRentalData['paymentStatus'] = 'unpaid';
    if (totalPaid >= rental.amount) newPaymentStatus = 'paid';
    else if (totalPaid > 0) newPaymentStatus = 'partial';

    const updatedRentals = ganttRentals.map(r =>
      r.id === rentalId ? { ...r, paymentStatus: newPaymentStatus } : r
    );
    setGanttRentals(updatedRentals);
    saveGanttRentals(updatedRentals);

    // Also update selectedRental to reflect new state
    if (selectedRental?.id === rentalId) {
      setSelectedRental(updatedRentals.find(r => r.id === rentalId) || null);
    }
  }, [ganttRentals, payments, selectedRental]);

  // Extend rental: update endDate, update equipment returnDate
  const handleExtend = useCallback((rental: GanttRentalData, newEndDate: string) => {
    const updatedRentals = ganttRentals.map(r =>
      r.id === rental.id ? { ...r, endDate: newEndDate } : r
    );
    setGanttRentals(updatedRentals);
    saveGanttRentals(updatedRentals);

    // Update returnDate on equipment
    const updatedEq = equipmentList.map(e =>
      e.inventoryNumber === rental.equipmentInv
        ? { ...e, returnDate: newEndDate }
        : e
    );
    setEquipmentList(updatedEq);
    saveEquipment(updatedEq);

    // Refresh drawer
    if (selectedRental?.id === rental.id) {
      setSelectedRental(updatedRentals.find(r => r.id === rental.id) || null);
    }
  }, [ganttRentals, equipmentList, selectedRental]);

  // Early return: set rental endDate to actualReturnDate, status → returned, clear equipment
  const handleEarlyReturn = useCallback((rental: GanttRentalData, actualReturnDate: string) => {
    const updatedRentals = ganttRentals.map(r =>
      r.id === rental.id
        ? { ...r, endDate: actualReturnDate, status: 'returned' as const }
        : r
    );
    setGanttRentals(updatedRentals);
    saveGanttRentals(updatedRentals);

    // Clear currentClient/returnDate from equipment if no other active rentals
    const hasOtherActive = updatedRentals.some(
      r => r.equipmentInv === rental.equipmentInv
        && r.id !== rental.id
        && r.status !== 'returned' && r.status !== 'closed'
    );
    if (!hasOtherActive) {
      const updatedEq = equipmentList.map(e =>
        e.inventoryNumber === rental.equipmentInv
          ? { ...e, status: 'available' as EquipmentStatus, currentClient: undefined, returnDate: undefined }
          : e
      );
      setEquipmentList(updatedEq);
      saveEquipment(updatedEq);
    }

    setSelectedRental(null);
  }, [ganttRentals, equipmentList]);

  // ===== Today line position =====
  const todayOffset = useMemo(() => {
    const diff = differenceInDays(today, viewStart);
    if (diff < 0 || diff > totalDays) return null;
    return diff * dayWidth;
  }, [today, viewStart, totalDays, dayWidth]);

  return (
    <div className="flex h-[calc(100vh-56px-64px)] sm:h-[calc(100vh)] flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* ===== Toolbar ===== */}
      <div className="flex flex-wrap items-center gap-3 border-b border-gray-200 bg-white px-5 py-3 dark:border-gray-700 dark:bg-gray-800">
        <h1 className="mr-2 text-xl text-gray-900 dark:text-white">Планировщик аренды</h1>

        {/* Scale Switcher */}
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-700">
          {(['day', 'week', 'month'] as Scale[]).map(s => (
            <button
              key={s}
              onClick={() => setScale(s)}
              className={`px-3 py-1.5 text-xs transition-colors ${
                scale === s
                  ? 'bg-[--color-primary] text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600'
              } ${s === 'day' ? 'rounded-l-lg' : s === 'month' ? 'rounded-r-lg' : ''}`}
            >
              {SCALE_CONFIG[s].label}
            </button>
          ))}
        </div>

        {/* Nav */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => navigateTime('today')}
            className="rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs text-gray-700 transition-colors hover:bg-gray-100 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-700"
          >
            Сегодня
          </button>
          <button onClick={() => navigateTime('prev')} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <button onClick={() => navigateTime('next')} className="rounded-lg p-1.5 text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700">
            <ChevronRight className="h-4 w-4" />
          </button>
          <span className="ml-1 text-xs text-gray-500 dark:text-gray-400">
            {format(viewStart, 'd MMM', { locale: ru })} — {format(addDays(viewStart, totalDays - 1), 'd MMM yyyy', { locale: ru })}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button size="sm" onClick={() => handleOpenNewRental()}>
            <Plus className="h-3.5 w-3.5" />
            Новая аренда
          </Button>
          <Button size="sm" variant="secondary" onClick={() => handleOpenReturn()}>
            <RotateCcw className="h-3.5 w-3.5" />
            Возврат техники
          </Button>
          <Button size="sm" variant="secondary" onClick={() => handleOpenDowntime()}>
            <PauseCircle className="h-3.5 w-3.5" />
            Отметить простой
          </Button>
        </div>
      </div>

      {/* ===== Filters ===== */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-5 py-2 dark:border-gray-700 dark:bg-gray-800">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Модель / INV"
            value={filterModel}
            onChange={e => setFilterModel(e.target.value)}
            className="h-8 w-36 rounded-lg border border-gray-200 bg-gray-50 pl-7 pr-2 text-xs focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <select
          value={filterManager}
          onChange={e => setFilterManager(e.target.value)}
          className="h-8 rounded-lg border border-gray-200 bg-gray-50 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="">Менеджер</option>
          {managersList.map(u => (
            <option key={u.id} value={u.name}>{u.name}</option>
          ))}
        </select>

        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Клиент"
            value={filterClient}
            onChange={e => setFilterClient(e.target.value)}
            className="h-8 w-32 rounded-lg border border-gray-200 bg-gray-50 pl-7 pr-2 text-xs focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
          />
        </div>

        <select
          value={filterUpd}
          onChange={e => setFilterUpd(e.target.value)}
          className="h-8 rounded-lg border border-gray-200 bg-gray-50 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          <option value="">УПД</option>
          <option value="yes">Подписан</option>
          <option value="no">Не подписан</option>
        </select>

        {/* Payment segmented */}
        <div className="flex rounded-lg border border-gray-200 dark:border-gray-600">
          {PAYMENT_STATUS_FILTERS.map(f => (
            <button
              key={f.value}
              onClick={() => setFilterPayment(f.value)}
              className={`px-2 py-1 text-xs transition-colors first:rounded-l-lg last:rounded-r-lg ${
                filterPayment === f.value
                  ? 'bg-[--color-primary] text-white'
                  : 'bg-gray-50 text-gray-600 hover:bg-gray-100 dark:bg-gray-700 dark:text-gray-300'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <select
          value={filterStatus}
          onChange={e => setFilterStatus(e.target.value)}
          className="h-8 rounded-lg border border-gray-200 bg-gray-50 px-2 text-xs focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-700 dark:text-white"
        >
          {RENTAL_STATUS_FILTERS.map(f => (
            <option key={f.value} value={f.value}>{f.label}</option>
          ))}
        </select>

        <Button size="sm" onClick={applyFilters} className="h-8 px-3 text-xs">
          Применить
        </Button>
        <Button size="sm" variant="ghost" onClick={resetFilters} className="h-8 px-3 text-xs">
          Сброс
        </Button>

        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
          Показано {shownEquipment} из {totalEquipment} ед. / {shownRentals} из {totalRentals} аренд
        </span>
      </div>

      {/* ===== Gantt Grid ===== */}
      <div ref={scrollContainerRef} className="flex-1 overflow-auto">
        <div style={{ width: LEFT_PANEL_WIDTH + timelineWidth, minHeight: '100%' }}>
          {/* ===== Timeline Header (sticky top) ===== */}
          <div className="sticky top-0 z-20 flex border-b border-gray-200 bg-white dark:border-gray-700 dark:bg-gray-800">
            {/* Left header */}
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center border-r border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-800"
              style={{ width: LEFT_PANEL_WIDTH }}
            >
              <span className="text-xs text-gray-500 dark:text-gray-400">Техника ({shownEquipment})</span>
            </div>

            {/* Month row + Day row combined */}
            <div className="flex flex-col" style={{ width: timelineWidth }}>
              {/* Month row */}
              <div className="flex border-b border-gray-100 dark:border-gray-700">
                {monthGroups.map((mg, idx) => (
                  <div
                    key={idx}
                    className="border-r border-gray-100 px-2 py-1 text-xs capitalize text-gray-500 dark:border-gray-700 dark:text-gray-400"
                    style={{ width: mg.count * dayWidth }}
                  >
                    {mg.month}
                  </div>
                ))}
              </div>
              {/* Day row */}
              <div className="relative flex">
                {days.map((day, idx) => {
                  const isToday = isSameDay(day, today);
                  const weekend = isWeekend(day);
                  return (
                    <div
                      key={idx}
                      className={`flex shrink-0 flex-col items-center justify-center border-r border-gray-100 py-1 dark:border-gray-700 ${
                        isToday ? 'bg-blue-50 dark:bg-blue-900/20' : weekend ? 'bg-gray-50/80 dark:bg-gray-800/50' : ''
                      }`}
                      style={{ width: dayWidth }}
                    >
                      {scale !== 'month' ? (
                        <>
                          <span className={`text-[10px] ${isToday ? 'text-blue-600 dark:text-blue-400' : 'text-gray-400'}`}>
                            {format(day, 'EEEEEE', { locale: ru })}
                          </span>
                          <span className={`text-xs ${isToday ? 'text-blue-700 dark:text-blue-300' : 'text-gray-600 dark:text-gray-400'}`}>
                            {format(day, 'd')}
                          </span>
                        </>
                      ) : (
                        <span className={`text-[9px] ${isToday ? 'text-blue-700 dark:text-blue-300' : 'text-gray-500'}`}>
                          {format(day, 'd')}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* ===== Equipment Rows ===== */}
          {filteredEquipment.length === 0 ? (
            equipmentList.length === 0 ? (
              /* Техники нет вообще — приглашаем добавить */
              <div className="flex flex-col items-center justify-center py-20 text-center">
                <div className="mb-1 text-2xl">🏗️</div>
                <div className="text-sm font-medium text-gray-600 dark:text-gray-300">
                  В реестре нет техники
                </div>
                <div className="mt-1 max-w-xs text-xs text-gray-400 dark:text-gray-500">
                  Добавьте технику в разделе «Техника», и она появится здесь для планирования аренды.
                </div>
                <Button
                  size="sm"
                  className="mt-4"
                  onClick={() => window.location.href = '/rental-management/equipment/new'}
                >
                  + Добавить технику
                </Button>
              </div>
            ) : (
              /* Техника есть, но фильтр дал пустой результат */
              <div className="flex flex-col items-center justify-center py-20">
                <div className="text-gray-400 dark:text-gray-500">Нет техники по заданным фильтрам</div>
                <Button size="sm" variant="ghost" onClick={resetFilters} className="mt-2">
                  Сбросить фильтры
                </Button>
              </div>
            )
          ) : (
            filteredEquipment.map(eq => (
              <EquipmentRow
                key={eq.id}
                equipment={eq}
                rentals={filteredRentals.filter(r => r.equipmentInv === eq.inventoryNumber)}
                downtimes={mockDowntimes.filter(d => d.equipmentInv === eq.inventoryNumber)}
                servicePeriods={mockServicePeriods.filter(s => s.equipmentInv === eq.inventoryNumber)}
                conflictIds={conflictSets.get(eq.inventoryNumber) || new Set()}
                viewStart={viewStart}
                totalDays={totalDays}
                dayWidth={dayWidth}
                todayOffset={todayOffset}
                scale={scale}
                days={days}
                today={today}
                onBarClick={setSelectedRental}
                onNewRental={() => handleOpenNewRental(eq.inventoryNumber)}
                onReturn={(rental) => handleOpenReturn(rental)}
                onDowntime={() => handleOpenDowntime(eq.inventoryNumber)}
              />
            ))
          )}
        </div>
      </div>

      {/* ===== Drawer ===== */}
      {selectedRental && (
        <RentalDrawer
          rental={selectedRental}
          equipment={equipmentList.find(e => e.inventoryNumber === selectedRental.equipmentInv)}
          allRentals={ganttRentals}
          payments={payments}
          onClose={() => setSelectedRental(null)}
          onAddPayment={handleAddPayment}
          onExtend={handleExtend}
          onEarlyReturn={handleEarlyReturn}
          onReturn={(r) => {
            setSelectedRental(null);
            handleOpenReturn(r);
          }}
          onStatusChange={(rental) => {
            // created → active, returned → closed
            let nextStatus: GanttRentalData['status'] | null = null;
            if (rental.status === 'created') nextStatus = 'active';
            else if (rental.status === 'returned') nextStatus = 'closed';

            if (nextStatus) {
              const updated = ganttRentals.map(r =>
                r.id === rental.id ? { ...r, status: nextStatus! } : r,
              );
              setGanttRentals(updated);
              saveGanttRentals(updated);

              // При активации аренды — техника "В аренде" + заполняем клиента и дату возврата
              if (nextStatus === 'active') {
                const newEqList = equipmentList.map(e =>
                  e.inventoryNumber === rental.equipmentInv
                    ? { ...e, status: 'rented' as EquipmentStatus, currentClient: rental.client, returnDate: rental.endDate }
                    : e,
                );
                setEquipmentList(newEqList);
                saveEquipment(newEqList);
              }
              // При закрытии — если нет других активных аренд, техника "Свободна" + очищаем клиента и дату
              if (nextStatus === 'closed') {
                const hasOtherActive = ganttRentals.some(
                  r => r.equipmentInv === rental.equipmentInv
                    && r.status !== 'returned' && r.status !== 'closed'
                    && r.id !== rental.id,
                );
                if (!hasOtherActive) {
                  const newEqList = equipmentList.map(e =>
                    e.inventoryNumber === rental.equipmentInv
                      ? { ...e, status: 'available' as EquipmentStatus, currentClient: undefined, returnDate: undefined }
                      : e,
                  );
                  setEquipmentList(newEqList);
                  saveEquipment(newEqList);
                }
              }
            }
            setSelectedRental(null);
          }}
          onDelete={(rental) => {
            const updated = ganttRentals.filter(r => r.id !== rental.id);
            setGanttRentals(updated);
            saveGanttRentals(updated);
            // Если после удаления нет других активных аренд — техника снова свободна, очищаем клиента и дату
            const hasOtherActive = updated.some(
              r => r.equipmentInv === rental.equipmentInv
                && r.status !== 'returned' && r.status !== 'closed',
            );
            if (!hasOtherActive) {
              const newEqList = equipmentList.map(e =>
                e.inventoryNumber === rental.equipmentInv
                  ? { ...e, status: 'available' as EquipmentStatus, currentClient: undefined, returnDate: undefined }
                  : e,
              );
              setEquipmentList(newEqList);
              saveEquipment(newEqList);
            }
            setSelectedRental(null);
          }}
        />
      )}

      {/* ===== Modals ===== */}
      <ReturnModal
        open={showReturnModal}
        rental={returnRental}
        ganttRentals={ganttRentals}
        onClose={() => { setShowReturnModal(false); setReturnRental(null); }}
        onConfirm={(data) => {
          // Обновляем статус аренды на 'returned'
          const updated = ganttRentals.map(r =>
            r.id === data.rentalId ? { ...r, status: 'returned' as const } : r,
          );
          setGanttRentals(updated);
          saveGanttRentals(updated);

          // Обновляем статус техники, если нет других активных аренд
          const rental = ganttRentals.find(r => r.id === data.rentalId);
          if (rental) {
            const hasOtherActive = updated.some(
              r => r.equipmentInv === rental.equipmentInv
                && r.status !== 'returned' && r.status !== 'closed'
                && r.id !== data.rentalId,
            );
            if (!hasOtherActive) {
              const newStatus: EquipmentStatus = data.result === 'service' ? 'in_service' : 'available';
              const newEqList = equipmentList.map(e =>
                e.inventoryNumber === rental.equipmentInv
                  ? { ...e, status: newStatus, currentClient: undefined, returnDate: undefined }
                  : e,
              );
              setEquipmentList(newEqList);
              saveEquipment(newEqList);
            }
          }
          showToast(`Возврат оформлен: ${rental?.equipmentInv ?? data.rentalId}`);
          setShowReturnModal(false);
          setReturnRental(null);
        }}
      />
      <DowntimeModal
        open={showDowntimeModal}
        preselectedEquipment={preselectedEquipment}
        onClose={() => setShowDowntimeModal(false)}
        onConfirm={(data) => {
          console.log('Downtime created:', data);
          setShowDowntimeModal(false);
        }}
      />
      <NewRentalModal
        open={showNewRentalModal}
        preselectedEquipment={preselectedEquipment}
        ganttRentals={ganttRentals}
        equipmentList={equipmentList}
        onClose={() => setShowNewRentalModal(false)}
        onConfirm={(data) => {
          // Если аренда начинается сегодня или в прошлом — сразу 'active',
          // иначе 'created' (будущая аренда / бронь)
          const todayStr = format(today, 'yyyy-MM-dd');
          const initialStatus: GanttRentalData['status'] =
            (data.startDate || '') <= todayStr ? 'active' : 'created';

          const newRental: GanttRentalData = {
            id: `GR-${Date.now()}`,
            client: data.client || '',
            clientShort: (data.client || '').substring(0, 20),
            equipmentInv: data.equipmentInv || '',
            startDate: data.startDate || '',
            endDate: data.endDate || '',
            manager: data.manager || '',
            managerInitials: (data.manager || '').split(' ').map((w: string) => w[0]).join('').toUpperCase(),
            status: initialStatus,
            paymentStatus: 'unpaid',
            updSigned: false,
            amount: Number(data.amount) || 0,
            comments: [],
          };
          const updated = [...ganttRentals, newRental];
          setGanttRentals(updated);
          saveGanttRentals(updated);

          // Синхронизируем статус техники + клиента и дату возврата на основе initialStatus аренды
          if (data.equipmentInv) {
            const eqStatus: EquipmentStatus = initialStatus === 'active' ? 'rented' : 'reserved';
            const newEqList = equipmentList.map(e => {
              if (e.inventoryNumber !== data.equipmentInv) return e;
              return {
                ...e,
                status: eqStatus,
                currentClient: initialStatus === 'active' ? newRental.client : e.currentClient,
                returnDate: initialStatus === 'active' ? newRental.endDate : e.returnDate,
              };
            });
            setEquipmentList(newEqList);
            saveEquipment(newEqList);
          }
          showToast(`Аренда создана: ${newRental.id} — ${data.client} (${data.equipmentInv})`);
          setShowNewRentalModal(false);
        }}
      />
      {/* ===== Toast notification ===== */}
      {toast && (
        <div className={`fixed bottom-6 left-1/2 z-[100] -translate-x-1/2 transform rounded-xl px-5 py-3 shadow-lg text-sm font-medium text-white transition-all ${
          toast.type === 'success' ? 'bg-green-600' : 'bg-red-600'
        }`}>
          {toast.message}
        </div>
      )}
    </div>
  );
}

// ========== Equipment Row Component ==========
interface EquipmentRowProps {
  equipment: Equipment;
  rentals: GanttRentalData[];
  downtimes: DowntimePeriod[];
  servicePeriods: ServicePeriod[];
  conflictIds: Set<string>;
  viewStart: Date;
  totalDays: number;
  dayWidth: number;
  todayOffset: number | null;
  scale: Scale;
  days: Date[];
  today: Date;
  onBarClick: (rental: GanttRentalData) => void;
  onNewRental: () => void;
  onReturn: (rental: GanttRentalData) => void;
  onDowntime: () => void;
}

function EquipmentRow({
  equipment, rentals, downtimes, servicePeriods, conflictIds,
  viewStart, totalDays, dayWidth, todayOffset, scale, days, today,
  onBarClick, onNewRental, onReturn, onDowntime
}: EquipmentRowProps) {
  // Статус вычисляется динамически из аренд, а не из equipment.status
  const effectiveStatus = computeEffectiveStatus(equipment, rentals, today);
  const eqStatus = EQ_STATUS_LABELS[effectiveStatus] || EQ_STATUS_LABELS.available;
  const hasActiveRental = rentals.some(r => r.status === 'active');
  const timelineWidth = totalDays * dayWidth;

  return (
    <div className="group flex border-b border-gray-100 dark:border-gray-800" style={{ minHeight: ROW_HEIGHT }}>
      {/* Left panel */}
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center border-r border-gray-200 bg-white px-3 dark:border-gray-700 dark:bg-gray-800"
        style={{ width: LEFT_PANEL_WIDTH }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="font-mono text-xs text-gray-500 dark:text-gray-400">{equipment.inventoryNumber}</span>
            <span className="truncate text-sm text-gray-900 dark:text-white">{equipment.model}</span>
          </div>
          <div className="mt-0.5 flex items-center gap-2 text-[10px] text-gray-400 dark:text-gray-500">
            <span>{TYPE_LABELS[equipment.type]}</span>
            <span>·</span>
            <span className="truncate">{equipment.location}</span>
          </div>
          <div className="mt-1 flex items-center gap-1.5">
            <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] ${eqStatus.color}`}>
              {eqStatus.label}
            </span>
          </div>
        </div>
        {/* Quick actions */}
        <div className="ml-1 flex shrink-0 flex-col gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          <button
            onClick={onNewRental}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
            title="Создать аренду"
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
          {hasActiveRental && (
            <button
              onClick={() => {
                const active = rentals.find(r => r.status === 'active');
                if (active) onReturn(active);
              }}
              className="rounded p-1 text-gray-400 transition-colors hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30 dark:hover:text-green-400"
              title="Возврат техники"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
          )}
          <button
            onClick={onDowntime}
            className="rounded p-1 text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/30 dark:hover:text-amber-400"
            title="Отметить простой"
          >
            <PauseCircle className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {/* Timeline area */}
      <div className="relative" style={{ width: timelineWidth, height: ROW_HEIGHT }}>
        {/* Day grid lines */}
        {days.map((day, idx) => {
          const weekend = isWeekend(day);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={idx}
              className={`absolute top-0 h-full border-r border-gray-200/60 dark:border-gray-700/50 ${
                weekend ? 'bg-gray-100/60 dark:bg-gray-800/40' : ''
              } ${isToday ? 'bg-blue-50/70 dark:bg-blue-900/20' : ''}`}
              style={{ left: idx * dayWidth, width: dayWidth }}
            />
          );
        })}

        {/* Empty row placeholder */}
        {rentals.length === 0 && downtimes.length === 0 && servicePeriods.length === 0 && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-[11px] text-gray-300 dark:text-gray-600 italic">
              нет аренд
            </span>
          </div>
        )}

        {/* Today line */}
        {todayOffset !== null && (
          <div
            className="absolute top-0 z-10 h-full w-0.5 bg-red-500 dark:bg-red-400"
            style={{ left: todayOffset }}
          >
            <div className="absolute -left-1 -top-0.5 h-2.5 w-2.5 rounded-full bg-red-500 dark:bg-red-400 ring-2 ring-red-200 dark:ring-red-800" />
          </div>
        )}

        {/* Service bars */}
        {servicePeriods.map(sp => {
          const pos = barPosition(new Date(sp.startDate), new Date(sp.endDate), viewStart, totalDays, dayWidth);
          if (!pos) return null;
          return (
            <div
              key={sp.id}
              className="absolute z-[5] flex items-center rounded px-1.5 text-[10px] text-orange-700 dark:text-orange-300"
              style={{
                left: pos.left,
                width: pos.width,
                top: 4,
                height: ROW_HEIGHT - 8,
                background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(234,88,12,0.15) 4px, rgba(234,88,12,0.15) 8px)',
                border: '1px solid rgba(234,88,12,0.4)',
              }}
              title={`Сервис: ${sp.description}`}
            >
              <Wrench className="mr-1 h-3 w-3 shrink-0" />
              {pos.width > 60 && <span className="truncate">{sp.description}</span>}
            </div>
          );
        })}

        {/* Downtime bars */}
        {downtimes.map(dt => {
          const pos = barPosition(new Date(dt.startDate), new Date(dt.endDate), viewStart, totalDays, dayWidth);
          if (!pos) return null;
          return (
            <div
              key={dt.id}
              className="absolute z-[5] flex items-center rounded px-1.5 text-[10px] text-amber-700 dark:text-amber-300"
              style={{
                left: pos.left,
                width: pos.width,
                top: 4,
                height: ROW_HEIGHT - 8,
                background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(217,175,37,0.15) 4px, rgba(217,175,37,0.15) 8px)',
                border: '1px dashed rgba(217,175,37,0.6)',
              }}
              title={`Простой: ${dt.reason}`}
            >
              <PauseCircle className="mr-1 h-3 w-3 shrink-0" />
              {pos.width > 70 && <span className="truncate">Простой{dt.reason ? `: ${dt.reason}` : ''}</span>}
            </div>
          );
        })}

        {/* Rental bars */}
        {rentals.map((rental, rIdx) => {
          const pos = barPosition(new Date(rental.startDate), new Date(rental.endDate), viewStart, totalDays, dayWidth);
          if (!pos) return null;
          const isConflict = conflictIds.has(rental.id);
          const barColor = RENTAL_BAR_COLORS[rental.status];
          const statusLabel = RENTAL_STATUS_LABEL[rental.status];

          // Stack bars vertically if there are overlaps (simple: use index-based offset)
          const overlapping = rentals.filter((r2, j) => {
            if (j >= rIdx) return false;
            const s1 = new Date(rental.startDate), e1 = new Date(rental.endDate);
            const s2 = new Date(r2.startDate), e2 = new Date(r2.endDate);
            return s1 < e2 && s2 < e1;
          });
          const stackIndex = overlapping.length;
          const barHeight = 34;
          const topOffset = 4 + stackIndex * (barHeight + 3);

          return (
            <div
              key={rental.id}
              onClick={() => onBarClick(rental)}
              className={`absolute z-[6] flex cursor-pointer items-center rounded-md shadow transition-all hover:shadow-lg hover:brightness-110 ${barColor} ${
                isConflict ? 'ring-2 ring-red-500 ring-offset-1 dark:ring-red-400' : ''
              }`}
              style={{
                left: pos.left + 1,
                width: pos.width - 2,
                top: topOffset,
                height: barHeight,
              }}
              title={`${rental.client} · ${rental.startDate} — ${rental.endDate} (${statusLabel})`}
            >
              {/* Bar content — two rows for better readability */}
              <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden px-2 leading-tight">
                <div className="flex items-center gap-1">
                  {isConflict && (
                    <AlertTriangle className="h-3 w-3 shrink-0 text-red-200" />
                  )}
                  {pos.width > 40 && (
                    <span className="truncate text-[11px] font-medium text-white">
                      {rental.clientShort || rental.client}
                    </span>
                  )}
                </div>
                {pos.width > 80 && (
                  <div className="flex items-center gap-1 text-[9px] text-white/70">
                    <span>{statusLabel}</span>
                    {pos.width > 140 && (
                      <span>· {rental.startDate.slice(5)} → {rental.endDate.slice(5)}</span>
                    )}
                    {pos.width > 200 && rental.managerInitials && (
                      <span>· {rental.managerInitials}</span>
                    )}
                  </div>
                )}
              </div>
              {/* Right icons */}
              <div className="mr-1.5 flex shrink-0 items-center gap-0.5">
                {pos.width > 70 && (
                  <>
                    {rental.updSigned ? (
                      <CircleCheck className="h-3.5 w-3.5 text-green-300" title="УПД подписан" />
                    ) : (
                      <CircleAlert className="h-3.5 w-3.5 text-red-300" title="УПД не подписан" />
                    )}
                    {rental.paymentStatus === 'paid' ? (
                      <CreditCard className="h-3.5 w-3.5 text-green-300" title="Оплачено" />
                    ) : rental.paymentStatus === 'partial' ? (
                      <CreditCard className="h-3.5 w-3.5 text-yellow-300" title="Частично оплачено" />
                    ) : (
                      <CreditCard className="h-3.5 w-3.5 text-red-300" title="Не оплачено" />
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}