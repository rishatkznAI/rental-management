import { useQuery } from '@tanstack/react-query';
import { botsService } from '../services/bots.service';

export const BOT_KEYS = {
  all: ['bots'] as const,
  detail: (botId: string) => ['bots', botId] as const,
};

export function useBotsList() {
  return useQuery({
    queryKey: BOT_KEYS.all,
    queryFn: botsService.getAll,
    staleTime: 1000 * 60,
  });
}

export function useBotById(botId: string) {
  return useQuery({
    queryKey: BOT_KEYS.detail(botId),
    queryFn: () => botsService.getById(botId),
    enabled: Boolean(botId),
    staleTime: 1000 * 30,
  });
}
