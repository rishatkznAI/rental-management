const express = require('express');
const { normalizeRole } = require('../lib/role-groups');

const STAFF_OPTION_ROLES = new Set([
  'Офис-менеджер',
  'Менеджер по аренде',
  'Менеджер по продажам',
]);

const STAFF_OPTION_VIEWER_ROLES = new Set([
  'Администратор',
  'Офис-менеджер',
  'Менеджер по аренде',
  'Менеджер по продажам',
]);

function toStaffOption(user) {
  return {
    id: user.id,
    name: user.name,
    role: normalizeRole(user.role),
    status: user.status,
  };
}

function registerStaffRoutes(deps) {
  const {
    readData,
    requireAuth,
  } = deps;

  const router = express.Router();

  router.get('/staff/manager-options', requireAuth, (req, res) => {
    const viewerRole = normalizeRole(req.user?.userRole);
    if (!STAFF_OPTION_VIEWER_ROLES.has(viewerRole)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    const users = readData('users') || [];
    const options = users
      .filter(user => user?.status === 'Активен')
      .filter(user => STAFF_OPTION_ROLES.has(normalizeRole(user?.role)))
      .map(toStaffOption)
      .sort((a, b) => a.name.localeCompare(b.name, 'ru'));

    return res.json(options);
  });

  return router;
}

module.exports = {
  registerStaffRoutes,
};
