import React from 'react';
import { cn } from '../../lib/utils';
import type { EquipmentStatus, RentalStatus, ServiceStatus, ServicePriority, PaymentStatus, DocumentStatus } from '../../types';

type BadgeVariant = 'success' | 'warning' | 'error' | 'danger' | 'info' | 'default';

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium', {
      'bg-green-100 text-green-800 dark:bg-green-900/20 dark:text-green-400': variant === 'success',
      'bg-yellow-100 text-yellow-800 dark:bg-yellow-900/20 dark:text-yellow-400': variant === 'warning',
      'bg-red-100 text-red-800 dark:bg-red-900/20 dark:text-red-400': variant === 'error' || variant === 'danger',
      'bg-blue-100 text-blue-800 dark:bg-blue-900/20 dark:text-blue-400': variant === 'info',
      'bg-gray-100 text-gray-800 dark:bg-gray-700 dark:text-gray-300': variant === 'default',
    }, className)}>
      {children}
    </span>
  );
}

export function getEquipmentStatusBadge(status: EquipmentStatus) {
  const map: Record<EquipmentStatus, { label: string; variant: BadgeVariant }> = {
    available: { label: 'Свободен', variant: 'success' },
    rented: { label: 'В аренде', variant: 'info' },
    reserved: { label: 'Бронь', variant: 'warning' },
    in_service: { label: 'В сервисе', variant: 'error' },
    inactive: { label: 'Списан', variant: 'default' },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function getRentalStatusBadge(status: RentalStatus) {
  const map: Record<RentalStatus, { label: string; variant: BadgeVariant }> = {
    new: { label: 'Новый', variant: 'default' },
    confirmed: { label: 'Подтверждён', variant: 'info' },
    delivery: { label: 'Доставка', variant: 'warning' },
    active: { label: 'Активен', variant: 'success' },
    return_planned: { label: 'Возврат запланирован', variant: 'warning' },
    closed: { label: 'Закрыт', variant: 'default' },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function getServiceStatusBadge(status: ServiceStatus) {
  const map: Record<ServiceStatus, { label: string; variant: BadgeVariant }> = {
    new: { label: 'Новый', variant: 'default' },
    in_progress: { label: 'В работе', variant: 'info' },
    waiting_parts: { label: 'Ожидание запчастей', variant: 'warning' },
    ready: { label: 'Готово', variant: 'success' },
    closed: { label: 'Закрыто', variant: 'default' },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function getServicePriorityBadge(priority: ServicePriority) {
  const map: Record<ServicePriority, { label: string; variant: BadgeVariant }> = {
    low: { label: 'Низкий', variant: 'default' },
    medium: { label: 'Средний', variant: 'info' },
    high: { label: 'Высокий', variant: 'warning' },
    critical: { label: 'Критический', variant: 'error' },
  };
  const { label, variant } = map[priority];
  return <Badge variant={variant}>{label}</Badge>;
}

export function getPaymentStatusBadge(status: PaymentStatus) {
  const map: Record<PaymentStatus, { label: string; variant: BadgeVariant }> = {
    pending: { label: 'Не оплачено', variant: 'warning' },
    paid: { label: 'Оплачено', variant: 'success' },
    overdue: { label: 'Просрочено', variant: 'error' },
    partial: { label: 'Частично', variant: 'info' },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}

export function getDocumentStatusBadge(status: DocumentStatus) {
  const map: Record<DocumentStatus, { label: string; variant: BadgeVariant }> = {
    draft: { label: 'Черновик', variant: 'default' },
    signed: { label: 'Подписан', variant: 'success' },
    sent: { label: 'Отправлен', variant: 'info' },
  };
  const { label, variant } = map[status];
  return <Badge variant={variant}>{label}</Badge>;
}
