import React, { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  CalendarDays,
  CircleCheck,
  CircleDollarSign,
  CircleOff,
  CirclePause,
  Plus,
  RefreshCw,
  Route,
  Search,
  Send,
  Truck,
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

const DELIVERY_KEYS = {
  all: ['deliveries'] as const,
  carriers: ['delivery-carriers'] as const,
};

const STATUS_LABELS: Record<DeliveryStatus, string> = {
  new: 'Новая',
  sent: 'Отправлена',
  accepted: 'Принята',
  in_transit: 'Выехал',
  completed: 'Выполнена',
  cancelled: 'Отменена',
};

const STATUS_CLASSES: Record<DeliveryStatus, string> = {
  new: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  sent: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  accepted: 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300',
  in_transit: 'bg-violet-100 text-violet-700 dark:bg-violet-900/40 dark:text-violet-300',
  completed: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
  cancelled: 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300',
};

const TYPE_LABELS: Record<DeliveryType, string> = {
  shipping: 'Отгрузка',
  receiving: 'Приёмка',
};

const TYPE_CLASSES: Record<DeliveryType, string> = {
  shipping: 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300',
  receiving: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300',
};

type DeliveryFormState = {
  type: DeliveryType;
  transportDate: string;
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

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function makeEmptyForm(managerName = ''): DeliveryFormState {
  const today = todayIso();
  return {
    type: 'shipping',
    transportDate: today,
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

function formatCurrency(value: number) {
  return `${value.toLocaleString('ru-RU')} ₽`;
}

function formatDate(date: string) {
  if (!date) return '—';
  try {
    return new Date(date).toLocaleDateString('ru-RU');
  } catch {
    return date;
  }
}

function buildFormFromDelivery(delivery: Delivery): DeliveryFormState {
  return {
    type: delivery.type,
    transportDate: delivery.transportDate || todayIso(),
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
  const queryClient = useQueryClient();
  const canCreate = can('create', 'deliveries');
  const canEdit = can('edit', 'deliveries');
  const canDelete = can('delete', 'deliveries');
  const canFinancialControl = user?.role === 'Офис-менеджер' || user?.role === 'Администратор';

  const { data: deliveries = [], isLoading, refetch } = useQuery({
    queryKey: DELIVERY_KEYS.all,
    queryFn: deliveriesService.getAll,
  });
  const { data: carriers = [] } = useQuery({
    queryKey: DELIVERY_KEYS.carriers,
    queryFn: deliveriesService.getCarriers,
  });
  const { data: ganttRentals = [] } = useQuery({
    queryKey: ['gantt-rentals-deliveries'],
    queryFn: rentalsService.getGanttData,
  });
  const { data: classicRentals = [] } = useQuery({
    queryKey: ['classic-rentals-deliveries'],
    queryFn: rentalsService.getAll,
  });
  const { data: equipment = [] } = useQuery({
    queryKey: ['equipment-deliveries'],
    queryFn: equipmentService.getAll,
  });
  const { data: clients = [] } = useQuery({
    queryKey: ['clients-deliveries'],
    queryFn: clientsService.getAll,
  });

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | ''>('');
  const [typeFilter, setTypeFilter] = useState<DeliveryType | ''>('');
  const [managerFilter, setManagerFilter] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingDelivery, setEditingDelivery] = useState<Delivery | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [form, setForm] = useState<DeliveryFormState>(makeEmptyForm(user?.name || ''));

  const rentalOptions = useMemo<RentalOption[]>(() => {
    const equipmentById = new Map(equipment.map((item) => [item.id, item]));
    const classicMatchByGantt = new Map<string, Rental>();

    for (const gantt of ganttRentals as GanttRentalData[]) {
      const classic = (classicRentals as Rental[]).find((item) =>
        item.client === gantt.client &&
        Array.isArray(item.equipment) &&
        item.equipment.includes(gantt.equipmentInv) &&
        item.startDate === gantt.startDate,
      );
      if (classic) classicMatchByGantt.set(gantt.id, classic);
    }

    return (ganttRentals as GanttRentalData[])
      .filter((item) => item.status !== 'closed')
      .map((item) => {
        const classic = classicMatchByGantt.get(item.id);
        const client = (clients as Client[]).find((entry) => entry.company === item.client);
        const eq = equipmentById.get(item.equipmentId || '') || (equipment as Equipment[]).find((entry) => entry.inventoryNumber === item.equipmentInv);
        const equipmentLabel = eq ? `${eq.manufacturer} ${eq.model}` : item.equipmentInv;
        return {
          ganttRentalId: item.id,
          classicRentalId: classic?.id || '',
          client: item.client || '',
          clientId: client?.id || '',
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

  const managerOptions = useMemo(() => {
    return [...new Set(deliveries.map((item) => item.manager).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ru'));
  }, [deliveries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return deliveries.filter((item) => {
      if (statusFilter && item.status !== statusFilter) return false;
      if (typeFilter && item.type !== typeFilter) return false;
      if (managerFilter && item.manager !== managerFilter) return false;
      if (!q) return true;
      return [
        item.client,
        item.cargo,
        item.origin,
        item.destination,
        item.contactName,
        item.contactPhone,
        item.carrierName,
        item.equipmentInv,
        item.equipmentLabel,
      ].some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [deliveries, managerFilter, search, statusFilter, typeFilter]);

  const kpis = useMemo(() => ({
    total: deliveries.length,
    needInvoice: deliveries.filter((item) => item.status === 'completed' && !item.carrierInvoiceReceived).length,
    unpaidByClient: deliveries.filter((item) => item.status === 'completed' && !item.clientPaymentVerified).length,
    sentToCarrier: deliveries.filter((item) => Boolean(item.botSentAt)).length,
  }), [deliveries]);

  function openCreateDialog() {
    setEditingDelivery(null);
    setForm(makeEmptyForm(user?.name || ''));
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
        toast.success('Доставка обновлена');
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
      await deliveriesService.resendToCarrier(delivery.id);
      await invalidateDeliveryContext();
      toast.success('Заявка повторно отправлена перевозчику');
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

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="text-xs font-semibold uppercase tracking-[0.28em] text-blue-500">Логистика</div>
          <h1 className="mt-2 text-2xl font-bold text-gray-900 dark:text-white sm:text-3xl">Доставка</h1>
          <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">
            Менеджер создаёт заявку на перевозку, система отправляет её выбранному перевозчику в MAX,
            а офис видит, по каким клиентам перевозка выполнена, счёт получен и оплата подтверждена.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => refetch()}>
            <RefreshCw className="mr-1.5 h-4 w-4" />
            Обновить
          </Button>
          {canCreate && (
            <Button onClick={openCreateDialog}>
              <Plus className="mr-1.5 h-4 w-4" />
              Новая доставка
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-3 md:grid-cols-4">
        {[
          { label: 'Всего заявок', value: kpis.total, tone: 'text-slate-100', bg: 'from-slate-900 to-slate-800' },
          { label: 'Отправлено перевозчику', value: kpis.sentToCarrier, tone: 'text-blue-100', bg: 'from-blue-900 to-blue-800' },
          { label: 'Без счёта перевозчика', value: kpis.needInvoice, tone: 'text-amber-100', bg: 'from-amber-900 to-amber-800' },
          { label: 'Клиент не подтвердил оплату', value: kpis.unpaidByClient, tone: 'text-red-100', bg: 'from-red-900 to-red-800' },
        ].map((card) => (
          <div key={card.label} className={`rounded-2xl bg-gradient-to-br ${card.bg} p-4 shadow-lg`}>
            <div className="text-xs uppercase tracking-[0.24em] text-white/60">{card.label}</div>
            <div className={`mt-3 text-3xl font-semibold ${card.tone}`}>{card.value}</div>
          </div>
        ))}
      </div>

      <div className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-gray-700 dark:bg-gray-800">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center">
          <div className="relative flex-1">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
            <Input
              className="pl-9"
              placeholder="Клиент, груз, перевозчик, маршрут…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as DeliveryType | '')}
            className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="">Все операции</option>
            <option value="shipping">Отгрузка</option>
            <option value="receiving">Приёмка</option>
          </select>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as DeliveryStatus | '')}
            className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="">Все статусы</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <select
            value={managerFilter}
            onChange={(e) => setManagerFilter(e.target.value)}
            className="h-11 rounded-xl border border-gray-200 bg-white px-3 text-sm text-gray-900 dark:border-gray-700 dark:bg-gray-900 dark:text-white"
          >
            <option value="">Все менеджеры</option>
            {managerOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>

        <div className="mt-4 overflow-x-auto">
          {isLoading ? (
            <div className="flex h-40 items-center justify-center text-gray-500 dark:text-gray-400">
              <RefreshCw className="mr-2 h-5 w-5 animate-spin" />
              Загружаю доставки…
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex h-40 flex-col items-center justify-center text-gray-500 dark:text-gray-400">
              <Truck className="mb-3 h-10 w-10 opacity-40" />
              <p className="text-base font-medium">Доставок пока нет</p>
              <p className="mt-1 text-sm">Создай первую заявку на перевозку и она сразу уйдёт перевозчику в MAX.</p>
            </div>
          ) : (
            <table className="w-full min-w-[1200px] text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-xs uppercase tracking-[0.14em] text-gray-500 dark:border-gray-700 dark:text-gray-400">
                  <th className="pb-3 font-medium">Операция</th>
                  <th className="pb-3 font-medium">Дата</th>
                  <th className="pb-3 font-medium">Клиент</th>
                  <th className="pb-3 font-medium">Что везём</th>
                  <th className="pb-3 font-medium">Маршрут</th>
                  <th className="pb-3 font-medium">Перевозчик</th>
                  <th className="pb-3 font-medium">Статус</th>
                  <th className="pb-3 font-medium">Финконтроль</th>
                  <th className="pb-3 font-medium">Действия</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-gray-700">
                {filtered.map((delivery) => {
                  const linkedCarrier = carriers.find((item) => item.key === delivery.carrierKey);

                  return (
                  <tr key={delivery.id} className="align-top">
                    <td className="py-3 pr-4">
                      <div className="flex flex-col gap-2">
                        <span className={`inline-flex w-fit rounded-full px-2.5 py-1 text-xs font-medium ${TYPE_CLASSES[delivery.type]}`}>
                          {TYPE_LABELS[delivery.type]}
                        </span>
                        <div className="text-xs text-gray-500 dark:text-gray-400">{delivery.id}</div>
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-gray-900 dark:text-white">{formatDate(delivery.transportDate)}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        Нужно к {formatDate(delivery.neededBy || delivery.transportDate)}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-gray-900 dark:text-white">{delivery.client}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">{delivery.manager}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-gray-900 dark:text-white">{delivery.cargo}</div>
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {delivery.equipmentInv || 'Без INV'}{delivery.equipmentLabel ? ` · ${delivery.equipmentLabel}` : ''}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-gray-900 dark:text-white">{delivery.origin}</div>
                      <div className="mt-1 flex items-center gap-1 text-xs text-gray-500 dark:text-gray-400">
                        <Route className="h-3.5 w-3.5" />
                        {delivery.destination}
                      </div>
                      <div className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                        {delivery.contactName} · {delivery.contactPhone}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="font-medium text-gray-900 dark:text-white">{delivery.carrierName || 'Не выбран'}</div>
                      {(linkedCarrier?.company || linkedCarrier?.inn) && (
                        <div className="text-xs text-gray-500 dark:text-gray-400">
                          {linkedCarrier?.company || 'Без компании'}
                          {linkedCarrier?.inn
                            ? ` · ИНН ${linkedCarrier.inn}`
                            : ''}
                        </div>
                      )}
                      <div className="text-xs text-gray-500 dark:text-gray-400">
                        {delivery.botSentAt
                          ? `MAX: отправлено ${formatDate(delivery.botSentAt.slice(0, 10))}`
                          : (delivery.botSendError || 'В MAX ещё не отправлено')}
                      </div>
                    </td>
                    <td className="py-3 pr-4">
                      <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${STATUS_CLASSES[delivery.status]}`}>
                        {STATUS_LABELS[delivery.status]}
                      </span>
                      <div className="mt-2 font-medium text-gray-900 dark:text-white">{formatCurrency(delivery.cost)}</div>
                    </td>
                    <td className="py-3 pr-4">
                      <div className="space-y-2">
                        <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                          delivery.carrierInvoiceReceived
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
                            : 'bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300'
                        }`}>
                          <CircleDollarSign className="h-3.5 w-3.5" />
                          {delivery.carrierInvoiceReceived ? 'Счёт получен' : 'Ждём счёт'}
                        </div>
                        <div className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-medium ${
                          delivery.clientPaymentVerified
                            ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300'
                            : 'bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300'
                        }`}>
                          <CircleCheck className="h-3.5 w-3.5" />
                          {delivery.clientPaymentVerified ? 'Клиент оплатил' : 'Оплата не подтверждена'}
                        </div>
                      </div>
                    </td>
                    <td className="py-3">
                      <div className="flex flex-col gap-2">
                        {canEdit && (
                          <Button size="sm" variant="secondary" onClick={() => openEditDialog(delivery)}>
                            Изменить
                          </Button>
                        )}
                        {canEdit && (
                          <Button size="sm" variant="secondary" onClick={() => resendToCarrier(delivery)}>
                            <Send className="mr-1.5 h-3.5 w-3.5" />
                            Отправить ещё раз
                          </Button>
                        )}
                        {canFinancialControl && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => toggleField(delivery, { carrierInvoiceReceived: !delivery.carrierInvoiceReceived })}
                          >
                            {delivery.carrierInvoiceReceived ? 'Снять счёт' : 'Получен счёт'}
                          </Button>
                        )}
                        {canFinancialControl && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => toggleField(delivery, { clientPaymentVerified: !delivery.clientPaymentVerified })}
                          >
                            {delivery.clientPaymentVerified ? 'Снять оплату' : 'Клиент оплатил'}
                          </Button>
                        )}
                        {canDelete && (
                          <Button size="sm" variant="destructive" onClick={() => removeDelivery(delivery)}>
                            Удалить
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
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
    </div>
  );
}
