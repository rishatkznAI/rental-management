import { api } from '../lib/api';
import type { BotConnectionMutationResponse, BotConnectionRole, BotDetailResponse, BotSummary } from '../types';

export const botsService = {
  getAll: (): Promise<BotSummary[]> =>
    api.get<BotSummary[]>('/api/bots'),

  getById: (botId: string): Promise<BotDetailResponse> =>
    api.get<BotDetailResponse>(`/api/bots/${botId}`),

  updateConnection: (botId: string, phone: string, data: { userRole: BotConnectionRole }): Promise<BotConnectionMutationResponse> =>
    api.patch<BotConnectionMutationResponse>(`/api/bots/${botId}/connections/${encodeURIComponent(phone)}`, data),

  disconnectConnection: (botId: string, phone: string): Promise<{ ok: boolean }> =>
    api.del<{ ok: boolean }>(`/api/bots/${botId}/connections/${encodeURIComponent(phone)}`),
};
