import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { warrantyClaimsService } from '../services/warranty-claims.service';
import { usePermissions } from '../lib/permissions';
import type { WarrantyClaim } from '../types';

export const WARRANTY_CLAIM_KEYS = {
  all: ['warrantyClaims'] as const,
};

type QueryOptions = {
  enabled?: boolean;
};

export function useWarrantyClaimsList(options: QueryOptions = {}) {
  const { canReadCollection } = usePermissions();
  return useQuery({
    queryKey: WARRANTY_CLAIM_KEYS.all,
    queryFn: warrantyClaimsService.getAll,
    enabled: (options.enabled ?? true) && canReadCollection('warranty_claims'),
    staleTime: 1000 * 60 * 2,
  });
}

export function useCreateWarrantyClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<WarrantyClaim, 'id'>) => warrantyClaimsService.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: WARRANTY_CLAIM_KEYS.all }),
  });
}

export function useUpdateWarrantyClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<WarrantyClaim> }) =>
      warrantyClaimsService.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: WARRANTY_CLAIM_KEYS.all }),
  });
}

export function useDeleteWarrantyClaim() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => warrantyClaimsService.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: WARRANTY_CLAIM_KEYS.all }),
  });
}
