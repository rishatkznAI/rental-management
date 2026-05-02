const FINANCE_HIDDEN_TEXT = 'Финансовые изменения скрыты правами доступа';

function safeText(value, fallback = '—') {
  if (value === null || value === undefined) return fallback;
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : fallback;
  const text = String(value).trim();
  return text || fallback;
}

function truncateText(value, max = 80) {
  const text = safeText(value);
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

function normalizeChanges(changes = []) {
  return (Array.isArray(changes) ? changes : [])
    .slice(0, 12)
    .map(change => {
      if (change?.hidden) {
        return {
          field: safeText(change.field),
          label: safeText(change.label, 'Финансы'),
          hidden: true,
          before: FINANCE_HIDDEN_TEXT,
          after: FINANCE_HIDDEN_TEXT,
          text: FINANCE_HIDDEN_TEXT,
        };
      }
      const before = truncateText(change?.before);
      const after = truncateText(change?.after);
      return {
        field: safeText(change?.field),
        label: safeText(change?.label),
        hidden: false,
        before,
        after,
        text: `${before} → ${after}`,
      };
    });
}

export function formatRentalAuditEvents(events = []) {
  return (Array.isArray(events) ? events : [])
    .slice(0, 20)
    .map((event, index) => ({
      id: safeText(event?.id, `audit-${index}`),
      createdAt: safeText(event?.createdAt),
      userName: safeText(event?.userName, 'Система'),
      role: safeText(event?.role),
      action: safeText(event?.action),
      actionLabel: safeText(event?.actionLabel || event?.action),
      actionKind: safeText(event?.actionKind, 'update'),
      entityType: safeText(event?.entityType, 'rental'),
      entityId: safeText(event?.entityId),
      description: truncateText(event?.description, 160),
      changes: normalizeChanges(event?.changes),
    }));
}

export { FINANCE_HIDDEN_TEXT };
