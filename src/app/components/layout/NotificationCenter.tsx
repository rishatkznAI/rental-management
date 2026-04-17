import React from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, Bell, CalendarClock, CreditCard, Wrench } from 'lucide-react';
import { rentalsService } from '../../services/rentals.service';
import { serviceTicketsService } from '../../services/service-tickets.service';
import { equipmentService } from '../../services/equipment.service';
import { paymentsService } from '../../services/payments.service';
import { buildAppNotifications, type AppNotification, type NotificationPriority } from '../../lib/notifications';
import { cn, formatDate } from '../../lib/utils';
import { usePermissions } from '../../lib/permissions';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from '../ui/sheet';

const READ_KEY = 'app_notification_reads_v1';

const priorityStyles: Record<NotificationPriority, string> = {
  critical: 'border-red-200 bg-red-50 dark:border-red-900/70 dark:bg-red-950/30',
  high: 'border-amber-200 bg-amber-50 dark:border-amber-900/70 dark:bg-amber-950/30',
  medium: 'border-blue-200 bg-blue-50 dark:border-blue-900/70 dark:bg-blue-950/30',
};

const priorityDotStyles: Record<NotificationPriority, string> = {
  critical: 'bg-red-500',
  high: 'bg-amber-500',
  medium: 'bg-blue-500',
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
  localStorage.setItem(READ_KEY, JSON.stringify(ids));
}

function getIcon(notification: AppNotification) {
  switch (notification.section) {
    case 'service':
      return Wrench;
    case 'payments':
      return CreditCard;
    case 'rentals':
      return CalendarClock;
    default:
      return AlertTriangle;
  }
}

export function NotificationCenter() {
  const { canView } = usePermissions();
  const [open, setOpen] = React.useState(false);
  const [readIds, setReadIds] = React.useState<string[]>(() => readIdsFromStorage());

  const results = useQueries({
    queries: [
      { queryKey: ['notif-gantt-rentals'], queryFn: rentalsService.getGanttData },
      { queryKey: ['notif-service'], queryFn: serviceTicketsService.getAll },
      { queryKey: ['notif-equipment'], queryFn: equipmentService.getAll },
      { queryKey: ['notif-payments'], queryFn: paymentsService.getAll },
      { queryKey: ['notif-shipping-photos'], queryFn: equipmentService.getAllShippingPhotos },
    ],
  });

  const [rentalsResult, serviceResult, equipmentResult, paymentsResult, shippingPhotosResult] = results;

  const notifications = React.useMemo(() => {
    const items = buildAppNotifications({
      rentals: rentalsResult.data ?? [],
      serviceTickets: serviceResult.data ?? [],
      equipment: equipmentResult.data ?? [],
      payments: paymentsResult.data ?? [],
      shippingPhotos: shippingPhotosResult.data ?? [],
    });

    return items.filter(item => {
      if (item.section === 'rentals') return canView('rentals');
      if (item.section === 'service') return canView('service');
      if (item.section === 'payments') return canView('payments');
      if (item.section === 'equipment') return canView('equipment');
      return true;
    });
  }, [
    canView,
    rentalsResult.data,
    serviceResult.data,
    equipmentResult.data,
    paymentsResult.data,
    shippingPhotosResult.data,
  ]);

  React.useEffect(() => {
    writeIdsToStorage(readIds);
  }, [readIds]);

  React.useEffect(() => {
    setReadIds(prev => prev.filter(id => notifications.some(item => item.id === id)));
  }, [notifications]);

  const unreadCount = notifications.filter(item => !readIds.includes(item.id)).length;
  const criticalCount = notifications.filter(item => item.priority === 'critical').length;

  const handleOpenChange = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (nextOpen && notifications.length > 0) {
      setReadIds(Array.from(new Set([...readIds, ...notifications.map(item => item.id)])));
    }
  };

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetTrigger asChild>
        <button
          type="button"
          className="relative rounded-lg p-2 transition-colors hover:bg-gray-100 dark:hover:bg-gray-700"
          aria-label="Уведомления"
          title="Уведомления"
        >
          <Bell className="h-5 w-5 text-gray-600 dark:text-gray-300" />
          {unreadCount > 0 && (
            <span
              className={cn(
                'absolute -right-1 -top-1 flex min-h-5 min-w-5 items-center justify-center rounded-full px-1 text-[10px] font-bold text-white',
                criticalCount > 0 ? 'bg-red-500' : 'bg-blue-500',
              )}
            >
              {unreadCount > 99 ? '99+' : unreadCount}
            </span>
          )}
        </button>
      </SheetTrigger>

      <SheetContent side="right" className="w-full sm:max-w-lg">
        <SheetHeader className="border-b border-gray-200 dark:border-gray-800">
          <SheetTitle>Уведомления</SheetTitle>
          <SheetDescription>
            Возвраты, сервис, ТО и платежи, требующие внимания
          </SheetDescription>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 pb-4">
          <div className="sticky top-0 z-10 flex items-center justify-between bg-background py-3">
            <div className="text-sm text-gray-500 dark:text-gray-400">
              Всего: {notifications.length}
            </div>
            {notifications.length > 0 && (
              <button
                type="button"
                onClick={() => setReadIds(Array.from(new Set([...readIds, ...notifications.map(item => item.id)])))}
                className="text-sm font-medium text-[--color-primary] hover:underline"
              >
                Отметить прочитанным
              </button>
            )}
          </div>

          {notifications.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Сейчас критичных уведомлений нет
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map(notification => {
                const Icon = getIcon(notification);
                return (
                  <div
                    key={notification.id}
                    className={cn('rounded-xl border p-4', priorityStyles[notification.priority])}
                  >
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-lg bg-white/90 p-2 dark:bg-gray-900/60">
                        <Icon className="h-4 w-4 text-gray-700 dark:text-gray-200" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('h-2.5 w-2.5 rounded-full', priorityDotStyles[notification.priority])} />
                          <span className="text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">
                            {notification.category}
                          </span>
                        </div>
                        <p className="mt-1 text-sm font-semibold text-gray-900 dark:text-white">
                          {notification.title}
                        </p>
                        {notification.entity && (
                          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                            {notification.entity}
                          </p>
                        )}
                        <p className="mt-2 text-sm text-gray-700 dark:text-gray-300">
                          {notification.detail}
                        </p>
                        <div className="mt-3 flex items-center justify-between gap-3">
                          <span className="text-xs text-gray-500 dark:text-gray-400">
                            {notification.date ? formatDate(notification.date) : 'Требует внимания'}
                          </span>
                          <Link
                            to={notification.link}
                            onClick={() => setOpen(false)}
                            className="text-sm font-medium text-[--color-primary] hover:underline"
                          >
                            {notification.linkLabel}
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
