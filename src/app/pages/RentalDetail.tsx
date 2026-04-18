import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { useClientsList } from '../hooks/useClients';
import { useDocumentsList } from '../hooks/useDocuments';
import { useEquipmentList } from '../hooks/useEquipment';
import { usePaymentsList } from '../hooks/usePayments';
import { RENTAL_KEYS, useGanttData, useRentalsList } from '../hooks/useRentals';
import { useServiceTicketsList } from '../hooks/useServiceTickets';
import { useAuth } from '../contexts/AuthContext';
import { usePermissions } from '../lib/permissions';
import { EQUIPMENT_KEYS } from '../hooks/useEquipment';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { getRentalStatusBadge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { Textarea } from '../components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../components/ui/dialog';
import {
  ArrowLeft, Edit, FileText, DollarSign, User, Calendar,
  Truck, Clock, MessageSquare, Wrench, AlertTriangle, CircleCheck, Save, X, RefreshCw, Plus,
} from 'lucide-react';
import { rentalsService } from '../services/rentals.service';
import { documentsService } from '../services/documents.service';
import { paymentsService } from '../services/payments.service';
import { equipmentService } from '../services/equipment.service';
import { appendRentalHistory, buildRentalUpdateHistory } from '../lib/rental-history';
import { appendAuditHistory, createAuditEntry } from '../lib/entity-history';
import { formatCurrency, formatDate, formatDateTime, getDaysUntil, getRentalDays } from '../lib/utils';
import type { DocumentType, Equipment, PaymentStatus, RentalStatus } from '../types';
import type { GanttRentalData } from '../mock-data';

const statusLabels: Record<RentalStatus, string> = {
  new: 'Создана',
  confirmed: 'Подтверждена',
  delivery: 'Доставка',
  active: 'Активна',
  return_planned: 'Возврат запланирован',
  closed: 'Закрыта',
};

type RentalFormState = {
  client: string;
  contact: string;
  manager: string;
  startDate: string;
  plannedReturnDate: string;
  actualReturnDate: string;
  status: RentalStatus;
  rate: string;
  price: string;
  discount: string;
  deliveryAddress: string;
  comments: string;
};

function buildInitialFormState(rental: {
  client: string;
  contact: string;
  manager: string;
  startDate: string;
  plannedReturnDate: string;
  actualReturnDate?: string;
  status: RentalStatus;
  rate: string;
  price: number;
  discount: number;
  deliveryAddress: string;
  comments?: string;
}): RentalFormState {
  return {
    client: rental.client,
    contact: rental.contact,
    manager: rental.manager,
    startDate: rental.startDate,
    plannedReturnDate: rental.plannedReturnDate,
    actualReturnDate: rental.actualReturnDate || '',
    status: rental.status,
    rate: rental.rate,
    price: String(rental.price || 0),
    discount: String(rental.discount || 0),
    deliveryAddress: rental.deliveryAddress || '',
    comments: rental.comments || '',
  };
}

function managerInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '—';
  return trimmed.split(/\s+/).map(part => part[0] || '').join('').slice(0, 2).toUpperCase();
}

function nextDocumentNumber(type: DocumentType, rentalId: string, existingCount: number) {
  const suffix = String(existingCount + 1).padStart(2, '0');
  if (type === 'contract') return `DOG-${rentalId}-${suffix}`;
  if (type === 'act') return `ACT-${rentalId}-${suffix}`;
  return `INV-${rentalId}-${suffix}`;
}

export default function RentalDetail() {
  const { id } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { can } = usePermissions();
  const { data: rentals = [] } = useRentalsList();
  const { data: ganttRentals = [] } = useGanttData();
  const { data: equipment = [] } = useEquipmentList();
  const { data: serviceTickets = [] } = useServiceTicketsList();
  const { data: payments = [] } = usePaymentsList();
  const { data: clients = [] } = useClientsList();
  const { data: documents = [] } = useDocumentsList();

  const rental = rentals.find(r => r.id === id);
  const canEditRentals = can('edit', 'rentals');
  const canEditRentalDates = user?.role === 'Администратор';
  const canCreateDocuments = can('create', 'documents');
  const canCreatePayments = can('create', 'payments');
  const canRestoreRentals = user?.role === 'Администратор';
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveInfo, setSaveInfo] = useState('');
  const [formState, setFormState] = useState<RentalFormState | null>(null);
  const [documentDialogOpen, setDocumentDialogOpen] = useState(false);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [isRestoring, setIsRestoring] = useState(false);
  const [isSubmittingDocument, setIsSubmittingDocument] = useState(false);
  const [isSubmittingPayment, setIsSubmittingPayment] = useState(false);
  const [documentForm, setDocumentForm] = useState({
    type: 'invoice' as DocumentType,
    number: '',
    date: new Date().toISOString().slice(0, 10),
    amount: '0',
    status: 'draft' as const,
  });
  const [paymentForm, setPaymentForm] = useState({
    invoiceNumber: '',
    amount: '0',
    paidAmount: '0',
    dueDate: new Date().toISOString().slice(0, 10),
    paidDate: new Date().toISOString().slice(0, 10),
    status: 'pending' as PaymentStatus,
    comment: '',
  });

  useEffect(() => {
    if (!rental) return;
    setFormState(buildInitialFormState(rental));
    setIsEditing(false);
    setIsSaving(false);
    setSaveError('');
    setSaveInfo('');
  }, [rental]);

  const inventoryCounts = useMemo(() => {
    const counts = new Map<string, number>();
    equipment.forEach(item => {
      if (!item.inventoryNumber) return;
      counts.set(item.inventoryNumber, (counts.get(item.inventoryNumber) || 0) + 1);
    });
    return counts;
  }, [equipment]);

  const uniqueEquipmentByInventory = useMemo(() => {
    const map = new Map<string, Equipment>();
    equipment.forEach(item => {
      if (!item.inventoryNumber) return;
      if ((inventoryCounts.get(item.inventoryNumber) || 0) === 1) {
        map.set(item.inventoryNumber, item);
      }
    });
    return map;
  }, [equipment, inventoryCounts]);

  const equipmentList = equipment.filter(e => (rental?.equipment || []).includes(e.inventoryNumber));
  const resolvedRentalEquipment = useMemo(
    () => (equipmentList.length > 0
      ? equipmentList
      : (rental?.equipment || []).map(inv => uniqueEquipmentByInventory.get(inv)).filter(Boolean) as Equipment[]),
    [equipmentList, rental?.equipment, uniqueEquipmentByInventory],
  );
  const safelyMatchesResolvedEquipment = React.useCallback((entry: GanttRentalData) => {
    return resolvedRentalEquipment.some(eq => {
      if (entry.equipmentId) {
        return entry.equipmentId === eq.id;
      }
      return (inventoryCounts.get(eq.inventoryNumber) || 0) === 1 && entry.equipmentInv === eq.inventoryNumber;
    });
  }, [inventoryCounts, resolvedRentalEquipment]);

  const selectedClient = clients.find(c => c.company === ((isEditing ? formState?.client : rental?.client) || ''));
  const relatedDocs = documents.filter(d => d.rental === rental?.id);
  const relatedInvoices = relatedDocs.filter(doc => doc.type === 'invoice');
  const relatedPayments = payments.filter(p => p.rentalId === rental?.id);
  const paidAmount = relatedPayments.reduce((sum, p) => sum + (p.paidAmount ?? (p.status === 'paid' ? p.amount : 0)), 0);
  const relatedService = serviceTickets.filter(ticket =>
    resolvedRentalEquipment.some(eq => eq.id === ticket.equipmentId),
  );
  const paymentsByInvoice = useMemo(() => {
    const map = new Map<string, typeof relatedPayments>();
    relatedPayments.forEach(payment => {
      const key = payment.invoiceNumber || 'Без счёта';
      const list = map.get(key) ?? [];
      list.push(payment);
      map.set(key, list);
    });
    return map;
  }, [relatedPayments]);

  const historyAuthor = user?.name || 'Система';

  const comments = [
    ...(rental?.comments ? [{
      date: rental.startDate,
      text: rental.comments,
      author: rental.manager || 'Система',
    }] : []),
    ...((linkedGanttRental?.comments || [])
      .filter(entry => entry.type !== 'system')
      .map(entry => ({
        date: entry.date,
        text: entry.text,
        author: entry.author,
      }))),
    ...relatedPayments
      .filter(p => p.comment)
      .map(p => ({
        date: p.paidDate || p.dueDate,
        text: p.comment || '',
        author: 'Платежи',
      })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const history = [
    ...((linkedGanttRental?.comments || [])
      .filter(entry => entry.type === 'system')
      .map(entry => ({
        date: entry.date,
        action: entry.text,
        user: entry.author,
      }))),
    ...((!linkedGanttRental?.comments?.some(entry => entry.type === 'system') && rental)
      ? [{ date: rental.startDate, action: 'Аренда создана', user: rental.manager || 'Система' }]
      : []),
    ...(relatedDocs.map(doc => ({
      date: doc.date,
      action: `Документ: ${doc.number}`,
      user: 'Документы',
    }))),
    ...(relatedPayments.map(payment => ({
      date: payment.paidDate || payment.dueDate,
      action: payment.status === 'paid'
        ? `Оплата получена: ${formatCurrency(payment.paidAmount ?? payment.amount)}`
        : `Платёж: ${payment.invoiceNumber}`,
      user: 'Платежи',
    }))),
    ...(rental?.actualReturnDate ? [{
      date: rental.actualReturnDate,
      action: 'Техника возвращена',
      user: rental.manager || 'Система',
    }] : []),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const rentalDays = getRentalDays(rental?.startDate || '', rental?.plannedReturnDate || '');
  const editingDays = getRentalDays(formState?.startDate || '', formState?.plannedReturnDate || '');
  const priceValue = Number(formState?.price);
  const discountValue = Number(formState?.discount);
  const nextTotal = Number.isFinite(priceValue) ? priceValue : (rental?.price || 0);
  const nextDiscount = Number.isFinite(discountValue) ? discountValue : (rental?.discount || 0);
  const remainingBalance = (rental?.price || 0) - (rental?.discount || 0) - paidAmount;
  const nextRemainingBalance = nextTotal - nextDiscount - paidAmount;

  const linkedGanttCandidates = useMemo(() => {
    return ganttRentals.filter(entry => {
      if (!rental) return false;
      if (entry.client !== rental.client) return false;
      if (entry.startDate !== rental.startDate || entry.endDate !== rental.plannedReturnDate) return false;
      return safelyMatchesResolvedEquipment(entry);
    });
  }, [ganttRentals, rental, safelyMatchesResolvedEquipment]);

  const linkedGanttRental = linkedGanttCandidates.length === 1 ? linkedGanttCandidates[0] : null;
  const canRestoreThisRental = canRestoreRentals && (
    rental.status === 'closed' ||
    !!rental.actualReturnDate ||
    linkedGanttRental?.status === 'returned' ||
    linkedGanttRental?.status === 'closed'
  );

  const financeTimeline = useMemo(() => {
    if (!linkedGanttRental) return [];

    const invoiceDocs = relatedInvoices.map(invoice => {
      const invoicePayments = paymentsByInvoice.get(invoice.number) ?? [];
      const invoicePaid = invoicePayments.reduce((sum, payment) => sum + (payment.paidAmount ?? (payment.status === 'paid' ? payment.amount : 0)), 0);
      return {
        key: `invoice-${invoice.id}`,
        label: invoice.number,
        date: invoice.date,
        documentStatus: invoice.status,
        documentAmount: invoice.amount ?? 0,
        dueDate: invoicePayments[0]?.dueDate || linkedGanttRental.expectedPaymentDate || linkedGanttRental.endDate,
        paidAmount: invoicePaid,
        payments: invoicePayments,
      };
    });

    const orphanPayments = relatedPayments
      .filter(payment => !relatedInvoices.some(invoice => invoice.number === payment.invoiceNumber))
      .map(payment => ({
        key: `payment-${payment.id}`,
        label: payment.invoiceNumber || `Платёж ${payment.id}`,
        date: payment.dueDate,
        documentStatus: 'sent' as const,
        documentAmount: payment.amount,
        dueDate: payment.dueDate,
        paidAmount: payment.paidAmount ?? (payment.status === 'paid' ? payment.amount : 0),
        payments: [payment],
      }));

    const rows = [...invoiceDocs, ...orphanPayments];
    if (rows.length > 0) return rows;

    return [{
      key: `rental-${linkedGanttRental.id}`,
      label: linkedGanttRental.id,
      date: linkedGanttRental.startDate,
      documentStatus: 'draft' as const,
      documentAmount: linkedGanttRental.amount ?? rental.price ?? 0,
      dueDate: linkedGanttRental.expectedPaymentDate || linkedGanttRental.endDate,
      paidAmount,
      payments: relatedPayments,
    }];
  }, [linkedGanttRental, paidAmount, paymentsByInvoice, relatedInvoices, relatedPayments, rental.price]);

  const conflictingRental = useMemo(() => {
    if (!isEditing || !formState) return null;
    const newStart = new Date(formState.startDate).getTime();
    const newEnd = new Date(formState.plannedReturnDate).getTime();
    if (Number.isNaN(newStart) || Number.isNaN(newEnd) || newStart > newEnd) return null;

    return ganttRentals.find(entry => {
      if (linkedGanttRental && entry.id === linkedGanttRental.id) return false;
      if (entry.status === 'returned' || entry.status === 'closed') return false;
      const matchesEquipment = safelyMatchesResolvedEquipment(entry);
      if (!matchesEquipment) return false;
      const entryStart = new Date(entry.startDate).getTime();
      const entryEnd = new Date(entry.endDate).getTime();
      return newStart <= entryEnd && newEnd >= entryStart;
    }) || null;
  }, [formState.plannedReturnDate, formState.startDate, ganttRentals, isEditing, linkedGanttRental, safelyMatchesResolvedEquipment]);

  const updateField = (field: keyof RentalFormState, value: string) => {
    setFormState(prev => prev ? { ...prev, [field]: value } : prev);
    setSaveError('');
    setSaveInfo('');
  };

  const handleCancelEdit = () => {
    if (!rental) return;
    setFormState(buildInitialFormState(rental));
    setIsEditing(false);
    setSaveError('');
    setSaveInfo('');
  };

  const handleSave = async () => {
    if (!canEditRentals) {
      setSaveError('Редактировать аренду может только администратор.');
      return;
    }
    if (!rental || !formState) return;
    if (!formState.client.trim()) {
      setSaveError('Укажите клиента.');
      return;
    }
    if (!formState.startDate || !formState.plannedReturnDate) {
      setSaveError('Укажите дату начала и окончания аренды.');
      return;
    }
    if (!canEditRentalDates && (
      formState.startDate !== rental.startDate
      || formState.plannedReturnDate !== rental.plannedReturnDate
      || (formState.actualReturnDate || '') !== (rental.actualReturnDate || '')
    )) {
      setSaveError('Изменять даты аренды может только администратор.');
      return;
    }
    if (new Date(formState.startDate).getTime() > new Date(formState.plannedReturnDate).getTime()) {
      setSaveError('Дата окончания не может быть раньше даты начала.');
      return;
    }
    if (!Number.isFinite(priceValue) || priceValue < 0) {
      setSaveError('Стоимость аренды должна быть числом не меньше 0.');
      return;
    }
    if (!Number.isFinite(discountValue) || discountValue < 0) {
      setSaveError('Скидка должна быть числом не меньше 0.');
      return;
    }
    if (conflictingRental) {
      setSaveError(`Конфликт по технике: ${conflictingRental.client} · ${conflictingRental.startDate} — ${conflictingRental.endDate}`);
      return;
    }

    setIsSaving(true);
    setSaveError('');
    setSaveInfo('');
    try {
      await rentalsService.update(rental.id, {
        client: formState.client.trim(),
        contact: formState.contact.trim(),
        startDate: formState.startDate,
        plannedReturnDate: formState.plannedReturnDate,
        actualReturnDate: formState.actualReturnDate || undefined,
        rate: formState.rate.trim(),
        price: priceValue,
        discount: discountValue,
        deliveryAddress: formState.deliveryAddress.trim(),
        manager: formState.manager.trim(),
        status: formState.status,
        comments: formState.comments.trim(),
      });

      if (linkedGanttRental) {
        const nextGanttStatus: GanttRentalData['status'] = formState.status === 'closed'
          ? 'closed'
          : formState.status === 'active'
            ? 'active'
            : 'created';
        const nextGanttRental: GanttRentalData = {
          ...linkedGanttRental,
          client: formState.client.trim(),
          clientShort: formState.client.trim().substring(0, 20),
          startDate: formState.startDate,
          endDate: formState.plannedReturnDate,
          manager: formState.manager.trim(),
          managerInitials: managerInitials(formState.manager),
          status: nextGanttStatus,
          amount: priceValue,
        };
        await rentalsService.updateGanttEntry(linkedGanttRental.id, {
          ...appendRentalHistory(
            nextGanttRental,
            ...buildRentalUpdateHistory(linkedGanttRental, nextGanttRental, historyAuthor),
          ),
        });
        setSaveInfo('Изменения сохранены и синхронизированы с планировщиком.');
      } else if (linkedGanttCandidates.length > 1) {
        setSaveInfo('Карточка аренды сохранена, но запись в планировщике не обновлена автоматически: найдено несколько похожих аренд.');
      } else {
        setSaveInfo('Карточка аренды сохранена. Связанная запись в планировщике не найдена.');
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.detail(rental.id) }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
      ]);
      setIsEditing(false);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Не удалось сохранить аренду.');
    } finally {
      setIsSaving(false);
    }
  };

  useEffect(() => {
    if (!rental) return;
    const existingCount = documents.filter(doc => doc.rental === rental.id).length;
    setDocumentForm({
      type: 'invoice',
      number: nextDocumentNumber('invoice', rental.id, existingCount),
      date: new Date().toISOString().slice(0, 10),
      amount: String(rental.price || 0),
      status: 'draft',
    });
    const lastInvoiceNumber = documents
      .filter(doc => doc.rental === rental.id && doc.type === 'invoice')
      .sort((a, b) => b.date.localeCompare(a.date))[0]?.number || `INV-${rental.id}`;
    const suggestedAmount = Math.max((rental.price || 0) - paidAmount, 0);
    setPaymentForm({
      invoiceNumber: lastInvoiceNumber,
      amount: String(suggestedAmount),
      paidAmount: String(suggestedAmount),
      dueDate: linkedGanttRental?.expectedPaymentDate || rental.plannedReturnDate,
      paidDate: new Date().toISOString().slice(0, 10),
      status: 'pending',
      comment: '',
    });
  }, [documents, linkedGanttRental?.expectedPaymentDate, paidAmount, rental]);

  const syncPaymentStatus = React.useCallback(async (nextPayments: typeof relatedPayments) => {
    if (!linkedGanttRental) return;
    const totalPaidForRental = nextPayments.reduce((sum, payment) => {
      return sum + (payment.paidAmount ?? (payment.status === 'paid' ? payment.amount : 0));
    }, 0);
    let paymentStatus: GanttRentalData['paymentStatus'] = 'unpaid';
    if (totalPaidForRental >= (linkedGanttRental.amount || rental.price || 0)) paymentStatus = 'paid';
    else if (totalPaidForRental > 0) paymentStatus = 'partial';
    await rentalsService.updateGanttEntry(linkedGanttRental.id, {
      ...appendRentalHistory(
        { ...linkedGanttRental, paymentStatus },
        createRentalHistoryEntry(historyAuthor, `Статус оплаты обновлён автоматически: ${paymentStatus === 'paid' ? 'Оплачено' : paymentStatus === 'partial' ? 'Частично' : 'Не оплачено'}`),
      ),
    });
  }, [historyAuthor, linkedGanttRental, rental.price, relatedPayments]);

  const handleCreateDocument = async () => {
    if (!rental || !canCreateDocuments) return;
    const amount = Number(documentForm.amount);
    if (!documentForm.number.trim()) {
      setSaveError('Укажите номер документа.');
      return;
    }
    if (Number.isNaN(amount) || amount < 0) {
      setSaveError('Сумма документа должна быть числом не меньше 0.');
      return;
    }
    setIsSubmittingDocument(true);
    setSaveError('');
    try {
      await documentsService.create({
        type: documentForm.type,
        number: documentForm.number.trim(),
        client: rental.client,
        date: documentForm.date,
        amount,
        status: documentForm.status,
        rental: rental.id,
      });
      await queryClient.invalidateQueries({ queryKey: ['documents'] });
      setDocumentDialogOpen(false);
      setSaveInfo(`${documentForm.type === 'invoice' ? 'Счёт' : documentForm.type === 'act' ? 'Акт' : 'Договор'} создан и привязан к аренде.`);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Не удалось создать документ.');
    } finally {
      setIsSubmittingDocument(false);
    }
  };

  const handleCreatePayment = async () => {
    if (!rental || !canCreatePayments) return;
    const amount = Number(paymentForm.amount);
    const paidAmount = Number(paymentForm.paidAmount);
    if (!paymentForm.invoiceNumber.trim()) {
      setSaveError('Укажите номер счёта для платежа.');
      return;
    }
    if (Number.isNaN(amount) || amount <= 0) {
      setSaveError('Сумма платежа должна быть больше 0.');
      return;
    }
    if (Number.isNaN(paidAmount) || paidAmount < 0) {
      setSaveError('Оплаченная сумма должна быть числом не меньше 0.');
      return;
    }
    setIsSubmittingPayment(true);
    setSaveError('');
    try {
      const nextStatus: PaymentStatus = paymentForm.status === 'pending'
        ? (paidAmount > 0 ? (paidAmount >= amount ? 'paid' : 'partial') : 'pending')
        : paymentForm.status;
      const created = await paymentsService.create({
        invoiceNumber: paymentForm.invoiceNumber.trim(),
        rentalId: rental.id,
        client: rental.client,
        amount,
        paidAmount: nextStatus === 'paid' || nextStatus === 'partial' ? paidAmount : undefined,
        dueDate: paymentForm.dueDate,
        paidDate: nextStatus === 'paid' || nextStatus === 'partial' ? paymentForm.paidDate || undefined : undefined,
        status: nextStatus,
        comment: paymentForm.comment.trim() || undefined,
      });
      await syncPaymentStatus([...relatedPayments, created]);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
      ]);
      setPaymentDialogOpen(false);
      setSaveInfo('Платёж зарегистрирован и привязан к аренде.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Не удалось зарегистрировать платёж.');
    } finally {
      setIsSubmittingPayment(false);
    }
  };

  const handleRestoreRental = async () => {
    if (!rental || !canRestoreThisRental || !resolvedRentalEquipment[0]) return;
    setIsRestoring(true);
    setSaveError('');
    setSaveInfo('');
    try {
      await rentalsService.update(rental.id, {
        status: 'active',
        actualReturnDate: undefined,
      });
      if (linkedGanttRental) {
        const restoredGantt: GanttRentalData = {
          ...linkedGanttRental,
          status: 'active',
        };
        await rentalsService.updateGanttEntry(linkedGanttRental.id, appendRentalHistory(
          restoredGantt,
          createRentalHistoryEntry(historyAuthor, 'Аренда восстановлена из карточки аренды'),
        ));
      }
      const eq = resolvedRentalEquipment[0];
      await equipmentService.update(eq.id, appendAuditHistory(
        {
          ...eq,
          status: 'rented',
          currentClient: rental.client,
          returnDate: rental.plannedReturnDate,
        },
        createAuditEntry(historyAuthor, `Аренда ${rental.id} восстановлена из карточки аренды`),
      ));
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.detail(rental.id) }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
        queryClient.invalidateQueries({ queryKey: ['documents'] }),
        queryClient.invalidateQueries({ queryKey: ['payments'] }),
        queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
      ]);
      setSaveInfo('Аренда восстановлена. Техника снова возвращена в активную аренду.');
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : 'Не удалось восстановить аренду.');
    } finally {
      setIsRestoring(false);
    }
  };

  const displayPlannedReturn = isEditing ? (formState?.plannedReturnDate || '') : (rental?.plannedReturnDate || '');
  const displayManager = isEditing ? (formState?.manager || '') : (rental?.manager || '');

  if (!rental || !formState) {
    return (
      <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
        <div className="text-center py-12">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Аренда не найдена</h2>
          <p className="mt-2 text-sm text-gray-500 dark:text-gray-400">Договор с ID «{id}» не существует</p>
          <Button className="mt-4" onClick={() => navigate('/rentals')}>
            Вернуться к списку
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold sm:text-3xl text-gray-900 dark:text-white">{rental.id}</h1>
              {getRentalStatusBadge(isEditing ? formState.status : rental.status)}
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{isEditing ? formState.client : rental.client}</p>
          </div>
        </div>
        <div className="flex gap-3">
          {isEditing ? (
            <>
              <Button variant="secondary" onClick={handleCancelEdit}>
                <X className="h-4 w-4" />
                Отмена
              </Button>
              <Button onClick={handleSave} disabled={isSaving}>
                <Save className="h-4 w-4" />
                {isSaving ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </>
          ) : canEditRentals ? (
            <Button variant="secondary" onClick={() => setIsEditing(true)}>
              <Edit className="h-4 w-4" />
              Редактировать
            </Button>
          ) : null}
          {canRestoreThisRental && (
            <Button variant="secondary" onClick={() => void handleRestoreRental()} disabled={isRestoring}>
              <RefreshCw className={`h-4 w-4 ${isRestoring ? 'animate-spin' : ''}`} />
              {isRestoring ? 'Восстановление...' : 'Восстановить аренду'}
            </Button>
          )}
          <Button variant="secondary" onClick={() => navigate('/documents')}>
            <FileText className="h-4 w-4" />
            Документы
          </Button>
        </div>
      </div>

      {(saveError || saveInfo || (isEditing && conflictingRental)) && (
        <div className={`rounded-lg border p-4 text-sm ${
          saveError || conflictingRental
            ? 'border-red-200 bg-red-50 text-red-700 dark:border-red-800 dark:bg-red-900/20 dark:text-red-300'
            : 'border-blue-200 bg-blue-50 text-blue-700 dark:border-blue-800 dark:bg-blue-900/20 dark:text-blue-300'
        }`}>
          {saveError || (conflictingRental
            ? `Есть пересечение по технике: ${conflictingRental.client} · ${conflictingRental.startDate} — ${conflictingRental.endDate}`
            : saveInfo)}
        </div>
      )}

      {rental.risk && (
        <div className="flex items-center gap-3 rounded-lg border border-red-200 bg-red-50 p-4 dark:border-red-800 dark:bg-red-900/20">
          <AlertTriangle className="h-5 w-5 text-red-600" />
          <div>
            <p className="font-medium text-red-900 dark:text-red-200">Внимание</p>
            <p className="text-sm text-red-700 dark:text-red-300">{rental.risk}</p>
          </div>
        </div>
      )}

      <div className="grid gap-4 sm:gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-[--color-primary]" />
                Клиент
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Компания</p>
                  {isEditing ? (
                    <Select value={formState.client} onValueChange={(value) => updateField('client', value)}>
                      <SelectTrigger className="mt-1">
                        <SelectValue placeholder="Выберите клиента" />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map(clientItem => (
                          <SelectItem key={clientItem.id} value={clientItem.company}>{clientItem.company}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  ) : (
                    <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{rental.client}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Контактное лицо</p>
                  {isEditing ? (
                    <Input className="mt-1" value={formState.contact} onChange={(e) => updateField('contact', e.target.value)} />
                  ) : (
                    <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{rental.contact}</p>
                  )}
                </div>
              </div>
              {selectedClient && (
                <div className="grid grid-cols-2 gap-4 border-t border-gray-200 pt-3 dark:border-gray-700">
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">ИНН</p>
                    <p className="mt-0.5 font-mono text-sm text-gray-900 dark:text-white">{selectedClient.inn}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Условия оплаты</p>
                    <p className="mt-0.5 text-sm text-gray-900 dark:text-white">{selectedClient.paymentTerms}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Телефон</p>
                    <p className="mt-0.5 text-sm text-gray-900 dark:text-white">{selectedClient.phone}</p>
                  </div>
                  <div>
                    <p className="text-sm text-gray-500 dark:text-gray-400">Email</p>
                    <p className="mt-0.5 text-sm text-gray-900 dark:text-white">{selectedClient.email}</p>
                  </div>
                </div>
              )}
              {selectedClient && (
                <div className="pt-1">
                  <Link to={`/clients/${selectedClient.id}`} className="text-sm text-[--color-primary] hover:underline">
                    Перейти к карточке клиента →
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Truck className="h-5 w-5 text-[--color-primary]" />
                Техника в аренде
              </CardTitle>
              {linkedGanttCandidates.length > 1 && (
                <CardDescription>Для этой аренды найдено несколько похожих записей в планировщике</CardDescription>
              )}
            </CardHeader>
            <CardContent>
              {resolvedRentalEquipment.length > 0 ? (
                <div className="space-y-3">
                  {resolvedRentalEquipment.map(eq => (
                    <Link
                      key={eq.id}
                      to={`/equipment/${eq.id}`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 p-3 transition-colors hover:border-[--color-primary] hover:bg-gray-50 dark:border-gray-700 dark:hover:border-blue-500 dark:hover:bg-gray-700/50"
                    >
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">
                          {eq.inventoryNumber} — {eq.model}
                        </p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">
                          Серийный: {eq.serialNumber} · {eq.location}
                        </p>
                      </div>
                      <Badge variant={eq.status === 'rented' ? 'info' : eq.status === 'available' ? 'success' : 'default'}>
                        {eq.status === 'rented' ? 'В аренде' : eq.status === 'available' ? 'Свободна' : eq.status}
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <div className="space-y-2">
                  {rental.equipment.map(inv => (
                    <div key={inv} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <p className="font-medium text-gray-900 dark:text-white">{inv}</p>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Calendar className="h-5 w-5 text-[--color-primary]" />
                Даты аренды
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Дата начала</p>
                  {isEditing ? (
                    <Input className="mt-1" type="date" value={formState.startDate} disabled={!canEditRentalDates} onChange={(e) => updateField('startDate', e.target.value)} />
                  ) : (
                    <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{formatDate(rental.startDate)}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Плановый возврат</p>
                  {isEditing ? (
                    <Input className="mt-1" type="date" value={formState.plannedReturnDate} disabled={!canEditRentalDates} onChange={(e) => updateField('plannedReturnDate', e.target.value)} />
                  ) : (
                    <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{formatDate(rental.plannedReturnDate)}</p>
                  )}
                </div>
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Длительность</p>
                  <p className="mt-0.5 font-medium text-gray-900 dark:text-white">{isEditing ? editingDays : rentalDays} дней</p>
                </div>
              </div>
              {(rental.actualReturnDate || isEditing) && (
                <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Фактическая дата возврата</p>
                  {isEditing ? (
                    <Input className="mt-1" type="date" value={formState.actualReturnDate} disabled={!canEditRentalDates} onChange={(e) => updateField('actualReturnDate', e.target.value)} />
                  ) : (
                    <p className="mt-0.5 font-medium text-green-600">{formatDate(rental.actualReturnDate)}</p>
                  )}
                </div>
              )}
              {(isEditing ? formState.status : rental.status) === 'active' && (
                <div className="mt-3 border-t border-gray-200 pt-3 dark:border-gray-700">
                  <p className="text-sm text-gray-500 dark:text-gray-400">До возврата</p>
                  <p className={`mt-0.5 font-medium ${getDaysUntil(displayPlannedReturn) < 0 ? 'text-red-600' : getDaysUntil(displayPlannedReturn) <= 3 ? 'text-yellow-600' : 'text-gray-900 dark:text-white'}`}>
                    {getDaysUntil(displayPlannedReturn) < 0
                      ? `Просрочен на ${Math.abs(getDaysUntil(displayPlannedReturn))} дн.`
                      : `${getDaysUntil(displayPlannedReturn)} дн.`}
                  </p>
                </div>
              )}
              {isEditing && !canEditRentalDates && (
                <p className="mt-3 text-xs text-amber-600 dark:text-amber-400">
                  Изменять даты аренды может только администратор.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <MessageSquare className="h-5 w-5 text-[--color-primary]" />
                Комментарии
              </CardTitle>
              <CardDescription>{comments.length} записей</CardDescription>
            </CardHeader>
            <CardContent>
              {isEditing ? (
                <div>
                  <p className="text-sm text-gray-500 dark:text-gray-400">Комментарий по аренде</p>
                  <Textarea className="mt-1 min-h-28" value={formState.comments} onChange={(e) => updateField('comments', e.target.value)} />
                </div>
              ) : comments.length > 0 ? (
                <div className="space-y-3">
                  {comments.map((comment, idx) => (
                    <div key={idx} className="rounded-lg border border-gray-200 bg-gray-50 p-3 dark:border-gray-700 dark:bg-gray-900/50">
                      <div className="flex items-center justify-between text-xs text-gray-500 dark:text-gray-400">
                        <span className="font-medium">{comment.author}</span>
                      <span>{formatDateTime(comment.date)}</span>
                      </div>
                      <p className="mt-1.5 text-sm text-gray-700 dark:text-gray-300">{comment.text}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Нет комментариев</p>
              )}
            </CardContent>
          </Card>

          {relatedService.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Wrench className="h-5 w-5 text-orange-500" />
                  Связанные сервисные заявки
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {relatedService.map(ticket => (
                    <Link
                      key={ticket.id}
                      to={`/service/${ticket.id}`}
                      className="flex items-center justify-between rounded-lg border border-gray-200 p-3 transition-colors hover:border-orange-300 hover:bg-orange-50/50 dark:border-gray-700 dark:hover:border-orange-600 dark:hover:bg-orange-900/10"
                    >
                      <div>
                        <p className="font-medium text-gray-900 dark:text-white">{ticket.id} — {ticket.reason}</p>
                        <p className="text-sm text-gray-500 dark:text-gray-400">{ticket.equipment}</p>
                      </div>
                      <Badge variant={
                        ticket.status === 'in_progress' ? 'info' :
                        ticket.status === 'waiting_parts' ? 'warning' :
                        ticket.status === 'new' ? 'default' : 'success'
                      }>
                        {ticket.status === 'in_progress' ? 'В работе' :
                         ticket.status === 'waiting_parts' ? 'Ожидание' :
                         ticket.status === 'new' ? 'Новая' : 'Готово'}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </div>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <DollarSign className="h-5 w-5 text-[--color-primary]" />
                Финансы
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-sm text-gray-500 dark:text-gray-400">Стоимость аренды</p>
                {isEditing ? (
                  <div className="mt-1 grid grid-cols-1 gap-3">
                    <Input value={formState.price} onChange={(e) => updateField('price', e.target.value)} type="number" min="0" />
                    <Input value={formState.rate} onChange={(e) => updateField('rate', e.target.value)} placeholder="Например: 5000 ₽/день" />
                  </div>
                ) : (
                  <>
                    <p className="mt-0.5 text-2xl font-bold text-gray-900 dark:text-white">{formatCurrency(rental.price)}</p>
                    <p className="text-xs text-gray-500 dark:text-gray-400">{rental.rate} · {rentalDays} дн.</p>
                  </>
                )}
              </div>

              {(rental.discount > 0 || isEditing) && (
                <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                  {isEditing ? (
                    <div>
                      <p className="text-sm text-gray-500 dark:text-gray-400">Скидка</p>
                      <Input className="mt-1" value={formState.discount} onChange={(e) => updateField('discount', e.target.value)} type="number" min="0" />
                    </div>
                  ) : (
                    <div className="flex justify-between text-sm">
                      <span className="text-gray-500 dark:text-gray-400">Скидка</span>
                      <span className="text-green-600">−{formatCurrency(rental.discount)}</span>
                    </div>
                  )}
                </div>
              )}

              <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Итого к оплате</span>
                    <span className="font-medium text-gray-900 dark:text-white">{formatCurrency(nextTotal - nextDiscount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Оплачено</span>
                    <span className="font-medium text-green-600">{formatCurrency(paidAmount)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-gray-500 dark:text-gray-400">Остаток к оплате</span>
                    <span className={`font-medium ${nextRemainingBalance > 0 ? 'text-orange-600' : 'text-gray-900 dark:text-white'}`}>
                      {formatCurrency(Math.max(nextRemainingBalance, 0))}
                    </span>
                  </div>
                </div>
              </div>

              {remainingBalance > 0 && !isEditing && (
                <div className="border-t border-gray-200 pt-3 dark:border-gray-700">
                  <div className="flex justify-between text-sm">
                    <span className="font-medium text-red-600">Дебиторка</span>
                    <span className="font-medium text-red-600">{formatCurrency(remainingBalance)}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Быстрые действия</CardTitle>
              <CardDescription>Счёт, акт, договор и регистрация оплаты без ухода с карточки аренды</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Button
                  variant="secondary"
                  disabled={!canCreateDocuments}
                  onClick={() => {
                    setDocumentForm(prev => ({
                      ...prev,
                      type: 'invoice',
                      number: nextDocumentNumber('invoice', rental.id, relatedDocs.length),
                      amount: String(Math.max(remainingBalance, 0)),
                    }));
                    setDocumentDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Новый счёт
                </Button>
                <Button
                  variant="secondary"
                  disabled={!canCreateDocuments}
                  onClick={() => {
                    setDocumentForm(prev => ({
                      ...prev,
                      type: 'act',
                      number: nextDocumentNumber('act', rental.id, relatedDocs.length),
                      amount: String(rental.price || 0),
                    }));
                    setDocumentDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Новый акт
                </Button>
                <Button
                  variant="secondary"
                  disabled={!canCreateDocuments}
                  onClick={() => {
                    setDocumentForm(prev => ({
                      ...prev,
                      type: 'contract',
                      number: nextDocumentNumber('contract', rental.id, relatedDocs.length),
                      amount: String(rental.price || 0),
                    }));
                    setDocumentDialogOpen(true);
                  }}
                >
                  <Plus className="h-4 w-4" />
                  Новый договор
                </Button>
                <Button
                  variant="secondary"
                  disabled={!canCreatePayments}
                  onClick={() => setPaymentDialogOpen(true)}
                >
                  <DollarSign className="h-4 w-4" />
                  Зарегистрировать оплату
                </Button>
              </div>
              {(!canCreateDocuments || !canCreatePayments) && (
                <p className="text-xs text-gray-500 dark:text-gray-400">
                  Доступ к финансовым действиям зависит от вашей роли.
                </p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-[--color-primary]" />
                Счёт и оплата
              </CardTitle>
              <CardDescription>
                Связка аренды, счёта и фактических платежей в одной карточке
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {financeTimeline.length > 0 ? (
                financeTimeline.map(item => {
                  const outstanding = Math.max(0, (item.documentAmount || 0) - item.paidAmount);
                  const overdue = item.dueDate ? item.dueDate < new Date().toISOString().slice(0, 10) && outstanding > 0 : false;
                  return (
                    <div key={item.key} className="rounded-lg border border-gray-200 p-3 dark:border-gray-700">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-gray-900 dark:text-white">{item.label}</p>
                          <p className="text-xs text-gray-500 dark:text-gray-400">
                            {formatDate(item.date)}{item.dueDate ? ` · ожидаемая оплата ${formatDate(item.dueDate)}` : ''}
                          </p>
                        </div>
                        <Badge variant={
                          outstanding <= 0
                            ? 'success'
                            : overdue
                              ? 'error'
                              : item.paidAmount > 0
                                ? 'warning'
                                : 'default'
                        }>
                          {outstanding <= 0 ? 'Оплачено' : overdue ? 'Просрочено' : item.paidAmount > 0 ? 'Частично' : 'Ожидает оплаты'}
                        </Badge>
                      </div>

                      <div className="mt-3 grid grid-cols-3 gap-3 text-sm">
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Сумма счёта</p>
                          <p className="font-medium text-gray-900 dark:text-white">{formatCurrency(item.documentAmount || 0)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Оплачено</p>
                          <p className="font-medium text-green-600">{formatCurrency(item.paidAmount)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-500 dark:text-gray-400">Остаток</p>
                          <p className={`font-medium ${outstanding > 0 ? 'text-orange-600' : 'text-gray-900 dark:text-white'}`}>
                            {formatCurrency(outstanding)}
                          </p>
                        </div>
                      </div>

                      {item.payments.length > 0 ? (
                        <div className="mt-3 space-y-2">
                          {item.payments.map(payment => (
                            <div key={payment.id} className="rounded-md bg-gray-50 px-3 py-2 text-sm dark:bg-gray-900/40">
                              <div className="flex items-center justify-between gap-3">
                                <span className="text-gray-700 dark:text-gray-300">
                                  {payment.paidDate ? `Оплата ${formatDate(payment.paidDate)}` : `Платёж со сроком ${formatDate(payment.dueDate)}`}
                                </span>
                                <span className="font-medium text-gray-900 dark:text-white">
                                  {formatCurrency(payment.paidAmount ?? payment.amount)}
                                </span>
                              </div>
                              {payment.comment && (
                                <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{payment.comment}</p>
                              )}
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="mt-3 text-xs text-gray-500 dark:text-gray-400">
                          Платежи по этому счёту ещё не зарегистрированы.
                        </p>
                      )}
                    </div>
                  );
                })
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Нет связанных счетов и оплат</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <User className="h-5 w-5 text-[--color-primary]" />
                Менеджер и статус
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-100 text-sm text-blue-700 dark:bg-blue-900/30 dark:text-blue-300">
                  {managerInitials(displayManager)}
                </div>
                <div className="flex-1">
                  {isEditing ? (
                    <div className="space-y-2">
                      <Input value={formState.manager} onChange={(e) => updateField('manager', e.target.value)} placeholder="Ответственный менеджер" />
                      <Select value={formState.status} onValueChange={(value) => updateField('status', value)}>
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(statusLabels).map(([value, label]) => (
                            <SelectItem key={value} value={value}>{label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <>
                      <p className="font-medium text-gray-900 dark:text-white">{rental.manager}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">Ответственный менеджер</p>
                    </>
                  )}
                </div>
              </div>
              {isEditing && (
                <div className="mt-4">
                  <p className="text-sm text-gray-500 dark:text-gray-400">Адрес доставки</p>
                  <Input className="mt-1" value={formState.deliveryAddress} onChange={(e) => updateField('deliveryAddress', e.target.value)} />
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-[--color-primary]" />
                Документы
              </CardTitle>
            </CardHeader>
            <CardContent>
              {relatedDocs.length > 0 ? (
                <div className="space-y-2">
                  {relatedDocs.map(doc => (
                    <div key={doc.id} className="flex items-center justify-between rounded-lg border border-gray-200 p-2.5 dark:border-gray-700">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-gray-900 dark:text-white">{doc.number}</p>
                        <p className="text-xs text-gray-500 dark:text-gray-400">
                          {doc.type === 'contract' ? 'Договор' : doc.type === 'act' ? 'Акт' : 'Счёт'} · {formatDate(doc.date)}
                        </p>
                      </div>
                      <Badge variant={doc.status === 'signed' ? 'success' : doc.status === 'sent' ? 'info' : 'default'}>
                        {doc.status === 'signed' ? 'Подписан' : doc.status === 'sent' ? 'Отправлен' : 'Черновик'}
                      </Badge>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Нет документов</p>
              )}
              {rental.documents && rental.documents.length > 0 && relatedDocs.length === 0 && (
                <div className="space-y-1.5">
                  {rental.documents.map((doc, idx) => (
                    <div key={idx} className="flex items-center gap-2 text-sm text-gray-700 dark:text-gray-300">
                      <CircleCheck className="h-4 w-4 text-green-500" />
                      {doc}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Clock className="h-5 w-5 text-[--color-primary]" />
                История
              </CardTitle>
            </CardHeader>
            <CardContent>
              {history.length > 0 ? (
                <div className="relative space-y-3 pl-4">
                  <div className="absolute left-1.5 top-1 bottom-1 w-px bg-gray-200 dark:bg-gray-700" />
                  {history.map((item, idx) => (
                    <div key={idx} className="relative">
                      <div className="absolute -left-[11px] top-1.5 h-2 w-2 rounded-full bg-[--color-primary]" />
                      <p className="text-sm text-gray-900 dark:text-white">{item.action}</p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">{formatDateTime(item.date)} · {item.user}</p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-400 dark:text-gray-500">Нет записей</p>
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <Dialog open={documentDialogOpen} onOpenChange={setDocumentDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Создать документ по аренде</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Тип</p>
                <Select
                  value={documentForm.type}
                  onValueChange={(value) => setDocumentForm(prev => ({
                    ...prev,
                    type: value as DocumentType,
                    number: nextDocumentNumber(value as DocumentType, rental.id, relatedDocs.length),
                  }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="invoice">Счёт</SelectItem>
                    <SelectItem value="act">Акт</SelectItem>
                    <SelectItem value="contract">Договор</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div>
                <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Статус</p>
                <Select
                  value={documentForm.status}
                  onValueChange={(value) => setDocumentForm(prev => ({ ...prev, status: value as 'draft' | 'sent' | 'signed' }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="draft">Черновик</SelectItem>
                    <SelectItem value="sent">Отправлен</SelectItem>
                    <SelectItem value="signed">Подписан</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div>
              <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Номер документа</p>
              <Input
                value={documentForm.number}
                onChange={(e) => setDocumentForm(prev => ({ ...prev, number: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Дата</p>
                <Input
                  type="date"
                  value={documentForm.date}
                  onChange={(e) => setDocumentForm(prev => ({ ...prev, date: e.target.value }))}
                />
              </div>
              <div>
                <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Сумма</p>
                <Input
                  type="number"
                  min="0"
                  value={documentForm.amount}
                  onChange={(e) => setDocumentForm(prev => ({ ...prev, amount: e.target.value }))}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setDocumentDialogOpen(false)}>Отмена</Button>
            <Button onClick={() => void handleCreateDocument()} disabled={isSubmittingDocument}>
              {isSubmittingDocument ? 'Создание...' : 'Создать документ'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent className="sm:max-w-[520px]">
          <DialogHeader>
            <DialogTitle>Зарегистрировать оплату</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Номер счёта</p>
              <Input
                value={paymentForm.invoiceNumber}
                onChange={(e) => setPaymentForm(prev => ({ ...prev, invoiceNumber: e.target.value }))}
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Сумма счёта</p>
                <Input
                  type="number"
                  min="0"
                  value={paymentForm.amount}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, amount: e.target.value }))}
                />
              </div>
              <div>
                <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Оплачено</p>
                <Input
                  type="number"
                  min="0"
                  value={paymentForm.paidAmount}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, paidAmount: e.target.value }))}
                />
              </div>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <div>
                <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Срок оплаты</p>
                <Input
                  type="date"
                  value={paymentForm.dueDate}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, dueDate: e.target.value }))}
                />
              </div>
              <div>
                <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Дата оплаты</p>
                <Input
                  type="date"
                  value={paymentForm.paidDate}
                  onChange={(e) => setPaymentForm(prev => ({ ...prev, paidDate: e.target.value }))}
                />
              </div>
              <div>
                <p className="mb-1 text-sm text-gray-500 dark:text-gray-400">Статус</p>
                <Select
                  value={paymentForm.status}
                  onValueChange={(value) => setPaymentForm(prev => ({ ...prev, status: value as PaymentStatus }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pending">Ожидает</SelectItem>
                    <SelectItem value="paid">Оплачено</SelectItem>
                    <SelectItem value="partial">Частично</SelectItem>
                    <SelectItem value="overdue">Просрочено</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <Textarea
              value={paymentForm.comment}
              onChange={(e) => setPaymentForm(prev => ({ ...prev, comment: e.target.value }))}
              placeholder="Комментарий к оплате"
            />
          </div>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setPaymentDialogOpen(false)}>Отмена</Button>
            <Button onClick={() => void handleCreatePayment()} disabled={isSubmittingPayment}>
              {isSubmittingPayment ? 'Сохранение...' : 'Сохранить платёж'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
