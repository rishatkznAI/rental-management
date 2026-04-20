import { api } from '../lib/api';
import type { DeliveryCarrier } from '../types';

export type DeliveryCarrierConnection = {
  id: string;
  key: string;
  name: string;
  role?: string;
  email?: string;
  phone?: string;
  chatId?: number | null;
  userId?: number | null;
};

export const deliveryCarriersService = {
  getAll: (): Promise<DeliveryCarrier[]> =>
    api.get<DeliveryCarrier[]>('/api/delivery_carriers'),

  bulkReplace: (list: DeliveryCarrier[]): Promise<void> =>
    api.put('/api/delivery_carriers', list),

  getConnections: (): Promise<DeliveryCarrierConnection[]> =>
    api.get<DeliveryCarrierConnection[]>('/api/delivery-carrier-connections'),
};
