import { api } from '../lib/api';
import type { ClientObject, ClientObjectCreateInput } from '../types';

export type ClientObjectLifecycleReference = {
  collection: string;
  recordId: string | null;
  reason: string;
  referenceFields: string[];
  classification: 'active' | 'historical';
  blocking: boolean;
};

export type ClientObjectLifecycleAnalysis = {
  entityType: 'client_object';
  entityId: string;
  status: 'active' | 'archived';
  activeReferences: ClientObjectLifecycleReference[];
  historicalReferences: ClientObjectLifecycleReference[];
  blockers: ClientObjectLifecycleReference[];
  canArchive: boolean;
  canDelete: boolean;
};

export const clientObjectsService = {
  getAll: (): Promise<ClientObject[]> =>
    api.get<ClientObject[]>('/api/client_objects'),

  create: (data: ClientObjectCreateInput, idempotencyKey?: string): Promise<ClientObject> =>
    api.post<ClientObject>('/api/client_objects', data, idempotencyKey ? {
      headers: { 'Idempotency-Key': idempotencyKey },
    } : undefined),

  update: (id: string, data: Partial<ClientObject>): Promise<ClientObject> =>
    api.patch<ClientObject>(`/api/client_objects/${id}`, data),

  getLifecycle: (id: string): Promise<ClientObjectLifecycleAnalysis> =>
    api.get<ClientObjectLifecycleAnalysis>(`/api/client_objects/${id}/lifecycle`),

  archive: (id: string): Promise<{ ok: true; changed: boolean; clientObject: ClientObject }> =>
    api.post<{ ok: true; changed: boolean; clientObject: ClientObject }>(`/api/client_objects/${id}/archive`, {}),

  delete: (id: string): Promise<{ ok: true; changed: boolean; deletedId: string }> =>
    api.delete<{ ok: true; changed: boolean; deletedId: string }>(`/api/client_objects/${id}`),
};
