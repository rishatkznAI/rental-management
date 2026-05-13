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
};
