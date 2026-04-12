import { api } from '../lib/api';
import type { RepairPartItem } from '../types';

export const repairPartItemsService = {
  getByRepairId: (repairId: string): Promise<RepairPartItem[]> =>
    api.get<RepairPartItem[]>(`/api/repair_part_items?repair_id=${encodeURIComponent(repairId)}`),

  add: (data: { repairId: string; partId: string; quantity: number; priceSnapshot?: number }): Promise<RepairPartItem> =>
    api.post<RepairPartItem>('/api/repair_part_items', data),

  remove: (id: string): Promise<void> =>
    api.del(`/api/repair_part_items/${id}`),
};
