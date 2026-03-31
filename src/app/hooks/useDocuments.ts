import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { documentsService } from '../services/documents.service';
import type { Document } from '../types';

export const DOCUMENT_KEYS = {
  all: ['documents'] as const,
  detail: (id: string) => ['documents', id] as const,
  byRental: (rentalId: string) => ['documents', 'rental', rentalId] as const,
};

export function useDocumentsList() {
  return useQuery({
    queryKey: DOCUMENT_KEYS.all,
    queryFn: documentsService.getAll,
    staleTime: 1000 * 60 * 5,
  });
}

export function useDocumentById(id: string) {
  return useQuery({
    queryKey: DOCUMENT_KEYS.detail(id),
    queryFn: () => documentsService.getById(id),
    enabled: !!id,
  });
}

export function useDocumentsByRental(rentalId: string) {
  return useQuery({
    queryKey: DOCUMENT_KEYS.byRental(rentalId),
    queryFn: () => documentsService.getByRentalId(rentalId),
    enabled: !!rentalId,
  });
}

export function useCreateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Document, 'id'>) => documentsService.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: DOCUMENT_KEYS.all }),
  });
}

export function useUpdateDocument() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Document> }) =>
      documentsService.update(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: DOCUMENT_KEYS.all });
      qc.invalidateQueries({ queryKey: DOCUMENT_KEYS.detail(id) });
    },
  });
}
