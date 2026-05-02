import { api } from '../lib/api';
import type { Rental } from '../types';
import type { GanttRentalData } from '../mock-data';

export type RentalExtensionConflict = {
  date: string;
  startDate: string;
  endDate: string;
  client: string;
  rentalId: string;
  ganttRentalId?: string;
  status: string;
};

export type RentalExtensionResponse = {
  ok: boolean;
  applied: boolean;
  rental?: Rental;
  ganttRental?: GanttRentalData;
  conflict?: RentalExtensionConflict | null;
  approval?: {
    created: boolean;
    requestIds: string[];
  };
};

export const rentalsService = {
  getAll: (): Promise<Rental[]> =>
    api.get<Rental[]>('/api/rentals'),

  getById: (id: string): Promise<Rental | undefined> =>
    api.get<Rental>(`/api/rentals/${id}`).catch(() => undefined),

  getAuditHistory: (id: string): Promise<{
    ok: boolean;
    rentalId: string;
    ganttRentalId: string;
    canViewFinance: boolean;
    logs: Array<{
      id: string;
      createdAt: string;
      userName: string;
      role: string;
      action: string;
      actionLabel: string;
      actionKind: string;
      entityType: string;
      entityId: string;
      description: string;
      changes: Array<{ field: string; label: string; before: unknown; after: unknown; hidden?: boolean }>;
    }>;
  }> => api.get(`/api/rentals/${id}/audit`),

  getGanttData: (): Promise<GanttRentalData[]> =>
    api.get<GanttRentalData[]>('/api/gantt_rentals'),

  create: (data: Omit<Rental, 'id'>): Promise<Rental> =>
    api.post<Rental>('/api/rentals', data),

  update: (id: string, data: Partial<Rental>): Promise<Rental> =>
    api.patch<Rental>(`/api/rentals/${id}`, data),

  returnRental: (
    id: string,
    data: { returnDate: string; result?: string; hasDamage?: boolean; damageDescription?: string },
  ): Promise<{
    ok: boolean;
    rental?: Rental;
    ganttRental?: GanttRentalData;
    equipment?: unknown;
    serviceTicket?: unknown;
  }> => api.post(`/api/rentals/${id}/return`, data),

  extend: (
    id: string,
    data: { newPlannedReturnDate: string; reason: string; comment?: string },
  ): Promise<RentalExtensionResponse> => api.post(`/api/rentals/${id}/extend`, data),

  delete: (id: string): Promise<void> =>
    api.del(`/api/rentals/${id}`),

  bulkReplace: (list: Rental[]): Promise<void> =>
    api.put('/api/rentals', list),

  // Gantt-specific
  createGanttEntry: (data: Omit<GanttRentalData, 'id'>): Promise<GanttRentalData> =>
    api.post<GanttRentalData>('/api/gantt_rentals', data),

  updateGanttEntry: (id: string, data: Partial<GanttRentalData>): Promise<GanttRentalData> =>
    api.patch<GanttRentalData>(`/api/gantt_rentals/${id}`, data),

  deleteGanttEntry: (id: string): Promise<void> =>
    api.del(`/api/gantt_rentals/${id}`),

  bulkReplaceGantt: (list: GanttRentalData[]): Promise<void> =>
    api.put('/api/gantt_rentals', list),
};
