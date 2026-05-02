import React, { useState, useMemo, useCallback, useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Button } from '../components/ui/button';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell,
} from 'recharts';
import { RefreshCw, Truck, BarChart2, Wrench, TrendingUp, Download } from 'lucide-react';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '../components/ui/tabs';
import { formatCurrency } from '../lib/utils';
import { assessServiceRisk } from '../lib/serviceRisk';
import {
  buildClientDebtAgingRows,
  buildClientFinancialSnapshots,
  buildManagerReceivables,
  buildOverdueBuckets,
  buildRentalDebtRows,
  getRentalDebtOverdueDays,
} from '../lib/finance';
import { getServiceScenarioLabel } from '../lib/serviceScenarios';
import {
  calculateCurrentFleetUtilization,
  calculateMonthlyFleetUtilization,
} from '../lib/fleetUtilization';
import type { Equipment, ServiceTicket } from '../types';
import type { GanttRentalData } from '../mock-data';
import ManagerReport from './ManagerReport';
import { equipmentService } from '../services/equipment.service';
import { reportsService, type MechanicFieldTripRow, type MechanicsWorkloadReport } from '../services/reports.service';
import { clientsService } from '../services/clients.service';
import { paymentsService } from '../services/payments.service';
import { rentalsService } from '../services/rentals.service';
import { serviceTicketsService } from '../services/service-tickets.service';
import { EQUIPMENT_KEYS } from '../hooks/useEquipment';
import { RENTAL_KEYS } from '../hooks/useRentals';
import { SERVICE_TICKET_KEYS } from '../hooks/useServiceTickets';

// ─── helpers ────────────────────────────────────────────────────────────────

function formatTs(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function minutesAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 60000);
  if (diff < 1) return 'только что';
  if (diff === 1) return '1 мин. назад';
  if (diff < 60) return `${diff} мин. назад`;
  return `${Math.floor(diff / 60)} ч. назад`;
}

const MONTH_LABELS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];

function lastNMonths(n: number) {
  const now = new Date();
  const result: { year: number; month: number; label: string }[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    result.push({ year: d.getFullYear(), month: d.getMonth(), label: MONTH_LABELS[d.getMonth()] });
  }
  return result;
}

// ─── data types ─────────────────────────────────────────────────────────────

// ─── constants ───────────────────────────────────────────────────────────────

const TICKET_STATUS_LABELS: Record<string, string> = {
  new: 'Новые заявки',
  in_progress: 'В ремонте',
  waiting_parts: 'Ожидание запчастей',
  ready: 'Готово к выдаче',
};

const TICKET_STATUS_COLORS: Record<string, string> = {
  new: '#3b82f6',
  in_progress: '#ef4444',
  waiting_parts: '#f59e0b',
  ready: '#22c55e',
};

const FALLBACK_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#22c55e', '#8b5cf6', '#6b7280'];
const SERVICE_REPORT_PRESETS_KEY = 'service_report_presets_v1';

interface ServiceReportPreset {
  id: string;
  name: string;
  filters: {
    serviceDateFrom: string;
    serviceDateTo: string;
    serviceMechanic: string;
    serviceScenario: string;
    serviceStatus: string;
    serviceEquipmentType: string;
    serviceWorkCategory: string;
    servicePartName: string;
  };
}

// ─── empty state ─────────────────────────────────────────────────────────────

function EmptyChart({ message }: { message: string }) {
  return (
    <div className="flex h-[250px] flex-col items-center justify-center gap-3 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-full bg-gray-100 dark:bg-gray-700">
        <BarChart2 className="h-7 w-7 text-gray-400 dark:text-gray-500" />
      </div>
      <p className="max-w-[240px] text-sm text-gray-500 dark:text-gray-400">{message}</p>
    </div>
  );
}

function downloadFile(content: BlobPart, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function escapeCsv(value: string | number) {
  return `"${String(value).replace(/"/g, '""')}"`;
}

function escapeXml(value: string | number) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function formatServiceStatus(status: string) {
  return TICKET_STATUS_LABELS[status] ?? status ?? '—';
}

function formatDelta(current: number, previous: number, suffix = '') {
  const diff = current - previous;
  const sign = diff > 0 ? '+' : '';
  return `${sign}${diff.toFixed(suffix ? 1 : 0)}${suffix}`;
}

// ─── main component ───────────────────────────────────────────────────────────

export default function Reports() {
  const queryClient = useQueryClient();
  const [loadedAt, setLoadedAt] = useState(Date.now());
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [serviceDateFrom, setServiceDateFrom] = useState('');
  const [serviceDateTo, setServiceDateTo] = useState('');
  const [serviceMechanic, setServiceMechanic] = useState('all');
  const [serviceScenario, setServiceScenario] = useState('all');
  const [serviceStatus, setServiceStatus] = useState('all');
  const [serviceEquipmentType, setServiceEquipmentType] = useState('all');
  const [serviceWorkCategory, setServiceWorkCategory] = useState('all');
  const [servicePartName, setServicePartName] = useState('all');
  const [servicePresetId, setServicePresetId] = useState('none');
  const [activeTab, setActiveTab] = useState('analytics');
  const [servicePresets, setServicePresets] = useState<ServiceReportPreset[]>([]);
  const { data: equipment = [] } = useQuery<Equipment[]>({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
  });
  const { data: ganttRentals = [] } = useQuery<GanttRentalData[]>({
    queryKey: RENTAL_KEYS.gantt,
    queryFn: rentalsService.getGanttData,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ['clients'],
    queryFn: clientsService.getAll,
  });
  const { data: payments = [] } = useQuery({
    queryKey: ['payments'],
    queryFn: paymentsService.getAll,
  });
  const { data: tickets = [] } = useQuery<ServiceTicket[]>({
    queryKey: SERVICE_TICKET_KEYS.all,
    queryFn: serviceTicketsService.getAll,
  });
  const { data: mechanicWorkload } = useQuery<MechanicsWorkloadReport>({
    queryKey: ['reports', 'mechanicsWorkload'],
    queryFn: reportsService.getMechanicsWorkload,
  });

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SERVICE_REPORT_PRESETS_KEY);
      if (raw) setServicePresets(JSON.parse(raw) as ServiceReportPreset[]);
    } catch {
      setServicePresets([]);
    }
  }, []);

  const persistPresets = useCallback((next: ServiceReportPreset[]) => {
    setServicePresets(next);
    localStorage.setItem(SERVICE_REPORT_PRESETS_KEY, JSON.stringify(next));
  }, []);

  const serviceMechanicOptions = useMemo(() => {
    const names = Array.from(new Set((mechanicWorkload?.summary ?? []).map(item => item.mechanicName))).sort((a, b) => a.localeCompare(b, 'ru'));
    return names;
  }, [mechanicWorkload]);

  const serviceStatusOptions = useMemo(() => {
    const statuses = Array.from(new Set((mechanicWorkload?.rows ?? []).map(item => item.repairStatus).filter(Boolean)));
    return statuses.sort((a, b) => formatServiceStatus(a).localeCompare(formatServiceStatus(b), 'ru'));
  }, [mechanicWorkload]);

  const serviceScenarioOptions = useMemo(() => {
    const scenarios = Array.from(new Set((mechanicWorkload?.rows ?? []).map(item => item.serviceKind).filter(Boolean)));
    return scenarios.sort((a, b) => getServiceScenarioLabel(a).localeCompare(getServiceScenarioLabel(b), 'ru'));
  }, [mechanicWorkload]);

  const serviceEquipmentTypeOptions = useMemo(() => {
    const types = Array.from(new Set((mechanicWorkload?.rows ?? []).map(item => item.equipmentTypeLabel || item.equipmentType).filter(Boolean)));
    return types.sort((a, b) => a.localeCompare(b, 'ru'));
  }, [mechanicWorkload]);

  const serviceWorkCategoryOptions = useMemo(() => {
    const categories = Array.from(new Set((mechanicWorkload?.rows ?? []).map(item => item.workCategory).filter(Boolean)));
    return categories.sort((a, b) => a.localeCompare(b, 'ru'));
  }, [mechanicWorkload]);

  const servicePartOptions = useMemo(() => {
    const names = Array.from(new Set((mechanicWorkload?.rows ?? []).flatMap(item => item.partNames).filter(Boolean)));
    return names.sort((a, b) => a.localeCompare(b, 'ru'));
  }, [mechanicWorkload]);

  const financeDebtRows = useMemo(
    () => buildRentalDebtRows(ganttRentals, payments),
    [ganttRentals, payments],
  );
  const financeClientSnapshots = useMemo(
    () => buildClientFinancialSnapshots(clients, ganttRentals, payments),
    [clients, ganttRentals, payments],
  );
  const financeManagerSnapshots = useMemo(
    () => buildManagerReceivables(financeDebtRows, undefined, clients),
    [financeDebtRows, clients],
  );
  const financeOverdueBuckets = useMemo(
    () => buildOverdueBuckets(financeDebtRows),
    [financeDebtRows],
  );
  const financeClientDebtAgingRows = useMemo(
    () => buildClientDebtAgingRows(clients, financeDebtRows),
    [clients, financeDebtRows],
  );
  const financeTotals = useMemo(() => ({
    debt: financeClientSnapshots.reduce((sum, item) => sum + item.currentDebt, 0),
    overdueClients: financeClientSnapshots.filter(item => item.overdueRentals > 0).length,
    exceededClients: financeClientSnapshots.filter(item => item.exceededLimit).length,
    unpaidRentals: financeDebtRows.length,
    overdueDebt: financeManagerSnapshots.reduce((sum, item) => sum + item.overdueDebt, 0),
  }), [financeClientSnapshots, financeDebtRows, financeManagerSnapshots]);

  const filteredMechanicRows = useMemo(() => {
    const rows = mechanicWorkload?.rows ?? [];
    return rows.filter(row => {
      if (serviceMechanic !== 'all' && row.mechanicName !== serviceMechanic) return false;
      if (serviceScenario !== 'all' && row.serviceKind !== serviceScenario) return false;
      if (serviceStatus !== 'all' && row.repairStatus !== serviceStatus) return false;
      if (serviceEquipmentType !== 'all' && (row.equipmentTypeLabel || row.equipmentType) !== serviceEquipmentType) return false;
      if (serviceWorkCategory !== 'all' && row.workCategory !== serviceWorkCategory) return false;
      if (servicePartName !== 'all' && !row.partNames.includes(servicePartName)) return false;
      const created = row.createdAt ? row.createdAt.slice(0, 10) : '';
      if (serviceDateFrom && created && created < serviceDateFrom) return false;
      if (serviceDateTo && created && created > serviceDateTo) return false;
      return true;
    });
  }, [mechanicWorkload, serviceDateFrom, serviceDateTo, serviceMechanic, serviceScenario, serviceStatus, serviceEquipmentType, serviceWorkCategory, servicePartName]);

  const filteredFieldTrips = useMemo(() => {
    const trips = mechanicWorkload?.fieldTrips ?? [];
    return trips.filter((trip: MechanicFieldTripRow) => {
      if (serviceMechanic !== 'all' && trip.mechanicName !== serviceMechanic) return false;
      if (serviceScenario !== 'all' && trip.serviceKind !== serviceScenario) return false;
      if (serviceStatus !== 'all' && trip.repairStatus !== serviceStatus) return false;
      if (serviceEquipmentType !== 'all' && (trip.equipmentTypeLabel || trip.equipmentType) !== serviceEquipmentType) return false;
      if (serviceWorkCategory !== 'all') return false;
      if (servicePartName !== 'all') return false;
      const created = trip.createdAt ? trip.createdAt.slice(0, 10) : '';
      if (serviceDateFrom && created && created < serviceDateFrom) return false;
      if (serviceDateTo && created && created > serviceDateTo) return false;
      return true;
    });
  }, [mechanicWorkload, serviceDateFrom, serviceDateTo, serviceMechanic, serviceScenario, serviceStatus, serviceEquipmentType, serviceWorkCategory, servicePartName]);

  const filteredMechanicSummary = useMemo(() => {
    const map = new Map<string, {
      mechanicId: string;
      mechanicName: string;
      repairs: Set<string>;
      worksCount: number;
      totalNormHours: number;
      fieldTripCount: number;
      fieldTripDistanceKm: number;
      fieldTripNormHours: number;
      equipment: Set<string>;
      partsCost: number;
    }>();

    for (const row of filteredMechanicRows) {
      const key = row.mechanicId || row.mechanicName;
      if (!map.has(key)) {
        map.set(key, {
          mechanicId: row.mechanicId,
          mechanicName: row.mechanicName,
          repairs: new Set(),
          worksCount: 0,
          totalNormHours: 0,
          fieldTripCount: 0,
          fieldTripDistanceKm: 0,
          fieldTripNormHours: 0,
          equipment: new Set(),
          partsCost: 0,
        });
      }
      const item = map.get(key)!;
      item.repairs.add(row.repairId);
      item.worksCount += row.quantity;
      item.totalNormHours += row.totalNormHours;
      if (row.equipmentId) item.equipment.add(row.equipmentId);
      item.partsCost += row.partsCost;
    }

    for (const trip of filteredFieldTrips) {
      const key = trip.mechanicId || trip.mechanicName;
      if (!map.has(key)) {
        map.set(key, {
          mechanicId: trip.mechanicId,
          mechanicName: trip.mechanicName,
          repairs: new Set(),
          worksCount: 0,
          totalNormHours: 0,
          fieldTripCount: 0,
          fieldTripDistanceKm: 0,
          fieldTripNormHours: 0,
          equipment: new Set(),
          partsCost: 0,
        });
      }
      const item = map.get(key)!;
      if (trip.repairId) item.repairs.add(trip.repairId);
      item.fieldTripCount += 1;
      item.fieldTripDistanceKm += trip.distanceKm;
      item.fieldTripNormHours += trip.closedNormHours;
      if (trip.equipmentId) item.equipment.add(trip.equipmentId);
    }

    return [...map.values()]
      .map(item => ({
        mechanicId: item.mechanicId,
        mechanicName: item.mechanicName,
        repairsCount: item.repairs.size,
        worksCount: item.worksCount,
        totalNormHours: Number(item.totalNormHours.toFixed(2)),
        fieldTripCount: item.fieldTripCount,
        fieldTripDistanceKm: Number(item.fieldTripDistanceKm.toFixed(2)),
        fieldTripNormHours: Number(item.fieldTripNormHours.toFixed(2)),
        totalClosedNormHours: Number((item.totalNormHours + item.fieldTripNormHours).toFixed(2)),
        partsCost: Number(item.partsCost.toFixed(2)),
        equipmentCount: item.equipment.size,
      }))
      .sort((a, b) => b.totalClosedNormHours - a.totalClosedNormHours);
  }, [filteredFieldTrips, filteredMechanicRows]);

  const equipmentServiceSummary = useMemo(() => {
    const map = new Map<string, {
      equipmentId: string;
      equipmentLabel: string;
      equipmentTypeLabel: string;
      inventoryNumber: string;
      serialNumber: string;
      repairs: Set<string>;
      mechanics: Set<string>;
      worksCount: number;
      totalNormHours: number;
      partsCost: number;
    }>();

    for (const row of filteredMechanicRows) {
      const key = row.equipmentId || `${row.inventoryNumber}-${row.serialNumber}`;
      if (!map.has(key)) {
        map.set(key, {
          equipmentId: row.equipmentId,
          equipmentLabel: row.equipmentLabel,
          equipmentTypeLabel: row.equipmentTypeLabel || row.equipmentType,
          inventoryNumber: row.inventoryNumber,
          serialNumber: row.serialNumber,
          repairs: new Set(),
          mechanics: new Set(),
          worksCount: 0,
          totalNormHours: 0,
          partsCost: 0,
        });
      }
      const item = map.get(key)!;
      item.repairs.add(row.repairId);
      item.mechanics.add(row.mechanicName);
      item.worksCount += row.quantity;
      item.totalNormHours += row.totalNormHours;
      item.partsCost += row.partsCost;
    }

    return [...map.values()]
      .map(item => ({
        equipmentId: item.equipmentId,
        equipmentLabel: item.equipmentLabel,
        equipmentTypeLabel: item.equipmentTypeLabel,
        inventoryNumber: item.inventoryNumber,
        serialNumber: item.serialNumber,
        repairsCount: item.repairs.size,
        mechanicsCount: item.mechanics.size,
        worksCount: item.worksCount,
        totalNormHours: Number(item.totalNormHours.toFixed(2)),
        partsCost: Number(item.partsCost.toFixed(2)),
      }))
      .sort((a, b) => b.totalNormHours - a.totalNormHours);
  }, [filteredMechanicRows]);

  const topServiceWorks = useMemo(() => {
    const map = new Map<string, { name: string; category: string; count: number; totalNormHours: number }>();
    for (const row of filteredMechanicRows) {
      const key = `${row.workName}__${row.workCategory}`;
      if (!map.has(key)) {
        map.set(key, { name: row.workName, category: row.workCategory, count: 0, totalNormHours: 0 });
      }
      const item = map.get(key)!;
      item.count += row.quantity;
      item.totalNormHours += row.totalNormHours;
    }
    return [...map.values()]
      .map(item => ({ ...item, totalNormHours: Number(item.totalNormHours.toFixed(2)) }))
      .sort((a, b) => b.count - a.count || b.totalNormHours - a.totalNormHours)
      .slice(0, 10);
  }, [filteredMechanicRows]);

  const topServiceParts = useMemo(() => {
    const map = new Map<string, { name: string; repairs: Set<string>; rows: number; partsCost: number }>();
    for (const row of filteredMechanicRows) {
      for (const partName of row.partNames) {
        if (!map.has(partName)) {
          map.set(partName, { name: partName, repairs: new Set(), rows: 0, partsCost: 0 });
        }
        const item = map.get(partName)!;
        item.repairs.add(row.repairId);
        item.rows += 1;
        item.partsCost += row.partsCost;
      }
    }
    return [...map.values()]
      .map(item => ({
        name: item.name,
        repairsCount: item.repairs.size,
        rowsCount: item.rows,
        partsCost: Number(item.partsCost.toFixed(2)),
      }))
      .sort((a, b) => b.repairsCount - a.repairsCount || b.partsCost - a.partsCost)
      .slice(0, 10);
  }, [filteredMechanicRows]);

  const serviceRepairCount = useMemo(() => new Set(filteredMechanicRows.map(row => row.repairId)).size, [filteredMechanicRows]);
  const filteredRepairIds = useMemo(() => new Set(filteredMechanicRows.map(row => row.repairId)), [filteredMechanicRows]);
  const serviceFieldTripCount = filteredFieldTrips.length;
  const serviceFieldTripDistance = useMemo(
    () => filteredFieldTrips.reduce((sum, trip) => sum + trip.distanceKm, 0),
    [filteredFieldTrips],
  );
  const serviceFieldTripNormHours = useMemo(
    () => filteredFieldTrips.reduce((sum, trip) => sum + trip.closedNormHours, 0),
    [filteredFieldTrips],
  );
  const serviceRepairNormHours = useMemo(
    () => filteredMechanicRows.reduce((sum, row) => sum + row.totalNormHours, 0),
    [filteredMechanicRows],
  );
  const serviceTotalClosedNormHours = serviceRepairNormHours + serviceFieldTripNormHours;
  const serviceAverageNormHoursPerRepair = serviceRepairCount === 0
    ? 0
    : serviceRepairNormHours / serviceRepairCount;
  const serviceAveragePartsCostPerRepair = serviceRepairCount === 0
    ? 0
    : filteredMechanicRows.reduce((sum, row) => sum + row.partsCost, 0) / serviceRepairCount;
  const serviceAverageWorksPerRepair = serviceRepairCount === 0
    ? 0
    : filteredMechanicRows.reduce((sum, row) => sum + row.quantity, 0) / serviceRepairCount;

  const serviceComparison = useMemo(() => {
    const now = new Date();
    const currentStart = serviceDateFrom || new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
    const currentEnd = serviceDateTo || now.toISOString().slice(0, 10);

    const startDate = new Date(currentStart);
    const endDate = new Date(currentEnd);
    const durationDays = Math.max(1, Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1);

    const previousEndDate = new Date(startDate);
    previousEndDate.setDate(previousEndDate.getDate() - 1);
    const previousStartDate = new Date(previousEndDate);
    previousStartDate.setDate(previousStartDate.getDate() - (durationDays - 1));

    const previousStart = previousStartDate.toISOString().slice(0, 10);
    const previousEnd = previousEndDate.toISOString().slice(0, 10);

    const previousRows = (mechanicWorkload?.rows ?? []).filter(row => {
      if (serviceMechanic !== 'all' && row.mechanicName !== serviceMechanic) return false;
      if (serviceScenario !== 'all' && row.serviceKind !== serviceScenario) return false;
      if (serviceStatus !== 'all' && row.repairStatus !== serviceStatus) return false;
      if (serviceEquipmentType !== 'all' && (row.equipmentTypeLabel || row.equipmentType) !== serviceEquipmentType) return false;
      if (serviceWorkCategory !== 'all' && row.workCategory !== serviceWorkCategory) return false;
      if (servicePartName !== 'all' && !row.partNames.includes(servicePartName)) return false;
      const created = row.createdAt ? row.createdAt.slice(0, 10) : '';
      return created >= previousStart && created <= previousEnd;
    });
    const previousTrips = (mechanicWorkload?.fieldTrips ?? []).filter(trip => {
      if (serviceMechanic !== 'all' && trip.mechanicName !== serviceMechanic) return false;
      if (serviceScenario !== 'all' && trip.serviceKind !== serviceScenario) return false;
      if (serviceStatus !== 'all' && trip.repairStatus !== serviceStatus) return false;
      if (serviceEquipmentType !== 'all' && (trip.equipmentTypeLabel || trip.equipmentType) !== serviceEquipmentType) return false;
      if (serviceWorkCategory !== 'all') return false;
      if (servicePartName !== 'all') return false;
      const created = trip.createdAt ? trip.createdAt.slice(0, 10) : '';
      return created >= previousStart && created <= previousEnd;
    });

    const previousRepairCount = new Set(previousRows.map(row => row.repairId)).size;
    const previousNormHours = previousRows.reduce((sum, row) => sum + row.totalNormHours, 0);
    const previousPartsCost = previousRows.reduce((sum, row) => sum + row.partsCost, 0);
    const previousFieldTripCount = previousTrips.length;
    const previousFieldTripNormHours = previousTrips.reduce((sum, trip) => sum + trip.closedNormHours, 0);
    const previousFieldTripDistance = previousTrips.reduce((sum, trip) => sum + trip.distanceKm, 0);

    return {
      currentStart,
      currentEnd,
      previousStart,
      previousEnd,
      currentRepairCount: serviceRepairCount,
      previousRepairCount,
      currentNormHours: serviceRepairNormHours,
      previousNormHours,
      currentFieldTripCount: serviceFieldTripCount,
      previousFieldTripCount,
      currentFieldTripNormHours: serviceFieldTripNormHours,
      previousFieldTripNormHours,
      currentFieldTripDistance: serviceFieldTripDistance,
      previousFieldTripDistance,
      currentClosedNormHours: serviceTotalClosedNormHours,
      previousClosedNormHours: previousNormHours + previousFieldTripNormHours,
      currentPartsCost: filteredMechanicRows.reduce((sum, row) => sum + row.partsCost, 0),
      previousPartsCost,
    };
  }, [
    filteredMechanicRows,
    mechanicWorkload,
    serviceFieldTripCount,
    serviceFieldTripDistance,
    serviceFieldTripNormHours,
    serviceDateFrom,
    serviceDateTo,
    serviceEquipmentType,
    serviceMechanic,
    serviceRepairNormHours,
    serviceScenario,
    servicePartName,
    serviceRepairCount,
    serviceStatus,
    serviceTotalClosedNormHours,
    serviceWorkCategory,
  ]);

  const filteredRepeatFailures = useMemo(() => {
    const items = mechanicWorkload?.repeatFailures ?? [];
    return items.filter(item => {
      const createdDates = item.createdDates.map(date => date.slice(0, 10));
      if (serviceMechanic !== 'all' && !item.mechanicNames.includes(serviceMechanic)) return false;
      if (serviceScenario !== 'all' && item.serviceKind !== serviceScenario) return false;
      if (serviceStatus !== 'all' && !item.repairStatuses.includes(serviceStatus)) return false;
      if (serviceEquipmentType !== 'all' && (item.equipmentTypeLabel || item.equipmentType) !== serviceEquipmentType) return false;
      if (serviceWorkCategory !== 'all' && !item.workCategories.includes(serviceWorkCategory)) return false;
      if (servicePartName !== 'all' && !item.partNames.includes(servicePartName)) return false;
      if (serviceDateFrom && serviceDateTo && !createdDates.some(date => date >= serviceDateFrom && date <= serviceDateTo)) return false;
      if (serviceDateFrom && !serviceDateTo && !createdDates.some(date => date >= serviceDateFrom)) return false;
      if (serviceDateTo && !serviceDateFrom && !createdDates.some(date => date <= serviceDateTo)) return false;
      return true;
    });
  }, [
    mechanicWorkload,
    serviceDateFrom,
    serviceDateTo,
    serviceEquipmentType,
    serviceMechanic,
    serviceScenario,
    servicePartName,
    serviceStatus,
    serviceWorkCategory,
  ]);

  const serviceScenarioSummary = useMemo(() => {
    const map = new Map<string, { scenario: string; repairIds: Set<string>; totalNormHours: number; totalPartsCost: number }>();
    for (const row of filteredMechanicRows) {
      if (!map.has(row.serviceKind)) {
        map.set(row.serviceKind, {
          scenario: row.serviceKind,
          repairIds: new Set(),
          totalNormHours: 0,
          totalPartsCost: 0,
        });
      }
      const item = map.get(row.serviceKind)!;
      item.repairIds.add(row.repairId);
      item.totalNormHours += row.totalNormHours;
      item.totalPartsCost += row.partsCost;
    }
    return [...map.values()]
      .map(item => ({
        scenario: item.scenario,
        repairsCount: item.repairIds.size,
        totalNormHours: Number(item.totalNormHours.toFixed(2)),
        totalPartsCost: Number(item.totalPartsCost.toFixed(2)),
      }))
      .sort((a, b) => b.repairsCount - a.repairsCount || b.totalNormHours - a.totalNormHours);
  }, [filteredMechanicRows]);

  const frequentRepairAlerts = useMemo(() => {
    return equipmentServiceSummary
      .map(item => ({ ...item, risk: assessServiceRisk(item) }))
      .filter(item => item.risk.level !== 'low')
      .slice(0, 8);
  }, [equipmentServiceSummary]);

  const problematicModels = useMemo(() => {
    const map = new Map<string, {
      model: string;
      equipmentTypeLabel: string;
      units: Set<string>;
      repairs: Set<string>;
      totalNormHours: number;
      partsCost: number;
    }>();

    for (const row of filteredMechanicRows) {
      const modelKey = `${row.equipmentTypeLabel || row.equipmentType}__${row.equipmentLabel}`;
      if (!map.has(modelKey)) {
        map.set(modelKey, {
          model: row.equipmentLabel,
          equipmentTypeLabel: row.equipmentTypeLabel || row.equipmentType,
          units: new Set(),
          repairs: new Set(),
          totalNormHours: 0,
          partsCost: 0,
        });
      }
      const item = map.get(modelKey)!;
      item.units.add(row.equipmentId || `${row.inventoryNumber}-${row.serialNumber}`);
      item.repairs.add(row.repairId);
      item.totalNormHours += row.totalNormHours;
      item.partsCost += row.partsCost;
    }

    return [...map.values()]
      .map(item => ({
        model: item.model,
        equipmentTypeLabel: item.equipmentTypeLabel,
        unitsCount: item.units.size,
        repairsCount: item.repairs.size,
        totalNormHours: Number(item.totalNormHours.toFixed(2)),
        partsCost: Number(item.partsCost.toFixed(2)),
        risk: assessServiceRisk({
          repairsCount: item.repairs.size,
          totalNormHours: Number(item.totalNormHours.toFixed(2)),
          partsCost: Number(item.partsCost.toFixed(2)),
        }),
      }))
      .sort((a, b) => b.repairsCount - a.repairsCount || b.totalNormHours - a.totalNormHours)
      .slice(0, 10);
  }, [filteredMechanicRows]);

  const serviceMonthlyDynamics = useMemo(() => {
    const months = lastNMonths(6);
    return months.map(({ year, month, label }) => {
      const monthKey = `${year}-${String(month + 1).padStart(2, '0')}`;
      const monthRows = filteredMechanicRows.filter(row => (row.createdAt ? row.createdAt.slice(0, 7) : '') === monthKey);
      const repairsCount = new Set(monthRows.map(row => row.repairId)).size;
      return {
        month: label,
        repairsCount,
        totalNormHours: Number(monthRows.reduce((sum, row) => sum + row.totalNormHours, 0).toFixed(2)),
        partsCost: Number(monthRows.reduce((sum, row) => sum + row.partsCost, 0).toFixed(2)),
      };
    });
  }, [filteredMechanicRows]);

  const serviceReasonsData = useMemo(() => {
    const reasonMap = new Map<string, number>();
    for (const ticket of tickets) {
      if (!filteredRepairIds.has(ticket.id)) continue;
      const reason = ticket.reason || 'Без причины';
      reasonMap.set(reason, (reasonMap.get(reason) ?? 0) + 1);
    }
    return [...reasonMap.entries()]
      .map(([reason, count], index) => ({
        reason,
        count,
        color: FALLBACK_COLORS[index % FALLBACK_COLORS.length],
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filteredRepairIds, tickets]);

  const saveCurrentServicePreset = useCallback(() => {
    const name = window.prompt('Название пресета');
    if (!name?.trim()) return;
    const preset: ServiceReportPreset = {
      id: `preset-${Date.now()}`,
      name: name.trim(),
        filters: {
          serviceDateFrom,
          serviceDateTo,
          serviceMechanic,
          serviceScenario,
          serviceStatus,
        serviceEquipmentType,
        serviceWorkCategory,
        servicePartName,
      },
    };
    persistPresets([...servicePresets, preset]);
    setServicePresetId(preset.id);
  }, [persistPresets, serviceDateFrom, serviceDateTo, serviceMechanic, serviceScenario, serviceStatus, serviceEquipmentType, serviceWorkCategory, servicePartName, servicePresets]);

  const applyServicePreset = useCallback((presetId: string) => {
    setServicePresetId(presetId);
    if (presetId === 'none') return;
    const preset = servicePresets.find(item => item.id === presetId);
    if (!preset) return;
    setServiceDateFrom(preset.filters.serviceDateFrom);
    setServiceDateTo(preset.filters.serviceDateTo);
    setServiceMechanic(preset.filters.serviceMechanic);
    setServiceScenario(preset.filters.serviceScenario || 'all');
    setServiceStatus(preset.filters.serviceStatus);
    setServiceEquipmentType(preset.filters.serviceEquipmentType);
    setServiceWorkCategory(preset.filters.serviceWorkCategory);
    setServicePartName(preset.filters.servicePartName);
  }, [servicePresets]);

  const deleteCurrentServicePreset = useCallback(() => {
    if (servicePresetId === 'none') return;
    persistPresets(servicePresets.filter(item => item.id !== servicePresetId));
    setServicePresetId('none');
  }, [persistPresets, servicePresetId, servicePresets]);

  const exportServiceCsv = useCallback(() => {
    const header = [
      'Тип строки',
      'Механик',
      'Сценарий',
      'Статус заявки',
      'Дата',
      'Заявка',
      'Тип техники',
      'Техника',
      'INV',
      'SN',
      'Работа',
      'Категория работы',
      'Запчасти',
      'Количество',
      'Нормо-часы',
      'Итого н/ч',
      'Километры',
      'Статус выезда',
    ];

    const lines = [
      header.map(escapeCsv).join(','),
      ...filteredMechanicRows.map(row => [
        'Работа',
        row.mechanicName,
        getServiceScenarioLabel(row.serviceKind),
        formatServiceStatus(row.repairStatus),
        row.createdAt ? row.createdAt.slice(0, 10) : '',
        row.repairId,
        row.equipmentTypeLabel || row.equipmentType,
        row.equipmentLabel,
        row.inventoryNumber,
        row.serialNumber,
        row.workName,
        row.workCategory,
        row.partNamesLabel,
        row.quantity,
        row.normHours,
        row.totalNormHours.toFixed(2),
        '',
        '',
      ].map(escapeCsv).join(',')),
      ...filteredFieldTrips.map(trip => [
        'Выезд',
        trip.mechanicName,
        getServiceScenarioLabel(trip.serviceKind),
        formatServiceStatus(trip.repairStatus),
        trip.createdAt ? trip.createdAt.slice(0, 10) : '',
        trip.repairId,
        trip.equipmentTypeLabel || trip.equipmentType,
        trip.equipmentLabel,
        trip.inventoryNumber,
        trip.serialNumber,
        trip.routeLabel,
        'Выезд',
        '',
        1,
        trip.closedNormHours.toFixed(2),
        trip.closedNormHours.toFixed(2),
        trip.distanceKm.toFixed(1),
        trip.tripStatus,
      ].map(escapeCsv).join(',')),
    ].join('\n');

    downloadFile(`\ufeff${lines}`, `service-report-${new Date().toISOString().slice(0, 10)}.csv`, 'text/csv;charset=utf-8');
  }, [filteredFieldTrips, filteredMechanicRows]);

  const exportServiceXls = useCallback(() => {
    const summaryRowsXml = filteredMechanicSummary.map(item => `
      <Row>
        <Cell><Data ss:Type="String">${escapeXml(item.mechanicName)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.repairsCount)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.worksCount)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.fieldTripCount)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.fieldTripDistanceKm.toFixed(2))}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.fieldTripNormHours.toFixed(2))}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.equipmentCount)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.totalNormHours.toFixed(2))}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.totalClosedNormHours.toFixed(2))}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.partsCost.toFixed(2))}</Data></Cell>
      </Row>
    `).join('');

    const equipmentRowsXml = equipmentServiceSummary.map(item => `
      <Row>
        <Cell><Data ss:Type="String">${escapeXml(item.equipmentTypeLabel)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(item.equipmentLabel)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(item.inventoryNumber)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(item.serialNumber)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.repairsCount)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.mechanicsCount)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.worksCount)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.totalNormHours.toFixed(2))}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.partsCost.toFixed(2))}</Data></Cell>
      </Row>
    `).join('');

    const rowsXml = filteredMechanicRows.map(row => `
      <Row>
        <Cell><Data ss:Type="String">${escapeXml(row.mechanicName)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(getServiceScenarioLabel(row.serviceKind))}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(formatServiceStatus(row.repairStatus))}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.createdAt ? row.createdAt.slice(0, 10) : '')}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.repairId)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.equipmentTypeLabel || row.equipmentType)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.equipmentLabel)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.inventoryNumber)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.serialNumber)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.workName)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.workCategory)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.partNamesLabel)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(row.quantity)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(row.normHours)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(row.totalNormHours.toFixed(2))}</Data></Cell>
      </Row>
    `).join('');

    const fieldTripRowsXml = filteredFieldTrips.map(trip => `
      <Row>
        <Cell><Data ss:Type="String">${escapeXml(trip.mechanicName)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(getServiceScenarioLabel(trip.serviceKind))}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(formatServiceStatus(trip.repairStatus))}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(trip.createdAt ? trip.createdAt.slice(0, 10) : '')}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(trip.repairId)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(trip.equipmentTypeLabel || trip.equipmentType)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(trip.equipmentLabel)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(trip.inventoryNumber)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(trip.serialNumber)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(trip.routeFrom)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(trip.routeTo)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(trip.distanceKm.toFixed(2))}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(trip.closedNormHours.toFixed(2))}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(trip.tripStatus)}</Data></Cell>
      </Row>
    `).join('');

    const xls = `<?xml version="1.0"?>
      <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
        xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:x="urn:schemas-microsoft-com:office:excel"
        xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
        <Worksheet ss:Name="Сводка">
          <Table>
            <Row>
              <Cell><Data ss:Type="String">Механик</Data></Cell>
              <Cell><Data ss:Type="String">Ремонты</Data></Cell>
              <Cell><Data ss:Type="String">Работы</Data></Cell>
              <Cell><Data ss:Type="String">Выезды</Data></Cell>
              <Cell><Data ss:Type="String">Км выезда</Data></Cell>
              <Cell><Data ss:Type="String">Выездные н/ч</Data></Cell>
              <Cell><Data ss:Type="String">Техника</Data></Cell>
              <Cell><Data ss:Type="String">Ремонтные н/ч</Data></Cell>
              <Cell><Data ss:Type="String">Всего закрыто н/ч</Data></Cell>
              <Cell><Data ss:Type="String">Запчасти, ₽</Data></Cell>
            </Row>
            ${summaryRowsXml}
          </Table>
        </Worksheet>
        <Worksheet ss:Name="Сервис">
          <Table>
            <Row>
              <Cell><Data ss:Type="String">Механик</Data></Cell>
              <Cell><Data ss:Type="String">Сценарий</Data></Cell>
              <Cell><Data ss:Type="String">Статус заявки</Data></Cell>
              <Cell><Data ss:Type="String">Дата</Data></Cell>
              <Cell><Data ss:Type="String">Заявка</Data></Cell>
              <Cell><Data ss:Type="String">Тип техники</Data></Cell>
              <Cell><Data ss:Type="String">Техника</Data></Cell>
              <Cell><Data ss:Type="String">INV</Data></Cell>
              <Cell><Data ss:Type="String">SN</Data></Cell>
              <Cell><Data ss:Type="String">Работа</Data></Cell>
              <Cell><Data ss:Type="String">Категория работы</Data></Cell>
              <Cell><Data ss:Type="String">Запчасти</Data></Cell>
              <Cell><Data ss:Type="String">Количество</Data></Cell>
              <Cell><Data ss:Type="String">Нормо-часы</Data></Cell>
              <Cell><Data ss:Type="String">Итого н/ч</Data></Cell>
            </Row>
            ${rowsXml}
          </Table>
        </Worksheet>
        <Worksheet ss:Name="Выезды">
          <Table>
            <Row>
              <Cell><Data ss:Type="String">Механик</Data></Cell>
              <Cell><Data ss:Type="String">Сценарий</Data></Cell>
              <Cell><Data ss:Type="String">Статус заявки</Data></Cell>
              <Cell><Data ss:Type="String">Дата</Data></Cell>
              <Cell><Data ss:Type="String">Заявка</Data></Cell>
              <Cell><Data ss:Type="String">Тип техники</Data></Cell>
              <Cell><Data ss:Type="String">Техника</Data></Cell>
              <Cell><Data ss:Type="String">INV</Data></Cell>
              <Cell><Data ss:Type="String">SN</Data></Cell>
              <Cell><Data ss:Type="String">Откуда</Data></Cell>
              <Cell><Data ss:Type="String">Куда</Data></Cell>
              <Cell><Data ss:Type="String">Километры</Data></Cell>
              <Cell><Data ss:Type="String">Закрыто н/ч</Data></Cell>
              <Cell><Data ss:Type="String">Статус выезда</Data></Cell>
            </Row>
            ${fieldTripRowsXml}
          </Table>
        </Worksheet>
        <Worksheet ss:Name="По технике">
          <Table>
            <Row>
              <Cell><Data ss:Type="String">Тип техники</Data></Cell>
              <Cell><Data ss:Type="String">Техника</Data></Cell>
              <Cell><Data ss:Type="String">INV</Data></Cell>
              <Cell><Data ss:Type="String">SN</Data></Cell>
              <Cell><Data ss:Type="String">Ремонты</Data></Cell>
              <Cell><Data ss:Type="String">Механики</Data></Cell>
              <Cell><Data ss:Type="String">Работы</Data></Cell>
              <Cell><Data ss:Type="String">Итого н/ч</Data></Cell>
              <Cell><Data ss:Type="String">Запчасти, ₽</Data></Cell>
            </Row>
            ${equipmentRowsXml}
          </Table>
        </Worksheet>
      </Workbook>`;

    downloadFile(xls, `service-report-${new Date().toISOString().slice(0, 10)}.xls`, 'application/vnd.ms-excel');
  }, [equipmentServiceSummary, filteredFieldTrips, filteredMechanicRows, filteredMechanicSummary]);

  const exportFinanceXls = useCallback(() => {
    const clientRowsXml = financeClientDebtAgingRows
      .map(item => `
        <Row>
          <Cell><Data ss:Type="String">${escapeXml(item.client)}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(item.manager)}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(item.ageBucketLabel)}</Data></Cell>
          <Cell><Data ss:Type="String">${escapeXml(item.hasActiveRental ? 'Да' : 'Нет')}</Data></Cell>
          <Cell><Data ss:Type="Number">${escapeXml(item.debt.toFixed(2))}</Data></Cell>
          <Cell><Data ss:Type="Number">${escapeXml(item.rentals)}</Data></Cell>
          <Cell><Data ss:Type="Number">${escapeXml(item.overdueRentals)}</Data></Cell>
        </Row>
      `).join('');

    const managerRowsXml = financeManagerSnapshots.map(item => `
      <Row>
        <Cell><Data ss:Type="String">${escapeXml(item.manager)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.currentDebt.toFixed(2))}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.overdueDebt.toFixed(2))}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.unpaidRentals)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.overdueRentals)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.clientsCount)}</Data></Cell>
      </Row>
    `).join('');

    const overdueRowsXml = financeOverdueBuckets.map(item => `
      <Row>
        <Cell><Data ss:Type="String">${escapeXml(item.label)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.rentals)}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(item.debt.toFixed(2))}</Data></Cell>
      </Row>
    `).join('');

    const debtRowsXml = financeDebtRows.map(row => `
      <Row>
        <Cell><Data ss:Type="String">${escapeXml(row.client)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.manager)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.equipmentInv)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.startDate)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.endDate)}</Data></Cell>
        <Cell><Data ss:Type="String">${escapeXml(row.expectedPaymentDate || '')}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(getRentalDebtOverdueDays(row))}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(row.amount.toFixed(2))}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(row.paidAmount.toFixed(2))}</Data></Cell>
        <Cell><Data ss:Type="Number">${escapeXml(row.outstanding.toFixed(2))}</Data></Cell>
      </Row>
    `).join('');

    const xls = `<?xml version="1.0"?>
      <Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
        xmlns:o="urn:schemas-microsoft-com:office:office"
        xmlns:x="urn:schemas-microsoft-com:office:excel"
        xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
        <Worksheet ss:Name="Клиенты">
          <Table>
            <Row>
              <Cell><Data ss:Type="String">Клиент</Data></Cell>
              <Cell><Data ss:Type="String">Менеджер</Data></Cell>
              <Cell><Data ss:Type="String">Возраст долга</Data></Cell>
              <Cell><Data ss:Type="String">Активная аренда</Data></Cell>
              <Cell><Data ss:Type="String">Сумма долга</Data></Cell>
              <Cell><Data ss:Type="String">Аренды</Data></Cell>
              <Cell><Data ss:Type="String">Просроченные аренды</Data></Cell>
            </Row>
            ${clientRowsXml}
          </Table>
        </Worksheet>
        <Worksheet ss:Name="Менеджеры">
          <Table>
            <Row>
              <Cell><Data ss:Type="String">Менеджер</Data></Cell>
              <Cell><Data ss:Type="String">Долг</Data></Cell>
              <Cell><Data ss:Type="String">Просроченный долг</Data></Cell>
              <Cell><Data ss:Type="String">Неоплаченные аренды</Data></Cell>
              <Cell><Data ss:Type="String">Просроченные аренды</Data></Cell>
              <Cell><Data ss:Type="String">Клиенты с долгом</Data></Cell>
            </Row>
            ${managerRowsXml}
          </Table>
        </Worksheet>
        <Worksheet ss:Name="Просрочка">
          <Table>
            <Row>
              <Cell><Data ss:Type="String">Возраст долга</Data></Cell>
              <Cell><Data ss:Type="String">Аренды</Data></Cell>
              <Cell><Data ss:Type="String">Сумма долга</Data></Cell>
            </Row>
            ${overdueRowsXml}
          </Table>
        </Worksheet>
        <Worksheet ss:Name="Аренды">
          <Table>
            <Row>
              <Cell><Data ss:Type="String">Клиент</Data></Cell>
              <Cell><Data ss:Type="String">Менеджер</Data></Cell>
              <Cell><Data ss:Type="String">Техника</Data></Cell>
              <Cell><Data ss:Type="String">Начало</Data></Cell>
              <Cell><Data ss:Type="String">Окончание</Data></Cell>
              <Cell><Data ss:Type="String">Ожидаемая оплата</Data></Cell>
              <Cell><Data ss:Type="String">Дней просрочки</Data></Cell>
              <Cell><Data ss:Type="String">Сумма</Data></Cell>
              <Cell><Data ss:Type="String">Оплачено</Data></Cell>
              <Cell><Data ss:Type="String">Остаток</Data></Cell>
            </Row>
            ${debtRowsXml}
          </Table>
        </Worksheet>
      </Workbook>`;

    downloadFile(xls, `finance-report-${new Date().toISOString().slice(0, 10)}.xls`, 'application/vnd.ms-excel');
  }, [financeClientDebtAgingRows, financeDebtRows, financeManagerSnapshots, financeOverdueBuckets]);

  const exportFinancePdf = useCallback(() => {
    const popup = window.open('', '_blank', 'width=1100,height=800');
    if (!popup) return;

    const clientRows = financeClientDebtAgingRows
      .map(item => `
        <tr>
          <td>${escapeXml(item.client)}</td>
          <td>${escapeXml(item.manager)}</td>
          <td>${escapeXml(item.ageBucketLabel)}</td>
          <td>${escapeXml(item.hasActiveRental ? 'Да' : 'Нет')}</td>
          <td>${escapeXml(formatCurrency(item.debt))}</td>
          <td>${escapeXml(item.rentals)}</td>
          <td>${escapeXml(item.overdueRentals)}</td>
        </tr>
      `).join('');

    const managerRows = financeManagerSnapshots.map(item => `
      <tr>
        <td>${escapeXml(item.manager)}</td>
        <td>${escapeXml(formatCurrency(item.currentDebt))}</td>
        <td>${escapeXml(formatCurrency(item.overdueDebt))}</td>
        <td>${escapeXml(item.unpaidRentals)}</td>
        <td>${escapeXml(item.overdueRentals)}</td>
        <td>${escapeXml(item.clientsCount)}</td>
      </tr>
    `).join('');

    const overdueRows = financeOverdueBuckets.map(item => `
      <tr>
        <td>${escapeXml(item.label)}</td>
        <td>${escapeXml(item.rentals)}</td>
        <td>${escapeXml(formatCurrency(item.debt))}</td>
      </tr>
    `).join('');

    const detailRows = financeDebtRows.slice(0, 25).map(row => `
      <tr>
        <td>${escapeXml(row.client)}</td>
        <td>${escapeXml(row.manager)}</td>
        <td>${escapeXml(row.equipmentInv)}</td>
        <td>${escapeXml(row.expectedPaymentDate || row.endDate)}</td>
        <td>${escapeXml(getRentalDebtOverdueDays(row))}</td>
        <td>${escapeXml(formatCurrency(row.outstanding))}</td>
      </tr>
    `).join('');

    popup.document.write(`
      <!doctype html>
      <html lang="ru">
        <head>
          <meta charset="utf-8" />
          <title>Финансовый отчёт</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 24px; color: #111827; }
            h1, h2 { margin: 0 0 12px; }
            .meta { margin-bottom: 20px; color: #6b7280; }
            .cards { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin-bottom: 24px; }
            .card { border: 1px solid #d1d5db; border-radius: 10px; padding: 12px; }
            .card-label { color: #6b7280; font-size: 12px; margin-bottom: 6px; }
            .card-value { font-size: 22px; font-weight: 700; }
            table { width: 100%; border-collapse: collapse; margin-bottom: 24px; }
            th, td { border: 1px solid #d1d5db; padding: 8px; text-align: left; font-size: 12px; }
            th { background: #f3f4f6; }
          </style>
        </head>
        <body>
          <h1>Финансовый отчёт</h1>
          <div class="meta">Сформировано ${escapeXml(new Date().toLocaleString('ru-RU'))}</div>
          <div class="cards">
            <div class="card"><div class="card-label">Общая дебиторка</div><div class="card-value">${escapeXml(formatCurrency(financeTotals.debt))}</div></div>
            <div class="card"><div class="card-label">Просроченный долг</div><div class="card-value">${escapeXml(formatCurrency(financeTotals.overdueDebt))}</div></div>
            <div class="card"><div class="card-label">Неоплаченные аренды</div><div class="card-value">${escapeXml(financeTotals.unpaidRentals)}</div></div>
            <div class="card"><div class="card-label">Клиенты с просрочкой</div><div class="card-value">${escapeXml(financeTotals.overdueClients)}</div></div>
          </div>
          <h2>Дебиторка по клиентам</h2>
          <table><thead><tr><th>Клиент</th><th>Менеджер</th><th>Возраст</th><th>Активная аренда</th><th>Долг</th><th>Аренды</th><th>Просроченные</th></tr></thead><tbody>${clientRows}</tbody></table>
          <h2>Дебиторка по менеджерам</h2>
          <table><thead><tr><th>Менеджер</th><th>Долг</th><th>Просроченный долг</th><th>Неоплаченные аренды</th><th>Просроченные</th><th>Клиенты</th></tr></thead><tbody>${managerRows}</tbody></table>
          <h2>Возраст долга</h2>
          <table><thead><tr><th>Период</th><th>Аренды</th><th>Сумма долга</th></tr></thead><tbody>${overdueRows}</tbody></table>
          <h2>Крупнейшие долги по арендам</h2>
          <table><thead><tr><th>Клиент</th><th>Менеджер</th><th>Техника</th><th>Срок оплаты</th><th>Дней просрочки</th><th>Остаток</th></tr></thead><tbody>${detailRows}</tbody></table>
          <script>window.onload = () => { window.print(); };</script>
        </body>
      </html>
    `);
    popup.document.close();
  }, [financeClientDebtAgingRows, financeDebtRows, financeManagerSnapshots, financeOverdueBuckets, financeTotals]);

  const refresh = useCallback(() => {
    setIsRefreshing(true);
    Promise.all([
      queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
      queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
      queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all }),
      queryClient.invalidateQueries({ queryKey: ['reports', 'mechanicsWorkload'] }),
    ]).finally(() => {
      setLoadedAt(Date.now());
      setIsRefreshing(false);
    });
  }, [queryClient]);

  // ─── KPI ──────────────────────────────────────────────────────────────────
  const totalEquipment = equipment.length;
  const fleetUtilization = useMemo(
    () => calculateCurrentFleetUtilization(equipment, ganttRentals),
    [equipment, ganttRentals],
  );
  const activeEquipment = fleetUtilization.activeEquipment;
  const rentedEquipment = fleetUtilization.rentedEquipment;
  const activeRentals = ganttRentals.filter(r => r.status === 'active').length;
  const openTickets = tickets.filter(t => t.status !== 'closed').length;
  const inProgressTickets = tickets.filter(t => t.status === 'in_progress').length;
  const utilization = activeEquipment === 0
    ? null
    : fleetUtilization.utilization;

  // ─── Utilization by month (last 6 months) ────────────────────────────────
  const utilizationData = useMemo(() => {
    const months = lastNMonths(6);
    return months.map(({ year, month, label }) => {
      const mStart = new Date(year, month, 1);
      const mEnd = new Date(year, month + 1, 0);
      const monthUtilization = calculateMonthlyFleetUtilization(equipment, ganttRentals, mStart, mEnd);
      return { month: label, utilization: monthUtilization.utilization };
    });
  }, [equipment, ganttRentals]);

  const hasUtilizationData = utilizationData.some(d => d.utilization > 0);

  const avgUtilization6m = utilizationData.length === 0 ? 0
    : Math.round(utilizationData.reduce((s, d) => s + d.utilization, 0) / utilizationData.length);

  // ─── Revenue by client (top 5) ────────────────────────────────────────────
  const revenueByClient = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of ganttRentals) {
      if (r.client && r.amount > 0) {
        map.set(r.client, (map.get(r.client) ?? 0) + r.amount);
      }
    }
    return [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([clientFull, revenue]) => ({
        clientFull,
        client: clientFull.length > 14 ? clientFull.substring(0, 12) + '…' : clientFull,
        revenue,
      }));
  }, [ganttRentals]);

  // ─── Downtime reasons — active service tickets grouped by status ──────────
  const downtimeData = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const t of tickets) {
      if (t.status === 'closed') continue;
      counts[t.status] = (counts[t.status] ?? 0) + 1;
    }
    return Object.entries(counts)
      .map(([status, count], i) => ({
        reason: TICKET_STATUS_LABELS[status] ?? status,
        count,
        color: TICKET_STATUS_COLORS[status] ?? FALLBACK_COLORS[i % FALLBACK_COLORS.length],
      }))
      .sort((a, b) => b.count - a.count);
  }, [tickets]);

  // ─── Fleet structure ──────────────────────────────────────────────────────
  const fleetStats = useMemo(() => [
    { label: 'Ножничные', count: equipment.filter(e => e.type === 'scissor').length, colorClass: 'bg-blue-500' },
    { label: 'Коленчатые', count: equipment.filter(e => e.type === 'articulated').length, colorClass: 'bg-green-500' },
    { label: 'Телескопические', count: equipment.filter(e => e.type === 'telescopic').length, colorClass: 'bg-purple-500' },
  ], [equipment]);

  // ─── tooltip styles (dark-mode compatible via CSS vars) ───────────────────
  const tooltipStyle = {
    backgroundColor: 'var(--card)',
    border: '1px solid var(--border)',
    borderRadius: '8px',
    color: 'var(--foreground)',
    fontSize: '13px',
  };
  const axisTickStyle = { fill: 'var(--muted-foreground)', fontSize: 12 };

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">

      {/* ── Page header ─────────────────────────────────────────────────────── */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Отчёты</h1>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
          Аналитика и управленческие отчёты
        </p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-6">
        <TabsList className="flex h-auto w-full justify-start gap-1 rounded-none border-b border-gray-200 bg-transparent p-0 dark:border-gray-700">
          {[
            { value: 'analytics', label: 'Аналитика' },
            { value: 'finance',   label: 'Финансы' },
            { value: 'managers',  label: 'По менеджерам' },
            { value: 'service',   label: 'По сервису' },
          ].map(tab => (
            <TabsTrigger
              key={tab.value}
              value={tab.value}
              className="border-b-2 border-transparent px-5 py-3 text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 data-[state=active]:border-[--color-primary] data-[state=active]:text-[--color-primary] transition-colors"
            >
              {tab.label}
            </TabsTrigger>
          ))}
        </TabsList>

        {/* ── Analytics tab ───────────────────────────────────────────────── */}
        <TabsContent value="analytics" className="space-y-4 sm:space-y-6">

      {/* ── Header ──────────────────────────────────────────────────────────── */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
            Аналитика и статистика работы системы
          </p>
          <p className="mt-0.5 text-xs text-gray-400 dark:text-gray-500">
            Обновлено: {formatTs(loadedAt)}&nbsp;·&nbsp;{minutesAgo(loadedAt)}&nbsp;·&nbsp;
            <span className="text-green-600 dark:text-green-400">реальные данные системы</span>
          </p>
        </div>
        <Button
          variant="secondary"
          size="sm"
          onClick={refresh}
          disabled={isRefreshing}
          className="self-start"
        >
          <RefreshCw className={`h-4 w-4 ${isRefreshing ? 'animate-spin' : ''}`} />
          {isRefreshing ? 'Обновление…' : 'Обновить данные'}
        </Button>
      </div>

      {/* ── KPI cards ───────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Truck className="h-3.5 w-3.5" /> Всего техники
            </CardDescription>
            <CardTitle className="text-3xl">{totalEquipment}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {totalEquipment === 0
                ? 'Техника не добавлена'
                : `В аренде: ${rentedEquipment} · Свободно: ${equipment.filter(e => e.status === 'available').length}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <BarChart2 className="h-3.5 w-3.5" /> Активные аренды
            </CardDescription>
            <CardTitle className="text-3xl">{activeRentals}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {activeRentals === 0 ? 'Нет активных аренд' : `Всего в системе: ${ganttRentals.length}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <Wrench className="h-3.5 w-3.5" /> Сервисных заявок
            </CardDescription>
            <CardTitle className="text-3xl">{openTickets}</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {openTickets === 0
                ? 'Нет открытых заявок'
                : `В работе: ${inProgressTickets} · Ожидание: ${tickets.filter(t => t.status === 'waiting_parts').length}`}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1.5">
              <TrendingUp className="h-3.5 w-3.5" /> Текущая утилизация
            </CardDescription>
            <CardTitle className="text-3xl">
              {utilization === null ? '—' : `${utilization}%`}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-gray-500 dark:text-gray-400">
              {utilization === null
                ? 'Нет данных для расчёта'
                : `Ср. за 6 мес: ${avgUtilization6m}%`}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* ── Charts ──────────────────────────────────────────────────────────── */}
      <div className="grid gap-4 sm:gap-6 lg:grid-cols-2">

        {/* Utilization by month */}
        <Card>
          <CardHeader>
            <CardTitle>Утилизация парка по месяцам</CardTitle>
            <CardDescription>
              Процент техники в аренде · последние 6 месяцев
              {hasUtilizationData && ` · ср. ${avgUtilization6m}%`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {hasUtilizationData ? (
              <ResponsiveContainer width="100%" height={280}>
                <LineChart data={utilizationData} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                  <XAxis dataKey="month" tick={axisTickStyle} />
                  <YAxis domain={[0, 100]} tickFormatter={(v: number) => `${v}%`} tick={axisTickStyle} />
                  <Tooltip
                    formatter={(v: number) => [`${v}%`, 'Утилизация']}
                    contentStyle={tooltipStyle}
                    labelStyle={{ color: 'var(--foreground)', fontWeight: 600 }}
                  />
                  <Line
                    type="monotone"
                    dataKey="utilization"
                    stroke="#1e40af"
                    strokeWidth={2.5}
                    dot={{ fill: '#1e40af', r: 4, strokeWidth: 0 }}
                    activeDot={{ r: 6 }}
                    name="Утилизация (%)"
                  />
                </LineChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Нет данных для графика. Создайте первые аренды, чтобы появилась статистика утилизации." />
            )}
          </CardContent>
        </Card>

        {/* Revenue by client */}
        <Card>
          <CardHeader>
            <CardTitle>Выручка по клиентам</CardTitle>
            <CardDescription>
              {revenueByClient.length > 0
                ? `Топ-${revenueByClient.length} клиентов по объёму выручки`
                : 'Топ клиентов по объёму выручки'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {revenueByClient.length > 0 ? (
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={revenueByClient} margin={{ top: 5, right: 20, left: -10, bottom: 65 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                  <XAxis
                    dataKey="client"
                    angle={-35}
                    textAnchor="end"
                    tick={{ fill: 'var(--muted-foreground)', fontSize: 11 }}
                    interval={0}
                  />
                  <YAxis
                    tickFormatter={(v: number) => v >= 1000000 ? `${(v / 1000000).toFixed(1)}М` : v >= 1000 ? `${Math.round(v / 1000)}к` : String(v)}
                    tick={axisTickStyle}
                  />
                  <Tooltip
                    formatter={(value: number, _name: string, props: { payload?: { clientFull?: string } }) => [
                      formatCurrency(value),
                      props.payload?.clientFull ?? 'Клиент',
                    ]}
                    contentStyle={tooltipStyle}
                    labelStyle={{ display: 'none' }}
                  />
                  <Bar dataKey="revenue" fill="#1e40af" radius={[4, 4, 0, 0]} name="Выручка" />
                </BarChart>
              </ResponsiveContainer>
            ) : (
              <EmptyChart message="Нет данных по выручке. Создайте аренды с указанием суммы." />
            )}
          </CardContent>
        </Card>

        {/* Downtime reasons */}
        <Card>
          <CardHeader>
            <CardTitle>Причины простоя техники</CardTitle>
            <CardDescription>
              {downtimeData.length > 0
                ? `Активные сервисные заявки по статусам · всего ${openTickets}`
                : 'Активные сервисные заявки по статусам'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {downtimeData.length > 0 ? (
              <div className="flex items-center gap-4">
                <div className="w-[45%] flex-shrink-0">
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={downtimeData}
                        cx="50%"
                        cy="50%"
                        outerRadius={80}
                        dataKey="count"
                        label={({ value }: { value: number }) => value}
                        labelLine={false}
                      >
                        {downtimeData.map((entry, i) => (
                          <Cell key={`cell-${i}`} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip
                        formatter={(value: number, _name: string, props: { payload?: { reason?: string } }) => [
                          value,
                          props.payload?.reason ?? '',
                        ]}
                        contentStyle={tooltipStyle}
                      />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex-1 space-y-2.5">
                  {downtimeData.map((item, i) => (
                    <div key={i} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <div
                          className="h-3 w-3 flex-shrink-0 rounded-full"
                          style={{ backgroundColor: item.color }}
                        />
                        <span className="text-sm text-gray-700 dark:text-gray-300 truncate">{item.reason}</span>
                      </div>
                      <span className="text-sm font-semibold text-gray-900 dark:text-white flex-shrink-0">
                        {item.count}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <EmptyChart message="Нет активных сервисных заявок." />
            )}
          </CardContent>
        </Card>

        {/* Fleet structure */}
        <Card>
          <CardHeader>
            <CardTitle>Структура парка по типам</CardTitle>
            <CardDescription>
              {totalEquipment > 0
                ? `Распределение ${totalEquipment} единиц техники по типам`
                : 'Распределение техники по типам подъёмников'}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {totalEquipment > 0 ? (
              <div className="space-y-5 pt-1">
                {fleetStats.map(item => (
                  <div key={item.label}>
                    <div className="mb-1.5 flex items-center justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{item.label}</span>
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {item.count} ед.
                        {totalEquipment > 0 && (
                          <span className="ml-1 font-normal text-gray-400 dark:text-gray-500 text-xs">
                            ({Math.round((item.count / totalEquipment) * 100)}%)
                          </span>
                        )}
                      </span>
                    </div>
                    <div className="h-2.5 w-full rounded-full bg-gray-100 dark:bg-gray-700">
                      <div
                        className={`h-2.5 rounded-full transition-all duration-500 ${item.colorClass}`}
                        style={{ width: item.count === 0 ? '0%' : `${Math.max(3, Math.round((item.count / totalEquipment) * 100))}%` }}
                      />
                    </div>
                  </div>
                ))}
                <p className="border-t border-gray-100 pt-2 text-xs text-gray-400 dark:border-gray-700 dark:text-gray-500">
                  Активных: {activeEquipment} · В аренде: {rentedEquipment} · В сервисе: {equipment.filter(e => e.status === 'in_service').length} · Списано: {equipment.filter(e => e.status === 'inactive').length}
                </p>
              </div>
            ) : (
              <EmptyChart message="Техника не добавлена в систему." />
            )}
          </CardContent>
        </Card>
      </div>

        </TabsContent>

        <TabsContent value="finance" className="space-y-4 sm:space-y-6">
          <div className="flex flex-wrap items-center justify-end gap-2">
            <Button variant="secondary" onClick={exportFinanceXls} disabled={financeDebtRows.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              Excel
            </Button>
            <Button variant="secondary" onClick={exportFinancePdf} disabled={financeDebtRows.length === 0}>
              <Download className="mr-2 h-4 w-4" />
              PDF
            </Button>
          </div>

          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Общая дебиторка</CardDescription>
                <CardTitle className="text-3xl">{formatCurrency(financeTotals.debt)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Неоплаченные аренды</CardDescription>
                <CardTitle className="text-3xl">{financeTotals.unpaidRentals}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Клиенты с просрочкой</CardDescription>
                <CardTitle className="text-3xl">{financeTotals.overdueClients}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Просроченный долг</CardDescription>
                <CardTitle className="text-3xl">{formatCurrency(financeTotals.overdueDebt)}</CardTitle>
              </CardHeader>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1.1fr_1fr]">
            <Card>
              <CardHeader>
                <CardTitle>Дебиторка по клиентам</CardTitle>
                <CardDescription>Группировка по клиенту, менеджеру, возрасту долга и активной аренде</CardDescription>
              </CardHeader>
              <CardContent>
                {financeClientDebtAgingRows.length === 0 ? (
                  <EmptyChart message="Нет данных по дебиторке клиентов." />
                ) : (
                  <div className="space-y-3">
                    {financeClientDebtAgingRows.slice(0, 12).map(item => (
                      <div
                        key={`${item.clientId || item.client}-${item.manager}-${item.ageBucket}-${item.hasActiveRental}`}
                        className={`rounded-lg border px-4 py-3 ${
                          item.overdueRentals > 0
                            ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                            : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">{item.client}</p>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {item.manager} · возраст: {item.ageBucketLabel} · активная аренда: {item.hasActiveRental ? 'да' : 'нет'}
                              {item.overdueRentals > 0 && ` · просроченных: ${item.overdueRentals}`}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`font-semibold ${item.overdueRentals > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                              {formatCurrency(item.debt)}
                            </p>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              Аренд: {item.rentals}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Неоплаченные аренды</CardTitle>
                <CardDescription>Аренды с остатком долга по оплате</CardDescription>
              </CardHeader>
              <CardContent>
                {financeDebtRows.length === 0 ? (
                  <EmptyChart message="Все аренды закрыты по оплате." />
                ) : (
                  <div className="space-y-3">
                    {financeDebtRows.slice(0, 12).map(row => {
                      const overdue = row.expectedPaymentDate
                        ? row.expectedPaymentDate < new Date().toISOString().slice(0, 10)
                        : row.endDate < new Date().toISOString().slice(0, 10);
                      return (
                        <div
                          key={row.rentalId}
                          className={`rounded-lg border px-4 py-3 ${
                            overdue
                              ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                              : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="font-medium text-gray-900 dark:text-white">{row.client}</p>
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {row.equipmentInv} · {row.startDate} — {row.endDate}
                              </p>
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                {row.expectedPaymentDate ? `Ожидаемая оплата: ${row.expectedPaymentDate}` : 'Дата оплаты не указана'}
                              </p>
                            </div>
                            <div className="text-right">
                              <p className={`font-semibold ${overdue ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                                {formatCurrency(row.outstanding)}
                              </p>
                              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                                Оплачено: {formatCurrency(row.paidAmount)}
                              </p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 xl:grid-cols-[1fr_0.9fr]">
            <Card>
              <CardHeader>
                <CardTitle>Дебиторка по менеджерам</CardTitle>
                <CardDescription>Кто ведёт долг, просрочку и сколько клиентов в риске</CardDescription>
              </CardHeader>
              <CardContent>
                {financeManagerSnapshots.length === 0 ? (
                  <EmptyChart message="Нет данных по менеджерской дебиторке." />
                ) : (
                  <div className="space-y-3">
                    {financeManagerSnapshots.map(item => (
                      <div
                        key={item.manager}
                        className={`rounded-lg border px-4 py-3 ${
                          item.overdueDebt > 0
                            ? 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20'
                            : 'border-gray-200 bg-gray-50 dark:border-gray-700 dark:bg-gray-900/40'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">{item.manager}</p>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              Клиентов с долгом: {item.clientsCount} · неоплаченных аренд: {item.unpaidRentals}
                              {item.overdueRentals > 0 && ` · просроченных: ${item.overdueRentals}`}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className="font-semibold text-gray-900 dark:text-white">{formatCurrency(item.currentDebt)}</p>
                            <p className={`mt-1 text-xs ${item.overdueDebt > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                              Просрочка: {formatCurrency(item.overdueDebt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Возраст долга</CardTitle>
                <CardDescription>Сколько аренд и долга в каждом интервале возраста</CardDescription>
              </CardHeader>
              <CardContent>
                {financeOverdueBuckets.every(item => item.rentals === 0) ? (
                  <EmptyChart message="Нет неоплаченных аренд по срокам оплаты." />
                ) : (
                  <div className="space-y-3">
                    {financeOverdueBuckets.map(item => (
                      <div key={item.key} className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 dark:border-gray-700 dark:bg-gray-900/40">
                        <div className="flex items-start justify-between gap-3">
                          <div>
                            <p className="font-medium text-gray-900 dark:text-white">{item.label}</p>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              Аренд с долгом: {item.rentals}
                            </p>
                          </div>
                          <div className="text-right">
                            <p className={`font-semibold ${item.debt > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-900 dark:text-white'}`}>
                              {formatCurrency(item.debt)}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* ── Managers report tab ─────────────────────────────────────────── */}
        <TabsContent value="managers">
          <ManagerReport />
        </TabsContent>

        <TabsContent value="service" className="space-y-4 sm:space-y-6">
          <Card>
            <CardHeader>
              <CardTitle>Фильтры сервиса</CardTitle>
              <CardDescription>Ограничьте отчёт по периоду, механику, статусу заявки и типу техники</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-3 md:grid-cols-9">
                <div>
                  <p className="mb-1 text-xs text-gray-500">Дата с</p>
                  <input
                    type="date"
                    value={serviceDateFrom}
                    onChange={e => setServiceDateFrom(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs text-gray-500">Дата по</p>
                  <input
                    type="date"
                    value={serviceDateTo}
                    onChange={e => setServiceDateTo(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  />
                </div>
                <div>
                  <p className="mb-1 text-xs text-gray-500">Механик</p>
                  <select
                    value={serviceMechanic}
                    onChange={e => setServiceMechanic(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  >
                    <option value="all">Все механики</option>
                    {serviceMechanicOptions.map(name => (
                      <option key={name} value={name}>{name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-xs text-gray-500">Сценарий</p>
                  <select
                    value={serviceScenario}
                    onChange={e => setServiceScenario(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  >
                    <option value="all">Все сценарии</option>
                    {serviceScenarioOptions.map(scenario => (
                      <option key={scenario} value={scenario}>{getServiceScenarioLabel(scenario)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-xs text-gray-500">Статус заявки</p>
                  <select
                    value={serviceStatus}
                    onChange={e => setServiceStatus(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  >
                    <option value="all">Все статусы</option>
                    {serviceStatusOptions.map(status => (
                      <option key={status} value={status}>{formatServiceStatus(status)}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-xs text-gray-500">Тип техники</p>
                  <select
                    value={serviceEquipmentType}
                    onChange={e => setServiceEquipmentType(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  >
                    <option value="all">Все типы</option>
                    {serviceEquipmentTypeOptions.map(type => (
                      <option key={type} value={type}>{type}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-xs text-gray-500">Категория работы</p>
                  <select
                    value={serviceWorkCategory}
                    onChange={e => setServiceWorkCategory(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  >
                    <option value="all">Все категории</option>
                    {serviceWorkCategoryOptions.map(category => (
                      <option key={category} value={category}>{category}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <p className="mb-1 text-xs text-gray-500">Запчасть</p>
                  <select
                    value={servicePartName}
                    onChange={e => setServicePartName(e.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                  >
                    <option value="all">Все запчасти</option>
                    {servicePartOptions.map(part => (
                      <option key={part} value={part}>{part}</option>
                    ))}
                  </select>
                </div>
                <div className="flex items-end">
                  <div className="flex gap-2">
                    <select
                      value={servicePresetId}
                      onChange={e => applyServicePreset(e.target.value)}
                      className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-600 dark:bg-gray-800"
                    >
                      <option value="none">Без пресета</option>
                      {servicePresets.map(preset => (
                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                      ))}
                    </select>
                    <Button variant="secondary" onClick={saveCurrentServicePreset}>
                      Сохранить пресет
                    </Button>
                    <Button variant="secondary" onClick={deleteCurrentServicePreset} disabled={servicePresetId === 'none'}>
                      Удалить пресет
                    </Button>
                    <Button variant="secondary" onClick={exportServiceCsv} disabled={filteredMechanicRows.length === 0 && filteredFieldTrips.length === 0}>
                      <Download className="h-4 w-4" />
                      CSV
                    </Button>
                    <Button variant="secondary" onClick={exportServiceXls} disabled={filteredMechanicRows.length === 0 && filteredFieldTrips.length === 0}>
                      <Download className="h-4 w-4" />
                      XLS
                    </Button>
                    <Button
                      variant="secondary"
                      onClick={() => {
                        setServiceDateFrom('');
                        setServiceDateTo('');
                        setServiceMechanic('all');
                        setServiceScenario('all');
                        setServiceStatus('all');
                        setServiceEquipmentType('all');
                        setServiceWorkCategory('all');
                        setServicePartName('all');
                        setServicePresetId('none');
                      }}
                    >
                      Сбросить
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Механиков в отчёте</CardDescription>
                <CardTitle className="text-3xl">{filteredMechanicSummary.length}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">Сотрудники с работами и выездами по текущему сценарию</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Ремонтные н/ч</CardDescription>
                <CardTitle className="text-3xl">
                  {serviceRepairNormHours.toFixed(1)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">Суммарно по всем работам в ремонтах</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Выездные н/ч</CardDescription>
                <CardTitle className="text-3xl">
                  {serviceFieldTripNormHours.toFixed(1)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">Автозакрытие по маршрутам выезда механиков</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Всего закрыто н/ч</CardDescription>
                <CardTitle className="text-3xl">
                  {serviceTotalClosedNormHours.toFixed(1)}
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">Ремонтные и выездные нормо-часы вместе</p>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-7">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Ремонтов в срезе</CardDescription>
                <CardTitle className="text-3xl">{serviceRepairCount}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">Уникальные заявки после применения фильтров</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Средние н/ч на ремонт</CardDescription>
                <CardTitle className="text-3xl">{serviceAverageNormHoursPerRepair.toFixed(1)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">Средняя трудоёмкость одного ремонта</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Выездов завершено</CardDescription>
                <CardTitle className="text-3xl">{serviceFieldTripCount}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">Количество завершённых выездов по фильтру</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Километры выезда</CardDescription>
                <CardTitle className="text-3xl">{serviceFieldTripDistance.toFixed(0)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">Суммарный километраж завершённых выездов</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Средние работы на ремонт</CardDescription>
                <CardTitle className="text-3xl">{serviceAverageWorksPerRepair.toFixed(1)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">Среднее количество выполненных работ</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Средние запчасти на ремонт</CardDescription>
                <CardTitle className="text-3xl">{formatCurrency(serviceAveragePartsCostPerRepair)}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">Средняя сумма запчастей по snapshot-ценам</p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Повторные поломки</CardDescription>
                <CardTitle className="text-3xl">{filteredRepeatFailures.length}</CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-gray-500 dark:text-gray-400">Техника с повторяющейся причиной ремонта</p>
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Сравнение периодов</CardTitle>
              <CardDescription>
                Текущий период {serviceComparison.currentStart} - {serviceComparison.currentEnd} против предыдущего {serviceComparison.previousStart} - {serviceComparison.previousEnd}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="grid gap-4 md:grid-cols-5">
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-xs text-gray-500">Ремонты</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{serviceComparison.currentRepairCount}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Было: {serviceComparison.previousRepairCount} · Δ {formatDelta(serviceComparison.currentRepairCount, serviceComparison.previousRepairCount)}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-xs text-gray-500">Ремонтные н/ч</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{serviceComparison.currentNormHours.toFixed(1)}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Было: {serviceComparison.previousNormHours.toFixed(1)} · Δ {formatDelta(serviceComparison.currentNormHours, serviceComparison.previousNormHours, ' н/ч')}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-xs text-gray-500">Выездные н/ч</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{serviceComparison.currentFieldTripNormHours.toFixed(1)}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Было: {serviceComparison.previousFieldTripNormHours.toFixed(1)} · Δ {formatDelta(serviceComparison.currentFieldTripNormHours, serviceComparison.previousFieldTripNormHours, ' н/ч')}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-xs text-gray-500">Всего закрыто н/ч</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{serviceComparison.currentClosedNormHours.toFixed(1)}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Было: {serviceComparison.previousClosedNormHours.toFixed(1)} · Δ {formatDelta(serviceComparison.currentClosedNormHours, serviceComparison.previousClosedNormHours, ' н/ч')}
                  </p>
                </div>
                <div className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                  <p className="text-xs text-gray-500">Запчасти</p>
                  <p className="mt-1 text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(serviceComparison.currentPartsCost)}</p>
                  <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                    Было: {formatCurrency(serviceComparison.previousPartsCost)} · Δ {formatCurrency(serviceComparison.currentPartsCost - serviceComparison.previousPartsCost)}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Сценарии сервиса</CardTitle>
                <CardDescription>Распределение заявок, нормо-часов и запчастей по сценариям</CardDescription>
              </CardHeader>
              <CardContent>
                {serviceScenarioSummary.length > 0 ? (
                  <div className="space-y-3">
                    {serviceScenarioSummary.map(item => (
                      <div key={item.scenario} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{getServiceScenarioLabel(item.scenario)}</p>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{item.repairsCount} заявок в текущем срезе</p>
                          </div>
                          <div className="text-right">
                            <p className="text-sm font-semibold text-gray-900 dark:text-white">{item.totalNormHours.toFixed(1)} н/ч</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{formatCurrency(item.totalPartsCost)} запчасти</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyChart message="Нет сервисных сценариев для текущего фильтра." />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Динамика сервиса</CardTitle>
                <CardDescription>Ремонты, нормо-часы и запчасти по месяцам за последние 6 месяцев</CardDescription>
              </CardHeader>
              <CardContent>
                {serviceMonthlyDynamics.some(item => item.repairsCount > 0 || item.totalNormHours > 0 || item.partsCost > 0) ? (
                  <ResponsiveContainer width="100%" height={280}>
                    <LineChart data={serviceMonthlyDynamics} margin={{ top: 5, right: 20, left: -10, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" opacity={0.5} />
                      <XAxis dataKey="month" tick={axisTickStyle} />
                      <YAxis tick={axisTickStyle} />
                      <Tooltip contentStyle={tooltipStyle} />
                      <Line type="monotone" dataKey="repairsCount" stroke="#1e40af" strokeWidth={2.5} name="Ремонты" />
                      <Line type="monotone" dataKey="totalNormHours" stroke="#ef4444" strokeWidth={2.5} name="Н/ч" />
                      <Line type="monotone" dataKey="partsCost" stroke="#22c55e" strokeWidth={2.5} name="Запчасти" />
                    </LineChart>
                  </ResponsiveContainer>
                ) : (
                  <EmptyChart message="Нет данных для динамики сервиса по текущему фильтру." />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Причины обращений</CardTitle>
                <CardDescription>Самые частые причины сервисных заявок в текущем срезе</CardDescription>
              </CardHeader>
              <CardContent>
                {serviceReasonsData.length > 0 ? (
                  <div className="flex items-center gap-4">
                    <div className="w-[45%] flex-shrink-0">
                      <ResponsiveContainer width="100%" height={220}>
                        <PieChart>
                          <Pie data={serviceReasonsData} cx="50%" cy="50%" outerRadius={80} dataKey="count" label={({ value }: { value: number }) => value} labelLine={false}>
                            {serviceReasonsData.map(item => (
                              <Cell key={item.reason} fill={item.color} />
                            ))}
                          </Pie>
                          <Tooltip contentStyle={tooltipStyle} />
                        </PieChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="flex-1 space-y-2.5">
                      {serviceReasonsData.map(item => (
                        <div key={item.reason} className="flex items-center justify-between gap-2">
                          <div className="flex min-w-0 items-center gap-2">
                            <div className="h-3 w-3 flex-shrink-0 rounded-full" style={{ backgroundColor: item.color }} />
                            <span className="truncate text-sm text-gray-700 dark:text-gray-300">{item.reason}</span>
                          </div>
                          <span className="text-sm font-semibold text-gray-900 dark:text-white">{item.count}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ) : (
                  <EmptyChart message="Нет причин обращений для выбранного фильтра." />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Сводка по механикам</CardTitle>
              <CardDescription>Ремонты, выезды, километры и общий объём закрытых н/ч по каждому механику</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredMechanicSummary.length > 0 ? (
                <div className="space-y-3">
                  {filteredMechanicSummary.map(item => (
                    <div key={item.mechanicId || item.mechanicName} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{item.mechanicName}</p>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            Ремонтов: {item.repairsCount} · Работ: {item.worksCount} · Выездов: {item.fieldTripCount} · Км: {item.fieldTripDistanceKm.toFixed(0)} · Техники: {item.equipmentCount}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-gray-900 dark:text-white">{item.totalClosedNormHours.toFixed(1)} н/ч</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            Ремонт: {item.totalNormHours.toFixed(1)} н/ч · Выезд: {item.fieldTripNormHours.toFixed(1)} н/ч
                          </p>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatCurrency(item.partsCost)} запчасти</p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyChart message="Пока нет данных по работам и выездам механиков. Добавьте выполненные работы или завершите выезд по заявке." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Повторные поломки</CardTitle>
              <CardDescription>Повторяющиеся причины ремонта по одной и той же технике</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredRepeatFailures.length > 0 ? (
                <div className="space-y-3">
                  {filteredRepeatFailures.slice(0, 12).map(item => (
                    <div key={`${item.equipmentId}-${item.reason}`} className="rounded-lg border border-rose-200 bg-rose-50 p-4 dark:border-rose-700/40 dark:bg-rose-900/20">
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          {item.equipmentId ? (
                            <Link to={`/equipment/${item.equipmentId}`} className="text-sm font-semibold text-rose-700 hover:underline dark:text-rose-300">
                              {item.equipmentLabel}
                            </Link>
                          ) : (
                            <p className="text-sm font-semibold text-rose-700 dark:text-rose-300">{item.equipmentLabel}</p>
                          )}
                          <p className="mt-1 text-xs text-rose-700/80 dark:text-rose-300/80">
                            {item.equipmentTypeLabel || item.equipmentType} · INV {item.inventoryNumber} · SN {item.serialNumber}
                          </p>
                          <p className="mt-2 text-sm text-gray-900 dark:text-white">{item.reason}</p>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {getServiceScenarioLabel(item.serviceKind)} · Механики: {item.mechanicNames.join(', ') || '—'}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-lg font-bold text-rose-700 dark:text-rose-300">{item.repairsCount} повторов</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{item.totalNormHours.toFixed(1)} н/ч · {formatCurrency(item.totalPartsCost)}</p>
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {item.firstCreatedAt?.slice(0, 10)} → {item.lastCreatedAt?.slice(0, 10)}
                          </p>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyChart message="По текущим фильтрам повторных поломок не найдено." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Детализация работ</CardTitle>
              <CardDescription>Каждая строка ремонта с техникой, механиком и нормо-часами</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredMechanicRows.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        <th className="px-3 py-2 font-medium">Механик</th>
                        <th className="px-3 py-2 font-medium">Сценарий</th>
                        <th className="px-3 py-2 font-medium">Заявка</th>
                        <th className="px-3 py-2 font-medium">Техника</th>
                        <th className="px-3 py-2 font-medium">Работа</th>
                        <th className="px-3 py-2 font-medium">Кол-во</th>
                        <th className="px-3 py-2 font-medium">Н/ч</th>
                        <th className="px-3 py-2 font-medium">Итого</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredMechanicRows.map(row => (
                        <tr key={`${row.repairId}-${row.workName}-${row.createdAt}`} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="px-3 py-2">{row.mechanicName}</td>
                          <td className="px-3 py-2">{getServiceScenarioLabel(row.serviceKind)}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            <Link to={`/service/${row.repairId}`} className="text-[--color-primary] hover:underline">
                              {row.repairId}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            {row.equipmentId ? (
                              <Link to={`/equipment/${row.equipmentId}`} className="font-medium text-[--color-primary] hover:underline">
                                {row.equipmentLabel}
                              </Link>
                            ) : (
                              <div className="font-medium text-gray-900 dark:text-white">{row.equipmentLabel}</div>
                            )}
                            <div className="text-xs text-gray-500 dark:text-gray-400">INV {row.inventoryNumber} · SN {row.serialNumber}</div>
                          </td>
                          <td className="px-3 py-2">
                            <div>{row.workName}</div>
                            {row.workCategory && <div className="text-xs text-gray-500 dark:text-gray-400">{row.workCategory}</div>}
                            {row.partNamesLabel && <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{row.partNamesLabel}</div>}
                          </td>
                          <td className="px-3 py-2">{row.quantity}</td>
                          <td className="px-3 py-2">{row.normHours}</td>
                          <td className="px-3 py-2 font-semibold">{row.totalNormHours.toFixed(1)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyChart message="Нет строк выполненных работ для детализации." />
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Выезды на объект</CardTitle>
              <CardDescription>Завершённые выезды механиков с маршрутом, километражем и закрытыми н/ч</CardDescription>
            </CardHeader>
            <CardContent>
              {filteredFieldTrips.length > 0 ? (
                <div className="overflow-x-auto">
                  <table className="min-w-full text-sm">
                    <thead>
                      <tr className="border-b border-gray-200 text-left text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        <th className="px-3 py-2 font-medium">Механик</th>
                        <th className="px-3 py-2 font-medium">Заявка</th>
                        <th className="px-3 py-2 font-medium">Техника</th>
                        <th className="px-3 py-2 font-medium">Маршрут</th>
                        <th className="px-3 py-2 font-medium">Километры</th>
                        <th className="px-3 py-2 font-medium">Закрыто н/ч</th>
                        <th className="px-3 py-2 font-medium">Дата</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredFieldTrips.map(trip => (
                        <tr key={trip.id} className="border-b border-gray-100 dark:border-gray-800">
                          <td className="px-3 py-2">{trip.mechanicName}</td>
                          <td className="px-3 py-2 font-mono text-xs">
                            <Link to={`/service/${trip.repairId}`} className="text-[--color-primary] hover:underline">
                              {trip.repairId}
                            </Link>
                          </td>
                          <td className="px-3 py-2">
                            {trip.equipmentId ? (
                              <Link to={`/equipment/${trip.equipmentId}`} className="font-medium text-[--color-primary] hover:underline">
                                {trip.equipmentLabel}
                              </Link>
                            ) : (
                              <div className="font-medium text-gray-900 dark:text-white">{trip.equipmentLabel}</div>
                            )}
                            <div className="text-xs text-gray-500 dark:text-gray-400">INV {trip.inventoryNumber} · SN {trip.serialNumber}</div>
                          </td>
                          <td className="px-3 py-2">{trip.routeLabel || [trip.routeFrom, trip.routeTo].filter(Boolean).join(' → ') || 'Маршрут не указан'}</td>
                          <td className="px-3 py-2">{trip.distanceKm.toFixed(1)} км</td>
                          <td className="px-3 py-2 font-semibold">{trip.closedNormHours.toFixed(1)} н/ч</td>
                          <td className="px-3 py-2">{trip.createdAt ? trip.createdAt.slice(0, 10) : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyChart message="Завершённых выездов по текущим фильтрам пока нет." />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Сводка по технике</CardTitle>
                <CardDescription>Какая техника чаще всего проходила через сервис и сколько нормо-часов по ней закрыто</CardDescription>
              </CardHeader>
              <CardContent>
                {equipmentServiceSummary.length > 0 ? (
                  <div className="space-y-3">
                    {equipmentServiceSummary.slice(0, 10).map(item => (
                      <div key={`${item.inventoryNumber}-${item.serialNumber}`} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            {item.equipmentId ? (
                              <Link to={`/equipment/${item.equipmentId}`} className="text-sm font-semibold text-[--color-primary] hover:underline">
                                {item.equipmentLabel}
                              </Link>
                            ) : (
                              <p className="text-sm font-semibold text-gray-900 dark:text-white">{item.equipmentLabel}</p>
                            )}
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              {item.equipmentTypeLabel} · INV {item.inventoryNumber} · SN {item.serialNumber}
                            </p>
                            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                              Ремонтов: {item.repairsCount} · Механиков: {item.mechanicsCount} · Работ: {item.worksCount}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${assessServiceRisk(item).badgeClass}`}>
                              {assessServiceRisk(item).label}
                            </span>
                            <p className="text-lg font-bold text-gray-900 dark:text-white">{item.totalNormHours.toFixed(1)} н/ч</p>
                            <p className="text-xs text-gray-500 dark:text-gray-400">{formatCurrency(item.partsCost)} запчасти</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyChart message="Нет данных по технике в выбранном срезе." />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Топ работ</CardTitle>
                <CardDescription>Самые частые сервисные работы по текущему фильтру</CardDescription>
              </CardHeader>
              <CardContent>
                {topServiceWorks.length > 0 ? (
                  <div className="space-y-2">
                    {topServiceWorks.map(item => (
                      <div key={`${item.name}-${item.category}`} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{item.name}</p>
                          {item.category && <p className="text-xs text-gray-500 dark:text-gray-400">{item.category}</p>}
                        </div>
                        <div className="text-right">
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{item.count}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{item.totalNormHours.toFixed(1)} н/ч</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyChart message="Нет данных по работам в выбранном срезе." />
                )}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Алерты по технике</CardTitle>
                <CardDescription>Техника, которая слишком часто попадает в ремонт или требует много трудозатрат</CardDescription>
              </CardHeader>
              <CardContent>
                {frequentRepairAlerts.length > 0 ? (
                  <div className="space-y-3">
                    {frequentRepairAlerts.map(item => (
                      <div key={`${item.inventoryNumber}-${item.serialNumber}`} className="rounded-lg border border-amber-200 bg-amber-50 p-4 dark:border-amber-700/50 dark:bg-amber-900/20">
                        <div className="flex items-start justify-between gap-4">
                          <div>
                            {item.equipmentId ? (
                              <Link to={`/equipment/${item.equipmentId}`} className="text-sm font-semibold text-amber-700 hover:underline dark:text-amber-300">
                                {item.equipmentLabel}
                              </Link>
                            ) : (
                              <p className="text-sm font-semibold text-amber-700 dark:text-amber-300">{item.equipmentLabel}</p>
                            )}
                            <p className="mt-1 text-xs text-amber-700/80 dark:text-amber-300/80">
                              {item.equipmentTypeLabel} · INV {item.inventoryNumber} · SN {item.serialNumber}
                            </p>
                          </div>
                          <div className="text-right text-xs text-amber-700 dark:text-amber-300">
                            <span className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.risk.badgeClass}`}>
                              {item.risk.label}
                            </span>
                            <p>{item.repairsCount} ремонтов</p>
                            <p>{item.totalNormHours.toFixed(1)} н/ч</p>
                            <p>{formatCurrency(item.partsCost)}</p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyChart message="По текущему фильтру нет техники, попадающей в зону риска." />
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Проблемные модели</CardTitle>
                <CardDescription>Рейтинг моделей по количеству ремонтов и трудоёмкости</CardDescription>
              </CardHeader>
              <CardContent>
                {problematicModels.length > 0 ? (
                  <div className="space-y-2">
                    {problematicModels.map(item => (
                      <div key={`${item.equipmentTypeLabel}-${item.model}`} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 dark:border-gray-700">
                        <div>
                          <p className="text-sm font-medium text-gray-900 dark:text-white">{item.model}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {item.equipmentTypeLabel} · Единиц: {item.unitsCount}
                          </p>
                        </div>
                        <div className="text-right">
                          <span className={`mb-1 inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${item.risk.badgeClass}`}>
                            {item.risk.label}
                          </span>
                          <p className="text-sm font-semibold text-gray-900 dark:text-white">{item.repairsCount} ремонтов</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">{item.totalNormHours.toFixed(1)} н/ч · {formatCurrency(item.partsCost)}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <EmptyChart message="Нет моделей для рейтинга в текущем срезе." />
                )}
              </CardContent>
            </Card>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Топ запчастей</CardTitle>
              <CardDescription>Какие запчасти чаще всего встречаются в ремонтах по текущему фильтру</CardDescription>
            </CardHeader>
            <CardContent>
              {topServiceParts.length > 0 ? (
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                  {topServiceParts.map(item => (
                    <div key={item.name} className="rounded-lg border border-gray-200 p-4 dark:border-gray-700">
                      <p className="text-sm font-semibold text-gray-900 dark:text-white">{item.name}</p>
                      <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        Ремонтов: {item.repairsCount} · Упоминаний: {item.rowsCount}
                      </p>
                      <p className="mt-2 text-sm font-medium text-gray-900 dark:text-white">{formatCurrency(item.partsCost)}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <EmptyChart message="Нет данных по запчастям в выбранном срезе." />
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
