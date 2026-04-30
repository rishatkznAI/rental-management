const { DELIVERY_STATUS_LABELS, isClosedDelivery } = require('./carrier-delivery-dto');
const { normalizeRole } = require('./role-groups');

const NOTIFICATION_COLLECTION = 'bot_notifications';
const NOTIFICATION_LIMIT = 2000;
const DEFAULT_TIME_ZONE = 'Europe/Moscow';
const SCHEDULER_DISABLED_VALUES = new Set(['0', 'false', 'off', 'disabled']);

const RENTAL_CLOSED_STATUSES = new Set([
  'returned',
  'closed',
  'cancelled',
  'canceled',
  'возвращен',
  'возвращена',
  'закрыт',
  'закрыта',
  'отменен',
  'отменена',
]);

const RENTAL_RETURN_PLANNED_STATUSES = new Set([
  'return_planned',
  'return planned',
  'возврат запланирован',
]);

const DELIVERY_STATUS_EVENTS = new Set(['sent', 'accepted', 'in_transit', 'completed']);

function normalizeText(value) {
  return String(value || '').trim().toLowerCase().replace(/ё/g, 'е');
}

function normalizeStatus(value) {
  return normalizeText(value).replace(/[_-]+/g, ' ');
}

function compact(values) {
  return values
    .flat()
    .map(value => String(value || '').trim())
    .filter(Boolean);
}

function sameText(left, right) {
  const l = normalizeText(left);
  const r = normalizeText(right);
  return Boolean(l && r && l === r);
}

function uniqBy(values, getKey) {
  const seen = new Set();
  return values.filter(value => {
    const key = String(getKey(value) || '').trim();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function dateKeyFor(date = new Date(), timeZone = DEFAULT_TIME_ZONE) {
  if (typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date)) return date;
  const value = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(value.getTime())) return new Date().toISOString().slice(0, 10);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    })
      .formatToParts(value)
      .filter(part => part.type !== 'literal')
      .map(part => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function addDays(dateKey, days) {
  const date = new Date(`${dateKey}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function toDateKey(value) {
  const text = String(value || '').trim();
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function formatDate(value) {
  const date = toDateKey(value);
  if (!date) return 'не указана';
  const [year, month, day] = date.split('-');
  return `${day}.${month}.${year}`;
}

function roleIsAdmin(role) {
  return normalizeRole(role) === 'Администратор';
}

function roleIsManager(role) {
  return normalizeRole(role) === 'Менеджер по аренде';
}

function isRentalClosed(rental) {
  return RENTAL_CLOSED_STATUSES.has(normalizeStatus(rental?.status));
}

function isRentalReturnPlanned(rental) {
  return RENTAL_RETURN_PLANNED_STATUSES.has(normalizeStatus(rental?.status));
}

function isRentalOpenForReturnControl(rental) {
  if (!rental) return false;
  if (isRentalClosed(rental)) return false;
  const status = normalizeStatus(rental.status);
  if (!status) return true;
  return ['active', 'created', 'delivery', 'return planned', 'возврат запланирован'].includes(status);
}

function getRentalReturnDate(rental) {
  return toDateKey(rental?.endDate || rental?.plannedReturnDate || rental?.returnDate || rental?.expectedReturnDate);
}

function getDeliveryDate(delivery) {
  return toDateKey(delivery?.transportDate || delivery?.neededBy || delivery?.date);
}

function deliveryTypeIsShipping(delivery) {
  const type = normalizeText(delivery?.type || delivery?.deliveryType || delivery?.operationType);
  return !type || type === 'shipping' || type === 'dispatch' || type === 'отгрузка';
}

function deliveryStatusLabel(status) {
  return DELIVERY_STATUS_LABELS[status] || status || 'Новая';
}

function isBotNotificationSchedulerEnabled(env = process.env) {
  return env?.NODE_ENV !== 'test' &&
    !SCHEDULER_DISABLED_VALUES.has(String(env?.BOT_NOTIFICATION_SCHEDULER || '1').toLowerCase());
}

function startBotNotificationScheduler({
  env = process.env,
  runTick,
  logger = console,
  setTimeoutImpl = setTimeout,
  setIntervalImpl = setInterval,
  initialDelayMs,
  intervalMs,
} = {}) {
  if (!isBotNotificationSchedulerEnabled(env)) {
    logger?.log?.('[BOT] notification scheduler выключен');
    return null;
  }
  if (typeof runTick !== 'function') {
    throw new Error('Bot notification scheduler requires runTick');
  }

  const safeInitialDelayMs = Math.max(
    5_000,
    Number(initialDelayMs ?? env?.BOT_NOTIFICATION_INITIAL_DELAY_MS ?? 30_000),
  );
  const safeIntervalMs = Math.max(
    15 * 60_000,
    Number(intervalMs ?? env?.BOT_NOTIFICATION_INTERVAL_MS ?? 60 * 60_000),
  );

  const firstTimer = setTimeoutImpl(() => {
    Promise.resolve(runTick('startup')).catch(error => {
      logger?.error?.('[BOT] Ошибка проверки уведомлений на старте:', error?.message || error);
    });
  }, safeInitialDelayMs);
  firstTimer?.unref?.();

  const interval = setIntervalImpl(() => {
    Promise.resolve(runTick('interval')).catch(error => {
      logger?.error?.('[BOT] Ошибка периодической проверки уведомлений:', error?.message || error);
    });
  }, safeIntervalMs);
  interval?.unref?.();

  return { firstTimer, interval };
}

function getRecipientId(phone, botUser) {
  return String(botUser?.userId || botUser?.id || phone || '').trim();
}

function getBotUserRole(botUser) {
  return normalizeRole(botUser?.userRole || botUser?.role || '');
}

function getBotUserName(botUser) {
  return botUser?.userName || botUser?.name || botUser?.email || '';
}

function createBotNotificationService(deps = {}) {
  const {
    readData,
    writeData,
    sendMessage,
    generateId = prefix => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    nowIso = () => new Date().toISOString(),
    accessControl = null,
    logger = console,
    timeZone = DEFAULT_TIME_ZONE,
  } = deps;

  if (typeof readData !== 'function' || typeof writeData !== 'function') {
    throw new Error('Bot notification service requires readData and writeData');
  }

  function readArray(name) {
    const value = readData(name);
    return Array.isArray(value) ? value : [];
  }

  function getBotUsers() {
    const value = readData('bot_users');
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
  }

  function readNotificationEvents() {
    return readArray(NOTIFICATION_COLLECTION);
  }

  function writeNotificationEvents(events) {
    writeData(NOTIFICATION_COLLECTION, (Array.isArray(events) ? events : []).slice(-NOTIFICATION_LIMIT));
  }

  function appendNotificationEvent(event) {
    const events = readNotificationEvents();
    events.push(event);
    writeNotificationEvents(events);
    return event;
  }

  function patchNotificationEvent(id, patch) {
    const events = readNotificationEvents();
    const next = events.map(event => event.id === id ? { ...event, ...patch } : event);
    writeNotificationEvents(next);
  }

  function latestNotificationEvent(eventKey) {
    const events = readNotificationEvents();
    for (let index = events.length - 1; index >= 0; index -= 1) {
      if (events[index]?.eventKey === eventKey) return events[index];
    }
    return null;
  }

  function eventAlreadySent(eventKey) {
    return readNotificationEvents().some(event => event?.eventKey === eventKey && event?.status === 'sent');
  }

  function nonSentAttemptRecorded(eventKey, status) {
    const latest = latestNotificationEvent(eventKey);
    return Boolean(latest && latest.status === status && latest.status !== 'sent');
  }

  function findUserById(userId) {
    const id = String(userId || '').trim();
    if (!id) return null;
    return readArray('users').find(user => String(user?.id || '') === id) || null;
  }

  function findClientName(clientId, fallback = '') {
    const id = String(clientId || '').trim();
    if (!id) return fallback || '';
    const client = readArray('clients').find(item => String(item?.id || '') === id);
    return client?.company || client?.name || fallback || '';
  }

  function getEquipmentRefsFromEntity(entity) {
    const equipmentItems = Array.isArray(entity?.equipment) ? entity.equipment : [];
    return compact([
      entity?.equipmentId,
      entity?.equipmentInv,
      entity?.inventoryNumber,
      entity?.serialNumber,
      entity?.equipmentSerialNumber,
      entity?.equipmentSn,
      entity?.sn,
      equipmentItems.map(item => typeof item === 'object'
        ? [item.id, item.equipmentId, item.inventoryNumber, item.serialNumber, item.inv, item.sn]
        : item),
    ]);
  }

  function findEquipmentForEntity(entity) {
    const refs = getEquipmentRefsFromEntity(entity);
    if (!refs.length) return null;
    return readArray('equipment').find(item => {
      const equipmentRefs = compact([
        item?.id,
        item?.equipmentId,
        item?.inventoryNumber,
        item?.serialNumber,
        item?.inv,
        item?.sn,
      ]);
      return refs.some(ref => equipmentRefs.some(equipmentRef => sameText(ref, equipmentRef)));
    }) || null;
  }

  function formatEquipment(entity, explicitEquipment = null) {
    const equipment = explicitEquipment || findEquipmentForEntity(entity);
    const model = compact([
      equipment?.manufacturer,
      equipment?.brand,
      equipment?.model,
    ]).join(' ') ||
      entity?.equipmentLabel ||
      entity?.equipmentModel ||
      entity?.cargo ||
      entity?.equipmentInv ||
      'Техника не указана';
    const serial = equipment?.serialNumber || entity?.serialNumber || entity?.equipmentSn || entity?.sn || '';
    return serial ? `${model} / SN: ${serial}` : model;
  }

  function getEntityManagerKeys(entity) {
    return compact([
      entity?.managerId,
      entity?.manager_id,
      entity?.managerUserId,
      entity?.responsibleManagerId,
      entity?.responsibleUserId,
      entity?.manager,
      entity?.responsibleManager,
      entity?.createdBy,
      entity?.createdById,
    ]);
  }

  function managerNameForEntity(entity) {
    const byId = findUserById(entity?.managerId || entity?.managerUserId || entity?.responsibleManagerId);
    return entity?.manager || entity?.responsibleManager || byId?.name || byId?.email || 'не указан';
  }

  function botUserMatchesEntityManager(entity, botUser) {
    if (!entity || !botUser) return false;
    if (accessControl && typeof accessControl.matchesUserManager === 'function') {
      return accessControl.matchesUserManager(entity, {
        ...botUser,
        userId: botUser.userId || botUser.id,
        userName: botUser.userName || botUser.name,
        userRole: getBotUserRole(botUser),
      });
    }
    const userKeys = compact([
      botUser?.userId,
      botUser?.id,
      botUser?.userName,
      botUser?.name,
      botUser?.email,
    ]);
    const managerKeys = getEntityManagerKeys(entity);
    return userKeys.some(left => managerKeys.some(right => sameText(left, right)));
  }

  function resolveDeliveryRental(delivery) {
    const ids = compact([
      delivery?.rentalId,
      delivery?.ganttRentalId,
      delivery?.classicRentalId,
      delivery?.sourceRentalId,
    ]);
    if (!ids.length) return null;
    return [...readArray('rentals'), ...readArray('gantt_rentals')]
      .find(rental => ids.some(id => sameText(id, rental?.id) || sameText(id, rental?.rentalId))) || null;
  }

  function eventMatchesManager(event, botUser) {
    return [event.entity, event.rental, event.delivery, event.equipment]
      .filter(Boolean)
      .some(entity => botUserMatchesEntityManager(entity, botUser));
  }

  function eventHasResponsibleManager(event) {
    return [event.entity, event.rental, event.delivery]
      .filter(Boolean)
      .some(entity => getEntityManagerKeys(entity).length > 0);
  }

  function getEventManagerUserIds(event) {
    return uniqBy(
      [event.entity, event.rental, event.delivery]
        .filter(Boolean)
        .flatMap(entity => compact([
          entity?.managerId,
          entity?.manager_id,
          entity?.managerUserId,
          entity?.responsibleManagerId,
          entity?.responsibleUserId,
        ])),
      value => value,
    );
  }

  function isBotUserActive(phone, botUser) {
    if (!botUser || botUser.isActive === false) return false;
    const linkedUser = findUserById(botUser.userId || botUser.id);
    if (linkedUser && linkedUser.status !== 'Активен') return false;
    return Boolean(String(phone || '').trim());
  }

  function resolveBotTarget(phone, botUser) {
    const replyTarget = botUser?.replyTarget || null;
    if (replyTarget && typeof replyTarget === 'object') {
      const target = {
        chat_id: replyTarget.chat_id ?? replyTarget.chatId ?? null,
        user_id: replyTarget.user_id ?? replyTarget.userId ?? botUser?.maxUserId ?? null,
        prefer_user_id: replyTarget.prefer_user_id ?? replyTarget.preferUserId ?? true,
      };
      if (target.chat_id != null || target.user_id != null) return target;
    }
    const maxUserId = botUser?.maxUserId ?? botUser?.max_user_id;
    if (maxUserId != null && String(maxUserId).trim()) {
      return { user_id: Number.isFinite(Number(maxUserId)) ? Number(maxUserId) : String(maxUserId) };
    }
    const phoneText = String(phone || '').trim();
    if (phoneText) {
      return { user_id: Number.isFinite(Number(phoneText)) ? Number(phoneText) : phoneText };
    }
    return null;
  }

  function getRecipientsForEvent(event) {
    return Object.entries(getBotUsers())
      .map(([phone, botUser]) => {
        const role = getBotUserRole(botUser);
        const isAdmin = roleIsAdmin(role);
        const isManager = roleIsManager(role);
        if (!isAdmin && !isManager) return null;
        if (isManager && !eventMatchesManager(event, botUser)) return null;
        return {
          phone,
          botUser,
          role,
          recipientId: getRecipientId(phone, botUser),
          userName: getBotUserName(botUser),
        };
      })
      .filter(Boolean);
  }

  function eventKeyForRecipient(event, recipient) {
    return `${event.keyBase}:${recipient.recipientId}`;
  }

  function baseRecordFor(event, recipient, eventKey, status, reason = null) {
    const timestamp = nowIso();
    return {
      id: generateId('botnotif'),
      eventKey,
      eventType: event.type,
      entityType: event.entityType,
      entityId: event.entityId,
      userId: recipient.recipientId,
      userName: recipient.userName || null,
      userRole: recipient.role || null,
      phone: String(recipient.phone || '') || null,
      status,
      reason,
      text: event.text,
      metadata: event.metadata || {},
      createdAt: timestamp,
      updatedAt: timestamp,
    };
  }

  async function sendEventToRecipient(event, recipient) {
    const eventKey = eventKeyForRecipient(event, recipient);
    if (eventAlreadySent(eventKey)) {
      return { status: 'duplicate_sent', eventKey, recipient };
    }

    if (!isBotUserActive(recipient.phone, recipient.botUser)) {
      if (!nonSentAttemptRecorded(eventKey, 'skipped_inactive')) {
        appendNotificationEvent(baseRecordFor(event, recipient, eventKey, 'skipped_inactive', 'inactive_user'));
      }
      return { status: 'skipped_inactive', reason: 'inactive_user', eventKey, recipient };
    }

    const target = resolveBotTarget(recipient.phone, recipient.botUser);
    if (!target) {
      if (!nonSentAttemptRecorded(eventKey, 'skipped_no_chat_id')) {
        appendNotificationEvent(baseRecordFor(event, recipient, eventKey, 'skipped_no_chat_id', 'no_chat_id'));
      }
      return { status: 'skipped_no_chat_id', reason: 'no_chat_id', eventKey, recipient };
    }

    if (typeof sendMessage !== 'function') {
      if (!nonSentAttemptRecorded(eventKey, 'skipped_send_message_unavailable')) {
        appendNotificationEvent(baseRecordFor(event, recipient, eventKey, 'skipped_send_message_unavailable', 'send_message_unavailable'));
      }
      return { status: 'skipped_send_message_unavailable', reason: 'send_message_unavailable', eventKey, recipient };
    }

    const record = appendNotificationEvent({
      ...baseRecordFor(event, recipient, eventKey, 'pending'),
      target: {
        user_id: target.user_id ?? target.userId ?? null,
        chat_id: target.chat_id ?? target.chatId ?? null,
      },
    });

    try {
      const response = await sendMessage(target, event.text);
      patchNotificationEvent(record.id, {
        status: 'sent',
        sentAt: nowIso(),
        updatedAt: nowIso(),
        maxResponse: response && typeof response === 'object'
          ? {
              messageId: response?.message?.message_id || response?.message?.id || response?.id || null,
              success: response?.success ?? null,
            }
          : null,
      });
      return { status: 'sent', eventKey, recipient };
    } catch (error) {
      patchNotificationEvent(record.id, {
        status: 'failed_send',
        reason: 'send_failed',
        error: error?.message || String(error),
        updatedAt: nowIso(),
      });
      return { status: 'failed_send', reason: 'send_failed', eventKey, recipient, error };
    }
  }

  function appendMissingManagerRecords(event, recipients) {
    const managerIds = getEventManagerUserIds(event);
    if (!managerIds.length) {
      if (eventHasResponsibleManager(event)) return;
      const eventKey = `${event.keyBase}:manager`;
      if (!nonSentAttemptRecorded(eventKey, 'skipped_no_manager')) {
        appendNotificationEvent(baseRecordFor(event, {
          recipientId: 'manager',
          userName: null,
          role: 'Менеджер по аренде',
          phone: null,
        }, eventKey, 'skipped_no_manager', 'no_responsible_manager'));
      }
      return;
    }

    const recipientIds = new Set(recipients
      .filter(recipient => roleIsManager(recipient.role))
      .map(recipient => String(recipient.recipientId || '').trim())
      .filter(Boolean));
    for (const managerId of managerIds) {
      if (recipientIds.has(managerId)) continue;
      const user = findUserById(managerId);
      const eventKey = `${event.keyBase}:${managerId}`;
      if (eventAlreadySent(eventKey) || nonSentAttemptRecorded(eventKey, 'skipped_no_bot_user')) continue;
      appendNotificationEvent(baseRecordFor(event, {
        recipientId: managerId,
        userName: user?.name || user?.email || null,
        role: user?.role || 'Менеджер по аренде',
        phone: null,
      }, eventKey, 'skipped_no_bot_user', 'no_bot_user'));
    }
  }

  async function dispatchEvent(event) {
    const recipients = getRecipientsForEvent(event);
    appendMissingManagerRecords(event, recipients);
    const results = [];
    for (const recipient of recipients) {
      results.push(await sendEventToRecipient(event, recipient));
    }
    return { event, recipients, results };
  }

  function buildReturnMessage(kind, rental) {
    const returnDate = getRentalReturnDate(rental) ||
      toDateKey(rental.actualReturnDate || rental.closedAt || rental.updatedAt || nowIso());
    const title = {
      return_tomorrow: '🔔 Возврат техники завтра',
      return_today: '🔔 Возврат техники сегодня',
      return_overdue: '⚠️ Просроченный возврат техники',
      return_planned: '🔔 Возврат техники запланирован',
      return_completed: '✅ Техника возвращена',
    }[kind] || '🔔 Возврат техники';

    const client = findClientName(rental?.clientId, rental?.client || rental?.company || rental?.clientName || '');
    const action = kind === 'return_completed'
      ? 'проверить приёмку, документы и дальнейший статус техники.'
      : 'проверить готовность приёмки и связаться с клиентом.';

    return [
      title,
      '',
      `Клиент: ${client || 'не указан'}`,
      `Техника: ${formatEquipment(rental)}`,
      `Аренда: №${rental?.number || rental?.id || 'не указана'}`,
      `Дата возврата: ${formatDate(returnDate)}`,
      `Ответственный: ${managerNameForEntity(rental)}`,
      '',
      `Действие: ${action}`,
    ].join('\n');
  }

  function buildReturnEvent(kind, rental, dateKey) {
    const rentalId = String(rental?.id || rental?.rentalId || '').trim();
    if (!rentalId) return null;
    const keyDate = dateKey || getRentalReturnDate(rental) || dateKeyFor(nowIso(), timeZone);
    return {
      type: kind,
      entityType: 'rental',
      entityId: rentalId,
      keyBase: `${kind}:${rentalId}:${keyDate}`,
      text: buildReturnMessage(kind, rental),
      entity: rental,
      rental,
      metadata: {
        date: keyDate,
        returnDate: getRentalReturnDate(rental),
        manager: rental?.manager || null,
        managerId: rental?.managerId || null,
      },
    };
  }

  function buildDispatchMessage(kind, delivery, rental = null, equipment = null) {
    const title = {
      dispatch_created: '🚚 Отгрузка техники',
      dispatch_today: '🚚 Отгрузка техники сегодня',
      dispatch_tomorrow: '🚚 Отгрузка техники завтра',
      dispatch_status_changed: '🚚 Статус отгрузки изменён',
      dispatch_equipment_rented: '🚚 Техника переведена в аренду',
    }[kind] || '🚚 Отгрузка техники';

    const deliveryDate = getDeliveryDate(delivery) || toDateKey(rental?.startDate) || dateKeyFor(nowIso(), timeZone);
    const client = findClientName(
      delivery?.clientId || rental?.clientId,
      delivery?.client || rental?.client || rental?.company || '',
    );
    const managerEntity = delivery || rental || {};
    const status = delivery?.status ? deliveryStatusLabel(delivery.status) : 'В аренде';
    const address = delivery?.destination || rental?.deliveryAddress || delivery?.address || '';

    return [
      title,
      '',
      `Клиент: ${client || 'не указан'}`,
      `Техника: ${formatEquipment(delivery || rental || {}, equipment)}`,
      `Аренда: №${rental?.number || rental?.id || delivery?.rentalId || delivery?.ganttRentalId || delivery?.classicRentalId || 'не указана'}`,
      `Дата отгрузки: ${formatDate(deliveryDate)}`,
      address ? `Адрес: ${address}` : null,
      delivery?.carrierName ? `Перевозчик: ${delivery.carrierName}` : null,
      `Статус доставки: ${status}`,
      '',
      'Действие: проконтролировать передачу техники клиенту.',
    ].filter(Boolean).join('\n');
  }

  function buildDispatchEvent(kind, delivery, keyPart = '') {
    if (!delivery || !deliveryTypeIsShipping(delivery)) return null;
    const deliveryId = String(delivery.id || '').trim();
    if (!deliveryId) return null;
    const rental = resolveDeliveryRental(delivery);
    const equipment = findEquipmentForEntity(delivery) || (rental ? findEquipmentForEntity(rental) : null);
    const keyBase = keyPart
      ? `${kind}:${deliveryId}:${keyPart}`
      : `${kind}:${deliveryId}`;
    return {
      type: kind,
      entityType: 'delivery',
      entityId: deliveryId,
      keyBase,
      text: buildDispatchMessage(kind, delivery, rental, equipment),
      entity: delivery,
      delivery,
      rental,
      equipment,
      metadata: {
        date: getDeliveryDate(delivery),
        status: delivery.status || null,
        manager: delivery.manager || rental?.manager || null,
        managerId: delivery.managerId || rental?.managerId || null,
      },
    };
  }

  function buildEquipmentRentedEvent(rental, equipment) {
    if (!rental) return null;
    const rentalId = String(rental.id || rental.rentalId || '').trim();
    if (!rentalId) return null;
    const date = dateKeyFor(nowIso(), timeZone);
    const delivery = {
      id: rentalId,
      type: 'shipping',
      status: 'completed',
      transportDate: rental.startDate || date,
      client: rental.client,
      clientId: rental.clientId,
      manager: rental.manager,
      managerId: rental.managerId,
      destination: rental.deliveryAddress || '',
      rentalId,
      equipmentId: rental.equipmentId || equipment?.id || '',
      equipmentInv: rental.equipmentInv || equipment?.inventoryNumber || '',
    };
    return {
      type: 'dispatch_equipment_rented',
      entityType: 'rental',
      entityId: rentalId,
      keyBase: `dispatch_equipment_rented:${rentalId}:${date}`,
      text: buildDispatchMessage('dispatch_equipment_rented', delivery, rental, equipment),
      entity: rental,
      delivery,
      rental,
      equipment,
      metadata: {
        date,
        status: 'rented',
        manager: rental.manager || null,
        managerId: rental.managerId || null,
      },
    };
  }

  function getAllRentals() {
    return uniqBy([...readArray('rentals'), ...readArray('gantt_rentals')], rental =>
      rental?.id || `${rental?.clientId || rental?.client}:${rental?.equipmentId || rental?.equipmentInv}:${getRentalReturnDate(rental)}`,
    );
  }

  function getReturnEvents(kind, targetDateKey) {
    return getAllRentals()
      .filter(rental => isRentalOpenForReturnControl(rental))
      .filter(rental => {
        const returnDate = getRentalReturnDate(rental);
        if (!returnDate) return false;
        if (kind === 'return_overdue') return returnDate < targetDateKey;
        return returnDate === targetDateKey;
      })
      .map(rental => buildReturnEvent(kind, rental, kind === 'return_overdue' ? targetDateKey : getRentalReturnDate(rental)))
      .filter(Boolean);
  }

  function getDispatchScheduleEvents(kind, targetDateKey) {
    return readArray('deliveries')
      .filter(delivery => deliveryTypeIsShipping(delivery))
      .filter(delivery => !isClosedDelivery(delivery))
      .filter(delivery => getDeliveryDate(delivery) === targetDateKey)
      .map(delivery => buildDispatchEvent(kind, delivery, targetDateKey))
      .filter(Boolean);
  }

  async function runScheduledNotifications(options = {}) {
    const today = options.todayKey || dateKeyFor(options.today || nowIso(), timeZone);
    const tomorrow = addDays(today, 1);
    const events = [
      ...getReturnEvents('return_today', today),
      ...getReturnEvents('return_tomorrow', tomorrow),
      ...getReturnEvents('return_overdue', today),
      ...getDispatchScheduleEvents('dispatch_today', today),
      ...getDispatchScheduleEvents('dispatch_tomorrow', tomorrow),
    ];

    const deliveries = [];
    for (const event of events) {
      deliveries.push(await dispatchEvent(event));
    }

    return {
      ok: true,
      today,
      tomorrow,
      events: events.length,
      deliveries,
    };
  }

  async function notifyRentalChanged(previousRental, nextRental, options = {}) {
    const events = [];
    const previousStatus = normalizeStatus(previousRental?.status);
    const nextStatus = normalizeStatus(nextRental?.status);
    const today = options.todayKey || dateKeyFor(options.today || nowIso(), timeZone);

    if (isRentalReturnPlanned(nextRental) && previousStatus !== nextStatus) {
      events.push(buildReturnEvent('return_planned', nextRental, getRentalReturnDate(nextRental) || today));
    }

    if (isRentalClosed(nextRental) && !isRentalClosed(previousRental)) {
      events.push(buildReturnEvent('return_completed', nextRental, toDateKey(nextRental?.actualReturnDate || nextRental?.closedAt) || today));
    }

    const deliveries = [];
    for (const event of events.filter(Boolean)) {
      deliveries.push(await dispatchEvent(event));
    }
    return { ok: true, events: events.filter(Boolean).length, deliveries };
  }

  async function notifyRentalReturned(rental, options = {}) {
    const today = options.todayKey || dateKeyFor(options.today || nowIso(), timeZone);
    const event = buildReturnEvent('return_completed', rental, today);
    return event ? dispatchEvent(event) : null;
  }

  async function notifyDeliveryCreated(delivery) {
    const event = buildDispatchEvent('dispatch_created', delivery);
    return event ? dispatchEvent(event) : null;
  }

  async function notifyDeliveryStatusChanged(previousDelivery, nextDelivery) {
    if (!nextDelivery || !deliveryTypeIsShipping(nextDelivery)) return null;
    if (String(previousDelivery?.status || '') === String(nextDelivery.status || '')) return null;
    const status = String(nextDelivery.status || '').trim();
    if (!DELIVERY_STATUS_EVENTS.has(status)) return null;
    const event = buildDispatchEvent('dispatch_status_changed', nextDelivery, status);
    return event ? dispatchEvent(event) : null;
  }

  async function notifyEquipmentRented(rental, equipment) {
    const event = buildEquipmentRentedEvent(rental, equipment);
    return event ? dispatchEvent(event) : null;
  }

  function summarizeRental(rental) {
    return {
      id: rental?.id || null,
      client: findClientName(rental?.clientId, rental?.client || rental?.company || rental?.clientName || ''),
      equipment: formatEquipment(rental),
      returnDate: getRentalReturnDate(rental),
      manager: managerNameForEntity(rental),
      status: rental?.status || null,
    };
  }

  function summarizeDelivery(delivery) {
    const rental = resolveDeliveryRental(delivery);
    return {
      id: delivery?.id || null,
      client: findClientName(delivery?.clientId || rental?.clientId, delivery?.client || rental?.client || ''),
      equipment: formatEquipment(delivery, findEquipmentForEntity(delivery) || (rental ? findEquipmentForEntity(rental) : null)),
      date: getDeliveryDate(delivery),
      manager: managerNameForEntity(delivery || rental || {}),
      carrier: delivery?.carrierName || null,
      status: delivery?.status || null,
    };
  }

  function diagnoseEvent(event) {
    const reasons = [];
    if (!eventHasResponsibleManager(event)) {
      reasons.push({
        eventType: event.type,
        entityId: event.entityId,
        reason: 'no_responsible_manager',
      });
    }

    for (const [phone, botUser] of Object.entries(getBotUsers())) {
      const role = getBotUserRole(botUser);
      const recipient = {
        phone,
        botUser,
        role,
        recipientId: getRecipientId(phone, botUser),
        userName: getBotUserName(botUser),
      };

      if (!roleIsAdmin(role) && !roleIsManager(role)) {
        reasons.push({ eventType: event.type, entityId: event.entityId, userId: recipient.recipientId, userName: recipient.userName, role, reason: 'role_not_allowed' });
        continue;
      }
      if (roleIsManager(role) && !eventMatchesManager(event, botUser)) {
        reasons.push({ eventType: event.type, entityId: event.entityId, userId: recipient.recipientId, userName: recipient.userName, role, reason: 'not_related_manager' });
        continue;
      }
      if (!isBotUserActive(phone, botUser)) {
        reasons.push({ eventType: event.type, entityId: event.entityId, userId: recipient.recipientId, userName: recipient.userName, role, reason: 'inactive_user' });
        continue;
      }
      if (eventAlreadySent(eventKeyForRecipient(event, recipient))) {
        reasons.push({ eventType: event.type, entityId: event.entityId, userId: recipient.recipientId, userName: recipient.userName, role, reason: 'sent_event_key_exists' });
        continue;
      }
      if (!resolveBotTarget(phone, botUser)) {
        reasons.push({ eventType: event.type, entityId: event.entityId, userId: recipient.recipientId, userName: recipient.userName, role, reason: 'no_chat_id' });
      }
    }

    return reasons;
  }

  function getNotificationEventStats() {
    const events = readNotificationEvents();
    const skippedReasonCounts = {};
    const latestByKey = new Map();
    for (const event of events) {
      if (event?.eventKey) latestByKey.set(event.eventKey, event);
      if (String(event?.status || '').startsWith('skipped')) {
        const key = event.reason || event.status || 'unknown';
        skippedReasonCounts[key] = (skippedReasonCounts[key] || 0) + 1;
      }
    }
    return {
      total: events.length,
      sent: events.filter(event => event?.status === 'sent').length,
      failed: events.filter(event => String(event?.status || '').startsWith('failed')).length,
      skipped: events.filter(event => String(event?.status || '').startsWith('skipped')).length,
      pending: events.filter(event => event?.status === 'pending').length,
      skippedReasonCounts,
      latestByEventKey: Array.from(latestByKey.values()).slice(-20).reverse(),
    };
  }

  function getDiagnostics(options = {}) {
    const today = options.todayKey || dateKeyFor(options.today || nowIso(), timeZone);
    const tomorrow = addDays(today, 1);
    const botUsers = getBotUsers();
    const activeBotUsers = Object.entries(botUsers).filter(([phone, user]) => isBotUserActive(phone, user));
    const connectedManagers = activeBotUsers.filter(([phone, user]) => roleIsManager(getBotUserRole(user)) && resolveBotTarget(phone, user));
    const connectedAdmins = activeBotUsers.filter(([phone, user]) => roleIsAdmin(getBotUserRole(user)) && resolveBotTarget(phone, user));

    const returnTodayEvents = getReturnEvents('return_today', today);
    const returnTomorrowEvents = getReturnEvents('return_tomorrow', tomorrow);
    const returnOverdueEvents = getReturnEvents('return_overdue', today);
    const dispatchTodayEvents = getDispatchScheduleEvents('dispatch_today', today);
    const dispatchTomorrowEvents = getDispatchScheduleEvents('dispatch_tomorrow', tomorrow);
    const activeDispatches = readArray('deliveries')
      .filter(delivery => deliveryTypeIsShipping(delivery) && !isClosedDelivery(delivery));

    const currentEvents = [
      ...returnTodayEvents,
      ...returnTomorrowEvents,
      ...returnOverdueEvents,
      ...dispatchTodayEvents,
      ...dispatchTomorrowEvents,
    ];

    return {
      ok: true,
      generatedAt: nowIso(),
      today,
      tomorrow,
      activeBotUsers: activeBotUsers.length,
      connectedManagers: connectedManagers.length,
      connectedAdmins: connectedAdmins.length,
      returnsToday: returnTodayEvents.map(event => summarizeRental(event.rental)),
      returnsTomorrow: returnTomorrowEvents.map(event => summarizeRental(event.rental)),
      overdueReturns: returnOverdueEvents.map(event => summarizeRental(event.rental)),
      dispatchesToday: dispatchTodayEvents.map(event => summarizeDelivery(event.delivery)),
      dispatchesTomorrow: dispatchTomorrowEvents.map(event => summarizeDelivery(event.delivery)),
      activeDispatches: activeDispatches.map(summarizeDelivery),
      notificationEvents: getNotificationEventStats(),
      recentNotificationEvents: readNotificationEvents().slice(-20).reverse(),
      skippedReasons: currentEvents.flatMap(diagnoseEvent).slice(0, 200),
    };
  }

  function visibleEventsForUser(authUser, events) {
    const role = getBotUserRole(authUser);
    if (roleIsAdmin(role)) return events;
    if (!roleIsManager(role)) return [];
    return events.filter(event => eventMatchesManager(event, authUser));
  }

  function listForMenu(authUser, section, options = {}) {
    const today = options.todayKey || dateKeyFor(options.today || nowIso(), timeZone);
    const tomorrow = addDays(today, 1);
    const activeDispatches = readArray('deliveries')
      .filter(delivery => deliveryTypeIsShipping(delivery) && !isClosedDelivery(delivery))
      .map(delivery => buildDispatchEvent('dispatch_today', delivery, getDeliveryDate(delivery) || today))
      .filter(Boolean);
    const sections = {
      returns_today: getReturnEvents('return_today', today),
      returns_tomorrow: getReturnEvents('return_tomorrow', tomorrow),
      returns_overdue: getReturnEvents('return_overdue', today),
      dispatches_today: getDispatchScheduleEvents('dispatch_today', today),
      dispatches_active: activeDispatches,
    };
    const events = visibleEventsForUser(authUser, sections[section] || []);
    return { today, tomorrow, events };
  }

  function formatMenuEvent(event) {
    if (event.entityType === 'delivery') {
      const item = summarizeDelivery(event.delivery);
      return `• ${item.date || 'без даты'} · ${item.equipment} · ${item.client || 'клиент не указан'} · ${deliveryStatusLabel(item.status)}`;
    }
    const item = summarizeRental(event.rental);
    return `• ${item.returnDate || 'без даты'} · ${item.equipment} · ${item.client || 'клиент не указан'} · ${item.manager}`;
  }

  function buildMenuText(authUser, section = 'summary', options = {}) {
    const labels = {
      returns_today: 'Возвраты сегодня',
      returns_tomorrow: 'Возвраты завтра',
      returns_overdue: 'Просроченные возвраты',
      dispatches_today: 'Отгрузки сегодня',
      dispatches_active: 'Активные отгрузки',
    };

    if (section === 'summary') {
      const entries = Object.keys(labels).map(key => {
        const { events } = listForMenu(authUser, key, options);
        return `${labels[key]}: ${events.length}`;
      });
      return ['🔔 Уведомления', '', ...entries].join('\n');
    }

    const { events } = listForMenu(authUser, section, options);
    const title = labels[section] || 'Уведомления';
    if (!events.length) {
      return [`🔔 ${title}`, '', 'Событий нет.'].join('\n');
    }
    return [
      `🔔 ${title} (${events.length})`,
      '',
      ...events.slice(0, 10).map(formatMenuEvent),
      events.length > 10 ? `... и ещё ${events.length - 10}` : '',
    ].filter(Boolean).join('\n');
  }

  async function safely(label, task) {
    try {
      return await task();
    } catch (error) {
      logger?.error?.(`[BOT] ${label}:`, error?.message || String(error));
      return null;
    }
  }

  return {
    NOTIFICATION_COLLECTION,
    buildMenuText,
    dispatchEvent: event => safely('notification dispatch failed', () => dispatchEvent(event)),
    getDiagnostics,
    getNotificationEventStats,
    getRecipientsForEvent,
    notifyDeliveryCreated: delivery => safely('delivery created notification failed', () => notifyDeliveryCreated(delivery)),
    notifyDeliveryStatusChanged: (previousDelivery, nextDelivery) => safely('delivery status notification failed', () => notifyDeliveryStatusChanged(previousDelivery, nextDelivery)),
    notifyEquipmentRented: (rental, equipment) => safely('equipment rented notification failed', () => notifyEquipmentRented(rental, equipment)),
    notifyRentalChanged: (previousRental, nextRental, options) => safely('rental notification failed', () => notifyRentalChanged(previousRental, nextRental, options)),
    notifyRentalReturned: (rental, options) => safely('rental returned notification failed', () => notifyRentalReturned(rental, options)),
    readNotificationEvents,
    runScheduledNotifications: options => safely('scheduled notifications failed', () => runScheduledNotifications(options)),
  };
}

module.exports = {
  NOTIFICATION_COLLECTION,
  createBotNotificationService,
  isBotNotificationSchedulerEnabled,
  startBotNotificationScheduler,
};
