const express = require('express');
const {
  buildClientDebtAgingRows,
  buildClientFinancialSnapshots,
  buildManagerReceivables,
  buildOverdueBuckets,
  buildRentalDebtRows,
  getRentalDebtOverdueDays,
} = require('../lib/finance-core');
const { buildMechanicWorkloadReport } = require('../lib/mechanic-workload');
const { isRegularServiceTicket } = require('../lib/service-ticket-kind');
const {
  buildPaginatedResponse,
  itemMatchesSearch,
} = require('../lib/pagination');

const MAX_REPORT_RANGE_DAYS = 366;
const EXPORT_LIMIT = 5000;
const MONTH_LABELS = ['Янв', 'Фев', 'Мар', 'Апр', 'Май', 'Июн', 'Июл', 'Авг', 'Сен', 'Окт', 'Ноя', 'Дек'];
const TICKET_STATUS_LABELS = {
  new: 'Новые заявки',
  in_progress: 'В ремонте',
  waiting_parts: 'Ожидание запчастей',
  ready: 'Готово к выдаче',
};
const TICKET_STATUS_COLORS = {
  new: '#3b82f6',
  in_progress: '#ef4444',
  waiting_parts: '#f59e0b',
  ready: '#22c55e',
};
const FALLBACK_COLORS = ['#3b82f6', '#ef4444', '#f59e0b', '#22c55e', '#8b5cf6', '#6b7280'];
const SERVICE_SCENARIO_LABELS = { repair: 'Ремонт', to: 'ТО', chto: 'ЧТО', pto: 'ПТО' };
const ACTIVE_FLEET_CATEGORIES = new Set(['own', 'partner']);
const INACTIVE_EQUIPMENT_STATUSES = new Set(['inactive', 'sold', 'written_off', 'written-off', 'archived', 'decommissioned', 'disposed', 'scrapped']);

function normalizeText(value) {
  return String(value ?? '').trim();
}

function saleStatusKind(equipment = {}) {
  const raw = normalizeText(equipment.saleStatus || equipment.status || equipment.mode).toLowerCase();
  if (raw === 'sold' || raw === 'продана') return 'sold';
  if (raw === 'for_sale' || raw === 'on_sale' || raw === 'на продаже') return 'for_sale';
  return '';
}

function isActiveRentalFleetEquipment(equipment = {}) {
  const category = equipment.category ?? 'own';
  const status = normalizeText(equipment.status).toLowerCase();
  return saleStatusKind(equipment) !== 'sold'
    && equipment.activeInFleet !== false
    && ACTIVE_FLEET_CATEGORIES.has(category)
    && !INACTIVE_EQUIPMENT_STATUSES.has(status);
}

function buildActiveRentalFleetLookup(equipment = []) {
  const activeFleet = equipment.filter(isActiveRentalFleetEquipment);
  const byId = new Map();
  const inventoryCounts = new Map();
  const uniqueByInventory = new Map();
  for (const item of activeFleet) {
    if (item.id) byId.set(String(item.id), item);
    const inventory = normalizeText(item.inventoryNumber);
    if (inventory) inventoryCounts.set(inventory, (inventoryCounts.get(inventory) || 0) + 1);
  }
  for (const item of activeFleet) {
    const inventory = normalizeText(item.inventoryNumber);
    if (inventory && inventoryCounts.get(inventory) === 1) uniqueByInventory.set(inventory, item);
  }
  return { activeFleet, byId, uniqueByInventory };
}

function rentalEquipmentKey(rental = {}, lookup) {
  const id = normalizeText(rental.equipmentId);
  if (id && lookup.byId.has(id)) return id;
  const inventory = normalizeText(rental.equipmentInv || rental.inventoryNumber);
  return inventory && lookup.uniqueByInventory.get(inventory)?.id ? String(lookup.uniqueByInventory.get(inventory).id) : '';
}

function calculateCurrentFleetUtilization(equipment = [], rentals = []) {
  const lookup = buildActiveRentalFleetLookup(equipment);
  const rented = new Set();
  for (const rental of rentals) {
    if (normalizeText(rental.status).toLowerCase() !== 'active') continue;
    const key = rentalEquipmentKey(rental, lookup);
    if (key) rented.add(key);
  }
  const activeEquipment = lookup.activeFleet.length;
  return {
    activeEquipment,
    rentedEquipment: rented.size,
    utilization: activeEquipment === 0 ? 0 : Math.round((rented.size / activeEquipment) * 100),
  };
}

function dateOverlapsRental(rental, start, end) {
  const rentalStart = new Date(rental.startDate || rental.dateFrom || rental.createdAt || '');
  const rentalEnd = new Date(rental.endDate || rental.plannedReturnDate || rental.returnDate || rentalStart);
  if (Number.isNaN(rentalStart.getTime()) || Number.isNaN(rentalEnd.getTime())) return false;
  return rentalStart <= end && rentalEnd >= start;
}

function calculateMonthlyFleetUtilization(equipment = [], rentals = [], start, end) {
  const lookup = buildActiveRentalFleetLookup(equipment);
  const rented = new Set();
  for (const rental of rentals) {
    if (!['active', 'returned', 'closed'].includes(normalizeText(rental.status).toLowerCase())) continue;
    if (!dateOverlapsRental(rental, start, end)) continue;
    const key = rentalEquipmentKey(rental, lookup);
    if (key) rented.add(key);
  }
  const activeEquipment = lookup.activeFleet.length;
  return { utilization: activeEquipment === 0 ? 0 : Math.round((rented.size / activeEquipment) * 100) };
}

function isSaleModeEquipment(equipment = {}) {
  return equipment.isForSale === true
    || equipment.forSale === true
    || equipment.saleMode === true
    || ['for_sale', 'sold'].includes(saleStatusKind(equipment));
}

function saleConditionLabel(equipment = {}) {
  const value = normalizeText(equipment.saleCondition || equipment.condition).toLowerCase();
  if (value.includes('нов') || value === 'new') return 'Новая';
  if (value.includes('б/у') || value.includes('used')) return 'Б/у';
  return equipment.saleCondition || equipment.condition || 'Не указано';
}

function getServiceScenarioLabel(kind) {
  return SERVICE_SCENARIO_LABELS[kind] || kind || 'Сервис';
}

function registerReportRoutes(deps) {
  const {
    readData,
    requireAuth,
    requireRead,
    accessControl,
  } = deps;
  const router = express.Router();

  function role(user) {
    return String(user?.userRole || user?.role || '');
  }

  function assertFinanceReportAccess(user) {
    if (['Администратор', 'Офис-менеджер', 'Менеджер по аренде', 'Менеджер по продажам', 'Инвестор'].includes(role(user))) return;
    const error = new Error('Forbidden');
    error.status = 403;
    throw error;
  }

  function scoped(collection, user) {
    return accessControl.sanitizeCollectionForRead(
      collection,
      accessControl.filterCollectionByScope(collection, readData(collection) || [], user),
      user,
    );
  }

  function parseDate(value) {
    const text = String(value || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
    const date = new Date(`${text}T00:00:00.000Z`);
    return Number.isNaN(date.getTime()) ? null : text;
  }

  function addDays(dateText, days) {
    const date = new Date(`${dateText}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);
    return date.toISOString().slice(0, 10);
  }

  function daysBetween(dateFrom, dateTo) {
    return Math.floor((new Date(`${dateTo}T00:00:00.000Z`).getTime() - new Date(`${dateFrom}T00:00:00.000Z`).getTime()) / 86400000) + 1;
  }

  function normalizeReportPeriod(query, fallbackDays = 30) {
    const today = new Date().toISOString().slice(0, 10);
    const fallbackFrom = addDays(today, -(fallbackDays - 1));
    let dateFrom = parseDate(query.dateFrom) || fallbackFrom;
    let dateTo = parseDate(query.dateTo) || today;
    if (dateFrom > dateTo) [dateFrom, dateTo] = [dateTo, dateFrom];
    if (daysBetween(dateFrom, dateTo) > MAX_REPORT_RANGE_DAYS) {
      const error = new Error(`Период отчёта не должен превышать ${MAX_REPORT_RANGE_DAYS} дней`);
      error.status = 400;
      throw error;
    }
    return { dateFrom, dateTo, maxDays: MAX_REPORT_RANGE_DAYS, defaulted: !parseDate(query.dateFrom) || !parseDate(query.dateTo) };
  }

  function dateInRange(value, period) {
    const date = parseDate(value);
    if (!date) return false;
    return date >= period.dateFrom && date <= period.dateTo;
  }

  function rowDateInRange(row, period) {
    return [
      row.startDate,
      row.endDate,
      row.expectedPaymentDate,
      row.paidDate,
      row.date,
      row.createdAt,
    ].some(value => dateInRange(value, period));
  }

  function getEquipmentDocuments(equipment, documents) {
    const label = `${equipment.manufacturer || ''} ${equipment.model || ''}`.trim().toLowerCase();
    return documents.filter(document => {
      const equipmentLabel = String(document.equipment || '').toLowerCase();
      return document.equipmentId === equipment.id
        || document.equipmentInv === equipment.inventoryNumber
        || document.equipmentId === equipment.inventoryNumber
        || (equipment.inventoryNumber && equipmentLabel.includes(String(equipment.inventoryNumber).toLowerCase()))
        || (label && equipmentLabel.includes(label));
    });
  }

  function daysBetweenToday(value) {
    const parsed = new Date(String(value || ''));
    if (!value || Number.isNaN(parsed.getTime())) return 0;
    return Math.max(0, Math.floor((Date.now() - parsed.getTime()) / 86400000));
  }

  function buildFinance(user, period) {
    const clients = scoped('clients', user);
    const rentals = scoped('gantt_rentals', user).filter(row => rowDateInRange(row, period));
    const payments = scoped('payments', user).filter(row => rowDateInRange(row, period));
    const scopedRentalIds = new Set(rentals.map(item => String(item.id || '')).filter(Boolean));
    const scopedPaymentIds = new Set(payments.map(item => String(item.id || '')).filter(Boolean));
    const paymentAllocations = (readData('payment_allocations') || []).filter(allocation => {
      const rentalId = String(allocation?.rentalId || '').trim();
      const paymentId = String(allocation?.paymentId || '').trim();
      return (rentalId && scopedRentalIds.has(rentalId)) || (paymentId && scopedPaymentIds.has(paymentId));
    });
    const debtRows = buildRentalDebtRows(rentals, payments, { paymentAllocations });
    const clientSnapshots = buildClientFinancialSnapshots(clients, rentals, payments, new Date().toISOString().slice(0, 10), { paymentAllocations });
    const managerReceivables = buildManagerReceivables(debtRows, new Date().toISOString().slice(0, 10), clients);
    const overdueBuckets = buildOverdueBuckets(debtRows);
    const clientDebtAgingRows = buildClientDebtAgingRows(clients, debtRows);
    return {
      period,
      debtRows,
      clientDebtAgingRows,
      managerReceivables,
      overdueBuckets,
      summary: {
        debt: clientSnapshots.reduce((sum, item) => sum + item.currentDebt, 0),
        overdueClients: clientSnapshots.filter(item => item.overdueRentals > 0).length,
        exceededClients: clientSnapshots.filter(item => item.exceededLimit).length,
        unpaidRentals: debtRows.length,
        overdueDebt: managerReceivables.reduce((sum, item) => sum + item.overdueDebt, 0),
      },
    };
  }

  const financeSortFields = {
    client: item => item.client,
    manager: item => item.manager,
    debt: item => item.debt ?? item.currentDebt ?? item.outstanding,
    rentals: item => item.rentals ?? item.unpaidRentals,
    overdue: item => item.overdueRentals ?? getRentalDebtOverdueDays(item),
    startDate: item => item.startDate,
    endDate: item => item.endDate,
  };

  function filterFinanceRows(type, rows, query) {
    const searchFields = type === 'manager-receivables'
      ? ['manager']
      : ['client', 'manager', 'equipmentInv', 'rentalId'];
    return rows.filter(row => itemMatchesSearch(row, query.search, searchFields));
  }

  router.get('/reports/finance/summary', requireAuth, requireRead('reports'), (req, res) => {
    try {
      assertFinanceReportAccess(req.user);
      const period = normalizeReportPeriod(req.query, 30);
      const report = buildFinance(req.user, period);
      res.json({
        period,
        summary: report.summary,
        overdueBuckets: report.overdueBuckets,
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/reports/finance/details/:type', requireAuth, requireRead('reports'), (req, res) => {
    try {
      assertFinanceReportAccess(req.user);
      const period = normalizeReportPeriod(req.query, 30);
      const report = buildFinance(req.user, period);
      const source = {
        'client-debt': report.clientDebtAgingRows,
        'manager-receivables': report.managerReceivables,
        'unpaid-rentals': report.debtRows,
      }[req.params.type];
      if (!source) return res.status(404).json({ ok: false, error: 'Unknown report detail type' });
      const filtered = filterFinanceRows(req.params.type, source, req.query);
      res.json(buildPaginatedResponse(filtered, req.query, {
        sortFields: financeSortFields,
        defaultSort: { sortBy: req.params.type === 'unpaid-rentals' ? 'debt' : 'debt', sortDir: 'desc' },
        summary: report.summary,
      }));
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/reports/finance/export', requireAuth, requireRead('reports'), (req, res) => {
    try {
      assertFinanceReportAccess(req.user);
      const period = normalizeReportPeriod(req.query, 30);
      const report = buildFinance(req.user, period);
      const rows = filterFinanceRows('unpaid-rentals', report.debtRows, req.query);
      if (rows.length > EXPORT_LIMIT) {
        return res.status(413).json({ ok: false, error: `Экспорт ограничен ${EXPORT_LIMIT} строками. Сузьте фильтр периода.` });
      }
      res.json({
        items: rows,
        total: rows.length,
        period,
        summary: report.summary,
        clientDebtAgingRows: filterFinanceRows('client-debt', report.clientDebtAgingRows, req.query),
        managerReceivables: filterFinanceRows('manager-receivables', report.managerReceivables, req.query),
        overdueBuckets: report.overdueBuckets,
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message });
    }
  });

  function buildOverview(user) {
    const equipment = scoped('equipment', user);
    const ganttRentals = scoped('gantt_rentals', user);
    const tickets = scoped('service', user);
    const documents = scoped('documents', user);
    const totalEquipment = equipment.length;
    const fleetUtilization = calculateCurrentFleetUtilization(equipment, ganttRentals);
    const activeRentals = ganttRentals.filter(rental => rental.status === 'active').length;
    const openTickets = tickets.filter(ticket => ticket.status !== 'closed').length;
    const utilizationData = [];
    const now = new Date();
    for (let i = 5; i >= 0; i -= 1) {
      const date = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const start = new Date(date.getFullYear(), date.getMonth(), 1);
      const end = new Date(date.getFullYear(), date.getMonth() + 1, 0);
      utilizationData.push({
        month: MONTH_LABELS[date.getMonth()],
        utilization: calculateMonthlyFleetUtilization(equipment, ganttRentals, start, end).utilization,
      });
    }
    const revenueMap = new Map();
    for (const rental of ganttRentals) {
      if (rental.client && Number(rental.amount) > 0) {
        revenueMap.set(rental.client, (revenueMap.get(rental.client) || 0) + Number(rental.amount));
      }
    }
    const downtimeMap = new Map();
    for (const ticket of tickets) {
      if (ticket.status === 'closed') continue;
      downtimeMap.set(ticket.status, (downtimeMap.get(ticket.status) || 0) + 1);
    }
    const salesStockRows = equipment.filter(isSaleModeEquipment).map(item => {
      const itemDocuments = getEquipmentDocuments(item, documents);
      const price = item.salePrice1 ?? 0;
      const cost = item.salePrice3 ?? 0;
      const saleDate = item.actualArrivalDate || item.plannedArrivalDate || item.acceptedAt || item.history?.[0]?.date || '';
      const lastPriceDate = item.history?.find(entry => /цен|price|salePrice/i.test(entry.text))?.date || saleDate;
      const blockers = [
        price <= 0 ? 'нет цены' : '',
        item.salePdiStatus !== 'ready' ? 'PDI' : '',
        itemDocuments.length === 0 ? 'нет документов' : '',
        !item.photo ? 'нет фото' : '',
        item.saleReceiptStatus && item.saleReceiptStatus !== 'accepted' ? 'отгрузка' : '',
      ].filter(Boolean);
      return {
        id: item.id,
        model: `${item.manufacturer || ''} ${item.model || ''}`.trim(),
        inventoryNumber: item.inventoryNumber,
        condition: saleConditionLabel(item),
        price,
        cost,
        margin: price - cost,
        marginPercent: price > 0 && cost > 0 ? Math.round(((price - cost) / price) * 100) : 0,
        pdi: item.salePdiStatus ?? 'not_started',
        documentsCount: itemDocuments.length,
        blockers,
        daysOnSale: daysBetweenToday(saleDate),
        lastPriceDate,
        owner: item.ownerName || item.owner,
        location: item.location,
        hasPhoto: Boolean(item.photo),
        saleReceiptStatus: item.saleReceiptStatus || '',
      };
    });
    const totalPrice = salesStockRows.reduce((sum, row) => sum + row.price, 0);
    const totalCost = salesStockRows.reduce((sum, row) => sum + row.cost, 0);
    const pricedRows = salesStockRows.filter(row => row.price > 0);
    return {
      summary: {
        totalEquipment,
        activeEquipment: fleetUtilization.activeEquipment,
        rentedEquipment: fleetUtilization.rentedEquipment,
        availableEquipment: equipment.filter(item => item.status === 'available').length,
        inServiceEquipment: equipment.filter(item => item.status === 'in_service').length,
        inactiveEquipment: equipment.filter(item => item.status === 'inactive').length,
        activeRentals,
        totalRentals: ganttRentals.length,
        openTickets,
        inProgressTickets: tickets.filter(ticket => ticket.status === 'in_progress').length,
        waitingTickets: tickets.filter(ticket => ticket.status === 'waiting_parts').length,
        utilization: fleetUtilization.activeEquipment === 0 ? null : fleetUtilization.utilization,
        avgUtilization6m: utilizationData.length === 0 ? 0 : Math.round(utilizationData.reduce((sum, row) => sum + row.utilization, 0) / utilizationData.length),
      },
      utilizationData,
      revenueByClient: [...revenueMap.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([clientFull, revenue]) => ({
          clientFull,
          client: clientFull.length > 14 ? `${clientFull.substring(0, 12)}...` : clientFull,
          revenue,
        })),
      downtimeData: [...downtimeMap.entries()]
        .map(([status, count], index) => ({
          reason: TICKET_STATUS_LABELS[status] ?? status,
          count,
          color: TICKET_STATUS_COLORS[status] ?? FALLBACK_COLORS[index % FALLBACK_COLORS.length],
        }))
        .sort((a, b) => b.count - a.count),
      fleetStats: [
        { label: 'Ножничные', count: equipment.filter(item => item.type === 'scissor').length, colorClass: 'bg-blue-500' },
        { label: 'Коленчатые', count: equipment.filter(item => item.type === 'articulated').length, colorClass: 'bg-green-500' },
        { label: 'Телескопические', count: equipment.filter(item => item.type === 'telescopic').length, colorClass: 'bg-purple-500' },
      ],
      salesStockRows,
      salesStockTotals: {
        count: salesStockRows.length,
        totalPrice,
        totalCost,
        totalMargin: totalPrice - totalCost,
        averageMargin: pricedRows.length === 0 ? 0 : Math.round(pricedRows.reduce((sum, row) => sum + row.marginPercent, 0) / pricedRows.length),
        pdiReady: salesStockRows.filter(row => row.pdi === 'ready').length,
        withBlockers: salesStockRows.filter(row => row.blockers.length > 0).length,
        withoutPrice: salesStockRows.filter(row => row.price <= 0).length,
        withoutDocuments: salesStockRows.filter(row => row.documentsCount === 0).length,
        withoutPhoto: salesStockRows.filter(row => !row.hasPhoto).length,
        notReadyForShipment: salesStockRows.filter(row => row.saleReceiptStatus && row.saleReceiptStatus !== 'accepted').length,
        over30: salesStockRows.filter(row => row.daysOnSale > 30).length,
        over60: salesStockRows.filter(row => row.daysOnSale > 60).length,
        over90: salesStockRows.filter(row => row.daysOnSale > 90).length,
        stalePrice30: salesStockRows.filter(row => daysBetweenToday(row.lastPriceDate) > 30).length,
        stalePrice45: salesStockRows.filter(row => daysBetweenToday(row.lastPriceDate) > 45).length,
        stalePrice60: salesStockRows.filter(row => daysBetweenToday(row.lastPriceDate) > 60).length,
      },
    };
  }

  router.get('/reports/overview', requireAuth, requireRead('reports'), (req, res) => {
    try {
      res.json(buildOverview(req.user));
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/reports/sales-stock/details', requireAuth, requireRead('reports'), (req, res) => {
    try {
      const overview = buildOverview(req.user);
      const rows = overview.salesStockRows.filter(row => {
        if (req.query.condition && req.query.condition !== 'all' && !row.condition.toLowerCase().includes(String(req.query.condition).toLowerCase())) return false;
        if (req.query.readiness === 'ready' && row.blockers.length > 0) return false;
        if (req.query.readiness === 'blocked' && row.blockers.length === 0) return false;
        if (req.query.pdi && req.query.pdi !== 'all' && row.pdi !== req.query.pdi) return false;
        if (req.query.docs === 'with' && row.documentsCount === 0) return false;
        if (req.query.docs === 'without' && row.documentsCount > 0) return false;
        return itemMatchesSearch(row, req.query.search, ['model', 'inventoryNumber', 'condition', 'owner', 'location']);
      });
      res.json(buildPaginatedResponse(rows, req.query, {
        sortFields: {
          model: item => item.model,
          price: item => item.price,
          margin: item => item.margin,
          daysOnSale: item => item.daysOnSale,
          lastPriceDate: item => item.lastPriceDate,
        },
        defaultSort: { sortBy: 'daysOnSale', sortDir: 'desc' },
        summary: overview.salesStockTotals,
      }));
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message });
    }
  });

  function safeNonNegativeNumber(value, fallback = 0) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric >= 0 ? numeric : fallback;
  }

  function safePositiveNumber(value, fallback = 1) {
    const numeric = Number(value);
    return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
  }

  function buildService(user, period, query = {}) {
    const mechanics = readData('mechanics') || [];
    const tickets = scoped('service', user).filter(isRegularServiceTicket);
    const equipment = scoped('equipment', user);
    const workItems = scoped('repair_work_items', user);
    const serviceWorks = (readData('service_works') || []);
    const partItems = scoped('repair_part_items', user);
    const fieldTrips = scoped('service_field_trips', user);
    const productivity = buildMechanicWorkloadReport({
      tickets,
      workItems,
      mechanics,
      equipment,
      serviceWorks,
    }, {
      dateFrom: period.dateFrom,
      dateTo: period.dateTo,
      includeStatuses: query.workStatus && query.workStatus !== 'all' ? [String(query.workStatus)] : ['completed'],
    });
    const ticketMap = new Map(tickets.map(item => [item.id, item]));
    const equipmentMap = new Map(equipment.map(item => [item.id, item]));
    const partsByRepair = new Map();
    for (const part of partItems) {
      const group = partsByRepair.get(part.repairId) || [];
      group.push(part);
      partsByRepair.set(part.repairId, group);
    }
    const worksByRepair = new Map();
    for (const item of workItems) {
      const group = worksByRepair.get(item.repairId) || [];
      group.push(item);
      worksByRepair.set(item.repairId, group);
    }
    const repairCostById = new Map();
    const partNamesByRepair = new Map();
    for (const [repairId, repairParts] of partsByRepair.entries()) {
      repairCostById.set(repairId, repairParts.reduce((sum, part) => sum + safeNonNegativeNumber(part.priceSnapshot, 0) * safePositiveNumber(part.quantity, 0), 0));
      partNamesByRepair.set(repairId, Array.from(new Set(repairParts.map(part => part.nameSnapshot).filter(Boolean))));
    }
    const rows = tickets.flatMap(ticket => {
      const ticketWorks = worksByRepair.get(ticket.id) || [];
      const eq = ticket?.equipmentId ? equipmentMap.get(ticket.equipmentId) : null;
      const mechanic = ticket?.assignedMechanicId ? mechanics.find(entry => entry.id === ticket.assignedMechanicId) : null;
      const serviceKind = ticket.serviceKind || 'repair';
      const partNames = partNamesByRepair.get(ticket.id) || [];
      const baseRow = {
        mechanicId: ticket?.assignedMechanicId || '',
        mechanicName: mechanic?.name || ticket?.assignedMechanicName || ticket?.assignedTo || 'Не назначен',
        repairId: ticket.id,
        serviceKind,
        repairStatus: ticket?.status || '',
        createdAt: ticket?.createdAt || '',
        equipmentId: ticket?.equipmentId || '',
        equipmentLabel: ticket?.equipment || [eq?.manufacturer, eq?.model].filter(Boolean).join(' ') || '-',
        equipmentType: eq?.type || ticket?.equipmentType || '',
        equipmentTypeLabel: ticket?.equipmentTypeLabel || ticket?.equipmentType || eq?.type || '',
        inventoryNumber: ticket?.inventoryNumber || eq?.inventoryNumber || '-',
        serialNumber: ticket?.serialNumber || eq?.serialNumber || '-',
        partNames,
        partNamesLabel: partNames.join(', '),
        partsCost: repairCostById.get(ticket.id) || 0,
      };
      if (ticketWorks.length === 0) {
        return [{ ...baseRow, workName: `${getServiceScenarioLabel(serviceKind)} без детализации`, workCategory: getServiceScenarioLabel(serviceKind), quantity: 0, normHours: 0, totalNormHours: 0 }];
      }
      return ticketWorks.map(item => ({
        ...baseRow,
        createdAt: item.createdAt || ticket?.createdAt || '',
        workName: item.nameSnapshot,
        workCategory: item.categorySnapshot || '',
        quantity: safePositiveNumber(item.quantity, 0),
        normHours: safeNonNegativeNumber(item.normHoursSnapshot, 0),
        totalNormHours: safePositiveNumber(item.quantity, 0) * safeNonNegativeNumber(item.normHoursSnapshot, 0),
      }));
    }).filter(row => dateInRange(row.createdAt, period));
    const tripRows = fieldTrips
      .filter(item => item && item.status === 'completed')
      .map(item => {
        const ticket = ticketMap.get(item.serviceTicketId);
        const eq = item?.equipmentId ? equipmentMap.get(item.equipmentId) : (ticket?.equipmentId ? equipmentMap.get(ticket.equipmentId) : null);
        const mechanic = item?.mechanicId ? mechanics.find(entry => entry.id === item.mechanicId) : null;
        const routeFrom = String(item.routeFrom || '').trim();
        const routeTo = String(item.routeTo || '').trim();
        return {
          id: item.id,
          mechanicId: item?.mechanicId || ticket?.assignedMechanicId || '',
          mechanicName: mechanic?.name || item?.mechanicName || ticket?.assignedMechanicName || ticket?.assignedTo || 'Не назначен',
          repairId: item.serviceTicketId || '',
          serviceKind: ticket?.serviceKind || 'repair',
          repairStatus: ticket?.status || '',
          createdAt: item.completedAt || item.startedAt || item.createdAt || '',
          completedAt: item.completedAt || '',
          tripStatus: item.status || 'completed',
          equipmentId: item?.equipmentId || ticket?.equipmentId || '',
          equipmentLabel: item?.equipmentLabel || ticket?.equipment || [eq?.manufacturer, eq?.model].filter(Boolean).join(' ') || '-',
          equipmentType: eq?.type || ticket?.equipmentType || '',
          equipmentTypeLabel: ticket?.equipmentTypeLabel || ticket?.equipmentType || eq?.type || '',
          inventoryNumber: item?.inventoryNumber || ticket?.inventoryNumber || eq?.inventoryNumber || '-',
          serialNumber: ticket?.serialNumber || eq?.serialNumber || '-',
          routeFrom,
          routeTo,
          routeLabel: [routeFrom, routeTo].filter(Boolean).join(' -> '),
          distanceKm: safeNonNegativeNumber(item.distanceKm, 0),
          closedNormHours: safeNonNegativeNumber(item.closedNormHours, 0),
          serviceVehicleId: item.serviceVehicleId || null,
        };
      })
      .filter(row => dateInRange(row.createdAt, period));
    return { rows, fieldTrips: tripRows, productivity };
  }

  function filterServiceRows(rows, query, type) {
    return rows.filter(row => {
      if (query.mechanic && query.mechanic !== 'all' && row.mechanicName !== query.mechanic) return false;
      if (query.scenario && query.scenario !== 'all' && row.serviceKind !== query.scenario) return false;
      if (query.status && query.status !== 'all' && row.repairStatus !== query.status) return false;
      if (query.equipmentType && query.equipmentType !== 'all' && (row.equipmentTypeLabel || row.equipmentType) !== query.equipmentType) return false;
      if (type !== 'field-trips' && query.workCategory && query.workCategory !== 'all' && row.workCategory !== query.workCategory) return false;
      if (type !== 'field-trips' && query.partName && query.partName !== 'all' && !(row.partNames || []).includes(query.partName)) return false;
      return itemMatchesSearch(row, query.search, ['mechanicName', 'repairId', 'equipmentLabel', 'inventoryNumber', 'serialNumber', 'workName', 'workCategory', 'routeLabel']);
    });
  }

  function buildServiceSummary(rows, fieldTrips, productivity) {
    const repairIds = new Set(rows.map(row => row.repairId));
    const repairNormHours = rows.reduce((sum, row) => sum + row.totalNormHours, 0);
    const fieldTripNormHours = fieldTrips.reduce((sum, row) => sum + row.closedNormHours, 0);
    const mechanics = new Set([...rows.map(row => row.mechanicName), ...fieldTrips.map(row => row.mechanicName)].filter(Boolean));
    return {
      mechanicsCount: mechanics.size,
      repairCount: repairIds.size,
      repairNormHours,
      fieldTripCount: fieldTrips.length,
      fieldTripDistance: fieldTrips.reduce((sum, row) => sum + row.distanceKm, 0),
      fieldTripNormHours,
      totalClosedNormHours: repairNormHours + fieldTripNormHours,
      productivityKpi: productivity?.kpi || {},
    };
  }

  router.get('/reports/service/summary', requireAuth, requireRead('reports'), (req, res) => {
    try {
      const period = normalizeReportPeriod(req.query, 30);
      const report = buildService(req.user, period, req.query);
      const rows = filterServiceRows(report.rows, req.query, 'work-details');
      const trips = filterServiceRows(report.fieldTrips, req.query, 'field-trips');
      res.json({ period, summary: buildServiceSummary(rows, trips, report.productivity) });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/reports/service/details/:type', requireAuth, requireRead('reports'), (req, res) => {
    try {
      const period = normalizeReportPeriod(req.query, 30);
      const report = buildService(req.user, period, req.query);
      const type = req.params.type;
      let rows;
      if (type === 'work-details') rows = filterServiceRows(report.rows, req.query, type);
      else if (type === 'field-trips') rows = filterServiceRows(report.fieldTrips, req.query, type);
      else if (type === 'productivity-details') rows = (report.productivity?.details || []).filter(row => dateInRange(row.date, period) && itemMatchesSearch(row, req.query.search, ['mechanicName', 'serviceTicketId', 'equipmentLabel', 'workNameSnapshot', 'category']));
      else return res.status(404).json({ ok: false, error: 'Unknown service detail type' });
      res.json(buildPaginatedResponse(rows, req.query, {
        sortFields: {
          date: item => item.date || item.createdAt,
          mechanic: item => item.mechanicName,
          equipment: item => item.equipmentLabel,
          normHours: item => item.totalNormHours ?? item.closedNormHours ?? item.normHours,
          amount: item => item.amount,
        },
        defaultSort: { sortBy: 'date', sortDir: 'desc' },
        summary: buildServiceSummary(filterServiceRows(report.rows, req.query, 'work-details'), filterServiceRows(report.fieldTrips, req.query, 'field-trips'), report.productivity),
      }));
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message });
    }
  });

  router.get('/reports/service/export', requireAuth, requireRead('reports'), (req, res) => {
    try {
      const period = normalizeReportPeriod(req.query, 30);
      const report = buildService(req.user, period, req.query);
      const rows = filterServiceRows(report.rows, req.query, 'work-details');
      const fieldTrips = filterServiceRows(report.fieldTrips, req.query, 'field-trips');
      const total = rows.length + fieldTrips.length + (report.productivity?.details || []).length;
      if (total > EXPORT_LIMIT) {
        return res.status(413).json({ ok: false, error: `Экспорт ограничен ${EXPORT_LIMIT} строками. Сузьте фильтр периода.` });
      }
      res.json({
        period,
        rows,
        fieldTrips,
        productivity: report.productivity,
        summary: buildServiceSummary(rows, fieldTrips, report.productivity),
      });
    } catch (error) {
      res.status(error.status || 500).json({ ok: false, error: error.message });
    }
  });

  return router;
}

module.exports = { registerReportRoutes };
