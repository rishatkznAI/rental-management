import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { knowledgeBaseModulesService } from '../services/knowledge-base-modules.service';
import { knowledgeBaseProgressService } from '../services/knowledge-base-progress.service';
import type { KnowledgeBaseModule, KnowledgeBaseProgress } from '../types';

export const KNOWLEDGE_BASE_KEYS = {
  modules: ['knowledge-base-modules'] as const,
  progress: ['knowledge-base-progress'] as const,
};

export function useKnowledgeBaseModulesList() {
  return useQuery({
    queryKey: KNOWLEDGE_BASE_KEYS.modules,
    queryFn: knowledgeBaseModulesService.getAll,
    staleTime: 1000 * 60 * 5,
  });
}

export function useKnowledgeBaseProgressList() {
  return useQuery({
    queryKey: KNOWLEDGE_BASE_KEYS.progress,
    queryFn: knowledgeBaseProgressService.getAll,
    staleTime: 1000 * 30,
  });
}

export function useCreateKnowledgeBaseProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<KnowledgeBaseProgress, 'id'>) => knowledgeBaseProgressService.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KNOWLEDGE_BASE_KEYS.progress });
    },
  });
}

export function useUpdateKnowledgeBaseProgress() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<KnowledgeBaseProgress> }) =>
      knowledgeBaseProgressService.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KNOWLEDGE_BASE_KEYS.progress });
    },
  });
}

export function useUpdateKnowledgeBaseModule() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<KnowledgeBaseModule> }) =>
      knowledgeBaseModulesService.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: KNOWLEDGE_BASE_KEYS.modules });
    },
  });
}
