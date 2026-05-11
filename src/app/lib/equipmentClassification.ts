import type { Equipment, EquipmentCategory, EquipmentDrive, EquipmentPriority, EquipmentSaleCondition, EquipmentSalePdiStatus, EquipmentSaleReceiptStatus } from '../types';
import { DEFAULT_EQUIPMENT_TYPE_CATALOG, findEquipmentTypeLabel } from './equipmentTypes';
import { normalizeEquipmentSaleCondition, saleStatusKind } from './equipmentSaleMode.js';

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

const ACTIVE_IN_FLEET_ALIAS_KEYS = [
  'activeInFleet',
  'rentalFleet',
  'isRentalFleet',
  'inRentalFleet',
  'availableForRent',
  'isRental',
] as const;

export const EQUIPMENT_PRIORITY_LABELS: Record<EquipmentPriority, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
};

export const EQUIPMENT_PRIORITY_ORDER: Record<EquipmentPriority, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
};

export const EQUIPMENT_SALE_PDI_LABELS: Record<EquipmentSalePdiStatus, string> = {
  not_started: 'PDI не начат',
  in_progress: 'PDI в работе',
  issues: 'PDI есть замечания',
  ready: 'PDI готов',
};

export const EQUIPMENT_SALE_RECEIPT_LABELS: Record<EquipmentSaleReceiptStatus, string> = {
  planned_arrival: 'Планируется поступление',
  arrived_waiting_acceptance: 'Ожидает приёмки',
  acceptance_in_progress: 'Приёмка в работе',
  accepted: 'Принята',
  acceptance_rejected: 'С замечаниями',
  cancelled: 'Отменено',
};

export const EQUIPMENT_SALE_RECEIPT_OPTIONS = Object.entries(EQUIPMENT_SALE_RECEIPT_LABELS)
  .map(([value, label]) => ({ value: value as EquipmentSaleReceiptStatus, label }));

function hasOwn(source: object, key: string) {
  return Object.prototype.hasOwnProperty.call(source, key);
}

function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (value === 1) return true;
    if (value === 0) return false;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y', 'да', 'активна', 'active', 'rental', 'rent', 'fleet', 'rental_fleet'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n', 'нет', 'неактивна', 'inactive', 'sale', 'sales', 'sold', 'client', 'archive', 'archived'].includes(normalized)) return false;
  }
  return undefined;
}

export function normalizeEquipmentActiveInFleet(equipment: Partial<Equipment> & Record<string, unknown>, fallback = true): boolean {
  for (const key of ACTIVE_IN_FLEET_ALIAS_KEYS) {
    if (!hasOwn(equipment, key)) continue;
    const normalized = coerceBoolean(equipment[key]);
    if (normalized !== undefined) return normalized;
  }
  return fallback;
}

export function normalizeEquipment<T extends Partial<Equipment>>(equipment: T): T & Pick<Equipment, 'category' | 'activeInFleet' | 'priority' | 'isForSale' | 'salePdiStatus'> {
  const saleCondition = normalizeEquipmentSaleCondition(equipment) as EquipmentSaleCondition | undefined;
  return {
    ...equipment,
    category: equipment.category ?? 'own',
    activeInFleet: normalizeEquipmentActiveInFleet(equipment as T & Record<string, unknown>, true),
    priority: equipment.priority ?? 'medium',
    isForSale: equipment.isForSale ?? false,
    ...(saleCondition ? { saleCondition } : {}),
    salePdiStatus: equipment.salePdiStatus ?? 'not_started',
  };
}

export function normalizeEquipmentList<T extends Partial<Equipment>>(list: T[]): Array<T & Pick<Equipment, 'category' | 'activeInFleet' | 'priority' | 'isForSale' | 'salePdiStatus'>> {
  return list.map(normalizeEquipment);
}

export function normalizeEquipmentPatch<T extends Partial<Equipment>>(equipment: T): T {
  const source = equipment as T & Record<string, unknown>;
  const saleCondition = normalizeEquipmentSaleCondition(equipment) as EquipmentSaleCondition | undefined;
  const hasActiveInFleet = ACTIVE_IN_FLEET_ALIAS_KEYS.some(key => hasOwn(source, key));
  const {
    rentalFleet: _rentalFleet,
    isRentalFleet: _isRentalFleet,
    inRentalFleet: _inRentalFleet,
    availableForRent: _availableForRent,
    isRental: _isRental,
    ...rest
  } = source;
  return {
    ...(rest as T),
    ...(hasActiveInFleet ? { activeInFleet: normalizeEquipmentActiveInFleet(source, true) } : {}),
    ...(saleCondition ? { saleCondition } : {}),
  };
}

export function canEquipmentParticipateInRentals(equipment: Partial<Equipment>): boolean {
  const normalized = normalizeEquipment(equipment);
  return saleStatusKind(normalized) !== 'sold'
    && normalized.activeInFleet
    && (normalized.category === 'own' || normalized.category === 'partner');
}

const DRIVE_LABELS: Record<EquipmentDrive, string> = {
  diesel: 'Дизельный',
  electric: 'Электрический',
};

const TYPE_LABELS: Record<string, string> = {
  scissor: 'ножничный подъемник',
  articulated: 'коленчатый подъемник',
  telescopic: 'телескопический подъемник',
  mast: 'мачтовый подъемник',
};

export function getEquipmentTypeLabel(equipment: Partial<Equipment>): string {
  const drive = equipment.drive ? DRIVE_LABELS[equipment.drive] : '';
  const defaultLabel = equipment.type ? findEquipmentTypeLabel(equipment.type, DEFAULT_EQUIPMENT_TYPE_CATALOG) : '';
  const type = equipment.type ? (TYPE_LABELS[equipment.type] || defaultLabel.toLowerCase()) : '';
  const label = [drive, type].filter(Boolean).join(' ');
  if (label) return label.charAt(0).toUpperCase() + label.slice(1);
  return equipment.model ? `Подъемник ${equipment.model}` : 'Подъемник';
}

export function compareEquipmentByPriority(a: Partial<Equipment>, b: Partial<Equipment>) {
  const aPriority = normalizeEquipment(a).priority;
  const bPriority = normalizeEquipment(b).priority;
  const byPriority = EQUIPMENT_PRIORITY_ORDER[aPriority] - EQUIPMENT_PRIORITY_ORDER[bPriority];
  if (byPriority !== 0) return byPriority;
  return (a.inventoryNumber || '').localeCompare(b.inventoryNumber || '', 'ru', { numeric: true, sensitivity: 'base' });
}
