const { getRentalBillingAmount } = require('./rental-billing');

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

function normalizeStatus(value) {
  return String(value || '').trim().toLowerCase();
}

function shouldCountPayment(payment) {
  return !IGNORED_PAYMENT_STATUSES.has(normalizeStatus(payment?.status));
}

function getEffectivePaidAmount(payment) {
  if (!payment) return 0;
  if (!shouldCountPayment(payment)) return 0;
  if (typeof payment.paidAmount === 'number') {
    return Number.isFinite(payment.paidAmount) && payment.paidAmount > 0 ? payment.paidAmount : 0;
  }
  if (payment.status === 'paid') {
    const amount = Number(payment.amount);
    return Number.isFinite(amount) && amount > 0 ? amount : 0;
  }
  return 0;
}

function deriveRentalPaymentStatus(rental, payments) {
  if (!rental) return 'unpaid';

  const totalAmount = getRentalBillingAmount(rental);
  const rentalIds = new Set([
    rental.id,
    rental.rentalId,
    rental.sourceRentalId,
    rental.originalRentalId,
  ].map(value => String(value || '').trim()).filter(Boolean));
  const totalPaid = (payments || [])
    .filter(payment => rentalIds.has(String(payment?.rentalId || '').trim()))
    .reduce((sum, payment) => sum + getEffectivePaidAmount(payment), 0);

  if (totalPaid >= totalAmount) return 'paid';
  if (totalPaid > 0) return 'partial';
  return 'unpaid';
}

function getPaymentAllocationAmount(allocation) {
  const amount = Number(allocation?.amount ?? allocation?.allocatedAmount);
  return Number.isFinite(amount) && amount > 0 ? amount : 0;
}

function buildPaymentsForStatusSync(payments, paymentAllocations) {
  if (!Array.isArray(paymentAllocations) || paymentAllocations.length === 0) return payments;

  const allocationsByPaymentId = new Map();
  for (const allocation of paymentAllocations) {
    const paymentId = String(allocation?.paymentId || '').trim();
    if (!paymentId || normalizeStatus(allocation?.status) === 'cancelled') continue;
    if (!allocationsByPaymentId.has(paymentId)) allocationsByPaymentId.set(paymentId, []);
    allocationsByPaymentId.get(paymentId).push(allocation);
  }
  if (allocationsByPaymentId.size === 0) return payments;

  const normalized = [];
  for (const payment of payments || []) {
    const paymentId = String(payment?.id || '').trim();
    const allocations = paymentId ? allocationsByPaymentId.get(paymentId) : null;
    if (!allocations) {
      normalized.push(payment);
      continue;
    }
    const cap = getEffectivePaidAmount(payment);
    let remaining = cap;
    for (const allocation of allocations) {
      if (remaining <= 0) break;
      const requested = getPaymentAllocationAmount(allocation);
      if (requested <= 0) continue;
      const amount = Math.min(requested, remaining);
      remaining -= amount;
      normalized.push({
        ...payment,
        rentalId: allocation.rentalId,
        amount,
        paidAmount: amount,
      });
    }
  }
  return normalized;
}

function syncGanttRentalPaymentStatuses(ganttRentals, payments, paymentAllocations) {
  const statusPayments = buildPaymentsForStatusSync(payments, paymentAllocations);
  return (ganttRentals || []).map((rental) => {
    const nextStatus = deriveRentalPaymentStatus(rental, statusPayments);
    if (rental.paymentStatus === nextStatus) return rental;
    return {
      ...rental,
      paymentStatus: nextStatus,
    };
  });
}

module.exports = {
  shouldCountPayment,
  getEffectivePaidAmount,
  deriveRentalPaymentStatus,
  syncGanttRentalPaymentStatuses,
  buildPaymentsForStatusSync,
};
