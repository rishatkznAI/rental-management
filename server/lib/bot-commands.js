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

  function withBotMenu(text, lines = []) {
    const footer = lines.length
      ? `\n\nБыстро:\n${lines.map(line => `• ${line}`).join('\n')}`
      : '';
    return `${text}${footer}`;
  }

  async function handleBotStarted(senderId, phone, payload) {
    const payloadLine = payload ? `\nPayload: ${payload}` : '';
    return sendMessage(
      senderId,
      withBotMenu(
        `👋 Добро пожаловать в бот «Подъёмники»!${payloadLine}\n\nДля входа напишите:\n/start email@company.ru пароль`,
        ['после входа: меню', 'новая заявка', 'мои заявки'],
      ),
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

  async function handleEquipmentSearchRequest(senderId, phone, query) {
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
    return sendMessage(senderId, withBotMenu([
      '🚜 Найденная техника:',
      ...matches.map((item, index) => `${index + 1}. ${formatEquipmentForBot(item)}`),
      '',
      'Ответьте сообщением в формате:',
      'НОМЕР причина',
      'Пример: 1 Течь гидравлики',
    ].join('\n'), ['новый поиск: найти технику', 'отмена: /сброс']));
  }

  async function handleCreateTicketRequest(senderId, phone, authUser, selectionText) {
    const firstSpace = selectionText.indexOf(' ');
    if (firstSpace <= 0) {
      updateBotSession(phone, { pendingAction: 'ticket_reason' });
      return sendMessage(senderId, '❌ Формат: НОМЕР причина. Пример: 1 Течь гидравлики');
    }
    const index = Number(selectionText.slice(0, firstSpace).trim());
    const reason = selectionText.slice(firstSpace + 1).trim();
    const session = getBotSession(phone);
    const lastEquipmentSearch = Array.isArray(session.lastEquipmentSearch) ? session.lastEquipmentSearch : [];
    if (!Number.isInteger(index) || index <= 0 || index > lastEquipmentSearch.length) {
      return sendMessage(senderId, '❌ Неверный номер техники. Сначала выполните поиск заново.');
    }
    if (!reason) {
      return sendMessage(senderId, '❌ Укажите причину обращения после номера техники.');
    }
    const selected = lastEquipmentSearch[index - 1];
    const equipment = (readData('equipment') || []).find(item => item.id === selected.id);
    if (!equipment) {
      return sendMessage(senderId, '❌ Техника больше не найдена в системе. Выполните поиск заново.');
    }
    const existingOpenTicket = getOpenTicketByEquipment(equipment);
    if (existingOpenTicket) {
      setCurrentRepair(phone, existingOpenTicket.id);
      return sendMessage(senderId, withBotMenu([
        `ℹ️ По этой технике уже есть открытая заявка: ${existingOpenTicket.id}`,
        `${existingOpenTicket.equipment}`,
        `Причина: ${existingOpenTicket.reason}`,
        '',
        'Я открыл её как текущую.',
      ].join('\n'), ['черновик', 'работы гидравлика', 'запчасти фильтр', 'готово', 'закрыть']));
    }
    const ticket = createServiceTicketFromBot(equipment, authUser, reason);
    setCurrentRepair(phone, ticket.id);
    return sendMessage(senderId, withBotMenu([
      `✅ Создана заявка ${ticket.id}`,
      formatEquipmentForBot(equipment),
      `Причина: ${ticket.reason}`,
      '',
      'Заявка открыта как текущая.',
    ].join('\n'), ['итог', 'работы гидравлика', 'запчасти фильтр', 'черновик', 'готово']));
  }

  async function handleWorkSearchRequest(senderId, phone, ticket, query) {
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
    return sendMessage(senderId, withBotMenu([
      '🧰 Найденные работы:',
      ...matches.map((item, index) => `${index + 1}. ${item.name}${item.category ? ` · ${item.category}` : ''} · ${Number(item.normHours || 0).toLocaleString('ru-RU')} н/ч`),
      '',
      'Ответьте сообщением:',
      'НОМЕР КОЛИЧЕСТВО',
      'Пример: 1 2',
    ].join('\n'), ['новый поиск работ', 'черновик', 'отмена: /сброс']));
  }

  async function handleAddWorkRequest(senderId, phone, authUser, ticket, selectionText) {
    const [indexRaw, qtyRaw] = selectionText.trim().split(/\s+/);
    const index = Number(indexRaw);
    const quantity = Number(qtyRaw);
    const session = getBotSession(phone);
    const lastWorkSearch = Array.isArray(session.lastWorkSearch) ? session.lastWorkSearch : [];
    if (!Number.isInteger(index) || index <= 0 || index > lastWorkSearch.length) {
      return sendMessage(senderId, '❌ Номер работы указан неверно. Сначала выполните поиск работ.');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return sendMessage(senderId, '❌ Количество работы должно быть числом больше 0.');
    }
    const selected = lastWorkSearch[index - 1];
    const work = (readData('service_works') || []).find(item => item.id === selected.id && item.isActive !== false);
    if (!work) {
      return sendMessage(senderId, '❌ Работа больше недоступна в справочнике. Выполните поиск заново.');
    }
    addRepairWorkItemFromCatalog(ticket, work, quantity);
    const updated = appendServiceLog(ticket, `Добавлена работа через MAX: ${work.name} × ${quantity}`, authUser.userName, 'repair_result');
    saveServiceTicket(updated);
    resetBotFlow(phone);
    return sendMessage(senderId, withBotMenu(`✅ Добавлена работа: ${work.name} × ${quantity}`, ['ещё работы', 'запчасти', 'черновик', 'готово']));
  }

  async function handlePartSearchRequest(senderId, phone, ticket, query) {
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
    return sendMessage(senderId, withBotMenu([
      '📦 Найденные запчасти:',
      ...matches.map((item, index) => `${index + 1}. ${item.name}${item.article ? ` · ${item.article}` : ''} · ${Number(item.defaultPrice || 0).toLocaleString('ru-RU')} ₽/${item.unit || 'шт'}`),
      '',
      'Ответьте сообщением:',
      'НОМЕР КОЛИЧЕСТВО [ЦЕНА]',
      'Пример: 1 2 3500',
      'Если цену не указать, возьмётся базовая из справочника.',
    ].join('\n'), ['новый поиск запчастей', 'черновик', 'отмена: /сброс']));
  }

  async function handleAddPartRequest(senderId, phone, authUser, ticket, selectionText) {
    const [indexRaw, qtyRaw, priceRaw] = selectionText.trim().split(/\s+/);
    const index = Number(indexRaw);
    const quantity = Number(qtyRaw);
    const session = getBotSession(phone);
    const lastPartSearch = Array.isArray(session.lastPartSearch) ? session.lastPartSearch : [];
    if (!Number.isInteger(index) || index <= 0 || index > lastPartSearch.length) {
      return sendMessage(senderId, '❌ Номер запчасти указан неверно. Сначала выполните поиск запчастей.');
    }
    if (!Number.isFinite(quantity) || quantity <= 0) {
      return sendMessage(senderId, '❌ Количество запчасти должно быть числом больше 0.');
    }
    const selected = lastPartSearch[index - 1];
    const part = (readData('spare_parts') || []).find(item => item.id === selected.id && item.isActive !== false);
    if (!part) {
      return sendMessage(senderId, '❌ Запчасть больше недоступна в справочнике. Выполните поиск заново.');
    }
    const price = priceRaw == null ? Number(part.defaultPrice || 0) : Number(priceRaw);
    if (!Number.isFinite(price) || price < 0) {
      return sendMessage(senderId, '❌ Цена должна быть числом не меньше 0.');
    }
    addRepairPartItemFromCatalog(ticket, part, quantity, price);
    const updated = appendServiceLog(ticket, `Добавлена запчасть через MAX: ${part.name} × ${quantity}`, authUser.userName, 'repair_result');
    saveServiceTicket(updated);
    resetBotFlow(phone);
    return sendMessage(senderId, withBotMenu(`✅ Добавлена запчасть: ${part.name} × ${quantity} по ${price.toLocaleString('ru-RU')} ₽`, ['ещё запчасти', 'работы', 'черновик', 'готово']));
  }

  async function handleSummaryRequest(senderId, phone, authUser, ticket, summary) {
    if (!summary) {
      updateBotSession(phone, { pendingAction: 'summary', activeRepairId: ticket.id });
      return sendMessage(senderId, '📝 Напишите следующим сообщением итог ремонта одним текстом.');
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
    return sendMessage(senderId, withBotMenu(`✅ Итог ремонта сохранён для ${ticket.id}`, ['работы', 'запчасти', 'черновик', 'готово']));
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

    console.log('[TRACE] handleCommand senderId=%s phone=%s text=%s', senderId, phone, text);

    if (lower.startsWith('/start')) {
      console.log('[TRACE] /start matched, parts=%d', parts.length);
      if (parts.length < 3) {
        console.log('[TRACE] sending welcome (no args)');
        return sendMessage(senderId,
          withBotMenu(
            '👋 Добро пожаловать в бот «Подъёмники»!\n\nДля входа напишите:\n/start email@company.ru пароль',
            ['после входа: меню', 'новая заявка', 'мои заявки'],
          ),
        );
      }
      const [, email, password] = parts;
      console.log('[TRACE] authorizing email=%s', email);
      let user;
      try {
        user = authorizeUser(String(phone), email, password, senderId);
      } catch (e) {
        console.error('[TRACE] authorizeUser threw:', e.message, e.stack);
        return sendMessage(senderId, '❌ Внутренняя ошибка авторизации. Попробуйте позже.');
      }
      console.log('[TRACE] user=%s', user ? user.name : 'null');
      if (!user) {
        console.log('[TRACE] sending auth error');
        return sendMessage(senderId,
          '❌ Неверный email или пароль, либо аккаунт деактивирован.\n\nПопробуйте снова:\n/start email@company.ru пароль',
        );
      }
      console.log('[TRACE] sending welcome message for user');
      return sendMessage(senderId,
        withBotMenu(
          `✅ Вы вошли как ${user.name} (${user.role})\n${getHelpText(user.role)}`,
          ['меню', 'мои заявки', 'новая заявка'],
        ),
      );
    }

    const authUser = getAuthorizedUser(String(phone));
    if (!authUser) {
      return sendMessage(senderId,
        '🔒 Вы не авторизованы.\n\nНапишите:\n/start email@company.ru пароль',
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
    const session = getBotSession(phone);

    if (!trimmed.startsWith('/') && canManageRepair) {
      const currentTicket = getCurrentRepair(phone);
      if (session.pendingAction === 'equipment_search') {
        return handleEquipmentSearchRequest(senderId, phone, trimmed);
      }
      if (session.pendingAction === 'ticket_reason') {
        return handleCreateTicketRequest(senderId, phone, authUser, trimmed);
      }
      if (session.pendingAction === 'work_search') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handleWorkSearchRequest(senderId, phone, currentTicket, trimmed);
      }
      if (session.pendingAction === 'work_pick') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handleAddWorkRequest(senderId, phone, authUser, currentTicket, trimmed);
      }
      if (session.pendingAction === 'part_search') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handlePartSearchRequest(senderId, phone, currentTicket, trimmed);
      }
      if (session.pendingAction === 'part_pick') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handleAddPartRequest(senderId, phone, authUser, currentTicket, trimmed);
      }
      if (session.pendingAction === 'summary') {
        if (!currentTicket) return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
        return handleSummaryRequest(senderId, phone, authUser, currentTicket, trimmed);
      }
    }

    if (lower === '/аренды' || lower === '/rentals' || lower === '/мои' || lower === 'аренды') {
      const rentals = readData('rentals') || [];
      return sendMessage(senderId, formatRentals(rentals, userName, userRole));
    }

    if (lower === '/техника' || lower === '/equipment' || lower === 'техника') {
      const equipment = readData('equipment') || [];
      return sendMessage(senderId, formatEquipment(equipment));
    }

    if (lower === '/сервис' || lower === '/service' || lower === 'сервис' || lower === 'заявки') {
      return sendMessage(senderId, canManageRepair ? formatServiceForUser(authUser) : formatService(readData('service') || []));
    }

    if ((lower === '/моизаявки' || lower === '/myrepairs' || lower === 'мои заявки') && canManageRepair) {
      return sendMessage(senderId, formatServiceForUser(authUser));
    }

    if ((lower === '/меню' || lower === 'меню') && canManageRepair) {
      return sendMessage(
        senderId,
        withBotMenu(getHelpText(userRole), ['мои заявки', 'новая заявка', 'черновик']),
      );
    }

    if ((lower === '/новаязаявка' || lower === 'новая заявка' || lower === 'создать заявку') && canManageRepair) {
      updateBotSession(phone, {
        pendingAction: 'equipment_search',
        pendingPayload: null,
        lastEquipmentSearch: [],
      });
      return sendMessage(
        senderId,
        '🚜 Напишите следующим сообщением INV, серийный номер, модель или производителя техники.',
      );
    }

    if ((lower.startsWith('/найтитехнику') || lower.startsWith('/техпоиск')) && canManageRepair) {
      const command = lower.startsWith('/техпоиск') ? '/техпоиск' : '/найтитехнику';
      const query = trimmed.slice(command.length).trim();
      if (!query) {
        updateBotSession(phone, { pendingAction: 'equipment_search', pendingPayload: null });
        return sendMessage(senderId, '🚜 Напишите следующим сообщением INV, серийный номер, модель или производителя техники.');
      }
      return handleEquipmentSearchRequest(senderId, phone, query);
    }

    if (lower.startsWith('/создатьзаявку ') && canManageRepair) {
      return handleCreateTicketRequest(senderId, phone, authUser, trimmed.slice('/создатьзаявку'.length).trim());
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
      return sendMessage(senderId, withBotMenu([
        `✅ Заявка ${withStatus.id} взята в работу`,
        `${withStatus.equipment}`,
        `Причина: ${withStatus.reason}`,
        '',
        'Можно сразу работать в чате.',
      ].join('\n'), ['итог', 'работы гидравлика', 'запчасти фильтр', 'черновик', 'готово']));
    }

    if (lower.startsWith('/ремонт ') && canManageRepair) {
      const repairId = trimmed.slice('/ремонт'.length).trim();
      const ticket = findServiceTicketById(repairId);
      if (!ticket) {
        return sendMessage(senderId, '❌ Заявка не найдена.');
      }
      setCurrentRepair(phone, ticket.id);
      return sendMessage(senderId, withBotMenu([
        `🛠 Текущая заявка: ${ticket.id}`,
        `${ticket.equipment}`,
        `Причина: ${ticket.reason}`,
        `Статус: ${serviceStatusLabel(ticket.status)}`,
        '',
        'Теперь можно работать по заявке.',
      ].join('\n'), ['итог', 'работы поиск', 'запчасти поиск', 'черновик']));
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
      return handleSummaryRequest(senderId, phone, authUser, ticket, trimmed.slice('/итог'.length).trim());
    }

    if ((lower === '/итог' || lower === 'итог') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      return handleSummaryRequest(senderId, phone, authUser, ticket, '');
    }

    if (lower.startsWith('/работы') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      const query = trimmed.slice('/работы'.length).trim();
      if (!query) {
        updateBotSession(phone, { pendingAction: 'work_search', activeRepairId: ticket.id });
        return sendMessage(senderId, '🧰 Напишите следующим сообщением запрос для поиска работ. Например: гидравлика');
      }
      return handleWorkSearchRequest(senderId, phone, ticket, query);
    }

    if (lower.startsWith('/добавитьработу ') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      return handleAddWorkRequest(senderId, phone, authUser, ticket, trimmed.slice('/добавитьработу'.length).trim());
    }

    if (lower.startsWith('/запчасти') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      const query = trimmed.slice('/запчасти'.length).trim();
      if (!query) {
        updateBotSession(phone, { pendingAction: 'part_search', activeRepairId: ticket.id });
        return sendMessage(senderId, '📦 Напишите следующим сообщением запрос для поиска запчастей. Например: фильтр');
      }
      return handlePartSearchRequest(senderId, phone, ticket, query);
    }

    if (lower.startsWith('/добавитьзапчасть ') && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      return handleAddPartRequest(senderId, phone, authUser, ticket, trimmed.slice('/добавитьзапчасть'.length).trim());
    }

    if (lower === '/ожидание' && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      updateServiceTicketStatus(ticket, 'waiting_parts', authUser.userName, 'Заявка переведена в ожидание запчастей через MAX');
      return sendMessage(senderId, `🟠 ${ticket.id} переведена в статус «Ожидание запчастей»`);
    }

    if (lower === '/готово' && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      const updated = updateServiceTicketStatus(ticket, 'ready', authUser.userName, 'Работы завершены через MAX');
      return sendMessage(senderId, withBotMenu([
        `✅ Заявка ${updated.id} переведена в статус «Готово»`,
        'Если нужно, можно ещё закрыть её командой /закрыть',
        'Или посмотреть отчет: /черновик',
      ].join('\n'), ['черновик', 'закрыть', 'мои заявки']));
    }

    if (lower === '/закрыть' && canManageRepair) {
      const ticket = getCurrentRepair(phone);
      if (!ticket) {
        return sendMessage(senderId, 'ℹ️ Сначала выберите заявку: /ремонт ID');
      }
      const updated = updateServiceTicketStatus(ticket, 'closed', authUser.userName, 'Заявка закрыта через MAX');
      clearBotSession(phone);
      return sendMessage(senderId, withBotMenu(`✅ Заявка ${updated.id} закрыта.`, ['мои заявки', 'новая заявка', 'меню']));
    }

    if (lower === '/помощь' || lower === '/help' || lower === 'помощь') {
      return sendMessage(senderId, getHelpText(userRole));
    }

    return sendMessage(senderId, '❓ Неизвестная команда. Напишите /помощь для списка команд.');
  }

  return {
    withBotMenu,
    handleBotStarted,
    handleCommand,
  };
}

module.exports = {
  createBotHandlers,
};
