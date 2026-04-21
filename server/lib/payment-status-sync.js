function getEffectivePaidAmount(payment) {
  if (!payment) return 0;
  if (typeof payment.paidAmount === 'number') return payment.paidAmount;
  if (payment.status === 'paid') return Number(payment.amount) || 0;
  return 0;
}

function deriveRentalPaymentStatus(rental, payments) {
  if (!rental) return 'unpaid';

  const totalAmount = Number(rental.amount) || 0;
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
  getEffectivePaidAmount,
  deriveRentalPaymentStatus,
  syncGanttRentalPaymentStatuses,
};
