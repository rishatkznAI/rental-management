const GROUP_ORDER = [
  'Клиенты',
  'Техника',
  'Аренды',
  'Документы',
  'Сервис',
  'Платежи',
  'Доставка',
  'Планы взыскания',
];

const SECRET_FIELD_RE = /(password|token|secret|session|cookie|apiKey)/i;

// Русские алиасы для типов документов (только для индексации/поиска, не для отображения)
const DOCUMENT_TYPE_ALIASES = {
  contract:      ['договор', 'договор аренды'],
  act:           ['акт', 'акт выполненных работ'],
  upd:           ['упд', 'универсальный передаточный документ'],
  work_order:    ['заказ-наряд', 'заказ наряд', 'наряд'],
  invoice:       ['счёт', 'счет'],
  specification: ['спецификация'],
};

// Русские алиасы для статусов документов (только для индексации/поиска, не для отображения)
const DOCUMENT_STATUS_ALIASES = {
  draft:     ['черновик'],
  sent:      ['отправлен', 'отправлено'],
  signed:    ['подписан', 'подписано'],
  pending:   ['ожидает', 'на подписании'],
  cancelled: ['отменён', 'отменен', 'отмена'],
};

function docAliases(key, aliasMap) {
  const normalized = safeSearchText(key).toLowerCase();
  const aliases = aliasMap[normalized];
  return Array.isArray(aliases) ? aliases : [];
}

export const GLOBAL_SEARCH_GROUP_LIMIT = 6;

export function normalizeGlobalSearchQuery(value) {
  return safeSearchText(value).trim().toLowerCase();
}

export function safeSearchText(value) {
  if (value === null || value === undefined) return '';
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : '';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed || trimmed === 'NaN' || trimmed === 'undefined' || trimmed === 'null' || trimmed === '[object Object]') {
      return '';
    }
    return trimmed;
  }
  if (typeof value === 'boolean') return value ? 'Да' : 'Нет';
  return '';
}

export function compactSearchParts(parts) {
  return parts.map(safeSearchText).filter(Boolean);
}

function compactLine(parts) {
  return compactSearchParts(parts).join(' · ');
}

function matchesFields(fields, query) {
  if (!query) return false;
  return compactSearchParts(fields).some(value => value.toLowerCase().includes(query));
}

function canView(options, section) {
  return Boolean(options?.permissions?.[section]);
}

function addResult(groups, result, searchableFields, query) {
  if (SECRET_FIELD_RE.test(searchableFields.join(' '))) return;
  if (!matchesFields(searchableFields, query)) return;

  const group = groups.get(result.group) ?? { group: result.group, items: [], total: 0 };
  group.total += 1;
  if (group.items.length < (result.groupLimit ?? GLOBAL_SEARCH_GROUP_LIMIT)) {
    group.items.push({
      ...result,
      title: safeSearchText(result.title),
      subtitle: safeSearchText(result.subtitle),
    });
  }
  groups.set(result.group, group);
}

function equipmentLabel(item) {
  return compactLine([item?.manufacturer, item?.model]) || safeSearchText(item?.equipmentLabel) || safeSearchText(item?.equipment);
}

function rentalEquipment(item) {
  return Array.isArray(item?.equipment) ? item.equipment : [];
}

function resolveClientName(clientById, id, fallback) {
  return safeSearchText(clientById.get(safeSearchText(id))?.company) || safeSearchText(fallback);
}

export function buildGlobalSearchGroups(data, options = {}) {
  const query = normalizeGlobalSearchQuery(options.query);
  if (!query) return [];

  const groups = new Map();
  const groupLimit = Number.isFinite(options.groupLimit) ? options.groupLimit : GLOBAL_SEARCH_GROUP_LIMIT;
  const canViewFinance = canView(options, 'finance');
  const canViewPayments = canView(options, 'payments') || canViewFinance;
  const equipment = Array.isArray(data?.equipment) ? data.equipment : [];
  const clients = Array.isArray(data?.clients) ? data.clients : [];
  const rentals = Array.isArray(data?.rentals) ? data.rentals : [];
  const ganttRentals = Array.isArray(data?.ganttRentals) ? data.ganttRentals : [];
  const documents = Array.isArray(data?.documents) ? data.documents : [];
  const serviceTickets = Array.isArray(data?.serviceTickets) ? data.serviceTickets : [];
  const payments = Array.isArray(data?.payments) ? data.payments : [];
  const deliveries = Array.isArray(data?.deliveries) ? data.deliveries : [];
  const debtCollectionPlans = Array.isArray(data?.debtCollectionPlans) ? data.debtCollectionPlans : [];
  const clientById = new Map(clients.map(item => [safeSearchText(item?.id), item]));
  const ganttById = new Map(ganttRentals.map(item => [safeSearchText(item?.id), item]));
  const equipmentById = new Map(equipment.map(item => [safeSearchText(item?.id), item]));

  if (canView(options, 'clients')) {
    for (const item of clients) {
      addResult(groups, {
        id: `client:${safeSearchText(item?.id)}`,
        title: safeSearchText(item?.company) || 'Клиент',
        subtitle: compactLine([item?.contact, item?.phone, item?.email, item?.inn]),
        href: `/clients/${safeSearchText(item?.id)}`,
        section: 'clients',
        group: 'Клиенты',
        icon: 'users',
        groupLimit,
      }, [item?.company, item?.inn, item?.contact, item?.phone, item?.email], query);
    }
  }

  if (canView(options, 'equipment')) {
    for (const item of equipment) {
      const owner = safeSearchText(item?.ownerName) || safeSearchText(item?.owner);
      addResult(groups, {
        id: `equipment:${safeSearchText(item?.id)}`,
        title: compactLine([item?.inventoryNumber, equipmentLabel(item)]) || 'Техника',
        subtitle: compactLine([item?.serialNumber, owner, item?.status, item?.location]),
        href: `/equipment/${safeSearchText(item?.id)}`,
        section: 'equipment',
        group: 'Техника',
        icon: 'truck',
        groupLimit,
      }, [
        item?.model,
        item?.manufacturer,
        item?.serialNumber,
        item?.inventoryNumber,
        owner,
        item?.status,
        item?.location,
        item?.currentClient,
      ], query);
    }
  }

  if (canView(options, 'rentals')) {
    for (const item of rentals) {
      const equipmentItems = rentalEquipment(item);
      addResult(groups, {
        id: `rental:${safeSearchText(item?.id)}`,
        title: compactLine(['Аренда', item?.id]),
        subtitle: compactLine([item?.client, equipmentItems.join(', '), item?.manager, item?.status, item?.startDate, item?.plannedReturnDate]),
        href: `/rentals/${safeSearchText(item?.id)}`,
        section: 'rentals',
        group: 'Аренды',
        icon: 'fileText',
        groupLimit,
      }, [item?.id, item?.client, item?.contact, item?.manager, item?.status, item?.startDate, item?.plannedReturnDate, ...equipmentItems], query);
    }
  }

  if (canView(options, 'documents')) {
    for (const item of documents) {
      const rentalId = safeSearchText(item?.rentalId) || safeSearchText(item?.rental);
      const clientName = resolveClientName(clientById, item?.clientId, item?.client || ganttById.get(rentalId)?.client);
      const documentName = safeSearchText(item?.number) || safeSearchText(item?.title) || safeSearchText(item?.name);
      addResult(groups, {
        id: `document:${safeSearchText(item?.id)}`,
        title: compactLine(['Документ', documentName || item?.id]),
        subtitle: compactLine([item?.type, item?.status, clientName, rentalId]),
        href: '/documents',
        section: 'documents',
        group: 'Документы',
        icon: 'fileCheck',
        groupLimit,
      }, [
        item?.id,
        item?.type,
        item?.status,
        ...docAliases(item?.type, DOCUMENT_TYPE_ALIASES),
        ...docAliases(item?.status, DOCUMENT_STATUS_ALIASES),
        clientName,
        rentalId,
        item?.number,
        item?.title,
        item?.name,
      ], query);
    }
  }

  if (canView(options, 'service')) {
    for (const item of serviceTickets) {
      const rentalId = safeSearchText(item?.rentalId);
      const clientName = safeSearchText(item?.client) || safeSearchText(item?.clientName) || safeSearchText(ganttById.get(rentalId)?.client);
      addResult(groups, {
        id: `service:${safeSearchText(item?.id)}`,
        title: compactLine([item?.id, item?.equipment]) || 'Сервис',
        subtitle: compactLine([item?.reason || item?.description, clientName, item?.assignedMechanicName || item?.assignedTo, item?.status]),
        href: `/service/${safeSearchText(item?.id)}`,
        section: 'service',
        group: 'Сервис',
        icon: 'wrench',
        groupLimit,
      }, [
        item?.id,
        item?.equipment,
        item?.inventoryNumber,
        item?.serialNumber,
        clientName,
        rentalId,
        item?.assignedMechanicName,
        item?.assignedTo,
        item?.status,
        item?.reason,
        item?.description,
      ], query);
    }
  }

  if (canViewPayments) {
    for (const item of payments) {
      const rentalId = safeSearchText(item?.rentalId);
      const clientName = resolveClientName(clientById, item?.clientId, item?.client || ganttById.get(rentalId)?.client);
      const amount = canViewFinance ? item?.amount : undefined;
      addResult(groups, {
        id: `payment:${safeSearchText(item?.id)}`,
        title: compactLine(['Платёж', item?.invoiceNumber || item?.id]),
        subtitle: compactLine([clientName, rentalId, item?.status, item?.paidDate || item?.dueDate, amount]),
        href: '/payments',
        section: 'payments',
        group: 'Платежи',
        icon: 'creditCard',
        groupLimit,
      }, [item?.id, item?.invoiceNumber, clientName, rentalId, item?.status, item?.paidDate, item?.dueDate, canViewFinance ? item?.amount : undefined], query);
    }
  }

  if (canView(options, 'deliveries')) {
    for (const item of deliveries) {
      const equipmentItem = equipmentById.get(safeSearchText(item?.equipmentId));
      const equipmentName = safeSearchText(item?.equipmentLabel) || safeSearchText(item?.equipmentInv) || equipmentLabel(equipmentItem);
      addResult(groups, {
        id: `delivery:${safeSearchText(item?.id)}`,
        title: compactLine(['Доставка', item?.id]),
        subtitle: compactLine([item?.client, equipmentName, item?.destination, item?.carrierName, item?.status]),
        href: '/deliveries',
        section: 'deliveries',
        group: 'Доставка',
        icon: 'route',
        groupLimit,
      }, [
        item?.id,
        item?.client,
        equipmentName,
        item?.equipmentInv,
        item?.origin,
        item?.destination,
        item?.carrierName,
        item?.status,
        item?.ganttRentalId,
        item?.classicRentalId,
      ], query);
    }
  }

  if (canViewFinance) {
    for (const item of debtCollectionPlans) {
      addResult(groups, {
        id: `debt-plan:${safeSearchText(item?.id)}`,
        title: compactLine(['План взыскания', item?.clientName]),
        subtitle: compactLine([item?.responsibleName, item?.status, item?.nextActionType, item?.nextActionDate, item?.comment]),
        href: '/finance',
        section: 'finance',
        group: 'Планы взыскания',
        icon: 'listChecks',
        groupLimit,
      }, [item?.clientName, item?.responsibleName, item?.status, item?.nextActionType, item?.nextActionDate, item?.comment], query);
    }
  }

  return GROUP_ORDER
    .map(group => groups.get(group))
    .filter(Boolean)
    .map(group => ({
      ...group,
      hiddenCount: Math.max(0, group.total - group.items.length),
    }));
}
