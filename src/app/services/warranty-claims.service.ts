import { api } from '../lib/api';
import type { WarrantyClaim } from '../types';

export const warrantyClaimsService = {
  getAll: (): Promise<WarrantyClaim[]> =>
    api.get<WarrantyClaim[]>('/api/warranty_claims'),

  create: (data: Omit<WarrantyClaim, 'id'>): Promise<WarrantyClaim> =>
    api.post<WarrantyClaim>('/api/warranty_claims', data),

  update: (id: string, data: Partial<WarrantyClaim>): Promise<WarrantyClaim> =>
    api.patch<WarrantyClaim>(`/api/warranty_claims/${id}`, data),

  delete: (id: string): Promise<void> =>
    api.del(`/api/warranty_claims/${id}`),
};
