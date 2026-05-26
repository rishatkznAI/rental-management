const { calculateRentalBilling, getEffectivePaidAmount } = require('./finance-core');
const { isMechanicRole, normalizeRole } = require('./role-groups');

const EXAMPLE_LIMIT = 20;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

const ACTIVE_RENTAL_STATUSES = new Set(['active', 'created', 'confirmed', 'return_planned']);
const CLOSED_RENTAL_STATUSES = new Set(['returned', 'closed', 'cancelled', 'canceled', 'complete', 'completed']);
const OPEN_SERVICE_STATUSES = new Set(['open', 'new', 'created', 'active', 'in_progress', 'waiting_parts', 'assigned']);
const CLOSED_SERVICE_STATUSES = new Set(['ready', 'closed', 'done', 'completed', 'complete']);
const ACTIVE_DELIVERY_STATUSES = new Set(['new', 'created', 'active', 'sent', 'accepted', 'assigned', 'in_progress', 'planned']);
const TERMINAL_DELIVERY_STATUSES = new Set(['completed', 'complete', 'cancelled', 'canceled']);
const KNOWN_ROLES = new Set([
  'Администратор',
  'Офис-менеджер',
  'Менеджер по аренде',
  'Менеджер по продажам',
  'Механик',
  'Младший стационарный механик',
  'Выездной механик',
  'Старший стационарный механик',
  'Механик по гарантии',
  'Бригадир',
  'Перевозчик',
  'Инвестор',
  'Руководитель',
]);

function asArray(value) {
  return Array.isArray(value) ? value.filter(item => item && typeof item === 'object') : [];
}

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function idOf(record) {
  return text(record?.id);
}

function dateKey(value) {
  return text(value).slice(0, 10);
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function isPastDate(value, today) {
  const key = dateKey(value);
  return Boolean(key && key < today);
}

function daysBeforeToday(value, today) {
  const key = dateKey(value);
  if (!key || key >= today) return 0;
  return Math.floor((new Date(today).getTime() - new Date(key).getTime()) / MS_PER_DAY);
}

function compactObject(input) {
  return Object.fromEntries(Object.entries(input).filter(([, value]) => value !== undefined && value !== null && value !== ''));
}

function labelFor(record) {
  return text(
    record?.label ||
    record?.name ||
    record?.title ||
    record?.number ||
    record?.documentNumber ||
    record?.inventoryNumber ||
    record?.equipmentInv ||
    record?.model ||
    record?.client ||
    record?.clientName,
  );
}

function sanitizeExample(input) {
  return compactObject({
    id: text(input.id),
    entity: text(input.entity),
    label: text(input.label),
    status: text(input.status),
    relatedId: text(input.relatedId),
  });
}

function exampleFrom(record, entity, relatedId = '') {
  return sanitizeExample({
    id: idOf(record) || text(record?.paymentId) || text(record?.rentalId) || text(record?.equipmentId),
    entity,
    label: labelFor(record),
    status: record?.status,
    relatedId,
  });
}

function makeIssue(severity, code, title, records, options = {}) {
  const list = asArray(records);
  return {
    severity,
    code,
    title,
    count: list.length,
    certainty: options.certainty || 'confirmed',
    examples: list.slice(0, EXAMPLE_LIMIT).map(item => options.example ? options.example(item) : exampleFrom(item, options.entity || code)),
  };
}

function addIssue(domain, summary, issue) {
  if (!issue || issue.count <= 0) return;
  domain.issues.push(issue);
  const key = issue.severity.toLowerCase();
  summary[key] = (summary[key] || 0) + issue.count;
}

function buildIndex(list) {
  return new Map(asArray(list).map(item => [idOf(item), item]).filter(([id]) => id));
}

function getEquipmentId(record) {
  return text(record?.equipmentId || record?.equipment_id);
}

function getRentalLinkIds(gantt) {
  return [
    gantt?.rentalId,
    gantt?.sourceRentalId,
    gantt?.originalRentalId,
    gantt?.classicRentalId,
    gantt?.entityId,
  ].map(text).filter(Boolean);
}

function hasActiveStatus(record) {
  return ACTIVE_RENTAL_STATUSES.has(lower(record?.status || 'active'));
}

function hasClosedStatus(record) {
  return CLOSED_RENTAL_STATUSES.has(lower(record?.status));
}

function serviceEquipmentId(ticket) {
  return text(ticket?.equipmentId || ticket?.equipment_id || ticket?.machineId);
}

function serviceCreatedAt(ticket) {
  return dateKey(ticket?.createdAt || ticket?.date || ticket?.startDate || ticket?.reportedAt);
}

function serviceIdFromItem(item) {
  return text(item?.serviceId || item?.serviceTicketId || item?.repairId || item?.ticketId);
}

function getRepairItemsForService(ticket, workItems, partItems) {
  const id = idOf(ticket);
  const embedded = [
    ...asArray(ticket?.repairItems),
    ...asArray(ticket?.workItems),
    ...asArray(ticket?.parts),
  ];
  if (!id) return embedded;
  return [
    ...embedded,
    ...workItems.filter(item => serviceIdFromItem(item) === id),
    ...partItems.filter(item => serviceIdFromItem(item) === id),
  ];
}

function deliveryEquipmentIds(delivery) {
  return [
    delivery?.equipmentId,
    delivery?.equipment_id,
    delivery?.machineId,
    ...(Array.isArray(delivery?.equipmentIds) ? delivery.equipmentIds : []),
  ].map(text).filter(Boolean);
}

function deliveryDate(delivery) {
  return dateKey(delivery?.date || delivery?.deliveryDate || delivery?.plannedDate || delivery?.scheduledDate || delivery?.pickupDate);
}

function documentEquipmentIds(document) {
  return [
    document?.equipmentId,
    document?.equipment_id,
    ...(Array.isArray(document?.equipmentIds) ? document.equipmentIds : []),
  ].map(text).filter(Boolean);
}

function documentNumber(document) {
  return text(document?.number || document?.documentNumber || document?.invoiceNumber || document?.actNumber);
}

function documentType(document) {
  return lower(document?.type || document?.documentType || document?.kind);
}

function isRentalDocument(document) {
  const type = documentType(document);
  return ['rental', 'rent', 'act', 'invoice', 'contract', 'аренда', 'акт', 'счет', 'договор'].some(item => type.includes(item));
}

function paymentIdFromAllocation(allocation) {
  return text(allocation?.paymentId);
}

function allocationAmount(allocation) {
  return toNumber(allocation?.amount ?? allocation?.allocatedAmount);
}

function paidAmount(payment) {
  const effective = getEffectivePaidAmount(payment);
  return effective > 0 ? effective : Math.max(0, toNumber(payment?.amount));
}

function allocatedByPayment(allocations) {
  const result = new Map();
  for (const allocation of allocations) {
    const paymentId = paymentIdFromAllocation(allocation);
    if (!paymentId) continue;
    result.set(paymentId, (result.get(paymentId) || 0) + Math.max(0, allocationAmount(allocation)));
  }
  return result;
}

function rentalDebt(row, payments, allocationsByRentalId) {
  const billing = calculateRentalBilling(row);
  const amount = toNumber(row?.amount ?? row?.totalAmount ?? row?.price ?? billing.finalRentalAmount);
  const allocated = allocationsByRentalId.get(idOf(row)) || 0;
  const legacyPaid = payments
    .filter(payment => text(payment?.rentalId) === idOf(row))
    .reduce((sum, payment) => sum + paidAmount(payment), 0);
  const paid = allocated > 0 ? allocated : legacyPaid;
  return Math.max(0, amount - paid);
}

function overlaps(left, right) {
  const leftStart = dateKey(left?.startDate);
  const leftEnd = dateKey(left?.endDate || left?.plannedReturnDate || left?.returnDate);
  const rightStart = dateKey(right?.startDate);
  const rightEnd = dateKey(right?.endDate || right?.plannedReturnDate || right?.returnDate);
  if (!leftStart || !leftEnd || !rightStart || !rightEnd) return false;
  return leftStart <= rightEnd && rightStart <= leftEnd;
}

function safeCollectionCounts(collections) {
  return {
    equipment: asArray(collections.equipment).length,
    rentals: asArray(collections.rentals).length,
    gantt_rentals: asArray(collections.gantt_rentals).length,
    service: asArray(collections.service).length,
    deliveries: asArray(collections.deliveries).length,
    payments: asArray(collections.payments).length,
    documents: asArray(collections.documents).length,
    users: asArray(collections.users).length,
  };
}

function buildDataIntegrityDiagnostics(collections = {}, options = {}) {
  const today = options.today || new Date().toISOString().slice(0, 10);
  const equipment = asArray(collections.equipment);
  const rentals = asArray(collections.rentals);
  const ganttRentals = asArray(collections.gantt_rentals);
  const service = asArray(collections.service);
  const deliveries = asArray(collections.deliveries);
  const payments = asArray(collections.payments);
  const paymentAllocations = asArray(collections.payment_allocations);
  const documents = asArray(collections.documents);
  const users = asArray(collections.users);
  const owners = asArray(collections.owners);
  const mechanics = asArray(collections.mechanics);
  const carriers = asArray(collections.delivery_carriers);
  const botUsers = asArray(collections.bot_users);
  const botSessions = asArray(collections.bot_sessions);
  const botActivity = asArray(collections.bot_activity);
  const workItems = asArray(collections.repair_work_items);
  const partItems = asArray(collections.repair_part_items);

  const summary = { blocker: 0, high: 0, medium: 0, low: 0 };
  const domains = {
    equipment: { issues: [] },
    rentalsGantt: { issues: [] },
    service: { issues: [] },
    delivery: { issues: [] },
    finance: { issues: [] },
    documents: { issues: [] },
    usersBot: { issues: [] },
    references: { issues: [] },
  };

  const equipmentById = buildIndex(equipment);
  const rentalsById = buildIndex(rentals);
  const ganttById = buildIndex(ganttRentals);
  const documentsById = buildIndex(documents);
  const clientsById = buildIndex(asArray(collections.clients));
  const paymentsById = buildIndex(payments);
  const ownersById = buildIndex(owners);
  const mechanicsById = buildIndex(mechanics);
  const carriersById = buildIndex(carriers);
  const activeRentals = rentals.filter(hasActiveStatus);
  const activeGantt = ganttRentals.filter(hasActiveStatus);
  const activeRentalEquipmentIds = new Set(activeRentals.map(getEquipmentId).filter(Boolean));
  const openService = service.filter(ticket => OPEN_SERVICE_STATUSES.has(lower(ticket?.status || 'open')));
  const openServiceEquipmentIds = new Set(openService.map(serviceEquipmentId).filter(Boolean));

  addIssue(domains.equipment, summary, makeIssue('HIGH', 'equipment_rented_without_active_rental', 'Equipment is rented without active rental', equipment.filter(item => lower(item.status) === 'rented' && !activeRentalEquipmentIds.has(idOf(item))), { entity: 'equipment' }));
  addIssue(domains.equipment, summary, makeIssue('BLOCKER', 'equipment_available_with_active_rental', 'Equipment is available with active rental', equipment.filter(item => lower(item.status) === 'available' && activeRentalEquipmentIds.has(idOf(item))), { entity: 'equipment' }));
  addIssue(domains.equipment, summary, makeIssue('HIGH', 'equipment_in_service_without_open_service', 'Equipment is in service without open service ticket', equipment.filter(item => lower(item.status) === 'in_service' && !openServiceEquipmentIds.has(idOf(item))), { entity: 'equipment' }));
  addIssue(domains.equipment, summary, makeIssue('MEDIUM', 'equipment_broken_owner_reference', 'Equipment ownerId does not resolve to owner', equipment.filter(item => text(item.ownerId) && !ownersById.has(text(item.ownerId))), { entity: 'equipment', relatedId: 'ownerId' }));
  addIssue(domains.equipment, summary, makeIssue('MEDIUM', 'equipment_missing_identity_fields', 'Equipment misses critical identity fields', equipment.filter(item => !idOf(item) || (!text(item.inventoryNumber || item.equipmentInv || item.inv) && !text(item.serialNumber))), { entity: 'equipment' }));

  const inventoryGroups = new Map();
  for (const item of equipment) {
    const value = text(item.inventoryNumber || item.equipmentInv || item.inv);
    if (!value) continue;
    if (!inventoryGroups.has(value)) inventoryGroups.set(value, []);
    inventoryGroups.get(value).push(item);
  }
  const suspiciousInventory = [
    ...equipment.filter(item => text(item.inventoryNumber || item.equipmentInv || item.inv) === '0'),
    ...[...inventoryGroups.values()].filter(group => group.length > 1).flat(),
  ];
  addIssue(domains.equipment, summary, makeIssue('MEDIUM', 'equipment_duplicate_suspicious_inventory', 'Duplicate or suspicious inventory value', suspiciousInventory, { entity: 'equipment' }));

  const ganttRentalIds = new Map();
  for (const gantt of ganttRentals) {
    for (const rentalId of getRentalLinkIds(gantt)) {
      if (!ganttRentalIds.has(rentalId)) ganttRentalIds.set(rentalId, []);
      ganttRentalIds.get(rentalId).push(gantt);
    }
  }
  addIssue(domains.rentalsGantt, summary, makeIssue('HIGH', 'rental_without_gantt_row', 'Rental has no linked gantt row', rentals.filter(item => idOf(item) && !ganttRentalIds.has(idOf(item))), { entity: 'rental' }));
  addIssue(domains.rentalsGantt, summary, makeIssue('HIGH', 'gantt_without_rental', 'Gantt row has missing rental link', ganttRentals.filter(item => {
    const ids = getRentalLinkIds(item);
    return ids.length === 0 || !ids.some(id => rentalsById.has(id));
  }), { entity: 'gantt_rental' }));
  const duplicateGanttRows = [...ganttRentalIds.entries()].filter(([, rows]) => rows.length > 1).flatMap(([rentalId, rows]) => rows.map(row => ({ ...row, _relatedId: rentalId })));
  addIssue(domains.rentalsGantt, summary, makeIssue('HIGH', 'duplicate_gantt_rows_per_rental', 'Duplicate gantt rows per rental', duplicateGanttRows, { entity: 'gantt_rental', example: item => exampleFrom(item, 'gantt_rental', item._relatedId) }));
  addIssue(domains.rentalsGantt, summary, makeIssue('MEDIUM', 'rental_gantt_date_mismatch', 'Rental and gantt dates differ', ganttRentals.filter(gantt => {
    const rental = getRentalLinkIds(gantt).map(id => rentalsById.get(id)).find(Boolean);
    return rental && (dateKey(rental.startDate) !== dateKey(gantt.startDate) || dateKey(rental.plannedReturnDate || rental.endDate) !== dateKey(gantt.endDate || gantt.plannedReturnDate));
  }), { entity: 'gantt_rental' }));
  addIssue(domains.rentalsGantt, summary, makeIssue('MEDIUM', 'rental_gantt_status_mismatch', 'Rental and gantt statuses differ', ganttRentals.filter(gantt => {
    const rental = getRentalLinkIds(gantt).map(id => rentalsById.get(id)).find(Boolean);
    return rental && lower(rental.status) !== lower(gantt.status);
  }), { entity: 'gantt_rental' }));
  addIssue(domains.rentalsGantt, summary, makeIssue('HIGH', 'active_rental_ended_in_past', 'Active rental ended in past', rentals.filter(item => hasActiveStatus(item) && isPastDate(item.plannedReturnDate || item.endDate, today)), { entity: 'rental' }));
  addIssue(domains.rentalsGantt, summary, makeIssue('HIGH', 'active_gantt_ended_in_past', 'Active gantt row ended in past', ganttRentals.filter(item => hasActiveStatus(item) && isPastDate(item.endDate || item.plannedReturnDate, today)), { entity: 'gantt_rental' }));
  const overlapsByEquipment = [];
  for (let i = 0; i < activeGantt.length; i += 1) {
    for (let j = i + 1; j < activeGantt.length; j += 1) {
      if (getEquipmentId(activeGantt[i]) && getEquipmentId(activeGantt[i]) === getEquipmentId(activeGantt[j]) && overlaps(activeGantt[i], activeGantt[j])) {
        overlapsByEquipment.push({ ...activeGantt[i], _relatedId: idOf(activeGantt[j]) });
        overlapsByEquipment.push({ ...activeGantt[j], _relatedId: idOf(activeGantt[i]) });
      }
    }
  }
  addIssue(domains.rentalsGantt, summary, makeIssue('BLOCKER', 'active_gantt_overlap_by_equipment', 'Active gantt periods overlap by equipment', overlapsByEquipment, { entity: 'gantt_rental', example: item => exampleFrom(item, 'gantt_rental', item._relatedId) }));

  const allocationsByRentalId = new Map();
  for (const allocation of paymentAllocations) {
    const rentalId = text(allocation.rentalId);
    if (rentalId) allocationsByRentalId.set(rentalId, (allocationsByRentalId.get(rentalId) || 0) + Math.max(0, allocationAmount(allocation)));
  }
  const closedRowsWithDebt = ganttRentals.filter(row => hasClosedStatus(row) && rentalDebt(row, payments, allocationsByRentalId) > 0);
  addIssue(domains.rentalsGantt, summary, makeIssue('HIGH', 'closed_gantt_positive_debt', 'Returned or closed gantt rows have positive debt', closedRowsWithDebt, { entity: 'gantt_rental' }));

  addIssue(domains.service, summary, makeIssue('HIGH', 'closed_service_equipment_still_in_service', 'Closed or ready service leaves equipment in service', service.filter(ticket => CLOSED_SERVICE_STATUSES.has(lower(ticket.status)) && lower(equipmentById.get(serviceEquipmentId(ticket))?.status) === 'in_service'), { entity: 'service' }));
  addIssue(domains.service, summary, makeIssue('MEDIUM', 'open_service_equipment_not_blocked', 'Open service equipment is neither in service nor actively rented', openService.filter(ticket => {
    const eqId = serviceEquipmentId(ticket);
    const eqStatus = lower(equipmentById.get(eqId)?.status);
    return eqId && eqStatus !== 'in_service' && !activeRentalEquipmentIds.has(eqId);
  }), { entity: 'service' }));
  addIssue(domains.service, summary, makeIssue('MEDIUM', 'closed_service_without_repair_items', 'Closed or ready service has no repair items', service.filter(ticket => CLOSED_SERVICE_STATUSES.has(lower(ticket.status)) && getRepairItemsForService(ticket, workItems, partItems).length === 0), { entity: 'service' }));
  addIssue(domains.service, summary, makeIssue('LOW', 'service_missing_kind', 'Service ticket misses scenario/type/serviceKind', service.filter(ticket => !text(ticket.scenario || ticket.type || ticket.serviceKind || ticket.kind)), { entity: 'service', certainty: 'uncertain' }));
  addIssue(domains.service, summary, makeIssue('MEDIUM', 'open_service_older_than_7_days', 'Open service is older than 7 days', openService.filter(ticket => daysBeforeToday(serviceCreatedAt(ticket), today) > 7), { entity: 'service' }));
  addIssue(domains.service, summary, makeIssue('HIGH', 'open_service_older_than_14_days', 'Open service is older than 14 days', openService.filter(ticket => daysBeforeToday(serviceCreatedAt(ticket), today) > 14), { entity: 'service' }));
  addIssue(domains.service, summary, makeIssue('BLOCKER', 'open_service_older_than_30_days', 'Open service is older than 30 days', openService.filter(ticket => daysBeforeToday(serviceCreatedAt(ticket), today) > 30), { entity: 'service' }));
  addIssue(domains.service, summary, makeIssue('MEDIUM', 'unassigned_service_older_than_7_days', 'Unassigned service is older than 7 days', openService.filter(ticket => !text(ticket.mechanicId || ticket.assigneeId || ticket.assignedTo) && daysBeforeToday(serviceCreatedAt(ticket), today) > 7), { entity: 'service' }));
  addIssue(domains.service, summary, makeIssue('HIGH', 'unassigned_service_older_than_14_days', 'Unassigned service is older than 14 days', openService.filter(ticket => !text(ticket.mechanicId || ticket.assigneeId || ticket.assignedTo) && daysBeforeToday(serviceCreatedAt(ticket), today) > 14), { entity: 'service' }));
  addIssue(domains.service, summary, makeIssue('BLOCKER', 'unassigned_service_older_than_30_days', 'Unassigned service is older than 30 days', openService.filter(ticket => !text(ticket.mechanicId || ticket.assigneeId || ticket.assignedTo) && daysBeforeToday(serviceCreatedAt(ticket), today) > 30), { entity: 'service' }));
  addIssue(domains.service, summary, makeIssue('MEDIUM', 'repair_item_without_service', 'Repair item has no matching service ticket', [...workItems, ...partItems].filter(item => serviceIdFromItem(item) && !asArray(collections.service).some(ticket => idOf(ticket) === serviceIdFromItem(item))), { entity: 'repair_item' }));
  addIssue(domains.service, summary, makeIssue('MEDIUM', 'invalid_repair_item_fields', 'Repair item has invalid quantity, cost, or name', [...workItems, ...partItems].filter(item => toNumber(item.quantity ?? item.qty) < 0 || toNumber(item.cost ?? item.price ?? item.amount) < 0 || !text(item.name || item.title || item.workName || item.partName)), { entity: 'repair_item' }));

  addIssue(domains.delivery, summary, makeIssue('HIGH', 'stale_active_delivery', 'Active delivery has a past date', deliveries.filter(item => ACTIVE_DELIVERY_STATUSES.has(lower(item.status || 'active')) && isPastDate(deliveryDate(item), today)), { entity: 'delivery' }));
  addIssue(domains.delivery, summary, makeIssue('MEDIUM', 'delivery_missing_critical_fields', 'Delivery misses critical fields', deliveries.filter(item => !idOf(item) || !deliveryDate(item) || (!text(item.rentalId) && deliveryEquipmentIds(item).length === 0) || !text(item.carrierId || item.carrierKey)), { entity: 'delivery' }));
  addIssue(domains.delivery, summary, makeIssue('HIGH', 'delivery_broken_rental_link', 'Delivery rentalId does not resolve', deliveries.filter(item => text(item.rentalId) && !rentalsById.has(text(item.rentalId)) && !ganttById.has(text(item.rentalId))), { entity: 'delivery' }));
  addIssue(domains.delivery, summary, makeIssue('HIGH', 'delivery_broken_equipment_link', 'Delivery equipment link does not resolve', deliveries.filter(item => deliveryEquipmentIds(item).some(eqId => !equipmentById.has(eqId))), { entity: 'delivery' }));
  addIssue(domains.delivery, summary, makeIssue('MEDIUM', 'delivery_broken_carrier_link', 'Delivery carrier link does not resolve', deliveries.filter(item => text(item.carrierId || item.carrierKey) && !carriersById.has(text(item.carrierId || item.carrierKey))), { entity: 'delivery' }));

  const allocated = allocatedByPayment(paymentAllocations);
  addIssue(domains.finance, summary, makeIssue('HIGH', 'allocation_missing_payment', 'Allocation references missing payment', paymentAllocations.filter(item => paymentIdFromAllocation(item) && !paymentsById.has(paymentIdFromAllocation(item))), { entity: 'payment_allocation' }));
  addIssue(domains.finance, summary, makeIssue('HIGH', 'allocation_missing_related_entity', 'Allocation references missing rental, document, or client', paymentAllocations.filter(item =>
    (text(item.rentalId) && !rentalsById.has(text(item.rentalId)) && !ganttById.has(text(item.rentalId))) ||
    (text(item.documentId) && !documentsById.has(text(item.documentId))) ||
    (text(item.clientId) && !clientsById.has(text(item.clientId)))
  ), { entity: 'payment_allocation' }));
  addIssue(domains.finance, summary, makeIssue('HIGH', 'allocation_amount_greater_than_payment', 'Allocation amount is greater than payment amount', paymentAllocations.filter(item => {
    const payment = paymentsById.get(paymentIdFromAllocation(item));
    return payment && allocationAmount(item) > paidAmount(payment);
  }), { entity: 'payment_allocation' }));
  addIssue(domains.finance, summary, makeIssue('HIGH', 'negative_allocation', 'Allocation amount is negative', paymentAllocations.filter(item => allocationAmount(item) < 0), { entity: 'payment_allocation' }));
  addIssue(domains.finance, summary, makeIssue('MEDIUM', 'payment_without_allocation', 'Payment has no allocation', payments.filter(item => !allocated.has(idOf(item)) && !text(item.rentalId)), { entity: 'payment' }));
  addIssue(domains.finance, summary, makeIssue('MEDIUM', 'unallocated_payment_total', 'Payment has unallocated amount', payments.filter(item => paidAmount(item) > (allocated.get(idOf(item)) || 0) && allocated.has(idOf(item))), { entity: 'payment' }));
  addIssue(domains.finance, summary, makeIssue('HIGH', 'finance_closed_gantt_positive_debt', 'Returned or closed rows have positive debt', closedRowsWithDebt, { entity: 'gantt_rental' }));
  addIssue(domains.finance, summary, makeIssue('MEDIUM', 'gantt_amount_allocation_mismatch', 'Gantt amount and allocations do not match', ganttRentals.filter(row => {
    const amount = toNumber(row.amount ?? row.totalAmount ?? row.price);
    if (amount <= 0) return false;
    const allocatedAmount = allocationsByRentalId.get(idOf(row)) || 0;
    return allocatedAmount > 0 && Math.abs(amount - allocatedAmount) > 0.01;
  }), { entity: 'gantt_rental' }));

  addIssue(domains.documents, summary, makeIssue('HIGH', 'document_broken_rental_link', 'Document rentalId does not resolve', documents.filter(item => text(item.rentalId) && !rentalsById.has(text(item.rentalId)) && !ganttById.has(text(item.rentalId))), { entity: 'document' }));
  addIssue(domains.documents, summary, makeIssue('HIGH', 'document_broken_equipment_link', 'Document equipment link does not resolve', documents.filter(item => documentEquipmentIds(item).some(eqId => !equipmentById.has(eqId))), { entity: 'document' }));
  const documentNumberGroups = new Map();
  for (const item of documents) {
    const number = documentNumber(item);
    if (!number) continue;
    if (!documentNumberGroups.has(number)) documentNumberGroups.set(number, []);
    documentNumberGroups.get(number).push(item);
  }
  addIssue(domains.documents, summary, makeIssue('MEDIUM', 'duplicate_document_number', 'Duplicate document number', [...documentNumberGroups.values()].filter(group => group.length > 1).flat(), { entity: 'document' }));
  addIssue(domains.documents, summary, makeIssue('MEDIUM', 'signed_document_without_number_or_date', 'Signed document misses number or date', documents.filter(item => ['signed', 'подписан'].includes(lower(item.status)) && (!documentNumber(item) || !dateKey(item.date || item.documentDate || item.signedAt))), { entity: 'document' }));
  addIssue(domains.documents, summary, makeIssue('LOW', 'rental_document_missing_rental_id', 'Rental document misses rentalId', documents.filter(item => isRentalDocument(item) && !text(item.rentalId)), { entity: 'document', certainty: 'uncertain' }));

  domains.usersBot.activeUsers = users.filter(item => !['inactive', 'disabled', 'blocked', 'уволен', 'неактивен', 'заблокирован'].includes(lower(item.status))).length;
  addIssue(domains.usersBot, summary, makeIssue('HIGH', 'user_without_role', 'User has no role', users.filter(item => !text(item.role || item.userRole)), { entity: 'user' }));
  addIssue(domains.usersBot, summary, makeIssue('HIGH', 'unknown_role', 'User has unknown role', users.filter(item => text(item.role || item.userRole) && !KNOWN_ROLES.has(normalizeRole(item.role || item.userRole))), { entity: 'user' }));
  const emailGroups = new Map();
  for (const user of users) {
    const email = lower(user.email);
    if (!email) continue;
    if (!emailGroups.has(email)) emailGroups.set(email, []);
    emailGroups.get(email).push(user);
  }
  addIssue(domains.usersBot, summary, makeIssue('MEDIUM', 'duplicate_user_email', 'Duplicate user email', [...emailGroups.values()].filter(group => group.length > 1).flat(), { entity: 'user' }));
  addIssue(domains.usersBot, summary, makeIssue('MEDIUM', 'investor_without_owner_id', 'Investor user misses ownerId', users.filter(item => normalizeRole(item.role || item.userRole) === 'Инвестор' && !text(item.ownerId)), { entity: 'user' }));
  addIssue(domains.usersBot, summary, makeIssue('MEDIUM', 'mechanic_without_entity', 'Mechanic user has no mechanic entity', users.filter(item => isMechanicRole(item.role || item.userRole) && idOf(item) && !mechanicsById.has(idOf(item)) && !mechanics.some(mechanic => text(mechanic.userId) === idOf(item))), { entity: 'user', certainty: 'uncertain' }));
  if (botUsers.length || botSessions.length || botActivity.length) {
    const userIds = new Set(users.map(idOf).filter(Boolean));
    addIssue(domains.usersBot, summary, makeIssue('LOW', 'bot_user_without_frontend_user', 'Bot user has no matching frontend user', botUsers.filter(item => text(item.userId) && !userIds.has(text(item.userId))), { entity: 'bot_user', certainty: 'uncertain' }));
    domains.usersBot.botUsers = botUsers.length;
    domains.usersBot.botSessions = botSessions.length;
    domains.usersBot.botActivity = botActivity.length;
  }

  for (const [collectionName, code, title] of [
    ['service_work_names', 'duplicate_service_work_name', 'Duplicate service work name'],
    ['service_work_catalog', 'duplicate_service_work_name', 'Duplicate service work name'],
    ['spare_part_names', 'duplicate_spare_part_name', 'Duplicate spare part name'],
    ['spare_parts', 'duplicate_spare_part_name', 'Duplicate spare part name'],
  ]) {
    const list = asArray(collections[collectionName]);
    const groups = new Map();
    for (const item of list) {
      const name = lower(item.name || item.title || item.label);
      if (!name) continue;
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(item);
    }
    addIssue(domains.references, summary, makeIssue('LOW', code, title, [...groups.values()].filter(group => group.length > 1).flat(), { entity: collectionName }));
  }
  addIssue(domains.references, summary, makeIssue('MEDIUM', 'missing_owner_reference', 'Record references missing owner', [...equipment, ...rentals, ...ganttRentals, ...documents].filter(item => text(item.ownerId) && !ownersById.has(text(item.ownerId))), { entity: 'owner_reference' }));
  addIssue(domains.references, summary, makeIssue('LOW', 'malformed_app_settings', 'App settings appear malformed', asArray(collections.app_settings).filter(item => !idOf(item) && !text(item.key || item.name)), { entity: 'app_settings', certainty: 'uncertain' }));

  return {
    status: 'ok',
    generatedAt: new Date().toISOString(),
    counts: safeCollectionCounts(collections),
    summary,
    domains,
  };
}

module.exports = {
  EXAMPLE_LIMIT,
  buildDataIntegrityDiagnostics,
};
