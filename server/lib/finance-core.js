const {
  getStableClientId,
  normalizeText,
} = require('./client-links');

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

function getEffectivePaidAmount(payment) {
  if (!shouldCountPayment(payment)) return 0;
  if (typeof payment?.paidAmount === 'number') return Math.max(0, payment.paidAmount);
  if (payment?.status === 'paid') return Math.max(0, toNumber(payment.amount));
  return 0;
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

function buildRentalDebtRows(rentals, payments) {
  const byRentalId = new Map();
  const seenPaymentIds = new Set();
  (payments || []).forEach(payment => {
    // IMPORTANT: payment impact is joined through rentalId. Client names are editable labels
    // and must not become financial foreign keys for debt calculations.
    if (!payment?.rentalId) return;
    if (!shouldCountPayment(payment)) return;
    if (payment.id) {
      const paymentId = String(payment.id);
      if (seenPaymentIds.has(paymentId)) return;
      seenPaymentIds.add(paymentId);
    }
    if (!byRentalId.has(payment.rentalId)) byRentalId.set(payment.rentalId, []);
    byRentalId.get(payment.rentalId).push(payment);
  });

  return (rentals || [])
    .map(rental => {
      const relatedPayments = byRentalId.get(rental.id) || [];
      const paidAmount = relatedPayments.reduce((sum, payment) => sum + getEffectivePaidAmount(payment), 0);
      const amount = toNumber(rental.amount);
      const outstanding = Math.max(0, amount - paidAmount);
      return {
        rentalId: rental.id,
        clientId: getStableClientId(rental) || '',
        client: getClientName(rental),
        equipmentId: rental.equipmentId || '',
        equipmentInv: rental.equipmentInv || '',
        manager: rental.manager || '',
        startDate: rental.startDate || '',
        endDate: rental.endDate || '',
        expectedPaymentDate: rental.expectedPaymentDate || '',
        amount,
        paidAmount,
        outstanding,
        paymentStatus: rental.paymentStatus || 'unpaid',
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

function buildClientFinancialSnapshots(clients, rentals, payments, today = new Date().toISOString().slice(0, 10)) {
  const debtRows = buildRentalDebtRows(rentals, payments);
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

function buildFinanceReport({ clients, rentals, payments }, today = new Date().toISOString().slice(0, 10)) {
  const debtRows = buildRentalDebtRows(rentals, payments);
  const clientReceivables = buildClientReceivables(clients, debtRows, today);
  const clientSnapshots = buildClientFinancialSnapshots(clients, rentals, payments, today);
  const managerReceivables = buildManagerReceivables(debtRows, today, clients);
  const overdueBuckets = buildOverdueBuckets(debtRows, today);
  const clientDebtAgingRows = buildClientDebtAgingRows(clients, debtRows, today);

  return {
    debtRows,
    clientReceivables,
    clientSnapshots,
    managerReceivables,
    overdueBuckets,
    clientDebtAgingRows,
    totals: {
      debt: clientSnapshots.reduce((sum, item) => sum + item.currentDebt, 0),
      overdueClients: clientSnapshots.filter(item => item.overdueRentals > 0).length,
      exceededClients: clientSnapshots.filter(item => item.exceededLimit).length,
      unpaidRentals: debtRows.length,
      overdueDebt: managerReceivables.reduce((sum, item) => sum + item.overdueDebt, 0),
    },
  };
}

module.exports = {
  getRentalDebtOverdueDays,
  buildRentalDebtRows,
  buildClientReceivables,
  buildClientFinancialSnapshots,
  buildManagerReceivables,
  buildOverdueBuckets,
  buildClientDebtAgingRows,
  buildFinanceReport,
};
