import { api } from '../lib/api';
import type { Delivery, DeliveryCarrier } from '../types';

export type CreateDeliveryPayload = Omit<Delivery, 'id' | 'createdAt' | 'updatedAt' | 'createdBy' | 'botSentAt' | 'botSendError'>;
export type UpdateDeliveryPayload = Partial<CreateDeliveryPayload> & {
  status?: Delivery['status'];
  carrierInvoiceReceived?: boolean;
  clientPaymentVerified?: boolean;
};

export const deliveriesService = {
  getAll: (): Promise<Delivery[]> =>
    api.get<Delivery[]>('/api/deliveries'),

  getById: (id: string): Promise<Delivery> =>
    api.get<Delivery>(`/api/deliveries/${id}`),

  create: (payload: CreateDeliveryPayload): Promise<Delivery> =>
    api.post<Delivery>('/api/deliveries', payload),

  update: (id: string, payload: UpdateDeliveryPayload): Promise<Delivery> =>
    api.patch<Delivery>(`/api/deliveries/${id}`, payload),

  resendToCarrier: (id: string): Promise<Delivery> =>
    api.post<Delivery>(`/api/deliveries/${id}/send`, {}),

  delete: (id: string): Promise<{ ok: boolean }> =>
    api.del<{ ok: boolean }>(`/api/deliveries/${id}`),

  getCarriers: (): Promise<DeliveryCarrier[]> =>
    api.get<DeliveryCarrier[]>('/api/delivery-carriers'),
};
