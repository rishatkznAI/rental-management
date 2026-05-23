const {
  getStableClientId,
  normalizeText,
} = require('./client-links');
const {
  buildClientObjectDebtBreakdown,
} = require('./client-relations');
const {
  buildLeasingSummary,
} = require('./leasing-core');
const { calculateRentalBilling, getRentalBillingAmount } = require('./rental-billing');

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

const IGNORED_PAYMENT_STATUSES = new Set([
  'cancelled',
  'canceled',
  'void',
  'error',
  'failed',
  'closed',
  'deleted',
  'reversed',
]);

const IGNORED_RENTAL_STATUSES = new Set([
  'cancelled',
  'canceled',
  'void',
  'error',
  'failed',
  'deleted',
  'archived',
]);

const DEBT_AGE_BUCKETS = [
  { key: '0_7', label: '0-7 дней', rentals: 0, debt: 0 },
  { key: '8_14', label: '8-14 дней', rentals: 0, debt: 0 },
  { key: '15_30', label: '15-30 дней', rentals: 0, debt: 0 },
  { key: '31_60', label: '31-60 дней', rentals: 0, debt: 0 },
  { key: '60_plus', label: '60+ дней', rentals: 0, debt: 0 },
];

const ECONOMICS_GROUPS = new Set(['month', 'quarter', 'year']);
const EQUIPMENT_GROUPS = new Set(['all', 'rented', 'idle', 'service', 'sale']);

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function shouldCountPayment(payment) {
  return !IGNORED_PAYMENT_STATUSES.has(normalizeStatus(payment?.status));
}

function shouldCountRental(rental) {
  return !IGNORED_RENTAL_STATUSES.has(normalizeStatus(rental?.status));
}

function getEffectivePaidAmount(payment) {
  if (!shouldCountPayment(payment)) return 0;
  if (typeof payment?.paidAmount === 'number') {
    return Number.isFinite(payment.paidAmount) ? Math.max(0, payment.paidAmount) : 0;
  }
  if (payment?.status === 'paid') return Math.max(0, toNumber(payment.amount));
  return 0;
}

function getRecordId(record) {
  return String(record?.id || '').trim();
}

function getPaymentId(record) {
  return String(record?.paymentId || '').trim();
}

function getPaymentAllocationAmount(allocation) {
  const amount = toNumber(allocation?.amount ?? allocation?.allocatedAmount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function getPaymentAllocationCap(payment) {
  const paid = getEffectivePaidAmount(payment);
  const amount = toNumber(payment?.amount);
  if (amount > 0) return Math.min(paid, amount);
  return paid;
}

function normalizeFinanceArgs(value) {
  if (Array.isArray(value)) return { paymentAllocations: value };
  if (value && typeof value === 'object') {
    return {
      paymentAllocations: Array.isArray(value.paymentAllocations) ? value.paymentAllocations : [],
    };
  }
  return { paymentAllocations: [] };
}

function paymentHasAllocations(payment, allocationsByPaymentId) {
  const paymentId = getRecordId(payment);
  return Boolean(paymentId && allocationsByPaymentId.has(paymentId));
}

function buildAllocationsByPaymentId(paymentAllocations) {
  const map = new Map();
  const seen = new Set();
  for (const allocation of paymentAllocations || []) {
    if (!shouldCountPayment(allocation)) continue;
    const paymentId = getPaymentId(allocation);
    if (!paymentId) continue;
    const allocationId = getRecordId(allocation);
    const dedupeKey = allocationId || JSON.stringify([
      paymentId,
      allocation?.rentalId || '',
      allocation?.documentId || '',
      allocation?.objectId || '',
      allocation?.contractId || '',
      getPaymentAllocationAmount(allocation),
    ]);
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    if (!map.has(paymentId)) map.set(paymentId, []);
    map.get(paymentId).push(allocation);
  }
  return map;
}

function buildAllocatedAmountsByRental(payments, paymentAllocations) {
  const allocationsByPaymentId = buildAllocationsByPaymentId(paymentAllocations);
  const byRentalId = new Map();
  const paymentById = new Map((payments || []).filter(item => getRecordId(item)).map(item => [getRecordId(item), item]));

  for (const [paymentId, allocations] of allocationsByPaymentId) {
    const payment = paymentById.get(paymentId);
    if (!payment || !shouldCountPayment(payment)) continue;
    const effectivePaid = getPaymentAllocationCap(payment);
    if (effectivePaid <= 0) continue;
    let remaining = effectivePaid;
    for (const allocation of allocations) {
      const rentalId = String(allocation?.rentalId || '').trim();
      const requested = getPaymentAllocationAmount(allocation);
      if (!rentalId || requested <= 0 || remaining <= 0) continue;
      const amount = Math.min(requested, remaining);
      byRentalId.set(rentalId, (byRentalId.get(rentalId) || 0) + amount);
      remaining -= amount;
    }
  }

  const seenLegacyPaymentIds = new Set();
  for (const payment of payments || []) {
    if (!payment?.rentalId || !shouldCountPayment(payment) || paymentHasAllocations(payment, allocationsByPaymentId)) continue;
    const paymentId = getRecordId(payment);
    if (paymentId) {
      if (seenLegacyPaymentIds.has(paymentId)) continue;
      seenLegacyPaymentIds.add(paymentId);
    }
    const amount = getPaymentAllocationCap(payment);
    if (amount <= 0) continue;
    const rentalId = String(payment.rentalId);
    byRentalId.set(rentalId, (byRentalId.get(rentalId) || 0) + amount);
  }

  return byRentalId;
}

function getOverdueDate(row) {
  return row?.expectedPaymentDate || row?.endDate || '';
}

function getRentalDebtOverdueDays(row, today = new Date().toISOString().slice(0, 10)) {
  if (toNumber(row?.outstanding) <= 0) return 0;
  const dueDate = getOverdueDate(row);
  if (!dueDate || dueDate >= today) return 0;
  return Math.max(0, Math.floor((new Date(today).getTime() - new Date(dueDate).getTime()) / 86400000));
}

function getClientName(record) {
  return String(record?.client || record?.clientName || record?.company || record?.customerName || '').trim();
}

function getManualClientDebt(client) {
  return Math.max(0, toNumber(client?.debt));
}

function buildClientsById(clients) {
  return new Map(
    (clients || [])
      .filter(client => client?.id)
      .map(client => [String(client.id), client]),
  );
}

function getReceivableKey(row) {
  const clientId = getStableClientId(row);
  if (clientId) return `id:${clientId}`;
  return `unlinked:${normalizeText(row?.client) || row?.rentalId || 'unknown'}`;
}

function buildRentalDebtRows(rentals, payments, options) {
  const { paymentAllocations } = normalizeFinanceArgs(options);
  // IMPORTANT: new payment impact is joined through payment_allocations.rentalId.
  // Legacy payments with direct rentalId are still honored only when the payment has no
  // explicit allocations, so contract-level receipts do not close every contract rental.
  const paidByRentalId = buildAllocatedAmountsByRental(payments, paymentAllocations);

  return (rentals || [])
    .filter(shouldCountRental)
    .map(rental => {
      const paidAmount = paidByRentalId.get(rental.id) || 0;
      const billing = calculateRentalBilling(rental);
      const amount = billing.finalRentalAmount;
      const outstanding = Math.max(0, amount - paidAmount);
      const paymentStatus = outstanding <= 0
        ? 'paid'
        : paidAmount > 0
          ? 'partial'
          : 'unpaid';
      return {
        rentalId: rental.id,
        clientId: getStableClientId(rental) || '',
        client: getClientName(rental),
        objectId: rental.objectId || '',
        contractId: rental.contractId || '',
        equipmentId: rental.equipmentId || '',
        equipmentInv: rental.equipmentInv || '',
        manager: rental.manager || '',
        managerId: rental.managerId || '',
        documentId: rental.documentId || rental.actDocumentId || rental.invoiceDocumentId || '',
        startDate: rental.startDate || '',
        endDate: rental.endDate || '',
        expectedPaymentDate: rental.expectedPaymentDate || '',
        amount,
        grossAmount: billing.grossRentalAmount,
        downtimeAdjustmentAmount: billing.downtimeAdjustmentAmount,
        downtimeDays: billing.downtimeDays,
        billingDowntimeDays: billing.billingDowntimeDays,
        billableDays: billing.billableDays,
        paidAmount,
        outstanding,
        paymentStatus,
        rentalStatus: rental.status || 'created',
      };
    })
    .filter(row => row.outstanding > 0 || row.paymentStatus !== 'paid')
    .sort((a, b) => b.outstanding - a.outstanding || a.client.localeCompare(b.client, 'ru'));
}

function isActiveRentalStatus(status) {
  return ['active', 'created', 'confirmed', 'return_planned'].includes(normalizeStatus(status));
}

function getDebtAgeBucket(overdueDays) {
  if (overdueDays <= 7) return DEBT_AGE_BUCKETS[0];
  if (overdueDays <= 14) return DEBT_AGE_BUCKETS[1];
  if (overdueDays <= 30) return DEBT_AGE_BUCKETS[2];
  if (overdueDays <= 60) return DEBT_AGE_BUCKETS[3];
  return DEBT_AGE_BUCKETS[4];
}

function getDebtAgeBucketKey(overdueDays) {
  return getDebtAgeBucket(overdueDays).key;
}

function cloneDebtAgeBuckets() {
  return DEBT_AGE_BUCKETS.map(item => ({ ...item }));
}

function buildClientReceivables(clients, rentalDebtRows, today = new Date().toISOString().slice(0, 10)) {
  const clientsById = buildClientsById(clients);
  const map = new Map();

  (rentalDebtRows || []).forEach(row => {
    // IMPORTANT: receivables are grouped by stable clientId when present. The display
    // name may change without losing debt, payment, document, or rental history.
    const rowClientId = getStableClientId(row);
    const client = rowClientId ? clientsById.get(rowClientId) : null;
    const key = getReceivableKey(row);
    const displayName = client?.company || row.client || 'Клиент не привязан';
    const existing = map.get(key) || {
      clientId: client?.id || rowClientId || undefined,
      client: displayName,
      creditLimit: toNumber(client?.creditLimit),
      currentDebt: 0,
      manualDebt: 0,
      unpaidRentals: 0,
      overdueRentals: 0,
      exceededLimit: false,
      dataIssue: rowClientId ? undefined : 'missing_client_id',
    };
    existing.currentDebt += row.outstanding;
    existing.unpaidRentals += 1;
    if ((row.expectedPaymentDate && row.expectedPaymentDate < today) || row.endDate < today) {
      existing.overdueRentals += 1;
    }
    existing.exceededLimit = existing.creditLimit > 0 && existing.currentDebt > existing.creditLimit;
    map.set(key, existing);
  });

  (clients || []).forEach(client => {
    const manualDebt = getManualClientDebt(client);
    if (manualDebt <= 0) return;
    const key = client?.id ? `id:${client.id}` : `manual:${normalizeText(client?.company) || 'unknown'}`;
    const existing = map.get(key) || {
      clientId: client?.id || undefined,
      client: client?.company || 'Клиент не привязан',
      creditLimit: toNumber(client?.creditLimit),
      currentDebt: 0,
      manualDebt: 0,
      unpaidRentals: 0,
      overdueRentals: 0,
      exceededLimit: false,
    };
    existing.currentDebt += manualDebt;
    existing.manualDebt += manualDebt;
    existing.exceededLimit = existing.creditLimit > 0 && existing.currentDebt > existing.creditLimit;
    map.set(key, existing);
  });

  return Array.from(map.values()).sort((a, b) => b.currentDebt - a.currentDebt || a.client.localeCompare(b.client, 'ru'));
}

function buildClientFinancialSnapshots(clients, rentals, payments, today = new Date().toISOString().slice(0, 10), options) {
  const debtRows = buildRentalDebtRows(rentals, payments, options);
  const receivables = buildClientReceivables(clients, debtRows, today);
  const receivableMap = new Map(receivables.filter(item => item.clientId).map(item => [String(item.clientId), item]));

  return (clients || [])
    .map(client => {
      const clientRentals = (rentals || []).filter(item => getStableClientId(item) === String(client.id));
      const latestRental = clientRentals
        .slice()
        .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];
      const receivable = receivableMap.get(String(client.id));
      return {
        clientId: client.id,
        client: client.company,
        creditLimit: toNumber(client.creditLimit),
        currentDebt: receivable?.currentDebt || getManualClientDebt(client),
        manualDebt: receivable?.manualDebt || getManualClientDebt(client),
        unpaidRentals: receivable?.unpaidRentals || 0,
        overdueRentals: receivable?.overdueRentals || 0,
        exceededLimit: receivable?.exceededLimit || (toNumber(client.creditLimit) > 0 && getManualClientDebt(client) > toNumber(client.creditLimit)),
        totalRentals: clientRentals.length,
        activeRentals: clientRentals.filter(item => item.status === 'active' || item.status === 'created').length,
        lastRentalDate: latestRental?.startDate || client.lastRentalDate || '',
      };
    })
    .sort((a, b) => b.currentDebt - a.currentDebt || a.client.localeCompare(b.client, 'ru'));
}

function buildManagerReceivables(rentalDebtRows, today = new Date().toISOString().slice(0, 10), clients = []) {
  const map = new Map();

  (rentalDebtRows || []).forEach(row => {
    const key = row.manager || 'Не назначен';
    const overdueDays = getRentalDebtOverdueDays(row, today);
    const item = map.get(key) || {
      manager: key,
      currentDebt: 0,
      overdueDebt: 0,
      unpaidRentals: 0,
      overdueRentals: 0,
      clientsCount: 0,
      clients: new Set(),
    };
    item.currentDebt += row.outstanding;
    item.unpaidRentals += 1;
    if (overdueDays > 0) {
      item.overdueRentals += 1;
      item.overdueDebt += row.outstanding;
    }
    item.clients.add(getStableClientId(row) || row.client || 'Клиент не привязан');
    item.clientsCount = item.clients.size;
    map.set(key, item);
  });

  (clients || []).forEach(client => {
    const manualDebt = getManualClientDebt(client);
    if (manualDebt <= 0) return;
    const key = client?.manager || 'Не назначен';
    const item = map.get(key) || {
      manager: key,
      currentDebt: 0,
      overdueDebt: 0,
      unpaidRentals: 0,
      overdueRentals: 0,
      clientsCount: 0,
      clients: new Set(),
    };
    item.currentDebt += manualDebt;
    item.clients.add(client?.id || client?.company || 'Клиент не привязан');
    item.clientsCount = item.clients.size;
    map.set(key, item);
  });

  return Array.from(map.values())
    .map(({ clients, ...rest }) => rest)
    .sort((a, b) => b.currentDebt - a.currentDebt || a.manager.localeCompare(b.manager, 'ru'));
}

function buildOverdueBuckets(rentalDebtRows, today = new Date().toISOString().slice(0, 10)) {
  const buckets = cloneDebtAgeBuckets();

  (rentalDebtRows || []).forEach(row => {
    if (toNumber(row?.outstanding) <= 0) return;
    const overdueDays = getRentalDebtOverdueDays(row, today);
    const bucket = buckets.find(item => item.key === getDebtAgeBucketKey(overdueDays)) || buckets[0];
    bucket.rentals += 1;
    bucket.debt += row.outstanding;
  });

  return buckets;
}

function buildClientDebtAgingRows(clients, rentalDebtRows, today = new Date().toISOString().slice(0, 10)) {
  const clientsById = buildClientsById(clients);
  const map = new Map();

  (rentalDebtRows || []).forEach(row => {
    const outstanding = toNumber(row?.outstanding);
    if (outstanding <= 0) return;
    const rowClientId = getStableClientId(row);
    const client = rowClientId ? clientsById.get(rowClientId) : null;
    const overdueDays = getRentalDebtOverdueDays(row, today);
    const bucket = getDebtAgeBucket(overdueDays);
    const hasActiveRental = isActiveRentalStatus(row.rentalStatus);
    const clientName = client?.company || row.client || 'Клиент не привязан';
    const manager = row.manager || client?.manager || 'Не назначен';
    const key = [
      rowClientId ? `id:${rowClientId}` : `unlinked:${normalizeText(clientName) || row.rentalId || 'unknown'}`,
      manager,
      bucket.key,
      hasActiveRental ? 'active' : 'inactive',
    ].join('|');
    const existing = map.get(key) || {
      clientId: client?.id || rowClientId || undefined,
      client: clientName,
      manager,
      ageBucket: bucket.key,
      ageBucketLabel: bucket.label,
      debt: 0,
      rentals: 0,
      overdueRentals: 0,
      hasActiveRental,
      maxOverdueDays: 0,
    };
    existing.debt += outstanding;
    existing.rentals += 1;
    if (overdueDays > 0) existing.overdueRentals += 1;
    existing.maxOverdueDays = Math.max(existing.maxOverdueDays, overdueDays);
    map.set(key, existing);
  });

  return Array.from(map.values()).sort((a, b) =>
    b.debt - a.debt
    || b.maxOverdueDays - a.maxOverdueDays
    || a.client.localeCompare(b.client, 'ru')
    || a.manager.localeCompare(b.manager, 'ru')
  );
}

function buildDebtSummaryRows(rentalDebtRows, keyFields) {
  const fields = Array.isArray(keyFields) ? keyFields : [keyFields];
  const map = new Map();
  for (const row of rentalDebtRows || []) {
    const keyParts = fields.map(field => String(row?.[field] || '').trim());
    const key = keyParts.map(value => value || 'none').join('|');
    const existing = map.get(key) || fields.reduce((acc, field, index) => {
      acc[field] = keyParts[index] || undefined;
      return acc;
    }, { debt: 0, rentals: 0 });
    existing.debt += toNumber(row?.outstanding);
    existing.rentals += 1;
    map.set(key, existing);
  }
  return [...map.values()].sort((a, b) => b.debt - a.debt || JSON.stringify(a).localeCompare(JSON.stringify(b), 'ru'));
}

function buildUnallocatedPayments(payments, paymentAllocations) {
  const allocationsByPaymentId = buildAllocationsByPaymentId(paymentAllocations);
  return (payments || [])
    .filter(shouldCountPayment)
    .map(payment => {
      const paymentId = getRecordId(payment);
      const paidAmount = getPaymentAllocationCap(payment);
      const allocations = paymentId ? (allocationsByPaymentId.get(paymentId) || []) : [];
      const allocatedAmount = allocations.reduce((sum, allocation) => sum + getPaymentAllocationAmount(allocation), 0);
      const legacyAllocatedAmount = payment?.rentalId && !paymentHasAllocations(payment, allocationsByPaymentId) ? paidAmount : 0;
      const unallocatedAmount = Math.max(0, paidAmount - allocatedAmount - legacyAllocatedAmount);
      return {
        paymentId: paymentId || undefined,
        clientId: getStableClientId(payment) || undefined,
        objectId: payment.objectId || undefined,
        contractId: payment.contractId || undefined,
        amount: toNumber(payment.amount),
        paidAmount,
        allocatedAmount: Math.min(paidAmount, allocatedAmount + legacyAllocatedAmount),
        unallocatedAmount,
        status: payment.status || '',
        paidDate: payment.paidDate || '',
        dueDate: payment.dueDate || '',
      };
    })
    .filter(row => row.unallocatedAmount > 0)
    .sort((a, b) => b.unallocatedAmount - a.unallocatedAmount || String(a.paymentId || '').localeCompare(String(b.paymentId || '')));
}

function buildAllocationPreview({ payments, paymentAllocations, rentals }, paymentId) {
  const id = String(paymentId || '').trim();
  const payment = (payments || []).find(item => getRecordId(item) === id);
  if (!payment || !shouldCountPayment(payment)) return { paymentId: id, unallocatedAmount: 0, suggestedAllocations: [] };
  const existing = buildUnallocatedPayments([payment], paymentAllocations)[0];
  const unallocatedAmount = existing?.unallocatedAmount || 0;
  const clientId = getStableClientId(payment);
  const contractId = String(payment.contractId || '').trim();
  const candidateRows = buildRentalDebtRows(rentals || [], payments || [], { paymentAllocations })
    .filter(row => (!clientId || row.clientId === clientId) && (!contractId || row.contractId === contractId))
    .filter(row => row.outstanding > 0);
  let remaining = unallocatedAmount;
  const suggestedAllocations = [];
  for (const row of candidateRows) {
    if (remaining <= 0) break;
    const amount = Math.min(row.outstanding, remaining);
    suggestedAllocations.push({
      paymentId: id,
      clientId: row.clientId || clientId || undefined,
      objectId: row.objectId || undefined,
      contractId: row.contractId || contractId || undefined,
      rentalId: row.rentalId,
      amount,
    });
    remaining -= amount;
  }
  return { paymentId: id, unallocatedAmount, suggestedAllocations };
}

function resolveRentalForAllocation(payment, rentals, documentsById) {
  const directRentalId = String(payment?.rentalId || '').trim();
  if (directRentalId) return (rentals || []).find(item => String(item?.id || '').trim() === directRentalId) || { id: directRentalId };
  const documentId = String(payment?.documentId || payment?.document || '').trim();
  if (!documentId) return null;
  const document = documentsById.get(documentId);
  const documentRentalId = String(document?.rentalId || document?.rental || '').trim();
  if (!documentRentalId) return null;
  return (rentals || []).find(item => String(item?.id || '').trim() === documentRentalId) || { id: documentRentalId };
}

function backfillPaymentAllocations({ payments = [], paymentAllocations = [], rentals = [], documents = [], nowIso = () => new Date().toISOString(), generateId } = {}) {
  const allocations = Array.isArray(paymentAllocations) ? paymentAllocations : [];
  const existingPaymentIds = new Set(allocations.map(item => String(item?.paymentId || '').trim()).filter(Boolean));
  const documentsById = new Map((documents || []).filter(item => item?.id).map(item => [String(item.id), item]));
  const next = [...allocations];
  let created = 0;

  for (const payment of payments || []) {
    const paymentId = getRecordId(payment);
    if (!paymentId || existingPaymentIds.has(paymentId) || !shouldCountPayment(payment)) continue;
    const amount = getPaymentAllocationCap(payment);
    if (amount <= 0) continue;
    const rental = resolveRentalForAllocation(payment, rentals, documentsById);
    const rentalId = String(rental?.id || '').trim();
    if (!rentalId) continue;
    const documentId = String(payment?.documentId || payment?.document || '').trim() || undefined;
    const id = typeof generateId === 'function'
      ? generateId('PA')
      : `PA-LEGACY-${paymentId}`;
    next.push({
      id,
      paymentId,
      clientId: getStableClientId(payment) || getStableClientId(rental) || undefined,
      objectId: payment.objectId || rental.objectId || undefined,
      contractId: payment.contractId || rental.contractId || undefined,
      rentalId,
      documentId,
      amount,
      status: 'active',
      source: 'legacy_backfill',
      createdAt: nowIso(),
    });
    existingPaymentIds.add(paymentId);
    created += 1;
  }

  return { allocations: next, created };
}

function buildFinanceReport({ clients, rentals, payments, paymentAllocations, clientObjects, leasingContracts, leasingPaymentSchedule }, today = new Date().toISOString().slice(0, 10)) {
  const debtRows = buildRentalDebtRows(rentals, payments, { paymentAllocations });
  const clientReceivables = buildClientReceivables(clients, debtRows, today);
  const clientSnapshots = buildClientFinancialSnapshots(clients, rentals, payments, today, { paymentAllocations });
  const managerReceivables = buildManagerReceivables(debtRows, today, clients);
  const overdueBuckets = buildOverdueBuckets(debtRows, today);
  const clientDebtAgingRows = buildClientDebtAgingRows(clients, debtRows, today);
  const clientObjectDebtRows = buildClientObjectDebtBreakdown(clients, debtRows, clientObjects);
  const leasing = buildLeasingSummary(leasingContracts || [], leasingPaymentSchedule || [], today);
  const unallocatedPayments = buildUnallocatedPayments(payments, paymentAllocations);

  return {
    debtRows,
    debtByClient: buildDebtSummaryRows(debtRows, 'clientId'),
    debtByObject: buildDebtSummaryRows(debtRows, ['clientId', 'objectId']),
    debtByContract: buildDebtSummaryRows(debtRows, ['clientId', 'contractId']),
    debtByRental: buildDebtSummaryRows(debtRows, ['clientId', 'objectId', 'contractId', 'rentalId']),
    debtByManager: buildDebtSummaryRows(debtRows, ['managerId', 'manager']),
    debtByDocument: buildDebtSummaryRows(debtRows, ['documentId']),
    unallocatedPayments,
    clientReceivables,
    clientSnapshots,
    managerReceivables,
    overdueBuckets,
    clientDebtAgingRows,
    clientObjectDebtRows,
    leasing,
    totals: {
      debt: clientSnapshots.reduce((sum, item) => sum + item.currentDebt, 0),
      overdueClients: clientSnapshots.filter(item => item.overdueRentals > 0).length,
      exceededClients: clientSnapshots.filter(item => item.exceededLimit).length,
      unpaidRentals: debtRows.length,
      unallocatedPayments: unallocatedPayments.reduce((sum, item) => sum + item.unallocatedAmount, 0),
      overdueDebt: managerReceivables.reduce((sum, item) => sum + item.overdueDebt, 0),
      leasingCurrentMonth: leasing.currentMonthAmount,
      leasingNextMonth: leasing.nextMonthAmount,
      leasingRemaining: leasing.remainingAmount,
      leasingOverdue: leasing.overdueAmount,
    },
  };
}

function dateText(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function parseDate(value) {
  const text = dateText(value);
  if (!text) return null;
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function daysInclusive(start, end) {
  const left = parseDate(start);
  const right = parseDate(end);
  if (!left || !right || right < left) return 0;
  return Math.floor((right.getTime() - left.getTime()) / 86400000) + 1;
}

function overlapDays(start, end, dateFrom, dateTo) {
  const left = parseDate(start);
  const right = parseDate(end);
  const from = parseDate(dateFrom);
  const to = parseDate(dateTo);
  if (!left || !right || !from || !to || right < from || left > to) return 0;
  return daysInclusive(
    new Date(Math.max(left.getTime(), from.getTime())).toISOString().slice(0, 10),
    new Date(Math.min(right.getTime(), to.getTime())).toISOString().slice(0, 10),
  );
}

function addMonths(date, months) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + months, 1));
}

function monthCountInRange(dateFrom, dateTo) {
  const from = parseDate(dateFrom);
  const to = parseDate(dateTo);
  if (!from || !to || to < from) return 0;
  let count = 0;
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor <= end) {
    count += 1;
    cursor = addMonths(cursor, 1);
  }
  return count;
}

function getPeriodKey(dateValue, groupBy) {
  const date = parseDate(dateValue);
  if (!date) return '';
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + 1;
  if (groupBy === 'year') return String(year);
  if (groupBy === 'quarter') return `${year}-Q${Math.floor((month - 1) / 3) + 1}`;
  return `${year}-${String(month).padStart(2, '0')}`;
}

function seedPeriods(dateFrom, dateTo, groupBy) {
  const from = parseDate(dateFrom);
  const to = parseDate(dateTo);
  const map = new Map();
  if (!from || !to || to < from) return map;
  let cursor = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cursor <= end) {
    const key = getPeriodKey(cursor.toISOString().slice(0, 10), groupBy);
    if (!map.has(key)) {
      map.set(key, {
        period: key,
        revenue: 0,
        expenses: 0,
        depreciation: 0,
        profitBeforeDepreciation: 0,
        profitAfterDepreciation: 0,
      });
    }
    cursor = addMonths(cursor, 1);
  }
  return map;
}

function addPeriodValue(periods, dateValue, groupBy, field, amount) {
  const key = getPeriodKey(dateValue, groupBy);
  if (!key || !Number.isFinite(amount) || amount === 0) return;
  if (!periods.has(key)) {
    periods.set(key, {
      period: key,
      revenue: 0,
      expenses: 0,
      depreciation: 0,
      profitBeforeDepreciation: 0,
      profitAfterDepreciation: 0,
    });
  }
  periods.get(key)[field] += amount;
}

function getRentalStart(rental) {
  return dateText(rental?.startDate || rental?.rentalStartDate || rental?.dateFrom);
}

function getRentalEnd(rental) {
  return dateText(rental?.endDate || rental?.plannedReturnDate || rental?.actualReturnDate || rental?.rentalEndDate || rental?.dateTo || getRentalStart(rental));
}

function getRentalCanonicalId(rental) {
  return String(rental?.rentalId || rental?.sourceRentalId || rental?.originalRentalId || rental?.id || '').trim();
}

function getRentalDedupeKey(rental) {
  const canonicalId = getRentalCanonicalId(rental);
  return canonicalId || JSON.stringify([
    getRentalStart(rental),
    getRentalEnd(rental),
    rental?.clientId || rental?.client || '',
    rental?.equipmentId || rental?.equipmentInv || rental?.equipment || '',
  ]);
}

function collectEquipmentIds(record) {
  const ids = new Set();
  for (const field of ['equipmentId', 'equipment_id']) {
    const value = String(record?.[field] || '').trim();
    if (value) ids.add(value);
  }
  if (Array.isArray(record?.equipmentIds)) {
    record.equipmentIds.forEach(value => {
      const id = String(value || '').trim();
      if (id) ids.add(id);
    });
  }
  if (Array.isArray(record?.equipment)) {
    record.equipment.forEach(value => {
      if (typeof value === 'object') {
        const id = String(value?.id || value?.equipmentId || '').trim();
        if (id) ids.add(id);
      }
    });
  }
  return [...ids];
}

function getEquipmentInv(record) {
  return String(record?.equipmentInv || record?.inventoryNumber || record?.inventoryNo || record?.equipmentInventoryNumber || '').trim();
}

function equipmentLabel(equipment) {
  return [
    equipment?.manufacturer,
    equipment?.model,
    getEquipmentInv(equipment) ? `INV ${getEquipmentInv(equipment)}` : '',
  ].filter(Boolean).join(' / ') || String(equipment?.name || equipment?.title || equipment?.id || 'Техника без названия');
}

function getEquipmentFinanceRecord(equipment, financeByEquipmentId) {
  const id = String(equipment?.id || '').trim();
  const nested = equipment?.finance || equipment?.equipmentFinance || equipment?.depreciation || {};
  return {
    ...nested,
    ...(id ? financeByEquipmentId.get(id) || {} : {}),
  };
}

function financeNumber(record, fields) {
  for (const field of fields) {
    const value = toNumber(record?.[field]);
    if (value > 0) return value;
  }
  return 0;
}

function getMonthlyDepreciation(equipment, financeRecord) {
  return financeNumber(financeRecord, [
    'monthlyDepreciation',
    'depreciationMonthly',
    'monthlyDepreciationAmount',
    'depreciationPerMonth',
    'amountPerMonth',
  ]) || financeNumber(equipment, [
    'monthlyDepreciation',
    'depreciationMonthly',
    'monthlyDepreciationAmount',
  ]);
}

function getPurchaseCost(equipment, financeRecord) {
  return financeNumber(financeRecord, [
    'purchasePrice',
    'purchaseCost',
    'acquisitionCost',
    'initialCost',
    'bookValue',
  ]) || financeNumber(equipment, [
    'purchasePrice',
    'purchaseCost',
    'saleCostPrice',
    'costPrice',
  ]);
}

function getResidualValue(equipment, financeRecord) {
  const value = financeNumber(financeRecord, ['residualValue', 'currentResidualValue', 'bookResidualValue'])
    || financeNumber(equipment, ['residualValue', 'currentResidualValue']);
  return value > 0 ? value : null;
}

function normalizeEquipmentGroup(status) {
  const value = normalizeStatus(status);
  if (['rented', 'active_rental'].includes(value)) return 'rented';
  if (['in_service', 'service', 'repair', 'maintenance'].includes(value)) return 'service';
  if (['sale', 'for_sale', 'sold'].includes(value)) return 'sale';
  return 'idle';
}

function isStatusActive(status) {
  return !['archived', 'deleted', 'cancelled', 'canceled', 'closed', 'inactive'].includes(normalizeStatus(status));
}

function getExpenseDate(row) {
  return dateText(row?.date || row?.paidDate || row?.dueDate || row?.nextPaymentDate || row?.createdAt?.slice?.(0, 10));
}

function getExpenseAmount(row) {
  return Math.max(0, toNumber(row?.amount ?? row?.paidAmount ?? row?.totalCost ?? row?.cost));
}

function getServiceExpenseAmount(ticket) {
  const result = ticket?.resultData || {};
  const partCosts = (result.partsUsed || ticket?.parts || []).reduce((sum, part) => {
    const qty = toNumber(part?.qty ?? part?.quantity);
    const cost = toNumber(part?.cost ?? part?.price ?? part?.priceSnapshot);
    return sum + (qty > 0 && cost > 0 ? qty * cost : cost);
  }, 0);
  const workCosts = (result.worksPerformed || []).reduce((sum, work) => sum + toNumber(work?.totalCost ?? work?.amount), 0);
  return partCosts + workCosts + toNumber(ticket?.amount ?? ticket?.cost ?? ticket?.serviceCost);
}

function buildCompanyEconomics(input = {}, rawOptions = {}) {
  const today = new Date();
  const defaultDateFrom = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1)).toISOString().slice(0, 10);
  const defaultDateTo = today.toISOString().slice(0, 10);
  const options = {
    dateFrom: dateText(rawOptions.dateFrom) || defaultDateFrom,
    dateTo: dateText(rawOptions.dateTo) || defaultDateTo,
    groupBy: ECONOMICS_GROUPS.has(rawOptions.groupBy) ? rawOptions.groupBy : 'month',
    includeDepreciation: rawOptions.includeDepreciation !== false,
    includeVat: rawOptions.includeVat === true,
    equipmentGroup: EQUIPMENT_GROUPS.has(rawOptions.equipmentGroup) ? rawOptions.equipmentGroup : 'all',
  };
  const warnings = [{
    level: 'info',
    message: 'Управленческая экономика. Не является бухгалтерской отчётностью.',
  }];
  if (!options.includeVat) {
    warnings.push({ level: 'info', message: 'НДС не выделяется в MVP-расчёте экономики.' });
  }

  const periods = seedPeriods(options.dateFrom, options.dateTo, options.groupBy);
  const financeByEquipmentId = new Map((input.equipmentFinance || input.equipment_finance || [])
    .filter(item => item?.equipmentId || item?.equipment_id)
    .map(item => [String(item.equipmentId || item.equipment_id), item]));
  const equipmentRows = (input.equipment || [])
    .filter(item => item?.activeInFleet !== false)
    .filter(item => options.equipmentGroup === 'all' || normalizeEquipmentGroup(item?.status) === options.equipmentGroup)
    .map(item => {
      const financeRecord = getEquipmentFinanceRecord(item, financeByEquipmentId);
      const monthlyDepreciation = getMonthlyDepreciation(item, financeRecord);
      const purchaseCost = getPurchaseCost(item, financeRecord);
      const residualValue = getResidualValue(item, financeRecord);
      return {
        equipmentId: String(item?.id || '').trim(),
        label: equipmentLabel(item),
        inv: getEquipmentInv(item),
        statusGroup: normalizeEquipmentGroup(item?.status),
        revenue: 0,
        expenses: 0,
        serviceExpenses: 0,
        depreciation: options.includeDepreciation ? Math.round(monthlyDepreciation * monthCountInRange(options.dateFrom, options.dateTo)) : 0,
        purchaseCost,
        residualValue,
        configuredDepreciation: monthlyDepreciation > 0,
      };
    });
  const equipmentById = new Map(equipmentRows.filter(item => item.equipmentId).map(item => [item.equipmentId, item]));
  const equipmentByInv = new Map(equipmentRows.filter(item => item.inv).map(item => [item.inv, item]));

  function resolveEquipment(record) {
    for (const id of collectEquipmentIds(record)) {
      if (equipmentById.has(id)) return equipmentById.get(id);
    }
    const inv = getEquipmentInv(record);
    if (inv && equipmentByInv.has(inv)) return equipmentByInv.get(inv);
    return null;
  }

  const rentals = [];
  const seenRentals = new Set();
  for (const rental of [...(input.rentals || []), ...(input.ganttRentals || input.gantt_rentals || [])]) {
    if (!shouldCountRental(rental)) continue;
    const key = getRentalDedupeKey(rental);
    if (seenRentals.has(key)) continue;
    seenRentals.add(key);
    rentals.push(rental);
  }
  if ((input.rentals || []).length && (input.ganttRentals || input.gantt_rentals || []).length) {
    warnings.push({ level: 'info', message: 'Аренды из rentals и gantt_rentals дедуплицированы по стабильному rentalId.' });
  }

  let revenueTotal = 0;
  for (const rental of rentals) {
    const start = getRentalStart(rental);
    const end = getRentalEnd(rental);
    const overlap = overlapDays(start, end, options.dateFrom, options.dateTo);
    if (overlap <= 0) continue;
    const totalDays = Math.max(1, daysInclusive(start, end));
    const amount = Math.round(getRentalBillingAmount(rental) * (overlap / totalDays));
    if (amount <= 0) continue;
    revenueTotal += amount;
    addPeriodValue(periods, start < options.dateFrom ? options.dateFrom : start, options.groupBy, 'revenue', amount);
    const row = resolveEquipment(rental);
    if (row) row.revenue += amount;
  }

  const cashInTotal = (input.payments || [])
    .filter(payment => shouldCountPayment(payment))
    .filter(payment => {
      const date = getExpenseDate(payment);
      return date && date >= options.dateFrom && date <= options.dateTo;
    })
    .reduce((sum, payment) => sum + getEffectivePaidAmount(payment), 0);

  let serviceExpensesTotal = 0;
  for (const ticket of input.service || input.serviceTickets || []) {
    const date = getExpenseDate(ticket);
    if (!date || date < options.dateFrom || date > options.dateTo) continue;
    const amount = getServiceExpenseAmount(ticket);
    if (amount <= 0) continue;
    serviceExpensesTotal += amount;
    addPeriodValue(periods, date, options.groupBy, 'expenses', amount);
    const row = resolveEquipment(ticket);
    if (row) {
      row.expenses += amount;
      row.serviceExpenses += amount;
    }
  }

  for (const item of input.repairWorkItems || input.repair_work_items || []) {
    const date = getExpenseDate(item);
    if (!date || date < options.dateFrom || date > options.dateTo) continue;
    const amount = getExpenseAmount(item);
    if (amount <= 0) continue;
    serviceExpensesTotal += amount;
    addPeriodValue(periods, date, options.groupBy, 'expenses', amount);
    const row = resolveEquipment(item);
    if (row) {
      row.expenses += amount;
      row.serviceExpenses += amount;
    }
  }

  for (const item of input.repairPartItems || input.repair_part_items || []) {
    const date = getExpenseDate(item);
    if (!date || date < options.dateFrom || date > options.dateTo) continue;
    const quantity = Math.max(1, toNumber(item?.quantity));
    const amount = getExpenseAmount(item) * quantity;
    if (amount <= 0) continue;
    serviceExpensesTotal += amount;
    addPeriodValue(periods, date, options.groupBy, 'expenses', amount);
    const row = resolveEquipment(item);
    if (row) {
      row.expenses += amount;
      row.serviceExpenses += amount;
    }
  }

  let companyExpensesTotal = 0;
  for (const expense of input.companyExpenses || input.company_expenses || []) {
    if (!isStatusActive(expense?.status)) continue;
    const amount = toNumber(expense?.amount);
    if (amount <= 0) continue;
    const monthly = expense?.frequency === 'yearly' ? amount / 12 : expense?.frequency === 'quarterly' ? amount / 3 : amount;
    const total = Math.round(monthly * monthCountInRange(options.dateFrom, options.dateTo));
    if (total <= 0) continue;
    companyExpensesTotal += total;
    addPeriodValue(periods, options.dateFrom, options.groupBy, 'expenses', total);
    const row = resolveEquipment(expense);
    if (row) row.expenses += total;
  }

  for (const operation of input.financeOperations || input.finance_operations || []) {
    if (operation?.type !== 'expense' || normalizeStatus(operation?.status) === 'archived') continue;
    const date = getExpenseDate(operation);
    if (!date || date < options.dateFrom || date > options.dateTo) continue;
    const amount = getExpenseAmount(operation);
    if (amount <= 0) continue;
    companyExpensesTotal += amount;
    addPeriodValue(periods, date, options.groupBy, 'expenses', amount);
    const row = resolveEquipment(operation);
    if (row) row.expenses += amount;
  }

  let leasingExpensesTotal = 0;
  for (const item of input.leasingPaymentSchedule || input.leasing_payment_schedule || []) {
    const date = dateText(item?.dueDate || item?.paidDate);
    if (!date || date < options.dateFrom || date > options.dateTo || normalizeStatus(item?.status) === 'skipped') continue;
    const amount = toNumber(item?.outstanding ?? item?.amount);
    if (amount <= 0) continue;
    leasingExpensesTotal += amount;
    addPeriodValue(periods, date, options.groupBy, 'expenses', amount);
  }

  let deliveryExpensesTotal = 0;
  for (const item of input.deliveries || []) {
    const date = getExpenseDate(item);
    if (!date || date < options.dateFrom || date > options.dateTo) continue;
    const amount = toNumber(item?.cost ?? item?.amount ?? item?.price);
    if (amount <= 0) continue;
    deliveryExpensesTotal += amount;
    addPeriodValue(periods, date, options.groupBy, 'expenses', amount);
    const row = resolveEquipment(item);
    if (row) row.expenses += amount;
  }

  for (const row of equipmentRows) {
    if (row.depreciation > 0) addPeriodValue(periods, options.dateFrom, options.groupBy, 'depreciation', row.depreciation);
  }

  const depreciationTotal = equipmentRows.reduce((sum, row) => sum + row.depreciation, 0);
  const directExpensesTotal = serviceExpensesTotal + deliveryExpensesTotal + leasingExpensesTotal + companyExpensesTotal;
  const profitBeforeDepreciation = revenueTotal - directExpensesTotal;
  const profitAfterDepreciation = profitBeforeDepreciation - depreciationTotal;
  const notConfiguredDepreciationCount = equipmentRows.filter(row => !row.configuredDepreciation).length;
  if (notConfiguredDepreciationCount > 0) {
    warnings.push({
      level: 'warning',
      message: `Амортизация не настроена по ${notConfiguredDepreciationCount} единицам техники.`,
    });
  }
  if (revenueTotal === 0 && directExpensesTotal === 0) {
    warnings.push({ level: 'info', message: 'Недостаточно данных для точного расчёта.' });
  }

  const equipment = equipmentRows
    .map(row => {
      const profitBefore = row.revenue - row.expenses;
      const profitAfter = profitBefore - row.depreciation;
      const paybackPercent = row.purchaseCost > 0 ? Math.round((Math.max(0, row.revenue - row.expenses) / row.purchaseCost) * 1000) / 10 : null;
      const status = !row.configuredDepreciation
        ? 'not_configured'
        : profitAfter < 0
          ? 'loss'
          : row.revenue > 0 || row.expenses > 0
            ? 'profitable'
            : 'unknown';
      const recommendation = status === 'not_configured'
        ? 'Настроить амортизацию для точного управленческого результата.'
        : status === 'loss'
          ? 'Проверить ставку аренды, простой и сервисные расходы.'
          : status === 'profitable'
            ? 'Экономика положительная за выбранный период.'
            : 'Недостаточно данных для точного расчёта.';
      return {
        equipmentId: row.equipmentId,
        label: row.label,
        revenue: Math.round(row.revenue),
        expenses: Math.round(row.expenses),
        serviceExpenses: Math.round(row.serviceExpenses),
        depreciation: Math.round(row.depreciation),
        profitBeforeDepreciation: Math.round(profitBefore),
        profitAfterDepreciation: Math.round(profitAfter),
        paybackPercent,
        residualValue: row.residualValue,
        status,
        recommendation,
      };
    })
    .sort((left, right) => right.profitAfterDepreciation - left.profitAfterDepreciation || left.label.localeCompare(right.label, 'ru'));

  const paybackRows = equipmentRows.filter(row => row.purchaseCost > 0);
  const paybackProgressPercent = paybackRows.length
    ? Math.round((paybackRows.reduce((sum, row) => sum + Math.max(0, row.revenue - row.expenses), 0) / paybackRows.reduce((sum, row) => sum + row.purchaseCost, 0)) * 1000) / 10
    : null;

  return {
    summary: {
      revenueTotal: Math.round(revenueTotal),
      cashInTotal: Math.round(cashInTotal),
      directExpensesTotal: Math.round(directExpensesTotal),
      serviceExpensesTotal: Math.round(serviceExpensesTotal),
      deliveryExpensesTotal: Math.round(deliveryExpensesTotal),
      leasingExpensesTotal: Math.round(leasingExpensesTotal),
      companyExpensesTotal: Math.round(companyExpensesTotal),
      depreciationTotal: Math.round(depreciationTotal),
      profitBeforeDepreciation: Math.round(profitBeforeDepreciation),
      profitAfterDepreciation: Math.round(profitAfterDepreciation),
      marginBeforeDepreciationPercent: revenueTotal > 0 ? Math.round((profitBeforeDepreciation / revenueTotal) * 1000) / 10 : 0,
      marginAfterDepreciationPercent: revenueTotal > 0 ? Math.round((profitAfterDepreciation / revenueTotal) * 1000) / 10 : 0,
      paybackProgressPercent,
      equipmentCount: equipmentRows.length,
      profitableEquipmentCount: equipment.filter(row => row.status === 'profitable').length,
      lossMakingEquipmentCount: equipment.filter(row => row.status === 'loss').length,
      notConfiguredDepreciationCount,
    },
    periods: Array.from(periods.values())
      .map(period => ({
        ...period,
        revenue: Math.round(period.revenue),
        expenses: Math.round(period.expenses),
        depreciation: Math.round(period.depreciation),
        profitBeforeDepreciation: Math.round(period.revenue - period.expenses),
        profitAfterDepreciation: Math.round(period.revenue - period.expenses - period.depreciation),
      }))
      .sort((left, right) => left.period.localeCompare(right.period)),
    equipment,
    warnings,
  };
}

module.exports = {
  shouldCountPayment,
  shouldCountRental,
  getEffectivePaidAmount,
  getPaymentAllocationCap,
  getRentalDebtOverdueDays,
  buildRentalDebtRows,
  calculateRentalBilling,
  getRentalBillingAmount,
  buildClientReceivables,
  buildClientFinancialSnapshots,
  buildManagerReceivables,
  buildOverdueBuckets,
  buildClientDebtAgingRows,
  buildClientObjectDebtBreakdown,
  buildDebtSummaryRows,
  buildUnallocatedPayments,
  buildAllocationPreview,
  backfillPaymentAllocations,
  buildFinanceReport,
  buildCompanyEconomics,
};
