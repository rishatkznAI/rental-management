import { api } from '../lib/api';
import type { ServiceFieldTrip } from '../types';

export const serviceFieldTripsService = {
  getAll: (): Promise<ServiceFieldTrip[]> =>
    api.get<ServiceFieldTrip[]>('/api/service_field_trips'),
};
