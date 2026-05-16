import { api, buildPaginatedQuery, type PaginatedQueryParams, type PaginatedResponse } from '../lib/api';
import type { Payment, PaymentAllocation } from '../types';

export const paymentsService = {
  getAll: (): Promise<Payment[]> =>
    api.get<Payment[]>('/api/payments'),

  getPaginated: (params?: PaginatedQueryParams): Promise<PaginatedResponse<Payment>> =>
    api.get<PaginatedResponse<Payment>>(`/api/payments${buildPaginatedQuery(params)}`),

  getAllocations: (): Promise<PaymentAllocation[]> =>
    api.get<PaymentAllocation[]>('/api/payment_allocations'),

  createAllocation: (data: Omit<PaymentAllocation, 'id'>): Promise<PaymentAllocation> =>
    api.post<PaymentAllocation>('/api/payment_allocations', data),

  updateAllocation: (id: string, data: Partial<PaymentAllocation>): Promise<PaymentAllocation> =>
    api.patch<PaymentAllocation>(`/api/payment_allocations/${id}`, data),

  deleteAllocation: (id: string): Promise<void> =>
    api.del<void>(`/api/payment_allocations/${id}`),

  getById: (id: string): Promise<Payment | undefined> =>
    api.get<Payment>(`/api/payments/${id}`).catch(() => undefined),

  create: (data: Omit<Payment, 'id'>): Promise<Payment> =>
    api.post<Payment>('/api/payments', data),

  update: (id: string, data: Partial<Payment>): Promise<Payment> =>
    api.patch<Payment>(`/api/payments/${id}`, data),

  delete: (id: string): Promise<void> =>
    api.del<void>(`/api/payments/${id}`),

  bulkReplace: (list: Payment[]): Promise<void> =>
    api.put('/api/payments', list),
};
