const { createBotUi } = require('./bot-ui');
const { createBotFormatters } = require('./bot-formatters');
const { createBotOperations } = require('./bot-operations');
const {
  attachBotBrandImage,
  attachMechanicStageImage,
  operationStageImageKey,
} = require('./bot-stage-images');
const { isMechanicRole } = require('./role-groups');

function createBotHandlers(deps) {
  const {
    readData,
    writeData,
    verifyPassword,
    getBotUsers,
    saveBotUsers,
    getBotSessions,
    saveBotSessions,
    sendMessage,
    deleteMessage,
    answerCallback,
    generateId,
    idPrefixes,
    nowIso,
    readServiceTickets,
    writeServiceTickets,
    findServiceTicketById,
    saveServiceTicket,
    appendServiceLog,
    getMechanicReferenceByUser,
    syncEquipmentStatusForService,
    updateServiceTicketStatus,
    getOpenTicketByEquipment,
    serviceStatusLabel,
    preferCarrierAutoLogin = false,
  } = deps;
  const {
    button,
    keyboard,
    backAndMainRow,
    chunkButtons,
    authKeyboard,
    mechanicKeyboard,
    rentalManagerKeyboard,
    carrierKeyboard,
    currentRepairKeyboard,
    operationsKeyboard,
    repairActionsKeyboard,
    repairReasonKeyboard,
    quantityKeyboard,
    operationKeyboard,
    defaultKeyboardForRole,
    REPAIR_REASON_BY_KEY,
    MAINTENANCE_REASON_LABELS,
    HANDOFF_CHECKLIST_LABELS,
    CHECKLIST_STEP_TO_KEY,
    REPAIR_CLOSE_CHECKLIST_LABELS,
    REPAIR_CLOSE_CHECKLIST_ORDER,
    OPERATION_STEP_META,
    SHIPPING_OPERATION_STEPS,
    RECEIVING_OPERATION_STEPS,
  } = createBotUi();

  function extractMessageId(payload) {
    return payload?.message?.message_id ||
      payload?.message?.mid ||
      payload?.message?.id ||
      payload?.message_id ||
      payload?.mid ||
      payload?.id ||
      null;
  }

  function getPreviousBotMessageId(phone, preserveMessageId = null) {
    if (!phone) return null;
    const previousMessageId = getBotSession(phone).lastBotMessageId;
    if (!previousMessageId || previousMessageId === preserveMessageId) return null;
    return previousMessageId;
  }

  function runBotSideEffect(task, label) {
    Promise.resolve()
      .then(task)
      .catch(error => {
        console.warn(`[BOT] ${label}:`, error?.message || String(error));
      });
  }

  function deleteBotMessageLater(messageId, replacementMessageId = null) {
    if (!messageId || messageId === replacementMessageId) return;
    runBotSideEffect(() => deleteMessage(messageId), `Не удалось удалить сообщение ${messageId}`);
  }

  async function rememberBotMessage(phone, payload, fallbackMessageId = null) {
    if (!phone) return;
    const messageId = fallbackMessageId || extractMessageId(payload);
    if (!messageId) return;
    updateBotSession(phone, { lastBotMessageId: messageId });
    return messageId;
  }

  async function reply(target, text, options = {}) {
    const {
      attachments,
      brandImage = false,
      mechanicStage = null,
      phone = '',
      callbackContext = null,
      replaceMessage = false,
      cleanupPrevious = false,
      notification = null,
    } = options;
    let messageAttachments = mechanicStage
      ? attachMechanicStageImage(mechanicStage, attachments)
      : attachments;
    if (brandImage) {
      messageAttachments = attachBotBrandImage(messageAttachments);
    }
    const hasMessageAttachments = Array.isArray(messageAttachments)
      ? messageAttachments.length > 0
      : Boolean(messageAttachments);

    if (replaceMessage && callbackContext?.callbackId) {
      const previousMessageId = getPreviousBotMessageId(phone) || callbackContext.messageId || null;
      runBotSideEffect(() => answerCallback(callbackContext.callbackId, {
        ...(notification ? { notification: { text: notification } } : {}),
      }), 'Не удалось ответить на callback');
      const payload = await sendMessage(target, text, {
        ...(hasMessageAttachments ? { attachments: messageAttachments } : {}),
      });
      const replacementMessageId = await rememberBotMessage(phone, payload);
      deleteBotMessageLater(previousMessageId, replacementMessageId);
      return payload;
    }

    if (callbackContext?.callbackId && notification) {
      runBotSideEffect(() => answerCallback(callbackContext.callbackId, {
        notification: { text: notification },
      }), 'Не удалось отправить callback-уведомление');
    }

    const previousMessageId = cleanupPrevious
      ? getPreviousBotMessageId(phone, callbackContext?.messageId || null)
      : null;

    const payload = await sendMessage(target, text, {
      ...(hasMessageAttachments ? { attachments: messageAttachments } : {}),
    });
    const replacementMessageId = await rememberBotMessage(phone, payload);

    if (cleanupPrevious && phone) {
      deleteBotMessageLater(previousMessageId, replacementMessageId);
    }

    return payload;
  }

  function withBotMenu(text, lines = []) {
    const footer = lines.length
      ? `\n\nБыстро:\n${lines.map(line => `• ${line}`).join('\n')}`
      : '';
    return `${text}${footer}`;
  }

  function isMechanicMenuRole(role) {
    return isMechanicRole(role) || role === 'Администратор';
  }

  function mechanicMainStageForRole(role) {
    return isMechanicMenuRole(role) ? 'main' : null;
  }

  function mechanicStageForOperation(operation, isReview = false) {
    if (isReview || operation?.currentStep === 'review') return 'complete';
    return operationStageImageKey(OPERATION_STEP_META[operation?.currentStep]);
  }

  function managerSummaryKeyboard() {
    return rentalManagerKeyboard();
  }

  function getServiceRouteNorms() {
    return (readData('service_route_norms') || [])
      .filter(item => item && item.isActive !== false)
      .sort((left, right) =>
        `${left.from} ${left.to}`.localeCompare(`${right.from} ${right.to}`, 'ru'),
      );
  }

  function routeNormButtonLabel(route) {
    return `${route.from} → ${route.to}`.slice(0, 48);
  }

  function fieldTripRouteKeyboard(routes) {
    const routeButtons = routes.slice(0, 6).map(route =>
      button(routeNormButtonLabel(route), `fieldtrip:start_route:${route.id}`),
    );
    return keyboard([
      ...chunkButtons(routeButtons, 1),
      [button('Ввести маршрут вручную', 'fieldtrip:manual')],
      [button('Назад', 'menu:repair_actions'), button('Главное меню', 'menu:main')],
    ]);
  }

  function fieldTripStatusKeyboard(trip) {
    const rows = [];
    if (trip?.status === 'started') {
      rows.push([button('Я на объекте', `fieldtrip:arrived:${trip.id}`), button('Завершить выезд', `fieldtrip:complete:${trip.id}`)]);
    } else if (trip?.status === 'arrived') {
      rows.push([button('Завершить выезд', `fieldtrip:complete:${trip.id}`)]);
    }
    rows.push([button('К заявке', 'menu:repair_actions'), button('Главное меню', 'menu:main')]);
    return keyboard(rows);
  }

  function fieldTripStatusLabel(status) {
    return ({
      started: 'В пути',
      arrived: 'На объекте',
      completed: 'Завершён',
      cancelled: 'Отменён',
    })[status] || status;
  }

  function parseManualFieldTripRoute(value) {
    const text = String(value || '').trim();
    if (!text) return null;
    const parts = text.split(/\s*(?:→|->|—|–|-)\s*/).filter(Boolean);
    if (parts.length < 2) return null;
    return {
      routeFrom: parts[0].trim(),
      routeTo: parts.slice(1).join(' ').trim(),
    };
  }

  function formatFieldTripMessage(trip, ticket) {
    const vehicles = readData('service_vehicles') || [];
    const vehicle = trip?.serviceVehicleId
      ? vehicles.find(item => item.id === trip.serviceVehicleId)
      : null;
    const routeFormula = `${Number(trip.distanceKm || 0).toLocaleString('ru-RU')} / ${Number(trip.normSpeedKmh || 70).toLocaleString('ru-RU')}`;
    return [
      `🚐 Выезд по заявке ${trip.serviceTicketId}`,
      ticket?.equipment || trip.equipmentLabel || 'Техника не указана',
      `Маршрут: ${trip.routeFrom} → ${trip.routeTo}`,
      `Расстояние: ${Number(trip.distanceKm || 0).toLocaleString('ru-RU')} км`,
      `К закрытию: ${Number(trip.closedNormHours || 0).toFixed(1)} н/ч (${routeFormula})`,
      `Статус: ${fieldTripStatusLabel(trip.status)}`,
      vehicle ? `Служебная машина: ${vehicle.name}` : null,
      trip.startedAt ? `Старт: ${new Date(trip.startedAt).toLocaleString('ru-RU')}` : null,
      trip.arrivedAt ? `На объекте: ${new Date(trip.arrivedAt).toLocaleString('ru-RU')}` : null,
      trip.completedAt ? `Завершён: ${new Date(trip.completedAt).toLocaleString('ru-RU')}` : null,
      trip.comment ? `Комментарий: ${trip.comment}` : null,
    ].filter(Boolean).join('\n');
  }

  function createDeliveryTypeKeyboard() {
    return keyboard([
      [button('Отгрузка', 'deliverycreate:type:shipping'), button('Приёмка', 'deliverycreate:type:receiving')],
      [button('Отмена', 'deliverycreate:cancel')],
    ]);
  }

  function createDeliverySkipKeyboard() {
    return keyboard([
      [button('Пропустить', 'deliverycreate:skip_comment')],
      [button('Отмена', 'deliverycreate:cancel')],
    ]);
  }

  function normalizeBotDateInput(value) {
    const trimmed = String(value || '').trim().toLowerCase();
    if (!trimmed) return '';
    if (trimmed === 'сегодня') return new Date().toISOString().slice(0, 10);
    if (trimmed === 'завтра') {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      return tomorrow.toISOString().slice(0, 10);
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
    return '';
  }

  function deliveryTypeLabel(type) {
    return type === 'receiving' ? 'Приёмка' : 'Отгрузка';
  }

  function getManagerSummaryData(managerName) {
    const rentals = readData('gantt_rentals') || [];
    const payments = readData('payments') || [];
    const equipment = readData('equipment') || [];
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const managerRentals = rentals.filter(item => item.manager === managerName);
    const activeRentals = managerRentals.filter(item => item.status === 'active');
    const monthRentals = managerRentals.filter(item => {
      const start = new Date(item.startDate || '');
      return Number.isFinite(start.getTime()) && start >= monthStart;
    });

    const paidByRentalId = new Map();
    payments.forEach(payment => {
      if (!payment?.rentalId) return;
      paidByRentalId.set(
        payment.rentalId,
        (paidByRentalId.get(payment.rentalId) || 0) + (typeof payment.paidAmount === 'number' ? payment.paidAmount : payment.amount || 0),
      );
    });

    const currentDebt = managerRentals.reduce((sum, rental) => {
      const paid = paidByRentalId.get(rental.id) || 0;
      return sum + Math.max(0, Number(rental.amount || 0) - paid);
    }, 0);

    const freeEquipment = equipment.filter(item => item.status === 'available');
    return {
      activeRentals,
      monthTurnover: monthRentals.reduce((sum, rental) => sum + Number(rental.amount || 0), 0),
      currentDebt,
      freeEquipment,
    };
  }

  function buildManagerMorningSummaryMessage(authUser) {
    const { activeRentals, monthTurnover, currentDebt, freeEquipment } = getManagerSummaryData(authUser.userName);
    const freeLines = freeEquipment.slice(0, 8).map(item => `• ${formatEquipmentForBot(item)}`);

    return [
      `🌅 Доброе утро, ${authUser.userName}!`,
      '',
      `Сейчас в аренде у вас: ${activeRentals.length}`,
      `Дебиторка: ${currentDebt.toLocaleString('ru-RU')} ₽`,
      `Оборот за месяц: ${monthTurnover.toLocaleString('ru-RU')} ₽`,
      `Свободная техника: ${freeEquipment.length}`,
      '',
      freeLines.length ? ['Свободные единицы:', ...freeLines].join('\n') : 'Свободной техники сейчас нет.',
    ].join('\n');
  }

  function createDeliveryFromBot(authUser, draft) {
    const deliveries = readData('deliveries') || [];
    const delivery = {
      id: generateId(idPrefixes.deliveries),
      type: draft.type === 'receiving' ? 'receiving' : 'shipping',
      status: 'new',
      transportDate: draft.transportDate,
      neededBy: draft.transportDate,
      origin: draft.origin,
      destination: draft.destination,
      cargo: draft.cargo,
      contactName: draft.contactName,
      contactPhone: draft.contactPhone,
      cost: 0,
      comment: draft.comment || '',
      client: draft.client,
      clientId: null,
      manager: authUser.userName,
      carrierKey: null,
      carrierName: null,
      carrierPhone: null,
      carrierChatId: null,
      carrierUserId: null,
      ganttRentalId: null,
      classicRentalId: null,
      equipmentId: null,
      equipmentInv: null,
      equipmentLabel: null,
      botSentAt: null,
      botSendError: null,
      carrierInvoiceReceived: false,
      carrierInvoiceReceivedAt: null,
      clientPaymentVerified: false,
      clientPaymentVerifiedAt: null,
      completedAt: null,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      createdBy: authUser.userName,
    };
    deliveries.push(delivery);
    writeData('deliveries', deliveries);
    return delivery;
  }

  function deliveryStatusLabel(status) {
    const map = {
      new: 'Новая',
      sent: 'Отправлена',
      accepted: 'Принята',
      in_transit: 'Выехал',
      completed: 'Выполнена',
      cancelled: 'Отменена',
    };
    return map[status] || status;
  }

  function deliveryStatusKeyboard(delivery) {
    if (!delivery || delivery.status === 'completed' || delivery.status === 'cancelled') return null;
    if (delivery.status === 'accepted') {
      return keyboard([
        [button('Выехал', `delivery:status:${delivery.id}:in_transit`)],
      ]);
    }
    if (delivery.status === 'in_transit') {
      return keyboard([
        [button('Доставлено', `delivery:status:${delivery.id}:completed`)],
      ]);
    }
    return keyboard([
      [button('Принял', `delivery:status:${delivery.id}:accepted`)],
    ]);
  }

  function formatDeliveryStatusMessage(delivery) {
    return [
      delivery.type === 'shipping' ? '🚚 Заявка на отгрузку' : '📥 Заявка на приёмку',
      `Статус: ${deliveryStatusLabel(delivery.status)}`,
      `Дата перевозки: ${delivery.transportDate}`,
      delivery.neededBy ? `Когда нужно: ${delivery.neededBy}` : null,
      `Маршрут: ${delivery.origin} → ${delivery.destination}`,
      `Что перевозим: ${delivery.cargo}`,
      `Клиент: ${delivery.client}`,
      `Контакт: ${delivery.contactName} · ${delivery.contactPhone}`,
      delivery.cost > 0 ? `Стоимость: ${delivery.cost.toLocaleString('ru-RU')} ₽` : null,
      delivery.comment ? `Комментарий: ${delivery.comment}` : null,
    ].filter(Boolean).join('\n');
  }

  function updateDeliveryStatusFromBot(deliveryId, nextStatus, actorName) {
    const deliveries = readData('deliveries') || [];
    const index = deliveries.findIndex(item => item.id === deliveryId);
    if (index === -1) return null;
    const current = deliveries[index];
    const allowedTransitions = {
      sent: ['accepted'],
      accepted: ['in_transit'],
      in_transit: ['completed'],
      new: ['accepted'],
    };
    const currentAllowed = allowedTransitions[current.status] || [];
    if (!currentAllowed.includes(nextStatus) && current.status !== nextStatus) {
      return { delivery: current, changed: false, invalid: true };
    }
    const timestamp = nowIso();
    const delivery = {
      ...current,
      status: nextStatus,
      updatedAt: timestamp,
      completedAt: nextStatus === 'completed' ? (current.completedAt || timestamp) : null,
      comment: [
        String(current.comment || '').trim(),
        `[${new Date().toLocaleString('ru-RU')}] Статус через MAX: ${deliveryStatusLabel(nextStatus)} (${actorName})`,
      ].filter(Boolean).join('\n'),
    };
    deliveries[index] = delivery;
    writeData('deliveries', deliveries);
    return { delivery, changed: current.status !== nextStatus, invalid: false };
  }

  async function handleBotStarted(senderId, phone, payload) {
    const payloadLine = payload ? `\nPayload: ${payload}` : '';
    updateBotSession(phone, {
      pendingAction: null,
      pendingPayload: null,
    });
    const existingUser = authorizeCarrier(phone, senderId);
    if (existingUser?.userRole === 'Перевозчик') {
      return reply(
        senderId,
        getMainMenuText(existingUser),
        { attachments: carrierKeyboard(), brandImage: true, phone, cleanupPrevious: true },
      );
    }
    if (existingUser) {
      return reply(
        senderId,
        getMainMenuText(existingUser),
        {
          attachments: defaultKeyboardForRole(existingUser.userRole),
          brandImage: true,
          phone,
          cleanupPrevious: true,
        },
      );
    }
    return reply(
      senderId,
      withBotMenu(
        `👋 Добро пожаловать в бот «Скайтех»!${payloadLine}\n\nНажмите «Войти», затем бот по шагам попросит логин и пароль.`,
        ['если хотите вручную: /start email@company.ru пароль'],
      ),
      { attachments: authKeyboard(), brandImage: true, phone, cleanupPrevious: true },
    );
  }

  function normalizeReplyTarget(target, fallbackPhone = '') {
    if (target && typeof target === 'object') {
      return {
        chat_id: target.chat_id ?? target.chatId ?? null,
        user_id: target.user_id ?? target.userId ?? (fallbackPhone ? Number(fallbackPhone) : null),
      };
    }
    return {
      chat_id: null,
      user_id: fallbackPhone ? Number(fallbackPhone) : Number(target || 0),
    };
  }

  function authorizeUser(phone, email, password, replyTarget = null) {
    const users = readData('users') || [];
    const found = users.find(
      user => user.email.toLowerCase() === email.toLowerCase() &&
        verifyPassword(password, user.password) &&
        user.status === 'Активен'
    );
    if (!found) return null;

    const botUsers = getBotUsers();
    botUsers[phone] = {
      userId: found.id,
      userName: found.name,
      userRole: found.role,
      email: found.email,
      replyTarget: normalizeReplyTarget(replyTarget, phone),
    };
    saveBotUsers(botUsers);
    return found;
  }

  function findCarrierByMaxKey(phone) {
    return (readData('delivery_carriers') || []).find(item =>
      item &&
      item.status !== 'inactive' &&
      String(item.maxCarrierKey || '').trim() === String(phone || '').trim(),
    ) || null;
  }

  function authorizeCarrier(phone, replyTarget = null) {
    const existing = getAuthorizedUser(phone);
    const carrier = findCarrierByMaxKey(phone);
    if (existing && (!carrier || (!preferCarrierAutoLogin && existing.userRole !== 'Перевозчик'))) {
      return existing;
    }
    if (!carrier) return existing || null;

    const botUsers = getBotUsers();
    const linkedCarrier = {
      userId: carrier.id || `carrier:${phone}`,
      userName: carrier.name || 'Перевозчик',
      userRole: 'Перевозчик',
      email: null,
      carrierId: carrier.id || null,
      replyTarget: normalizeReplyTarget(replyTarget, phone),
    };
    botUsers[phone] = linkedCarrier;
    saveBotUsers(botUsers);
    return linkedCarrier;
  }

  function getAuthorizedUser(phone) {
    return getBotUsers()[phone] || null;
  }

  function clearAuthorizedUser(phone) {
    const botUsers = getBotUsers();
    if (!botUsers[phone]) return;
    delete botUsers[phone];
    saveBotUsers(botUsers);
  }

  function getBotSession(phone) {
    return getBotSessions()[phone] || {};
  }

  function updateBotSession(phone, patch) {
    const sessions = getBotSessions();
    sessions[phone] = {
      ...(sessions[phone] || {}),
      ...patch,
      updatedAt: new Date().toISOString(),
    };
    saveBotSessions(sessions);
    return sessions[phone];
  }

  function clearBotSession(phone) {
    const sessions = getBotSessions();
    delete sessions[phone];
    saveBotSessions(sessions);
  }

  function resetBotFlow(phone) {
    return updateBotSession(phone, {
      pendingAction: null,
      pendingPayload: null,
    });
  }

  function getCarrierDeliveries(phone, authUser) {
    const carrier = authUser?.carrierId
      ? (readData('delivery_carriers') || []).find(item => item.id === authUser.carrierId)
      : findCarrierByMaxKey(phone);
    if (!carrier) return [];

    const carrierKeys = new Set(
      [carrier.id, carrier.key, carrier.maxCarrierKey]
        .filter(Boolean)
        .map(value => String(value)),
    );
    const phoneValue = String(phone || '').trim();

    return (readData('deliveries') || [])
      .filter(item => {
        const deliveryCarrierKey = item?.carrierKey ? String(item.carrierKey) : '';
        const deliveryCarrierUserId = item?.carrierUserId != null ? String(item.carrierUserId) : '';
        return carrierKeys.has(deliveryCarrierKey) || (phoneValue && deliveryCarrierUserId === phoneValue);
      })
      .sort((left, right) => new Date(right.transportDate || 0).getTime() - new Date(left.transportDate || 0).getTime());
  }

  function formatCarrierDeliveries(deliveries) {
    if (!deliveries.length) {
      return [
        '🚚 У вас пока нет доставок.',
        '',
        'Как только офис назначит вас на доставку, здесь появятся заявки и статусы.',
      ].join('\n');
    }

    const lines = deliveries.slice(0, 10).map((delivery, index) => (
      `${index + 1}. ${deliveryTypeLabel(delivery.type)} · ${delivery.transportDate}\n` +
      `   ${delivery.origin} → ${delivery.destination}\n` +
      `   ${delivery.cargo} · ${delivery.client}\n` +
      `   Статус: ${deliveryStatusLabel(delivery.status)}`
    ));

    return [
      `🚚 Мои доставки (${deliveries.length})`,
      '',
      ...lines,
      deliveries.length > 10 ? `... и ещё ${deliveries.length - 10}` : '',
    ].filter(Boolean).join('\n');
  }
  const {
    normalizeBotText,
    botSearchMatches,
    formatBotDate,
    formatEquipmentForBot,
    formatCurrentRepairDraft,
    formatServiceForUser,
    serviceTicketsKeyboard,
    equipmentActionKeyboard,
    searchServiceWorks,
    searchSpareParts,
    searchEquipmentForBot,
    extractPhotoUrlsFromMessage,
    formatRentals,
    formatEquipment,
    formatEquipmentActionMenu,
    formatEquipmentHistoryForBot,
    equipmentSearchKeyboard,
    workSearchKeyboard,
    partSearchKeyboard,
    formatService,
    getHelpText,
    getMainMenuText,
  } = createBotFormatters({
    readData,
    readServiceTickets,
    serviceStatusLabel,
    button,
    keyboard,
    chunkButtons,
    backAndMainRow,
    currentRepairKeyboard,
    MAINTENANCE_REASON_LABELS,
    REPAIR_CLOSE_CHECKLIST_ORDER,
  });

  const {
    getOperationSteps,
    createEmptyOperationPhotos,
    createEmptyOperationChecklist,
    createEmptyRepairPhotos,
    createEmptyRepairCloseChecklist,
    normalizeRepairPhotos,
    buildRepairCloseChecklistStatus,
    nextMissingRepairCloseChecklistKey,
    repairCloseChecklistKeyboard,
    formatRepairCloseChecklist,
    appendRepairPhotos,
    calculateFieldTripNormHours,
    createFieldTripFromBot,
    formatMechanicDayReport,
    getActiveFieldTripForRepair,
    getOperationSessionById,
    saveOperationSession,
    createOperationSession,
    getOperationStepIndex,
    getOperationStepPrompt,
    getOperationSummary,
    goToPreviousOperationStep,
    createServiceTicketFromBot,
    createMaintenanceTicketFromBot,
    createReturnInspectionTicketFromBot,
    completeBotEquipmentOperation,
    updateFieldTripStatusFromBot,
    addRepairWorkItemFromCatalog,
    addRepairPartItemFromCatalog,
  } = createBotOperations({
    readData,
    writeData,
    generateId,
    idPrefixes,
    nowIso,
    readServiceTickets,
    writeServiceTickets,
    appendServiceLog,
    getMechanicReferenceByUser,
    syncEquipmentStatusForService,
    getOpenTicketByEquipment,
    formatEquipmentForBot,
    serviceStatusLabel,
    button,
    keyboard,
    backAndMainRow,
    MAINTENANCE_REASON_LABELS,
    HANDOFF_CHECKLIST_LABELS,
    CHECKLIST_STEP_TO_KEY,
    REPAIR_CLOSE_CHECKLIST_LABELS,
    REPAIR_CLOSE_CHECKLIST_ORDER,
    OPERATION_STEP_META,
    SHIPPING_OPERATION_STEPS,
    RECEIVING_OPERATION_STEPS,
  });

  function setCurrentRepair(phone, repairId) {
    updateBotSession(phone, {
      activeRepairId: repairId,
      lastEquipmentSearch: [],
      lastWorkSearch: [],
      lastPartSearch: [],
      pendingAction: null,
      pendingPayload: null,
    });
  }

  function getCurrentRepair(phone) {
    const session = getBotSession(phone);
    if (!session.activeRepairId) return null;
    return findServiceTicketById(session.activeRepairId);
  }

  async function handleEquipmentSearchRequest(senderId, phone, query, uiContext = {}) {
    const matches = searchEquipmentForBot(query);
    const session = getBotSession(phone);
    const flow = session.pendingPayload?.flow;
    const photoEventType = session.pendingPayload?.photoEventType;
    const stage = flow === 'photo_event'
      ? 'handoff'
      : flow === 'service_ticket'
        ? 'ticket'
        : 'repair';
    if (!matches.length) {
      updateBotSession(phone, {
        pendingAction: 'equipment_search',
        pendingPayload: flow === 'photo_event'
          ? { flow, photoEventType }
          : flow === 'service_ticket'
            ? { flow: 'service_ticket' }
            : null,
      });
      return reply(
        senderId,
        withBotMenu(
          '🔎 Техника не найдена. Напишите INV, SN, модель или производителя ещё раз.',
          ['пример: 083', 'пример: B200063918', 'отмена: /сброс'],
        ),
        {
          attachments: mechanicKeyboard(),
          mechanicStage: stage,
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
          cleanupPrevious: !uiContext.callbackContext,
        },
      );
    }
    updateBotSession(phone, {
      lastEquipmentSearch: matches.map(item => ({
        id: item.id,
        inventoryNumber: item.inventoryNumber,
        serialNumber: item.serialNumber,
        model: item.model,
      })),
      pendingAction: flow === 'photo_event' || flow === 'service_ticket' ? 'equipment_search' : 'equipment_action_menu',
      pendingPayload: flow === 'photo_event'
        ? { flow, photoEventType }
        : flow === 'service_ticket'
          ? { flow: 'service_ticket' }
          : null,
    });
    const isPhotoFlow = flow === 'photo_event';
    const isServiceTicketFlow = flow === 'service_ticket';
    return reply(senderId, withBotMenu([
      '🚜 Найденная техника:',
      ...matches.map((item, index) => `${index + 1}. ${formatEquipmentForBot(item)}`),
      '',
      'Можно нажать кнопку с техникой ниже.',
      isPhotoFlow
        ? `После выбора начнётся пошаговая ${photoEventType === 'shipping' ? 'отгрузка' : 'приёмка'}.`
        : isServiceTicketFlow
          ? 'После выбора бот попросит написать причину сервисной заявки.'
          : 'После выбора откроется меню действий по технике.',
    ].join('\n'), ['новый поиск: найти технику', 'отмена: /сброс']), {
      attachments: equipmentSearchKeyboard(matches),
      mechanicStage: stage,
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handleCreateTicketRequest(senderId, phone, authUser, selectionText, uiContext = {}) {
    const session = getBotSession(phone);
    const preselectedEquipmentId = session.pendingPayload?.selectedEquipmentId;
    let reason = '';
    let equipment = null;

    if (preselectedEquipmentId) {
      reason = selectionText.trim();
      equipment = (readData('equipment') || []).find(item => item.id === preselectedEquipmentId);
      if (!reason) {
        updateBotSession(phone, {
          pendingAction: 'ticket_reason',
          pendingPayload: { selectedEquipmentId: preselectedEquipmentId },
        });
        return reply(senderId, '❌ Напишите причину обращения одним сообщением. Например: течь гидравлики', {
          mechanicStage: 'ticket',
        });
      }
    } else {
      const firstSpace = selectionText.indexOf(' ');
      if (firstSpace <= 0) {
        updateBotSession(phone, { pendingAction: 'ticket_reason', pendingPayload: null });
        return reply(senderId, '❌ Формат: НОМЕР причина. Пример: 1 Течь гидравлики', {
          mechanicStage: 'ticket',
        });
      }
      const index = Number(selectionText.slice(0, firstSpace).trim());
      reason = selectionText.slice(firstSpace + 1).trim();
      const lastEquipmentSearch = Array.isArray(session.lastEquipmentSearch) ? session.lastEquipmentSearch : [];
      if (!Number.isInteger(index) || index <= 0 || index > lastEquipmentSearch.length) {
        return reply(senderId, '❌ Неверный номер техники. Сначала выполните поиск заново.', {
          mechanicStage: 'ticket',
        });
      }
      if (!reason) {
        return reply(senderId, '❌ Укажите причину обращения после номера техники.', {
          mechanicStage: 'ticket',
        });
      }
      const selected = lastEquipmentSearch[index - 1];
      equipment = (readData('equipment') || []).find(item => item.id === selected.id);
    }
    if (!equipment) {
      return reply(senderId, '❌ Техника больше не найдена в системе. Выполните поиск заново.', {
        mechanicStage: 'ticket',
      });
    }
    const existingOpenTicket = getOpenTicketByEquipment(equipment);
    if (existingOpenTicket) {
      setCurrentRepair(phone, existingOpenTicket.id);
      return reply(senderId, withBotMenu([
        `ℹ️ По этой технике уже есть открытая заявка: ${existingOpenTicket.id}`,
        `${existingOpenTicket.equipment}`,
        `Причина: ${existingOpenTicket.reason}`,
        '',
        'Я открыл её как текущую.',
      ].join('\n'), ['черновик', 'работы гидравлика', 'запчасти фильтр', 'готово']), {
        attachments: currentRepairKeyboard(existingOpenTicket.id),
        mechanicStage: 'repair',
        phone,
        callbackContext: uiContext.callbackContext,
        replaceMessage: Boolean(uiContext.callbackContext),
        cleanupPrevious: !uiContext.callbackContext,
      });
    }
    const ticket = createServiceTicketFromBot(equipment, authUser, reason);
    setCurrentRepair(phone, ticket.id);
    return reply(senderId, withBotMenu([
      `✅ Создана заявка ${ticket.id}`,
      formatEquipmentForBot(equipment),
      `Причина: ${ticket.reason}`,
      '',
      'Заявка открыта как текущая.',
    ].join('\n'), ['итог', 'работы гидравлика', 'запчасти фильтр', 'черновик', 'готово']), {
      attachments: currentRepairKeyboard(ticket.id),
      mechanicStage: 'repair',
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function startEquipmentOperationRequest(senderId, phone, authUser, equipment, type, uiContext = {}) {
    const operation = createOperationSession(type, equipment, authUser);
    updateBotSession(phone, {
      pendingAction: 'operation_step',
      pendingPayload: { operationSessionId: operation.id },
    });
    return reply(senderId, getOperationStepPrompt(operation), {
      attachments: operationKeyboard(operation),
      mechanicStage: mechanicStageForOperation(operation),
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handleOperationStepInput(senderId, phone, authUser, messageMeta = {}, uiContext = {}) {
    const operationSessionId = getBotSession(phone).pendingPayload?.operationSessionId;
    const operation = getOperationSessionById(operationSessionId);

    if (!operation || operation.status !== 'in_progress') {
      resetBotFlow(phone);
      return reply(senderId, '❌ Активный сценарий приёмки/отгрузки не найден. Начните заново.', {
        attachments: mechanicKeyboard(),
        mechanicStage: 'handoff',
        phone,
        callbackContext: uiContext.callbackContext,
        replaceMessage: Boolean(uiContext.callbackContext),
      });
    }

    const stepKey = operation.currentStep;
    const stepMeta = OPERATION_STEP_META[stepKey];
    if (!stepMeta) {
      resetBotFlow(phone);
      return reply(senderId, '❌ Текущий шаг сценария не распознан. Начните заново.', {
        attachments: mechanicKeyboard(),
        mechanicStage: 'handoff',
        phone,
        callbackContext: uiContext.callbackContext,
        replaceMessage: Boolean(uiContext.callbackContext),
      });
    }

    let nextOperation = { ...operation };
    const now = nowIso();

    if (stepMeta.kind === 'check') {
      return reply(senderId, `✅ Пункт «${stepMeta.label}» подтверждается кнопкой ниже.`, {
        attachments: operationKeyboard(operation),
        mechanicStage: mechanicStageForOperation(operation),
        phone,
        callbackContext: uiContext.callbackContext,
        replaceMessage: Boolean(uiContext.callbackContext),
      });
    }

    if (stepMeta.kind === 'photo') {
      const photoUrls = extractPhotoUrlsFromMessage(messageMeta);
      if (!photoUrls.length) {
        return reply(senderId, `📷 Я жду ${stepMeta.label}. Пожалуйста, отправьте фото.`, {
          attachments: operationKeyboard(operation),
          mechanicStage: mechanicStageForOperation(operation),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      nextOperation = {
        ...nextOperation,
        photos: {
          ...(nextOperation.photos || createEmptyOperationPhotos()),
          [stepKey]: photoUrls,
        },
      };
    }

    if (stepMeta.kind === 'number') {
      const rawText = String(messageMeta?.text || messageMeta?.body?.text || '').trim().replace(',', '.');
      const value = Number(rawText);
      if (!Number.isFinite(value) || value < 0) {
        return reply(senderId, '❌ Моточасы должны быть числом не меньше 0. Например: 1542', {
          attachments: operationKeyboard(operation),
          mechanicStage: mechanicStageForOperation(operation),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      nextOperation = {
        ...nextOperation,
        hoursValue: value,
      };
    }

    if (stepMeta.kind === 'text') {
      const rawText = String(messageMeta?.text || messageMeta?.body?.text || '').trim();
      if (!rawText) {
        return reply(senderId, '❌ Опишите повреждения текстом.', {
          attachments: operationKeyboard(operation),
          mechanicStage: mechanicStageForOperation(operation),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      nextOperation = {
        ...nextOperation,
        damageDescription: rawText,
      };
    }

    nextOperation = {
      ...nextOperation,
      steps: nextOperation.steps.map(step =>
        step.key === stepKey ? { ...step, status: 'done', completedAt: now } : step
      ),
    };

    const steps = getOperationSteps(nextOperation.type);
    const currentIndex = getOperationStepIndex(nextOperation, stepKey);
    const nextStep = steps[currentIndex + 1] || null;

    if (!nextStep) {
      nextOperation = saveOperationSession({
        ...nextOperation,
        currentStep: 'review',
      });
      return reply(senderId, getOperationSummary(nextOperation), {
        attachments: operationKeyboard(nextOperation, true),
        mechanicStage: mechanicStageForOperation(nextOperation, true),
        phone,
        callbackContext: uiContext.callbackContext,
        replaceMessage: Boolean(uiContext.callbackContext),
        cleanupPrevious: !uiContext.callbackContext,
      });
    }

    nextOperation = saveOperationSession({
      ...nextOperation,
      currentStep: nextStep,
    });
    return reply(senderId, getOperationStepPrompt(nextOperation), {
      attachments: operationKeyboard(nextOperation),
      mechanicStage: mechanicStageForOperation(nextOperation),
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handleWorkSearchRequest(senderId, phone, ticket, query, uiContext = {}) {
    const matches = searchServiceWorks(query);
    if (!matches.length) {
      updateBotSession(phone, { pendingAction: 'work_search', activeRepairId: ticket.id });
      return reply(senderId, withBotMenu(
        '🔎 По этому запросу активные работы не найдены. Напишите другое название или часть названия.',
        ['пример: гидравлика', 'пример: замена масла', 'черновик'],
      ), {
        attachments: currentRepairKeyboard(ticket.id),
        mechanicStage: 'work',
        phone,
        callbackContext: uiContext.callbackContext,
        replaceMessage: Boolean(uiContext.callbackContext),
        cleanupPrevious: !uiContext.callbackContext,
      });
    }
    updateBotSession(phone, {
      activeRepairId: ticket.id,
      lastWorkSearch: matches.map(item => ({ id: item.id, name: item.name })),
      pendingAction: 'work_pick',
      pendingPayload: null,
    });
    return reply(senderId, withBotMenu([
      '🧰 Найденные работы:',
      ...matches.map((item, index) => `${index + 1}. ${item.name}${item.category ? ` · ${item.category}` : ''} · ${Number(item.normHours || 0).toLocaleString('ru-RU')} н/ч`),
      '',
      query
        ? 'Нажмите кнопку с работой ниже, чтобы сразу добавить её в заявку.'
        : 'Показываю популярные работы. Можно сразу нажать кнопку или выполнить новый текстовый поиск.',
    ].join('\n'), ['новый поиск работ', 'черновик', 'отмена: /сброс']), {
      attachments: workSearchKeyboard(matches),
      mechanicStage: 'work',
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function promptWorkSearch(senderId, phone, ticket, uiContext = {}) {
    updateBotSession(phone, {
      pendingAction: 'work_search',
      activeRepairId: ticket.id,
      pendingPayload: null,
      lastWorkSearch: [],
    });
    return reply(
      senderId,
      withBotMenu(
        [
          '🧰 Напишите название работы или её часть.',
          'Я найду подходящие работы в справочнике и предложу выбрать кнопку.',
          '',
          'Примеры:',
          '• гидравлика',
          '• замена масла',
          '• диагностика',
        ].join('\n'),
        ['черновик', 'запчасти', 'готово'],
      ),
      {
        attachments: currentRepairKeyboard(ticket.id),
        mechanicStage: 'work',
        phone,
        callbackContext: uiContext.callbackContext,
        replaceMessage: Boolean(uiContext.callbackContext),
        cleanupPrevious: !uiContext.callbackContext,
      },
    );
  }

  async function handleAddWorkRequest(senderId, phone, authUser, ticket, selectionText, uiContext = {}) {
    const [firstRaw, secondRaw] = selectionText.trim().split(/\s+/);
    const session = getBotSession(phone);
    const selectedWorkId = session.pendingPayload?.selectedWorkId;
    if (!selectedWorkId && firstRaw && Number.isNaN(Number(firstRaw))) {
      return handleWorkSearchRequest(senderId, phone, ticket, selectionText.trim(), uiContext);
    }
    const quantity = selectedWorkId ? 1 : Number(secondRaw);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      if (selectedWorkId) {
        return reply(senderId, '❌ Не удалось определить выбранную работу. Нажмите кнопку работы ещё раз или выполните новый поиск.', {
          attachments: currentRepairKeyboard(ticket.id),
          mechanicStage: 'work',
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
          cleanupPrevious: !uiContext.callbackContext,
        });
      }
      return reply(senderId, '❌ Формат такой: НОМЕР РАБОТЫ. Например: 1. Или просто напишите новый поисковый запрос.');
    }
    let work = null;

    if (selectedWorkId) {
      work = (readData('service_works') || []).find(item => item.id === selectedWorkId && item.isActive !== false);
    } else {
      const index = Number(firstRaw);
      const lastWorkSearch = Array.isArray(session.lastWorkSearch) ? session.lastWorkSearch : [];
      if (!Number.isInteger(index) || index <= 0 || index > lastWorkSearch.length) {
        return reply(senderId, '❌ Номер работы указан неверно. Сначала выполните поиск работ.');
      }
      const selected = lastWorkSearch[index - 1];
      work = (readData('service_works') || []).find(item => item.id === selected.id && item.isActive !== false);
    }
    if (!work) {
      return reply(senderId, '❌ Работа больше недоступна в справочнике. Выполните поиск заново.');
    }
    addRepairWorkItemFromCatalog(ticket, work, quantity, authUser);
    const updated = appendServiceLog(ticket, `Добавлена работа через MAX: ${work.name}`, authUser.userName, 'repair_result');
    saveServiceTicket(updated);
    resetBotFlow(phone);
    return reply(senderId, withBotMenu(`✅ Добавлена работа: ${work.name}`, ['ещё работы', 'запчасти', 'черновик', 'готово']), {
      attachments: currentRepairKeyboard(ticket.id),
      mechanicStage: 'work',
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handlePartSearchRequest(senderId, phone, ticket, query, uiContext = {}) {
    const matches = searchSpareParts(query);
    if (!matches.length) {
      updateBotSession(phone, { pendingAction: 'part_search', activeRepairId: ticket.id });
      return reply(senderId, '🔎 По этому запросу активные запчасти не найдены. Напишите другой запрос.', {
        attachments: currentRepairKeyboard(ticket.id),
        mechanicStage: 'parts',
        phone,
        callbackContext: uiContext.callbackContext,
        replaceMessage: Boolean(uiContext.callbackContext),
        cleanupPrevious: !uiContext.callbackContext,
      });
    }
    updateBotSession(phone, {
      activeRepairId: ticket.id,
      lastPartSearch: matches.map(item => ({ id: item.id, name: item.name })),
      pendingAction: 'part_pick',
      pendingPayload: null,
    });
    return reply(senderId, withBotMenu([
      '📦 Найденные запчасти:',
      ...matches.map((item, index) => `${index + 1}. ${item.name}${item.article ? ` · ${item.article}` : ''} · ${Number(item.defaultPrice || 0).toLocaleString('ru-RU')} ₽/${item.unit || 'шт'}`),
      '',
      query
        ? 'Нажмите кнопку с запчастью ниже и выберите количество. По кнопке возьмётся базовая цена.'
        : 'Показываю популярные запчасти. Можно сразу нажать кнопку или выполнить новый текстовый поиск.',
      'Если нужна своя цена, после выбора нажмите «Ввести руками».',
    ].join('\n'), ['новый поиск запчастей', 'черновик', 'отмена: /сброс']), {
      attachments: partSearchKeyboard(matches),
      mechanicStage: 'parts',
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handleAddPartRequest(senderId, phone, authUser, ticket, selectionText, uiContext = {}) {
    const [firstRaw, secondRaw, thirdRaw] = selectionText.trim().split(/\s+/);
    const session = getBotSession(phone);
    const selectedPartId = session.pendingPayload?.selectedPartId;
    const quantity = Number(selectedPartId ? firstRaw : secondRaw);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return reply(senderId, '❌ Количество запчасти должно быть числом больше 0.');
    }
    let part = null;
    if (selectedPartId) {
      part = (readData('spare_parts') || []).find(item => item.id === selectedPartId && item.isActive !== false);
    } else {
      const index = Number(firstRaw);
      const lastPartSearch = Array.isArray(session.lastPartSearch) ? session.lastPartSearch : [];
      if (!Number.isInteger(index) || index <= 0 || index > lastPartSearch.length) {
        return reply(senderId, '❌ Номер запчасти указан неверно. Сначала выполните поиск запчастей.');
      }
      const selected = lastPartSearch[index - 1];
      part = (readData('spare_parts') || []).find(item => item.id === selected.id && item.isActive !== false);
    }
    if (!part) {
      return reply(senderId, '❌ Запчасть больше недоступна в справочнике. Выполните поиск заново.');
    }
    const explicitPrice = selectedPartId ? secondRaw : thirdRaw;
    const price = explicitPrice == null ? Number(part.defaultPrice || 0) : Number(explicitPrice);
    if (!Number.isFinite(price) || price < 0) {
      return reply(senderId, '❌ Цена должна быть числом не меньше 0.');
    }
    addRepairPartItemFromCatalog(ticket, part, quantity, price, authUser);
    const updated = appendServiceLog(ticket, `Добавлена запчасть через MAX: ${part.name} × ${quantity}`, authUser.userName, 'repair_result');
    saveServiceTicket(updated);
    resetBotFlow(phone);
    return reply(senderId, withBotMenu(`✅ Добавлена запчасть: ${part.name} × ${quantity} по ${price.toLocaleString('ru-RU')} ₽`, ['ещё запчасти', 'работы', 'черновик', 'готово']), {
      attachments: currentRepairKeyboard(ticket.id),
      mechanicStage: 'parts',
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handleSummaryRequest(senderId, phone, authUser, ticket, summary, uiContext = {}) {
    if (!summary) {
      updateBotSession(phone, { pendingAction: 'summary', activeRepairId: ticket.id });
      return reply(senderId, '📝 Напишите следующим сообщением комментарий по результату одним текстом. Это необязательно: можно кратко описать, чем закончилась работа.', {
        attachments: currentRepairKeyboard(ticket.id),
        mechanicStage: 'repair',
        phone,
        callbackContext: uiContext.callbackContext,
        replaceMessage: Boolean(uiContext.callbackContext),
        cleanupPrevious: !uiContext.callbackContext,
      });
    }
    const updated = appendServiceLog({
      ...ticket,
      result: summary,
      resultData: {
        ...(ticket.resultData || {}),
        summary,
        worksPerformed: ticket.resultData?.worksPerformed || [],
        partsUsed: ticket.resultData?.partsUsed || [],
      },
    }, 'Обновлён комментарий по результату через MAX', authUser.userName, 'repair_result');
    saveServiceTicket(updated);
    resetBotFlow(phone);
    return reply(senderId, withBotMenu(`✅ Комментарий по результату сохранён для ${ticket.id}`, ['работы', 'запчасти', 'черновик', 'готово']), {
      attachments: currentRepairKeyboard(ticket.id),
      mechanicStage: 'repair',
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handleRepairPhotoRequest(senderId, phone, ticket, phase, uiContext = {}) {
    const phaseLabel = phase === 'before' ? 'до ремонта' : 'после ремонта';
    updateBotSession(phone, {
      pendingAction: phase === 'before' ? 'repair_photo_before' : 'repair_photo_after',
      activeRepairId: ticket.id,
      pendingPayload: { repairId: ticket.id, phase },
    });
    return reply(senderId, `📷 Отправьте фото ${phaseLabel} для заявки ${ticket.id}. Можно приложить несколько фото одним сообщением.`, {
      attachments: currentRepairKeyboard(ticket.id),
      mechanicStage: 'photo',
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handleRepairPhotoUpload(senderId, phone, authUser, ticket, phase, messageMeta = {}, uiContext = {}) {
    const photoUrls = extractPhotoUrlsFromMessage(messageMeta);
    if (!photoUrls.length) {
      return reply(senderId, `📷 Я жду фото ${phase === 'before' ? 'до ремонта' : 'после ремонта'}. Пожалуйста, приложите фото сообщением.`, {
        attachments: currentRepairKeyboard(ticket.id),
        mechanicStage: 'photo',
        phone,
        callbackContext: uiContext.callbackContext,
        replaceMessage: Boolean(uiContext.callbackContext),
      });
    }
    const updated = appendRepairPhotos(ticket, phase, photoUrls, authUser.userName);
    saveServiceTicket(updated);
    resetBotFlow(phone);
    const repairPhotos = normalizeRepairPhotos(updated);
    return reply(senderId, withBotMenu(`✅ Сохранены фото ${phase === 'before' ? 'до ремонта' : 'после ремонта'}: ${photoUrls.length} шт.`, [
      'ещё фото',
      'черновик',
      'готово',
      'закрыть',
    ]), {
      attachments: currentRepairKeyboard(ticket.id),
      mechanicStage: 'photo',
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
      notification: `${phase === 'before' ? 'Фото ДО' : 'Фото ПОСЛЕ'}: ${repairPhotos[phase].length}`,
    });
  }

  async function startRepairCloseChecklist(senderId, phone, ticket, uiContext = {}) {
    const checklist = buildRepairCloseChecklistStatus(ticket);
    updateBotSession(phone, {
      pendingAction: 'repair_close_checklist',
      activeRepairId: ticket.id,
      pendingPayload: {
        repairId: ticket.id,
        closeChecklistDraft: {
          faultEliminated: Boolean(ticket.closeChecklist?.faultEliminated),
          partsRecordedOrNotRequired: Boolean(ticket.closeChecklist?.partsRecordedOrNotRequired),
        },
      },
    });
    return reply(senderId, formatRepairCloseChecklist(ticket, checklist), {
      attachments: repairCloseChecklistKeyboard(ticket, checklist),
      mechanicStage: 'complete',
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handleCallback(senderId, phone, payload, callbackContext = null) {
    const normalized = String(payload || '').trim();

    if (normalized === 'auth:start') {
      clearAuthorizedUser(phone);
      updateBotSession(phone, { pendingAction: 'login_email', pendingPayload: null });
      return reply(
        senderId,
        '👤 Напишите логин (email) следующим сообщением.',
        {
          attachments: keyboard([backAndMainRow('menu:cancel_login')]),
          phone,
          callbackContext,
          replaceMessage: true,
        },
      );
    }

    if (normalized === 'menu:cancel_login') {
      resetBotFlow(phone);
      return reply(senderId, '❎ Вход отменён.', {
        attachments: authKeyboard(),
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized === 'deliverycreate:cancel') {
      resetBotFlow(phone);
      const authUser = getAuthorizedUser(String(phone));
      return reply(senderId, '❎ Создание доставки отменено.', {
        attachments: authUser?.userRole === 'Менеджер по аренде' ? managerSummaryKeyboard() : defaultKeyboardForRole(authUser?.userRole || ''),
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized.startsWith('deliverycreate:type:')) {
      const authUser = getAuthorizedUser(String(phone));
      if (!authUser) {
        return reply(senderId, '🔒 Сначала авторизуйтесь.', {
          attachments: authKeyboard(),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const type = normalized.slice('deliverycreate:type:'.length);
      updateBotSession(phone, {
        pendingAction: 'manager_delivery_date',
        pendingPayload: {
          managerDeliveryDraft: {
            type: type === 'receiving' ? 'receiving' : 'shipping',
          },
        },
      });
      return reply(senderId, `🚚 ${deliveryTypeLabel(type)}\n\nНапишите дату перевозки в формате ГГГГ-ММ-ДД.\nМожно просто написать: сегодня или завтра.`, {
        attachments: keyboard([[button('Отмена', 'deliverycreate:cancel')]]),
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized === 'deliverycreate:skip_comment') {
      const authUser = getAuthorizedUser(String(phone));
      if (!authUser) {
        return reply(senderId, '🔒 Сначала авторизуйтесь.', {
          attachments: authKeyboard(),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const draft = getBotSession(phone).pendingPayload?.managerDeliveryDraft || null;
      if (!draft) {
        resetBotFlow(phone);
        return reply(senderId, '❌ Черновик доставки не найден. Начните заново.', {
          attachments: managerSummaryKeyboard(),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const delivery = createDeliveryFromBot(authUser, draft);
      resetBotFlow(phone);
      return reply(senderId, withBotMenu([
        `✅ Доставка создана: ${delivery.id}`,
        `${deliveryTypeLabel(delivery.type)} · ${delivery.transportDate}`,
        `${delivery.origin} → ${delivery.destination}`,
        `Груз: ${delivery.cargo}`,
        `Клиент: ${delivery.client}`,
      ].join('\n'), ['моя сводка', 'аренды', 'новая доставка']), {
        attachments: managerSummaryKeyboard(),
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized === 'menu:cancel_photo_event') {
      const activeOperationId = getBotSession(phone).pendingPayload?.operationSessionId;
      if (activeOperationId) {
        const operation = getOperationSessionById(activeOperationId);
        if (operation && operation.status === 'in_progress') {
          saveOperationSession({
            ...operation,
            status: 'cancelled',
            completedAt: nowIso(),
          });
        }
      }
      resetBotFlow(phone);
      return reply(senderId, '❎ Сценарий отгрузки/приёмки отменён.', {
        attachments: mechanicKeyboard(),
        mechanicStage: 'handoff',
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized.startsWith('operation:back:')) {
      const operationId = normalized.slice('operation:back:'.length);
      const operation = getOperationSessionById(operationId);
      if (!operation || operation.status !== 'in_progress') {
        resetBotFlow(phone);
        return reply(senderId, '❌ Активная операция не найдена.', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'handoff',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const previous = goToPreviousOperationStep(operation);
      if (!previous) {
        updateBotSession(phone, {
          pendingAction: 'equipment_search',
          pendingPayload: { flow: 'photo_event', photoEventType: operation.type },
          lastEquipmentSearch: [],
        });
        return reply(
          senderId,
          operation.type === 'shipping'
            ? '🚚 Вернулись к выбору техники для отгрузки.\n\nНапишите INV, SN, модель или производителя.'
            : '📥 Вернулись к выбору техники для приёмки.\n\nНапишите INV, SN, модель или производителя.',
          {
            attachments: mechanicKeyboard(),
            mechanicStage: 'handoff',
            phone,
            callbackContext,
            replaceMessage: true,
          },
        );
      }
      updateBotSession(phone, {
        pendingAction: 'operation_step',
        pendingPayload: { operationSessionId: previous.id },
      });
      return reply(senderId, getOperationStepPrompt(previous), {
        attachments: operationKeyboard(previous),
        mechanicStage: mechanicStageForOperation(previous),
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized === 'menu:main') {
      resetBotFlow(phone);
      return handleCommand(senderId, phone, '/меню', {}, { callbackContext, replaceMessage: true });
    }

    if (normalized === 'menu:draft') {
      updateBotSession(phone, {
        pendingAction: null,
        pendingPayload: null,
      });
      return handleCommand(senderId, phone, '/черновик', {}, { callbackContext, replaceMessage: true });
    }

    if (normalized === 'menu:new_ticket') {
      const authUser = getAuthorizedUser(String(phone));
      updateBotSession(phone, {
        pendingAction: 'equipment_search',
        pendingPayload: { flow: 'service_ticket' },
        lastEquipmentSearch: [],
      });
      return reply(
        senderId,
        '🚜 Напишите следующим сообщением INV, серийный номер, модель или производителя техники.',
        {
          attachments: defaultKeyboardForRole(authUser?.userRole || ''),
          mechanicStage: mechanicMainStageForRole(authUser?.userRole || '') ? 'ticket' : null,
          phone,
          callbackContext,
          replaceMessage: true,
        },
      );
    }

    if (normalized === 'menu:operations') {
      resetBotFlow(phone);
      return reply(
        senderId,
        'Выберите сценарий работы с техникой.',
        {
          attachments: operationsKeyboard(),
          mechanicStage: 'handoff',
          phone,
          callbackContext,
          replaceMessage: true,
        },
      );
    }

    if (normalized === 'menu:repair_actions') {
      const currentTicket = getCurrentRepair(phone);
      return reply(
        senderId,
        currentTicket
          ? `Выберите действие по заявке ${currentTicket.id}.`
          : 'Сначала откройте заявку, либо выберите действие заранее.',
        {
          attachments: repairActionsKeyboard(currentTicket?.id || ''),
          mechanicStage: 'repair',
          phone,
          callbackContext,
          replaceMessage: true,
        },
      );
    }

    if (normalized.startsWith('operation:check:')) {
      const operationId = normalized.slice('operation:check:'.length);
      const operation = getOperationSessionById(operationId);
      if (!operation || operation.status !== 'in_progress') {
        resetBotFlow(phone);
        return reply(senderId, '❌ Активная операция не найдена.', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'handoff',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const stepKey = operation.currentStep;
      const checklistKey = CHECKLIST_STEP_TO_KEY[stepKey];
      if (!checklistKey) {
        return reply(senderId, '❌ Этот шаг нельзя подтвердить кнопкой.', {
          attachments: operationKeyboard(operation),
          mechanicStage: mechanicStageForOperation(operation),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const now = nowIso();
      const steps = getOperationSteps(operation.type);
      const currentIndex = getOperationStepIndex(operation, stepKey);
      const nextStep = steps[currentIndex + 1] || 'review';
      const updated = saveOperationSession({
        ...operation,
        checklist: {
          ...(operation.checklist || createEmptyOperationChecklist()),
          [checklistKey]: true,
        },
        steps: operation.steps.map(step =>
          step.key === stepKey ? { ...step, status: 'done', completedAt: now } : step
        ),
        currentStep: nextStep,
      });
      updateBotSession(phone, {
        pendingAction: 'operation_step',
        pendingPayload: { operationSessionId: updated.id },
      });
      if (nextStep === 'review') {
        return reply(senderId, getOperationSummary(updated), {
          attachments: operationKeyboard(updated, true),
          mechanicStage: mechanicStageForOperation(updated, true),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      return reply(senderId, getOperationStepPrompt(updated), {
        attachments: operationKeyboard(updated),
        mechanicStage: mechanicStageForOperation(updated),
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized.startsWith('operation:cancel:')) {
      const operationId = normalized.slice('operation:cancel:'.length);
      const operation = getOperationSessionById(operationId);
      if (operation && operation.status === 'in_progress') {
        saveOperationSession({
          ...operation,
          status: 'cancelled',
          completedAt: nowIso(),
        });
      }
      resetBotFlow(phone);
      return reply(senderId, '❎ Сценарий отгрузки/приёмки отменён.', {
        attachments: mechanicKeyboard(),
        mechanicStage: 'handoff',
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized.startsWith('operation:complete:')) {
      const operationId = normalized.slice('operation:complete:'.length);
      const operation = getOperationSessionById(operationId);
      const authUser = getAuthorizedUser(String(phone));
      if (!authUser) {
        return reply(senderId, '🔒 Сначала авторизуйтесь.', {
          attachments: authKeyboard(),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      if (!operation || operation.status !== 'in_progress') {
        resetBotFlow(phone);
        return reply(senderId, '❌ Активная операция не найдена.', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'handoff',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const expectedSteps = getOperationSteps(operation.type);
      const missingStep = expectedSteps.find(step => {
        const meta = OPERATION_STEP_META[step];
        if (meta.kind === 'photo') {
          return !Array.isArray(operation.photos?.[step]) || operation.photos[step].length === 0;
        }
        if (meta.kind === 'check') {
          const checklistKey = CHECKLIST_STEP_TO_KEY[step];
          return !checklistKey || !operation.checklist?.[checklistKey];
        }
        if (meta.kind === 'number') {
          return !Number.isFinite(Number(operation.hoursValue));
        }
        if (meta.kind === 'text') {
          return !String(operation.damageDescription || '').trim();
        }
        return false;
      });
      if (missingStep) {
        const restored = saveOperationSession({
          ...operation,
          currentStep: missingStep,
        });
        updateBotSession(phone, {
          pendingAction: 'operation_step',
          pendingPayload: { operationSessionId: restored.id },
        });
        return reply(senderId, `❌ Сценарий ещё не завершён.\n\n${getOperationStepPrompt(restored)}`, {
          attachments: operationKeyboard(restored),
          mechanicStage: mechanicStageForOperation(restored),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }

      const result = completeBotEquipmentOperation(operation, authUser);
      const completedEquipment = (readData('equipment') || []).find(item => item.id === operation.equipmentId);
      resetBotFlow(phone);

      if (operation.type === 'receiving') {
        return reply(senderId, withBotMenu([
          `✅ Приёмка завершена: ${completedEquipment ? formatEquipmentForBot(completedEquipment) : operation.equipmentId}`,
          `Моточасы: ${operation.hoursValue}`,
          result.createdServiceTicket
            ? `Создана сервисная заявка: ${result.createdServiceTicket.id}`
            : 'Открытая сервисная заявка уже существовала.',
        ].join('\n'), ['мои заявки', 'черновик', 'новая заявка']), {
          attachments: mechanicKeyboard(),
          mechanicStage: 'complete',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }

      return reply(senderId, withBotMenu([
        `✅ Отгрузка завершена: ${completedEquipment ? formatEquipmentForBot(completedEquipment) : operation.equipmentId}`,
        `Моточасы: ${operation.hoursValue}`,
        result.activeRental
          ? `Аренда ${result.activeRental.id} переведена в активную.`
          : 'Фотоотчёт сохранён в карточку техники.',
      ].join('\n'), ['мои заявки', 'найти технику']), {
        attachments: mechanicKeyboard(),
        mechanicStage: 'complete',
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized === 'fieldtrip:manual') {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return reply(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'field_trip',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      updateBotSession(phone, {
        activeRepairId: ticket.id,
        pendingAction: 'field_trip_manual_route',
        pendingPayload: { serviceTicketId: ticket.id },
      });
      return reply(senderId, '🚐 Напишите маршрут в формате: Казань → Алабуга', {
        attachments: keyboard([[button('Назад', 'menu:field_trip'), button('Главное меню', 'menu:main')]]),
        mechanicStage: 'field_trip',
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized.startsWith('fieldtrip:start_route:')) {
      const routeId = normalized.slice('fieldtrip:start_route:'.length);
      const authUser = getAuthorizedUser(String(phone));
      const ticket = getCurrentRepair(phone);
      const route = getServiceRouteNorms().find(item => item.id === routeId);
      if (!authUser || !ticket || !route) {
        return reply(senderId, '❌ Не удалось определить заявку или маршрут выезда.', {
          attachments: currentRepairKeyboard(ticket?.id || ''),
          mechanicStage: 'field_trip',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const activeTrip = getActiveFieldTripForRepair(ticket.id, authUser.userName);
      if (activeTrip) {
        return reply(senderId, formatFieldTripMessage(activeTrip, ticket), {
          attachments: fieldTripStatusKeyboard(activeTrip),
          mechanicStage: 'field_trip',
          phone,
          callbackContext,
          replaceMessage: true,
          notification: 'По этой заявке уже есть активный выезд',
        });
      }
      const trip = createFieldTripFromBot(ticket, authUser, {
        routeNormId: route.id,
        routeFrom: route.from,
        routeTo: route.to,
        distanceKm: route.distanceKm,
        normSpeedKmh: route.normSpeedKmh,
        serviceVehicleId: ticket.serviceVehicleId || null,
        source: 'bot',
      });
      resetBotFlow(phone);
      setCurrentRepair(phone, ticket.id);
      return reply(senderId, formatFieldTripMessage(trip, ticket), {
        attachments: fieldTripStatusKeyboard(trip),
        mechanicStage: 'field_trip',
        phone,
        callbackContext,
        replaceMessage: true,
        notification: `Выезд начат · ${trip.closedNormHours.toFixed(1)} н/ч`,
      });
    }

    if (normalized.startsWith('fieldtrip:arrived:')) {
      const tripId = normalized.slice('fieldtrip:arrived:'.length);
      const authUser = getAuthorizedUser(String(phone));
      if (!authUser) {
        return reply(senderId, '🔒 Сначала авторизуйтесь.', {
          attachments: authKeyboard(),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const result = updateFieldTripStatusFromBot(tripId, 'arrived', authUser);
      if (!result) {
        return reply(senderId, '❌ Выезд не найден.', {
          attachments: currentRepairKeyboard(getCurrentRepair(phone)?.id || ''),
          mechanicStage: 'field_trip',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const ticket = result.trip?.serviceTicketId ? findServiceTicketById(result.trip.serviceTicketId) : null;
      return reply(senderId, formatFieldTripMessage(result.trip, ticket), {
        attachments: fieldTripStatusKeyboard(result.trip),
        mechanicStage: 'field_trip',
        phone,
        callbackContext,
        replaceMessage: true,
        notification: result.changed ? 'Отмечено: на объекте' : 'Статус уже установлен',
      });
    }

    if (normalized.startsWith('fieldtrip:complete:')) {
      const tripId = normalized.slice('fieldtrip:complete:'.length);
      const authUser = getAuthorizedUser(String(phone));
      if (!authUser) {
        return reply(senderId, '🔒 Сначала авторизуйтесь.', {
          attachments: authKeyboard(),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const result = updateFieldTripStatusFromBot(tripId, 'completed', authUser);
      if (!result) {
        return reply(senderId, '❌ Выезд не найден.', {
          attachments: currentRepairKeyboard(getCurrentRepair(phone)?.id || ''),
          mechanicStage: 'field_trip',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const ticket = result.trip?.serviceTicketId ? findServiceTicketById(result.trip.serviceTicketId) : null;
      setCurrentRepair(phone, ticket?.id || getCurrentRepair(phone)?.id || '');
      return reply(senderId, formatFieldTripMessage(result.trip, ticket), {
        attachments: currentRepairKeyboard(ticket?.id || getCurrentRepair(phone)?.id || ''),
        mechanicStage: 'field_trip',
        phone,
        callbackContext,
        replaceMessage: true,
        notification: result.changed
          ? `Выезд закрыт · ${Number(result.trip.closedNormHours || 0).toFixed(1)} н/ч`
          : 'Выезд уже завершён',
      });
    }

    const map = {
      'menu:help': '/помощь',
      'menu:main': '/меню',
      'menu:deliveries': '/доставки',
      'menu:rentals': '/аренды',
      'menu:equipment': '/техника',
      'menu:service': '/сервис',
      'menu:myrepairs': '/моизаявки',
      'menu:new_ticket': '/новаязаявка',
      'menu:find_equipment': '/найтитехнику',
      'menu:manager_summary': '/моясводка',
      'menu:new_delivery': '/новаядоставка',
      'menu:shipout': '/отгрузка',
      'menu:receivein': '/приёмка',
      'menu:draft': '/черновик',
      'menu:summary': '/итог',
      'menu:repair_before': '/фотодо',
      'menu:repair_after': '/фотопосле',
      'menu:day_report': '/мойдень',
      'menu:works': '/работы',
      'menu:parts': '/запчасти',
      'menu:field_trip': '/выезд',
      'menu:ready': '/готово',
      'menu:waiting': '/ожидание',
    };

    if (normalized.startsWith('ticket:open:')) {
      const ticketId = normalized.slice('ticket:open:'.length);
      return handleCommand(senderId, phone, `/ремонт ${ticketId}`, {}, { callbackContext, replaceMessage: true });
    }

    if (normalized.startsWith('delivery:status:')) {
      const [, , deliveryId, nextStatus] = normalized.split(':');
      const authUser = getAuthorizedUser(String(phone));
      const actorName = authUser?.userName || 'Перевозчик';
      const result = updateDeliveryStatusFromBot(deliveryId, nextStatus, actorName);
      if (!result) {
        return reply(senderId, '❌ Доставка не найдена.', {
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      if (result.invalid) {
        return reply(senderId, formatDeliveryStatusMessage(result.delivery), {
          attachments: deliveryStatusKeyboard(result.delivery),
          phone,
          callbackContext,
          replaceMessage: true,
          notification: 'Статус нельзя изменить этим шагом',
        });
      }
      return reply(senderId, formatDeliveryStatusMessage(result.delivery), {
        attachments: deliveryStatusKeyboard(result.delivery),
        phone,
        callbackContext,
        replaceMessage: true,
        notification: result.changed ? `Статус: ${deliveryStatusLabel(result.delivery.status)}` : 'Статус уже установлен',
      });
    }

    if (normalized.startsWith('ticket:take:')) {
      const ticketId = normalized.slice('ticket:take:'.length);
      return handleCommand(senderId, phone, `/вработу ${ticketId}`, {}, { callbackContext, replaceMessage: true });
    }

    if (normalized.startsWith('repairclose:confirm:')) {
      const [, , ticketId, checklistKey] = normalized.split(':');
      const ticket = findServiceTicketById(ticketId);
      if (!ticket) {
        return reply(senderId, '❌ Заявка не найдена.', {
          attachments: mechanicKeyboard(),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const session = getBotSession(phone);
      const draft = {
        ...(session.pendingPayload?.closeChecklistDraft || {}),
        [checklistKey]: true,
      };
      updateBotSession(phone, {
        pendingAction: 'repair_close_checklist',
        activeRepairId: ticket.id,
        pendingPayload: {
          repairId: ticket.id,
          closeChecklistDraft: draft,
        },
      });
      const checklist = buildRepairCloseChecklistStatus(ticket, draft);
      return reply(senderId, formatRepairCloseChecklist(ticket, checklist), {
        attachments: repairCloseChecklistKeyboard(ticket, checklist),
        mechanicStage: 'complete',
        phone,
        callbackContext,
        replaceMessage: true,
        notification: 'Пункт подтверждён',
      });
    }

    if (normalized.startsWith('repairclose:cancel:')) {
      resetBotFlow(phone);
      const ticketId = normalized.slice('repairclose:cancel:'.length);
      return reply(senderId, `❎ Закрытие заявки ${ticketId} отменено.`, {
        attachments: currentRepairKeyboard(ticketId),
        mechanicStage: 'repair',
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized.startsWith('repairclose:complete:')) {
      const ticketId = normalized.slice('repairclose:complete:'.length);
      const ticket = findServiceTicketById(ticketId);
      if (!ticket) {
        return reply(senderId, '❌ Заявка не найдена.', {
          attachments: mechanicKeyboard(),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const authUser = getAuthorizedUser(String(phone));
      if (!authUser) {
        return reply(senderId, '🔒 Сначала авторизуйтесь.', {
          attachments: authKeyboard(),
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      const draft = getBotSession(phone).pendingPayload?.closeChecklistDraft || {};
      const checklist = buildRepairCloseChecklistStatus(ticket, draft);
      const missingKey = nextMissingRepairCloseChecklistKey(checklist);
      if (missingKey) {
        return reply(senderId, formatRepairCloseChecklist(ticket, checklist), {
          attachments: repairCloseChecklistKeyboard(ticket, checklist),
          mechanicStage: 'complete',
          phone,
          callbackContext,
          replaceMessage: true,
          notification: `Не заполнено: ${REPAIR_CLOSE_CHECKLIST_LABELS[missingKey]}`,
        });
      }
      const updatedWithChecklist = appendServiceLog({
        ...ticket,
        closeChecklist: checklist,
      }, 'Чек-лист закрытия подтверждён через MAX', authUser.userName, 'repair_result');
      saveServiceTicket(updatedWithChecklist);
      setCurrentRepair(phone, ticket.id);
      return handleCommand(senderId, phone, '/закрыть', {}, { callbackContext, replaceMessage: true });
    }

    if (normalized.startsWith('equipment:choose:')) {
      const equipmentId = normalized.slice('equipment:choose:'.length);
      const equipment = (readData('equipment') || []).find(item => item.id === equipmentId);
      if (!equipment) {
        const authUser = getAuthorizedUser(String(phone));
        return reply(senderId, '❌ Техника больше не найдена. Выполните поиск заново.', {
          attachments: defaultKeyboardForRole(authUser?.userRole || ''),
          mechanicStage: mechanicMainStageForRole(authUser?.userRole || '') ? 'repair' : null,
        });
      }
      const flow = getBotSession(phone).pendingPayload?.flow;
      const photoEventType = getBotSession(phone).pendingPayload?.photoEventType;
      if (flow === 'photo_event') {
        const authUser = getAuthorizedUser(String(phone));
        if (!authUser) {
          return reply(senderId, '🔒 Сначала авторизуйтесь.', {
            attachments: authKeyboard(),
            phone,
            callbackContext,
            replaceMessage: true,
          });
        }
        return startEquipmentOperationRequest(senderId, phone, authUser, equipment, photoEventType, { callbackContext });
      }
      if (flow === 'service_ticket') {
        updateBotSession(phone, {
          pendingAction: 'ticket_reason',
          pendingPayload: { selectedEquipmentId: equipment.id },
        });
        return reply(
          senderId,
          `🛠 ${formatEquipmentForBot(equipment)}\n\nНапишите причину сервисной заявки следующим сообщением.`,
          {
            attachments: keyboard([backAndMainRow('menu:new_ticket')]),
            mechanicStage: 'ticket',
            phone,
            callbackContext,
            replaceMessage: true,
          },
        );
      }

      updateBotSession(phone, {
        pendingAction: 'equipment_action_menu',
        pendingPayload: { selectedEquipmentId: equipment.id },
      });
      return reply(
        senderId,
        formatEquipmentActionMenu(equipment),
        {
          attachments: equipmentActionKeyboard(equipment.id),
          mechanicStage: 'repair',
          phone,
          callbackContext,
          replaceMessage: true,
        },
      );
    }

    if (normalized.startsWith('equipmentmenu:open:')) {
      const equipmentId = normalized.slice('equipmentmenu:open:'.length);
      const equipment = (readData('equipment') || []).find(item => item.id === equipmentId);
      if (!equipment) {
        return reply(senderId, '❌ Техника больше не найдена.', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'repair',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      updateBotSession(phone, {
        pendingAction: 'equipment_action_menu',
        pendingPayload: { selectedEquipmentId: equipment.id },
      });
      return reply(senderId, formatEquipmentActionMenu(equipment), {
        attachments: equipmentActionKeyboard(equipment.id),
        mechanicStage: 'repair',
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized.startsWith('equipmentmenu:history:')) {
      const equipmentId = normalized.slice('equipmentmenu:history:'.length);
      const equipment = (readData('equipment') || []).find(item => item.id === equipmentId);
      if (!equipment) {
        return reply(senderId, '❌ Техника больше не найдена.', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'repair',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      updateBotSession(phone, {
        pendingAction: 'equipment_action_menu',
        pendingPayload: { selectedEquipmentId: equipment.id },
      });
      return reply(senderId, formatEquipmentHistoryForBot(equipment), {
        attachments: keyboard([
          [button('Ремонт', `equipmentmenu:repair:${equipment.id}`), button('ТО', `equipmentmenu:maintenance:${equipment.id}:to`)],
          [button('ЧТО', `equipmentmenu:maintenance:${equipment.id}:chto`), button('ПТО', `equipmentmenu:maintenance:${equipment.id}:pto`)],
          [button('Назад', `equipmentmenu:open:${equipment.id}`), button('Главное меню', 'menu:main')],
        ]),
        mechanicStage: 'repair',
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized.startsWith('equipmentmenu:repair:')) {
      const equipmentId = normalized.slice('equipmentmenu:repair:'.length);
      const equipment = (readData('equipment') || []).find(item => item.id === equipmentId);
      if (!equipment) {
        return reply(senderId, '❌ Техника больше не найдена.', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'repair',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      updateBotSession(phone, {
        pendingAction: 'ticket_reason',
        pendingPayload: { selectedEquipmentId: equipment.id },
      });
      return reply(
        senderId,
        `🛠 ${formatEquipmentForBot(equipment)}\n\nНапишите причину ремонта следующим сообщением.`,
        {
          attachments: keyboard([backAndMainRow(`equipmentmenu:open:${equipment.id}`)]),
          mechanicStage: 'ticket',
          phone,
          callbackContext,
          replaceMessage: true,
        },
      );
    }

    if (normalized.startsWith('equipmentmenu:maintenance:')) {
      const [, , equipmentId, maintenanceKind] = normalized.split(':');
      const equipment = (readData('equipment') || []).find(item => item.id === equipmentId);
      const maintenanceLabel = MAINTENANCE_REASON_LABELS[maintenanceKind];
      if (!equipment || !maintenanceLabel) {
        return reply(senderId, '❌ Техника или тип обслуживания больше не найдены.', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'repair',
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      updateBotSession(phone, {
        pendingAction: 'maintenance_summary',
        pendingPayload: { selectedEquipmentId: equipment.id, maintenanceKind },
      });
      return reply(
        senderId,
        `🧰 ${maintenanceLabel}: ${formatEquipmentForBot(equipment)}\n\nНапишите следующим сообщением, что именно было сделано.`,
        {
          attachments: keyboard([backAndMainRow(`equipmentmenu:open:${equipment.id}`)]),
          mechanicStage: 'repair',
          phone,
          callbackContext,
          replaceMessage: true,
        },
      );
    }

    if (normalized.startsWith('work:choose:')) {
      const workId = normalized.slice('work:choose:'.length);
      const work = (readData('service_works') || []).find(item => item.id === workId && item.isActive !== false);
      if (!work) {
        return reply(senderId, '❌ Работа больше недоступна. Выполните поиск работ заново.', {
          attachments: currentRepairKeyboard(getCurrentRepair(phone)?.id || ''),
          mechanicStage: 'work',
        });
      }
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return reply(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'repairs',
        });
      }
      updateBotSession(phone, {
        activeRepairId: ticket.id,
        pendingAction: 'work_pick',
        pendingPayload: { selectedWorkId: work.id },
      });
      return handleAddWorkRequest(senderId, phone, getAuthorizedUser(String(phone)), ticket, work.name, {
        callbackContext,
        replaceMessage: true,
      });
    }

    if (normalized.startsWith('part:choose:')) {
      const partId = normalized.slice('part:choose:'.length);
      const part = (readData('spare_parts') || []).find(item => item.id === partId && item.isActive !== false);
      if (!part) {
        return reply(senderId, '❌ Запчасть больше недоступна. Выполните поиск запчастей заново.', {
          attachments: currentRepairKeyboard(getCurrentRepair(phone)?.id || ''),
          mechanicStage: 'parts',
        });
      }
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return reply(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'repairs',
        });
      }
      updateBotSession(phone, {
        activeRepairId: ticket.id,
        pendingAction: 'part_pick',
        pendingPayload: { selectedPartId: part.id },
      });
      return reply(
        senderId,
        [
          `📦 Выбрана запчасть:`,
          part.name,
          '',
          'Выберите количество кнопкой ниже.',
          'Если нужна своя цена, нажмите «Ввести руками» и отправьте:',
          'КОЛИЧЕСТВО [ЦЕНА]',
          'Пример: 2 3500',
        ].join('\n'),
        {
          attachments: quantityKeyboard('part'),
          mechanicStage: 'parts',
          phone,
          callbackContext,
          replaceMessage: true,
        },
      );
    }

    if (normalized.startsWith('reason:')) {
      const reasonKey = normalized.slice('reason:'.length);
      const currentReason = REPAIR_REASON_BY_KEY[reasonKey];
      if (reasonKey === 'custom') {
        const selectedEquipmentId = getBotSession(phone).pendingPayload?.selectedEquipmentId;
        if (!selectedEquipmentId) {
          return reply(senderId, '❌ Сначала выберите технику.', {
            attachments: mechanicKeyboard(),
            mechanicStage: 'ticket',
          });
        }
        updateBotSession(phone, {
          pendingAction: 'ticket_reason',
          pendingPayload: { selectedEquipmentId },
        });
        return reply(
          senderId,
          '📝 Напишите свою причину ремонта следующим сообщением.',
          {
            attachments: keyboard([backAndMainRow('menu:new_ticket')]),
            mechanicStage: 'ticket',
            phone,
            callbackContext,
            replaceMessage: true,
          },
        );
      }
      if (!currentReason) {
        return reply(senderId, '❌ Причина не распознана. Выберите кнопку ещё раз.', {
          attachments: repairReasonKeyboard(),
          mechanicStage: 'ticket',
        });
      }
      const authUser = getAuthorizedUser(String(phone));
      if (!authUser) {
        return reply(senderId, '🔒 Сначала авторизуйтесь.', { attachments: authKeyboard() });
      }
      return handleCreateTicketRequest(senderId, phone, authUser, currentReason, { callbackContext });
    }

    if (normalized.startsWith('qty:')) {
      const [, kind, value] = normalized.split(':');
      const authUser = getAuthorizedUser(String(phone));
      if (!authUser) {
        return reply(senderId, '🔒 Сначала авторизуйтесь.', { attachments: authKeyboard() });
      }
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return reply(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'repairs',
        });
      }

      if (value === 'manual') {
        if (kind === 'work') {
          return reply(senderId, '🧰 Напишите количество работы одним числом. Например: 2', {
            attachments: currentRepairKeyboard(ticket.id),
            mechanicStage: 'work',
            phone,
            callbackContext,
            replaceMessage: true,
          });
        }
        if (kind === 'part') {
          return reply(senderId, '📦 Напишите: КОЛИЧЕСТВО [ЦЕНА]\nПример: 2 3500\nЕсли цену не указывать, возьмётся базовая.', {
            attachments: currentRepairKeyboard(ticket.id),
            mechanicStage: 'parts',
            phone,
            callbackContext,
            replaceMessage: true,
          });
        }
      }

      if (!['1', '2', '3', '5'].includes(value || '')) {
        return reply(senderId, '❌ Количество не распознано.', {
          attachments: currentRepairKeyboard(ticket.id),
          mechanicStage: kind === 'part' ? 'parts' : 'work',
        });
      }

      if (kind === 'work') {
        return handleAddWorkRequest(senderId, phone, authUser, ticket, value, { callbackContext });
      }
      if (kind === 'part') {
        return handleAddPartRequest(senderId, phone, authUser, ticket, value, { callbackContext });
      }
    }

    if (map[normalized]) {
      return handleCommand(senderId, phone, map[normalized], {}, { callbackContext, replaceMessage: true });
    }

    return reply(senderId, 'ℹ️ Действие кнопки пока не распознано.', {
      attachments: defaultKeyboardForRole(getAuthorizedUser(String(phone))?.userRole || ''),
      mechanicStage: mechanicMainStageForRole(getAuthorizedUser(String(phone))?.userRole || ''),
      phone,
      callbackContext,
      replaceMessage: true,
    });
  }

  async function handleCommand(senderId, phone, text) {
    const trimmed = text.trim();
    const lower = trimmed.toLowerCase();
    const parts = trimmed.split(/\s+/);
    const session = getBotSession(phone);
    const messageMeta = arguments[3] || {};
    const uiContext = arguments[4] || {};
    const callbackContext = uiContext.callbackContext || null;

    function replyWithUi(textValue, options = {}) {
      return reply(senderId, textValue, {
        phone,
        callbackContext,
        replaceMessage: Boolean(uiContext.replaceMessage),
        cleanupPrevious: !callbackContext,
        ...options,
      });
    }

    authorizeCarrier(String(phone), senderId);

    console.log('[TRACE] handleCommand phone=%s command=%s', phone, lower.startsWith('/start') ? '/start' : lower.split(/\s+/)[0] || 'message');

    if (lower.startsWith('/start')) {
      console.log('[TRACE] /start matched, parts=%d', parts.length);
      const carrierUser = getAuthorizedUser(String(phone));
      if (carrierUser?.userRole === 'Перевозчик' && parts.length < 3) {
        resetBotFlow(phone);
        return replyWithUi(
          getMainMenuText(carrierUser),
          { attachments: carrierKeyboard(), brandImage: true },
        );
      }
      if (parts.length < 3) {
        updateBotSession(phone, { pendingAction: 'login_email', pendingPayload: null });
        return reply(
          senderId,
          '👤 Напишите логин (email) следующим сообщением.',
          { attachments: keyboard([backAndMainRow('menu:cancel_login')]), brandImage: true, phone, callbackContext, replaceMessage: Boolean(uiContext.replaceMessage), cleanupPrevious: !callbackContext },
        );
      }
      const [, email, password] = parts;
      console.log('[TRACE] authorizing email=%s', email);
      let user;
      try {
        user = authorizeUser(String(phone), email, password, senderId);
      } catch (e) {
        console.error('[TRACE] authorizeUser threw:', e.message, e.stack);
        return reply(senderId, '❌ Внутренняя ошибка авторизации. Попробуйте позже.');
      }
      console.log('[TRACE] user=%s', user ? user.name : 'null');
      if (!user) {
        console.log('[TRACE] sending auth error');
        clearAuthorizedUser(phone);
        updateBotSession(phone, {
          pendingAction: 'login_email',
          pendingPayload: null,
        });
        return replyWithUi(
          '❌ Неверный логин или пароль.\n\nНажмите «Войти» и попробуйте снова.',
          { attachments: authKeyboard() },
        );
      }
      console.log('[TRACE] sending welcome message for user');
      resetBotFlow(phone);
      return replyWithUi(
        getMainMenuText(user),
        {
          attachments: defaultKeyboardForRole(user.role),
          brandImage: true,
        },
      );
    }

    if (!trimmed.startsWith('/')) {
      if (session.pendingAction === 'operation_step') {
        const authUser = getAuthorizedUser(String(phone));
        if (!authUser) {
          return reply(senderId, '🔒 Сначала авторизуйтесь.', { attachments: authKeyboard() });
        }
        return handleOperationStepInput(senderId, phone, authUser, {
          ...messageMeta,
          text: trimmed,
        }, uiContext);
      }

      if (session.pendingAction === 'login_email') {
        updateBotSession(phone, {
          pendingAction: 'login_password',
          pendingPayload: { loginEmail: trimmed },
        });
        return reply(
          senderId,
          `🔐 Логин принят: ${trimmed}\nТеперь напишите пароль следующим сообщением.`,
          { attachments: keyboard([backAndMainRow('menu:cancel_login')]) },
        );
      }

      if (session.pendingAction === 'login_password') {
        const email = session.pendingPayload?.loginEmail || '';
        let user;
        try {
          user = authorizeUser(String(phone), email, trimmed, senderId);
        } catch (e) {
          console.error('[TRACE] authorizeUser(login flow) threw:', e.message, e.stack);
          return reply(senderId, '❌ Внутренняя ошибка авторизации. Попробуйте позже.');
        }
        if (!user) {
          clearAuthorizedUser(phone);
          updateBotSession(phone, {
            pendingAction: 'login_email',
            pendingPayload: null,
          });
          return reply(
            senderId,
            '❌ Неверный логин или пароль. Давайте начнём заново: напишите логин (email).',
            { attachments: keyboard([backAndMainRow('menu:cancel_login')]) },
          );
        }
        resetBotFlow(phone);
        return reply(
          senderId,
          getMainMenuText(user),
          {
            attachments: defaultKeyboardForRole(user.role),
            brandImage: true,
          },
        );
      }
    }

    const authUser = getAuthorizedUser(String(phone));
    if (!authUser) {
      return reply(senderId,
        '🔒 Вы не авторизованы.\n\nНажмите «Войти», и я попрошу логин и пароль по шагам.',
        { attachments: authKeyboard(), brandImage: true },
      );
    }

    const botUsers = getBotUsers();
    botUsers[String(phone)] = {
      ...authUser,
      replyTarget: normalizeReplyTarget(senderId, phone),
    };
    saveBotUsers(botUsers);

    const { userName, userRole } = authUser;
    const canManageRepair = isMechanicRole(userRole) || userRole === 'Администратор';
    const canCreateServiceRequest = canManageRepair || userRole === 'Менеджер по аренде' || userRole === 'Офис-менеджер';
    const isRentalManager = userRole === 'Менеджер по аренде';
    const isCarrier = userRole === 'Перевозчик';

    if (!trimmed.startsWith('/')) {
      const currentTicket = getCurrentRepair(phone);
      if (session.pendingAction === 'equipment_search' && canCreateServiceRequest) {
        return handleEquipmentSearchRequest(senderId, phone, trimmed, uiContext);
      }
      if (session.pendingAction === 'ticket_reason' && canCreateServiceRequest) {
        return handleCreateTicketRequest(senderId, phone, authUser, trimmed, uiContext);
      }
      if (session.pendingAction === 'maintenance_summary' && canManageRepair) {
        const equipmentId = session.pendingPayload?.selectedEquipmentId;
        const maintenanceKind = session.pendingPayload?.maintenanceKind;
        const equipment = (readData('equipment') || []).find(item => item.id === equipmentId);
        if (!equipment || !maintenanceKind) {
          resetBotFlow(phone);
          return reply(senderId, '❌ Не удалось определить технику или тип обслуживания. Начните заново.', {
            attachments: mechanicKeyboard(),
            phone,
            callbackContext: uiContext.callbackContext,
            replaceMessage: Boolean(uiContext.callbackContext),
          });
        }
        const ticket = createMaintenanceTicketFromBot(equipment, authUser, maintenanceKind, trimmed);
        resetBotFlow(phone);
        return reply(senderId, withBotMenu([
          `✅ ${MAINTENANCE_REASON_LABELS[maintenanceKind]} зафиксировано`,
          formatEquipmentForBot(equipment),
          `Заявка: ${ticket.id}`,
          `Комментарий: ${trimmed}`,
        ].join('\n'), ['мои заявки', 'новая заявка', 'меню']), {
          attachments: mechanicKeyboard(),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
          cleanupPrevious: !uiContext.callbackContext,
        });
      }
      if (session.pendingAction === 'manager_delivery_date' && isRentalManager) {
        const transportDate = normalizeBotDateInput(trimmed);
        if (!transportDate) {
          return reply(senderId, '❌ Укажите дату в формате ГГГГ-ММ-ДД. Можно написать: сегодня или завтра.', {
            attachments: keyboard([[button('Отмена', 'deliverycreate:cancel')]]),
            phone,
            callbackContext: uiContext.callbackContext,
            replaceMessage: Boolean(uiContext.callbackContext),
          });
        }
        updateBotSession(phone, {
          pendingAction: 'manager_delivery_cargo',
          pendingPayload: {
            managerDeliveryDraft: {
              ...(session.pendingPayload?.managerDeliveryDraft || {}),
              transportDate,
            },
          },
        });
        return reply(senderId, '📦 Напишите, что нужно перевезти.', {
          attachments: keyboard([[button('Отмена', 'deliverycreate:cancel')]]),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      if (session.pendingAction === 'manager_delivery_cargo' && isRentalManager) {
        updateBotSession(phone, {
          pendingAction: 'manager_delivery_client',
          pendingPayload: {
            managerDeliveryDraft: {
              ...(session.pendingPayload?.managerDeliveryDraft || {}),
              cargo: trimmed,
            },
          },
        });
        return reply(senderId, '🏢 Напишите название клиента.', {
          attachments: keyboard([[button('Отмена', 'deliverycreate:cancel')]]),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      if (session.pendingAction === 'manager_delivery_client' && isRentalManager) {
        updateBotSession(phone, {
          pendingAction: 'manager_delivery_origin',
          pendingPayload: {
            managerDeliveryDraft: {
              ...(session.pendingPayload?.managerDeliveryDraft || {}),
              client: trimmed,
            },
          },
        });
        return reply(senderId, '📍 Напишите точку отправления.', {
          attachments: keyboard([[button('Отмена', 'deliverycreate:cancel')]]),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      if (session.pendingAction === 'manager_delivery_origin' && isRentalManager) {
        updateBotSession(phone, {
          pendingAction: 'manager_delivery_destination',
          pendingPayload: {
            managerDeliveryDraft: {
              ...(session.pendingPayload?.managerDeliveryDraft || {}),
              origin: trimmed,
            },
          },
        });
        return reply(senderId, '📍 Напишите точку назначения.', {
          attachments: keyboard([[button('Отмена', 'deliverycreate:cancel')]]),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      if (session.pendingAction === 'manager_delivery_destination' && isRentalManager) {
        updateBotSession(phone, {
          pendingAction: 'manager_delivery_contact_name',
          pendingPayload: {
            managerDeliveryDraft: {
              ...(session.pendingPayload?.managerDeliveryDraft || {}),
              destination: trimmed,
            },
          },
        });
        return reply(senderId, '👤 Напишите контактное лицо.', {
          attachments: keyboard([[button('Отмена', 'deliverycreate:cancel')]]),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      if (session.pendingAction === 'manager_delivery_contact_name' && isRentalManager) {
        updateBotSession(phone, {
          pendingAction: 'manager_delivery_contact_phone',
          pendingPayload: {
            managerDeliveryDraft: {
              ...(session.pendingPayload?.managerDeliveryDraft || {}),
              contactName: trimmed,
            },
          },
        });
        return reply(senderId, '📞 Напишите контактный телефон.', {
          attachments: keyboard([[button('Отмена', 'deliverycreate:cancel')]]),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      if (session.pendingAction === 'manager_delivery_contact_phone' && isRentalManager) {
        updateBotSession(phone, {
          pendingAction: 'manager_delivery_comment',
          pendingPayload: {
            managerDeliveryDraft: {
              ...(session.pendingPayload?.managerDeliveryDraft || {}),
              contactPhone: trimmed,
            },
          },
        });
        return reply(senderId, '📝 Напишите комментарий к доставке или нажмите «Пропустить».', {
          attachments: createDeliverySkipKeyboard(),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      if (session.pendingAction === 'manager_delivery_comment' && isRentalManager) {
        const draft = {
          ...(session.pendingPayload?.managerDeliveryDraft || {}),
          comment: trimmed,
        };
        const delivery = createDeliveryFromBot(authUser, draft);
        resetBotFlow(phone);
        return reply(senderId, withBotMenu([
          `✅ Доставка создана: ${delivery.id}`,
          `${deliveryTypeLabel(delivery.type)} · ${delivery.transportDate}`,
          `${delivery.origin} → ${delivery.destination}`,
          `Груз: ${delivery.cargo}`,
          `Клиент: ${delivery.client}`,
        ].join('\n'), ['моя сводка', 'аренды', 'новая доставка']), {
          attachments: managerSummaryKeyboard(),
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      if (session.pendingAction === 'work_search') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handleWorkSearchRequest(senderId, phone, currentTicket, trimmed, uiContext);
      }
      if (session.pendingAction === 'work_pick') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handleAddWorkRequest(senderId, phone, authUser, currentTicket, trimmed, uiContext);
      }
      if (session.pendingAction === 'part_search') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handlePartSearchRequest(senderId, phone, currentTicket, trimmed, uiContext);
      }
      if (session.pendingAction === 'part_pick') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handleAddPartRequest(senderId, phone, authUser, currentTicket, trimmed, uiContext);
      }
      if (session.pendingAction === 'summary') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handleSummaryRequest(senderId, phone, authUser, currentTicket, trimmed, uiContext);
      }
      if (session.pendingAction === 'field_trip_manual_route') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        const parsedRoute = parseManualFieldTripRoute(trimmed);
        if (!parsedRoute) {
          return reply(senderId, '❌ Напишите маршрут в формате: Казань → Алабуга', {
            attachments: keyboard([[button('Назад', 'menu:field_trip'), button('Главное меню', 'menu:main')]]),
            mechanicStage: 'field_trip',
            phone,
            callbackContext: uiContext.callbackContext,
            replaceMessage: Boolean(uiContext.callbackContext),
          });
        }
        updateBotSession(phone, {
          activeRepairId: currentTicket.id,
          pendingAction: 'field_trip_manual_distance',
          pendingPayload: {
            serviceTicketId: currentTicket.id,
            fieldTripDraft: parsedRoute,
          },
        });
        return reply(senderId, '📏 Напишите расстояние в километрах числом. Например: 200', {
          attachments: keyboard([[button('Назад', 'menu:field_trip'), button('Главное меню', 'menu:main')]]),
          mechanicStage: 'field_trip',
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      if (session.pendingAction === 'field_trip_manual_distance') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        const distanceKm = Math.max(0, Number(String(trimmed).replace(',', '.')) || 0);
        if (!distanceKm) {
          return reply(senderId, '❌ Напишите расстояние числом в километрах. Например: 200', {
            attachments: keyboard([[button('Назад', 'menu:field_trip'), button('Главное меню', 'menu:main')]]),
            mechanicStage: 'field_trip',
            phone,
            callbackContext: uiContext.callbackContext,
            replaceMessage: Boolean(uiContext.callbackContext),
          });
        }
        const activeTrip = getActiveFieldTripForRepair(currentTicket.id, authUser.userName);
        if (activeTrip) {
          resetBotFlow(phone);
          return reply(senderId, formatFieldTripMessage(activeTrip, currentTicket), {
            attachments: fieldTripStatusKeyboard(activeTrip),
            mechanicStage: 'field_trip',
            phone,
            callbackContext: uiContext.callbackContext,
            replaceMessage: Boolean(uiContext.callbackContext),
          });
        }
        const draft = session.pendingPayload?.fieldTripDraft || {};
        const trip = createFieldTripFromBot(currentTicket, authUser, {
          routeFrom: draft.routeFrom,
          routeTo: draft.routeTo,
          distanceKm,
          normSpeedKmh: 70,
          serviceVehicleId: currentTicket.serviceVehicleId || null,
          source: 'bot',
        });
        resetBotFlow(phone);
        setCurrentRepair(phone, currentTicket.id);
        return reply(senderId, formatFieldTripMessage(trip, currentTicket), {
          attachments: fieldTripStatusKeyboard(trip),
          mechanicStage: 'field_trip',
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
      if (session.pendingAction === 'repair_photo_before') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handleRepairPhotoUpload(senderId, phone, authUser, currentTicket, 'before', { ...messageMeta, text: trimmed }, uiContext);
      }
      if (session.pendingAction === 'repair_photo_after') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handleRepairPhotoUpload(senderId, phone, authUser, currentTicket, 'after', { ...messageMeta, text: trimmed }, uiContext);
      }
      if (session.pendingAction === 'repair_close_checklist') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        const draft = getBotSession(phone).pendingPayload?.closeChecklistDraft || {};
        return reply(senderId, `${formatRepairCloseChecklist(currentTicket, buildRepairCloseChecklistStatus(currentTicket, draft))}\n\nИспользуйте кнопки ниже, чтобы продолжить чек-лист.`, {
          attachments: repairCloseChecklistKeyboard(currentTicket, buildRepairCloseChecklistStatus(currentTicket, draft)),
          mechanicStage: 'complete',
          phone,
          callbackContext: uiContext.callbackContext,
          replaceMessage: Boolean(uiContext.callbackContext),
        });
      }
    }

    if (lower === '/аренды' || lower === '/rentals' || lower === '/мои' || lower === 'аренды') {
      const rentals = readData('rentals') || [];
      return replyWithUi(formatRentals(rentals, userName, userRole), {
        attachments: defaultKeyboardForRole(userRole),
      });
    }

    if (lower === '/техника' || lower === '/equipment' || lower === 'техника') {
      const equipment = readData('equipment') || [];
      return replyWithUi(formatEquipment(equipment), {
        attachments: defaultKeyboardForRole(userRole),
      });
    }

    if (lower === '/сервис' || lower === '/service' || lower === 'сервис' || lower === 'заявки') {
      return replyWithUi(canManageRepair ? formatServiceForUser(authUser) : formatService(readData('service') || []), {
        attachments: defaultKeyboardForRole(userRole),
        mechanicStage: canManageRepair ? 'repairs' : null,
      });
    }

    if ((lower === '/моизаявки' || lower === '/myrepairs' || lower === 'мои заявки') && canManageRepair) {
      return replyWithUi(formatServiceForUser(authUser, 'assigned'), {
        attachments: serviceTicketsKeyboard(authUser) || mechanicKeyboard(),
        mechanicStage: 'repairs',
      });
    }

    if ((lower === '/меню' || lower === 'меню')) {
      return replyWithUi(getMainMenuText(authUser), {
        attachments: defaultKeyboardForRole(userRole),
        brandImage: true,
      });
    }

    if ((lower === '/доставки' || lower === 'доставки' || lower === 'мои доставки') && isCarrier) {
      const deliveries = getCarrierDeliveries(phone, authUser);
      const activeDelivery = deliveries.find(item => item.status !== 'completed' && item.status !== 'cancelled') || deliveries[0] || null;
      return replyWithUi(formatCarrierDeliveries(deliveries), {
        attachments: activeDelivery ? deliveryStatusKeyboard(activeDelivery) : carrierKeyboard(),
      });
    }

    if ((lower === '/новаязаявка' || lower === 'новая заявка' || lower === 'создать заявку') && canCreateServiceRequest) {
      updateBotSession(phone, {
        pendingAction: 'equipment_search',
        pendingPayload: { flow: 'service_ticket' },
        lastEquipmentSearch: [],
      });
      return replyWithUi('🚜 Напишите следующим сообщением INV, серийный номер, модель или производителя техники.', {
        attachments: defaultKeyboardForRole(userRole),
        mechanicStage: canManageRepair ? 'ticket' : null,
      });
    }

    if ((lower === '/отгрузка' || lower === 'отгрузка') && canManageRepair) {
      updateBotSession(phone, {
        pendingAction: 'equipment_search',
        pendingPayload: { flow: 'photo_event', photoEventType: 'shipping' },
        lastEquipmentSearch: [],
      });
      return replyWithUi('🚚 Напишите INV, SN, модель или производителя техники для отгрузки.', {
        attachments: mechanicKeyboard(),
        mechanicStage: 'handoff',
      });
    }

    if ((lower === '/приемка' || lower === '/приёмка' || lower === 'приемка' || lower === 'приёмка') && canManageRepair) {
      updateBotSession(phone, {
        pendingAction: 'equipment_search',
        pendingPayload: { flow: 'photo_event', photoEventType: 'receiving' },
        lastEquipmentSearch: [],
      });
      return replyWithUi('📥 Напишите INV, SN, модель или производителя техники для приёмки с аренды.', {
        attachments: mechanicKeyboard(),
        mechanicStage: 'handoff',
      });
    }

    if ((lower.startsWith('/найтитехнику') || lower.startsWith('/техпоиск')) && canCreateServiceRequest) {
      const command = lower.startsWith('/техпоиск') ? '/техпоиск' : '/найтитехнику';
      const query = trimmed.slice(command.length).trim();
      if (!query) {
        updateBotSession(phone, { pendingAction: 'equipment_search', pendingPayload: { flow: 'service_ticket' } });
        return replyWithUi('🚜 Напишите следующим сообщением INV, серийный номер, модель или производителя техники.', {
          attachments: defaultKeyboardForRole(userRole),
          mechanicStage: canManageRepair ? 'ticket' : null,
        });
      }
      return handleEquipmentSearchRequest(senderId, phone, query, uiContext);
    }

    if (lower.startsWith('/создатьзаявку ') && canCreateServiceRequest) {
      return handleCreateTicketRequest(senderId, phone, authUser, trimmed.slice('/создатьзаявку'.length).trim(), uiContext);
    }

    if ((lower === '/моясводка' || lower === 'моя сводка') && isRentalManager) {
      return replyWithUi(withBotMenu(buildManagerMorningSummaryMessage(authUser), ['мои аренды', 'свободная техника', 'новая доставка']), {
        attachments: managerSummaryKeyboard(),
      });
    }

    if ((lower === '/новаядоставка' || lower === 'новая доставка') && isRentalManager) {
      resetBotFlow(phone);
      updateBotSession(phone, {
        pendingAction: 'manager_delivery_type',
        pendingPayload: { managerDeliveryDraft: {} },
      });
      return replyWithUi('🚚 Выберите тип доставки.', {
        attachments: createDeliveryTypeKeyboard(),
      });
    }

    if ((lower === '/выезд' || lower === 'выезд') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return replyWithUi('ℹ️ Сначала откройте текущую заявку: /ремонт ID', {
          attachments: mechanicKeyboard(),
          mechanicStage: 'repairs',
        });
      }
      const activeTrip = getActiveFieldTripForRepair(ticket.id, authUser.userName);
      if (activeTrip) {
        return replyWithUi(formatFieldTripMessage(activeTrip, ticket), {
          attachments: fieldTripStatusKeyboard(activeTrip),
          mechanicStage: 'field_trip',
        });
      }
      const routes = getServiceRouteNorms();
      if (!routes.length) {
        updateBotSession(phone, {
          activeRepairId: ticket.id,
          pendingAction: 'field_trip_manual_route',
          pendingPayload: { serviceTicketId: ticket.id },
        });
        return replyWithUi(
          `🚐 ${ticket.id}\n${ticket.equipment}\n\nСправочник маршрутов пока пуст. Напишите маршрут вручную в формате: Казань → Алабуга`,
          {
            attachments: keyboard([[button('Назад', 'menu:repair_actions'), button('Главное меню', 'menu:main')]]),
            mechanicStage: 'field_trip',
          },
        );
      }
      updateBotSession(phone, {
        activeRepairId: ticket.id,
        pendingAction: 'field_trip_route_pick',
        pendingPayload: { serviceTicketId: ticket.id },
      });
      return replyWithUi(
        [
          `🚐 Выезд по заявке ${ticket.id}`,
          ticket.equipment,
          '',
          'Выберите маршрут из справочника или введите вручную.',
          'Нормо-часы будут рассчитаны автоматически по формуле км / 70.',
        ].join('\n'),
        {
          attachments: fieldTripRouteKeyboard(routes),
          mechanicStage: 'field_trip',
        },
      );
    }

    if (lower.startsWith('/вработу ') && canManageRepair) {
      const repairId = trimmed.slice('/вработу'.length).trim();
      const ticket = findServiceTicketById(repairId);
      if (!ticket) {
        return sendMessage(senderId, '❌ Заявка не найдена. Используйте /моизаявки или /сервис.');
      }
      const mechanicRef = getMechanicReferenceByUser(authUser);
      const assignedName = mechanicRef?.name || authUser.userName;
      const updated = appendServiceLog({
        ...ticket,
        assignedTo: assignedName,
        assignedMechanicId: mechanicRef?.id || ticket.assignedMechanicId,
        assignedMechanicName: assignedName,
      }, `Механик ${assignedName} взял заявку в работу через MAX`, assignedName, 'assign');
      saveServiceTicket(updated);
      const withStatus = updateServiceTicketStatus(updated, 'in_progress', assignedName, 'Заявка взята в работу через MAX');
      setCurrentRepair(phone, withStatus.id);
      return replyWithUi(withBotMenu([
        `✅ Заявка ${withStatus.id} взята в работу`,
        `${withStatus.equipment}`,
        `Причина: ${withStatus.reason}`,
        '',
        'Можно сразу работать в чате.',
      ].join('\n'), ['итог', 'работы гидравлика', 'запчасти фильтр', 'черновик', 'готово']), {
        attachments: currentRepairKeyboard(withStatus.id),
        mechanicStage: 'repair',
      });
    }

    if (lower.startsWith('/ремонт ') && canManageRepair) {
      const repairId = trimmed.slice('/ремонт'.length).trim();
      const ticket = findServiceTicketById(repairId);
      if (!ticket) {
        return replyWithUi('❌ Заявка не найдена. Выберите заявку из списка ниже или откройте /моизаявки.', {
          attachments: serviceTicketsKeyboard(authUser) || mechanicKeyboard(),
          mechanicStage: 'repairs',
        });
      }
      setCurrentRepair(phone, ticket.id);
      return replyWithUi(withBotMenu([
        `🛠 Текущая заявка: ${ticket.id}`,
        `${ticket.equipment}`,
        `Причина: ${ticket.reason}`,
        `Статус: ${serviceStatusLabel(ticket.status)}`,
        '',
        'Теперь можно работать по заявке.',
      ].join('\n'), ['итог', 'работы поиск', 'запчасти поиск', 'черновик']), {
        attachments: currentRepairKeyboard(ticket.id),
        mechanicStage: 'repair',
      });
    }

    if (lower === '/ремонт' && canManageRepair) {
      return replyWithUi(formatServiceForUser(authUser, 'assigned'), {
        attachments: serviceTicketsKeyboard(authUser) || mechanicKeyboard(),
        mechanicStage: 'repairs',
      });
    }

    if (lower === '/черновик' && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return replyWithUi('ℹ️ Сначала выберите заявку: /ремонт ID или /вработу ID', {
          attachments: serviceTicketsKeyboard(authUser) || mechanicKeyboard(),
          mechanicStage: 'repairs',
        });
      }
      return replyWithUi(formatCurrentRepairDraft(ticket), {
        attachments: currentRepairKeyboard(ticket.id),
        mechanicStage: 'repair',
      });
    }

    if (lower === '/сброс' && (canManageRepair || isRentalManager || canCreateServiceRequest)) {
      const operationId = getBotSession(phone).pendingPayload?.operationSessionId;
      if (operationId) {
        const operation = getOperationSessionById(operationId);
        if (operation && operation.status === 'in_progress') {
          saveOperationSession({
            ...operation,
            status: 'cancelled',
            completedAt: nowIso(),
          });
        }
      }
      clearBotSession(phone);
      return replyWithUi(
        isRentalManager
          ? '🧹 Текущий сценарий сброшен. Можно снова открыть сводку, аренды или создать новую доставку.'
          : '🧹 Текущая заявка сброшена. Выберите новую из списка ниже или откройте /моизаявки.',
        {
          attachments: isRentalManager ? managerSummaryKeyboard() : (serviceTicketsKeyboard(authUser) || mechanicKeyboard()),
          mechanicStage: isRentalManager ? null : 'main',
        },
      );
    }

    if (lower.startsWith('/итог ') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      return handleSummaryRequest(senderId, phone, authUser, ticket, trimmed.slice('/итог'.length).trim(), uiContext);
    }

    if ((lower === '/итог' || lower === 'итог') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      return handleSummaryRequest(senderId, phone, authUser, ticket, '', uiContext);
    }

    if (lower.startsWith('/работы') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      const query = trimmed.slice('/работы'.length).trim();
      if (!query) {
        return promptWorkSearch(senderId, phone, ticket, uiContext);
      }
      return handleWorkSearchRequest(senderId, phone, ticket, query, uiContext);
    }

    if (lower.startsWith('/добавитьработу ') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      return handleAddWorkRequest(senderId, phone, authUser, ticket, trimmed.slice('/добавитьработу'.length).trim(), uiContext);
    }

    if (lower.startsWith('/запчасти') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      const query = trimmed.slice('/запчасти'.length).trim();
      if (!query) {
        return handlePartSearchRequest(senderId, phone, ticket, '', uiContext);
      }
      return handlePartSearchRequest(senderId, phone, ticket, query, uiContext);
    }

    if ((lower === '/фотодо' || lower === 'фото до') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      return handleRepairPhotoRequest(senderId, phone, ticket, 'before', uiContext);
    }

    if ((lower === '/фотопосле' || lower === 'фото после') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      return handleRepairPhotoRequest(senderId, phone, ticket, 'after', uiContext);
    }

    if (lower.startsWith('/добавитьзапчасть ') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      return handleAddPartRequest(senderId, phone, authUser, ticket, trimmed.slice('/добавитьзапчасть'.length).trim(), uiContext);
    }

    if (lower === '/ожидание' && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      updateServiceTicketStatus(ticket, 'waiting_parts', authUser.userName, 'Заявка переведена в ожидание запчастей через MAX');
      return replyWithUi(`🟠 ${ticket.id} переведена в статус «Ожидание запчастей»`, {
        attachments: currentRepairKeyboard(ticket.id),
        mechanicStage: 'parts',
      });
    }

    if (lower === '/готово' && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      const updated = updateServiceTicketStatus(ticket, 'ready', authUser.userName, 'Работы завершены через MAX');
      return replyWithUi(withBotMenu([
        `✅ Заявка ${updated.id} переведена в статус «Готово»`,
        'Теперь бригадир может проверить работу в программе и либо закрыть заявку, либо вернуть её на доработку.',
        'Если нужно, можно посмотреть отчет: /черновик',
      ].join('\n'), ['черновик', 'мои заявки', 'меню']), {
        attachments: currentRepairKeyboard(updated.id),
        mechanicStage: 'complete',
      });
    }

    if (lower === '/закрыть' && canManageRepair) {
      return replyWithUi(
        'ℹ️ Финальное закрытие из бота отключено. Переведите заявку в статус «Готово», а бригадир закроет её в программе или вернёт на доработку.',
        {
          attachments: currentRepairKeyboard(getCurrentRepair(phone)?.id || ''),
          mechanicStage: 'complete',
        },
      );
    }

    if ((lower === '/мойдень' || lower === '/отчётзадень' || lower === '/отчетзадень' || lower === 'отчёт за день' || lower === 'отчет за день') && canManageRepair) {
      return replyWithUi(withBotMenu(formatMechanicDayReport(authUser), ['мои заявки', 'черновик', 'меню']), {
        attachments: mechanicKeyboard(),
        mechanicStage: 'main',
      });
    }

    if (lower === '/помощь' || lower === '/help' || lower === 'помощь') {
      return replyWithUi(getHelpText(userRole), {
        attachments: defaultKeyboardForRole(userRole),
      });
    }

    return sendMessage(senderId, '❓ Неизвестная команда. Напишите /помощь для списка команд.');
  }

  return {
    withBotMenu,
    buildManagerMorningSummaryMessage,
    getDefaultKeyboardForRole: defaultKeyboardForRole,
    handleBotStarted,
    handleCommand,
    handleCallback,
  };
}

module.exports = {
  createBotHandlers,
};
