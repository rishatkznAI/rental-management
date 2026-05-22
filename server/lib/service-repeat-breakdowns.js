const FINISHED_STATUSES = new Set(['closed', 'done', 'completed', 'finished']);
const OPEN_REPEAT_STATUSES = new Set(['new', 'open', 'created', 'in_progress', 'waiting_parts', 'needs_revision']);
const WINDOWS = [7, 14, 30];
const DAY_MS = 24 * 60 * 60 * 1000;
const QUALITY_RISK_ORDER = { critical: 0, high: 1, medium: 2, low: 3, unknown: 4 };

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

function mechanicId(ticket) {
  return text(ticket?.assignedMechanicId || ticket?.mechanicId || ticket?.assignedUserId) || 'unassigned';
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

function safeItemLabel(item, keys, fallback = 'Не указано') {
  for (const key of keys) {
    const value = text(item?.[key]);
    if (value) return value;
  }
  return fallback;
}

function ticketWorkLabels(ticket, workItemsByTicket) {
  const ticketWorks = workItemsByTicket.get(text(ticket?.id)) || [];
  const resultWorks = Array.isArray(ticket?.resultData?.worksPerformed) ? ticket.resultData.worksPerformed : [];
  const embeddedWorks = Array.isArray(ticket?.workLog) ? ticket.workLog : [];
  return [
    ...ticketWorks.map(item => safeItemLabel(item, ['nameSnapshot', 'workNameSnapshot', 'categorySnapshot', 'workId', 'workCatalogId'])),
    ...resultWorks.map(item => safeItemLabel(item, ['name', 'catalogId'])),
    ...embeddedWorks.map(item => safeItemLabel(item, ['text', 'type'])),
  ].filter(label => label && label !== 'Не указано');
}

function ticketPartLabels(ticket, partItemsByTicket) {
  const ticketParts = partItemsByTicket.get(text(ticket?.id)) || [];
  const embeddedParts = Array.isArray(ticket?.parts) ? ticket.parts : [];
  return [
    ...ticketParts.map(item => safeItemLabel(item, ['nameSnapshot', 'articleSnapshot', 'partId'])),
    ...embeddedParts.map(item => safeItemLabel(item, ['name', 'sku', 'catalogId'])),
  ].filter(label => label && label !== 'Не указано');
}

function ticketCostEstimate(ticket, workItemsByTicket, partItemsByTicket) {
  const ticketWorks = workItemsByTicket.get(text(ticket?.id)) || [];
  const ticketParts = partItemsByTicket.get(text(ticket?.id)) || [];
  const workAmount = ticketWorks.reduce((sum, item) => {
    const quantity = Number(item?.quantity || 1);
    const normHours = Number(item?.normHoursSnapshot || item?.hoursSnapshot || 0);
    const rate = Number(item?.ratePerHourSnapshot || item?.priceSnapshot || 0);
    const amount = Number(item?.amountSnapshot || item?.totalSnapshot || 0);
    if (Number.isFinite(amount) && amount > 0) return sum + amount;
    if (Number.isFinite(quantity) && Number.isFinite(normHours) && Number.isFinite(rate)) return sum + quantity * normHours * rate;
    return sum;
  }, 0);
  const partAmount = ticketParts.reduce((sum, item) => {
    const quantity = Number(item?.quantity || 1);
    const price = Number(item?.priceSnapshot || item?.defaultPrice || 0);
    if (!Number.isFinite(quantity) || !Number.isFinite(price)) return sum;
    return sum + quantity * price;
  }, 0);
  return Math.round((workAmount + partAmount) * 100) / 100;
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

function strongestRisk(values) {
  return values
    .filter(Boolean)
    .sort((left, right) => (QUALITY_RISK_ORDER[left] ?? 99) - (QUALITY_RISK_ORDER[right] ?? 99))[0] || 'unknown';
}

function qualityReasonForEquipment({ repeatCount, repeatWithin7, repeatWithin30, samePatternCount, lowConfidenceCount }) {
  if (repeatWithin30 >= 3) return '3+ повтора по одной технике за 30 дней';
  if (repeatWithin7 >= 2) return '2+ быстрых повтора за 7 дней';
  if (samePatternCount > 0) return 'Повторяется причина, работа или запчасть';
  if (repeatCount >= 2) return 'Несколько повторных обращений';
  if (lowConfidenceCount > 0) return 'Есть повтор без ясной причины';
  return 'Единичный слабый сигнал';
}

function qualityRecommendedAction(risk, { samePatternCount = 0, repeatWithin7 = 0, lowConfidenceCount = 0 } = {}) {
  if (risk === 'critical') return 'Провести разбор ремонта и назначить старшего механика на повтор';
  if (samePatternCount > 0) return 'Проверить качество диагностики, работу и запчасть';
  if (repeatWithin7 > 0) return 'Проверить качество диагностики после закрытия ремонта';
  if (lowConfidenceCount > 0 || risk === 'unknown') return 'Проверить вручную';
  if (risk === 'high') return 'Провести разбор ремонта';
  if (risk === 'medium') return 'Проверить инструкцию или регламент';
  return 'Наблюдать без обвинительной оценки';
}

function calculateEquipmentQualityRisk({ repeatCount, repeatWithin7, repeatWithin30, samePatternCount, lowConfidenceCount }) {
  if (!repeatCount) return 'unknown';
  if (repeatWithin30 >= 3 || repeatWithin7 >= 2) return 'critical';
  if (repeatWithin7 >= 1 && samePatternCount > 0) return 'critical';
  if (repeatWithin30 >= 2 || samePatternCount > 0) return 'high';
  if (repeatCount >= 2 || lowConfidenceCount > 0) return 'medium';
  return 'low';
}

function riskFromCounts({ repeatCount, critical = 0, high = 0, medium = 0 }) {
  if (critical > 0 || repeatCount >= 3) return 'critical';
  if (high > 0 || repeatCount >= 2) return 'high';
  if (medium > 0 || repeatCount === 1) return 'medium';
  return 'low';
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

function buildQualityGroupRows(items, type) {
  const map = new Map();
  for (const item of items) {
    const labels = type === 'works' ? item.workNames : type === 'parts' ? item.partNames : [item.scenario];
    const uniqueLabels = [...new Set((labels || []).map(label => text(label)).filter(Boolean))];
    for (const label of uniqueLabels) {
      const key = lower(label) || 'unknown';
      if (!map.has(key)) {
        map.set(key, {
          [type === 'scenarios' ? 'scenario' : type === 'works' ? 'workName' : 'partName']: label,
          repeatCount: 0,
          affectedEquipmentIds: new Set(),
          critical: 0,
          high: 0,
          medium: 0,
          low: 0,
        });
      }
      const row = map.get(key);
      row.repeatCount += 1;
      row.affectedEquipmentIds.add(item.equipmentId);
      row[item.repeatSeverity] = (row[item.repeatSeverity] || 0) + 1;
    }
  }
  return [...map.values()]
    .map(row => ({
      ...row,
      affectedEquipmentCount: row.affectedEquipmentIds.size,
      affectedEquipmentIds: undefined,
      riskLevel: riskFromCounts(row),
    }))
    .map(row => {
      const { affectedEquipmentIds, ...safeRow } = row;
      return safeRow;
    })
    .sort((left, right) => (
      (QUALITY_RISK_ORDER[left.riskLevel] ?? 99) - (QUALITY_RISK_ORDER[right.riskLevel] ?? 99)
      || right.repeatCount - left.repeatCount
    ));
}

function buildQualityRecommendations({ equipmentRows, mechanicRows, scenarioRows, workRows, partRows }) {
  const recommendations = [];
  const criticalEquipment = equipmentRows.filter(item => item.qualityRisk === 'critical');
  const repeatedParts = partRows.filter(item => ['critical', 'high'].includes(item.riskLevel));
  const repeatedWorks = workRows.filter(item => ['critical', 'high'].includes(item.riskLevel));
  const mechanicReview = mechanicRows.filter(item => ['critical', 'high'].includes(item.qualityRisk));
  const topScenario = scenarioRows[0];

  if (criticalEquipment.length > 0) recommendations.push('Провести разбор ремонта по критичной технике');
  if (topScenario) recommendations.push(`Проверить качество диагностики: ${topScenario.scenario}`);
  if (repeatedParts.length > 0) recommendations.push('Проверить повторяющиеся запчасти и поставку');
  if (repeatedWorks.length > 0) recommendations.push('Проверить инструкцию или регламент по повторяющимся работам');
  if (mechanicReview.length > 0) recommendations.push('Назначить старшего механика на повторные случаи');
  if (recommendations.length === 0) recommendations.push('Проверить вручную при появлении новых повторов');
  return recommendations.slice(0, 6);
}

function buildServiceRepairQualityView(input = {}) {
  const base = buildServiceRepeatBreakdowns(input);
  const tickets = Array.isArray(input.tickets) ? input.tickets : [];
  const workItems = Array.isArray(input.workItems) ? input.workItems : [];
  const partItems = Array.isArray(input.partItems) ? input.partItems : [];
  const mechanics = Array.isArray(input.mechanics) ? input.mechanics : [];
  const mechanicsById = new Map(mechanics.map(item => [text(item?.id || item?.userId), item]).filter(([id]) => id));
  const ticketsById = new Map(tickets.map(ticket => [text(ticket?.id), ticket]).filter(([id]) => id));
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

  const enrichedItems = base.items.map(item => {
    const previousTicket = ticketsById.get(item.previousTicketId) || {};
    const repeatTicket = ticketsById.get(item.repeatTicketId) || {};
    const workNames = [...new Set([
      ...ticketWorkLabels(previousTicket, workItemsByTicket),
      ...ticketWorkLabels(repeatTicket, workItemsByTicket),
    ])];
    const partNames = [...new Set([
      ...ticketPartLabels(previousTicket, partItemsByTicket),
      ...ticketPartLabels(repeatTicket, partItemsByTicket),
    ])];
    return {
      ...item,
      mechanicId: mechanicId(previousTicket),
      workNames,
      partNames,
      samePattern: item.reason.includes('Похожая работа/узел') || item.confidence !== 'low',
      repeatCostEstimate: ticketCostEstimate(repeatTicket, workItemsByTicket, partItemsByTicket),
    };
  });

  const equipmentMap = new Map();
  for (const item of enrichedItems) {
    const key = item.equipmentId || 'unknown';
    if (!equipmentMap.has(key)) {
      equipmentMap.set(key, {
        equipmentId: key,
        equipmentLabel: item.equipmentLabel,
        inventoryNumber: item.inventoryNumber,
        repeatCount: 0,
        repeatWithin7: 0,
        repeatWithin14: 0,
        repeatWithin30: 0,
        lastRepeatDate: '',
        lostDaysEstimate: 0,
        lostAmountEstimate: 0,
        samePatternCount: 0,
        lowConfidenceCount: 0,
        links: item.links,
      });
    }
    const row = equipmentMap.get(key);
    row.repeatCount += 1;
    if (item.repeatWindow <= 7) row.repeatWithin7 += 1;
    if (item.repeatWindow <= 14) row.repeatWithin14 += 1;
    if (item.repeatWindow <= 30) row.repeatWithin30 += 1;
    if (!row.lastRepeatDate || String(item.repeatCreatedAt).localeCompare(row.lastRepeatDate) > 0) row.lastRepeatDate = item.repeatCreatedAt;
    row.lostDaysEstimate += Math.max(1, Number(item.daysBetween) || 1);
    row.lostAmountEstimate = Math.round((row.lostAmountEstimate + item.repeatCostEstimate) * 100) / 100;
    if (item.samePattern) row.samePatternCount += 1;
    if (item.confidence === 'low') row.lowConfidenceCount += 1;
  }

  const equipmentRows = [...equipmentMap.values()].map(row => {
    const qualityRisk = calculateEquipmentQualityRisk(row);
    return {
      equipmentId: row.equipmentId,
      equipmentLabel: row.equipmentLabel,
      inventoryNumber: row.inventoryNumber,
      repeatCount: row.repeatCount,
      repeatWithin7: row.repeatWithin7,
      repeatWithin14: row.repeatWithin14,
      repeatWithin30: row.repeatWithin30,
      lastRepeatDate: row.lastRepeatDate,
      qualityRisk,
      qualityReason: qualityReasonForEquipment(row),
      recommendedAction: qualityRecommendedAction(qualityRisk, row),
      lostDaysEstimate: row.lostDaysEstimate,
      lostAmountEstimate: row.lostAmountEstimate,
      links: row.links,
    };
  }).sort((left, right) => (
    (QUALITY_RISK_ORDER[left.qualityRisk] ?? 99) - (QUALITY_RISK_ORDER[right.qualityRisk] ?? 99)
    || right.repeatCount - left.repeatCount
  ));

  const closedByMechanic = new Map();
  for (const ticket of tickets) {
    if (!isFinishedTicket(ticket)) continue;
    const id = mechanicId(ticket);
    const current = closedByMechanic.get(id) || 0;
    closedByMechanic.set(id, current + 1);
  }

  const mechanicMap = new Map();
  for (const item of enrichedItems) {
    const key = item.mechanicId || 'unassigned';
    if (!mechanicMap.has(key)) {
      const mechanic = mechanicsById.get(key);
      mechanicMap.set(key, {
        mechanicId: key,
        mechanicName: text(mechanic?.name) || item.mechanicName || 'Не назначен',
        totalClosedTickets: closedByMechanic.get(key) || 0,
        repeatRelatedTickets: 0,
        highRiskRepeats: 0,
        risks: [],
      });
    }
    const row = mechanicMap.get(key);
    row.repeatRelatedTickets += 1;
    if (['critical', 'high'].includes(item.repeatSeverity)) row.highRiskRepeats += 1;
    row.risks.push(item.repeatSeverity);
  }

  const mechanicRows = [...mechanicMap.values()].map(row => {
    const repeatRate = row.totalClosedTickets > 0
      ? Number((row.repeatRelatedTickets / row.totalClosedTickets).toFixed(2))
      : 0;
    const qualityRisk = strongestRisk(row.risks);
    return {
      mechanicId: row.mechanicId,
      mechanicName: row.mechanicName,
      totalClosedTickets: row.totalClosedTickets,
      repeatRelatedTickets: row.repeatRelatedTickets,
      repeatRate,
      highRiskRepeats: row.highRiskRepeats,
      qualityRisk,
      note: row.repeatRelatedTickets > 0
        ? 'Зона для разбора, не персональная оценка вины'
        : 'Данных для вывода недостаточно',
    };
  }).sort((left, right) => (
    (QUALITY_RISK_ORDER[left.qualityRisk] ?? 99) - (QUALITY_RISK_ORDER[right.qualityRisk] ?? 99)
    || right.repeatRelatedTickets - left.repeatRelatedTickets
  ));

  const scenarios = buildQualityGroupRows(enrichedItems, 'scenarios');
  const works = buildQualityGroupRows(enrichedItems, 'works');
  const parts = buildQualityGroupRows(enrichedItems, 'parts');
  const recommendations = buildQualityRecommendations({
    equipmentRows,
    mechanicRows,
    scenarioRows: scenarios,
    workRows: works,
    partRows: parts,
  });
  const summary = {
    totalRepeats: enrichedItems.length,
    totalRepeatCases: enrichedItems.length,
    critical: equipmentRows.filter(item => item.qualityRisk === 'critical').length,
    high: equipmentRows.filter(item => item.qualityRisk === 'high').length,
    medium: equipmentRows.filter(item => item.qualityRisk === 'medium').length,
    low: equipmentRows.filter(item => item.qualityRisk === 'low').length,
    affectedEquipment: equipmentRows.length,
    affectedMechanics: mechanicRows.filter(item => item.mechanicId !== 'unassigned').length,
    repeatWithin7: enrichedItems.filter(item => item.repeatWindow <= 7).length,
    repeatWithin14: enrichedItems.filter(item => item.repeatWindow <= 14).length,
    repeatWithin30: enrichedItems.filter(item => item.repeatWindow <= 30).length,
    lostDaysEstimate: equipmentRows.reduce((sum, item) => sum + (Number(item.lostDaysEstimate) || 0), 0),
    lostAmountEstimate: Math.round(equipmentRows.reduce((sum, item) => sum + (Number(item.lostAmountEstimate) || 0), 0) * 100) / 100,
    topScenario: scenarios[0]?.scenario || '',
  };

  return {
    ok: true,
    summary,
    equipment: equipmentRows,
    mechanics: mechanicRows,
    scenarios,
    works,
    parts,
    recommendations,
  };
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
  buildServiceRepairQualityView,
  isFinishedTicket,
  serviceCreatedAt,
  serviceFinishedAt,
};
