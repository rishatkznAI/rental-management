import { api } from '../lib/api';
import type { BotDetailResponse, BotSummary } from '../types';

export const botsService = {
  getAll: (): Promise<BotSummary[]> =>
    api.get<BotSummary[]>('/api/bots'),

  getById: (botId: string): Promise<BotDetailResponse> =>
    api.get<BotDetailResponse>(`/api/bots/${botId}`),
};
