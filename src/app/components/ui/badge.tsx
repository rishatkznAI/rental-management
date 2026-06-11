import React from 'react';
import { cn } from '../../lib/utils';
import type { EquipmentPriority, EquipmentStatus, RentalStatus, ServiceStatus, ServicePriority, PaymentStatus, DocumentStatus } from '../../types';

type BadgeVariant = 'success' | 'warning' | 'error' | 'danger' | 'info' | 'default' | 'outline';
type BadgeMeta = { label: string; variant: BadgeVariant };

export interface BadgeProps {
  children: React.ReactNode;
  variant?: BadgeVariant;
  className?: string;
}

export function Badge({ children, variant = 'default', className }: BadgeProps) {
  return (
    <span className={cn('app-status-pill', {
      'app-status-success': variant === 'success',
      'app-status-warning': variant === 'warning',
      'app-status-danger': variant === 'error' || variant === 'danger',
      'app-status-info': variant === 'info',
      'app-status-default': variant === 'default' || variant === 'outline',
    }, className)}>
      {children}
    </span>
  );
}

function readableFallback(value: unknown, emptyLabel = 'Неизвестно'): string {
  const text = String(value ?? '').trim();
  if (!text || text === 'undefined' || text === 'null') return emptyLabel;
  return text.replaceAll('_', ' ');
}

function getBadgeMeta<T extends string>(
  map: Partial<Record<T, BadgeMeta>>,
  value: unknown,
  emptyLabel = 'Неизвестно',
): BadgeMeta {
  const key = String(value ?? '').trim() as T;
  return map[key] || { label: readableFallback(value, emptyLabel), variant: 'default' };
}

export function getEquipmentStatusBadge(status: EquipmentStatus | string | null | undefined) {
  const map: Record<EquipmentStatus, BadgeMeta> = {
    available: { label: 'Свободен', variant: 'success' },
    rented: { label: 'В аренде', variant: 'info' },
    reserved: { label: 'Бронь', variant: 'warning' },
    in_service: { label: 'В сервисе', variant: 'error' },
    inactive: { label: 'Списан', variant: 'default' },
  };
  const { label, variant } = getBadgeMeta(map, status);
  return <Badge variant={variant}>{label}</Badge>;
}

export function getEquipmentPriorityBadge(priority: EquipmentPriority | string | null | undefined) {
  const map: Record<EquipmentPriority, BadgeMeta> = {
    low: { label: 'Низкий', variant: 'default' },
    medium: { label: 'Средний', variant: 'info' },
    high: { label: 'Высокий', variant: 'warning' },
    critical: { label: 'Критический', variant: 'error' },
  };
  const { label, variant } = getBadgeMeta(map, priority);
  return <Badge variant={variant}>{label}</Badge>;
}

export function getRentalStatusBadge(status: RentalStatus | string | null | undefined) {
  const map: Record<RentalStatus, BadgeMeta> = {
    new: { label: 'Новый', variant: 'default' },
    confirmed: { label: 'Подтверждён', variant: 'info' },
    delivery: { label: 'Доставка', variant: 'warning' },
    active: { label: 'Активен', variant: 'success' },
    return_planned: { label: 'Возврат запланирован', variant: 'warning' },
    closed: { label: 'Закрыт', variant: 'default' },
  };
  const { label, variant } = getBadgeMeta(map, status);
  return <Badge variant={variant}>{label}</Badge>;
}

export function getServiceStatusBadge(status: ServiceStatus | string | null | undefined) {
  const map: Record<ServiceStatus, BadgeMeta> = {
    new: { label: 'Новый', variant: 'default' },
    in_progress: { label: 'В работе', variant: 'info' },
    waiting_parts: { label: 'Ожидание запчастей', variant: 'warning' },
    needs_revision: { label: 'На доработке', variant: 'warning' },
    ready: { label: 'Готово', variant: 'success' },
    closed: { label: 'Закрыто', variant: 'default' },
  };
  const { label, variant } = getBadgeMeta(map, status);
  return <Badge variant={variant}>{label}</Badge>;
}

export function getServicePriorityBadge(priority: ServicePriority | string | null | undefined) {
  const map: Record<ServicePriority, BadgeMeta> = {
    low: { label: 'Низкий', variant: 'default' },
    medium: { label: 'Средний', variant: 'info' },
    high: { label: 'Высокий', variant: 'warning' },
    critical: { label: 'Критический', variant: 'error' },
  };
  const { label, variant } = getBadgeMeta(map, priority);
  return <Badge variant={variant}>{label}</Badge>;
}

export function getPaymentStatusBadge(status: PaymentStatus | string | null | undefined) {
  const map: Record<PaymentStatus, BadgeMeta> = {
    pending: { label: 'Не оплачено', variant: 'warning' },
    paid: { label: 'Оплачено', variant: 'success' },
    overdue: { label: 'Просрочено', variant: 'error' },
    partial: { label: 'Частично', variant: 'info' },
  };
  const { label, variant } = getBadgeMeta(map, status);
  return <Badge variant={variant}>{label}</Badge>;
}

export function getDocumentStatusBadge(status: DocumentStatus | string | null | undefined) {
  const map: Record<DocumentStatus, BadgeMeta> = {
    draft: { label: 'Черновик', variant: 'default' },
    signed: { label: 'Подписан', variant: 'success' },
    sent: { label: 'Отправлен', variant: 'info' },
    pending_signature: { label: 'На подписи', variant: 'warning' },
    expired: { label: 'Просрочен', variant: 'error' },
    cancelled: { label: 'Отменён', variant: 'default' },
  };
  const { label, variant } = getBadgeMeta(map, status);
  return <Badge variant={variant}>{label}</Badge>;
}
