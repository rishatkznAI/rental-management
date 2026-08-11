import { api } from '../lib/api';
import type { Counterparty, CounterpartyRole, CounterpartyType } from '../types';

export type CounterpartyCreateInput = Pick<Counterparty, 'type' | 'legalName' | 'roles'> &
  Partial<Pick<Counterparty,
    | 'shortName'
    | 'inn'
    | 'kpp'
    | 'ogrn'
    | 'ogrnip'
    | 'legalAddress'
    | 'actualAddress'
    | 'email'
    | 'phone'
    | 'website'
    | 'notes'
  >> & { status?: 'active' | 'inactive' };

export type CounterpartyUpdateInput = Partial<Omit<CounterpartyCreateInput, 'roles'>>;

export interface CounterpartyListParams {
  includeArchived?: boolean;
  role?: CounterpartyRole;
  type?: CounterpartyType;
  search?: string;
}

export interface CounterpartyRolesResponse {
  counterpartyId: string;
  roles: CounterpartyRole[];
}

export interface CounterpartyRoleMutationResponse {
  ok: true;
  changed: boolean;
  counterparty: Counterparty;
}

function buildQuery(params: CounterpartyListParams = {}) {
  const query = new URLSearchParams();
  if (params.includeArchived) query.set('includeArchived', '1');
  if (params.role) query.set('role', params.role);
  if (params.type) query.set('type', params.type);
  if (params.search) query.set('search', params.search);
  const value = query.toString();
  return value ? `?${value}` : '';
}

export const counterpartiesService = {
  getAll: (params?: CounterpartyListParams): Promise<Counterparty[]> =>
    api.get<Counterparty[]>(`/api/counterparties${buildQuery(params)}`),

  getById: (id: string): Promise<Counterparty | undefined> =>
    api.get<Counterparty>(`/api/counterparties/${id}`).catch(() => undefined),

  getRoles: (id: string): Promise<CounterpartyRolesResponse> =>
    api.get<CounterpartyRolesResponse>(`/api/counterparties/${id}/roles`),

  create: (data: CounterpartyCreateInput): Promise<Counterparty> =>
    api.post<Counterparty>('/api/counterparties', data),

  update: (id: string, data: CounterpartyUpdateInput): Promise<Counterparty> =>
    api.patch<Counterparty>(`/api/counterparties/${id}`, data),

  addRole: (id: string, role: CounterpartyRole): Promise<CounterpartyRoleMutationResponse> =>
    api.post<CounterpartyRoleMutationResponse>(`/api/counterparties/${id}/roles`, { role }),

  removeRole: (id: string, role: CounterpartyRole): Promise<CounterpartyRoleMutationResponse> =>
    api.del<CounterpartyRoleMutationResponse>(`/api/counterparties/${id}/roles/${role}`),

  archive: (id: string): Promise<{ ok: true; counterparty: Counterparty }> =>
    api.del<{ ok: true; counterparty: Counterparty }>(`/api/counterparties/${id}`),
};
