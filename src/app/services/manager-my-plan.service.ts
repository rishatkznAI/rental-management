import { api } from '../lib/api';

export type ManagerMyPlanStatus = 'done' | 'needs_activity' | 'unknown';
export type ManagerMyPlanTaskLevel = 'risk' | 'warning' | 'info';
export type ManagerMyPlanTaskType =
  | 'return'
  | 'debt'
  | 'document'
  | 'idle_equipment'
  | 'client_activity'
  | 'rental_extension';

export type ManagerMyPlanLink = {
  label: string;
  type: 'rental' | 'client' | 'equipment' | 'document';
  id: string;
};

export type ManagerMyPlanRentalItem = {
  id: string;
  label: string;
  clientId: string;
  clientName: string;
  equipmentId: string;
  equipmentLabel: string;
  startDate: string;
  endDate: string;
  status: string;
};

export type ManagerMyPlanDebtItem = {
  id: string;
  clientId: string;
  clientName: string;
  rentalId: string;
  amount: number;
};

export type ManagerMyPlanDocumentItem = {
  id: string;
  label: string;
  type: string;
  status: string;
  clientId: string;
  clientName: string;
  rentalId: string;
};

export type ManagerMyPlanClientItem = {
  id: string;
  label: string;
  lastActivityDate: string;
  managerName: string;
};

export type ManagerMyPlanResponse = {
  summary: {
    managerName: string;
    fleetUtilizationPercent: number;
    planStatus: ManagerMyPlanStatus;
    activeRentals: number;
    rentalsEndingSoon: number;
    overdueReturns: number;
    debtAmount: number;
    documentsMissing: number;
    clientsWithoutActivity: number;
  };
  activityTarget: {
    required: boolean;
    reason: string;
    dailyCallsTarget: number;
    weeklySiteVisitsTarget: number;
    message: string;
  };
  tasks: Array<{
    level: ManagerMyPlanTaskLevel;
    type: ManagerMyPlanTaskType;
    title: string;
    description: string;
    action: string;
    link: ManagerMyPlanLink;
  }>;
  rentals: {
    endingToday: ManagerMyPlanRentalItem[];
    endingTomorrow: ManagerMyPlanRentalItem[];
    overdue: ManagerMyPlanRentalItem[];
    active: ManagerMyPlanRentalItem[];
  };
  money: {
    debtors: ManagerMyPlanDebtItem[];
    totalDebt: number;
  };
  documents: {
    missingContract: ManagerMyPlanRentalItem[];
    missingUpd: ManagerMyPlanRentalItem[];
    unsigned: ManagerMyPlanDocumentItem[];
  };
  clients: {
    withoutRecentActivity: ManagerMyPlanClientItem[];
  };
};

export const managerMyPlanService = {
  get: (): Promise<ManagerMyPlanResponse> =>
    api.get<ManagerMyPlanResponse>('/api/manager/my-plan'),
};
