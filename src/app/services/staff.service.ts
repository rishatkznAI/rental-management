import { api } from '../lib/api';

export type StaffOption = {
  id: string;
  name: string;
  role?: string;
  status?: string;
};

export const staffService = {
  getManagerOptions: () => api.get<StaffOption[]>('/api/staff/manager-options'),
};
