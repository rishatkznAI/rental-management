const ACTIVE_RENTAL_STATUSES = new Set(['active', 'created']);

const text = value => String(value ?? '').trim();

function relationMatchesClient(rental, clientId, counterpartyId) {
  const rentalCounterpartyId = text(rental?.counterpartyId);
  if (counterpartyId && rentalCounterpartyId) return rentalCounterpartyId === counterpartyId;
  return Boolean(clientId && text(rental?.clientId) === clientId);
}

function rentalIdentity(rental, index) {
  return text(rental?.rentalId || rental?.sourceRentalId || rental?.originalRentalId || rental?.id)
    || `row:${index}`;
}

function equipmentIdentities(rental) {
  const identities = new Set();
  const add = value => {
    const normalized = text(value);
    if (normalized) identities.add(normalized);
  };
  const equipmentId = text(rental?.equipmentId);
  if (equipmentId) {
    identities.add(equipmentId);
    return identities;
  }
  if (Array.isArray(rental?.equipmentIds) && rental.equipmentIds.length > 0) {
    rental.equipmentIds.forEach(add);
    return identities;
  }
  add(rental?.equipmentInv);
  add(rental?.inventoryNumber);
  if (identities.size === 0 && Array.isArray(rental?.equipment)) rental.equipment.forEach(add);
  return identities;
}

/**
 * Builds all ClientObject rental counters in one pass over the already loaded
 * rental projection. It deliberately groups by stable object/rental/equipment IDs.
 */
export function buildClientObjectRentalAggregates(rentals = [], relation = {}) {
  const clientId = text(relation.clientId);
  const counterpartyId = text(relation.counterpartyId);
  const groups = new Map();

  rentals.forEach((rental, index) => {
    if (!ACTIVE_RENTAL_STATUSES.has(text(rental?.status).toLowerCase())) return;
    if (!relationMatchesClient(rental, clientId, counterpartyId)) return;
    const objectId = text(rental?.objectId);
    if (!objectId) return;
    const group = groups.get(objectId) || { rentalIds: new Set(), equipmentIds: new Set() };
    group.rentalIds.add(rentalIdentity(rental, index));
    equipmentIdentities(rental).forEach(id => group.equipmentIds.add(id));
    groups.set(objectId, group);
  });

  return Object.fromEntries([...groups.entries()].map(([objectId, group]) => [objectId, {
    activeRentals: group.rentalIds.size,
    equipmentCount: group.equipmentIds.size,
  }]));
}
