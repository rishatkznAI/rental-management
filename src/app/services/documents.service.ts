import { api, API_BASE_URL, ApiError, getToken } from '../lib/api';
import type { Document, DocumentNumberingSetting, DocumentRegistrySummary, DocumentType } from '../types';

export function getDocumentPrintPath(id: string) {
  return `/api/documents/${encodeURIComponent(id)}/print`;
}

export function getDocumentPrintUrl(id: string) {
  return `${API_BASE_URL}${getDocumentPrintPath(id)}`;
}

async function getDocumentPrintHtml(id: string): Promise<string> {
  const token = getToken();
  const headers: Record<string, string> = {};
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(getDocumentPrintUrl(id), {
    method: 'GET',
    headers,
    credentials: 'include',
  });

  const text = await response.text();
  if (!response.ok) {
    throw new ApiError(text || `HTTP ${response.status}`, response.status, undefined, text);
  }
  return text;
}

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

  generate: (data: Partial<Document>): Promise<Document> =>
    api.post<Document>('/api/documents/generate', data),

  markSent: (id: string, status: 'sent' | 'pending_signature' = 'sent'): Promise<Document> =>
    api.post<Document>(`/api/documents/${id}/mark-sent`, { status }),

  markSigned: (id: string): Promise<Document> =>
    api.post<Document>(`/api/documents/${id}/mark-signed`, {}),

  duplicate: (id: string): Promise<Document> =>
    api.post<Document>(`/api/documents/${id}/duplicate`, {}),

  delete: (id: string): Promise<{ ok: boolean }> =>
    api.del<{ ok: boolean }>(`/api/documents/${id}`),

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

  getPrintPath: getDocumentPrintPath,

  getPrintUrl: getDocumentPrintUrl,

  getPrintHtml: getDocumentPrintHtml,
};
