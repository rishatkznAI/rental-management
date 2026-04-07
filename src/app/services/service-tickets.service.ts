import { loadServiceTickets, saveServiceTickets } from '../mock-data';
import type { ServiceTicket } from '../types';

export const serviceTicketsService = {
  getAll: async (): Promise<ServiceTicket[]> => {
    return loadServiceTickets();
  },

  getById: async (id: string): Promise<ServiceTicket | undefined> => {
    return loadServiceTickets().find((t) => t.id === id);
  },

  getByEquipmentId: async (equipmentId: string): Promise<ServiceTicket[]> => {
    return loadServiceTickets().filter((t) => t.equipmentId === equipmentId);
  },

  create: async (data: Omit<ServiceTicket, 'id'>): Promise<ServiceTicket> => {
    const newItem: ServiceTicket = { ...data, id: `S-${Date.now()}` };
    saveServiceTickets([...loadServiceTickets(), newItem]);
    return newItem;
  },

  update: async (id: string, data: Partial<ServiceTicket>): Promise<ServiceTicket> => {
    const list = loadServiceTickets();
    const idx = list.findIndex((t) => t.id === id);
    if (idx === -1) throw new Error(`ServiceTicket ${id} not found`);
    list[idx] = { ...list[idx], ...data };
    saveServiceTickets(list);
    return list[idx];
  },

  delete: async (id: string): Promise<void> => {
    saveServiceTickets(loadServiceTickets().filter((t) => t.id !== id));
  },
};
