import { api } from '../lib/api';
import type { Mechanic } from '../types';

export const mechanicsService = {
  getAll: (): Promise<Mechanic[]> =>
    api.get<Mechanic[]>('/api/mechanics'),

  bulkReplace: (list: Mechanic[]): Promise<void> =>
    api.put('/api/mechanics', list),
};
