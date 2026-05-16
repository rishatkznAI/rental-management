const DOCUMENT_TYPE_REGISTRY = {
  rental_contract: {
    label: 'Договор аренды',
    icon: 'FileSignature',
    color: 'blue',
    numberPrefix: 'DA',
    allowedRoles: ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'],
    requiredFields: ['clientId', 'rentalId'],
    optionalFields: ['equipmentId', 'objectId', 'contractId'],
    defaultStatus: 'draft',
    supportedActions: ['open', 'print', 'send', 'markSigned', 'duplicate', 'delete'],
    purpose: 'Договор аренды техники.',
  },
  rental_specification: {
    label: 'Спецификация к договору',
    icon: 'ClipboardList',
    color: 'indigo',
    numberPrefix: 'SP',
    allowedRoles: ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'],
    requiredFields: ['clientId', 'rentalId'],
    optionalFields: ['parentDocumentId', 'equipmentId'],
    defaultStatus: 'draft',
    supportedActions: ['open', 'print', 'send', 'markSigned', 'duplicate', 'delete'],
    purpose: 'Приложение/спецификация к договору с техникой, сроком, ценой и условиями.',
  },
  transfer_act_to_client: {
    label: 'Акт передачи клиенту',
    icon: 'Send',
    color: 'emerald',
    numberPrefix: 'AP',
    allowedRoles: ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'],
    requiredFields: ['clientId', 'rentalId'],
    optionalFields: ['deliveryId', 'equipmentId'],
    defaultStatus: 'draft',
    supportedActions: ['open', 'print', 'send', 'markSigned', 'duplicate', 'delete'],
    purpose: 'Фиксация передачи техники клиенту.',
  },
  return_act_from_client: {
    label: 'Акт возврата от клиента',
    icon: 'Undo2',
    color: 'amber',
    numberPrefix: 'AR',
    allowedRoles: ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'],
    requiredFields: ['clientId', 'rentalId'],
    optionalFields: ['deliveryId', 'equipmentId', 'serviceTicketId'],
    defaultStatus: 'draft',
    supportedActions: ['open', 'print', 'send', 'markSigned', 'duplicate', 'delete'],
    purpose: 'Фиксация возврата техники, состояния, повреждений и замечаний.',
  },
  work_order: {
    label: 'Заказ-наряд',
    icon: 'Wrench',
    color: 'orange',
    numberPrefix: 'ZN',
    allowedRoles: ['Администратор', 'Офис-менеджер', 'Механик'],
    requiredFields: ['serviceTicketId'],
    optionalFields: ['equipmentId', 'mechanicId', 'clientId', 'rentalId'],
    defaultStatus: 'draft',
    supportedActions: ['open', 'print', 'send', 'markSigned', 'duplicate', 'delete'],
    purpose: 'Работы, запчасти, механик, трудозатраты, итог ремонта.',
  },
  trip_ticket: {
    label: 'Путевой лист',
    icon: 'Route',
    color: 'cyan',
    numberPrefix: 'PL',
    allowedRoles: ['Администратор', 'Офис-менеджер', 'Механик'],
    requiredFields: ['mechanicId'],
    optionalFields: ['serviceCarId', 'serviceTicketId', 'deliveryId'],
    defaultStatus: 'draft',
    supportedActions: ['open', 'print', 'send', 'markSigned', 'duplicate', 'delete'],
    purpose: 'Автомобиль, водитель/механик, маршрут, пробег, топливо, цель поездки.',
  },
};

const LEGACY_DOCUMENT_TYPE_CONFIG = {
  contract: { label: 'Договор', prefix: 'CONTRACT' },
  commercial_offer: { label: 'Коммерческое предложение', prefix: 'KP' },
  act: { label: 'Акт', prefix: 'ACT' },
  upd: { label: 'УПД', prefix: 'UPD' },
  invoice: { label: 'Счёт', prefix: 'INVOICE' },
  service_act: { label: 'Сервисный акт', prefix: 'SERVICE' },
  debt_notification: { label: 'Уведомление о задолженности', prefix: 'DEBTNOTICE' },
  pretrial_claim: { label: 'Досудебная претензия', prefix: 'CLAIM' },
  court_document: { label: 'Судебный документ', prefix: 'COURT' },
  court_decision: { label: 'Решение суда', prefix: 'DECISION' },
  enforcement_writ: { label: 'Исполнительный лист', prefix: 'WRIT' },
  other: { label: 'Прочее', prefix: 'DOC' },
};

const DOCUMENT_TYPE_CONFIG = {
  ...Object.fromEntries(Object.entries(DOCUMENT_TYPE_REGISTRY).map(([key, value]) => [
    key,
    { label: value.label, prefix: value.numberPrefix },
  ])),
  ...LEGACY_DOCUMENT_TYPE_CONFIG,
};

const DOCUMENT_TYPE_ALIASES = {
  quote: 'commercial_offer',
  kp: 'commercial_offer',
  'кп': 'commercial_offer',
  commercial_offer: 'commercial_offer',
  service: 'service_act',
  service_act: 'service_act',
  upd: 'upd',
  'упд': 'upd',
  contract: 'contract',
  rental: 'rental_contract',
  rental_contract: 'rental_contract',
  specification: 'rental_specification',
  spec: 'rental_specification',
  rental_specification: 'rental_specification',
  transfer_act: 'transfer_act_to_client',
  transfer_act_to_client: 'transfer_act_to_client',
  return_act: 'return_act_from_client',
  return_act_from_client: 'return_act_from_client',
  work_order: 'work_order',
  trip_ticket: 'trip_ticket',
};

function text(value) {
  return String(value ?? '').trim();
}

function normalizeDocumentType(value) {
  const key = text(value).toLowerCase();
  if (DOCUMENT_TYPE_ALIASES[key]) return DOCUMENT_TYPE_ALIASES[key];
  if (DOCUMENT_TYPE_CONFIG[key]) return key;
  return 'other';
}

function getDocumentTypeMeta(value) {
  const type = normalizeDocumentType(value);
  return DOCUMENT_TYPE_REGISTRY[type] || {
    label: DOCUMENT_TYPE_CONFIG[type]?.label || DOCUMENT_TYPE_CONFIG.other.label,
    icon: 'FileText',
    color: 'slate',
    numberPrefix: DOCUMENT_TYPE_CONFIG[type]?.prefix || DOCUMENT_TYPE_CONFIG.other.prefix,
    allowedRoles: ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'],
    requiredFields: [],
    optionalFields: [],
    defaultStatus: 'draft',
    supportedActions: ['open', 'print', 'send', 'markSigned', 'duplicate', 'delete'],
    purpose: 'Документ.',
  };
}

module.exports = {
  DOCUMENT_TYPE_REGISTRY,
  DOCUMENT_TYPE_CONFIG,
  normalizeDocumentType,
  getDocumentTypeMeta,
};
