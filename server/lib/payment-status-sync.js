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

  const amount = Number(rental.amount);
  const totalAmount = Number.isFinite(amount) && amount > 0 ? amount : 0;
  const totalPaid = (payments || [])
    .filter(payment => payment?.rentalId === rental.id)
    .reduce((sum, payment) => sum + getEffectivePaidAmount(payment), 0);

  if (totalPaid >= totalAmount) return 'paid';
  if (totalPaid > 0) return 'partial';
  return 'unpaid';
}

function syncGanttRentalPaymentStatuses(ganttRentals, payments) {
  return (ganttRentals || []).map((rental) => {
    const nextStatus = deriveRentalPaymentStatus(rental, payments);
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
};
