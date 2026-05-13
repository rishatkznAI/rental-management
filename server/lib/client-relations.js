const OBJECT_REQUIRED_ERROR = 'Для объекта клиента укажите клиента, название и адрес';
const CONTRACT_REQUIRED_ERROR = 'Для договора клиента укажите клиента и номер договора';
const ORPHAN_CLIENT_ERROR = 'Клиент для записи не найден';
const ORPHAN_OBJECT_ERROR = 'Объект клиента не найден или не принадлежит клиенту';
const ORPHAN_CONTRACT_ERROR = 'Договор клиента не найден или не принадлежит клиенту';
const ARCHIVED_OBJECT_ERROR = 'Архивный объект нельзя выбрать для новой записи';
const REQUIRED_RENTAL_RELATIONS_ERROR = 'Для аренды укажите клиента, объект и договор';

function text(value) {
  return String(value ?? '').trim();
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
  if (options.requireRentalRelations && (!resolvedClientId || !objectId || !contractId)) {
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
    ...(object && options.includeObjectSnapshot ? {
      objectName: payload.objectName || object.name || null,
      objectAddress: payload.objectAddress || object.address || null,
      objectContactName: payload.objectContactName || object.contactName || null,
      objectContactPhone: payload.objectContactPhone || object.contactPhone || null,
    } : {}),
    ...(contract && options.includeContractSnapshot ? {
      contractNumber: payload.contractNumber || contract.number || null,
    } : {}),
  };
}

function normalizeClientObjectRecord(record, existing = null, deps = {}) {
  const nowIso = typeof deps.nowIso === 'function' ? deps.nowIso : () => new Date().toISOString();
  const clientId = text(record?.clientId || existing?.clientId);
  const name = text(record?.name);
  const address = text(record?.address);
  if (!clientId || !name || !address) {
    const error = new Error(OBJECT_REQUIRED_ERROR);
    error.status = 400;
    throw error;
  }
  if (typeof deps.readData === 'function') {
    assertClientExists(deps.readData, clientId);
    if (record?.contractId) {
      assertContractObjectConsistency(deps.readData, record.contractId, record.id || existing?.id, clientId);
    }
  }
  return {
    ...existing,
    ...record,
    clientId,
    name,
    address,
    contactName: text(record?.contactName),
    contactPhone: text(record?.contactPhone),
    contractId: text(record?.contractId) || undefined,
    contractNumber: text(record?.contractNumber) || undefined,
    notes: text(record?.notes) || undefined,
    status: normalizeStatus(record?.status ?? existing?.status),
    createdAt: existing?.createdAt || record?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
}

function normalizeClientContractRecord(record, existing = null, deps = {}) {
  const nowIso = typeof deps.nowIso === 'function' ? deps.nowIso : () => new Date().toISOString();
  const clientId = text(record?.clientId || existing?.clientId);
  const objectId = text(record?.objectId);
  const objectIds = Array.isArray(record?.objectIds)
    ? [...new Set(record.objectIds.map(text).filter(Boolean))]
    : [];
  const number = text(record?.number);
  if (!clientId || !number) {
    const error = new Error(CONTRACT_REQUIRED_ERROR);
    error.status = 400;
    throw error;
  }
  if (typeof deps.readData === 'function') {
    assertClientExists(deps.readData, clientId);
    assertObjectBelongsToClient(deps.readData, objectId, clientId);
    objectIds.forEach(id => assertObjectBelongsToClient(deps.readData, id, clientId));
  }
  return {
    ...existing,
    ...record,
    clientId,
    objectId: objectId || undefined,
    objectIds,
    number,
    date: text(record?.date) || undefined,
    title: text(record?.title) || number,
    status: normalizeStatus(record?.status ?? existing?.status),
    notes: text(record?.notes) || undefined,
    createdAt: existing?.createdAt || record?.createdAt || nowIso(),
    updatedAt: nowIso(),
  };
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
    clientId: record.clientId || rental.clientId || undefined,
    client: record.client || rental.client || undefined,
    objectId: record.objectId || rental.objectId || undefined,
    contractId: record.contractId || rental.contractId || undefined,
  };
}

function objectLabel(object) {
  return object?.name || 'Без объекта';
}

function buildClientObjectDebtBreakdown(clients, rentalDebtRows, objects = []) {
  const clientsById = new Map((clients || []).filter(item => item?.id).map(item => [String(item.id), item]));
  const objectsById = new Map((objects || []).filter(item => item?.id).map(item => [String(item.id), item]));
  const map = new Map();
  for (const row of rentalDebtRows || []) {
    const clientId = text(row?.clientId);
    const objectId = text(row?.objectId);
    const object = objectId ? objectsById.get(objectId) : null;
    const key = `${clientId || 'unlinked'}|${objectId || 'none'}`;
    const item = map.get(key) || {
      clientId: clientId || undefined,
      client: clientsById.get(clientId)?.company || row?.client || 'Клиент не привязан',
      objectId: objectId || undefined,
      objectName: object ? objectLabel(object) : 'Без объекта',
      debt: 0,
      rentals: 0,
    };
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
