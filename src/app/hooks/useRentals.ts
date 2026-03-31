import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { rentalsService } from '../services/rentals.service';
import type { Rental } from '../types';

export const RENTAL_KEYS = {
  all: ['rentals'] as const,
  detail: (id: string) => ['rentals', id] as const,
  gantt: ['rentals', 'gantt'] as const,
};

export function useRentalsList() {
  return useQuery({
    queryKey: RENTAL_KEYS.all,
    queryFn: rentalsService.getAll,
    staleTime: 1000 * 60 * 2,
  });
}

export function useRentalById(id: string) {
  return useQuery({
    queryKey: RENTAL_KEYS.detail(id),
    queryFn: () => rentalsService.getById(id),
    enabled: !!id,
  });
}

export function useGanttData() {
  return useQuery({
    queryKey: RENTAL_KEYS.gantt,
    queryFn: rentalsService.getGanttData,
  });
}

export function useCreateRental() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Rental, 'id'>) => rentalsService.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: RENTAL_KEYS.all }),
  });
}

export function useUpdateRental() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Rental> }) =>
      rentalsService.update(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: RENTAL_KEYS.all });
      qc.invalidateQueries({ queryKey: RENTAL_KEYS.detail(id) });
    },
  });
}

export function useDeleteRental() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => rentalsService.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: RENTAL_KEYS.all }),
  });
}
