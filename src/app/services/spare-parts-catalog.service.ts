import { api } from '../lib/api';
import type { SparePartCatalogItem } from '../types';

export const sparePartsCatalogService = {
  getAll: (): Promise<SparePartCatalogItem[]> =>
    api.get<SparePartCatalogItem[]>('/api/spare_parts_catalog'),

  bulkReplace: (list: SparePartCatalogItem[]): Promise<void> =>
    api.put('/api/spare_parts_catalog', list),
};
