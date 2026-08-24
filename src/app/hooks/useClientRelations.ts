import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientObjectsService } from '../services/client-objects.service';
import { clientContractsService, type ClientContractCreateInput } from '../services/client-contracts.service';
import type { ClientContract, ClientObject, ClientObjectCreateInput } from '../types';

export const CLIENT_OBJECT_KEYS = {
  all: ['client_objects'] as const,
};

export const CLIENT_CONTRACT_KEYS = {
  all: ['client_contracts'] as const,
};

type QueryOptions = {
  enabled?: boolean;
};

export function useClientObjectsList(options: QueryOptions = {}) {
  return useQuery({
    queryKey: CLIENT_OBJECT_KEYS.all,
    queryFn: clientObjectsService.getAll,
    enabled: options.enabled ?? true,
  });
}

export function useCreateClientObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ idempotencyKey, ...data }: ClientObjectCreateInput & { idempotencyKey?: string }) =>
      clientObjectsService.create(data, idempotencyKey),
    onSuccess: (created) => {
      qc.setQueryData<ClientObject[]>(CLIENT_OBJECT_KEYS.all, current => [
        ...(current || []).filter(item => item.id !== created.id),
        created,
      ]);
    },
  });
}

export function useUpdateClientObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ClientObject> }) =>
      clientObjectsService.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENT_OBJECT_KEYS.all }),
  });
}

export function useClientContractsList(options: QueryOptions = {}) {
  return useQuery({
    queryKey: CLIENT_CONTRACT_KEYS.all,
    queryFn: clientContractsService.getAll,
    enabled: options.enabled ?? true,
  });
}

export function useCreateClientContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ idempotencyKey, ...data }: ClientContractCreateInput & { idempotencyKey?: string }) =>
      clientContractsService.create(data, idempotencyKey),
    onSuccess: (created) => {
      qc.setQueryData<ClientContract[]>(CLIENT_CONTRACT_KEYS.all, current => [
        ...(current || []).filter(item => item.id !== created.id),
        created,
      ]);
    },
  });
}

export function useUpdateClientContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ClientContract> }) =>
      clientContractsService.update(id, data),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENT_CONTRACT_KEYS.all }),
  });
}

export function useDeleteClientContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, clientId, counterpartyId }: { id: string; clientId?: string; counterpartyId?: string }) =>
      clientContractsService.delete(id, { clientId, counterpartyId }),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENT_CONTRACT_KEYS.all }),
  });
}

export async function refreshClientRelationCache(
  qc: ReturnType<typeof useQueryClient>,
  queryKey: typeof CLIENT_OBJECT_KEYS.all | typeof CLIENT_CONTRACT_KEYS.all,
) {
  await qc.invalidateQueries({ queryKey, refetchType: 'none' });
  await qc.refetchQueries({ queryKey, type: 'active' }, { throwOnError: true });
}
