import { api } from '../lib/api';
import type { ClientObject } from '../types';

export const clientObjectsService = {
  getAll: (): Promise<ClientObject[]> =>
    api.get<ClientObject[]>('/api/client_objects'),

  create: (data: Omit<ClientObject, 'id'>): Promise<ClientObject> =>
    api.post<ClientObject>('/api/client_objects', data),

  update: (id: string, data: Partial<ClientObject>): Promise<ClientObject> =>
    api.patch<ClientObject>(`/api/client_objects/${id}`, data),
};
