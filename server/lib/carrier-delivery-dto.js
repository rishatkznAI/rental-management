const CLOSED_DELIVERY_STATUSES = new Set(['completed', 'cancelled']);

const DELIVERY_STATUS_LABELS = {
  new: 'Новая',
  sent: 'Отправлена',
  accepted: 'Принята',
  in_transit: 'В пути',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

function deliveryTypeLabel(type) {
  return type === 'receiving' ? 'Приёмка' : 'Отгрузка';
}

function isClosedDelivery(delivery) {
  return CLOSED_DELIVERY_STATUSES.has(String(delivery?.status || '').trim().toLowerCase());
}

function normalizeId(value) {
  return String(value || '').trim();
}

function resolveDeliveryCarrierId(delivery) {
  return normalizeId(delivery?.carrierId || delivery?.assignedCarrierId || delivery?.carrierKey);
}

function resolveBotUserCarrierId(botUser) {
  return normalizeId(botUser?.carrierId || botUser?.assignedCarrierId || botUser?.carrierKey);
}

function isCarrierBotUser(botUser) {
  if (!botUser) return false;
  const role = String(botUser.role || '').trim().toLowerCase();
  const userRole = String(botUser.userRole || '').trim().toLowerCase();
  const mode = String(botUser.botMode || '').trim().toLowerCase();
  return botUser.isActive !== false &&
    (role === 'carrier' || userRole === 'перевозчик' || mode === 'delivery') &&
    Boolean(resolveBotUserCarrierId(botUser));
}

function canCarrierAccessDelivery(delivery, botUser) {
  if (!delivery || !isCarrierBotUser(botUser)) return false;
  return resolveDeliveryCarrierId(delivery) === resolveBotUserCarrierId(botUser);
}

function uniq(values) {
  const seen = new Set();
  return values
    .map(value => String(value || '').trim())
    .filter(Boolean)
    .filter(value => {
      const key = value.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
}

function equipmentModelText(delivery, equipment = null) {
  const structuredModel = uniq([
    equipment?.manufacturer,
    equipment?.brand,
    equipment?.model,
  ]).join(' ');
  if (structuredModel) return structuredModel;

  const deliveryModel = uniq([
    delivery?.equipmentLabel,
    delivery?.equipmentModel,
  ]).join(' ');
  return deliveryModel || String(delivery?.cargo || '').trim() || 'Техника не указана';
}

function equipmentReferenceText(delivery, equipment = null) {
  const refs = [];
  const inventory = uniq([
    delivery?.equipmentInv,
    delivery?.inventoryNumber,
    equipment?.inventoryNumber,
    equipment?.inv,
  ]);
  const serials = uniq([
    delivery?.equipmentSn,
    delivery?.serialNumber,
    equipment?.serialNumber,
    equipment?.sn,
  ]);
  inventory.forEach(value => refs.push(`INV ${value}`));
  serials.forEach(value => refs.push(`SN ${value}`));
  return uniq(refs).join(' · ');
}

function formatEquipmentForCarrier(delivery, equipment = null) {
  const model = equipmentModelText(delivery, equipment);
  const refs = equipmentReferenceText(delivery, equipment);
  return refs ? `${model} · ${refs}` : model;
}

function stripInternalCommentLines(value) {
  return String(value || '')
    .split('\n')
    .map(line => line.trim())
    .filter(line => line && !/Статус через MAX|Проблема через MAX|Комментарий перевозчика через MAX/i.test(line))
    .join('\n')
    .trim();
}

function driverCommentForCarrier(delivery) {
  return uniq([
    delivery?.managerComment,
    delivery?.comment,
    delivery?.driverComment,
    delivery?.driverNote,
    delivery?.carrierComment,
  ].map(stripInternalCommentLines)).join('\n');
}

function toCarrierDeliveryDto(delivery, options = {}) {
  const equipment = options.equipment || null;
  return {
    number: delivery?.number || delivery?.deliveryNumber || delivery?.id || '',
    type: delivery?.type === 'receiving' ? 'receiving' : 'shipping',
    operationType: deliveryTypeLabel(delivery?.type),
    transportDate: delivery?.transportDate || '',
    neededBy: delivery?.neededBy || null,
    equipment: formatEquipmentForCarrier(delivery, equipment),
    origin: delivery?.origin || '',
    destination: delivery?.destination || '',
    contactName: delivery?.contactName || '',
    contactPhone: delivery?.contactPhone || '',
    driverComment: driverCommentForCarrier(delivery),
    status: delivery?.status || 'new',
    statusLabel: DELIVERY_STATUS_LABELS[delivery?.status] || delivery?.status || 'Новая',
  };
}

function formatCarrierDeliveryMessage(delivery, options = {}) {
  const dto = toCarrierDeliveryDto(delivery, options);
  return [
    dto.type === 'receiving' ? 'Приёмка' : 'Отгрузка',
    `Доставка: ${dto.number}`,
    `Статус: ${dto.statusLabel}`,
    `Дата: ${dto.transportDate || 'не указана'}`,
    dto.neededBy ? `Дедлайн: ${dto.neededBy}` : null,
    `Техника: ${dto.equipment}`,
    `Откуда: ${dto.origin || 'не указано'}`,
    `Куда: ${dto.destination || 'не указано'}`,
    `Контакт: ${[dto.contactName, dto.contactPhone].filter(Boolean).join(' · ') || 'не указан'}`,
    dto.driverComment ? `Комментарий менеджера: ${dto.driverComment}` : null,
  ].filter(Boolean).join('\n');
}

function formatCarrierDeliveryList(deliveries, options = {}) {
  const list = Array.isArray(deliveries) ? deliveries : [];
  if (!list.length) {
    return [
      'У вас пока нет активных доставок.',
      '',
      'Как только офис назначит новую доставку, здесь появятся заявки и статусы.',
    ].join('\n');
  }

  const getEquipment = typeof options.getEquipment === 'function' ? options.getEquipment : () => null;
  const lines = list.slice(0, 10).map((delivery, index) => {
    const dto = toCarrierDeliveryDto(delivery, { equipment: getEquipment(delivery) });
    return [
      `${index + 1}. ${dto.operationType} · ${dto.number}`,
      `   Дата: ${dto.transportDate || 'не указана'}${dto.neededBy ? ` · дедлайн: ${dto.neededBy}` : ''}`,
      `   Техника: ${dto.equipment}`,
      `   ${dto.origin || 'не указано'} -> ${dto.destination || 'не указано'}`,
      `   Контакт: ${[dto.contactName, dto.contactPhone].filter(Boolean).join(' · ') || 'не указан'}`,
      dto.driverComment ? `   Комментарий менеджера: ${dto.driverComment}` : null,
      `   Статус: ${dto.statusLabel}`,
    ].filter(Boolean).join('\n');
  });

  return [
    `Мои доставки (${list.length})`,
    '',
    ...lines,
    list.length > 10 ? `... и ещё ${list.length - 10}` : '',
  ].filter(Boolean).join('\n');
}

module.exports = {
  CLOSED_DELIVERY_STATUSES,
  DELIVERY_STATUS_LABELS,
  canCarrierAccessDelivery,
  deliveryTypeLabel,
  formatCarrierDeliveryList,
  formatCarrierDeliveryMessage,
  isCarrierBotUser,
  isClosedDelivery,
  resolveBotUserCarrierId,
  resolveDeliveryCarrierId,
  toCarrierDeliveryDto,
};
