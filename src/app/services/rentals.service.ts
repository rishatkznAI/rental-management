import { api, buildPaginatedQuery, type PaginatedQueryParams, type PaginatedResponse } from '../lib/api';
import type { Rental } from '../types';
import type { DowntimePeriod, GanttRentalData } from '../mock-data';

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
  financialImpact?: {
    extensionDays: number;
    dailyRate: number;
    rateSource: string;
    additionalAmount: number;
    previousAmount: number;
    nextAmount: number;
    paidAmount: number;
    outstanding: number;
    nextPaymentStatus: string;
  };
  approval?: {
    created: boolean;
    requestIds: string[];
  };
};

export type RentalDowntimeResponse = {
  ok: boolean;
  applied?: boolean;
  downtime: DowntimePeriod;
  rental?: Rental;
  ganttRental?: GanttRentalData | null;
  approval?: {
    created: boolean;
    requestIds: string[];
  };
};

export type GanttRentalRepairResponse = {
  ok: boolean;
  applied: boolean;
  productionDataChanged: boolean;
  dryRun: boolean;
  summary: {
    requestedCount: number;
    repairableCount: number;
    skippedCount: number;
  };
  operations: Array<{
    type: string;
    id: string;
    reason: string;
    confidence: 'high' | 'medium' | 'low';
    repairAllowed: boolean;
    before: Record<string, string>;
    after: Record<string, string>;
  }>;
};

export const rentalsService = {
  getAll: (): Promise<Rental[]> =>
    api.get<Rental[]>('/api/rentals'),

  getPaginated: (params?: PaginatedQueryParams): Promise<PaginatedResponse<Rental>> =>
    api.get<PaginatedResponse<Rental>>(`/api/rentals${buildPaginatedQuery(params)}`),

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

  getDowntimes: (): Promise<DowntimePeriod[]> =>
    api.get<DowntimePeriod[]>('/api/equipment_downtimes'),

  getRentalDowntimes: (id: string): Promise<{ ok: boolean; rentalId: string; downtimes: DowntimePeriod[] }> =>
    api.get(`/api/rentals/${id}/downtimes`),

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
    data: { newEndDate?: string; newPlannedReturnDate?: string; reason: string; comment?: string; confirmedByClient: boolean; invoiceSentToClient?: boolean },
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

  repairGanttLinks: (data: { ids?: string[]; apply?: boolean; backupVerified?: boolean; confirm?: string }): Promise<GanttRentalRepairResponse> =>
    api.post<GanttRentalRepairResponse>('/api/admin/diagnostics/gantt-rentals-repair', data),

  createDowntime: (data: Omit<DowntimePeriod, 'id'>): Promise<DowntimePeriod> =>
    api.post<DowntimePeriod>('/api/equipment_downtimes', data),

  updateDowntime: (id: string, data: Partial<DowntimePeriod>): Promise<DowntimePeriod> =>
    api.patch<DowntimePeriod>(`/api/equipment_downtimes/${id}`, data),

  createRentalDowntime: (id: string, data: Omit<DowntimePeriod, 'id'> & Record<string, unknown>): Promise<RentalDowntimeResponse> =>
    api.post<RentalDowntimeResponse>(`/api/rentals/${id}/downtimes`, data),

  updateRentalDowntime: (
    id: string,
    downtimeId: string,
    data: Partial<DowntimePeriod> & Record<string, unknown>,
  ): Promise<RentalDowntimeResponse> =>
    api.patch<RentalDowntimeResponse>(`/api/rentals/${id}/downtimes/${downtimeId}`, data),

  cancelRentalDowntime: (id: string, downtimeId: string, data: Record<string, unknown> = {}): Promise<RentalDowntimeResponse> =>
    api.post<RentalDowntimeResponse>(`/api/rentals/${id}/downtimes/${downtimeId}/cancel`, data),
};
