function createBotUi() {
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

  function chunkButtons(items, rowSize = 2) {
    const rows = [];
    for (let i = 0; i < items.length; i += rowSize) {
      rows.push(items.slice(i, i + rowSize));
    }
    return rows;
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
      [button('Операции', 'menu:operations'), button('Действия по заявке', 'menu:repair_actions')],
      [button('Найти технику', 'menu:find_equipment'), button('Отчёт за день', 'menu:day_report')],
      [button('Помощь', 'menu:help')],
    ]);
  }

  function currentRepairKeyboard(ticketId = '') {
    return keyboard([
      [button('Текущий отчёт', 'menu:draft'), button('Действия по заявке', 'menu:repair_actions')],
      [button('Завершить ремонт', 'menu:ready'), button('Финально закрыть', ticketId ? `ticket:close:${ticketId}` : 'menu:close')],
      [button('Главное меню', 'menu:main')],
      [button('Мои заявки', 'menu:myrepairs'), button('Отчёт за день', 'menu:day_report')],
    ]);
  }

  function operationsKeyboard() {
    return keyboard([
      [button('Отгрузка', 'menu:shipout'), button('Приёмка', 'menu:receivein')],
      [button('Назад', 'menu:main')],
    ]);
  }

  function repairActionsKeyboard(ticketId = '') {
    return keyboard([
      [button('Заполнить итог', 'menu:summary'), button('Текущий отчёт', 'menu:draft')],
      [button('Добавить работы', 'menu:works'), button('Добавить запчасти', 'menu:parts')],
      [button('Фото до ремонта', 'menu:repair_before'), button('Фото после ремонта', 'menu:repair_after')],
      [button('Ожидание запчастей', 'menu:waiting'), button('Завершить ремонт', 'menu:ready')],
      [button('Финально закрыть', ticketId ? `ticket:close:${ticketId}` : 'menu:close'), button('К заявкам', 'menu:myrepairs')],
      [button('Главное меню', 'menu:main')],
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

  const MAINTENANCE_REASON_LABELS = {
    to: 'ТО',
    chto: 'ЧТО',
    pto: 'ПТО',
  };

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

  function defaultKeyboardForRole(role) {
    if (role === 'Механик' || role === 'Администратор') {
      return mechanicKeyboard();
    }
    return keyboard([
      [button('Аренды', 'menu:rentals'), button('Техника', 'menu:equipment')],
      [button('Сервис', 'menu:service'), button('Помощь', 'menu:help')],
    ]);
  }

  return {
    button,
    keyboard,
    backAndMainRow,
    chunkButtons,
    authKeyboard,
    mechanicKeyboard,
    currentRepairKeyboard,
    operationsKeyboard,
    repairActionsKeyboard,
    repairReasonKeyboard,
    quantityKeyboard,
    operationKeyboard,
    defaultKeyboardForRole,
    REPAIR_REASON_TEMPLATES,
    REPAIR_REASON_BY_KEY,
    MAINTENANCE_REASON_LABELS,
    HANDOFF_CHECKLIST_LABELS,
    CHECKLIST_STEP_TO_KEY,
    CHECKLIST_STEPS,
    REPAIR_CLOSE_CHECKLIST_LABELS,
    REPAIR_CLOSE_CHECKLIST_ORDER,
    OPERATION_STEP_META,
    SHIPPING_OPERATION_STEPS,
    RECEIVING_OPERATION_STEPS,
  };
}

module.exports = {
  createBotUi,
};
