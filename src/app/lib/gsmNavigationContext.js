export function resolveRequestedGsmEquipmentId(searchParams, visibleEquipmentIds = []) {
  const requested = String(searchParams?.get?.('equipmentId') || '').trim();
  if (!requested) return '';
  const visibleIds = new Set(
    (Array.isArray(visibleEquipmentIds) ? visibleEquipmentIds : [])
      .map(value => String(value || '').trim())
      .filter(Boolean),
  );
  return visibleIds.has(requested) ? requested : '';
}

export function findExactVisibleGsmEquipment(items = [], equipmentId = '') {
  const requested = String(equipmentId || '').trim();
  if (!requested) return null;
  return (Array.isArray(items) ? items : []).find(item => String(item?.id || '').trim() === requested) || null;
}
