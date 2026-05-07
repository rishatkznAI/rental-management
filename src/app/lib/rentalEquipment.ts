import type { Equipment, Rental } from '../types';
import type { GanttRentalData } from '../mock-data';

type RentalEquipmentRecord = Partial<Rental> & Partial<GanttRentalData> & {
  inventoryNumber?: string | null;
  serialNumber?: string | null;
  equipmentInv?: string | null;
  equipmentId?: string | null;
  inv?: string | null;
  equipment?: unknown;
};

export type RentalEquipmentResolution = {
  equipmentId: string;
  equipment: Equipment | null;
  displayName: string;
  inventoryNumber: string;
  serialNumber: string;
  source: string;
  warnings: string[];
};

function text(value: unknown): string {
  const normalized = String(value ?? '').trim();
  return normalized && normalized !== 'undefined' && normalized !== 'null' ? normalized : '';
}

function unique(values: unknown[]): string[] {
  return [...new Set(values.flat().map(text).filter(Boolean))];
}

function label(equipment: Equipment | null, fallback = ''): string {
  if (!equipment) return text(fallback);
  return [equipment.manufacturer, equipment.model].map(text).filter(Boolean).join(' ')
    || text(equipment.inventoryNumber || equipment.serialNumber || equipment.id || fallback);
}

function uniqueBy<T>(items: T[], selector: (item: T) => string): Map<string, T> {
  const counts = new Map<string, number>();
  const byValue = new Map<string, T>();
  for (const item of items) {
    const value = selector(item);
    if (!value) continue;
    if (!byValue.has(value)) byValue.set(value, item);
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  for (const [value, count] of counts) {
    if (count !== 1) byValue.delete(value);
  }
  return byValue;
}

export function resolveRentalEquipment(
  rental: RentalEquipmentRecord | null | undefined,
  equipmentList: Equipment[] = [],
): RentalEquipmentResolution {
  const warnings: string[] = [];
  const byId = new Map(equipmentList.map(item => [text(item.id), item]).filter(([id]) => id));
  const byInventory = uniqueBy(equipmentList, item => text(item.inventoryNumber));
  const byEquipmentInv = uniqueBy(equipmentList, item => text((item as Equipment & { equipmentInv?: string; inv?: string }).equipmentInv || (item as Equipment & { inv?: string }).inv));
  const bySerial = uniqueBy(equipmentList, item => text(item.serialNumber));
  const equipmentId = text(rental?.equipmentId);

  const make = (equipment: Equipment | null, source: string, ref = ''): RentalEquipmentResolution => ({
    equipmentId: text(equipment?.id),
    equipment,
    displayName: label(equipment, ref),
    inventoryNumber: text(equipment?.inventoryNumber || ref),
    serialNumber: text(equipment?.serialNumber),
    source,
    warnings,
  });

  if (equipmentId) {
    const equipment = byId.get(equipmentId) || null;
    if (equipment) return make(equipment, 'equipmentId', equipmentId);
    warnings.push(`equipmentId_not_found:${equipmentId}`);
  }

  const scalarRefs: Array<[string, unknown, Map<string, Equipment>]> = [
    ['equipment.id', rental?.equipmentId, byId],
    ['equipment.inventoryNumber', rental?.equipmentInv, byInventory],
    ['equipment.inventoryNumber', rental?.inventoryNumber, byInventory],
    ['equipment.equipmentInv', rental?.equipmentInv, byEquipmentInv],
    ['equipment.equipmentInv', rental?.inventoryNumber, byEquipmentInv],
    ['equipment.serialNumber', rental?.serialNumber, bySerial],
  ];
  for (const [source, value, lookup] of scalarRefs) {
    const ref = text(value);
    if (!ref) continue;
    const equipment = lookup.get(ref) || null;
    if (equipment) return make(equipment, source, ref);
  }

  const legacyRefs = unique(Array.isArray(rental?.equipment) ? rental.equipment as unknown[] : []);
  for (const ref of legacyRefs) {
    const equipment = byId.get(ref) || byInventory.get(ref) || byEquipmentInv.get(ref) || bySerial.get(ref) || null;
    if (equipment) return make(equipment, 'legacy.rental.equipment', ref);
  }

  return make(null, 'unresolved', legacyRefs[0] || equipmentId);
}
