const { normalizeDocumentType } = require('./document-registry');
const { yearFromIso } = require('./number-sequences');

const COLLECTION_ENTITY_TYPES = Object.freeze({
  rentals: 'RENTAL',
  service: 'SERVICE_TICKET',
  deliveries: 'DELIVERY',
  warranty_claims: 'WARRANTY_CLAIM',
  client_contracts: 'CLIENT_CONTRACT',
  vehicle_trips: 'VEHICLE_TRIP',
});

const DOCUMENT_ENTITY_TYPES = Object.freeze({
  rental_specification: 'RENTAL_SPECIFICATION',
  transfer_act_to_client: 'TRANSFER_ACT_TO_CLIENT',
  return_act_from_client: 'RETURN_ACT_FROM_CLIENT',
  work_order: 'WORK_ORDER',
  invoice: 'INVOICE',
});

const OWNED_DOCUMENT_TYPES = new Set(['rental_contract', 'trip_ticket']);

function text(value) {
  return String(value ?? '').trim();
}

function businessNumberingError(code, message, status = 409, details = undefined) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  if (details !== undefined) error.details = details;
  return error;
}

function ownNonEmpty(input, field) {
  return Object.prototype.hasOwnProperty.call(input || {}, field) && Boolean(text(input?.[field]));
}

function assertBusinessNumberNotProvided(input, {
  fields = ['number'],
  message = 'Номер присваивается сервером после создания записи.',
} = {}) {
  const supplied = fields.find(field => ownNonEmpty(input, field));
  if (!supplied) return;
  throw businessNumberingError('BUSINESS_NUMBER_SERVER_OWNED', message, 400, { field: supplied });
}

function recordNumber(collection, record) {
  if (collection === 'documents') return text(record?.number || record?.documentNumber);
  if (collection === 'vehicle_trips') return text(record?.number || record?.sheetNumber);
  return text(record?.number);
}

function setRecordNumber(collection, record, number) {
  record.number = number;
  if (collection === 'documents') record.documentNumber = number;
  if (collection === 'vehicle_trips') record.sheetNumber = number;
  return record;
}

function documentSequenceYear(record, fallbackIso = new Date().toISOString()) {
  return yearFromIso(record?.documentDate || record?.date || fallbackIso);
}

function createBusinessNumberingService({
  allocator,
  readData,
  nowIso = () => new Date().toISOString(),
} = {}) {
  if (!allocator || typeof allocator.allocate !== 'function') {
    throw businessNumberingError('NUMBERING_ALLOCATOR_REQUIRED', 'Business numbering allocator is required.', 500);
  }
  if (typeof readData !== 'function') {
    throw businessNumberingError('NUMBERING_READ_DATA_REQUIRED', 'Business numbering requires readData.', 500);
  }

  function allocateRecord(collection, record, entityType, year = undefined) {
    const entityId = text(record?.id);
    if (!entityId) {
      throw businessNumberingError(
        'BUSINESS_NUMBER_ENTITY_ID_REQUIRED',
        'Номер нельзя присвоить до создания canonical ID.',
        500,
        { collection },
      );
    }
    const allocation = allocator.allocate({ entityType, entityId, year });
    return setRecordNumber(collection, record, allocation.number);
  }

  function findPendingRecord(entries, collection, id) {
    const normalizedId = text(id);
    if (!normalizedId) return null;
    for (const entry of entries || []) {
      if (entry?.name !== collection || !Array.isArray(entry.value)) continue;
      const match = entry.value.find(item => text(item?.id) === normalizedId);
      if (match) return match;
    }
    return null;
  }

  function resolveOwnerRecord(entries, collection, id) {
    return findPendingRecord(entries, collection, id)
      || (readData(collection) || []).find(item => text(item?.id) === text(id))
      || null;
  }

  function assignOwnedDocumentNumber(record, entries) {
    const documentType = normalizeDocumentType(record?.documentType || record?.type);
    if (documentType === 'rental_contract') {
      const contractId = text(record?.contractId);
      const contract = resolveOwnerRecord(entries, 'client_contracts', contractId);
      const ownerNumber = recordNumber('client_contracts', contract);
      if (!contractId || !contract || !ownerNumber) {
        throw businessNumberingError(
          'DOCUMENT_CLIENT_CONTRACT_REQUIRED',
          'Документ договора аренды должен ссылаться на пронумерованный ClientContract.',
          409,
          { contractId: contractId || null },
        );
      }
      return setRecordNumber('documents', record, ownerNumber);
    }

    const vehicleTripId = text(record?.vehicleTripId);
    const vehicleTrip = resolveOwnerRecord(entries, 'vehicle_trips', vehicleTripId);
    const ownerNumber = recordNumber('vehicle_trips', vehicleTrip);
    if (!vehicleTripId || !vehicleTrip || !ownerNumber) {
      throw businessNumberingError(
        'DOCUMENT_VEHICLE_TRIP_REQUIRED',
        'Документ путевого листа должен ссылаться на пронумерованный VehicleTrip.',
        409,
        { vehicleTripId: vehicleTripId || null },
      );
    }
    return setRecordNumber('documents', record, ownerNumber);
  }

  function assignNewRecord(collection, record, entries = []) {
    if (collection === 'gantt_rentals') {
      const rentalId = text(record?.rentalId || record?.sourceRentalId || record?.originalRentalId);
      const rental = resolveOwnerRecord(entries, 'rentals', rentalId);
      const rentalNumber = recordNumber('rentals', rental);
      if (rentalNumber) setRecordNumber('gantt_rentals', record, rentalNumber);
      return record;
    }

    if (collection === 'documents') {
      const documentType = normalizeDocumentType(record?.documentType || record?.type);
      if (OWNED_DOCUMENT_TYPES.has(documentType)) {
        return assignOwnedDocumentNumber(record, entries);
      }
      const entityType = DOCUMENT_ENTITY_TYPES[documentType];
      if (!entityType) return record;
      return allocateRecord(collection, record, entityType, documentSequenceYear(record, nowIso()));
    }

    const entityType = COLLECTION_ENTITY_TYPES[collection];
    if (!entityType) return record;
    // Operational entities use the actual server-side creation year. Payload dates and
    // client-provided createdAt values are intentionally ignored here.
    return allocateRecord(collection, record, entityType, yearFromIso(nowIso()));
  }

  function preserveOrRejectExistingNumber(collection, previous, next) {
    const previousNumber = recordNumber(collection, previous);
    const requestedNumber = recordNumber(collection, next);
    if (!previousNumber) {
      if (requestedNumber) {
        throw businessNumberingError(
          'BUSINESS_NUMBER_IMMUTABLE',
          'Нельзя вручную присвоить номер существующей записи.',
          409,
          { collection, entityId: next?.id },
        );
      }
      return next;
    }
    if (collection === 'documents') {
      const previousType = normalizeDocumentType(previous?.documentType || previous?.type);
      const nextType = normalizeDocumentType(next?.documentType || next?.type);
      const previousTypeIsManaged = Boolean(DOCUMENT_ENTITY_TYPES[previousType])
        || OWNED_DOCUMENT_TYPES.has(previousType);
      if (previousTypeIsManaged && previousType !== nextType) {
        throw businessNumberingError(
          'BUSINESS_DOCUMENT_TYPE_IMMUTABLE',
          'Тип документа с присвоенным business number нельзя изменить.',
          409,
          { entityId: next?.id, previousType, requestedType: nextType },
        );
      }
      if (OWNED_DOCUMENT_TYPES.has(previousType)) {
        const ownerField = previousType === 'rental_contract' ? 'contractId' : 'vehicleTripId';
        const previousOwnerId = text(previous?.[ownerField]);
        const requestedOwnerId = text(next?.[ownerField]);
        if (!previousOwnerId || requestedOwnerId !== previousOwnerId) {
          throw businessNumberingError(
            'BUSINESS_DOCUMENT_OWNER_IMMUTABLE',
            'Master-сущность документа с присвоенным номером не может быть заменена.',
            409,
            { entityId: next?.id, ownerField, previousOwnerId, requestedOwnerId },
          );
        }
      }
    }
    if (requestedNumber && requestedNumber !== previousNumber) {
      throw businessNumberingError(
        'BUSINESS_NUMBER_IMMUTABLE',
        'Присвоенный номер нельзя изменить.',
        409,
        { collection, entityId: next?.id, previousNumber, requestedNumber },
      );
    }
    return setRecordNumber(collection, next, previousNumber);
  }

  function prepareCollectionEntry(entry, allEntries) {
    const collection = text(entry?.name);
    if (!Array.isArray(entry?.value)) return entry;
    if (
      !COLLECTION_ENTITY_TYPES[collection]
      && collection !== 'documents'
      && collection !== 'gantt_rentals'
    ) return entry;

    const previousById = new Map(
      (readData(collection) || [])
        .filter(item => text(item?.id))
        .map(item => [text(item.id), item]),
    );
    for (const record of entry.value) {
      const entityId = text(record?.id);
      if (!entityId || !record || typeof record !== 'object') continue;
      const previous = previousById.get(entityId);
      if (previous) preserveOrRejectExistingNumber(collection, previous, record);
      else assignNewRecord(collection, record, allEntries);
    }
    return entry;
  }

  function preparePersistenceEntries(entries = []) {
    const normalized = Array.isArray(entries) ? entries : [];
    const ordered = [
      ...normalized.filter(entry => entry?.name !== 'documents' && entry?.name !== 'gantt_rentals'),
      ...normalized.filter(entry => entry?.name === 'gantt_rentals'),
      ...normalized.filter(entry => entry?.name === 'documents'),
    ];
    ordered.forEach(entry => prepareCollectionEntry(entry, normalized));
    return normalized;
  }

  return Object.freeze({
    assignNewRecord,
    preparePersistenceEntries,
  });
}

module.exports = {
  COLLECTION_ENTITY_TYPES,
  DOCUMENT_ENTITY_TYPES,
  OWNED_DOCUMENT_TYPES,
  assertBusinessNumberNotProvided,
  businessNumberingError,
  createBusinessNumberingService,
  documentSequenceYear,
  recordNumber,
  setRecordNumber,
};
