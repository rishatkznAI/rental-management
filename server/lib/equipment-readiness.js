const {
  equipmentMatchesServiceTicket,
  rentalMatchesEquipment,
  normalizeEquipmentRef,
  buildEquipmentLookup,
} = require('./equipment-matching');

const READINESS_LABELS = {
  ready: 'Готова к аренде',
  needs_check: 'Требует проверки',
  in_service: 'В сервисе',
  rented: 'В аренде',
  delivery_blocked: 'Блокер доставки',
  document_blocked: 'Блокер документов',
  gsm_attention: 'Внимание GSM',
  unknown: 'Статус не ясен',
};

const READINESS_SEVERITY = {
  ready: 'good',
  needs_check: 'warning',
  in_service: 'danger',
  rented: 'neutral',
  delivery_blocked: 'danger',
  document_blocked: 'warning',
  gsm_attention: 'warning',
  unknown: 'neutral',
};

const RECOMMENDED_ACTIONS = {
  ready: 'Можно планировать аренду.',
  needs_check: 'Проверьте состояние и фото приёмки/возврата.',
  in_service: 'Закройте или обновите сервисную заявку.',
  rented: 'Проверьте дату возврата в аренде.',
  delivery_blocked: 'Завершите или отмените активную доставку.',
  document_blocked: 'Проверьте документы перед выдачей.',
  gsm_attention: 'Проверьте трекер и последнюю телеметрию.',
  unknown: 'Уточните статус техники вручную.',
};

const PRIORITY = {
  delivery_blocked: 80,
  in_service: 70,
  document_blocked: 60,
  gsm_attention: 50,
  rented: 40,
  needs_check: 30,
  unknown: 20,
  ready: 10,
};

const SUMMARY_KEYS = {
  ready: 'ready',
  needs_check: 'needsCheck',
  in_service: 'inService',
  rented: 'rented',
  delivery_blocked: 'deliveryBlocked',
  document_blocked: 'documentBlocked',
  gsm_attention: 'gsmAttention',
  unknown: 'unknown',
};

const ACTION_QUEUE_PRIORITIES = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

const ACTION_QUEUE_AREAS = ['service', 'logistics', 'office', 'rental_manager', 'admin', 'unknown'];
const ACTION_QUEUE_HIGH_LOSS_THRESHOLD = 50000;
const ACTION_QUEUE_CRITICAL_BLOCKED_DAYS = 7;

const ACTIVE_RENTAL_STATUSES = new Set(['active', 'delivery', 'return_planned', 'confirmed']);
const FUTURE_RENTAL_STATUSES = new Set(['new', 'created', 'confirmed']);
const OPEN_SERVICE_STATUSES = new Set(['new', 'assigned', 'in_progress', 'waiting_parts', 'needs_revision']);
const ACTIVE_DELIVERY_STATUSES = new Set(['new', 'sent', 'accepted', 'in_transit']);
const DOCUMENT_BLOCKER_STATUSES = new Set(['expired', 'missing', 'rejected', 'blocked']);
const AVAILABLE_STATUSES = new Set(['available', 'free', 'свободна', 'свободен']);
const CLOSED_RENTAL_STATUSES = new Set(['closed', 'returned', 'cancelled', 'canceled']);
const RATE_SOURCE_UNAVAILABLE = 'unavailable';

function normalizeText(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return normalizeText(value).toLowerCase().replaceAll('ё', 'е');
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function pushMapArray(map, key, value) {
  const normalized = normalizeEquipmentRef(key);
  if (!normalized) return;
  if (!map.has(normalized)) map.set(normalized, []);
  map.get(normalized).push(value);
}

function setMapFirst(map, key, value) {
  const normalized = normalizeEquipmentRef(key);
  if (normalized && !map.has(normalized)) map.set(normalized, value);
}

function lookupUnique(map, counts, ref) {
  const normalized = normalizeEquipmentRef(ref);
  if (!normalized || (counts.get(normalized) || 0) !== 1) return null;
  return map.get(normalized) || null;
}

function resolveEquipmentIdsFromRefs(record, lookup, refs = []) {
  const ids = new Set();
  const directId = normalizeEquipmentRef(record?.equipmentId);
  if (directId && lookup.byId.has(directId)) ids.add(directId);

  const scalarRefs = [
    record?.equipmentInv,
    record?.inventoryNumber,
    record?.serialNumber,
    record?.equipmentInventoryNumber,
  ];
  for (const ref of [...scalarRefs, ...refs].flat()) {
    const normalized = normalizeEquipmentRef(ref);
    if (!normalized) continue;
    const byId = lookup.byId.get(normalized);
    if (byId?.id) ids.add(normalizeEquipmentRef(byId.id));
    const byInventory = lookupUnique(lookup.byInventory, lookup.inventoryCounts, normalized);
    if (byInventory?.id) ids.add(normalizeEquipmentRef(byInventory.id));
    const byEquipmentInv = lookupUnique(lookup.byEquipmentInv, lookup.equipmentInvCounts, normalized);
    if (byEquipmentInv?.id) ids.add(normalizeEquipmentRef(byEquipmentInv.id));
    const bySerial = lookupUnique(lookup.bySerial, lookup.serialCounts, normalized);
    if (bySerial?.id) ids.add(normalizeEquipmentRef(bySerial.id));
  }
  return ids;
}

function addLatestByTime(map, key, item, fields) {
  const normalized = normalizeEquipmentRef(key);
  if (!normalized) return;
  const time = Math.max(...fields.map(field => parseTime(item?.[field])));
  const previous = map.get(normalized);
  if (!previous || time > previous.time) map.set(normalized, { item, time });
}

function buildReadinessIndexes(context = {}) {
  const equipmentList = asArray(context.equipment);
  const lookup = buildEquipmentLookup(equipmentList);
  const rentalsByEquipmentId = new Map();
  const serviceByEquipmentId = new Map();
  const deliveriesByEquipmentId = new Map();
  const documentsByEquipmentId = new Map();
  const receivingPhotosByEquipmentId = new Map();
  const latestGsmPacketByEquipmentId = new Map();
  const rentalRatesByCategory = new Map();
  const unmatchedRentals = [];
  const unmatchedServiceTickets = [];
  const unmatchedDeliveries = [];
  const unmatchedDocuments = [];
  const unmatchedReceivingPhotos = [];

  for (const rental of [...asArray(context.rentals), ...asArray(context.ganttRentals)]) {
    const ids = resolveEquipmentIdsFromRefs(rental, lookup, Array.isArray(rental?.equipment) ? rental.equipment : []);
    if (ids.size === 0) unmatchedRentals.push(rental);
    for (const id of ids) {
      pushMapArray(rentalsByEquipmentId, id, rental);
      const equipment = lookup.byId.get(id);
      const categoryKey = lower(equipment?.type || equipment?.category || equipment?.model);
      const rateEntry = categoryKey ? rateEntryFromRentalForEquipment(rental, id) : null;
      if (rateEntry) pushMapArray(rentalRatesByCategory, categoryKey, rateEntry);
    }
  }

  for (const ticket of asArray(context.serviceTickets)) {
    const ids = resolveEquipmentIdsFromRefs(ticket, lookup);
    if (ids.size === 0) unmatchedServiceTickets.push(ticket);
    for (const id of ids) pushMapArray(serviceByEquipmentId, id, ticket);
  }

  for (const delivery of asArray(context.deliveries)) {
    const ids = resolveEquipmentIdsFromRefs(delivery, lookup, [delivery?.equipmentLabel, delivery?.cargo]);
    if (ids.size === 0) unmatchedDeliveries.push(delivery);
    for (const id of ids) pushMapArray(deliveriesByEquipmentId, id, delivery);
  }

  for (const document of asArray(context.documents)) {
    const ids = resolveEquipmentIdsFromRefs(document, lookup);
    if (ids.size === 0) unmatchedDocuments.push(document);
    for (const id of ids) pushMapArray(documentsByEquipmentId, id, document);
  }

  for (const photo of asArray(context.shippingPhotos)) {
    if (lower(photo?.type) !== 'receiving') continue;
    const ids = resolveEquipmentIdsFromRefs(photo, lookup, [photo?.equipmentInv]);
    if (ids.size === 0) unmatchedReceivingPhotos.push(photo);
    for (const id of ids) pushMapArray(receivingPhotosByEquipmentId, id, photo);
  }

  const equipmentIdByGsmImei = new Map();
  const equipmentIdByGsmDeviceId = new Map();
  const equipmentIdByGsmTrackerId = new Map();
  for (const item of equipmentList) {
    setMapFirst(equipmentIdByGsmImei, item?.gsmImei, item?.id);
    setMapFirst(equipmentIdByGsmDeviceId, item?.gsmDeviceId, item?.id);
    setMapFirst(equipmentIdByGsmTrackerId, item?.gsmTrackerId, item?.id);
  }
  for (const packet of asArray(context.gsmPackets)) {
    const ids = new Set();
    if (packet?.equipmentId && lookup.byId.has(normalizeEquipmentRef(packet.equipmentId))) ids.add(normalizeEquipmentRef(packet.equipmentId));
    const byImei = equipmentIdByGsmImei.get(normalizeEquipmentRef(packet?.imei));
    const byDevice = equipmentIdByGsmDeviceId.get(normalizeEquipmentRef(packet?.deviceId));
    const byTracker = equipmentIdByGsmTrackerId.get(normalizeEquipmentRef(packet?.trackerId));
    if (byImei) ids.add(normalizeEquipmentRef(byImei));
    if (byDevice) ids.add(normalizeEquipmentRef(byDevice));
    if (byTracker) ids.add(normalizeEquipmentRef(byTracker));
    for (const id of ids) addLatestByTime(latestGsmPacketByEquipmentId, id, packet, ['deviceTime', 'receivedAt', 'createdAt']);
  }

  return {
    rentalsByEquipmentId,
    serviceByEquipmentId,
    deliveriesByEquipmentId,
    documentsByEquipmentId,
    receivingPhotosByEquipmentId,
    latestGsmPacketByEquipmentId,
    rentalRatesByCategory,
    unmatchedRentals,
    unmatchedServiceTickets,
    unmatchedDeliveries,
    unmatchedDocuments,
    unmatchedReceivingPhotos,
  };
}

function readinessIndexes(context = {}) {
  if (!context.__readinessIndexes) {
    Object.defineProperty(context, '__readinessIndexes', {
      value: buildReadinessIndexes(context),
      enumerable: false,
      configurable: true,
    });
  }
  return context.__readinessIndexes;
}

function parseTime(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  const time = Date.parse(normalizeText(value));
  return Number.isFinite(time) ? time : 0;
}

function dateKey(value) {
  const time = parseTime(value);
  if (!time) return '';
  return new Date(time).toISOString().slice(0, 10);
}

function parseMoneyValue(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number') return Number.isFinite(value) ? Math.max(0, value) : null;
  const normalized = String(value)
    .replace(/\s+/g, '')
    .replace(',', '.')
    .replace(/[^\d.]/g, '');
  if (!normalized) return null;
  const numeric = Number(normalized);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : null;
}

function roundMoney(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function inclusiveDays(startDate, endDate) {
  const start = parseTime(startDate);
  const end = parseTime(endDate);
  if (!start || !end || end < start) return 0;
  return Math.floor((Date.UTC(new Date(end).getUTCFullYear(), new Date(end).getUTCMonth(), new Date(end).getUTCDate()) -
    Date.UTC(new Date(start).getUTCFullYear(), new Date(start).getUTCMonth(), new Date(start).getUTCDate())) / (24 * 60 * 60 * 1000)) + 1;
}

function inferRentalDailyRate(rental) {
  const explicitDaily = parseMoneyValue(rental?.dailyRate ?? rental?.pricePerDay);
  if (explicitDaily !== null) return explicitDaily;
  const monthlyRate = parseMoneyValue(rental?.monthlyRate);
  if (monthlyRate !== null) return roundMoney(monthlyRate / 30);
  const rateText = String(rental?.rate || '').toLowerCase();
  const rateValue = parseMoneyValue(rateText);
  if (rateValue !== null) return /мес|month/.test(rateText) ? roundMoney(rateValue / 30) : rateValue;
  const gross = parseMoneyValue(rental?.amount ?? rental?.price ?? rental?.totalAmount ?? rental?.rentalAmount);
  const days = inclusiveDays(rental?.startDate, rental?.plannedReturnDate || rental?.endDate || rental?.actualReturnDate || rental?.returnDate);
  if (gross !== null && gross > 0 && days > 0) return roundMoney(gross / days);
  return null;
}

function rateEntryFromRental(rental) {
  const rate = inferRentalDailyRate(rental);
  if (rate === null || rate <= 0) return null;
  return {
    rate,
    time: Math.max(
      parseTime(rental?.actualReturnDate),
      parseTime(rental?.returnDate),
      parseTime(rental?.endDate),
      parseTime(rental?.plannedReturnDate),
      parseTime(rental?.startDate),
      parseTime(rental?.updatedAt),
      parseTime(rental?.createdAt),
    ),
  };
}

function rateEntryFromRentalForEquipment(rental, equipmentId) {
  const entry = rateEntryFromRental(rental);
  return entry ? { ...entry, equipmentId: normalizeEquipmentRef(equipmentId) } : null;
}

function inferEquipmentDailyPrice(equipment) {
  const explicit = parseMoneyValue(
    equipment?.dailyRate ??
    equipment?.rentalDailyRate ??
    equipment?.pricePerDay ??
    equipment?.defaultDailyRate ??
    equipment?.defaultRentalPrice
  );
  if (explicit !== null && explicit > 0) return explicit;
  const monthly = parseMoneyValue(equipment?.monthlyRate ?? equipment?.rentalMonthlyRate ?? equipment?.plannedMonthlyRevenue);
  return monthly !== null && monthly > 0 ? roundMoney(monthly / 30) : null;
}

function estimateDailyRate({ equipment, relatedRentals, context }) {
  const sortedRentals = asArray(relatedRentals)
    .slice()
    .sort((left, right) => Math.max(parseTime(right?.actualReturnDate), parseTime(right?.returnDate), parseTime(right?.endDate), parseTime(right?.plannedReturnDate), parseTime(right?.startDate), parseTime(right?.updatedAt), parseTime(right?.createdAt)) -
      Math.max(parseTime(left?.actualReturnDate), parseTime(left?.returnDate), parseTime(left?.endDate), parseTime(left?.plannedReturnDate), parseTime(left?.startDate), parseTime(left?.updatedAt), parseTime(left?.createdAt)));
  const latestRentalRate = sortedRentals.length > 0 ? inferRentalDailyRate(sortedRentals[0]) : null;
  if (latestRentalRate !== null && latestRentalRate > 0) {
    return { estimatedDailyRate: latestRentalRate, estimatedDailyRateSource: 'latest_rental' };
  }
  const rentalRates = sortedRentals.map(rateEntryFromRental).filter(Boolean);
  if (rentalRates.length > 0) {
    const average = rentalRates.reduce((sum, entry) => sum + entry.rate, 0) / rentalRates.length;
    return { estimatedDailyRate: roundMoney(average), estimatedDailyRateSource: 'average_rental' };
  }
  const equipmentRate = inferEquipmentDailyPrice(equipment);
  if (equipmentRate !== null) return { estimatedDailyRate: equipmentRate, estimatedDailyRateSource: 'equipment_price' };

  const categoryKey = lower(equipment?.type || equipment?.category || equipment?.model);
  if (categoryKey) {
    const currentEquipmentId = normalizeEquipmentRef(equipment?.id);
    const categoryRates = asArray(readinessIndexes(context).rentalRatesByCategory.get(categoryKey))
      .filter(entry => entry.equipmentId !== currentEquipmentId)
      .filter(entry => entry.rate > 0);
    if (categoryRates.length > 0) {
      const average = categoryRates.reduce((sum, entry) => sum + entry.rate, 0) / categoryRates.length;
      return { estimatedDailyRate: roundMoney(average), estimatedDailyRateSource: 'category_average' };
    }
  }

  return { estimatedDailyRate: null, estimatedDailyRateSource: RATE_SOURCE_UNAVAILABLE };
}

function daysBlocked(blockedSince, now) {
  if (!blockedSince) return null;
  const days = inclusiveDays(blockedSince, dateKey(now));
  return days > 0 ? days : null;
}

function lossSeverity(estimatedLoss) {
  if (!estimatedLoss || estimatedLoss <= 0) return 'none';
  if (estimatedLoss < 10000) return 'low';
  if (estimatedLoss < 50000) return 'medium';
  if (estimatedLoss < 150000) return 'high';
  return 'critical';
}

function responsibleAreaForStatus(status, primaryReason = '') {
  if (status === 'in_service') return 'service';
  if (status === 'delivery_blocked') return 'logistics';
  if (status === 'document_blocked') return 'office';
  if (status === 'gsm_attention') return 'admin';
  if (status === 'needs_check') return /документ/i.test(primaryReason) ? 'office' : 'service';
  if (status === 'ready' || status === 'rented') return 'unknown';
  return 'unknown';
}

function financialRecommendation({ readinessStatus, estimatedDailyRate, blockedDays, responsibleArea }) {
  if (readinessStatus === 'ready') return 'Потерь по простою нет: техника готова к аренде.';
  if (readinessStatus === 'rented') return 'Потерь по простою нет: техника сейчас зарабатывает в аренде.';
  if (estimatedDailyRate === null) return 'Нет ставки: добавьте ставку в аренду или карточку техники для оценки потерь.';
  if (!blockedDays) return 'Есть ставка, но дата начала блокера не ясна: уточните дату для расчёта потерь.';
  if (responsibleArea === 'service') return 'Сервису: закрыть блокер или обновить срок готовности, чтобы вернуть технику в аренду.';
  if (responsibleArea === 'logistics') return 'Логистике: завершить или отменить доставку, чтобы снять простой.';
  if (responsibleArea === 'office') return 'Офису: закрыть документальный блокер, чтобы техника снова была доступна.';
  if (responsibleArea === 'admin') return 'Администратору: проверить GSM-блокер и подтвердить готовность техники.';
  return 'Уточните ответственного и дату блокера для финансовой оценки простоя.';
}

function isActiveRental(rental) {
  const status = lower(rental?.status || 'active');
  if (CLOSED_RENTAL_STATUSES.has(status)) return false;
  return ACTIVE_RENTAL_STATUSES.has(status);
}

function isFutureRental(rental, nowMs) {
  const status = lower(rental?.status || '');
  const startMs = parseTime(rental?.startDate);
  if (!startMs || startMs <= nowMs) return false;
  return FUTURE_RENTAL_STATUSES.has(status);
}

function isOpenServiceTicket(ticket) {
  return OPEN_SERVICE_STATUSES.has(lower(ticket?.status || 'new'));
}

function isActiveDelivery(delivery) {
  return ACTIVE_DELIVERY_STATUSES.has(lower(delivery?.status || 'new'));
}

function isEquipmentAvailableStatus(equipment) {
  return AVAILABLE_STATUSES.has(lower(equipment?.status || ''));
}

function hasPhotoList(value) {
  if (Array.isArray(value)) return value.length > 0;
  if (!value || typeof value !== 'object') return false;
  return Object.values(value).some(hasPhotoList);
}

function shippingPhotoMatchesEquipment(photo, equipment, equipmentList) {
  if (!photo || !equipment) return false;
  if (photo.equipmentId && photo.equipmentId === equipment.id) return true;
  if (photo.serialNumber && equipment.serialNumber && photo.serialNumber === equipment.serialNumber) return true;
  const inventory = normalizeEquipmentRef(photo.inventoryNumber || photo.equipmentInv);
  return Boolean(inventory && equipment.inventoryNumber && inventory === equipment.inventoryNumber);
}

function deliveryMatchesEquipment(delivery, equipment, equipmentList) {
  if (!delivery || !equipment) return false;
  if (delivery.equipmentId && delivery.equipmentId === equipment.id) return true;
  if (delivery.equipmentInv && equipment.inventoryNumber && delivery.equipmentInv === equipment.inventoryNumber) return true;
  if (delivery.inventoryNumber && equipment.inventoryNumber && delivery.inventoryNumber === equipment.inventoryNumber) return true;
  const rentalLike = {
    equipmentId: delivery.equipmentId,
    equipmentInv: delivery.equipmentInv || delivery.inventoryNumber,
    serialNumber: delivery.serialNumber,
    equipment: [delivery.equipmentLabel, delivery.cargo].filter(Boolean),
  };
  return rentalMatchesEquipment(rentalLike, equipment, equipmentList);
}

function documentMatchesEquipment(document, equipment) {
  if (!document || !equipment) return false;
  if (document.equipmentId && document.equipmentId === equipment.id) return true;
  if (document.equipmentInv && equipment.inventoryNumber && document.equipmentInv === equipment.inventoryNumber) return true;
  if (document.inventoryNumber && equipment.inventoryNumber && document.inventoryNumber === equipment.inventoryNumber) return true;
  if (document.serialNumber && equipment.serialNumber && document.serialNumber === equipment.serialNumber) return true;
  return false;
}

function packetMatchesEquipment(packet, equipment) {
  if (!packet || !equipment) return false;
  return Boolean(
    (packet.equipmentId && packet.equipmentId === equipment.id) ||
    (packet.imei && equipment.gsmImei && packet.imei === equipment.gsmImei) ||
    (packet.deviceId && equipment.gsmDeviceId && packet.deviceId === equipment.gsmDeviceId) ||
    (packet.trackerId && equipment.gsmTrackerId && packet.trackerId === equipment.gsmTrackerId)
  );
}

function latestByTime(items, fields) {
  return asArray(items)
    .map(item => ({
      item,
      time: Math.max(...fields.map(field => parseTime(item?.[field]))),
    }))
    .filter(entry => entry.time > 0)
    .sort((left, right) => right.time - left.time)[0]?.item || null;
}

function getEquipmentGsmLastSeen(equipment, packets) {
  const direct = parseTime(equipment?.gsmLastSeenAt || equipment?.gsmLastSignalAt);
  const latestPacket = packets && !Array.isArray(packets) && packets.latestGsmPacketByEquipmentId
    ? packets.latestGsmPacketByEquipmentId.get(normalizeEquipmentRef(equipment?.id))?.item || null
    : latestByTime(
      asArray(packets).filter(packet => packetMatchesEquipment(packet, equipment)),
      ['deviceTime', 'receivedAt', 'createdAt'],
    );
  return {
    lastSeenMs: Math.max(direct, parseTime(latestPacket?.deviceTime || latestPacket?.receivedAt || latestPacket?.createdAt)),
    latestPacket,
  };
}

function addCandidate(candidates, status, reason, link = {}, meta = {}) {
  if (!status) return;
  candidates.push({ status, reason, link, ...meta });
}

function pickStatus(candidates) {
  return candidates
    .slice()
    .sort((left, right) => (PRIORITY[right.status] || 0) - (PRIORITY[left.status] || 0))[0]?.status || 'unknown';
}

function calculateEquipmentReadiness(equipment, context = {}) {
  const equipmentList = asArray(context.equipment);
  const indexes = readinessIndexes(context);
  const equipmentId = normalizeEquipmentRef(equipment?.id);
  const now = context.now instanceof Date ? context.now : new Date();
  const nowMs = now.getTime();
  const candidates = [];
  const links = {
    equipment: `/equipment/${encodeURIComponent(equipment?.id || '')}`,
  };

  let relatedRentals = asArray(indexes.rentalsByEquipmentId.get(equipmentId));
  if (relatedRentals.length === 0) {
    relatedRentals = asArray(indexes.unmatchedRentals)
      .filter(rental => rentalMatchesEquipment(rental, equipment, equipmentList));
  }
  const activeRental = relatedRentals.find(isActiveRental);
  if (activeRental) {
    addCandidate(candidates, 'rented', `Активная аренда ${activeRental.id || ''}`.trim(), { rental: activeRental.id }, { blockedSince: dateKey(activeRental.startDate) });
  }

  const futureRental = relatedRentals.find(rental => isFutureRental(rental, nowMs));
  if (futureRental) {
    addCandidate(candidates, 'needs_check', `Есть будущая бронь/аренда ${futureRental.id || ''}`.trim(), { rental: futureRental.id }, { blockedSince: dateKey(futureRental.createdAt || futureRental.startDate) });
  }

  let openServiceTicket = asArray(indexes.serviceByEquipmentId.get(equipmentId))
    .find(ticket => isOpenServiceTicket(ticket));
  if (!openServiceTicket) {
    openServiceTicket = asArray(indexes.unmatchedServiceTickets)
      .find(ticket => isOpenServiceTicket(ticket) && equipmentMatchesServiceTicket(ticket, equipment, equipmentList));
  }
  if (openServiceTicket) {
    addCandidate(candidates, 'in_service', `Открыта сервисная заявка ${openServiceTicket.id || ''}`.trim(), { serviceTicket: openServiceTicket.id }, { blockedSince: dateKey(openServiceTicket.createdAt || openServiceTicket.startDate || openServiceTicket.date) });
  }

  let activeDelivery = asArray(indexes.deliveriesByEquipmentId.get(equipmentId))
    .find(delivery => isActiveDelivery(delivery));
  if (!activeDelivery) {
    activeDelivery = asArray(indexes.unmatchedDeliveries)
      .find(delivery => isActiveDelivery(delivery) && deliveryMatchesEquipment(delivery, equipment, equipmentList));
  }
  if (activeDelivery) {
    addCandidate(candidates, 'delivery_blocked', `Активная доставка ${activeDelivery.id || ''}`.trim(), { delivery: activeDelivery.id }, { blockedSince: dateKey(activeDelivery.scheduledDate || activeDelivery.plannedDate || activeDelivery.createdAt) });
  }

  let blockingDocument = asArray(indexes.documentsByEquipmentId.get(equipmentId))
    .find(document => DOCUMENT_BLOCKER_STATUSES.has(lower(document.status || document.documentStatus)));
  if (!blockingDocument) {
    blockingDocument = asArray(indexes.unmatchedDocuments)
      .find(document => documentMatchesEquipment(document, equipment) && DOCUMENT_BLOCKER_STATUSES.has(lower(document.status || document.documentStatus)));
  }
  if (blockingDocument) {
    addCandidate(candidates, 'document_blocked', `Проблемный документ ${blockingDocument.documentNumber || blockingDocument.number || blockingDocument.id || ''}`.trim(), { document: blockingDocument.id }, { blockedSince: dateKey(blockingDocument.createdAt || blockingDocument.date || blockingDocument.documentDate) });
  }

  const hasGsmLink = Boolean(equipment?.gsmImei || equipment?.gsmDeviceId || equipment?.gsmTrackerId);
  if (hasGsmLink) {
    const { lastSeenMs, latestPacket } = getEquipmentGsmLastSeen(equipment, indexes);
    const staleMs = Number(context.gsmStaleMs || 72 * 60 * 60 * 1000);
    if (!lastSeenMs) {
      addCandidate(candidates, 'gsm_attention', 'GSM-трекер привязан, но пакетов/last seen нет', {}, { blockedSince: dateKey(equipment?.gsmCreatedAt || equipment?.updatedAt) });
    } else if (nowMs - lastSeenMs > staleMs) {
      addCandidate(candidates, 'gsm_attention', 'GSM-трекер давно не выходил на связь', {}, { blockedSince: dateKey(lastSeenMs) });
    } else if (lower(latestPacket?.parseStatus) === 'failed') {
      addCandidate(candidates, 'gsm_attention', 'Последний GSM-пакет разобран с ошибкой', {}, { blockedSince: dateKey(latestPacket?.receivedAt || latestPacket?.createdAt) });
    }
  }

  if (isEquipmentAvailableStatus(equipment)) {
    let returnLikePhotos = asArray(indexes.receivingPhotosByEquipmentId.get(equipmentId));
    if (returnLikePhotos.length === 0) {
      returnLikePhotos = asArray(indexes.unmatchedReceivingPhotos)
        .filter(photo => shippingPhotoMatchesEquipment(photo, equipment, equipmentList) && lower(photo.type) === 'receiving');
    }
    const latestClosedRental = latestByTime(
      relatedRentals.filter(rental => CLOSED_RENTAL_STATUSES.has(lower(rental?.status)) || rental?.actualReturnDate),
      ['actualReturnDate', 'returnDate', 'endDate', 'updatedAt'],
    );
    if (latestClosedRental && returnLikePhotos.length === 0 && !hasPhotoList(equipment?.acceptancePhotos)) {
      addCandidate(candidates, 'needs_check', 'Нет свежих фото приёмки/возврата после последней аренды', {}, { blockedSince: dateKey(latestClosedRental.actualReturnDate || latestClosedRental.returnDate || latestClosedRental.endDate) });
    }
  }

  if (!equipment?.id) {
    addCandidate(candidates, 'unknown', 'У записи техники нет стабильного ID');
  } else if (!normalizeText(equipment.status)) {
    addCandidate(candidates, 'unknown', 'У техники не заполнен статус');
  } else if (isEquipmentAvailableStatus(equipment) && candidates.length === 0) {
    addCandidate(candidates, 'ready', 'Нет открытых блокеров');
  } else if (candidates.length === 0) {
    addCandidate(candidates, 'unknown', 'Статус техники требует ручной проверки');
  }

  const readinessStatus = pickStatus(candidates);
  const primaryCandidate = candidates.find(candidate => candidate.status === readinessStatus) || null;
  for (const candidate of candidates) {
    if (candidate.status !== readinessStatus) continue;
    if (candidate.link?.rental && !links.rental) links.rental = `/rentals/${encodeURIComponent(candidate.link.rental)}`;
    if (candidate.link?.serviceTicket && !links.serviceTicket) links.serviceTicket = `/service/${encodeURIComponent(candidate.link.serviceTicket)}`;
    if (candidate.link?.delivery && !links.delivery) links.delivery = `/deliveries?deliveryId=${encodeURIComponent(candidate.link.delivery)}`;
    if (candidate.link?.document && !links.document) links.document = `/documents?documentId=${encodeURIComponent(candidate.link.document)}`;
  }

  const rate = estimateDailyRate({ equipment, relatedRentals, context });
  const blockedSince = readinessStatus === 'ready' || readinessStatus === 'rented' ? null : (primaryCandidate?.blockedSince || null);
  const blockedDays = readinessStatus === 'ready' || readinessStatus === 'rented' ? null : daysBlocked(blockedSince, now);
  const canCalculateLoss = !['ready', 'rented'].includes(readinessStatus) && rate.estimatedDailyRate !== null && blockedDays !== null;
  const estimatedLoss = readinessStatus === 'ready' || readinessStatus === 'rented'
    ? 0
    : (canCalculateLoss ? roundMoney(rate.estimatedDailyRate * blockedDays) : null);
  const responsibleArea = responsibleAreaForStatus(readinessStatus, primaryCandidate?.reason || '');

  return {
    equipmentId: equipment?.id || '',
    model: [equipment?.manufacturer, equipment?.model].map(normalizeText).filter(Boolean).join(' ') || normalizeText(equipment?.model),
    inventoryNumber: equipment?.inventoryNumber || '',
    serialNumber: equipment?.serialNumber || '',
    status: equipment?.status || '',
    readinessStatus,
    readinessLabel: READINESS_LABELS[readinessStatus] || READINESS_LABELS.unknown,
    readinessSeverity: READINESS_SEVERITY[readinessStatus] || READINESS_SEVERITY.unknown,
    blockers: candidates
      .filter(candidate => candidate.status !== 'ready')
      .map(candidate => candidate.reason)
      .filter(Boolean),
    recommendedAction: RECOMMENDED_ACTIONS[readinessStatus] || RECOMMENDED_ACTIONS.unknown,
    estimatedDailyRate: rate.estimatedDailyRate,
    estimatedDailyRateSource: rate.estimatedDailyRateSource,
    blockedSince,
    blockedDays,
    estimatedLoss,
    lossSeverity: lossSeverity(estimatedLoss),
    responsibleArea,
    financialRecommendation: financialRecommendation({ readinessStatus, estimatedDailyRate: rate.estimatedDailyRate, blockedDays, responsibleArea }),
    links,
  };
}

function topKey(totals) {
  return Object.entries(totals)
    .sort((left, right) => right[1] - left[1])[0]?.[0] || null;
}

function buildFleetReadinessReport(context = {}) {
  readinessIndexes(context);
  const items = asArray(context.equipment).map(equipment => calculateEquipmentReadiness(equipment, context));
  const summary = {
    total: items.length,
    ready: 0,
    needsCheck: 0,
    inService: 0,
    rented: 0,
    deliveryBlocked: 0,
    documentBlocked: 0,
    gsmAttention: 0,
    unknown: 0,
    loss: {
      totalEstimatedDailyLoss: 0,
      totalEstimatedLoss: 0,
      blockedItemsWithRate: 0,
      blockedItemsWithoutRate: 0,
      topLossStatus: null,
      topResponsibleArea: null,
    },
  };
  const lossByStatus = {};
  const lossByArea = {};
  for (const item of items) {
    const key = SUMMARY_KEYS[item.readinessStatus] || 'unknown';
    summary[key] = (summary[key] || 0) + 1;
    const blocked = item.readinessStatus !== 'ready' && item.readinessStatus !== 'rented';
    if (!blocked) continue;
    if (item.estimatedDailyRate === null) {
      summary.loss.blockedItemsWithoutRate += 1;
      continue;
    }
    summary.loss.blockedItemsWithRate += 1;
    summary.loss.totalEstimatedDailyLoss = roundMoney(summary.loss.totalEstimatedDailyLoss + item.estimatedDailyRate);
    if (item.estimatedLoss !== null) {
      summary.loss.totalEstimatedLoss = roundMoney(summary.loss.totalEstimatedLoss + item.estimatedLoss);
      lossByStatus[item.readinessStatus] = roundMoney((lossByStatus[item.readinessStatus] || 0) + item.estimatedLoss);
      lossByArea[item.responsibleArea] = roundMoney((lossByArea[item.responsibleArea] || 0) + item.estimatedLoss);
    }
  }
  summary.loss.topLossStatus = topKey(lossByStatus);
  summary.loss.topResponsibleArea = topKey(lossByArea);
  return { summary, items };
}

function actionPriority(item) {
  const estimatedLoss = Number(item?.estimatedLoss || 0);
  const blockedDays = Number(item?.blockedDays || 0);
  if (
    item?.lossSeverity === 'high' ||
    item?.lossSeverity === 'critical' ||
    estimatedLoss >= ACTION_QUEUE_HIGH_LOSS_THRESHOLD ||
    blockedDays >= ACTION_QUEUE_CRITICAL_BLOCKED_DAYS
  ) {
    return 'critical';
  }
  if (estimatedLoss > 0 && ['service', 'logistics', 'office'].includes(item?.responsibleArea)) {
    return 'high';
  }
  if (item?.estimatedDailyRate === null || item?.readinessStatus === 'needs_check') {
    return 'medium';
  }
  return 'low';
}

function actionDueHint(item) {
  if (item?.blockedDays >= ACTION_QUEUE_CRITICAL_BLOCKED_DAYS || item?.lossSeverity === 'critical') return 'Сегодня';
  if (item?.priority === 'critical') return 'Сегодня';
  if (item?.priority === 'high') return 'В течение 24 часов';
  if (item?.priority === 'medium') return 'На ближайшую смену';
  return 'Плановая проверка';
}

function actionTitle(item) {
  const model = [item?.model, item?.inventoryNumber].filter(Boolean).join(' / ') || item?.equipmentId || 'Техника';
  if (item?.readinessStatus === 'in_service') return `Вернуть из сервиса: ${model}`;
  if (item?.readinessStatus === 'delivery_blocked') return `Закрыть доставку: ${model}`;
  if (item?.readinessStatus === 'document_blocked') return `Закрыть документальный блокер: ${model}`;
  if (item?.readinessStatus === 'gsm_attention') return `Проверить GSM: ${model}`;
  if (item?.readinessStatus === 'needs_check') return `Проверить готовность: ${model}`;
  return `Уточнить статус: ${model}`;
}

function actionDescription(item) {
  const blockerText = Array.isArray(item?.blockers) && item.blockers.length > 0
    ? item.blockers.join('; ')
    : 'Блокер требует ручной проверки.';
  return [blockerText, item?.financialRecommendation || item?.recommendedAction]
    .filter(Boolean)
    .join(' ');
}

function buildManagementActionQueueFromReadiness(items = []) {
  const actionItems = asArray(items)
    .filter(item => item?.readinessStatus !== 'ready' && item?.readinessStatus !== 'rented')
    .filter(item => Array.isArray(item?.blockers) && item.blockers.length > 0)
    .map(item => {
      const priority = actionPriority(item);
      const action = {
        actionId: `equipment_readiness:${item.equipmentId || 'unknown'}:${item.readinessStatus}`,
        sourceType: 'equipment_readiness',
        equipmentId: item.equipmentId || '',
        title: actionTitle(item),
        description: actionDescription(item),
        priority,
        responsibleArea: ACTION_QUEUE_AREAS.includes(item.responsibleArea) ? item.responsibleArea : 'unknown',
        readinessStatus: item.readinessStatus || 'unknown',
        estimatedLoss: item.estimatedLoss,
        estimatedDailyLoss: item.estimatedDailyRate,
        blockedDays: item.blockedDays,
        dueHint: '',
        recommendedAction: item.recommendedAction || '',
        links: {
          equipment: item.links?.equipment,
          serviceTicket: item.links?.serviceTicket,
          rental: item.links?.rental,
          delivery: item.links?.delivery,
          document: item.links?.document,
        },
      };
      action.dueHint = actionDueHint(action);
      return action;
    })
    .sort((left, right) => {
      const priorityDiff = (ACTION_QUEUE_PRIORITIES[right.priority] || 0) - (ACTION_QUEUE_PRIORITIES[left.priority] || 0);
      if (priorityDiff !== 0) return priorityDiff;
      const lossDiff = Number(right.estimatedLoss || 0) - Number(left.estimatedLoss || 0);
      if (lossDiff !== 0) return lossDiff;
      const daysDiff = Number(right.blockedDays || 0) - Number(left.blockedDays || 0);
      if (daysDiff !== 0) return daysDiff;
      return Number(right.estimatedDailyLoss || 0) - Number(left.estimatedDailyLoss || 0);
    });

  const summary = {
    total: actionItems.length,
    critical: 0,
    high: 0,
    medium: 0,
    low: 0,
    totalEstimatedLoss: 0,
    totalDailyLoss: 0,
    byResponsibleArea: Object.fromEntries(ACTION_QUEUE_AREAS.map(area => [area, 0])),
  };

  for (const item of actionItems) {
    summary[item.priority] = (summary[item.priority] || 0) + 1;
    summary.totalEstimatedLoss = roundMoney(summary.totalEstimatedLoss + Number(item.estimatedLoss || 0));
    summary.totalDailyLoss = roundMoney(summary.totalDailyLoss + Number(item.estimatedDailyLoss || 0));
    summary.byResponsibleArea[item.responsibleArea] = (summary.byResponsibleArea[item.responsibleArea] || 0) + 1;
  }

  return { summary, items: actionItems };
}

function buildManagementActionQueue(context = {}) {
  const report = buildFleetReadinessReport(context);
  return buildManagementActionQueueFromReadiness(report.items);
}

module.exports = {
  READINESS_LABELS,
  READINESS_SEVERITY,
  RECOMMENDED_ACTIONS,
  PRIORITY,
  calculateEquipmentReadiness,
  buildReadinessIndexes,
  buildFleetReadinessReport,
  buildManagementActionQueue,
  buildManagementActionQueueFromReadiness,
};
