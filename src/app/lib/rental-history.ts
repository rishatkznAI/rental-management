import type { GanttRentalData, RentalHistoryEntry } from '../mock-data';
import { formatDate } from './utils';

function display(value?: string | number | boolean | null): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'number') return String(value);
  return value.trim() || '—';
}

function displayDate(value?: string): string {
  if (!value) return '—';
  return formatDate(value);
}

export function createRentalHistoryEntry(
  author: string,
  text: string,
  type: RentalHistoryEntry['type'] = 'system',
): RentalHistoryEntry {
  return {
    date: new Date().toISOString(),
    text,
    author,
    type,
  };
}

export function buildRentalCreationHistory(
  rental: Pick<GanttRentalData, 'client' | 'startDate' | 'endDate' | 'status'>,
  author: string,
): RentalHistoryEntry {
  const label = rental.status === 'active' ? 'Аренда создана и активирована' : 'Аренда создана';
  return createRentalHistoryEntry(
    author,
    `${label}: ${rental.client} · ${displayDate(rental.startDate)} — ${displayDate(rental.endDate)}`,
  );
}

export function buildRentalUpdateHistory(
  previous: GanttRentalData,
  next: GanttRentalData,
  author: string,
): RentalHistoryEntry[] {
  const changes: string[] = [];

  if (previous.client !== next.client) {
    changes.push(`клиент: ${display(previous.client)} → ${display(next.client)}`);
  }
  if (previous.manager !== next.manager) {
    changes.push(`менеджер: ${display(previous.manager)} → ${display(next.manager)}`);
  }
  if (previous.startDate !== next.startDate || previous.endDate !== next.endDate) {
    changes.push(
      `даты: ${displayDate(previous.startDate)} — ${displayDate(previous.endDate)} → ${displayDate(next.startDate)} — ${displayDate(next.endDate)}`,
    );
  }
  if ((previous.amount || 0) !== (next.amount || 0)) {
    changes.push(`сумма: ${display(previous.amount || 0)} → ${display(next.amount || 0)}`);
  }
  if ((previous.expectedPaymentDate || '') !== (next.expectedPaymentDate || '')) {
    changes.push(`ожидаемая оплата: ${displayDate(previous.expectedPaymentDate)} → ${displayDate(next.expectedPaymentDate)}`);
  }

  if (changes.length === 0) return [];
  return [createRentalHistoryEntry(author, `Обновлена аренда: ${changes.join('; ')}`)];
}

export function appendRentalHistory(
  rental: GanttRentalData,
  ...entries: Array<RentalHistoryEntry | null | undefined>
): GanttRentalData {
  const nextEntries = entries.filter(Boolean) as RentalHistoryEntry[];
  if (nextEntries.length === 0) return rental;
  return {
    ...rental,
    comments: [...(rental.comments || []), ...nextEntries],
  };
}
