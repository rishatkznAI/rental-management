import { api, buildPaginatedQuery, type PaginatedQueryParams, type PaginatedResponse } from '../lib/api';
import type { BotConnectionMutationResponse, BotConnectionRole, BotDetailResponse, BotSummary } from '../types';

export type PaginatedBotDetailResponse = Omit<BotDetailResponse, 'activity'> & {
  activity: PaginatedResponse<BotDetailResponse['activity'][number]>;
};

export const botsService = {
  getAll: (): Promise<BotSummary[]> =>
    api.get<BotSummary[]>('/api/bots'),

  getById: (botId: string): Promise<BotDetailResponse> =>
    api.get<BotDetailResponse>(`/api/bots/${botId}`),

  getByIdPaginated: (botId: string, params?: PaginatedQueryParams): Promise<PaginatedBotDetailResponse> =>
    api.get<PaginatedBotDetailResponse>(`/api/bots/${botId}${buildPaginatedQuery(params)}`),

  updateConnection: (botId: string, phone: string, data: { userRole: BotConnectionRole }): Promise<BotConnectionMutationResponse> =>
    api.patch<BotConnectionMutationResponse>(`/api/bots/${botId}/connections/${encodeURIComponent(phone)}`, data),

  disconnectConnection: (botId: string, phone: string): Promise<{ ok: boolean }> =>
    api.del<{ ok: boolean }>(`/api/bots/${botId}/connections/${encodeURIComponent(phone)}`),
};
