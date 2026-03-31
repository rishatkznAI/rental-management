import { mockRentals, mockGanttRentals } from '../mock-data';
import type { Rental } from '../types';
import type { GanttRentalData } from '../mock-data';

export const rentalsService = {
  getAll: async (): Promise<Rental[]> => {
    return [...mockRentals];
  },

  getById: async (id: string): Promise<Rental | undefined> => {
    return mockRentals.find((r) => r.id === id);
  },

  getGanttData: async (): Promise<GanttRentalData[]> => {
    return [...mockGanttRentals];
  },

  create: async (data: Omit<Rental, 'id'>): Promise<Rental> => {
    const newItem: Rental = { ...data, id: `R-${Date.now()}` };
    mockRentals.push(newItem);
    return newItem;
  },

  update: async (id: string, data: Partial<Rental>): Promise<Rental> => {
    const idx = mockRentals.findIndex((r) => r.id === id);
    if (idx === -1) throw new Error(`Rental ${id} not found`);
    mockRentals[idx] = { ...mockRentals[idx], ...data };
    return mockRentals[idx];
  },

  delete: async (id: string): Promise<void> => {
    const idx = mockRentals.findIndex((r) => r.id === id);
    if (idx !== -1) mockRentals.splice(idx, 1);
  },
};
