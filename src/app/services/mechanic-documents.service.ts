import { api } from '../lib/api';
import type { MechanicDocument } from '../types';

export const mechanicDocumentsService = {
  getAll: (): Promise<MechanicDocument[]> =>
    api.get<MechanicDocument[]>('/api/mechanic_documents').catch(() => []),
  bulkReplace: (list: MechanicDocument[]): Promise<void> =>
    api.put('/api/mechanic_documents', list),
};
