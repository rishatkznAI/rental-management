const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isDateOnlyValue(value) {
  return DATE_ONLY_PATTERN.test(String(value || '').trim());
}

export function parseDateOnly(value) {
  const match = String(value || '').trim().match(DATE_ONLY_PATTERN);
  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const parsed = new Date(0);
  parsed.setHours(0, 0, 0, 0);
  parsed.setFullYear(year, month - 1, day);
  if (
    parsed.getFullYear() !== year
    || parsed.getMonth() !== month - 1
    || parsed.getDate() !== day
  ) {
    return null;
  }
  return parsed;
}

export function parseDateValue(value) {
  const text = String(value || '').trim();
  if (!text) return null;
  const parsed = isDateOnlyValue(text) ? parseDateOnly(text) : new Date(text);
  return parsed && !Number.isNaN(parsed.getTime()) ? parsed : null;
}

export function formatDateValue(value, options = {}) {
  const text = String(value || '').trim();
  if (isDateOnlyValue(text)) {
    if (!parseDateOnly(text)) return '—';
    const [year, month, day] = text.split('-');
    return `${day}.${month}.${year}`;
  }

  const parsed = parseDateValue(text);
  if (!parsed) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    ...options,
  }).format(parsed);
}
