import React, { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Calculator, CheckCircle2, CircleDollarSign, History, Pencil, Plus, Power, WalletCards, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { normalizeUserRole, type SystemUser } from '../lib/userStorage';
import { payrollService, type PayrollAdjustmentPayload, type PayrollKpiSettingsPayload, type PayrollProfilePayload } from '../services/payroll.service';
import { usersService } from '../services/users.service';
import type { PayrollAdjustment, PayrollAdjustmentType, PayrollAuditEvent, PayrollKpiSchemeType, PayrollKpiSettings, PayrollPeriod, PayrollProfile, PayrollRecord } from '../types';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Badge } from '../components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../components/ui/table';
import { cn } from '../lib/utils';

const KPI_SCHEME_LABELS: Record<string, string> = {
  none: 'Без KPI',
  manual: 'Ручной KPI',
  rental_manager: 'Менеджер по аренде',
  sales_manager: 'Менеджер по продажам',
  service_mechanic: 'Механик сервиса',
  office_manager: 'Офис-менеджер',
  custom: 'Индивидуальная',
};

const PERIOD_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  calculated: 'Рассчитан',
  approved: 'Утверждён',
  paid: 'Выплачен',
  closed: 'Закрыт',
};

const RECORD_STATUS_LABELS: Record<string, string> = {
  draft: 'Черновик',
  approved: 'Утверждён',
  paid: 'Выплачен',
};

const ADJUSTMENT_LABELS: Record<PayrollAdjustmentType, string> = {
  bonus: 'Бонус',
  deduction: 'Удержание',
  advance: 'Аванс',
  compensation: 'Компенсация',
  manual_kpi: 'Ручной KPI',
};

const ADJUSTMENT_ACTIONS: Array<{ type: PayrollAdjustmentType; label: string }> = [
  { type: 'bonus', label: 'Добавить бонус' },
  { type: 'deduction', label: 'Добавить удержание' },
  { type: 'advance', label: 'Добавить аванс' },
  { type: 'compensation', label: 'Добавить компенсацию' },
  { type: 'manual_kpi', label: 'Изменить KPI вручную' },
];

const DEFAULT_KPI_SETTINGS: PayrollKpiSettings = {
  rentalManager: {
    percentFromProfitWithoutVat: 0,
    paidOnly: true,
    closedRentalsOnly: true,
    minimumPlan: 0,
    manualBaseAmount: 0,
    comment: '',
  },
  salesManager: {
    percentFromMargin: 0,
    fixedBonusPerSoldEquipment: 0,
    paidSalesOnly: true,
    manualMarginAmount: 0,
    soldEquipmentCount: 0,
    comment: '',
  },
  serviceMechanic: {
    bonusPerClosedTicket: 0,
    bonusPerFieldTrip: 0,
    manualBonus: 0,
    manualClosedTickets: 0,
    manualFieldTrips: 0,
    comment: '',
  },
  officeManager: {
    fixedBonus: 0,
    manualBonus: 0,
    comment: '',
  },
  customSchemes: [],
};

function normalizeKpiSettings(value?: PayrollKpiSettings | null): PayrollKpiSettings {
  return {
    rentalManager: { ...DEFAULT_KPI_SETTINGS.rentalManager, ...(value?.rentalManager || {}) },
    salesManager: { ...DEFAULT_KPI_SETTINGS.salesManager, ...(value?.salesManager || {}) },
    serviceMechanic: { ...DEFAULT_KPI_SETTINGS.serviceMechanic, ...(value?.serviceMechanic || {}) },
    officeManager: { ...DEFAULT_KPI_SETTINGS.officeManager, ...(value?.officeManager || {}) },
    customSchemes: Array.isArray(value?.customSchemes) ? value.customSchemes : [],
  };
}

function currentMonth(): string {
  return new Date().toISOString().slice(0, 7);
}

function formatMoney(value: number | undefined | null): string {
  return new Intl.NumberFormat('ru-RU', {
    style: 'currency',
    currency: 'RUB',
    maximumFractionDigits: 0,
  }).format(Number(value || 0));
}

function formatDateTime(value?: string | null): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function formatAuditValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'number') return formatMoney(value);
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'string') return value;
  return 'Изменено';
}

function auditChangeSummary(event: PayrollAuditEvent): { oldValue: string; newValue: string } {
  const before = (event.before || {}) as Record<string, unknown>;
  const after = (event.after || {}) as Record<string, unknown>;
  const keys = ['baseSalary', 'kpiSchemeType', 'kpiPercent', 'kpiFixedAmount', 'kpiAmount', 'bonusAmount', 'deductionAmount', 'advanceAmount', 'compensationAmount', 'status'];
  const changed = keys.find(key => JSON.stringify(before[key]) !== JSON.stringify(after[key]));
  if (!changed) return { oldValue: formatAuditValue(event.before), newValue: formatAuditValue(event.after) };
  return { oldValue: formatAuditValue(before[changed]), newValue: formatAuditValue(after[changed]) };
}

function statusBadgeClass(status: string): string {
  if (status === 'paid' || status === 'closed') return 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300';
  if (status === 'approved') return 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300';
  if (status === 'calculated') return 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300';
  return 'bg-muted text-muted-foreground';
}

function EmptyState({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-border bg-muted/25 px-6 py-10 text-center">
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function MetricCard({ label, value, tone = 'default' }: { label: string; value: string; tone?: 'default' | 'positive' | 'warning' }) {
  return (
    <Card className="app-kpi-card border-border/80 p-0">
      <CardContent className="p-4">
        <p className="text-xs font-medium text-muted-foreground">{label}</p>
        <p className={cn(
          'mt-2 text-xl font-bold text-foreground',
          tone === 'positive' && 'text-emerald-600 dark:text-emerald-300',
          tone === 'warning' && 'text-amber-600 dark:text-amber-300',
        )}>
          {value}
        </p>
      </CardContent>
    </Card>
  );
}

type PayrollProfileFormState = {
  userId: string;
  employeeName: string;
  role: string;
  baseSalary: string;
  kpiSchemeType: PayrollKpiSchemeType;
  kpiPercent: string;
  kpiFixedAmount: string;
  kpiDescription: string;
  isActive: boolean;
  startedAt: string;
  endedAt: string;
  notes: string;
};

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

function profileToForm(profile?: PayrollProfile | null): PayrollProfileFormState {
  return {
    userId: profile?.userId || '',
    employeeName: profile?.employeeName || '',
    role: profile?.role || '',
    baseSalary: profile?.baseSalary !== undefined ? String(profile.baseSalary) : '',
    kpiSchemeType: (profile?.kpiSchemeType as PayrollKpiSchemeType) || 'none',
    kpiPercent: profile?.kpiPercent !== undefined ? String(profile.kpiPercent) : '',
    kpiFixedAmount: profile?.kpiFixedAmount !== undefined ? String(profile.kpiFixedAmount) : '',
    kpiDescription: profile?.kpiDescription || '',
    isActive: profile?.isActive ?? true,
    startedAt: profile?.startedAt || todayDate(),
    endedAt: profile?.endedAt || '',
    notes: profile?.notes || '',
  };
}

function validateProfileForm(form: PayrollProfileFormState, profiles: PayrollProfile[], editingId: string | null): string | null {
  if (!form.userId.trim()) return 'Выберите пользователя системы';
  if (!form.employeeName.trim()) return 'Укажите имя сотрудника';
  if (!form.role.trim()) return 'Укажите роль сотрудника';
  const baseSalary = Number(form.baseSalary || 0);
  if (!Number.isFinite(baseSalary) || baseSalary < 0) return 'Оклад должен быть числом не меньше 0';
  const kpiPercent = form.kpiPercent === '' ? 0 : Number(form.kpiPercent);
  if (!Number.isFinite(kpiPercent) || kpiPercent < 0 || kpiPercent > 100) return 'Процент KPI должен быть от 0 до 100';
  const kpiFixedAmount = form.kpiFixedAmount === '' ? 0 : Number(form.kpiFixedAmount);
  if (!Number.isFinite(kpiFixedAmount) || kpiFixedAmount < 0) return 'Фиксированный KPI должен быть числом не меньше 0';
  if (!form.startedAt) return 'Укажите дату начала действия профиля';
  if (form.isActive) {
    const duplicate = profiles.find(profile =>
      profile.id !== editingId &&
      profile.isActive !== false &&
      String(profile.userId || '') === form.userId.trim(),
    );
    if (duplicate) return 'Для этого пользователя уже есть активный зарплатный профиль';
  }
  return null;
}

function formToPayload(form: PayrollProfileFormState): PayrollProfilePayload {
  return {
    userId: form.userId.trim(),
    employeeName: form.employeeName.trim(),
    role: form.role.trim(),
    baseSalary: Number(form.baseSalary || 0),
    kpiSchemeType: form.kpiSchemeType,
    kpiPercent: form.kpiPercent === '' ? undefined : Number(form.kpiPercent),
    kpiFixedAmount: form.kpiFixedAmount === '' ? undefined : Number(form.kpiFixedAmount),
    kpiDescription: form.kpiDescription.trim(),
    isActive: form.isActive,
    startedAt: form.startedAt || todayDate(),
    endedAt: form.endedAt ? form.endedAt : null,
    notes: form.notes.trim(),
  };
}

type AdjustmentFormState = {
  type: PayrollAdjustmentType;
  amount: string;
  reason: string;
};

function validateAdjustmentForm(form: AdjustmentFormState): string | null {
  const amount = Number(form.amount || 0);
  if (!Number.isFinite(amount) || amount <= 0) return 'Укажите сумму больше 0';
  if (!form.reason.trim()) return 'Укажите причину корректировки';
  return null;
}

function adjustmentPayload(form: AdjustmentFormState): PayrollAdjustmentPayload {
  return {
    type: form.type,
    amount: Number(form.amount || 0),
    reason: form.reason.trim(),
  };
}

function ProfileModal({
  open,
  profile,
  users,
  profiles,
  onClose,
  onSubmit,
  saving,
}: {
  open: boolean;
  profile: PayrollProfile | null;
  users: SystemUser[];
  profiles: PayrollProfile[];
  onClose: () => void;
  onSubmit: (payload: PayrollProfilePayload) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState<PayrollProfileFormState>(() => profileToForm(profile));
  const [showInactiveUsers, setShowInactiveUsers] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  React.useEffect(() => {
    if (open) {
      setForm(profileToForm(profile));
      setFormError(null);
      setShowInactiveUsers(false);
    }
  }, [open, profile]);

  if (!open) return null;

  const availableUsers = users.filter(item => showInactiveUsers || item.status !== 'Неактивен' || item.id === form.userId);

  const update = (field: keyof PayrollProfileFormState, value: string | boolean) => {
    setForm(current => ({ ...current, [field]: value }));
  };

  const handleUserChange = (userId: string) => {
    const selectedUser = users.find(item => item.id === userId);
    setForm(current => ({
      ...current,
      userId,
      employeeName: selectedUser?.name || current.employeeName,
      role: selectedUser?.role || current.role,
    }));
    setFormError(null);
  };

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const error = validateProfileForm(form, profiles, profile?.id || null);
    if (error) {
      setFormError(error);
      return;
    }
    onSubmit(formToPayload(form));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4 py-6">
      <form onSubmit={submit} className="w-full max-w-2xl overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <div className="border-b border-border px-6 py-4">
          <h2 className="text-lg font-bold text-foreground">{profile ? 'Редактировать зарплатный профиль' : 'Создать зарплатный профиль'}</h2>
          <p className="mt-1 text-sm text-muted-foreground">Изменения профиля применяются только к будущим расчётам. Уже созданные записи хранят snapshot оклада и KPI.</p>
        </div>
        <div className="grid max-h-[70vh] gap-4 overflow-y-auto p-6 md:grid-cols-2">
          {formError ? (
            <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-300 md:col-span-2">
              {formError}
            </div>
          ) : null}
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Пользователь системы</span>
            <select
              value={form.userId}
              onChange={event => handleUserChange(event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
              required
            >
              <option value="">Выберите пользователя</option>
              {availableUsers.map(item => (
                <option key={item.id} value={item.id}>
                  {item.name} · {item.role}{item.status === 'Неактивен' ? ' · неактивен' : ''}
                </option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Имя сотрудника</span>
            <Input value={form.employeeName} onChange={event => update('employeeName', event.target.value)} required placeholder="Иванов И. И." />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Роль</span>
            <Input value={form.role} onChange={event => update('role', event.target.value)} required placeholder="Менеджер по аренде" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Оклад</span>
            <Input value={form.baseSalary} onChange={event => update('baseSalary', event.target.value)} required type="number" min="0" step="1" placeholder="100000" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Тип KPI</span>
            <select
              value={form.kpiSchemeType}
              onChange={event => update('kpiSchemeType', event.target.value)}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              {Object.entries(KPI_SCHEME_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Процент KPI</span>
            <Input value={form.kpiPercent} onChange={event => update('kpiPercent', event.target.value)} type="number" min="0" step="0.1" placeholder="10" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Фиксированный KPI</span>
            <Input value={form.kpiFixedAmount} onChange={event => update('kpiFixedAmount', event.target.value)} type="number" min="0" step="1" placeholder="5000" />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Активен</span>
            <select
              value={form.isActive ? 'yes' : 'no'}
              onChange={event => update('isActive', event.target.value === 'yes')}
              className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
            >
              <option value="yes">Да</option>
              <option value="no">Нет</option>
            </select>
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Дата начала</span>
            <Input value={form.startedAt} onChange={event => update('startedAt', event.target.value)} type="date" required />
          </label>
          <label className="space-y-1.5">
            <span className="text-xs font-medium text-muted-foreground">Дата окончания</span>
            <Input value={form.endedAt} onChange={event => update('endedAt', event.target.value)} type="date" />
          </label>
          <label className="space-y-1.5 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Описание KPI</span>
            <Input value={form.kpiDescription} onChange={event => update('kpiDescription', event.target.value)} placeholder="Как начисляется KPI" />
          </label>
          <label className="space-y-1.5 md:col-span-2">
            <span className="text-xs font-medium text-muted-foreground">Комментарий</span>
            <Input value={form.notes} onChange={event => update('notes', event.target.value)} placeholder="Условия начисления, примечания" />
          </label>
          <label className="flex items-center gap-2 text-sm text-muted-foreground md:col-span-2">
            <input
              type="checkbox"
              checked={showInactiveUsers}
              onChange={event => setShowInactiveUsers(event.target.checked)}
              className="h-4 w-4 rounded border-border"
            />
            Показать неактивных пользователей
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-border px-6 py-4">
          <Button type="button" variant="outline" onClick={onClose} disabled={saving}>Отмена</Button>
          <Button type="submit" disabled={saving}>{saving ? 'Сохраняем...' : profile ? 'Сохранить изменения' : 'Создать профиль'}</Button>
        </div>
      </form>
    </div>
  );
}

function PayrollRecordDrawer({
  record,
  adjustments,
  locked,
  saving,
  onClose,
  onAddAdjustment,
}: {
  record: PayrollRecord | null;
  adjustments: PayrollAdjustment[];
  locked: boolean;
  saving: boolean;
  onClose: () => void;
  onAddAdjustment: (payload: PayrollAdjustmentPayload) => void;
}) {
  const [form, setForm] = useState<AdjustmentFormState>({
    type: 'bonus',
    amount: '',
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);

  React.useEffect(() => {
    if (record) {
      setForm({ type: 'bonus', amount: '', reason: '' });
      setError(null);
    }
  }, [record?.id]);

  if (!record) return null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const validation = validateAdjustmentForm(form);
    if (validation) {
      setError(validation);
      return;
    }
    onAddAdjustment(adjustmentPayload(form));
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45">
      <div className="flex h-full w-full max-w-3xl flex-col overflow-hidden bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">Расчёт сотрудника</h2>
            <p className="mt-1 text-sm text-muted-foreground">{record.employeeName} · {record.month}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть расчёт сотрудника">
            <X className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Оклад" value={formatMoney(record.baseSalary)} />
            <MetricCard label="KPI" value={formatMoney(record.kpiAmount)} />
            <MetricCard label="Gross" value={formatMoney(record.grossAmount)} />
            <MetricCard label="К выплате" value={formatMoney(record.netAmount)} tone="positive" />
          </div>

          <Card className="rounded-2xl border-border">
            <CardHeader>
              <CardTitle className="text-base">Структура выплаты</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">KPI-схема</span><span className="font-medium">{KPI_SCHEME_LABELS[record.kpiSchemeType] || record.kpiSchemeType}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">База KPI</span><span className="font-medium">{formatMoney(record.kpiBaseAmount)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Бонусы</span><span className="font-medium text-emerald-600">{formatMoney(record.bonusAmount)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Удержания</span><span className="font-medium text-amber-600">{formatMoney(record.deductionAmount)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Аванс</span><span className="font-medium">{formatMoney(record.advanceAmount)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Компенсации</span><span className="font-medium text-emerald-600">{formatMoney(record.compensationAmount)}</span></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Статус</span><Badge className={cn('rounded-full', statusBadgeClass(record.status))}>{RECORD_STATUS_LABELS[record.status] || record.status}</Badge></div>
              <div className="flex justify-between gap-4"><span className="text-muted-foreground">Обновлено</span><span className="font-medium">{formatDateTime(record.updatedAt)}</span></div>
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border">
            <CardHeader>
              <CardTitle className="text-base">Корректировки</CardTitle>
            </CardHeader>
            <CardContent>
              {locked ? (
                <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                  Период или запись уже зафиксированы. Корректировки недоступны.
                </div>
              ) : null}
              <form onSubmit={submit} className="grid gap-3 md:grid-cols-[180px_140px_1fr_auto] md:items-end">
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Действие</span>
                  <select
                    value={form.type}
                    onChange={event => setForm(current => ({ ...current, type: event.target.value as PayrollAdjustmentType }))}
                    className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground"
                    disabled={locked || saving}
                  >
                    {ADJUSTMENT_ACTIONS.map(action => (
                      <option key={action.type} value={action.type}>{action.label}</option>
                    ))}
                  </select>
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Сумма</span>
                  <Input
                    type="number"
                    min="0"
                    step="1"
                    value={form.amount}
                    onChange={event => setForm(current => ({ ...current, amount: event.target.value }))}
                    disabled={locked || saving}
                    placeholder="0"
                  />
                </label>
                <label className="space-y-1.5">
                  <span className="text-xs font-medium text-muted-foreground">Причина</span>
                  <Input
                    value={form.reason}
                    onChange={event => setForm(current => ({ ...current, reason: event.target.value }))}
                    disabled={locked || saving}
                    placeholder="Например: премия за месяц"
                  />
                </label>
                <Button type="submit" disabled={locked || saving}>{saving ? 'Сохраняем...' : 'Добавить'}</Button>
              </form>
              {error ? <p className="mt-2 text-sm text-red-600">{error}</p> : null}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border">
            <CardHeader>
              <CardTitle className="text-base">История изменений</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {adjustments.length === 0 ? (
                <p className="text-sm text-muted-foreground">Ручных корректировок пока нет.</p>
              ) : adjustments.map(item => (
                <div key={item.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-foreground">{ADJUSTMENT_LABELS[item.type] || item.type}: {formatMoney(item.amount)}</span>
                    <span className="text-muted-foreground">{formatDateTime(item.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{item.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Изменил: {item.createdByName || 'Администратор'}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border">
            <CardHeader>
              <CardTitle className="text-base">Детали расчёта</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {(record.calculationDetails || []).length === 0 ? (
                <p className="text-sm text-muted-foreground">Детали расчёта отсутствуют.</p>
              ) : record.calculationDetails.map((item, index) => (
                <div key={`${item.label}-${index}`} className="flex flex-wrap items-start justify-between gap-3 rounded-xl bg-muted/30 px-3 py-2 text-sm">
                  <div>
                    <p className="font-medium text-foreground">{item.label}</p>
                    {item.comment ? <p className="text-xs text-muted-foreground">{item.comment}</p> : null}
                  </div>
                  <span className="font-semibold">{item.amount ? formatMoney(item.amount) : item.type}</span>
                </div>
              ))}
              {record.adminComment ? (
                <div className="rounded-xl border border-border px-3 py-2 text-sm">
                  <p className="font-medium text-foreground">Комментарий администратора</p>
                  <p className="mt-1 text-muted-foreground">{record.adminComment}</p>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

export default function Payroll() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = normalizeUserRole(user?.role) === 'Администратор';
  const [month, setMonth] = useState(currentMonth());
  const [profileModalOpen, setProfileModalOpen] = useState(false);
  const [editingProfile, setEditingProfile] = useState<PayrollProfile | null>(null);
  const [activeTab, setActiveTab] = useState('calculation');
  const [historyUserId, setHistoryUserId] = useState<string>('all');
  const [selectedRecord, setSelectedRecord] = useState<PayrollRecord | null>(null);
  const [kpiDraft, setKpiDraft] = useState<PayrollKpiSettings>(DEFAULT_KPI_SETTINGS);
  const [historyFilters, setHistoryFilters] = useState({
    month: '',
    employee: '',
    role: '',
    status: '',
    minAmount: '',
    maxAmount: '',
  });
  const [selectedEmployeeId, setSelectedEmployeeId] = useState<string | null>(null);

  const profilesQuery = useQuery({
    queryKey: ['payroll', 'profiles'],
    queryFn: payrollService.getPayrollProfiles,
    enabled: isAdmin,
  });
  const periodsQuery = useQuery({
    queryKey: ['payroll', 'periods'],
    queryFn: payrollService.getPayrollPeriods,
    enabled: isAdmin,
  });
  const recordsQuery = useQuery({
    queryKey: ['payroll', 'records', month],
    queryFn: () => payrollService.getPayrollRecords(month),
    enabled: isAdmin && /^\d{4}-(0[1-9]|1[0-2])$/.test(month),
  });
  const allRecordsQuery = useQuery({
    queryKey: ['payroll', 'records', 'all'],
    queryFn: () => payrollService.getPayrollRecords(),
    enabled: isAdmin,
  });
  const recordAdjustmentsQuery = useQuery({
    queryKey: ['payroll', 'record-adjustments', selectedRecord?.id],
    queryFn: () => payrollService.getPayrollRecordAdjustments(selectedRecord?.id || ''),
    enabled: isAdmin && Boolean(selectedRecord?.id),
  });
  const adjustmentsQuery = useQuery({
    queryKey: ['payroll', 'adjustments', 'all'],
    queryFn: () => payrollService.getPayrollAdjustments(),
    enabled: isAdmin,
  });
  const auditEventsQuery = useQuery({
    queryKey: ['payroll', 'audit-events', 'all'],
    queryFn: () => payrollService.getPayrollAuditEvents(),
    enabled: isAdmin,
  });
  const usersQuery = useQuery({
    queryKey: ['users', 'payroll-profile-form'],
    queryFn: usersService.getAll,
    enabled: isAdmin,
  });
  const kpiSettingsQuery = useQuery({
    queryKey: ['payroll', 'kpi-settings'],
    queryFn: payrollService.getPayrollKpiSettings,
    enabled: isAdmin,
  });

  const profiles = profilesQuery.data ?? [];
  const periods = periodsQuery.data ?? [];
  const records = recordsQuery.data ?? [];
  const currentPeriod = periods.find(item => item.month === month) ?? null;
  const users = usersQuery.data ?? [];
  const allHistoryRecords = allRecordsQuery.data ?? [];
  const allAdjustments = adjustmentsQuery.data ?? [];
  const allAuditEvents = auditEventsQuery.data ?? [];
  const historyRecords = allHistoryRecords
    .filter(item => historyUserId === 'all' || item.userId === historyUserId)
    .filter(item => !historyFilters.month || item.month === historyFilters.month)
    .filter(item => !historyFilters.employee || item.userId === historyFilters.employee)
    .filter(item => !historyFilters.role || item.role === historyFilters.role)
    .filter(item => !historyFilters.status || item.status === historyFilters.status)
    .filter(item => historyFilters.minAmount === '' || item.netAmount >= Number(historyFilters.minAmount || 0))
    .filter(item => historyFilters.maxAmount === '' || item.netAmount <= Number(historyFilters.maxAmount || 0))
    .slice()
    .sort((a, b) => `${b.month}${b.employeeName}`.localeCompare(`${a.month}${a.employeeName}`));
  const historyProfiles = profiles.filter(profile => allHistoryRecords.some(record => record.userId === profile.userId) || profile.isActive !== false);
  const historyRoles = Array.from(new Set(allHistoryRecords.map(item => item.role).filter(Boolean))).sort();

  const refreshPayroll = () => {
    void queryClient.invalidateQueries({ queryKey: ['payroll'] });
  };

  const calculateMutation = useMutation({
    mutationFn: payrollService.calculatePayrollPeriod,
    onSuccess: () => {
      toast.success('Расчёт месяца обновлён');
      refreshPayroll();
    },
    onError: (error: Error) => toast.error(error.message || 'Не удалось рассчитать месяц'),
  });

  const createProfileMutation = useMutation({
    mutationFn: payrollService.createPayrollProfile,
    onSuccess: () => {
      toast.success('Зарплатный профиль создан');
      setProfileModalOpen(false);
      refreshPayroll();
    },
    onError: (error: Error) => toast.error(error.message || 'Не удалось создать профиль'),
  });

  const updateProfileMutation = useMutation({
    mutationFn: ({ id, payload }: { id: string; payload: PayrollProfilePayload }) => payrollService.updatePayrollProfile(id, payload),
    onSuccess: () => {
      toast.success('Зарплатный профиль обновлён');
      setProfileModalOpen(false);
      setEditingProfile(null);
      refreshPayroll();
    },
    onError: (error: Error) => toast.error(error.message || 'Не удалось обновить профиль'),
  });

  const approveMutation = useMutation({
    mutationFn: payrollService.approvePayrollPeriod,
    onSuccess: () => {
      toast.success('Расчёт утверждён');
      refreshPayroll();
    },
    onError: (error: Error) => toast.error(error.message || 'Не удалось утвердить расчёт'),
  });

  const paidMutation = useMutation({
    mutationFn: payrollService.markPayrollPeriodPaid,
    onSuccess: () => {
      toast.success('Период отмечен как выплаченный');
      refreshPayroll();
    },
    onError: (error: Error) => toast.error(error.message || 'Не удалось отметить выплату'),
  });

  const updateKpiSettingsMutation = useMutation({
    mutationFn: (payload: PayrollKpiSettingsPayload) => payrollService.updatePayrollKpiSettings(payload),
    onSuccess: (settings) => {
      toast.success('Настройки KPI сохранены');
      setKpiDraft(normalizeKpiSettings(settings));
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'kpi-settings'] });
    },
    onError: (error: Error) => toast.error(error.message || 'Не удалось сохранить настройки KPI'),
  });

  const closeMutation = useMutation({
    mutationFn: payrollService.closePayrollPeriod,
    onSuccess: () => {
      toast.success('Период закрыт');
      refreshPayroll();
    },
    onError: (error: Error) => toast.error(error.message || 'Не удалось закрыть период'),
  });

  const adjustmentMutation = useMutation({
    mutationFn: ({ recordId, payload }: { recordId: string; payload: PayrollAdjustmentPayload }) =>
      payrollService.addPayrollAdjustment(recordId, payload),
    onSuccess: (result) => {
      toast.success('Корректировка добавлена');
      setSelectedRecord(result.record);
      refreshPayroll();
      void queryClient.invalidateQueries({ queryKey: ['payroll', 'record-adjustments', result.record.id] });
    },
    onError: (error: Error) => toast.error(error.message || 'Не удалось добавить корректировку'),
  });

  const openCreateProfile = () => {
    setEditingProfile(null);
    setProfileModalOpen(true);
  };

  const openEditProfile = (profile: PayrollProfile) => {
    setEditingProfile(profile);
    setProfileModalOpen(true);
  };

  const handleProfileSubmit = (payload: PayrollProfilePayload) => {
    if (editingProfile) {
      updateProfileMutation.mutate({ id: editingProfile.id, payload });
      return;
    }
    createProfileMutation.mutate(payload);
  };

  const handleDeactivateProfile = (profile: PayrollProfile) => {
    updateProfileMutation.mutate({
      id: profile.id,
      payload: {
        isActive: false,
        endedAt: profile.endedAt || todayDate(),
      },
    });
  };

  const openProfileHistory = (profile: PayrollProfile) => {
    setHistoryUserId(profile.userId);
    setSelectedEmployeeId(profile.userId);
    setActiveTab('history');
  };

  const handleAddAdjustment = (payload: PayrollAdjustmentPayload) => {
    if (!selectedRecord) return;
    adjustmentMutation.mutate({ recordId: selectedRecord.id, payload });
  };

  const totals = useMemo(() => {
    return records.reduce((acc, item) => {
      acc.baseSalary += item.baseSalary || 0;
      acc.kpiAmount += item.kpiAmount || 0;
      acc.bonusAmount += item.bonusAmount || 0;
      acc.deductionAmount += item.deductionAmount || 0;
      acc.advanceAmount += item.advanceAmount || 0;
      acc.compensationAmount += item.compensationAmount || 0;
      acc.netAmount += item.netAmount || 0;
      return acc;
    }, {
      baseSalary: 0,
      kpiAmount: 0,
      bonusAmount: 0,
      deductionAmount: 0,
      advanceAmount: 0,
      compensationAmount: 0,
      netAmount: 0,
    });
  }, [records]);

  React.useEffect(() => {
    if (!selectedRecord) return;
    const refreshed = records.find(item => item.id === selectedRecord.id);
    if (refreshed && refreshed !== selectedRecord) setSelectedRecord(refreshed);
  }, [records, selectedRecord]);

  React.useEffect(() => {
    if (kpiSettingsQuery.data) setKpiDraft(normalizeKpiSettings(kpiSettingsQuery.data));
  }, [kpiSettingsQuery.data]);

  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <Card className="rounded-2xl border-border">
          <CardContent className="p-8 text-center">
            <p className="text-lg font-bold text-foreground">Нет доступа</p>
            <p className="mt-2 text-sm text-muted-foreground">Раздел зарплаты доступен только администратору.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  const periodId = currentPeriod?.id || '';
  const periodStatus = currentPeriod?.status || 'draft';

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-foreground sm:text-3xl">Зарплата</h1>
          <p className="mt-1 text-sm text-muted-foreground">Расчёт зарплаты, KPI и история начислений сотрудников</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="month"
            value={month}
            onChange={event => setMonth(event.target.value)}
            className="w-40"
            aria-label="Месяц расчёта зарплаты"
          />
          <Button onClick={() => calculateMutation.mutate(month)} disabled={calculateMutation.isPending || periodStatus === 'closed'}>
            <Calculator className="h-4 w-4" />
            Рассчитать месяц
          </Button>
          <Button variant="outline" onClick={() => periodId && approveMutation.mutate(periodId)} disabled={!periodId || approveMutation.isPending || ['approved', 'paid', 'closed'].includes(periodStatus)}>
            <CheckCircle2 className="h-4 w-4" />
            Утвердить расчёт
          </Button>
          <Button variant="outline" onClick={() => periodId && paidMutation.mutate(periodId)} disabled={!periodId || paidMutation.isPending || periodStatus !== 'approved'}>
            <CircleDollarSign className="h-4 w-4" />
            Отметить как выплачено
          </Button>
          <Button variant="outline" onClick={() => periodId && closeMutation.mutate(periodId)} disabled={!periodId || closeMutation.isPending || !['approved', 'paid'].includes(periodStatus)}>
            Закрыть период
          </Button>
          <Button variant="secondary" onClick={openCreateProfile}>
            <Plus className="h-4 w-4" />
            Добавить профиль
          </Button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 2xl:grid-cols-8">
        <MetricCard label="Сотрудников в расчёте" value={String(records.length)} />
        <MetricCard label="Оклады" value={formatMoney(totals.baseSalary)} />
        <MetricCard label="KPI" value={formatMoney(totals.kpiAmount)} />
        <MetricCard label="Бонусы" value={formatMoney(totals.bonusAmount)} tone="positive" />
        <MetricCard label="Удержания" value={formatMoney(totals.deductionAmount)} tone="warning" />
        <MetricCard label="Авансы" value={formatMoney(totals.advanceAmount)} />
        <MetricCard label="Компенсации" value={formatMoney(totals.compensationAmount)} tone="positive" />
        <MetricCard label="К выплате" value={formatMoney(totals.netAmount)} tone="positive" />
      </div>

      <Card className="rounded-2xl border-border">
        <CardContent className="flex flex-wrap items-center gap-3 p-4">
          <WalletCards className="h-5 w-5 text-primary" />
          <span className="text-sm text-muted-foreground">Статус периода</span>
          <Badge className={cn('rounded-full', statusBadgeClass(periodStatus))}>
            {PERIOD_STATUS_LABELS[periodStatus] || periodStatus}
          </Badge>
          {currentPeriod ? (
            <span className="text-sm text-muted-foreground">Обновлено: {formatDateTime(currentPeriod.updatedAt)}</span>
          ) : (
            <span className="text-sm text-muted-foreground">Месяц ещё не рассчитан</span>
          )}
        </CardContent>
      </Card>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="space-y-4">
        <TabsList className="flex h-auto w-full flex-wrap justify-start rounded-2xl p-1">
          <TabsTrigger value="calculation" className="flex-none">Расчёт месяца</TabsTrigger>
          <TabsTrigger value="profiles" className="flex-none">Профили сотрудников</TabsTrigger>
          <TabsTrigger value="history" className="flex-none">История выплат</TabsTrigger>
          <TabsTrigger value="settings" className="flex-none">Настройки KPI</TabsTrigger>
        </TabsList>

        <TabsContent value="calculation">
          <Card className="rounded-2xl border-border">
            <CardHeader>
              <CardTitle>Расчёт месяца</CardTitle>
            </CardHeader>
            <CardContent>
              {recordsQuery.isLoading ? (
                <EmptyState title="Загружаем расчёт" description="Получаем записи зарплаты за выбранный месяц." />
              ) : records.length === 0 ? (
                <EmptyState title="Рассчитайте зарплату за выбранный месяц" description="После расчёта здесь появятся сотрудники, оклады, KPI и итог к выплате." />
              ) : (
                <PayrollRecordsTable
                  records={records}
                  currentPeriod={currentPeriod}
                  onOpenRecord={setSelectedRecord}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="profiles">
          <Card className="rounded-2xl border-border">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>Профили сотрудников</CardTitle>
                <Button size="sm" onClick={openCreateProfile}>
                  <Plus className="h-4 w-4" />
                  Создать профиль
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {profilesQuery.isLoading ? (
                <EmptyState title="Загружаем профили" description="Получаем зарплатные профили сотрудников." />
              ) : profiles.length === 0 ? (
                <EmptyState title="Создайте зарплатные профили сотрудников" description="Активные профили используются при расчёте зарплаты за месяц." />
              ) : (
                <PayrollProfilesTable
                  profiles={profiles}
                  onEdit={openEditProfile}
                  onDeactivate={handleDeactivateProfile}
                  onHistory={openProfileHistory}
                  saving={updateProfileMutation.isPending}
                />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card className="rounded-2xl border-border">
            <CardHeader>
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle>История выплат</CardTitle>
                {historyUserId !== 'all' ? (
                  <Button variant="outline" size="sm" onClick={() => setHistoryUserId('all')}>
                    Показать всех сотрудников
                  </Button>
                ) : null}
              </div>
            </CardHeader>
            <CardContent>
              <PayrollHistoryFilters
                filters={historyFilters}
                profiles={historyProfiles}
                roles={historyRoles}
                onChange={setHistoryFilters}
              />
              {historyRecords.length === 0 ? (
                <EmptyState title="История выплат пока пустая" description="История появится после расчёта и утверждения зарплатных периодов." />
              ) : (
                <PayrollHistoryTable records={historyRecords} onOpenEmployee={setSelectedEmployeeId} />
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card className="rounded-2xl border-border">
            <CardHeader>
              <CardTitle>Настройки KPI</CardTitle>
            </CardHeader>
            <CardContent>
              <PayrollKpiSettingsForm
                settings={kpiDraft}
                loading={kpiSettingsQuery.isLoading}
                saving={updateKpiSettingsMutation.isPending}
                onChange={setKpiDraft}
                onSave={() => updateKpiSettingsMutation.mutate(kpiDraft)}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <ProfileModal
        open={profileModalOpen}
        profile={editingProfile}
        users={users}
        profiles={profiles}
        saving={createProfileMutation.isPending || updateProfileMutation.isPending}
        onClose={() => {
          setProfileModalOpen(false);
          setEditingProfile(null);
        }}
        onSubmit={handleProfileSubmit}
      />
      <PayrollRecordDrawer
        record={selectedRecord}
        adjustments={recordAdjustmentsQuery.data ?? []}
        locked={Boolean(selectedRecord && (selectedRecord.status !== 'draft' || currentPeriod?.status === 'closed'))}
        saving={adjustmentMutation.isPending}
        onClose={() => setSelectedRecord(null)}
        onAddAdjustment={handleAddAdjustment}
      />
      <EmployeeHistoryDrawer
        userId={selectedEmployeeId}
        profiles={profiles}
        records={allHistoryRecords}
        adjustments={allAdjustments}
        auditEvents={allAuditEvents}
        onClose={() => setSelectedEmployeeId(null)}
      />
    </div>
  );
}

function PayrollRecordsTable({
  records,
  currentPeriod,
  onOpenRecord,
}: {
  records: PayrollRecord[];
  currentPeriod: PayrollPeriod | null;
  onOpenRecord: (record: PayrollRecord) => void;
}) {
  const periodLocked = currentPeriod?.status === 'closed';
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Сотрудник</TableHead>
          <TableHead>Роль</TableHead>
          <TableHead>Оклад</TableHead>
          <TableHead>KPI-схема</TableHead>
          <TableHead>База KPI</TableHead>
          <TableHead>KPI</TableHead>
          <TableHead>Бонусы</TableHead>
          <TableHead>Удержания</TableHead>
          <TableHead>Аванс</TableHead>
          <TableHead>Компенсации</TableHead>
          <TableHead>Итого к выплате</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead>Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map(record => (
          <TableRow key={record.id} className="cursor-pointer" onClick={() => onOpenRecord(record)}>
            <TableCell className="font-medium">{record.employeeName}</TableCell>
            <TableCell>{record.role}</TableCell>
            <TableCell>{formatMoney(record.baseSalary)}</TableCell>
            <TableCell>{KPI_SCHEME_LABELS[record.kpiSchemeType] || record.kpiSchemeType}</TableCell>
            <TableCell>{formatMoney(record.kpiBaseAmount)}</TableCell>
            <TableCell>{formatMoney(record.kpiAmount)}</TableCell>
            <TableCell>{formatMoney(record.bonusAmount)}</TableCell>
            <TableCell>{formatMoney(record.deductionAmount)}</TableCell>
            <TableCell>{formatMoney(record.advanceAmount)}</TableCell>
            <TableCell>{formatMoney(record.compensationAmount)}</TableCell>
            <TableCell className="font-semibold text-emerald-600 dark:text-emerald-300">{formatMoney(record.netAmount)}</TableCell>
            <TableCell>
              <Badge className={cn('rounded-full', statusBadgeClass(record.status))}>
                {RECORD_STATUS_LABELS[record.status] || record.status}
              </Badge>
            </TableCell>
            <TableCell>
              <Button
                variant="ghost"
                size="sm"
                onClick={event => {
                  event.stopPropagation();
                  onOpenRecord(record);
                }}
              >
                {record.status === 'draft' && !periodLocked ? 'Корректировка' : 'Детали'}
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PayrollProfilesTable({
  profiles,
  onEdit,
  onDeactivate,
  onHistory,
  saving,
}: {
  profiles: PayrollProfile[];
  onEdit: (profile: PayrollProfile) => void;
  onDeactivate: (profile: PayrollProfile) => void;
  onHistory: (profile: PayrollProfile) => void;
  saving: boolean;
}) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Сотрудник</TableHead>
          <TableHead>Роль</TableHead>
          <TableHead>Оклад</TableHead>
          <TableHead>Тип KPI</TableHead>
          <TableHead>Значение KPI</TableHead>
          <TableHead>Активен</TableHead>
          <TableHead>Дата начала</TableHead>
          <TableHead>Обновлено</TableHead>
          <TableHead>Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {profiles.map(profile => (
          <TableRow key={profile.id}>
            <TableCell className="font-medium">{profile.employeeName}</TableCell>
            <TableCell>{profile.role}</TableCell>
            <TableCell>{formatMoney(profile.baseSalary)}</TableCell>
            <TableCell>{KPI_SCHEME_LABELS[profile.kpiSchemeType] || profile.kpiSchemeType}</TableCell>
            <TableCell>
              {profile.kpiPercent ? `${profile.kpiPercent}%` : ''}
              {profile.kpiPercent && profile.kpiFixedAmount ? ' + ' : ''}
              {profile.kpiFixedAmount ? formatMoney(profile.kpiFixedAmount) : ''}
              {!profile.kpiPercent && !profile.kpiFixedAmount ? '—' : ''}
            </TableCell>
            <TableCell>
              <Badge className={cn('rounded-full', profile.isActive ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300' : 'bg-muted text-muted-foreground')}>
                {profile.isActive ? 'Да' : 'Нет'}
              </Badge>
            </TableCell>
            <TableCell>{formatDateTime(profile.startedAt)}</TableCell>
            <TableCell>{formatDateTime(profile.updatedAt)}</TableCell>
            <TableCell>
              <div className="flex flex-wrap gap-1">
                <Button variant="ghost" size="sm" onClick={() => onEdit(profile)}>
                  <Pencil className="h-4 w-4" />
                  Редактировать
                </Button>
                <Button variant="ghost" size="sm" onClick={() => onHistory(profile)}>
                  <History className="h-4 w-4" />
                  История начислений
                </Button>
                {profile.isActive ? (
                  <Button variant="ghost" size="sm" onClick={() => onDeactivate(profile)} disabled={saving}>
                    <Power className="h-4 w-4" />
                    Деактивировать
                  </Button>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function PayrollHistoryFilters({
  filters,
  profiles,
  roles,
  onChange,
}: {
  filters: { month: string; employee: string; role: string; status: string; minAmount: string; maxAmount: string };
  profiles: PayrollProfile[];
  roles: string[];
  onChange: (filters: { month: string; employee: string; role: string; status: string; minAmount: string; maxAmount: string }) => void;
}) {
  const update = (field: keyof typeof filters, value: string) => onChange({ ...filters, [field]: value });
  return (
    <div className="mb-4 grid gap-3 rounded-2xl border border-border bg-muted/20 p-4 md:grid-cols-3 xl:grid-cols-6">
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Месяц</span>
        <Input type="month" value={filters.month} onChange={event => update('month', event.target.value)} />
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Сотрудник</span>
        <select value={filters.employee} onChange={event => update('employee', event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
          <option value="">Все</option>
          {profiles.map(profile => <option key={profile.id} value={profile.userId}>{profile.employeeName}</option>)}
        </select>
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Роль</span>
        <select value={filters.role} onChange={event => update('role', event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
          <option value="">Все</option>
          {roles.map(role => <option key={role} value={role}>{role}</option>)}
        </select>
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Статус</span>
        <select value={filters.status} onChange={event => update('status', event.target.value)} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground">
          <option value="">Все</option>
          <option value="draft">Черновик</option>
          <option value="approved">Утверждён</option>
          <option value="paid">Выплачен</option>
        </select>
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Сумма от</span>
        <Input type="number" min="0" value={filters.minAmount} onChange={event => update('minAmount', event.target.value)} />
      </label>
      <label className="space-y-1.5">
        <span className="text-xs font-medium text-muted-foreground">Сумма до</span>
        <Input type="number" min="0" value={filters.maxAmount} onChange={event => update('maxAmount', event.target.value)} />
      </label>
    </div>
  );
}

function PayrollHistoryTable({ records, onOpenEmployee }: { records: PayrollRecord[]; onOpenEmployee: (userId: string) => void }) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Месяц</TableHead>
          <TableHead>Сотрудник</TableHead>
          <TableHead>Роль</TableHead>
          <TableHead>Оклад</TableHead>
          <TableHead>KPI</TableHead>
          <TableHead>Бонусы</TableHead>
          <TableHead>Удержания</TableHead>
          <TableHead>Аванс</TableHead>
          <TableHead>Итого</TableHead>
          <TableHead>Статус</TableHead>
          <TableHead>Дата утверждения</TableHead>
          <TableHead>Дата выплаты</TableHead>
          <TableHead>Действия</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {records.map(record => (
          <TableRow key={record.id}>
            <TableCell>{record.month}</TableCell>
            <TableCell className="font-medium">{record.employeeName}</TableCell>
            <TableCell>{record.role}</TableCell>
            <TableCell>{formatMoney(record.baseSalary)}</TableCell>
            <TableCell>{formatMoney(record.kpiAmount)}</TableCell>
            <TableCell>{formatMoney(record.bonusAmount)}</TableCell>
            <TableCell>{formatMoney(record.deductionAmount)}</TableCell>
            <TableCell>{formatMoney(record.advanceAmount)}</TableCell>
            <TableCell className="font-semibold">{formatMoney(record.netAmount)}</TableCell>
            <TableCell>
              <Badge className={cn('rounded-full', statusBadgeClass(record.status))}>
                {RECORD_STATUS_LABELS[record.status] || record.status}
              </Badge>
            </TableCell>
            <TableCell>{formatDateTime(record.approvedAt)}</TableCell>
            <TableCell>{formatDateTime(record.paidAt)}</TableCell>
            <TableCell>
              <Button variant="ghost" size="sm" onClick={() => onOpenEmployee(record.userId)}>
                Открыть историю сотрудника
              </Button>
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}

function EmployeeHistoryDrawer({
  userId,
  profiles,
  records,
  adjustments,
  auditEvents,
  onClose,
}: {
  userId: string | null;
  profiles: PayrollProfile[];
  records: PayrollRecord[];
  adjustments: PayrollAdjustment[];
  auditEvents: PayrollAuditEvent[];
  onClose: () => void;
}) {
  if (!userId) return null;
  const employeeRecords = records.filter(record => record.userId === userId).slice().sort((a, b) => b.month.localeCompare(a.month));
  const profile = profiles.find(item => item.userId === userId && item.isActive !== false) || profiles.find(item => item.userId === userId) || null;
  const employeeName = profile?.employeeName || employeeRecords[0]?.employeeName || 'Сотрудник';
  const employeeAdjustments = adjustments.filter(item => item.userId === userId || employeeRecords.some(record => record.id === item.payrollRecordId));
  const recordIds = new Set(employeeRecords.map(record => record.id));
  const profileIds = new Set(profiles.filter(item => item.userId === userId).map(item => item.id));
  const employeeAudit = auditEvents.filter(event => (
    (event.entityType === 'payroll_record' && recordIds.has(event.entityId)) ||
    (event.entityType === 'payroll_profile' && profileIds.has(event.entityId))
  ));

  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-black/45">
      <div className="flex h-full w-full max-w-4xl flex-col overflow-hidden bg-card shadow-2xl">
        <div className="flex items-start justify-between gap-4 border-b border-border px-6 py-4">
          <div>
            <h2 className="text-lg font-bold text-foreground">История сотрудника</h2>
            <p className="mt-1 text-sm text-muted-foreground">{employeeName}</p>
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Закрыть историю сотрудника">
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="flex-1 space-y-5 overflow-y-auto p-6">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <MetricCard label="Текущий оклад" value={formatMoney(profile?.baseSalary)} />
            <MetricCard label="KPI-схема" value={profile ? (KPI_SCHEME_LABELS[profile.kpiSchemeType] || profile.kpiSchemeType) : '—'} />
            <MetricCard label="Начислений" value={String(employeeRecords.length)} />
            <MetricCard label="Всего выплачено" value={formatMoney(employeeRecords.filter(item => item.status === 'paid').reduce((sum, item) => sum + item.netAmount, 0))} tone="positive" />
          </div>

          <Card className="rounded-2xl border-border">
            <CardHeader><CardTitle className="text-base">Начисления по месяцам</CardTitle></CardHeader>
            <CardContent>
              <PayrollHistoryTable records={employeeRecords} onOpenEmployee={() => undefined} />
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border">
            <CardHeader><CardTitle className="text-base">Корректировки</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {employeeAdjustments.length === 0 ? <p className="text-sm text-muted-foreground">Корректировок пока нет.</p> : employeeAdjustments.map(item => (
                <div key={item.id} className="rounded-xl border border-border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold">{ADJUSTMENT_LABELS[item.type] || item.type}: {formatMoney(item.amount)}</span>
                    <span className="text-muted-foreground">{item.month} · {formatDateTime(item.createdAt)}</span>
                  </div>
                  <p className="mt-1 text-muted-foreground">{item.reason}</p>
                  <p className="mt-1 text-xs text-muted-foreground">Изменил: {item.createdByName || 'Администратор'}</p>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-2xl border-border">
            <CardHeader><CardTitle className="text-base">Audit trail</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {employeeAudit.length === 0 ? <p className="text-sm text-muted-foreground">Audit-событий пока нет.</p> : employeeAudit.map(event => {
                const summary = auditChangeSummary(event);
                return (
                  <div key={event.id} className="rounded-xl border border-border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <span className="font-semibold">{event.action}</span>
                      <span className="text-muted-foreground">{formatDateTime(event.createdAt)}</span>
                    </div>
                    <p className="mt-1 text-muted-foreground">Кто: {event.userName || 'Администратор'}</p>
                    <p className="mt-1 text-muted-foreground">Старое значение: {summary.oldValue}</p>
                    <p className="mt-1 text-muted-foreground">Новое значение: {summary.newValue}</p>
                    {event.reason ? <p className="mt-1 text-muted-foreground">Причина: {event.reason}</p> : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function PayrollKpiSettingsForm({
  settings,
  loading,
  saving,
  onChange,
  onSave,
}: {
  settings: PayrollKpiSettings;
  loading: boolean;
  saving: boolean;
  onChange: (settings: PayrollKpiSettings) => void;
  onSave: () => void;
}) {
  const updateSection = <K extends keyof PayrollKpiSettings>(
    section: K,
    field: keyof PayrollKpiSettings[K],
    value: string | number | boolean,
  ) => {
    onChange({
      ...settings,
      [section]: {
        ...(settings[section] as object),
        [field]: typeof value === 'string' && value !== '' && field !== 'comment' ? Number(value) : value,
      },
    });
  };

  const numberValue = (value: number | undefined) => String(value ?? 0);

  if (loading) {
    return <EmptyState title="Загружаем настройки KPI" description="Получаем глобальные правила расчёта KPI." />;
  }

  return (
    <div className="space-y-5">
      <div className="rounded-2xl border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-800 dark:border-blue-500/30 dark:bg-blue-500/10 dark:text-blue-200">
        Автоматический расчёт используется только там, где есть надёжная база. Если база не определена, запись получает подсказку “База KPI требует ручного ввода”, а администратор может внести KPI вручную в расчёте сотрудника.
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle className="text-base">Менеджер аренды</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Процент от прибыли без НДС</span>
              <Input type="number" min="0" max="100" value={numberValue(settings.rentalManager.percentFromProfitWithoutVat)} onChange={event => updateSection('rentalManager', 'percentFromProfitWithoutVat', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Минимальный план</span>
              <Input type="number" min="0" value={numberValue(settings.rentalManager.minimumPlan)} onChange={event => updateSection('rentalManager', 'minimumPlan', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Ручная база KPI</span>
              <Input type="number" min="0" value={numberValue(settings.rentalManager.manualBaseAmount)} onChange={event => updateSection('rentalManager', 'manualBaseAmount', event.target.value)} />
            </label>
            <div className="space-y-2 pt-5 text-sm">
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.rentalManager.paidOnly} onChange={event => updateSection('rentalManager', 'paidOnly', event.target.checked)} />Учитывать только оплаченные сделки</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={settings.rentalManager.closedRentalsOnly} onChange={event => updateSection('rentalManager', 'closedRentalsOnly', event.target.checked)} />Учитывать только закрытые аренды</label>
            </div>
            <label className="space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Комментарий</span>
              <Input value={settings.rentalManager.comment} onChange={event => updateSection('rentalManager', 'comment', event.target.value)} />
            </label>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle className="text-base">Менеджер продаж</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Процент от маржи</span>
              <Input type="number" min="0" max="100" value={numberValue(settings.salesManager.percentFromMargin)} onChange={event => updateSection('salesManager', 'percentFromMargin', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Бонус за проданную технику</span>
              <Input type="number" min="0" value={numberValue(settings.salesManager.fixedBonusPerSoldEquipment)} onChange={event => updateSection('salesManager', 'fixedBonusPerSoldEquipment', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Ручная маржа</span>
              <Input type="number" min="0" value={numberValue(settings.salesManager.manualMarginAmount)} onChange={event => updateSection('salesManager', 'manualMarginAmount', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Продано единиц</span>
              <Input type="number" min="0" value={numberValue(settings.salesManager.soldEquipmentCount)} onChange={event => updateSection('salesManager', 'soldEquipmentCount', event.target.value)} />
            </label>
            <label className="flex items-center gap-2 pt-5 text-sm"><input type="checkbox" checked={settings.salesManager.paidSalesOnly} onChange={event => updateSection('salesManager', 'paidSalesOnly', event.target.checked)} />Учитывать только оплаченные продажи</label>
            <label className="space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Комментарий</span>
              <Input value={settings.salesManager.comment} onChange={event => updateSection('salesManager', 'comment', event.target.value)} />
            </label>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle className="text-base">Механик сервиса</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Бонус за закрытую заявку</span>
              <Input type="number" min="0" value={numberValue(settings.serviceMechanic.bonusPerClosedTicket)} onChange={event => updateSection('serviceMechanic', 'bonusPerClosedTicket', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Бонус за выезд</span>
              <Input type="number" min="0" value={numberValue(settings.serviceMechanic.bonusPerFieldTrip)} onChange={event => updateSection('serviceMechanic', 'bonusPerFieldTrip', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Ручной бонус</span>
              <Input type="number" min="0" value={numberValue(settings.serviceMechanic.manualBonus)} onChange={event => updateSection('serviceMechanic', 'manualBonus', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Ручные закрытые заявки</span>
              <Input type="number" min="0" value={numberValue(settings.serviceMechanic.manualClosedTickets)} onChange={event => updateSection('serviceMechanic', 'manualClosedTickets', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Ручные выезды</span>
              <Input type="number" min="0" value={numberValue(settings.serviceMechanic.manualFieldTrips)} onChange={event => updateSection('serviceMechanic', 'manualFieldTrips', event.target.value)} />
            </label>
            <label className="space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Комментарий</span>
              <Input value={settings.serviceMechanic.comment} onChange={event => updateSection('serviceMechanic', 'comment', event.target.value)} />
            </label>
          </CardContent>
        </Card>

        <Card className="rounded-2xl border-border">
          <CardHeader>
            <CardTitle className="text-base">Офис-менеджер</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Фиксированный KPI</span>
              <Input type="number" min="0" value={numberValue(settings.officeManager.fixedBonus)} onChange={event => updateSection('officeManager', 'fixedBonus', event.target.value)} />
            </label>
            <label className="space-y-1.5">
              <span className="text-xs font-medium text-muted-foreground">Ручной бонус</span>
              <Input type="number" min="0" value={numberValue(settings.officeManager.manualBonus)} onChange={event => updateSection('officeManager', 'manualBonus', event.target.value)} />
            </label>
            <label className="space-y-1.5 sm:col-span-2">
              <span className="text-xs font-medium text-muted-foreground">Комментарий</span>
              <Input value={settings.officeManager.comment} onChange={event => updateSection('officeManager', 'comment', event.target.value)} />
            </label>
          </CardContent>
        </Card>
      </div>

      <Card className="rounded-2xl border-border">
        <CardHeader>
          <CardTitle className="text-base">Индивидуальные схемы</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Индивидуальная схема пока работает как ручная база, процент и фиксированный бонус. Детальный конструктор правил можно добавить отдельно, когда будут понятны источники данных.</p>
          <div className="mt-3 rounded-xl border border-dashed border-border p-4 text-sm text-muted-foreground">
            Активных индивидуальных схем: {settings.customSchemes.filter(item => item.isActive !== false).length}
          </div>
        </CardContent>
      </Card>

      <div className="flex justify-end">
        <Button onClick={onSave} disabled={saving}>{saving ? 'Сохраняем...' : 'Сохранить настройки KPI'}</Button>
      </div>
    </div>
  );
}
