import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import {
  X, CreditCard, FileText, User, MessageSquare,
  ArrowRight, RotateCcw, CirclePause as PauseCircle,
  CircleCheck, CircleAlert, Clock, Trash2, Plus, ChevronDown, ChevronUp,
  CalendarClock, LogOut, Edit, Wrench, Truck, Printer, Eye
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../ui/dialog';
import { formatCurrency, formatDate, formatDateTime } from '../../lib/utils';
import { findConflictingRental } from '../../lib/rental-conflicts';
import { animationDurations, useAnimatedPresence } from '../../lib/animations';
import { resolveRentalByAnyId } from '../../lib/rentalNavigation.js';
import { buildDocumentControl } from '../../lib/documentControl.js';
import {
  buildExtensionConflictDisplay,
  getRentalExtensionValidation,
} from '../../lib/rentalExtension.js';
import { RENTAL_KEYS } from '../../hooks/useRentals';
import { rentalsService } from '../../services/rentals.service';
import { documentsService } from '../../services/documents.service';
import { openPrintableHtml } from '../../lib/serviceWorkOrder';
import type { RentalExtensionResponse } from '../../services/rentals.service';
import type { GanttRentalData } from '../../mock-data';
import type { Client, Delivery, Document, Equipment, Payment, Rental, ServiceTicket } from '../../types';
import type { ClientReceivableRow } from '../../lib/finance';
import { getEffectivePaidAmount } from '../../lib/finance';
import { filterRentalManagerUsers, type SystemUser } from '../../lib/userStorage';
import { buildRentalServiceAlert, type RentalServiceAlertSeverity } from '../../lib/rentalServiceAlert';
import { calculateRentalBilling, calculateRentalDowntimeSummary, getDowntimeRentalDays, normalizeRentalDowntimePeriods } from '../../lib/rentalDowntimeFlow.js';
import type { DowntimePeriod } from '../../mock-data';

interface RentalDrawerProps {
  rental: GanttRentalData | null;
  equipment: Equipment | undefined;
  allRentals: GanttRentalData[];
  classicRentals?: Rental[];
  payments: Payment[];
  documents?: Document[];
  serviceTickets?: ServiceTicket[];
  clients?: Client[];
  deliveries?: Delivery[];
  clientReceivables?: ClientReceivableRow[];
  managers?: SystemUser[];
  canEditRentals: boolean;
  canEditRentalDates: boolean;
  dateConflictsRequireApproval?: boolean;
  canReassignManager: boolean;
  canRestoreRentals: boolean;
  canDeleteRentals: boolean;
  canViewMoney?: boolean;
  canCreatePayments: boolean;
  canCreateDocuments?: boolean;
  canCreateDeliveries?: boolean;
  canCreateService?: boolean;
  onClose: () => void;
  onReturn: (rental: GanttRentalData) => void;
  onDowntime: (rental: GanttRentalData, downtime?: DowntimePeriod) => void;
  onStatusChange: (rental: GanttRentalData) => void;
  onRestore: (rental: GanttRentalData) => void;
  onDelete: (rental: GanttRentalData) => void;
  onUpdate: (rental: GanttRentalData, data: Partial<GanttRentalData>) => void;
  onAddComment: (rental: GanttRentalData, text: string) => void;
  onAddPayment: (rentalId: string, amount: number, paidDate: string, comment: string) => void;
  onEarlyReturn: (rental: GanttRentalData, actualReturnDate: string) => void;
  onUpdChange: (rental: GanttRentalData, updSigned: boolean, updDate?: string) => void;
  onExtended?: (response: RentalExtensionResponse) => void;
}

const statusLabels: Record<GanttRentalData['status'], string> = {
  created: 'Бронь',
  active: 'В аренде',
  returned: 'Возвращена',
  closed: 'Закрыта',
};

const statusVariants: Record<GanttRentalData['status'], 'default' | 'info' | 'success' | 'warning'> = {
  created: 'default',
  active: 'info',
  returned: 'success',
  closed: 'default',
};

const paymentLabels: Record<GanttRentalData['paymentStatus'], string> = {
  paid: 'Оплачено',
  unpaid: 'Не оплачено',
  partial: 'Частично',
};

const paymentVariants: Record<GanttRentalData['paymentStatus'], 'success' | 'error' | 'warning'> = {
  paid: 'success',
  unpaid: 'error',
  partial: 'warning',
};

const documentTypeLabels: Record<Document['type'], string> = {
  rental_contract: 'Договор аренды',
  rental_specification: 'Спецификация',
  transfer_act_to_client: 'Акт передачи',
  return_act_from_client: 'Акт возврата',
  trip_ticket: 'Путевой лист',
  contract: 'Договор',
  commercial_offer: 'Коммерческое предложение',
  act: 'Акт',
  upd: 'УПД',
  invoice: 'Счёт',
  service_act: 'Сервисный акт',
  work_order: 'Заказ-наряд',
  debt_notification: 'Уведомление о задолженности',
  pretrial_claim: 'Досудебная претензия',
  court_document: 'Судебный документ',
  court_decision: 'Решение суда',
  enforcement_writ: 'Исполнительный лист',
  other: 'Документ',
};

const documentStatusLabels: Record<Document['status'], string> = {
  draft: 'Черновик',
  sent: 'Отправлен',
  signed: 'Подписан',
  pending_signature: 'На подписи',
  expired: 'Просрочен',
  cancelled: 'Отменён',
};

const serviceAlertStyles: Record<RentalServiceAlertSeverity, {
  container: string;
  icon: string;
  title: string;
  description: string;
}> = {
  critical: {
    container: 'border-red-200 bg-red-50 dark:border-red-800 dark:bg-red-900/20',
    icon: 'text-red-600 dark:text-red-400',
    title: 'text-red-800 dark:text-red-300',
    description: 'text-red-700 dark:text-red-400',
  },
  warning: {
    container: 'border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-900/20',
    icon: 'text-amber-600 dark:text-amber-400',
    title: 'text-amber-800 dark:text-amber-300',
    description: 'text-amber-700 dark:text-amber-400',
  },
  info: {
    container: 'border-blue-200 bg-blue-50 dark:border-blue-800 dark:bg-blue-900/20',
    icon: 'text-blue-600 dark:text-blue-400',
    title: 'text-blue-800 dark:text-blue-300',
    description: 'text-blue-700 dark:text-blue-400',
  },
};

const EMPTY_SERVICE_TICKETS: ServiceTicket[] = [];
type RentalDrawerTab = 'overview' | 'terms' | 'payments' | 'documents' | 'delivery' | 'history';

type RentalDocumentCreateType = 'rental_contract' | 'rental_specification' | 'transfer_act_to_client' | 'return_act_from_client';

function countInclusiveDays(startDate?: string, endDate?: string) {
  if (!startDate || !endDate) return '';
  const start = new Date(`${startDate.slice(0, 10)}T00:00:00Z`).getTime();
  const end = new Date(`${endDate.slice(0, 10)}T00:00:00Z`).getTime();
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return '';
  return String(Math.floor((end - start) / 86400000) + 1);
}

const deliveryTypeLabels: Record<Delivery['type'], string> = {
  shipping: 'Доставка',
  receiving: 'Возвратная доставка',
};

const deliveryStatusLabels: Record<Delivery['status'], string> = {
  new: 'Новая',
  sent: 'Отправлена перевозчику',
  accepted: 'Принята',
  in_transit: 'В пути',
  completed: 'Завершена',
  cancelled: 'Отменена',
};

export function RentalDrawer({
  rental: rentalProp, equipment, allRentals, classicRentals = [], payments, documents = [], serviceTickets = EMPTY_SERVICE_TICKETS,
  clients = [], deliveries = [], clientReceivables = [], managers = [],
  canEditRentals, canEditRentalDates, dateConflictsRequireApproval = false, canReassignManager, canRestoreRentals, canDeleteRentals,
  canViewMoney = true, canCreatePayments, canCreateDocuments = false, canCreateDeliveries = false, canCreateService = false,
  onClose, onReturn, onDowntime, onStatusChange, onDelete,
  onRestore, onUpdate, onAddComment, onAddPayment, onEarlyReturn, onUpdChange,
  onExtended,
}: RentalDrawerProps) {
  const queryClient = useQueryClient();
  const presence = useAnimatedPresence(Boolean(rentalProp), animationDurations.relaxed);
  const [retainedRental, setRetainedRental] = useState<GanttRentalData | null>(rentalProp);
  const [retainedEquipment, setRetainedEquipment] = useState<Equipment | undefined>(equipment);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
  const [editClientId, setEditClientId] = useState('');
  const [editClient, setEditClient] = useState('');
  const [editManager, setEditManager] = useState('');
  const [editStartDate, setEditStartDate] = useState('');
  const [editEndDate, setEditEndDate] = useState('');
  const [editAmount, setEditAmount] = useState('');
  const [editExpectedPaymentDate, setEditExpectedPaymentDate] = useState('');
  const [editError, setEditError] = useState('');
  const [showCommentForm, setShowCommentForm] = useState(false);
  const [commentText, setCommentText] = useState('');
  const [commentError, setCommentError] = useState('');
  const [managerEditMode, setManagerEditMode] = useState(false);
  const [activeTab, setActiveTab] = useState<RentalDrawerTab>('overview');

  // Add payment form state
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payComment, setPayComment] = useState('');
  const [payError, setPayError] = useState('');

  const [showExtend, setShowExtend] = useState(false);
  const [extensionDialogOpen, setExtensionDialogOpen] = useState(false);
  const [extensionForm, setExtensionForm] = useState({
    newPlannedReturnDate: '',
    reason: '',
    comment: '',
    confirmedByClient: false,
    invoiceSentToClient: false,
  });
  const [extensionError, setExtensionError] = useState('');
  const [extensionInfo, setExtensionInfo] = useState('');
  const [isExtending, setIsExtending] = useState(false);
  const [rentalDetailNotice, setRentalDetailNotice] = useState('');
  const [documentActionError, setDocumentActionError] = useState('');
  const [documentActionPendingId, setDocumentActionPendingId] = useState('');

  // Early return state
  const [showEarlyReturn, setShowEarlyReturn] = useState(false);
  const [earlyReturnDate, setEarlyReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [earlyReturnConfirm, setEarlyReturnConfirm] = useState(false);

  // UPD state
  const [updEditMode, setUpdEditMode] = useState(false);
  const [updDateInput, setUpdDateInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [updUnsignConfirm, setUpdUnsignConfirm] = useState(false);

  useEffect(() => {
    if (rentalProp) setRetainedRental(rentalProp);
  }, [rentalProp]);

  useEffect(() => {
    if (equipment) setRetainedEquipment(equipment);
  }, [equipment]);

  useEffect(() => {
    if (!rentalProp) return undefined;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [onClose, rentalProp]);

  const displayRental = rentalProp ?? retainedRental;
  const displayEquipment = equipment ?? retainedEquipment;

  useEffect(() => {
    if (!displayRental) return;
    setShowEdit(false);
    setEditClientId(displayRental.clientId || '');
    setEditClient(displayRental.client);
    setEditManager(displayRental.manager);
    setEditStartDate(displayRental.startDate);
    setEditEndDate(displayRental.endDate);
    setEditAmount(String(displayRental.amount || 0));
    setEditExpectedPaymentDate(displayRental.expectedPaymentDate || '');
    setEditError('');
    setShowCommentForm(false);
    setCommentText('');
    setCommentError('');
    setManagerEditMode(false);
    setRentalDetailNotice('');
    setActiveTab('overview');
  }, [displayRental]);

  if (!presence.shouldRender || !displayRental) return null;

  const rental = displayRental;
  const currentEquipment = displayEquipment;
  const rentalComments = Array.isArray(rental.comments) ? rental.comments : [];
  const rentalPaymentIds = new Set([
    rental.id,
    rental.rentalId,
    rental.sourceRentalId,
    rental.originalRentalId,
    (rental as GanttRentalData & { __ganttRentalId?: string; __linkedGanttRentalId?: string }).__ganttRentalId,
    (rental as GanttRentalData & { __ganttRentalId?: string; __linkedGanttRentalId?: string }).__linkedGanttRentalId,
  ].map(value => String(value || '').trim()).filter(Boolean));
  const rentalStatusLabel = statusLabels[rental.status] || 'Статус не указан';
  const rentalStatusVariant = statusVariants[rental.status] || 'default';
  const rentalPaymentLabel = paymentLabels[rental.paymentStatus] || 'Не оплачено';
  const rentalPaymentVariant = paymentVariants[rental.paymentStatus] || 'warning';
  const relatedDeliveries = deliveries.filter(delivery => [
    delivery.rentalId,
    delivery.classicRentalId,
    delivery.ganttRentalId,
  ].some(value => rentalPaymentIds.has(String(value || '').trim())));

  const rentalResolution = resolveRentalByAnyId(rental, classicRentals, allRentals);
  const rentalDetailId = rentalResolution.canonicalId;
  const rentalDetailError = rentalResolution.status === 'conflict'
    ? 'Найдено несколько связанных записей аренды. Нужна проверка связей.'
    : `Не удалось открыть карточку аренды: не найдена связанная запись rentals для ${rental.id}`;

  const activeManagers = filterRentalManagerUsers(managers);
  const ganttRentalId = (rental as GanttRentalData & { __ganttRentalId?: string; __linkedGanttRentalId?: string }).__ganttRentalId
    || (rental as GanttRentalData & { __ganttRentalId?: string; __linkedGanttRentalId?: string }).__linkedGanttRentalId
    || rentalResolution.ganttRental?.id
    || (String(rental.id || '').startsWith('GR-') ? rental.id : '');
  const canonicalRentalId = rentalDetailId || rental.rentalId || rental.sourceRentalId || rental.originalRentalId || (!String(rental.id || '').startsWith('GR-') ? rental.id : '');
  const createDocumentUrl = (() => {
    const params = new URLSearchParams({ action: 'create' });
    if (canonicalRentalId) params.set('rentalId', canonicalRentalId);
    if (rental.clientId) params.set('clientId', rental.clientId);
    if (rental.client) params.set('clientName', rental.client);
    if (rental.equipmentId || currentEquipment?.id) params.set('equipmentId', rental.equipmentId || currentEquipment?.id || '');
    if (rental.equipmentInv || currentEquipment?.inventoryNumber) params.set('equipmentInv', rental.equipmentInv || currentEquipment?.inventoryNumber || '');
    return `/documents?${params.toString()}`;
  })();
  const createRentalDocumentUrl = (type: RentalDocumentCreateType) => {
    const params = new URLSearchParams({ action: 'create', type });
    if (canonicalRentalId) params.set('rentalId', canonicalRentalId);
    if (rental.clientId) params.set('clientId', rental.clientId);
    if (rental.client) params.set('clientName', rental.client);
    if (rental.equipmentId || currentEquipment?.id) params.set('equipmentId', rental.equipmentId || currentEquipment?.id || '');
    if (rental.equipmentInv || currentEquipment?.inventoryNumber) params.set('equipmentInv', rental.equipmentInv || currentEquipment?.inventoryNumber || '');
    if (rental.objectId) params.set('objectId', rental.objectId);
    if (rental.contractId) params.set('contractId', rental.contractId);
    if (rental.startDate) params.set('rentalStartDate', rental.startDate);
    if (rental.endDate) params.set('rentalEndDate', rental.endDate);
    if ((rental as GanttRentalData & { rate?: string }).rate) params.set('dailyRate', (rental as GanttRentalData & { rate?: string }).rate || '');
    if (rental.amount) params.set('amount', String(rental.amount));
    if (rental.startDate && rental.endDate) params.set('quantityDays', countInclusiveDays(rental.startDate, rental.endDate));
    if (type === 'rental_specification' && chainContract?.id) params.set('parentDocumentId', chainContract.id);
    if (['transfer_act_to_client', 'return_act_from_client'].includes(type)) {
      if (chainContract?.id) params.set('parentDocumentId', chainContract.id);
      if (chainSpecification?.id) params.set('specificationId', chainSpecification.id);
    }
    if (type === 'transfer_act_to_client') params.set('transferDate', rental.startDate || new Date().toISOString().slice(0, 10));
    if (type === 'return_act_from_client') params.set('returnDate', actualReturnDate || rental.endDate || new Date().toISOString().slice(0, 10));
    return `/documents?${params.toString()}`;
  };
  const createDeliveryUrl = (type: Delivery['type']) => {
    const params = new URLSearchParams({ action: 'create', type });
    if (canonicalRentalId) params.set('rentalId', canonicalRentalId);
    if (ganttRentalId) params.set('ganttRentalId', ganttRentalId);
    return `/deliveries?${params.toString()}`;
  };

  // Payments for this rental
  const rentalPayments = payments.filter(p => rentalPaymentIds.has(String(p.rentalId || '').trim()));
  const relatedDocuments = documents.filter(doc => [
    doc.rentalId,
    doc.rental,
  ].some(value => rentalPaymentIds.has(String(value || '').trim())));
  const todayKey = new Date().toISOString().slice(0, 10);
  const documentControlRental = {
    ...rental,
    id: canonicalRentalId || rental.id,
    plannedReturnDate: rental.endDate,
    equipment: rental.equipmentInv ? [rental.equipmentInv] : [],
  };
  const documentControl = buildDocumentControl({
    rentals: [documentControlRental],
    documents,
    clients,
    equipment: currentEquipment ? [currentEquipment] : [],
    today: todayKey,
  });
  const rentalDocumentSummary = documentControl.getRentalSummary(documentControlRental.id);
  const documentsById = new Map(documents.map(doc => [doc.id, doc]));
  const chainDocument = (slot?: { documents?: Array<{ id?: string }> }) => {
    const id = slot?.documents?.[0]?.id || '';
    return id ? documentsById.get(id) : undefined;
  };
  const chainContract = chainDocument(rentalDocumentSummary?.contract);
  const chainSpecification = chainDocument(rentalDocumentSummary?.specification);
  const chainTransferAct = chainDocument(rentalDocumentSummary?.transferAct);
  const chainReturnAct = chainDocument(rentalDocumentSummary?.returnAct);
  const totalPaid = rentalPayments.reduce((sum, p) => sum + getEffectivePaidAmount(p), 0);
  const rentalBilling = calculateRentalBilling(rental);
  const rentalBillingAmount = rentalBilling.finalRentalAmount;
  const remaining = Math.max(0, rentalBillingAmount - totalPaid);
  const canRegisterPayment = canCreatePayments && remaining > 0;
  const isReturnOverdue = rental.status === 'active' && rental.endDate < todayKey;
  const overdueDays = isReturnOverdue
    ? Math.max(1, Math.ceil((new Date(todayKey).getTime() - new Date(rental.endDate).getTime()) / 86400000))
    : 0;
  const clientProfile = clients.find(item => item.id === rental.clientId)
    ?? clients.find(item => !rental.clientId && item.company === rental.client);
  const clientDebt = clientReceivables.find(item => item.clientId === rental.clientId)
    ?? clientReceivables.find(item => !rental.clientId && item.client === rental.client);
  const serviceAlert = buildRentalServiceAlert(rental, currentEquipment, serviceTickets, todayKey);
  const serviceAlertStyle = serviceAlert ? serviceAlertStyles[serviceAlert.severity] : null;
  const daysLeft = Math.ceil((new Date(rental.endDate).getTime() - new Date(todayKey).getTime()) / 86400000);
  const daysLeftLabel = isReturnOverdue
    ? `Просрочено на ${overdueDays} дн.`
    : rental.status === 'closed' || rental.status === 'returned'
      ? 'Период завершён'
      : daysLeft >= 0
        ? `Осталось ${daysLeft} дн.`
        : '—';
  const actualReturnDate = (rental as GanttRentalData & { actualReturnDate?: string; returnDate?: string }).actualReturnDate
    || (rental as GanttRentalData & { actualReturnDate?: string; returnDate?: string }).returnDate
    || '';
  const isRentalFinished = rental.status === 'closed' || rental.status === 'returned';
  const rentalDocumentChainRows = [
    {
      id: 'contract',
      label: 'Договор аренды',
      doc: chainContract,
      createType: 'rental_contract' as const,
      missingHint: chainContract ? '' : 'Договор ещё не создан.',
    },
    {
      id: 'specification',
      label: 'Спецификация',
      doc: chainSpecification,
      createType: 'rental_specification' as const,
      missingHint: chainContract
        ? 'Спецификация ещё не создана.'
        : 'Для спецификации желательно сначала создать договор аренды.',
    },
    {
      id: 'transfer',
      label: 'Акт передачи',
      doc: chainTransferAct,
      createType: 'transfer_act_to_client' as const,
      missingHint: chainSpecification
        ? 'Акт передачи ещё не создан.'
        : 'Спецификация не найдена. Рекомендуется сначала создать спецификацию.',
    },
    {
      id: 'return',
      label: 'Акт возврата',
      doc: chainReturnAct,
      createType: 'return_act_from_client' as const,
      missingHint: isRentalFinished
        ? 'Акт возврата ещё не создан.'
        : 'Аренда ещё не закрыта. Проверьте дату возврата.',
    },
  ];
  const canManageDowntimes = canEditRentals && !isRentalFinished;
  const canExtendRentalTerm = canEditRentalDates && Boolean(rentalDetailId) && (rental.status === 'active' || rental.status === 'created') && !isRentalFinished;
  const canShowExtendShortcut = canEditRentalDates && rental.status === 'active' && !isRentalFinished;
  const canManageRentalReturn = canEditRentals && rental.status === 'active' && !isRentalFinished;
  const termStatusLabel = isRentalFinished
    ? rental.status === 'closed' ? 'Закрыта' : 'Возврат оформлен'
    : isReturnOverdue
      ? `Просрочено ${overdueDays} ${overdueDays === 1 ? 'день' : overdueDays < 5 ? 'дня' : 'дней'}`
      : 'Активна';
  const termStatusClass = isRentalFinished
    ? 'text-slate-950 dark:text-white'
    : isReturnOverdue
      ? 'text-red-600 dark:text-red-400'
      : 'text-green-700 dark:text-green-300';
  const contractLabel = rental.contractId || rentalDetailId || 'Не привязан';
  const equipmentLabel = [
    currentEquipment?.manufacturer,
    currentEquipment?.model,
  ].filter(Boolean).join(' ') || rental.equipmentInv || 'Техника не указана';
  const rentalLocation = clientProfile?.actualAddress || clientProfile?.address || clientProfile?.legalAddress || '—';
  const moneyValue = (value: number) => canViewMoney ? formatCurrency(value) : 'Скрыто';
  const downtimeSummary = calculateRentalDowntimeSummary(rental);
  const downtimePeriods = normalizeRentalDowntimePeriods(rental) as DowntimePeriod[];
  const nextPaymentLabel = canViewMoney
    ? rental.expectedPaymentDate
      ? `${formatDate(rental.expectedPaymentDate)} · ${remaining > 0 ? formatCurrency(remaining) : 'нет долга'}`
      : remaining > 0
        ? `Не назначен · ${formatCurrency(remaining)}`
        : 'Нет ожидаемого платежа'
    : 'Скрыто';
  const extensionRental = {
    ...rental,
    id: rentalDetailId || rental.id,
    plannedReturnDate: rental.endDate,
    equipment: [rental.equipmentInv].filter(Boolean),
    price: rental.amount || rentalBillingAmount,
    discount: 0,
    rate: '',
    contact: '',
    deliveryAddress: rentalLocation === '—' ? '' : rentalLocation,
    status: rental.status === 'closed' || rental.status === 'returned' ? 'closed' : 'active',
  } as Rental;
  const extensionValidation = getRentalExtensionValidation({
    rental: extensionRental,
    form: extensionForm,
    hasEquipment: Boolean(rental.equipmentId || rental.equipmentInv || currentEquipment),
  });
  const extensionStartDate = (() => {
    if (!rental.endDate) return '';
    const date = new Date(`${rental.endDate}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    date.setDate(date.getDate() + 1);
    return date.toISOString().slice(0, 10);
  })();
  const extensionConflict = extensionForm.newPlannedReturnDate
    ? buildExtensionConflictDisplay(findConflictingRental(
        { id: rental.equipmentId || currentEquipment?.id || rental.equipmentInv, inventoryNumber: rental.equipmentInv || currentEquipment?.inventoryNumber },
        extensionStartDate || rental.endDate,
        extensionForm.newPlannedReturnDate,
        allRentals,
        (rental as GanttRentalData & { __ganttRentalId?: string; __linkedGanttRentalId?: string }).__ganttRentalId
          || (rental as GanttRentalData & { __ganttRentalId?: string; __linkedGanttRentalId?: string }).__linkedGanttRentalId
          || rentalResolution.ganttRental?.id
          || rental.id,
      ))
    : null;

  const openRentalCard = () => {
    if (rentalDetailId) return;
    console.warn('[rental-drawer] rental card navigation failed', rentalResolution.diagnostics);
    setRentalDetailNotice(rentalDetailError);
  };

  const openExtensionDialog = () => {
    setExtensionForm({
      newPlannedReturnDate: rental.endDate || '',
      reason: '',
      comment: '',
      confirmedByClient: false,
      invoiceSentToClient: false,
    });
    setExtensionError('');
    setExtensionInfo('');
    setExtensionDialogOpen(true);
  };

  const handleExtendRental = async () => {
    if (!canExtendRentalTerm) return;
    if (!rentalDetailId) {
      console.warn('[rental-drawer] rental extension resolution failed', rentalResolution.diagnostics);
      setExtensionError('Нельзя продлить аренду без связанной записи rentals.');
      return;
    }
    if (!rentalDetailId && rentalResolution.status === 'conflict') {
      console.warn('[rental-drawer] rental extension resolution conflict', rentalResolution.diagnostics);
      setExtensionError('Найдено несколько связанных записей аренды. Нужна проверка связей.');
      return;
    }
    if (extensionValidation) {
      setExtensionError(extensionValidation);
      return;
    }
    setIsExtending(true);
    setExtensionError('');
    setExtensionInfo('');
    try {
      const result = await rentalsService.extend(rentalDetailId, {
        newEndDate: extensionForm.newPlannedReturnDate,
        newPlannedReturnDate: extensionForm.newPlannedReturnDate,
        reason: extensionForm.reason.trim(),
        comment: extensionForm.comment.trim(),
        confirmedByClient: extensionForm.confirmedByClient,
        invoiceSentToClient: extensionForm.invoiceSentToClient,
      });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
        queryClient.invalidateQueries({ queryKey: ['rental-change-requests'] }),
      ]);
      if (result.applied) {
        onExtended?.(result);
        setExtensionDialogOpen(false);
        setShowExtend(false);
        setExtensionInfo('Аренда продлена и синхронизирована с планировщиком.');
      } else {
        const conflict = buildExtensionConflictDisplay(result.conflict);
        setExtensionInfo(conflict
          ? `Найден конфликт: ${conflict.client}, ${conflict.period}. Запрос отправлен на согласование.`
          : 'Продление отправлено на согласование.');
      }
    } catch (error) {
      setExtensionError(error instanceof Error ? error.message : 'Не удалось продлить аренду.');
    } finally {
      setIsExtending(false);
    }
  };

  const openRentalDocument = async (doc: Document) => {
    setDocumentActionError('');
    setDocumentActionPendingId(doc.id);
    try {
      const html = doc.printHtml || doc.generatedContent || doc.contentHtml || await documentsService.getPrintHtml(doc.id);
      openPrintableHtml(html);
    } catch (error) {
      setDocumentActionError(error instanceof Error ? error.message : 'Не удалось открыть документ.');
    } finally {
      setDocumentActionPendingId('');
    }
  };

  // Handle add payment submit
  const handlePaySubmit = () => {
    if (!canCreatePayments) return;
    const amt = parseFloat(payAmount);
    if (!payAmount || isNaN(amt) || amt <= 0) {
      setPayError('Введите корректную сумму');
      return;
    }
    if (!payDate) {
      setPayError('Укажите дату оплаты');
      return;
    }
    setPayError('');
    onAddPayment(canonicalRentalId || rental.id, amt, payDate, payComment);
    setPayAmount('');
    setPayComment('');
    setPayDate(new Date().toISOString().slice(0, 10));
    setShowAddPayment(false);
  };

  // Handle early return submit
  const handleEarlyReturnSubmit = () => {
    if (!canEditRentals) return;
    if (!earlyReturnDate) return;
    setEarlyReturnConfirm(true);
  };

  const handleEarlyReturnConfirm = () => {
    if (!canEditRentals) return;
    onEarlyReturn(rental, earlyReturnDate);
    setShowEarlyReturn(false);
    setEarlyReturnConfirm(false);
  };

  const handleEditSave = () => {
    if (!canEditRentals) return;
    if (!editClientId || !editClient.trim()) {
      setEditError('Выберите клиента из базы');
      return;
    }
    if (!editStartDate || !editEndDate) {
      setEditError('Укажите даты аренды');
      return;
    }
    if (editEndDate < editStartDate) {
      setEditError('Дата окончания не может быть раньше даты начала');
      return;
    }
    if (editEndDate > rental.endDate) {
      setEditError('Для продления используйте действие «Продлить аренду» во вкладке «Сроки и возврат».');
      return;
    }
    const amount = Number(editAmount);
    if (!Number.isFinite(amount) || amount < 0) {
      setEditError('Сумма должна быть числом не меньше 0');
      return;
    }
    const conflict = findConflictingRental(
      { id: rental.equipmentId || rental.equipmentInv, inventoryNumber: rental.equipmentInv },
      editStartDate,
      editEndDate,
      allRentals,
      rental.id,
    );
    if (conflict && !dateConflictsRequireApproval) {
      setEditError(`Конфликт: техника занята ${formatDate(conflict.startDate)} — ${formatDate(conflict.endDate)} (${conflict.client})`);
      return;
    }

    setEditError('');
    onUpdate(rental, {
      clientId: editClientId,
      client: editClient.trim(),
      clientShort: editClient.trim().substring(0, 20),
      manager: editManager.trim(),
      managerInitials: editManager.trim()
        ? editManager.trim().split(/\s+/).map(w => w[0] || '').join('').slice(0, 2).toUpperCase()
        : rental.managerInitials,
      startDate: editStartDate,
      endDate: editEndDate,
      amount,
      expectedPaymentDate: editExpectedPaymentDate || undefined,
    });
    setShowEdit(false);
  };

  const handleCommentSave = () => {
    if (!canEditRentals) return;
    if (!commentText.trim()) {
      setCommentError('Введите текст заметки');
      return;
    }
    onAddComment(rental, commentText.trim());
    setCommentText('');
    setCommentError('');
    setShowCommentForm(false);
  };

  const handleManagerSave = () => {
    if (!canReassignManager) return;
    const nextManager = editManager.trim();
    if (!nextManager || nextManager === rental.manager) {
      setManagerEditMode(false);
      setEditManager(rental.manager);
      return;
    }
    onUpdate(rental, {
      manager: nextManager,
      managerInitials: nextManager
        .split(/\s+/)
        .map(word => word[0] || '')
        .join('')
        .slice(0, 2)
        .toUpperCase(),
    });
    setManagerEditMode(false);
  };

  const handlePaymentStatusChange = (status: GanttRentalData['paymentStatus']) => {
    if (!canEditRentals) return;
    onUpdate(rental, { paymentStatus: status });
  };

  return (
    <div className="fixed inset-0 z-50">
      {/* Overlay */}
      <div
        data-state={presence.dataState}
        className="app-animate-overlay absolute inset-0 bg-slate-950/40 backdrop-blur-[3px] lg:bg-transparent lg:backdrop-blur-0 dark:bg-black/60 dark:lg:bg-transparent"
        onClick={onClose}
      />

      {/* Drawer */}
      <div
        data-side="right"
        data-state={presence.dataState}
        onAnimationEnd={presence.onExitAnimationEnd}
        className="app-animate-drawer fixed inset-y-0 right-0 z-10 flex w-full max-w-full flex-col overflow-hidden rounded-l-2xl border-l border-slate-200/90 bg-white shadow-[0_32px_90px_-46px_rgba(15,23,42,0.72)] sm:w-[42%] sm:min-w-[440px] sm:max-w-[640px] lg:max-w-[560px] dark:border-gray-800 dark:bg-gray-950 dark:shadow-2xl"
        data-rental-detail-drawer="true"
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-slate-100 bg-white px-4 py-4 sm:px-6 sm:py-5 dark:border-gray-800 dark:bg-gray-950">
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <h2 className="min-w-0 max-w-full break-words text-lg font-semibold leading-tight text-slate-950 sm:max-w-[360px] sm:text-xl dark:text-white" title={rental.client}>{rental.client}</h2>
              <Badge variant={rentalStatusVariant}>{rentalStatusLabel}</Badge>
              {isReturnOverdue && (
                <Badge variant="warning">
                  Срок истёк · {overdueDays} дн.
                </Badge>
              )}
            </div>
            <div className="mt-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-slate-500 dark:text-gray-400">
              <span className="font-mono">{rental.id}</span>
              <span>·</span>
              <span className="max-w-full break-words">
                {rental.equipmentInv} {currentEquipment?.model}
                {currentEquipment?.serialNumber ? ` · SN ${currentEquipment.serialNumber}` : ''}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-3 inline-flex size-9 items-center justify-center rounded-xl border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 dark:text-gray-500 dark:hover:border-gray-800 dark:hover:bg-gray-900 dark:hover:text-gray-200"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="shrink-0 border-b border-slate-100 bg-white px-4 py-2 dark:border-gray-800 dark:bg-gray-950">
          <div className="flex flex-wrap gap-1 overflow-visible">
            {([
              ['overview', 'Обзор'],
              ['terms', 'Сроки и возврат'],
              ['payments', 'Платежи'],
              ['documents', 'Документы'],
              ['delivery', 'Доставка'],
              ['history', 'История'],
            ] as Array<[RentalDrawerTab, string]>).map(([tabId, label]) => (
              <button
                key={tabId}
                type="button"
                onClick={() => setActiveTab(tabId)}
                className={`rounded-xl px-3 py-2 text-sm font-semibold transition-colors ${
                  activeTab === tabId
                    ? 'bg-blue-600 text-white shadow-sm'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        {/* Content */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overflow-x-hidden bg-slate-50/40 p-4 sm:p-6 dark:bg-gray-950">
          {activeTab === 'overview' && (
            <section className="space-y-4">
              <div className="grid gap-2 sm:grid-cols-2">
                {[
                  ['Статус', rentalStatusLabel],
                  ['Клиент', rental.client || '—'],
                  ['ИНН', clientProfile?.inn || '—'],
                  ['Договор', contractLabel],
                  ['Период', `${formatDate(rental.startDate)} — ${formatDate(rental.endDate)}`],
                  ['Остаток срока', daysLeftLabel],
                  ['Техника', equipmentLabel],
                  ['Инвентарный №', rental.equipmentInv || currentEquipment?.inventoryNumber || '—'],
                  ['Собственник', currentEquipment?.ownerName || currentEquipment?.owner || '—'],
                  ['Менеджер', rental.manager || '—'],
                  ['Условия', clientProfile?.paymentTerms || '—'],
                  ['Локация выдачи', rentalLocation],
                  ['Локация возврата', rentalLocation],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900/70">
                    <div className="text-xs font-medium text-slate-500 dark:text-gray-400">{label}</div>
                    <div className="mt-1 break-words text-sm font-semibold text-slate-950 dark:text-white" title={String(value)}>{value}</div>
                  </div>
                ))}
              </div>

              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900/70">
                  <div className="text-xs font-medium text-slate-500 dark:text-gray-400">Сумма аренды</div>
                  <div className="mt-1 text-sm font-bold text-slate-950 dark:text-white">{moneyValue(rentalBillingAmount)}</div>
                </div>
                <div className="rounded-xl border border-green-200 bg-green-50 px-3 py-2.5 dark:border-green-900/50 dark:bg-green-950/20">
                  <div className="text-xs font-medium text-green-700 dark:text-green-300">Оплачено</div>
                  <div className="mt-1 text-sm font-bold text-green-700 dark:text-green-300">{moneyValue(totalPaid)}</div>
                </div>
                <div className="rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 dark:border-red-900/50 dark:bg-red-950/20">
                  <div className="text-xs font-medium text-red-700 dark:text-red-300">Долг</div>
                  <div className="mt-1 text-sm font-bold text-red-700 dark:text-red-300">{moneyValue(remaining)}</div>
                </div>
                <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2.5 dark:border-blue-900/50 dark:bg-blue-950/20">
                  <div className="text-xs font-medium text-blue-700 dark:text-blue-300">Следующий платёж</div>
                  <div className="mt-1 text-sm font-bold text-blue-700 dark:text-blue-300">{nextPaymentLabel}</div>
                </div>
              </div>

              {canViewMoney && rentalBilling.downtimeDays > 0 && (
                <div className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-xs text-slate-600 dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-300">
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>Календарные дни: <span className="font-semibold text-slate-950 dark:text-white">{rentalBilling.totalCalendarDays}</span></div>
                    <div>Оплачиваемые дни: <span className="font-semibold text-slate-950 dark:text-white">{rentalBilling.billableDays}</span></div>
                    <div>Простои всего: <span className="font-semibold text-slate-950 dark:text-white">{rentalBilling.downtimeDays}</span></div>
                    <div>Влияют на начисление: <span className="font-semibold text-slate-950 dark:text-white">{rentalBilling.billingDowntimeDays}</span></div>
                    <div>Ставка: <span className="font-semibold text-slate-950 dark:text-white">{moneyValue(rentalBilling.dailyRate)}</span></div>
                    <div>Корректировка: <span className="font-semibold text-amber-700 dark:text-amber-300">-{moneyValue(rentalBilling.downtimeAdjustmentAmount)}</span></div>
                    <div>До корректировки: <span className="font-semibold text-slate-950 dark:text-white">{moneyValue(rentalBilling.grossRentalAmount)}</span></div>
                    <div>Итог: <span className="font-semibold text-slate-950 dark:text-white">{moneyValue(rentalBilling.finalRentalAmount)}</span></div>
                  </div>
                </div>
              )}

              <div className="rounded-xl border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-950/20">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <div>
                    <div className="text-sm font-semibold text-amber-950 dark:text-amber-100">Простои</div>
                    <div className="mt-0.5 text-xs text-amber-700 dark:text-amber-300">
                      {downtimePeriods.length > 0
                        ? `${downtimeSummary.downtimeDays} дн. простоя · ${downtimeSummary.billableDays || downtimeSummary.totalCalendarDays} дн. к начислению`
                        : 'Периоды простоя не зафиксированы'}
                    </div>
                  </div>
                  {canManageDowntimes && (
                    <Button size="sm" variant="secondary" onClick={() => onDowntime(rental)}>
                      <Plus className="h-3.5 w-3.5" />
                      Добавить простой
                    </Button>
                  )}
                </div>
                {downtimePeriods.length > 0 && (
                  <div className="space-y-2">
                    {downtimePeriods.map(period => {
                      const days = getDowntimeRentalDays(period.startDate, period.endDate);
                      return (
                        <div key={period.id} className="rounded-lg border border-amber-200 bg-white px-3 py-2 dark:border-amber-900/50 dark:bg-gray-950/40">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <div className="text-sm font-semibold text-slate-950 dark:text-white">
                                {formatDate(period.startDate)} — {formatDate(period.endDate || period.startDate)} · {days} дн.
                              </div>
                              <div className="mt-1 text-xs text-slate-600 dark:text-gray-300">
                                Причина: {period.reason || '—'}
                              </div>
                              {period.comment && (
                                <div className="mt-1 text-xs text-slate-500 dark:text-gray-400">{period.comment}</div>
                              )}
                              <div className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                                {period.affectsBilling ? 'Влияет на начисление' : 'Не влияет на начисление'}
                                {period.createdBy ? ` · ${period.createdBy}` : ''}
                                {period.createdAt ? ` · ${formatDateTime(period.createdAt)}` : ''}
                              </div>
                            </div>
                            {canManageDowntimes && (
                              <Button size="sm" variant="ghost" onClick={() => onDowntime(rental, period)}>
                                <Edit className="h-3.5 w-3.5" />
                                Изменить
                              </Button>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="rounded-xl border border-slate-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900/70">
                <div className="mb-3 text-sm font-semibold text-slate-950 dark:text-white">Быстрые действия</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  {canEditRentals && (
                    <Button size="sm" variant="secondary" className="justify-start rounded-xl" onClick={() => setShowEdit(true)}>
                      <Edit className="h-4 w-4" />
                      Редактировать аренду
                    </Button>
                  )}
                  {canCreateDeliveries && (
                    <Button size="sm" variant="secondary" className="justify-start rounded-xl" asChild>
                      <Link to={createDeliveryUrl('shipping')}>
                        <Truck className="h-4 w-4" />
                        Создать доставку
                      </Link>
                    </Button>
                  )}
                  {canEditRentals && (
                    <Button size="sm" variant="secondary" className="justify-start rounded-xl" onClick={() => setActiveTab('terms')}>
                      <CalendarClock className="h-4 w-4" />
                      Сроки и возврат
                    </Button>
                  )}
                  {rentalDetailId ? (
                    <Button size="sm" variant="secondary" className="justify-start rounded-xl" asChild>
                      <Link to={`/rentals/${encodeURIComponent(rentalDetailId)}`}>
                        <ArrowRight className="h-4 w-4" />
                        Открыть полную карточку
                      </Link>
                    </Button>
                  ) : (
                    <Button size="sm" variant="secondary" className="justify-start rounded-xl" onClick={openRentalCard}>
                      <ArrowRight className="h-4 w-4" />
                      Открыть полную карточку
                    </Button>
                  )}
                  {canCreateDocuments && (
                    <Button size="sm" variant="secondary" className="justify-start rounded-xl" asChild>
                      <Link to={createDocumentUrl}>
                        <FileText className="h-4 w-4" />
                        Создать документ
                      </Link>
                    </Button>
                  )}
                  {canRegisterPayment && (
                    <Button size="sm" variant="secondary" className="justify-start rounded-xl" onClick={() => { setActiveTab('payments'); setShowAddPayment(true); }}>
                      <CreditCard className="h-4 w-4" />
                      Добавить оплату
                    </Button>
                  )}
                  {canDeleteRentals && (
                    <Button size="sm" variant="ghost" className="justify-start rounded-xl text-red-600 hover:bg-red-50 hover:text-red-700 dark:hover:bg-red-950/20" onClick={() => setConfirmDelete(true)}>
                      <Trash2 className="h-4 w-4" />
                      Отменить аренду
                    </Button>
                  )}
                </div>
                {rentalDetailNotice && (
                  <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-medium text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                    {rentalDetailNotice}
                  </div>
                )}
              </div>
            </section>
          )}

          {activeTab === 'overview' && canEditRentals && showEdit && (
            <section>
                <div className="mt-3 rounded-2xl border border-blue-200 bg-blue-50/70 p-4 shadow-sm dark:border-blue-800 dark:bg-blue-900/20">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold text-blue-800 dark:text-blue-200">Редактировать аренду</div>
                    <Button size="sm" variant="ghost" onClick={() => { setShowEdit(false); setEditError(''); }}>Свернуть</Button>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div className="col-span-2">
                      <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Клиент *</label>
                      <select
                        value={editClientId}
                        onChange={e => {
                          const selected = clients.find(item => item.id === e.target.value);
                          setEditClientId(e.target.value);
                          setEditClient(selected?.company ?? '');
                        }}
                        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                      >
                        <option value="">Выберите клиента</option>
                        {clients.map(clientItem => (
                          <option key={clientItem.id} value={clientItem.id}>{clientItem.company}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Менеджер</label>
                      <input
                        type="text"
                        value={editManager}
                        onChange={e => setEditManager(e.target.value)}
                        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Сумма (₽)</label>
                      <input
                        type="number"
                        min="0"
                        value={editAmount}
                        onChange={e => setEditAmount(e.target.value)}
                        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Дата начала *</label>
                      <input
                        type="date"
                        value={editStartDate}
                        onChange={e => setEditStartDate(e.target.value)}
                        disabled={!canEditRentalDates}
                        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                      />
                    </div>
                    <div>
                      <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Дата окончания *</label>
                      <input
                        type="date"
                        value={editEndDate}
                        onChange={e => setEditEndDate(e.target.value)}
                        disabled={!canEditRentalDates}
                        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Ожидаемая дата оплаты</label>
                      <input
                        type="date"
                        value={editExpectedPaymentDate}
                        onChange={e => setEditExpectedPaymentDate(e.target.value)}
                        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                      />
                    </div>
                  </div>
                  {!canEditRentalDates && (
                    <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                      Изменять даты аренды могут только администратор и офис-менеджер.
                    </p>
                  )}
                  {editError && <p className="mt-2 text-xs text-red-600 dark:text-red-400">{editError}</p>}
                  <div className="mt-3 flex gap-2">
                    <Button size="sm" onClick={handleEditSave}>Сохранить</Button>
                    <Button size="sm" variant="ghost" onClick={() => { setShowEdit(false); setEditError(''); }}>
                      Отмена
                    </Button>
                  </div>
                </div>
            </section>
          )}

          {/* Dates */}
          {activeTab === 'overview' && serviceAlert && serviceAlertStyle && (
            <div className={`rounded-lg border px-4 py-3 ${serviceAlertStyle.container}`}>
              <div className="flex items-start gap-2">
                <Wrench className={`mt-0.5 h-4 w-4 shrink-0 ${serviceAlertStyle.icon}`} />
                <div className="min-w-0 flex-1">
                  <p className={`text-sm font-semibold ${serviceAlertStyle.title}`}>
                    {serviceAlert.title}
                  </p>
                  <p className={`mt-1 text-xs ${serviceAlertStyle.description}`}>
                    {serviceAlert.description}
                  </p>
                  {serviceAlert.actionLabel && serviceAlert.actionTarget && (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Button size="sm" variant="outline" asChild>
                        <Link to={serviceAlert.actionTarget}>{serviceAlert.actionLabel}</Link>
                      </Button>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {activeTab === 'terms' && (
            <section className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/70">
                <div className="mb-3 flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                  <div>
                    <div className="text-sm font-semibold text-slate-950 dark:text-white">Сроки и возврат</div>
                    <div className="text-xs text-slate-500 dark:text-gray-400">Период аренды, плановый и фактический возврат техники.</div>
                  </div>
                </div>

                <div className="grid gap-2 sm:grid-cols-2">
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-950/60">
                    <div className="text-xs font-medium text-slate-500 dark:text-gray-400">Текущий период аренды</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{formatDate(rental.startDate)} — {formatDate(rental.endDate)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-950/60">
                    <div className="text-xs font-medium text-slate-500 dark:text-gray-400">Статус срока</div>
                    <div className={`mt-1 text-sm font-semibold ${termStatusClass}`}>{termStatusLabel}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-950/60">
                    <div className="text-xs font-medium text-slate-500 dark:text-gray-400">Дата начала аренды</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{formatDate(rental.startDate)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-950/60">
                    <div className="text-xs font-medium text-slate-500 dark:text-gray-400">Плановая дата окончания</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{formatDate(rental.endDate)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-950/60">
                    <div className="text-xs font-medium text-slate-500 dark:text-gray-400">Плановый возврат</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{formatDate(rental.endDate)}</div>
                  </div>
                  <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-950/60">
                    <div className="text-xs font-medium text-slate-500 dark:text-gray-400">Фактический возврат</div>
                    <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">
                      {actualReturnDate ? formatDate(actualReturnDate) : isRentalFinished ? 'Оформлен' : 'Не оформлен'}
                    </div>
                  </div>
                </div>
              </div>

              {isReturnOverdue && (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 shadow-sm dark:border-amber-800 dark:bg-amber-900/20">
                  <div className="flex items-start gap-2">
                    <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                    <div>
                      <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                        Срок аренды истёк. Нужно продлить аренду или оформить возврат техники.
                      </p>
                      <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                        Просрочка {overdueDays} {overdueDays === 1 ? 'день' : overdueDays < 5 ? 'дня' : 'дней'}.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {!isRentalFinished && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/70">
                  <div className="mb-3 text-sm font-semibold text-slate-950 dark:text-white">Действия со сроком</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {canExtendRentalTerm && (
                      <button
                        onClick={() => setShowExtend(v => !v)}
                        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-gray-700 dark:bg-gray-950/60 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <span className="flex items-center gap-2">
                          <CalendarClock className="h-4 w-4 text-blue-500" />
                          Продлить аренду
                        </span>
                        {showExtend ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                      </button>
                    )}
                    {canManageRentalReturn && (
                      <Button size="sm" variant="secondary" className="justify-start rounded-xl" onClick={() => onReturn(rental)}>
                        <RotateCcw className="h-4 w-4" />
                        Оформить возврат техники
                      </Button>
                    )}
                    {canManageRentalReturn && (
                      <button
                        onClick={() => setShowEarlyReturn(v => !v)}
                        className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 text-sm font-semibold text-slate-700 transition hover:bg-slate-100 dark:border-gray-700 dark:bg-gray-950/60 dark:text-gray-300 dark:hover:bg-gray-800"
                      >
                        <span className="flex items-center gap-2">
                          <LogOut className="h-4 w-4 text-red-500" />
                          Досрочный возврат
                        </span>
                        {showEarlyReturn ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
                      </button>
                    )}
                    {canCreateService && (
                      <Button size="sm" variant="secondary" className="justify-start rounded-xl" asChild>
                        <Link to="/service/new">
                          <Wrench className="h-4 w-4" />
                          Создать сервисную заявку при повреждении
                        </Link>
                      </Button>
                    )}
                  </div>

                  {!canExtendRentalTerm && !canManageRentalReturn && !canCreateService && (
                    <p className="text-sm text-slate-500 dark:text-gray-400">Для вашей роли нет доступных действий по срокам этой аренды.</p>
                  )}
                </div>
              )}

              {isRentalFinished && (
                <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600 shadow-sm dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-300">
                  Активные действия скрыты, потому что возврат уже оформлен или аренда закрыта.
                </div>
              )}

              {activeTab === 'terms' && canExtendRentalTerm && showExtend && (
                <section>
                  <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                    <div className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                      Текущая дата возврата: <strong>{formatDate(rental.endDate)}</strong>
                    </div>
                    {clientDebt && canViewMoney && (
                      <p className="text-xs leading-relaxed text-blue-700 dark:text-blue-300">
                        Текущий долг клиента: <strong>{formatCurrency(clientDebt.currentDebt || 0)}</strong>
                      </p>
                    )}
                    {extensionInfo && (
                      <p className="mt-2 text-xs leading-relaxed text-blue-700 dark:text-blue-300">{extensionInfo}</p>
                    )}
                    {rentalDetailNotice && (
                      <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-relaxed text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                        {rentalDetailNotice}
                      </p>
                    )}
                    <div className="mt-3 flex flex-wrap justify-end gap-2">
                      <Button size="sm" onClick={openExtensionDialog} disabled={!canExtendRentalTerm}>
                        Продлить аренду
                      </Button>
                      {rentalDetailId ? (
                        <Button size="sm" variant="secondary" asChild>
                          <Link to={`/rentals/${encodeURIComponent(rentalDetailId)}`}>
                            Открыть полную карточку
                          </Link>
                        </Button>
                      ) : (
                        <Button size="sm" variant="secondary" onClick={openRentalCard}>Открыть полную карточку</Button>
                      )}
                    </div>
                  </div>
                </section>
              )}

              {activeTab === 'terms' && canManageRentalReturn && showEarlyReturn && (
                <section>
                  <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                    <div className="mb-2 text-xs text-red-700 dark:text-red-400">
                      Техника будет помечена как возвращённая, аренда закроется.
                    </div>
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <div className="flex-1">
                        <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Фактическая дата возврата *</label>
                        <input
                          type="date"
                          value={earlyReturnDate}
                          max={rental.endDate}
                          onChange={e => { setEarlyReturnDate(e.target.value); setEarlyReturnConfirm(false); }}
                          className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                        />
                      </div>
                      {!earlyReturnConfirm ? (
                        <Button
                          size="sm"
                          variant="destructive"
                          onClick={handleEarlyReturnSubmit}
                        >
                          Оформить
                        </Button>
                      ) : (
                        <div className="flex gap-1">
                          <Button size="sm" variant="destructive" onClick={handleEarlyReturnConfirm}>Подтвердить</Button>
                          <Button size="sm" variant="ghost" onClick={() => setEarlyReturnConfirm(false)}>Отмена</Button>
                        </div>
                      )}
                    </div>
                    {earlyReturnConfirm && (
                      <p className="mt-1.5 text-xs text-red-700 dark:text-red-400">
                        Подтвердить досрочный возврат {formatDate(earlyReturnDate)}?
                      </p>
                    )}
                  </div>
                </section>
              )}
            </section>
          )}

          {/* Payment Block */}
          {activeTab === 'payments' && !canViewMoney && (
            <section className="rounded-2xl border border-dashed border-slate-200 bg-white p-6 text-center text-sm text-slate-500 dark:border-gray-800 dark:bg-gray-900/70 dark:text-gray-400">
              Финансовые суммы по аренде скрыты для вашей роли.
            </section>
          )}

          {activeTab === 'payments' && canViewMoney && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <CreditCard className="h-4 w-4" />
                <span>Оплата</span>
              </div>
              {canRegisterPayment && (
                <button
                  onClick={() => setShowAddPayment(v => !v)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                >
                  <Plus className="h-3 w-3" />
                  Создать платёж
                </button>
              )}
            </div>

            {(clientProfile || clientDebt) && (
              <div className={`mb-2 rounded-lg border px-3 py-3 text-sm ${
                (clientDebt?.exceededLimit || false)
                  ? 'border-red-300 bg-red-50 text-red-700 dark:border-red-700 dark:bg-red-900/20 dark:text-red-300'
                  : (clientDebt?.currentDebt || clientProfile?.debt || 0) > 0
                    ? 'border-amber-300 bg-amber-50 text-amber-700 dark:border-amber-700 dark:bg-amber-900/20 dark:text-amber-300'
                    : 'border-green-300 bg-green-50 text-green-700 dark:border-green-700 dark:bg-green-900/20 dark:text-green-300'
              }`}>
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-medium">
                      {(clientDebt?.exceededLimit || false)
                        ? 'Превышен кредитный лимит клиента'
                        : (clientDebt?.currentDebt || clientProfile?.debt || 0) > 0
                          ? 'У клиента есть задолженность'
                          : 'Финансовых ограничений не найдено'}
                    </p>
                    <p className="mt-1 text-xs opacity-90">
                      Условия оплаты: {clientProfile?.paymentTerms || 'не указаны'}
                      {clientProfile?.creditLimit ? ` · Лимит: ${formatCurrency(clientProfile.creditLimit)}` : ''}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-xs uppercase tracking-wide opacity-75">Долг</p>
                    <p className="text-base font-semibold">
                      {formatCurrency(clientDebt?.currentDebt ?? clientProfile?.debt ?? 0)}
                    </p>
                  </div>
                </div>
                {(clientDebt?.unpaidRentals || 0) > 0 && (
                  <p className="mt-2 text-xs opacity-90">
                    Неоплаченных аренд: {clientDebt?.unpaidRentals}
                    {(clientDebt?.overdueRentals || 0) > 0 && ` · просроченных: ${clientDebt?.overdueRentals}`}
                  </p>
                )}
              </div>
            )}

            {/* Payment summary */}
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
              <div className="flex items-center justify-between">
                <Badge variant={rentalPaymentVariant}>
                  {rentalPaymentLabel}
                </Badge>
                <div className="text-right">
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(rentalBillingAmount)}</div>
                  <div className="text-xs text-gray-500">общая сумма</div>
                </div>
              </div>

              {canRegisterPayment && !showAddPayment && (
                <button
                  onClick={() => setShowAddPayment(true)}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-sm font-medium text-blue-700 transition-colors hover:bg-blue-100 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300 dark:hover:bg-blue-900/30"
                >
                  <Plus className="h-4 w-4" />
                  Создать платёж на {formatCurrency(remaining)}
                </button>
              )}

              {/* Paid / Remaining */}
              {(totalPaid > 0 || rentalPayments.length > 0) && (
                <div className="mt-3 grid gap-2 border-t border-gray-200 pt-3 sm:grid-cols-2 dark:border-gray-700">
                  <div>
                    <div className="text-xs text-gray-500">Оплачено</div>
                    <div className="text-sm font-medium text-green-700 dark:text-green-400">{formatCurrency(totalPaid)}</div>
                  </div>
                  <div>
                    <div className="text-xs text-gray-500">Остаток</div>
                    <div className={`text-sm font-medium ${remaining > 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                      {remaining > 0 ? formatCurrency(remaining) : '—'}
                    </div>
                  </div>
                </div>
              )}

              {rental.expectedPaymentDate && (
                <div className="mt-2 flex items-center gap-1 text-xs text-gray-500">
                  <Clock className="h-3 w-3" />
                  <span>Ожидаемая оплата: {formatDate(rental.expectedPaymentDate)}</span>
                </div>
              )}

              {canEditRentals && (
                <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                  <div className="mb-1 text-xs text-gray-500 dark:text-gray-400">Статус оплаты</div>
                  <p className="mb-2 text-[11px] text-gray-400 dark:text-gray-500">
                    Если добавить платёж, статус пересчитается автоматически.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {(['paid', 'partial', 'unpaid'] as const).map(status => (
                      <button
                        key={status}
                        onClick={() => handlePaymentStatusChange(status)}
                        className={`rounded-md px-2.5 py-1 text-xs transition-colors ${
                          rental.paymentStatus === status
                            ? 'bg-[--color-primary] text-white'
                            : 'bg-white text-gray-600 hover:bg-gray-100 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700'
                        }`}
                      >
                        {paymentLabels[status]}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Add payment form */}
            {canRegisterPayment && showAddPayment && (
              <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                <div className="mb-2 text-xs font-medium text-blue-700 dark:text-blue-400">Создать платёж по аренде</div>
                <div className="grid gap-2 sm:grid-cols-2">
                  <div>
                    <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Сумма (₽) *</label>
                    <input
                      type="number"
                      value={payAmount}
                      onChange={e => setPayAmount(e.target.value)}
                      placeholder={remaining > 0 ? String(remaining) : '0'}
                      className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Дата оплаты *</label>
                    <input
                      type="date"
                      value={payDate}
                      onChange={e => setPayDate(e.target.value)}
                      className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                    />
                  </div>
                </div>
                <div className="mt-2">
                  <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Комментарий</label>
                  <input
                    type="text"
                    value={payComment}
                    onChange={e => setPayComment(e.target.value)}
                    placeholder="Например: предоплата, оплата по акту..."
                    className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  />
                </div>
                {payError && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{payError}</p>}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={handlePaySubmit}>Сохранить</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowAddPayment(false); setPayError(''); }}>Отмена</Button>
                </div>
              </div>
            )}

            {/* Payment history */}
            {rentalPayments.length > 0 && (
              <div className="mt-2 space-y-1.5">
                <div className="text-xs text-gray-500 dark:text-gray-400">История оплат:</div>
                {rentalPayments.map(p => (
                  <div key={p.id} className="flex items-center justify-between rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                    <div>
                      <div className="text-xs font-medium text-gray-900 dark:text-white">
                        {formatCurrency(getEffectivePaidAmount(p))}
                      </div>
                      {p.comment && <div className="text-xs text-gray-500">{p.comment}</div>}
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-gray-500">{p.paidDate ? formatDate(p.paidDate) : '—'}</div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
          )}

          {activeTab === 'delivery' && (
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900/70">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <div className="text-sm font-semibold text-slate-950 dark:text-white">Логистика аренды</div>
                  <div className="text-xs text-slate-500 dark:text-gray-400">Выдача, возвратная доставка и перевозчик.</div>
                </div>
                {canCreateDeliveries && (
                  <div className="flex flex-wrap justify-end gap-2">
                    <Button size="sm" variant="secondary" className="rounded-xl" asChild>
                      <Link to={createDeliveryUrl('shipping')}>
                        <Truck className="h-4 w-4" />
                        Создать доставку
                      </Link>
                    </Button>
                    <Button size="sm" variant="secondary" className="rounded-xl" asChild>
                      <Link to={createDeliveryUrl('receiving')}>
                        <RotateCcw className="h-4 w-4" />
                        Создать возвратную доставку
                      </Link>
                    </Button>
                  </div>
                )}
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/60">
                  <div className="text-xs text-slate-500 dark:text-gray-400">Локация выдачи</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{rentalLocation}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/60">
                  <div className="text-xs text-slate-500 dark:text-gray-400">Локация возврата</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{rentalLocation}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/60">
                  <div className="text-xs text-slate-500 dark:text-gray-400">Плановый возврат</div>
                  <div className="mt-1 text-sm font-semibold text-slate-950 dark:text-white">{formatDate(rental.endDate)}</div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 dark:border-gray-800 dark:bg-gray-950/60">
                  <div className="text-xs text-slate-500 dark:text-gray-400">Состояние</div>
                  <div className={`mt-1 text-sm font-semibold ${isReturnOverdue ? 'text-red-600 dark:text-red-400' : 'text-slate-950 dark:text-white'}`}>{daysLeftLabel}</div>
                </div>
              </div>
              {relatedDeliveries.length > 0 ? (
                <div className="mt-3 space-y-2">
                  {relatedDeliveries.map(delivery => (
                    <div key={delivery.id} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-950/60">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="text-sm font-semibold text-slate-950 dark:text-white">
                            {deliveryTypeLabels[delivery.type] || 'Доставка'} · {formatDate(delivery.transportDate)}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                            {delivery.origin || '—'} → {delivery.destination || '—'}
                          </div>
                          <div className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                            Перевозчик: {delivery.carrierName || 'не назначен'}
                          </div>
                        </div>
                        <Badge variant={delivery.status === 'completed' ? 'success' : delivery.status === 'cancelled' ? 'default' : 'info'}>
                          {deliveryStatusLabels[delivery.status] || delivery.status}
                        </Badge>
                      </div>
                      {delivery.comment && (
                        <div className="mt-2 text-xs text-slate-500 dark:text-gray-400">{delivery.comment}</div>
                      )}
                      <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500 dark:text-gray-400">
                        <span className="font-mono">{delivery.id}</span>
                        {canViewMoney && <span>{formatCurrency(Number(delivery.cost) || 0)}</span>}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-5 text-center dark:border-gray-800 dark:bg-gray-950/60">
                  <Truck className="mx-auto h-5 w-5 text-slate-400 dark:text-gray-500" />
                  <div className="mt-2 text-sm font-semibold text-slate-950 dark:text-white">По этой аренде доставка ещё не создана</div>
                  <p className="mt-1 text-xs text-slate-500 dark:text-gray-400">
                    Создайте доставку или возвратную доставку.
                  </p>
                </div>
              )}
              <div className="mt-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700 dark:border-blue-900/50 dark:bg-blue-950/20 dark:text-blue-300">
                Чтобы изменить срок аренды, перейдите во вкладку «Сроки и возврат».
              </div>
            </section>
          )}

          {/* Documents / UPD */}
          {activeTab === 'documents' && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <FileText className="h-4 w-4" />
                <span>Документы</span>
              </div>
              {canCreateDocuments && (
                <Button size="sm" variant="secondary" className="rounded-xl" asChild>
                  <Link to={createDocumentUrl}>
                    <FileText className="h-4 w-4" />
                    Создать документ
                  </Link>
                </Button>
              )}
            </div>

            <div className="mb-3 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-700 dark:bg-gray-900/40">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-gray-900 dark:text-white">Документы аренды</h3>
                  <p className="mt-0.5 text-xs text-gray-500 dark:text-gray-400">
                    Контроль договора, спецификации и актов по этой аренде.
                  </p>
                </div>
                <Button size="sm" variant="ghost" className="rounded-xl" asChild>
                  <Link to={`/documents?rentalId=${encodeURIComponent(canonicalRentalId || rental.id)}`}>
                    Открыть все документы клиента/аренды
                  </Link>
                </Button>
              </div>
              {documentActionError ? (
                <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs font-medium text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-200">
                  {documentActionError}
                </div>
              ) : null}
              <div className="mt-3 space-y-2">
                {rentalDocumentChainRows.map(row => {
                  const docNumber = row.doc?.documentNumber || row.doc?.number || '';
                  const docDate = row.doc?.documentDate || row.doc?.date || row.doc?.createdAt || '';
                  const docStatus = row.doc ? documentStatusLabels[row.doc.status] || 'Черновик' : 'Не создан';
                  const isReady = Boolean(row.doc);
                  return (
                    <div
                      key={row.id}
                      className={`rounded-md border px-3 py-2 ${
                        isReady
                          ? 'border-emerald-200 bg-emerald-50/60 dark:border-emerald-900/60 dark:bg-emerald-950/20'
                          : 'border-amber-200 bg-amber-50/70 dark:border-amber-900/60 dark:bg-amber-950/20'
                      }`}
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            {isReady ? (
                              <CircleCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                            ) : (
                              <CircleAlert className="h-4 w-4 text-amber-500" />
                            )}
                            <span className="text-sm font-medium text-gray-900 dark:text-white">{row.label}</span>
                            <Badge variant={isReady ? 'success' : 'warning'}>
                              {isReady ? 'Есть' : 'Нет'}
                            </Badge>
                          </div>
                          <p className="mt-1 text-xs text-gray-600 dark:text-gray-300">
                            {isReady
                              ? `${docNumber || 'Без номера'} · ${docDate ? formatDate(docDate) : 'Без даты'} · ${docStatus}`
                              : row.missingHint}
                          </p>
                        </div>
                        <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                          {row.doc ? (
                            <>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 rounded-lg px-2"
                                onClick={() => void openRentalDocument(row.doc)}
                                disabled={documentActionPendingId === row.doc.id}
                              >
                                <Eye className="h-3.5 w-3.5" />
                                Открыть
                              </Button>
                              <Button
                                size="sm"
                                variant="secondary"
                                className="h-7 rounded-lg px-2"
                                onClick={() => void openRentalDocument(row.doc)}
                                disabled={documentActionPendingId === row.doc.id}
                              >
                                <Printer className="h-3.5 w-3.5" />
                                Печать
                              </Button>
                            </>
                          ) : canCreateDocuments ? (
                            <>
                              {row.createType === 'rental_specification' && !chainContract ? (
                                <Button size="sm" variant="secondary" className="h-7 rounded-lg px-2" asChild>
                                  <Link to={createRentalDocumentUrl('rental_contract')}>Создать договор</Link>
                                </Button>
                              ) : null}
                              {['transfer_act_to_client', 'return_act_from_client'].includes(row.createType) && !chainSpecification ? (
                                <Button size="sm" variant="secondary" className="h-7 rounded-lg px-2" asChild>
                                  <Link to={createRentalDocumentUrl('rental_specification')}>Создать спецификацию</Link>
                                </Button>
                              ) : null}
                              <Button size="sm" className="h-7 rounded-lg px-2" asChild>
                                <Link to={createRentalDocumentUrl(row.createType)}>Создать</Link>
                              </Button>
                            </>
                          ) : (
                            <span className="text-xs text-gray-500 dark:text-gray-400">Нет прав на создание</span>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
              {/* UPD row */}
              <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-gray-700 dark:text-gray-300">УПД</span>
                <div className="flex items-center gap-2">
                  {rental.updSigned ? (
                    <>
                      <CircleCheck className="h-4 w-4 text-green-600" />
                      <span className="text-sm text-green-700 dark:text-green-400">Подписан</span>
                      {rental.updDate && (
                        <span className="text-xs text-gray-500">({formatDate(rental.updDate)})</span>
                      )}
                    </>
                  ) : (
                    <>
                      <CircleAlert className="h-4 w-4 text-amber-500" />
                      <span className="text-sm text-amber-600 dark:text-amber-400">Не подписан</span>
                    </>
                  )}
                </div>
              </div>

              {/* UPD action buttons */}
              {canEditRentals && !updEditMode && !updUnsignConfirm && (
                <div className="mt-2 flex gap-2">
                  {!rental.updSigned ? (
                    <button
                      onClick={() => { setUpdEditMode(true); setUpdDateInput(new Date().toISOString().slice(0, 10)); }}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-green-700 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20"
                    >
                      <CircleCheck className="h-3 w-3" />
                      Отметить как подписан
                    </button>
                  ) : (
                    <button
                      onClick={() => setUpdUnsignConfirm(true)}
                      className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      <CircleAlert className="h-3 w-3" />
                      Снять подпись
                    </button>
                  )}
                </div>
              )}

              {/* Sign UPD form */}
              {canEditRentals && updEditMode && (
                <div className="mt-3 rounded-md border border-green-200 bg-green-50 p-2.5 dark:border-green-800 dark:bg-green-900/20">
                  <p className="mb-2 text-xs font-medium text-green-700 dark:text-green-400">Дата подписания</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="date"
                      value={updDateInput}
                      onChange={e => setUpdDateInput(e.target.value)}
                      className="h-8 flex-1 rounded border border-gray-300 bg-white px-2 text-sm text-gray-900 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                    />
                    <button
                      onClick={() => {
                        onUpdChange(rental, true, updDateInput || undefined);
                        setUpdEditMode(false);
                      }}
                      className="rounded-md bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                    >
                      Сохранить
                    </button>
                    <button
                      onClick={() => setUpdEditMode(false)}
                      className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}

              {/* Unsign confirm */}
              {canEditRentals && updUnsignConfirm && (
                <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 p-2.5 dark:border-amber-800 dark:bg-amber-900/20">
                  <p className="mb-2 text-xs text-amber-700 dark:text-amber-400">Снять отметку о подписании УПД?</p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        onUpdChange(rental, false);
                        setUpdUnsignConfirm(false);
                      }}
                      className="rounded-md bg-amber-600 px-3 py-1 text-xs font-medium text-white hover:bg-amber-700"
                    >
                      Да, снять
                    </button>
                    <button
                      onClick={() => setUpdUnsignConfirm(false)}
                      className="rounded-md px-2 py-1 text-xs text-gray-500 hover:bg-gray-100 dark:hover:bg-gray-700"
                    >
                      Отмена
                    </button>
                  </div>
                </div>
              )}
            </div>
            {relatedDocuments.length > 0 ? (
              <div className="mt-2 space-y-1.5">
                <div className="text-xs text-gray-500 dark:text-gray-400">Документы по аренде:</div>
                {relatedDocuments.map(doc => {
                  const docNumber = doc.documentNumber || doc.number || 'Без номера';
                  const docDate = doc.documentDate || doc.date || doc.createdAt || '';
                  const docType = documentTypeLabels[doc.documentType || doc.type] || 'Документ';
                  const docStatus = documentStatusLabels[doc.status] || 'Черновик';
                  return (
                    <div key={doc.id} className="rounded-md border border-gray-200 bg-white px-3 py-2 dark:border-gray-700 dark:bg-gray-900/30">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-xs font-medium text-gray-900 dark:text-white" title={`${docType} · ${docNumber}`}>
                            {docType} · {docNumber}
                          </div>
                          <div className="mt-1 text-xs text-gray-500">
                            {docDate ? formatDate(docDate) : '—'} · {docStatus}
                          </div>
                        </div>
                        <Link to={`/documents?rentalId=${encodeURIComponent(canonicalRentalId || doc.rentalId || doc.rental || '')}`} className="shrink-0 text-xs font-medium text-[--color-primary] hover:underline">
                          Открыть
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-2 rounded-lg border border-dashed border-gray-200 p-3 text-center text-sm text-gray-400 dark:border-gray-700">
                По этой аренде документы ещё не созданы
              </div>
            )}
          </section>
          )}

          {/* Manager */}
          {activeTab === 'overview' && (
          <section>
            <div className="mb-2 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <User className="h-4 w-4" />
                <span>Ответственный менеджер</span>
              </div>
              {canReassignManager && !managerEditMode && (
                <button
                  onClick={() => setManagerEditMode(true)}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                >
                  <Edit className="h-3 w-3" />
                  Изменить
                </button>
              )}
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
              {managerEditMode && canReassignManager ? (
                <div className="space-y-3">
                  <select
                    value={editManager}
                    onChange={event => setEditManager(event.target.value)}
                    className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 focus:border-transparent focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                  >
                    <option value="">Выберите менеджера</option>
                    {activeManagers.map(managerItem => (
                      <option key={managerItem.id} value={managerItem.name}>
                        {managerItem.name}
                      </option>
                    ))}
                  </select>
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleManagerSave} disabled={!editManager.trim()}>
                      Сохранить
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setManagerEditMode(false);
                        setEditManager(rental.manager);
                      }}
                    >
                      Отмена
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-center gap-3">
                  <div className="flex h-8 w-8 items-center justify-center rounded-full bg-blue-100 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
                    {rental.managerInitials}
                  </div>
                  <span className="text-sm text-gray-900 dark:text-white">{rental.manager}</span>
                </div>
              )}
            </div>
          </section>
          )}

          {/* Comments / History */}
          {activeTab === 'history' && (
          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <MessageSquare className="h-4 w-4" />
                <span>История изменений</span>
              </div>
              {canEditRentals && (
                <button
                  onClick={() => {
                    setShowCommentForm(v => !v);
                    setCommentError('');
                  }}
                  className="flex items-center gap-1 rounded-md px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
                >
                  <Plus className="h-3 w-3" />
                  Добавить запись
                </button>
              )}
            </div>
            {canEditRentals && showCommentForm && (
              <div className="mb-3 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                <div className="mb-1 text-xs font-medium text-blue-700 dark:text-blue-400">Новая запись в историю</div>
                <textarea
                  value={commentText}
                  onChange={e => setCommentText(e.target.value)}
                  placeholder="Например: согласовано продление, ждём оплату, клиент подтвердил возврат..."
                  className="min-h-24 w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                />
                {commentError && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{commentError}</p>}
                <div className="mt-2 flex gap-2">
                  <Button size="sm" onClick={handleCommentSave}>Сохранить</Button>
                  <Button size="sm" variant="ghost" onClick={() => { setShowCommentForm(false); setCommentError(''); }}>
                    Отмена
                  </Button>
                </div>
              </div>
            )}
            <div className="space-y-2">
              {rentalComments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-sm text-gray-400 dark:border-gray-700">
                  Нет записей
                </div>
              ) : (
                rentalComments.map((comment, idx) => (
                  <div key={`${comment.date || 'date'}-${comment.author || 'author'}-${idx}`} className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                    <div className="flex items-center justify-between text-xs text-gray-500">
                      <span>{comment.author}</span>
                      <span>{formatDateTime(comment.date)}</span>
                    </div>
                    <p className="mt-1 text-sm text-gray-700 dark:text-gray-300">{comment.text}</p>
                  </div>
                ))
              )}
            </div>
          </section>
          )}
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          {canEditRentals && rental.status === 'created' && (
            <Button size="sm" onClick={() => onStatusChange(rental)}>
              <ArrowRight className="h-3.5 w-3.5" />
              Активировать аренду
            </Button>
          )}
          {canShowExtendShortcut && (
            <Button
              size="sm"
              onClick={() => {
                setActiveTab('terms');
                setShowExtend(true);
              }}
            >
              <CalendarClock className="h-3.5 w-3.5" />
              Продлить аренду
            </Button>
          )}
          {canManageRentalReturn && (
            <Button size="sm" variant="secondary" onClick={() => onReturn(rental)}>
              <RotateCcw className="h-3.5 w-3.5" />
              Оформить возврат
            </Button>
          )}
          {canEditRentals && rental.status === 'returned' && (
            <Button size="sm" onClick={() => onStatusChange(rental)}>
              <CircleCheck className="h-3.5 w-3.5" />
              Закрыть аренду
            </Button>
          )}
          {canRestoreRentals && (rental.status === 'returned' || rental.status === 'closed') && (
            <Button size="sm" variant="secondary" onClick={() => onRestore(rental)}>
              <RotateCcw className="h-3.5 w-3.5" />
              Восстановить аренду
            </Button>
          )}
          {canManageDowntimes && (
            <Button size="sm" variant="ghost" onClick={() => onDowntime(rental)}>
              <PauseCircle className="h-3.5 w-3.5" />
              Создать простой
            </Button>
          )}

          {canDeleteRentals && (
            <div className="ml-auto flex items-center gap-2">
              {confirmDelete ? (
                <>
                  <span className="text-xs text-red-600 dark:text-red-400">Удалить безвозвратно?</span>
                  <Button
                    size="sm"
                    variant="destructive"
                    onClick={() => { setConfirmDelete(false); onDelete(rental); }}
                  >
                    Да, удалить
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setConfirmDelete(false)}>
                    Отмена
                  </Button>
                </>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-red-500 hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-900/20"
                  onClick={() => setConfirmDelete(true)}
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Удалить аренду
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      <Dialog open={extensionDialogOpen} onOpenChange={setExtensionDialogOpen}>
        <DialogContent className="w-[calc(100vw-1rem)] overflow-y-auto sm:max-w-lg" data-rental-responsive-dialog="drawer-extension">
          <DialogHeader>
            <DialogTitle>Продлить аренду</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid gap-2 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm dark:border-gray-800 dark:bg-gray-950/60">
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 dark:text-gray-400">Текущая дата возврата</span>
                <span className="font-semibold text-slate-950 dark:text-white">{formatDate(rental.endDate)}</span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-slate-500 dark:text-gray-400">Счёт по продлению</span>
                <span className="font-semibold text-slate-950 dark:text-white">
                  {(rental as GanttRentalData & { extensionInvoiceSentToClient?: boolean }).extensionInvoiceSentToClient ? 'отправлен' : 'не отправлен'}
                </span>
              </div>
              {clientDebt && canViewMoney && (
                <div className="flex justify-between gap-3">
                  <span className="text-slate-500 dark:text-gray-400">Долг клиента</span>
                  <span className="font-semibold text-slate-950 dark:text-white">{formatCurrency(clientDebt.currentDebt || 0)}</span>
                </div>
              )}
              {extensionConflict && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-800 dark:border-amber-800 dark:bg-amber-900/20 dark:text-amber-200">
                  Конфликт техники: {extensionConflict.client}, {extensionConflict.period}
                </div>
              )}
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Новая дата окончания *</label>
              <input
                type="date"
                value={extensionForm.newPlannedReturnDate}
                min={extensionStartDate || rental.endDate}
                onChange={event => {
                  setExtensionForm(prev => ({ ...prev, newPlannedReturnDate: event.target.value }));
                  setExtensionError('');
                }}
                className="w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700 dark:text-gray-300">Комментарий</label>
              <textarea
                value={extensionForm.comment}
                onChange={event => setExtensionForm(prev => ({ ...prev, comment: event.target.value }))}
                className="min-h-20 w-full rounded border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
              />
            </div>
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={extensionForm.confirmedByClient}
                onChange={event => {
                  setExtensionForm(prev => ({ ...prev, confirmedByClient: event.target.checked }));
                  setExtensionError('');
                }}
                className="mt-1"
              />
              Клиент согласовал продление
            </label>
            <label className="flex items-start gap-2 text-sm text-gray-700 dark:text-gray-300">
              <input
                type="checkbox"
                checked={extensionForm.invoiceSentToClient}
                onChange={event => {
                  setExtensionForm(prev => ({ ...prev, invoiceSentToClient: event.target.checked }));
                  setExtensionError('');
                }}
                className="mt-1"
              />
              Счёт отправлен клиенту
            </label>
            {(extensionError || extensionValidation) && (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300">
                {extensionError || extensionValidation}
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setExtensionDialogOpen(false)}>Отмена</Button>
            <Button onClick={() => void handleExtendRental()} disabled={isExtending || Boolean(extensionValidation)}>
              {isExtending ? 'Продление...' : 'Продлить аренду'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </div>
  );
}
