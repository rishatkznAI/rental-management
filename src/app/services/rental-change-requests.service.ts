import { api } from '../lib/api';
import type { RentalChangeRequest } from '../types';

export const rentalChangeRequestsService = {
  getAll: (): Promise<RentalChangeRequest[]> =>
    api.get<RentalChangeRequest[]>('/api/rental_change_requests'),

  getById: (id: string): Promise<RentalChangeRequest | undefined> =>
    api.get<RentalChangeRequest>(`/api/rental_change_requests/${id}`).catch(() => undefined),

  approve: (id: string, comment?: string): Promise<RentalChangeRequest> =>
    api.post<RentalChangeRequest>(`/api/rental_change_requests/${id}/approve`, { comment }),

  reject: (id: string, reason: string): Promise<RentalChangeRequest> =>
    api.post<RentalChangeRequest>(`/api/rental_change_requests/${id}/reject`, { reason }),
};
