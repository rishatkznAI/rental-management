export function resolveRequestedGsmEquipmentId(
  searchParams: Pick<URLSearchParams, 'get'> | null | undefined,
  visibleEquipmentIds?: unknown[],
): string;

export function findExactVisibleGsmEquipment<T extends { id?: unknown }>(
  items?: T[],
  equipmentId?: unknown,
): T | null;
