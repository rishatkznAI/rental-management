import { api } from '../lib/api';
import type { Document, DocumentNumberingSetting, DocumentRegistrySummary, DocumentType } from '../types';

export const documentsService = {
  getAll: (): Promise<Document[]> =>
    api.get<Document[]>('/api/documents'),

  getById: (id: string): Promise<Document | undefined> =>
    api.get<Document>(`/api/documents/${id}`).catch(() => undefined),

  getByRentalId: async (rentalId: string): Promise<Document[]> => {
    const all = await api.get<Document[]>('/api/documents');
    return all.filter(d => d.rentalId === rentalId || d.rental === rentalId);
  },

  getRegistrySummary: (): Promise<DocumentRegistrySummary> =>
    api.get<DocumentRegistrySummary>('/api/documents/registry/summary'),

  previewNumber: (data: { type?: DocumentType; documentType?: DocumentType; date?: string; documentDate?: string; year?: number }): Promise<{ number: string }> =>
    api.post<{ number: string }>('/api/documents/number-preview', data),

  assignNumber: (id: string): Promise<Document> =>
    api.post<Document>(`/api/documents/${id}/assign-number`, {}),

  getNumberingSettings: (): Promise<DocumentNumberingSetting[]> =>
    api.get<DocumentNumberingSetting[]>('/api/documents/numbering-settings'),

  updateNumberingSettings: (settings: DocumentNumberingSetting[]): Promise<DocumentNumberingSetting[]> =>
    api.patch<DocumentNumberingSetting[]>('/api/documents/numbering-settings', { settings }),

  create: (data: Omit<Document, 'id'>): Promise<Document> =>
    api.post<Document>('/api/documents', data),

  update: (id: string, data: Partial<Document>): Promise<Document> =>
    api.patch<Document>(`/api/documents/${id}`, data),

  bulkReplace: (list: Document[]): Promise<void> =>
    api.put('/api/documents', list),
};
