const { isMechanicRole } = require('./role-groups');

function createBotFormatters(deps) {
  const {
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
  } = deps;

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
    const base = {
      faultEliminated: false,
      worksRecorded: false,
      partsRecordedOrNotRequired: false,
      beforePhotosAttached: false,
      afterPhotosAttached: false,
    };

    return {
      ...base,
      ...(ticket.closeChecklist || {}),
      ...overrides,
      worksRecorded: Boolean(workItems.length),
      beforePhotosAttached: repairPhotos.before.length > 0,
      afterPhotosAttached: repairPhotos.after.length > 0,
    };
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

  function formatBotDate(value) {
    if (!value) return '—';
    const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!match) return String(value);
    return `${match[3]}.${match[2]}.${match[1]}`;
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

  function cleanEquipmentType(value) {
    return String(value || '').replace(/\s+/g, ' ').trim();
  }

  function getEquipmentTypeCatalogLabels() {
    const labels = new Map([
      ['scissor', 'Ножничный'],
      ['articulated', 'Коленчатый'],
      ['telescopic', 'Телескопический'],
      ['mast', 'Мачтовый'],
    ]);
    const setting = (readData('app_settings') || []).find(item => item.key === 'equipment_type_catalog');
    const rawItems = Array.isArray(setting?.value)
      ? setting.value
      : (Array.isArray(setting?.value?.items) ? setting.value.items : []);

    rawItems.forEach(item => {
      const value = typeof item === 'string' ? item : item?.value;
      const label = typeof item === 'string' ? item : (item?.label || item?.value);
      const normalizedValue = cleanEquipmentType(value);
      const normalizedLabel = cleanEquipmentType(label);
      if (normalizedValue && normalizedLabel) {
        labels.set(normalizedValue, normalizedLabel);
      }
    });

    return labels;
  }

  function getEquipmentTypeLabel(type) {
    const value = cleanEquipmentType(type);
    if (!value) return 'Без типа';
    return getEquipmentTypeCatalogLabels().get(value) || value;
  }

  function compareEquipmentForBot(left, right) {
    return `${left.inventoryNumber || ''} ${left.model || ''}`.localeCompare(
      `${right.inventoryNumber || ''} ${right.model || ''}`,
      'ru',
      { numeric: true },
    );
  }

  function getFreeEquipmentCategories(equipment) {
    const groups = new Map();
    (equipment || [])
      .filter(item => item?.status === 'available')
      .forEach(item => {
        const type = cleanEquipmentType(item.type) || 'unknown';
        const label = getEquipmentTypeLabel(item.type);
        const current = groups.get(type) || { type, label, items: [] };
        current.items.push(item);
        groups.set(type, current);
      });

    return [...groups.values()]
      .map(group => ({
        ...group,
        items: group.items.sort(compareEquipmentForBot),
      }))
      .sort((left, right) => right.items.length - left.items.length || left.label.localeCompare(right.label, 'ru'));
  }

  function formatEquipmentCategories(equipment) {
    const categories = getFreeEquipmentCategories(equipment);
    const total = categories.reduce((sum, category) => sum + category.items.length, 0);
    if (!total) return '🚧 Свободной техники нет.';

    return [
      `🟢 Свободная техника (${total})`,
      '',
      'Выберите категорию кнопкой ниже:',
      ...categories.map(category => `• ${category.label}: ${category.items.length}`),
    ].join('\n');
  }

  function formatEquipmentCategory(category, page = 0, pageSize = 8) {
    if (!category) return '🚧 Категория не найдена.';
    const safePageSize = Math.max(1, pageSize);
    const totalPages = Math.max(1, Math.ceil(category.items.length / safePageSize));
    const safePage = Math.min(Math.max(Number(page) || 0, 0), totalPages - 1);
    const start = safePage * safePageSize;
    const lines = category.items
      .slice(start, start + safePageSize)
      .map(item => `• ${formatEquipmentForBot(item)}`);

    return [
      `🟢 ${category.label}: свободно ${category.items.length}`,
      `Страница ${safePage + 1} из ${totalPages}`,
      '',
      ...lines,
      '',
      category.items.length > safePageSize
        ? 'Используйте кнопки «Назад» и «Далее», чтобы листать список.'
        : 'Это весь список в категории.',
    ].join('\n');
  }

  function formatTicketLine(ticket) {
    const assigned = ticket.assignedMechanicName ? ` · ${ticket.assignedMechanicName}` : '';
    return `• ${ticket.id} · ${serviceStatusLabel(ticket.status)} · ${ticket.equipment}\n  ${ticket.reason}${assigned}`;
  }

  function formatCurrentRepairDraft(ticket) {
    const workItems = (readData('repair_work_items') || []).filter(item => item.repairId === ticket.id);
    const partItems = (readData('repair_part_items') || []).filter(item => item.repairId === ticket.id);
    const summary = ticket.resultData?.summary || ticket.result || 'не добавлен';
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
      `Комментарий по результату: ${summary}`,
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
    if (isMechanicRole(authUser.userRole)) {
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
    if (!isMechanicRole(authUser.userRole)) {
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
      isMechanicRole(authUser.userRole) && mode === 'assigned'
        ? `🧰 Мои сервисные заявки (${tickets.length}):`
        : isMechanicRole(authUser.userRole)
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
      button(
        `${ticket.equipment}${ticket.equipmentInv ? ` · INV ${ticket.equipmentInv}` : ''}`.slice(0, 48),
        `ticket:open:${ticket.id}`,
      ),
    );
    return keyboard([
      ...chunkButtons(buttons, 2),
      [button('Новая заявка', 'menu:new_ticket')],
      [button('Главное меню', 'menu:main')],
    ]);
  }

  function equipmentActionKeyboard(equipmentId) {
    return keyboard([
      [button('История', `equipmentmenu:history:${equipmentId}`), button('Ремонт', `equipmentmenu:repair:${equipmentId}`)],
      [button('ТО', `equipmentmenu:maintenance:${equipmentId}:to`), button('ЧТО', `equipmentmenu:maintenance:${equipmentId}:chto`)],
      [button('ПТО', `equipmentmenu:maintenance:${equipmentId}:pto`)],
      [button('Назад', 'menu:new_ticket'), button('Главное меню', 'menu:main')],
    ]);
  }

  function searchServiceWorks(query) {
    const works = (readData('service_works') || []).filter(item => item.isActive !== false);
    if (!normalizeBotText(query)) return works.slice(0, 7);
    return works.filter(item => {
      const haystack = [
        item.name,
        item.category,
        item.description,
      ].filter(Boolean).join(' ');
      return botSearchMatches(haystack, query);
    }).slice(0, 7);
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
      `• ${item.inventoryNumber} — ${item.model} (${item.type === 'scissor' ? 'Ножничный' : item.type === 'articulated' ? 'Коленчатый' : 'Телескопический'})`,
    );

    return [`🟢 Свободная техника (${free.length}):`, ...lines,
      free.length > 10 ? `... и ещё ${free.length - 10}` : ''].filter(Boolean).join('\n');
  }

  function formatEquipmentActionMenu(equipment) {
    return [
      '🚜 Выбрана техника:',
      formatEquipmentForBot(equipment),
      '',
      'Выберите действие:',
      '• История — посмотреть карточку и последние события',
      '• Ремонт — создать заявку с причиной текстом',
      '• ТО / ЧТО / ПТО — зафиксировать выполненное обслуживание',
    ].join('\n');
  }

  function formatEquipmentHistoryForBot(equipment) {
    const tickets = readServiceTickets()
      .filter(ticket => ticket.equipmentId === equipment.id)
      .sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
    const historyEntries = [...(equipment.history || [])]
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 8);

    const lines = [
      '📚 История техники',
      formatEquipmentForBot(equipment),
      '',
      `Статус: ${equipment.status || '—'}`,
      `Моточасы: ${equipment.hours ?? '—'}`,
      `След. ТО: ${formatBotDate(equipment.nextMaintenance)}`,
      `ЧТО: ${formatBotDate(equipment.maintenanceCHTO)}`,
      `ПТО: ${formatBotDate(equipment.maintenancePTO)}`,
    ];

    if (tickets.length) {
      lines.push('', 'Последние заявки:');
      tickets.slice(0, 3).forEach(ticket => {
        lines.push(`• ${ticket.id} · ${serviceStatusLabel(ticket.status)} · ${ticket.reason}`);
      });
    }

    if (historyEntries.length) {
      lines.push('', 'Последние события:');
      historyEntries.forEach(entry => {
        lines.push(`• ${formatBotDate(entry.date)} · ${entry.author}: ${entry.text}`);
      });
    } else {
      lines.push('', 'История техники пока пустая.');
    }

    return lines.join('\n');
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

  function getHelpText(role) {
    const isMechanic = isMechanicRole(role) || role === 'Администратор';
    const isRentalManager = role === 'Менеджер по аренде';
    const isCarrier = role === 'Перевозчик';
    const mechanicLines = [
      '/моизаявки — мои сервисные заявки',
      '/новаязаявка — создать новую заявку',
      '/найтитехнику — найти технику для заявки',
      '/отгрузка — оформить отгрузку',
      '/приёмка — оформить приёмку',
      '/черновик — текущий отчёт по ремонту',
      '/итог — комментарий по результату',
      '/работы — поиск и добавление работ',
      '/запчасти — поиск и добавление запчастей',
      '/выезд — оформить выезд по заявке',
      '/фотодо — загрузить фото до ремонта',
      '/фотопосле — загрузить фото после ремонта',
      '/готово — перевести заявку в статус «Готово»',
      '/мойдень — отчёт механика за день',
    ];

    const rentalManagerLines = [
      '/моясводка — утренняя сводка по арендам',
      '/новаядоставка — создать заявку на доставку',
      '/новаязаявка — создать сервисную заявку',
      '/аренды — ваши активные аренды',
      '/техника — свободная техника',
    ];

    const carrierLines = [
      '/доставки — мои доставки',
      '/меню — главное меню',
    ];

    const commonLines = [
      '/аренды — активные аренды',
      '/техника — свободная техника',
      '/сервис — открытые сервисные заявки',
      '/меню — главное меню',
      '/помощь — этот список',
    ];

    return [
      '📘 Доступные команды:',
      '',
      ...(isMechanic ? mechanicLines : []),
      ...(isRentalManager ? rentalManagerLines : []),
      ...(isCarrier ? carrierLines : []),
      ...commonLines,
      '',
      'Полный список команд доступен по кнопке «Помощь».',
    ].join('\n');
  }

  function getMainMenuText(authUser) {
    if (isMechanicRole(authUser.userRole) || authUser.userRole === 'Администратор') {
      return [
        `✅ Вы вошли как ${authUser.userRole} (${authUser.userName})`,
        '',
        'Выберите действие кнопками ниже.',
      ].join('\n');
    }

    if (authUser.userRole === 'Менеджер по аренде') {
      return [
        `✅ Вы вошли как ${authUser.userRole} (${authUser.userName})`,
        '',
        'Доступны аренды, свободная техника, утренняя сводка и быстрые заявки в доставку и сервис.',
      ].join('\n');
    }

    if (authUser.userRole === 'Перевозчик') {
      return [
        `✅ Вы вошли как ${authUser.userRole} (${authUser.userName})`,
        '',
        'Здесь вы видите свои доставки и можете менять их статусы: Принял, Выехал, Доставлено.',
      ].join('\n');
    }

    return [
      `✅ Вы вошли как ${authUser.userRole} (${authUser.userName})`,
      '',
      'Доступны быстрые команды по аренде, технике и сервису.',
    ].join('\n');
  }

  return {
    normalizeBotText,
    botSearchMatches,
    formatBotDate,
    formatEquipmentForBot,
    formatTicketLine,
    formatCurrentRepairDraft,
    getAccessibleServiceTickets,
    getAssignedServiceTickets,
    formatServiceForUser,
    serviceTicketsKeyboard,
    equipmentActionKeyboard,
    searchServiceWorks,
    searchSpareParts,
    searchEquipmentForBot,
    extractPhotoUrlsFromMessage,
    formatRentals,
    formatEquipment,
    formatEquipmentCategories,
    formatEquipmentCategory,
    getFreeEquipmentCategories,
    formatEquipmentActionMenu,
    formatEquipmentHistoryForBot,
    equipmentSearchKeyboard,
    workSearchKeyboard,
    partSearchKeyboard,
    formatService,
    getHelpText,
    getMainMenuText,
  };
}

module.exports = {
  createBotFormatters,
};
