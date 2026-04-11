import { api } from '../lib/api';
import { normalizeEquipment, normalizeEquipmentList } from '../lib/equipmentClassification';
import type { Equipment, RepairRecord, ShippingPhoto } from '../types';

export const equipmentService = {
  getAll: (): Promise<Equipment[]> =>
    api.get<Equipment[]>('/api/equipment').then(normalizeEquipmentList),

  getById: (id: string): Promise<Equipment | undefined> =>
    api.get<Equipment>(`/api/equipment/${id}`).then(normalizeEquipment).catch(() => undefined),

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
    api.patch<Equipment>(`/api/equipment/${id}`, normalizeEquipment(data)).then(normalizeEquipment),

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
