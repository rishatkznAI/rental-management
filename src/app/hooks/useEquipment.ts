import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { equipmentService } from '../services/equipment.service';
import type { Equipment } from '../types';

export const EQUIPMENT_KEYS = {
  all: ['equipment'] as const,
  detail: (id: string) => ['equipment', id] as const,
  repairs: (id: string) => ['equipment', id, 'repairs'] as const,
  photos: (id: string) => ['equipment', id, 'photos'] as const,
};

export function useEquipmentList() {
  return useQuery({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
    staleTime: 1000 * 60 * 2, // 2 минуты
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
