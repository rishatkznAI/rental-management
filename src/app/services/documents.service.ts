import { loadDocuments, saveDocuments } from '../mock-data';
import type { Document } from '../types';

export const documentsService = {
  getAll: async (): Promise<Document[]> => {
    return loadDocuments();
  },

  getById: async (id: string): Promise<Document | undefined> => {
    return loadDocuments().find((d) => d.id === id);
  },

  getByRentalId: async (rentalId: string): Promise<Document[]> => {
    return loadDocuments().filter((d) => d.rental === rentalId);
  },

  create: async (data: Omit<Document, 'id'>): Promise<Document> => {
    const newItem: Document = { ...data, id: `D-${Date.now()}` };
    saveDocuments([...loadDocuments(), newItem]);
    return newItem;
  },

  update: async (id: string, data: Partial<Document>): Promise<Document> => {
    const list = loadDocuments();
    const idx = list.findIndex((d) => d.id === id);
    if (idx === -1) throw new Error(`Document ${id} not found`);
    list[idx] = { ...list[idx], ...data };
    saveDocuments(list);
    return list[idx];
  },
};
