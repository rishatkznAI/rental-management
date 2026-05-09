import { api } from '../lib/api';
import type { LeasingContract, LeasingSummary } from '../types';

export const LEASING_KEYS = {
  all: ['leasing-contracts'] as const,
  summary: ['leasing-contracts', 'summary'] as const,
  detail: (id: string) => ['leasing-contracts', id] as const,
};

export const leasingService = {
  getAll: (): Promise<LeasingContract[]> =>
    api.get<LeasingContract[]>('/api/leasing-contracts'),

  getSummary: (): Promise<LeasingSummary> =>
    api.get<LeasingSummary>('/api/leasing-contracts/summary'),

  getById: (id: string): Promise<LeasingContract | undefined> =>
    api.get<LeasingContract>(`/api/leasing-contracts/${id}`).catch(() => undefined),

  create: (data: Omit<LeasingContract, 'id' | 'createdAt' | 'updatedAt'>): Promise<LeasingContract> =>
    api.post<LeasingContract>('/api/leasing-contracts', data),

  update: (id: string, data: Partial<LeasingContract>): Promise<LeasingContract> =>
    api.patch<LeasingContract>(`/api/leasing-contracts/${id}`, data),

  delete: (id: string): Promise<void> =>
    api.del<void>(`/api/leasing-contracts/${id}`),
};
