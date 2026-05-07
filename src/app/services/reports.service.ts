import { api } from '../lib/api';
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

export interface RepairFactsMigrationResult {
  ok: true;
  createdWorkRefs: number;
  createdPartRefs: number;
  migratedWorkItems: number;
  migratedPartItems: number;
  ticketsScanned: number;
}

export const reportsService = {
  getMechanicsWorkload: (): Promise<MechanicsWorkloadReport> =>
    api.get<MechanicsWorkloadReport>('/api/reports/mechanics-workload'),

  migrateRepairFacts: (): Promise<RepairFactsMigrationResult> =>
    api.post<RepairFactsMigrationResult>('/api/admin/migrate-repair-facts', {}),
};
