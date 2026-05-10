import type { Equipment, ServiceTicket } from '../types';
import type { GanttRentalData } from '../mock-data';
import { formatDate } from './utils';
import { isRegularServiceTicket } from './serviceTicketKind.js';

export type RentalServiceAlertSeverity = 'critical' | 'warning' | 'info';

export interface RentalServiceAlert {
  severity: RentalServiceAlertSeverity;
  title: string;
  description: string;
  actionLabel?: string;
  actionTarget?: string;
}

interface BuildRentalServiceAlertOptions {
  postReturnMaintenanceWindowDays?: number;
}

const OPEN_SERVICE_STATUSES = new Set(['new', 'in_progress', 'waiting_parts', 'needs_revision']);
const HIGH_SERVICE_PRIORITIES = new Set(['critical', 'high']);

function dateKey(value: unknown) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function matchesEquipment(ticket: ServiceTicket, equipment: Equipment) {
  return (
    (!!ticket.equipmentId && ticket.equipmentId === equipment.id)
    || (!!ticket.serialNumber && !!equipment.serialNumber && ticket.serialNumber === equipment.serialNumber)
    || (!!ticket.inventoryNumber && !!equipment.inventoryNumber && ticket.inventoryNumber === equipment.inventoryNumber)
  );
}

function firstMaintenanceDateInRange(
  equipment: Equipment,
  rangeStart: string,
  rangeEnd: string,
) {
  if (!rangeStart || !rangeEnd) return null;

  return [
    { label: 'ТО', date: dateKey(equipment.nextMaintenance) },
    { label: 'ЧТО', date: dateKey(equipment.maintenanceCHTO) },
    { label: 'ПТО', date: dateKey(equipment.maintenancePTO) },
  ]
    .filter(item => item.date && item.date >= rangeStart && item.date <= rangeEnd)
    .sort((left, right) => left.date.localeCompare(right.date))[0] ?? null;
}

export function buildRentalServiceAlert(
  rental: GanttRentalData,
  equipment: Equipment | undefined,
  serviceTickets: ServiceTicket[] = [],
  today: string | Date = new Date(),
  options: BuildRentalServiceAlertOptions = {},
): RentalServiceAlert | null {
  if (!equipment) return null;

  const todayKey = dateKey(today);
  const rentalStart = dateKey(rental.startDate);
  const rentalEnd = dateKey(rental.endDate);
  const equipmentTarget = equipment.id ? `/equipment/${equipment.id}` : undefined;
  const postReturnWindowDays = options.postReturnMaintenanceWindowDays ?? 7;
  const relatedOpenTickets = serviceTickets
    .filter(ticket => isRegularServiceTicket(ticket))
    .filter(ticket => OPEN_SERVICE_STATUSES.has(ticket.status))
    .filter(ticket => matchesEquipment(ticket, equipment));
  const highPriorityTicket = relatedOpenTickets.find(ticket => HIGH_SERVICE_PRIORITIES.has(ticket.priority));
  const anyOpenTicket = relatedOpenTickets[0];

  if (equipment.status === 'in_service') {
    const actionTicket = highPriorityTicket ?? anyOpenTicket;
    return {
      severity: 'critical',
      title: 'Состояние техники',
      description: 'Техника сейчас в сервисе. Проверьте доступность перед изменением аренды.',
      actionLabel: actionTicket ? 'Открыть заявку' : 'Открыть технику',
      actionTarget: actionTicket ? `/service/${actionTicket.id}` : equipmentTarget,
    };
  }

  const overdueMaintenance = [
    { label: 'ТО', date: dateKey(equipment.nextMaintenance) },
    { label: 'ЧТО', date: dateKey(equipment.maintenanceCHTO) },
    { label: 'ПТО', date: dateKey(equipment.maintenancePTO) },
  ]
    .filter(item => item.date && todayKey && item.date < todayKey)
    .sort((left, right) => left.date.localeCompare(right.date))[0] ?? null;
  if (overdueMaintenance) {
    return {
      severity: 'critical',
      title: 'Сервисный риск',
      description: `${overdueMaintenance.label} просрочено. Проверьте технику перед продлением или возвратом.`,
      actionLabel: 'Открыть технику',
      actionTarget: equipmentTarget,
    };
  }

  if (highPriorityTicket) {
    return {
      severity: 'warning',
      title: 'Сервисный риск',
      description: 'По технике есть открытая критичная сервисная заявка.',
      actionLabel: 'Открыть заявку',
      actionTarget: `/service/${highPriorityTicket.id}`,
    };
  }

  const rentalPeriodMaintenance = firstMaintenanceDateInRange(equipment, rentalStart, rentalEnd);
  if (rentalPeriodMaintenance) {
    return {
      severity: 'warning',
      title: 'Сервисный риск',
      description: `${rentalPeriodMaintenance.label} наступает во время аренды: ${formatDate(rentalPeriodMaintenance.date)}.`,
      actionLabel: 'Открыть технику',
      actionTarget: equipmentTarget,
    };
  }

  if (anyOpenTicket) {
    return {
      severity: 'info',
      title: 'Внимание по технике',
      description: 'По технике есть открытая сервисная заявка.',
      actionLabel: 'Открыть заявку',
      actionTarget: `/service/${anyOpenTicket.id}`,
    };
  }

  const postReturnEnd = rentalEnd ? addDays(rentalEnd, postReturnWindowDays) : '';
  const postReturnMaintenance = firstMaintenanceDateInRange(equipment, rentalEnd ? addDays(rentalEnd, 1) : '', postReturnEnd);
  if (postReturnMaintenance) {
    return {
      severity: 'warning',
      title: 'Состояние техники',
      description: 'После возврата рекомендуется провести ТО.',
      actionLabel: 'Открыть технику',
      actionTarget: equipmentTarget,
    };
  }

  return null;
}
