const {
  COUNTERPARTY_RELATION_CODES,
  assertClientCounterpartyLink,
  resolveCounterpartyById,
} = require('./counterparty-relations');
const { counterpartyError } = require('./counterparty');
const { hasActiveCounterpartyRole } = require('./counterparty-role-profiles');

const SERVICE_RELATION_CLASSIFICATIONS = Object.freeze({
  ALREADY_CANONICAL: 'already_canonical',
  DETERMINISTIC_REPAIR: 'deterministic_repair',
  INTERNAL_UNLINKED_VALID: 'internal_unlinked_valid',
  CONFLICTING_STABLE_RELATIONS: 'conflicting_stable_relations',
  MISSING_REFERENCED_STABLE_ENTITY: 'missing_referenced_stable_entity',
  MISSING_COUNTERPARTY: 'missing_counterparty',
  ARCHIVED_COUNTERPARTY: 'archived_counterparty',
  CUSTOMER_ROLE_INACTIVE: 'missing_or_inactive_customer_role',
  METADATA_ONLY_UNRESOLVED: 'metadata_only_unresolved_relation',
});

const SERVICE_RELATION_CODES = Object.freeze({
  DUPLICATE_ID: 'SERVICE_COUNTERPARTY_DUPLICATE_TICKET_ID',
  IMMUTABLE: 'SERVICE_COUNTERPARTY_RELATION_IMMUTABLE',
  METADATA_ONLY: 'SERVICE_COUNTERPARTY_METADATA_ONLY',
  MISSING_CLIENT: 'SERVICE_COUNTERPARTY_CLIENT_NOT_FOUND',
  MISSING_CONTRACT: 'SERVICE_COUNTERPARTY_CONTRACT_NOT_FOUND',
  MISSING_OBJECT: 'SERVICE_COUNTERPARTY_OBJECT_NOT_FOUND',
  MISSING_RENTAL: 'SERVICE_COUNTERPARTY_RENTAL_NOT_FOUND',
  SOURCE_RELATION_MISSING: 'SERVICE_COUNTERPARTY_SOURCE_RELATION_MISSING',
});

const SERVICE_STABLE_RELATION_FIELDS = Object.freeze([
  'counterpartyId',
  'clientId',
  'rentalId',
  'objectId',
  'contractId',
]);

const SERVICE_CUSTOMER_METADATA_FIELDS = Object.freeze([
  'counterparty',
  'counterpartyName',
  'customerDisplayName',
  'client',
  'clientName',
  'company',
  'companyName',
  'clientInn',
  'customerInn',
  'inn',
  'customerPhone',
  'clientPhone',
  'rental',
  'rentalName',
  'rentalLabel',
  'objectName',
  'objectAddress',
  'objectContactName',
  'objectContactPhone',
  'contractNumber',
  'contractName',
]);

const TERMINAL_SERVICE_STATUSES = new Set([
  'ready',
  'closed',
  'completed',
  'cancelled',
  'canceled',
]);

function relationId(value) {
  return String(value ?? '').trim();
}

function readCollection(data, name) {
  if (typeof data === 'function') return data(name) || [];
  if (data && typeof data.readData === 'function') return data.readData(name) || [];
  return data?.[name] || [];
}

function findUniqueById(data, collection, id, relation, missingCode, missingMessage) {
  const wanted = relationId(id);
  if (!wanted) return null;
  const matches = (Array.isArray(readCollection(data, collection)) ? readCollection(data, collection) : [])
    .filter(item => relationId(item?.id) === wanted);
  if (matches.length > 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
      `Stable ID ${wanted} неоднозначен в коллекции ${collection}.`,
      409,
      { domain: collection, relation, id: wanted, matches: matches.length },
    );
  }
  if (matches.length === 0) {
    throw counterpartyError(
      missingCode,
      missingMessage,
      409,
      { domain: collection, relation, id: wanted },
    );
  }
  return matches[0];
}

function isTerminalServiceTicket(ticket) {
  return TERMINAL_SERVICE_STATUSES.has(relationId(ticket?.status).toLowerCase());
}

function requireCustomerRole(counterparty, data, context, { allowInactiveRole = false } = {}) {
  if (allowInactiveRole) return counterparty;
  if (!hasActiveCounterpartyRole(counterparty, 'customer', data)) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED,
      'Counterparty сервисной заявки должен иметь активную роль customer.',
      409,
      { ...context, counterpartyId: relationId(counterparty?.id) || null },
    );
  }
  return counterparty;
}

function directCounterpartyCandidate(ticket, data, options) {
  const counterpartyId = relationId(ticket?.counterpartyId);
  if (!counterpartyId) return null;
  const counterparty = requireCustomerRole(
    resolveCounterpartyById(counterpartyId, data, { allowArchived: options.allowArchived }),
    data,
    { source: 'counterpartyId' },
    { allowInactiveRole: options.allowInactiveRole },
  );
  return { source: 'counterpartyId', counterpartyId, counterparty, entity: counterparty };
}

function clientCounterpartyCandidate(ticket, data, options) {
  const clientId = relationId(ticket?.clientId);
  if (!clientId) return null;
  let relation;
  try {
    relation = assertClientCounterpartyLink(
      { clientId, counterpartyId: null },
      data,
      { allowArchived: options.allowArchived, requireCustomerRole: false },
    );
  } catch (error) {
    if (error?.code === COUNTERPARTY_RELATION_CODES.CLIENT_NOT_FOUND) {
      throw counterpartyError(
        SERVICE_RELATION_CODES.MISSING_CLIENT,
        'Связанный Client сервисной заявки не найден по stable clientId.',
        409,
        { clientId },
      );
    }
    throw error;
  }
  requireCustomerRole(
    relation.counterparty,
    data,
    { source: 'clientId', clientId },
    { allowInactiveRole: options.allowInactiveRole },
  );
  return { ...relation, source: 'clientId', entity: relation.client };
}

function sourceCounterpartyCandidate(ticket, field, collection, data, options) {
  const id = relationId(ticket?.[field]);
  if (!id) return null;
  const missing = {
    rentalId: [SERVICE_RELATION_CODES.MISSING_RENTAL, 'Связанная Rental сервисной заявки не найдена по stable rentalId.'],
    objectId: [SERVICE_RELATION_CODES.MISSING_OBJECT, 'Связанный ClientObject сервисной заявки не найден по stable objectId.'],
    contractId: [SERVICE_RELATION_CODES.MISSING_CONTRACT, 'Связанный ClientContract сервисной заявки не найден по stable contractId.'],
  }[field];
  const entity = findUniqueById(data, collection, id, `ServiceTicket.${field}`, missing[0], missing[1]);
  const counterpartyId = relationId(entity?.counterpartyId);
  if (!counterpartyId) {
    throw counterpartyError(
      SERVICE_RELATION_CODES.SOURCE_RELATION_MISSING,
      `${collection}.counterpartyId отсутствует; display metadata не устанавливает Service customer relation.`,
      409,
      { field, id, collection, sourceField: `${collection}.counterpartyId` },
    );
  }
  const counterparty = requireCustomerRole(
    resolveCounterpartyById(counterpartyId, data, { allowArchived: options.allowArchived }),
    data,
    { source: field, [field]: id },
    { allowInactiveRole: options.allowInactiveRole },
  );
  return {
    source: field,
    counterpartyId,
    counterparty,
    clientId: relationId(entity?.clientId) || null,
    entity,
  };
}

function rentalCounterpartyCandidate(ticket, data, options) {
  const rentalId = relationId(ticket?.rentalId);
  if (!rentalId) return null;
  const matches = [];
  for (const collection of ['rentals', 'gantt_rentals']) {
    const records = Array.isArray(readCollection(data, collection)) ? readCollection(data, collection) : [];
    for (const record of records) {
      const stableIds = [record?.id, record?.rentalId, record?.sourceRentalId, record?.originalRentalId]
        .map(relationId)
        .filter(Boolean);
      if (stableIds.includes(rentalId)) matches.push({ collection, record });
    }
  }
  if (matches.length === 0) {
    throw counterpartyError(
      SERVICE_RELATION_CODES.MISSING_RENTAL,
      'Связанная Rental сервисной заявки не найдена по stable rentalId.',
      409,
      { rentalId },
    );
  }
  const resolvedMatches = matches.map(({ collection, record }) => {
    const counterpartyId = relationId(record?.counterpartyId);
    if (!counterpartyId) {
      throw counterpartyError(
        SERVICE_RELATION_CODES.SOURCE_RELATION_MISSING,
        'Связанная Rental не содержит canonical counterpartyId.',
        409,
        { field: 'rentalId', rentalId, collection, sourceField: `${collection}.counterpartyId` },
      );
    }
    const counterparty = requireCustomerRole(
      resolveCounterpartyById(counterpartyId, data, { allowArchived: options.allowArchived }),
      data,
      { source: 'rentalId', rentalId, collection },
      { allowInactiveRole: options.allowInactiveRole },
    );
    return { collection, record, counterpartyId, counterparty };
  });
  const counterpartyIds = [...new Set(resolvedMatches.map(item => item.counterpartyId))];
  if (counterpartyIds.length !== 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.MISMATCH,
      `Stable rentalId ${rentalId} разрешается в разные Counterparty.`,
      409,
      {
        rentalId,
        matches: resolvedMatches.map(item => ({
          collection: item.collection,
          recordId: relationId(item.record?.id),
          counterpartyId: item.counterpartyId,
        })),
      },
    );
  }
  const [{ collection, record, counterpartyId, counterparty }] = resolvedMatches;
  return {
    source: 'rentalId',
    counterpartyId,
    counterparty,
    clientId: relationId(record?.clientId) || null,
    entity: record,
    collection,
  };
}

function customerMetadataFields(ticket) {
  return SERVICE_CUSTOMER_METADATA_FIELDS.filter(field => relationId(ticket?.[field]));
}

function assertCandidatesAgree(candidates, ticket) {
  const present = candidates.filter(Boolean);
  if (present.length === 0) return null;
  const counterpartyIds = [...new Set(present.map(item => relationId(item.counterpartyId)).filter(Boolean))];
  if (counterpartyIds.length !== 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.MISMATCH,
      'Stable Service customer relation chains указывают на разных Counterparty.',
      409,
      {
        serviceTicketId: relationId(ticket?.id) || null,
        candidates: present.map(item => ({
          source: item.source,
          counterpartyId: item.counterpartyId || null,
          clientId: item.clientId || null,
        })),
      },
    );
  }
  return { ...present[0], counterpartyId: counterpartyIds[0], candidates: present };
}

function resolveServiceCounterpartyRelation(ticket, data, options = {}) {
  const historical = options.historical ?? isTerminalServiceTicket(ticket);
  const relationOptions = {
    allowArchived: options.allowArchived ?? historical,
    allowInactiveRole: options.allowInactiveRole ?? historical,
  };
  const candidates = [
    directCounterpartyCandidate(ticket, data, relationOptions),
    clientCounterpartyCandidate(ticket, data, relationOptions),
    rentalCounterpartyCandidate(ticket, data, relationOptions),
    sourceCounterpartyCandidate(ticket, 'objectId', 'client_objects', data, relationOptions),
    sourceCounterpartyCandidate(ticket, 'contractId', 'client_contracts', data, relationOptions),
  ];
  const relation = assertCandidatesAgree(candidates, ticket);
  if (relation) return relation;

  const metadataFields = customerMetadataFields(ticket);
  if (metadataFields.length > 0) {
    throw counterpartyError(
      SERVICE_RELATION_CODES.METADATA_ONLY,
      'Customer metadata сервисной заявки не может установить identity без stable customer relation.',
      400,
      { metadataOnly: true, metadataFields, stableFields: [...SERVICE_STABLE_RELATION_FIELDS] },
    );
  }
  return null;
}

function canonicalizeServiceTicketCounterpartyRelation(ticket, data, options = {}) {
  if (!ticket || typeof ticket !== 'object' || Array.isArray(ticket)) {
    throw counterpartyError('SERVICE_COUNTERPARTY_RECORD_INVALID', 'Service ticket должен быть объектом.', 400);
  }
  const existing = options.existing && typeof options.existing === 'object' ? options.existing : null;
  const relation = resolveServiceCounterpartyRelation(ticket, data, options);
  let previousRelation = null;
  if (existing) {
    try {
      previousRelation = resolveServiceCounterpartyRelation(existing, data, {
        historical: isTerminalServiceTicket(existing),
      });
    } catch (error) {
      if (relationId(existing?.counterpartyId)) throw error;
    }
  }
  if (previousRelation && (!relation || previousRelation.counterpartyId !== relation.counterpartyId)) {
    throw counterpartyError(
      SERVICE_RELATION_CODES.IMMUTABLE,
      'Связь ServiceTicket с customer Counterparty нельзя удалить или изменить обычным обновлением.',
      409,
      {
        serviceTicketId: relationId(existing?.id) || relationId(ticket?.id) || null,
        counterpartyId: previousRelation.counterpartyId,
        requestedCounterpartyId: relation?.counterpartyId || null,
      },
    );
  }

  const next = { ...ticket };
  for (const field of SERVICE_STABLE_RELATION_FIELDS) {
    if (!relationId(next[field])) delete next[field];
  }
  if (relation) next.counterpartyId = relation.counterpartyId;
  return next;
}

function duplicateTicketIds(tickets) {
  const counts = new Map();
  for (const ticket of Array.isArray(tickets) ? tickets : []) {
    const id = relationId(ticket?.id);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()].filter(([, count]) => count > 1).map(([id]) => id);
}

function canonicalizeServiceTicketCollection(tickets, data, { existingTickets = null } = {}) {
  if (!Array.isArray(tickets)) {
    throw counterpartyError('SERVICE_COUNTERPARTY_COLLECTION_INVALID', 'Коллекция service должна быть массивом.', 400);
  }
  const duplicates = duplicateTicketIds(tickets);
  if (duplicates.length > 0) {
    throw counterpartyError(
      SERVICE_RELATION_CODES.DUPLICATE_ID,
      'Коллекция service содержит дубликаты stable ticket id.',
      409,
      { duplicateIds: duplicates },
    );
  }
  const previousById = new Map((Array.isArray(existingTickets) ? existingTickets : readCollection(data, 'service'))
    .map(ticket => [relationId(ticket?.id), ticket]));
  return tickets.map(ticket => canonicalizeServiceTicketCounterpartyRelation(ticket, data, {
    existing: previousById.get(relationId(ticket?.id)) || null,
  }));
}

function canonicalizeServicePersistenceEntries(entries, { readData }) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(entry => ({ name: entry?.name, value: entry?.value }));
  if (normalized.filter(entry => entry.name === 'service').length > 1) {
    throw counterpartyError(
      'SERVICE_COUNTERPARTY_MULTIPLE_BATCH_ENTRIES',
      'Atomic batch не может содержать несколько replacement entries для service.',
      409,
    );
  }
  const staged = new Map(normalized.map(entry => [entry.name, entry.value]));
  const stagedData = {
    readData(name) {
      return staged.has(name) ? staged.get(name) : (readData(name) || []);
    },
  };
  const serviceEntry = normalized.find(entry => entry.name === 'service');
  if (serviceEntry) {
    serviceEntry.value = canonicalizeServiceTicketCollection(serviceEntry.value, stagedData, {
      existingTickets: readData('service') || [],
    });
    staged.set('service', serviceEntry.value);
  }
  return normalized;
}

function classificationForError(error) {
  if ([COUNTERPARTY_RELATION_CODES.MISMATCH, COUNTERPARTY_RELATION_CODES.AMBIGUOUS, SERVICE_RELATION_CODES.DUPLICATE_ID]
    .includes(error?.code)) return SERVICE_RELATION_CLASSIFICATIONS.CONFLICTING_STABLE_RELATIONS;
  if ([SERVICE_RELATION_CODES.MISSING_CLIENT, SERVICE_RELATION_CODES.MISSING_RENTAL,
    SERVICE_RELATION_CODES.MISSING_OBJECT, SERVICE_RELATION_CODES.MISSING_CONTRACT,
    SERVICE_RELATION_CODES.SOURCE_RELATION_MISSING].includes(error?.code)) {
    return SERVICE_RELATION_CLASSIFICATIONS.MISSING_REFERENCED_STABLE_ENTITY;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.COUNTERPARTY_NOT_FOUND) {
    return SERVICE_RELATION_CLASSIFICATIONS.MISSING_COUNTERPARTY;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.COUNTERPARTY_ARCHIVED) {
    return SERVICE_RELATION_CLASSIFICATIONS.ARCHIVED_COUNTERPARTY;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED) {
    return SERVICE_RELATION_CLASSIFICATIONS.CUSTOMER_ROLE_INACTIVE;
  }
  if (error?.code === SERVICE_RELATION_CODES.METADATA_ONLY) {
    return SERVICE_RELATION_CLASSIFICATIONS.METADATA_ONLY_UNRESOLVED;
  }
  return SERVICE_RELATION_CLASSIFICATIONS.MISSING_REFERENCED_STABLE_ENTITY;
}

function auditEntry(ticket, classification, details = {}) {
  return {
    classification,
    domain: 'service',
    recordId: relationId(ticket?.id) || null,
    counterpartyId: relationId(ticket?.counterpartyId) || null,
    clientId: relationId(ticket?.clientId) || null,
    rentalId: relationId(ticket?.rentalId) || null,
    objectId: relationId(ticket?.objectId) || null,
    contractId: relationId(ticket?.contractId) || null,
    ...details,
  };
}

function auditServiceCounterpartyRelations(data) {
  const tickets = Array.isArray(readCollection(data, 'service')) ? readCollection(data, 'service') : [];
  const duplicateIds = new Set(duplicateTicketIds(tickets));
  const entries = tickets.map(ticket => {
    const ticketId = relationId(ticket?.id);
    if (!ticketId || duplicateIds.has(ticketId)) {
      return auditEntry(ticket, SERVICE_RELATION_CLASSIFICATIONS.CONFLICTING_STABLE_RELATIONS, {
        code: SERVICE_RELATION_CODES.DUPLICATE_ID,
        repairability: 'none',
        message: ticketId ? `Service ticket id ${ticketId} неоднозначен.` : 'Service ticket не содержит stable id.',
      });
    }
    try {
      const relation = resolveServiceCounterpartyRelation(ticket, data, {
        historical: isTerminalServiceTicket(ticket),
      });
      if (!relation) {
        return auditEntry(ticket, SERVICE_RELATION_CLASSIFICATIONS.INTERNAL_UNLINKED_VALID, {
          code: null,
          repairability: 'not_needed',
          message: 'Customerless internal Service ticket не содержит customer IDs или snapshots.',
        });
      }
      if (!relationId(ticket?.counterpartyId)) {
        return auditEntry(ticket, SERVICE_RELATION_CLASSIFICATIONS.DETERMINISTIC_REPAIR, {
          counterpartyId: relation.counterpartyId,
          code: COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
          repairability: 'deterministic_stable_id_chain',
          message: 'ServiceTicket.counterpartyId можно заполнить по согласованной stable-ID цепочке.',
          repair: { collection: 'service', field: 'counterpartyId', nextValue: relation.counterpartyId },
        });
      }
      return auditEntry(ticket, SERVICE_RELATION_CLASSIFICATIONS.ALREADY_CANONICAL, {
        code: null,
        repairability: 'not_needed',
        message: 'ServiceTicket.counterpartyId и все stable relation chains согласованы.',
      });
    } catch (error) {
      return auditEntry(ticket, classificationForError(error), {
        code: error?.code || 'SERVICE_COUNTERPARTY_AUDIT_FAILED',
        repairability: 'none',
        message: error?.message || 'Service Counterparty relation audit failed.',
        ...(error?.details ? { context: error.details } : {}),
      });
    }
  });
  const classifications = Object.values(SERVICE_RELATION_CLASSIFICATIONS)
    .reduce((summary, classification) => ({ ...summary, [classification]: 0 }), {});
  for (const entry of entries) classifications[entry.classification] += 1;
  const broken = entries.filter(entry => ![
    SERVICE_RELATION_CLASSIFICATIONS.ALREADY_CANONICAL,
    SERVICE_RELATION_CLASSIFICATIONS.DETERMINISTIC_REPAIR,
    SERVICE_RELATION_CLASSIFICATIONS.INTERNAL_UNLINKED_VALID,
  ].includes(entry.classification));
  return {
    ok: broken.length === 0,
    authority: 'ServiceTicket.counterpartyId -> Counterparty.id',
    entries,
    summary: { classifications, scanned: { service: tickets.length }, broken: broken.length },
  };
}

function repairServiceCounterpartyRelations({ readData, writeDataBatch, dryRun = true }) {
  const audit = auditServiceCounterpartyRelations({ readData });
  const repairs = new Map(audit.entries
    .filter(entry => entry.classification === SERVICE_RELATION_CLASSIFICATIONS.DETERMINISTIC_REPAIR)
    .map(entry => [entry.recordId, entry.counterpartyId]));
  const current = readData('service') || [];
  const next = current.map(ticket => {
    const counterpartyId = repairs.get(relationId(ticket?.id));
    return counterpartyId ? { ...ticket, counterpartyId } : ticket;
  });
  if (!dryRun && repairs.size > 0) {
    if (typeof writeDataBatch !== 'function') throw new Error('writeDataBatch is required for apply mode');
    writeDataBatch([{ name: 'service', value: next }]);
  }
  return {
    dryRun: Boolean(dryRun),
    changed: repairs.size > 0,
    wrote: !dryRun && repairs.size > 0,
    changedRecords: repairs.size,
    unresolvedRecords: audit.summary.broken,
    audit,
  };
}

function activeServiceCounterpartyReferences(counterpartyId, data) {
  const id = relationId(counterpartyId);
  if (!id) return [];
  return (Array.isArray(readCollection(data, 'service')) ? readCollection(data, 'service') : [])
    .filter(ticket => !isTerminalServiceTicket(ticket))
    .filter(ticket => {
      if (relationId(ticket?.counterpartyId) === id) return true;
      try {
        return resolveServiceCounterpartyRelation(ticket, data, {
          allowArchived: true,
          allowInactiveRole: true,
          historical: false,
        })?.counterpartyId === id;
      } catch {
        return false;
      }
    });
}

function serviceCounterpartyReferenceBlockers(counterpartyId, data) {
  const records = activeServiceCounterpartyReferences(counterpartyId, data);
  if (records.length === 0) return [];
  return [{
    collection: 'service',
    recordIds: records.map(ticket => relationId(ticket?.id)).filter(Boolean),
    count: records.length,
    relationFields: ['counterpartyId'],
  }];
}

function decorateServiceTicketCounterparty(ticket, data) {
  const counterpartyId = relationId(ticket?.counterpartyId);
  if (!counterpartyId) return ticket;
  const counterparties = (Array.isArray(readCollection(data, 'counterparties')) ? readCollection(data, 'counterparties') : [])
    .filter(item => relationId(item?.id) === counterpartyId);
  if (counterparties.length !== 1) return ticket;
  const counterparty = counterparties[0];
  const clientId = relationId(ticket?.clientId);
  const client = clientId
    ? (Array.isArray(readCollection(data, 'clients')) ? readCollection(data, 'clients') : [])
      .find(item => relationId(item?.id) === clientId && relationId(item?.counterpartyId) === counterpartyId)
    : null;
  const counterpartyName = relationId(counterparty?.shortName || counterparty?.legalName);
  const displayName = relationId(client?.company) || counterpartyName;
  return {
    ...ticket,
    counterpartyId,
    counterpartyName,
    customerDisplayName: displayName,
    ...(displayName ? { client: displayName, clientName: displayName } : {}),
  };
}

module.exports = {
  SERVICE_CUSTOMER_METADATA_FIELDS,
  SERVICE_RELATION_CLASSIFICATIONS,
  SERVICE_RELATION_CODES,
  SERVICE_STABLE_RELATION_FIELDS,
  activeServiceCounterpartyReferences,
  auditServiceCounterpartyRelations,
  canonicalizeServicePersistenceEntries,
  canonicalizeServiceTicketCollection,
  canonicalizeServiceTicketCounterpartyRelation,
  decorateServiceTicketCounterparty,
  isTerminalServiceTicket,
  repairServiceCounterpartyRelations,
  resolveServiceCounterpartyRelation,
  serviceCounterpartyReferenceBlockers,
};
