function createBotOperations(deps) {
  const {
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
  } = deps;

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
    const base = createEmptyRepairCloseChecklist();

    return {
      ...base,
      ...(ticket.closeChecklist || {}),
      ...overrides,
      worksRecorded: Boolean(workItems.length),
      beforePhotosAttached: repairPhotos.before.length > 0,
      afterPhotosAttached: repairPhotos.after.length > 0,
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
    const normalizeName = String(authUser.userName || '').trim().toLowerCase();
    const tickets = readServiceTickets();
    const workItems = readData('repair_work_items') || [];
    const partItems = readData('repair_part_items') || [];

    const myTickets = tickets.filter(ticket =>
      String(ticket.assignedMechanicName || '').trim().toLowerCase() === normalizeName ||
      ticket.workLog?.some(entry => String(entry.author || '').trim().toLowerCase() === normalizeName),
    );

    const closedToday = myTickets.filter(ticket =>
      ticket.status === 'closed' &&
      String(ticket.closedAt || '').startsWith(today) &&
      String(ticket.assignedMechanicName || '').trim().toLowerCase() === normalizeName,
    );
    const readyToday = myTickets.filter(ticket =>
      ticket.workLog?.some(entry =>
        String(entry.date || '').startsWith(today) &&
        String(entry.author || '').trim().toLowerCase() === normalizeName &&
        /готов|завершен/i.test(entry.text || ''),
      ),
    );
    const takenToday = myTickets.filter(ticket =>
      ticket.workLog?.some(entry =>
        String(entry.date || '').startsWith(today) &&
        String(entry.author || '').trim().toLowerCase() === normalizeName &&
        /взял заявку в работу/i.test(entry.text || ''),
      ),
    );

    const myWorkItems = workItems.filter(item =>
      String(item.createdAt || '').startsWith(today) &&
      String(item.createdByUserName || '').trim().toLowerCase() === normalizeName,
    );
    const myPartItems = partItems.filter(item =>
      String(item.createdAt || '').startsWith(today) &&
      String(item.createdByUserName || '').trim().toLowerCase() === normalizeName,
    );

    const myRepairPhotos = myTickets.reduce((acc, ticket) => {
      const repairPhotos = normalizeRepairPhotos(ticket);
      const beforeToday = String(repairPhotos.beforeUploadedAt || '').startsWith(today) &&
        String(repairPhotos.beforeUploadedBy || '').trim().toLowerCase() === normalizeName;
      const afterToday = String(repairPhotos.afterUploadedAt || '').startsWith(today) &&
        String(repairPhotos.afterUploadedBy || '').trim().toLowerCase() === normalizeName;
      return {
        before: acc.before + (beforeToday ? repairPhotos.before.length : 0),
        after: acc.after + (afterToday ? repairPhotos.after.length : 0),
      };
    }, { before: 0, after: 0 });

    const totalNormHours = myWorkItems.reduce((sum, item) => sum + ((Number(item.normHoursSnapshot) || 0) * (Number(item.quantity) || 0)), 0);
    const totalPartsCost = myPartItems.reduce((sum, item) => sum + ((Number(item.priceSnapshot) || 0) * (Number(item.quantity) || 0)), 0);
    const lastClosedLines = closedToday.slice(0, 5).map(ticket => `• ${ticket.id} · ${ticket.equipment}`);

    return [
      '📊 Быстрый отчёт за день',
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

  function createServiceTicketFromBot(equipment, authUser, reason, description = '') {
    const now = nowIso();
    const mechanicRef = getMechanicReferenceByUser(authUser);
    const assignedName = mechanicRef?.name || authUser.userName;
    const newTicket = {
      id: generateId(idPrefixes.service),
      equipmentId: equipment.id,
      equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
      serviceKind: 'repair',
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

  function createMaintenanceTicketFromBot(equipment, authUser, maintenanceKind, summary = '') {
    const now = nowIso();
    const today = now.slice(0, 10);
    const maintenanceLabel = MAINTENANCE_REASON_LABELS[maintenanceKind] || 'ТО';
    const mechanicRef = getMechanicReferenceByUser(authUser);
    const ticket = {
      id: generateId(idPrefixes.service),
      equipmentId: equipment.id,
      equipment: `${equipment.manufacturer} ${equipment.model} (INV: ${equipment.inventoryNumber})`,
      serviceKind: maintenanceKind,
      inventoryNumber: equipment.inventoryNumber,
      serialNumber: equipment.serialNumber,
      equipmentType: equipment.type,
      equipmentTypeLabel: equipment.type,
      location: equipment.location,
      reason: maintenanceLabel,
      description: summary || `${maintenanceLabel} выполнено через MAX`,
      priority: 'low',
      sla: '24 ч',
      assignedTo: authUser.userName,
      assignedMechanicId: mechanicRef?.id,
      assignedMechanicName: authUser.userName,
      createdBy: authUser.userName,
      createdByUserId: authUser.userId,
      createdByUserName: authUser.userName,
      reporterContact: authUser.userName,
      source: 'bot',
      status: 'closed',
      result: summary || `${maintenanceLabel} выполнено`,
      resultData: {
        summary: summary || `${maintenanceLabel} выполнено`,
        partsUsed: [],
        worksPerformed: [],
      },
      repairPhotos: createEmptyRepairPhotos(),
      closeChecklist: createEmptyRepairCloseChecklist(),
      workLog: [
        {
          date: now,
          text: `${maintenanceLabel} зафиксировано через MAX`,
          author: authUser.userName,
          type: 'status_change',
        },
        {
          date: now,
          text: `Заявка закрыта после фиксации ${maintenanceLabel} через MAX`,
          author: authUser.userName,
          type: 'repair_result',
        },
      ],
      parts: [],
      createdAt: now,
      closedAt: now,
    };

    writeServiceTickets([...readServiceTickets(), ticket]);

    const equipmentList = readData('equipment') || [];
    const nextEquipment = equipmentList.map(item => {
      if (item.id !== equipment.id) return item;
      const withHistory = appendEquipmentHistoryEntry(item, {
        date: now,
        author: authUser.userName,
        type: 'system',
        text: `${maintenanceLabel} выполнено через MAX${summary ? `: ${summary}` : ''}`,
      });
      return {
        ...withHistory,
        ...(maintenanceKind === 'chto' ? { maintenanceCHTO: today } : {}),
        ...(maintenanceKind === 'pto' ? { maintenancePTO: today } : {}),
      };
    });
    writeData('equipment', nextEquipment);

    return ticket;
  }

  function createReturnInspectionTicketFromBot(equipment, authUser, activeRental, photoUrls, comment = '') {
    const now = nowIso();
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

  return {
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
    formatMechanicDayReport,
    getOperationSessions,
    writeOperationSessions,
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
    appendEquipmentHistoryEntry,
    completeBotEquipmentOperation,
    saveBotShippingPhotoEvent,
    addRepairWorkItemFromCatalog,
    addRepairPartItemFromCatalog,
  };
}

module.exports = {
  createBotOperations,
};
