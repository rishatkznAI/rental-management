const {
  COUNTERPARTY_RELATION_CODES,
  assertClientCounterpartyLink,
  resolveCounterpartyById,
} = require('./counterparty-relations');
const { counterpartyError } = require('./counterparty');
const { resolveRentalCounterpartyRelation } = require('./rental-counterparty-relations');

const PAYMENT_RELATION_CLASSIFICATIONS = Object.freeze({
  VALID_COUNTERPARTY: 'valid_counterparty',
  REPAIRABLE_FROM_CLIENT: 'repairable_from_client',
  MISMATCH: 'mismatch',
  MISSING_CLIENT: 'missing_client',
  MISSING_COUNTERPARTY: 'missing_counterparty',
  CLIENT_MISSING_COUNTERPARTY: 'client_missing_counterparty',
  METADATA_ONLY: 'metadata_only',
  DUPLICATE_STABLE_ID: 'duplicate_stable_id',
  ARCHIVED_COUNTERPARTY: 'archived_counterparty',
});

const PAYMENT_METADATA_FIELDS = Object.freeze([
  'client',
  'clientName',
  'company',
  'companyName',
  'counterparty',
  'counterpartyName',
  'clientInn',
  'customerInn',
  'companyInn',
  'inn',
  'phone',
  'address',
]);

function relationId(value) {
  return String(value ?? '').trim();
}

function readCollection(data, name) {
  if (typeof data === 'function') return data(name) || [];
  if (data && typeof data.readData === 'function') return data.readData(name) || [];
  return data?.[name] || [];
}

function paymentMetadataFields(payment) {
  return PAYMENT_METADATA_FIELDS.filter(field => relationId(payment?.[field]));
}

function paymentRentalId(payment) {
  return relationId(payment?.rentalId || payment?.ganttRentalId || payment?.classicRentalId);
}

function rentalReferenceIds(rental) {
  return [
    rental?.id,
    rental?.rentalId,
    rental?.sourceRentalId,
    rental?.originalRentalId,
  ].map(relationId).filter(Boolean);
}

function resolveRentalForPayment(payment, data) {
  const rentalId = paymentRentalId(payment);
  if (!rentalId) return null;
  const domains = [
    ['rentals', readCollection(data, 'rentals')],
    ['gantt_rentals', readCollection(data, 'gantt_rentals')],
  ];
  for (const [domain, rentals] of domains) {
    const exact = rentals.filter(item => relationId(item?.id) === rentalId);
    if (exact.length > 1) {
      throw counterpartyError(
        COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
        `Stable Rental ID ${rentalId} неоднозначен в ${domain}.`,
        409,
        { domain, relation: 'Payment.rentalId', id: rentalId, matches: exact.length },
      );
    }
    if (exact.length === 1) return exact[0];
  }
  for (const [domain, rentals] of domains) {
    const aliases = rentals.filter(item => rentalReferenceIds(item).includes(rentalId));
    if (aliases.length > 1) {
      throw counterpartyError(
        COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
        `Rental reference ${rentalId} неоднозначен в ${domain}.`,
        409,
        { domain, relation: 'Payment.rentalId', id: rentalId, matches: aliases.length },
      );
    }
    if (aliases.length === 1) return aliases[0];
  }
  return null;
}

function resolvePaymentFromRental(payment, rental, data, { allowArchived = false } = {}) {
  const rentalCounterpartyId = relationId(rental?.counterpartyId);
  if (!rentalCounterpartyId) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
      'Rental.counterpartyId обязателен для создания связанного платежа.',
      409,
      { rentalId: relationId(rental?.id) || paymentRentalId(payment), field: 'rental.counterpartyId' },
    );
  }
  const counterparty = resolveCounterpartyById(rentalCounterpartyId, data, { allowArchived });
  const rentalClientId = relationId(rental?.clientId);
  const paymentClientId = relationId(payment?.clientId);
  const paymentCounterpartyId = relationId(payment?.counterpartyId);

  if (paymentCounterpartyId && paymentCounterpartyId !== rentalCounterpartyId) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.MISMATCH,
      'Payment.counterpartyId не совпадает с authoritative Rental.counterpartyId.',
      409,
      {
        rentalId: relationId(rental?.id) || paymentRentalId(payment),
        rentalCounterpartyId,
        counterpartyId: paymentCounterpartyId,
      },
    );
  }
  if (paymentClientId && paymentClientId !== rentalClientId) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.MISMATCH,
      'Payment.clientId не совпадает с compatibility Rental.clientId.',
      409,
      {
        rentalId: relationId(rental?.id) || paymentRentalId(payment),
        rentalClientId: rentalClientId || null,
        clientId: paymentClientId,
      },
    );
  }

  let client = null;
  if (rentalClientId) {
    const resolved = assertClientCounterpartyLink(
      { clientId: rentalClientId, counterpartyId: rentalCounterpartyId },
      data,
      { allowArchived, requireCustomerRole: false },
    );
    client = resolved.client;
  }
  return {
    source: 'rental',
    rental,
    client,
    counterparty,
    clientId: rentalClientId || null,
    counterpartyId: rentalCounterpartyId,
  };
}

/**
 * Canonical Payment identity boundary.
 *
 * Only stable IDs establish a relation. Display names, INN, phone, address and other
 * snapshots are deliberately ignored. Counterparty roles are not restricted here:
 * supplier-only and contractor-only Counterparties are valid Payment targets.
 */
function resolvePaymentCounterpartyRelation(payment, data, {
  allowArchived = false,
  useRentalAuthority = true,
} = {}) {
  const rental = useRentalAuthority ? resolveRentalForPayment(payment, data) : null;
  if (rental) return resolvePaymentFromRental(payment, rental, data, { allowArchived });

  const clientId = relationId(payment?.clientId);
  const counterpartyId = relationId(payment?.counterpartyId);
  if (clientId) {
    const resolved = assertClientCounterpartyLink(
      { clientId, counterpartyId },
      data,
      { allowArchived, requireCustomerRole: false },
    );
    return { ...resolved, source: counterpartyId ? 'matching_ids' : 'client' };
  }
  if (counterpartyId) {
    const counterparty = resolveCounterpartyById(counterpartyId, data, { allowArchived });
    return {
      source: 'counterparty',
      client: null,
      counterparty,
      clientId: null,
      counterpartyId: relationId(counterparty.id),
    };
  }

  const metadataFields = paymentMetadataFields(payment);
  throw counterpartyError(
    COUNTERPARTY_RELATION_CODES.ID_REQUIRED,
    'Для платежа укажите explicit counterpartyId или legacy clientId; display metadata не устанавливает связь.',
    400,
    {
      fields: ['counterpartyId', 'clientId'],
      metadataOnly: metadataFields.length > 0,
      metadataFields,
    },
  );
}

/**
 * Rental allocations are valid only inside one canonical Counterparty boundary.
 * Both identities are resolved by their domain authorities; display metadata is
 * never considered and any unresolved or internally inconsistent relation fails.
 */
function assertPaymentRentalCounterpartyMatch(payment, rental, data, {
  allowArchived = false,
  paymentRelation = null,
} = {}) {
  const resolvedPayment = paymentRelation || resolvePaymentCounterpartyRelation(payment, data, {
    allowArchived,
  });
  const resolvedRental = resolveRentalCounterpartyRelation(rental, data, {
    allowArchived,
  });
  if (resolvedPayment.counterpartyId !== resolvedRental.counterpartyId) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.MISMATCH,
      'Payment and Rental belong to different counterparties.',
      409,
    );
  }
  return {
    counterpartyId: resolvedPayment.counterpartyId,
    payment: resolvedPayment,
    rental: resolvedRental,
  };
}

function isEffectivePaymentAllocation(allocation) {
  return relationId(allocation?.status).toLowerCase() !== 'cancelled';
}

const PAYMENT_ALLOCATION_IDENTITY_FIELDS = Object.freeze([
  'id',
  'clientId',
  'counterpartyId',
  'rentalId',
  'ganttRentalId',
  'classicRentalId',
]);

const RENTAL_ALLOCATION_IDENTITY_FIELDS = Object.freeze([
  'id',
  'clientId',
  'counterpartyId',
  'rentalId',
  'sourceRentalId',
  'originalRentalId',
]);

function identitySignatures(list, fields, domain = '') {
  return (Array.isArray(list) ? list : [])
    .map(record => JSON.stringify([
      domain,
      ...fields.map(field => record?.[field] ?? null),
    ]))
    .sort();
}

function allocationRentalCandidates(state, referenceIds) {
  const ids = new Set([...referenceIds].map(relationId).filter(Boolean));
  const matches = (name, list) => (Array.isArray(list) ? list : [])
    .filter(rental => rentalReferenceIds(rental).some(id => ids.has(id)))
    .map(rental => ({ name, rental }));
  return [
    ...matches('rentals', state.rentals),
    ...matches('gantt_rentals', state.gantt_rentals),
  ];
}

/**
 * Captures every authoritative input that can change resolution of an existing
 * allocation. Missing-id Rental rows are deliberately retained because their
 * stable aliases can turn a unique legacy reference into an ambiguous one.
 */
function allocationResolutionInputs(allocation, state) {
  const paymentId = relationId(allocation?.paymentId);
  const payments = (Array.isArray(state.payments) ? state.payments : [])
    .filter(payment => relationId(payment?.id) === paymentId);
  const rentalReferenceId = relationId(allocation?.rentalId);
  const rentalReferenceIds = new Set([
    rentalReferenceId,
    ...payments.map(paymentRentalId),
  ].filter(Boolean));
  const rentalCandidates = allocationRentalCandidates(state, rentalReferenceIds);
  const endpoints = [
    ...payments,
    ...rentalCandidates.map(candidate => candidate.rental),
  ];
  const clientIds = new Set(endpoints.map(item => relationId(item?.clientId)).filter(Boolean));
  const clients = readCollection(state, 'clients')
    .filter(client => clientIds.has(relationId(client?.id)));
  const counterpartyIds = new Set([
    ...endpoints.map(item => relationId(item?.counterpartyId)),
    ...clients.map(client => relationId(client?.counterpartyId)),
  ].filter(Boolean));
  const counterparties = readCollection(state, 'counterparties')
    .filter(counterparty => counterpartyIds.has(relationId(counterparty?.id)));
  const assignments = readCollection(state, 'counterparty_role_assignments')
    .filter(assignment => counterpartyIds.has(relationId(assignment?.counterpartyId)));

  return {
    payments: identitySignatures(payments, PAYMENT_ALLOCATION_IDENTITY_FIELDS),
    rentals: rentalCandidates
      .map(({ name, rental }) => JSON.stringify([
        name,
        ...RENTAL_ALLOCATION_IDENTITY_FIELDS.map(field => rental?.[field] ?? null),
      ]))
      .sort(),
    clients: identitySignatures(clients, ['id', 'counterpartyId']),
    counterparties: identitySignatures(counterparties, ['id', 'status', 'archivedAt', 'roles']),
    counterpartyRoleAssignments: identitySignatures(assignments, [
      'id',
      'counterpartyId',
      'roleCode',
      'status',
      'validFrom',
      'validTo',
    ]),
  };
}

function findUniquePaymentEndpoint(payments, paymentId, allocation) {
  const id = relationId(paymentId);
  if (!id) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.ID_REQUIRED,
      'PaymentAllocation.paymentId обязателен.',
      409,
      { allocationId: relationId(allocation?.id) || null, endpoint: 'Payment', field: 'paymentId' },
    );
  }
  const matches = (Array.isArray(payments) ? payments : [])
    .filter(payment => relationId(payment?.id) === id);
  if (matches.length > 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
      `PaymentAllocation ссылается на неоднозначный Payment ${id}.`,
      409,
      { allocationId: relationId(allocation?.id) || null, endpoint: 'Payment', id, matches: matches.length },
    );
  }
  if (matches.length === 0) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.ENDPOINT_NOT_FOUND,
      `PaymentAllocation ссылается на отсутствующий Payment ${id}.`,
      409,
      { allocationId: relationId(allocation?.id) || null, endpoint: 'Payment', id },
    );
  }
  return matches[0];
}

function findUniqueRentalEndpoint(rentals, ganttRentals, rentalId, allocation) {
  const id = relationId(rentalId);
  if (!id) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.ID_REQUIRED,
      'PaymentAllocation.rentalId обязателен.',
      409,
      { allocationId: relationId(allocation?.id) || null, endpoint: 'Rental', field: 'rentalId' },
    );
  }
  const domains = [
    ['rentals', Array.isArray(rentals) ? rentals : []],
    ['gantt_rentals', Array.isArray(ganttRentals) ? ganttRentals : []],
  ];
  const exact = domains.flatMap(([domain, list]) => list
    .filter(rental => relationId(rental?.id) === id)
    .map(rental => ({ domain, rental })));
  if (exact.length > 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
      `PaymentAllocation ссылается на неоднозначный Rental ${id}.`,
      409,
      { allocationId: relationId(allocation?.id) || null, endpoint: 'Rental', id, matches: exact.length },
    );
  }
  if (exact.length === 1) return exact[0].rental;

  const aliases = domains.flatMap(([domain, list]) => list
    .filter(rental => rentalReferenceIds(rental).includes(id))
    .map(rental => ({ domain, rental })));
  if (aliases.length > 1) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
      `PaymentAllocation ссылается на неоднозначный Rental reference ${id}.`,
      409,
      { allocationId: relationId(allocation?.id) || null, endpoint: 'Rental', id, matches: aliases.length },
    );
  }
  if (aliases.length === 0) {
    throw counterpartyError(
      COUNTERPARTY_RELATION_CODES.ENDPOINT_NOT_FOUND,
      `PaymentAllocation ссылается на отсутствующий Rental ${id}.`,
      409,
      { allocationId: relationId(allocation?.id) || null, endpoint: 'Rental', id },
    );
  }
  return aliases[0].rental;
}

function assertAllocationCanonicalInState(allocation, state, phase) {
  try {
    const payment = findUniquePaymentEndpoint(state.payments, allocation?.paymentId, allocation);
    const rental = findUniqueRentalEndpoint(
      state.rentals,
      state.gantt_rentals,
      allocation?.rentalId,
      allocation,
    );
    return assertPaymentRentalCounterpartyMatch(payment, rental, state, { allowArchived: true });
  } catch (error) {
    error.details = {
      ...(error?.details || {}),
      allocationId: relationId(allocation?.id) || null,
      paymentId: relationId(allocation?.paymentId) || null,
      rentalId: relationId(allocation?.rentalId) || null,
      phase,
    };
    throw error;
  }
}

function allocationState(data, overrides) {
  return {
    ...overrides,
    readData(name) {
      if (Object.prototype.hasOwnProperty.call(overrides, name)) return overrides[name];
      return readCollection(data, name);
    },
  };
}

function captureAllocationResolution(allocation, state, phase) {
  const inputs = allocationResolutionInputs(allocation, state);
  try {
    const relation = assertAllocationCanonicalInState(allocation, state, phase);
    return {
      inputs,
      outcome: {
        status: 'valid',
        counterpartyId: relation.counterpartyId,
        payment: {
          source: relation.payment?.source || null,
          clientId: relation.payment?.clientId || null,
          counterpartyId: relation.payment?.counterpartyId || null,
        },
        rental: {
          clientId: relation.rental?.clientId || null,
          counterpartyId: relation.rental?.counterpartyId || null,
        },
      },
    };
  } catch (error) {
    const details = { ...(error?.details || {}) };
    delete details.phase;
    return {
      inputs,
      outcome: {
        status: 'error',
        code: error?.code || null,
        details,
      },
    };
  }
}

/**
 * Prevents a persisted allocation from becoming cross-Counterparty, unresolved,
 * ambiguous or orphaned when either endpoint or one of its authoritative
 * identity dependencies is replaced. Display snapshots are never inspected.
 */
function assertExistingPaymentAllocationsRemainCanonical({
  currentPayments = [],
  nextPayments = currentPayments,
  currentRentals = [],
  nextRentals = currentRentals,
  currentGanttRentals = [],
  nextGanttRentals = currentGanttRentals,
  currentData = {},
  nextData = currentData,
  currentClients = readCollection(currentData, 'clients'),
  nextClients = readCollection(nextData, 'clients'),
  currentCounterparties = readCollection(currentData, 'counterparties'),
  nextCounterparties = readCollection(nextData, 'counterparties'),
  currentCounterpartyRoleAssignments = readCollection(currentData, 'counterparty_role_assignments'),
  nextCounterpartyRoleAssignments = readCollection(nextData, 'counterparty_role_assignments'),
  allocations = [],
} = {}) {
  const currentState = allocationState(currentData, {
    payments: currentPayments,
    rentals: currentRentals,
    gantt_rentals: currentGanttRentals,
    clients: currentClients,
    counterparties: currentCounterparties,
    counterparty_role_assignments: currentCounterpartyRoleAssignments,
  });
  const nextState = allocationState(nextData, {
    payments: nextPayments,
    rentals: nextRentals,
    gantt_rentals: nextGanttRentals,
    clients: nextClients,
    counterparties: nextCounterparties,
    counterparty_role_assignments: nextCounterpartyRoleAssignments,
  });
  let checked = 0;
  const affectedPaymentIds = new Set();
  const affectedRentalIds = new Set();
  for (const allocation of Array.isArray(allocations) ? allocations : []) {
    if (!isEffectivePaymentAllocation(allocation)) continue;
    const currentResolution = captureAllocationResolution(allocation, currentState, 'current');
    const nextResolution = captureAllocationResolution(allocation, nextState, 'next');
    if (JSON.stringify(currentResolution) === JSON.stringify(nextResolution)) continue;
    const paymentId = relationId(allocation?.paymentId);
    const rentalId = relationId(allocation?.rentalId);
    if (paymentId) affectedPaymentIds.add(paymentId);
    if (rentalId) affectedRentalIds.add(rentalId);
    // An already-invalid relation must not be silently repaired or worsened by an
    // affected endpoint mutation. It requires a separate controlled workflow.
    assertAllocationCanonicalInState(allocation, currentState, 'current');
    assertAllocationCanonicalInState(allocation, nextState, 'next');
    checked += 1;
  }
  return {
    checked,
    affectedPaymentIds: [...affectedPaymentIds],
    affectedRentalIds: [...affectedRentalIds],
  };
}

function assertPaymentAllocationPersistenceEntriesSafe(entries, { readData }) {
  const list = (Array.isArray(entries) ? entries : [])
    .filter(entry => entry && typeof entry.name === 'string');
  const staged = new Map(list.map(entry => [entry.name, entry.value]));
  if (![
    'payments',
    'rentals',
    'gantt_rentals',
    'clients',
    'counterparties',
    'counterparty_role_assignments',
  ].some(name => staged.has(name))) {
    return { checked: 0, affectedPaymentIds: [], affectedRentalIds: [] };
  }
  const current = name => readData(name) || [];
  const next = name => staged.has(name) ? (staged.get(name) || []) : current(name);
  const currentData = { readData: current };
  const nextData = { readData: next };
  return assertExistingPaymentAllocationsRemainCanonical({
    currentPayments: current('payments'),
    nextPayments: next('payments'),
    currentRentals: current('rentals'),
    nextRentals: next('rentals'),
    currentGanttRentals: current('gantt_rentals'),
    nextGanttRentals: next('gantt_rentals'),
    currentClients: current('clients'),
    nextClients: next('clients'),
    currentCounterparties: current('counterparties'),
    nextCounterparties: next('counterparties'),
    currentCounterpartyRoleAssignments: current('counterparty_role_assignments'),
    nextCounterpartyRoleAssignments: next('counterparty_role_assignments'),
    allocations: current('payment_allocations'),
    currentData,
    nextData,
  });
}

function canonicalizePaymentCounterpartyRelation(payment, data, options = {}) {
  const relation = resolvePaymentCounterpartyRelation(payment, data, options);
  const next = {
    ...payment,
    counterpartyId: relation.counterpartyId,
  };
  if (relation.clientId) next.clientId = relation.clientId;
  else delete next.clientId;
  if (relation.source === 'rental') {
    if (!relationId(next.client) && relationId(relation.rental?.client)) next.client = relation.rental.client;
    if (!relationId(next.clientName) && relationId(relation.rental?.clientName || relation.rental?.client)) {
      next.clientName = relation.rental.clientName || relation.rental.client;
    }
  }
  return next;
}

function counterpartySummary(counterparty) {
  if (!counterparty) return null;
  return {
    id: relationId(counterparty.id),
    legalName: relationId(counterparty.legalName),
    shortName: relationId(counterparty.shortName),
    roles: Array.isArray(counterparty.roles) ? [...counterparty.roles] : [],
    status: relationId(counterparty.status) || 'active',
    inn: relationId(counterparty.inn) || null,
    phone: relationId(counterparty.phone) || null,
  };
}

function decoratePaymentCounterparty(payment, data) {
  try {
    const relation = resolvePaymentCounterpartyRelation(payment, data, {
      allowArchived: true,
      useRentalAuthority: false,
    });
    return {
      ...payment,
      counterpartyId: relation.counterpartyId,
      ...(relation.clientId ? { clientId: relation.clientId } : {}),
      counterparty: counterpartySummary(relation.counterparty),
    };
  } catch (error) {
    return {
      ...payment,
      counterpartyId: relationId(payment?.counterpartyId) || null,
      counterparty: null,
      counterpartyRelationError: {
        code: error?.code || COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
        message: error?.message || 'Payment Counterparty relation is invalid.',
      },
    };
  }
}

function classificationForError(error) {
  if (error?.code === COUNTERPARTY_RELATION_CODES.AMBIGUOUS) {
    return PAYMENT_RELATION_CLASSIFICATIONS.DUPLICATE_STABLE_ID;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.CLIENT_NOT_FOUND) {
    return PAYMENT_RELATION_CLASSIFICATIONS.MISSING_CLIENT;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.COUNTERPARTY_NOT_FOUND) {
    return PAYMENT_RELATION_CLASSIFICATIONS.MISSING_COUNTERPARTY;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.CLIENT_LINK_MISSING) {
    return PAYMENT_RELATION_CLASSIFICATIONS.CLIENT_MISSING_COUNTERPARTY;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.MISMATCH) {
    return PAYMENT_RELATION_CLASSIFICATIONS.MISMATCH;
  }
  if (error?.code === COUNTERPARTY_RELATION_CODES.COUNTERPARTY_ARCHIVED) {
    return PAYMENT_RELATION_CLASSIFICATIONS.ARCHIVED_COUNTERPARTY;
  }
  return PAYMENT_RELATION_CLASSIFICATIONS.METADATA_ONLY;
}

function auditIssue(payment, error, classification = classificationForError(error)) {
  return {
    classification,
    domain: 'payments',
    recordId: relationId(payment?.id) || null,
    clientId: relationId(payment?.clientId) || null,
    counterpartyId: relationId(payment?.counterpartyId) || null,
    code: error?.code || COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
    repairability: 'none',
    message: error?.message || 'Payment relation audit failed.',
    ...(error?.details ? { context: error.details } : {}),
  };
}

function classificationCounts(entries) {
  const counts = Object.values(PAYMENT_RELATION_CLASSIFICATIONS)
    .reduce((result, key) => ({ ...result, [key]: 0 }), {});
  for (const entry of entries) counts[entry.classification] = (counts[entry.classification] || 0) + 1;
  return counts;
}

function auditPaymentCounterpartyRelations(data) {
  const payments = readCollection(data, 'payments');
  const paymentIds = new Map();
  for (const payment of payments) {
    const id = relationId(payment?.id);
    if (!id) continue;
    paymentIds.set(id, (paymentIds.get(id) || 0) + 1);
  }
  const entries = [];
  for (const payment of payments) {
    const recordId = relationId(payment?.id);
    if (!recordId || (paymentIds.get(recordId) || 0) > 1) {
      entries.push(auditIssue(
        payment,
        counterpartyError(
          COUNTERPARTY_RELATION_CODES.AMBIGUOUS,
          recordId ? `Payment stable ID ${recordId} неоднозначен.` : 'Payment без stable id нельзя безопасно изменить.',
          409,
          { entity: 'Payment', id: recordId || null, matches: paymentIds.get(recordId) || 0 },
        ),
        PAYMENT_RELATION_CLASSIFICATIONS.DUPLICATE_STABLE_ID,
      ));
      continue;
    }

    const storedCounterpartyId = relationId(payment?.counterpartyId);
    try {
      const relation = resolvePaymentCounterpartyRelation(payment, data, {
        allowArchived: true,
        useRentalAuthority: false,
      });
      if (!storedCounterpartyId && relation.clientId) {
        entries.push({
          classification: PAYMENT_RELATION_CLASSIFICATIONS.REPAIRABLE_FROM_CLIENT,
          domain: 'payments',
          recordId,
          clientId: relation.clientId,
          counterpartyId: relation.counterpartyId,
          code: COUNTERPARTY_RELATION_CODES.CANONICAL_ID_MISSING,
          repairability: 'deterministic_id_chain',
          message: 'Payment.counterpartyId можно заполнить только по цепочке Payment.clientId -> Client.counterpartyId.',
          repair: {
            collection: 'payments',
            field: 'counterpartyId',
            previousValue: null,
            nextValue: relation.counterpartyId,
          },
        });
      } else {
        entries.push({
          classification: PAYMENT_RELATION_CLASSIFICATIONS.VALID_COUNTERPARTY,
          domain: 'payments',
          recordId,
          clientId: relation.clientId,
          counterpartyId: relation.counterpartyId,
          code: null,
          repairability: 'not_needed',
          message: relation.clientId
            ? 'Payment clientId/counterpartyId chain согласована.'
            : 'Payment.counterpartyId однозначно указывает на Counterparty.',
        });
      }
    } catch (error) {
      entries.push(auditIssue(payment, error));
    }
  }
  const healthy = entries.filter(entry => entry.classification === PAYMENT_RELATION_CLASSIFICATIONS.VALID_COUNTERPARTY);
  const repairable = entries.filter(entry => entry.classification === PAYMENT_RELATION_CLASSIFICATIONS.REPAIRABLE_FROM_CLIENT);
  const broken = entries.filter(entry => !healthy.includes(entry) && !repairable.includes(entry));
  return {
    entries,
    healthy,
    repairable,
    broken,
    summary: {
      total: entries.length,
      healthy: healthy.length,
      repairable: repairable.length,
      broken: broken.length,
      classifications: classificationCounts(entries),
    },
  };
}

function repairPaymentCounterpartyRelations({
  readData,
  writeDataBatch,
  dryRun = true,
}) {
  const audit = auditPaymentCounterpartyRelations({ readData });
  const payments = readCollection({ readData }, 'payments');
  const repairById = new Map(audit.repairable.map(issue => [issue.recordId, issue]));
  const changed = [];
  const failed = [];
  const nextPayments = payments.map(payment => {
    const issue = repairById.get(relationId(payment?.id));
    if (!issue) return payment;
    if (relationId(payment?.counterpartyId) || relationId(payment?.clientId) !== issue.clientId) {
      failed.push(auditIssue(payment, counterpartyError(
        COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
        'Payment изменился после audit; repair пропущен.',
        409,
        { reason: 'audit_precondition_changed' },
      )));
      return payment;
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
    return dryRun ? payment : { ...payment, counterpartyId: issue.counterpartyId };
  });

  if (!dryRun && changed.length > 0) {
    if (failed.length > 0 || typeof writeDataBatch !== 'function') {
      if (typeof writeDataBatch !== 'function') {
        failed.push(...changed.map(change => auditIssue(
          { id: change.recordId, clientId: change.clientId },
          counterpartyError(
            COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
            'Actual Payment repair требует writeDataBatch.',
            500,
            { reason: 'writer_missing' },
          ),
        )));
      }
      changed.length = 0;
    } else {
      try {
        writeDataBatch([{ name: 'payments', value: nextPayments }]);
      } catch (error) {
        failed.push(...changed.map(change => auditIssue(
          { id: change.recordId, clientId: change.clientId },
          counterpartyError(
            COUNTERPARTY_RELATION_CODES.REPAIR_FAILED,
            'Не удалось persist controlled Payment relation repair.',
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
      classifications: audit.summary.classifications,
    },
  };
}

module.exports = {
  PAYMENT_METADATA_FIELDS,
  PAYMENT_RELATION_CLASSIFICATIONS,
  assertExistingPaymentAllocationsRemainCanonical,
  assertPaymentAllocationPersistenceEntriesSafe,
  assertPaymentRentalCounterpartyMatch,
  auditPaymentCounterpartyRelations,
  canonicalizePaymentCounterpartyRelation,
  counterpartySummary,
  decoratePaymentCounterparty,
  repairPaymentCounterpartyRelations,
  resolvePaymentCounterpartyRelation,
  resolveRentalForPayment,
};
