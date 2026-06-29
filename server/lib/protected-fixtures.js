const PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID = 'SMOKE-RENTAL-001';
const SYSTEM_FIXTURE_PROTECTED_CODE = 'SYSTEM_FIXTURE_PROTECTED';
const SYSTEM_FIXTURE_PROTECTED_MESSAGE = `${SYSTEM_FIXTURE_PROTECTED_CODE}: ${PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID} is required for Finance Production Smoke and cannot be modified in this way.`;

function normalizedText(value) {
  return String(value ?? '').trim();
}

function normalizedLower(value) {
  return normalizedText(value).toLowerCase();
}

function emptyLike(value) {
  return value === undefined || value === null || value === false || normalizedText(value) === '';
}

function isProductionSmokeEquipmentFixture(record = {}) {
  if (!record || typeof record !== 'object') return false;
  return normalizedText(record.inventoryNumber) === PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID
    || normalizedText(record.serialNumber) === PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID;
}

function isAvailableForRentEquipment(record = {}) {
  if (!record || typeof record !== 'object') return false;
  if (normalizedLower(record.status) !== 'available') return false;
  if (normalizedLower(record.category) !== 'own') return false;
  if (record.activeInFleet !== true) return false;
  if (!emptyLike(record.saleMode) || !emptyLike(record.forSale) || !emptyLike(record.isForSale)) return false;
  if (!emptyLike(record.saleStatus) || !emptyLike(record.salesStatus)) return false;
  return true;
}

function isValidProductionSmokeEquipmentFixture(record = {}) {
  if (!record || typeof record !== 'object') return false;
  if (normalizedText(record.inventoryNumber) !== PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID) return false;
  if (normalizedText(record.serialNumber) !== PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID) return false;
  return isAvailableForRentEquipment(record);
}

function protectedFixtureViolations(record = {}, { requireIdentity = true } = {}) {
  const violations = [];
  if (!record || typeof record !== 'object') {
    return ['missing'];
  }
  if (requireIdentity && normalizedText(record.inventoryNumber) !== PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID) {
    violations.push('inventoryNumber');
  }
  if (requireIdentity && normalizedText(record.serialNumber) !== PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID) {
    violations.push('serialNumber');
  }
  if (normalizedLower(record.status) !== 'available') violations.push('status');
  if (normalizedLower(record.category) !== 'own') violations.push('category');
  if (record.activeInFleet !== true) violations.push('activeInFleet');
  for (const field of ['saleMode', 'forSale', 'isForSale', 'saleStatus', 'salesStatus']) {
    if (!emptyLike(record[field])) violations.push(field);
  }
  return violations;
}

function changedFields(previous = {}, next = {}) {
  const keys = new Set([...Object.keys(previous || {}), ...Object.keys(next || {})]);
  return [...keys]
    .filter(key => JSON.stringify(previous?.[key]) !== JSON.stringify(next?.[key]))
    .slice(0, 50);
}

function createSystemFixtureProtectedError({ action, equipmentId, attemptedFields = [], violations = [] } = {}) {
  const error = new Error(SYSTEM_FIXTURE_PROTECTED_MESSAGE);
  error.status = 409;
  error.code = SYSTEM_FIXTURE_PROTECTED_CODE;
  error.action = action;
  error.equipmentId = equipmentId;
  error.attemptedFields = attemptedFields;
  error.violations = violations;
  return error;
}

function findExistingProductionSmokeFixture(equipmentList = []) {
  return (Array.isArray(equipmentList) ? equipmentList : []).find(isProductionSmokeEquipmentFixture) || null;
}

function findMatchingIncomingFixture(existingFixture, nextList = []) {
  if (!existingFixture) return null;
  const list = Array.isArray(nextList) ? nextList : [];
  const existingId = normalizedText(existingFixture.id);
  return list.find(item => existingId && normalizedText(item?.id) === existingId)
    || list.find(isProductionSmokeEquipmentFixture)
    || null;
}

function firstPageAvailableForRentFixture(nextList = [], buildPaginatedCollectionResponse = null) {
  if (typeof buildPaginatedCollectionResponse === 'function') {
    const response = buildPaginatedCollectionResponse('equipment', nextList, {
      paginated: 'true',
      page: '1',
      pageSize: '100',
      saleState: 'available_for_rent',
      sortBy: 'inventoryNumber',
      sortDir: 'asc',
    });
    const items = Array.isArray(response?.items) ? response.items : [];
    return items.find(item => normalizedText(item?.inventoryNumber) === PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID
      && normalizedText(item?.serialNumber) === PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID) || null;
  }
  return nextList
    .filter(isAvailableForRentEquipment)
    .sort((a, b) => normalizedText(a.inventoryNumber).localeCompare(normalizedText(b.inventoryNumber), 'ru', { numeric: true, sensitivity: 'base' }))
    .slice(0, 100)
    .find(item => normalizedText(item?.inventoryNumber) === PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID
      && normalizedText(item?.serialNumber) === PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID) || null;
}

function isListStyleProtectedMutationAction(action) {
  return action === 'bulk_replace'
    || action === 'system_import'
    || action === 'legacy_sync'
    || action === 'rental_return'
    || action === 'service_create'
    || action === 'service_update'
    || normalizedText(action).startsWith('bot_');
}

function assertProductionSmokeFixtureMutationAllowed({
  action,
  previous,
  next,
  existingList = [],
  nextList = null,
  buildPaginatedCollectionResponse = null,
} = {}) {
  if (action === 'delete') {
    if (isProductionSmokeEquipmentFixture(previous)) {
      throw createSystemFixtureProtectedError({
        action,
        equipmentId: previous?.id,
        attemptedFields: ['delete'],
        violations: ['delete'],
      });
    }
    return;
  }

  if (action === 'create') {
    if (isProductionSmokeEquipmentFixture(next) && !isValidProductionSmokeEquipmentFixture(next)) {
      throw createSystemFixtureProtectedError({
        action,
        equipmentId: next?.id,
        attemptedFields: Object.keys(next || {}),
        violations: protectedFixtureViolations(next),
      });
    }
    return;
  }

  if (action === 'update') {
    const touchesFixture = isProductionSmokeEquipmentFixture(previous) || isProductionSmokeEquipmentFixture(next);
    if (!touchesFixture) return;
    const violations = protectedFixtureViolations(next);
    if (violations.length > 0 || !isValidProductionSmokeEquipmentFixture(next)) {
      throw createSystemFixtureProtectedError({
        action,
        equipmentId: previous?.id || next?.id,
        attemptedFields: changedFields(previous, next),
        violations,
      });
    }
    return;
  }

  if (isListStyleProtectedMutationAction(action)) {
    const existingFixture = findExistingProductionSmokeFixture(existingList);
    if (!existingFixture) return;
    const incomingFixture = findMatchingIncomingFixture(existingFixture, nextList);
    const attemptedFields = incomingFixture ? changedFields(existingFixture, incomingFixture) : ['missing'];
    const violations = incomingFixture ? protectedFixtureViolations(incomingFixture) : ['missing'];
    const pageFixture = incomingFixture
      ? firstPageAvailableForRentFixture(nextList || [], buildPaginatedCollectionResponse)
      : null;
    if (!incomingFixture || violations.length > 0 || !pageFixture) {
      throw createSystemFixtureProtectedError({
        action,
        equipmentId: existingFixture.id,
        attemptedFields,
        violations: pageFixture ? violations : [...new Set([...violations, 'available_for_rent_page_1'])],
      });
    }
  }
}

module.exports = {
  PRODUCTION_SMOKE_EQUIPMENT_FIXTURE_ID,
  SYSTEM_FIXTURE_PROTECTED_CODE,
  SYSTEM_FIXTURE_PROTECTED_MESSAGE,
  assertProductionSmokeFixtureMutationAllowed,
  createSystemFixtureProtectedError,
  isAvailableForRentEquipment,
  isProductionSmokeEquipmentFixture,
  isValidProductionSmokeEquipmentFixture,
  protectedFixtureViolations,
};
