import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { clientObjectsService } from '../services/client-objects.service';
import { clientContractsService } from '../services/client-contracts.service';
import type { ClientContract, ClientObject } from '../types';

export const CLIENT_OBJECT_KEYS = {
  all: ['client_objects'] as const,
};

export const CLIENT_CONTRACT_KEYS = {
  all: ['client_contracts'] as const,
};

export function useClientObjectsList() {
  return useQuery({
    queryKey: CLIENT_OBJECT_KEYS.all,
    queryFn: clientObjectsService.getAll,
  });
}

export function useCreateClientObject() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<ClientObject, 'id'>) => clientObjectsService.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENT_OBJECT_KEYS.all }),
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

export function useClientContractsList() {
  return useQuery({
    queryKey: CLIENT_CONTRACT_KEYS.all,
    queryFn: clientContractsService.getAll,
  });
}

export function useCreateClientContract() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<ClientContract, 'id'>) => clientContractsService.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENT_CONTRACT_KEYS.all }),
  });
}
