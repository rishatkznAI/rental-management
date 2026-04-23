import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { crmDealsService } from '../services/crm-deals.service';
import type { CrmDeal } from '../types';

export const CRM_DEAL_KEYS = {
  all: ['crm-deals'] as const,
  detail: (id: string) => ['crm-deals', id] as const,
};

export function useCrmDealsList() {
  return useQuery({
    queryKey: CRM_DEAL_KEYS.all,
    queryFn: crmDealsService.getAll,
    staleTime: 1000 * 60,
  });
}

export function useCreateCrmDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<CrmDeal, 'id'>) => crmDealsService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CRM_DEAL_KEYS.all });
    },
  });
}

export function useUpdateCrmDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<CrmDeal> }) => crmDealsService.update(id, data),
    onSuccess: (_result, { id }) => {
      queryClient.invalidateQueries({ queryKey: CRM_DEAL_KEYS.all });
      queryClient.invalidateQueries({ queryKey: CRM_DEAL_KEYS.detail(id) });
    },
  });
}

export function useDeleteCrmDeal() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => crmDealsService.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: CRM_DEAL_KEYS.all });
    },
  });
}
