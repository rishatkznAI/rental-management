function registerLeasingRoutes(router, deps) {
  const {
    requireAuth,
    requireRead,
    readData,
    writeDataBatch,
    accessControl,
    generateId,
    idPrefixes,
    nowIso,
    normalizeLeasingContract,
    normalizeLeasingPaymentScheduleRow,
    decorateLeasingContract,
    buildLeasingSummary,
  } = deps;

  const CONTRACTS = 'leasing_contracts';
  const SCHEDULE = 'leasing_payment_schedule';
  const readMiddlewares = typeof requireRead === 'function'
    ? [requireAuth, requireRead(CONTRACTS)]
    : [requireAuth];

  function sendAccessError(res, error) {
    return res.status(error?.status || 403).json({ ok: false, error: error?.message || 'Forbidden' });
  }

  function canRead(req, res) {
    try {
      accessControl.assertCanReadCollection(CONTRACTS, req.user);
      return true;
    } catch (error) {
      sendAccessError(res, error);
      return false;
    }
  }

  function canCreate(req, res, input) {
    try {
      accessControl.assertCanCreateCollection(CONTRACTS, req.user, input);
      return true;
    } catch (error) {
      sendAccessError(res, error);
      return false;
    }
  }

  function canUpdate(req, res, entity) {
    try {
      accessControl.assertCanUpdateEntity(CONTRACTS, entity, req.user);
      return true;
    } catch (error) {
      sendAccessError(res, error);
      return false;
    }
  }

  function canDelete(req, res, entity) {
    try {
      accessControl.assertCanDeleteEntity(CONTRACTS, entity, req.user);
      return true;
    } catch (error) {
      sendAccessError(res, error);
      return false;
    }
  }

  function scopedContracts(user) {
    const contracts = readData(CONTRACTS) || [];
    return accessControl.filterCollectionByScope(CONTRACTS, contracts, user);
  }

  function scheduleRows() {
    return readData(SCHEDULE) || [];
  }

  function decorateList(contracts, today) {
    const rows = scheduleRows();
    return contracts.map(item => decorateLeasingContract(item, rows, today));
  }

  function nextContractSchedule(contract, schedule, currentRows = scheduleRows()) {
    if (!Array.isArray(schedule)) return currentRows;
    const otherRows = currentRows.filter(row => row.leasingContractId !== contract.id);
    const normalizedRows = schedule.map((row, index) => normalizeLeasingPaymentScheduleRow(row, contract, index));
    return [...otherRows, ...normalizedRows];
  }

  function persistContractAndSchedule(contracts, contract, schedule) {
    const currentSchedule = scheduleRows();
    const nextSchedule = nextContractSchedule(contract, schedule, currentSchedule);
    const entries = [{ name: CONTRACTS, value: contracts }];
    if (Array.isArray(schedule)) entries.push({ name: SCHEDULE, value: nextSchedule });
    writeDataBatch(entries);
    return nextSchedule;
  }

  router.get('/leasing-contracts', ...readMiddlewares, (req, res) => {
    if (!canRead(req, res)) return;
    const today = String(req.query.today || '').trim() || undefined;
    res.json(decorateList(scopedContracts(req.user), today));
  });

  router.get('/leasing-contracts/summary', ...readMiddlewares, (req, res) => {
    if (!canRead(req, res)) return;
    const today = String(req.query.today || '').trim() || undefined;
    res.json(buildLeasingSummary(scopedContracts(req.user), scheduleRows(), today));
  });

  router.get('/leasing-contracts/:id', ...readMiddlewares, (req, res) => {
    if (!canRead(req, res)) return;
    const contract = (readData(CONTRACTS) || []).find(item => item.id === req.params.id);
    if (!contract) return res.status(404).json({ ok: false, error: 'Not found' });
    if (!accessControl.canAccessEntity(CONTRACTS, contract, req.user)) {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    res.json(decorateLeasingContract(contract, scheduleRows()));
  });

  router.post('/leasing-contracts', requireAuth, (req, res) => {
    if (!canCreate(req, res, req.body)) return;
    const contracts = readData(CONTRACTS) || [];
    try {
      const now = nowIso();
      const contract = normalizeLeasingContract(
        { ...req.body, id: req.body?.id || generateId(idPrefixes.leasing_contracts) },
        null,
        { nowIso: now },
      );
      const nextContracts = [...contracts, contract];
      const nextSchedule = persistContractAndSchedule(nextContracts, contract, req.body?.schedule);
      res.status(201).json(decorateLeasingContract(contract, nextSchedule));
    } catch (error) {
      res.status(error?.status || 400).json({
        ok: false,
        ...(error?.code ? { code: error.code } : {}),
        error: error.message,
      });
    }
  });

  router.patch('/leasing-contracts/:id', requireAuth, (req, res) => {
    const contracts = readData(CONTRACTS) || [];
    const index = contracts.findIndex(item => item.id === req.params.id);
    if (index === -1) return res.status(404).json({ ok: false, error: 'Not found' });
    if (!canUpdate(req, res, contracts[index])) return;
    try {
      const now = nowIso();
      const next = normalizeLeasingContract({ ...contracts[index], ...req.body, id: contracts[index].id }, contracts[index], { nowIso: now });
      const nextContracts = contracts.map((item, itemIndex) => itemIndex === index ? next : item);
      const nextSchedule = persistContractAndSchedule(nextContracts, next, req.body?.schedule);
      res.json(decorateLeasingContract(next, nextSchedule));
    } catch (error) {
      res.status(error?.status || 400).json({
        ok: false,
        ...(error?.code ? { code: error.code } : {}),
        error: error.message,
      });
    }
  });

  router.delete('/leasing-contracts/:id', requireAuth, (req, res) => {
    const contracts = readData(CONTRACTS) || [];
    const index = contracts.findIndex(item => item.id === req.params.id);
    if (index === -1) return res.status(404).json({ ok: false, error: 'Not found' });
    if (!canDelete(req, res, contracts[index])) return;
    try {
      const nextContracts = contracts.filter((_item, itemIndex) => itemIndex !== index);
      const nextSchedule = scheduleRows().filter(row => row.leasingContractId !== req.params.id);
      writeDataBatch([
        { name: CONTRACTS, value: nextContracts },
        { name: SCHEDULE, value: nextSchedule },
      ]);
      res.json({ ok: true });
    } catch (error) {
      res.status(error?.status || 400).json({
        ok: false,
        ...(error?.code ? { code: error.code } : {}),
        error: error.message,
      });
    }
  });
}

module.exports = {
  registerLeasingRoutes,
};
