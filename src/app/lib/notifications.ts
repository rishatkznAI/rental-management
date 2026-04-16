import type { GanttRentalData } from '../mock-data';
import type { Equipment, Payment, ServiceTicket, ShippingPhoto } from '../types';
import { formatCurrency, formatDate } from './utils';

export type NotificationSection = 'rentals' | 'service' | 'equipment' | 'payments';
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

export function buildAppNotifications({
  rentals,
  serviceTickets,
  equipment,
  payments,
  shippingPhotos,
}: {
  rentals: GanttRentalData[];
  serviceTickets: ServiceTicket[];
  equipment: Equipment[];
  payments: Payment[];
  shippingPhotos: ShippingPhoto[];
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
    .filter(item => item.status === 'active' && item.endDate < todayStr)
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
    .filter(item => (item.status === 'active' || item.status === 'created') && item.endDate === todayStr)
    .forEach(item => {
      const hasReceiving = shippingPhotos.some(photo =>
        photo.type === 'receiving' &&
        (photo.rentalId === item.id || (item.equipmentId && photo.equipmentId === item.equipmentId)) &&
        photo.date.slice(0, 10) >= todayStr,
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
