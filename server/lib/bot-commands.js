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
      [button('Закрыть', 'menu:close'), button('Помощь', 'menu:help')],
    ]);
  }

  function currentRepairKeyboard(ticketId = '') {
    return keyboard([
      [button('Черновик', 'menu:draft'), button('Итог', 'menu:summary')],
      [button('Работы', 'menu:works'), button('Запчасти', 'menu:parts')],
      [button('Готово', 'menu:ready'), button('Ожидание', 'menu:waiting')],
      [button('Закрыть', ticketId ? `ticket:close:${ticketId}` : 'menu:close'), button('Назад', 'menu:main')],
      [button('Мои заявки', 'menu:myrepairs')],
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

  function repairReasonKeyboard() {
    const buttons = REPAIR_REASON_TEMPLATES.map(item =>
      button(item.text, `reason:${item.key}`),
    );
    return keyboard([
      ...chunkButtons(buttons, 2),
      [button('Своя причина', 'reason:custom')],
      [button('Назад', 'menu:new_ticket')],
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
      [button('Назад', kind === 'work' ? 'menu:works' : 'menu:parts')],
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

  function formatServiceForUser(authUser) {
    const tickets = getAccessibleServiceTickets(authUser);
    if (!tickets.length) return '✅ Открытых сервисных заявок нет.';

    const lines = tickets.slice(0, 10).map(formatTicketLine);
    return [
      authUser.userRole === 'Механик'
        ? `🔧 Доступные вам сервисные заявки (${tickets.length}):`
        : `🔧 Открытые сервисные заявки (${tickets.length}):`,
      ...lines,
      '',
      'Подсказка: /вработу ID или /ремонт ID',
      tickets.length > 10 ? `... и ещё ${tickets.length - 10}` : '',
    ].filter(Boolean).join('\n');
  }

  function serviceTicketsKeyboard(authUser) {
    const tickets = getAccessibleServiceTickets(authUser).slice(0, 6);
    if (!tickets.length) return null;
    const buttons = tickets.flatMap(ticket => ([
      button(`Открыть ${ticket.id}`, `ticket:open:${ticket.id}`),
      button(`В работу ${ticket.id}`, `ticket:take:${ticket.id}`),
    ]));
    return keyboard([
      ...chunkButtons(buttons, 2),
      [button('Новая заявка', 'menu:new_ticket')],
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

  function addRepairWorkItemFromCatalog(ticket, work, quantity) {
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
    };
    items.push(nextItem);
    writeData('repair_work_items', items);
    return nextItem;
  }

  function addRepairPartItemFromCatalog(ticket, part, quantity, priceSnapshot) {
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
      [button('Новый поиск', 'menu:find_equipment'), button('Назад', 'menu:main')],
    ]);
  }

  function workSearchKeyboard(matches) {
    if (!matches.length) return null;
    const buttons = matches.slice(0, 6).map((item, index) =>
      button(`${index + 1}. ${item.name}`, `work:choose:${item.id}`),
    );
    return keyboard([
      ...chunkButtons(buttons, 2),
      [button('Новый поиск работ', 'menu:works'), button('Назад', 'menu:draft')],
    ]);
  }

  function partSearchKeyboard(matches) {
    if (!matches.length) return null;
    const buttons = matches.slice(0, 6).map((item, index) =>
      button(`${index + 1}. ${item.name}`, `part:choose:${item.id}`),
    );
    return keyboard([
      ...chunkButtons(buttons, 2),
      [button('Новый поиск запчастей', 'menu:parts'), button('Назад', 'menu:draft')],
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
    if (!matches.length) {
      updateBotSession(phone, { pendingAction: 'equipment_search', pendingPayload: null });
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
      pendingAction: 'ticket_reason',
      pendingPayload: null,
    });
    return reply(senderId, withBotMenu([
      '🚜 Найденная техника:',
      ...matches.map((item, index) => `${index + 1}. ${formatEquipmentForBot(item)}`),
      '',
      'Можно нажать кнопку с техникой ниже.',
      'После выбора я предложу типовые причины ремонта.',
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
      'Можно нажать кнопку с работой ниже или ответить сообщением:',
      'НОМЕР КОЛИЧЕСТВО',
      'Пример: 1 2',
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
    addRepairWorkItemFromCatalog(ticket, work, quantity);
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
      'Можно нажать кнопку с запчастью ниже или ответить сообщением:',
      'НОМЕР КОЛИЧЕСТВО [ЦЕНА]',
      'Пример: 1 2 3500',
      'Если цену не указать, возьмётся базовая из справочника.',
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
    addRepairPartItemFromCatalog(ticket, part, quantity, price);
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

  async function handleCallback(senderId, phone, payload, callbackContext = null) {
    const normalized = String(payload || '').trim();

    if (normalized === 'auth:start') {
      updateBotSession(phone, { pendingAction: 'login_email', pendingPayload: null });
      return reply(
        senderId,
        '👤 Напишите логин (email) следующим сообщением.',
        {
          attachments: keyboard([[button('Назад', 'menu:cancel_login')]]),
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
      resetBotFlow(phone);
      return reply(senderId, '❎ Сценарий отгрузки/приёмки отменён.', {
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
        updateBotSession(phone, {
          pendingAction: 'photo_event_capture',
          pendingPayload: {
            selectedEquipmentId: equipment.id,
            photoEventType,
          },
        });
        return reply(
          senderId,
          [
            `${photoEventType === 'shipping' ? '🚚 Отгрузка' : '📥 Приёмка'}: ${formatEquipmentForBot(equipment)}`,
            '',
            'Теперь отправьте фото этой техники в чат.',
            'Можно приложить сразу несколько фото и добавить подпись комментарием.',
          ].join('\n'),
          {
            attachments: keyboard([[button('Назад', 'menu:cancel_photo_event')]]),
            phone,
            callbackContext,
            replaceMessage: true,
          },
        );
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
            attachments: keyboard([[button('Назад', 'menu:new_ticket')]]),
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
        '  /работы поиск         — найти работы в справочнике',
        '  /добавитьработу № qty — добавить работу в отчет',
        '  /запчасти поиск       — найти запчасти в справочнике',
        '  /добавитьзапчасть № qty [цена] — добавить запчасть',
        '  /черновик             — показать текущий отчет',
        '  /ожидание             — ожидание запчастей',
        '  /готово               — работы завершены',
        '  /закрыть              — закрыть заявку',
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
          { attachments: keyboard([[button('Назад', 'menu:cancel_login')]]), phone, callbackContext, replaceMessage: Boolean(uiContext.replaceMessage), cleanupPrevious: !callbackContext },
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
      if (session.pendingAction === 'photo_event_capture') {
        const authUser = getAuthorizedUser(String(phone));
        if (!authUser) {
          return reply(senderId, '🔒 Сначала авторизуйтесь.', { attachments: authKeyboard() });
        }
        const selectedEquipmentId = session.pendingPayload?.selectedEquipmentId;
        const eventType = session.pendingPayload?.photoEventType;
        const equipment = (readData('equipment') || []).find(item => item.id === selectedEquipmentId);
        const photoUrls = extractPhotoUrlsFromMessage(messageMeta);
        const commentText = trimmed || '';

        if (!equipment) {
          resetBotFlow(phone);
          return reply(senderId, '❌ Техника не найдена. Начните заново.', { attachments: mechanicKeyboard() });
        }
        if (!photoUrls.length) {
          return reply(
            senderId,
            `📷 Я жду фото для сценария «${eventType === 'shipping' ? 'Отгрузка' : 'Приёмка'}».\nМожно приложить фото и, при желании, добавить подпись текстом.`,
            { attachments: keyboard([[button('Назад', 'menu:cancel_photo_event')]]) },
          );
        }

        const result = saveBotShippingPhotoEvent(equipment, authUser, eventType, photoUrls, commentText);
        resetBotFlow(phone);

        if (eventType === 'receiving') {
          return reply(
            senderId,
            withBotMenu([
              `✅ Приёмка выполнена: ${formatEquipmentForBot(equipment)}`,
              `Фото: ${photoUrls.length}`,
              'Техника переведена в сервис.',
              result.createdServiceTicket ? `Создана сервисная заявка: ${result.createdServiceTicket.id}` : 'Открытая сервисная заявка уже существовала.',
            ].join('\n'), ['мои заявки', 'черновик', 'новая заявка']),
            { attachments: mechanicKeyboard() },
          );
        }

        return reply(
          senderId,
          withBotMenu([
            `✅ Отгрузка выполнена: ${formatEquipmentForBot(equipment)}`,
            `Фото: ${photoUrls.length}`,
            result.activeRental ? `Аренда ${result.activeRental.id} переведена в активную.` : 'Фотоотчёт сохранён в карточку техники.',
          ].join('\n'), ['мои заявки', 'найти технику']),
          { attachments: mechanicKeyboard() },
        );
      }

      if (session.pendingAction === 'login_email') {
        updateBotSession(phone, {
          pendingAction: 'login_password',
          pendingPayload: { loginEmail: trimmed },
        });
        return reply(
          senderId,
          `🔐 Логин принят: ${trimmed}\nТеперь напишите пароль следующим сообщением.`,
          { attachments: keyboard([[button('Назад', 'menu:cancel_login')]]) },
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
            { attachments: keyboard([[button('Назад', 'menu:cancel_login')]]) },
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
      return replyWithUi(formatServiceForUser(authUser), {
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
        updateBotSession(phone, { pendingAction: 'work_search', activeRepairId: ticket.id });
        return replyWithUi('🧰 Напишите следующим сообщением запрос для поиска работ. Например: гидравлика');
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
        updateBotSession(phone, { pendingAction: 'part_search', activeRepairId: ticket.id });
        return replyWithUi('📦 Напишите следующим сообщением запрос для поиска запчастей. Например: фильтр');
      }
      return handlePartSearchRequest(senderId, phone, ticket, query, uiContext);
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
      const updated = updateServiceTicketStatus(ticket, 'closed', authUser.userName, 'Заявка закрыта через MAX');
      clearBotSession(phone);
      return replyWithUi(withBotMenu(`✅ Заявка ${updated.id} закрыта.`, ['мои заявки', 'новая заявка', 'меню']), {
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
