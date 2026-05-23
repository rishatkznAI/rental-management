import { api } from '../lib/api';

export type ManagerMyPlanStatus = 'done' | 'needs_activity' | 'unknown';
export type ManagerActivityType = 'call' | 'site_visit' | 'note';
export type ManagerActivityResultStatus = 'completed' | 'no_answer' | 'scheduled' | 'info' | 'other';
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

export type ManagerActivityItem = {
  id: string;
  createdAt: string;
  createdBy: string;
  userId: string;
  managerId: string;
  managerName: string;
  activityType: ManagerActivityType;
  relatedClientId: string;
  relatedRentalId: string;
  relatedEquipmentId: string;
  relatedLabel: string;
  resultStatus: ManagerActivityResultStatus;
  comment: string;
  activityDate: string;
  effectiveAt: string;
};

export type ManagerActivityInput = {
  activityType: ManagerActivityType;
  resultStatus: ManagerActivityResultStatus;
  comment?: string;
  relatedClientId?: string;
  relatedRentalId?: string;
  relatedEquipmentId?: string;
  activityDate?: string;
  effectiveAt?: string;
};

export type ManagerActivityAggregates = {
  todayCallsDone: number;
  todayCallsTarget: number;
  weekSiteVisitsDone: number;
  weekSiteVisitsTarget: number;
  activityProgressStatus: 'optional' | 'complete' | 'in_progress' | 'not_started';
  nextRecommendedAction: string;
  completionPercent: number;
  recentActivity: ManagerActivityItem[];
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
    todayCallsDone: number;
    todayCallsTarget: number;
    weekSiteVisitsDone: number;
    weekSiteVisitsTarget: number;
    activityProgressStatus: ManagerActivityAggregates['activityProgressStatus'];
    nextRecommendedAction: string;
    completionPercent: number;
  };
  activityTarget: {
    required: boolean;
    reason: string;
    dailyCallsTarget: number;
    weeklySiteVisitsTarget: number;
    message: string;
    todayCallsDone: number;
    todayCallsTarget: number;
    weekSiteVisitsDone: number;
    weekSiteVisitsTarget: number;
    activityProgressStatus: ManagerActivityAggregates['activityProgressStatus'];
    nextRecommendedAction: string;
    completionPercent: number;
  };
  recentActivity: ManagerActivityItem[];
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
  createActivity: (input: ManagerActivityInput): Promise<{ ok: true; item: ManagerActivityItem }> =>
    api.post<{ ok: true; item: ManagerActivityItem }>('/api/manager/my-plan/activity', input),
};
