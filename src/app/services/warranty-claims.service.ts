import { api } from '../lib/api';
import type { WarrantyClaim } from '../types';

export type WarrantyClaimDto = WarrantyClaim & {
  counterpartyId?: string;
  counterpartyName?: string;
  customerDisplayName?: string;
  factoryCounterpartyDisplayName?: string;
};

export type WarrantyFactoryCounterpartyOption = {
  id: string;
  displayLabel: string;
};

export type WarrantyClaimsQuery = {
  counterpartyId?: string;
  factoryCounterpartyId?: string;
  clientId?: string;
};

export const warrantyClaimsService = {
  getAll: (query: WarrantyClaimsQuery = {}): Promise<WarrantyClaimDto[]> => {
    const params = new URLSearchParams();
    if (query.counterpartyId) params.set('counterpartyId', query.counterpartyId);
    if (query.factoryCounterpartyId) params.set('factoryCounterpartyId', query.factoryCounterpartyId);
    if (query.clientId) params.set('clientId', query.clientId);
    const suffix = params.size > 0 ? `?${params.toString()}` : '';
    return api.get<WarrantyClaimDto[]>(`/api/warranty_claims${suffix}`);
  },

  create: (data: Omit<WarrantyClaim, 'id'>): Promise<WarrantyClaimDto> =>
    api.post<WarrantyClaimDto>('/api/warranty_claims', data),

  update: (id: string, data: Partial<WarrantyClaim>): Promise<WarrantyClaimDto> =>
    api.patch<WarrantyClaimDto>(`/api/warranty_claims/${id}`, data),

  delete: (id: string): Promise<void> =>
    api.del(`/api/warranty_claims/${id}`),

  getFactoryCounterpartyOptions: (): Promise<WarrantyFactoryCounterpartyOption[]> =>
    api.get<WarrantyFactoryCounterpartyOption[]>('/api/warranty_claims/factory-counterparty-options'),
};
