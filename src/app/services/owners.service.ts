import { api } from '../lib/api';
import type { Owner } from '../mock-data';

export const ownersService = {
  getAll: (): Promise<Owner[]> =>
    api.get<Owner[]>('/api/owners'),

  bulkReplace: (list: Owner[]): Promise<void> =>
    api.put('/api/owners', list),
};
