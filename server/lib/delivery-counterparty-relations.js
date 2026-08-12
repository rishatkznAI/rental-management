const {
  COUNTERPARTY_RELATION_CODES,
  assertClientCounterpartyLink,
  resolveCounterpartyById,
} = require('./counterparty-relations');
const { counterpartyError } = require('./counterparty');
const {
  activeRolesForCounterparty,
} = require('./counterparty-role-profiles');

const DELIVERY_RELATION_CLASSIFICATIONS = Object.freeze({
  VALID: 'valid',
  REPAIRABLE: 'repairable',
  CONFLICTING: 'conflicting',
  UNRESOLVED: 'unresolved',
});

const DELIVERY_CUSTOMER_DISPLAY_FIELDS = Object.freeze([
  'client',
  'clientName',
  'company',
  'companyName',
  'clientInn',
  'inn',
  'phone',
  'address',
]);

const DELIVERY_CARRIER_DISPLAY_FIELDS = Object.freeze([
  'carrier',
  'carrierName',
  'carrierPhone',
  'company',
  'inn',
  'name',
  'phone',
]);

const TERMINAL_DELIVERY_STATUSES = new Set(['completed', 'cancelled', 'canceled']);

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
  return matches[0] || null;
}

function isHistoricalDeliveryRelation(delivery) {
  return TERMINAL_DELIVERY_STATUSES.has(relationId(delivery?.status).toLowerCase());
}

function isHistoricalDeliveryCarrierRelation(carrier) {
  return relationId(carrier?.status).toLowerCase() === 'inactive';
}

function requireCounterpartyRole(counterparty, roleCode, data, { allowArchived = false, context = {} } = {}) {
  const roleIsActive = activeRolesForCounterparty(
    readCollection(data, 'counterparty_role_assignments'),
    relationId(counterparty?.id),
  ).includes(roleCode);
  const historicalProjectionHasRole = allowArchived
    && Array.isArray(counterparty?.roles)
    && counterparty.roles.includes(roleCode);
  if (!roleIsActive && !historicalProjectionHasRole) {
    throw counterpartyError(
      roleCode === 'customer'
        ? COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED
        : 'COUNTERPARTY_RELATION_CONTRACTOR_ROLE_REQUIRED',
      roleCode === 'customer'
        ? 'Counterparty доставки должен иметь активную роль customer.'
        : 'Counterparty перевозчика должен иметь активную роль contractor.',
      409,
      { ...context, counterpartyId: relationId(counterparty?.id) || null, roleCode },
    );
  }
  return counterparty;
}

function resolveCustomerRecordRelation(record, data, { allowArchived = false, domain = 'deliveries' } = {}) {
  const clientId = relationId(record?.clientId);
  const counterpartyId = relationId(record?.counterpartyId);
  if (clientId) {
    const relation = assertClientCounterpartyLink(
      { clientId, counterpartyId },
      data,
      { allowArchived, requireCustomerRole: false },
    );
    requireCounterpartyRole(
      relation.counterparty,
      'customer',
      data,
      { allowArchived, context: { domain, relation: `${domain}.clientId` } },
    );
    return relation;
  }
  if (counterpartyId) {
    const counterparty = requireCounterpartyRole(
      resolveCounterpartyById(counterpartyId, data, { allowArchived }),
      'customer',
      data,
      { allowArchived, context: { domain, relation: `${domain}.counterpartyId` } },
    );
    return {
      client: null,
      counterparty,
      clientId: null,
      counterpartyId: relationId(counterparty.id),
    };
  }
  return null;
}

function relationCandidate(relation, source, extra = {}) {
  if (!relation) return null;
  return {
    source,
    counterpartyId: relation.counterpartyId,
    clientId: relation.clientId || null,
    counterparty: relation.counterparty,
    client: relation.client || null,
    ...extra,
  };
}

function assertCustomerCandidatesAgree(candidates, context = {}) {
  const present = candidates.filter(Boolean);
  if (present.length === 0) return null;
  const counterpartyIds = [...new Set(present.map(item => relationId(item.counterpartyId)).filter(Boolean))];
  const clientIds = [...new Set(present.map(item => relationId(item.clientId)).filter(Boolean))];
  if (counterpartyIds.length !== 1 || clientIds.length > 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.MISMATCH,
      'Stable Delivery relation chains указывают на разных Counterparty/Client.',
      409,
      {
        ...context,
        candidates: present.map(item => ({
          source: item.source,
          counterpartyId: item.counterpartyId || null,
          clientId: item.clientId || null,
        })),
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

function resolveRentalCandidate(delivery, data, options = {}) {
  const referenceSpecs = [
    ['classicRentalId', 'rentals'],
    ['rentalId', 'rentals'],
    ['ganttRentalId', 'gantt_rentals'],
  ];
  const candidates = [];
  for (const [field, collection] of referenceSpecs) {
    const id = relationId(delivery?.[field]);
    if (!id) continue;
    const rental = findUniqueById(data, collection, id, `Delivery.${field}`);
    if (!rental) {
      throw counterpartyError(
        COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
        'Связанная аренда доставки не найдена по stable ID.',
        409,
        { field, rentalId: id, collection },
      );
    }
    const relation = resolveCustomerRecordRelation(rental, data, {
      allowArchived: options.allowArchived,
      domain: collection,
    });
    if (!relation) {
      throw counterpartyError(
        COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
        'Связанная аренда не содержит canonical Counterparty relation.',
        409,
        { field, rentalId: id, collection },
      );
    }
    candidates.push(relationCandidate(relation, field, { rental }));
  }
  return assertCustomerCandidatesAgree(candidates, {
    domain: 'deliveries',
    deliveryId: relationId(delivery?.id) || null,
  });
}

function resolveObjectCandidate(delivery, data, options = {}) {
  const objectId = relationId(delivery?.objectId);
  if (!objectId) return null;
  const object = findUniqueById(data, 'client_objects', objectId, 'Delivery.objectId');
  if (!object) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
      'Связанный объект доставки не найден по stable ID.',
      409,
      { objectId },
    );
  }
  if (options.requireActiveObject && relationId(object?.status).toLowerCase() === 'archived') {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_OBJECT_ARCHIVED',
      'Архивный объект нельзя выбрать для активной доставки.',
      409,
      { objectId },
    );
  }
  const relation = resolveCustomerRecordRelation(object, data, {
    allowArchived: options.allowArchived,
    domain: 'client_objects',
  });
  if (!relation) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
      'Связанный объект не содержит canonical Counterparty relation.',
      409,
      { objectId },
    );
  }
  return relationCandidate(relation, 'objectId', { object });
}

function resolveContractCandidate(delivery, data, options = {}) {
  const contractId = relationId(delivery?.contractId);
  if (!contractId) return null;
  const contract = findUniqueById(data, 'client_contracts', contractId, 'Delivery.contractId');
  if (!contract) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
      'Связанный договор доставки не найден по stable ID.',
      409,
      { contractId },
    );
  }
  const relation = resolveCustomerRecordRelation(contract, data, {
    allowArchived: options.allowArchived,
    domain: 'client_contracts',
  });
  if (!relation) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
      'Связанный договор не содержит canonical Counterparty relation.',
      409,
      { contractId },
    );
  }
  return relationCandidate(relation, 'contractId', { contract });
}

function resolveDeliveryCustomerRelation(delivery, data, options = {}) {
  const candidates = [];
  const direct = resolveCustomerRecordRelation(delivery, data, {
    allowArchived: options.allowArchived,
    domain: 'deliveries',
  });
  if (direct) candidates.push(relationCandidate(
    direct,
    relationId(delivery?.counterpartyId) ? 'counterpartyId' : 'clientId',
  ));
  const rental = resolveRentalCandidate(delivery, data, options);
  if (rental) candidates.push(rental);
  const object = resolveObjectCandidate(delivery, data, options);
  if (object) candidates.push(object);
  const contract = resolveContractCandidate(delivery, data, options);
  if (contract) candidates.push(contract);

  const relation = assertCustomerCandidatesAgree(candidates, {
    domain: 'deliveries',
    deliveryId: relationId(delivery?.id) || null,
  });
  if (relation) return relation;
  const metadataFields = DELIVERY_CUSTOMER_DISPLAY_FIELDS
    .filter(field => relationId(delivery?.[field]));
  throw counterpartyError(
    COUNTERPARTY_RELATION_CODES.ID_REQUIRED,
    'Для доставки укажите stable counterpartyId или связанную stable-ID цепочку.',
    400,
    {
      fields: ['counterpartyId', 'clientId', 'rentalId'],
      metadataOnly: metadataFields.length > 0,
      metadataFields,
    },
  );
}

function resolveDeliveryCarrierRecordRelation(carrier, data, { allowArchived = false } = {}) {
  const counterpartyId = relationId(carrier?.counterpartyId);
  const contractorCounterpartyId = relationId(carrier?.contractorCounterpartyId);
  if (counterpartyId && contractorCounterpartyId && counterpartyId !== contractorCounterpartyId) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.MISMATCH,
      'counterpartyId и contractorCounterpartyId перевозчика указывают на разных Counterparty.',
      409,
      { carrierId: relationId(carrier?.id) || null, counterpartyId, contractorCounterpartyId },
    );
  }
  const resolvedId = counterpartyId || contractorCounterpartyId;
  if (!resolvedId) {
    const metadataFields = DELIVERY_CARRIER_DISPLAY_FIELDS
      .filter(field => relationId(carrier?.[field]));
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.ID_REQUIRED,
      'Для перевозчика укажите stable counterpartyId; company/name/ИНН не устанавливают связь.',
      400,
      { fields: ['counterpartyId'], metadataOnly: metadataFields.length > 0, metadataFields },
    );
  }
  const counterparty = requireCounterpartyRole(
    resolveCounterpartyById(resolvedId, data, { allowArchived }),
    'contractor',
    data,
    { allowArchived, context: { domain: 'delivery_carriers', carrierId: relationId(carrier?.id) || null } },
  );
  return { counterparty, counterpartyId: relationId(counterparty.id) };
}

function canonicalizeDeliveryCarrierCounterpartyRelation(carrier, data, {
  existing = null,
  allowArchived = false,
} = {}) {
  const relation = resolveDeliveryCarrierRecordRelation(carrier, data, { allowArchived });
  const previousCounterpartyId = relationId(existing?.counterpartyId || existing?.contractorCounterpartyId);
  if (previousCounterpartyId && previousCounterpartyId !== relation.counterpartyId) {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_IMMUTABLE',
      'Связь DeliveryCarrier с Counterparty нельзя менять обычным обновлением.',
      409,
      {
        carrierId: relationId(existing?.id) || null,
        counterpartyId: previousCounterpartyId,
        requestedCounterpartyId: relation.counterpartyId,
      },
    );
  }
  const next = {
    ...carrier,
    counterpartyId: relation.counterpartyId,
    company: relation.counterparty.shortName || relation.counterparty.legalName || carrier?.company,
    inn: relation.counterparty.inn || undefined,
    name: relationId(carrier?.name)
      || relation.counterparty.shortName
      || relation.counterparty.legalName,
  };
  delete next.contractorCounterpartyId;
  return next;
}

function resolveDeliveryCarrierRelation(delivery, data, { allowArchived = false, requireActiveCarrier = true } = {}) {
  const carrierId = relationId(delivery?.carrierId || delivery?.carrierKey);
  const explicitCounterpartyId = relationId(
    delivery?.carrierCounterpartyId || delivery?.contractorCounterpartyId,
  );
  if (!carrierId && !explicitCounterpartyId) return null;
  if (!carrierId) {
    throw counterpartyError(
      'DELIVERY_CARRIER_ID_REQUIRED',
      'carrierCounterpartyId нельзя назначить без stable carrierId.',
      400,
      { field: 'carrierId', carrierCounterpartyId: explicitCounterpartyId },
    );
  }
  const carrier = findUniqueById(data, 'delivery_carriers', carrierId, 'Delivery.carrierId');
  if (!carrier) {
    throw counterpartyError(
      'DELIVERY_CARRIER_NOT_FOUND',
      'Перевозчик не найден по stable carrierId.',
      409,
      { carrierId },
    );
  }
  if (requireActiveCarrier && relationId(carrier?.status).toLowerCase() === 'inactive') {
    throw counterpartyError(
      'DELIVERY_CARRIER_INACTIVE',
      'Неактивного перевозчика нельзя назначить на активную доставку.',
      409,
      { carrierId },
    );
  }
  const relation = resolveDeliveryCarrierRecordRelation(carrier, data, { allowArchived });
  if (explicitCounterpartyId && explicitCounterpartyId !== relation.counterpartyId) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.MISMATCH,
      'carrierId и carrierCounterpartyId указывают на разных контрагентов.',
      409,
      {
        carrierId,
        carrierCounterpartyId: explicitCounterpartyId,
        carrierRecordCounterpartyId: relation.counterpartyId,
      },
    );
  }
  return { ...relation, carrier, carrierId };
}

function canonicalizeDeliveryCounterpartyRelations(delivery, data, {
  existing = null,
  allowArchived = false,
  requireActiveObject = false,
  requireActiveCarrier = true,
} = {}) {
  const customer = resolveDeliveryCustomerRelation(delivery, data, {
    allowArchived,
    requireActiveObject,
  });
  const previousCounterpartyId = relationId(existing?.counterpartyId);
  if (previousCounterpartyId && previousCounterpartyId !== customer.counterpartyId) {
    throw counterpartyError(
      'COUNTERPARTY_RELATION_IMMUTABLE',
      'Связь Delivery с customer Counterparty нельзя менять обычным обновлением.',
      409,
      {
        deliveryId: relationId(existing?.id) || null,
        counterpartyId: previousCounterpartyId,
        requestedCounterpartyId: customer.counterpartyId,
      },
    );
  }
  const carrier = resolveDeliveryCarrierRelation(delivery, data, {
    allowArchived,
    requireActiveCarrier,
  });
  const customerLabel = customer.counterparty.shortName
    || customer.counterparty.legalName
    || delivery?.client;
  const next = {
    ...delivery,
    counterpartyId: customer.counterpartyId,
    client: customerLabel,
  };
  if (customer.clientId) next.clientId = customer.clientId;
  else delete next.clientId;
  if (Object.prototype.hasOwnProperty.call(delivery || {}, 'clientName')) {
    next.clientName = customerLabel;
  }
  if (carrier) {
    next.carrierId = carrier.carrierId;
    next.carrierKey = carrier.carrierId;
    next.carrierCounterpartyId = carrier.counterpartyId;
    next.carrierName = carrier.carrier.name || carrier.counterparty.shortName || carrier.counterparty.legalName;
    next.carrierPhone = carrier.carrier.phone || next.carrierPhone || null;
  } else {
    delete next.carrierCounterpartyId;
    delete next.contractorCounterpartyId;
  }
  return next;
}

function duplicateIdCounts(records) {
  const counts = new Map();
  for (const record of Array.isArray(records) ? records : []) {
    const id = relationId(record?.id);
    if (id) counts.set(id, (counts.get(id) || 0) + 1);
  }
  return counts;
}

function classifyError(error) {
  return [
    COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
    COUNTERPARTY_RELATION_CODES.MISMATCH,
    'COUNTERPARTY_RELATION_IMMUTABLE',
  ].includes(error?.code)
    ? DELIVERY_RELATION_CLASSIFICATIONS.CONFLICTING
    : DELIVERY_RELATION_CLASSIFICATIONS.UNRESOLVED;
}

function auditRecord(domain, record, classification, details = {}) {
  return {
    domain,
    recordId: relationId(record?.id) || null,
    counterpartyId: relationId(record?.counterpartyId) || null,
    clientId: relationId(record?.clientId) || null,
    carrierCounterpartyId: relationId(record?.carrierCounterpartyId) || null,
    classification,
    ...details,
  };
}

function auditDomain({ domain, records, data, canonicalize, historical, relationFields }) {
  const counts = duplicateIdCounts(records);
  return records.map(record => {
    const recordId = relationId(record?.id);
    if (!recordId || (counts.get(recordId) || 0) > 1) {
      return auditRecord(domain, record, DELIVERY_RELATION_CLASSIFICATIONS.CONFLICTING, {
        code: COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
        repairability: 'none',
        message: recordId ? `Stable ID ${recordId} неоднозначен.` : 'Запись не содержит stable id.',
        context: { id: recordId || null, matches: counts.get(recordId) || 0 },
      });
    }
    try {
      const next = canonicalize(record, data, {
        allowArchived: historical(record),
        requireActiveObject: !historical(record),
        requireActiveCarrier: !historical(record),
      });
      const changedFields = relationFields.filter(field => (
        relationId(next?.[field]) !== relationId(record?.[field])
      ));
      if (changedFields.length > 0) {
        return auditRecord(domain, record, DELIVERY_RELATION_CLASSIFICATIONS.REPAIRABLE, {
          counterpartyId: relationId(next?.counterpartyId) || null,
          carrierCounterpartyId: relationId(next?.carrierCounterpartyId) || null,
          code: COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
          repairability: 'deterministic_stable_id_chain',
          message: 'Canonical Delivery relation можно заполнить по согласованной stable-ID цепочке.',
          repair: {
            collection: domain,
            fields: Object.fromEntries(changedFields.map(field => [field, next?.[field] || null])),
          },
        });
      }
      return auditRecord(domain, record, DELIVERY_RELATION_CLASSIFICATIONS.VALID, {
        code: null,
        repairability: 'not_needed',
        message: 'Canonical Delivery Counterparty relation согласована.',
      });
    } catch (error) {
      return auditRecord(domain, record, classifyError(error), {
        code: error?.code || COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
        repairability: 'none',
        message: error?.message || 'Delivery Counterparty audit failed.',
        ...(error?.details ? { context: error.details } : {}),
      });
    }
  });
}

function auditDeliveryCounterpartyRelations(data) {
  const carriers = Array.isArray(readCollection(data, 'delivery_carriers'))
    ? readCollection(data, 'delivery_carriers')
    : [];
  const deliveries = Array.isArray(readCollection(data, 'deliveries'))
    ? readCollection(data, 'deliveries')
    : [];
  const entries = [
    ...auditDomain({
      domain: 'delivery_carriers',
      records: carriers,
      data,
      canonicalize: canonicalizeDeliveryCarrierCounterpartyRelation,
      historical: isHistoricalDeliveryCarrierRelation,
      relationFields: ['counterpartyId', 'contractorCounterpartyId'],
    }),
    ...auditDomain({
      domain: 'deliveries',
      records: deliveries,
      data,
      canonicalize: canonicalizeDeliveryCounterpartyRelations,
      historical: isHistoricalDeliveryRelation,
      relationFields: ['counterpartyId', 'clientId', 'carrierCounterpartyId', 'contractorCounterpartyId'],
    }),
  ];
  const classifications = Object.values(DELIVERY_RELATION_CLASSIFICATIONS)
    .reduce((result, classification) => ({ ...result, [classification]: 0 }), {});
  for (const entry of entries) classifications[entry.classification] += 1;
  return {
    ok: classifications.conflicting === 0 && classifications.unresolved === 0,
    authority: 'Counterparty.id',
    roleAuthority: 'counterparty_role_assignments',
    entries,
    summary: {
      classifications,
      scanned: { deliveries: deliveries.length, deliveryCarriers: carriers.length },
    },
  };
}

function repairDeliveryCounterpartyRelations({ readData, writeDataBatch, dryRun = true }) {
  const data = { readData };
  const audit = auditDeliveryCounterpartyRelations(data);
  const blockers = audit.entries.filter(entry => (
    entry.classification === DELIVERY_RELATION_CLASSIFICATIONS.CONFLICTING
    || entry.classification === DELIVERY_RELATION_CLASSIFICATIONS.UNRESOLVED
  ));
  if (!dryRun && blockers.length > 0) {
    throw counterpartyError(
      'DELIVERY_COUNTERPARTY_RELATION_MIGRATION_BLOCKED',
      'Apply заблокирован: найдены conflicting или unresolved Delivery stable relation chains.',
      409,
      { blockers: blockers.map(entry => ({ domain: entry.domain, recordId: entry.recordId, code: entry.code })) },
    );
  }

  const repairsByDomain = new Map();
  for (const entry of audit.entries) {
    if (entry.classification !== DELIVERY_RELATION_CLASSIFICATIONS.REPAIRABLE) continue;
    const repairs = repairsByDomain.get(entry.domain) || new Map();
    repairs.set(entry.recordId, entry.repair.fields);
    repairsByDomain.set(entry.domain, repairs);
  }
  const entries = [];
  for (const domain of ['delivery_carriers', 'deliveries']) {
    const repairs = repairsByDomain.get(domain);
    if (!repairs?.size) continue;
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
    if (typeof writeDataBatch !== 'function') throw new Error('writeDataBatch is required for apply mode');
    writeDataBatch(entries);
  }
  return {
    dryRun,
    changed: entries.length > 0,
    wrote: !dryRun && entries.length > 0,
    changedCollections: entries.map(entry => entry.name),
    changedRecords: audit.summary.classifications.repairable,
    skippedRecords: audit.summary.classifications.unresolved,
    audit,
  };
}

function canonicalizeDeliveryPersistenceEntries(entries, { readData }) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(entry => ({ name: entry?.name, value: entry?.value }));
  const staged = new Map(normalized.map(entry => [entry.name, entry.value]));
  const stagedData = {
    readData(name) {
      return staged.has(name) ? staged.get(name) : (readData(name) || []);
    },
  };
  const carriersEntry = normalized.find(entry => entry.name === 'delivery_carriers');
  if (carriersEntry) {
    const previousById = new Map((readData('delivery_carriers') || [])
      .map(item => [relationId(item?.id), item]));
    carriersEntry.value = (Array.isArray(carriersEntry.value) ? carriersEntry.value : [])
      .map(carrier => canonicalizeDeliveryCarrierCounterpartyRelation(carrier, stagedData, {
        existing: previousById.get(relationId(carrier?.id)) || null,
        allowArchived: isHistoricalDeliveryCarrierRelation(carrier),
      }));
    staged.set('delivery_carriers', carriersEntry.value);
  }
  const deliveriesEntry = normalized.find(entry => entry.name === 'deliveries');
  if (deliveriesEntry) {
    const previousById = new Map((readData('deliveries') || [])
      .map(item => [relationId(item?.id), item]));
    deliveriesEntry.value = (Array.isArray(deliveriesEntry.value) ? deliveriesEntry.value : [])
      .map(delivery => canonicalizeDeliveryCounterpartyRelations(delivery, stagedData, {
        existing: previousById.get(relationId(delivery?.id)) || null,
        allowArchived: isHistoricalDeliveryRelation(delivery),
        requireActiveObject: !isHistoricalDeliveryRelation(delivery),
        requireActiveCarrier: !isHistoricalDeliveryRelation(delivery),
      }));
    staged.set('deliveries', deliveriesEntry.value);
  }
  return normalized;
}

function deliveryCarrierReferenceBlockers(carrier, data) {
  const carrierId = relationId(carrier?.id);
  const counterpartyId = relationId(carrier?.counterpartyId || carrier?.contractorCounterpartyId);
  return readCollection(data, 'deliveries')
    .filter(delivery => (
      (carrierId && relationId(delivery?.carrierId || delivery?.carrierKey) === carrierId)
      || (counterpartyId && relationId(
        delivery?.carrierCounterpartyId || delivery?.contractorCounterpartyId,
      ) === counterpartyId)
    ))
    .map(delivery => ({ collection: 'deliveries', id: relationId(delivery?.id) || null }));
}

module.exports = {
  DELIVERY_RELATION_CLASSIFICATIONS,
  auditDeliveryCounterpartyRelations,
  canonicalizeDeliveryCarrierCounterpartyRelation,
  canonicalizeDeliveryCounterpartyRelations,
  canonicalizeDeliveryPersistenceEntries,
  deliveryCarrierReferenceBlockers,
  isHistoricalDeliveryCarrierRelation,
  isHistoricalDeliveryRelation,
  repairDeliveryCounterpartyRelations,
  resolveDeliveryCarrierRecordRelation,
  resolveDeliveryCarrierRelation,
  resolveDeliveryCustomerRelation,
};
