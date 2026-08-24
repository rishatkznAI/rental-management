import { api } from '../lib/api';
import type { ClientContract } from '../types';

export type ClientContractCreateInput = Omit<ClientContract, 'id' | 'counterpartyId' | 'number'> & {
  counterpartyId?: string;
};

export type ClientContractDeleteContext = {
  clientId?: string;
  counterpartyId?: string;
};

export type ClientContractUpdateInput = Partial<Pick<
  ClientContract,
  'date' | 'title' | 'objectId' | 'objectIds' | 'notes' | 'status'
>>;

export const clientContractsService = {
  getAll: (): Promise<ClientContract[]> =>
    api.get<ClientContract[]>('/api/client_contracts'),

  create: (data: ClientContractCreateInput, idempotencyKey?: string): Promise<ClientContract> =>
    api.post<ClientContract>('/api/client_contracts', data, idempotencyKey ? {
      headers: { 'Idempotency-Key': idempotencyKey },
    } : undefined),

  update: (id: string, data: ClientContractUpdateInput): Promise<ClientContract> =>
    api.patch<ClientContract>(`/api/client_contracts/${id}`, data),

  delete: (id: string, context: ClientContractDeleteContext): Promise<{ ok: true }> => {
    const params = new URLSearchParams();
    if (context.clientId) params.set('clientId', context.clientId);
    if (context.counterpartyId) params.set('counterpartyId', context.counterpartyId);
    return api.del<{ ok: true }>(`/api/client_contracts/${id}?${params.toString()}`);
  },
};
