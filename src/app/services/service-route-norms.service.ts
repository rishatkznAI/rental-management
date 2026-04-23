import { api } from '../lib/api';
import type { ServiceRouteNorm } from '../types';

export const serviceRouteNormsService = {
  getAll: (): Promise<ServiceRouteNorm[]> =>
    api.get<ServiceRouteNorm[]>('/api/service_route_norms'),

  bulkReplace: (list: ServiceRouteNorm[]): Promise<void> =>
    api.put('/api/service_route_norms', list),
};
