import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { plannerService, type PlannerRowsQuery, type UpdatePlannerItemPayload } from '../services/planner.service';

export const PLANNER_KEYS = {
  rows:          (query: PlannerRowsQuery) => ['planner', 'rows', query] as const,
};

export function usePlannerRows(query: PlannerRowsQuery) {
  return useQuery({
    queryKey: PLANNER_KEYS.rows(query),
    queryFn:  () => plannerService.getRows(query),
    staleTime: 1000 * 60,   // 1 минута
    refetchOnWindowFocus: true,
  });
}

export function useUpdatePlannerItem(includeShipped = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ rowId, payload }: { rowId: string; payload: UpdatePlannerItemPayload }) =>
      plannerService.updateItem(rowId, payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['planner'] });
    },
  });
}
