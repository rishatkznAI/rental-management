import type { Equipment } from '../types';
import type { EquipmentPreviewField } from '../pages/equipment/equipment.types';

export function buildEquipmentQuickViewGsmFields(
  selectedEquipment?: Partial<Equipment>,
  signalOptions?: { nowMs?: number; onlineWindowMs?: number },
): EquipmentPreviewField[];
