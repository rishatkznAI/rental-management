const DAY_MS = 24 * 60 * 60 * 1000;

const CONTRACT_STATUSES = new Set(['active', 'closed', 'paused', 'overdue', 'archived']);
const PAYMENT_STATUSES = new Set(['planned', 'paid', 'overdue', 'skipped']);

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function toNumber(value, fallback = 0) {
  if (value === '' || value == null) return fallback;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

function toNonNegativeNumber(value, fallback = 0) {
  return Math.max(0, toNumber(value, fallback));
}

function toPositiveInteger(value, fallback = 1) {
  const numeric = Math.trunc(toNumber(value, fallback));
  return numeric > 0 ? numeric : fallback;
}

function parseDateKey(value) {
  const text = String(value || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
  const date = new Date(`${text}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ? '' : text;
}

function monthKey(value) {
  const date = parseDateKey(value);
  return date ? date.slice(0, 7) : '';
}

function daysInMonth(year, monthIndex) {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

function clampPaymentDay(year, monthIndex, paymentDay) {
  return Math.min(Math.max(1, paymentDay), daysInMonth(year, monthIndex));
}

function buildMonthDate(year, monthIndex, paymentDay) {
  const day = clampPaymentDay(year, monthIndex, paymentDay);
  return new Date(Date.UTC(year, monthIndex, day)).toISOString().slice(0, 10);
}

function addMonths(dateKey, offset) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  return {
    year: date.getUTCFullYear(),
    monthIndex: date.getUTCMonth() + offset,
  };
}

function normalizeStatus(value, fallback, allowed) {
  const status = String(value || '').trim().toLowerCase();
  return allowed.has(status) ? status : fallback;
}

function normalizeLeasingPaymentScheduleRow(row, contract, index = 0) {
  const dueDate = parseDateKey(row?.dueDate);
  if (!dueDate) throw new Error('Укажите корректную дату платежа.');
  const amount = toNonNegativeNumber(row?.amount);
  if (!Number.isFinite(amount)) throw new Error('Сумма платежа должна быть числом.');
  const status = normalizeStatus(row?.status, 'planned', PAYMENT_STATUSES);
  const paidAmount = toNonNegativeNumber(row?.paidAmount);
  const paidDate = parseDateKey(row?.paidDate);
  return {
    id: row?.id || `LPS-${contract.id}-${index + 1}`,
    leasingContractId: row?.leasingContractId || contract.id,
    dueDate,
    amount,
    status,
    paidDate: paidDate || undefined,
    paidAmount,
    comment: String(row?.comment || '').trim() || undefined,
  };
}

function isLeasingContractFinanciallyActive(contract) {
  const status = String(contract?.status || 'active').trim().toLowerCase();
  return status === 'active' || status === 'overdue';
}

function buildGeneratedSchedule(contract) {
  const startDate = parseDateKey(contract?.startDate);
  if (!startDate || contract.status === 'closed' || contract.status === 'archived') return [];
  const termMonths = toPositiveInteger(contract?.termMonths, 1);
  const paymentDay = Math.min(31, Math.max(1, toPositiveInteger(contract?.paymentDay, 1)));
  const monthlyPayment = toNonNegativeNumber(contract?.monthlyPayment);
  const rows = [];
  let monthOffset = 0;

  while (rows.length < termMonths && monthOffset < termMonths + 2) {
    const { year, monthIndex } = addMonths(startDate, monthOffset);
    const dueDate = buildMonthDate(year, monthIndex, paymentDay);
    monthOffset += 1;
    if (dueDate < startDate) continue;
    rows.push({
      id: `${contract.id}-payment-${rows.length + 1}`,
      leasingContractId: contract.id,
      dueDate,
      amount: monthlyPayment,
      status: 'planned',
      paidAmount: 0,
    });
  }

  if (toNonNegativeNumber(contract?.buyoutPayment) > 0 && parseDateKey(contract?.endDate)) {
    rows.push({
      id: `${contract.id}-buyout`,
      leasingContractId: contract.id,
      dueDate: contract.endDate,
      amount: toNonNegativeNumber(contract.buyoutPayment),
      status: 'planned',
      paidAmount: 0,
      comment: 'Выкупной платёж',
    });
  }

  return rows;
}

function paymentOutstanding(row) {
  if (row.status === 'paid' || row.status === 'skipped') return 0;
  return Math.max(0, toNonNegativeNumber(row.amount) - toNonNegativeNumber(row.paidAmount));
}

function decorateSchedule(row, today = todayKey(), options = {}) {
  const outstanding = paymentOutstanding(row);
  const daysDelta = row.dueDate
    ? Math.floor((new Date(`${row.dueDate}T00:00:00.000Z`).getTime() - new Date(`${today}T00:00:00.000Z`).getTime()) / DAY_MS)
    : 0;
  const allowOverdue = options.allowOverdue !== false;
  const effectiveStatus = allowOverdue && row.status === 'planned' && outstanding > 0 && row.dueDate < today ? 'overdue' : row.status;
  return {
    ...row,
    status: effectiveStatus,
    outstanding,
    daysUntilDue: daysDelta,
    overdueDays: effectiveStatus === 'overdue' ? Math.abs(daysDelta) : 0,
  };
}

function normalizeLeasingContract(input, previous = null, options = {}) {
  const now = options.now || todayKey();
  const id = input?.id || previous?.id || options.id || '';
  const contractNumber = String(input?.contractNumber ?? previous?.contractNumber ?? '').trim();
  const leasingCompany = String(input?.leasingCompany ?? previous?.leasingCompany ?? '').trim();
  const startDate = parseDateKey(input?.startDate ?? previous?.startDate);
  const endDate = parseDateKey(input?.endDate ?? previous?.endDate);
  const termMonths = toPositiveInteger(input?.termMonths ?? previous?.termMonths, 0);
  const monthlyPayment = toNonNegativeNumber(input?.monthlyPayment ?? previous?.monthlyPayment);
  const paymentDay = Math.min(31, Math.max(1, toPositiveInteger(input?.paymentDay ?? previous?.paymentDay, 0)));

  if (!contractNumber) throw new Error('Укажите номер договора лизинга.');
  if (!leasingCompany) throw new Error('Укажите лизинговую компанию.');
  if (!startDate || !endDate) throw new Error('Укажите корректные даты договора.');
  if (endDate < startDate) throw new Error('Дата окончания не может быть раньше даты начала.');
  if (termMonths <= 0) throw new Error('Срок договора должен быть больше нуля.');
  if (paymentDay < 1 || paymentDay > 31) throw new Error('День платежа должен быть от 1 до 31.');

  const initialPayment = toNonNegativeNumber(input?.initialPayment ?? previous?.initialPayment);
  const buyoutPayment = toNonNegativeNumber(input?.buyoutPayment ?? previous?.buyoutPayment);
  const paidAmount = toNonNegativeNumber(input?.paidAmount ?? previous?.paidAmount);
  const computedTotal = initialPayment + monthlyPayment * termMonths + buyoutPayment;
  const totalAmount = toNonNegativeNumber(input?.totalAmount ?? previous?.totalAmount, computedTotal) || computedTotal;
  const remainingAmount = Math.max(0, totalAmount - paidAmount);

  return {
    id,
    contractNumber,
    leasingCompany,
    equipmentId: String(input?.equipmentId ?? previous?.equipmentId ?? '').trim() || undefined,
    equipmentName: String(input?.equipmentName ?? previous?.equipmentName ?? '').trim() || undefined,
    startDate,
    endDate,
    termMonths,
    monthlyPayment,
    paymentDay,
    status: normalizeStatus(input?.status ?? previous?.status, 'active', CONTRACT_STATUSES),
    initialPayment,
    buyoutPayment,
    totalAmount,
    paidAmount,
    remainingAmount,
    interestRate: toNonNegativeNumber(input?.interestRate ?? previous?.interestRate),
    comment: String(input?.comment ?? previous?.comment ?? '').trim() || undefined,
    responsibleUserId: String(input?.responsibleUserId ?? previous?.responsibleUserId ?? '').trim() || undefined,
    paymentSource: String(input?.paymentSource ?? previous?.paymentSource ?? '').trim() || undefined,
    nextPaymentDate: parseDateKey(input?.nextPaymentDate ?? previous?.nextPaymentDate) || undefined,
    lastPaymentDate: parseDateKey(input?.lastPaymentDate ?? previous?.lastPaymentDate) || undefined,
    createdAt: previous?.createdAt || input?.createdAt || options.nowIso || new Date().toISOString(),
    updatedAt: options.nowIso || new Date().toISOString(),
  };
}

function getContractSchedule(contract, scheduleRows = [], today = todayKey()) {
  const explicitRows = (scheduleRows || [])
    .filter(row => String(row?.leasingContractId || '') === String(contract?.id || ''))
    .map((row, index) => normalizeLeasingPaymentScheduleRow(row, contract, index));
  const rows = explicitRows.length > 0 ? explicitRows : buildGeneratedSchedule(contract);
  const allowOverdue = isLeasingContractFinanciallyActive(contract);
  return rows
    .map(row => decorateSchedule(row, today, { allowOverdue }))
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate));
}

function decorateLeasingContract(contract, scheduleRows = [], today = todayKey()) {
  const schedule = getContractSchedule(contract, scheduleRows, today);
  const unpaid = schedule.filter(row => row.status !== 'paid' && row.status !== 'skipped' && row.outstanding > 0);
  const overdue = unpaid.filter(row => row.status === 'overdue');
  const nextPayment = unpaid.find(row => row.dueDate >= today) || overdue[0] || null;
  const remainingAmount = unpaid.reduce((sum, row) => sum + row.outstanding, 0);
  const paidAmount = schedule.reduce((sum, row) => sum + toNonNegativeNumber(row.paidAmount), 0);
  const status = contract.status === 'active' && overdue.length > 0 ? 'overdue' : contract.status;

  return {
    ...contract,
    status,
    paidAmount: Math.max(toNonNegativeNumber(contract.paidAmount), paidAmount),
    remainingAmount,
    nextPaymentDate: nextPayment?.dueDate || contract.nextPaymentDate,
    schedule,
    nextPayment,
    remainingPayments: unpaid.length,
    overduePayments: overdue.length,
    overdueAmount: overdue.reduce((sum, row) => sum + row.outstanding, 0),
  };
}

function buildLeasingSummary(contracts = [], scheduleRows = [], today = todayKey()) {
  const currentMonth = monthKey(today);
  const nextMonthDate = new Date(`${today}T00:00:00.000Z`);
  nextMonthDate.setUTCMonth(nextMonthDate.getUTCMonth() + 1);
  const nextMonth = monthKey(nextMonthDate.toISOString().slice(0, 10));
  const decorated = (contracts || []).map(contract => decorateLeasingContract(contract, scheduleRows, today));
  const financiallyActive = decorated.filter(isLeasingContractFinanciallyActive);
  const dueInMonth = (contract, key) => contract.schedule
    .filter(row => row.status !== 'paid' && row.status !== 'skipped' && monthKey(row.dueDate) === key)
    .reduce((sum, row) => sum + row.outstanding, 0);

  return {
    contracts: decorated,
    activeContracts: financiallyActive.length,
    pausedContracts: decorated.filter(contract => contract.status === 'paused').length,
    currentMonthAmount: financiallyActive.reduce((sum, contract) => sum + dueInMonth(contract, currentMonth), 0),
    nextMonthAmount: financiallyActive.reduce((sum, contract) => sum + dueInMonth(contract, nextMonth), 0),
    overdueAmount: financiallyActive.reduce((sum, contract) => sum + contract.overdueAmount, 0),
    overdueContracts: financiallyActive.filter(contract => contract.overdueAmount > 0).length,
    remainingAmount: financiallyActive.reduce((sum, contract) => sum + contract.remainingAmount, 0),
    averageMonthlyLoad: financiallyActive.length > 0
      ? Math.round(financiallyActive.reduce((sum, contract) => sum + toNonNegativeNumber(contract.monthlyPayment), 0) / financiallyActive.length)
      : 0,
  };
}

module.exports = {
  normalizeLeasingContract,
  normalizeLeasingPaymentScheduleRow,
  decorateLeasingContract,
  buildLeasingSummary,
  buildGeneratedSchedule,
  getContractSchedule,
  isLeasingContractFinanciallyActive,
  todayKey,
};
