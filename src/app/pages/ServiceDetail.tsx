import React, { useState, useCallback } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import { Button } from '../components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '../components/ui/card';
import { Badge } from '../components/ui/badge';
import { Input } from '../components/ui/input';
import { SearchableSelect } from '../components/ui/SearchableSelect';
import {
  ArrowLeft, Wrench, User, Clock, MapPin, Tag, FileText,
  CheckCircle, XCircle, AlertTriangle, Play, Package, History,
  Camera, Upload, Trash2, X, Plus, Car,
} from 'lucide-react';
import { formatDate } from '../lib/utils';
import { EQUIPMENT_KEYS } from '../hooks/useEquipment';
import { DOCUMENT_KEYS, useDocumentsList } from '../hooks/useDocuments';
import { RENTAL_KEYS } from '../hooks/useRentals';
import { SERVICE_TICKET_KEYS, useServiceTicketById, useUpdateServiceTicket } from '../hooks/useServiceTickets';
import type {
  Equipment,
  EquipmentStatus,
  Mechanic,
  RepairPartItem,
  RepairWorkItem,
  ServiceCloseChecklist,
  ServicePartUsage,
  ServiceRepairResult,
  ServiceWork,
  ServiceTicket,
  ServiceStatus,
  ServiceWorkPerformed,
  SparePart,
} from '../types';
import { documentsService } from '../services/documents.service';
import { equipmentService } from '../services/equipment.service';
import { mechanicsService } from '../services/mechanics.service';
import { repairPartItemsService } from '../services/repair-part-items.service';
import { repairWorkItemsService } from '../services/repair-work-items.service';
import { rentalsService } from '../services/rentals.service';
import { serviceWorksService } from '../services/service-works.service';
import { serviceTicketsService } from '../services/service-tickets.service';
import { sparePartsService } from '../services/spare-parts.service';
import { serviceVehiclesService } from '../services/service-vehicles.service';
import { getEquipmentTypeLabel } from '../lib/equipmentClassification';
import { getServiceScenarioLabel, inferServiceKind, isRepairScenario } from '../lib/serviceScenarios';
import {
  buildServiceWorkOrderDocumentData,
  buildServiceWorkOrderHtml,
  openPrintableHtml,
} from '../lib/serviceWorkOrder';
import { buildServiceQuickActions } from '../lib/quickActions.js';

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

function getRepairSummary(ticket: ServiceTicket): string {
  return ticket.resultData?.summary ?? ticket.result ?? '';
}

function legacyWorks(ticket: ServiceTicket): ServiceWorkPerformed[] {
  return ticket.resultData?.worksPerformed ?? [];
}

function legacyParts(ticket: ServiceTicket): ServicePartUsage[] {
  return ticket.resultData?.partsUsed ?? ticket.parts ?? [];
}

function workItemsToResult(items: RepairWorkItem[]): ServiceWorkPerformed[] {
  return items.map(item => {
    const normHours = isNaN(item.normHoursSnapshot) || item.normHoursSnapshot == null ? 0 : item.normHoursSnapshot;
    const ratePerHour = isNaN(item.ratePerHourSnapshot) || item.ratePerHourSnapshot == null ? 0 : item.ratePerHourSnapshot;
    const totalNormHours = Number((normHours * item.quantity).toFixed(2));
    return {
      catalogId: item.workId,
      name: item.nameSnapshot,
      normHours,
      qty: item.quantity,
      totalNormHours,
      ratePerHour,
      totalCost: Number((totalNormHours * ratePerHour).toFixed(2)),
      meterHours: Number.isFinite(Number(item.meterHours)) ? Number(item.meterHours) : undefined,
      equipmentId: item.equipmentId,
      equipmentSnapshot: item.equipmentSnapshot,
      createdAt: item.createdAt,
      createdByUserName: item.createdByUserName,
    };
  });
}

function partItemsToResult(items: RepairPartItem[]): ServicePartUsage[] {
  return items.map(item => ({
    catalogId: item.partId,
    name: item.nameSnapshot,
    sku: item.articleSnapshot,
    qty: item.quantity,
    cost: item.priceSnapshot,
  }));
}

function normalizePartUsage(part: Partial<ServicePartUsage> | undefined): ServicePartUsage {
  return {
    catalogId: part?.catalogId,
    name: part?.name ?? 'Без названия',
    sku: part?.sku,
    qty: Number.isFinite(part?.qty) ? Number(part!.qty) : 0,
    cost: Number.isFinite(part?.cost) ? Number(part!.cost) : 0,
  };
}

function normalizeWorkPerformed(work: Partial<ServiceWorkPerformed> | undefined): ServiceWorkPerformed {
  return {
    catalogId: work?.catalogId ?? '',
    name: work?.name ?? 'Без названия',
    normHours: Number.isFinite(work?.normHours) ? Number(work!.normHours) : 0,
    qty: Number.isFinite(work?.qty) ? Number(work!.qty) : 0,
    totalNormHours: Number.isFinite(work?.totalNormHours) ? Number(work!.totalNormHours) : 0,
    ratePerHour: Number.isFinite(work?.ratePerHour) ? Number(work!.ratePerHour) : 0,
    totalCost: Number.isFinite(work?.totalCost) ? Number(work!.totalCost) : 0,
    meterHours: Number.isFinite(Number(work?.meterHours)) ? Number(work!.meterHours) : undefined,
    equipmentId: work?.equipmentId,
    equipmentSnapshot: work?.equipmentSnapshot,
    createdAt: work?.createdAt,
    createdByUserName: work?.createdByUserName,
  };
}

function formatServiceDate(value: string | null | undefined) {
  const timestamp = Date.parse(String(value || ''));
  return Number.isFinite(timestamp) ? formatDate(new Date(timestamp).toISOString()) : '—';
}

function buildRepairResult(ticket: ServiceTicket, workItems: RepairWorkItem[], partItems: RepairPartItem[]): ServiceRepairResult {
  return {
    summary: getRepairSummary(ticket),
    worksPerformed: workItems.length > 0 ? workItemsToResult(workItems) : legacyWorks(ticket),
    partsUsed: partItems.length > 0 ? partItemsToResult(partItems) : legacyParts(ticket),
  };
}

function normalizeTicket(ticket: ServiceTicket): ServiceTicket {
  const normalizedResult = {
    summary: ticket.resultData?.summary ?? ticket.result ?? '',
    worksPerformed: Array.isArray(ticket.resultData?.worksPerformed)
      ? ticket.resultData!.worksPerformed.map(normalizeWorkPerformed)
      : [],
    partsUsed: Array.isArray(ticket.resultData?.partsUsed)
      ? ticket.resultData!.partsUsed.map(normalizePartUsage)
      : (Array.isArray(ticket.parts) ? ticket.parts.map(normalizePartUsage) : []),
  };

  return {
    ...ticket,
    equipment: ticket.equipment ?? 'Не указано',
    reason: ticket.reason ?? '',
    description: ticket.description ?? '',
    sla: ticket.sla ?? '',
    serviceKind: inferServiceKind(ticket),
    assignedMechanicName: ticket.assignedMechanicName ?? ticket.assignedTo,
    createdByUserName: ticket.createdByUserName ?? ticket.createdBy,
    createdBy: ticket.createdByUserName ?? ticket.createdBy,
    result: normalizedResult.summary,
    resultData: normalizedResult,
    workLog: Array.isArray(ticket.workLog)
      ? ticket.workLog.map(entry => ({
          date: entry?.date ?? new Date(0).toISOString(),
          text: entry?.text ?? '',
          author: entry?.author ?? 'Система',
          type: entry?.type,
        }))
      : [],
    parts: Array.isArray(ticket.parts) ? ticket.parts : [],
    photos: Array.isArray(ticket.photos) ? ticket.photos : [],
    repairPhotos: {
      before: Array.isArray(ticket.repairPhotos?.before) ? ticket.repairPhotos!.before : [],
      after: Array.isArray(ticket.repairPhotos?.after) ? ticket.repairPhotos!.after : [],
      beforeUploadedAt: ticket.repairPhotos?.beforeUploadedAt,
      beforeUploadedBy: ticket.repairPhotos?.beforeUploadedBy,
      afterUploadedAt: ticket.repairPhotos?.afterUploadedAt,
      afterUploadedBy: ticket.repairPhotos?.afterUploadedBy,
    },
  };
}

const CLOSE_CHECKLIST_LABELS: Record<keyof ServiceCloseChecklist, string> = {
  faultEliminated: 'Неисправность устранена',
  worksRecorded: 'Работы внесены в отчёт',
  partsRecordedOrNotRequired: 'Запчасти внесены или не требовались',
  beforePhotosAttached: 'Фото ДО приложены',
  afterPhotosAttached: 'Фото ПОСЛЕ приложены',
  summaryFilled: 'Итог ремонта заполнен',
};

function repairCloseChecklistEntries(ticket: ServiceTicket, workItems: RepairWorkItem[], partItems: RepairPartItem[]) {
  const repairPhotos = ticket.repairPhotos ?? { before: [], after: [] };
  const summaryFilled = Boolean(getRepairSummary(ticket).trim());
  const fallback = {
    faultEliminated: false,
    worksRecorded: workItems.length > 0,
    partsRecordedOrNotRequired: partItems.length > 0,
    beforePhotosAttached: (repairPhotos.before ?? []).length > 0,
    afterPhotosAttached: (repairPhotos.after ?? []).length > 0,
    summaryFilled,
  } satisfies ServiceCloseChecklist;

  const merged = {
    ...fallback,
    ...(ticket.closeChecklist ?? {}),
    worksRecorded: workItems.length > 0,
    beforePhotosAttached: (repairPhotos.before ?? []).length > 0,
    afterPhotosAttached: (repairPhotos.after ?? []).length > 0,
    summaryFilled,
  };

  return (Object.keys(CLOSE_CHECKLIST_LABELS) as Array<keyof ServiceCloseChecklist>).map(key => ({
    key,
    label: CLOSE_CHECKLIST_LABELS[key],
    done: Boolean(merged[key]),
  }));
}

function RepairPhotoGroup({
  title,
  photos,
  uploadedAt,
  uploadedBy,
}: {
  title: string;
  photos?: string[];
  uploadedAt?: string | null;
  uploadedBy?: string | null;
}) {
  const safePhotos = Array.isArray(photos) ? photos : [];
  const hasMeta = Boolean(uploadedAt || uploadedBy);

  return (
    <div className="space-y-2 rounded-lg border border-gray-200 p-3 dark:border-gray-700">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-gray-900 dark:text-white">{title}</p>
          {hasMeta && (
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {[uploadedBy, uploadedAt ? formatServiceDate(uploadedAt) : null].filter(Boolean).join(' · ')}
            </p>
          )}
        </div>
        <Badge variant={safePhotos.length > 0 ? 'info' : 'default'}>{safePhotos.length} фото</Badge>
      </div>

      {safePhotos.length > 0 ? (
        <div className="grid grid-cols-3 gap-2">
          {safePhotos.map((src, index) => (
            <button
              type="button"
              key={`${title}-${index}`}
              onClick={() => window.open(src, '_blank')}
              className="group relative aspect-square overflow-hidden rounded-md border border-gray-200 dark:border-gray-700"
            >
              <img src={src} alt={`${title} ${index + 1}`} className="h-full w-full object-cover group-hover:opacity-90" />
            </button>
          ))}
        </div>
      ) : (
        <div className="flex items-center gap-2 rounded-md bg-gray-50 px-3 py-2 text-sm text-gray-500 dark:bg-gray-800 dark:text-gray-400">
          <Camera className="h-4 w-4" />
          Фото пока не добавлены
        </div>
      )}
    </div>
  );
}

// ─── main component ────────────────────────────────────────────────────────────

export default function ServiceDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { can } = usePermissions();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const isAdmin = user?.role === 'Администратор';
  const canEdit = can('edit', 'service');
  const canDeleteService = user?.role === 'Администратор' && can('delete', 'service');
  const canCreateDocuments = can('create', 'documents');

  const { data: fetchedTicket } = useServiceTicketById(id ?? '');
  const { data: documents = [] } = useDocumentsList();
  const { data: equipmentList = [] } = useQuery<Equipment[]>({
    queryKey: EQUIPMENT_KEYS.all,
    queryFn: equipmentService.getAll,
  });
  const { data: mechanics = [] } = useQuery<Mechanic[]>({
    queryKey: ['mechanics'],
    queryFn: mechanicsService.getAll,
  });
  const { data: serviceVehiclesList = [] } = useQuery({
    queryKey: ['service_vehicles'],
    queryFn:  serviceVehiclesService.getAll,
  });
  const { data: workCatalog = [] } = useQuery<ServiceWork[]>({
    queryKey: ['serviceWorks', 'active'],
    queryFn: serviceWorksService.getActive,
  });
  const { data: sparePartsCatalog = [] } = useQuery<SparePart[]>({
    queryKey: ['spareParts', 'active'],
    queryFn: sparePartsService.getActive,
  });
  const { data: repairWorkItems = [] } = useQuery<RepairWorkItem[]>({
    queryKey: ['repairWorkItems', id],
    queryFn: () => repairWorkItemsService.getByRepairId(id ?? ''),
    enabled: Boolean(id),
  });
  const { data: repairPartItems = [] } = useQuery<RepairPartItem[]>({
    queryKey: ['repairPartItems', id],
    queryFn: () => repairPartItemsService.getByRepairId(id ?? ''),
    enabled: Boolean(id),
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
  const [repairFormError, setRepairFormError] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [workOrderError, setWorkOrderError] = useState<string | null>(null);
  const [workOrderBusy, setWorkOrderBusy] = useState(false);

  // ── Photo upload state ──
  const [photoPending, setPhotoPending] = useState<string[]>([]);
  const photoInputRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!ticket) return;
    setResultSummary(getRepairSummary(ticket));
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
    if (!canEditTicketFields) {
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
    if (!ticket || !canEditTicketFields || !photoPending.length) return;
    const updated: ServiceTicket = {
      ...ticket,
      photos: [...(ticket.photos ?? []), ...photoPending],
    };
    persist(updated);
    setPhotoPending([]);
  };

  const deletePhoto = (idx: number) => {
    if (!ticket || !canEditTicketFields) return;
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

  const currentEquipment = ticket
    ? (
        equipmentList.find(item => item.id === ticket.equipmentId)
        ?? equipmentList.find(item => ticket.serialNumber && item.serialNumber === ticket.serialNumber)
        ?? equipmentList.find(item =>
          ticket.inventoryNumber
          && item.inventoryNumber === ticket.inventoryNumber
          && equipmentList.filter(eq => eq.inventoryNumber === ticket.inventoryNumber).length === 1
        )
      )
    : undefined;
  const equipmentTypeDisplay = ticket
    ? (currentEquipment ? getEquipmentTypeLabel(currentEquipment) : (ticket.equipmentTypeLabel || ticket.equipmentType || ''))
    : '';
  const activeMechanics = mechanics.filter(item => item.status === 'active');
  const repairResult = ticket ? buildRepairResult(ticket, repairWorkItems, repairPartItems) : null;
  const repairPhotos = ticket?.repairPhotos ?? { before: [], after: [] };
  const closeChecklistEntries = ticket ? repairCloseChecklistEntries(ticket, repairWorkItems, repairPartItems) : [];
  const scenarioIsRepair = ticket ? isRepairScenario(ticket) : true;
  const serviceScenarioLabel = ticket ? getServiceScenarioLabel(ticket) : '';
  const relatedWorkOrder = React.useMemo(() => {
    if (!ticket) return null;
    return documents.find((doc) => doc.type === 'work_order' && doc.serviceTicket === ticket.id) ?? null;
  }, [documents, ticket]);

  // ── actions ────────────────────────────────────────────────────────────────

  const changeStatus = async (newStatus: ServiceStatus, logText: string, author = user?.name || 'Оператор') => {
    if (!ticket || !canEditTicketFields) return;
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

      const openStatuses: ServiceStatus[] = ['new', 'in_progress', 'waiting_parts'];
      const ticketInventoryIsUnique = ticket.inventoryNumber
        ? allEquipment.filter(item => item.inventoryNumber === ticket.inventoryNumber).length === 1
        : false;

      const remainingOpen = allTickets.some(existing =>
        existing.id !== ticket.id
        && openStatuses.includes(existing.status)
        && (
          (ticket.equipmentId && existing.equipmentId === ticket.equipmentId)
          || (ticket.serialNumber && existing.serialNumber === ticket.serialNumber)
          || (ticket.inventoryNumber && ticketInventoryIsUnique && existing.inventoryNumber === ticket.inventoryNumber)
        ),
      );

      const hasActiveRental = allGanttRentals.some(rental =>
        (
          (ticket.equipmentId && rental.equipmentId === ticket.equipmentId)
          || (!rental.equipmentId && ticket.inventoryNumber && ticketInventoryIsUnique && rental.equipmentInv === ticket.inventoryNumber)
        )
        && rental.status !== 'returned'
        && rental.status !== 'closed',
      );

      const updatedEquipment = allEquipment.map(item => {
        const matches =
          (ticket.equipmentId && item.id === ticket.equipmentId)
          || (ticket.serialNumber && item.serialNumber === ticket.serialNumber)
          || (ticket.inventoryNumber && ticketInventoryIsUnique && item.inventoryNumber === ticket.inventoryNumber);
        if (!matches) return item;

        let nextStatus = item.status;
        if (openStatuses.includes(newStatus)) {
          nextStatus = 'in_service';
        } else if (!remainingOpen) {
          nextStatus = hasActiveRental ? 'rented' : 'available';
        }

        const base = { ...item, status: nextStatus as EquipmentStatus };
        if (newStatus === 'closed' && item.id === ticket.equipmentId) {
          if (ticket.serviceKind === 'chto') {
            return { ...base, maintenanceCHTO: now.slice(0, 10) };
          }
          if (ticket.serviceKind === 'pto') {
            return { ...base, maintenancePTO: now.slice(0, 10) };
          }
        }
        return base;
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
    if (!ticket || !canEditTicketFields || !newComment.trim()) return;
    const now = new Date().toISOString();
    persist({
      ...ticket,
      workLog: [...ticket.workLog, { date: now, text: newComment.trim(), author: user?.name || 'Оператор', type: 'comment' }],
    });
    setNewComment('');
  };

  const saveAssignee = () => {
    if (!ticket || !canEditTicketFields || !newAssigneeId) return;
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
    if (!ticket || !canEditTicketFields) return;
    persist({
      ...ticket,
      result: resultSummary.trim(),
      resultData: {
        ...ticket.resultData,
        summary: resultSummary.trim(),
        worksPerformed: legacyWorks(ticket),
        partsUsed: legacyParts(ticket),
      },
    });
  };

  const savePlannedDate = () => {
    if (!ticket || !canEditTicketFields || !newPlannedDate) return;
    persist({ ...ticket, plannedDate: newPlannedDate });
    setNewPlannedDate('');
  };

  const handleDeleteTicket = useCallback(async () => {
    if (!ticket || !canDeleteService) return;

    setDeleteError(null);
    const deletedTicket = ticket;

    try {
      await serviceTicketsService.delete(deletedTicket.id);

      if (deletedTicket.equipmentId || deletedTicket.inventoryNumber || deletedTicket.serialNumber) {
        const [allTickets, allEquipment, allGanttRentals] = await Promise.all([
          serviceTicketsService.getAll(),
          equipmentService.getAll(),
          rentalsService.getGanttData(),
        ]);

        const openStatuses: ServiceStatus[] = ['new', 'in_progress', 'waiting_parts'];
        const inventoryIsUnique = deletedTicket.inventoryNumber
          ? allEquipment.filter(item => item.inventoryNumber === deletedTicket.inventoryNumber).length === 1
          : false;

        const updatedEquipment = allEquipment.map(item => {
          const matches =
            (deletedTicket.equipmentId && item.id === deletedTicket.equipmentId)
            || (deletedTicket.serialNumber && item.serialNumber === deletedTicket.serialNumber)
            || (deletedTicket.inventoryNumber && inventoryIsUnique && item.inventoryNumber === deletedTicket.inventoryNumber);

          if (!matches) return item;

          const hasRemainingOpen = allTickets.some(existing =>
            openStatuses.includes(existing.status)
            && (
              (deletedTicket.equipmentId && existing.equipmentId === deletedTicket.equipmentId)
              || (deletedTicket.serialNumber && existing.serialNumber === deletedTicket.serialNumber)
              || (deletedTicket.inventoryNumber && inventoryIsUnique && existing.inventoryNumber === deletedTicket.inventoryNumber)
            ),
          );

          const activeRental = allGanttRentals
            .filter(rental =>
              (
                (deletedTicket.equipmentId && rental.equipmentId === deletedTicket.equipmentId)
                || (!rental.equipmentId && deletedTicket.inventoryNumber && inventoryIsUnique && rental.equipmentInv === deletedTicket.inventoryNumber)
              )
              && rental.status !== 'returned'
              && rental.status !== 'closed',
            )
            .sort((a, b) => a.startDate.localeCompare(b.startDate))[0];

          const nextStatus: EquipmentStatus = hasRemainingOpen
            ? 'in_service'
            : activeRental
              ? (activeRental.status === 'active' ? 'rented' : 'reserved')
              : 'available';

          return {
            ...item,
            status: nextStatus,
            currentClient: activeRental?.client,
            returnDate: activeRental?.endDate,
          };
        });

        await equipmentService.bulkReplace(updatedEquipment);
      }

      await Promise.all([
        queryClient.invalidateQueries({ queryKey: SERVICE_TICKET_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: EQUIPMENT_KEYS.all }),
        queryClient.invalidateQueries({ queryKey: RENTAL_KEYS.gantt }),
      ]);

      navigate('/service');
    } catch {
      setDeleteError('Не удалось удалить сервисную заявку. Попробуйте ещё раз.');
      setConfirmDelete(false);
    }
  }, [canDeleteService, navigate, queryClient, ticket]);

  const addWorkPerformed = async () => {
    if (!ticket || !canEditTicketFields || !selectedWorkId) return;
    const work = workCatalog.find(item => item.id === selectedWorkId);
    const qty = Number(selectedWorkQty);
    if (!work || !Number.isFinite(qty) || qty <= 0) {
      setRepairFormError('Для работы укажите количество больше 0');
      return;
    }

    await repairWorkItemsService.add({ repairId: ticket.id, workId: work.id, quantity: qty });
    persist({
      ...ticket,
      workLog: [...ticket.workLog, {
        date: new Date().toISOString(),
        text: `Добавлена работа: ${work.name} × ${qty}`,
        author: user?.name || 'Оператор',
        type: 'repair_result',
      }],
    });
    await queryClient.invalidateQueries({ queryKey: ['repairWorkItems', ticket.id] });
    await queryClient.invalidateQueries({ queryKey: ['reports', 'mechanicsWorkload'] });
    setSelectedWorkId('');
    setSelectedWorkQty('1');
    setRepairFormError(null);
  };

  const removeWorkPerformed = async (item: RepairWorkItem, name: string) => {
    if (!ticket || !canEditTicketFields) return;
    await repairWorkItemsService.remove(item.id);
    persist({
      ...ticket,
      workLog: [...ticket.workLog, {
        date: new Date().toISOString(),
        text: `Удалена работа: ${name}`,
        author: user?.name || 'Оператор',
        type: 'repair_result',
      }],
    });
    await queryClient.invalidateQueries({ queryKey: ['repairWorkItems', ticket.id] });
    await queryClient.invalidateQueries({ queryKey: ['reports', 'mechanicsWorkload'] });
  };

  const addPartUsage = async () => {
    if (!ticket || !canEditTicketFields || !selectedPartId) return;
    const part = sparePartsCatalog.find(item => item.id === selectedPartId);
    const qty = Number(selectedPartQty);
    const cost = Number(selectedPartCost);
    if (!part || !Number.isFinite(qty) || qty <= 0) {
      setRepairFormError('Для запчасти укажите количество больше 0');
      return;
    }
    if (!Number.isFinite(cost) || cost < 0) {
      setRepairFormError('Цена запчасти должна быть числом не меньше 0');
      return;
    }

    await repairPartItemsService.add({ repairId: ticket.id, partId: part.id, quantity: qty, priceSnapshot: cost });
    persist({
      ...ticket,
      workLog: [...ticket.workLog, {
        date: new Date().toISOString(),
        text: `Добавлена запчасть: ${part.name} × ${qty}`,
        author: user?.name || 'Оператор',
        type: 'repair_result',
      }],
    });
    await queryClient.invalidateQueries({ queryKey: ['repairPartItems', ticket.id] });
    await queryClient.invalidateQueries({ queryKey: ['reports', 'mechanicsWorkload'] });
    setSelectedPartId('');
    setSelectedPartQty('1');
    setSelectedPartCost('');
    setRepairFormError(null);
  };

  const removePartUsage = async (item: RepairPartItem, name: string) => {
    if (!ticket || !canEditTicketFields) return;
    await repairPartItemsService.remove(item.id);
    persist({
      ...ticket,
      workLog: [...ticket.workLog, {
        date: new Date().toISOString(),
        text: `Удалена запчасть: ${name}`,
        author: user?.name || 'Оператор',
        type: 'repair_result',
      }],
    });
    await queryClient.invalidateQueries({ queryKey: ['repairPartItems', ticket.id] });
    await queryClient.invalidateQueries({ queryKey: ['reports', 'mechanicsWorkload'] });
  };

  const handleGenerateWorkOrder = useCallback(async () => {
    if (!ticket || !canCreateDocuments) return;

    setWorkOrderBusy(true);
    setWorkOrderError(null);

    try {
      const existingOrdersCount = documents.filter(
        (doc) => doc.type === 'work_order' && doc.serviceTicket === ticket.id,
      ).length;
      const generatedDocument = buildServiceWorkOrderDocumentData(
        ticket,
        currentEquipment,
        repairWorkItems,
        repairPartItems,
        existingOrdersCount,
      );
      const nextDocument = relatedWorkOrder
        ? {
            ...generatedDocument,
            number: relatedWorkOrder.number,
            date: relatedWorkOrder.date,
            status: relatedWorkOrder.status,
          }
        : generatedDocument;
      const contentHtml = buildServiceWorkOrderHtml({
        document: nextDocument,
        ticket,
        equipment: currentEquipment,
        workItems: repairWorkItems,
        partItems: repairPartItems,
      });

      if (relatedWorkOrder) {
        await documentsService.update(relatedWorkOrder.id, {
          ...nextDocument,
          contentHtml,
        });
      } else {
        await documentsService.create({
          ...nextDocument,
          contentHtml,
        });
      }

      await queryClient.invalidateQueries({ queryKey: DOCUMENT_KEYS.all });
      openPrintableHtml(contentHtml);
    } catch {
      setWorkOrderError('Не удалось сформировать заказ-наряд. Попробуйте ещё раз.');
    } finally {
      setWorkOrderBusy(false);
    }
  }, [
    canCreateDocuments,
    currentEquipment,
    documents,
    queryClient,
    relatedWorkOrder,
    repairPartItems,
    repairWorkItems,
    ticket,
  ]);

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

  const canEditTicketFields = canEdit && (ticket.status !== 'closed' || isAdmin);
  const canChangeTicketStatus = canEdit && ticket.status !== 'closed';
  const quickActions = buildServiceQuickActions({
    ticket: {
      ...ticket,
      equipmentId: ticket.equipmentId || currentEquipment?.id,
    },
    can,
    canEditTicketFields,
    hasWorkScenario: scenarioIsRepair && workCatalog.length > 0,
    hasPartScenario: scenarioIsRepair && sparePartsCatalog.length > 0,
  });
  const scrollToRepairResult = () => {
    document.getElementById('service-repair-result')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };

  // ── action buttons based on status (only for users with edit permission) ──

  const actions: React.ReactNode[] = [];

  if (canChangeTicketStatus && ticket.status === 'new') {
    actions.push(
      <Button key="start" className="w-full sm:w-auto" onClick={() => changeStatus('in_progress', scenarioIsRepair ? 'Заявка взята в работу' : `${serviceScenarioLabel} взято в работу`)}>
        <Play className="h-4 w-4" />
        {scenarioIsRepair ? 'Взять в работу' : 'Начать выполнение'}
      </Button>
    );
  }
  if (canChangeTicketStatus && ticket.status === 'in_progress' && scenarioIsRepair) {
    actions.push(
      <Button key="parts" variant="secondary" className="w-full sm:w-auto" onClick={() => changeStatus('waiting_parts', 'Заявка переведена в статус «Ожидание запчастей»')}>
        <Package className="h-4 w-4" />
        Ожидание запчастей
      </Button>
    );
  }
  if (canChangeTicketStatus && ticket.status === 'in_progress') {
    actions.push(
      <Button key="ready" className="w-full sm:w-auto" onClick={() => changeStatus('ready', scenarioIsRepair ? 'Работы завершены, заявка готова к закрытию' : `${serviceScenarioLabel} выполнено, запись готова к закрытию`)}>
        <CheckCircle className="h-4 w-4" />
        {scenarioIsRepair ? 'Работы завершены' : 'Обслуживание выполнено'}
      </Button>
    );
  }
  if (canChangeTicketStatus && ticket.status === 'waiting_parts' && scenarioIsRepair) {
    actions.push(
      <Button key="resume" variant="secondary" className="w-full sm:w-auto" onClick={() => changeStatus('in_progress', 'Запчасти получены, возобновлена работа')}>
        <Play className="h-4 w-4" />
        Запчасти получены
      </Button>
    );
  }
  if (canChangeTicketStatus && ticket.status === 'ready') {
    actions.push(
      <Button key="close" className="w-full sm:w-auto" onClick={() => changeStatus('closed', scenarioIsRepair ? 'Заявка закрыта' : `${serviceScenarioLabel} зафиксировано и закрыто`)}>
        <CheckCircle className="h-4 w-4" />
        {scenarioIsRepair ? 'Закрыть заявку' : 'Закрыть запись'}
      </Button>
    );
  }
  if (canChangeTicketStatus) {
    actions.push(
      <Button key="cancel" variant="secondary" className="w-full sm:w-auto border-red-200 text-red-600 hover:bg-red-50"
        onClick={() => changeStatus('closed', 'Заявка отменена / закрыта без выполнения')}>
        <XCircle className="h-4 w-4" />
        Отменить
      </Button>
    );
  }
  if (canDeleteService) {
    if (confirmDelete) {
      actions.push(
        <div key="delete-confirm" className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
          <span className="text-xs text-red-500">Удалить заявку безвозвратно?</span>
          <Button
            variant="destructive"
            className="w-full sm:w-auto"
            onClick={() => { void handleDeleteTicket(); }}
          >
            <Trash2 className="h-4 w-4" />
            Да, удалить
          </Button>
          <Button
            variant="ghost"
            className="w-full sm:w-auto"
            onClick={() => setConfirmDelete(false)}
          >
            Отмена
          </Button>
        </div>,
      );
    } else {
      actions.push(
        <Button
          key="delete"
          variant="ghost"
          className="w-full text-red-600 hover:bg-red-50 hover:text-red-700 sm:w-auto"
          onClick={() => setConfirmDelete(true)}
        >
          <Trash2 className="h-4 w-4" />
          Удалить заявку
        </Button>,
      );
    }
  }
  if (canCreateDocuments) {
    actions.unshift(
      <Button
        key="work-order"
        variant="secondary"
        className="w-full sm:w-auto"
        onClick={() => { void handleGenerateWorkOrder(); }}
        disabled={workOrderBusy}
      >
        <FileText className="h-4 w-4" />
        {workOrderBusy
          ? 'Формирование...'
          : relatedWorkOrder
            ? `Заказ-наряд ${relatedWorkOrder.number}`
            : 'Сформировать заказ-наряд'}
      </Button>,
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
    <div className="space-y-4 p-4 pb-24 sm:space-y-6 sm:p-6 sm:pb-6 md:p-8">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <div className="flex items-start gap-3">
          <Button variant="secondary" size="sm" onClick={() => navigate('/service')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900 dark:text-white sm:text-2xl">{ticket.id}</h1>
              <StatusBadge status={ticket.status} />
              <PriorityBadge priority={ticket.priority} />
            </div>
            <p className="mt-0.5 text-sm text-gray-500 dark:text-gray-400 truncate max-w-[280px] sm:max-w-none">{ticket.equipment}</p>
          </div>
        </div>
        {/* Action buttons */}
        {actions.length > 0 && (
          <div className="hidden sm:flex sm:flex-row sm:flex-wrap gap-2">
            {actions}
          </div>
        )}
      </div>
      {deleteError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          {deleteError}
        </div>
      )}
      {workOrderError && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700 dark:border-red-900/40 dark:bg-red-950/40 dark:text-red-300">
          {workOrderError}
        </div>
      )}
      {isAdmin && ticket.status === 'closed' && (
        <div className="rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-sm text-blue-700 dark:border-blue-900/40 dark:bg-blue-950/40 dark:text-blue-300">
          Закрытая заявка открыта в режиме редактирования администратора.
        </div>
      )}

      {quickActions.length > 0 && (
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Быстрые действия</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-2">
              {quickActions.map(action => {
                if (action.id === 'service-add-work' || action.id === 'service-add-part') {
                  return (
                    <Button
                      key={action.id}
                      size="sm"
                      variant={action.kind === 'primary' ? 'default' : 'secondary'}
                      onClick={scrollToRepairResult}
                    >
                      {action.id === 'service-add-work' ? <Wrench className="h-4 w-4" /> : <Package className="h-4 w-4" />}
                      {action.label}
                    </Button>
                  );
                }
                return action.to ? (
                  <Link key={action.id} to={action.to}>
                    <Button size="sm" variant={action.kind === 'primary' ? 'default' : 'secondary'}>
                      {action.id === 'service-queue' && <History className="h-4 w-4" />}
                      {action.id === 'service-equipment' && <Wrench className="h-4 w-4" />}
                      {action.label}
                    </Button>
                  </Link>
                ) : null;
              })}
            </div>
          </CardContent>
        </Card>
      )}

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
              <Field label="Сценарий" value={serviceScenarioLabel} />
              <Field label="Статус" value={STATUS_LABELS[ticket.status]} />
                <Field label="Приоритет" value={PRIORITY_LABELS[ticket.priority] ?? ticket.priority} />
                <Field label="SLA" value={ticket.sla} />
                <Field label="Дата создания" value={formatServiceDate(ticket.createdAt)} />
                {ticket.plannedDate && <Field label="Плановая дата" value={formatServiceDate(ticket.plannedDate)} />}
                {ticket.closedAt && <Field label="Фактическое закрытие" value={formatServiceDate(ticket.closedAt)} />}
                <Field label="Источник" value={ticket.source ? SOURCE_LABELS[ticket.source] : undefined} />
                <Field label="Кто создал" value={ticket.createdByUserName ?? ticket.createdBy} />
                <Field label="Контактное лицо" value={ticket.reporterContact} />
                <Field label="Заказ-наряд" value={relatedWorkOrder?.number} />
              </div>
            </CardContent>
          </Card>

          {/* Equipment block */}
          <Card id="service-repair-result" className="scroll-mt-24">
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
                <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">
                  {scenarioIsRepair ? 'Причина обращения' : 'Сценарий обслуживания'}
                </p>
                <p className="text-sm font-medium text-gray-900 dark:text-white">{ticket.reason}</p>
              </div>
              {ticket.description && ticket.description !== ticket.reason && (
                <>
                  <Divider />
                  <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">
                      {scenarioIsRepair ? 'Описание неисправности' : 'Описание выполненных работ'}
                    </p>
                    <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">{ticket.description}</p>
                  </div>
                </>
              )}
              {repairResult && (repairResult.summary || repairResult.worksPerformed.length > 0 || repairResult.partsUsed.length > 0) && (
                <>
                  <Divider />
                  <div className="space-y-4">
                    <div>
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-0.5">
                        {scenarioIsRepair ? 'Результат работ' : 'Результат обслуживания'}
                      </p>
                      <p className="text-sm text-gray-700 dark:text-gray-300 whitespace-pre-wrap">
                        {repairResult.summary || (scenarioIsRepair ? 'Результат в текстовом виде не указан' : 'Описание выполненного обслуживания не указано')}
                      </p>
                    </div>
                    {scenarioIsRepair && repairResult.worksPerformed.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs text-gray-500 uppercase tracking-wide">Выполненные работы</p>
                        <div className="space-y-2">
                          {repairResult.worksPerformed.map((work, index) => {
                            const item = repairWorkItems[index];
                            return (
                            <div key={item?.id ?? `${work.catalogId}-${index}`} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-gray-900 dark:text-white">{work.name || '—'}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {work.normHours} н/ч × {work.qty} = {work.totalNormHours} н/ч
                                  {work.ratePerHour > 0 && (
                                    <span className="ml-2 font-medium text-gray-700 dark:text-gray-300">
                                      · {work.totalCost.toLocaleString('ru-RU')} ₽
                                    </span>
                                  )}
                                </p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  Моточасы: {typeof work.meterHours === 'number' ? work.meterHours.toLocaleString('ru-RU', { maximumFractionDigits: 2 }) : 'моточасы не указаны'}
                                  {work.createdByUserName ? ` · ${work.createdByUserName}` : ''}
                                  {work.createdAt ? ` · ${formatServiceDate(work.createdAt)}` : ''}
                                  {work.equipmentSnapshot ? ` · ${work.equipmentSnapshot}` : ''}
                                </p>
                              </div>
                              {canEditTicketFields && item && (
                                <button onClick={() => void removeWorkPerformed(item, work.name)} className="text-xs text-red-500 hover:underline">
                                  Удалить
                                </button>
                              )}
                            </div>
                          );})}
                        </div>
                      </div>
                    )}
                    {scenarioIsRepair && repairResult.partsUsed.length > 0 && (
                      <div>
                        <p className="mb-2 text-xs text-gray-500 uppercase tracking-wide">Использованные запчасти</p>
                        <div className="space-y-2">
                          {repairResult.partsUsed.map((part, index) => {
                            const item = repairPartItems[index];
                            return (
                            <div key={item?.id ?? `${part.catalogId ?? part.name}-${index}`} className="flex items-center justify-between rounded-lg border border-gray-200 px-3 py-2 text-sm dark:border-gray-700">
                              <div className="min-w-0 flex-1">
                                <p className="font-medium text-gray-900 dark:text-white">{part.name || '—'}</p>
                                <p className="text-xs text-gray-500 dark:text-gray-400">
                                  {part.sku ? `${part.sku} · ` : ''}{part.qty} {item?.unitSnapshot || 'шт'} × {part.cost.toLocaleString('ru-RU')} ₽
                                  {part.cost > 0 && (
                                    <span className="ml-2 font-medium text-gray-700 dark:text-gray-300">
                                      = {(part.qty * part.cost).toLocaleString('ru-RU')} ₽
                                    </span>
                                  )}
                                </p>
                              </div>
                              {canEditTicketFields && item && (
                                <button onClick={() => void removePartUsage(item, part.name)} className="text-xs text-red-500 hover:underline">
                                  Удалить
                                </button>
                              )}
                            </div>
                          );})}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
              {canEditTicketFields && (
                <>
                  <Divider />
                  <div className="space-y-4">
                    <div className="flex gap-2 items-end">
                      <div className="flex-1">
                        <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                          {scenarioIsRepair ? 'Итог ремонта' : `Итог ${serviceScenarioLabel}`}
                        </label>
                        <textarea
                          className="w-full rounded-md border border-gray-300 dark:border-gray-600 bg-white dark:bg-gray-700 px-3 py-2 text-sm text-gray-900 dark:text-white focus:border-[--color-primary] focus:outline-none focus:ring-1 focus:ring-[--color-primary]"
                          rows={2}
                          value={resultSummary}
                          onChange={e => setResultSummary(e.target.value)}
                          placeholder={scenarioIsRepair ? 'Краткий итог работ и состояние техники после ремонта' : `Краткий итог выполнения сценария ${serviceScenarioLabel}`}
                        />
                      </div>
                      <div className="flex gap-1.5">
                        <Button size="sm" onClick={saveResultSummary}>Сохранить</Button>
                      </div>
                    </div>
                    {repairFormError && (
                      <p className="text-sm text-red-500">{repairFormError}</p>
                    )}
                    {scenarioIsRepair ? (
                    <>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_90px_auto]">
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 uppercase tracking-wide">Добавить работу</label>
                        <SearchableSelect
                          options={workCatalog.map(work => ({
                            value: work.id,
                            label: work.name,
                            meta: `${work.category || 'Без категории'} · ${work.normHours} н/ч`,
                            keywords: [work.category || '', work.description || ''],
                          }))}
                          value={selectedWorkId}
                          onChange={setSelectedWorkId}
                          placeholder="Выберите работу из справочника"
                        />
                      </div>
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 uppercase tracking-wide">Кол-во</label>
                        <Input type="number" min="1" value={selectedWorkQty} onChange={e => setSelectedWorkQty(e.target.value)} />
                      </div>
                      <div className="flex items-end">
                        <Button size="sm" variant="secondary" onClick={() => void addWorkPerformed()} disabled={!selectedWorkId}>
                          Добавить работу
                        </Button>
                      </div>
                    </div>
                    <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_90px_120px_auto]">
                      <div>
                        <label className="mb-1 block text-xs text-gray-500 uppercase tracking-wide">Добавить запчасть</label>
                        <SearchableSelect
                          options={sparePartsCatalog.map(part => ({
                            value: part.id,
                            label: part.name,
                            meta: `${part.article || part.sku || 'Без артикула'} · ${part.defaultPrice.toLocaleString('ru-RU')} ₽/${part.unit}`,
                            keywords: [part.article || '', part.sku || '', part.category || '', part.manufacturer || ''],
                          }))}
                          value={selectedPartId}
                          onChange={nextId => {
                            const part = sparePartsCatalog.find(item => item.id === nextId);
                            setSelectedPartId(nextId);
                            setSelectedPartCost(String(part?.defaultPrice ?? 0));
                          }}
                          placeholder="Выберите запчасть"
                        />
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
                        <Button size="sm" variant="secondary" onClick={() => void addPartUsage()} disabled={!selectedPartId}>
                          Добавить запчасть
                        </Button>
                      </div>
                    </div>
                    </>
                    ) : (
                      <div className="rounded-lg border border-dashed border-gray-200 px-4 py-3 text-sm text-gray-500 dark:border-gray-700 dark:text-gray-400">
                        Для сценария {serviceScenarioLabel} сохраняется итог обслуживания и история, без ремонтных работ и расхода запчастей.
                      </div>
                    )}
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

              {canEditTicketFields && (
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
                {canEditTicketFields && (
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
              {canEditTicketFields && photoPending.length > 0 && (
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
                      {canEditTicketFields && (
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
                  {canEditTicketFields && (
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

          {(repairPhotos.before.length > 0 || repairPhotos.after.length > 0) && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Camera className="h-4 w-4" />
                  Фото ремонта
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <RepairPhotoGroup
                  title="Фото ДО"
                  photos={repairPhotos.before}
                  uploadedAt={repairPhotos.beforeUploadedAt}
                  uploadedBy={repairPhotos.beforeUploadedBy}
                />
                <RepairPhotoGroup
                  title="Фото ПОСЛЕ"
                  photos={repairPhotos.after}
                  uploadedAt={repairPhotos.afterUploadedAt}
                  uploadedBy={repairPhotos.afterUploadedBy}
                />
              </CardContent>
            </Card>
          )}
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
              {canEditTicketFields && (
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

          {/* Служебная машина */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Car className="h-4 w-4" />
                Служебная машина
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {ticket.serviceVehicleId ? (
                (() => {
                  const sv = serviceVehiclesList.find(v => v.id === ticket.serviceVehicleId);
                  return sv ? (
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="text-sm font-medium text-gray-900 dark:text-white">
                          {sv.make} {sv.model}
                        </p>
                        <p className="text-xs text-gray-500 font-mono">{sv.plateNumber}</p>
                      </div>
                      {canEditTicketFields && (
                        <Button variant="outline" size="sm"
                          onClick={() => persist({ ...ticket, serviceVehicleId: null })}
                        >
                          <X className="h-3.5 w-3.5" />
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-sm text-gray-500">ID: {ticket.serviceVehicleId}</p>
                  );
                })()
              ) : (
                <p className="text-sm text-gray-400">Машина не назначена</p>
              )}
              {canEditTicketFields && (
                <>
                  <Divider />
                  <div className="flex gap-2 items-end">
                    <div className="flex-1">
                      <label className="block text-xs text-gray-500 uppercase tracking-wide mb-1">
                        Назначить машину
                      </label>
                      <select
                        defaultValue=""
                        onChange={e => {
                          if (e.target.value) {
                            persist({ ...ticket, serviceVehicleId: e.target.value });
                            e.target.value = '';
                          }
                        }}
                        className="h-10 w-full rounded-md border border-gray-300 bg-white px-3 text-sm dark:border-gray-600 dark:bg-gray-700 dark:text-white"
                      >
                        <option value="">Выбрать служебную машину…</option>
                        {serviceVehiclesList
                          .filter(v => v.status === 'active' || v.status === 'reserve')
                          .map(v => (
                            <option key={v.id} value={v.id}>
                              {v.make} {v.model} · {v.plateNumber}
                            </option>
                          ))}
                      </select>
                    </div>
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
              <Field label="Дата создания" value={formatServiceDate(ticket.createdAt)} />
              {ticket.plannedDate
                ? <Field label="Плановая дата" value={formatServiceDate(ticket.plannedDate)} />
                : canEditTicketFields && (
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
              {ticket.closedAt && <Field label="Фактически закрыта" value={formatServiceDate(ticket.closedAt)} />}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <CheckCircle className="h-4 w-4" />
                Чек-лист закрытия
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {closeChecklistEntries.map(item => (
                <div
                  key={item.key}
                  className={`flex items-center justify-between rounded-lg border px-3 py-2 text-sm ${
                    item.done
                      ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300'
                      : 'border-gray-200 bg-gray-50 text-gray-600 dark:border-gray-700 dark:bg-gray-800 dark:text-gray-300'
                  }`}
                >
                  <span>{item.label}</span>
                  <Badge variant={item.done ? 'success' : 'default'}>{item.done ? 'OK' : 'Не заполнено'}</Badge>
                </div>
              ))}
              <p className="pt-1 text-xs text-gray-400 dark:text-gray-500">
                Чек-лист собирается из данных бота и фактически внесённых работ, запчастей, фото и итога ремонта.
              </p>
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
      {canChangeTicketStatus && (
        <div className="fixed inset-x-0 bottom-16 z-10 border-t border-gray-200 bg-white/95 p-3 shadow-lg backdrop-blur dark:border-gray-700 dark:bg-gray-900/95 sm:hidden">
          <div className="grid grid-cols-2 gap-2">
            {ticket.status === 'new' && (
              <Button onClick={() => changeStatus('in_progress', scenarioIsRepair ? 'Заявка взята в работу' : `${serviceScenarioLabel} взято в работу`)}>
                <Play className="h-4 w-4" />
                {scenarioIsRepair ? 'В работу' : 'Начать'}
              </Button>
            )}
            {ticket.status === 'in_progress' && (
              <Button onClick={() => changeStatus('ready', scenarioIsRepair ? 'Работы завершены, заявка готова к закрытию' : `${serviceScenarioLabel} выполнено, запись готова к закрытию`)}>
                <CheckCircle className="h-4 w-4" />
                {scenarioIsRepair ? 'Готово' : 'Выполнено'}
              </Button>
            )}
            {ticket.status === 'in_progress' && scenarioIsRepair && (
              <Button
                variant="secondary"
                onClick={() => changeStatus('waiting_parts', 'Заявка переведена в статус «Ожидание запчастей»')}
              >
                <Package className="h-4 w-4" />
                Ждёт З/Ч
              </Button>
            )}
            {ticket.status === 'waiting_parts' && scenarioIsRepair && (
              <Button
                variant="secondary"
                onClick={() => changeStatus('in_progress', 'Запчасти получены, возобновлена работа')}
              >
                <Play className="h-4 w-4" />
                З/Ч пришли
              </Button>
            )}
            {ticket.status === 'ready' && (
              <Button onClick={() => changeStatus('closed', scenarioIsRepair ? 'Заявка закрыта' : `${serviceScenarioLabel} зафиксировано и закрыто`)}>
                <CheckCircle className="h-4 w-4" />
                Закрыть
              </Button>
            )}
            {canChangeTicketStatus && (
              <Button
                variant="secondary"
                className="border-red-200 text-red-600 hover:bg-red-50"
                onClick={() => changeStatus('closed', 'Заявка отменена / закрыта без выполнения')}
              >
                <XCircle className="h-4 w-4" />
                Отменить
              </Button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
