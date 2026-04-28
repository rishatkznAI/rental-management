const express = require('express');

function registerFinanceRoutes(router, deps) {
  const {
    requireAuth,
    requireRead,
    readData,
    accessControl,
    buildRentalDebtRows,
    getRentalDebtOverdueDays,
    buildClientReceivables,
    buildClientFinancialSnapshots,
    buildManagerReceivables,
    buildOverdueBuckets,
    buildFinanceReport,
  } = deps;
  if (!accessControl || typeof accessControl.filterCollectionByScope !== 'function') {
    throw new Error('Finance routes require access-control method: filterCollectionByScope');
  }

  function getFinanceCollections(user) {
    const clients = readData('clients') || [];
    const rentals = readData('gantt_rentals') || [];
    const payments = readData('payments') || [];
    return {
      clients: accessControl.filterCollectionByScope('clients', clients, user),
      rentals: accessControl.filterCollectionByScope('gantt_rentals', rentals, user),
      payments: accessControl.filterCollectionByScope('payments', payments, user),
    };
  }

  router.get('/finance/debt-rows', requireAuth, requireRead('payments'), (req, res) => {
    const { rentals, payments } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildRentalDebtRows(rentals, payments, today);
    res.json(rows);
  });

  router.get('/finance/clients', requireAuth, requireRead('payments'), (req, res) => {
    const { clients, rentals, payments } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildClientReceivables(clients, buildRentalDebtRows(rentals, payments), today);
    res.json(rows);
  });

  router.get('/finance/client-snapshots', requireAuth, requireRead('payments'), (req, res) => {
    const { clients, rentals, payments } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildClientFinancialSnapshots(clients, rentals, payments, today);
    res.json(rows);
  });

  router.get('/finance/managers', requireAuth, requireRead('payments'), (req, res) => {
    const { clients, rentals, payments } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildManagerReceivables(buildRentalDebtRows(rentals, payments), today, clients);
    res.json(rows);
  });

  router.get('/finance/manager-breakdown', requireAuth, requireRead('payments'), (req, res) => {
    const { clients, rentals, payments } = getFinanceCollections(req.user);
    const documents = accessControl.filterCollectionByScope('documents', readData('documents') || [], req.user);
    const manager = String(req.query.manager || '').trim();
    const today = String(req.query.today || '').trim() || new Date().toISOString().slice(0, 10);

    if (!manager) {
      return res.status(400).json({ ok: false, error: 'manager is required' });
    }
    if (!['Администратор', 'Офис-менеджер'].includes(req.user?.userRole) && manager !== req.user?.userName) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }

    const monthStart = new Date(today);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const todayDate = new Date(today);
    todayDate.setHours(0, 0, 0, 0);
    const tomorrowStart = new Date(todayDate);
    tomorrowStart.setDate(tomorrowStart.getDate() + 1);
    const dayAfterTomorrowStart = new Date(todayDate);
    dayAfterTomorrowStart.setDate(dayAfterTomorrowStart.getDate() + 2);

    const managerRentals = rentals.filter(item => item.manager === manager);
    const managerActiveRentals = managerRentals.filter(item => item.status === 'active');
    const managerMonthRentals = managerRentals.filter(item => new Date(item.startDate) >= monthStart);
    const managerReturnsSoonRentals = managerActiveRentals.filter(item => {
      const ret = new Date(item.endDate);
      return (ret >= todayDate && ret < tomorrowStart) || (ret >= tomorrowStart && ret < dayAfterTomorrowStart);
    });

    const debtRows = buildRentalDebtRows(rentals, payments);
    const managerDebtRows = debtRows.filter(item => item.manager === manager);
    const managerOverdueRows = managerDebtRows.filter(item => getRentalDebtOverdueDays(item, today) > 0);
    const managerManualDebt = clients
      .filter(item => item?.manager === manager)
      .reduce((sum, item) => {
        const debt = Number(item?.debt);
        return sum + (Number.isFinite(debt) && debt > 0 ? debt : 0);
      }, 0);
    const paymentsByRentalId = new Map();

    payments.forEach(payment => {
      if (!payment?.rentalId) return;
      if (!paymentsByRentalId.has(payment.rentalId)) paymentsByRentalId.set(payment.rentalId, []);
      paymentsByRentalId.get(payment.rentalId).push(payment);
    });

    const decorateDebtRow = row => ({
      ...row,
      overdueDays: getRentalDebtOverdueDays(row, today),
      payments: (paymentsByRentalId.get(row.rentalId) || []).map(payment => ({
        id: payment.id,
        invoiceNumber: payment.invoiceNumber,
        amount: payment.amount || 0,
        paidAmount: typeof payment.paidAmount === 'number'
          ? payment.paidAmount
          : payment.status === 'paid'
            ? payment.amount || 0
            : 0,
        dueDate: payment.dueDate,
        paidDate: payment.paidDate,
        status: payment.status,
        comment: payment.comment,
      })),
    });

    const managerUnsignedDocuments = documents.filter(item =>
      item.manager === manager && (item.type === 'contract' || item.type === 'act') && item.status !== 'signed',
    );

    return res.json({
      summary: {
        name: manager,
        activeRentals: managerActiveRentals.length,
        monthRentals: managerMonthRentals.length,
        monthRevenue: managerMonthRentals.reduce((sum, item) => sum + (item.amount || 0), 0),
        currentDebt: managerDebtRows.reduce((sum, item) => sum + item.outstanding, managerManualDebt),
        overdueDebt: managerOverdueRows.reduce((sum, item) => sum + item.outstanding, 0),
        returnsSoon: managerReturnsSoonRentals.length,
        unsignedDocs: managerUnsignedDocuments.length,
      },
      monthRevenueRentals: managerMonthRentals
        .slice()
        .sort((left, right) => new Date(right.startDate).getTime() - new Date(left.startDate).getTime())
        .map(item => ({
          rentalId: item.id,
          client: item.client || '',
          equipmentInv: item.equipmentInv || '',
          startDate: item.startDate || '',
          endDate: item.endDate || '',
          amount: item.amount || 0,
          status: item.status || 'created',
        })),
      currentDebtRows: managerDebtRows.map(decorateDebtRow),
      overdueDebtRows: managerOverdueRows.map(decorateDebtRow),
      returnsSoonRentals: managerReturnsSoonRentals
        .slice()
        .sort((left, right) => new Date(left.endDate).getTime() - new Date(right.endDate).getTime())
        .map(item => ({
          rentalId: item.id,
          client: item.client || '',
          equipmentInv: item.equipmentInv || '',
          startDate: item.startDate || '',
          endDate: item.endDate || '',
          amount: item.amount || 0,
          status: item.status || 'created',
        })),
      unsignedDocuments: managerUnsignedDocuments
        .slice()
        .sort((left, right) => new Date(right.date).getTime() - new Date(left.date).getTime())
        .map(item => ({
          id: item.id,
          type: item.type,
          number: item.number,
          client: item.client,
          date: item.date,
          amount: item.amount,
          status: item.status,
          rental: item.rental,
        })),
    });
  });

  router.get('/finance/aging', requireAuth, requireRead('payments'), (req, res) => {
    const { rentals, payments } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildOverdueBuckets(buildRentalDebtRows(rentals, payments), today);
    res.json(rows);
  });

  router.get('/finance/report', requireAuth, requireRead('payments'), (req, res) => {
    const { clients, rentals, payments } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    res.json(buildFinanceReport({ clients, rentals, payments }, today));
  });
}

module.exports = {
  registerFinanceRoutes,
};
