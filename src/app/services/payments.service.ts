import { api } from '../lib/api';
import type { Payment } from '../types';

export const paymentsService = {
  getAll: (): Promise<Payment[]> =>
    api.get<Payment[]>('/api/payments'),

  getById: (id: string): Promise<Payment | undefined> =>
    api.get<Payment>(`/api/payments/${id}`).catch(() => undefined),

  create: (data: Omit<Payment, 'id'>): Promise<Payment> =>
    api.post<Payment>('/api/payments', data),

  update: (id: string, data: Partial<Payment>): Promise<Payment> =>
    api.patch<Payment>(`/api/payments/${id}`, data),

  bulkReplace: (list: Payment[]): Promise<void> =>
    api.put('/api/payments', list),
};
