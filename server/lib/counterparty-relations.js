const {
  assertCounterpartyId,
  counterpartyError,
} = require('./counterparty');
const { hasActiveCounterpartyRole } = require('./counterparty-role-profiles');

const COUNTERPARTY_RELATION_CODES = Object.freeze({
  AMBIGUOUS: 'COUNTERPARTY_RELATION_AMBIGUOUS',
  CANONICAL_ID_MISSING: 'COUNTERPARTY_RELATION_CANONICAL_ID_MISSING',
  CLIENT_ID_REQUIRED: 'COUNTERPARTY_RELATION_CLIENT_ID_REQUIRED',
  CLIENT_LINK_MISSING: 'COUNTERPARTY_RELATION_CLIENT_LINK_MISSING',
  CLIENT_NOT_FOUND: 'COUNTERPARTY_RELATION_CLIENT_NOT_FOUND',
  COUNTERPARTY_ARCHIVED: 'COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED',
  COUNTERPARTY_ID_REQUIRED: 'COUNTERPARTY_RELATION_COUNTERPARTY_ID_REQUIRED',
  COUNTERPARTY_NOT_FOUND: 'COUNTERPARTY_RELATION_COUNTERPARTY_NOT_FOUND',
  CUSTOMER_ROLE_REQUIRED: 'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED',
  ENDPOINT_NOT_FOUND: 'COUNTERPARTY_RELATION_ENDPOINT_NOT_FOUND',
  ID_REQUIRED: 'COUNTERPARTY_RELATION_ID_REQUIRED',
  MISMATCH: 'COUNTERPARTY_RELATION_MISMATCH',
  REPAIR_FAILED: 'COUNTERPARTY_RELATION_REPAIR_FAILED',
});

const LEGACY_IDENTITY_FIELDS = Object.freeze([
  'legalName',
  'shortName',
  'name',
  'client',
  'clientName',
  'counterparty',
  'inn',
  'kpp',
  'ogrn',
  'ogrnip',
  'phone',
  'email',
  'address',
]);

// Relation policy boundary:
// - customer-specific records resolve only through clientId -> Client.counterpartyId;
// - neutral records use an explicit counterpartyId and never require a synthetic Client;
// - names, INN and display snapshots are never accepted as relation inputs.

function relationId(value) {
  return String(value ?? '').trim();
}

function readCollection(data, name) {
  if (typeof data === 'function') return data(name) || [];
  if (data && typeof data.readData === 'function') return data.readData(name) || [];
  return data?.[name] || [];
}

function findById(list, id, { domain = 'records', relation = 'id' } = {}) {
  const key = relationId(id);
  if (!key) return null;
  const matches = (Array.isArray(list) ? list : [])
    .filter(item => relationId(item?.id) === key);
  if (matches.length > 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
      `Stable ID ${key} неоднозначен в коллекции ${domain}.`,
      409,
      { domain, relation, id: key, matches: matches.length },
    );
  }
  return matches[0] || null;
}

function isArchivedCounterparty(counterparty) {
  return Boolean(counterparty?.archivedAt || counterparty?.status === 'archived');
}

function resolveCounterpartyById(counterpartyId, data, { allowArchived = false } = {}) {
  const id = relationId(counterpartyId);
  if (!id) {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_COUNTERPARTY_ID_REQUIRED',
      'Для связи укажите counterpartyId.',
      400,
      { field: 'counterpartyId' },
    );
  }
  assertCounterpartyId(id);
  const counterparty = findById(readCollection(data, 'counterparties'), id, {
    domain: 'counterparties',
    relation: 'counterpartyId',
  });
  if (!counterparty) {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_COUNTERPARTY_NOT_FOUND',
      'Связанный Counterparty не найден.',
      409,
      { counterpartyId: id },
    );
  }
  if (!allowArchived && isArchivedCounterparty(counterparty)) {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_COUNTERPARTY_ARCHIVED',
      'Архивный Counterparty нельзя использовать в активной связи.',
      409,
      { counterpartyId: id },
    );
  }
  return counterparty;
}

function resolveCounterpartyForClient(client, data, {
  allowArchived = false,
  requireCustomerRole = true,
} = {}) {
  const clientId = relationId(client?.id);
  if (!clientId) {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_CLIENT_NOT_FOUND',
      'Связанный Client не найден.',
      409,
      { clientId: clientId || null },
    );
  }
  const counterpartyId = relationId(client?.counterpartyId);
  if (!counterpartyId) {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_CLIENT_LINK_MISSING',
      'Client не содержит обязательный counterpartyId.',
      409,
      { clientId, field: 'client.counterpartyId' },
    );
  }
  const counterparty = resolveCounterpartyById(counterpartyId, data, { allowArchived });
  if (requireCustomerRole && !hasActiveCounterpartyRole(counterparty, 'customer', data)) {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_CUSTOMER_ROLE_REQUIRED',
      'Counterparty, связанный с Client, должен иметь роль customer.',
      409,
      { clientId, counterpartyId },
    );
  }
  return {
    client,
    counterparty,
    clientId,
    counterpartyId,
  };
}

function resolveClientCounterparty(clientId, data, options = {}) {
  const id = relationId(clientId);
  if (!id) {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_CLIENT_ID_REQUIRED',
      'Для customer-specific связи укажите clientId.',
      400,
      { field: 'clientId' },
    );
  }
  const client = findById(readCollection(data, 'clients'), id, {
    domain: 'clients',
    relation: 'clientId',
  });
  if (!client) {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_CLIENT_NOT_FOUND',
      'Связанный Client не найден.',
      409,
      { clientId: id },
    );
  }
  return resolveCounterpartyForClient(client, data, options);
}

function assertClientCounterpartyLink({ clientId, counterpartyId }, data, options = {}) {
  const resolved = resolveClientCounterparty(clientId, data, options);
  const explicitCounterpartyId = relationId(counterpartyId);
  if (explicitCounterpartyId && explicitCounterpartyId !== resolved.counterpartyId) {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_MISMATCH',
      'clientId и counterpartyId указывают на разных контрагентов.',
      409,
      {
        clientId: resolved.clientId,
        clientCounterpartyId: resolved.counterpartyId,
        counterpartyId: explicitCounterpartyId,
      },
    );
  }
  return resolved;
}

function resolveDomainCounterpartyRelation(record, data, {
  allowArchived = false,
  allowCounterpartyOnly = true,
  requireCustomerRole = false,
} = {}) {
  const clientId = relationId(record?.clientId);
  const counterpartyId = relationId(record?.counterpartyId);
  if (clientId) {
    return assertClientCounterpartyLink(
      { clientId, counterpartyId },
      data,
      { allowArchived, requireCustomerRole: true },
    );
  }
  if (counterpartyId && allowCounterpartyOnly) {
    const counterparty = resolveCounterpartyById(counterpartyId, data, { allowArchived });
    if (requireCustomerRole && !hasActiveCounterpartyRole(counterparty, 'customer', data)) {
      throw counterpartyError(
        COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED,
        'Counterparty должен иметь активную роль customer.',
        409,
        { counterpartyId: relationId(counterparty.id) },
      );
    }
    return {
      client: null,
      counterparty,
      clientId: null,
      counterpartyId: relationId(counterparty.id),
    };
  }
  throw counterpartyError(
    'COUNTERPARTY_RELATION_ID_REQUIRED',
    'Для связи укажите explicit clientId или counterpartyId.',
    400,
    { fields: allowCounterpartyOnly ? ['clientId', 'counterpartyId'] : ['clientId'] },
  );
}

function buildIdIndex(list) {
  const index = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const id = relationId(item?.id);
    if (!id) continue;
    const matches = index.get(id) || [];
    matches.push(item);
    index.set(id, matches);
  }
  return index;
}

function indexedRelation(index, id) {
  const key = relationId(id);
  const matches = key ? (index.get(key) || []) : [];
  if (matches.length === 0) return { status: 'missing', id: key, item: null, count: 0 };
  if (matches.length > 1) return { status: 'ambiguous', id: key, item: null, count: matches.length };
  return { status: 'found', id: key, item: matches[0], count: 1 };
}

function presentLegacyIdentityFields(record) {
  return LEGACY_IDENTITY_FIELDS.filter(field => relationId(record?.[field]));
}

function auditEntry({
  classification,
  domain,
  recordId = null,
  clientId = null,
  counterpartyId = null,
  code,
  repairability = 'none',
  message,
  context,
  repair,
}) {
  return {
    classification,
    domain,
    recordId: relationId(recordId) || null,
    clientId: relationId(clientId) || null,
    counterpartyId: relationId(counterpartyId) || null,
    code,
    repairability,
    message,
    ...(context ? { context } : {}),
    ...(repair ? { repair } : {}),
  };
}

function ambiguousIdIssue({ domain, recordId, clientId, counterpartyId, entity, id, count }) {
  return auditEntry({
    classification: 'B7',
    domain,
    recordId,
    clientId,
    counterpartyId,
    code: COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
    message: `Stable ID ${id || 'не указан'} неоднозначен для ${entity}.`,
    context: { entity, id: id || null, matches: count },
  });
}

function auditCounterpartyRelations(data) {
  const rawCounterparties = readCollection(data, 'counterparties');
  const rawClients = readCollection(data, 'clients');
  const rawObjects = readCollection(data, 'client_objects');
  const counterparties = Array.isArray(rawCounterparties) ? rawCounterparties : [];
  const clients = Array.isArray(rawClients) ? rawClients : [];
  const objects = Array.isArray(rawObjects) ? rawObjects : [];
  const counterpartyIndex = buildIdIndex(counterparties);
  const clientIndex = buildIdIndex(clients);
  const objectIndex = buildIdIndex(objects);
  const healthy = [];
  const repairable = [];
  const broken = [];

  for (const counterparty of counterparties) {
    const counterpartyId = relationId(counterparty?.id);
    if (!counterpartyId) {
      broken.push(auditEntry({
        classification: 'B7',
        domain: 'counterparties',
        code: COUNTERPARTY_RELATION_CODES.COUNTERPARTY_ID_REQUIRED,
        message: 'Counterparty без стабильного id нельзя использовать в canonical relation.',
        context: { reason: 'record_id_missing' },
      }));
    }
  }
  for (const [counterpartyId, matches] of counterpartyIndex) {
    if (matches.length > 1) {
      broken.push(ambiguousIdIssue({
        domain: 'counterparties',
        recordId: counterpartyId,
        counterpartyId,
        entity: 'Counterparty',
        id: counterpartyId,
        count: matches.length,
      }));
    }
  }

  for (const client of clients) {
    const clientId = relationId(client?.id);
    const counterpartyId = relationId(client?.counterpartyId);
    if (!clientId) {
      broken.push(auditEntry({
        classification: 'B7',
        domain: 'clients',
        counterpartyId,
        code: COUNTERPARTY_RELATION_CODES.CLIENT_ID_REQUIRED,
        message: 'Client без стабильного id нельзя использовать в customer relation.',
        context: { reason: 'record_id_missing' },
      }));
      continue;
    }

    const duplicateClients = clientIndex.get(clientId) || [];
    if (duplicateClients.length > 1) continue;
    if (!counterpartyId) {
      broken.push(auditEntry({
        classification: 'B6',
        domain: 'clients',
        recordId: clientId,
        clientId,
        code: COUNTERPARTY_RELATION_CODES.CLIENT_LINK_MISSING,
        message: 'Client не содержит canonical counterpartyId; controlled repair не создаёт Counterparty.',
        context: { legacyFields: presentLegacyIdentityFields(client) },
      }));
      continue;
    }

    const counterpartyMatch = indexedRelation(counterpartyIndex, counterpartyId);
    if (counterpartyMatch.status === 'missing') {
      broken.push(auditEntry({
        classification: 'B1',
        domain: 'clients',
        recordId: clientId,
        clientId,
        counterpartyId,
        code: COUNTERPARTY_RELATION_CODES.COUNTERPARTY_NOT_FOUND,
        message: 'Client.counterpartyId указывает на отсутствующий Counterparty.',
      }));
      continue;
    }
    if (counterpartyMatch.status === 'ambiguous') {
      broken.push(ambiguousIdIssue({
        domain: 'clients',
        recordId: clientId,
        clientId,
        counterpartyId,
        entity: 'Counterparty',
        id: counterpartyId,
        count: counterpartyMatch.count,
      }));
      continue;
    }
    if (isArchivedCounterparty(counterpartyMatch.item)) {
      broken.push(auditEntry({
        classification: 'B8',
        domain: 'clients',
        recordId: clientId,
        clientId,
        counterpartyId,
        code: COUNTERPARTY_RELATION_CODES.COUNTERPARTY_ARCHIVED,
        message: 'Client не может использовать архивный Counterparty как активную customer relation.',
      }));
      continue;
    }
    if (!hasActiveCounterpartyRole(counterpartyMatch.item, 'customer', data)) {
      broken.push(auditEntry({
        classification: 'B5',
        domain: 'clients',
        recordId: clientId,
        clientId,
        counterpartyId,
        code: COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED,
        message: 'Counterparty, связанный с Client, не содержит роль customer.',
      }));
      continue;
    }
    healthy.push(auditEntry({
      classification: 'H1',
      domain: 'clients',
      recordId: clientId,
      clientId,
      counterpartyId,
      code: null,
      repairability: 'not_needed',
      message: 'Client.counterpartyId однозначно указывает на существующий customer Counterparty.',
    }));
  }

  for (const [clientId, matches] of clientIndex) {
    if (matches.length > 1) {
      broken.push(ambiguousIdIssue({
        domain: 'clients',
        recordId: clientId,
        clientId,
        entity: 'Client',
        id: clientId,
        count: matches.length,
      }));
    }
  }

  for (const object of objects) {
    const recordId = relationId(object?.id);
    const clientId = relationId(object?.clientId);
    const counterpartyId = relationId(object?.counterpartyId);
    const allowArchived = relationId(object?.status) === 'archived';
    const objectIssues = [];
    let client = null;
    let clientCounterpartyId = '';
    let clientCounterparty = null;
    let objectCounterparty = null;

    if (!recordId) {
      objectIssues.push(auditEntry({
        classification: 'B7',
        domain: 'client_objects',
        clientId,
        counterpartyId,
        code: COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
        message: 'ClientObject без стабильного id нельзя безопасно изменить.',
        context: { entity: 'ClientObject', reason: 'record_id_missing' },
      }));
    } else if ((objectIndex.get(recordId) || []).length > 1) {
      objectIssues.push(ambiguousIdIssue({
        domain: 'client_objects',
        recordId,
        clientId,
        counterpartyId,
        entity: 'ClientObject',
        id: recordId,
        count: objectIndex.get(recordId).length,
      }));
    }

    if (!clientId && !counterpartyId) {
      objectIssues.push(auditEntry({
        classification: 'B6',
        domain: 'client_objects',
        recordId,
        code: COUNTERPARTY_RELATION_CODES.ID_REQUIRED,
        message: 'ClientObject не содержит stable clientId или counterpartyId.',
        context: { legacyFields: presentLegacyIdentityFields(object) },
      }));
    }

    if (clientId) {
      const clientMatch = indexedRelation(clientIndex, clientId);
      if (clientMatch.status === 'missing') {
        objectIssues.push(auditEntry({
          classification: 'B2',
          domain: 'client_objects',
          recordId,
          clientId,
          counterpartyId,
          code: COUNTERPARTY_RELATION_CODES.CLIENT_NOT_FOUND,
          message: 'ClientObject.clientId указывает на отсутствующий Client.',
        }));
      } else if (clientMatch.status === 'ambiguous') {
        objectIssues.push(ambiguousIdIssue({
          domain: 'client_objects',
          recordId,
          clientId,
          counterpartyId,
          entity: 'Client',
          id: clientId,
          count: clientMatch.count,
        }));
      } else {
        client = clientMatch.item;
        clientCounterpartyId = relationId(client?.counterpartyId);
        if (!clientCounterpartyId) {
          objectIssues.push(auditEntry({
            classification: 'B6',
            domain: 'client_objects',
            recordId,
            clientId,
            counterpartyId,
            code: COUNTERPARTY_RELATION_CODES.CLIENT_LINK_MISSING,
            message: 'Связанный Client не содержит canonical counterpartyId.',
          }));
        } else {
          const clientCounterpartyMatch = indexedRelation(counterpartyIndex, clientCounterpartyId);
          if (clientCounterpartyMatch.status === 'missing') {
            objectIssues.push(auditEntry({
              classification: 'B1',
              domain: 'client_objects',
              recordId,
              clientId,
              counterpartyId: clientCounterpartyId,
              code: COUNTERPARTY_RELATION_CODES.COUNTERPARTY_NOT_FOUND,
              message: 'Client.counterpartyId указывает на отсутствующий Counterparty.',
              context: { relation: 'Client.counterpartyId' },
            }));
          } else if (clientCounterpartyMatch.status === 'ambiguous') {
            objectIssues.push(ambiguousIdIssue({
              domain: 'client_objects',
              recordId,
              clientId,
              counterpartyId: clientCounterpartyId,
              entity: 'Counterparty',
              id: clientCounterpartyId,
              count: clientCounterpartyMatch.count,
            }));
          } else {
            clientCounterparty = clientCounterpartyMatch.item;
            if (!allowArchived && isArchivedCounterparty(clientCounterparty)) {
              objectIssues.push(auditEntry({
                classification: 'B8',
                domain: 'client_objects',
                recordId,
                clientId,
                counterpartyId: clientCounterpartyId,
                code: COUNTERPARTY_RELATION_CODES.COUNTERPARTY_ARCHIVED,
                message: 'Активный ClientObject не может ссылаться на архивный Counterparty.',
              }));
            }
            if (!hasActiveCounterpartyRole(clientCounterparty, 'customer', data)) {
              objectIssues.push(auditEntry({
                classification: 'B5',
                domain: 'client_objects',
                recordId,
                clientId,
                counterpartyId: clientCounterpartyId,
                code: COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED,
                message: 'Customer-specific ClientObject указывает на Counterparty без роли customer.',
              }));
            }
          }
        }
      }
    }

    if (counterpartyId) {
      const objectCounterpartyMatch = indexedRelation(counterpartyIndex, counterpartyId);
      if (objectCounterpartyMatch.status === 'missing') {
        objectIssues.push(auditEntry({
          classification: 'B3',
          domain: 'client_objects',
          recordId,
          clientId,
          counterpartyId,
          code: COUNTERPARTY_RELATION_CODES.COUNTERPARTY_NOT_FOUND,
          message: 'ClientObject.counterpartyId указывает на отсутствующий Counterparty.',
          context: { relation: 'ClientObject.counterpartyId' },
        }));
      } else if (objectCounterpartyMatch.status === 'ambiguous') {
        objectIssues.push(ambiguousIdIssue({
          domain: 'client_objects',
          recordId,
          clientId,
          counterpartyId,
          entity: 'Counterparty',
          id: counterpartyId,
          count: objectCounterpartyMatch.count,
        }));
      } else {
        objectCounterparty = objectCounterpartyMatch.item;
        if (!allowArchived && isArchivedCounterparty(objectCounterparty)) {
          objectIssues.push(auditEntry({
            classification: 'B8',
            domain: 'client_objects',
            recordId,
            clientId,
            counterpartyId,
            code: COUNTERPARTY_RELATION_CODES.COUNTERPARTY_ARCHIVED,
            message: 'Активный ClientObject не может ссылаться на архивный Counterparty.',
          }));
        }
      }
    }

    if (
      client
      && clientCounterparty
      && objectCounterparty
      && clientCounterpartyId !== counterpartyId
    ) {
      objectIssues.push(auditEntry({
        classification: 'B4',
        domain: 'client_objects',
        recordId,
        clientId,
        counterpartyId,
        code: COUNTERPARTY_RELATION_CODES.MISMATCH,
        message: 'ClientObject.clientId и ClientObject.counterpartyId указывают на разных Counterparty.',
        context: { clientCounterpartyId },
      }));
    }

    if (objectIssues.length > 0) {
      broken.push(...objectIssues);
      continue;
    }
    if (!counterpartyId && client && clientCounterparty) {
      repairable.push(auditEntry({
        classification: 'R1',
        domain: 'client_objects',
        recordId,
        clientId,
        counterpartyId: clientCounterpartyId,
        code: COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
        repairability: 'deterministic_id_chain',
        message: 'ClientObject.counterpartyId можно заполнить из explicit Client.counterpartyId.',
        repair: {
          collection: 'client_objects',
          field: 'counterpartyId',
          previousValue: null,
          nextValue: clientCounterpartyId,
        },
      }));
      continue;
    }
    if (counterpartyId) {
      healthy.push(auditEntry({
        classification: clientId ? 'H3' : 'H2',
        domain: 'client_objects',
        recordId,
        clientId,
        counterpartyId,
        code: null,
        repairability: 'not_needed',
        message: clientId
          ? 'ClientObject clientId/counterpartyId chain согласована.'
          : 'ClientObject.counterpartyId однозначно указывает на существующий Counterparty.',
      }));
    }
  }

  return {
    healthy,
    repairable,
    broken,
    summary: {
      healthy: healthy.length,
      repairable: repairable.length,
      broken: broken.length,
      scanned: {
        counterparties: counterparties.length,
        clients: clients.length,
        clientObjects: objects.length,
      },
    },
  };
}

function repairCounterpartyRelations({
  readData,
  writeDataBatch,
  dryRun = true,
}) {
  const audit = auditCounterpartyRelations({ readData });
  const rawObjects = readCollection({ readData }, 'client_objects');
  const objects = Array.isArray(rawObjects) ? rawObjects : [];
  const repairByObjectId = new Map(audit.repairable.map(issue => [issue.recordId, issue]));
  const planned = [];
  const failed = [];
  const nextObjects = objects.map(object => {
    const recordId = relationId(object?.id);
    const issue = repairByObjectId.get(recordId);
    if (!issue) return object;
    if (
      relationId(object?.counterpartyId)
      || relationId(object?.clientId) !== issue.clientId
    ) {
      failed.push(auditEntry({
        classification: 'B7',
        domain: 'client_objects',
        recordId,
        clientId: object?.clientId,
        counterpartyId: object?.counterpartyId,
        code: COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
        message: 'ClientObject изменился после audit; repair пропущен.',
        context: { reason: 'audit_precondition_changed' },
      }));
      return object;
    }
    const change = {
      classification: issue.classification,
      domain: issue.domain,
      recordId,
      clientId: issue.clientId,
      counterpartyId: issue.counterpartyId,
      code: issue.code,
      field: 'counterpartyId',
      previousValue: null,
      nextValue: issue.counterpartyId,
      applied: !dryRun,
    };
    planned.push(change);
    return dryRun ? object : { ...object, counterpartyId: issue.counterpartyId };
  });

  if (!dryRun && planned.length > 0) {
    if (failed.length > 0) {
      failed.push(...planned.map(change => auditEntry({
        classification: 'B7',
        domain: change.domain,
        recordId: change.recordId,
        clientId: change.clientId,
        counterpartyId: change.counterpartyId,
        code: COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
        message: 'Atomic relation repair отменён из-за изменившихся preconditions.',
        context: { reason: 'repair_batch_aborted' },
      })));
      planned.length = 0;
    } else if (typeof writeDataBatch !== 'function') {
      failed.push(...planned.map(change => auditEntry({
        classification: 'B7',
        domain: change.domain,
        recordId: change.recordId,
        clientId: change.clientId,
        counterpartyId: change.counterpartyId,
        code: COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
        message: 'Actual repair требует writeDataBatch.',
        context: { reason: 'writer_missing' },
      })));
      planned.length = 0;
    } else {
      try {
        writeDataBatch([{ name: 'client_objects', value: nextObjects }]);
      } catch (error) {
        failed.push(...planned.map(change => auditEntry({
          classification: 'B7',
          domain: change.domain,
          recordId: change.recordId,
          clientId: change.clientId,
          counterpartyId: change.counterpartyId,
          code: COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
          message: 'Не удалось persist controlled relation repair.',
          context: { reason: 'persistence_failed', error: error?.message || String(error) },
        })));
        planned.length = 0;
      }
    }
  }

  return {
    dryRun: Boolean(dryRun),
    changed: planned,
    skipped: audit.broken,
    failed,
    audit,
    summary: {
      changed: planned.length,
      skipped: audit.broken.length,
      failed: failed.length,
    },
  };
}

function ensureClientObjectCounterpartyLinks({
  readData,
  writeDataBatch,
  logger = console,
}) {
  const result = repairCounterpartyRelations({ readData, writeDataBatch, dryRun: false });
  const issues = [...result.skipped, ...result.failed]
    .filter(issue => issue.domain === 'client_objects')
    .map(issue => ({
      ...issue,
      objectId: issue.recordId,
      error: issue.message,
    }));
  for (const issue of issues) {
    logger.warn?.(
      `[counterparty-relations] client_objects migration skipped: objectId=${issue.objectId || 'missing'} `
      + `code=${issue.code} error=${issue.error}`,
    );
  }
  if (result.failed.length > 0) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
      'Не удалось выполнить I-D client_objects canonical backfill.',
      500,
      { failed: result.failed.length },
    );
  }
  const linked = result.changed.length;
  if (linked > 0) {
    logger.log?.(
      `[counterparty-relations] client_objects migration: linked=${linked}, issues=${issues.length}`,
    );
  }
  return { linked, issues, changed: linked > 0 };
}

module.exports = {
  COUNTERPARTY_RELATION_CODES,
  assertClientCounterpartyLink,
  auditCounterpartyRelations,
  ensureClientObjectCounterpartyLinks,
  isArchivedCounterparty,
  repairCounterpartyRelations,
  resolveClientCounterparty,
  resolveCounterpartyById,
  resolveCounterpartyForClient,
  resolveDomainCounterpartyRelation,
};
