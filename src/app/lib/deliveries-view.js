export const ACTIVE_DELIVERY_STATUSES = ['new', 'sent', 'accepted', 'in_transit'];
export const CLOSED_DELIVERY_STATUSES = ['completed', 'cancelled'];

const KNOWN_DELIVERY_STATUSES = new Set([
  ...ACTIVE_DELIVERY_STATUSES,
  ...CLOSED_DELIVERY_STATUSES,
]);

const STATUS_ALIASES = new Map([
  ['новая', 'new'],
  ['новый', 'new'],
  ['new', 'new'],
  ['created', 'new'],
  ['отправлена', 'sent'],
  ['отправлен', 'sent'],
  ['sent', 'sent'],
  ['принята', 'accepted'],
  ['принят', 'accepted'],
  ['accepted', 'accepted'],
  ['в пути', 'in_transit'],
  ['выехал', 'in_transit'],
  ['in_transit', 'in_transit'],
  ['in-transit', 'in_transit'],
  ['transit', 'in_transit'],
  ['выполнена', 'completed'],
  ['выполнен', 'completed'],
  ['завершена', 'completed'],
  ['завершен', 'completed'],
  ['completed', 'completed'],
  ['done', 'completed'],
  ['отменена', 'cancelled'],
  ['отменен', 'cancelled'],
  ['cancelled', 'cancelled'],
  ['canceled', 'cancelled'],
]);

const RECEIVING_TYPE_ALIASES = new Set([
  'receiving',
  'receive',
  'return',
  'pickup',
  'приемка',
  'приёмка',
  'возврат',
]);

function firstText(values, fallback = '') {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text) return text;
  }
  return fallback;
}

function normalizeDateKey(value) {
  const text = String(value ?? '').trim();
  if (!text) return '';
  const match = text.match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}-${match[3]}` : text.slice(0, 10);
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function addDaysIso(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function normalizeDeliveryStatus(value) {
  const key = String(value ?? '').trim().toLowerCase().replaceAll('ё', 'е');
  if (KNOWN_DELIVERY_STATUSES.has(key)) return key;
  return STATUS_ALIASES.get(key) || 'new';
}

export function normalizeDeliveryType(type, operationType = '') {
  const key = firstText([type, operationType]).toLowerCase().replaceAll('ё', 'е');
  return RECEIVING_TYPE_ALIASES.has(key) ? 'receiving' : 'shipping';
}

export function normalizeDeliveryRecord(raw, index = 0) {
  const source = raw && typeof raw === 'object' ? raw : {};
  const type = normalizeDeliveryType(source.type, source.operationType);
  const transportDate = normalizeDateKey(firstText([
    source.transportDate,
    source.date,
    source.scheduledDate,
    source.deliveryDate,
    source.plannedDate,
  ]));
  const neededBy = normalizeDateKey(firstText([
    source.neededBy,
    source.deadline,
    source.dueDate,
    source.requiredBy,
    source.transportDeadline,
    transportDate,
  ]));
  const equipmentInv = firstText([
    source.equipmentInv,
    source.inventoryNumber,
    source.inv,
    source.equipmentInventoryNumber,
  ]);
  const equipmentLabel = firstText([
    source.equipmentLabel,
    source.equipmentName,
    source.equipmentModel,
  ]);
  const cargo = firstText([
    source.cargo,
    equipmentLabel,
    equipmentInv,
    source.description,
  ]);
  const costNumber = Number(source.cost ?? source.deliveryCost ?? source.price ?? 0);

  return {
    ...source,
    id: firstText([source.id, source.number, source.deliveryNumber], `delivery-${index + 1}`),
    type,
    operationType: source.operationType || (type === 'receiving' ? 'Приёмка' : 'Отгрузка'),
    status: normalizeDeliveryStatus(source.status),
    transportDate,
    pickupTime: source.pickupTime || source.time || null,
    neededBy: neededBy || null,
    origin: firstText([source.origin, source.fromAddress, source.from, source.pickupAddress, source.sourceAddress]),
    destination: firstText([source.destination, source.toAddress, source.to, source.deliveryAddress, source.targetAddress]),
    cargo,
    contactName: firstText([source.contactName, source.objectContactName, source.contact, source.clientContactName]),
    contactPhone: firstText([source.contactPhone, source.objectContactPhone, source.phone, source.clientContactPhone]),
    cost: Number.isFinite(costNumber) && costNumber >= 0 ? costNumber : 0,
    comment: firstText([source.comment, source.notes, source.driverComment]),
    client: firstText([source.client, source.clientName, source.company]),
    clientId: source.clientId ? String(source.clientId) : null,
    rentalId: source.rentalId || source.classicRentalId || null,
    carrierId: source.carrierId || source.assignedCarrierId || null,
    carrierKey: source.carrierKey || source.assignedCarrierId || source.carrierId || null,
    carrierName: firstText([source.carrierName, source.driverName]),
    carrierPhone: firstText([source.carrierPhone, source.driverPhone]),
    equipmentId: source.equipmentId || null,
    equipmentInv: equipmentInv || null,
    equipmentLabel: equipmentLabel || null,
    createdAt: source.createdAt || '',
    updatedAt: source.updatedAt || '',
    createdBy: source.createdBy || '',
  };
}

export function normalizeDeliveriesResponse(response) {
  const candidates = [
    response,
    response?.data,
    response?.items,
    response?.results,
    response?.deliveries,
    response?.data?.items,
    response?.data?.results,
    response?.data?.deliveries,
  ];
  const list = candidates.find(Array.isArray) || [];
  return list.map((item, index) => normalizeDeliveryRecord(item, index));
}

export function getDeliveryDateKey(delivery) {
  return normalizeDateKey(firstText([
    delivery?.transportDate,
    delivery?.date,
    delivery?.scheduledDate,
    delivery?.neededBy,
    delivery?.deadline,
  ]));
}

export function isDeliveryOverdue(delivery, todayKey = todayIso()) {
  const dateKey = getDeliveryDateKey(delivery);
  return Boolean(dateKey && dateKey < todayKey && !CLOSED_DELIVERY_STATUSES.includes(delivery?.status));
}

export function isDeliveryToday(delivery, todayKey = todayIso()) {
  return getDeliveryDateKey(delivery) === todayKey;
}

export function isDeliveryInPeriod(delivery, period, todayKey = todayIso()) {
  const dateKey = getDeliveryDateKey(delivery);
  if (!dateKey || period === 'all') return true;
  if (period === 'today') return dateKey === todayKey;
  if (period === 'tomorrow') return dateKey === addDaysIso(todayKey, 1);
  if (period === 'week') return dateKey >= todayKey && dateKey <= addDaysIso(todayKey, 6);
  return true;
}

export function isUnassignedDelivery(delivery) {
  return !delivery?.carrierId && !delivery?.carrierKey && !delivery?.carrierName;
}

export function matchesDeliveryStatusFilter(delivery, filter, todayKey = todayIso()) {
  if (!filter) return true;
  if (filter === 'in_transit') return delivery?.status === 'in_transit';
  if (filter === 'planned') return ['new', 'sent', 'accepted'].includes(delivery?.status);
  if (filter === 'completed') return delivery?.status === 'completed';
  if (filter === 'overdue') return isDeliveryOverdue(delivery, todayKey);
  if (filter === 'unassigned') return isUnassignedDelivery(delivery) && !CLOSED_DELIVERY_STATUSES.includes(delivery?.status);
  if (filter === 'cancelled') return delivery?.status === 'cancelled';
  return true;
}

export function filterDeliveriesForView(deliveries, filters = {}, todayKey = todayIso()) {
  const list = Array.isArray(deliveries) ? deliveries : [];
  const search = String(filters.search || '').trim().toLowerCase();
  const activeTab = filters.activeTab || 'all';
  const periodFilter = filters.periodFilter || 'all';
  const statusFilter = filters.statusFilter || '';
  const typeFilter = filters.typeFilter || '';
  const carrierFilter = filters.carrierFilter || '';

  return list.filter((item) => {
    if (!isDeliveryInPeriod(item, periodFilter, todayKey)) return false;
    if (!matchesDeliveryStatusFilter(item, statusFilter, todayKey)) return false;
    if (typeFilter && item.type !== typeFilter) return false;
    if (carrierFilter && ![item.carrierName, item.carrierKey, item.carrierId].some((value) => value === carrierFilter)) return false;
    if (activeTab === 'active' && !ACTIVE_DELIVERY_STATUSES.includes(item.status)) return false;
    if (activeTab === 'in_transit' && item.status !== 'in_transit') return false;
    if (activeTab === 'planned' && !['new', 'sent', 'accepted'].includes(item.status)) return false;
    if (activeTab === 'completed' && !CLOSED_DELIVERY_STATUSES.includes(item.status)) return false;
    if (activeTab === 'overdue' && !isDeliveryOverdue(item, todayKey)) return false;
    if (activeTab === 'cancelled' && item.status !== 'cancelled') return false;
    if (!search) return true;
    return [
      item.id,
      item.client,
      item.clientName,
      item.cargo,
      item.origin,
      item.destination,
      item.fromAddress,
      item.toAddress,
      item.contactName,
      item.contactPhone,
      item.carrierName,
      item.manager,
      item.equipmentInv,
      item.equipmentLabel,
    ].some((value) => String(value || '').toLowerCase().includes(search));
  });
}

export function getDeliveryEmptyState({ totalCount = 0, isCarrierView = false } = {}) {
  if (totalCount === 0) {
    return {
      title: 'Доставок пока нет',
      description: isCarrierView
        ? 'Активных заявок для вашей компании сейчас нет.'
        : 'Доставку можно создать из аренды или вручную в этом разделе.',
    };
  }
  return {
    title: 'Доставок по выбранным фильтрам нет',
    description: isCarrierView
      ? 'Активных заявок для вашей компании по выбранным условиям нет.'
      : 'Сбросьте фильтры или выберите другой период.',
  };
}

export function getDeliveryErrorMessage(error) {
  if (!error) return 'Не удалось загрузить доставки.';
  if (error instanceof Error && error.message) return error.message;
  return 'Не удалось загрузить доставки.';
}
