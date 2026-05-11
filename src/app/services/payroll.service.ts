import { api } from '../lib/api';
import type {
  PayrollAdjustment,
  PayrollAdjustmentType,
  PayrollAuditEvent,
  PayrollKpiSettings,
  PayrollPeriod,
  PayrollProfile,
  PayrollRecord,
} from '../types';

export type PayrollProfilePayload = Partial<Omit<PayrollProfile, 'id' | 'currency' | 'createdAt' | 'updatedAt'>>;
export type PayrollRecordPayload = Partial<Pick<
  PayrollRecord,
  | 'baseSalary'
  | 'kpiAmount'
  | 'bonusAmount'
  | 'deductionAmount'
  | 'advanceAmount'
  | 'compensationAmount'
  | 'adminComment'
>>;

export interface PayrollAdjustmentPayload {
  type: PayrollAdjustmentType;
  amount: number;
  reason: string;
}

export interface PayrollCalculationResult {
  period: PayrollPeriod;
  records: PayrollRecord[];
}

export type PayrollKpiSettingsPayload = Partial<PayrollKpiSettings>;

export const payrollService = {
  getPayrollProfiles: (): Promise<PayrollProfile[]> =>
    api.get<PayrollProfile[]>('/api/payroll/profiles'),

  createPayrollProfile: (payload: PayrollProfilePayload): Promise<PayrollProfile> =>
    api.post<PayrollProfile>('/api/payroll/profiles', payload),

  updatePayrollProfile: (id: string, payload: PayrollProfilePayload): Promise<PayrollProfile> =>
    api.patch<PayrollProfile>(`/api/payroll/profiles/${id}`, payload),

  getPayrollKpiSettings: (): Promise<PayrollKpiSettings> =>
    api.get<PayrollKpiSettings>('/api/payroll/kpi-settings'),

  updatePayrollKpiSettings: (payload: PayrollKpiSettingsPayload): Promise<PayrollKpiSettings> =>
    api.patch<PayrollKpiSettings>('/api/payroll/kpi-settings', payload),

  getPayrollPeriods: (): Promise<PayrollPeriod[]> =>
    api.get<PayrollPeriod[]>('/api/payroll/periods'),

  calculatePayrollPeriod: (month: string): Promise<PayrollCalculationResult> =>
    api.post<PayrollCalculationResult>('/api/payroll/periods/calculate', { month }),

  getPayrollRecords: (month?: string): Promise<PayrollRecord[]> =>
    api.get<PayrollRecord[]>(`/api/payroll/records${month ? `?month=${encodeURIComponent(month)}` : ''}`),

  getPayrollRecord: (id: string): Promise<PayrollRecord> =>
    api.get<PayrollRecord>(`/api/payroll/records/${id}`),

  getPayrollRecordAdjustments: (id: string): Promise<PayrollAdjustment[]> =>
    api.get<PayrollAdjustment[]>(`/api/payroll/records/${id}/adjustments`),

  getPayrollAdjustments: (userId?: string): Promise<PayrollAdjustment[]> =>
    api.get<PayrollAdjustment[]>(`/api/payroll/adjustments${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),

  getPayrollAuditEvents: (userId?: string): Promise<PayrollAuditEvent[]> =>
    api.get<PayrollAuditEvent[]>(`/api/payroll/audit-events${userId ? `?userId=${encodeURIComponent(userId)}` : ''}`),

  updatePayrollRecord: (id: string, payload: PayrollRecordPayload): Promise<PayrollRecord> =>
    api.patch<PayrollRecord>(`/api/payroll/records/${id}`, payload),

  addPayrollAdjustment: (recordId: string, payload: PayrollAdjustmentPayload): Promise<{ adjustment: PayrollAdjustment; record: PayrollRecord }> =>
    api.post<{ adjustment: PayrollAdjustment; record: PayrollRecord }>(`/api/payroll/records/${recordId}/adjustments`, payload),

  approvePayrollPeriod: (periodId: string): Promise<PayrollCalculationResult> =>
    api.post<PayrollCalculationResult>(`/api/payroll/periods/${periodId}/approve`, {}),

  markPayrollPeriodPaid: (periodId: string): Promise<PayrollCalculationResult> =>
    api.post<PayrollCalculationResult>(`/api/payroll/periods/${periodId}/mark-paid`, {}),

  closePayrollPeriod: (periodId: string): Promise<PayrollCalculationResult> =>
    api.post<PayrollCalculationResult>(`/api/payroll/periods/${periodId}/close`, {}),
};
