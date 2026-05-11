const express = require('express');
const {
  prepareDocumentCreate,
  readNumberingSettings,
  writeNumberingSettings,
} = require('../lib/documents-core');

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
    validateStageTransition,
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

  function dateOnly(value) {
    const text = String(value || '').trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return '';
    const parsed = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(parsed.getTime()) ? '' : text;
  }

  function text(value) {
    return String(value ?? '').trim();
  }

  function money(value) {
    const numeric = Number(value);
    return Number.isFinite(numeric) ? Math.round(numeric) : NaN;
  }

  function normalizeFinanceOperation(input = {}, previous = null, req) {
    const type = text(input.type ?? previous?.type ?? 'expense');
    if (!['income', 'expense', 'transfer'].includes(type)) {
      const error = new Error('Некорректный тип операции.');
      error.status = 400;
      throw error;
    }
    const date = dateOnly(input.date ?? previous?.date);
    if (!date) {
      const error = new Error('Укажите корректную дату операции.');
      error.status = 400;
      throw error;
    }
    const amount = money(input.amount ?? previous?.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      const error = new Error('Сумма операции должна быть больше нуля.');
      error.status = 400;
      throw error;
    }
    const category = text(input.category ?? previous?.category);
    if (!category) {
      const error = new Error('Укажите категорию операции.');
      error.status = 400;
      throw error;
    }
    const account = text(input.account ?? previous?.account);
    const accountFrom = text(input.accountFrom ?? previous?.accountFrom);
    const accountTo = text(input.accountTo ?? previous?.accountTo);
    if (type === 'transfer') {
      if (!accountFrom || !accountTo) {
        const error = new Error('Для перевода укажите счёт-источник и счёт-получатель.');
        error.status = 400;
        throw error;
      }
      if (accountFrom.toLowerCase() === accountTo.toLowerCase()) {
        const error = new Error('Нельзя перевести деньги на тот же счёт.');
        error.status = 400;
        throw error;
      }
    }
    const status = text(input.status ?? previous?.status ?? 'active') || 'active';
    if (!['active', 'archived'].includes(status)) {
      const error = new Error('Некорректный статус операции.');
      error.status = 400;
      throw error;
    }
    const now = nowIso();
    return {
      ...(previous || {}),
      id: previous?.id || text(input.id) || generateId(idPrefixes.finance_operations || 'FO'),
      type,
      date,
      amount,
      category,
      description: text(input.description ?? previous?.description) || undefined,
      counterparty: text(input.counterparty ?? previous?.counterparty) || undefined,
      account: type === 'transfer' ? undefined : (account || undefined),
      accountFrom: type === 'transfer' ? accountFrom : undefined,
      accountTo: type === 'transfer' ? accountTo : undefined,
      relatedEntityType: text(input.relatedEntityType ?? previous?.relatedEntityType) || undefined,
      relatedEntityId: text(input.relatedEntityId ?? previous?.relatedEntityId) || undefined,
      relatedEntityLabel: text(input.relatedEntityLabel ?? previous?.relatedEntityLabel) || undefined,
      status,
      comment: text(input.comment ?? previous?.comment) || undefined,
      source: 'manual',
      createdAt: previous?.createdAt || now,
      createdBy: previous?.createdBy || userName(req.user) || undefined,
      createdByUserId: previous?.createdByUserId || req.user?.userId || req.user?.id || undefined,
      updatedAt: now,
      updatedBy: userName(req.user) || undefined,
      updatedByUserId: req.user?.userId || req.user?.id || undefined,
    };
  }

  function normalizeFinanceAccount(input = {}, previous = null, req) {
    const name = text(input.name ?? previous?.name);
    if (!name) {
      const error = new Error('Укажите название счёта или кассы.');
      error.status = 400;
      throw error;
    }
    const type = text(input.type ?? previous?.type ?? 'bank_account');
    if (!['bank_account', 'cash', 'card', 'deposit', 'other'].includes(type)) {
      const error = new Error('Некорректный тип счёта.');
      error.status = 400;
      throw error;
    }
    const balance = money(input.balance ?? previous?.balance ?? 0);
    if (!Number.isFinite(balance)) {
      const error = new Error('Остаток должен быть числом.');
      error.status = 400;
      throw error;
    }
    const actualAt = dateOnly(input.actualAt ?? previous?.actualAt ?? nowIso().slice(0, 10));
    if (!actualAt) {
      const error = new Error('Укажите корректную дату актуальности.');
      error.status = 400;
      throw error;
    }
    const status = text(input.status ?? previous?.status ?? 'active') || 'active';
    if (!['active', 'archived'].includes(status)) {
      const error = new Error('Некорректный статус счёта.');
      error.status = 400;
      throw error;
    }
    const now = nowIso();
    return {
      ...(previous || {}),
      id: previous?.id || text(input.id) || generateId(idPrefixes.finance_accounts || 'FA'),
      name,
      type,
      currency: (text(input.currency ?? previous?.currency ?? 'RUB') || 'RUB').toUpperCase(),
      balance,
      actualAt,
      comment: text(input.comment ?? previous?.comment) || undefined,
      status,
      createdAt: previous?.createdAt || now,
      createdBy: previous?.createdBy || userName(req.user) || undefined,
      createdByUserId: previous?.createdByUserId || req.user?.userId || req.user?.id || undefined,
      updatedAt: now,
      updatedBy: userName(req.user) || undefined,
      updatedByUserId: req.user?.userId || req.user?.id || undefined,
    };
  }

  function findAccount(accounts, value) {
    const needle = text(value).toLowerCase();
    if (!needle) return null;
    return accounts.find(account =>
      text(account.id).toLowerCase() === needle || text(account.name).toLowerCase() === needle
    ) || null;
  }

  function accountHasActiveLinks(account) {
    const id = text(account?.id).toLowerCase();
    const name = text(account?.name).toLowerCase();
    if (!id && !name) return false;
    return collectionList('finance_operations').some(operation => {
      if (operation?.status === 'archived') return false;
      const values = [operation.account, operation.accountFrom, operation.accountTo]
        .map(value => text(value).toLowerCase())
        .filter(Boolean);
      return values.includes(id) || values.includes(name);
    });
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

  function isAdmin(user) {
    return user?.userRole === 'Администратор';
  }

  function daysFromNow(days) {
    const date = new Date(nowIso());
    date.setDate(date.getDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function escapeHtml(value) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;');
  }

  function documentSettings() {
    return readNumberingSettings(collectionList('app_settings'));
  }

  function saveDocumentSettings(settings) {
    writeData('app_settings', writeNumberingSettings(collectionList('app_settings'), settings, nowIso));
  }

  function findReceivableRow(req, clientId) {
    const fakeReq = { ...req, query: { ...(req.query || {}) } };
    const result = receivablesResponse(fakeReq);
    const id = String(clientId || '').trim();
    const row = result.rows.find(item => String(item.clientId || '') === id);
    if (!row) {
      const error = new Error('Дебиторка клиента не найдена');
      error.status = 404;
      throw error;
    }
    return row;
  }

  function buildDebtDocumentHtml(kind, row, payload) {
    const title = kind === 'pretrial_claim' ? 'Досудебная претензия' : 'Уведомление о задолженности';
    const voluntaryDue = payload.dueDate || daysFromNow(kind === 'pretrial_claim' ? 10 : 5);
    return `<!doctype html>
<html lang="ru">
<head><meta charset="utf-8" /><title>${escapeHtml(title)}</title></head>
<body style="font-family: Arial, sans-serif; margin: 32px; color: #111827;">
  <h1>${escapeHtml(title)}</h1>
  <p><strong>Клиент:</strong> ${escapeHtml(row.client)} ${row.inn ? `(ИНН ${escapeHtml(row.inn)})` : ''}</p>
  <p><strong>Сумма задолженности:</strong> ${escapeHtml(row.totalDebt.toLocaleString('ru-RU'))} руб.</p>
  <p><strong>Просрочено:</strong> ${escapeHtml(row.overdueDebt.toLocaleString('ru-RU'))} руб., старшая просрочка ${escapeHtml(row.oldestOverdueDays)} дн.</p>
  <p><strong>Связанные аренды:</strong> ${escapeHtml((row.rentals || []).map(item => item.rentalId).join(', ') || 'не указаны')}</p>
  <p><strong>Связанные документы:</strong> ${escapeHtml((row.documents || []).map(item => [item.type, item.number].filter(Boolean).join(' ')).filter(Boolean).join(', ') || 'не указаны')}</p>
  <p>Просим погасить задолженность до ${escapeHtml(voluntaryDue)}. Текст является рабочим шаблоном и требует проверки ответственным/юристом перед отправкой.</p>
  ${payload.comment ? `<p><strong>Комментарий:</strong> ${escapeHtml(payload.comment)}</p>` : ''}
</body>
</html>`;
  }

  function createReceivableDocument(req, row, actionId, documentType, payload = {}) {
    const documents = collectionList('documents');
    const firstRental = row.rentals?.[0] || {};
    const prepared = prepareDocumentCreate({
      type: documentType,
      documentType,
      number: '',
      documentNumber: '',
      clientId: row.clientId,
      client: row.client,
      rentalId: payload.rentalId || firstRental.rentalId || undefined,
      rental: payload.rentalId || firstRental.rentalId || undefined,
      date: payload.actionDate || nowIso().slice(0, 10),
      documentDate: payload.actionDate || nowIso().slice(0, 10),
      amount: row.totalDebt,
      status: 'draft',
      manager: row.manager,
      receivableActionId: actionId,
      comment: payload.comment || '',
      contentHtml: buildDebtDocumentHtml(documentType, row, payload),
    }, {
      documents,
      settings: documentSettings(),
      nowIso,
      generateId,
      idPrefix: idPrefixes.documents || 'D',
      user: req.user,
    });
    writeData('documents', [...documents, prepared.document]);
    saveDocumentSettings(prepared.settings);
    audit(req, 'documents.create', 'documents', null, prepared.document);
    return prepared.document;
  }

  function receivablesResponse(req) {
    const today = String(req.query.today || '').trim() || undefined;
    const { clients, rentals, payments, documents, actions, paymentPlans } = getFinanceCollections(req.user);
    return buildReceivables({ clients, rentals, payments, documents, actions, paymentPlans }, today);
  }

  router.get('/finance/accounts', requireAuth, requireRead('finance_accounts'), (req, res) => {
    const rows = accessControl
      .filterCollectionByScope('finance_accounts', collectionList('finance_accounts'), req.user)
      .sort((left, right) => {
        if (left.status !== right.status) return left.status === 'active' ? -1 : 1;
        return String(left.name || '').localeCompare(String(right.name || ''), 'ru');
      });
    return res.json(rows);
  });

  router.post('/finance/accounts', requireAuth, requireWrite('finance_accounts'), (req, res) => {
    try {
      accessControl.assertCanCreateCollection('finance_accounts', req.user, req.body);
      const accounts = collectionList('finance_accounts');
      const next = normalizeFinanceAccount(req.body, null, req);
      accounts.push(next);
      writeData('finance_accounts', accounts);
      audit(req, 'finance_accounts.create', 'finance_accounts', null, next);
      return res.status(201).json(next);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось создать счёт' });
    }
  });

  router.post('/finance/accounts/transfer', requireAuth, requireWrite('finance_accounts'), (req, res) => {
    try {
      const accounts = collectionList('finance_accounts');
      const from = findAccount(accounts, req.body.accountFrom);
      const to = findAccount(accounts, req.body.accountTo);
      if (!from || !to) {
        const error = new Error('Укажите существующие счёт-источник и счёт-получатель.');
        error.status = 400;
        throw error;
      }
      if (String(from.id) === String(to.id)) {
        const error = new Error('Нельзя перевести деньги на тот же счёт.');
        error.status = 400;
        throw error;
      }
      if (from.status === 'archived' || to.status === 'archived') {
        const error = new Error('Переводы доступны только между активными счетами.');
        error.status = 400;
        throw error;
      }
      const amount = money(req.body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        const error = new Error('Сумма перевода должна быть больше нуля.');
        error.status = 400;
        throw error;
      }
      const date = dateOnly(req.body.date || nowIso().slice(0, 10));
      if (!date) {
        const error = new Error('Укажите корректную дату перевода.');
        error.status = 400;
        throw error;
      }

      const previousFrom = { ...from };
      const previousTo = { ...to };
      const now = nowIso();
      from.balance = money(Number(from.balance || 0) - amount);
      from.actualAt = date;
      from.updatedAt = now;
      from.updatedBy = userName(req.user) || undefined;
      from.updatedByUserId = req.user?.userId || req.user?.id || undefined;
      to.balance = money(Number(to.balance || 0) + amount);
      to.actualAt = date;
      to.updatedAt = now;
      to.updatedBy = userName(req.user) || undefined;
      to.updatedByUserId = req.user?.userId || req.user?.id || undefined;

      const operations = collectionList('finance_operations');
      const operation = normalizeFinanceOperation({
        type: 'transfer',
        date,
        amount,
        category: 'Перевод между счетами',
        description: text(req.body.description) || `Перевод: ${from.name} → ${to.name}`,
        accountFrom: from.name,
        accountTo: to.name,
        comment: req.body.comment,
      }, null, req);
      operations.push(operation);

      writeData('finance_accounts', accounts);
      writeData('finance_operations', operations);
      audit(req, 'finance_accounts.transfer.from', 'finance_accounts', previousFrom, from);
      audit(req, 'finance_accounts.transfer.to', 'finance_accounts', previousTo, to);
      audit(req, 'finance_operations.create', 'finance_operations', null, operation);
      return res.status(201).json({ from, to, operation });
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось выполнить перевод' });
    }
  });

  router.patch('/finance/accounts/:id', requireAuth, requireWrite('finance_accounts'), (req, res) => {
    try {
      const accounts = collectionList('finance_accounts');
      const index = findIndexById(accounts, req.params.id);
      if (index < 0) return res.status(404).json({ ok: false, error: 'Счёт не найден' });
      accessControl.assertCanUpdateEntity('finance_accounts', accounts[index], req.user);
      const previous = accounts[index];
      if (
        previous.status !== 'archived'
        && text(req.body.status) === 'archived'
        && accountHasActiveLinks(previous)
        && !req.body.forceArchive
      ) {
        return res.status(409).json({
          ok: false,
          error: 'У счёта есть активные операции. Подтвердите архивирование.',
          code: 'ACCOUNT_HAS_ACTIVE_LINKS',
        });
      }
      const next = normalizeFinanceAccount(req.body, previous, req);
      accounts[index] = next;
      writeData('finance_accounts', accounts);
      audit(req, 'finance_accounts.update', 'finance_accounts', previous, next);
      return res.json(next);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось обновить счёт' });
    }
  });

  router.get('/finance/operations', requireAuth, requireRead('finance_operations'), (req, res) => {
    const from = dateOnly(req.query.from);
    const to = dateOnly(req.query.to);
    const rows = accessControl
      .filterCollectionByScope('finance_operations', collectionList('finance_operations'), req.user)
      .filter(item => {
        if (from && String(item.date || '') < from) return false;
        if (to && String(item.date || '') > to) return false;
        return true;
      })
      .sort((left, right) => String(right.date || '').localeCompare(String(left.date || '')));
    return res.json(rows);
  });

  router.post('/finance/operations', requireAuth, requireWrite('finance_operations'), (req, res) => {
    try {
      accessControl.assertCanCreateCollection('finance_operations', req.user, req.body);
      const operations = collectionList('finance_operations');
      const next = normalizeFinanceOperation(req.body, null, req);
      operations.push(next);
      writeData('finance_operations', operations);
      audit(req, 'finance_operations.create', 'finance_operations', null, next);
      return res.status(201).json(next);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось создать операцию' });
    }
  });

  router.patch('/finance/operations/:id', requireAuth, requireWrite('finance_operations'), (req, res) => {
    try {
      const operations = collectionList('finance_operations');
      const index = findIndexById(operations, req.params.id);
      if (index < 0) return res.status(404).json({ ok: false, error: 'Операция не найдена' });
      accessControl.assertCanUpdateEntity('finance_operations', operations[index], req.user);
      const previous = operations[index];
      const next = normalizeFinanceOperation(req.body, previous, req);
      operations[index] = next;
      writeData('finance_operations', operations);
      audit(req, 'finance_operations.update', 'finance_operations', previous, next);
      return res.json(next);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось обновить операцию' });
    }
  });

  router.get('/finance/debt-rows', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { rentals, payments } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildRentalDebtRows(rentals, payments, today);
    res.json(rows);
  });

  router.get('/finance/clients', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { clients, rentals, payments } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildClientReceivables(clients, buildRentalDebtRows(rentals, payments), today);
    res.json(rows);
  });

  router.get('/finance/client-snapshots', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { clients, rentals, payments } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildClientFinancialSnapshots(clients, rentals, payments, today);
    res.json(rows);
  });

  router.get('/finance/managers', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { clients, rentals, payments } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildManagerReceivables(buildRentalDebtRows(rentals, payments), today, clients);
    res.json(rows);
  });

  router.get('/finance/manager-breakdown', requireAuth, requireRead('finance_operations'), (req, res) => {
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

  router.get('/finance/aging', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { rentals, payments } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildOverdueBuckets(buildRentalDebtRows(rentals, payments), today);
    res.json(rows);
  });

  router.get('/finance/report', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { clients, rentals, payments, clientObjects, leasingContracts, leasingPaymentSchedule } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    res.json(buildFinanceReport({ clients, rentals, payments, clientObjects, leasingContracts, leasingPaymentSchedule }, today));
  });

  router.get('/finance/receivables', requireAuth, requireRead('finance_operations'), (req, res) => {
    const result = receivablesResponse(req);
    res.json(result);
  });

  router.get('/finance/receivables/summary', requireAuth, requireRead('finance_operations'), (req, res) => {
    const result = receivablesResponse(req);
    res.json(result.summary);
  });

  router.get('/finance/receivables/:clientId', requireAuth, requireRead('finance_operations'), (req, res) => {
    const result = receivablesResponse(req);
    const clientId = String(req.params.clientId || '').trim();
    const row = result.rows.find(item => String(item.clientId || '') === clientId);
    if (!row) return res.status(404).json({ ok: false, error: 'Дебиторка клиента не найдена' });
    return res.json(row);
  });

  router.post('/finance/receivables/workflow-actions', requireAuth, requireWrite('debt_collection_actions'), (req, res) => {
    try {
      accessControl.assertCanCreateCollection('debt_collection_actions', req.user, req.body);
      const row = findReceivableRow(req, req.body.clientId);
      const actions = collectionList('debt_collection_actions');
      const actionId = String(req.body.id || '').trim() || generateId(idPrefixes.debt_collection_actions || 'DCA');
      const next = normalizeAction({
        ...req.body,
        id: actionId,
        fromStage: req.body.fromStage || row.collectionStage || 'new_debt',
        dueDate: req.body.dueDate || (
          req.body.actionType === 'send_notification' ? daysFromNow(5)
            : req.body.actionType === 'send_pretrial_claim' ? daysFromNow(10)
              : undefined
        ),
        status: req.body.status || 'done',
      }, null, {
        generateId,
        idPrefix: idPrefixes.debt_collection_actions || 'DCA',
        nowIso,
        userName: userName(req.user),
      });
      validateStageTransition(row.collectionStage || 'new_debt', next.toStage || row.collectionStage || 'new_debt', {
        override: Boolean(req.body.override),
        comment: next.comment,
        userRole: req.user?.userRole,
      });
      let document = null;
      if (req.body.actionType === 'generate_notification') {
        document = createReceivableDocument(req, row, actionId, 'debt_notification', req.body);
      }
      if (req.body.actionType === 'generate_pretrial_claim') {
        document = createReceivableDocument(req, row, actionId, 'pretrial_claim', req.body);
      }
      if (document?.id) next.documentId = document.id;
      actions.push(next);
      writeData('debt_collection_actions', actions);
      audit(req, 'debt_collection_actions.workflow', 'debt_collection_actions', null, next);
      return res.status(201).json({ action: next, document });
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось выполнить этап взыскания' });
    }
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
