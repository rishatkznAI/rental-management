import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientObjectsService } from '../services/client-objects.service';
import type { ClientObjectLifecycleAnalysis } from '../services/client-objects.service';
import {
  clientContractsService,
  type ClientContractCreateInput,
  type ClientContractUpdateInput,
} from '../services/client-contracts.service';
import type { ClientContract, ClientObject, ClientObjectCreateInput } from '../types';
import { CLIENT_KEYS } from './useClients';

export const CLIENT_OBJECT_KEYS = {
  all: ['client_objects'] as const,
  lifecycle: (id: string) => ['client_objects', id, 'lifecycle'] as const,
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

export function useClientObjectLifecycleMap(objects: ClientObject[], enabled = true) {
  const archived = objects.filter(object => object.status === 'archived');
  const results = useQueries({
    queries: archived.map(object => ({
      queryKey: CLIENT_OBJECT_KEYS.lifecycle(object.id),
      queryFn: () => clientObjectsService.getLifecycle(object.id),
      enabled,
      staleTime: 30_000,
    })),
  });
  return {
    byId: new Map<string, ClientObjectLifecycleAnalysis>(
      archived.flatMap((object, index) => results[index]?.data ? [[object.id, results[index].data]] : []),
    ),
    failedIds: new Set(
      archived.filter((_object, index) => results[index]?.isError).map(object => object.id),
    ),
    isLoading: results.some(result => result.isLoading),
  };
}

export function useArchiveClientObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => clientObjectsService.archive(id),
    onSuccess: (result) => {
      qc.setQueryData<ClientObject[]>(CLIENT_OBJECT_KEYS.all, current =>
        (current || []).map(item => item.id === result.clientObject.id ? result.clientObject : item));
      qc.invalidateQueries({ queryKey: CLIENT_OBJECT_KEYS.lifecycle(result.clientObject.id) });
    },
  });
}

export function useDeleteClientObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => clientObjectsService.delete(id),
    onSuccess: (_result, id) => {
      qc.setQueryData<ClientObject[]>(CLIENT_OBJECT_KEYS.all, current =>
        (current || []).filter(item => item.id !== id));
      qc.removeQueries({ queryKey: CLIENT_OBJECT_KEYS.lifecycle(id) });
    },
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
    mutationFn: ({ id, data }: { id: string; data: ClientContractUpdateInput }) =>
      clientContractsService.update(id, data),
    onSuccess: (updated) => {
      qc.setQueryData<ClientContract[]>(CLIENT_CONTRACT_KEYS.all, current =>
        (current || []).map(item => item.id === updated.id ? updated : item));
      qc.invalidateQueries({ queryKey: CLIENT_CONTRACT_KEYS.all });
      if (updated.clientId) qc.invalidateQueries({ queryKey: CLIENT_KEYS.detail(updated.clientId) });
    },
  });
}

export function useDeleteClientContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, clientId, counterpartyId }: { id: string; clientId?: string; counterpartyId?: string }) =>
      clientContractsService.delete(id, { clientId, counterpartyId }),
    onSuccess: (_result, { id }) => {
      qc.setQueryData<ClientContract[]>(CLIENT_CONTRACT_KEYS.all, current =>
        (current || []).filter(item => item.id !== id));
      qc.invalidateQueries({ queryKey: CLIENT_CONTRACT_KEYS.all });
    },
  });
}

export async function refreshClientRelationCache(
  qc: ReturnType<typeof useQueryClient>,
  queryKey: typeof CLIENT_OBJECT_KEYS.all | typeof CLIENT_CONTRACT_KEYS.all,
) {
  await qc.invalidateQueries({ queryKey, refetchType: 'none' });
  await qc.refetchQueries({ queryKey, type: 'active' }, { throwOnError: true });
}
