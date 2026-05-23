const express = require('express');
const { buildManagerMyPlan } = require('../lib/manager-my-plan');

function registerManagerMyPlanRoutes(deps) {
  const {
    readData,
    requireAuth,
    getRoleAccessSummary,
    todayKey,
  } = deps;

  const router = express.Router();

  router.get('/manager/my-plan', requireAuth, (req, res) => {
    const result = buildManagerMyPlan({
      req,
      readData,
      getRoleAccessSummary,
      todayKey,
    });
    return res.status(result.status).json(result.body);
  });

  return router;
}

module.exports = {
  registerManagerMyPlanRoutes,
};
