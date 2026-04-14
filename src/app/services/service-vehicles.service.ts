import { api } from '../lib/api';
import type { ServiceVehicle, VehicleTrip } from '../types';

// ── Payloads ──────────────────────────────────────────────────────────────────

export type CreateVehiclePayload = Omit<ServiceVehicle,
  'id' | 'createdAt' | 'updatedAt' | 'createdBy'
>;

export type UpdateVehiclePayload = Partial<CreateVehiclePayload>;

export type CreateTripPayload = Omit<VehicleTrip,
  'id' | 'distance' | 'createdAt' | 'createdBy'
>;

export type UpdateTripPayload = Partial<Omit<VehicleTrip,
  'id' | 'vehicleId' | 'distance' | 'createdAt' | 'createdBy'
>>;

// ── Service ───────────────────────────────────────────────────────────────────

export const serviceVehiclesService = {
  // --- Машины ---

  getAll: (): Promise<ServiceVehicle[]> =>
    api.get<ServiceVehicle[]>('/api/service_vehicles'),

  getById: (id: string): Promise<ServiceVehicle> =>
    api.get<ServiceVehicle>(`/api/service_vehicles/${id}`),

  create: (payload: CreateVehiclePayload): Promise<ServiceVehicle> =>
    api.post<ServiceVehicle>('/api/service-vehicles', payload),

  update: (id: string, payload: UpdateVehiclePayload): Promise<ServiceVehicle> =>
    api.put<ServiceVehicle>(`/api/service-vehicles/${id}`, payload),

  delete: (id: string): Promise<{ ok: boolean }> =>
    api.delete<{ ok: boolean }>(`/api/service_vehicles/${id}`),

  // --- Журнал поездок ---

  getTrips: (vehicleId: string): Promise<VehicleTrip[]> =>
    api.get<VehicleTrip[]>(`/api/vehicle-trips?vehicleId=${vehicleId}`),

  getAllTrips: (): Promise<VehicleTrip[]> =>
    api.get<VehicleTrip[]>('/api/vehicle-trips'),

  createTrip: (payload: CreateTripPayload): Promise<VehicleTrip> =>
    api.post<VehicleTrip>('/api/vehicle-trips', payload),

  updateTrip: (id: string, payload: UpdateTripPayload): Promise<VehicleTrip> =>
    api.put<VehicleTrip>(`/api/vehicle-trips/${id}`, payload),

  deleteTrip: (id: string): Promise<{ ok: boolean }> =>
    api.delete<{ ok: boolean }>(`/api/vehicle-trips/${id}`),
};
