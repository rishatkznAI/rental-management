import { api } from '../lib/api';

export type ProfilePayload = {
  name: string;
  profilePhoto?: string;
};

export const profileService = {
  updateProfile: (data: ProfilePayload) =>
    api.patch<{ ok: true; user: { userId: string; userName: string; userRole: string; email: string; profilePhoto?: string; ownerId?: string; ownerName?: string } }>(
      '/api/auth/profile',
      data,
    ),

  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ ok: true }>('/api/auth/change-password', { currentPassword, newPassword }),
};
