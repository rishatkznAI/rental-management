import React, { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useNavigate, useParams } from 'react-router';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import {
  ArrowLeft, Wrench, User, Clock, MapPin, Tag, FileText,
  CheckCircle, XCircle, AlertTriangle, Play, Package, History,
  Camera, Upload, Trash2, X, Plus,
} from 'lucide-react';
import { formatDate } from '../lib/utils';
import { EQUIPMENT_KEYS } from '../hooks/useEquipment';
import { RENTAL_KEYS } from '../hooks/useRentals';
import { SERVICE_TICKET_KEYS, useServiceTicketById, useUpdateServiceTicket } from '../hooks/useServiceTickets';
import type {
  Equipment,
  EquipmentStatus,
  Mechanic,
  ServicePartUsage,
  ServiceRepairResult,
  ServiceTicket,
  ServiceStatus,
  ServiceWorkCatalogItem,
  ServiceWorkPerformed,
  SparePartCatalogItem,
} from '../types';
import { equipmentService } from '../services/equipment.service';
import { mechanicsService } from '../services/mechanics.service';
import { rentalsService } from '../services/rentals.service';
import { serviceWorkCatalogService } from '../services/service-work-catalog.service';
import { serviceTicketsService } from '../services/service-tickets.service';
import { sparePartsCatalogService } from '../services/spare-parts-catalog.service';
import { getEquipmentTypeLabel } from '../lib/equipmentClassification';

// ─── helpers ──────────────────────────────────────────────────────────────────

const STATUS_LABELS: Record<ServiceStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  waiting_parts: 'Ожидание запчастей',
  ready: 'Готово',
  closed: 'Закрыто',
};

const PRIORITY_LABELS: Record<string, string> = {
  low: 'Низкий',
  medium: 'Средний',
  high: 'Высокий',
  critical: 'Критический',
};

const SOURCE_LABELS: Record<string, string> = {
  manual: 'Вручную',
  bot: 'Бот',
  manager: 'Менеджер',
  system: 'Система',
};

type BadgeVariant = 'success' | 'warning' | 'error' | 'info' | 'default';

function statusVariant(s: ServiceStatus): BadgeVariant {
  return ({ new: 'default', in_progress: 'info', waiting_parts: 'warning', ready: 'success', closed: 'default' } as Record<ServiceStatus, BadgeVariant>)[s] ?? 'default';
}
function priorityVariant(p: string): BadgeVariant {
  return ({ low: 'default', medium: 'info', high: 'warning', critical: 'error' } as Record<string, BadgeVariant>)[p] ?? 'default';
}

function StatusBadge({ status }: { status: ServiceStatus }) {
  return <Badge variant={statusVariant(status)}>{STATUS_LABELS[status]}</Badge>;
}
function PriorityBadge({ priority }: { priority: string }) {
  return <Badge variant={priorityVariant(priority)}>{PRIORITY_LABELS[priority] ?? priority}</Badge>;
}

function Field({ label, value, mono }: { label: string; value?: string | null; mono?: boolean }) {
  if (!value) return null;
  return (
    <div>
      <p className="text-xs text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-0.5">{label}</p>
      <p className={`text-sm font-medium text-gray-900 dark:text-white ${mono ? 'font-mono' : ''}`}>{value}</p>
    </div>
  );
}

function Divider() {
  return <hr className="border-gray-100 dark:border-gray-800" />;
}

function normalizeRepairResult(ticket: ServiceTicket): ServiceRepairResult {
  return {
    summary: ticket.resultData?.summary ?? ticket.result ?? '',
    partsUsed: ticket.resultData?.partsUsed ?? ticket.parts ?? [],
    worksPerformed: ticket.resultData?.worksPerformed ?? [],
  };
}

function normalizeTicket(ticket: ServiceTicket): ServiceTicket {
  const resultData = normalizeRepairResult(ticket);
  return {
    ...ticket,
    assignedMechanicName: ticket.assignedMechanicName ?? ticket.assignedTo,
    createdByUserName: ticket.createdByUserName ?? ticket.createdBy,
    createdBy: ticket.createdByUserName ?? ticket.createdBy,
    parts: resultData.partsUsed,
    result: resultData.summary,
    resultData,
  };
}

// ─── main component ────────────────────────────────────────────────────────────

export default function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const canEdit = can('edit', 'service');

  const { data: fetchedTicket } = useServiceTicketById(id ?? '');
  const { data: equipmentList = [] } = useQuery<Equipment[]>({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
  });
  const { data: mechanics = [] } = useQuery<Mechanic[]>({
    queryKey: ['mechanics'],
    queryFn: mechanicsService.getAll,
  });
  const { data: workCatalog = [] } = useQuery<ServiceWorkCatalogItem[]>({
    queryKey: ['serviceWorkCatalog'],
    queryFn: serviceWorkCatalogService.getAll,
  });
  const { data: sparePartsCatalog = [] } = useQuery<SparePartCatalogItem[]>({
    queryKey: ['sparePartsCatalog'],
    queryFn: sparePartsCatalogService.getAll,
  });
  const updateTicket = useUpdateServiceTicket();

  // Local optimistic state — seeded from server, updated immediately on user actions
  const [ticket, setTicket] = useState<ServiceTicket | null>(null);
  React.useEffect(() => {
    if (fetchedTicket) setTicket(normalizeTicket(fetchedTicket as ServiceTicket));
  }, [fetchedTicket]);

  const [newComment, setNewComment] = useState('');
  const [newAssigneeId, setNewAssigneeId] = useState('');
  const [resultSummary, setResultSummary] = useState('');
  const [newPlannedDate, setNewPlannedDate] = useState('');
  const [selectedWorkId, setSelectedWorkId] = useState('');
  const [selectedWorkQty, setSelectedWorkQty] = useState('1');
  const [selectedPartId, setSelectedPartId] = useState('');
  const [selectedPartQty, setSelectedPartQty] = useState('1');
  const [selectedPartCost, setSelectedPartCost] = useState('');

  // ── Photo upload state ──
  const [photoPending, setPhotoPending] = useState<string[]>([]);
  const photoInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!ticket) return;
    setResultSummary(normalizeRepairResult(ticket).summary ?? '');
    setNewAssigneeId(ticket.assignedMechanicId ?? '');
  }, [ticket]);

  const compressToBase64 = (file: File): Promise<string> =>
    new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          const MAX = 800;
          const ratio = Math.min(MAX / img.width, MAX / img.height, 1);
          const canvas = document.createElement('canvas');
          canvas.width  = Math.round(img.width  * ratio);
          canvas.height = Math.round(img.height * ratio);
          canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas.toDataURL('image/jpeg', 0.72));
        };
        img.src = e.target!.result as string;
      };
      reader.readAsDataURL(file);
    });

  const handlePhotoFilePick = async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!canEdit) {
      e.target.value = '';
      return;
    }
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    const results = await Promise.all(files.map(f => compressToBase64(f)));
    setPhotoPending(prev => [...prev, ...results]);
    e.target.value = '';
  };

  const savePhotos = () => {
    if (!ticket || !canEdit || !photoPending.length) return;
    const updated: ServiceTicket = {
      ...ticket,
      photos: [...(ticket.photos ?? []), ...photoPending],
    };
    persist(updated);
    setPhotoPending([]);
  };

  const deletePhoto = (idx: number) => {
    if (!ticket || !canEdit) return;
    const updated: ServiceTicket = {
      ...ticket,
      photos: (ticket.photos ?? []).filter((_, i) => i !== idx),
    };
    persist(updated);
  };

  // Persist changes — optimistic local update + server PATCH
  const persist = useCallback((updated: ServiceTicket) => {
    const normalized = normalizeTicket(updated);
    setTicket(normalized);
    updateTicket.mutate({ id: normalized.id, data: normalized });
  }, [updateTicket]);

  const currentEquipment = equipmentList.find(item =>
    item.id === ticket?.equipmentId || item.inventoryNumber === ticket?.inventoryNumber,
  );
  const equipmentTypeDisplay = ticket
    ? (currentEquipment ? getEquipmentTypeLabel(currentEquipment) : (ticket.equipmentTypeLabel || ticket.equipmentType || ''))
    : '';
  const activeMechanics = mechanics.filter(item => item.status === 'active');
  const repairResult = ticket ? normalizeRepairResult(ticket) : null;

  // ── actions ────────────────────────────────────────────────────────────────

  const changeStatus = async (newStatus: ServiceStatus, logText: string, author = user?.name || 'Оператор') => {
    if (!ticket || !canEdit) return;
    const now = new Date().toISOString();
    const updated: ServiceTicket = {
      ...ticket,
      status: newStatus,
      closedAt: (newStatus === 'closed' || newStatus === 'ready') ? now : ticket.closedAt,
      workLog: [
        ...ticket.workLog,
        { date: now, text: logText, author, type: 'status_change' },
      ],
    };
    persist(updated);

    if (!ticket.equipmentId && !ticket.inventoryNumber) return;

    try {
      const [allTickets, allEquipment, allGanttRentals] = await Promise.all([
        serviceTicketsService.getAll?.() ?? Promise.resolve([]),
        equipmentService.getAll(),
        rentalsService.getGanttData(),
      ]);

      const openStatuses: ServiceStatus[] = ['new', 'in_progress', 'waiting_parts', 'ready'];
      const remainingOpen = allTickets.some(existing =>
        existing.id !== ticket.id
        && openStatuses.includes(existing.status)
        && (
          (ticket.equipmentId && existing.equipmentId === ticket.equipmentId)
          || (ticket.inventoryNumber && existing.inventoryNumber === ticket.inventoryNumber)
        ),
      );

      const hasActiveRental = allGanttRentals.some(rental =>
        rental.equipmentInv === ticket.inventoryNumber
        && rental.status !== 'returned'
        && rental.status !== 'closed',
      );

      const updatedEquipment = allEquipment.map(item => {
        const matches =
          (ticket.equipmentId && item.id === ticket.equipmentId)
          || (ticket.inventoryNumber && item.inventoryNumber === ticket.inventoryNumber);
        if (!matches) return item;

        let nextStatus = item.status;
        if (openStatuses.includes(newStatus)) {
          nextStatus = 'in_service';
        } else if (!remainingOpen) {
          nextStatus = hasActiveRental ? 'rented' : 'available';
        }

        return { ...item, status: nextStatus as EquipmentStatus };
      });

      await equipmentService.bulkReplace(updatedEquipment);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.detail(ticket.id) }),
        queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
      ]);
    } catch {
      // Тихо оставляем optimistic update, даже если связанная синхронизация сорвалась
    }
  };

  const addComment = () => {
    if (!ticket || !canEdit || !newComment.trim()) return;
    const now = new Date().toISOString();
    persist({
      ...ticket,
      workLog: [...ticket.workLog, { date: now, text: newComment.trim(), author: user?.name || 'Оператор', type: 'comment' }],
    });
    setNewComment('');
  };

  const saveAssignee = () => {
    if (!ticket || !canEdit || !newAssigneeId) return;
    const mechanic = mechanics.find(item => item.id === newAssigneeId);
    if (!mechanic) return;
    const now = new Date().toISOString();
    persist({
      ...ticket,
      assignedTo: mechanic.name,
      assignedMechanicId: mechanic.id,
      assignedMechanicName: mechanic.name,
      workLog: [...ticket.workLog, {
        date: now,
        text: `Назначен механик: ${mechanic.name}`,
        author: user?.name || 'Оператор',
        type: 'assign',
      }],
    });
    setNewAssigneeId('');
  };

  const saveResultSummary = () => {
    if (!ticket || !canEdit) return;
    const nextResult: ServiceRepairResult = {
      ...normalizeRepairResult(ticket),
      summary: resultSummary.trim(),
    };
    persist({
      ...ticket,
      result: nextResult.summary,
      resultData: nextResult,
      parts: nextResult.partsUsed,
    });
  };

  const savePlannedDate = () => {
    if (!ticket || !canEdit || !newPlannedDate) return;
    persist({ ...ticket, plannedDate: newPlannedDate });
    setNewPlannedDate('');
  };

  const addWorkPerformed = () => {
    if (!ticket || !canEdit || !selectedWorkId) return;
    const work = workCatalog.find(item => item.id === selectedWorkId);
    const qty = Math.max(1, Number(selectedWorkQty) || 1);
    if (!work) return;
    const worksPerformed: ServiceWorkPerformed[] = [
      ...normalizeRepairResult(ticket).worksPerformed,
      {
        catalogId: work.id,
        name: work.name,
        normHours: work.normHours,
        qty,
        totalNormHours: Number((work.normHours * qty).toFixed(2)),
      },
    ];
    const nextResult: ServiceRepairResult = {
      ...normalizeRepairResult(ticket),
      worksPerformed,
    };
    persist({
      ...ticket,
      result: nextResult.summary,
      resultData: nextResult,
      parts: nextResult.partsUsed,
      workLog: [...ticket.workLog, {
        date: new Date().toISOString(),
        text: `Добавлена работа: ${work.name} × ${qty}`,
        author: user?.name || 'Оператор',
        type: 'repair_result',
      }],
    });
    setSelectedWorkId('');
    setSelectedWorkQty('1');
  };

  const removeWorkPerformed = (index: number) => {
    if (!ticket || !canEdit) return;
    const current = normalizeRepairResult(ticket);
    const nextResult: ServiceRepairResult = {
      ...current,
      worksPerformed: current.worksPerformed.filter((_, itemIndex) => itemIndex !== index),
    };
    persist({ ...ticket, result: nextResult.summary, resultData: nextResult, parts: nextResult.partsUsed });
  };

  const addPartUsage = () => {
    if (!ticket || !canEdit || !selectedPartId) return;
    const part = sparePartsCatalog.find(item => item.id === selectedPartId);
    const qty = Math.max(1, Number(selectedPartQty) || 1);
    const cost = Math.max(0, Number(selectedPartCost) || part?.unitCost || 0);
    if (!part) return;
    const partsUsed: ServicePartUsage[] = [
      ...normalizeRepairResult(ticket).partsUsed,
      {
        catalogId: part.id,
        name: part.name,
        sku: part.sku,
        qty,
        cost,
      },
    ];
    const nextResult: ServiceRepairResult = {
      ...normalizeRepairResult(ticket),
      partsUsed,
    };
    persist({
      ...ticket,
      result: nextResult.summary,
      resultData: nextResult,
      parts: nextResult.partsUsed,
      workLog: [...ticket.workLog, {
        date: new Date().toISOString(),
        text: `Добавлена запчасть: ${part.name} × ${qty}`,
        author: user?.name || 'Оператор',
        type: 'repair_result',
      }],
    });
    setSelectedPartId('');
    setSelectedPartQty('1');
    setSelectedPartCost('');
  };

  const removePartUsage = (index: number) => {
    if (!ticket || !canEdit) return;
    const current = normalizeRepairResult(ticket);
    const nextResult: ServiceRepairResult = {
      ...current,
      partsUsed: current.partsUsed.filter((_, itemIndex) => itemIndex !== index),
    };
    persist({ ...ticket, result: nextResult.summary, resultData: nextResult, parts: nextResult.partsUsed });
  };

  // ── "not found" screen ─────────────────────────────────────────────────────

  if (!ticket) {
    return (
      <div className="flex flex-col items-center justify-center h-full py-24 gap-4 text-center">
        <XCircle className="h-12 w-12 text-gray-300" />
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Заявка не найдена</h2>
        <p className="text-sm text-gray-500 dark:text-gray-400">
          Возможно, она была удалена или ID указан некорректно.
        </p>
        <Button onClick={() => navigate('/service')}>Вернуться к списку</Button>
      </div>
    );
  }

  // ── action buttons based on status (only for users with edit permission) ──

  const actions: React.ReactNode[] = [];

  if (canEdit && ticket.status === 'new') {
    actions.push(
      <Button key="start" onClick={() => changeStatus('in_progress', 'Заявка взята в работу')}>
        <Play className="h-4 w-4" />
        Взять в работу
      </Button>
    );
  }
  if (canEdit && ticket.status === 'in_progress') {
    actions.push(
      <Button key="parts" variant="secondary" onClick={() => changeStatus('waiting_parts', 'Заявка переведена в статус «Ожидание запчастей»')}>
        <Package className="h-4 w-4" />
        Ожидание запчастей
      </Button>
    );
    actions.push(
      <Button key="ready" onClick={() => changeStatus('ready', 'Работы завершены, заявка готова к закрытию')}>
        <CheckCircle className="h-4 w-4" />
        Работы завершены
      </Button>
    );
  }
  if (canEdit && ticket.status === 'waiting_parts') {
    actions.push(
      <Button key="resume" variant="secondary" onClick={() => changeStatus('in_progress', 'Запчасти получены, возобновлена работа')}>
        <Play className="h-4 w-4" />
        Запчасти получены
      </Button>
    );
  }
  if (canEdit && ticket.status === 'ready') {
    actions.push(
      <Button key="close" onClick={() => changeStatus('closed', 'Заявка закрыта')}>
        <CheckCircle className="h-4 w-4" />
        Закрыть заявку
      </Button>
    );
  }
  if (canEdit && ticket.status !== 'closed') {
    actions.push(
      <Button key="cancel" variant="secondary" className="border-red-200 text-red-600 hover:bg-red-50"
        onClick={() => changeStatus('closed', 'Заявка отменена / закрыта без выполнения')}>
        <XCircle className="h-4 w-4" />
        Отменить
      </Button>
    );
  }

  // ── log icon ──────────────────────────────────────────────────────────────

  const logIcon = (type?: string) => {
    if (type === 'status_change') return <AlertTriangle className="h-3.5 w-3.5 text-amber-500 mt-0.5 shrink-0" />;
    if (type === 'assign') return <User className="h-3.5 w-3.5 text-blue-500 mt-0.5 shrink-0" />;
    return <FileText className="h-3.5 w-3.5 text-gray-400 mt-0.5 shrink-0" />;
  };

  // ── render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-4 p-4 sm:space-y-6 sm:p-6 md:p-8">
      {/* Header */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Button variant="secondary" onClick={() => navigate('/service')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{ticket.id}</h1>
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
            </div>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{ticket.equipment}</p>
          </div>
        </div>
        {/* Action buttons */}
        {actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {actions}
          </div>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* ── Left column (2/3) ───────────────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-6">

          {/* Main info */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <FileText className="h-4 w-4" />
                Основная информация
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="ID заявки" value={ticket.id} mono />
                <Field label="Статус" value={STATUS_LABELS[ticket.status]} />
                <Field label="Приоритет" value={PRIORITY_LABELS[ticket.priority] ?? ticket.priority} />
                <Field label="SLA" value={ticket.sla} />
                <Field label="Дата создания" value={formatDate(ticket.createdAt)} />
                {ticket.plannedDate && <Field label="Плановая дата" value={formatDate(ticket.plannedDate)} />}
                {ticket.closedAt && <Field label="Фактическое закрытие" value={formatDate(ticket.closedAt)} />}
                <Field label="Источник" value={ticket.source ? SOURCE_LABELS[ticket.source] : undefined} />
                <Field label="Кто создал" value={ticket.createdByUserName ?? ticket.createdBy} />
                <Field label="Контактное лицо" value={ticket.reporterContact} />
              </div>
            </CardContent>
          </Card>

          {/* Equipment block */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Wrench className="h-4 w-4" />
                Техника
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
                <Field label="Наименование" value={ticket.equipment} />
                {ticket.inventoryNumber && <Field label="Инв. номер" value={ticket.inventoryNumber} mono />}
                {ticket.serialNumber && <Field label="Серийный номер" value={ticket.serialNumber} mono />}
                {equipmentTypeDisplay && (
                  <Field label="Тип техники" value={equipmentTypeDisplay} />
                )}
                {ticket.location && (
                  <div className="flex items-start gap-1.5 col-span-2">
                    <MapPin className="h-4 w-4 text-gray-400 mt-0.5 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Локация</p>
                      <p className="text-sm font-medium text-gray-900 dark:text-white">{ticket.location}</p>
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>

          {/* Problem block */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <AlertTriangle className="h-4 w-4" />
                Проблема
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Причина обращения</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{ticket.reason}</p>
              </div>
              {ticket.description && ticket.description !== ticket.reason && (
                <>
                  <Divider />
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Описание неисправности</p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{ticket.description}</p>
                  </div>
                </>
              )}
              {repairResult && (repairResult.summary || repairResult.worksPerformed.length > 0 || repairResult.partsUsed.length > 0) && (
                <>
                  <Divider />
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Результат работ</p>
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {repairResult.summary || 'Результат в текстовом виде не указан'}
                      </p>
                    </div>
                    {repairResult.worksPerformed.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs text-gray-500 uppercase tracking-wide">Выполненные работы</p>
                        <div className="space-y-2">
                          {repairResult.worksPerformed.map((work, index) => (
                            <div key={`${work.catalogId}-${index}`} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                              <div>
                                <p className="font-medium text-gray-900 dark:text-white">{work.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {work.normHours} н/ч × {work.qty} = {work.totalNormHours} н/ч
                                </p>
                              </div>
                              {canEdit && ticket.status !== 'closed' && (
                                <button onClick={() => removeWorkPerformed(index)} className="text-xs text-red-500 hover:underline">
                                  Удалить
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                    {repairResult.partsUsed.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs text-gray-500 uppercase tracking-wide">Использованные запчасти</p>
                        <div className="space-y-2">
                          {repairResult.partsUsed.map((part, index) => (
                            <div key={`${part.catalogId ?? part.name}-${index}`} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                              <div>
                                <p className="font-medium text-gray-900 dark:text-white">{part.name}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {part.sku ? `${part.sku} · ` : ''}{part.qty} шт. × {part.cost.toLocaleString('ru-RU')} ₽
                                </p>
                              </div>
                              {canEdit && ticket.status !== 'closed' && (
                                <button onClick={() => removePartUsage(index)} className="text-xs text-red-500 hover:underline">
                                  Удалить
                                </button>
                              )}
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
              {canEdit && ticket.status !== 'closed' && (
                <>
                  <Divider />
                  <div className="space-y-4">
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Итог ремонта</label>
                        <textarea
                          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                          rows={2}
                          value={resultSummary}
                          onChange={e => setResultSummary(e.target.value)}
                          placeholder="Краткий итог работ и состояние техники после ремонта"
                        />
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={saveResultSummary}>Сохранить</Button>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_90px_auto]">
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 uppercase tracking-wide">Добавить работу</label>
                        <select
                          value={selectedWorkId}
                          onChange={e => setSelectedWorkId(e.target.value)}
                          className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        >
                          <option value="">Выберите работу из справочника</option>
                          {workCatalog.filter(item => item.status === 'active').map(work => (
                            <option key={work.id} value={work.id}>
                              {work.name} · {work.normHours} н/ч
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 uppercase tracking-wide">Кол-во</label>
                        <Input type="number" min="1" value={selectedWorkQty} onChange={e => setSelectedWorkQty(e.target.value)} />
                      </div>
                      <div className="flex items-end">
                        <Button size="sm" variant="secondary" onClick={addWorkPerformed} disabled={!selectedWorkId}>
                          Добавить работу
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_90px_120px_auto]">
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 uppercase tracking-wide">Добавить запчасть</label>
                        <select
                          value={selectedPartId}
                          onChange={e => {
                            const nextId = e.target.value;
                            const part = sparePartsCatalog.find(item => item.id === nextId);
                            setSelectedPartId(nextId);
                            setSelectedPartCost(part?.unitCost ? String(part.unitCost) : '');
                          }}
                          className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                        >
                          <option value="">Выберите запчасть</option>
                          {sparePartsCatalog.filter(item => item.status === 'active').map(part => (
                            <option key={part.id} value={part.id}>
                              {part.name}{part.sku ? ` · ${part.sku}` : ''}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 uppercase tracking-wide">Кол-во</label>
                        <Input type="number" min="1" value={selectedPartQty} onChange={e => setSelectedPartQty(e.target.value)} />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 uppercase tracking-wide">Цена</label>
                        <Input type="number" min="0" value={selectedPartCost} onChange={e => setSelectedPartCost(e.target.value)} />
                      </div>
                      <div className="flex items-end">
                        <Button size="sm" variant="secondary" onClick={addPartUsage} disabled={!selectedPartId}>
                          Добавить запчасть
                        </Button>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Work log / history */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <History className="h-4 w-4" />
                История
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ticket.workLog.length === 0 && (
                <p className="text-sm text-gray-400 italic">История пуста</p>
              )}
              {[...ticket.workLog].reverse().map((entry, i) => (
                <div key={i} className="flex gap-3 text-sm">
                  {logIcon(entry.type)}
                  <div className="flex-1 min-w-0">
                    <p className="text-gray-900 dark:text-white">{entry.text}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {entry.author} · {new Date(entry.date).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    </p>
                  </div>
                </div>
              ))}

              {canEdit && ticket.status !== 'closed' && (
                <>
                  <Divider />
                  <div className="flex gap-2 items-end pt-1">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Комментарий механика</label>
                      <textarea
                        className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                        rows={2}
                        value={newComment}
                        onChange={e => setNewComment(e.target.value)}
                        placeholder="Добавить комментарий..."
                      />
                    </div>
                    <Button size="sm" onClick={addComment} disabled={!newComment.trim()}>
                      Добавить
                    </Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Photos card */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle className="flex items-center gap-2 text-base">
                  <Camera className="h-4 w-4" />
                  Фото заявки
                </CardTitle>
                {canEdit && (
                  <Button size="sm" variant="secondary" onClick={() => photoInputRef.current?.click()}>
                    <Plus className="h-4 w-4" />
                    Добавить фото
                  </Button>
                )}
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <input
                ref={photoInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={handlePhotoFilePick}
              />

              {/* Pending previews */}
              {canEdit && photoPending.length > 0 && (
                <div className="rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-900/20 p-3 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-blue-700 dark:text-blue-300 font-medium">Выбрано {photoPending.length} фото</span>
                    <button onClick={() => setPhotoPending([])} className="text-xs text-gray-500 hover:text-red-500">Очистить</button>
                  </div>
                  <div className="flex gap-2 overflow-x-auto pb-1">
                    {photoPending.map((src, i) => (
                      <div key={i} className="relative shrink-0">
                        <img src={src} alt="" className="h-16 w-24 rounded-md object-cover border border-gray-200 dark:border-gray-700" />
                        <button
                          onClick={() => setPhotoPending(prev => prev.filter((_, idx) => idx !== i))}
                          className="absolute -right-1.5 -top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-red-500 text-white hover:bg-red-600"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    ))}
                  </div>
                  <Button size="sm" onClick={savePhotos}>
                    <Upload className="h-3.5 w-3.5" />
                    Сохранить
                  </Button>
                </div>
              )}

              {/* Saved photos grid */}
              {(ticket.photos ?? []).length > 0 ? (
                <div className="grid grid-cols-3 gap-2">
                  {(ticket.photos ?? []).map((src, i) => (
                    <div key={i} className="group relative aspect-square rounded-md overflow-hidden border border-gray-200 dark:border-gray-700">
                      <img
                        src={src}
                        alt={`Фото ${i + 1}`}
                        className="h-full w-full object-cover cursor-pointer hover:opacity-90"
                        onClick={() => window.open(src, '_blank')}
                      />
                      {canEdit && (
                        <button
                          onClick={() => deletePhoto(i)}
                          className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 hover:bg-red-600 transition-opacity"
                        >
                          <X className="h-3 w-3" />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
              ) : photoPending.length === 0 && (
                <div className="flex flex-col items-center justify-center py-6 text-center">
                  <Camera className="h-8 w-8 text-gray-300 dark:text-gray-600 mb-2" />
                  <p className="text-sm text-gray-400 dark:text-gray-500">Фото не добавлены</p>
                  {canEdit && (
                    <button
                      onClick={() => photoInputRef.current?.click()}
                      className="mt-2 text-sm text-[--color-primary] hover:underline"
                    >
                      Загрузить фото
                    </button>
                  )}
                </div>
              )}
              <p className="text-xs text-gray-400 dark:text-gray-500">
                Фото сжимаются до 800px и хранятся в браузере
              </p>
            </CardContent>
          </Card>
        </div>

        {/* ── Right column (1/3) ──────────────────────────────────────────── */}
        <div className="space-y-6">

          {/* Assignee card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <User className="h-4 w-4" />
                Ответственный
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div>
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">Назначен</p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">
                  {ticket.assignedMechanicName || ticket.assignedTo || <span className="text-gray-400 font-normal italic">Не назначен</span>}
                </p>
              </div>
              {canEdit && ticket.status !== 'closed' && (
                <>
                  <Divider />
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Назначить механика</label>
                      <select
                        value={newAssigneeId}
                        onChange={e => setNewAssigneeId(e.target.value)}
                        className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      >
                        <option value="">Выберите механика из справочника</option>
                        {activeMechanics.map(mechanic => (
                          <option key={mechanic.id} value={mechanic.id}>{mechanic.name}</option>
                        ))}
                        {ticket.assignedMechanicId && !activeMechanics.some(item => item.id === ticket.assignedMechanicId) && ticket.assignedMechanicName && (
                          <option value={ticket.assignedMechanicId}>{ticket.assignedMechanicName} (неактивен)</option>
                        )}
                      </select>
                    </div>
                    <Button size="sm" onClick={saveAssignee} disabled={!newAssigneeId}>OK</Button>
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          {/* Timing card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Clock className="h-4 w-4" />
                Сроки
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <Field label="SLA" value={ticket.sla} />
              <Field label="Дата создания" value={formatDate(ticket.createdAt)} />
              {ticket.plannedDate
                ? <Field label="Плановая дата" value={formatDate(ticket.plannedDate)} />
                : canEdit && ticket.status !== 'closed' && (
                  <>
                    <Divider />
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">Плановая дата</label>
                      <Input
                          type="date"
                          value={newPlannedDate}
                          onChange={e => setNewPlannedDate(e.target.value)}
                        />
                      </div>
                      <Button size="sm" onClick={savePlannedDate} disabled={!newPlannedDate}>OK</Button>
                    </div>
                  </>
                )
              }
              {ticket.closedAt && <Field label="Фактически закрыта" value={formatDate(ticket.closedAt)} />}
            </CardContent>
          </Card>

          {/* Priority alert */}
          {(ticket.priority === 'critical' || ticket.priority === 'high') && ticket.status !== 'closed' && (
            <Card className="border-red-200 dark:border-red-800 bg-red-50 dark:bg-red-900/20">
              <CardContent className="pt-4">
                <div className="flex items-center gap-2 mb-1">
                  <AlertTriangle className="h-4 w-4 text-red-600" />
                  <p className="text-sm font-semibold text-red-800 dark:text-red-200">
                    {ticket.priority === 'critical' ? 'Критический приоритет' : 'Высокий приоритет'}
                  </p>
                </div>
                <p className="text-xs text-red-600 dark:text-red-300">
                  Требуется срочное выполнение в рамках SLA: {ticket.sla}
                </p>
              </CardContent>
            </Card>
          )}

          {/* Parts */}
          {repairResult && repairResult.partsUsed.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Tag className="h-4 w-4" />
                  Запчасти
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {repairResult.partsUsed.map((p, i) => (
                    <div key={i} className="flex justify-between text-sm">
                      <span className="text-gray-700 dark:text-gray-300">{p.name} × {p.qty}</span>
                      <span className="text-gray-500">{p.cost.toLocaleString('ru-RU')} ₽</span>
                    </div>
                  ))}
                  <Divider />
                  <div className="flex justify-between text-sm font-semibold">
                    <span>Итого</span>
                    <span>{repairResult.partsUsed.reduce((s, p) => s + p.cost * p.qty, 0).toLocaleString('ru-RU')} ₽</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
