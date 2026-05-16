import { api, buildPaginatedQuery, type PaginatedQueryParams, type PaginatedResponse } from '../lib/api';
import { normalizeDeliveriesResponse, normalizeDeliveryRecord } from '../lib/deliveries-view.js';
import type { Delivery, DeliveryCarrier } from '../types';

export type CreateDeliveryPayload = Omit<Delivery, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'botSentAt' | 'botSendError'>;
export type UpdateDeliveryPayload = Partial<CreateDeliveryPayload> & {
  status?: Delivery['status'];
  carrierInvoiceReceived?: boolean;
  clientPaymentVerified?: boolean;
};

export const deliveriesService = {
  getAll: (): Promise<Delivery[]> =>
    api.get<unknown>('/api/deliveries').then((response) => normalizeDeliveriesResponse(response) as Delivery[]),

  getPaginated: (params?: PaginatedQueryParams): Promise<PaginatedResponse<Delivery>> =>
    api.get<PaginatedResponse<unknown>>(`/api/deliveries${buildPaginatedQuery(params)}`)
      .then((response) => ({
        ...response,
        items: normalizeDeliveriesResponse(response.items) as Delivery[],
      })),

  getById: (id: string): Promise<Delivery> =>
    api.get<unknown>(`/api/deliveries/${id}`).then((response) => normalizeDeliveryRecord(response) as Delivery),

  create: (payload: CreateDeliveryPayload): Promise<Delivery> =>
    api.post<unknown>('/api/deliveries', payload).then((response) => normalizeDeliveryRecord(response) as Delivery),

  update: (id: string, payload: UpdateDeliveryPayload): Promise<Delivery> =>
    api.patch<unknown>(`/api/deliveries/${id}`, payload).then((response) => normalizeDeliveryRecord(response) as Delivery),

  resendToCarrier: (id: string): Promise<Delivery> =>
    api.post<unknown>(`/api/deliveries/${id}/send`, {}).then((response) => normalizeDeliveryRecord(response) as Delivery),

  delete: (id: string): Promise<{ ok: boolean }> =>
    api.del<{ ok: boolean }>(`/api/deliveries/${id}`),

  getCarriers: (): Promise<DeliveryCarrier[]> =>
    api.get<DeliveryCarrier[]>('/api/delivery-carriers'),
};
