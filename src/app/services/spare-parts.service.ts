import { api } from '../lib/api';
import type { SparePart } from '../types';

export const sparePartsService = {
  getAll: (): Promise<SparePart[]> =>
    api.get<SparePart[]>('/api/spare_parts'),

  getActive: (): Promise<SparePart[]> =>
    api.get<SparePart[]>('/api/spare_parts?active=1'),

  create: (data: Omit<SparePart, 'id' | 'createdAt' | 'updatedAt'>): Promise<SparePart> =>
    api.post<SparePart>('/api/spare_parts', data),

  update: (id: string, data: Partial<SparePart>): Promise<SparePart> =>
    api.patch<SparePart>(`/api/spare_parts/${id}`, data),

  deactivate: (id: string): Promise<SparePart> =>
    api.post<SparePart>(`/api/spare_parts/${id}/deactivate`, {}),

  bulkReplace: (list: SparePart[]): Promise<void> =>
    api.put('/api/spare_parts', list),
};
