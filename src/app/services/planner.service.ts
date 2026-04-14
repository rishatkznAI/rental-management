import { api } from '../lib/api';
import type { PlannerRow, PlannerItemOverlay } from '../types';

export interface UpdatePlannerItemPayload {
  prepStatus?:       PlannerRow['prepStatus'];
  priorityOverride?: PlannerRow['priority'] | null;
  riskOverride?:     boolean | null;
  comment?:          string;
}

export const plannerService = {
  /**
   * Получить строки планировщика.
   * includeShipped=true — показать уже отгруженные записи.
   */
  getRows: (includeShipped = false): Promise<PlannerRow[]> =>
    api.get<PlannerRow[]>(`/api/planner${includeShipped ? '?include_shipped=1' : ''}`),

  /**
   * Обновить оверлей строки (статус подготовки, приоритет, риск, комментарий).
   * rowId = "rentalId__equipmentRef"
   */
  updateItem: (rowId: string, payload: UpdatePlannerItemPayload): Promise<PlannerItemOverlay> =>
    api.put<PlannerItemOverlay>(`/api/planner/${encodeURIComponent(rowId)}`, payload),
};
