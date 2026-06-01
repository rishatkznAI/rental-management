const { normalizeRole } = require('./role-groups');

const ACTIVITY_TYPES = new Set(['call', 'visit', 'meeting', 'message', 'email', 'commercial_offer', 'task']);
const DIRECTOR_ROLES = new Set(['Администратор', 'Офис-менеджер', 'Руководитель', 'Коммерческий директор']);
const MANAGER_ROLES = new Set(['Менеджер по аренде', 'Менеджер по продажам']);
const SUCCESS_RESULTS = new Set(['completed', 'success', 'successful', 'connected', 'done', 'дозвон', 'успешно']);
const TERMINAL_RENTAL_STATUSES = new Set(['closed', 'returned', 'cancelled', 'canceled', 'completed', 'done']);
const INACTIVE_EQUIPMENT_STATUSES = new Set(['inactive', 'sold', 'written_off', 'written-off', 'archived', 'decommissioned']);

function text(value) {
  return String(value ?? '').trim();
}

function lower(value) {
  return text(value).toLowerCase().replaceAll('ё', 'е');
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function timestampMs(value) {
  const raw = text(value);
  if (!raw) return NaN;
  const parsed = new Date(raw);
  return parsed.getTime();
}

function rangeBoundaryMs(value) {
  const raw = text(value);
  if (!raw) return NaN;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return Date.parse(`${raw}T00:00:00.000Z`);
  return timestampMs(raw);
}

function activityTimeMs(item) {
  return timestampMs(item?.occurredAt || item?.createdAt);
}

function activitySortKey(item) {
  const occurred = activityTimeMs(item);
  const created = timestampMs(item?.createdAt);
  return {
    occurred: Number.isFinite(occurred) ? occurred : Number.MAX_SAFE_INTEGER,
    created: Number.isFinite(created) ? created : Number.MAX_SAFE_INTEGER,
    id: text(item?.id),
  };
}

function compareActivitiesAsc(left, right) {
  const a = activitySortKey(left);
  const b = activitySortKey(right);
  return a.occurred - b.occurred
    || a.created - b.created
    || a.id.localeCompare(b.id);
}

function isoOrNow(value, fallback) {
  const raw = text(value);
  if (raw) {
    const parsed = new Date(raw);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return fallback;
}

function roleOf(user) {
  return normalizeRole(user?.userRole || user?.role || user?.normalizedRole || '');
}

function canUseCrmActivities(user) {
  const role = roleOf(user);
  return DIRECTOR_ROLES.has(role) || MANAGER_ROLES.has(role);
}

function canSeeAllCrmActivities(user) {
  return DIRECTOR_ROLES.has(roleOf(user));
}

function isManagerRole(user) {
  return MANAGER_ROLES.has(roleOf(user));
}

function managerIdOf(user) {
  return text(user?.userId || user?.id);
}

function managerNameOf(user) {
  return text(user?.userName || user?.name);
}

function recordManagerId(record) {
  return text(record?.managerId || record?.responsibleUserId || record?.userId || record?.createdByUserId || record?.createdBy);
}

function recordManagerName(record) {
  return text(record?.managerName || record?.responsibleUserName || record?.manager || record?.createdByName || record?.createdBy);
}

function hasManagerLink(record, user) {
  const userId = managerIdOf(user);
  const userName = lower(managerNameOf(user));
  if (userId && recordManagerId(record) === userId) return true;
  return Boolean(userName && lower(recordManagerName(record)) === userName);
}

function clientLabel(client) {
  return text(client?.company || client?.name || client?.clientName || client?.client);
}

function dealLabel(deal) {
  return text(deal?.title || deal?.company || deal?.id);
}

function rentalLabel(rental) {
  return text(rental?.number || rental?.rentalNumber || rental?.id);
}

function buildLookups(readData) {
  const clients = readData('clients') || [];
  const deals = readData('crm_deals') || [];
  const rentals = [...(readData('rentals') || []), ...(readData('gantt_rentals') || [])];
  const users = readData('users') || [];
  return {
    clients,
    deals,
    rentals,
    users,
    clientsById: new Map(clients.map(item => [text(item?.id), item]).filter(([id]) => id)),
    dealsById: new Map(deals.map(item => [text(item?.id), item]).filter(([id]) => id)),
    rentalsById: new Map(rentals.map(item => [text(item?.id), item]).filter(([id]) => id)),
    usersById: new Map(users.map(item => [text(item?.id), item]).filter(([id]) => id)),
  };
}

function canAccessRelatedEntity(input, user, lookups) {
  if (canSeeAllCrmActivities(user)) return true;
  const clientId = text(input?.clientId);
  const dealId = text(input?.dealId);
  const rentalId = text(input?.rentalId);
  if (clientId) {
    const client = lookups.clientsById.get(clientId);
    if (!client || !hasManagerLink(client, user)) return false;
  }
  if (dealId) {
    const deal = lookups.dealsById.get(dealId);
    if (!deal || !hasManagerLink(deal, user)) return false;
  }
  if (rentalId) {
    const rental = lookups.rentalsById.get(rentalId);
    if (!rental || !hasManagerLink(rental, user)) return false;
  }
  return true;
}

function safeActivity(activity, lookups = {}) {
  const client = lookups.clientsById?.get(text(activity?.clientId));
  const deal = lookups.dealsById?.get(text(activity?.dealId));
  const rental = lookups.rentalsById?.get(text(activity?.rentalId));
  return {
    id: text(activity?.id),
    type: ACTIVITY_TYPES.has(activity?.type) ? activity.type : 'task',
    managerId: text(activity?.managerId),
    managerName: text(activity?.managerName),
    clientId: text(activity?.clientId),
    clientName: clientLabel(client) || text(activity?.clientName),
    contactId: text(activity?.contactId),
    dealId: text(activity?.dealId),
    dealTitle: dealLabel(deal) || text(activity?.dealTitle),
    rentalId: text(activity?.rentalId),
    rentalLabel: rentalLabel(rental) || text(activity?.rentalLabel),
    objectId: text(activity?.objectId),
    address: text(activity?.address),
    occurredAt: isoOrNow(activity?.occurredAt || activity?.createdAt, ''),
    result: text(activity?.result),
    comment: text(activity?.comment).slice(0, 2000),
    nextAction: text(activity?.nextAction).slice(0, 1000),
    nextActionAt: isoOrNow(activity?.nextActionAt, ''),
    createdAt: isoOrNow(activity?.createdAt, ''),
    updatedAt: isoOrNow(activity?.updatedAt, ''),
    createdBy: text(activity?.createdBy),
    updatedBy: text(activity?.updatedBy),
    geo: activity?.geo && typeof activity.geo === 'object' ? activity.geo : undefined,
    photos: Array.isArray(activity?.photos) ? activity.photos : [],
    incomplete: Boolean(activity?.incomplete),
    weakNextStep: Boolean(activity?.weakNextStep),
  };
}

function normalizeActivity(input, { existing = null, user, nowIso, generateId, lookups }) {
  const now = nowIso();
  const type = ACTIVITY_TYPES.has(input?.type) ? input.type : '';
  if (!type) throw Object.assign(new Error('Unsupported activity type'), { status: 400 });
  const clientId = text(input?.clientId ?? existing?.clientId);
  const result = text(input?.result ?? existing?.result);
  const comment = text(input?.comment ?? existing?.comment).slice(0, 2000);
  const nextAction = text(input?.nextAction ?? existing?.nextAction).slice(0, 1000);

  if ((type === 'call' || type === 'visit') && !clientId) {
    throw Object.assign(new Error('clientId is required'), { status: 400 });
  }
  if ((type === 'call' || type === 'visit') && !result) {
    throw Object.assign(new Error('result is required'), { status: 400 });
  }
  if (type === 'call' && !comment && !nextAction) {
    throw Object.assign(new Error('comment or nextAction is required'), { status: 400 });
  }

  const role = roleOf(user);
  const requestedManagerId = text(input?.managerId ?? existing?.managerId);
  const managerId = canSeeAllCrmActivities(user) && requestedManagerId ? requestedManagerId : managerIdOf(user);
  const manager = lookups.usersById?.get(managerId);
  const managerName = text(manager?.name || input?.managerName || existing?.managerName || managerNameOf(user));

  const occurredAt = isoOrNow(input?.occurredAt ?? existing?.occurredAt, now);
  return {
    ...(existing || {}),
    id: text(existing?.id || input?.id) || generateId('CA'),
    type,
    managerId,
    managerName,
    clientId,
    contactId: text(input?.contactId ?? existing?.contactId),
    dealId: text(input?.dealId ?? existing?.dealId),
    rentalId: text(input?.rentalId ?? existing?.rentalId),
    objectId: text(input?.objectId ?? existing?.objectId),
    address: text(input?.address ?? existing?.address),
    occurredAt,
    result,
    comment,
    nextAction,
    nextActionAt: isoOrNow(input?.nextActionAt ?? existing?.nextActionAt, ''),
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    createdBy: text(existing?.createdBy || managerIdOf(user)),
    updatedBy: text(managerIdOf(user)),
    createdByRole: text(existing?.createdByRole || role),
    geo: input?.geo && typeof input.geo === 'object' ? input.geo : existing?.geo,
    photos: Array.isArray(input?.photos) ? input.photos : (Array.isArray(existing?.photos) ? existing.photos : []),
    incomplete: type === 'visit' && !result,
    weakNextStep: !nextAction && !isoOrNow(input?.nextActionAt ?? existing?.nextActionAt, ''),
  };
}

function filterActivities(items, query = {}) {
  const dateFrom = rangeBoundaryMs(query.dateFrom);
  const dateTo = rangeBoundaryMs(query.dateTo);
  return items.filter(item => {
    if (item.deletedAt) return false;
    if (query.managerId && text(item.managerId) !== text(query.managerId)) return false;
    if (query.clientId && text(item.clientId) !== text(query.clientId)) return false;
    if (query.dealId && text(item.dealId) !== text(query.dealId)) return false;
    if (query.type && text(item.type) !== text(query.type)) return false;
    if (query.result && text(item.result) !== text(query.result)) return false;
    const occurredAt = activityTimeMs(item);
    if (Number.isFinite(dateFrom) && (!Number.isFinite(occurredAt) || occurredAt < dateFrom)) return false;
    if (Number.isFinite(dateTo) && (!Number.isFinite(occurredAt) || occurredAt >= dateTo)) return false;
    return true;
  });
}

function callDedupKey(activity) {
  const managerId = text(activity?.managerId);
  const clientId = text(activity?.clientId);
  return managerId && clientId ? `${managerId}\u0000${clientId}` : '';
}

function inHalfOpenRange(value, query = {}) {
  const current = timestampMs(value);
  if (!Number.isFinite(current)) return false;
  const dateFrom = rangeBoundaryMs(query.dateFrom);
  const dateTo = rangeBoundaryMs(query.dateTo);
  if (Number.isFinite(dateFrom) && current < dateFrom) return false;
  if (Number.isFinite(dateTo) && current >= dateTo) return false;
  return true;
}

function isDuplicateCall(activity, previousCall) {
  if (activity.type !== 'call' || !activity.clientId || !previousCall) return false;
  const currentAt = activityTimeMs(activity);
  const previousAt = activityTimeMs(previousCall);
  const delta = currentAt - previousAt;
  return previousCall.type === 'call'
    && previousCall.managerId === activity.managerId
    && previousCall.clientId === activity.clientId
    && Number.isFinite(delta)
    && delta >= 0
    && delta <= 30 * 60 * 1000;
}

function fleetUtilization(readData) {
  const equipment = readData('equipment') || [];
  const rentals = [...(readData('rentals') || []), ...(readData('gantt_rentals') || [])];
  const fleet = equipment.filter(item => {
    if (item?.archived || item?.deleted || item?.isForSale || item?.forSale || item?.saleMode || item?.activeInFleet === false) return false;
    return !INACTIVE_EQUIPMENT_STATUSES.has(lower(item?.status));
  });
  if (!fleet.length) return { percent: 0, known: false };
  const fleetIds = new Set(fleet.map(item => text(item.id)).filter(Boolean));
  const occupied = new Set();
  rentals.forEach(rental => {
    if (TERMINAL_RENTAL_STATUSES.has(lower(rental?.status))) return;
    const equipmentId = text(rental?.equipmentId || rental?.equipment?.[0] || rental?.equipmentIds?.[0]);
    if (fleetIds.has(equipmentId)) occupied.add(equipmentId);
  });
  return { percent: Math.round((occupied.size / fleet.length) * 100), known: true };
}

function buildManagerKpi({ activities = [], deals = [], rentals = [], managers = [], query = {}, readData }) {
  const filtered = filterActivities(activities, query).sort(compareActivitiesAsc);
  const byManager = new Map();
  function row(managerId, managerName) {
    const key = text(managerId) || 'unknown';
    if (!byManager.has(key)) {
      byManager.set(key, {
        managerId: key,
        managerName: text(managerName) || managers.find(item => text(item.id) === key)?.name || 'Менеджер',
        actionsTotal: 0,
        callsTotal: 0,
        qualifiedCalls: 0,
        successfulCalls: 0,
        uniqueCallClients: 0,
        visits: 0,
        incompleteVisits: 0,
        commercialOffers: 0,
        createdDeals: 0,
        wonDeals: 0,
        rentals: 0,
        potentialAmount: 0,
        overdueNextActions: 0,
        weakActivities: 0,
        duplicateCalls: 0,
        warning: '',
      });
    }
    return byManager.get(key);
  }

  const seenCallClients = new Map();
  const previousCalls = new Map();
  filtered.forEach(activity => {
    const current = row(activity.managerId, activity.managerName);
    current.actionsTotal += 1;
    if (activity.weakNextStep) current.weakActivities += 1;
    if (activity.nextActionAt && Date.parse(activity.nextActionAt) < Date.now()) current.overdueNextActions += 1;
    if (activity.type === 'call') {
      current.callsTotal += 1;
      const dedupKey = callDedupKey(activity);
      const previousCall = dedupKey ? previousCalls.get(dedupKey) : null;
      if (isDuplicateCall(activity, previousCall)) current.duplicateCalls += 1;
      else current.qualifiedCalls += 1;
      if (dedupKey) previousCalls.set(dedupKey, activity);
      if (SUCCESS_RESULTS.has(lower(activity.result))) current.successfulCalls += 1;
      if (activity.clientId) {
        const set = seenCallClients.get(current.managerId) || new Set();
        set.add(activity.clientId);
        seenCallClients.set(current.managerId, set);
        current.uniqueCallClients = set.size;
      }
    }
    if (activity.type === 'visit') {
      current.visits += 1;
      if (!activity.result) current.incompleteVisits += 1;
    }
    if (activity.type === 'commercial_offer') current.commercialOffers += 1;
  });

  function inPeriod(value) {
    return inHalfOpenRange(value, query);
  }
  deals.forEach(deal => {
    if (query.managerId && text(deal.responsibleUserId || deal.managerId) !== text(query.managerId)) return;
    const current = row(deal.responsibleUserId || deal.managerId, deal.responsibleUserName || deal.managerName);
    if (inPeriod(deal.createdAt)) current.createdDeals += 1;
    if (deal.status === 'won' && inPeriod(deal.updatedAt || deal.expectedCloseDate || deal.createdAt)) current.wonDeals += 1;
    if (deal.status === 'open') current.potentialAmount += Math.max(0, number(deal.budget));
    if (deal.status === 'open' && deal.nextActionDate && deal.nextActionDate < new Date().toISOString().slice(0, 10)) current.overdueNextActions += 1;
  });
  rentals.forEach(rental => {
    if (query.managerId && recordManagerId(rental) !== text(query.managerId)) return;
    if (inPeriod(rental.createdAt || rental.startDate)) row(recordManagerId(rental), recordManagerName(rental)).rentals += 1;
  });

  const utilization = fleetUtilization(readData);
  const rows = [...byManager.values()].map(item => {
    const lowFleetPressure = utilization.known && utilization.percent < 80;
    const warning = item.actionsTotal >= 10 && item.commercialOffers === 0 && item.createdDeals === 0 && item.rentals === 0
      ? 'Много действий без КП, сделок или аренд'
      : '';
    return {
      ...item,
      fleetUtilizationPercent: utilization.percent,
      activityRequired: lowFleetPressure,
      callsTarget: lowFleetPressure ? 40 : 0,
      visitsTarget: lowFleetPressure ? 2 : 0,
      warning,
    };
  });
  return {
    fleetUtilizationPercent: utilization.percent,
    activityRequired: utilization.known && utilization.percent < 80,
    rows: rows.sort((a, b) => a.managerName.localeCompare(b.managerName, 'ru')),
  };
}

module.exports = {
  ACTIVITY_TYPES,
  buildLookups,
  buildManagerKpi,
  canAccessRelatedEntity,
  canSeeAllCrmActivities,
  canUseCrmActivities,
  filterActivities,
  isManagerRole,
  normalizeActivity,
  safeActivity,
  text,
};
