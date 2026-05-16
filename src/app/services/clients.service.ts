import { api, buildPaginatedQuery, type PaginatedQueryParams, type PaginatedResponse } from '../lib/api';
import type { Client } from '../types';

export const clientsService = {
  getAll: (): Promise<Client[]> =>
    api.get<Client[]>('/api/clients'),

  getPaginated: (params?: PaginatedQueryParams): Promise<PaginatedResponse<Client>> =>
    api.get<PaginatedResponse<Client>>(`/api/clients${buildPaginatedQuery(params)}`),

  getById: (id: string): Promise<Client | undefined> =>
    api.get<Client>(`/api/clients/${id}`).catch(() => undefined),

  create: (data: Omit<Client, 'id'>): Promise<Client> =>
    api.post<Client>('/api/clients', data),

  update: (id: string, data: Partial<Client>): Promise<Client> =>
    api.patch<Client>(`/api/clients/${id}`, data),

  delete: (id: string): Promise<void> =>
    api.del(`/api/clients/${id}`),

  bulkReplace: (list: Client[]): Promise<void> =>
    api.put('/api/clients', list),
};
