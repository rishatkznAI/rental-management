import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { clientsService } from '../services/clients.service';
import type { Client } from '../types';

export const CLIENT_KEYS = {
  all: ['clients'] as const,
  detail: (id: string) => ['clients', id] as const,
};

export function useClientsList() {
  return useQuery({
    queryKey: CLIENT_KEYS.all,
    queryFn: clientsService.getAll,
    staleTime: 1000 * 60 * 5,
  });
}

export function useClientById(id: string) {
  return useQuery({
    queryKey: CLIENT_KEYS.detail(id),
    queryFn: () => clientsService.getById(id),
    enabled: !!id,
  });
}

export function useCreateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Client, 'id'>) => clientsService.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENT_KEYS.all }),
  });
}

export function useUpdateClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Client> }) =>
      clientsService.update(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: CLIENT_KEYS.all });
      qc.invalidateQueries({ queryKey: CLIENT_KEYS.detail(id) });
    },
  });
}

export function useDeleteClient() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => clientsService.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: CLIENT_KEYS.all }),
  });
}
