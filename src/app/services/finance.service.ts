import { api } from '../lib/api';
import type {
  ManagerBreakdownResponse,
  ReceivableCollectionAction,
  ReceivablePaymentPlanItem,
  ReceivablesResponse,
} from '../types';

export const financeService = {
  getManagerBreakdown: (manager: string, today?: string): Promise<ManagerBreakdownResponse> => {
    const params = new URLSearchParams({ manager });
    if (today) params.set('today', today);
    return api.get<ManagerBreakdownResponse>(`/api/finance/manager-breakdown?${params.toString()}`);
  },
  getReceivables: (today?: string): Promise<ReceivablesResponse> => {
    const params = new URLSearchParams();
    if (today) params.set('today', today);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return api.get<ReceivablesResponse>(`/api/finance/receivables${suffix}`);
  },
  createReceivableAction: (
    data: Omit<ReceivableCollectionAction, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ReceivableCollectionAction> =>
    api.post<ReceivableCollectionAction>('/api/finance/receivables/actions', data),
  updateReceivableAction: (
    id: string,
    data: Partial<ReceivableCollectionAction>,
  ): Promise<ReceivableCollectionAction> =>
    api.patch<ReceivableCollectionAction>(`/api/finance/receivables/actions/${id}`, data),
  createReceivableWorkflowAction: (
    data: Partial<ReceivableCollectionAction> & Pick<ReceivableCollectionAction, 'clientId' | 'actionType'>,
  ): Promise<{ action: ReceivableCollectionAction; document?: unknown }> =>
    api.post<{ action: ReceivableCollectionAction; document?: unknown }>('/api/finance/receivables/workflow-actions', data),
  createReceivablePaymentPlan: (
    data: Omit<ReceivablePaymentPlanItem, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<ReceivablePaymentPlanItem> =>
    api.post<ReceivablePaymentPlanItem>('/api/finance/receivables/payment-plans', data),
  updateReceivablePaymentPlan: (
    id: string,
    data: Partial<ReceivablePaymentPlanItem>,
  ): Promise<ReceivablePaymentPlanItem> =>
    api.patch<ReceivablePaymentPlanItem>(`/api/finance/receivables/payment-plans/${id}`, data),
};
