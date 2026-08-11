import type { QueryClient } from '@tanstack/react-query';
import type { GanttRentalData } from '../mock-data';
import type { Rental } from '../types';
import type { RentalAvailabilityConflict, RentalCreditRiskSnapshot } from '../services/rentals.service';
import { CLIENT_KEYS } from '../hooks/useClients';
import { EQUIPMENT_KEYS } from '../hooks/useEquipment';
import { PAYMENT_KEYS } from '../hooks/usePayments';
import { RENTAL_KEYS } from '../hooks/useRentals';

export const CLIENT_FINANCIAL_RISK_KEYS = {
  detail: (clientId: string) => ['client-financial-risk', clientId] as const,
};

const RENTAL_CREATE_REFRESH_KEYS = {
  success: [RENTAL_KEYS.all, EQUIPMENT_KEYS.all],
  financialConflict: [RENTAL_KEYS.all, CLIENT_KEYS.all, PAYMENT_KEYS.all],
  availabilityConflict: [RENTAL_KEYS.all, EQUIPMENT_KEYS.all],
} as const;

export function cacheFinancialRiskConflict(qc: QueryClient, risk: RentalCreditRiskSnapshot) {
  qc.setQueryData(CLIENT_FINANCIAL_RISK_KEYS.detail(risk.clientId), risk);
}

export function cacheAvailabilityConflict(qc: QueryClient, conflict: RentalAvailabilityConflict) {
  qc.setQueryData<GanttRentalData[]>(RENTAL_KEYS.gantt, current => {
    const existing = current || [];
    const alreadyPresent = existing.some(item =>
      item.id === conflict.rentalId
      || item.rentalId === conflict.rentalId
      || item.sourceRentalId === conflict.rentalId
      || item.originalRentalId === conflict.rentalId
    );
    if (alreadyPresent) return existing;
    return [...existing, {
      id: `conflict:${conflict.rentalId}`,
      rentalId: conflict.rentalId,
      clientId: conflict.clientId || undefined,
      client: conflict.client || 'Другой клиент',
      clientShort: (conflict.client || 'Другой клиент').slice(0, 20),
      equipmentId: conflict.equipmentId || undefined,
      equipmentInv: conflict.equipmentInv,
      startDate: conflict.startDate,
      endDate: conflict.endDate,
      manager: '',
      managerInitials: '',
      status: 'active',
      paymentStatus: 'unpaid',
      updSigned: false,
      amount: 0,
      comments: [],
    }];
  });
}

export function cacheCreatedRental(qc: QueryClient, created: Rental) {
  qc.setQueryData(RENTAL_KEYS.detail(created.id), created);
  qc.setQueryData<Rental[]>(RENTAL_KEYS.all, current => current
    ? [...current.filter(item => item.id !== created.id), created]
    : current);
}

export async function refreshRentalCreateCaches(
  qc: QueryClient,
  reason: keyof typeof RENTAL_CREATE_REFRESH_KEYS,
) {
  await Promise.allSettled(
    RENTAL_CREATE_REFRESH_KEYS[reason].map(queryKey => qc.invalidateQueries({ queryKey })),
  );
}
