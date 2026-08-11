export const RENTAL_NEW_PATH = '/rentals/new';

const RENTAL_ROUTE_KEYS = new Set([
  'clientId',
  'equipmentId',
  'client',
  'clientName',
  'equipmentInv',
  'objectId',
  'contractId',
]);

function cleanText(value) {
  if (value === null || value === undefined) return '';
  return String(value).trim();
}

function pickEntity(canonical, legacy, idKey, aliasKeys, aliasKind) {
  if (canonical.has(idKey)) {
    return { kind: 'id', value: cleanText(canonical.get(idKey)), source: 'canonical' };
  }
  for (const aliasKey of aliasKeys) {
    if (canonical.has(aliasKey)) {
      return { kind: aliasKind, value: cleanText(canonical.get(aliasKey)), source: 'canonical-legacy' };
    }
  }
  if (legacy.has(idKey)) {
    return { kind: 'id', value: cleanText(legacy.get(idKey)), source: 'outer-legacy' };
  }
  for (const aliasKey of aliasKeys) {
    if (legacy.has(aliasKey)) {
      return { kind: aliasKind, value: cleanText(legacy.get(aliasKey)), source: 'outer-legacy' };
    }
  }
  return { kind: 'none', value: '', source: 'none' };
}

function pickLegacyRelation(canonical, legacy, key) {
  if (canonical.has(key)) return cleanText(canonical.get(key));
  if (legacy.has(key)) return cleanText(legacy.get(key));
  return '';
}

/**
 * Parse rental-new routing state. Query inside the hash/router always wins over
 * the legacy query before #, including an explicitly empty canonical value.
 */
export function parseRentalNewRoute({ routerSearch = '', browserSearch = '' } = {}) {
  const canonical = new URLSearchParams(routerSearch);
  const legacy = new URLSearchParams(browserSearch);
  const outerRentalKeys = [...legacy.keys()].filter(key => RENTAL_ROUTE_KEYS.has(key));

  return {
    client: pickEntity(canonical, legacy, 'clientId', ['client', 'clientName'], 'client-name'),
    equipment: pickEntity(canonical, legacy, 'equipmentId', ['equipmentInv'], 'equipment-inventory'),
    legacyObjectId: pickLegacyRelation(canonical, legacy, 'objectId'),
    legacyContractId: pickLegacyRelation(canonical, legacy, 'contractId'),
    hasOuterRentalParams: outerRentalKeys.length > 0,
    hasLegacyHashParams: [...canonical.keys()].some(key => key !== 'clientId' && key !== 'equipmentId'),
  };
}

/** Build the only first-class rental creation route. */
export function buildRentalNewRoute({ clientId, equipmentId } = {}) {
  const params = new URLSearchParams();
  const normalizedClientId = cleanText(clientId);
  const normalizedEquipmentId = cleanText(equipmentId);
  if (normalizedClientId) params.set('clientId', normalizedClientId);
  if (normalizedEquipmentId) params.set('equipmentId', normalizedEquipmentId);
  const query = params.toString();
  return query ? `${RENTAL_NEW_PATH}?${query}` : RENTAL_NEW_PATH;
}

/** Remove only rental-prefill keys from the legacy browser query. */
export function stripRentalNewOuterQuery(browserSearch = '') {
  const params = new URLSearchParams(browserSearch);
  RENTAL_ROUTE_KEYS.forEach(key => params.delete(key));
  const query = params.toString();
  return query ? `?${query}` : '';
}
