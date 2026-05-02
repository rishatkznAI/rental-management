export const TASK_PRIORITY_LABELS = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критично',
};

export const TASK_SECTION_LABELS = {
  rentals: 'Аренды',
  finance: 'Финансы',
  documents: 'Документы',
  service: 'Сервис',
  deliveries: 'Доставка',
  system: 'Система',
};

function normalizeText(value) {
  return String(value ?? '').trim();
}

function dateKey(value) {
  const text = normalizeText(value);
  if (!text) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toISOString().slice(0, 10);
}

function addDaysKey(todayKey, days) {
  const parsed = new Date(`${todayKey}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return '';
  parsed.setDate(parsed.getDate() + days);
  return parsed.toISOString().slice(0, 10);
}

export function taskPriorityLabel(priority) {
  return TASK_PRIORITY_LABELS[priority] || TASK_PRIORITY_LABELS.medium;
}

export function taskSectionLabel(section) {
  return TASK_SECTION_LABELS[section] || normalizeText(section) || 'Раздел';
}

export function normalizeTask(task = {}) {
  return {
    id: normalizeText(task.id) || `${normalizeText(task.type) || 'task'}:${normalizeText(task.entityId) || normalizeText(task.title) || 'unknown'}`,
    type: normalizeText(task.type) || 'system',
    title: normalizeText(task.title) || 'Задача',
    description: normalizeText(task.description),
    priority: ['low', 'medium', 'high', 'critical'].includes(task.priority) ? task.priority : 'medium',
    dueDate: dateKey(task.dueDate),
    section: normalizeText(task.section) || 'system',
    entityType: normalizeText(task.entityType),
    entityId: normalizeText(task.entityId),
    clientId: normalizeText(task.clientId),
    clientName: normalizeText(task.clientName),
    assignedTo: normalizeText(task.assignedTo),
    responsible: normalizeText(task.responsible),
    status: normalizeText(task.status) || 'open',
    actionUrl: normalizeText(task.actionUrl) || '/',
    detectedAt: dateKey(task.detectedAt),
    source: normalizeText(task.source) || 'computed',
    amount: Number.isFinite(Number(task.amount)) ? Math.max(0, Number(task.amount)) : undefined,
  };
}

export function groupTasksByDueDate(tasks = [], today = new Date().toISOString().slice(0, 10)) {
  const todayKey = dateKey(today) || new Date().toISOString().slice(0, 10);
  const tomorrowKey = addDaysKey(todayKey, 1);
  const groups = [
    { id: 'overdue', title: 'Просрочено', tasks: [] },
    { id: 'today', title: 'Сегодня', tasks: [] },
    { id: 'tomorrow', title: 'Завтра', tasks: [] },
    { id: 'no_due', title: 'Без срока', tasks: [] },
    { id: 'other', title: 'Остальное', tasks: [] },
  ];
  const byId = new Map(groups.map(group => [group.id, group]));

  for (const rawTask of Array.isArray(tasks) ? tasks : []) {
    const task = normalizeTask(rawTask);
    if (!task.dueDate) {
      byId.get('no_due').tasks.push(task);
    } else if (task.dueDate < todayKey) {
      byId.get('overdue').tasks.push(task);
    } else if (task.dueDate === todayKey) {
      byId.get('today').tasks.push(task);
    } else if (task.dueDate === tomorrowKey) {
      byId.get('tomorrow').tasks.push(task);
    } else {
      byId.get('other').tasks.push(task);
    }
  }

  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  groups.forEach(group => {
    group.tasks.sort((left, right) =>
      priorityOrder[left.priority] - priorityOrder[right.priority]
      || (left.dueDate || '9999-12-31').localeCompare(right.dueDate || '9999-12-31')
      || left.title.localeCompare(right.title, 'ru')
    );
  });

  return groups;
}

export function buildTaskSummary(tasks = [], today = new Date().toISOString().slice(0, 10)) {
  const normalized = (Array.isArray(tasks) ? tasks : []).map(normalizeTask);
  const todayKey = dateKey(today) || new Date().toISOString().slice(0, 10);
  return {
    total: normalized.length,
    critical: normalized.filter(task => task.priority === 'critical').length,
    high: normalized.filter(task => task.priority === 'high').length,
    overdue: normalized.filter(task => task.dueDate && task.dueDate < todayKey).length,
    today: normalized.filter(task => task.dueDate === todayKey).length,
  };
}
