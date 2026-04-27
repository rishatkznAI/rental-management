import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { botsService } from '../services/bots.service';
import type { BotConnectionRole } from '../types';

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

export function useUpdateBotConnection(botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ phone, userRole }: { phone: string; userRole: BotConnectionRole }) =>
      botsService.updateConnection(botId, phone, { userRole }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOT_KEYS.all });
      queryClient.invalidateQueries({ queryKey: BOT_KEYS.detail(botId) });
    },
  });
}

export function useDisconnectBotConnection(botId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (phone: string) => botsService.disconnectConnection(botId, phone),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: BOT_KEYS.all });
      queryClient.invalidateQueries({ queryKey: BOT_KEYS.detail(botId) });
    },
  });
}
