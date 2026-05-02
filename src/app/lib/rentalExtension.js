export const EXTENSION_REASONS = [
  'Клиент продлевает работы',
  'Задержка на объекте',
  'Ожидание замены техники',
  'Другое',
];

function dateOnly(value) {
  return String(value || '').slice(0, 10);
}

function parseDate(value) {
  const key = dateOnly(value);
  if (!key) return null;
  const date = new Date(`${key}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatExtensionDate(value) {
  const date = parseDate(value);
  if (!date) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(date);
}

export function buildExtensionFormState(rental) {
  return {
    newPlannedReturnDate: dateOnly(rental?.plannedReturnDate),
    reason: '',
    comment: '',
  };
}

export function getRentalExtensionValidation({ rental, form, today = new Date().toISOString().slice(0, 10), hasEquipment = true }) {
  const currentEnd = dateOnly(rental?.plannedReturnDate);
  const nextEnd = dateOnly(form?.newPlannedReturnDate);
  const currentDate = parseDate(currentEnd);
  const nextDate = parseDate(nextEnd);
  const todayDate = parseDate(today);
  const status = String(rental?.status || '').toLowerCase();

  if (status === 'closed' || status === 'returned') return 'Нельзя продлить закрытую аренду.';
  if (status === 'cancelled' || status === 'canceled') return 'Нельзя продлить отменённую аренду.';
  if (!hasEquipment) return 'Нельзя продлить аренду без техники.';
  if (!currentDate) return 'В аренде не указана текущая дата окончания.';
  if (!nextDate) return 'Укажите новую дату окончания аренды.';
  if (nextDate.getTime() <= currentDate.getTime()) return 'Новая дата должна быть позже текущей даты окончания.';
  if (todayDate && nextDate.getTime() < todayDate.getTime()) return 'Нельзя продлить аренду в прошлую дату.';
  if (!String(form?.reason || '').trim()) return 'Укажите причину продления.';
  return '';
}

export function buildExtensionConflictDisplay(conflict) {
  if (!conflict) return null;
  return {
    date: formatExtensionDate(conflict.date || conflict.startDate),
    period: `${formatExtensionDate(conflict.startDate)} — ${formatExtensionDate(conflict.endDate)}`,
    client: String(conflict.client || 'Без клиента'),
    rental: String(conflict.rentalId || conflict.ganttRentalId || '—'),
    status: String(conflict.status || '—'),
  };
}
