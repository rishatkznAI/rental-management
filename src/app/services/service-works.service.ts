import { api } from '../lib/api';
import type { ServiceWork } from '../types';

export const serviceWorksService = {
  getAll: (): Promise<ServiceWork[]> =>
    api.get<ServiceWork[]>('/api/service_works'),

  getActive: (): Promise<ServiceWork[]> =>
    api.get<ServiceWork[]>('/api/service_works?active=1'),

  create: (data: Omit<ServiceWork, 'id' | 'createdAt' | 'updatedAt'>): Promise<ServiceWork> =>
    api.post<ServiceWork>('/api/service_works', data),

  update: (id: string, data: Partial<ServiceWork>): Promise<ServiceWork> =>
    api.patch<ServiceWork>(`/api/service_works/${id}`, data),

  deactivate: (id: string): Promise<ServiceWork> =>
    api.post<ServiceWork>(`/api/service_works/${id}/deactivate`, {}),

  bulkReplace: (list: ServiceWork[]): Promise<void> =>
    api.put('/api/service_works', list),
};
