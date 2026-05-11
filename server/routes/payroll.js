const express = require('express');
const { normalizeRole } = require('../lib/role-groups');

const PROFILE_COLLECTION = 'payroll_profiles';
const PERIOD_COLLECTION = 'payroll_periods';
const RECORD_COLLECTION = 'payroll_records';
const ADJUSTMENT_COLLECTION = 'payroll_adjustments';
const AUDIT_COLLECTION = 'payroll_audit_events';
const APP_SETTINGS_COLLECTION = 'app_settings';
const KPI_SETTINGS_KEY = 'payroll_kpi_settings';

const PROFILE_KPI_SCHEMES = new Set([
  'none',
  'manual',
  'rental_manager',
  'sales_manager',
  'service_mechanic',
  'office_manager',
  'custom',
]);
const ADJUSTMENT_TYPES = new Set(['bonus', 'deduction', 'advance', 'compensation', 'manual_kpi']);

const DEFAULT_KPI_SETTINGS = {
  rentalManager: {
    percentFromProfitWithoutVat: 0,
    paidOnly: true,
    closedRentalsOnly: true,
    minimumPlan: 0,
    manualBaseAmount: 0,
    comment: '',
  },
  salesManager: {
    percentFromMargin: 0,
    fixedBonusPerSoldEquipment: 0,
    paidSalesOnly: true,
    manualMarginAmount: 0,
    soldEquipmentCount: 0,
    comment: '',
  },
  serviceMechanic: {
    bonusPerClosedTicket: 0,
    bonusPerFieldTrip: 0,
    manualBonus: 0,
    manualClosedTickets: 0,
    manualFieldTrips: 0,
    comment: '',
  },
  officeManager: {
    fixedBonus: 0,
    manualBonus: 0,
    comment: '',
  },
  customSchemes: [],
};

function registerPayrollRoutes(router, deps) {
  const {
    readData,
    writeData,
    requireAuth,
    generateId,
    idPrefixes = {},
    nowIso = () => new Date().toISOString(),
    auditLog,
  } = deps;

  const payrollRouter = express.Router();

  function requireAdmin(req, res, next) {
    if (normalizeRole(req.user?.userRole) !== 'Администратор') {
      return res.status(403).json({ ok: false, error: 'Forbidden' });
    }
    return next();
  }

  payrollRouter.use(requireAuth, requireAdmin);

  function list(name) {
    const value = readData(name);
    return Array.isArray(value) ? value : [];
  }

  function save(name, value) {
    writeData(name, value);
  }

  function payrollId(collection, fallback) {
    return generateId(idPrefixes[collection] || fallback);
  }

  function roundMoney(value, fieldName = 'amount') {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric) || numeric < 0) {
      const error = new Error(`${fieldName} must be a non-negative number`);
      error.status = 400;
      throw error;
    }
    return Math.round(numeric);
  }

  function optionalMoney(value, fieldName) {
    if (value === undefined || value === null || value === '') return undefined;
    return roundMoney(value, fieldName);
  }

  function nonNegativeNumber(value, fieldName = 'value') {
    const numeric = Number(value ?? 0);
    if (!Number.isFinite(numeric) || numeric < 0) {
      const error = new Error(`${fieldName} must be a non-negative number`);
      error.status = 400;
      throw error;
    }
    return numeric;
  }

  function optionalNonNegativeNumber(value, fieldName) {
    if (value === undefined || value === null || value === '') return undefined;
    return nonNegativeNumber(value, fieldName);
  }

  function optionalPercent(value, fieldName) {
    const numeric = optionalNonNegativeNumber(value, fieldName);
    if (numeric !== undefined && numeric > 100) {
      const error = new Error(`${fieldName} must be between 0 and 100`);
      error.status = 400;
      throw error;
    }
    return numeric;
  }

  function monthValue(value) {
    const month = String(value || '').trim();
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      const error = new Error('month must use YYYY-MM format');
      error.status = 400;
      throw error;
    }
    return month;
  }

  function stringValue(value) {
    return String(value ?? '').trim();
  }

  function boolValue(value, fallback = false) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function mergeKpiSettings(input = {}) {
    const rental = input.rentalManager || {};
    const sales = input.salesManager || {};
    const service = input.serviceMechanic || {};
    const office = input.officeManager || {};
    return {
      rentalManager: {
        percentFromProfitWithoutVat: optionalPercent(rental.percentFromProfitWithoutVat, 'percentFromProfitWithoutVat') ?? DEFAULT_KPI_SETTINGS.rentalManager.percentFromProfitWithoutVat,
        paidOnly: boolValue(rental.paidOnly, DEFAULT_KPI_SETTINGS.rentalManager.paidOnly),
        closedRentalsOnly: boolValue(rental.closedRentalsOnly, DEFAULT_KPI_SETTINGS.rentalManager.closedRentalsOnly),
        minimumPlan: optionalMoney(rental.minimumPlan, 'minimumPlan') ?? DEFAULT_KPI_SETTINGS.rentalManager.minimumPlan,
        manualBaseAmount: optionalMoney(rental.manualBaseAmount, 'manualBaseAmount') ?? DEFAULT_KPI_SETTINGS.rentalManager.manualBaseAmount,
        comment: stringValue(rental.comment),
      },
      salesManager: {
        percentFromMargin: optionalPercent(sales.percentFromMargin, 'percentFromMargin') ?? DEFAULT_KPI_SETTINGS.salesManager.percentFromMargin,
        fixedBonusPerSoldEquipment: optionalMoney(sales.fixedBonusPerSoldEquipment, 'fixedBonusPerSoldEquipment') ?? DEFAULT_KPI_SETTINGS.salesManager.fixedBonusPerSoldEquipment,
        paidSalesOnly: boolValue(sales.paidSalesOnly, DEFAULT_KPI_SETTINGS.salesManager.paidSalesOnly),
        manualMarginAmount: optionalMoney(sales.manualMarginAmount, 'manualMarginAmount') ?? DEFAULT_KPI_SETTINGS.salesManager.manualMarginAmount,
        soldEquipmentCount: optionalNonNegativeNumber(sales.soldEquipmentCount, 'soldEquipmentCount') ?? DEFAULT_KPI_SETTINGS.salesManager.soldEquipmentCount,
        comment: stringValue(sales.comment),
      },
      serviceMechanic: {
        bonusPerClosedTicket: optionalMoney(service.bonusPerClosedTicket, 'bonusPerClosedTicket') ?? DEFAULT_KPI_SETTINGS.serviceMechanic.bonusPerClosedTicket,
        bonusPerFieldTrip: optionalMoney(service.bonusPerFieldTrip, 'bonusPerFieldTrip') ?? DEFAULT_KPI_SETTINGS.serviceMechanic.bonusPerFieldTrip,
        manualBonus: optionalMoney(service.manualBonus, 'manualBonus') ?? DEFAULT_KPI_SETTINGS.serviceMechanic.manualBonus,
        manualClosedTickets: optionalNonNegativeNumber(service.manualClosedTickets, 'manualClosedTickets') ?? DEFAULT_KPI_SETTINGS.serviceMechanic.manualClosedTickets,
        manualFieldTrips: optionalNonNegativeNumber(service.manualFieldTrips, 'manualFieldTrips') ?? DEFAULT_KPI_SETTINGS.serviceMechanic.manualFieldTrips,
        comment: stringValue(service.comment),
      },
      officeManager: {
        fixedBonus: optionalMoney(office.fixedBonus, 'fixedBonus') ?? DEFAULT_KPI_SETTINGS.officeManager.fixedBonus,
        manualBonus: optionalMoney(office.manualBonus, 'manualBonus') ?? DEFAULT_KPI_SETTINGS.officeManager.manualBonus,
        comment: stringValue(office.comment),
      },
      customSchemes: Array.isArray(input.customSchemes)
        ? input.customSchemes.map((item, index) => ({
          id: stringValue(item.id || `custom-${index + 1}`),
          name: stringValue(item.name),
          description: stringValue(item.description),
          manualBaseAmount: optionalMoney(item.manualBaseAmount, 'customManualBaseAmount') ?? 0,
          percent: optionalPercent(item.percent, 'customPercent') ?? 0,
          fixedBonus: optionalMoney(item.fixedBonus, 'customFixedBonus') ?? 0,
          isActive: item.isActive !== false,
        })).filter(item => item.name)
        : DEFAULT_KPI_SETTINGS.customSchemes,
    };
  }

  function readKpiSettings() {
    const settings = list(APP_SETTINGS_COLLECTION);
    const existing = settings.find(item => item?.key === KPI_SETTINGS_KEY);
    return mergeKpiSettings(existing?.value || {});
  }

  function writeKpiSettings(value) {
    const settings = list(APP_SETTINGS_COLLECTION);
    const timestamp = nowIso();
    const normalized = mergeKpiSettings(value);
    const existing = settings.find(item => item?.key === KPI_SETTINGS_KEY);
    const next = existing
      ? settings.map(item => item === existing ? { ...item, value: normalized, updatedAt: timestamp } : item)
      : [...settings, {
        id: payrollId(APP_SETTINGS_COLLECTION, 'SET'),
        key: KPI_SETTINGS_KEY,
        value: normalized,
        createdAt: timestamp,
        updatedAt: timestamp,
      }];
    save(APP_SETTINGS_COLLECTION, next);
    return normalized;
  }

  function profilePayload(input, existing = null) {
    const timestamp = nowIso();
    const baseSalary = input.baseSalary === undefined
      ? roundMoney(existing?.baseSalary ?? 0, 'baseSalary')
      : roundMoney(input.baseSalary, 'baseSalary');
    const kpiSchemeType = stringValue(input.kpiSchemeType || existing?.kpiSchemeType || 'none');
    if (!PROFILE_KPI_SCHEMES.has(kpiSchemeType)) {
      const error = new Error('Invalid kpiSchemeType');
      error.status = 400;
      throw error;
    }

    return {
      ...(existing || {}),
      userId: stringValue(input.userId ?? existing?.userId),
      employeeName: stringValue(input.employeeName ?? existing?.employeeName),
      role: stringValue(input.role ?? existing?.role),
      baseSalary,
      currency: 'RUB',
      kpiSchemeType,
      kpiPercent: optionalPercent(input.kpiPercent ?? existing?.kpiPercent, 'kpiPercent'),
      kpiFixedAmount: optionalMoney(input.kpiFixedAmount ?? existing?.kpiFixedAmount, 'kpiFixedAmount'),
      kpiDescription: stringValue(input.kpiDescription ?? existing?.kpiDescription),
      isActive: typeof input.isActive === 'boolean' ? input.isActive : existing?.isActive !== false,
      startedAt: stringValue(input.startedAt ?? existing?.startedAt),
      endedAt: input.endedAt === undefined ? existing?.endedAt ?? null : (input.endedAt ? stringValue(input.endedAt) : null),
      notes: stringValue(input.notes ?? existing?.notes),
      createdAt: existing?.createdAt || timestamp,
      updatedAt: timestamp,
    };
  }

  function assertProfileValid(profile) {
    if (!profile.userId) {
      const error = new Error('userId is required');
      error.status = 400;
      throw error;
    }
    if (!profile.employeeName) {
      const error = new Error('employeeName is required');
      error.status = 400;
      throw error;
    }
  }

  function ensureSingleActiveProfile(profiles, profile, currentId = null) {
    if (!profile.isActive) return;
    const duplicate = profiles.find(item => (
      item.id !== currentId &&
      item.isActive !== false &&
      String(item.userId || '') === profile.userId
    ));
    if (duplicate) {
      const error = new Error('Active payroll profile already exists for this userId');
      error.status = 409;
      throw error;
    }
  }

  function serviceTicketsForProfile(profile, month) {
    return list('service').filter(item => {
      const status = String(item.status || item.state || '').toLowerCase();
      const closed = ['closed', 'completed', 'done', 'завершена', 'закрыта', 'выполнена'].includes(status);
      if (!closed) return false;
      const date = String(item.closedAt || item.completedAt || item.updatedAt || item.date || '');
      if (date && !date.startsWith(month)) return false;
      const assignee = String(item.assignedUserId || item.assignedMechanicId || item.mechanicId || item.responsibleUserId || '');
      const assigneeName = String(item.assignedName || item.mechanicName || item.responsibleName || '');
      return assignee === profile.userId || (!!assigneeName && assigneeName === profile.employeeName);
    });
  }

  function calculateKpi(profile, period, settings) {
    const fixedAmount = Number(profile.kpiFixedAmount || 0);
    const profilePercent = Number(profile.kpiPercent || 0);
    const requiresManualBase = 'База KPI требует ручного ввода';

    if (profile.kpiSchemeType === 'none') {
      return { amount: 0, baseAmount: 0, details: [] };
    }
    if (profile.kpiSchemeType === 'manual') {
      const percentAmount = Math.round(profile.baseSalary * profilePercent / 100);
      const amount = Math.round(percentAmount + fixedAmount);
      return {
        amount,
        baseAmount: profile.baseSalary,
        details: amount > 0 ? [detail('Ручной KPI из профиля', amount, 'kpi', profile.kpiDescription)] : [detail(requiresManualBase, 0, 'info')],
      };
    }
    if (profile.kpiSchemeType === 'rental_manager') {
      const config = settings.rentalManager;
      const baseAmount = roundMoney(config.manualBaseAmount || 0, 'rentalManagerBase');
      const percent = Number(config.percentFromProfitWithoutVat || profilePercent || 0);
      const amount = Math.round(baseAmount * percent / 100);
      return {
        amount,
        baseAmount,
        details: baseAmount > 0
          ? [detail('KPI менеджера аренды', amount, 'kpi', `${percent}% от прибыли без НДС`)]
          : [detail(requiresManualBase, 0, 'info', 'Нет надёжной автоматической базы по прибыли аренды')],
      };
    }
    if (profile.kpiSchemeType === 'sales_manager') {
      const config = settings.salesManager;
      const margin = roundMoney(config.manualMarginAmount || 0, 'salesManagerMargin');
      const percent = Number(config.percentFromMargin || profilePercent || 0);
      const soldCount = Number(config.soldEquipmentCount || 0);
      const fixedBonus = roundMoney(config.fixedBonusPerSoldEquipment || 0, 'fixedBonusPerSoldEquipment') * soldCount;
      const amount = Math.round(margin * percent / 100 + fixedBonus);
      return {
        amount,
        baseAmount: margin,
        details: margin > 0 || fixedBonus > 0
          ? [detail('KPI менеджера продаж', amount, 'kpi', `${percent}% от маржи + бонус за ${soldCount} ед.`)]
          : [detail(requiresManualBase, 0, 'info', 'Нет надёжной автоматической базы по продажной марже')],
      };
    }
    if (profile.kpiSchemeType === 'service_mechanic') {
      const config = settings.serviceMechanic;
      const closedTickets = serviceTicketsForProfile(profile, period.month).length + Number(config.manualClosedTickets || 0);
      const fieldTrips = Number(config.manualFieldTrips || 0);
      const amount = Math.round(
        closedTickets * roundMoney(config.bonusPerClosedTicket || 0, 'bonusPerClosedTicket') +
        fieldTrips * roundMoney(config.bonusPerFieldTrip || 0, 'bonusPerFieldTrip') +
        roundMoney(config.manualBonus || 0, 'manualBonus')
      );
      return {
        amount,
        baseAmount: closedTickets,
        details: amount > 0
          ? [detail('KPI механика сервиса', amount, 'kpi', `Закрытые заявки: ${closedTickets}, выезды: ${fieldTrips}`)]
          : [detail(requiresManualBase, 0, 'info', 'Закрытые заявки или ручной бонус не найдены')],
      };
    }
    if (profile.kpiSchemeType === 'office_manager') {
      const config = settings.officeManager;
      const amount = roundMoney((config.fixedBonus || 0) + (config.manualBonus || 0), 'officeManagerKpi');
      return {
        amount,
        baseAmount: 0,
        details: amount > 0 ? [detail('KPI офис-менеджера', amount, 'kpi', config.comment)] : [detail(requiresManualBase, 0, 'info')],
      };
    }
    const custom = (settings.customSchemes || []).find(item => item.isActive);
    const baseAmount = custom?.manualBaseAmount || 0;
    const amount = Math.round(baseAmount * Number(custom?.percent || profilePercent || 0) / 100 + Number(custom?.fixedBonus || fixedAmount || 0));
    return {
      amount,
      baseAmount,
      details: amount > 0 ? [detail(`KPI: ${custom?.name || 'Индивидуальная схема'}`, amount, 'kpi', custom?.description || profile.kpiDescription)] : [detail(requiresManualBase, 0, 'info')],
    };
  }

  function detail(label, amount, type, comment) {
    return {
      label,
      amount: roundMoney(amount, label),
      type,
      ...(comment ? { comment } : {}),
    };
  }

  function recalculateRecord(record) {
    const baseSalary = roundMoney(record.baseSalary, 'baseSalary');
    const kpiAmount = roundMoney(record.kpiAmount, 'kpiAmount');
    const bonusAmount = roundMoney(record.bonusAmount, 'bonusAmount');
    const deductionAmount = roundMoney(record.deductionAmount, 'deductionAmount');
    const advanceAmount = roundMoney(record.advanceAmount, 'advanceAmount');
    const compensationAmount = roundMoney(record.compensationAmount, 'compensationAmount');
    const grossAmount = baseSalary + kpiAmount + bonusAmount + compensationAmount;
    const netAmount = grossAmount - deductionAmount - advanceAmount;
    return {
      ...record,
      baseSalary,
      kpiAmount,
      bonusAmount,
      deductionAmount,
      advanceAmount,
      compensationAmount,
      grossAmount,
      netAmount,
    };
  }

  function recordFromProfile(period, profile, settings = readKpiSettings()) {
    const timestamp = nowIso();
    const kpi = calculateKpi(profile, period, settings);
    return recalculateRecord({
      id: payrollId(RECORD_COLLECTION, 'PR'),
      periodId: period.id,
      month: period.month,
      userId: profile.userId,
      employeeName: profile.employeeName,
      role: profile.role,
      baseSalary: profile.baseSalary,
      kpiSchemeType: profile.kpiSchemeType,
      kpiPercent: profile.kpiPercent,
      kpiBaseAmount: kpi.baseAmount,
      kpiAmount: kpi.amount,
      bonusAmount: 0,
      deductionAmount: 0,
      advanceAmount: 0,
      compensationAmount: 0,
      grossAmount: 0,
      netAmount: 0,
      calculationDetails: [
        detail('Оклад', profile.baseSalary, 'base'),
        ...(kpi.details || []),
      ],
      status: 'draft',
      adminComment: '',
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  function findPeriodById(periodId) {
    return list(PERIOD_COLLECTION).find(item => item.id === periodId) || null;
  }

  function assertPeriodMutable(period) {
    if (period?.status === 'closed') {
      const error = new Error('Closed payroll period cannot be changed');
      error.status = 409;
      throw error;
    }
  }

  function audit(req, action, entityType, previous, next) {
    const event = {
      id: payrollId(AUDIT_COLLECTION, 'PAE'),
      action,
      entityType,
      entityId: next?.id || previous?.id || '',
      userId: req.user?.userId || '',
      userName: req.user?.userName || req.user?.email || 'Администратор',
      before: previous || null,
      after: next || null,
      reason: stringValue(next?.reason || next?.adminComment || ''),
      createdAt: nowIso(),
    };
    save(AUDIT_COLLECTION, [...list(AUDIT_COLLECTION), event]);
    auditLog?.(req, {
      action: `payroll.${action}`,
      entityType,
      entityId: event.entityId,
      before: previous || null,
      after: next || null,
    });
  }

  payrollRouter.get('/profiles', (_req, res) => {
    res.json(list(PROFILE_COLLECTION));
  });

  payrollRouter.get('/audit-events', (req, res) => {
    const userId = stringValue(req.query.userId);
    const records = list(RECORD_COLLECTION);
    const profiles = list(PROFILE_COLLECTION);
    const relevantRecordIds = userId ? new Set(records.filter(item => item.userId === userId).map(item => item.id)) : null;
    const relevantProfileIds = userId ? new Set(profiles.filter(item => item.userId === userId).map(item => item.id)) : null;
    const events = list(AUDIT_COLLECTION)
      .filter(item => {
        if (!userId) return true;
        if (item.entityType === 'payroll_record') return relevantRecordIds.has(item.entityId) || item.before?.userId === userId || item.after?.userId === userId;
        if (item.entityType === 'payroll_profile') return relevantProfileIds.has(item.entityId) || item.before?.userId === userId || item.after?.userId === userId;
        return false;
      })
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    res.json(events);
  });

  payrollRouter.get('/kpi-settings', (_req, res) => {
    res.json(readKpiSettings());
  });

  payrollRouter.patch('/kpi-settings', (req, res) => {
    try {
      const previous = readKpiSettings();
      const next = writeKpiSettings(req.body || {});
      audit(req, 'kpi_settings.update', 'payroll_kpi_settings', previous, next);
      res.json(next);
    } catch (error) {
      res.status(error.status || 400).json({ ok: false, error: error.message });
    }
  });

  payrollRouter.post('/profiles', (req, res) => {
    try {
      const profiles = list(PROFILE_COLLECTION);
      const profile = {
        id: req.body?.id || payrollId(PROFILE_COLLECTION, 'PP'),
        ...profilePayload(req.body || {}),
      };
      assertProfileValid(profile);
      ensureSingleActiveProfile(profiles, profile);
      save(PROFILE_COLLECTION, [...profiles, profile]);
      audit(req, 'profile.create', 'payroll_profile', null, profile);
      res.status(201).json(profile);
    } catch (error) {
      res.status(error.status || 400).json({ ok: false, error: error.message });
    }
  });

  payrollRouter.patch('/profiles/:id', (req, res) => {
    try {
      const profiles = list(PROFILE_COLLECTION);
      const idx = profiles.findIndex(item => item.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      const previous = profiles[idx];
      const next = { ...profilePayload(req.body || {}, previous), id: previous.id };
      assertProfileValid(next);
      ensureSingleActiveProfile(profiles, next, previous.id);
      const updated = profiles.map(item => item.id === previous.id ? next : item);
      save(PROFILE_COLLECTION, updated);
      audit(req, 'profile.update', 'payroll_profile', previous, next);
      res.json(next);
    } catch (error) {
      res.status(error.status || 400).json({ ok: false, error: error.message });
    }
  });

  payrollRouter.get('/periods', (_req, res) => {
    res.json(list(PERIOD_COLLECTION));
  });

  payrollRouter.post('/periods/calculate', (req, res) => {
    try {
      const month = monthValue(req.body?.month);
      const timestamp = nowIso();
      const periods = list(PERIOD_COLLECTION);
      let period = periods.find(item => item.month === month);
      let nextPeriods = periods;
      if (period?.status === 'closed') {
        const error = new Error('Closed payroll period cannot be recalculated');
        error.status = 409;
        throw error;
      }
      if (!period) {
        period = {
          id: req.body?.periodId || payrollId(PERIOD_COLLECTION, 'PPRD'),
          month,
          status: 'calculated',
          createdAt: timestamp,
          updatedAt: timestamp,
          notes: stringValue(req.body?.notes),
        };
        nextPeriods = [...periods, period];
      } else if (period.status === 'draft' || period.status === 'calculated') {
        period = { ...period, status: 'calculated', updatedAt: timestamp };
        nextPeriods = periods.map(item => item.id === period.id ? period : item);
      }

      const profiles = list(PROFILE_COLLECTION).filter(item => item.isActive !== false);
      const kpiSettings = readKpiSettings();
      const records = list(RECORD_COLLECTION);
      const nextRecords = [...records];
      const adjustments = list(ADJUSTMENT_COLLECTION);
      for (const profile of profiles) {
        const existingIndex = nextRecords.findIndex(item => item.periodId === period.id && item.userId === profile.userId);
        if (existingIndex === -1) {
          nextRecords.push(recordFromProfile(period, profile, kpiSettings));
          continue;
        }
        const existing = nextRecords[existingIndex];
        if (existing.status === 'approved' || existing.status === 'paid') continue;
        const recalculated = recordFromProfile(period, profile, kpiSettings);
        const existingAdjustments = adjustments.filter(item => item.payrollRecordId === existing.id);
        const hasManualKpi = existingAdjustments.some(item => item.type === 'manual_kpi');
        nextRecords[existingIndex] = {
          ...recalculated,
          id: existing.id,
          createdAt: existing.createdAt,
          adminComment: existing.adminComment || '',
          kpiAmount: hasManualKpi ? existing.kpiAmount : recalculated.kpiAmount,
          bonusAmount: existing.bonusAmount || 0,
          deductionAmount: existing.deductionAmount || 0,
          advanceAmount: existing.advanceAmount || 0,
          compensationAmount: existing.compensationAmount || 0,
          calculationDetails: [
            ...recalculated.calculationDetails,
            ...(existing.calculationDetails || []).filter(item => item.type !== 'base' && !(item.type === 'kpi' && item.label === 'KPI')),
          ],
        };
        nextRecords[existingIndex] = recalculateRecord(nextRecords[existingIndex]);
      }
      save(PERIOD_COLLECTION, nextPeriods);
      save(RECORD_COLLECTION, nextRecords);
      audit(req, 'period.calculate', 'payroll_period', null, period);
      res.status(201).json({
        period,
        records: nextRecords.filter(item => item.periodId === period.id),
      });
    } catch (error) {
      res.status(error.status || 400).json({ ok: false, error: error.message });
    }
  });

  payrollRouter.get('/records', (req, res) => {
    try {
      const month = req.query.month ? monthValue(req.query.month) : null;
      const records = list(RECORD_COLLECTION);
      res.json(month ? records.filter(item => item.month === month) : records);
    } catch (error) {
      res.status(error.status || 400).json({ ok: false, error: error.message });
    }
  });

  payrollRouter.get('/records/:id', (req, res) => {
    const record = list(RECORD_COLLECTION).find(item => item.id === req.params.id);
    if (!record) return res.status(404).json({ ok: false, error: 'Not found' });
    return res.json(record);
  });

  payrollRouter.get('/adjustments', (req, res) => {
    const userId = stringValue(req.query.userId);
    const records = list(RECORD_COLLECTION);
    const byId = new Map(records.map(item => [item.id, item]));
    const adjustments = list(ADJUSTMENT_COLLECTION)
      .map(item => {
        const record = byId.get(item.payrollRecordId);
        return {
          ...item,
          month: record?.month || '',
          employeeName: record?.employeeName || '',
          userId: record?.userId || '',
        };
      })
      .filter(item => !userId || item.userId === userId)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return res.json(adjustments);
  });

  payrollRouter.get('/records/:id/adjustments', (req, res) => {
    const record = list(RECORD_COLLECTION).find(item => item.id === req.params.id);
    if (!record) return res.status(404).json({ ok: false, error: 'Not found' });
    const adjustments = list(ADJUSTMENT_COLLECTION)
      .filter(item => item.payrollRecordId === req.params.id)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    return res.json(adjustments);
  });

  payrollRouter.patch('/records/:id', (req, res) => {
    try {
      const records = list(RECORD_COLLECTION);
      const idx = records.findIndex(item => item.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      const previous = records[idx];
      assertPeriodMutable(findPeriodById(previous.periodId));
      if (previous.status !== 'draft') {
        const error = new Error('Locked payroll record cannot be changed');
        error.status = 409;
        throw error;
      }
      const next = recalculateRecord({
        ...previous,
        baseSalary: req.body.baseSalary === undefined ? previous.baseSalary : roundMoney(req.body.baseSalary, 'baseSalary'),
        kpiAmount: req.body.kpiAmount === undefined ? previous.kpiAmount : roundMoney(req.body.kpiAmount, 'kpiAmount'),
        bonusAmount: req.body.bonusAmount === undefined ? previous.bonusAmount : roundMoney(req.body.bonusAmount, 'bonusAmount'),
        deductionAmount: req.body.deductionAmount === undefined ? previous.deductionAmount : roundMoney(req.body.deductionAmount, 'deductionAmount'),
        advanceAmount: req.body.advanceAmount === undefined ? previous.advanceAmount : roundMoney(req.body.advanceAmount, 'advanceAmount'),
        compensationAmount: req.body.compensationAmount === undefined ? previous.compensationAmount : roundMoney(req.body.compensationAmount, 'compensationAmount'),
        adminComment: req.body.adminComment === undefined ? previous.adminComment : stringValue(req.body.adminComment),
        calculationDetails: [
          ...(previous.calculationDetails || []),
          {
            label: 'Ручное изменение',
            amount: 0,
            type: 'info',
            comment: stringValue(req.body.reason || req.body.adminComment || 'Корректировка записи администратором'),
          },
        ],
        updatedAt: nowIso(),
      });
      save(RECORD_COLLECTION, records.map(item => item.id === previous.id ? next : item));
      audit(req, 'record.update', 'payroll_record', previous, next);
      res.json(next);
    } catch (error) {
      res.status(error.status || 400).json({ ok: false, error: error.message });
    }
  });

  payrollRouter.post('/records/:id/adjustments', (req, res) => {
    try {
      const records = list(RECORD_COLLECTION);
      const idx = records.findIndex(item => item.id === req.params.id);
      if (idx === -1) return res.status(404).json({ ok: false, error: 'Not found' });
      const previous = records[idx];
      assertPeriodMutable(findPeriodById(previous.periodId));
      if (previous.status !== 'draft') {
        const error = new Error('Locked payroll record cannot be changed');
        error.status = 409;
        throw error;
      }
      const type = stringValue(req.body?.type);
      if (!ADJUSTMENT_TYPES.has(type)) {
        const error = new Error('Invalid adjustment type');
        error.status = 400;
        throw error;
      }
      const amount = roundMoney(req.body?.amount, 'amount');
      const adjustment = {
        id: req.body?.id || payrollId(ADJUSTMENT_COLLECTION, 'PADJ'),
        payrollRecordId: previous.id,
        type,
        amount,
        reason: stringValue(req.body?.reason),
        createdByUserId: req.user?.userId || '',
        createdByName: req.user?.userName || req.user?.email || 'Администратор',
        createdAt: nowIso(),
      };
      const fieldByType = {
        bonus: 'bonusAmount',
        deduction: 'deductionAmount',
        advance: 'advanceAmount',
        compensation: 'compensationAmount',
        manual_kpi: 'kpiAmount',
      };
      const detailType = type === 'manual_kpi' ? 'kpi' : type;
      const next = recalculateRecord({
        ...previous,
        [fieldByType[type]]: roundMoney(previous[fieldByType[type]] || 0) + amount,
        calculationDetails: [
          ...(previous.calculationDetails || []),
          detail(adjustment.reason || 'Корректировка', amount, detailType, adjustment.reason),
        ],
        updatedAt: nowIso(),
      });
      save(ADJUSTMENT_COLLECTION, [...list(ADJUSTMENT_COLLECTION), adjustment]);
      save(RECORD_COLLECTION, records.map(item => item.id === previous.id ? next : item));
      audit(req, `record.adjustment.${type}`, 'payroll_record', previous, { ...next, reason: adjustment.reason });
      res.status(201).json({ adjustment, record: next });
    } catch (error) {
      res.status(error.status || 400).json({ ok: false, error: error.message });
    }
  });

  function transitionPeriod(req, res, nextStatus, dateField, recordStatus) {
    try {
      const periods = list(PERIOD_COLLECTION);
      const period = periods.find(item => item.id === req.params.id);
      if (!period) return res.status(404).json({ ok: false, error: 'Not found' });
      if (period.status === 'closed' && nextStatus !== 'closed') {
        const error = new Error('Closed payroll period cannot be changed');
        error.status = 409;
        throw error;
      }
      const timestamp = nowIso();
      const next = {
        ...period,
        status: nextStatus,
        [dateField]: timestamp,
        updatedAt: timestamp,
      };
      save(PERIOD_COLLECTION, periods.map(item => item.id === period.id ? next : item));
      const records = list(RECORD_COLLECTION);
      const nextRecords = records.map(item => (
        item.periodId === period.id
          ? { ...item, status: recordStatus, [dateField]: timestamp, updatedAt: timestamp }
          : item
      ));
      save(RECORD_COLLECTION, nextRecords);
      audit(req, `period.${nextStatus}`, 'payroll_period', period, next);
      res.json({
        period: next,
        records: nextRecords.filter(item => item.periodId === period.id),
      });
    } catch (error) {
      res.status(error.status || 400).json({ ok: false, error: error.message });
    }
  }

  payrollRouter.post('/periods/:id/approve', (req, res) => transitionPeriod(req, res, 'approved', 'approvedAt', 'approved'));
  payrollRouter.post('/periods/:id/mark-paid', (req, res) => transitionPeriod(req, res, 'paid', 'paidAt', 'paid'));
  payrollRouter.post('/periods/:id/close', (req, res) => transitionPeriod(req, res, 'closed', 'closedAt', 'paid'));

  router.use('/payroll', payrollRouter);
  return router;
}

module.exports = {
  registerPayrollRoutes,
};
