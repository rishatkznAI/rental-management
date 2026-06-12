import React from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, Bell, CalendarClock, CreditCard, FileCheck, Wrench } from 'lucide-react';
import { rentalsService } from '../../services/rentals.service';
import { serviceTicketsService } from '../../services/service-tickets.service';
import { equipmentService } from '../../services/equipment.service';
import { paymentsService } from '../../services/payments.service';
import { rentalChangeRequestsService } from '../../services/rental-change-requests.service';
import { buildAppNotifications, type AppNotification, type NotificationPriority } from '../../lib/notifications';
import { cn, formatDate } from '../../lib/utils';
import { usePermissions } from '../../lib/permissions';
import { useAuth } from '../../contexts/AuthContext';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';

const READ_KEY = 'app_notification_reads_v1';
const READ_SYNC_EVENT = 'app-notification-reads-updated';

const priorityStyles: Record<NotificationPriority, string> = {
  critical: 'border-danger/35 bg-danger/10 shadow-[0_18px_44px_-36px_color-mix(in_srgb,var(--danger)_58%,transparent)]',
  high: 'border-warning/35 bg-warning/10 shadow-[0_18px_44px_-36px_color-mix(in_srgb,var(--warning)_58%,transparent)]',
  medium: 'border-primary/30 bg-primary/8 shadow-[0_18px_44px_-36px_color-mix(in_srgb,var(--primary)_46%,transparent)]',
};

const priorityDotStyles: Record<NotificationPriority, string> = {
  critical: 'bg-danger text-danger',
  high: 'bg-warning text-warning',
  medium: 'bg-primary text-primary',
};

const priorityChipStyles: Record<NotificationPriority, string> = {
  critical: 'border-danger/25 bg-danger/10 text-danger-foreground',
  high: 'border-warning/25 bg-warning/10 text-warning-foreground',
  medium: 'border-primary/20 bg-primary/10 text-primary',
};

function readIdsFromStorage(): string[] {
  try {
    const raw = localStorage.getItem(READ_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeIdsToStorage(ids: string[]) {
  const merged = Array.from(new Set([...readIdsFromStorage(), ...ids]));
  localStorage.setItem(READ_KEY, JSON.stringify(merged));
  window.dispatchEvent(new CustomEvent(READ_SYNC_EVENT, { detail: merged }));
}

function getIcon(notification: AppNotification) {
  switch (notification.section) {
    case 'service':
      return Wrench;
    case 'payments':
      return CreditCard;
    case 'rentals':
      return CalendarClock;
    case 'approvals':
      return FileCheck;
    default:
      return AlertTriangle;
  }
}

export function NotificationCenter() {
  const { canView, canReadCollection } = usePermissions();
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [readIds, setReadIds] = React.useState<string[]>(() => readIdsFromStorage());
  const canViewRentals = canView('rentals');
  const canViewService = canView('service');
  const canViewEquipment = canView('equipment');
  const canViewPayments = canView('payments') || canView('finance');
  const canViewApprovals = canView('approvals');
  const canViewShippingPhotos = canReadCollection('shipping_photos');

  const results = useQueries({
    queries: [
      { queryKey: ['notif-gantt-rentals'], queryFn: rentalsService.getGanttData, enabled: open && canViewRentals && canReadCollection('gantt_rentals') },
      { queryKey: ['notif-service'], queryFn: serviceTicketsService.getAll, enabled: open && canViewService && canReadCollection('service') },
      { queryKey: ['notif-equipment'], queryFn: equipmentService.getAll, enabled: open && canViewEquipment && canReadCollection('equipment') },
      { queryKey: ['notif-payments'], queryFn: paymentsService.getAll, enabled: open && canViewPayments && canReadCollection('payments') },
      { queryKey: ['notif-shipping-photos'], queryFn: equipmentService.getAllShippingPhotos, enabled: open && canViewShippingPhotos },
      { queryKey: ['notif-rental-change-requests'], queryFn: rentalChangeRequestsService.getAll, enabled: canViewApprovals && canReadCollection('rental_change_requests') },
    ],
  });

  const [rentalsResult, serviceResult, equipmentResult, paymentsResult, shippingPhotosResult, changeRequestsResult] = results;

  const notifications = React.useMemo(() => {
    const items = buildAppNotifications({
      rentals: rentalsResult.data ?? [],
      serviceTickets: serviceResult.data ?? [],
      equipment: equipmentResult.data ?? [],
      payments: paymentsResult.data ?? [],
      shippingPhotos: shippingPhotosResult.data ?? [],
      changeRequests: changeRequestsResult.data ?? [],
      currentUser: user ? { id: user.id, role: user.role, name: user.name } : null,
    });

    return items.filter(item => {
      if (item.section === 'rentals') return canView('rentals');
      if (item.section === 'service') return canView('service');
      if (item.section === 'payments') return canView('payments');
      if (item.section === 'equipment') return canView('equipment');
      if (item.section === 'approvals') return canView('approvals');
      return true;
    });
  }, [
    canView,
    changeRequestsResult.data,
    rentalsResult.data,
    serviceResult.data,
    equipmentResult.data,
    paymentsResult.data,
    shippingPhotosResult.data,
    user,
  ]);

  React.useEffect(() => {
    writeIdsToStorage(readIds);
  }, [readIds]);

  React.useEffect(() => {
    const syncFromStorage = () => {
      const next = readIdsFromStorage();
      setReadIds(prev => {
        if (prev.length === next.length && prev.every((id, index) => id === next[index])) {
          return prev;
        }
        return next;
      });
    };

    const handleStorage = (event: StorageEvent) => {
      if (event.key && event.key !== READ_KEY) return;
      syncFromStorage();
    };

    const handleCustomSync = () => {
      syncFromStorage();
    };

    window.addEventListener('storage', handleStorage);
    window.addEventListener(READ_SYNC_EVENT, handleCustomSync);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(READ_SYNC_EVENT, handleCustomSync);
    };
  }, []);

  const unreadNotifications = React.useMemo(
    () => notifications.filter(item => !readIds.includes(item.id)),
    [notifications, readIds],
  );

  const unreadCount = unreadNotifications.length;
  const criticalCount = notifications.filter(item => item.priority === 'critical').length;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="relative rounded-xl border border-transparent p-2 text-muted-foreground transition-colors hover:border-primary/30 hover:bg-accent hover:text-primary"
          aria-label="Уведомления"
          title="Уведомления"
        >
          <Bell className="h-5 w-5" />
          {unreadCount > 0 && (
            <span
              className={cn(
                'absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white',
                criticalCount > 0 ? 'bg-[color:var(--danger)]' : 'bg-primary text-primary-foreground',
              )}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="flex w-full flex-col bg-card sm:max-w-lg">
        <SheetHeader className="border-b border-border bg-card/95 shadow-[0_16px_34px_-30px_rgba(0,0,0,0.72)] backdrop-blur">
          <SheetTitle>Уведомления</SheetTitle>
          <SheetDescription>
            Возвраты, сервис, ТО и платежи, требующие внимания
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-3 pb-4 sm:px-4">
          <div className="sticky top-0 z-10 -mx-3 flex flex-col gap-2 border-b border-border bg-card/95 px-3 py-3 backdrop-blur sm:-mx-4 sm:flex-row sm:items-center sm:justify-between sm:px-4">
            <div className="text-sm font-medium text-muted-foreground">
              Непрочитанных: {unreadNotifications.length} {notifications.length !== unreadNotifications.length ? `· Всего: ${notifications.length}` : ''}
            </div>
            {unreadNotifications.length > 0 && (
              <button
                type="button"
                onClick={() => setReadIds(prev => Array.from(new Set([...prev, ...unreadNotifications.map(item => item.id)])))}
                className="inline-flex min-h-9 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 px-3 text-sm font-semibold text-primary transition hover:border-primary/35 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Отметить прочитанным
              </button>
            )}
          </div>

          {unreadNotifications.length === 0 ? (
            <div className="mt-4 rounded-xl border border-dashed border-border bg-muted/25 px-5 py-8 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 text-primary">
                <Bell className="h-5 w-5" />
              </div>
              <p className="mt-3 text-sm font-semibold text-foreground">Все уведомления прочитаны</p>
              <p className="mt-1 text-sm text-muted-foreground">Новые события появятся здесь, когда потребуют внимания.</p>
            </div>
          ) : (
            <div className="space-y-3 pt-4">
              {unreadNotifications.map(notification => {
                const Icon = getIcon(notification);
                return (
                  <div
                    key={notification.id}
                    className={cn('rounded-xl border p-3 transition hover:border-primary/35 hover:bg-card/85 sm:p-4', priorityStyles[notification.priority])}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-card/85 text-foreground shadow-sm">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <span className={cn('h-2.5 w-2.5 rounded-full shadow-[0_0_0_4px_color-mix(in_srgb,currentColor_12%,transparent)]', priorityDotStyles[notification.priority])} />
                          <span className={cn('rounded-full border px-2 py-0.5 font-semibold uppercase tracking-wide', priorityChipStyles[notification.priority])}>
                            {notification.category}
                          </span>
                        </div>
                        <p className="mt-2 break-words text-sm font-semibold leading-5 text-foreground">
                          {notification.title}
                        </p>
                        {notification.entity && (
                          <p className="mt-1 break-words text-xs text-muted-foreground">
                            {notification.entity}
                          </p>
                        )}
                        <p className="mt-2 break-words text-sm leading-6 text-muted-foreground">
                          {notification.detail}
                        </p>
                        <div className="mt-3 flex flex-col gap-2 border-t border-border/70 pt-3 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
                          <span className="text-xs font-medium text-muted-foreground">
                            {notification.date ? formatDate(notification.date) : 'Требует внимания'}
                          </span>
                          <Link
                            to={notification.link}
                            onClick={() => setOpen(false)}
                            className="inline-flex min-h-9 max-w-full items-center justify-center gap-2 rounded-xl border border-primary/20 bg-primary/10 px-3 text-sm font-semibold text-primary transition hover:border-primary/35 hover:bg-primary/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          >
                            <span className="break-words text-left">{notification.linkLabel}</span>
                            <ArrowRight className="h-4 w-4 shrink-0" />
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
