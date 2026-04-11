import type { Equipment, EquipmentCategory } from '../types';

export const EQUIPMENT_CATEGORY_LABELS: Record<EquipmentCategory, string> = {
  own: 'Собственная',
  sold: 'Проданная',
  client: 'Клиентская',
  partner: 'Партнёрская',
};

export const ACTIVE_FLEET_LABELS = {
  yes: 'Да',
  no: 'Нет',
} as const;

export function normalizeEquipment<T extends Partial<Equipment>>(equipment: T): T & Pick<Equipment, 'category' | 'activeInFleet'> {
  return {
    ...equipment,
    category: equipment.category ?? 'own',
    activeInFleet: equipment.activeInFleet ?? true,
  };
}

export function normalizeEquipmentList<T extends Partial<Equipment>>(list: T[]): Array<T & Pick<Equipment, 'category' | 'activeInFleet'>> {
  return list.map(normalizeEquipment);
}

export function canEquipmentParticipateInRentals(equipment: Partial<Equipment>): boolean {
  const normalized = normalizeEquipment(equipment);
  return normalized.activeInFleet && (normalized.category === 'own' || normalized.category === 'partner');
}
