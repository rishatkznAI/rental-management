import type { BotConnectionRole } from '../types';

export const BOT_CONNECTION_ROLES: BotConnectionRole[] = [
  'Администратор',
  'Офис-менеджер',
  'Менеджер по аренде',
  'Менеджер по продажам',
  'Механик',
  'Младший стационарный механик',
  'Выездной механик',
  'Старший стационарный механик',
  'Перевозчик',
];

export function getSelectableBotConnectionRole(role: string | null): BotConnectionRole | undefined {
  return BOT_CONNECTION_ROLES.find(item => item === role);
}
