const OPEN_STATUSES = new Set(['new', 'in_progress', 'waiting_parts', 'needs_revision', 'ready']);
const READY_STATUSES = new Set(['ready']);
const WAITING_PARTS_STATUSES = new Set(['waiting_parts']);
const IN_PROGRESS_STATUSES = new Set(['in_progress', 'needs_revision']);
const PRIORITY_ORDER = { critical: 0, high: 1, medium: 2, low: 3 };

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase().replaceAll('ё', 'е');
}

export function localDateKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function displayDateKey(key) {
  const [year, month, day] = text(key).split('-');
  if (!year || !month || !day) return '—';
  return `${day}.${month}.${year}`;
}

function dateKey(value) {
  const raw = text(value);
  if (!raw) return '';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  return localDateKey(date);
}

function firstDateKey(record, fields) {
  for (const field of fields) {
    const key = dateKey(record?.[field]);
    if (key) return key;
  }
  return '';
}

function normalizeStatus(status) {
  const value = lower(status).replace(/[\s-]+/g, '_');
  if (value === 'waiting' || value === 'waitingparts') return 'waiting_parts';
  if (value === 'needsrevision' || value === 'revision' || value === 'rework') return 'needs_revision';
  if (value === 'progress' || value === 'inprogress') return 'in_progress';
  if (value === 'done' || value === 'complete' || value === 'completed' || value === 'finished') return 'closed';
  if (OPEN_STATUSES.has(value) || value === 'closed') return value;
  return 'new';
}

function normalizePriority(priority) {
  const value = lower(priority);
  if (value === 'critical' || value === 'urgent') return 'critical';
  if (value === 'high') return 'high';
  if (value === 'low') return 'low';
  return 'medium';
}

function mechanicName(ticket) {
  return text(ticket?.assignedMechanicName || ticket?.mechanicName || ticket?.assignedTo);
}

function mechanicId(ticket) {
  return text(ticket?.assignedMechanicId || ticket?.mechanicId || ticket?.assignedUserId || ticket?.responsibleUserId);
}

function isOpen(ticket) {
  return OPEN_STATUSES.has(normalizeStatus(ticket?.status));
}

function isUnassigned(ticket) {
  return !mechanicId(ticket) && !mechanicName(ticket);
}

function isOverdue(ticket, targetDate) {
  if (!isOpen(ticket)) return false;
  const dueKey = firstDateKey(ticket, ['dueDate', 'deadline', 'targetDate', 'plannedDate', 'scheduledDate']);
  return Boolean(dueKey && dueKey < targetDate);
}

function isTodayTask(ticket, targetDate) {
  if (!isOpen(ticket)) return false;
  const plannedKey = firstDateKey(ticket, ['plannedDate', 'scheduledDate', 'targetDate']);
  const dueKey = firstDateKey(ticket, ['dueDate', 'deadline']);
  const status = normalizeStatus(ticket?.status);
  return plannedKey === targetDate
    || dueKey === targetDate
    || IN_PROGRESS_STATUSES.has(status)
    || isOverdue(ticket, targetDate)
    || READY_STATUSES.has(status)
    || WAITING_PARTS_STATUSES.has(status)
    || isUnassigned(ticket);
}

function mechanicKeyForTicket(ticket) {
  return mechanicId(ticket) || mechanicName(ticket);
}

function normalizeMechanic(mechanic) {
  const id = text(mechanic?.id || mechanic?.userId || mechanic?.name);
  const name = text(mechanic?.name || mechanic?.userName || mechanic?.email) || 'Механик без имени';
  return {
    id,
    key: id || name,
    name,
    role: text(mechanic?.role || mechanic?.type || mechanic?.notes),
    status: text(mechanic?.status || 'active') || 'active',
    userId: text(mechanic?.userId),
    email: text(mechanic?.email),
  };
}

function ticketSort(left, right) {
  return Number(right.isOverdue) - Number(left.isOverdue)
    || (PRIORITY_ORDER[left.priority] ?? 99) - (PRIORITY_ORDER[right.priority] ?? 99)
    || String(left.planDate || left.dueDate || left.createdAt || '').localeCompare(String(right.planDate || right.dueDate || right.createdAt || ''));
}

function ticketView(ticket, targetDate) {
  const status = normalizeStatus(ticket?.status);
  const priority = normalizePriority(ticket?.priority);
  const planDate = firstDateKey(ticket, ['plannedDate', 'scheduledDate', 'targetDate']);
  const dueDate = firstDateKey(ticket, ['dueDate', 'deadline']);
  const overdue = isOverdue(ticket, targetDate);
  return {
    raw: ticket,
    id: text(ticket?.id),
    status,
    priority,
    mechanicId: mechanicId(ticket),
    mechanicName: mechanicName(ticket),
    equipment: text(ticket?.equipment || ticket?.equipmentName || ticket?.equipmentTitle) || 'Техника не указана',
    inventoryNumber: text(ticket?.inventoryNumber || ticket?.equipmentInv),
    client: text(ticket?.client || ticket?.clientName),
    rentalId: text(ticket?.rentalId),
    reason: text(ticket?.reason || ticket?.title || ticket?.summary) || 'Без причины',
    description: text(ticket?.description || ticket?.comment || ticket?.details),
    location: text(ticket?.location || ticket?.objectAddress || ticket?.objectName),
    planDate,
    dueDate,
    createdAt: dateKey(ticket?.createdAt),
    hasParts: Array.isArray(ticket?.parts) ? ticket.parts.length > 0 : Boolean(ticket?.partsUsed || ticket?.sparePartsReady),
    waitingParts: status === 'waiting_parts',
    readyToClose: status === 'ready',
    unassigned: isUnassigned(ticket),
    isOverdue: overdue,
    isCritical: priority === 'critical',
    isHighPriority: priority === 'critical' || priority === 'high',
    isToday: planDate === targetDate || dueDate === targetDate,
  };
}

function workloadStatus(tasks) {
  if (tasks.some(task => task.isOverdue)) return 'overdue';
  if (tasks.length === 0) return 'free';
  if (tasks.length >= 5 || tasks.filter(task => task.isCritical || task.isHighPriority).length >= 3) return 'overloaded';
  return 'normal';
}

function userKeys(user) {
  return [
    user?.id,
    user?.userId,
    user?.name,
    user?.userName,
    user?.email,
  ].map(text).filter(Boolean);
}

function mechanicMatchesUser(mechanic, user) {
  const keys = userKeys(user);
  const mechanicKeys = [mechanic.id, mechanic.userId, mechanic.name, mechanic.email].map(text).filter(Boolean);
  return mechanicKeys.some(mechanicKey => keys.some(key => lower(key) === lower(mechanicKey)));
}

function matchesUserTask(task, user, userMechanics) {
  const keys = [
    ...userKeys(user),
    ...userMechanics.flatMap(mechanic => [mechanic.id, mechanic.userId, mechanic.name, mechanic.email]),
  ].map(text).filter(Boolean);
  const taskKeys = [task.mechanicId, task.mechanicName].map(text).filter(Boolean);
  return taskKeys.some(taskKey => keys.some(key => lower(key) === lower(taskKey)));
}

export function buildServiceDayPlan(input = {}) {
  const targetDate = dateKey(input.date) || localDateKey();
  const currentUser = input.currentUser || null;
  const onlyMine = input.onlyMine === true;
  const allTickets = Array.isArray(input.tickets) ? input.tickets : [];
  const activeTickets = allTickets.filter(isOpen);
  const dayTasks = activeTickets
    .filter(ticket => isTodayTask(ticket, targetDate))
    .map(ticket => ticketView(ticket, targetDate));

  const mechanicMap = new Map();
  (Array.isArray(input.mechanics) ? input.mechanics : [])
    .map(normalizeMechanic)
    .filter(mechanic => mechanic.status !== 'inactive')
    .forEach(mechanic => mechanicMap.set(mechanic.key, { ...mechanic, tasks: [] }));

  for (const task of dayTasks) {
    const key = mechanicKeyForTicket(task.raw);
    if (!key) continue;
    if (!mechanicMap.has(key)) {
      mechanicMap.set(key, {
        id: task.mechanicId || key,
        key,
        name: task.mechanicName || key,
        role: '',
        status: 'active',
        userId: '',
        email: '',
        tasks: [],
      });
    }
    mechanicMap.get(key).tasks.push(task);
  }

  let mechanics = [...mechanicMap.values()].map(mechanic => {
    const tasks = mechanic.tasks.sort(ticketSort);
    const overdue = tasks.filter(task => task.isOverdue).length;
    const critical = tasks.filter(task => task.isCritical).length;
    return {
      ...mechanic,
      tasks,
      tasksCount: tasks.length,
      overdueCount: overdue,
      criticalCount: critical,
      workloadStatus: workloadStatus(tasks),
    };
  });

  if (onlyMine) {
    const userMechanics = mechanics.filter(mechanic => mechanicMatchesUser(mechanic, currentUser));
    mechanics = mechanics.filter(mechanic =>
      mechanicMatchesUser(mechanic, currentUser)
      || mechanic.tasks.some(task => matchesUserTask(task, currentUser, userMechanics)),
    );
  }

  mechanics.sort((left, right) =>
    Number(right.workloadStatus === 'overdue') - Number(left.workloadStatus === 'overdue')
    || right.tasksCount - left.tasksCount
    || left.name.localeCompare(right.name, 'ru'),
  );

  const visibleTasks = onlyMine
    ? dayTasks.filter(task => matchesUserTask(task, currentUser, mechanics))
    : dayTasks;
  const unassigned = visibleTasks.filter(task => task.unassigned).sort(ticketSort);
  const overdue = visibleTasks.filter(task => task.isOverdue).sort(ticketSort);
  const waitingParts = visibleTasks.filter(task => task.waitingParts).sort(ticketSort);
  const readyToClose = visibleTasks.filter(task => task.readyToClose).sort(ticketSort);
  const scheduledToday = visibleTasks.filter(task => task.isToday);
  const inProgress = visibleTasks.filter(task => task.status === 'in_progress' || task.status === 'needs_revision');
  const newTasks = visibleTasks.filter(task => task.status === 'new');
  const freeMechanics = mechanics.filter(mechanic => mechanic.workloadStatus === 'free');
  const overloadedMechanics = mechanics.filter(mechanic => mechanic.workloadStatus === 'overloaded' || mechanic.workloadStatus === 'overdue');

  return {
    date: targetDate,
    displayDate: displayDateKey(targetDate),
    mechanics,
    tasks: visibleTasks.sort(ticketSort),
    problems: { unassigned, overdue, waitingParts, readyToClose },
    metrics: {
      total: visibleTasks.length,
      scheduledToday: scheduledToday.length,
      inProgress: inProgress.length,
      new: newTasks.length,
      overdue: overdue.length,
      unassigned: unassigned.length,
      waitingParts: waitingParts.length,
      readyToClose: readyToClose.length,
      freeMechanics: freeMechanics.length,
      overloadedMechanics: overloadedMechanics.length,
    },
  };
}
