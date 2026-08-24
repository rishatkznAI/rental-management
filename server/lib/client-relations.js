const {
  resolveDomainCounterpartyRelation,
} = require('./counterparty-relations');
const {
  canonicalizeClientContractCounterpartyRelation,
} = require('./document-counterparty-relations');
const { counterpartyError } = require('./counterparty');

const OBJECT_REQUIRED_ERROR = 'Для объекта укажите clientId или counterpartyId и название';
const CONTRACT_REQUIRED_ERROR = 'Для договора клиента укажите Counterparty/Client и номер договора';
const ORPHAN_CLIENT_ERROR = 'Клиент для записи не найден';
const ORPHAN_OBJECT_ERROR = 'Объект клиента не найден или не принадлежит клиенту';
const ORPHAN_CONTRACT_ERROR = 'Договор клиента не найден или не принадлежит клиенту';
const ARCHIVED_OBJECT_ERROR = 'Архивный объект нельзя выбрать для новой записи';
const REQUIRED_RENTAL_RELATIONS_ERROR = 'Для аренды укажите клиента и договор';

function text(value) {
  return String(value ?? '').trim();
}

function assertTextLength(value, maxLength, label) {
  if (value.length <= maxLength) return;
  const error = new Error(`${label}: максимум ${maxLength} символов`);
  error.status = 400;
  throw error;
}

function normalizeStatus(value) {
  return text(value) === 'archived' ? 'archived' : 'active';
}

function findById(list, id) {
  const key = text(id);
  if (!key) return null;
  return (list || []).find(item => text(item?.id) === key) || null;
}

function readCollection(data, name) {
  if (typeof data === 'function') return data(name) || [];
  if (data && typeof data.readData === 'function') return data.readData(name) || [];
  return data?.[name] || [];
}

function getClientObjectById(data, objectId) {
  return findById(readCollection(data, 'client_objects'), objectId);
}

function getClientContractById(data, contractId) {
  return findById(readCollection(data, 'client_contracts'), contractId);
}

function assertClientExists(readData, clientId) {
  const client = findById(readData('clients') || [], clientId);
  if (!client) {
    const error = new Error(ORPHAN_CLIENT_ERROR);
    error.status = 400;
    throw error;
  }
  return client;
}

function assertObjectBelongsToClient(readData, objectId, clientId) {
  const id = text(objectId);
  if (!id) return null;
  const object = getClientObjectById(readData, id);
  if (!object || text(object.clientId) !== text(clientId)) {
    const error = new Error(ORPHAN_OBJECT_ERROR);
    error.status = 400;
    throw error;
  }
  return object;
}

function assertContractBelongsToClient(readData, contractId, clientId) {
  const id = text(contractId);
  if (!id) return null;
  const contract = getClientContractById(readData, id);
  if (!contract || text(contract.clientId) !== text(clientId)) {
    const error = new Error(ORPHAN_CONTRACT_ERROR);
    error.status = 400;
    throw error;
  }
  return contract;
}

function assertContractObjectConsistency(readData, contractId, objectId, clientId) {
  const contract = assertContractBelongsToClient(readData, contractId, clientId);
  if (!contract) return null;
  const currentObjectId = text(objectId);
  if (currentObjectId) assertObjectBelongsToClient(readData, currentObjectId, clientId);
  for (const linkedObjectId of contractObjectIds(contract)) {
    assertObjectBelongsToClient(readData, linkedObjectId, clientId);
  }
  return contract;
}

function contractObjectIds(contract) {
  const ids = new Set();
  const add = value => {
    const id = text(value);
    if (id) ids.add(id);
  };
  add(contract?.objectId);
  if (Array.isArray(contract?.objectIds)) contract.objectIds.forEach(add);
  return [...ids];
}

function normalizeClientRelationLinks(payload, clientId, options = {}) {
  const data = options.readData || options.data;
  if (!data) return payload;
  const resolvedClientId = text(clientId || payload?.clientId);
  const objectId = text(payload?.objectId);
  const contractId = text(payload?.contractId);
  if (options.requireRentalRelations && (!resolvedClientId || !contractId)) {
    const error = new Error(REQUIRED_RENTAL_RELATIONS_ERROR);
    error.status = 400;
    throw error;
  }
  if (!resolvedClientId && (objectId || contractId)) {
    const error = new Error(ORPHAN_CLIENT_ERROR);
    error.status = 400;
    throw error;
  }
  let object = null;
  if (objectId) {
    object = assertObjectBelongsToClient(data, objectId, resolvedClientId);
    const allowArchived = options.allowArchivedObjectIds?.has?.(objectId) || options.allowArchivedObjectId === objectId;
    if (options.requireActiveObject && object.status === 'archived' && !allowArchived) {
      const error = new Error(ARCHIVED_OBJECT_ERROR);
      error.status = 400;
      throw error;
    }
  }
  let contract = null;
  if (contractId) {
    contract = assertContractObjectConsistency(data, contractId, objectId, resolvedClientId);
  }
  return {
    ...payload,
    clientId: resolvedClientId || payload?.clientId,
    objectId: objectId || undefined,
    contractId: contractId || undefined,
    ...(options.includeObjectSnapshot
      ? object
        ? {
            objectName: object.name || null,
            objectAddress: object.address || null,
            objectContactName: object.contactName || null,
            objectContactPhone: object.contactPhone || null,
          }
        : {
            objectName: null,
            objectAddress: null,
            objectContactName: null,
            objectContactPhone: null,
          }
      : {}),
    ...(contract && options.includeContractSnapshot ? {
      contractNumber: contract.number || null,
    } : {}),
  };
}

function normalizeClientObjectRecord(record, existing = null, deps = {}) {
  const nowIso = typeof deps.nowIso === 'function' ? deps.nowIso : () => new Date().toISOString();
  const clientId = text(
    Object.prototype.hasOwnProperty.call(record || {}, 'clientId')
      ? record.clientId
      : existing?.clientId,
  );
  const counterpartyId = text(
    Object.prototype.hasOwnProperty.call(record || {}, 'counterpartyId')
      ? record.counterpartyId
      : existing?.counterpartyId,
  );
  const name = text(record?.name);
  const address = text(record?.address);
  const contactName = text(record?.contactName);
  const contactPhone = text(record?.contactPhone);
  // `notes` is kept as a compatibility projection for records and consumers
  // created before ClientObject received the canonical `comment` field.
  const recordComment = text(record?.comment);
  const recordNotes = text(record?.notes);
  const commentChanged = Boolean(existing)
    && Object.prototype.hasOwnProperty.call(record || {}, 'comment')
    && recordComment !== text(existing?.comment);
  const legacyNotesChanged = Boolean(existing)
    && Object.prototype.hasOwnProperty.call(record || {}, 'notes')
    && recordNotes !== text(existing?.notes);
  const comment = commentChanged
    ? recordComment
    : legacyNotesChanged
      ? recordNotes
      : Object.prototype.hasOwnProperty.call(record || {}, 'comment')
        ? recordComment
        : recordNotes || text(existing?.comment ?? existing?.notes);
  const status = normalizeStatus(record?.status ?? existing?.status);
  if ((!clientId && !counterpartyId) || !name) {
    const error = new Error(OBJECT_REQUIRED_ERROR);
    error.status = 400;
    throw error;
  }
  assertTextLength(name, 160, 'Название объекта');
  assertTextLength(address, 500, 'Адрес объекта');
  assertTextLength(contactName, 160, 'Контактное лицо');
  assertTextLength(contactPhone, 64, 'Телефон');
  assertTextLength(comment, 2000, 'Комментарий');
  let relation = null;
  if (typeof deps.readData === 'function') {
    relation = resolveDomainCounterpartyRelation(
      { clientId, counterpartyId },
      { readData: deps.readData },
      { allowArchived: status === 'archived' },
    );
    const existingClientId = text(existing?.clientId);
    const existingCounterpartyId = text(existing?.counterpartyId);
    if (
      (existingClientId && existingClientId !== clientId)
      || (existingCounterpartyId && existingCounterpartyId !== relation.counterpartyId)
    ) {
      throw counterpartyError(
        'COUNTERPARTY_RELATION_IMMUTABLE',
        'Связь объекта с Client/Counterparty нельзя менять после создания.',
        409,
        {
          objectId: record?.id || existing?.id || null,
          clientId: existingClientId || null,
          counterpartyId: existingCounterpartyId || relation.counterpartyId,
        },
      );
    }
    if (record?.contractId) {
      assertContractObjectConsistency(deps.readData, record.contractId, record.id || existing?.id, clientId);
    }
  }
  return {
    ...existing,
    ...record,
    clientId: clientId || undefined,
    counterpartyId: relation?.counterpartyId || counterpartyId,
    name,
    address: address || undefined,
    contactName: contactName || undefined,
    contactPhone: contactPhone || undefined,
    contractId: text(record?.contractId) || undefined,
    contractNumber: text(record?.contractNumber) || undefined,
    comment: comment || undefined,
    notes: comment || undefined,
    status,
    createdAt: existing?.createdAt || record?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

function normalizeClientContractRecord(record, existing = null, deps = {}) {
  const nowIso = typeof deps.nowIso === 'function' ? deps.nowIso : () => new Date().toISOString();
  const clientId = text(
    Object.prototype.hasOwnProperty.call(record || {}, 'clientId')
      ? record.clientId
      : existing?.clientId,
  );
  const counterpartyId = text(
    Object.prototype.hasOwnProperty.call(record || {}, 'counterpartyId')
      ? record.counterpartyId
      : existing?.counterpartyId,
  );
  const objectId = text(
    Object.prototype.hasOwnProperty.call(record || {}, 'objectId')
      ? record.objectId
      : existing?.objectId,
  );
  const objectIds = Array.isArray(record?.objectIds ?? existing?.objectIds)
    ? [...new Set((record?.objectIds ?? existing?.objectIds).map(text).filter(Boolean))]
    : [];
  const number = text(record?.number);
  if ((!clientId && !counterpartyId && !objectId && objectIds.length === 0) || !number) {
    const error = new Error(CONTRACT_REQUIRED_ERROR);
    error.status = 400;
    throw error;
  }
  const status = normalizeStatus(record?.status ?? existing?.status);
  const normalized = {
    ...existing,
    ...record,
    clientId: clientId || undefined,
    counterpartyId: counterpartyId || undefined,
    objectId: objectId || undefined,
    objectIds,
    number,
    date: text(record?.date) || undefined,
    title: text(record?.title) || number,
    status,
    notes: text(record?.notes) || undefined,
    createdAt: existing?.createdAt || record?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
  if (typeof deps.readData !== 'function') return normalized;
  return canonicalizeClientContractCounterpartyRelation(normalized, { readData: deps.readData }, {
    existing,
    allowArchived: Boolean(existing) && status === 'archived',
  });
}

function enrichRecordFromRentalLinks(record, readData) {
  if (!record || typeof readData !== 'function') return record;
  const rentalId = text(record.rentalId || record.classicRentalId || record.ganttRentalId);
  if (!rentalId) return record;
  const rentals = [
    ...(readData('rentals') || []),
    ...(readData('gantt_rentals') || []),
  ];
  const rental = rentals.find(item => [
    item?.id,
    item?.rentalId,
    item?.sourceRentalId,
    item?.originalRentalId,
  ].some(id => text(id) === rentalId));
  if (!rental) return record;
  return {
    ...record,
    counterpartyId: record.counterpartyId || rental.counterpartyId || undefined,
    clientId: record.clientId || rental.clientId || undefined,
    client: record.client || rental.client || undefined,
    clientName: record.clientName || record.client || rental.client || undefined,
    objectId: record.objectId || rental.objectId || undefined,
    contractId: record.contractId || rental.contractId || undefined,
  };
}

function objectLabel(object) {
  return object?.name || 'Без объекта';
}

function buildClientObjectDebtBreakdown(clients, rentalDebtRows, objects = []) {
  const clientsById = new Map((clients || []).filter(item => item?.id).map(item => [String(item.id), item]));
  const clientsByCounterpartyId = new Map();
  for (const client of clients || []) {
    const counterpartyId = text(client?.counterpartyId);
    if (!counterpartyId) continue;
    const matches = clientsByCounterpartyId.get(counterpartyId) || [];
    matches.push(client);
    matches.sort((left, right) => text(left?.id).localeCompare(text(right?.id)));
    clientsByCounterpartyId.set(counterpartyId, matches);
  }
  const objectsById = new Map((objects || []).filter(item => item?.id).map(item => [String(item.id), item]));
  const map = new Map();
  for (const [sourceIndex, row] of (rentalDebtRows || []).entries()) {
    const clientId = text(row?.clientId);
    const counterpartyId = text(row?.debtorCounterpartyId || row?.counterpartyId);
    const counterpartyClients = counterpartyId ? (clientsByCounterpartyId.get(counterpartyId) || []) : [];
    const linkedClient = clientId ? clientsById.get(clientId) : null;
    const client = linkedClient?.counterpartyId === counterpartyId
      ? linkedClient
      : counterpartyClients[0] || linkedClient;
    const objectId = text(row?.objectId);
    const object = objectId ? objectsById.get(objectId) : null;
    const debtorKey = counterpartyId
      ? `counterparty:${counterpartyId}`
      : `unresolved:rental_debt_rows:${text(row?.rentalId) || 'missing_id'}:${sourceIndex}`;
    const key = `${debtorKey}|${objectId || 'none'}`;
    const clientIds = counterpartyClients.map(item => text(item?.id)).filter(Boolean);
    if (clientId && !clientIds.includes(clientId)) clientIds.push(clientId);
    const item = map.get(key) || {
      counterpartyId: counterpartyId || undefined,
      debtorCounterpartyId: counterpartyId || null,
      debtorIdentityStatus: row?.debtorIdentityStatus || 'unresolved',
      debtorIdentityIssues: Array.isArray(row?.debtorIdentityIssues) ? row.debtorIdentityIssues : [],
      clientId: client?.id || clientId || undefined,
      clientIds,
      client: client?.company || row?.client || 'Контрагент не определён',
      objectId: objectId || undefined,
      objectName: object ? objectLabel(object) : 'Без объекта',
      debt: 0,
      rentals: 0,
    };
    for (const compatibilityClientId of clientIds) {
      if (!item.clientIds.includes(compatibilityClientId)) item.clientIds.push(compatibilityClientId);
    }
    item.clientIds.sort();
    item.debt += Number(row?.outstanding) || 0;
    item.rentals += 1;
    map.set(key, item);
  }
  return [...map.values()].sort((a, b) => b.debt - a.debt || a.objectName.localeCompare(b.objectName, 'ru'));
}

module.exports = {
  assertContractBelongsToClient,
  assertContractObjectConsistency,
  assertObjectBelongsToClient,
  buildClientObjectDebtBreakdown,
  enrichRecordFromRentalLinks,
  getClientContractById,
  getClientObjectById,
  normalizeClientRelationLinks,
  normalizeClientContractRecord,
  normalizeClientObjectRecord,
};
