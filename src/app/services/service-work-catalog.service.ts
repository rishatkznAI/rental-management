import { api } from '../lib/api';
import type { ServiceWorkCatalogItem } from '../types';

export const serviceWorkCatalogService = {
  getAll: (): Promise<ServiceWorkCatalogItem[]> =>
    api.get<ServiceWorkCatalogItem[]>('/api/service_work_catalog'),

  bulkReplace: (list: ServiceWorkCatalogItem[]): Promise<void> =>
    api.put('/api/service_work_catalog', list),
};
