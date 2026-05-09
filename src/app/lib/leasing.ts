import type { LeasingContract, LeasingSummary } from '../types';

export const LEASING_STATUS_LABELS: Record<LeasingContract['status'], string> = {
  active: 'Активен',
  closed: 'Закрыт',
  paused: 'Пауза',
  overdue: 'Просрочка',
  archived: 'Архив',
};

export function emptyLeasingSummary(contracts: LeasingContract[] = []): LeasingSummary {
  return {
    contracts,
    activeContracts: 0,
    pausedContracts: 0,
    currentMonthAmount: 0,
    nextMonthAmount: 0,
    overdueAmount: 0,
    overdueContracts: 0,
    remainingAmount: 0,
    averageMonthlyLoad: 0,
  };
}

export function getLeasingPaymentUrgency(contract: LeasingContract, today = new Date().toISOString().slice(0, 10)) {
  const dueDate = contract.nextPayment?.dueDate || contract.nextPaymentDate;
  if (!dueDate) return { tone: 'default' as const, label: 'Нет платежа' };
  const diffDays = Math.floor((new Date(`${dueDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000);
  if (diffDays < 0) return { tone: 'danger' as const, label: `Просрочено на ${Math.abs(diffDays)} дн.` };
  if (diffDays === 0) return { tone: 'warning' as const, label: 'Сегодня' };
  if (diffDays <= 7) return { tone: 'warning' as const, label: `Через ${diffDays} дн.` };
  return { tone: 'default' as const, label: `Через ${diffDays} дн.` };
}
