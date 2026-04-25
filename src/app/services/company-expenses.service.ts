import { api } from '../lib/api';
import type { CompanyExpense } from '../types';

export const COMPANY_EXPENSE_KEYS = {
  all: ['company-expenses'] as const,
  detail: (id: string) => ['company-expenses', id] as const,
};

export const companyExpensesService = {
  getAll: (): Promise<CompanyExpense[]> =>
    api.get<CompanyExpense[]>('/api/company_expenses'),

  getById: (id: string): Promise<CompanyExpense | undefined> =>
    api.get<CompanyExpense>(`/api/company_expenses/${id}`).catch(() => undefined),

  create: (data: Omit<CompanyExpense, 'id'>): Promise<CompanyExpense> =>
    api.post<CompanyExpense>('/api/company_expenses', data),

  update: (id: string, data: Partial<CompanyExpense>): Promise<CompanyExpense> =>
    api.patch<CompanyExpense>(`/api/company_expenses/${id}`, data),

  delete: (id: string): Promise<void> =>
    api.del<void>(`/api/company_expenses/${id}`),

  bulkReplace: (list: CompanyExpense[]): Promise<void> =>
    api.put('/api/company_expenses', list),
};
