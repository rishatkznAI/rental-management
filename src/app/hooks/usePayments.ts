import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentsService } from '../services/payments.service';
import type { Payment } from '../types';

export const PAYMENT_KEYS = {
  all: ['payments'] as const,
  detail: (id: string) => ['payments', id] as const,
};

export function usePaymentsList() {
  return useQuery({
    queryKey: PAYMENT_KEYS.all,
    queryFn: paymentsService.getAll,
    staleTime: 1000 * 60 * 2,
  });
}

export function usePaymentById(id: string) {
  return useQuery({
    queryKey: PAYMENT_KEYS.detail(id),
    queryFn: () => paymentsService.getById(id),
    enabled: !!id,
  });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Payment, 'id'>) => paymentsService.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: PAYMENT_KEYS.all }),
  });
}

export function useUpdatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Payment> }) =>
      paymentsService.update(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: PAYMENT_KEYS.all });
      qc.invalidateQueries({ queryKey: PAYMENT_KEYS.detail(id) });
    },
  });
}

export function useDeletePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => paymentsService.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: PAYMENT_KEYS.all }),
  });
}
