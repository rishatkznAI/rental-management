import type { GanttRentalData } from '../mock-data';
import type { Client, Payment } from '../types';

export interface RentalDebtRow {
  rentalId: string;
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
  unpaidRentals: number;
  overdueRentals: number;
  exceededLimit: boolean;
}

export interface ClientFinancialSnapshot extends ClientReceivableRow {
  totalRentals: number;
  activeRentals: number;
  lastRentalDate?: string;
}

function getEffectivePaidAmount(payment: Payment): number {
  if (typeof payment.paidAmount === 'number') return payment.paidAmount;
  if (payment.status === 'paid') return payment.amount;
  return 0;
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
      const paidAmount = relatedPayments.reduce((sum, payment) => sum + getEffectivePaidAmount(payment), 0);
      const outstanding = Math.max(0, (rental.amount || 0) - paidAmount);
      return {
        rentalId: rental.id,
        client: rental.client,
        equipmentInv: rental.equipmentInv,
        manager: rental.manager,
        startDate: rental.startDate,
        endDate: rental.endDate,
        expectedPaymentDate: rental.expectedPaymentDate,
        amount: rental.amount || 0,
        paidAmount,
        outstanding,
        paymentStatus: rental.paymentStatus,
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
  const clientsByName = new Map(clients.map(client => [client.company, client] as const));
  const map = new Map<string, ClientReceivableRow>();
  const today = new Date().toISOString().slice(0, 10);

  rentalDebtRows.forEach(row => {
    const existing = map.get(row.client) ?? {
      clientId: clientsByName.get(row.client)?.id,
      client: row.client,
      creditLimit: clientsByName.get(row.client)?.creditLimit ?? 0,
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

  return Array.from(map.values()).sort((a, b) => b.currentDebt - a.currentDebt);
}

export function buildClientFinancialSnapshots(
  clients: Client[],
  rentals: GanttRentalData[],
  payments: Payment[],
): ClientFinancialSnapshot[] {
  const debtRows = buildRentalDebtRows(rentals, payments);
  const receivables = buildClientReceivables(clients, debtRows);
  const receivableMap = new Map(receivables.map(item => [item.client, item] as const));

  return clients
    .map(client => {
      const clientRentals = rentals.filter(item => item.client === client.company);
      const latestRental = clientRentals
        .slice()
        .sort((a, b) => new Date(b.startDate).getTime() - new Date(a.startDate).getTime())[0];
      const receivable = receivableMap.get(client.company);
      return {
        clientId: client.id,
        client: client.company,
        creditLimit: client.creditLimit ?? 0,
        currentDebt: receivable?.currentDebt ?? 0,
        unpaidRentals: receivable?.unpaidRentals ?? 0,
        overdueRentals: receivable?.overdueRentals ?? 0,
        exceededLimit: receivable?.exceededLimit ?? false,
        totalRentals: clientRentals.length,
        activeRentals: clientRentals.filter(item => item.status === 'active' || item.status === 'created').length,
        lastRentalDate: latestRental?.startDate ?? client.lastRentalDate,
      };
    })
    .sort((a, b) => b.currentDebt - a.currentDebt || a.client.localeCompare(b.client, 'ru'));
}

export function mergeClientsWithFinancials(
  clients: Client[],
  rentals: GanttRentalData[],
  payments: Payment[],
): Client[] {
  const snapshots = buildClientFinancialSnapshots(clients, rentals, payments);
  const byClient = new Map(snapshots.map(item => [item.client, item] as const));
  return clients.map(client => {
    const financial = byClient.get(client.company);
    if (!financial) return client;
    return {
      ...client,
      debt: financial.currentDebt,
      totalRentals: financial.totalRentals,
      lastRentalDate: financial.lastRentalDate,
    };
  });
}
