import { api, buildPaginatedQuery, type PaginatedQueryParams, type PaginatedResponse } from '../lib/api';
import type { ServiceScenario } from '../types';

export interface MechanicWorkloadSummary {
  mechanicId: string;
  mechanicName: string;
  repairsCount: number;
  worksCount: number;
  totalNormHours: number;
  fieldTripCount: number;
  fieldTripDistanceKm: number;
  fieldTripNormHours: number;
  totalClosedNormHours: number;
  partsCost: number;
  equipmentCount: number;
}

export interface MechanicWorkloadRow {
  mechanicId: string;
  mechanicName: string;
  repairId: string;
  serviceKind: ServiceScenario;
  repairStatus: string;
  createdAt: string;
  equipmentId: string;
  equipmentLabel: string;
  equipmentType: string;
  equipmentTypeLabel: string;
  inventoryNumber: string;
  serialNumber: string;
  workName: string;
  workCategory: string;
  partNames: string[];
  partNamesLabel: string;
  quantity: number;
  normHours: number;
  totalNormHours: number;
  partsCost: number;
}

export interface MechanicFieldTripRow {
  id: string;
  mechanicId: string;
  mechanicName: string;
  repairId: string;
  serviceKind: ServiceScenario;
  repairStatus: string;
  createdAt: string;
  completedAt: string;
  tripStatus: string;
  equipmentId: string;
  equipmentLabel: string;
  equipmentType: string;
  equipmentTypeLabel: string;
  inventoryNumber: string;
  serialNumber: string;
  routeFrom: string;
  routeTo: string;
  routeLabel: string;
  distanceKm: number;
  closedNormHours: number;
  serviceVehicleId: string | null;
}

export interface RepeatFailureRow {
  equipmentId: string;
  equipmentLabel: string;
  equipmentType: string;
  equipmentTypeLabel: string;
  inventoryNumber: string;
  serialNumber: string;
  reason: string;
  serviceKind: ServiceScenario;
  repairsCount: number;
  totalNormHours: number;
  totalPartsCost: number;
  firstCreatedAt: string;
  lastCreatedAt: string;
  repairIds: string[];
  repairStatuses: string[];
  mechanicNames: string[];
  partNames: string[];
  workCategories: string[];
  createdDates: string[];
}

export interface MechanicProductivityWarning {
  type: string;
  message: string;
  workId: string;
  serviceTicketId: string;
  mechanicId: string;
  severity: 'info' | 'warning';
}

export interface MechanicProductivitySummary {
  mechanicId: string;
  mechanicName: string;
  completedWorksCount: number;
  completedTicketsCount: number;
  totalNormHours: number;
  totalAmount: number;
  averageNormHoursPerDay: number;
  worksByCategory: Record<string, number>;
  worksByEquipmentType: Record<string, number>;
  tickets: Array<{
    serviceTicketId: string;
    status: string;
    workId: string;
    workName: string;
    date: string;
    normHours: number;
    amount: number;
  }>;
  warnings: MechanicProductivityWarning[];
}

export interface MechanicProductivityDetail {
  id: string;
  serviceTicketId: string;
  repairId: string;
  workCatalogId: string;
  workNameSnapshot: string;
  mechanicId: string;
  mechanicName: string;
  equipmentId: string;
  equipmentLabel: string;
  equipmentInv: string;
  serialNumber: string;
  modelSnapshot: string;
  equipmentType: string;
  category: string;
  date: string;
  quantity: number;
  normHours: number;
  rate: number;
  amount: number;
  payType: string;
  status: string;
  source: string;
  comment: string;
  repairStatus: string;
}

export interface MechanicsProductivityReport {
  period: { dateFrom: string; dateTo: string };
  kpi: {
    completedWorks: number;
    totalNormHours: number;
    totalAmount: number;
    averagePerMechanic: number;
    missingNormHours: number;
    missingMechanic: number;
    closedTicketsWithUnfinishedWorks: number;
  };
  mechanics: MechanicProductivitySummary[];
  details: MechanicProductivityDetail[];
  warnings: MechanicProductivityWarning[];
}

export interface MechanicsWorkloadReport {
  summary: MechanicWorkloadSummary[];
  rows: MechanicWorkloadRow[];
  fieldTrips: MechanicFieldTripRow[];
  repeatFailures: RepeatFailureRow[];
  productivity?: MechanicsProductivityReport;
}

export interface ReportsOverview {
  summary: {
    totalEquipment: number;
    activeEquipment: number;
    rentedEquipment: number;
    availableEquipment: number;
    inServiceEquipment: number;
    inactiveEquipment: number;
    activeRentals: number;
    totalRentals: number;
    openTickets: number;
    inProgressTickets: number;
    waitingTickets: number;
    utilization: number | null;
    avgUtilization6m: number;
  };
  utilizationData: Array<{ month: string; utilization: number }>;
  revenueByClient: Array<{ clientFull: string; client: string; revenue: number }>;
  downtimeData: Array<{ reason: string; count: number; color: string }>;
  fleetStats: Array<{ label: string; count: number; colorClass: string }>;
  salesStockTotals: Record<string, number>;
}

export interface FinanceReportSummary {
  period: { dateFrom: string; dateTo: string; maxDays: number; defaulted?: boolean };
  summary: {
    debt: number;
    overdueClients: number;
    exceededClients: number;
    unpaidRentals: number;
    overdueDebt: number;
  };
  overdueBuckets: Array<{ key: string; label: string; rentals: number; debt: number }>;
}

export interface FinanceExportReport extends FinanceReportSummary {
  items: any[];
  total: number;
  clientDebtAgingRows: any[];
  managerReceivables: any[];
}

export interface ServiceReportSummary {
  period: { dateFrom: string; dateTo: string; maxDays: number; defaulted?: boolean };
  summary: {
    mechanicsCount: number;
    repairCount: number;
    repairNormHours: number;
    fieldTripCount: number;
    fieldTripDistance: number;
    fieldTripNormHours: number;
    totalClosedNormHours: number;
    productivityKpi?: Record<string, number>;
  };
}

export interface RepairFactsMigrationResult {
  ok: true;
  createdWorkRefs: number;
  createdPartRefs: number;
  migratedWorkItems: number;
  migratedPartItems: number;
  ticketsScanned: number;
}

export const reportsService = {
  getOverview: (): Promise<ReportsOverview> =>
    api.get<ReportsOverview>('/api/reports/overview'),

  getSalesStockDetails: (params?: PaginatedQueryParams): Promise<PaginatedResponse<Record<string, any>, Record<string, number>>> =>
    api.get<PaginatedResponse<Record<string, any>, Record<string, number>>>(`/api/reports/sales-stock/details${buildPaginatedQuery(params)}`),

  getFinanceSummary: (params?: Pick<PaginatedQueryParams, 'dateFrom' | 'dateTo'>): Promise<FinanceReportSummary> =>
    api.get<FinanceReportSummary>(`/api/reports/finance/summary${buildPaginatedQuery(params)}`),

  getFinanceDetails: (type: 'client-debt' | 'manager-receivables' | 'unpaid-rentals', params?: PaginatedQueryParams): Promise<PaginatedResponse<Record<string, any>, FinanceReportSummary['summary']>> =>
    api.get<PaginatedResponse<Record<string, any>, FinanceReportSummary['summary']>>(`/api/reports/finance/details/${type}${buildPaginatedQuery(params)}`),

  getFinanceExport: (params?: PaginatedQueryParams): Promise<FinanceExportReport> =>
    api.get<FinanceExportReport>(`/api/reports/finance/export${buildPaginatedQuery(params)}`),

  getServiceSummary: (params?: PaginatedQueryParams): Promise<ServiceReportSummary> =>
    api.get<ServiceReportSummary>(`/api/reports/service/summary${buildPaginatedQuery(params)}`),

  getServiceDetails: (type: 'work-details' | 'field-trips' | 'productivity-details', params?: PaginatedQueryParams): Promise<PaginatedResponse<Record<string, any>, ServiceReportSummary['summary']>> =>
    api.get<PaginatedResponse<Record<string, any>, ServiceReportSummary['summary']>>(`/api/reports/service/details/${type}${buildPaginatedQuery(params)}`),

  getServiceExport: (params?: PaginatedQueryParams): Promise<{
    period: ServiceReportSummary['period'];
    rows: MechanicWorkloadRow[];
    fieldTrips: MechanicFieldTripRow[];
    productivity?: MechanicsProductivityReport;
    summary: ServiceReportSummary['summary'];
  }> =>
    api.get(`/api/reports/service/export${buildPaginatedQuery(params)}`),

  getMechanicsWorkload: (): Promise<MechanicsWorkloadReport> =>
    api.get<MechanicsWorkloadReport>('/api/reports/mechanics-workload'),

  migrateRepairFacts: (): Promise<RepairFactsMigrationResult> =>
    api.post<RepairFactsMigrationResult>('/api/admin/migrate-repair-facts', {}),
};
