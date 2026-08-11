function normalizeText(value) {
  return String(value || '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function normalizeInn(value) {
  return String(value || '').replace(/\D/g, '');
}

function firstNonEmpty(...values) {
  for (const value of values) {
    const text = String(value || '').trim();
    if (text) return text;
  }
  return '';
}

function getStableClientId(record) {
  return firstNonEmpty(record?.clientId, record?.customerId, record?.client_id);
}

function getClientDisplayName(client) {
  return firstNonEmpty(client?.company, client?.name, client?.clientName);
}

function buildClientLookup(clients) {
  const byId = new Map();

  (clients || []).forEach(client => {
    if (!client?.id) return;
    byId.set(String(client.id), client);
  });

  return { byId };
}

function resolveClientForRecord(record, lookup, { logger = console, context = 'record' } = {}) {
  if (!record || typeof record !== 'object') return null;
  const clientLookup = Array.isArray(lookup) ? buildClientLookup(lookup) : lookup;

  const stableId = getStableClientId(record);
  if (stableId) {
    return clientLookup?.byId?.get(stableId) || null;
  }
  if (firstNonEmpty(record.client, record.clientName, record.company, record.customerName)
    || firstNonEmpty(record.clientInn, record.customerInn, record.companyInn, record.inn)) {
    logger?.warn?.(
      `[client-links] ${context}: clientId отсутствует; сопоставление по названию/ИНН запрещено`,
    );
  }
  return null;
}

function normalizeRecordClientLink(record, clients, {
  logger = console,
  context = 'record',
  relatedRentalsById,
  allowLegacyRecovery = true,
} = {}) {
  if (!record || typeof record !== 'object') return record;
  const lookup = Array.isArray(clients) ? buildClientLookup(clients) : clients;
  const stableId = getStableClientId(record);

  if (stableId && lookup.byId.has(stableId)) {
    return record.clientId === stableId ? record : { ...record, clientId: stableId };
  }
  if (stableId) {
    logger?.warn?.(`[client-links] ${context}: clientId "${stableId}" не найден; автоматическое исправление отключено`);
    return record;
  }
  if (!allowLegacyRecovery) {
    if (firstNonEmpty(record.client, record.clientName, record.company, record.customerName)
      || firstNonEmpty(record.clientInn, record.customerInn, record.companyInn, record.inn)) {
      logger?.warn?.(
        `[client-links] ${context}: clientId отсутствует; legacy-сопоставление по названию/ИНН в production write отключено`,
      );
    }
    return record;
  }

  // IMPORTANT: rentalId -> rental.clientId is the only permitted recovery path.
  // Editable labels and registration identifiers never establish a relation.
  const relatedRentalId = firstNonEmpty(record.rentalId, record.rental);
  const relatedRental = relatedRentalId && relatedRentalsById?.get(relatedRentalId);
  const relatedClientId = getStableClientId(relatedRental);
  if (relatedClientId && lookup.byId.has(relatedClientId)) {
    return { ...record, clientId: relatedClientId };
  }

  if (!stableId && (
    firstNonEmpty(record.client, record.clientName, record.company, record.customerName)
    || firstNonEmpty(record.clientInn, record.customerInn, record.companyInn, record.inn)
  )) {
    logger?.warn?.(
      `[client-links] ${context}: запись "${record.id || record.rentalId || record.number || 'без id'}" ` +
      'не имеет clientId; сопоставление по названию/ИНН запрещено',
    );
  }

  return record;
}

function normalizeCollectionClientLinks(name, list, clients, options = {}) {
  const next = [];
  let changed = 0;
  const lookup = Array.isArray(clients) ? buildClientLookup(clients) : clients;

  (Array.isArray(list) ? list : []).forEach(item => {
    const normalized = normalizeRecordClientLink(item, lookup, {
      ...options,
      context: `${name}:${item?.id || item?.rentalId || item?.number || 'без id'}`,
    });
    if (normalized !== item) changed += 1;
    next.push(normalized);
  });

  return { list: next, changed };
}

function buildRentalClientMap(rentals, ganttRentals) {
  const map = new Map();
  [...(rentals || []), ...(ganttRentals || [])].forEach(item => {
    if (item?.id) map.set(String(item.id), item);
  });
  return map;
}

function normalizeClientLinks({ readData, writeData, logger = console }) {
  const clients = readData('clients') || [];
  if (!Array.isArray(clients) || clients.length === 0) return { changed: 0 };

  let totalChanged = 0;
  const lookup = buildClientLookup(clients);

  const rentalsResult = normalizeCollectionClientLinks('rentals', readData('rentals') || [], lookup, { logger });
  if (rentalsResult.changed > 0) {
    writeData('rentals', rentalsResult.list);
    totalChanged += rentalsResult.changed;
  }

  const ganttResult = normalizeCollectionClientLinks('gantt_rentals', readData('gantt_rentals') || [], lookup, { logger });
  if (ganttResult.changed > 0) {
    writeData('gantt_rentals', ganttResult.list);
    totalChanged += ganttResult.changed;
  }

  const relatedRentalsById = buildRentalClientMap(rentalsResult.list, ganttResult.list);
  for (const collection of ['payments', 'documents', 'crm_deals']) {
    const result = normalizeCollectionClientLinks(collection, readData(collection) || [], lookup, {
      logger,
      relatedRentalsById,
    });
    if (result.changed > 0) {
      writeData(collection, result.list);
      totalChanged += result.changed;
    }
  }

  if (totalChanged > 0) {
    logger?.log?.(`[client-links] clientId нормализован в связанных записях: ${totalChanged}`);
  }
  return { changed: totalChanged };
}

module.exports = {
  normalizeText,
  normalizeInn,
  getStableClientId,
  getClientDisplayName,
  buildClientLookup,
  resolveClientForRecord,
  normalizeRecordClientLink,
  normalizeCollectionClientLinks,
  normalizeClientLinks,
};
