import { api } from '../lib/api';
import type { KnowledgeBaseProgress } from '../types';

export const knowledgeBaseProgressService = {
  getAll: (): Promise<KnowledgeBaseProgress[]> =>
    api.get<KnowledgeBaseProgress[]>('/api/knowledge_base_progress'),

  create: (data: Omit<KnowledgeBaseProgress, 'id'>): Promise<KnowledgeBaseProgress> =>
    api.post<KnowledgeBaseProgress>('/api/knowledge_base_progress', data),

  update: (id: string, data: Partial<KnowledgeBaseProgress>): Promise<KnowledgeBaseProgress> =>
    api.patch<KnowledgeBaseProgress>(`/api/knowledge_base_progress/${id}`, data),
};
