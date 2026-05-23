import { ApiError, api, buildPaginatedQuery, type PaginatedQueryParams, type PaginatedResponse } from '../lib/api';
import { normalizeEquipment, normalizeEquipmentList, normalizeEquipmentPatch } from '../lib/equipmentClassification';
import type { Equipment, EquipmentEconomicsResponse, EquipmentFinance, FleetReadinessResponse, ManagementActionAssigneesResponse, ManagementActionAttentionResponse, ManagementActionQueueResponse, ManagementActionStateUpdate, RepairRecord, ShippingPhoto } from '../types';

export const equipmentService = {
  getAll: (): Promise<Equipment[]> =>
    api.get<Equipment[]>('/api/equipment').then(normalizeEquipmentList),

  getPaginated: (params?: PaginatedQueryParams): Promise<PaginatedResponse<Equipment>> =>
    api.get<PaginatedResponse<Equipment>>(`/api/equipment${buildPaginatedQuery(params)}`)
      .then(response => ({ ...response, items: normalizeEquipmentList(response.items) })),

  getById: (id: string): Promise<Equipment | undefined> =>
    api.get<Equipment>(`/api/equipment/${id}`).then(normalizeEquipment).catch(() => undefined),

  getEconomics: (id: string): Promise<EquipmentEconomicsResponse> =>
    api.get<EquipmentEconomicsResponse>(`/api/equipment/${id}/economics`).catch(error => {
      if (error instanceof ApiError && error.status === 403) {
        return {
          equipmentId: id,
          finance: {},
          depreciation: {
            status: 'not_configured',
            monthlyDepreciation: 0,
            accumulatedDepreciation: 0,
            residualValue: 0,
            reason: 'restricted',
          },
          status: 'restricted',
          economicsAvailable: false,
        };
      }
      throw error;
    }),

  updateEconomics: (id: string, data: Partial<EquipmentFinance>): Promise<EquipmentEconomicsResponse> =>
    api.patch<EquipmentEconomicsResponse>(`/api/equipment/${id}/economics`, data),

  getReadiness: (): Promise<FleetReadinessResponse> =>
    api.get<FleetReadinessResponse>('/api/equipment/readiness'),

  getManagementActionQueue: (): Promise<ManagementActionQueueResponse> =>
    api.get<ManagementActionQueueResponse>('/api/management/action-queue'),

  getManagementActionAttention: (): Promise<ManagementActionAttentionResponse> =>
    api.get<ManagementActionAttentionResponse>('/api/management/action-queue?view=attention'),

  getManagementActionAssignees: (): Promise<ManagementActionAssigneesResponse> =>
    api.get<ManagementActionAssigneesResponse>('/api/management/action-queue/assignees'),

  updateManagementActionState: (actionId: string, data: ManagementActionStateUpdate): Promise<{ ok: true }> =>
    api.patch<{ ok: true }>(`/api/management/action-queue/${encodeURIComponent(actionId)}/state`, data),

  // RepairRecords не реализованы в текущей архитектуре
  getRepairRecords: async (_equipmentId: string): Promise<RepairRecord[]> => [],

  getShippingPhotos: (equipmentId: string): Promise<ShippingPhoto[]> =>
    api.get<ShippingPhoto[]>(`/api/shipping_photos?equipmentId=${equipmentId}`)
      .then(photos => photos.filter(p => p.equipmentId === equipmentId))
      .catch(() => []),

  getAllShippingPhotos: (): Promise<ShippingPhoto[]> =>
    api.get<ShippingPhoto[]>('/api/shipping_photos').catch(() => []),

  create: (data: Omit<Equipment, 'id'>): Promise<Equipment> =>
    api.post<Equipment>('/api/equipment', normalizeEquipment(data)).then(normalizeEquipment),

  update: (id: string, data: Partial<Equipment>): Promise<Equipment> =>
    api.patch<Equipment>(`/api/equipment/${id}`, normalizeEquipmentPatch(data)).then(normalizeEquipment),

  delete: (id: string): Promise<void> =>
    api.del(`/api/equipment/${id}`),

  bulkReplace: (list: Equipment[]): Promise<void> =>
    api.put('/api/equipment', normalizeEquipmentList(list)),

  // Shipping photos
  createShippingPhoto: (data: Omit<ShippingPhoto, 'id'>): Promise<ShippingPhoto> =>
    api.post<ShippingPhoto>('/api/shipping_photos', data),

  updateShippingPhoto: (id: string, data: Partial<ShippingPhoto>): Promise<ShippingPhoto> =>
    api.patch<ShippingPhoto>(`/api/shipping_photos/${id}`, data),

  deleteShippingPhoto: (id: string): Promise<void> =>
    api.del(`/api/shipping_photos/${id}`),

  bulkReplaceShippingPhotos: (list: ShippingPhoto[]): Promise<void> =>
    api.put('/api/shipping_photos', list),
};
