import type { Equipment } from '../types';

export const PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID = 'SMOKE-RENTAL-001';
export const PRODUCTION_SMOKE_FIXTURE_PROTECTED_MESSAGE = 'Используется для production smoke-проверок. Нельзя удалить, продать или перевести в другой режим.';

export const PRODUCTION_SMOKE_FIXTURE_PROTECTED_FIELDS = new Set<keyof Equipment>([
  'inventoryNumber',
  'serialNumber',
  'category',
  'activeInFleet',
  'isForSale',
  'forSale',
  'saleMode',
  'saleStatus',
  'salesStatus',
  'saleCondition',
  'salePdiStatus',
  'saleReceiptStatus',
  'plannedArrivalDate',
  'actualArrivalDate',
  'salePrice1',
  'salePrice2',
  'salePrice3',
  'status',
]);

function text(value: unknown) {
  return String(value ?? '').trim();
}

export function isProductionSmokeEquipmentFixture(equipment: Partial<Equipment> | null | undefined) {
  if (!equipment) return false;
  return text(equipment.inventoryNumber) === PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID
    || text(equipment.serialNumber) === PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID;
}

export function stripProductionSmokeFixtureProtectedPatch<T extends Partial<Equipment>>(patch: T): T {
  const next = { ...patch } as Partial<Equipment>;
  for (const field of PRODUCTION_SMOKE_FIXTURE_PROTECTED_FIELDS) {
    delete next[field];
  }
  return next as T;
}

export function productionSmokeFixtureErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || '');
  if (message.includes('SYSTEM_FIXTURE_PROTECTED') || message.includes(PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID)) {
    return PRODUCTION_SMOKE_FIXTURE_PROTECTED_MESSAGE;
  }
  return message || 'Не удалось сохранить карточку техники';
}
