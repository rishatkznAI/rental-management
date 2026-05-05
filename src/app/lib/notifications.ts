import type { GanttRentalData } from '../mock-data';
import type { Equipment, Payment, RentalChangeRequest, ServiceTicket, ShippingPhoto } from '../types';
import { buildRentalDebtRows, getRentalDebtOverdueDays } from './finance';
import { formatCurrency, formatDate } from './utils';

export type NotificationSection = 'rentals' | 'service' | 'equipment' | 'payments' | 'approvals';
export type NotificationPriority = 'critical' | 'high' | 'medium';

export interface AppNotification {
  id: string;
  section: NotificationSection;
  priority: NotificationPriority;
  category: string;
  title: string;
  detail: string;
  link: string;
  linkLabel: string;
  entity?: string;
  date?: string;
}

const MS_PER_DAY = 1000 * 60 * 60 * 24;

function toDateOnly(value: string): Date {
  return new Date(`${value}T00:00:00`);
}

function dateOnlyString(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function diffInDays(from: Date, to: Date): number {
  return Math.round((to.getTime() - from.getTime()) / MS_PER_DAY);
}

function isReturnControlStatus(status: GanttRentalData['status']): boolean {
  return status === 'active' || status === 'returned';
}

export function buildAppNotifications({
  rentals,
  serviceTickets,
  equipment,
  payments,
  shippingPhotos,
  changeRequests = [],
  currentUser,
}: {
  rentals: GanttRentalData[];
  serviceTickets: ServiceTicket[];
  equipment: Equipment[];
  payments: Payment[];
  shippingPhotos: ShippingPhoto[];
  changeRequests?: RentalChangeRequest[];
  currentUser?: { id?: string; role?: string; name?: string } | null;
}): AppNotification[] {
  const notifications: AppNotification[] = [];
  const today = toDateOnly(dateOnlyString(new Date()));
  const tomorrow = new Date(today);
  tomorrow.setDate(today.getDate() + 1);
  const todayStr = dateOnlyString(today);
  const tomorrowStr = dateOnlyString(tomorrow);

  const equipmentById = new Map(equipment.map(item => [item.id, item] as const));

  rentals
    .filter(item => (item.status === 'active' || item.status === 'created') && item.endDate === tomorrowStr)
    .forEach(item => {
      notifications.push({
        id: `return-tomorrow-${item.id}`,
        section: 'rentals',
        priority: 'medium',
        category: 'Возврат завтра',
        title: item.client,
        entity: item.equipmentInv,
        detail: `Техника должна вернуться ${formatDate(item.endDate)}`,
        link: '/rentals',
        linkLabel: 'К арендам',
        date: item.endDate,
      });
    });

  rentals
    .filter(item => isReturnControlStatus(item.status) && item.endDate < todayStr)
    .forEach(item => {
      const overdueDays = Math.max(1, diffInDays(toDateOnly(item.endDate), today));
      notifications.push({
        id: `return-overdue-${item.id}`,
        section: 'rentals',
        priority: 'critical',
        category: 'Просроченный возврат',
        title: item.client,
        entity: item.equipmentInv,
        detail: `${overdueDays} ${overdueDays === 1 ? 'день' : overdueDays < 5 ? 'дня' : 'дней'} просрочки`,
        link: '/rentals',
        linkLabel: 'Открыть планировщик',
        date: item.endDate,
      });
    });

  rentals
    .filter(item => (item.status === 'active' || item.status === 'created' || item.status === 'returned') && item.endDate <= todayStr)
    .forEach(item => {
      const hasReceiving = shippingPhotos.some(photo =>
        photo.type === 'receiving' &&
        (photo.rentalId === item.id || (item.equipmentId && photo.equipmentId === item.equipmentId)) &&
        photo.date.slice(0, 10) >= item.endDate,
      );
      if (hasReceiving) return;
      notifications.push({
        id: `acceptance-today-${item.id}`,
        section: 'equipment',
        priority: 'high',
        category: 'Ожидает приёмки',
        title: item.client,
        entity: item.equipmentInv,
        detail: 'Сегодня по аренде ожидается возврат, но приёмка ещё не оформлена',
        link: item.equipmentId ? `/equipment/${item.equipmentId}` : '/rentals',
        linkLabel: item.equipmentId ? 'Карточка техники' : 'К арендам',
        date: item.endDate,
      });
    });

  serviceTickets
    .filter(ticket => ticket.status !== 'closed' && !ticket.assignedMechanicId && !ticket.assignedMechanicName)
    .forEach(ticket => {
      const createdAt = new Date(ticket.createdAt);
      const ageDays = Math.max(0, diffInDays(createdAt, today));
      notifications.push({
        id: `service-unassigned-${ticket.id}`,
        section: 'service',
        priority: ageDays > 0 ? 'high' : 'medium',
        category: 'Заявка без механика',
        title: ticket.equipment,
        entity: ticket.reason,
        detail: ageDays > 0 ? `${ageDays} дн. без назначения` : 'Требует назначения механика',
        link: `/service/${ticket.id}`,
        linkLabel: 'Открыть заявку',
        date: ticket.createdAt,
      });
    });

  payments
    .filter(payment => payment.status !== 'paid' && payment.dueDate < todayStr)
    .forEach(payment => {
      const overdueDays = Math.max(1, diffInDays(toDateOnly(payment.dueDate), today));
      notifications.push({
        id: `payment-overdue-${payment.id}`,
        section: 'payments',
        priority: overdueDays > 7 ? 'critical' : 'high',
        category: 'Просроченный платёж',
        title: payment.client,
        entity: payment.invoiceNumber || payment.rentalId || 'Платёж',
        detail: `${formatCurrency(payment.amount)} · ${overdueDays} ${overdueDays === 1 ? 'день' : overdueDays < 5 ? 'дня' : 'дней'} просрочки`,
        link: '/payments',
        linkLabel: 'К платежам',
        date: payment.dueDate,
      });
    });

  const rentalDebtRows = buildRentalDebtRows(rentals, payments);
  rentals
    .filter(item => item.status === 'created')
    .forEach(item => {
      const clientDebtRows = rentalDebtRows.filter(
        row => (
          row.clientId
            ? row.clientId === item.clientId
            : !item.clientId && row.client === item.client
        ) && row.rentalId !== item.id && row.outstanding > 0,
      );
      if (!clientDebtRows.length) return;

      const currentDebt = clientDebtRows.reduce((sum, row) => sum + row.outstanding, 0);
      const overdueRentals = clientDebtRows.filter(row => getRentalDebtOverdueDays(row, todayStr) > 0).length;

      notifications.push({
        id: `new-rental-debt-${item.id}`,
        section: 'payments',
        priority: overdueRentals > 0 ? 'critical' : 'high',
        category: 'Новая аренда при долге',
        title: item.client,
        entity: item.equipmentInv,
        detail:
          overdueRentals > 0
            ? `Открыта новая аренда при долге ${formatCurrency(currentDebt)} · просроченных аренд: ${overdueRentals}`
            : `Открыта новая аренда при действующем долге ${formatCurrency(currentDebt)}`,
        link: '/rentals',
        linkLabel: 'Проверить аренду',
        date: item.startDate,
      });
    });

  equipment.forEach(item => {
    [
      { key: 'nextMaintenance', label: 'Плановое ТО', value: item.nextMaintenance },
      { key: 'maintenanceCHTO', label: 'ЧТО', value: item.maintenanceCHTO },
      { key: 'maintenancePTO', label: 'ПТО', value: item.maintenancePTO },
    ].forEach(check => {
      if (!check.value) return;
      if (check.value >= todayStr) return;
      const overdueDays = Math.max(1, diffInDays(toDateOnly(check.value), today));
      notifications.push({
        id: `maintenance-${item.id}-${check.key}`,
        section: 'equipment',
        priority: overdueDays > 30 ? 'high' : 'medium',
        category: `Просрочено ${check.label}`,
        title: `${item.manufacturer} ${item.model}`,
        entity: item.inventoryNumber || item.serialNumber,
        detail: `${overdueDays} ${overdueDays === 1 ? 'день' : overdueDays < 5 ? 'дня' : 'дней'} просрочки`,
        link: `/equipment/${item.id}`,
        linkLabel: 'Карточка техники',
        date: check.value,
      });
    });
  });

  changeRequests
    .filter(item => item.status === 'pending' && currentUser?.role === 'Администратор')
    .forEach(item => {
      notifications.push({
        id: `approval-pending-${item.id}`,
        section: 'approvals',
        priority: 'high',
        category: 'На согласовании',
        title: item.type,
        entity: item.rentalId || item.client,
        detail: `${item.initiatorName} · ${item.fieldLabel || item.field}`,
        link: '/approvals',
        linkLabel: 'К согласованиям',
        date: item.createdAt,
      });
    });

  changeRequests
    .filter(item =>
      item.initiatorId === currentUser?.id &&
      (item.status === 'approved' || item.status === 'rejected')
    )
    .forEach(item => {
      notifications.push({
        id: `approval-decision-${item.id}-${item.status}`,
        section: 'rentals',
        priority: item.status === 'rejected' ? 'high' : 'medium',
        category: item.status === 'approved' ? 'Изменение согласовано' : 'Изменение отклонено',
        title: item.type,
        entity: item.rentalId,
        detail: item.status === 'approved'
          ? 'Новое значение применено к аренде'
          : `Причина: ${item.rejectionReason || 'не указана'}`,
        link: item.rentalId ? `/rentals/${item.rentalId}` : '/rentals',
        linkLabel: 'Открыть аренду',
        date: item.decidedAt || item.createdAt,
      });
    });

  const priorities: Record<NotificationPriority, number> = { critical: 0, high: 1, medium: 2 };
  return notifications
    .filter(item => {
      if (item.section !== 'equipment') return true;
      if (!item.link.startsWith('/equipment/')) return true;
      const equipmentId = item.link.replace('/equipment/', '');
      return equipmentById.has(equipmentId);
    })
    .sort((a, b) => priorities[a.priority] - priorities[b.priority]);
}
