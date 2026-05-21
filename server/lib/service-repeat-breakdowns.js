const FINISHED_STATUSES = new Set(['closed', 'done', 'completed', 'finished']);
const OPEN_REPEAT_STATUSES = new Set(['new', 'open', 'created', 'in_progress', 'waiting_parts', 'needs_revision']);
const WINDOWS = [7, 14, 30];
const DAY_MS = 24 * 60 * 60 * 1000;

function text(value) {
  if (value === null || value === undefined) return '';
  const normalized = String(value).trim();
  if (!normalized || normalized === '[object Object]' || normalized === 'undefined' || normalized === 'null') return '';
  return normalized;
}

function lower(value) {
  return text(value).toLowerCase().replace(/ё/g, 'е').replace(/[\s-]+/g, '_');
}

function validDate(value) {
  const raw = text(value);
  if (!raw) return '';
  return Number.isFinite(Date.parse(raw)) ? raw : '';
}

function timestamp(value) {
  const date = validDate(value);
  return date ? Date.parse(date) : NaN;
}

function serviceCreatedAt(ticket) {
  return validDate(
    ticket?.createdAt
      || ticket?.created_at
      || ticket?.createdDate
      || ticket?.created
      || ticket?.date
      || ticket?.requestedAt
      || ticket?.openedAt
      || ticket?.updatedAt
      || ticket?.updated_at
      || ticket?.modifiedAt,
  );
}

function serviceFinishedAt(ticket) {
  return validDate(
    ticket?.closedAt
      || ticket?.completedAt
      || ticket?.finishedAt
      || ticket?.resolvedAt
      || ticket?.resultData?.completedAt
      || ticket?.resultData?.finishedAt
      || ticket?.updatedAt
      || ticket?.updated_at,
  );
}

function isFinishedTicket(ticket) {
  const status = lower(ticket?.status);
  if (FINISHED_STATUSES.has(status)) return Boolean(serviceFinishedAt(ticket) || serviceCreatedAt(ticket));
  return status === 'ready' && Boolean(serviceFinishedAt(ticket));
}

function serviceKind(ticket) {
  const explicit = lower(ticket?.serviceKind || ticket?.scenario || ticket?.type);
  if (['repair', 'to', 'chto', 'pto'].includes(explicit)) return explicit;
  const reason = lower(ticket?.reason);
  if (reason === 'то') return 'to';
  if (reason === 'что') return 'chto';
  if (reason === 'пто') return 'pto';
  if (reason.includes('диагност')) return 'diagnostics';
  if (reason.includes('рекламац') || lower(ticket?.type).includes('warranty')) return 'warranty';
  return 'repair';
}

function scenarioLabel(kind) {
  return {
    repair: 'Ремонт',
    to: 'ТО',
    chto: 'ЧТО',
    pto: 'ПТО',
    diagnostics: 'Диагностика',
    warranty: 'Рекламация',
  }[kind] || 'Ремонт';
}

function equipmentLabel(ticket, equipment) {
  return text(ticket?.equipment)
    || [text(equipment?.manufacturer), text(equipment?.model)].filter(Boolean).join(' ')
    || text(equipment?.name)
    || text(ticket?.equipmentId)
    || 'Техника';
}

function modelLabel(ticket, equipment) {
  return text(ticket?.model)
    || text(ticket?.modelSnapshot)
    || [text(equipment?.manufacturer), text(equipment?.model)].filter(Boolean).join(' ')
    || text(equipment?.model)
    || 'Модель не указана';
}

function ticketNumber(ticket) {
  return text(ticket?.number || ticket?.ticketNumber || ticket?.id) || 'Заявка';
}

function mechanicName(ticket, mechanicsById) {
  const mechanic = mechanicsById.get(text(ticket?.assignedMechanicId || ticket?.mechanicId || ticket?.assignedUserId));
  return text(mechanic?.name)
    || text(ticket?.assignedMechanicName)
    || text(ticket?.mechanicName)
    || text(ticket?.assignedTo)
    || 'Не назначен';
}

function normalizedSet(values) {
  return new Set((Array.isArray(values) ? values : [])
    .map(lower)
    .filter(Boolean));
}

function hasIntersection(left, right) {
  for (const value of left) {
    if (right.has(value)) return true;
  }
  return false;
}

function buildTicketSignals(ticket, workItemsByTicket, partItemsByTicket) {
  const ticketWorks = workItemsByTicket.get(text(ticket?.id)) || [];
  const ticketParts = partItemsByTicket.get(text(ticket?.id)) || [];
  const resultWorks = Array.isArray(ticket?.resultData?.worksPerformed) ? ticket.resultData.worksPerformed : [];
  const embeddedWorks = Array.isArray(ticket?.workLog) ? ticket.workLog : [];
  const embeddedParts = Array.isArray(ticket?.parts) ? ticket.parts : [];
  return {
    scenario: serviceKind(ticket),
    reason: lower(ticket?.reason || ticket?.description || ticket?.summary),
    works: normalizedSet([
      ...ticketWorks.flatMap(item => [item?.workId, item?.workCatalogId, item?.nameSnapshot, item?.workNameSnapshot, item?.categorySnapshot]),
      ...resultWorks.flatMap(item => [item?.catalogId, item?.name]),
      ...embeddedWorks.flatMap(item => [item?.text, item?.type]),
    ]),
    parts: normalizedSet([
      ...ticketParts.flatMap(item => [item?.partId, item?.nameSnapshot, item?.articleSnapshot]),
      ...embeddedParts.flatMap(item => [item?.catalogId, item?.name, item?.sku]),
    ]),
  };
}

function repeatWindow(daysBetween) {
  return WINDOWS.find(window => daysBetween <= window) || null;
}

function calculateSeverity({ daysBetween, sameScenario, sameReason, sameWorkOrPart, repeatTicket, equipment }) {
  const status = lower(repeatTicket?.status);
  const priority = lower(repeatTicket?.priority);
  const equipmentInService = lower(equipment?.status) === 'in_service' || OPEN_REPEAT_STATUSES.has(status);
  let score = 0;
  if (daysBetween <= 3) score += 3;
  else if (daysBetween <= 7) score += 2;
  else if (daysBetween <= 14) score += 1;
  if (sameScenario) score += 1;
  if (sameReason) score += 1;
  if (sameWorkOrPart) score += 2;
  if (equipmentInService) score += 1;
  if (priority === 'critical') score += 2;
  if (priority === 'high') score += 1;
  if (score >= 7) return 'critical';
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}

function calculateConfidence({ previousTicket, repeatTicket, sameScenario, sameReason, sameWorkOrPart }) {
  const hasCore = Boolean(text(previousTicket?.equipmentId) && serviceFinishedAt(previousTicket) && serviceCreatedAt(repeatTicket));
  if (!hasCore) return 'low';
  if (sameWorkOrPart || (sameScenario && sameReason)) return 'high';
  if (sameReason) return 'medium';
  return 'low';
}

function buildReasons({ sameScenario, sameReason, sameWorkOrPart, daysBetween }) {
  const reasons = ['Повторная заявка после ремонта'];
  if (sameScenario || sameReason) reasons.push('Похожий сценарий');
  if (sameWorkOrPart) reasons.push('Похожая работа/узел');
  if (daysBetween <= 3) reasons.push('Быстрый повтор после закрытия');
  return reasons;
}

function recommendedAction({ severity, sameWorkOrPart, sameScenario }) {
  if (severity === 'critical') return 'Проверить качество ремонта';
  if (sameWorkOrPart) return 'Провести повторную диагностику';
  if (sameScenario) return 'Разобрать работу механика';
  return 'Проверить модель на системную проблему';
}

function groupRows(items, keyFn, labelFn) {
  const map = new Map();
  for (const item of items) {
    const key = text(keyFn(item)) || 'unknown';
    if (!map.has(key)) {
      map.set(key, {
        id: key,
        label: text(labelFn(item)) || 'Не указано',
        count: 0,
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      });
    }
    const row = map.get(key);
    row.count += 1;
    row[item.repeatSeverity] = (row[item.repeatSeverity] || 0) + 1;
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.label.localeCompare(b.label, 'ru'));
}

function buildServiceRepeatBreakdowns(input = {}) {
  const tickets = Array.isArray(input.tickets) ? input.tickets : [];
  const equipment = Array.isArray(input.equipment) ? input.equipment : [];
  const mechanics = Array.isArray(input.mechanics) ? input.mechanics : [];
  const workItems = Array.isArray(input.workItems) ? input.workItems : [];
  const partItems = Array.isArray(input.partItems) ? input.partItems : [];
  const equipmentById = new Map(equipment.map(item => [text(item?.id), item]).filter(([id]) => id));
  const mechanicsById = new Map(mechanics.map(item => [text(item?.id || item?.userId), item]).filter(([id]) => id));
  const workItemsByTicket = new Map();
  const partItemsByTicket = new Map();

  for (const item of workItems) {
    const ticketId = text(item?.serviceTicketId || item?.repairId);
    if (!ticketId) continue;
    const group = workItemsByTicket.get(ticketId) || [];
    group.push(item);
    workItemsByTicket.set(ticketId, group);
  }
  for (const item of partItems) {
    const ticketId = text(item?.serviceTicketId || item?.repairId);
    if (!ticketId) continue;
    const group = partItemsByTicket.get(ticketId) || [];
    group.push(item);
    partItemsByTicket.set(ticketId, group);
  }

  const byEquipment = new Map();
  for (const ticket of tickets) {
    const equipmentId = text(ticket?.equipmentId);
    const createdAt = serviceCreatedAt(ticket);
    if (!equipmentId || !createdAt) continue;
    const group = byEquipment.get(equipmentId) || [];
    group.push(ticket);
    byEquipment.set(equipmentId, group);
  }

  const items = [];
  for (const [equipmentId, group] of byEquipment.entries()) {
    const sorted = group.sort((a, b) => timestamp(serviceCreatedAt(a)) - timestamp(serviceCreatedAt(b)));
    for (let repeatIndex = 0; repeatIndex < sorted.length; repeatIndex += 1) {
      const repeatTicket = sorted[repeatIndex];
      const repeatCreatedAt = serviceCreatedAt(repeatTicket);
      const repeatTs = timestamp(repeatCreatedAt);
      if (!Number.isFinite(repeatTs)) continue;
      for (let previousIndex = 0; previousIndex < repeatIndex; previousIndex += 1) {
        const previousTicket = sorted[previousIndex];
        if (!isFinishedTicket(previousTicket)) continue;
        const previousClosedAt = serviceFinishedAt(previousTicket) || serviceCreatedAt(previousTicket);
        const previousTs = timestamp(previousClosedAt);
        if (!Number.isFinite(previousTs) || repeatTs <= previousTs) continue;
        const daysBetween = Math.ceil((repeatTs - previousTs) / DAY_MS);
        const window = repeatWindow(daysBetween);
        if (!window) continue;

        const equipmentRow = equipmentById.get(equipmentId);
        const previousSignals = buildTicketSignals(previousTicket, workItemsByTicket, partItemsByTicket);
        const repeatSignals = buildTicketSignals(repeatTicket, workItemsByTicket, partItemsByTicket);
        const sameScenario = previousSignals.scenario === repeatSignals.scenario;
        const sameReason = Boolean(previousSignals.reason && repeatSignals.reason && previousSignals.reason === repeatSignals.reason);
        const sameWorkOrPart = hasIntersection(previousSignals.works, repeatSignals.works) || hasIntersection(previousSignals.parts, repeatSignals.parts);
        const repeatSeverity = calculateSeverity({ daysBetween, sameScenario, sameReason, sameWorkOrPart, repeatTicket, equipment: equipmentRow });
        const reasons = buildReasons({ sameScenario, sameReason, sameWorkOrPart, daysBetween });
        const scenario = scenarioLabel(repeatSignals.scenario);
        const row = {
          equipmentId,
          equipmentLabel: equipmentLabel(repeatTicket, equipmentRow),
          model: modelLabel(repeatTicket, equipmentRow),
          inventoryNumber: text(repeatTicket?.inventoryNumber || equipmentRow?.inventoryNumber || equipmentRow?.inv) || '—',
          previousTicketId: text(previousTicket?.id),
          previousTicketNumber: ticketNumber(previousTicket),
          previousClosedAt,
          repeatTicketId: text(repeatTicket?.id),
          repeatTicketNumber: ticketNumber(repeatTicket),
          repeatCreatedAt,
          daysBetween,
          repeatWindow: window,
          repeatSeverity,
          confidence: calculateConfidence({ previousTicket, repeatTicket, sameScenario, sameReason, sameWorkOrPart }),
          mechanicName: mechanicName(previousTicket, mechanicsById),
          scenario,
          reason: reasons.join('; '),
          recommendedAction: recommendedAction({ severity: repeatSeverity, sameWorkOrPart, sameScenario }),
          links: {
            equipment: equipmentId ? `/equipment/${encodeURIComponent(equipmentId)}` : '',
            previousServiceTicket: text(previousTicket?.id) ? `/service/${encodeURIComponent(text(previousTicket.id))}` : '',
            repeatServiceTicket: text(repeatTicket?.id) ? `/service/${encodeURIComponent(text(repeatTicket.id))}` : '',
          },
        };
        items.push(row);
      }
    }
  }

  items.sort((a, b) => {
    const severityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
    return severityOrder[a.repeatSeverity] - severityOrder[b.repeatSeverity]
      || a.daysBetween - b.daysBetween
      || String(b.repeatCreatedAt).localeCompare(String(a.repeatCreatedAt));
  });

  const groups = {
    byEquipment: groupRows(items, item => item.equipmentId, item => item.equipmentLabel),
    byModel: groupRows(items, item => item.model, item => item.model),
    byMechanic: groupRows(items, item => item.mechanicName, item => item.mechanicName),
    byScenario: groupRows(items, item => item.scenario, item => item.scenario),
  };

  const summary = {
    totalRepeats: items.length,
    repeatWithin7: items.filter(item => item.repeatWindow <= 7).length,
    repeatWithin14: items.filter(item => item.repeatWindow <= 14).length,
    repeatWithin30: items.filter(item => item.repeatWindow <= 30).length,
    critical: items.filter(item => item.repeatSeverity === 'critical').length,
    high: items.filter(item => item.repeatSeverity === 'high').length,
    medium: items.filter(item => item.repeatSeverity === 'medium').length,
    low: items.filter(item => item.repeatSeverity === 'low').length,
    topEquipmentCount: groups.byEquipment.length,
    topMechanicCount: groups.byMechanic.length,
    topModelCount: groups.byModel.length,
  };

  return { ok: true, summary, items, groups };
}

module.exports = {
  buildServiceRepeatBreakdowns,
  isFinishedTicket,
  serviceCreatedAt,
  serviceFinishedAt,
};
