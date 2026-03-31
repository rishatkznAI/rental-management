import {
  mockEquipment,
  mockRepairRecords,
  mockShippingPhotos,
} from '../mock-data';
import type { Equipment, RepairRecord, ShippingPhoto } from '../types';

// ---------------------------------------------------------------------------
// EquipmentService — абстракция над источником данных.
// Сейчас работает с mock-data; для перехода на реальный API достаточно
// заменить тела методов на fetch-вызовы — интерфейс остаётся прежним.
// ---------------------------------------------------------------------------

export const equipmentService = {
  getAll: async (): Promise<Equipment[]> => {
    return [...mockEquipment];
  },

  getById: async (id: string): Promise<Equipment | undefined> => {
    return mockEquipment.find((e) => e.id === id);
  },

  getRepairRecords: async (equipmentId: string): Promise<RepairRecord[]> => {
    return mockRepairRecords.filter((r) => r.equipmentId === equipmentId);
  },

  getShippingPhotos: async (equipmentId: string): Promise<ShippingPhoto[]> => {
    return mockShippingPhotos.filter((p) => p.equipmentId === equipmentId);
  },

  // Заглушки для мутаций — заменить на API-вызовы при подключении бэкенда
  create: async (data: Omit<Equipment, 'id'>): Promise<Equipment> => {
    const newItem: Equipment = { ...data, id: Date.now().toString() };
    mockEquipment.push(newItem);
    return newItem;
  },

  update: async (id: string, data: Partial<Equipment>): Promise<Equipment> => {
    const idx = mockEquipment.findIndex((e) => e.id === id);
    if (idx === -1) throw new Error(`Equipment ${id} not found`);
    mockEquipment[idx] = { ...mockEquipment[idx], ...data };
    return mockEquipment[idx];
  },

  delete: async (id: string): Promise<void> => {
    const idx = mockEquipment.findIndex((e) => e.id === id);
    if (idx !== -1) mockEquipment.splice(idx, 1);
  },
};
