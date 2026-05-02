import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { debtCollectionPlansService } from '../services/debt-collection-plans.service';
import type { DebtCollectionPlan } from '../types';

export const DEBT_COLLECTION_PLAN_KEYS = {
  all: ['debt_collection_plans'] as const,
};

export function useDebtCollectionPlans() {
  return useQuery({
    queryKey: DEBT_COLLECTION_PLAN_KEYS.all,
    queryFn: debtCollectionPlansService.getAll,
    staleTime: 1000 * 60 * 2,
  });
}

export function useCreateDebtCollectionPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<DebtCollectionPlan, 'id' | 'createdAt' | 'updatedAt'>) =>
      debtCollectionPlansService.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEBT_COLLECTION_PLAN_KEYS.all });
    },
  });
}

export function useUpdateDebtCollectionPlan() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<DebtCollectionPlan> }) =>
      debtCollectionPlansService.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: DEBT_COLLECTION_PLAN_KEYS.all });
    },
  });
}
