const { calculateVatBreakdown } = require('./vat-calculator');
const { calculateEquipmentDepreciation } = require('./equipment-depreciation');
const { buildRentalDebtRows } = require('./finance-core');

function toNumber(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : 0;
}

function dateOnly(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function inRange(date, from, to) {
  return date && (!from || date >= from) && (!to || date <= to);
}

function weekKey(value) {
  const date = new Date(`${value}T00:00:00.000Z`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil((((date - yearStart) / 86400000) + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

function groupKey(date, groupBy) {
  if (groupBy === 'month') return date.slice(0, 7);
  if (groupBy === 'week') return weekKey(date);
  return date;
}

function recurringExpenseDueDate(expense, from) {
  if (dateOnly(expense.nextPaymentDate)) return dateOnly(expense.nextPaymentDate);
  const day = Math.min(28, Math.max(1, Math.round(toNumber(expense.paymentDay) || 1)));
  const base = new Date(`${from}T00:00:00.000Z`);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function decorateVat(amount, settings, date, includeVat, direction) {
  const breakdown = calculateVatBreakdown(amount, { companySettings: settings, date });
  if (!includeVat) return { ...breakdown, grossAmount: breakdown.netAmount };
  if (direction === 'outgoing' && settings?.inputVatEnabled !== true) {
    return { ...breakdown, vatAmount: 0, vatApplied: false, reason: 'input_vat_disabled' };
  }
  return breakdown;
}

function makeItem(input, settings, includeVat) {
  const vat = decorateVat(input.amount, settings, input.date, includeVat, input.direction);
  return {
    id: input.id,
    date: input.date,
    type: input.type,
    source: input.source,
    direction: input.direction,
    amount: includeVat ? vat.grossAmount : vat.netAmount,
    netAmount: vat.netAmount,
    vatAmount: vat.vatAmount,
    vatRate: vat.vatRate,
    status: input.status || '',
    clientName: input.clientName || '',
    description: input.description || '',
    link: input.link || '',
    reason: vat.reason,
  };
}

function buildCashFlow(payload = {}, options = {}) {
  const from = dateOnly(options.dateFrom) || new Date().toISOString().slice(0, 10);
  const to = dateOnly(options.dateTo) || from;
  const groupBy = ['day', 'week', 'month'].includes(options.groupBy) ? options.groupBy : 'month';
  const mode = ['expected', 'factual', 'all'].includes(options.mode) ? options.mode : 'all';
  const includeVat = options.includeVat !== false;
  const includeDepreciation = options.includeDepreciation === true;
  const settings = payload.companyTaxSettings || {};
  const warnings = [];
  const items = [];

  if (!settings.taxRegime) warnings.push('Не выбран тип налогообложения: НДС показан как управленческая оценка без налогового статуса.');

  if (mode !== 'expected') {
    for (const payment of payload.payments || []) {
      const paidAmount = toNumber(payment.paidAmount ?? (payment.status === 'paid' ? payment.amount : 0));
      const date = dateOnly(payment.paidDate || payment.date || payment.dueDate);
      if (paidAmount > 0 && inRange(date, from, to)) {
        items.push(makeItem({
          id: `payment:${payment.id}`,
          date,
          type: 'payment',
          source: 'payments',
          direction: 'incoming',
          amount: paidAmount,
          status: payment.status || 'paid',
          clientName: payment.client || payment.clientName || '',
          description: payment.invoiceNumber ? `Оплата ${payment.invoiceNumber}` : 'Оплата клиента',
          link: payment.rentalId ? `/rentals/${payment.rentalId}` : '',
        }, settings, includeVat));
      }
    }
    for (const operation of payload.financeOperations || []) {
      const date = dateOnly(operation.date);
      if (operation.status === 'archived' || operation.type === 'transfer' || !inRange(date, from, to)) continue;
      items.push(makeItem({
        id: `operation:${operation.id}`,
        date,
        type: operation.type === 'income' ? 'manual_income' : 'manual_expense',
        source: 'finance_operations',
        direction: operation.type === 'income' ? 'incoming' : 'outgoing',
        amount: toNumber(operation.amount),
        status: operation.status || 'active',
        clientName: operation.counterparty || '',
        description: operation.description || operation.category || 'Финансовая операция',
        link: operation.relatedEntityType && operation.relatedEntityId ? `/${operation.relatedEntityType}/${operation.relatedEntityId}` : '',
      }, settings, includeVat));
    }
  }

  if (mode !== 'factual') {
    const debtRows = buildRentalDebtRows(payload.rentals || [], payload.payments || [], { paymentAllocations: payload.paymentAllocations || [] });
    for (const row of debtRows) {
      const date = dateOnly(row.expectedPaymentDate || row.endDate);
      if (row.outstanding > 0 && inRange(date, from, to)) {
        items.push(makeItem({
          id: `rental:${row.rentalId}`,
          date,
          type: 'expected_rental',
          source: 'rentals',
          direction: 'incoming',
          amount: row.outstanding,
          status: row.paymentStatus,
          clientName: row.client,
          description: `Ожидаемая оплата аренды ${row.rentalId}`,
          link: `/rentals/${row.rentalId}`,
        }, settings, includeVat));
      }
    }
    for (const expense of payload.companyExpenses || []) {
      if (expense.status !== 'active') continue;
      const date = recurringExpenseDueDate(expense, from);
      if (!inRange(date, from, to)) continue;
      items.push(makeItem({
        id: `expense:${expense.id}`,
        date,
        type: 'company_expense',
        source: 'company_expenses',
        direction: 'outgoing',
        amount: toNumber(expense.amount),
        status: expense.status,
        clientName: expense.counterparty || '',
        description: expense.name || expense.category || 'Постоянный расход',
      }, settings, includeVat));
    }
    for (const payment of payload.leasingPaymentSchedule || []) {
      const date = dateOnly(payment.dueDate);
      if (['paid', 'skipped', 'cancelled'].includes(String(payment.status || '').toLowerCase()) || !inRange(date, from, to)) continue;
      items.push(makeItem({
        id: `leasing:${payment.id}`,
        date,
        type: 'leasing',
        source: 'leasing_payment_schedule',
        direction: 'outgoing',
        amount: toNumber(payment.outstanding ?? payment.amount),
        status: payment.status || 'planned',
        description: payment.comment || 'Лизинговый платёж',
        link: payment.leasingContractId ? `/finance?leasing=${payment.leasingContractId}` : '',
      }, settings, includeVat));
    }
  }

  let depreciationTotal = 0;
  if (includeDepreciation) {
    for (const finance of payload.equipmentFinance || []) {
      const depreciation = calculateEquipmentDepreciation(finance, to);
      if (depreciation.status !== 'configured' || depreciation.monthlyDepreciation <= 0) continue;
      depreciationTotal += depreciation.monthlyDepreciation;
      items.push({
        id: `depreciation:${finance.equipmentId}`,
        date: to,
        type: 'depreciation',
        source: 'equipment_finance',
        direction: 'outgoing',
        amount: depreciation.monthlyDepreciation,
        netAmount: depreciation.monthlyDepreciation,
        vatAmount: 0,
        vatRate: 0,
        status: 'management_estimate',
        clientName: '',
        description: `Управленческая амортизация ${finance.equipmentId}`,
        link: `/equipment/${finance.equipmentId}`,
      });
    }
  }

  items.sort((left, right) => left.date.localeCompare(right.date) || left.id.localeCompare(right.id));

  const openingBalance = (payload.financeAccounts || [])
    .filter(account => account.status !== 'archived')
    .reduce((sum, account) => sum + toNumber(account.balance), 0);
  let running = openingBalance;
  const periodMap = new Map();
  for (const item of items) {
    const key = groupKey(item.date, groupBy);
    if (!periodMap.has(key)) {
      periodMap.set(key, {
        period: key,
        incoming: 0,
        outgoing: 0,
        net: 0,
        vatIncoming: 0,
        vatOutgoing: 0,
        vatPayableEstimate: 0,
        depreciation: 0,
        closingBalanceForecast: openingBalance,
      });
    }
    const period = periodMap.get(key);
    if (item.direction === 'incoming') {
      period.incoming += item.amount;
      period.vatIncoming += item.vatAmount;
    } else {
      period.outgoing += item.amount;
      period.vatOutgoing += item.vatAmount;
    }
    if (item.type === 'depreciation') period.depreciation += item.amount;
  }

  const periods = Array.from(periodMap.values()).sort((left, right) => left.period.localeCompare(right.period));
  for (const period of periods) {
    period.net = period.incoming - period.outgoing;
    period.vatPayableEstimate = Math.max(0, period.vatIncoming - period.vatOutgoing);
    running += period.net;
    period.closingBalanceForecast = running;
  }

  const incomingTotal = items.filter(item => item.direction === 'incoming').reduce((sum, item) => sum + item.amount, 0);
  const outgoingTotal = items.filter(item => item.direction === 'outgoing').reduce((sum, item) => sum + item.amount, 0);
  const overdueReceivables = buildRentalDebtRows(payload.rentals || [], payload.payments || [], { paymentAllocations: payload.paymentAllocations || [] })
    .filter(row => dateOnly(row.expectedPaymentDate || row.endDate) && dateOnly(row.expectedPaymentDate || row.endDate) < from)
    .reduce((sum, row) => sum + row.outstanding, 0);

  return {
    summary: {
      openingBalance,
      incomingTotal,
      outgoingTotal,
      netCashFlow: incomingTotal - outgoingTotal,
      closingBalanceForecast: openingBalance + incomingTotal - outgoingTotal,
      overdueReceivables,
      upcomingPayments: items.filter(item => item.direction === 'outgoing').reduce((sum, item) => sum + item.amount, 0),
      vatPayableEstimate: Math.max(0, items.filter(item => item.direction === 'incoming').reduce((sum, item) => sum + item.vatAmount, 0)
        - items.filter(item => item.direction === 'outgoing').reduce((sum, item) => sum + item.vatAmount, 0)),
      depreciationTotal,
    },
    periods,
    items,
    warnings,
  };
}

module.exports = {
  buildCashFlow,
  groupKey,
};
