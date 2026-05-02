export const DEBT_COLLECTION_STATUS_LABELS = {
  new: 'Новый',
  contacted: 'Связались',
  promised: 'Обещал оплатить',
  partial_paid: 'Частично оплатил',
  disputed: 'Спор',
  escalation: 'Эскалация',
  legal: 'Претензия/юристы',
  closed: 'Закрыто',
};

export const DEBT_COLLECTION_ACTION_LABELS = {
  call: 'Позвонить',
  message: 'Написать',
  email: 'Отправить письмо',
  documents: 'Запросить документы',
  restrict_equipment: 'Ограничить/остановить технику',
  claim: 'Подготовить претензию',
  meeting: 'Встреча',
  wait_payment: 'Ждать оплату',
  other: 'Другое',
};

export const DEBT_COLLECTION_PRIORITY_LABELS = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критичный',
};

const CLOSED_STATUSES = new Set(['closed']);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function safeNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function dateKey(value) {
  const text = normalizeText(value);
  if (!text) return '';
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function uniqueClientKey(clientId, clientName) {
  const id = normalizeText(clientId);
  if (id) return `id:${id}`;
  const name = normalizeText(clientName).toLowerCase();
  return name ? `name:${name}` : '';
}

export function debtCollectionStatusLabel(status) {
  return DEBT_COLLECTION_STATUS_LABELS[status] || normalizeText(status) || 'Новый';
}

export function debtCollectionActionLabel(type) {
  return DEBT_COLLECTION_ACTION_LABELS[type] || normalizeText(type) || 'Другое';
}

export function debtCollectionPriorityLabel(priority) {
  return DEBT_COLLECTION_PRIORITY_LABELS[priority] || normalizeText(priority) || 'Средний';
}

export function isDebtCollectionPlanOpen(plan) {
  return !CLOSED_STATUSES.has(normalizeText(plan?.status));
}

export function isDebtCollectionActionOverdue(plan, today = new Date().toISOString().slice(0, 10)) {
  const next = dateKey(plan?.nextActionDate);
  const todayKey = dateKey(today);
  return Boolean(isDebtCollectionPlanOpen(plan) && next && todayKey && next < todayKey);
}

function buildPlanMap(plans) {
  const map = new Map();
  (Array.isArray(plans) ? plans : [])
    .filter(isDebtCollectionPlanOpen)
    .forEach(plan => {
      const key = uniqueClientKey(plan?.clientId, plan?.clientName);
      if (!key) return;
      const previous = map.get(key);
      if (!previous || dateKey(plan?.updatedAt) >= dateKey(previous?.updatedAt)) {
        map.set(key, plan);
      }
    });
  return map;
}

export function buildDebtCollectionRows(input = {}) {
  const clientDebtRows = Array.isArray(input.clientDebtRows) ? input.clientDebtRows : [];
  const plans = Array.isArray(input.plans) ? input.plans : [];
  const todayKey = dateKey(input.today) || new Date().toISOString().slice(0, 10);
  const planMap = buildPlanMap(plans);
  const grouped = new Map();

  for (const row of clientDebtRows) {
    const clientName = normalizeText(row?.client) || 'Клиент не привязан';
    const key = uniqueClientKey(row?.clientId, clientName) || `row:${clientName.toLowerCase()}`;
    const existing = grouped.get(key) || {
      clientId: normalizeText(row?.clientId) || undefined,
      client: clientName,
      manager: normalizeText(row?.manager) || 'Не назначен',
      debt: 0,
      rentals: 0,
      overdueRentals: 0,
      maxOverdueDays: 0,
      ageBucketLabel: normalizeText(row?.ageBucketLabel) || '0-7 дней',
      hasActiveRental: false,
    };
    existing.debt += safeNumber(row?.debt);
    existing.rentals += safeNumber(row?.rentals);
    existing.overdueRentals += safeNumber(row?.overdueRentals);
    existing.maxOverdueDays = Math.max(existing.maxOverdueDays, safeNumber(row?.maxOverdueDays));
    existing.hasActiveRental = existing.hasActiveRental || Boolean(row?.hasActiveRental);
    if (safeNumber(row?.maxOverdueDays) >= existing.maxOverdueDays) {
      existing.ageBucketLabel = normalizeText(row?.ageBucketLabel) || existing.ageBucketLabel;
    }
    grouped.set(key, existing);
  }

  return Array.from(grouped.entries())
    .map(([key, row]) => {
      const plan = planMap.get(key) || null;
      return {
        ...row,
        plan,
        hasPlan: Boolean(plan),
        collectionStatus: plan ? debtCollectionStatusLabel(plan.status) : 'План не создан',
        priority: plan ? debtCollectionPriorityLabel(plan.priority) : '—',
        responsible: normalizeText(plan?.responsibleName) || row.manager || 'Не назначен',
        promisedPaymentDate: dateKey(plan?.promisedPaymentDate),
        nextAction: plan ? debtCollectionActionLabel(plan.nextActionType) : 'Создать план',
        nextActionDate: dateKey(plan?.nextActionDate),
        comment: normalizeText(plan?.comment || plan?.result),
        isActionOverdue: plan ? isDebtCollectionActionOverdue(plan, todayKey) : false,
        needsPlan: !plan && safeNumber(row.maxOverdueDays) >= 30 && safeNumber(row.debt) > 0,
      };
    })
    .filter(row => row.debt > 0 || row.hasPlan)
    .sort((a, b) =>
      Number(b.isActionOverdue) - Number(a.isActionOverdue)
      || Number(b.needsPlan) - Number(a.needsPlan)
      || b.debt - a.debt
      || b.maxOverdueDays - a.maxOverdueDays
      || a.client.localeCompare(b.client, 'ru')
    );
}

export function buildDebtCollectionDashboardSummary(input = {}) {
  const todayKey = dateKey(input.today) || new Date().toISOString().slice(0, 10);
  const plans = Array.isArray(input.plans) ? input.plans : [];
  const rows = buildDebtCollectionRows(input);
  const openPlans = plans.filter(isDebtCollectionPlanOpen);
  return {
    overdueActions: openPlans.filter(plan => isDebtCollectionActionOverdue(plan, todayKey)).length,
    promisedToday: openPlans.filter(plan => dateKey(plan?.promisedPaymentDate) === todayKey).length,
    withoutPlan30Plus: rows.filter(row => row.needsPlan).length,
    highPriority: openPlans.filter(plan => ['high', 'critical'].includes(normalizeText(plan?.priority))).length,
    rows: rows.slice(0, 5),
  };
}
