const {
  COUNTERPARTY_RELATION_CODES,
  assertClientCounterpartyLink,
  resolveCounterpartyById,
} = require('./counterparty-relations');
const { counterpartyError } = require('./counterparty');
const { isStandalonePlannerRow, linkedRentalIds } = require('./gantt-rental-link-guard');

const RENTAL_RELATION_CLASSIFICATIONS = Object.freeze({
  HEALTHY_COUNTERPARTY_ONLY: 'H2',
  HEALTHY_CLIENT_CHAIN: 'H3',
  REPAIRABLE_CLIENT_CHAIN: 'R1',
  MISSING_COUNTERPARTY: 'B1',
  MISSING_CLIENT: 'B2',
  MISSING_DIRECT_COUNTERPARTY: 'B3',
  MISMATCH: 'B4',
  CUSTOMER_ROLE_REQUIRED: 'B5',
  CANONICAL_LINK_MISSING: 'B6',
  AMBIGUOUS: 'B7',
  ARCHIVED: 'B8',
});

const RENTAL_METADATA_FIELDS = Object.freeze([
  'client',
  'clientName',
  'company',
  'companyName',
  'clientInn',
  'customerInn',
  'inn',
  'phone',
  'address',
]);

function relationId(value) {
  return String(value ?? '').trim();
}

function isHistoricalRentalRelation(rental) {
  const status = relationId(rental?.status).toLowerCase();
  return Boolean(rental?.actualReturnDate) || [
    'closed',
    'returned',
    'completed',
    'cancelled',
    'canceled',
  ].includes(status);
}

function readCollection(data, name) {
  if (typeof data === 'function') return data(name) || [];
  if (data && typeof data.readData === 'function') return data.readData(name) || [];
  return data?.[name] || [];
}

function hasCustomerRole(counterparty) {
  return Array.isArray(counterparty?.roles) && counterparty.roles.includes('customer');
}

function requireCustomerCounterparty(counterparty, context = {}) {
  if (!hasCustomerRole(counterparty)) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED,
      'Counterparty арендатора должен иметь роль customer.',
      409,
      {
        ...context,
        counterpartyId: relationId(counterparty?.id) || null,
      },
    );
  }
  return counterparty;
}

/**
 * Rental customer identity boundary.
 *
 * Stable IDs are the only accepted relation inputs. Text snapshots are deliberately
 * ignored: they may be displayed or searched, but cannot establish identity.
 */
function resolveRentalCounterpartyRelation(rental, data, {
  allowArchived = false,
} = {}) {
  const clientId = relationId(rental?.clientId);
  const counterpartyId = relationId(rental?.counterpartyId);

  if (clientId) {
    return assertClientCounterpartyLink(
      { clientId, counterpartyId },
      data,
      { allowArchived, requireCustomerRole: true },
    );
  }

  if (counterpartyId) {
    const counterparty = requireCustomerCounterparty(
      resolveCounterpartyById(counterpartyId, data, { allowArchived }),
      { relation: 'Rental.counterpartyId' },
    );
    return {
      client: null,
      counterparty,
      clientId: null,
      counterpartyId: relationId(counterparty.id),
    };
  }

  const metadataFields = RENTAL_METADATA_FIELDS.filter(field => relationId(rental?.[field]));
  throw counterpartyError(
    COUNTERPARTY_RELATION_CODES.ID_REQUIRED,
    'Для аренды укажите explicit clientId или counterpartyId; display metadata не устанавливает связь.',
    400,
    {
      fields: ['clientId', 'counterpartyId'],
      metadataOnly: metadataFields.length > 0,
      metadataFields,
    },
  );
}

function canonicalizeRentalCounterpartyRelation(rental, data, options = {}) {
  const relation = resolveRentalCounterpartyRelation(rental, data, options);
  return {
    ...rental,
    ...(relation.clientId ? { clientId: relation.clientId } : {}),
    counterpartyId: relation.counterpartyId,
  };
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

function classificationForError(error, rental) {
  if (error?.code === COUNTERPARTY_RELATION_CODES.CLIENT_NOT_FOUND) {
    return RENTAL_RELATION_CLASSIFICATIONS.MISSING_CLIENT;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.COUNTERPARTY_NOT_FOUND) {
    return relationId(rental?.clientId)
      ? RENTAL_RELATION_CLASSIFICATIONS.MISSING_COUNTERPARTY
      : RENTAL_RELATION_CLASSIFICATIONS.MISSING_DIRECT_COUNTERPARTY;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.MISMATCH) {
    return RENTAL_RELATION_CLASSIFICATIONS.MISMATCH;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.CUSTOMER_ROLE_REQUIRED) {
    return RENTAL_RELATION_CLASSIFICATIONS.CUSTOMER_ROLE_REQUIRED;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.COUNTERPARTY_ARCHIVED) {
    return RENTAL_RELATION_CLASSIFICATIONS.ARCHIVED;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.AMBIGUOUS) {
    return RENTAL_RELATION_CLASSIFICATIONS.AMBIGUOUS;
  }
  return RENTAL_RELATION_CLASSIFICATIONS.CANONICAL_LINK_MISSING;
}

function auditIssue(rental, error, classification = classificationForError(error, rental)) {
  return {
    classification,
    domain: 'rentals',
    recordId: relationId(rental?.id) || null,
    clientId: relationId(rental?.clientId) || null,
    counterpartyId: relationId(rental?.counterpartyId) || null,
    code: error?.code || COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
    repairability: 'none',
    message: error?.message || 'Rental relation audit failed.',
    ...(error?.details ? { context: error.details } : {}),
  };
}

function auditRentalCounterpartyRelations(data) {
  const rentals = readCollection(data, 'rentals');
  const list = Array.isArray(rentals) ? rentals : [];
  const rentalIndex = buildIdIndex(list);
  const healthy = [];
  const repairable = [];
  const broken = [];

  for (const rental of list) {
    const recordId = relationId(rental?.id);
    if (!recordId || (rentalIndex.get(recordId) || []).length > 1) {
      broken.push(auditIssue(
        rental,
        counterpartyError(
          COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
          recordId
            ? `Rental stable ID ${recordId} неоднозначен.`
            : 'Rental без stable id нельзя безопасно изменить.',
          409,
          { entity: 'Rental', id: recordId || null, matches: (rentalIndex.get(recordId) || []).length },
        ),
        RENTAL_RELATION_CLASSIFICATIONS.AMBIGUOUS,
      ));
      continue;
    }

    try {
      const relation = resolveRentalCounterpartyRelation(rental, data, {
        allowArchived: isHistoricalRentalRelation(rental),
      });
      const storedCounterpartyId = relationId(rental?.counterpartyId);
      if (!storedCounterpartyId && relation.clientId) {
        repairable.push({
          classification: RENTAL_RELATION_CLASSIFICATIONS.REPAIRABLE_CLIENT_CHAIN,
          domain: 'rentals',
          recordId,
          clientId: relation.clientId,
          counterpartyId: relation.counterpartyId,
          code: COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
          repairability: 'deterministic_id_chain',
          message: 'Rental.counterpartyId можно заполнить только по цепочке Rental.clientId -> Client.counterpartyId.',
          repair: {
            collection: 'rentals',
            field: 'counterpartyId',
            previousValue: null,
            nextValue: relation.counterpartyId,
          },
        });
      } else {
        healthy.push({
          classification: relation.clientId
            ? RENTAL_RELATION_CLASSIFICATIONS.HEALTHY_CLIENT_CHAIN
            : RENTAL_RELATION_CLASSIFICATIONS.HEALTHY_COUNTERPARTY_ONLY,
          domain: 'rentals',
          recordId,
          clientId: relation.clientId,
          counterpartyId: relation.counterpartyId,
          code: null,
          repairability: 'not_needed',
          message: relation.clientId
            ? 'Rental clientId/counterpartyId chain согласована.'
            : 'Rental.counterpartyId однозначно указывает на customer Counterparty.',
        });
      }
    } catch (error) {
      broken.push(auditIssue(rental, error));
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
      scanned: { rentals: list.length },
    },
  };
}

function projectRentalCounterpartyRelations(ganttRentals, rentals, data) {
  const rentalIndex = buildIdIndex(rentals);
  return (Array.isArray(ganttRentals) ? ganttRentals : []).map(ganttRental => {
    if (isStandalonePlannerRow(ganttRental)) return ganttRental;
    const matches = [];
    for (const rentalId of linkedRentalIds(ganttRental)) {
      for (const rental of rentalIndex.get(rentalId) || []) {
        if (!matches.includes(rental)) matches.push(rental);
      }
    }
    if (matches.length === 0) return ganttRental;
    if (matches.length > 1) {
      throw counterpartyError(
        COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
        'Gantt projection ссылается на неоднозначный Classic Rental stable ID.',
        409,
        { ganttRentalId: relationId(ganttRental?.id), matches: matches.length },
      );
    }
    const rental = canonicalizeRentalCounterpartyRelation(matches[0], data, {
      allowArchived: isHistoricalRentalRelation(matches[0]),
    });
    return {
      ...ganttRental,
      counterpartyId: rental.counterpartyId,
      ...(rental.clientId !== undefined ? { clientId: rental.clientId } : {}),
      ...(rental.client !== undefined ? {
        client: rental.client,
        clientShort: String(rental.client || '').substring(0, 20),
      } : {}),
      ...(rental.clientName !== undefined ? { clientName: rental.clientName } : {}),
    };
  });
}

function canonicalizeRentalPersistenceEntries(entries, { readData }) {
  const normalized = (Array.isArray(entries) ? entries : [])
    .map(entry => ({ name: entry?.name, value: entry?.value }));
  const staged = new Map(normalized.map(entry => [entry.name, entry.value]));
  const stagedData = {
    readData(name) {
      return staged.has(name) ? staged.get(name) : (readData(name) || []);
    },
  };

  const rentalsEntry = normalized.find(entry => entry.name === 'rentals');
  if (rentalsEntry) {
    rentalsEntry.value = (Array.isArray(rentalsEntry.value) ? rentalsEntry.value : [])
      .map(rental => canonicalizeRentalCounterpartyRelation(rental, stagedData));
    staged.set('rentals', rentalsEntry.value);
  }

  const ganttEntry = normalized.find(entry => entry.name === 'gantt_rentals');
  if (ganttEntry) {
    ganttEntry.value = projectRentalCounterpartyRelations(
      ganttEntry.value,
      stagedData.readData('rentals'),
      stagedData,
    );
    staged.set('gantt_rentals', ganttEntry.value);
  }
  return normalized;
}

function repairRentalCounterpartyRelations({
  readData,
  writeDataBatch,
  dryRun = true,
}) {
  const audit = auditRentalCounterpartyRelations({ readData });
  const rentals = readCollection({ readData }, 'rentals');
  const repairById = new Map(audit.repairable.map(issue => [issue.recordId, issue]));
  const changed = [];
  const failed = [];
  const nextRentals = (Array.isArray(rentals) ? rentals : []).map(rental => {
    const issue = repairById.get(relationId(rental?.id));
    if (!issue) return rental;
    if (relationId(rental?.counterpartyId) || relationId(rental?.clientId) !== issue.clientId) {
      failed.push(auditIssue(rental, counterpartyError(
        COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
        'Rental изменился после audit; repair пропущен.',
        409,
        { reason: 'audit_precondition_changed' },
      )));
      return rental;
    }
    changed.push({
      classification: issue.classification,
      domain: issue.domain,
      recordId: issue.recordId,
      clientId: issue.clientId,
      counterpartyId: issue.counterpartyId,
      code: issue.code,
      field: 'counterpartyId',
      previousValue: null,
      nextValue: issue.counterpartyId,
      applied: !dryRun,
    });
    return dryRun ? rental : { ...rental, counterpartyId: issue.counterpartyId };
  });

  if (!dryRun && changed.length > 0) {
    if (failed.length > 0 || typeof writeDataBatch !== 'function') {
      if (typeof writeDataBatch !== 'function') {
        failed.push(...changed.map(change => auditIssue(
          { id: change.recordId, clientId: change.clientId },
          counterpartyError(
            COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
            'Actual Rental repair требует writeDataBatch.',
            500,
            { reason: 'writer_missing' },
          ),
        )));
      }
      changed.length = 0;
    } else {
      const changedRentalIds = new Set(changed.map(change => change.recordId));
      const projectionData = {
        readData(name) {
          if (name === 'rentals') return nextRentals;
          return readData(name) || [];
        },
      };
      const ganttRentals = readCollection({ readData }, 'gantt_rentals')
        .map(ganttRental => (
          linkedRentalIds(ganttRental).some(id => changedRentalIds.has(id))
            ? projectRentalCounterpartyRelations([ganttRental], nextRentals, projectionData)[0]
            : ganttRental
        ));
      try {
        writeDataBatch([
          { name: 'rentals', value: nextRentals },
          { name: 'gantt_rentals', value: ganttRentals },
        ]);
      } catch (error) {
        failed.push(...changed.map(change => auditIssue(
          { id: change.recordId, clientId: change.clientId },
          counterpartyError(
            COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
            'Не удалось persist controlled Rental relation repair.',
            500,
            { reason: 'persistence_failed', error: error?.message || String(error) },
          ),
        )));
        changed.length = 0;
      }
    }
  }

  return {
    dryRun: Boolean(dryRun),
    changed,
    skipped: audit.broken,
    failed,
    audit,
    summary: {
      changed: changed.length,
      skipped: audit.broken.length,
      failed: failed.length,
    },
  };
}

module.exports = {
  RENTAL_RELATION_CLASSIFICATIONS,
  auditRentalCounterpartyRelations,
  canonicalizeRentalCounterpartyRelation,
  canonicalizeRentalPersistenceEntries,
  projectRentalCounterpartyRelations,
  repairRentalCounterpartyRelations,
  resolveRentalCounterpartyRelation,
};
