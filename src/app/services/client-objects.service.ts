import { api } from '../lib/api';
import type { ClientObject, ClientObjectCreateInput } from '../types';

export const clientObjectsService = {
  getAll: (): Promise<ClientObject[]> =>
    api.get<ClientObject[]>('/api/client_objects'),

  create: (data: ClientObjectCreateInput, idempotencyKey?: string): Promise<ClientObject> =>
    api.post<ClientObject>('/api/client_objects', data, idempotencyKey ? {
      headers: { 'Idempotency-Key': idempotencyKey },
    } : undefined),

  update: (id: string, data: Partial<ClientObject>): Promise<ClientObject> =>
    api.patch<ClientObject>(`/api/client_objects/${id}`, data),
};
