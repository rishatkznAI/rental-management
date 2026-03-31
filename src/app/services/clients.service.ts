import { mockClients } from '../mock-data';
import type { Client } from '../types';

export const clientsService = {
  getAll: async (): Promise<Client[]> => {
    return [...mockClients];
  },

  getById: async (id: string): Promise<Client | undefined> => {
    return mockClients.find((c) => c.id === id);
  },

  create: async (data: Omit<Client, 'id'>): Promise<Client> => {
    const newItem: Client = { ...data, id: `C-${Date.now()}` };
    mockClients.push(newItem);
    return newItem;
  },

  update: async (id: string, data: Partial<Client>): Promise<Client> => {
    const idx = mockClients.findIndex((c) => c.id === id);
    if (idx === -1) throw new Error(`Client ${id} not found`);
    mockClients[idx] = { ...mockClients[idx], ...data };
    return mockClients[idx];
  },

  delete: async (id: string): Promise<void> => {
    const idx = mockClients.findIndex((c) => c.id === id);
    if (idx !== -1) mockClients.splice(idx, 1);
  },
};
