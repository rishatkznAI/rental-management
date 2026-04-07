import {
  loadEquipment,
  saveEquipment,
  loadShippingPhotos,
  saveShippingPhotos,
} from '../mock-data';
import type { Equipment, RepairRecord, ShippingPhoto } from '../types';

// ---------------------------------------------------------------------------
// EquipmentService — абстракция над localStorage.
// Интерфейс прежний; тела методов теперь используют те же load/save что и UI,
// чтобы не было рассинхронизации между service-слоем и страницами.
// ---------------------------------------------------------------------------

export const equipmentService = {
  getAll: async (): Promise<Equipment[]> => {
    return loadEquipment();
  },

  getById: async (id: string): Promise<Equipment | undefined> => {
    return loadEquipment().find((e) => e.id === id);
  },

  // RepairRecords не имеют отдельного localStorage-хранилища в текущей архитектуре
  getRepairRecords: async (_equipmentId: string): Promise<RepairRecord[]> => {
    return [];
  },

  getShippingPhotos: async (equipmentId: string): Promise<ShippingPhoto[]> => {
    return loadShippingPhotos().filter((p) => p.equipmentId === equipmentId);
  },

  create: async (data: Omit<Equipment, 'id'>): Promise<Equipment> => {
    const newItem: Equipment = { ...data, id: `eq-${Date.now()}` };
    const list = loadEquipment();
    saveEquipment([...list, newItem]);
    return newItem;
  },

  update: async (id: string, data: Partial<Equipment>): Promise<Equipment> => {
    const list = loadEquipment();
    const idx = list.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`Equipment ${id} not found`);
    list[idx] = { ...list[idx], ...data };
    saveEquipment(list);
    return list[idx];
  },

  delete: async (id: string): Promise<void> => {
    const list = loadEquipment();
    saveEquipment(list.filter((e) => e.id !== id));
  },
};
