import { api } from '../lib/api';
import type { CrmDeal } from '../types';

export const crmDealsService = {
  getAll: (): Promise<CrmDeal[]> =>
    api.get<CrmDeal[]>('/api/crm_deals'),

  getById: (id: string): Promise<CrmDeal | undefined> =>
    api.get<CrmDeal>(`/api/crm_deals/${id}`).catch(() => undefined),

  create: (data: Omit<CrmDeal, 'id'>): Promise<CrmDeal> =>
    api.post<CrmDeal>('/api/crm_deals', data),

  update: (id: string, data: Partial<CrmDeal>): Promise<CrmDeal> =>
    api.patch<CrmDeal>(`/api/crm_deals/${id}`, data),

  delete: (id: string): Promise<void> =>
    api.del(`/api/crm_deals/${id}`),

  bulkReplace: (list: CrmDeal[]): Promise<void> =>
    api.put('/api/crm_deals', list),
};
