import { api } from '../lib/api';
import type { ServiceScenario } from '../types';

export interface MechanicWorkloadSummary {
  mechanicId: string;
  mechanicName: string;
  repairsCount: number;
  worksCount: number;
  totalNormHours: number;
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

export interface MechanicsWorkloadReport {
  summary: MechanicWorkloadSummary[];
  rows: MechanicWorkloadRow[];
  repeatFailures: RepeatFailureRow[];
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
