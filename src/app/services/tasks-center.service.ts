import { api } from '../lib/api';

export type TaskPriority = 'low' | 'medium' | 'high' | 'critical';

export type TaskCenterTask = {
  id: string;
  type: string;
  title: string;
  description?: string;
  priority: TaskPriority;
  dueDate?: string;
  section: string;
  entityType?: string;
  entityId?: string;
  clientId?: string;
  clientName?: string;
  assignedTo?: string;
  responsible?: string;
  status: 'open' | 'done' | 'dismissed';
  actionUrl: string;
  detectedAt?: string;
  source: 'computed' | 'manual' | 'system';
  amount?: number;
};

export type TasksCenterResponse = {
  generatedAt: string;
  permissions?: {
    canViewFinance?: boolean;
  };
  summary: {
    total: number;
    critical: number;
    high: number;
    overdue: number;
    today: number;
  };
  tasks: TaskCenterTask[];
};

export const tasksCenterService = {
  getAll: (): Promise<TasksCenterResponse> =>
    api.get<TasksCenterResponse>('/api/tasks-center'),
};
