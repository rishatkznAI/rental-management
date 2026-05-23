import { api } from '../lib/api';
import type {
  FinanceAccount,
  FinanceEconomicsResponse,
  FinanceOperation,
  CashFlowResponse,
  CompanyTaxSettings,
  DepreciationResponse,
  ManagerBreakdownResponse,
  ReceivableCollectionAction,
  ReceivablePaymentPlanItem,
  ReceivablesResponse,
} from '../types';

export const financeService = {
  getAccounts: (): Promise<FinanceAccount[]> =>
    api.get<FinanceAccount[]>('/api/finance/accounts'),
  createAccount: (
    data: Omit<FinanceAccount, 'id' | 'createdAt' | 'updatedAt'>,
  ): Promise<FinanceAccount> =>
    api.post<FinanceAccount>('/api/finance/accounts', data),
  updateAccount: (
    id: string,
    data: Partial<FinanceAccount> & { forceArchive?: boolean },
  ): Promise<FinanceAccount> =>
    api.patch<FinanceAccount>(`/api/finance/accounts/${id}`, data),
  transferBetweenAccounts: (data: {
    accountFrom: string;
    accountTo: string;
    amount: number;
    date: string;
    description?: string;
    comment?: string;
  }): Promise<{ from: FinanceAccount; to: FinanceAccount; operation: FinanceOperation }> =>
    api.post<{ from: FinanceAccount; to: FinanceAccount; operation: FinanceOperation }>('/api/finance/accounts/transfer', data),
  getOperations: (from?: string, to?: string): Promise<FinanceOperation[]> => {
    const params = new URLSearchParams();
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    const suffix = params.toString() ? `?${params.toString()}` : '';
    return api.get<FinanceOperation[]>(`/api/finance/operations${suffix}`);
  },
  getTaxSettings: (): Promise<CompanyTaxSettings> =>
    api.get<CompanyTaxSettings>('/api/finance/tax-settings'),
  updateTaxSettings: (data: CompanyTaxSettings): Promise<CompanyTaxSettings> =>
    api.patch<CompanyTaxSettings>('/api/finance/tax-settings', data),
  getCashFlow: (params: {
    dateFrom: string;
    dateTo: string;
    groupBy: 'day' | 'week' | 'month';
    mode: 'expected' | 'factual' | 'all';
    includeVat: boolean;
    includeDepreciation: boolean;
  }): Promise<CashFlowResponse> => {
    const query = new URLSearchParams({
      dateFrom: params.dateFrom,
      dateTo: params.dateTo,
      groupBy: params.groupBy,
      mode: params.mode,
      includeVat: String(params.includeVat),
      includeDepreciation: String(params.includeDepreciation),
    });
    return api.get<CashFlowResponse>(`/api/finance/cash-flow?${query.toString()}`);
  },
  getDepreciation: (): Promise<DepreciationResponse> =>
    api.get<DepreciationResponse>('/api/finance/depreciation'),
  createOperation: (
    data: Omit<FinanceOperation, 'id' | 'createdAt' | 'updatedAt' | 'source'>,
  ): Promise<FinanceOperation> =>
    api.post<FinanceOperation>('/api/finance/operations', data),
  updateOperation: (
    id: string,
    data: Partial<FinanceOperation>,
  ): Promise<FinanceOperation> =>
    api.patch<FinanceOperation>(`/api/finance/operations/${id}`, data),
  getEconomics: (params: {
    dateFrom?: string;
    dateTo?: string;
    groupBy?: 'month' | 'quarter' | 'year';
    includeDepreciation?: boolean;
    includeVat?: boolean;
    equipmentGroup?: 'all' | 'rented' | 'idle' | 'service' | 'sale';
  }): Promise<FinanceEconomicsResponse> => {
    const query = new URLSearchParams();
    if (params.dateFrom) query.set('dateFrom', params.dateFrom);
    if (params.dateTo) query.set('dateTo', params.dateTo);
    if (params.groupBy) query.set('groupBy', params.groupBy);
    if (params.includeDepreciation != null) query.set('includeDepreciation', String(params.includeDepreciation));
    if (params.includeVat != null) query.set('includeVat', String(params.includeVat));
    if (params.equipmentGroup) query.set('equipmentGroup', params.equipmentGroup);
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return api.get<FinanceEconomicsResponse>(`/api/finance/economics${suffix}`);
  },
  previewPaymentAllocation: (paymentId: string): Promise<{ paymentId: string; unallocatedAmount: number; suggestedAllocations: unknown[] }> =>
    api.post<{ paymentId: string; unallocatedAmount: number; suggestedAllocations: unknown[] }>(
      `/api/finance/payments/${paymentId}/allocation-preview`,
      {},
    ),
  applyPaymentAllocationPreview: (paymentId: string, allocations?: unknown[]): Promise<{ paymentId: string; allocations: unknown[] }> =>
    api.post<{ paymentId: string; allocations: unknown[] }>(
      `/api/finance/payments/${paymentId}/apply-allocation-preview`,
      allocations ? { allocations } : {},
    ),
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
