import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { serviceTicketsService } from '../services/service-tickets.service';
import type { ServiceTicket } from '../types';

export const SERVICE_TICKET_KEYS = {
  all: ['serviceTickets'] as const,
  detail: (id: string) => ['serviceTickets', id] as const,
  byEquipment: (equipmentId: string) => ['serviceTickets', 'equipment', equipmentId] as const,
};

export function useServiceTicketsList() {
  return useQuery({
    queryKey: SERVICE_TICKET_KEYS.all,
    queryFn: serviceTicketsService.getAll,
    staleTime: 1000 * 60 * 2,
  });
}

export function useServiceTicketById(id: string) {
  return useQuery({
    queryKey: SERVICE_TICKET_KEYS.detail(id),
    queryFn: () => serviceTicketsService.getById(id),
    enabled: !!id,
  });
}

export function useServiceTicketsByEquipment(equipmentId: string) {
  return useQuery({
    queryKey: SERVICE_TICKET_KEYS.byEquipment(equipmentId),
    queryFn: () => serviceTicketsService.getByEquipmentId(equipmentId),
    enabled: !!equipmentId,
  });
}

export function useCreateServiceTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (data: Omit<ServiceTicket, 'id'>) => serviceTicketsService.create(data),
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all }),
  });
}

export function useUpdateServiceTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<ServiceTicket> }) =>
      serviceTicketsService.update(id, data),
    onSuccess: (_res, { id }) => {
      qc.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all });
      qc.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.detail(id) });
    },
  });
}

export function useDeleteServiceTicket() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => serviceTicketsService.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all }),
  });
}
