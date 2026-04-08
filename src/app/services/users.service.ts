import { api } from '../lib/api';
import type { SystemUser } from '../lib/userStorage';

export const usersService = {
  getAll: (): Promise<SystemUser[]> =>
    api.get<SystemUser[]>('/api/users'),

  getById: (id: string): Promise<SystemUser | undefined> =>
    api.get<SystemUser>(`/api/users/${id}`).catch(() => undefined),

  create: (data: Omit<SystemUser, 'id'>): Promise<SystemUser> =>
    api.post<SystemUser>('/api/users', data),

  update: (id: string, data: Partial<SystemUser>): Promise<SystemUser> =>
    api.patch<SystemUser>(`/api/users/${id}`, data),

  delete: (id: string): Promise<void> =>
    api.del(`/api/users/${id}`),

  bulkReplace: (list: SystemUser[]): Promise<void> =>
    api.put('/api/users', list),
};
