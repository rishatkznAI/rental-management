import type { DocumentType } from '../types';

export type DocumentRegistryItem = {
  type: DocumentType;
  label: string;
  icon: string;
  color: string;
  numberPrefix: string;
  allowedRoles: string[];
  requiredFields: string[];
  optionalFields: string[];
  defaultStatus: string;
  supportedActions: string[];
  purpose: string;
};

export const DOCUMENT_TYPE_REGISTRY: Record<string, DocumentRegistryItem> = {
  rental_contract: {
    type: 'rental_contract',
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
    type: 'rental_specification',
    label: 'Спецификация к договору',
    icon: 'ClipboardList',
    color: 'indigo',
    numberPrefix: 'SP',
    allowedRoles: ['Администратор', 'Офис-менеджер', 'Менеджер по аренде'],
    requiredFields: ['clientId', 'rentalId'],
    optionalFields: ['parentDocumentId', 'equipmentId'],
    defaultStatus: 'draft',
    supportedActions: ['open', 'print', 'send', 'markSigned', 'duplicate', 'delete'],
    purpose: 'Приложение к договору с техникой, сроком, ценой и условиями.',
  },
  transfer_act_to_client: {
    type: 'transfer_act_to_client',
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
    type: 'return_act_from_client',
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
    type: 'work_order',
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
    type: 'trip_ticket',
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

export const DOCUMENT_WORKSPACE_TYPES = Object.values(DOCUMENT_TYPE_REGISTRY);

export function getDocumentRegistryItem(type?: string | null): DocumentRegistryItem | undefined {
  return DOCUMENT_TYPE_REGISTRY[String(type || '')];
}
