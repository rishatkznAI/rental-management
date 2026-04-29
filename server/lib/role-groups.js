const WARRANTY_MECHANIC_ROLE = 'Механик по гарантии';
const WARRANTY_MECHANIC_ROLE_ALIASES = [
  'warranty_mechanic',
  'mechanic_warranty',
];

const MECHANIC_ROLES = [
  'Механик',
  'Младший стационарный механик',
  'Выездной механик',
  'Старший стационарный механик',
];

function isMechanicRole(role) {
  return MECHANIC_ROLES.includes(role);
}

function isWarrantyMechanicRole(role) {
  return role === WARRANTY_MECHANIC_ROLE || WARRANTY_MECHANIC_ROLE_ALIASES.includes(role);
}

function normalizeRole(role) {
  return isWarrantyMechanicRole(role) ? WARRANTY_MECHANIC_ROLE : role;
}

module.exports = {
  MECHANIC_ROLES,
  WARRANTY_MECHANIC_ROLE,
  WARRANTY_MECHANIC_ROLE_ALIASES,
  isMechanicRole,
  isWarrantyMechanicRole,
  normalizeRole,
};
