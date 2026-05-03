const MANAGE_ACTIONS = ['create', 'edit'];

function canDo(can, action, section) {
  return typeof can === 'function' && Boolean(can(action, section));
}

function canAny(can, actions, section) {
  return actions.some(action => canDo(can, action, section));
}

function safeText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  return '';
}

function withQuery(path, params) {
  const search = new URLSearchParams();
  Object.entries(params || {}).forEach(([key, value]) => {
    const text = safeText(value);
    if (text) search.set(key, text);
  });
  const query = search.toString();
  return query ? `${path}?${query}` : path;
}

function isAdminOrOffice(role) {
  return role === 'Администратор' || role === 'Офис-менеджер';
}

export function buildClientQuickActions({ client, can, role } = {}) {
  const clientId = safeText(client?.id);
  const clientName = safeText(client?.company);
  const context = { clientId, clientName };
  const actions = [];

  if (canDo(can, 'create', 'rentals')) {
    actions.push({
      id: 'client-create-rental',
      label: 'Создать аренду',
      kind: 'primary',
      to: withQuery('/rentals/new', context),
    });
  }
  if (canDo(can, 'view', 'documents') && canAny(can, MANAGE_ACTIONS, 'documents')) {
    actions.push({
      id: 'client-create-document',
      label: 'Создать документ',
      to: withQuery('/documents', { ...context, action: 'create' }),
    });
  }
  if (canDo(can, 'view', 'finance') && (isAdminOrOffice(role) || canAny(can, MANAGE_ACTIONS, 'finance'))) {
    actions.push({
      id: 'client-create-debt-plan',
      label: 'Создать план взыскания',
      to: withQuery('/finance', context),
    });
  }
  if (canDo(can, 'view', 'documents')) {
    actions.push({
      id: 'client-documents',
      label: 'Документы клиента',
      to: withQuery('/documents', context),
    });
  }
  if (canDo(can, 'view', 'payments') || canDo(can, 'view', 'finance')) {
    actions.push({
      id: 'client-payments',
      label: 'Платежи клиента',
      to: withQuery('/payments', context),
    });
  }
  if (canDo(can, 'view', 'tasks_center')) {
    actions.push({
      id: 'client-tasks',
      label: 'Задачи по клиенту',
      to: withQuery('/tasks', context),
    });
  }

  return actions;
}

export function buildEquipmentQuickActions({ equipment, can, currentRental } = {}) {
  const equipmentId = safeText(equipment?.id);
  const equipmentInv = safeText(equipment?.inventoryNumber);
  const context = { equipmentId, equipmentInv };
  const actions = [];
  const status = safeText(equipment?.status);
  const rentalBlocked = status === 'in_service' || status === 'inactive';

  if (canDo(can, 'create', 'service')) {
    actions.push({
      id: 'equipment-create-service',
      label: 'Создать сервисную заявку',
      kind: 'primary',
      to: withQuery('/service/new', context),
    });
  }
  if (canDo(can, 'create', 'rentals')) {
    actions.push({
      id: 'equipment-create-rental',
      label: 'Создать аренду',
      to: withQuery('/rentals/new', context),
      disabled: rentalBlocked,
      reason: status === 'inactive'
        ? 'Техника списана'
        : status === 'in_service'
          ? 'Техника сейчас в сервисе'
          : '',
    });
  }
  if (canDo(can, 'view', 'service')) {
    actions.push({ id: 'equipment-service-queue', label: 'Очередь сервиса', to: '/service' });
  }
  if (canDo(can, 'view', 'documents')) {
    actions.push({ id: 'equipment-documents', label: 'Документы техники', to: withQuery('/documents', context) });
  }
  if (canDo(can, 'view', 'rentals')) {
    actions.push({ id: 'equipment-rental-history', label: 'История аренд', to: withQuery('/rentals', context) });
    if (currentRental?.id) {
      actions.push({ id: 'equipment-current-rental', label: 'Текущая аренда', to: `/rentals/${encodeURIComponent(currentRental.id)}` });
    }
  }

  return actions;
}

export function buildRentalQuickActions({ rental, can, clientId, equipmentId } = {}) {
  const rentalId = safeText(rental?.id);
  const context = { rentalId, clientId, equipmentId };
  const actions = [];

  if (canDo(can, 'edit', 'rentals')) actions.push({ id: 'rental-extend', label: 'Продлить аренду', kind: 'primary' });
  if (canDo(can, 'view', 'documents') && canAny(can, MANAGE_ACTIONS, 'documents')) actions.push({ id: 'rental-create-document', label: 'Создать документ', to: withQuery('/documents', { ...context, action: 'create' }) });
  if (canDo(can, 'view', 'deliveries') && canAny(can, MANAGE_ACTIONS, 'deliveries')) actions.push({ id: 'rental-create-delivery', label: 'Создать доставку', to: withQuery('/deliveries', context) });
  if (canDo(can, 'create', 'service')) actions.push({ id: 'rental-create-service', label: 'Создать сервисную заявку', to: withQuery('/service/new', context) });
  if (clientId && canDo(can, 'view', 'clients')) actions.push({ id: 'rental-client', label: 'Открыть клиента', to: `/clients/${encodeURIComponent(clientId)}` });
  if (equipmentId && canDo(can, 'view', 'equipment')) actions.push({ id: 'rental-equipment', label: 'Открыть технику', to: `/equipment/${encodeURIComponent(equipmentId)}` });
  if (canDo(can, 'view', 'payments') || canDo(can, 'view', 'finance')) actions.push({ id: 'rental-payments', label: 'Открыть платежи', to: withQuery('/payments', context) });
  if (canDo(can, 'view', 'documents')) actions.push({ id: 'rental-documents', label: 'Открыть документы', to: withQuery('/documents', context) });
  if (canDo(can, 'view', 'rentals')) actions.push({ id: 'rental-history', label: 'История изменений' });

  return actions;
}

export function buildServiceQuickActions({ ticket, can, canEditTicketFields, hasWorkScenario, hasPartScenario } = {}) {
  const actions = [];
  const equipmentId = safeText(ticket?.equipmentId);
  const rentalId = safeText(ticket?.rentalId);
  const clientId = safeText(ticket?.clientId);

  if (equipmentId && canDo(can, 'view', 'equipment')) {
    actions.push({ id: 'service-equipment', label: 'Открыть технику', to: `/equipment/${encodeURIComponent(equipmentId)}` });
  }
  if (rentalId && canDo(can, 'view', 'rentals')) {
    actions.push({ id: 'service-rental', label: 'Открыть аренду', to: `/rentals/${encodeURIComponent(rentalId)}` });
  }
  if (clientId && canDo(can, 'view', 'clients')) {
    actions.push({ id: 'service-client', label: 'Открыть клиента', to: `/clients/${encodeURIComponent(clientId)}` });
  }
  if (canEditTicketFields && hasWorkScenario) {
    actions.push({ id: 'service-add-work', label: 'Добавить работу', kind: 'primary' });
  }
  if (canEditTicketFields && hasPartScenario) {
    actions.push({ id: 'service-add-part', label: 'Добавить запчасть' });
  }
  if (canDo(can, 'view', 'service')) {
    actions.push({ id: 'service-queue', label: 'Очередь сервиса', to: '/service' });
  }

  return actions;
}
