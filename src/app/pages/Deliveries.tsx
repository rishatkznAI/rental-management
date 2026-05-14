import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'react-router-dom';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import {
  AlertTriangle,
  CalendarDays,
  CircleCheck,
  Clock3,
  FileText,
  MoreHorizontal,
  Navigation,
  Phone,
  Plus,
  RefreshCw,
  Route,
  Search,
  Truck,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetFooter, SheetHeader, SheetTitle } from '../components/ui/sheet';
import { deliveriesService } from '../services/deliveries.service';
import { rentalsService } from '../services/rentals.service';
import { equipmentService } from '../services/equipment.service';
import { clientsService } from '../services/clients.service';
import type {
  Client,
  Delivery,
  DeliveryCarrier,
  DeliveryStatus,
  DeliveryType,
  Equipment,
  Rental,
} from '../types';
import type { GanttRentalData } from '../mock-data';
import { usePermissions } from '../lib/permissions';
import { useAuth } from '../contexts/AuthContext';
import { normalizeUserRole } from '../lib/userStorage';
import { chooseBestGanttRentalEntry, getGanttRentalSourceId } from '../lib/rentalPlannerRows.js';
import {
  ACTIVE_DELIVERY_STATUSES,
  CLOSED_DELIVERY_STATUSES,
  filterDeliveriesForView,
  getDeliveryEmptyState,
  getDeliveryErrorMessage,
  isDeliveryInPeriod,
  isDeliveryOverdue,
  isDeliveryToday,
  isUnassignedDelivery,
  normalizeDeliveriesResponse,
  todayIso,
} from '../lib/deliveries-view.js';

const DELIVERY_KEYS = {
  all: ['deliveries'] as const,
  carriers: ['delivery-carriers'] as const,
};

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  new: 'Новая',
  sent: 'Отправлена',
  accepted: 'Принята',
  in_transit: 'В пути',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

const STATUS_CLASSES: Record<DeliveryStatus, string> = {
  new: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  accepted: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  in_transit: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

const TYPE_CLASSES: Record<DeliveryType, string> = {
  shipping: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  receiving: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

const OPERATIONAL_STATUS_CLASSES = {
  inTransit: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  planned: 'bg-amber-100 text-amber-800 dark:bg-amber-950/40 dark:text-amber-200',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  overdue: 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300',
  unassigned: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-950/40 dark:text-yellow-200',
  cancelled: 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300',
};

type DeliveryFormState = {
  type: DeliveryType;
  transportDate: string;
  pickupTime: string;
  neededBy: string;
  origin: string;
  destination: string;
  cargo: string;
  contactName: string;
  contactPhone: string;
  cost: string;
  comment: string;
  client: string;
  clientId: string;
  manager: string;
  carrierKey: string;
  ganttRentalId: string;
  classicRentalId: string;
  equipmentId: string;
  equipmentInv: string;
  equipmentLabel: string;
  status: DeliveryStatus;
};

type RentalOption = {
  ganttRentalId: string;
  classicRentalId: string;
  client: string;
  clientId: string;
  manager: string;
  equipmentId: string;
  equipmentInv: string;
  equipmentLabel: string;
  startDate: string;
  endDate: string;
  shippingFrom: string;
  shippingTo: string;
  receivingFrom: string;
  receivingTo: string;
  contactName: string;
  contactPhone: string;
};

type DeliveryWorkspaceTab = 'all' | 'active' | 'in_transit' | 'planned' | 'completed' | 'overdue' | 'cancelled';
type DeliveryViewMode = 'list' | 'compact';
type DeliveryDetailTab = 'overview' | 'route' | 'equipment' | 'documents' | 'history';
type DeliveryPeriodFilter = 'today' | 'tomorrow' | 'week' | 'all';
type DeliveryStatusFilter = '' | 'in_transit' | 'planned' | 'completed' | 'overdue' | 'unassigned' | 'cancelled';

function getDeliveryStatusMeta(delivery: Delivery, todayKey = todayIso()) {
  if (delivery.status === 'cancelled') return { label: 'Отменена', className: OPERATIONAL_STATUS_CLASSES.cancelled };
  if (delivery.status === 'completed') return { label: 'Завершена', className: OPERATIONAL_STATUS_CLASSES.completed };
  if (isDeliveryOverdue(delivery, todayKey)) return { label: 'Просрочена', className: OPERATIONAL_STATUS_CLASSES.overdue };
  if (isUnassignedDelivery(delivery)) return { label: 'Ожидает назначения', className: OPERATIONAL_STATUS_CLASSES.unassigned };
  if (delivery.status === 'in_transit') return { label: 'В пути', className: OPERATIONAL_STATUS_CLASSES.inTransit };
  return { label: 'Запланирована', className: OPERATIONAL_STATUS_CLASSES.planned };
}

function makeEmptyForm(managerName = ''): DeliveryFormState {
  const today = todayIso();
  return {
    type: 'shipping',
    transportDate: today,
    pickupTime: '',
    neededBy: today,
    origin: '',
    destination: '',
    cargo: '',
    contactName: '',
    contactPhone: '',
    cost: '',
    comment: '',
    client: '',
    clientId: '',
    manager: managerName,
    carrierKey: '',
    ganttRentalId: '',
    classicRentalId: '',
    equipmentId: '',
    equipmentInv: '',
    equipmentLabel: '',
    status: 'new',
  };
}

function formatDate(date: string) {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleDateString('ru-RU');
  } catch {
    return date;
  }
}

function formatDateTime(date?: string | null) {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleString('ru-RU', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return date;
  }
}

function safeText(value: unknown, fallback = '—') {
  const text = String(value ?? '').trim();
  return text || fallback;
}

function formatDeliveryCost(value: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return '—';
  return `${amount.toLocaleString('ru-RU')} ₽`;
}

function buildFormFromDelivery(delivery: Delivery): DeliveryFormState {
  return {
    type: delivery.type,
    transportDate: delivery.transportDate || todayIso(),
    pickupTime: delivery.pickupTime || '',
    neededBy: delivery.neededBy || delivery.transportDate || todayIso(),
    origin: delivery.origin || '',
    destination: delivery.destination || '',
    cargo: delivery.cargo || '',
    contactName: delivery.contactName || '',
    contactPhone: delivery.contactPhone || '',
    cost: delivery.cost ? String(delivery.cost) : '',
    comment: delivery.comment || '',
    client: delivery.client || '',
    clientId: delivery.clientId || '',
    manager: delivery.manager || '',
    carrierKey: delivery.carrierKey || '',
    ganttRentalId: delivery.ganttRentalId || '',
    classicRentalId: delivery.classicRentalId || '',
    equipmentId: delivery.equipmentId || '',
    equipmentInv: delivery.equipmentInv || '',
    equipmentLabel: delivery.equipmentLabel || '',
    status: delivery.status,
  };
}

function normalizeParam(value: string | null) {
  return String(value || '').trim();
}

function DeliveryDialog({
  open,
  editing,
  title,
  form,
  setForm,
  rentalOptions,
  carriers,
  clients,
  isSaving,
  onClose,
  onSubmit,
}: {
  open: boolean;
  editing: boolean;
  title: string;
  form: DeliveryFormState;
  setForm: React.Dispatch<React.SetStateAction<DeliveryFormState>>;
  rentalOptions: RentalOption[];
  carriers: DeliveryCarrier[];
  clients: Client[];
  isSaving: boolean;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const selectedRental = rentalOptions.find((item) => item.ganttRentalId === form.ganttRentalId);
  const selectableCarriers = carriers.filter((carrier) => carrier.status === 'active');

  useEffect(() => {
    if (editing) return;
    if (!selectedRental) return;
    setForm((prev) => ({
      ...prev,
      client: selectedRental.client,
      clientId: selectedRental.clientId,
      manager: selectedRental.manager || prev.manager,
      classicRentalId: selectedRental.classicRentalId,
      equipmentId: selectedRental.equipmentId,
      equipmentInv: selectedRental.equipmentInv,
      equipmentLabel: selectedRental.equipmentLabel,
      cargo: prev.cargo || `${selectedRental.equipmentLabel} · INV ${selectedRental.equipmentInv}`,
      transportDate: prev.transportDate || (prev.type === 'shipping' ? selectedRental.startDate : selectedRental.endDate),
      neededBy: prev.neededBy || (prev.type === 'shipping' ? selectedRental.startDate : selectedRental.endDate),
      origin: prev.origin || (prev.type === 'shipping' ? selectedRental.shippingFrom : selectedRental.receivingFrom),
      destination: prev.destination || (prev.type === 'shipping' ? selectedRental.shippingTo : selectedRental.receivingTo),
      contactName: prev.contactName || selectedRental.contactName,
      contactPhone: prev.contactPhone || selectedRental.contactPhone,
    }));
  }, [editing, selectedRental, setForm]);

  useEffect(() => {
    if (editing) return;
    if (!selectedRental) return;
    setForm((prev) => ({
      ...prev,
      origin: prev.type === 'shipping' ? selectedRental.shippingFrom : selectedRental.receivingFrom,
      destination: prev.type === 'shipping' ? selectedRental.shippingTo : selectedRental.receivingTo,
      transportDate: prev.type === 'shipping' ? selectedRental.startDate : selectedRental.endDate,
      neededBy: prev.type === 'shipping' ? selectedRental.startDate : selectedRental.endDate,
    }));
  }, [editing, form.type, selectedRental, setForm]);

  return (
    <Sheet open={open} onOpenChange={(nextOpen) => {
      if (!nextOpen) onClose();
    }}>
      <SheetContent
        side="right"
        className="w-full gap-0 overflow-hidden border-gray-200 bg-white sm:max-w-3xl dark:border-gray-700 dark:bg-gray-900"
      >
        <SheetHeader className="border-b border-gray-200 px-6 py-5 pr-12 dark:border-gray-700">
          <SheetTitle className="text-xl text-gray-900 dark:text-white">{title}</SheetTitle>
          <SheetDescription className="text-sm text-gray-500 dark:text-gray-400">
            Доставка связывается с арендой и сразу попадает в планировщик как отгрузка или приёмка.
          </SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Связанная аренда</label>
            <select
              value={form.ganttRentalId}
              onChange={(e) => setForm((prev) => ({ ...prev, ganttRentalId: e.target.value }))}
              className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="">Без привязки к аренде</option>
              {rentalOptions.map((option) => (
                <option key={option.ganttRentalId} value={option.ganttRentalId}>
                  {option.client} · {option.equipmentInv} · {option.startDate} → {option.endDate}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Тип операции</label>
            <select
              value={form.type}
              onChange={(e) => setForm((prev) => ({ ...prev, type: e.target.value as DeliveryType }))}
              className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="shipping">Отгрузка</option>
              <option value="receiving">Приёмка</option>
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Перевозчик</label>
            <select
              value={form.carrierKey}
              onChange={(e) => setForm((prev) => ({ ...prev, carrierKey: e.target.value }))}
              className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="">Выберите перевозчика</option>
              {selectableCarriers.map((carrier) => (
                <option key={carrier.key} value={carrier.key}>
                  {carrier.name}{carrier.maxConnected ? ' · MAX подключён' : ' · без MAX'}
                </option>
              ))}
            </select>
            {selectableCarriers.length === 0 && (
              <p className="mt-1 text-xs text-amber-600 dark:text-amber-300">
                В справочнике нет активных перевозчиков. Добавьте их в «Настройки → Справочники».
              </p>
            )}
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Дата перевозки</label>
            <Input type="date" value={form.transportDate} onChange={(e) => setForm((prev) => ({ ...prev, transportDate: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Время забора техники</label>
            <Input
              type="time"
              placeholder="Например, 09:30"
              value={form.pickupTime}
              onChange={(e) => setForm((prev) => ({ ...prev, pickupTime: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Когда нужно</label>
            <Input type="date" value={form.neededBy} onChange={(e) => setForm((prev) => ({ ...prev, neededBy: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Клиент</label>
            <select
              value={form.clientId || form.client}
              onChange={(e) => {
                const selected = clients.find((item) => item.id === e.target.value || item.company === e.target.value);
                setForm((prev) => ({
                  ...prev,
                  client: selected?.company || e.target.value,
                  clientId: selected?.id || '',
                  contactName: prev.contactName || selected?.contact || '',
                  contactPhone: prev.contactPhone || selected?.phone || '',
                }));
              }}
              className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              <option value="">Выберите клиента</option>
              {clients.map((client) => (
                <option key={client.id} value={client.id}>
                  {client.company}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Ответственный менеджер</label>
            <Input value={form.manager} onChange={(e) => setForm((prev) => ({ ...prev, manager: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Откуда</label>
            <Input value={form.origin} onChange={(e) => setForm((prev) => ({ ...prev, origin: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Куда</label>
            <Input value={form.destination} onChange={(e) => setForm((prev) => ({ ...prev, destination: e.target.value }))} />
          </div>

          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Что перевозим</label>
            <Input value={form.cargo} onChange={(e) => setForm((prev) => ({ ...prev, cargo: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Контактное лицо</label>
            <Input value={form.contactName} onChange={(e) => setForm((prev) => ({ ...prev, contactName: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Контактный номер</label>
            <Input value={form.contactPhone} onChange={(e) => setForm((prev) => ({ ...prev, contactPhone: e.target.value }))} />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Стоимость перевозки</label>
            <Input
              type="number"
              min="0"
              value={form.cost}
              onChange={(e) => setForm((prev) => ({ ...prev, cost: e.target.value }))}
            />
          </div>

          <div>
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Статус</label>
            <select
              value={form.status}
              onChange={(e) => setForm((prev) => ({ ...prev, status: e.target.value as DeliveryStatus }))}
              className="h-11 w-full rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-300">Комментарий</label>
            <textarea
              value={form.comment}
              onChange={(e) => setForm((prev) => ({ ...prev, comment: e.target.value }))}
              rows={3}
              className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
            />
          </div>
          </div>
        </div>

        <SheetFooter className="border-t border-gray-200 bg-white px-6 py-4 sm:flex-row sm:items-center sm:justify-end dark:border-gray-700 dark:bg-gray-900">
          <Button variant="secondary" onClick={onClose}>Отмена</Button>
          <Button onClick={onSubmit} disabled={isSaving}>
            {isSaving ? 'Сохраняю…' : 'Сохранить доставку'}
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}

export default function Deliveries() {
  const { user } = useAuth();
  const { can } = usePermissions();
  const location = useLocation();
  const queryClient = useQueryClient();
  const canCreate = can('create', 'deliveries');
  const canEdit = can('edit', 'deliveries');
  const canDelete = can('delete', 'deliveries');
  const canCreateDocuments = can('create', 'documents');
  const normalizedRole = normalizeUserRole(user?.role);
  const isCarrierView = normalizedRole === 'Перевозчик';
  const canManageDeliveries = canCreate || canEdit || canDelete;
  const deliveryListQueryKey = useMemo(
    () => [...DELIVERY_KEYS.all, normalizedRole, user?.id || 'anonymous'] as const,
    [normalizedRole, user?.id],
  );

  const { data: deliveriesResponse = [], isLoading, isError, error, refetch } = useQuery({
    queryKey: deliveryListQueryKey,
    queryFn: deliveriesService.getAll,
  });
  const deliveries = useMemo(
    () => normalizeDeliveriesResponse(deliveriesResponse) as Delivery[],
    [deliveriesResponse],
  );
  const { data: carriers = [] } = useQuery({
    queryKey: DELIVERY_KEYS.carriers,
    queryFn: deliveriesService.getCarriers,
    enabled: canManageDeliveries,
  });
  const { data: ganttRentals = [] } = useQuery({
    queryKey: ['gantt-rentals-deliveries'],
    queryFn: rentalsService.getGanttData,
    enabled: canManageDeliveries,
  });
  const { data: classicRentals = [] } = useQuery({
    queryKey: ['classic-rentals-deliveries'],
    queryFn: rentalsService.getAll,
    enabled: canManageDeliveries,
  });
  const { data: equipment = [] } = useQuery({
    queryKey: ['equipment-deliveries'],
    queryFn: equipmentService.getAll,
    enabled: canManageDeliveries,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ['clients-deliveries'],
    queryFn: clientsService.getAll,
    enabled: canManageDeliveries,
  });

  const [search, setSearch] = useState('');
  const [periodFilter, setPeriodFilter] = useState<DeliveryPeriodFilter>('all');
  const [statusFilter, setStatusFilter] = useState<DeliveryStatusFilter>('');
  const [typeFilter, setTypeFilter] = useState<DeliveryType | ''>('');
  const [carrierFilter, setCarrierFilter] = useState('');
  const [activeTab, setActiveTab] = useState<DeliveryWorkspaceTab>('all');
  const [viewMode, setViewMode] = useState<DeliveryViewMode>('list');
  const [actionsOpen, setActionsOpen] = useState(false);
  const [selectedDeliveryId, setSelectedDeliveryId] = useState<string | null>(null);
  const [detailTab, setDetailTab] = useState<DeliveryDetailTab>('overview');
  const [autoOpenKey, setAutoOpenKey] = useState('');
  const [isDesktopDetail, setIsDesktopDetail] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<DeliveryFormState>(makeEmptyForm(user?.name || ''));

  const rentalOptions = useMemo<RentalOption[]>(() => {
    const equipmentById = new Map(equipment.map((item) => [item.id, item]));
    const classicMatchByGantt = new Map<string, Rental>();
    const classicById = new Map((classicRentals as Rental[]).map((item) => [String(item.id || ''), item]));

    for (const gantt of ganttRentals as GanttRentalData[]) {
      const sourceId = getGanttRentalSourceId(gantt);
      const classic = (sourceId && classicById.get(sourceId)) || (classicRentals as Rental[]).find((item) =>
        item.client === gantt.client &&
        Array.isArray(item.equipment) &&
        item.equipment.includes(gantt.equipmentInv) &&
        item.startDate === gantt.startDate,
      );
      if (classic) classicMatchByGantt.set(gantt.id, classic);
    }

    const groupedRentals = new Map<string, GanttRentalData[]>();
    for (const item of ganttRentals as GanttRentalData[]) {
      if (item.status === 'closed') continue;
      const key = getGanttRentalSourceId(item) || item.id;
      if (!key) continue;
      if (!groupedRentals.has(key)) groupedRentals.set(key, []);
      groupedRentals.get(key)?.push(item);
    }

    return Array.from(groupedRentals.values())
      .map(entries => chooseBestGanttRentalEntry(entries, { todayKey: todayIso() }))
      .filter(Boolean)
      .filter((item) => item.status !== 'closed')
      .map((item) => {
        const classic = classicMatchByGantt.get(item.id);
        const client = (clients as Client[]).find((entry) => entry.company === item.client);
        const eq = equipmentById.get(item.equipmentId || '') || (equipment as Equipment[]).find((entry) => entry.inventoryNumber === item.equipmentInv);
        const equipmentLabel = eq ? `${eq.manufacturer} ${eq.model}` : item.equipmentInv;
        return {
          ganttRentalId: item.id,
          classicRentalId: getGanttRentalSourceId(item) || classic?.id || '',
          client: item.client || classic?.client || '',
          clientId: item.clientId || classic?.clientId || client?.id || '',
          manager: item.manager || classic?.manager || '',
          equipmentId: eq?.id || item.equipmentId || '',
          equipmentInv: item.equipmentInv || eq?.inventoryNumber || '',
          equipmentLabel,
          startDate: item.startDate || classic?.startDate || '',
          endDate: item.endDate || classic?.plannedReturnDate || '',
          shippingFrom: eq?.location || 'Склад',
          shippingTo: classic?.deliveryAddress || client?.address || item.client || '',
          receivingFrom: classic?.deliveryAddress || client?.address || item.client || '',
          receivingTo: eq?.location || 'Склад/сервис',
          contactName: client?.contact || '',
          contactPhone: client?.phone || '',
        };
      });
  }, [classicRentals, clients, equipment, ganttRentals]);

  const carrierOptions = useMemo(() => {
    return [...new Set(deliveries.map((item) => item.carrierName || item.carrierKey || item.carrierId).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b, 'ru'));
  }, [deliveries]);

  const clientsById = useMemo(() => new Map((clients as Client[]).map((item) => [item.id, item])), [clients]);
  const clientsByName = useMemo(() => {
    const map = new Map<string, Client>();
    for (const client of clients as Client[]) {
      const key = client.company?.trim().toLowerCase();
      if (key && !map.has(key)) map.set(key, client);
    }
    return map;
  }, [clients]);

  const todayKey = todayIso();

  const filtered = useMemo(
    () => filterDeliveriesForView(deliveries, {
      activeTab,
      carrierFilter,
      periodFilter,
      search,
      statusFilter,
      typeFilter,
    }, todayKey) as Delivery[],
    [activeTab, carrierFilter, deliveries, periodFilter, search, statusFilter, todayKey, typeFilter],
  );

  const kpis = useMemo(() => ({
    total: deliveries.length,
    active: deliveries.filter((item) => ACTIVE_DELIVERY_STATUSES.includes(item.status)).length,
    needInvoice: deliveries.filter((item) => item.status === 'completed' && !item.carrierInvoiceReceived).length,
    unpaidByClient: deliveries.filter((item) => item.status === 'completed' && !item.clientPaymentVerified).length,
    sentToCarrier: deliveries.filter((item) => Boolean(item.botSentAt)).length,
    today: deliveries.filter((item) => isDeliveryToday(item, todayKey)).length,
    inTransit: deliveries.filter((item) => item.status === 'in_transit').length,
    completedPeriod: deliveries.filter((item) => item.status === 'completed' && isDeliveryInPeriod(item, periodFilter, todayKey)).length,
    overdue: deliveries.filter((item) => isDeliveryOverdue(item, todayKey)).length,
    unassigned: deliveries.filter((item) => isUnassignedDelivery(item) && !CLOSED_DELIVERY_STATUSES.includes(item.status)).length,
    risks: deliveries.filter((item) => isDeliveryOverdue(item, todayKey) || (isUnassignedDelivery(item) && !CLOSED_DELIVERY_STATUSES.includes(item.status))).length,
  }), [deliveries, periodFilter, todayKey]);
  const kpiCards = isCarrierView
    ? [
        { label: 'Мои активные доставки', value: kpis.total, icon: Truck, tone: 'text-slate-900 dark:text-white', hint: 'Только назначенные вам активные заявки', card: 'border-slate-200 bg-white dark:border-gray-800 dark:bg-gray-900' },
      ]
    : [
        { label: 'Активные', value: kpis.active, icon: Truck, tone: 'text-slate-950 dark:text-white', hint: 'Новые, отправленные, принятые и в пути', card: 'border-blue-200 bg-blue-50/70 dark:border-blue-900/50 dark:bg-blue-950/20' },
        { label: 'Сегодня', value: kpis.today, icon: CalendarDays, tone: 'text-slate-950 dark:text-white', hint: 'Отгрузки и возвраты на сегодня', card: 'border-blue-200 bg-white dark:border-blue-900/50 dark:bg-gray-900' },
        { label: 'В пути', value: kpis.inTransit, icon: Navigation, tone: 'text-blue-700 dark:text-blue-300', hint: 'Перевозчик уже выехал', card: 'border-blue-200 bg-white dark:border-blue-900/50 dark:bg-gray-900' },
        { label: 'Риски', value: kpis.risks, icon: AlertTriangle, tone: 'text-red-700 dark:text-red-300', hint: 'Просрочено или нет перевозчика', card: 'border-red-200 bg-red-50/70 dark:border-red-900/50 dark:bg-red-950/20' },
        { label: 'Выполнено', value: kpis.completedPeriod, icon: CircleCheck, tone: 'text-emerald-700 dark:text-emerald-300', hint: 'Закрытые перевозки за выбранный период', card: 'border-emerald-200 bg-emerald-50/70 dark:border-emerald-900/50 dark:bg-emerald-950/20' },
      ];

  const selectedDelivery = useMemo(
    () => deliveries.find((item) => item.id === selectedDeliveryId) || null,
    [deliveries, selectedDeliveryId],
  );
  const emptyState = useMemo(
    () => getDeliveryEmptyState({ totalCount: deliveries.length, isCarrierView }),
    [deliveries.length, isCarrierView],
  );
  const errorMessage = getDeliveryErrorMessage(error);

  const tabItems = useMemo(() => [
    { id: 'all' as const, label: 'Все доставки', count: deliveries.length },
    { id: 'active' as const, label: 'Активные', count: deliveries.filter((item) => ACTIVE_DELIVERY_STATUSES.includes(item.status)).length },
    { id: 'in_transit' as const, label: 'В пути', count: deliveries.filter((item) => item.status === 'in_transit').length },
    { id: 'planned' as const, label: 'Запланированы', count: deliveries.filter((item) => ['new', 'sent', 'accepted'].includes(item.status)).length },
    { id: 'completed' as const, label: 'Завершённые', count: deliveries.filter((item) => CLOSED_DELIVERY_STATUSES.includes(item.status)).length },
    { id: 'overdue' as const, label: 'Просрочены', count: deliveries.filter((item) => isDeliveryOverdue(item, todayKey)).length },
    { id: 'cancelled' as const, label: 'Отменены', count: deliveries.filter((item) => item.status === 'cancelled').length },
  ], [deliveries, todayKey]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const key = `${location.pathname}?${location.search}`;
    const shouldOpenCreate = location.pathname.endsWith('/new') || params.get('action') === 'create';
    if (!canCreate || dialogOpen || !shouldOpenCreate || autoOpenKey === key) return;
    setAutoOpenKey(key);
    openCreateDialog(params);
  }, [autoOpenKey, canCreate, dialogOpen, location.pathname, location.search, rentalOptions, user?.name]);

  useEffect(() => {
    const media = window.matchMedia('(min-width: 1536px)');
    const update = () => setIsDesktopDetail(media.matches);
    update();
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  function openCreateDialog(params?: URLSearchParams) {
    const requestedType = normalizeParam(params?.get('type'));
    const requestedRentalId = normalizeParam(params?.get('rentalId') || params?.get('classicRentalId'));
    const requestedGanttRentalId = normalizeParam(params?.get('ganttRentalId'));
    const matchedRental = requestedGanttRentalId
      ? rentalOptions.find(option => option.ganttRentalId === requestedGanttRentalId)
      : requestedRentalId
        ? rentalOptions.find(option => option.classicRentalId === requestedRentalId)
        : undefined;
    setEditingDelivery(null);
    setForm({
      ...makeEmptyForm(user?.name || ''),
      type: requestedType === 'receiving' ? 'receiving' : 'shipping',
      ganttRentalId: matchedRental?.ganttRentalId || requestedGanttRentalId,
      classicRentalId: matchedRental?.classicRentalId || requestedRentalId,
      client: matchedRental?.client || '',
      clientId: matchedRental?.clientId || '',
      manager: matchedRental?.manager || user?.name || '',
      equipmentId: matchedRental?.equipmentId || '',
      equipmentInv: matchedRental?.equipmentInv || '',
      equipmentLabel: matchedRental?.equipmentLabel || '',
      cargo: matchedRental ? `${matchedRental.equipmentLabel} · INV ${matchedRental.equipmentInv}` : '',
      transportDate: matchedRental ? (requestedType === 'receiving' ? matchedRental.endDate : matchedRental.startDate) : todayIso(),
      neededBy: matchedRental ? (requestedType === 'receiving' ? matchedRental.endDate : matchedRental.startDate) : todayIso(),
      origin: matchedRental ? (requestedType === 'receiving' ? matchedRental.receivingFrom : matchedRental.shippingFrom) : '',
      destination: matchedRental ? (requestedType === 'receiving' ? matchedRental.receivingTo : matchedRental.shippingTo) : '',
      contactName: matchedRental?.contactName || '',
      contactPhone: matchedRental?.contactPhone || '',
    });
    setDialogOpen(true);
  }

  function openEditDialog(delivery: Delivery) {
    setEditingDelivery(delivery);
    setForm(buildFormFromDelivery(delivery));
    setDialogOpen(true);
  }

  async function invalidateDeliveryContext() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: DELIVERY_KEYS.all }),
      queryClient.invalidateQueries({ queryKey: ['planner'] }),
      queryClient.invalidateQueries({ queryKey: ['rentals'] }),
    ]);
  }

  async function handleSubmit() {
    setIsSaving(true);
    try {
      const payload = {
        type: form.type,
        status: form.status,
        transportDate: form.transportDate,
        pickupTime: form.pickupTime || null,
        neededBy: form.neededBy,
        origin: form.origin,
        destination: form.destination,
        cargo: form.cargo,
        contactName: form.contactName,
        contactPhone: form.contactPhone,
        cost: Number(form.cost) || 0,
        comment: form.comment,
        client: form.client,
        clientId: form.clientId || null,
        manager: form.manager,
        carrierKey: form.carrierKey || null,
        ganttRentalId: form.ganttRentalId || null,
        classicRentalId: form.classicRentalId || null,
        equipmentId: form.equipmentId || null,
        equipmentInv: form.equipmentInv || null,
        equipmentLabel: form.equipmentLabel || null,
      };

      if (editingDelivery) {
        const updated = await deliveriesService.update(editingDelivery.id, payload);
        const sentToCarrierNow = Boolean(updated.botSentAt) &&
          updated.botSentAt !== (editingDelivery.botSentAt || null) &&
          !updated.botSendError;
        if (sentToCarrierNow) {
          toast.success('Доставка обновлена и отправлена перевозчику');
        } else {
          toast.success('Доставка обновлена');
        }
        if (updated.botSendError) {
          toast.warning(`MAX: ${updated.botSendError}`);
        }
      } else {
        const created = await deliveriesService.create(payload);
        if (created.botSentAt) {
          toast.success('Доставка создана и отправлена перевозчику');
        } else {
          toast.success('Доставка создана');
          if (created.botSendError) {
            toast.warning(`MAX: ${created.botSendError}`);
          }
        }
      }

      await invalidateDeliveryContext();
      setDialogOpen(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось сохранить доставку');
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleField(delivery: Delivery, patch: Partial<Delivery>) {
    try {
      await deliveriesService.update(delivery.id, patch);
      await invalidateDeliveryContext();
      toast.success('Доставка обновлена');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось обновить доставку');
    }
  }

  async function resendToCarrier(delivery: Delivery) {
    try {
      const updated = await deliveriesService.resendToCarrier(delivery.id);
      await invalidateDeliveryContext();
      if (updated.botSendError) {
        toast.warning(`MAX: ${updated.botSendError}`);
      } else {
        toast.success('Заявка повторно отправлена перевозчику');
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось отправить перевозчику');
    }
  }

  async function removeDelivery(delivery: Delivery) {
    if (!window.confirm(`Удалить доставку ${delivery.client} · ${delivery.transportDate}?`)) return;
    try {
      await deliveriesService.delete(delivery.id);
      await invalidateDeliveryContext();
      toast.success('Доставка удалена');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Не удалось удалить доставку');
    }
  }

  function resetFilters() {
    setSearch('');
    setPeriodFilter('all');
    setStatusFilter('');
    setTypeFilter('');
    setCarrierFilter('');
    setActiveTab('all');
  }

  async function cancelDelivery(delivery: Delivery) {
    if (!window.confirm(`Отменить доставку ${delivery.id}?`)) return;
    await toggleField(delivery, { status: 'cancelled' });
  }

  async function shareRoute(delivery: Delivery) {
    const text = `${delivery.origin || '—'} → ${delivery.destination || '—'}`;
    try {
      await navigator.clipboard?.writeText(text);
      toast.success('Маршрут скопирован для передачи перевозчику');
    } catch {
      toast.info(text);
    }
  }

  function renderDeliveryPanel(delivery: Delivery, mode: 'aside' | 'sheet') {
    const statusMeta = getDeliveryStatusMeta(delivery, todayKey);
    const client = clientsById.get(delivery.clientId || '') || clientsByName.get(delivery.client?.trim().toLowerCase());
    const clientInn = client?.inn || client?.innNormalized || '';
    const contractLabel = delivery.contractId || delivery.classicRentalId || delivery.ganttRentalId || '';
    const equipmentName = delivery.equipmentLabel || delivery.cargo;
    const inventoryNumber = delivery.equipmentInv || '';
    const driverName = delivery.carrierName || (delivery.carrierPhone ? 'Водитель' : '');
    const canShareGeo = Boolean((delivery.carrierName || delivery.carrierPhone) && delivery.destination);
    const canCancelDelivery = canEdit && !CLOSED_DELIVERY_STATUSES.includes(delivery.status);

    return (
      <>
        {mode === 'sheet' ? (
          <SheetHeader>
            <SheetTitle>Доставка {delivery.id}</SheetTitle>
            <SheetDescription className="space-y-2">
              <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${statusMeta.className}`}>
                {statusMeta.label}
              </span>
              <span className="block">
                {delivery.type === 'shipping' ? 'Доставка техники клиенту' : 'Возврат техники'} · {formatDate(delivery.transportDate)}
              </span>
            </SheetDescription>
          </SheetHeader>
        ) : (
          <div className="relative flex shrink-0 flex-col gap-2 border-b border-slate-100 px-6 py-5 pr-14 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setSelectedDeliveryId(null)}
              className="absolute right-4 top-4 inline-flex size-9 items-center justify-center rounded-xl border border-transparent text-slate-400 transition hover:border-slate-200 hover:bg-slate-50 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500/30 dark:text-gray-500 dark:hover:border-gray-800 dark:hover:bg-gray-900 dark:hover:text-gray-200"
              aria-label="Закрыть панель доставки"
            >
              ×
            </button>
            <h2 className="text-xl font-semibold leading-tight text-slate-950 dark:text-white">Доставка {delivery.id}</h2>
            <div className="space-y-2 text-sm leading-6 text-slate-500 dark:text-gray-400">
              <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-semibold ${statusMeta.className}`}>
                {statusMeta.label}
              </span>
              <span className="block">
                {delivery.type === 'shipping' ? 'Доставка техники клиенту' : 'Возврат техники'} · {formatDate(delivery.transportDate)}
              </span>
            </div>
          </div>
        )}

        <div className="flex gap-1 overflow-x-auto border-b border-gray-100 px-4 py-3 dark:border-gray-800">
          {([
            ['overview', 'Обзор'],
            ['route', 'Маршрут'],
            ['equipment', 'Техника'],
            ['documents', 'Документы'],
            ['history', 'История'],
          ] as Array<[DeliveryDetailTab, string]>).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setDetailTab(id)}
              className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                detailTab === id
                  ? 'bg-blue-600 text-white'
                  : 'text-gray-500 hover:bg-gray-100 hover:text-gray-950 dark:text-gray-400 dark:hover:bg-gray-900 dark:hover:text-white'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {detailTab === 'overview' && (
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2">
                {[
                  ['Тип доставки', delivery.type === 'shipping' ? 'Доставка' : 'Возврат'],
                  ['Клиент', delivery.client],
                  ['ИНН клиента', clientInn],
                  ['Договор', contractLabel],
                  ['Техника', equipmentName],
                  ['Инвентарный номер', inventoryNumber],
                  ['Дата и время', `${formatDate(delivery.transportDate)} · ${delivery.pickupTime || 'время не указано'}`],
                  ['ETA', delivery.neededBy ? formatDate(delivery.neededBy) : '—'],
                  ['Статус', statusMeta.label],
                  ['Водитель', driverName],
                  ['Телефон водителя', delivery.carrierPhone],
                  ['Ответственный', delivery.manager],
                  ['Способ доставки', delivery.type === 'shipping' ? 'Отгрузка клиенту' : 'Приёмка / возврат'],
                  ['Адрес подачи', delivery.origin],
                  ['Адрес доставки', delivery.destination],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900/70">
                    <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
                    <div className="mt-1 break-words text-sm font-semibold text-gray-950 dark:text-white">{safeText(value)}</div>
                  </div>
                ))}
              </div>
              <div className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900/70">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Комментарий</div>
                <p className="mt-1 whitespace-pre-wrap break-words text-sm text-gray-800 dark:text-gray-200">{safeText(delivery.comment)}</p>
              </div>
            </div>
          )}

          {detailTab === 'route' && (
            <div className="space-y-3">
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/70">
                <div className="flex items-start gap-3">
                  <Route className="mt-0.5 h-5 w-5 shrink-0 text-blue-500" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">Подача</div>
                    <div className="mt-1 break-words text-sm font-semibold text-gray-950 dark:text-white">{safeText(delivery.origin)}</div>
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-gray-200 bg-gray-50 p-4 dark:border-gray-800 dark:bg-gray-900/70">
                <div className="flex items-start gap-3">
                  <Route className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold uppercase tracking-[0.14em] text-gray-500 dark:text-gray-400">Доставка</div>
                    <div className="mt-1 break-words text-sm font-semibold text-gray-950 dark:text-white">{safeText(delivery.destination)}</div>
                  </div>
                </div>
              </div>
              <p className="rounded-xl bg-blue-50 px-3 py-2 text-sm text-blue-700 dark:bg-blue-950/30 dark:text-blue-300">
                Адреса можно передать перевозчику через быстрые действия.
              </p>
            </div>
          )}

          {detailTab === 'equipment' && (
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['Груз', delivery.cargo],
                ['Модель', delivery.equipmentLabel],
                ['Инвентарный №', delivery.equipmentInv],
                ['ID техники', delivery.equipmentId],
              ].map(([label, value]) => (
                <div key={label} className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900/70">
                  <div className="text-xs font-medium text-gray-500 dark:text-gray-400">{label}</div>
                  <div className="mt-1 break-words text-sm font-semibold text-gray-950 dark:text-white">{safeText(value)}</div>
                </div>
              ))}
            </div>
          )}

          {detailTab === 'documents' && (
            <div className="space-y-3">
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900/70">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Связанная аренда</div>
                <div className="mt-1 text-sm font-semibold text-gray-950 dark:text-white">{safeText(delivery.classicRentalId || delivery.ganttRentalId)}</div>
              </div>
              <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2.5 dark:border-gray-800 dark:bg-gray-900/70">
                <div className="text-xs font-medium text-gray-500 dark:text-gray-400">Договор / объект</div>
                <div className="mt-1 text-sm font-semibold text-gray-950 dark:text-white">{safeText(delivery.contractId || delivery.objectName || delivery.objectAddress)}</div>
              </div>
              <p className="rounded-xl bg-gray-50 px-3 py-2 text-sm text-gray-600 dark:bg-gray-900 dark:text-gray-300">
                Детальный список документов хранится в разделе «Документы». Здесь показаны только связи, доступные в заявке доставки.
              </p>
            </div>
          )}

          {detailTab === 'history' && (
            <div className="space-y-3">
              {[
                ['Создана', formatDateTime(delivery.createdAt), delivery.createdByName || delivery.createdBy],
                ['Обновлена', formatDateTime(delivery.updatedAt), delivery.manager],
                ['Отправлена в MAX', delivery.botSentAt ? formatDateTime(delivery.botSentAt) : '—', delivery.botSendError || 'Ошибок отправки нет'],
                ['Завершена', delivery.completedAt ? formatDateTime(delivery.completedAt) : '—', statusMeta.label],
              ].map(([title, time, meta]) => (
                <div key={title} className="rounded-xl border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900/70">
                  <div className="text-sm font-semibold text-gray-950 dark:text-white">{title}</div>
                  <div className="mt-1 text-sm text-gray-600 dark:text-gray-300">{time}</div>
                  <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{safeText(meta)}</div>
                </div>
              ))}
            </div>
          )}
        </div>

        <SheetFooter className="gap-2 sm:grid sm:grid-cols-2">
          {canEdit && (
            <Button variant="secondary" onClick={() => openEditDialog(delivery)}>
              Изменить доставку
            </Button>
          )}
          {delivery.carrierPhone && (
            <Button variant="secondary" asChild>
              <a href={`tel:${delivery.carrierPhone}`}>
                <Phone className="h-4 w-4" />
                Связаться с водителем
              </a>
            </Button>
          )}
          {canShareGeo && (
            <Button variant="secondary" onClick={() => shareRoute(delivery)}>
              <Navigation className="h-4 w-4" />
              Передать геопозицию
            </Button>
          )}
          {canCreateDocuments && (
            <Button variant="secondary" asChild>
              <Link to={`/documents?action=create&deliveryId=${encodeURIComponent(delivery.id)}`}>
                <FileText className="h-4 w-4" />
                Создать документ
              </Link>
            </Button>
          )}
          {canCancelDelivery && (
            <Button variant="destructive" onClick={() => cancelDelivery(delivery)}>
              <XCircle className="h-4 w-4" />
              Отменить доставку
            </Button>
          )}
        </SheetFooter>
      </>
    );
  }

  return (
    <div className="space-y-5 p-4 sm:p-6">
      <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-500">Операции</div>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Доставка</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
            Операционный экран отгрузок и возвратов: статусы, перевозчики, срочные действия и связь с MAX без карты и лишней аналитики.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {!isCarrierView && (
            <div className="relative">
              <Button variant="secondary" type="button" onClick={() => setActionsOpen((open) => !open)}>
                <MoreHorizontal className="mr-1.5 h-4 w-4" />
                Ещё действия
              </Button>
              {actionsOpen && (
                <div className="absolute right-0 z-30 mt-2 w-56 rounded-2xl border border-gray-200 bg-white p-2 shadow-xl dark:border-gray-800 dark:bg-gray-950">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-900"
                    onClick={() => {
                      setActionsOpen(false);
                      void refetch();
                    }}
                  >
                    <RefreshCw className="h-4 w-4" />
                    Обновить данные
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-900"
                    onClick={() => {
                      setActionsOpen(false);
                      setActiveTab('overdue');
                    }}
                  >
                    <AlertTriangle className="h-4 w-4" />
                    Показать просроченные
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-900"
                    onClick={() => {
                      setActionsOpen(false);
                      resetFilters();
                    }}
                  >
                    <XCircle className="h-4 w-4" />
                    Сбросить фильтры
                  </button>
                </div>
              )}
            </div>
          )}
          {canCreate && (
            <Button onClick={openCreateDialog}>
              <Plus className="mr-1.5 h-4 w-4" />
              Новая доставка
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.label}
              type="button"
              onClick={() => {
                if (card.label === 'Активные') setActiveTab('active');
                if (card.label === 'Сегодня') {
                  setActiveTab('all');
                  setPeriodFilter('today');
                }
                if (card.label === 'В пути') setActiveTab('in_transit');
                if (card.label === 'Риски') setActiveTab('overdue');
                if (card.label === 'Выполнено') {
                  setActiveTab('completed');
                }
              }}
              className={`min-h-[112px] rounded-2xl border p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md ${card.card}`}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="text-xs font-semibold uppercase tracking-[0.16em] text-gray-500 dark:text-gray-400">{card.label}</div>
                <span className="rounded-xl bg-white/80 p-2 text-gray-500 ring-1 ring-gray-200 dark:bg-gray-950/70 dark:ring-gray-800">
                  <Icon className="h-4 w-4" />
                </span>
              </div>
              <div className={`mt-3 text-3xl font-bold ${card.tone}`}>{card.value}</div>
              <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{card.hint}</div>
            </button>
          );
        })}
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-[minmax(260px,1.45fr)_repeat(4,minmax(150px,0.85fr))_auto]">
          <div className="relative sm:col-span-2 lg:col-span-3 2xl:col-span-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              className="h-11 pl-9"
              placeholder={isCarrierView ? 'Заказ, техника, маршрут…' : 'Заказ, клиент, техника, водитель…'}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select value={periodFilter} onChange={(e) => setPeriodFilter(e.target.value as DeliveryPeriodFilter)} className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
            <option value="all">Все даты</option>
            <option value="today">Сегодня</option>
            <option value="tomorrow">Завтра</option>
            <option value="week">Неделя</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as DeliveryStatusFilter)} className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
            <option value="">Все статусы</option>
            <option value="in_transit">В пути</option>
            <option value="planned">Запланирована</option>
            <option value="completed">Завершена</option>
            <option value="overdue">Просрочена</option>
            <option value="unassigned">Ожидает назначения</option>
            <option value="cancelled">Отменена</option>
          </select>
          <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value as DeliveryType | '')} className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
            <option value="">Все типы</option>
            <option value="shipping">Доставка</option>
            <option value="receiving">Возврат</option>
          </select>
          {!isCarrierView && (
            <select value={carrierFilter} onChange={(e) => setCarrierFilter(e.target.value)} className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-950 dark:text-white">
              <option value="">Все водители</option>
              {carrierOptions.map((name) => <option key={name} value={name}>{name}</option>)}
            </select>
          )}
          <Button variant="secondary" onClick={resetFilters} className="h-11 rounded-xl sm:col-span-2 lg:col-span-1 2xl:col-span-1">Сбросить</Button>
        </div>
      </section>

      <div className={selectedDelivery ? 'grid gap-4 2xl:grid-cols-[minmax(0,1fr)_400px]' : undefined}>
      <section className="rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-gray-800 dark:bg-gray-900">
        <div className="flex flex-col gap-3 border-b border-gray-100 p-3 dark:border-gray-800 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-1 overflow-x-auto">
            {tabItems.map((tab) => {
              const isActive = activeTab === tab.id;
              const isOverdueTab = tab.id === 'overdue';

              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 rounded-xl px-3 py-2 text-sm font-semibold transition ${
                    isActive
                      ? isOverdueTab
                        ? 'bg-red-600 text-white shadow-sm'
                        : 'bg-blue-600 text-white shadow-sm'
                      : isOverdueTab
                        ? 'text-red-700 hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30'
                        : 'text-gray-600 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800'
                  }`}
                >
                  {tab.label}
                  <span className={`ml-2 rounded-full px-1.5 py-0.5 text-xs ${
                    isActive
                      ? 'bg-white/20 text-white'
                      : isOverdueTab
                        ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                        : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                  }`}>
                    {tab.count}
                  </span>
                </button>
              );
            })}
          </div>
          <div className="flex rounded-xl border border-gray-200 bg-gray-50 p-1 dark:border-gray-800 dark:bg-gray-950">
            {(['list', 'compact'] as DeliveryViewMode[]).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setViewMode(mode)}
                className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition ${viewMode === mode ? 'bg-white text-gray-950 shadow-sm dark:bg-gray-800 dark:text-white' : 'text-gray-500 hover:text-gray-900 dark:hover:text-white'}`}
              >
                {mode === 'list' ? 'Список' : 'Компактно'}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="flex h-52 items-center justify-center text-gray-500 dark:text-gray-400">
            <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
            Загружаю доставки…
          </div>
        ) : isError ? (
          <div className="flex h-60 flex-col items-center justify-center px-4 text-center text-gray-500 dark:text-gray-400">
            <AlertTriangle className="mb-3 h-10 w-10 text-red-500" />
            <p className="text-base font-semibold text-gray-900 dark:text-white">Не удалось загрузить доставки</p>
            <p className="mt-1 max-w-md text-sm">{errorMessage}</p>
            <Button variant="secondary" className="mt-4" onClick={() => void refetch()}>
              <RefreshCw className="h-4 w-4" />
              Повторить
            </Button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex h-60 flex-col items-center justify-center px-4 text-center text-gray-500 dark:text-gray-400">
            <Truck className="mb-3 h-10 w-10 opacity-40" />
            <p className="text-base font-semibold text-gray-900 dark:text-white">{emptyState.title}</p>
            <p className="mt-1 max-w-md text-sm">{emptyState.description}</p>
            {canCreate && deliveries.length === 0 && (
              <Button className="mt-4" onClick={openCreateDialog}>
                <Plus className="h-4 w-4" />
                Создать доставку
              </Button>
            )}
            {deliveries.length > 0 && (
              <Button variant="secondary" className="mt-4" onClick={resetFilters}>
                <XCircle className="h-4 w-4" />
                Сбросить фильтры
              </Button>
            )}
          </div>
        ) : viewMode === 'compact' ? (
          <div className="grid gap-3 p-3 md:grid-cols-2 xl:grid-cols-3">
            {filtered.map((delivery) => (
              <button
                key={delivery.id}
                type="button"
                onClick={() => {
                  setSelectedDeliveryId(delivery.id);
                  setDetailTab('overview');
                }}
                className={`rounded-2xl border p-4 text-left transition hover:border-blue-300 hover:shadow-sm dark:hover:border-blue-800 ${
                  selectedDeliveryId === delivery.id ? 'border-blue-400 bg-blue-50/70 dark:border-blue-700 dark:bg-blue-950/20' : 'border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950/40'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold text-gray-950 dark:text-white">{delivery.id}</div>
                    <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatDate(delivery.transportDate)} · {delivery.pickupTime || 'время не указано'}</div>
                  </div>
                  <span className={`rounded-full px-2.5 py-1 text-xs font-semibold ${STATUS_CLASSES[delivery.status] || STATUS_CLASSES.new}`}>{STATUS_LABELS[delivery.status] || delivery.status || 'Новая'}</span>
                </div>
                <div className="mt-3 text-sm font-medium text-gray-900 dark:text-white">{safeText(delivery.client)}</div>
                <div className="mt-1 truncate text-sm text-gray-600 dark:text-gray-300">{safeText(delivery.cargo)}</div>
                <div className="mt-3 flex items-center gap-2 text-xs text-gray-500 dark:text-gray-400">
                  <Route className="h-3.5 w-3.5" />
                  <span className="truncate">{safeText(delivery.origin)} → {safeText(delivery.destination)}</span>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1360px] text-sm">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/70 text-left text-xs uppercase tracking-[0.12em] text-gray-500 dark:border-gray-800 dark:bg-gray-950/60 dark:text-gray-400">
                  <th className="px-4 py-3"><input type="checkbox" aria-label="Выбрать все доставки" /></th>
                  <th className="px-4 py-3 font-semibold">№ доставки / дата</th>
                  <th className="px-4 py-3 font-semibold">Статус</th>
                  <th className="px-4 py-3 font-semibold">Тип</th>
                  {!isCarrierView && <th className="px-4 py-3 font-semibold">Клиент</th>}
                  <th className="px-4 py-3 font-semibold">Техника</th>
                  <th className="px-4 py-3 font-semibold">Маршрут / адрес</th>
                  <th className="px-4 py-3 font-semibold">Время</th>
                  {!isCarrierView && <th className="px-4 py-3 font-semibold">Водитель</th>}
                  <th className="px-4 py-3 font-semibold">Контакт</th>
                  {!isCarrierView && <th className="px-4 py-3 font-semibold">Стоимость</th>}
                  <th className="px-4 py-3 font-semibold">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-800">
                {filtered.map((delivery) => {
                  const statusMeta = getDeliveryStatusMeta(delivery, todayKey);
                  const isSelected = selectedDeliveryId === delivery.id;
                  const isOverdue = isDeliveryOverdue(delivery, todayKey);
                  const client = clientsById.get(delivery.clientId || '') || clientsByName.get(delivery.client?.trim().toLowerCase());
                  const clientInn = client?.inn || client?.innNormalized || '';
                  const equipmentName = delivery.equipmentLabel || delivery.cargo;
                  const inventoryNumber = delivery.equipmentInv || '';
                  const hasCarrier = Boolean(delivery.carrierName || delivery.carrierPhone);
                  const timeTone = isOverdue
                    ? 'bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300'
                    : delivery.status === 'completed'
                      ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                      : 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300';

                  return (
                    <tr
                      key={delivery.id}
                      onClick={() => {
                        setSelectedDeliveryId(delivery.id);
                        setDetailTab('overview');
                      }}
                      className={`cursor-pointer align-top transition hover:bg-blue-50/50 dark:hover:bg-blue-950/10 ${
                        isSelected ? 'bg-blue-50/80 ring-1 ring-inset ring-blue-200 dark:bg-blue-950/20 dark:ring-blue-900' : 'bg-white dark:bg-gray-900'
                      }`}
                    >
                      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                        <input
                          type="checkbox"
                          aria-label={`Выбрать доставку ${delivery.id}`}
                          checked={isSelected}
                          onChange={() => {
                            setSelectedDeliveryId(isSelected ? null : delivery.id);
                            setDetailTab('overview');
                          }}
                        />
                      </td>
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            setSelectedDeliveryId(delivery.id);
                            setDetailTab('overview');
                          }}
                          className="text-left font-semibold text-blue-700 underline-offset-2 hover:underline dark:text-blue-300"
                        >
                          {delivery.id}
                        </button>
                        <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">{formatDate(delivery.transportDate)}</div>
                        {isOverdue && (
                          <div className="mt-2 inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-300">
                            <AlertTriangle className="h-3 w-3" />
                            Просрочка
                          </div>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${statusMeta.className}`}>{statusMeta.label}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-semibold ${TYPE_CLASSES[delivery.type] || TYPE_CLASSES.shipping}`}>{delivery.type === 'shipping' ? 'Доставка' : 'Возврат'}</span>
                      </td>
                      {!isCarrierView && (
                        <td className="px-4 py-3">
                          <div className="max-w-[210px] truncate font-medium text-gray-950 dark:text-white" title={delivery.client}>{safeText(delivery.client)}</div>
                          <div className="mt-1 max-w-[210px] truncate text-xs text-gray-500 dark:text-gray-400" title={clientInn || undefined}>
                            {clientInn ? `ИНН ${clientInn}` : 'ИНН не указан'}
                          </div>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="max-w-[230px] truncate font-medium text-gray-950 dark:text-white" title={equipmentName}>{safeText(equipmentName)}</div>
                        <div className="mt-1 max-w-[230px] truncate text-xs text-gray-500 dark:text-gray-400" title={inventoryNumber || undefined}>
                          {inventoryNumber ? `INV ${inventoryNumber}` : 'Инв. номер не указан'}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex max-w-[300px] items-start gap-2" title={delivery.origin}>
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-gray-100 text-[11px] font-bold text-gray-600 dark:bg-gray-800 dark:text-gray-300">A</span>
                          <span className="min-w-0 truncate font-medium text-gray-950 dark:text-white">{safeText(delivery.origin)}</span>
                        </div>
                        <div className="mt-1 flex max-w-[300px] items-start gap-2" title={delivery.destination}>
                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-blue-100 text-[11px] font-bold text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">B</span>
                          <span className="min-w-0 truncate text-xs text-gray-500 dark:text-gray-400">{safeText(delivery.destination)}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${timeTone}`}>
                          <Clock3 className="h-3 w-3" />
                          План: {delivery.pickupTime || 'не указано'}
                        </div>
                        <div className={`mt-1 text-xs ${isOverdue ? 'font-semibold text-red-600 dark:text-red-300' : 'text-gray-500 dark:text-gray-400'}`}>
                          ETA: {formatDate(delivery.neededBy || delivery.transportDate)}
                        </div>
                        {delivery.status === 'completed' && (
                          <div className="mt-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                            Факт: {delivery.completedAt ? formatDateTime(delivery.completedAt) : 'выполнено'}
                          </div>
                        )}
                      </td>
                      {!isCarrierView && (
                        <td className="px-4 py-3">
                          <div className="max-w-[180px] truncate font-medium text-gray-950 dark:text-white" title={delivery.carrierName || undefined}>
                            {hasCarrier ? safeText(delivery.carrierName, 'Водитель') : 'Ожидает назначения'}
                          </div>
                          <div className="mt-1 max-w-[180px] truncate font-mono text-xs text-gray-500 dark:text-gray-400" title={delivery.carrierPhone || undefined}>
                            {delivery.carrierPhone || (delivery.botSentAt ? `MAX ${formatDate(delivery.botSentAt.slice(0, 10))}` : '—')}
                          </div>
                        </td>
                      )}
                      <td className="px-4 py-3">
                        <div className="max-w-[190px] truncate font-medium text-gray-950 dark:text-white" title={delivery.contactName || undefined}>
                          {safeText(delivery.contactName)}
                        </div>
                        <div className="mt-1 max-w-[190px] truncate font-mono text-xs text-gray-500 dark:text-gray-400" title={delivery.contactPhone || undefined}>
                          {safeText(delivery.contactPhone)}
                        </div>
                      </td>
                      {!isCarrierView && (
                        <td className="px-4 py-3 font-semibold text-gray-950 dark:text-white">
                          {formatDeliveryCost(delivery.cost)}
                        </td>
                      )}
                      <td className="px-4 py-3" onClick={(event) => event.stopPropagation()}>
                        <DropdownMenu.Root>
                          <DropdownMenu.Trigger asChild>
                            <button
                              type="button"
                              className="inline-flex size-9 items-center justify-center rounded-md text-sm font-medium transition-all hover:bg-accent hover:text-accent-foreground focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px] focus-visible:outline-none dark:hover:bg-accent/50"
                              aria-label={`Действия доставки ${delivery.id}`}
                            >
                              <MoreHorizontal className="h-4 w-4" />
                            </button>
                          </DropdownMenu.Trigger>
                          <DropdownMenu.Portal>
                            <DropdownMenu.Content align="end" className="z-50 min-w-48 rounded-xl border border-gray-200 bg-white p-1 shadow-lg dark:border-gray-800 dark:bg-gray-900">
                              <DropdownMenu.Item
                                onSelect={() => {
                                  setSelectedDeliveryId(delivery.id);
                                  setDetailTab('overview');
                                }}
                                className="cursor-pointer rounded-lg px-3 py-2 text-sm text-gray-700 outline-none hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                              >
                                Открыть панель
                              </DropdownMenu.Item>
                              {canEdit && (
                                <DropdownMenu.Item
                                  onSelect={() => openEditDialog(delivery)}
                                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-gray-700 outline-none hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                                >
                                  Изменить доставку
                                </DropdownMenu.Item>
                              )}
                              {canEdit && !CLOSED_DELIVERY_STATUSES.includes(delivery.status) && delivery.status !== 'accepted' && (
                                <DropdownMenu.Item
                                  onSelect={() => void toggleField(delivery, { status: 'accepted' })}
                                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-gray-700 outline-none hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                                >
                                  Принять
                                </DropdownMenu.Item>
                              )}
                              {canEdit && !CLOSED_DELIVERY_STATUSES.includes(delivery.status) && delivery.status !== 'in_transit' && (
                                <DropdownMenu.Item
                                  onSelect={() => void toggleField(delivery, { status: 'in_transit' })}
                                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-gray-700 outline-none hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                                >
                                  В пути
                                </DropdownMenu.Item>
                              )}
                              {canEdit && delivery.status !== 'completed' && (
                                <DropdownMenu.Item
                                  onSelect={() => void toggleField(delivery, { status: 'completed' })}
                                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-gray-700 outline-none hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                                >
                                  Выполнить
                                </DropdownMenu.Item>
                              )}
                              {canEdit && !CLOSED_DELIVERY_STATUSES.includes(delivery.status) && (
                                <DropdownMenu.Item
                                  onSelect={() => void cancelDelivery(delivery)}
                                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-red-600 outline-none hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                                >
                                  Отменить
                                </DropdownMenu.Item>
                              )}
                              {canEdit && !CLOSED_DELIVERY_STATUSES.includes(delivery.status) && (
                                <DropdownMenu.Item
                                  onSelect={() => resendToCarrier(delivery)}
                                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-gray-700 outline-none hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800"
                                >
                                  Отправить в MAX
                                </DropdownMenu.Item>
                              )}
                              {canDelete && (
                                <DropdownMenu.Item
                                  onSelect={() => void removeDelivery(delivery)}
                                  className="cursor-pointer rounded-lg px-3 py-2 text-sm text-red-600 outline-none hover:bg-red-50 dark:text-red-300 dark:hover:bg-red-950/30"
                                >
                                  Удалить
                                </DropdownMenu.Item>
                              )}
                            </DropdownMenu.Content>
                          </DropdownMenu.Portal>
                        </DropdownMenu.Root>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {selectedDelivery && (
        <aside className="hidden min-h-[620px] max-h-[calc(100vh-8rem)] overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm 2xl:flex 2xl:flex-col dark:border-gray-800 dark:bg-gray-950">
          {renderDeliveryPanel(selectedDelivery, 'aside')}
        </aside>
      )}
      </div>

      <DeliveryDialog
        open={dialogOpen}
        editing={Boolean(editingDelivery)}
        title={editingDelivery ? 'Редактировать доставку' : 'Новая доставка'}
        form={form}
        setForm={setForm}
        rentalOptions={rentalOptions}
        carriers={carriers}
        clients={clients}
        isSaving={isSaving}
        onClose={() => setDialogOpen(false)}
        onSubmit={handleSubmit}
      />

      <Sheet open={Boolean(selectedDelivery) && !isDesktopDetail} onOpenChange={(open) => {
        if (!open) setSelectedDeliveryId(null);
      }}>
        <SheetContent side="right" className="w-full overflow-hidden border-gray-200 bg-white sm:max-w-2xl dark:border-gray-800 dark:bg-gray-950">
          {selectedDelivery && renderDeliveryPanel(selectedDelivery, 'sheet')}
        </SheetContent>
      </Sheet>
    </div>
  );
}
