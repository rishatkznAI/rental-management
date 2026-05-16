import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { equipmentService } from '../services/equipment.service';
import type { PaginatedQueryParams } from '../lib/api';
import type { Equipment } from '../types';

export const EQUIPMENT_KEYS = {
  all: ['equipment'] as const,
  paginated: (params: PaginatedQueryParams) => ['equipment', 'paginated', params] as const,
  detail: (id: string) => ['equipment', id] as const,
  repairs: (id: string) => ['equipment', id, 'repairs'] as const,
  photos: (id: string) => ['equipment', id, 'photos'] as const,
};

export function useEquipmentList(options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
    enabled: options.enabled ?? true,
    staleTime: 1000 * 60 * 2, // 2 минуты
  });
}

export function usePaginatedEquipment(params: PaginatedQueryParams, options: { enabled?: boolean } = {}) {
  return useQuery({
    queryKey: EQUIPMENT_KEYS.paginated(params),
    queryFn: () => equipmentService.getPaginated(params),
    enabled: options.enabled ?? true,
    staleTime: 1000 * 60,
    placeholderData: previous => previous,
  });
}

export function useEquipmentById(id: string) {
  return useQuery({
    queryKey: EQUIPMENT_KEYS.detail(id),
    queryFn: () => equipmentService.getById(id),
    enabled: !!id,
  });
}

export function useRepairRecords(equipmentId: string) {
  return useQuery({
    queryKey: EQUIPMENT_KEYS.repairs(equipmentId),
    queryFn: () => equipmentService.getRepairRecords(equipmentId),
    enabled: !!equipmentId,
  });
}

export function useShippingPhotos(equipmentId: string) {
  return useQuery({
    queryKey: EQUIPMENT_KEYS.photos(equipmentId),
    queryFn: () => equipmentService.getShippingPhotos(equipmentId),
    enabled: !!equipmentId,
  });
}

export function useCreateEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<Equipment, 'id'>) => equipmentService.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
  });
}

export function useUpdateEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Equipment> }) =>
      equipmentService.update(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all });
      qc.invalidateQueries({ queryKey: EQUIPMENT_KEYS.detail(id) });
    },
  });
}

export function useDeleteEquipment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => equipmentService.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
  });
}
