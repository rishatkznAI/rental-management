import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { paymentsService } from '../services/payments.service';
import { RENTAL_KEYS } from './useRentals';
import type { Payment, PaymentAllocation } from '../types';

export const PAYMENT_KEYS = {
  all: ['payments'] as const,
  allocations: ['payment_allocations'] as const,
  detail: (id: string) => ['payments', id] as const,
};

type QueryOptions = {
  enabled?: boolean;
};

export function usePaymentsList(options: QueryOptions = {}) {
  return useQuery({
    queryKey: PAYMENT_KEYS.all,
    queryFn: paymentsService.getAll,
    enabled: options.enabled ?? true,
    staleTime: 1000 * 60 * 2,
  });
}

export function usePaymentAllocationsList(options: QueryOptions = {}) {
  return useQuery({
    queryKey: PAYMENT_KEYS.allocations,
    queryFn: paymentsService.getAllocations,
    enabled: options.enabled ?? true,
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
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PAYMENT_KEYS.all });
      qc.invalidateQueries({ queryKey: RENTAL_KEYS.gantt });
    },
  });
}

function invalidatePaymentDependents(qc: ReturnType<typeof useQueryClient>) {
  qc.invalidateQueries({ queryKey: PAYMENT_KEYS.all });
  qc.invalidateQueries({ queryKey: PAYMENT_KEYS.allocations });
  qc.invalidateQueries({ queryKey: RENTAL_KEYS.gantt });
  qc.invalidateQueries({ queryKey: ['finance'] });
  qc.invalidateQueries({ queryKey: ['documents'] });
}

export function useCreatePaymentAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<PaymentAllocation, 'id'>) => paymentsService.createAllocation(data),
    onSuccess: () => invalidatePaymentDependents(qc),
  });
}

export function useUpdatePaymentAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<PaymentAllocation> }) =>
      paymentsService.updateAllocation(id, data),
    onSuccess: () => invalidatePaymentDependents(qc),
  });
}

export function useDeletePaymentAllocation() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => paymentsService.deleteAllocation(id),
    onSuccess: () => invalidatePaymentDependents(qc),
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
      qc.invalidateQueries({ queryKey: RENTAL_KEYS.gantt });
    },
  });
}

export function useDeletePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => paymentsService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: PAYMENT_KEYS.all });
      qc.invalidateQueries({ queryKey: RENTAL_KEYS.gantt });
    },
  });
}
