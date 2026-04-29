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

function addLookupValue(map, key, client) {
  const normalized = normalizeText(key);
  if (!normalized) return;
  const list = map.get(normalized) || [];
  list.push(client);
  map.set(normalized, list);
}

function addInnLookupValue(map, key, client) {
  const normalized = normalizeInn(key);
  if (!normalized) return;
  const list = map.get(normalized) || [];
  list.push(client);
  map.set(normalized, list);
}

function buildClientLookup(clients) {
  const byId = new Map();
  const byName = new Map();
  const byInn = new Map();

  (clients || []).forEach(client => {
    if (!client?.id) return;
    byId.set(String(client.id), client);
    addLookupValue(byName, getClientDisplayName(client), client);
    addLookupValue(byName, client.shortName, client);
    addLookupValue(byName, client.clientName, client);
    addInnLookupValue(byInn, client.inn, client);
  });

  return { byId, byName, byInn };
}

function uniqueClients(list) {
  const map = new Map();
  (list || []).forEach(client => {
    if (client?.id) map.set(String(client.id), client);
  });
  return Array.from(map.values());
}

function warnAmbiguous(logger, context, value, matches) {
  logger?.warn?.(
    `[client-links] ${context}: не удалось однозначно сопоставить клиента "${value}". ` +
    `Кандидаты: ${matches.map(item => `${item.id}:${getClientDisplayName(item)}`).join(', ')}`,
  );
}

function resolveClientForRecord(record, lookup, { logger = console, context = 'record' } = {}) {
  if (!record || typeof record !== 'object') return null;

  const stableId = getStableClientId(record);
  if (stableId) {
    return lookup.byId.get(stableId) || null;
  }

  const nameCandidates = [
    record.client,
    record.clientName,
    record.company,
    record.customer,
    record.customerName,
  ].map(normalizeText).filter(Boolean);

  for (const name of nameCandidates) {
    const matches = uniqueClients(lookup.byName.get(name));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) warnAmbiguous(logger, context, name, matches);
  }

  const innCandidates = [
    record.clientInn,
    record.customerInn,
    record.companyInn,
    record.inn,
  ].map(normalizeInn).filter(Boolean);

  for (const inn of innCandidates) {
    const matches = uniqueClients(lookup.byInn.get(inn));
    if (matches.length === 1) return matches[0];
    if (matches.length > 1) warnAmbiguous(logger, context, inn, matches);
  }

  return null;
}

function normalizeRecordClientLink(record, clients, {
  logger = console,
  context = 'record',
  relatedRentalsById,
} = {}) {
  if (!record || typeof record !== 'object') return record;
  const lookup = Array.isArray(clients) ? buildClientLookup(clients) : clients;
  const stableId = getStableClientId(record);

  if (stableId && lookup.byId.has(stableId)) {
    return record.clientId === stableId ? record : { ...record, clientId: stableId };
  }

  // IMPORTANT: rentalId is the safest recovery path for payments/documents. Name and INN
  // matching below is only a guarded legacy backfill path for old JSON without clientId.
  const relatedRentalId = firstNonEmpty(record.rentalId, record.rental);
  const relatedRental = relatedRentalId && relatedRentalsById?.get(relatedRentalId);
  const relatedClientId = getStableClientId(relatedRental);
  if (relatedClientId && lookup.byId.has(relatedClientId)) {
    return { ...record, clientId: relatedClientId };
  }

  const client = resolveClientForRecord(record, lookup, { logger, context });
  if (client?.id) {
    return { ...record, clientId: String(client.id) };
  }

  if (!stableId && firstNonEmpty(record.client, record.clientName, record.company, record.customerName)) {
    logger?.warn?.(
      `[client-links] ${context}: запись "${record.id || record.rentalId || record.number || 'без id'}" ` +
      `имеет клиента по названию, но clientId не найден`,
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
