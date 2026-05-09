const express = require('express');

function registerFinanceRoutes(router, deps) {
  const {
    requireAuth,
    requireRead,
    readData,
    accessControl,
    getEffectivePaidAmount,
    buildRentalDebtRows,
    getRentalDebtOverdueDays,
    buildClientReceivables,
    buildClientFinancialSnapshots,
    buildManagerReceivables,
    buildOverdueBuckets,
    buildFinanceReport,
    buildReceivables,
    normalizeAction,
    normalizePaymentPlan,
    writeData,
    requireWrite,
    generateId,
    idPrefixes = {},
    nowIso = () => new Date().toISOString(),
    auditLog,
  } = deps;
  if (!accessControl || typeof accessControl.filterCollectionByScope !== 'function') {
    throw new Error('Finance routes require access-control method: filterCollectionByScope');
  }

  function getFinanceCollections(user) {
    const clients = readData('clients') || [];
    const rentals = readData('gantt_rentals') || [];
    const payments = readData('payments') || [];
    const clientObjects = readData('client_objects') || [];
    const leasingContracts = readData('leasing_contracts') || [];
    const leasingPaymentSchedule = readData('leasing_payment_schedule') || [];
    const documents = readData('documents') || [];
    const actions = readData('debt_collection_actions') || [];
    const paymentPlans = readData('receivable_payment_plans') || [];
    // IMPORTANT: finance reports must use backend-scoped collections. Frontend visibility
    // controls are not a data protection boundary.
    return {
      clients: accessControl.filterCollectionByScope('clients', clients, user),
      rentals: accessControl.filterCollectionByScope('gantt_rentals', rentals, user),
      payments: accessControl.filterCollectionByScope('payments', payments, user),
      clientObjects: accessControl.filterCollectionByScope('client_objects', clientObjects, user),
      leasingContracts: accessControl.filterCollectionByScope('leasing_contracts', leasingContracts, user),
      leasingPaymentSchedule: accessControl.filterCollectionByScope('leasing_payment_schedule', leasingPaymentSchedule, user),
      documents: accessControl.filterCollectionByScope('documents', documents, user),
      actions: accessControl.filterCollectionByScope('debt_collection_actions', actions, user),
      paymentPlans: accessControl.filterCollectionByScope('receivable_payment_plans', paymentPlans, user),
    };
  }

  function userName(user) {
    return user?.userName || user?.name || user?.email || '';
  }

  function collectionList(name) {
    return Array.isArray(readData(name)) ? readData(name) : [];
  }

  function findIndexById(items, id) {
    const needle = String(id || '').trim();
    return items.findIndex(item => String(item?.id || '').trim() === needle);
  }

  function audit(req, action, entityType, previous, next) {
    auditLog?.(req, {
      action,
      entityType,
      entityId: next?.id || previous?.id,
      before: previous || null,
      after: next || null,
    });
  }

  function receivablesResponse(req) {
    const today = String(req.query.today || '').trim() || undefined;
    const { clients, rentals, payments, documents, actions, paymentPlans } = getFinanceCollections(req.user);
    return buildReceivables({ clients, rentals, payments, documents, actions, paymentPlans }, today);
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
        paidAmount: typeof getEffectivePaidAmount === 'function'
          ? getEffectivePaidAmount(payment)
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
    const { clients, rentals, payments, clientObjects, leasingContracts, leasingPaymentSchedule } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    res.json(buildFinanceReport({ clients, rentals, payments, clientObjects, leasingContracts, leasingPaymentSchedule }, today));
  });

  router.get('/finance/receivables', requireAuth, requireRead('payments'), (req, res) => {
    const result = receivablesResponse(req);
    res.json(result);
  });

  router.get('/finance/receivables/summary', requireAuth, requireRead('payments'), (req, res) => {
    const result = receivablesResponse(req);
    res.json(result.summary);
  });

  router.get('/finance/receivables/:clientId', requireAuth, requireRead('payments'), (req, res) => {
    const result = receivablesResponse(req);
    const clientId = String(req.params.clientId || '').trim();
    const row = result.rows.find(item => String(item.clientId || '') === clientId);
    if (!row) return res.status(404).json({ ok: false, error: 'Дебиторка клиента не найдена' });
    return res.json(row);
  });

  router.post('/finance/receivables/actions', requireAuth, requireWrite('debt_collection_actions'), (req, res) => {
    try {
      accessControl.assertCanCreateCollection('debt_collection_actions', req.user, req.body);
      const actions = collectionList('debt_collection_actions');
      const next = normalizeAction(req.body, null, {
        generateId,
        idPrefix: idPrefixes.debt_collection_actions || 'DCA',
        nowIso,
        userName: userName(req.user),
      });
      actions.push(next);
      writeData('debt_collection_actions', actions);
      audit(req, 'debt_collection_actions.create', 'debt_collection_actions', null, next);
      return res.status(201).json(next);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось создать действие взыскания' });
    }
  });

  router.patch('/finance/receivables/actions/:id', requireAuth, requireWrite('debt_collection_actions'), (req, res) => {
    try {
      const actions = collectionList('debt_collection_actions');
      const index = findIndexById(actions, req.params.id);
      if (index < 0) return res.status(404).json({ ok: false, error: 'Действие взыскания не найдено' });
      accessControl.assertCanUpdateEntity('debt_collection_actions', actions[index], req.user);
      const previous = actions[index];
      const next = normalizeAction(req.body, previous, {
        generateId,
        idPrefix: idPrefixes.debt_collection_actions || 'DCA',
        nowIso,
        userName: userName(req.user),
      });
      actions[index] = next;
      writeData('debt_collection_actions', actions);
      audit(req, 'debt_collection_actions.update', 'debt_collection_actions', previous, next);
      return res.json(next);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось обновить действие взыскания' });
    }
  });

  router.post('/finance/receivables/payment-plans', requireAuth, requireWrite('receivable_payment_plans'), (req, res) => {
    try {
      accessControl.assertCanCreateCollection('receivable_payment_plans', req.user, req.body);
      const plans = collectionList('receivable_payment_plans');
      const next = normalizePaymentPlan(req.body, null, {
        generateId,
        idPrefix: idPrefixes.receivable_payment_plans || 'RPP',
        nowIso,
        userName: userName(req.user),
      });
      plans.push(next);
      writeData('receivable_payment_plans', plans);
      audit(req, 'receivable_payment_plans.create', 'receivable_payment_plans', null, next);
      return res.status(201).json(next);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось создать график погашения' });
    }
  });

  router.patch('/finance/receivables/payment-plans/:id', requireAuth, requireWrite('receivable_payment_plans'), (req, res) => {
    try {
      const plans = collectionList('receivable_payment_plans');
      const index = findIndexById(plans, req.params.id);
      if (index < 0) return res.status(404).json({ ok: false, error: 'Платёж плана не найден' });
      accessControl.assertCanUpdateEntity('receivable_payment_plans', plans[index], req.user);
      const previous = plans[index];
      const next = normalizePaymentPlan(req.body, previous, {
        generateId,
        idPrefix: idPrefixes.receivable_payment_plans || 'RPP',
        nowIso,
        userName: userName(req.user),
      });
      plans[index] = next;
      writeData('receivable_payment_plans', plans);
      audit(req, 'receivable_payment_plans.update', 'receivable_payment_plans', previous, next);
      return res.json(next);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось обновить график погашения' });
    }
  });
}

module.exports = {
  registerFinanceRoutes,
};
