import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { rentalChangeRequestsService } from '../services/rental-change-requests.service';

export const RENTAL_CHANGE_REQUEST_KEYS = {
  all: ['rental-change-requests'] as const,
  detail: (id: string) => ['rental-change-requests', id] as const,
};

export function useRentalChangeRequestsList(enabled = true) {
  return useQuery({
    queryKey: RENTAL_CHANGE_REQUEST_KEYS.all,
    queryFn: rentalChangeRequestsService.getAll,
    enabled,
    staleTime: 1000 * 30,
  });
}

export function useApproveRentalChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, comment }: { id: string; comment?: string }) =>
      rentalChangeRequestsService.approve(id, comment),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RENTAL_CHANGE_REQUEST_KEYS.all });
      qc.invalidateQueries({ queryKey: ['rentals'] });
      qc.invalidateQueries({ queryKey: ['rentals', 'gantt'] });
      qc.invalidateQueries({ queryKey: ['payments'] });
      qc.invalidateQueries({ queryKey: ['documents'] });
    },
  });
}

export function useRejectRentalChangeRequest() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, reason }: { id: string; reason: string }) =>
      rentalChangeRequestsService.reject(id, reason),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: RENTAL_CHANGE_REQUEST_KEYS.all });
    },
  });
}
