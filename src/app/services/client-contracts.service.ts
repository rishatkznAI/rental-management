import { api } from '../lib/api';
import type { ClientContract } from '../types';

export type ClientContractCreateInput = Omit<ClientContract, 'id' | 'counterpartyId' | 'number'> & {
  counterpartyId?: string;
};

export const clientContractsService = {
  getAll: (): Promise<ClientContract[]> =>
    api.get<ClientContract[]>('/api/client_contracts'),

  create: (data: ClientContractCreateInput, idempotencyKey?: string): Promise<ClientContract> =>
    api.post<ClientContract>('/api/client_contracts', data, idempotencyKey ? {
      headers: { 'Idempotency-Key': idempotencyKey },
    } : undefined),

  update: (id: string, data: Partial<ClientContract>): Promise<ClientContract> =>
    api.patch<ClientContract>(`/api/client_contracts/${id}`, data),
};
