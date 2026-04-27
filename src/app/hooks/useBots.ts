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

type UpdateBotConnectionInput = {
  botId?: string;
  phone: string;
  userRole: BotConnectionRole;
};

function resolveBotId(explicitBotId?: string, fallbackBotId?: string) {
  const botId = explicitBotId || fallbackBotId || '';
  if (!botId) {
    throw new Error('Бот не выбран.');
  }
  return botId;
}

export function useUpdateBotConnection(botId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ botId: targetBotId, phone, userRole }: UpdateBotConnectionInput) =>
      botsService.updateConnection(resolveBotId(targetBotId, botId), phone, { userRole }),
    onSuccess: (_data, variables) => {
      const targetBotId = resolveBotId(variables.botId, botId);
      queryClient.invalidateQueries({ queryKey: BOT_KEYS.all });
      queryClient.invalidateQueries({ queryKey: BOT_KEYS.detail(targetBotId) });
    },
  });
}

type DisconnectBotConnectionInput = {
  botId?: string;
  phone: string;
};

export function useDisconnectBotConnection(botId?: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ botId: targetBotId, phone }: DisconnectBotConnectionInput) =>
      botsService.disconnectConnection(resolveBotId(targetBotId, botId), phone),
    onSuccess: (_data, variables) => {
      const targetBotId = resolveBotId(variables.botId, botId);
      queryClient.invalidateQueries({ queryKey: BOT_KEYS.all });
      queryClient.invalidateQueries({ queryKey: BOT_KEYS.detail(targetBotId) });
    },
  });
}
