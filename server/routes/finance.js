const express = require('express');
const { buildAllocationPreview, getPaymentAllocationCap } = require('../lib/finance-core');
const { syncGanttRentalPaymentStatuses } = require('../lib/payment-status-sync');
const { buildCashFlow } = require('../lib/cash-flow');
const { normalizeEquipmentFinance, calculateEquipmentDepreciation, buildEquipmentEconomics } = require('../lib/equipment-depreciation');
const {
  prepareDocumentCreate,
  readNumberingSettings,
  writeNumberingSettings,
} = require('../lib/documents-core');
const { getRentalBillingAmount } = require('../lib/rental-billing');
const { linkedRentalIds } = require('../lib/gantt-rental-link-guard');

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
    buildCompanyEconomics,
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
    const classicRentals = readData('rentals') || [];
    const classicRentalIds = new Set(classicRentals.map(item => String(item?.id || '').trim()).filter(Boolean));
    const rentals = (readData('gantt_rentals') || []).filter(item =>
      linkedRentalIds(item).some(id => classicRentalIds.has(id))
    );
    const payments = readData('payments') || [];
    const paymentAllocations = readData('payment_allocations') || [];
    const clientObjects = readData('client_objects') || [];
    const leasingContracts = readData('leasing_contracts') || [];
    const leasingPaymentSchedule = readData('leasing_payment_schedule') || [];
    const documents = readData('documents') || [];
    const financeOperations = readData('finance_operations') || [];
    const financeAccounts = readData('finance_accounts') || [];
    const companyExpenses = readData('company_expenses') || [];
    const equipment = readData('equipment') || [];
    const equipmentFinance = readData('equipment_finance') || [];
    const actions = readData('debt_collection_actions') || [];
    const paymentPlans = readData('receivable_payment_plans') || [];
    // IMPORTANT: finance reports must use backend-scoped collections. Frontend visibility
    // controls are not a data protection boundary.
    return {
      clients: accessControl.filterCollectionByScope('clients', clients, user),
      rentals: accessControl.filterCollectionByScope('gantt_rentals', rentals, user),
      payments: accessControl.filterCollectionByScope('payments', payments, user),
      paymentAllocations: accessControl.filterCollectionByScope('payment_allocations', paymentAllocations, user),
      clientObjects: accessControl.filterCollectionByScope('client_objects', clientObjects, user),
      leasingContracts: accessControl.filterCollectionByScope('leasing_contracts', leasingContracts, user),
      leasingPaymentSchedule: accessControl.filterCollectionByScope('leasing_payment_schedule', leasingPaymentSchedule, user),
      documents: accessControl.filterCollectionByScope('documents', documents, user),
      financeOperations: accessControl.filterCollectionByScope('finance_operations', financeOperations, user),
      financeAccounts: accessControl.filterCollectionByScope('finance_accounts', financeAccounts, user),
      companyExpenses: accessControl.filterCollectionByScope('company_expenses', companyExpenses, user),
      equipment: accessControl.filterCollectionByScope('equipment', equipment, user),
      equipmentFinance: accessControl.filterCollectionByScope('equipment_finance', equipmentFinance, user),
      actions: accessControl.filterCollectionByScope('debt_collection_actions', actions, user),
      paymentPlans: accessControl.filterCollectionByScope('receivable_payment_plans', paymentPlans, user),
    };
  }

  function boolParam(value, fallback) {
    if (value === undefined) return fallback;
    return String(value).trim().toLowerCase() === 'true';
  }

  function getEconomicsCollections(user) {
    return {
      rentals: accessControl.filterCollectionByScope('rentals', collectionList('rentals'), user),
      ganttRentals: accessControl.filterCollectionByScope('gantt_rentals', collectionList('gantt_rentals'), user),
      payments: accessControl.filterCollectionByScope('payments', collectionList('payments'), user),
      paymentAllocations: accessControl.filterCollectionByScope('payment_allocations', collectionList('payment_allocations'), user),
      companyExpenses: accessControl.filterCollectionByScope('company_expenses', collectionList('company_expenses'), user),
      leasingPaymentSchedule: accessControl.filterCollectionByScope('leasing_payment_schedule', collectionList('leasing_payment_schedule'), user),
      service: accessControl.filterCollectionByScope('service', collectionList('service'), user),
      repairWorkItems: accessControl.filterCollectionByScope('repair_work_items', collectionList('repair_work_items'), user),
      repairPartItems: accessControl.filterCollectionByScope('repair_part_items', collectionList('repair_part_items'), user),
      deliveries: accessControl.filterCollectionByScope('deliveries', collectionList('deliveries'), user),
      equipment: accessControl.filterCollectionByScope('equipment', collectionList('equipment'), user),
      equipmentFinance: accessControl.filterCollectionByScope('equipment_finance', collectionList('equipment_finance'), user),
      financeOperations: accessControl.filterCollectionByScope('finance_operations', collectionList('finance_operations'), user),
    };
  }

  function userName(user) {
    return user?.userName || user?.name || user?.email || '';
  }

  function collectionList(name) {
    return Array.isArray(readData(name)) ? readData(name) : [];
  }

  function syncPaymentStatusesAfterAllocationWrite() {
    writeData(
      'gantt_rentals',
      syncGanttRentalPaymentStatuses(
        collectionList('gantt_rentals'),
        collectionList('payments'),
        collectionList('payment_allocations'),
      ),
    );
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

  function readCompanyTaxSettings() {
    const settings = collectionList('app_settings');
    const row = settings.find(item => item?.key === 'company_tax_settings');
    return row?.value && typeof row.value === 'object' ? row.value : {};
  }

  function normalizeCompanyTaxSettings(input = {}, previous = {}) {
    const taxRegime = text(input.taxRegime ?? previous.taxRegime).toUpperCase();
    const vatMode = text(input.vatMode ?? previous.vatMode ?? 'none').toLowerCase();
    const defaultVatRate = Number(input.defaultVatRate ?? previous.defaultVatRate ?? 0);
    return {
      companyName: text(input.companyName ?? previous.companyName) || undefined,
      taxRegime: taxRegime || undefined,
      vatMode: ['none', 'standard', 'simplified', 'custom'].includes(vatMode) ? vatMode : 'none',
      defaultVatRate: Number.isFinite(defaultVatRate) && defaultVatRate >= 0 ? defaultVatRate : 0,
      inputVatEnabled: Boolean(input.inputVatEnabled ?? previous.inputVatEnabled),
      outputVatEnabled: Boolean(input.outputVatEnabled ?? previous.outputVatEnabled),
      vatIncludedByDefault: Boolean(input.vatIncludedByDefault ?? previous.vatIncludedByDefault),
      effectiveFrom: dateOnly(input.effectiveFrom ?? previous.effectiveFrom) || undefined,
      comment: text(input.comment ?? previous.comment) || undefined,
    };
  }

  function writeCompanyTaxSettings(value) {
    const settings = collectionList('app_settings');
    const now = nowIso();
    const existing = settings.find(item => item?.key === 'company_tax_settings');
    const next = {
      ...(existing || {}),
      id: existing?.id || generateId(idPrefixes.app_settings || 'APS'),
      key: 'company_tax_settings',
      value,
      updatedAt: now,
    };
    if (!existing) next.createdAt = now;
    writeData('app_settings', existing ? settings.map(item => item === existing ? next : item) : [...settings, next]);
    return next.value;
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
    const { clients, rentals, payments, paymentAllocations, documents, actions, paymentPlans } = getFinanceCollections(req.user);
    return buildReceivables({ clients, rentals, payments, paymentAllocations, documents, actions, paymentPlans }, today);
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

  router.get('/finance/economics', requireAuth, requireRead('finance_operations'), (req, res) => {
    const result = buildCompanyEconomics(getEconomicsCollections(req.user), {
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      groupBy: req.query.groupBy,
      includeDepreciation: boolParam(req.query.includeDepreciation, true),
      includeVat: boolParam(req.query.includeVat, false),
      equipmentGroup: req.query.equipmentGroup,
    });
    return res.json(result);
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
    const { rentals, payments, paymentAllocations } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildRentalDebtRows(rentals, payments, { paymentAllocations, today });
    res.json(rows);
  });

  router.get('/finance/clients', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { clients, rentals, payments, paymentAllocations } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildClientReceivables(clients, buildRentalDebtRows(rentals, payments, { paymentAllocations }), today);
    res.json(rows);
  });

  router.get('/finance/client-snapshots', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { clients, rentals, payments, paymentAllocations } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildClientFinancialSnapshots(clients, rentals, payments, today, { paymentAllocations });
    res.json(rows);
  });

  router.get('/finance/managers', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { clients, rentals, payments, paymentAllocations } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildManagerReceivables(buildRentalDebtRows(rentals, payments, { paymentAllocations }), today, clients);
    res.json(rows);
  });

  router.get('/finance/manager-breakdown', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { clients, rentals, payments, paymentAllocations } = getFinanceCollections(req.user);
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

    const debtRows = buildRentalDebtRows(rentals, payments, { paymentAllocations });
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
        monthRevenue: managerMonthRentals.reduce((sum, item) => sum + getRentalBillingAmount(item), 0),
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
          amount: getRentalBillingAmount(item),
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
          amount: getRentalBillingAmount(item),
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
    const { rentals, payments, paymentAllocations } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    const rows = buildOverdueBuckets(buildRentalDebtRows(rentals, payments, { paymentAllocations }), today);
    res.json(rows);
  });

  router.get('/finance/report', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { clients, rentals, payments, paymentAllocations, clientObjects, leasingContracts, leasingPaymentSchedule } = getFinanceCollections(req.user);
    const today = String(req.query.today || '').trim() || undefined;
    res.json(buildFinanceReport({ clients, rentals, payments, paymentAllocations, clientObjects, leasingContracts, leasingPaymentSchedule }, today));
  });

  router.get('/finance/tax-settings', requireAuth, requireRead('finance_operations'), (_req, res) => {
    res.json(readCompanyTaxSettings());
  });

  router.patch('/finance/tax-settings', requireAuth, requireWrite('app_settings'), (req, res) => {
    try {
      const previous = readCompanyTaxSettings();
      const next = normalizeCompanyTaxSettings(req.body, previous);
      const saved = writeCompanyTaxSettings(next);
      audit(req, 'company_tax_settings.update', 'app_settings', previous, saved);
      return res.json(saved);
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось сохранить настройки НДС' });
    }
  });

  router.get('/finance/cash-flow', requireAuth, requireRead('finance_operations'), (req, res) => {
    const collections = getFinanceCollections(req.user);
    return res.json(buildCashFlow({
      rentals: collections.rentals,
      payments: collections.payments,
      paymentAllocations: collections.paymentAllocations,
      financeOperations: collections.financeOperations,
      financeAccounts: collections.financeAccounts,
      companyExpenses: collections.companyExpenses,
      leasingPaymentSchedule: collections.leasingPaymentSchedule,
      equipmentFinance: collections.equipmentFinance,
      companyTaxSettings: readCompanyTaxSettings(),
    }, {
      dateFrom: req.query.dateFrom,
      dateTo: req.query.dateTo,
      groupBy: req.query.groupBy,
      mode: req.query.mode,
      includeVat: String(req.query.includeVat || 'true') !== 'false',
      includeDepreciation: String(req.query.includeDepreciation || 'false') === 'true',
    }));
  });

  router.get('/finance/depreciation', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { equipment, equipmentFinance, rentals, payments } = getFinanceCollections(req.user);
    const items = buildEquipmentEconomics({ equipment, equipmentFinance, rentals, payments, asOfDate: dateOnly(req.query.asOfDate) || nowIso().slice(0, 10) });
    const configured = items.filter(item => item.depreciation.status === 'configured');
    res.json({
      summary: {
        equipmentWithDepreciation: configured.length,
        monthlyDepreciationTotal: configured.reduce((sum, item) => sum + item.depreciation.monthlyDepreciation, 0),
        residualValueTotal: configured.reduce((sum, item) => sum + item.depreciation.residualValue, 0),
        purchaseValueTotal: configured.reduce((sum, item) => sum + Number(item.finance.purchasePrice || 0), 0),
      },
      items,
    });
  });

  router.get('/equipment/:id/economics', requireAuth, requireRead('equipment_finance'), (req, res) => {
    const equipment = accessControl.filterCollectionByScope('equipment', collectionList('equipment'), req.user)
      .find(item => text(item.id) === text(req.params.id));
    if (!equipment) return res.status(404).json({ ok: false, error: 'Техника не найдена' });
    const finance = accessControl.filterCollectionByScope('equipment_finance', collectionList('equipment_finance'), req.user)
      .find(item => text(item.equipmentId) === text(req.params.id)) || {};
    const depreciation = calculateEquipmentDepreciation(finance, dateOnly(req.query.asOfDate) || nowIso().slice(0, 10));
    return res.json({ equipmentId: req.params.id, finance, depreciation });
  });

  router.patch('/equipment/:id/economics', requireAuth, requireWrite('equipment_finance'), (req, res) => {
    try {
      const equipment = collectionList('equipment').find(item => text(item.id) === text(req.params.id));
      if (!equipment) return res.status(404).json({ ok: false, error: 'Техника не найдена' });
      const rows = collectionList('equipment_finance');
      const index = rows.findIndex(item => text(item.equipmentId) === text(req.params.id));
      const previous = index >= 0 ? rows[index] : null;
      const next = normalizeEquipmentFinance(req.body, previous || {}, req.params.id);
      next.id = previous?.id || text(req.body.id) || generateId(idPrefixes.equipment_finance || 'EF');
      next.updatedAt = nowIso();
      if (!previous) next.createdAt = next.updatedAt;
      if (index >= 0) rows[index] = next;
      else rows.push(next);
      writeData('equipment_finance', rows);
      audit(req, 'equipment_finance.update', 'equipment_finance', previous, next);
      return res.json({ equipmentId: req.params.id, finance: next, depreciation: calculateEquipmentDepreciation(next, nowIso().slice(0, 10)) });
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось сохранить экономику техники' });
    }
  });

  router.get('/equipment/:id/economics/summary', requireAuth, requireRead('equipment_finance'), (req, res) => {
    const { equipment, equipmentFinance, rentals, payments } = getFinanceCollections(req.user);
    const item = buildEquipmentEconomics({ equipment, equipmentFinance, rentals, payments, service: collectionList('service'), asOfDate: dateOnly(req.query.asOfDate) || nowIso().slice(0, 10) })
      .find(row => text(row.equipmentId) === text(req.params.id));
    if (!item) return res.status(404).json({ ok: false, error: 'Техника не найдена' });
    return res.json(item);
  });

  router.post('/finance/payments/:id/allocation-preview', requireAuth, requireRead('finance_operations'), (req, res) => {
    const { rentals, payments, paymentAllocations } = getFinanceCollections(req.user);
    return res.json(buildAllocationPreview({ payments, paymentAllocations, rentals }, req.params.id));
  });

  router.post('/finance/payments/:id/apply-allocation-preview', requireAuth, requireWrite('payment_allocations'), (req, res) => {
    try {
      const { rentals, payments, paymentAllocations } = getFinanceCollections(req.user);
      const payment = payments.find(item => text(item?.id) === text(req.params.id));
      if (!payment) return res.status(404).json({ ok: false, error: 'Платёж не найден' });
      const rentalIds = new Set(
        [...collectionList('gantt_rentals'), ...collectionList('rentals')]
          .map(item => text(item?.id))
          .filter(Boolean)
      );
      const preview = buildAllocationPreview({ payments, paymentAllocations, rentals }, req.params.id);
      const requested = Array.isArray(req.body?.allocations) ? req.body.allocations : preview.suggestedAllocations;
      const allocations = collectionList('payment_allocations');
      const now = nowIso();
      const existingAllocated = allocations
        .filter(item => text(item?.paymentId) === text(req.params.id) && text(item?.status) !== 'cancelled')
        .reduce((sum, item) => sum + (Number.isFinite(Number(item?.amount)) && Number(item.amount) > 0 ? Number(item.amount) : 0), 0);
      let remaining = Math.max(0, getPaymentAllocationCap(payment) - existingAllocated);
      const created = [];
      for (const item of requested) {
        if (remaining <= 0) break;
        const requestedAmount = money(item?.amount);
        if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) continue;
        const rentalId = text(item.rentalId);
        if (rentalId && !rentalIds.has(rentalId)) {
          return res.status(400).json({ ok: false, error: 'Аренда для распределения не найдена' });
        }
        const amount = Math.min(requestedAmount, remaining);
        created.push({
          id: text(item.id) || generateId(idPrefixes.payment_allocations || 'PA'),
          paymentId: req.params.id,
          clientId: text(item.clientId) || undefined,
          objectId: text(item.objectId) || undefined,
          contractId: text(item.contractId) || undefined,
          rentalId: rentalId || undefined,
          documentId: text(item.documentId) || undefined,
          amount,
          status: 'active',
          comment: text(item.comment) || undefined,
          createdAt: now,
          createdBy: userName(req.user) || undefined,
          createdByUserId: req.user?.userId || req.user?.id || undefined,
        });
        remaining -= amount;
      }
      for (const item of created) accessControl.assertCanCreateCollection('payment_allocations', req.user, item);
      writeData('payment_allocations', [...allocations, ...created]);
      syncPaymentStatusesAfterAllocationWrite();
      created.forEach(item => audit(req, 'payment_allocations.create', 'payment_allocations', null, item));
      return res.status(201).json({ paymentId: req.params.id, allocations: created });
    } catch (error) {
      return res.status(error?.status || 400).json({ ok: false, error: error?.message || 'Не удалось распределить платёж' });
    }
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
