import {
  loadGanttRentals,
  saveGanttRentals,
  loadRentals,
  saveRentals,
} from '../mock-data';
import type { Rental } from '../types';
import type { GanttRentalData } from '../mock-data';

export const rentalsService = {
  getAll: async (): Promise<Rental[]> => {
    return loadRentals();
  },

  getById: async (id: string): Promise<Rental | undefined> => {
    return loadRentals().find((r) => r.id === id);
  },

  getGanttData: async (): Promise<GanttRentalData[]> => {
    return loadGanttRentals();
  },

  create: async (data: Omit<Rental, 'id'>): Promise<Rental> => {
    const newItem: Rental = { ...data, id: `R-${Date.now()}` };
    saveRentals([...loadRentals(), newItem]);
    return newItem;
  },

  update: async (id: string, data: Partial<Rental>): Promise<Rental> => {
    const list = loadRentals();
    const idx = list.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`Rental ${id} not found`);
    list[idx] = { ...list[idx], ...data };
    saveRentals(list);
    return list[idx];
  },

  delete: async (id: string): Promise<void> => {
    saveRentals(loadRentals().filter((r) => r.id !== id));
  },
};
