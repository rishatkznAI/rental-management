import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
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
  EQUIPMENT_STORAGE_KEY,
  GANTT_RENTALS_STORAGE_KEY,
  PAYMENTS_STORAGE_KEY,
} from '../mock-data';
import type { SystemUser } from '../lib/userStorage';
import { usePermissions } from '../lib/permissions';
import type { GanttRentalData, DowntimePeriod, ServicePeriod } from '../mock-data';
import type { Equipment, EquipmentType, EquipmentStatus, Payment, ServiceTicket, ServiceStatus } from '../types';
import { equipmentService } from '../services/equipment.service';
import { rentalsService } from '../services/rentals.service';
import { paymentsService } from '../services/payments.service';
import { serviceTicketsService } from '../services/service-tickets.service';
import { usersService } from '../services/users.service';
import { EQUIPMENT_KEYS } from '../hooks/useEquipment';
import { PAYMENT_KEYS } from '../hooks/usePayments';
import { RENTAL_KEYS } from '../hooks/useRentals';
import { SERVICE_TICKET_KEYS } from '../hooks/useServiceTickets';
import { canEquipmentParticipateInRentals, compareEquipmentByPriority, EQUIPMENT_PRIORITY_LABELS } from '../lib/equipmentClassification';
import {
  addDays, addMonths, addYears, differenceInDays, endOfMonth, endOfQuarter,
  endOfYear, format, isSameDay, isWeekend, max as dateMax, min as dateMin,
  startOfDay, startOfMonth, startOfQuarter, startOfWeek, startOfYear
} from 'date-fns';
import { ru } from 'date-fns/locale';

// ========== Constants & Types ==========
type Scale = 'week' | 'month' | 'quarter' | 'year' | 'custom';

const SCALE_CONFIG: Record<Scale, { dayWidth: number; label: string }> = {
  week: { dayWidth: 120, label: 'Неделя' },
  month: { dayWidth: 40, label: 'Месяц' },
  quarter: { dayWidth: 16, label: 'Квартал' },
  year: { dayWidth: 6, label: 'Год' },
  custom: { dayWidth: 28, label: 'Период' },
};

const LEFT_PANEL_WIDTH = 212;
const ROW_HEIGHT = 44;

const TYPE_LABELS: Record<EquipmentType, string> = {
  scissor: 'Ножничный',
  articulated: 'Коленчатый',
  telescopic: 'Телескопический',
};

const PRIORITY_STYLES = {
  critical: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300',
  high: 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300',
  medium: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300',
  low: 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
} as const;

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

function getPlannerSortHeight(equipment: Equipment) {
  return equipment.workingHeight ?? equipment.liftHeight ?? 0;
}

function compareEquipmentForPlanner(a: Equipment, b: Equipment) {
  const byHeight = getPlannerSortHeight(a) - getPlannerSortHeight(b);
  if (byHeight !== 0) return byHeight;
  return compareEquipmentByPriority(a, b);
}

// ========== Helpers ==========
function getVisibleRange(baseDate: Date, scale: Scale, customRange?: { start: Date; end: Date }) {
  if (scale === 'custom' && customRange) {
    const viewStart = startOfDay(customRange.start);
    const normalizedEnd = startOfDay(customRange.end);
    const viewEnd = addDays(normalizedEnd, 1);
    return { viewStart, viewEnd, totalDays: Math.max(differenceInDays(viewEnd, viewStart), 1) };
  }

  if (scale === 'week') {
    const viewStart = startOfWeek(baseDate, { weekStartsOn: 1 });
    const viewEnd = addDays(viewStart, 7);
    return { viewStart, viewEnd, totalDays: 7 };
  }

  if (scale === 'month') {
    const viewStart = startOfMonth(baseDate);
    const viewEnd = addDays(endOfMonth(baseDate), 1);
    return { viewStart, viewEnd, totalDays: differenceInDays(viewEnd, viewStart) };
  }

  if (scale === 'quarter') {
    const viewStart = startOfQuarter(baseDate);
    const viewEnd = addDays(endOfQuarter(baseDate), 1);
    return { viewStart, viewEnd, totalDays: differenceInDays(viewEnd, viewStart) };
  }

  const viewStart = startOfYear(baseDate);
  const viewEnd = addDays(endOfYear(baseDate), 1);
  return { viewStart, viewEnd, totalDays: differenceInDays(viewEnd, viewStart) };
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

function detectConflicts(rentals: GanttRentalData[]): Set<string> {
  const eqRentals = rentals.filter(r => r.status !== 'returned' && r.status !== 'closed');
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

function rentalIntersectsRange(
  rental: Pick<GanttRentalData, 'startDate' | 'endDate'>,
  rangeStart: Date,
  rangeEnd: Date,
) {
  const rentalStart = startOfDay(new Date(rental.startDate));
  const rentalEndExclusive = addDays(startOfDay(new Date(rental.endDate)), 1);
  return rentalStart < rangeEnd && rentalEndExclusive > rangeStart;
}

function rentalMatchesEquipment(
  rental: Pick<GanttRentalData, 'equipmentId' | 'equipmentInv'>,
  equipment: Pick<Equipment, 'id' | 'inventoryNumber'>,
) {
  return rental.equipmentId
    ? rental.equipmentId === equipment.id
    : rental.equipmentInv === equipment.inventoryNumber;
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
  visibleRange?: { start: Date; end: Date },
): EquipmentStatus {
  // Ручные статусы переопределяют всё
  if (equipment.status === 'inactive' || equipment.status === 'in_service') {
    return equipment.status;
  }
  const visibleRentals = visibleRange
    ? rentals.filter(r => rentalIntersectsRange(r, visibleRange.start, visibleRange.end))
    : [];
  if (visibleRentals.length > 0) {
    const hasVisibleOccupiedRental = visibleRentals.some(r => r.status !== 'created');
    return hasVisibleOccupiedRental ? 'rented' : 'reserved';
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

const OPEN_SERVICE_STATUSES: ServiceStatus[] = ['new', 'in_progress', 'waiting_parts', 'ready'];

function hasOpenServiceTicketForEquipment(serviceTickets: ServiceTicket[], equipment: Equipment) {
  const inventoryIsUnique = serviceTickets.filter(ticket => ticket.inventoryNumber === equipment.inventoryNumber).length <= 1;
  return serviceTickets.some(ticket =>
    OPEN_SERVICE_STATUSES.includes(ticket.status)
    && (
      ticket.equipmentId === equipment.id
      || (!!ticket.serialNumber && !!equipment.serialNumber && ticket.serialNumber === equipment.serialNumber)
      || (!!ticket.inventoryNumber && inventoryIsUnique && ticket.inventoryNumber === equipment.inventoryNumber)
    ),
  );
}

// ========== Main Component ==========
export default function Rentals() {
  const { can } = usePermissions();
  const queryClient = useQueryClient();
  const canEditRentals = can('edit', 'rentals');
  const canDeleteRentals = can('delete', 'rentals');
  const canCreatePayments = can('create', 'payments');
  const today = useMemo(() => startOfDay(new Date()), []);
  const [ganttRentals, setGanttRentals] = useState<GanttRentalData[]>([]);
  const [equipmentList, setEquipmentList] = useState<Equipment[]>([]);
  const [payments, setPayments] = useState<Payment[]>([]);

  const { data: ganttData = [] } = useQuery({
    queryKey: RENTAL_KEYS.gantt,
    queryFn: rentalsService.getGanttData,
  });
  const { data: equipmentData = [] } = useQuery({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
  });
  const { data: paymentData = [] } = useQuery({
    queryKey: PAYMENT_KEYS.all,
    queryFn: paymentsService.getAll,
  });
  const { data: serviceTickets = [] } = useQuery<ServiceTicket[]>({
    queryKey: SERVICE_TICKET_KEYS.all,
    queryFn: serviceTicketsService.getAll,
  });
  const { data: usersData = [] } = useQuery<SystemUser[]>({
    queryKey: ['users'],
    queryFn: usersService.getAll,
  });

  useEffect(() => {
    setGanttRentals(ganttData);
  }, [ganttData]);

  useEffect(() => {
    setEquipmentList(equipmentData);
  }, [equipmentData]);

  useEffect(() => {
    setPayments(paymentData);
  }, [paymentData]);

  // Менеджеры для фильтра (динамически из базы пользователей)
  const managersList = useMemo(() => usersData.filter(u => u.status === 'Активен'), [usersData]);

  // Toast-уведомление
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const persistGanttRentals = useCallback(async (list: GanttRentalData[]) => {
    setGanttRentals(list);
    localStorage.setItem(GANTT_RENTALS_STORAGE_KEY, JSON.stringify(list));
    try {
      await rentalsService.bulkReplaceGantt(list);
      await queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt });
    } catch {
      showToast('Не удалось сохранить аренды', 'error');
    }
  }, [queryClient, showToast]);

  const persistEquipment = useCallback(async (list: Equipment[]) => {
    setEquipmentList(list);
    localStorage.setItem(EQUIPMENT_STORAGE_KEY, JSON.stringify(list));
    try {
      await equipmentService.bulkReplace(list);
      await queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all });
    } catch {
      showToast('Не удалось сохранить технику', 'error');
    }
  }, [queryClient, showToast]);

  const persistPayments = useCallback(async (list: Payment[]) => {
    setPayments(list);
    localStorage.setItem(PAYMENTS_STORAGE_KEY, JSON.stringify(list));
    try {
      await paymentsService.bulkReplace(list);
      await queryClient.invalidateQueries({ queryKey: PAYMENT_KEYS.all });
    } catch {
      showToast('Не удалось сохранить платежи', 'error');
    }
  }, [queryClient, showToast]);

  // Очистка «призрачных» аренд при загрузке страницы:
  // - 'created' с прошедшей endDate → 'closed'  (не активированные черновики)
  // - 'active'  с прошедшей endDate → 'returned' (техника вернулась, но возврат не оформили вручную)
  React.useEffect(() => {
    const todayStr = format(today, 'yyyy-MM-dd');
    const current = ganttRentals;

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
    void persistGanttRentals(cleaned);

    // Для закрытых/возвращённых аренд: если у техники больше нет активных аренд —
    // обновляем статус техники на 'available'.
    const eqList = equipmentList;
    const affectedEquipment = eqList.filter(e =>
      current.some(r =>
        (r.status === 'created' || r.status === 'active')
        && r.endDate < todayStr
        && matchesEquipmentRow(r, e),
      ),
    );
    let eqChanged = false;
    const updatedEq = eqList.map(e => {
      if (!affectedEquipment.some(item => item.id === e.id)) return e;
      const stillActive = cleaned.some(
        r => matchesEquipmentRow(r, e)
          && r.status !== 'returned'
          && r.status !== 'closed',
      );
      if (!stillActive && e.status !== 'inactive' && e.status !== 'in_service') {
        eqChanged = true;
        return {
          ...e,
          status: hasOpenServiceTicketForEquipment(serviceTickets, e) ? 'in_service' as EquipmentStatus : 'available' as EquipmentStatus,
          currentClient: undefined,
          returnDate: undefined,
        };
      }
      return e;
    });
    if (eqChanged) {
      void persistEquipment(updatedEq);
    }
  }, [today, ganttRentals, equipmentList, persistEquipment, persistGanttRentals, serviceTickets]);

  const [scale, setScale] = useState<Scale>('week');
  const [baseDate, setBaseDate] = useState(today);
  const [customRangeStart, setCustomRangeStart] = useState(format(today, 'yyyy-MM-dd'));
  const [customRangeEnd, setCustomRangeEnd] = useState(format(addDays(today, 29), 'yyyy-MM-dd'));
  const [selectedRental, setSelectedRental] = useState<GanttRentalData | null>(null);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showDowntimeModal, setShowDowntimeModal] = useState(false);
  const [showNewRentalModal, setShowNewRentalModal] = useState(false);
  const [preselectedEquipmentInv, setPreselectedEquipmentInv] = useState('');
  const [preselectedEquipmentId, setPreselectedEquipmentId] = useState('');
  const [returnRental, setReturnRental] = useState<GanttRentalData | null>(null);

  // Filters (always live — no explicit "apply" gate needed)
  const [filterModel, setFilterModel] = useState('');
  const [filterManager, setFilterManager] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterUpd, setFilterUpd] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [filterStatus, setFilterStatus] = useState('');

  // Derived: any filter is currently active
  const hasActiveFilters = !!(filterModel || filterManager || filterClient || filterUpd || filterPayment || filterStatus);

  // Refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  // ===== Computed =====
  const customRange = useMemo(() => {
    const parsedStart = startOfDay(new Date(customRangeStart));
    const parsedEnd = startOfDay(new Date(customRangeEnd));
    if (Number.isNaN(parsedStart.getTime()) || Number.isNaN(parsedEnd.getTime())) return null;
    const start = parsedStart <= parsedEnd ? parsedStart : parsedEnd;
    const end = parsedStart <= parsedEnd ? parsedEnd : parsedStart;
    return { start, end };
  }, [customRangeStart, customRangeEnd]);

  const { viewStart, viewEnd, totalDays } = useMemo(
    () => getVisibleRange(baseDate, scale, customRange ?? undefined),
    [baseDate, scale, customRange]
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

  const servicePeriods = useMemo<ServicePeriod[]>(() => {
    return serviceTickets
      .filter(ticket => OPEN_SERVICE_STATUSES.includes(ticket.status))
      .map(ticket => ({
        id: ticket.id,
        equipmentInv:
          ticket.inventoryNumber
          || equipmentList.find(item => item.id === ticket.equipmentId)?.inventoryNumber
          || '',
        startDate: (ticket.createdAt || new Date().toISOString()).slice(0, 10),
        endDate: ticket.closedAt
          ? ticket.closedAt.slice(0, 10)
          : addDays(today, 1).toISOString().slice(0, 10),
        description: ticket.reason || 'Ремонт',
      }))
      .filter(period => !!period.equipmentInv);
  }, [equipmentList, serviceTickets, today]);

  // ── Filter rentals (always live, no gate) ────────────────────────────────────
  const filteredRentals = useMemo(() => {
    let rentals = [...ganttRentals];
    if (filterManager) rentals = rentals.filter(r => r.manager === filterManager);
    if (filterClient)  rentals = rentals.filter(r => r.client.toLowerCase().includes(filterClient.toLowerCase()));
    if (filterUpd === 'yes') rentals = rentals.filter(r => r.updSigned);
    if (filterUpd === 'no')  rentals = rentals.filter(r => !r.updSigned);
    if (filterPayment) rentals = rentals.filter(r => r.paymentStatus === filterPayment);
    if (filterStatus)  rentals = rentals.filter(r => r.status === filterStatus);
    return rentals;
  }, [ganttRentals, filterManager, filterClient, filterUpd, filterPayment, filterStatus]);

  const visibleFilteredRentals = useMemo(
    () => filteredRentals.filter(r => rentalIntersectsRange(r, viewStart, viewEnd)),
    [filteredRentals, viewStart, viewEnd],
  );

  const inventoryGroups = useMemo(() => {
    const groups = new Map<string, Equipment[]>();
    equipmentList.forEach(item => {
      const existing = groups.get(item.inventoryNumber) || [];
      existing.push(item);
      groups.set(item.inventoryNumber, existing);
    });
    return groups;
  }, [equipmentList]);

  const ambiguousInventoryNumbers = useMemo(
    () => new Set(
      [...inventoryGroups.entries()]
        .filter(([, items]) => items.length > 1)
        .map(([inventoryNumber]) => inventoryNumber),
    ),
    [inventoryGroups],
  );

  const canonicalEquipmentIdByInventory = useMemo(() => {
    const map = new Map<string, string>();
    inventoryGroups.forEach((items, inventoryNumber) => {
      const canonical = [...items].sort(compareEquipmentByPriority)[0];
      if (canonical) {
        map.set(inventoryNumber, canonical.id);
      }
    });
    return map;
  }, [inventoryGroups]);

  const matchesEquipmentRow = useCallback((rental: GanttRentalData, equipment: Equipment) => {
    if (rental.equipmentId) {
      return rental.equipmentId === equipment.id;
    }
    if (ambiguousInventoryNumbers.has(rental.equipmentInv)) {
      return canonicalEquipmentIdByInventory.get(rental.equipmentInv) === equipment.id;
    }
    return rental.equipmentInv === equipment.inventoryNumber;
  }, [ambiguousInventoryNumbers, canonicalEquipmentIdByInventory]);

  const ambiguousLegacyRentals = useMemo(
    () => ganttRentals.filter(r => !r.equipmentId && ambiguousInventoryNumbers.has(r.equipmentInv)),
    [ganttRentals, ambiguousInventoryNumbers],
  );

  // ── Filter equipment (always live) ───────────────────────────────────────────
  // Step 1: filter by model/INV/SN text
  // Step 2 (cross-link): when rental-level filters are active, only show equipment
  //         that has at least one rental in filteredRentals — hides empty rows.
  const filteredEquipment = useMemo(() => {
    let eq = equipmentList.filter(canEquipmentParticipateInRentals);
    if (filterModel) {
      const q = filterModel.toLowerCase();
      eq = eq.filter(e =>
        e.model.toLowerCase().includes(q) ||
        e.inventoryNumber.toLowerCase().includes(q) ||
        e.serialNumber.toLowerCase().includes(q)
      );
    }
    const hasRentalFilter = !!(filterManager || filterClient || filterUpd || filterPayment || filterStatus);
    if (hasRentalFilter) {
      eq = eq.filter(e => visibleFilteredRentals.some(r => matchesEquipmentRow(r, e)));
    }
    return [...eq].sort(compareEquipmentForPlanner);
  }, [equipmentList, filterModel, visibleFilteredRentals, filterManager, filterClient, filterUpd, filterPayment, filterStatus, matchesEquipmentRow]);

  // Conflict detection for all equipment
  const conflictSets = useMemo(() => {
      const map = new Map<string, Set<string>>();
      filteredEquipment.forEach(eq => {
      map.set(eq.id, detectConflicts(
        filteredRentals.filter(r => matchesEquipmentRow(r, eq)),
      ));
      });
      return map;
  }, [filteredEquipment, filteredRentals, matchesEquipmentRow]);

  // Stats
  const totalEquipment = equipmentList.length;
  const totalRentals = ganttRentals.length;
  const shownEquipment = filteredEquipment.length;
  const shownRentals = filteredRentals.length;

  // ===== Handlers =====
  const navigateTime = useCallback((direction: 'prev' | 'next' | 'today') => {
    if (direction === 'today') {
      setBaseDate(today);
      if (scale === 'custom') {
        const start = format(today, 'yyyy-MM-dd');
        const end = format(addDays(today, 29), 'yyyy-MM-dd');
        setCustomRangeStart(start);
        setCustomRangeEnd(end);
      }
      return;
    }
    const step = direction === 'prev' ? -1 : 1;
    if (scale === 'week') {
      setBaseDate(prev => addDays(prev, step * 7));
      return;
    }
    if (scale === 'month') {
      setBaseDate(prev => addMonths(prev, step));
      return;
    }
    if (scale === 'quarter') {
      setBaseDate(prev => addMonths(prev, step * 3));
      return;
    }
    if (scale === 'year') {
      setBaseDate(prev => addYears(prev, step));
      return;
    }
    const spanDays = customRange ? Math.max(differenceInDays(addDays(customRange.end, 1), customRange.start), 1) : 30;
    const shiftedStart = addDays(customRange?.start ?? today, step * spanDays);
    const shiftedEnd = addDays(customRange?.end ?? addDays(today, spanDays - 1), step * spanDays);
    setCustomRangeStart(format(shiftedStart, 'yyyy-MM-dd'));
    setCustomRangeEnd(format(shiftedEnd, 'yyyy-MM-dd'));
    setBaseDate(shiftedStart);
  }, [customRange, scale, today]);

  const applyCustomRange = useCallback(() => {
    if (!customRange) return;
    setScale('custom');
    setBaseDate(customRange.start);
  }, [customRange]);

  const rangeLabel = useMemo(() => {
    return `${format(viewStart, 'd MMM', { locale: ru })} — ${format(addDays(viewEnd, -1), 'd MMM yyyy', { locale: ru })}`;
  }, [viewEnd, viewStart]);

  const resetFilters = () => {
    setFilterModel('');
    setFilterManager('');
    setFilterClient('');
    setFilterUpd('');
    setFilterPayment('');
    setFilterStatus('');
  };

  const handleOpenReturn = (rental?: GanttRentalData) => {
    if (!canEditRentals) return;
    setReturnRental(rental || null);
    setShowReturnModal(true);
  };

  const handleOpenDowntime = (equipmentInv?: string) => {
    setPreselectedEquipmentInv(equipmentInv || '');
    setShowDowntimeModal(true);
  };

  const handleOpenNewRental = (equipmentId?: string) => {
    setPreselectedEquipmentId(equipmentId || '');
    setShowNewRentalModal(true);
  };

  // ===== New handlers for RentalDrawer =====

  // Add payment: creates a Payment record, updates ganttRental.paymentStatus
  const handleAddPayment = useCallback((rentalId: string, amount: number, paidDate: string, comment: string) => {
    if (!canCreatePayments) return;
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
    void persistPayments(allPayments);

    // Recalculate paymentStatus for this rental
    const rentalPayments = allPayments.filter(p => p.rentalId === rentalId);
    const totalPaid = rentalPayments.reduce((sum, p) => sum + (p.paidAmount ?? p.amount), 0);
    let newPaymentStatus: GanttRentalData['paymentStatus'] = 'unpaid';
    if (totalPaid >= rental.amount) newPaymentStatus = 'paid';
    else if (totalPaid > 0) newPaymentStatus = 'partial';

    const updatedRentals = ganttRentals.map(r =>
      r.id === rentalId ? { ...r, paymentStatus: newPaymentStatus } : r
    );
    void persistGanttRentals(updatedRentals);

    // Also update selectedRental to reflect new state
    if (selectedRental?.id === rentalId) {
      setSelectedRental(updatedRentals.find(r => r.id === rentalId) || null);
    }
  }, [canCreatePayments, ganttRentals, payments, selectedRental]);

  // Extend rental: update endDate, update equipment returnDate
  const handleExtend = useCallback((rental: GanttRentalData, newEndDate: string) => {
    if (!canEditRentals) return;
    const updatedRentals = ganttRentals.map(r =>
      r.id === rental.id ? { ...r, endDate: newEndDate } : r
    );
    void persistGanttRentals(updatedRentals);

    // Update returnDate on equipment
    const updatedEq = equipmentList.map(e =>
      matchesEquipmentRow(rental, e)
        ? { ...e, returnDate: newEndDate }
        : e
    );
    void persistEquipment(updatedEq);

    // Refresh drawer
    if (selectedRental?.id === rental.id) {
      setSelectedRental(updatedRentals.find(r => r.id === rental.id) || null);
    }
  }, [canEditRentals, ganttRentals, equipmentList, matchesEquipmentRow, selectedRental]);

  // Update UPD signed status + optional date
  const handleUpdChange = useCallback((rental: GanttRentalData, updSigned: boolean, updDate?: string) => {
    if (!canEditRentals) return;
    const updatedRentals = ganttRentals.map(r =>
      r.id === rental.id
        ? { ...r, updSigned, updDate: updSigned ? (updDate || r.updDate) : undefined }
        : r
    );
    void persistGanttRentals(updatedRentals);
    if (selectedRental?.id === rental.id) {
      setSelectedRental(updatedRentals.find(r => r.id === rental.id) || null);
    }
  }, [canEditRentals, ganttRentals, selectedRental]);

  const handleUpdateRental = useCallback((rental: GanttRentalData, data: Partial<GanttRentalData>) => {
    if (!canEditRentals) return;

    const previousEquipment = equipmentList.find(e => matchesEquipmentRow(rental, e));
    const nextRental = { ...rental, ...data };
    const updatedRentals = ganttRentals.map(item =>
      item.id === rental.id ? nextRental : item
    );
    void persistGanttRentals(updatedRentals);

    if (previousEquipment) {
      const hasOtherActive = updatedRentals.some(item =>
        item.id !== rental.id &&
        matchesEquipmentRow(item, previousEquipment) &&
        item.status !== 'returned' &&
        item.status !== 'closed'
      );
      const nextEquipmentStatus: EquipmentStatus = nextRental.status === 'active'
        ? 'rented'
        : nextRental.status === 'created'
          ? 'reserved'
          : hasOpenServiceTicketForEquipment(serviceTickets, previousEquipment)
            ? 'in_service'
            : 'available';

      const updatedEquipment = equipmentList.map(item =>
        item.id !== previousEquipment.id
          ? item
          : {
              ...item,
              status: (nextRental.status === 'returned' || nextRental.status === 'closed')
                ? (hasOtherActive ? item.status : nextEquipmentStatus)
                : nextEquipmentStatus,
              currentClient: nextRental.status === 'active'
                ? nextRental.client
                : nextRental.status === 'created'
                  ? item.currentClient
                  : hasOtherActive
                    ? item.currentClient
                    : undefined,
              returnDate: nextRental.status === 'active'
                ? nextRental.endDate
                : nextRental.status === 'created'
                  ? item.returnDate
                  : hasOtherActive
                    ? item.returnDate
                    : undefined,
            }
      );
      void persistEquipment(updatedEquipment);
    }

    if (selectedRental?.id === rental.id) {
      setSelectedRental(nextRental);
    }
  }, [canEditRentals, equipmentList, ganttRentals, matchesEquipmentRow, persistEquipment, persistGanttRentals, selectedRental, serviceTickets]);

  const handleAddRentalComment = useCallback((rental: GanttRentalData, text: string) => {
    if (!canEditRentals) return;
    const nextComment = {
      date: format(new Date(), 'yyyy-MM-dd'),
      text,
      author: 'Планировщик аренды',
    };
    const updatedRentals = ganttRentals.map(item =>
      item.id === rental.id
        ? { ...item, comments: [...(item.comments || []), nextComment] }
        : item
    );
    void persistGanttRentals(updatedRentals);
    if (selectedRental?.id === rental.id) {
      setSelectedRental(updatedRentals.find(item => item.id === rental.id) || null);
    }
    showToast('Запись добавлена в историю аренды');
  }, [canEditRentals, ganttRentals, persistGanttRentals, selectedRental, showToast]);

  const handlePaymentStatusChange = useCallback((rental: GanttRentalData, status: GanttRentalData['paymentStatus']) => {
    if (!canEditRentals) return;
    const updatedRentals = ganttRentals.map(item =>
      item.id === rental.id ? { ...item, paymentStatus: status } : item
    );
    void persistGanttRentals(updatedRentals);
    if (selectedRental?.id === rental.id) {
      setSelectedRental(updatedRentals.find(item => item.id === rental.id) || null);
    }
    showToast(`Статус оплаты обновлён: ${status === 'paid' ? 'Оплачено' : status === 'partial' ? 'Частично' : 'Не оплачено'}`);
  }, [canEditRentals, ganttRentals, persistGanttRentals, selectedRental, showToast]);

  // Early return: set rental endDate to actualReturnDate, status → returned, clear equipment
  const handleEarlyReturn = useCallback((rental: GanttRentalData, actualReturnDate: string) => {
    if (!canEditRentals) return;
    const currentEquipment = equipmentList.find(e => matchesEquipmentRow(rental, e));
    const updatedRentals = ganttRentals.map(r =>
      r.id === rental.id
        ? { ...r, endDate: actualReturnDate, status: 'returned' as const }
        : r
    );
    void persistGanttRentals(updatedRentals);

    // Clear currentClient/returnDate from equipment if no other active rentals
    const hasOtherActive = updatedRentals.some(
      r =>
        !!currentEquipment
        && r.id !== rental.id
        && matchesEquipmentRow(r, currentEquipment)
        && r.status !== 'returned'
        && r.status !== 'closed'
    );
    if (!hasOtherActive) {
      const updatedEq = equipmentList.map(e =>
        matchesEquipmentRow(rental, e)
          ? {
              ...e,
              status: hasOpenServiceTicketForEquipment(serviceTickets, e) ? 'in_service' as EquipmentStatus : 'available' as EquipmentStatus,
              currentClient: undefined,
              returnDate: undefined,
            }
          : e
      );
      void persistEquipment(updatedEq);
    }

    setSelectedRental(null);
  }, [canEditRentals, ganttRentals, equipmentList, matchesEquipmentRow, persistEquipment, persistGanttRentals, serviceTickets]);

  // ===== Today line position =====
  const todayOffset = useMemo(() => {
    const diff = differenceInDays(today, viewStart);
    if (diff < 0 || diff > totalDays) return null;
    return diff * dayWidth;
  }, [today, viewStart, totalDays, dayWidth]);

  return (
    <div className="flex h-[calc(100vh-56px-64px)] sm:h-[calc(100vh)] flex-col overflow-hidden bg-gray-50 dark:bg-gray-900">
      {/* ===== Toolbar ===== */}
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800">
        <h1 className="mr-2 text-xl text-gray-900 dark:text-white">Планировщик аренды</h1>

        {/* Scale Switcher */}
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-600 dark:bg-gray-700">
          {(['week', 'month', 'quarter', 'year'] as Scale[]).map(s => (
            <button
              key={s}
              onClick={() => setScale(s)}
              className={`px-3 py-1.5 text-xs transition-colors ${
                scale === s
                  ? 'bg-[--color-primary] text-white'
                  : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600'
              } ${s === 'week' ? 'rounded-l-lg' : s === 'year' ? 'rounded-r-lg' : ''}`}
            >
              {SCALE_CONFIG[s].label}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2 rounded-lg border border-gray-200 bg-gray-50 px-2 py-1.5 dark:border-gray-600 dark:bg-gray-700">
          <input
            type="date"
            value={customRangeStart}
            onChange={e => setCustomRangeStart(e.target.value)}
            className="h-7 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <span className="text-xs text-gray-400">—</span>
          <input
            type="date"
            value={customRangeEnd}
            onChange={e => setCustomRangeEnd(e.target.value)}
            className="h-7 rounded border border-gray-200 bg-white px-2 text-xs text-gray-700 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white"
          />
          <button
            onClick={applyCustomRange}
            disabled={!customRange}
            className="rounded-md bg-gray-200 px-2.5 py-1 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-300 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-gray-600 dark:text-gray-100 dark:hover:bg-gray-500"
          >
            Период
          </button>
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
            {rangeLabel}
          </span>
        </div>

        <div className="ml-auto flex items-center gap-2">
          {can('create', 'rentals') && (
            <Button size="sm" onClick={() => handleOpenNewRental()}>
              <Plus className="h-3.5 w-3.5" />
              Новая аренда
            </Button>
          )}
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
      <div className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-white px-4 py-1.5 dark:border-gray-700 dark:bg-gray-800">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder="Модель / INV / SN"
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

        {hasActiveFilters && (
          <Button size="sm" variant="ghost" onClick={resetFilters} className="h-8 px-3 text-xs text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20">
            × Сбросить фильтры
          </Button>
        )}

        <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">
          {hasActiveFilters
            ? `${shownEquipment} из ${totalEquipment} ед. · ${shownRentals} из ${totalRentals} аренд`
            : `${totalEquipment} ед. · ${totalRentals} аренд`}
        </span>
      </div>

      {ambiguousLegacyRentals.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Найдена {ambiguousLegacyRentals.length} старая аренда с неоднозначной привязкой к технике по дублирующемуся `INV`.
          Она временно показана только в одной строке, чтобы не размножаться по всем `0`.
          Такую аренду лучше открыть, удалить и создать заново.
        </div>
      )}

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
                      {scale === 'week' || (scale === 'custom' && totalDays <= 31) ? (
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
                {can('create', 'equipment') && (
                  <Button
                    size="sm"
                    className="mt-4"
                    onClick={() => window.location.href = '/rental-management/equipment/new'}
                  >
                    + Добавить технику
                  </Button>
                )}
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
                rentals={filteredRentals.filter(r => matchesEquipmentRow(r, eq))}
                downtimes={mockDowntimes.filter(d => d.equipmentInv === eq.inventoryNumber)}
                servicePeriods={servicePeriods.filter(s => s.equipmentInv === eq.inventoryNumber)}
                conflictIds={conflictSets.get(eq.id) || new Set()}
                viewStart={viewStart}
                totalDays={totalDays}
                dayWidth={dayWidth}
                todayOffset={todayOffset}
                viewEnd={viewEnd}
                scale={scale}
                days={days}
                today={today}
                onBarClick={setSelectedRental}
                onNewRental={() => handleOpenNewRental(eq.id)}
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
          equipment={equipmentList.find(e => matchesEquipmentRow(selectedRental, e))}
          allRentals={ganttRentals}
          payments={payments}
          canEditRentals={canEditRentals}
          canDeleteRentals={canDeleteRentals}
          canCreatePayments={canCreatePayments}
          onClose={() => setSelectedRental(null)}
          onAddPayment={handleAddPayment}
          onExtend={handleExtend}
          onEarlyReturn={handleEarlyReturn}
          onUpdChange={handleUpdChange}
          onReturn={(r) => {
            if (!canEditRentals) return;
            setSelectedRental(null);
            handleOpenReturn(r);
          }}
          onStatusChange={(rental) => {
            if (!canEditRentals) return;
            const currentEquipment = equipmentList.find(e => matchesEquipmentRow(rental, e));
            // created → active, returned → closed
            let nextStatus: GanttRentalData['status'] | null = null;
            if (rental.status === 'created') nextStatus = 'active';
            else if (rental.status === 'returned') nextStatus = 'closed';

            if (nextStatus) {
              const updated = ganttRentals.map(r =>
                r.id === rental.id ? { ...r, status: nextStatus! } : r,
              );
              void persistGanttRentals(updated);

              // При активации аренды — техника "В аренде" + заполняем клиента и дату возврата
              if (nextStatus === 'active') {
                const newEqList = equipmentList.map(e =>
                  matchesEquipmentRow(rental, e)
                    ? { ...e, status: 'rented' as EquipmentStatus, currentClient: rental.client, returnDate: rental.endDate }
                    : e,
                );
                void persistEquipment(newEqList);
              }
              // При закрытии — если нет других активных аренд, техника "Свободна" + очищаем клиента и дату
              if (nextStatus === 'closed' && currentEquipment) {
                const hasOtherActive = updated.some(
                  r =>
                    r.id !== rental.id
                    && matchesEquipmentRow(r, currentEquipment)
                    && r.status !== 'returned'
                    && r.status !== 'closed',
                );
                if (!hasOtherActive) {
                  const newEqList = equipmentList.map(e =>
                    matchesEquipmentRow(rental, e)
                      ? {
                          ...e,
                          status: hasOpenServiceTicketForEquipment(serviceTickets, e) ? 'in_service' as EquipmentStatus : 'available' as EquipmentStatus,
                          currentClient: undefined,
                          returnDate: undefined,
                        }
                      : e,
                  );
                  void persistEquipment(newEqList);
                }
              }
            }
            setSelectedRental(null);
          }}
          onDelete={(rental) => {
            if (!canDeleteRentals) return;
            const updated = ganttRentals.filter(r => r.id !== rental.id);
            void persistGanttRentals(updated);
            // Если после удаления нет других активных аренд — техника снова свободна, очищаем клиента и дату
            const currentEquipment = equipmentList.find(e => matchesEquipmentRow(rental, e));
            const hasOtherActive = updated.some(
              r =>
                !!currentEquipment
                && matchesEquipmentRow(r, currentEquipment)
                && r.status !== 'returned'
                && r.status !== 'closed',
            );
            if (!hasOtherActive) {
              const newEqList = equipmentList.map(e =>
                matchesEquipmentRow(rental, e)
                  ? {
                      ...e,
                      status: hasOpenServiceTicketForEquipment(serviceTickets, e) ? 'in_service' as EquipmentStatus : 'available' as EquipmentStatus,
                      currentClient: undefined,
                      returnDate: undefined,
                    }
                  : e,
              );
              void persistEquipment(newEqList);
            }
            setSelectedRental(null);
          }}
          onUpdate={handleUpdateRental}
          onAddComment={handleAddRentalComment}
          onPaymentStatusChange={handlePaymentStatusChange}
        />
      )}

      {/* ===== Modals ===== */}
        <ReturnModal
          open={showReturnModal}
          rental={returnRental}
          ganttRentals={ganttRentals}
          onClose={() => { setShowReturnModal(false); setReturnRental(null); }}
          onConfirm={(data) => {
          if (!canEditRentals) return;
          // Обновляем статус аренды на 'returned'
          const updated = ganttRentals.map(r =>
            r.id === data.rentalId ? { ...r, status: 'returned' as const } : r,
          );
          void persistGanttRentals(updated);

          // Обновляем статус техники, если нет других активных аренд
          const rental = ganttRentals.find(r => r.id === data.rentalId);
          if (rental) {
            const currentEquipment = equipmentList.find(e => matchesEquipmentRow(rental, e));
            const hasOtherActive = updated.some(
              r =>
                !!currentEquipment
                && r.id !== data.rentalId
                && matchesEquipmentRow(r, currentEquipment)
                && r.status !== 'returned'
                && r.status !== 'closed',
            );
            if (!hasOtherActive) {
              const newStatus: EquipmentStatus =
                data.result === 'service'
                  ? 'in_service'
                  : (currentEquipment && hasOpenServiceTicketForEquipment(serviceTickets, currentEquipment) ? 'in_service' : 'available');
              const newEqList = equipmentList.map(e =>
                matchesEquipmentRow(rental, e)
                  ? { ...e, status: newStatus, currentClient: undefined, returnDate: undefined }
                  : e,
              );
              void persistEquipment(newEqList);
            }
          }
          showToast(`Возврат оформлен: ${rental?.equipmentInv ?? data.rentalId}`);
          setShowReturnModal(false);
          setReturnRental(null);
        }}
      />
        <DowntimeModal
          open={showDowntimeModal}
          preselectedEquipment={preselectedEquipmentInv}
          onClose={() => setShowDowntimeModal(false)}
        onConfirm={(data) => {
          console.log('Downtime created:', data);
          setShowDowntimeModal(false);
        }}
      />
        <NewRentalModal
          open={showNewRentalModal}
          preselectedEquipmentId={preselectedEquipmentId}
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
            equipmentId: data.equipmentId,
            equipmentInv: data.equipmentInv || '',
            startDate: data.startDate || '',
            endDate: data.endDate || '',
            manager: data.manager || '',
            managerInitials: (data.manager || '').split(' ').map((w: string) => w[0]).join('').toUpperCase(),
            status: initialStatus,
            paymentStatus: 'unpaid',
            updSigned: false,
            amount: data.amount || 0,
            comments: [],
          };
          const updated = [...ganttRentals, newRental];
          void persistGanttRentals(updated);

          // Синхронизируем статус техники + клиента и дату возврата на основе initialStatus аренды
          if (data.equipmentId) {
            const eqStatus: EquipmentStatus = initialStatus === 'active' ? 'rented' : 'reserved';
            const newEqList = equipmentList.map(e => {
              if (e.id !== data.equipmentId) return e;
              return {
                ...e,
                status: eqStatus,
                currentClient: initialStatus === 'active' ? newRental.client : e.currentClient,
                returnDate: initialStatus === 'active' ? newRental.endDate : e.returnDate,
              };
            });
            void persistEquipment(newEqList);
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
  viewEnd: Date;
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
  viewStart, totalDays, dayWidth, todayOffset, viewEnd, scale, days, today,
  onBarClick, onNewRental, onReturn, onDowntime
}: EquipmentRowProps) {
  const { can: canDo } = usePermissions();
  // Статус вычисляется динамически из аренд, а не из equipment.status
  const effectiveStatus = computeEffectiveStatus(equipment, rentals, today, { start: viewStart, end: viewEnd });
  const eqStatus = EQ_STATUS_LABELS[effectiveStatus] || EQ_STATUS_LABELS.available;
  const hasActiveRental = rentals.some(r => r.status === 'active');
  const timelineWidth = totalDays * dayWidth;

  return (
    <div className="group flex border-b border-gray-100 dark:border-gray-800" style={{ minHeight: ROW_HEIGHT }}>
      {/* Left panel */}
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center border-r border-gray-200 bg-white px-2 dark:border-gray-700 dark:bg-gray-800"
        style={{ width: LEFT_PANEL_WIDTH }}
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-1">
            <span className="font-mono text-[10px] text-gray-500 dark:text-gray-400">{equipment.inventoryNumber}</span>
            <span className="truncate text-[11px] font-medium text-gray-900 dark:text-white">{equipment.model}</span>
          </div>
          <div className="mt-0.5 truncate text-[8px] uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">
            SN {equipment.serialNumber || 'не указан'}
          </div>
          <div className="mt-0.5 flex items-center gap-1 flex-wrap">
            <span className={`inline-flex rounded px-1 py-0 text-[8px] leading-4 ${eqStatus.color}`}>
              {eqStatus.label}
            </span>
            <span className={`inline-flex rounded px-1 py-0 text-[8px] leading-4 ${PRIORITY_STYLES[equipment.priority]}`}>
              {EQUIPMENT_PRIORITY_LABELS[equipment.priority]}
            </span>
            <span className="truncate text-[8px] uppercase tracking-[0.04em] text-gray-400 dark:text-gray-500">
              {TYPE_LABELS[equipment.type]}
            </span>
          </div>
        </div>
        {/* Quick actions */}
        <div className="ml-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100">
          {canDo('create', 'rentals') && (
            <button
              onClick={onNewRental}
              className="rounded p-0.5 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
              title="Создать аренду"
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
          {hasActiveRental && (
            <button
              onClick={() => {
                const active = rentals.find(r => r.status === 'active');
                if (active) onReturn(active);
              }}
              className="rounded p-0.5 text-gray-400 transition-colors hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30 dark:hover:text-green-400"
              title="Возврат техники"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={onDowntime}
            className="rounded p-0.5 text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/30 dark:hover:text-amber-400"
            title="Отметить простой"
          >
            <PauseCircle className="h-3 w-3" />
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
              className="absolute z-[5] flex items-center rounded px-1.5 text-[10px] text-red-700 dark:text-red-300"
              style={{
                left: pos.left,
                width: pos.width,
                top: 3,
                height: ROW_HEIGHT - 6,
                background: 'repeating-linear-gradient(45deg, transparent, transparent 4px, rgba(220,38,38,0.16) 4px, rgba(220,38,38,0.16) 8px)',
                border: '1px solid rgba(220,38,38,0.45)',
              }}
              title={`Ремонт / сервис: ${sp.description}`}
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
                top: 3,
                height: ROW_HEIGHT - 6,
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
          const barHeight = 18;
          const topOffset = 3 + stackIndex * (barHeight + 2);

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
              {/* Bar content */}
              <div className="flex min-w-0 flex-1 flex-col justify-center overflow-hidden px-2 leading-tight">
                <div className="flex items-center gap-1">
                  {isConflict && (
                    <AlertTriangle className="h-3 w-3 shrink-0 text-red-200" />
                  )}
                  {pos.width > 40 && (
                    <span className="truncate text-[10px] font-medium text-white">
                      {rental.clientShort || rental.client}
                    </span>
                  )}
                </div>
                {pos.width > 110 && (
                  <div className="flex items-center gap-1 text-[8px] text-white/70">
                    <span>{statusLabel}</span>
                    {pos.width > 165 && (
                      <span>· {rental.startDate.slice(5)} → {rental.endDate.slice(5)}</span>
                    )}
                    {pos.width > 220 && rental.managerInitials && (
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
