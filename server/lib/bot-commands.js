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
  } = deps;

  function button(text, payload) {
    return {
      type: 'callback',
      text,
      payload,
    };
  }

  function keyboard(rows) {
    return [{
      type: 'inline_keyboard',
      payload: {
        buttons: rows,
      },
    }];
  }

  function backAndMainRow(backPayload = 'menu:main', backText = 'Назад') {
    return [button(backText, backPayload), button('Главное меню', 'menu:main')];
  }

  function authKeyboard() {
    return keyboard([
      [button('Войти', 'auth:start')],
      [button('Помощь', 'menu:help')],
    ]);
  }

  function mechanicKeyboard() {
    return keyboard([
      [button('Мои заявки', 'menu:myrepairs'), button('Новая заявка', 'menu:new_ticket')],
      [button('Найти технику', 'menu:find_equipment'), button('Черновик', 'menu:draft')],
      [button('Отгрузка', 'menu:shipout'), button('Приёмка', 'menu:receivein')],
      [button('Итог', 'menu:summary'), button('Готово', 'menu:ready')],
      [button('Закрыть', 'menu:close'), button('Отчёт за день', 'menu:day_report')],
      [button('Помощь', 'menu:help')],
    ]);
  }

  function currentRepairKeyboard(ticketId = '') {
    return keyboard([
      [button('Черновик', 'menu:draft'), button('Итог', 'menu:summary')],
      [button('Работы', 'menu:works'), button('Запчасти', 'menu:parts')],
      [button('Фото ДО', 'menu:repair_before'), button('Фото ПОСЛЕ', 'menu:repair_after')],
      [button('Готово', 'menu:ready'), button('Ожидание', 'menu:waiting')],
      [button('Закрыть', ticketId ? `ticket:close:${ticketId}` : 'menu:close'), button('Назад', 'menu:myrepairs')],
      [button('Главное меню', 'menu:main')],
      [button('Мои заявки', 'menu:myrepairs'), button('Отчёт за день', 'menu:day_report')],
    ]);
  }

  const REPAIR_REASON_TEMPLATES = [
    { key: 'hydraulic_leak', text: 'Течь гидравлики' },
    { key: 'no_lift', text: 'Не поднимается платформа' },
    { key: 'electrics_fault', text: 'Неисправность электрики' },
    { key: 'no_charge', text: 'Не заряжается' },
    { key: 'control_fault', text: 'Неисправность пульта управления' },
    { key: 'return_inspection', text: 'Осмотр после возврата с аренды' },
  ];

  const REPAIR_REASON_BY_KEY = Object.fromEntries(
    REPAIR_REASON_TEMPLATES.map(item => [item.key, item.text]),
  );

  const HANDOFF_CHECKLIST_LABELS = {
    exterior: 'Внешний осмотр выполнен',
    controlPanel: 'Пульт проверен',
    batteryCharge: 'АКБ / заряд проверены',
    basket: 'Люлька / рабочая платформа проверены',
    tires: 'Колёса / шины осмотрены',
    leaksAndDamage: 'Течи / повреждения осмотрены',
  };

  const CHECKLIST_STEP_TO_KEY = {
    checklist_exterior: 'exterior',
    checklist_controlPanel: 'controlPanel',
    checklist_batteryCharge: 'batteryCharge',
    checklist_basket: 'basket',
    checklist_tires: 'tires',
    checklist_leaksAndDamage: 'leaksAndDamage',
  };

  const CHECKLIST_STEPS = Object.keys(CHECKLIST_STEP_TO_KEY);

  const REPAIR_CLOSE_CHECKLIST_LABELS = {
    faultEliminated: 'Неисправность устранена',
    worksRecorded: 'Работы внесены в отчёт',
    partsRecordedOrNotRequired: 'Запчасти внесены или не требовались',
    beforePhotosAttached: 'Фото ДО приложены',
    afterPhotosAttached: 'Фото ПОСЛЕ приложены',
    summaryFilled: 'Итог ремонта заполнен',
  };

  const REPAIR_CLOSE_CHECKLIST_ORDER = [
    'faultEliminated',
    'worksRecorded',
    'partsRecordedOrNotRequired',
    'beforePhotosAttached',
    'afterPhotosAttached',
    'summaryFilled',
  ];

  const OPERATION_STEP_META = {
    checklist_exterior: { kind: 'check', label: 'внешний осмотр', prompt: 'Подтвердите: внешний осмотр выполнен' },
    checklist_controlPanel: { kind: 'check', label: 'пульт', prompt: 'Подтвердите: пульт проверен' },
    checklist_batteryCharge: { kind: 'check', label: 'АКБ / заряд', prompt: 'Подтвердите: АКБ / заряд проверены' },
    checklist_basket: { kind: 'check', label: 'люлька', prompt: 'Подтвердите: люлька / рабочая платформа проверены' },
    checklist_tires: { kind: 'check', label: 'колёса / шины', prompt: 'Подтвердите: колёса / шины осмотрены' },
    checklist_leaksAndDamage: { kind: 'check', label: 'течи / повреждения', prompt: 'Подтвердите: течи / повреждения осмотрены' },
    front: { kind: 'photo', label: 'фото спереди', prompt: 'Сделайте фото техники спереди' },
    rear: { kind: 'photo', label: 'фото сзади', prompt: 'Теперь сделайте фото техники сзади' },
    side_1: { kind: 'photo', label: 'первое фото сбоку', prompt: 'Сделайте первое фото сбоку' },
    side_2: { kind: 'photo', label: 'второе фото сбоку', prompt: 'Сделайте второе фото сбоку' },
    plate: { kind: 'photo', label: 'фото шильдика', prompt: 'Сделайте фото шильдика' },
    hours_photo: { kind: 'photo', label: 'фото моточасов', prompt: 'Сделайте фото моточасов' },
    hours_value: { kind: 'number', label: 'моточасы', prompt: 'Введите моточасы числом' },
    control_panel: { kind: 'photo', label: 'фото пульта', prompt: 'Сделайте фото пульта' },
    basket: { kind: 'photo', label: 'фото люльки', prompt: 'Сделайте фото люльки / рабочей платформы' },
    engine_bay: { kind: 'photo', label: 'фото подкапотного пространства', prompt: 'Сделайте фото подкапотного пространства' },
    damage_photo: { kind: 'photo', label: 'фото повреждений', prompt: 'Сделайте фото повреждений' },
    damage_text: { kind: 'text', label: 'описание повреждений', prompt: 'Опишите повреждения текстом' },
  };

  const SHIPPING_OPERATION_STEPS = [
    ...CHECKLIST_STEPS,
    'front',
    'rear',
    'side_1',
    'side_2',
    'plate',
    'hours_photo',
    'hours_value',
    'control_panel',
    'basket',
    'engine_bay',
  ];

  const RECEIVING_OPERATION_STEPS = [
    ...SHIPPING_OPERATION_STEPS,
    'damage_photo',
    'damage_text',
  ];

  function repairReasonKeyboard() {
    const buttons = REPAIR_REASON_TEMPLATES.map(item =>
      button(item.text, `reason:${item.key}`),
    );
    return keyboard([
      ...chunkButtons(buttons, 2),
      [button('Своя причина', 'reason:custom')],
      backAndMainRow('menu:new_ticket'),
    ]);
  }

  function quantityKeyboard(kind) {
    return keyboard([
      [
        button('1', `qty:${kind}:1`),
        button('2', `qty:${kind}:2`),
        button('3', `qty:${kind}:3`),
        button('5', `qty:${kind}:5`),
      ],
      [button('Ввести руками', `qty:${kind}:manual`)],
      backAndMainRow(kind === 'work' ? 'menu:works' : 'menu:parts'),
    ]);
  }

  function operationKeyboard(operation, isReview = false) {
    const operationId = operation?.id || '';
    if (!operationId) return null;
    if (isReview) {
      return keyboard([
        [button('Завершить', `operation:complete:${operationId}`)],
        [button('Назад', `operation:back:${operationId}`), button('Отменить', `operation:cancel:${operationId}`)],
        [button('Главное меню', 'menu:main')],
      ]);
    }
    const stepMeta = OPERATION_STEP_META[operation.currentStep];
    if (stepMeta?.kind === 'check') {
      return keyboard([
        [button('Подтвердить', `operation:check:${operationId}`)],
        [button('Назад', `operation:back:${operationId}`), button('Отменить', `operation:cancel:${operationId}`)],
        [button('Главное меню', 'menu:main')],
      ]);
    }
    return keyboard([
      [button('Назад', `operation:back:${operationId}`), button('Отменить', `operation:cancel:${operationId}`)],
      [button('Главное меню', 'menu:main')],
    ]);
  }

  function chunkButtons(items, rowSize = 2) {
    const rows = [];
    for (let i = 0; i < items.length; i += rowSize) {
      rows.push(items.slice(i, i + rowSize));
    }
    return rows;
  }

  function defaultKeyboardForRole(role) {
    if (role === 'Механик' || role === 'Администратор') {
      return mechanicKeyboard();
    }
    return keyboard([
      [button('Аренды', 'menu:rentals'), button('Техника', 'menu:equipment')],
      [button('Сервис', 'menu:service'), button('Помощь', 'menu:help')],
    ]);
  }

  function extractMessageId(payload) {
    return payload?.message?.message_id ||
      payload?.message?.mid ||
      payload?.message?.id ||
      payload?.message_id ||
      payload?.mid ||
      payload?.id ||
      null;
  }

  async function cleanupPreviousBotMessage(phone, preserveMessageId = null) {
    if (!phone) return;
    const session = getBotSession(phone);
    const previousMessageId = session.lastBotMessageId;
    if (!previousMessageId || previousMessageId === preserveMessageId) return;
    try {
      await deleteMessage(previousMessageId);
    } catch (error) {
      // Не блокируем сценарий, если MAX не дал удалить старое сообщение.
    }
  }

  async function rememberBotMessage(phone, payload, fallbackMessageId = null) {
    if (!phone) return;
    const messageId = fallbackMessageId || extractMessageId(payload);
    if (!messageId) return;
    updateBotSession(phone, { lastBotMessageId: messageId });
  }

  async function reply(target, text, options = {}) {
    const {
      attachments,
      phone = '',
      callbackContext = null,
      replaceMessage = false,
      cleanupPrevious = false,
      notification = null,
    } = options;

    if (replaceMessage && callbackContext?.callbackId) {
      const payload = await answerCallback(callbackContext.callbackId, {
        ...(notification ? { notification: { text: notification } } : {}),
        message: {
          text,
          ...(attachments ? { attachments } : {}),
        },
      });
      await rememberBotMessage(phone, payload, callbackContext.messageId || null);
      return payload;
    }

    if (callbackContext?.callbackId && notification) {
      await answerCallback(callbackContext.callbackId, {
        notification: { text: notification },
      });
    }

    if (cleanupPrevious && phone) {
      await cleanupPreviousBotMessage(phone, callbackContext?.messageId || null);
    }

    const payload = await sendMessage(target, text, {
      ...(attachments ? { attachments } : {}),
    });
    await rememberBotMessage(phone, payload);
    return payload;
  }

  function withBotMenu(text, lines = []) {
    const footer = lines.length
      ? `\n\nБыстро:\n${lines.map(line => `• ${line}`).join('\n')}`
      : '';
    return `${text}${footer}`;
  }

  async function handleBotStarted(senderId, phone, payload) {
    const payloadLine = payload ? `\nPayload: ${payload}` : '';
    updateBotSession(phone, {
      pendingAction: null,
      pendingPayload: null,
    });
    return reply(
      senderId,
      withBotMenu(
        `👋 Добро пожаловать в бот «Подъёмники»!${payloadLine}\n\nНажмите «Войти», затем бот по шагам попросит логин и пароль.`,
        ['если хотите вручную: /start email@company.ru пароль'],
      ),
      { attachments: authKeyboard(), phone, cleanupPrevious: true },
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

  function getAuthorizedUser(phone) {
    return getBotUsers()[phone] || null;
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

  function getOperationSteps(type) {
    return type === 'receiving' ? RECEIVING_OPERATION_STEPS : SHIPPING_OPERATION_STEPS;
  }

  function createEmptyOperationPhotos() {
    return {
      front: [],
      rear: [],
      side_1: [],
      side_2: [],
      plate: [],
      hours_photo: [],
      control_panel: [],
      basket: [],
      engine_bay: [],
      damage_photo: [],
    };
  }

  function createEmptyOperationChecklist() {
    return {
      exterior: false,
      controlPanel: false,
      batteryCharge: false,
      basket: false,
      tires: false,
      leaksAndDamage: false,
    };
  }

  function createEmptyRepairPhotos() {
    return {
      before: [],
      after: [],
      beforeUploadedAt: null,
      beforeUploadedBy: '',
      afterUploadedAt: null,
      afterUploadedBy: '',
    };
  }

  function createEmptyRepairCloseChecklist() {
    return {
      faultEliminated: false,
      worksRecorded: false,
      partsRecordedOrNotRequired: false,
      beforePhotosAttached: false,
      afterPhotosAttached: false,
      summaryFilled: false,
    };
  }

  function normalizeRepairPhotos(ticket) {
    return {
      ...createEmptyRepairPhotos(),
      ...(ticket?.repairPhotos || {}),
      before: Array.isArray(ticket?.repairPhotos?.before) ? ticket.repairPhotos.before : [],
      after: Array.isArray(ticket?.repairPhotos?.after) ? ticket.repairPhotos.after : [],
    };
  }

  function buildRepairCloseChecklistStatus(ticket, overrides = {}) {
    const workItems = (readData('repair_work_items') || []).filter(item => item.repairId === ticket.id);
    const repairPhotos = normalizeRepairPhotos(ticket);
    const summary = String(ticket.resultData?.summary || ticket.result || '').trim();
    const base = createEmptyRepairCloseChecklist();

    return {
      ...base,
      ...(ticket.closeChecklist || {}),
      ...overrides,
      worksRecorded: Boolean(workItems.length),
      beforePhotosAttached: repairPhotos.before.length > 0,
      afterPhotosAttached: repairPhotos.after.length > 0,
      summaryFilled: Boolean(summary),
    };
  }

  function nextMissingRepairCloseChecklistKey(checklist) {
    return REPAIR_CLOSE_CHECKLIST_ORDER.find(key => !checklist?.[key]) || null;
  }

  function repairCloseChecklistKeyboard(ticket, checklist) {
    const nextKey = nextMissingRepairCloseChecklistKey(checklist);
    const actionRows = [];

    if (nextKey === 'faultEliminated' || nextKey === 'partsRecordedOrNotRequired') {
      actionRows.push([button(`Подтвердить: ${REPAIR_CLOSE_CHECKLIST_LABELS[nextKey]}`, `repairclose:confirm:${ticket.id}:${nextKey}`)]);
    } else if (nextKey === 'worksRecorded') {
      actionRows.push([button('Перейти к работам', 'menu:works')]);
    } else if (nextKey === 'beforePhotosAttached') {
      actionRows.push([button('Загрузить фото ДО', 'menu:repair_before')]);
    } else if (nextKey === 'afterPhotosAttached') {
      actionRows.push([button('Загрузить фото ПОСЛЕ', 'menu:repair_after')]);
    } else if (nextKey === 'summaryFilled') {
      actionRows.push([button('Заполнить итог', 'menu:summary')]);
    } else {
      actionRows.push([button('Закрыть заявку', `repairclose:complete:${ticket.id}`)]);
    }

    return keyboard([
      ...actionRows,
      [button('Назад', 'menu:draft'), button('Отменить', `repairclose:cancel:${ticket.id}`)],
      [button('Главное меню', 'menu:main')],
    ]);
  }

  function formatRepairCloseChecklist(ticket, checklist) {
    const lines = REPAIR_CLOSE_CHECKLIST_ORDER.map((key, index) => {
      const done = Boolean(checklist?.[key]);
      const icon = done ? '✅' : '⬜️';
      return `${index + 1}. ${icon} ${REPAIR_CLOSE_CHECKLIST_LABELS[key]}`;
    });
    const nextKey = nextMissingRepairCloseChecklistKey(checklist);
    const nextHint = nextKey
      ? `Следующий шаг: ${REPAIR_CLOSE_CHECKLIST_LABELS[nextKey]}`
      : 'Все пункты выполнены. Можно закрывать заявку.';

    return [
      `📋 Чек-лист закрытия ${ticket.id}`,
      `${ticket.equipment}`,
      '',
      ...lines,
      '',
      nextHint,
    ].join('\n');
  }

  function appendRepairPhotos(ticket, phase, photoUrls, author) {
    const repairPhotos = normalizeRepairPhotos(ticket);
    const now = nowIso();
    const nextPhotos = {
      ...repairPhotos,
      [phase]: [...repairPhotos[phase], ...photoUrls],
      [`${phase}UploadedAt`]: now,
      [`${phase}UploadedBy`]: author,
    };
    const actionLabel = phase === 'before' ? 'до ремонта' : 'после ремонта';
    return appendServiceLog({
      ...ticket,
      repairPhotos: nextPhotos,
    }, `Добавлены фото ${actionLabel} через MAX (${photoUrls.length})`, author, 'repair_result');
  }

  function formatMechanicDayReport(authUser) {
    const today = nowIso().slice(0, 10);
    const normalizeName = normalizeBotText(authUser.userName);
    const tickets = readServiceTickets();
    const workItems = readData('repair_work_items') || [];
    const partItems = readData('repair_part_items') || [];

    const myTickets = tickets.filter(ticket =>
      normalizeBotText(ticket.assignedMechanicName) === normalizeName ||
      ticket.workLog?.some(entry => normalizeBotText(entry.author) === normalizeName)
    );

    const closedToday = myTickets.filter(ticket =>
      ticket.status === 'closed' &&
      String(ticket.closedAt || '').startsWith(today) &&
      normalizeBotText(ticket.assignedMechanicName) === normalizeName
    );
    const readyToday = myTickets.filter(ticket =>
      ticket.workLog?.some(entry =>
        String(entry.date || '').startsWith(today) &&
        normalizeBotText(entry.author) === normalizeName &&
        /готов|завершен/i.test(entry.text || '')
      )
    );
    const takenToday = myTickets.filter(ticket =>
      ticket.workLog?.some(entry =>
        String(entry.date || '').startsWith(today) &&
        normalizeBotText(entry.author) === normalizeName &&
        /взял заявку в работу/i.test(entry.text || '')
      )
    );

    const myWorkItems = workItems.filter(item =>
      String(item.createdAt || '').startsWith(today) &&
      normalizeBotText(item.createdByUserName) === normalizeName
    );
    const myPartItems = partItems.filter(item =>
      String(item.createdAt || '').startsWith(today) &&
      normalizeBotText(item.createdByUserName) === normalizeName
    );

    const myRepairPhotos = myTickets.reduce((acc, ticket) => {
      const repairPhotos = normalizeRepairPhotos(ticket);
      const beforeToday = String(repairPhotos.beforeUploadedAt || '').startsWith(today) &&
        normalizeBotText(repairPhotos.beforeUploadedBy) === normalizeName;
      const afterToday = String(repairPhotos.afterUploadedAt || '').startsWith(today) &&
        normalizeBotText(repairPhotos.afterUploadedBy) === normalizeName;
      return {
        before: acc.before + (beforeToday ? repairPhotos.before.length : 0),
        after: acc.after + (afterToday ? repairPhotos.after.length : 0),
      };
    }, { before: 0, after: 0 });

    const totalNormHours = myWorkItems.reduce((sum, item) => sum + ((Number(item.normHoursSnapshot) || 0) * (Number(item.quantity) || 0)), 0);
    const totalPartsCost = myPartItems.reduce((sum, item) => sum + ((Number(item.priceSnapshot) || 0) * (Number(item.quantity) || 0)), 0);
    const lastClosedLines = closedToday.slice(0, 5).map(ticket => `• ${ticket.id} · ${ticket.equipment}`);

    return [
      `📊 Быстрый отчёт за день`,
      `Механик: ${authUser.userName}`,
      `Дата: ${today}`,
      '',
      `Взято в работу: ${takenToday.length}`,
      `Переведено в «Готово»: ${readyToday.length}`,
      `Закрыто заявок: ${closedToday.length}`,
      `Добавлено работ: ${myWorkItems.length} · ${totalNormHours.toLocaleString('ru-RU')} н/ч`,
      `Добавлено запчастей: ${myPartItems.length} · ${totalPartsCost.toLocaleString('ru-RU')} ₽`,
      `Фото ДО: ${myRepairPhotos.before}`,
      `Фото ПОСЛЕ: ${myRepairPhotos.after}`,
      '',
      closedToday.length ? `Последние закрытые:\n${lastClosedLines.join('\n')}` : 'Сегодня закрытых заявок пока нет.',
    ].join('\n');
  }

  function getOperationSessions() {
    return readData('equipment_operation_sessions') || [];
  }

  function writeOperationSessions(sessions) {
    writeData('equipment_operation_sessions', sessions);
  }

  function getOperationSessionById(operationId) {
    return getOperationSessions().find(item => item.id === operationId) || null;
  }

  function saveOperationSession(operation) {
    const sessions = getOperationSessions();
    const next = sessions.some(item => item.id === operation.id)
      ? sessions.map(item => item.id === operation.id ? operation : item)
      : [...sessions, operation];
    writeOperationSessions(next);
    return operation;
  }

  function createOperationSession(type, equipment, authUser) {
    const steps = getOperationSteps(type);
    const operation = {
      id: generateId(`${idPrefixes.shipping_photos}_OP`),
      type,
      status: 'in_progress',
      equipmentId: equipment.id,
      createdByUserId: authUser.userId,
      createdByUserName: authUser.userName,
      startedAt: nowIso(),
      completedAt: null,
      currentStep: steps[0],
      steps: steps.map(step => ({
        key: step,
        status: 'pending',
        completedAt: null,
      })),
      photos: createEmptyOperationPhotos(),
      checklist: createEmptyOperationChecklist(),
      hoursValue: null,
      damageDescription: '',
      source: 'bot',
    };
    return saveOperationSession(operation);
  }

  function getOperationStepIndex(operation, stepKey = operation.currentStep) {
    return getOperationSteps(operation.type).findIndex(step => step === stepKey);
  }

  function getOperationStepPrompt(operation) {
    const steps = getOperationSteps(operation.type);
    const stepIndex = getOperationStepIndex(operation);
    const stepKey = operation.currentStep;
    const meta = OPERATION_STEP_META[stepKey];
    if (!meta || stepIndex < 0) return 'Сценарий не найден.';
    const equipment = (readData('equipment') || []).find(item => item.id === operation.equipmentId);
    const operationLabel = operation.type === 'receiving' ? 'Приёмка' : 'Отгрузка';
    const lines = [
      `${operation.type === 'receiving' ? '📥' : '🚚'} ${operationLabel}: ${equipment ? formatEquipmentForBot(equipment) : operation.equipmentId}`,
      '',
      `Шаг ${stepIndex + 1} из ${steps.length}. ${meta.prompt}`,
    ];
    if (stepKey === 'hours_value') {
      lines.push('Пример: 1542');
    }
    if (meta.kind === 'check') {
      const checklistKey = CHECKLIST_STEP_TO_KEY[stepKey];
      const checklistLabel = checklistKey ? HANDOFF_CHECKLIST_LABELS[checklistKey] : meta.label;
      lines.push(`Пункт чек-листа: ${checklistLabel}`);
      lines.push('Нажмите «Подтвердить», когда проверка выполнена.');
    }
    if (stepKey === 'damage_text') {
      lines.push('Пример: Трещина на кожухе, потертости на люльке');
    }
    lines.push('', 'Можно нажать «Назад» или «Отменить».');
    return lines.join('\n');
  }

  function getOperationSummary(operation) {
    const equipment = (readData('equipment') || []).find(item => item.id === operation.equipmentId);
    const steps = getOperationSteps(operation.type);
    const completedPhotoCount = Object.values(operation.photos || {}).reduce((sum, value) => sum + (Array.isArray(value) && value.length ? 1 : 0), 0);
    return [
      `${operation.type === 'receiving' ? '📥' : '🚚'} ${operation.type === 'receiving' ? 'Приёмка' : 'Отгрузка'} почти завершена`,
      equipment ? formatEquipmentForBot(equipment) : operation.equipmentId,
      `Моточасы: ${operation.hoursValue ?? 'не указаны'}`,
      `Чек-лист: ${Object.values(operation.checklist || {}).every(Boolean) ? 'заполнен' : 'не заполнен'}`,
      `Фото-категорий заполнено: ${completedPhotoCount} из ${steps.filter(step => OPERATION_STEP_META[step]?.kind === 'photo').length}`,
      operation.type === 'receiving'
        ? `Повреждения: ${operation.damageDescription ? 'указаны' : 'не указаны'}`
        : 'Повреждения: не требуются',
      '',
      'Проверьте данные и завершите операцию.',
    ].join('\n');
  }

  function goToPreviousOperationStep(operation) {
    const steps = getOperationSteps(operation.type);
    if (operation.currentStep === 'review') {
      return saveOperationSession({
        ...operation,
        currentStep: steps[steps.length - 1],
      });
    }
    const index = getOperationStepIndex(operation);
    if (index <= 0) return null;
    const previousStep = steps[index - 1];
    return saveOperationSession({
      ...operation,
      currentStep: previousStep,
    });
  }

  function normalizeBotText(value) {
    return String(value || '').trim().toLowerCase();
  }

  function botSearchMatches(haystack, query) {
    const text = normalizeBotText(haystack);
    const normalizedQuery = normalizeBotText(query);
    if (!normalizedQuery) return true;
    const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
    return tokens.every(token => {
      if (text.includes(token)) return true;
      if (token.length >= 5 && text.includes(token.slice(0, -1))) return true;
      if (token.length >= 6 && text.includes(token.slice(0, -2))) return true;
      return false;
    });
  }

  function formatTicketLine(ticket) {
    const assigned = ticket.assignedMechanicName ? ` · ${ticket.assignedMechanicName}` : '';
    return `• ${ticket.id} · ${serviceStatusLabel(ticket.status)} · ${ticket.equipment}\n  ${ticket.reason}${assigned}`;
  }

  function formatCurrentRepairDraft(ticket) {
    const workItems = (readData('repair_work_items') || []).filter(item => item.repairId === ticket.id);
    const partItems = (readData('repair_part_items') || []).filter(item => item.repairId === ticket.id);
    const summary = ticket.resultData?.summary || ticket.result || 'не заполнен';
    const repairPhotos = normalizeRepairPhotos(ticket);
    const closeChecklist = buildRepairCloseChecklistStatus(ticket);
    const worksText = workItems.length
      ? workItems.map((item, index) => `${index + 1}. ${item.nameSnapshot} × ${item.quantity}`).join('\n')
      : 'нет';
    const partsText = partItems.length
      ? partItems.map((item, index) => `${index + 1}. ${item.nameSnapshot} × ${item.quantity} (${Number(item.priceSnapshot || 0).toLocaleString('ru-RU')} ₽)`).join('\n')
      : 'нет';

    return [
      `🧾 Текущий отчет по ${ticket.id}`,
      `${ticket.equipment}`,
      `Статус: ${serviceStatusLabel(ticket.status)}`,
      `Итог: ${summary}`,
      `Фото ДО: ${repairPhotos.before.length}`,
      `Фото ПОСЛЕ: ${repairPhotos.after.length}`,
      `Чек-лист закрытия: ${REPAIR_CLOSE_CHECKLIST_ORDER.filter(key => closeChecklist[key]).length}/${REPAIR_CLOSE_CHECKLIST_ORDER.length}`,
      '',
      `Работы:\n${worksText}`,
      '',
      `Запчасти:\n${partsText}`,
    ].join('\n');
  }

  function getAccessibleServiceTickets(authUser) {
    const tickets = readServiceTickets();
    if (authUser.userRole === 'Механик') {
      return tickets.filter(ticket =>
        ticket.status !== 'closed' &&
        (
          !ticket.assignedMechanicName ||
          normalizeBotText(ticket.assignedMechanicName) === normalizeBotText(authUser.userName)
        )
      );
    }
    return tickets.filter(ticket => ticket.status !== 'closed');
  }

  function getAssignedServiceTickets(authUser) {
    const tickets = readServiceTickets();
    if (authUser.userRole !== 'Механик') {
      return tickets.filter(ticket => ticket.status !== 'closed');
    }
    return tickets.filter(ticket =>
      ticket.status !== 'closed' &&
      normalizeBotText(ticket.assignedMechanicName) === normalizeBotText(authUser.userName)
    );
  }

  function formatServiceForUser(authUser, mode = 'accessible') {
    const tickets = mode === 'assigned'
      ? getAssignedServiceTickets(authUser)
      : getAccessibleServiceTickets(authUser);
    if (!tickets.length) {
      return mode === 'assigned'
        ? '✅ У вас нет назначенных сервисных заявок.'
        : '✅ Открытых сервисных заявок нет.';
    }

    const lines = tickets.slice(0, 10).map(formatTicketLine);
    return [
      authUser.userRole === 'Механик' && mode === 'assigned'
        ? `🧰 Мои сервисные заявки (${tickets.length}):`
        : authUser.userRole === 'Механик'
        ? `🔧 Доступные вам сервисные заявки (${tickets.length}):`
        : `🔧 Открытые сервисные заявки (${tickets.length}):`,
      ...lines,
      '',
      mode === 'assigned'
        ? 'Подсказка: /ремонт ID'
        : 'Подсказка: /вработу ID или /ремонт ID',
      tickets.length > 10 ? `... и ещё ${tickets.length - 10}` : '',
    ].filter(Boolean).join('\n');
  }

  function serviceTicketsKeyboard(authUser) {
    const tickets = getAssignedServiceTickets(authUser).slice(0, 6);
    if (!tickets.length) return null;
    const buttons = tickets.map(ticket =>
      button(`Открыть ${ticket.id}`, `ticket:open:${ticket.id}`)
    );
    return keyboard([
      ...chunkButtons(buttons, 2),
      [button('Новая заявка', 'menu:new_ticket')],
      [button('Главное меню', 'menu:main')],
    ]);
  }

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

  function searchServiceWorks(query) {
    const works = (readData('service_works') || []).filter(item => item.isActive !== false);
    if (!normalizeBotText(query)) return works.slice(0, 7);
    return works.filter(item =>
      botSearchMatches(item.name, query) ||
      botSearchMatches(item.category, query) ||
      botSearchMatches(item.description, query)
    ).slice(0, 7);
  }

  function searchSpareParts(query) {
    const parts = (readData('spare_parts') || []).filter(item => item.isActive !== false);
    if (!normalizeBotText(query)) return parts.slice(0, 7);
    return parts.filter(item =>
      botSearchMatches(item.name, query) ||
      botSearchMatches(item.article, query) ||
      botSearchMatches(item.category, query) ||
      botSearchMatches(item.manufacturer, query)
    ).slice(0, 7);
  }

  function searchEquipmentForBot(query) {
    const equipment = readData('equipment') || [];
    if (!normalizeBotText(query)) return equipment.slice(0, 7);
    return equipment.filter(item =>
      botSearchMatches(item.inventoryNumber, query) ||
      botSearchMatches(item.serialNumber, query) ||
      botSearchMatches(item.manufacturer, query) ||
      botSearchMatches(item.model, query) ||
      botSearchMatches(item.location, query)
    ).slice(0, 7);
  }

  function extractPhotoUrlsFromMessage(messageMeta) {
    const attachments = messageMeta?.attachments
      || messageMeta?.body?.attachments
      || [];
    const list = Array.isArray(attachments) ? attachments : [];
    const urls = [];

    for (const item of list) {
      const maybe =
        item?.url ||
        item?.payload?.url ||
        item?.photo?.url ||
        item?.image?.url ||
        item?.file?.url ||
        item?.preview_url ||
        item?.payload?.photo?.url;
      if (typeof maybe === 'string' && maybe.trim()) {
        urls.push(maybe.trim());
      }
    }

    return urls;
  }

  function createServiceTicketFromBot(equipment, authUser, reason, description = '') {
    const now = new Date().toISOString();
    const mechanicRef = getMechanicReferenceByUser(authUser);
    const assignedName = mechanicRef?.name || authUser.userName;
    const newTicket = {
      id: generateId(idPrefixes.service),
      equipmentId: equipment.id,
      equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
      inventoryNumber: equipment.inventoryNumber,
      serialNumber: equipment.serialNumber,
      equipmentType: equipment.type,
      equipmentTypeLabel: equipment.type,
      location: equipment.location,
      reason,
      description: description || reason,
      priority: 'medium',
      sla: '24 ч',
      assignedTo: assignedName,
      assignedMechanicId: mechanicRef?.id,
      assignedMechanicName: assignedName,
      createdBy: authUser.userName,
      createdByUserId: authUser.userId,
      createdByUserName: authUser.userName,
      reporterContact: authUser.userName,
      source: 'bot',
      status: 'in_progress',
      result: '',
      resultData: {
        summary: '',
        partsUsed: [],
        worksPerformed: [],
      },
      repairPhotos: createEmptyRepairPhotos(),
      closeChecklist: createEmptyRepairCloseChecklist(),
      workLog: [
        {
          date: now,
          text: 'Заявка создана через MAX',
          author: authUser.userName,
          type: 'status_change',
        },
        {
          date: now,
          text: `Механик ${assignedName} взял заявку в работу через MAX`,
          author: assignedName,
          type: 'assign',
        },
      ],
      parts: [],
      createdAt: now,
    };

    writeServiceTickets([...readServiceTickets(), newTicket]);
    syncEquipmentStatusForService(newTicket, 'in_progress');
    return newTicket;
  }

  function createReturnInspectionTicketFromBot(equipment, authUser, activeRental, photoUrls, comment = '') {
    const now = new Date().toISOString();
    const openExisting = getOpenTicketByEquipment(equipment);
    if (openExisting) return openExisting;

    const newTicket = {
      id: generateId(idPrefixes.service),
      equipmentId: equipment.id,
      equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
      inventoryNumber: equipment.inventoryNumber,
      serialNumber: equipment.serialNumber,
      equipmentType: equipment.type,
      equipmentTypeLabel: equipment.type,
      location: equipment.location,
      reason: 'Приёмка с аренды',
      description: comment
        ? `Техника принята с аренды. Комментарий: ${comment}`
        : 'Техника принята с аренды, требуется осмотр и дефектовка после возврата.',
      priority: 'medium',
      sla: '24 ч',
      assignedTo: undefined,
      assignedMechanicId: undefined,
      assignedMechanicName: undefined,
      createdBy: authUser.userName,
      createdByUserId: authUser.userId,
      createdByUserName: authUser.userName,
      reporterContact: activeRental?.client || authUser.userName,
      source: 'bot',
      status: 'new',
      result: '',
      resultData: {
        summary: '',
        partsUsed: [],
        worksPerformed: [],
      },
      repairPhotos: createEmptyRepairPhotos(),
      closeChecklist: createEmptyRepairCloseChecklist(),
      workLog: [
        {
          date: now,
          text: 'Заявка автоматически создана после приёмки техники с аренды через MAX',
          author: authUser.userName,
          type: 'status_change',
        },
      ],
      parts: [],
      createdAt: now,
      photos: photoUrls,
    };

    writeServiceTickets([...readServiceTickets(), newTicket]);
    syncEquipmentStatusForService(newTicket, 'new');
    return newTicket;
  }

  function appendEquipmentHistoryEntry(equipment, entry) {
    return {
      ...equipment,
      history: [
        ...(Array.isArray(equipment.history) ? equipment.history : []),
        entry,
      ],
    };
  }

  function completeBotEquipmentOperation(operation, authUser) {
    const equipmentList = readData('equipment') || [];
    const equipment = equipmentList.find(item => item.id === operation.equipmentId);
    if (!equipment) {
      throw new Error('Техника для операции не найдена');
    }

    const rentals = readData('gantt_rentals') || [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const now = nowIso();
    const activeRental = rentals.find(r =>
      r.equipmentId === equipment.id &&
      (r.status === 'active' || r.status === 'created')
    ) || null;

    const flattenedPhotos = Object.values(operation.photos || {}).flat();
    const eventType = operation.type === 'receiving' ? 'receiving' : 'shipping';
    const comment = operation.type === 'receiving'
      ? operation.damageDescription || undefined
      : undefined;
    const events = readData('shipping_photos') || [];
    const newEvent = {
      id: generateId(idPrefixes.shipping_photos),
      equipmentId: equipment.id,
      date: todayStr,
      type: eventType,
      uploadedBy: authUser.userName,
      photos: flattenedPhotos,
      comment,
      rentalId: activeRental?.id,
      source: 'bot',
      photoCategories: operation.photos,
      checklist: operation.checklist,
      hoursValue: operation.hoursValue,
      damageDescription: operation.type === 'receiving' ? operation.damageDescription : undefined,
      operationSessionId: operation.id,
    };
    writeData('shipping_photos', [...events, newEvent]);

    const operationSummary = operation.type === 'receiving'
      ? `Выполнена приёмка с аренды через MAX. Моточасы: ${operation.hoursValue}. Повреждения: ${operation.damageDescription}`
      : `Выполнена отгрузка в аренду через MAX. Моточасы: ${operation.hoursValue}`;

    const nextEquipment = equipmentList.map(item => {
      if (item.id !== equipment.id) return item;
      const base = appendEquipmentHistoryEntry(item, {
        date: now,
        author: authUser.userName,
        type: 'system',
        text: operationSummary,
      });

      if (operation.type === 'shipping') {
        return {
          ...base,
          hours: operation.hoursValue,
          status: 'rented',
          currentClient: activeRental?.client || item.currentClient,
          returnDate: activeRental?.endDate || item.returnDate,
        };
      }

      return {
        ...base,
        hours: operation.hoursValue,
        status: 'in_service',
        currentClient: undefined,
        returnDate: undefined,
      };
    });
    writeData('equipment', nextEquipment);

    const nextRentals = rentals.map(rental => {
      if (rental.id !== activeRental?.id) return rental;
      if (operation.type === 'shipping' && rental.status === 'created') {
        return {
          ...rental,
          status: 'active',
          comments: [
            ...(rental.comments || []),
            { date: now, text: `Техника отгружена клиенту через MAX. Моточасы: ${operation.hoursValue}`, author: authUser.userName },
          ],
        };
      }
      if (operation.type === 'receiving' && (rental.status === 'active' || rental.status === 'created')) {
        return {
          ...rental,
          status: 'returned',
          endDate: todayStr,
          comments: [
            ...(rental.comments || []),
            { date: now, text: `Техника принята с аренды через MAX. Моточасы: ${operation.hoursValue}. Повреждения: ${operation.damageDescription}`, author: authUser.userName },
          ],
        };
      }
      return rental;
    });
    writeData('gantt_rentals', nextRentals);

    const createdServiceTicket = operation.type === 'receiving'
      ? createReturnInspectionTicketFromBot(
        equipment,
        authUser,
        activeRental,
        flattenedPhotos,
        operation.damageDescription,
      )
      : null;

    const completedOperation = saveOperationSession({
      ...operation,
      status: 'completed',
      completedAt: now,
      currentStep: 'review',
      updatedAt: now,
    });

    return {
      operation: completedOperation,
      event: newEvent,
      activeRental,
      createdServiceTicket,
    };
  }

  function saveBotShippingPhotoEvent(equipment, authUser, type, photoUrls, comment = '') {
    const events = readData('shipping_photos') || [];
    const rentals = readData('gantt_rentals') || [];
    const todayStr = new Date().toISOString().slice(0, 10);
    const now = nowIso();
    const activeRental = rentals.find(r =>
      r.equipmentId === equipment.id &&
      (r.status === 'active' || r.status === 'created')
    ) || null;

    const newEvent = {
      id: generateId(idPrefixes.shipping_photos),
      equipmentId: equipment.id,
      date: todayStr,
      type,
      uploadedBy: authUser.userName,
      photos: photoUrls,
      comment: comment || undefined,
      rentalId: activeRental?.id,
      source: 'bot',
    };
    writeData('shipping_photos', [...events, newEvent]);

    const equipmentList = readData('equipment') || [];
    const nextEquipment = equipmentList.map(item => {
      if (item.id !== equipment.id) return item;
      if (type === 'shipping') {
        return {
          ...item,
          status: 'rented',
          currentClient: activeRental?.client || item.currentClient,
          returnDate: activeRental?.endDate || item.returnDate,
        };
      }
      return {
        ...item,
        status: 'in_service',
        currentClient: undefined,
        returnDate: undefined,
      };
    });
    writeData('equipment', nextEquipment);

    const nextRentals = rentals.map(rental => {
      if (rental.id !== activeRental?.id) return rental;
      if (type === 'shipping' && rental.status === 'created') {
        return {
          ...rental,
          status: 'active',
          comments: [
            ...(rental.comments || []),
            { date: now, text: 'Техника отгружена клиенту через MAX, добавлен фотоотчёт', author: authUser.userName },
          ],
        };
      }
      if (type === 'receiving' && (rental.status === 'active' || rental.status === 'created')) {
        return {
          ...rental,
          status: 'returned',
          endDate: todayStr,
          comments: [
            ...(rental.comments || []),
            { date: now, text: 'Техника принята с аренды через MAX, добавлен фотоотчёт', author: authUser.userName },
          ],
        };
      }
      return rental;
    });
    writeData('gantt_rentals', nextRentals);

    const createdServiceTicket = type === 'receiving'
      ? createReturnInspectionTicketFromBot(equipment, authUser, activeRental, photoUrls, comment)
      : null;

    return {
      event: newEvent,
      activeRental,
      createdServiceTicket,
    };
  }

  function addRepairWorkItemFromCatalog(ticket, work, quantity, authUser = null) {
    const items = readData('repair_work_items') || [];
    const nextItem = {
      id: generateId(idPrefixes.repair_work_items),
      repairId: ticket.id,
      workId: work.id,
      quantity,
      normHoursSnapshot: Math.max(0, Number(work.normHours) || 0),
      nameSnapshot: work.name,
      categorySnapshot: work.category,
      createdAt: nowIso(),
      createdByUserId: authUser?.userId,
      createdByUserName: authUser?.userName,
    };
    items.push(nextItem);
    writeData('repair_work_items', items);
    return nextItem;
  }

  function addRepairPartItemFromCatalog(ticket, part, quantity, priceSnapshot, authUser = null) {
    const items = readData('repair_part_items') || [];
    const nextItem = {
      id: generateId(idPrefixes.repair_part_items),
      repairId: ticket.id,
      partId: part.id,
      quantity,
      priceSnapshot,
      nameSnapshot: part.name,
      articleSnapshot: part.article || part.sku,
      unitSnapshot: part.unit || 'шт',
      createdAt: nowIso(),
      createdByUserId: authUser?.userId,
      createdByUserName: authUser?.userName,
    };
    items.push(nextItem);
    writeData('repair_part_items', items);
    return nextItem;
  }

  function formatRentals(rentals, managerName, role) {
    const filtered = role === 'Менеджер по аренде'
      ? rentals.filter(r => r.manager === managerName && (r.status === 'active' || r.status === 'created'))
      : rentals.filter(r => r.status === 'active' || r.status === 'created');

    if (!filtered.length) return '📋 Активных аренд нет.';

    const lines = filtered.slice(0, 10).map(rental => {
      const end = rental.endDate ? `до ${rental.endDate}` : '';
      return `• ${rental.equipmentInv} → ${rental.client} ${end}`.trim();
    });

    const header = role === 'Менеджер по аренде'
      ? `📋 Ваши активные аренды (${filtered.length}):`
      : `📋 Все активные аренды (${filtered.length}):`;

    return [header, ...lines, filtered.length > 10 ? `... и ещё ${filtered.length - 10}` : '']
      .filter(Boolean)
      .join('\n');
  }

  function formatEquipment(equipment) {
    const free = equipment.filter(item => item.status === 'available');
    if (!free.length) return '🚧 Свободной техники нет.';

    const lines = free.slice(0, 10).map(item =>
      `• ${item.inventoryNumber} — ${item.model} (${item.type === 'scissor' ? 'Ножничный' : item.type === 'articulated' ? 'Коленчатый' : 'Телескопический'})`
    );

    return [`🟢 Свободная техника (${free.length}):`, ...lines,
      free.length > 10 ? `... и ещё ${free.length - 10}` : ''].filter(Boolean).join('\n');
  }

  function formatEquipmentForBot(item) {
    const typeLabel =
      item.type === 'scissor' ? 'ножничный'
        : item.type === 'articulated' ? 'коленчатый'
        : item.type === 'telescopic' ? 'телескопический'
        : 'подъёмник';

    return [
      item.inventoryNumber || 'без INV',
      `${item.manufacturer || ''} ${item.model || ''}`.trim(),
      item.serialNumber ? `SN ${item.serialNumber}` : '',
      typeLabel,
    ].filter(Boolean).join(' · ');
  }

  function equipmentSearchKeyboard(matches) {
    if (!matches.length) return null;
    const buttons = matches.slice(0, 6).map((item, index) =>
      button(`${index + 1}. ${item.inventoryNumber || item.model || 'Техника'}`, `equipment:choose:${item.id}`),
    );
    return keyboard([
      ...chunkButtons(buttons, 2),
      [button('Новый поиск', 'menu:find_equipment')],
      [button('Назад', 'menu:main')],
    ]);
  }

  function workSearchKeyboard(matches) {
    if (!matches.length) return null;
    const buttons = matches.slice(0, 6).map((item, index) =>
      button(`${index + 1}. ${item.name}`, `work:choose:${item.id}`),
    );
    return keyboard([
      ...chunkButtons(buttons, 2),
      [button('Новый поиск работ', 'menu:works')],
      backAndMainRow('menu:draft'),
    ]);
  }

  function partSearchKeyboard(matches) {
    if (!matches.length) return null;
    const buttons = matches.slice(0, 6).map((item, index) =>
      button(`${index + 1}. ${item.name}`, `part:choose:${item.id}`),
    );
    return keyboard([
      ...chunkButtons(buttons, 2),
      [button('Новый поиск запчастей', 'menu:parts')],
      backAndMainRow('menu:draft'),
    ]);
  }

  function formatService(tickets) {
    const open = tickets.filter(item => item.status !== 'closed');
    if (!open.length) return '✅ Открытых заявок нет.';

    const priorityIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '⚪' };
    const lines = open.slice(0, 10).map(item => {
      const icon = priorityIcon[item.priority] || '⚪';
      return `${icon} ${item.id} — ${item.equipment}: ${item.reason}`;
    });

    return [`🔧 Открытые сервисные заявки (${open.length}):`, ...lines,
      open.length > 10 ? `... и ещё ${open.length - 10}` : ''].filter(Boolean).join('\n');
  }

  async function handleEquipmentSearchRequest(senderId, phone, query, uiContext = {}) {
    const matches = searchEquipmentForBot(query);
    const session = getBotSession(phone);
    const flow = session.pendingPayload?.flow;
    const photoEventType = session.pendingPayload?.photoEventType;
    if (!matches.length) {
      updateBotSession(phone, {
        pendingAction: 'equipment_search',
        pendingPayload: flow === 'photo_event' ? { flow, photoEventType } : null,
      });
      return sendMessage(
        senderId,
        withBotMenu(
          '🔎 Техника не найдена. Напишите INV, SN, модель или производителя ещё раз.',
          ['пример: 083', 'пример: B200063918', 'отмена: /сброс'],
        ),
      );
    }
    updateBotSession(phone, {
      lastEquipmentSearch: matches.map(item => ({
        id: item.id,
        inventoryNumber: item.inventoryNumber,
        serialNumber: item.serialNumber,
        model: item.model,
      })),
      pendingAction: flow === 'photo_event' ? 'equipment_search' : 'ticket_reason',
      pendingPayload: flow === 'photo_event' ? { flow, photoEventType } : null,
    });
    const isPhotoFlow = flow === 'photo_event';
    return reply(senderId, withBotMenu([
      '🚜 Найденная техника:',
      ...matches.map((item, index) => `${index + 1}. ${formatEquipmentForBot(item)}`),
      '',
      'Можно нажать кнопку с техникой ниже.',
      isPhotoFlow
        ? `После выбора начнётся пошаговая ${photoEventType === 'shipping' ? 'отгрузка' : 'приёмка'}.`
        : 'После выбора я предложу типовые причины ремонта.',
    ].join('\n'), ['новый поиск: найти технику', 'отмена: /сброс']), {
      attachments: equipmentSearchKeyboard(matches),
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
        return reply(senderId, '❌ Напишите причину обращения одним сообщением. Например: течь гидравлики');
      }
    } else {
      const firstSpace = selectionText.indexOf(' ');
      if (firstSpace <= 0) {
        updateBotSession(phone, { pendingAction: 'ticket_reason', pendingPayload: null });
        return reply(senderId, '❌ Формат: НОМЕР причина. Пример: 1 Течь гидравлики');
      }
      const index = Number(selectionText.slice(0, firstSpace).trim());
      reason = selectionText.slice(firstSpace + 1).trim();
      const lastEquipmentSearch = Array.isArray(session.lastEquipmentSearch) ? session.lastEquipmentSearch : [];
      if (!Number.isInteger(index) || index <= 0 || index > lastEquipmentSearch.length) {
        return reply(senderId, '❌ Неверный номер техники. Сначала выполните поиск заново.');
      }
      if (!reason) {
        return reply(senderId, '❌ Укажите причину обращения после номера техники.');
      }
      const selected = lastEquipmentSearch[index - 1];
      equipment = (readData('equipment') || []).find(item => item.id === selected.id);
    }
    if (!equipment) {
      return reply(senderId, '❌ Техника больше не найдена в системе. Выполните поиск заново.');
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
      ].join('\n'), ['черновик', 'работы гидравлика', 'запчасти фильтр', 'готово', 'закрыть']), {
        attachments: currentRepairKeyboard(existingOpenTicket.id),
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
      return sendMessage(senderId, '🔎 По этому запросу активные работы не найдены. Напишите другой запрос.');
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
        ? 'Нажмите кнопку с работой ниже, чтобы сразу выбрать количество.'
        : 'Показываю популярные работы. Можно сразу нажать кнопку или выполнить новый текстовый поиск.',
    ].join('\n'), ['новый поиск работ', 'черновик', 'отмена: /сброс']), {
      attachments: workSearchKeyboard(matches),
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handleAddWorkRequest(senderId, phone, authUser, ticket, selectionText, uiContext = {}) {
    const [firstRaw, secondRaw] = selectionText.trim().split(/\s+/);
    const session = getBotSession(phone);
    const selectedWorkId = session.pendingPayload?.selectedWorkId;
    const quantity = Number(selectedWorkId ? firstRaw : secondRaw);
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return reply(senderId, '❌ Количество работы должно быть числом больше 0.');
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
    const updated = appendServiceLog(ticket, `Добавлена работа через MAX: ${work.name} × ${quantity}`, authUser.userName, 'repair_result');
    saveServiceTicket(updated);
    resetBotFlow(phone);
    return reply(senderId, withBotMenu(`✅ Добавлена работа: ${work.name} × ${quantity}`, ['ещё работы', 'запчасти', 'черновик', 'готово']), {
      attachments: currentRepairKeyboard(ticket.id),
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
      return sendMessage(senderId, '🔎 По этому запросу активные запчасти не найдены. Напишите другой запрос.');
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
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handleSummaryRequest(senderId, phone, authUser, ticket, summary, uiContext = {}) {
    if (!summary) {
      updateBotSession(phone, { pendingAction: 'summary', activeRepairId: ticket.id });
      return reply(senderId, '📝 Напишите следующим сообщением итог ремонта одним текстом.');
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
    }, 'Обновлён итог ремонта через MAX', authUser.userName, 'repair_result');
    saveServiceTicket(updated);
    resetBotFlow(phone);
    return reply(senderId, withBotMenu(`✅ Итог ремонта сохранён для ${ticket.id}`, ['работы', 'запчасти', 'черновик', 'готово']), {
      attachments: currentRepairKeyboard(ticket.id),
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
      phone,
      callbackContext: uiContext.callbackContext,
      replaceMessage: Boolean(uiContext.callbackContext),
      cleanupPrevious: !uiContext.callbackContext,
    });
  }

  async function handleCallback(senderId, phone, payload, callbackContext = null) {
    const normalized = String(payload || '').trim();

    if (normalized === 'auth:start') {
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
      updateBotSession(phone, {
        pendingAction: 'equipment_search',
        pendingPayload: null,
        lastEquipmentSearch: [],
      });
      return reply(
        senderId,
        '🚜 Напишите следующим сообщением INV, серийный номер, модель или производителя техники.',
        {
          attachments: mechanicKeyboard(),
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
          phone,
          callbackContext,
          replaceMessage: true,
        });
      }
      return reply(senderId, getOperationStepPrompt(updated), {
        attachments: operationKeyboard(updated),
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
        phone,
        callbackContext,
        replaceMessage: true,
      });
    }

    const map = {
      'menu:help': '/помощь',
      'menu:main': '/меню',
      'menu:rentals': '/аренды',
      'menu:equipment': '/техника',
      'menu:service': '/сервис',
      'menu:myrepairs': '/моизаявки',
      'menu:new_ticket': '/новаязаявка',
      'menu:find_equipment': '/найтитехнику',
      'menu:shipout': '/отгрузка',
      'menu:receivein': '/приёмка',
      'menu:draft': '/черновик',
      'menu:summary': '/итог',
      'menu:repair_before': '/фотодо',
      'menu:repair_after': '/фотопосле',
      'menu:day_report': '/мойдень',
      'menu:works': '/работы',
      'menu:parts': '/запчасти',
      'menu:ready': '/готово',
      'menu:waiting': '/ожидание',
      'menu:close': '/закрыть',
    };

    if (normalized.startsWith('ticket:open:')) {
      const ticketId = normalized.slice('ticket:open:'.length);
      return handleCommand(senderId, phone, `/ремонт ${ticketId}`, {}, { callbackContext, replaceMessage: true });
    }

    if (normalized.startsWith('ticket:take:')) {
      const ticketId = normalized.slice('ticket:take:'.length);
      return handleCommand(senderId, phone, `/вработу ${ticketId}`, {}, { callbackContext, replaceMessage: true });
    }

    if (normalized.startsWith('ticket:close:')) {
      const ticketId = normalized.slice('ticket:close:'.length);
      const current = getCurrentRepair(phone);
      if (!current || current.id !== ticketId) {
        setCurrentRepair(phone, ticketId);
      }
      return handleCommand(senderId, phone, '/закрыть', {}, { callbackContext, replaceMessage: true });
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
        return reply(senderId, '❌ Техника больше не найдена. Выполните поиск заново.', {
          attachments: mechanicKeyboard(),
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

      updateBotSession(phone, {
        pendingAction: 'ticket_reason',
        pendingPayload: { selectedEquipmentId: equipment.id },
      });
      return reply(
        senderId,
        [
          `🚜 Выбрана техника:`,
          formatEquipmentForBot(equipment),
          '',
          'Выберите типовую причину кнопкой ниже или нажмите «Своя причина».',
        ].join('\n'),
        {
          attachments: repairReasonKeyboard(),
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
        });
      }
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return reply(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID', {
          attachments: mechanicKeyboard(),
        });
      }
      updateBotSession(phone, {
        activeRepairId: ticket.id,
        pendingAction: 'work_pick',
        pendingPayload: { selectedWorkId: work.id },
      });
      return reply(
        senderId,
        `🧰 Выбрана работа:\n${work.name}\n\nВыберите количество кнопкой ниже или нажмите «Ввести руками».`,
        {
          attachments: quantityKeyboard('work'),
          phone,
          callbackContext,
          replaceMessage: true,
        },
      );
    }

    if (normalized.startsWith('part:choose:')) {
      const partId = normalized.slice('part:choose:'.length);
      const part = (readData('spare_parts') || []).find(item => item.id === partId && item.isActive !== false);
      if (!part) {
        return reply(senderId, '❌ Запчасть больше недоступна. Выполните поиск запчастей заново.', {
          attachments: currentRepairKeyboard(getCurrentRepair(phone)?.id || ''),
        });
      }
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return reply(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID', {
          attachments: mechanicKeyboard(),
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
            phone,
            callbackContext,
            replaceMessage: true,
          },
        );
      }
      if (!currentReason) {
        return reply(senderId, '❌ Причина не распознана. Выберите кнопку ещё раз.', {
          attachments: repairReasonKeyboard(),
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
        });
      }

      if (value === 'manual') {
        if (kind === 'work') {
          return reply(senderId, '🧰 Напишите количество работы одним числом. Например: 2', {
            attachments: currentRepairKeyboard(ticket.id),
            phone,
            callbackContext,
            replaceMessage: true,
          });
        }
        if (kind === 'part') {
          return reply(senderId, '📦 Напишите: КОЛИЧЕСТВО [ЦЕНА]\nПример: 2 3500\nЕсли цену не указывать, возьмётся базовая.', {
            attachments: currentRepairKeyboard(ticket.id),
            phone,
            callbackContext,
            replaceMessage: true,
          });
        }
      }

      if (!['1', '2', '3', '5'].includes(value || '')) {
        return reply(senderId, '❌ Количество не распознано.', {
          attachments: currentRepairKeyboard(ticket.id),
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
      phone,
      callbackContext,
      replaceMessage: true,
    });
  }

  function getHelpText(role) {
    const lines = [
      '',
      '📱 Доступные команды:',
      '',
      `  /аренды    — активные аренды${role === 'Менеджер по аренде' ? ' (только ваши)' : ''}`,
      '  /техника   — свободная техника',
      '  /сервис    — открытые сервисные заявки',
    ];

    if (role === 'Механик' || role === 'Администратор') {
      lines.push(
        '  /моизаявки             — мои заявки в сервисе',
        '  /найтитехнику поиск    — найти технику для ремонта',
        '  /создатьзаявку № причина — открыть ремонт по технике',
        '  /вработу ID           — взять заявку в работу',
        '  /ремонт ID            — выбрать текущую заявку',
        '  /итог текст           — сохранить итог ремонта',
        '  /работы [поиск]       — выбрать или найти работы в справочнике',
        '  /добавитьработу № qty — добавить работу в отчет',
        '  /запчасти [поиск]     — выбрать или найти запчасти в справочнике',
        '  /добавитьзапчасть № qty [цена] — добавить запчасть',
        '  /черновик             — показать текущий отчет',
        '  /фотодо               — приложить фото до ремонта',
        '  /фотопосле            — приложить фото после ремонта',
        '  /отгрузка             — пошаговая отгрузка с фото',
        '  /приёмка              — пошаговая приёмка с фото',
        '  /мойдень              — быстрый отчёт механика за день',
        '  /ожидание             — ожидание запчастей',
        '  /готово               — работы завершены',
        '  /закрыть              — закрыть заявку по чек-листу',
        '  /сброс                — сбросить текущую заявку',
      );
    }

    lines.push('  /помощь    — этот список');
    return lines.join('\n');
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

    console.log('[TRACE] handleCommand senderId=%s phone=%s text=%s', senderId, phone, text);

    if (lower.startsWith('/start')) {
      console.log('[TRACE] /start matched, parts=%d', parts.length);
      if (parts.length < 3) {
        updateBotSession(phone, { pendingAction: 'login_email', pendingPayload: null });
        return reply(
          senderId,
          '👤 Напишите логин (email) следующим сообщением.',
          { attachments: keyboard([backAndMainRow('menu:cancel_login')]), phone, callbackContext, replaceMessage: Boolean(uiContext.replaceMessage), cleanupPrevious: !callbackContext },
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
        withBotMenu(
          `✅ Вы вошли как ${user.name} (${user.role})\n${getHelpText(user.role)}`,
          ['меню', 'мои заявки', 'новая заявка'],
        ),
        { attachments: defaultKeyboardForRole(user.role) },
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
          withBotMenu(
            `✅ Вы вошли как ${user.name} (${user.role})`,
            ['мои заявки', 'новая заявка', 'черновик'],
          ),
          { attachments: defaultKeyboardForRole(user.role) },
        );
      }
    }

    const authUser = getAuthorizedUser(String(phone));
    if (!authUser) {
      return reply(senderId,
        '🔒 Вы не авторизованы.\n\nНажмите «Войти», и я попрошу логин и пароль по шагам.',
        { attachments: authKeyboard() },
      );
    }

    const botUsers = getBotUsers();
    botUsers[String(phone)] = {
      ...authUser,
      replyTarget: normalizeReplyTarget(senderId, phone),
    };
    saveBotUsers(botUsers);

    const { userName, userRole } = authUser;
    const canManageRepair = userRole === 'Механик' || userRole === 'Администратор';

    if (!trimmed.startsWith('/') && canManageRepair) {
      const currentTicket = getCurrentRepair(phone);
      if (session.pendingAction === 'equipment_search') {
        return handleEquipmentSearchRequest(senderId, phone, trimmed, uiContext);
      }
      if (session.pendingAction === 'ticket_reason') {
        return handleCreateTicketRequest(senderId, phone, authUser, trimmed, uiContext);
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
      });
    }

    if ((lower === '/моизаявки' || lower === '/myrepairs' || lower === 'мои заявки') && canManageRepair) {
      return replyWithUi(formatServiceForUser(authUser, 'assigned'), {
        attachments: serviceTicketsKeyboard(authUser) || mechanicKeyboard(),
      });
    }

    if ((lower === '/меню' || lower === 'меню') && canManageRepair) {
      return replyWithUi(
        withBotMenu(getHelpText(userRole), ['мои заявки', 'новая заявка', 'черновик']),
        { attachments: defaultKeyboardForRole(userRole) },
      );
    }

    if ((lower === '/новаязаявка' || lower === 'новая заявка' || lower === 'создать заявку') && canManageRepair) {
      updateBotSession(phone, {
        pendingAction: 'equipment_search',
        pendingPayload: null,
        lastEquipmentSearch: [],
      });
      return replyWithUi('🚜 Напишите следующим сообщением INV, серийный номер, модель или производителя техники.');
    }

    if ((lower === '/отгрузка' || lower === 'отгрузка') && canManageRepair) {
      updateBotSession(phone, {
        pendingAction: 'equipment_search',
        pendingPayload: { flow: 'photo_event', photoEventType: 'shipping' },
        lastEquipmentSearch: [],
      });
      return replyWithUi('🚚 Напишите INV, SN, модель или производителя техники для отгрузки.', {
        attachments: mechanicKeyboard(),
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
      });
    }

    if ((lower.startsWith('/найтитехнику') || lower.startsWith('/техпоиск')) && canManageRepair) {
      const command = lower.startsWith('/техпоиск') ? '/техпоиск' : '/найтитехнику';
      const query = trimmed.slice(command.length).trim();
      if (!query) {
        updateBotSession(phone, { pendingAction: 'equipment_search', pendingPayload: null });
        return replyWithUi('🚜 Напишите следующим сообщением INV, серийный номер, модель или производителя техники.');
      }
      return handleEquipmentSearchRequest(senderId, phone, query, uiContext);
    }

    if (lower.startsWith('/создатьзаявку ') && canManageRepair) {
      return handleCreateTicketRequest(senderId, phone, authUser, trimmed.slice('/создатьзаявку'.length).trim(), uiContext);
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
      });
    }

    if (lower.startsWith('/ремонт ') && canManageRepair) {
      const repairId = trimmed.slice('/ремонт'.length).trim();
      const ticket = findServiceTicketById(repairId);
      if (!ticket) {
        return sendMessage(senderId, '❌ Заявка не найдена.');
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
      });
    }

    if (lower === '/черновик' && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID или /вработу ID');
      }
      return sendMessage(senderId, formatCurrentRepairDraft(ticket));
    }

    if (lower === '/сброс' && canManageRepair) {
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
      return sendMessage(senderId, '🧹 Текущая заявка сброшена. Выберите новую через /ремонт ID');
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
        return handleWorkSearchRequest(senderId, phone, ticket, '', uiContext);
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
        'Если нужно, можно ещё закрыть её командой /закрыть',
        'Или посмотреть отчет: /черновик',
      ].join('\n'), ['черновик', 'закрыть', 'мои заявки']), {
        attachments: currentRepairKeyboard(updated.id),
      });
    }

    if (lower === '/закрыть' && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      const sessionChecklist = getBotSession(phone).pendingPayload?.closeChecklistDraft || {};
      const checklist = buildRepairCloseChecklistStatus(ticket, sessionChecklist);
      const missingKey = nextMissingRepairCloseChecklistKey(checklist);
      if (missingKey) {
        return startRepairCloseChecklist(senderId, phone, ticket, uiContext);
      }
      const updated = updateServiceTicketStatus({
        ...ticket,
        closeChecklist: checklist,
      }, 'closed', authUser.userName, 'Заявка закрыта через MAX');
      clearBotSession(phone);
      return replyWithUi(withBotMenu(`✅ Заявка ${updated.id} закрыта.`, ['мои заявки', 'новая заявка', 'меню']), {
        attachments: mechanicKeyboard(),
      });
    }

    if ((lower === '/мойдень' || lower === '/отчётзадень' || lower === '/отчетзадень' || lower === 'отчёт за день' || lower === 'отчет за день') && canManageRepair) {
      return replyWithUi(withBotMenu(formatMechanicDayReport(authUser), ['мои заявки', 'черновик', 'меню']), {
        attachments: mechanicKeyboard(),
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
    handleBotStarted,
    handleCommand,
    handleCallback,
  };
}

module.exports = {
  createBotHandlers,
};
