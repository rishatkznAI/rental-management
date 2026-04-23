const MECHANIC_ROLES = [
  'Механик',
  'Младший стационарный механик',
  'Выездной механик',
  'Старший стационарный механик',
];

function isMechanicRole(role) {
  return MECHANIC_ROLES.includes(role);
}

module.exports = {
  MECHANIC_ROLES,
  isMechanicRole,
};
