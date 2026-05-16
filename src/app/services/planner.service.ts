import { api } from '../lib/api';
import type { PlannerRow, PlannerItemOverlay } from '../types';

export interface UpdatePlannerItemPayload {
  prepStatus?:       PlannerRow['prepStatus'];
  priorityOverride?: PlannerRow['priority'] | null;
  riskOverride?:     boolean | null;
  comment?:          string;
}

export interface PlannerRowsQuery {
  includeShipped?: boolean;
  dateFrom: string;
  dateTo: string;
}

export interface PlannerRowsResponse {
  items: PlannerRow[];
  dateFrom: string;
  dateTo: string;
  total: number;
}

export const plannerService = {
  /**
   * Получить строки планировщика.
   * includeShipped=true — показать уже отгруженные записи.
   */
  getRows: ({ includeShipped = false, dateFrom, dateTo }: PlannerRowsQuery): Promise<PlannerRowsResponse> => {
    const params = new URLSearchParams();
    if (includeShipped) params.set('include_shipped', '1');
    params.set('dateFrom', dateFrom);
    params.set('dateTo', dateTo);
    return api.get<PlannerRowsResponse>(`/api/planner?${params.toString()}`);
  },

  /**
   * Обновить оверлей строки (статус подготовки, приоритет, риск, комментарий).
   * rowId = "rentalId__equipmentRef"
   */
  updateItem: (rowId: string, payload: UpdatePlannerItemPayload): Promise<PlannerItemOverlay> =>
    api.put<PlannerItemOverlay>(`/api/planner/${encodeURIComponent(rowId)}`, payload),
};
