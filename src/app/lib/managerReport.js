import { calculateRentalBilling } from './rentalDowntimeFlow.js';

const MONTH_NAMES = [
  'Январь', 'Февраль', 'Март', 'Апрель', 'Май', 'Июнь',
  'Июль', 'Август', 'Сентябрь', 'Октябрь', 'Ноябрь', 'Декабрь',
];

const EQ_TYPE_LABELS = {
  scissor: 'Ножничный',
  articulated: 'Коленчатый',
  telescopic: 'Телескопический',
};

const RENTAL_STATUS_LABELS = {
  created: 'Бронь',
  active: 'Активна',
  returned: 'Возвращена',
  closed: 'Закрыта',
};

const PAYMENT_STATUS_LABELS = {
  paid: 'Оплачено',
  partial: 'Частично',
  unpaid: 'Не оплачено',
};

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

const DAY_MS = 24 * 60 * 60 * 1000;

function normalizeStatus(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function shouldCountManagerReportPayment(payment) {
  return !IGNORED_PAYMENT_STATUSES.has(normalizeStatus(payment?.status));
}

export function shouldCountManagerReportRental(rental) {
  return !IGNORED_RENTAL_STATUSES.has(normalizeStatus(rental?.status));
}

function toMoney(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

export function getManagerReportPaidAmount(payment) {
  if (!shouldCountManagerReportPayment(payment)) return 0;
  if (typeof payment?.paidAmount === 'number') return toMoney(payment.paidAmount);
  if (payment?.status === 'paid') return toMoney(payment.amount);
  return 0;
}

function parseDateKey(value) {
  const text = String(value || '').slice(0, 10);
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }
  return date;
}

function dateKey(date) {
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function monthKey(date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthLabel(date) {
  return `${MONTH_NAMES[date.getUTCMonth()]} ${date.getUTCFullYear()}`;
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS);
}

function startOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
}

function endOfMonth(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

function inclusiveDays(start, end) {
  if (!start || !end || end < start) return 0;
  return Math.floor((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function clampDate(date, min, max) {
  if (min && date < min) return min;
  if (max && date > max) return max;
  return date;
}

function roundMoney(value) {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 100) / 100;
}

function splitMoneyByWeights(total, weights, totalWeight = weights.reduce((sum, value) => sum + Math.max(0, value || 0), 0)) {
  const safeTotal = toMoney(total);
  const sumWeight = weights.reduce((sum, value) => sum + Math.max(0, value || 0), 0);
  const safeTotalWeight = Math.max(0, totalWeight || 0);
  if (safeTotal <= 0 || sumWeight <= 0 || safeTotalWeight <= 0) return weights.map(() => 0);
  let used = 0;
  const coversWholeAmount = Math.abs(sumWeight - safeTotalWeight) < 0.000001;
  return weights.map((weight, index) => {
    if (coversWholeAmount && index === weights.length - 1) return roundMoney(safeTotal - used);
    const part = roundMoney(safeTotal * Math.max(0, weight || 0) / safeTotalWeight);
    used += part;
    return part;
  });
}

function getRentalTotalDays(rental) {
  let start = parseDateKey(rental?.startDate);
  let end = parseDateKey(rental?.endDate || rental?.plannedReturnDate);
  if (!start) return 0;
  if (!end) end = start;
  if (end < start) end = start;
  return inclusiveDays(start, end);
}

export function splitRentalPeriodByMonth(rental, period = {}) {
  let start = parseDateKey(rental?.startDate);
  let end = parseDateKey(rental?.endDate || rental?.plannedReturnDate);
  if (!start) return [];
  if (!end) end = start;
  if (end < start) end = start;

  const periodStart = parseDateKey(period.dateFrom);
  const periodEnd = parseDateKey(period.dateTo);
  const clippedStart = clampDate(start, periodStart, periodEnd);
  const clippedEnd = clampDate(end, periodStart, periodEnd);
  if (clippedEnd < clippedStart || clippedEnd < start || clippedStart > end) return [];

  const parts = [];
  let cursor = startOfMonth(clippedStart);
  while (cursor <= clippedEnd) {
    const partStart = clampDate(start, cursor, endOfMonth(cursor));
    const partEnd = clampDate(end, cursor, endOfMonth(cursor));
    const allocationStart = clampDate(partStart, periodStart, periodEnd);
    const allocationEnd = clampDate(partEnd, periodStart, periodEnd);
    const days = inclusiveDays(allocationStart, allocationEnd);
    if (days > 0) {
      parts.push({
        monthKey: monthKey(cursor),
        monthLabel: monthLabel(cursor),
        allocationStartDate: dateKey(allocationStart),
        allocationEndDate: dateKey(allocationEnd),
        days,
      });
    }
    cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, 1));
  }
  return parts;
}

export function formatManagerReportDate(value) {
  if (!value) return '—';
  const dt = parseDateKey(value) || new Date(value);
  if (Number.isNaN(dt.getTime())) return value;
  const p = n => String(n).padStart(2, '0');
  return `${p(dt.getUTCDate())}.${p(dt.getUTCMonth() + 1)}.${dt.getUTCFullYear()}`;
}

export function buildManagerReportRows(rentals, equipmentList, payments, period = {}) {
  const eqById = new Map();
  const eqByUniqueInv = new Map();
  const inventoryCounts = new Map();
  for (const eq of equipmentList || []) {
    eqById.set(eq.id, eq);
    inventoryCounts.set(eq.inventoryNumber, (inventoryCounts.get(eq.inventoryNumber) ?? 0) + 1);
  }
  for (const eq of equipmentList || []) {
    if ((inventoryCounts.get(eq.inventoryNumber) ?? 0) === 1) {
      eqByUniqueInv.set(eq.inventoryNumber, eq);
    }
  }

  const paysByRental = new Map();
  const seenPaymentIds = new Set();
  for (const payment of payments || []) {
    if (!payment?.rentalId) continue;
    if (!shouldCountManagerReportPayment(payment)) continue;
    if (payment.id) {
      if (seenPaymentIds.has(payment.id)) continue;
      seenPaymentIds.add(payment.id);
    }
    const list = paysByRental.get(payment.rentalId) ?? [];
    list.push(payment);
    paysByRental.set(payment.rentalId, list);
  }

  const rows = [];
  for (const rental of (rentals || []).filter(shouldCountManagerReportRental)) {
    const eq = (rental.equipmentId ? eqById.get(rental.equipmentId) : undefined)
      ?? eqByUniqueInv.get(rental.equipmentInv);
    const parts = splitRentalPeriodByMonth(rental, period);
    if (parts.length === 0) continue;

    const relatedPayments = paysByRental.get(rental.id) ?? [];
    const rentalPaid = relatedPayments.reduce((sum, payment) => sum + getManagerReportPaidAmount(payment), 0);
    const amountParts = parts.map(part => calculateRentalBilling(rental, {
      periodStart: part.allocationStartDate,
      periodEnd: part.allocationEndDate,
    }).finalRentalAmount);
    const paidParts = splitMoneyByWeights(rentalPaid, amountParts, calculateRentalBilling(rental).finalRentalAmount);

    let latestPaidDate = '';
    for (const payment of relatedPayments) {
      if (payment.paidDate && payment.paidDate > latestPaidDate) latestPaidDate = payment.paidDate;
    }

    parts.forEach((part, index) => {
      const amount = amountParts[index] || 0;
      const paidAmount = paidParts[index] || 0;
      const debt = roundMoney(Math.max(0, amount - paidAmount));
      let paymentStatus;
      if (paidAmount + 0.005 >= amount) paymentStatus = 'paid';
      else if (paidAmount > 0) paymentStatus = 'partial';
      else paymentStatus = 'unpaid';

      rows.push({
        rowId: `${rental.id}:${part.monthKey}:${part.allocationStartDate}:${part.allocationEndDate}`,
        rentalId: rental.id,
        equipmentId: eq?.id || rental.equipmentId || '',
        equipmentFilterKey: eq?.id || rental.equipmentId || `inv:${rental.equipmentInv || '—'}`,
        monthLabel: part.monthLabel,
        monthKey: part.monthKey,
        allocationStartDate: part.allocationStartDate,
        allocationEndDate: part.allocationEndDate,
        allocationDays: part.days,
        manager: rental.manager || '—',
        client: rental.client || '—',
        equipmentInv: rental.equipmentInv || '—',
        equipmentType: eq?.type ?? '',
        equipmentLabel: eq ? (EQ_TYPE_LABELS[eq.type] ?? eq.type) : '—',
        equipmentName: eq ? `${eq.manufacturer} ${eq.model}` : (rental.equipmentInv || '—'),
        startDate: rental.startDate,
        endDate: rental.endDate || rental.plannedReturnDate || '',
        amount,
        paymentStatus,
        paymentLabel: PAYMENT_STATUS_LABELS[paymentStatus] ?? paymentStatus,
        paidAmount,
        debt,
        paidDate: latestPaidDate,
        updSigned: Boolean(rental.updSigned),
        updDate: rental.updDate ?? '',
        rentalStatus: rental.status,
        rentalStatusLabel: RENTAL_STATUS_LABELS[rental.status] ?? rental.status,
      });
    });
  }
  return rows;
}

export function filterManagerReportRows(rows, filters = {}) {
  return (rows || []).filter(row => {
    if (filters.manager && filters.manager !== 'all' && row.manager !== filters.manager) return false;
    if (filters.client && filters.client !== 'all' && row.client !== filters.client) return false;
    if (filters.equipmentType && filters.equipmentType !== 'all' && row.equipmentType !== filters.equipmentType) return false;
    if (filters.equipmentInv && filters.equipmentInv !== 'all' && row.equipmentFilterKey !== filters.equipmentInv) return false;
    if (filters.paymentStatus && filters.paymentStatus !== 'all' && row.paymentStatus !== filters.paymentStatus) return false;
    if (filters.updStatus && filters.updStatus !== 'all') {
      if (filters.updStatus === 'signed' && !row.updSigned) return false;
      if (filters.updStatus === 'unsigned' && row.updSigned) return false;
    }
    if (filters.rentalStatus && filters.rentalStatus !== 'all' && row.rentalStatus !== filters.rentalStatus) return false;
    return true;
  });
}

export function buildManagerReportSummary(rows) {
  const map = new Map();
  for (const row of rows || []) {
    if (!map.has(row.manager)) {
      map.set(row.manager, {
        manager: row.manager,
        rentalsCount: 0,
        clientsCount: 0,
        _rentals: new Set(),
        _clients: new Set(),
        totalAmount: 0,
        paidAmount: 0,
        debt: 0,
        updSignedCount: 0,
        updNotSignedCount: 0,
      });
    }
    const summary = map.get(row.manager);
    summary._rentals.add(row.rentalId);
    summary.rentalsCount = summary._rentals.size;
    summary._clients.add(row.client);
    summary.totalAmount = roundMoney(summary.totalAmount + row.amount);
    summary.paidAmount = roundMoney(summary.paidAmount + row.paidAmount);
    summary.debt = roundMoney(summary.debt + row.debt);
    if (row.updSigned) summary.updSignedCount += 1;
    else summary.updNotSignedCount += 1;
  }
  return [...map.values()]
    .map(summary => ({
      manager: summary.manager,
      rentalsCount: summary.rentalsCount,
      clientsCount: summary._clients.size,
      totalAmount: summary.totalAmount,
      paidAmount: summary.paidAmount,
      debt: summary.debt,
      updSignedCount: summary.updSignedCount,
      updNotSignedCount: summary.updNotSignedCount,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);
}

function escXML(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function hCell(value) {
  return `<Cell ss:StyleID="hdr"><Data ss:Type="String">${escXML(value)}</Data></Cell>`;
}

function dCell(value, num = false) {
  return `<Cell><Data ss:Type="${num ? 'Number' : 'String'}">${escXML(value)}</Data></Cell>`;
}

export function buildManagerReportXLS(summary, detail, periodLabel) {
  const today = formatManagerReportDate(new Date().toISOString());

  const sumRows = (summary || []).map(s => `<Row>
      ${dCell(s.manager)}${dCell(s.rentalsCount, true)}${dCell(s.clientsCount, true)}
      ${dCell(s.totalAmount, true)}${dCell(s.paidAmount, true)}${dCell(s.debt, true)}
      ${dCell(s.updSignedCount, true)}${dCell(s.updNotSignedCount, true)}
    </Row>`).join('\n');

  const totRent = (summary || []).reduce((sum, row) => sum + row.rentalsCount, 0);
  const totAmt = (summary || []).reduce((sum, row) => sum + row.totalAmount, 0);
  const totPaid = (summary || []).reduce((sum, row) => sum + row.paidAmount, 0);
  const totDebt = (summary || []).reduce((sum, row) => sum + row.debt, 0);
  const totSigned = (summary || []).reduce((sum, row) => sum + row.updSignedCount, 0);
  const totUnsign = (summary || []).reduce((sum, row) => sum + row.updNotSignedCount, 0);
  const totRow = `<Row ss:StyleID="total">
      ${dCell('ИТОГО')}${dCell(totRent, true)}${dCell('')}
      ${dCell(totAmt, true)}${dCell(totPaid, true)}${dCell(totDebt, true)}
      ${dCell(totSigned, true)}${dCell(totUnsign, true)}
    </Row>`;

  const detRows = (detail || []).map(r => `<Row>
      ${dCell(r.monthLabel)}${dCell(r.manager)}${dCell(r.client)}
      ${dCell(r.equipmentInv)}${dCell(r.equipmentLabel)}${dCell(r.equipmentName)}
      ${dCell(formatManagerReportDate(r.startDate))}${dCell(formatManagerReportDate(r.endDate))}
      ${dCell(r.amount, true)}${dCell(r.paymentLabel)}
      ${dCell(r.paidAmount, true)}${dCell(r.debt, true)}
      ${dCell(r.paidDate ? formatManagerReportDate(r.paidDate) : '')}
      ${dCell(r.updSigned ? 'Да' : 'Нет')}${dCell(r.updDate ? formatManagerReportDate(r.updDate) : '')}
      ${dCell(r.rentalStatusLabel)}
    </Row>`).join('\n');

  const titleCell = (text, span) =>
    `<Cell ss:MergeAcross="${span - 1}" ss:StyleID="title"><Data ss:Type="String">${escXML(text)}</Data></Cell>`;

  return `<?xml version="1.0" encoding="UTF-8"?>
<?mso-application progid="Excel.Sheet"?>
<Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet"
  xmlns:o="urn:schemas-microsoft-com:office:office"
  xmlns:x="urn:schemas-microsoft-com:office:excel"
  xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet">
<Styles>
  <Style ss:ID="hdr">
    <Font ss:Bold="1" ss:Color="#FFFFFF"/>
    <Interior ss:Color="#1E3A5F" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="total">
    <Font ss:Bold="1"/>
    <Interior ss:Color="#DCE6F1" ss:Pattern="Solid"/>
  </Style>
  <Style ss:ID="title">
    <Font ss:Bold="1" ss:Size="12"/>
  </Style>
</Styles>
<Worksheet ss:Name="Сводно">
  <Table>
    <Row>${titleCell(`Отчёт по менеджерам · ${periodLabel} · Выгружен: ${today}`, 8)}</Row>
    <Row/>
    <Row>
      ${hCell('Менеджер')}${hCell('Аренд')}${hCell('Клиентов')}
      ${hCell('Сумма аренд, ₽')}${hCell('Оплачено, ₽')}${hCell('Дебиторка, ₽')}
      ${hCell('УПД подписано')}${hCell('УПД не подписано')}
    </Row>
    ${sumRows}
    ${totRow}
  </Table>
</Worksheet>
<Worksheet ss:Name="Детализация">
  <Table>
    <Row>${titleCell(`Детализация аренд · ${periodLabel} · Выгружен: ${today}`, 16)}</Row>
    <Row/>
    <Row>
      ${hCell('Месяц')}${hCell('Менеджер')}${hCell('Клиент')}
      ${hCell('INV')}${hCell('Тип техники')}${hCell('Техника')}
      ${hCell('Начало аренды')}${hCell('Окончание аренды')}
      ${hCell('Сумма аренды, ₽')}${hCell('Статус оплаты')}
      ${hCell('Оплачено, ₽')}${hCell('Дебиторка, ₽')}${hCell('Дата оплаты')}
      ${hCell('УПД подписано')}${hCell('Дата УПД')}${hCell('Статус аренды')}
    </Row>
    ${detRows}
  </Table>
</Worksheet>
</Workbook>`;
}
