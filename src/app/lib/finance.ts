import type { GanttRentalData } from '../mock-data';
import type { Client, Payment } from '../types';

export interface RentalDebtRow {
  rentalId: string;
  clientId?: string;
  client: string;
  equipmentInv: string;
  manager: string;
  startDate: string;
  endDate: string;
  expectedPaymentDate?: string;
  amount: number;
  paidAmount: number;
  outstanding: number;
  paymentStatus: GanttRentalData['paymentStatus'];
  rentalStatus: GanttRentalData['status'];
}

export interface ClientReceivableRow {
  clientId?: string;
  client: string;
  creditLimit: number;
  currentDebt: number;
  manualDebt: number;
  unpaidRentals: number;
  overdueRentals: number;
  exceededLimit: boolean;
  dataIssue?: 'missing_client_id';
}

export interface ClientFinancialSnapshot extends ClientReceivableRow {
  totalRentals: number;
  activeRentals: number;
  lastRentalDate?: string;
}

export interface ManagerReceivableRow {
  manager: string;
  currentDebt: number;
  overdueDebt: number;
  unpaidRentals: number;
  overdueRentals: number;
  clientsCount: number;
}

export interface OverdueBucketRow {
  key: string;
  label: string;
  rentals: number;
  debt: number;
}

function getEffectivePaidAmount(payment: Payment): number {
  if (typeof payment.paidAmount === 'number') return payment.paidAmount;
  if (payment.status === 'paid') return payment.amount;
  return 0;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function stableClientId(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const item = record as { clientId?: unknown; customerId?: unknown; client_id?: unknown };
  return String(item.clientId || item.customerId || item.client_id || '').trim();
}

function getClientName(record: unknown): string {
  if (!record || typeof record !== 'object') return '';
  const item = record as { client?: unknown; clientName?: unknown; company?: unknown; customerName?: unknown };
  return String(item.client || item.clientName || item.company || item.customerName || '').trim();
}

function toMoney(value: unknown): number {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.max(0, numeric) : 0;
}

function receivableKey(row: RentalDebtRow): string {
  const clientId = stableClientId(row);
  return clientId ? `id:${clientId}` : `unlinked:${normalizeText(row.client) || row.rentalId || 'unknown'}`;
}

function getOverdueDate(row: Pick<RentalDebtRow, 'expectedPaymentDate' | 'endDate'>): string {
  return row.expectedPaymentDate || row.endDate;
}

export function getRentalDebtOverdueDays(
  row: Pick<RentalDebtRow, 'expectedPaymentDate' | 'endDate' | 'outstanding'>,
  today = new Date().toISOString().slice(0, 10),
): number {
  if (row.outstanding <= 0) return 0;
  const dueDate = getOverdueDate(row);
  if (!dueDate || dueDate >= today) return 0;
  return Math.max(0, Math.floor((new Date(today).getTime() - new Date(dueDate).getTime()) / 86400000));
}

export function buildRentalDebtRows(
  rentals: GanttRentalData[],
  payments: Payment[],
): RentalDebtRow[] {
  const byRentalId = new Map<string, Payment[]>();
  payments.forEach(payment => {
    if (!payment.rentalId) return;
    if (!byRentalId.has(payment.rentalId)) byRentalId.set(payment.rentalId, []);
    byRentalId.get(payment.rentalId)!.push(payment);
  });

  return rentals
    .map(rental => {
      const relatedPayments = byRentalId.get(rental.id) ?? [];
      let paidAmount = relatedPayments.reduce((sum, payment) => sum + getEffectivePaidAmount(payment), 0);
      if (relatedPayments.length === 0 && rental.paymentStatus === 'paid') {
        paidAmount = rental.amount || 0;
      }
      const outstanding = Math.max(0, (rental.amount || 0) - paidAmount);
      return {
        rentalId: rental.id,
        clientId: stableClientId(rental) || undefined,
        client: getClientName(rental),
        equipmentInv: rental.equipmentInv,
        manager: rental.manager,
        startDate: rental.startDate,
        endDate: rental.endDate,
        expectedPaymentDate: rental.expectedPaymentDate,
        amount: rental.amount || 0,
        paidAmount,
        outstanding,
        paymentStatus: relatedPayments.length > 0
          ? outstanding <= 0
            ? 'paid'
            : paidAmount > 0
              ? 'partial'
              : 'unpaid'
          : rental.paymentStatus,
        rentalStatus: rental.status,
      };
    })
    .filter(row => row.outstanding > 0 || row.paymentStatus !== 'paid')
    .sort((a, b) => b.outstanding - a.outstanding);
}

export function buildClientReceivables(
  clients: Client[],
  rentalDebtRows: RentalDebtRow[],
): ClientReceivableRow[] {
  const clientsById = new Map(clients.map(client => [client.id, client] as const));
  const map = new Map<string, ClientReceivableRow>();
  const today = new Date().toISOString().slice(0, 10);

  rentalDebtRows.forEach(row => {
    const rowClientId = stableClientId(row);
    const client = rowClientId ? clientsById.get(rowClientId) : undefined;
    const key = receivableKey(row);
    const existing = map.get(key) ?? {
      clientId: client?.id ?? (rowClientId || undefined),
      client: client?.company ?? (row.client || 'Клиент не привязан'),
      creditLimit: client?.creditLimit ?? 0,
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

  clients.forEach(client => {
    const manualDebt = toMoney(client.debt);
    if (manualDebt <= 0) return;
    const key = client.id ? `id:${client.id}` : `manual:${normalizeText(client.company) || 'unknown'}`;
    const existing = map.get(key) ?? {
      clientId: client.id || undefined,
      client: client.company || 'Клиент не привязан',
      creditLimit: client.creditLimit ?? 0,
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

  return Array.from(map.values()).sort((a, b) => b.currentDebt - a.currentDebt);
}

export function buildClientFinancialSnapshots(
  clients: Client[],
  rentals: GanttRentalData[],
  payments: Payment[],
): ClientFinancialSnapshot[] {
  const debtRows = buildRentalDebtRows(rentals, payments);
  const receivables = buildClientReceivables(clients, debtRows);
  const receivableMap = new Map(receivables.filter(item => item.clientId).map(item => [String(item.clientId), item] as const));

  return clients
    .map(client => {
      const clientRentals = rentals.filter(item => stableClientId(item) === client.id);
      const latestRental = clientRentals
        .slice()
        .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];
      const receivable = receivableMap.get(client.id);
      return {
        clientId: client.id,
        client: client.company,
        creditLimit: client.creditLimit ?? 0,
        currentDebt: receivable?.currentDebt ?? toMoney(client.debt),
        manualDebt: receivable?.manualDebt ?? toMoney(client.debt),
        unpaidRentals: receivable?.unpaidRentals ?? 0,
        overdueRentals: receivable?.overdueRentals ?? 0,
        exceededLimit: receivable?.exceededLimit ?? ((client.creditLimit ?? 0) > 0 && toMoney(client.debt) > (client.creditLimit ?? 0)),
        totalRentals: clientRentals.length,
        activeRentals: clientRentals.filter(item => item.status === 'active' || item.status === 'created').length,
        lastRentalDate: latestRental?.startDate ?? client.lastRentalDate,
      };
    })
    .sort((a, b) => b.currentDebt - a.currentDebt || a.client.localeCompare(b.client, 'ru'));
}

export function buildManagerReceivables(
  rentalDebtRows: RentalDebtRow[],
  today = new Date().toISOString().slice(0, 10),
  clients: Client[] = [],
): ManagerReceivableRow[] {
  const map = new Map<string, ManagerReceivableRow & { clients: Set<string> }>();

  rentalDebtRows.forEach(row => {
    const key = row.manager || 'Не назначен';
    const overdueDays = getRentalDebtOverdueDays(row, today);
    const item = map.get(key) ?? {
      manager: key,
      currentDebt: 0,
      overdueDebt: 0,
      unpaidRentals: 0,
      overdueRentals: 0,
      clientsCount: 0,
      clients: new Set<string>(),
    };
    item.currentDebt += row.outstanding;
    item.unpaidRentals += 1;
    if (overdueDays > 0) {
      item.overdueRentals += 1;
      item.overdueDebt += row.outstanding;
    }
    item.clients.add(stableClientId(row) || row.client || 'Клиент не привязан');
    item.clientsCount = item.clients.size;
    map.set(key, item);
  });

  clients.forEach(client => {
    const manualDebt = toMoney(client.debt);
    if (manualDebt <= 0) return;
    const key = client.manager || 'Не назначен';
    const item = map.get(key) ?? {
      manager: key,
      currentDebt: 0,
      overdueDebt: 0,
      unpaidRentals: 0,
      overdueRentals: 0,
      clientsCount: 0,
      clients: new Set<string>(),
    };
    item.currentDebt += manualDebt;
    item.clients.add(client.id || client.company || 'Клиент не привязан');
    item.clientsCount = item.clients.size;
    map.set(key, item);
  });

  return Array.from(map.values())
    .map(({ clients, ...rest }) => rest)
    .sort((a, b) => b.currentDebt - a.currentDebt || a.manager.localeCompare(b.manager, 'ru'));
}

export function buildOverdueBuckets(
  rentalDebtRows: RentalDebtRow[],
  today = new Date().toISOString().slice(0, 10),
): OverdueBucketRow[] {
  const buckets: OverdueBucketRow[] = [
    { key: '1_7', label: '1-7 дней', rentals: 0, debt: 0 },
    { key: '8_14', label: '8-14 дней', rentals: 0, debt: 0 },
    { key: '15_30', label: '15-30 дней', rentals: 0, debt: 0 },
    { key: '31_60', label: '31-60 дней', rentals: 0, debt: 0 },
    { key: '61_plus', label: '61+ дней', rentals: 0, debt: 0 },
  ];

  rentalDebtRows.forEach(row => {
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

export function mergeClientsWithFinancials(
  clients: Client[],
  rentals: GanttRentalData[],
  payments: Payment[],
): Client[] {
  const snapshots = buildClientFinancialSnapshots(clients, rentals, payments);
  const byClient = new Map(snapshots.map(item => [item.clientId, item] as const));
  return clients.map(client => {
    const financial = byClient.get(client.id);
    if (!financial) return client;
    return {
      ...client,
      debt: financial.currentDebt,
      totalRentals: financial.totalRentals,
      lastRentalDate: financial.lastRentalDate,
    };
  });
}
