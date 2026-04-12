import { api } from '../lib/api';
import type { RepairWorkItem } from '../types';

export const repairWorkItemsService = {
  getByRepairId: (repairId: string): Promise<RepairWorkItem[]> =>
    api.get<RepairWorkItem[]>(`/api/repair_work_items?repair_id=${encodeURIComponent(repairId)}`),

  add: (data: { repairId: string; workId: string; quantity: number }): Promise<RepairWorkItem> =>
    api.post<RepairWorkItem>('/api/repair_work_items', data),

  remove: (id: string): Promise<void> =>
    api.del(`/api/repair_work_items/${id}`),
};
