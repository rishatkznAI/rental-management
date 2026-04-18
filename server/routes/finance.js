const express = require('express');

function registerFinanceRoutes(router, deps) {
  const {
    requireAuth,
    readData,
    buildRentalDebtRows,
    buildClientReceivables,
    buildClientFinancialSnapshots,
    buildManagerReceivables,
    buildOverdueBuckets,
    buildFinanceReport,
  } = deps;

  function getFinanceCollections() {
    return {
      clients: readData('clients') || [],
      rentals: readData('gantt_rentals') || [],
      payments: readData('payments') || [],
    };
  }

  router.get('/finance/debt-rows', requireAuth, (req, res) => {
    const { rentals, payments } = getFinanceCollections();
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildRentalDebtRows(rentals, payments, today);
    res.json(rows);
  });

  router.get('/finance/clients', requireAuth, (req, res) => {
    const { clients, rentals, payments } = getFinanceCollections();
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildClientReceivables(clients, buildRentalDebtRows(rentals, payments), today);
    res.json(rows);
  });

  router.get('/finance/client-snapshots', requireAuth, (req, res) => {
    const { clients, rentals, payments } = getFinanceCollections();
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildClientFinancialSnapshots(clients, rentals, payments, today);
    res.json(rows);
  });

  router.get('/finance/managers', requireAuth, (req, res) => {
    const { rentals, payments } = getFinanceCollections();
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildManagerReceivables(buildRentalDebtRows(rentals, payments), today);
    res.json(rows);
  });

  router.get('/finance/aging', requireAuth, (req, res) => {
    const { rentals, payments } = getFinanceCollections();
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildOverdueBuckets(buildRentalDebtRows(rentals, payments), today);
    res.json(rows);
  });

  router.get('/finance/report', requireAuth, (req, res) => {
    const { clients, rentals, payments } = getFinanceCollections();
    const today = String(req.query.today || '').trim() || undefined;
    res.json(buildFinanceReport({ clients, rentals, payments }, today));
  });
}

module.exports = {
  registerFinanceRoutes,
};
