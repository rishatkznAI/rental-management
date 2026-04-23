import { api } from '../lib/api';
import type { KnowledgeBaseModule } from '../types';

export const knowledgeBaseModulesService = {
  getAll: (): Promise<KnowledgeBaseModule[]> =>
    api.get<KnowledgeBaseModule[]>('/api/knowledge_base_modules'),

  create: (data: Omit<KnowledgeBaseModule, 'id'>): Promise<KnowledgeBaseModule> =>
    api.post<KnowledgeBaseModule>('/api/knowledge_base_modules', data),

  update: (id: string, data: Partial<KnowledgeBaseModule>): Promise<KnowledgeBaseModule> =>
    api.patch<KnowledgeBaseModule>(`/api/knowledge_base_modules/${id}`, data),
};
