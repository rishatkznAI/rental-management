import { api } from '../lib/api';
import type { ServiceTicket } from '../types';

export const serviceTicketsService = {
  getAll: (): Promise<ServiceTicket[]> =>
    api.get<ServiceTicket[]>('/api/service'),

  getById: (id: string): Promise<ServiceTicket | undefined> =>
    api.get<ServiceTicket>(`/api/service/${id}`).catch(() => undefined),

  getByEquipmentId: async (equipmentId: string): Promise<ServiceTicket[]> => {
    const all = await api.get<ServiceTicket[]>('/api/service');
    return all.filter(t => t.equipmentId === equipmentId);
  },

  create: (data: Omit<ServiceTicket, 'id'>): Promise<ServiceTicket> =>
    api.post<ServiceTicket>('/api/service', data),

  update: (id: string, data: Partial<ServiceTicket>): Promise<ServiceTicket> =>
    api.patch<ServiceTicket>(`/api/service/${id}`, data),

  delete: (id: string): Promise<void> =>
    api.del(`/api/service/${id}`),

  bulkReplace: (list: ServiceTicket[]): Promise<void> =>
    api.put('/api/service', list),
};
