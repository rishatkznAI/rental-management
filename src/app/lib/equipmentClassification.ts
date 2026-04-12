import type { Equipment, EquipmentCategory, EquipmentDrive, EquipmentType } from '../types';

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

const DRIVE_LABELS: Record<EquipmentDrive, string> = {
  diesel: 'Дизельный',
  electric: 'Электрический',
};

const TYPE_LABELS: Record<EquipmentType, string> = {
  scissor: 'ножничный подъемник',
  articulated: 'коленчатый подъемник',
  telescopic: 'телескопический подъемник',
};

export function getEquipmentTypeLabel(equipment: Partial<Equipment>): string {
  const drive = equipment.drive ? DRIVE_LABELS[equipment.drive] : '';
  const type = equipment.type ? TYPE_LABELS[equipment.type] : '';
  const label = [drive, type].filter(Boolean).join(' ');
  if (label) return label.charAt(0).toUpperCase() + label.slice(1);
  return equipment.model ? `Подъемник ${equipment.model}` : 'Подъемник';
}
