import { loadPayments, savePayments } from '../mock-data';
import type { Payment } from '../types';

export const paymentsService = {
  getAll: async (): Promise<Payment[]> => {
    return loadPayments();
  },

  getById: async (id: string): Promise<Payment | undefined> => {
    return loadPayments().find((p) => p.id === id);
  },

  create: async (data: Omit<Payment, 'id'>): Promise<Payment> => {
    const newItem: Payment = { ...data, id: `P-${Date.now()}` };
    savePayments([...loadPayments(), newItem]);
    return newItem;
  },

  update: async (id: string, data: Partial<Payment>): Promise<Payment> => {
    const list = loadPayments();
    const idx = list.findIndex((p) => p.id === id);
    if (idx === -1) throw new Error(`Payment ${id} not found`);
    list[idx] = { ...list[idx], ...data };
    savePayments(list);
    return list[idx];
  },
};
