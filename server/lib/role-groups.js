const WARRANTY_MECHANIC_ROLE = 'Механик по гарантии';
const SERVICE_FOREMAN_ROLE = 'Бригадир';
const HEAD_ROLE = 'Руководитель';
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

const ROLE_ALIASES = new Map([
  ['admin', 'Администратор'],
  ['administrator', 'Администратор'],
  ['администратор', 'Администратор'],
  ['office_manager', 'Офис-менеджер'],
  ['office', 'Офис-менеджер'],
  ['rental_manager', 'Менеджер по аренде'],
  ['rent_manager', 'Менеджер по аренде'],
  ['rental manager', 'Менеджер по аренде'],
  ['менеджер по аренде', 'Менеджер по аренде'],
  ['менеджер_по_аренде', 'Менеджер по аренде'],
  ['менеджер аренды', 'Менеджер по аренде'],
  ['менеджер_аренды', 'Менеджер по аренде'],
  ['sales_manager', 'Менеджер по продажам'],
  ['mechanic', 'Механик'],
  ['foreman', SERVICE_FOREMAN_ROLE],
  ['service_foreman', SERVICE_FOREMAN_ROLE],
  ['brigadier', SERVICE_FOREMAN_ROLE],
  ['carrier', 'Перевозчик'],
  ['delivery_carrier', 'Перевозчик'],
  ['investor', 'Инвестор'],
  ['руководитель', HEAD_ROLE],
  ['rukovoditel', HEAD_ROLE],
  ['head', HEAD_ROLE],
  ['manager_head', HEAD_ROLE],
  ['supervisor', HEAD_ROLE],
  ['director_viewer', HEAD_ROLE],
]);

function isMechanicRole(role) {
  const normalized = normalizeRole(role);
  return MECHANIC_ROLES.includes(normalized) || normalized === WARRANTY_MECHANIC_ROLE;
}

function isWarrantyMechanicRole(role) {
  return normalizeRoleKey(role) === normalizeRoleKey(WARRANTY_MECHANIC_ROLE)
    || WARRANTY_MECHANIC_ROLE_ALIASES.some(alias => normalizeRoleKey(alias) === normalizeRoleKey(role));
}

function normalizeRole(role) {
  const value = String(role || '').trim();
  const alias = ROLE_ALIASES.get(normalizeRoleKey(value));
  if (alias) return alias;
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
  HEAD_ROLE,
  SERVICE_FOREMAN_ROLE,
  WARRANTY_MECHANIC_ROLE,
  WARRANTY_MECHANIC_ROLE_ALIASES,
  isMechanicRole,
  isWarrantyMechanicRole,
  normalizeRole,
  normalizeRoleKey,
};
