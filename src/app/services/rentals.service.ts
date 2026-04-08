import { api } from '../lib/api';
import type { Rental } from '../types';
import type { GanttRentalData } from '../mock-data';

export const rentalsService = {
  getAll: (): Promise<Rental[]> =>
    api.get<Rental[]>('/api/rentals'),

  getById: (id: string): Promise<Rental | undefined> =>
    api.get<Rental>(`/api/rentals/${id}`).catch(() => undefined),

  getGanttData: (): Promise<GanttRentalData[]> =>
    api.get<GanttRentalData[]>('/api/gantt_rentals'),

  create: (data: Omit<Rental, 'id'>): Promise<Rental> =>
    api.post<Rental>('/api/rentals', data),

  update: (id: string, data: Partial<Rental>): Promise<Rental> =>
    api.patch<Rental>(`/api/rentals/${id}`, data),

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
