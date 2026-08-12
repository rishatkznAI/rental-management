const {
  COUNTERPARTY_RELATION_CODES,
  resolveDomainCounterpartyRelation,
} = require('./counterparty-relations');
const { counterpartyError } = require('./counterparty');
const { normalizeDocumentType } = require('./document-registry');

const CUSTOMER_REQUIRED_DOCUMENT_TYPES = new Set([
  'contract',
  'rental_contract',
  'rental_specification',
  'transfer_act_to_client',
  'return_act_from_client',
]);

const DOCUMENT_RELATION_FIELDS = Object.freeze([
  'counterpartyId',
  'clientId',
  'rentalId',
  'rental',
  'classicRentalId',
  'ganttRentalId',
  'objectId',
  'contractId',
  'parentDocumentId',
  'specificationId',
]);

const DOCUMENT_DISPLAY_IDENTITY_FIELDS = Object.freeze([
  'client',
  'clientName',
  'company',
  'companyName',
  'clientLegalName',
  'clientInn',
  'inn',
  'phone',
  'email',
  'address',
]);

const DOCUMENT_CONTRACT_RELATION_CLASSIFICATIONS = Object.freeze({
  VALID: 'valid',
  REPAIRABLE: 'repairable',
  CONFLICTING: 'conflicting',
  UNRESOLVED: 'unresolved',
});

function relationId(value) {
  return String(value ?? '').trim();
}

function readCollection(data, name) {
  if (typeof data === 'function') return data(name) || [];
  if (data && typeof data.readData === 'function') return data.readData(name) || [];
  return data?.[name] || [];
}

function findUniqueById(data, collection, id, relation) {
  const wanted = relationId(id);
  if (!wanted) return null;
  const matches = readCollection(data, collection)
    .filter(item => relationId(item?.id) === wanted);
  if (matches.length > 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
      `Stable ID ${wanted} неоднозначен в коллекции ${collection}.`,
      409,
      { domain: collection, relation, id: wanted, matches: matches.length },
    );
  }
  return matches[0] || null;
}

function rentalReferenceIds(rental) {
  return [
    rental?.id,
    rental?.rentalId,
    rental?.sourceRentalId,
    rental?.originalRentalId,
  ].map(relationId).filter(Boolean);
}

function documentRentalId(document) {
  return relationId(
    document?.rentalId
    || document?.rental
    || document?.classicRentalId
    || document?.ganttRentalId,
  );
}

function resolveRentalForDocument(document, data) {
  const rentalId = documentRentalId(document);
  if (!rentalId) return null;
  const domains = ['rentals', 'gantt_rentals'];
  for (const domain of domains) {
    const exact = readCollection(data, domain)
      .filter(item => relationId(item?.id) === rentalId);
    if (exact.length > 1) {
      throw counterpartyError(
        COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
        `Stable Rental ID ${rentalId} неоднозначен в ${domain}.`,
        409,
        { domain, relation: 'Document.rentalId', id: rentalId, matches: exact.length },
      );
    }
    if (exact.length === 1) return exact[0];
  }
  for (const domain of domains) {
    const aliases = readCollection(data, domain)
      .filter(item => rentalReferenceIds(item).includes(rentalId));
    if (aliases.length > 1) {
      throw counterpartyError(
        COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
        `Rental reference ${rentalId} неоднозначен в ${domain}.`,
        409,
        { domain, relation: 'Document.rentalId', id: rentalId, matches: aliases.length },
      );
    }
    if (aliases.length === 1) return aliases[0];
  }
  throw counterpartyError(
    COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
    'Связанная аренда не найдена по stable ID.',
    409,
    { rentalId },
  );
}

function resolveCustomerRecordRelation(record, data, {
  allowArchived = false,
  domain = 'record',
} = {}) {
  try {
    return resolveDomainCounterpartyRelation(record, data, {
      allowArchived,
      allowCounterpartyOnly: true,
      requireCustomerRole: true,
    });
  } catch (error) {
    if (error?.details) {
      error.details = { domain, ...error.details };
    }
    throw error;
  }
}

function candidateFromRecord(record, data, options = {}) {
  if (!relationId(record?.counterpartyId) && !relationId(record?.clientId)) return null;
  const relation = resolveCustomerRecordRelation(record, data, options);
  return {
    source: options.domain || 'record',
    counterpartyId: relation.counterpartyId,
    clientId: relation.clientId || null,
    counterparty: relation.counterparty,
    client: relation.client,
  };
}

function candidateFromRental(document, data, { allowArchived = false } = {}) {
  const rental = resolveRentalForDocument(document, data);
  if (!rental) return null;
  const rentalCounterpartyId = relationId(rental?.counterpartyId);
  if (!rentalCounterpartyId) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
      'Rental.counterpartyId обязателен для связанного документа.',
      409,
      { rentalId: relationId(rental?.id) || documentRentalId(document), field: 'rental.counterpartyId' },
    );
  }
  const relation = resolveCustomerRecordRelation({
    counterpartyId: rentalCounterpartyId,
    clientId: relationId(rental?.clientId) || undefined,
  }, data, { allowArchived, domain: 'rentals' });
  return {
    source: 'rental',
    counterpartyId: relation.counterpartyId,
    clientId: relation.clientId || null,
    counterparty: relation.counterparty,
    client: relation.client,
    rental,
  };
}

function assertCandidatesAgree(candidates, context = {}) {
  const present = candidates.filter(Boolean);
  if (present.length === 0) return null;
  const counterpartyIds = [...new Set(present.map(item => item.counterpartyId).filter(Boolean))];
  if (counterpartyIds.length !== 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.MISMATCH,
      'Stable relation chains указывают на разных Counterparty.',
      409,
      {
        ...context,
        candidates: present.map(item => ({
          source: item.source,
          counterpartyId: item.counterpartyId,
          clientId: item.clientId || null,
        })),
      },
    );
  }
  const clientIds = [...new Set(present.map(item => item.clientId).filter(Boolean))];
  if (clientIds.length > 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.MISMATCH,
      'Stable relation chains содержат разные compatibility Client ID.',
      409,
      {
        ...context,
        counterpartyId: counterpartyIds[0],
        clientIds,
        candidates: present.map(item => ({ source: item.source, clientId: item.clientId || null })),
      },
    );
  }
  const primary = present[0];
  return {
    ...primary,
    counterpartyId: counterpartyIds[0],
    clientId: clientIds[0] || null,
  };
}

function resolveObjectCandidate(objectId, data, options = {}) {
  const id = relationId(objectId);
  if (!id) return null;
  const object = findUniqueById(data, 'client_objects', id, 'Document.objectId');
  if (!object) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
      'Связанный ClientObject не найден по stable ID.',
      409,
      { objectId: id },
    );
  }
  if (options.requireActiveObject && relationId(object?.status) === 'archived') {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_OBJECT_ARCHIVED',
      'Архивный объект нельзя выбрать для нового документа.',
      409,
      { objectId: id },
    );
  }
  const candidate = candidateFromRecord(object, data, {
    allowArchived: options.allowArchived,
    domain: 'client_objects',
  });
  if (!candidate) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
      'ClientObject не содержит deterministic stable Counterparty relation.',
      409,
      { objectId: id },
    );
  }
  return { ...candidate, source: 'object', object };
}

function resolveClientContractCounterpartyRelation(contract, data, {
  allowArchived = false,
  existing = null,
} = {}) {
  const candidates = [];
  const direct = candidateFromRecord(contract, data, {
    allowArchived,
    domain: 'client_contracts',
  });
  if (direct) candidates.push({ ...direct, source: relationId(contract?.counterpartyId) ? 'counterparty' : 'client' });

  const objectIds = [...new Set([
    contract?.objectId,
    ...(Array.isArray(contract?.objectIds) ? contract.objectIds : []),
  ].map(relationId).filter(Boolean))];
  for (const objectId of objectIds) {
    candidates.push(resolveObjectCandidate(objectId, data, { allowArchived }));
  }

  const relation = assertCandidatesAgree(candidates, {
    domain: 'client_contracts',
    contractId: relationId(contract?.id) || null,
  });
  if (!relation) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.ID_REQUIRED,
      'Для договора клиента укажите explicit counterpartyId или legacy clientId.',
      400,
      { fields: ['counterpartyId', 'clientId'] },
    );
  }

  if (existing) {
    let previous = null;
    try {
      previous = resolveClientContractCounterpartyRelation(existing, data, {
        allowArchived: true,
      });
    } catch (error) {
      if (relationId(existing?.counterpartyId) || relationId(existing?.clientId)) throw error;
    }
    if (previous && previous.counterpartyId !== relation.counterpartyId) {
      throw counterpartyError(
        'COUNTERPARTY_RELATION_IMMUTABLE',
        'Связь ClientContract с Counterparty нельзя менять обычным обновлением.',
        409,
        {
          contractId: relationId(existing?.id) || null,
          counterpartyId: previous.counterpartyId,
          requestedCounterpartyId: relation.counterpartyId,
        },
      );
    }
  }
  return relation;
}

function canonicalizeClientContractCounterpartyRelation(contract, data, options = {}) {
  const relation = resolveClientContractCounterpartyRelation(contract, data, options);
  const next = {
    ...contract,
    counterpartyId: relation.counterpartyId,
  };
  if (relation.clientId) next.clientId = relation.clientId;
  else delete next.clientId;
  return next;
}

function documentRequiresCustomerRelation(document) {
  return CUSTOMER_REQUIRED_DOCUMENT_TYPES.has(normalizeDocumentType(
    document?.documentType || document?.type,
  ));
}

function documentHasStableRelation(document) {
  return DOCUMENT_RELATION_FIELDS.some(field => relationId(document?.[field]));
}

function isHistoricalDocumentRelation(document) {
  return ['signed', 'cancelled', 'canceled', 'expired']
    .includes(relationId(document?.status).toLowerCase());
}

function isHistoricalClientContractRelation(contract) {
  return relationId(contract?.status).toLowerCase() === 'archived';
}

function resolveLinkedDocumentCandidate(documentId, source, data, options) {
  const id = relationId(documentId);
  if (!id) return null;
  const linked = findUniqueById(data, 'documents', id, `Document.${source}Id`);
  if (!linked) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
      `Связанный ${source} Document не найден по stable ID.`,
      409,
      { documentId: id, relation: source },
    );
  }
  const visited = options.visited || new Set();
  if (visited.has(id)) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
      'Циклическая цепочка связанных документов не может определить Counterparty.',
      409,
      { documentId: id, relation: source },
    );
  }
  const relation = resolveDocumentCounterpartyRelation(linked, data, {
    ...options,
    requireRelation: true,
    visited: new Set([...visited, id]),
  });
  if (!relation) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
      `Связанный ${source} Document не содержит deterministic Counterparty relation.`,
      409,
      { documentId: id, relation: source },
    );
  }
  return { ...relation, source, document: linked };
}

function resolveDocumentCounterpartyRelation(document, data, {
  allowArchived = false,
  requireActiveObject = false,
  requireRelation = documentRequiresCustomerRelation(document),
  visited = new Set(),
} = {}) {
  const shouldResolve = requireRelation || documentHasStableRelation(document);
  if (!shouldResolve) return null;

  const candidates = [];
  const direct = candidateFromRecord(document, data, {
    allowArchived,
    domain: 'documents',
  });
  if (direct) candidates.push({ ...direct, source: relationId(document?.counterpartyId) ? 'counterparty' : 'client' });

  if (documentRentalId(document)) {
    candidates.push(candidateFromRental(document, data, { allowArchived }));
  }

  const contractId = relationId(document?.contractId);
  if (contractId) {
    const contract = findUniqueById(data, 'client_contracts', contractId, 'Document.contractId');
    if (!contract) {
      throw counterpartyError(
        COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
        'Связанный ClientContract не найден по stable ID.',
        409,
        { contractId },
      );
    }
    const relation = resolveClientContractCounterpartyRelation(contract, data, { allowArchived });
    candidates.push({ ...relation, source: 'contract', contract });
  }

  const objectCandidate = resolveObjectCandidate(document?.objectId, data, {
    allowArchived,
    requireActiveObject,
  });
  if (objectCandidate) candidates.push(objectCandidate);

  if (relationId(document?.parentDocumentId)) {
    candidates.push(resolveLinkedDocumentCandidate(
      document.parentDocumentId,
      'parent',
      data,
      { allowArchived, requireActiveObject: false, visited },
    ));
  }
  if (relationId(document?.specificationId)) {
    candidates.push(resolveLinkedDocumentCandidate(
      document.specificationId,
      'specification',
      data,
      { allowArchived, requireActiveObject: false, visited },
    ));
  }

  const relation = assertCandidatesAgree(candidates, {
    domain: 'documents',
    documentId: relationId(document?.id) || null,
  });
  if (!relation) {
    const metadataFields = DOCUMENT_DISPLAY_IDENTITY_FIELDS
      .filter(field => relationId(document?.[field]));
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.ID_REQUIRED,
      'Для customer-bearing документа укажите stable counterpartyId или связанную stable-ID цепочку.',
      400,
      {
        fields: ['counterpartyId', 'clientId'],
        metadataOnly: metadataFields.length > 0,
        metadataFields,
      },
    );
  }
  return relation;
}

function canonicalizeDocumentCounterpartyRelation(document, data, {
  existing = null,
  ...options
} = {}) {
  const relation = resolveDocumentCounterpartyRelation(document, data, options);
  if (!relation) return { ...document };
  if (existing && relationId(existing?.counterpartyId)) {
    const previousCounterpartyId = relationId(existing.counterpartyId);
    if (previousCounterpartyId !== relation.counterpartyId) {
      throw counterpartyError(
        'COUNTERPARTY_RELATION_IMMUTABLE',
        'Связь Document с Counterparty нельзя менять обычным обновлением.',
        409,
        {
          documentId: relationId(existing?.id) || null,
          counterpartyId: previousCounterpartyId,
          requestedCounterpartyId: relation.counterpartyId,
        },
      );
    }
  }
  const next = {
    ...document,
    counterpartyId: relation.counterpartyId,
  };
  if (relation.clientId) next.clientId = relation.clientId;
  else delete next.clientId;
  return next;
}

function duplicateIds(list) {
  const counts = new Map();
  for (const item of Array.isArray(list) ? list : []) {
    const id = relationId(item?.id);
    if (!id) continue;
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function auditEntry(domain, record, classification, details = {}) {
  return {
    classification,
    domain,
    recordId: relationId(record?.id) || null,
    counterpartyId: relationId(record?.counterpartyId) || null,
    clientId: relationId(record?.clientId) || null,
    ...details,
  };
}

function classifyRelationError(error) {
  return [
    COUNTERPARTY_RELATION_CODES.MISMATCH,
    COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
    'COUNTERPARTY_RELATION_IMMUTABLE',
  ].includes(error?.code)
    ? DOCUMENT_CONTRACT_RELATION_CLASSIFICATIONS.CONFLICTING
    : DOCUMENT_CONTRACT_RELATION_CLASSIFICATIONS.UNRESOLVED;
}

function auditDomainRecords({ domain, records, data, canonicalize, historical }) {
  const counts = duplicateIds(records);
  const entries = [];
  for (const record of records) {
    const recordId = relationId(record?.id);
    if (!recordId || (counts.get(recordId) || 0) > 1) {
      entries.push(auditEntry(domain, record, DOCUMENT_CONTRACT_RELATION_CLASSIFICATIONS.CONFLICTING, {
        code: COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
        repairability: 'none',
        message: recordId
          ? `Stable ID ${recordId} неоднозначен.`
          : 'Запись без stable id нельзя безопасно изменить.',
        context: { id: recordId || null, matches: counts.get(recordId) || 0 },
      }));
      continue;
    }
    try {
      const next = canonicalize(record, data, {
        allowArchived: historical(record),
      });
      const changedFields = ['counterpartyId', 'clientId']
        .filter(field => relationId(next?.[field]) !== relationId(record?.[field]));
      if (changedFields.length > 0) {
        entries.push(auditEntry(domain, record, DOCUMENT_CONTRACT_RELATION_CLASSIFICATIONS.REPAIRABLE, {
          counterpartyId: relationId(next.counterpartyId) || null,
          clientId: relationId(next.clientId) || null,
          code: COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
          repairability: 'deterministic_stable_id_chain',
          message: 'Canonical relation можно заполнить только по согласованной stable-ID цепочке.',
          repair: {
            collection: domain,
            fields: Object.fromEntries(changedFields.map(field => [field, next[field] || null])),
          },
        }));
      } else {
        entries.push(auditEntry(domain, record, DOCUMENT_CONTRACT_RELATION_CLASSIFICATIONS.VALID, {
          code: null,
          repairability: 'not_needed',
          message: relationId(next.counterpartyId)
            ? 'Canonical Counterparty relation согласована.'
            : 'Existing document contract permits an unlinked internal/lead record.',
        }));
      }
    } catch (error) {
      entries.push(auditEntry(domain, record, classifyRelationError(error), {
        code: error?.code || COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
        repairability: 'none',
        message: error?.message || 'Counterparty relation audit failed.',
        ...(error?.details ? { context: error.details } : {}),
      }));
    }
  }
  return entries;
}

function auditDocumentContractCounterpartyRelations(data) {
  const contracts = readCollection(data, 'client_contracts');
  const documents = readCollection(data, 'documents');
  const entries = [
    ...auditDomainRecords({
      domain: 'client_contracts',
      records: contracts,
      data,
      canonicalize: canonicalizeClientContractCounterpartyRelation,
      historical: isHistoricalClientContractRelation,
    }),
    ...auditDomainRecords({
      domain: 'documents',
      records: documents,
      data,
      canonicalize: canonicalizeDocumentCounterpartyRelation,
      historical: isHistoricalDocumentRelation,
    }),
  ];
  const classifications = Object.values(DOCUMENT_CONTRACT_RELATION_CLASSIFICATIONS)
    .reduce((result, classification) => ({ ...result, [classification]: 0 }), {});
  for (const entry of entries) classifications[entry.classification] += 1;
  return {
    ok: classifications.conflicting === 0 && classifications.unresolved === 0,
    authority: 'Counterparty.id',
    roleAuthority: 'counterparty_role_assignments',
    entries,
    summary: {
      classifications,
      scanned: {
        documents: documents.length,
        clientContracts: contracts.length,
      },
    },
  };
}

function repairDocumentContractCounterpartyRelations({
  readData,
  writeDataBatch,
  dryRun = true,
}) {
  const data = { readData };
  const audit = auditDocumentContractCounterpartyRelations(data);
  const conflicting = audit.entries.filter(entry => (
    entry.classification === DOCUMENT_CONTRACT_RELATION_CLASSIFICATIONS.CONFLICTING
  ));
  if (!dryRun && conflicting.length > 0) {
    throw counterpartyError(
      'DOCUMENT_CONTRACT_RELATION_CONFLICTS',
      'Apply заблокирован: найдены conflicting stable relation chains.',
      409,
      { conflicts: conflicting.map(entry => ({ domain: entry.domain, recordId: entry.recordId, code: entry.code })) },
    );
  }

  const repairableByDomain = new Map();
  for (const entry of audit.entries) {
    if (entry.classification !== DOCUMENT_CONTRACT_RELATION_CLASSIFICATIONS.REPAIRABLE) continue;
    const domain = repairableByDomain.get(entry.domain) || new Map();
    domain.set(entry.recordId, entry.repair.fields);
    repairableByDomain.set(entry.domain, domain);
  }
  const entries = [];
  for (const domain of ['client_contracts', 'documents']) {
    const repairs = repairableByDomain.get(domain);
    if (!repairs || repairs.size === 0) continue;
    const next = readCollection(data, domain).map(record => {
      const fields = repairs.get(relationId(record?.id));
      if (!fields) return record;
      const updated = { ...record };
      for (const [field, value] of Object.entries(fields)) {
        if (value) updated[field] = value;
        else delete updated[field];
      }
      return updated;
    });
    entries.push({ name: domain, value: next });
  }
  if (!dryRun && entries.length > 0) {
    if (typeof writeDataBatch !== 'function') {
      throw new Error('writeDataBatch is required for apply mode');
    }
    writeDataBatch(entries);
  }
  return {
    dryRun,
    changed: entries.length > 0,
    wrote: !dryRun && entries.length > 0,
    changedCollections: entries.map(entry => entry.name),
    changedRecords: audit.summary.classifications.repairable,
    audit,
  };
}

module.exports = {
  CUSTOMER_REQUIRED_DOCUMENT_TYPES,
  DOCUMENT_CONTRACT_RELATION_CLASSIFICATIONS,
  DOCUMENT_RELATION_FIELDS,
  auditDocumentContractCounterpartyRelations,
  canonicalizeClientContractCounterpartyRelation,
  canonicalizeDocumentCounterpartyRelation,
  documentHasStableRelation,
  documentRequiresCustomerRelation,
  isHistoricalClientContractRelation,
  isHistoricalDocumentRelation,
  repairDocumentContractCounterpartyRelations,
  resolveClientContractCounterpartyRelation,
  resolveDocumentCounterpartyRelation,
};
