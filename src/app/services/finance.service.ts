import { api } from '../lib/api';
import type { ManagerBreakdownResponse } from '../types';

export const financeService = {
  getManagerBreakdown: (manager: string, today?: string): Promise<ManagerBreakdownResponse> => {
    const params = new URLSearchParams({ manager });
    if (today) params.set('today', today);
    return api.get<ManagerBreakdownResponse>(`/api/finance/manager-breakdown?${params.toString()}`);
  },
};
