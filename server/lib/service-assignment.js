const { isMechanicRole } = require('./role-groups');

function text(value) {
  return String(value || '').trim();
}

function lower(value) {
  return text(value).toLowerCase();
}

function compact(values) {
  return values.flat(Infinity).map(text).filter(Boolean);
}

function resolveCurrentUserAsMechanic(user, { mechanics = [], users = [] } = {}) {
  if (!isMechanicRole(user?.userRole || user?.role)) return null;

  const userId = text(user?.userId || user?.id);
  const userName = text(user?.userName || user?.name);
  const userEmail = text(user?.email);
  const userMaxId = text(user?.maxUserId);
  const userKeys = compact([userId, userName, userEmail, userMaxId]).map(lower);

  const systemUser = (users || []).find(item => {
    const keys = compact([item?.id, item?.userId, item?.name, item?.userName, item?.email, item?.maxUserId]).map(lower);
    return keys.some(key => userKeys.includes(key));
  });

  const lookupKeys = compact([
    userId,
    userName,
    userEmail,
    userMaxId,
    systemUser?.id,
    systemUser?.userId,
    systemUser?.name,
    systemUser?.userName,
    systemUser?.email,
    systemUser?.maxUserId,
  ]).map(lower);

  const mechanic = (mechanics || []).find(item => {
    const status = lower(item?.status);
    if (status && status !== 'active' && status !== 'активен') return false;
    const keys = compact([item?.id, item?.userId, item?.name, item?.email, item?.maxUserId]).map(lower);
    return keys.some(key => lookupKeys.includes(key));
  }) || null;

  const mechanicName = text(mechanic?.name || systemUser?.name || systemUser?.userName || userName || userEmail || userId);
  const mechanicId = text(mechanic?.id || systemUser?.mechanicId || userId);

  return {
    mechanicId,
    mechanicName,
    userId,
    assignedTo: mechanicName,
  };
}

function assignCurrentUserAsMechanicIfNeeded(ticket, user, collections = {}) {
  const mechanic = resolveCurrentUserAsMechanic(user, collections);
  if (!mechanic) return ticket;

  return {
    ...ticket,
    assignedTo: mechanic.assignedTo,
    assignedUserId: mechanic.userId || ticket?.assignedUserId,
    assignedMechanicId: mechanic.mechanicId,
    assignedMechanicName: mechanic.mechanicName,
    mechanicId: mechanic.mechanicId,
    mechanicName: mechanic.mechanicName,
  };
}

module.exports = {
  resolveCurrentUserAsMechanic,
  assignCurrentUserAsMechanicIfNeeded,
};
