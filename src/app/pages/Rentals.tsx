import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Plus, ChevronLeft, ChevronRight, ChevronDown, ChevronRight as ChevronRightSmall, SlidersHorizontal, RotateCcw, CirclePause as PauseCircle,
  Search, CircleCheck, CircleAlert, CreditCard, ArrowRightLeft,
  AlertTriangle, ClipboardCheck, Wrench
} from 'lucide-react';
import { Button } from '../components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { RentalDrawer } from '../components/gantt/RentalDrawer';
import { ReturnModal, DowntimeModal, NewRentalModal } from '../components/gantt/GanttModals';
import { RentalApprovalHistorySheet } from '../components/gantt/RentalApprovalHistorySheet';
import {
  mockDowntimes,
  mockServicePeriods,
} from '../mock-data';
import { filterRentalManagerUsers, getInvestorBinding, isInvestorUser, type SystemUser } from '../lib/userStorage';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import type { GanttRentalData, DowntimePeriod, ServicePeriod } from '../mock-data';
import type { Equipment, EquipmentType, EquipmentStatus, Payment, Rental, ServiceTicket, ServiceStatus, ShippingPhoto } from '../types';
import { equipmentService } from '../services/equipment.service';
import { rentalsService } from '../services/rentals.service';
import { paymentsService } from '../services/payments.service';
import { serviceTicketsService } from '../services/service-tickets.service';
import { clientsService } from '../services/clients.service';
import { usersService } from '../services/users.service';
import { EQUIPMENT_KEYS } from '../hooks/useEquipment';
import { PAYMENT_KEYS } from '../hooks/usePayments';
import { RENTAL_KEYS } from '../hooks/useRentals';
import { SERVICE_TICKET_KEYS } from '../hooks/useServiceTickets';
import { useRentalChangeRequestsList } from '../hooks/useRentalChangeRequests';
import { canEquipmentParticipateInRentals, compareEquipmentByPriority } from '../lib/equipmentClassification';
import { buildClientReceivables, buildRentalDebtRows, mergeClientsWithFinancials } from '../lib/finance';
import {
  appendRentalHistory,
  buildRentalCreationHistory,
  buildRentalUpdateHistory,
  createRentalHistoryEntry,
} from '../lib/rental-history';
import { appendAuditHistory, createAuditEntry } from '../lib/entity-history';
import {
  addDays, addMonths, addYears, differenceInDays, endOfMonth, endOfQuarter,
  endOfYear, format, isSameDay, isWeekend, max as dateMax, min as dateMin,
  startOfDay, startOfMonth, startOfQuarter, startOfWeek, startOfYear
} from 'date-fns';
import { ru } from 'date-fns/locale';
import { calculateRentalAmount, cn, getRentalDays } from '../lib/utils';

// ========== Constants & Types ==========
type Scale = 'week' | 'month' | 'quarter' | 'year' | 'custom';
type CompactView = 'cards' | 'timeline';
type DensityMode = 'comfortable' | 'compact';
const RENTALS_COMPACT_VIEW_STORAGE_KEY = 'rentals_compact_view';
const RENTALS_COLLAPSED_GROUPS_STORAGE_KEY = 'rentals_collapsed_groups';
const RENTALS_DENSITY_MODE_STORAGE_KEY = 'rentals_density_mode';

const SCALE_CONFIG: Record<Scale, { dayWidth: number; label: string }> = {
  week: { dayWidth: 120, label: 'Неделя' },
  month: { dayWidth: 40, label: 'Месяц' },
  quarter: { dayWidth: 16, label: 'Квартал' },
  year: { dayWidth: 6, label: 'Год' },
  custom: { dayWidth: 28, label: 'Период' },
};

const LEFT_PANEL_WIDTH = 236;

function getGanttRentalSourceId(ganttRental: GanttRentalData): string {
  return String(
    ganttRental.rentalId ||
    ganttRental.sourceRentalId ||
    ganttRental.originalRentalId ||
    ''
  ).trim();
}

function normalizeMatchRef(value: unknown): string {
  return String(value ?? '').trim();
}

type EquipmentAliasRecord = Partial<GanttRentalData> & Partial<Rental> & {
  inventoryNumber?: string;
  serialNumber?: string;
};

function equipmentAliasSet(record: EquipmentAliasRecord, equipmentList: Equipment[]): Set<string> {
  const aliases = new Set<string>();
  const add = (value: unknown) => {
    const normalized = normalizeMatchRef(value);
    if (normalized) aliases.add(normalized);
  };
  const addEquipment = (equipment?: Equipment) => {
    if (!equipment) return;
    add(equipment.id);
    add(equipment.inventoryNumber);
    add(equipment.serialNumber);
  };

  add(record.equipmentId);
  add(record.equipmentInv);
  add(record.inventoryNumber);
  add(record.serialNumber);
  if (Array.isArray(record.equipment)) record.equipment.forEach(add);

  const directRefs = [...aliases];
  const inventoryCounts = equipmentList.reduce((acc, equipment) => {
    const inventory = normalizeMatchRef(equipment.inventoryNumber);
    if (inventory) acc.set(inventory, (acc.get(inventory) || 0) + 1);
    return acc;
  }, new Map<string, number>());

  for (const ref of directRefs) {
    const byId = equipmentList.find(equipment => equipment.id === ref);
    if (byId) addEquipment(byId);

    if ((inventoryCounts.get(ref) || 0) === 1) {
      addEquipment(equipmentList.find(equipment => equipment.inventoryNumber === ref));
    }

    const bySerial = equipmentList.filter(equipment => normalizeMatchRef(equipment.serialNumber) === ref);
    if (bySerial.length === 1) addEquipment(bySerial[0]);
  }

  return aliases;
}

function hasEquipmentAliasOverlap(
  ganttRental: GanttRentalData,
  rental: Rental,
  equipmentList: Equipment[],
): boolean {
  const left = equipmentAliasSet(ganttRental, equipmentList);
  const right = equipmentAliasSet(rental, equipmentList);
  return [...left].some(value => right.has(value));
}

function matchesClassicRentalForGantt(ganttRental: GanttRentalData, rental: Rental, equipmentList: Equipment[] = []): boolean {
  const linkedRentalId = getGanttRentalSourceId(ganttRental);
  if (linkedRentalId) return String(rental.id) === linkedRentalId;

  const sameClient = ganttRental.clientId && rental.clientId
    ? ganttRental.clientId === rental.clientId
    : ganttRental.client === rental.client;
  const rentalEndDate = rental.plannedReturnDate || (rental as Rental & { endDate?: string }).endDate || '';
  const exactDates = rental.startDate === ganttRental.startDate && rentalEndDate === ganttRental.endDate;
  const overlappingDates = dateRangesOverlap(rental.startDate, rentalEndDate, ganttRental.startDate, ganttRental.endDate);
  if (!exactDates && !overlappingDates) return false;
  if (!sameClient) return false;
  return hasEquipmentAliasOverlap(ganttRental, rental, equipmentList);
}

function matchesClassicRentalForGanttByShape(ganttRental: GanttRentalData, rental: Rental, equipmentList: Equipment[] = []): boolean {
  const linkedRentalId = getGanttRentalSourceId(ganttRental);
  if (linkedRentalId) return String(rental.id) === linkedRentalId;
  const rentalEndDate = rental.plannedReturnDate || (rental as Rental & { endDate?: string }).endDate || '';
  if (!dateRangesOverlap(rental.startDate, rentalEndDate, ganttRental.startDate, ganttRental.endDate)) return false;
  return hasEquipmentAliasOverlap(ganttRental, rental, equipmentList);
}

function dateRangesOverlap(startA: string, endA: string, startB: string, endB: string): boolean {
  if (!startA || !endA || !startB || !endB) return false;
  return startA <= endB && startB <= endA;
}

const TYPE_LABELS: Record<string, string> = {
  scissor: 'Ножничный',
  articulated: 'Коленчатый',
  telescopic: 'Телескопический',
  mast: 'Мачтовый',
};

const EQ_STATUS_LABELS: Record<string, { label: string; color: string }> = {
  available: { label: 'Свободна', color: 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400' },
  rented: { label: 'В аренде', color: 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400' },
  reserved: { label: 'Бронь', color: 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400' },
  in_service: { label: 'В сервисе', color: 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400' },
  inactive: { label: 'Списан', color: 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400' },
};

const RENTAL_BAR_COLORS: Record<GanttRentalData['status'], string> = {
  active: 'border border-blue-500/60 bg-gradient-to-r from-blue-600 to-blue-500 text-white dark:border-blue-400/40 dark:from-blue-600 dark:to-blue-500',
  created: 'border border-slate-500/60 bg-gradient-to-r from-slate-500 to-slate-400 text-white dark:border-slate-400/40 dark:from-slate-500 dark:to-slate-400',
  returned: 'border border-emerald-500/60 bg-gradient-to-r from-emerald-600 to-emerald-500 text-white dark:border-emerald-400/40 dark:from-emerald-600 dark:to-emerald-500',
  closed: 'border border-gray-400/60 bg-gradient-to-r from-gray-400 to-gray-300 text-white dark:border-gray-500/40 dark:from-gray-500 dark:to-gray-400',
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

const AVAILABLE_EQUIPMENT_STATUS_FILTER = 'available_equipment';

const RENTAL_STATUS_FILTERS = [
  { value: '', label: 'Все статусы' },
  { value: AVAILABLE_EQUIPMENT_STATUS_FILTER, label: 'Свободная техника' },
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

function withUserScopedStorageKey(prefix: string, userId?: string) {
  return `${prefix}:${userId || 'guest'}`;
}

function getCompactViewStorageKey(userId?: string) {
  return withUserScopedStorageKey(RENTALS_COMPACT_VIEW_STORAGE_KEY, userId);
}

function getCollapsedGroupsStorageKey(userId?: string) {
  return withUserScopedStorageKey(RENTALS_COLLAPSED_GROUPS_STORAGE_KEY, userId);
}

function getDensityModeStorageKey(userId?: string) {
  return withUserScopedStorageKey(RENTALS_DENSITY_MODE_STORAGE_KEY, userId);
}

function getQuickCountTone(value: number, warningFrom = 1, criticalFrom = 3) {
  if (value >= criticalFrom) {
    return 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300';
  }
  if (value >= warningFrom) {
    return 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300';
  }
  return 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-300';
}

function safeRentalDateLabel(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return format(date, 'd MMM', { locale: ru });
}

function safeRentalDateRangeLabel(start?: string, end?: string) {
  return `${safeRentalDateLabel(start)} — ${safeRentalDateLabel(end)}`;
}

function safeRentalCompactDate(value?: string) {
  return typeof value === 'string' && value.length >= 10 ? value.slice(5, 10) : '—';
}

function safeMovementDateLabel(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  const hasTime = value.includes('T');
  return format(date, hasTime ? 'dd.MM.yyyy HH:mm' : 'dd.MM.yyyy', { locale: ru });
}

function getEquipmentMovementLabel(equipment?: Pick<Equipment, 'manufacturer' | 'model' | 'inventoryNumber'> | null) {
  if (!equipment) return 'Техника не найдена';
  const manufacturerModel = [equipment.manufacturer, equipment.model].filter(Boolean).join(' ').trim();
  if (manufacturerModel && equipment.inventoryNumber) return `${manufacturerModel} · INV ${equipment.inventoryNumber}`;
  if (manufacturerModel) return manufacturerModel;
  if (equipment.inventoryNumber) return `INV ${equipment.inventoryNumber}`;
  return 'Без названия';
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
  const normalizedStart = startOfDay(barStart);
  const normalizedEndExclusive = addDays(startOfDay(barEnd), 1);
  const clampedStart = dateMax([normalizedStart, viewStart]);
  const viewEnd = addDays(viewStart, totalDays);
  const clampedEnd = dateMin([normalizedEndExclusive, viewEnd]);
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

const OPEN_SERVICE_STATUSES: ServiceStatus[] = ['new', 'in_progress', 'waiting_parts'];

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
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const historyAuthor = user?.name || 'Система';
  const isAdminRole = user?.role === 'Администратор';
  const canEditRentals = can('edit', 'rentals');
  const canDeleteRentals = can('delete', 'rentals');
  const canCreatePayments = can('create', 'payments');
  const canEditRentalDates = canEditRentals;
  const canRestoreRentals = isAdminRole;
  const today = useMemo(() => startOfDay(new Date()), []);
  const todayStr = format(today, 'yyyy-MM-dd');
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
  const { data: shippingPhotos = [] } = useQuery<ShippingPhoto[]>({
    queryKey: ['shippingPhotos', 'all'],
    queryFn: equipmentService.getAllShippingPhotos,
  });
  const { data: serviceTickets = [] } = useQuery<ServiceTicket[]>({
    queryKey: SERVICE_TICKET_KEYS.all,
    queryFn: serviceTicketsService.getAll,
  });
  const { data: usersData = [] } = useQuery<SystemUser[]>({
    queryKey: ['users'],
    queryFn: usersService.getAll,
  });
  const { data: clientsData = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsService.getAll,
  });

  const investorBinding = useMemo(() => getInvestorBinding(user), [user]);
  const isInvestorRole = isInvestorUser({
    role: user?.role,
    status: 'Активен',
    ownerId: user?.ownerId,
    ownerName: user?.ownerName,
    name: user?.name,
  });
  const {
    data: rentalChangeRequests = [],
    isLoading: isRentalApprovalsLoading,
    error: rentalApprovalsError,
  } = useRentalChangeRequestsList(!isInvestorRole);
  const investorEquipmentIds = useMemo(() => {
    if (!isInvestorRole || !investorBinding) return null;
    return new Set(
      equipmentData
        .filter(item =>
          item.owner === 'investor'
          && (
            (investorBinding.ownerId && item.ownerId === investorBinding.ownerId)
            || (investorBinding.ownerName && (item.ownerName || '').trim() === investorBinding.ownerName)
          ),
        )
        .map(item => item.id),
    );
  }, [equipmentData, investorBinding, isInvestorRole]);
  const investorInventoryNumbers = useMemo(() => {
    if (!isInvestorRole || !investorBinding) return null;
    return new Set(
      equipmentData
        .filter(item =>
          item.owner === 'investor'
          && (
            (investorBinding.ownerId && item.ownerId === investorBinding.ownerId)
            || (investorBinding.ownerName && (item.ownerName || '').trim() === investorBinding.ownerName)
          ),
        )
        .map(item => item.inventoryNumber)
        .filter(Boolean),
    );
  }, [equipmentData, investorBinding, isInvestorRole]);

  useEffect(() => {
    if (!isInvestorRole || !investorEquipmentIds || !investorInventoryNumbers) {
      setGanttRentals(ganttData);
      return;
    }
    setGanttRentals(ganttData.filter(item =>
      (item.equipmentId && investorEquipmentIds.has(item.equipmentId))
      || (!item.equipmentId && investorInventoryNumbers.has(item.equipmentInv)),
    ));
  }, [ganttData, investorEquipmentIds, investorInventoryNumbers, isInvestorRole]);

  useEffect(() => {
    if (!isInvestorRole || !investorEquipmentIds) {
      setEquipmentList(equipmentData);
      return;
    }
    setEquipmentList(equipmentData.filter(item => investorEquipmentIds.has(item.id)));
  }, [equipmentData, investorEquipmentIds, isInvestorRole]);

  useEffect(() => {
    setPayments(paymentData);
  }, [paymentData]);

  const computedClients = useMemo(
    () => mergeClientsWithFinancials(clientsData, ganttRentals, payments),
    [clientsData, ganttRentals, payments],
  );
  const rentalDebtRows = useMemo(
    () => buildRentalDebtRows(ganttRentals, payments),
    [ganttRentals, payments],
  );

  // Map rentalId → paid fraction (0..1) for bar coloring
  const rentalPaidFractions = useMemo(() => {
    const byRentalId = new Map<string, Payment[]>();
    payments.forEach(p => {
      if (!p.rentalId) return;
      if (!byRentalId.has(p.rentalId)) byRentalId.set(p.rentalId, []);
      byRentalId.get(p.rentalId)!.push(p);
    });
    const map = new Map<string, number>();
    ganttRentals.forEach(r => {
      const ps = byRentalId.get(r.id) ?? [];
      const paid = ps.reduce((s, p) => s + (p.paidAmount ?? p.amount ?? 0), 0);
      const total = r.amount || 0;
      const fraction = total > 0
        ? Math.min(1, paid / total)
        : r.paymentStatus === 'paid' ? 1 : 0;
      if (fraction > 0) map.set(r.id, fraction);
    });
    return map;
  }, [payments, ganttRentals]);
  const clientReceivables = useMemo(
    () => buildClientReceivables(clientsData, rentalDebtRows),
    [clientsData, rentalDebtRows],
  );
  const rentalApprovalRequests = useMemo(() => {
    const statusOrder = { pending: 0, approved: 1, rejected: 1 };
    return rentalChangeRequests
      .filter(request => request.entityType === 'rental')
      .sort((a, b) => {
        const byStatus = statusOrder[a.status] - statusOrder[b.status];
        if (byStatus !== 0) return byStatus;
        return String(b.decidedAt || b.createdAt).localeCompare(String(a.decidedAt || a.createdAt));
      });
  }, [rentalChangeRequests]);
  const pendingRentalApprovalCount = useMemo(
    () => rentalApprovalRequests.filter(request => request.status === 'pending').length,
    [rentalApprovalRequests],
  );

  // Менеджеры для фильтра (динамически из базы пользователей)
  const managersList = useMemo(() => filterRentalManagerUsers(usersData), [usersData]);

  // Toast-уведомление
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const showToast = useCallback((message: string, type: 'success' | 'error' = 'success') => {
    setToast({ message, type });
    setTimeout(() => setToast(null), 3500);
  }, []);

  const persistGanttRentals = useCallback(async (list: GanttRentalData[]) => {
    setGanttRentals(list);
    try {
      await rentalsService.bulkReplaceGantt(list);
      await queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt });
    } catch {
      showToast('Не удалось сохранить аренды', 'error');
    }
  }, [queryClient, showToast]);

  const persistEquipment = useCallback(async (list: Equipment[]) => {
    setEquipmentList(list);
    try {
      await equipmentService.bulkReplace(list);
      await queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all });
    } catch {
      showToast('Не удалось сохранить технику', 'error');
    }
  }, [queryClient, showToast]);

  const persistPayments = useCallback(async (list: Payment[]) => {
    setPayments(list);
    try {
      await paymentsService.bulkReplace(list);
      await queryClient.invalidateQueries({ queryKey: PAYMENT_KEYS.all });
    } catch {
      showToast('Не удалось сохранить платежи', 'error');
    }
  }, [queryClient, showToast]);

  const requestClassicRentalChange = useCallback(async (
    ganttRental: GanttRentalData,
    patch: Partial<Rental>,
    reason: string,
  ): Promise<boolean> => {
    try {
      const [classicRentals, freshGanttRentals] = await Promise.all([
        rentalsService.getAll(),
        rentalsService.getGanttData().catch(() => [] as GanttRentalData[]),
      ]);
      const currentGanttRental =
        freshGanttRentals.find(item => item.id === ganttRental.id) ||
        freshGanttRentals.find(item =>
          item.equipmentInv === ganttRental.equipmentInv &&
          item.startDate === ganttRental.startDate &&
          item.endDate === ganttRental.endDate &&
          (item.clientId && ganttRental.clientId ? item.clientId === ganttRental.clientId : item.client === ganttRental.client)
        ) ||
        ganttRental;
      const strictLinkedRentals = classicRentals.filter(item => matchesClassicRentalForGantt(currentGanttRental, item, equipmentList));
      const linkedRentals = strictLinkedRentals.length > 0
        ? strictLinkedRentals
        : classicRentals.filter(item => matchesClassicRentalForGanttByShape(currentGanttRental, item, equipmentList));
      const sourceRentalId = getGanttRentalSourceId(currentGanttRental);
      if (!sourceRentalId && linkedRentals.length > 1) {
        showToast(
          'Найдено несколько похожих карточек аренды, откройте карточку аренды',
          'error',
        );
        return false;
      }
      const resolvedRentalId = sourceRentalId || linkedRentals[0]?.id || '';
      const targetRentalId = resolvedRentalId || currentGanttRental.id;
      const previousRental = linkedRentals.find(item => item.id === resolvedRentalId) || linkedRentals[0] || null;
      const oldValues = Object.fromEntries(Object.keys(patch).map(field => {
        if (previousRental && field in previousRental) return [field, previousRental[field as keyof Rental]];
        if (field === 'plannedReturnDate') return [field, currentGanttRental.endDate];
        if (field === 'startDate') return [field, currentGanttRental.startDate];
        if (field === 'price') return [field, currentGanttRental.amount];
        if (field === 'clientId') return [field, currentGanttRental.clientId || ''];
        if (field === 'client') return [field, currentGanttRental.client];
        if (field === 'manager') return [field, currentGanttRental.manager];
        return [field, undefined];
      }));

      const saved = await rentalsService.update(targetRentalId, {
        ...patch,
        rentalId: resolvedRentalId,
        ganttRentalId: currentGanttRental.id,
        ganttSnapshot: currentGanttRental,
        entityType: 'rental',
        actionType: 'gantt_rental_update',
        oldValues,
        newValues: patch,
        changes: Object.keys(patch).map(field => ({
          field,
          oldValue: oldValues[field],
          newValue: patch[field as keyof Rental],
        })),
        __rentalId: resolvedRentalId,
        __linkedGanttRentalId: currentGanttRental.id,
        __ganttRentalId: currentGanttRental.id,
        __sourceRentalId: currentGanttRental.id,
        __ganttSnapshot: currentGanttRental,
        __changeReason: reason,
      } as Partial<Rental> & Record<string, unknown>);
      const summary = (saved as Rental & {
        changeRequestSummary?: { pendingCount?: number; appliedFields?: string[] };
      }).changeRequestSummary;

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.detail((saved as Rental).id || targetRentalId) }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
        queryClient.invalidateQueries({ queryKey: ['rental-change-requests'] }),
      ]);

      if (summary?.pendingCount) {
        showToast('Изменения отправлены администратору на согласование');
      } else {
        showToast('Изменение аренды применено');
      }
      return true;
    } catch (error) {
      showToast(error instanceof Error ? error.message : 'Не удалось отправить изменение на согласование', 'error');
      return false;
    }
  }, [equipmentList, queryClient, showToast]);

  // Очистка только «призрачных» черновиков:
  // - 'created' с прошедшей endDate → 'closed'
  // Просроченные активные аренды НЕ меняем автоматически:
  // они должны остаться активными и попасть в сценарий «требует внимания».
  React.useEffect(() => {
    const todayStr = format(today, 'yyyy-MM-dd');
    const current = ganttRentals;

    const needsCleanup = current.some(r =>
      r.status === 'created' && r.endDate < todayStr,
    );

    if (!needsCleanup) return;

    const cleaned = current.map(r => {
      if (r.status === 'created' && r.endDate < todayStr)
        return { ...r, status: 'closed' as const };
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

  const currentMonthStart = useMemo(() => startOfMonth(today), [today]);
  const currentMonthEnd = useMemo(() => endOfMonth(today), [today]);
  const [scale, setScale] = useState<Scale>('month');
  const [baseDate, setBaseDate] = useState(today);
  const [customRangeStart, setCustomRangeStart] = useState(format(currentMonthStart, 'yyyy-MM-dd'));
  const [customRangeEnd, setCustomRangeEnd] = useState(format(currentMonthEnd, 'yyyy-MM-dd'));
  const [selectedRental, setSelectedRental] = useState<GanttRentalData | null>(null);
  const [showReturnModal, setShowReturnModal] = useState(false);
  const [showDowntimeModal, setShowDowntimeModal] = useState(false);
  const [showNewRentalModal, setShowNewRentalModal] = useState(false);
  const [showMovementSheet, setShowMovementSheet] = useState(false);
  const [showApprovalHistorySheet, setShowApprovalHistorySheet] = useState(false);
  const [preselectedEquipmentInv, setPreselectedEquipmentInv] = useState('');
  const [preselectedEquipmentId, setPreselectedEquipmentId] = useState('');
  const [returnRental, setReturnRental] = useState<GanttRentalData | null>(null);
  const [compactView, setCompactView] = useState<CompactView>('cards');
  const [densityMode, setDensityMode] = useState<DensityMode>('comfortable');
  const [movementFilter, setMovementFilter] = useState<'all' | 'shipping' | 'receiving'>('all');

  const appendEquipmentHistoryEntry = useCallback(
    (equipment: Equipment, text: string) =>
      appendAuditHistory(
        equipment,
        createAuditEntry(historyAuthor, text),
      ),
    [historyAuthor],
  );

  // Filters (always live — no explicit "apply" gate needed)
  const [filterModel, setFilterModel] = useState('');
  const [filterManager, setFilterManager] = useState('');
  const [filterClient, setFilterClient] = useState('');
  const [filterUpd, setFilterUpd] = useState('');
  const [filterPayment, setFilterPayment] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [rentalPreset, setRentalPreset] = useState<'all' | 'returns_today' | 'overdue' | 'unpaid' | 'with_service'>('all');
  const [showFiltersDialog, setShowFiltersDialog] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({
    scissor: false,
    articulated: false,
    telescopic: false,
    mast: false,
  });

  // Derived: any filter is currently active
  const hasActiveFilters = !!(filterModel || filterManager || filterClient || filterUpd || filterPayment || filterStatus || rentalPreset !== 'all');
  const hasAdvancedFilters = !!(filterModel || filterManager || filterClient || filterUpd || filterPayment || filterStatus || rentalPreset !== 'all');
  const activeFilterCount = [
    filterModel,
    filterManager,
    filterClient,
    filterUpd,
    filterPayment,
    filterStatus,
    rentalPreset !== 'all' ? rentalPreset : '',
  ].filter(Boolean).length;

  // Refs
  const scrollContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const storageKey = getCompactViewStorageKey(user?.id);
    const savedView = window.localStorage.getItem(storageKey);
    if (savedView === 'cards' || savedView === 'timeline') {
      setCompactView(savedView);
    }
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedGroups = window.localStorage.getItem(getCollapsedGroupsStorageKey(user?.id));
    if (!savedGroups) return;

    try {
      const parsed = JSON.parse(savedGroups) as Partial<Record<string, boolean>>;
      setCollapsedGroups(prev => ({
        ...prev,
        scissor: typeof parsed.scissor === 'boolean' ? parsed.scissor : prev.scissor,
        articulated: typeof parsed.articulated === 'boolean' ? parsed.articulated : prev.articulated,
        telescopic: typeof parsed.telescopic === 'boolean' ? parsed.telescopic : prev.telescopic,
        mast: typeof parsed.mast === 'boolean' ? parsed.mast : prev.mast,
      }));
    } catch {
      // Ignore corrupted local settings and fall back to defaults.
    }
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const savedDensityMode = window.localStorage.getItem(getDensityModeStorageKey(user?.id));
    if (savedDensityMode === 'comfortable' || savedDensityMode === 'compact') {
      setDensityMode(savedDensityMode);
    }
  }, [user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const mediaQuery = window.matchMedia('(min-width: 640px) and (max-width: 1023px)');
    const syncCompactView = () => {
      if (mediaQuery.matches) {
        setCompactView(prev => (prev === 'timeline' ? prev : 'cards'));
        return;
      }
      if (window.innerWidth < 640) {
        setCompactView('cards');
        return;
      }
      setCompactView('timeline');
    };

    syncCompactView();
    mediaQuery.addEventListener('change', syncCompactView);
    window.addEventListener('resize', syncCompactView);
    return () => {
      mediaQuery.removeEventListener('change', syncCompactView);
      window.removeEventListener('resize', syncCompactView);
    };
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getCompactViewStorageKey(user?.id), compactView);
  }, [compactView, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(
      getCollapsedGroupsStorageKey(user?.id),
      JSON.stringify(collapsedGroups),
    );
  }, [collapsedGroups, user?.id]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    window.localStorage.setItem(getDensityModeStorageKey(user?.id), densityMode);
  }, [densityMode, user?.id]);

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
  const rowHeight = densityMode === 'compact' ? 44 : 56;

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

  // ── Filter rentals (always live, no gate) ────────────────────────────────────
  const filteredRentals = useMemo(() => {
    let rentals = [...ganttRentals];
    const inventoryCounts = equipmentList.reduce<Map<string, number>>((map, item) => {
      map.set(item.inventoryNumber, (map.get(item.inventoryNumber) || 0) + 1);
      return map;
    }, new Map());
    if (filterManager) rentals = rentals.filter(r => r.manager === filterManager);
    if (filterClient)  rentals = rentals.filter(r => (r.client || '').toLowerCase().includes(filterClient.toLowerCase()));
    if (filterUpd === 'yes') rentals = rentals.filter(r => r.updSigned);
    if (filterUpd === 'no')  rentals = rentals.filter(r => !r.updSigned);
    if (filterPayment) rentals = rentals.filter(r => r.paymentStatus === filterPayment);
    if (filterStatus && filterStatus !== AVAILABLE_EQUIPMENT_STATUS_FILTER) {
      rentals = rentals.filter(r => r.status === filterStatus);
    }
    const todayStr = format(today, 'yyyy-MM-dd');
    if (rentalPreset === 'returns_today') {
      rentals = rentals.filter(r => r.endDate === todayStr && r.status !== 'returned' && r.status !== 'closed');
    }
    if (rentalPreset === 'overdue') {
      rentals = rentals.filter(r => r.endDate < todayStr && r.status !== 'returned' && r.status !== 'closed');
    }
    if (rentalPreset === 'unpaid') {
      rentals = rentals.filter(r => r.paymentStatus !== 'paid');
    }
    if (rentalPreset === 'with_service') {
      rentals = rentals.filter(r => {
        const inventoryIsUnique = (inventoryCounts.get(r.equipmentInv) || 0) <= 1;
        return serviceTickets.some(ticket =>
          OPEN_SERVICE_STATUSES.includes(ticket.status)
          && (
            (!!r.equipmentId && ticket.equipmentId === r.equipmentId)
            || (!r.equipmentId && inventoryIsUnique && ticket.inventoryNumber === r.equipmentInv)
          ),
        );
      });
    }
    return rentals;
  }, [equipmentList, filterManager, filterClient, filterPayment, filterStatus, filterUpd, ganttRentals, rentalPreset, serviceTickets, today]);

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

  const servicePeriods = useMemo<ServicePeriod[]>(() => {
    return serviceTickets
      .filter(ticket => OPEN_SERVICE_STATUSES.includes(ticket.status))
      .map(ticket => {
        const matchedEquipment = ticket.equipmentId
          ? equipmentList.find(item => item.id === ticket.equipmentId)
          : null;
        const fallbackInventory = ticket.inventoryNumber || matchedEquipment?.inventoryNumber || '';
        const fallbackEquipmentId = fallbackInventory && !ambiguousInventoryNumbers.has(fallbackInventory)
          ? canonicalEquipmentIdByInventory.get(fallbackInventory)
          : undefined;

        return {
          id: ticket.id,
          equipmentId: ticket.equipmentId || fallbackEquipmentId,
          equipmentInv: fallbackInventory,
          startDate: (ticket.createdAt || new Date().toISOString()).slice(0, 10),
          endDate: ticket.closedAt
            ? ticket.closedAt.slice(0, 10)
            : addDays(today, 1).toISOString().slice(0, 10),
          description: ticket.reason || 'Ремонт',
        };
      })
      .filter(period => !!period.equipmentId || !!period.equipmentInv);
  }, [ambiguousInventoryNumbers, canonicalEquipmentIdByInventory, equipmentList, serviceTickets, today]);

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
        (e.model || '').toLowerCase().includes(q) ||
        (e.inventoryNumber || '').toLowerCase().includes(q) ||
        (e.serialNumber || '').toLowerCase().includes(q)
      );
    }
    const hasRentalFilter = !!(
      filterManager ||
      filterClient ||
      filterUpd ||
      filterPayment ||
      (filterStatus && filterStatus !== AVAILABLE_EQUIPMENT_STATUS_FILTER)
    );
    if (hasRentalFilter) {
      eq = eq.filter(e => visibleFilteredRentals.some(r => matchesEquipmentRow(r, e)));
    }
    if (filterStatus === AVAILABLE_EQUIPMENT_STATUS_FILTER) {
      eq = eq.filter(e => {
        const rentalsForEquipment = ganttRentals.filter(r => matchesEquipmentRow(r, e));
        return computeEffectiveStatus(e, rentalsForEquipment, today, { start: viewStart, end: viewEnd }) === 'available';
      });
    }
    return [...eq].sort(compareEquipmentForPlanner);
  }, [equipmentList, filterModel, visibleFilteredRentals, filterManager, filterClient, filterUpd, filterPayment, filterStatus, ganttRentals, matchesEquipmentRow, today, viewEnd, viewStart]);

  const filteredEquipmentGroups = useMemo(() => {
    const grouped = new Map<EquipmentType, Equipment[]>();
    filteredEquipment.forEach(item => {
      const bucket = grouped.get(item.type) ?? [];
      bucket.push(item);
      grouped.set(item.type, bucket);
    });

    return Array.from(grouped.keys())
      .sort((a, b) => (TYPE_LABELS[a] || a).localeCompare(TYPE_LABELS[b] || b, 'ru'))
      .map(type => ({
        type,
        label: TYPE_LABELS[type] || type,
        items: grouped.get(type) ?? [],
      }))
      .filter(group => group.items.length > 0);
  }, [filteredEquipment]);

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
  const shownRentals = filterStatus === AVAILABLE_EQUIPMENT_STATUS_FILTER ? 0 : filteredRentals.length;
  const overviewCounts = useMemo(() => {
    let available = 0;
    let rented = 0;
    let inService = 0;
    let overdue = 0;

    filteredEquipment.forEach(equipment => {
      const rentalsForEquipment = filteredRentals.filter(rental => matchesEquipmentRow(rental, equipment));
      const effectiveStatus = computeEffectiveStatus(equipment, rentalsForEquipment, today, { start: viewStart, end: viewEnd });
      if (effectiveStatus === 'available') available += 1;
      if (effectiveStatus === 'rented' || effectiveStatus === 'reserved') rented += 1;
      if (effectiveStatus === 'in_service') inService += 1;
      if (rentalsForEquipment.some(rental => rental.endDate < format(today, 'yyyy-MM-dd') && rental.status !== 'returned' && rental.status !== 'closed')) {
        overdue += 1;
      }
    });

    return { available, rented, inService, overdue };
  }, [filteredEquipment, filteredRentals, matchesEquipmentRow, today, viewEnd, viewStart]);

  // ===== Handlers =====
  const navigateTime = useCallback((direction: 'prev' | 'next' | 'today') => {
    if (direction === 'today') {
      setBaseDate(today);
      if (scale === 'custom') {
        const start = format(currentMonthStart, 'yyyy-MM-dd');
        const end = format(currentMonthEnd, 'yyyy-MM-dd');
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
  }, [currentMonthEnd, currentMonthStart, customRange, scale, today]);

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
    setRentalPreset('all');
  };

  const toggleRentalPreset = useCallback((preset: 'overdue' | 'unpaid') => {
    setRentalPreset(current => current === preset ? 'all' : preset);
  }, []);

  const toggleGroupCollapsed = useCallback((type: EquipmentType) => {
    setCollapsedGroups(prev => ({
      ...prev,
      [type]: !prev[type],
    }));
  }, []);

  const handleOpenReturn = (rental?: GanttRentalData) => {
    if (!canEditRentals) return;
    setReturnRental(rental || null);
    setShowReturnModal(true);
  };

  const handleOpenDowntime = (equipmentInv?: string) => {
    if (!canEditRentals) return;
    setPreselectedEquipmentInv(equipmentInv || '');
    setShowDowntimeModal(true);
  };

  const handleOpenNewRental = (equipmentId?: string) => {
    setPreselectedEquipmentId(equipmentId || '');
    setShowNewRentalModal(true);
  };

  const rentalPresetOptions = [
    { value: 'all', label: 'Все' },
    { value: 'returns_today', label: 'Возврат сегодня' },
    { value: 'overdue', label: 'Просроченные' },
    { value: 'unpaid', label: 'Без оплаты' },
    { value: 'with_service', label: 'В сервисе' },
  ] as const;

  const quickFilterCounts = useMemo(() => {
    const todayStr = format(today, 'yyyy-MM-dd');
    return {
      returnsToday: ganttRentals.filter(
        rental => rental.endDate === todayStr && rental.status !== 'returned' && rental.status !== 'closed',
      ).length,
      unpaid: ganttRentals.filter(rental => rental.paymentStatus !== 'paid').length,
      overdue: ganttRentals.filter(
        rental => rental.endDate < todayStr && rental.status !== 'returned' && rental.status !== 'closed',
      ).length,
    };
  }, [ganttRentals, today]);

  const movementEntries = useMemo(() => {
    const rentalsById = new Map(ganttRentals.map(rental => [rental.id, rental]));
    const equipmentById = new Map(equipmentList.map(item => [item.id, item]));

    return [...shippingPhotos]
      .filter(event => event.type === 'shipping' || event.type === 'receiving')
      .sort((a, b) => {
        const aTime = new Date(a.date).getTime();
        const bTime = new Date(b.date).getTime();
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return bTime - aTime;
      })
      .map(event => {
        const rental = event.rentalId ? rentalsById.get(event.rentalId) : undefined;
        const equipment = equipmentById.get(event.equipmentId);
        return {
          ...event,
          rental,
          equipment,
          equipmentLabel: getEquipmentMovementLabel(equipment),
          clientLabel: rental?.client || equipment?.currentClient || 'Без клиента',
          typeLabel: event.type === 'shipping' ? 'Отгрузка' : 'Приёмка',
          typeBadgeClassName: event.type === 'shipping'
            ? 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-900/60 dark:bg-blue-950/30 dark:text-blue-300'
            : 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300',
        };
      });
  }, [equipmentList, ganttRentals, shippingPhotos]);

  const filteredMovementEntries = useMemo(
    () => movementEntries.filter(entry => movementFilter === 'all' || entry.type === movementFilter),
    [movementEntries, movementFilter],
  );

  const mobileEquipmentCards = useMemo(() => {
    return filteredEquipment.map(equipment => {
      const rentalsForEquipment = filteredRentals
        .filter(rental => matchesEquipmentRow(rental, equipment))
        .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime());
      const downtimesForEquipment = mockDowntimes.filter(item => item.equipmentInv === equipment.inventoryNumber);
      const serviceForEquipment = servicePeriods.filter(item =>
        item.equipmentId
          ? item.equipmentId === equipment.id
          : item.equipmentInv === equipment.inventoryNumber && !ambiguousInventoryNumbers.has(equipment.inventoryNumber),
      );
      const activeRental = rentalsForEquipment.find(rental => rental.status === 'active');
      const reservedRental = rentalsForEquipment.find(rental => rental.status === 'created');
      const primaryRental = activeRental ?? reservedRental ?? rentalsForEquipment[0] ?? null;
      const effectiveStatus = computeEffectiveStatus(equipment, rentalsForEquipment, today, { start: viewStart, end: viewEnd });
      const statusMeta = EQ_STATUS_LABELS[effectiveStatus] || EQ_STATUS_LABELS.available;

      return {
        equipment,
        rentalsForEquipment,
        downtimesForEquipment,
        serviceForEquipment,
        primaryRental,
        statusMeta,
        conflictCount: conflictSets.get(equipment.id)?.size ?? 0,
      };
    });
  }, [ambiguousInventoryNumbers, conflictSets, filteredEquipment, filteredRentals, matchesEquipmentRow, servicePeriods, today, viewEnd, viewStart]);

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
      clientId: rental.clientId,
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
      r.id === rentalId
        ? appendRentalHistory(
            { ...r, paymentStatus: newPaymentStatus },
            createRentalHistoryEntry(
              historyAuthor,
              `Добавлен платеж: ${amount.toLocaleString('ru-RU')} ₽ от ${paidDate}. Статус оплаты: ${newPaymentStatus === 'paid' ? 'Оплачено' : newPaymentStatus === 'partial' ? 'Частично' : 'Не оплачено'}`,
            ),
          )
        : r
    );
    void persistGanttRentals(updatedRentals);

    // Also update selectedRental to reflect new state
    if (selectedRental?.id === rentalId) {
      setSelectedRental(updatedRentals.find(r => r.id === rentalId) || null);
    }
  }, [canCreatePayments, ganttRentals, historyAuthor, payments, selectedRental]);

  // Extend rental: update endDate, update equipment returnDate
  const handleExtend = useCallback(async (rental: GanttRentalData, newEndDate: string) => {
    if (!canEditRentals || !canEditRentalDates) return;
    if (!isAdminRole) {
      await requestClassicRentalChange(
        rental,
        { plannedReturnDate: newEndDate },
        `Изменение даты возврата из планировщика: ${rental.endDate} → ${newEndDate}`,
      );
      return;
    }
    const previousDays = getRentalDays(rental.startDate, rental.endDate);
    const nextDays = getRentalDays(rental.startDate, newEndDate);
    const inferredDailyRate = previousDays > 0 ? (rental.amount || 0) / previousDays : 0;
    const nextAmount = inferredDailyRate > 0
      ? Math.round(calculateRentalAmount(inferredDailyRate, rental.startDate, newEndDate))
      : rental.amount || 0;
    const rentalPayments = payments.filter(payment => payment.rentalId === rental.id);
    const paidAmount = rentalPayments.length === 0 && rental.paymentStatus === 'paid'
      ? rental.amount || 0
      : rentalPayments.reduce((sum, payment) => {
          if (typeof payment.paidAmount === 'number') return sum + payment.paidAmount;
          if (payment.status === 'paid') return sum + (payment.amount || 0);
          return sum;
        }, 0);
    const nextPaymentStatus: GanttRentalData['paymentStatus'] =
      paidAmount >= nextAmount
        ? 'paid'
        : paidAmount > 0
          ? 'partial'
          : 'unpaid';

    const updatedRentals = ganttRentals.map(r =>
      r.id === rental.id
        ? appendRentalHistory(
            {
              ...r,
              endDate: newEndDate,
              amount: nextAmount,
              paymentStatus: nextPaymentStatus,
            },
            createRentalHistoryEntry(
              historyAuthor,
              `Продлена аренда: ${r.endDate} → ${newEndDate}${nextAmount !== (r.amount || 0) ? ` · сумма ${formatCurrency(r.amount || 0)} → ${formatCurrency(nextAmount)}` : ''}${nextPaymentStatus !== r.paymentStatus ? ` · статус оплаты: ${nextPaymentStatus === 'paid' ? 'Оплачено' : nextPaymentStatus === 'partial' ? 'Частично' : 'Не оплачено'}` : ''}`,
            ),
          )
        : r
    );
    void persistGanttRentals(updatedRentals);

    // Update returnDate on equipment
    const updatedEq = equipmentList.map(e =>
      matchesEquipmentRow(rental, e)
        ? appendEquipmentHistoryEntry(
            { ...e, returnDate: newEndDate },
            `Изменена дата возврата по аренде: ${rental.endDate} → ${newEndDate}`,
          )
        : e
    );
    void persistEquipment(updatedEq);

    // Refresh drawer
    if (selectedRental?.id === rental.id) {
      setSelectedRental(updatedRentals.find(r => r.id === rental.id) || null);
    }
  }, [
    appendEquipmentHistoryEntry,
    canEditRentals,
    canEditRentalDates,
    ganttRentals,
    equipmentList,
    historyAuthor,
    isAdminRole,
    matchesEquipmentRow,
    payments,
    requestClassicRentalChange,
    selectedRental,
  ]);

  // Update UPD signed status + optional date
  const handleUpdChange = useCallback((rental: GanttRentalData, updSigned: boolean, updDate?: string) => {
    if (!canEditRentals) return;
    const updatedRentals = ganttRentals.map(r =>
      r.id === rental.id
        ? appendRentalHistory(
            {
              ...r,
              updSigned,
              updDate: updSigned ? (updDate || r.updDate) : undefined,
            },
            createRentalHistoryEntry(
              historyAuthor,
              updSigned
                ? `УПД отмечен как подписанный${updDate ? ` (${updDate})` : ''}`
                : 'УПД снят с отметки «подписан»',
            ),
          )
        : r
    );
    void persistGanttRentals(updatedRentals);
    if (selectedRental?.id === rental.id) {
      setSelectedRental(updatedRentals.find(r => r.id === rental.id) || null);
    }
  }, [canEditRentals, ganttRentals, historyAuthor, selectedRental]);

  const handleUpdateRental = useCallback(async (rental: GanttRentalData, data: Partial<GanttRentalData>) => {
    if (!canEditRentals) return;
    const nextData = { ...data };
    if (!canEditRentalDates) {
      delete nextData.startDate;
      delete nextData.endDate;
    }

    if (!isAdminRole) {
      const patch: Partial<Rental> = {};
      if (nextData.clientId !== undefined && nextData.clientId !== rental.clientId) patch.clientId = nextData.clientId;
      if (nextData.client !== undefined && nextData.client !== rental.client) patch.client = nextData.client;
      if (nextData.startDate !== undefined && nextData.startDate !== rental.startDate) patch.startDate = nextData.startDate;
      if (nextData.endDate !== undefined && nextData.endDate !== rental.endDate) patch.plannedReturnDate = nextData.endDate;
      if (nextData.manager !== undefined && nextData.manager !== rental.manager) patch.manager = nextData.manager;
      if (nextData.amount !== undefined && nextData.amount !== rental.amount) patch.price = Number(nextData.amount) || 0;

      if (Object.keys(patch).length === 0) {
        showToast('Нет изменений для согласования', 'error');
        return;
      }

      await requestClassicRentalChange(
        rental,
        patch,
        `Изменение аренды из планировщика ${rental.id}`,
      );
      return;
    }

    const previousEquipment = equipmentList.find(e => matchesEquipmentRow(rental, e));
    const nextRental = { ...rental, ...nextData };
    const historyEntries = buildRentalUpdateHistory(rental, nextRental, historyAuthor);
    const updatedRentals = ganttRentals.map(item =>
      item.id === rental.id ? appendRentalHistory(nextRental, ...historyEntries) : item
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
          : appendEquipmentHistoryEntry(
              {
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
              },
              `Обновлено состояние техники из аренды ${rental.id}: статус ${item.status} → ${nextRental.status === 'active' ? 'rented' : nextRental.status === 'created' ? 'reserved' : hasOtherActive ? item.status : nextEquipmentStatus}`,
            )
      );
      void persistEquipment(updatedEquipment);
    }

    if (selectedRental?.id === rental.id) {
      setSelectedRental(nextRental);
    }
  }, [
    appendEquipmentHistoryEntry,
    canEditRentals,
    canEditRentalDates,
    equipmentList,
    ganttRentals,
    historyAuthor,
    isAdminRole,
    matchesEquipmentRow,
    persistEquipment,
    persistGanttRentals,
    requestClassicRentalChange,
    selectedRental,
    serviceTickets,
    showToast,
  ]);

  const handleRestoreRental = useCallback((rental: GanttRentalData) => {
    if (!canRestoreRentals) return;
    const restoredStatus: GanttRentalData['status'] = rental.status === 'closed' ? 'returned' : 'active';
    const updatedRentals = ganttRentals.map(item =>
      item.id === rental.id
        ? appendRentalHistory(
            { ...item, status: restoredStatus },
            createRentalHistoryEntry(
              historyAuthor,
              restoredStatus === 'active'
                ? 'Аренда восстановлена в статус «В аренде»'
                : 'Аренда восстановлена в статус «Возвращена»',
            ),
          )
        : item,
    );
    void persistGanttRentals(updatedRentals);

    if (restoredStatus === 'active') {
      const updatedEquipment = equipmentList.map(item =>
        matchesEquipmentRow(rental, item)
          ? appendEquipmentHistoryEntry(
              {
                ...item,
                status: 'rented' as EquipmentStatus,
                currentClient: rental.client,
                returnDate: rental.endDate,
              },
              `Аренда ${rental.id} восстановлена. Техника снова в аренде у клиента ${rental.client}`,
            )
          : item,
      );
      void persistEquipment(updatedEquipment);
    }

    if (selectedRental?.id === rental.id) {
      setSelectedRental(updatedRentals.find(item => item.id === rental.id) || null);
    }
    showToast(restoredStatus === 'active' ? 'Аренда восстановлена в статус «В аренде»' : 'Аренда восстановлена в статус «Возвращена»');
  }, [appendEquipmentHistoryEntry, canRestoreRentals, ganttRentals, equipmentList, historyAuthor, matchesEquipmentRow, persistEquipment, persistGanttRentals, selectedRental, showToast]);

  const handleAddRentalComment = useCallback((rental: GanttRentalData, text: string) => {
    if (!canEditRentals) return;
    const updatedRentals = ganttRentals.map(item =>
      item.id === rental.id
        ? appendRentalHistory(
            item,
            createRentalHistoryEntry(historyAuthor, text, 'comment'),
          )
        : item
    );
    void persistGanttRentals(updatedRentals);
    if (selectedRental?.id === rental.id) {
      setSelectedRental(updatedRentals.find(item => item.id === rental.id) || null);
    }
    showToast('Запись добавлена в историю аренды');
  }, [canEditRentals, ganttRentals, historyAuthor, persistGanttRentals, selectedRental, showToast]);

  const handleUpdateMaintenanceFilters = useCallback((
    equipment: Equipment,
    data: Pick<Equipment, 'maintenanceEngineFilter' | 'maintenanceFuelFilter' | 'maintenanceHydraulicFilter'>,
  ) => {
    const fieldLabels = {
      maintenanceEngineFilter: 'фильтр двигателя',
      maintenanceFuelFilter: 'фильтр топливной системы',
      maintenanceHydraulicFilter: 'гидравлический фильтр',
    } as const;

    const changedFields = (Object.keys(fieldLabels) as Array<keyof typeof fieldLabels>)
      .filter(key => (equipment[key] || '') !== (data[key] || ''))
      .map(key => `${fieldLabels[key]}: ${data[key] ? `«${data[key]}»` : 'очищен'}`);

    if (changedFields.length === 0) {
      showToast('Изменений по ТО нет');
      return;
    }

    const updatedEquipment = equipmentList.map(item =>
      item.id !== equipment.id
        ? item
        : appendEquipmentHistoryEntry(
            {
              ...item,
              maintenanceEngineFilter: data.maintenanceEngineFilter,
              maintenanceFuelFilter: data.maintenanceFuelFilter,
              maintenanceHydraulicFilter: data.maintenanceHydraulicFilter,
            },
            `Обновлены фильтры ТО: ${changedFields.join('; ')}`,
          ),
    );

    void persistEquipment(updatedEquipment);
    showToast('Фильтры ТО сохранены');
  }, [appendEquipmentHistoryEntry, equipmentList, persistEquipment, showToast]);

  // Early return: set rental endDate to actualReturnDate, status → returned, clear equipment
  const handleEarlyReturn = useCallback(async (rental: GanttRentalData, actualReturnDate: string) => {
    if (!canEditRentals || !canEditRentalDates) return;
    if (!isAdminRole) {
      const ok = await requestClassicRentalChange(
        rental,
        { plannedReturnDate: actualReturnDate },
        `Досрочный возврат из планировщика: ${rental.endDate} → ${actualReturnDate}`,
      );
      if (ok) setSelectedRental(null);
      return;
    }

    const currentEquipment = equipmentList.find(e => matchesEquipmentRow(rental, e));
    const updatedRentals = ganttRentals.map(r =>
      r.id === rental.id
        ? appendRentalHistory(
            { ...r, endDate: actualReturnDate, status: 'returned' as const },
            createRentalHistoryEntry(
              historyAuthor,
              `Оформлен досрочный возврат: дата возврата ${actualReturnDate}`,
            ),
          )
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
          ? appendEquipmentHistoryEntry(
              {
                ...e,
                status: hasOpenServiceTicketForEquipment(serviceTickets, e) ? 'in_service' as EquipmentStatus : 'available' as EquipmentStatus,
                currentClient: undefined,
                returnDate: undefined,
              },
              'Оформлен досрочный возврат техники',
            )
          : e
      );
      void persistEquipment(updatedEq);
    }

    setSelectedRental(null);
  }, [
    appendEquipmentHistoryEntry,
    canEditRentals,
    canEditRentalDates,
    equipmentList,
    ganttRentals,
    historyAuthor,
    isAdminRole,
    matchesEquipmentRow,
    persistEquipment,
    persistGanttRentals,
    requestClassicRentalChange,
    serviceTickets,
  ]);

  // ===== Today line position =====
  const todayOffset = useMemo(() => {
    const diff = differenceInDays(today, viewStart);
    if (diff < 0 || diff > totalDays) return null;
    return diff * dayWidth;
  }, [today, viewStart, totalDays, dayWidth]);

  return (
    <div className="relative flex h-[calc(100vh-56px-64px)] sm:h-[calc(100vh)] flex-col overflow-hidden bg-background">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-64 opacity-80"
        style={{
          background:
            'radial-gradient(55% 80% at 16% 0%, rgba(212,247,74,0.14), transparent 68%), radial-gradient(52% 74% at 86% 10%, rgba(66,232,176,0.1), transparent 72%)',
        }}
      />
      {/* ===== Toolbar ===== */}
      <div className="relative z-10 border-b border-border/80 bg-card/80 shadow-[0_18px_40px_-32px_rgba(15,23,42,0.65)] backdrop-blur-xl">
        <div className="space-y-3 px-4 py-3">
          <div className="flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="space-y-2">
              <div>
                <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
                  Аренды
                </p>
                <h1 className="app-shell-title mt-1 text-3xl font-extrabold tracking-tight text-foreground">
                  Планировщик аренды
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Управление выдачей, возвратами и загрузкой техники в одном таймлайне.
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/80 px-2.5 py-1 text-muted-foreground">
                  <span className="font-semibold text-foreground">{shownEquipment}</span>
                  ед. техники
                </span>
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary/80 px-2.5 py-1 text-muted-foreground">
                  <span className="font-semibold text-foreground">{shownRentals}</span>
                  аренд
                </span>
                <button
                  type="button"
                  onClick={() => toggleRentalPreset('unpaid')}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors',
                    rentalPreset === 'unpaid'
                      ? 'border-blue-400/40 bg-blue-500/20 text-blue-200'
                      : 'border-blue-500/15 bg-blue-500/10 text-blue-300 hover:border-blue-400/30 hover:bg-blue-500/15',
                  )}
                  title="Показать аренды без оплаты"
                >
                  <CreditCard className="h-3.5 w-3.5" />
                  {quickFilterCounts.unpaid} без оплаты
                </button>
                <button
                  type="button"
                  onClick={() => toggleRentalPreset('overdue')}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 transition-colors',
                    rentalPreset === 'overdue'
                      ? 'border-red-400/40 bg-red-500/20 text-red-200'
                      : 'border-red-500/15 bg-red-500/10 text-red-300 hover:border-red-400/30 hover:bg-red-500/15',
                  )}
                  title="Показать просроченные аренды"
                >
                  <AlertTriangle className="h-3.5 w-3.5" />
                  {quickFilterCounts.overdue} просроч.
                </button>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 xl:justify-end">
              {can('create', 'rentals') && (
                <Button size="sm" className="app-button-primary h-10 rounded-xl px-4 shadow-[0_14px_30px_-18px_rgba(212,247,74,0.75)]" onClick={() => handleOpenNewRental()}>
                  <Plus className="h-4 w-4" />
                  Новая аренда
                </Button>
              )}
              {!isInvestorRole && (
                <>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="app-button-outline h-10 rounded-xl px-4"
                    onClick={() => setShowApprovalHistorySheet(true)}
                  >
                    <ClipboardCheck className="h-4 w-4" />
                    Согласование
                    {pendingRentalApprovalCount > 0 && (
                      <span className="ml-1 inline-flex min-w-5 items-center justify-center rounded-full bg-amber-100 px-1.5 text-[11px] font-semibold text-amber-700 dark:bg-amber-900/50 dark:text-amber-200">
                        {pendingRentalApprovalCount}
                      </span>
                    )}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    className="app-button-outline h-10 rounded-xl px-4"
                    onClick={() => setShowMovementSheet(true)}
                  >
                    <ArrowRightLeft className="h-4 w-4" />
                    Движение техники
                  </Button>
                  <Button size="sm" variant="secondary" className="app-button-outline h-10 rounded-xl px-4" onClick={() => handleOpenReturn()}>
                    <RotateCcw className="h-4 w-4" />
                    Возврат техники
                  </Button>
                  <Button size="sm" variant="secondary" className="app-button-ghost h-10 rounded-xl px-4" onClick={() => handleOpenDowntime()}>
                    <PauseCircle className="h-4 w-4" />
                    Отметить простой
                  </Button>
                </>
              )}
            </div>
          </div>

        </div>
      </div>

      <div className="hidden items-center justify-between gap-3 border-b border-gray-200 bg-white px-4 py-2 dark:border-gray-700 dark:bg-gray-800 sm:flex lg:hidden">
        <div>
          <div className="text-sm font-medium text-gray-900 dark:text-white">Режим просмотра</div>
          <div className="text-xs text-gray-500 dark:text-gray-400">
            На планшете можно быстро переключаться между карточками и таймлайном
          </div>
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-gray-50 p-1 dark:border-gray-600 dark:bg-gray-700">
          <button
            type="button"
            onClick={() => setCompactView('cards')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              compactView === 'cards'
                ? 'bg-[--color-primary] text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Карточки
          </button>
          <button
            type="button"
            onClick={() => setCompactView('timeline')}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
              compactView === 'timeline'
                ? 'bg-[--color-primary] text-white'
                : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-600'
            }`}
          >
            Таймлайн
          </button>
        </div>
      </div>

      {/* ===== Filters ===== */}
      <div className="relative z-10 border-b border-border/80 bg-card/70 backdrop-blur-xl">
        <div className="px-4 py-2">
          <div className="rounded-[24px] border border-border bg-card/80 px-4 py-3 shadow-[0_24px_50px_-38px_rgba(15,23,42,0.9)]">
            <button
              type="button"
              onClick={() => setShowFiltersDialog(true)}
              className="flex w-full items-center justify-between gap-4 rounded-[20px] border border-border bg-secondary/70 px-4 py-3 text-left transition-colors hover:bg-secondary"
            >
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold text-foreground">Вид, период и фильтры</span>
                  {activeFilterCount > 0 && (
                    <span className="rounded-full bg-[--color-primary]/12 px-2 py-0.5 text-[11px] font-semibold text-[--color-primary]">
                      {activeFilterCount}
                    </span>
                  )}
                </div>
                <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted-foreground sm:text-sm">
                  <span>{SCALE_CONFIG[scale].label}</span>
                  <span className="text-white/20">•</span>
                  <span>{rangeLabel}</span>
                  <span className="text-white/20">•</span>
                  <span>{densityMode === 'comfortable' ? 'Обычный вид' : 'Компактный вид'}</span>
                  <span className="text-white/20">•</span>
                  <span>{hasAdvancedFilters ? 'Фильтры настроены' : 'Без дополнительных фильтров'}</span>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm font-medium text-foreground">
                <SlidersHorizontal className="h-4 w-4" />
                Настроить
              </div>
            </button>

            <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-gray-100/90 pt-3 text-xs dark:border-white/8">
              <div className="flex flex-wrap items-center gap-3 text-gray-500 dark:text-gray-400">
                <span>{overviewCounts.available} свободно</span>
                <span className="text-gray-300 dark:text-gray-600">•</span>
                <span>{overviewCounts.rented} занято</span>
                <span className="text-gray-300 dark:text-gray-600">•</span>
                <span>{overviewCounts.inService} в сервисе</span>
                <span className="text-gray-300 dark:text-gray-600">•</span>
                <span>{overviewCounts.overdue} просрочено</span>
              </div>

              <div className="text-gray-400 dark:text-gray-500">
                {hasActiveFilters
                  ? `${shownEquipment} из ${totalEquipment} ед. · ${shownRentals} из ${totalRentals} аренд`
                  : `${totalEquipment} ед. · ${totalRentals} аренд`}
              </div>
            </div>

            {hasAdvancedFilters && (
              <div className="mt-2 flex flex-wrap gap-2">
                {filterModel && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50/80 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                    Поиск: {filterModel}
                  </span>
                )}
                {rentalPreset !== 'all' && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50/80 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                    Режим: {rentalPresetOptions.find(item => item.value === rentalPreset)?.label || rentalPreset}
                  </span>
                )}
                {filterManager && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50/80 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                    Менеджер: {filterManager}
                  </span>
                )}
                {filterClient && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50/80 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                    Клиент: {filterClient}
                  </span>
                )}
                {filterUpd && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50/80 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                    УПД: {filterUpd === 'yes' ? 'подписан' : 'не подписан'}
                  </span>
                )}
                {filterPayment && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50/80 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                    Оплата: {PAYMENT_STATUS_FILTERS.find(item => item.value === filterPayment)?.label || filterPayment}
                  </span>
                )}
                {filterStatus && (
                  <span className="inline-flex items-center gap-1 rounded-full border border-blue-200/80 bg-blue-50/80 px-2.5 py-1 text-[11px] font-medium text-blue-700 dark:border-blue-500/20 dark:bg-blue-500/10 dark:text-blue-300">
                    Статус: {RENTAL_STATUS_FILTERS.find(item => item.value === filterStatus)?.label || filterStatus}
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      <Dialog open={showFiltersDialog} onOpenChange={setShowFiltersDialog}>
        <DialogContent className="sm:max-w-[760px]">
          <DialogHeader>
            <DialogTitle>Вид, период и фильтры</DialogTitle>
            <DialogDescription>
              Здесь собраны даты, режим отображения и фильтры парка в одном окне.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-5">
            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-900 dark:text-white">Масштаб таймлайна</div>
              <div className="flex flex-wrap gap-2">
                {(['week', 'month', 'quarter', 'year'] as Scale[]).map(s => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setScale(s)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      scale === s
                        ? 'bg-[--color-primary] text-white shadow-sm'
                        : 'border border-gray-200 bg-slate-50 text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-gray-600 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-300'
                    }`}
                  >
                    {SCALE_CONFIG[s].label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-[1fr_auto]">
              <div>
                <div className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Произвольный период</div>
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                  <input
                    type="date"
                    value={customRangeStart}
                    onChange={e => setCustomRangeStart(e.target.value)}
                    className="h-11 rounded-xl border border-gray-200 bg-slate-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-900/60 dark:text-white"
                  />
                  <span className="hidden text-sm text-gray-400 sm:inline">—</span>
                  <input
                    type="date"
                    value={customRangeEnd}
                    onChange={e => setCustomRangeEnd(e.target.value)}
                    className="h-11 rounded-xl border border-gray-200 bg-slate-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-900/60 dark:text-white"
                  />
                  <Button onClick={applyCustomRange} disabled={!customRange} className="sm:min-w-[110px]">
                    Период
                  </Button>
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Навигация</div>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="secondary" onClick={() => navigateTime('today')}>
                    Сегодня
                  </Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => navigateTime('prev')} className="h-11 w-11 rounded-xl">
                    <ChevronLeft className="h-4 w-4" />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" onClick={() => navigateTime('next')} className="h-11 w-11 rounded-xl">
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
                <div className="mt-2 text-xs text-gray-500 dark:text-gray-400">{rangeLabel}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-900 dark:text-white">Плотность строк</div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setDensityMode('comfortable')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    densityMode === 'comfortable'
                      ? 'bg-[--color-primary] text-white shadow-sm'
                      : 'border border-gray-200 bg-slate-50 text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-gray-600 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-300'
                  }`}
                >
                  Обычный
                </button>
                <button
                  type="button"
                  onClick={() => setDensityMode('compact')}
                  className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                    densityMode === 'compact'
                      ? 'bg-[--color-primary] text-white shadow-sm'
                      : 'border border-gray-200 bg-slate-50 text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-gray-600 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-300'
                  }`}
                >
                  Компактно
                </button>
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Поиск по технике</div>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                <input
                  type="text"
                  placeholder="Модель / INV / SN"
                  value={filterModel}
                  onChange={e => setFilterModel(e.target.value)}
                  className="h-11 w-full rounded-xl border border-gray-200 bg-slate-50 pl-10 pr-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-900/60 dark:text-white"
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="text-sm font-medium text-gray-900 dark:text-white">Быстрый режим</div>
              <div className="flex flex-wrap gap-2">
                {rentalPresetOptions.map(option => (
                  <button
                    key={option.value}
                    type="button"
                    onClick={() => setRentalPreset(option.value)}
                    className={`rounded-full px-3 py-1.5 text-xs font-medium transition-colors ${
                      rentalPreset === option.value
                        ? 'bg-[--color-primary] text-white shadow-sm'
                        : 'border border-gray-200 bg-slate-50 text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-gray-600 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-300'
                    }`}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <div className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Менеджер</div>
                <select
                  value={filterManager}
                  onChange={e => setFilterManager(e.target.value)}
                  className="h-11 w-full rounded-xl border border-gray-200 bg-slate-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-900/60 dark:text-white"
                >
                  <option value="">Все менеджеры</option>
                  {managersList.map(u => (
                    <option key={u.id} value={u.name}>{u.name}</option>
                  ))}
                </select>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Клиент</div>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Название клиента"
                    value={filterClient}
                    onChange={e => setFilterClient(e.target.value)}
                    className="h-11 w-full rounded-xl border border-gray-200 bg-slate-50 pl-10 pr-3 text-sm focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-900/60 dark:text-white"
                  />
                </div>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-gray-900 dark:text-white">УПД</div>
                <select
                  value={filterUpd}
                  onChange={e => setFilterUpd(e.target.value)}
                  className="h-11 w-full rounded-xl border border-gray-200 bg-slate-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-900/60 dark:text-white"
                >
                  <option value="">Любой статус</option>
                  <option value="yes">Подписан</option>
                  <option value="no">Не подписан</option>
                </select>
              </div>

              <div>
                <div className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Статус аренды</div>
                <select
                  value={filterStatus}
                  onChange={e => setFilterStatus(e.target.value)}
                  className="h-11 w-full rounded-xl border border-gray-200 bg-slate-50 px-3 text-sm focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-900/60 dark:text-white"
                >
                  {RENTAL_STATUS_FILTERS.map(f => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
              </div>
            </div>

            <div>
              <div className="mb-2 text-sm font-medium text-gray-900 dark:text-white">Оплата</div>
              <div className="grid gap-2 sm:grid-cols-4">
                {PAYMENT_STATUS_FILTERS.map(f => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFilterPayment(f.value)}
                    className={`rounded-xl border px-3 py-2 text-sm transition-colors ${
                      filterPayment === f.value
                        ? 'border-[--color-primary] bg-[--color-primary] text-white'
                        : 'border-gray-200 bg-slate-50 text-gray-600 hover:border-blue-300 hover:text-blue-700 dark:border-gray-600 dark:bg-gray-900/60 dark:text-gray-300 dark:hover:border-blue-500 dark:hover:text-blue-300'
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <DialogFooter>
            <Button variant="secondary" onClick={resetFilters}>Сбросить</Button>
            <Button onClick={() => setShowFiltersDialog(false)}>Готово</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {ambiguousLegacyRentals.length > 0 && (
        <div className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-xs text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-300">
          Найдена {ambiguousLegacyRentals.length} старая аренда с неоднозначной привязкой к технике по дублирующемуся `INV`.
          Она временно показана только в одной строке, чтобы не размножаться по всем `0`.
          Такую аренду лучше открыть, удалить и создать заново.
        </div>
      )}

      {/* ===== Mobile Compact View ===== */}
      <div className={`flex-1 overflow-auto lg:hidden ${compactView === 'cards' ? 'block sm:block' : 'block sm:hidden'}`}>
        {filteredEquipment.length === 0 ? (
          equipmentList.length === 0 ? (
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="mb-2 text-2xl">🏗️</div>
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
            <div className="flex flex-col items-center justify-center px-6 py-16 text-center">
              <div className="text-sm font-medium text-gray-600 dark:text-gray-300">
                Нет техники по заданным фильтрам
              </div>
              <Button size="sm" variant="ghost" onClick={resetFilters} className="mt-2">
                Сбросить фильтры
              </Button>
            </div>
          )
        ) : (
          <div className="space-y-4 p-4">
            {filteredEquipmentGroups.map(group => (
              <div key={group.type} className="space-y-3">
                <button
                  type="button"
                  onClick={() => toggleGroupCollapsed(group.type)}
                  className="flex w-full items-center justify-between rounded-xl border border-gray-200 bg-white/80 px-3 py-2 text-left transition-colors hover:border-blue-200 hover:bg-white dark:border-gray-700 dark:bg-gray-800/70 dark:hover:border-blue-500/40 dark:hover:bg-gray-800"
                >
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500">Тип техники</div>
                    <div className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">{group.label}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                      {group.items.length}
                    </span>
                    {collapsedGroups[group.type] ? (
                      <ChevronRightSmall className="h-4 w-4 text-gray-400" />
                    ) : (
                      <ChevronDown className="h-4 w-4 text-gray-400" />
                    )}
                  </div>
                </button>
                {!collapsedGroups[group.type] && mobileEquipmentCards
                  .filter(card => card.equipment.type === group.type)
                  .map(({ equipment, primaryRental, rentalsForEquipment, serviceForEquipment, downtimesForEquipment, statusMeta, conflictCount }) => (
              <div
                key={equipment.id}
                className="rounded-xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-[11px] text-gray-500 dark:text-gray-400">
                        {equipment.inventoryNumber}
                      </span>
                      <span className={`inline-flex rounded px-1.5 py-0.5 text-[10px] font-medium ${statusMeta.color}`}>
                        {statusMeta.label}
                      </span>
                    </div>
                    <h3 className="mt-1 truncate text-sm font-semibold text-gray-900 dark:text-white">
                      {equipment.model}
                    </h3>
                    <p className="mt-1 text-[11px] uppercase tracking-[0.04em] text-gray-500 dark:text-gray-400">
                      SN {equipment.serialNumber || 'не указан'} · {TYPE_LABELS[equipment.type] || equipment.type}
                    </p>
                  </div>
                </div>

                <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
                  <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/60">
                    <div className="text-gray-400 dark:text-gray-500">Аренд</div>
                    <div className="mt-1 font-medium text-gray-900 dark:text-white">{rentalsForEquipment.length}</div>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/60">
                    <div className="text-gray-400 dark:text-gray-500">Конфликты</div>
                    <div className={`mt-1 font-medium ${conflictCount > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                      {conflictCount}
                    </div>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/60">
                    <div className="text-gray-400 dark:text-gray-500">Сервис</div>
                    <div className={`mt-1 flex items-center gap-1 font-medium ${serviceForEquipment.length > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                      <Wrench className="h-3.5 w-3.5" />
                      {serviceForEquipment.length}
                    </div>
                  </div>
                  <div className="rounded-lg bg-gray-50 px-3 py-2 dark:bg-gray-900/60">
                    <div className="text-gray-400 dark:text-gray-500">Простой</div>
                    <div className="mt-1 font-medium text-gray-900 dark:text-white">{downtimesForEquipment.length}</div>
                  </div>
                </div>

                {primaryRental ? (
                  <div className="mt-3 rounded-lg border border-gray-200 px-3 py-3 dark:border-gray-700">
                    {primaryRental.status === 'active' && primaryRental.endDate < todayStr && (
                      <div className="mb-2 inline-flex items-center gap-1 rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-medium text-amber-700 dark:bg-amber-900/30 dark:text-amber-300">
                        <CircleAlert className="h-3 w-3" />
                        Срок истёк, возврат не оформлен
                      </div>
                    )}
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium text-gray-900 dark:text-white">
                          {primaryRental.client}
                        </div>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                          {safeRentalDateRangeLabel(primaryRental.startDate, primaryRental.endDate)}
                        </div>
                      </div>
                      <span className={`inline-flex rounded px-2 py-0.5 text-[10px] font-medium ${
                        primaryRental.status === 'active'
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : primaryRental.status === 'created'
                          ? 'bg-slate-100 text-slate-700 dark:bg-slate-700 dark:text-slate-300'
                          : primaryRental.status === 'returned'
                          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      }`}>
                        {RENTAL_STATUS_LABEL[primaryRental.status]}
                      </span>
                    </div>

                    <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                        primaryRental.paymentStatus === 'paid'
                          ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300'
                          : primaryRental.paymentStatus === 'partial'
                          ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-300'
                          : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
                      }`}>
                        <CreditCard className="h-3 w-3" />
                        {primaryRental.paymentStatus === 'paid' ? 'Оплачено' : primaryRental.paymentStatus === 'partial' ? 'Частично' : 'Без оплаты'}
                      </span>
                      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 ${
                        primaryRental.updSigned
                          ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
                          : 'bg-gray-100 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      }`}>
                        {primaryRental.updSigned ? <CircleCheck className="h-3 w-3" /> : <CircleAlert className="h-3 w-3" />}
                        {primaryRental.updSigned ? 'УПД подписан' : 'УПД не подписан'}
                      </span>
                    </div>
                  </div>
                ) : (
                  <div className="mt-3 rounded-lg border border-dashed border-gray-200 px-3 py-3 text-xs text-gray-500 dark:border-gray-700 dark:text-gray-400">
                    По выбранному периоду аренды для этой техники не найдены.
                  </div>
                )}

                <div className="mt-3 flex flex-wrap gap-2">
                  {primaryRental && (
                    <Button size="sm" variant="secondary" onClick={() => setSelectedRental(primaryRental)}>
                      Открыть аренду
                    </Button>
                  )}
                  {can('create', 'rentals') && (
                    <Button size="sm" onClick={() => handleOpenNewRental(equipment.id)}>
                      <Plus className="h-3.5 w-3.5" />
                      Новая аренда
                    </Button>
                  )}
                  {primaryRental?.status === 'active' && (
                    <Button size="sm" variant="secondary" onClick={() => handleOpenReturn(primaryRental)}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Возврат
                    </Button>
                  )}
                </div>
              </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* ===== Gantt Grid ===== */}
      <div
        ref={scrollContainerRef}
        className={`hidden flex-1 overflow-auto ${compactView === 'timeline' ? 'sm:block' : 'sm:hidden'} lg:block`}
      >
        <div style={{ width: LEFT_PANEL_WIDTH + timelineWidth, minHeight: '100%' }}>
          {/* ===== Timeline Header (sticky top) ===== */}
          <div className="sticky top-0 z-20 flex border-b border-white/50 bg-white/84 shadow-[0_18px_36px_-32px_rgba(15,23,42,0.9)] backdrop-blur-xl dark:border-white/8 dark:bg-slate-900/62">
            {/* Left header */}
            <div
              className="sticky left-0 z-30 flex shrink-0 items-center border-r border-white/50 bg-white/92 px-4 dark:border-white/8 dark:bg-slate-900/72"
              style={{ width: LEFT_PANEL_WIDTH }}
            >
              <div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.22em] text-gray-400 dark:text-gray-500">
                  Техника
                </div>
                <div className="mt-1 text-sm font-medium text-gray-900 dark:text-white">
                  {shownEquipment}
                  <span className="ml-1 text-xs font-normal text-gray-400 dark:text-gray-500">единиц в списке</span>
                </div>
              </div>
            </div>

            {/* Month row + Day row combined */}
            <div className="flex flex-col" style={{ width: timelineWidth }}>
              {/* Month row */}
              <div className="flex border-b border-gray-100/90 dark:border-white/8">
                {monthGroups.map((mg, idx) => (
                  <div
                    key={idx}
                    className="border-r border-gray-100/60 px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.18em] text-gray-400 dark:border-white/8 dark:text-gray-500"
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
                      className={`flex shrink-0 flex-col items-center justify-center border-r border-gray-100/60 dark:border-white/8 ${
                        isToday ? 'bg-blue-50/55 dark:bg-blue-500/12' : weekend ? 'bg-gray-50/45 dark:bg-white/[0.03]' : ''
                      } ${densityMode === 'compact' ? 'py-1' : 'py-1.5'}`}
                      style={{ width: dayWidth }}
                    >
                      {scale === 'week' || (scale === 'custom' && totalDays <= 31) ? (
                        <>
                          <span className={`text-[10px] ${isToday ? 'font-semibold text-blue-600 dark:text-blue-300' : 'text-gray-400'}`}>
                            {format(day, 'EEEEEE', { locale: ru })}
                          </span>
                          <span className={`text-xs ${isToday ? 'font-semibold text-blue-700 dark:text-blue-200' : 'text-gray-600 dark:text-gray-400'}`}>
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
            filteredEquipmentGroups.map(group => (
              <React.Fragment key={group.type}>
                <button
                  type="button"
                  onClick={() => toggleGroupCollapsed(group.type)}
                  className="flex w-full border-b border-white/50 bg-white/54 text-left transition-colors hover:bg-white/70 dark:border-white/8 dark:bg-slate-900/46 dark:hover:bg-slate-900/62"
                >
                  <div
                    className={`sticky left-0 z-10 flex shrink-0 items-center border-r border-white/50 bg-white/72 px-4 backdrop-blur-xl dark:border-white/8 dark:bg-slate-900/72 ${densityMode === 'compact' ? 'py-1.5' : 'py-2.5'}`}
                    style={{ width: LEFT_PANEL_WIDTH }}
                  >
                    <div className="flex items-center gap-2">
                      {collapsedGroups[group.type] ? (
                        <ChevronRightSmall className="h-4 w-4 text-gray-400" />
                      ) : (
                        <ChevronDown className="h-4 w-4 text-gray-400" />
                      )}
                      <span className="text-sm font-semibold text-gray-900 dark:text-white">{group.label}</span>
                      <span className="rounded-full border border-gray-200/80 bg-white/80 px-2 py-0.5 text-[11px] font-medium text-gray-500 shadow-sm dark:border-white/10 dark:bg-white/8 dark:text-gray-300">
                        {group.items.length}
                      </span>
                    </div>
                  </div>
                  <div
                    className={`flex items-center px-3 text-[10px] uppercase tracking-[0.16em] text-gray-400 dark:text-gray-500 ${densityMode === 'compact' ? 'py-1.5' : 'py-2'}`}
                    style={{ width: timelineWidth }}
                  >
                    {group.label} · {group.items.length} ед.
                  </div>
                </button>

                {!collapsedGroups[group.type] && group.items.map((eq, idx) => (
                  <EquipmentRow
                    key={eq.id}
                    rowIndex={idx}
                    equipment={eq}
                    rentals={filteredRentals.filter(r => matchesEquipmentRow(r, eq))}
                    downtimes={mockDowntimes.filter(d => d.equipmentInv === eq.inventoryNumber)}
                    servicePeriods={servicePeriods.filter(s =>
                      s.equipmentId
                        ? s.equipmentId === eq.id
                        : s.equipmentInv === eq.inventoryNumber && !ambiguousInventoryNumbers.has(eq.inventoryNumber)
                    )}
                    conflictIds={conflictSets.get(eq.id) || new Set()}
                    viewStart={viewStart}
                    totalDays={totalDays}
                    dayWidth={dayWidth}
                    densityMode={densityMode}
                    rowHeight={rowHeight}
                    todayOffset={todayOffset}
                    viewEnd={viewEnd}
                    scale={scale}
                    days={days}
                    today={today}
                    paymentFractions={rentalPaidFractions}
                    onBarClick={setSelectedRental}
                    onNewRental={() => handleOpenNewRental(eq.id)}
                    onReturn={(rental) => handleOpenReturn(rental)}
                    onDowntime={() => handleOpenDowntime(eq.inventoryNumber)}
                  />
                ))}
              </React.Fragment>
            ))
          )}
        </div>
      </div>

      <div className="sticky bottom-0 z-20 border-t border-gray-200 bg-white/95 px-4 py-3 backdrop-blur dark:border-gray-700 dark:bg-gray-800/95 sm:hidden">
        <button
          type="button"
          onClick={() => setShowFiltersDialog(true)}
          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-gray-200 bg-gray-50 px-4 py-3 text-left transition-colors hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-700 dark:hover:bg-gray-600"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-gray-900 dark:text-white">Вид и период</span>
              {activeFilterCount > 0 && (
                <span className="rounded-full bg-[--color-primary]/10 px-1.5 py-0.5 text-[10px] font-semibold text-[--color-primary]">
                  {activeFilterCount}
                </span>
              )}
            </div>
            <div className="mt-1 truncate text-xs text-gray-500 dark:text-gray-300">
              {SCALE_CONFIG[scale].label} · {rangeLabel} · {densityMode === 'comfortable' ? 'Обычный' : 'Компактный'}
            </div>
          </div>
          <SlidersHorizontal className="h-4 w-4 shrink-0 text-gray-500 dark:text-gray-300" />
        </button>
      </div>

      {/* ===== Drawer ===== */}
      {selectedRental && (
        <RentalDrawer
          rental={selectedRental}
          equipment={equipmentList.find(e => matchesEquipmentRow(selectedRental, e))}
          allRentals={ganttRentals}
          payments={payments}
          clients={computedClients}
          clientReceivables={clientReceivables}
          managers={managersList}
          canEditRentals={canEditRentals}
          canEditRentalDates={canEditRentalDates}
          dateConflictsRequireApproval={!isAdminRole}
          canReassignManager={user?.role === 'Администратор'}
          canRestoreRentals={canRestoreRentals}
          canDeleteRentals={canDeleteRentals}
          canCreatePayments={canCreatePayments}
          onClose={() => setSelectedRental(null)}
          onAddPayment={handleAddPayment}
          onExtend={handleExtend}
          onEarlyReturn={handleEarlyReturn}
          onUpdChange={handleUpdChange}
          onUpdateMaintenanceFilters={handleUpdateMaintenanceFilters}
          onRestore={handleRestoreRental}
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
                r.id === rental.id
                  ? appendRentalHistory(
                      { ...r, status: nextStatus! },
                      createRentalHistoryEntry(
                        historyAuthor,
                        nextStatus === 'active'
                          ? 'Аренда переведена в статус «В аренде»'
                          : 'Аренда закрыта',
                      ),
                    )
                  : r,
              );
              void persistGanttRentals(updated);

              // При активации аренды — техника "В аренде" + заполняем клиента и дату возврата
              if (nextStatus === 'active') {
                const newEqList = equipmentList.map(e =>
                  matchesEquipmentRow(rental, e)
                    ? appendEquipmentHistoryEntry(
                        { ...e, status: 'rented' as EquipmentStatus, currentClient: rental.client, returnDate: rental.endDate },
                        `Техника выдана в аренду клиенту ${rental.client}`,
                      )
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
                      ? appendEquipmentHistoryEntry(
                          {
                            ...e,
                            status: hasOpenServiceTicketForEquipment(serviceTickets, e) ? 'in_service' as EquipmentStatus : 'available' as EquipmentStatus,
                            currentClient: undefined,
                            returnDate: undefined,
                          },
                          'Аренда закрыта, техника освобождена',
                        )
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
            void (async () => {
              const updatedRentals = ganttRentals.filter(item => item.id !== rental.id);
              const updatedPayments = payments.filter(item => item.rentalId !== rental.id);
              const currentEquipment = equipmentList.find(item => matchesEquipmentRow(rental, item));

              try {
                await rentalsService.deleteGanttEntry(rental.id);

                const classicRentals = await rentalsService.getAll();
                const linkedClassicRentals = classicRentals.filter(item =>
                  (item.clientId && rental.clientId ? item.clientId === rental.clientId : item.client === rental.client)
                  && item.startDate === rental.startDate
                  && item.plannedReturnDate === rental.endDate
                  && item.equipment.includes(rental.equipmentInv),
                );

                if (linkedClassicRentals.length > 0) {
                  await Promise.all(linkedClassicRentals.map(item => rentalsService.delete(item.id)));
                }

                if (updatedPayments.length !== payments.length) {
                  await paymentsService.bulkReplace(updatedPayments);
                }

                setGanttRentals(updatedRentals);
                setPayments(updatedPayments);

                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
                  queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.all }),
                  queryClient.invalidateQueries({ queryKey: PAYMENT_KEYS.all }),
                ]);

                if (currentEquipment) {
                  const nextEquipmentRental = updatedRentals
                    .filter(item =>
                      matchesEquipmentRow(item, currentEquipment)
                      && item.status !== 'returned'
                      && item.status !== 'closed',
                    )
                    .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];

                  const nextStatus: EquipmentStatus = nextEquipmentRental
                    ? (nextEquipmentRental.status === 'active' ? 'rented' : 'reserved')
                    : (hasOpenServiceTicketForEquipment(serviceTickets, currentEquipment) ? 'in_service' : 'available');

                  const historyText = `Аренда ${rental.id} удалена администратором`;
                  const newEqList = equipmentList.map(item =>
                    item.id === currentEquipment.id
                      ? appendEquipmentHistoryEntry(
                          {
                            ...item,
                            status: nextStatus,
                            currentClient: nextEquipmentRental?.client,
                            returnDate: nextEquipmentRental?.endDate,
                          },
                          historyText,
                        )
                      : item,
                  );

                  setEquipmentList(newEqList);
                  await equipmentService.bulkReplace(newEqList);
                  await queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all });
                }

                setSelectedRental(null);
                showToast('Аренда удалена', 'success');
              } catch {
                await Promise.all([
                  queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
                  queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.all }),
                  queryClient.invalidateQueries({ queryKey: PAYMENT_KEYS.all }),
                  queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
                ]);
                showToast('Не удалось удалить аренду', 'error');
              }
            })();
          }}
          onUpdate={handleUpdateRental}
          onAddComment={handleAddRentalComment}
        />
      )}

      {/* ===== Modals ===== */}
        <ReturnModal
          open={showReturnModal}
          rental={returnRental}
          ganttRentals={ganttRentals}
          onClose={() => { setShowReturnModal(false); setReturnRental(null); }}
          onConfirm={async (data) => {
          if (!canEditRentals) return;
          const ganttRentalId = data.ganttRentalId || data.rentalId;
          const rental = ganttRentals.find(r => r.id === ganttRentalId);
          if (!rental) {
            showToast('Не найдена аренда для возврата. Обновите планировщик и повторите действие.', 'error');
            return;
          }
          if (!isAdminRole) {
            const ok = await requestClassicRentalChange(
              rental,
              { actualReturnDate: data.returnDate },
              `Возврат техники из планировщика: ${rental.endDate} → ${data.returnDate}`,
            );
            if (ok) {
              setShowReturnModal(false);
              setReturnRental(null);
            }
            return;
          }
          // Обновляем статус аренды на 'returned'
          const updated = ganttRentals.map(r =>
            r.id === ganttRentalId
              ? appendRentalHistory(
                  { ...r, status: 'returned' as const },
                  createRentalHistoryEntry(
                    historyAuthor,
                    data.result === 'service'
                      ? 'Техника принята с аренды и отправлена в сервис'
                      : 'Техника принята с аренды и возвращена в парк',
                  ),
                )
              : r,
          );
          void persistGanttRentals(updated);

          // Обновляем статус техники, если нет других активных аренд
          if (rental) {
            const currentEquipment = equipmentList.find(e => matchesEquipmentRow(rental, e));
            const hasOtherActive = updated.some(
              r =>
                !!currentEquipment
                && r.id !== ganttRentalId
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
                  ? appendEquipmentHistoryEntry(
                      { ...e, status: newStatus, currentClient: undefined, returnDate: undefined },
                      data.result === 'service'
                        ? 'Техника принята с аренды и передана в сервис'
                        : 'Техника принята с аренды и возвращена в свободный парк',
                    )
                  : e,
              );
              void persistEquipment(newEqList);
            }

            if (data.result === 'service' && currentEquipment) {
              const hasOpenTicket = serviceTickets.some(ticket => (
                ticket.equipmentId === currentEquipment.id
                || (
                  ticket.inventoryNumber === currentEquipment.inventoryNumber
                  && ticket.serialNumber === currentEquipment.serialNumber
                )
              ) && ticket.status !== 'closed');

              if (!hasOpenTicket) {
                const nowIso = new Date().toISOString();
                await serviceTicketsService.create({
                  equipmentId: currentEquipment.id,
                  equipment: `${currentEquipment.manufacturer} ${currentEquipment.model} (INV: ${currentEquipment.inventoryNumber})`,
                  inventoryNumber: currentEquipment.inventoryNumber,
                  serialNumber: currentEquipment.serialNumber,
                  equipmentType: currentEquipment.type,
                  equipmentTypeLabel: TYPE_LABELS[currentEquipment.type] || currentEquipment.type,
                  location: currentEquipment.location,
                  reason: 'Приёмка с аренды',
                  description: `Техника принята с аренды из планировщика аренды. Требуется осмотр и дефектовка после возврата.`,
                  priority: 'medium',
                  sla: '24 ч',
                  assignedTo: undefined,
                  assignedMechanicId: undefined,
                  assignedMechanicName: undefined,
                  createdBy: historyAuthor,
                  createdByUserId: user?.id,
                  createdByUserName: historyAuthor,
                  reporterContact: rental.client || historyAuthor,
                  source: 'system',
                  status: 'new',
                  result: undefined,
                  resultData: {
                    summary: '',
                    partsUsed: [],
                    worksPerformed: [],
                  },
                  workLog: [
                    {
                      date: nowIso,
                      text: 'Заявка автоматически создана после приёмки техники с аренды',
                      author: historyAuthor,
                      type: 'status_change',
                    },
                  ],
                  parts: [],
                  createdAt: nowIso,
                  photos: [],
                  archived: false,
                });
                await queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all });
              }
            }
          }
          showToast(`Возврат оформлен: ${rental?.equipmentInv ?? ganttRentalId}`);
          setShowReturnModal(false);
          setReturnRental(null);
        }}
      />
        <DowntimeModal
          open={showDowntimeModal}
          preselectedEquipment={preselectedEquipmentInv}
          onClose={() => setShowDowntimeModal(false)}
        onConfirm={async (data) => {
          if (!canEditRentals) return;
          const affectedRentals = ganttRentals.filter(rental =>
            rental.equipmentInv === data.equipmentInv &&
            rental.status !== 'returned' &&
            rental.status !== 'closed' &&
            dateRangesOverlap(rental.startDate, rental.endDate, data.startDate, data.endDate)
          );
          if (affectedRentals.length !== 1) {
            showToast(
              affectedRentals.length > 1
                ? 'Найдено несколько аренд для простоя. Откройте нужную аренду и повторите действие.'
                : 'Не найдена аренда для простоя в выбранный период.',
              'error',
            );
            return;
          }

          if (!isAdminRole) {
            const downtimeDays = getRentalDays(data.startDate, data.endDate);
            const ok = await requestClassicRentalChange(
              affectedRentals[0],
              {
                downtimeDays,
                downtimeReason: data.reason,
              } as Partial<Rental>,
              `Простой техники ${data.equipmentInv}: ${data.startDate} → ${data.endDate}. ${data.reason}`,
            );
            if (ok) setShowDowntimeModal(false);
            return;
          }

          showToast('Простой зафиксирован');
          setShowDowntimeModal(false);
        }}
      />
        <NewRentalModal
          open={showNewRentalModal}
          preselectedEquipmentId={preselectedEquipmentId}
          ganttRentals={ganttRentals}
          equipmentList={equipmentList}
        onClose={() => setShowNewRentalModal(false)}
        onConfirm={async (data) => {
          // Если аренда начинается сегодня или в прошлом — сразу 'active',
          // иначе 'created' (будущая аренда / бронь)
          const todayStr = format(today, 'yyyy-MM-dd');
          const initialStatus: GanttRentalData['status'] =
            (data.startDate || '') <= todayStr ? 'active' : 'created';

          const newRental: Omit<GanttRentalData, 'id'> = {
            clientId: data.clientId,
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
            comments: [
              buildRentalCreationHistory(
                {
                  client: data.client || '',
                  startDate: data.startDate || '',
                  endDate: data.endDate || '',
                  status: initialStatus,
                },
                historyAuthor,
              ),
            ],
          };

          try {
            // Сохраняем и "классическую" аренду, чтобы она была видна в связанных разделах и карточках.
            const savedClassicRental = await rentalsService.create({
              clientId: data.clientId,
              client: data.client || '',
              contact: '',
              startDate: data.startDate || '',
              plannedReturnDate: data.endDate || '',
              equipment: [data.equipmentInv || ''],
              rate: data.amount && data.startDate && data.endDate
                ? `${Math.round(data.amount / Math.max(1, getRentalDays(data.startDate, data.endDate)))} ₽/день`
                : '0 ₽/день',
              price: data.amount || 0,
              discount: 0,
              deliveryAddress: '',
              manager: data.manager || '',
              status: 'new',
              comments: '',
            });
            const savedRental = await rentalsService.createGanttEntry({
              ...newRental,
              rentalId: savedClassicRental.id,
            });

            setGanttRentals((prev) => [...prev, savedRental]);
            await queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt });
            await queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.all });

            // Синхронизируем статус техники + клиента и дату возврата на основе initialStatus аренды
            if (data.equipmentId) {
              const eqStatus: EquipmentStatus = initialStatus === 'active' ? 'rented' : 'reserved';
              const newEqList = equipmentList.map(e => {
                if (e.id !== data.equipmentId) return e;
                return appendEquipmentHistoryEntry(
                  {
                    ...e,
                    status: eqStatus,
                    currentClient: initialStatus === 'active' ? savedRental.client : e.currentClient,
                    returnDate: initialStatus === 'active' ? savedRental.endDate : e.returnDate,
                  },
                  initialStatus === 'active'
                    ? `Создана и сразу активирована аренда для клиента ${savedRental.client}`
                    : `Создана бронь под клиента ${savedRental.client}`,
                );
              });
              await persistEquipment(newEqList);
            }

            showToast(`Аренда создана: ${savedRental.id} — ${data.client} (${data.equipmentInv})`);
            setShowNewRentalModal(false);
          } catch (error) {
            const message = error instanceof Error ? error.message : 'Не удалось создать аренду';
            showToast(message, 'error');
          }
        }}
      />
      <RentalApprovalHistorySheet
        open={showApprovalHistorySheet}
        onOpenChange={setShowApprovalHistorySheet}
        requests={rentalApprovalRequests}
        isLoading={isRentalApprovalsLoading}
        error={rentalApprovalsError}
      />
      <Sheet open={showMovementSheet} onOpenChange={setShowMovementSheet}>
        <SheetContent side="right" className="w-full overflow-y-auto border-gray-200 bg-white sm:max-w-2xl dark:border-gray-700 dark:bg-gray-950">
          <SheetHeader className="border-b border-gray-200 pb-4 dark:border-gray-700">
            <SheetTitle>Движение техники</SheetTitle>
            <SheetDescription>
              История фактических отгрузок и приёмок по аренде. Технику можно открыть прямо из списка.
            </SheetDescription>
          </SheetHeader>

          <div className="flex flex-1 flex-col gap-4 p-4">
            <div className="flex flex-wrap items-center gap-2">
              {[
                { value: 'all' as const, label: `Все (${movementEntries.length})` },
                {
                  value: 'shipping' as const,
                  label: `Отгрузки (${movementEntries.filter(entry => entry.type === 'shipping').length})`,
                },
                {
                  value: 'receiving' as const,
                  label: `Приёмки (${movementEntries.filter(entry => entry.type === 'receiving').length})`,
                },
              ].map(filterOption => (
                <button
                  key={filterOption.value}
                  type="button"
                  onClick={() => setMovementFilter(filterOption.value)}
                  className={`rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
                    movementFilter === filterOption.value
                      ? 'border-[--color-primary] bg-[--color-primary]/12 text-[--color-primary]'
                      : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-300 dark:hover:border-gray-600 dark:hover:text-white'
                  }`}
                >
                  {filterOption.label}
                </button>
              ))}
            </div>

            {filteredMovementEntries.length === 0 ? (
              <div className="rounded-2xl border border-dashed border-gray-300 bg-gray-50 px-6 py-10 text-center text-sm text-gray-500 dark:border-gray-700 dark:bg-gray-900/60 dark:text-gray-400">
                В истории пока нет событий для выбранного фильтра.
              </div>
            ) : (
              <div className="space-y-3">
                {filteredMovementEntries.map(entry => (
                  <div
                    key={entry.id}
                    className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900"
                  >
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={`inline-flex items-center rounded-full border px-2.5 py-1 text-xs font-semibold ${entry.typeBadgeClassName}`}>
                            {entry.typeLabel}
                          </span>
                          <span className="text-xs text-muted-foreground">
                            {safeMovementDateLabel(entry.date)}
                          </span>
                        </div>

                        <div className="space-y-1">
                          <Link
                            to={`/equipment/${entry.equipmentId}`}
                            className="inline-flex items-center gap-1 text-sm font-semibold text-[--color-primary] hover:underline"
                            onClick={() => setShowMovementSheet(false)}
                          >
                            {entry.equipmentLabel}
                          </Link>
                          <div className="text-sm text-gray-600 dark:text-gray-300">
                            Клиент: <span className="font-medium text-gray-900 dark:text-white">{entry.clientLabel}</span>
                          </div>
                          <div className="text-sm text-gray-600 dark:text-gray-300">
                            Оформил: <span className="font-medium text-gray-900 dark:text-white">{entry.uploadedBy || 'Не указано'}</span>
                          </div>
                          {entry.rental && (
                            <div className="text-sm text-gray-600 dark:text-gray-300">
                              Период аренды: <span className="font-medium text-gray-900 dark:text-white">{safeRentalDateRangeLabel(entry.rental.startDate, entry.rental.endDate)}</span>
                            </div>
                          )}
                          {entry.comment && (
                            <div className="text-sm text-gray-600 dark:text-gray-300">
                              Комментарий: <span className="text-gray-900 dark:text-white">{entry.comment}</span>
                            </div>
                          )}
                        </div>
                      </div>

                      <div className="text-xs text-muted-foreground">
                        Фото: {entry.photos.length}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
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
  rowIndex: number;
  equipment: Equipment;
  rentals: GanttRentalData[];
  downtimes: DowntimePeriod[];
  servicePeriods: ServicePeriod[];
  conflictIds: Set<string>;
  viewStart: Date;
  totalDays: number;
  dayWidth: number;
  densityMode: DensityMode;
  rowHeight: number;
  todayOffset: number | null;
  paymentFractions: Map<string, number>;
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
  rowIndex,
  equipment, rentals, downtimes, servicePeriods, conflictIds,
  viewStart, totalDays, dayWidth, densityMode, rowHeight, todayOffset, viewEnd, scale, days, today,
  onBarClick, onNewRental, onReturn, onDowntime, paymentFractions,
}: EquipmentRowProps) {
  const { can: canDo } = usePermissions();
  const isCompact = densityMode === 'compact';
  const todayStr = format(today, 'yyyy-MM-dd');
  // Статус вычисляется динамически из аренд, а не из equipment.status
  const effectiveStatus = computeEffectiveStatus(equipment, rentals, today, { start: viewStart, end: viewEnd });
  const eqStatus = EQ_STATUS_LABELS[effectiveStatus] || EQ_STATUS_LABELS.available;
  const activeRental = rentals.find(r => r.status === 'active');
  const timelineWidth = totalDays * dayWidth;
  const hasServiceBars = servicePeriods.length > 0;
  const hasDowntimeBars = downtimes.length > 0;
  const hasOverlayBars = hasServiceBars || hasDowntimeBars;
  const overlayBarHeight = rentals.length > 0
    ? (isCompact ? 16 : 20)
    : (isCompact ? 22 : 28);
  const overlayBarTop = rentals.length > 0
    ? (isCompact ? 4 : 6)
    : Math.round((rowHeight - overlayBarHeight) / 2);
  const rentalBarHeight = hasOverlayBars
    ? (isCompact ? 18 : 22)
    : (isCompact ? 24 : 30);
  const rentalStackGap = isCompact ? 1 : 2;

  return (
    <div
      className={`group flex border-b border-white/40 dark:border-white/6 ${rowIndex % 2 === 0 ? 'bg-white/[0.03] dark:bg-white/[0.01]' : 'bg-slate-50/34 dark:bg-white/[0.015]'}`}
      style={{ minHeight: rowHeight }}
    >
      {/* Left panel */}
      <div
        className="sticky left-0 z-10 flex shrink-0 items-center border-r border-white/45 bg-white/90 px-3 backdrop-blur-xl transition-colors group-hover:bg-white dark:border-white/8 dark:bg-slate-900/68 dark:group-hover:bg-slate-900/82"
        style={{ width: LEFT_PANEL_WIDTH }}
      >
        <div className="min-w-0 flex-1">
          <div className={`flex items-center ${isCompact ? 'gap-1' : 'gap-1.5'}`}>
            <span className={`truncate font-semibold text-gray-900 dark:text-white ${isCompact ? 'text-[12px]' : 'text-[13px]'}`}>{equipment.model}</span>
            <span className={`shrink-0 rounded-full bg-slate-100 font-mono text-gray-500 dark:bg-white/8 dark:text-gray-400 ${isCompact ? 'px-1.5 py-0.5 text-[9px]' : 'px-1.5 py-0.5 text-[10px]'}`}>{equipment.inventoryNumber}</span>
            <span className={`inline-flex shrink-0 rounded-full font-medium ${eqStatus.color} ${isCompact ? 'px-1.5 py-0.5 text-[9px]' : 'px-2 py-0.5 text-[10px]'}`}>
              {eqStatus.label}
            </span>
          </div>
          <div className={`mt-0.5 flex items-center text-gray-500 dark:text-gray-400 ${isCompact ? 'gap-1 text-[9px]' : 'gap-1.5 text-[10px]'}`}>
            <span className="truncate uppercase tracking-[0.08em]">SN {equipment.serialNumber || 'не указан'}</span>
          </div>
        </div>
        {/* Quick actions */}
        <div className="ml-2 flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100">
          {canDo('create', 'rentals') && (
            <button
              onClick={onNewRental}
              className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-blue-50 hover:text-blue-600 dark:hover:bg-blue-900/30 dark:hover:text-blue-400"
              title="Создать аренду"
            >
              <Plus className="h-3 w-3" />
            </button>
          )}
          {activeRental && (
            <button
              onClick={() => {
                if (activeRental) onReturn(activeRental);
              }}
              className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-green-50 hover:text-green-600 dark:hover:bg-green-900/30 dark:hover:text-green-400"
              title="Оформить возврат по строке"
              aria-label="Оформить возврат по строке"
            >
              <RotateCcw className="h-3 w-3" />
            </button>
          )}
          <button
            onClick={onDowntime}
            className="rounded-lg p-1 text-gray-400 transition-colors hover:bg-amber-50 hover:text-amber-600 dark:hover:bg-amber-900/30 dark:hover:text-amber-400"
            title="Отметить простой"
          >
            <PauseCircle className="h-3 w-3" />
          </button>
        </div>
      </div>

      {/* Timeline area */}
      <div className="relative" style={{ width: timelineWidth, height: rowHeight }}>
        {/* Day grid lines */}
        {days.map((day, idx) => {
          const weekend = isWeekend(day);
          const isToday = isSameDay(day, today);
          return (
            <div
              key={idx}
              className={`absolute top-0 h-full border-r border-gray-200/30 dark:border-gray-700/30 ${
                weekend ? 'bg-gray-100/14 dark:bg-gray-800/10' : ''
              } ${isToday ? 'bg-blue-50/28 dark:bg-blue-900/10' : ''}`}
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
              className="absolute z-[7] flex items-center overflow-hidden rounded-md px-1.5 text-[10px] font-medium text-red-700 shadow-sm dark:text-red-200"
              style={{
                left: pos.left + 2,
                width: pos.width,
                top: overlayBarTop,
                height: overlayBarHeight,
                background: 'linear-gradient(90deg, rgba(254,226,226,0.92), rgba(254,242,242,0.82))',
                border: '1px solid rgba(220,38,38,0.28)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55)',
              }}
              title={`Ремонт / сервис: ${sp.description}`}
            >
              <div className="absolute inset-y-0 left-0 w-1 bg-red-500/85 dark:bg-red-400/85" />
              <Wrench className="mr-1 ml-1 h-3 w-3 shrink-0" />
              {pos.width > 64 && (
                <span className="truncate">
                  <span className="mr-1 uppercase tracking-[0.08em] text-red-500/90 dark:text-red-300/90">Сервис</span>
                  {sp.description}
                </span>
              )}
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
              className="absolute z-[7] flex items-center overflow-hidden rounded-md px-1.5 text-[10px] font-medium text-amber-800 shadow-sm dark:text-amber-200"
              style={{
                left: pos.left + 2,
                width: pos.width,
                top: overlayBarTop,
                height: overlayBarHeight,
                background: 'linear-gradient(90deg, rgba(254,243,199,0.94), rgba(255,251,235,0.84))',
                border: '1px solid rgba(217,119,6,0.24)',
                boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.55)',
              }}
              title={`Простой: ${dt.reason}`}
            >
              <div className="absolute inset-y-0 left-0 w-1 bg-amber-500/85 dark:bg-amber-400/85" />
              <PauseCircle className="mr-1 ml-1 h-3 w-3 shrink-0" />
              {pos.width > 72 && (
                <span className="truncate">
                  <span className="mr-1 uppercase tracking-[0.08em] text-amber-600/90 dark:text-amber-300/90">Простой</span>
                  {dt.reason || 'без причины'}
                </span>
              )}
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
          const barHeight = rentalBarHeight;
          const topOffset = hasOverlayBars
            ? Math.max(isCompact ? 4 : 6, rowHeight - (isCompact ? 4 : 6) - barHeight - stackIndex * (barHeight + rentalStackGap))
            : rentals.length === 1
              ? Math.round((rowHeight - barHeight) / 2)
              : (isCompact ? 4 : 6) + stackIndex * (barHeight + rentalStackGap);

          const paidFraction = paymentFractions.get(rental.id) ?? (rental.paymentStatus === 'paid' ? 1 : 0);
          const showUpdAlert = !rental.updSigned;
          const showPaymentAlert = rental.paymentStatus !== 'paid';
          const showOverdueAlert = rental.status === 'active' && rental.endDate < todayStr;

          return (
            <div
              key={rental.id}
              onClick={() => onBarClick(rental)}
              className={`absolute z-[6] flex cursor-pointer items-center overflow-hidden rounded-lg shadow-sm transition-all hover:shadow-lg hover:-translate-y-[1px] ${barColor} ${
                isConflict ? 'ring-2 ring-red-500 ring-offset-1 dark:ring-red-400' : ''
              }`}
              style={{
                left: pos.left + 1,
                width: pos.width - 2,
                top: topOffset,
                height: barHeight,
              }}
              title={`${rental.client || 'Без клиента'} · ${safeRentalCompactDate(rental.startDate)} — ${safeRentalCompactDate(rental.endDate)} · ${statusLabel}${
                showOverdueAlert ? ' · Срок истёк, возврат не оформлен' : ''
              }${
                showUpdAlert ? ' · УПД не подписан' : ''
              }${
                showPaymentAlert ? ` · ${rental.paymentStatus === 'partial' ? 'Частично оплачено' : 'Не оплачено'}` : ''
              }`}
            >
              <div className="pointer-events-none absolute inset-x-0 top-0 h-px bg-white/20" />

              {/* Payment fill overlay */}
              {paidFraction > 0 && (
                <div
                  className="pointer-events-none absolute inset-y-0 left-0"
                  style={{
                    width: `${paidFraction * 100}%`,
                    background: paidFraction >= 1
                      ? 'rgba(255,255,255,0.16)'
                      : 'rgba(255,255,255,0.10)',
                    borderRight: paidFraction < 1
                      ? '1px dashed rgba(255,255,255,0.35)'
                      : undefined,
                  }}
                />
              )}
              {/* Bar content */}
              <div className={`relative flex min-w-0 flex-1 items-center overflow-hidden leading-tight ${isCompact ? 'px-1.5' : 'px-2'}`}>
                <div className={`flex min-w-0 items-center ${isCompact ? 'gap-1' : 'gap-1.5'}`}>
                  {isConflict && (
                    <AlertTriangle className="h-3 w-3 shrink-0 text-red-200" />
                  )}
                  {showOverdueAlert && pos.width > 58 && (
                    <span className={`shrink-0 rounded-full bg-amber-200/90 font-semibold uppercase tracking-[0.08em] text-amber-900 ${isCompact ? 'px-1 py-0.5 text-[7px]' : 'px-1.5 py-0.5 text-[8px]'}`}>
                      Просрочено
                    </span>
                  )}
                  {pos.width > 58 && (
                    <span className={`shrink-0 rounded-full bg-black/12 font-semibold uppercase tracking-[0.08em] text-white/90 ${isCompact ? 'px-1 py-0.5 text-[7px]' : 'px-1.5 py-0.5 text-[8px]'}`}>
                      {statusLabel}
                    </span>
                  )}
                  {pos.width > 40 && (
                    <span className={`truncate font-medium text-white ${isCompact ? 'text-[9px]' : 'text-[10px]'}`}>
                      {rental.clientShort || rental.client || 'Без клиента'}
                    </span>
                  )}
                </div>
              </div>
              {/* Right icons */}
              <div className={`mr-1.5 flex shrink-0 items-center ${isCompact ? 'gap-0.5' : 'gap-1'}`}>
                {pos.width > 72 && (
                  <>
                    {showOverdueAlert && (
                      <CircleAlert className="h-3.5 w-3.5 text-amber-200" title="Срок истёк, возврат не оформлен" />
                    )}
                    {showUpdAlert && (
                      <CircleAlert className="h-3.5 w-3.5 text-amber-200" title="УПД не подписан" />
                    )}
                    {showPaymentAlert && (
                      <CreditCard
                        className={`h-3.5 w-3.5 ${rental.paymentStatus === 'partial' ? 'text-amber-200' : 'text-red-200'}`}
                        title={rental.paymentStatus === 'partial' ? 'Частично оплачено' : 'Не оплачено'}
                      />
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
