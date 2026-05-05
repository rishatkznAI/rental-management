const OPEN_SERVICE_STATUSES = new Set(['new', 'open', 'assigned', 'in_progress', 'waiting_parts', 'needs_revision', 'ready']);
const OPEN_RENTAL_STATUSES = new Set(['created', 'confirmed', 'active', 'return_planned']);

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase().replaceAll('ё', 'е');
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, parsed) : 0;
}

function dateKey(value) {
  const raw = text(value);
  if (!raw) return '';
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
}

function daysBetween(start, end) {
  const startKey = dateKey(start);
  const endKey = dateKey(end);
  if (!startKey || !endKey) return 0;
  return Math.max(0, Math.ceil((new Date(endKey).getTime() - new Date(startKey).getTime()) / 86400000));
}

function normalizePriority(priority) {
  const value = lower(priority);
  if (value === 'critical' || value === 'urgent') return 'critical';
  if (value === 'high') return 'high';
  if (value === 'low') return 'low';
  return 'medium';
}

function normalizeStatus(status) {
  const value = lower(status);
  if (value === 'waitingparts' || value === 'waiting_parts' || value === 'waiting') return 'waiting_parts';
  if (value === 'needsrevision' || value === 'needs_revision' || value === 'revision' || value === 'rework') return 'needs_revision';
  if (value === 'inprogress' || value === 'in_progress' || value === 'progress') return 'in_progress';
  if (value === 'done' || value === 'complete' || value === 'completed' || value === 'closed') return 'closed';
  if (value === 'ready') return 'ready';
  return 'new';
}

function isOpenTicket(ticket) {
  return OPEN_SERVICE_STATUSES.has(normalizeStatus(ticket?.status));
}

function isOpenRental(rental) {
  return OPEN_RENTAL_STATUSES.has(lower(rental?.status));
}

function matchesEquipmentBySafeKey(record, equipment, inventoryIsUnique) {
  if (!record || !equipment) return false;
  if (record.equipmentId && equipment.id && text(record.equipmentId) === text(equipment.id)) return true;
  if (record.serialNumber && equipment.serialNumber && text(record.serialNumber) === text(equipment.serialNumber)) return true;
  if (inventoryIsUnique && record.equipmentInv && equipment.inventoryNumber && text(record.equipmentInv) === text(equipment.inventoryNumber)) return true;
  if (inventoryIsUnique && record.inventoryNumber && equipment.inventoryNumber && text(record.inventoryNumber) === text(equipment.inventoryNumber)) return true;
  return false;
}

function equipmentTitle(equipment, ticket) {
  const title = [equipment?.manufacturer, equipment?.model].map(text).filter(Boolean).join(' ');
  return title || text(ticket?.equipment) || 'Техника не указана';
}

function mechanicName(ticket) {
  return text(ticket?.assignedMechanicName || ticket?.assignedTo) || '';
}

function rentalDurationDays(rental) {
  return Math.max(1, daysBetween(rental?.startDate, rental?.endDate));
}

function normalizeRental(rental) {
  if (!rental) return null;
  return {
    id: text(rental.id),
    clientId: text(rental.clientId),
    client: text(rental.client) || 'Клиент не указан',
    startDate: dateKey(rental.startDate),
    endDate: dateKey(rental.endDate),
    status: lower(rental.status) || 'unknown',
    amount: number(rental.amount ?? rental.price),
  };
}

function classifyGroup({ score, priority, status, ageDays, waitingParts, unassigned, currentRental, nextRentalDays }) {
  if (priority === 'critical' || currentRental || (nextRentalDays !== null && nextRentalDays <= 3) || score >= 120) return 'critical';
  if (priority === 'high' || score >= 80) return 'high';
  if (waitingParts || status === 'waiting_parts') return 'waiting_parts';
  if (status === 'needs_revision') return 'revision';
  if (unassigned) return 'unassigned';
  if (ageDays >= 7) return 'long_running';
  return 'other';
}

function groupLabel(group) {
  return {
    critical: 'Критично',
    high: 'Высокий приоритет',
    waiting_parts: 'Ожидание запчастей',
    revision: 'На доработке',
    unassigned: 'Без механика',
    long_running: 'Долго в ремонте',
    other: 'Остальные',
  }[group] || 'Остальные';
}

export function buildServiceQueue(input = {}) {
  const todayKey = dateKey(input.today) || new Date().toISOString().slice(0, 10);
  const tickets = Array.isArray(input.serviceTickets) ? input.serviceTickets : [];
  const equipmentList = Array.isArray(input.equipment) ? input.equipment : [];
  const rentals = Array.isArray(input.rentals) ? input.rentals : [];
  const canViewFinance = input.canViewFinance === true;

  const inventoryCounts = new Map();
  equipmentList.forEach(item => {
    const inv = text(item?.inventoryNumber);
    if (inv) inventoryCounts.set(inv, (inventoryCounts.get(inv) || 0) + 1);
  });

  const findEquipment = (ticket) => {
    const directId = text(ticket?.equipmentId);
    if (directId) {
      const direct = equipmentList.find(item => text(item?.id) === directId);
      if (direct) return direct;
    }
    const serial = text(ticket?.serialNumber);
    if (serial) {
      const bySerial = equipmentList.filter(item => text(item?.serialNumber) === serial);
      if (bySerial.length === 1) return bySerial[0];
    }
    const inv = text(ticket?.inventoryNumber);
    if (inv && inventoryCounts.get(inv) === 1) {
      return equipmentList.find(item => text(item?.inventoryNumber) === inv) || null;
    }
    return null;
  };

  const rows = tickets
    .filter(isOpenTicket)
    .map((ticket) => {
      const equipment = findEquipment(ticket);
      const inventoryIsUnique = !!equipment?.inventoryNumber && inventoryCounts.get(text(equipment.inventoryNumber)) === 1;
      const relatedTickets = equipment
        ? tickets.filter(item => matchesEquipmentBySafeKey(item, equipment, inventoryIsUnique))
        : [];
      const relatedRentals = equipment
        ? rentals.filter(item => matchesEquipmentBySafeKey(item, equipment, inventoryIsUnique))
        : [];
      const activeRentals = relatedRentals.filter(isOpenRental);
      const currentRental = activeRentals.find(item =>
        dateKey(item?.startDate) <= todayKey && (!dateKey(item?.endDate) || dateKey(item?.endDate) >= todayKey)
      ) || null;
      const nextRental = activeRentals
        .filter(item => dateKey(item?.startDate) > todayKey)
        .sort((a, b) => dateKey(a?.startDate).localeCompare(dateKey(b?.startDate)))[0] || null;
      const recentRental = relatedRentals.some(item => {
        const end = dateKey(item?.endDate);
        return end && end <= todayKey && daysBetween(end, todayKey) <= 14;
      });
      const repeatedFailure = relatedTickets.filter(item =>
        text(item?.id) !== text(ticket?.id)
        && lower(item?.reason) === lower(ticket?.reason)
        && lower(item?.reason)
      ).length >= 1;

      const priority = normalizePriority(ticket?.priority);
      const status = normalizeStatus(ticket?.status);
      const createdAt = dateKey(ticket?.createdAt || ticket?.plannedDate);
      const ageDays = createdAt ? daysBetween(createdAt, todayKey) : 0;
      const waitingParts = status === 'waiting_parts';
      const unassigned = !mechanicName(ticket) && !text(ticket?.assignedMechanicId);
      const nextRentalDays = nextRental?.startDate ? daysBetween(todayKey, nextRental.startDate) : null;

      const scoreReasons = [];
      let score = 0;
      if (priority === 'critical') { score += 70; scoreReasons.push('критичный приоритет заявки'); }
      else if (priority === 'high') { score += 50; scoreReasons.push('высокий приоритет заявки'); }
      if (currentRental || recentRental) { score += 30; scoreReasons.push(currentRental ? 'техника сейчас в аренде' : 'техника недавно была в аренде'); }
      if (ageDays >= 7) { score += 20; scoreReasons.push('заявка висит 7+ дней'); }
      if (waitingParts) { score += 18; scoreReasons.push('ожидание запчастей'); }
      if (unassigned) { score += 25; scoreReasons.push('не назначен механик'); }
      if (repeatedFailure) { score += 15; scoreReasons.push('повторная поломка по технике'); }
      if (equipment && lower(equipment.status) === 'available') { score += 10; scoreReasons.push('после ремонта может вернуться в аренду'); }
      if (nextRentalDays !== null && nextRentalDays <= 7) { score += 30; scoreReasons.push('ближайшая будущая аренда'); }
      if (equipment && ['critical', 'high'].includes(lower(equipment.priority))) { score += 10; scoreReasons.push('приоритетная техника'); }

      const group = classifyGroup({ score, priority, status, ageDays, waitingParts, unassigned, currentRental, nextRentalDays });
      const normalizedCurrentRental = normalizeRental(currentRental);
      const normalizedNextRental = normalizeRental(nextRental);
      const riskRental = normalizedCurrentRental || normalizedNextRental;
      const dailyRisk = riskRental ? Math.round(riskRental.amount / rentalDurationDays(riskRental)) : 0;

      return {
        id: text(ticket?.id),
        ticketId: text(ticket?.id),
        equipmentId: text(equipment?.id || ticket?.equipmentId),
        equipmentTitle: equipmentTitle(equipment, ticket),
        model: text(equipment?.model || ticket?.equipment) || '—',
        serialNumber: text(equipment?.serialNumber || ticket?.serialNumber),
        inventoryNumber: text(equipment?.inventoryNumber || ticket?.inventoryNumber),
        equipmentType: text(equipment?.type || ticket?.equipmentType || ticket?.equipmentTypeLabel),
        equipmentStatus: lower(equipment?.status) || 'unknown',
        ticketStatus: status,
        ticketPriority: priority,
        createdAt,
        ageDays,
        mechanic: mechanicName(ticket) || 'Не назначен',
        unassigned,
        reason: text(ticket?.reason || ticket?.description) || 'Причина не указана',
        description: text(ticket?.description),
        waitingParts,
        currentRental: normalizedCurrentRental,
        nextRental: normalizedNextRental,
        score,
        scoreReasons: scoreReasons.slice(0, 5),
        group,
        groupLabel: groupLabel(group),
        redFlags: [
          currentRental ? 'Техника в аренде при открытой заявке' : '',
          ageDays >= 7 ? 'Техника в сервисе 7+ дней' : '',
          unassigned ? 'Заявка без механика' : '',
          waitingParts ? 'Ожидание запчастей' : '',
          repeatedFailure ? 'Повторная поломка' : '',
          nextRentalDays !== null && nextRentalDays <= 7 ? 'Ближайшая аренда, техника не готова' : '',
        ].filter(Boolean),
        revenueRisk: canViewFinance && dailyRisk > 0
          ? { amount: dailyRisk, label: 'Оценка риска выручки в день' }
          : null,
      };
    })
    .sort((a, b) => b.score - a.score || b.ageDays - a.ageDays || a.createdAt.localeCompare(b.createdAt));

  const totalAge = rows.reduce((sum, item) => sum + item.ageDays, 0);
  const groups = ['critical', 'high', 'waiting_parts', 'unassigned', 'long_running', 'other'].map(group => ({
    key: group,
    label: groupLabel(group),
    items: rows.filter(item => item.group === group),
  }));

  return {
    rows,
    groups,
    metrics: {
      totalOpen: rows.length,
      critical: rows.filter(item => item.group === 'critical').length,
      unassigned: rows.filter(item => item.unassigned).length,
      waitingParts: rows.filter(item => item.waitingParts).length,
      equipmentInService: rows.filter(item => item.equipmentStatus === 'in_service').length,
      averageAgeDays: rows.length ? Math.round(totalAge / rows.length) : 0,
      olderThan7Days: rows.filter(item => item.ageDays >= 7).length,
    },
  };
}

export const __serviceQueueTestUtils = {
  dateKey,
  daysBetween,
  matchesEquipmentBySafeKey,
  normalizePriority,
  normalizeStatus,
};
