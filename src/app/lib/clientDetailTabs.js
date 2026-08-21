const CLIENT_DETAIL_TAB_IDS = Object.freeze([
  'overview',
  'rentals',
  'payments',
  'documents',
  'equipment',
  'activity',
]);

export const CLIENT_DETAIL_TABS = Object.freeze([
  { id: 'overview', label: 'Обзор' },
  { id: 'rentals', label: 'Аренды' },
  { id: 'payments', label: 'Платежи' },
  { id: 'documents', label: 'Документы' },
  { id: 'equipment', label: 'Техника' },
  { id: 'activity', label: 'История активности' },
]);

const ACTIVE_EQUIPMENT_RENTAL_STATUSES = new Set(['active', 'return_planned']);
const CANCELLED_ALLOCATION_STATUSES = new Set(['cancelled', 'canceled', 'void', 'reversed']);

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function safeNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, number) : 0;
}

function unique(values) {
  return Array.from(new Set(values.map(text).filter(Boolean)));
}

function rentalStableIds(rental) {
  return unique([
    rental?.id,
    rental?.rentalId,
    rental?.sourceRentalId,
    rental?.originalRentalId,
    rental?.ganttRentalId,
  ]);
}

function linkedClassicRentalIds(ganttRental) {
  return unique([
    ganttRental?.rentalId,
    ganttRental?.sourceRentalId,
    ganttRental?.originalRentalId,
  ]);
}

function entityRentalId(record) {
  return text(
    record?.rentalId
    || record?.rental
    || record?.ganttRentalId
    || record?.classicRentalId,
  );
}

function relationState(record, client) {
  if (!record || !client) return { hasIdentity: false, matches: false, conflicts: false };

  const recordCounterpartyId = text(record.counterpartyId);
  const recordClientId = text(record.clientId);
  const clientCounterpartyId = text(client.counterpartyId);
  const clientId = text(client.id);
  const counterpartyConflicts = Boolean(
    recordCounterpartyId
    && (!clientCounterpartyId || recordCounterpartyId !== clientCounterpartyId),
  );
  const clientConflicts = Boolean(recordClientId && (!clientId || recordClientId !== clientId));
  const matchesCounterparty = Boolean(
    recordCounterpartyId
    && clientCounterpartyId
    && recordCounterpartyId === clientCounterpartyId,
  );
  const matchesClient = Boolean(recordClientId && clientId && recordClientId === clientId);

  return {
    hasIdentity: Boolean(recordCounterpartyId || recordClientId),
    matches: !counterpartyConflicts && !clientConflicts && (matchesCounterparty || matchesClient),
    conflicts: counterpartyConflicts || clientConflicts,
  };
}

/**
 * Read-side Client/Counterparty boundary for Client Details.
 *
 * Only stable counterpartyId/clientId chains are accepted. A legacy clientId-only
 * record remains readable because Client.clientId -> Client.counterpartyId is a
 * stable compatibility chain. Display names and other mutable metadata are never
 * considered.
 */
export function belongsToClientBoundary(record, client) {
  return relationState(record, client).matches;
}

function buildRentalReferenceStates(rentals, ganttRentals, client) {
  const stateById = new Map();

  const add = (record) => {
    const relation = relationState(record, client);
    const state = relation.conflicts || (relation.hasIdentity && !relation.matches)
      ? 'other'
      : relation.matches
        ? 'client'
        : 'unknown';
    rentalStableIds(record).forEach((id) => {
      const states = stateById.get(id) || new Set();
      states.add(state);
      stateById.set(id, states);
    });
  };

  rentals.forEach(add);
  ganttRentals.forEach(add);

  return new Map(Array.from(stateById.entries()).map(([id, states]) => {
    const hasClient = states.has('client');
    const hasOther = states.has('other');
    if (hasClient && hasOther) return [id, 'conflict'];
    if (hasClient) return [id, 'client'];
    if (hasOther) return [id, 'other'];
    return [id, 'unknown'];
  }));
}

function isEntityForClient(record, client, rentalReferenceStates) {
  const relation = relationState(record, client);
  if (relation.conflicts) return false;

  const rentalId = entityRentalId(record);
  const rentalState = rentalId ? rentalReferenceStates.get(rentalId) : '';
  if (rentalState === 'other' || rentalState === 'conflict') return false;
  if (relation.matches) return true;
  return !relation.hasIdentity && rentalState === 'client';
}

function equipmentEntries(classicRental, ganttRental) {
  const entries = new Map();

  const add = ({ equipmentId, inventoryNumber, label }) => {
    const id = text(equipmentId);
    const inventory = text(inventoryNumber);
    const explicitLabel = text(label);
    if (!id && !inventory && !explicitLabel) return;
    const display = explicitLabel || inventory || id;

    const inventoryKey = inventory ? `inventory:${inventory}` : '';
    const idKey = id ? `id:${id}` : '';
    const existingKey = Array.from(entries.entries()).find(([, item]) => (
      (id && item.equipmentId === id)
      || (inventory && item.inventoryNumber === inventory)
    ))?.[0] || '';
    const key = existingKey || idKey || inventoryKey || `label:${display}`;
    const previous = entries.get(key);
    entries.set(key, {
      key,
      equipmentId: id || previous?.equipmentId || '',
      inventoryNumber: inventory || previous?.inventoryNumber || '',
      label: display || previous?.label || '',
    });
  };

  const equipmentDetails = classicRental?.equipmentDetails || {};
  add({
    equipmentId: classicRental?.equipmentId || equipmentDetails.id || ganttRental?.equipmentId,
    inventoryNumber:
      classicRental?.equipmentInv
      || classicRental?.inventoryNumber
      || equipmentDetails.inventoryNumber
      || ganttRental?.equipmentInv,
    label:
      classicRental?.equipmentInv
      || classicRental?.inventoryNumber
      || equipmentDetails.inventoryNumber
      || ganttRental?.equipmentInv,
  });

  (Array.isArray(classicRental?.equipment) ? classicRental.equipment : []).forEach((inventoryNumber) => {
    add({ inventoryNumber, label: inventoryNumber });
  });

  return Array.from(entries.values());
}

function buildRentalRows(rentals, ganttRentals, client) {
  const clientClassicRentals = rentals.filter(rental => relationState(rental, client).matches);
  const clientClassicById = new Map(clientClassicRentals.map(rental => [text(rental.id), rental]));
  const usedGanttIds = new Set();

  const rows = clientClassicRentals.map((rental) => {
    const ganttRental = ganttRentals.find((candidate) => {
      const relation = relationState(candidate, client);
      if (relation.conflicts) return false;
      const links = linkedClassicRentalIds(candidate);
      return links.includes(text(rental.id)) || text(candidate.id) === text(rental.id);
    }) || null;
    if (ganttRental?.id) usedGanttIds.add(text(ganttRental.id));
    const status = lower(ganttRental?.status || rental.status) || 'unknown';
    const rentalId = text(rental.id);
    return {
      id: rentalId,
      navigationId: rentalId,
      businessNumber: text(rental.number || ganttRental?.number),
      status,
      startDate: text(rental.startDate || ganttRental?.startDate),
      endDate: text(rental.plannedReturnDate || rental.endDate || ganttRental?.endDate),
      amount: safeNumber(ganttRental?.amount ?? rental.price ?? rental.amount),
      equipment: equipmentEntries(rental, ganttRental),
      manager: text(rental.manager || ganttRental?.manager),
      source: 'rentals',
      rawRental: rental,
      rawGanttRental: ganttRental,
    };
  });

  ganttRentals.forEach((ganttRental) => {
    const ganttId = text(ganttRental.id);
    if (!ganttId || usedGanttIds.has(ganttId)) return;
    const relation = relationState(ganttRental, client);
    const linkedClientRental = linkedClassicRentalIds(ganttRental).some(id => clientClassicById.has(id));
    if (relation.conflicts || (!relation.matches && !linkedClientRental)) return;

    const navigationId = linkedClassicRentalIds(ganttRental).find(id => clientClassicById.has(id)) || '';
    rows.push({
      id: ganttId,
      navigationId,
      businessNumber: text(ganttRental.number || clientClassicById.get(navigationId)?.number),
      status: lower(ganttRental.status) || 'unknown',
      startDate: text(ganttRental.startDate),
      endDate: text(ganttRental.endDate),
      amount: safeNumber(ganttRental.amount),
      equipment: equipmentEntries(clientClassicById.get(navigationId), ganttRental),
      manager: text(ganttRental.manager),
      source: 'gantt_rentals',
      rawRental: clientClassicById.get(navigationId) || null,
      rawGanttRental: ganttRental,
    });
  });

  return rows.sort((left, right) => (
    text(right.startDate).localeCompare(text(left.startDate))
    || text(right.businessNumber || right.id).localeCompare(text(left.businessNumber || left.id), 'ru')
  ));
}

function buildPaymentRows(payments, allocations, client, rentalReferenceStates, rentalRows) {
  const rentalRowsByReference = new Map();
  rentalRows.forEach((row) => {
    unique([
      row.id,
      row.navigationId,
      ...(rentalStableIds(row.rawRental)),
      ...(rentalStableIds(row.rawGanttRental)),
    ]).forEach(id => rentalRowsByReference.set(id, row));
  });

  return payments
    .filter(payment => isEntityForClient(payment, client, rentalReferenceStates))
    .map((payment) => {
      const paymentAllocations = allocations
        .filter(allocation => text(allocation.paymentId) === text(payment.id))
        .filter((allocation) => {
          const allocationRelation = relationState(allocation, client);
          if (allocationRelation.conflicts) return false;
          const allocationRentalId = entityRentalId(allocation);
          const rentalState = allocationRentalId ? rentalReferenceStates.get(allocationRentalId) : '';
          return rentalState !== 'other' && rentalState !== 'conflict';
        })
        .map(allocation => ({
          id: text(allocation.id),
          amount: safeNumber(allocation.amount),
          status: lower(allocation.status) || 'active',
          source: text(allocation.source),
          rentalId: entityRentalId(allocation),
          rentalBusinessNumber: rentalRowsByReference.get(entityRentalId(allocation))?.businessNumber || '',
          documentId: text(allocation.documentId),
          periodStart: text(allocation.periodStart),
          periodEnd: text(allocation.periodEnd),
        }));
      const effectiveAllocations = paymentAllocations.filter(item => !CANCELLED_ALLOCATION_STATUSES.has(item.status));
      const allocatedAmount = effectiveAllocations.reduce((sum, item) => sum + item.amount, 0);
      const paidAmount = typeof payment.paidAmount === 'number'
        ? safeNumber(payment.paidAmount)
        : lower(payment.status) === 'paid'
          ? safeNumber(payment.amount)
          : 0;

      return {
        id: text(payment.id),
        number: text(payment.invoiceNumber) || text(payment.id),
        date: text(payment.paidDate || payment.dueDate),
        paidDate: text(payment.paidDate),
        dueDate: text(payment.dueDate),
        amount: safeNumber(payment.amount),
        paidAmount,
        status: lower(payment.status) || 'unknown',
        rentalId: entityRentalId(payment),
        rentalBusinessNumber: rentalRowsByReference.get(entityRentalId(payment))?.businessNumber || '',
        allocatedAmount,
        unallocatedAmount: Math.max(0, paidAmount - allocatedAmount),
        allocations: paymentAllocations,
      };
    })
    .sort((left, right) => text(right.date).localeCompare(text(left.date)));
}

function buildDocumentRows(documents, client, rentalReferenceStates, rentalRows) {
  const rentalRowsByReference = new Map();
  rentalRows.forEach((row) => {
    unique([
      row.id,
      row.navigationId,
      ...(rentalStableIds(row.rawRental)),
      ...(rentalStableIds(row.rawGanttRental)),
    ]).forEach(id => rentalRowsByReference.set(id, row));
  });

  return documents
    .filter(document => isEntityForClient(document, client, rentalReferenceStates))
    .map(document => ({
      id: text(document.id),
      number: text(document.number || document.documentNumber) || text(document.id),
      type: text(document.type || document.documentType) || 'document',
      status: lower(document.status) || 'unknown',
      date: text(document.date || document.documentDate || document.createdAt),
      amount: safeNumber(document.amount),
      rentalId: entityRentalId(document),
      rentalBusinessNumber: rentalRowsByReference.get(entityRentalId(document))?.businessNumber || '',
      contractId: text(document.contractId),
      history: Array.isArray(document.history) ? document.history : [],
    }))
    .sort((left, right) => text(right.date).localeCompare(text(left.date)));
}

function buildContractRows(contracts, client) {
  return contracts
    .filter(contract => relationState(contract, client).matches)
    .map(contract => ({
      id: text(contract.id),
      number: text(contract.number) || text(contract.id),
      title: text(contract.title) || 'Договор',
      date: text(contract.date || contract.createdAt),
      status: lower(contract.status) || 'active',
      objectId: text(contract.objectId),
    }))
    .sort((left, right) => text(right.date).localeCompare(text(left.date)));
}

function buildEquipmentRows(rentalRows) {
  const equipment = new Map();

  rentalRows.forEach((rental) => {
    rental.equipment.forEach((item) => {
      const current = equipment.get(item.key) || {
        ...item,
        current: false,
        rentals: [],
      };
      current.current = current.current || ACTIVE_EQUIPMENT_RENTAL_STATUSES.has(rental.status);
      current.rentals.push({
        id: rental.id,
        navigationId: rental.navigationId,
        businessNumber: rental.businessNumber,
        status: rental.status,
        startDate: rental.startDate,
        endDate: rental.endDate,
      });
      equipment.set(item.key, current);
    });
  });

  return Array.from(equipment.values())
    .map(item => ({
      ...item,
      rentals: item.rentals.sort((left, right) => text(right.startDate).localeCompare(text(left.startDate))),
    }))
    .sort((left, right) => Number(right.current) - Number(left.current) || left.label.localeCompare(right.label, 'ru'));
}

function activityRow({ id, date, text: rowText, author, source, entityId, navigationId = '' }) {
  const normalizedDate = text(date);
  const normalizedText = text(rowText);
  if (!normalizedDate || !normalizedText) return null;
  return {
    id: text(id) || `${source}:${entityId}:${normalizedDate}:${normalizedText}`,
    date: normalizedDate,
    text: normalizedText,
    author: text(author) || 'Система',
    source,
    entityId: text(entityId),
    navigationId: text(navigationId),
  };
}

function buildActivityRows(client, rentalRows, documentRows, paymentRows, crmActivities) {
  const activities = [];
  const add = value => value && activities.push(value);

  (Array.isArray(client?.history) ? client.history : []).forEach((entry, index) => add(activityRow({
    id: `client:${index}:${entry.date}`,
    date: entry.date,
    text: entry.text,
    author: entry.author,
    source: 'client',
    entityId: client.id,
  })));

  (Array.isArray(crmActivities) ? crmActivities : [])
    .filter(activity => relationState(activity, client).matches)
    .forEach(activity => add(activityRow({
      id: activity.id,
      date: activity.occurredAt || activity.createdAt,
      text: [activity.result, activity.comment].map(text).filter(Boolean).join(' · ') || text(activity.type),
      author: activity.managerName || activity.createdBy,
      source: 'crm',
      entityId: activity.id,
    })));

  rentalRows.forEach((rental) => {
    const history = [
      ...(Array.isArray(rental.rawRental?.history) ? rental.rawRental.history : []),
      ...(Array.isArray(rental.rawGanttRental?.comments) ? rental.rawGanttRental.comments : []),
    ];
    history.forEach((entry, index) => add(activityRow({
      id: `rental:${rental.id}:${index}:${entry.date}`,
      date: entry.date,
      text: entry.text,
      author: entry.author,
      source: 'rental',
      entityId: rental.id,
      navigationId: rental.navigationId,
    })));
  });

  documentRows.forEach((document) => {
    document.history.forEach((entry, index) => add(activityRow({
      id: entry.id || `document:${document.id}:${index}:${entry.createdAt}`,
      date: entry.createdAt,
      text: [entry.action, entry.comment].map(text).filter(Boolean).join(' · '),
      author: entry.createdBy,
      source: 'document',
      entityId: document.id,
    })));
  });

  paymentRows
    .filter(payment => payment.paidDate && payment.paidAmount > 0)
    .forEach(payment => add(activityRow({
      id: `payment:${payment.id}:${payment.paidDate}`,
      date: payment.paidDate,
      text: `Платёж ${payment.number} получен`,
      author: 'Система',
      source: 'payment',
      entityId: payment.id,
    })));

  const deduplicated = new Map();
  activities.forEach((activity) => {
    const key = [activity.date, activity.text, activity.author, activity.source, activity.entityId].join('|');
    if (!deduplicated.has(key)) deduplicated.set(key, activity);
  });

  return Array.from(deduplicated.values())
    .sort((left, right) => text(right.date).localeCompare(text(left.date)));
}

export function resolveClientDetailTab(value) {
  const tab = lower(value);
  return CLIENT_DETAIL_TAB_IDS.includes(tab) ? tab : 'overview';
}

export function buildClientDetailTabModel(input = {}) {
  const client = input.client || null;
  const rentals = Array.isArray(input.rentals) ? input.rentals : [];
  const ganttRentals = Array.isArray(input.ganttRentals) ? input.ganttRentals : [];
  const payments = Array.isArray(input.payments) ? input.payments : [];
  const allocations = Array.isArray(input.paymentAllocations) ? input.paymentAllocations : [];
  const documents = Array.isArray(input.documents) ? input.documents : [];
  const contracts = Array.isArray(input.contracts) ? input.contracts : [];
  if (!client) {
    return {
      rentals: [],
      payments: [],
      documents: [],
      contracts: [],
      equipment: [],
      activity: [],
      counters: { rentals: 0, payments: 0, documents: 0, equipment: 0, activity: 0 },
    };
  }

  const rentalReferenceStates = buildRentalReferenceStates(rentals, ganttRentals, client);
  const rentalRows = buildRentalRows(rentals, ganttRentals, client);
  const paymentRows = buildPaymentRows(payments, allocations, client, rentalReferenceStates, rentalRows);
  const documentRows = buildDocumentRows(documents, client, rentalReferenceStates, rentalRows);
  const contractRows = buildContractRows(contracts, client);
  const equipmentRows = buildEquipmentRows(rentalRows);
  const activityRows = buildActivityRows(
    client,
    rentalRows,
    documentRows,
    paymentRows,
    input.crmActivities,
  );

  return {
    rentals: rentalRows,
    payments: paymentRows,
    documents: documentRows,
    contracts: contractRows,
    equipment: equipmentRows,
    activity: activityRows,
    counters: {
      rentals: rentalRows.length,
      payments: paymentRows.length,
      documents: documentRows.length + contractRows.length,
      equipment: equipmentRows.length,
      activity: activityRows.length,
    },
  };
}
