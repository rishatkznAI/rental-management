import { api } from '../lib/api';
import type { DebtCollectionPlan } from '../types';

export type DebtCollectionPlanListResponse = {
  plans: DebtCollectionPlan[];
  permissions?: {
    canViewFinance?: boolean;
    canManage?: boolean;
  };
};

export const debtCollectionPlansService = {
  getAll: (): Promise<DebtCollectionPlanListResponse> =>
    api.get<DebtCollectionPlanListResponse>('/api/debt-collection-plans'),

  create: (data: Omit<DebtCollectionPlan, 'id' | 'createdAt' | 'updatedAt'>): Promise<DebtCollectionPlan> =>
    api.post<DebtCollectionPlan>('/api/debt-collection-plans', data),

  update: (id: string, data: Partial<DebtCollectionPlan>): Promise<DebtCollectionPlan> =>
    api.patch<DebtCollectionPlan>(`/api/debt-collection-plans/${id}`, data),
};
