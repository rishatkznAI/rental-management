import { api } from '../lib/api';
import type { CrmActivity, CrmActivityInput } from '../types';

export type CrmActivityFilters = {
  managerId?: string;
  clientId?: string;
  dealId?: string;
  type?: string;
  dateFrom?: string;
  dateTo?: string;
  result?: string;
};

export type CrmManagerKpiRow = {
  managerId: string;
  managerName: string;
  actionsTotal: number;
  callsTotal: number;
  qualifiedCalls: number;
  successfulCalls: number;
  uniqueCallClients: number;
  visits: number;
  incompleteVisits: number;
  commercialOffers: number;
  createdDeals: number;
  wonDeals: number;
  rentals: number;
  potentialAmount: number;
  overdueNextActions: number;
  weakActivities: number;
  duplicateCalls: number;
  fleetUtilizationPercent: number;
  activityRequired: boolean;
  callsTarget: number;
  visitsTarget: number;
  warning: string;
};

export type CrmManagerKpiResponse = {
  ok: true;
  fleetUtilizationPercent: number;
  activityRequired: boolean;
  rows: CrmManagerKpiRow[];
};

function queryString(filters: CrmActivityFilters = {}) {
  const params = new URLSearchParams();
  Object.entries(filters).forEach(([key, value]) => {
    if (value) params.set(key, String(value));
  });
  const query = params.toString();
  return query ? `?${query}` : '';
}

export const crmActivitiesService = {
  getAll: (filters?: CrmActivityFilters): Promise<{ ok: true; items: CrmActivity[] }> =>
    api.get<{ ok: true; items: CrmActivity[] }>(`/api/crm/activities${queryString(filters)}`),

  create: (input: CrmActivityInput): Promise<{ ok: true; item: CrmActivity }> =>
    api.post<{ ok: true; item: CrmActivity }>('/api/crm/activities', input),

  update: (id: string, input: Partial<CrmActivityInput>): Promise<{ ok: true; item: CrmActivity }> =>
    api.patch<{ ok: true; item: CrmActivity }>(`/api/crm/activities/${id}`, input),

  delete: (id: string): Promise<{ ok: true }> =>
    api.del<{ ok: true }>(`/api/crm/activities/${id}`),

  getManagerKpi: (filters?: CrmActivityFilters): Promise<CrmManagerKpiResponse> =>
    api.get<CrmManagerKpiResponse>(`/api/crm/manager-kpi${queryString(filters)}`),
};
