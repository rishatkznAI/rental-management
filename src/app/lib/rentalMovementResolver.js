function text(value) {
  if (value && typeof value === 'object') return '';
  return String(value ?? '').trim();
}

function normalizeIdentifier(value) {
  return text(value)
    .toLowerCase()
    .replaceAll('ё', 'е')
    .replace(/\s+/g, ' ');
}

function compactIdentifier(value) {
  return normalizeIdentifier(value).replace(/\s+/g, '');
}

function firstText(...values) {
  return values.map(text).find(Boolean) || '';
}

function sourceId(source) {
  return text(source?.id || source?.movementId || source?.photoId);
}

function getRentalIds(source) {
  return [
    source?.rentalId,
    source?.ganttRentalId,
    source?.classicRentalId,
    source?.sourceRentalId,
    source?.originalRentalId,
  ].map(text).filter(Boolean);
}

function getDeliveryId(source) {
  return text(source?.deliveryId || source?.delivery?.id);
}

function getEquipmentId(source) {
  return text(source?.equipmentId || source?.equipment?.id);
}

function getInventoryNumber(source) {
  return firstText(
    source?.equipmentInventoryNumber,
    source?.inventoryNumber,
    source?.invNumber,
    source?.equipmentInv,
    source?.inv,
  );
}

function getSerialNumber(source) {
  return firstText(
    source?.equipmentSerialNumber,
    source?.serialNumber,
    source?.vin,
    source?.sn,
  );
}

function addEquipmentByIdentifier(index, value, equipment) {
  const normalized = normalizeIdentifier(value);
  const compact = compactIdentifier(value);
  if (normalized) {
    const list = index.get(normalized) || [];
    list.push(equipment);
    index.set(normalized, list);
  }
  if (compact && compact !== normalized) {
    const list = index.get(compact) || [];
    list.push(equipment);
    index.set(compact, list);
  }
}

function buildIndex(list, keyReader) {
  const index = new Map();
  list.forEach(item => {
    const keys = Array.isArray(keyReader(item)) ? keyReader(item) : [keyReader(item)];
    keys.map(text).filter(Boolean).forEach(key => {
      if (!index.has(key)) index.set(key, item);
    });
  });
  return index;
}

export function buildRentalMovementResolverContext({
  equipmentList = [],
  rentals = [],
  deliveries = [],
  clients = [],
  clientObjects = [],
} = {}) {
  const equipmentById = buildIndex(equipmentList, item => item?.id);
  const rentalById = buildIndex(rentals, rental => [
    rental?.id,
    rental?.rentalId,
    rental?.sourceRentalId,
    rental?.originalRentalId,
    rental?.classicRentalId,
  ]);
  const deliveryById = buildIndex(deliveries, delivery => delivery?.id);
  const clientById = buildIndex(clients, client => client?.id);
  const objectById = buildIndex(clientObjects, object => object?.id);
  const equipmentByInventory = new Map();
  const equipmentBySerial = new Map();

  equipmentList.forEach(equipment => {
    [
      equipment?.inventoryNumber,
      equipment?.equipmentInventoryNumber,
      equipment?.equipmentInv,
      equipment?.invNumber,
    ].forEach(value => addEquipmentByIdentifier(equipmentByInventory, value, equipment));
    [
      equipment?.serialNumber,
      equipment?.equipmentSerialNumber,
      equipment?.vin,
      equipment?.sn,
    ].forEach(value => addEquipmentByIdentifier(equipmentBySerial, value, equipment));
  });

  return {
    equipmentById,
    equipmentByInventory,
    equipmentBySerial,
    rentalById,
    deliveryById,
    clientById,
    objectById,
  };
}

function findRental(source, context) {
  return getRentalIds(source).map(id => context.rentalById.get(id)).find(Boolean) || null;
}

function findDelivery(source, context) {
  const deliveryId = getDeliveryId(source);
  return deliveryId ? context.deliveryById.get(deliveryId) || null : null;
}

function findUniqueByIdentifier(index, value) {
  const normalized = normalizeIdentifier(value);
  const compact = compactIdentifier(value);
  const matches = index.get(normalized) || (compact ? index.get(compact) : null) || [];
  return matches.length === 1 ? matches[0] : null;
}

function diagnosticReason({ missingEquipmentIds, triedLegacyIdentifier, hadAnyIdentifier }) {
  if (missingEquipmentIds.length > 0) {
    return 'Техника не найдена: equipmentId указывает на отсутствующую карточку';
  }
  if (triedLegacyIdentifier) {
    return 'Техника не найдена: SN/INV из источника не совпали с карточками техники';
  }
  if (!hadAnyIdentifier) {
    return 'Техника не найдена: нет equipmentId/SN/INV в источнике';
  }
  return 'Техника не найдена: связь не восстановлена';
}

export function resolveMovementEquipment(source, context) {
  const movementId = sourceId(source);
  const operationType = text(source?.type || source?.kind || source?.operationType || source?.operation);
  const sourceCollection = text(source?.sourceCollection || source?.source) || 'shipping_photos';
  const directEquipmentId = getEquipmentId(source);
  const directRental = findRental(source, context);
  const directDelivery = findDelivery(source, context);
  const deliveryRental = directDelivery ? findRental(directDelivery, context) : null;
  const missingEquipmentIds = [];
  const candidates = [];

  if (directEquipmentId) {
    candidates.push({ equipmentId: directEquipmentId, reason: 'direct_equipment_id' });
  }
  if (directRental && getEquipmentId(directRental)) {
    candidates.push({ equipmentId: getEquipmentId(directRental), reason: 'rental_equipment_id', rental: directRental });
  }
  if (directDelivery && getEquipmentId(directDelivery)) {
    candidates.push({ equipmentId: getEquipmentId(directDelivery), reason: 'delivery_equipment_id', delivery: directDelivery });
  }
  if (deliveryRental && getEquipmentId(deliveryRental)) {
    candidates.push({ equipmentId: getEquipmentId(deliveryRental), reason: 'delivery_rental_equipment_id', rental: deliveryRental, delivery: directDelivery });
  }

  for (const candidate of candidates) {
    const equipment = context.equipmentById.get(candidate.equipmentId);
    if (equipment) {
      const rental = candidate.rental || directRental || deliveryRental;
      const delivery = candidate.delivery || directDelivery;
      return {
        equipment,
        rental,
        delivery,
        equipmentId: equipment.id,
        equipmentNavigationId: equipment.id,
        reason: candidate.reason,
        diagnosticReason: '',
        diagnostic: {
          movementId,
          operationType,
          sourceCollection,
          equipmentId: candidate.equipmentId,
          rentalId: text(rental?.id || source?.rentalId || delivery?.rentalId),
          deliveryId: text(delivery?.id || source?.deliveryId),
          serialNumber: getSerialNumber(source),
          inventoryNumber: getInventoryNumber(source),
          foundRental: Boolean(rental),
          foundDelivery: Boolean(delivery),
          foundEquipment: true,
          reason: candidate.reason,
        },
      };
    }
    missingEquipmentIds.push(candidate.equipmentId);
  }

  const legacySources = [source, directDelivery, directRental, deliveryRental].filter(Boolean);
  const legacySerial = legacySources.map(getSerialNumber).find(Boolean) || '';
  const legacyInventory = legacySources.map(getInventoryNumber).find(Boolean) || '';
  const byInventory = findUniqueByIdentifier(context.equipmentByInventory, legacyInventory);
  const bySerial = findUniqueByIdentifier(context.equipmentBySerial, legacySerial);
  const legacyEquipment = byInventory || bySerial;
  const triedLegacyIdentifier = Boolean(legacyInventory || legacySerial);

  if (legacyEquipment) {
    return {
      equipment: legacyEquipment,
      rental: directRental || deliveryRental,
      delivery: directDelivery,
      equipmentId: legacyEquipment.id,
      equipmentNavigationId: legacyEquipment.id,
      reason: byInventory ? 'legacy_inventory_number' : 'legacy_serial_number',
      diagnosticReason: '',
      diagnostic: {
        movementId,
        operationType,
        sourceCollection,
        equipmentId: legacyEquipment.id,
        rentalId: text((directRental || deliveryRental)?.id || source?.rentalId || directDelivery?.rentalId),
        deliveryId: text(directDelivery?.id || source?.deliveryId),
        serialNumber: legacySerial,
        inventoryNumber: legacyInventory,
        foundRental: Boolean(directRental || deliveryRental),
        foundDelivery: Boolean(directDelivery),
        foundEquipment: true,
        reason: byInventory ? 'legacy_inventory_number' : 'legacy_serial_number',
      },
    };
  }

  const hadAnyIdentifier = Boolean(directEquipmentId || getRentalIds(source).length || getDeliveryId(source) || triedLegacyIdentifier);
  const reason = diagnosticReason({ missingEquipmentIds, triedLegacyIdentifier, hadAnyIdentifier });
  return {
    equipment: null,
    rental: directRental || deliveryRental,
    delivery: directDelivery,
    equipmentId: directEquipmentId,
    equipmentNavigationId: '',
    reason: 'not_found',
    diagnosticReason: reason,
    diagnostic: {
      movementId,
      operationType,
      sourceCollection,
      equipmentId: directEquipmentId,
      rentalId: text((directRental || deliveryRental)?.id || source?.rentalId || directDelivery?.rentalId),
      deliveryId: text(directDelivery?.id || source?.deliveryId),
      serialNumber: legacySerial,
      inventoryNumber: legacyInventory,
      foundRental: Boolean(directRental || deliveryRental),
      foundDelivery: Boolean(directDelivery),
      foundEquipment: false,
      reason,
    },
  };
}

export function resolveMovementClientObject(source, resolution, context) {
  const rental = resolution?.rental || null;
  const delivery = resolution?.delivery || null;
  const equipment = resolution?.equipment || null;
  const clientId = firstText(source?.clientId, delivery?.clientId, rental?.clientId);
  const objectId = firstText(source?.objectId, delivery?.objectId, rental?.objectId);
  const client = clientId ? context.clientById.get(clientId) : null;
  const object = objectId ? context.objectById.get(objectId) : null;
  const clientLabel = firstText(
    client?.company,
    client?.name,
    source?.client,
    source?.clientName,
    delivery?.client,
    delivery?.clientName,
    rental?.client,
    rental?.clientName,
    equipment?.currentClient,
  ) || (clientId ? 'Клиент не найден: clientId указывает на отсутствующую карточку' : 'Без клиента: нет clientId в источнике');
  const objectLabel = firstText(
    object?.name,
    object?.address,
    source?.objectName,
    source?.objectAddress,
    delivery?.objectName,
    delivery?.objectAddress,
    rental?.objectName,
    rental?.objectAddress,
  ) || (objectId ? 'Объект не найден: objectId указывает на отсутствующую карточку' : 'Объект не указан: нет objectId в источнике');

  return {
    client,
    object,
    clientId,
    objectId,
    clientLabel,
    objectLabel,
  };
}

export function getMovementEquipmentLabel(equipment, fallbackReason = '') {
  if (!equipment) return fallbackReason || 'Техника не найдена: нет equipmentId/SN/INV в источнике';
  const manufacturerModel = [equipment.manufacturer, equipment.model].map(text).filter(Boolean).join(' ').trim();
  if (manufacturerModel) return manufacturerModel;
  if (text(equipment.inventoryNumber)) return `INV ${text(equipment.inventoryNumber)}`;
  if (text(equipment.serialNumber)) return `SN ${text(equipment.serialNumber)}`;
  return 'Техника без названия';
}
