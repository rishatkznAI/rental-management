import type { GanttRentalData } from '../mock-data';
import type { ArDebtorIdentityStatus, Client, Payment, PaymentAllocation } from '../types';
import { calculateRentalBilling } from './rentalDowntimeFlow.js';

export interface RentalDebtRow {
  rentalId: string;
  counterpartyId?: string;
  debtorCounterpartyId?: string | null;
  debtorIdentityStatus: ArDebtorIdentityStatus;
  debtorIdentityIssues?: string[];
  clientId?: string;
  client: string;
  objectId?: string;
  contractId?: string;
  equipmentInv: string;
  manager: string;
  managerId?: string;
  documentId?: string;
  startDate: string;
  endDate: string;
  expectedPaymentDate?: string;
  amount: number;
  grossAmount?: number;
  downtimeAdjustmentAmount?: number;
  downtimeDays?: number;
  billingDowntimeDays?: number;
  billableDays?: number;
  paidAmount: number;
  outstanding: number;
  paymentStatus: GanttRentalData['paymentStatus'];
  rentalStatus: GanttRentalData['status'];
}

export interface ClientReceivableRow {
  counterpartyId?: string;
  debtorCounterpartyId?: string | null;
  debtorIdentityStatus: ArDebtorIdentityStatus;
  debtorIdentityIssues?: string[];
  clientId?: string;
  clientIds?: string[];
  client: string;
  creditLimit: number;
  currentDebt: number;
  manualDebt: number;
  unpaidRentals: number;
  overdueRentals: number;
  exceededLimit: boolean;
  dataIssue?: 'unresolved_debtor_identity';
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

export interface ClientDebtAgingRow {
  counterpartyId?: string;
  debtorCounterpartyId?: string | null;
  debtorIdentityStatus: ArDebtorIdentityStatus;
  debtorIdentityIssues?: string[];
  clientId?: string;
  clientIds?: string[];
  client: string;
  manager: string;
  ageBucket: string;
  ageBucketLabel: string;
  debt: number;
  rentals: number;
  overdueRentals: number;
  hasActiveRental: boolean;
  maxOverdueDays: number;
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

const DEBT_AGE_BUCKETS: OverdueBucketRow[] = [
  { key: '0_7', label: '0-7 дней', rentals: 0, debt: 0 },
  { key: '8_14', label: '8-14 дней', rentals: 0, debt: 0 },
  { key: '15_30', label: '15-30 дней', rentals: 0, debt: 0 },
  { key: '31_60', label: '31-60 дней', rentals: 0, debt: 0 },
  { key: '60_plus', label: '60+ дней', rentals: 0, debt: 0 },
];

function normalizeStatus(value: unknown): string {
  return String(value ?? '').trim().toLowerCase();
}

export function shouldCountPayment(payment: Payment | undefined | null): boolean {
  return !IGNORED_PAYMENT_STATUSES.has(normalizeStatus(payment?.status));
}

export function shouldCountRental(rental: Pick<GanttRentalData, 'status'> | undefined | null): boolean {
  return !IGNORED_RENTAL_STATUSES.has(normalizeStatus(rental?.status));
}

export function getEffectivePaidAmount(payment: Payment): number {
  if (!shouldCountPayment(payment)) return 0;
  if (typeof payment.paidAmount === 'number') return toMoney(payment.paidAmount);
  if (payment.status === 'paid') return toMoney(payment.amount);
  return 0;
}

function paymentId(payment: Payment): string {
  return String(payment.id || '').trim();
}

function allocationPaymentId(allocation: PaymentAllocation): string {
  return String(allocation.paymentId || '').trim();
}

function allocationAmount(allocation: PaymentAllocation): number {
  return toMoney(allocation.amount);
}

function paymentAllocationCap(payment: Payment): number {
  const paid = getEffectivePaidAmount(payment);
  const amount = toMoney(payment.amount);
  return amount > 0 ? Math.min(paid, amount) : paid;
}

function buildAllocationsByPaymentId(paymentAllocations: PaymentAllocation[] = []): Map<string, PaymentAllocation[]> {
  const map = new Map<string, PaymentAllocation[]>();
  const seen = new Set<string>();
  paymentAllocations.forEach(allocation => {
    if (!shouldCountPayment(allocation as unknown as Payment)) return;
    const id = allocationPaymentId(allocation);
    if (!id) return;
    const dedupeKey = allocation.id || JSON.stringify([id, allocation.rentalId || '', allocation.documentId || '', allocation.amount || 0]);
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    if (!map.has(id)) map.set(id, []);
    map.get(id)!.push(allocation);
  });
  return map;
}

function buildAllocatedAmountsByRental(payments: Payment[], paymentAllocations: PaymentAllocation[] = []): Map<string, number> {
  const allocationsByPaymentId = buildAllocationsByPaymentId(paymentAllocations);
  const paymentsById = new Map(payments.filter(payment => paymentId(payment)).map(payment => [paymentId(payment), payment] as const));
  const byRentalId = new Map<string, number>();

  allocationsByPaymentId.forEach((allocations, id) => {
    const payment = paymentsById.get(id);
    if (!payment || !shouldCountPayment(payment)) return;
    let remaining = paymentAllocationCap(payment);
    allocations.forEach(allocation => {
      const rentalId = String(allocation.rentalId || '').trim();
      const requested = allocationAmount(allocation);
      if (!rentalId || requested <= 0 || remaining <= 0) return;
      const amount = Math.min(requested, remaining);
      byRentalId.set(rentalId, (byRentalId.get(rentalId) ?? 0) + amount);
      remaining -= amount;
    });
  });

  const seenLegacyPaymentIds = new Set<string>();
  payments.forEach(payment => {
    if (!payment.rentalId || !shouldCountPayment(payment) || allocationsByPaymentId.has(paymentId(payment))) return;
    const id = paymentId(payment);
    if (id) {
      if (seenLegacyPaymentIds.has(id)) return;
      seenLegacyPaymentIds.add(id);
    }
    const amount = paymentAllocationCap(payment);
    if (amount <= 0) return;
    byRentalId.set(payment.rentalId, (byRentalId.get(payment.rentalId) ?? 0) + amount);
  });

  return byRentalId;
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

type FrontendDebtorIdentity = {
  counterpartyId: string | null;
  status: ArDebtorIdentityStatus;
  issues: string[];
};

function clientsByStableId(clients: Client[]): Map<string, Client[]> {
  const index = new Map<string, Client[]>();
  clients.forEach(client => {
    const id = String(client?.id || '').trim();
    if (!id) return;
    index.set(id, [...(index.get(id) ?? []), client]);
  });
  return index;
}

function frontendDebtorIdentity(
  record: { counterpartyId?: unknown; clientId?: unknown },
  clientIndex: Map<string, Client[]>,
): FrontendDebtorIdentity {
  const directCounterpartyId = String(record?.counterpartyId || '').trim();
  const clientId = String(record?.clientId || '').trim();
  const matches = clientId ? (clientIndex.get(clientId) ?? []) : [];
  if (matches.length > 1) {
    return { counterpartyId: null, status: 'ambiguous', issues: ['AR_DEBTOR_RELATION_AMBIGUOUS'] };
  }
  const clientCounterpartyId = String(matches[0]?.counterpartyId || '').trim();
  if (clientId && matches.length === 0) {
    return { counterpartyId: null, status: 'orphan_client', issues: ['AR_DEBTOR_ORPHAN_CLIENT'] };
  }
  if (directCounterpartyId && clientCounterpartyId && directCounterpartyId !== clientCounterpartyId) {
    return { counterpartyId: null, status: 'mismatch', issues: ['AR_DEBTOR_IDENTITY_MISMATCH'] };
  }
  const counterpartyId = directCounterpartyId || clientCounterpartyId;
  if (!counterpartyId) {
    return { counterpartyId: null, status: 'unresolved', issues: ['AR_DEBTOR_IDENTITY_UNRESOLVED'] };
  }
  return {
    counterpartyId,
    status: directCounterpartyId && clientCounterpartyId
      ? 'matching_dual_id'
      : directCounterpartyId
        ? 'counterparty_only'
        : 'legacy_resolved',
    issues: [],
  };
}

function frontendDebtorKey(identity: FrontendDebtorIdentity, domain: string, recordId: string, sourceIndex: number): string {
  return identity.counterpartyId
    ? `counterparty:${identity.counterpartyId}`
    : `unresolved:${domain}:${recordId || 'missing_id'}:${sourceIndex}:${identity.status}`;
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
  paymentAllocations: PaymentAllocation[] = [],
): RentalDebtRow[] {
  const paidByRentalId = buildAllocatedAmountsByRental(payments, paymentAllocations);

  return rentals
    .filter(shouldCountRental)
    .map(rental => {
      const paidAmount = paidByRentalId.get(rental.id) ?? 0;
      const billing = calculateRentalBilling(rental);
      const amount = billing.finalRentalAmount;
      const outstanding = Math.max(0, amount - paidAmount);
      const paymentStatus: GanttRentalData['paymentStatus'] = outstanding <= 0
        ? 'paid'
        : paidAmount > 0
          ? 'partial'
          : 'unpaid';
      const counterpartyId = String(rental.counterpartyId || '').trim();
      return {
        rentalId: rental.id,
        counterpartyId: counterpartyId || undefined,
        debtorCounterpartyId: counterpartyId || null,
        debtorIdentityStatus: counterpartyId ? 'counterparty_only' as const : 'unresolved' as const,
        debtorIdentityIssues: counterpartyId ? [] : ['AR_DEBTOR_IDENTITY_UNRESOLVED'],
        clientId: stableClientId(rental) || undefined,
        client: getClientName(rental),
        objectId: rental.objectId || undefined,
        contractId: rental.contractId || undefined,
        equipmentInv: rental.equipmentInv,
        manager: rental.manager,
        managerId: (rental as unknown as { managerId?: string }).managerId,
        documentId: (rental as unknown as { documentId?: string }).documentId,
        startDate: rental.startDate,
        endDate: rental.endDate,
        expectedPaymentDate: rental.expectedPaymentDate,
        amount,
        grossAmount: billing.grossRentalAmount,
        downtimeAdjustmentAmount: billing.downtimeAdjustmentAmount,
        downtimeDays: billing.downtimeDays,
        billingDowntimeDays: billing.billingDowntimeDays,
        billableDays: billing.billableDays,
        paidAmount,
        outstanding,
        paymentStatus,
        rentalStatus: rental.status,
      };
    })
    .filter(row => row.outstanding > 0 || row.paymentStatus !== 'paid')
    .sort((a, b) => b.outstanding - a.outstanding);
}

function isActiveRentalStatus(status: unknown): boolean {
  return ['active', 'created', 'confirmed', 'return_planned'].includes(normalizeStatus(status));
}

function getDebtAgeBucket(overdueDays: number): OverdueBucketRow {
  if (overdueDays <= 7) return DEBT_AGE_BUCKETS[0];
  if (overdueDays <= 14) return DEBT_AGE_BUCKETS[1];
  if (overdueDays <= 30) return DEBT_AGE_BUCKETS[2];
  if (overdueDays <= 60) return DEBT_AGE_BUCKETS[3];
  return DEBT_AGE_BUCKETS[4];
}

function getDebtAgeBucketKey(overdueDays: number): string {
  return getDebtAgeBucket(overdueDays).key;
}

function cloneDebtAgeBuckets(): OverdueBucketRow[] {
  return DEBT_AGE_BUCKETS.map(item => ({ ...item }));
}

export function buildClientReceivables(
  clients: Client[],
  rentalDebtRows: RentalDebtRow[],
): ClientReceivableRow[] {
  const clientIndex = clientsByStableId(clients);
  const map = new Map<string, ClientReceivableRow>();
  const today = new Date().toISOString().slice(0, 10);

  rentalDebtRows.forEach((row, sourceIndex) => {
    const rowClientId = stableClientId(row);
    const identity = frontendDebtorIdentity(row, clientIndex);
    const counterpartyClients = identity.counterpartyId
      ? clients.filter(client => client.counterpartyId === identity.counterpartyId)
      : [];
    const linkedClient = rowClientId ? clientIndex.get(rowClientId)?.[0] : undefined;
    const client = linkedClient?.counterpartyId === identity.counterpartyId
      ? linkedClient
      : counterpartyClients[0] ?? linkedClient;
    const key = frontendDebtorKey(identity, 'rental_debt_rows', row.rentalId, sourceIndex);
    const clientIds = counterpartyClients.map(item => item.id).filter(Boolean);
    if (rowClientId && !clientIds.includes(rowClientId)) clientIds.push(rowClientId);
    const existing = map.get(key) ?? {
      counterpartyId: identity.counterpartyId || undefined,
      debtorCounterpartyId: identity.counterpartyId,
      debtorIdentityStatus: identity.status,
      debtorIdentityIssues: identity.issues,
      clientId: client?.id ?? (rowClientId || undefined),
      clientIds,
      client: client?.company ?? (row.client || 'Клиент не привязан'),
      creditLimit: client?.creditLimit ?? 0,
      currentDebt: 0,
      manualDebt: 0,
      unpaidRentals: 0,
      overdueRentals: 0,
      exceededLimit: false,
      dataIssue: identity.counterpartyId ? undefined : 'unresolved_debtor_identity',
    };
    clientIds.forEach(clientId => {
      if (!existing.clientIds?.includes(clientId)) existing.clientIds?.push(clientId);
    });
    existing.clientIds?.sort();
    existing.currentDebt += row.outstanding;
    existing.unpaidRentals += 1;
    if ((row.expectedPaymentDate && row.expectedPaymentDate < today) || row.endDate < today) {
      existing.overdueRentals += 1;
    }
    existing.exceededLimit = existing.creditLimit > 0 && existing.currentDebt > existing.creditLimit;
    map.set(key, existing);
  });

  clients.forEach((client, sourceIndex) => {
    const manualDebt = toMoney(client.debt);
    if (manualDebt <= 0) return;
    const identity = frontendDebtorIdentity({
      counterpartyId: client.counterpartyId,
      clientId: client.id,
    }, clientIndex);
    const key = frontendDebtorKey(identity, 'manual_client_debt', client.id, sourceIndex);
    const clientIds = identity.counterpartyId
      ? clients.filter(item => item.counterpartyId === identity.counterpartyId).map(item => item.id)
      : [client.id];
    const existing = map.get(key) ?? {
      counterpartyId: identity.counterpartyId || undefined,
      debtorCounterpartyId: identity.counterpartyId,
      debtorIdentityStatus: identity.status,
      debtorIdentityIssues: identity.issues,
      clientId: client.id || undefined,
      clientIds,
      client: client.company || 'Клиент не привязан',
      creditLimit: client.creditLimit ?? 0,
      currentDebt: 0,
      manualDebt: 0,
      unpaidRentals: 0,
      overdueRentals: 0,
      exceededLimit: false,
      dataIssue: identity.counterpartyId ? undefined : 'unresolved_debtor_identity',
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
  paymentAllocations: PaymentAllocation[] = [],
): ClientFinancialSnapshot[] {
  const debtRows = buildRentalDebtRows(rentals, payments, paymentAllocations);
  const receivables = buildClientReceivables(clients, debtRows);
  const clientIndex = clientsByStableId(clients);
  const receivableMap = new Map(
    receivables
      .filter(item => item.counterpartyId)
      .map(item => [String(item.counterpartyId), item] as const),
  );

  return clients
    .map(client => {
      const identity = frontendDebtorIdentity({ counterpartyId: client.counterpartyId, clientId: client.id }, clientIndex);
      const clientRentals = rentals.filter(item => {
        const rentalIdentity = frontendDebtorIdentity({
          counterpartyId: item.counterpartyId,
          clientId: stableClientId(item),
        }, clientIndex);
        return Boolean(identity.counterpartyId && rentalIdentity.counterpartyId === identity.counterpartyId);
      });
      const latestRental = clientRentals
        .slice()
        .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];
      const receivable = identity.counterpartyId ? receivableMap.get(identity.counterpartyId) : undefined;
      return {
        counterpartyId: identity.counterpartyId || undefined,
        debtorCounterpartyId: identity.counterpartyId,
        debtorIdentityStatus: identity.status,
        debtorIdentityIssues: identity.issues,
        clientId: client.id,
        clientIds: identity.counterpartyId
          ? clients.filter(item => item.counterpartyId === identity.counterpartyId).map(item => item.id)
          : [client.id],
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
        dataIssue: identity.counterpartyId ? undefined : 'unresolved_debtor_identity' as const,
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
  const clientIndex = clientsByStableId(clients);

  rentalDebtRows.forEach((row, sourceIndex) => {
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
    const identity = frontendDebtorIdentity(row, clientIndex);
    item.clients.add(frontendDebtorKey(identity, 'manager_rental_debt', row.rentalId, sourceIndex));
    item.clientsCount = item.clients.size;
    map.set(key, item);
  });

  clients.forEach((client, sourceIndex) => {
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
    const identity = frontendDebtorIdentity({ counterpartyId: client.counterpartyId, clientId: client.id }, clientIndex);
    item.clients.add(frontendDebtorKey(identity, 'manager_manual_debt', client.id, sourceIndex));
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
  const buckets = cloneDebtAgeBuckets();

  rentalDebtRows.forEach(row => {
    if (row.outstanding <= 0) return;
    const overdueDays = getRentalDebtOverdueDays(row, today);
    const bucket = buckets.find(item => item.key === getDebtAgeBucketKey(overdueDays)) ?? buckets[0];
    bucket.rentals += 1;
    bucket.debt += row.outstanding;
  });

  return buckets;
}

export function buildClientDebtAgingRows(
  clients: Client[],
  rentalDebtRows: RentalDebtRow[],
  today = new Date().toISOString().slice(0, 10),
): ClientDebtAgingRow[] {
  const clientIndex = clientsByStableId(clients);
  const map = new Map<string, ClientDebtAgingRow>();

  rentalDebtRows.forEach((row, sourceIndex) => {
    if (row.outstanding <= 0) return;
    const rowClientId = stableClientId(row);
    const identity = frontendDebtorIdentity(row, clientIndex);
    const counterpartyClients = identity.counterpartyId
      ? clients.filter(item => item.counterpartyId === identity.counterpartyId)
      : [];
    const linkedClient = rowClientId ? clientIndex.get(rowClientId)?.[0] : undefined;
    const client = linkedClient?.counterpartyId === identity.counterpartyId
      ? linkedClient
      : counterpartyClients[0] ?? linkedClient;
    const overdueDays = getRentalDebtOverdueDays(row, today);
    const bucket = getDebtAgeBucket(overdueDays);
    const hasActiveRental = isActiveRentalStatus(row.rentalStatus);
    const clientName = client?.company ?? (row.client || 'Клиент не привязан');
    const manager = row.manager || client?.manager || 'Не назначен';
    const key = [
      frontendDebtorKey(identity, 'client_debt_aging', row.rentalId, sourceIndex),
      manager,
      bucket.key,
      hasActiveRental ? 'active' : 'inactive',
    ].join('|');
    const existing = map.get(key) ?? {
      counterpartyId: identity.counterpartyId || undefined,
      debtorCounterpartyId: identity.counterpartyId,
      debtorIdentityStatus: identity.status,
      debtorIdentityIssues: identity.issues,
      clientId: client?.id ?? (rowClientId || undefined),
      clientIds: counterpartyClients.map(item => item.id),
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
    existing.debt += row.outstanding;
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

export function mergeClientsWithFinancials(
  clients: Client[],
  rentals: GanttRentalData[],
  payments: Payment[],
  paymentAllocations: PaymentAllocation[] = [],
): Client[] {
  const snapshots = buildClientFinancialSnapshots(clients, rentals, payments, paymentAllocations);
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
