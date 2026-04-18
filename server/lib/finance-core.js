function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function getEffectivePaidAmount(payment) {
  if (typeof payment?.paidAmount === 'number') return payment.paidAmount;
  if (payment?.status === 'paid') return toNumber(payment.amount);
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

function buildRentalDebtRows(rentals, payments) {
  const byRentalId = new Map();
  (payments || []).forEach(payment => {
    if (!payment?.rentalId) return;
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
        client: rental.client || '',
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

function buildClientReceivables(clients, rentalDebtRows, today = new Date().toISOString().slice(0, 10)) {
  const clientsByName = new Map((clients || []).map(client => [client.company, client]));
  const map = new Map();

  (rentalDebtRows || []).forEach(row => {
    const existing = map.get(row.client) || {
      clientId: clientsByName.get(row.client)?.id,
      client: row.client,
      creditLimit: toNumber(clientsByName.get(row.client)?.creditLimit),
      currentDebt: 0,
      unpaidRentals: 0,
      overdueRentals: 0,
      exceededLimit: false,
    };
    existing.currentDebt += row.outstanding;
    existing.unpaidRentals += 1;
    if ((row.expectedPaymentDate && row.expectedPaymentDate < today) || row.endDate < today) {
      existing.overdueRentals += 1;
    }
    existing.exceededLimit = existing.creditLimit > 0 && existing.currentDebt > existing.creditLimit;
    map.set(row.client, existing);
  });

  return Array.from(map.values()).sort((a, b) => b.currentDebt - a.currentDebt || a.client.localeCompare(b.client, 'ru'));
}

function buildClientFinancialSnapshots(clients, rentals, payments, today = new Date().toISOString().slice(0, 10)) {
  const debtRows = buildRentalDebtRows(rentals, payments);
  const receivables = buildClientReceivables(clients, debtRows, today);
  const receivableMap = new Map(receivables.map(item => [item.client, item]));

  return (clients || [])
    .map(client => {
      const clientRentals = (rentals || []).filter(item => item.client === client.company);
      const latestRental = clientRentals
        .slice()
        .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];
      const receivable = receivableMap.get(client.company);
      return {
        clientId: client.id,
        client: client.company,
        creditLimit: toNumber(client.creditLimit),
        currentDebt: receivable?.currentDebt || 0,
        unpaidRentals: receivable?.unpaidRentals || 0,
        overdueRentals: receivable?.overdueRentals || 0,
        exceededLimit: receivable?.exceededLimit || false,
        totalRentals: clientRentals.length,
        activeRentals: clientRentals.filter(item => item.status === 'active' || item.status === 'created').length,
        lastRentalDate: latestRental?.startDate || client.lastRentalDate || '',
      };
    })
    .sort((a, b) => b.currentDebt - a.currentDebt || a.client.localeCompare(b.client, 'ru'));
}

function buildManagerReceivables(rentalDebtRows, today = new Date().toISOString().slice(0, 10)) {
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
    item.clients.add(row.client);
    item.clientsCount = item.clients.size;
    map.set(key, item);
  });

  return Array.from(map.values())
    .map(({ clients, ...rest }) => rest)
    .sort((a, b) => b.currentDebt - a.currentDebt || a.manager.localeCompare(b.manager, 'ru'));
}

function buildOverdueBuckets(rentalDebtRows, today = new Date().toISOString().slice(0, 10)) {
  const buckets = [
    { key: '1_7', label: '1-7 дней', rentals: 0, debt: 0 },
    { key: '8_14', label: '8-14 дней', rentals: 0, debt: 0 },
    { key: '15_30', label: '15-30 дней', rentals: 0, debt: 0 },
    { key: '31_60', label: '31-60 дней', rentals: 0, debt: 0 },
    { key: '61_plus', label: '61+ дней', rentals: 0, debt: 0 },
  ];

  (rentalDebtRows || []).forEach(row => {
    const overdueDays = getRentalDebtOverdueDays(row, today);
    if (overdueDays <= 0) return;
    const bucket =
      overdueDays <= 7 ? buckets[0] :
      overdueDays <= 14 ? buckets[1] :
      overdueDays <= 30 ? buckets[2] :
      overdueDays <= 60 ? buckets[3] :
      buckets[4];
    bucket.rentals += 1;
    bucket.debt += row.outstanding;
  });

  return buckets;
}

function buildFinanceReport({ clients, rentals, payments }, today = new Date().toISOString().slice(0, 10)) {
  const debtRows = buildRentalDebtRows(rentals, payments);
  const clientReceivables = buildClientReceivables(clients, debtRows, today);
  const clientSnapshots = buildClientFinancialSnapshots(clients, rentals, payments, today);
  const managerReceivables = buildManagerReceivables(debtRows, today);
  const overdueBuckets = buildOverdueBuckets(debtRows, today);

  return {
    debtRows,
    clientReceivables,
    clientSnapshots,
    managerReceivables,
    overdueBuckets,
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
  buildFinanceReport,
};
