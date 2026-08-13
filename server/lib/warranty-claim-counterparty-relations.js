const crypto = require('crypto');
const {
  COUNTERPARTY_RELATION_CODES,
  assertClientCounterpartyLink,
  resolveCounterpartyById,
} = require('./counterparty-relations');
const { counterpartyError } = require('./counterparty');
const { hasActiveCounterpartyRole } = require('./counterparty-role-profiles');
const { resolveServiceCounterpartyRelation } = require('./service-counterparty-relations');

const WARRANTY_RELATION_CLASSIFICATIONS = Object.freeze({
  ALREADY_CANONICAL: 'already_canonical',
  DETERMINISTIC_REPAIR: 'deterministic_repair',
  INTERNAL_UNLINKED_VALID: 'internal_unlinked_valid',
  CANONICAL_TERMINAL_HISTORY: 'canonical_terminal_history',
  CONFLICTING_STABLE_RELATIONS: 'conflicting_stable_relations',
  AMBIGUOUS_STABLE_ID: 'ambiguous_stable_id',
  MISSING_REFERENCED_ENTITY: 'missing_referenced_entity',
  SOURCE_RELATION_MISSING: 'source_relation_missing',
  MISSING_COUNTERPARTY: 'missing_counterparty',
  ARCHIVED_ACTIVE_TARGET: 'archived_active_target',
  CUSTOMER_ROLE_REQUIRED: 'customer_role_required',
  METADATA_ONLY_UNRESOLVED: 'metadata_only_unresolved',
});

const WARRANTY_RELATION_CODES = Object.freeze({
  CLAIM_ID_REQUIRED: 'WARRANTY_COUNTERPARTY_CLAIM_ID_REQUIRED',
  COLLECTION_INVALID: 'WARRANTY_COUNTERPARTY_COLLECTION_INVALID',
  DUPLICATE_CLAIM_ID: 'WARRANTY_COUNTERPARTY_DUPLICATE_CLAIM_ID',
  IMMUTABLE: 'WARRANTY_COUNTERPARTY_RELATION_IMMUTABLE',
  METADATA_ONLY: 'WARRANTY_COUNTERPARTY_METADATA_ONLY',
  MISSING_CLIENT: 'WARRANTY_COUNTERPARTY_CLIENT_NOT_FOUND',
  MISSING_RENTAL: 'WARRANTY_COUNTERPARTY_RENTAL_NOT_FOUND',
  MISSING_SERVICE: 'WARRANTY_COUNTERPARTY_SERVICE_NOT_FOUND',
  MULTIPLE_BATCH_ENTRIES: 'WARRANTY_COUNTERPARTY_MULTIPLE_BATCH_ENTRIES',
  REPAIR_BLOCKED: 'WARRANTY_COUNTERPARTY_REPAIR_BLOCKED',
  REPAIR_PRECONDITION_CHANGED: 'WARRANTY_COUNTERPARTY_REPAIR_PRECONDITION_CHANGED',
  SOURCE_RELATION_MISSING: 'WARRANTY_COUNTERPARTY_SOURCE_RELATION_MISSING',
});

const WARRANTY_STABLE_RELATION_FIELDS = Object.freeze([
  'counterpartyId',
  'serviceTicketId',
  'clientId',
  'rentalId',
]);

// Factory/manufacturer and equipment fields are intentionally absent. They describe
// factory or equipment context and can never establish Warranty customer identity.
const WARRANTY_CUSTOMER_METADATA_FIELDS = Object.freeze([
  'counterparty',
  'counterpartyName',
  'customer',
  'customerName',
  'customerDisplayName',
  'client',
  'clientName',
  'company',
  'companyName',
  'clientInn',
  'customerInn',
  'customerPhone',
  'clientPhone',
  'customerEmail',
  'clientEmail',
  'customerAddress',
  'clientAddress',
]);

const TERMINAL_WARRANTY_STATUSES = new Set([
  'closed',
  'completed',
  'done',
  'rejected',
  'declined',
]);

function relationId(value) {
  return String(value ?? '').trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function readCollection(data, name) {
  if (typeof data === 'function') return asArray(data(name));
  if (data && typeof data.readData === 'function') return asArray(data.readData(name));
  return asArray(data?.[name]);
}

function isTerminalWarrantyClaim(claim) {
  return TERMINAL_WARRANTY_STATUSES.has(relationId(claim?.status).toLowerCase());
}

function findUniqueById(data, collection, id, relation, missingCode, missingMessage) {
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
  if (matches.length === 0) {
    throw counterpartyError(missingCode, missingMessage, 409, {
      domain: collection,
      relation,
      id: wanted,
    });
  }
  return matches[0];
}

function requireWarrantyCustomerRole(counterparty, data, context, { allowInactiveRole = false } = {}) {
  if (allowInactiveRole) return counterparty;
  if (!hasActiveCounterpartyRole(counterparty, 'customer', data)) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED,
      'Counterparty рекламации должен иметь активное назначение роли customer.',
      409,
      { ...context, counterpartyId: relationId(counterparty?.id) || null },
    );
  }
  return counterparty;
}

function resolveWarrantyTargetCounterparty(counterpartyId, data, options, context) {
  return requireWarrantyCustomerRole(
    resolveCounterpartyById(counterpartyId, data, { allowArchived: options.allowArchived }),
    data,
    context,
    { allowInactiveRole: options.allowInactiveRole },
  );
}

function directCounterpartyCandidate(claim, data, options) {
  const counterpartyId = relationId(claim?.counterpartyId);
  if (!counterpartyId) return null;
  const counterparty = resolveWarrantyTargetCounterparty(
    counterpartyId,
    data,
    options,
    { source: 'counterpartyId' },
  );
  return { source: 'counterpartyId', counterpartyId, counterparty, entity: counterparty };
}

function clientCounterpartyCandidate(claim, data, options) {
  const clientId = relationId(claim?.clientId);
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
        WARRANTY_RELATION_CODES.MISSING_CLIENT,
        'Связанный Client рекламации не найден по stable clientId.',
        409,
        { clientId },
      );
    }
    if (error?.code === COUNTERPARTY_RELATION_CODES.CLIENT_LINK_MISSING) {
      throw counterpartyError(
        WARRANTY_RELATION_CODES.SOURCE_RELATION_MISSING,
        'Связанный Client не содержит canonical counterpartyId.',
        409,
        { source: 'clientId', clientId, sourceField: 'Client.counterpartyId' },
      );
    }
    throw error;
  }
  requireWarrantyCustomerRole(
    relation.counterparty,
    data,
    { source: 'clientId', clientId },
    { allowInactiveRole: options.allowInactiveRole },
  );
  return { ...relation, source: 'clientId', entity: relation.client };
}

function rentalCounterpartyCandidate(claim, data, options) {
  const rentalId = relationId(claim?.rentalId);
  if (!rentalId) return null;
  const matches = [];
  for (const collection of ['rentals', 'gantt_rentals']) {
    for (const record of readCollection(data, collection)) {
      if (relationId(record?.id) === rentalId) matches.push({ collection, record });
    }
  }
  if (matches.length === 0) {
    throw counterpartyError(
      WARRANTY_RELATION_CODES.MISSING_RENTAL,
      'Связанная Rental рекламации не найдена по exact stable rentalId.',
      409,
      { rentalId },
    );
  }
  if (matches.length > 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
      `Stable rentalId ${rentalId} неоднозначен в Rental/Gantt Rental.`,
      409,
      {
        relation: 'WarrantyClaim.rentalId',
        rentalId,
        matches: matches.map(item => ({
          collection: item.collection,
          recordId: relationId(item.record?.id) || null,
        })),
      },
    );
  }
  const [{ collection, record }] = matches;
  const counterpartyId = relationId(record?.counterpartyId);
  if (!counterpartyId) {
    throw counterpartyError(
      WARRANTY_RELATION_CODES.SOURCE_RELATION_MISSING,
      'Связанная Rental не содержит canonical counterpartyId.',
      409,
      { source: 'rentalId', rentalId, collection, sourceField: `${collection}.counterpartyId` },
    );
  }
  const counterparty = resolveWarrantyTargetCounterparty(
    counterpartyId,
    data,
    options,
    { source: 'rentalId', rentalId, collection },
  );
  return { source: 'rentalId', counterpartyId, counterparty, entity: record, collection };
}

function serviceCounterpartyCandidate(claim, data, options) {
  const serviceTicketId = relationId(claim?.serviceTicketId);
  if (!serviceTicketId) return null;
  const ticket = findUniqueById(
    data,
    'service',
    serviceTicketId,
    'WarrantyClaim.serviceTicketId',
    WARRANTY_RELATION_CODES.MISSING_SERVICE,
    'Связанная Service ticket рекламации не найдена по stable serviceTicketId.',
  );
  let relation;
  try {
    relation = resolveServiceCounterpartyRelation(ticket, data, {
      historical: false,
      allowArchived: options.allowArchived,
      allowInactiveRole: options.allowInactiveRole,
    });
  } catch (error) {
    if (error?.code === COUNTERPARTY_RELATION_CODES.AMBIGUOUS) throw error;
    if (error?.code === COUNTERPARTY_RELATION_CODES.COUNTERPARTY_NOT_FOUND) throw error;
    if (error?.code === COUNTERPARTY_RELATION_CODES.COUNTERPARTY_ARCHIVED) throw error;
    if (error?.code === COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED) throw error;
    throw counterpartyError(
      WARRANTY_RELATION_CODES.SOURCE_RELATION_MISSING,
      'Связанная Service ticket не имеет однозначной canonical customer relation.',
      409,
      {
        source: 'serviceTicketId',
        serviceTicketId,
        sourceCode: error?.code || null,
        sourceDetails: error?.details || null,
      },
    );
  }
  if (!relation) {
    return { source: 'serviceTicketId', internal: true, entity: ticket, serviceTicketId };
  }
  if (!relationId(ticket?.counterpartyId)) {
    throw counterpartyError(
      WARRANTY_RELATION_CODES.SOURCE_RELATION_MISSING,
      'Связанная Service ticket не содержит canonical counterpartyId.',
      409,
      {
        source: 'serviceTicketId',
        serviceTicketId,
        sourceField: 'ServiceTicket.counterpartyId',
        resolvedCounterpartyId: relation.counterpartyId,
      },
    );
  }
  return {
    source: 'serviceTicketId',
    counterpartyId: relation.counterpartyId,
    counterparty: relation.counterparty,
    entity: ticket,
    serviceTicketId,
  };
}

function customerMetadataFields(claim) {
  return WARRANTY_CUSTOMER_METADATA_FIELDS.filter(field => relationId(claim?.[field]));
}

function assertCandidatesAgree(candidates, claim) {
  const present = candidates.filter(Boolean);
  const internalService = present.find(candidate => candidate.internal);
  const customerCandidates = present.filter(candidate => !candidate.internal);
  if (internalService && customerCandidates.length > 0) {
    throw counterpartyError(
      WARRANTY_RELATION_CODES.SOURCE_RELATION_MISSING,
      'Internal Service ticket не подтверждает customer relation других Warranty stable chains.',
      409,
      {
        warrantyClaimId: relationId(claim?.id) || null,
        serviceTicketId: internalService.serviceTicketId,
        customerSources: customerCandidates.map(candidate => candidate.source),
      },
    );
  }
  if (customerCandidates.length === 0) return null;
  const counterpartyIds = [...new Set(customerCandidates
    .map(candidate => relationId(candidate.counterpartyId))
    .filter(Boolean))];
  if (counterpartyIds.length !== 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.MISMATCH,
      'Stable Warranty customer relation chains указывают на разных Counterparty.',
      409,
      {
        warrantyClaimId: relationId(claim?.id) || null,
        candidates: customerCandidates.map(candidate => ({
          source: candidate.source,
          counterpartyId: candidate.counterpartyId || null,
        })),
      },
    );
  }
  return {
    ...customerCandidates[0],
    counterpartyId: counterpartyIds[0],
    candidates: customerCandidates,
  };
}

function resolveWarrantyClaimCounterpartyRelation(claim, data, options = {}) {
  const historical = options.historical ?? isTerminalWarrantyClaim(claim);
  const relationOptions = {
    allowArchived: options.allowArchived ?? historical,
    allowInactiveRole: options.allowInactiveRole ?? historical,
  };
  const relation = assertCandidatesAgree([
    directCounterpartyCandidate(claim, data, relationOptions),
    serviceCounterpartyCandidate(claim, data, relationOptions),
    clientCounterpartyCandidate(claim, data, relationOptions),
    rentalCounterpartyCandidate(claim, data, relationOptions),
  ], claim);
  if (relation) return relation;

  const metadataFields = customerMetadataFields(claim);
  if (metadataFields.length > 0) {
    throw counterpartyError(
      WARRANTY_RELATION_CODES.METADATA_ONLY,
      'Customer metadata рекламации не может установить identity без stable customer relation.',
      400,
      {
        metadataOnly: true,
        metadataFields,
        stableFields: [...WARRANTY_STABLE_RELATION_FIELDS],
      },
    );
  }
  return null;
}

function canonicalizeWarrantyClaimCounterpartyRelation(claim, data, options = {}) {
  if (!claim || typeof claim !== 'object' || Array.isArray(claim)) {
    throw counterpartyError('WARRANTY_COUNTERPARTY_RECORD_INVALID', 'Warranty claim должен быть объектом.', 400);
  }
  const existing = options.existing && typeof options.existing === 'object' ? options.existing : null;
  const allowHistoricalTarget = options.allowHistoricalTarget
    ?? (Boolean(existing) && isTerminalWarrantyClaim(existing) && isTerminalWarrantyClaim(claim));
  const relation = resolveWarrantyClaimCounterpartyRelation(claim, data, {
    historical: allowHistoricalTarget && isTerminalWarrantyClaim(claim),
  });

  const establishedCounterpartyId = relationId(existing?.counterpartyId);
  if (establishedCounterpartyId) {
    if (!relationId(claim?.counterpartyId)) {
      throw counterpartyError(
        WARRANTY_RELATION_CODES.IMMUTABLE,
        'Established WarrantyClaim.counterpartyId нельзя удалить обычным обновлением.',
        409,
        {
          warrantyClaimId: relationId(existing?.id) || relationId(claim?.id) || null,
          counterpartyId: establishedCounterpartyId,
          requestedCounterpartyId: null,
        },
      );
    }
    if (!relation || relation.counterpartyId !== establishedCounterpartyId) {
      throw counterpartyError(
        WARRANTY_RELATION_CODES.IMMUTABLE,
        'Established WarrantyClaim.counterpartyId нельзя переназначить обычным обновлением.',
        409,
        {
          warrantyClaimId: relationId(existing?.id) || relationId(claim?.id) || null,
          counterpartyId: establishedCounterpartyId,
          requestedCounterpartyId: relation?.counterpartyId || null,
        },
      );
    }
  }

  const next = { ...claim };
  for (const field of WARRANTY_STABLE_RELATION_FIELDS) {
    if (!relationId(next[field])) delete next[field];
  }
  if (relation) next.counterpartyId = relation.counterpartyId;
  return next;
}

function warrantyClaimIdProblems(claims) {
  const counts = new Map();
  const missingIndexes = [];
  asArray(claims).forEach((claim, index) => {
    const id = relationId(claim?.id);
    if (!id) missingIndexes.push(index);
    else counts.set(id, (counts.get(id) || 0) + 1);
  });
  return {
    missingIndexes,
    duplicateIds: [...counts.entries()]
      .filter(([, count]) => count > 1)
      .map(([id]) => id),
  };
}

function canonicalizeWarrantyClaimCollection(claims, data, options = {}) {
  if (!Array.isArray(claims)) {
    throw counterpartyError(
      WARRANTY_RELATION_CODES.COLLECTION_INVALID,
      'Коллекция warranty_claims должна быть массивом.',
      400,
    );
  }
  const { missingIndexes, duplicateIds } = warrantyClaimIdProblems(claims);
  if (missingIndexes.length > 0) {
    throw counterpartyError(
      WARRANTY_RELATION_CODES.CLAIM_ID_REQUIRED,
      'Каждая Warranty claim должна иметь stable id.',
      409,
      { missingIndexes },
    );
  }
  if (duplicateIds.length > 0) {
    throw counterpartyError(
      WARRANTY_RELATION_CODES.DUPLICATE_CLAIM_ID,
      'Коллекция warranty_claims содержит duplicate stable claim id.',
      409,
      { duplicateIds },
    );
  }
  const previousById = new Map(asArray(options.existingClaims ?? readCollection(data, 'warranty_claims'))
    .map(claim => [relationId(claim?.id), claim]));
  return claims.map(claim => {
    const existing = previousById.get(relationId(claim?.id)) || null;
    return canonicalizeWarrantyClaimCounterpartyRelation(claim, data, {
      existing,
      allowHistoricalTarget: options.allowHistoricalTarget
        ?? (Boolean(existing) && isTerminalWarrantyClaim(existing) && isTerminalWarrantyClaim(claim)),
    });
  });
}

function canonicalizeWarrantyPersistenceEntries(entries, { readData }) {
  const normalized = asArray(entries).map(entry => ({ name: entry?.name, value: entry?.value }));
  if (normalized.filter(entry => entry.name === 'warranty_claims').length > 1) {
    throw counterpartyError(
      WARRANTY_RELATION_CODES.MULTIPLE_BATCH_ENTRIES,
      'Atomic batch не может содержать несколько replacement entries для warranty_claims.',
      409,
    );
  }
  const staged = new Map(normalized.map(entry => [entry.name, entry.value]));
  const stagedData = {
    readData(name) {
      return staged.has(name) ? staged.get(name) : (readData(name) || []);
    },
  };
  const warrantyEntry = normalized.find(entry => entry.name === 'warranty_claims');
  if (warrantyEntry) {
    warrantyEntry.value = canonicalizeWarrantyClaimCollection(warrantyEntry.value, stagedData, {
      existingClaims: readData('warranty_claims') || [],
      // The persistence boundary accepts imported terminal history. The generic API
      // separately rejects creation of new terminal history against an inactive target.
      allowHistoricalTarget: true,
    });
    staged.set('warranty_claims', warrantyEntry.value);
  }
  return normalized;
}

function classificationForError(error) {
  if (error?.code === COUNTERPARTY_RELATION_CODES.MISMATCH) {
    return WARRANTY_RELATION_CLASSIFICATIONS.CONFLICTING_STABLE_RELATIONS;
  }
  if ([COUNTERPARTY_RELATION_CODES.AMBIGUOUS, WARRANTY_RELATION_CODES.DUPLICATE_CLAIM_ID,
    WARRANTY_RELATION_CODES.CLAIM_ID_REQUIRED].includes(error?.code)) {
    return WARRANTY_RELATION_CLASSIFICATIONS.AMBIGUOUS_STABLE_ID;
  }
  if ([WARRANTY_RELATION_CODES.MISSING_SERVICE, WARRANTY_RELATION_CODES.MISSING_CLIENT,
    WARRANTY_RELATION_CODES.MISSING_RENTAL].includes(error?.code)) {
    return WARRANTY_RELATION_CLASSIFICATIONS.MISSING_REFERENCED_ENTITY;
  }
  if (error?.code === WARRANTY_RELATION_CODES.SOURCE_RELATION_MISSING) {
    return WARRANTY_RELATION_CLASSIFICATIONS.SOURCE_RELATION_MISSING;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.COUNTERPARTY_NOT_FOUND) {
    return WARRANTY_RELATION_CLASSIFICATIONS.MISSING_COUNTERPARTY;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.COUNTERPARTY_ARCHIVED) {
    return WARRANTY_RELATION_CLASSIFICATIONS.ARCHIVED_ACTIVE_TARGET;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED) {
    return WARRANTY_RELATION_CLASSIFICATIONS.CUSTOMER_ROLE_REQUIRED;
  }
  if (error?.code === WARRANTY_RELATION_CODES.METADATA_ONLY) {
    return WARRANTY_RELATION_CLASSIFICATIONS.METADATA_ONLY_UNRESOLVED;
  }
  return WARRANTY_RELATION_CLASSIFICATIONS.SOURCE_RELATION_MISSING;
}

function auditEntry(claim, classification, details = {}) {
  return {
    classification,
    domain: 'warranty_claims',
    recordId: relationId(claim?.id) || null,
    counterpartyId: relationId(claim?.counterpartyId) || null,
    serviceTicketId: relationId(claim?.serviceTicketId) || null,
    clientId: relationId(claim?.clientId) || null,
    rentalId: relationId(claim?.rentalId) || null,
    terminal: isTerminalWarrantyClaim(claim),
    ...details,
  };
}

function stableValue(value) {
  if (Array.isArray(value)) return `[${value.map(stableValue).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableValue(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function warrantyRelationStateFingerprint(data) {
  const state = {};
  for (const collection of [
    'warranty_claims',
    'service',
    'clients',
    'rentals',
    'gantt_rentals',
    'counterparties',
    'counterparty_role_assignments',
  ]) {
    state[collection] = readCollection(data, collection);
  }
  return crypto.createHash('sha256').update(stableValue(state)).digest('hex');
}

function auditWarrantyClaimCounterpartyRelations(data) {
  const claims = readCollection(data, 'warranty_claims');
  const { missingIndexes, duplicateIds } = warrantyClaimIdProblems(claims);
  const duplicateSet = new Set(duplicateIds);
  const entries = claims.map((claim, index) => {
    const claimId = relationId(claim?.id);
    if (!claimId || duplicateSet.has(claimId)) {
      return auditEntry(claim, WARRANTY_RELATION_CLASSIFICATIONS.AMBIGUOUS_STABLE_ID, {
        code: claimId ? WARRANTY_RELATION_CODES.DUPLICATE_CLAIM_ID : WARRANTY_RELATION_CODES.CLAIM_ID_REQUIRED,
        repairability: 'none',
        message: claimId
          ? `Warranty claim id ${claimId} неоднозначен.`
          : `Warranty claim at index ${index} не содержит stable id.`,
      });
    }
    try {
      const relation = resolveWarrantyClaimCounterpartyRelation(claim, data, {
        historical: isTerminalWarrantyClaim(claim),
      });
      if (!relation) {
        return auditEntry(claim, WARRANTY_RELATION_CLASSIFICATIONS.INTERNAL_UNLINKED_VALID, {
          code: null,
          repairability: 'not_needed',
          message: 'Internal Warranty claim не содержит customer stable relations или snapshots.',
        });
      }
      if (!relationId(claim?.counterpartyId)) {
        return auditEntry(claim, WARRANTY_RELATION_CLASSIFICATIONS.DETERMINISTIC_REPAIR, {
          counterpartyId: relation.counterpartyId,
          code: COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
          repairability: 'deterministic_stable_id_chain',
          message: 'WarrantyClaim.counterpartyId можно заполнить по согласованной stable-ID цепочке.',
          repair: {
            collection: 'warranty_claims',
            field: 'counterpartyId',
            previousValue: null,
            nextValue: relation.counterpartyId,
          },
        });
      }
      const historicalOnly = isTerminalWarrantyClaim(claim)
        && (Boolean(relation.counterparty?.archivedAt || relation.counterparty?.status === 'archived')
          || !hasActiveCounterpartyRole(relation.counterparty, 'customer', data));
      if (historicalOnly) {
        return auditEntry(claim, WARRANTY_RELATION_CLASSIFICATIONS.CANONICAL_TERMINAL_HISTORY, {
          code: null,
          repairability: 'not_needed',
          message: 'Terminal Warranty history retains a real canonical target with historical role/archive state.',
        });
      }
      return auditEntry(claim, WARRANTY_RELATION_CLASSIFICATIONS.ALREADY_CANONICAL, {
        code: null,
        repairability: 'not_needed',
        message: 'WarrantyClaim.counterpartyId и все supplied stable relation chains согласованы.',
      });
    } catch (error) {
      return auditEntry(claim, classificationForError(error), {
        code: error?.code || 'WARRANTY_COUNTERPARTY_AUDIT_FAILED',
        repairability: 'none',
        message: error?.message || 'Warranty Counterparty relation audit failed.',
        ...(error?.details ? { context: error.details } : {}),
      });
    }
  });
  const classifications = Object.values(WARRANTY_RELATION_CLASSIFICATIONS)
    .reduce((summary, classification) => ({ ...summary, [classification]: 0 }), {});
  for (const entry of entries) classifications[entry.classification] += 1;
  const accepted = new Set([
    WARRANTY_RELATION_CLASSIFICATIONS.ALREADY_CANONICAL,
    WARRANTY_RELATION_CLASSIFICATIONS.DETERMINISTIC_REPAIR,
    WARRANTY_RELATION_CLASSIFICATIONS.INTERNAL_UNLINKED_VALID,
    WARRANTY_RELATION_CLASSIFICATIONS.CANONICAL_TERMINAL_HISTORY,
  ]);
  const broken = entries.filter(entry => !accepted.has(entry.classification));
  return {
    ok: broken.length === 0,
    authority: 'WarrantyClaim.counterpartyId -> Counterparty.id',
    fingerprint: warrantyRelationStateFingerprint(data),
    entries,
    summary: {
      classifications,
      scanned: { warranty_claims: claims.length },
      missingIds: missingIndexes.length,
      duplicateIds: duplicateIds.length,
      broken: broken.length,
      repairable: classifications[WARRANTY_RELATION_CLASSIFICATIONS.DETERMINISTIC_REPAIR] || 0,
    },
  };
}

function repairWarrantyClaimCounterpartyRelations({
  readData,
  writeDataBatch,
  dryRun = true,
  expectedFingerprint = null,
}) {
  const audit = auditWarrantyClaimCounterpartyRelations({ readData });
  if (expectedFingerprint && audit.fingerprint !== expectedFingerprint) {
    throw counterpartyError(
      WARRANTY_RELATION_CODES.REPAIR_PRECONDITION_CHANGED,
      'Warranty relation state изменился после dry-run; apply остановлен.',
      409,
      { expectedFingerprint, actualFingerprint: audit.fingerprint },
    );
  }
  const repairs = new Map(audit.entries
    .filter(entry => entry.classification === WARRANTY_RELATION_CLASSIFICATIONS.DETERMINISTIC_REPAIR)
    .map(entry => [entry.recordId, entry.counterpartyId]));
  const invalid = audit.entries.filter(entry => ![
    WARRANTY_RELATION_CLASSIFICATIONS.ALREADY_CANONICAL,
    WARRANTY_RELATION_CLASSIFICATIONS.DETERMINISTIC_REPAIR,
    WARRANTY_RELATION_CLASSIFICATIONS.INTERNAL_UNLINKED_VALID,
    WARRANTY_RELATION_CLASSIFICATIONS.CANONICAL_TERMINAL_HISTORY,
  ].includes(entry.classification));
  if (!dryRun && invalid.length > 0) {
    throw counterpartyError(
      WARRANTY_RELATION_CODES.REPAIR_BLOCKED,
      'Warranty repair остановлен: коллекция содержит conflicting, ambiguous или unresolved relations.',
      409,
      { invalidRecords: invalid.map(entry => ({ id: entry.recordId, classification: entry.classification })) },
    );
  }
  const current = readData('warranty_claims') || [];
  const next = current.map(claim => {
    const counterpartyId = repairs.get(relationId(claim?.id));
    return counterpartyId ? { ...claim, counterpartyId } : claim;
  });
  if (!dryRun && repairs.size > 0) {
    if (typeof writeDataBatch !== 'function') {
      throw new Error('writeDataBatch is required for Warranty apply mode');
    }
    writeDataBatch([{ name: 'warranty_claims', value: next }]);
  }
  return {
    dryRun: Boolean(dryRun),
    changed: repairs.size > 0,
    wrote: !dryRun && repairs.size > 0,
    changedRecords: repairs.size,
    unresolvedRecords: invalid.length,
    audit,
  };
}

function activeWarrantyCounterpartyReferences(counterpartyId, data) {
  const id = relationId(counterpartyId);
  if (!id) return [];
  return readCollection(data, 'warranty_claims')
    .filter(claim => !isTerminalWarrantyClaim(claim))
    .filter(claim => {
      if (relationId(claim?.counterpartyId) === id) return true;
      try {
        return resolveWarrantyClaimCounterpartyRelation(claim, data, {
          historical: false,
          allowArchived: true,
          allowInactiveRole: true,
        })?.counterpartyId === id;
      } catch {
        return false;
      }
    });
}

function warrantyCounterpartyReferenceBlockers(counterpartyId, data) {
  const records = activeWarrantyCounterpartyReferences(counterpartyId, data);
  if (records.length === 0) return [];
  return [{
    collection: 'warranty_claims',
    recordIds: records.map(claim => relationId(claim?.id)).filter(Boolean),
    count: records.length,
    relationFields: [...WARRANTY_STABLE_RELATION_FIELDS],
  }];
}

function decorateWarrantyClaimCounterparty(claim, data) {
  const counterpartyId = relationId(claim?.counterpartyId);
  if (!counterpartyId) return claim;
  const matches = readCollection(data, 'counterparties')
    .filter(item => relationId(item?.id) === counterpartyId);
  if (matches.length !== 1) return claim;
  const counterparty = matches[0];
  const displayName = relationId(counterparty?.shortName || counterparty?.legalName);
  return {
    ...claim,
    counterpartyId,
    counterpartyName: displayName,
    customerDisplayName: displayName,
    ...(displayName ? { client: displayName, clientName: displayName } : {}),
  };
}

module.exports = {
  TERMINAL_WARRANTY_STATUSES,
  WARRANTY_CUSTOMER_METADATA_FIELDS,
  WARRANTY_RELATION_CLASSIFICATIONS,
  WARRANTY_RELATION_CODES,
  WARRANTY_STABLE_RELATION_FIELDS,
  activeWarrantyCounterpartyReferences,
  auditWarrantyClaimCounterpartyRelations,
  canonicalizeWarrantyClaimCollection,
  canonicalizeWarrantyClaimCounterpartyRelation,
  canonicalizeWarrantyPersistenceEntries,
  decorateWarrantyClaimCounterparty,
  isTerminalWarrantyClaim,
  repairWarrantyClaimCounterpartyRelations,
  resolveWarrantyClaimCounterpartyRelation,
  warrantyCounterpartyReferenceBlockers,
  warrantyRelationStateFingerprint,
};
