import React, { useEffect, useState } from 'react';
import {
  X, Calendar, CreditCard, FileText, User, MessageSquare,
  ArrowRight, RotateCcw, CirclePause as PauseCircle,
  CircleCheck, CircleAlert, Clock, Trash2, Plus, ChevronDown, ChevronUp,
  CalendarClock, LogOut, Edit, Wrench
} from 'lucide-react';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../ui/dialog';
import { formatCurrency, formatDate, formatDateTime, getRentalDays } from '../../lib/utils';
import { findConflictingRental } from '../../lib/rental-conflicts';
import type { GanttRentalData } from '../../mock-data';
import type { Client, Equipment, Payment } from '../../types';
import type { ClientReceivableRow } from '../../lib/finance';
import { filterRentalManagerUsers, type SystemUser } from '../../lib/userStorage';

interface RentalDrawerProps {
  rental: GanttRentalData | null;
  equipment: Equipment | undefined;
  allRentals: GanttRentalData[];
  payments: Payment[];
  clients?: Client[];
  clientReceivables?: ClientReceivableRow[];
  managers?: SystemUser[];
  canEditRentals: boolean;
  canEditRentalDates: boolean;
  canReassignManager: boolean;
  canRestoreRentals: boolean;
  canDeleteRentals: boolean;
  canCreatePayments: boolean;
  onClose: () => void;
  onReturn: (rental: GanttRentalData) => void;
  onStatusChange: (rental: GanttRentalData) => void;
  onRestore: (rental: GanttRentalData) => void;
  onDelete: (rental: GanttRentalData) => void;
  onUpdate: (rental: GanttRentalData, data: Partial<GanttRentalData>) => void;
  onAddComment: (rental: GanttRentalData, text: string) => void;
  onAddPayment: (rentalId: string, amount: number, paidDate: string, comment: string) => void;
  onExtend: (rental: GanttRentalData, newEndDate: string) => void;
  onEarlyReturn: (rental: GanttRentalData, actualReturnDate: string) => void;
  onUpdChange: (rental: GanttRentalData, updSigned: boolean, updDate?: string) => void;
  onUpdateMaintenanceFilters: (
    equipment: Equipment,
    data: Pick<Equipment, 'maintenanceEngineFilter' | 'maintenanceFuelFilter' | 'maintenanceHydraulicFilter'>,
  ) => void;
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

export function RentalDrawer({
  rental, equipment, allRentals, payments,
  clients = [], clientReceivables = [], managers = [],
  canEditRentals, canEditRentalDates, canReassignManager, canRestoreRentals, canDeleteRentals, canCreatePayments,
  onClose, onReturn, onStatusChange, onDelete,
  onRestore, onUpdate, onAddComment, onAddPayment, onExtend, onEarlyReturn, onUpdChange, onUpdateMaintenanceFilters,
}: RentalDrawerProps) {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showEdit, setShowEdit] = useState(false);
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

  // Add payment form state
  const [showAddPayment, setShowAddPayment] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payDate, setPayDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [payComment, setPayComment] = useState('');
  const [payError, setPayError] = useState('');

  // Extend rental state
  const [showExtend, setShowExtend] = useState(false);
  const [extendDate, setExtendDate] = useState('');
  const [extendError, setExtendError] = useState('');
  const [extendConfirm, setExtendConfirm] = useState(false);

  // Early return state
  const [showEarlyReturn, setShowEarlyReturn] = useState(false);
  const [earlyReturnDate, setEarlyReturnDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [earlyReturnConfirm, setEarlyReturnConfirm] = useState(false);

  // UPD state
  const [updEditMode, setUpdEditMode] = useState(false);
  const [updDateInput, setUpdDateInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [updUnsignConfirm, setUpdUnsignConfirm] = useState(false);
  const [showMaintenanceDialog, setShowMaintenanceDialog] = useState(false);
  const [engineFilter, setEngineFilter] = useState('');
  const [fuelFilter, setFuelFilter] = useState('');
  const [hydraulicFilter, setHydraulicFilter] = useState('');

  if (!rental) return null;

  useEffect(() => {
    if (!rental) return;
    setShowEdit(false);
    setEditClient(rental.client);
    setEditManager(rental.manager);
    setEditStartDate(rental.startDate);
    setEditEndDate(rental.endDate);
    setEditAmount(String(rental.amount || 0));
    setEditExpectedPaymentDate(rental.expectedPaymentDate || '');
    setEditError('');
    setShowCommentForm(false);
    setCommentText('');
    setCommentError('');
    setManagerEditMode(false);
    setShowMaintenanceDialog(false);
  }, [rental]);

  useEffect(() => {
    setEngineFilter(equipment?.maintenanceEngineFilter || '');
    setFuelFilter(equipment?.maintenanceFuelFilter || '');
    setHydraulicFilter(equipment?.maintenanceHydraulicFilter || '');
  }, [equipment]);

  const activeManagers = filterRentalManagerUsers(managers);

  // Payments for this rental
  const rentalPayments = payments.filter(p => p.rentalId === rental.id);
  const explicitPaidAmount = rentalPayments.reduce((sum, p) => sum + (p.paidAmount ?? p.amount), 0);
  const totalPaid = rentalPayments.length === 0 && rental.paymentStatus === 'paid'
    ? rental.amount
    : explicitPaidAmount;
  const remaining = Math.max(0, rental.amount - totalPaid);
  const canRegisterPayment = canCreatePayments && remaining > 0;
  const todayKey = new Date().toISOString().slice(0, 10);
  const isReturnOverdue = rental.status === 'active' && rental.endDate < todayKey;
  const overdueDays = isReturnOverdue
    ? Math.max(1, Math.ceil((new Date(todayKey).getTime() - new Date(rental.endDate).getTime()) / 86400000))
    : 0;
  const clientProfile = clients.find(item => item.company === rental.client);
  const clientDebt = clientReceivables.find(item => item.client === rental.client);

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
    onAddPayment(rental.id, amt, payDate, payComment);
    setPayAmount('');
    setPayComment('');
    setPayDate(new Date().toISOString().slice(0, 10));
    setShowAddPayment(false);
  };

  // Handle extend submit
  const handleExtendSubmit = () => {
    if (!canEditRentals) return;
    if (!extendDate) {
      setExtendError('Укажите новую дату возврата');
      return;
    }
    if (extendDate <= rental.endDate) {
      setExtendError('Новая дата должна быть позже текущей даты возврата');
      return;
    }
    // Check conflicts: other rentals for the same equipment that overlap [rental.endDate, newEndDate]
    const conflict = findConflictingRental(
      { id: rental.equipmentId || rental.equipmentInv, inventoryNumber: rental.equipmentInv },
      rental.endDate,
      extendDate,
      allRentals,
      rental.id,
    );
    if (conflict) {
      setExtendError(`Конфликт: техника занята до ${formatDate(conflict.endDate)} (${conflict.client})`);
      return;
    }
    setExtendError('');
    setExtendConfirm(true);
  };

  const handleExtendConfirm = () => {
    if (!canEditRentals) return;
    onExtend(rental, extendDate);
    setShowExtend(false);
    setExtendDate('');
    setExtendConfirm(false);
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
    if (!editClient.trim()) {
      setEditError('Укажите клиента');
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
    if (conflict) {
      setEditError(`Конфликт: техника занята ${formatDate(conflict.startDate)} — ${formatDate(conflict.endDate)} (${conflict.client})`);
      return;
    }

    setEditError('');
    onUpdate(rental, {
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

  const handleMaintenanceSave = () => {
    if (!equipment) return;
    onUpdateMaintenanceFilters(equipment, {
      maintenanceEngineFilter: engineFilter.trim() || undefined,
      maintenanceFuelFilter: fuelFilter.trim() || undefined,
      maintenanceHydraulicFilter: hydraulicFilter.trim() || undefined,
    });
    setShowMaintenanceDialog(false);
  };

  const maintenanceRows = [
    { label: 'Фильтр двигателя', value: equipment?.maintenanceEngineFilter },
    { label: 'Топливная система', value: equipment?.maintenanceFuelFilter },
    { label: 'Гидравлический фильтр', value: equipment?.maintenanceHydraulicFilter },
  ];
  const hasMaintenanceFilters = maintenanceRows.some(row => !!row.value?.trim());

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Overlay */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Drawer */}
      <div className="relative z-10 flex w-[38%] min-w-[420px] max-w-[600px] flex-col bg-white shadow-2xl dark:bg-gray-800">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-gray-200 p-5 dark:border-gray-700">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <h2 className="truncate text-lg text-gray-900 dark:text-white">{rental.client}</h2>
              <Badge variant={statusVariants[rental.status]}>{statusLabels[rental.status]}</Badge>
              {isReturnOverdue && (
                <Badge variant="warning">
                  Срок истёк · {overdueDays} дн.
                </Badge>
              )}
            </div>
            <div className="mt-1 flex items-center gap-3 text-sm text-gray-500 dark:text-gray-400">
              <span className="font-mono">{rental.id}</span>
              <span>·</span>
              <span>
                {rental.equipmentInv} {equipment?.model}
                {equipment?.serialNumber ? ` · SN ${equipment.serialNumber}` : ''}
              </span>
            </div>
          </div>
          <button
            onClick={onClose}
            className="ml-3 rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 space-y-5 overflow-y-auto p-5">
          {isReturnOverdue && (
            <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800 dark:bg-amber-900/20">
              <div className="flex items-start gap-2">
                <CircleAlert className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-semibold text-amber-800 dark:text-amber-300">
                    Срок аренды истёк, но возврат не оформлен
                  </p>
                  <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                    Просрочка {overdueDays} {overdueDays === 1 ? 'день' : overdueDays < 5 ? 'дня' : 'дней'}. Эту аренду нужно либо продлить, либо оформить возврат техники.
                  </p>
                </div>
              </div>
            </div>
          )}

          {canEditRentals && (
            <section>
              <button
                onClick={() => {
                  setShowEdit(v => !v);
                  setEditError('');
                }}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300 dark:hover:bg-gray-700/50"
              >
                <div className="flex items-center gap-2">
                  <Edit className="h-4 w-4 text-gray-400" />
                  <span>Редактировать аренду</span>
                </div>
                {showEdit ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </button>

              {showEdit && (
                <div className="mt-2 rounded-lg border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-900/20">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="col-span-2">
                      <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Клиент *</label>
                      <input
                        type="text"
                        value={editClient}
                        onChange={e => setEditClient(e.target.value)}
                        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                      />
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
              )}
            </section>
          )}

          {/* Dates */}
          <section>
            <div className="mb-2 flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
              <Calendar className="h-4 w-4" />
              <span>Даты аренды</span>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
              <div className="flex items-center gap-3">
                <div>
                  <div className="text-xs text-gray-500">Начало</div>
                  <div className="text-sm text-gray-900 dark:text-white">{formatDate(rental.startDate)}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-gray-400" />
                <div>
                  <div className="text-xs text-gray-500">Окончание</div>
                  <div className="text-sm text-gray-900 dark:text-white">{formatDate(rental.endDate)}</div>
                </div>
                <div className="ml-auto">
                  <div className="text-xs text-gray-500">Дней</div>
                  <div className="text-sm text-gray-900 dark:text-white">
                    {getRentalDays(rental.startDate, rental.endDate)}
                  </div>
                </div>
              </div>
            </div>
          </section>

          <section>
            <div className="mb-2 flex items-center justify-between gap-3">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <Wrench className="h-4 w-4" />
                <span>ТО</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setShowMaintenanceDialog(true)}
                disabled={!equipment}
              >
                ТО
              </Button>
            </div>
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
              {!equipment ? (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Техника для этой аренды не найдена.
                </p>
              ) : hasMaintenanceFilters ? (
                <div className="space-y-2">
                  {maintenanceRows.map(row => (
                    <div key={row.label} className="flex items-start justify-between gap-4">
                      <span className="text-xs uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">
                        {row.label}
                      </span>
                      <span className="max-w-[62%] text-right text-sm font-medium text-gray-900 dark:text-white">
                        {row.value}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  Фильтры для ТО ещё не заполнены.
                </p>
              )}
            </div>
          </section>

          {/* Payment Block */}
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
                <Badge variant={paymentVariants[rental.paymentStatus]}>
                  {paymentLabels[rental.paymentStatus]}
                </Badge>
                <div className="text-right">
                  <div className="text-lg font-semibold text-gray-900 dark:text-white">{formatCurrency(rental.amount)}</div>
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
                <div className="mt-3 grid grid-cols-2 gap-2 border-t border-gray-200 pt-3 dark:border-gray-700">
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
                        onClick={() => onPaymentStatusChange(rental, status)}
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
                <div className="grid grid-cols-2 gap-2">
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
                        {formatCurrency(p.paidAmount ?? p.amount)}
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

          {/* Extend Rental — only for active/created */}
          {canEditRentalDates && (rental.status === 'active' || rental.status === 'created') && (
            <section>
              <button
                onClick={() => setShowExtend(v => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300 dark:hover:bg-gray-700/50"
              >
                <div className="flex items-center gap-2">
                  <CalendarClock className="h-4 w-4 text-gray-400" />
                  <span>Продлить аренду</span>
                </div>
                {showExtend ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </button>

              {showExtend && (
                <div className="mt-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-800 dark:bg-amber-900/20">
                  <div className="mb-2 text-xs text-amber-700 dark:text-amber-400">
                    Текущая дата возврата: <strong>{formatDate(rental.endDate)}</strong>
                  </div>
                  <div className="flex items-end gap-2">
                    <div className="flex-1">
                      <label className="mb-1 block text-xs text-gray-600 dark:text-gray-400">Новая дата возврата *</label>
                      <input
                        type="date"
                        value={extendDate}
                        min={rental.endDate}
                        onChange={e => { setExtendDate(e.target.value); setExtendError(''); setExtendConfirm(false); }}
                        className="w-full rounded border border-gray-300 bg-white px-2 py-1.5 text-sm text-gray-900 dark:border-gray-600 dark:bg-gray-800 dark:text-white"
                      />
                    </div>
                    {!extendConfirm ? (
                      <Button size="sm" onClick={handleExtendSubmit}>Продлить</Button>
                    ) : (
                      <div className="flex gap-1">
                        <Button size="sm" onClick={handleExtendConfirm}>Подтвердить</Button>
                        <Button size="sm" variant="ghost" onClick={() => setExtendConfirm(false)}>Отмена</Button>
                      </div>
                    )}
                  </div>
                  {extendError && <p className="mt-1.5 text-xs text-red-600 dark:text-red-400">{extendError}</p>}
                  {extendConfirm && !extendError && (
                    <p className="mt-1.5 text-xs text-amber-700 dark:text-amber-400">
                      Продлить аренду до {formatDate(extendDate)}?
                    </p>
                  )}
                </div>
              )}
            </section>
          )}

          {/* Early Return — only for active */}
          {canEditRentalDates && rental.status === 'active' && (
            <section>
              <button
                onClick={() => setShowEarlyReturn(v => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:bg-gray-900/50 dark:text-gray-300 dark:hover:bg-gray-700/50"
              >
                <div className="flex items-center gap-2">
                  <LogOut className="h-4 w-4 text-gray-400" />
                  <span>Досрочный возврат</span>
                </div>
                {showEarlyReturn ? <ChevronUp className="h-4 w-4 text-gray-400" /> : <ChevronDown className="h-4 w-4 text-gray-400" />}
              </button>

              {showEarlyReturn && (
                <div className="mt-2 rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-800 dark:bg-red-900/20">
                  <div className="mb-2 text-xs text-red-700 dark:text-red-400">
                    Техника будет помечена как возвращённая, аренда закроется.
                  </div>
                  <div className="flex items-end gap-2">
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
              )}
            </section>
          )}

          {/* Documents / UPD */}
          <section>
            <div className="mb-2 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400">
                <FileText className="h-4 w-4" />
                <span>Документы</span>
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
          </section>

          {/* Manager */}
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

          {/* Comments / History */}
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
              {rental.comments.length === 0 ? (
                <div className="rounded-lg border border-dashed border-gray-200 p-3 text-center text-sm text-gray-400 dark:border-gray-700">
                  Нет записей
                </div>
              ) : (
                rental.comments.map((comment, idx) => (
                  <div key={idx} className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
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
        </div>

        {/* Footer Actions */}
        <div className="flex flex-wrap gap-2 border-t border-gray-200 p-4 dark:border-gray-700">
          {canEditRentals && rental.status === 'created' && (
            <Button size="sm" onClick={() => onStatusChange(rental)}>
              <ArrowRight className="h-3.5 w-3.5" />
              Активировать аренду
            </Button>
          )}
          {canEditRentals && rental.status === 'active' && (
            <Button size="sm" onClick={() => onReturn(rental)}>
              <RotateCcw className="h-3.5 w-3.5" />
              Возврат техники
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
          <Button size="sm" variant="ghost">
            <PauseCircle className="h-3.5 w-3.5" />
            Создать простой
          </Button>

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

      <Dialog open={showMaintenanceDialog} onOpenChange={setShowMaintenanceDialog}>
        <DialogContent className="sm:max-w-[620px]">
          <DialogHeader>
            <DialogTitle>ТО и фильтры</DialogTitle>
            <DialogDescription>
              {equipment
                ? `${equipment.manufacturer} ${equipment.model} · INV ${equipment.inventoryNumber}`
                : 'Заполните расходники для техники в аренде.'}
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4">
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Фильтр двигателя
              </label>
              <input
                type="text"
                value={engineFilter}
                onChange={event => setEngineFilter(event.target.value)}
                placeholder="Например: Fleetguard LF3349"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Фильтр топливной системы
              </label>
              <input
                type="text"
                value={fuelFilter}
                onChange={event => setFuelFilter(event.target.value)}
                placeholder="Например: Donaldson P550588"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500"
              />
            </div>
            <div>
              <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">
                Гидравлический фильтр
              </label>
              <input
                type="text"
                value={hydraulicFilter}
                onChange={event => setHydraulicFilter(event.target.value)}
                placeholder="Например: HY90438"
                className="w-full rounded-lg border border-gray-300 bg-white px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-[--color-primary] dark:border-gray-600 dark:bg-gray-800 dark:text-white dark:placeholder:text-gray-500"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowMaintenanceDialog(false)}>
              Отмена
            </Button>
            <Button onClick={handleMaintenanceSave} disabled={!equipment}>
              Сохранить
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
