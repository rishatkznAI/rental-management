import { api } from '../lib/api';
import type { AppSetting } from '../types';

export const appSettingsService = {
  getAll: (): Promise<AppSetting[]> =>
    api.get<AppSetting[]>('/api/app_settings')
      .catch((error: { status?: number }) => {
        if (error?.status === 403) {
          return api.get<AppSetting[]>('/api/public-settings');
        }
        throw error;
      }),

  create: (data: Omit<AppSetting, 'id'>): Promise<AppSetting> =>
    api.post<AppSetting>('/api/app_settings', data),

  update: (id: string, data: Partial<AppSetting>): Promise<AppSetting> =>
    api.patch<AppSetting>(`/api/app_settings/${id}`, data),
};
