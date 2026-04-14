import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { plannerService, type UpdatePlannerItemPayload } from '../services/planner.service';

export const PLANNER_KEYS = {
  rows:          (includeShipped: boolean) => ['planner', 'rows', includeShipped] as const,
};

export function usePlannerRows(includeShipped = false) {
  return useQuery({
    queryKey: PLANNER_KEYS.rows(includeShipped),
    queryFn:  () => plannerService.getRows(includeShipped),
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
