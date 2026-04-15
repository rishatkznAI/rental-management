import type { AuditEntry } from '../types';

function displayValue(value: string | number | boolean | undefined | null): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'number') return String(value);
  return value.trim() || '—';
}

export function createAuditEntry(
  author: string,
  text: string,
  type: AuditEntry['type'] = 'system',
): AuditEntry {
  return {
    date: new Date().toISOString(),
    text,
    author,
    type,
  };
}

export function appendAuditHistory<T extends { history?: AuditEntry[] }>(
  entity: T,
  ...entries: Array<AuditEntry | null | undefined>
): T {
  const nextEntries = entries.filter(Boolean) as AuditEntry[];
  if (nextEntries.length === 0) return entity;
  return {
    ...entity,
    history: [...(entity.history || []), ...nextEntries],
  };
}

export function buildFieldDiffHistory<T extends Record<string, unknown>>(
  previous: T,
  next: T,
  labels: Record<string, string>,
  author: string,
  prefix: string,
): AuditEntry[] {
  const changes: string[] = [];

  Object.entries(labels).forEach(([field, label]) => {
    const before = previous[field];
    const after = next[field];
    if (before !== after) {
      changes.push(`${label}: ${displayValue(before as string | number | boolean | undefined | null)} → ${displayValue(after as string | number | boolean | undefined | null)}`);
    }
  });

  if (changes.length === 0) return [];
  return [createAuditEntry(author, `${prefix}: ${changes.join('; ')}`)];
}
