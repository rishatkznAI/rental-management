import { normalizePhotoReference } from './media-normalize.js';

const RECEIVING_OPERATION_ALIASES = new Set([
  'receiving',
  'acceptance',
  'return',
  'pickup',
  'inbound',
  'inspection',
  'receipt',
  'приемка',
  'приёмка',
  'возврат',
]);

const SHIPPING_OPERATION_ALIASES = new Set([
  'shipment',
  'shipping',
  'dispatch',
  'loading',
  'delivery',
  'outbound',
  'отправка',
  'отгрузка',
  'доставка',
]);

function text(value) {
  return String(value ?? '').trim();
}

function normalizeText(value) {
  return text(value).toLowerCase().replaceAll('ё', 'е');
}

function normalizeIdentifier(value) {
  return text(value).toLowerCase();
}

function normalizeKindFromValues(values) {
  const normalized = values.map(normalizeText).filter(Boolean);
  if (normalized.some(value => RECEIVING_OPERATION_ALIASES.has(value))) return 'receiving';
  if (normalized.some(value => SHIPPING_OPERATION_ALIASES.has(value))) return 'shipping';
  return 'unknown';
}

export function getDeliveryMovementKind(delivery) {
  if (!delivery) return 'unknown';
  return normalizeKindFromValues([
    delivery.type,
    delivery.kind,
    delivery.category,
    delivery.operationType,
    delivery.operation,
  ]);
}

export function getShippingPhotoMovementKind(event, delivery) {
  if (!event && !delivery) return 'unknown';
  const eventKind = normalizeKindFromValues([
    event?.type,
    event?.kind,
    event?.category,
    event?.operationType,
    event?.operation,
    event?.photoType,
  ]);
  return eventKind === 'unknown' ? getDeliveryMovementKind(delivery) : eventKind;
}

function getDate(source) {
  return text(
    source?.date
      || source?.transportDate
      || source?.neededBy
      || source?.completedAt
      || source?.createdAt
      || source?.updatedAt,
  ) || null;
}

function getRentalIds(source) {
  return [
    source?.rentalId,
    source?.ganttRentalId,
    source?.classicRentalId,
  ].map(text).filter(Boolean);
}

function getDeliveryId(source) {
  return text(source?.deliveryId || source?.id);
}

function getEquipmentInv(source) {
  return text(source?.equipmentInv || source?.inventoryNumber || source?.equipmentInventoryNumber || source?.invNumber);
}

function getEquipmentSerial(source) {
  return text(source?.serialNumber || source?.equipmentSerialNumber);
}

function isUsablePhotoReference(photo) {
  if (photo == null) return false;
  if (typeof photo === 'string') return photo.trim().length > 0;
  return typeof photo === 'object';
}

function collectPhotoReferences(source) {
  const photos = [
    source?.photo,
    ...(Array.isArray(source?.photos) ? source.photos : []),
    ...(Array.isArray(source?.deliveryPhotos) ? source.deliveryPhotos : []),
    ...(Array.isArray(source?.shippingPhotos) ? source.shippingPhotos : []),
    ...(Array.isArray(source?.receivingPhotos) ? source.receivingPhotos : []),
    ...(Array.isArray(source?.attachments) ? source.attachments : []),
  ];

  if (source?.photoCategories && typeof source.photoCategories === 'object') {
    Object.values(source.photoCategories).forEach(list => {
      if (Array.isArray(list)) photos.push(...list);
    });
  }

  return photos.filter(isUsablePhotoReference);
}

function photoKey(photo) {
  if (!photo) return '';
  if (typeof photo === 'string') return photo.trim();
  if (typeof photo !== 'object') return '';
  return text(
    photo.id
      || photo.photoId
      || photo.attachmentId
      || photo.url
      || photo.src
      || photo.path
      || photo.href
      || photo.fileUrl
      || photo.imageUrl
      || photo.thumbnailUrl
      || photo.previewUrl
      || photo.dataUrl
      || photo.base64
      || photo.attachmentUrl
      || photo.localPath
      || photo.originalUrl
      || photo.file?.url
      || photo.file?.path
      || photo.attachment?.url,
  );
}

function appendPhotos(target, refs, sourceId, apiBaseUrl) {
  const seen = new Set(target._photoKeys || []);
  refs.forEach((photo, index) => {
    const key = photoKey(photo) || `${sourceId}-${index}`;
    if (seen.has(key)) return;
    seen.add(key);
    target.photos.push(normalizePhotoReference(photo, {
      apiBaseUrl,
      idPrefix: `${target.id}-${sourceId}-${index}`,
    }));
    target.rawPhotos.push(photo);
  });
  target._photoKeys = seen;
}

function deliveryMatchesEquipment(delivery, context) {
  if (!delivery) return false;
  if (text(delivery.equipmentId) && text(delivery.equipmentId) === context.equipmentId) return true;
  if (getRentalIds(delivery).some(id => context.relatedRentalIds.has(id))) return true;
  const inv = normalizeIdentifier(getEquipmentInv(delivery));
  if (context.inventoryIsUnique && inv && inv === context.inventoryNumber) return true;
  const serial = normalizeIdentifier(getEquipmentSerial(delivery));
  if (serial && serial === context.serialNumber) return true;
  return false;
}

function shippingPhotoMatchesEquipment(event, context) {
  if (!event) return false;
  if (text(event.equipmentId) && text(event.equipmentId) === context.equipmentId) return true;
  if (getRentalIds(event).some(id => context.relatedRentalIds.has(id))) return true;
  if (text(event.deliveryId) && context.relatedDeliveryIds.has(text(event.deliveryId))) return true;
  const inv = normalizeIdentifier(getEquipmentInv(event));
  if (context.inventoryIsUnique && inv && inv === context.inventoryNumber) return true;
  const serial = normalizeIdentifier(getEquipmentSerial(event));
  if (serial && serial === context.serialNumber) return true;
  return false;
}

function sourceLabel(current, next) {
  if (!current) return next;
  if (current === next) return current;
  return 'mixed';
}

function eventSortValue(event) {
  const parsed = new Date(event.date || '').getTime();
  return Number.isNaN(parsed) ? 0 : parsed;
}

export function buildEquipmentMovementEvents({
  equipment,
  equipmentList = [],
  rentals = [],
  deliveries = [],
  shippingPhotos = [],
  apiBaseUrl = '',
} = {}) {
  if (!equipment) return [];

  const equipmentId = text(equipment.id);
  const inventoryNumber = normalizeIdentifier(equipment.inventoryNumber);
  const serialNumber = normalizeIdentifier(equipment.serialNumber);
  const inventoryCount = equipmentList.filter(item => normalizeIdentifier(item?.inventoryNumber) === inventoryNumber).length;
  const inventoryIsUnique = Boolean(inventoryNumber) && inventoryCount <= 1;
  const relatedRentalIds = new Set(
    rentals
      .filter(rental => {
        if (text(rental.equipmentId) === equipmentId) return true;
        if (inventoryIsUnique && normalizeIdentifier(rental.equipmentInv) === inventoryNumber) return true;
        if (serialNumber && normalizeIdentifier(rental.serialNumber) === serialNumber) return true;
        return false;
      })
      .map(rental => text(rental.id))
      .filter(Boolean),
  );

  const context = {
    equipmentId,
    inventoryNumber,
    serialNumber,
    inventoryIsUnique,
    relatedRentalIds,
    relatedDeliveryIds: new Set(),
  };

  const relatedDeliveries = deliveries.filter(delivery => deliveryMatchesEquipment(delivery, context));
  relatedDeliveries.forEach(delivery => context.relatedDeliveryIds.add(text(delivery.id)));

  const deliveryById = new Map(deliveries.map(delivery => [text(delivery.id), delivery]));
  const rentalById = new Map(rentals.map(rental => [text(rental.id), rental]));
  const events = new Map();

  const ensureEvent = (key, seed) => {
    if (!events.has(key)) {
      events.set(key, {
        id: seed.id,
        kind: seed.kind || 'unknown',
        type: seed.kind || 'unknown',
        date: seed.date || null,
        status: seed.status || null,
        equipmentId,
        rentalId: seed.rentalId || undefined,
        ganttRentalId: seed.ganttRentalId || undefined,
        deliveryId: seed.deliveryId || undefined,
        clientName: seed.clientName || undefined,
        objectName: seed.objectName || undefined,
        addressFrom: seed.addressFrom || undefined,
        addressTo: seed.addressTo || undefined,
        carrierName: seed.carrierName || undefined,
        comment: seed.comment || undefined,
        uploadedBy: seed.uploadedBy || undefined,
        hoursValue: seed.hoursValue,
        damageDescription: seed.damageDescription || undefined,
        checklist: seed.checklist || undefined,
        photoCategories: seed.photoCategories || undefined,
        rawPhotos: [],
        photos: [],
        source: seed.source,
        diagnostics: seed.diagnostics || [],
      });
    }
    return events.get(key);
  };

  relatedDeliveries.forEach(delivery => {
    const rentalId = text(delivery.rentalId || delivery.ganttRentalId || delivery.classicRentalId);
    const rental = rentalById.get(rentalId);
    const kind = getDeliveryMovementKind(delivery);
    const event = ensureEvent(`delivery:${delivery.id}`, {
      id: `delivery:${delivery.id}`,
      kind,
      date: getDate(delivery),
      status: text(delivery.status) || null,
      rentalId: text(delivery.rentalId) || text(delivery.classicRentalId) || undefined,
      ganttRentalId: text(delivery.ganttRentalId) || undefined,
      deliveryId: text(delivery.id),
      clientName: text(delivery.client || rental?.client),
      objectName: text(delivery.objectName || rental?.objectName || rental?.objectAddress),
      addressFrom: text(delivery.origin),
      addressTo: text(delivery.destination || delivery.objectAddress),
      carrierName: text(delivery.carrierName),
      comment: text(delivery.comment),
      uploadedBy: text(delivery.manager || delivery.carrierName || delivery.createdByName || delivery.createdBy || 'Доставка'),
      source: 'deliveries',
      diagnostics: text(delivery.equipmentId) ? [] : ['delivery linked through rental or legacy equipment identifier'],
    });
    appendPhotos(event, collectPhotoReferences(delivery), `delivery-${delivery.id}`, apiBaseUrl);
  });

  shippingPhotos
    .filter(event => shippingPhotoMatchesEquipment(event, context))
    .forEach(photoEvent => {
      const delivery = text(photoEvent.deliveryId) ? deliveryById.get(text(photoEvent.deliveryId)) : null;
      const kind = getShippingPhotoMovementKind(photoEvent, delivery);
      const deliveryId = text(photoEvent.deliveryId || delivery?.id);
      const rentalId = text(photoEvent.rentalId || delivery?.rentalId || delivery?.classicRentalId);
      const ganttRentalId = text(photoEvent.ganttRentalId || delivery?.ganttRentalId);
      const rental = rentalById.get(rentalId || ganttRentalId);
      const key = deliveryId ? `delivery:${deliveryId}` : `shipping_photo:${photoEvent.id}`;
      const event = ensureEvent(key, {
        id: deliveryId ? `delivery:${deliveryId}` : `shipping_photo:${photoEvent.id}`,
        kind,
        date: getDate(photoEvent) || getDate(delivery),
        status: text(delivery?.status) || null,
        rentalId: rentalId || undefined,
        ganttRentalId: ganttRentalId || undefined,
        deliveryId: deliveryId || undefined,
        clientName: text(delivery?.client || rental?.client),
        objectName: text(delivery?.objectName || rental?.objectName || rental?.objectAddress),
        addressFrom: text(delivery?.origin),
        addressTo: text(delivery?.destination || delivery?.objectAddress),
        carrierName: text(delivery?.carrierName),
        comment: text(photoEvent.comment || delivery?.comment),
        uploadedBy: text(photoEvent.uploadedBy || delivery?.manager || delivery?.carrierName),
        hoursValue: photoEvent.hoursValue,
        damageDescription: text(photoEvent.damageDescription),
        checklist: photoEvent.checklist,
        photoCategories: photoEvent.photoCategories,
        source: deliveryId ? 'mixed' : 'shipping_photos',
        diagnostics: text(photoEvent.equipmentId) ? [] : ['shipping photo linked through delivery, rental, serial, or inventory fallback'],
      });

      event.kind = event.kind === 'unknown' ? kind : event.kind;
      event.type = event.kind;
      event.date = event.date || getDate(photoEvent) || getDate(delivery);
      event.status = event.status || text(delivery?.status) || null;
      event.rentalId = event.rentalId || rentalId || undefined;
      event.ganttRentalId = event.ganttRentalId || ganttRentalId || undefined;
      event.deliveryId = event.deliveryId || deliveryId || undefined;
      event.clientName = event.clientName || text(delivery?.client || rental?.client) || undefined;
      event.objectName = event.objectName || text(delivery?.objectName || rental?.objectName || rental?.objectAddress) || undefined;
      event.addressFrom = event.addressFrom || text(delivery?.origin) || undefined;
      event.addressTo = event.addressTo || text(delivery?.destination || delivery?.objectAddress) || undefined;
      event.carrierName = event.carrierName || text(delivery?.carrierName) || undefined;
      event.comment = event.comment || text(photoEvent.comment || delivery?.comment) || undefined;
      event.uploadedBy = event.uploadedBy || text(photoEvent.uploadedBy || delivery?.manager || delivery?.carrierName) || undefined;
      event.hoursValue = event.hoursValue ?? photoEvent.hoursValue;
      event.damageDescription = event.damageDescription || text(photoEvent.damageDescription) || undefined;
      event.checklist = event.checklist || photoEvent.checklist;
      event.photoCategories = event.photoCategories || photoEvent.photoCategories;
      event.source = sourceLabel(event.source, deliveryId ? 'mixed' : 'shipping_photos');
      appendPhotos(event, collectPhotoReferences(photoEvent), `shipping-photo-${photoEvent.id}`, apiBaseUrl);
    });

  return [...events.values()]
    .map(event => {
      const { _photoKeys, ...clean } = event;
      return clean;
    })
    .sort((a, b) => eventSortValue(b) - eventSortValue(a));
}
