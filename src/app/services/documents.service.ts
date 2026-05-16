import { api, API_BASE_URL, ApiError, getToken } from '../lib/api';
import { buildPaginatedQuery, type PaginatedQueryParams, type PaginatedResponse } from '../lib/api';
import type { GanttRentalData } from '../mock-data';
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

type DocumentReferenceQueryParams = PaginatedQueryParams & {
  types?: string;
  ids?: string;
};

export type DocumentGanttReferenceQueryParams = {
  search?: string;
  clientId?: string;
  rentalId?: string;
  equipmentId?: string;
  contractId?: string;
  dateFrom?: string;
  dateTo?: string;
  status?: string;
  limit?: number;
};

function buildDocumentReferenceQuery(params: DocumentReferenceQueryParams = {}): string {
  const query = buildPaginatedQuery(params);
  const searchParams = new URLSearchParams(query.slice(1));
  if (params.types) searchParams.set('types', params.types);
  if (params.ids) searchParams.set('ids', params.ids);
  return `?${searchParams.toString()}`;
}

function buildGanttReferenceQuery(params: DocumentGanttReferenceQueryParams = {}): string {
  const searchParams = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value === undefined || value === null || value === '') return;
    searchParams.set(key, String(value));
  });
  const query = searchParams.toString();
  return query ? `?${query}` : '';
}

export const documentsService = {
  getAll: (): Promise<Document[]> =>
    api.get<Document[]>('/api/documents'),

  getPaginated: (params?: PaginatedQueryParams): Promise<PaginatedResponse<Document>> =>
    api.get<PaginatedResponse<Document>>(`/api/documents${buildPaginatedQuery(params)}`),

  getReferences: (params?: DocumentReferenceQueryParams): Promise<PaginatedResponse<Document>> =>
    api.get<PaginatedResponse<Document>>(`/api/documents/references${buildDocumentReferenceQuery(params)}`),

  getGanttReferences: (params?: DocumentGanttReferenceQueryParams): Promise<PaginatedResponse<GanttRentalData>> =>
    api.get<PaginatedResponse<GanttRentalData>>(`/api/documents/gantt-references${buildGanttReferenceQuery(params)}`),

  getById: (id: string): Promise<Document | undefined> =>
    api.get<Document>(`/api/documents/${id}`).catch(() => undefined),

  getByRentalId: async (rentalId: string): Promise<Document[]> => {
    const response = await documentsService.getReferences({
      page: 1,
      pageSize: 100,
      filters: { rentalId },
    });
    return response.items;
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
