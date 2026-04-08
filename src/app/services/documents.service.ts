import { api } from '../lib/api';
import type { Document } from '../types';

export const documentsService = {
  getAll: (): Promise<Document[]> =>
    api.get<Document[]>('/api/documents'),

  getById: (id: string): Promise<Document | undefined> =>
    api.get<Document>(`/api/documents/${id}`).catch(() => undefined),

  getByRentalId: async (rentalId: string): Promise<Document[]> => {
    const all = await api.get<Document[]>('/api/documents');
    return all.filter(d => d.rental === rentalId);
  },

  create: (data: Omit<Document, 'id'>): Promise<Document> =>
    api.post<Document>('/api/documents', data),

  update: (id: string, data: Partial<Document>): Promise<Document> =>
    api.patch<Document>(`/api/documents/${id}`, data),

  bulkReplace: (list: Document[]): Promise<void> =>
    api.put('/api/documents', list),
};
