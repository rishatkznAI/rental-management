import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  serviceVehiclesService,
  type CreateVehiclePayload,
  type UpdateVehiclePayload,
  type CreateTripPayload,
  type UpdateTripPayload,
} from '../services/service-vehicles.service';

export const SV_KEYS = {
  all:   ()           => ['service_vehicles'] as const,
  one:   (id: string) => ['service_vehicles', id] as const,
  trips: (id: string) => ['vehicle_trips', id] as const,
  allTrips: ()        => ['vehicle_trips'] as const,
};

// ── Машины ────────────────────────────────────────────────────────────────────

export function useServiceVehicles() {
  return useQuery({
    queryKey: SV_KEYS.all(),
    queryFn:  serviceVehiclesService.getAll,
    staleTime: 1000 * 60,
  });
}

export function useServiceVehicleById(id: string) {
  return useQuery({
    queryKey: SV_KEYS.one(id),
    queryFn:  () => serviceVehiclesService.getById(id),
    enabled:  !!id && id !== 'new',
    staleTime: 1000 * 30,
  });
}

export function useCreateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateVehiclePayload) =>
      serviceVehiclesService.create(payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_vehicles'] });
    },
  });
}

export function useUpdateVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: UpdateVehiclePayload }) =>
      serviceVehiclesService.update(id, payload),
    onSuccess: (_, { id }) => {
      qc.invalidateQueries({ queryKey: ['service_vehicles'] });
      qc.invalidateQueries({ queryKey: SV_KEYS.one(id) });
    },
  });
}

export function useDeleteVehicle() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => serviceVehiclesService.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['service_vehicles'] });
    },
  });
}

// ── Журнал поездок ────────────────────────────────────────────────────────────

export function useVehicleTrips(vehicleId: string) {
  return useQuery({
    queryKey: SV_KEYS.trips(vehicleId),
    queryFn:  () => serviceVehiclesService.getTrips(vehicleId),
    enabled:  !!vehicleId && vehicleId !== 'new',
    staleTime: 1000 * 30,
  });
}

export function useCreateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (payload: CreateTripPayload) =>
      serviceVehiclesService.createTrip(payload),
    onSuccess: (trip) => {
      qc.invalidateQueries({ queryKey: ['vehicle_trips'] });
      qc.invalidateQueries({ queryKey: SV_KEYS.one(trip.vehicleId) });
      qc.invalidateQueries({ queryKey: ['service_vehicles'] });
    },
  });
}

export function useUpdateTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, vehicleId, payload }: { id: string; vehicleId: string; payload: UpdateTripPayload }) =>
      serviceVehiclesService.updateTrip(id, payload),
    onSuccess: (_, { vehicleId }) => {
      qc.invalidateQueries({ queryKey: ['vehicle_trips'] });
      qc.invalidateQueries({ queryKey: SV_KEYS.trips(vehicleId) });
    },
  });
}

export function useDeleteTrip() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, vehicleId }: { id: string; vehicleId: string }) =>
      serviceVehiclesService.deleteTrip(id),
    onSuccess: (_, { vehicleId }) => {
      qc.invalidateQueries({ queryKey: ['vehicle_trips'] });
      qc.invalidateQueries({ queryKey: SV_KEYS.trips(vehicleId) });
      qc.invalidateQueries({ queryKey: ['service_vehicles'] });
    },
  });
}
