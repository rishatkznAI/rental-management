import { mockPayments } from '../mock-data';
import type { Payment } from '../types';

export const paymentsService = {
  getAll: async (): Promise<Payment[]> => {
    return [...mockPayments];
  },

  getById: async (id: string): Promise<Payment | undefined> => {
    return mockPayments.find((p) => p.id === id);
  },

  create: async (data: Omit<Payment, 'id'>): Promise<Payment> => {
    const newItem: Payment = { ...data, id: `P-${Date.now()}` };
    mockPayments.push(newItem);
    return newItem;
  },

  update: async (id: string, data: Partial<Payment>): Promise<Payment> => {
    const idx = mockPayments.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Payment ${id} not found`);
    mockPayments[idx] = { ...mockPayments[idx], ...data };
    return mockPayments[idx];
  },
};
