import { mockDocuments } from '../mock-data';
import type { Document } from '../types';

export const documentsService = {
  getAll: async (): Promise<Document[]> => {
    return [...mockDocuments];
  },

  getById: async (id: string): Promise<Document | undefined> => {
    return mockDocuments.find((d) => d.id === id);
  },

  getByRentalId: async (rentalId: string): Promise<Document[]> => {
    return mockDocuments.filter((d) => d.rental === rentalId);
  },

  create: async (data: Omit<Document, 'id'>): Promise<Document> => {
    const newItem: Document = { ...data, id: `D-${Date.now()}` };
    mockDocuments.push(newItem);
    return newItem;
  },

  update: async (id: string, data: Partial<Document>): Promise<Document> => {
    const idx = mockDocuments.findIndex((d) => d.id === id);
    if (idx === -1) throw new Error(`Document ${id} not found`);
    mockDocuments[idx] = { ...mockDocuments[idx], ...data };
    return mockDocuments[idx];
  },
};
