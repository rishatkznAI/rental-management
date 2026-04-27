import React from 'react';
import { Link } from 'react-router-dom';
import { useQueries } from '@tanstack/react-query';
import { AlertTriangle, Bell, CalendarClock, CreditCard, FileCheck, Wrench } from 'lucide-react';
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
  const { canView } = usePermissions();
  const { user } = useAuth();
  const [open, setOpen] = React.useState(false);
  const [readIds, setReadIds] = React.useState<string[]>(() => readIdsFromStorage());

  const results = useQueries({
    queries: [
      { queryKey: ['notif-gantt-rentals'], queryFn: rentalsService.getGanttData },
      { queryKey: ['notif-service'], queryFn: serviceTicketsService.getAll },
      { queryKey: ['notif-equipment'], queryFn: equipmentService.getAll },
      { queryKey: ['notif-payments'], queryFn: paymentsService.getAll },
      { queryKey: ['notif-shipping-photos'], queryFn: equipmentService.getAllShippingPhotos },
      { queryKey: ['notif-rental-change-requests'], queryFn: rentalChangeRequestsService.getAll },
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
              Непрочитанных: {unreadNotifications.length} {notifications.length !== unreadNotifications.length ? `· Всего: ${notifications.length}` : ''}
            </div>
            {unreadNotifications.length > 0 && (
              <button
                type="button"
                onClick={() => setReadIds(prev => Array.from(new Set([...prev, ...unreadNotifications.map(item => item.id)])))}
                className="text-sm font-medium text-[--color-primary] hover:underline"
              >
                Отметить прочитанным
              </button>
            )}
          </div>

          {unreadNotifications.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray-300 p-6 text-center text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
              Все уведомления прочитаны
            </div>
          ) : (
            <div className="space-y-3">
              {unreadNotifications.map(notification => {
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
