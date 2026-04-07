import { loadClients, saveClients } from '../mock-data';
import type { Client } from '../types';

export const clientsService = {
  getAll: async (): Promise<Client[]> => {
    return loadClients();
  },

  getById: async (id: string): Promise<Client | undefined> => {
    return loadClients().find((c) => c.id === id);
  },

  create: async (data: Omit<Client, 'id'>): Promise<Client> => {
    const newItem: Client = { ...data, id: `C-${Date.now()}` };
    saveClients([...loadClients(), newItem]);
    return newItem;
  },

  update: async (id: string, data: Partial<Client>): Promise<Client> => {
    const list = loadClients();
    const idx = list.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`Client ${id} not found`);
    list[idx] = { ...list[idx], ...data };
    saveClients(list);
    return list[idx];
  },

  delete: async (id: string): Promise<void> => {
    saveClients(loadClients().filter((c) => c.id !== id));
  },
};
