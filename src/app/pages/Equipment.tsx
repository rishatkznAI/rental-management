import React from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Archive,
  BadgeDollarSign,
  Boxes,
  CalendarPlus,
  CheckCircle2,
  ClipboardList,
  FileText,
  History,
  PenLine,
  Plus,
  RotateCcw,
  Search,
  Truck,
  Wrench,
  type LucideIcon,
} from 'lucide-react';
import { Button } from '../components/ui/button';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import { getInvestorBinding, isInvestorUser, isWarrantyMechanicRole, normalizeUserRole } from '../lib/userStorage';
import { useEquipmentList } from '../hooks/useEquipment';
import { useGanttData, useRentalsList } from '../hooks/useRentals';
import { useDocumentsList } from '../hooks/useDocuments';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { equipmentService } from '../services/equipment.service';
import {
  ACTIVE_FLEET_LABELS,
  compareEquipmentByPriority,
  canEquipmentParticipateInRentals,
  EQUIPMENT_SALE_PDI_LABELS,
  normalizeEquipmentList,
} from '../lib/equipmentClassification';
import {
  buildEquipmentTabCounts,
  buildActiveRentalIndex,
  cleanText,
  documentMatchesEquipmentOrRentals,
  equipmentFilterReasons,
  equipmentMatchesInvestorBinding,
  enrichEquipment,
  formatPreviewDate,
  formatPreviewNumber,
  ganttRentalMatchesEquipment,
  getEquipmentCategoryLabel,
  getEquipmentDriveLabel,
  getEquipmentGsmDisplay,
  getEquipmentTypeGroup,
  getCurrentClassicRental,
  getCurrentGanttRental,
  getGanttRentalRouteId,
  getRegistryOwnerLabel,
  getRegistryPercent,
  getRegistryStatusKind,
  getOwnerLabel,
  getRentalStableIds,
  isEquipmentInventoryUnique,
  isOpenServiceTicket,
  isSaleRegistryEquipment,
  isSoldEquipment,
  lowerText,
  matchesDriveFilter,
  matchesEquipmentSearch,
  matchesEquipmentTypeFilter,
  matchesOwnerFilter,
  matchesStatusFilter,
  matchesTabType,
  rentalMatchesEquipment,
  serviceTicketMatchesEquipment,
} from './equipment/equipment.helpers';
import {
  DEFAULT_EQUIPMENT_PAGE_SIZE,
  EQUIPMENT_DRIVE_FILTER_OPTIONS,
  EQUIPMENT_EMPTY_STATE_COPY,
  EQUIPMENT_PAGE_SIZE_OPTIONS,
  EQUIPMENT_STATUS_BADGE_STYLES,
  EQUIPMENT_STATUS_FILTER_OPTIONS,
  EQUIPMENT_TABS,
  STANDARD_EQUIPMENT_TYPE_FILTER_OPTIONS,
} from './equipment/equipment.constants';
import { clampEquipmentPage, getEquipmentPageItems, getEquipmentPageRange } from './equipment/equipment.pagination';
import type {
  ActiveRentalIndex,
  EquipmentEmptyStateConfig,
  EquipmentPreviewQuickAction,
  EquipmentPreviewTab,
  EquipmentQuickViewPanelData,
  EquipmentRegistryStatusKind,
  EquipmentTab,
} from './equipment/equipment.types';
import { EquipmentFilters } from './equipment/EquipmentFilters';
import { EquipmentKpiCards, type EquipmentKpiCardConfig } from './equipment/EquipmentKpiCards';
import { EquipmentMobileCards } from './equipment/EquipmentMobileCards';
import { EquipmentQuickViewPanel } from './equipment/EquipmentQuickViewPanel';
import { EquipmentRegistryTable } from './equipment/EquipmentRegistryTable';
import { EquipmentStatusTabs } from './equipment/EquipmentStatusTabs';
import { findEquipmentTypeLabel, mergeEquipmentTypesWithExistingEquipment, useEquipmentTypeCatalog } from '../lib/equipmentTypes';
import { photoSource } from '../lib/media';
import { buildEquipmentQuickActions } from '../lib/quickActions.js';
import type {
  Document,
  Equipment as EquipmentEntity,
  EquipmentSalePdiStatus,
  PhotoReference,
  Rental,
  ServiceTicket,
  ShippingPhoto,
} from '../types';
import type { GanttRentalData } from '../mock-data';

type PermissionCan = ReturnType<typeof usePermissions>['can'];

const EQUIPMENT_REGISTRY_MATCH_OPTIONS = { canEquipmentParticipateInRentals };

function getPriorityAppearance(priority: EquipmentEntity['priority']) {
  if (priority === 'critical' || priority === 'high') {
    return 'bg-red-500/12 text-red-300';
  }
  if (priority === 'medium') {
    return 'bg-blue-500/12 text-blue-300';
  }
  return 'bg-emerald-500/12 text-emerald-300';
}

function getPriorityLabel(priority: EquipmentEntity['priority']) {
  const labels: Record<EquipmentEntity['priority'], string> = {
    low: 'Низкий',
    medium: 'Средний',
    high: 'Высокий',
    critical: 'Критический',
  };
  return labels[priority];
}

function getSalePdiAppearance(status: EquipmentSalePdiStatus = 'not_started') {
  if (status === 'ready') return 'bg-emerald-500/12 text-emerald-300';
  if (status === 'in_progress') return 'bg-orange-500/12 text-orange-300';
  if (status === 'issues') return 'bg-red-500/12 text-red-300';
  return 'bg-secondary text-muted-foreground';
}

function getEquipmentDetailPath(equipment: EquipmentEntity) {
  return isSaleRegistryEquipment(equipment)
    ? `/sales/equipment/${equipment.id}`
    : `/equipment/${equipment.id}`;
}

function getRegistryStatusLabel(equipment: EquipmentEntity, activeRentalIndex?: ActiveRentalIndex) {
  return EQUIPMENT_STATUS_BADGE_STYLES[getRegistryStatusKind(equipment, activeRentalIndex) as EquipmentRegistryStatusKind].label;
}

function getRegistryStatusAppearance(equipment: EquipmentEntity, activeRentalIndex?: ActiveRentalIndex) {
  return EQUIPMENT_STATUS_BADGE_STYLES[getRegistryStatusKind(equipment, activeRentalIndex) as EquipmentRegistryStatusKind].className;
}

function getPriorityDotClass(priority: EquipmentEntity['priority']) {
  if (priority === 'critical' || priority === 'high') return 'bg-red-500';
  if (priority === 'medium') return 'bg-blue-500';
  return 'bg-emerald-500';
}

function buildEquipmentContextPath(
  path: string,
  equipment: EquipmentEntity,
  extra?: Record<string, string | number | boolean | null | undefined>,
) {
  const params = new URLSearchParams();
  params.set('equipmentId', equipment.id);
  if (equipment.inventoryNumber) params.set('equipmentInv', equipment.inventoryNumber);
  Object.entries(extra || {}).forEach(([key, value]) => {
    const text = cleanText(value);
    if (text) params.set(key, text);
  });
  return `${path}?${params.toString()}`;
}

function getDocumentTypeLabel(document: Document) {
  const type = document.documentType || document.type;
  const labels: Record<string, string> = {
    contract: document.contractKind === 'supply' ? 'Договор поставки' : 'Договор аренды',
    commercial_offer: 'Коммерческое предложение',
    act: 'Акт',
    upd: 'УПД',
    invoice: 'Счёт',
    service_act: 'Акт сервиса',
    work_order: 'Наряд',
    debt_notification: 'Уведомление о долге',
    pretrial_claim: 'Претензия',
    court_document: 'Судебный документ',
    court_decision: 'Решение суда',
    enforcement_writ: 'Исполнительный лист',
    other: 'Документ',
  };
  return labels[type] || type || 'Документ';
}

function getDocumentNumber(document: Document) {
  return cleanText(document.documentNumber || document.number) || 'Без номера';
}

function getDocumentDate(document: Document) {
  return document.documentDate || document.date || document.createdAt || '';
}

function documentSearchText(document: Document) {
  return [
    document.type,
    document.documentType,
    document.contractKind,
    document.number,
    document.documentNumber,
    document.fileName,
    document.comment,
    document.equipment,
    document.serviceTicket,
    getDocumentTypeLabel(document),
  ].map(lowerText).join(' ');
}

function documentSlotCount(documents: Document[], slot: 'passport' | 'certificate' | 'commissioning' | 'sale') {
  return documents.filter((document) => {
    const text = documentSearchText(document);
    if (slot === 'passport') return text.includes('паспорт');
    if (slot === 'certificate') return text.includes('сертификат') || text.includes('certificate');
    if (slot === 'commissioning') return text.includes('акт ввода') || text.includes('ввод в эксплуатац');
    return text.includes('продаж') || text.includes('поставк') || text.includes('коммерческ') || text.includes('кп')
      || document.documentType === 'commercial_offer'
      || document.type === 'commercial_offer'
      || document.contractKind === 'supply';
  }).length;
}

function getGanttRentalStatusLabel(status: GanttRentalData['status']) {
  if (status === 'active') return 'Активна';
  if (status === 'created') return 'Бронь';
  if (status === 'returned') return 'Возвращена';
  if (status === 'closed') return 'Закрыта';
  return status;
}

function getClassicRentalStatusLabel(status: Rental['status']) {
  const labels: Record<Rental['status'], string> = {
    new: 'Новая',
    confirmed: 'Подтверждена',
    delivery: 'Доставка',
    active: 'Активна',
    return_planned: 'Возврат',
    closed: 'Закрыта',
  };
  return labels[status] || status;
}

function getServiceStatusLabel(status: ServiceTicket['status']) {
  const value = lowerText(status);
  if (value === 'new') return 'Новая';
  if (value === 'assigned') return 'Назначена';
  if (value === 'in_progress') return 'В работе';
  if (value === 'waiting_parts') return 'Ожидание запчастей';
  if (value === 'needs_revision') return 'На доработке';
  if (value === 'ready') return 'Готово';
  if (value === 'closed') return 'Закрыта';
  return cleanText(status) || 'Без статуса';
}

type EquipmentPreviewPhoto = {
  id: string;
  label: string;
  src: string;
  caption?: string;
  date?: string;
};

function collectEquipmentPreviewPhotos(
  equipment: EquipmentEntity,
  shippingPhotos: ShippingPhoto[],
  serviceTickets: ServiceTicket[],
) {
  const result: EquipmentPreviewPhoto[] = [];
  const seen = new Set<string>();

  const pushPhoto = (photo: PhotoReference | null | undefined, label: string, caption?: string, date?: string) => {
    const src = photoSource(photo);
    if (!src || seen.has(src)) return;
    seen.add(src);
    result.push({ id: `${label}:${result.length}`, label, caption, date, src });
  };

  pushPhoto(equipment.photo, 'Фото техники', `${equipment.manufacturer} ${equipment.model}`);

  Object.entries(equipment.acceptancePhotos || {}).forEach(([category, photos]) => {
    (Array.isArray(photos) ? photos : []).forEach(photo => pushPhoto(photo, 'Фото приёмки', category));
  });

  shippingPhotos.forEach((event) => {
    const label = event.type === 'receiving' ? 'Фото возврата' : 'Фото отгрузки';
    (event.photos || []).forEach(photo => pushPhoto(photo, label, event.damageDescription || event.comment, event.date));
    Object.entries(event.photoCategories || {}).forEach(([category, photos]) => {
      (Array.isArray(photos) ? photos : []).forEach(photo => pushPhoto(photo, label, category, event.date));
    });
  });

  serviceTickets.forEach((ticket) => {
    (ticket.repairPhotos?.before || []).forEach(photo => pushPhoto(photo, 'Фото дефектов', ticket.reason, ticket.createdAt));
    (ticket.repairPhotos?.after || []).forEach(photo => pushPhoto(photo, 'Фото после ремонта', ticket.reason, ticket.closedAt || ticket.completedAt));
  });

  return result;
}

type EquipmentTimelineItem = {
  id: string;
  date: string;
  title: string;
  description: string;
};

function buildEquipmentTimeline({
  equipment,
  documents,
  ganttRentals,
  rentals,
  serviceTickets,
}: {
  equipment: EquipmentEntity;
  documents: Document[];
  ganttRentals: GanttRentalData[];
  rentals: Rental[];
  serviceTickets: ServiceTicket[];
}) {
  const items: EquipmentTimelineItem[] = [];

  ganttRentals.forEach((rental) => {
    items.push({
      id: `gantt:${rental.id}`,
      date: rental.startDate,
      title: `Аренда: ${getGanttRentalStatusLabel(rental.status)}`,
      description: `${rental.client || 'Клиент не указан'} · ${formatPreviewDate(rental.startDate)} — ${formatPreviewDate(rental.endDate)}`,
    });
  });

  rentals.forEach((rental) => {
    items.push({
      id: `rental:${rental.id}`,
      date: rental.startDate,
      title: `Аренда: ${getClassicRentalStatusLabel(rental.status)}`,
      description: `${rental.client || 'Клиент не указан'} · ${formatPreviewDate(rental.startDate)} — ${formatPreviewDate(rental.actualReturnDate || rental.plannedReturnDate)}`,
    });
  });

  serviceTickets.forEach((ticket) => {
    items.push({
      id: `service:${ticket.id}`,
      date: ticket.createdAt || ticket.plannedDate || ticket.closedAt || '',
      title: `Сервис: ${getServiceStatusLabel(ticket.status)}`,
      description: ticket.reason || ticket.description || 'Сервисная заявка',
    });
  });

  documents.forEach((document) => {
    items.push({
      id: `document:${document.id}`,
      date: getDocumentDate(document),
      title: `Документ: ${getDocumentTypeLabel(document)}`,
      description: getDocumentNumber(document),
    });
  });

  (equipment.history || []).forEach((entry, index) => {
    items.push({
      id: `history:${index}`,
      date: entry.date,
      title: entry.type === 'system' ? 'Изменение статуса' : 'Комментарий',
      description: [entry.text, entry.author].filter(Boolean).join(' · '),
    });
  });

  (equipment.receiptHistory || []).forEach((entry, index) => {
    items.push({
      id: `sale:${index}`,
      date: entry.date,
      title: 'Продажное событие',
      description: [entry.oldStatusLabel, entry.newStatusLabel].filter(Boolean).join(' → ') || entry.comment || 'Изменение статуса продажи',
    });
  });

  if (isSaleRegistryEquipment(equipment)) {
    items.push({
      id: 'sale:current',
      date: equipment.acceptedAt || equipment.actualArrivalDate || equipment.plannedArrivalDate || '',
      title: 'Продажный статус',
      description: getRegistryStatusLabel(equipment),
    });
  }

  return items
    .filter(item => item.date || item.description)
    .sort((left, right) => new Date(right.date || 0).getTime() - new Date(left.date || 0).getTime())
    .slice(0, 18);
}

function canPerform(
  can: PermissionCan,
  action: Parameters<PermissionCan>[0],
  section: Parameters<PermissionCan>[1],
) {
  return typeof can === 'function' && Boolean(can(action, section));
}

function getSourceQuickAction(
  actions: Array<{ id?: string; to?: string; disabled?: boolean; reason?: string }>,
  id: string,
) {
  return actions.find(action => action?.id === id);
}

function buildEquipmentPreviewQuickActions({
  equipment,
  activeRentalIndex,
  can,
  canViewDocuments,
  canViewRentals,
  canViewService,
  currentRentalId,
  openServiceTicket,
  onShowHistory,
}: {
  equipment: EquipmentEntity;
  activeRentalIndex: ActiveRentalIndex;
  can: PermissionCan;
  canViewDocuments: boolean;
  canViewRentals: boolean;
  canViewService: boolean;
  currentRentalId: string;
  openServiceTicket: ServiceTicket | null;
  onShowHistory: () => void;
}) {
  const statusKind = getRegistryStatusKind(equipment, activeRentalIndex);
  const saleRegistry = isSaleRegistryEquipment(equipment);
  const quickActionSource = buildEquipmentQuickActions({
    equipment: { ...equipment, saleMode: saleRegistry },
    can,
    currentRental: currentRentalId ? { id: currentRentalId } : undefined,
  }) as Array<{ id?: string; to?: string; disabled?: boolean; reason?: string }>;
  const actions: EquipmentPreviewQuickAction[] = [];
  const detailPath = getEquipmentDetailPath(equipment);
  const editPath = `${detailPath}?action=edit`;
  const documentsPath = buildEquipmentContextPath('/documents', equipment);
  const serviceNewPath = buildEquipmentContextPath('/service/new', equipment);
  const salePath = `/sales/equipment/${encodeURIComponent(equipment.id)}`;
  const saleEditPath = `${salePath}?action=edit`;
  const createRentalAction = getSourceQuickAction(quickActionSource, 'equipment-create-rental');
  const createServiceAction = getSourceQuickAction(quickActionSource, 'equipment-create-service');
  const salePdiAction = getSourceQuickAction(quickActionSource, 'equipment-sale-pdi');
  const canViewSales = canPerform(can, 'view', 'sales');
  const canCreateSales = canPerform(can, 'create', 'sales');
  const canEditSales = canPerform(can, 'edit', 'sales');
  const canEditEquipment = canPerform(can, 'edit', 'equipment');
  const canCreateDocuments = canPerform(can, 'create', 'documents');
  const canManageSaleEquipment = canEditSales || canEditEquipment;

  const addDocumentsAction = (label = 'Документы') => {
    if (!canViewDocuments) return;
    actions.push({ id: 'documents', label, icon: FileText, to: documentsPath });
  };

  const addCreateServiceAction = () => {
    if (!canPerform(can, 'create', 'service')) return;
    actions.push({
      id: 'create-service',
      label: 'Создать сервисную заявку',
      icon: Wrench,
      to: createServiceAction?.to || serviceNewPath,
      tone: statusKind === 'service' ? 'default' : 'primary',
    });
  };

  if (statusKind === 'sold') {
    if (canViewSales) {
      actions.push({ id: 'open-sale', label: 'Открыть сделку/продажу', icon: BadgeDollarSign, to: salePath, tone: 'primary' });
    }
    addDocumentsAction('Документы продажи');
    actions.push({ id: 'history', label: 'История', icon: History, onClick: onShowHistory });
    if (canManageSaleEquipment && getSourceQuickAction(quickActionSource, 'equipment-sale-return')) {
      actions.push({
        id: 'return-to-sale',
        label: 'Вернуть в продажу',
        icon: RotateCcw,
        disabled: true,
        reason: 'Оформляется в полной карточке продажи',
      });
    }
    return actions;
  }

  if (statusKind === 'for_sale') {
    if (canViewSales) {
      actions.push({ id: 'open-sale', label: 'Открыть карточку продажи', icon: BadgeDollarSign, to: salePath, tone: 'primary' });
    }
    if (canViewSales && canCreateSales && canCreateDocuments) {
      actions.push({
        id: 'create-quote',
        label: 'Создать КП',
        icon: FileText,
        to: buildEquipmentContextPath('/documents', equipment, { action: 'create', type: 'commercial_offer' }),
      });
    }
    if (canManageSaleEquipment) {
      actions.push({
        id: 'edit-price',
        label: 'Редактировать цену',
        icon: PenLine,
        to: saleEditPath,
      });
      actions.push({
        id: 'remove-from-sale',
        label: 'Снять с продажи',
        icon: RotateCcw,
        disabled: true,
        reason: 'Статус продажи меняется в полной карточке продажи',
        tone: 'danger',
      });
    }
    if (canViewSales && canPerform(can, 'create', 'service')) {
      actions.push({
        id: 'create-pdi',
        label: 'Создать PDI',
        icon: Wrench,
        to: buildEquipmentContextPath('/service/new', equipment, { mode: 'sales_pdi' }),
        disabled: Boolean(salePdiAction?.disabled),
        reason: salePdiAction?.reason,
      });
    }
    addDocumentsAction();
    return actions;
  }

  if (statusKind === 'rented') {
    if (canViewRentals && currentRentalId) {
      actions.push({
        id: 'open-rental',
        label: 'Открыть аренду',
        icon: Truck,
        to: `/rentals/${encodeURIComponent(currentRentalId)}`,
        tone: 'primary',
      });
    }
    if (canPerform(can, 'edit', 'rentals') && currentRentalId) {
      actions.push({
        id: 'plan-return',
        label: 'Запланировать возврат',
        icon: RotateCcw,
        disabled: true,
        reason: 'Возврат планируется в карточке аренды',
      });
    }
    addCreateServiceAction();
    addDocumentsAction();
    return actions;
  }

  if (statusKind === 'service') {
    if (canViewService && openServiceTicket) {
      actions.push({
        id: 'open-service-ticket',
        label: 'Открыть заявку',
        icon: ClipboardList,
        to: `/service/${encodeURIComponent(openServiceTicket.id)}`,
        tone: 'primary',
      });
    }
    if (canPerform(can, 'edit', 'service') && openServiceTicket) {
      actions.push({
        id: 'assign-mechanic',
        label: 'Назначить механика',
        icon: PenLine,
        disabled: true,
        reason: 'Назначение выполняется в карточке заявки',
      });
    }
    if (canViewService) {
      actions.push({ id: 'repair-history', label: 'История ремонта', icon: History, onClick: onShowHistory });
    }
    addDocumentsAction();
    return actions;
  }

  if (statusKind === 'available') {
    if (canEditEquipment) {
      actions.push({ id: 'edit', label: 'Редактировать', icon: PenLine, to: editPath });
    }
    if (createRentalAction && canPerform(can, 'create', 'rentals')) {
      actions.push({
        id: 'create-rental',
        label: 'Создать аренду',
        icon: CalendarPlus,
        to: createRentalAction.to || buildEquipmentContextPath('/rentals/new', equipment),
        disabled: Boolean(createRentalAction.disabled),
        reason: createRentalAction.reason,
        tone: 'primary',
      });
    }
    addCreateServiceAction();
    if (canManageSaleEquipment) {
      actions.push({
        id: 'put-for-sale',
        label: 'Выставить на продажу',
        icon: BadgeDollarSign,
        disabled: true,
        reason: 'Перевод в продажу выполняется в полной карточке техники',
      });
    }
    addDocumentsAction();
    return actions;
  }

  if (statusKind === 'reserved') {
    if (canViewRentals && currentRentalId) {
      actions.push({
        id: 'open-reservation',
        label: 'Открыть бронь',
        icon: Truck,
        to: `/rentals/${encodeURIComponent(currentRentalId)}`,
        tone: 'primary',
      });
    }
    addCreateServiceAction();
    addDocumentsAction();
    return actions;
  }

  if (canPerform(can, 'edit', 'equipment')) {
    actions.push({ id: 'edit', label: 'Редактировать', icon: PenLine, to: editPath });
  }
  if (canViewRentals) {
    actions.push({ id: 'rental-history', label: 'История аренд', icon: History, onClick: onShowHistory });
  }
  addDocumentsAction();
  return actions;
}

function shouldLogWarrantyDebug() {
  return import.meta.env.DEV || window.localStorage.getItem('warrantyDebug') === '1';
}

function EmptyState({
  title,
  description,
  icon: Icon = Search,
  action,
}: {
  title: string;
  description?: string;
  icon?: LucideIcon;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex min-h-[260px] flex-col items-center justify-center rounded-2xl border border-border bg-card/95 px-4 py-12 text-center shadow-[0_20px_40px_-32px_rgba(15,23,42,0.95)]">
      <Icon className="mb-3 h-8 w-8 text-muted-foreground" />
      <h3 className="app-shell-title max-w-md text-base font-extrabold text-foreground">{title}</h3>
      {description ? (
        <p className="mt-1 max-w-md text-sm text-muted-foreground">{description}</p>
      ) : null}
      {action ? (
        <div className="mt-4 flex flex-wrap justify-center gap-2">{action}</div>
      ) : null}
    </div>
  );
}

function apiErrorMessage(error: unknown, fallback: string) {
  if (!error) return fallback;
  const status = typeof error === 'object' && error && 'status' in error ? `HTTP ${(error as { status?: number }).status}` : '';
  const message = error instanceof Error ? error.message : fallback;
  return [status, message].filter(Boolean).join(': ');
}

export default function Equipment() {
  const { user } = useAuth();
  const { can, canView, canReadCollection } = usePermissions();
  const canViewRentals = canView('rentals');
  const canViewService = canView('service');
  const canViewDocuments = canView('documents');
  const canViewSales = canView('sales');
  const canCreateEquipment = can('create', 'equipment');
  const normalizedRole = normalizeUserRole(user?.role);
  const canViewShippingPhotos = canReadCollection('shipping_photos');
  const [search, setSearch] = React.useState('');
  const [activeTab, setActiveTab] = React.useState<EquipmentTab>('all');
  const [statusFilter, setStatusFilter] = React.useState<string>('all');
  const [typeFilter, setTypeFilter] = React.useState<string>('all');
  const [driveFilter, setDriveFilter] = React.useState<string>('all');
  const [categoryFilter, setCategoryFilter] = React.useState<string>('all');
  const [fleetFilter, setFleetFilter] = React.useState<string>('all');
  const [ownerFilter, setOwnerFilter] = React.useState<string>('all');
  const [locationFilter, setLocationFilter] = React.useState<string>('all');
  const [showFilters, setShowFilters] = React.useState(false);
  const [pageSize, setPageSize] = React.useState(DEFAULT_EQUIPMENT_PAGE_SIZE);
  const [currentPage, setCurrentPage] = React.useState(1);
  const equipmentQuery = useEquipmentList();
  const ganttQuery = useGanttData({ enabled: canViewRentals });
  const rentalsQuery = useRentalsList({ enabled: canViewRentals });
  const documentsQuery = useDocumentsList({ enabled: canViewDocuments });
  const serviceTicketsQuery = useServiceTicketsList({ enabled: canViewService });
  const equipmentList = equipmentQuery.data ?? [];
  const ganttRentals = ganttQuery.data ?? [];
  const rentals = rentalsQuery.data ?? [];
  const documents = documentsQuery.data ?? [];
  const serviceTickets = serviceTicketsQuery.data ?? [];
  const equipmentTypeCatalog = useEquipmentTypeCatalog();
  const [selectedEquipmentId, setSelectedEquipmentId] = React.useState<string | null>(null);
  const [activeQuickViewTab, setActiveQuickViewTab] = React.useState<EquipmentPreviewTab>('overview');
  const investorBinding = React.useMemo(() => getInvestorBinding({
    role: normalizedRole,
    status: 'Активен',
    ownerId: user?.ownerId,
    ownerName: user?.ownerName,
    name: user?.name,
  }), [normalizedRole, user?.name, user?.ownerId, user?.ownerName]);
  const isInvestorScope = isInvestorUser({
    role: normalizedRole,
    status: 'Активен',
    ownerId: user?.ownerId,
    ownerName: user?.ownerName,
    name: user?.name,
  });
  const scopedEquipmentList = React.useMemo(
    () => isInvestorScope && investorBinding
      ? equipmentList.filter(item => equipmentMatchesInvestorBinding(item, investorBinding))
      : equipmentList,
    [equipmentList, investorBinding, isInvestorScope],
  );

  const enrichedEquipmentList = React.useMemo(
    () => normalizeEquipmentList(enrichEquipment(scopedEquipmentList, ganttRentals)),
    [scopedEquipmentList, ganttRentals],
  );
  const activeRentalIndex = React.useMemo(
    () => buildActiveRentalIndex(enrichedEquipmentList, ganttRentals),
    [enrichedEquipmentList, ganttRentals],
  );
  const selectedEquipment = React.useMemo(
    () => enrichedEquipmentList.find(equipment => equipment.id === selectedEquipmentId) ?? null,
    [enrichedEquipmentList, selectedEquipmentId],
  );
  const shippingPhotosQuery = useQuery({
    queryKey: ['shippingPhotos', selectedEquipment?.id],
    queryFn: () => equipmentService.getShippingPhotos(String(selectedEquipment?.id ?? '')),
    enabled: Boolean(selectedEquipment?.id && canViewShippingPhotos),
  });
  const selectedShippingPhotos = shippingPhotosQuery.data ?? [];

  React.useEffect(() => {
    if (selectedEquipmentId && !selectedEquipment) {
      setSelectedEquipmentId(null);
    }
  }, [selectedEquipment, selectedEquipmentId]);

  React.useEffect(() => {
    setActiveQuickViewTab('overview');
  }, [selectedEquipmentId]);

  const locationOptions = React.useMemo(
    () => Array.from(new Set(enrichedEquipmentList.map((eq) => eq.location).filter(Boolean))).sort(),
    [enrichedEquipmentList],
  );
  const equipmentTypeOptions = React.useMemo(
    () => mergeEquipmentTypesWithExistingEquipment(equipmentTypeCatalog, enrichedEquipmentList),
    [enrichedEquipmentList, equipmentTypeCatalog],
  );
  const categoryOptions = React.useMemo(() => {
    const base = ['own', 'client', 'partner', 'sold'];
    const values = new Set<string>(base);
    enrichedEquipmentList.forEach((equipment) => {
      const value = String(equipment.category ?? '').trim();
      if (value) values.add(value);
    });
    return Array.from(values).map((value) => ({ value, label: getEquipmentCategoryLabel(value) }));
  }, [enrichedEquipmentList]);
  const typeFilterOptions = React.useMemo(() => {
    const result = [...STANDARD_EQUIPMENT_TYPE_FILTER_OPTIONS];
    const existingValues = new Set(result.map((option) => option.value));
    for (const item of equipmentTypeOptions) {
      if (getEquipmentTypeGroup(item.value, equipmentTypeOptions) !== 'other') continue;
      const value = `exact:${item.value}`;
      if (existingValues.has(value)) continue;
      existingValues.add(value);
      result.push({ value, label: item.label });
    }
    return result;
  }, [equipmentTypeOptions]);
  const ownerOptions = React.useMemo(() => {
    const base = [
      { value: 'own', label: 'Собственная' },
      { value: 'investor', label: 'Инвестор' },
      { value: 'sublease', label: 'Субаренда' },
    ];
    const seen = new Set(base.map((option) => option.value));
    const result = [...base];

    for (const equipment of enrichedEquipmentList) {
      const owner = String(equipment.owner ?? '').trim();
      if (owner && !seen.has(owner)) {
        seen.add(owner);
        result.push({ value: owner, label: getOwnerLabel(owner) });
      }

      const ownerName = String(equipment.ownerName ?? '').trim();
      if (!ownerName) continue;
      const value = `ownerName:${ownerName}`;
      if (seen.has(value)) continue;
      seen.add(value);
      result.push({ value, label: ownerName });
    }

    return result;
  }, [enrichedEquipmentList]);

  const quickViewPanelData = React.useMemo<EquipmentQuickViewPanelData | null>(() => {
    if (!selectedEquipment) return null;

    const inventoryIsUnique = isEquipmentInventoryUnique(selectedEquipment, enrichedEquipmentList);
    const relatedGanttRentals = canViewRentals
      ? ganttRentals.filter(rental => ganttRentalMatchesEquipment(rental, selectedEquipment, inventoryIsUnique))
      : [];
    const relatedRentals = canViewRentals
      ? rentals.filter(rental => rentalMatchesEquipment(rental, selectedEquipment, inventoryIsUnique))
      : [];
    const rentalIds = getRentalStableIds(relatedRentals, relatedGanttRentals);
    const relatedDocuments = canViewDocuments
      ? documents
        .filter(document => documentMatchesEquipmentOrRentals(document, selectedEquipment, inventoryIsUnique, rentalIds))
        .sort((left, right) => getDocumentDate(right).localeCompare(getDocumentDate(left)))
      : [];
    const relatedServiceTickets = canViewService
      ? serviceTickets
        .filter(ticket => serviceTicketMatchesEquipment(ticket, selectedEquipment, inventoryIsUnique))
        .sort((left, right) => cleanText(right.createdAt || right.plannedDate).localeCompare(cleanText(left.createdAt || left.plannedDate)))
      : [];
    const currentGanttRental = getCurrentGanttRental(relatedGanttRentals);
    const currentClassicRental = getCurrentClassicRental(relatedRentals);
    const currentRentalId = getGanttRentalRouteId(currentGanttRental) || cleanText(currentClassicRental?.id);
    const openServiceTicket = relatedServiceTickets.find(isOpenServiceTicket) ?? null;
    const title = [selectedEquipment.manufacturer, selectedEquipment.model].filter(Boolean).join(' ') || 'Без модели';
    const equipmentPhotoSrc = photoSource(selectedEquipment.photo);
    const previewPhotos = canViewShippingPhotos
      ? collectEquipmentPreviewPhotos(selectedEquipment, selectedShippingPhotos, relatedServiceTickets)
      : equipmentPhotoSrc
        ? [{ id: 'main-photo', label: 'Фото техники', src: equipmentPhotoSrc, caption: title }]
        : [];
    const timeline = buildEquipmentTimeline({
      equipment: selectedEquipment,
      documents: relatedDocuments,
      ganttRentals: relatedGanttRentals,
      rentals: relatedRentals,
      serviceTickets: relatedServiceTickets,
    });
    const detailPath = getEquipmentDetailPath(selectedEquipment);
    const mainPhoto = previewPhotos[0]?.src || equipmentPhotoSrc;
    const gsmDisplay = getEquipmentGsmDisplay(selectedEquipment);
    const statusLabel = getRegistryStatusLabel(selectedEquipment, activeRentalIndex);
    const equipmentTypeLabel = findEquipmentTypeLabel(selectedEquipment.type, equipmentTypeOptions);
    const driveLabel = getEquipmentDriveLabel(selectedEquipment.drive);
    const docsPath = `/documents?equipmentId=${encodeURIComponent(selectedEquipment.id)}&equipmentInv=${encodeURIComponent(selectedEquipment.inventoryNumber || '')}`;
    const saleDocumentsCount = isSoldEquipment(selectedEquipment) || isSaleRegistryEquipment(selectedEquipment)
      ? documentSlotCount(relatedDocuments, 'sale')
      : null;
    const quickActions = buildEquipmentPreviewQuickActions({
      equipment: selectedEquipment,
      activeRentalIndex,
      can,
      canViewDocuments,
      canViewRentals,
      canViewService,
      currentRentalId,
      openServiceTicket,
      onShowHistory: () => setActiveQuickViewTab('history'),
    });

    return {
      title,
      detailPath,
      mainPhoto,
      statusLabel,
      statusClassName: getRegistryStatusAppearance(selectedEquipment, activeRentalIndex),
      inventoryNumber: selectedEquipment.inventoryNumber,
      serialNumber: selectedEquipment.serialNumber,
      quickActions,
      overviewFields: [
        { label: 'Статус', value: statusLabel },
        { label: 'Категория', value: getEquipmentCategoryLabel(selectedEquipment.category) },
        { label: 'Тип / привод', value: `${equipmentTypeLabel} · ${driveLabel}` },
        { label: 'Собственник', value: getRegistryOwnerLabel(selectedEquipment) },
        { label: 'Локация', value: selectedEquipment.location || '—' },
        { label: 'GSM', value: gsmDisplay.label },
        { label: 'Приоритет', value: getPriorityLabel(selectedEquipment.priority) },
        { label: 'Наработка', value: formatPreviewNumber(selectedEquipment.hours, ' м/ч') },
      ],
      specFields: [
        { label: 'Рабочая высота', value: formatPreviewNumber(selectedEquipment.workingHeight, ' м') },
        { label: 'Высота платформы', value: formatPreviewNumber(selectedEquipment.liftHeight, ' м') },
        { label: 'Грузоподъёмность', value: formatPreviewNumber(selectedEquipment.loadCapacity, ' кг') },
        { label: 'Масса', value: formatPreviewNumber(selectedEquipment.weight, ' кг') },
        { label: 'Габариты', value: selectedEquipment.dimensions || '—' },
        { label: 'Год выпуска', value: selectedEquipment.year || '—' },
        { label: 'Наработка', value: formatPreviewNumber(selectedEquipment.hours, ' м/ч') },
        { label: 'Питание', value: driveLabel },
      ],
      canViewDocuments,
      documentSlots: [
        { label: 'Паспорт', count: documentSlotCount(relatedDocuments, 'passport') },
        { label: 'Сертификат', count: documentSlotCount(relatedDocuments, 'certificate') },
        { label: 'Акт ввода', count: documentSlotCount(relatedDocuments, 'commissioning') },
        ...(saleDocumentsCount === null ? [] : [{ label: 'Договор / документы продажи', count: saleDocumentsCount }]),
      ],
      documents: relatedDocuments.map(document => ({
        id: document.id,
        typeLabel: getDocumentTypeLabel(document),
        number: getDocumentNumber(document),
        dateLabel: formatPreviewDate(getDocumentDate(document)),
      })),
      docsPath,
      canViewPhotos: canViewShippingPhotos,
      photos: previewPhotos.map(photo => ({
        id: photo.id,
        label: photo.label,
        src: photo.src,
        metaLabel: [photo.caption, formatPreviewDate(photo.date)].filter(value => value && value !== '—').join(' · ') || '—',
      })),
      timeline: timeline.map(item => ({
        id: item.id,
        title: item.title,
        description: item.description,
        dateLabel: formatPreviewDate(item.date),
      })),
    };
  }, [
    activeRentalIndex,
    can,
    canViewDocuments,
    canViewRentals,
    canViewService,
    canViewShippingPhotos,
    documents,
    enrichedEquipmentList,
    equipmentTypeOptions,
    ganttRentals,
    rentals,
    selectedEquipment,
    selectedShippingPhotos,
    serviceTickets,
  ]);

  const filteredEquipment = React.useMemo(() => (
    enrichedEquipmentList
      .filter((equipment) => {
        const matchesSearch = matchesEquipmentSearch(equipment, search);
        const matchesStatus = matchesStatusFilter(equipment, statusFilter, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS);
        const matchesType = matchesEquipmentTypeFilter(equipment, typeFilter, equipmentTypeOptions);
        const matchesDrive = matchesDriveFilter(equipment, driveFilter);
        const matchesCategory = categoryFilter === 'all' || equipment.category === categoryFilter;
        const matchesFleet = fleetFilter === 'all' || String(equipment.activeInFleet) === fleetFilter;
        const matchesOwner = matchesOwnerFilter(equipment, ownerFilter);
        const matchesLocation = locationFilter === 'all' || equipment.location === locationFilter;

        return matchesSearch
          && matchesStatus
          && matchesType
          && matchesDrive
          && matchesCategory
          && matchesFleet
          && matchesOwner
          && matchesLocation
          && matchesTabType(equipment, activeTab, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS);
      })
      .sort(compareEquipmentByPriority)
  ), [
    activeTab,
    activeRentalIndex,
    categoryFilter,
    driveFilter,
    enrichedEquipmentList,
    equipmentTypeOptions,
    fleetFilter,
    locationFilter,
    ownerFilter,
    search,
    statusFilter,
    typeFilter,
  ]);

  React.useEffect(() => {
    if (!shouldLogWarrantyDebug() || !isWarrantyMechanicRole(user?.role)) return;
    const byTab = Object.fromEntries(
      EQUIPMENT_TABS.map((tab) => [
        tab.key,
        enrichedEquipmentList.filter((item) => matchesTabType(item, tab.key, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS)).length,
      ]),
    );
    const filters = {
      activeTab,
      search,
      categoryFilter,
      fleetFilter,
      statusFilter,
      typeFilter,
      ownerFilter,
      driveFilter,
      locationFilter,
      activeRentalIndex,
      equipmentTypeOptions,
      registryOptions: EQUIPMENT_REGISTRY_MATCH_OPTIONS,
    };
    const excluded = enrichedEquipmentList
      .map(item => ({ id: item.id, inventoryNumber: item.inventoryNumber, reasons: equipmentFilterReasons(item, filters) }))
      .filter(item => item.reasons.length > 0)
      .slice(0, 5);
    console.debug('[warranty-mechanic/equipment]', {
      rawRole: user?.rawRole ?? user?.role,
      normalizedRole: normalizeUserRole(user?.role),
      beforeFilters: enrichedEquipmentList.length,
      afterFilters: filteredEquipment.length,
      activeTab,
      byTab,
      filters,
      excluded,
    });
  }, [
    activeTab,
    activeRentalIndex,
    categoryFilter,
    driveFilter,
    enrichedEquipmentList,
    equipmentTypeOptions,
    filteredEquipment.length,
    fleetFilter,
    locationFilter,
    ownerFilter,
    search,
    statusFilter,
    typeFilter,
    user?.rawRole,
    user?.role,
  ]);

  const tabCounts = React.useMemo(() => (
    buildEquipmentTabCounts(enrichedEquipmentList, EQUIPMENT_TABS, activeRentalIndex, EQUIPMENT_REGISTRY_MATCH_OPTIONS)
  ), [activeRentalIndex, enrichedEquipmentList]);
  const totalPark = tabCounts.all ?? 0;
  const activeTabTotal = tabCounts[activeTab] ?? 0;
  const kpiCards = React.useMemo<EquipmentKpiCardConfig[]>(() => [
    {
      title: 'Всего техники',
      value: totalPark,
      caption: 'Единиц в реестре',
      icon: Boxes,
      tone: 'neutral',
    },
    {
      title: 'Свободна',
      value: tabCounts.available ?? 0,
      caption: 'Доля от общего парка',
      icon: CheckCircle2,
      tone: 'available',
      percent: getRegistryPercent(tabCounts.available ?? 0, totalPark),
    },
    {
      title: 'В аренде',
      value: tabCounts.rented ?? 0,
      caption: 'Доля от общего парка',
      icon: Truck,
      tone: 'rented',
      percent: getRegistryPercent(tabCounts.rented ?? 0, totalPark),
    },
    {
      title: 'В сервисе',
      value: tabCounts.service ?? 0,
      caption: 'Доля от общего парка',
      icon: Wrench,
      tone: 'service',
      percent: getRegistryPercent(tabCounts.service ?? 0, totalPark),
    },
    {
      title: 'На продажу',
      value: tabCounts.for_sale ?? 0,
      caption: 'Доля от общего парка',
      icon: BadgeDollarSign,
      tone: 'sale',
      percent: getRegistryPercent(tabCounts.for_sale ?? 0, totalPark),
    },
    {
      title: 'Проданная',
      value: tabCounts.sold ?? 0,
      caption: 'Доля от общего парка',
      icon: Archive,
      tone: 'sold',
      percent: getRegistryPercent(tabCounts.sold ?? 0, totalPark),
    },
  ], [tabCounts, totalPark]);
  const activeFilterCount = [
    search.trim() !== '',
    categoryFilter !== 'all',
    fleetFilter !== 'all',
    statusFilter !== 'all',
    typeFilter !== 'all',
    ownerFilter !== 'all',
    driveFilter !== 'all',
    locationFilter !== 'all',
  ].filter(Boolean).length;

  const resetFilters = () => {
    setSearch('');
    setCategoryFilter('all');
    setFleetFilter('all');
    setStatusFilter('all');
    setTypeFilter('all');
    setDriveFilter('all');
    setOwnerFilter('all');
    setLocationFilter('all');
  };

  const isEquipmentLoading = equipmentQuery.isLoading || (canViewRentals && ganttQuery.isLoading);
  const emptyState: EquipmentEmptyStateConfig = (() => {
    if (isEquipmentLoading && totalPark === 0) {
      return {
        ...EQUIPMENT_EMPTY_STATE_COPY.loading,
        icon: Boxes,
      };
    }

    if (totalPark === 0) {
      return {
        ...EQUIPMENT_EMPTY_STATE_COPY.emptyRegistry,
        icon: Boxes,
        action: canCreateEquipment ? (
          <Link to="/equipment/new">
            <Button className="app-button-primary rounded-xl px-4">
              <Plus className="h-4 w-4" />
              Добавить технику
            </Button>
          </Link>
        ) : undefined,
      };
    }

    if (activeTab === 'for_sale' && activeTabTotal === 0) {
      return {
        ...EQUIPMENT_EMPTY_STATE_COPY.forSaleEmpty,
        icon: BadgeDollarSign,
        action: canViewSales ? (
          <Link to="/sales">
            <Button variant="outline" className="rounded-xl px-4">
              <BadgeDollarSign className="h-4 w-4" />
              Перейти к продажам
            </Button>
          </Link>
        ) : undefined,
      };
    }

    if (activeTab === 'sold' && activeTabTotal === 0) {
      return {
        ...EQUIPMENT_EMPTY_STATE_COPY.soldEmpty,
        icon: Archive,
      };
    }

    return {
      ...EQUIPMENT_EMPTY_STATE_COPY.noResults,
      icon: Search,
      action: activeFilterCount > 0 ? (
        <Button type="button" variant="outline" className="rounded-xl px-4" onClick={resetFilters}>
          <RotateCcw className="h-4 w-4" />
          Сбросить фильтры
        </Button>
      ) : undefined,
    };
  })();

  const isSaleTab = activeTab === 'for_sale' || activeTab === 'sold';
  const totalVisible = filteredEquipment.length;
  const { totalPages, visibleCurrentPage, pageStart, pageEnd } = getEquipmentPageRange(totalVisible, currentPage, pageSize);
  const paginatedEquipment = React.useMemo(
    () => getEquipmentPageItems(filteredEquipment, visibleCurrentPage, pageSize),
    [filteredEquipment, pageSize, visibleCurrentPage],
  );

  React.useEffect(() => {
    setCurrentPage(1);
  }, [
    activeTab,
    categoryFilter,
    driveFilter,
    fleetFilter,
    locationFilter,
    ownerFilter,
    search,
    statusFilter,
    typeFilter,
  ]);

  React.useEffect(() => {
    setCurrentPage((page) => clampEquipmentPage(page, totalPages));
  }, [totalPages]);

  return (
    <div className="space-y-5 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <section className="app-panel overflow-hidden">
        <div className="border-b border-border/80 px-5 py-5 sm:px-6">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
            <div>
              <h1 className="app-shell-title text-3xl font-extrabold text-foreground">Техника</h1>
              <p className="mt-2 text-sm text-muted-foreground">Единый реестр физических единиц техники</p>
            </div>
            {canCreateEquipment && (
              <Link to="/equipment/new">
                <Button size="sm" className="app-button-primary rounded-xl px-4">
                  <Plus className="h-4 w-4" />
                  Добавить технику
                </Button>
              </Link>
            )}
          </div>

          <EquipmentStatusTabs
            activeTab={activeTab}
            tabs={EQUIPMENT_TABS}
            counts={tabCounts}
            onTabChange={setActiveTab}
          />

          <EquipmentKpiCards cards={kpiCards} />
        </div>

        <EquipmentFilters
          search={search}
          onSearchChange={setSearch}
          activeFilterCount={activeFilterCount}
          open={showFilters}
          onOpenChange={setShowFilters}
          onReset={resetFilters}
          categoryFilter={categoryFilter}
          onCategoryFilterChange={setCategoryFilter}
          fleetFilter={fleetFilter}
          onFleetFilterChange={setFleetFilter}
          statusFilter={statusFilter}
          onStatusFilterChange={setStatusFilter}
          typeFilter={typeFilter}
          onTypeFilterChange={setTypeFilter}
          ownerFilter={ownerFilter}
          onOwnerFilterChange={setOwnerFilter}
          driveFilter={driveFilter}
          onDriveFilterChange={setDriveFilter}
          locationFilter={locationFilter}
          onLocationFilterChange={setLocationFilter}
          categoryOptions={categoryOptions}
          statusOptions={EQUIPMENT_STATUS_FILTER_OPTIONS}
          typeOptions={typeFilterOptions}
          ownerOptions={ownerOptions}
          driveOptions={EQUIPMENT_DRIVE_FILTER_OPTIONS}
          locationOptions={locationOptions}
          activeFleetLabels={ACTIVE_FLEET_LABELS}
        />
      </section>

      {(equipmentQuery.error || ganttQuery.error) && (
        <section className="rounded-2xl border border-red-500/30 bg-red-500/10 p-4 text-sm text-red-100">
          <div className="font-semibold">Не удалось загрузить данные техники</div>
          <div className="mt-1 text-red-100/80">
            {apiErrorMessage(equipmentQuery.error || ganttQuery.error, 'Проверьте доступ к /api/equipment и /api/gantt_rentals.')}
          </div>
          {isWarrantyMechanicRole(user?.role) && (
            <div className="mt-2 text-red-100/80">
              Для диагностики под этим пользователем откройте в Network `GET /api/access-diagnostics`.
            </div>
          )}
        </section>
      )}

      <div className="space-y-3 sm:hidden">
        {totalVisible === 0 ? (
          <EmptyState {...emptyState} />
        ) : (
          <EquipmentMobileCards
            equipmentItems={paginatedEquipment}
            isSaleTab={isSaleTab}
            activeRentalIndex={activeRentalIndex}
            getEquipmentDetailPath={getEquipmentDetailPath}
            getEquipmentTypeLabel={(equipment) => findEquipmentTypeLabel(equipment.type, equipmentTypeOptions)}
            getEquipmentDriveLabel={getEquipmentDriveLabel}
            getRegistryStatusLabel={getRegistryStatusLabel}
            getRegistryStatusAppearance={getRegistryStatusAppearance}
            getPriorityLabel={getPriorityLabel}
            getPriorityAppearance={getPriorityAppearance}
            getSalePdiAppearance={getSalePdiAppearance}
            isSaleRegistryEquipment={isSaleRegistryEquipment}
            salePdiLabels={EQUIPMENT_SALE_PDI_LABELS}
          />
        )}
      </div>

      <section className="hidden overflow-hidden rounded-2xl border border-border bg-card/95 shadow-[0_20px_40px_-32px_rgba(15,23,42,0.95)] sm:block">
        {totalVisible === 0 ? (
          <div className="p-6"><EmptyState {...emptyState} /></div>
        ) : (
          <EquipmentRegistryTable
            equipmentItems={paginatedEquipment}
            activeRentalIndex={activeRentalIndex}
            selectedEquipmentId={selectedEquipmentId}
            onSelectEquipment={(equipment) => setSelectedEquipmentId(equipment.id)}
            getEquipmentDetailPath={getEquipmentDetailPath}
            getEquipmentTypeLabel={(equipment) => findEquipmentTypeLabel(equipment.type, equipmentTypeOptions)}
            getEquipmentDriveLabel={getEquipmentDriveLabel}
            getRegistryStatusLabel={getRegistryStatusLabel}
            getRegistryStatusAppearance={getRegistryStatusAppearance}
            getEquipmentCategoryLabel={getEquipmentCategoryLabel}
            getRegistryOwnerLabel={getRegistryOwnerLabel}
            getPriorityLabel={getPriorityLabel}
            getPriorityDotClass={getPriorityDotClass}
            getEquipmentGsmDisplay={getEquipmentGsmDisplay}
          />
        )}
      </section>

      {quickViewPanelData ? (
        <EquipmentQuickViewPanel
          selectedEquipment={selectedEquipment}
          activeTab={activeQuickViewTab}
          onTabChange={setActiveQuickViewTab}
          onClose={() => setSelectedEquipmentId(null)}
          {...quickViewPanelData}
        />
      ) : null}

      <div className="flex flex-col gap-3 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div>
          {totalVisible > 0
            ? `Показано ${pageStart}–${pageEnd} из ${totalVisible} найденных, всего в базе ${scopedEquipmentList.length}`
            : `Найдено 0 из ${scopedEquipmentList.length} единиц техники`}
        </div>
        {totalVisible > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <span>Строк на странице</span>
            <select
              value={pageSize}
              onChange={(event) => {
                setPageSize(Number(event.target.value));
                setCurrentPage(1);
              }}
              className="h-9 rounded-lg border border-border bg-secondary px-2 text-sm text-foreground outline-none transition focus:border-primary"
            >
              {EQUIPMENT_PAGE_SIZE_OPTIONS.map((size) => (
                <option key={size} value={size}>{size}</option>
              ))}
            </select>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={visibleCurrentPage <= 1}
              onClick={() => setCurrentPage((page) => clampEquipmentPage(page - 1, totalPages))}
            >
              Назад
            </Button>
            <span className="min-w-[72px] text-center tabular-nums text-foreground">
              {visibleCurrentPage} / {totalPages}
            </span>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={visibleCurrentPage >= totalPages}
              onClick={() => setCurrentPage((page) => clampEquipmentPage(page + 1, totalPages))}
            >
              Вперёд
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
