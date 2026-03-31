import { mockServiceTickets } from '../mock-data';
import type { ServiceTicket } from '../types';

export const serviceTicketsService = {
  getAll: async (): Promise<ServiceTicket[]> => {
    return [...mockServiceTickets];
  },

  getById: async (id: string): Promise<ServiceTicket | undefined> => {
    return mockServiceTickets.find((t) => t.id === id);
  },

  getByEquipmentId: async (equipmentId: string): Promise<ServiceTicket[]> => {
    return mockServiceTickets.filter((t) => t.equipmentId === equipmentId);
  },

  create: async (data: Omit<ServiceTicket, 'id'>): Promise<ServiceTicket> => {
    const newItem: ServiceTicket = { ...data, id: `S-${Date.now()}` };
    mockServiceTickets.push(newItem);
    return newItem;
  },

  update: async (id: string, data: Partial<ServiceTicket>): Promise<ServiceTicket> => {
    const idx = mockServiceTickets.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`ServiceTicket ${id} not found`);
    mockServiceTickets[idx] = { ...mockServiceTickets[idx], ...data };
    return mockServiceTickets[idx];
  },

  delete: async (id: string): Promise<void> => {
    const idx = mockServiceTickets.findIndex((t) => t.id === id);
    if (idx !== -1) mockServiceTickets.splice(idx, 1);
  },
};
