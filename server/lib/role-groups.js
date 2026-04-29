const WARRANTY_MECHANIC_ROLE = 'Механик по гарантии';
const WARRANTY_MECHANIC_ROLE_ALIASES = [
  'механик по гарантии',
  'warranty_mechanic',
  'mechanic_warranty',
  'warrantyMechanic',
  'mechanicWarranty',
  'warranty-mechanic',
  'mechanic-warranty',
];

const MECHANIC_ROLES = [
  'Механик',
  'Младший стационарный механик',
  'Выездной механик',
  'Старший стационарный механик',
];

function isMechanicRole(role) {
  return MECHANIC_ROLES.includes(normalizeRole(role));
}

function isWarrantyMechanicRole(role) {
  return normalizeRoleKey(role) === normalizeRoleKey(WARRANTY_MECHANIC_ROLE)
    || WARRANTY_MECHANIC_ROLE_ALIASES.some(alias => normalizeRoleKey(alias) === normalizeRoleKey(role));
}

function normalizeRole(role) {
  const value = String(role || '').trim();
  return isWarrantyMechanicRoleValue(value) ? WARRANTY_MECHANIC_ROLE : value;
}

function normalizeRoleKey(role) {
  return String(role || '')
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[\s_-]+/g, '_');
}

function isWarrantyMechanicRoleValue(role) {
  const key = normalizeRoleKey(role);
  return key === normalizeRoleKey(WARRANTY_MECHANIC_ROLE)
    || WARRANTY_MECHANIC_ROLE_ALIASES.some(alias => normalizeRoleKey(alias) === key);
}

module.exports = {
  MECHANIC_ROLES,
  WARRANTY_MECHANIC_ROLE,
  WARRANTY_MECHANIC_ROLE_ALIASES,
  isMechanicRole,
  isWarrantyMechanicRole,
  normalizeRole,
};
